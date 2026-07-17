import { Router } from "express";
import { db, variablesTable, variableValuesTable, energyBaselineVariablesTable, energyBaselinesTable, weatherDegreeDaysTable, companiesTable, unitsTable, subUnitsTable, metersTable, mgmStationsTable, mgmDegreeDataTable } from "@workspace/db";
import { eq, and, or, ne, isNull, inArray, sql, SQL } from "drizzle-orm";
import { requireAuth, requireCompanyAdmin } from "../middlewares/auth.js";
import { parseIlIlce, findStationByIlIlce } from "../services/mgm-stations-data.js";
import { lookupStationKeyByLocation, lookupOfficialByStationKey } from "../services/mgm-sync.js";
import { observeImport } from "../lib/metrics.js";

const router = Router();
const VARIABLE_NAME_MAX_LENGTH = 255;
const VARIABLE_TYPES = new Set(["numeric", "percentage", "boolean"]);
const VARIABLE_SCOPE_TYPES = new Set(["company", "unit", "sub_unit", "meter"]);

function isCompanyAdmin(role: string) {
  return role === "admin" || role === "kontrol_admin";
}

function isSuperAdmin(role: string) {
  return role === "superadmin";
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

const POSTGRES_REAL_MAX = 3.4028234663852886e38;
const STRICT_DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function parseFiniteReal(value: unknown): number | undefined {
  let parsed: number;

  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized || !STRICT_DECIMAL_PATTERN.test(normalized)) return undefined;
    parsed = Number(normalized);
  } else {
    return undefined;
  }

  if (!Number.isFinite(parsed) || Math.abs(parsed) > POSTGRES_REAL_MAX) return undefined;
  return parsed;
}

function parseOptionalId(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const parsed = parsePositiveInteger(value);
  if (parsed === undefined) throw new Error(`INVALID_ID:${field}`);
  return parsed;
}

function parseRequiredId(value: unknown, field: string): number {
  const parsed = parsePositiveInteger(value);
  if (parsed === undefined) throw new Error(`INVALID_ID:${field}`);
  return parsed;
}

function handleInvalidId(res: any, err: unknown) {
  if (!(err instanceof Error) || !err.message.startsWith("INVALID_ID:")) return false;
  res.status(400).json({ error: `Geçersiz ${err.message.slice("INVALID_ID:".length)}` });
  return true;
}

async function resolveCompanyId(role: string, sessionCompanyId: number, requested: unknown) {
  const requestedCompanyId = parseOptionalId(requested, "companyId");
  const companyId = isSuperAdmin(role) ? (requestedCompanyId ?? sessionCompanyId) : sessionCompanyId;
  const [company] = await db.select({ id: companiesTable.id }).from(companiesTable)
    .where(eq(companiesTable.id, companyId));
  if (!company) throw new Error("INVALID_ID:companyId");
  return companyId;
}

async function validateVariableValueScope(args: {
  role: string;
  sessionUnitId: number | null;
  companyId: number;
  scopeType: string;
  unitId: number | null;
  subUnitId: number | null;
  meterId: number | null;
  write: boolean;
}) {
  const { role, sessionUnitId, companyId, scopeType, unitId, subUnitId, meterId, write } = args;
  const standard = !isCompanyAdmin(role) && !isSuperAdmin(role);

  if (scopeType === "company") {
    if (unitId !== null || subUnitId !== null || meterId !== null) throw new Error("SCOPE:Şirket kapsamlı değişkende birim/alt birim/sayaç seçilemez");
    if (standard && write) throw new Error("FORBIDDEN:Şirket kapsamlı değerleri yalnız yöneticiler değiştirebilir");
    return;
  }
  if (unitId === null) throw new Error("SCOPE:Birim seçimi zorunludur");
  if (standard && (sessionUnitId === null || unitId !== sessionUnitId)) throw new Error("FORBIDDEN:Yetki yok");

  const [unit] = await db.select({ id: unitsTable.id }).from(unitsTable)
    .where(and(eq(unitsTable.id, unitId), eq(unitsTable.companyId, companyId)));
  if (!unit) throw new Error("SCOPE:Birim seçilen şirkete ait değil");

  if (scopeType === "unit") {
    if (subUnitId !== null || meterId !== null) throw new Error("SCOPE:Birim kapsamlı değişkende alt birim/sayaç seçilemez");
    return;
  }
  if (subUnitId === null) throw new Error("SCOPE:Alt birim seçimi zorunludur");
  const [subUnit] = await db.select({ id: subUnitsTable.id }).from(subUnitsTable)
    .where(and(eq(subUnitsTable.id, subUnitId), eq(subUnitsTable.companyId, companyId), eq(subUnitsTable.unitId, unitId)));
  if (!subUnit) throw new Error("SCOPE:Alt birim seçilen birime ait değil");

  if (scopeType === "sub_unit") {
    if (meterId !== null) throw new Error("SCOPE:Alt birim kapsamlı değişkende sayaç seçilemez");
    return;
  }
  if (scopeType !== "meter" || meterId === null) throw new Error("SCOPE:Sayaç seçimi zorunludur");
  const [meter] = await db.select({ id: metersTable.id }).from(metersTable)
    .where(and(
      eq(metersTable.id, meterId),
      eq(metersTable.companyId, companyId),
      eq(metersTable.unitId, unitId),
      eq(metersTable.subUnitId, subUnitId),
    ));
  if (!meter) throw new Error("SCOPE:Sayaç seçilen birim/alt birime ait değil");
}

