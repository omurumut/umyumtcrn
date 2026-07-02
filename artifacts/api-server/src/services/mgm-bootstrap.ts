/**
 * MGM Referans Veri Bootstrap
 *
 * Uygulama başlarken (migration'dan sonra, app.listen'dan önce) çalışır.
 * İdempotent: yeterli kayıt varsa atlar, yoksa Excel'den import eder.
 *
 * Startup sırası: migrations → bootstrapMgmReferenceData() → app.listen → scheduler
 *
 * process.exit() KULLANILMAZ — hata loglanır, API yine de başlar.
 */

import { existsSync } from "fs";
import { db, weatherDegreeDaysTable, mgmStationMappingsTable } from "@workspace/db";
import { eq, and, count, sql } from "drizzle-orm";
import {
  importStationMapping,
  importDegreeDays,
  DEFAULT_MAPPING_FILE,
  DEFAULT_DEGREE_DAYS_FILE,
} from "./mgm-excel-import.js";
import { logger } from "../lib/logger.js";

// Minimum beklenen kayıt eşikleri
const MIN_STATION_MAPPINGS = 200;        // Excel'de 254 istasyon var
const MIN_OFFICIAL_DEGREE_DAYS = 20_000; // Excel'de ~30 000 kayıt var

export type MgmBootstrapStatus = "ok" | "skipped" | "partial" | "failed";

export interface MgmBootstrapResult {
  status: MgmBootstrapStatus;
  mappingCount: number;
  degreeDayCount: number;
  errors: string[];
}

// Modül düzeyinde durum — lookup endpoint'leri "veri yok" vs "bootstrap başarısız" ayırt edebilsin
let _bootstrapStatus: MgmBootstrapStatus = "skipped";
let _bootstrapRan = false;

export function getMgmBootstrapStatus(): MgmBootstrapStatus {
  return _bootstrapStatus;
}

export function wasMgmBootstrapRun(): boolean {
  return _bootstrapRan;
}

// ── Yardımcı: kayıt sayıları ─────────────────────────────────────────
async function getMappingCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(mgmStationMappingsTable);
  return Number(row?.n ?? 0);
}

async function getOfficialDegreeDayCount(): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(weatherDegreeDaysTable)
    .where(and(
      eq(weatherDegreeDaysTable.isOfficial, true),
      eq(weatherDegreeDaysTable.periodType, "monthly"),
    ));
  return Number(row?.n ?? 0);
}

// ── Indexleri oluştur / doğrula ──────────────────────────────────────
async function ensureIndexes(): Promise<void> {
  logger.info("[MGM Bootstrap] Indexler kontrol ediliyor...");

  // Partial unique index: ON CONFLICT için zorunlu. Bu olmadan import satırları sessizce başarısız olur.
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "wdd_station_key_year_month_official_idx"
    ON "weather_degree_days"("station_key", "year", "month")
    WHERE "station_key" IS NOT NULL
      AND "year" IS NOT NULL
      AND "month" IS NOT NULL
      AND "is_official" = true
  `);

  // Performans indexleri
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "wdd_station_key_year_idx"
    ON "weather_degree_days"("station_key", "year", "month")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "wdd_province_district_year_idx"
    ON "weather_degree_days"("province", "district", "year", "month")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "wdd_station_name_year_month_idx"
    ON "weather_degree_days"("station_name", "year", "month")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "idx_mgm_station_mappings_province"
    ON "mgm_station_mappings"("province")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "idx_mgm_station_mappings_province_district"
    ON "mgm_station_mappings"("province", "district")
  `);

  logger.info("[MGM Bootstrap] Indexler hazır.");
}

