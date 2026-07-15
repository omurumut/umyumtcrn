import { Router } from "express";
import { db, subUnitsTable, unitsTable, metersTable, consumptionTable, energyUseGroupsTable, seuAssessmentsTable, seuAssessmentItemsTable, variableValuesTable, energyTargetsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

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

// GET /api/sub-units?unitId=1&companyId=1
router.get("/sub-units", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const unitId = parsePositiveInteger(req.query.unitId);
    const queryCompanyId = parsePositiveInteger(req.query.companyId);
    if (req.query.unitId !== undefined && unitId === undefined) { res.status(400).json({ error: "Geçersiz unitId" }); return; }
    if (req.query.companyId !== undefined && queryCompanyId === undefined) { res.status(400).json({ error: "Geçersiz companyId" }); return; }
    if (isStandard(role) && sessionUnitId === null) { res.json([]); return; }

    // Normal kullanıcı: sadece kendi birimi
    if (isStandard(role)) {
      const rows = await db.select().from(subUnitsTable)
        .where(eq(subUnitsTable.unitId, sessionUnitId!))
        .orderBy(subUnitsTable.name);
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
      if (queryCompanyId !== undefined) conditions.push(eq(subUnitsTable.companyId, queryCompanyId));
      if (unitId !== undefined) conditions.push(eq(subUnitsTable.unitId, unitId));
      const rows = conditions.length > 0
        ? await db.select().from(subUnitsTable).where(and(...conditions)).orderBy(subUnitsTable.name)
        : await db.select().from(subUnitsTable).orderBy(subUnitsTable.name);
      res.json(rows);
      return;
    }

    // Admin: sadece kendi firması + isteğe bağlı unitId
    if (unitId !== undefined && !await validateUnit(unitId, sessionCompanyId)) { res.status(403).json({ error: "Yetki yok" }); return; }
    const conditions = [eq(subUnitsTable.companyId, sessionCompanyId)];
    if (unitId !== undefined) conditions.push(eq(subUnitsTable.unitId, unitId));
    const rows = await db.select().from(subUnitsTable).where(and(...conditions)).orderBy(subUnitsTable.name);
    res.json(rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/sub-units
router.post("/sub-units", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const { unitId, name, city, description, active } = req.body;
    const normalizedName = normalizeRequiredText(name);
    if (!unitId || normalizedName === undefined) {
      res.status(400).json({ error: "Birim ve ad zorunludur" });
      return;
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
        res.status(403).json({ error: "Bu birime alt birim ekleme yetkiniz yok" }); return;
      }
    }

    // companyId'yi parent unit'ten al
    const parentConditions = [eq(unitsTable.id, parsedUnitId)];
    if (!isSuperAdmin(role)) parentConditions.push(eq(unitsTable.companyId, sessionCompanyId));
    const [parentUnit] = await db.select({ companyId: unitsTable.companyId })
      .from(unitsTable).where(and(...parentConditions));
    if (!parentUnit) { res.status(400).json({ error: "Geçersiz unitId" }); return; }
    const targetCompanyId = parentUnit?.companyId ?? sessionCompanyId;

    const [row] = await db.insert(subUnitsTable).values({
      unitId: parsedUnitId,
      name: normalizedName,
      city: city || "Istanbul",
      description: description || null,
      active: active !== undefined ? Boolean(active) : true,
      companyId: targetCompanyId,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// GET /api/sub-units/:id
router.get("/sub-units/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parsePositiveInteger(req.params.id);
    if (id === undefined) { res.status(400).json({ error: "Geçersiz subUnitId" }); return; }
    if (isStandard(role) && sessionUnitId === null) { res.status(403).json({ error: "Yetki yok" }); return; }
    const conditions = [eq(subUnitsTable.id, id)];
    if (!isSuperAdmin(role)) conditions.push(eq(subUnitsTable.companyId, sessionCompanyId));
    if (isStandard(role)) conditions.push(eq(subUnitsTable.unitId, sessionUnitId!));
    const [row] = await db.select().from(subUnitsTable).where(and(...conditions));
    if (!row) { res.status(404).json({ error: "Alt birim bulunamadı" }); return; }
    if (isStandard(role) && sessionUnitId !== row.unitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    if (isCompanyAdmin(role) && row.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    res.json(row);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PATCH /api/sub-units/:id
router.patch("/sub-units/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parsePositiveInteger(req.params.id);
    if (id === undefined) { res.status(400).json({ error: "Geçersiz subUnitId" }); return; }
    if (req.body.companyId !== undefined && parsePositiveInteger(req.body.companyId) === undefined) { res.status(400).json({ error: "Geçersiz companyId" }); return; }
    if (req.body.unitId !== undefined && parsePositiveInteger(req.body.unitId) === undefined) { res.status(400).json({ error: "Geçersiz unitId" }); return; }
    if (isStandard(role) && sessionUnitId === null) { res.status(403).json({ error: "Yetki yok" }); return; }
    const conditions = [eq(subUnitsTable.id, id)];
    if (!isSuperAdmin(role)) conditions.push(eq(subUnitsTable.companyId, sessionCompanyId));
    if (isStandard(role)) conditions.push(eq(subUnitsTable.unitId, sessionUnitId!));
    const [existing] = await db.select().from(subUnitsTable).where(and(...conditions));
    if (!existing) { res.status(404).json({ error: "Alt birim bulunamadı" }); return; }
    if (isStandard(role) && sessionUnitId !== existing.unitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    if (isCompanyAdmin(role) && existing.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Bu alt birimi düzenleme yetkiniz yok" }); return;
    }
    const { name, city, description, active } = req.body;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) {
      const normalizedName = normalizeRequiredText(name);
      if (normalizedName === undefined) { res.status(400).json({ error: "Ad boş olamaz" }); return; }
      updates.name = normalizedName;
    }
    if (city !== undefined) updates.city = city;
    if (description !== undefined) updates.description = description;
    if (active !== undefined) updates.active = Boolean(active);
    const [row] = await db.update(subUnitsTable).set(updates).where(and(...conditions)).returning();
    res.json(row);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/sub-units/:id
router.delete("/sub-units/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parsePositiveInteger(req.params.id);
    if (id === undefined) { res.status(400).json({ error: "Geçersiz subUnitId" }); return; }
    if (isStandard(role) && sessionUnitId === null) { res.status(403).json({ error: "Yetki yok" }); return; }
    const conditions = [eq(subUnitsTable.id, id)];
    if (!isSuperAdmin(role)) conditions.push(eq(subUnitsTable.companyId, sessionCompanyId));
    if (isStandard(role)) conditions.push(eq(subUnitsTable.unitId, sessionUnitId!));
    const standard = isStandard(role);
    const deleteResult = await db.transaction(async (tx) => {
      const [existing] = await tx.select({
        id: subUnitsTable.id,
        companyId: subUnitsTable.companyId,
        unitId: subUnitsTable.unitId,
      }).from(subUnitsTable).where(and(...conditions)).limit(1).for("update");
      if (!existing) return "not_found" as const;

      const meterConditions = [
        eq(metersTable.subUnitId, id),
        eq(metersTable.companyId, existing.companyId),
      ];
      const consumptionConditions = [
        eq(metersTable.subUnitId, id),
        eq(metersTable.companyId, existing.companyId),
        eq(consumptionTable.companyId, existing.companyId),
      ];
      const groupConditions = [
        eq(energyUseGroupsTable.subUnitId, id),
        eq(energyUseGroupsTable.companyId, existing.companyId),
      ];
      const assessmentConditions = [
        eq(seuAssessmentItemsTable.subUnitId, id),
        eq(seuAssessmentsTable.companyId, existing.companyId),
      ];
      const valueConditions = [
        eq(variableValuesTable.subUnitId, id),
        eq(variableValuesTable.companyId, existing.companyId),
      ];
      const targetConditions = [
        eq(energyTargetsTable.subUnitId, id),
        eq(energyTargetsTable.companyId, existing.companyId),
      ];
      if (standard) {
        meterConditions.push(eq(metersTable.unitId, sessionUnitId!));
        consumptionConditions.push(eq(metersTable.unitId, sessionUnitId!));
        groupConditions.push(eq(energyUseGroupsTable.unitId, sessionUnitId!));
        assessmentConditions.push(eq(seuAssessmentsTable.unitId, sessionUnitId!));
        valueConditions.push(eq(variableValuesTable.unitId, sessionUnitId!));
        targetConditions.push(eq(energyTargetsTable.unitId, sessionUnitId!));
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
      const [assessmentItem] = await tx.select({ id: seuAssessmentItemsTable.id })
        .from(seuAssessmentItemsTable)
        .innerJoin(seuAssessmentsTable, eq(seuAssessmentItemsTable.assessmentId, seuAssessmentsTable.id))
        .where(and(...assessmentConditions))
        .limit(1);
      const [variableValue] = await tx.select({ id: variableValuesTable.id }).from(variableValuesTable)
        .where(and(...valueConditions)).limit(1);
      const [target] = await tx.select({ id: energyTargetsTable.id }).from(energyTargetsTable)
        .where(and(...targetConditions)).limit(1);
      if (meter || consumption || group || assessmentItem || variableValue || target) {
        return "dependent" as const;
      }

      const deleteConditions = [
        eq(subUnitsTable.id, id),
        eq(subUnitsTable.companyId, existing.companyId),
      ];
      if (standard) deleteConditions.push(eq(subUnitsTable.unitId, sessionUnitId!));
      const [deleted] = await tx.delete(subUnitsTable)
        .where(and(...deleteConditions))
        .returning({ id: subUnitsTable.id });
      return deleted ? "deleted" as const : "not_found" as const;
    });

    if (deleteResult === "not_found") { res.status(404).send(); return; }
    if (deleteResult === "dependent") {
      res.status(409).json({ error: "Bu alt birime bağlı kayıtlar bulunduğu için silinemez." });
      return;
    }
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
