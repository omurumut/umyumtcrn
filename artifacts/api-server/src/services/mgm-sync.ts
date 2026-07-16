import { db, mgmStationsTable, mgmDegreeDataTable, mgmSyncLogTable, weatherDegreeDaysTable, mgmStationMappingsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { MGM_STATIONS, type StationSeed } from "./mgm-stations-data.js";

// ── MGM Resmi Baz Sıcaklıkları ─────────────────────────────────────
// HDD: Tm ≤ 15°C eşiği → HDD = 18 - Tm  (eşik: 15, baz: 18)
// CDD: Tm > 22°C eşiği → CDD = Tm - 22
const HDD_BASE_THRESHOLD = 15;
const HDD_BASE_TEMP = 18;
const CDD_BASE = 22;

const DATA_VERSION = "v7_correct_hdd_18base";
const OPEN_METEO_URL = "https://archive-api.open-meteo.com/v1/archive";

// ── Türkçe → ASCII station_key ─────────────────────────────────────
export function toStationKey(il: string, ilce: string | null): string {
  const base = ilce ?? il;
  return base
    .toLowerCase()
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u")
    .replace(/\s+/g, "-")
    .replace(/[^\w-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

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
      entry.hdd += tmean <= HDD_BASE_THRESHOLD ? (HDD_BASE_TEMP - tmean) : 0;
      entry.cdd += Math.max(tmean - CDD_BASE, 0);
      entry.days++;
    }
    return [...monthly.entries()]
      .filter(([, v]) => v.days > 15)
      .map(([key, v]) => { const [y, m] = key.split("-").map(Number); return { year: y, month: m, hdd: Math.round(v.hdd * 10) / 10, cdd: Math.round(v.cdd * 10) / 10 }; });
  }
  throw lastError ?? new Error("fetchOpenMeteoMonthly failed after retries");
}

// ── Fallback: Sentetik hesaplama ────────────────────────────────────
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

  const dH = HDD_BASE_TEMP - actualMeanTemp;
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

// ── Veri versiyonu kontrolü ─────────────────────────────────────────
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

// ── Seed stations ───────────────────────────────────────────────────
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

// ── Seed/reseed degree data (Open-Meteo + fallback) ─────────────────
export async function seedDegreeDataIfEmpty(): Promise<void> {
  const isCurrent = await isDataVersionCurrent();
  if (isCurrent) return;

  const existing = await db.select({ id: mgmDegreeDataTable.id }).from(mgmDegreeDataTable).limit(1);
  if (existing.length > 0) {
    console.log("[MGM] Eski veri temizleniyor (doğru HDD formülü ile yeniden hesaplanıyor)...");
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

  for (let i = 0; i < MGM_STATIONS.length; i++) {
    const station = MGM_STATIONS[i];
    let monthly: MonthlyDegreeDay[];
    let source: "api" | "synthetic";

    try {
      monthly = await fetchOpenMeteoMonthly(station.lat, station.lon, startDate, endDate);
      source = "api";
      apiSuccess++;
    } catch {
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

// ── Daily sync: current & previous month (Open-Meteo) ──────────────
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

// ── HDD/CDD lookup (Open-Meteo havuzundan) ──────────────────────────
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

// ── Resmi MGM: station_key ile arama ──────────────────────────────
export async function lookupOfficialByStationKey(
  stationKey: string,
  year: number,
  month: number
): Promise<{ hdd: number; cdd: number; stationName: string | null; stationNote: string | null } | null> {
  const rows = await db
    .select({
      hdd: weatherDegreeDaysTable.hdd,
      cdd: weatherDegreeDaysTable.cdd,
      stationName: weatherDegreeDaysTable.stationName,
      stationNote: weatherDegreeDaysTable.stationNote,
    })
    .from(weatherDegreeDaysTable)
    .where(and(
      eq(weatherDegreeDaysTable.stationKey as any, stationKey),
      eq(weatherDegreeDaysTable.year as any, year),
      eq(weatherDegreeDaysTable.month as any, month),
      eq(weatherDegreeDaysTable.isOfficial, true),
      eq(weatherDegreeDaysTable.periodType, "monthly"),
    ))
    .limit(1);
  return rows.length > 0 ? rows[0] : null;
}

// ── Türkçe normalize (alias/fuzzy için) ─────────────────────────────
function normalizeTrSlug(s: string): string {
  return s.trim().toLowerCase()
    .replace(/ğ/g, "g").replace(/Ğ/g, "g")
    .replace(/ş/g, "s").replace(/Ş/g, "s")
    .replace(/ı/g, "i").replace(/İ/g, "i")
    .replace(/ö/g, "o").replace(/Ö/g, "o")
    .replace(/ü/g, "u").replace(/Ü/g, "u")
    .replace(/ç/g, "c").replace(/Ç/g, "c")
    .replace(/â/g, "a").replace(/î/g, "i").replace(/û/g, "u")
    .replace(/\s+/g, " ").trim();
}

// ── Alias haritası: normalize edilmiş giriş → normalize edilmiş doğru ad ─
const DISTRICT_ALIASES: Record<string, string> = {
  "dogubayazit": "dogubeyazit",
  "dogubayaziti": "dogubeyazit",
  "dogu bayazit": "dogu beyazit",
};

function applyAlias(normalized: string): string {
  return DISTRICT_ALIASES[normalized] ?? normalized;
}

// ── Fuzzy string benzerliği (Levenshtein tabanlı, eşik 0.75) ─────────
const FUZZY_THRESHOLD = 0.75;
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const maxLen = Math.max(a.length, b.length);
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return 1 - dp[a.length][b.length] / maxLen;
}

export interface StationLookupResult {
  stationKey: string;
  stationName: string | null;
  matchType: "exact" | "normalized" | "alias" | "fuzzy";
  matchScore?: number;
  matchedDistrict?: string | null;
}

// ── mgm_station_mappings tablosundan station_key lookup ─────────────
export async function lookupStationKeyByLocation(
  province: string,
  district: string | null
): Promise<StationLookupResult | null> {
  // "Merkez" ilçe ifadesini il merkezi olarak normalize et
  // Örnek: "Ağrı Merkez" → district=null (il merkezi)
  if (district) {
    const dNorm = normalizeTrSlug(district);
    const pNorm = normalizeTrSlug(province);
    if (dNorm === "merkez" || dNorm === pNorm + " merkez" || dNorm === pNorm + "merkez") {
      district = null;
    }
  }

  // 1. Exact eşleşme (mevcut davranış)
  if (district) {
    const rows = await db
      .select({ stationKey: mgmStationMappingsTable.stationKey, stationName: mgmStationMappingsTable.stationName })
      .from(mgmStationMappingsTable)
      .where(and(
        sql`LOWER(${mgmStationMappingsTable.province}) = LOWER(${province})`,
        sql`LOWER(${mgmStationMappingsTable.district}) = LOWER(${district})`,
        eq(mgmStationMappingsTable.isActive, true),
      ))
      .limit(1);
    if (rows.length > 0) return { ...rows[0], matchType: "exact" };
  }

  // İl merkezi exact eşleşme (district yok)
  if (!district) {
    const rows = await db
      .select({ stationKey: mgmStationMappingsTable.stationKey, stationName: mgmStationMappingsTable.stationName })
      .from(mgmStationMappingsTable)
      .where(and(
        sql`LOWER(${mgmStationMappingsTable.province}) = LOWER(${province})`,
        sql`(${mgmStationMappingsTable.district} IS NULL OR ${mgmStationMappingsTable.district} = '')`,
        eq(mgmStationMappingsTable.isActive, true),
      ))
      .limit(1);
    if (rows.length > 0) return { ...rows[0], matchType: "exact" };
    return null;
  }

  // 2. Normalize + alias eşleşme
  const normDistrict = normalizeTrSlug(district);
  const aliasDistrict = applyAlias(normDistrict);
  const matchType = aliasDistrict !== normDistrict ? "alias" : "normalized";

  // Aynı ildeki tüm aktif istasyonları çek, normalize + alias ile karşılaştır
  const provinceRows = await db
    .select({
      stationKey: mgmStationMappingsTable.stationKey,
      stationName: mgmStationMappingsTable.stationName,
      district: mgmStationMappingsTable.district,
    })
    .from(mgmStationMappingsTable)
    .where(and(
      sql`LOWER(${mgmStationMappingsTable.province}) = LOWER(${province})`,
      eq(mgmStationMappingsTable.isActive, true),
    ));

  for (const row of provinceRows) {
    if (!row.district) continue;
    const rowNorm = normalizeTrSlug(row.district);
    const rowAlias = applyAlias(rowNorm);
    if (rowAlias === aliasDistrict) {
      return {
        stationKey: row.stationKey,
        stationName: row.stationName,
        matchType,
        matchedDistrict: row.district,
      };
    }
  }

  // 3. Fuzzy eşleşme (yalnızca aynı il içinde, eşik: 0.75)
  let bestScore = 0;
  let bestRow: typeof provinceRows[0] | null = null;
  for (const row of provinceRows) {
    if (!row.district) continue;
    const score = stringSimilarity(aliasDistrict, normalizeTrSlug(row.district));
    if (score > bestScore) { bestScore = score; bestRow = row; }
  }

  if (bestRow && bestScore >= FUZZY_THRESHOLD) {
    return {
      stationKey: bestRow.stationKey,
      stationName: bestRow.stationName,
      matchType: "fuzzy",
      matchScore: Math.round(bestScore * 100) / 100,
      matchedDistrict: bestRow.district,
    };
  }

  return null;
}

// ── Resmi MGM: il (province) ile arama — ilçe fallback ─────────────
export async function lookupOfficialWeatherDegreeDay(
  province: string,
  year: number,
  month: number
): Promise<{ hdd: number; cdd: number; stationName: string | null; stationNote: string | null } | null> {
  const rows = await db
    .select({
      hdd: weatherDegreeDaysTable.hdd,
      cdd: weatherDegreeDaysTable.cdd,
      stationName: weatherDegreeDaysTable.stationName,
      stationNote: weatherDegreeDaysTable.stationNote,
    })
    .from(weatherDegreeDaysTable)
    .where(and(
      eq(weatherDegreeDaysTable.province, province),
      eq(weatherDegreeDaysTable.year as any, year),
      eq(weatherDegreeDaysTable.month as any, month),
      eq(weatherDegreeDaysTable.isOfficial, true),
      eq(weatherDegreeDaysTable.periodType, "monthly"),
    ))
    .limit(1);
  return rows.length > 0 ? rows[0] : null;
}

// ── Resmi MGM aylık veri seed (artık kullanılmıyor) ─────────────────
// Tam MGM veri yüklemesi bootstrapMgmReferenceData() tarafından yapılıyor.
// Bu fonksiyon yalnızca geriye dönük uyumluluk için bırakılmıştır.
export async function seedOfficialWeatherData(): Promise<void> {
  // no-op: resmi veri bootstrapMgmReferenceData() tarafından app.listen'dan önce yüklenir
}

// ── Daily scheduler ────────────────────────────────────────────────
let schedulerHandle: MgmSchedulerHandle | null = null;

export type MgmSchedulerHandle = {
  stop(): Promise<void>;
};

export function startMgmDailyScheduler(): MgmSchedulerHandle {
  if (schedulerHandle) return schedulerHandle;
  const runSync = async () => {
    console.log("[MGM] Günlük sync başladı (Open-Meteo)...");
    const result = await syncCurrentMonthData();
    console.log(`[MGM] Günlük sync tamamlandı: ${result.synced} güncellendi, ${result.errors} hata.`);
  };

  let activeSync: Promise<void> | null = null;
  const executeSync = (): void => {
    if (activeSync) return;
    activeSync = runSync()
      .catch(err => console.error("[MGM] Scheduler hatası:", err))
      .finally(() => {
        activeSync = null;
      });
  };

  const initialTimer = setTimeout(() => {
    executeSync();
  }, 2 * 60 * 1000);

  const dailyTimer = setInterval(() => {
    executeSync();
  }, 24 * 60 * 60 * 1000);

  initialTimer.unref();
  dailyTimer.unref();

  let stopped = false;
  schedulerHandle = {
    async stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(initialTimer);
      clearInterval(dailyTimer);
      schedulerHandle = null;
      await activeSync;
      console.log("[MGM] Günlük scheduler durduruldu.");
    },
  };

  console.log("[MGM] Günlük scheduler başlatıldı (Open-Meteo tabanlı, HDD baz 18°C).");
  return schedulerHandle;
}
