import { Router, type Request, type Response } from "express";
import { and, asc, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import {
  companiesTable,
  db,
  unitTechnicalProfileFieldDefinitionsTable,
  unitTechnicalProfilesTable,
  unitTechnicalProfileSnapshotsTable,
  unitsTable,
  usersTable,
} from "@workspace/db";
import {
  calculateUnitTechnicalProfileCompletion,
  createDefaultUnitTechnicalProfile,
  missingRequiredUnitTechnicalProfileCustomFieldsForPublish,
  unitTechnicalProfilePatchRequestSchema,
  unitTechnicalProfilePublishRequestSchema,
  validateUnitTechnicalProfileCustomFieldValues,
  validateUnitTechnicalProfilePublishMinimum,
  type UnitTechnicalProfileCustomFieldDefinitionDto,
  type UnitTechnicalProfileDto,
  type UnitTechnicalProfileSnapshotDetail,
  type UnitTechnicalProfileSnapshotSummary,
  type UnitTechnicalProfileValues,
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

const STANDARD_SNAPSHOT_FIELDS = PROFILE_FIELDS.filter((field) => field !== "profileStatus");

type ProfileField = typeof PROFILE_FIELDS[number];
type ProfilePatch = Partial<Pick<typeof unitTechnicalProfilesTable.$inferInsert, ProfileField>>;
type CustomFieldValues = Record<string, unknown>;
type DefinitionRow = typeof unitTechnicalProfileFieldDefinitionsTable.$inferSelect;
type ProfileRow = typeof unitTechnicalProfilesTable.$inferSelect;
type SnapshotRow = typeof unitTechnicalProfileSnapshotsTable.$inferSelect;

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

function parseIsoDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new UnitTechnicalProfileScopeError(400, `Gecersiz ${field}`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new UnitTechnicalProfileScopeError(400, `Gecersiz ${field}`);
  }
  return value;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
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

function serializeProfile(profile: ProfileRow | null, companyId: number, unitId: number): UnitTechnicalProfileDto {
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

function serializeDefinition(row: DefinitionRow): UnitTechnicalProfileCustomFieldDefinitionDto {
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
  };
}

function profileCustomValues(profile: ProfileRow | null): CustomFieldValues {
  const values = profile?.customValues;
  return values && typeof values === "object" && !Array.isArray(values) ? values : {};
}

async function getDefinitionsForProfile(companyId: number, customValues: CustomFieldValues) {
  const rows = await db.select()
    .from(unitTechnicalProfileFieldDefinitionsTable)
    .where(eq(unitTechnicalProfileFieldDefinitionsTable.companyId, companyId))
    .orderBy(
      asc(unitTechnicalProfileFieldDefinitionsTable.sortOrder),
      asc(unitTechnicalProfileFieldDefinitionsTable.label),
    );
  return rows
    .filter((row) => row.isActive || Object.prototype.hasOwnProperty.call(customValues, row.code))
    .map(serializeDefinition);
}

async function responseFor(profile: ProfileRow | null, scope: Awaited<ReturnType<typeof resolveScope>>) {
  const customFieldValues = profileCustomValues(profile);
  return {
    profile: serializeProfile(profile, scope.companyId, scope.unitId),
    customFieldDefinitions: await getDefinitionsForProfile(scope.companyId, customFieldValues),
    customFieldValues,
    permissions: {
      canEdit: scope.canEdit,
      canPublish: scope.canPublish,
    },
  };
}

function standardSnapshotValues(profile: ProfileRow) {
  const values: Record<string, unknown> = {};
  for (const field of STANDARD_SNAPSHOT_FIELDS) values[field] = profile[field];
  values.profileStatus = "published";
  return values;
}

function definitionSnapshot(definitions: DefinitionRow[]) {
  return definitions.map((definition) => ({
    id: definition.id,
    code: definition.code,
    label: definition.label,
    description: definition.description,
    fieldType: definition.fieldType,
    unitLabel: definition.unitLabel,
    options: definition.options ?? [],
    isActive: definition.isActive,
    isRequiredForPublish: definition.isRequiredForPublish,
    sortOrder: definition.sortOrder,
    definitionVersion: definition.definitionVersion,
  }));
}

function snapshotToSummary(
  snapshot: SnapshotRow,
  publishedByName?: string | null,
): UnitTechnicalProfileSnapshotSummary {
  const today = todayIsoDate();
  return {
    id: snapshot.id,
    companyId: snapshot.companyId,
    unitId: snapshot.unitId,
    sourceProfileId: snapshot.sourceProfileId,
    snapshotNumber: snapshot.snapshotNumber,
    profileVersion: snapshot.profileVersion,
    profileStatus: "published",
    validFrom: snapshot.validFrom,
    validTo: snapshot.validTo,
    publishedAt: snapshot.publishedAt.toISOString(),
    publishedBy: snapshot.publishedBy,
    publishedByName: publishedByName ?? null,
    completionPercentage: snapshot.completionPercentage,
    changeSummary: snapshot.changeSummary,
    isCurrent: snapshot.validTo === null,
    isEffectiveToday: snapshot.validFrom <= today && (snapshot.validTo === null || snapshot.validTo > today),
  };
}

function snapshotToDetail(snapshot: SnapshotRow, publishedByName?: string | null): UnitTechnicalProfileSnapshotDetail {
  return {
    ...snapshotToSummary(snapshot, publishedByName),
    standardValues: snapshot.standardValues,
    customFieldValues: snapshot.customValues,
    customFieldDefinitions: (snapshot.customDefinitionSnapshot ?? []) as UnitTechnicalProfileCustomFieldDefinitionDto[],
  };
}

function missingPublishDetails(profile: UnitTechnicalProfileValues, definitions: DefinitionRow[], customValues: CustomFieldValues) {
  const missingFields = validateUnitTechnicalProfilePublishMinimum(profile);
  const missingCustomFields = missingRequiredUnitTechnicalProfileCustomFieldsForPublish(
    definitions.map(serializeDefinition),
    customValues,
  );
  return { missingFields, missingCustomFields };
}

async function createPublishSnapshot(
  tx: typeof db,
  req: Request,
  scope: Awaited<ReturnType<typeof resolveScope>>,
  profile: ProfileRow,
  definitions: DefinitionRow[],
  validFrom: string,
  changeSummary: string | null,
) {
  const [latestSnapshot] = await tx.select()
    .from(unitTechnicalProfileSnapshotsTable)
    .where(and(
      eq(unitTechnicalProfileSnapshotsTable.companyId, scope.companyId),
      eq(unitTechnicalProfileSnapshotsTable.unitId, scope.unitId),
    ))
    .orderBy(desc(unitTechnicalProfileSnapshotsTable.snapshotNumber))
    .limit(1)
    .for("update");

  if (latestSnapshot && validFrom <= latestSnapshot.validFrom) {
    return { status: "date-conflict" as const, latestSnapshot };
  }

  if (latestSnapshot && latestSnapshot.validTo === null) {
    await tx.update(unitTechnicalProfileSnapshotsTable)
      .set({ validTo: validFrom })
      .where(eq(unitTechnicalProfileSnapshotsTable.id, latestSnapshot.id));
  }

  const completion = calculateUnitTechnicalProfileCompletion(serializeProfile(profile, scope.companyId, scope.unitId));
  const [snapshot] = await tx.insert(unitTechnicalProfileSnapshotsTable)
    .values({
      companyId: scope.companyId,
      unitId: scope.unitId,
      sourceProfileId: profile.id,
      snapshotNumber: (latestSnapshot?.snapshotNumber ?? 0) + 1,
      profileVersion: profile.profileVersion,
      profileStatus: "published",
      validFrom,
      validTo: null,
      publishedAt: new Date(),
      publishedBy: scope.userId,
      standardValues: standardSnapshotValues(profile),
      customValues: profileCustomValues(profile),
      customDefinitionSnapshot: definitionSnapshot(definitions),
      completionPercentage: completion.ratio,
      changeSummary,
    })
    .returning();

  await writeAuditEvent(tx, {
    request: req,
    companyId: scope.companyId,
    unitId: scope.unitId,
    action: "unit_technical_profile.snapshot_created",
    entityType: "unit_technical_profile_snapshot",
    entityId: snapshot.id,
    changes: {
      previousSnapshotNumber: latestSnapshot?.snapshotNumber ?? null,
      snapshotNumber: snapshot.snapshotNumber,
      profileVersion: profile.profileVersion,
    },
    metadata: { validFrom, changeSummary, snapshotNumber: snapshot.snapshotNumber },
  });
  return { status: "ok" as const, snapshot };
}

function changedCustomValueCodes(before: CustomFieldValues, after: CustomFieldValues) {
  const codes = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...codes].filter((code) => JSON.stringify(before[code] ?? null) !== JSON.stringify(after[code] ?? null));
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

function mergedProfileValues(
  current: UnitTechnicalProfileDto,
  updates: ProfilePatch,
): UnitTechnicalProfileValues {
  const valueFor = <Field extends keyof UnitTechnicalProfileValues>(field: Field): UnitTechnicalProfileValues[Field] =>
    Object.prototype.hasOwnProperty.call(updates, field)
      ? (updates as Partial<UnitTechnicalProfileValues>)[field] as UnitTechnicalProfileValues[Field]
      : current[field];

  return {
    facilityUseType: valueFor("facilityUseType"),
    mainActivity: valueFor("mainActivity"),
    buildingCount: valueFor("buildingCount"),
    totalEnclosedAreaM2: valueFor("totalEnclosedAreaM2"),
    heatedAreaM2: valueFor("heatedAreaM2"),
    cooledAreaM2: valueFor("cooledAreaM2"),
    openAreaM2: valueFor("openAreaM2"),
    personnelCount: valueFor("personnelCount"),
    averageDailyUsers: valueFor("averageDailyUsers"),
    dailyOperatingHours: valueFor("dailyOperatingHours"),
    weeklyOperatingDays: valueFor("weeklyOperatingDays"),
    annualOperatingDays: valueFor("annualOperatingDays"),
    shiftCount: valueFor("shiftCount"),
    shiftType: valueFor("shiftType"),
    seasonalOperationStatus: valueFor("seasonalOperationStatus"),
    insulationStatus: valueFor("insulationStatus"),
    heatingSystemType: valueFor("heatingSystemType"),
    coolingSystemType: valueFor("coolingSystemType"),
    domesticHotWaterSystem: valueFor("domesticHotWaterSystem"),
    buildingAutomationStatus: valueFor("buildingAutomationStatus"),
    compressedAirStatus: valueFor("compressedAirStatus"),
    steamSystemStatus: valueFor("steamSystemStatus"),
    generatorStatus: valueFor("generatorStatus"),
    renewableEnergyStatus: valueFor("renewableEnergyStatus"),
    mainProcessDescription: valueFor("mainProcessDescription"),
    energyInfrastructureDescription: valueFor("energyInfrastructureDescription"),
    knownEnergyIssues: valueFor("knownEnergyIssues"),
    technicalImprovements: valueFor("technicalImprovements"),
    plannedInfrastructureChanges: valueFor("plannedInfrastructureChanges"),
    profileStatus: valueFor("profileStatus"),
  };
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
    res.json(await responseFor(profile ?? null, scope));
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Sunucu hatasi" });
  }
});

