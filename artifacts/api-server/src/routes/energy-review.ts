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
  energyBaselinesTable,
  energyPerformanceResultsTable,
  energyTargetsTable,
  energyActionPlansTable,
  vapProjectsTable,
} from "@workspace/db";
import { eq, and, inArray, desc, asc, SQL, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";

const router = Router();

// ── Yardımcı: yıl + sayaç bazlı tüketim koşulu ───────────────────────────────
function buildConsumptionCond(year: number, meterIds: number[]): SQL {
  if (meterIds.length === 0) return eq(consumptionTable.year, -1);
  return and(
    eq(consumptionTable.year, year),
    inArray(consumptionTable.meterId, meterIds),
  ) as SQL;
}

// ── Yardımcı: sayaç id'lerini al ─────────────────────────────────────────────
async function getMeterIds(unitId: number | null, companyId: number): Promise<number[]> {
  const conds: SQL[] = [eq(metersTable.companyId, companyId)];
  if (unitId !== null) conds.push(eq(metersTable.unitId, unitId));
  const rows = await db.select({ id: metersTable.id }).from(metersTable).where(and(...conds));
  return rows.map((r) => r.id);
}

// ── Yardımcı: Aktif EnRÇ/EnPG sayısı ─────────────────────────────────────────
// "Aktif EnPG" = energy_baselines tablosunda status='active' olan kayıtlar.
// energy_performance_indicators tablosu mevcut iş akışında kullanılmamaktadır.
async function countActiveBaselines(unitId: number | null, companyId: number): Promise<number> {
  const conds: SQL[] = [
    eq(energyBaselinesTable.companyId, companyId),
    eq(energyBaselinesTable.status, "active"),
  ];
  if (unitId !== null) {
    // Doğrudan unitId üzerinden filtrele
    // unitId null olan baseline'lar için SEU item → assessment → unit zinciri gerekir;
    // ancak mevcut veri yapısında baselines.unitId her zaman dolu geliyor.
    conds.push(eq(energyBaselinesTable.unitId, unitId));
  }
  const rows = await db
    .select({ id: energyBaselinesTable.id })
    .from(energyBaselinesTable)
    .where(and(...conds));
  return rows.length;
}

// ── Yardımcı: kabul edilmiş ÖEK kalemleri (çözülmüş birim ve enerji kaynağı ile) ──
// Fallback sırası:
//   unitId:          seuAssessmentItem.unitId → seuAssessment.unitId → energyUseGroup.unitId
//   energySourceId:  seuAssessmentItem.energySourceId → energyUseGroup.energySourceId
async function getAcceptedSeuItems(unitId: number | null, companyId: number) {
  const assessmentConds: SQL[] = [
    eq(seuAssessmentsTable.companyId, companyId),
    eq(seuAssessmentsTable.recordType, "unit_official"),
  ];
  if (unitId !== null) assessmentConds.push(eq(seuAssessmentsTable.unitId, unitId));

  const rows = await db
    .select({
      id: seuAssessmentItemsTable.id,
      name: seuAssessmentItemsTable.name,
      energyTep: seuAssessmentItemsTable.energyTep,
      // Item seviyesi (nullable)
      itemUnitId: seuAssessmentItemsTable.unitId,
      itemEnergySourceId: seuAssessmentItemsTable.energySourceId,
      energyUseGroupId: seuAssessmentItemsTable.energyUseGroupId,
      // Assessment seviyesi fallback
      assessmentUnitId: seuAssessmentsTable.unitId,
      // EUG seviyesi fallback
      eugUnitId: energyUseGroupsTable.unitId,
      eugEnergySourceId: energyUseGroupsTable.energySourceId,
      // Adlar (join'den)
      unitName: unitsTable.name,
      energySourceName: energySourcesTable.name,
      energyUseGroupName: energyUseGroupsTable.name,
    })
    .from(seuAssessmentItemsTable)
    .innerJoin(seuAssessmentsTable, eq(seuAssessmentItemsTable.assessmentId, seuAssessmentsTable.id))
    .leftJoin(energyUseGroupsTable, eq(seuAssessmentItemsTable.energyUseGroupId, energyUseGroupsTable.id))
    // unitId: item → assessment → energyUseGroup fallback
    .leftJoin(
      unitsTable,
      eq(
        unitsTable.id,
        // Drizzle sql koşulu: ilk non-null değeri kullan
        sql`COALESCE(${seuAssessmentItemsTable.unitId}, ${seuAssessmentsTable.unitId}, ${energyUseGroupsTable.unitId})`,
      ),
    )
    // energySourceId: item → energyUseGroup fallback
    .leftJoin(
      energySourcesTable,
      eq(
        energySourcesTable.id,
        sql`COALESCE(${seuAssessmentItemsTable.energySourceId}, ${energyUseGroupsTable.energySourceId})`,
      ),
    )
    .where(
      and(
        ...assessmentConds,
        eq(seuAssessmentItemsTable.userDecision, "accepted_as_seu"),
      ),
    )
    .orderBy(asc(seuAssessmentItemsTable.id));

  // Çözülmüş değerleri hesapla
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    energyTep: r.energyTep,
    energyUseGroupId: r.energyUseGroupId,
    // Çözülmüş birim: item → assessment → EUG
    resolvedUnitId: r.itemUnitId ?? r.assessmentUnitId ?? r.eugUnitId ?? null,
    unitName: r.unitName ?? null,
    // Çözülmüş enerji kaynağı: item → EUG
    resolvedEnergySourceId: r.itemEnergySourceId ?? r.eugEnergySourceId ?? null,
    energySourceName: r.energySourceName ?? null,
    energyUseGroupName: r.energyUseGroupName ?? null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/energy-review/overview
// ─────────────────────────────────────────────────────────────────────────────
router.get("/energy-review/overview", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;

    const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();

    const effectiveUnitId: number | null =
      role === "admin" || role === "superadmin"
        ? req.query.unitId ? parseInt(req.query.unitId as string) : null
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
        .where(buildConsumptionCond(year, meterIds));
      if (consRows[0]) {
        totalTep = consRows[0].tep ?? 0;
        totalCo2Ton = (consRows[0].co2 ?? 0) / 1000;
      }
    }

    // Kabul edilmiş ÖEK sayısı
    const seuItems = await getAcceptedSeuItems(effectiveUnitId, sessionCompanyId);
    const seuCount = seuItems.length;
    const seuItemIds = seuItems.map((s) => s.id);

    // Aktif EnPG sayısı = aktif EnRÇ (baseline status='active') sayısı
    const activeEnpiCount = await countActiveBaselines(effectiveUnitId, sessionCompanyId);

    // İzlenen ÖEK: o yıl için EnPG sonucu olan ÖEK sayısı
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
    const unmonitoredSeuCount = Math.max(0, seuCount - monitoredSeuCount);

    // Aktif hedef sayısı
    const targetConds: SQL[] = [
      eq(energyTargetsTable.companyId, sessionCompanyId),
      eq(energyTargetsTable.status, "active"),
    ];
    if (effectiveUnitId !== null) targetConds.push(eq(energyTargetsTable.unitId, effectiveUnitId));

    const targetRows = await db
      .select({ id: energyTargetsTable.id, baselineYear: energyTargetsTable.baselineYear, targetYear: energyTargetsTable.targetYear })
      .from(energyTargetsTable)
      .where(and(...targetConds));

    const activeTargets = targetRows.filter(
      (t) => (t.baselineYear ?? 0) <= year && year <= (t.targetYear ?? 9999),
    );
    const targetsCount = activeTargets.length;
    const activeTargetIds = activeTargets.map((t) => t.id);

    // Açık & Gecikmiş aksiyon
    let openActionsCount = 0;
    let overdueActionsCount = 0;
    if (activeTargetIds.length > 0) {
      const actionRows = await db
        .select({ status: energyActionPlansTable.status, dueDate: energyActionPlansTable.dueDate })
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
// ─────────────────────────────────────────────────────────────────────────────
router.get("/energy-review/source-breakdown", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;

    const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
    const effectiveUnitId: number | null =
      role === "admin" || role === "superadmin"
        ? req.query.unitId ? parseInt(req.query.unitId as string) : null
        : sessionUnitId;

    const meterIds = await getMeterIds(effectiveUnitId, sessionCompanyId);
    if (meterIds.length === 0) {
      res.json([]);
      return;
    }

    const rows = await db
      .select({
        energySourceId: metersTable.energySourceId,
        rawConsumption: sql<number>`coalesce(sum(${consumptionTable.kwh}), 0)`.as("raw_consumption"),
        tep: sql<number>`coalesce(sum(${consumptionTable.tep}), 0)`.as("tep"),
        co2Kg: sql<number>`coalesce(sum(${consumptionTable.co2}), 0)`.as("co2_kg"),
      })
      .from(consumptionTable)
      .leftJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
      .where(buildConsumptionCond(year, meterIds))
      .groupBy(metersTable.energySourceId);

    if (rows.length === 0) {
      res.json([]);
      return;
    }

    const sourceIds = rows.map((r) => r.energySourceId).filter((id): id is number => id !== null);
    const sources = sourceIds.length > 0
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
        const tepSharePercent = totalTep > 0 ? Math.round((tep / totalTep) * 10000) / 100 : 0;
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
// GET /api/energy-review/source-comparison
// Seçili yıl ile bir önceki yılı enerji kaynağı bazında karşılaştırır.
// Farklı doğal birimler birbiriyle toplanmaz; yüzde değişimi yalnızca aynı
// energySourceId içinde hesaplanır.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/energy-review/source-comparison", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;

    const selectedYear = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
    const previousYear = selectedYear - 1;

    // Standart kullanıcıda session unitId'yi kullan; query parametresine güvenme.
    const effectiveUnitId: number | null =
      role === "admin" || role === "superadmin"
        ? req.query.unitId ? parseInt(req.query.unitId as string) : null
        : sessionUnitId;

    const meterIds = await getMeterIds(effectiveUnitId, sessionCompanyId);
    if (meterIds.length === 0) {
      res.json([]);
      return;
    }

    // Her iki yıl için sayaç bazlı tüketim sorgula
    const [selectedRows, previousRows] = await Promise.all([
      db
        .select({
          energySourceId: metersTable.energySourceId,
          rawConsumption: sql<number>`coalesce(sum(${consumptionTable.kwh}), 0)`.as("raw_consumption"),
          tep: sql<number>`coalesce(sum(${consumptionTable.tep}), 0)`.as("tep"),
          co2Kg: sql<number>`coalesce(sum(${consumptionTable.co2}), 0)`.as("co2_kg"),
        })
        .from(consumptionTable)
        .leftJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
        .where(buildConsumptionCond(selectedYear, meterIds))
        .groupBy(metersTable.energySourceId),
      db
        .select({
          energySourceId: metersTable.energySourceId,
          rawConsumption: sql<number>`coalesce(sum(${consumptionTable.kwh}), 0)`.as("raw_consumption"),
          tep: sql<number>`coalesce(sum(${consumptionTable.tep}), 0)`.as("tep"),
          co2Kg: sql<number>`coalesce(sum(${consumptionTable.co2}), 0)`.as("co2_kg"),
        })
        .from(consumptionTable)
        .leftJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
        .where(buildConsumptionCond(previousYear, meterIds))
        .groupBy(metersTable.energySourceId),
    ]);

    // Her iki yılda görünen tüm kaynak id'lerini birleştir (union)
    const allSourceIds = Array.from(
      new Set([
        ...selectedRows.map((r) => r.energySourceId),
        ...previousRows.map((r) => r.energySourceId),
      ].filter((id): id is number => id !== null)),
    );

    if (allSourceIds.length === 0) {
      res.json([]);
      return;
    }

    const sources = await db
      .select({ id: energySourcesTable.id, name: energySourcesTable.name, unit: energySourcesTable.unit })
      .from(energySourcesTable)
      .where(inArray(energySourcesTable.id, allSourceIds));
    const sourceMap = new Map(sources.map((s) => [s.id, s]));

    const selectedMap = new Map(
      selectedRows
        .filter((r): r is typeof r & { energySourceId: number } => r.energySourceId !== null)
        .map((r) => [r.energySourceId, r]),
    );
    const previousMap = new Map(
      previousRows
        .filter((r): r is typeof r & { energySourceId: number } => r.energySourceId !== null)
        .map((r) => [r.energySourceId, r]),
    );

    // Sıfıra bölmeden güvenli yüzde değişimi. Önceki yıl 0 veya veri yoksa null döner.
    function pctChange(curr: number, prev: number): number | null {
      if (prev === 0) return null;
      return Math.round(((curr - prev) / prev) * 10000) / 100;
    }

    const result = allSourceIds
      .map((sourceId) => {
        const source = sourceMap.get(sourceId);
        const sel = selectedMap.get(sourceId);
        const prev = previousMap.get(sourceId);

        const selRaw = sel?.rawConsumption ?? 0;
        const prevRaw = prev?.rawConsumption ?? 0;
        const selTep = sel?.tep ?? 0;
        const prevTep = prev?.tep ?? 0;
        // CO₂ kg → ton dönüşümü burada yapılır
        const selCo2Ton = (sel?.co2Kg ?? 0) / 1000;
        const prevCo2Ton = (prev?.co2Kg ?? 0) / 1000;

        return {
          energySourceId: sourceId,
          energySourceName: source?.name ?? "Bilinmeyen Kaynak",
          unitOfMeasure: source?.unit ?? "-",
          selectedYearRawConsumption: Math.round(selRaw * 1000) / 1000,
          previousYearRawConsumption: Math.round(prevRaw * 1000) / 1000,
          rawConsumptionChangePercent: pctChange(selRaw, prevRaw),
          selectedYearTep: Math.round(selTep * 1000) / 1000,
          previousYearTep: Math.round(prevTep * 1000) / 1000,
          tepChangePercent: pctChange(selTep, prevTep),
          selectedYearCo2Ton: Math.round(selCo2Ton * 100) / 100,
          previousYearCo2Ton: Math.round(prevCo2Ton * 100) / 100,
          co2ChangePercent: pctChange(selCo2Ton, prevCo2Ton),
        };
      })
      .sort((a, b) => b.selectedYearTep - a.selectedYearTep);

    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/energy-review/enpi-summary
// ─────────────────────────────────────────────────────────────────────────────
router.get("/energy-review/enpi-summary", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;

    const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
    const effectiveUnitId: number | null =
      role === "admin" || role === "superadmin"
        ? req.query.unitId ? parseInt(req.query.unitId as string) : null
        : sessionUnitId;

    // Kabul edilmiş ÖEK kalemleri (çözülmüş birim + enerji kaynağı ile)
    const seuItems = await getAcceptedSeuItems(effectiveUnitId, sessionCompanyId);
    if (seuItems.length === 0) {
      res.json([]);
      return;
    }

    const seuItemIds = seuItems.map((s) => s.id);

    // Her ÖEK için aktif baseline (EnRÇ): status='active' olanı al
    // Birden fazla baseline varsa status=active olanı, yoksa son kaydı kullan
    const allBaselines = await db
      .select({
        id: energyBaselinesTable.id,
        seuAssessmentItemId: energyBaselinesTable.seuAssessmentItemId,
        unitId: energyBaselinesTable.unitId,
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
      .orderBy(asc(energyBaselinesTable.id));

    // Her ÖEK için önce status='active' olan baseline'ı, yoksa son olanı seç
    const baselineMap = new Map<number, typeof allBaselines[0]>();
    for (const b of allBaselines) {
      if (b.seuAssessmentItemId === null) continue;
      const existing = baselineMap.get(b.seuAssessmentItemId);
      if (!existing) {
        baselineMap.set(b.seuAssessmentItemId, b);
      } else if (b.status === "active" && existing.status !== "active") {
        // Aktif olanı tercih et
        baselineMap.set(b.seuAssessmentItemId, b);
      }
    }

    // EnPG sonuçları: sadece aktif baseline'a ait kayıtları getir (izleme durumu tespiti)
    // Aktif baseline ID listesi — yalnızca bu baseline'lara ait sonuçlar kullanılır.
    // Bu filtre, eski/arşiv baseline'lara ait artık kayıtların lastResult seçimini
    // kirletmesini ve EEI/CUSUM ile expected/actual alanlarının farklı kayıtlardan
    // gelmesini önler.
    const activeBaselineIds = Array.from(baselineMap.values()).map((b) => b.id);

    const allResults = seuItemIds.length > 0 && activeBaselineIds.length > 0
      ? await db
          .select({
            id: energyPerformanceResultsTable.id,
            seuAssessmentItemId: energyPerformanceResultsTable.seuAssessmentItemId,
            baselineId: energyPerformanceResultsTable.baselineId,
            year: energyPerformanceResultsTable.year,
            month: energyPerformanceResultsTable.month,
            eei: energyPerformanceResultsTable.eei,
            cusum: energyPerformanceResultsTable.cusum,
            status: energyPerformanceResultsTable.status,
            setValue: energyPerformanceResultsTable.setValue,
            expectedConsumption: energyPerformanceResultsTable.expectedConsumption,
            actualConsumption: energyPerformanceResultsTable.actualConsumption,
            difference: energyPerformanceResultsTable.difference,
          })
          .from(energyPerformanceResultsTable)
          .where(
            and(
              eq(energyPerformanceResultsTable.companyId, sessionCompanyId),
              inArray(energyPerformanceResultsTable.seuAssessmentItemId, seuItemIds),
              inArray(energyPerformanceResultsTable.baselineId, activeBaselineIds),
            ),
          )
          .orderBy(
            asc(energyPerformanceResultsTable.seuAssessmentItemId),
            asc(energyPerformanceResultsTable.year),
            asc(energyPerformanceResultsTable.month),
          )
      : [];

    // ÖEK başına sonuçları grupla
    const resultsByItem = new Map<number, typeof allResults>();
    for (const r of allResults) {
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
      const baseline = baselineMap.get(seu.id) ?? null;
      const allItemResults = resultsByItem.get(seu.id) ?? [];
      const yearResults = allItemResults.filter((r) => r.year === year);

      // Veri ilişkisi durumu
      let dataRelationState: "complete" | "missing_unit" | "missing_energy_source" | "missing_energy_use_group" | "missing_baseline_link" | "missing_result_link";
      if (seu.resolvedUnitId === null) {
        dataRelationState = "missing_unit";
      } else if (seu.resolvedEnergySourceId === null) {
        dataRelationState = "missing_energy_source";
      } else if (seu.energyUseGroupId === null) {
        dataRelationState = "missing_energy_use_group";
      } else if (baseline === null) {
        dataRelationState = "missing_baseline_link";
      } else if (yearResults.length === 0) {
        dataRelationState = "missing_result_link";
      } else {
        dataRelationState = "complete";
      }

      // İzleme durumu
      let monitoringState: "not_monitored" | "baseline_without_results" | "monitored" | "missing_relation";
      if (dataRelationState === "missing_unit" || dataRelationState === "missing_energy_source" || dataRelationState === "missing_energy_use_group") {
        monitoringState = "missing_relation";
      } else if (yearResults.length > 0) {
        monitoringState = "monitored";
      } else if (baseline !== null) {
        monitoringState = "baseline_without_results";
      } else {
        monitoringState = "not_monitored";
      }

      const lastResult = yearResults.length > 0 ? yearResults[yearResults.length - 1] : null;
      const lastPeriod = lastResult !== null
        ? `${lastResult.year} ${MONTH_NAMES[lastResult.month] ?? lastResult.month}`
        : null;

      // ── Yıllık özet (EnergyPerformance "Toplam / Ort." satırıyla aynı kural) ──
      // totalActual / totalExpected: tüm aylar toplanır, null → 0
      // annualEei: yalnızca eei != null olan ayların ortalaması (beklenen ≤ 0 olan aylar hariç)
      // periodEndCusum: son kaydın cusum değeri — toplamı değil
      // latestSet: son geçerli (null olmayan) setValue değeri
      let annualActualConsumption: number | null = null;
      let annualExpectedConsumption: number | null = null;
      let annualVariance: number | null = null;
      let annualVariancePercent: number | null = null;
      let annualEei: number | null = null;

      if (yearResults.length > 0) {
        annualActualConsumption = yearResults.reduce(
          (s, r) => s + (r.actualConsumption != null ? Number(r.actualConsumption) : 0), 0,
        );
        annualExpectedConsumption = yearResults.reduce(
          (s, r) => s + (r.expectedConsumption != null ? Number(r.expectedConsumption) : 0), 0,
        );
        annualVariance = annualActualConsumption - annualExpectedConsumption;
        annualVariancePercent = annualExpectedConsumption !== 0
          ? Math.round((annualVariance / annualExpectedConsumption) * 10000) / 100
          : null;
        const eeiRows = yearResults.filter((r) => r.eei != null);
        annualEei = eeiRows.length > 0
          ? eeiRows.reduce((s, r) => s + Number(r.eei!), 0) / eeiRows.length
          : null;
      }

      // Dönem sonu CUSUM = son kaydın cusum değeri (kümülatif — toplamı değil)
      const periodEndCusum = lastResult?.cusum ?? null;
      // Son geçerli SET (null olmayan son ay)
      const latestSet = [...yearResults].reverse().find((r) => r.setValue != null)?.setValue ?? null;

      // Geriye dönük uyumluluk için son aya ait alanlar (frontend artık bunları kullanmıyor)
      const latestEei = lastResult?.eei ?? null;
      const cumulativeCusum = lastResult?.cusum ?? null;
      const latestExpectedConsumption = lastResult?.expectedConsumption ?? null;
      const latestActualConsumption = lastResult?.actualConsumption ?? null;
      const dbDifference = lastResult?.difference ?? null;
      const latestVariance = dbDifference !== null
        ? Math.round(dbDifference * 1000) / 1000
        : (latestActualConsumption !== null && latestExpectedConsumption !== null)
          ? Math.round((latestActualConsumption - latestExpectedConsumption) * 1000) / 1000
          : null;
      const latestVariancePercent = (latestExpectedConsumption !== null && latestExpectedConsumption !== 0 && latestVariance !== null)
        ? Math.round((latestVariance / latestExpectedConsumption) * 10000) / 100
        : null;

      return {
        seuItemId: seu.id,
        seuName: seu.name,
        unitId: seu.resolvedUnitId,
        unitName: seu.unitName,
        energyUseGroupName: seu.energyUseGroupName,
        energySourceName: seu.energySourceName,
        // EnPG = aktif baseline tabanlı (energy_performance_indicators tablosu kullanılmıyor)
        baselineId: baseline?.id ?? null,
        baselineStatus: baseline?.status ?? null,
        baselinePeriod: baseline !== null
          ? `${baseline.periodStart} – ${baseline.periodEnd}`
          : null,
        regressionFormula: baseline?.formulaText ?? null,
        r2Score: baseline?.rSquared ?? null,
        adjustedR2Score: baseline?.adjustedRSquared ?? null,
        resultCount: yearResults.length,
        lastResultYear: lastResult?.year ?? null,
        lastResultMonth: lastResult?.month ?? null,
        lastResultPeriod: lastPeriod,
        // Yıllık özet alanları (EnergyPerformance "Toplam / Ort." kuralı)
        annualResultCount: yearResults.length,
        annualActualConsumption,
        annualExpectedConsumption,
        annualVariance,
        annualVariancePercent,
        annualEei,
        periodEndCusum,
        latestSet,
        // Geriye dönük uyumluluk (artık frontend kullanmıyor)
        latestEei,
        cumulativeCusum,
        latestExpectedConsumption,
        latestActualConsumption,
        latestVariance,
        latestVariancePercent,
        existingStatus: lastResult?.status ?? null,
        monitoringState,
        dataRelationState,
      };
    });

    res.json(summary);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/energy-review/unit-comparison   (sadece admin/superadmin)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/energy-review/unit-comparison", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { companyId: sessionCompanyId } = req.user!;

    const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();

    const units = await db
      .select({ id: unitsTable.id, name: unitsTable.name })
      .from(unitsTable)
      .where(and(eq(unitsTable.companyId, sessionCompanyId), eq(unitsTable.active, true)));

    if (units.length === 0) {
      res.json([]);
      return;
    }

    const today = new Date().toISOString().slice(0, 10);

    const result = await Promise.all(
      units.map(async (unit) => {
        const meterIds = await getMeterIds(unit.id, sessionCompanyId);

        let totalTep = 0;
        let totalCo2Ton = 0;
        if (meterIds.length > 0) {
          const consRows = await db
            .select({
              tep: sql<number>`coalesce(sum(${consumptionTable.tep}), 0)`.as("tep"),
              co2: sql<number>`coalesce(sum(${consumptionTable.co2}), 0)`.as("co2"),
            })
            .from(consumptionTable)
            .where(buildConsumptionCond(year, meterIds));
          if (consRows[0]) {
            totalTep = consRows[0].tep ?? 0;
            totalCo2Ton = (consRows[0].co2 ?? 0) / 1000;
          }
        }

        const seuItems = await getAcceptedSeuItems(unit.id, sessionCompanyId);
        const seuCount = seuItems.length;
        const seuItemIds = seuItems.map((s) => s.id);

        // Aktif EnPG = aktif baseline sayısı
        const activeEnpiCount = await countActiveBaselines(unit.id, sessionCompanyId);

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

    result.sort((a, b) => b.totalTep - a.totalTep);
    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
