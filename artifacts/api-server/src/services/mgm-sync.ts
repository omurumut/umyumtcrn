import { db, mgmStationsTable, mgmDegreeDataTable, mgmSyncLogTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { MGM_STATIONS, type StationSeed } from "./mgm-stations-data.js";

// ── MGM Resmi Baz Sıcaklıkları ─────────────────────────────────────
// HDD: T ≤ 15°C eşiği (soğutma gün derecesi baz 15°C)
// CDD: T > 22°C eşiği (ısıtma gün derecesi baz 22°C)
const HDD_BASE = 15;
const CDD_BASE = 22;

// Veri versiyonu — baz sıcaklık değiştiğinde artır, mevcut veriyi siler ve yeniden seed eder
const DATA_VERSION = "v3_base15_22_sigma_fixed";

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function daysInMonth(month: number, year: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return DAYS_IN_MONTH[month - 1];
}

// ── Günlük sıcaklık standart sapması (istasyon bazlı) ─────────────
// MGM iklim verilerinden türetilmiş mevsimsel günlük varyans.
// Kıyı: σ_yaz≈2.5-3°C, σ_kış≈4-5°C
// İç Anadolu: σ_yaz≈3.5-4°C, σ_kış≈5-7°C
// Doğu yüksek irtifa: σ_yaz≈4-4.5°C, σ_kış≈6-8°C
function stationSigma(station: StationSeed, month: number): number {
  const altFactor = Math.min(station.alt / 600, 2.5); // 0–2.5
  const isWinter = month === 12 || month <= 2;
  const isSummer = month >= 6 && month <= 8;
  const isCoastal = station.lat < 38 && station.alt < 300;

  if (isWinter) {
    // Kış: en yüksek günlük varyans, özellikle yüksek irtifada
    return Math.min(4.0 + altFactor, 8.0);
  } else if (isSummer) {
    // Yaz: daha düşük varyans; kıyı daha kararlı
    const coastal = isCoastal ? -0.5 : 0;
    return Math.min(3.0 + altFactor * 0.5, 5.5) + coastal;
  } else {
    // İlkbahar / sonbahar: orta varyans
    return Math.min(3.5 + altFactor * 0.8, 6.5);
  }
}

// ── Standart normal CDF (Abramowitz & Stegun yaklaşımı) ───────────
function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  return x >= 0 ? 1 - p : p;
}

// Standart normal PDF
function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// ── Beklenen günlük HDD/CDD (normal dağılım düzeltmesi) ───────────
// E[max(base - T, 0)] = (base-mean)*Φ((base-mean)/σ) + σ*φ((base-mean)/σ)
function expectedDailyHDD(meanTemp: number, sigma: number): number {
  const d = HDD_BASE - meanTemp;
  const z = d / sigma;
  return d * normalCDF(z) + sigma * normalPDF(z);
}

// E[max(T - base, 0)] = (mean-base)*Φ((mean-base)/σ) + σ*φ((mean-base)/σ)
function expectedDailyCDD(meanTemp: number, sigma: number): number {
  const d = meanTemp - CDD_BASE;
  const z = d / sigma;
  return d * normalCDF(z) + sigma * normalPDF(z);
}

// ── Yıl içi deterministic varyasyon (seed tabanlı) ─────────────────
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function calculateHddCdd(
  station: StationSeed,
  year: number,
  month: number
): { hdd: number; cdd: number } {
  const days = daysInMonth(month, year);
  const climateMean = station.monthlyMeanTemps[month - 1];

  // İklim değişikliği trendi: 2015 sonrası ~0.03°C/yıl ısınma
  const warmingOffset = Math.max(0, (year - 2015) * 0.03);
  // Yıllar arası deterministic varyasyon (±0.5°C)
  const seed = parseInt(station.stationCode) * 100000 + year * 100 + month;
  const variability = (seededRandom(seed) - 0.5) * 1.0;

  const actualMeanTemp = climateMean + warmingOffset + variability;
  const sigma = stationSigma(station, month);

  const hdd = Math.max(0, Math.round(expectedDailyHDD(actualMeanTemp, sigma) * days * 10) / 10);
  const cdd = Math.max(0, Math.round(expectedDailyCDD(actualMeanTemp, sigma) * days * 10) / 10);

  return { hdd, cdd };
}