router.get("/unit-technical-profiles/:unitId/history", requireAuth, async (req, res) => {
  try {
    const unitId = parsePositiveInteger(req.params.unitId, "unitId");
    const scope = await resolveScope(req, unitId);
    const limit = Math.min(parseOptionalPositiveInteger(req.query.limit, "limit") ?? 20, 100);
    const offset = parseOptionalPositiveInteger(req.query.offset, "offset") ?? 0;
    const rows = await db.select({
      snapshot: unitTechnicalProfileSnapshotsTable,
      publishedByName: usersTable.name,
    })
      .from(unitTechnicalProfileSnapshotsTable)
      .leftJoin(usersTable, eq(usersTable.id, unitTechnicalProfileSnapshotsTable.publishedBy))
      .where(and(
        eq(unitTechnicalProfileSnapshotsTable.companyId, scope.companyId),
        eq(unitTechnicalProfileSnapshotsTable.unitId, scope.unitId),
      ))
      .orderBy(desc(unitTechnicalProfileSnapshotsTable.snapshotNumber))
      .limit(limit + 1)
      .offset(offset);
    const items = rows.slice(0, limit).map((row) => snapshotToSummary(row.snapshot, row.publishedByName));
    res.json({
      items,
      total: offset + items.length + (rows.length > limit ? 1 : 0),
      limit,
      offset,
      hasNext: rows.length > limit,
      permissions: { canEdit: scope.canEdit, canPublish: scope.canPublish },
    });
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Teknik profil tarihcesi alinamadi" });
  }
});

