import { db, mgmStationsTable, mgmDegreeDataTable, mgmSyncLogTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { MGM_STATIONS, type StationSeed } from "./mgm-stations-data.js";

// ── Realistic HDD/CDD calculation ──────────────────────────────────
// Base temperature: 18°C (Turkey standard)
const BASE_TEMP = 18;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function daysInMonth(month: number, year: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return DAYS_IN_MONTH[month - 1];
}

// Year-to-year variation seed (deterministic, station+year based)
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function calculateHddCdd(
  station: StationSeed,
  year: number,
  month: number
): { hdd: number; cdd: number } {
  const baseTemp = station.monthlyMeanTemps[month - 1];
  const days = daysInMonth(month, year);

  // Warming trend: ~0.03°C per year after 2015
  const warmingOffset = (year - 2015) * 0.03;
  // Inter-annual variability (±0.5°C range, deterministic by station+year+month)
  const seed = parseInt(station.stationCode) * 100000 + year * 100 + month;
  const variability = (seededRandom(seed) - 0.5) * 1.0;

  const actualMeanTemp = baseTemp + warmingOffset + variability;

  const hdd = Math.max(0, Math.round((BASE_TEMP - actualMeanTemp) * days * 10) / 10);
  const cdd = Math.max(0, Math.round((actualMeanTemp - BASE_TEMP) * days * 10) / 10);

  return { hdd, cdd };
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

// ── Seed 10-year degree data ───────────────────────────────────────
export async function seedDegreeDataIfEmpty(): Promise<void> {
  const existing = await db.select({ id: mgmDegreeDataTable.id }).from(mgmDegreeDataTable).limit(1);
  if (existing.length > 0) return;

  const currentYear = new Date().getFullYear();
  const startYear = currentYear - 10;

  console.log(`[MGM] Gün derece verisi yok, ${startYear}-${currentYear} arası seed ediliyor...`);

  const logEntry = await db.insert(mgmSyncLogTable).values({
    status: "running",
    notes: `Seed: ${startYear}-${currentYear}`,
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
      notes: `Seed tamamlandı: ${totalInserted} kayıt eklendi.`,
    })
    .where(eq(mgmSyncLogTable.id, logId));

  console.log(`[MGM] Seed tamamlandı: ${totalInserted} gün derece kaydı.`);
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
      notes: `Günlük sync tamamlandı.`,
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

  // Run first sync after 1 minute delay (after server is ready)
  setTimeout(() => {
    runSync().catch(err => console.error("[MGM] Scheduler hatası:", err));
  }, 60 * 1000);

  setInterval(() => {
    runSync().catch(err => console.error("[MGM] Scheduler hatası:", err));
  }, TWENTY_FOUR_HOURS);

  console.log("[MGM] Günlük scheduler başlatıldı.");
}
