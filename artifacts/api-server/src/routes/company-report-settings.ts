import { Router, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import {
  companiesTable,
  companyReportProfilesTable,
  companyReportRetentionSettingsTable,
  companyReportSectionSettingsTable,
  companyReportTypeSettingsTable,
  db,
} from "@workspace/db";
import {
  DEFAULT_COMPANY_REPORT_PROFILE,
  REPORT_CONFIDENTIALITY_LEVELS,
  REPORT_COVER_STYLES,
  REPORT_FILE_NAME_TOKENS,
  REPORT_LOCALES,
  REPORT_PROFILE_FIELD_LIMITS,
  REPORT_TYPE_REGISTRY,
  VIRTUAL_DEFAULT_REPORT_PROFILE_VERSION,
  VIRTUAL_DEFAULT_REPORT_TYPE_SETTINGS_VERSION,
  type CompanyReportProfileValues,
  type ReportCoverStyle,
  type ReportLocale,
  type ReportTypeCode,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth.js";
import { writeAuditEvent } from "../lib/audit.js";
import {
  DEFAULT_REPORT_RETENTION_SETTINGS,
  parseRetentionInteger,
  serializeRetentionSettings,
} from "../lib/report-retention.js";
import {
  getReportTypeDefinition,
  resolveEffectiveCompanyReportSettings,
  serializeDefaultReportProfile,
} from "../lib/company-report-settings-resolver.js";

const router = Router();

const PROFILE_FIELDS = [
  "showLogo",
  "defaultLocale",
  "defaultTitle",
  "defaultSubtitle",
  "documentNumber",
  "revisionNumber",
  "revisionDate",
  "preparedBy",
  "checkedBy",
  "approvedBy",
  "confidentialityLevel",
  "footerText",
  "showSignatureFields",
  "showPageNumbers",
  "coverStyle",
  "fileNamePattern",
] as const;

const profilePatchKeys = new Set<string>(["expectedProfileVersion", ...PROFILE_FIELDS]);
const typePatchKeys = new Set<string>(["titleOverride", "subtitleOverride", "localeOverride", "coverStyleOverride", "sections", "expectedTypeSettingsVersion"]);
const sectionPatchKeys = new Set<string>(["code", "isVisible", "displayOrder", "labelOverride"]);
const retentionPatchKeys = new Set<string>([
  "retentionEnabled",
  "completedRetentionDays",
  "failedRetentionDays",
  "deletedGraceDays",
  "expectedSettingsVersion",
]);

type ProfileField = typeof PROFILE_FIELDS[number];

function parsePositiveInteger(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function oneOf<T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function resolveTargetCompanyId(req: Request, res: Response): number | undefined {
  const { role, companyId: sessionCompanyId } = req.user!;
  if (role === "superadmin") {
    const parsed = parsePositiveInteger(req.query.companyId);
    if (parsed === undefined) {
      res.status(400).json({ error: "Geçerli companyId zorunludur" });
      return undefined;
    }
    return parsed;
  }
  if (req.query.companyId !== undefined || (req.body && typeof req.body === "object" && "companyId" in req.body)) {
    res.status(400).json({ error: "Firma kapsamı oturumdan alınır; companyId gönderilmemelidir" });
    return undefined;
  }
  return sessionCompanyId;
}

async function ensureCompany(companyId: number) {
  const [company] = await db.select({ id: companiesTable.id, name: companiesTable.name })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .limit(1);
  return company ?? null;
}

function nullableText(value: unknown, max: number, field: string): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: `${field} metin olmalıdır` };
  if (/[\u0000-\u001f\u007f]/.test(value)) return { ok: false, error: `${field} kontrol karakteri içeremez` };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > max) return { ok: false, error: `${field} çok uzun` };
  return { ok: true, value: trimmed };
}

function validateFileNamePattern(value: unknown) {
  if (typeof value !== "string") return { ok: false as const, error: "Dosya adı kuralı metin olmalıdır" };
  if (value.length === 0 || value.length > REPORT_PROFILE_FIELD_LIMITS.fileNamePattern) return { ok: false as const, error: "Dosya adı kuralı geçersiz uzunlukta" };
  if (/[\u0000-\u001f\u007f]/.test(value) || /[\\/]/.test(value) || value.includes("..")) {
    return { ok: false as const, error: "Dosya adı kuralı güvenli değil" };
  }
  const allowed = new Set<string>(REPORT_FILE_NAME_TOKENS);
  const tokens = [...value.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
  if (tokens.some((token) => !allowed.has(token))) return { ok: false as const, error: "Dosya adı kuralında bilinmeyen token var" };
  if (/[{}]/.test(value.replace(/\{[^{}]+\}/g, ""))) return { ok: false as const, error: "Dosya adı kuralı geçersiz token içeriyor" };
  return { ok: true as const, value: value.trim() };
}

function parseExpectedVersion(value: unknown, name: string) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? { ok: true as const, value }
    : { ok: false as const, error: `Geçerli ${name} zorunludur` };
}

