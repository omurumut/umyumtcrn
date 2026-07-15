import { Router } from "express";
import { companiesTable, db, risksTable, riskNotesTable, unitsTable } from "@workspace/db";
import { eq, and, inArray, SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

class BadRequestError extends Error {}

const RISK_TITLE_MAX_LENGTH = 255;
const RISK_TYPES = new Set(["risk", "firsat"]);
const RISK_STATUSES = new Set(["acik", "devam", "kapali"]);
const RISK_RESPONSE_TYPES = new Set(["izleme", "aksiyon"]);

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

function parseRiskScale(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 5) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (/^[1-5]$/.test(normalized)) return Number(normalized);
  }
  throw new BadRequestError(`Geçersiz ${field}`);
}

function parseNullableRiskScale(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  return parseRiskScale(value, field);
}

function normalizeRiskTitle(value: unknown): string {
  if (typeof value !== "string") throw new BadRequestError("Geçersiz title");
  const normalized = value.trim();
  if (!normalized || normalized.length > RISK_TITLE_MAX_LENGTH) {
    throw new BadRequestError("Geçersiz title");
  }
  return normalized;
}

function parseEnum(value: unknown, allowed: Set<string>, field: string): string {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new BadRequestError(`Geçersiz ${field}`);
  }
  return value;
}

function scopedRiskCondition(id: number, role: string, companyId: number) {
  return isSuperAdmin(role)
    ? eq(risksTable.id, id)
    : and(eq(risksTable.id, id), eq(risksTable.companyId, companyId));
}

async function validateUnitCompany(unitId: number, companyId: number) {
  const [unit] = await db.select({ companyId: unitsTable.companyId })
    .from(unitsTable).where(eq(unitsTable.id, unitId));
  return !!unit && unit.companyId === companyId;
}

async function companyExists(companyId: number) {
  const [company] = await db.select({ id: companiesTable.id })
    .from(companiesTable).where(eq(companiesTable.id, companyId));
  return !!company;
}

function handleBadRequest(res: Parameters<typeof requireAuth>[1], err: unknown) {
  if (!(err instanceof BadRequestError)) return false;
  res.status(400).json({ error: err.message });
  return true;
}

