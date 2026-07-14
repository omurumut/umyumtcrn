import { Router } from "express";
import type { Response } from "express";
import { db, energyTargetsTable, consumptionTable, metersTable, energyActionPlansTable, energyTargetProgressTable, vapProjectsTable, unitsTable, subUnitsTable, energySourcesTable, seuAssessmentsTable } from "@workspace/db";
import { eq, and, SQL, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import {
  buildCsv, sendCsvResponse,
  TARGET_STATUS_LABELS, TARGET_TYPE_LABELS, ACTION_STATUS_LABELS, PRIORITY_LABELS,
} from "../lib/csv-export.js";
import { buildXlsx, sendXlsxResponse, type XlsxColDef } from "../lib/xlsx-export.js";

const router = Router();

class BadRequestError extends Error {}

function isCompanyAdmin(role: string) {
  return role === "admin" || role === "kontrol_admin";
}

function isSuperAdmin(role: string) {
  return role === "superadmin";
}

function parsePositiveInteger(value: unknown, field = "id"): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new BadRequestError(`Geçersiz ${field}`);
}

function parseRequiredId(value: unknown, field: string): number {
  const parsed = parsePositiveInteger(value, field);
  if (parsed === undefined) throw new BadRequestError(`Geçersiz ${field}`);
  return parsed;
}

function parseNullableId(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  return parseRequiredId(value, field);
}

function scopedTargetCondition(id: number, role: string, companyId: number, unitId?: number) {
  const conditions: SQL[] = [eq(energyTargetsTable.id, id)];
  if (!isSuperAdmin(role)) conditions.push(eq(energyTargetsTable.companyId, companyId));
  if (!isCompanyAdmin(role) && !isSuperAdmin(role) && unitId !== undefined) {
    conditions.push(eq(energyTargetsTable.unitId, unitId));
  }
  return and(...conditions);
}

async function validateTargetRelations(params: {
  companyId: number;
  unitId: number | null;
  subUnitId: number | null;
  energySourceId: number | null;
  seuAssessmentId: number | null;
}) {
  const { companyId, unitId, subUnitId, energySourceId, seuAssessmentId } = params;

  if (unitId !== null) {
    const [unit] = await db.select({ companyId: unitsTable.companyId })
      .from(unitsTable).where(eq(unitsTable.id, unitId));
    if (!unit || unit.companyId !== companyId) return "Geçersiz birim";
  }

  if (subUnitId !== null) {
    const [subUnit] = await db.select({ companyId: subUnitsTable.companyId, unitId: subUnitsTable.unitId })
      .from(subUnitsTable).where(eq(subUnitsTable.id, subUnitId));
    if (!subUnit || subUnit.companyId !== companyId) return "Geçersiz alt birim";
    if (unitId === null || subUnit.unitId !== unitId) return "Alt birim bu birime ait değil";
  }

  if (energySourceId !== null) {
    const [source] = await db.select({ companyId: energySourcesTable.companyId, unitId: energySourcesTable.unitId })
      .from(energySourcesTable).where(eq(energySourcesTable.id, energySourceId));
    if (!source || source.companyId !== companyId) return "Geçersiz enerji kaynağı";
    if (unitId !== null && source.unitId !== null && source.unitId !== unitId) return "Enerji kaynağı bu birime ait değil";
  }

  if (seuAssessmentId !== null) {
    const [assessment] = await db.select({ companyId: seuAssessmentsTable.companyId, unitId: seuAssessmentsTable.unitId })
      .from(seuAssessmentsTable).where(eq(seuAssessmentsTable.id, seuAssessmentId));
    if (!assessment || assessment.companyId !== companyId) return "Geçersiz ÖEK değerlendirmesi";
    if (assessment.unitId !== null && assessment.unitId !== unitId) return "ÖEK değerlendirmesi bu birime ait değil";
  }

  return null;
}

function handleBadRequest(res: Response, err: unknown) {
  if (!(err instanceof BadRequestError)) return false;
  res.status(400).json({ error: err.message });
  return true;
}

