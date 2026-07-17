import { Router } from "express";
import type { Response } from "express";
import { db, companiesTable, vapProjectsTable, energyActionPlansTable, energyTargetsTable, energySourcesTable, unitsTable, subUnitsTable } from "@workspace/db";
import { eq, and, SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import { changedAuditFields, writeAuditEvent } from "../lib/audit.js";
import {
  buildCsv, sendCsvResponse,
  VAP_STATUS_LABELS, FEASIBILITY_STATUS_LABELS, INCENTIVE_STATUS_LABELS,
} from "../lib/csv-export.js";
import { buildXlsx, sendXlsxResponse, type XlsxColDef } from "../lib/xlsx-export.js";

const router = Router();

class BadRequestError extends Error {}

const VAP_STATUSES = new Set(["idea", "feasibility", "planned", "active", "in_progress", "completed", "cancelled"]);
const FEASIBILITY_STATUSES = new Set(["not_started", "pre_feasibility", "detailed_feasibility", "approved", "rejected"]);
const INCENTIVE_STATUSES = new Set(["none", "evaluating", "application_prepared", "applied", "approved", "rejected"]);
const MAX_REAL = 3.4028235e38;

function isCompanyAdmin(role: string) { return role === "admin" || role === "kontrol_admin"; }
function isSuperAdmin(role: string) { return role === "superadmin"; }
function isStandard(role: string) { return !isCompanyAdmin(role) && !isSuperAdmin(role); }
function parsePositiveInteger(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value.trim())) {
    const parsed = Number(value.trim()); if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function parseExportFormat(value: unknown): "csv" | "xlsx" {
  if (value === undefined) return "csv";
  if (value === "csv" || value === "xlsx") return value;
  throw new BadRequestError("Geçersiz format");
}

function requiredString(value: unknown, field: string, maxLength = 255): string {
  if (typeof value !== "string") throw new BadRequestError(`Geçersiz ${field}`);
  const parsed = value.trim();
  if (!parsed || parsed.length > maxLength) throw new BadRequestError(`Geçersiz ${field}`);
  return parsed;
}

function optionalString(value: unknown, field: string, maxLength?: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new BadRequestError(`Geçersiz ${field}`);
  const parsed = value.trim();
  if (maxLength !== undefined && parsed.length > maxLength) throw new BadRequestError(`Geçersiz ${field}`);
  return parsed || null;
}

function optionalFinite(value: unknown, field: string, min = 0, max = MAX_REAL): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  let parsed: number;
  if (typeof value === "number") parsed = value;
  else if (typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) parsed = Number(value.trim());
  else throw new BadRequestError(`Geçersiz ${field}`);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > MAX_REAL || parsed < min || parsed > max) throw new BadRequestError(`Geçersiz ${field}`);
  return parsed;
}

function calculatePaybackMonths(investmentCost: number | null, annualCostSaving: number | null): number | null {
  if (investmentCost === null || annualCostSaving === null || annualCostSaving === 0) return null;
  const paybackMonths = (investmentCost / annualCostSaving) * 12;
  if (!Number.isFinite(paybackMonths) || paybackMonths > MAX_REAL) {
    throw new BadRequestError("Geri ödeme süresi hesaplanamadı");
  }
  return Number(paybackMonths.toFixed(1));
}

function enumValue(value: unknown, field: string, allowed: Set<string>, fallback?: string): string {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) return fallback;
  if (typeof value !== "string" || !allowed.has(value)) throw new BadRequestError(`Geçersiz ${field}`);
  return value;
}

function optionalIsoDate(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestError(`Geçersiz ${field}`);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) throw new BadRequestError(`Geçersiz ${field}`);
  return value;
}

function handleBadRequest(res: Response, err: unknown) {
  if (!(err instanceof BadRequestError)) return false;
  res.status(400).json({ error: err.message });
  return true;
}

async function resolveEffectiveCompanyId(role: string, sessionCompanyId: number, value: unknown, requireExplicit: boolean) {
  if (!isSuperAdmin(role)) return sessionCompanyId;
  if (value === undefined && !requireExplicit) return sessionCompanyId;
  const companyId = parsePositiveInteger(value);
  if (companyId === undefined) return undefined;
  const [company] = await db.select({ id: companiesTable.id }).from(companiesTable).where(eq(companiesTable.id, companyId));
  return company?.id;
}

