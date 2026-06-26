import { Router } from "express";
import { db, energyTargetsTable, consumptionTable, metersTable, energyActionPlansTable, unitsTable, subUnitsTable, energySourcesTable, seuAssessmentsTable } from "@workspace/db";
import { eq, and, SQL, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import {
  buildCsv, sendCsvResponse,
  TARGET_STATUS_LABELS, TARGET_TYPE_LABELS, ACTION_STATUS_LABELS, PRIORITY_LABELS,
} from "../lib/csv-export.js";
import { buildXlsx, sendXlsxResponse, type XlsxColDef } from "../lib/xlsx-export.js";

const router = Router();

async function calcProgress(unitId: number | null, baselineYear: number, targetYear: number) {
  const currentYear = new Date().getFullYear();
  const endYear = Math.min(targetYear, currentYear);
  const years: number[] = [];
  for (let y = baselineYear; y <= endYear; y++) years.push(y);
  if (years.length === 0) return { baselineKwh: null, yearlyProgress: [] };

  const meterRows = unitId
    ? await db.select({ id: metersTable.id }).from(metersTable).where(eq(metersTable.unitId, unitId))
    : await db.select({ id: metersTable.id }).from(metersTable);

  if (meterRows.length === 0) return { baselineKwh: null, yearlyProgress: [] };
  const meterIds = meterRows.map((m) => m.id);

  const rows = await db
    .select({
      year: consumptionTable.year,
      totalKwh: sql<number>`sum(${consumptionTable.kwh})`.as("total_kwh"),
    })
    .from(consumptionTable)
    .where(and(inArray(consumptionTable.meterId, meterIds), inArray(consumptionTable.year, years)))
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
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;

    // ── Yetki ve filtre koşulları ──────────────────────────────
    // Non-admin kullanıcıların mutlaka bir birime atanmış olması gerekir
    if (role !== "admin" && role !== "superadmin" && sessionUnitId === null) {
      res.status(403).json({ error: "Export için birim yetkisi gerekli" });
      return;
    }

    const conditions: SQL[] = [eq(energyTargetsTable.companyId, sessionCompanyId)];

    if (role !== "admin" && role !== "superadmin") {
      // Non-admin: sadece kendi birimi (null kontrolü yukarıda yapıldı)
      conditions.push(eq(energyTargetsTable.unitId, sessionUnitId!));
    } else if (role === "admin") {
      const unitIdParam = req.query.unitId ? parseInt(req.query.unitId as string) : undefined;
      if (unitIdParam !== undefined && !isNaN(unitIdParam)) {
        conditions.push(eq(energyTargetsTable.unitId, unitIdParam));
      }
    }
    // superadmin: şirket filtresi yeterli

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
      .where(and(...conditions))
      .orderBy(energyTargetsTable.createdAt);

    // ── Eylem planlarını çek ────────────────────────────────────
    const targetIds = targets.map((t) => t.id);
    const actions =
      targetIds.length > 0
        ? await db
            .select()
            .from(energyActionPlansTable)
            .where(inArray(energyActionPlansTable.targetId, targetIds))
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

    // ── CSV çıktısı ───────────────────────────────────────────
    const HEADERS = [
      { key: "yil", label: "Yıl" },
      { key: "birim", label: "Birim" },
      { key: "altBirim", label: "Alt Birim" },
      { key: "enerjiKaynagi", label: "Enerji Kaynağı" },
      { key: "ilgiliOek", label: "İlgili ÖEK" },
      { key: "enerjiAmaci", label: "Enerji Amacı" },
      { key: "enerjiHedfi", label: "Enerji Hedefi" },
      { key: "hedefTipi", label: "Hedef Tipi" },
      { key: "bazYil", label: "Baz Yıl" },
      { key: "bazDeger", label: "Baz Değer" },
      { key: "hedefYil", label: "Hedef Yıl" },
      { key: "hedefDeger", label: "Hedef Değer" },
      { key: "gerceklesen", label: "Gerçekleşen Değer" },
      { key: "olcuBirimi", label: "Ölçü Birimi" },
      { key: "hedefAzaltimOrani", label: "Hedef Azaltım Oranı (%)" },
      { key: "hedefDurumu", label: "Hedef Durumu" },
      { key: "eylemPlani", label: "Eylem Planı" },
      { key: "sorumlu", label: "Sorumlu" },
      { key: "baslangicTarihi", label: "Başlangıç Tarihi" },
      { key: "bitisTarihi", label: "Bitiş Tarihi" },
      { key: "oncelik", label: "Öncelik" },
      { key: "beklenenTasarruf", label: "Beklenen Tasarruf" },
      { key: "beklenenMaliTasarruf", label: "Beklenen Yıllık Mali Tasarruf" },
      { key: "yatirimMaliyeti", label: "Yatırım Maliyeti" },
      { key: "geriOdemeSuresi", label: "Geri Ödeme Süresi (ay)" },
      { key: "eylemDurumu", label: "Eylem Durumu" },
      { key: "ilerleme", label: "İlerleme" },
      { key: "vapMi", label: "VAP mı?" },
      { key: "notlar", label: "Notlar" },
    ];

    const filename = yearParam
      ? `enerji-amac-hedef-eylem-plani-${yearParam}.csv`
      : "enerji-amac-hedef-eylem-plani.csv";

    const csv = buildCsv(HEADERS, rows);
    sendCsvResponse(res, filename, csv);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "CSV export hatası" });
  }
});