async function resolveTargetListScope(req: Parameters<typeof requireAuth>[0]) {
  const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
  const queryCompanyId = parsePositiveInteger(req.query.companyId, "companyId");
  const queryUnitId = parsePositiveInteger(req.query.unitId, "unitId");
  const querySubUnitId = parsePositiveInteger(req.query.subUnitId, "subUnitId");
  const queryEnergySourceId = parsePositiveInteger(req.query.energySourceId, "energySourceId");

  const companyId = isSuperAdmin(role) ? queryCompanyId : sessionCompanyId;
  const unitId = isCompanyAdmin(role) || isSuperAdmin(role) ? queryUnitId : sessionUnitId ?? undefined;
  const empty = !isCompanyAdmin(role) && !isSuperAdmin(role) && sessionUnitId === null;

  if (unitId !== undefined) {
    const [unit] = await db.select({ companyId: unitsTable.companyId })
      .from(unitsTable).where(eq(unitsTable.id, unitId));
    if (!unit || (companyId !== undefined && unit.companyId !== companyId)) {
      throw new BadRequestError("Geçersiz unitId");
    }
  }

  if (companyId !== undefined && (querySubUnitId !== undefined || queryEnergySourceId !== undefined)) {
    const relationError = await validateTargetRelations({
      companyId,
      unitId: unitId ?? null,
      subUnitId: querySubUnitId ?? null,
      energySourceId: queryEnergySourceId ?? null,
      seuAssessmentId: null,
    });
    if (relationError) throw new BadRequestError(relationError);
  }

  return { companyId, unitId, subUnitId: querySubUnitId, energySourceId: queryEnergySourceId, empty };
}

export async function calcProgress(unitId: number | null, baselineYear: number, targetYear: number, companyId?: number) {
  const currentYear = new Date().getFullYear();
  const endYear = Math.min(targetYear, currentYear);
  const years: number[] = [];
  for (let y = baselineYear; y <= endYear; y++) years.push(y);
  if (years.length === 0) return { baselineKwh: null, yearlyProgress: [] };

  const meterConditions: SQL[] = [];
  if (unitId !== null) meterConditions.push(eq(metersTable.unitId, unitId));
  if (companyId !== undefined) meterConditions.push(eq(metersTable.companyId, companyId));
  const meterRows = meterConditions.length > 0
    ? await db.select({ id: metersTable.id }).from(metersTable).where(and(...meterConditions))
    : await db.select({ id: metersTable.id }).from(metersTable);

  if (meterRows.length === 0) return { baselineKwh: null, yearlyProgress: [] };
  const meterIds = meterRows.map((m) => m.id);

  const rows = await db
    .select({
      year: consumptionTable.year,
      totalKwh: sql<number>`sum(${consumptionTable.kwh})`.as("total_kwh"),
    })
    .from(consumptionTable)
    .where(and(
      inArray(consumptionTable.meterId, meterIds),
      inArray(consumptionTable.year, years),
      ...(companyId !== undefined ? [eq(consumptionTable.companyId, companyId)] : []),
    ))
    .groupBy(consumptionTable.year);

  const kwhByYear: Record<number, number> = {};
  for (const r of rows) kwhByYear[r.year] = r.totalKwh ?? 0;

  const baselineKwh = kwhByYear[baselineYear] ?? null;
  const yearlyProgress = years.map((y) => {
    const actualKwh = kwhByYear[y] ?? null;
    const reductionPercent =
      baselineKwh && actualKwh !== null
        ? parseFloat((((baselineKwh - actualKwh) / baselineKwh) * 100).toFixed(2))
        : null;
    return { year: y, actualKwh, reductionPercent };
  });
  return { baselineKwh, yearlyProgress };
}

