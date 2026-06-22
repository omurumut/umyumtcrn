import { db, mgmStationsTable, mgmDegreeDataTable, mgmSyncLogTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { MGM_STATIONS, type StationSeed } from "./mgm-stations-data.js";

// ── MGM Resmi Baz Sıcaklıkları ─────────────────────────────────────
// HDD: T ≤ 15°C eşiği   CDD: T > 22°C eşiği
const HDD_BASE = 15;
const CDD_BASE = 22;

// Veri kaynağı versiyonu — değiştiğinde DB yeniden seed edilir
const DATA_VERSION = "v6_openmeteo_filter_fixed";

// ── Open-Meteo Archive API ─────────────────────────────────────────
const OPEN_METEO_URL = "https://archive-api.open-meteo.com/v1/archive";

interface MonthlyDegreeDay {
  year: number;
  month: number;
  hdd: number;
  cdd: number;
}

async function fetchOpenMeteoMonthly(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string,
  retries = 4
): Promise<MonthlyDegreeDay[]> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    start_date: startDate,
    end_date: endDate,
    daily: "temperature_2m_max,temperature_2m_min",
    timezone: "Europe/Istanbul",
  });

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 2s, 4s, 8s
      await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
    }
    const res = await fetch(`${OPEN_METEO_URL}?${params}`, {
      headers: { "User-Agent": "EMS-EnYS/1.0" },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 429) {
      lastError = new Error("Open-Meteo 429 rate limit");
      continue;
    }
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    // Success — continue to parse below
    const data = (await res.json()) as {
      daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[] };
    };
    const { time, temperature_2m_max: tmax, temperature_2m_min: tmin } = data.daily;
    const monthly = new Map<string, { hdd: number; cdd: number; days: number }>();
    for (let i = 0; i < time.length; i++) {
      if (tmax[i] == null || tmin[i] == null) continue;
      const parts = time[i].split("-");
      const y = parseInt(parts[0]);
      const m = parseInt(parts[1]);
      const key = `${y}-${m}`;
      if (!monthly.has(key)) monthly.set(key, { hdd: 0, cdd: 0, days: 0 });
      const entry = monthly.get(key)!;
      const tmean = (tmax[i] + tmin[i]) / 2;
      entry.hdd += Math.max(HDD_BASE - tmean, 0);
      entry.cdd += Math.max(tmean - CDD_BASE, 0);
      entry.days++;
    }
    return [...monthly.entries()]
      .filter(([, v]) => v.days > 15)
      .map(([key, v]) => { const [y, m] = key.split("-").map(Number); return { year: y, month: m, hdd: Math.round(v.hdd * 10) / 10, cdd: Math.round(v.cdd * 10) / 10 }; });
  }
  throw lastError ?? new Error("fetchOpenMeteoMonthly failed after retries");
}

// ── Fallback: Sentetik hesaplama (API başarısız olursa) ─────────────
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function stationSigma(station: StationSeed, month: number): number {
  const altFactor = Math.min(station.alt / 600, 2.5);
  const isWinter = month === 12 || month <= 2;
  const isSummer = month >= 6 && month <= 8;
  const isCoastal = station.lat < 38 && station.alt < 300;
  if (isWinter) return Math.min(4.0 + altFactor, 8.0);
  if (isSummer) return Math.min(3.0 + altFactor * 0.5, 5.5) + (isCoastal ? -0.5 : 0);
  return Math.min(3.5 + altFactor * 0.8, 6.5);
}

function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  return x >= 0 ? 1 - p : p;
}

