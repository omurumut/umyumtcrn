import { Router } from "express";
import { db, energySourcesTable, unitsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

// GET /api/energy-sources?unitId=1&companyId=1
router.get("/energy-sources", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const unitId = req.query.unitId ? parseInt(req.query.unitId as string) : undefined;
    const queryCompanyId = req.query.companyId ? parseInt(req.query.companyId as string) : undefined;

    // Normal kullanıcı: sadece kendi birimi
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null) {
      const rows = await db.select().from(energySourcesTable)
        .where(eq(energySourcesTable.unitId, sessionUnitId!))
        .orderBy(energySourcesTable.name);
      res.json(rows);
      return;
    }

    // Superadmin: isteğe bağlı companyId + unitId filtresi
    if (role === "superadmin") {
      const conditions = [];
      if (queryCompanyId !== undefined) conditions.push(eq(energySourcesTable.companyId, queryCompanyId));
      if (unitId !== undefined) conditions.push(eq(energySourcesTable.unitId, unitId));
      const rows = conditions.length > 0
        ? await db.select().from(energySourcesTable).where(and(...conditions)).orderBy(energySourcesTable.name)
        : await db.select().from(energySourcesTable).orderBy(energySourcesTable.name);
      res.json(rows);
      return;
    }

    // Admin: sadece kendi firması + isteğe bağlı unitId
    const conditions = [eq(energySourcesTable.companyId, sessionCompanyId)];
    if (unitId !== undefined) conditions.push(eq(energySourcesTable.unitId, unitId));
    const rows = await db.select().from(energySourcesTable).where(and(...conditions)).orderBy(energySourcesTable.name);
    res.json(rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/energy-sources
router.post("/energy-sources", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const { unitId, type, name, unit, active } = req.body;
    if (!unitId || !type || !name) {
      res.status(400).json({ error: "Birim, tür ve ad zorunludur" });
      return;
    }
    const parsedUnitId = parseInt(unitId);

    // Normal kullanıcı: sadece kendi birimine ekleyebilir
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== parsedUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    // Admin: hedef birimin kendi firmasına ait olduğunu kontrol et
    if (role === "admin") {
      const [parentUnit] = await db.select({ companyId: unitsTable.companyId })
        .from(unitsTable).where(eq(unitsTable.id, parsedUnitId));
      if (!parentUnit || parentUnit.companyId !== sessionCompanyId) {
        res.status(403).json({ error: "Bu birime enerji kaynağı ekleme yetkiniz yok" }); return;
      }
    }

    // companyId'yi parent unit'ten al
    const [parentUnit] = await db.select({ companyId: unitsTable.companyId })
      .from(unitsTable).where(eq(unitsTable.id, parsedUnitId));
    const targetCompanyId = parentUnit?.companyId ?? sessionCompanyId;

    const [row] = await db.insert(energySourcesTable).values({
      unitId: parsedUnitId,
      type,
      name,
      unit: unit || "kWh",
      active: active !== undefined ? Boolean(active) : true,
      companyId: targetCompanyId,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PATCH /api/energy-sources/:id
router.patch("/energy-sources/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(energySourcesTable).where(eq(energySourcesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Enerji kaynağı bulunamadı" }); return; }
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== existing.unitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    if (role === "admin" && existing.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Bu enerji kaynağını düzenleme yetkiniz yok" }); return;
    }
    const { type, name, unit, active } = req.body;
    const updates: Record<string, unknown> = {};
    if (type !== undefined) updates.type = type;
    if (name !== undefined) updates.name = name;
    if (unit !== undefined) updates.unit = unit;
    if (active !== undefined) updates.active = Boolean(active);
    const [row] = await db.update(energySourcesTable).set(updates).where(eq(energySourcesTable.id, id)).returning();
    res.json(row);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/energy-sources/:id
router.delete("/energy-sources/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(energySourcesTable).where(eq(energySourcesTable.id, id));
    if (!existing) { res.status(404).send(); return; }
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== existing.unitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    if (role === "admin" && existing.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Bu enerji kaynağını silme yetkiniz yok" }); return;
    }
    await db.delete(energySourcesTable).where(eq(energySourcesTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