async function getScopedActionPlan(actionPlanId: number, companyId: number, standardUnitId?: number) {
  const conditions = [eq(energyActionPlansTable.id, actionPlanId), eq(energyActionPlansTable.companyId, companyId), eq(energyTargetsTable.companyId, companyId)];
  if (standardUnitId !== undefined) conditions.push(eq(energyTargetsTable.unitId, standardUnitId));
  const [row] = await db.select({
    id: energyActionPlansTable.id,
    isVap: energyActionPlansTable.isVap,
    targetId: energyActionPlansTable.targetId,
    targetUnitId: energyTargetsTable.unitId,
  }).from(energyActionPlansTable)
    .innerJoin(energyTargetsTable, eq(energyActionPlansTable.targetId, energyTargetsTable.id))
    .where(and(...conditions));
  return row;
}

// GET /api/vap-projects/export
router.get("/vap-projects/export", requireAuth, async (req, res) => {
  try {
    const format = parseExportFormat(req.query.format);
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;

    // Non-admin kullanıcıların mutlaka bir birime atanmış olması gerekir
    if (isStandard(role) && sessionUnitId === null) {
      res.status(403).json({ error: "Export için birim yetkisi gerekli" });
      return;
    }

    const yearParam = parsePositiveInteger(req.query.year);
    if (req.query.year !== undefined && yearParam === undefined) { res.status(400).json({ error: "Geçersiz year" }); return; }
    const statusParam = req.query.status as string | undefined;
    const companyIdParam = parsePositiveInteger(req.query.companyId);
    if (req.query.companyId !== undefined && companyIdParam === undefined) { res.status(400).json({ error: "Geçersiz companyId" }); return; }
    const unitIdParam = parsePositiveInteger(req.query.unitId);
    if (req.query.unitId !== undefined && unitIdParam === undefined) { res.status(400).json({ error: "Geçersiz unitId" }); return; }

    const effectiveCompanyId = await resolveEffectiveCompanyId(role, sessionCompanyId, companyIdParam, false);
    if (effectiveCompanyId === undefined) { res.status(400).json({ error: "Geçersiz companyId" }); return; }

    let effectiveUnitId: number | undefined;
    if (unitIdParam !== undefined) {
      const [unit] = await db.select({ companyId: unitsTable.companyId })
        .from(unitsTable)
        .where(eq(unitsTable.id, unitIdParam));
      if (!unit) { res.status(400).json({ error: "Geçersiz unitId" }); return; }
      if (unit.companyId !== effectiveCompanyId) { res.status(403).json({ error: "Yetki yok" }); return; }
      if (isStandard(role) && unitIdParam !== sessionUnitId) { res.status(403).json({ error: "Yetki yok" }); return; }
      effectiveUnitId = unitIdParam;
    } else if (isStandard(role)) {
      effectiveUnitId = sessionUnitId!;
    }

    const conditions: SQL[] = [
      eq(vapProjectsTable.companyId, effectiveCompanyId),
      eq(energyActionPlansTable.companyId, effectiveCompanyId),
      eq(energyTargetsTable.companyId, effectiveCompanyId),
    ];
    if (effectiveUnitId !== undefined) conditions.push(eq(energyTargetsTable.unitId, effectiveUnitId));

    const rows = await db
      .select({
        id: vapProjectsTable.id,
        projectCode: vapProjectsTable.projectCode,
        projectTitle: vapProjectsTable.projectTitle,
        projectType: vapProjectsTable.projectType,
        currentSituation: vapProjectsTable.currentSituation,
        proposedSolution: vapProjectsTable.proposedSolution,
        technicalDescription: vapProjectsTable.technicalDescription,
        annualEnergySavingValue: vapProjectsTable.annualEnergySavingValue,
        annualEnergySavingUnit: vapProjectsTable.annualEnergySavingUnit,
        annualCostSaving: vapProjectsTable.annualCostSaving,
        investmentCost: vapProjectsTable.investmentCost,
        paybackMonths: vapProjectsTable.paybackMonths,
        co2ReductionTon: vapProjectsTable.co2ReductionTon,
        feasibilityStatus: vapProjectsTable.feasibilityStatus,
        incentiveStatus: vapProjectsTable.incentiveStatus,
        startDate: vapProjectsTable.startDate,
        endDate: vapProjectsTable.endDate,
        status: vapProjectsTable.status,
        notes: vapProjectsTable.notes,
        // Action plan
        actionPlanTitle: energyActionPlansTable.title,
        actionPlanStatus: energyActionPlansTable.status,
        actionPlanIsVap: energyActionPlansTable.isVap,
        // Target
        targetName: energyTargetsTable.name,
        targetUnitId: energyTargetsTable.unitId,
        targetSubUnitId: energyTargetsTable.subUnitId,
        targetEnergySourceId: energyTargetsTable.energySourceId,
        targetYear: energyTargetsTable.targetYear,
        // Lookups
        unitName: unitsTable.name,
        subUnitName: subUnitsTable.name,
        energySourceName: energySourcesTable.name,
      })
      .from(vapProjectsTable)
      .leftJoin(energyActionPlansTable, eq(vapProjectsTable.actionPlanId, energyActionPlansTable.id))
      .leftJoin(energyTargetsTable, eq(energyActionPlansTable.targetId, energyTargetsTable.id))
      .leftJoin(unitsTable, eq(energyTargetsTable.unitId, unitsTable.id))
      .leftJoin(subUnitsTable, eq(energyTargetsTable.subUnitId, subUnitsTable.id))
      .leftJoin(energySourcesTable, eq(energyTargetsTable.energySourceId, energySourcesTable.id))
      .where(and(...conditions))
      .orderBy(vapProjectsTable.createdAt);

    // ── Yetki filtresi ─────────────────────────────────────────
    let filtered = rows.filter((r) => r.actionPlanIsVap === true);

    // ── Query filtreler ────────────────────────────────────────
    if (statusParam) {
      filtered = filtered.filter((r) => r.status === statusParam);
    }
    if (yearParam !== undefined && !isNaN(yearParam)) {
      filtered = filtered.filter((r) => r.targetYear === yearParam);
    }

    // ── CSV satırları ─────────────────────────────────────────
    const csvRows = filtered.map((p) => ({
      projeKodu: p.projectCode ?? "",
      vapAdi: p.projectTitle ?? "",
      bagliHedef: p.targetName ?? "",
      bagliEylemPlani: p.actionPlanTitle ?? "",
      birim: p.unitName ?? "",
      altBirim: p.subUnitName ?? "",
      enerjiKaynagi: p.energySourceName ?? "",
      projeTuru: p.projectType ?? "",
      mevcutDurum: p.currentSituation ?? "",
      onerilenCozum: p.proposedSolution ?? "",
      teknikAciklama: p.technicalDescription ?? "",
      yillikEnerjiTasarrufu: p.annualEnergySavingValue,
      yillikEnerjiTasarrufuBirimi: p.annualEnergySavingUnit ?? "",
      yillikMaliTasarruf: p.annualCostSaving,
      yatirimMaliyeti: p.investmentCost,
      geriOdemeSuresi: p.paybackMonths,
      co2Azaltimi: p.co2ReductionTon,
      fizibilite: FEASIBILITY_STATUS_LABELS[p.feasibilityStatus ?? ""] ?? p.feasibilityStatus ?? "",
      tesvikDestek: INCENTIVE_STATUS_LABELS[p.incentiveStatus ?? ""] ?? p.incentiveStatus ?? "",
      baslangicTarihi: p.startDate ?? "",
      bitisTarihi: p.endDate ?? "",
      projeDurumu: VAP_STATUS_LABELS[p.status ?? ""] ?? p.status ?? "",
      notlar: p.notes ?? "",
    }));

    const HEADERS: import("../lib/xlsx-export.js").XlsxColDef[] = [
      { key: "projeKodu", label: "Proje Kodu" },
      { key: "vapAdi", label: "VAP Adı", width: 35, wrapText: true },
      { key: "bagliHedef", label: "Bağlı Hedef", width: 30, wrapText: true },
      { key: "bagliEylemPlani", label: "Bağlı Eylem Planı", width: 30, wrapText: true },
      { key: "birim", label: "Birim" },
      { key: "altBirim", label: "Alt Birim" },
      { key: "enerjiKaynagi", label: "Enerji Kaynağı" },
      { key: "projeTuru", label: "Proje Türü" },
      { key: "mevcutDurum", label: "Mevcut Durum", width: 35, wrapText: true },
      { key: "onerilenCozum", label: "Önerilen Çözüm", width: 35, wrapText: true },
      { key: "teknikAciklama", label: "Teknik Açıklama", width: 35, wrapText: true },
      { key: "yillikEnerjiTasarrufu", label: "Yıllık Enerji Tasarrufu", type: "number" },
      { key: "yillikEnerjiTasarrufuBirimi", label: "Yıllık Enerji Tasarrufu Birimi" },
      { key: "yillikMaliTasarruf", label: "Yıllık Mali Tasarruf", type: "number" },
      { key: "yatirimMaliyeti", label: "Yatırım Maliyeti", type: "number" },
      { key: "geriOdemeSuresi", label: "Geri Ödeme Süresi (ay)", type: "number" },
      { key: "co2Azaltimi", label: "CO2 Azaltımı (ton)", type: "number" },
      { key: "fizibilite", label: "Fizibilite Durumu" },
      { key: "tesvikDestek", label: "Teşvik/Destek Durumu" },
      { key: "baslangicTarihi", label: "Başlangıç Tarihi", type: "date" },
      { key: "bitisTarihi", label: "Bitiş Tarihi", type: "date" },
      { key: "projeDurumu", label: "Proje Durumu" },
      { key: "notlar", label: "Notlar", width: 35, wrapText: true },
    ];

    if (format === "xlsx") {
      const baseName = yearParam && !isNaN(yearParam)
        ? `vap-projeleri-${yearParam}.xlsx`
        : "vap-projeleri.xlsx";
      const buf = await buildXlsx("VAP Projeleri", HEADERS, csvRows);
      sendXlsxResponse(res, baseName, buf);
    } else {
      const filename = yearParam && !isNaN(yearParam)
        ? `vap-projeleri-${yearParam}.csv`
        : "vap-projeleri.csv";
      const csv = buildCsv(HEADERS, csvRows);
      sendCsvResponse(res, filename, csv);
    }
  } catch (err) {
    if (handleBadRequest(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "VAP export hatası" });
  }
});