router.get("/unit-technical-profiles/:unitId/effective", requireAuth, async (req, res) => {
  try {
    const unitId = parsePositiveInteger(req.params.unitId, "unitId");
    const scope = await resolveScope(req, unitId);
    const date = parseIsoDate(req.query.date, "date");
    const [row] = await db.select({
      snapshot: unitTechnicalProfileSnapshotsTable,
      publishedByName: usersTable.name,
    })
      .from(unitTechnicalProfileSnapshotsTable)
      .leftJoin(usersTable, eq(usersTable.id, unitTechnicalProfileSnapshotsTable.publishedBy))
      .where(and(
        eq(unitTechnicalProfileSnapshotsTable.companyId, scope.companyId),
        eq(unitTechnicalProfileSnapshotsTable.unitId, scope.unitId),
        lte(unitTechnicalProfileSnapshotsTable.validFrom, date),
        or(isNull(unitTechnicalProfileSnapshotsTable.validTo), gt(unitTechnicalProfileSnapshotsTable.validTo, date)),
      ))
      .orderBy(desc(unitTechnicalProfileSnapshotsTable.validFrom))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Bu tarih icin yayimlanmis teknik profil snapshot'i yok", code: "not_found" });
      return;
    }
    res.json({ date, snapshot: snapshotToDetail(row.snapshot, row.publishedByName) });
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Gecerli teknik profil alinamadi" });
  }
});