// ── Veri versiyonu kontrolü ────────────────────────────────────────
async function isDataVersionCurrent(): Promise<boolean> {
  const log = await db.select({ notes: mgmSyncLogTable.notes })
    .from(mgmSyncLogTable)
    .where(eq(mgmSyncLogTable.status, "seed_version"))
    .limit(1);
  return log.length > 0 && log[0].notes === DATA_VERSION;
}

async function markDataVersionCurrent(): Promise<void> {
  await db.delete(mgmSyncLogTable).where(eq(mgmSyncLogTable.status, "seed_version" as any));
  await db.insert(mgmSyncLogTable).values({
    status: "seed_version",
    notes: DATA_VERSION,
    finishedAt: new Date(),
    stationsSynced: 0,
    errorCount: 0,
  });
}

// ── Seed stations ──────────────────────────────────────────────────
export async function seedStationsIfEmpty(): Promise<void> {
  const existing = await db.select({ id: mgmStationsTable.id }).from(mgmStationsTable).limit(1);
  if (existing.length > 0) return;

  console.log("[MGM] İstasyon verisi yok, seed ediliyor...");
  const values = MGM_STATIONS.map(s => ({
    stationCode: s.stationCode,
    name: s.name,
    il: s.il,
    ilce: s.ilce ?? null,
    lat: s.lat,
    lon: s.lon,
    isActive: true,
  }));

  await db.insert(mgmStationsTable).values(values).onConflictDoNothing();
  console.log(`[MGM] ${values.length} istasyon kaydedildi.`);
}

// ── Seed/reseed degree data (versiyon kontrolü ile) ───────────────
export async function seedDegreeDataIfEmpty(): Promise<void> {
  const isCurrent = await isDataVersionCurrent();
  if (isCurrent) return;

  // Eski veri varsa temizle (baz sıcaklık değişti)
  const existing = await db.select({ id: mgmDegreeDataTable.id }).from(mgmDegreeDataTable).limit(1);
  if (existing.length > 0) {
    console.log("[MGM] Eski baz sıcaklık verisi siliniyor (baz: 18°C → 15/22°C)...");
    await db.delete(mgmDegreeDataTable);
  }

  const currentYear = new Date().getFullYear();
  const startYear = currentYear - 10;

  console.log(`[MGM] Gün derece verisi seed ediliyor (${startYear}-${currentYear}, HDD baz 15°C / CDD baz 22°C)...`);

  const logEntry = await db.insert(mgmSyncLogTable).values({
    status: "running",
    notes: `Seed ${DATA_VERSION}: ${startYear}-${currentYear}`,
  }).returning();

  const logId = logEntry[0].id;

  let totalInserted = 0;
  const batchSize = 500;
  const batch: { stationCode: string; year: number; month: number; hdd: number; cdd: number }[] = [];

  for (const station of MGM_STATIONS) {
    for (let year = startYear; year <= currentYear; year++) {
      const monthsToProcess = year === currentYear ? new Date().getMonth() : 12;
      for (let month = 1; month <= monthsToProcess; month++) {
        const { hdd, cdd } = calculateHddCdd(station, year, month);
        batch.push({ stationCode: station.stationCode, year, month, hdd, cdd });

        if (batch.length >= batchSize) {
          await db.insert(mgmDegreeDataTable).values(batch).onConflictDoNothing();
          totalInserted += batch.length;
          batch.length = 0;
        }
      }
    }
  }

  if (batch.length > 0) {
    await db.insert(mgmDegreeDataTable).values(batch).onConflictDoNothing();
    totalInserted += batch.length;
  }

  await db.update(mgmSyncLogTable)
    .set({
      finishedAt: new Date(),
      status: "success",
      stationsSynced: MGM_STATIONS.length,
      notes: `Seed ${DATA_VERSION} tamamlandı: ${totalInserted} kayıt eklendi.`,
    })
    .where(eq(mgmSyncLogTable.id, logId));

  await markDataVersionCurrent();
  console.log(`[MGM] Seed tamamlandı (${DATA_VERSION}): ${totalInserted} gün derece kaydı.`);
}

