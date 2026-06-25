import { Router } from "express";
import {
  db,
  seuAssessmentItemsTable,
  seuAssessmentsTable,
  unitsTable,
  consumptionTable,
  metersTable,
  energySourcesTable,
  variablesTable,
  variableValuesTable,
  weatherDegreeDaysTable,
  energyUseGroupsTable,
  energyBaselinesTable,
  energyBaselineVariablesTable,
  usersTable,
} from "@workspace/db";
import { eq, and, inArray, desc, asc, ne } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

const MONTH_LABELS: Record<number, string> = {
  1: "Ocak", 2: "Şubat", 3: "Mart", 4: "Nisan", 5: "Mayıs", 6: "Haziran",
  7: "Temmuz", 8: "Ağustos", 9: "Eylül", 10: "Ekim", 11: "Kasım", 12: "Aralık",
};

// ── Regresyon matematik yardımcıları ─────────────────────────────────────────

function matMul(A: number[][], B: number[][]): number[][] {
  const m = A.length, n = A[0].length, p = B[0].length;
  const C = Array.from({ length: m }, () => new Array(p).fill(0) as number[]);
  for (let i = 0; i < m; i++)
    for (let k = 0; k < n; k++)
      for (let j = 0; j < p; j++)
        C[i][j] += A[i][k] * B[k][j];
  return C;
}

function matT(A: number[][]): number[][] {
  const m = A.length, n = A[0].length;
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: m }, (_, j) => A[j][i])
  );
}

// Gauss-Jordan eliminasyonu: Ax = b çöz ve A^(-1) döndür
function gaussJordan(A: number[][], b: number[]): { x: number[]; AInv: number[][] } {
  const n = A.length;
  const aug: number[][] = A.map((row, i) => {
    const eye = new Array(n).fill(0) as number[];
    eye[i] = 1;
    return [...row, ...eye, b[i]];
  });
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(aug[r][col]) > Math.abs(aug[maxRow][col])) maxRow = r;
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) throw new Error("Değişkenler arasında çoklu doğrusallık (multicollinearity) tespit edildi.");
    for (let j = col; j < 2 * n + 1; j++) aug[col][j] /= pivot;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = aug[r][col];
      for (let j = col; j < 2 * n + 1; j++) aug[r][j] -= f * aug[col][j];
    }
  }
  return {
    x: aug.map(row => row[2 * n]),
    AInv: aug.map(row => row.slice(n, 2 * n)),
  };
}

// Lanczos yaklaşımıyla log-gamma
function lgamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

// Düzenlenmiş eksik beta fonksiyonu I_x(a,b) — Lentz sürekli kesri
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x > (a + 1) / (a + b + 2)) return 1 - incompleteBeta(1 - x, b, a);
  const lbeta = lgamma(a) + lgamma(b) - lgamma(a + b);
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta) / a;
  const eps = 1e-10, maxIter = 300;
  let d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d; let c = 1, cf = d;
  for (let m = 1; m <= maxIter; m++) {
    for (const sign of [1, -1] as const) {
      const mm = sign === 1 ? m : m;
      const aa = sign === 1
        ? mm * (b - mm) * x / ((a + 2 * mm - 1) * (a + 2 * mm))
        : -(a + mm) * (a + b + mm) * x / ((a + 2 * mm) * (a + 2 * mm + 1));
      d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30;
      c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d;
      const delta = d * c;
      cf *= delta;
      if (sign === -1 && Math.abs(delta - 1) < eps) return front * cf;
    }
  }
  return front * cf;
}

// t-dağılımı için çift taraflı p-değeri
function tPValue(t: number, df: number): number {
  if (!isFinite(t) || df <= 0) return 1;
  const x = df / (df + t * t);
  return Math.min(1, incompleteBeta(x, df / 2, 0.5));
}

// OLS doğrusal regresyon: X (n×(p+1), 1. sütun intercept), y (n)
function olsRegression(X: number[][], y: number[]) {
  const n = X.length, pPlusOne = X[0].length;
  const p = pPlusOne - 1;
  const Xt = matT(X);
  const XtX = matMul(Xt, X);
  const Xty = matMul(Xt, y.map(v => [v])).map(r => r[0]);
  const { x: beta, AInv } = gaussJordan(XtX, Xty);
  const yHat = X.map(row => row.reduce((s, xi, i) => s + xi * beta[i], 0));
  const residuals = y.map((yi, i) => yi - yHat[i]);
  const yMean = y.reduce((s, v) => s + v, 0) / n;
  const SSres = residuals.reduce((s, e) => s + e * e, 0);
  const SStot = y.reduce((s, yi) => s + (yi - yMean) ** 2, 0);
  const rSquared = SStot < 1e-10 ? 0 : Math.max(0, 1 - SSres / SStot);
  const df = n - p - 1;
  const adjustedRSquared = df > 0 ? Math.max(0, 1 - (1 - rSquared) * (n - 1) / df) : 0;
  const mse = df > 0 ? SSres / df : SSres;
  const varBeta = AInv.map(row => row.map(v => v * mse));
  const se = beta.map((_, i) => Math.sqrt(Math.max(0, varBeta[i][i])));
  const tStats = beta.map((b, i) => se[i] > 1e-15 ? b / se[i] : 0);
  const pValues = tStats.map(t => tPValue(Math.abs(t), df));
  return { beta, rSquared, adjustedRSquared, mse, se, tStats, pValues, residuals, yHat };
}