function parseProfilePatch(body: unknown): { ok: true; expectedProfileVersion: number; values: Partial<CompanyReportProfileValues> } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Geçersiz rapor profili verisi" };
  const input = body as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!profilePatchKeys.has(key)) return { ok: false, error: "Bilinmeyen rapor profili alanı gönderildi" };
  }
  const expected = parseExpectedVersion(input.expectedProfileVersion, "expectedProfileVersion");
  if (!expected.ok) return { ok: false, error: expected.error };

  const values: Partial<CompanyReportProfileValues> = {};
  if ("showLogo" in input) {
    if (typeof input.showLogo !== "boolean") return { ok: false, error: "Logo gösterimi boolean olmalıdır" };
    values.showLogo = input.showLogo;
  }
  if ("defaultLocale" in input) {
    if (!oneOf(input.defaultLocale, REPORT_LOCALES)) return { ok: false, error: "Geçersiz rapor dili" };
    values.defaultLocale = input.defaultLocale;
  }
  for (const [field, max] of [
    ["defaultTitle", REPORT_PROFILE_FIELD_LIMITS.defaultTitle],
    ["defaultSubtitle", REPORT_PROFILE_FIELD_LIMITS.defaultSubtitle],
    ["documentNumber", REPORT_PROFILE_FIELD_LIMITS.documentNumber],
    ["revisionNumber", REPORT_PROFILE_FIELD_LIMITS.revisionNumber],
    ["preparedBy", REPORT_PROFILE_FIELD_LIMITS.preparedBy],
    ["checkedBy", REPORT_PROFILE_FIELD_LIMITS.checkedBy],
    ["approvedBy", REPORT_PROFILE_FIELD_LIMITS.approvedBy],
    ["footerText", REPORT_PROFILE_FIELD_LIMITS.footerText],
  ] as const) {
    if (field in input) {
      const parsed = nullableText(input[field], max, field);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      values[field] = parsed.value;
    }
  }
  if ("revisionDate" in input) {
    if (input.revisionDate === null || input.revisionDate === "") {
      values.revisionDate = null;
    } else if (typeof input.revisionDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.revisionDate)) {
      values.revisionDate = input.revisionDate;
    } else {
      return { ok: false, error: "Geçersiz revizyon tarihi" };
    }
  }
  if ("confidentialityLevel" in input) {
    if (!oneOf(input.confidentialityLevel, REPORT_CONFIDENTIALITY_LEVELS)) return { ok: false, error: "Geçersiz gizlilik derecesi" };
    values.confidentialityLevel = input.confidentialityLevel;
  }
  if ("showSignatureFields" in input) {
    if (typeof input.showSignatureFields !== "boolean") return { ok: false, error: "İmza alanı tercihi boolean olmalıdır" };
    values.showSignatureFields = input.showSignatureFields;
  }
  if ("showPageNumbers" in input) {
    if (typeof input.showPageNumbers !== "boolean") return { ok: false, error: "Sayfa numarası tercihi boolean olmalıdır" };
    values.showPageNumbers = input.showPageNumbers;
  }
  if ("coverStyle" in input) {
    if (!oneOf(input.coverStyle, REPORT_COVER_STYLES)) return { ok: false, error: "Geçersiz kapak biçimi" };
    values.coverStyle = input.coverStyle;
  }
  if ("fileNamePattern" in input) {
    const parsed = validateFileNamePattern(input.fileNamePattern);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    values.fileNamePattern = parsed.value;
  }

  if (Object.keys(values).length === 0) return { ok: false, error: "Güncellenecek en az bir rapor profili alanı gönderilmelidir" };
  return { ok: true, expectedProfileVersion: expected.value, values };
}

