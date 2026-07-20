import { Router, type Request, type Response } from "express";
import { and, asc, eq, ilike, sql, type SQL } from "drizzle-orm";
import { companiesTable, db, equipmentFieldDefinitionsTable, equipmentTable } from "@workspace/db";
import {
  equipmentCustomFieldDefinitionArchiveSchema,
  equipmentCustomFieldDefinitionCreateSchema,
  equipmentCustomFieldDefinitionPatchSchema,
  type EquipmentCustomFieldDefinitionDto,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth.js";
import { writeAuditEvent, type AuditAction } from "../lib/audit.js";

const router = Router();

class EquipmentFieldScopeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function isSuperAdmin(role: string) {
  return role === "superadmin";
}

function canManage(role: string) {
  return role === "admin" || role === "superadmin";
}

function parsePositiveInteger(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new EquipmentFieldScopeError(400, `Gecersiz ${field}`);
}

function parseOptionalPositiveInteger(value: unknown, field: string) {
  return value === undefined || value === null ? undefined : parsePositiveInteger(value, field);
}

function handleScopeError(res: Response, error: unknown) {
  if (!(error instanceof EquipmentFieldScopeError)) return false;
  res.status(error.status).json({ error: error.message });
  return true;
}

async function resolveScope(req: Request) {
  const { role, companyId: sessionCompanyId, userId } = req.user!;
  const requestedCompanyId = parseOptionalPositiveInteger(req.query.companyId, "companyId");
  if (!isSuperAdmin(role) && requestedCompanyId !== undefined) throw new EquipmentFieldScopeError(400, "Firma kapsami oturumdan alinir; companyId gonderilmemelidir");
  if (isSuperAdmin(role) && requestedCompanyId === undefined) throw new EquipmentFieldScopeError(400, "Gecerli companyId zorunludur");
  const companyId = isSuperAdmin(role) ? requestedCompanyId! : sessionCompanyId;
  const [company] = await db.select({ id: companiesTable.id }).from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  if (!company) throw new EquipmentFieldScopeError(404, "Sirket bulunamadi");
  return { role, userId, companyId, canEdit: canManage(role) };
}

type DefinitionRow = typeof equipmentFieldDefinitionsTable.$inferSelect;

function serializeDefinition(row: DefinitionRow, usageCount?: number): EquipmentCustomFieldDefinitionDto {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    label: row.label,
    description: row.description,
    section: row.section as EquipmentCustomFieldDefinitionDto["section"],
    fieldType: row.fieldType as EquipmentCustomFieldDefinitionDto["fieldType"],
    unitLabel: row.unitLabel,
    options: (row.options ?? []).map((option, index) => ({ ...option, displayOrder: option.displayOrder ?? index })),
    isRequired: row.isRequired,
    isActive: row.isActive,
    displayOrder: row.displayOrder,
    validationConfig: row.validationConfig ?? {},
    definitionVersion: row.definitionVersion,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    archivedBy: row.archivedBy,
    usageCount,
    hasValues: usageCount === undefined ? undefined : usageCount > 0,
  };
}

