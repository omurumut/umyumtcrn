import { Router } from "express";
import type { Response } from "express";
import {
  db,
  companiesTable,
  usersTable,
  unitsTable,
  subUnitsTable,
  energySourcesTable,
  energyUseGroupsTable,
  metersTable,
  consumptionTable,
  weatherTable,
  swotTable,
  risksTable,
  riskNotesTable,
  seuTable,
  seuAssessmentsTable,
  seuAssessmentItemsTable,
  energyTargetsTable,
  energyActionPlansTable,
  energyTargetProgressTable,
  vapProjectsTable,
  energyReviewRecordsTable,
  variablesTable,
  variableValuesTable,
  weatherDegreeDaysTable,
  energyPerformanceIndicatorsTable,
  energyBaselinesTable,
  energyBaselineVariablesTable,
  energyPerformanceResultsTable,
  reportsTable,
  companySettingsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireSuperAdmin } from "../middlewares/auth.js";

const router = Router();

class InvalidCompanyIdError extends Error {}

function parsePositiveInteger(value: unknown, field = "companyId"): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new InvalidCompanyIdError(`Geçersiz ${field}`);
}

function parseRequiredCompanyId(value: unknown): number {
  const parsed = parsePositiveInteger(value);
  if (parsed === undefined) throw new InvalidCompanyIdError("Geçersiz companyId");
  return parsed;
}

function handleInvalidCompanyId(res: Response, err: unknown) {
  if (!(err instanceof InvalidCompanyIdError)) return false;
  res.status(400).json({ error: err.message });
  return true;
}

function normalizeRequiredText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function isUniqueViolation(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (candidate.code === "23505") return true;
    current = candidate.cause;
  }
  return false;
}