function serializeProfile(row: typeof companyReportProfilesTable.$inferSelect | null, companyId: number) {
  if (!row) return serializeDefaultReportProfile(companyId);
  return {
    companyId: row.companyId,
    showLogo: row.showLogo,
    defaultLocale: row.defaultLocale,
    defaultTitle: row.defaultTitle,
    defaultSubtitle: row.defaultSubtitle,
    documentNumber: row.documentNumber,
    revisionNumber: row.revisionNumber,
    revisionDate: row.revisionDate,
    preparedBy: row.preparedBy,
    checkedBy: row.checkedBy,
    approvedBy: row.approvedBy,
    confidentialityLevel: row.confidentialityLevel,
    footerText: row.footerText,
    showSignatureFields: row.showSignatureFields,
    showPageNumbers: row.showPageNumbers,
    coverStyle: row.coverStyle,
    fileNamePattern: row.fileNamePattern,
    profileVersion: row.profileVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function changedFields(before: Record<string, unknown>, after: Record<string, unknown>, fields: readonly string[]) {
  return fields.filter((field) => before[field] !== after[field]);
}

function parseReportTypeParam(value: string) {
  return REPORT_TYPE_REGISTRY.some((definition) => definition.code === value) ? value as ReportTypeCode : null;
}

function reportTypeFromParams(value: unknown) {
  return typeof value === "string" ? parseReportTypeParam(value) : null;
}

function parseTypePatch(reportType: ReportTypeCode, body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false as const, error: "Geçersiz rapor türü ayarı verisi" };
  const input = body as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!typePatchKeys.has(key)) return { ok: false as const, error: "Bilinmeyen rapor türü ayarı alanı gönderildi" };
  }
  const expected = parseExpectedVersion(input.expectedTypeSettingsVersion, "expectedTypeSettingsVersion");
  if (!expected.ok) return { ok: false as const, error: expected.error };
  const definition = getReportTypeDefinition(reportType)!;

  const title = "titleOverride" in input ? nullableText(input.titleOverride, REPORT_PROFILE_FIELD_LIMITS.defaultTitle, "titleOverride") : null;
  if (title && !title.ok) return { ok: false as const, error: title.error };
  const subtitle = "subtitleOverride" in input ? nullableText(input.subtitleOverride, REPORT_PROFILE_FIELD_LIMITS.defaultSubtitle, "subtitleOverride") : null;
  if (subtitle && !subtitle.ok) return { ok: false as const, error: subtitle.error };
  let localeOverride: ReportLocale | null | undefined = undefined;
  if ("localeOverride" in input) {
    if (input.localeOverride === null || input.localeOverride === "") localeOverride = null;
    else if (oneOf(input.localeOverride, definition.supportedLocales)) localeOverride = input.localeOverride;
    else return { ok: false as const, error: "Geçersiz rapor dili override" };
  }
  let coverStyleOverride: ReportCoverStyle | null | undefined = undefined;
  if ("coverStyleOverride" in input) {
    if (input.coverStyleOverride === null || input.coverStyleOverride === "") coverStyleOverride = null;
    else if (oneOf(input.coverStyleOverride, definition.supportedCoverStyles)) coverStyleOverride = input.coverStyleOverride;
    else return { ok: false as const, error: "Geçersiz kapak biçimi override" };
  }

  if (!Array.isArray(input.sections)) return { ok: false as const, error: "Bölüm listesi zorunludur" };
  if (input.sections.length !== definition.sections.length) return { ok: false as const, error: "Bölüm listesi tam olmalıdır" };
  const byCode = new Map<string, typeof definition.sections[number]>(definition.sections.map((section) => [section.code, section]));
  const seen = new Set<string>();
  const sections = [];
  for (const [index, raw] of input.sections.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false as const, error: "Geçersiz bölüm ayarı" };
    const sectionInput = raw as Record<string, unknown>;
    for (const key of Object.keys(sectionInput)) {
      if (!sectionPatchKeys.has(key)) return { ok: false as const, error: "Bilinmeyen bölüm ayarı alanı gönderildi" };
    }
    if (typeof sectionInput.code !== "string") return { ok: false as const, error: "Bölüm kodu zorunludur" };
    if (seen.has(sectionInput.code)) return { ok: false as const, error: "Tekrarlı bölüm kodu gönderildi" };
    seen.add(sectionInput.code);
    const section = byCode.get(sectionInput.code);
    if (!section) return { ok: false as const, error: "Bilinmeyen bölüm kodu gönderildi" };
    const canHide = Boolean(section.canHide);
    const canRename = Boolean(section.canRename);
    const canReorder = Boolean(section.canReorder);
    if (typeof sectionInput.isVisible !== "boolean") return { ok: false as const, error: "Bölüm görünürlüğü boolean olmalıdır" };
    if ((section.requirement === "required" || !canHide) && sectionInput.isVisible === false) {
      return { ok: false as const, error: "Zorunlu bölüm gizlenemez" };
    }
    const label = "labelOverride" in sectionInput ? nullableText(sectionInput.labelOverride, REPORT_PROFILE_FIELD_LIMITS.sectionLabel, "labelOverride") : { ok: true as const, value: null };
    if (!label.ok) return { ok: false as const, error: label.error };
    if (!canRename && label.value !== null) return { ok: false as const, error: "Bu bölüm yeniden adlandırılamaz" };
    const requestedOrder = canReorder ? (index + 1) * 10 : section.defaultOrder;
    if (!canReorder && "displayOrder" in sectionInput && sectionInput.displayOrder !== section.defaultOrder) {
      return { ok: false as const, error: "Bu bölüm yeniden sıralanamaz" };
    }
    sections.push({
      code: section.code,
      isVisible: section.requirement === "required" || !canHide ? true : sectionInput.isVisible,
      displayOrder: requestedOrder,
      labelOverride: label.value,
    });
  }
  for (const section of definition.sections) {
    if (!seen.has(section.code)) return { ok: false as const, error: "Bölüm listesi eksik" };
  }

  return {
    ok: true as const,
    expectedTypeSettingsVersion: expected.value,
    values: {
      titleOverride: title?.value,
      subtitleOverride: subtitle?.value,
      localeOverride,
      coverStyleOverride,
    },
    sections,
  };
}