async function usageCountForCode(companyId: number, code: string) {
  const result = await db.execute<{ count: string }>(
    sql`select count(*)::text as count from equipment where company_id = ${companyId} and custom_values_json ? ${code}`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function usageCounts(companyId: number, definitions: DefinitionRow[]) {
  const counts = new Map<string, number>();
  for (const definition of definitions) counts.set(definition.code, await usageCountForCode(companyId, definition.code));
  return counts;
}

function changedFields(before: DefinitionRow, after: DefinitionRow) {
  const fields = ["code", "label", "description", "section", "fieldType", "unitLabel", "options", "isRequired", "isActive", "displayOrder", "validationConfig"] as const;
  return fields.filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
}

router.get("/equipment-field-definitions", requireAuth, async (req, res) => {
  try {
    const scope = await resolveScope(req);
    const includeArchived = req.query.includeArchived === "true";
    const section = typeof req.query.section === "string" ? req.query.section : undefined;
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const conditions: SQL[] = [eq(equipmentFieldDefinitionsTable.companyId, scope.companyId)];
    if (!includeArchived) conditions.push(eq(equipmentFieldDefinitionsTable.isActive, true));
    if (section) conditions.push(eq(equipmentFieldDefinitionsTable.section, section));
    if (search.length >= 2) conditions.push(ilike(equipmentFieldDefinitionsTable.label, `%${search.replace(/[%_]/g, "\\$&")}%`));
    const definitions = await db.select().from(equipmentFieldDefinitionsTable).where(and(...conditions)).orderBy(asc(equipmentFieldDefinitionsTable.displayOrder), asc(equipmentFieldDefinitionsTable.label));
    const counts = await usageCounts(scope.companyId, definitions);
    res.json({ definitions: definitions.map((definition) => serializeDefinition(definition, counts.get(definition.code) ?? 0)), permissions: { canEdit: scope.canEdit } });
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Ekipman alan tanimlari alinamadi" });
  }
});

router.post("/equipment-field-definitions", requireAuth, async (req, res) => {
  try {
    const scope = await resolveScope(req);
    if (!scope.canEdit) {
      res.status(403).json({ error: "Ekipman alan tanimi duzenleme yetkiniz yok" });
      return;
    }
    const parsed = equipmentCustomFieldDefinitionCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Gecersiz alan tanimi" });
      return;
    }
    const now = new Date();
    const [created] = await db.insert(equipmentFieldDefinitionsTable).values({
      companyId: scope.companyId,
      ...parsed.data,
      description: parsed.data.description ?? null,
      unitLabel: parsed.data.unitLabel ?? null,
      archivedAt: parsed.data.isActive ? null : now,
      archivedBy: parsed.data.isActive ? null : scope.userId,
      createdAt: now,
      createdBy: scope.userId,
      updatedAt: now,
      updatedBy: scope.userId,
    }).onConflictDoNothing({ target: [equipmentFieldDefinitionsTable.companyId, equipmentFieldDefinitionsTable.code] }).returning();
    if (!created) {
      res.status(409).json({ error: "Bu kodda firma ozel ekipman alani zaten var" });
      return;
    }
    await writeAuditEvent(db, {
      request: req,
      companyId: scope.companyId,
      action: "equipment_field.created",
      entityType: "equipment_field",
      entityId: created.id,
      changes: { changedFields: Object.keys(parsed.data), previousVersion: 0, newVersion: created.definitionVersion },
      metadata: { code: created.code, fieldType: created.fieldType },
    });
    res.status(201).json({ definition: serializeDefinition(created, 0) });
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Ekipman alan tanimi olusturulamadi" });
  }
});

router.patch("/equipment-field-definitions/:id", requireAuth, async (req, res) => {
  try {
    const id = parsePositiveInteger(req.params.id, "id");
    const scope = await resolveScope(req);
    if (!scope.canEdit) {
      res.status(403).json({ error: "Ekipman alan tanimi duzenleme yetkiniz yok" });
      return;
    }
    const parsed = equipmentCustomFieldDefinitionPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Gecersiz alan tanimi" });
      return;
    }
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(equipmentFieldDefinitionsTable).where(and(eq(equipmentFieldDefinitionsTable.id, id), eq(equipmentFieldDefinitionsTable.companyId, scope.companyId))).limit(1).for("update");
      if (!existing) return { status: "not-found" as const };
      if (existing.definitionVersion !== parsed.data.expectedDefinitionVersion) return { status: "conflict" as const, definition: existing };
      const usageCount = await usageCountForCode(scope.companyId, existing.code);
      if (usageCount > 0 && parsed.data.code !== undefined && parsed.data.code !== existing.code) return { status: "immutable" as const, error: "Kullanilmis alan kodu degistirilemez" };
      if (usageCount > 0 && parsed.data.fieldType !== undefined && parsed.data.fieldType !== existing.fieldType) return { status: "immutable" as const, error: "Kullanilmis alan tipi degistirilemez" };
      const { expectedDefinitionVersion: _expected, ...patch } = parsed.data;
      const now = new Date();
      const [updated] = await tx.update(equipmentFieldDefinitionsTable).set({
        ...patch,
        description: "description" in patch ? patch.description ?? null : undefined,
        unitLabel: "unitLabel" in patch ? patch.unitLabel ?? null : undefined,
        definitionVersion: existing.definitionVersion + 1,
        updatedAt: now,
        updatedBy: scope.userId,
      }).where(and(eq(equipmentFieldDefinitionsTable.id, existing.id), eq(equipmentFieldDefinitionsTable.definitionVersion, existing.definitionVersion))).returning();
      if (!updated) return { status: "conflict" as const, definition: existing };
      await writeAuditEvent(tx, {
        request: req,
        companyId: scope.companyId,
        action: "equipment_field.updated",
        entityType: "equipment_field",
        entityId: updated.id,
        changes: { changedFields: changedFields(existing, updated), previousVersion: existing.definitionVersion, newVersion: updated.definitionVersion },
        metadata: { code: updated.code, fieldType: updated.fieldType, usageCount },
      });
      return { status: "ok" as const, definition: updated, usageCount };
    });
    if (result.status === "not-found") {
      res.status(404).json({ error: "Alan tanimi bulunamadi" });
      return;
    }
    if (result.status === "conflict") {
      res.status(409).json({ error: "Alan tanimi baska bir oturum tarafindan guncellendi.", definition: serializeDefinition(result.definition, await usageCountForCode(scope.companyId, result.definition.code)) });
      return;
    }
    if (result.status === "immutable") {
      res.status(409).json({ error: result.error });
      return;
    }
    res.json({ definition: serializeDefinition(result.definition, result.usageCount) });
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Ekipman alan tanimi guncellenemedi" });
  }
});

