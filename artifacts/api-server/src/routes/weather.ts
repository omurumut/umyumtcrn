import { Router } from "express";
import { db, weatherTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireSuperAdmin } from "../middlewares/auth.js";

const router = Router();

// Istanbul average HDD/CDD data (baseline for Turkish cities)
const cityBaselineHDD: Record<string, number[]> = {
  "Istanbul":    [200, 160, 100, 40,  5,  0,  0,  0,  5,  45, 110, 170],
  "Ankara":      [310, 260, 160, 60, 10,  0,  0,  0,  10, 80, 185, 280],
  "Izmir":       [120, 85,  35,  5,  0,  0,  0,  0,  0,  10, 50,  95],
  "Bursa":       [220, 175, 110, 45,  8,  0,  0,  0,  8,  50, 120, 190],
  "Antalya":     [60,  30,  8,   0,  0,  0,  0,  0,  0,  0,  15,  45],
  "Konya":       [330, 280, 175, 65, 10,  0,  0,  0,  10, 85, 200, 300],
  "Trabzon":     [180, 140, 80,  30,  5,  0,  0,  0,  5,  35, 90, 155],
  "default":     [250, 200, 120, 50,  8,  0,  0,  0,  8,  60, 140, 220],
};

const cityBaselineCDD: Record<string, number[]> = {
  "Istanbul":    [0,   0,   0,   5,  30, 90, 200, 220, 110, 20,  0,   0],
  "Ankara":      [0,   0,   0,   0,  20, 80, 190, 210, 100, 15,  0,   0],
  "Izmir":       [0,   0,   0,   15, 60, 150, 290, 320, 200, 70, 10,  0],
  "Bursa":       [0,   0,   0,   5,  25, 80, 185, 205, 100, 18,  0,   0],
  "Antalya":     [0,   0,   5,   30, 90, 200, 320, 340, 240, 90, 20,  0],
  "Konya":       [0,   0,   0,   5,  25, 85, 200, 225, 110, 20,  0,   0],
  "Trabzon":     [0,   0,   0,   0,  15, 55, 130, 145, 70,  10,  0,   0],
  "default":     [0,   0,   0,   5,  25, 80, 180, 200, 100, 20,  0,   0],
};

function getBaseline(location: string): { hdd: number[], cdd: number[] } {
  for (const city of Object.keys(cityBaselineHDD)) {
    if (location.toLowerCase().includes(city.toLowerCase())) {
      return { hdd: cityBaselineHDD[city], cdd: cityBaselineCDD[city] };
    }
  }
  return { hdd: cityBaselineHDD["default"], cdd: cityBaselineCDD["default"] };
}

// GET /api/weather
router.get("/weather", requireAuth, async (req, res) => {
  try {
    const year = req.query.year ? parseInt(req.query.year as string) : undefined;
    let rows = await db.select().from(weatherTable).orderBy(weatherTable.year, weatherTable.month);
    if (year !== undefined) rows = rows.filter(r => r.year === year);
    res.json(rows.map(r => ({
      id: r.id,
      year: r.year,
      month: r.month,
      hdd: r.hdd,
      cdd: r.cdd,
      location: r.location,
      avgTemp: r.avgTemp,
      createdAt: r.createdAt,
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/weather — fetch from "meteoroloji API" (simulated with baseline data)
router.post("/weather", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { location, year } = req.body;
    if (!location || !year) {
      res.status(400).json({ error: "Lokasyon ve yıl zorunlu" }); return;
    }
    const yr = parseInt(year);
    const baseline = getBaseline(location);

    // Add some year-based variation
    const yearFactor = 1 + (yr - 2020) * 0.005; // slight warming trend

    const results = [];
    for (let month = 1; month <= 12; month++) {
      const idx = month - 1;
      const hdd = Math.max(0, Math.round(baseline.hdd[idx] * (1 + (Math.random() - 0.5) * 0.1) / yearFactor));
      const cdd = Math.max(0, Math.round(baseline.cdd[idx] * (1 + (Math.random() - 0.5) * 0.1) * yearFactor));
      const avgTemp = Math.round((18 - hdd / 20 + cdd / 15) * 10) / 10;

      // Upsert
      const existing = await db.select().from(weatherTable)
        .where(and(eq(weatherTable.year, yr), eq(weatherTable.month, month), eq(weatherTable.location, location)));

      let record;
      if (existing.length > 0) {
        [record] = await db.update(weatherTable)
          .set({ hdd, cdd, avgTemp })
          .where(eq(weatherTable.id, existing[0].id))
          .returning();
      } else {
        [record] = await db.insert(weatherTable).values({ year: yr, month, hdd, cdd, location, avgTemp }).returning();
      }
      results.push({ ...record });
    }
    res.json(results);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
