import { Router } from "express";
import { db, risksTable } from "@workspace/db";
import { eq, and, SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

router.get("/risks", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const conditions: SQL[] = [];

    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null) {
      conditions.push(eq(risksTable.unitId, sessionUnitId));
    } else if (role === "admin") {
      conditions.push(eq(risksTable.companyId, sessionCompanyId));
      const unitId = req.query.unitId ? parseInt(req.query.unitId as string) : undefined;
      if (unitId !== undefined) conditions.push(eq(risksTable.unitId, unitId));
    } else {
      const unitId = req.query.unitId ? parseInt(req.query.unitId as string) : undefined;
      if (unitId !== undefined) conditions.push(eq(risksTable.unitId, unitId));
    }

    const items = conditions.length > 0
      ? await db.select().from(risksTable).where(conditions.length === 1 ? conditions[0] : and(...conditions)).orderBy(risksTable.createdAt)
      : await db.select().from(risksTable).orderBy(risksTable.createdAt);
    res.json(items.map(i => ({
      id: i.id, unitId: i.unitId, type: i.type, title: i.title, description: i.description,
      probability: i.probability, severity: i.severity, score: i.score,
      mitigationPlan: i.mitigationPlan, owner: i.owner, status: i.status, createdAt: i.createdAt,
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.post("/risks", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const { type, title, description, probability, severity, mitigationPlan, owner, status, unitId } = req.body;
    if (!title || !probability || !severity) {
      return res.status(400).json({ error: "Zorunlu alanlar eksik" });
    }
    const prob = parseInt(probability);
    const sev = parseInt(severity);
    const resolvedUnitId = role !== "admin" && role !== "superadmin" && sessionUnitId !== null
      ? sessionUnitId
      : (unitId ? parseInt(unitId) : null);
    const [item] = await db.insert(risksTable).values({
      type: type || "risk", title,
      description: description || null,
      probability: prob, severity: sev, score: prob * sev,
      mitigationPlan: mitigationPlan || null,
      owner: owner || null,
      status: status || "acik",
      unitId: resolvedUnitId,
      companyId: sessionCompanyId,
    }).returning();
    res.status(201).json(item);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.patch("/risks/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(risksTable).where(eq(risksTable.id, id));
    if (!existing) return res.status(404).json({ error: "Bulunamadı" });
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null && existing.unitId !== sessionUnitId) {
      return res.status(403).json({ error: "Yetki yok" });
    }
    if (role === "admin" && existing.companyId !== sessionCompanyId) {
      return res.status(403).json({ error: "Bu kaydı düzenleme yetkiniz yok" });
    }
    const { type, title, description, probability, severity, mitigationPlan, owner, status, unitId } = req.body;
    const updates: Record<string, unknown> = {};
    if (type !== undefined) updates.type = type;
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (probability !== undefined) updates.probability = parseInt(probability);
    if (severity !== undefined) updates.severity = parseInt(severity);
    if (probability !== undefined && severity !== undefined) updates.score = parseInt(probability) * parseInt(severity);
    if (mitigationPlan !== undefined) updates.mitigationPlan = mitigationPlan;
    if (owner !== undefined) updates.owner = owner;
    if (status !== undefined) updates.status = status;
    if ((role === "admin" || role === "superadmin") && unitId !== undefined) {
      updates.unitId = unitId ? parseInt(unitId) : null;
    }
    const [item] = await db.update(risksTable).set(updates).where(eq(risksTable.id, id)).returning();
    res.json(item);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.delete("/risks/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(risksTable).where(eq(risksTable.id, id));
    if (!existing) { res.status(404).send(); return; }
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null && existing.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    if (role === "admin" && existing.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Bu kaydı silme yetkiniz yok" }); return;
    }
    await db.delete(risksTable).where(eq(risksTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
