import { Router } from "express";
import { db, consumptionTable, metersTable, subUnitsTable, energyUseGroupsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

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
        createdAt: consumptionTable.createdAt,
      })
      .from(consumptionTable)
      .leftJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
      .leftJoin(energyUseGroupsTable, eq(metersTable.energyUseGroupId, energyUseGroupsTable.id))
      .orderBy(consumptionTable.year, consumptionTable.month);

    const filtered = rows.filter(r => {
      // Normal kullanıcı: sadece kendi birimi
      if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null && r.meterUnitId !== sessionUnitId) return false;
      // Admin: sadece kendi firması
      if (role === "admin" && r.meterCompanyId !== sessionCompanyId) return false;
      // Ek filtreler
      if (meterId !== undefined && r.meterId !== meterId) return false;
      if (year !== undefined && r.year !== year) return false;
      if (month !== undefined && r.month !== month) return false;
      return true;
    });

    res.json(filtered.map(({ meterUnitId, meterCompanyId, ...r }) => r));
    // response içerir: meterName, meterType, energyUseGroupId, energyUseGroupName — ileride EnPI/ÖEK/regresyon analizlerinde kullanılabilir
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

    // Normal kullanıcı: sadece kendi birimi
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null && meter.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    // Admin: sadece kendi firması
    if (role === "admin" && meter.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Bu sayaca tüketim girme yetkiniz yok" }); return;
    }

    const kwhVal = parseFloat(kwh) || 0;
    const tepVal = tep !== undefined ? parseFloat(tep) : kwhVal * 0.000086;
    const co2Val = co2 !== undefined ? parseFloat(co2) : kwhVal * 0.4;

    const [record] = await db.insert(consumptionTable).values({
      meterId: meter.id,
      companyId: meter.companyId,
      year: parseInt(year),
      month: parseInt(month),
      kwh: kwhVal,
      tep: tepVal,
      co2: co2Val,
      hdd: hdd !== undefined ? parseFloat(hdd) : null,
      cdd: cdd !== undefined ? parseFloat(cdd) : null,
      notes: notes || null,
    }).returning();

    res.status(201).json({ ...record, meterName: meter.name });
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

    // Yetki kontrolü için mevcut kaydı ve sayacını bul
    const [existing] = await db
      .select({ companyId: consumptionTable.companyId, meterUnitId: metersTable.unitId, meterCompanyId: metersTable.companyId })
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
        let meter = allMeters.find(m => {
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
        const hddVal = row.hdd !== undefined && row.hdd !== "" ? parseFloat(String(row.hdd)) : null;
        const cddVal = row.cdd !== undefined && row.cdd !== "" ? parseFloat(String(row.cdd)) : null;

        await db.insert(consumptionTable).values({
          meterId: meter.id,
          companyId: meter.companyId,
          year,
          month,
          kwh,
          tep: tepVal,
          co2: co2Val,
          hdd: hddVal,
          cdd: cddVal,
          notes: row.notes ? String(row.notes) : null,
        });
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
