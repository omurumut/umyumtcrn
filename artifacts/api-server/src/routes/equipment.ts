import { Router, type Request, type Response } from "express";
import { and, count, desc, eq, ilike, inArray, isNull, ne, or, type SQL } from "drizzle-orm";
import {
  db,
  energySourcesTable,
  energyUseGroupsTable,
  equipmentEnergySourceLinksTable,
  equipmentFieldDefinitionsTable,
  equipmentMeterLinksTable,
  equipmentTable,
  metersTable,
  subUnitsTable,
  unitsTable,
  companiesTable,
} from "@workspace/db";
import {
  equipmentArchiveRequestSchema,
  equipmentCreateRequestSchema,
  equipmentListQuerySchema,
  equipmentPatchRequestSchema,
  equipmentReactivateRequestSchema,
  type EquipmentArchiveRequest,
  type EquipmentCreateRequest,
  type EquipmentPatchRequest,
  type EquipmentReactivateRequest,
  validateEquipmentCustomFieldValues,
  changedEquipmentCustomValueCodes,
  type EquipmentCustomFieldDefinitionDto,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth.js";
import { changedAuditFields, writeAuditEvent, type AuditAction } from "../lib/audit.js";

const router = Router();

class EquipmentScopeError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type EquipmentRow = typeof equipmentTable.$inferSelect;
type MeterLinkRow = typeof equipmentMeterLinksTable.$inferSelect;
type SourceLinkRow = typeof equipmentEnergySourceLinksTable.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type MeterLinkDetail = MeterLinkRow & {
  meterName?: string | null;
  meterType?: string | null;
  meterUnit?: string | null;
  meterEnergySourceName?: string | null;
  unitId?: number | null;
  unitName?: string | null;
  subUnitId?: number | null;
  subUnitName?: string | null;
  isActive?: boolean;
};
type SourceLinkDetail = SourceLinkRow & {
  energySourceName?: string | null;
  energySourceType?: string | null;
  unitId?: number | null;
  unitName?: string | null;
  subUnitId?: number | null;
  subUnitName?: string | null;
  isActive?: boolean;
};
type DependencyWarning = { code: string; count?: number; ids?: number[] };

const EQUIPMENT_MUTABLE_FIELDS = [
  "subUnitId",
  "name",
  "equipmentKind",
  "category",
  "subType",
  "status",
  "assetCode",
  "manufacturer",
  "brand",
  "model",
  "serialNumber",
  "tagCode",
  "locationText",
  "buildingText",
  "processText",
  "parentEquipmentId",
  "energyUseGroupId",
  "customValues",
  "measurementMethod",
  "measurementConfidence",
  "ratedPowerValue",
  "ratedPowerUnit",
  "installedPowerKw",
  "capacityValue",
  "capacityUnit",
  "nominalEfficiencyPercent",
  "operationalStatus",
  "dailyOperatingHours",
  "annualOperatingHours",
  "averageLoadPercent",
  "seasonalOperationStatus",
  "purchaseDate",
  "commissioningDate",
  "manufactureYear",
  "expectedLifeYears",
  "plannedReplacementYear",
  "isEnergyIntensive",
  "isCritical",
  "criticalityReason",
  "savingPotential",
  "technicalNotes",
  "maintenanceNotes",
  "efficiencyOpportunities",
  "plannedImprovements",
] as const;

function isCompanyAdmin(role: string) {
  return role === "admin" || role === "kontrol_admin";
}

function isSuperAdmin(role: string) {
  return role === "superadmin";
}

function canArchive(role: string) {
  return isCompanyAdmin(role) || isSuperAdmin(role);
}

function parsePositiveInteger(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new EquipmentScopeError(400, `Gecersiz ${field}`);
}

function handleScopeError(res: Response, error: unknown) {
  if (!(error instanceof EquipmentScopeError)) return false;
  res.status(error.status).json({ error: error.message });
  return true;
}

async function resolveCompanyScope(req: Request) {
  const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
  const requestedCompanyId = req.query.companyId === undefined
    ? undefined
    : parsePositiveInteger(req.query.companyId, "companyId");

  if (!isSuperAdmin(role) && requestedCompanyId !== undefined) {
    throw new EquipmentScopeError(400, "Firma kapsami oturumdan alinir; companyId gonderilmemelidir");
  }
  if (isSuperAdmin(role) && requestedCompanyId === undefined) {
    throw new EquipmentScopeError(400, "Gecerli companyId zorunludur");
  }
  if (!isCompanyAdmin(role) && !isSuperAdmin(role) && sessionUnitId === null) {
    throw new EquipmentScopeError(403, "Birim yetkisi gerekli");
  }

  const companyId = isSuperAdmin(role) ? requestedCompanyId! : sessionCompanyId;
  const [company] = await db.select({ id: companiesTable.id })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .limit(1);
  if (!company) throw new EquipmentScopeError(404, "Sirket bulunamadi");

  return {
    role,
    userId: req.user!.userId,
    companyId,
    standardUnitId: !isCompanyAdmin(role) && !isSuperAdmin(role) ? sessionUnitId! : null,
    canEdit: true,
    canArchive: canArchive(role),
  };
}

async function resolveRecordScope(req: Request, equipmentId: number) {
  const scope = await resolveCompanyScope(req);
  const conditions = [
    eq(equipmentTable.id, equipmentId),
    eq(equipmentTable.companyId, scope.companyId),
  ];
  if (scope.standardUnitId !== null) conditions.push(eq(equipmentTable.unitId, scope.standardUnitId));
  const [equipment] = await db.select().from(equipmentTable).where(and(...conditions)).limit(1);
  if (!equipment) throw new EquipmentScopeError(404, "Ekipman bulunamadi");
  return { ...scope, equipment };
}

function permissions(scope: Awaited<ReturnType<typeof resolveCompanyScope>>, equipment?: EquipmentRow | null) {
  return {
    canEdit: scope.canEdit && equipment?.status !== "archived",
    canArchive: scope.canArchive && equipment?.status !== "archived",
    canReactivate: scope.canArchive && equipment?.status === "archived",
  };
}

function serializeEquipment(row: EquipmentRow) {
  return {
    ...row,
    customValues: equipmentCustomValues(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

function equipmentCustomValues(equipment: EquipmentRow | null) {
  const values = equipment?.customValues;
  return values && typeof values === "object" && !Array.isArray(values) ? values : {};
}

function serializeDefinition(row: typeof equipmentFieldDefinitionsTable.$inferSelect): EquipmentCustomFieldDefinitionDto {
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
  };
}

async function getDefinitionsForEquipment(companyId: number, customValues: Record<string, unknown>) {
  const rows = await db.select().from(equipmentFieldDefinitionsTable).where(eq(equipmentFieldDefinitionsTable.companyId, companyId));
  return rows
    .filter((row) => row.isActive || Object.prototype.hasOwnProperty.call(customValues, row.code))
    .sort((a, b) => a.displayOrder - b.displayOrder || a.label.localeCompare(b.label))
    .map(serializeDefinition);
}

async function normalizeEquipmentCustomPatch(companyId: number, existingValues: Record<string, unknown>, patch: Record<string, unknown> | undefined) {
  if (patch === undefined) return { ok: true as const, value: existingValues, changedCodes: [] as string[] };
  const definitions = await db.select().from(equipmentFieldDefinitionsTable).where(eq(equipmentFieldDefinitionsTable.companyId, companyId));
  const inactiveExistingCodes = new Set(Object.keys(existingValues));
  const validation = validateEquipmentCustomFieldValues(definitions.map(serializeDefinition), patch, {
    allowInactiveExistingCodes: inactiveExistingCodes,
    enforceRequired: true,
  });
  if (!validation.ok) return validation;
  const nextValues = { ...existingValues };
  for (const [code, value] of Object.entries(validation.value)) {
    if (value === null) delete nextValues[code];
    else nextValues[code] = value;
  }
  return { ok: true as const, value: nextValues, changedCodes: changedEquipmentCustomValueCodes(existingValues, nextValues) };
}

function serializeMeterLink(row: MeterLinkDetail) {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

function serializeSourceLink(row: SourceLinkDetail) {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

function patchValues(data: EquipmentPatchRequest) {
  const patch: Partial<typeof equipmentTable.$inferInsert> = {};
  for (const field of EQUIPMENT_MUTABLE_FIELDS) {
    if (field in data) {
      (patch as Record<string, unknown>)[field] = (data as Record<string, unknown>)[field];
    }
  }
  return patch;
}

function createValues(data: EquipmentCreateRequest, companyId: number, unitId: number, userId: number) {
  const now = new Date();
  return {
    companyId,
    unitId,
    subUnitId: data.subUnitId ?? null,
    equipmentCode: data.equipmentCode,
    name: data.name,
    equipmentKind: data.equipmentKind,
    category: data.category,
    subType: data.subType ?? null,
    status: data.status,
    assetCode: data.assetCode ?? null,
    manufacturer: data.manufacturer ?? null,
    brand: data.brand ?? null,
    model: data.model ?? null,
    serialNumber: data.serialNumber ?? null,
    tagCode: data.tagCode ?? null,
    locationText: data.locationText ?? null,
    buildingText: data.buildingText ?? null,
    processText: data.processText ?? null,
    parentEquipmentId: data.parentEquipmentId ?? null,
    energyUseGroupId: data.energyUseGroupId ?? null,
    customValues: data.customValues ?? {},
    measurementMethod: data.measurementMethod,
    measurementConfidence: data.measurementConfidence,
    ratedPowerValue: data.ratedPowerValue ?? null,
    ratedPowerUnit: data.ratedPowerUnit ?? null,
    installedPowerKw: data.installedPowerKw ?? null,
    capacityValue: data.capacityValue ?? null,
    capacityUnit: data.capacityUnit ?? null,
    nominalEfficiencyPercent: data.nominalEfficiencyPercent ?? null,
    operationalStatus: data.operationalStatus ?? null,
    dailyOperatingHours: data.dailyOperatingHours ?? null,
    annualOperatingHours: data.annualOperatingHours ?? null,
    averageLoadPercent: data.averageLoadPercent ?? null,
    seasonalOperationStatus: data.seasonalOperationStatus ?? null,
    purchaseDate: data.purchaseDate ?? null,
    commissioningDate: data.commissioningDate ?? null,
    manufactureYear: data.manufactureYear ?? null,
    expectedLifeYears: data.expectedLifeYears ?? null,
    plannedReplacementYear: data.plannedReplacementYear ?? null,
    isEnergyIntensive: data.isEnergyIntensive,
    isCritical: data.isCritical,
    criticalityReason: data.criticalityReason ?? null,
    savingPotential: data.savingPotential ?? null,
    technicalNotes: data.technicalNotes ?? null,
    maintenanceNotes: data.maintenanceNotes ?? null,
    efficiencyOpportunities: data.efficiencyOpportunities ?? null,
    plannedImprovements: data.plannedImprovements ?? null,
    equipmentVersion: 1,
    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
    archivedAt: data.status === "archived" ? now : null,
    archivedBy: data.status === "archived" ? userId : null,
  } satisfies typeof equipmentTable.$inferInsert;
}

function dateYear(value: string | null | undefined) {
  if (!value) return null;
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(value);
  return match ? Number(match[1]) : null;
}

function validateLifecycleFields(values: {
  status?: string | null;
  operationalStatus?: string | null;
  purchaseDate?: string | null;
  commissioningDate?: string | null;
  manufactureYear?: number | null;
  expectedLifeYears?: number | null;
  plannedReplacementYear?: number | null;
}) {
  const currentYear = new Date().getUTCFullYear();
  if (values.status === "archived" && values.operationalStatus === "running") {
    throw new EquipmentScopeError(400, "Arsivli ekipman running operasyon durumunda olamaz");
  }
  if (values.manufactureYear !== null && values.manufactureYear !== undefined) {
    if (values.manufactureYear < 1900 || values.manufactureYear > currentYear + 1) {
      throw new EquipmentScopeError(400, "Uretim yili makul aralikta olmalidir");
    }
  }
  const purchaseYear = dateYear(values.purchaseDate);
  const commissioningYear = dateYear(values.commissioningDate);
  if (values.manufactureYear !== null && values.manufactureYear !== undefined && purchaseYear !== null && purchaseYear < values.manufactureYear) {
    throw new EquipmentScopeError(400, "Satin alma tarihi uretim yilindan once olamaz");
  }
  if (values.plannedReplacementYear !== null && values.plannedReplacementYear !== undefined) {
    if (values.manufactureYear !== null && values.manufactureYear !== undefined && values.plannedReplacementYear < values.manufactureYear) {
      throw new EquipmentScopeError(400, "Planlanan yenileme yili uretim yilindan once olamaz");
    }
    if (commissioningYear !== null && values.plannedReplacementYear < commissioningYear) {
      throw new EquipmentScopeError(400, "Planlanan yenileme yili devreye alma yilindan once olamaz");
    }
  }
}

async function validateUnit(scope: Awaited<ReturnType<typeof resolveCompanyScope>>, unitId: number) {
  if (scope.standardUnitId !== null && unitId !== scope.standardUnitId) {
    throw new EquipmentScopeError(403, "Yetki yok");
  }
  const [unit] = await db.select({ id: unitsTable.id, active: unitsTable.active })
    .from(unitsTable)
    .where(and(eq(unitsTable.id, unitId), eq(unitsTable.companyId, scope.companyId)))
    .limit(1);
  if (!unit) throw new EquipmentScopeError(isSuperAdmin(scope.role) ? 403 : 404, "Birim bulunamadi");
  return unit;
}

async function validateRelations(params: {
  tx: Tx | typeof db;
  companyId: number;
  unitId: number;
  equipmentId?: number;
  subUnitId: number | null | undefined;
  parentEquipmentId: number | null | undefined;
  energyUseGroupId: number | null | undefined;
  meterLinks: EquipmentCreateRequest["meterLinks"] | undefined;
  energySourceLinks: EquipmentCreateRequest["energySourceLinks"] | undefined;
}) {
  const { tx, companyId, unitId, equipmentId, subUnitId, parentEquipmentId, energyUseGroupId, meterLinks, energySourceLinks } = params;
  if (subUnitId !== undefined && subUnitId !== null) {
    const [subUnit] = await tx.select({ id: subUnitsTable.id })
      .from(subUnitsTable)
      .where(and(eq(subUnitsTable.id, subUnitId), eq(subUnitsTable.companyId, companyId), eq(subUnitsTable.unitId, unitId)))
      .limit(1);
    if (!subUnit) throw new EquipmentScopeError(400, "Alt birim secilen birime ait degil");
  }

  if (energyUseGroupId !== undefined && energyUseGroupId !== null) {
    const [group] = await tx.select({
      companyId: energyUseGroupsTable.companyId,
      unitId: energyUseGroupsTable.unitId,
      subUnitId: energyUseGroupsTable.subUnitId,
      isActive: energyUseGroupsTable.isActive,
    }).from(energyUseGroupsTable).where(eq(energyUseGroupsTable.id, energyUseGroupId)).limit(1);
    if (!group || group.companyId !== companyId) throw new EquipmentScopeError(400, "Enerji kullanim grubu secilen sirkete ait degil");
    if (group.unitId !== null && group.unitId !== unitId) throw new EquipmentScopeError(400, "Enerji kullanim grubu secilen birime ait degil");
    if (subUnitId !== undefined && subUnitId !== null && group.subUnitId !== null && group.subUnitId !== subUnitId) {
      throw new EquipmentScopeError(400, "Enerji kullanim grubu secilen alt birime ait degil");
    }
  }

  if (parentEquipmentId !== undefined && parentEquipmentId !== null) {
    if (equipmentId !== undefined && parentEquipmentId === equipmentId) throw new EquipmentScopeError(400, "Ekipman kendisinin parent kaydi olamaz");
    const [parent] = await tx.select({
      id: equipmentTable.id,
      companyId: equipmentTable.companyId,
      unitId: equipmentTable.unitId,
      status: equipmentTable.status,
      parentEquipmentId: equipmentTable.parentEquipmentId,
    }).from(equipmentTable).where(eq(equipmentTable.id, parentEquipmentId)).limit(1).for("update");
    if (!parent || parent.companyId !== companyId || parent.unitId !== unitId) {
      throw new EquipmentScopeError(404, "Parent ekipman bulunamadi");
    }
    if (parent.status === "archived") throw new EquipmentScopeError(409, "Arsivli parent ekipmana baglanti kurulamaz");
    if (equipmentId !== undefined) await assertNoParentCycle(tx, equipmentId, parentEquipmentId);
  }

  if (meterLinks !== undefined) {
    const meterIds = meterLinks.map((link) => link.meterId);
    if (new Set(meterIds).size !== meterIds.length) throw new EquipmentScopeError(400, "Ayni meter birden fazla baglanamaz");
    if (meterLinks.filter((link) => link.isPrimary).length > 1) throw new EquipmentScopeError(400, "Bir ekipman icin tek primary meter olabilir");
    if (meterIds.length > 0) {
      const meters = await tx.select({ id: metersTable.id, companyId: metersTable.companyId, unitId: metersTable.unitId })
        .from(metersTable)
        .where(inArray(metersTable.id, meterIds));
      const byId = new Map(meters.map((meter) => [meter.id, meter]));
      for (const meterId of meterIds) {
        const meter = byId.get(meterId);
        if (!meter || meter.companyId !== companyId || meter.unitId !== unitId) {
          throw new EquipmentScopeError(400, "Meter secilen sirket/birim ile uyumlu degil");
        }
      }
    }
  }

  if (energySourceLinks !== undefined) {
    const sourceIds = energySourceLinks.map((link) => link.energySourceId);
    if (new Set(sourceIds).size !== sourceIds.length) throw new EquipmentScopeError(400, "Ayni enerji kaynagi birden fazla baglanamaz");
    if (energySourceLinks.filter((link) => link.isPrimary).length > 1) throw new EquipmentScopeError(400, "Bir ekipman icin tek primary enerji kaynagi olabilir");
    if (sourceIds.length > 0) {
      const sources = await tx.select({ id: energySourcesTable.id, companyId: energySourcesTable.companyId, unitId: energySourcesTable.unitId })
        .from(energySourcesTable)
        .where(inArray(energySourcesTable.id, sourceIds));
      const byId = new Map(sources.map((source) => [source.id, source]));
      for (const sourceId of sourceIds) {
        const source = byId.get(sourceId);
        if (!source || source.companyId !== companyId || source.unitId !== unitId) {
          throw new EquipmentScopeError(400, "Enerji kaynagi secilen sirket/birim ile uyumlu degil");
        }
      }
    }
  }
}

async function activeChildDependency(tx: Tx | typeof db, equipmentId: number, companyId: number) {
  const children = await tx.select({
    id: equipmentTable.id,
    equipmentCode: equipmentTable.equipmentCode,
    name: equipmentTable.name,
    status: equipmentTable.status,
  })
    .from(equipmentTable)
    .where(and(eq(equipmentTable.companyId, companyId), eq(equipmentTable.parentEquipmentId, equipmentId), ne(equipmentTable.status, "archived")))
    .orderBy(equipmentTable.id)
    .limit(6)
    .for("update");
  if (children.length === 0) return null;
  const [{ value }] = await tx.select({ value: count() }).from(equipmentTable)
    .where(and(eq(equipmentTable.companyId, companyId), eq(equipmentTable.parentEquipmentId, equipmentId), ne(equipmentTable.status, "archived")));
  return {
    status: "active-children" as const,
    activeChildCount: value,
    children: children.slice(0, 5),
  };
}

async function parentSummary(equipment: EquipmentRow) {
  if (equipment.parentEquipmentId === null) return null;
  const [parent] = await db.select({
    id: equipmentTable.id,
    equipmentCode: equipmentTable.equipmentCode,
    name: equipmentTable.name,
    status: equipmentTable.status,
  })
    .from(equipmentTable)
    .where(and(eq(equipmentTable.companyId, equipment.companyId), eq(equipmentTable.id, equipment.parentEquipmentId)))
    .limit(1);
  return parent ?? null;
}

async function childSummary(equipment: EquipmentRow) {
  const children = await db.select({
    id: equipmentTable.id,
    equipmentCode: equipmentTable.equipmentCode,
    name: equipmentTable.name,
    status: equipmentTable.status,
  })
    .from(equipmentTable)
    .where(and(eq(equipmentTable.companyId, equipment.companyId), eq(equipmentTable.parentEquipmentId, equipment.id), ne(equipmentTable.status, "archived")))
    .orderBy(equipmentTable.id)
    .limit(5);
  const [{ value }] = await db.select({ value: count() }).from(equipmentTable)
    .where(and(eq(equipmentTable.companyId, equipment.companyId), eq(equipmentTable.parentEquipmentId, equipment.id), ne(equipmentTable.status, "archived")));
  return { activeChildCount: value, children };
}

async function validateStoredLinkIntegrity(tx: Tx, equipment: EquipmentRow): Promise<DependencyWarning[]> {
  const [meterLinks, sourceLinks] = await Promise.all([
    tx.select().from(equipmentMeterLinksTable).where(eq(equipmentMeterLinksTable.equipmentId, equipment.id)),
    tx.select().from(equipmentEnergySourceLinksTable).where(eq(equipmentEnergySourceLinksTable.equipmentId, equipment.id)),
  ]);
  const warnings: DependencyWarning[] = [];
  if (meterLinks.length > 0) {
    const meters = await tx.select({ id: metersTable.id, companyId: metersTable.companyId, unitId: metersTable.unitId })
      .from(metersTable)
      .where(inArray(metersTable.id, meterLinks.map((link) => link.meterId)));
    const byId = new Map(meters.map((meter) => [meter.id, meter]));
    for (const link of meterLinks) {
      const meter = byId.get(link.meterId);
      if (!meter || meter.companyId !== equipment.companyId || meter.unitId !== equipment.unitId) {
        throw new EquipmentScopeError(409, "Ekipman sayac iliskisi sirket/birim kapsami ile uyumsuz");
      }
    }
  }
  if (sourceLinks.length > 0) {
    const sources = await tx.select({ id: energySourcesTable.id, companyId: energySourcesTable.companyId, unitId: energySourcesTable.unitId, active: energySourcesTable.active })
      .from(energySourcesTable)
      .where(inArray(energySourcesTable.id, sourceLinks.map((link) => link.energySourceId)));
    const byId = new Map(sources.map((source) => [source.id, source]));
    const inactive: number[] = [];
    for (const link of sourceLinks) {
      const source = byId.get(link.energySourceId);
      if (!source || source.companyId !== equipment.companyId || source.unitId !== equipment.unitId) {
        throw new EquipmentScopeError(409, "Ekipman enerji kaynagi iliskisi sirket/birim kapsami ile uyumsuz");
      }
      if (source.active === false) inactive.push(source.id);
    }
    if (inactive.length > 0) warnings.push({ code: "INACTIVE_ENERGY_SOURCE_LINKS", count: inactive.length, ids: inactive.slice(0, 5) });
  }
  return warnings;
}

async function assertNoParentCycle(tx: Tx | typeof db, equipmentId: number, candidateParentId: number) {
  let current: number | null = candidateParentId;
  const seen = new Set<number>();
  for (let depth = 0; current !== null && depth < 50; depth += 1) {
    if (current === equipmentId) throw new EquipmentScopeError(400, "Parent ekipman dongusu olusturulamaz");
    if (seen.has(current)) throw new EquipmentScopeError(400, "Parent ekipman dongusu olusturulamaz");
    seen.add(current);
    const [row] = await tx.select({ parentEquipmentId: equipmentTable.parentEquipmentId })
      .from(equipmentTable)
      .where(eq(equipmentTable.id, current))
      .limit(1);
    current = row?.parentEquipmentId ?? null;
  }
  if (current !== null) throw new EquipmentScopeError(400, "Parent ekipman zinciri cok derin");
}

async function replaceLinks(tx: Tx, input: {
  equipmentId: number;
  companyId: number;
  userId: number;
  meterLinks?: EquipmentCreateRequest["meterLinks"];
  energySourceLinks?: EquipmentCreateRequest["energySourceLinks"];
}) {
  if (input.meterLinks !== undefined) {
    await tx.delete(equipmentMeterLinksTable).where(eq(equipmentMeterLinksTable.equipmentId, input.equipmentId));
    if (input.meterLinks.length > 0) {
      await tx.insert(equipmentMeterLinksTable).values(input.meterLinks.map((link) => ({
        companyId: input.companyId,
        equipmentId: input.equipmentId,
        meterId: link.meterId,
        relationRole: link.relationRole,
        sharePercent: link.sharePercent ?? null,
        measurementConfidence: link.measurementConfidence,
        isPrimary: link.isPrimary,
        createdBy: input.userId,
      })));
    }
  }
  if (input.energySourceLinks !== undefined) {
    await tx.delete(equipmentEnergySourceLinksTable).where(eq(equipmentEnergySourceLinksTable.equipmentId, input.equipmentId));
    if (input.energySourceLinks.length > 0) {
      await tx.insert(equipmentEnergySourceLinksTable).values(input.energySourceLinks.map((link) => ({
        companyId: input.companyId,
        equipmentId: input.equipmentId,
        energySourceId: link.energySourceId,
        relationRole: link.relationRole,
        sharePercent: link.sharePercent ?? null,
        measurementConfidence: link.measurementConfidence,
        isPrimary: link.isPrimary,
        createdBy: input.userId,
      })));
    }
  }
}

async function loadLinks(equipmentId: number) {
  const [meterLinks, energySourceLinks] = await Promise.all([
    db.select().from(equipmentMeterLinksTable).where(eq(equipmentMeterLinksTable.equipmentId, equipmentId)),
    db.select().from(equipmentEnergySourceLinksTable).where(eq(equipmentEnergySourceLinksTable.equipmentId, equipmentId)),
  ]);
  const meterIds = meterLinks.map((link) => link.meterId);
  const sourceIds = energySourceLinks.map((link) => link.energySourceId);
  const [meters, sources] = await Promise.all([
    meterIds.length > 0
      ? db.select({
        id: metersTable.id,
        name: metersTable.name,
        type: metersTable.type,
        unit: metersTable.unit,
        unitId: metersTable.unitId,
        unitName: unitsTable.name,
        subUnitId: metersTable.subUnitId,
        subUnitName: subUnitsTable.name,
        energySourceName: energySourcesTable.name,
      })
        .from(metersTable)
        .leftJoin(unitsTable, eq(metersTable.unitId, unitsTable.id))
        .leftJoin(subUnitsTable, eq(metersTable.subUnitId, subUnitsTable.id))
        .leftJoin(energySourcesTable, eq(metersTable.energySourceId, energySourcesTable.id))
        .where(inArray(metersTable.id, meterIds))
      : [],
    sourceIds.length > 0
      ? db.select({
        id: energySourcesTable.id,
        name: energySourcesTable.name,
        type: energySourcesTable.type,
        unitId: energySourcesTable.unitId,
        unitName: unitsTable.name,
      })
        .from(energySourcesTable)
        .leftJoin(unitsTable, eq(energySourcesTable.unitId, unitsTable.id))
        .where(inArray(energySourcesTable.id, sourceIds))
      : [],
  ]);
  const meterById = new Map(meters.map((meter) => [meter.id, meter]));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  return {
    meterLinks: meterLinks.map((link): MeterLinkDetail => {
      const meter = meterById.get(link.meterId);
      return {
        ...link,
        meterName: meter?.name ?? null,
        meterType: meter?.type ?? null,
        meterUnit: meter?.unit ?? null,
        meterEnergySourceName: meter?.energySourceName ?? null,
        unitId: meter?.unitId ?? null,
        unitName: meter?.unitName ?? null,
        subUnitId: meter?.subUnitId ?? null,
        subUnitName: meter?.subUnitName ?? null,
        isActive: Boolean(meter),
      };
    }),
    energySourceLinks: energySourceLinks.map((link): SourceLinkDetail => {
      const source = sourceById.get(link.energySourceId);
      return {
        ...link,
        energySourceName: source?.name ?? null,
        energySourceType: source?.type ?? null,
        unitId: source?.unitId ?? null,
        unitName: source?.unitName ?? null,
        subUnitId: null,
        subUnitName: null,
        isActive: Boolean(source),
      };
    }),
  };
}

async function detailResponse(equipment: EquipmentRow, scope: Awaited<ReturnType<typeof resolveCompanyScope>>) {
  const links = await loadLinks(equipment.id);
  const customValues = equipmentCustomValues(equipment);
  const definitions = await getDefinitionsForEquipment(scope.companyId, customValues);
  return {
    equipment: serializeEquipment(equipment),
    meterLinks: links.meterLinks.map(serializeMeterLink),
    energySourceLinks: links.energySourceLinks.map(serializeSourceLink),
    parentSummary: await parentSummary(equipment),
    childSummary: await childSummary(equipment),
    customFields: definitions.map((definition) => ({
      definitionId: definition.id,
      code: definition.code,
      label: definition.label,
      section: definition.section,
      fieldType: definition.fieldType,
      unitLabel: definition.unitLabel,
      isActive: definition.isActive,
      isRequired: definition.isRequired,
      value: customValues[definition.code] ?? null,
    })),
    permissions: permissions(scope, equipment),
  };
}

router.get("/equipment", requireAuth, async (req, res) => {
  try {
    const scope = await resolveCompanyScope(req);
    const parsed = equipmentListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Gecersiz ekipman filtresi" });
      return;
    }
    const query = parsed.data;
    const requestedUnitId = scope.standardUnitId !== null ? scope.standardUnitId : query.unitId;
    if (scope.standardUnitId !== null && query.unitId !== undefined && query.unitId !== scope.standardUnitId) {
      res.status(403).json({ error: "Yetki yok" });
      return;
    }
    if (requestedUnitId !== undefined) await validateUnit(scope, requestedUnitId);

    const conditions: SQL[] = [eq(equipmentTable.companyId, scope.companyId)];
    if (requestedUnitId !== undefined) conditions.push(eq(equipmentTable.unitId, requestedUnitId));
    if (query.subUnitId !== undefined) conditions.push(eq(equipmentTable.subUnitId, query.subUnitId));
    if (query.category !== undefined) conditions.push(eq(equipmentTable.category, query.category));
    if (query.status !== undefined) conditions.push(eq(equipmentTable.status, query.status));
    if (query.energyUseGroupId !== undefined) conditions.push(eq(equipmentTable.energyUseGroupId, query.energyUseGroupId));
    if (query.parentEquipmentId !== undefined) conditions.push(eq(equipmentTable.parentEquipmentId, query.parentEquipmentId));
    if (query.parentless === true) conditions.push(isNull(equipmentTable.parentEquipmentId));
    if (!query.includeArchived && query.status === undefined) conditions.push(or(eq(equipmentTable.status, "active"), eq(equipmentTable.status, "standby"), eq(equipmentTable.status, "maintenance"), eq(equipmentTable.status, "faulty"), eq(equipmentTable.status, "out_of_service"))!);
    if (query.search) {
      const pattern = `%${query.search.replace(/[%_]/g, "\\$&")}%`;
      conditions.push(or(
        ilike(equipmentTable.equipmentCode, pattern),
        ilike(equipmentTable.name, pattern),
        ilike(equipmentTable.assetCode, pattern),
      )!);
    }
    if (query.meterId !== undefined) {
      const rows = await db.select({ equipmentId: equipmentMeterLinksTable.equipmentId })
        .from(equipmentMeterLinksTable)
        .where(and(eq(equipmentMeterLinksTable.companyId, scope.companyId), eq(equipmentMeterLinksTable.meterId, query.meterId)));
      if (rows.length === 0) {
        res.json({ items: [], total: 0, limit: query.limit, offset: query.offset, permissions: permissions(scope, null) });
        return;
      }
      conditions.push(inArray(equipmentTable.id, rows.map((row) => row.equipmentId)));
    }
    if (query.energySourceId !== undefined) {
      const rows = await db.select({ equipmentId: equipmentEnergySourceLinksTable.equipmentId })
        .from(equipmentEnergySourceLinksTable)
        .where(and(eq(equipmentEnergySourceLinksTable.companyId, scope.companyId), eq(equipmentEnergySourceLinksTable.energySourceId, query.energySourceId)));
      if (rows.length === 0) {
        res.json({ items: [], total: 0, limit: query.limit, offset: query.offset, permissions: permissions(scope, null) });
        return;
      }
      conditions.push(inArray(equipmentTable.id, rows.map((row) => row.equipmentId)));
    }

    const [totalRow] = await db.select({ value: count() }).from(equipmentTable).where(and(...conditions));
    const rows = await db.select()
      .from(equipmentTable)
      .where(and(...conditions))
      .orderBy(desc(equipmentTable.updatedAt), desc(equipmentTable.id))
      .limit(query.limit)
      .offset(query.offset);
    const primaryMeters = await db.select().from(equipmentMeterLinksTable)
      .where(and(eq(equipmentMeterLinksTable.companyId, scope.companyId), eq(equipmentMeterLinksTable.isPrimary, true)));
    const primarySources = await db.select().from(equipmentEnergySourceLinksTable)
      .where(and(eq(equipmentEnergySourceLinksTable.companyId, scope.companyId), eq(equipmentEnergySourceLinksTable.isPrimary, true)));
    const primaryMeterByEquipment = new Map(primaryMeters.map((link) => [link.equipmentId, link.meterId]));
    const primarySourceByEquipment = new Map(primarySources.map((link) => [link.equipmentId, link.energySourceId]));
    res.json({
      items: rows.map((row) => ({
        ...serializeEquipment(row),
        technicalNotes: undefined,
        maintenanceNotes: undefined,
        efficiencyOpportunities: undefined,
        plannedImprovements: undefined,
        primaryMeterId: primaryMeterByEquipment.get(row.id) ?? null,
        primaryEnergySourceId: primarySourceByEquipment.get(row.id) ?? null,
      })),
      total: totalRow?.value ?? 0,
      limit: query.limit,
      offset: query.offset,
      permissions: permissions(scope, null),
    });
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Ekipman listesi alinamadi" });
  }
});

router.post("/equipment", requireAuth, async (req, res) => {
  try {
    const scope = await resolveCompanyScope(req);
    const parsed = equipmentCreateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Gecersiz ekipman verisi" });
      return;
    }
    const data = parsed.data;
    const unitId = scope.standardUnitId ?? data.unitId;
    if (unitId === undefined) {
      res.status(400).json({ error: "unitId zorunludur" });
      return;
    }
    await validateUnit(scope, unitId);
    validateLifecycleFields(data);

    const result = await db.transaction(async (tx) => {
      await validateRelations({
        tx,
        companyId: scope.companyId,
        unitId,
        subUnitId: data.subUnitId,
        parentEquipmentId: data.parentEquipmentId,
        energyUseGroupId: data.energyUseGroupId,
        meterLinks: data.meterLinks,
        energySourceLinks: data.energySourceLinks,
      });
      const customValidation = await normalizeEquipmentCustomPatch(scope.companyId, {}, data.customValues ?? {});
      if (!customValidation.ok) return { status: "custom-validation" as const, error: customValidation.error };
      const [created] = await tx.insert(equipmentTable)
        .values({ ...createValues(data, scope.companyId, unitId, scope.userId), customValues: customValidation.value })
        .onConflictDoNothing({ target: [equipmentTable.companyId, equipmentTable.equipmentCode] })
        .returning();
      if (!created) return { status: "duplicate" as const };
      await replaceLinks(tx, {
        equipmentId: created.id,
        companyId: scope.companyId,
        userId: scope.userId,
        meterLinks: data.meterLinks,
        energySourceLinks: data.energySourceLinks,
      });
      await writeAuditEvent(tx, {
        request: req,
        companyId: scope.companyId,
        unitId: created.unitId,
        action: "equipment.created",
        entityType: "equipment",
        entityId: created.id,
        changes: { changedFields: ["created"], previousVersion: 0, newVersion: created.equipmentVersion },
        metadata: {
          equipmentCode: created.equipmentCode,
          meterIds: data.meterLinks.map((link) => link.meterId),
          energySourceIds: data.energySourceLinks.map((link) => link.energySourceId),
          customFieldCodes: Object.keys(customValidation.value),
        },
      });
      return { status: "ok" as const, equipment: created };
    });
    if (result.status === "duplicate") {
      res.status(409).json({ error: "Bu ekipman kodu sirket icinde zaten kullaniliyor" });
      return;
    }
    if (result.status === "custom-validation") {
      res.status(400).json({ error: result.error });
      return;
    }
    res.status(201).json(await detailResponse(result.equipment, scope));
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Ekipman olusturulamadi" });
  }
});

router.get("/equipment/:id", requireAuth, async (req, res) => {
  try {
    const id = parsePositiveInteger(req.params.id, "equipmentId");
    const scope = await resolveRecordScope(req, id);
    res.json(await detailResponse(scope.equipment, scope));
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Ekipman detayi alinamadi" });
  }
});

router.patch("/equipment/:id", requireAuth, async (req, res) => {
  try {
    const id = parsePositiveInteger(req.params.id, "equipmentId");
    const scope = await resolveRecordScope(req, id);
    if (scope.equipment.status === "archived") {
      res.status(409).json({ error: "Arsivli ekipman guncellenemez" });
      return;
    }
    const parsed = equipmentPatchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Gecersiz ekipman verisi" });
      return;
    }
    const data = parsed.data;
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(equipmentTable)
        .where(and(eq(equipmentTable.id, id), eq(equipmentTable.companyId, scope.companyId)))
        .limit(1)
        .for("update");
      if (!existing) return { status: "not-found" as const };
      if (scope.standardUnitId !== null && existing.unitId !== scope.standardUnitId) return { status: "forbidden" as const };
      if (existing.equipmentVersion !== data.expectedEquipmentVersion) return { status: "conflict" as const, equipment: existing };
      if (existing.status === "archived") return { status: "archived" as const };
      const patch = patchValues(data);
      const effectiveSubUnitId = data.subUnitId !== undefined ? data.subUnitId : existing.subUnitId;
      const effectiveParentId = data.parentEquipmentId !== undefined ? data.parentEquipmentId : existing.parentEquipmentId;
      const effectiveEnergyUseGroupId = data.energyUseGroupId !== undefined ? data.energyUseGroupId : existing.energyUseGroupId;
      validateLifecycleFields({ ...existing, ...data });
      await validateRelations({
        tx,
        companyId: scope.companyId,
        unitId: existing.unitId,
        equipmentId: existing.id,
        subUnitId: effectiveSubUnitId,
        parentEquipmentId: effectiveParentId,
        energyUseGroupId: effectiveEnergyUseGroupId,
        meterLinks: data.meterLinks,
        energySourceLinks: data.energySourceLinks,
      });
      const existingCustomValues = equipmentCustomValues(existing);
      const customValidation = await normalizeEquipmentCustomPatch(scope.companyId, existingCustomValues, data.customValues);
      if (!customValidation.ok) return { status: "custom-validation" as const, error: customValidation.error };
      if (data.customValues !== undefined) patch.customValues = customValidation.value;

      const currentLinks = await Promise.all([
        tx.select().from(equipmentMeterLinksTable).where(eq(equipmentMeterLinksTable.equipmentId, id)),
        tx.select().from(equipmentEnergySourceLinksTable).where(eq(equipmentEnergySourceLinksTable.equipmentId, id)),
      ]);
      const relationChanged = data.meterLinks !== undefined || data.energySourceLinks !== undefined;
      const next = { ...existing, ...patch };
      const changedFields = Object.keys(changedAuditFields(existing, next, [...EQUIPMENT_MUTABLE_FIELDS]));
      const changedCustomCodes = customValidation.changedCodes;
      if (changedFields.length === 0 && !relationChanged && changedCustomCodes.length === 0) return { status: "ok" as const, equipment: existing };
      const now = new Date();
      const [updated] = await tx.update(equipmentTable)
        .set({
          ...patch,
          equipmentVersion: existing.equipmentVersion + 1,
          updatedAt: now,
          updatedBy: scope.userId,
        })
        .where(and(eq(equipmentTable.id, id), eq(equipmentTable.equipmentVersion, data.expectedEquipmentVersion)))
        .returning();
      if (!updated) return { status: "conflict" as const, equipment: existing };
      await replaceLinks(tx, {
        equipmentId: id,
        companyId: scope.companyId,
        userId: scope.userId,
        meterLinks: data.meterLinks,
        energySourceLinks: data.energySourceLinks,
      });
      await writeAuditEvent(tx, {
        request: req,
        companyId: scope.companyId,
        unitId: updated.unitId,
        action: "equipment.updated",
        entityType: "equipment",
        entityId: updated.id,
        changes: {
          changedFields,
          previousVersion: existing.equipmentVersion,
          newVersion: updated.equipmentVersion,
        },
        metadata: {
          equipmentCode: updated.equipmentCode,
          parentChange: existing.parentEquipmentId !== updated.parentEquipmentId ? { before: existing.parentEquipmentId, after: updated.parentEquipmentId } : undefined,
          statusChange: existing.status !== updated.status ? { before: existing.status, after: updated.status } : undefined,
          operationalStatusChange: existing.operationalStatus !== updated.operationalStatus ? { before: existing.operationalStatus, after: updated.operationalStatus } : undefined,
          lifecycleFields: changedFields.filter((field) => ["purchaseDate", "commissioningDate", "manufactureYear", "expectedLifeYears", "plannedReplacementYear"].includes(field)),
          meterIdsBefore: currentLinks[0].map((link) => link.meterId),
          meterIdsAfter: data.meterLinks?.map((link) => link.meterId) ?? undefined,
          energySourceIdsBefore: currentLinks[1].map((link) => link.energySourceId),
          energySourceIdsAfter: data.energySourceLinks?.map((link) => link.energySourceId) ?? undefined,
          customFieldCodes: changedCustomCodes,
        },
      });
      return { status: "ok" as const, equipment: updated };
    });
    if (result.status === "not-found") {
      res.status(404).json({ error: "Ekipman bulunamadi" });
      return;
    }
    if (result.status === "forbidden") {
      res.status(403).json({ error: "Yetki yok" });
      return;
    }
    if (result.status === "archived") {
      res.status(409).json({ error: "Arsivli ekipman guncellenemez" });
      return;
    }
    if (result.status === "custom-validation") {
      res.status(400).json({ error: result.error });
      return;
    }
    if (result.status === "conflict") {
      res.status(409).json({ error: "Ekipman baska bir oturum tarafindan guncellendi.", equipment: serializeEquipment(result.equipment) });
      return;
    }
    res.json(await detailResponse(result.equipment, scope));
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Ekipman guncellenemedi" });
  }
});

