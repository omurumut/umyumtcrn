import { Router } from "express";
import { db, energySourcesTable, unitsTable, metersTable, consumptionTable, energyUseGroupsTable, seuAssessmentsTable, seuAssessmentItemsTable, energyTargetsTable, energyPerformanceIndicatorsTable, equipmentEnergySourceLinksTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

const ENERGY_SOURCE_TYPES = new Set(["elektrik", "dogalgaz", "buhar", "su", "diger"]);

function isCompanyAdmin(role: string) { return role === "admin" || role === "kontrol_admin"; }
function isSuperAdmin(role: string) { return role === "superadmin"; }
function isStandard(role: string) { return !isCompanyAdmin(role) && !isSuperAdmin(role); }
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
async function validateUnit(unitId: number, companyId?: number) {
  const conditions = [eq(unitsTable.id, unitId)];
  if (companyId !== undefined) conditions.push(eq(unitsTable.companyId, companyId));
  const [unit] = await db.select({ companyId: unitsTable.companyId }).from(unitsTable).where(and(...conditions));
  return unit;
}

// GET /api/energy-sources?unitId=1&companyId=1
router.get("/energy-sources", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const unitId = parsePositiveInteger(req.query.unitId);
    const queryCompanyId = parsePositiveInteger(req.query.companyId);
    if (req.query.unitId !== undefined && unitId === undefined) { res.status(400).json({ error: "Geçersiz unitId" }); return; }
    if (req.query.companyId !== undefined && queryCompanyId === undefined) { res.status(400).json({ error: "Geçersiz companyId" }); return; }
    if (isStandard(role) && sessionUnitId === null) { res.json([]); return; }

    // Normal kullanıcı: sadece kendi birimi
    if (isStandard(role)) {
      const rows = await db.select().from(energySourcesTable)
        .where(eq(energySourcesTable.unitId, sessionUnitId!))
        .orderBy(energySourcesTable.name);
      res.json(rows);
      return;
    }

    // Superadmin: isteğe bağlı companyId + unitId filtresi
    if (role === "superadmin") {
      if (unitId !== undefined) {
        const unit = await validateUnit(unitId, queryCompanyId);
        if (!unit) { res.status(queryCompanyId !== undefined ? 403 : 400).json({ error: "Geçersiz unitId" }); return; }
      }
      const conditions = [];
      if (queryCompanyId !== undefined) conditions.push(eq(energySourcesTable.companyId, queryCompanyId));
      if (unitId !== undefined) conditions.push(eq(energySourcesTable.unitId, unitId));
      const rows = conditions.length > 0
        ? await db.select().from(energySourcesTable).where(and(...conditions)).orderBy(energySourcesTable.name)
        : await db.select().from(energySourcesTable).orderBy(energySourcesTable.name);
      res.json(rows);
      return;
    }

    // Admin: sadece kendi firması + isteğe bağlı unitId
    if (unitId !== undefined && !await validateUnit(unitId, sessionCompanyId)) { res.status(403).json({ error: "Yetki yok" }); return; }
    const conditions = [eq(energySourcesTable.companyId, sessionCompanyId)];
    if (unitId !== undefined) conditions.push(eq(energySourcesTable.unitId, unitId));
    const rows = await db.select().from(energySourcesTable).where(and(...conditions)).orderBy(energySourcesTable.name);
    res.json(rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/energy-sources
router.post("/energy-sources", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const { unitId, type, name, unit, active } = req.body;
    const normalizedType = normalizeRequiredText(type);
    const normalizedName = normalizeRequiredText(name);
    if (!unitId || normalizedType === undefined || normalizedName === undefined) {
      res.status(400).json({ error: "Birim, tür ve ad zorunludur" });
      return;
    }
    if (!ENERGY_SOURCE_TYPES.has(normalizedType)) {
      res.status(400).json({ error: "Geçersiz enerji kaynağı türü" }); return;
    }
    if (req.body.companyId !== undefined && parsePositiveInteger(req.body.companyId) === undefined) { res.status(400).json({ error: "Geçersiz companyId" }); return; }
    const requestedUnitId = parsePositiveInteger(unitId);
    if (requestedUnitId === undefined) { res.status(400).json({ error: "Geçersiz unitId" }); return; }
    if (isStandard(role) && sessionUnitId === null) { res.status(403).json({ error: "Yetki yok" }); return; }
    const parsedUnitId = isStandard(role) ? sessionUnitId! : requestedUnitId;

    // Normal kullanıcı: sadece kendi birimine ekleyebilir
    if (isStandard(role) && sessionUnitId !== parsedUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    // Admin: hedef birimin kendi firmasına ait olduğunu kontrol et
    if (isCompanyAdmin(role)) {
      const [parentUnit] = await db.select({ companyId: unitsTable.companyId })
        .from(unitsTable).where(eq(unitsTable.id, parsedUnitId));
      if (!parentUnit || parentUnit.companyId !== sessionCompanyId) {
        res.status(403).json({ error: "Bu birime enerji kaynağı ekleme yetkiniz yok" }); return;
      }
    }

    // companyId'yi parent unit'ten al
    const parentConditions = [eq(unitsTable.id, parsedUnitId)];
    if (!isSuperAdmin(role)) parentConditions.push(eq(unitsTable.companyId, sessionCompanyId));
    const [parentUnit] = await db.select({ companyId: unitsTable.companyId })
      .from(unitsTable).where(and(...parentConditions));
    if (!parentUnit) { res.status(400).json({ error: "Geçersiz unitId" }); return; }
    const targetCompanyId = parentUnit?.companyId ?? sessionCompanyId;

    const [row] = await db.insert(energySourcesTable).values({
      unitId: parsedUnitId,
      type: normalizedType,
      name: normalizedName,
      unit: unit || "kWh",
      active: active !== undefined ? Boolean(active) : true,
      companyId: targetCompanyId,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PATCH /api/energy-sources/:id
router.patch("/energy-sources/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parsePositiveInteger(req.params.id);
    if (id === undefined) { res.status(400).json({ error: "Geçersiz energySourceId" }); return; }
    if (req.body.companyId !== undefined && parsePositiveInteger(req.body.companyId) === undefined) { res.status(400).json({ error: "Geçersiz companyId" }); return; }
    if (req.body.unitId !== undefined && parsePositiveInteger(req.body.unitId) === undefined) { res.status(400).json({ error: "Geçersiz unitId" }); return; }
    if (isStandard(role) && sessionUnitId === null) { res.status(403).json({ error: "Yetki yok" }); return; }
    const conditions = [eq(energySourcesTable.id, id)];
    if (!isSuperAdmin(role)) conditions.push(eq(energySourcesTable.companyId, sessionCompanyId));
    if (isStandard(role)) conditions.push(eq(energySourcesTable.unitId, sessionUnitId!));
    const [existing] = await db.select().from(energySourcesTable).where(and(...conditions));
    if (!existing) { res.status(404).json({ error: "Enerji kaynağı bulunamadı" }); return; }
    if (isStandard(role) && sessionUnitId !== existing.unitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    if (isCompanyAdmin(role) && existing.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Bu enerji kaynağını düzenleme yetkiniz yok" }); return;
    }
    const { type, name, unit, active } = req.body;
    const updates: Record<string, unknown> = {};
    if (type !== undefined) {
      const normalizedType = normalizeRequiredText(type);
      if (normalizedType === undefined || !ENERGY_SOURCE_TYPES.has(normalizedType)) {
        res.status(400).json({ error: "Geçersiz enerji kaynağı türü" }); return;
      }
      updates.type = normalizedType;
    }
    if (name !== undefined) {
      const normalizedName = normalizeRequiredText(name);
      if (normalizedName === undefined) { res.status(400).json({ error: "Ad boş olamaz" }); return; }
      updates.name = normalizedName;
    }
    if (unit !== undefined) updates.unit = unit;
    if (active !== undefined) updates.active = Boolean(active);
    const [row] = await db.update(energySourcesTable).set(updates).where(and(...conditions)).returning();
    res.json(row);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/energy-sources/:id
router.delete("/energy-sources/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parsePositiveInteger(req.params.id);
    if (id === undefined) { res.status(400).json({ error: "Geçersiz energySourceId" }); return; }
    if (isStandard(role) && sessionUnitId === null) { res.status(403).json({ error: "Yetki yok" }); return; }
    const conditions = [eq(energySourcesTable.id, id)];
    if (!isSuperAdmin(role)) conditions.push(eq(energySourcesTable.companyId, sessionCompanyId));
    if (isStandard(role)) conditions.push(eq(energySourcesTable.unitId, sessionUnitId!));
    const standard = isStandard(role);
    const deleteResult = await db.transaction(async (tx) => {
      const [existing] = await tx.select({
        id: energySourcesTable.id,
        companyId: energySourcesTable.companyId,
        unitId: energySourcesTable.unitId,
      }).from(energySourcesTable).where(and(...conditions)).limit(1).for("update");
      if (!existing) return "not_found" as const;

      const meterConditions = [
        eq(metersTable.energySourceId, id),
        eq(metersTable.companyId, existing.companyId),
      ];
      const consumptionConditions = [
        eq(metersTable.energySourceId, id),
        eq(metersTable.companyId, existing.companyId),
        eq(consumptionTable.companyId, existing.companyId),
      ];
      const groupConditions = [
        eq(energyUseGroupsTable.energySourceId, id),
        eq(energyUseGroupsTable.companyId, existing.companyId),
      ];
      const assessmentConditions = [
        eq(seuAssessmentsTable.energySourceId, id),
        eq(seuAssessmentsTable.companyId, existing.companyId),
      ];
      const assessmentItemConditions = [
        eq(seuAssessmentItemsTable.energySourceId, id),
        eq(seuAssessmentsTable.companyId, existing.companyId),
      ];
      const targetConditions = [
        eq(energyTargetsTable.energySourceId, id),
        eq(energyTargetsTable.companyId, existing.companyId),
      ];
      const indicatorConditions = [
        eq(energyPerformanceIndicatorsTable.energySourceId, id),
        eq(energyPerformanceIndicatorsTable.companyId, existing.companyId),
      ];
      if (standard) {
        meterConditions.push(eq(metersTable.unitId, sessionUnitId!));
        consumptionConditions.push(eq(metersTable.unitId, sessionUnitId!));
        groupConditions.push(eq(energyUseGroupsTable.unitId, sessionUnitId!));
        assessmentConditions.push(eq(seuAssessmentsTable.unitId, sessionUnitId!));
        assessmentItemConditions.push(eq(seuAssessmentsTable.unitId, sessionUnitId!));
        targetConditions.push(eq(energyTargetsTable.unitId, sessionUnitId!));
        indicatorConditions.push(eq(energyPerformanceIndicatorsTable.unitId, sessionUnitId!));
      }

      const [meter] = await tx.select({ id: metersTable.id }).from(metersTable)
        .where(and(...meterConditions)).limit(1);
      const [consumption] = await tx.select({ id: consumptionTable.id })
        .from(consumptionTable)
        .innerJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
        .where(and(...consumptionConditions))
        .limit(1);
      const [group] = await tx.select({ id: energyUseGroupsTable.id }).from(energyUseGroupsTable)
        .where(and(...groupConditions)).limit(1);
      const [assessment] = await tx.select({ id: seuAssessmentsTable.id }).from(seuAssessmentsTable)
        .where(and(...assessmentConditions)).limit(1);
      const [assessmentItem] = await tx.select({ id: seuAssessmentItemsTable.id })
        .from(seuAssessmentItemsTable)
        .innerJoin(seuAssessmentsTable, eq(seuAssessmentItemsTable.assessmentId, seuAssessmentsTable.id))
        .where(and(...assessmentItemConditions))
        .limit(1);
      const [target] = await tx.select({ id: energyTargetsTable.id }).from(energyTargetsTable)
        .where(and(...targetConditions)).limit(1);
      const [indicator] = await tx.select({ id: energyPerformanceIndicatorsTable.id })
        .from(energyPerformanceIndicatorsTable)
        .where(and(...indicatorConditions)).limit(1);
      const [equipmentLink] = await tx.select({ id: equipmentEnergySourceLinksTable.id })
        .from(equipmentEnergySourceLinksTable)
        .where(and(eq(equipmentEnergySourceLinksTable.energySourceId, id), eq(equipmentEnergySourceLinksTable.companyId, existing.companyId)))
        .limit(1);
      if (meter || consumption || group || assessment || assessmentItem || target || indicator || equipmentLink) {
        return "dependent" as const;
      }

      const deleteConditions = [
        eq(energySourcesTable.id, id),
        eq(energySourcesTable.companyId, existing.companyId),
      ];
      if (standard) deleteConditions.push(eq(energySourcesTable.unitId, sessionUnitId!));
      const [deleted] = await tx.delete(energySourcesTable)
        .where(and(...deleteConditions))
        .returning({ id: energySourcesTable.id });
      return deleted ? "deleted" as const : "not_found" as const;
    });

    if (deleteResult === "not_found") { res.status(404).send(); return; }
    if (deleteResult === "dependent") {
      res.status(409).json({ error: "Bu enerji kaynağına bağlı kayıtlar bulunduğu için silinemez." });
      return;
    }
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