// GET /api/vap-projects
router.get("/vap-projects", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    if (isStandard(role) && sessionUnitId === null) { res.json([]); return; }
    const effectiveCompanyId = await resolveEffectiveCompanyId(role, sessionCompanyId, req.query.companyId, false);
    if (effectiveCompanyId === undefined) { res.status(400).json({ error: "Geçersiz companyId" }); return; }

    const rows = await db
      .select({
        id: vapProjectsTable.id,
        companyId: vapProjectsTable.companyId,
        actionPlanId: vapProjectsTable.actionPlanId,
        projectCode: vapProjectsTable.projectCode,
        projectTitle: vapProjectsTable.projectTitle,
        projectType: vapProjectsTable.projectType,
        currentSituation: vapProjectsTable.currentSituation,
        proposedSolution: vapProjectsTable.proposedSolution,
        technicalDescription: vapProjectsTable.technicalDescription,
        annualEnergySavingValue: vapProjectsTable.annualEnergySavingValue,
        annualEnergySavingUnit: vapProjectsTable.annualEnergySavingUnit,
        annualCostSaving: vapProjectsTable.annualCostSaving,
        investmentCost: vapProjectsTable.investmentCost,
        paybackMonths: vapProjectsTable.paybackMonths,
        co2ReductionTon: vapProjectsTable.co2ReductionTon,
        measurementVerificationMethod: vapProjectsTable.measurementVerificationMethod,
        incentiveStatus: vapProjectsTable.incentiveStatus,
        feasibilityStatus: vapProjectsTable.feasibilityStatus,
        startDate: vapProjectsTable.startDate,
        endDate: vapProjectsTable.endDate,
        status: vapProjectsTable.status,
        notes: vapProjectsTable.notes,
        createdBy: vapProjectsTable.createdBy,
        createdAt: vapProjectsTable.createdAt,
        updatedAt: vapProjectsTable.updatedAt,
        actionPlanTitle: energyActionPlansTable.title,
        actionPlanStatus: energyActionPlansTable.status,
        targetId: energyActionPlansTable.targetId,
        targetName: energyTargetsTable.name,
        targetUnitId: energyTargetsTable.unitId,
        targetEnergySourceId: energyTargetsTable.energySourceId,
      })
      .from(vapProjectsTable)
      .leftJoin(energyActionPlansTable, eq(vapProjectsTable.actionPlanId, energyActionPlansTable.id))
      .leftJoin(energyTargetsTable, eq(energyActionPlansTable.targetId, energyTargetsTable.id))
      .where(and(
        eq(vapProjectsTable.companyId, effectiveCompanyId),
        eq(energyActionPlansTable.companyId, effectiveCompanyId),
        eq(energyTargetsTable.companyId, effectiveCompanyId),
      ))
      .orderBy(vapProjectsTable.createdAt);

    const filtered =
      isStandard(role) && sessionUnitId !== null
        ? rows.filter((r) => r.targetUnitId === sessionUnitId)
        : rows;

    res.json(filtered);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/vap-projects
router.post("/vap-projects", requireAuth, async (req, res) => {
  try {
    const { companyId: sessionCompanyId, unitId: sessionUnitId, role, name: userName } = req.user!;
    const { actionPlanId, projectCode, projectTitle, projectType, currentSituation, proposedSolution,
      technicalDescription, annualEnergySavingValue, annualEnergySavingUnit, annualCostSaving,
      investmentCost, paybackMonths, co2ReductionTon, measurementVerificationMethod,
      incentiveStatus, feasibilityStatus, startDate, endDate, status, notes } = req.body;

    if (actionPlanId === undefined || projectTitle === undefined) {
      res.status(400).json({ error: "Eylem planı ve proje başlığı zorunludur" }); return;
    }
    const parsedProjectTitle = requiredString(projectTitle, "projectTitle");
    const parsedProjectCode = optionalString(projectCode, "projectCode", 255);
    const parsedProjectType = optionalString(projectType, "projectType");
    const parsedCurrentSituation = optionalString(currentSituation, "currentSituation");
    const parsedProposedSolution = optionalString(proposedSolution, "proposedSolution");
    const parsedTechnicalDescription = optionalString(technicalDescription, "technicalDescription");
    const parsedAnnualEnergySavingValue = optionalFinite(annualEnergySavingValue, "annualEnergySavingValue");
    const parsedAnnualEnergySavingUnit = optionalString(annualEnergySavingUnit, "annualEnergySavingUnit");
    const parsedAnnualCostSaving = optionalFinite(annualCostSaving, "annualCostSaving");
    const parsedInvestmentCost = optionalFinite(investmentCost, "investmentCost");
    // Legacy clients may still send paybackMonths. Validate it for compatibility,
    // but the stored value is always calculated from authoritative financial inputs.
    optionalFinite(paybackMonths, "paybackMonths");
    const parsedCo2ReductionTon = optionalFinite(co2ReductionTon, "co2ReductionTon");
    const parsedMeasurementMethod = optionalString(measurementVerificationMethod, "measurementVerificationMethod");
    const parsedIncentiveStatus = enumValue(incentiveStatus, "incentiveStatus", INCENTIVE_STATUSES, "none");
    const parsedFeasibilityStatus = enumValue(feasibilityStatus, "feasibilityStatus", FEASIBILITY_STATUSES, "not_started");
    const parsedStartDate = optionalIsoDate(startDate, "startDate");
    const parsedEndDate = optionalIsoDate(endDate, "endDate");
    if (parsedStartDate && parsedEndDate && parsedEndDate < parsedStartDate) throw new BadRequestError("Bitiş tarihi başlangıç tarihinden önce olamaz");
    const parsedStatus = enumValue(status, "status", VAP_STATUSES, "idea");
    const parsedNotes = optionalString(notes, "notes");
    const calculatedPaybackMonths = calculatePaybackMonths(
      parsedInvestmentCost ?? null,
      parsedAnnualCostSaving ?? null,
    );
    if (isStandard(role) && sessionUnitId === null) { res.status(403).json({ error: "Yetki yok" }); return; }
    const effectiveCompanyId = await resolveEffectiveCompanyId(role, sessionCompanyId, req.body.companyId, true);
    if (effectiveCompanyId === undefined) { res.status(400).json({ error: "Geçersiz companyId" }); return; }
    const parsedActionPlanId = parsePositiveInteger(actionPlanId);
    if (parsedActionPlanId === undefined) { res.status(400).json({ error: "Geçersiz actionPlanId" }); return; }

    const ap = await getScopedActionPlan(parsedActionPlanId, effectiveCompanyId, isStandard(role) ? sessionUnitId! : undefined);
    if (!ap) {
      res.status(403).json({ error: "Geçersiz eylem planı" }); return;
    }
    if (!ap.isVap) {
      res.status(400).json({ error: "Eylem planı VAP olarak işaretlenmemiş" }); return;
    }
    // Duplicate VAP kontrolü — aynı action_plan_id için tek VAP olabilir
    const [dupVap] = await db.select({ id: vapProjectsTable.id })
      .from(vapProjectsTable)
      .where(and(eq(vapProjectsTable.actionPlanId, parsedActionPlanId), eq(vapProjectsTable.companyId, effectiveCompanyId)));
    if (dupVap) {
      res.status(409).json({ error: "Bu eylem planına zaten bir VAP projesi bağlı" }); return;
    }

    const item = await db.transaction(async (tx) => {
      const [created] = await tx.insert(vapProjectsTable).values({
        companyId: effectiveCompanyId,
        actionPlanId: parsedActionPlanId,
        projectCode: parsedProjectCode ?? null,
        projectTitle: parsedProjectTitle,
        projectType: parsedProjectType ?? null,
        currentSituation: parsedCurrentSituation ?? null,
        proposedSolution: parsedProposedSolution ?? null,
        technicalDescription: parsedTechnicalDescription ?? null,
        annualEnergySavingValue: parsedAnnualEnergySavingValue ?? null,
        annualEnergySavingUnit: parsedAnnualEnergySavingUnit ?? null,
        annualCostSaving: parsedAnnualCostSaving ?? null,
        investmentCost: parsedInvestmentCost ?? null,
        paybackMonths: calculatedPaybackMonths,
        co2ReductionTon: parsedCo2ReductionTon ?? null,
        measurementVerificationMethod: parsedMeasurementMethod ?? null,
        incentiveStatus: parsedIncentiveStatus,
        feasibilityStatus: parsedFeasibilityStatus,
        startDate: parsedStartDate ?? null,
        endDate: parsedEndDate ?? null,
        status: parsedStatus,
        notes: parsedNotes ?? null,
        createdBy: userName,
      }).returning();
      await writeAuditEvent(tx, {
        request: req,
        companyId: created.companyId,
        unitId: ap.targetUnitId,
        action: "vap.create",
        entityType: "vap_project",
        entityId: created.id,
        changes: { created: { actionPlanId: created.actionPlanId, status: created.status, paybackMonths: created.paybackMonths } },
      });
      return created;
    });
    res.status(201).json(item);
  } catch (err) {
    if (handleBadRequest(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PUT /api/vap-projects/:id
router.put("/vap-projects/:id", requireAuth, async (req, res) => {
  try {
    const { companyId: sessionCompanyId, role, unitId: sessionUnitId } = req.user!;
    if (isStandard(role) && sessionUnitId === null) { res.status(403).json({ error: "Yetki yok" }); return; }
    const id = parsePositiveInteger(req.params.id);
    if (id === undefined) { res.status(400).json({ error: "Geçersiz vapProjectId" }); return; }
    const effectiveCompanyId = await resolveEffectiveCompanyId(role, sessionCompanyId, req.body.companyId, true);
    if (effectiveCompanyId === undefined) { res.status(400).json({ error: "Geçersiz companyId" }); return; }
    const recordConditions = [eq(vapProjectsTable.id, id), eq(vapProjectsTable.companyId, effectiveCompanyId)];
    const [existing] = await db.select().from(vapProjectsTable).where(and(...recordConditions));
    if (!existing) { res.status(404).json({ error: "Bulunamadı" }); return; }
    if (existing.companyId !== effectiveCompanyId) { res.status(403).json({ error: "Yetki yok" }); return; }

    // Birim yetki kontrolü: non-admin sadece kendi birimi kapsamındaki VAP'ı güncelleyebilir
    const ap = await getScopedActionPlan(existing.actionPlanId, effectiveCompanyId, isStandard(role) ? sessionUnitId! : undefined);
    if (!ap) { res.status(403).json({ error: "Yetki yok" }); return; }

    const { projectCode, projectTitle, projectType, currentSituation, proposedSolution,
      technicalDescription, annualEnergySavingValue, annualEnergySavingUnit, annualCostSaving,
      investmentCost, paybackMonths, co2ReductionTon, measurementVerificationMethod,
      incentiveStatus, feasibilityStatus, startDate, endDate, status, notes } = req.body;
    const parsedProjectTitle = projectTitle !== undefined ? requiredString(projectTitle, "projectTitle") : undefined;
    const parsedProjectCode = projectCode !== undefined ? optionalString(projectCode, "projectCode", 255) : undefined;
    const parsedProjectType = projectType !== undefined ? optionalString(projectType, "projectType") : undefined;
    const parsedCurrentSituation = currentSituation !== undefined ? optionalString(currentSituation, "currentSituation") : undefined;
    const parsedProposedSolution = proposedSolution !== undefined ? optionalString(proposedSolution, "proposedSolution") : undefined;
    const parsedTechnicalDescription = technicalDescription !== undefined ? optionalString(technicalDescription, "technicalDescription") : undefined;
    const parsedAnnualEnergySavingValue = annualEnergySavingValue !== undefined ? optionalFinite(annualEnergySavingValue, "annualEnergySavingValue") : undefined;
    const parsedAnnualEnergySavingUnit = annualEnergySavingUnit !== undefined ? optionalString(annualEnergySavingUnit, "annualEnergySavingUnit") : undefined;
    const parsedAnnualCostSaving = annualCostSaving !== undefined ? optionalFinite(annualCostSaving, "annualCostSaving") : undefined;
    const parsedInvestmentCost = investmentCost !== undefined ? optionalFinite(investmentCost, "investmentCost") : undefined;
    if (paybackMonths !== undefined) optionalFinite(paybackMonths, "paybackMonths");
    const parsedCo2ReductionTon = co2ReductionTon !== undefined ? optionalFinite(co2ReductionTon, "co2ReductionTon") : undefined;
    const parsedMeasurementMethod = measurementVerificationMethod !== undefined ? optionalString(measurementVerificationMethod, "measurementVerificationMethod") : undefined;
    const parsedIncentiveStatus = incentiveStatus !== undefined ? enumValue(incentiveStatus, "incentiveStatus", INCENTIVE_STATUSES) : undefined;
    const parsedFeasibilityStatus = feasibilityStatus !== undefined ? enumValue(feasibilityStatus, "feasibilityStatus", FEASIBILITY_STATUSES) : undefined;
    const parsedStartDate = startDate !== undefined ? optionalIsoDate(startDate, "startDate") : undefined;
    const parsedEndDate = endDate !== undefined ? optionalIsoDate(endDate, "endDate") : undefined;
    const finalStartDate = parsedStartDate !== undefined ? parsedStartDate : existing.startDate;
    const finalEndDate = parsedEndDate !== undefined ? parsedEndDate : existing.endDate;
    if (finalStartDate && finalEndDate && finalEndDate < finalStartDate) throw new BadRequestError("Bitiş tarihi başlangıç tarihinden önce olamaz");
    const parsedStatus = status !== undefined ? enumValue(status, "status", VAP_STATUSES) : undefined;
    const parsedNotes = notes !== undefined ? optionalString(notes, "notes") : undefined;
    const effectiveInvestmentCost = parsedInvestmentCost !== undefined ? parsedInvestmentCost : existing.investmentCost;
    const effectiveAnnualCostSaving = parsedAnnualCostSaving !== undefined ? parsedAnnualCostSaving : existing.annualCostSaving;
    const calculatedPaybackMonths = calculatePaybackMonths(effectiveInvestmentCost, effectiveAnnualCostSaving);

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsedProjectCode !== undefined) updates.projectCode = parsedProjectCode;
    if (parsedProjectTitle !== undefined) updates.projectTitle = parsedProjectTitle;
    if (parsedProjectType !== undefined) updates.projectType = parsedProjectType;
    if (parsedCurrentSituation !== undefined) updates.currentSituation = parsedCurrentSituation;
    if (parsedProposedSolution !== undefined) updates.proposedSolution = parsedProposedSolution;
    if (parsedTechnicalDescription !== undefined) updates.technicalDescription = parsedTechnicalDescription;
    if (parsedAnnualEnergySavingValue !== undefined) updates.annualEnergySavingValue = parsedAnnualEnergySavingValue;
    if (parsedAnnualEnergySavingUnit !== undefined) updates.annualEnergySavingUnit = parsedAnnualEnergySavingUnit;
    if (parsedAnnualCostSaving !== undefined) updates.annualCostSaving = parsedAnnualCostSaving;
    if (parsedInvestmentCost !== undefined) updates.investmentCost = parsedInvestmentCost;
    updates.paybackMonths = calculatedPaybackMonths;
    if (parsedCo2ReductionTon !== undefined) updates.co2ReductionTon = parsedCo2ReductionTon;
    if (parsedMeasurementMethod !== undefined) updates.measurementVerificationMethod = parsedMeasurementMethod;
    if (parsedIncentiveStatus !== undefined) updates.incentiveStatus = parsedIncentiveStatus;
    if (parsedFeasibilityStatus !== undefined) updates.feasibilityStatus = parsedFeasibilityStatus;
    if (parsedStartDate !== undefined) updates.startDate = parsedStartDate;
    if (parsedEndDate !== undefined) updates.endDate = parsedEndDate;
    if (parsedStatus !== undefined) updates.status = parsedStatus;
    if (parsedNotes !== undefined) updates.notes = parsedNotes;

    recordConditions.push(eq(vapProjectsTable.actionPlanId, existing.actionPlanId));
    const item = await db.transaction(async (tx) => {
      const [updated] = await tx.update(vapProjectsTable).set(updates).where(and(...recordConditions)).returning();
      if (!updated) return null;
      await writeAuditEvent(tx, {
        request: req,
        companyId: updated.companyId,
        unitId: ap.targetUnitId,
        action: "vap.update",
        entityType: "vap_project",
        entityId: updated.id,
        changes: changedAuditFields(existing as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>, [
          "projectCode", "projectTitle", "annualEnergySavingValue", "annualCostSaving", "investmentCost", "paybackMonths", "co2ReductionTon", "incentiveStatus", "feasibilityStatus", "status",
        ]),
      });
      return updated;
    });
    if (!item) { res.status(404).json({ error: "Bulunamadı" }); return; }
    res.json(item);
  } catch (err) {
    if (handleBadRequest(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/vap-projects/:id
router.delete("/vap-projects/:id", requireAuth, async (req, res) => {
  try {
    const { companyId: sessionCompanyId, role, unitId: sessionUnitId } = req.user!;
    if (isStandard(role) && sessionUnitId === null) { res.status(403).json({ error: "Yetki yok" }); return; }
    const id = parsePositiveInteger(req.params.id);
    if (id === undefined) { res.status(400).json({ error: "Geçersiz vapProjectId" }); return; }
    const recordConditions = [eq(vapProjectsTable.id, id), eq(vapProjectsTable.companyId, sessionCompanyId)];
    const [existing] = await db.select().from(vapProjectsTable).where(and(...recordConditions));
    if (!existing) { res.status(404).send(); return; }
    if (existing.companyId !== sessionCompanyId) { res.status(403).json({ error: "Yetki yok" }); return; }

    // Birim yetki kontrolü: non-admin sadece kendi birimi kapsamındaki VAP'ı silebilir
    const ap = await getScopedActionPlan(existing.actionPlanId, sessionCompanyId, isStandard(role) ? sessionUnitId! : undefined);
    if (!ap) { res.status(403).json({ error: "Yetki yok" }); return; }

    recordConditions.push(eq(vapProjectsTable.actionPlanId, existing.actionPlanId));
    await db.transaction(async (tx) => {
      await writeAuditEvent(tx, {
        request: req,
        companyId: existing.companyId,
        unitId: ap.targetUnitId,
        action: "vap.delete",
        entityType: "vap_project",
        entityId: existing.id,
        changes: { deleted: { actionPlanId: existing.actionPlanId, status: existing.status } },
      });
      await tx.delete(vapProjectsTable).where(and(...recordConditions));
    });
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
