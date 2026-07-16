import path from "path";
import { fileURLToPath } from "url";
import ExcelJS from "exceljs";
import { db, weatherDegreeDaysTable, mgmStationMappingsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

// Resolve data dir relative to the built bundle (dist/index.mjs → dist/data/mgm-import),
// matching how migrations are resolved in index.ts. Works in both dev (node ./dist/index.mjs)
// and production (node artifacts/api-server/dist/index.mjs from workspace root).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const DATA_DIR = path.resolve(__dirname, "data/mgm-import");
export const DEFAULT_MAPPING_FILE = path.join(DATA_DIR, "mgm_station_mapping_checked.xlsx");
export const DEFAULT_DEGREE_DAYS_FILE = path.join(DATA_DIR, "mgm_degree_days_last_10_years_final.xlsx");

export interface MappingImportResult {
  totalRows: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export interface DegreeDaysImportResult {
  totalRows: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  uniqueStations: number;
  years: number[];
  errors: DegreeDaysImportError[];
}

export interface DegreeDaysImportError {
  rowNumber: number;
  code: string;
  message: string;
}

const POSTGRES_REAL_MAX = 3.4028234663852886e38;
const DECIMAL_PATTERN = /^(?:\d+|\d*\.\d+)$/;

function formulaResult(value: ExcelJS.CellValue | null): unknown {
  if (value && typeof value === "object" && !(value instanceof Date) && "result" in value) {
    return value.result;
  }
  return value;
}

function parseImportDecimal(value: ExcelJS.CellValue | null): number | null {
  const raw = formulaResult(value);
  if (raw === null || raw === undefined || raw === "") return null;
  let parsed: number;
  if (typeof raw === "number") {
    parsed = raw;
  } else if (typeof raw === "string" && DECIMAL_PATTERN.test(raw.trim())) {
    parsed = Number(raw.trim());
  } else {
    return null;
  }
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= POSTGRES_REAL_MAX ? parsed : null;
}

function parseImportPositiveInteger(value: ExcelJS.CellValue | null): number | null {
  const raw = formulaResult(value);
  let parsed: number;
  if (typeof raw === "number") {
    parsed = raw;
  } else if (typeof raw === "string" && /^[1-9]\d*$/.test(raw.trim())) {
    parsed = Number(raw.trim());
  } else {
    return null;
  }
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseImportNonNegativeInteger(value: ExcelJS.CellValue | null): number | null {
  const raw = formulaResult(value);
  let parsed: number;
  if (typeof raw === "number") {
    parsed = raw;
  } else if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    parsed = Number(raw.trim());
  } else {
    return null;
  }
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

// ── Station Mapping Import ───────────────────────────────────────────
export async function importStationMapping(
  filePath: string = DEFAULT_MAPPING_FILE,
  onProgress?: (msg: string) => void
): Promise<MappingImportResult> {
  const log = (msg: string) => { onProgress?.(msg); };
  const result: MappingImportResult = { totalRows: 0, inserted: 0, updated: 0, skipped: 0, failed: 0, errors: [] };

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const ws = wb.getWorksheet("Sheet1") ?? wb.worksheets[0];
  if (!ws) throw new Error("Excel'de Sheet1 bulunamadı");

  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell((cell) => { headers.push(String(cell.value ?? "").trim()); });

  const colIndex = (name: string) => headers.indexOf(name);
  const ci = {
    station_key: colIndex("station_key"),
    station_name: colIndex("station_name"),
    province: colIndex("province"),
    district: colIndex("district"),
    confidence: colIndex("confidence"),
    note: colIndex("note"),
  };

  if (ci.station_key < 0) throw new Error("station_key kolonu bulunamadı");

  const rows: Array<{ stationKey: string; stationName: string | null; province: string | null; district: string | null; confidence: string; note: string | null }> = [];

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const vals = row.values as (ExcelJS.CellValue | undefined)[];
    const get = (idx: number) => idx >= 0 ? (vals[idx + 1] ?? null) : null;
    const str = (v: ExcelJS.CellValue | null) => v != null ? String(v).trim() : null;

    const stationKey = str(get(ci.station_key));
    if (!stationKey) return;

    result.totalRows++;
    rows.push({
      stationKey,
      stationName: str(get(ci.station_name)),
      province: str(get(ci.province)),
      district: str(get(ci.district)) || null,
      confidence: str(get(ci.confidence)) ?? "unknown",
      note: str(get(ci.note)),
    });
  });

  log(`[Mapping] ${rows.length} satır okundu`);

  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    try {
      for (const row of batch) {
        const existing = await db
          .select({ id: mgmStationMappingsTable.id })
          .from(mgmStationMappingsTable)
          .where(eq(mgmStationMappingsTable.stationKey, row.stationKey))
          .limit(1);

        if (existing.length > 0) {
          await db.update(mgmStationMappingsTable)
            .set({
              stationName: row.stationName,
              province: row.province,
              district: row.district,
              confidence: row.confidence,
              note: row.note,
              updatedAt: new Date(),
            })
            .where(eq(mgmStationMappingsTable.id, existing[0].id));
          result.updated++;
        } else {
          await db.insert(mgmStationMappingsTable).values({
            stationKey: row.stationKey,
            stationName: row.stationName,
            province: row.province,
            district: row.district,
            confidence: row.confidence,
            note: row.note,
            isActive: true,
          });
          result.inserted++;
        }
      }
    } catch (err) {
      result.failed += batch.length;
      result.errors.push(String(err));
    }

    if ((i + BATCH) % 500 === 0 || i + BATCH >= rows.length) {
      log(`[Mapping] ${Math.min(i + BATCH, rows.length)}/${rows.length} işlendi`);
    }
  }

  log(`[Mapping] Tamamlandı: +${result.inserted} eklendi, ~${result.updated} güncellendi, ${result.failed} hata`);
  return result;
}

