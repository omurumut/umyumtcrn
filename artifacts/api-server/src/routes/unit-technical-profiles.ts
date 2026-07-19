import { Router, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import {
  companiesTable,
  db,
  unitTechnicalProfilesTable,
  unitsTable,
} from "@workspace/db";
import {
  createDefaultUnitTechnicalProfile,
  unitTechnicalProfilePatchRequestSchema,
  type UnitTechnicalProfileDto,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth.js";
import { changedAuditFields, writeAuditEvent, type AuditAction } from "../lib/audit.js";

const router = Router();

const PROFILE_FIELDS = [
  "facilityUseType",
  "mainActivity",
  "buildingCount",
  "totalEnclosedAreaM2",
  "heatedAreaM2",
  "cooledAreaM2",
  "openAreaM2",
  "personnelCount",
  "averageDailyUsers",
  "dailyOperatingHours",
  "weeklyOperatingDays",
  "annualOperatingDays",
  "shiftCount",
  "shiftType",
  "seasonalOperationStatus",
  "insulationStatus",
  "heatingSystemType",
  "coolingSystemType",
  "domesticHotWaterSystem",
  "buildingAutomationStatus",
  "compressedAirStatus",
  "steamSystemStatus",
  "generatorStatus",
  "renewableEnergyStatus",
  "mainProcessDescription",
  "energyInfrastructureDescription",
  "knownEnergyIssues",
  "technicalImprovements",
  "plannedInfrastructureChanges",
  "profileStatus",
] as const;

type ProfileField = typeof PROFILE_FIELDS[number];
type ProfilePatch = Partial<Pick<typeof unitTechnicalProfilesTable.$inferInsert, ProfileField>>;

class UnitTechnicalProfileScopeError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function isCompanyAdmin(role: string) {
  return role === "admin" || role === "kontrol_admin";
}

function isSuperAdmin(role: string) {
  return role === "superadmin";
}

function canPublish(role: string) {
  return isCompanyAdmin(role) || isSuperAdmin(role);
}

function parsePositiveInteger(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new UnitTechnicalProfileScopeError(400, `Gecersiz ${field}`);
}

function parseOptionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return parsePositiveInteger(value, field);
}

function handleScopeError(res: Response, error: unknown) {
  if (!(error instanceof UnitTechnicalProfileScopeError)) return false;
  res.status(error.status).json({ error: error.message });
  return true;
}

async function resolveScope(req: Request, unitId: number) {
  const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
  const requestedCompanyId = parseOptionalPositiveInteger(req.query.companyId, "companyId");

  if (!isSuperAdmin(role) && requestedCompanyId !== undefined) {
    throw new UnitTechnicalProfileScopeError(400, "Firma kapsami oturumdan alinir; companyId gonderilmemelidir");
  }
  if (isSuperAdmin(role) && requestedCompanyId === undefined) {
    throw new UnitTechnicalProfileScopeError(400, "Gecerli companyId zorunludur");
  }
  if (!isCompanyAdmin(role) && !isSuperAdmin(role)) {
    if (sessionUnitId === null) throw new UnitTechnicalProfileScopeError(403, "Birim yetkisi gerekli");
    if (unitId !== sessionUnitId) throw new UnitTechnicalProfileScopeError(403, "Yetki yok");
  }

  const companyId = isSuperAdmin(role) ? requestedCompanyId! : sessionCompanyId;
  const [company] = await db.select({ id: companiesTable.id })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .limit(1);
  if (!company) throw new UnitTechnicalProfileScopeError(404, "Sirket bulunamadi");

  const [unit] = await db.select({ id: unitsTable.id, companyId: unitsTable.companyId })
    .from(unitsTable)
    .where(and(eq(unitsTable.id, unitId), eq(unitsTable.companyId, companyId)))
    .limit(1);
  if (!unit) throw new UnitTechnicalProfileScopeError(isSuperAdmin(role) ? 403 : 404, "Birim bulunamadi");

  return {
    role,
    userId: req.user!.userId,
    companyId,
    unitId,
    canEdit: true,
    canPublish: canPublish(role),
  };
}

function serializeProfile(profile: typeof unitTechnicalProfilesTable.$inferSelect | null, companyId: number, unitId: number): UnitTechnicalProfileDto {
  if (!profile) return createDefaultUnitTechnicalProfile(companyId, unitId);
  return {
    id: profile.id,
    companyId: profile.companyId,
    unitId: profile.unitId,
    exists: true,
    facilityUseType: profile.facilityUseType,
    mainActivity: profile.mainActivity,
    buildingCount: profile.buildingCount,
    totalEnclosedAreaM2: profile.totalEnclosedAreaM2,
    heatedAreaM2: profile.heatedAreaM2,
    cooledAreaM2: profile.cooledAreaM2,
    openAreaM2: profile.openAreaM2,
    personnelCount: profile.personnelCount,
    averageDailyUsers: profile.averageDailyUsers,
    dailyOperatingHours: profile.dailyOperatingHours,
    weeklyOperatingDays: profile.weeklyOperatingDays,
    annualOperatingDays: profile.annualOperatingDays,
    shiftCount: profile.shiftCount,
    shiftType: profile.shiftType,
    seasonalOperationStatus: profile.seasonalOperationStatus as UnitTechnicalProfileDto["seasonalOperationStatus"],
    insulationStatus: profile.insulationStatus as UnitTechnicalProfileDto["insulationStatus"],
    heatingSystemType: profile.heatingSystemType,
    coolingSystemType: profile.coolingSystemType,
    domesticHotWaterSystem: profile.domesticHotWaterSystem,
    buildingAutomationStatus: profile.buildingAutomationStatus as UnitTechnicalProfileDto["buildingAutomationStatus"],
    compressedAirStatus: profile.compressedAirStatus as UnitTechnicalProfileDto["compressedAirStatus"],
    steamSystemStatus: profile.steamSystemStatus as UnitTechnicalProfileDto["steamSystemStatus"],
    generatorStatus: profile.generatorStatus as UnitTechnicalProfileDto["generatorStatus"],
    renewableEnergyStatus: profile.renewableEnergyStatus as UnitTechnicalProfileDto["renewableEnergyStatus"],
    mainProcessDescription: profile.mainProcessDescription,
    energyInfrastructureDescription: profile.energyInfrastructureDescription,
    knownEnergyIssues: profile.knownEnergyIssues,
    technicalImprovements: profile.technicalImprovements,
    plannedInfrastructureChanges: profile.plannedInfrastructureChanges,
    profileStatus: profile.profileStatus as UnitTechnicalProfileDto["profileStatus"],
    profileVersion: profile.profileVersion,
    createdAt: profile.createdAt.toISOString(),
    createdBy: profile.createdBy,
    updatedAt: profile.updatedAt.toISOString(),
    updatedBy: profile.updatedBy,
  };
}

function responseFor(profile: typeof unitTechnicalProfilesTable.$inferSelect | null, scope: Awaited<ReturnType<typeof resolveScope>>) {
  return {
    profile: serializeProfile(profile, scope.companyId, scope.unitId),
    permissions: {
      canEdit: scope.canEdit,
      canPublish: scope.canPublish,
    },
  };
}

function patchValues(parsedBody: Record<string, unknown>): ProfilePatch {
  const patch: ProfilePatch = {};
  for (const field of PROFILE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(parsedBody, field)) {
      (patch as Record<string, unknown>)[field] = parsedBody[field];
    }
  }
  return patch;
}