async function lifecycle(req: Request, res: Response, active: boolean) {
  const id = parsePositiveInteger(req.params.id, "id");
  const scope = await resolveScope(req);
  if (!scope.canEdit) throw new EquipmentFieldScopeError(403, "Ekipman alan tanimi duzenleme yetkiniz yok");
  const parsed = equipmentCustomFieldDefinitionArchiveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Gecersiz alan tanimi" });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(equipmentFieldDefinitionsTable).where(and(eq(equipmentFieldDefinitionsTable.id, id), eq(equipmentFieldDefinitionsTable.companyId, scope.companyId))).limit(1).for("update");
    if (!existing) return { status: "not-found" as const };
    if (existing.definitionVersion !== parsed.data.expectedDefinitionVersion) return { status: "conflict" as const, definition: existing };
    const usageCount = await usageCountForCode(scope.companyId, existing.code);
    const now = new Date();
    const [updated] = await tx.update(equipmentFieldDefinitionsTable).set({
      isActive: active,
      archivedAt: active ? null : now,
      archivedBy: active ? null : scope.userId,
      definitionVersion: existing.definitionVersion + 1,
      updatedAt: now,
      updatedBy: scope.userId,
    }).where(and(eq(equipmentFieldDefinitionsTable.id, existing.id), eq(equipmentFieldDefinitionsTable.definitionVersion, existing.definitionVersion))).returning();
    if (!updated) return { status: "conflict" as const, definition: existing };
    const action: AuditAction = active ? "equipment_field.reactivated" : "equipment_field.archived";
    await writeAuditEvent(tx, {
      request: req,
      companyId: scope.companyId,
      action,
      entityType: "equipment_field",
      entityId: updated.id,
      changes: { changedFields: ["isActive"], previousVersion: existing.definitionVersion, newVersion: updated.definitionVersion },
      metadata: { code: updated.code, usageCount },
    });
    return { status: "ok" as const, definition: updated, usageCount };
  });
  if (result.status === "not-found") {
    res.status(404).json({ error: "Alan tanimi bulunamadi" });
    return;
  }
  if (result.status === "conflict") {
    res.status(409).json({ error: "Alan tanimi baska bir oturum tarafindan guncellendi.", definition: serializeDefinition(result.definition, await usageCountForCode(scope.companyId, result.definition.code)) });
    return;
  }
  res.json({ definition: serializeDefinition(result.definition, result.usageCount) });
}

router.post("/equipment-field-definitions/:id/archive", requireAuth, async (req, res) => {
  try {
    await lifecycle(req, res, false);
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Ekipman alan tanimi arsivlenemedi" });
  }
});

router.post("/equipment-field-definitions/:id/reactivate", requireAuth, async (req, res) => {
  try {
    await lifecycle(req, res, true);
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Ekipman alan tanimi aktifi hale getirilemedi" });
  }
});

export default router;