function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function syntheticHddCdd(
  station: StationSeed,
  year: number,
  month: number,
  days: number
): { hdd: number; cdd: number } {
  const climateMean = station.monthlyMeanTemps[month - 1];
  const warmingOffset = Math.max(0, (year - 2015) * 0.03);
  const seed = parseInt(station.stationCode) * 100000 + year * 100 + month;
  const variability = (seededRandom(seed) - 0.5) * 1.0;
  const actualMeanTemp = climateMean + warmingOffset + variability;
  const sigma = stationSigma(station, month);

  const dH = HDD_BASE - actualMeanTemp;
  const hdd = Math.max(0, Math.round((dH * normalCDF(dH / sigma) + sigma * normalPDF(dH / sigma)) * days * 10) / 10);
  const dC = actualMeanTemp - CDD_BASE;
  const cdd = Math.max(0, Math.round((dC * normalCDF(dC / sigma) + sigma * normalPDF(dC / sigma)) * days * 10) / 10);

  return { hdd, cdd };
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function daysInMonth(month: number, year: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return DAYS_IN_MONTH[month - 1];
}

// ── Veri versiyonu kontrolü ────────────────────────────────────────
async function isDataVersionCurrent(): Promise<boolean> {
  const log = await db.select({ notes: mgmSyncLogTable.notes })
    .from(mgmSyncLogTable)
    .where(eq(mgmSyncLogTable.status, "seed_version" as any))
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

// ── Seed/reseed degree data (Open-Meteo + fallback) ───────────────
export async function seedDegreeDataIfEmpty(): Promise<void> {
  const isCurrent = await isDataVersionCurrent();
  if (isCurrent) return;

  // Eski veri varsa temizle
  const existing = await db.select({ id: mgmDegreeDataTable.id }).from(mgmDegreeDataTable).limit(1);
  if (existing.length > 0) {
    console.log("[MGM] Eski veri temizleniyor (Open-Meteo gerçek veri ile değiştiriliyor)...");
    await db.delete(mgmDegreeDataTable);
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  const startYear = currentYear - 10;
  const startDate = `${startYear}-01-01`;
  const endDate = `${currentYear}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  console.log(`[MGM] Open-Meteo'dan ${startDate} → ${endDate} aralığı çekiliyor (${MGM_STATIONS.length} istasyon)...`);

  const logEntry = await db.insert(mgmSyncLogTable).values({
    status: "running",
    notes: `Seed ${DATA_VERSION}: ${startDate} → ${endDate}`,
  }).returning();
  const logId = logEntry[0].id;

  let totalInserted = 0;
  let apiSuccess = 0;
  let apiFallback = 0;

  // Sıralı istekler (rate limit'i aşmamak için)
  for (let i = 0; i < MGM_STATIONS.length; i++) {
    const station = MGM_STATIONS[i];
    let monthly: MonthlyDegreeDay[];
    let source: "api" | "synthetic";

    try {
      monthly = await fetchOpenMeteoMonthly(station.lat, station.lon, startDate, endDate);
      source = "api";
      apiSuccess++;
    } catch {
      // API başarısız → sentetik hesap
      monthly = [];
      for (let y = startYear; y <= currentYear; y++) {
        const maxM = y === currentYear ? now.getMonth() : 12;
        for (let m = 1; m <= maxM; m++) {
          const days = daysInMonth(m, y);
          const { hdd, cdd } = syntheticHddCdd(station, y, m, days);
          monthly.push({ year: y, month: m, hdd, cdd });
        }
      }
      source = "synthetic";
      apiFallback++;
    }

    if (monthly.length > 0) {
      const batch = monthly.map(({ year, month, hdd, cdd }) => ({ stationCode: station.stationCode, year, month, hdd, cdd }));
      await db.insert(mgmDegreeDataTable).values(batch).onConflictDoNothing();
      totalInserted += batch.length;
    }

    if ((i + 1) % 10 === 0 || i === MGM_STATIONS.length - 1) {
      console.log(`[MGM] ${i + 1}/${MGM_STATIONS.length} istasyon işlendi (${totalInserted} kayıt, ${apiSuccess} API, ${apiFallback} sentetik)...`);
    }

    // Open-Meteo rate limit: istasyonlar arası bekleme
    if (i < MGM_STATIONS.length - 1) {
      await new Promise(r => setTimeout(r, source === "api" ? 600 : 50));
    }
  }

  await db.update(mgmSyncLogTable)
    .set({
      finishedAt: new Date(),
      status: "success",
      stationsSynced: MGM_STATIONS.length,
      notes: `Seed ${DATA_VERSION} tamamlandı: ${totalInserted} kayıt (${apiSuccess} API, ${apiFallback} sentetik).`,
    })
    .where(eq(mgmSyncLogTable.id, logId));

  await markDataVersionCurrent();
  console.log(`[MGM] Seed tamamlandı (${DATA_VERSION}): ${totalInserted} kayıt — ${apiSuccess} istasyon Open-Meteo, ${apiFallback} sentetik.`);
}

// ── Daily sync: current & previous month (Open-Meteo) ─────────────
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

  // Önceki ay başından bugüne kadar veri çek
  const fetchStart = `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;
  const fetchEnd = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const BATCH_SIZE = 6;
  for (let i = 0; i < MGM_STATIONS.length; i += BATCH_SIZE) {
    const chunk = MGM_STATIONS.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      chunk.map(async station => {
        try {
          const monthly = await fetchOpenMeteoMonthly(station.lat, station.lon, fetchStart, fetchEnd);
          return { station, monthly };
        } catch {
          // Fallback sentetik
          const monthly: MonthlyDegreeDay[] = [];
          for (const { year, month } of [{ year: prevYear, month: prevMonth }, { year: currentYear, month: currentMonth }]) {
            const days = daysInMonth(month, year);
            const { hdd, cdd } = syntheticHddCdd(station, year, month, days);
            monthly.push({ year, month, hdd, cdd });
          }
          return { station, monthly };
        }
      })
    );

    for (const result of results) {
      if (result.status !== "fulfilled") { errors++; continue; }
      const { station, monthly } = result.value;

      for (const { year, month, hdd, cdd } of monthly) {
        try {
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
            await db.insert(mgmDegreeDataTable).values({ stationCode: station.stationCode, year, month, hdd, cdd });
          }
          synced++;
        } catch {
          errors++;
        }
      }
    }

    if (i + BATCH_SIZE < MGM_STATIONS.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  await db.update(mgmSyncLogTable)
    .set({
      finishedAt: new Date(),
      status: errors === 0 ? "success" : "error",
      stationsSynced: synced,
      errorCount: errors,
      notes: `Günlük sync tamamlandı (${DATA_VERSION}). ${fetchStart} → ${fetchEnd}`,
    })
    .where(eq(mgmSyncLogTable.id, logId));

  return { synced, errors };
}

// ── HDD/CDD lookup ─────────────────────────────────────────────────
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
  return rows.length > 0 ? rows[0] : null;
}

// ── Daily scheduler ────────────────────────────────────────────────
let schedulerStarted = false;

export function startMgmDailyScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const runSync = async () => {
    console.log("[MGM] Günlük sync başladı (Open-Meteo)...");
    const result = await syncCurrentMonthData();
    console.log(`[MGM] Günlük sync tamamlandı: ${result.synced} güncellendi, ${result.errors} hata.`);
  };

  // Server hazır olduktan 2 dakika sonra başlat (seed tamamlandıktan sonra)
  setTimeout(() => {
    runSync().catch(err => console.error("[MGM] Scheduler hatası:", err));
  }, 2 * 60 * 1000);

  setInterval(() => {
    runSync().catch(err => console.error("[MGM] Scheduler hatası:", err));
  }, 24 * 60 * 60 * 1000);

  console.log("[MGM] Günlük scheduler başlatıldı (Open-Meteo tabanlı).");
}
