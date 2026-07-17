import { Router } from "express";
import type { Response } from "express";
import { db, companiesTable, energyBaselinesTable, energyTargetsTable, consumptionTable, metersTable, energyActionPlansTable, energyTargetProgressTable, vapProjectsTable, unitsTable, subUnitsTable, energySourcesTable, seuAssessmentItemsTable, seuAssessmentsTable } from "@workspace/db";
import { eq, and, SQL, inArray, isNull, ne, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import {
  buildCsv, sendCsvResponse,
  TARGET_STATUS_LABELS, TARGET_TYPE_LABELS, ACTION_STATUS_LABELS, PRIORITY_LABELS,
} from "../lib/csv-export.js";
import { buildXlsx, sendXlsxResponse, type XlsxColDef } from "../lib/xlsx-export.js";
import { changedAuditFields, writeAuditEvent } from "../lib/audit.js";

const router = Router();

class BadRequestError extends Error {}

const TARGET_TYPES = new Set(["consumption_reduction", "efficiency_improvement", "emission_reduction", "cost_reduction", "monitoring"]);
const TARGET_STATUSES = new Set(["draft", "active", "completed", "cancelled"]);
const TARGET_DUPLICATE_INDEX = "energy_targets_company_unit_item_year_unique";
const MAX_REAL = 3.4028235e38;

function isCompanyAdmin(role: string) {
  return role === "admin" || role === "kontrol_admin";
}

function isSuperAdmin(role: string) {
  return role === "superadmin";
}

function parsePositiveInteger(value: unknown, field = "id"): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new BadRequestError(`Geçersiz ${field}`);
}

function parseExportFormat(value: unknown): "csv" | "xlsx" {
  if (value === undefined) return "csv";
  if (value === "csv" || value === "xlsx") return value;
  throw new BadRequestError("Geçersiz format");
}

function parseQueryEnum(value: unknown, field: string, allowed: Set<string>): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.has(value)) throw new BadRequestError(`Geçersiz ${field}`);
  return value;
}

function parseRequiredString(value: unknown, field: string, maxLength = 255): string {
  if (typeof value !== "string") throw new BadRequestError(`Geçersiz ${field}`);
  const parsed = value.trim();
  if (!parsed || parsed.length > maxLength) throw new BadRequestError(`Geçersiz ${field}`);
  return parsed;
}

function parseOptionalString(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new BadRequestError(`Geçersiz ${field}`);
  const parsed = value.trim();
  return parsed || null;
}

function parseRequiredYear(value: unknown, field: string): number {
  return parseRequiredId(value, field);
}

function parseOptionalFiniteNumber(value: unknown, field: string, min = 0, max = MAX_REAL): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  let parsed: number;
  if (typeof value === "number") parsed = value;
  else if (typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) parsed = Number(value.trim());
  else throw new BadRequestError(`Geçersiz ${field}`);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > MAX_REAL || parsed < min || parsed > max) {
    throw new BadRequestError(`Geçersiz ${field}`);
  }
  return parsed;
}

function parseRequiredFiniteNumber(value: unknown, field: string, min = 0, max = MAX_REAL): number {
  const parsed = parseOptionalFiniteNumber(value, field, min, max);
  if (parsed === undefined || parsed === null) throw new BadRequestError(`Geçersiz ${field}`);
  return parsed;
}

function parseEnum(value: unknown, field: string, allowed: Set<string>, fallback?: string): string | null {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) return fallback;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !allowed.has(value)) throw new BadRequestError(`Geçersiz ${field}`);
  return value;
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

function duplicateTargetCondition(params: {
  companyId: number;
  unitId: number | null;
  seuAssessmentItemId: number;
  targetYear: number;
  excludeId?: number;
}) {
  const conditions: SQL[] = [
    eq(energyTargetsTable.companyId, params.companyId),
    params.unitId === null
      ? isNull(energyTargetsTable.unitId)
      : eq(energyTargetsTable.unitId, params.unitId),
    eq(energyTargetsTable.seuAssessmentItemId, params.seuAssessmentItemId),
    eq(energyTargetsTable.targetYear, params.targetYear),
  ];
  if (params.excludeId !== undefined) conditions.push(ne(energyTargetsTable.id, params.excludeId));
  return and(...conditions);
}

