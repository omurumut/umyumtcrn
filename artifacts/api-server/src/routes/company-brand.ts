import { createHash, randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import multer from "multer";
import sharp from "sharp";
import type { Metadata, OutputInfo } from "sharp";
import { and, desc, eq, ne } from "drizzle-orm";
import {
  companiesTable,
  companyAssetsTable,
  companyBrandSettingsTable,
  db,
  type CompanyAsset,
  type CompanyBrandSettings,
} from "@workspace/db";
import {
  COMPANY_LOGO_MAX_BYTES,
  COMPANY_LOGO_MAX_HEIGHT,
  COMPANY_LOGO_MAX_PIXELS,
  COMPANY_LOGO_MAX_WIDTH,
  COMPANY_LOGO_MIME_TYPES,
  COMPANY_LOGO_NORMALIZED_MAX_HEIGHT,
  COMPANY_LOGO_NORMALIZED_MAX_WIDTH,
  COMPANY_LOGO_POSITIONS,
  COMPANY_LOGO_SIZES,
  DEFAULT_COMPANY_BRAND_SETTINGS,
  VIRTUAL_DEFAULT_BRAND_SETTINGS_VERSION,
  type CompanyBrandSettingsValues,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth.js";
import { writeAuditEvent } from "../lib/audit.js";
import { companyAssetStorage } from "../lib/company-asset-storage.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: COMPANY_LOGO_MAX_BYTES,
    files: 1,
    fields: 0,
  },
});

const BRAND_FIELDS = ["showLogoInReports", "logoAltText", "logoPosition", "logoSize"] as const;
type BrandField = typeof BRAND_FIELDS[number];
const allowedBrandPatchKeys = new Set<string>(["expectedBrandSettingsVersion", ...BRAND_FIELDS]);

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

  if (req.query.companyId !== undefined || (req.body && Object.prototype.hasOwnProperty.call(req.body, "companyId"))) {
    res.status(400).json({ error: "Firma kapsamı oturumdan alınır; companyId gönderilmemelidir" });
    return undefined;
  }
  return sessionCompanyId;
}

function detectImageMime(buffer: Buffer): "image/png" | "image/jpeg" | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}

function sanitizeOriginalFileName(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/[\r\n]/g, " ")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 180) : null;
}

function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function opaqueCompanySegment(companyId: number): string {
  return createHash("sha256").update(`company-assets:${companyId}`).digest("hex").slice(0, 24);
}

async function normalizeLogo(file: Express.Multer.File) {
  if (file.size <= 0 || file.buffer.length <= 0) {
    throw new Error("EMPTY_FILE");
  }
  if (!oneOf(file.mimetype, COMPANY_LOGO_MIME_TYPES)) {
    throw new Error("UNSUPPORTED_TYPE");
  }

  const detectedMime = detectImageMime(file.buffer);
  if (!detectedMime) throw new Error("UNSUPPORTED_TYPE");

  let metadata: Metadata;
  try {
    metadata = await sharp(file.buffer, { limitInputPixels: COMPANY_LOGO_MAX_PIXELS }).metadata();
  } catch {
    throw new Error("INVALID_IMAGE");
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width <= 0 || height <= 0) throw new Error("INVALID_IMAGE");
  if (width > COMPANY_LOGO_MAX_WIDTH || height > COMPANY_LOGO_MAX_HEIGHT || width * height > COMPANY_LOGO_MAX_PIXELS) {
    throw new Error("IMAGE_TOO_LARGE");
  }

  const pipeline = sharp(file.buffer, { limitInputPixels: COMPANY_LOGO_MAX_PIXELS })
    .rotate()
    .resize({
      width: COMPANY_LOGO_NORMALIZED_MAX_WIDTH,
      height: COMPANY_LOGO_NORMALIZED_MAX_HEIGHT,
      fit: "inside",
      withoutEnlargement: true,
    });

  let normalized: { data: Buffer; info: OutputInfo };
  try {
    normalized = detectedMime === "image/png"
      ? await pipeline.png().toBuffer({ resolveWithObject: true })
      : await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  } catch {
    throw new Error("INVALID_IMAGE");
  }

  const normalizedWidth = normalized.info.width;
  const normalizedHeight = normalized.info.height;
  if (normalized.data.length > COMPANY_LOGO_MAX_BYTES) {
    throw new Error("FILE_TOO_LARGE");
  }

  return {
    buffer: normalized.data,
    mimeType: detectedMime,
    width: normalizedWidth,
    height: normalizedHeight,
    fileSize: normalized.data.length,
    contentHash: hashBuffer(normalized.data),
  };
}

