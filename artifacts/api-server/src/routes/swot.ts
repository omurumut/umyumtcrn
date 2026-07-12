import { Router } from "express";
import { db, swotTable, unitsTable } from "@workspace/db";
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
  return parsePositiveInteger(value, field) ?? (() => { throw new BadRequestError(`Geçersiz ${field}`); })();
}

function scopedSwotCondition(id: number, role: string, companyId: number) {
  return isSuperAdmin(role)
    ? eq(swotTable.id, id)
    : and(eq(swotTable.id, id), eq(swotTable.companyId, companyId));
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

router.get("/swot", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const conditions: SQL[] = [];
    const queryCompanyId = parsePositiveInteger(req.query.companyId, "companyId");
    const queryUnitId = parsePositiveInteger(req.query.unitId, "unitId");

    if (isSuperAdmin(role)) {
      if (queryCompanyId !== undefined) conditions.push(eq(swotTable.companyId, queryCompanyId));
      if (queryUnitId !== undefined) {
        if (queryCompanyId !== undefined && !await validateUnitCompany(queryUnitId, queryCompanyId)) {
          res.status(403).json({ error: "Bu birim için yetkiniz yok" }); return;
        }
        conditions.push(eq(swotTable.unitId, queryUnitId));
      }
    } else if (isCompanyAdmin(role)) {
      conditions.push(eq(swotTable.companyId, sessionCompanyId));
      if (queryUnitId !== undefined) {
        if (!await validateUnitCompany(queryUnitId, sessionCompanyId)) {
          res.status(403).json({ error: "Bu birim için yetkiniz yok" }); return;
        }
        conditions.push(eq(swotTable.unitId, queryUnitId));
      }
    } else if (sessionUnitId !== null) {
      conditions.push(eq(swotTable.companyId, sessionCompanyId));
      conditions.push(eq(swotTable.unitId, sessionUnitId));
    } else {
      res.json([]); return;
    }

    const items = conditions.length > 0
      ? await db.select().from(swotTable).where(conditions.length === 1 ? conditions[0] : and(...conditions)).orderBy(swotTable.createdAt)
      : await db.select().from(swotTable).orderBy(swotTable.createdAt);
    res.json(items.map(i => ({
      id: i.id, unitId: i.unitId, category: i.category, title: i.title,
      description: i.description, score: i.score, impact: i.impact, createdAt: i.createdAt,
    })));
  } catch (err) {
    if (handleBadRequest(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.post("/swot", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const { category, title, description, score, impact, unitId } = req.body;
    if (!category || !title || !score || !impact) {
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
    const [item] = await db.insert(swotTable).values({
      category, title,
      description: description || null,
      score: parseInt(score),
      impact,
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

router.patch("/swot/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseRequiredId(req.params.id, "swotId");
    if (!isCompanyAdmin(role) && !isSuperAdmin(role) && sessionUnitId === null) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const swotScope = scopedSwotCondition(id, role, sessionCompanyId);
    const [existing] = await db.select().from(swotTable).where(swotScope);
    if (!existing) { res.status(404).json({ error: "Bulunamadı" }); return; }
    if (!isCompanyAdmin(role) && !isSuperAdmin(role) && existing.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const updates: Record<string, unknown> = {};
    const { category, title, description, score, impact, unitId } = req.body;
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
    if (category !== undefined) updates.category = category;
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (score !== undefined) updates.score = parseInt(score);
    if (impact !== undefined) updates.impact = impact;
    if ((isCompanyAdmin(role) || isSuperAdmin(role)) && requestedUnitId !== undefined) {
      updates.unitId = requestedUnitId;
    }
    const [item] = await db.update(swotTable).set(updates).where(swotScope).returning();
    res.json(item);
  } catch (err) {
    if (handleBadRequest(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.delete("/swot/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseRequiredId(req.params.id, "swotId");
    if (!isCompanyAdmin(role) && !isSuperAdmin(role) && sessionUnitId === null) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const swotScope = scopedSwotCondition(id, role, sessionCompanyId);
    const [existing] = await db.select().from(swotTable).where(swotScope);
    if (!existing) { res.status(404).send(); return; }
    if (!isCompanyAdmin(role) && !isSuperAdmin(role) && existing.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    await db.delete(swotTable).where(swotScope);
    res.status(204).send();
  } catch (err) {
    if (handleBadRequest(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