function parseRetentionPatch(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false as const, error: "Gecersiz saklama politikasi verisi" };
  const input = body as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!retentionPatchKeys.has(key)) return { ok: false as const, error: "Bilinmeyen saklama politikasi alani gonderildi" };
  }
  const expected = parseExpectedVersion(input.expectedSettingsVersion, "expectedSettingsVersion");
  if (!expected.ok) return { ok: false as const, error: expected.error };
  if (typeof input.retentionEnabled !== "boolean") return { ok: false as const, error: "retentionEnabled boolean olmalidir" };
  const completedRetentionDays = parseRetentionInteger(input.completedRetentionDays, "completedRetentionDays");
  const failedRetentionDays = parseRetentionInteger(input.failedRetentionDays, "failedRetentionDays");
  const deletedGraceDays = parseRetentionInteger(input.deletedGraceDays, "deletedGraceDays");
  if (completedRetentionDays === null) return { ok: false as const, error: "Tamamlanan rapor saklama suresi 365-36500 gun arasinda olmalidir" };
  if (failedRetentionDays === null) return { ok: false as const, error: "Hatali rapor saklama suresi 30-3650 gun arasinda olmalidir" };
  if (deletedGraceDays === null) return { ok: false as const, error: "Silinen rapor bekleme suresi 7-365 gun arasinda olmalidir" };
  return {
    ok: true as const,
    expectedSettingsVersion: expected.value,
    values: {
      retentionEnabled: input.retentionEnabled,
      completedRetentionDays,
      failedRetentionDays,
      deletedGraceDays,
      automaticCleanupAllowed: false,
    },
  };
}