function parseBrandPatchBody(body: unknown): { ok: true; expectedVersion: number; values: Partial<CompanyBrandSettingsValues> } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Geçersiz kurumsal kimlik verisi" };
  }
  const input = body as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!allowedBrandPatchKeys.has(key)) return { ok: false, error: "Bilinmeyen kurumsal kimlik alanı gönderildi" };
  }
  if (typeof input.expectedBrandSettingsVersion !== "number" || !Number.isSafeInteger(input.expectedBrandSettingsVersion) || input.expectedBrandSettingsVersion < 0) {
    return { ok: false, error: "Geçerli expectedBrandSettingsVersion zorunludur" };
  }

  const values: Partial<CompanyBrandSettingsValues> = {};
  if (Object.prototype.hasOwnProperty.call(input, "showLogoInReports")) {
    if (typeof input.showLogoInReports !== "boolean") return { ok: false, error: "Rapor logo tercihi boolean olmalıdır" };
    values.showLogoInReports = input.showLogoInReports;
  }
  if (Object.prototype.hasOwnProperty.call(input, "logoAltText")) {
    if (typeof input.logoAltText !== "string") return { ok: false, error: "Logo alternatif metni metin olmalıdır" };
    const trimmed = input.logoAltText.trim();
    if (trimmed.length > 250) return { ok: false, error: "Logo alternatif metni 250 karakteri aşamaz" };
    values.logoAltText = trimmed.length > 0 ? trimmed : DEFAULT_COMPANY_BRAND_SETTINGS.logoAltText;
  }
  if (Object.prototype.hasOwnProperty.call(input, "logoPosition")) {
    if (!oneOf(input.logoPosition, COMPANY_LOGO_POSITIONS)) return { ok: false, error: "Geçersiz logo konumu" };
    values.logoPosition = input.logoPosition;
  }
  if (Object.prototype.hasOwnProperty.call(input, "logoSize")) {
    if (!oneOf(input.logoSize, COMPANY_LOGO_SIZES)) return { ok: false, error: "Geçersiz logo boyutu" };
    values.logoSize = input.logoSize;
  }
  if (Object.keys(values).length === 0) {
    return { ok: false, error: "Güncellenecek en az bir kurumsal kimlik alanı gönderilmelidir" };
  }
  return { ok: true, expectedVersion: input.expectedBrandSettingsVersion, values };
}

function serializeBrand(settings: CompanyBrandSettings | null, companyId: number, logo: Pick<CompanyAsset, "id" | "version"> | null) {
  const base = settings ? {
    companyId: settings.companyId,
    showLogoInReports: settings.showLogoInReports,
    logoAltText: settings.logoAltText,
    logoPosition: settings.logoPosition,
    logoSize: settings.logoSize,
    brandSettingsVersion: settings.brandSettingsVersion,
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt,
  } : {
    companyId,
    ...DEFAULT_COMPANY_BRAND_SETTINGS,
    brandSettingsVersion: VIRTUAL_DEFAULT_BRAND_SETTINGS_VERSION,
    createdAt: null,
    updatedAt: null,
  };
  return {
    ...base,
    hasLogo: Boolean(logo),
    logoAssetId: logo?.id ?? null,
    logoVersion: logo?.version ?? null,
  };
}

async function readActiveLogo(companyId: number) {
  const [logo] = await db.select()
    .from(companyAssetsTable)
    .where(and(
      eq(companyAssetsTable.companyId, companyId),
      eq(companyAssetsTable.assetType, "company_logo"),
      eq(companyAssetsTable.status, "active"),
    ))
    .orderBy(desc(companyAssetsTable.id))
    .limit(1);
  return logo ?? null;
}

