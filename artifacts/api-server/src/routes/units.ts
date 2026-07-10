import { Router } from "express";
import { db, unitsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";

const router = Router();

// GET /api/units
router.get("/units", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const queryCompanyId = req.query.companyId ? parseInt(req.query.companyId as string) : undefined;

    // Normal kullanıcı: sadece kendi birimi
    if (role !== "admin" && role !== "kontrol_admin" && role !== "superadmin" && sessionUnitId !== null) {
      const units = await db.select().from(unitsTable)
        .where(eq(unitsTable.id, sessionUnitId!))
        .orderBy(unitsTable.name);
      res.json(units);
      return;
    }

    // Superadmin: isteğe bağlı companyId filtresi
    if (role === "superadmin") {
      if (queryCompanyId !== undefined) {
        const units = await db.select().from(unitsTable)
          .where(eq(unitsTable.companyId, queryCompanyId))
          .orderBy(unitsTable.name);
        res.json(units);
        return;
      }
      const units = await db.select().from(unitsTable).orderBy(unitsTable.name);
      res.json(units);
      return;
    }

    // Admin: sadece kendi firması
    const units = await db.select().from(unitsTable)
      .where(eq(unitsTable.companyId, sessionCompanyId))
      .orderBy(unitsTable.name);
    res.json(units);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/units — admin only
router.post("/units", requireAdmin, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    const { name, location, type, city, responsible, description, active, companyId } = req.body;
    if (!name || !location) { res.status(400).json({ error: "Ad ve lokasyon zorunludur" }); return; }
    // Admin kendi firmasına ekler; superadmin body'deki companyId'yi kullanır
    const targetCompanyId = role === "superadmin" && companyId ? parseInt(companyId) : sessionCompanyId;
    const [unit] = await db.insert(unitsTable).values({
      name, location, type: type || "fabrika", city: city || "Istanbul",
      responsible: responsible || null, description: description || null,
      active: active !== undefined ? Boolean(active) : true,
      companyId: targetCompanyId,
    }).returning();
    res.status(201).json(unit);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// GET /api/units/:id
router.get("/units/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);
    const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, id));
    if (!unit) { res.status(404).json({ error: "Birim bulunamadı" }); return; }
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== id) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    if (role === "admin" && unit.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    res.json(unit);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PATCH /api/units/:id — admin only
router.patch("/units/:id", requireAdmin, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(unitsTable).where(eq(unitsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Birim bulunamadı" }); return; }
    if (role === "admin" && existing.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Bu birimi düzenleme yetkiniz yok" }); return;
    }
    const { name, location, type, city, responsible, description, active } = req.body;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (location !== undefined) updates.location = location;
    if (type !== undefined) updates.type = type;
    if (city !== undefined) updates.city = city;
    if (responsible !== undefined) updates.responsible = responsible;
    if (description !== undefined) updates.description = description;
    if (active !== undefined) updates.active = Boolean(active);
    const [unit] = await db.update(unitsTable).set(updates).where(eq(unitsTable.id, id)).returning();
    if (!unit) { res.status(404).json({ error: "Birim bulunamadı" }); return; }
    res.json(unit);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/units/:id — admin only
router.delete("/units/:id", requireAdmin, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(unitsTable).where(eq(unitsTable.id, id));
    if (!existing) { res.status(404).send(); return; }
    if (role === "admin" && existing.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Bu birimi silme yetkiniz yok" }); return;
    }
    await db.delete(unitsTable).where(eq(unitsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
