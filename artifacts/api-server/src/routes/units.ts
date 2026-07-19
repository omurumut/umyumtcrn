import { Router } from "express";
import {
  db, unitsTable, companiesTable, usersTable, subUnitsTable, energySourcesTable,
  energyUseGroupsTable, metersTable, consumptionTable, swotTable, risksTable,
  seuTable, seuAssessmentsTable, seuAssessmentItemsTable, energyTargetsTable,
  energyReviewRecordsTable, variableValuesTable, energyPerformanceIndicatorsTable,
  energyBaselinesTable, energyPerformanceResultsTable, reportsTable,
  unitTechnicalProfilesTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireCompanyAdmin } from "../middlewares/auth.js";

const router = Router();

function isCompanyAdmin(role: string) { return role === "admin" || role === "kontrol_admin"; }
function isSuperAdmin(role: string) { return role === "superadmin"; }
function parsePositiveInteger(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value); if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function normalizeRequiredText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

async function companyExists(companyId: number) {
  const [company] = await db.select({ id: companiesTable.id }).from(companiesTable)
    .where(eq(companiesTable.id, companyId));
  return !!company;
}

async function unitHasDependencies(unitId: number) {
  const checks = await Promise.all([
    db.select({ id: subUnitsTable.id }).from(subUnitsTable).where(eq(subUnitsTable.unitId, unitId)).limit(1),
    db.select({ id: energySourcesTable.id }).from(energySourcesTable).where(eq(energySourcesTable.unitId, unitId)).limit(1),
    db.select({ id: swotTable.id }).from(swotTable).where(eq(swotTable.unitId, unitId)).limit(1),
    db.select({ id: risksTable.id }).from(risksTable).where(eq(risksTable.unitId, unitId)).limit(1),
    db.select({ id: seuTable.id }).from(seuTable).where(eq(seuTable.unitId, unitId)).limit(1),
    db.select({ id: seuAssessmentsTable.id }).from(seuAssessmentsTable).where(eq(seuAssessmentsTable.unitId, unitId)).limit(1),
    db.select({ id: seuAssessmentItemsTable.id }).from(seuAssessmentItemsTable).where(eq(seuAssessmentItemsTable.unitId, unitId)).limit(1),
    db.select({ id: energyTargetsTable.id }).from(energyTargetsTable).where(eq(energyTargetsTable.unitId, unitId)).limit(1),
    db.select({ id: energyBaselinesTable.id }).from(energyBaselinesTable).where(eq(energyBaselinesTable.unitId, unitId)).limit(1),
    db.select({ id: energyPerformanceResultsTable.id }).from(energyPerformanceResultsTable).where(eq(energyPerformanceResultsTable.unitId, unitId)).limit(1),
    db.select({ id: energyPerformanceIndicatorsTable.id }).from(energyPerformanceIndicatorsTable).where(eq(energyPerformanceIndicatorsTable.unitId, unitId)).limit(1),
    db.select({ id: metersTable.id }).from(metersTable).where(eq(metersTable.unitId, unitId)).limit(1),
    db.select({ id: consumptionTable.id }).from(consumptionTable)
      .innerJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
      .where(eq(metersTable.unitId, unitId)).limit(1),
    db.select({ id: energyUseGroupsTable.id }).from(energyUseGroupsTable).where(eq(energyUseGroupsTable.unitId, unitId)).limit(1),
    db.select({ id: energyReviewRecordsTable.id }).from(energyReviewRecordsTable).where(eq(energyReviewRecordsTable.unitId, unitId)).limit(1),
    db.select({ id: variableValuesTable.id }).from(variableValuesTable).where(eq(variableValuesTable.unitId, unitId)).limit(1),
    db.select({ id: reportsTable.id }).from(reportsTable).where(eq(reportsTable.unitId, unitId)).limit(1),
    db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.unitId, unitId)).limit(1),
    db.select({ id: unitTechnicalProfilesTable.id }).from(unitTechnicalProfilesTable).where(eq(unitTechnicalProfilesTable.unitId, unitId)).limit(1),
  ]);
  return checks.some(rows => rows.length > 0);
}

