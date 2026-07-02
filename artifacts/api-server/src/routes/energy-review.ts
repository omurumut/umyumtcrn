import { Router } from "express";
import {
  db,
  consumptionTable,
  metersTable,
  energySourcesTable,
  unitsTable,
  seuAssessmentsTable,
  seuAssessmentItemsTable,
  energyUseGroupsTable,
  energyPerformanceIndicatorsTable,
  energyBaselinesTable,
  energyPerformanceResultsTable,
  energyTargetsTable,
  energyActionPlansTable,
  vapProjectsTable,
} from "@workspace/db";
import { eq, and, inArray, desc, SQL, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";

const router = Router();

// ── Yardımcı: yıl bazlı tüketim koşulları ────────────────────────────────────
function buildConsumptionConds(
  year: number,
  meterIds: number[],
): SQL {
  if (meterIds.length === 0) return eq(consumptionTable.year, -1);
  return and(
    eq(consumptionTable.year, year),
    inArray(consumptionTable.meterId, meterIds),
  ) as SQL;
}

// ── Yardımcı: birim için sayaç id'lerini al ───────────────────────────────────
async function getMeterIds(unitId: number | null, companyId: number): Promise<number[]> {
  const conds: SQL[] = [eq(metersTable.companyId, companyId)];
  if (unitId !== null) conds.push(eq(metersTable.unitId, unitId));
  const rows = await db
    .select({ id: metersTable.id })
    .from(metersTable)
    .where(and(...conds));
  return rows.map((r) => r.id);
}

// ── Yardımcı: kabul edilmiş ÖEK itemleri ─────────────────────────────────────
async function getAcceptedSeuItems(unitId: number | null, companyId: number) {
  const assessmentConds: SQL[] = [
    eq(seuAssessmentsTable.companyId, companyId),
    eq(seuAssessmentsTable.recordType, "unit_official"),
  ];
  if (unitId !== null) assessmentConds.push(eq(seuAssessmentsTable.unitId, unitId));

  const assessments = await db
    .select({ id: seuAssessmentsTable.id })
    .from(seuAssessmentsTable)
    .where(and(...assessmentConds));

  if (assessments.length === 0) return [];
  const assessmentIds = assessments.map((a) => a.id);

  const items = await db
    .select({
      id: seuAssessmentItemsTable.id,
      name: seuAssessmentItemsTable.name,
      energyTep: seuAssessmentItemsTable.energyTep,
      unitId: seuAssessmentItemsTable.unitId,
      energySourceId: seuAssessmentItemsTable.energySourceId,
      energyUseGroupId: seuAssessmentItemsTable.energyUseGroupId,
      userDecision: seuAssessmentItemsTable.userDecision,
      assessmentId: seuAssessmentItemsTable.assessmentId,
    })
    .from(seuAssessmentItemsTable)
    .where(
      and(
        inArray(seuAssessmentItemsTable.assessmentId, assessmentIds),
        eq(seuAssessmentItemsTable.userDecision, "accepted_as_seu"),
      ),
    );
  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/energy-review/overview
// Parametreler: year, unitId (admin için)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/energy-review/overview", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;

    const year = req.query.year
      ? parseInt(req.query.year as string)
      : new Date().getFullYear();

    // Birim yetkilendirmesi: standart kullanıcı → session unitId
    const effectiveUnitId: number | null =
      role === "admin" || role === "superadmin"
        ? req.query.unitId
          ? parseInt(req.query.unitId as string)
          : null
        : sessionUnitId;

    const meterIds = await getMeterIds(effectiveUnitId, sessionCompanyId);

    // Toplam TEP & CO₂
    let totalTep = 0;
    let totalCo2Ton = 0;
    if (meterIds.length > 0) {
      const consRows = await db
        .select({
          tep: sql<number>`coalesce(sum(${consumptionTable.tep}), 0)`.as("tep"),
          co2: sql<number>`coalesce(sum(${consumptionTable.co2}), 0)`.as("co2"),
        })
        .from(consumptionTable)
        .where(buildConsumptionConds(year, meterIds));
      if (consRows[0]) {
        totalTep = consRows[0].tep ?? 0;
        totalCo2Ton = (consRows[0].co2 ?? 0) / 1000; // kg → ton
      }
    }

    // Kabul edilmiş ÖEK sayısı
    const seuItems = await getAcceptedSeuItems(effectiveUnitId, sessionCompanyId);
    const seuCount = seuItems.length;
    const seuItemIds = seuItems.map((s) => s.id);

    // Aktif EnPG sayısı
    const enpiConds: SQL[] = [
      eq(energyPerformanceIndicatorsTable.companyId, sessionCompanyId),
      eq(energyPerformanceIndicatorsTable.isActive, true),
    ];
    if (effectiveUnitId !== null)
      enpiConds.push(eq(energyPerformanceIndicatorsTable.unitId, effectiveUnitId));

    const enpiRows = await db
      .select({ id: energyPerformanceIndicatorsTable.id })
      .from(energyPerformanceIndicatorsTable)
      .where(and(...enpiConds));
    const activeEnpiCount = enpiRows.length;

    // İzlenen / İzlenmeyen ÖEK
    let monitoredSeuCount = 0;
    if (seuItemIds.length > 0) {
      const monitoredRows = await db
        .selectDistinct({ seuId: energyPerformanceResultsTable.seuAssessmentItemId })
        .from(energyPerformanceResultsTable)
        .where(
          and(
            inArray(
              energyPerformanceResultsTable.seuAssessmentItemId,
              seuItemIds,
            ),
            eq(energyPerformanceResultsTable.year, year),
          ),
        );
      monitoredSeuCount = monitoredRows.length;
    }
    const unmonitoredSeuCount = Math.max(0, seuCount - monitoredSeuCount);

    // Aktif hedef sayısı
    const targetConds: SQL[] = [
      eq(energyTargetsTable.companyId, sessionCompanyId),
      eq(energyTargetsTable.status, "active"),
    ];
    if (effectiveUnitId !== null)
      targetConds.push(eq(energyTargetsTable.unitId, effectiveUnitId));
    const targetRows = await db
      .select({ id: energyTargetsTable.id, baselineYear: energyTargetsTable.baselineYear, targetYear: energyTargetsTable.targetYear })
      .from(energyTargetsTable)
      .where(and(...targetConds));
    const activeTargets = targetRows.filter(
      (t) => (t.baselineYear ?? 0) <= year && year <= (t.targetYear ?? 9999),
    );
    const targetsCount = activeTargets.length;
    const activeTargetIds = activeTargets.map((t) => t.id);

    // Açık & Gecikmiş aksiyon sayısı
    let openActionsCount = 0;
    let overdueActionsCount = 0;
    if (activeTargetIds.length > 0) {
      const actionRows = await db
        .select({
          status: energyActionPlansTable.status,
          dueDate: energyActionPlansTable.dueDate,
        })
        .from(energyActionPlansTable)
        .where(inArray(energyActionPlansTable.targetId, activeTargetIds));

      const today = new Date().toISOString().slice(0, 10);
      for (const a of actionRows) {
        if (a.status !== "completed" && a.status !== "cancelled") {
          openActionsCount++;
          if (a.dueDate && a.dueDate < today) overdueActionsCount++;
        }
      }
    }

    // Aktif VAP sayısı
    let activeVapCount = 0;
    if (activeTargetIds.length > 0) {
      const vapActionRows = await db
        .select({ id: energyActionPlansTable.id })
        .from(energyActionPlansTable)
        .where(
          and(
            inArray(energyActionPlansTable.targetId, activeTargetIds),
            eq(energyActionPlansTable.isVap, true),
          ),
        );
      const vapActionIds = vapActionRows.map((r) => r.id);
      if (vapActionIds.length > 0) {
        const vapRows = await db
          .select({ id: vapProjectsTable.id })
          .from(vapProjectsTable)
          .where(inArray(vapProjectsTable.actionPlanId, vapActionIds));
        activeVapCount = vapRows.length;
      }
    }

    res.json({
      year,
      totalTep: Math.round(totalTep * 1000) / 1000,
      totalCo2Ton: Math.round(totalCo2Ton * 100) / 100,
      seuCount,
      activeEnpiCount,
      monitoredSeuCount,
      unmonitoredSeuCount,
      targetsCount,
      openActionsCount,
      overdueActionsCount,
      activeVapCount,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/energy-review/source-breakdown
// Parametreler: year, unitId (admin için)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/energy-review/source-breakdown", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;

    const year = req.query.year
      ? parseInt(req.query.year as string)
      : new Date().getFullYear();

    const effectiveUnitId: number | null =
      role === "admin" || role === "superadmin"
        ? req.query.unitId
          ? parseInt(req.query.unitId as string)
          : null
        : sessionUnitId;

    const meterIds = await getMeterIds(effectiveUnitId, sessionCompanyId);

    if (meterIds.length === 0) {
      res.json([]);
      return;
    }

    // Tüketim + kaynak bilgisi → GROUP BY enerji kaynağı
    const rows = await db
      .select({
        energySourceId: metersTable.energySourceId,
        rawConsumption: sql<number>`coalesce(sum(${consumptionTable.kwh}), 0)`.as("raw_consumption"),
        tep: sql<number>`coalesce(sum(${consumptionTable.tep}), 0)`.as("tep"),
        co2Kg: sql<number>`coalesce(sum(${consumptionTable.co2}), 0)`.as("co2_kg"),
      })
      .from(consumptionTable)
      .leftJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
      .where(buildConsumptionConds(year, meterIds))
      .groupBy(metersTable.energySourceId);

    if (rows.length === 0) {
      res.json([]);
      return;
    }

    // Kaynak bilgilerini çek
    const sourceIds = rows
      .map((r) => r.energySourceId)
      .filter((id): id is number => id !== null);

    const sources =
      sourceIds.length > 0
        ? await db
            .select({ id: energySourcesTable.id, name: energySourcesTable.name, unit: energySourcesTable.unit })
            .from(energySourcesTable)
            .where(inArray(energySourcesTable.id, sourceIds))
        : [];

    const sourceMap = new Map(sources.map((s) => [s.id, s]));

    const totalTep = rows.reduce((acc, r) => acc + (r.tep ?? 0), 0);

    const breakdown = rows
      .filter((r) => r.energySourceId !== null)
      .map((r) => {
        const source = sourceMap.get(r.energySourceId!);
        const tep = r.tep ?? 0;
        const tepSharePercent =
          totalTep > 0 ? Math.round((tep / totalTep) * 10000) / 100 : 0;
        return {
          energySourceId: r.energySourceId,
          energySourceName: source?.name ?? "Bilinmeyen Kaynak",
          unitOfMeasure: source?.unit ?? "-",
          rawConsumption: Math.round((r.rawConsumption ?? 0) * 1000) / 1000,
          tep: Math.round(tep * 1000) / 1000,
          co2Ton: Math.round(((r.co2Kg ?? 0) / 1000) * 100) / 100,
          tepSharePercent,
        };
      })
      .sort((a, b) => b.tep - a.tep);

    res.json(breakdown);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/energy-review/enpi-summary
// Parametreler: year, unitId (admin için)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/energy-review/enpi-summary", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;

    const year = req.query.year
      ? parseInt(req.query.year as string)
      : new Date().getFullYear();

    const effectiveUnitId: number | null =
      role === "admin" || role === "superadmin"
        ? req.query.unitId
          ? parseInt(req.query.unitId as string)
          : null
        : sessionUnitId;

    // Kabul edilmiş ÖEK kalemleri
    const seuItems = await getAcceptedSeuItems(effectiveUnitId, sessionCompanyId);
    if (seuItems.length === 0) {
      res.json([]);
      return;
    }

    const seuItemIds = seuItems.map((s) => s.id);

    // SEU item için yardımcı lookup haritaları
    const unitIds = [...new Set(seuItems.map((s) => s.unitId).filter((id): id is number => id !== null))];
    const esIds = [...new Set(seuItems.map((s) => s.energySourceId).filter((id): id is number => id !== null))];
    const eugIds = [...new Set(seuItems.map((s) => s.energyUseGroupId).filter((id): id is number => id !== null))];

    const [unitRows, esRows, eugRows] = await Promise.all([
      unitIds.length > 0
        ? db.select({ id: unitsTable.id, name: unitsTable.name }).from(unitsTable).where(inArray(unitsTable.id, unitIds))
        : Promise.resolve([]),
      esIds.length > 0
        ? db.select({ id: energySourcesTable.id, name: energySourcesTable.name }).from(energySourcesTable).where(inArray(energySourcesTable.id, esIds))
        : Promise.resolve([]),
      eugIds.length > 0
        ? db.select({ id: energyUseGroupsTable.id, name: energyUseGroupsTable.name }).from(energyUseGroupsTable).where(inArray(energyUseGroupsTable.id, eugIds))
        : Promise.resolve([]),
    ]);

    const unitMap = new Map(unitRows.map((r) => [r.id, r.name]));
    const esMap = new Map(esRows.map((r) => [r.id, r.name]));
    const eugMap = new Map(eugRows.map((r) => [r.id, r.name]));

    // EnPG → ÖEK bağlantısı
    const enpiRows = await db
      .select({
        id: energyPerformanceIndicatorsTable.id,
        seuAssessmentItemId: energyPerformanceIndicatorsTable.seuAssessmentItemId,
        name: energyPerformanceIndicatorsTable.name,
        isActive: energyPerformanceIndicatorsTable.isActive,
      })
      .from(energyPerformanceIndicatorsTable)
      .where(
        and(
          eq(energyPerformanceIndicatorsTable.companyId, sessionCompanyId),
          inArray(energyPerformanceIndicatorsTable.seuAssessmentItemId, seuItemIds),
        ),
      );
    const enpiMap = new Map(enpiRows.map((r) => [r.seuAssessmentItemId, r]));
    const enpiIds = enpiRows.map((r) => r.id);

    // EnRÇ (baseline) → ÖEK veya EnPG bağlantısı
    const baselineRows =
      seuItemIds.length > 0
        ? await db
            .select({
              id: energyBaselinesTable.id,
              seuAssessmentItemId: energyBaselinesTable.seuAssessmentItemId,
              enpiId: energyBaselinesTable.enpiId,
              periodStart: energyBaselinesTable.periodStart,
              periodEnd: energyBaselinesTable.periodEnd,
              baselineYear: energyBaselinesTable.baselineYear,
              rSquared: energyBaselinesTable.rSquared,
              adjustedRSquared: energyBaselinesTable.adjustedRSquared,
              formulaText: energyBaselinesTable.formulaText,
              status: energyBaselinesTable.status,
              isValid: energyBaselinesTable.isValid,
            })
            .from(energyBaselinesTable)
            .where(
              and(
                eq(energyBaselinesTable.companyId, sessionCompanyId),
                inArray(energyBaselinesTable.seuAssessmentItemId, seuItemIds),
              ),
            )
        : [];

    // Her ÖEK için en son (geçerli) baseline seç
    const baselineMap = new Map<number, typeof baselineRows[0]>();
    for (const b of baselineRows) {
      if (b.seuAssessmentItemId === null) continue;
      const existing = baselineMap.get(b.seuAssessmentItemId);
      if (!existing || (b.isValid && !existing.isValid)) {
        baselineMap.set(b.seuAssessmentItemId, b);
      }
    }

    // EnPG sonuçları
    const resultConds: SQL[] = [
      eq(energyPerformanceResultsTable.companyId, sessionCompanyId),
      inArray(energyPerformanceResultsTable.seuAssessmentItemId, seuItemIds),
    ];
    const allResultRows =
      seuItemIds.length > 0
        ? await db
            .select({
              id: energyPerformanceResultsTable.id,
              seuAssessmentItemId: energyPerformanceResultsTable.seuAssessmentItemId,
              year: energyPerformanceResultsTable.year,
              month: energyPerformanceResultsTable.month,
              eei: energyPerformanceResultsTable.eei,
              cusum: energyPerformanceResultsTable.cusum,
              status: energyPerformanceResultsTable.status,
            })
            .from(energyPerformanceResultsTable)
            .where(and(...resultConds))
            .orderBy(
              energyPerformanceResultsTable.year,
              energyPerformanceResultsTable.month,
            )
        : [];

    // ÖEK başına sonuçları grupla
    const resultsByItem = new Map<number, typeof allResultRows>();
    for (const r of allResultRows) {
      if (r.seuAssessmentItemId === null) continue;
      const arr = resultsByItem.get(r.seuAssessmentItemId) ?? [];
      arr.push(r);
      resultsByItem.set(r.seuAssessmentItemId, arr);
    }

    const MONTH_NAMES: Record<number, string> = {
      1: "Oca", 2: "Şub", 3: "Mar", 4: "Nis", 5: "May", 6: "Haz",
      7: "Tem", 8: "Ağu", 9: "Eyl", 10: "Eki", 11: "Kas", 12: "Ara",
    };

    const summary = seuItems.map((seu) => {
      const enpi = enpiMap.get(seu.id) ?? null;
      const baseline = baselineMap.get(seu.id) ?? null;
      const results = resultsByItem.get(seu.id) ?? [];
      const yearResults = results.filter((r) => r.year === year);

      let monitoringState: "not_monitored" | "baseline_without_results" | "monitored";
      if (yearResults.length > 0) {
        monitoringState = "monitored";
      } else if (baseline !== null) {
        monitoringState = "baseline_without_results";
      } else {
        monitoringState = "not_monitored";
      }

      const lastResult = yearResults.length > 0 ? yearResults[yearResults.length - 1] : null;
      const latestEei = lastResult?.eei ?? null;

      // Kümülatif CUSUM: yıl içindeki son cusum değeri
      const cumulativeCusum = lastResult?.cusum ?? null;

      const lastPeriod =
        lastResult !== null
          ? `${lastResult.year} ${MONTH_NAMES[lastResult.month] ?? lastResult.month}`
          : null;

      return {
        seuItemId: seu.id,
        seuName: seu.name,
        unitId: seu.unitId ?? null,
        unitName: seu.unitId ? (unitMap.get(seu.unitId) ?? null) : null,
        energyUseGroupName: seu.energyUseGroupId ? (eugMap.get(seu.energyUseGroupId) ?? null) : null,
        energySourceName: seu.energySourceId ? (esMap.get(seu.energySourceId) ?? null) : null,
        enpiId: enpi?.id ?? null,
        enpiName: enpi?.name ?? null,
        enpiIsActive: enpi?.isActive ?? null,
        baselineId: baseline?.id ?? null,
        baselinePeriod:
          baseline !== null
            ? `${baseline.periodStart} – ${baseline.periodEnd}`
            : null,
        regressionFormula: baseline?.formulaText ?? null,
        r2Score: baseline?.rSquared ?? null,
        adjustedR2Score: baseline?.adjustedRSquared ?? null,
        resultCount: yearResults.length,
        lastResultPeriod: lastPeriod,
        latestEei,
        cumulativeCusum,
        existingStatus: lastResult?.status ?? null,
        monitoringState,
      };
    });

    res.json(summary);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/energy-review/unit-comparison
// Sadece admin/superadmin erişebilir
// ─────────────────────────────────────────────────────────────────────────────
router.get("/energy-review/unit-comparison", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;

    const year = req.query.year
      ? parseInt(req.query.year as string)
      : new Date().getFullYear();

    // Firmaya ait birimler
    const units = await db
      .select({ id: unitsTable.id, name: unitsTable.name })
      .from(unitsTable)
      .where(
        and(
          eq(unitsTable.companyId, sessionCompanyId),
          eq(unitsTable.active, true),
        ),
      );

    if (units.length === 0) {
      res.json([]);
      return;
    }

    const today = new Date().toISOString().slice(0, 10);

    const result = await Promise.all(
      units.map(async (unit) => {
        const meterIds = await getMeterIds(unit.id, sessionCompanyId);

        // TEP & CO₂
        let totalTep = 0;
        let totalCo2Ton = 0;
        if (meterIds.length > 0) {
          const consRows = await db
            .select({
              tep: sql<number>`coalesce(sum(${consumptionTable.tep}), 0)`.as("tep"),
              co2: sql<number>`coalesce(sum(${consumptionTable.co2}), 0)`.as("co2"),
            })
            .from(consumptionTable)
            .where(buildConsumptionConds(year, meterIds));
          if (consRows[0]) {
            totalTep = consRows[0].tep ?? 0;
            totalCo2Ton = (consRows[0].co2 ?? 0) / 1000;
          }
        }

        // Kabul edilmiş ÖEK
        const seuItems = await getAcceptedSeuItems(unit.id, sessionCompanyId);
        const seuCount = seuItems.length;
        const seuItemIds = seuItems.map((s) => s.id);

        // Aktif EnPG
        const enpiRows = await db
          .select({ id: energyPerformanceIndicatorsTable.id })
          .from(energyPerformanceIndicatorsTable)
          .where(
            and(
              eq(energyPerformanceIndicatorsTable.companyId, sessionCompanyId),
              eq(energyPerformanceIndicatorsTable.unitId, unit.id),
              eq(energyPerformanceIndicatorsTable.isActive, true),
            ),
          );
        const activeEnpiCount = enpiRows.length;

        // İzlenen ÖEK
        let monitoredSeuCount = 0;
        if (seuItemIds.length > 0) {
          const monitored = await db
            .selectDistinct({ seuId: energyPerformanceResultsTable.seuAssessmentItemId })
            .from(energyPerformanceResultsTable)
            .where(
              and(
                inArray(energyPerformanceResultsTable.seuAssessmentItemId, seuItemIds),
                eq(energyPerformanceResultsTable.year, year),
              ),
            );
          monitoredSeuCount = monitored.length;
        }

        // Hedefler
        const targetRows = await db
          .select({ id: energyTargetsTable.id, baselineYear: energyTargetsTable.baselineYear, targetYear: energyTargetsTable.targetYear })
          .from(energyTargetsTable)
          .where(
            and(
              eq(energyTargetsTable.companyId, sessionCompanyId),
              eq(energyTargetsTable.unitId, unit.id),
              eq(energyTargetsTable.status, "active"),
            ),
          );
        const activeTargets = targetRows.filter(
          (t) => (t.baselineYear ?? 0) <= year && year <= (t.targetYear ?? 9999),
        );
        const activeTargetIds = activeTargets.map((t) => t.id);

        // Aksiyon planları
        let openActionsCount = 0;
        let overdueActionsCount = 0;
        if (activeTargetIds.length > 0) {
          const actionRows = await db
            .select({ status: energyActionPlansTable.status, dueDate: energyActionPlansTable.dueDate })
            .from(energyActionPlansTable)
            .where(inArray(energyActionPlansTable.targetId, activeTargetIds));
          for (const a of actionRows) {
            if (a.status !== "completed" && a.status !== "cancelled") {
              openActionsCount++;
              if (a.dueDate && a.dueDate < today) overdueActionsCount++;
            }
          }
        }

        return {
          unitId: unit.id,
          unitName: unit.name,
          totalTep: Math.round(totalTep * 1000) / 1000,
          totalCo2Ton: Math.round(totalCo2Ton * 100) / 100,
          seuCount,
          activeEnpiCount,
          monitoredSeuCount,
          unmonitoredSeuCount: Math.max(0, seuCount - monitoredSeuCount),
          openActionsCount,
          overdueActionsCount,
        };
      }),
    );

    // Toplam TEP azalana göre sırala
    result.sort((a, b) => b.totalTep - a.totalTep);

    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
