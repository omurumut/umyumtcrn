import { Router } from "express";
import { db, consumptionTable, metersTable, subUnitsTable, energyUseGroupsTable } from "@workspace/db";
import { eq, and, ne, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";
import { parseIlIlce } from "../services/mgm-stations-data.js";
import { toStationKey, lookupOfficialByStationKey, lookupOfficialWeatherDegreeDay, lookupStationKeyByLocation } from "../services/mgm-sync.js";

const router = Router();

// ── MGM Resmi HDD/CDD lookup — YALNIZCA resmi weather_degree_days ─
interface MgmLookupResult {
  hdd: number;
  cdd: number;
  stationName: string;
  stationNote: string | null;
  dataMethod: "official_monthly";
}

async function autoLookupHddCdd(location: string, year: number, month: number): Promise<MgmLookupResult | null> {
  try {
    const { il, ilce } = parseIlIlce(location);

    // 1. mgm_station_mappings: ilçe bazlı eşleşme
    if (ilce) {
      const mapping = await lookupStationKeyByLocation(il, ilce);
      if (mapping) {
        const data = await lookupOfficialByStationKey(mapping.stationKey, year, month);
        if (data) {
          return {
            hdd: data.hdd,
            cdd: data.cdd,
            stationName: mapping.stationName ?? data.stationName ?? ilce,
            stationNote: data.stationNote ?? null,
            dataMethod: "official_monthly",
          };
        }
      }
    }

    // 2. mgm_station_mappings: il merkezi eşleşmesi
    const mappingByIl = await lookupStationKeyByLocation(il, null);
    if (mappingByIl) {
      const data = await lookupOfficialByStationKey(mappingByIl.stationKey, year, month);
      if (data) {
        const note = ilce
          ? `"${ilce}" için özel MGM istasyonu resmi verisi bulunamadı. ${il} ili merkezi resmi verisi kullanıldı.`
          : null;
        return {
          hdd: data.hdd,
          cdd: data.cdd,
          stationName: mappingByIl.stationName ?? data.stationName ?? il,
          stationNote: data.stationNote ?? note,
          dataMethod: "official_monthly",
        };
      }
    }

    // 3. station_key slug fallback (eski kayıtlar / Van 2024 demo verisi)
    if (ilce) {
      const sk = toStationKey(il, ilce);
      const official = await lookupOfficialByStationKey(sk, year, month);
      if (official) {
        return {
          hdd: official.hdd,
          cdd: official.cdd,
          stationName: official.stationName ?? ilce,
          stationNote: official.stationNote ?? null,
          dataMethod: "official_monthly",
        };
      }
    }

    const ilKey = toStationKey(il, null);
    const officialByIl = await lookupOfficialByStationKey(ilKey, year, month);
    if (officialByIl) {
      const note = ilce
        ? `"${ilce}" için özel MGM istasyonu resmi verisi bulunamadı. ${il} ili merkezi resmi verisi kullanıldı.`
        : null;
      return {
        hdd: officialByIl.hdd,
        cdd: officialByIl.cdd,
        stationName: officialByIl.stationName ?? il,
        stationNote: officialByIl.stationNote ?? note,
        dataMethod: "official_monthly",
      };
    }

    // 4. Province text match (eski kayıtlar için geriye uyum)
    const officialByProv = await lookupOfficialWeatherDegreeDay(il, year, month);
    if (officialByProv) {
      const note = ilce
        ? `"${ilce}" için özel MGM istasyonu resmi verisi bulunamadı. ${il} ili resmi verisi kullanıldı.`
        : null;
      return {
        hdd: officialByProv.hdd,
        cdd: officialByProv.cdd,
        stationName: officialByProv.stationName ?? il,
        stationNote: officialByProv.stationNote ?? note,
        dataMethod: "official_monthly",
      };
    }

    // Resmi MGM verisi bulunamadı — Open-Meteo/sentetik fallback YOK
    return null;
  } catch {
    return null;
  }
}

// GET /api/consumption
router.get("/consumption", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const meterId = req.query.meterId ? parseInt(req.query.meterId as string) : undefined;
    const year = req.query.year ? parseInt(req.query.year as string) : undefined;
    const month = req.query.month ? parseInt(req.query.month as string) : undefined;

    const rows = await db
      .select({
        id: consumptionTable.id,
        companyId: consumptionTable.companyId,
        meterId: consumptionTable.meterId,
        meterName: metersTable.name,
        meterUnitId: metersTable.unitId,
        meterCompanyId: metersTable.companyId,
        meterType: metersTable.type,
        energyUseGroupId: metersTable.energyUseGroupId,
        energyUseGroupName: energyUseGroupsTable.name,
        year: consumptionTable.year,
        month: consumptionTable.month,
        kwh: consumptionTable.kwh,
        tep: consumptionTable.tep,
        co2: consumptionTable.co2,
        hdd: consumptionTable.hdd,
        cdd: consumptionTable.cdd,
        notes: consumptionTable.notes,
        weatherStationName: consumptionTable.weatherStationName,
        weatherStationNote: consumptionTable.weatherStationNote,
        createdAt: consumptionTable.createdAt,
      })
      .from(consumptionTable)
      .leftJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
      .leftJoin(energyUseGroupsTable, eq(metersTable.energyUseGroupId, energyUseGroupsTable.id))
      .orderBy(consumptionTable.year, consumptionTable.month);

    const filtered = rows.filter(r => {
      if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null && r.meterUnitId !== sessionUnitId) return false;
      if (role === "admin" && r.meterCompanyId !== sessionCompanyId) return false;
      if (meterId !== undefined && r.meterId !== meterId) return false;
      if (year !== undefined && r.year !== year) return false;
      if (month !== undefined && r.month !== month) return false;
      return true;
    });

    res.json(filtered.map(({ meterUnitId, meterCompanyId, ...r }) => r));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/consumption
router.post("/consumption", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const { meterId, year, month, kwh, tep, co2, hdd, cdd, notes } = req.body;
    if (!meterId || !year || !month) {
      res.status(400).json({ error: "Zorunlu alanlar eksik" }); return;
    }

    const [meter] = await db.select().from(metersTable).where(eq(metersTable.id, parseInt(meterId)));
    if (!meter) { res.status(404).json({ error: "Sayaç bulunamadı" }); return; }

    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null && meter.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    if (role === "admin" && meter.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Bu sayaca tüketim girme yetkiniz yok" }); return;
    }

    const kwhVal = parseFloat(kwh) || 0;
    const tepVal = tep !== undefined ? parseFloat(tep) : kwhVal * 0.000086;
    const co2Val = co2 !== undefined ? parseFloat(co2) : kwhVal * 0.4;

    const yr = parseInt(year);
    const mo = parseInt(month);

    // Dönem bazlı duplicate kontrolü
    const [dupCheck] = await db
      .select({ id: consumptionTable.id })
      .from(consumptionTable)
      .where(and(
        eq(consumptionTable.companyId, meter.companyId),
        eq(consumptionTable.meterId, meter.id),
        eq(consumptionTable.year, yr),
        eq(consumptionTable.month, mo)
      ));
    if (dupCheck) {
      res.status(409).json({ error: `Bu sayaç ve dönem (${yr}/${mo}) için kayıt zaten mevcut` }); return;
    }

    // HDD/CDD: kullanıcı manuel girdiyse kullan, yoksa YALNIZCA resmi MGM havuzundan çek
    let hddVal: number | null = null;
    let cddVal: number | null = null;
    let weatherStationName: string | null = null;
    let weatherStationNote: string | null = null;
    let weatherDataMethod: string | null = null;

    if (hdd !== undefined && hdd !== null && hdd !== "") {
      hddVal = parseFloat(hdd);
    }
    if (cdd !== undefined && cdd !== null && cdd !== "") {
      cddVal = parseFloat(cdd);
    }

    // Otomatik çekme: hem hdd hem cdd boşsa — YALNIZCA resmi MGM
    if (hddVal === null && cddVal === null && meter.city) {
      const mgmResult = await autoLookupHddCdd(meter.city, yr, mo);
      if (mgmResult) {
        hddVal = mgmResult.hdd;
        cddVal = mgmResult.cdd;
        weatherStationName = mgmResult.stationName;
        weatherStationNote = mgmResult.stationNote;
        weatherDataMethod = mgmResult.dataMethod;
      } else {
        // Resmi MGM verisi yok — Open-Meteo/sentetik fallback KULLANILMIYOR
        weatherDataMethod = "no_official_data";
        weatherStationNote = `Bu dönem (${yr}/${mo}) ve lokasyon ("${meter.city}") için resmi MGM HDD/CDD verisi bulunamadı. Veri senkronizasyonu için yöneticinize başvurun.`;
      }
    }

    const [record] = await db.insert(consumptionTable).values({
      companyId: meter.companyId,
      meterId: meter.id,
      year: yr,
      month: mo,
      kwh: kwhVal,
      tep: tepVal,
      co2: co2Val,
      hdd: hddVal,
      cdd: cddVal,
      notes: notes || null,
      weatherStationName: weatherStationName ?? null,
      weatherStationNote: weatherStationNote ?? null,
    }).returning();

    res.status(201).json({
      ...record,
      meterName: meter.name,
      weatherDataMethod,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PATCH /api/consumption/:id
router.patch("/consumption/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);

    const [existing] = await db
      .select({
        companyId: consumptionTable.companyId,
        meterId: consumptionTable.meterId,
        year: consumptionTable.year,
        month: consumptionTable.month,
        meterUnitId: metersTable.unitId,
        meterCompanyId: metersTable.companyId,
      })
      .from(consumptionTable)
      .leftJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
      .where(eq(consumptionTable.id, id));
    if (!existing) { res.status(404).json({ error: "Kayıt bulunamadı" }); return; }
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null && existing.meterUnitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    if (role === "admin" && existing.meterCompanyId !== sessionCompanyId) {
      res.status(403).json({ error: "Bu kaydı düzenleme yetkiniz yok" }); return;
    }

    const { kwh, tep, co2, hdd, cdd, notes } = req.body;

    // Dönem bazlı duplicate kontrolü (kendi kaydı hariç)
    if (existing.meterId && existing.year && existing.month) {
      const [dupCheck] = await db
        .select({ id: consumptionTable.id })
        .from(consumptionTable)
        .where(and(
          eq(consumptionTable.companyId, existing.companyId!),
          eq(consumptionTable.meterId, existing.meterId),
          eq(consumptionTable.year, existing.year),
          eq(consumptionTable.month, existing.month),
          ne(consumptionTable.id, id)
        ));
      if (dupCheck) {
        res.status(409).json({ error: `Bu sayaç ve dönem (${existing.year}/${existing.month}) için başka bir kayıt zaten mevcut` }); return;
      }
    }
    const updates: Record<string, unknown> = {};
    if (kwh !== undefined) updates.kwh = parseFloat(kwh);
    if (tep !== undefined) updates.tep = parseFloat(tep);
    if (co2 !== undefined) updates.co2 = parseFloat(co2);
    if (hdd !== undefined) updates.hdd = parseFloat(hdd);
    if (cdd !== undefined) updates.cdd = parseFloat(cdd);
    if (notes !== undefined) updates.notes = notes;
    const [record] = await db.update(consumptionTable).set(updates).where(eq(consumptionTable.id, id)).returning();
    res.json(record);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/consumption/batch — toplu içe aktarma
router.post("/consumption/batch", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "Geçerli satır dizisi gerekli" }); return;
    }
    if (rows.length > 5000) {
      res.status(400).json({ error: "En fazla 5000 satır içe aktarılabilir" }); return;
    }

    const allMeters = await db.select().from(metersTable).where(eq(metersTable.companyId, sessionCompanyId));

    let imported = 0;
    const errors: { row: number; message: string }[] = [];

    for (const [i, row] of rows.entries()) {
      const rowNum = i + 1;
      try {
        const meter = allMeters.find(m => {
          if (row.meterId) return m.id === parseInt(String(row.meterId));
          if (row.meterName) return m.name.toLowerCase().trim() === String(row.meterName).toLowerCase().trim();
          return false;
        });
        if (!meter) {
          errors.push({ row: rowNum, message: `Sayaç bulunamadı: "${row.meterName ?? row.meterId}"` });
          continue;
        }
        if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null && meter.unitId !== sessionUnitId) {
          errors.push({ row: rowNum, message: "Bu sayaç için yetkiniz yok" });
          continue;
        }
        const year = parseInt(String(row.year));
        const month = parseInt(String(row.month));
        if (!year || !month || month < 1 || month > 12) {
          errors.push({ row: rowNum, message: "Geçersiz yıl/ay değeri" });
          continue;
        }
        const kwh = parseFloat(String(row.kwh)) || 0;
        const tepFactor = meter.type === "dogalgaz" ? 0.00086 : 0.000086;
        const co2Factor = meter.type === "dogalgaz" ? 0.202 : 0.4;
        const tepVal = row.tep !== undefined && row.tep !== "" ? parseFloat(String(row.tep)) : kwh * tepFactor;
        const co2Val = row.co2 !== undefined && row.co2 !== "" ? parseFloat(String(row.co2)) : kwh * co2Factor;

        let hddVal: number | null = row.hdd !== undefined && row.hdd !== "" ? parseFloat(String(row.hdd)) : null;
        let cddVal: number | null = row.cdd !== undefined && row.cdd !== "" ? parseFloat(String(row.cdd)) : null;

        // Batch'te de HDD/CDD boşsa YALNIZCA resmi MGM'den çek
        if (hddVal === null && cddVal === null && meter.city) {
          const mgmResult = await autoLookupHddCdd(meter.city, year, month);
          if (mgmResult) {
            hddVal = mgmResult.hdd;
            cddVal = mgmResult.cdd;
          }
          // Resmi veri yoksa null bırak — sentetik/Open-Meteo fallback yok
        }

        // Dönem bazlı duplicate kontrolü (batch)
        const [batchDup] = await db
          .select({ id: consumptionTable.id })
          .from(consumptionTable)
          .where(and(
            eq(consumptionTable.companyId, meter.companyId),
            eq(consumptionTable.meterId, meter.id),
            eq(consumptionTable.year, year),
            eq(consumptionTable.month, month)
          ));
        if (batchDup) {
          errors.push({ row: rowNum, message: `Sayaç "${meter.name}" için ${year}/${month} kaydı zaten mevcut (atlandı)` });
          continue;
        }

        await db.execute(sql`
          INSERT INTO consumption
            (company_id, meter_id, year, month, kwh, tep, co2, hdd, cdd, notes)
          VALUES
            (${meter.companyId}, ${meter.id}, ${year}, ${month},
             ${kwh}, ${tepVal}, ${co2Val},
             ${hddVal}, ${cddVal}, ${row.notes ? String(row.notes) : null})
        `);
        imported++;
      } catch (rowErr: any) {
        errors.push({ row: rowNum, message: rowErr?.message ?? "Bilinmeyen hata" });
      }
    }

    res.json({ imported, total: rows.length, errors });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/admin/consumption/refresh-weather — Mevcut tüketim kayıtlarının HDD/CDD'sini yenile
router.post("/admin/consumption/refresh-weather", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    const dryRun = req.body?.dryRun === true;

    // superadmin body.companyId ile hedef şirketi belirleyebilir
    let targetCompanyId: number | null = sessionCompanyId;
    if (role === "superadmin" && req.body?.companyId) {
      targetCompanyId = parseInt(req.body.companyId);
    }

    // Tüm tüketim kayıtlarını sayaç şehriyle birlikte çek
    const baseQuery = db
      .select({
        id: consumptionTable.id,
        year: consumptionTable.year,
        month: consumptionTable.month,
        hdd: consumptionTable.hdd,
        city: metersTable.city,
        meterCompanyId: metersTable.companyId,
      })
      .from(consumptionTable)
      .leftJoin(metersTable, eq(consumptionTable.meterId, metersTable.id));

    const records = targetCompanyId !== null
      ? await baseQuery.where(eq(metersTable.companyId, targetCompanyId))
      : await baseQuery;

    let updated = 0;
    let noData = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const rec of records) {
      if (!rec.city) { skipped++; continue; }
      try {
        const mgmResult = await autoLookupHddCdd(rec.city, rec.year, rec.month);

        if (dryRun) {
          if (mgmResult) updated++;
          else noData++;
          continue;
        }

        if (mgmResult) {
          await db.update(consumptionTable).set({
            hdd: mgmResult.hdd,
            cdd: mgmResult.cdd,
            weatherStationName: mgmResult.stationName,
            weatherStationNote: mgmResult.stationNote ?? null,
          }).where(eq(consumptionTable.id, rec.id));
          updated++;
        } else {
          // Resmi MGM verisi yok — hdd/cdd null yap, ondalıklı fallback kalmasın
          await db.update(consumptionTable).set({
            hdd: null,
            cdd: null,
            weatherStationName: null,
            weatherStationNote: `Bu dönem (${rec.year}/${rec.month}) ve lokasyon ("${rec.city}") için resmi MGM HDD/CDD verisi bulunamadı.`,
          }).where(eq(consumptionTable.id, rec.id));
          noData++;
        }
      } catch (err: any) {
        errors.push(`id=${rec.id}: ${err?.message ?? err}`);
      }
    }

    res.json({
      message: dryRun ? "Kuru çalışma tamamlandı" : "Hava durumu yenileme tamamlandı",
      dryRun,
      total: records.length,
      updated,
      noData,
      skipped,
      errors: errors.slice(0, 20),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/consumption/:id
router.delete("/consumption/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);

    const [existing] = await db
      .select({ meterUnitId: metersTable.unitId, meterCompanyId: metersTable.companyId })
      .from(consumptionTable)
      .leftJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
      .where(eq(consumptionTable.id, id));
    if (!existing) { res.status(404).send(); return; }
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null && existing.meterUnitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    if (role === "admin" && existing.meterCompanyId !== sessionCompanyId) {
      res.status(403).json({ error: "Bu kaydı silme yetkiniz yok" }); return;
    }

    await db.delete(consumptionTable).where(eq(consumptionTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
