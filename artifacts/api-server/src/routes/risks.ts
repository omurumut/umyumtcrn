import { Router } from "express";
import { db, risksTable } from "@workspace/db";
import { eq, and, SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

router.get("/risks", requireAuth, async (req, res) => {
  try {
    const conditions: SQL[] = [];
    if (req.user!.role !== "admin" && req.user!.unitId !== null) {
      conditions.push(eq(risksTable.unitId, req.user!.unitId));
    } else {
      const unitId = req.query.unitId ? parseInt(req.query.unitId as string) : undefined;
      if (unitId !== undefined) conditions.push(eq(risksTable.unitId, unitId));
    }
    const items = conditions.length > 0
      ? await db.select().from(risksTable).where(conditions.length === 1 ? conditions[0] : and(...conditions)).orderBy(risksTable.createdAt)
      : await db.select().from(risksTable).orderBy(risksTable.createdAt);
    res.json(items.map(i => ({
      id: i.id,
      unitId: i.unitId,
      type: i.type,
      title: i.title,
      description: i.description,
      probability: i.probability,
      severity: i.severity,
      score: i.score,
      mitigationPlan: i.mitigationPlan,
      owner: i.owner,
      status: i.status,
      createdAt: i.createdAt,
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.post("/risks", requireAuth, async (req, res) => {
  try {
    const { type, title, description, probability, severity, mitigationPlan, owner, status, unitId } = req.body;
    if (!title || !probability || !severity) {
      return res.status(400).json({ error: "Zorunlu alanlar eksik" });
    }
    const prob = parseInt(probability);
    const sev = parseInt(severity);
    const resolvedUnitId = req.user!.role !== "admin" && req.user!.unitId !== null
      ? req.user!.unitId
      : (unitId ? parseInt(unitId) : null);
    const [item] = await db.insert(risksTable).values({
      type: type || "risk",
      title,
      description: description || null,
      probability: prob,
      severity: sev,
      score: prob * sev,
      mitigationPlan: mitigationPlan || null,
      owner: owner || null,
      status: status || "acik",
      unitId: resolvedUnitId,
    }).returning();
    res.status(201).json(item);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.patch("/risks/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    const { type, title, description, probability, severity, mitigationPlan, owner, status, unitId } = req.body;
    const updates: Record<string, unknown> = {};
    if (type !== undefined) updates.type = type;
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (probability !== undefined) updates.probability = parseInt(probability);
    if (severity !== undefined) updates.severity = parseInt(severity);
    if (probability !== undefined && severity !== undefined) {
      updates.score = parseInt(probability) * parseInt(severity);
    }
    if (mitigationPlan !== undefined) updates.mitigationPlan = mitigationPlan;
    if (owner !== undefined) updates.owner = owner;
    if (status !== undefined) updates.status = status;
    if (req.user!.role === "admin" && unitId !== undefined) {
      updates.unitId = unitId ? parseInt(unitId) : null;
    }
    const [item] = await db.update(risksTable).set(updates).where(eq(risksTable.id, id)).returning();
    if (!item) return res.status(404).json({ error: "Bulunamadı" });
    res.json(item);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.delete("/risks/:id", requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    await db.delete(risksTable).where(eq(risksTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
