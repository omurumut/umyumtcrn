import { Router } from "express";
import { db, energyUseGroupsTable, metersTable, unitsTable, subUnitsTable, energySourcesTable, seuAssessmentsTable, seuAssessmentItemsTable, energyPerformanceIndicatorsTable } from "@workspace/db";
import { eq, and, isNull, SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

class ScopeError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function isCompanyAdmin(role: string) {
  return role === "admin" || role === "kontrol_admin";
}

function isSuperAdmin(role: string) {
  return role === "superadmin";
}

function parsePositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new ScopeError(400, `Geçersiz ${field}`);
}

function parseNullableId(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return parsePositiveInteger(value, field)!;
}

async function resolveScope(req: any, source: Record<string, unknown>) {
  const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
  const requestedCompanyId = parsePositiveInteger(source.companyId, "companyId");
  const requestedUnitId = parsePositiveInteger(source.unitId, "unitId");
  const standard = !isCompanyAdmin(role) && !isSuperAdmin(role);
  if (standard) return { companyId: sessionCompanyId, unitId: sessionUnitId, standard };

  let companyId = isSuperAdmin(role) ? requestedCompanyId : sessionCompanyId;
  if (requestedUnitId !== undefined) {
    const [unit] = await db.select({ companyId: unitsTable.companyId }).from(unitsTable)
      .where(eq(unitsTable.id, requestedUnitId));
    if (!unit) throw new ScopeError(400, "Geçersiz unitId");
    if (companyId !== undefined && unit.companyId !== companyId) throw new ScopeError(403, "Yetki yok");
    if (companyId === undefined) companyId = unit.companyId;
  }
  return { companyId, unitId: requestedUnitId ?? null, standard };
}

async function validateEnergyUseGroupRelations(
  companyId: number,
  unitId: number | null,
  subUnitId: number | null,
  energySourceId: number | null,
) {
  if (unitId !== null) {
    const [unit] = await db.select({ id: unitsTable.id }).from(unitsTable)
      .where(and(eq(unitsTable.id, unitId), eq(unitsTable.companyId, companyId)));
    if (!unit) throw new ScopeError(400, "Birim seçilen şirkete ait değil");
  }
  if (subUnitId !== null) {
    if (unitId === null) throw new ScopeError(400, "Alt birim için unitId zorunludur");
    const [subUnit] = await db.select({ id: subUnitsTable.id }).from(subUnitsTable)
      .where(and(eq(subUnitsTable.id, subUnitId), eq(subUnitsTable.companyId, companyId), eq(subUnitsTable.unitId, unitId)));
    if (!subUnit) throw new ScopeError(400, "Alt birim seçilen birime ait değil");
  }
  if (energySourceId !== null) {
    const [source] = await db.select({ id: energySourcesTable.id, unitId: energySourcesTable.unitId }).from(energySourcesTable)
      .where(and(eq(energySourcesTable.id, energySourceId), eq(energySourcesTable.companyId, companyId)));
    if (!source || unitId === null || source.unitId !== unitId) {
      throw new ScopeError(400, "Enerji kaynağı seçilen şirket/birim ile uyumlu değil");
    }
  }
}