// ── GET /risks ─────────────────────────────────────────────
router.get("/risks", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const conditions: SQL[] = [];
    const queryCompanyId = parsePositiveInteger(req.query.companyId, "companyId");
    const queryUnitId = parsePositiveInteger(req.query.unitId, "unitId");

    if (isSuperAdmin(role)) {
      if (queryCompanyId !== undefined) conditions.push(eq(risksTable.companyId, queryCompanyId));
      if (queryUnitId !== undefined) {
        if (queryCompanyId !== undefined && !await validateUnitCompany(queryUnitId, queryCompanyId)) {
          res.status(403).json({ error: "Bu birim için yetkiniz yok" }); return;
        }
        conditions.push(eq(risksTable.unitId, queryUnitId));
      }
    } else if (isCompanyAdmin(role)) {
      conditions.push(eq(risksTable.companyId, sessionCompanyId));
      if (queryUnitId !== undefined) {
        if (!await validateUnitCompany(queryUnitId, sessionCompanyId)) {
          res.status(403).json({ error: "Bu birim için yetkiniz yok" }); return;
        }
        conditions.push(eq(risksTable.unitId, queryUnitId));
      }
    } else if (sessionUnitId !== null) {
      conditions.push(eq(risksTable.companyId, sessionCompanyId));
      conditions.push(eq(risksTable.unitId, sessionUnitId));
    } else {
      res.json([]); return;
    }

    const items = conditions.length > 0
      ? await db.select().from(risksTable).where(conditions.length === 1 ? conditions[0] : and(...conditions)).orderBy(risksTable.createdAt)
      : await db.select().from(risksTable).orderBy(risksTable.createdAt);

    const riskIds = items.map(i => i.id);
    const notes = riskIds.length > 0
      ? await db.select().from(riskNotesTable).where(inArray(riskNotesTable.riskId, riskIds)).orderBy(riskNotesTable.createdAt)
      : [];

    const notesMap = new Map<number, typeof notes>();
    for (const n of notes) {
      if (!notesMap.has(n.riskId)) notesMap.set(n.riskId, []);
      notesMap.get(n.riskId)!.push(n);
    }

    res.json(items.map(i => ({
      id: i.id, unitId: i.unitId, type: i.type, title: i.title, description: i.description,
      foreseenImpact: i.foreseenImpact,
      probability: i.probability, severity: i.severity, score: i.score,
      responseType: i.responseType,
      mitigationPlan: i.mitigationPlan,
      targetProbability: i.targetProbability,
      targetSeverity: i.targetSeverity,
      targetScore: i.targetScore,
      owner: i.owner, status: i.status, createdAt: i.createdAt,
      notes: (notesMap.get(i.id) ?? []).map(n => ({
        id: n.id, riskId: n.riskId, userId: n.userId, userName: n.userName,
        content: n.content, createdAt: n.createdAt,
      })),
    })));
  } catch (err) {
    if (handleBadRequest(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── POST /risks ────────────────────────────────────────────
router.post("/risks", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const {
      type, title, description, foreseenImpact,
      probability, severity, responseType, mitigationPlan,
      targetProbability, targetSeverity,
      owner, status, unitId, companyId,
    } = req.body;
    const normalizedTitle = normalizeRiskTitle(title);
    const resolvedType = type === undefined ? "risk" : parseEnum(type, RISK_TYPES, "type");
    const resolvedResponseType = responseType === undefined
      ? "izleme"
      : parseEnum(responseType, RISK_RESPONSE_TYPES, "responseType");
    const resolvedStatus = status === undefined ? "acik" : parseEnum(status, RISK_STATUSES, "status");
    if (resolvedResponseType === "aksiyon" && !mitigationPlan) {
      res.status(400).json({ error: "Aksiyon seçildiğinde eylem planı zorunludur" }); return;
    }
    const prob = parseRiskScale(probability, "probability");
    const sev = parseRiskScale(severity, "severity");
    const requestedUnitId = unitId !== undefined && unitId !== null
      ? parseRequiredId(unitId, "unitId")
      : null;
    if (!isCompanyAdmin(role) && !isSuperAdmin(role) && sessionUnitId === null) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const effectiveCompanyId = isSuperAdmin(role)
      ? parseRequiredId(companyId, "companyId")
      : sessionCompanyId;
    if (isSuperAdmin(role) && !await companyExists(effectiveCompanyId)) {
      res.status(400).json({ error: "Geçersiz companyId" }); return;
    }
    if (isCompanyAdmin(role) && requestedUnitId !== null && !await validateUnitCompany(requestedUnitId, sessionCompanyId)) {
      res.status(403).json({ error: "Bu birim için yetkiniz yok" }); return;
    }
    if (isSuperAdmin(role) && requestedUnitId !== null && !await validateUnitCompany(requestedUnitId, effectiveCompanyId)) {
      res.status(403).json({ error: "Bu birim için yetkiniz yok" }); return;
    }
    const resolvedUnitId = isCompanyAdmin(role) || isSuperAdmin(role)
      ? requestedUnitId
      : sessionUnitId;

    const tProb = parseNullableRiskScale(targetProbability, "targetProbability");
    const tSev = parseNullableRiskScale(targetSeverity, "targetSeverity");

    const [item] = await db.insert(risksTable).values({
      type: resolvedType, title: normalizedTitle,
      description: description || null,
      foreseenImpact: foreseenImpact || null,
      probability: prob, severity: sev, score: prob * sev,
      responseType: resolvedResponseType,
      mitigationPlan: mitigationPlan || null,
      targetProbability: tProb,
      targetSeverity: tSev,
      targetScore: tProb !== null && tSev !== null ? tProb * tSev : null,
      owner: owner || null,
      status: resolvedStatus,
      unitId: resolvedUnitId,
      companyId: effectiveCompanyId,
    }).returning();
    res.status(201).json({ ...item, notes: [] });
  } catch (err) {
    if (handleBadRequest(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── PATCH /risks/:id ───────────────────────────────────────
router.patch("/risks/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseRequiredId(req.params.id, "riskId");
    if (!isCompanyAdmin(role) && !isSuperAdmin(role) && sessionUnitId === null) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const riskScope = scopedRiskCondition(id, role, sessionCompanyId);
    const [existing] = await db.select().from(risksTable).where(riskScope);
    if (!existing) { res.status(404).json({ error: "Bulunamadı" }); return; }
    if (!isCompanyAdmin(role) && !isSuperAdmin(role) && existing.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const {
      type, title, description, foreseenImpact,
      probability, severity, responseType, mitigationPlan,
      targetProbability, targetSeverity,
      owner, status, unitId,
    } = req.body;

    const requestedUnitId = unitId !== undefined
      ? (unitId === null ? null : parseRequiredId(unitId, "unitId"))
      : undefined;
    const effectiveUnitId = requestedUnitId !== undefined ? requestedUnitId : existing.unitId;
    if (!isCompanyAdmin(role) && !isSuperAdmin(role)) {
      if (requestedUnitId !== undefined && requestedUnitId !== sessionUnitId) {
        res.status(403).json({ error: "Yetki yok" }); return;
      }
    } else if ((isCompanyAdmin(role) || isSuperAdmin(role)) && effectiveUnitId !== null) {
      const effectiveCompanyId = isSuperAdmin(role) ? existing.companyId : sessionCompanyId;
      if (!await validateUnitCompany(effectiveUnitId, effectiveCompanyId)) {
        res.status(403).json({ error: "Bu birim için yetkiniz yok" }); return;
      }
    }

    const normalizedTitle = title !== undefined ? normalizeRiskTitle(title) : undefined;
    const resolvedType = type !== undefined ? parseEnum(type, RISK_TYPES, "type") : existing.type;
    const resolvedStatus = status !== undefined ? parseEnum(status, RISK_STATUSES, "status") : existing.status;
    const resolvedResponseType = responseType !== undefined
      ? parseEnum(responseType, RISK_RESPONSE_TYPES, "responseType")
      : existing.responseType;
    const effectiveProbability = probability !== undefined
      ? parseRiskScale(probability, "probability")
      : existing.probability;
    const effectiveSeverity = severity !== undefined
      ? parseRiskScale(severity, "severity")
      : existing.severity;
    const effectiveTargetProbability = targetProbability !== undefined
      ? parseNullableRiskScale(targetProbability, "targetProbability")
      : existing.targetProbability;
    const effectiveTargetSeverity = targetSeverity !== undefined
      ? parseNullableRiskScale(targetSeverity, "targetSeverity")
      : existing.targetSeverity;
    if (resolvedResponseType === "aksiyon") {
      const resolvedPlan = mitigationPlan ?? existing.mitigationPlan;
      if (!resolvedPlan) {
        res.status(400).json({ error: "Aksiyon seçildiğinde eylem planı zorunludur" }); return;
      }
    }

    const updates: Record<string, unknown> = {};
    if (type !== undefined) updates.type = resolvedType;
    if (title !== undefined) updates.title = normalizedTitle;
    if (description !== undefined) updates.description = description;
    if (foreseenImpact !== undefined) updates.foreseenImpact = foreseenImpact;
    if (probability !== undefined) updates.probability = effectiveProbability;
    if (severity !== undefined) updates.severity = effectiveSeverity;
    if (probability !== undefined || severity !== undefined) updates.score = effectiveProbability * effectiveSeverity;
    if (responseType !== undefined) updates.responseType = resolvedResponseType;
    if (mitigationPlan !== undefined) updates.mitigationPlan = mitigationPlan;
    if (targetProbability !== undefined) updates.targetProbability = effectiveTargetProbability;
    if (targetSeverity !== undefined) updates.targetSeverity = effectiveTargetSeverity;
    if (targetProbability !== undefined || targetSeverity !== undefined) {
      updates.targetScore = effectiveTargetProbability !== null && effectiveTargetSeverity !== null
        ? effectiveTargetProbability * effectiveTargetSeverity
        : null;
    }
    if (owner !== undefined) updates.owner = owner;
    if (status !== undefined) updates.status = resolvedStatus;
    if ((isCompanyAdmin(role) || isSuperAdmin(role)) && requestedUnitId !== undefined) {
      updates.unitId = requestedUnitId;
    }
    let item = existing;
    if (Object.keys(updates).length > 0) {
      [item] = await db.update(risksTable).set(updates).where(riskScope).returning();
    }
    const noteRows = await db.select().from(riskNotesTable).where(eq(riskNotesTable.riskId, id)).orderBy(riskNotesTable.createdAt);
    res.json({
      ...item,
      notes: noteRows.map(n => ({ id: n.id, riskId: n.riskId, userId: n.userId, userName: n.userName, content: n.content, createdAt: n.createdAt })),
    });
  } catch (err) {
    if (handleBadRequest(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── DELETE /risks/:id ──────────────────────────────────────
router.delete("/risks/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseRequiredId(req.params.id, "riskId");
    if (!isCompanyAdmin(role) && !isSuperAdmin(role) && sessionUnitId === null) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const riskScope = scopedRiskCondition(id, role, sessionCompanyId);
    const [existing] = await db.select().from(risksTable).where(riskScope);
    if (!existing) { res.status(404).send(); return; }
    if (!isCompanyAdmin(role) && !isSuperAdmin(role) && existing.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    await db.delete(risksTable).where(riskScope);
    res.status(204).send();
  } catch (err) {
    if (handleBadRequest(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── POST /risks/:id/notes ──────────────────────────────────
router.post("/risks/:id/notes", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId, userId, name } = req.user!;
    const riskId = parseRequiredId(req.params.id, "riskId");
    if (!isCompanyAdmin(role) && !isSuperAdmin(role) && sessionUnitId === null) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const { content } = req.body;
    if (!content?.trim()) {
      res.status(400).json({ error: "Açıklama içeriği boş olamaz" }); return;
    }
    const [existing] = await db.select().from(risksTable).where(scopedRiskCondition(riskId, role, sessionCompanyId));
    if (!existing) { res.status(404).json({ error: "Risk bulunamadı" }); return; }
    if (!isCompanyAdmin(role) && !isSuperAdmin(role) && existing.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const [note] = await db.insert(riskNotesTable).values({
      riskId, companyId: existing.companyId,
      userId, userName: name,
      content: content.trim(),
    }).returning();
    res.status(201).json({ id: note.id, riskId: note.riskId, userId: note.userId, userName: note.userName, content: note.content, createdAt: note.createdAt });
  } catch (err) {
    if (handleBadRequest(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── PATCH /risks/:id/notes/:noteId ────────────────────────
router.patch("/risks/:id/notes/:noteId", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    if (!isCompanyAdmin(role) && !isSuperAdmin(role)) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const riskId = parseRequiredId(req.params.id, "riskId");
    const noteId = parseRequiredId(req.params.noteId, "noteId");
    const { content } = req.body;
    if (!content?.trim()) {
      res.status(400).json({ error: "Açıklama içeriği boş olamaz" }); return;
    }
    const [risk] = await db.select({ id: risksTable.id }).from(risksTable)
      .where(scopedRiskCondition(riskId, role, sessionCompanyId));
    if (!risk) { res.status(404).json({ error: "Risk bulunamadı" }); return; }
    const noteScope = and(
      eq(riskNotesTable.id, noteId),
      eq(riskNotesTable.riskId, riskId),
      ...(!isSuperAdmin(role) ? [eq(riskNotesTable.companyId, sessionCompanyId)] : []),
    );
    const [existing] = await db.select().from(riskNotesTable).where(noteScope);
    if (!existing) { res.status(404).json({ error: "Not bulunamadı" }); return; }
    const [note] = await db.update(riskNotesTable).set({ content: content.trim() }).where(noteScope).returning();
    res.json({ id: note.id, riskId: note.riskId, userId: note.userId, userName: note.userName, content: note.content, createdAt: note.createdAt });
  } catch (err) {
    if (handleBadRequest(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── DELETE /risks/:id/notes/:noteId ───────────────────────
router.delete("/risks/:id/notes/:noteId", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    if (!isCompanyAdmin(role) && !isSuperAdmin(role)) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const riskId = parseRequiredId(req.params.id, "riskId");
    const noteId = parseRequiredId(req.params.noteId, "noteId");
    const [risk] = await db.select({ id: risksTable.id }).from(risksTable)
      .where(scopedRiskCondition(riskId, role, sessionCompanyId));
    if (!risk) { res.status(404).send(); return; }
    const noteScope = and(
      eq(riskNotesTable.id, noteId),
      eq(riskNotesTable.riskId, riskId),
      ...(!isSuperAdmin(role) ? [eq(riskNotesTable.companyId, sessionCompanyId)] : []),
    );
    const [existing] = await db.select().from(riskNotesTable).where(noteScope);
    if (!existing) { res.status(404).send(); return; }
    await db.delete(riskNotesTable).where(noteScope);
    res.status(204).send();
  } catch (err) {
    if (handleBadRequest(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
