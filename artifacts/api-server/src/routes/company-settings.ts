import { Router, type Request, type Response } from "express";
import {
  companiesTable,
  companySettingsTable,
  db,
} from "@workspace/db";
import {
  COMPANY_CO2_DISPLAY_MODES,
  COMPANY_CURRENCIES,
  COMPANY_DATE_FORMATS,
  COMPANY_DECIMAL_SEPARATORS,
  COMPANY_ENERGY_DISPLAY_UNITS,
  COMPANY_LOCALES,
  COMPANY_TEP_DISPLAY_MODES,
  DEFAULT_COMPANY_SETTINGS,
  VIRTUAL_DEFAULT_SETTINGS_VERSION,
  type CompanySettingsValues,
} from "@workspace/api-zod";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import { writeAuditEvent } from "../lib/audit.js";

const router = Router();

const SETTINGS_FIELDS = [
  "defaultLocale",
  "defaultCurrency",
  "fiscalYearStartMonth",
  "dateFormat",
  "decimalSeparator",
  "energyDisplayUnit",
  "tepDisplayMode",
  "co2DisplayMode",
] as const;

type SettingsField = typeof SETTINGS_FIELDS[number];

const allowedPatchKeys = new Set<string>(["expectedSettingsVersion", ...SETTINGS_FIELDS]);

type ParsedPatch = {
  expectedSettingsVersion: number;
  values: Partial<CompanySettingsValues>;
};

function parsePositiveInteger(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
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
    const parsedCompanyId = parsePositiveInteger(req.query.companyId);
    if (parsedCompanyId === undefined) {
      res.status(400).json({ error: "Geçerli companyId zorunludur" });
      return undefined;
    }
    return parsedCompanyId;
  }

  if (req.query.companyId !== undefined && req.query.companyId !== null) {
    res.status(400).json({ error: "Firma kapsamı oturumdan alınır; companyId gönderilmemelidir" });
    return undefined;
  }
  return sessionCompanyId;
}

function parsePatchBody(body: unknown): { ok: true; data: ParsedPatch } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Geçersiz firma tercihleri verisi" };
  }

  const input = body as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!allowedPatchKeys.has(key)) return { ok: false, error: "Bilinmeyen firma tercihi alanı gönderildi" };
  }

  const expectedSettingsVersion = input.expectedSettingsVersion;
  if (typeof expectedSettingsVersion !== "number" || !Number.isSafeInteger(expectedSettingsVersion) || expectedSettingsVersion < 0) {
    return { ok: false, error: "Geçerli expectedSettingsVersion zorunludur" };
  }

  const values: Partial<CompanySettingsValues> = {};
  if (Object.prototype.hasOwnProperty.call(input, "defaultLocale")) {
    if (!oneOf(input.defaultLocale, COMPANY_LOCALES)) return { ok: false, error: "Geçersiz dil/bölge tercihi" };
    values.defaultLocale = input.defaultLocale;
  }
  if (Object.prototype.hasOwnProperty.call(input, "defaultCurrency")) {
    if (!oneOf(input.defaultCurrency, COMPANY_CURRENCIES)) return { ok: false, error: "Geçersiz para birimi" };
    values.defaultCurrency = input.defaultCurrency;
  }
  if (Object.prototype.hasOwnProperty.call(input, "fiscalYearStartMonth")) {
    if (typeof input.fiscalYearStartMonth !== "number" || !Number.isSafeInteger(input.fiscalYearStartMonth) || input.fiscalYearStartMonth < 1 || input.fiscalYearStartMonth > 12) {
      return { ok: false, error: "Mali yıl başlangıç ayı 1-12 arasında olmalıdır" };
    }
    values.fiscalYearStartMonth = input.fiscalYearStartMonth;
  }
  if (Object.prototype.hasOwnProperty.call(input, "dateFormat")) {
    if (!oneOf(input.dateFormat, COMPANY_DATE_FORMATS)) return { ok: false, error: "Geçersiz tarih biçimi" };
    values.dateFormat = input.dateFormat;
  }
  if (Object.prototype.hasOwnProperty.call(input, "decimalSeparator")) {
    if (!oneOf(input.decimalSeparator, COMPANY_DECIMAL_SEPARATORS)) return { ok: false, error: "Geçersiz ondalık ayırıcı" };
    values.decimalSeparator = input.decimalSeparator;
  }
  if (Object.prototype.hasOwnProperty.call(input, "energyDisplayUnit")) {
    if (!oneOf(input.energyDisplayUnit, COMPANY_ENERGY_DISPLAY_UNITS)) return { ok: false, error: "Geçersiz enerji gösterim birimi" };
    values.energyDisplayUnit = input.energyDisplayUnit;
  }
  if (Object.prototype.hasOwnProperty.call(input, "tepDisplayMode")) {
    if (!oneOf(input.tepDisplayMode, COMPANY_TEP_DISPLAY_MODES)) return { ok: false, error: "Geçersiz TEP gösterim tercihi" };
    values.tepDisplayMode = input.tepDisplayMode;
  }
  if (Object.prototype.hasOwnProperty.call(input, "co2DisplayMode")) {
    if (!oneOf(input.co2DisplayMode, COMPANY_CO2_DISPLAY_MODES)) return { ok: false, error: "Geçersiz CO2 gösterim tercihi" };
    values.co2DisplayMode = input.co2DisplayMode;
  }

  if (Object.keys(values).length === 0) {
    return { ok: false, error: "Güncellenecek en az bir firma tercihi gönderilmelidir" };
  }

  return { ok: true, data: { expectedSettingsVersion, values } };
}

