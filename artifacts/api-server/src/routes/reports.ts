import { Router } from "express";
import { db, reportsTable, consumptionTable, swotTable, risksTable, seuTable, metersTable, weatherTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
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

    const consumptionWhere = resolvedUnitId !== null
      ? and(eq(consumptionTable.year, yr), eq(consumptionTable.unitId, resolvedUnitId))
      : eq(consumptionTable.year, yr);

    const consumptionRows = await db.select().from(consumptionTable).where(consumptionWhere);
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

export default router;
