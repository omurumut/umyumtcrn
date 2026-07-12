import { Router } from "express";
import type { Request, Response } from "express";
import { db, reportsTable, consumptionTable, swotTable, risksTable, seuTable, metersTable, weatherTable, energyTargetsTable, energyActionPlansTable, energyTargetProgressTable, vapProjectsTable, unitsTable, subUnitsTable, energySourcesTable, energyBaselinesTable, energyBaselineVariablesTable, energyPerformanceResultsTable, seuAssessmentItemsTable, seuAssessmentsTable } from "@workspace/db";
import { eq, and, SQL, inArray, lte, gte, desc, asc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

class ReportScopeError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
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
  throw new ReportScopeError(400, `Geçersiz ${field}`);
}

function parseRequiredId(value: unknown, field: string): number {
  const parsed = parsePositiveInteger(value, field);
  if (parsed === undefined) throw new ReportScopeError(400, `${field} zorunludur`);
  return parsed;
}

function parseReportYear(value: unknown): number {
  const year = parseRequiredId(value, "year");
  if (year < 1900 || year > 3000) throw new ReportScopeError(400, "Geçersiz year");
  return year;
}

async function resolveReportScope(
  req: Request,
  source: Record<string, unknown>,
  requireSuperAdminCompany: boolean,
) {
  const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
  const requestedCompanyId = parsePositiveInteger(source.companyId, "companyId");
  const requestedUnitId = parsePositiveInteger(source.unitId, "unitId");

  if (!isCompanyAdmin(role) && !isSuperAdmin(role)) {
    if (sessionUnitId === null) throw new ReportScopeError(403, "Bu rapor için birim yetkisi gerekli");
    return { companyId: sessionCompanyId, unitId: sessionUnitId };
  }

  let companyId = isSuperAdmin(role) ? requestedCompanyId : sessionCompanyId;
  const unitId = requestedUnitId;

  if (unitId !== undefined) {
    const [unit] = await db.select({ companyId: unitsTable.companyId })
      .from(unitsTable).where(eq(unitsTable.id, unitId));
    if (!unit) throw new ReportScopeError(400, "Geçersiz unitId");
    if (companyId !== undefined && unit.companyId !== companyId) {
      throw new ReportScopeError(403, "Bu birim için yetkiniz yok");
    }
    if (isSuperAdmin(role) && companyId === undefined) companyId = unit.companyId;
  }

  if (isSuperAdmin(role) && requireSuperAdminCompany && companyId === undefined) {
    throw new ReportScopeError(400, "companyId zorunludur");
  }

  return { companyId, unitId: unitId ?? null };
}