async function validateTargetRelations(params: {
  companyId: number;
  unitId: number | null;
  subUnitId: number | null;
  energySourceId: number | null;
  seuAssessmentId: number | null;
  seuAssessmentItemId: number | null;
  baselineId: number | null;
  requireCompleteParents: boolean;
}) {
  const { companyId, unitId, subUnitId, energySourceId, seuAssessmentId, seuAssessmentItemId, baselineId, requireCompleteParents } = params;

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

  const hasAnyParent = seuAssessmentId !== null || seuAssessmentItemId !== null || baselineId !== null;
  if (!requireCompleteParents && !hasAnyParent) return null;
  if (seuAssessmentId === null || seuAssessmentItemId === null || baselineId === null) {
    return "ÖEK değerlendirmesi, kabul edilmiş ÖEK kalemi ve aktif baseline zorunludur";
  }

  const [item] = await db.select({
    assessmentId: seuAssessmentItemsTable.assessmentId,
    itemUnitId: seuAssessmentItemsTable.unitId,
    userDecision: seuAssessmentItemsTable.userDecision,
    assessmentCompanyId: seuAssessmentsTable.companyId,
    assessmentUnitId: seuAssessmentsTable.unitId,
    assessmentRecordType: seuAssessmentsTable.recordType,
    assessmentIsOfficial: seuAssessmentsTable.isOfficial,
  }).from(seuAssessmentItemsTable)
    .innerJoin(seuAssessmentsTable, eq(seuAssessmentItemsTable.assessmentId, seuAssessmentsTable.id))
    .where(eq(seuAssessmentItemsTable.id, seuAssessmentItemId));
  if (!item || item.assessmentCompanyId !== companyId) return "Geçersiz ÖEK kalemi";
  if (item.assessmentId !== seuAssessmentId) return "ÖEK kalemi seçilen değerlendirmeye ait değil";
  if (item.assessmentUnitId !== unitId || (item.itemUnitId !== null && item.itemUnitId !== unitId)) return "ÖEK kalemi bu birime ait değil";
  if (item.assessmentRecordType !== "unit_official" || item.assessmentIsOfficial !== true) return "Yalnız resmi ÖEK değerlendirmesi hedefe bağlanabilir";
  if (item.userDecision !== "accepted_as_seu") return "Yalnız kabul edilmiş ÖEK kalemi hedefe bağlanabilir";

  const [baseline] = await db.select({
    companyId: energyBaselinesTable.companyId,
    unitId: energyBaselinesTable.unitId,
    seuAssessmentItemId: energyBaselinesTable.seuAssessmentItemId,
    status: energyBaselinesTable.status,
    isValid: energyBaselinesTable.isValid,
  }).from(energyBaselinesTable).where(eq(energyBaselinesTable.id, baselineId));
  if (!baseline || baseline.companyId !== companyId) return "Geçersiz baseline";
  if (baseline.unitId !== unitId) return "Baseline bu birime ait değil";
  if (baseline.seuAssessmentItemId !== seuAssessmentItemId) return "Baseline seçilen ÖEK kalemine ait değil";
  if (baseline.status !== "active" || baseline.isValid !== true) return "Yalnız aktif ve geçerli baseline hedefe bağlanabilir";

  return null;
}

async function resolveTargetMutationCompany(role: string, sessionCompanyId: number, value: unknown) {
  if (!isSuperAdmin(role)) return sessionCompanyId;
  const companyId = parseRequiredId(value, "companyId");
  const [company] = await db.select({ id: companiesTable.id }).from(companiesTable).where(eq(companiesTable.id, companyId));
  if (!company) throw new BadRequestError("Geçersiz companyId");
  return companyId;
}

function handleBadRequest(res: Response, err: unknown) {
  if (!(err instanceof BadRequestError)) return false;
  res.status(400).json({ error: err.message });
  return true;
}

function isTargetDuplicateViolation(error: unknown): boolean {
  const seen = new Set<object>();
  let current: unknown = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === "23505" && candidate.constraint === TARGET_DUPLICATE_INDEX) return true;
    current = candidate.cause;
  }
  return false;
}