// ── Degree Days Import ───────────────────────────────────────────────
export async function importDegreeDays(
  filePath: string = DEFAULT_DEGREE_DAYS_FILE,
  onProgress?: (msg: string) => void
): Promise<DegreeDaysImportResult> {
  const log = (msg: string) => { onProgress?.(msg); };
  const result: DegreeDaysImportResult = {
    totalRows: 0, inserted: 0, updated: 0, skipped: 0, failed: 0,
    uniqueStations: 0, years: [], errors: [],
  };

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const ws = wb.getWorksheet("mgm_degree_days") ?? wb.worksheets[0];
  if (!ws) throw new Error("Excel'de mgm_degree_days sayfası bulunamadı");

  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell((cell) => { headers.push(String(cell.value ?? "").trim()); });

  const colIndex = (name: string) => headers.indexOf(name);
  const ci = {
    station_key: colIndex("station_key"),
    station_name: colIndex("station_name"),
    province: colIndex("province"),
    district: colIndex("district"),
    year: colIndex("year"),
    month: colIndex("month"),
    hdd: colIndex("hdd"),
    cdd: colIndex("cdd"),
    hdd_days: colIndex("hdd_days"),
    cdd_days: colIndex("cdd_days"),
    annual_hdd: colIndex("annual_hdd"),
    annual_cdd: colIndex("annual_cdd"),
    source: colIndex("source"),
    source_url: colIndex("source_url"),
    is_official: colIndex("is_official"),
    mapping_note: colIndex("mapping_note"),
  };

  if (ci.station_key < 0 || ci.province < 0 || ci.year < 0 || ci.month < 0 || ci.hdd < 0 || ci.cdd < 0) {
    throw new Error("Zorunlu kolonlar (station_key, province, year, month, hdd, cdd) bulunamadı");
  }

  interface RowData {
    rowNumber: number;
    stationKey: string;
    stationName: string | null;
    province: string;
    district: string | null;
    year: number;
    month: number;
    hdd: number;
    cdd: number;
    hddDays: number | null;
    cddDays: number | null;
    annualHdd: number | null;
    annualCdd: number | null;
    source: string;
    sourceUrl: string | null;
    isOfficial: boolean;
    stationNote: string | null;
  }

  const rows: RowData[] = [];
  const stationKeys = new Set<string>();
  const yearSet = new Set<number>();

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    result.totalRows++;
    const vals = row.values as (ExcelJS.CellValue | undefined)[];
    const get = (idx: number) => idx >= 0 ? (vals[idx + 1] ?? null) : null;
    const str = (v: ExcelJS.CellValue | null) => {
      const raw = formulaResult(v);
      return typeof raw === "string" || typeof raw === "number" ? String(raw).trim() || null : null;
    };

    const stationKey = str(get(ci.station_key));
    const year = parseImportPositiveInteger(get(ci.year));
    const month = parseImportPositiveInteger(get(ci.month));
    const province = str(get(ci.province));
    const hdd = parseImportDecimal(get(ci.hdd));
    const cdd = parseImportDecimal(get(ci.cdd));
    const hddDaysRaw = get(ci.hdd_days);
    const cddDaysRaw = get(ci.cdd_days);
    const annualHddRaw = get(ci.annual_hdd);
    const annualCddRaw = get(ci.annual_cdd);
    const hddDays = parseImportNonNegativeInteger(hddDaysRaw);
    const cddDays = parseImportNonNegativeInteger(cddDaysRaw);
    const annualHdd = parseImportDecimal(annualHddRaw);
    const annualCdd = parseImportDecimal(annualCddRaw);
    const hasValue = (value: ExcelJS.CellValue | null) => value !== null && value !== undefined && value !== "";

    const fail = (code: string, message: string) => {
      result.failed++;
      if (result.errors.length < 100) result.errors.push({ rowNumber, code, message });
    };
    if (!stationKey) { fail("MISSING_STATION_KEY", "İstasyon anahtarı zorunludur."); return; }
    if (!province) { fail("MISSING_PROVINCE", "İl bilgisi zorunludur."); return; }
    if (year === null) { fail("INVALID_YEAR", "Yıl değeri geçersizdir."); return; }
    if (month === null || month > 12) { fail("INVALID_MONTH", "Ay değeri 1-12 arasında olmalıdır."); return; }
    if (hdd === null) { fail("INVALID_HDD", "HDD değeri geçersizdir."); return; }
    if (cdd === null) { fail("INVALID_CDD", "CDD değeri geçersizdir."); return; }
    if (hasValue(hddDaysRaw) && hddDays === null) { fail("INVALID_HDD_DAYS", "HDD gün sayısı geçersizdir."); return; }
    if (hasValue(cddDaysRaw) && cddDays === null) { fail("INVALID_CDD_DAYS", "CDD gün sayısı geçersizdir."); return; }
    if (hasValue(annualHddRaw) && annualHdd === null) { fail("INVALID_ANNUAL_HDD", "Yıllık HDD değeri geçersizdir."); return; }
    if (hasValue(annualCddRaw) && annualCdd === null) { fail("INVALID_ANNUAL_CDD", "Yıllık CDD değeri geçersizdir."); return; }

    stationKeys.add(stationKey);
    yearSet.add(year);

    const isOfficialRaw = get(ci.is_official);
    const isOfficial = isOfficialRaw === true || isOfficialRaw === 1 || String(isOfficialRaw).toLowerCase() === "true";

    rows.push({
      rowNumber,
      stationKey,
      stationName: str(get(ci.station_name)),
      province,
      district: str(get(ci.district)) || null,
      year,
      month,
      hdd,
      cdd,
      hddDays,
      cddDays,
      annualHdd,
      annualCdd,
      source: str(get(ci.source)) ?? "MGM",
      sourceUrl: str(get(ci.source_url)),
      isOfficial,
      stationNote: str(get(ci.mapping_note)),
    });
  });

  result.uniqueStations = stationKeys.size;
  result.years = [...yearSet].sort();
  log(`[DegreeDays] ${rows.length} satır okundu, ${stationKeys.size} istasyon, yıllar: ${result.years.join(", ")}`);

  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    for (const row of batch) {
      try {
        const date = `${row.year}-${String(row.month).padStart(2, "0")}`;
        const districtVal = row.district || null;
        const existing = row.isOfficial
          ? await db.select({ id: weatherDegreeDaysTable.id })
            .from(weatherDegreeDaysTable)
            .where(and(
              eq(weatherDegreeDaysTable.stationKey, row.stationKey),
              eq(weatherDegreeDaysTable.year, row.year),
              eq(weatherDegreeDaysTable.month, row.month),
              eq(weatherDegreeDaysTable.isOfficial, true),
            ))
            .limit(1)
          : [];

        await db.execute(sql`
          INSERT INTO weather_degree_days (
            company_id, province, district, station_key, station_code, station_name,
            date, year, month, period_type,
            base_temperature_heating, base_temperature_cooling,
            hdd, cdd, hdd_days, cdd_days, annual_hdd, annual_cdd,
            avg_temperature, source, source_url, is_official, data_method,
            station_note, imported_at, created_at, updated_at
          )
          VALUES (
            NULL,
            ${row.province}, ${districtVal}, ${row.stationKey}, NULL, ${row.stationName},
            ${date}, ${row.year}, ${row.month}, 'monthly',
            18, 22,
            ${row.hdd}, ${row.cdd}, ${row.hddDays}, ${row.cddDays}, ${row.annualHdd}, ${row.annualCdd},
            NULL, ${row.source}, ${row.sourceUrl}, ${row.isOfficial}, 'official_monthly',
            ${row.stationNote}, NOW(), NOW(), NOW()
          )
          ON CONFLICT (station_key, year, month)
            WHERE station_key IS NOT NULL AND year IS NOT NULL AND month IS NOT NULL AND is_official = true
          DO UPDATE SET
            hdd = EXCLUDED.hdd,
            cdd = EXCLUDED.cdd,
            hdd_days = EXCLUDED.hdd_days,
            cdd_days = EXCLUDED.cdd_days,
            annual_hdd = EXCLUDED.annual_hdd,
            annual_cdd = EXCLUDED.annual_cdd,
            province = EXCLUDED.province,
            district = EXCLUDED.district,
            station_name = EXCLUDED.station_name,
            source_url = EXCLUDED.source_url,
            station_note = EXCLUDED.station_note,
            imported_at = NOW(),
            updated_at = NOW()
        `);
        if (existing.length > 0) result.updated++;
        else result.inserted++;
      } catch {
        result.failed++;
        if (result.errors.length < 100) {
          result.errors.push({
            rowNumber: row.rowNumber,
            code: "DATABASE_ERROR",
            message: "Satır veritabanına kaydedilemedi.",
          });
        }
      }
    }

    if ((i + BATCH) % 2000 === 0 || i + BATCH >= rows.length) {
      log(`[DegreeDays] ${Math.min(i + BATCH, rows.length)}/${rows.length} işlendi`);
    }
  }

  log(`[DegreeDays] Tamamlandı: +${result.inserted} eklendi, ~${result.updated} güncellendi, ${result.skipped} atlandı, ${result.failed} hata`);
  return result;
}