async function equipmentStatusMutation(req: Request, res: Response, mode: "archive" | "reactivate") {
  const id = parsePositiveInteger(req.params.id, "equipmentId");
  const scope = await resolveRecordScope(req, id);
  if (!scope.canArchive) throw new EquipmentScopeError(403, "Ekipman arsivleme yetkiniz yok");
  const parsed = (mode === "archive" ? equipmentArchiveRequestSchema : equipmentReactivateRequestSchema).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Gecersiz ekipman durumu" });
    return;
  }
  const payload = parsed.data as EquipmentArchiveRequest | EquipmentReactivateRequest;
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(equipmentTable)
      .where(and(eq(equipmentTable.id, id), eq(equipmentTable.companyId, scope.companyId)))
      .limit(1)
      .for("update");
    if (!existing) return { status: "not-found" as const };
    if (existing.equipmentVersion !== parsed.data.expectedEquipmentVersion) return { status: "conflict" as const, equipment: existing };
    if (mode === "archive" && existing.status === "archived") return { status: "already-archived" as const, equipment: existing };
    if (mode === "reactivate" && existing.status !== "archived") return { status: "not-archived" as const, equipment: existing };
    let dependencyWarnings: DependencyWarning[] = [];
    if (mode === "archive") {
      const childDependency = await activeChildDependency(tx, existing.id, existing.companyId);
      if (childDependency) return childDependency;
    }
    if (mode === "reactivate") {
      await validateUnit(scope, existing.unitId);
      await validateRelations({
        tx,
        companyId: existing.companyId,
        unitId: existing.unitId,
        equipmentId: existing.id,
        subUnitId: existing.subUnitId,
        parentEquipmentId: existing.parentEquipmentId,
        energyUseGroupId: existing.energyUseGroupId,
        meterLinks: undefined,
        energySourceLinks: undefined,
      });
      dependencyWarnings = await validateStoredLinkIntegrity(tx, existing);
      validateLifecycleFields({ ...existing, status: (payload as EquipmentReactivateRequest).status });
    }
    const now = new Date();
    const [updated] = await tx.update(equipmentTable).set({
      status: mode === "archive" ? "archived" : (payload as EquipmentReactivateRequest).status,
      archivedAt: mode === "archive" ? now : null,
      archivedBy: mode === "archive" ? scope.userId : null,
      equipmentVersion: existing.equipmentVersion + 1,
      updatedAt: now,
      updatedBy: scope.userId,
    }).where(and(eq(equipmentTable.id, id), eq(equipmentTable.equipmentVersion, payload.expectedEquipmentVersion))).returning();
    if (!updated) return { status: "conflict" as const, equipment: existing };
    const action: AuditAction = mode === "archive" ? "equipment.archived" : "equipment.reactivated";
    await writeAuditEvent(tx, {
      request: req,
      companyId: updated.companyId,
      unitId: updated.unitId,
      action,
      entityType: "equipment",
      entityId: updated.id,
      changes: {
        changedFields: ["status"],
        previousVersion: existing.equipmentVersion,
        newVersion: updated.equipmentVersion,
      },
      metadata: {
        equipmentCode: updated.equipmentCode,
        reason: mode === "archive" ? (payload as EquipmentArchiveRequest).reason ?? null : null,
        previousStatus: existing.status,
        newStatus: updated.status,
        operationalStatus: updated.operationalStatus,
        dependencyWarnings,
      },
    });
    return { status: "ok" as const, equipment: updated };
  });
  if (result.status === "not-found") {
    res.status(404).json({ error: "Ekipman bulunamadi" });
    return;
  }
  if (result.status === "conflict") {
    res.status(409).json({ error: "Ekipman baska bir oturum tarafindan guncellendi.", equipment: serializeEquipment(result.equipment) });
    return;
  }
  if (result.status === "already-archived") {
    res.status(409).json({ error: "Ekipman zaten arsivli", equipment: serializeEquipment(result.equipment) });
    return;
  }
  if (result.status === "not-archived") {
    res.status(409).json({ error: "Ekipman arsivli degil", equipment: serializeEquipment(result.equipment) });
    return;
  }
  if (result.status === "active-children") {
    res.status(409).json({
      error: "Bu ekipmana bagli aktif alt ekipmanlar bulunuyor.",
      code: "EQUIPMENT_HAS_ACTIVE_CHILDREN",
      activeChildCount: result.activeChildCount,
      children: result.children,
    });
    return;
  }
  res.json(await detailResponse(result.equipment, scope));
}

router.post("/equipment/:id/archive", requireAuth, async (req, res) => {
  try {
    await equipmentStatusMutation(req, res, "archive");
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Ekipman arsivlenemedi" });
  }
});

router.post("/equipment/:id/reactivate", requireAuth, async (req, res) => {
  try {
    await equipmentStatusMutation(req, res, "reactivate");
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Ekipman yeniden aktifi hale getirilemedi" });
  }
});

export default router;