// ── Doğrulama sorguları ve raporlama ────────────────────────────────
async function runVerificationQueries(): Promise<void> {
  try {
    // Mapping sayısı
    const [mappingRow] = await db.select({ cnt: count() }).from(mgmStationMappingsTable);
    const mappingTotal = Number(mappingRow?.cnt ?? 0);

    // Resmi aylık kayıt sayısı
    const [ddRow] = await db
      .select({ cnt: count() })
      .from(weatherDegreeDaysTable)
      .where(and(
        eq(weatherDegreeDaysTable.isOfficial, true),
        eq(weatherDegreeDaysTable.periodType, "monthly"),
      ));
    const ddTotal = Number(ddRow?.cnt ?? 0);

    // Yıl aralığı ve istasyon sayısı
    const rangeRows = await db
      .select({
        minYear: sql<number>`MIN(${weatherDegreeDaysTable.year})`,
        maxYear: sql<number>`MAX(${weatherDegreeDaysTable.year})`,
        stations: sql<number>`COUNT(DISTINCT ${weatherDegreeDaysTable.stationKey})`,
      })
      .from(weatherDegreeDaysTable)
      .where(eq(weatherDegreeDaysTable.isOfficial, true));
    const range = rangeRows[0];

    logger.info(
      `[MGM Bootstrap] Doğrulama: mapping=${mappingTotal}, ` +
      `resmi_aylık=${ddTotal}, ` +
      `yıl_aralığı=${range?.minYear ?? "?"}–${range?.maxYear ?? "?"}, ` +
      `istasyon_sayısı=${range?.stations ?? "?"}`
    );

    // Van 2024 kontrolü
    const vanRows = await db
      .select({
        month: weatherDegreeDaysTable.month,
        hdd: weatherDegreeDaysTable.hdd,
        cdd: weatherDegreeDaysTable.cdd,
      })
      .from(weatherDegreeDaysTable)
      .where(and(
        eq(weatherDegreeDaysTable.stationKey as any, "van"),
        eq(weatherDegreeDaysTable.year as any, 2024),
        eq(weatherDegreeDaysTable.isOfficial, true),
      ))
      .orderBy(weatherDegreeDaysTable.month as any);

    if (vanRows.length > 0) {
      const jan = vanRows.find((r) => Number(r.month) === 1);
      const feb = vanRows.find((r) => Number(r.month) === 2);
      logger.info(
        `[MGM Bootstrap] Van 2024 kontrolü: ` +
        `Ocak HDD=${jan?.hdd ?? "?"} (beklenen: 528), ` +
        `Şubat HDD=${feb?.hdd ?? "?"} (beklenen: 498)`
      );
      if (jan && Number(jan.hdd) !== 528) {
        logger.warn(`[MGM Bootstrap] ⚠️  Van 2024 Ocak HDD beklenenle uyuşmuyor: ${jan.hdd} ≠ 528`);
      }
    } else {
      logger.warn("[MGM Bootstrap] ⚠️  Van 2024 resmi verisi bulunamadı — doğrulama atlandı.");
    }
  } catch (err) {
    logger.warn(`[MGM Bootstrap] Doğrulama sorgusu hatası (kritik değil): ${err}`);
  }
}

