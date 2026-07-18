import { Router, type Request, type Response } from "express";
import { companiesTable, db } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import { changedAuditFields, writeAuditEvent } from "../lib/audit.js";

const router = Router();

const PROFILE_FIELDS = [
  "legalName",
  "shortName",
  "address",
  "phone",
  "email",
  "website",
  "taxOffice",
  "taxNumber",
  "industry",
  "reportIntroduction",
] as const;

type ProfileField = typeof PROFILE_FIELDS[number];

const fieldLimits: Record<ProfileField, number> = {
  legalName: 250,
  shortName: 100,
  address: 1000,
  phone: 50,
  email: 254,
  website: 500,
  taxOffice: 150,
  taxNumber: 50,
  industry: 250,
  reportIntroduction: 5000,
};

const allowedUpdateKeys = new Set<string>(["expectedProfileVersion", ...PROFILE_FIELDS]);

type ParsedUpdate = {
  expectedProfileVersion: number;
  updatePayload: Partial<Record<ProfileField, string | null>>;
};

function parseUpdateBody(body: unknown): { ok: true; data: ParsedUpdate } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Geçersiz firma profili verisi" };
  }

  const input = body as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!allowedUpdateKeys.has(key)) return { ok: false, error: "Bilinmeyen firma profili alanı gönderildi" };
  }

  const expectedProfileVersion = input.expectedProfileVersion;
  if (typeof expectedProfileVersion !== "number" || !Number.isSafeInteger(expectedProfileVersion) || expectedProfileVersion <= 0) {
    return { ok: false, error: "Geçerli expectedProfileVersion zorunludur" };
  }

  const updatePayload: Partial<Record<ProfileField, string | null>> = {};
  for (const field of PROFILE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) continue;
    const value = input[field];
    if (value === null) {
      updatePayload[field] = null;
      continue;
    }
    if (typeof value !== "string") return { ok: false, error: "Firma profili alanları metin veya null olmalıdır" };
    if (value.length > fieldLimits[field]) return { ok: false, error: `${fieldLimits[field]} karakter sınırı aşıldı` };
    const trimmed = value.trim();
    updatePayload[field] = trimmed.length === 0 ? null : trimmed;
  }

  if (updatePayload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updatePayload.email)) {
    return { ok: false, error: "Geçerli bir e-posta adresi girin" };
  }
  if (updatePayload.website) {
    try {
      const parsedUrl = new URL(updatePayload.website);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        return { ok: false, error: "Web sitesi http:// veya https:// ile başlamalıdır" };
      }
    } catch {
      return { ok: false, error: "Web sitesi http:// veya https:// ile başlamalıdır" };
    }
  }

  return { ok: true, data: { expectedProfileVersion, updatePayload } };
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
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

function serializeCompany(company: {
  id: number;
  name: string;
  subdomain: string;
  legalName: string | null;
  shortName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  taxOffice: string | null;
  taxNumber: string | null;
  industry: string | null;
  reportIntroduction: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date | null;
  profileVersion: number;
}) {
  return {
    id: company.id,
    name: company.name,
    subdomain: company.subdomain,
    legalName: company.legalName,
    shortName: company.shortName,
    address: company.address,
    phone: company.phone,
    email: company.email,
    website: company.website,
    taxOffice: company.taxOffice,
    taxNumber: company.taxNumber,
    industry: company.industry,
    reportIntroduction: company.reportIntroduction,
    isActive: company.isActive,
    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
    profileVersion: company.profileVersion,
  };
}

const companySelect = {
  id: companiesTable.id,
  name: companiesTable.name,
  subdomain: companiesTable.subdomain,
  legalName: companiesTable.legalName,
  shortName: companiesTable.shortName,
  address: companiesTable.address,
  phone: companiesTable.phone,
  email: companiesTable.email,
  website: companiesTable.website,
  taxOffice: companiesTable.taxOffice,
  taxNumber: companiesTable.taxNumber,
  industry: companiesTable.industry,
  reportIntroduction: companiesTable.reportIntroduction,
  isActive: companiesTable.isActive,
  createdAt: companiesTable.createdAt,
  updatedAt: companiesTable.updatedAt,
  profileVersion: companiesTable.profileVersion,
};

router.get("/company-profile", requireAuth, async (req, res) => {
  try {
    const { role } = req.user!;

    if (role === "user") {
      res.status(403).json({ error: "Bu işlem için yetkiniz yok" });
      return;
    }

    const targetCompanyId = resolveTargetCompanyId(req, res);
    if (targetCompanyId === undefined) return;

    const [company] = await db.select(companySelect)
      .from(companiesTable)
      .where(eq(companiesTable.id, targetCompanyId))
      .limit(1);

    if (!company) {
      res.status(404).json({ error: "Firma bulunamadı" });
      return;
    }

    res.json({
      company: serializeCompany(company),
      permissions: {
        canEditGeneral: role === "admin" || role === "superadmin",
      },
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.patch("/company-profile", requireAuth, async (req, res) => {
  try {
    const { role } = req.user!;

    if (role !== "admin" && role !== "superadmin") {
      res.status(403).json({ error: "Bu işlem için yetkiniz yok" });
      return;
    }

    const targetCompanyId = resolveTargetCompanyId(req, res);
    if (targetCompanyId === undefined) return;

    const parsed = parseUpdateBody(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const { expectedProfileVersion, updatePayload } = parsed.data;
    if (Object.keys(updatePayload).length === 0) {
      res.status(400).json({ error: "Güncellenecek en az bir firma profili alanı gönderilmelidir" });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [existing] = await tx.select(companySelect)
        .from(companiesTable)
        .where(eq(companiesTable.id, targetCompanyId))
        .limit(1)
        .for("update");

      if (!existing) return { status: "not-found" as const };
      if (existing.profileVersion !== expectedProfileVersion) {
        return { status: "conflict" as const, company: existing };
      }

      const nextCompany = {
        ...existing,
        ...updatePayload,
        updatedAt: new Date(),
        profileVersion: existing.profileVersion + 1,
      };
      const changedFields = Object.keys(changedAuditFields(existing, nextCompany, [...PROFILE_FIELDS]));

      if (changedFields.length === 0) {
        return { status: "ok" as const, company: existing, changedFields };
      }

      const [updated] = await tx.update(companiesTable)
        .set({
          ...updatePayload,
          updatedAt: nextCompany.updatedAt,
          profileVersion: nextCompany.profileVersion,
        })
        .where(and(
          eq(companiesTable.id, targetCompanyId),
          eq(companiesTable.profileVersion, expectedProfileVersion),
        ))
        .returning(companySelect);

      if (!updated) return { status: "conflict" as const, company: existing };

      await writeAuditEvent(tx, {
        request: req,
        companyId: targetCompanyId,
        action: "company_profile.updated",
        entityType: "company_profile",
        entityId: targetCompanyId,
        changes: {
          changedFields,
          previousProfileVersion: existing.profileVersion,
          newProfileVersion: updated.profileVersion,
        },
      });

      return { status: "ok" as const, company: updated, changedFields };
    });

    if (result.status === "not-found") {
      res.status(404).json({ error: "Firma bulunamadı" });
      return;
    }
    if (result.status === "conflict") {
      res.status(409).json({
        error: "Firma profili başka bir oturum tarafından güncellendi. Lütfen güncel bilgileri yeniden yükleyin.",
        company: serializeCompany(result.company),
      });
      return;
    }

    res.json({
      company: serializeCompany(result.company),
      permissions: {
        canEditGeneral: true,
      },
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
