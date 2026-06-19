import { Router } from "express";
import { db, subUnitsTable, unitsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

// GET /api/sub-units?unitId=1&companyId=1
router.get("/sub-units", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const unitId = req.query.unitId ? parseInt(req.query.unitId as string) : undefined;
    const queryCompanyId = req.query.companyId ? parseInt(req.query.companyId as string) : undefined;

    // Normal kullanıcı: sadece kendi birimi
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null) {
      const rows = await db.select().from(subUnitsTable)
        .where(eq(subUnitsTable.unitId, sessionUnitId!))
        .orderBy(subUnitsTable.name);
      res.json(rows);
      return;
    }

    // Superadmin: isteğe bağlı companyId + unitId filtresi
    if (role === "superadmin") {
      const conditions = [];
      if (queryCompanyId !== undefined) conditions.push(eq(subUnitsTable.companyId, queryCompanyId));
      if (unitId !== undefined) conditions.push(eq(subUnitsTable.unitId, unitId));
      const rows = conditions.length > 0
        ? await db.select().from(subUnitsTable).where(and(...conditions)).orderBy(subUnitsTable.name)
        : await db.select().from(subUnitsTable).orderBy(subUnitsTable.name);
      res.json(rows);
      return;
    }

    // Admin: sadece kendi firması + isteğe bağlı unitId
    const conditions = [eq(subUnitsTable.companyId, sessionCompanyId)];
    if (unitId !== undefined) conditions.push(eq(subUnitsTable.unitId, unitId));
    const rows = await db.select().from(subUnitsTable).where(and(...conditions)).orderBy(subUnitsTable.name);
    res.json(rows);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/sub-units
router.post("/sub-units", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const { unitId, name, city, description, active } = req.body;
    if (!unitId || !name) {
      res.status(400).json({ error: "Birim ve ad zorunludur" });
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
        res.status(403).json({ error: "Bu birime alt birim ekleme yetkiniz yok" }); return;
      }
    }

    // companyId'yi parent unit'ten al
    const [parentUnit] = await db.select({ companyId: unitsTable.companyId })
      .from(unitsTable).where(eq(unitsTable.id, parsedUnitId));
    const targetCompanyId = parentUnit?.companyId ?? sessionCompanyId;

    const [row] = await db.insert(subUnitsTable).values({
      unitId: parsedUnitId,
      name,
      city: city || "Istanbul",
      description: description || null,
      active: active !== undefined ? Boolean(active) : true,
      companyId: targetCompanyId,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// GET /api/sub-units/:id
router.get("/sub-units/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);
    const [row] = await db.select().from(subUnitsTable).where(eq(subUnitsTable.id, id));
    if (!row) { res.status(404).json({ error: "Alt birim bulunamadı" }); return; }
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== row.unitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    if (role === "admin" && row.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    res.json(row);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PATCH /api/sub-units/:id
router.patch("/sub-units/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(subUnitsTable).where(eq(subUnitsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Alt birim bulunamadı" }); return; }
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== existing.unitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    if (role === "admin" && existing.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Bu alt birimi düzenleme yetkiniz yok" }); return;
    }
    const { name, city, description, active } = req.body;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (city !== undefined) updates.city = city;
    if (description !== undefined) updates.description = description;
    if (active !== undefined) updates.active = Boolean(active);
    const [row] = await db.update(subUnitsTable).set(updates).where(eq(subUnitsTable.id, id)).returning();
    res.json(row);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/sub-units/:id
router.delete("/sub-units/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(subUnitsTable).where(eq(subUnitsTable.id, id));
    if (!existing) { res.status(404).send(); return; }
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== existing.unitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    if (role === "admin" && existing.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Bu alt birimi silme yetkiniz yok" }); return;
    }
    await db.delete(subUnitsTable).where(eq(subUnitsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