// ── GET /api/energy-performance/seu-items ─────────────────
// Kabul edilmiş (accepted_as_seu) ÖEK kalemlerini döndürür
router.get("/energy-performance/seu-items", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const unitId = req.query.unitId ? parseInt(req.query.unitId as string) : null;

    const rows = await db
      .select({
        id: seuAssessmentItemsTable.id,
        assessmentId: seuAssessmentItemsTable.assessmentId,
        name: seuAssessmentItemsTable.name,
        energyTep: seuAssessmentItemsTable.energyTep,
        consumptionSharePercent: seuAssessmentItemsTable.consumptionSharePercent,
        priorityResult: seuAssessmentItemsTable.priorityResult,
        userDecision: seuAssessmentItemsTable.userDecision,
        decisionReason: seuAssessmentItemsTable.decisionReason,
        energySourceId: seuAssessmentItemsTable.energySourceId,
        energyUseGroupId: seuAssessmentItemsTable.energyUseGroupId,
        meterId: seuAssessmentItemsTable.meterId,
        unitId: seuAssessmentsTable.unitId,
        assessmentYear: seuAssessmentsTable.year,
        assessmentRecordType: seuAssessmentsTable.recordType,
        assessmentIsOfficial: seuAssessmentsTable.isOfficial,
        unitName: unitsTable.name,
        energySourceName: energySourcesTable.name,
        energyUseGroupName: energyUseGroupsTable.name,
      })
      .from(seuAssessmentItemsTable)
      .innerJoin(seuAssessmentsTable, eq(seuAssessmentItemsTable.assessmentId, seuAssessmentsTable.id))
      .leftJoin(unitsTable, eq(seuAssessmentsTable.unitId, unitsTable.id))
      .leftJoin(energySourcesTable, eq(seuAssessmentItemsTable.energySourceId, energySourcesTable.id))
      .leftJoin(energyUseGroupsTable, eq(seuAssessmentItemsTable.energyUseGroupId, energyUseGroupsTable.id))
      .where(
        and(
          eq(seuAssessmentsTable.companyId, sessionCompanyId),
          eq(seuAssessmentItemsTable.userDecision, "accepted_as_seu"),
          ...(role === "user" && sessionUnitId
            ? [eq(seuAssessmentsTable.unitId, sessionUnitId)]
            : unitId
              ? [eq(seuAssessmentsTable.unitId, unitId)]
              : []),
        )
      )
      .orderBy(desc(seuAssessmentsTable.year), asc(seuAssessmentItemsTable.priorityResult));

    res.json(rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── GET /api/energy-performance/dataset ───────────────────
// Seçilen ÖEK kalemi için tüketim + HDD/CDD veri seti (öncelik: meter > energyUseGroup > subUnit > unit)
router.get("/energy-performance/dataset", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const seuItemId = req.query.seuItemId ? parseInt(req.query.seuItemId as string) : null;
    const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();

    if (!seuItemId) {
      res.status(400).json({ error: "seuItemId zorunludur" });
      return;
    }

    // SEU kalemini ve assessment bilgilerini getir
    const [seuItem] = await db
      .select({
        id: seuAssessmentItemsTable.id,
        name: seuAssessmentItemsTable.name,
        itemUnitId: seuAssessmentItemsTable.unitId,
        itemSubUnitId: seuAssessmentItemsTable.subUnitId,
        energySourceId: seuAssessmentItemsTable.energySourceId,
        meterId: seuAssessmentItemsTable.meterId,
        energyUseGroupId: seuAssessmentItemsTable.energyUseGroupId,
        assessmentCompanyId: seuAssessmentsTable.companyId,
        assessmentUnitId: seuAssessmentsTable.unitId,
        assessmentYear: seuAssessmentsTable.year,
        assessmentRecordType: seuAssessmentsTable.recordType,
        assessmentIsOfficial: seuAssessmentsTable.isOfficial,
      })
      .from(seuAssessmentItemsTable)
      .innerJoin(seuAssessmentsTable, eq(seuAssessmentItemsTable.assessmentId, seuAssessmentsTable.id))
      .where(
        and(
          eq(seuAssessmentItemsTable.id, seuItemId),
          eq(seuAssessmentsTable.companyId, sessionCompanyId),
        )
      );

    if (!seuItem) {
      res.status(404).json({ error: "ÖEK kalemi bulunamadı" });
      return;
    }

    // Tenant + rol güvenliği — assessment.unitId kullan (item.unitId genellikle null)
    const assessmentUnitId = seuItem.assessmentUnitId;
    if (role === "user" && sessionUnitId && assessmentUnitId !== sessionUnitId) {
      res.status(403).json({ error: "Erişim yetkisi yok" });
      return;
    }

    // ── Öncelik sırasına göre eşleşen meter ID listesini belirle ──────────
    type MatchType = "meter" | "energyUseGroup" | "subUnit" | "unit" | "manual_unlinked";
    let matchType: MatchType = "manual_unlinked";
    let matchedMeterIds: number[] = [];
    let warningMessage: string | null = null;

    if (seuItem.meterId) {
      // 1. Öncelik: doğrudan meterId
      matchType = "meter";
      matchedMeterIds = [seuItem.meterId];

    } else if (seuItem.energyUseGroupId) {
      // 2. Öncelik: energyUseGroupId → bu gruba bağlı sayaçlar
      matchType = "energyUseGroup";
      const meters = await db
        .select({ id: metersTable.id })
        .from(metersTable)
        .where(
          and(
            eq(metersTable.energyUseGroupId, seuItem.energyUseGroupId),
            ...(assessmentUnitId ? [eq(metersTable.unitId, assessmentUnitId)] : []),
          )
        );
      matchedMeterIds = meters.map(m => m.id);
      if (matchedMeterIds.length === 0) {
        warningMessage = "Bu enerji kullanım grubuna bağlı sayaç bulunamadı.";
      }

    } else if (seuItem.itemSubUnitId) {
      // 3. Öncelik: subUnitId → o alt birime bağlı sayaçlar
      matchType = "subUnit";
      const meters = await db
        .select({ id: metersTable.id })
        .from(metersTable)
        .where(
          and(
            eq(metersTable.subUnitId, seuItem.itemSubUnitId),
            ...(seuItem.energySourceId ? [eq(metersTable.energySourceId, seuItem.energySourceId)] : []),
          )
        );
      matchedMeterIds = meters.map(m => m.id);

    } else if (assessmentUnitId) {
      // 4. Öncelik: assessment'ın birim ID'si → o birime bağlı sayaçlar
      matchType = "unit";
      const meters = await db
        .select({ id: metersTable.id })
        .from(metersTable)
        .where(
          and(
            eq(metersTable.unitId, assessmentUnitId),
            ...(seuItem.energySourceId ? [eq(metersTable.energySourceId, seuItem.energySourceId)] : []),
          )
        );
      matchedMeterIds = meters.map(m => m.id);

    } else {
      // 5. İlişkilendirilmemiş manuel kayıt
      matchType = "manual_unlinked";
      warningMessage = "Bu manuel ÖEK kaydı henüz sayaç veya enerji kullanım grubu ile ilişkilendirilmemiş. EnPG/EnRÇ analizi için lütfen ilgili sayaç veya enerji kullanım grubunu seçin.";
    }

    // ── Tüketim verilerini getir ──────────────────────────────────────────
    let consumptionRows: Array<{
      year: number; month: number; kwh: number; tep: number; co2: number;
      hdd: number | null; cdd: number | null; meterId: number;
      meterName: string | null; energySourceName: string | null;
    }> = [];

    if (matchedMeterIds.length > 0) {
      consumptionRows = await db
        .select({
          year: consumptionTable.year,
          month: consumptionTable.month,
          kwh: consumptionTable.kwh,
          tep: consumptionTable.tep,
          co2: consumptionTable.co2,
          hdd: consumptionTable.hdd,
          cdd: consumptionTable.cdd,
          meterId: consumptionTable.meterId,
          meterName: metersTable.name,
          energySourceName: energySourcesTable.name,
        })
        .from(consumptionTable)
        .innerJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
        .leftJoin(energySourcesTable, eq(metersTable.energySourceId, energySourcesTable.id))
        .where(
          and(
            eq(consumptionTable.companyId, sessionCompanyId),
            eq(consumptionTable.year, year),
            inArray(consumptionTable.meterId, matchedMeterIds),
          )
        )
        .orderBy(asc(consumptionTable.year), asc(consumptionTable.month));
    }

    // ── Aylık agregasyon ──────────────────────────────────────────────────
    const monthMap: Record<string, {
      year: number; month: number; totalKwh: number; totalTep: number;
      totalCo2: number; hddSum: number | null; cddSum: number | null; hddCount: number; cddCount: number;
      energySourceName: string | null; meters: string[];
    }> = {};

    for (const r of consumptionRows) {
      const key = `${r.year}-${r.month}`;
      if (!monthMap[key]) {
        monthMap[key] = {
          year: r.year, month: r.month, totalKwh: 0, totalTep: 0,
          totalCo2: 0, hddSum: null, cddSum: null, hddCount: 0, cddCount: 0,
          energySourceName: r.energySourceName ?? null, meters: [],
        };
      }
      monthMap[key].totalKwh += r.kwh ?? 0;
      monthMap[key].totalTep += r.tep ?? 0;
      monthMap[key].totalCo2 += r.co2 ?? 0;
      if (r.hdd != null) { monthMap[key].hddSum = (monthMap[key].hddSum ?? 0) + r.hdd; monthMap[key].hddCount++; }
      if (r.cdd != null) { monthMap[key].cddSum = (monthMap[key].cddSum ?? 0) + r.cdd; monthMap[key].cddCount++; }
      if (r.meterName && !monthMap[key].meters.includes(r.meterName)) {
        monthMap[key].meters.push(r.meterName);
      }
    }

    const consumptionDataset = Object.values(monthMap)
      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
      .map(r => ({
        year: r.year,
        month: r.month,
        monthLabel: MONTH_LABELS[r.month] ?? String(r.month),
        totalKwh: Math.round(r.totalKwh * 100) / 100,
        totalTep: Math.round(r.totalTep * 10000) / 10000,
        totalCo2: Math.round(r.totalCo2 * 100) / 100,
        hdd: r.hddSum != null && r.hddCount > 0 ? Math.round((r.hddSum / r.hddCount) * 10) / 10 : null,
        cdd: r.cddSum != null && r.cddCount > 0 ? Math.round((r.cddSum / r.cddCount) * 10) / 10 : null,
        energySourceName: r.energySourceName,
        meters: r.meters.join(", "),
      }));

    // ── Eksik ayları belirle ──────────────────────────────────────────────
    const presentMonths = new Set(consumptionDataset.map(r => r.month));
    const missingMonths = Array.from({ length: 12 }, (_, i) => i + 1)
      .filter(m => !presentMonths.has(m))
      .map(m => MONTH_LABELS[m] ?? String(m));

    // Assessment yılı ≠ istenen yıl uyarısı
    if (seuItem.assessmentYear !== year && !warningMessage) {
      warningMessage = `ÖEK değerlendirme yılı (${seuItem.assessmentYear}) ile seçilen veri yılı (${year}) farklı. Doğru yılı seçtiğinizden emin olun.`;
    }

    // Eşleşen sayaç var ama o yıl için tüketim yoksa
    if (matchedMeterIds.length > 0 && consumptionDataset.length === 0 && !warningMessage) {
      warningMessage = `Bu ÖEK ile eşleşen ${matchedMeterIds.length} sayaç bulundu, ancak ${year} yılı için tüketim kaydı bulunamadı.`;
    }

    res.json({
      seuItem: {
        id: seuItem.id,
        name: seuItem.name,
        unitId: assessmentUnitId,
        energySourceId: seuItem.energySourceId,
        energyUseGroupId: seuItem.energyUseGroupId,
        meterId: seuItem.meterId,
        assessmentYear: seuItem.assessmentYear,
        assessmentRecordType: seuItem.assessmentRecordType,
      },
      year,
      matchType,
      matchedMeterCount: matchedMeterIds.length,
      matchedConsumptionCount: consumptionRows.length,
      missingMonths,
      warningMessage,
      consumptionDataset,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── GET /api/energy-performance/variables ─────────────────
// Seçilebilir değişkenler (variablesTable + HDD/CDD sabit değişkenler)
router.get("/energy-performance/variables", requireAuth, async (req, res) => {
  try {
    const { companyId: sessionCompanyId } = req.user!;

    const dbVars = await db
      .select({
        id: variablesTable.id,
        name: variablesTable.name,
        code: variablesTable.code,
        category: variablesTable.category,
        unitLabel: variablesTable.unitLabel,
        sourceType: variablesTable.sourceType,
        isActive: variablesTable.isActive,
      })
      .from(variablesTable)
      .where(
        and(
          eq(variablesTable.companyId, sessionCompanyId),
          eq(variablesTable.isActive, true),
        )
      )
      .orderBy(asc(variablesTable.name));

    const systemVariables = [
      { id: null, name: "HDD (Isıtma Gün Derecesi)", code: "HDD", category: "climate", unitLabel: "°C·gün", sourceType: "weather_auto", isActive: true },
      { id: null, name: "CDD (Soğutma Gün Derecesi)", code: "CDD", category: "climate", unitLabel: "°C·gün", sourceType: "weather_auto", isActive: true },
      { id: null, name: "Üretim Miktarı", code: "PRODUCTION", category: "production", unitLabel: "birim", sourceType: "operation_manual", isActive: true },
      { id: null, name: "Çalışma Saati", code: "WORKING_HOURS", category: "operational", unitLabel: "saat", sourceType: "operation_manual", isActive: true },
      { id: null, name: "Personel Sayısı", code: "STAFF_COUNT", category: "operational", unitLabel: "kişi", sourceType: "operation_manual", isActive: true },
      { id: null, name: "Alan / m²", code: "AREA_M2", category: "operational", unitLabel: "m²", sourceType: "operation_manual", isActive: true },
      { id: null, name: "Misafir Sayısı", code: "GUEST_COUNT", category: "operational", unitLabel: "kişi", sourceType: "operation_manual", isActive: true },
      { id: null, name: "Kilometre", code: "KM", category: "operational", unitLabel: "km", sourceType: "operation_manual", isActive: true },
      { id: null, name: "Ekipman Çalışma Süresi", code: "EQUIP_HOURS", category: "operational", unitLabel: "saat", sourceType: "operation_manual", isActive: true },
      { id: null, name: "Arıza Sayısı", code: "FAULT_COUNT", category: "operational", unitLabel: "adet", sourceType: "operation_manual", isActive: true },
      { id: null, name: "Bakım Sayısı", code: "MAINTENANCE_COUNT", category: "operational", unitLabel: "adet", sourceType: "operation_manual", isActive: true },
      { id: null, name: "Anahtarlama Ekipmanları Açma/Kapama Sayısı", code: "SWITCH_COUNT", category: "operational", unitLabel: "adet", sourceType: "operation_manual", isActive: true },
      { id: null, name: "TM'lerde Aktarılan Enerji Miktarı", code: "TM_ENERGY", category: "operational", unitLabel: "kWh", sourceType: "operation_manual", isActive: true },
    ];

    res.json({
      systemVariables,
      userVariables: dbVars,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── POST /api/energy-performance/regression/run ───────────
router.post("/energy-performance/regression/run", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const { seuItemId, year, selectedVariables } = req.body as {
      seuItemId: number;
      year: number;
      selectedVariables: string[];
    };

    if (!seuItemId || !year || !selectedVariables || selectedVariables.length === 0) {
      res.status(400).json({ error: "seuItemId, year ve selectedVariables zorunludur" });
      return;
    }

    // ÖEK kalemi + assessment bilgileri
    const [seuItem] = await db
      .select({
        id: seuAssessmentItemsTable.id,
        name: seuAssessmentItemsTable.name,
        itemSubUnitId: seuAssessmentItemsTable.subUnitId,
        energySourceId: seuAssessmentItemsTable.energySourceId,
        meterId: seuAssessmentItemsTable.meterId,
        energyUseGroupId: seuAssessmentItemsTable.energyUseGroupId,
        assessmentUnitId: seuAssessmentsTable.unitId,
        assessmentCompanyId: seuAssessmentsTable.companyId,
        assessmentYear: seuAssessmentsTable.year,
      })
      .from(seuAssessmentItemsTable)
      .innerJoin(seuAssessmentsTable, eq(seuAssessmentItemsTable.assessmentId, seuAssessmentsTable.id))
      .where(and(
        eq(seuAssessmentItemsTable.id, seuItemId),
        eq(seuAssessmentsTable.companyId, sessionCompanyId),
      ));

    if (!seuItem) { res.status(404).json({ error: "ÖEK kalemi bulunamadı" }); return; }

    const assessmentUnitId = seuItem.assessmentUnitId;
    if (role === "user" && sessionUnitId && assessmentUnitId !== sessionUnitId) {
      res.status(403).json({ error: "Erişim yetkisi yok" }); return;
    }

    // Eşleşen sayaç ID'leri (dataset endpoint ile aynı öncelik zinciri)
    let matchedMeterIds: number[] = [];
    if (seuItem.meterId) {
      matchedMeterIds = [seuItem.meterId];
    } else if (seuItem.energyUseGroupId) {
      const ms = await db.select({ id: metersTable.id }).from(metersTable).where(and(
        eq(metersTable.energyUseGroupId, seuItem.energyUseGroupId),
        ...(assessmentUnitId ? [eq(metersTable.unitId, assessmentUnitId)] : []),
      ));
      matchedMeterIds = ms.map(m => m.id);
    } else if (seuItem.itemSubUnitId) {
      const ms = await db.select({ id: metersTable.id }).from(metersTable).where(
        eq(metersTable.subUnitId, seuItem.itemSubUnitId));
      matchedMeterIds = ms.map(m => m.id);
    } else if (assessmentUnitId) {
      const ms = await db.select({ id: metersTable.id }).from(metersTable).where(
        eq(metersTable.unitId, assessmentUnitId));
      matchedMeterIds = ms.map(m => m.id);
    }

    if (matchedMeterIds.length === 0) {
      res.json({ error: "Bu ÖEK için eşleşen sayaç bulunamadı. Tüketim verisi yok." }); return;
    }

    // Tüketim verileri — aylık agragasyon
    const rows = await db
      .select({
        month: consumptionTable.month,
        kwh: consumptionTable.kwh,
        tep: consumptionTable.tep,
        hdd: consumptionTable.hdd,
        cdd: consumptionTable.cdd,
      })
      .from(consumptionTable)
      .where(and(
        eq(consumptionTable.companyId, sessionCompanyId),
        eq(consumptionTable.year, year),
        inArray(consumptionTable.meterId, matchedMeterIds),
      ))
      .orderBy(asc(consumptionTable.month));

    // Ay bazında agregasyon: tep topla, hdd/cdd ortalama
    const monthAgg: Record<number, { tep: number; kwh: number; hddSum: number; hddN: number; cddSum: number; cddN: number }> = {};
    for (const r of rows) {
      if (!monthAgg[r.month]) monthAgg[r.month] = { tep: 0, kwh: 0, hddSum: 0, hddN: 0, cddSum: 0, cddN: 0 };
      monthAgg[r.month].tep += r.tep ?? 0;
      monthAgg[r.month].kwh += r.kwh ?? 0;
      if (r.hdd != null) { monthAgg[r.month].hddSum += r.hdd; monthAgg[r.month].hddN++; }
      if (r.cdd != null) { monthAgg[r.month].cddSum += r.cdd; monthAgg[r.month].cddN++; }
    }

    // Değişken değerlerini çöz (user-defined variables from variable_values)
    // code → { month → value }
    const varValueMap: Record<string, Record<number, number>> = {};

    for (const code of selectedVariables) {
      if (code === "HDD") {
        varValueMap["HDD"] = {};
        for (const [m, agg] of Object.entries(monthAgg)) {
          const mn = parseInt(m);
          if (agg.hddN > 0) varValueMap["HDD"][mn] = agg.hddSum / agg.hddN;
        }
      } else if (code === "CDD") {
        varValueMap["CDD"] = {};
        for (const [m, agg] of Object.entries(monthAgg)) {
          const mn = parseInt(m);
          if (agg.cddN > 0) varValueMap["CDD"][mn] = agg.cddSum / agg.cddN;
        }
      } else if (code.startsWith("user-")) {
        const varId = parseInt(code.replace("user-", ""));
        const vvals = await db
          .select({ value: variableValuesTable.value, periodStart: variableValuesTable.periodStart })
          .from(variableValuesTable)
          .where(and(
            eq(variableValuesTable.companyId, sessionCompanyId),
            eq(variableValuesTable.variableId, varId),
            ...(assessmentUnitId ? [eq(variableValuesTable.unitId, assessmentUnitId)] : []),
          ));
        varValueMap[code] = {};
        for (const vv of vvals) {
          // period_start örn. "2024-03" veya "2024-03-01"
          const parts = vv.periodStart.split("-");
          if (parts.length >= 2 && parseInt(parts[0]) === year) {
            const mn = parseInt(parts[1]);
            if (mn >= 1 && mn <= 12) varValueMap[code][mn] = vv.value;
          }
        }
      } else {
        // Sistem kodu (PRODUCTION vb.) — variable_values tablosundan çek
        const sysVars = await db
          .select({ id: variablesTable.id })
          .from(variablesTable)
          .where(and(eq(variablesTable.companyId, sessionCompanyId), eq(variablesTable.code ?? variablesTable.name, code)));
        if (sysVars.length > 0) {
          const vvals = await db
            .select({ value: variableValuesTable.value, periodStart: variableValuesTable.periodStart })
            .from(variableValuesTable)
            .where(and(
              eq(variableValuesTable.companyId, sessionCompanyId),
              eq(variableValuesTable.variableId, sysVars[0].id),
              ...(assessmentUnitId ? [eq(variableValuesTable.unitId, assessmentUnitId)] : []),
            ));
          varValueMap[code] = {};
          for (const vv of vvals) {
            const parts = vv.periodStart.split("-");
            if (parts.length >= 2 && parseInt(parts[0]) === year) {
              const mn = parseInt(parts[1]);
              if (mn >= 1 && mn <= 12) varValueMap[code][mn] = vv.value;
            }
          }
        } else {
          varValueMap[code] = {};
        }
      }
    }

    // Tüm değişkenlerin değerinin bulunduğu tam ayları bul
    const completeMonths: Array<{ month: number; y: number; xs: number[] }> = [];
    const missingVarByMonth: Record<number, string[]> = {};

    for (let m = 1; m <= 12; m++) {
      if (!monthAgg[m]) continue; // tüketim yok
      const xs: number[] = [];
      const missing: string[] = [];
      for (const code of selectedVariables) {
        const val = varValueMap[code]?.[m];
        if (val == null) missing.push(code);
        else xs.push(val);
      }
      if (missing.length === 0) {
        completeMonths.push({ month: m, y: monthAgg[m].tep, xs });
      } else {
        missingVarByMonth[m] = missing;
      }
    }

    const sampleSize = completeMonths.length;
    if (sampleSize < 6) {
      const hasMissVars = Object.values(missingVarByMonth).some(v => v.length > 0);
      const msg = hasMissVars
        ? `Regresyon için en az 6 aylık tam veri gerekli. Bazı aylarda değişken değeri eksik. Önce Değişken Değerleri ekranından değerleri girin.`
        : `Regresyon için en az 6 aylık tüketim verisi gerekli. Mevcut: ${sampleSize} ay.`;
      res.json({
        error: msg,
        sampleSize,
        missingVariableMonths: Object.entries(missingVarByMonth).map(([m, codes]) => ({
          month: MONTH_LABELS[parseInt(m)] ?? m,
          missingVariables: codes,
        })),
      });
      return;
    }

    // Regresyon matrislerini oluştur
    const p = selectedVariables.length;
    const modelType = p === 1 ? "single_regression" : "multiple_regression";
    const Xmat = completeMonths.map(r => [1, ...r.xs]); // intercept + değişkenler
    const yvec = completeMonths.map(r => r.y);

    let regressionResult;
    try {
      regressionResult = olsRegression(Xmat, yvec);
    } catch (e: any) {
      res.status(422).json({ error: e.message ?? "Regresyon hesaplanamadı" });
      return;
    }

    const { beta, rSquared, adjustedRSquared, pValues, se, tStats } = regressionResult;

    // Değişken sonuçları
    const varNames: Record<string, string> = {
      HDD: "HDD (Isıtma Gün Derecesi)", CDD: "CDD (Soğutma Gün Derecesi)",
      PRODUCTION: "Üretim Miktarı", WORKING_HOURS: "Çalışma Saati",
      STAFF_COUNT: "Personel Sayısı", AREA_M2: "Alan / m²",
      GUEST_COUNT: "Misafir Sayısı", KM: "Kilometre",
      EQUIP_HOURS: "Ekipman Çalışma Süresi", FAULT_COUNT: "Arıza Sayısı",
      MAINTENANCE_COUNT: "Bakım Sayısı", SWITCH_COUNT: "Anahtarlama Ekipmanları Açma/Kapama",
      TM_ENERGY: "TM'lerde Aktarılan Enerji Miktarı",
    };

    const variables = selectedVariables.map((code, i) => ({
      variableName: varNames[code] ?? code,
      code,
      coefficient: Math.round(beta[i + 1] * 1e6) / 1e6,
      standardError: Math.round(se[i + 1] * 1e6) / 1e6,
      tStat: Math.round(tStats[i + 1] * 1e4) / 1e4,
      pValue: Math.round(pValues[i + 1] * 1e4) / 1e4,
      isSignificant: pValues[i + 1] < 0.1,
    }));

    // Validasyon
    const primaryCriteria = p === 1 ? rSquared : adjustedRSquared;
    const criteriaLabel = p === 1 ? "R²" : "Ayarlı R²";
    const insigVars = variables.filter(v => !v.isSignificant);
    const validationMessages: string[] = [];
    let isValid = true;

    if (primaryCriteria < 0.75) {
      isValid = false;
      validationMessages.push(`${criteriaLabel} = ${primaryCriteria.toFixed(4)} < 0.75 — Model prosedür kriterini sağlamıyor.`);
    } else {
      validationMessages.push(`${criteriaLabel} = ${primaryCriteria.toFixed(4)} ≥ 0.75 ✓`);
    }
    if (insigVars.length > 0) {
      isValid = false;
      validationMessages.push(`P değeri ≥ 0.1 olan değişkenler: ${insigVars.map(v => v.variableName).join(", ")} — Bu değişkenler anlamlı kabul edilmez.`);
    }
    if (isValid) {
      validationMessages.push("Tüm değişkenler p < 0.1 kriterini sağlıyor ✓");
    }

    // Formül metni
    const interceptRounded = Math.round(beta[0] * 1e4) / 1e4;
    const formulaParts = variables.map(v =>
      `${v.coefficient >= 0 ? "+ " : "- "}${Math.abs(v.coefficient).toFixed(6)} × ${v.variableName}`
    );
    const formulaText = `Beklenen Tüketim (TEP) = ${interceptRounded} ${formulaParts.join(" ")}`;

    const suggestedVariablesToRemove = insigVars.map(v => v.code);
    const usedMonths = completeMonths.map(r => MONTH_LABELS[r.month] ?? String(r.month));

    res.json({
      modelType,
      seuItemName: seuItem.name,
      year,
      sampleSize,
      intercept: Math.round(beta[0] * 1e6) / 1e6,
      rSquared: Math.round(rSquared * 1e6) / 1e6,
      adjustedRSquared: Math.round(adjustedRSquared * 1e6) / 1e6,
      variables,
      isValid,
      validationMessages,
      suggestedVariablesToRemove,
      formulaText,
      usedMonths,
      missingVariableMonths: Object.entries(missingVarByMonth).map(([m, codes]) => ({
        month: MONTH_LABELS[parseInt(m)] ?? m,
        missingVariables: codes,
      })),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── GET /api/energy-performance/baselines ─────────────────
// Seçilen ÖEK için kayıtlı EnRÇ listesi
router.get("/energy-performance/baselines", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const seuItemId = req.query.seuItemId ? parseInt(req.query.seuItemId as string) : null;

    if (!seuItemId) {
      res.status(400).json({ error: "seuItemId zorunludur" });
      return;
    }

    // ÖEK güvenlik kontrolü
    const [seuItem] = await db
      .select({ id: seuAssessmentItemsTable.id, assessmentUnitId: seuAssessmentsTable.unitId })
      .from(seuAssessmentItemsTable)
      .innerJoin(seuAssessmentsTable, eq(seuAssessmentItemsTable.assessmentId, seuAssessmentsTable.id))
      .where(and(
        eq(seuAssessmentItemsTable.id, seuItemId),
        eq(seuAssessmentsTable.companyId, sessionCompanyId),
      ));

    if (!seuItem) { res.status(404).json({ error: "ÖEK kalemi bulunamadı" }); return; }
    if (role === "user" && sessionUnitId && seuItem.assessmentUnitId !== sessionUnitId) {
      res.status(403).json({ error: "Erişim yetkisi yok" }); return;
    }

    const baselines = await db
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
        updateReason: energyBaselinesTable.updateReason,
        notes: energyBaselinesTable.notes,
        createdByUserId: energyBaselinesTable.createdByUserId,
        createdAt: energyBaselinesTable.createdAt,
        updatedAt: energyBaselinesTable.updatedAt,
        createdByName: usersTable.name,
      })
      .from(energyBaselinesTable)
      .leftJoin(usersTable, eq(energyBaselinesTable.createdByUserId, usersTable.id))
      .where(and(
        eq(energyBaselinesTable.companyId, sessionCompanyId),
        eq(energyBaselinesTable.seuAssessmentItemId, seuItemId),
      ))
      .orderBy(desc(energyBaselinesTable.createdAt));

    // Her baseline için değişkenleri getir
    const baselineIds = baselines.map(b => b.id);
    const allVariables = baselineIds.length > 0
      ? await db
          .select()
          .from(energyBaselineVariablesTable)
          .where(inArray(energyBaselineVariablesTable.baselineId, baselineIds))
      : [];

    const variablesByBaseline: Record<number, typeof allVariables> = {};
    for (const v of allVariables) {
      if (!variablesByBaseline[v.baselineId]) variablesByBaseline[v.baselineId] = [];
      variablesByBaseline[v.baselineId].push(v);
    }

    const result = baselines.map(b => ({
      ...b,
      variables: variablesByBaseline[b.id] ?? [],
    }));

    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── POST /api/energy-performance/baselines ────────────────
// Yeni EnRÇ kaydı oluştur
router.post("/energy-performance/baselines", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId, userId, name: userName } = req.user!;

    const {
      seuItemId,
      year,
      baselinePeriodStart,
      baselinePeriodEnd,
      regressionResult,
      status,
      updateReason,
      notes,
    } = req.body as {
      seuItemId: number;
      year: number;
      baselinePeriodStart: string;
      baselinePeriodEnd: string;
      regressionResult: {
        modelType: string;
        intercept: number;
        rSquared: number;
        adjustedRSquared: number;
        sampleSize: number;
        formulaText: string;
        isValid: boolean;
        variables: Array<{
          variableName: string;
          code: string;
          coefficient: number;
          standardError: number;
          tStat: number;
          pValue: number;
          isSignificant: boolean;
        }>;
      };
      status: "active" | "draft";
      updateReason?: string;
      notes?: string;
    };

    // Zorunlu alan kontrolü
    if (!seuItemId || !year || !baselinePeriodStart || !baselinePeriodEnd || !regressionResult || !status) {
      res.status(400).json({ error: "Zorunlu alanlar eksik" });
      return;
    }

    if (status !== "active" && status !== "draft") {
      res.status(400).json({ error: "status 'active' veya 'draft' olmalıdır" });
      return;
    }

    // Aktif olarak kaydedilmek isteniyorsa model geçerli olmalı
    if (status === "active" && !regressionResult.isValid) {
      res.status(422).json({ error: "Prosedür kriterlerini sağlamayan model aktif EnRÇ olarak kaydedilemez" });
      return;
    }

    // ÖEK güvenlik kontrolü
    const [seuItem] = await db
      .select({
        id: seuAssessmentItemsTable.id,
        name: seuAssessmentItemsTable.name,
        assessmentUnitId: seuAssessmentsTable.unitId,
        assessmentCompanyId: seuAssessmentsTable.companyId,
      })
      .from(seuAssessmentItemsTable)
      .innerJoin(seuAssessmentsTable, eq(seuAssessmentItemsTable.assessmentId, seuAssessmentsTable.id))
      .where(and(
        eq(seuAssessmentItemsTable.id, seuItemId),
        eq(seuAssessmentsTable.companyId, sessionCompanyId),
      ));

    if (!seuItem) { res.status(404).json({ error: "ÖEK kalemi bulunamadı" }); return; }

    const assessmentUnitId = seuItem.assessmentUnitId;

    // Rol güvenliği: user sadece kendi birimindeki ÖEK için kayıt ekleyebilir
    if (role === "user" && sessionUnitId && assessmentUnitId !== sessionUnitId) {
      res.status(403).json({ error: "Bu ÖEK için EnRÇ kaydetme yetkiniz yok" }); return;
    }

    // Admin sadece kendi firması kapsamındaki ÖEK için kayıt ekleyebilir (zaten companyId filtresi var)

    // Aktif kayıt ekleniyorsa: mevcut aktif kayıtları archived yap
    if (status === "active") {
      await db
        .update(energyBaselinesTable)
        .set({ status: "archived", updatedAt: new Date() })
        .where(and(
          eq(energyBaselinesTable.companyId, sessionCompanyId),
          eq(energyBaselinesTable.seuAssessmentItemId, seuItemId),
          eq(energyBaselinesTable.status, "active"),
        ));
    }

    // Yeni baseline kaydı
    const [newBaseline] = await db.insert(energyBaselinesTable).values({
      companyId: sessionCompanyId,
      unitId: assessmentUnitId ?? null,
      seuAssessmentItemId: seuItemId,
      baselineYear: year,
      periodStart: baselinePeriodStart,
      periodEnd: baselinePeriodEnd,
      modelType: regressionResult.modelType === "single_regression" ? "single_regression" : "multiple_regression",
      intercept: regressionResult.intercept,
      rSquared: regressionResult.rSquared,
      adjustedRSquared: regressionResult.adjustedRSquared,
      sampleSize: regressionResult.sampleSize,
      formulaText: regressionResult.formulaText,
      isValid: regressionResult.isValid,
      status,
      updateReason: updateReason ?? null,
      notes: notes ?? null,
      createdByUserId: userId,
    }).returning();

    // Değişken kayıtları
    if (regressionResult.variables && regressionResult.variables.length > 0) {
      await db.insert(energyBaselineVariablesTable).values(
        regressionResult.variables.map(v => ({
          baselineId: newBaseline.id,
          variableName: v.variableName,
          variableCode: v.code,
          variableSource: "regression",
          coefficient: v.coefficient,
          standardError: v.standardError,
          tStat: v.tStat,
          pValue: v.pValue,
          isSignificant: v.isSignificant,
        }))
      );
    }

    res.status(201).json({ ...newBaseline, variables: regressionResult.variables });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
