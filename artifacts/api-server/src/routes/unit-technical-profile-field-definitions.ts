import { Router, type Request, type Response } from "express";
import { and, asc, eq } from "drizzle-orm";
import {
  companiesTable,
  db,
  unitTechnicalProfileFieldDefinitionsTable,
  unitTechnicalProfilesTable,
} from "@workspace/db";
import {
  unitTechnicalProfileCustomFieldDefinitionArchiveSchema,
  unitTechnicalProfileCustomFieldDefinitionCreateSchema,
  unitTechnicalProfileCustomFieldDefinitionPatchSchema,
  type UnitTechnicalProfileCustomFieldDefinitionDto,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth.js";
import { writeAuditEvent, type AuditAction } from "../lib/audit.js";

const router = Router();

class DefinitionScopeError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function isSuperAdmin(role: string) {
  return role === "superadmin";
}

function canManageDefinitions(role: string) {
  return role === "admin" || role === "superadmin";
}

function parsePositiveInteger(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new DefinitionScopeError(400, `Gecersiz ${field}`);
}

function parseOptionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return parsePositiveInteger(value, field);
}

function handleScopeError(res: Response, error: unknown) {
  if (!(error instanceof DefinitionScopeError)) return false;
  res.status(error.status).json({ error: error.message });
  return true;
}

async function resolveCompanyScope(req: Request) {
  const { role, companyId: sessionCompanyId } = req.user!;
  const requestedCompanyId = parseOptionalPositiveInteger(req.query.companyId, "companyId");

  if (!isSuperAdmin(role) && requestedCompanyId !== undefined) {
    throw new DefinitionScopeError(400, "Firma kapsami oturumdan alinir; companyId gonderilmemelidir");
  }
  if (isSuperAdmin(role) && requestedCompanyId === undefined) {
    throw new DefinitionScopeError(400, "Gecerli companyId zorunludur");
  }
  if (role === "user") throw new DefinitionScopeError(403, "Teknik profil alan tanimlari icin yetki yok");

  const companyId = isSuperAdmin(role) ? requestedCompanyId! : sessionCompanyId;
  const [company] = await db.select({ id: companiesTable.id })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .limit(1);
  if (!company) throw new DefinitionScopeError(404, "Sirket bulunamadi");

  return {
    role,
    userId: req.user!.userId,
    companyId,
    canEdit: canManageDefinitions(role),
  };
}

type DefinitionRow = typeof unitTechnicalProfileFieldDefinitionsTable.$inferSelect;

function serializeDefinition(
  row: DefinitionRow,
  usageCount?: number,
): UnitTechnicalProfileCustomFieldDefinitionDto {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    label: row.label,
    description: row.description,
    fieldType: row.fieldType as UnitTechnicalProfileCustomFieldDefinitionDto["fieldType"],
    unitLabel: row.unitLabel,
    options: row.options ?? [],
    isRequiredForPublish: row.isRequiredForPublish,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    validationConfig: row.validationConfig ?? {},
    definitionVersion: row.definitionVersion,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    usageCount,
    hasValues: usageCount === undefined ? undefined : usageCount > 0,
  };
}

function customValuesHaveCode(values: unknown, code: string) {
  return !!values && typeof values === "object" && !Array.isArray(values)
    && Object.prototype.hasOwnProperty.call(values, code);
}

async function usageCountForCode(companyId: number, code: string) {
  const profiles = await db.select({ customValues: unitTechnicalProfilesTable.customValues })
    .from(unitTechnicalProfilesTable)
    .where(eq(unitTechnicalProfilesTable.companyId, companyId));
  return profiles.filter((profile) => customValuesHaveCode(profile.customValues, code)).length;
}