router.get("/company-report-settings/retention", requireAuth, async (req, res) => {
  try {
    const { role } = req.user!;
    if (role === "user") {
      res.status(403).json({ error: "Bu islem icin yetkiniz yok" });
      return;
    }
    const companyId = resolveTargetCompanyId(req, res);
    if (companyId === undefined) return;
    if (!await ensureCompany(companyId)) {
      res.status(404).json({ error: "Firma bulunamadi" });
      return;
    }
    const [settings] = await db.select().from(companyReportRetentionSettingsTable).where(eq(companyReportRetentionSettingsTable.companyId, companyId)).limit(1);
    res.json({
      settings: serializeRetentionSettings(settings ? {
        company_id: settings.companyId,
        retention_enabled: settings.retentionEnabled,
        completed_retention_days: settings.completedRetentionDays,
        failed_retention_days: settings.failedRetentionDays,
        deleted_grace_days: settings.deletedGraceDays,
        automatic_cleanup_allowed: settings.automaticCleanupAllowed,
        settings_version: settings.settingsVersion,
        created_at: settings.createdAt,
        updated_at: settings.updatedAt,
      } : null, companyId),
      permissions: { canEdit: role === "admin" || role === "superadmin" },
      isDefault: !settings,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Saklama politikasi okunamadi" });
  }
});

router.patch("/company-report-settings/retention", requireAuth, async (req, res) => {
  try {
    const { role, userId } = req.user!;
    if (role !== "admin" && role !== "superadmin") {
      res.status(403).json({ error: "Bu islem icin yetkiniz yok" });
      return;
    }
    const companyId = resolveTargetCompanyId(req, res);
    if (companyId === undefined) return;
    const parsed = parseRetentionPatch(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const result = await db.transaction(async (tx) => {
      const [company] = await tx.select({ id: companiesTable.id }).from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1).for("update");
      if (!company) return { status: "not-found" as const };
      const [existing] = await tx.select().from(companyReportRetentionSettingsTable).where(eq(companyReportRetentionSettingsTable.companyId, companyId)).limit(1).for("update");
      const previous = existing ? serializeRetentionSettings({
        company_id: existing.companyId,
        retention_enabled: existing.retentionEnabled,
        completed_retention_days: existing.completedRetentionDays,
        failed_retention_days: existing.failedRetentionDays,
        deleted_grace_days: existing.deletedGraceDays,
        automatic_cleanup_allowed: existing.automaticCleanupAllowed,
        settings_version: existing.settingsVersion,
        created_at: existing.createdAt,
        updated_at: existing.updatedAt,
      }, companyId) : { companyId, ...DEFAULT_REPORT_RETENTION_SETTINGS, createdAt: null, updatedAt: null };
      if (previous.settingsVersion !== parsed.expectedSettingsVersion) return { status: "conflict" as const, previous };
      const nextVersion = previous.settingsVersion + 1;
      const values = { ...parsed.values, settingsVersion: nextVersion, updatedAt: new Date(), updatedBy: userId };
      const [saved] = existing
        ? await tx.update(companyReportRetentionSettingsTable).set(values).where(eq(companyReportRetentionSettingsTable.companyId, companyId)).returning()
        : await tx.insert(companyReportRetentionSettingsTable).values({ companyId, ...parsed.values, settingsVersion: 1, updatedBy: userId }).returning();
      return { status: existing ? "updated" as const : "created" as const, previous, saved };
    });
    if (result.status === "not-found") {
      res.status(404).json({ error: "Firma bulunamadi" });
      return;
    }
    if (result.status === "conflict") {
      res.status(409).json({ error: "Saklama politikasi baska bir islem tarafindan guncellendi", settings: result.previous });
      return;
    }
    const saved = serializeRetentionSettings({
      company_id: result.saved.companyId,
      retention_enabled: result.saved.retentionEnabled,
      completed_retention_days: result.saved.completedRetentionDays,
      failed_retention_days: result.saved.failedRetentionDays,
      deleted_grace_days: result.saved.deletedGraceDays,
      automatic_cleanup_allowed: result.saved.automaticCleanupAllowed,
      settings_version: result.saved.settingsVersion,
      created_at: result.saved.createdAt,
      updated_at: result.saved.updatedAt,
    }, companyId);
    await writeAuditEvent(db, {
      request: req,
      companyId,
      action: result.status === "created" ? "report_retention_settings.created" : "report_retention_settings.updated",
      entityType: "report_retention_settings",
      entityId: companyId,
      metadata: {
        changedFields: ["retentionEnabled", "completedRetentionDays", "failedRetentionDays", "deletedGraceDays"],
        previousVersion: result.previous.settingsVersion,
        newVersion: saved.settingsVersion,
      },
    });
    res.json({ settings: saved, permissions: { canEdit: true }, isDefault: false });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Saklama politikasi kaydedilemedi" });
  }
});

router.get("/company-report-settings/profile", requireAuth, async (req, res) => {
  try {
    const { role } = req.user!;
    if (role === "user") {
      res.status(403).json({ error: "Bu işlem için yetkiniz yok" });
      return;
    }
    const companyId = resolveTargetCompanyId(req, res);
    if (companyId === undefined) return;
    if (!await ensureCompany(companyId)) {
      res.status(404).json({ error: "Firma bulunamadı" });
      return;
    }
    const [profile] = await db.select().from(companyReportProfilesTable).where(eq(companyReportProfilesTable.companyId, companyId)).limit(1);
    res.json({ profile: serializeProfile(profile ?? null, companyId), permissions: { canEdit: role === "admin" || role === "superadmin" }, isDefault: !profile });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.patch("/company-report-settings/profile", requireAuth, async (req, res) => {
  try {
    const { role, userId } = req.user!;
    if (role !== "admin" && role !== "superadmin") {
      res.status(403).json({ error: "Bu işlem için yetkiniz yok" });
      return;
    }
    const companyId = resolveTargetCompanyId(req, res);
    if (companyId === undefined) return;
    const parsed = parseProfilePatch(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [company] = await tx.select({ id: companiesTable.id }).from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1).for("update");
      if (!company) return { status: "not-found" as const };
      const [existing] = await tx.select().from(companyReportProfilesTable).where(eq(companyReportProfilesTable.companyId, companyId)).limit(1).for("update");
      const before = serializeProfile(existing ?? null, companyId);
      const currentVersion = existing?.profileVersion ?? VIRTUAL_DEFAULT_REPORT_PROFILE_VERSION;
      if (parsed.expectedProfileVersion !== currentVersion) return { status: "conflict" as const, profile: before };
      const nextVersion = currentVersion + 1;
      const nextValues = {
        ...parsed.values,
        profileVersion: nextVersion,
        updatedAt: new Date(),
        updatedBy: userId,
      };
      const [saved] = existing
        ? await tx.update(companyReportProfilesTable).set(nextValues).where(eq(companyReportProfilesTable.companyId, companyId)).returning()
        : await tx.insert(companyReportProfilesTable).values({
            companyId,
            ...DEFAULT_COMPANY_REPORT_PROFILE,
            ...parsed.values,
            profileVersion: 1,
            updatedBy: userId,
          }).returning();
      return { status: existing ? "updated" as const : "created" as const, before, profile: serializeProfile(saved, companyId) };
    });
    if (result.status === "not-found") {
      res.status(404).json({ error: "Firma bulunamadı" });
      return;
    }
    if (result.status === "conflict") {
      res.status(409).json({ error: "Rapor profili başka bir işlem tarafından güncellendi", profile: result.profile });
      return;
    }
    const fields = changedFields(result.before, result.profile, PROFILE_FIELDS);
    await writeAuditEvent(db, {
      request: req,
      companyId,
      action: result.status === "created" ? "company_report_profile.created" : "company_report_profile.updated",
      entityType: "company_report_profile",
      entityId: companyId,
      metadata: { changedFields: fields, previousVersion: result.before.profileVersion, newVersion: result.profile.profileVersion },
    });
    res.json({ profile: result.profile, permissions: { canEdit: true }, isDefault: false });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.get("/company-report-settings/types", requireAuth, async (req, res) => {
  try {
    const { role } = req.user!;
    if (role === "user") {
      res.status(403).json({ error: "Bu işlem için yetkiniz yok" });
      return;
    }
    const companyId = resolveTargetCompanyId(req, res);
    if (companyId === undefined) return;
    if (!await ensureCompany(companyId)) {
      res.status(404).json({ error: "Firma bulunamadı" });
      return;
    }
    const overrides = await db.select({ reportType: companyReportTypeSettingsTable.reportType })
      .from(companyReportTypeSettingsTable)
      .where(eq(companyReportTypeSettingsTable.companyId, companyId));
    const overrideSet = new Set(overrides.map((item) => item.reportType));
    res.json({
      reportTypes: REPORT_TYPE_REGISTRY.map((definition) => ({
        code: definition.code,
        displayName: definition.displayName,
        defaultTitle: definition.defaultTitle,
        endpoint: definition.endpoint,
        outputType: definition.outputType,
        supportsCustomization: true,
        isCustomized: overrideSet.has(definition.code),
      })),
      permissions: { canEdit: role === "admin" || role === "superadmin" },
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.get("/company-report-settings/types/:reportType", requireAuth, async (req, res) => {
  try {
    const { role } = req.user!;
    if (role === "user") {
      res.status(403).json({ error: "Bu işlem için yetkiniz yok" });
      return;
    }
    const reportType = reportTypeFromParams(req.params.reportType);
    if (!reportType) {
      res.status(404).json({ error: "Rapor türü bulunamadı" });
      return;
    }
    const companyId = resolveTargetCompanyId(req, res);
    if (companyId === undefined) return;
    if (!await ensureCompany(companyId)) {
      res.status(404).json({ error: "Firma bulunamadı" });
      return;
    }
    const effective = await resolveEffectiveCompanyReportSettings({ companyId, reportType });
    res.json({ settings: effective, permissions: { canEdit: role === "admin" || role === "superadmin" }, isDefault: effective.typeSettingsVersion === 0 });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.patch("/company-report-settings/types/:reportType", requireAuth, async (req, res) => {
  try {
    const { role, userId } = req.user!;
    if (role !== "admin" && role !== "superadmin") {
      res.status(403).json({ error: "Bu işlem için yetkiniz yok" });
      return;
    }
    const reportType = reportTypeFromParams(req.params.reportType);
    if (!reportType) {
      res.status(404).json({ error: "Rapor türü bulunamadı" });
      return;
    }
    const companyId = resolveTargetCompanyId(req, res);
    if (companyId === undefined) return;
    const parsed = parseTypePatch(reportType, req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const result = await db.transaction(async (tx) => {
      const [company] = await tx.select({ id: companiesTable.id }).from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1).for("update");
      if (!company) return { status: "not-found" as const };
      const [existing] = await tx.select().from(companyReportTypeSettingsTable)
        .where(and(eq(companyReportTypeSettingsTable.companyId, companyId), eq(companyReportTypeSettingsTable.reportType, reportType)))
        .limit(1)
        .for("update");
      const previousVersion = existing?.typeSettingsVersion ?? VIRTUAL_DEFAULT_REPORT_TYPE_SETTINGS_VERSION;
      if (parsed.expectedTypeSettingsVersion !== previousVersion) return { status: "conflict" as const, previousVersion };
      const nextVersion = previousVersion + 1;
      const baseValues = {
        titleOverride: parsed.values.titleOverride,
        subtitleOverride: parsed.values.subtitleOverride,
        localeOverride: parsed.values.localeOverride,
        coverStyleOverride: parsed.values.coverStyleOverride,
        typeSettingsVersion: nextVersion,
        updatedAt: new Date(),
        updatedBy: userId,
      };
      const [saved] = existing
        ? await tx.update(companyReportTypeSettingsTable).set(baseValues).where(eq(companyReportTypeSettingsTable.id, existing.id)).returning()
        : await tx.insert(companyReportTypeSettingsTable).values({
            companyId,
            reportType,
            titleOverride: parsed.values.titleOverride ?? null,
            subtitleOverride: parsed.values.subtitleOverride ?? null,
            localeOverride: parsed.values.localeOverride ?? null,
            coverStyleOverride: parsed.values.coverStyleOverride ?? null,
            typeSettingsVersion: 1,
            updatedBy: userId,
          }).returning();
      await tx.delete(companyReportSectionSettingsTable)
        .where(and(eq(companyReportSectionSettingsTable.companyId, companyId), eq(companyReportSectionSettingsTable.reportType, reportType)));
      if (parsed.sections.length > 0) {
        await tx.insert(companyReportSectionSettingsTable).values(parsed.sections.map((section) => ({
          companyId,
          reportType,
          sectionCode: section.code,
          isVisible: section.isVisible,
          displayOrder: section.displayOrder,
          labelOverride: section.labelOverride,
          updatedBy: userId,
        })));
      }
      return { status: existing ? "updated" as const : "created" as const, previousVersion, saved };
    });
    if (result.status === "not-found") {
      res.status(404).json({ error: "Firma bulunamadı" });
      return;
    }
    if (result.status === "conflict") {
      res.status(409).json({ error: "Rapor türü ayarları başka bir işlem tarafından güncellendi", previousVersion: result.previousVersion });
      return;
    }
    await writeAuditEvent(db, {
      request: req,
      companyId,
      action: result.status === "created" ? "company_report_type_settings.created" : "company_report_type_settings.updated",
      entityType: "company_report_type_settings",
      entityId: `${companyId}:${reportType}`,
      metadata: {
        reportType,
        changedFields: Object.keys(parsed.values).filter((key) => parsed.values[key as keyof typeof parsed.values] !== undefined),
        changedSectionCodes: parsed.sections.map((section) => section.code),
        previousVersion: result.previousVersion,
        newVersion: result.saved.typeSettingsVersion,
      },
    });
    const effective = await resolveEffectiveCompanyReportSettings({ companyId, reportType });
    res.json({ settings: effective, permissions: { canEdit: true }, isDefault: false });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