router.get("/companies", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const companies = await db.select().from(companiesTable).orderBy(companiesTable.id);
    res.json(companies);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.post("/companies", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { name, subdomain, isActive } = req.body;
    const normalizedName = normalizeRequiredText(name);
    const normalizedSubdomain = normalizeRequiredText(subdomain);
    if (normalizedName === undefined || normalizedSubdomain === undefined) {
      res.status(400).json({ error: "Firma adı ve subdomain zorunludur" });
      return;
    }
    const [company] = await db.insert(companiesTable).values({
      name: normalizedName,
      subdomain: normalizedSubdomain.toLowerCase(),
      isActive: isActive !== false,
    }).returning();
    res.status(201).json(company);
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      res.status(400).json({ error: "Bu subdomain zaten kullanılıyor" });
      return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.patch("/companies/:id", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const id = parseRequiredCompanyId(req.params.id);
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "companyId")) {
      const bodyCompanyId = parsePositiveInteger(req.body.companyId);
      if (bodyCompanyId === undefined) throw new InvalidCompanyIdError("Geçersiz companyId");
    }
    const [existing] = await db.select({ id: companiesTable.id })
      .from(companiesTable)
      .where(eq(companiesTable.id, id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Firma bulunamadı" });
      return;
    }
    const { name, subdomain, isActive } = req.body;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) {
      const normalizedName = normalizeRequiredText(name);
      if (normalizedName === undefined) { res.status(400).json({ error: "Firma adı boş olamaz" }); return; }
      updates.name = normalizedName;
    }
    if (subdomain !== undefined) {
      const normalizedSubdomain = normalizeRequiredText(subdomain);
      if (normalizedSubdomain === undefined) { res.status(400).json({ error: "Subdomain boş olamaz" }); return; }
      updates.subdomain = normalizedSubdomain.toLowerCase();
    }
    if (isActive !== undefined) updates.isActive = Boolean(isActive);
    const [company] = await db.update(companiesTable).set(updates).where(eq(companiesTable.id, id)).returning();
    if (!company) {
      res.status(404).json({ error: "Firma bulunamadı" });
      return;
    }
    res.json(company);
  } catch (err: unknown) {
    if (handleInvalidCompanyId(res, err)) return;
    if (isUniqueViolation(err)) {
      res.status(400).json({ error: "Bu subdomain zaten kullanılıyor" });
      return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.delete("/companies/:id", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const id = parseRequiredCompanyId(req.params.id);
    const deleteResult = await db.transaction(async (tx) => {
      const [company] = await tx.select({ id: companiesTable.id })
        .from(companiesTable)
        .where(eq(companiesTable.id, id))
        .limit(1)
        .for("update");
      if (!company) return "not_found" as const;

      const directChecks: Array<() => Promise<Array<{ id: number }>>> = [
        async () => tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.companyId, id)).limit(1),
        async () => tx.select({ id: unitsTable.id }).from(unitsTable).where(eq(unitsTable.companyId, id)).limit(1),
        async () => tx.select({ id: subUnitsTable.id }).from(subUnitsTable).where(eq(subUnitsTable.companyId, id)).limit(1),
        async () => tx.select({ id: energySourcesTable.id }).from(energySourcesTable).where(eq(energySourcesTable.companyId, id)).limit(1),
        async () => tx.select({ id: energyUseGroupsTable.id }).from(energyUseGroupsTable).where(eq(energyUseGroupsTable.companyId, id)).limit(1),
        async () => tx.select({ id: metersTable.id }).from(metersTable).where(eq(metersTable.companyId, id)).limit(1),
        async () => tx.select({ id: consumptionTable.id }).from(consumptionTable).where(eq(consumptionTable.companyId, id)).limit(1),
        async () => tx.select({ id: weatherTable.id }).from(weatherTable).where(eq(weatherTable.companyId, id)).limit(1),
        async () => tx.select({ id: swotTable.id }).from(swotTable).where(eq(swotTable.companyId, id)).limit(1),
        async () => tx.select({ id: risksTable.id }).from(risksTable).where(eq(risksTable.companyId, id)).limit(1),
        async () => tx.select({ id: riskNotesTable.id }).from(riskNotesTable).where(eq(riskNotesTable.companyId, id)).limit(1),
        async () => tx.select({ id: seuTable.id }).from(seuTable).where(eq(seuTable.companyId, id)).limit(1),
        async () => tx.select({ id: seuAssessmentsTable.id }).from(seuAssessmentsTable).where(eq(seuAssessmentsTable.companyId, id)).limit(1),
        async () => tx.select({ id: energyTargetsTable.id }).from(energyTargetsTable).where(eq(energyTargetsTable.companyId, id)).limit(1),
        async () => tx.select({ id: energyActionPlansTable.id }).from(energyActionPlansTable).where(eq(energyActionPlansTable.companyId, id)).limit(1),
        async () => tx.select({ id: energyTargetProgressTable.id }).from(energyTargetProgressTable).where(eq(energyTargetProgressTable.companyId, id)).limit(1),
        async () => tx.select({ id: vapProjectsTable.id }).from(vapProjectsTable).where(eq(vapProjectsTable.companyId, id)).limit(1),
        async () => tx.select({ id: energyReviewRecordsTable.id }).from(energyReviewRecordsTable).where(eq(energyReviewRecordsTable.companyId, id)).limit(1),
        async () => tx.select({ id: variablesTable.id }).from(variablesTable).where(eq(variablesTable.companyId, id)).limit(1),
        async () => tx.select({ id: variableValuesTable.id }).from(variableValuesTable).where(eq(variableValuesTable.companyId, id)).limit(1),
        async () => tx.select({ id: weatherDegreeDaysTable.id }).from(weatherDegreeDaysTable).where(eq(weatherDegreeDaysTable.companyId, id)).limit(1),
        async () => tx.select({ id: energyPerformanceIndicatorsTable.id }).from(energyPerformanceIndicatorsTable).where(eq(energyPerformanceIndicatorsTable.companyId, id)).limit(1),
        async () => tx.select({ id: energyBaselinesTable.id }).from(energyBaselinesTable).where(eq(energyBaselinesTable.companyId, id)).limit(1),
        async () => tx.select({ id: energyPerformanceResultsTable.id }).from(energyPerformanceResultsTable).where(eq(energyPerformanceResultsTable.companyId, id)).limit(1),
        async () => tx.select({ id: reportsTable.id }).from(reportsTable).where(eq(reportsTable.companyId, id)).limit(1),
        async () => tx.select({ id: companySettingsTable.id }).from(companySettingsTable).where(eq(companySettingsTable.companyId, id)).limit(1),
      ];
      for (const check of directChecks) {
        if ((await check()).length > 0) return "dependent" as const;
      }

      const [assessmentItem] = await tx.select({ id: seuAssessmentItemsTable.id })
        .from(seuAssessmentItemsTable)
        .innerJoin(seuAssessmentsTable, eq(seuAssessmentItemsTable.assessmentId, seuAssessmentsTable.id))
        .where(eq(seuAssessmentsTable.companyId, id))
        .limit(1);
      if (assessmentItem) return "dependent" as const;

      const [baselineVariable] = await tx.select({ id: energyBaselineVariablesTable.id })
        .from(energyBaselineVariablesTable)
        .innerJoin(energyBaselinesTable, eq(energyBaselineVariablesTable.baselineId, energyBaselinesTable.id))
        .where(eq(energyBaselinesTable.companyId, id))
        .limit(1);
      if (baselineVariable) return "dependent" as const;

      if (id === 1) return "protected" as const;

      const [deleted] = await tx.delete(companiesTable)
        .where(eq(companiesTable.id, id))
        .returning({ id: companiesTable.id });
      return deleted ? "deleted" as const : "not_found" as const;
    });

    if (deleteResult === "not_found") {
      res.status(404).json({ error: "Firma bulunamadı" });
      return;
    }
    if (deleteResult === "dependent") {
      res.status(409).json({ error: "Bu şirkete bağlı kayıtlar bulunduğu için silinemez." });
      return;
    }
    if (deleteResult === "protected") {
      res.status(400).json({ error: "Varsayılan firma silinemez" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    if (handleInvalidCompanyId(res, err)) return;
    if (err && typeof err === "object" && "code" in err && err.code === "23503") {
      res.status(409).json({ error: "Bu şirkete bağlı kayıtlar bulunduğu için silinemez." });
      return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