// GET /api/units
router.get("/units", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const queryCompanyId = parsePositiveInteger(req.query.companyId);
    if (req.query.companyId !== undefined && queryCompanyId === undefined) {
      res.status(400).json({ error: "Geçersiz companyId" }); return;
    }

    // Normal kullanıcı: sadece kendi birimi
    if (!isCompanyAdmin(role) && !isSuperAdmin(role)) {
      if (sessionUnitId === null) { res.json([]); return; }
      const units = await db.select().from(unitsTable)
        .where(and(eq(unitsTable.id, sessionUnitId), eq(unitsTable.companyId, sessionCompanyId)))
        .orderBy(unitsTable.name);
      res.json(units);
      return;
    }

    // Superadmin: isteğe bağlı companyId filtresi
    if (isSuperAdmin(role)) {
      if (queryCompanyId !== undefined) {
        const units = await db.select().from(unitsTable)
          .where(eq(unitsTable.companyId, queryCompanyId))
          .orderBy(unitsTable.name);
        res.json(units);
        return;
      }
      const units = await db.select().from(unitsTable).orderBy(unitsTable.name);
      res.json(units);
      return;
    }

    // Admin: sadece kendi firması
    const units = await db.select().from(unitsTable)
      .where(eq(unitsTable.companyId, sessionCompanyId))
      .orderBy(unitsTable.name);
    res.json(units);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/units — admin only
router.post("/units", requireAuth, requireCompanyAdmin, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    const { name, location, type, city, responsible, description, active, companyId } = req.body;
    const normalizedName = normalizeRequiredText(name);
    const normalizedLocation = normalizeRequiredText(location);
    if (normalizedName === undefined || normalizedLocation === undefined) { res.status(400).json({ error: "Ad ve lokasyon zorunludur" }); return; }
    // Admin kendi firmasına ekler; superadmin body'deki companyId'yi kullanır
    const parsedCompanyId = parsePositiveInteger(companyId);
    if (companyId !== undefined && parsedCompanyId === undefined) { res.status(400).json({ error: "Geçersiz companyId" }); return; }
    const targetCompanyId = isSuperAdmin(role) ? (parsedCompanyId ?? sessionCompanyId) : sessionCompanyId;
    if (!await companyExists(targetCompanyId)) { res.status(400).json({ error: "Geçersiz companyId" }); return; }
    const [unit] = await db.insert(unitsTable).values({
      name: normalizedName, location: normalizedLocation, type: type || "fabrika", city: city || "Istanbul",
      responsible: responsible || null, description: description || null,
      active: active !== undefined ? Boolean(active) : true,
      companyId: targetCompanyId,
    }).returning();
    res.status(201).json(unit);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// GET /api/units/:id
router.get("/units/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parsePositiveInteger(req.params.id);
    if (id === undefined) { res.status(400).json({ error: "Geçersiz unitId" }); return; }
    if (!isCompanyAdmin(role) && !isSuperAdmin(role) && sessionUnitId === null) { res.status(403).json({ error: "Yetki yok" }); return; }
    const conditions = [eq(unitsTable.id, id)];
    if (!isSuperAdmin(role)) conditions.push(eq(unitsTable.companyId, sessionCompanyId));
    if (!isCompanyAdmin(role) && !isSuperAdmin(role)) conditions.push(eq(unitsTable.id, sessionUnitId!));
    const [unit] = await db.select().from(unitsTable).where(and(...conditions));
    if (!unit) { res.status(404).json({ error: "Birim bulunamadı" }); return; }
    if (!isCompanyAdmin(role) && !isSuperAdmin(role) && sessionUnitId !== id) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    if (isCompanyAdmin(role) && unit.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    res.json(unit);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PATCH /api/units/:id — admin only
router.patch("/units/:id", requireAuth, requireCompanyAdmin, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    const id = parsePositiveInteger(req.params.id);
    if (id === undefined) { res.status(400).json({ error: "Geçersiz unitId" }); return; }
    const parsedCompanyId = parsePositiveInteger(req.body.companyId);
    if (req.body.companyId !== undefined && parsedCompanyId === undefined) { res.status(400).json({ error: "Geçersiz companyId" }); return; }
    const conditions = [eq(unitsTable.id, id)];
    if (!isSuperAdmin(role)) conditions.push(eq(unitsTable.companyId, sessionCompanyId));
    const [existing] = await db.select().from(unitsTable).where(and(...conditions));
    if (!existing) { res.status(404).json({ error: "Birim bulunamadı" }); return; }
    if (isCompanyAdmin(role) && existing.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Bu birimi düzenleme yetkiniz yok" }); return;
    }
    if (isSuperAdmin(role) && parsedCompanyId !== undefined) {
      if (!await companyExists(parsedCompanyId)) { res.status(400).json({ error: "Geçersiz companyId" }); return; }
      if (parsedCompanyId !== existing.companyId) { res.status(409).json({ error: "Birim şirketler arasında taşınamaz" }); return; }
    }
    const { name, location, type, city, responsible, description, active } = req.body;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) {
      const normalizedName = normalizeRequiredText(name);
      if (normalizedName === undefined) { res.status(400).json({ error: "Ad boş olamaz" }); return; }
      updates.name = normalizedName;
    }
    if (location !== undefined) {
      const normalizedLocation = normalizeRequiredText(location);
      if (normalizedLocation === undefined) { res.status(400).json({ error: "Lokasyon boş olamaz" }); return; }
      updates.location = normalizedLocation;
    }
    if (type !== undefined) updates.type = type;
    if (city !== undefined) updates.city = city;
    if (responsible !== undefined) updates.responsible = responsible;
    if (description !== undefined) updates.description = description;
    if (active !== undefined) updates.active = Boolean(active);
    const [unit] = await db.update(unitsTable).set(updates).where(and(...conditions)).returning();
    if (!unit) { res.status(404).json({ error: "Birim bulunamadı" }); return; }
    res.json(unit);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/units/:id — admin only
router.delete("/units/:id", requireAuth, requireCompanyAdmin, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    const id = parsePositiveInteger(req.params.id);
    if (id === undefined) { res.status(400).json({ error: "Geçersiz unitId" }); return; }
    const conditions = [eq(unitsTable.id, id)];
    if (!isSuperAdmin(role)) conditions.push(eq(unitsTable.companyId, sessionCompanyId));
    const [existing] = await db.select().from(unitsTable).where(and(...conditions));
    if (!existing) { res.status(404).send(); return; }
    if (isCompanyAdmin(role) && existing.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Bu birimi silme yetkiniz yok" }); return;
    }
    if (await unitHasDependencies(id)) {
      res.status(409).json({ error: "Bu birime bağlı kayıtlar bulunduğu için silinemez." }); return;
    }
    await db.delete(unitsTable).where(and(...conditions));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