router.get("/unit-technical-profiles/:unitId", requireAuth, async (req, res) => {
  try {
    const unitId = parsePositiveInteger(req.params.unitId, "unitId");
    const scope = await resolveScope(req, unitId);
    const [profile] = await db.select()
      .from(unitTechnicalProfilesTable)
      .where(and(
        eq(unitTechnicalProfilesTable.companyId, scope.companyId),
        eq(unitTechnicalProfilesTable.unitId, scope.unitId),
      ))
      .limit(1);
    res.json(responseFor(profile ?? null, scope));
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Sunucu hatasi" });
  }
});

router.patch("/unit-technical-profiles/:unitId", requireAuth, async (req, res) => {
  try {
    const unitId = parsePositiveInteger(req.params.unitId, "unitId");
    const scope = await resolveScope(req, unitId);
    const parsed = unitTechnicalProfilePatchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Gecersiz teknik profil verisi" });
      return;
    }
    if (parsed.data.profileStatus === "published" && !scope.canPublish) {
      res.status(403).json({ error: "Teknik profili yayimlama yetkiniz yok" });
      return;
    }

    const updates = patchValues(parsed.data);
    const expectedProfileVersion = parsed.data.expectedProfileVersion;
    const result = await db.transaction(async (tx) => {
      const [unit] = await tx.select({ id: unitsTable.id })
        .from(unitsTable)
        .where(and(eq(unitsTable.id, scope.unitId), eq(unitsTable.companyId, scope.companyId)))
        .limit(1)
        .for("update");
      if (!unit) return { status: "not-found" as const };

      const [existing] = await tx.select()
        .from(unitTechnicalProfilesTable)
        .where(and(
          eq(unitTechnicalProfilesTable.companyId, scope.companyId),
          eq(unitTechnicalProfilesTable.unitId, scope.unitId),
        ))
        .limit(1)
        .for("update");

      const now = new Date();
      if (!existing) {
        if (expectedProfileVersion !== 0) return { status: "conflict" as const, profile: null };
        const [created] = await tx.insert(unitTechnicalProfilesTable)
          .values({
            companyId: scope.companyId,
            unitId: scope.unitId,
            ...updates,
            profileStatus: typeof updates.profileStatus === "string" ? updates.profileStatus : "draft",
            profileVersion: 1,
            createdAt: now,
            createdBy: scope.userId,
            updatedAt: now,
            updatedBy: scope.userId,
          })
          .onConflictDoNothing({ target: unitTechnicalProfilesTable.unitId })
          .returning();
        if (!created) return { status: "conflict" as const, profile: null };

        await writeAuditEvent(tx, {
          request: req,
          companyId: scope.companyId,
          unitId: scope.unitId,
          action: created.profileStatus === "published" ? "unit_technical_profile.published" : "unit_technical_profile.created",
          entityType: "unit_technical_profile",
          entityId: created.id,
          changes: {
            changedFields: Object.keys(updates),
            previousVersion: 0,
            newVersion: created.profileVersion,
          },
        });
        return { status: "ok" as const, profile: created };
      }

      if (existing.profileVersion !== expectedProfileVersion) {
        return { status: "conflict" as const, profile: existing };
      }

      const nextProfile = {
        ...existing,
        ...updates,
        updatedAt: now,
        updatedBy: scope.userId,
        profileVersion: existing.profileVersion + 1,
      };
      const changedFields = Object.keys(changedAuditFields(existing, nextProfile, [...PROFILE_FIELDS]));
      if (changedFields.length === 0) return { status: "ok" as const, profile: existing };

      const [updated] = await tx.update(unitTechnicalProfilesTable)
        .set({
          ...updates,
          profileVersion: existing.profileVersion + 1,
          updatedAt: now,
          updatedBy: scope.userId,
        })
        .where(and(
          eq(unitTechnicalProfilesTable.id, existing.id),
          eq(unitTechnicalProfilesTable.profileVersion, expectedProfileVersion),
        ))
        .returning();
      if (!updated) return { status: "conflict" as const, profile: existing };

      const action: AuditAction = existing.profileStatus !== "published" && updated.profileStatus === "published"
        ? "unit_technical_profile.published"
        : "unit_technical_profile.updated";
      await writeAuditEvent(tx, {
        request: req,
        companyId: scope.companyId,
        unitId: scope.unitId,
        action,
        entityType: "unit_technical_profile",
        entityId: updated.id,
        changes: {
          changedFields,
          previousVersion: existing.profileVersion,
          newVersion: updated.profileVersion,
        },
      });
      return { status: "ok" as const, profile: updated };
    });

    if (result.status === "not-found") {
      res.status(404).json({ error: "Birim bulunamadi" });
      return;
    }
    if (result.status === "conflict") {
      const [current] = result.profile ? [result.profile] : await db.select()
        .from(unitTechnicalProfilesTable)
        .where(and(
          eq(unitTechnicalProfilesTable.companyId, scope.companyId),
          eq(unitTechnicalProfilesTable.unitId, scope.unitId),
        ))
        .limit(1);
      res.status(409).json({
        error: "Birim teknik profili baska bir oturum tarafindan guncellendi. Guncel bilgileri yeniden yukleyin.",
        profile: serializeProfile(current ?? null, scope.companyId, scope.unitId),
      });
      return;
    }

    res.json(responseFor(result.profile, scope));
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Sunucu hatasi" });
  }
});

export default router;