router.get("/unit-technical-profiles/:unitId/history/:snapshotId", requireAuth, async (req, res) => {
  try {
    const unitId = parsePositiveInteger(req.params.unitId, "unitId");
    const snapshotId = parsePositiveInteger(req.params.snapshotId, "snapshotId");
    const scope = await resolveScope(req, unitId);
    const [row] = await db.select({
      snapshot: unitTechnicalProfileSnapshotsTable,
      publishedByName: usersTable.name,
    })
      .from(unitTechnicalProfileSnapshotsTable)
      .leftJoin(usersTable, eq(usersTable.id, unitTechnicalProfileSnapshotsTable.publishedBy))
      .where(and(
        eq(unitTechnicalProfileSnapshotsTable.id, snapshotId),
        eq(unitTechnicalProfileSnapshotsTable.companyId, scope.companyId),
        eq(unitTechnicalProfileSnapshotsTable.unitId, scope.unitId),
      ))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Snapshot bulunamadi" });
      return;
    }
    res.json({
      snapshot: snapshotToDetail(row.snapshot, row.publishedByName),
      permissions: { canEdit: scope.canEdit, canPublish: scope.canPublish },
    });
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Snapshot detayi alinamadi" });
  }
});

router.post("/unit-technical-profiles/:unitId/publish", requireAuth, async (req, res) => {
  try {
    const unitId = parsePositiveInteger(req.params.unitId, "unitId");
    const scope = await resolveScope(req, unitId);
    if (!scope.canPublish) {
      res.status(403).json({ error: "Teknik profili yayimlama yetkiniz yok" });
      return;
    }
    const parsed = unitTechnicalProfilePublishRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Gecersiz yayinlama verisi" });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [profile] = await tx.select()
        .from(unitTechnicalProfilesTable)
        .where(and(
          eq(unitTechnicalProfilesTable.companyId, scope.companyId),
          eq(unitTechnicalProfilesTable.unitId, scope.unitId),
        ))
        .limit(1)
        .for("update");
      if (!profile) return { status: "not-found" as const };
      if (profile.profileVersion !== parsed.data.expectedProfileVersion) {
        return { status: "conflict" as const, profile };
      }

      const definitions = await tx.select()
        .from(unitTechnicalProfileFieldDefinitionsTable)
        .where(eq(unitTechnicalProfileFieldDefinitionsTable.companyId, scope.companyId))
        .orderBy(
          asc(unitTechnicalProfileFieldDefinitionsTable.sortOrder),
          asc(unitTechnicalProfileFieldDefinitionsTable.label),
        );
      const merged = mergedProfileValues(serializeProfile(profile, scope.companyId, scope.unitId), { profileStatus: "published" });
      const missing = missingPublishDetails(merged, definitions, profileCustomValues(profile));
      if (missing.missingFields.length > 0 || missing.missingCustomFields.length > 0) {
        return { status: "publish-validation" as const, ...missing };
      }

      const now = new Date();
      const [updated] = await tx.update(unitTechnicalProfilesTable)
        .set({
          profileStatus: "published",
          profileVersion: profile.profileVersion + 1,
          updatedAt: now,
          updatedBy: scope.userId,
        })
        .where(and(
          eq(unitTechnicalProfilesTable.id, profile.id),
          eq(unitTechnicalProfilesTable.profileVersion, parsed.data.expectedProfileVersion),
        ))
        .returning();
      if (!updated) return { status: "conflict" as const, profile };

      const snapshotResult = await createPublishSnapshot(
        tx as unknown as typeof db,
        req,
        scope,
        updated,
        definitions,
        parsed.data.validFrom,
        parsed.data.changeSummary ?? null,
      );
      if (snapshotResult.status !== "ok") return snapshotResult;

      await writeAuditEvent(tx, {
        request: req,
        companyId: scope.companyId,
        unitId: scope.unitId,
        action: "unit_technical_profile.published",
        entityType: "unit_technical_profile",
        entityId: updated.id,
        changes: {
          changedFields: profile.profileStatus === "published" ? [] : ["profileStatus"],
          previousVersion: profile.profileVersion,
          newVersion: updated.profileVersion,
        },
        metadata: {
          validFrom: parsed.data.validFrom,
          changeSummary: parsed.data.changeSummary ?? null,
          snapshotNumber: snapshotResult.snapshot.snapshotNumber,
          snapshotId: snapshotResult.snapshot.id,
        },
      });

      return { status: "ok" as const, profile: updated, snapshot: snapshotResult.snapshot };
    });

    if (result.status === "not-found") {
      res.status(404).json({ error: "Yayimlanacak teknik profil bulunamadi" });
      return;
    }
    if (result.status === "conflict") {
      res.status(409).json({
        error: "Birim teknik profili baska bir oturum tarafindan guncellendi. Guncel bilgileri yeniden yukleyin.",
        profile: serializeProfile(result.profile, scope.companyId, scope.unitId),
        customFieldDefinitions: await getDefinitionsForProfile(scope.companyId, profileCustomValues(result.profile)),
        customFieldValues: profileCustomValues(result.profile),
      });
      return;
    }
    if (result.status === "date-conflict") {
      res.status(409).json({
        error: `validFrom son yayim tarihinden buyuk olmalidir (${result.latestSnapshot.validFrom}).`,
        code: "valid_from_conflict",
        latestSnapshot: snapshotToSummary(result.latestSnapshot),
      });
      return;
    }
    if (result.status === "publish-validation") {
      const missingCustomFields = result.missingCustomFields ?? [];
      res.status(422).json({
        error: "Teknik profil yayinlamak icin minimum alanlar tamamlanmalidir.",
        missingFields: [
          ...result.missingFields,
          ...missingCustomFields.map((field) => field.code),
        ],
        missingFieldDetails: [
          ...result.missingFields.map((code) => ({ kind: "standard" as const, code })),
          ...missingCustomFields,
        ],
      });
      return;
    }

    res.json({
      ...(await responseFor(result.profile, scope)),
      snapshot: snapshotToSummary(result.snapshot, req.user?.name ?? null),
    });
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Teknik profil yayimlanamadi" });
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
    const customFieldPatch = parsed.data.customFieldValues;
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
        if (updates.profileStatus === "published") {
          const merged = mergedProfileValues(createDefaultUnitTechnicalProfile(scope.companyId, scope.unitId), updates);
          const definitions = await tx.select()
            .from(unitTechnicalProfileFieldDefinitionsTable)
            .where(eq(unitTechnicalProfileFieldDefinitionsTable.companyId, scope.companyId));
          const customValidation = validateUnitTechnicalProfileCustomFieldValues(
            definitions.map(serializeDefinition),
            customFieldPatch ?? {},
          );
          if (!customValidation.ok) return { status: "custom-validation" as const, error: customValidation.error };
          const missingStandardFields = validateUnitTechnicalProfilePublishMinimum(merged);
          const missingCustomFields = missingRequiredUnitTechnicalProfileCustomFieldsForPublish(
            definitions.map(serializeDefinition),
            customValidation.value,
          );
          if (missingStandardFields.length > 0 || missingCustomFields.length > 0) {
            return { status: "publish-validation" as const, missingFields: missingStandardFields, missingCustomFields };
          }
        }
        const definitions = await tx.select()
          .from(unitTechnicalProfileFieldDefinitionsTable)
          .where(eq(unitTechnicalProfileFieldDefinitionsTable.companyId, scope.companyId));
        const customValidation = customFieldPatch === undefined
          ? { ok: true as const, value: {} as CustomFieldValues }
          : validateUnitTechnicalProfileCustomFieldValues(definitions.map(serializeDefinition), customFieldPatch);
        if (!customValidation.ok) return { status: "custom-validation" as const, error: customValidation.error };
        const [created] = await tx.insert(unitTechnicalProfilesTable)
          .values({
            companyId: scope.companyId,
            unitId: scope.unitId,
            ...updates,
            customValues: customValidation.value,
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
        if (Object.keys(customValidation.value).length > 0) {
          await writeAuditEvent(tx, {
            request: req,
            companyId: scope.companyId,
            unitId: scope.unitId,
            action: "unit_technical_profile.custom_values_updated",
            entityType: "unit_technical_profile",
            entityId: created.id,
            changes: {
              changedCodes: Object.keys(customValidation.value),
              previousVersion: 0,
              newVersion: created.profileVersion,
            },
          });
        }
        return { status: "ok" as const, profile: created };
      }

      if (existing.profileVersion !== expectedProfileVersion) {
        return { status: "conflict" as const, profile: existing };
      }

      if (existing.profileStatus !== "published" && updates.profileStatus === "published") {
        const merged = mergedProfileValues(serializeProfile(existing, scope.companyId, scope.unitId), updates);
        const definitions = await tx.select()
          .from(unitTechnicalProfileFieldDefinitionsTable)
          .where(eq(unitTechnicalProfileFieldDefinitionsTable.companyId, scope.companyId));
        const existingCustomValues = profileCustomValues(existing);
        const customValidation = customFieldPatch === undefined
          ? { ok: true as const, value: existingCustomValues }
          : validateUnitTechnicalProfileCustomFieldValues(definitions.map(serializeDefinition), customFieldPatch);
        if (!customValidation.ok) return { status: "custom-validation" as const, error: customValidation.error };
        const mergedCustomValues = customFieldPatch === undefined ? existingCustomValues : { ...existingCustomValues, ...customValidation.value };
        const missingStandardFields = validateUnitTechnicalProfilePublishMinimum(merged);
        const missingCustomFields = missingRequiredUnitTechnicalProfileCustomFieldsForPublish(
          definitions.map(serializeDefinition),
          mergedCustomValues,
        );
        if (missingStandardFields.length > 0 || missingCustomFields.length > 0) {
          return { status: "publish-validation" as const, missingFields: missingStandardFields, missingCustomFields };
        }
      }

      const definitions = await tx.select()
        .from(unitTechnicalProfileFieldDefinitionsTable)
        .where(eq(unitTechnicalProfileFieldDefinitionsTable.companyId, scope.companyId));
      const existingCustomValues = profileCustomValues(existing);
      const customValidation = customFieldPatch === undefined
        ? { ok: true as const, value: {} as CustomFieldValues }
        : validateUnitTechnicalProfileCustomFieldValues(definitions.map(serializeDefinition), customFieldPatch);
      if (!customValidation.ok) return { status: "custom-validation" as const, error: customValidation.error };
      const nextCustomValues = customFieldPatch === undefined
        ? existingCustomValues
        : { ...existingCustomValues, ...customValidation.value };

      const nextProfile = {
        ...existing,
        ...updates,
        customValues: nextCustomValues,
        updatedAt: now,
        updatedBy: scope.userId,
        profileVersion: existing.profileVersion + 1,
      };
      const changedFields = Object.keys(changedAuditFields(existing, nextProfile, [...PROFILE_FIELDS]));
      const changedCustomCodes = changedCustomValueCodes(existingCustomValues, nextCustomValues);
      if (changedFields.length === 0 && changedCustomCodes.length === 0) return { status: "ok" as const, profile: existing };

      const [updated] = await tx.update(unitTechnicalProfilesTable)
        .set({
          ...updates,
          customValues: nextCustomValues,
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
      if (changedCustomCodes.length > 0) {
        await writeAuditEvent(tx, {
          request: req,
          companyId: scope.companyId,
          unitId: scope.unitId,
          action: "unit_technical_profile.custom_values_updated",
          entityType: "unit_technical_profile",
          entityId: updated.id,
          changes: {
            changedCodes: changedCustomCodes,
            previousVersion: existing.profileVersion,
            newVersion: updated.profileVersion,
          },
        });
      }
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
        customFieldDefinitions: await getDefinitionsForProfile(scope.companyId, profileCustomValues(current ?? null)),
        customFieldValues: profileCustomValues(current ?? null),
      });
      return;
    }
    if (result.status === "custom-validation") {
      res.status(400).json({ error: result.error });
      return;
    }
    if (result.status === "publish-validation") {
      const missingCustomFields = result.missingCustomFields ?? [];
      res.status(422).json({
        error: "Teknik profil yayinlamak icin minimum alanlar tamamlanmalidir.",
        missingFields: [
          ...result.missingFields,
          ...missingCustomFields.map((field) => field.code),
        ],
        missingFieldDetails: [
          ...result.missingFields.map((code) => ({ kind: "standard" as const, code })),
          ...missingCustomFields,
        ],
      });
      return;
    }

    res.json(await responseFor(result.profile, scope));
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Sunucu hatasi" });
  }
});

export default router;