function handleReportScopeError(res: Response, err: unknown) {
  if (!(err instanceof ReportScopeError)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

const MONTH_NAMES = ["", "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

// GET /api/reports
router.get("/reports", requireAuth, async (req, res) => {
  try {
    const user = req.user!;
    const queryUnitId = req.query.unitId ? parseInt(req.query.unitId as string) : undefined;

    const resolvedUnitId: number | null =
      user.role !== "admin" && user.unitId !== null
        ? user.unitId
        : (queryUnitId !== undefined ? queryUnitId : null);

    const items = resolvedUnitId !== null
      ? await db.select().from(reportsTable).where(eq(reportsTable.unitId, resolvedUnitId)).orderBy(reportsTable.createdAt)
      : await db.select().from(reportsTable).orderBy(reportsTable.createdAt);

    res.json(items.map(r => ({
      id: r.id,
      unitId: r.unitId,
      year: r.year,
      status: r.status,
      downloadUrl: r.downloadUrl,
      createdAt: r.createdAt,
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/reports/generate
router.post("/reports/generate", requireAuth, async (req, res) => {
  try {
    const { year, unitId: bodyUnitId, includeSwot, includeRisks, includeSeu, includeRegression } = req.body;
    const yr = parseReportYear(year ?? new Date().getFullYear());
    const scope = await resolveReportScope(req, { ...req.body, unitId: bodyUnitId }, true);
    if (scope.companyId === undefined) throw new ReportScopeError(400, "companyId zorunludur");
    const effectiveCompanyId = scope.companyId;
    const resolvedUnitId = scope.unitId;

    const [report] = await db.insert(reportsTable).values({
      companyId: effectiveCompanyId,
      year: yr,
      unitId: resolvedUnitId,
      status: "pending",
      includeSwot: includeSwot !== false,
      includeRisks: includeRisks !== false,
      includeSeu: includeSeu !== false,
      includeRegression: includeRegression !== false,
    }).returning();

    // consumptionTable has no unitId directly — filter via meters join
    const consumptionConditions: SQL[] = [
      eq(consumptionTable.year, yr),
      eq(consumptionTable.companyId, effectiveCompanyId),
      eq(metersTable.companyId, effectiveCompanyId),
    ];
    const meterConditions: SQL[] = [eq(metersTable.companyId, effectiveCompanyId)];
    const swotConditions: SQL[] = [eq(swotTable.companyId, effectiveCompanyId)];
    const riskConditions: SQL[] = [eq(risksTable.companyId, effectiveCompanyId)];
    const seuConditions: SQL[] = [eq(seuTable.companyId, effectiveCompanyId)];
    if (resolvedUnitId !== null) {
      consumptionConditions.push(eq(metersTable.unitId, resolvedUnitId));
      meterConditions.push(eq(metersTable.unitId, resolvedUnitId));
      swotConditions.push(eq(swotTable.unitId, resolvedUnitId));
      riskConditions.push(eq(risksTable.unitId, resolvedUnitId));
      seuConditions.push(eq(seuTable.unitId, resolvedUnitId));
    }

    const consumptionRows = await db
      .select({ id: consumptionTable.id, meterId: consumptionTable.meterId, year: consumptionTable.year, month: consumptionTable.month, kwh: consumptionTable.kwh, tep: consumptionTable.tep, co2: consumptionTable.co2, hdd: consumptionTable.hdd, cdd: consumptionTable.cdd, notes: consumptionTable.notes, createdAt: consumptionTable.createdAt })
      .from(consumptionTable)
      .innerJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
      .where(and(...consumptionConditions));
    const meters = await db.select().from(metersTable).where(and(...meterConditions));
    const swotItems = await db.select().from(swotTable).where(and(...swotConditions));
    const riskItems = await db.select().from(risksTable).where(and(...riskConditions));
    const seuItems = await db.select().from(seuTable).where(and(...seuConditions));

    const totalKwh = consumptionRows.reduce((a, r) => a + r.kwh, 0);
    const totalTep = consumptionRows.reduce((a, r) => a + r.tep, 0);
    const totalCo2 = consumptionRows.reduce((a, r) => a + r.co2, 0);

    const byMonth: Record<number, { kwh: number; tep: number; co2: number }> = {};
    for (let m = 1; m <= 12; m++) byMonth[m] = { kwh: 0, tep: 0, co2: 0 };
    for (const r of consumptionRows) {
      byMonth[r.month].kwh += r.kwh;
      byMonth[r.month].tep += r.tep;
      byMonth[r.month].co2 += r.co2;
    }

    const tableRows = Array.from({ length: 12 }, (_, i) => i + 1)
      .map(m => `<tr><td>${MONTH_NAMES[m]}</td><td>${Math.round(byMonth[m].kwh).toLocaleString("tr-TR")}</td><td>${Math.round(byMonth[m].tep * 1000) / 1000}</td><td>${Math.round(byMonth[m].co2 * 10) / 10}</td></tr>`)
      .join("\n");

    const swotHtml = includeSwot !== false && swotItems.length > 0
      ? `<h2>SWOT Analizi</h2>
         <table><tr><th>Kategori</th><th>Madde</th><th>Puan</th><th>Etki</th></tr>
         ${swotItems.map(s => `<tr><td>${s.category}</td><td>${s.title}</td><td>${s.score}/5</td><td>${s.impact}</td></tr>`).join("")}
         </table>` : "";

    const riskHtml = includeRisks !== false && riskItems.length > 0
      ? `<h2>Risk & Fırsat Analizi</h2>
         <table><tr><th>Tür</th><th>Başlık</th><th>Olasılık</th><th>Etki</th><th>Skor</th><th>Durum</th></tr>
         ${riskItems.map(r => `<tr><td>${r.type}</td><td>${r.title}</td><td>${r.probability}/5</td><td>${r.severity}/5</td><td>${r.score}</td><td>${r.status}</td></tr>`).join("")}
         </table>` : "";

    const seuHtml = includeSeu !== false && seuItems.length > 0
      ? `<h2>Önemli Enerji Kullanımları (ÖEK)</h2>
         <table><tr><th>Öncelik</th><th>Ad</th><th>Kategori</th><th>Yıllık tüketim (kWh)</th><th>Yüzde (%)</th><th>Hedef İndirim (%)</th></tr>
         ${seuItems.map(s => `<tr><td>${s.priority}</td><td>${s.name}</td><td>${s.category}</td><td>${Math.round(s.annualKwh).toLocaleString("tr-TR")}</td><td>${s.percentage}%</td><td>${s.targetReductionPercent ?? "-"}%</td></tr>`).join("")}
         </table>` : "";

    const unitLabel = resolvedUnitId !== null ? ` — Birim #${resolvedUnitId}` : "";

    const htmlContent = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>Enerji Performans Raporu ${yr}${unitLabel}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto; padding: 40px; color: #1a202c; }
    h1 { color: #0f766e; border-bottom: 3px solid #0f766e; padding-bottom: 10px; }
    h2 { color: #1e3a5f; margin-top: 30px; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    th, td { border: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; }
    th { background: #f1f5f9; font-weight: 600; }
    .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 20px 0; }
    .kpi-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; text-align: center; }
    .kpi-value { font-size: 28px; font-weight: 700; color: #0f766e; }
    .kpi-label { font-size: 12px; color: #64748b; margin-top: 4px; }
    .footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 16px; color: #64748b; font-size: 12px; }
  </style>
</head>
<body>
  <h1>Yıllık Enerji Performans Raporu — ${yr}${unitLabel}</h1>
  <p>Rapor tarihi: ${new Date().toLocaleDateString("tr-TR")} | ISO 50001 Enerji Yönetim Sistemi</p>
  
  <h2>Özet Göstergeler</h2>
  <div class="kpi-grid">
    <div class="kpi-box">
      <div class="kpi-value">${Math.round(totalKwh).toLocaleString("tr-TR")}</div>
      <div class="kpi-label">Toplam Enerji (kWh)</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-value">${(Math.round(totalTep * 1000) / 1000).toLocaleString("tr-TR")}</div>
      <div class="kpi-label">Toplam TEP</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-value">${(Math.round(totalCo2 * 10) / 10).toLocaleString("tr-TR")}</div>
      <div class="kpi-label">CO₂ Emisyonu (ton)</div>
    </div>
  </div>
  <p>Aktif Sayaç Sayısı: ${meters.length} | Toplam ÖEK: ${seuItems.length}</p>

  <h2>Aylık Enerji Tüketimi</h2>
  <table>
    <tr><th>Ay</th><th>kWh</th><th>TEP</th><th>CO₂ (ton)</th></tr>
    ${tableRows}
    <tr style="font-weight:600; background:#f1f5f9">
      <td>TOPLAM</td>
      <td>${Math.round(totalKwh).toLocaleString("tr-TR")}</td>
      <td>${(Math.round(totalTep * 1000) / 1000).toLocaleString("tr-TR")}</td>
      <td>${(Math.round(totalCo2 * 10) / 10).toLocaleString("tr-TR")}</td>
    </tr>
  </table>

  ${swotHtml}
  ${riskHtml}
  ${seuHtml}

  <div class="footer">
    Bu rapor ISO 50001 Enerji Yönetim Sistemi kapsamında otomatik olarak üretilmiştir.
  </div>
</body>
</html>`;

    const b64 = Buffer.from(htmlContent).toString("base64");
    const dataUrl = `data:text/html;base64,${b64}`;

    const [updated] = await db.update(reportsTable)
      .set({ status: "complete", downloadUrl: dataUrl })
      .where(and(eq(reportsTable.id, report.id), eq(reportsTable.companyId, effectiveCompanyId)))
      .returning();

    res.json({
      id: updated.id,
      year: updated.year,
      status: updated.status,
      downloadUrl: updated.downloadUrl,
      createdAt: updated.createdAt,
    });
  } catch (err) {
    if (handleReportScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── Label maps ──────────────────────────────────────────────────────────────
const TARGET_STATUS_LABELS: Record<string, string> = {
  active: "Aktif", completed: "Tamamlandı", cancelled: "İptal", on_hold: "Beklemede",
};
const ACTION_STATUS_LABELS: Record<string, string> = {
  planned: "Planlandı", in_progress: "Devam Ediyor", completed: "Tamamlandı",
  cancelled: "İptal", on_hold: "Beklemede",
};
const FEASIBILITY_STATUS_LABELS: Record<string, string> = {
  not_started: "Başlanmadı", in_progress: "Devam Ediyor", completed: "Tamamlandı",
  approved: "Onaylandı", rejected: "Reddedildi",
};

// GET /api/reports/energy-targets/pdf
router.get("/reports/energy-targets/pdf", requireAuth, async (req, res) => {
  try {
    const scope = await resolveReportScope(req, req.query as Record<string, unknown>, true);

    // ── Auth / scope ─────────────────────────────────────────────────────────
    const yearParam = parseReportYear(req.query.year ?? new Date().getFullYear());
    const statusParam = req.query.status as string | undefined;
    const includeVap = req.query.includeVap !== "false";
    const includeProgress = req.query.includeProgress !== "false";

    // ── Fetch targets (baselineYear <= year <= targetYear) ────────────────────
    // Auth scope mirrors targets.ts: admin → companyId filter; superadmin → no companyId filter; user → own unitId
    const targetConditions: SQL[] = [
      lte(energyTargetsTable.baselineYear, yearParam),
      gte(energyTargetsTable.targetYear, yearParam),
    ];

    const resolvedUnitId = scope.unitId;
    if (scope.companyId !== undefined) targetConditions.push(eq(energyTargetsTable.companyId, scope.companyId));
    if (resolvedUnitId !== null) targetConditions.push(eq(energyTargetsTable.unitId, resolvedUnitId));

    if (statusParam) targetConditions.push(eq(energyTargetsTable.status, statusParam));

    const targets = await db
      .select({
        id: energyTargetsTable.id,
        name: energyTargetsTable.name,
        objectiveText: energyTargetsTable.objectiveText,
        targetText: energyTargetsTable.targetText,
        unitLabel: energyTargetsTable.unitLabel,
        baselineYear: energyTargetsTable.baselineYear,
        targetYear: energyTargetsTable.targetYear,
        baselineValue: energyTargetsTable.baselineValue,
        targetValue: energyTargetsTable.targetValue,
        actualValue: energyTargetsTable.actualValue,
        targetReductionPercent: energyTargetsTable.targetReductionPercent,
        status: energyTargetsTable.status,
        unitId: energyTargetsTable.unitId,
        unitName: unitsTable.name,
      })
      .from(energyTargetsTable)
      .leftJoin(unitsTable, eq(energyTargetsTable.unitId, unitsTable.id))
      .where(and(...targetConditions))
      .orderBy(energyTargetsTable.createdAt);

    const targetIds = targets.map((t) => t.id);

    // ── Fetch action plans ────────────────────────────────────────────────────
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

    // ── Fetch latest progress per target (scoped to yearParam) ───────────────
    const progressLatestMap: Record<number, { actualValue: number; actualSavingValue: number | null; periodYear: number; periodMonth: number | null; comment: string | null }> = {};
    if (targetIds.length > 0) {
      const yearProgress = await db
        .select()
        .from(energyTargetProgressTable)
        .where(and(
          inArray(energyTargetProgressTable.targetId, targetIds),
          eq(energyTargetProgressTable.periodYear, yearParam),
          ...(scope.companyId !== undefined ? [eq(energyTargetProgressTable.companyId, scope.companyId)] : []),
        ))
        .orderBy(desc(energyTargetProgressTable.recordedAt));

      for (const p of yearProgress) {
        if (!progressLatestMap[p.targetId]) {
          progressLatestMap[p.targetId] = {
            actualValue: p.actualValue,
            actualSavingValue: p.actualSavingValue ?? null,
            periodYear: p.periodYear,
            periodMonth: p.periodMonth ?? null,
            comment: p.comment ?? null,
          };
        }
      }
    }

    // ── Fetch chronology progress rows (yearParam only) ───────────────────────
    const allProgressRows =
      includeProgress && targetIds.length > 0
        ? await db
            .select()
            .from(energyTargetProgressTable)
            .where(and(
              inArray(energyTargetProgressTable.targetId, targetIds),
              eq(energyTargetProgressTable.periodYear, yearParam),
              ...(scope.companyId !== undefined ? [eq(energyTargetProgressTable.companyId, scope.companyId)] : []),
            ))
            .orderBy(energyTargetProgressTable.targetId, energyTargetProgressTable.periodYear, energyTargetProgressTable.periodMonth)
        : [];

    // ── Fetch VAP projects via action plan join ───────────────────────────────
    const vapActionIds = actions.filter((a) => a.isVap).map((a) => a.id);
    const vapProjects =
      includeVap && vapActionIds.length > 0
        ? await db
            .select()
            .from(vapProjectsTable)
            .where(and(
              inArray(vapProjectsTable.actionPlanId, vapActionIds),
              ...(scope.companyId !== undefined ? [eq(vapProjectsTable.companyId, scope.companyId)] : []),
            ))
            .orderBy(vapProjectsTable.createdAt)
        : [];

    // ── Build unit label for header ───────────────────────────────────────────
    let unitLabel = "Tüm Birimler";
    if (resolvedUnitId !== null) {
      const unitRow = targets.find((t) => t.unitId === resolvedUnitId);
      if (unitRow?.unitName) unitLabel = unitRow.unitName;
    }

    // ── Summary stats ─────────────────────────────────────────────────────────
    const totalTargets = targets.length;
    const activeTargets = targets.filter((t) => t.status === "active").length;
    const completedTargets = targets.filter((t) => t.status === "completed").length;
    const openActions = actions.filter((a) => a.status === "planned" || a.status === "in_progress").length;
    const today = new Date();
    const overdueActions = actions.filter((a) =>
      (a.status === "planned" || a.status === "in_progress") && a.dueDate && new Date(a.dueDate) < today
    ).length;
    const vapCount = vapProjects.length;
    const totalCostSaving = vapProjects.reduce((s, v) => s + (v.annualCostSaving ?? 0), 0);
    const totalInvestment = vapProjects.reduce((s, v) => s + (v.investmentCost ?? 0), 0);

    // ── HTML helpers ──────────────────────────────────────────────────────────
    const fmtNum = (n: number | null | undefined, dec = 0) =>
      n != null ? n.toLocaleString("tr-TR", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : "—";
    const fmtDate = (d: string | null | undefined) => d ?? "—";
    const statusBadge = (s: string | null | undefined) =>
      `<span class="badge badge-${s ?? "active"}">${TARGET_STATUS_LABELS[s ?? ""] ?? s ?? "—"}</span>`;
    const actionBadge = (s: string | null | undefined) =>
      `<span class="badge badge-${s ?? "planned"}">${ACTION_STATUS_LABELS[s ?? ""] ?? s ?? "—"}</span>`;

    // ── Section: targets table ────────────────────────────────────────────────
    const targetsHtml = targets.length > 0
      ? `<table>
          <tr>
            <th>Hedef Adı</th><th>Amaç</th><th>Hedef Metni</th><th>Birim</th>
            <th>Baz Yıl</th><th>Hedef Yıl</th><th>Baz Değer</th><th>Hedef Değer</th>
            <th>Son Gerçekleşme (${yearParam})</th><th>Durum</th>
          </tr>
          ${targets.map((t) => {
            const latest = progressLatestMap[t.id];
            const actualDisplay = latest
              ? `${fmtNum(latest.actualValue, 2)} ${t.unitLabel ?? ""}`.trim()
              : "Gerçekleşme girilmedi";
            return `<tr>
              <td><strong>${t.name}</strong></td>
              <td>${t.objectiveText?.trim() || "Tanımlanmadı"}</td>
              <td>${t.targetText?.trim() || "Tanımlanmadı"}</td>
              <td>${t.unitName ?? "—"}</td>
              <td>${t.baselineYear}</td>
              <td>${t.targetYear}</td>
              <td>${fmtNum(t.baselineValue, 2)} ${t.unitLabel ?? ""}</td>
              <td>${fmtNum(t.targetValue, 2)} ${t.unitLabel ?? ""}</td>
              <td>${actualDisplay}</td>
              <td>${statusBadge(t.status)}</td>
            </tr>`;
          }).join("")}
        </table>`
      : "<p>Bu kapsam ve yıl için kayıtlı enerji hedefi bulunamadı.</p>";

    // ── Section: action plans table ───────────────────────────────────────────
    const actionsHtml = actions.length > 0
      ? `<table>
          <tr>
            <th>Bağlı Hedef</th><th>Eylem Adı</th><th>Sorumlu</th>
            <th>Başlangıç</th><th>Bitiş</th><th>Durum</th><th>İlerleme</th>
            <th>Beklenen Tasarruf</th><th>VAP mı?</th>
          </tr>
          ${actions.map((a) => {
            const targetName = targets.find((t) => t.id === a.targetId)?.name ?? "—";
            const saving = a.expectedSavingValue != null
              ? `${fmtNum(a.expectedSavingValue, 2)} ${a.expectedSavingUnit ?? ""}`
              : "—";
            return `<tr>
              <td>${targetName}</td>
              <td>${a.title}</td>
              <td>${a.responsibleName ?? "—"}</td>
              <td>${fmtDate(a.startDate)}</td>
              <td>${fmtDate(a.dueDate)}</td>
              <td>${actionBadge(a.status)}</td>
              <td>${a.progressPercent != null ? `%${a.progressPercent}` : "—"}</td>
              <td>${saving}</td>
              <td>${a.isVap ? "<strong>Evet</strong>" : "Hayır"}</td>
            </tr>`;
          }).join("")}
        </table>`
      : "<p>Bu hedeflere bağlı eylem planı bulunamadı.</p>";

    // ── Section: VAP portfolio ────────────────────────────────────────────────
    const vapHtml = includeVap
      ? vapProjects.length > 0
        ? `<h2>4. VAP Portföyü</h2>
          <table>
            <tr>
              <th>Proje Kodu</th><th>Proje Adı</th><th>Bağlı Eylem</th>
              <th>Yatırım (₺)</th><th>Yıllık Mali Tasarruf (₺)</th>
              <th>Yıllık Enerji Tasarrufu</th><th>Geri Ödeme (ay)</th><th>Fizibilite</th>
            </tr>
            ${vapProjects.map((v) => {
              const linkedAction = actions.find((a) => a.id === v.actionPlanId);
              const energySaving = v.annualEnergySavingValue != null
                ? `${fmtNum(v.annualEnergySavingValue, 2)} ${v.annualEnergySavingUnit ?? ""}`.trim()
                : "Henüz girilmedi";
              return `<tr>
                <td>${v.projectCode ?? "—"}</td>
                <td>${v.projectTitle}</td>
                <td>${linkedAction?.title ?? "—"}</td>
                <td>${fmtNum(v.investmentCost, 0)}</td>
                <td>${fmtNum(v.annualCostSaving, 0)}</td>
                <td>${energySaving}</td>
                <td>${fmtNum(v.paybackMonths, 1)}</td>
                <td>${FEASIBILITY_STATUS_LABELS[v.feasibilityStatus ?? ""] ?? v.feasibilityStatus ?? "—"}</td>
              </tr>`;
            }).join("")}
          </table>`
        : `<h2>4. VAP Portföyü</h2><p>Bu kapsamda kayıtlı VAP projesi bulunamadı.</p>`
      : "";

    // ── Section: progress chronology ──────────────────────────────────────────
    const progressHtml = includeProgress
      ? allProgressRows.length > 0
        ? `<h2>5. Gerçekleşme Kronolojisi</h2>
          <table>
            <tr>
              <th>Hedef Adı</th><th>Dönem</th><th>Gerçekleşen Değer</th><th>Tasarruf</th><th>Açıklama</th>
            </tr>
            ${allProgressRows.map((p) => {
              const targetName = targets.find((t) => t.id === p.targetId)?.name ?? "—";
              const period = p.periodMonth ? `${MONTH_NAMES[p.periodMonth]} ${p.periodYear}` : String(p.periodYear);
              return `<tr>
                <td>${targetName}</td>
                <td>${period}</td>
                <td>${fmtNum(p.actualValue, 2)}</td>
                <td>${p.actualSavingValue != null ? fmtNum(p.actualSavingValue, 2) : "—"}</td>
                <td>${p.comment ?? "—"}</td>
              </tr>`;
            }).join("")}
          </table>`
        : `<h2>5. Gerçekleşme Kronolojisi</h2><p>${yearParam} yılı için gerçekleşme kaydı bulunamadı.</p>`
      : "";

    // ── Full HTML ─────────────────────────────────────────────────────────────
    const htmlContent = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>Hedef, Eylem Planı ve VAP Yönetim Raporu — ${yearParam}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 1100px; margin: 0 auto; padding: 40px; color: #1a202c; }
    h1 { color: #0f766e; border-bottom: 3px solid #0f766e; padding-bottom: 10px; font-size: 22px; }
    h2 { color: #1e3a5f; margin-top: 36px; font-size: 16px; }
    table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 13px; }
    th, td { border: 1px solid #e2e8f0; padding: 7px 10px; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; font-weight: 600; color: #1e3a5f; }
    tr:nth-child(even) td { background: #f8fafc; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin: 18px 0; }
    .kpi-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; text-align: center; }
    .kpi-value { font-size: 26px; font-weight: 700; color: #0f766e; }
    .kpi-label { font-size: 11px; color: #64748b; margin-top: 4px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .badge-active { background: #d1fae5; color: #065f46; }
    .badge-completed { background: #dbeafe; color: #1d4ed8; }
    .badge-cancelled { background: #fee2e2; color: #991b1b; }
    .badge-on_hold { background: #fef3c7; color: #92400e; }
    .badge-planned { background: #e0f2fe; color: #0369a1; }
    .badge-in_progress { background: #fef9c3; color: #713f12; }
    .cover { margin-bottom: 32px; }
    .cover p { color: #64748b; font-size: 14px; margin: 4px 0; }
    .footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 14px; color: #94a3b8; font-size: 11px; }
  </style>
</head>
<body>

  <div class="cover">
    <h1>ISO 50001 Hedef, Eylem Planı ve VAP Yönetim Raporu</h1>
    <p><strong>Yıl:</strong> ${yearParam}</p>
    <p><strong>Birim:</strong> ${unitLabel}</p>
    <p><strong>Oluşturma Tarihi:</strong> ${new Date().toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" })}</p>
    <p style="margin-top:10px; padding:8px 12px; background:#f0fdf4; border-left:3px solid #0f766e; font-size:13px; color:#065f46;">
      Bu rapor, seçili yılda aktif olan hedefleri ve seçili yıla ait gerçekleşme kayıtlarını içerir.
    </p>
  </div>

  <h2>1. Yönetici Özeti</h2>
  <div class="kpi-grid">
    <div class="kpi-box"><div class="kpi-value">${totalTargets}</div><div class="kpi-label">Toplam Hedef</div></div>
    <div class="kpi-box"><div class="kpi-value">${activeTargets}</div><div class="kpi-label">Aktif Hedef</div></div>
    <div class="kpi-box"><div class="kpi-value">${completedTargets}</div><div class="kpi-label">Tamamlanan Hedef</div></div>
    <div class="kpi-box"><div class="kpi-value">${openActions}</div><div class="kpi-label">Açık Eylem</div></div>
    <div class="kpi-box"><div class="kpi-value">${overdueActions}</div><div class="kpi-label">Gecikmiş Eylem</div></div>
    <div class="kpi-box"><div class="kpi-value">${vapCount}</div><div class="kpi-label">VAP Sayısı</div></div>
    <div class="kpi-box"><div class="kpi-value">${fmtNum(totalCostSaving, 0)} ₺</div><div class="kpi-label">Toplam Yıllık Mali Tasarruf</div></div>
    <div class="kpi-box"><div class="kpi-value">${fmtNum(totalInvestment, 0)} ₺</div><div class="kpi-label">Toplam Yatırım</div></div>
  </div>

  <h2>2. Enerji Hedefleri Tablosu</h2>
  ${targetsHtml}

  <h2>3. Eylem Planları Tablosu</h2>
  ${actionsHtml}

  ${vapHtml}

  ${progressHtml}

  <div class="footer">
    Bu rapor ISO 50001 Enerji Yönetim Sistemi kapsamında otomatik olarak üretilmiştir.
    Referans Yıl: ${yearParam} | Birim: ${unitLabel} | Üretim: ${new Date().toLocaleString("tr-TR")}
  </div>
</body>
</html>`;

    const b64 = Buffer.from(htmlContent).toString("base64");
    const dataUrl = `data:text/html;base64,${b64}`;

    res.json({
      year: yearParam,
      unitId: resolvedUnitId,
      unitLabel,
      targetCount: totalTargets,
      actionCount: actions.length,
      vapCount,
      dataUrl,
    });
  } catch (err) {
    if (handleReportScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Rapor üretme hatası" });
  }
});

// ── GET /api/reports/energy-performance/pdf ───────────────────────────────
// EnPG İzleme PDF raporu — ham birimli (m³, kWh vb.), TEP değil
// Not: consumptionTable.kwh kolonu teknik ad olmakla birlikte gerçekte
// ham tüketim değerini (rawConsumption) temsil eder. Yeni kodlarda
// rawConsumption alias'ı tercih edilmelidir.
router.get("/reports/energy-performance/pdf", requireAuth, async (req, res) => {
  try {
    const scope = await resolveReportScope(req, req.query as Record<string, unknown>, false);
    const baselineId = parseRequiredId(req.query.baselineId, "baselineId");
    const year = parseReportYear(req.query.year ?? new Date().getFullYear());
    const baselineConditions: SQL[] = [eq(energyBaselinesTable.id, baselineId)];
    if (scope.companyId !== undefined) baselineConditions.push(eq(energyBaselinesTable.companyId, scope.companyId));
    if (scope.unitId !== null) baselineConditions.push(eq(energyBaselinesTable.unitId, scope.unitId));

    // ── Baseline + değişkenler ────────────────────────────────────────────
    const [baseline] = await db
      .select({
        id: energyBaselinesTable.id,
        baselineYear: energyBaselinesTable.baselineYear,
        periodStart: energyBaselinesTable.periodStart,
        periodEnd: energyBaselinesTable.periodEnd,
        modelType: energyBaselinesTable.modelType,
        intercept: energyBaselinesTable.intercept,
        rSquared: energyBaselinesTable.rSquared,
        adjustedRSquared: energyBaselinesTable.adjustedRSquared,
        sampleSize: energyBaselinesTable.sampleSize,
        formulaText: energyBaselinesTable.formulaText,
        isValid: energyBaselinesTable.isValid,
        status: energyBaselinesTable.status,
        // dependentVariableUnit: enerji kaynağının ham birimi (m³, kWh, vb.)
        // kwh kolonu rawConsumption anlamına gelir — baseline bu birimi saklar
        rawUnit: energyBaselinesTable.dependentVariableUnit,
        companyId: energyBaselinesTable.companyId,
        unitId: energyBaselinesTable.unitId,
        seuAssessmentItemId: energyBaselinesTable.seuAssessmentItemId,
      })
      .from(energyBaselinesTable)
      .where(and(...baselineConditions));

    if (!baseline) {
      res.status(404).json({ error: "EnRÇ bulunamadı" });
      return;
    }

    const effectiveCompanyId = baseline.companyId;

    const bvars = await db
      .select()
      .from(energyBaselineVariablesTable)
      .where(eq(energyBaselineVariablesTable.baselineId, baselineId))
      .orderBy(asc(energyBaselineVariablesTable.id));

    // ── SEU kalemi + birim bilgisi ────────────────────────────────────────
    let seuItemName = "—";
    let unitName = "—";
    let energySourceName = "—";

    if (baseline.seuAssessmentItemId) {
      const [seuRow] = await db
        .select({
          itemName: seuAssessmentItemsTable.name,
          unitName: unitsTable.name,
          energySourceName: energySourcesTable.name,
        })
        .from(seuAssessmentItemsTable)
        .innerJoin(seuAssessmentsTable, eq(seuAssessmentItemsTable.assessmentId, seuAssessmentsTable.id))
        .leftJoin(unitsTable, eq(seuAssessmentsTable.unitId, unitsTable.id))
        .leftJoin(energySourcesTable, eq(seuAssessmentItemsTable.energySourceId, energySourcesTable.id))
        .where(and(
          eq(seuAssessmentItemsTable.id, baseline.seuAssessmentItemId),
          eq(seuAssessmentsTable.companyId, effectiveCompanyId),
          ...(scope.unitId !== null ? [eq(seuAssessmentsTable.unitId, scope.unitId)] : []),
        ));

      if (seuRow) {
        seuItemName = seuRow.itemName ?? "—";
        unitName = seuRow.unitName ?? "—";
        energySourceName = seuRow.energySourceName ?? "—";
      }
    }

    // ── EnPG sonuçları ────────────────────────────────────────────────────
    // actualConsumption ve expectedConsumption rawConsumption (ham birim) cinsinden saklanır
    const results = await db
      .select()
      .from(energyPerformanceResultsTable)
      .where(and(
        eq(energyPerformanceResultsTable.baselineId, baselineId),
        eq(energyPerformanceResultsTable.year, year),
        eq(energyPerformanceResultsTable.companyId, effectiveCompanyId),
      ))
      .orderBy(asc(energyPerformanceResultsTable.month));

    // ── Ham birim etiketi ─────────────────────────────────────────────────
    // rawUnit: consumptionTable.kwh alanının gerçek birimi — TEP değil, m³/kWh/vb.
    const rawUnit = baseline.rawUnit ?? "ham tüketim";

    // ── KPI özet ─────────────────────────────────────────────────────────
    const totalActual = results.reduce((s, r) => s + (r.actualConsumption ?? 0), 0);
    const totalExpected = results.reduce((s, r) => s + (r.expectedConsumption ?? 0), 0);
    const totalDiff = totalActual - totalExpected;
    const finalCusum = results.length > 0 ? (results[results.length - 1]?.cusum ?? 0) : 0;
    // Ortalama EEI sadece expected > 0 olan aylar için (negative_expected hariç)
    const eeiRows = results.filter(r => r.eei != null && r.status !== "negative_expected");
    const avgEei = eeiRows.length > 0 ? eeiRows.reduce((s, r) => s + r.eei!, 0) / eeiRows.length : null;

    const fmtRaw = (v: number | null | undefined, dec = 2) =>
      v != null ? v.toLocaleString("tr-TR", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : "—";
    const fmtPct = (actual: number | null, expected: number | null) => {
      if (actual == null || expected == null || expected <= 0) return "—";
      const pct = ((actual - expected) / expected) * 100;
      return (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
    };

    // ── Model tipi etiketi ────────────────────────────────────────────────
    const modelLabel = baseline.modelType === "single_regression" ? "Tekli Regresyon" : "Çoklu Regresyon";

    // ── Durum etiketi ─────────────────────────────────────────────────────
    const statusLabel = (s: string | null) => {
      if (s === "improvement") return '<span style="color:#059669;font-weight:600">✓ İyileşme</span>';
      if (s === "deterioration") return '<span style="color:#dc2626;font-weight:600">✗ Kötüleşme</span>';
      if (s === "negative_expected") return '<span style="color:#d97706" title="Regresyon formülü bu ay için sıfır veya negatif beklenen tüketim üretmiştir. EEI hesaplanmaz.">⚠ Beklenen ≤ 0</span>';
      return "—";
    };

    // ── Aylık tablo satırları ─────────────────────────────────────────────
    const tableRowsHtml = results.map(r => {
      const sapmaRaw = r.difference != null ? fmtRaw(r.difference) : "—";
      const sapmaPct = fmtPct(r.actualConsumption, r.expectedConsumption);
      const rowBg = r.status === "improvement" ? "background:#f0fdf4"
        : r.status === "deterioration" ? "background:#fef2f2"
        : r.status === "negative_expected" ? "background:#fffbeb"
        : "";
      return `<tr style="${rowBg}">
        <td>${MONTH_NAMES[r.month] ?? r.month}</td>
        <td style="text-align:right">${fmtRaw(r.actualConsumption)}</td>
        <td style="text-align:right">${r.status === "negative_expected"
          ? `<span style="color:#d97706">${fmtRaw(r.expectedConsumption)}</span>`
          : fmtRaw(r.expectedConsumption)}</td>
        <td style="text-align:right;${r.difference != null && r.difference < 0 ? "color:#059669" : r.difference != null && r.difference > 0 ? "color:#dc2626" : ""}">${sapmaRaw}</td>
        <td style="text-align:right">${sapmaPct}</td>
        <td style="text-align:right">${fmtRaw(r.cusum)}</td>
        <td style="text-align:right">${r.eei != null ? r.eei.toFixed(4) : "—"}</td>
        <td style="text-align:center">${statusLabel(r.status)}</td>
      </tr>`;
    }).join("\n");

    // ── Toplam / özet satırı ──────────────────────────────────────────────
    const diffPct = totalExpected > 0
      ? ((totalDiff / totalExpected) * 100).toFixed(1)
      : null;
    const totalRowHtml = `<tr style="font-weight:700;background:#f1f5f9;border-top:2px solid #cbd5e1">
      <td>TOPLAM / ORT.</td>
      <td style="text-align:right">${fmtRaw(totalActual)}</td>
      <td style="text-align:right">${fmtRaw(totalExpected)}</td>
      <td style="text-align:right;${totalDiff < 0 ? "color:#059669" : totalDiff > 0 ? "color:#dc2626" : ""}">${fmtRaw(totalDiff)}</td>
      <td style="text-align:right">${diffPct != null ? (parseFloat(diffPct) >= 0 ? "+" : "") + diffPct + "%" : "—"}</td>
      <td style="text-align:right">${fmtRaw(finalCusum)}</td>
      <td style="text-align:right">${avgEei != null ? avgEei.toFixed(4) : "—"}</td>
      <td style="text-align:center">—</td>
    </tr>`;

    // ── Değişkenler tablosu ───────────────────────────────────────────────
    const varsHtml = bvars.length > 0
      ? `<table>
          <tr><th>Değişken</th><th>Katsayı</th><th>Std. Hata</th><th>t İstatistiği</th><th>p Değeri</th><th>Anlamlı?</th></tr>
          ${bvars.map(v => `<tr>
            <td>${v.variableName}</td>
            <td style="text-align:right">${v.coefficient?.toFixed(6) ?? "—"}</td>
            <td style="text-align:right">${v.standardError?.toFixed(6) ?? "—"}</td>
            <td style="text-align:right">${v.tStat?.toFixed(4) ?? "—"}</td>
            <td style="text-align:right">${v.pValue?.toFixed(4) ?? "—"}</td>
            <td style="text-align:center">${v.isSignificant ? "✓ Evet" : "✗ Hayır"}</td>
          </tr>`).join("")}
        </table>`
      : "";

    // ── Negatif beklenen aylar notu ───────────────────────────────────────
    const negativeMonths = results.filter(r => r.status === "negative_expected");
    const negativeNoteHtml = negativeMonths.length > 0
      ? `<div style="margin:16px 0;padding:10px 14px;background:#fffbeb;border-left:4px solid #f59e0b;border-radius:4px;font-size:12px;color:#78350f">
          <strong>Not:</strong> ${negativeMonths.map(r => MONTH_NAMES[r.month]).join(", ")} aylarında regresyon formülü sıfır veya negatif beklenen tüketim üretmiştir.
          Bu aylar EEI ve ortalama EEI hesabına dahil edilmemiştir. Durum sütununda "Beklenen ≤ 0" olarak işaretlenmiştir.
        </div>`
      : "";

    // ── Tam HTML ──────────────────────────────────────────────────────────
    const htmlContent = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>EnPG İzleme Raporu — ${seuItemName} — ${year}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 1050px; margin: 0 auto; padding: 40px; color: #1a202c; }
    h1 { color: #0f766e; border-bottom: 3px solid #0f766e; padding-bottom: 10px; font-size: 20px; }
    h2 { color: #1e3a5f; margin-top: 28px; font-size: 15px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
    th, td { border: 1px solid #e2e8f0; padding: 7px 10px; vertical-align: top; }
    th { background: #f1f5f9; font-weight: 600; color: #1e3a5f; }
    .kpi-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin: 16px 0; }
    .kpi-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; text-align: center; }
    .kpi-value { font-size: 22px; font-weight: 700; color: #0f766e; }
    .kpi-label { font-size: 11px; color: #64748b; margin-top: 3px; }
    .formula-box { background: #f0fdf4; border: 1px solid #a7f3d0; border-radius: 6px; padding: 12px 16px; margin: 12px 0; font-family: monospace; font-size: 13px; color: #065f46; }
    .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 12px 0; font-size: 12px; }
    .meta-item { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; }
    .meta-label { color: #64748b; margin-bottom: 3px; }
    .meta-value { font-weight: 600; color: #1e3a5f; }
    .footer { margin-top: 36px; border-top: 1px solid #e2e8f0; padding-top: 14px; color: #94a3b8; font-size: 11px; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>

  <h1>ISO 50001 — EnPG İzleme Raporu</h1>
  <div class="meta-grid">
    <div class="meta-item"><div class="meta-label">ÖEK Kalemi</div><div class="meta-value">${seuItemName}</div></div>
    <div class="meta-item"><div class="meta-label">Enerji Kaynağı</div><div class="meta-value">${energySourceName}</div></div>
    <div class="meta-item"><div class="meta-label">Birim</div><div class="meta-value">${unitName}</div></div>
    <div class="meta-item"><div class="meta-label">İzleme Yılı</div><div class="meta-value">${year}</div></div>
    <div class="meta-item"><div class="meta-label">Referans Yılı (EnRÇ)</div><div class="meta-value">${baseline.baselineYear}</div></div>
    <div class="meta-item"><div class="meta-label">Rapor Tarihi</div><div class="meta-value">${new Date().toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" })}</div></div>
  </div>

  <h2>Regresyon Modeli (EnRÇ Formülü)</h2>
  <div class="formula-box">${baseline.formulaText ?? "Formül kaydedilmemiş"}</div>
  <div class="meta-grid">
    <div class="meta-item"><div class="meta-label">Model Türü</div><div class="meta-value">${modelLabel}</div></div>
    <div class="meta-item"><div class="meta-label">R²</div><div class="meta-value">${baseline.rSquared?.toFixed(4) ?? "—"}</div></div>
    <div class="meta-item"><div class="meta-label">Ayarlı R²</div><div class="meta-value">${baseline.adjustedRSquared?.toFixed(4) ?? "—"}</div></div>
    <div class="meta-item"><div class="meta-label">Örnek Sayısı</div><div class="meta-value">${baseline.sampleSize ?? "—"} ay</div></div>
    <div class="meta-item"><div class="meta-label">Referans Dönemi</div><div class="meta-value">${baseline.periodStart} / ${baseline.periodEnd}</div></div>
    <div class="meta-item"><div class="meta-label">Bağımlı Değişken Birimi</div><div class="meta-value">${rawUnit}</div></div>
  </div>

  ${varsHtml ? `<h2>Model Değişkenleri</h2>${varsHtml}` : ""}

  <h2>Performans Özeti (${year})</h2>
  <div class="kpi-grid">
    <div class="kpi-box">
      <div class="kpi-value">${fmtRaw(totalActual, 0)}</div>
      <div class="kpi-label">Toplam Gerçekleşen (${rawUnit})</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-value">${fmtRaw(totalExpected, 0)}</div>
      <div class="kpi-label">Toplam Beklenen (${rawUnit})</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-value" style="color:${totalDiff < 0 ? "#059669" : "#dc2626"}">${(totalDiff >= 0 ? "+" : "") + fmtRaw(totalDiff, 0)}</div>
      <div class="kpi-label">Net Sapma (${rawUnit})</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-value" style="color:${finalCusum < 0 ? "#059669" : "#dc2626"}">${fmtRaw(finalCusum)}</div>
      <div class="kpi-label">CUSUM Son Değer (${rawUnit})</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-value" style="color:${avgEei != null && avgEei < 1 ? "#059669" : "#dc2626"}">${avgEei != null ? avgEei.toFixed(4) : "—"}</div>
      <div class="kpi-label">Ortalama EEI${negativeMonths.length > 0 ? " *" : ""}</div>
    </div>
  </div>

  ${negativeNoteHtml}

  <h2>Aylık EnPG Sonuçları (${year})</h2>
  ${results.length > 0 ? `
  <table>
    <tr>
      <th>Ay</th>
      <th style="text-align:right">Gerçekleşen (${rawUnit})</th>
      <th style="text-align:right">Beklenen (${rawUnit})</th>
      <th style="text-align:right">Sapma (${rawUnit})</th>
      <th style="text-align:right">Sapma (%)</th>
      <th style="text-align:right">CUSUM (${rawUnit})</th>
      <th style="text-align:right">EEI</th>
      <th style="text-align:center">Durum</th>
    </tr>
    ${tableRowsHtml}
    ${totalRowHtml}
  </table>` : "<p>Bu yıl için hesaplanmış EnPG sonucu bulunamadı. Önce EnPG İzleme ekranından hesaplama yapın.</p>"}

  <div class="footer">
    Bu rapor ISO 50001 Enerji Yönetim Sistemi kapsamında otomatik olarak üretilmiştir.<br>
    Bağımlı değişken birimi: <strong>${rawUnit}</strong> — TEP dönüşümü bu raporda ana metrik olarak kullanılmamıştır.<br>
    Referans EnRÇ ID: ${baselineId} | İzleme Yılı: ${year} | Üretim: ${new Date().toLocaleString("tr-TR")}
  </div>
</body>
</html>`;

    const b64 = Buffer.from(htmlContent).toString("base64");
    const dataUrl = `data:text/html;base64,${b64}`;

    res.json({ dataUrl, year, baselineId, seuItemName, rawUnit });
  } catch (err) {
    if (handleReportScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "EnPG PDF raporu üretme hatası" });
  }
});

export default router;