function handleScopeError(res: any, err: unknown) {
  if (!(err instanceof ScopeError)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

// GET /api/energy-use-groups
router.get("/energy-use-groups", requireAuth, async (req, res) => {
  try {
    const { role } = req.user!;
    const { isActive, groupType, energySourceId, unitId, subUnitId, companyId: qCompanyId } = req.query;
    const scope = await resolveScope(req, { companyId: qCompanyId, unitId });
    const parsedEnergySourceId = parsePositiveInteger(energySourceId, "energySourceId");
    const parsedSubUnitId = parsePositiveInteger(subUnitId, "subUnitId");
    if (scope.standard && scope.unitId === null) {
      res.json([]); return;
    }
    if (scope.companyId !== undefined && (parsedSubUnitId !== undefined || parsedEnergySourceId !== undefined)) {
      await validateEnergyUseGroupRelations(scope.companyId, scope.unitId, parsedSubUnitId ?? null, parsedEnergySourceId ?? null);
    }
    const conditions: SQL[] = [];
    if (scope.companyId !== undefined) conditions.push(eq(energyUseGroupsTable.companyId, scope.companyId));
    if (scope.unitId !== null) conditions.push(eq(energyUseGroupsTable.unitId, scope.unitId));
    if (isActive !== undefined) conditions.push(eq(energyUseGroupsTable.isActive, isActive === "true"));
    if (groupType) conditions.push(eq(energyUseGroupsTable.groupType, String(groupType)));
    if (parsedEnergySourceId !== undefined) conditions.push(eq(energyUseGroupsTable.energySourceId, parsedEnergySourceId));
    if (parsedSubUnitId !== undefined) conditions.push(eq(energyUseGroupsTable.subUnitId, parsedSubUnitId));
    const rows = conditions.length
      ? await db.select().from(energyUseGroupsTable).where(and(...conditions)).orderBy(energyUseGroupsTable.name)
      : await db.select().from(energyUseGroupsTable).orderBy(energyUseGroupsTable.name);

    // Bağlı sayaç sayısını ekle
    const groupIds = rows.map(g => g.id);
    const meterCounts: Record<number, number> = {};
    if (groupIds.length > 0) {
      const allMeters = scope.companyId !== undefined
        ? await db.select({ energyUseGroupId: metersTable.energyUseGroupId }).from(metersTable).where(eq(metersTable.companyId, scope.companyId))
        : await db.select({ energyUseGroupId: metersTable.energyUseGroupId }).from(metersTable);
      for (const m of allMeters) {
        if (m.energyUseGroupId !== null && m.energyUseGroupId !== undefined) {
          meterCounts[m.energyUseGroupId] = (meterCounts[m.energyUseGroupId] ?? 0) + 1;
        }
      }
    }

    const result = rows.map(g => ({ ...g, meterCount: meterCounts[g.id] ?? 0 }));
    res.json(result);
  } catch (err) {
    if (handleScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/energy-use-groups
router.post("/energy-use-groups", requireAuth, async (req, res) => {
  try {
    const { name: userName } = req.user!;
    const { name, code, groupType, energySourceId, unitId, subUnitId, description, isSeuCandidate, isActive } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ error: "Grup adı zorunludur" }); return;
    }

    const scope = await resolveScope(req, req.body);
    const effectiveCompanyId = scope.companyId ?? req.user!.companyId;
    if (scope.standard && scope.unitId === null) throw new ScopeError(403, "Yetki yok");
    const effectiveUnitId = scope.standard ? scope.unitId : (parseNullableId(unitId, "unitId") ?? null);
    const effectiveSubUnitId = parseNullableId(subUnitId, "subUnitId") ?? null;
    const effectiveEnergySourceId = parseNullableId(energySourceId, "energySourceId") ?? null;
    await validateEnergyUseGroupRelations(effectiveCompanyId, effectiveUnitId, effectiveSubUnitId, effectiveEnergySourceId);

    // Aynı companyId altında aynı name kontrolü (aktif kayıtlar)
    const existing = await db.select({ id: energyUseGroupsTable.id })
      .from(energyUseGroupsTable)
      .where(and(
        eq(energyUseGroupsTable.companyId, effectiveCompanyId),
        eq(energyUseGroupsTable.name, name.trim()),
        eq(energyUseGroupsTable.isActive, true)
      ));
    if (existing.length > 0) {
      res.status(400).json({ error: "Bu isimde aktif bir grup zaten mevcut" }); return;
    }

    const [group] = await db.insert(energyUseGroupsTable).values({
      companyId: effectiveCompanyId,
      name: name.trim(),
      code: code?.trim() || null,
      groupType: groupType ?? "other",
      energySourceId: effectiveEnergySourceId,
      unitId: effectiveUnitId,
      subUnitId: effectiveSubUnitId,
      description: description?.trim() || null,
      isSeuCandidate: isSeuCandidate === true || isSeuCandidate === "true",
      isActive: isActive !== false && isActive !== "false",
      createdBy: userName ?? null,
    }).returning();

    res.status(201).json({ ...group, meterCount: 0 });
  } catch (err) {
    if (handleScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PUT /api/energy-use-groups/:id
router.put("/energy-use-groups/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parsePositiveInteger(req.params.id, "groupId")!;
    const standard = !isCompanyAdmin(role) && !isSuperAdmin(role);
    if (standard && sessionUnitId === null) throw new ScopeError(403, "Yetki yok");

    const recordConditions = [eq(energyUseGroupsTable.id, id)];
    if (!isSuperAdmin(role)) recordConditions.push(eq(energyUseGroupsTable.companyId, sessionCompanyId));
    if (standard) recordConditions.push(eq(energyUseGroupsTable.unitId, sessionUnitId!));
    const [existing] = await db.select().from(energyUseGroupsTable).where(and(...recordConditions));
    if (!existing) { res.status(404).json({ error: "Grup bulunamadı" }); return; }

    const { name, code, groupType, energySourceId, unitId, subUnitId, description, isSeuCandidate, isActive } = req.body;
    parsePositiveInteger(req.body.companyId, "companyId");
    const effectiveUnitId = standard
      ? sessionUnitId
      : (unitId === undefined ? existing.unitId : (parseNullableId(unitId, "unitId") ?? null));
    const effectiveSubUnitId = subUnitId === undefined ? existing.subUnitId : (parseNullableId(subUnitId, "subUnitId") ?? null);
    const effectiveEnergySourceId = energySourceId === undefined ? existing.energySourceId : (parseNullableId(energySourceId, "energySourceId") ?? null);
    await validateEnergyUseGroupRelations(existing.companyId, effectiveUnitId, effectiveSubUnitId, effectiveEnergySourceId);

    if (!name || !name.trim()) {
      res.status(400).json({ error: "Grup adı zorunludur" }); return;
    }

    // Mükerrer isim kontrolü (aynı isimde başka aktif grup var mı?)
    const duplicate = await db.select({ id: energyUseGroupsTable.id })
      .from(energyUseGroupsTable)
      .where(and(
        eq(energyUseGroupsTable.companyId, existing.companyId),
        eq(energyUseGroupsTable.name, name.trim()),
        eq(energyUseGroupsTable.isActive, true)
      ));
    if (duplicate.some(d => d.id !== id)) {
      res.status(400).json({ error: "Bu isimde aktif bir grup zaten mevcut" }); return;
    }

    const [updated] = await db.update(energyUseGroupsTable).set({
      name: name.trim(),
      code: code?.trim() || null,
      groupType: groupType ?? existing.groupType ?? "other",
      energySourceId: effectiveEnergySourceId,
      unitId: effectiveUnitId,
      subUnitId: effectiveSubUnitId,
      description: description?.trim() || null,
      isSeuCandidate: isSeuCandidate === true || isSeuCandidate === "true",
      isActive: isActive !== false && isActive !== "false",
      updatedAt: new Date(),
    }).where(and(...recordConditions)).returning();

    res.json(updated);
  } catch (err) {
    if (handleScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PATCH /api/energy-use-groups/:id/status
router.patch("/energy-use-groups/:id/status", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parsePositiveInteger(req.params.id, "groupId")!;
    const standard = !isCompanyAdmin(role) && !isSuperAdmin(role);
    if (standard && sessionUnitId === null) throw new ScopeError(403, "Yetki yok");

    const recordConditions = [eq(energyUseGroupsTable.id, id)];
    if (!isSuperAdmin(role)) recordConditions.push(eq(energyUseGroupsTable.companyId, sessionCompanyId));
    if (standard) recordConditions.push(eq(energyUseGroupsTable.unitId, sessionUnitId!));
    const [existing] = await db.select().from(energyUseGroupsTable).where(and(...recordConditions));
    if (!existing) { res.status(404).json({ error: "Grup bulunamadı" }); return; }

    const { isActive } = req.body;
    if (typeof isActive !== "boolean") {
      res.status(400).json({ error: "isActive boolean olmalıdır" }); return;
    }

    const [updated] = await db.update(energyUseGroupsTable).set({
      isActive,
      updatedAt: new Date(),
    }).where(and(...recordConditions)).returning();

    res.json(updated);
  } catch (err) {
    if (handleScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// GET /api/energy-use-groups/:id/meters
router.get("/energy-use-groups/:id/meters", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parsePositiveInteger(req.params.id, "groupId")!;
    const standard = !isCompanyAdmin(role) && !isSuperAdmin(role);
    if (standard && sessionUnitId === null) { res.json([]); return; }

    const recordConditions = [eq(energyUseGroupsTable.id, id)];
    if (!isSuperAdmin(role)) recordConditions.push(eq(energyUseGroupsTable.companyId, sessionCompanyId));
    if (standard) recordConditions.push(eq(energyUseGroupsTable.unitId, sessionUnitId!));
    const [group] = await db.select().from(energyUseGroupsTable).where(and(...recordConditions));
    if (!group) { res.status(404).json({ error: "Grup bulunamadı" }); return; }

    const meterConditions = [eq(metersTable.energyUseGroupId, id), eq(metersTable.companyId, group.companyId)];
    if (standard) meterConditions.push(eq(metersTable.unitId, sessionUnitId!));
    const meters = await db.select().from(metersTable)
      .where(and(...meterConditions));

    res.json(meters);
  } catch (err) {
    if (handleScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// GET /api/energy-use-groups/export — isim join'li export verisi
router.delete("/energy-use-groups/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parsePositiveInteger(req.params.id, "groupId")!;
    const standard = !isCompanyAdmin(role) && !isSuperAdmin(role);
    if (standard && sessionUnitId === null) throw new ScopeError(403, "Yetki yok");
    const recordConditions = [eq(energyUseGroupsTable.id, id)];
    if (!isSuperAdmin(role)) recordConditions.push(eq(energyUseGroupsTable.companyId, sessionCompanyId));
    if (standard) recordConditions.push(eq(energyUseGroupsTable.unitId, sessionUnitId!));
    const deleteResult = await db.transaction(async (tx) => {
      const [existing] = await tx.select({
        id: energyUseGroupsTable.id,
        companyId: energyUseGroupsTable.companyId,
      }).from(energyUseGroupsTable)
        .where(and(...recordConditions))
        .limit(1)
        .for("update");
      if (!existing) return "not_found" as const;

      const meterConditions = [
        eq(metersTable.energyUseGroupId, id),
        eq(metersTable.companyId, existing.companyId),
      ];
      const assessmentConditions = [
        eq(seuAssessmentItemsTable.energyUseGroupId, id),
        eq(seuAssessmentsTable.companyId, existing.companyId),
      ];
      const indicatorConditions = [
        eq(energyPerformanceIndicatorsTable.energyUseGroupId, id),
        eq(energyPerformanceIndicatorsTable.companyId, existing.companyId),
      ];
      if (standard) {
        meterConditions.push(eq(metersTable.unitId, sessionUnitId!));
        assessmentConditions.push(eq(seuAssessmentsTable.unitId, sessionUnitId!));
        indicatorConditions.push(eq(energyPerformanceIndicatorsTable.unitId, sessionUnitId!));
      }

      const [meter] = await tx.select({ id: metersTable.id }).from(metersTable)
        .where(and(...meterConditions)).limit(1);
      const [assessmentItem] = await tx.select({ id: seuAssessmentItemsTable.id })
        .from(seuAssessmentItemsTable)
        .innerJoin(seuAssessmentsTable, eq(seuAssessmentItemsTable.assessmentId, seuAssessmentsTable.id))
        .where(and(...assessmentConditions))
        .limit(1);
      const [indicator] = await tx.select({ id: energyPerformanceIndicatorsTable.id })
        .from(energyPerformanceIndicatorsTable)
        .where(and(...indicatorConditions))
        .limit(1);
      if (meter || assessmentItem || indicator) return "dependent" as const;

      const deleteConditions = [
        eq(energyUseGroupsTable.id, id),
        eq(energyUseGroupsTable.companyId, existing.companyId),
      ];
      if (standard) deleteConditions.push(eq(energyUseGroupsTable.unitId, sessionUnitId!));
      const [deleted] = await tx.delete(energyUseGroupsTable)
        .where(and(...deleteConditions))
        .returning({ id: energyUseGroupsTable.id });
      return deleted ? "deleted" as const : "not_found" as const;
    });

    if (deleteResult === "not_found") { res.status(404).json({ error: "Grup bulunamadı" }); return; }
    if (deleteResult === "dependent") {
      res.status(409).json({ error: "Bu enerji kullanım grubuna bağlı kayıtlar bulunduğu için silinemez." });
      return;
    }
    res.status(204).send();
  } catch (err) {
    if (handleScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.get("/energy-use-groups/export", requireAuth, async (req, res) => {
  try {
    const { isActive, energySourceId, unitId, subUnitId, companyId } = req.query;
    const scope = await resolveScope(req, { companyId, unitId });
    const parsedEnergySourceId = parsePositiveInteger(energySourceId, "energySourceId");
    const parsedSubUnitId = parsePositiveInteger(subUnitId, "subUnitId");
    if (scope.standard && scope.unitId === null) {
      res.json([]); return;
    }

    if (scope.companyId !== undefined && (parsedSubUnitId !== undefined || parsedEnergySourceId !== undefined)) {
      await validateEnergyUseGroupRelations(scope.companyId, scope.unitId, parsedSubUnitId ?? null, parsedEnergySourceId ?? null);
    }
    const conditions: SQL[] = [];
    if (scope.companyId !== undefined) conditions.push(eq(energyUseGroupsTable.companyId, scope.companyId));
    if (scope.unitId !== null) conditions.push(eq(energyUseGroupsTable.unitId, scope.unitId));
    if (isActive !== undefined) conditions.push(eq(energyUseGroupsTable.isActive, isActive === "true"));
    if (parsedEnergySourceId !== undefined) conditions.push(eq(energyUseGroupsTable.energySourceId, parsedEnergySourceId));
    if (parsedSubUnitId !== undefined) conditions.push(eq(energyUseGroupsTable.subUnitId, parsedSubUnitId));

    const rows = await db
      .select({
        id: energyUseGroupsTable.id,
        companyId: energyUseGroupsTable.companyId,
        name: energyUseGroupsTable.name,
        code: energyUseGroupsTable.code,
        groupType: energyUseGroupsTable.groupType,
        description: energyUseGroupsTable.description,
        isSeuCandidate: energyUseGroupsTable.isSeuCandidate,
        isActive: energyUseGroupsTable.isActive,
        unitId: energyUseGroupsTable.unitId,
        subUnitId: energyUseGroupsTable.subUnitId,
        energySourceId: energyUseGroupsTable.energySourceId,
        unitName: unitsTable.name,
        subUnitName: subUnitsTable.name,
        energySourceName: energySourcesTable.name,
      })
      .from(energyUseGroupsTable)
      .leftJoin(unitsTable, eq(energyUseGroupsTable.unitId, unitsTable.id))
      .leftJoin(subUnitsTable, eq(energyUseGroupsTable.subUnitId, subUnitsTable.id))
      .leftJoin(energySourcesTable, eq(energyUseGroupsTable.energySourceId, energySourcesTable.id))
      .where(and(...conditions))
      .orderBy(energyUseGroupsTable.name);
    res.json(rows);
  } catch (err) {
    if (handleScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/energy-use-groups/batch — toplu içe aktarma
router.post("/energy-use-groups/batch", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId, name: userName } = req.user!;
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "Geçerli satır dizisi gerekli" }); return;
    }
    if (rows.length > 2000) {
      res.status(400).json({ error: "En fazla 2000 satır içe aktarılabilir" }); return;
    }

    const scope = await resolveScope(req, req.body);
    const targetCompanyId = scope.companyId ?? sessionCompanyId;
    const isPrivileged = isSuperAdmin(role) || isCompanyAdmin(role);

    // Standard users without a unitId cannot import (no scope to write into)
    if (!isPrivileged && sessionUnitId === null) {
      res.status(403).json({ error: "Birim yetkisi olmayan kullanıcılar toplu içe aktarma yapamaz" }); return;
    }

    // Lookup tables: all units, subunits, energy sources for this company
    const allUnits = await db.select().from(unitsTable).where(eq(unitsTable.companyId, targetCompanyId));
    const allSubUnits = await db.select().from(subUnitsTable).where(eq(subUnitsTable.companyId, targetCompanyId));
    const allEnergySources = await db.select().from(energySourcesTable).where(eq(energySourcesTable.companyId, targetCompanyId));

    let imported = 0;
    const errors: { row: number; message: string }[] = [];

    for (const [i, row] of rows.entries()) {
      const rowNum = i + 1;
      try {
        const groupName = String(row.group_name ?? row.groupName ?? "").trim();
        if (!groupName) {
          errors.push({ row: rowNum, message: "Grup adı boş olamaz" }); continue;
        }

        // Resolve unit
        let resolvedUnitId: number | null = null;
        const rowUnitId = parsePositiveInteger(row.unitId ?? row.unit_id, "unitId");
        const unitNameRaw = String(row.unit_name ?? row.unitName ?? "").trim();
        if (rowUnitId !== undefined || unitNameRaw) {
          const unit = rowUnitId !== undefined
            ? allUnits.find(u => u.id === rowUnitId)
            : allUnits.find(u => u.name.toLowerCase().trim() === unitNameRaw.toLowerCase());
          if (!unit) {
            errors.push({ row: rowNum, message: `Birim bulunamadı: "${unitNameRaw}"` }); continue;
          }
          // Standard user scoping
          if (!isPrivileged && sessionUnitId !== null && unit.id !== sessionUnitId) {
            errors.push({ row: rowNum, message: `Bu birim için yetkiniz yok: "${unitNameRaw}"` }); continue;
          }
          resolvedUnitId = unit.id;
        } else if (!isPrivileged && sessionUnitId !== null) {
          resolvedUnitId = sessionUnitId;
        }

        // Resolve sub_unit
        let resolvedSubUnitId: number | null = null;
        const rowSubUnitId = parsePositiveInteger(row.subUnitId ?? row.sub_unit_id, "subUnitId");
        const subUnitNameRaw = String(row.sub_unit_name ?? row.subUnitName ?? "").trim();
        if (rowSubUnitId !== undefined || subUnitNameRaw) {
          const candidates = resolvedUnitId
            ? allSubUnits.filter(s => s.unitId === resolvedUnitId)
            : allSubUnits.filter(s => allUnits.some(u => u.id === s.unitId));
          const sub = rowSubUnitId !== undefined
            ? candidates.find(s => s.id === rowSubUnitId)
            : candidates.find(s => s.name.toLowerCase().trim() === subUnitNameRaw.toLowerCase());
          if (!sub) {
            errors.push({ row: rowNum, message: `Alt birim bulunamadı: "${subUnitNameRaw}"` }); continue;
          }
          resolvedSubUnitId = sub.id;
        }

        // Resolve energy source
        let resolvedEnergySourceId: number | null = null;
        const rowEnergySourceId = parsePositiveInteger(row.energySourceId ?? row.energy_source_id, "energySourceId");
        const esNameRaw = String(row.energy_source_name ?? row.energySourceName ?? "").trim();
        if (rowEnergySourceId !== undefined || esNameRaw) {
          const es = rowEnergySourceId !== undefined
            ? allEnergySources.find(e => e.id === rowEnergySourceId)
            : allEnergySources.find(e => e.name.toLowerCase().trim() === esNameRaw.toLowerCase());
          if (!es) {
            errors.push({ row: rowNum, message: `Enerji kaynağı bulunamadı: "${esNameRaw}"` }); continue;
          }
          resolvedEnergySourceId = es.id;
        }

        await validateEnergyUseGroupRelations(targetCompanyId, resolvedUnitId, resolvedSubUnitId, resolvedEnergySourceId);

        // Duplicate check: same company + group_name + sub_unit + energy_source (null-safe)
        const { isNull: isNullDrizzle } = await import("drizzle-orm");
        const dupConditions: any[] = [
          eq(energyUseGroupsTable.companyId, targetCompanyId),
          eq(energyUseGroupsTable.name, groupName),
          resolvedSubUnitId !== null
            ? eq(energyUseGroupsTable.subUnitId, resolvedSubUnitId)
            : isNullDrizzle(energyUseGroupsTable.subUnitId),
          resolvedEnergySourceId !== null
            ? eq(energyUseGroupsTable.energySourceId, resolvedEnergySourceId)
            : isNullDrizzle(energyUseGroupsTable.energySourceId),
        ];
        const [dup] = await db.select({ id: energyUseGroupsTable.id })
          .from(energyUseGroupsTable)
          .where(and(...dupConditions));
        if (dup) {
          errors.push({ row: rowNum, message: `"${groupName}" bu alt birim ve kaynak için zaten mevcut (atlandı)` }); continue;
        }

        const isActiveVal = String(row.is_active ?? row.isActive ?? "true").trim().toLowerCase();
        const isActiveBoolean = isActiveVal !== "false" && isActiveVal !== "0" && isActiveVal !== "hayır" && isActiveVal !== "pasif";

        await db.insert(energyUseGroupsTable).values({
          companyId: targetCompanyId,
          name: groupName,
          code: null,
          groupType: "other",
          energySourceId: resolvedEnergySourceId,
          unitId: resolvedUnitId,
          subUnitId: resolvedSubUnitId,
          description: String(row.description ?? "").trim() || null,
          isSeuCandidate: false,
          isActive: isActiveBoolean,
          createdBy: userName ?? null,
        });
        imported++;
      } catch (rowErr: any) {
        errors.push({ row: rowNum, message: rowErr?.message ?? "Bilinmeyen hata" });
      }
    }

    res.json({ imported, total: rows.length, errors });
  } catch (err) {
    if (handleScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