// ── Ana bootstrap fonksiyonu ─────────────────────────────────────────
export async function bootstrapMgmReferenceData(): Promise<MgmBootstrapResult> {
  _bootstrapRan = true;
  const errors: string[] = [];

  logger.info("[MGM Bootstrap] === MGM Referans Veri Bootstrap Başlıyor ===");
  logger.info(`[MGM Bootstrap] Mapping dosyası: ${DEFAULT_MAPPING_FILE} (${existsSync(DEFAULT_MAPPING_FILE) ? "mevcut" : "YOK"})`);
  logger.info(`[MGM Bootstrap] Degree days dosyası: ${DEFAULT_DEGREE_DAYS_FILE} (${existsSync(DEFAULT_DEGREE_DAYS_FILE) ? "mevcut" : "YOK"})`);

  // ── 1. Indexleri oluştur ──────────────────────────────────────────
  try {
    await ensureIndexes();
  } catch (err) {
    const msg = `Index oluşturma hatası: ${err}`;
    logger.error(`[MGM Bootstrap] KRİTİK: ${msg}`);
    errors.push(msg);
    _bootstrapStatus = "failed";
    return { status: "failed", mappingCount: 0, degreeDayCount: 0, errors };
  }

  // ── 2. Station Mapping ────────────────────────────────────────────
  let mappingCount = 0;
  try {
    mappingCount = await getMappingCount();

    if (mappingCount < MIN_STATION_MAPPINGS) {
      if (mappingCount > 0) {
        logger.warn(
          `[MGM Bootstrap] Station mapping: ${mappingCount} kayıt mevcut ` +
          `(minimum ${MIN_STATION_MAPPINGS}), yeniden import ediliyor...`
        );
      } else {
        logger.info("[MGM Bootstrap] Station mapping: tablo boş, Excel'den import başlıyor...");
      }

      if (!existsSync(DEFAULT_MAPPING_FILE)) {
        throw new Error(`Mapping Excel dosyası bulunamadı: ${DEFAULT_MAPPING_FILE}`);
      }

      const result = await importStationMapping(DEFAULT_MAPPING_FILE, (msg) => logger.info(msg));

      if (result.errors.length > 0) {
        logger.warn(`[MGM Bootstrap] Mapping import kısmi hatalar: ${result.errors.slice(0, 3).join("; ")}`);
      }

      mappingCount = await getMappingCount();

      if (mappingCount < MIN_STATION_MAPPINGS) {
        throw new Error(
          `Import sonrası mapping sayısı yetersiz: ${mappingCount} < ${MIN_STATION_MAPPINGS}. ` +
          `Hatalar: ${result.errors.slice(0, 2).join("; ")}`
        );
      }

      logger.info(`[MGM Bootstrap] Station mapping tamamlandı: ${mappingCount} kayıt.`);
    } else {
      logger.info(
        `[MGM Bootstrap] Station mapping: ${mappingCount} kayıt mevcut ` +
        `(≥ ${MIN_STATION_MAPPINGS}) — atlanıyor.`
      );
    }
  } catch (err) {
    const msg = `Station mapping hatası: ${err}`;
    logger.error(`[MGM Bootstrap] KRİTİK: ${msg}`);
    errors.push(msg);
  }

  // ── 3. Official Degree Days ───────────────────────────────────────
  let degreeDayCount = 0;
  try {
    degreeDayCount = await getOfficialDegreeDayCount();

    if (degreeDayCount < MIN_OFFICIAL_DEGREE_DAYS) {
      if (degreeDayCount > 0) {
        logger.warn(
          `[MGM Bootstrap] Resmi gün derece: ${degreeDayCount} kayıt mevcut ` +
          `(minimum ${MIN_OFFICIAL_DEGREE_DAYS}), import tamamlanıyor...`
        );
      } else {
        logger.info("[MGM Bootstrap] Resmi gün derece: kayıt yok, Excel'den import başlıyor...");
      }

      if (!existsSync(DEFAULT_DEGREE_DAYS_FILE)) {
        throw new Error(`Degree days Excel dosyası bulunamadı: ${DEFAULT_DEGREE_DAYS_FILE}`);
      }

      const result = await importDegreeDays(DEFAULT_DEGREE_DAYS_FILE, (msg) => logger.info(msg));

      if (result.errors.length > 0) {
        logger.warn(`[MGM Bootstrap] Degree days import kısmi hatalar: ${result.errors.slice(0, 3).join("; ")}`);
      }

      degreeDayCount = await getOfficialDegreeDayCount();

      if (degreeDayCount < MIN_OFFICIAL_DEGREE_DAYS) {
        throw new Error(
          `Import sonrası resmi gün derece sayısı yetersiz: ${degreeDayCount} < ${MIN_OFFICIAL_DEGREE_DAYS}. ` +
          `Hatalar: ${result.errors.slice(0, 2).join("; ")}`
        );
      }

      logger.info(`[MGM Bootstrap] Resmi gün derece tamamlandı: ${degreeDayCount} kayıt.`);
    } else {
      logger.info(
        `[MGM Bootstrap] Resmi gün derece: ${degreeDayCount} kayıt mevcut ` +
        `(≥ ${MIN_OFFICIAL_DEGREE_DAYS}) — atlanıyor.`
      );
    }
  } catch (err) {
    const msg = `Degree days hatası: ${err}`;
    logger.error(`[MGM Bootstrap] KRİTİK: ${msg}`);
    errors.push(msg);
  }

  // ── 4. Doğrulama sorguları ────────────────────────────────────────
  await runVerificationQueries();

  // ── 5. Sonuç ─────────────────────────────────────────────────────
  const mappingOk = mappingCount >= MIN_STATION_MAPPINGS;
  const ddOk = degreeDayCount >= MIN_OFFICIAL_DEGREE_DAYS;

  if (errors.length === 0 && mappingOk && ddOk) {
    _bootstrapStatus = "ok";
    logger.info(
      `[MGM Bootstrap] === TAMAMLANDI (ok): ` +
      `${mappingCount} mapping, ${degreeDayCount} resmi gün derece ===`
    );
  } else if (!mappingOk && !ddOk) {
    _bootstrapStatus = "failed";
    logger.error(
      `[MGM Bootstrap] === BAŞARISIZ (failed): ` +
      `mapping=${mappingCount}/${MIN_STATION_MAPPINGS}, ` +
      `dd=${degreeDayCount}/${MIN_OFFICIAL_DEGREE_DAYS}. ` +
      `Hatalar: ${errors.join(" | ")} ===`
    );
  } else {
    _bootstrapStatus = "partial";
    logger.warn(
      `[MGM Bootstrap] === KISMİ (partial): ` +
      `mapping=${mappingCount}/${MIN_STATION_MAPPINGS} (${mappingOk ? "✓" : "✗"}), ` +
      `dd=${degreeDayCount}/${MIN_OFFICIAL_DEGREE_DAYS} (${ddOk ? "✓" : "✗"}). ` +
      `Hatalar: ${errors.join(" | ")} ===`
    );
  }

  return { status: _bootstrapStatus, mappingCount, degreeDayCount, errors };
}
