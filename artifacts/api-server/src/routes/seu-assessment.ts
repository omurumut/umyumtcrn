import { Router } from "express";
import {
  db,
  consumptionTable,
  metersTable,
  energyUseGroupsTable,
  subUnitsTable,
  energySourcesTable,
  unitsTable,
  companiesTable,
  seuAssessmentsTable,
  seuAssessmentItemsTable,
  energyTargetsTable,
  energyPerformanceIndicatorsTable,
  energyBaselinesTable,
  energyPerformanceResultsTable,
  seuTable,
} from "@workspace/db";
import { eq, and, gte, lte, sql, desc, inArray } from "drizzle-orm";
import { requireAuth, requireCompanyAdmin } from "../middlewares/auth.js";

const router = Router();

const VALID_DECISIONS = new Set(["accepted_as_seu", "not_seu", "monitor"]);
const POSTGRES_REAL_MAX = 3.4028234663852886e38;

function computePriority(share: number, hasOpportunity: boolean): number | null {
  if (share >= 20) return hasOpportunity ? 1 : 2;
  if (share >= 10) return hasOpportunity ? 2 : 3;
  if (share >= 5) return hasOpportunity ? 3 : 4;
  if (hasOpportunity) return 4;
  return null;
}

function computeRecommendation(priority: number | null): "seu_candidate" | "not_seu" {
  return priority !== null ? "seu_candidate" : "not_seu";
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

function parseStrictInteger(value: unknown, field: string, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed)) throw new AssessmentScopeError(400, `Geçersiz ${field}`);
    parsed = Number(trimmed);
  } else {
    throw new AssessmentScopeError(400, `Geçersiz ${field}`);
  }
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new AssessmentScopeError(400, `Geçersiz ${field}`);
  }
  return parsed;
}

function parseOptionalYear(value: unknown, fallback: number | null): number | null {
  return value === undefined ? fallback : parseStrictInteger(value, "year");
}

function parseOptionalMonth(value: unknown, field: string, fallback: number): number {
  return value === undefined ? fallback : parseStrictInteger(value, field, 1, 12);
}

function parseDecision(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !VALID_DECISIONS.has(value)) {
    throw new AssessmentScopeError(400, "Geçersiz userDecision");
  }
  return value;
}

function parseTargetReductionPercent(value: unknown): number | null {
  if (value === null) return null;
  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
      throw new AssessmentScopeError(400, "Geçersiz targetReductionPercent");
    }
    parsed = Number(trimmed);
  } else {
    throw new AssessmentScopeError(400, "Geçersiz targetReductionPercent");
  }
  if (!Number.isFinite(parsed) || Math.abs(parsed) > POSTGRES_REAL_MAX) {
    throw new AssessmentScopeError(400, "Geçersiz targetReductionPercent");
  }
  return parsed;
}

class AssessmentScopeError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function isCompanyAdmin(role: string) {
  return role === "admin" || role === "kontrol_admin";
}

function isSuperAdmin(role: string) {
  return role === "superadmin";
}

function parseOptionalId(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  const parsed = parsePositiveInteger(value);
  if (parsed === null) throw new AssessmentScopeError(400, `Geçersiz ${field}`);
  return parsed;
}

async function resolveUnitCompanyId(unitId: number, companyId: number | null): Promise<number> {
  const [unit] = await db.select({ companyId: unitsTable.companyId }).from(unitsTable)
    .where(eq(unitsTable.id, unitId));
  if (!unit || (companyId !== null && unit.companyId !== companyId)) {
    throw new AssessmentScopeError(403, "Birim şirket kapsamıyla uyumlu değil");
  }
  return unit.companyId;
}

async function validateAssessmentItemRelations(
  companyId: number,
  assessmentUnitId: number,
  assessmentEnergySourceId: number | null,
  item: any,
) {
  let unitId = parseOptionalId(item.unitId, "item.unitId");
  let subUnitId = parseOptionalId(item.subUnitId, "item.subUnitId");
  let energySourceId = parseOptionalId(item.energySourceId, "item.energySourceId");
  let energyUseGroupId = parseOptionalId(item.energyUseGroupId, "item.energyUseGroupId");
  const meterId = parseOptionalId(item.meterId, "item.meterId");

  if (meterId !== null) {
    const [meter] = await db.select({
      unitId: metersTable.unitId,
      subUnitId: metersTable.subUnitId,
      energySourceId: metersTable.energySourceId,
      energyUseGroupId: metersTable.energyUseGroupId,
    }).from(metersTable).where(and(eq(metersTable.id, meterId), eq(metersTable.companyId, companyId)));
    if (!meter) throw new AssessmentScopeError(400, "Geçersiz item.meterId");
    if (unitId !== null && meter.unitId !== null && unitId !== meter.unitId) throw new AssessmentScopeError(400, "Sayaç unit ilişkisi çelişkili");
    if (subUnitId !== null && meter.subUnitId !== null && subUnitId !== meter.subUnitId) throw new AssessmentScopeError(400, "Sayaç subUnit ilişkisi çelişkili");
    if (energySourceId !== null && meter.energySourceId !== null && energySourceId !== meter.energySourceId) throw new AssessmentScopeError(400, "Sayaç enerji kaynağı ilişkisi çelişkili");
    if (energyUseGroupId !== null && meter.energyUseGroupId !== null && energyUseGroupId !== meter.energyUseGroupId) throw new AssessmentScopeError(400, "Sayaç enerji kullanım grubu ilişkisi çelişkili");
    unitId ??= meter.unitId;
    subUnitId ??= meter.subUnitId;
    energySourceId ??= meter.energySourceId;
    energyUseGroupId ??= meter.energyUseGroupId;
  }

  if (energyUseGroupId !== null) {
    const [group] = await db.select({
      unitId: energyUseGroupsTable.unitId,
      subUnitId: energyUseGroupsTable.subUnitId,
      energySourceId: energyUseGroupsTable.energySourceId,
    }).from(energyUseGroupsTable).where(and(eq(energyUseGroupsTable.id, energyUseGroupId), eq(energyUseGroupsTable.companyId, companyId)));
    if (!group) throw new AssessmentScopeError(400, "Geçersiz item.energyUseGroupId");
    if (unitId !== null && group.unitId !== null && unitId !== group.unitId) throw new AssessmentScopeError(400, "Grup unit ilişkisi çelişkili");
    if (subUnitId !== null && group.subUnitId !== null && subUnitId !== group.subUnitId) throw new AssessmentScopeError(400, "Grup subUnit ilişkisi çelişkili");
    if (energySourceId !== null && group.energySourceId !== null && energySourceId !== group.energySourceId) throw new AssessmentScopeError(400, "Grup enerji kaynağı ilişkisi çelişkili");
    unitId ??= group.unitId;
    subUnitId ??= group.subUnitId;
    energySourceId ??= group.energySourceId;
  }

  unitId ??= assessmentUnitId;
  if (unitId !== assessmentUnitId) throw new AssessmentScopeError(400, "Item assessment birimi ile uyumlu değil");
  const [unit] = await db.select({ id: unitsTable.id }).from(unitsTable)
    .where(and(eq(unitsTable.id, unitId), eq(unitsTable.companyId, companyId)));
  if (!unit) throw new AssessmentScopeError(400, "Geçersiz item.unitId");

  if (subUnitId !== null) {
    const [subUnit] = await db.select({ id: subUnitsTable.id }).from(subUnitsTable)
      .where(and(eq(subUnitsTable.id, subUnitId), eq(subUnitsTable.companyId, companyId), eq(subUnitsTable.unitId, unitId)));
    if (!subUnit) throw new AssessmentScopeError(400, "Geçersiz item.subUnitId");
  }
  energySourceId ??= assessmentEnergySourceId;
  if (assessmentEnergySourceId !== null && energySourceId !== null && energySourceId !== assessmentEnergySourceId) {
    throw new AssessmentScopeError(400, "Item assessment enerji kaynağı ile uyumlu değil");
  }
  if (energySourceId !== null) {
    const [source] = await db.select({ id: energySourcesTable.id }).from(energySourcesTable)
      .where(and(eq(energySourcesTable.id, energySourceId), eq(energySourcesTable.companyId, companyId), eq(energySourcesTable.unitId, unitId)));
    if (!source) throw new AssessmentScopeError(400, "Geçersiz item.energySourceId");
  }

  return { ...item, unitId, subUnitId, energySourceId, energyUseGroupId, meterId };
}

