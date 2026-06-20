import { Router } from "express";
import { db, metersTable, consumptionTable, subUnitsTable, energySourcesTable, unitsTable, energyUseGroupsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

// GET /api/meters?unitId=1&subUnitId=2&energySourceId=3
router.get("/meters", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const unitId = req.query.unitId ? parseInt(req.query.unitId as string) : undefined;
    const subUnitId = req.query.subUnitId ? parseInt(req.query.subUnitId as string) : undefined;
    const energySourceId = req.query.energySourceId ? parseInt(req.query.energySourceId as string) : undefined;
    const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : undefined;

    const rows = await db
      .select({
        id: metersTable.id,
        companyId: metersTable.companyId,
        unitId: metersTable.unitId,
        subUnitId: metersTable.subUnitId,
        energySourceId: metersTable.energySourceId,
        energyUseGroupId: metersTable.energyUseGroupId,
        name: metersTable.name,
        type: metersTable.type,
        location: metersTable.location,
        city: metersTable.city,
        unit: metersTable.unit,
        description: metersTable.description,
        createdAt: metersTable.createdAt,
        subUnitName: subUnitsTable.name,
        energySourceName: energySourcesTable.name,
        energyUseGroupName: energyUseGroupsTable.name,
      })
      .from(metersTable)
      .leftJoin(subUnitsTable, eq(metersTable.subUnitId, subUnitsTable.id))
      .leftJoin(energySourcesTable, eq(metersTable.energySourceId, energySourcesTable.id))
      .leftJoin(energyUseGroupsTable, eq(metersTable.energyUseGroupId, energyUseGroupsTable.id))
      .orderBy(metersTable.createdAt);

    const filtered = rows.filter(m => {
      // Normal kullanıcı: sadece kendi birimi
      if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null && m.unitId !== sessionUnitId) return false;
      // Admin: sadece kendi firması
      if (role === "admin" && m.companyId !== sessionCompanyId) return false;
      // Superadmin: seçili firma filtresi
      if (role === "superadmin" && companyId !== undefined && m.companyId !== companyId) return false;
      // Ek filtreler
      if (unitId !== undefined && m.unitId !== unitId) return false;
      if (subUnitId !== undefined && m.subUnitId !== subUnitId) return false;
      if (energySourceId !== undefined && m.energySourceId !== energySourceId) return false;
      return true;
    });

    res.json(filtered);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/meters
router.post("/meters", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const { name, type, location, city, unit, description, unitId, subUnitId, energySourceId, energyUseGroupId } = req.body;
    if (!name || !type || !location || !unit) {
      res.status(400).json({ error: "Zorunlu alanlar eksik" }); return;
    }
    const parsedUnitId = unitId ? parseInt(unitId) : null;

    // Normal kullanıcı: sadece kendi birimine ekleyebilir
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null && parsedUnitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    // Admin: hedef birimin kendi firmasına ait olduğunu kontrol et
    if (role === "admin" && parsedUnitId !== null) {
      const [parentUnit] = await db.select({ companyId: unitsTable.companyId })
        .from(unitsTable).where(eq(unitsTable.id, parsedUnitId));
      if (!parentUnit || parentUnit.companyId !== sessionCompanyId) {
        res.status(403).json({ error: "Bu birime sayaç ekleme yetkiniz yok" }); return;
      }
    }

    // companyId'yi belirle
    let targetCompanyId = sessionCompanyId;
    if (role === "superadmin" && parsedUnitId !== null) {
      const [parentUnit] = await db.select({ companyId: unitsTable.companyId })
        .from(unitsTable).where(eq(unitsTable.id, parsedUnitId));
      if (parentUnit) targetCompanyId = parentUnit.companyId;
    }

    // energyUseGroupId cross-company doğrulama
    let parsedGroupId: number | null = null;
    if (energyUseGroupId) {
      parsedGroupId = parseInt(energyUseGroupId);
      const [grp] = await db.select({ companyId: energyUseGroupsTable.companyId })
        .from(energyUseGroupsTable).where(eq(energyUseGroupsTable.id, parsedGroupId));
      if (!grp || grp.companyId !== targetCompanyId) {
        res.status(400).json({ error: "Geçersiz enerji kullanım grubu" }); return;
      }
    }

    const [meter] = await db.insert(metersTable).values({
      name, type, location,
      city: city || "Istanbul",
      unit, description: description || null,
      unitId: parsedUnitId,
      subUnitId: subUnitId ? parseInt(subUnitId) : null,
      energySourceId: energySourceId ? parseInt(energySourceId) : null,
      energyUseGroupId: parsedGroupId,
      companyId: targetCompanyId,
    }).returning();
    res.status(201).json(meter);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// GET /api/meters/:id
router.get("/meters/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);
    const [meter] = await db.select().from(metersTable).where(eq(metersTable.id, id));
    if (!meter) { res.status(404).json({ error: "Sayaç bulunamadı" }); return; }
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null && meter.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    if (role === "admin" && meter.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    res.json(meter);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PATCH /api/meters/:id
router.patch("/meters/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(metersTable).where(eq(metersTable.id, id));
    if (!existing) { res.status(404).json({ error: "Sayaç bulunamadı" }); return; }
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null && existing.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    if (role === "admin" && existing.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Bu sayacı düzenleme yetkiniz yok" }); return;
    }
    const { name, type, location, city, unit, description, unitId, subUnitId, energySourceId, energyUseGroupId } = req.body;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (type !== undefined) updates.type = type;
    if (location !== undefined) updates.location = location;
    if (city !== undefined) updates.city = city;
    if (unit !== undefined) updates.unit = unit;
    if (description !== undefined) updates.description = description;
    if (unitId !== undefined) updates.unitId = unitId ? parseInt(unitId) : null;
    if (subUnitId !== undefined) updates.subUnitId = subUnitId ? parseInt(subUnitId) : null;
    if (energySourceId !== undefined) updates.energySourceId = energySourceId ? parseInt(energySourceId) : null;
    if (energyUseGroupId !== undefined) {
      if (energyUseGroupId === null || energyUseGroupId === "") {
        updates.energyUseGroupId = null;
      } else {
        const gid = parseInt(energyUseGroupId);
        const [grp] = await db.select({ companyId: energyUseGroupsTable.companyId })
          .from(energyUseGroupsTable).where(eq(energyUseGroupsTable.id, gid));
        if (!grp || grp.companyId !== existing.companyId) {
          res.status(400).json({ error: "Geçersiz enerji kullanım grubu" }); return;
        }
        updates.energyUseGroupId = gid;
      }
    }
    const [meter] = await db.update(metersTable).set(updates).where(eq(metersTable.id, id)).returning();
    res.json(meter);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/meters/:id
router.delete("/meters/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(metersTable).where(eq(metersTable.id, id));
    if (!existing) { res.status(404).send(); return; }
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null && existing.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    if (role === "admin" && existing.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Bu sayacı silme yetkiniz yok" }); return;
    }
    await db.delete(consumptionTable).where(eq(consumptionTable.meterId, id));
    await db.delete(metersTable).where(eq(metersTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