async function validateValueQueryHierarchy(
  companyId: number | null,
  unitId: number | null | undefined,
  subUnitId: number | null | undefined,
  meterId: number | null | undefined,
) {
  if (unitId !== undefined && unitId !== null) {
    const conditions = [eq(unitsTable.id, unitId)];
    if (companyId !== null) conditions.push(eq(unitsTable.companyId, companyId));
    const [unit] = await db.select({ id: unitsTable.id }).from(unitsTable).where(and(...conditions));
    if (!unit) throw new Error("FORBIDDEN:Yetki yok");
  }
  if (subUnitId !== undefined && subUnitId !== null) {
    const conditions = [eq(subUnitsTable.id, subUnitId)];
    if (companyId !== null) conditions.push(eq(subUnitsTable.companyId, companyId));
    if (unitId !== undefined && unitId !== null) conditions.push(eq(subUnitsTable.unitId, unitId));
    const [subUnit] = await db.select({ id: subUnitsTable.id }).from(subUnitsTable).where(and(...conditions));
    if (!subUnit) throw new Error("FORBIDDEN:Yetki yok");
  }
  if (meterId !== undefined && meterId !== null) {
    const conditions = [eq(metersTable.id, meterId)];
    if (companyId !== null) conditions.push(eq(metersTable.companyId, companyId));
    if (unitId !== undefined && unitId !== null) conditions.push(eq(metersTable.unitId, unitId));
    if (subUnitId !== undefined && subUnitId !== null) conditions.push(eq(metersTable.subUnitId, subUnitId));
    const [meter] = await db.select({ id: metersTable.id }).from(metersTable).where(and(...conditions));
    if (!meter) throw new Error("FORBIDDEN:Yetki yok");
  }
}

function handleScopeError(res: any, err: unknown) {
  if (!(err instanceof Error)) return false;
  if (err.message.startsWith("SCOPE:")) {
    res.status(400).json({ error: err.message.slice(6) }); return true;
  }
  if (err.message.startsWith("FORBIDDEN:")) {
    res.status(403).json({ error: err.message.slice(10) }); return true;
  }
  return handleInvalidId(res, err);
}

function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// ── Variables ─────────────────────────────────────────────