function handleAssessmentScopeError(res: any, err: unknown) {
  if (!(err instanceof AssessmentScopeError)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

// ── GET /seu/analyze ─────────────────────────────────────
router.get("/seu/analyze", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const year = parseOptionalYear(req.query.year, new Date().getFullYear())!;
    const monthStart = parseOptionalMonth(req.query.monthStart, "monthStart", 1);
    const monthEnd = parseOptionalMonth(req.query.monthEnd, "monthEnd", 12);
    if (monthStart > monthEnd) throw new AssessmentScopeError(400, "monthStart monthEnd değerinden büyük olamaz");
    const analysisLevel = (req.query.analysisLevel as string) || "energyUseGroup";
    const requestedCompanyId = parseOptionalId(req.query.companyId, "companyId");
    const requestedUnitId = parseOptionalId(req.query.unitId, "unitId");
    const energySourceId = parseOptionalId(req.query.energySourceId, "energySourceId");

    const standardUser = !isCompanyAdmin(role) && !isSuperAdmin(role);
    if (standardUser && sessionUnitId === null) {
      res.json({
        unitId: null,
        year,
        periodStart: monthStart,
        periodEnd: monthEnd,
        analysisLevel,
        unitTotalTep: 0,
        missingTepWarning: false,
        missingTepCount: 0,
        items: [],
      });
      return;
    }

    const resolvedUnitId = standardUser ? sessionUnitId : requestedUnitId;

    if (!resolvedUnitId) {
      res.status(400).json({ error: "Birim seçilmedi" });
      return;
    }

    const requestedScopeCompanyId = isSuperAdmin(role) ? requestedCompanyId : sessionCompanyId;
    const resolvedCompanyId = standardUser
      ? sessionCompanyId
      : await resolveUnitCompanyId(resolvedUnitId, requestedScopeCompanyId);

    const baseConditions = [
      eq(consumptionTable.companyId, resolvedCompanyId),
      eq(metersTable.unitId, resolvedUnitId),
      eq(consumptionTable.year, year),
      gte(consumptionTable.month, monthStart),
      lte(consumptionTable.month, monthEnd),
    ];
    if (energySourceId) baseConditions.push(eq(metersTable.energySourceId, energySourceId));
    const whereClause = and(...baseConditions);

    type RawRow = {
      groupId: number | null;
      groupName: string | null;
      hasOpportunity: boolean | null;
      energyTep: number;
      missingCount: number;
      energyUseGroupId?: number | null;
      meterId?: number | null;
      subUnitId?: number | null;
      energySourceId?: number | null;
    };

    let rawRows: RawRow[] = [];

    if (analysisLevel === "meter") {
      const rows = await db
        .select({
          groupId: metersTable.id,
          groupName: metersTable.name,
          energyTep: sql<number>`COALESCE(SUM(${consumptionTable.tep}), 0)`,
          missingCount: sql<number>`SUM(CASE WHEN ${consumptionTable.tep} = 0 THEN 1 ELSE 0 END)`,
        })
        .from(consumptionTable)
        .innerJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
        .where(whereClause)
        .groupBy(metersTable.id, metersTable.name)
        .orderBy(sql`SUM(${consumptionTable.tep}) DESC NULLS LAST`);
      rawRows = rows.map(r => ({
        groupId: r.groupId, groupName: r.groupName, hasOpportunity: false,
        energyTep: Number(r.energyTep) || 0, missingCount: Number(r.missingCount) || 0,
        meterId: r.groupId,
      }));
    } else if (analysisLevel === "subUnit") {
      const rows = await db
        .select({
          groupId: subUnitsTable.id,
          groupName: subUnitsTable.name,
          energyTep: sql<number>`COALESCE(SUM(${consumptionTable.tep}), 0)`,
          missingCount: sql<number>`SUM(CASE WHEN ${consumptionTable.tep} = 0 THEN 1 ELSE 0 END)`,
        })
        .from(consumptionTable)
        .innerJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
        .leftJoin(subUnitsTable, eq(metersTable.subUnitId, subUnitsTable.id))
        .where(whereClause)
        .groupBy(subUnitsTable.id, subUnitsTable.name)
        .orderBy(sql`SUM(${consumptionTable.tep}) DESC NULLS LAST`);
      rawRows = rows.map(r => ({
        groupId: r.groupId, groupName: r.groupName, hasOpportunity: false,
        energyTep: Number(r.energyTep) || 0, missingCount: Number(r.missingCount) || 0,
        subUnitId: r.groupId,
      }));
    } else if (analysisLevel === "energySource") {
      const rows = await db
        .select({
          groupId: energySourcesTable.id,
          groupName: energySourcesTable.name,
          energyTep: sql<number>`COALESCE(SUM(${consumptionTable.tep}), 0)`,
          missingCount: sql<number>`SUM(CASE WHEN ${consumptionTable.tep} = 0 THEN 1 ELSE 0 END)`,
        })
        .from(consumptionTable)
        .innerJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
        .leftJoin(energySourcesTable, eq(metersTable.energySourceId, energySourcesTable.id))
        .where(whereClause)
        .groupBy(energySourcesTable.id, energySourcesTable.name)
        .orderBy(sql`SUM(${consumptionTable.tep}) DESC NULLS LAST`);
      rawRows = rows.map(r => ({
        groupId: r.groupId, groupName: r.groupName, hasOpportunity: false,
        energyTep: Number(r.energyTep) || 0, missingCount: Number(r.missingCount) || 0,
        energySourceId: r.groupId,
      }));
    } else if (analysisLevel === "unit") {
      const [unitInfo] = await db.select({ name: unitsTable.name }).from(unitsTable).where(eq(unitsTable.id, resolvedUnitId));
      const [totals] = await db
        .select({
          energyTep: sql<number>`COALESCE(SUM(${consumptionTable.tep}), 0)`,
          missingCount: sql<number>`SUM(CASE WHEN ${consumptionTable.tep} = 0 THEN 1 ELSE 0 END)`,
        })
        .from(consumptionTable)
        .innerJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
        .where(whereClause);
      rawRows = [{
        groupId: resolvedUnitId, groupName: unitInfo?.name ?? "Birim", hasOpportunity: false,
        energyTep: Number(totals?.energyTep) || 0, missingCount: Number(totals?.missingCount) || 0,
      }];
    } else {
      const rows = await db
        .select({
          groupId: energyUseGroupsTable.id,
          groupName: energyUseGroupsTable.name,
          hasOpportunity: energyUseGroupsTable.isSeuCandidate,
          energyTep: sql<number>`COALESCE(SUM(${consumptionTable.tep}), 0)`,
          missingCount: sql<number>`SUM(CASE WHEN ${consumptionTable.tep} = 0 THEN 1 ELSE 0 END)`,
        })
        .from(consumptionTable)
        .innerJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
        .leftJoin(energyUseGroupsTable, eq(metersTable.energyUseGroupId, energyUseGroupsTable.id))
        .where(whereClause)
        .groupBy(energyUseGroupsTable.id, energyUseGroupsTable.name, energyUseGroupsTable.isSeuCandidate)
        .orderBy(sql`SUM(${consumptionTable.tep}) DESC NULLS LAST`);
      rawRows = rows.map(r => ({
        groupId: r.groupId, groupName: r.groupName, hasOpportunity: r.hasOpportunity ?? false,
        energyTep: Number(r.energyTep) || 0, missingCount: Number(r.missingCount) || 0,
        energyUseGroupId: r.groupId,
      }));
    }

    const unitTotalTep = rawRows.reduce((sum, r) => sum + r.energyTep, 0);
    const totalMissingTep = rawRows.reduce((sum, r) => sum + r.missingCount, 0);

    const items = rawRows.map(r => {
      const share = unitTotalTep > 0 ? (r.energyTep / unitTotalTep) * 100 : 0;
      const hasOpp = r.hasOpportunity ?? false;
      const priority = computePriority(share, hasOpp);
      return {
        groupId: r.groupId,
        name: r.groupName ?? "Tanımlanmamış",
        analysisLevel,
        energyTep: r.energyTep,
        consumptionSharePercent: Math.round(share * 100) / 100,
        hasOpportunity: hasOpp,
        priorityResult: priority,
        systemRecommendation: computeRecommendation(priority),
        energyUseGroupId: r.energyUseGroupId ?? null,
        meterId: r.meterId ?? null,
        subUnitId: r.subUnitId ?? null,
        energySourceId: r.energySourceId ?? null,
      };
    });

    res.json({
      unitId: resolvedUnitId,
      year,
      periodStart: monthStart,
      periodEnd: monthEnd,
      analysisLevel,
      unitTotalTep,
      missingTepWarning: totalMissingTep > 0,
      missingTepCount: totalMissingTep,
      items,
    });
  } catch (err) {
    if (handleAssessmentScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Analiz hesaplanamadı" });
  }
});

// ── GET /seu/assessments ─────────────────────────────────
router.get("/seu/assessments", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const requestedCompanyId = parseOptionalId(req.query.companyId, "companyId");
    const requestedUnitId = parseOptionalId(req.query.unitId, "unitId");
    const year = parseOptionalYear(req.query.year, null);
    const recordType = (req.query.recordType as string) || null;

    const standardUser = !isCompanyAdmin(role) && !isSuperAdmin(role);
    if (standardUser && sessionUnitId === null) {
      res.json([]);
      return;
    }

    let effectiveCompanyId = isSuperAdmin(role) ? requestedCompanyId : sessionCompanyId;
    const effectiveUnitId = standardUser ? sessionUnitId : requestedUnitId;
    if (effectiveUnitId !== null && !standardUser) {
      const unitCompanyId = await resolveUnitCompanyId(effectiveUnitId, effectiveCompanyId);
      effectiveCompanyId ??= unitCompanyId;
    }

    const conds = [];
    if (effectiveCompanyId !== null) conds.push(eq(seuAssessmentsTable.companyId, effectiveCompanyId));

    if (standardUser) {
      conds.push(eq(seuAssessmentsTable.unitId, sessionUnitId!));
      conds.push(eq(seuAssessmentsTable.recordType, "unit_official"));
    } else {
      if (effectiveUnitId !== null) conds.push(eq(seuAssessmentsTable.unitId, effectiveUnitId));
      if (recordType) conds.push(eq(seuAssessmentsTable.recordType, recordType));
    }
    if (year) conds.push(eq(seuAssessmentsTable.year, year));

    const assessments = await db
      .select({
        id: seuAssessmentsTable.id,
        unitId: seuAssessmentsTable.unitId,
        unitName: unitsTable.name,
        year: seuAssessmentsTable.year,
        periodStart: seuAssessmentsTable.periodStart,
        periodEnd: seuAssessmentsTable.periodEnd,
        analysisLevel: seuAssessmentsTable.analysisLevel,
        methodType: seuAssessmentsTable.methodType,
        recordType: seuAssessmentsTable.recordType,
        isOfficial: seuAssessmentsTable.isOfficial,
        unitTotalTep: seuAssessmentsTable.unitTotalTep,
        createdAt: seuAssessmentsTable.createdAt,
        updatedAt: seuAssessmentsTable.updatedAt,
      })
      .from(seuAssessmentsTable)
      .leftJoin(unitsTable, eq(seuAssessmentsTable.unitId, unitsTable.id))
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(seuAssessmentsTable.createdAt));

    const ids = assessments.map(a => a.id);
    let itemCounts: Record<number, { total: number; seu: number; monitor: number; notSeu: number }> = {};
    if (ids.length > 0) {
      const counts = await db
        .select({
          assessmentId: seuAssessmentItemsTable.assessmentId,
          total: sql<number>`COUNT(*)`,
          seu: sql<number>`SUM(CASE WHEN ${seuAssessmentItemsTable.userDecision} = 'accepted_as_seu' THEN 1 ELSE 0 END)`,
          monitor: sql<number>`SUM(CASE WHEN ${seuAssessmentItemsTable.userDecision} = 'monitor' THEN 1 ELSE 0 END)`,
          notSeu: sql<number>`SUM(CASE WHEN ${seuAssessmentItemsTable.userDecision} = 'not_seu' THEN 1 ELSE 0 END)`,
        })
        .from(seuAssessmentItemsTable)
        .where(inArray(seuAssessmentItemsTable.assessmentId, ids))
        .groupBy(seuAssessmentItemsTable.assessmentId);
      itemCounts = Object.fromEntries(counts.map(c => [
        c.assessmentId,
        { total: Number(c.total) || 0, seu: Number(c.seu) || 0, monitor: Number(c.monitor) || 0, notSeu: Number(c.notSeu) || 0 },
      ]));
    }

    res.json(assessments.map(a => ({
      ...a,
      itemCount: itemCounts[a.id]?.total ?? 0,
      seuCount: itemCounts[a.id]?.seu ?? 0,
      monitorCount: itemCounts[a.id]?.monitor ?? 0,
      notSeuCount: itemCounts[a.id]?.notSeu ?? 0,
    })));
  } catch (err) {
    if (handleAssessmentScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── GET /seu/assessments/:id ─────────────────────────────
router.get("/seu/assessments/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parsePositiveInteger(req.params.id);
    if (id === null) { res.status(400).json({ error: "Geçersiz assessmentId" }); return; }
    const requestedCompanyId = parseOptionalId(req.query.companyId, "companyId");
    const standardUser = !isCompanyAdmin(role) && !isSuperAdmin(role);
    if (standardUser && sessionUnitId === null) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    const assessmentConditions = [eq(seuAssessmentsTable.id, id)];
    if (isSuperAdmin(role)) {
      if (requestedCompanyId !== null) assessmentConditions.push(eq(seuAssessmentsTable.companyId, requestedCompanyId));
    } else {
      assessmentConditions.push(eq(seuAssessmentsTable.companyId, sessionCompanyId));
    }
    if (standardUser) assessmentConditions.push(eq(seuAssessmentsTable.unitId, sessionUnitId!));

    const [assessment] = await db
      .select()
      .from(seuAssessmentsTable)
      .where(and(...assessmentConditions));
    if (!assessment) { res.status(404).json({ error: "Bulunamadı" }); return; }
    const items = await db
      .select()
      .from(seuAssessmentItemsTable)
      .where(eq(seuAssessmentItemsTable.assessmentId, assessment.id))
      .orderBy(seuAssessmentItemsTable.consumptionSharePercent);
    res.json({ ...assessment, items });
  } catch (err) {
    if (handleAssessmentScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── POST /seu/assessments ────────────────────────────────
router.post("/seu/assessments", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId, userId } = req.user!;
    const {
      companyId: bodyCompanyId, unitId, year, periodStart = 1, periodEnd = 12,
      analysisLevel = "energyUseGroup",
      methodType = "consumption_share_opportunity_matrix",
      recordType: requestedRecordType,
      unitTotalTep = 0, energySourceId = null,
      items = [],
    } = req.body;

    let resolvedUnitId: number | null = null;
    let recordType = "unit_official";
    let isOfficial = true;

    const requestedCompanyId = parseOptionalId(bodyCompanyId, "companyId");
    const effectiveCompanyId = isSuperAdmin(role) ? (requestedCompanyId ?? sessionCompanyId) : sessionCompanyId;
    const [company] = await db.select({ id: companiesTable.id }).from(companiesTable)
      .where(eq(companiesTable.id, effectiveCompanyId));
    if (!company) throw new AssessmentScopeError(400, "Geçersiz companyId");
    const requestedUnitId = parseOptionalId(unitId, "unitId");

    if (!isCompanyAdmin(role) && !isSuperAdmin(role)) {
      if (sessionUnitId === null) throw new AssessmentScopeError(403, "Yetki yok");
      resolvedUnitId = sessionUnitId;
      recordType = "unit_official";
      isOfficial = true;
    } else {
      resolvedUnitId = requestedUnitId;
      recordType = requestedRecordType ?? "admin_review";
      isOfficial = recordType === "unit_official";
    }

    if (!resolvedUnitId) { res.status(400).json({ error: "Birim seçilmedi" }); return; }
    const [assessmentUnit] = await db.select({ id: unitsTable.id }).from(unitsTable)
      .where(and(eq(unitsTable.id, resolvedUnitId), eq(unitsTable.companyId, effectiveCompanyId)));
    if (!assessmentUnit) throw new AssessmentScopeError(400, "Geçersiz unitId");
    const assessmentEnergySourceId = parseOptionalId(energySourceId, "energySourceId");
    if (assessmentEnergySourceId !== null) {
      const [source] = await db.select({ id: energySourcesTable.id }).from(energySourcesTable)
        .where(and(
          eq(energySourcesTable.id, assessmentEnergySourceId),
          eq(energySourcesTable.companyId, effectiveCompanyId),
          eq(energySourcesTable.unitId, resolvedUnitId),
        ));
      if (!source) throw new AssessmentScopeError(400, "Geçersiz energySourceId");
    }

    const ALLOWED_METHOD_TYPES = ["consumption_share_opportunity_matrix"] as const;
    const resolvedMethodType = methodType || "consumption_share_opportunity_matrix";
    if (!ALLOWED_METHOD_TYPES.includes(resolvedMethodType)) {
      res.status(400).json({ error: `Geçersiz methodType: "${resolvedMethodType}". İzin verilen: ${ALLOWED_METHOD_TYPES.join(", ")}` });
      return;
    }

    if (Array.isArray(items) && items.length > 0) {
      const missingDecision = items.find((item: any) => !item.userDecision);
      if (missingDecision) {
        res.status(400).json({ error: `"${missingDecision.name ?? "Bir kalem"}" için karar seçilmedi. Her satır için karar zorunludur.` });
        return;
      }
    }

    if (!Array.isArray(items)) throw new AssessmentScopeError(400, "items dizi olmalıdır");
    const parsedYear = parseStrictInteger(year, "year");
    const parsedPeriodStart = parseStrictInteger(periodStart, "periodStart", 1, 12);
    const parsedPeriodEnd = parseStrictInteger(periodEnd, "periodEnd", 1, 12);
    if (parsedPeriodStart > parsedPeriodEnd) throw new AssessmentScopeError(400, "periodStart periodEnd değerinden büyük olamaz");
    const validatedItems: any[] = [];
    for (const item of items) {
      const validatedItem = await validateAssessmentItemRelations(
        effectiveCompanyId,
        resolvedUnitId,
        assessmentEnergySourceId,
        item,
      );
      validatedItems.push({
        ...validatedItem,
        userDecision: parseDecision(validatedItem.userDecision),
        targetReductionPercent: validatedItem.targetReductionPercent === undefined
          ? null
          : parseTargetReductionPercent(validatedItem.targetReductionPercent),
      });
    }

    const assessment = await db.transaction(async (tx) => {
    if (recordType === "unit_official") {
      const [existing] = await tx
        .select({ id: seuAssessmentsTable.id })
        .from(seuAssessmentsTable)
        .where(and(
          eq(seuAssessmentsTable.companyId, effectiveCompanyId),
          eq(seuAssessmentsTable.unitId, resolvedUnitId),
          eq(seuAssessmentsTable.year, parsedYear),
          eq(seuAssessmentsTable.analysisLevel, analysisLevel),
          eq(seuAssessmentsTable.methodType, resolvedMethodType),
          eq(seuAssessmentsTable.recordType, "unit_official"),
        ));
      if (existing) {
        if (isCompanyAdmin(role) || isSuperAdmin(role)) {
          throw new AssessmentScopeError(409, "Bu birim için resmi kayıt zaten mevcut. Admin kayıtları ezemez.");
        }
        await tx.delete(seuAssessmentItemsTable).where(eq(seuAssessmentItemsTable.assessmentId, existing.id));
        await tx.delete(seuAssessmentsTable).where(eq(seuAssessmentsTable.id, existing.id));
      }
    }

    const [assessment] = await tx.insert(seuAssessmentsTable).values({
      companyId: effectiveCompanyId,
      unitId: resolvedUnitId,
      year: parsedYear,
      periodStart: parsedPeriodStart,
      periodEnd: parsedPeriodEnd,
      analysisLevel,
      methodType: resolvedMethodType,
      recordType,
      isOfficial,
      unitTotalTep: parseFloat(unitTotalTep) || 0,
      energySourceId: assessmentEnergySourceId,
      createdByUserId: userId,
      updatedByUserId: userId,
    }).returning();

    if (validatedItems.length > 0) {
      await tx.insert(seuAssessmentItemsTable).values(
        validatedItems.map((item: any) => ({
          assessmentId: assessment.id,
          energyUseGroupId: item.energyUseGroupId ?? null,
          meterId: item.meterId ?? null,
          unitId: item.unitId ?? null,
          subUnitId: item.subUnitId ?? null,
          energySourceId: item.energySourceId ?? null,
          name: item.name ?? "Tanımlanmamış",
          energyTep: parseFloat(item.energyTep) || 0,
          consumptionSharePercent: parseFloat(item.consumptionSharePercent) || 0,
          hasOpportunity: !!item.hasOpportunity,
          priorityResult: item.priorityResult ?? null,
          systemRecommendation: item.systemRecommendation ?? "not_seu",
          userDecision: item.userDecision,
          decisionReason: item.decisionReason || null,
          responsible: item.responsible || null,
          targetReductionPercent: item.targetReductionPercent,
          notes: item.notes || null,
        }))
      );
    }

    return assessment;
    });

    res.status(201).json({ id: assessment.id });
  } catch (err) {
    if (handleAssessmentScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── PATCH /seu/assessments/:id/items/:itemId ─────────────
router.patch("/seu/assessments/:id/items/:itemId", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const assessmentId = parsePositiveInteger(req.params.id);
    const itemId = parsePositiveInteger(req.params.itemId);
    if (assessmentId === null || itemId === null) {
      res.status(400).json({ error: "Geçersiz assessmentId veya itemId" }); return;
    }

    const isSuperAdmin = role === "superadmin";
    const isCompanyAdmin = role === "admin" || role === "kontrol_admin";
    if (!isSuperAdmin && !isCompanyAdmin && sessionUnitId === null) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    const assessmentConditions = [eq(seuAssessmentsTable.id, assessmentId)];
    if (!isSuperAdmin) assessmentConditions.push(eq(seuAssessmentsTable.companyId, sessionCompanyId));
    if (!isSuperAdmin && !isCompanyAdmin) {
      assessmentConditions.push(eq(seuAssessmentsTable.unitId, sessionUnitId!));
    }

    const [assessment] = await db
      .select()
      .from(seuAssessmentsTable)
      .where(and(...assessmentConditions));
    if (!assessment) { res.status(404).json({ error: "Bulunamadı" }); return; }

    const [existingItem] = await db
      .select({ consumptionSharePercent: seuAssessmentItemsTable.consumptionSharePercent })
      .from(seuAssessmentItemsTable)
      .where(and(
        eq(seuAssessmentItemsTable.id, itemId),
        eq(seuAssessmentItemsTable.assessmentId, assessmentId),
      ));
    if (!existingItem) { res.status(404).json({ error: "Kalem bulunamadı" }); return; }

    const { hasOpportunity, userDecision, decisionReason, responsible, targetReductionPercent, notes } = req.body;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const parsedDecision = userDecision === undefined ? undefined : parseDecision(userDecision);
    const parsedTargetReductionPercent = targetReductionPercent === undefined
      ? undefined
      : parseTargetReductionPercent(targetReductionPercent);
    if (hasOpportunity !== undefined) updates.hasOpportunity = !!hasOpportunity;
    if (parsedDecision !== undefined) updates.userDecision = parsedDecision;
    if (decisionReason !== undefined) updates.decisionReason = decisionReason || null;
    if (responsible !== undefined) updates.responsible = responsible || null;
    if (parsedTargetReductionPercent !== undefined) updates.targetReductionPercent = parsedTargetReductionPercent;
    if (notes !== undefined) updates.notes = notes || null;

    if (hasOpportunity !== undefined) {
      const share = existingItem.consumptionSharePercent;
      const newHasOpp = !!hasOpportunity;
      const priority = computePriority(share, newHasOpp);
      updates.priorityResult = priority;
      updates.systemRecommendation = computeRecommendation(priority);
    }

    const [updated] = await db
      .update(seuAssessmentItemsTable)
      .set(updates)
      .where(and(eq(seuAssessmentItemsTable.id, itemId), eq(seuAssessmentItemsTable.assessmentId, assessmentId)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Kalem bulunamadı" }); return; }
    res.json(updated);
  } catch (err) {
    if (handleAssessmentScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── PATCH /seu/decision-items/analysis/:itemId ───────────
// Shorthand: update an analysis item knowing only itemId (no assessmentId needed)
router.patch("/seu/decision-items/analysis/:itemId", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const itemId = parsePositiveInteger(req.params.itemId);
    if (itemId === null) { res.status(400).json({ error: "Geçersiz itemId" }); return; }

    const standardUser = !isCompanyAdmin(role) && !isSuperAdmin(role);
    if (standardUser && sessionUnitId === null) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    const itemConditions = [
      eq(seuAssessmentItemsTable.id, itemId),
      eq(seuAssessmentsTable.companyId, sessionCompanyId),
    ];
    if (standardUser) itemConditions.push(eq(seuAssessmentsTable.unitId, sessionUnitId!));

    const [existingItem] = await db
      .select({
        id: seuAssessmentItemsTable.id,
        assessmentId: seuAssessmentItemsTable.assessmentId,
        consumptionSharePercent: seuAssessmentItemsTable.consumptionSharePercent,
        recordType: seuAssessmentsTable.recordType,
      })
      .from(seuAssessmentItemsTable)
      .innerJoin(seuAssessmentsTable, eq(seuAssessmentItemsTable.assessmentId, seuAssessmentsTable.id))
      .where(and(...itemConditions));
    if (!existingItem) { res.status(404).json({ error: "Kalem bulunamadı" }); return; }

    if ((isCompanyAdmin(role) || isSuperAdmin(role)) && existingItem.recordType === "unit_official") {
      res.status(403).json({ error: "Admin resmi kayıt kalemlerini düzenleyemez" }); return;
    }

    const { hasOpportunity, userDecision, decisionReason, responsible, targetReductionPercent, notes } = req.body;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const parsedDecision = userDecision === undefined ? undefined : parseDecision(userDecision);
    const parsedTargetReductionPercent = targetReductionPercent === undefined
      ? undefined
      : parseTargetReductionPercent(targetReductionPercent);
    if (hasOpportunity !== undefined) updates.hasOpportunity = !!hasOpportunity;
    if (parsedDecision !== undefined) updates.userDecision = parsedDecision;
    if (decisionReason !== undefined) updates.decisionReason = decisionReason || null;
    if (responsible !== undefined) updates.responsible = responsible || null;
    if (parsedTargetReductionPercent !== undefined) updates.targetReductionPercent = parsedTargetReductionPercent;
    if (notes !== undefined) updates.notes = notes || null;

    if (hasOpportunity !== undefined) {
      const share = existingItem.consumptionSharePercent;
      const newHasOpp = !!hasOpportunity;
      const priority = computePriority(share, newHasOpp);
      updates.priorityResult = priority;
      updates.systemRecommendation = computeRecommendation(priority);
    }

    const [updated] = await db
      .update(seuAssessmentItemsTable)
      .set(updates)
      .where(and(
        eq(seuAssessmentItemsTable.id, itemId),
        eq(seuAssessmentItemsTable.assessmentId, existingItem.assessmentId),
      ))
      .returning();
    if (!updated) { res.status(404).json({ error: "Kalem bulunamadı" }); return; }
    res.json(updated);
  } catch (err) {
    if (handleAssessmentScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── DELETE /seu/assessments/:id ──────────────────────────
router.delete("/seu/assessments/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parsePositiveInteger(req.params.id);
    if (id === null) { res.status(400).json({ error: "Geçersiz assessmentId" }); return; }
    const standardUser = !isCompanyAdmin(role) && !isSuperAdmin(role);
    if (standardUser && sessionUnitId === null) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    const assessmentConditions = [
      eq(seuAssessmentsTable.id, id),
      eq(seuAssessmentsTable.companyId, sessionCompanyId),
    ];
    if (standardUser) assessmentConditions.push(eq(seuAssessmentsTable.unitId, sessionUnitId!));

    const deleteResult = await db.transaction(async (tx) => {
      const [assessment] = await tx
        .select({
          id: seuAssessmentsTable.id,
          companyId: seuAssessmentsTable.companyId,
          recordType: seuAssessmentsTable.recordType,
        })
        .from(seuAssessmentsTable)
        .where(and(...assessmentConditions))
        .limit(1)
        .for("update");
      if (!assessment) return "not_found" as const;
      if (isCompanyAdmin(role) && assessment.recordType === "unit_official") {
        return "official" as const;
      }

      const assessmentItems = await tx.select({ id: seuAssessmentItemsTable.id })
        .from(seuAssessmentItemsTable)
        .where(eq(seuAssessmentItemsTable.assessmentId, assessment.id))
        .for("update");
      const itemIds = assessmentItems.map((item) => item.id);

      const [target] = await tx.select({ id: energyTargetsTable.id })
        .from(energyTargetsTable)
        .where(and(
          eq(energyTargetsTable.companyId, assessment.companyId),
          eq(energyTargetsTable.seuAssessmentId, assessment.id),
        ))
        .limit(1);

      const [targetByItem] = itemIds.length > 0
        ? await tx.select({ id: energyTargetsTable.id })
          .from(energyTargetsTable)
          .where(and(
            eq(energyTargetsTable.companyId, assessment.companyId),
            inArray(energyTargetsTable.seuAssessmentItemId, itemIds),
          ))
          .limit(1)
        : [];

      let hasItemDependency = false;
      if (itemIds.length > 0) {
        const [indicator] = await tx.select({ id: energyPerformanceIndicatorsTable.id })
          .from(energyPerformanceIndicatorsTable)
          .where(and(
            eq(energyPerformanceIndicatorsTable.companyId, assessment.companyId),
            inArray(energyPerformanceIndicatorsTable.seuAssessmentItemId, itemIds),
          ))
          .limit(1);
        const [baseline] = await tx.select({ id: energyBaselinesTable.id })
          .from(energyBaselinesTable)
          .where(and(
            eq(energyBaselinesTable.companyId, assessment.companyId),
            inArray(energyBaselinesTable.seuAssessmentItemId, itemIds),
          ))
          .limit(1);
        const [performanceResult] = await tx.select({ id: energyPerformanceResultsTable.id })
          .from(energyPerformanceResultsTable)
          .where(and(
            eq(energyPerformanceResultsTable.companyId, assessment.companyId),
            inArray(energyPerformanceResultsTable.seuAssessmentItemId, itemIds),
          ))
          .limit(1);
        hasItemDependency = Boolean(indicator || baseline || performanceResult);
      }

      if (target || targetByItem || hasItemDependency) return "dependent" as const;

      const [deleted] = await tx.delete(seuAssessmentsTable)
        .where(and(...assessmentConditions))
        .returning({ id: seuAssessmentsTable.id });
      return deleted ? "deleted" as const : "not_found" as const;
    });

    if (deleteResult === "not_found") { res.status(404).send(); return; }
    if (deleteResult === "official") {
      res.status(403).json({ error: "Admin resmi kayıtları silemez" }); return;
    }
    if (deleteResult === "dependent") {
      res.status(409).json({ error: "Bu ÖEK değerlendirmesine bağlı kayıtlar bulunduğu için silinemez." });
      return;
    }
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── GET /seu/decision-items ──────────────────────────────
// Normal kullanıcı için flat item listesi; hem analiz kaynaklı hem manuel itemları döner.
router.get("/seu/decision-items", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const year = parseOptionalYear(req.query.year, null);
    const requestedCompanyId = parseOptionalId(req.query.companyId, "companyId");
    const requestedUnitId = parseOptionalId(req.query.unitId, "unitId");

    const recordTypeFilter = (req.query.recordType as string) || null;

    const standardUser = !isCompanyAdmin(role) && !isSuperAdmin(role);
    if (standardUser && sessionUnitId === null) {
      res.json([]);
      return;
    }

    let effectiveCompanyId = isSuperAdmin(role) ? requestedCompanyId : sessionCompanyId;
    const effectiveUnitId = standardUser ? sessionUnitId : requestedUnitId;
    if (effectiveUnitId !== null && !standardUser) {
      const unitCompanyId = await resolveUnitCompanyId(effectiveUnitId, effectiveCompanyId);
      effectiveCompanyId ??= unitCompanyId;
    }

    // ── Analiz kaynaklı kayıtlar ───────────────────────────
    const assessmentConds = [];
    if (effectiveCompanyId !== null) assessmentConds.push(eq(seuAssessmentsTable.companyId, effectiveCompanyId));
    if (standardUser) {
      assessmentConds.push(eq(seuAssessmentsTable.unitId, sessionUnitId!));
      assessmentConds.push(eq(seuAssessmentsTable.recordType, "unit_official"));
    } else {
      if (effectiveUnitId !== null) assessmentConds.push(eq(seuAssessmentsTable.unitId, effectiveUnitId));
      if (recordTypeFilter) assessmentConds.push(eq(seuAssessmentsTable.recordType, recordTypeFilter));
    }
    if (year) assessmentConds.push(eq(seuAssessmentsTable.year, year));

    const analysisRows = await db
      .select({
        itemId: seuAssessmentItemsTable.id,
        assessmentId: seuAssessmentItemsTable.assessmentId,
        name: seuAssessmentItemsTable.name,
        energyTep: seuAssessmentItemsTable.energyTep,
        consumptionSharePercent: seuAssessmentItemsTable.consumptionSharePercent,
        hasOpportunity: seuAssessmentItemsTable.hasOpportunity,
        priorityResult: seuAssessmentItemsTable.priorityResult,
        systemRecommendation: seuAssessmentItemsTable.systemRecommendation,
        userDecision: seuAssessmentItemsTable.userDecision,
        decisionReason: seuAssessmentItemsTable.decisionReason,
        responsible: seuAssessmentItemsTable.responsible,
        targetReductionPercent: seuAssessmentItemsTable.targetReductionPercent,
        notes: seuAssessmentItemsTable.notes,
        itemUpdatedAt: seuAssessmentItemsTable.updatedAt,
        assessmentYear: seuAssessmentsTable.year,
        periodStart: seuAssessmentsTable.periodStart,
        periodEnd: seuAssessmentsTable.periodEnd,
        analysisLevel: seuAssessmentsTable.analysisLevel,
        recordType: seuAssessmentsTable.recordType,
        unitTotalTep: seuAssessmentsTable.unitTotalTep,
        unitId: seuAssessmentsTable.unitId,
        unitName: unitsTable.name,
      })
      .from(seuAssessmentItemsTable)
      .innerJoin(seuAssessmentsTable, eq(seuAssessmentItemsTable.assessmentId, seuAssessmentsTable.id))
      .leftJoin(unitsTable, eq(seuAssessmentsTable.unitId, unitsTable.id))
      .where(assessmentConds.length > 0 ? and(...assessmentConds) : undefined)
      .orderBy(desc(seuAssessmentsTable.year), desc(seuAssessmentItemsTable.consumptionSharePercent));

    // ── Manuel kayıtlar (seuTable) ─────────────────────────
    const manualConds = [];
    if (effectiveCompanyId !== null) manualConds.push(eq(seuTable.companyId, effectiveCompanyId));
    if (standardUser) {
      manualConds.push(eq(seuTable.unitId, sessionUnitId!));
    } else if (effectiveUnitId !== null) {
      manualConds.push(eq(seuTable.unitId, effectiveUnitId));
    }

    const manualRows = await db
      .select({
        id: seuTable.id,
        unitId: seuTable.unitId,
        name: seuTable.name,
        category: seuTable.category,
        annualKwh: seuTable.annualKwh,
        percentage: seuTable.percentage,
        priority: seuTable.priority,
        targetReductionPercent: seuTable.targetReductionPercent,
        responsible: seuTable.responsible,
        notes: seuTable.notes,
        createdAt: seuTable.createdAt,
        unitName: unitsTable.name,
      })
      .from(seuTable)
      .leftJoin(unitsTable, eq(seuTable.unitId, unitsTable.id))
      .where(manualConds.length > 0 ? and(...manualConds) : undefined)
      .orderBy(seuTable.priority);

    // Normalize manual rows to the same shape as analysis rows
    const normalizedManual = manualRows.map(m => ({
      itemId: null as number | null,
      assessmentId: null as number | null,
      manualId: m.id,
      source: "manual" as const,
      name: m.name,
      energyTep: m.annualKwh,
      consumptionSharePercent: m.percentage,
      hasOpportunity: false,
      priorityResult: m.priority,
      systemRecommendation: "seu_candidate" as const,
      userDecision: null as string | null,
      decisionReason: null as string | null,
      responsible: m.responsible,
      targetReductionPercent: m.targetReductionPercent,
      notes: m.notes,
      itemUpdatedAt: m.createdAt,
      assessmentYear: null as number | null,
      periodStart: null as number | null,
      periodEnd: null as number | null,
      analysisLevel: "manual" as const,
      recordType: "unit_official",
      unitTotalTep: null as number | null,
      unitId: m.unitId,
      unitName: m.unitName,
      category: m.category,
    }));

    const normalizedAnalysis = analysisRows.map(r => ({
      ...r,
      manualId: null as number | null,
      source: "analysis" as const,
      category: null as string | null,
    }));

    res.json([...normalizedAnalysis, ...normalizedManual]);
  } catch (err) {
    if (handleAssessmentScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── GET /seu/admin/unit-summary ───────────────────────────
// Admin için birim kıyaslama özeti
router.get("/seu/admin/unit-summary", requireAuth, requireCompanyAdmin, async (req, res) => {
  try {
    const { companyId: sessionCompanyId } = req.user!;

    const year = parseOptionalYear(req.query.year, new Date().getFullYear())!;
    const recordTypeFilter = (req.query.recordType as string) || "all";

    // Tüm birimler
    const allUnits = await db
      .select({ id: unitsTable.id, name: unitsTable.name })
      .from(unitsTable)
      .where(eq(unitsTable.companyId, sessionCompanyId));

    // Assessments for the year
    const assessmentConds = [
      eq(seuAssessmentsTable.companyId, sessionCompanyId),
      eq(seuAssessmentsTable.year, year),
    ];
    if (recordTypeFilter !== "all") {
      assessmentConds.push(eq(seuAssessmentsTable.recordType, recordTypeFilter));
    }

    const assessments = await db
      .select({
        id: seuAssessmentsTable.id,
        unitId: seuAssessmentsTable.unitId,
        recordType: seuAssessmentsTable.recordType,
        unitTotalTep: seuAssessmentsTable.unitTotalTep,
        analysisLevel: seuAssessmentsTable.analysisLevel,
        createdAt: seuAssessmentsTable.createdAt,
        updatedAt: seuAssessmentsTable.updatedAt,
      })
      .from(seuAssessmentsTable)
      .where(and(...assessmentConds))
      .orderBy(desc(seuAssessmentsTable.createdAt));

    const assessmentIds = assessments.map(a => a.id);

    // Item counts per assessment
    let itemDetails: Record<number, { total: number; seu: number; monitor: number; notSeu: number; topName: string | null; topShare: number }> = {};
    if (assessmentIds.length > 0) {
      const counts = await db
        .select({
          assessmentId: seuAssessmentItemsTable.assessmentId,
          total: sql<number>`COUNT(*)`,
          seu: sql<number>`SUM(CASE WHEN ${seuAssessmentItemsTable.userDecision} = 'accepted_as_seu' THEN 1 ELSE 0 END)`,
          monitor: sql<number>`SUM(CASE WHEN ${seuAssessmentItemsTable.userDecision} = 'monitor' THEN 1 ELSE 0 END)`,
          notSeu: sql<number>`SUM(CASE WHEN ${seuAssessmentItemsTable.userDecision} = 'not_seu' THEN 1 ELSE 0 END)`,
        })
        .from(seuAssessmentItemsTable)
        .where(inArray(seuAssessmentItemsTable.assessmentId, assessmentIds))
        .groupBy(seuAssessmentItemsTable.assessmentId);

      const topItems = await db
        .select({
          assessmentId: seuAssessmentItemsTable.assessmentId,
          name: seuAssessmentItemsTable.name,
          share: seuAssessmentItemsTable.consumptionSharePercent,
        })
        .from(seuAssessmentItemsTable)
        .where(inArray(seuAssessmentItemsTable.assessmentId, assessmentIds))
        .orderBy(desc(seuAssessmentItemsTable.consumptionSharePercent));

      const topByAssessment: Record<number, { name: string; share: number }> = {};
      for (const t of topItems) {
        if (!topByAssessment[t.assessmentId]) {
          topByAssessment[t.assessmentId] = { name: t.name, share: Number(t.share) || 0 };
        }
      }

      itemDetails = Object.fromEntries(counts.map(c => [
        c.assessmentId,
        {
          total: Number(c.total) || 0,
          seu: Number(c.seu) || 0,
          monitor: Number(c.monitor) || 0,
          notSeu: Number(c.notSeu) || 0,
          topName: topByAssessment[c.assessmentId]?.name ?? null,
          topShare: topByAssessment[c.assessmentId]?.share ?? 0,
        },
      ]));
    }

    // Manual items per unit
    const manualRows = await db
      .select({
        unitId: seuTable.unitId,
        count: sql<number>`COUNT(*)`,
      })
      .from(seuTable)
      .where(eq(seuTable.companyId, sessionCompanyId))
      .groupBy(seuTable.unitId);
    const manualCountByUnit: Record<number, number> = Object.fromEntries(
      manualRows.map(r => [r.unitId, Number(r.count) || 0])
    );

    // Group assessments by unit
    const byUnit: Record<number, typeof assessments> = {};
    for (const a of assessments) {
      if (!a.unitId) continue;
      if (!byUnit[a.unitId]) byUnit[a.unitId] = [];
      byUnit[a.unitId].push(a);
    }

    // Company total TEP (from official assessments this year)
    const officialAssessments = assessments.filter(a => a.recordType === "unit_official");
    const officialByUnit: Record<number, (typeof assessments)[0]> = {};
    for (const a of officialAssessments) {
      if (!a.unitId) continue;
      if (!officialByUnit[a.unitId] || a.createdAt > officialByUnit[a.unitId].createdAt) {
        officialByUnit[a.unitId] = a;
      }
    }
    const companyTotalTep = Object.values(officialByUnit).reduce((s, a) => s + (a.unitTotalTep || 0), 0);

    const unitSummaries = allUnits.map(unit => {
      const unitAssessments = byUnit[unit.id] ?? [];

      // Latest per analysisLevel (for distinct views)
      const latestByLevel: Record<string, (typeof assessments)[0]> = {};
      for (const a of unitAssessments) {
        const key = `${a.analysisLevel}-${a.recordType}`;
        if (!latestByLevel[key] || a.createdAt > latestByLevel[key].createdAt) {
          latestByLevel[key] = a;
        }
      }
      const latestAssessments = Object.values(latestByLevel);

      const hasOfficialAssessment = unitAssessments.some(a => a.recordType === "unit_official");
      const officialAssessment = officialByUnit[unit.id];
      const unitTotalTep = officialAssessment?.unitTotalTep ?? 0;
      const companySharePercent = companyTotalTep > 0 ? Math.round((unitTotalTep / companyTotalTep) * 10000) / 100 : 0;

      const totalItems = latestAssessments.reduce((s, a) => s + (itemDetails[a.id]?.total ?? 0), 0);
      const seuCount = latestAssessments.reduce((s, a) => s + (itemDetails[a.id]?.seu ?? 0), 0);
      const monitorCount = latestAssessments.reduce((s, a) => s + (itemDetails[a.id]?.monitor ?? 0), 0);
      const notSeuCount = latestAssessments.reduce((s, a) => s + (itemDetails[a.id]?.notSeu ?? 0), 0);
      const manualCount = manualCountByUnit[unit.id] ?? 0;

      // Top energy group from official assessment
      const officialItems = officialAssessment ? itemDetails[officialAssessment.id] : null;
      const topGroupName = officialItems?.topName ?? null;
      const topGroupShare = officialItems?.topShare ?? 0;

      const lastUpdatedAt = latestAssessments.length > 0
        ? latestAssessments.map(a => a.updatedAt).sort((a, b) => b > a ? 1 : -1)[0]
        : null;

      return {
        unitId: unit.id,
        unitName: unit.name,
        unitTotalTep,
        companySharePercent,
        hasOfficialAssessment,
        totalItems,
        seuCount,
        monitorCount,
        notSeuCount,
        manualCount,
        topGroupName,
        topGroupShare,
        lastUpdatedAt,
        assessmentCount: unitAssessments.length,
      };
    });

    res.json({
      year,
      companyTotalTep,
      units: unitSummaries.sort((a, b) => b.unitTotalTep - a.unitTotalTep),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── GET /seu/admin/unit-detail/:unitId ────────────────────
// Admin için birim item detayları
router.get("/seu/admin/unit-detail/:unitId", requireAuth, requireCompanyAdmin, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    const unitId = parsePositiveInteger(req.params.unitId);
    if (unitId === null) { res.status(400).json({ error: "Geçersiz unitId" }); return; }
    const targetCompanyId = await resolveUnitCompanyId(unitId, isSuperAdmin(role) ? null : sessionCompanyId);
    const year = parseOptionalYear(req.query.year, new Date().getFullYear())!;

    // Official assessments for this unit/year
    const assessments = await db
      .select()
      .from(seuAssessmentsTable)
      .where(and(
        eq(seuAssessmentsTable.companyId, targetCompanyId),
        eq(seuAssessmentsTable.unitId, unitId),
        eq(seuAssessmentsTable.year, year),
        eq(seuAssessmentsTable.recordType, "unit_official"),
      ))
      .orderBy(desc(seuAssessmentsTable.createdAt));

    const assessmentIds = assessments.map(a => a.id);
    let analysisItems: any[] = [];
    if (assessmentIds.length > 0) {
      analysisItems = await db
        .select()
        .from(seuAssessmentItemsTable)
        .where(inArray(seuAssessmentItemsTable.assessmentId, assessmentIds))
        .orderBy(desc(seuAssessmentItemsTable.consumptionSharePercent));
    }

    // Manual items for this unit
    const manualItems = await db
      .select()
      .from(seuTable)
      .where(and(eq(seuTable.companyId, targetCompanyId), eq(seuTable.unitId, unitId)))
      .orderBy(seuTable.priority);

    res.json({
      unitId,
      year,
      analysisItems: analysisItems.map(i => ({ ...i, source: "analysis" })),
      manualItems: manualItems.map(i => ({
        id: i.id,
        name: i.name,
        energyTep: i.annualKwh,
        consumptionSharePercent: i.percentage,
        hasOpportunity: false,
        priorityResult: i.priority,
        userDecision: null,
        decisionReason: null,
        responsible: i.responsible,
        targetReductionPercent: i.targetReductionPercent,
        notes: i.notes,
        source: "manual",
      })),
    });
  } catch (err) {
    if (handleAssessmentScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