function handleTargetDuplicate(res: Response, err: unknown): boolean {
  if (!isTargetDuplicateViolation(err)) return false;
  res.status(409).json({ error: "Bu ÖEK kalemi ve hedef yılı için hedef zaten mevcut" });
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
      seuAssessmentItemId: null,
      baselineId: null,
      requireCompleteParents: false,
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
    const format = parseExportFormat(req.query.format);
    const statusParam = parseQueryEnum(req.query.status, "status", TARGET_STATUSES);
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

    const yearParam = parsePositiveInteger(req.query.year, "year");
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
      unitLabel, status, subUnitId, energySourceId, seuAssessmentId, seuAssessmentItemId, baselineId, companyId,
    } = req.body;
    if (name === undefined || baselineYear === undefined || targetYear === undefined || targetReductionPercent === undefined) {
      res.status(400).json({ error: "Zorunlu alanlar eksik" }); return;
    }
    const parsedName = parseRequiredString(name, "name");
    const parsedBaselineYear = parseRequiredYear(baselineYear, "baselineYear");
    const parsedTargetYear = parseRequiredYear(targetYear, "targetYear");
    if (parsedTargetYear < parsedBaselineYear) throw new BadRequestError("Hedef yılı baz yıldan küçük olamaz");
    const parsedReduction = parseRequiredFiniteNumber(targetReductionPercent, "targetReductionPercent", 0, 100);
    const parsedTargetType = parseEnum(targetType, "targetType", TARGET_TYPES);
    const parsedStatus = parseEnum(status, "status", TARGET_STATUSES, "active")!;
    const parsedBaselineValue = parseOptionalFiniteNumber(baselineValue, "baselineValue");
    const parsedTargetValue = parseOptionalFiniteNumber(targetValue, "targetValue");
    // Backward-compatible input validation only. Target realization is written by
    // the scoped energy-target-progress flow, never by target create/update payloads.
    parseOptionalFiniteNumber(actualValue, "actualValue");
    const parsedNotes = parseOptionalString(notes, "notes");
    const parsedObjectiveText = parseOptionalString(objectiveText, "objectiveText");
    const parsedTargetText = parseOptionalString(targetText, "targetText");
    const parsedUnitLabel = parseOptionalString(unitLabel, "unitLabel");
    const requestedUnitId = parseNullableId(unitId, "unitId");
    const parsedSubUnitId = parseNullableId(subUnitId, "subUnitId");
    const parsedEnergySourceId = parseNullableId(energySourceId, "energySourceId");
    const parsedSeuAssessmentId = parseRequiredId(seuAssessmentId, "seuAssessmentId");
    const parsedSeuAssessmentItemId = parseRequiredId(seuAssessmentItemId, "seuAssessmentItemId");
    const parsedBaselineId = parseRequiredId(baselineId, "baselineId");
    if (!isCompanyAdmin(role) && !isSuperAdmin(role) && sessionUnitId === null) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const effectiveCompanyId = await resolveTargetMutationCompany(role, sessionCompanyId, companyId);
    const resolvedUnitId = isCompanyAdmin(role) || isSuperAdmin(role) ? requestedUnitId : sessionUnitId;
    const relationError = await validateTargetRelations({
      companyId: effectiveCompanyId,
      unitId: resolvedUnitId,
      subUnitId: parsedSubUnitId,
      energySourceId: parsedEnergySourceId,
      seuAssessmentId: parsedSeuAssessmentId,
      seuAssessmentItemId: parsedSeuAssessmentItemId,
      baselineId: parsedBaselineId,
      requireCompleteParents: true,
    });
    if (relationError) {
      res.status(400).json({ error: relationError }); return;
    }
    const [duplicate] = await db.select({ id: energyTargetsTable.id })
      .from(energyTargetsTable)
      .where(duplicateTargetCondition({
        companyId: effectiveCompanyId,
        unitId: resolvedUnitId,
        seuAssessmentItemId: parsedSeuAssessmentItemId,
        targetYear: parsedTargetYear,
      }))
      .limit(1);
    if (duplicate) {
      res.status(409).json({ error: "Bu ÖEK kalemi ve hedef yılı için hedef zaten mevcut" }); return;
    }
    const item = await db.transaction(async (tx) => {
      const [created] = await tx.insert(energyTargetsTable).values({
        name: parsedName,
        baselineYear: parsedBaselineYear,
        targetYear: parsedTargetYear,
        targetReductionPercent: parsedReduction,
        notes: parsedNotes ?? null,
        unitId: resolvedUnitId,
        companyId: effectiveCompanyId,
        objectiveText: parsedObjectiveText ?? null,
        targetText: parsedTargetText ?? null,
        targetType: parsedTargetType,
        baselineValue: parsedBaselineValue ?? null,
        targetValue: parsedTargetValue ?? null,
        actualValue: null,
        unitLabel: parsedUnitLabel ?? null,
        status: parsedStatus,
        subUnitId: parsedSubUnitId,
        energySourceId: parsedEnergySourceId,
        seuAssessmentId: parsedSeuAssessmentId,
        seuAssessmentItemId: parsedSeuAssessmentItemId,
        baselineId: parsedBaselineId,
      }).returning();
      await writeAuditEvent(tx, {
        request: req,
        companyId: created.companyId,
        unitId: created.unitId,
        action: "target.create",
        entityType: "target",
        entityId: created.id,
        changes: { created: { targetYear: created.targetYear, targetValue: created.targetValue, targetReductionPercent: created.targetReductionPercent, status: created.status } },
      });
      return created;
    });
    res.status(201).json(item);
  } catch (err) {
    if (handleBadRequest(res, err)) return;
    if (handleTargetDuplicate(res, err)) return;
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
    const effectiveCompanyId = await resolveTargetMutationCompany(role, sessionCompanyId, req.body.companyId);
    const targetScope = isSuperAdmin(role)
      ? and(eq(energyTargetsTable.id, id), eq(energyTargetsTable.companyId, effectiveCompanyId))
      : scopedTargetCondition(id, role, sessionCompanyId, sessionUnitId ?? undefined);
    const [existing] = await db.select().from(energyTargetsTable).where(targetScope);
    if (!existing) { res.status(404).json({ error: "Bulunamadı" }); return; }
    const {
      name, baselineYear, targetYear, targetReductionPercent, notes, unitId,
      objectiveText, targetText, targetType, baselineValue, targetValue, actualValue,
      unitLabel, status, subUnitId, energySourceId, seuAssessmentId, seuAssessmentItemId, baselineId,
    } = req.body;
    const parsedName = name !== undefined ? parseRequiredString(name, "name") : undefined;
    const parsedBaselineYear = baselineYear !== undefined ? parseRequiredYear(baselineYear, "baselineYear") : existing.baselineYear;
    const parsedTargetYear = targetYear !== undefined ? parseRequiredYear(targetYear, "targetYear") : existing.targetYear;
    if (parsedTargetYear < parsedBaselineYear) throw new BadRequestError("Hedef yılı baz yıldan küçük olamaz");
    const parsedReduction = targetReductionPercent !== undefined
      ? parseRequiredFiniteNumber(targetReductionPercent, "targetReductionPercent", 0, 100)
      : undefined;
    const parsedTargetType = targetType !== undefined ? parseEnum(targetType, "targetType", TARGET_TYPES) : undefined;
    const parsedStatus = status !== undefined ? parseEnum(status, "status", TARGET_STATUSES) : undefined;
    const parsedBaselineValue = baselineValue !== undefined ? parseOptionalFiniteNumber(baselineValue, "baselineValue") : undefined;
    const parsedTargetValue = targetValue !== undefined ? parseOptionalFiniteNumber(targetValue, "targetValue") : undefined;
    if (actualValue !== undefined) parseOptionalFiniteNumber(actualValue, "actualValue");
    const parsedNotes = notes !== undefined ? parseOptionalString(notes, "notes") : undefined;
    const parsedObjectiveText = objectiveText !== undefined ? parseOptionalString(objectiveText, "objectiveText") : undefined;
    const parsedTargetText = targetText !== undefined ? parseOptionalString(targetText, "targetText") : undefined;
    const parsedUnitLabel = unitLabel !== undefined ? parseOptionalString(unitLabel, "unitLabel") : undefined;
    const parsedUnitId = unitId !== undefined ? parseNullableId(unitId, "unitId") : existing.unitId;
    const parsedSubUnitId = subUnitId !== undefined ? parseNullableId(subUnitId, "subUnitId") : existing.subUnitId;
    const parsedEnergySourceId = energySourceId !== undefined ? parseNullableId(energySourceId, "energySourceId") : existing.energySourceId;
    const parsedSeuAssessmentId = seuAssessmentId !== undefined ? parseNullableId(seuAssessmentId, "seuAssessmentId") : existing.seuAssessmentId;
    const parsedSeuAssessmentItemId = seuAssessmentItemId !== undefined ? parseNullableId(seuAssessmentItemId, "seuAssessmentItemId") : existing.seuAssessmentItemId;
    const parsedBaselineId = baselineId !== undefined ? parseNullableId(baselineId, "baselineId") : existing.baselineId;
    const parentFieldsChanged = unitId !== undefined || seuAssessmentId !== undefined || seuAssessmentItemId !== undefined || baselineId !== undefined;
    if (!isCompanyAdmin(role) && !isSuperAdmin(role) && parsedUnitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const relationError = await validateTargetRelations({
      companyId: existing.companyId,
      unitId: parsedUnitId,
      subUnitId: parsedSubUnitId,
      energySourceId: parsedEnergySourceId,
      seuAssessmentId: parsedSeuAssessmentId,
      seuAssessmentItemId: parsedSeuAssessmentItemId,
      baselineId: parsedBaselineId,
      requireCompleteParents: parentFieldsChanged || parsedSeuAssessmentItemId !== null || parsedBaselineId !== null,
    });
    if (relationError) {
      res.status(400).json({ error: relationError }); return;
    }
    const duplicateKeyChanged = targetYear !== undefined || unitId !== undefined
      || seuAssessmentId !== undefined || seuAssessmentItemId !== undefined;
    if (duplicateKeyChanged && parsedSeuAssessmentItemId !== null) {
      const [duplicate] = await db.select({ id: energyTargetsTable.id })
        .from(energyTargetsTable)
        .where(duplicateTargetCondition({
          companyId: existing.companyId,
          unitId: parsedUnitId,
          seuAssessmentItemId: parsedSeuAssessmentItemId,
          targetYear: parsedTargetYear,
          excludeId: id,
        }))
        .limit(1);
      if (duplicate) {
        res.status(409).json({ error: "Bu ÖEK kalemi ve hedef yılı için hedef zaten mevcut" }); return;
      }
    }
    const updates: Record<string, unknown> = {};
    if (parsedName !== undefined) updates.name = parsedName;
    if (baselineYear !== undefined) updates.baselineYear = parsedBaselineYear;
    if (targetYear !== undefined) updates.targetYear = parsedTargetYear;
    if (parsedReduction !== undefined) updates.targetReductionPercent = parsedReduction;
    if (parsedNotes !== undefined) updates.notes = parsedNotes;
    if ((isCompanyAdmin(role) || isSuperAdmin(role)) && unitId !== undefined) updates.unitId = parsedUnitId;
    if (parsedObjectiveText !== undefined) updates.objectiveText = parsedObjectiveText;
    if (parsedTargetText !== undefined) updates.targetText = parsedTargetText;
    if (parsedTargetType !== undefined) updates.targetType = parsedTargetType;
    if (parsedBaselineValue !== undefined) updates.baselineValue = parsedBaselineValue;
    if (parsedTargetValue !== undefined) updates.targetValue = parsedTargetValue;
    if (parsedUnitLabel !== undefined) updates.unitLabel = parsedUnitLabel;
    if (parsedStatus !== undefined) updates.status = parsedStatus;
    if (subUnitId !== undefined) updates.subUnitId = parsedSubUnitId;
    if (energySourceId !== undefined) updates.energySourceId = parsedEnergySourceId;
    if (seuAssessmentId !== undefined) updates.seuAssessmentId = parsedSeuAssessmentId;
    if (seuAssessmentItemId !== undefined) updates.seuAssessmentItemId = parsedSeuAssessmentItemId;
    if (baselineId !== undefined) updates.baselineId = parsedBaselineId;
    if (Object.keys(updates).length === 0) { res.json(existing); return; }
    const item = await db.transaction(async (tx) => {
      const [updated] = await tx.update(energyTargetsTable).set(updates).where(targetScope).returning();
      if (!updated) return null;
      await writeAuditEvent(tx, {
        request: req,
        companyId: updated.companyId,
        unitId: updated.unitId,
        action: "target.update",
        entityType: "target",
        entityId: updated.id,
        changes: changedAuditFields(existing as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>, [
          "name", "baselineYear", "targetYear", "targetReductionPercent", "unitId", "status", "targetValue", "baselineValue", "subUnitId", "energySourceId", "seuAssessmentItemId", "baselineId",
        ]),
      });
      return updated;
    });
    if (!item) { res.status(404).json({ error: "Bulunamadı" }); return; }
    res.json(item);
  } catch (err) {
    if (handleBadRequest(res, err)) return;
    if (handleTargetDuplicate(res, err)) return;
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
        unitId: energyTargetsTable.unitId,
        status: energyTargetsTable.status,
        targetYear: energyTargetsTable.targetYear,
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
      if (deleted) {
        await writeAuditEvent(tx, {
          request: req,
          companyId: existing.companyId,
          unitId: existing.unitId,
          action: "target.delete",
          entityType: "target",
          entityId: id,
          changes: { deleted: { targetYear: existing.targetYear, status: existing.status } },
        });
      }
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
