import { Router } from "express";
import { db, reportsTable, consumptionTable, swotTable, risksTable, seuTable, metersTable, weatherTable, energyTargetsTable, energyActionPlansTable, energyTargetProgressTable, vapProjectsTable, unitsTable, subUnitsTable, energySourcesTable } from "@workspace/db";
import { eq, and, SQL, inArray, lte, gte, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

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
    const yr = parseInt(year) || new Date().getFullYear();

    const user = req.user!;
    const resolvedUnitId: number | null =
      user.role !== "admin" && user.unitId !== null
        ? user.unitId
        : (bodyUnitId !== undefined && bodyUnitId !== null ? parseInt(bodyUnitId) : null);

    const [report] = await db.insert(reportsTable).values({
      year: yr,
      unitId: resolvedUnitId,
      status: "pending",
      includeSwot: includeSwot !== false,
      includeRisks: includeRisks !== false,
      includeSeu: includeSeu !== false,
      includeRegression: includeRegression !== false,
    }).returning();

    // consumptionTable has no unitId directly — filter via meters join
    const consumptionRows = resolvedUnitId !== null
      ? await db
          .select({ id: consumptionTable.id, meterId: consumptionTable.meterId, year: consumptionTable.year, month: consumptionTable.month, kwh: consumptionTable.kwh, tep: consumptionTable.tep, co2: consumptionTable.co2, hdd: consumptionTable.hdd, cdd: consumptionTable.cdd, notes: consumptionTable.notes, createdAt: consumptionTable.createdAt })
          .from(consumptionTable)
          .innerJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
          .where(and(eq(consumptionTable.year, yr), eq(metersTable.unitId, resolvedUnitId)))
      : await db.select().from(consumptionTable).where(eq(consumptionTable.year, yr));
    const meters = resolvedUnitId !== null
      ? await db.select().from(metersTable).where(eq(metersTable.unitId, resolvedUnitId))
      : await db.select().from(metersTable);

    const swotItems = resolvedUnitId !== null
      ? await db.select().from(swotTable).where(eq(swotTable.unitId, resolvedUnitId))
      : await db.select().from(swotTable);

    const riskItems = resolvedUnitId !== null
      ? await db.select().from(risksTable).where(eq(risksTable.unitId, resolvedUnitId))
      : await db.select().from(risksTable);

    const seuItems = resolvedUnitId !== null
      ? await db.select().from(seuTable).where(eq(seuTable.unitId, resolvedUnitId))
      : await db.select().from(seuTable);

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
      .where(eq(reportsTable.id, report.id))
      .returning();

    res.json({
      id: updated.id,
      year: updated.year,
      status: updated.status,
      downloadUrl: updated.downloadUrl,
      createdAt: updated.createdAt,
    });
  } catch (err) {
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
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;

    // ── Auth / scope ─────────────────────────────────────────────────────────
    if (role !== "admin" && role !== "superadmin" && sessionUnitId === null) {
      res.status(403).json({ error: "Bu rapor için birim yetkisi gerekli" });
      return;
    }

    const yearParam = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
    const statusParam = req.query.status as string | undefined;
    const includeVap = req.query.includeVap !== "false";
    const includeProgress = req.query.includeProgress !== "false";

    // ── Fetch targets (baselineYear <= year <= targetYear) ────────────────────
    // Auth scope mirrors targets.ts: admin → companyId filter; superadmin → no companyId filter; user → own unitId
    const targetConditions: SQL[] = [
      lte(energyTargetsTable.baselineYear, yearParam),
      gte(energyTargetsTable.targetYear, yearParam),
    ];

    let resolvedUnitId: number | null = null;

    if (role !== "admin" && role !== "superadmin") {
      // Regular user: locked to own unit
      resolvedUnitId = sessionUnitId!;
      targetConditions.push(eq(energyTargetsTable.unitId, resolvedUnitId));
    } else if (role === "admin") {
      // Admin: scoped to own company, optional unitId filter
      targetConditions.push(eq(energyTargetsTable.companyId, sessionCompanyId));
      const quid = req.query.unitId ? parseInt(req.query.unitId as string) : NaN;
      if (!isNaN(quid)) {
        resolvedUnitId = quid;
        targetConditions.push(eq(energyTargetsTable.unitId, resolvedUnitId));
      }
    } else {
      // Superadmin: sees all companies, optional unitId filter
      const quid = req.query.unitId ? parseInt(req.query.unitId as string) : NaN;
      if (!isNaN(quid)) {
        resolvedUnitId = quid;
        targetConditions.push(eq(energyTargetsTable.unitId, resolvedUnitId));
      }
    }

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
            .where(inArray(energyActionPlansTable.targetId, targetIds))
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
            .where(inArray(vapProjectsTable.actionPlanId, vapActionIds))
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
    req.log.error(err);
    res.status(500).json({ error: "Rapor üretme hatası" });
  }
});

export default router;