// GET /api/variables
router.get("/variables", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    const requestedCompanyId = parseOptionalId(req.query.companyId, "companyId");
    const conditions: SQL[] = [];
    if (!isSuperAdmin(role)) conditions.push(eq(variablesTable.companyId, sessionCompanyId));
    else if (requestedCompanyId !== undefined && requestedCompanyId !== null) conditions.push(eq(variablesTable.companyId, requestedCompanyId));

    const rows = conditions.length
      ? await db.select().from(variablesTable).where(and(...conditions)).orderBy(variablesTable.createdAt)
      : await db.select().from(variablesTable).orderBy(variablesTable.createdAt);
    res.json(rows);
  } catch (err) {
    if (handleInvalidId(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/variables
router.post("/variables", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    if (!isCompanyAdmin(role) && !isSuperAdmin(role)) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const { name, code, category, unitLabel, variableType, sourceType, scopeType, description, isActive } = req.body;

    const normalizedName = typeof name === "string" ? name.trim() : "";
    if (!normalizedName || !category) {
      res.status(400).json({ error: "Ad ve kategori zorunludur" }); return;
    }
    if (normalizedName.length > VARIABLE_NAME_MAX_LENGTH) {
      res.status(400).json({ error: `Değişken adı en fazla ${VARIABLE_NAME_MAX_LENGTH} karakter olabilir` }); return;
    }
    const effectiveVariableType = variableType === undefined ? "numeric" : variableType;
    if (typeof effectiveVariableType !== "string" || !VARIABLE_TYPES.has(effectiveVariableType)) {
      res.status(400).json({ error: "Geçersiz değişken türü" }); return;
    }
    const effectiveScopeType = scopeType === undefined ? "company" : scopeType;
    if (typeof effectiveScopeType !== "string" || !VARIABLE_SCOPE_TYPES.has(effectiveScopeType)) {
      res.status(400).json({ error: "Geçersiz kapsam türü" }); return;
    }

    const targetCompanyId = await resolveCompanyId(role, sessionCompanyId, req.body.companyId);

    const [variable] = await db.insert(variablesTable).values({
      companyId: targetCompanyId,
      name: normalizedName,
      code: code || null,
      category: category || "operational",
      unitLabel: unitLabel || null,
      variableType: effectiveVariableType,
      sourceType: sourceType || "operation_manual",
      scopeType: effectiveScopeType,
      description: description || null,
      isSystemVariable: false,
      isActive: isActive !== undefined ? isActive : true,
    }).returning();

    res.status(201).json(variable);
  } catch (err) {
    if (handleInvalidId(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PUT /api/variables/:id
router.put("/variables/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    if (!isCompanyAdmin(role) && !isSuperAdmin(role)) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const id = parseRequiredId(req.params.id, "variableId");

    const scopeConditions = [eq(variablesTable.id, id)];
    if (!isSuperAdmin(role)) scopeConditions.push(eq(variablesTable.companyId, sessionCompanyId));
    const [existing] = await db.select().from(variablesTable).where(and(...scopeConditions));
    if (!existing) { res.status(404).json({ error: "Değişken bulunamadı" }); return; }

    const { name, code, category, unitLabel, variableType, sourceType, scopeType, description, isActive } = req.body;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) {
      const normalizedName = typeof name === "string" ? name.trim() : "";
      if (!normalizedName) {
        res.status(400).json({ error: "Değişken adı zorunludur" }); return;
      }
      if (normalizedName.length > VARIABLE_NAME_MAX_LENGTH) {
        res.status(400).json({ error: `Değişken adı en fazla ${VARIABLE_NAME_MAX_LENGTH} karakter olabilir` }); return;
      }
      updates.name = normalizedName;
    }
    if (code !== undefined) updates.code = code || null;
    if (category !== undefined) updates.category = category;
    if (unitLabel !== undefined) updates.unitLabel = unitLabel || null;
    if (variableType !== undefined) {
      if (typeof variableType !== "string" || !VARIABLE_TYPES.has(variableType)) {
        res.status(400).json({ error: "Geçersiz değişken türü" }); return;
      }
      updates.variableType = variableType;
    }
    if (sourceType !== undefined && !existing.isSystemVariable) updates.sourceType = sourceType;
    if (scopeType !== undefined) {
      if (typeof scopeType !== "string" || !VARIABLE_SCOPE_TYPES.has(scopeType)) {
        res.status(400).json({ error: "Geçersiz kapsam türü" }); return;
      }
      updates.scopeType = scopeType;
    }
    if (description !== undefined) updates.description = description || null;
    if (isActive !== undefined) updates.isActive = isActive;

    const [updated] = await db.update(variablesTable).set(updates).where(and(...scopeConditions)).returning();
    res.json(updated);
  } catch (err) {
    if (handleInvalidId(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/variables/:id
router.delete("/variables/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    if (!isCompanyAdmin(role) && !isSuperAdmin(role)) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const id = parseRequiredId(req.params.id, "variableId");

    const scopeConditions = [eq(variablesTable.id, id)];
    if (!isSuperAdmin(role)) scopeConditions.push(eq(variablesTable.companyId, sessionCompanyId));
    const deleteResult = await db.transaction(async (tx) => {
      const [existing] = await tx.select({
        id: variablesTable.id,
        companyId: variablesTable.companyId,
        isSystemVariable: variablesTable.isSystemVariable,
      }).from(variablesTable).where(and(...scopeConditions)).limit(1).for("update");
      if (!existing) return "not_found" as const;
      if (existing.isSystemVariable) return "system" as const;

      const [value] = await tx.select({ id: variableValuesTable.id })
        .from(variableValuesTable)
        .where(and(
          eq(variableValuesTable.variableId, id),
          eq(variableValuesTable.companyId, existing.companyId),
        ))
        .limit(1);
      const [baselineVariable] = await tx.select({ id: energyBaselineVariablesTable.id })
        .from(energyBaselineVariablesTable)
        .innerJoin(energyBaselinesTable, eq(energyBaselineVariablesTable.baselineId, energyBaselinesTable.id))
        .where(and(
          eq(energyBaselineVariablesTable.variableId, id),
          eq(energyBaselinesTable.companyId, existing.companyId),
        ))
        .limit(1);
      if (value || baselineVariable) return "dependent" as const;

      const [deleted] = await tx.delete(variablesTable)
        .where(and(
          eq(variablesTable.id, id),
          eq(variablesTable.companyId, existing.companyId),
        ))
        .returning({ id: variablesTable.id });
      return deleted ? "deleted" as const : "not_found" as const;
    });

    if (deleteResult === "not_found") { res.status(404).send(); return; }
    if (deleteResult === "system") {
      res.status(403).json({ error: "Sistem değişkenleri silinemez" }); return;
    }
    if (deleteResult === "dependent") {
      res.status(409).json({ error: "Bu değişkene bağlı kayıtlar bulunduğu için silinemez." });
      return;
    }
    res.status(204).send();
  } catch (err) {
    if (handleInvalidId(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── Variable Values ───────────────────────────────────────

// GET /api/variable-values
router.get("/variable-values", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const requestedCompanyId = parseOptionalId(req.query.companyId, "companyId");
    const variableId = parseOptionalId(req.query.variableId, "variableId");
    const unitId = parseOptionalId(req.query.unitId, "unitId");
    const subUnitId = parseOptionalId(req.query.subUnitId, "subUnitId");
    const meterId = parseOptionalId(req.query.meterId, "meterId");
    const standard = !isCompanyAdmin(role) && !isSuperAdmin(role);
    if (standard && sessionUnitId === null) {
      res.json([]);
      return;
    }
    const conditions: SQL[] = [];
    const queryCompanyId = !isSuperAdmin(role) ? sessionCompanyId : (requestedCompanyId ?? null);
    if (!isSuperAdmin(role)) {
      conditions.push(eq(variableValuesTable.companyId, sessionCompanyId));
      conditions.push(eq(variablesTable.companyId, sessionCompanyId));
    } else if (requestedCompanyId !== undefined && requestedCompanyId !== null) {
      conditions.push(eq(variableValuesTable.companyId, requestedCompanyId));
      conditions.push(eq(variablesTable.companyId, requestedCompanyId));
    }
    if (variableId !== undefined && variableId !== null) conditions.push(eq(variableValuesTable.variableId, variableId));
    if (unitId !== undefined && unitId !== null && (isCompanyAdmin(role) || isSuperAdmin(role))) conditions.push(eq(variableValuesTable.unitId, unitId));
    if (subUnitId !== undefined && subUnitId !== null && (isCompanyAdmin(role) || isSuperAdmin(role))) conditions.push(eq(variableValuesTable.subUnitId, subUnitId));
    if (meterId !== undefined && meterId !== null && (isCompanyAdmin(role) || isSuperAdmin(role))) conditions.push(eq(variableValuesTable.meterId, meterId));
    if (standard) {
      conditions.push(or(eq(variablesTable.scopeType, "company"), eq(variableValuesTable.unitId, sessionUnitId!))!);
    } else {
      await validateValueQueryHierarchy(queryCompanyId, unitId, subUnitId, meterId);
    }

    const rows = await db
      .select({
        id: variableValuesTable.id,
        companyId: variableValuesTable.companyId,
        variableId: variableValuesTable.variableId,
        unitId: variableValuesTable.unitId,
        subUnitId: variableValuesTable.subUnitId,
        meterId: variableValuesTable.meterId,
        periodStart: variableValuesTable.periodStart,
        periodEnd: variableValuesTable.periodEnd,
        periodType: variableValuesTable.periodType,
        value: variableValuesTable.value,
        source: variableValuesTable.source,
        locationProvince: variableValuesTable.locationProvince,
        locationDistrict: variableValuesTable.locationDistrict,
        dataQuality: variableValuesTable.dataQuality,
        createdAt: variableValuesTable.createdAt,
        updatedAt: variableValuesTable.updatedAt,
        variableName: variablesTable.name,
        variableCode: variablesTable.code,
        variableUnitLabel: variablesTable.unitLabel,
        unitName: unitsTable.name,
        subUnitName: subUnitsTable.name,
        meterName: metersTable.name,
      })
      .from(variableValuesTable)
      .leftJoin(variablesTable, eq(variableValuesTable.variableId, variablesTable.id))
      .leftJoin(unitsTable, eq(variableValuesTable.unitId, unitsTable.id))
      .leftJoin(subUnitsTable, eq(variableValuesTable.subUnitId, subUnitsTable.id))
      .leftJoin(metersTable, eq(variableValuesTable.meterId, metersTable.id))
      .where(and(...conditions))
      .orderBy(variableValuesTable.periodStart);
    res.json(rows);
  } catch (err) {
    if (handleScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/variable-values
router.post("/variable-values", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const { variableId, unitId, subUnitId, meterId, periodStart, periodEnd, periodType, value, source, locationProvince, locationDistrict, dataQuality } = req.body;

    if (!variableId || !periodStart || !periodEnd || value === undefined || value === null) {
      res.status(400).json({ error: "Zorunlu alanlar eksik" }); return;
    }
    if (!isValidIsoDate(periodStart) || !isValidIsoDate(periodEnd)) {
      res.status(400).json({ error: "Geçersiz dönem" }); return;
    }

    // Sayısal değer doğrulama
    const numericValue = parseFiniteReal(value);
    if (numericValue === undefined) {
      res.status(400).json({ error: "Değer sayısal olmalıdır" }); return;
    }

    // Dönem sıralaması doğrulama
    if (periodStart > periodEnd) {
      res.status(400).json({ error: "Dönem başlangıcı, dönem bitişinden büyük olamaz" }); return;
    }

    const parsedVariableId = parseRequiredId(variableId, "variableId");
    const parsedUnitId = parseOptionalId(unitId, "unitId") ?? null;
    const parsedSubUnitId = parseOptionalId(subUnitId, "subUnitId") ?? null;
    const parsedMeterId = parseOptionalId(meterId, "meterId") ?? null;
    const requestedCompanyId = parseOptionalId(req.body.companyId, "companyId");
    const variableConditions = [eq(variablesTable.id, parsedVariableId)];
    if (!isSuperAdmin(role)) variableConditions.push(eq(variablesTable.companyId, sessionCompanyId));
    else if (requestedCompanyId !== undefined && requestedCompanyId !== null) variableConditions.push(eq(variablesTable.companyId, requestedCompanyId));
    const [variable] = await db.select().from(variablesTable).where(and(...variableConditions));
    if (!variable) { res.status(400).json({ error: "Değişken bulunamadı" }); return; }

    const targetCompanyId = variable.companyId;
    if (role !== "superadmin" && targetCompanyId !== sessionCompanyId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    await validateVariableValueScope({
      role, sessionUnitId, companyId: targetCompanyId, scopeType: variable.scopeType,
      unitId: parsedUnitId, subUnitId: parsedSubUnitId, meterId: parsedMeterId, write: true,
    });

    // Kapsam doğrulama
    const scope = variable.scopeType;
    const hasUnit   = !!unitId;
    const hasSub    = !!subUnitId;
    const hasMeter  = !!meterId;
    if (scope === "company" && (hasUnit || hasSub || hasMeter)) {
      res.status(400).json({ error: "Şirket kapsamlı değişkende birim/alt birim/sayaç seçilemez" }); return;
    }
    if (scope === "unit" && !hasUnit) {
      res.status(400).json({ error: "Birim kapsamlı değişkende birim seçimi zorunludur" }); return;
    }
    if (scope === "sub_unit" && (!hasUnit || !hasSub)) {
      res.status(400).json({ error: "Alt birim kapsamlı değişkende birim ve alt birim seçimi zorunludur" }); return;
    }
    if (scope === "meter" && (!hasUnit || !hasSub || !hasMeter)) {
      res.status(400).json({ error: "Sayaç kapsamlı değişkende birim, alt birim ve sayaç seçimi zorunludur" }); return;
    }

    // Dönem bazlı duplicate kontrolü
    const dupConditions = [
      eq(variableValuesTable.companyId, targetCompanyId),
      eq(variableValuesTable.variableId, parsedVariableId),
      eq(variableValuesTable.periodStart, periodStart),
      eq(variableValuesTable.periodEnd, periodEnd),
      parsedUnitId !== null ? eq(variableValuesTable.unitId, parsedUnitId) : isNull(variableValuesTable.unitId),
      parsedSubUnitId !== null ? eq(variableValuesTable.subUnitId, parsedSubUnitId) : isNull(variableValuesTable.subUnitId),
      parsedMeterId !== null ? eq(variableValuesTable.meterId, parsedMeterId) : isNull(variableValuesTable.meterId),
    ];
    const [dupVal] = await db
      .select({ id: variableValuesTable.id })
      .from(variableValuesTable)
      .where(and(...dupConditions));
    if (dupVal) {
      res.status(409).json({ error: "Bu kapsam ve dönem için değer zaten mevcut" }); return;
    }

    const [record] = await db.insert(variableValuesTable).values({
      companyId: targetCompanyId,
      variableId: parsedVariableId,
      unitId: parsedUnitId,
      subUnitId: parsedSubUnitId,
      meterId: parsedMeterId,
      periodStart,
      periodEnd,
      periodType: periodType || "monthly",
      value: numericValue,
      source: source || null,
      locationProvince: locationProvince || null,
      locationDistrict: locationDistrict || null,
      dataQuality: dataQuality || null,
    }).returning();

    res.status(201).json(record);
  } catch (err) {
    if (handleScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PUT /api/variable-values/:id
router.put("/variable-values/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseRequiredId(req.params.id, "variableValueId");

    const valueConditions = [eq(variableValuesTable.id, id)];
    if (!isSuperAdmin(role)) valueConditions.push(eq(variableValuesTable.companyId, sessionCompanyId));
    if (!isCompanyAdmin(role) && !isSuperAdmin(role)) valueConditions.push(eq(variableValuesTable.unitId, sessionUnitId ?? -1));
    const [existing] = await db.select().from(variableValuesTable).where(and(...valueConditions));
    if (!existing) { res.status(404).json({ error: "Kayıt bulunamadı" }); return; }

    if (role !== "superadmin" && existing.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    const { variableId, periodStart, periodEnd, periodType, value, source, locationProvince, locationDistrict, dataQuality, unitId, subUnitId, meterId } = req.body;
    parseOptionalId(req.body.companyId, "companyId");
    const effectiveVariableId = variableId === undefined ? existing.variableId : parseRequiredId(variableId, "variableId");
    const effectiveUnitId = unitId === undefined ? existing.unitId : (parseOptionalId(unitId, "unitId") ?? null);
    const effectiveSubId = subUnitId === undefined ? existing.subUnitId : (parseOptionalId(subUnitId, "subUnitId") ?? null);
    const effectiveMeterId = meterId === undefined ? existing.meterId : (parseOptionalId(meterId, "meterId") ?? null);

    // Sayısal değer doğrulama
    const numericValue = value === undefined ? undefined : parseFiniteReal(value);
    if (value !== undefined) {
      if (numericValue === undefined) {
        res.status(400).json({ error: "Değer sayısal olmalıdır" }); return;
      }
    }

    // Dönem sıralaması doğrulama
    const effectivePeriodStart = periodStart !== undefined ? periodStart : existing.periodStart;
    const effectivePeriodEnd   = periodEnd   !== undefined ? periodEnd   : existing.periodEnd;
    if (!isValidIsoDate(effectivePeriodStart) || !isValidIsoDate(effectivePeriodEnd)) {
      res.status(400).json({ error: "Geçersiz dönem" }); return;
    }
    if (effectivePeriodStart > effectivePeriodEnd) {
      res.status(400).json({ error: "Dönem başlangıcı, dönem bitişinden büyük olamaz" }); return;
    }

    // Kapsam doğrulama (değişkenin scopeType'ına göre)
    const [varForScope] = await db.select().from(variablesTable).where(and(
      eq(variablesTable.id, effectiveVariableId),
      eq(variablesTable.companyId, existing.companyId),
    ));
    if (!varForScope) { res.status(400).json({ error: "Değişken bulunamadı" }); return; }
    if (varForScope) {
      const scope = varForScope.scopeType;
      await validateVariableValueScope({
        role, sessionUnitId, companyId: existing.companyId, scopeType: scope,
        unitId: effectiveUnitId, subUnitId: effectiveSubId, meterId: effectiveMeterId, write: true,
      });

      if (scope === "company" && (effectiveUnitId || effectiveSubId || effectiveMeterId)) {
        res.status(400).json({ error: "Şirket kapsamlı değişkende birim/alt birim/sayaç seçilemez" }); return;
      }
      if (scope === "unit" && !effectiveUnitId) {
        res.status(400).json({ error: "Birim kapsamlı değişkende birim seçimi zorunludur" }); return;
      }
      if (scope === "sub_unit" && (!effectiveUnitId || !effectiveSubId)) {
        res.status(400).json({ error: "Alt birim kapsamlı değişkende birim ve alt birim seçimi zorunludur" }); return;
      }
      if (scope === "meter" && (!effectiveUnitId || !effectiveSubId || !effectiveMeterId)) {
        res.status(400).json({ error: "Sayaç kapsamlı değişkende birim, alt birim ve sayaç seçimi zorunludur" }); return;
      }

      // Dönem bazlı duplicate kontrolü (kendi kaydı hariç)
      const putDupConditions = [
        eq(variableValuesTable.companyId, existing.companyId),
        eq(variableValuesTable.variableId, effectiveVariableId),
        eq(variableValuesTable.periodStart, effectivePeriodStart),
        eq(variableValuesTable.periodEnd, effectivePeriodEnd),
        effectiveUnitId !== null ? eq(variableValuesTable.unitId, effectiveUnitId) : isNull(variableValuesTable.unitId),
        effectiveSubId !== null ? eq(variableValuesTable.subUnitId, effectiveSubId) : isNull(variableValuesTable.subUnitId),
        effectiveMeterId !== null ? eq(variableValuesTable.meterId, effectiveMeterId) : isNull(variableValuesTable.meterId),
        ne(variableValuesTable.id, id),
      ];
      const [putDupVal] = await db
        .select({ id: variableValuesTable.id })
        .from(variableValuesTable)
        .where(and(...putDupConditions));
      if (putDupVal) {
        res.status(409).json({ error: "Bu kapsam ve dönem için değer zaten mevcut" }); return;
      }
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (variableId !== undefined) updates.variableId = effectiveVariableId;
    if (periodStart !== undefined) updates.periodStart = periodStart;
    if (periodEnd !== undefined) updates.periodEnd = periodEnd;
    if (periodType !== undefined) updates.periodType = periodType;
    if (value !== undefined) updates.value = numericValue;
    if (source !== undefined) updates.source = source || null;
    if (locationProvince !== undefined) updates.locationProvince = locationProvince || null;
    if (locationDistrict !== undefined) updates.locationDistrict = locationDistrict || null;
    if (dataQuality !== undefined) updates.dataQuality = dataQuality || null;
    if (unitId !== undefined) updates.unitId = effectiveUnitId;
    if (subUnitId !== undefined) updates.subUnitId = effectiveSubId;
    if (meterId !== undefined) updates.meterId = effectiveMeterId;

    const [updated] = await db.update(variableValuesTable).set(updates).where(and(...valueConditions)).returning();
    res.json(updated);
  } catch (err) {
    if (handleScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/variable-values/:id
router.delete("/variable-values/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseRequiredId(req.params.id, "variableValueId");

    const valueConditions = [eq(variableValuesTable.id, id)];
    if (!isSuperAdmin(role)) valueConditions.push(eq(variableValuesTable.companyId, sessionCompanyId));
    if (!isCompanyAdmin(role) && !isSuperAdmin(role)) valueConditions.push(eq(variableValuesTable.unitId, sessionUnitId ?? -1));
    const [existing] = await db.select().from(variableValuesTable).where(and(...valueConditions));
    if (!existing) { res.status(404).send(); return; }

    if (role !== "superadmin" && existing.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    await db.delete(variableValuesTable).where(and(...valueConditions));
    res.status(204).send();
  } catch (err) {
    if (handleInvalidId(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/variable-values/batch — toplu içe aktarma
router.post("/variable-values/batch", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "Geçerli satır dizisi gerekli" }); return;
    }
    if (rows.length > 5000) {
      res.status(400).json({ error: "En fazla 5000 satır içe aktarılabilir" }); return;
    }

    const targetCompanyId = await resolveCompanyId(role, sessionCompanyId, req.body.companyId);
    const isPrivileged = isSuperAdmin(role) || isCompanyAdmin(role);

    // Standard users without a unitId cannot import (no scope to write into)
    if (!isPrivileged && sessionUnitId === null) {
      res.status(403).json({ error: "Birim yetkisi olmayan kullanıcılar toplu içe aktarma yapamaz" }); return;
    }

    // Load lookup data
    const allVariables = await db.select().from(variablesTable)
      .where(eq(variablesTable.companyId, targetCompanyId));
    const allUnits = await db.select().from(unitsTable)
      .where(eq(unitsTable.companyId, targetCompanyId));
    const allSubUnits = await db.select().from(subUnitsTable)
      .where(eq(subUnitsTable.companyId, targetCompanyId));

    let imported = 0;
    const errors: { row: number; message: string }[] = [];

    for (const [i, row] of rows.entries()) {
      const rowNum = i + 1;
      try {
        // Resolve variable
        const varName = String(row.variable_name ?? row.variableName ?? "").trim();
        if (!varName) {
          errors.push({ row: rowNum, message: "Değişken adı boş olamaz" }); continue;
        }
        const variable = allVariables.find(v =>
          v.name.toLowerCase().trim() === varName.toLowerCase() && v.isActive
        );
        if (!variable) {
          errors.push({ row: rowNum, message: `Değişken bulunamadı veya pasif: "${varName}"` }); continue;
        }
        if (variable.isSystemVariable) {
          errors.push({ row: rowNum, message: `"${varName}" bir sistem değişkenidir; içe aktarılamaz` }); continue;
        }

        // year / month validation
        const year = parsePositiveInteger(row.year);
        const month = parsePositiveInteger(row.month);
        if (!year || year < 2000 || year > 2100) {
          errors.push({ row: rowNum, message: `Geçersiz yıl: ${row.year}` }); continue;
        }
        if (!month || month < 1 || month > 12) {
          errors.push({ row: rowNum, message: `Geçersiz ay (1-12): ${row.month}` }); continue;
        }

        // value validation
        const numericValue = parseFiniteReal(row.value);
        if (numericValue === undefined) {
          errors.push({ row: rowNum, message: `Geçersiz değer: "${row.value}"` }); continue;
        }

        // Build period dates
        const mm = String(month).padStart(2, "0");
        const lastDay = new Date(year, month, 0).getDate();
        const periodStart = `${year}-${mm}-01`;
        const periodEnd = `${year}-${mm}-${String(lastDay).padStart(2, "0")}`;

        // Resolve unit
        let resolvedUnitId: number | null = null;
        const unitNameRaw = String(row.unit_name ?? row.unitName ?? "").trim();
        if (unitNameRaw) {
          const unit = allUnits.find(u => u.name.toLowerCase().trim() === unitNameRaw.toLowerCase());
          if (!unit) {
            errors.push({ row: rowNum, message: `Birim bulunamadı: "${unitNameRaw}"` }); continue;
          }
          if (!isPrivileged && sessionUnitId !== null && unit.id !== sessionUnitId) {
            errors.push({ row: rowNum, message: `Bu birim için yetkiniz yok: "${unitNameRaw}"` }); continue;
          }
          resolvedUnitId = unit.id;
        } else if (!isPrivileged && sessionUnitId !== null) {
          resolvedUnitId = sessionUnitId;
        }

        // Resolve sub_unit
        let resolvedSubUnitId: number | null = null;
        const subUnitNameRaw = String(row.sub_unit_name ?? row.subUnitName ?? "").trim();
        if (subUnitNameRaw) {
          const candidates = resolvedUnitId
            ? allSubUnits.filter(s => s.unitId === resolvedUnitId)
            : allSubUnits.filter(s => allUnits.some(u => u.id === s.unitId));
          const sub = candidates.find(s => s.name.toLowerCase().trim() === subUnitNameRaw.toLowerCase());
          if (!sub) {
            errors.push({ row: rowNum, message: `Alt birim bulunamadı: "${subUnitNameRaw}"` }); continue;
          }
          resolvedSubUnitId = sub.id;
        }

        // Scope validation (matches single-create rules)
        const scope = variable.scopeType;
        if (!isPrivileged && scope === "company") {
          errors.push({ row: rowNum, message: `"${varName}" şirket kapsamlı; bu kapsamı yalnız yöneticiler içe aktarabilir` }); continue;
        }
        if (scope === "company" && (resolvedUnitId || resolvedSubUnitId)) {
          errors.push({ row: rowNum, message: `"${varName}" şirket kapsamlı; birim/alt birim belirtilemez` }); continue;
        }
        if (scope === "unit" && !resolvedUnitId) {
          errors.push({ row: rowNum, message: `"${varName}" birim kapsamlı; unit_name zorunlu` }); continue;
        }
        if (scope === "sub_unit" && (!resolvedUnitId || !resolvedSubUnitId)) {
          errors.push({ row: rowNum, message: `"${varName}" alt birim kapsamlı; unit_name ve sub_unit_name zorunlu` }); continue;
        }
        if (scope === "meter") {
          errors.push({ row: rowNum, message: `"${varName}" sayaç kapsamlı; Excel import ile sayaç seçimi desteklenmiyor, manuel giriş yapın` }); continue;
        }

        // Duplicate check — skip (consistent with consumption batch)
        const dupConditions = [
          eq(variableValuesTable.companyId, targetCompanyId),
          eq(variableValuesTable.variableId, variable.id),
          eq(variableValuesTable.periodStart, periodStart),
          eq(variableValuesTable.periodEnd, periodEnd),
          resolvedUnitId ? eq(variableValuesTable.unitId, resolvedUnitId) : isNull(variableValuesTable.unitId),
          resolvedSubUnitId ? eq(variableValuesTable.subUnitId, resolvedSubUnitId) : isNull(variableValuesTable.subUnitId),
          isNull(variableValuesTable.meterId),
        ];
        const [dup] = await db.select({ id: variableValuesTable.id })
          .from(variableValuesTable)
          .where(and(...dupConditions));
        if (dup) {
          errors.push({ row: rowNum, message: `"${varName}" için ${year}/${month} kaydı zaten mevcut (atlandı)` }); continue;
        }

        await db.insert(variableValuesTable).values({
          companyId: targetCompanyId,
          variableId: variable.id,
          unitId: resolvedUnitId,
          subUnitId: resolvedSubUnitId,
          meterId: null,
          periodStart,
          periodEnd,
          periodType: "monthly",
          value: numericValue,
          source: String(row.note ?? row.source ?? "").trim() || null,
          locationProvince: null,
          locationDistrict: null,
          dataQuality: null,
        });
        imported++;
      } catch (rowErr: any) {
        errors.push({ row: rowNum, message: rowErr?.message ?? "Bilinmeyen hata" });
      }
    }

    observeImport("variable_values", errors.length > 0 ? (imported > 0 ? "partial" : "failure") : "success", {
      total: rows.length,
      inserted: imported,
      failed: errors.length,
    });
    res.json({ imported, total: rows.length, errors });
  } catch (err) {
    if (handleInvalidId(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── Weather Degree Days ───────────────────────────────────

// GET /api/weather-degree-days
router.get("/weather-degree-days", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    const province = req.query.province as string | undefined;
    const periodType = req.query.periodType as string | undefined;
    const requestedCompanyId = parseOptionalId(req.query.companyId, "companyId");

    if (isSuperAdmin(role) && requestedCompanyId !== undefined && requestedCompanyId !== null) {
      const [company] = await db.select({ id: companiesTable.id }).from(companiesTable)
        .where(eq(companiesTable.id, requestedCompanyId));
      if (!company) {
        res.status(404).json({ error: "Şirket bulunamadı" });
        return;
      }
    }

    const conditions: SQL[] = [];
    if (!isSuperAdmin(role)) {
      conditions.push(or(isNull(weatherDegreeDaysTable.companyId), eq(weatherDegreeDaysTable.companyId, sessionCompanyId))!);
    } else if (requestedCompanyId !== undefined && requestedCompanyId !== null) {
      conditions.push(or(isNull(weatherDegreeDaysTable.companyId), eq(weatherDegreeDaysTable.companyId, requestedCompanyId))!);
    }
    if (province) conditions.push(eq(weatherDegreeDaysTable.province, province));
    if (periodType) conditions.push(eq(weatherDegreeDaysTable.periodType, periodType));

    const rows = await db.select().from(weatherDegreeDaysTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(weatherDegreeDaysTable.date);

    res.json(rows);
  } catch (err) {
    if (handleInvalidId(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/weather-degree-days/sync
// MGM pool'dan sayaçların bulunduğu şehirlerin HDD/CDD verisini weather_degree_days tablosuna aktarır
router.post("/weather-degree-days/sync", requireAuth, requireCompanyAdmin, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    const bodyCompanyId = parseOptionalId(req.body?.companyId, "companyId");
    const queryCompanyId = parseOptionalId(req.query.companyId, "companyId");
    if (bodyCompanyId != null && queryCompanyId != null && bodyCompanyId !== queryCompanyId) {
      res.status(400).json({ error: "Çelişkili companyId" });
      return;
    }
    const effectiveCompanyId = await resolveCompanyId(
      role,
      sessionCompanyId,
      bodyCompanyId ?? queryCompanyId,
    );

    // 1. Bu şirketin birimlerine bağlı tüm sayaç şehirlerini bul
    const unitRows = await db
      .select({ id: unitsTable.id })
      .from(unitsTable)
      .where(eq(unitsTable.companyId, effectiveCompanyId));

    if (unitRows.length === 0) {
      res.json({ synced: 0, provinces: [], message: "Kayıtlı birim bulunamadı" }); return;
    }

    const unitIds = unitRows.map(u => u.id);

    const subUnitRows = await db
      .select({ id: subUnitsTable.id })
      .from(subUnitsTable)
      .where(and(
        eq(subUnitsTable.companyId, effectiveCompanyId),
        inArray(subUnitsTable.unitId, unitIds),
      ));

    const subUnitIds = subUnitRows.map(s => s.id);
    if (subUnitIds.length === 0) {
      res.json({ synced: 0, provinces: [], message: "Kayıtlı alt birim bulunamadı" }); return;
    }

    const meterRows = await db
      .select({ city: metersTable.city })
      .from(metersTable)
      .where(and(
        eq(metersTable.companyId, effectiveCompanyId),
        inArray(metersTable.subUnitId, subUnitIds),
      ));

    const cities = [...new Set(meterRows.map(m => m.city.trim()).filter(Boolean))];
    if (cities.length === 0) {
      res.json({ synced: 0, provinces: [], message: "Sayaçlara bağlı şehir bulunamadı" }); return;
    }

    // 2. Her sayaç şehrini MGM station mapping tablosundan eşleştir (yeni sistem)
    interface CityMapping {
      city: string;
      il: string;
      stationKey: string;
      stationName: string;
      isFallback: boolean;
      fallbackNote: string | null;
    }

    const cityMappings: CityMapping[] = [];
    const unmatchedCities: string[] = [];

    for (const city of cities) {
      const { il, ilce } = parseIlIlce(city);
      // İlçe bazlı eşleşme
      let mapping = ilce ? await lookupStationKeyByLocation(il, ilce) : null;
      const isFallback = !mapping;
      // İl merkezi fallback
      if (!mapping) mapping = await lookupStationKeyByLocation(il, null);
      if (!mapping) { unmatchedCities.push(city); continue; }
      const fallbackNote = isFallback && ilce
        ? `"${city}" için birebir MGM istasyonu bulunamadı. ${il} iline ait "${mapping.stationName ?? il}" istasyonu kullanıldı.`
        : null;
      cityMappings.push({
        city,
        il,
        stationKey: mapping.stationKey,
        stationName: mapping.stationName ?? il,
        isFallback,
        fallbackNote,
      });
    }

    if (cityMappings.length === 0) {
      res.json({
        synced: 0,
        provinces: [],
        message: `Sayaç şehirleri MGM istasyon mapping tablosunda eşleşmedi (Aranan: ${cities.join(", ")})`,
      });
      return;
    }

    // 3. Her city → stationKey için resmi degree verisi çek
    const uniqueStationKeys = [...new Set(cityMappings.map(m => m.stationKey))];

    // resmi kayıtları station_key üzerinden al
    const degreeRows = await db
      .select()
      .from(weatherDegreeDaysTable)
      .where(
        and(
          eq(weatherDegreeDaysTable.isOfficial, true),
          inArray(weatherDegreeDaysTable.stationKey as any, uniqueStationKeys)
        )
      );

    if (degreeRows.length === 0) {
      res.json({ synced: 0, provinces: [], message: "Bu istasyonlar için resmi MGM verisi bulunamadı. Önce Excel import yapın." }); return;
    }

    // stationKey → bu istasyonu kullanan tüm şehir mapping'leri
    const stationToCities = new Map<string, CityMapping[]>();
    for (const mapping of cityMappings) {
      const arr = stationToCities.get(mapping.stationKey) ?? [];
      arr.push(mapping);
      stationToCities.set(mapping.stationKey, arr);
    }

    // 4. Sadece isOfficial=false, bu şirkete ait eski hesaplanmış kayıtları sil
    const provinceList = [...new Set(cityMappings.map(m => m.il))];
    await db
      .delete(weatherDegreeDaysTable)
      .where(
        and(
          eq(weatherDegreeDaysTable.companyId, effectiveCompanyId),
          inArray(weatherDegreeDaysTable.province, provinceList),
          eq(weatherDegreeDaysTable.periodType, "monthly"),
          eq(weatherDegreeDaysTable.source, "mgm"),
          eq(weatherDegreeDaysTable.isOfficial, false),
        )
      );

    // 5. Her resmi degree satırı × bu istasyonu kullanan her şehir eşleşmesi için kayıt oluştur
    type WDDInsert = typeof weatherDegreeDaysTable.$inferInsert;
    const toInsert: WDDInsert[] = [];
    for (const degreeRow of degreeRows) {
      const sk = degreeRow.stationKey;
      const mappings = sk ? stationToCities.get(sk) ?? [] : [];
      for (const mapping of mappings) {
        toInsert.push({
          companyId: effectiveCompanyId,
          province: mapping.il,
          district: null,
          stationCode: degreeRow.stationCode,
          stationName: mapping.stationName,
          stationNote: mapping.fallbackNote,
          date: `${degreeRow.year}-${String(degreeRow.month).padStart(2, "0")}`,
          year: degreeRow.year,
          month: degreeRow.month,
          periodType: "monthly",
          baseTemperatureHeating: 18,
          baseTemperatureCooling: 22,
          hdd: degreeRow.hdd,
          cdd: degreeRow.cdd,
          avgTemperature: null,
          source: "mgm",
          isOfficial: false,
          dataMethod: "official_monthly",
        });
      }
    }

    // 500'lük batch insert
    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      await db.insert(weatherDegreeDaysTable).values(toInsert.slice(i, i + CHUNK));
      inserted += Math.min(CHUNK, toInsert.length - i);
    }

    const fallbackCount = cityMappings.filter(m => m.isFallback).length;
    const fallbackMsg = fallbackCount > 0 ? ` (${fallbackCount} şehir için fallback istasyon kullanıldı)` : "";
    const unmatchedMsg = unmatchedCities.length > 0 ? ` | Eşleşemeyen: ${unmatchedCities.join(", ")}` : "";

    res.json({
      synced: inserted,
      provinces: provinceList,
      stations: uniqueStationKeys.length,
      message: `${provinceList.join(", ")} için ${inserted} aylık HDD/CDD kaydı aktarıldı${fallbackMsg}${unmatchedMsg}`,
    });
  } catch (err) {
    if (handleInvalidId(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
