import { Router } from "express";
import { db, energyUseGroupsTable, metersTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

// GET /api/energy-use-groups
router.get("/energy-use-groups", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    const { isActive, groupType, energySourceId, unitId, subUnitId, companyId: qCompanyId } = req.query;

    const rows = await db.select().from(energyUseGroupsTable).orderBy(energyUseGroupsTable.name);

    const filtered = rows.filter(g => {
      if (role === "superadmin") {
        if (qCompanyId && g.companyId !== parseInt(qCompanyId as string)) return false;
      } else {
        if (g.companyId !== sessionCompanyId) return false;
      }
      if (isActive !== undefined && g.isActive !== (isActive === "true")) return false;
      if (groupType && g.groupType !== groupType) return false;
      if (energySourceId && g.energySourceId !== parseInt(energySourceId as string)) return false;
      if (unitId && g.unitId !== parseInt(unitId as string)) return false;
      if (subUnitId && g.subUnitId !== parseInt(subUnitId as string)) return false;
      return true;
    });

    // Bağlı sayaç sayısını ekle
    const groupIds = filtered.map(g => g.id);
    const meterCounts: Record<number, number> = {};
    if (groupIds.length > 0) {
      const allMeters = await db.select({ energyUseGroupId: metersTable.energyUseGroupId })
        .from(metersTable)
        .where(eq(metersTable.companyId, sessionCompanyId));
      for (const m of allMeters) {
        if (m.energyUseGroupId !== null && m.energyUseGroupId !== undefined) {
          meterCounts[m.energyUseGroupId] = (meterCounts[m.energyUseGroupId] ?? 0) + 1;
        }
      }
    }

    const result = filtered.map(g => ({ ...g, meterCount: meterCounts[g.id] ?? 0 }));
    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/energy-use-groups
router.post("/energy-use-groups", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, name: userName } = req.user!;
    const { name, code, groupType, energySourceId, unitId, subUnitId, description, isSeuCandidate, isActive } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ error: "Grup adı zorunludur" }); return;
    }
    if (!groupType) {
      res.status(400).json({ error: "Grup tipi zorunludur" }); return;
    }

    // Aynı companyId altında aynı name kontrolü (aktif kayıtlar)
    const existing = await db.select({ id: energyUseGroupsTable.id })
      .from(energyUseGroupsTable)
      .where(and(
        eq(energyUseGroupsTable.companyId, sessionCompanyId),
        eq(energyUseGroupsTable.name, name.trim()),
        eq(energyUseGroupsTable.isActive, true)
      ));
    if (existing.length > 0) {
      res.status(400).json({ error: "Bu isimde aktif bir grup zaten mevcut" }); return;
    }

    const [group] = await db.insert(energyUseGroupsTable).values({
      companyId: sessionCompanyId,
      name: name.trim(),
      code: code?.trim() || null,
      groupType,
      energySourceId: energySourceId ? parseInt(energySourceId) : null,
      unitId: unitId ? parseInt(unitId) : null,
      subUnitId: subUnitId ? parseInt(subUnitId) : null,
      description: description?.trim() || null,
      isSeuCandidate: isSeuCandidate === true || isSeuCandidate === "true",
      isActive: isActive !== false && isActive !== "false",
      createdBy: userName ?? null,
    }).returning();

    res.status(201).json({ ...group, meterCount: 0 });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PUT /api/energy-use-groups/:id
router.put("/energy-use-groups/:id", requireAuth, async (req, res) => {
  try {
    const { companyId: sessionCompanyId } = req.user!;
    const id = parseInt(req.params.id as string);

    const [existing] = await db.select().from(energyUseGroupsTable).where(eq(energyUseGroupsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Grup bulunamadı" }); return; }
    if (existing.companyId !== sessionCompanyId) { res.status(403).json({ error: "Yetki yok" }); return; }

    const { name, code, groupType, energySourceId, unitId, subUnitId, description, isSeuCandidate, isActive } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ error: "Grup adı zorunludur" }); return;
    }
    if (!groupType) {
      res.status(400).json({ error: "Grup tipi zorunludur" }); return;
    }

    // Mükerrer isim kontrolü (aynı isimde başka aktif grup var mı?)
    const duplicate = await db.select({ id: energyUseGroupsTable.id })
      .from(energyUseGroupsTable)
      .where(and(
        eq(energyUseGroupsTable.companyId, sessionCompanyId),
        eq(energyUseGroupsTable.name, name.trim()),
        eq(energyUseGroupsTable.isActive, true)
      ));
    if (duplicate.some(d => d.id !== id)) {
      res.status(400).json({ error: "Bu isimde aktif bir grup zaten mevcut" }); return;
    }

    const [updated] = await db.update(energyUseGroupsTable).set({
      name: name.trim(),
      code: code?.trim() || null,
      groupType,
      energySourceId: energySourceId ? parseInt(energySourceId) : null,
      unitId: unitId ? parseInt(unitId) : null,
      subUnitId: subUnitId ? parseInt(subUnitId) : null,
      description: description?.trim() || null,
      isSeuCandidate: isSeuCandidate === true || isSeuCandidate === "true",
      isActive: isActive !== false && isActive !== "false",
      updatedAt: new Date(),
    }).where(eq(energyUseGroupsTable.id, id)).returning();

    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PATCH /api/energy-use-groups/:id/status
router.patch("/energy-use-groups/:id/status", requireAuth, async (req, res) => {
  try {
    const { companyId: sessionCompanyId } = req.user!;
    const id = parseInt(req.params.id as string);

    const [existing] = await db.select().from(energyUseGroupsTable).where(eq(energyUseGroupsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Grup bulunamadı" }); return; }
    if (existing.companyId !== sessionCompanyId) { res.status(403).json({ error: "Yetki yok" }); return; }

    const { isActive } = req.body;
    if (typeof isActive !== "boolean") {
      res.status(400).json({ error: "isActive boolean olmalıdır" }); return;
    }

    const [updated] = await db.update(energyUseGroupsTable).set({
      isActive,
      updatedAt: new Date(),
    }).where(eq(energyUseGroupsTable.id, id)).returning();

    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// GET /api/energy-use-groups/:id/meters
router.get("/energy-use-groups/:id/meters", requireAuth, async (req, res) => {
  try {
    const { companyId: sessionCompanyId } = req.user!;
    const id = parseInt(req.params.id as string);

    const [group] = await db.select().from(energyUseGroupsTable).where(eq(energyUseGroupsTable.id, id));
    if (!group) { res.status(404).json({ error: "Grup bulunamadı" }); return; }
    if (group.companyId !== sessionCompanyId) { res.status(403).json({ error: "Yetki yok" }); return; }

    const meters = await db.select().from(metersTable)
      .where(and(
        eq(metersTable.energyUseGroupId, id),
        eq(metersTable.companyId, sessionCompanyId)
      ));

    res.json(meters);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