// GET /api/targets
router.get("/targets", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const conditions: SQL[] = [];

    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null) {
      conditions.push(eq(energyTargetsTable.unitId, sessionUnitId));
    } else if (role === "admin") {
      conditions.push(eq(energyTargetsTable.companyId, sessionCompanyId));
      const unitId = req.query.unitId ? parseInt(req.query.unitId as string) : undefined;
      if (unitId !== undefined) conditions.push(eq(energyTargetsTable.unitId, unitId));
    } else {
      const unitId = req.query.unitId ? parseInt(req.query.unitId as string) : undefined;
      if (unitId !== undefined) conditions.push(eq(energyTargetsTable.unitId, unitId));
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : undefined;
      if (companyId !== undefined) conditions.push(eq(energyTargetsTable.companyId, companyId));
    }

    const targets = conditions.length > 0
      ? await db.select().from(energyTargetsTable).where(conditions.length === 1 ? conditions[0] : and(...conditions)).orderBy(energyTargetsTable.createdAt)
      : await db.select().from(energyTargetsTable).orderBy(energyTargetsTable.createdAt);

    const result = await Promise.all(
      targets.map(async (t) => {
        const progress = await calcProgress(t.unitId, t.baselineYear, t.targetYear);
        return { ...t, ...progress };
      })
    );
    res.json(result);
  } catch (err) {
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
    const resolvedUnitId = role !== "admin" && role !== "superadmin" && sessionUnitId !== null
      ? sessionUnitId
      : unitId ? parseInt(unitId) : null;
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
      subUnitId: subUnitId ? parseInt(subUnitId) : null,
      energySourceId: energySourceId ? parseInt(energySourceId) : null,
      seuAssessmentId: seuAssessmentId ? parseInt(seuAssessmentId) : null,
    }).returning();
    res.status(201).json(item);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PATCH /api/targets/:id
router.patch("/targets/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(energyTargetsTable).where(eq(energyTargetsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Bulunamadı" }); return; }
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null && existing.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    if (role === "admin" && existing.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Bu kaydı düzenleme yetkiniz yok" }); return;
    }
    const {
      name, baselineYear, targetYear, targetReductionPercent, notes, unitId,
      objectiveText, targetText, targetType, baselineValue, targetValue, actualValue,
      unitLabel, status, subUnitId, energySourceId, seuAssessmentId,
    } = req.body;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (baselineYear !== undefined) updates.baselineYear = parseInt(baselineYear);
    if (targetYear !== undefined) updates.targetYear = parseInt(targetYear);
    if (targetReductionPercent !== undefined) updates.targetReductionPercent = parseFloat(targetReductionPercent);
    if (notes !== undefined) updates.notes = notes || null;
    if ((role === "admin" || role === "superadmin") && unitId !== undefined) updates.unitId = unitId ? parseInt(unitId) : null;
    if (objectiveText !== undefined) updates.objectiveText = objectiveText || null;
    if (targetText !== undefined) updates.targetText = targetText || null;
    if (targetType !== undefined) updates.targetType = targetType || null;
    if (baselineValue !== undefined) updates.baselineValue = baselineValue !== "" && baselineValue != null ? parseFloat(baselineValue) : null;
    if (targetValue !== undefined) updates.targetValue = targetValue !== "" && targetValue != null ? parseFloat(targetValue) : null;
    if (actualValue !== undefined) updates.actualValue = actualValue !== "" && actualValue != null ? parseFloat(actualValue) : null;
    if (unitLabel !== undefined) updates.unitLabel = unitLabel || null;
    if (status !== undefined) updates.status = status || null;
    if (subUnitId !== undefined) updates.subUnitId = subUnitId ? parseInt(subUnitId) : null;
    if (energySourceId !== undefined) updates.energySourceId = energySourceId ? parseInt(energySourceId) : null;
    if (seuAssessmentId !== undefined) updates.seuAssessmentId = seuAssessmentId ? parseInt(seuAssessmentId) : null;
    const [item] = await db.update(energyTargetsTable).set(updates).where(eq(energyTargetsTable.id, id)).returning();
    res.json(item);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/targets/:id
router.delete("/targets/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(energyTargetsTable).where(eq(energyTargetsTable.id, id));
    if (!existing) { res.status(404).send(); return; }
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null && existing.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    if (role === "admin" && existing.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Bu kaydı silme yetkiniz yok" }); return;
    }
    await db.delete(energyTargetsTable).where(eq(energyTargetsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