// GET /api/targets/export
router.get("/targets/export", requireAuth, async (req, res) => {
  try {
    const scope = await resolveTargetListScope(req);
    if (scope.empty) {
      res.status(403).json({ error: "Export için birim yetkisi gerekli" });
      return;
    }

    const conditions: SQL[] = [];
    if (scope.companyId !== undefined) conditions.push(eq(energyTargetsTable.companyId, scope.companyId));
    if (scope.unitId !== undefined) conditions.push(eq(energyTargetsTable.unitId, scope.unitId));
    if (scope.subUnitId !== undefined) conditions.push(eq(energyTargetsTable.subUnitId, scope.subUnitId));
    if (scope.energySourceId !== undefined) conditions.push(eq(energyTargetsTable.energySourceId, scope.energySourceId));

    const yearParam = req.query.year ? parseInt(req.query.year as string) : undefined;
    const statusParam = req.query.status as string | undefined;
    if (statusParam) conditions.push(eq(energyTargetsTable.status, statusParam));

    // ── Hedefleri çek ─────────────────────────────────────────
    const targets = await db
      .select({
        id: energyTargetsTable.id,
        unitId: energyTargetsTable.unitId,
        subUnitId: energyTargetsTable.subUnitId,
        energySourceId: energyTargetsTable.energySourceId,
        seuAssessmentId: energyTargetsTable.seuAssessmentId,
        objectiveText: energyTargetsTable.objectiveText,
        targetText: energyTargetsTable.targetText,
        targetType: energyTargetsTable.targetType,
        baselineYear: energyTargetsTable.baselineYear,
        baselineValue: energyTargetsTable.baselineValue,
        targetYear: energyTargetsTable.targetYear,
        targetValue: energyTargetsTable.targetValue,
        actualValue: energyTargetsTable.actualValue,
        unitLabel: energyTargetsTable.unitLabel,
        targetReductionPercent: energyTargetsTable.targetReductionPercent,
        status: energyTargetsTable.status,
        notes: energyTargetsTable.notes,
        unitName: unitsTable.name,
        subUnitName: subUnitsTable.name,
        energySourceName: energySourcesTable.name,
        seuYear: seuAssessmentsTable.year,
      })
      .from(energyTargetsTable)
      .leftJoin(unitsTable, eq(energyTargetsTable.unitId, unitsTable.id))
      .leftJoin(subUnitsTable, eq(energyTargetsTable.subUnitId, subUnitsTable.id))
      .leftJoin(energySourcesTable, eq(energyTargetsTable.energySourceId, energySourcesTable.id))
      .leftJoin(seuAssessmentsTable, eq(energyTargetsTable.seuAssessmentId, seuAssessmentsTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(energyTargetsTable.createdAt);

    // ── Eylem planlarını çek ────────────────────────────────────
    const targetIds = targets.map((t) => t.id);
    const actions =
      targetIds.length > 0
        ? await db
            .select()
            .from(energyActionPlansTable)
            .where(and(
              inArray(energyActionPlansTable.targetId, targetIds),
              ...(scope.companyId !== undefined ? [eq(energyActionPlansTable.companyId, scope.companyId)] : []),
            ))
            .orderBy(energyActionPlansTable.createdAt)
        : [];

    const actionsByTarget: Record<number, typeof actions> = {};
    for (const a of actions) {
      if (!actionsByTarget[a.targetId]) actionsByTarget[a.targetId] = [];
      actionsByTarget[a.targetId].push(a);
    }

    // ── Satır oluşturma ────────────────────────────────────────
    type ExportRow = Record<string, unknown>;
    const rows: ExportRow[] = [];
    for (const t of targets) {
      if (yearParam !== undefined && t.baselineYear !== yearParam && t.targetYear !== yearParam) continue;

      const seuLabel = t.seuYear != null ? `ÖEK ${t.seuYear}` : "";
      const tActions = actionsByTarget[t.id] ?? [];

      if (tActions.length === 0) {
        rows.push({
          yil: `${t.baselineYear}-${t.targetYear}`,
          birim: t.unitName ?? "",
          altBirim: t.subUnitName ?? "",
          enerjiKaynagi: t.energySourceName ?? "",
          ilgiliOek: seuLabel,
          enerjiAmaci: t.objectiveText ?? "",
          enerjiHedfi: t.targetText ?? "",
          hedefTipi: TARGET_TYPE_LABELS[t.targetType ?? ""] ?? t.targetType ?? "",
          bazYil: t.baselineYear,
          bazDeger: t.baselineValue,
          hedefYil: t.targetYear,
          hedefDeger: t.targetValue,
          gerceklesen: t.actualValue,
          olcuBirimi: t.unitLabel ?? "",
          hedefAzaltimOrani: t.targetReductionPercent,
          hedefDurumu: TARGET_STATUS_LABELS[t.status ?? ""] ?? t.status ?? "",
          eylemPlani: "",
          sorumlu: "",
          baslangicTarihi: "",
          bitisTarihi: "",
          oncelik: "",
          beklenenTasarruf: "",
          beklenenMaliTasarruf: "",
          yatirimMaliyeti: "",
          geriOdemeSuresi: "",
          eylemDurumu: "",
          ilerleme: "",
          vapMi: "",
          notlar: t.notes ?? "",
        });
      } else {
        for (const a of tActions) {
          rows.push({
            yil: `${t.baselineYear}-${t.targetYear}`,
            birim: t.unitName ?? "",
            altBirim: t.subUnitName ?? "",
            enerjiKaynagi: t.energySourceName ?? "",
            ilgiliOek: seuLabel,
            enerjiAmaci: t.objectiveText ?? "",
            enerjiHedfi: t.targetText ?? "",
            hedefTipi: TARGET_TYPE_LABELS[t.targetType ?? ""] ?? t.targetType ?? "",
            bazYil: t.baselineYear,
            bazDeger: t.baselineValue,
            hedefYil: t.targetYear,
            hedefDeger: t.targetValue,
            gerceklesen: t.actualValue,
            olcuBirimi: t.unitLabel ?? "",
            hedefAzaltimOrani: t.targetReductionPercent,
            hedefDurumu: TARGET_STATUS_LABELS[t.status ?? ""] ?? t.status ?? "",
            eylemPlani: a.title ?? "",
            sorumlu: a.responsibleName ?? "",
            baslangicTarihi: a.startDate ?? "",
            bitisTarihi: a.dueDate ?? "",
            oncelik: PRIORITY_LABELS[a.priority ?? ""] ?? a.priority ?? "",
            beklenenTasarruf: a.expectedSavingValue != null ? `${a.expectedSavingValue} ${a.expectedSavingUnit ?? ""}`.trim() : "",
            beklenenMaliTasarruf: a.expectedCostSaving,
            yatirimMaliyeti: a.investmentCost,
            geriOdemeSuresi: a.paybackMonths,
            eylemDurumu: ACTION_STATUS_LABELS[a.status ?? ""] ?? a.status ?? "",
            ilerleme: a.progressPercent != null ? `%${a.progressPercent}` : "",
            vapMi: a.isVap ? "Evet" : "Hayır",
            notlar: a.notes ?? t.notes ?? "",
          });
        }
      }
    }

    // ── Format & başlıklar ────────────────────────────────────
    const format = req.query.format === "xlsx" ? "xlsx" : "csv";

    const HEADERS: XlsxColDef[] = [
      { key: "yil", label: "Yıl" },
      { key: "birim", label: "Birim" },
      { key: "altBirim", label: "Alt Birim" },
      { key: "enerjiKaynagi", label: "Enerji Kaynağı" },
      { key: "ilgiliOek", label: "İlgili ÖEK" },
      { key: "enerjiAmaci", label: "Enerji Amacı", width: 35, wrapText: true },
      { key: "enerjiHedfi", label: "Enerji Hedefi", width: 35, wrapText: true },
      { key: "hedefTipi", label: "Hedef Tipi" },
      { key: "bazYil", label: "Baz Yıl", type: "number" },
      { key: "bazDeger", label: "Baz Değer", type: "number" },
      { key: "hedefYil", label: "Hedef Yıl", type: "number" },
      { key: "hedefDeger", label: "Hedef Değer", type: "number" },
      { key: "gerceklesen", label: "Gerçekleşen Değer", type: "number" },
      { key: "olcuBirimi", label: "Ölçü Birimi" },
      { key: "hedefAzaltimOrani", label: "Hedef Azaltım Oranı (%)", type: "number" },
      { key: "hedefDurumu", label: "Hedef Durumu" },
      { key: "eylemPlani", label: "Eylem Planı", width: 35, wrapText: true },
      { key: "sorumlu", label: "Sorumlu" },
      { key: "baslangicTarihi", label: "Başlangıç Tarihi", type: "date" },
      { key: "bitisTarihi", label: "Bitiş Tarihi", type: "date" },
      { key: "oncelik", label: "Öncelik" },
      { key: "beklenenTasarruf", label: "Beklenen Tasarruf" },
      { key: "beklenenMaliTasarruf", label: "Beklenen Yıllık Mali Tasarruf", type: "number" },
      { key: "yatirimMaliyeti", label: "Yatırım Maliyeti", type: "number" },
      { key: "geriOdemeSuresi", label: "Geri Ödeme Süresi (ay)", type: "number" },
      { key: "eylemDurumu", label: "Eylem Durumu" },
      { key: "ilerleme", label: "İlerleme" },
      { key: "vapMi", label: "VAP mı?" },
      { key: "notlar", label: "Notlar", width: 35, wrapText: true },
    ];

    if (format === "xlsx") {
      const baseName = yearParam
        ? `enerji-amac-hedef-eylem-plani-${yearParam}.xlsx`
        : "enerji-amac-hedef-eylem-plani.xlsx";
      const buf = await buildXlsx("Hedefler & Eylem Planları", HEADERS, rows);
      sendXlsxResponse(res, baseName, buf);
    } else {
      const filename = yearParam
        ? `enerji-amac-hedef-eylem-plani-${yearParam}.csv`
        : "enerji-amac-hedef-eylem-plani.csv";
      const csv = buildCsv(HEADERS, rows);
      sendCsvResponse(res, filename, csv);
    }
  } catch (err) {
    if (handleBadRequest(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Export hatası" });
  }
});

// GET /api/targets
router.get("/targets", requireAuth, async (req, res) => {
  try {
    const scope = await resolveTargetListScope(req);
    if (scope.empty) {
      res.json([]); return;
    }
    const conditions: SQL[] = [];
    if (scope.companyId !== undefined) conditions.push(eq(energyTargetsTable.companyId, scope.companyId));
    if (scope.unitId !== undefined) conditions.push(eq(energyTargetsTable.unitId, scope.unitId));
    if (scope.subUnitId !== undefined) conditions.push(eq(energyTargetsTable.subUnitId, scope.subUnitId));
    if (scope.energySourceId !== undefined) conditions.push(eq(energyTargetsTable.energySourceId, scope.energySourceId));

    const targets = conditions.length > 0
      ? await db.select().from(energyTargetsTable).where(conditions.length === 1 ? conditions[0] : and(...conditions)).orderBy(energyTargetsTable.createdAt)
      : await db.select().from(energyTargetsTable).orderBy(energyTargetsTable.createdAt);

    const result = await Promise.all(
      targets.map(async (t) => {
        const progress = await calcProgress(t.unitId, t.baselineYear, t.targetYear, t.companyId);
        return { ...t, ...progress };
      })
    );
    res.json(result);
  } catch (err) {
    if (handleBadRequest(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/targets
router.post("/targets", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const {
      name, baselineYear, targetYear, targetReductionPercent, notes, unitId,
      objectiveText, targetText, targetType, baselineValue, targetValue, actualValue,
      unitLabel, status, subUnitId, energySourceId, seuAssessmentId,
    } = req.body;
    if (!name || !baselineYear || !targetYear || targetReductionPercent === undefined) {
      res.status(400).json({ error: "Zorunlu alanlar eksik" }); return;
    }
    const requestedUnitId = parseNullableId(unitId, "unitId");
    const parsedSubUnitId = parseNullableId(subUnitId, "subUnitId");
    const parsedEnergySourceId = parseNullableId(energySourceId, "energySourceId");
    const parsedSeuAssessmentId = parseNullableId(seuAssessmentId, "seuAssessmentId");
    if (!isCompanyAdmin(role) && !isSuperAdmin(role) && sessionUnitId === null) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const resolvedUnitId = isCompanyAdmin(role) || isSuperAdmin(role) ? requestedUnitId : sessionUnitId;
    const relationError = await validateTargetRelations({
      companyId: sessionCompanyId,
      unitId: resolvedUnitId,
      subUnitId: parsedSubUnitId,
      energySourceId: parsedEnergySourceId,
      seuAssessmentId: parsedSeuAssessmentId,
    });
    if (relationError) {
      res.status(400).json({ error: relationError }); return;
    }
    const [item] = await db.insert(energyTargetsTable).values({
      name,
      baselineYear: parseInt(baselineYear),
      targetYear: parseInt(targetYear),
      targetReductionPercent: parseFloat(targetReductionPercent),
      notes: notes || null,
      unitId: resolvedUnitId,
      companyId: sessionCompanyId,
      objectiveText: objectiveText || null,
      targetText: targetText || null,
      targetType: targetType || null,
      baselineValue: baselineValue != null && baselineValue !== "" ? parseFloat(baselineValue) : null,
      targetValue: targetValue != null && targetValue !== "" ? parseFloat(targetValue) : null,
      actualValue: actualValue != null && actualValue !== "" ? parseFloat(actualValue) : null,
      unitLabel: unitLabel || null,
      status: status || "active",
      subUnitId: parsedSubUnitId,
      energySourceId: parsedEnergySourceId,
      seuAssessmentId: parsedSeuAssessmentId,
    }).returning();
    res.status(201).json(item);
  } catch (err) {
    if (handleBadRequest(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PATCH /api/targets/:id
router.patch("/targets/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseRequiredId(req.params.id, "targetId");
    if (!isCompanyAdmin(role) && !isSuperAdmin(role) && sessionUnitId === null) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const targetScope = scopedTargetCondition(id, role, sessionCompanyId, sessionUnitId ?? undefined);
    const [existing] = await db.select().from(energyTargetsTable).where(targetScope);
    if (!existing) { res.status(404).json({ error: "Bulunamadı" }); return; }
    const {
      name, baselineYear, targetYear, targetReductionPercent, notes, unitId,
      objectiveText, targetText, targetType, baselineValue, targetValue, actualValue,
      unitLabel, status, subUnitId, energySourceId, seuAssessmentId,
    } = req.body;
    const parsedUnitId = unitId !== undefined ? parseNullableId(unitId, "unitId") : existing.unitId;
    const parsedSubUnitId = subUnitId !== undefined ? parseNullableId(subUnitId, "subUnitId") : existing.subUnitId;
    const parsedEnergySourceId = energySourceId !== undefined ? parseNullableId(energySourceId, "energySourceId") : existing.energySourceId;
    const parsedSeuAssessmentId = seuAssessmentId !== undefined ? parseNullableId(seuAssessmentId, "seuAssessmentId") : existing.seuAssessmentId;
    if (!isCompanyAdmin(role) && !isSuperAdmin(role) && parsedUnitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const relationError = await validateTargetRelations({
      companyId: existing.companyId,
      unitId: parsedUnitId,
      subUnitId: parsedSubUnitId,
      energySourceId: parsedEnergySourceId,
      seuAssessmentId: parsedSeuAssessmentId,
    });
    if (relationError) {
      res.status(400).json({ error: relationError }); return;
    }
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (baselineYear !== undefined) updates.baselineYear = parseInt(baselineYear);
    if (targetYear !== undefined) updates.targetYear = parseInt(targetYear);
    if (targetReductionPercent !== undefined) updates.targetReductionPercent = parseFloat(targetReductionPercent);
    if (notes !== undefined) updates.notes = notes || null;
    if ((isCompanyAdmin(role) || isSuperAdmin(role)) && unitId !== undefined) updates.unitId = parsedUnitId;
    if (objectiveText !== undefined) updates.objectiveText = objectiveText || null;
    if (targetText !== undefined) updates.targetText = targetText || null;
    if (targetType !== undefined) updates.targetType = targetType || null;
    if (baselineValue !== undefined) updates.baselineValue = baselineValue !== "" && baselineValue != null ? parseFloat(baselineValue) : null;
    if (targetValue !== undefined) updates.targetValue = targetValue !== "" && targetValue != null ? parseFloat(targetValue) : null;
    if (actualValue !== undefined) updates.actualValue = actualValue !== "" && actualValue != null ? parseFloat(actualValue) : null;
    if (unitLabel !== undefined) updates.unitLabel = unitLabel || null;
    if (status !== undefined) updates.status = status || null;
    if (subUnitId !== undefined) updates.subUnitId = parsedSubUnitId;
    if (energySourceId !== undefined) updates.energySourceId = parsedEnergySourceId;
    if (seuAssessmentId !== undefined) updates.seuAssessmentId = parsedSeuAssessmentId;
    const [item] = await db.update(energyTargetsTable).set(updates).where(targetScope).returning();
    res.json(item);
  } catch (err) {
    if (handleBadRequest(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/targets/:id
router.delete("/targets/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseRequiredId(req.params.id, "targetId");
    const standardUser = !isCompanyAdmin(role) && !isSuperAdmin(role);
    if (standardUser && sessionUnitId === null) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const targetScope = scopedTargetCondition(id, role, sessionCompanyId, sessionUnitId ?? undefined);

    const deleteResult = await db.transaction(async (tx) => {
      const [existing] = await tx.select({
        id: energyTargetsTable.id,
        companyId: energyTargetsTable.companyId,
      }).from(energyTargetsTable).where(targetScope).limit(1).for("update");
      if (!existing) return "not_found" as const;

      const [actionPlan] = await tx.select({ id: energyActionPlansTable.id })
        .from(energyActionPlansTable)
        .where(and(
          eq(energyActionPlansTable.targetId, id),
          eq(energyActionPlansTable.companyId, existing.companyId),
        ))
        .limit(1);
      const [progress] = await tx.select({ id: energyTargetProgressTable.id })
        .from(energyTargetProgressTable)
        .where(and(
          eq(energyTargetProgressTable.targetId, id),
          eq(energyTargetProgressTable.companyId, existing.companyId),
        ))
        .limit(1);
      const [vapProject] = await tx.select({ id: vapProjectsTable.id })
        .from(vapProjectsTable)
        .innerJoin(energyActionPlansTable, and(
          eq(vapProjectsTable.actionPlanId, energyActionPlansTable.id),
          eq(energyActionPlansTable.companyId, existing.companyId),
        ))
        .where(and(
          eq(energyActionPlansTable.targetId, id),
          eq(vapProjectsTable.companyId, existing.companyId),
        ))
        .limit(1);

      if (actionPlan || progress || vapProject) return "dependent" as const;

      const deleteConditions = [
        eq(energyTargetsTable.id, id),
        eq(energyTargetsTable.companyId, existing.companyId),
      ];
      if (standardUser) deleteConditions.push(eq(energyTargetsTable.unitId, sessionUnitId!));
      const [deleted] = await tx.delete(energyTargetsTable)
        .where(and(...deleteConditions))
        .returning({ id: energyTargetsTable.id });
      return deleted ? "deleted" as const : "not_found" as const;
    });

    if (deleteResult === "not_found") { res.status(404).send(); return; }
    if (deleteResult === "dependent") {
      res.status(409).json({ error: "Bu hedefe bağlı kayıtlar bulunduğu için silinemez." });
      return;
    }
    res.status(204).send();
  } catch (err) {
    if (handleBadRequest(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
