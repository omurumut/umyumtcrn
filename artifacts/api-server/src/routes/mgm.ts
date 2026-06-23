import { Router } from "express";
import { db, mgmStationsTable, mgmDegreeDataTable, mgmSyncLogTable } from "@workspace/db";
import { desc, eq, and } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";
import { syncCurrentMonthData, lookupDegreeData } from "../services/mgm-sync.js";
import { MGM_STATIONS, findStationByCity, findStationByIlIlce, parseIlIlce, findNearestStation, haversineDistance } from "../services/mgm-stations-data.js";

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

// GET /api/mgm/lookup — Şehir/istasyon için HDD/CDD değerini getir
// Query: city | stationCode, year, month
router.get("/mgm/lookup", requireAuth, async (req, res) => {
  try {
    const { city, stationCode, year, month } = req.query;
    if (!year || !month) {
      res.status(400).json({ error: "year ve month zorunlu" });
      return;
    }

    const yr = parseInt(year as string);
    const mo = parseInt(month as string);

    if (isNaN(yr) || isNaN(mo) || mo < 1 || mo > 12) {
      res.status(400).json({ error: "Geçersiz yıl/ay" });
      return;
    }

    let targetCode: string | null = null;
    let stationName: string | null = null;
    let note: string | null = null;
    let usedNearest = false;
    const nearestKm: number | null = null;

    if (stationCode) {
      // Direkt istasyon kodu ile sorgu
      targetCode = stationCode as string;
      const st = MGM_STATIONS.find(s => s.stationCode === targetCode);
      stationName = st ? st.name : targetCode;
    } else if (city) {
      const requestedCity = city as string;
      // "İl / İlçe" formatını parse et; önce birebir il+ilçe, yoksa il bazında fallback
      const { il, ilce } = parseIlIlce(requestedCity);
      const lookup = findStationByIlIlce(il, ilce);
      if (lookup) {
        targetCode = lookup.station.stationCode;
        stationName = lookup.station.name;
        if (lookup.isFallback) {
          note = `"${requestedCity}" için birebir MGM istasyonu bulunamadı. ${il} iline ait "${lookup.station.name}" istasyonu kullanıldı.`;
        }
      } else {
        // İl de bulunamadı → coğrafi merkez fallback
        const nearest = findNearestStation(39.0, 35.0);
        targetCode = nearest.stationCode;
        stationName = nearest.name;
        usedNearest = true;
        note = `"${requestedCity}" için MGM istasyonu bulunamadı. En yakın varsayılan istasyon "${nearest.name}" kullanıldı.`;
      }
    } else {
      res.status(400).json({ error: "city veya stationCode gerekli" });
      return;
    }

    // DB'den veri al
    const data = await lookupDegreeData(targetCode!, yr, mo);
    if (!data) {
      res.status(404).json({ error: "Bu dönem için MGM verisi bulunamadı" });
      return;
    }

    res.json({
      stationCode: targetCode,
      stationName,
      year: yr,
      month: mo,
      hdd: data.hdd,
      cdd: data.cdd,
      usedNearest,
      nearestKm,
      note,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// GET /api/mgm/lookup-by-location — Lat/lon ile en yakın istasyonu bul + HDD/CDD getir
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
      if (found) {
        targetStation = found;
      }
    }

    if (!targetStation && lat && lon) {
      const latNum = parseFloat(lat as string);
      const lonNum = parseFloat(lon as string);
      targetStation = findNearestStation(latNum, lonNum);
      if (city) {
        usedNearest = true;
        nearestKm = Math.round(haversineDistance(latNum, lonNum, targetStation.lat, targetStation.lon));
        note = `"${city}" için MGM verisi bulunamadı. Bu yüzden en yakın istasyon olan "${targetStation.name}" verisi otomatik olarak çekilmiştir.${nearestKm ? ` (${nearestKm} km uzaklıkta)` : ""}`;
      }
    }

    if (!targetStation) {
      res.status(400).json({ error: "Lokasyon belirlenemedi, lat/lon veya city gerekli" });
      return;
    }

    const data = await lookupDegreeData(targetStation.stationCode, yr, mo);
    if (!data) {
      res.status(404).json({ error: "Bu dönem için MGM verisi bulunamadı" });
      return;
    }

    res.json({
      stationCode: targetStation.stationCode,
      stationName: targetStation.name,
      il: targetStation.il,
      lat: targetStation.lat,
      lon: targetStation.lon,
      year: yr,
      month: mo,
      hdd: data.hdd,
      cdd: data.cdd,
      usedNearest,
      nearestKm,
      note,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// GET /api/mgm/sync-log — Son sync logları
router.get("/mgm/sync-log", requireAuth, async (req, res) => {
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

// POST /api/mgm/sync — Manuel sync tetikle (admin only)
router.post("/mgm/sync", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await syncCurrentMonthData();
    res.json({
      message: "Sync tamamlandı",
      synced: result.synced,
      errors: result.errors,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sync hatası" });
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

    let query = db.select().from(mgmDegreeDataTable)
      .where(eq(mgmDegreeDataTable.stationCode, stationCode as string))
      .$dynamic();

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

export default router;