async function usageCountsForDefinitions(companyId: number, definitions: DefinitionRow[]) {
  const profiles = await db.select({ customValues: unitTechnicalProfilesTable.customValues })
    .from(unitTechnicalProfilesTable)
    .where(eq(unitTechnicalProfilesTable.companyId, companyId));
  const counts = new Map(definitions.map((definition) => [definition.code, 0]));
  for (const profile of profiles) {
    for (const definition of definitions) {
      if (customValuesHaveCode(profile.customValues, definition.code)) {
        counts.set(definition.code, (counts.get(definition.code) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function definitionChangedFields(before: DefinitionRow, after: DefinitionRow) {
  const fields = [
    "code",
    "label",
    "description",
    "fieldType",
    "unitLabel",
    "options",
    "isRequiredForPublish",
    "isActive",
    "sortOrder",
    "validationConfig",
  ] as const;
  return fields.filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
}

router.get("/unit-technical-profile-field-definitions", requireAuth, async (req, res) => {
  try {
    const scope = await resolveCompanyScope(req);
    const includeInactive = req.query.includeInactive === "true";
    const conditions = [eq(unitTechnicalProfileFieldDefinitionsTable.companyId, scope.companyId)];
    if (!includeInactive) conditions.push(eq(unitTechnicalProfileFieldDefinitionsTable.isActive, true));
    const definitions = await db.select()
      .from(unitTechnicalProfileFieldDefinitionsTable)
      .where(and(...conditions))
      .orderBy(
        asc(unitTechnicalProfileFieldDefinitionsTable.sortOrder),
        asc(unitTechnicalProfileFieldDefinitionsTable.label),
      );
    const counts = await usageCountsForDefinitions(scope.companyId, definitions);
    res.json({
      definitions: definitions.map((definition) => serializeDefinition(definition, counts.get(definition.code) ?? 0)),
      permissions: { canEdit: scope.canEdit },
    });
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Sunucu hatasi" });
  }
});

router.post("/unit-technical-profile-field-definitions", requireAuth, async (req, res) => {
  try {
    const scope = await resolveCompanyScope(req);
    if (!scope.canEdit) {
      res.status(403).json({ error: "Teknik profil alan tanimi duzenleme yetkiniz yok" });
      return;
    }
    const parsed = unitTechnicalProfileCustomFieldDefinitionCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Gecersiz alan tanimi" });
      return;
    }

    const now = new Date();
    const [created] = await db.insert(unitTechnicalProfileFieldDefinitionsTable)
      .values({
        companyId: scope.companyId,
        ...parsed.data,
        description: parsed.data.description ?? null,
        unitLabel: parsed.data.unitLabel ?? null,
        createdAt: now,
        createdBy: scope.userId,
        updatedAt: now,
        updatedBy: scope.userId,
      })
      .onConflictDoNothing({
        target: [
          unitTechnicalProfileFieldDefinitionsTable.companyId,
          unitTechnicalProfileFieldDefinitionsTable.code,
        ],
      })
      .returning();
    if (!created) {
      res.status(409).json({ error: "Bu kodda firma ozel teknik profil alani zaten var" });
      return;
    }

    await writeAuditEvent(db, {
      request: req,
      companyId: scope.companyId,
      action: "unit_technical_profile_field.created",
      entityType: "unit_technical_profile_field",
      entityId: created.id,
      changes: {
        changedFields: Object.keys(parsed.data),
        previousVersion: 0,
        newVersion: created.definitionVersion,
      },
      metadata: { code: created.code, fieldType: created.fieldType },
    });
    res.status(201).json({ definition: serializeDefinition(created, 0) });
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Sunucu hatasi" });
  }
});

router.patch("/unit-technical-profile-field-definitions/:id", requireAuth, async (req, res) => {
  try {
    const id = parsePositiveInteger(req.params.id, "id");
    const scope = await resolveCompanyScope(req);
    if (!scope.canEdit) {
      res.status(403).json({ error: "Teknik profil alan tanimi duzenleme yetkiniz yok" });
      return;
    }
    const parsed = unitTechnicalProfileCustomFieldDefinitionPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Gecersiz alan tanimi" });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [existing] = await tx.select()
        .from(unitTechnicalProfileFieldDefinitionsTable)
        .where(and(
          eq(unitTechnicalProfileFieldDefinitionsTable.id, id),
          eq(unitTechnicalProfileFieldDefinitionsTable.companyId, scope.companyId),
        ))
        .limit(1)
        .for("update");
      if (!existing) return { status: "not-found" as const };
      if (existing.definitionVersion !== parsed.data.expectedDefinitionVersion) {
        return { status: "conflict" as const, definition: existing };
      }

      const usageCount = await usageCountForCode(scope.companyId, existing.code);
      if (usageCount > 0 && parsed.data.code !== undefined && parsed.data.code !== existing.code) {
        return { status: "immutable" as const, error: "Kullanilmis alan kodu degistirilemez" };
      }
      if (usageCount > 0 && parsed.data.fieldType !== undefined && parsed.data.fieldType !== existing.fieldType) {
        return { status: "immutable" as const, error: "Kullanilmis alan tipi degistirilemez" };
      }

      const { expectedDefinitionVersion: _expected, ...patch } = parsed.data;
      const now = new Date();
      const [updated] = await tx.update(unitTechnicalProfileFieldDefinitionsTable)
        .set({
          ...patch,
          description: "description" in patch ? patch.description ?? null : undefined,
          unitLabel: "unitLabel" in patch ? patch.unitLabel ?? null : undefined,
          definitionVersion: existing.definitionVersion + 1,
          updatedAt: now,
          updatedBy: scope.userId,
        })
        .where(and(
          eq(unitTechnicalProfileFieldDefinitionsTable.id, existing.id),
          eq(unitTechnicalProfileFieldDefinitionsTable.definitionVersion, existing.definitionVersion),
        ))
        .returning();
      if (!updated) return { status: "conflict" as const, definition: existing };

      const action: AuditAction = existing.isActive === false && updated.isActive === true
        ? "unit_technical_profile_field.reactivated"
        : "unit_technical_profile_field.updated";
      await writeAuditEvent(tx, {
        request: req,
        companyId: scope.companyId,
        action,
        entityType: "unit_technical_profile_field",
        entityId: updated.id,
        changes: {
          changedFields: definitionChangedFields(existing, updated),
          previousVersion: existing.definitionVersion,
          newVersion: updated.definitionVersion,
        },
        metadata: { code: updated.code, usageCount },
      });
      return { status: "ok" as const, definition: updated, usageCount };
    });

    if (result.status === "not-found") {
      res.status(404).json({ error: "Alan tanimi bulunamadi" });
      return;
    }
    if (result.status === "conflict") {
      res.status(409).json({
        error: "Alan tanimi baska bir oturum tarafindan guncellendi.",
        definition: serializeDefinition(result.definition, await usageCountForCode(scope.companyId, result.definition.code)),
      });
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
    res.status(500).json({ error: "Sunucu hatasi" });
  }
});

router.post("/unit-technical-profile-field-definitions/:id/archive", requireAuth, async (req, res) => {
  try {
    const id = parsePositiveInteger(req.params.id, "id");
    const scope = await resolveCompanyScope(req);
    if (!scope.canEdit) {
      res.status(403).json({ error: "Teknik profil alan tanimi duzenleme yetkiniz yok" });
      return;
    }
    const parsed = unitTechnicalProfileCustomFieldDefinitionArchiveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Gecersiz alan tanimi" });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [existing] = await tx.select()
        .from(unitTechnicalProfileFieldDefinitionsTable)
        .where(and(
          eq(unitTechnicalProfileFieldDefinitionsTable.id, id),
          eq(unitTechnicalProfileFieldDefinitionsTable.companyId, scope.companyId),
        ))
        .limit(1)
        .for("update");
      if (!existing) return { status: "not-found" as const };
      if (existing.definitionVersion !== parsed.data.expectedDefinitionVersion) {
        return { status: "conflict" as const, definition: existing };
      }

      const usageCount = await usageCountForCode(scope.companyId, existing.code);
      const now = new Date();
      const [updated] = await tx.update(unitTechnicalProfileFieldDefinitionsTable)
        .set({
          isActive: false,
          definitionVersion: existing.definitionVersion + 1,
          updatedAt: now,
          updatedBy: scope.userId,
        })
        .where(and(
          eq(unitTechnicalProfileFieldDefinitionsTable.id, existing.id),
          eq(unitTechnicalProfileFieldDefinitionsTable.definitionVersion, existing.definitionVersion),
        ))
        .returning();
      if (!updated) return { status: "conflict" as const, definition: existing };

      await writeAuditEvent(tx, {
        request: req,
        companyId: scope.companyId,
        action: "unit_technical_profile_field.archived",
        entityType: "unit_technical_profile_field",
        entityId: updated.id,
        changes: {
          changedFields: ["isActive"],
          previousVersion: existing.definitionVersion,
          newVersion: updated.definitionVersion,
        },
        metadata: { code: updated.code, usageCount },
      });
      return { status: "ok" as const, definition: updated, usageCount };
    });

    if (result.status === "not-found") {
      res.status(404).json({ error: "Alan tanimi bulunamadi" });
      return;
    }
    if (result.status === "conflict") {
      res.status(409).json({
        error: "Alan tanimi baska bir oturum tarafindan guncellendi.",
        definition: serializeDefinition(result.definition, await usageCountForCode(scope.companyId, result.definition.code)),
      });
      return;
    }
    res.json({ definition: serializeDefinition(result.definition, result.usageCount) });
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Sunucu hatasi" });
  }
});

export default router;