const settingsSelect = {
  companyId: companySettingsTable.companyId,
  defaultLocale: companySettingsTable.defaultLocale,
  defaultCurrency: companySettingsTable.defaultCurrency,
  fiscalYearStartMonth: companySettingsTable.fiscalYearStartMonth,
  dateFormat: companySettingsTable.dateFormat,
  decimalSeparator: companySettingsTable.decimalSeparator,
  energyDisplayUnit: companySettingsTable.energyDisplayUnit,
  tepDisplayMode: companySettingsTable.tepDisplayMode,
  co2DisplayMode: companySettingsTable.co2DisplayMode,
  settingsVersion: companySettingsTable.settingsVersion,
  createdAt: companySettingsTable.createdAt,
  updatedAt: companySettingsTable.updatedAt,
};

type SettingsSource = {
  companyId: number;
  defaultLocale: string;
  defaultCurrency: string;
  fiscalYearStartMonth: number;
  dateFormat: string;
  decimalSeparator: string;
  energyDisplayUnit: string;
  tepDisplayMode: string;
  co2DisplayMode: string;
  settingsVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

function serializeSettings(settings: SettingsSource | null, companyId: number) {
  if (!settings) {
    return {
      ...DEFAULT_COMPANY_SETTINGS,
      companyId,
      settingsVersion: VIRTUAL_DEFAULT_SETTINGS_VERSION,
      createdAt: null,
      updatedAt: null,
    };
  }
  return {
    companyId: settings.companyId,
    defaultLocale: settings.defaultLocale,
    defaultCurrency: settings.defaultCurrency,
    fiscalYearStartMonth: settings.fiscalYearStartMonth,
    dateFormat: settings.dateFormat,
    decimalSeparator: settings.decimalSeparator,
    energyDisplayUnit: settings.energyDisplayUnit,
    tepDisplayMode: settings.tepDisplayMode,
    co2DisplayMode: settings.co2DisplayMode,
    settingsVersion: settings.settingsVersion,
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt,
  };
}

function changedFields(before: CompanySettingsValues, after: CompanySettingsValues) {
  return SETTINGS_FIELDS.filter((field) => before[field] !== after[field]);
}

router.get("/company-settings", requireAuth, async (req, res) => {
  try {
    const { role } = req.user!;
    if (role === "user") {
      res.status(403).json({ error: "Bu işlem için yetkiniz yok" });
      return;
    }

    const targetCompanyId = resolveTargetCompanyId(req, res);
    if (targetCompanyId === undefined) return;

    const [company] = await db.select({ id: companiesTable.id })
      .from(companiesTable)
      .where(eq(companiesTable.id, targetCompanyId))
      .limit(1);
    if (!company) {
      res.status(404).json({ error: "Firma bulunamadı" });
      return;
    }

    const [settings] = await db.select(settingsSelect)
      .from(companySettingsTable)
      .where(eq(companySettingsTable.companyId, targetCompanyId))
      .limit(1);

    res.json({
      settings: serializeSettings(settings ?? null, targetCompanyId),
      permissions: { canEdit: role === "admin" || role === "superadmin" },
      isDefault: !settings,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.patch("/company-settings", requireAuth, async (req, res) => {
  try {
    const { role, userId } = req.user!;
    if (role !== "admin" && role !== "superadmin") {
      res.status(403).json({ error: "Bu işlem için yetkiniz yok" });
      return;
    }

    const targetCompanyId = resolveTargetCompanyId(req, res);
    if (targetCompanyId === undefined) return;

    const parsed = parsePatchBody(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [company] = await tx.select({ id: companiesTable.id })
        .from(companiesTable)
        .where(eq(companiesTable.id, targetCompanyId))
        .limit(1)
        .for("update");
      if (!company) return { status: "not-found" as const };

      const [existing] = await tx.select()
        .from(companySettingsTable)
        .where(eq(companySettingsTable.companyId, targetCompanyId))
        .limit(1)
        .for("update");

      const now = new Date();
      if (!existing) {
        if (parsed.data.expectedSettingsVersion !== VIRTUAL_DEFAULT_SETTINGS_VERSION) {
          return { status: "conflict" as const };
        }
        const values = {
          ...DEFAULT_COMPANY_SETTINGS,
          ...parsed.data.values,
        };
        const [created] = await tx.insert(companySettingsTable)
          .values({
            companyId: targetCompanyId,
            ...values,
            settingsVersion: 1,
            createdAt: now,
            updatedAt: now,
            updatedBy: userId,
          })
          .onConflictDoNothing({ target: companySettingsTable.companyId })
          .returning();

        if (!created) return { status: "conflict" as const };

        await writeAuditEvent(tx, {
          request: req,
          companyId: targetCompanyId,
          action: "company_settings.created",
          entityType: "company_settings",
          entityId: targetCompanyId,
          changes: {
            changedFields: Object.keys(parsed.data.values),
            previousVersion: VIRTUAL_DEFAULT_SETTINGS_VERSION,
            newVersion: created.settingsVersion,
            usedDefaults: true,
          },
        });
        return { status: "ok" as const, settings: created, isDefault: false };
      }

      if (existing.settingsVersion !== parsed.data.expectedSettingsVersion) {
        return { status: "conflict" as const, settings: existing };
      }

      const before: CompanySettingsValues = {
        defaultLocale: existing.defaultLocale as CompanySettingsValues["defaultLocale"],
        defaultCurrency: existing.defaultCurrency as CompanySettingsValues["defaultCurrency"],
        fiscalYearStartMonth: existing.fiscalYearStartMonth,
        dateFormat: existing.dateFormat as CompanySettingsValues["dateFormat"],
        decimalSeparator: existing.decimalSeparator as CompanySettingsValues["decimalSeparator"],
        energyDisplayUnit: existing.energyDisplayUnit as CompanySettingsValues["energyDisplayUnit"],
        tepDisplayMode: existing.tepDisplayMode as CompanySettingsValues["tepDisplayMode"],
        co2DisplayMode: existing.co2DisplayMode as CompanySettingsValues["co2DisplayMode"],
      };
      const after = { ...before, ...parsed.data.values };
      const fields = changedFields(before, after);
      if (fields.length === 0) return { status: "ok" as const, settings: existing, isDefault: false };

      const [updated] = await tx.update(companySettingsTable)
        .set({
          ...parsed.data.values,
          settingsVersion: existing.settingsVersion + 1,
          updatedAt: now,
          updatedBy: userId,
        })
        .where(eq(companySettingsTable.id, existing.id))
        .returning();

      if (!updated) return { status: "conflict" as const, settings: existing };

      await writeAuditEvent(tx, {
        request: req,
        companyId: targetCompanyId,
        action: "company_settings.updated",
        entityType: "company_settings",
        entityId: targetCompanyId,
        changes: {
          changedFields: fields,
          previousVersion: existing.settingsVersion,
          newVersion: updated.settingsVersion,
          usedDefaults: false,
        },
      });
      return { status: "ok" as const, settings: updated, isDefault: false };
    });

    if (result.status === "not-found") {
      res.status(404).json({ error: "Firma bulunamadı" });
      return;
    }
    if (result.status === "conflict") {
      res.status(409).json({
        error: "Firma tercihleri başka bir kullanıcı tarafından güncellendi. Güncel ayarları yeniden yükleyin.",
        settings: result.settings ? serializeSettings(result.settings, targetCompanyId) : undefined,
      });
      return;
    }

    res.json({
      settings: serializeSettings(result.settings, targetCompanyId),
      permissions: { canEdit: true },
      isDefault: result.isDefault,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
