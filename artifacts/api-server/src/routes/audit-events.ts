import { Router } from "express";
import { and, count, desc, eq, gte, isNull, lte, SQL } from "drizzle-orm";
import { db, auditEventsTable, equipmentTable, unitsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";
import { AUDIT_ACTION_SET, AUDIT_OUTCOME_SET } from "../lib/audit.js";

const router = Router();

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function parseOptionalPositiveInteger(value: unknown, field: string) {
  if (value === undefined || value === null) return undefined;
  const parsed = parsePositiveInteger(value);
  if (parsed === null) throw new Error(`Geçersiz ${field}`);
  return parsed;
}

function parseDate(value: unknown, field: string) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`Geçersiz ${field}`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Geçersiz ${field}`);
  return date;
}

function isCompanyAdmin(role: string) {
  return role === "admin" || role === "kontrol_admin";
}

async function resolveAuditScope(req: Parameters<Parameters<typeof router.get>[1]>[0]) {
  const role = req.user!.role;
  if (role === "user") {
    if (req.query.entityType !== "equipment" || typeof req.query.entityId !== "string") return { status: 403 as const, error: "Yetki yok" };
    const entityId = parsePositiveInteger(req.query.entityId);
    if (entityId === null || req.user!.unitId === null) return { status: 403 as const, error: "Yetki yok" };
    const [equipment] = await db.select({ id: equipmentTable.id })
      .from(equipmentTable)
      .where(and(eq(equipmentTable.id, entityId), eq(equipmentTable.companyId, req.user!.companyId), eq(equipmentTable.unitId, req.user!.unitId)))
      .limit(1);
    if (!equipment) return { status: 404 as const, error: "Audit kaydı bulunamadı" };
    return { companyId: req.user!.companyId, unitId: req.user!.unitId, platform: false, forcedEntityType: "equipment", forcedEntityId: String(entityId) };
  }

  const requestedCompanyId = parseOptionalPositiveInteger(req.query.companyId, "companyId");
  const requestedUnitId = parseOptionalPositiveInteger(req.query.unitId, "unitId");
  const platformScope = req.query.scope === "platform";

  if (isCompanyAdmin(role)) {
    if (requestedUnitId !== undefined) {
      const [unit] = await db.select({ id: unitsTable.id })
        .from(unitsTable)
        .where(and(eq(unitsTable.id, requestedUnitId), eq(unitsTable.companyId, req.user!.companyId)));
      if (!unit) return { status: 403 as const, error: "Yetki yok" };
    }
    return { companyId: req.user!.companyId, unitId: requestedUnitId, platform: false };
  }

  if (role !== "superadmin") return { status: 403 as const, error: "Yetki yok" };
  if (platformScope && requestedCompanyId !== undefined) {
    return { status: 400 as const, error: "Platform scope ile companyId birlikte kullanılamaz" };
  }
  if (!platformScope && requestedCompanyId === undefined) {
    return { status: 400 as const, error: "Superadmin için companyId veya scope=platform zorunludur" };
  }
  if (requestedUnitId !== undefined && requestedCompanyId !== undefined) {
    const [unit] = await db.select({ id: unitsTable.id })
      .from(unitsTable)
      .where(and(eq(unitsTable.id, requestedUnitId), eq(unitsTable.companyId, requestedCompanyId)));
    if (!unit) return { status: 403 as const, error: "Yetki yok" };
  }
  return { companyId: requestedCompanyId ?? null, unitId: requestedUnitId, platform: platformScope };
}

router.get("/audit-events", requireAuth, async (req, res) => {
  try {
    const scope = await resolveAuditScope(req);
    if ("status" in scope) { res.status(scope.status ?? 500).json({ error: scope.error }); return; }

    const page = parseOptionalPositiveInteger(req.query.page, "page") ?? 1;
    const pageSize = Math.min(parseOptionalPositiveInteger(req.query.pageSize, "pageSize") ?? 50, 100);
    const actorUserId = parseOptionalPositiveInteger(req.query.actorUserId, "actorUserId");
    const dateFrom = parseDate(req.query.dateFrom, "dateFrom");
    const dateTo = parseDate(req.query.dateTo, "dateTo");

    const conditions: SQL[] = [];
    if (scope.platform) conditions.push(isNull(auditEventsTable.companyId));
    else conditions.push(eq(auditEventsTable.companyId, scope.companyId!));
    if (scope.unitId !== undefined) conditions.push(eq(auditEventsTable.unitId, scope.unitId));
    if (actorUserId !== undefined) conditions.push(eq(auditEventsTable.actorUserId, actorUserId));
    if (typeof req.query.action === "string") {
      if (!AUDIT_ACTION_SET.has(req.query.action)) { res.status(400).json({ error: "Geçersiz action" }); return; }
      conditions.push(eq(auditEventsTable.action, req.query.action));
    }
    if (typeof req.query.outcome === "string") {
      if (!AUDIT_OUTCOME_SET.has(req.query.outcome)) { res.status(400).json({ error: "Geçersiz outcome" }); return; }
      conditions.push(eq(auditEventsTable.outcome, req.query.outcome));
    }
    const forcedEntityType = "forcedEntityType" in scope ? scope.forcedEntityType : undefined;
    const forcedEntityId = "forcedEntityId" in scope ? scope.forcedEntityId : undefined;
    if (forcedEntityType !== undefined) conditions.push(eq(auditEventsTable.entityType, forcedEntityType));
    else if (typeof req.query.entityType === "string") conditions.push(eq(auditEventsTable.entityType, req.query.entityType));
    if (forcedEntityId !== undefined) conditions.push(eq(auditEventsTable.entityId, forcedEntityId));
    else if (typeof req.query.entityId === "string") conditions.push(eq(auditEventsTable.entityId, req.query.entityId));
    if (typeof req.query.requestId === "string") {
      const requestId = req.query.requestId.trim();
      if (requestId.length === 0 || requestId.length > 128) { res.status(400).json({ error: "Geçersiz requestId" }); return; }
      conditions.push(eq(auditEventsTable.requestId, requestId));
    }
    if (dateFrom) conditions.push(gte(auditEventsTable.occurredAt, dateFrom));
    if (dateTo) conditions.push(lte(auditEventsTable.occurredAt, dateTo));

    const where = and(...conditions);
    const [{ total }] = await db.select({ total: count() }).from(auditEventsTable).where(where);
    const items = await db.select().from(auditEventsTable)
      .where(where)
      .orderBy(desc(auditEventsTable.occurredAt), desc(auditEventsTable.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const totalCount = Number(total);
    res.json({ items, page, pageSize, total: totalCount, hasNext: page * pageSize < totalCount });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Geçersiz")) {
      res.status(400).json({ error: error.message }); return;
    }
    req.log.error(error);
    res.status(500).json({ error: "Audit kayıtları alınamadı" });
  }
});

router.get("/audit-events/:id", requireAuth, async (req, res) => {
  try {
    const id = parsePositiveInteger(req.params.id);
    if (id === null) { res.status(400).json({ error: "Geçersiz audit event id" }); return; }
    const scope = await resolveAuditScope(req);
    if ("status" in scope) { res.status(scope.status ?? 500).json({ error: scope.error }); return; }

    const conditions: SQL[] = [eq(auditEventsTable.id, id)];
    if (scope.platform) conditions.push(isNull(auditEventsTable.companyId));
    else conditions.push(eq(auditEventsTable.companyId, scope.companyId!));

    const [item] = await db.select().from(auditEventsTable).where(and(...conditions));
    if (!item) { res.status(404).json({ error: "Audit kaydı bulunamadı" }); return; }
    res.json(item);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Geçersiz")) {
      res.status(400).json({ error: error.message }); return;
    }
    req.log.error(error);
    res.status(500).json({ error: "Audit kaydı alınamadı" });
  }
});

export default router;
