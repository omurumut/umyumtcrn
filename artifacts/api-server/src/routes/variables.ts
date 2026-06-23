import { Router } from "express";
import { db, variablesTable, variableValuesTable, weatherDegreeDaysTable, companiesTable, unitsTable, subUnitsTable, metersTable, mgmStationsTable, mgmDegreeDataTable } from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";

const router = Router();

// ── Variables ─────────────────────────────────────────────

// GET /api/variables
router.get("/variables", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : undefined;

    const rows = await db.select().from(variablesTable).orderBy(variablesTable.createdAt);

    const filtered = rows.filter(v => {
      if (role === "superadmin" && companyId !== undefined) return v.companyId === companyId;
      if (role !== "superadmin") return v.companyId === sessionCompanyId;
      return true;
    });

    res.json(filtered);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/variables
router.post("/variables", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    const { name, code, category, unitLabel, variableType, sourceType, scopeType, description, isActive } = req.body;

    if (!name || !category) {
      res.status(400).json({ error: "Ad ve kategori zorunludur" }); return;
    }

    const targetCompanyId = role === "superadmin" && req.body.companyId
      ? parseInt(req.body.companyId)
      : sessionCompanyId;

    const [variable] = await db.insert(variablesTable).values({
      companyId: targetCompanyId,
      name,
      code: code || null,
      category: category || "operational",
      unitLabel: unitLabel || null,
      variableType: variableType || "numeric",
      sourceType: sourceType || "operation_manual",
      scopeType: scopeType || "company",
      description: description || null,
      isSystemVariable: false,
      isActive: isActive !== undefined ? isActive : true,
    }).returning();

    res.status(201).json(variable);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PUT /api/variables/:id
router.put("/variables/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    const id = parseInt(req.params.id as string);

    const [existing] = await db.select().from(variablesTable).where(eq(variablesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Değişken bulunamadı" }); return; }

    if (role !== "superadmin" && existing.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    const { name, code, category, unitLabel, variableType, sourceType, scopeType, description, isActive } = req.body;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (code !== undefined) updates.code = code || null;
    if (category !== undefined) updates.category = category;
    if (unitLabel !== undefined) updates.unitLabel = unitLabel || null;
    if (variableType !== undefined) updates.variableType = variableType;
    if (sourceType !== undefined && !existing.isSystemVariable) updates.sourceType = sourceType;
    if (scopeType !== undefined) updates.scopeType = scopeType;
    if (description !== undefined) updates.description = description || null;
    if (isActive !== undefined) updates.isActive = isActive;

    const [updated] = await db.update(variablesTable).set(updates).where(eq(variablesTable.id, id)).returning();
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/variables/:id
router.delete("/variables/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    const id = parseInt(req.params.id as string);

    const [existing] = await db.select().from(variablesTable).where(eq(variablesTable.id, id));
    if (!existing) { res.status(404).send(); return; }

    if (role !== "superadmin" && existing.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    if (existing.isSystemVariable) {
      res.status(403).json({ error: "Sistem değişkenleri silinemez" }); return;
    }

    await db.delete(variablesTable).where(eq(variablesTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── Variable Values ───────────────────────────────────────

// GET /api/variable-values
router.get("/variable-values", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    const variableId = req.query.variableId ? parseInt(req.query.variableId as string) : undefined;
    const unitId = req.query.unitId ? parseInt(req.query.unitId as string) : undefined;
    const subUnitId = req.query.subUnitId ? parseInt(req.query.subUnitId as string) : undefined;
    const meterId = req.query.meterId ? parseInt(req.query.meterId as string) : undefined;

    const rows = await db
      .select({
        id: variableValuesTable.id,
        companyId: variableValuesTable.companyId,
        variableId: variableValuesTable.variableId,
        unitId: variableValuesTable.unitId,
        subUnitId: variableValuesTable.subUnitId,
        meterId: variableValuesTable.meterId,
        periodStart: variableValuesTable.periodStart,
        periodEnd: variableValuesTable.periodEnd,
        periodType: variableValuesTable.periodType,
        value: variableValuesTable.value,
        source: variableValuesTable.source,
        locationProvince: variableValuesTable.locationProvince,
        locationDistrict: variableValuesTable.locationDistrict,
        dataQuality: variableValuesTable.dataQuality,
        createdAt: variableValuesTable.createdAt,
        updatedAt: variableValuesTable.updatedAt,
        variableName: variablesTable.name,
        variableCode: variablesTable.code,
        variableUnitLabel: variablesTable.unitLabel,
        unitName: unitsTable.name,
        subUnitName: subUnitsTable.name,
        meterName: metersTable.name,
      })
      .from(variableValuesTable)
      .leftJoin(variablesTable, eq(variableValuesTable.variableId, variablesTable.id))
      .leftJoin(unitsTable, eq(variableValuesTable.unitId, unitsTable.id))
      .leftJoin(subUnitsTable, eq(variableValuesTable.subUnitId, subUnitsTable.id))
      .leftJoin(metersTable, eq(variableValuesTable.meterId, metersTable.id))
      .orderBy(variableValuesTable.periodStart);

    const filtered = rows.filter(v => {
      if (role !== "superadmin" && v.companyId !== sessionCompanyId) return false;
      if (variableId !== undefined && v.variableId !== variableId) return false;
      if (unitId !== undefined && v.unitId !== unitId) return false;
      if (subUnitId !== undefined && v.subUnitId !== subUnitId) return false;
      if (meterId !== undefined && v.meterId !== meterId) return false;
      return true;
    });

    res.json(filtered);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/variable-values
router.post("/variable-values", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    const { variableId, unitId, subUnitId, meterId, periodStart, periodEnd, periodType, value, source, locationProvince, locationDistrict, dataQuality } = req.body;

    if (!variableId || !periodStart || !periodEnd || value === undefined || value === null) {
      res.status(400).json({ error: "Zorunlu alanlar eksik" }); return;
    }

    const [variable] = await db.select().from(variablesTable).where(eq(variablesTable.id, parseInt(variableId)));
    if (!variable) { res.status(400).json({ error: "Değişken bulunamadı" }); return; }

    const targetCompanyId = variable.companyId;
    if (role !== "superadmin" && targetCompanyId !== sessionCompanyId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    const [record] = await db.insert(variableValuesTable).values({
      companyId: targetCompanyId,
      variableId: parseInt(variableId),
      unitId: unitId ? parseInt(unitId) : null,
      subUnitId: subUnitId ? parseInt(subUnitId) : null,
      meterId: meterId ? parseInt(meterId) : null,
      periodStart,
      periodEnd,
      periodType: periodType || "monthly",
      value: parseFloat(value),
      source: source || null,
      locationProvince: locationProvince || null,
      locationDistrict: locationDistrict || null,
      dataQuality: dataQuality || null,
    }).returning();

    res.status(201).json(record);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PUT /api/variable-values/:id
router.put("/variable-values/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    const id = parseInt(req.params.id as string);

    const [existing] = await db.select().from(variableValuesTable).where(eq(variableValuesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Kayıt bulunamadı" }); return; }

    if (role !== "superadmin" && existing.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    const { periodStart, periodEnd, periodType, value, source, locationProvince, locationDistrict, dataQuality, unitId, subUnitId, meterId } = req.body;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (periodStart !== undefined) updates.periodStart = periodStart;
    if (periodEnd !== undefined) updates.periodEnd = periodEnd;
    if (periodType !== undefined) updates.periodType = periodType;
    if (value !== undefined) updates.value = parseFloat(value);
    if (source !== undefined) updates.source = source || null;
    if (locationProvince !== undefined) updates.locationProvince = locationProvince || null;
    if (locationDistrict !== undefined) updates.locationDistrict = locationDistrict || null;
    if (dataQuality !== undefined) updates.dataQuality = dataQuality || null;
    if (unitId !== undefined) updates.unitId = unitId ? parseInt(unitId) : null;
    if (subUnitId !== undefined) updates.subUnitId = subUnitId ? parseInt(subUnitId) : null;
    if (meterId !== undefined) updates.meterId = meterId ? parseInt(meterId) : null;

    const [updated] = await db.update(variableValuesTable).set(updates).where(eq(variableValuesTable.id, id)).returning();
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/variable-values/:id
router.delete("/variable-values/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    const id = parseInt(req.params.id as string);

    const [existing] = await db.select().from(variableValuesTable).where(eq(variableValuesTable.id, id));
    if (!existing) { res.status(404).send(); return; }

    if (role !== "superadmin" && existing.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    await db.delete(variableValuesTable).where(eq(variableValuesTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── Weather Degree Days ───────────────────────────────────

// GET /api/weather-degree-days
router.get("/weather-degree-days", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    const province = req.query.province as string | undefined;
    const periodType = req.query.periodType as string | undefined;
    const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : undefined;

    const rows = await db.select().from(weatherDegreeDaysTable).orderBy(weatherDegreeDaysTable.date);

    const filtered = rows.filter(r => {
      if (role !== "superadmin") {
        if (r.companyId !== null && r.companyId !== sessionCompanyId) return false;
      } else if (companyId !== undefined) {
        if (r.companyId !== null && r.companyId !== companyId) return false;
      }
      if (province && r.province !== province) return false;
      if (periodType && r.periodType !== periodType) return false;
      return true;
    });

    res.json(filtered);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/weather-degree-days/sync
// MGM pool'dan sayaçların bulunduğu şehirlerin HDD/CDD verisini weather_degree_days tablosuna aktarır
router.post("/weather-degree-days/sync", requireAuth, async (req, res) => {
  try {
    const { companyId } = req.user!;

    // 1. Bu şirketin birimlerine bağlı tüm sayaçları ve şehirlerini bul
    const unitRows = await db
      .select({ id: unitsTable.id })
      .from(unitsTable)
      .where(eq(unitsTable.companyId, companyId));

    if (unitRows.length === 0) {
      res.json({ synced: 0, provinces: [], message: "Kayıtlı birim bulunamadı" });
      return;
    }

    const unitIds = unitRows.map(u => u.id);

    const subUnitRows = await db
      .select({ id: subUnitsTable.id })
      .from(subUnitsTable)
      .where(inArray(subUnitsTable.unitId, unitIds));

    const subUnitIds = subUnitRows.map(s => s.id);

    if (subUnitIds.length === 0) {
      res.json({ synced: 0, provinces: [], message: "Kayıtlı alt birim bulunamadı" });
      return;
    }

    const meterRows = await db
      .select({ city: metersTable.city })
      .from(metersTable)
      .where(inArray(metersTable.subUnitId, subUnitIds));

    const cities = [...new Set(meterRows.map(m => m.city.trim()).filter(Boolean))];

    if (cities.length === 0) {
      res.json({ synced: 0, provinces: [], message: "Sayaçlara bağlı şehir bulunamadı" });
      return;
    }

    // 2. MGM istasyonlarından bu şehirlere uyan istasyonları bul (il bazlı, case-insensitive)
    const allStations = await db.select().from(mgmStationsTable).where(eq(mgmStationsTable.isActive, true));

    // city → stationCode eşleştirmesi (şehir adı normalize edilerek)
    const normalize = (s: string) =>
      s.toLocaleLowerCase("tr-TR").replace(/[İ]/g, "i").replace(/[I]/g, "ı").trim();

    const matchedStations = allStations.filter(station =>
      cities.some(city => normalize(city) === normalize(station.il))
    );

    if (matchedStations.length === 0) {
      res.json({
        synced: 0,
        provinces: [],
        message: `Sayaç şehirleri MGM istasyonlarında eşleşmedi (Aranan: ${cities.join(", ")})`,
      });
      return;
    }

    const stationCodes = matchedStations.map(s => s.stationCode);

    // 3. Bu istasyonların tüm degree verisini çek
    const degreeRows = await db
      .select()
      .from(mgmDegreeDataTable)
      .where(inArray(mgmDegreeDataTable.stationCode, stationCodes));

    if (degreeRows.length === 0) {
      res.json({ synced: 0, provinces: [], message: "MGM pool henüz dolu değil, lütfen bekleyin" });
      return;
    }

    // stationCode → station bilgisi haritası
    const stationMap = new Map(matchedStations.map(s => [s.stationCode, s]));

    // 4. Mevcut kayıtları temizle (ilgili şehirler + bu şirket)
    const provinceList = [...new Set(matchedStations.map(s => s.il))];
    await db
      .delete(weatherDegreeDaysTable)
      .where(
        and(
          eq(weatherDegreeDaysTable.companyId, companyId),
          inArray(weatherDegreeDaysTable.province, provinceList),
          eq(weatherDegreeDaysTable.periodType, "monthly"),
          eq(weatherDegreeDaysTable.source, "mgm")
        )
      );

    // 5. Yeni kayıtları toplu ekle
    const toInsert = degreeRows.map(row => {
      const station = stationMap.get(row.stationCode)!;
      return {
        companyId,
        province: station.il,
        district: station.ilce ?? null,
        date: `${row.year}-${String(row.month).padStart(2, "0")}`,
        periodType: "monthly" as const,
        baseTemperatureHeating: 15,
        baseTemperatureCooling: 22,
        hdd: row.hdd,
        cdd: row.cdd,
        avgTemperature: null,
        source: "mgm",
      };
    });

    // Toplu insert — 500'lük dilimler
    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      await db.insert(weatherDegreeDaysTable).values(toInsert.slice(i, i + CHUNK));
      inserted += Math.min(CHUNK, toInsert.length - i);
    }

    res.json({
      synced: inserted,
      provinces: provinceList,
      stations: matchedStations.length,
      message: `${provinceList.join(", ")} için ${inserted} aylık HDD/CDD kaydı aktarıldı`,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
