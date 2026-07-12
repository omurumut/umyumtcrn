import { Router } from "express";
import { db, mgmStationsTable, mgmDegreeDataTable, mgmSyncLogTable, weatherDegreeDaysTable, mgmStationMappingsTable } from "@workspace/db";
import { desc, eq, and, sql } from "drizzle-orm";
import { requireAuth, requireSuperAdmin } from "../middlewares/auth.js";
import { syncCurrentMonthData, lookupOfficialWeatherDegreeDay, lookupOfficialByStationKey, toStationKey, lookupStationKeyByLocation } from "../services/mgm-sync.js";
import { MGM_STATIONS, findStationByCity, parseIlIlce, findNearestStation, haversineDistance } from "../services/mgm-stations-data.js";
import { syncOfficialDegreeDays } from "../services/mgm-official-sync.js";
import { importStationMapping, importDegreeDays, DEFAULT_MAPPING_FILE, DEFAULT_DEGREE_DAYS_FILE } from "../services/mgm-excel-import.js";
import { getMgmBootstrapStatus } from "../services/mgm-bootstrap.js";

const router = Router();

// GET /api/mgm/stations — Tüm MGM istasyonları
router.get("/mgm/stations", requireAuth, async (req, res) => {
  try {
    const rows = await db.select().from(mgmStationsTable).orderBy(mgmStationsTable.il);
    res.json(rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// GET /api/mgm/lookup — Şehir için HDD/CDD değerini getir (YALNIZCA resmi MGM verisi)
// Query: city, year, month
// Response alanları:
//   stationFound: boolean
//   weatherDataMethod: "official_monthly" | "no_official_data" | "district_station_not_found" | "station_not_found"
//   matchType: "exact" | "normalized" | "alias" | "fuzzy" | null
//   matchedStationName: string | null
//   originalCity: string
//   fallbackStation: { stationKey, stationName } | null
router.get("/mgm/lookup", requireAuth, async (req, res) => {
  try {
    const { city, year, month } = req.query;
    if (!year || !month) {
      res.status(400).json({ error: "year ve month zorunlu" });
      return;
    }
    if (!city) {
      res.status(400).json({ error: "city gerekli" });
      return;
    }

    const yr = parseInt(year as string);
    const mo = parseInt(month as string);

    if (isNaN(yr) || isNaN(mo) || mo < 1 || mo > 12) {
      res.status(400).json({ error: "Geçersiz yıl/ay" });
      return;
    }

    const requestedCity = city as string;
    const { il, ilce } = parseIlIlce(requestedCity);

    // ── 1. İlçe bazlı eşleşme (exact → normalized → alias → fuzzy) ──
    if (ilce) {
      const mapping = await lookupStationKeyByLocation(il, ilce);
      if (mapping) {
        const data = await lookupOfficialByStationKey(mapping.stationKey, yr, mo);
        if (data) {
          const aliasNote = (mapping.matchType === "alias" || mapping.matchType === "fuzzy")
            ? `Girilen sayaç lokasyonu MGM kayıtlarında farklı yazımla eşleşti: ${mapping.stationName ?? mapping.matchedDistrict}.`
            : null;
          res.json({
            stationFound: true,
            weatherDataMethod: "official_monthly",
            stationName: mapping.stationName ?? data.stationName ?? ilce,
            matchType: mapping.matchType,
            matchScore: mapping.matchScore ?? null,
            matchedStationName: mapping.stationName ?? null,
            originalCity: requestedCity,
            year: yr, month: mo,
            hdd: data.hdd, cdd: data.cdd,
            note: aliasNote ?? data.stationNote ?? null,
            fallbackStation: null,
            dataMethod: "official_monthly",
          });
          return;
        }
        // İstasyon bulundu ama bu yıl/ay için veri yok
        // il merkezi fallback bilgisini hazırla
        const ilFallback = await lookupStationKeyByLocation(il, null);
        res.json({
          stationFound: true,
          weatherDataMethod: "no_official_data",
          stationName: mapping.stationName ?? ilce,
          matchType: mapping.matchType,
          matchScore: mapping.matchScore ?? null,
          matchedStationName: mapping.stationName ?? null,
          originalCity: requestedCity,
          year: yr, month: mo,
          hdd: null, cdd: null,
          note: "MGM merkezi bulundu ancak seçilen dönem için resmi HDD/CDD verisi bulunamadı.",
          fallbackStation: ilFallback ? { stationKey: ilFallback.stationKey, stationName: ilFallback.stationName } : null,
          dataMethod: "no_official_data",
          bootstrapStatus: getMgmBootstrapStatus(),
        });
        return;
      }

      // İlçe istasyonu bulunamadı — il merkezi çok-adımlı otomatik fallback
      // Adım 1: mgm_station_mappings → il merkezi
      const ilFallbackMapping = await lookupStationKeyByLocation(il, null);
      if (ilFallbackMapping) {
        const ilData = await lookupOfficialByStationKey(ilFallbackMapping.stationKey, yr, mo);
        if (ilData) {
          res.json({
            stationFound: true,
            weatherDataMethod: "official_monthly",
            stationName: ilFallbackMapping.stationName ?? il,
            matchType: "province_center",
            matchScore: null,
            matchedStationName: ilFallbackMapping.stationName ?? null,
            originalCity: requestedCity,
            year: yr, month: mo,
            hdd: ilData.hdd, cdd: ilData.cdd,
            note: `Seçilen ilçe (${ilce}) için MGM gün-derece verisi bulunamadı. HDD/CDD değerleri ${il} Merkez verisine göre alınmıştır. Gerekirse manuel düzenleyebilirsiniz.`,
            usedProvinceFallback: true,
            fallbackStation: null,
            dataMethod: "official_monthly",
          });
          return;
        }
      }
      // Adım 2: station_key slug ile il merkezi
      const ilKey = toStationKey(il, null);
      const slugData = await lookupOfficialByStationKey(ilKey, yr, mo);
      if (slugData) {
        res.json({
          stationFound: true,
          weatherDataMethod: "official_monthly",
          stationName: slugData.stationName ?? il,
          matchType: "province_center",
          matchScore: null,
          matchedStationName: slugData.stationName ?? null,
          originalCity: requestedCity,
          year: yr, month: mo,
          hdd: slugData.hdd, cdd: slugData.cdd,
          note: `Seçilen ilçe (${ilce}) için MGM gün-derece verisi bulunamadı. HDD/CDD değerleri ${il} Merkez verisine göre alınmıştır. Gerekirse manuel düzenleyebilirsiniz.`,
          usedProvinceFallback: true,
          fallbackStation: null,
          dataMethod: "official_monthly",
        });
        return;
      }
      // Adım 3: province text match
      const provData = await lookupOfficialWeatherDegreeDay(il, yr, mo);
      if (provData) {
        res.json({
          stationFound: true,
          weatherDataMethod: "official_monthly",
          stationName: provData.stationName ?? il,
          matchType: "province_center",
          matchScore: null,
          matchedStationName: provData.stationName ?? null,
          originalCity: requestedCity,
          year: yr, month: mo,
          hdd: provData.hdd, cdd: provData.cdd,
          note: `Seçilen ilçe (${ilce}) için MGM gün-derece verisi bulunamadı. HDD/CDD değerleri ${il} Merkez verisine göre alınmıştır. Gerekirse manuel düzenleyebilirsiniz.`,
          usedProvinceFallback: true,
          fallbackStation: null,
          dataMethod: "official_monthly",
        });
        return;
      }
      res.json({
        stationFound: false,
        weatherDataMethod: "no_official_data",
        stationName: null,
        matchType: null,
        matchedStationName: null,
        originalCity: requestedCity,
        year: yr, month: mo,
        hdd: null, cdd: null,
        note: "Bu lokasyon için MGM gün-derece verisi bulunamadı. HDD/CDD değerlerini manuel girebilirsiniz.",
        usedProvinceFallback: false,
        fallbackStation: null,
        dataMethod: "no_official_data",
        bootstrapStatus: getMgmBootstrapStatus(),
      });
      return;
    }

    // ── 2. İl merkezi eşleşmesi (ilçe yok) ──
    const mappingByIl = await lookupStationKeyByLocation(il, null);
    if (mappingByIl) {
      const data = await lookupOfficialByStationKey(mappingByIl.stationKey, yr, mo);
      if (data) {
        res.json({
          stationFound: true,
          weatherDataMethod: "official_monthly",
          stationName: mappingByIl.stationName ?? data.stationName ?? il,
          matchType: mappingByIl.matchType,
          matchScore: mappingByIl.matchScore ?? null,
          matchedStationName: mappingByIl.stationName ?? null,
          originalCity: requestedCity,
          year: yr, month: mo,
          hdd: data.hdd, cdd: data.cdd,
          note: data.stationNote ?? null,
          fallbackStation: null,
          dataMethod: "official_monthly",
        });
        return;
      }
      // İstasyon bulundu ama veri yok
      res.json({
        stationFound: true,
        weatherDataMethod: "no_official_data",
        stationName: mappingByIl.stationName ?? il,
        matchType: mappingByIl.matchType,
        matchScore: mappingByIl.matchScore ?? null,
        matchedStationName: mappingByIl.stationName ?? null,
        originalCity: requestedCity,
        year: yr, month: mo,
        hdd: null, cdd: null,
        note: "MGM merkezi bulundu ancak seçilen dönem için resmi HDD/CDD verisi bulunamadı.",
        fallbackStation: null,
        dataMethod: "no_official_data",
        bootstrapStatus: getMgmBootstrapStatus(),
      });
      return;
    }

    // ── 3. station_key slug fallback (eski kayıtlar / demo verisi) ──
    const ilKey = toStationKey(il, null);
    const officialByIl = await lookupOfficialByStationKey(ilKey, yr, mo);
    if (officialByIl) {
      res.json({
        stationFound: true,
        weatherDataMethod: "official_monthly",
        stationName: officialByIl.stationName ?? il,
        matchType: "exact",
        matchScore: null,
        matchedStationName: officialByIl.stationName ?? null,
        originalCity: requestedCity,
        year: yr, month: mo,
        hdd: officialByIl.hdd, cdd: officialByIl.cdd,
        note: officialByIl.stationNote ?? null,
        fallbackStation: null,
        dataMethod: "official_monthly",
      });
      return;
    }

    // ── 4. Province text match (eski kayıtlar için geriye uyum) ──
    const officialByProv = await lookupOfficialWeatherDegreeDay(il, yr, mo);
    if (officialByProv) {
      res.json({
        stationFound: true,
        weatherDataMethod: "official_monthly",
        stationName: officialByProv.stationName ?? il,
        matchType: "exact",
        matchScore: null,
        matchedStationName: officialByProv.stationName ?? null,
        originalCity: requestedCity,
        year: yr, month: mo,
        hdd: officialByProv.hdd, cdd: officialByProv.cdd,
        note: officialByProv.stationNote ?? null,
        fallbackStation: null,
        dataMethod: "official_monthly",
      });
      return;
    }

    // ── 5. Hiç istasyon ve veri bulunamadı ──
    res.json({
      stationFound: false,
      weatherDataMethod: "station_not_found",
      stationName: null,
      matchType: null,
      matchedStationName: null,
      originalCity: requestedCity,
      year: yr, month: mo,
      hdd: null, cdd: null,
      note: "Sayaç lokasyonu için MGM merkezi bulunamadı.",
      fallbackStation: null,
      dataMethod: "station_not_found",
      bootstrapStatus: getMgmBootstrapStatus(),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// GET /api/mgm/lookup-by-location — Lat/lon ile en yakın istasyonu bul + HDD/CDD getir (YALNIZCA resmi MGM verisi)
router.get("/mgm/lookup-by-location", requireAuth, async (req, res) => {
  try {
    const { lat, lon, city, year, month } = req.query;
    if (!year || !month) {
      res.status(400).json({ error: "year ve month zorunlu" });
      return;
    }

    const yr = parseInt(year as string);
    const mo = parseInt(month as string);

    let targetStation: (typeof MGM_STATIONS)[0] | null = null;
    let usedNearest = false;
    let note: string | null = null;
    let nearestKm: number | null = null;

    if (city) {
      const found = findStationByCity(city as string);
      if (found) targetStation = found;
    }

    if (!targetStation && lat && lon) {
      const latNum = parseFloat(lat as string);
      const lonNum = parseFloat(lon as string);
      targetStation = findNearestStation(latNum, lonNum);
      if (city) {
        usedNearest = true;
        nearestKm = Math.round(haversineDistance(latNum, lonNum, targetStation.lat, targetStation.lon));
        note = `"${city}" için MGM istasyonu bulunamadı. En yakın istasyon "${targetStation.name}" kullanıldı.${nearestKm ? ` (${nearestKm} km uzaklıkta)` : ""}`;
      }
    }

    if (!targetStation) {
      res.status(400).json({ error: "Lokasyon belirlenemedi, lat/lon veya city gerekli" });
      return;
    }

    // Resmi MGM verisi: station_key slug ile ara (YALNIZCA is_official=true)
    const stationKey = toStationKey(targetStation.il, targetStation.ilce ?? null);
    const officialData = await lookupOfficialByStationKey(stationKey, yr, mo);

    if (!officialData) {
      // Province text match fallback
      const officialByProv = await lookupOfficialWeatherDegreeDay(targetStation.il, yr, mo);
      if (officialByProv) {
        res.json({
          stationCode: targetStation.stationCode,
          stationName: officialByProv.stationName ?? targetStation.name,
          il: targetStation.il,
          lat: targetStation.lat,
          lon: targetStation.lon,
          year: yr, month: mo,
          hdd: officialByProv.hdd, cdd: officialByProv.cdd,
          usedNearest, nearestKm,
          note: officialByProv.stationNote ?? note,
          dataMethod: "official_monthly",
        });
        return;
      }

      // Resmi veri yok — Open-Meteo/sentetik fallback KULLANILMIYOR
      res.json({
        stationCode: targetStation.stationCode,
        stationName: targetStation.name,
        il: targetStation.il,
        lat: targetStation.lat,
        lon: targetStation.lon,
        year: yr, month: mo,
        hdd: null, cdd: null,
        usedNearest, nearestKm,
        note: `Bu istasyon ("${targetStation.name}") ve dönem (${yr}/${mo}) için resmi MGM HDD/CDD verisi bulunamadı.`,
        dataMethod: "no_official_data",
        bootstrapStatus: getMgmBootstrapStatus(),
      });
      return;
    }

    res.json({
      stationCode: targetStation.stationCode,
      stationName: officialData.stationName ?? targetStation.name,
      il: targetStation.il,
      lat: targetStation.lat,
      lon: targetStation.lon,
      year: yr, month: mo,
      hdd: officialData.hdd, cdd: officialData.cdd,
      usedNearest, nearestKm,
      note: officialData.stationNote ?? note,
      dataMethod: "official_monthly",
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// GET /api/mgm/sync-log — Son sync logları
router.get("/mgm/sync-log", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(mgmSyncLogTable)
      .orderBy(desc(mgmSyncLogTable.startedAt))
      .limit(20);
    res.json(rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/mgm/sync — Manuel Open-Meteo sync tetikle (admin only)
router.post("/mgm/sync", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const result = await syncCurrentMonthData();
    res.json({
      message: "Open-Meteo sync tamamlandı",
      synced: result.synced,
      errors: result.errors,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sync hatası" });
  }
});

// POST /api/admin/weather-degree-days/sync — MGM Resmi Gün Derece Havuzu senkronizasyonu
// Admin/superadmin erişebilir. Body: { year?: number } veya { years?: number[] }
router.post("/admin/weather-degree-days/sync", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const now = new Date();
    const currentYear = now.getFullYear();

    let years: number[];
    if (req.body?.years && Array.isArray(req.body.years)) {
      years = req.body.years.map(Number).filter((y: number) => !isNaN(y));
    } else if (req.body?.year) {
      years = [parseInt(req.body.year)];
    } else {
      // Default: mevcut yıl ve önceki yıl
      years = [currentYear - 1, currentYear];
    }

    const logs: string[] = [];
    const onProgress = (msg: string) => {
      logs.push(msg);
      req.log.info(msg);
    };

    const results = await syncOfficialDegreeDays(years, onProgress);

    const summary = results.map(r =>
      `${r.year}: +${r.inserted} eklendi, ~${r.updated} güncellendi, ${r.stationCount} istasyon, ${r.errors} hata`
    );

    res.json({
      message: "MGM resmi gün derece senkronizasyonu tamamlandı",
      years,
      results,
      summary,
      logs,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "MGM resmi sync hatası" });
  }
});

// GET /api/mgm/degree-data — İstasyon bazlı HDD/CDD verileri
router.get("/mgm/degree-data", requireAuth, async (req, res) => {
  try {
    const { stationCode, year } = req.query;
    if (!stationCode) {
      res.status(400).json({ error: "stationCode zorunlu" });
      return;
    }

    const rows = await db.select().from(mgmDegreeDataTable)
      .where(eq(mgmDegreeDataTable.stationCode, stationCode as string))
      .orderBy(mgmDegreeDataTable.year, mgmDegreeDataTable.month);

    const filtered = year ? rows.filter(r => r.year === parseInt(year as string)) : rows;
    res.json(filtered);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/admin/mgm/station-mapping/import-excel
// Repo içindeki mgm_station_mapping_checked.xlsx dosyasını mgm_station_mappings tablosuna import eder
router.post("/admin/mgm/station-mapping/import-excel", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const filePath = req.body?.filePath ?? DEFAULT_MAPPING_FILE;
    const logs: string[] = [];
    const onProgress = (msg: string) => {
      logs.push(msg);
      req.log.info(msg);
    };

    const result = await importStationMapping(filePath, onProgress);
    res.json({
      message: "MGM istasyon eşleştirme import tamamlandı",
      filePath,
      ...result,
      logs,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: `Import hatası: ${String(err)}` });
  }
});

// POST /api/admin/weather-degree-days/import-excel
// Repo içindeki mgm_degree_days_last_10_years_final.xlsx dosyasını weather_degree_days tablosuna import eder
router.post("/admin/weather-degree-days/import-excel", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const filePath = req.body?.filePath ?? DEFAULT_DEGREE_DAYS_FILE;
    const logs: string[] = [];
    const onProgress = (msg: string) => {
      logs.push(msg);
      req.log.info(msg);
    };

    const result = await importDegreeDays(filePath, onProgress);
    res.json({
      message: "MGM gün derece import tamamlandı",
      filePath,
      ...result,
      logs,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: `Import hatası: ${String(err)}` });
  }
});

// GET /api/admin/mgm/station-mappings — İstasyon eşleştirme listesi (admin)
router.get("/admin/mgm/station-mappings", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { province, search } = req.query;
    let rows = await db.select().from(mgmStationMappingsTable)
      .orderBy(mgmStationMappingsTable.province, mgmStationMappingsTable.district);

    if (province) {
      rows = rows.filter(r => r.province?.toLowerCase().includes((province as string).toLowerCase()));
    }
    if (search) {
      const q = (search as string).toLowerCase();
      rows = rows.filter(r =>
        r.stationKey.toLowerCase().includes(q) ||
        r.stationName?.toLowerCase().includes(q) ||
        r.province?.toLowerCase().includes(q) ||
        r.district?.toLowerCase().includes(q)
      );
    }
    res.json(rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// GET /api/admin/weather-degree-days — Resmi MGM veri listesi (admin)
router.get("/admin/weather-degree-days", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { year, province } = req.query;
    const rows = await db.select().from(weatherDegreeDaysTable)
      .where(eq(weatherDegreeDaysTable.isOfficial, true))
      .orderBy(weatherDegreeDaysTable.province, weatherDegreeDaysTable.year as any, weatherDegreeDaysTable.month as any);

    let filtered = rows;
    if (year) filtered = filtered.filter(r => r.year === parseInt(year as string));
    if (province) filtered = filtered.filter(r => r.province?.toLowerCase().includes((province as string).toLowerCase()));

    res.json(filtered);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
