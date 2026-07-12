import { Router } from "express";
import { db, seuTable, unitsTable } from "@workspace/db";
import { eq, and, SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

class BadRequestError extends Error {}

function isCompanyAdmin(role: string) {
  return role === "admin" || role === "kontrol_admin";
}

function isSuperAdmin(role: string) {
  return role === "superadmin";
}

function parsePositiveInteger(value: unknown, field = "id"): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new BadRequestError(`Geçersiz ${field}`);
}

function parseRequiredId(value: unknown, field: string): number {
  const parsed = parsePositiveInteger(value, field);
  if (parsed === undefined) throw new BadRequestError(`Geçersiz ${field}`);
  return parsed;
}

function scopedSeuCondition(id: number, role: string, companyId: number) {
  return isSuperAdmin(role)
    ? eq(seuTable.id, id)
    : and(eq(seuTable.id, id), eq(seuTable.companyId, companyId));
}

async function validateUnitCompany(unitId: number, companyId: number) {
  const [unit] = await db.select({ companyId: unitsTable.companyId })
    .from(unitsTable).where(eq(unitsTable.id, unitId));
  return !!unit && unit.companyId === companyId;
}

function handleBadRequest(res: Parameters<typeof requireAuth>[1], err: unknown) {
  if (!(err instanceof BadRequestError)) return false;
  res.status(400).json({ error: err.message });
  return true;
}

router.get("/seu", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const conditions: SQL[] = [];
    const queryCompanyId = parsePositiveInteger(req.query.companyId, "companyId");
    const queryUnitId = parsePositiveInteger(req.query.unitId, "unitId");

    if (isSuperAdmin(role)) {
      if (queryCompanyId !== undefined) conditions.push(eq(seuTable.companyId, queryCompanyId));
      if (queryUnitId !== undefined) {
        if (queryCompanyId !== undefined && !await validateUnitCompany(queryUnitId, queryCompanyId)) {
          res.status(403).json({ error: "Bu birim için yetkiniz yok" }); return;
        }
        conditions.push(eq(seuTable.unitId, queryUnitId));
      }
    } else if (isCompanyAdmin(role)) {
      conditions.push(eq(seuTable.companyId, sessionCompanyId));
      if (queryUnitId !== undefined) {
        if (!await validateUnitCompany(queryUnitId, sessionCompanyId)) {
          res.status(403).json({ error: "Bu birim için yetkiniz yok" }); return;
        }
        conditions.push(eq(seuTable.unitId, queryUnitId));
      }
    } else if (sessionUnitId !== null) {
      conditions.push(eq(seuTable.companyId, sessionCompanyId));
      conditions.push(eq(seuTable.unitId, sessionUnitId));
    } else {
      res.json([]); return;
    }

    const items = conditions.length > 0
      ? await db.select().from(seuTable).where(conditions.length === 1 ? conditions[0] : and(...conditions)).orderBy(seuTable.priority)
      : await db.select().from(seuTable).orderBy(seuTable.priority);
    res.json(items.map(i => ({
      id: i.id, unitId: i.unitId, name: i.name, category: i.category,
      annualKwh: i.annualKwh, percentage: i.percentage, priority: i.priority,
      targetReductionPercent: i.targetReductionPercent, responsible: i.responsible,
      notes: i.notes, createdAt: i.createdAt,
    })));
  } catch (err) {
    if (handleBadRequest(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.post("/seu", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const { name, category, annualKwh, percentage, priority, targetReductionPercent, responsible, notes, unitId } = req.body;
    if (!name || !category) {
      res.status(400).json({ error: "Zorunlu alanlar eksik" }); return;
    }
    const requestedUnitId = unitId !== undefined && unitId !== null
      ? parseRequiredId(unitId, "unitId")
      : null;
    if (!isCompanyAdmin(role) && !isSuperAdmin(role) && sessionUnitId === null) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    if (isCompanyAdmin(role) && requestedUnitId !== null && !await validateUnitCompany(requestedUnitId, sessionCompanyId)) {
      res.status(403).json({ error: "Bu birim için yetkiniz yok" }); return;
    }
    const resolvedUnitId = isCompanyAdmin(role) || isSuperAdmin(role)
      ? requestedUnitId
      : sessionUnitId;
    const [item] = await db.insert(seuTable).values({
      name, category,
      annualKwh: parseFloat(annualKwh) || 0,
      percentage: parseFloat(percentage) || 0,
      priority: parseInt(priority) || 1,
      targetReductionPercent: targetReductionPercent ? parseFloat(targetReductionPercent) : null,
      responsible: responsible || null,
      notes: notes || null,
      unitId: resolvedUnitId,
      companyId: sessionCompanyId,
    }).returning();
    res.status(201).json(item);
  } catch (err) {
    if (handleBadRequest(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.patch("/seu/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseRequiredId(req.params.id, "seuId");
    if (!isCompanyAdmin(role) && !isSuperAdmin(role) && sessionUnitId === null) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const seuScope = scopedSeuCondition(id, role, sessionCompanyId);
    const [existing] = await db.select().from(seuTable).where(seuScope);
    if (!existing) { res.status(404).json({ error: "Bulunamadı" }); return; }
    if (!isCompanyAdmin(role) && !isSuperAdmin(role) && existing.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const updates: Record<string, unknown> = {};
    const { name, category, annualKwh, percentage, priority, targetReductionPercent, responsible, notes, unitId } = req.body;
    const requestedUnitId = unitId !== undefined
      ? (unitId === null ? null : parseRequiredId(unitId, "unitId"))
      : undefined;
    const effectiveUnitId = requestedUnitId !== undefined ? requestedUnitId : existing.unitId;
    if (!isCompanyAdmin(role) && !isSuperAdmin(role)) {
      if (requestedUnitId !== undefined && requestedUnitId !== sessionUnitId) {
        res.status(403).json({ error: "Yetki yok" }); return;
      }
    } else if (isCompanyAdmin(role) && effectiveUnitId !== null && !await validateUnitCompany(effectiveUnitId, sessionCompanyId)) {
      res.status(403).json({ error: "Bu birim için yetkiniz yok" }); return;
    }
    if (name !== undefined) updates.name = name;
    if (category !== undefined) updates.category = category;
    if (annualKwh !== undefined) updates.annualKwh = parseFloat(annualKwh);
    if (percentage !== undefined) updates.percentage = parseFloat(percentage);
    if (priority !== undefined) updates.priority = parseInt(priority);
    if (targetReductionPercent !== undefined) updates.targetReductionPercent = parseFloat(targetReductionPercent);
    if (responsible !== undefined) updates.responsible = responsible;
    if (notes !== undefined) updates.notes = notes;
    if ((isCompanyAdmin(role) || isSuperAdmin(role)) && requestedUnitId !== undefined) {
      updates.unitId = requestedUnitId;
    }
    const [item] = await db.update(seuTable).set(updates).where(seuScope).returning();
    res.json(item);
  } catch (err) {
    if (handleBadRequest(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.delete("/seu/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseRequiredId(req.params.id, "seuId");
    if (!isCompanyAdmin(role) && !isSuperAdmin(role) && sessionUnitId === null) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const seuScope = scopedSeuCondition(id, role, sessionCompanyId);
    const [existing] = await db.select().from(seuTable).where(seuScope);
    if (!existing) { res.status(404).send(); return; }
    if (!isCompanyAdmin(role) && !isSuperAdmin(role) && existing.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    await db.delete(seuTable).where(seuScope);
    res.status(204).send();
  } catch (err) {
    if (handleBadRequest(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