async function ensureCompanyExists(companyId: number) {
  const [company] = await db.select({ id: companiesTable.id })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .limit(1);
  return Boolean(company);
}

function handleUploadError(error: unknown, res: Response): boolean {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") res.status(400).json({ error: "Logo dosyası izin verilen boyutu aşıyor." });
    else res.status(400).json({ error: "Logo yükleme formu geçersiz." });
    return true;
  }
  if (!(error instanceof Error)) return false;
  const statusByCode: Record<string, { status: number; error: string }> = {
    EMPTY_FILE: { status: 400, error: "Logo dosyası boş olamaz." },
    UNSUPPORTED_TYPE: { status: 400, error: "Yalnız PNG veya JPEG logo yükleyebilirsiniz." },
    INVALID_IMAGE: { status: 400, error: "Logo dosyası okunabilir bir PNG veya JPEG değil." },
    IMAGE_TOO_LARGE: { status: 400, error: "Logo görsel ölçüleri izin verilen sınırı aşıyor." },
    FILE_TOO_LARGE: { status: 400, error: "Logo dosyası izin verilen boyutu aşıyor." },
  };
  const mapped = statusByCode[error.message];
  if (!mapped) return false;
  res.status(mapped.status).json({ error: mapped.error });
  return true;
}

router.get("/company-brand", requireAuth, async (req, res) => {
  try {
    const { role } = req.user!;
    if (role === "user") {
      res.status(403).json({ error: "Bu işlem için yetkiniz yok" });
      return;
    }
    const targetCompanyId = resolveTargetCompanyId(req, res);
    if (targetCompanyId === undefined) return;
    if (!(await ensureCompanyExists(targetCompanyId))) {
      res.status(404).json({ error: "Firma bulunamadı" });
      return;
    }

    const [settings] = await db.select()
      .from(companyBrandSettingsTable)
      .where(eq(companyBrandSettingsTable.companyId, targetCompanyId))
      .limit(1);
    const logo = await readActiveLogo(targetCompanyId);
    res.json({
      brand: serializeBrand(settings ?? null, targetCompanyId, logo),
      permissions: { canEdit: role === "admin" || role === "superadmin", canManageLogo: role === "admin" || role === "superadmin" },
      isDefault: !settings,
    });
  } catch (error) {
    req.log.error(error);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.patch("/company-brand", requireAuth, async (req, res) => {
  try {
    const { role, userId } = req.user!;
    if (role !== "admin" && role !== "superadmin") {
      res.status(403).json({ error: "Bu işlem için yetkiniz yok" });
      return;
    }
    const targetCompanyId = resolveTargetCompanyId(req, res);
    if (targetCompanyId === undefined) return;

    const parsed = parseBrandPatchBody(req.body);
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
        .from(companyBrandSettingsTable)
        .where(eq(companyBrandSettingsTable.companyId, targetCompanyId))
        .limit(1)
        .for("update");
      const now = new Date();
      if (!existing) {
        if (parsed.expectedVersion !== VIRTUAL_DEFAULT_BRAND_SETTINGS_VERSION) return { status: "conflict" as const };
        const [created] = await tx.insert(companyBrandSettingsTable)
          .values({
            companyId: targetCompanyId,
            ...DEFAULT_COMPANY_BRAND_SETTINGS,
            ...parsed.values,
            brandSettingsVersion: 1,
            createdAt: now,
            updatedAt: now,
            updatedBy: userId,
          })
          .onConflictDoNothing({ target: companyBrandSettingsTable.companyId })
          .returning();
        if (!created) return { status: "conflict" as const };
        await writeAuditEvent(tx, {
          request: req,
          companyId: targetCompanyId,
          action: "company_brand_settings.created",
          entityType: "company_brand_settings",
          entityId: targetCompanyId,
          changes: { changedFields: Object.keys(parsed.values), previousVersion: 0, newVersion: 1 },
        });
        return { status: "ok" as const, settings: created };
      }

      if (existing.brandSettingsVersion !== parsed.expectedVersion) return { status: "conflict" as const, settings: existing };
      const before: CompanyBrandSettingsValues = {
        showLogoInReports: existing.showLogoInReports,
        logoAltText: existing.logoAltText,
        logoPosition: existing.logoPosition as CompanyBrandSettingsValues["logoPosition"],
        logoSize: existing.logoSize as CompanyBrandSettingsValues["logoSize"],
      };
      const after = { ...before, ...parsed.values };
      const changedFields = BRAND_FIELDS.filter((field) => before[field] !== after[field]);
      if (changedFields.length === 0) return { status: "ok" as const, settings: existing };

      const [updated] = await tx.update(companyBrandSettingsTable)
        .set({
          ...parsed.values,
          brandSettingsVersion: existing.brandSettingsVersion + 1,
          updatedAt: now,
          updatedBy: userId,
        })
        .where(eq(companyBrandSettingsTable.id, existing.id))
        .returning();
      if (!updated) return { status: "conflict" as const, settings: existing };
      await writeAuditEvent(tx, {
        request: req,
        companyId: targetCompanyId,
        action: "company_brand_settings.updated",
        entityType: "company_brand_settings",
        entityId: targetCompanyId,
        changes: { changedFields, previousVersion: existing.brandSettingsVersion, newVersion: updated.brandSettingsVersion },
      });
      return { status: "ok" as const, settings: updated };
    });

    if (result.status === "not-found") {
      res.status(404).json({ error: "Firma bulunamadı" });
      return;
    }
    if (result.status === "conflict") {
      const logo = await readActiveLogo(targetCompanyId);
      res.status(409).json({
        error: "Kurumsal kimlik ayarları başka bir oturum tarafından güncellendi. Güncel bilgileri yeniden yükleyin.",
        brand: result.settings ? serializeBrand(result.settings, targetCompanyId, logo) : undefined,
      });
      return;
    }
    const logo = await readActiveLogo(targetCompanyId);
    res.json({
      brand: serializeBrand(result.settings, targetCompanyId, logo),
      permissions: { canEdit: true, canManageLogo: true },
      isDefault: false,
    });
  } catch (error) {
    req.log.error(error);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.get("/company-brand/logo", requireAuth, async (req, res) => {
  try {
    const { role } = req.user!;
    if (role === "user") {
      res.status(403).json({ error: "Bu işlem için yetkiniz yok" });
      return;
    }
    const targetCompanyId = resolveTargetCompanyId(req, res);
    if (targetCompanyId === undefined) return;
    const logo = await readActiveLogo(targetCompanyId);
    if (!logo) {
      res.status(404).json({ error: "Aktif logo bulunamadı" });
      return;
    }
    const content = await companyAssetStorage.get(logo.storageKey);
    res.setHeader("Content-Type", logo.mimeType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("Content-Disposition", "inline");
    res.send(content);
  } catch (error) {
    req.log.error(error);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.post("/company-brand/logo", requireAuth, (req, res, next) => {
  const { role } = req.user!;
  if (role !== "admin" && role !== "superadmin") {
    res.status(403).json({ error: "Bu işlem için yetkiniz yok" });
    return;
  }
  if (role !== "superadmin" && req.query.companyId !== undefined) {
    res.status(400).json({ error: "Firma kapsamı oturumdan alınır; companyId gönderilmemelidir" });
    return;
  }
  upload.single("logo")(req, res, (error) => {
    if (error && handleUploadError(error, res)) return;
    next(error);
  });
}, async (req, res) => {
  let storageKey: string | null = null;
  try {
    const { userId } = req.user!;
    const targetCompanyId = resolveTargetCompanyId(req, res);
    if (targetCompanyId === undefined) return;
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Logo dosyası zorunludur" });
      return;
    }

    const normalized = await normalizeLogo(file);
    storageKey = `companies/${opaqueCompanySegment(targetCompanyId)}/assets/${randomUUID()}`;
    await companyAssetStorage.put({ key: storageKey, content: normalized.buffer });

    const result = await db.transaction(async (tx) => {
      const [company] = await tx.select({ id: companiesTable.id })
        .from(companiesTable)
        .where(eq(companiesTable.id, targetCompanyId))
        .limit(1)
        .for("update");
      if (!company) return { status: "not-found" as const };

      const [existing] = await tx.select()
        .from(companyAssetsTable)
        .where(and(
          eq(companyAssetsTable.companyId, targetCompanyId),
          eq(companyAssetsTable.assetType, "company_logo"),
          eq(companyAssetsTable.status, "active"),
        ))
        .limit(1)
        .for("update");
      const nextVersion = (existing?.version ?? 0) + 1;
      const now = new Date();
      if (existing) {
        await tx.update(companyAssetsTable)
          .set({ status: "replaced", updatedAt: now, updatedBy: userId })
          .where(eq(companyAssetsTable.id, existing.id));
      }
      const [created] = await tx.insert(companyAssetsTable)
        .values({
          companyId: targetCompanyId,
          assetType: "company_logo",
          storageProvider: companyAssetStorage.provider,
          storageKey: storageKey!,
          originalFileName: sanitizeOriginalFileName(file.originalname),
          mimeType: normalized.mimeType,
          fileSize: normalized.fileSize,
          width: normalized.width,
          height: normalized.height,
          contentHash: normalized.contentHash,
          status: "active",
          version: nextVersion,
          createdAt: now,
          updatedAt: now,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning();

      await writeAuditEvent(tx, {
        request: req,
        companyId: targetCompanyId,
        action: existing ? "company_logo.replaced" : "company_logo.uploaded",
        entityType: "company_asset",
        entityId: created.id,
        changes: { previousAssetId: existing?.id ?? null, newAssetId: created.id, version: created.version },
        metadata: {
          mimeType: created.mimeType,
          fileSize: created.fileSize,
          width: created.width,
          height: created.height,
          digestPrefix: created.contentHash.slice(0, 12),
        },
      });
      return { status: "ok" as const, asset: created };
    });

    if (result.status === "not-found") {
      if (storageKey) await companyAssetStorage.delete(storageKey);
      res.status(404).json({ error: "Firma bulunamadı" });
      return;
    }

    res.status(201).json({
      logo: {
        id: result.asset.id,
        mimeType: result.asset.mimeType,
        fileSize: result.asset.fileSize,
        width: result.asset.width,
        height: result.asset.height,
        version: result.asset.version,
        contentHashPrefix: result.asset.contentHash.slice(0, 12),
      },
    });
  } catch (error) {
    if (storageKey) {
      try {
        await companyAssetStorage.delete(storageKey);
      } catch (cleanupError) {
        req.log.error(cleanupError);
      }
    }
    if (handleUploadError(error, res)) return;
    req.log.error(error);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.delete("/company-brand/logo", requireAuth, async (req, res) => {
  try {
    const { role, userId } = req.user!;
    if (role !== "admin" && role !== "superadmin") {
      res.status(403).json({ error: "Bu işlem için yetkiniz yok" });
      return;
    }
    const targetCompanyId = resolveTargetCompanyId(req, res);
    if (targetCompanyId === undefined) return;

    const result = await db.transaction(async (tx) => {
      const [company] = await tx.select({ id: companiesTable.id })
        .from(companiesTable)
        .where(eq(companiesTable.id, targetCompanyId))
        .limit(1)
        .for("update");
      if (!company) return "not-found" as const;
      const [existing] = await tx.select()
        .from(companyAssetsTable)
        .where(and(
          eq(companyAssetsTable.companyId, targetCompanyId),
          eq(companyAssetsTable.assetType, "company_logo"),
          eq(companyAssetsTable.status, "active"),
        ))
        .limit(1)
        .for("update");
      if (!existing) return "deleted" as const;
      await tx.update(companyAssetsTable)
        .set({ status: "deleted", updatedAt: new Date(), updatedBy: userId })
        .where(and(eq(companyAssetsTable.id, existing.id), ne(companyAssetsTable.status, "deleted")));
      await writeAuditEvent(tx, {
        request: req,
        companyId: targetCompanyId,
        action: "company_logo.deleted",
        entityType: "company_asset",
        entityId: existing.id,
        changes: { assetId: existing.id, previousStatus: existing.status, newStatus: "deleted", version: existing.version },
      });
      return "deleted" as const;
    });

    if (result === "not-found") {
      res.status(404).json({ error: "Firma bulunamadı" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    req.log.error(error);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