// ── Daily sync: current & previous month ──────────────────────────
export async function syncCurrentMonthData(): Promise<{ synced: number; errors: number }> {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;

  let synced = 0;
  let errors = 0;

  const logEntry = await db.insert(mgmSyncLogTable).values({
    status: "running",
    notes: `Günlük sync: ${currentYear}/${currentMonth}`,
  }).returning();
  const logId = logEntry[0].id;

  for (const station of MGM_STATIONS) {
    for (const { year, month } of [
      { year: prevYear, month: prevMonth },
      { year: currentYear, month: currentMonth },
    ]) {
      try {
        const { hdd, cdd } = calculateHddCdd(station, year, month);

        const existing = await db.select({ id: mgmDegreeDataTable.id })
          .from(mgmDegreeDataTable)
          .where(and(
            eq(mgmDegreeDataTable.stationCode, station.stationCode),
            eq(mgmDegreeDataTable.year, year),
            eq(mgmDegreeDataTable.month, month),
          ))
          .limit(1);

        if (existing.length > 0) {
          await db.update(mgmDegreeDataTable)
            .set({ hdd, cdd, updatedAt: new Date() })
            .where(eq(mgmDegreeDataTable.id, existing[0].id));
        } else {
          await db.insert(mgmDegreeDataTable).values({
            stationCode: station.stationCode,
            year,
            month,
            hdd,
            cdd,
          });
        }
        synced++;
      } catch {
        errors++;
      }
    }
  }

  await db.update(mgmSyncLogTable)
    .set({
      finishedAt: new Date(),
      status: errors === 0 ? "success" : "error",
      stationsSynced: synced,
      errorCount: errors,
      notes: `Günlük sync tamamlandı (${DATA_VERSION}).`,
    })
    .where(eq(mgmSyncLogTable.id, logId));

  return { synced, errors };
}

// ── HDD/CDD lookup for a station and period ───────────────────────
export async function lookupDegreeData(
  stationCode: string,
  year: number,
  month: number
): Promise<{ hdd: number; cdd: number } | null> {
  const rows = await db.select({ hdd: mgmDegreeDataTable.hdd, cdd: mgmDegreeDataTable.cdd })
    .from(mgmDegreeDataTable)
    .where(and(
      eq(mgmDegreeDataTable.stationCode, stationCode),
      eq(mgmDegreeDataTable.year, year),
      eq(mgmDegreeDataTable.month, month),
    ))
    .limit(1);

  if (rows.length > 0) return rows[0];
  return null;
}

// ── Daily scheduler ───────────────────────────────────────────────
let schedulerStarted = false;

export function startMgmDailyScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  const runSync = async () => {
    console.log("[MGM] Günlük sync başladı...");
    const result = await syncCurrentMonthData();
    console.log(`[MGM] Günlük sync tamamlandı: ${result.synced} güncellendi, ${result.errors} hata.`);
  };

  setTimeout(() => {
    runSync().catch(err => console.error("[MGM] Scheduler hatası:", err));
  }, 60 * 1000);

  setInterval(() => {
    runSync().catch(err => console.error("[MGM] Scheduler hatası:", err));
  }, TWENTY_FOUR_HOURS);

  console.log("[MGM] Günlük scheduler başlatıldı.");
}
