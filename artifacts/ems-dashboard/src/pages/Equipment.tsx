import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { useUnit } from "@/context/UnitContext";
import { useListUnits, getListUnitsQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Archive, Box, CheckCircle2, Download, Eye, FileSpreadsheet, Pencil, Plus, RefreshCcw, RotateCcw, Search, SlidersHorizontal, Upload, XCircle } from "lucide-react";

type EquipmentStatus = "active" | "standby" | "maintenance" | "faulty" | "out_of_service" | "archived";

type Equipment = {
  id: number;
  companyId: number;
  unitId: number;
  subUnitId: number | null;
  equipmentCode: string;
  name: string;
  equipmentKind: string;
  category: string;
  subType: string | null;
  status: EquipmentStatus;
  assetCode: string | null;
  manufacturer: string | null;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  tagCode: string | null;
  locationText: string | null;
  buildingText: string | null;
  processText: string | null;
  parentEquipmentId: number | null;
  energyUseGroupId: number | null;
  customValues: Record<string, unknown>;
  measurementMethod: string;
  measurementConfidence: string;
  ratedPowerValue: number | null;
  ratedPowerUnit: string | null;
  installedPowerKw: number | null;
  capacityValue: number | null;
  capacityUnit: string | null;
  nominalEfficiencyPercent: number | null;
  operationalStatus: string | null;
  dailyOperatingHours: number | null;
  annualOperatingHours: number | null;
  averageLoadPercent: number | null;
  seasonalOperationStatus: string | null;
  purchaseDate: string | null;
  commissioningDate: string | null;
  manufactureYear: number | null;
  expectedLifeYears: number | null;
  plannedReplacementYear: number | null;
  isEnergyIntensive: boolean;
  isCritical: boolean;
  criticalityReason: string | null;
  savingPotential: string | null;
  technicalNotes: string | null;
  maintenanceNotes: string | null;
  efficiencyOpportunities: string | null;
  plannedImprovements: string | null;
  equipmentVersion: number;
  updatedAt: string;
  archivedAt: string | null;
  primaryMeterId?: number | null;
  primaryEnergySourceId?: number | null;
};

type EquipmentListResponse = {
  items: Equipment[];
  total: number;
  limit: number;
  offset: number;
  permissions: { canEdit: boolean; canArchive: boolean; canReactivate: boolean };
};

type EquipmentDetailResponse = {
  equipment: Equipment;
  meterLinks: MeterLink[];
  energySourceLinks: EnergySourceLink[];
  parentSummary?: Pick<Equipment, "id" | "equipmentCode" | "name" | "status"> | null;
  childSummary?: {
    activeChildCount: number;
    children: Array<Pick<Equipment, "id" | "equipmentCode" | "name" | "status">>;
  };
  customFields?: EquipmentCustomField[];
  permissions: { canEdit: boolean; canArchive: boolean; canReactivate: boolean };
};

type EquipmentImportIssue = {
  sheet: string;
  row?: number;
  column?: string;
  code: string;
  message: string;
  severity: "error" | "warning";
};

type EquipmentImportPreview = {
  previewHash: string;
  mode: string;
  fileName: string;
  totalRows: number;
  createCount: number;
  updateCount: number;
  noChangeCount: number;
  errorCount: number;
  warningCount: number;
  canApply: boolean;
  issues: EquipmentImportIssue[];
  rows: Array<{ row: number; equipmentCode: string; action: string; changedFields: string[]; customFieldCodes: string[]; issues: EquipmentImportIssue[] }>;
  relationSummary: { meterReplaceCount: number; energySourceReplaceCount: number };
};

type AuditEventRecord = {
  id: number;
  occurredAt: string;
  actorRole: string | null;
  action: string;
  changes: any;
  metadata: any;
};

type EquipmentCustomFieldDefinition = {
  id: number;
  code: string;
  label: string;
  description: string | null;
  section: string;
  fieldType: string;
  unitLabel: string | null;
  options: Array<{ code: string; label: string; isActive: boolean; displayOrder?: number }>;
  isRequired: boolean;
  isActive: boolean;
  displayOrder: number;
};

type EquipmentCustomField = Pick<EquipmentCustomFieldDefinition, "code" | "label" | "section" | "fieldType" | "unitLabel" | "isActive" | "isRequired"> & {
  definitionId: number;
  value: unknown;
};

type MeterLink = {
  id: number;
  meterId: number;
  meterName?: string | null;
  meterType?: string | null;
  meterUnit?: string | null;
  meterEnergySourceName?: string | null;
  unitId?: number | null;
  unitName?: string | null;
  subUnitId?: number | null;
  subUnitName?: string | null;
  isActive?: boolean;
  isPrimary: boolean;
  relationRole: string;
  sharePercent: number | null;
  measurementConfidence: string;
};

type EnergySourceLink = {
  id: number;
  energySourceId: number;
  energySourceName?: string | null;
  energySourceType?: string | null;
  unitId?: number | null;
  unitName?: string | null;
  subUnitId?: number | null;
  subUnitName?: string | null;
  isActive?: boolean;
  isPrimary: boolean;
  relationRole: string;
  sharePercent: number | null;
  measurementConfidence: string;
};

type MeterRelationDraft = {
  meterId: string;
  relationRole: string;
  isPrimary: boolean;
  sharePercent: string;
  measurementConfidence: string;
};

type SourceRelationDraft = {
  energySourceId: string;
  relationRole: string;
  isPrimary: boolean;
  sharePercent: string;
  measurementConfidence: string;
};

type OptionRow = {
  id: number;
  name: string;
  unitId?: number | null;
  subUnitId?: number | null;
  type?: string;
  unit?: string;
  groupType?: string;
  isActive?: boolean;
  active?: boolean;
  subUnitName?: string | null;
  energySourceName?: string | null;
};

type EquipmentForm = {
  equipmentCode: string;
  name: string;
  equipmentKind: string;
  category: string;
  subType: string;
  status: EquipmentStatus;
  unitId: string;
  subUnitId: string;
  parentEquipmentId: string;
  energyUseGroupId: string;
  assetCode: string;
  manufacturer: string;
  brand: string;
  model: string;
  serialNumber: string;
  tagCode: string;
  locationText: string;
  buildingText: string;
  processText: string;
  measurementMethod: string;
  measurementConfidence: string;
  ratedPowerValue: string;
  ratedPowerUnit: string;
  installedPowerKw: string;
  capacityValue: string;
  capacityUnit: string;
  nominalEfficiencyPercent: string;
  operationalStatus: string;
  dailyOperatingHours: string;
  annualOperatingHours: string;
  averageLoadPercent: string;
  seasonalOperationStatus: string;
  purchaseDate: string;
  commissioningDate: string;
  manufactureYear: string;
  expectedLifeYears: string;
  plannedReplacementYear: string;
  isEnergyIntensive: boolean;
  isCritical: boolean;
  criticalityReason: string;
  savingPotential: string;
  technicalNotes: string;
  maintenanceNotes: string;
  efficiencyOpportunities: string;
  plannedImprovements: string;
  meterLinks: MeterRelationDraft[];
  energySourceLinks: SourceRelationDraft[];
  customValues: Record<string, unknown>;
};

class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    super(body?.error ?? "İstek başarısız");
    this.status = status;
    this.body = body;
  }
}

const CATEGORY_OPTIONS = [
  ["motor", "Motor"],
  ["pump", "Pompa"],
  ["fan", "Fan"],
  ["compressor", "Kompresör"],
  ["boiler", "Kazan"],
  ["chiller", "Chiller"],
  ["hvac", "HVAC"],
  ["transformer", "Trafo"],
  ["generator", "Jeneratör"],
  ["ups", "UPS"],
  ["lighting", "Aydınlatma"],
  ["renewable", "Yenilenebilir"],
  ["process_line", "Proses hattı"],
  ["other", "Diğer"],
] as const;

const STATUS_OPTIONS = [
  ["active", "Aktif"],
  ["standby", "Beklemede"],
  ["maintenance", "Bakımda"],
  ["faulty", "Arızalı"],
  ["out_of_service", "Servis dışı"],
  ["archived", "Arşivli"],
] as const;

const OPERATIONAL_OPTIONS = [
  ["running", "Çalışıyor"],
  ["stopped", "Durdu"],
  ["standby", "Beklemede"],
  ["unknown", "Bilinmiyor"],
  ["not_applicable", "Uygulanamaz"],
] as const;

const YES_NO_UNKNOWN_OPTIONS = [
  ["yes", "Evet"],
  ["no", "Hayır"],
  ["unknown", "Bilinmiyor"],
  ["not_applicable", "Uygulanamaz"],
] as const;

const METHOD_OPTIONS = [
  ["direct", "Doğrudan"],
  ["shared", "Paylaşımlı"],
  ["allocated", "Dağıtılmış"],
  ["estimated", "Tahmini"],
  ["unmeasured", "Ölçülmüyor"],
  ["unknown", "Bilinmiyor"],
] as const;

const CONFIDENCE_OPTIONS = [
  ["high", "Yüksek"],
  ["medium", "Orta"],
  ["low", "Düşük"],
  ["unknown", "Bilinmiyor"],
] as const;

const METER_RELATION_ROLE_OPTIONS = [
  ["direct", "Doğrudan ölçüm"],
  ["shared", "Paylaşımlı ölçüm"],
  ["sub_meter", "Alt sayaç"],
  ["estimated_reference", "Tahmini referans"],
] as const;

const SOURCE_RELATION_ROLE_OPTIONS = [
  ["primary", "Birincil"],
  ["secondary", "İkincil"],
  ["startup", "İlk çalıştırma"],
  ["backup", "Yedek"],
] as const;

const EMPTY_FORM: EquipmentForm = {
  equipmentCode: "",
  name: "",
  equipmentKind: "physical",
  category: "pump",
  subType: "",
  status: "active",
  unitId: "",
  subUnitId: "none",
  parentEquipmentId: "none",
  energyUseGroupId: "none",
  assetCode: "",
  manufacturer: "",
  brand: "",
  model: "",
  serialNumber: "",
  tagCode: "",
  locationText: "",
  buildingText: "",
  processText: "",
  measurementMethod: "unknown",
  measurementConfidence: "unknown",
  ratedPowerValue: "",
  ratedPowerUnit: "",
  installedPowerKw: "",
  capacityValue: "",
  capacityUnit: "",
  nominalEfficiencyPercent: "",
  operationalStatus: "none",
  dailyOperatingHours: "",
  annualOperatingHours: "",
  averageLoadPercent: "",
  seasonalOperationStatus: "none",
  purchaseDate: "",
  commissioningDate: "",
  manufactureYear: "",
  expectedLifeYears: "",
  plannedReplacementYear: "",
  isEnergyIntensive: false,
  isCritical: false,
  criticalityReason: "",
  savingPotential: "",
  technicalNotes: "",
  maintenanceNotes: "",
  efficiencyOpportunities: "",
  plannedImprovements: "",
  meterLinks: [],
  energySourceLinks: [],
  customValues: {},
};

function label(options: readonly (readonly [string, string])[], value: string | null | undefined) {
  return options.find(([key]) => key === value)?.[1] ?? value ?? "—";
}

function asText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asNullableText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNullableNumber(value: string) {
  if (value.trim() === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function asNullableInt(value: string) {
  if (value.trim() === "") return null;
  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric : null;
}

function asNullableId(value: string) {
  return value === "none" || value === "" ? null : Number(value);
}

function hasCustomValue(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function meterLinkToDraft(link: MeterLink): MeterRelationDraft {
  return {
    meterId: String(link.meterId),
    relationRole: link.relationRole,
    isPrimary: link.isPrimary,
    sharePercent: link.sharePercent?.toString() ?? "",
    measurementConfidence: link.measurementConfidence,
  };
}

function sourceLinkToDraft(link: EnergySourceLink): SourceRelationDraft {
  return {
    energySourceId: String(link.energySourceId),
    relationRole: link.relationRole,
    isPrimary: link.isPrimary,
    sharePercent: link.sharePercent?.toString() ?? "",
    measurementConfidence: link.measurementConfidence,
  };
}

function equipmentToForm(equipment: Equipment, detail?: EquipmentDetailResponse): EquipmentForm {
  return {
    ...EMPTY_FORM,
    equipmentCode: equipment.equipmentCode,
    name: equipment.name,
    equipmentKind: equipment.equipmentKind,
    category: equipment.category,
    subType: equipment.subType ?? "",
    status: equipment.status === "archived" ? "active" : equipment.status,
    unitId: String(equipment.unitId),
    subUnitId: equipment.subUnitId ? String(equipment.subUnitId) : "none",
    parentEquipmentId: equipment.parentEquipmentId ? String(equipment.parentEquipmentId) : "none",
    energyUseGroupId: equipment.energyUseGroupId ? String(equipment.energyUseGroupId) : "none",
    assetCode: equipment.assetCode ?? "",
    manufacturer: equipment.manufacturer ?? "",
    brand: equipment.brand ?? "",
    model: equipment.model ?? "",
    serialNumber: equipment.serialNumber ?? "",
    tagCode: equipment.tagCode ?? "",
    locationText: equipment.locationText ?? "",
    buildingText: equipment.buildingText ?? "",
    processText: equipment.processText ?? "",
    measurementMethod: equipment.measurementMethod,
    measurementConfidence: equipment.measurementConfidence,
    ratedPowerValue: equipment.ratedPowerValue?.toString() ?? "",
    ratedPowerUnit: equipment.ratedPowerUnit ?? "",
    installedPowerKw: equipment.installedPowerKw?.toString() ?? "",
    capacityValue: equipment.capacityValue?.toString() ?? "",
    capacityUnit: equipment.capacityUnit ?? "",
    nominalEfficiencyPercent: equipment.nominalEfficiencyPercent?.toString() ?? "",
    operationalStatus: equipment.operationalStatus ?? "none",
    dailyOperatingHours: equipment.dailyOperatingHours?.toString() ?? "",
    annualOperatingHours: equipment.annualOperatingHours?.toString() ?? "",
    averageLoadPercent: equipment.averageLoadPercent?.toString() ?? "",
    seasonalOperationStatus: equipment.seasonalOperationStatus ?? "none",
    purchaseDate: equipment.purchaseDate ?? "",
    commissioningDate: equipment.commissioningDate ?? "",
    manufactureYear: equipment.manufactureYear?.toString() ?? "",
    expectedLifeYears: equipment.expectedLifeYears?.toString() ?? "",
    plannedReplacementYear: equipment.plannedReplacementYear?.toString() ?? "",
    isEnergyIntensive: equipment.isEnergyIntensive,
    isCritical: equipment.isCritical,
    criticalityReason: equipment.criticalityReason ?? "",
    savingPotential: equipment.savingPotential ?? "",
    technicalNotes: equipment.technicalNotes ?? "",
    maintenanceNotes: equipment.maintenanceNotes ?? "",
    efficiencyOpportunities: equipment.efficiencyOpportunities ?? "",
    plannedImprovements: equipment.plannedImprovements ?? "",
    meterLinks: detail?.meterLinks.map(meterLinkToDraft) ?? [],
    energySourceLinks: detail?.energySourceLinks.map(sourceLinkToDraft) ?? [],
    customValues: equipment.customValues ?? {},
  };
}

function relationShare(value: string) {
  return value.trim() === "" ? null : Number(value);
}

function normalizeRelations(form: EquipmentForm) {
  return {
    meterLinks: form.meterLinks
      .filter((link) => link.meterId !== "none" && link.meterId !== "")
      .map((link) => ({
        meterId: Number(link.meterId),
        relationRole: link.relationRole,
        sharePercent: relationShare(link.sharePercent),
        measurementConfidence: link.measurementConfidence,
        isPrimary: link.isPrimary,
      })),
    energySourceLinks: form.energySourceLinks
      .filter((link) => link.energySourceId !== "none" && link.energySourceId !== "")
      .map((link) => ({
        energySourceId: Number(link.energySourceId),
        relationRole: link.relationRole,
        sharePercent: relationShare(link.sharePercent),
        measurementConfidence: link.measurementConfidence,
        isPrimary: link.isPrimary,
      })),
  };
}

function buildPayload(form: EquipmentForm, mode: "create" | "edit", expectedEquipmentVersion?: number) {
  const payload: Record<string, unknown> = {
    name: asText(form.name),
    equipmentKind: form.equipmentKind,
    category: form.category,
    subType: asNullableText(form.subType),
    status: form.status,
    subUnitId: asNullableId(form.subUnitId),
    parentEquipmentId: asNullableId(form.parentEquipmentId),
    energyUseGroupId: asNullableId(form.energyUseGroupId),
    assetCode: asNullableText(form.assetCode),
    manufacturer: asNullableText(form.manufacturer),
    brand: asNullableText(form.brand),
    model: asNullableText(form.model),
    serialNumber: asNullableText(form.serialNumber),
    tagCode: asNullableText(form.tagCode),
    locationText: asNullableText(form.locationText),
    buildingText: asNullableText(form.buildingText),
    processText: asNullableText(form.processText),
    measurementMethod: form.measurementMethod,
    measurementConfidence: form.measurementConfidence,
    ratedPowerValue: asNullableNumber(form.ratedPowerValue),
    ratedPowerUnit: asNullableText(form.ratedPowerUnit),
    installedPowerKw: asNullableNumber(form.installedPowerKw),
    capacityValue: asNullableNumber(form.capacityValue),
    capacityUnit: asNullableText(form.capacityUnit),
    nominalEfficiencyPercent: asNullableNumber(form.nominalEfficiencyPercent),
    operationalStatus: form.operationalStatus === "none" ? null : form.operationalStatus,
    dailyOperatingHours: asNullableNumber(form.dailyOperatingHours),
    annualOperatingHours: asNullableNumber(form.annualOperatingHours),
    averageLoadPercent: asNullableNumber(form.averageLoadPercent),
    seasonalOperationStatus: form.seasonalOperationStatus === "none" ? null : form.seasonalOperationStatus,
    purchaseDate: form.purchaseDate || null,
    commissioningDate: form.commissioningDate || null,
    manufactureYear: asNullableInt(form.manufactureYear),
    expectedLifeYears: asNullableInt(form.expectedLifeYears),
    plannedReplacementYear: asNullableInt(form.plannedReplacementYear),
    isEnergyIntensive: form.isEnergyIntensive,
    isCritical: form.isCritical,
    criticalityReason: asNullableText(form.criticalityReason),
    savingPotential: asNullableText(form.savingPotential),
    technicalNotes: asNullableText(form.technicalNotes),
    maintenanceNotes: asNullableText(form.maintenanceNotes),
    efficiencyOpportunities: asNullableText(form.efficiencyOpportunities),
    plannedImprovements: asNullableText(form.plannedImprovements),
  };
  const relations = normalizeRelations(form);
  payload.meterLinks = relations.meterLinks;
  payload.energySourceLinks = relations.energySourceLinks;
  payload.customValues = form.customValues;
  if (mode === "create") {
    payload.equipmentCode = asText(form.equipmentCode);
    if (form.unitId) payload.unitId = Number(form.unitId);
  } else {
    payload.expectedEquipmentVersion = expectedEquipmentVersion;
  }
  return payload;
}

async function apiFetch<T>(token: string | null, url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new ApiError(response.status, body);
  return body as T;
}

async function apiBlob(token: string | null, url: string): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const text = await response.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { error: text }; }
    throw new ApiError(response.status, body);
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename\*=UTF-8''([^;]+)/);
  const filename = match ? decodeURIComponent(match[1]) : "ekipman.xlsx";
  return { blob: await response.blob(), filename };
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function optionQuery(companyId: number | null, unitId?: number | null) {
  const params = new URLSearchParams();
  if (companyId) params.set("companyId", String(companyId));
  if (unitId) params.set("unitId", String(unitId));
  return params.toString();
}

export default function EquipmentPage() {
  const { user, token } = useAuth();
  const { companyId } = useCompany();
  const { unitId: globalUnitId } = useUnit();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isSuperAdmin = user?.role === "superadmin";
  const isPrivileged = user?.role === "admin" || user?.role === "kontrol_admin" || isSuperAdmin;
  const standardUnitId = !isPrivileged ? user?.unitId ?? null : null;
  const effectiveCompanyId = isSuperAdmin ? companyId : null;
  const canQuery = !!token && (!isSuperAdmin || companyId !== null);
  const canCreate = canQuery;

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterUnit, setFilterUnit] = useState<string>("all");
  const [filterSubUnit, setFilterSubUnit] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterEnergySource, setFilterEnergySource] = useState<string>("all");
  const [filterMeter, setFilterMeter] = useState<string>("all");
  const [filterGroup, setFilterGroup] = useState<string>("all");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<EquipmentForm>(EMPTY_FORM);
  const [dirty, setDirty] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Equipment | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<Equipment | null>(null);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [reactivateStatus, setReactivateStatus] = useState<Exclude<EquipmentStatus, "archived">>("active");
  const [conflict, setConflict] = useState<Equipment | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<EquipmentImportPreview | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  useEffect(() => {
    setPage(1);
    setFilterSubUnit("all");
    setFilterEnergySource("all");
    setFilterMeter("all");
    setFilterGroup("all");
  }, [companyId, filterUnit, globalUnitId]);

  const unitParam = standardUnitId ?? (filterUnit !== "all" ? Number(filterUnit) : (globalUnitId ?? undefined));
  const selectedWorkingUnit = mode === "create" || mode === "edit" ? Number(form.unitId || unitParam || 0) || null : unitParam ?? null;

  const { data: units } = useListUnits(
    isSuperAdmin && companyId ? ({ companyId } as any) : ({} as any),
    { query: { queryKey: [...getListUnitsQueryKey(), companyId], enabled: !!token && (!isSuperAdmin || !!companyId) } },
  );

  const subUnitsQuery = useQuery<OptionRow[], ApiError>({
    queryKey: ["equipment-sub-units", effectiveCompanyId, selectedWorkingUnit, filterUnit],
    queryFn: () => apiFetch<OptionRow[]>(token, `/api/sub-units?${optionQuery(effectiveCompanyId, selectedWorkingUnit)}`),
    enabled: canQuery,
  });
  const metersQuery = useQuery<OptionRow[], ApiError>({
    queryKey: ["equipment-meters", effectiveCompanyId, selectedWorkingUnit],
    queryFn: () => apiFetch<OptionRow[]>(token, `/api/meters?${optionQuery(effectiveCompanyId, selectedWorkingUnit)}`),
    enabled: canQuery,
  });
  const sourcesQuery = useQuery<OptionRow[], ApiError>({
    queryKey: ["equipment-energy-sources", effectiveCompanyId, selectedWorkingUnit],
    queryFn: () => apiFetch<OptionRow[]>(token, `/api/energy-sources?${optionQuery(effectiveCompanyId, selectedWorkingUnit)}`),
    enabled: canQuery,
  });
  const groupsQuery = useQuery<OptionRow[], ApiError>({
    queryKey: ["equipment-energy-use-groups", effectiveCompanyId, selectedWorkingUnit],
    queryFn: () => apiFetch<OptionRow[]>(token, `/api/energy-use-groups?isActive=true&${optionQuery(effectiveCompanyId, selectedWorkingUnit)}`),
    enabled: canQuery,
  });
  const customDefinitionsQuery = useQuery<{ definitions: EquipmentCustomFieldDefinition[]; permissions: { canEdit: boolean } }, ApiError>({
    queryKey: ["equipment-custom-field-definitions", effectiveCompanyId],
    queryFn: () => apiFetch(token, `/api/equipment-field-definitions${effectiveCompanyId ? `?companyId=${effectiveCompanyId}` : ""}`),
    enabled: canQuery,
  });

  const listQuery = useQuery<EquipmentListResponse, ApiError>({
    queryKey: ["equipment", effectiveCompanyId, unitParam, filterSubUnit, filterCategory, filterStatus, filterEnergySource, filterMeter, filterGroup, includeArchived, debouncedSearch, page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String((page - 1) * pageSize) });
      if (effectiveCompanyId) params.set("companyId", String(effectiveCompanyId));
      if (unitParam) params.set("unitId", String(unitParam));
      if (filterSubUnit !== "all") params.set("subUnitId", filterSubUnit);
      if (filterCategory !== "all") params.set("category", filterCategory);
      if (filterStatus !== "all") params.set("status", filterStatus);
      if (filterEnergySource !== "all") params.set("energySourceId", filterEnergySource);
      if (filterMeter !== "all") params.set("meterId", filterMeter);
      if (filterGroup !== "all") params.set("energyUseGroupId", filterGroup);
      if (includeArchived) params.set("includeArchived", "true");
      if (debouncedSearch.length >= 2) params.set("search", debouncedSearch);
      return apiFetch<EquipmentListResponse>(token, `/api/equipment?${params}`);
    },
    enabled: canQuery,
  });

  const detailQuery = useQuery<EquipmentDetailResponse, ApiError>({
    queryKey: ["equipment-detail", selectedId, effectiveCompanyId],
    queryFn: () => apiFetch<EquipmentDetailResponse>(token, `/api/equipment/${selectedId}${effectiveCompanyId ? `?companyId=${effectiveCompanyId}` : ""}`),
    enabled: canQuery && selectedId !== null,
  });

  const auditHistoryQuery = useQuery<{ items: AuditEventRecord[]; hasNext: boolean }, ApiError>({
    queryKey: ["equipment-audit-history", selectedId, effectiveCompanyId],
    queryFn: () => apiFetch(token, `/api/audit-events?entityType=equipment&entityId=${selectedId}&pageSize=10${effectiveCompanyId ? `&companyId=${effectiveCompanyId}` : ""}`),
    enabled: canQuery && selectedId !== null,
  });

  const parentOptionsQuery = useQuery<EquipmentListResponse, ApiError>({
    queryKey: ["equipment-parent-options", effectiveCompanyId, selectedWorkingUnit, selectedId],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "100" });
      if (effectiveCompanyId) params.set("companyId", String(effectiveCompanyId));
      if (selectedWorkingUnit) params.set("unitId", String(selectedWorkingUnit));
      return apiFetch<EquipmentListResponse>(token, `/api/equipment?${params}`);
    },
    enabled: canQuery && !!selectedWorkingUnit && dialogOpen,
  });

  const mutationOptions = {
    onSuccess: async (data: EquipmentDetailResponse) => {
      setSelectedId(data.equipment.id);
      setForm(equipmentToForm(data.equipment, data));
      setDirty(false);
      setConflict(null);
      setDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["equipment"] });
      await queryClient.invalidateQueries({ queryKey: ["equipment-detail", data.equipment.id] });
      await queryClient.invalidateQueries({ queryKey: ["equipment-audit-history", data.equipment.id] });
    },
    onError: (error: ApiError) => {
      if (error.status === 409 && error.body?.equipment) {
        setConflict(error.body.equipment);
        toast({ title: "Bu ekipman başka bir kullanıcı tarafından güncellendi.", variant: "destructive" });
      } else {
        toast({ title: error.message, variant: "destructive" });
      }
    },
  };

  const createMutation = useMutation<EquipmentDetailResponse, ApiError, EquipmentForm>({
    mutationFn: (draft) => apiFetch<EquipmentDetailResponse>(token, `/api/equipment${effectiveCompanyId ? `?companyId=${effectiveCompanyId}` : ""}`, {
      method: "POST",
      body: JSON.stringify(buildPayload(draft, "create")),
    }),
    ...mutationOptions,
  });

  const updateMutation = useMutation<EquipmentDetailResponse, ApiError, EquipmentForm>({
    mutationFn: (draft) => {
      const version = detailQuery.data?.equipment.equipmentVersion ?? conflict?.equipmentVersion;
      return apiFetch<EquipmentDetailResponse>(token, `/api/equipment/${selectedId}${effectiveCompanyId ? `?companyId=${effectiveCompanyId}` : ""}`, {
        method: "PATCH",
        body: JSON.stringify(buildPayload(draft, "edit", version)),
      });
    },
    ...mutationOptions,
  });

  const archiveMutation = useMutation<EquipmentDetailResponse, ApiError, Equipment>({
    mutationFn: (equipment) => apiFetch<EquipmentDetailResponse>(token, `/api/equipment/${equipment.id}/archive${effectiveCompanyId ? `?companyId=${effectiveCompanyId}` : ""}`, {
      method: "POST",
      body: JSON.stringify({ expectedEquipmentVersion: equipment.equipmentVersion, reason: archiveReason || null }),
    }),
    onSuccess: async (data) => {
      setArchiveTarget(null);
      setArchiveReason("");
      setArchiveError(null);
      setSelectedId(data.equipment.id);
      await queryClient.invalidateQueries({ queryKey: ["equipment"] });
      await queryClient.invalidateQueries({ queryKey: ["equipment-detail", data.equipment.id] });
      await queryClient.invalidateQueries({ queryKey: ["equipment-audit-history", data.equipment.id] });
      toast({ title: "Ekipman arşivlendi" });
    },
    onError: (error) => {
      const childCount = error.body?.activeChildCount;
      const message = childCount ? `${error.message} Aktif alt ekipman sayisi: ${childCount}.` : error.message;
      setArchiveError(message);
      toast({ title: message, variant: "destructive" });
    },
  });

  const reactivateMutation = useMutation<EquipmentDetailResponse, ApiError, Equipment>({
    mutationFn: (equipment) => apiFetch<EquipmentDetailResponse>(token, `/api/equipment/${equipment.id}/reactivate${effectiveCompanyId ? `?companyId=${effectiveCompanyId}` : ""}`, {
      method: "POST",
      body: JSON.stringify({ expectedEquipmentVersion: equipment.equipmentVersion, status: reactivateStatus }),
    }),
    onSuccess: async (data) => {
      setReactivateTarget(null);
      setReactivateStatus("active");
      setSelectedId(data.equipment.id);
      await queryClient.invalidateQueries({ queryKey: ["equipment"] });
      await queryClient.invalidateQueries({ queryKey: ["equipment-detail", data.equipment.id] });
      await queryClient.invalidateQueries({ queryKey: ["equipment-audit-history", data.equipment.id] });
      toast({ title: "Ekipman yeniden aktifleştirildi" });
    },
    onError: (error) => toast({ title: error.message, variant: "destructive" }),
  });

  const unitName = useMemo(() => new Map((units ?? []).map((unit: any) => [unit.id, unit.name])), [units]);
  const subUnitName = useMemo(() => new Map((subUnitsQuery.data ?? []).map((row) => [row.id, row.name])), [subUnitsQuery.data]);
  const meterName = useMemo(() => new Map((metersQuery.data ?? []).map((row) => [row.id, row.name])), [metersQuery.data]);
  const sourceName = useMemo(() => new Map((sourcesQuery.data ?? []).map((row) => [row.id, row.name])), [sourcesQuery.data]);
  const groupName = useMemo(() => new Map((groupsQuery.data ?? []).map((row) => [row.id, row.name])), [groupsQuery.data]);
  const activeMeters = useMemo(() => (metersQuery.data ?? []).filter((row) => row.isActive !== false), [metersQuery.data]);
  const activeSources = useMemo(() => (sourcesQuery.data ?? []).filter((row) => row.active !== false && row.isActive !== false), [sourcesQuery.data]);
  const compatibleGroups = useMemo(() => {
    const subUnitId = asNullableId(form.subUnitId);
    return (groupsQuery.data ?? []).filter((group) => group.isActive !== false && (group.subUnitId === null || group.subUnitId === undefined || subUnitId === null || group.subUnitId === subUnitId));
  }, [form.subUnitId, groupsQuery.data]);
  const rows = listQuery.data?.items ?? [];
  const selectedDetail = detailQuery.data?.equipment;
  const totalPages = Math.max(1, Math.ceil((listQuery.data?.total ?? 0) / pageSize));

  useEffect(() => {
    if (!dialogOpen || mode !== "edit" || dirty || !detailQuery.data) return;
    setForm(equipmentToForm(detailQuery.data.equipment, detailQuery.data));
  }, [detailQuery.data, dialogOpen, dirty, mode]);

  function patch<K extends keyof EquipmentForm>(field: K, value: EquipmentForm[K]) {
    if (field === "unitId") {
      const hasRelations = form.subUnitId !== "none" || form.parentEquipmentId !== "none" || form.energyUseGroupId !== "none" || form.meterLinks.length > 0 || form.energySourceLinks.length > 0;
      if (hasRelations && !window.confirm("Birim değiştirildiğinde seçili alt birim ve enerji ilişkileri temizlenecektir.")) return;
      setForm((current) => ({
        ...current,
        unitId: value as string,
        subUnitId: "none",
        parentEquipmentId: "none",
        energyUseGroupId: "none",
        meterLinks: [],
        energySourceLinks: [],
      }));
      setDirty(true);
      return;
    }
    if (field === "subUnitId") {
      const nextSubUnitId = value as string;
      const hasScopedGroup = form.energyUseGroupId !== "none";
      if (hasScopedGroup && !window.confirm("Alt birim değiştiğinde uyumsuz enerji kullanım grubu temizlenecektir.")) return;
      setForm((current) => ({
        ...current,
        subUnitId: nextSubUnitId,
        energyUseGroupId: "none",
        parentEquipmentId: "none",
      }));
      setDirty(true);
      return;
    }
    setForm((current) => ({ ...current, [field]: value }));
    setDirty(true);
  }

  function openCreate() {
    setMode("create");
    setSelectedId(null);
    setForm({
      ...EMPTY_FORM,
      unitId: standardUnitId ? String(standardUnitId) : unitParam ? String(unitParam) : "",
    });
    setDirty(false);
    setConflict(null);
    setDialogOpen(true);
  }

  function openEdit(equipment: Equipment) {
    setMode("edit");
    setSelectedId(equipment.id);
    const detail = detailQuery.data?.equipment.id === equipment.id ? detailQuery.data : undefined;
    setForm(equipmentToForm(equipment, detail));
    setDirty(false);
    setConflict(null);
    setDialogOpen(true);
  }

  function updateMeterLink(index: number, patchValue: Partial<MeterRelationDraft>) {
    setForm((current) => ({
      ...current,
      meterLinks: current.meterLinks.map((link, linkIndex) => {
        if (linkIndex !== index) return patchValue.isPrimary ? { ...link, isPrimary: false } : link;
        return { ...link, ...patchValue };
      }),
    }));
    setDirty(true);
  }

  function updateSourceLink(index: number, patchValue: Partial<SourceRelationDraft>) {
    setForm((current) => ({
      ...current,
      energySourceLinks: current.energySourceLinks.map((link, linkIndex) => {
        if (linkIndex !== index) return patchValue.isPrimary ? { ...link, isPrimary: false } : link;
        return { ...link, ...patchValue };
      }),
    }));
    setDirty(true);
  }

  function addMeterLink() {
    setForm((current) => ({
      ...current,
      meterLinks: [...current.meterLinks, { meterId: "none", relationRole: "direct", isPrimary: false, sharePercent: "", measurementConfidence: "unknown" }],
    }));
    setDirty(true);
  }

  function addSourceLink() {
    setForm((current) => ({
      ...current,
      energySourceLinks: [...current.energySourceLinks, { energySourceId: "none", relationRole: "primary", isPrimary: false, sharePercent: "", measurementConfidence: "unknown" }],
    }));
    setDirty(true);
  }

  function removeMeterLink(index: number) {
    setForm((current) => ({ ...current, meterLinks: current.meterLinks.filter((_, linkIndex) => linkIndex !== index) }));
    setDirty(true);
  }

  function removeSourceLink(index: number) {
    setForm((current) => ({ ...current, energySourceLinks: current.energySourceLinks.filter((_, linkIndex) => linkIndex !== index) }));
    setDirty(true);
  }

  function updateCustomValue(code: string, value: unknown) {
    setForm((current) => ({ ...current, customValues: { ...current.customValues, [code]: value } }));
    setDirty(true);
  }

  function validateRelationDrafts() {
    const meterIds = form.meterLinks.map((link) => link.meterId).filter((id) => id !== "none" && id !== "");
    if (meterIds.length !== new Set(meterIds).size) return "Bu sayaç zaten ekipmana bağlı.";
    if (form.meterLinks.filter((link) => link.isPrimary).length > 1) return "Yalnız bir sayaç birincil olabilir.";
    const sourceIds = form.energySourceLinks.map((link) => link.energySourceId).filter((id) => id !== "none" && id !== "");
    if (sourceIds.length !== new Set(sourceIds).size) return "Bu enerji kaynağı zaten ekipmana bağlı.";
    if (form.energySourceLinks.filter((link) => link.isPrimary).length > 1) return "Yalnız bir enerji kaynağı birincil olabilir.";
    const shares = [...form.meterLinks.map((link) => link.sharePercent), ...form.energySourceLinks.map((link) => link.sharePercent)];
    if (shares.some((share) => share.trim() !== "" && (!Number.isFinite(Number(share)) || Number(share) < 0 || Number(share) > 100))) return "Pay yüzdesi 0 ile 100 arasında olmalıdır.";
    if (form.energyUseGroupId !== "none" && !compatibleGroups.some((group) => String(group.id) === form.energyUseGroupId)) return "Enerji kullanım grubu seçilen alt birimle uyumlu değil.";
    const missingCustom = (customDefinitionsQuery.data?.definitions ?? []).find((definition) => definition.isActive && definition.isRequired && !hasCustomValue(form.customValues[definition.code]));
    if (missingCustom) return `${missingCustom.label} zorunludur`;
    return null;
  }

  function lifecycleWarnings() {
    const warnings: string[] = [];
    const purchaseYear = form.purchaseDate ? Number(form.purchaseDate.slice(0, 4)) : null;
    const commissioningYear = form.commissioningDate ? Number(form.commissioningDate.slice(0, 4)) : null;
    const manufactureYear = form.manufactureYear.trim() ? Number(form.manufactureYear) : null;
    const replacementYear = form.plannedReplacementYear.trim() ? Number(form.plannedReplacementYear) : null;
    if (form.purchaseDate && form.commissioningDate && form.commissioningDate < form.purchaseDate) warnings.push("Devreye alma tarihi satın alma tarihinden önce görünüyor.");
    if (manufactureYear !== null && purchaseYear !== null && purchaseYear < manufactureYear) warnings.push("Satın alma tarihi üretim yılından önce görünüyor.");
    if (replacementYear !== null && manufactureYear !== null && replacementYear < manufactureYear) warnings.push("Planlanan yenileme yılı üretim yılından önce görünüyor.");
    if (replacementYear !== null && commissioningYear !== null && replacementYear < commissioningYear) warnings.push("Planlanan yenileme yılı devreye alma yılından önce görünüyor.");
    return warnings;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim() || (mode === "create" && !form.equipmentCode.trim())) {
      toast({ title: "Ekipman kodu ve adı zorunludur", variant: "destructive" });
      return;
    }
    if (mode === "create" && !standardUnitId && !form.unitId) {
      toast({ title: "Birim seçimi zorunludur", variant: "destructive" });
      return;
    }
    const relationError = validateRelationDrafts();
    if (relationError) {
      toast({ title: relationError, variant: "destructive" });
      return;
    }
    if (mode === "create") createMutation.mutate(form);
    else updateMutation.mutate(form);
  }

  function clearFilters() {
    setSearch("");
    setFilterUnit("all");
    setFilterSubUnit("all");
    setFilterCategory("all");
    setFilterStatus("all");
    setFilterEnergySource("all");
    setFilterMeter("all");
    setFilterGroup("all");
    setIncludeArchived(false);
    setPage(1);
  }

  function equipmentQueryParams(forExport = false) {
    const params = new URLSearchParams();
    if (!forExport) {
      params.set("limit", String(pageSize));
      params.set("offset", String((page - 1) * pageSize));
    }
    if (effectiveCompanyId) params.set("companyId", String(effectiveCompanyId));
    if (unitParam) params.set("unitId", String(unitParam));
    if (filterSubUnit !== "all") params.set("subUnitId", filterSubUnit);
    if (filterCategory !== "all") params.set("category", filterCategory);
    if (filterStatus !== "all") params.set("status", filterStatus);
    if (filterEnergySource !== "all") params.set("energySourceId", filterEnergySource);
    if (filterMeter !== "all") params.set("meterId", filterMeter);
    if (filterGroup !== "all") params.set("energyUseGroupId", filterGroup);
    if (includeArchived) params.set("includeArchived", "true");
    if (debouncedSearch.length >= 2) params.set("search", debouncedSearch);
    return params;
  }

  async function downloadTemplate() {
    try {
      const params = new URLSearchParams();
      if (effectiveCompanyId) params.set("companyId", String(effectiveCompanyId));
      const { blob, filename } = await apiBlob(token, `/api/equipment/import/template${params.toString() ? `?${params}` : ""}`);
      saveBlob(blob, filename);
      toast({ title: "Ekipman import ÅŸablonu indirildi" });
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : "Åablon indirilemedi", variant: "destructive" });
    }
  }

  async function downloadExport() {
    try {
      const params = equipmentQueryParams(true);
      const { blob, filename } = await apiBlob(token, `/api/equipment/export?${params}`);
      saveBlob(blob, filename);
      toast({ title: "Ekipman envanteri dÄ±ÅŸa aktarÄ±ldÄ±" });
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : "Export alÄ±namadÄ±", variant: "destructive" });
    }
  }

  async function uploadImport(endpoint: "preview" | "apply") {
    if (!importFile) {
      setImportError("XLSX dosyasi seÃ§in.");
      return;
    }
    if (!importFile.name.toLowerCase().endsWith(".xlsx") || importFile.name.toLowerCase().endsWith(".xlsm")) {
      setImportError("YalnÄ±z .xlsx dosyasÄ± kabul edilir.");
      return;
    }
    setImportError(null);
    const params = new URLSearchParams();
    if (effectiveCompanyId) params.set("companyId", String(effectiveCompanyId));
    const formData = new FormData();
    formData.append("file", importFile);
    if (endpoint === "apply") {
      if (!importPreview?.previewHash) {
        setImportError("Ã–nce preview alÄ±n.");
        return;
      }
      formData.append("previewHash", importPreview.previewHash);
    }
    const response = await fetch(`/api/equipment/import/${endpoint}${params.toString() ? `?${params}` : ""}`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) throw new ApiError(response.status, body);
    if (endpoint === "preview") {
      setImportPreview(body as EquipmentImportPreview);
    } else {
      setImportPreview(null);
      setImportFile(null);
      setImportOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["equipment"] });
      if (selectedId !== null) await queryClient.invalidateQueries({ queryKey: ["equipment-detail", selectedId] });
      toast({ title: `Import uygulandÄ±: ${body.appliedCount ?? 0} deÄŸiÅŸiklik` });
    }
  }

  async function previewImport() {
    try {
      await uploadImport("preview");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Preview alÄ±namadÄ±");
    }
  }

  async function applyImport() {
    try {
      await uploadImport("apply");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Import uygulanamadÄ±");
    }
  }

  if (isSuperAdmin && companyId === null) {
    return (
      <div data-testid="equipment-page" className="space-y-4">
        <h1 className="text-2xl font-bold">Ekipman Envanteri</h1>
        <Alert data-testid="equipment-context-required">
          <SlidersHorizontal className="h-4 w-4" />
          <AlertTitle>Firma bağlamı gerekli</AlertTitle>
          <AlertDescription>Superadmin olarak ekipman envanterini görüntülemek için üst çubuktan bir firma seçin.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div data-testid="equipment-page" className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Ekipman Envanteri</h1>
          <p className="text-sm text-muted-foreground mt-1">Enerji tüketen ekipmanları tesis, teknik bilgi ve ölçüm bağlamıyla yönetin.</p>
        </div>
        {canCreate && (
          <div className="flex flex-wrap gap-2 lg:self-start">
            <Button type="button" variant="outline" onClick={downloadTemplate} className="gap-2" data-testid="equipment-template-button">
              <FileSpreadsheet className="h-4 w-4" /> Åablon
            </Button>
            <Button type="button" variant="outline" onClick={downloadExport} className="gap-2" data-testid="equipment-export-button">
              <Download className="h-4 w-4" /> DÄ±ÅŸa Aktar
            </Button>
            <Button type="button" variant="outline" onClick={() => { setImportOpen(true); setImportError(null); }} className="gap-2" data-testid="equipment-import-button">
              <Upload className="h-4 w-4" /> Ä°Ã§e Aktar
            </Button>
            <Button data-testid="equipment-create-button" onClick={openCreate} className="gap-2">
              <Plus className="h-4 w-4" /> Yeni Ekipman
            </Button>
          </div>
        )}
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="equipment-search">Arama</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input id="equipment-search" value={search} onChange={(event) => setSearch(event.target.value)} className="pl-8" placeholder="Kod, ad veya asset kodu" />
              </div>
            </div>
            {isPrivileged && (
              <div className="space-y-1">
                <Label>Birim</Label>
                <Select value={filterUnit} onValueChange={setFilterUnit}>
                  <SelectTrigger data-testid="equipment-filter-unit"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tüm Birimler</SelectItem>
                    {(units ?? []).map((unit: any) => <SelectItem key={unit.id} value={String(unit.id)}>{unit.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <SelectFilter labelText="Alt Birim" value={filterSubUnit} onValueChange={setFilterSubUnit} options={subUnitsQuery.data ?? []} allLabel="Tüm Alt Birimler" />
              <SelectFilter labelText="Kategori" value={filterCategory} onValueChange={setFilterCategory} enumOptions={CATEGORY_OPTIONS} allLabel="Tüm Kategoriler" testId="equipment-filter-category" />
            <SelectFilter labelText="Durum" value={filterStatus} onValueChange={setFilterStatus} enumOptions={STATUS_OPTIONS} allLabel="Tüm Durumlar" />
            <SelectFilter labelText="Enerji Kaynağı" value={filterEnergySource} onValueChange={setFilterEnergySource} options={sourcesQuery.data ?? []} allLabel="Tüm Kaynaklar" />
            <SelectFilter labelText="Sayaç" value={filterMeter} onValueChange={setFilterMeter} options={metersQuery.data ?? []} allLabel="Tüm Sayaçlar" />
            <SelectFilter labelText="Enerji Kullanım Grubu" value={filterGroup} onValueChange={setFilterGroup} options={groupsQuery.data ?? []} allLabel="Tüm Gruplar" />
            <div className="flex items-end justify-between gap-3">
              <label className="flex h-10 items-center gap-2 text-sm">
                <Checkbox checked={includeArchived} onCheckedChange={(value) => setIncludeArchived(value === true)} />
                Arşivlileri dahil et
              </label>
              <Button type="button" variant="outline" onClick={clearFilters}>Temizle</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {listQuery.isError && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Liste yüklenemedi</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{listQuery.error.message}</span>
            <Button variant="secondary" size="sm" onClick={() => listQuery.refetch()}>Tekrar dene</Button>
          </AlertDescription>
        </Alert>
      )}

      {listQuery.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20 w-full" />)}</div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Box className="h-10 w-10 text-muted-foreground" />
            <div>
              <h2 className="font-semibold">Henüz ekipman kaydı bulunmuyor.</h2>
              <p className="text-sm text-muted-foreground mt-1">Enerji tüketen ekipmanları kaydederek sayaç, enerji kaynağı ve performans analizleriyle ilişkilendirebilirsiniz.</p>
            </div>
            <div className="flex gap-2">
              {canCreate && <Button onClick={openCreate}>Ekipman ekle</Button>}
              <Button variant="outline" onClick={clearFilters}>Filtreleri temizle</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Kod / Ad</th>
                    <th className="px-4 py-3">Kategori</th>
                    <th className="px-4 py-3">Birim</th>
                    <th className="px-4 py-3">Durum</th>
                    <th className="px-4 py-3">Operasyon</th>
                    <th className="px-4 py-3">Enerji / Sayaç</th>
                    <th className="px-4 py-3">Güç</th>
                    <th className="px-4 py-3">Son Güncelleme</th>
                    <th className="px-4 py-3 text-right">Aksiyon</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((equipment) => (
                    <tr key={equipment.id} data-testid="equipment-row" className="border-t hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div className="font-medium">{equipment.equipmentCode}</div>
                        <div className="text-muted-foreground">{equipment.name}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{label(CATEGORY_OPTIONS, equipment.category)}</div>
                        <div className="text-muted-foreground">{equipment.subType || label([["physical", "Fiziksel"], ["logical", "Mantıksal"]], equipment.equipmentKind)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{unitName.get(equipment.unitId) ?? equipment.unitId}</div>
                        <div className="text-muted-foreground">{equipment.subUnitId ? subUnitName.get(equipment.subUnitId) ?? equipment.subUnitId : "—"}</div>
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={equipment.status} /></td>
                      <td className="px-4 py-3">{label(OPERATIONAL_OPTIONS, equipment.operationalStatus)}</td>
                      <td className="px-4 py-3">
                        <div>{equipment.primaryEnergySourceId ? sourceName.get(equipment.primaryEnergySourceId) ?? equipment.primaryEnergySourceId : "—"}</div>
                        <div className="text-muted-foreground">{equipment.primaryMeterId ? meterName.get(equipment.primaryMeterId) ?? equipment.primaryMeterId : "—"}</div>
                      </td>
                      <td className="px-4 py-3">{powerSummary(equipment)}</td>
                      <td className="px-4 py-3">{new Date(equipment.updatedAt).toLocaleDateString("tr-TR")}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => setSelectedId(equipment.id)} aria-label={`${equipment.equipmentCode} detay`}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          {equipment.status !== "archived" && (
                            <Button variant="ghost" size="sm" onClick={() => openEdit(equipment)} aria-label={`${equipment.equipmentCode} düzenle`}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {listQuery.data?.permissions.canArchive && equipment.status !== "archived" && (
                            <Button variant="ghost" size="sm" onClick={() => dirty ? toast({ title: "Önce açık form değişikliklerini kaydedin veya sıfırlayın.", variant: "destructive" }) : (setArchiveError(null), setArchiveTarget(equipment))} aria-label={`${equipment.equipmentCode} arşivle`}>
                              <Archive className="h-4 w-4" />
                            </Button>
                          )}
                          {listQuery.data?.permissions.canArchive && equipment.status === "archived" && (
                            <Button variant="ghost" size="sm" onClick={() => { setReactivateStatus("active"); setReactivateTarget(equipment); }} aria-label={`${equipment.equipmentCode} aktifleştir`}>
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-3 border-t p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-muted-foreground">Toplam {listQuery.data?.total ?? 0} kayıt, sayfa {page}/{totalPages}</div>
              <div className="flex items-center gap-2">
                <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPage(1); }}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[10, 20, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button variant="outline" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Önceki</Button>
                <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Sonraki</Button>
              </div>
            </div>
          </Card>

          <EquipmentDetail
            detail={detailQuery.data}
            loading={detailQuery.isLoading}
            unitName={unitName}
            subUnitName={subUnitName}
            meterName={meterName}
            sourceName={sourceName}
            groupName={groupName}
            auditEvents={auditHistoryQuery.data?.items ?? []}
            auditLoading={auditHistoryQuery.isLoading}
            auditHasNext={auditHistoryQuery.data?.hasNext ?? false}
            onEdit={selectedDetail && selectedDetail.status !== "archived" ? () => openEdit(selectedDetail) : undefined}
          />
        </div>
      )}

      <Dialog open={importOpen} onOpenChange={(open) => {
        setImportOpen(open);
        if (!open) {
          setImportPreview(null);
          setImportError(null);
          setImportFile(null);
        }
      }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl" data-testid="equipment-import-dialog">
          <DialogHeader>
            <DialogTitle>Ekipman Ä°Ã§e Aktar</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="equipment-import-file">XLSX dosyasÄ±</Label>
              <Input
                id="equipment-import-file"
                type="file"
                accept=".xlsx"
                onChange={(event) => {
                  setImportFile(event.target.files?.[0] ?? null);
                  setImportPreview(null);
                  setImportError(null);
                }}
              />
              <div className="text-xs text-muted-foreground">Mod: update_non_empty. BoÅŸ hÃ¼cre mevcut deÄŸeri korur; temizlemek iÃ§in __CLEAR__.</div>
            </div>
            {importError && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertTitle>Import hazÄ±rlanamadÄ±</AlertTitle>
                <AlertDescription>{importError}</AlertDescription>
              </Alert>
            )}
            {importPreview && (
              <div className="space-y-3" aria-live="polite">
                <div className="grid gap-2 sm:grid-cols-5">
                  <SummaryCell labelText="SatÄ±r" value={importPreview.totalRows} />
                  <SummaryCell labelText="Create" value={importPreview.createCount} />
                  <SummaryCell labelText="Update" value={importPreview.updateCount} />
                  <SummaryCell labelText="No-change" value={importPreview.noChangeCount} />
                  <SummaryCell labelText="Hata" value={importPreview.errorCount} />
                </div>
                <div className="rounded-md border p-3 text-sm">
                  <div>SayaÃ§ relation replace: {importPreview.relationSummary.meterReplaceCount}</div>
                  <div>Enerji kaynaÄŸÄ± relation replace: {importPreview.relationSummary.energySourceReplaceCount}</div>
                </div>
                {importPreview.issues.length > 0 && (
                  <div className="max-h-60 overflow-y-auto rounded-md border">
                    <table className="w-full min-w-[640px] text-xs">
                      <thead className="bg-muted/50 text-left text-muted-foreground">
                        <tr>
                          <th className="px-2 py-2">Sheet</th>
                          <th className="px-2 py-2">SatÄ±r</th>
                          <th className="px-2 py-2">Kolon</th>
                          <th className="px-2 py-2">Kod</th>
                          <th className="px-2 py-2">Mesaj</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importPreview.issues.slice(0, 80).map((item, index) => (
                          <tr key={`${item.sheet}-${item.row}-${item.column}-${item.code}-${index}`} className="border-t">
                            <td className="px-2 py-2">{item.sheet}</td>
                            <td className="px-2 py-2">{item.row ?? "â€”"}</td>
                            <td className="px-2 py-2">{item.column ?? "â€”"}</td>
                            <td className="px-2 py-2">{item.code}</td>
                            <td className="px-2 py-2">{item.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="max-h-60 overflow-y-auto rounded-md border">
                  <table className="w-full min-w-[560px] text-xs">
                    <thead className="bg-muted/50 text-left text-muted-foreground">
                      <tr>
                        <th className="px-2 py-2">SatÄ±r</th>
                        <th className="px-2 py-2">Ekipman</th>
                        <th className="px-2 py-2">Aksiyon</th>
                        <th className="px-2 py-2">Alanlar</th>
                        <th className="px-2 py-2">Ã–zel alan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.rows.map((row) => (
                        <tr key={`${row.row}-${row.equipmentCode}`} className="border-t">
                          <td className="px-2 py-2">{row.row}</td>
                          <td className="px-2 py-2">{row.equipmentCode}</td>
                          <td className="px-2 py-2">{row.action}</td>
                          <td className="px-2 py-2">{row.changedFields.slice(0, 6).join(", ") || "â€”"}</td>
                          <td className="px-2 py-2">{row.customFieldCodes.join(", ") || "â€”"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setImportOpen(false)}>Kapat</Button>
            <Button type="button" variant="secondary" onClick={previewImport} disabled={!importFile}>Preview</Button>
            <Button type="button" onClick={applyImport} disabled={!importPreview?.canApply}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={(open) => {
        if (!open && dirty && !window.confirm("Kaydedilmemiş değişiklikler kaybolacak. Devam edilsin mi?")) return;
        setDialogOpen(open);
        if (!open) setDirty(false);
      }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? "Yeni Ekipman" : "Ekipmanı Düzenle"}</DialogTitle>
          </DialogHeader>
          {conflict && (
            <Alert variant="destructive">
              <RefreshCcw className="h-4 w-4" />
              <AlertTitle>Bu ekipman başka bir kullanıcı tarafından güncellendi.</AlertTitle>
              <AlertDescription className="space-y-2">
                <div>Sunucu sürümü: {conflict.equipmentVersion}. Form değerleriniz korunuyor.</div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => { setForm(equipmentToForm(conflict)); setConflict(null); setDirty(false); }}>Güncel veriyi yükle</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setConflict(null)}>Düzenlemeye devam et</Button>
                </div>
              </AlertDescription>
            </Alert>
          )}
          <form className="space-y-6" onSubmit={submit}>
            <FormSection title="Kimlik">
              <TextField id="equipment-code" labelText="Ekipman kodu *" value={form.equipmentCode} disabled={mode === "edit"} maxLength={64} onChange={(value) => patch("equipmentCode", value)} />
              <TextField id="equipment-name" labelText="Ekipman adı *" value={form.name} maxLength={160} onChange={(value) => patch("name", value)} />
              <SelectField labelText="Tür" value={form.equipmentKind} onValueChange={(value) => patch("equipmentKind", value)} options={[["physical", "Fiziksel"], ["logical", "Mantıksal"]]} />
              <SelectField labelText="Kategori" value={form.category} onValueChange={(value) => patch("category", value)} options={CATEGORY_OPTIONS} />
              <TextField id="equipment-sub-type" labelText="Alt tür" value={form.subType} maxLength={120} onChange={(value) => patch("subType", value)} />
              <SelectField labelText="Durum" value={form.status} onValueChange={(value) => patch("status", value as EquipmentStatus)} options={STATUS_OPTIONS.filter(([value]) => value !== "archived")} />
            </FormSection>

            <FormSection title="Varlık Bilgileri">
              <TextField id="equipment-asset-code" labelText="Asset kodu" value={form.assetCode} maxLength={120} onChange={(value) => patch("assetCode", value)} />
              <TextField id="equipment-manufacturer" labelText="Üretici" value={form.manufacturer} maxLength={120} onChange={(value) => patch("manufacturer", value)} />
              <TextField id="equipment-brand" labelText="Marka" value={form.brand} maxLength={120} onChange={(value) => patch("brand", value)} />
              <TextField id="equipment-model" labelText="Model" value={form.model} maxLength={120} onChange={(value) => patch("model", value)} />
              <TextField id="equipment-serial" labelText="Seri numarası" value={form.serialNumber} maxLength={120} onChange={(value) => patch("serialNumber", value)} />
              <TextField id="equipment-tag" labelText="Etiket kodu" value={form.tagCode} maxLength={120} onChange={(value) => patch("tagCode", value)} />
            </FormSection>

            <FormSection title="Konum">
              {isPrivileged ? (
                <SelectFilter labelText="Unit *" value={form.unitId || "none"} onValueChange={(value) => patch("unitId", value === "none" ? "" : value)} options={(units ?? []) as OptionRow[]} allLabel="Birim seç" allValue="none" testId="equipment-form-unit" />
              ) : (
                <ReadOnlyField labelText="Unit" value={unitName.get(standardUnitId ?? 0) ?? "Kendi biriminiz"} />
              )}
              <SelectFilter labelText="SubUnit" value={form.subUnitId} onValueChange={(value) => patch("subUnitId", value)} options={subUnitsQuery.data ?? []} allLabel="Yok" allValue="none" />
              <SelectFilter labelText="Parent ekipman" value={form.parentEquipmentId} onValueChange={(value) => patch("parentEquipmentId", value)} options={(parentOptionsQuery.data?.items ?? []).filter((item) => item.id !== selectedId).map((item) => ({ id: item.id, name: `${item.equipmentCode} - ${item.name}` }))} allLabel="Yok" allValue="none" />
              <SelectFilter labelText="Enerji kullanım grubu" value={form.energyUseGroupId} onValueChange={(value) => patch("energyUseGroupId", value)} options={compatibleGroups} allLabel="Yok" allValue="none" />
              <TextField id="equipment-location" labelText="Lokasyon açıklaması" value={form.locationText} maxLength={240} onChange={(value) => patch("locationText", value)} />
              <TextField id="equipment-building" labelText="Bina" value={form.buildingText} maxLength={160} onChange={(value) => patch("buildingText", value)} />
              <TextField id="equipment-process" labelText="Proses" value={form.processText} maxLength={160} onChange={(value) => patch("processText", value)} />
            </FormSection>

            <FormSection title="Teknik Bilgiler">
              <TextField id="equipment-rated-power" labelText="Nominal güç" type="number" value={form.ratedPowerValue} onChange={(value) => patch("ratedPowerValue", value)} />
              <TextField id="equipment-rated-unit" labelText="Güç birimi" value={form.ratedPowerUnit} maxLength={24} onChange={(value) => patch("ratedPowerUnit", value)} />
              <TextField id="equipment-installed-power" labelText="Kurulu güç (kW)" type="number" value={form.installedPowerKw} onChange={(value) => patch("installedPowerKw", value)} />
              <TextField id="equipment-capacity" labelText="Kapasite" type="number" value={form.capacityValue} onChange={(value) => patch("capacityValue", value)} />
              <TextField id="equipment-capacity-unit" labelText="Kapasite birimi" value={form.capacityUnit} maxLength={40} onChange={(value) => patch("capacityUnit", value)} />
              <TextField id="equipment-efficiency" labelText="Nominal verim (%)" type="number" value={form.nominalEfficiencyPercent} onChange={(value) => patch("nominalEfficiencyPercent", value)} />
            </FormSection>

            <FormSection title="Operasyon">
              <SelectField labelText="Operasyon durumu" value={form.operationalStatus} onValueChange={(value) => patch("operationalStatus", value)} options={[["none", "Belirtilmedi"], ...OPERATIONAL_OPTIONS]} />
              <TextField id="equipment-daily-hours" labelText="Günlük çalışma saati" type="number" value={form.dailyOperatingHours} onChange={(value) => patch("dailyOperatingHours", value)} />
              <TextField id="equipment-annual-hours" labelText="Yıllık çalışma saati" type="number" value={form.annualOperatingHours} onChange={(value) => patch("annualOperatingHours", value)} />
              <TextField id="equipment-load" labelText="Ortalama yük (%)" type="number" value={form.averageLoadPercent} onChange={(value) => patch("averageLoadPercent", value)} />
              <SelectField labelText="Sezonluk çalışma" value={form.seasonalOperationStatus} onValueChange={(value) => patch("seasonalOperationStatus", value)} options={[["none", "Belirtilmedi"], ...YES_NO_UNKNOWN_OPTIONS]} />
            </FormSection>

            <FormSection title="Yaşam Döngüsü">
              <TextField id="equipment-purchase-date" labelText="Satın alma tarihi" type="date" value={form.purchaseDate} onChange={(value) => patch("purchaseDate", value)} />
              <TextField id="equipment-commissioning-date" labelText="Devreye alma tarihi" type="date" value={form.commissioningDate} onChange={(value) => patch("commissioningDate", value)} />
              <TextField id="equipment-manufacture-year" labelText="Üretim yılı" type="number" value={form.manufactureYear} onChange={(value) => patch("manufactureYear", value)} />
              <TextField id="equipment-life" labelText="Beklenen ömür" type="number" value={form.expectedLifeYears} onChange={(value) => patch("expectedLifeYears", value)} />
              <TextField id="equipment-replacement" labelText="Planlanan yenileme yılı" type="number" value={form.plannedReplacementYear} onChange={(value) => patch("plannedReplacementYear", value)} />
              {lifecycleWarnings().length > 0 && (
                <Alert data-testid="equipment-lifecycle-warnings" className="md:col-span-2">
                  <AlertTitle>Yaşam döngüsü uyarısı</AlertTitle>
                  <AlertDescription>{lifecycleWarnings().join(" ")}</AlertDescription>
                </Alert>
              )}
            </FormSection>

            <FormSection title="Kritiklik">
              <SelectField labelText="Ölçüm yöntemi" value={form.measurementMethod} onValueChange={(value) => patch("measurementMethod", value)} options={METHOD_OPTIONS} />
              <SelectField labelText="Ölçüm güven seviyesi" value={form.measurementConfidence} onValueChange={(value) => patch("measurementConfidence", value)} options={CONFIDENCE_OPTIONS} />
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.isEnergyIntensive} onCheckedChange={(value) => patch("isEnergyIntensive", value === true)} /> Enerji yoğun ekipman</label>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.isCritical} onCheckedChange={(value) => patch("isCritical", value === true)} /> Kritik ekipman</label>
              <TextareaField id="equipment-criticality" labelText="Kritik olma nedeni" value={form.criticalityReason} maxLength={500} onChange={(value) => patch("criticalityReason", value)} />
              <TextareaField id="equipment-saving" labelText="Tasarruf potansiyeli" value={form.savingPotential} maxLength={500} onChange={(value) => patch("savingPotential", value)} />
            </FormSection>

            <RelationSection title="Sayaç İlişkileri" description="Pay yüzdesi, ortak sayaç veya enerji kaynağının bu ekipmana atfedilen yaklaşık oranını ifade eder. Toplamın 100 olması zorunlu değildir." onAdd={addMeterLink} addLabel="Sayaç ilişkisi ekle">
              <MeterRelationEditor rows={form.meterLinks} options={activeMeters} onChange={updateMeterLink} onRemove={removeMeterLink} />
            </RelationSection>

            <RelationSection title="Enerji Kaynağı İlişkileri" description="Birincil seçim tekildir; yeni bir satır birincil yapıldığında önceki birincil seçim kaldırılır. İsterseniz hiç birincil bırakmayabilirsiniz." onAdd={addSourceLink} addLabel="Enerji kaynağı ilişkisi ekle">
              <SourceRelationEditor rows={form.energySourceLinks} options={activeSources} onChange={updateSourceLink} onRemove={removeSourceLink} />
            </RelationSection>

            <CustomFieldsSection definitions={customDefinitionsQuery.data?.definitions ?? []} values={form.customValues} onChange={updateCustomValue} />

            <FormSection title="Açıklamalar" wide>
              <TextareaField id="equipment-technical-notes" labelText="Teknik notlar" value={form.technicalNotes} maxLength={1000} onChange={(value) => patch("technicalNotes", value)} />
              <TextareaField id="equipment-maintenance-notes" labelText="Bakım notları" value={form.maintenanceNotes} maxLength={1000} onChange={(value) => patch("maintenanceNotes", value)} />
              <TextareaField id="equipment-opportunities" labelText="Verimlilik fırsatları" value={form.efficiencyOpportunities} maxLength={1000} onChange={(value) => patch("efficiencyOpportunities", value)} />
              <TextareaField id="equipment-improvements" labelText="Planlanan iyileştirmeler" value={form.plannedImprovements} maxLength={1000} onChange={(value) => patch("plannedImprovements", value)} />
            </FormSection>

            <DialogFooter className="sticky bottom-0 bg-background py-3">
              <Button type="button" variant="outline" onClick={() => { setForm(mode === "edit" && detailQuery.data ? equipmentToForm(detailQuery.data.equipment, detailQuery.data) : EMPTY_FORM); setDirty(false); }}>Sıfırla</Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending || !dirty}>
                {mode === "create" ? "Oluştur" : "Kaydet"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={archiveTarget !== null} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ekipman arşivlensin mi?</AlertDialogTitle>
            <AlertDialogDescription>
              {archiveTarget?.equipmentCode} - {archiveTarget?.name} kaydı varsayılan listeden gizlenecek. Sayaç, enerji kaynağı, parent ve özel alan değerleri silinmez.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {archiveError && <Alert variant="destructive"><AlertTitle>Arşivlenemedi</AlertTitle><AlertDescription>{archiveError}</AlertDescription></Alert>}
          <div className="space-y-1">
            <Label htmlFor="equipment-archive-reason">Arşiv nedeni *</Label>
            <Textarea id="equipment-archive-reason" value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} maxLength={500} placeholder="Örn. ekipman devreden çıkarıldı" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Vazgeç</AlertDialogCancel>
            <AlertDialogAction disabled={archiveReason.trim().length === 0 || archiveMutation.isPending} onClick={() => archiveTarget && archiveMutation.mutate(archiveTarget)}>Arşivle</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={reactivateTarget !== null} onOpenChange={(open) => !open && setReactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ekipman yeniden aktifleştirilsin mi?</AlertDialogTitle>
            <AlertDialogDescription>{reactivateTarget?.equipmentCode} - {reactivateTarget?.name} yeniden açılacak. İlişkiler otomatik değiştirilmez.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <Label>Hedef durum</Label>
            <Select value={reactivateStatus} onValueChange={(value) => setReactivateStatus(value as Exclude<EquipmentStatus, "archived">)}>
              <SelectTrigger data-testid="equipment-reactivate-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.filter(([value]) => value !== "archived").map(([value, text]) => <SelectItem key={value} value={value}>{text}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Vazgeç</AlertDialogCancel>
            <AlertDialogAction disabled={reactivateMutation.isPending} onClick={() => reactivateTarget && reactivateMutation.mutate(reactivateTarget)}>Aktifleştir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SelectFilter({ labelText, value, onValueChange, options, enumOptions, allLabel, allValue = "all", testId }: {
  labelText: string;
  value: string;
  onValueChange: (value: string) => void;
  options?: OptionRow[];
  enumOptions?: readonly (readonly [string, string])[];
  allLabel: string;
  allValue?: string;
  testId?: string;
}) {
  return (
    <div className="space-y-1">
      <Label>{labelText}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger data-testid={testId}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={allValue}>{allLabel}</SelectItem>
          {enumOptions?.map(([key, text]) => <SelectItem key={key} value={key}>{text}</SelectItem>)}
          {options?.map((option) => <SelectItem key={option.id} value={String(option.id)}>{option.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function SelectField({ labelText, value, onValueChange, options }: {
  labelText: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
}) {
  return (
    <div className="space-y-1">
      <Label>{labelText}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{options.map(([key, text]) => <SelectItem key={key} value={key}>{text}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

function TextField({ id, labelText, value, onChange, maxLength, type = "text", disabled = false }: {
  id: string;
  labelText: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{labelText}</Label>
      <Input id={id} type={type} value={value} disabled={disabled} maxLength={maxLength} min={type === "number" ? 0 : undefined} onChange={(event) => onChange(event.target.value)} />
      {maxLength && <div className="text-[11px] text-muted-foreground">{value.length}/{maxLength}</div>}
    </div>
  );
}

function TextareaField({ id, labelText, value, onChange, maxLength }: {
  id: string;
  labelText: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
}) {
  return (
    <div className="space-y-1 md:col-span-2">
      <Label htmlFor={id}>{labelText}</Label>
      <Textarea id={id} value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} />
      <div className="text-[11px] text-muted-foreground">{value.length}/{maxLength}</div>
    </div>
  );
}

function ReadOnlyField({ labelText, value }: { labelText: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium">{labelText}</div>
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">{value}</div>
    </div>
  );
}

function FormSection({ title, children, wide = false }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold uppercase text-muted-foreground">{title}</h3>
      <div className={`grid gap-3 ${wide ? "md:grid-cols-2" : "md:grid-cols-3"}`}>{children}</div>
    </section>
  );
}

function RelationSection({ title, description, addLabel, onAdd, children }: {
  title: string;
  description: string;
  addLabel: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase text-muted-foreground">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onAdd} className="gap-2">
          <Plus className="h-4 w-4" /> {addLabel}
        </Button>
      </div>
      {children}
    </section>
  );
}

function MeterRelationEditor({ rows, options, onChange, onRemove }: {
  rows: MeterRelationDraft[];
  options: OptionRow[];
  onChange: (index: number, patchValue: Partial<MeterRelationDraft>) => void;
  onRemove: (index: number) => void;
}) {
  if (rows.length === 0) return <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Henüz sayaç ilişkisi yok.</div>;
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[920px] text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Sayaç</th>
            <th className="px-3 py-2">Role</th>
            <th className="px-3 py-2">Birincil</th>
            <th className="px-3 py-2">Pay %</th>
            <th className="px-3 py-2">Güven</th>
            <th className="px-3 py-2">Özet</th>
            <th className="px-3 py-2 text-right">Aksiyon</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const selected = options.find((option) => String(option.id) === row.meterId);
            return (
              <tr key={`${row.meterId}-${index}`} className="border-t align-top">
                <td className="px-3 py-2"><SelectFilter labelText={`Sayaç ${index + 1}`} value={row.meterId} onValueChange={(value) => onChange(index, { meterId: value })} options={options} allLabel="Sayaç seç" allValue="none" testId={`equipment-meter-link-${index}`} /></td>
                <td className="px-3 py-2"><SelectField labelText="Role" value={row.relationRole} onValueChange={(value) => onChange(index, { relationRole: value })} options={METER_RELATION_ROLE_OPTIONS} /></td>
                <td className="px-3 py-2">
                  <label className="flex h-10 items-center gap-2 text-sm">
                    <Checkbox checked={row.isPrimary} onCheckedChange={(value) => onChange(index, { isPrimary: value === true })} />
                    Birincil
                  </label>
                </td>
                <td className="px-3 py-2"><Input aria-label={`Sayaç ${index + 1} pay yüzdesi`} type="number" min={0} max={100} value={row.sharePercent} onChange={(event) => onChange(index, { sharePercent: event.target.value })} /></td>
                <td className="px-3 py-2"><SelectField labelText="Güven" value={row.measurementConfidence} onValueChange={(value) => onChange(index, { measurementConfidence: value })} options={CONFIDENCE_OPTIONS} /></td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{selected ? `${selected.type ?? "—"} / ${selected.unit ?? "—"} / ${selected.subUnitName ?? "Genel"}` : "—"}</td>
                <td className="px-3 py-2 text-right"><Button type="button" variant="ghost" size="sm" onClick={() => onRemove(index)} aria-label={`${selected?.name ?? "Sayaç ilişkisi"} kaldır`}>Kaldır</Button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SourceRelationEditor({ rows, options, onChange, onRemove }: {
  rows: SourceRelationDraft[];
  options: OptionRow[];
  onChange: (index: number, patchValue: Partial<SourceRelationDraft>) => void;
  onRemove: (index: number) => void;
}) {
  if (rows.length === 0) return <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Henüz enerji kaynağı ilişkisi yok.</div>;
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[860px] text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Kaynak</th>
            <th className="px-3 py-2">Role</th>
            <th className="px-3 py-2">Birincil</th>
            <th className="px-3 py-2">Pay %</th>
            <th className="px-3 py-2">Güven</th>
            <th className="px-3 py-2">Özet</th>
            <th className="px-3 py-2 text-right">Aksiyon</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const selected = options.find((option) => String(option.id) === row.energySourceId);
            return (
              <tr key={`${row.energySourceId}-${index}`} className="border-t align-top">
                <td className="px-3 py-2"><SelectFilter labelText={`Kaynak ${index + 1}`} value={row.energySourceId} onValueChange={(value) => onChange(index, { energySourceId: value })} options={options} allLabel="Kaynak seç" allValue="none" testId={`equipment-source-link-${index}`} /></td>
                <td className="px-3 py-2"><SelectField labelText="Role" value={row.relationRole} onValueChange={(value) => onChange(index, { relationRole: value })} options={SOURCE_RELATION_ROLE_OPTIONS} /></td>
                <td className="px-3 py-2">
                  <label className="flex h-10 items-center gap-2 text-sm">
                    <Checkbox checked={row.isPrimary} onCheckedChange={(value) => onChange(index, { isPrimary: value === true })} />
                    Birincil
                  </label>
                </td>
                <td className="px-3 py-2"><Input aria-label={`Kaynak ${index + 1} pay yüzdesi`} type="number" min={0} max={100} value={row.sharePercent} onChange={(event) => onChange(index, { sharePercent: event.target.value })} /></td>
                <td className="px-3 py-2"><SelectField labelText="Güven" value={row.measurementConfidence} onValueChange={(value) => onChange(index, { measurementConfidence: value })} options={CONFIDENCE_OPTIONS} /></td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{selected ? `${selected.type ?? "—"} / ${selected.unit ?? "—"}` : "—"}</td>
                <td className="px-3 py-2 text-right"><Button type="button" variant="ghost" size="sm" onClick={() => onRemove(index)} aria-label={`${selected?.name ?? "Enerji kaynağı ilişkisi"} kaldır`}>Kaldır</Button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CustomFieldsSection({ definitions, values, onChange }: {
  definitions: EquipmentCustomFieldDefinition[];
  values: Record<string, unknown>;
  onChange: (code: string, value: unknown) => void;
}) {
  const sorted = [...definitions].sort((a, b) => a.displayOrder - b.displayOrder || a.label.localeCompare(b.label));
  if (sorted.length === 0) {
    return (
      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase text-muted-foreground">Firma Özel Alanları</h3>
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Bu firma için ekipman özel alanı tanımlanmamış.</div>
      </section>
    );
  }
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold uppercase text-muted-foreground">Firma Özel Alanları</h3>
      <div className="grid gap-3 md:grid-cols-2">
        {sorted.map((definition) => (
          <CustomFieldInput key={definition.code} definition={definition} value={values[definition.code]} onChange={(value) => onChange(definition.code, value)} />
        ))}
      </div>
    </section>
  );
}

function CustomFieldInput({ definition, value, onChange }: {
  definition: EquipmentCustomFieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const id = `equipment-custom-${definition.code}`;
  const labelText = `${definition.label}${definition.isRequired ? " *" : ""}`;
  const disabled = !definition.isActive;
  if (definition.fieldType === "long_text") {
    const text = typeof value === "string" ? value : "";
    return (
      <div className="space-y-1 md:col-span-2">
        <Label htmlFor={id}>{labelText}</Label>
        <Textarea id={id} value={text} disabled={disabled} maxLength={2000} onChange={(event) => onChange(event.target.value)} />
        <div className="flex justify-between text-[11px] text-muted-foreground"><span>{definition.description}</span><span>{text.length}/2000</span></div>
      </div>
    );
  }
  if (definition.fieldType === "boolean") {
    return (
      <SelectField labelText={labelText} value={typeof value === "string" ? value : "unknown"} onValueChange={onChange} options={[["yes", "Evet"], ["no", "Hayır"], ["unknown", "Bilinmiyor"], ["not_applicable", "Uygulanamaz"]]} />
    );
  }
  if (definition.fieldType === "single_select") {
    return <SelectField labelText={labelText} value={typeof value === "string" ? value : "none"} onValueChange={(next) => onChange(next === "none" ? null : next)} options={[["none", "Yok"], ...definition.options.filter((option) => option.isActive).map((option) => [option.code, option.label] as const)]} />;
  }
  if (definition.fieldType === "multi_select") {
    const selected = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    return (
      <div className="space-y-1">
        <Label>{labelText}</Label>
        <div className="rounded-md border p-2">
          {definition.options.filter((option) => option.isActive).map((option) => (
            <label key={option.code} className="flex items-center gap-2 py-1 text-sm">
              <Checkbox checked={selected.includes(option.code)} onCheckedChange={(checked) => {
                const next = checked === true ? [...selected, option.code] : selected.filter((code) => code !== option.code);
                onChange([...new Set(next)]);
              }} />
              {option.label}
            </label>
          ))}
        </div>
        {definition.description && <div className="text-[11px] text-muted-foreground">{definition.description}</div>}
      </div>
    );
  }
  const inputType = definition.fieldType === "date" ? "date" : definition.fieldType === "short_text" ? "text" : "number";
  const textValue = value === null || value === undefined ? "" : String(value);
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{labelText}</Label>
      <div className="flex gap-2">
        <Input id={id} type={inputType} value={textValue} disabled={disabled} maxLength={definition.fieldType === "short_text" ? 250 : undefined} onChange={(event) => {
          const next = event.target.value;
          if (definition.fieldType === "integer") onChange(next === "" ? null : Number.parseInt(next, 10));
          else if (definition.fieldType === "decimal" || definition.fieldType === "unit_number") onChange(next === "" ? null : Number(next));
          else onChange(next);
        }} />
        {definition.unitLabel && <div className="flex min-w-12 items-center rounded-md border bg-muted/30 px-2 text-sm text-muted-foreground">{definition.unitLabel}</div>}
      </div>
      {definition.description && <div className="text-[11px] text-muted-foreground">{definition.description}</div>}
      {!definition.isActive && <Badge variant="outline">Pasif</Badge>}
    </div>
  );
}

function StatusBadge({ status }: { status: EquipmentStatus }) {
  const tone = status === "active" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
    : status === "archived" ? "border-slate-500/30 bg-slate-500/10 text-slate-300"
      : status === "faulty" ? "border-red-500/30 bg-red-500/10 text-red-400"
        : "border-amber-500/30 bg-amber-500/10 text-amber-400";
  return <Badge variant="outline" className={tone}>{label(STATUS_OPTIONS, status)}</Badge>;
}

function powerSummary(equipment: Equipment) {
  if (equipment.installedPowerKw !== null) return `${equipment.installedPowerKw} kW`;
  if (equipment.ratedPowerValue !== null) return `${equipment.ratedPowerValue} ${equipment.ratedPowerUnit ?? ""}`.trim();
  return "—";
}

function InfoLine({ labelText, value }: { labelText: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{labelText}</div>
      <div className="text-sm font-medium">{value || "—"}</div>
    </div>
  );
}

function SummaryCell({ labelText, value }: { labelText: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{labelText}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function RelationDetailTables({ detail, meterName, sourceName }: {
  detail: EquipmentDetailResponse;
  meterName: Map<number, string>;
  sourceName: Map<number, string>;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h4 className="mb-2 text-sm font-semibold">Sayaç ilişkileri</h4>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-2 py-2">Sayaç</th>
                <th className="px-2 py-2">Role</th>
                <th className="px-2 py-2">Primary</th>
                <th className="px-2 py-2">Pay</th>
                <th className="px-2 py-2">Confidence</th>
                <th className="px-2 py-2">Enerji / Lokasyon</th>
                <th className="px-2 py-2">Durum</th>
              </tr>
            </thead>
            <tbody>
              {detail.meterLinks.length === 0 ? (
                <tr><td className="px-2 py-3 text-muted-foreground" colSpan={7}>Sayaç ilişkisi yok.</td></tr>
              ) : detail.meterLinks.map((link) => (
                <tr key={link.id} className="border-t">
                  <td className="px-2 py-2">{link.meterName ?? meterName.get(link.meterId) ?? link.meterId}</td>
                  <td className="px-2 py-2">{label(METER_RELATION_ROLE_OPTIONS, link.relationRole)}</td>
                  <td className="px-2 py-2">{link.isPrimary ? "Evet" : "Hayır"}</td>
                  <td className="px-2 py-2">{link.sharePercent ?? "—"}</td>
                  <td className="px-2 py-2">{label(CONFIDENCE_OPTIONS, link.measurementConfidence)}</td>
                  <td className="px-2 py-2">{link.meterEnergySourceName ?? "—"} / {link.subUnitName ?? link.unitName ?? "—"}</td>
                  <td className="px-2 py-2">{link.isActive === false ? <Badge variant="outline">Pasif</Badge> : "Aktif"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <h4 className="mb-2 text-sm font-semibold">Enerji kaynağı ilişkileri</h4>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[600px] text-xs">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-2 py-2">Kaynak</th>
                <th className="px-2 py-2">Enerji türü</th>
                <th className="px-2 py-2">Role</th>
                <th className="px-2 py-2">Primary</th>
                <th className="px-2 py-2">Pay</th>
                <th className="px-2 py-2">Confidence</th>
                <th className="px-2 py-2">Durum</th>
              </tr>
            </thead>
            <tbody>
              {detail.energySourceLinks.length === 0 ? (
                <tr><td className="px-2 py-3 text-muted-foreground" colSpan={7}>Enerji kaynağı ilişkisi yok.</td></tr>
              ) : detail.energySourceLinks.map((link) => (
                <tr key={link.id} className="border-t">
                  <td className="px-2 py-2">{link.energySourceName ?? sourceName.get(link.energySourceId) ?? link.energySourceId}</td>
                  <td className="px-2 py-2">{link.energySourceType ?? "—"}</td>
                  <td className="px-2 py-2">{label(SOURCE_RELATION_ROLE_OPTIONS, link.relationRole)}</td>
                  <td className="px-2 py-2">{link.isPrimary ? "Evet" : "Hayır"}</td>
                  <td className="px-2 py-2">{link.sharePercent ?? "—"}</td>
                  <td className="px-2 py-2">{label(CONFIDENCE_OPTIONS, link.measurementConfidence)}</td>
                  <td className="px-2 py-2">{link.isActive === false ? <Badge variant="outline">Pasif</Badge> : "Aktif"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CustomFieldDetail({ customFields }: { customFields: EquipmentCustomField[] }) {
  if (customFields.length === 0) return null;
  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold">Firma özel alanları</h4>
      <div className="grid grid-cols-2 gap-3 rounded-md border p-3">
        {customFields.map((field) => (
          <InfoLine
            key={field.code}
            labelText={field.label}
            value={<span className="inline-flex items-center gap-2">{formatCustomValue(field.value)} {!field.isActive && <Badge variant="outline">Pasif</Badge>}</span>}
          />
        ))}
      </div>
    </div>
  );
}

function EquipmentAuditHistory({ events, loading, hasNext }: { events: AuditEventRecord[]; loading: boolean; hasNext: boolean }) {
  if (loading) return <Skeleton className="h-32 w-full" />;
  return (
    <div data-testid="equipment-audit-history">
      <h4 className="mb-2 text-sm font-semibold">Değişiklik Geçmişi</h4>
      {events.length === 0 ? (
        <div className="rounded-md border p-3 text-sm text-muted-foreground">Bu ekipman için audit kaydı bulunamadı.</div>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <div key={event.id} data-testid="equipment-audit-event" className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">{auditActionLabel(event.action)}</div>
                <div className="text-xs text-muted-foreground">{new Date(event.occurredAt).toLocaleString("tr-TR")}</div>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">Kullanıcı rolü: {event.actorRole ?? "system"}</div>
              <div className="mt-2 text-xs">{auditSummary(event)}</div>
            </div>
          ))}
          {hasNext && <div className="text-xs text-muted-foreground">Daha eski kayıtlar genel audit ekranında filtrelenebilir.</div>}
        </div>
      )}
    </div>
  );
}

function auditActionLabel(action: string) {
  const labels: Record<string, string> = {
    "equipment.created": "Oluşturuldu",
    "equipment.updated": "Güncellendi",
    "equipment.archived": "Arşivlendi",
    "equipment.reactivated": "Yeniden aktifleştirildi",
  };
  return labels[action] ?? action;
}

function auditSummary(event: AuditEventRecord) {
  const changedFields = Array.isArray(event.changes?.changedFields) ? event.changes.changedFields : [];
  const version = event.changes?.previousVersion !== undefined && event.changes?.newVersion !== undefined
    ? `Sürüm ${event.changes.previousVersion} -> ${event.changes.newVersion}. `
    : "";
  const parts: string[] = [];
  if (changedFields.length > 0) parts.push(`Değişen alanlar: ${changedFields.join(", ")}.`);
  if (event.metadata?.previousStatus || event.metadata?.newStatus) parts.push(`Durum: ${event.metadata.previousStatus ?? "-"} -> ${event.metadata.newStatus ?? "-"}.`);
  if (event.metadata?.parentChange) parts.push(`Parent: ${event.metadata.parentChange.before ?? "yok"} -> ${event.metadata.parentChange.after ?? "yok"}.`);
  if (Array.isArray(event.metadata?.customFieldCodes) && event.metadata.customFieldCodes.length > 0) parts.push(`Özel alanlar: ${event.metadata.customFieldCodes.join(", ")}.`);
  if (event.metadata?.reason) parts.push(`Neden: ${event.metadata.reason}.`);
  return `${version}${parts.join(" ") || "Özet alanı yok."}`;
}

function formatCustomValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Evet" : "Hayır";
  return String(value);
}

function EquipmentDetail({ detail, loading, unitName, subUnitName, meterName, sourceName, groupName, auditEvents, auditLoading, auditHasNext, onEdit }: {
  detail?: EquipmentDetailResponse;
  loading: boolean;
  unitName: Map<number, string>;
  subUnitName: Map<number, string>;
  meterName: Map<number, string>;
  sourceName: Map<number, string>;
  groupName: Map<number, string>;
  auditEvents: AuditEventRecord[];
  auditLoading: boolean;
  auditHasNext: boolean;
  onEdit?: () => void;
}) {
  if (loading) return <Skeleton className="h-96 w-full" />;
  if (!detail) {
    return (
      <Card className="h-fit">
        <CardContent className="py-8 text-center text-sm text-muted-foreground">Detay görmek için listeden bir ekipman seçin.</CardContent>
      </Card>
    );
  }
  const equipment = detail.equipment;
  const primaryMeter = detail.meterLinks.find((link) => link.isPrimary);
  const primarySource = detail.energySourceLinks.find((link) => link.isPrimary);
  return (
    <Card className="h-fit">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">{equipment.equipmentCode}</CardTitle>
            <div className="text-sm text-muted-foreground">{equipment.name}</div>
          </div>
          <StatusBadge status={equipment.status} />
        </div>
        {onEdit && detail.permissions.canEdit && <Button variant="outline" size="sm" onClick={onEdit} className="gap-2"><Pencil className="h-4 w-4" /> Düzenle</Button>}
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <InfoLine labelText="Kategori" value={label(CATEGORY_OPTIONS, equipment.category)} />
          <InfoLine labelText="Sürüm" value={equipment.equipmentVersion} />
          <InfoLine labelText="Yaşam durumu" value={label(STATUS_OPTIONS, equipment.status)} />
          <InfoLine labelText="Operasyon durumu" value={label(OPERATIONAL_OPTIONS, equipment.operationalStatus)} />
          <InfoLine labelText="Unit" value={unitName.get(equipment.unitId) ?? equipment.unitId} />
          <InfoLine labelText="SubUnit" value={equipment.subUnitId ? subUnitName.get(equipment.subUnitId) ?? equipment.subUnitId : "—"} />
        </div>
        {equipment.status === "archived" && <Alert><AlertTitle>Salt okunur</AlertTitle><AlertDescription>Arşivli ekipman düzenlenemez; ilişkiler ve geçmiş korunur.</AlertDescription></Alert>}
        <div className="grid grid-cols-2 gap-3 rounded-md border p-3">
          <InfoLine labelText="Parent" value={detail.parentSummary ? `${detail.parentSummary.equipmentCode} - ${detail.parentSummary.name}` : "—"} />
          <InfoLine labelText="Aktif alt ekipman" value={detail.childSummary?.activeChildCount ?? 0} />
          <InfoLine labelText="Üretim yılı" value={equipment.manufactureYear ?? "—"} />
          <InfoLine labelText="Planlanan yenileme" value={equipment.plannedReplacementYear ?? "—"} />
        </div>
        <div className="grid grid-cols-2 gap-3 rounded-md border p-3">
          <InfoLine labelText="Güç" value={powerSummary(equipment)} />
          <InfoLine labelText="Kapasite" value={equipment.capacityValue !== null ? `${equipment.capacityValue} ${equipment.capacityUnit ?? ""}` : "—"} />
          <InfoLine labelText="Operasyon" value={label(OPERATIONAL_OPTIONS, equipment.operationalStatus)} />
          <InfoLine labelText="Yük" value={equipment.averageLoadPercent !== null ? `%${equipment.averageLoadPercent}` : "—"} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <InfoLine labelText="Enerji grubu" value={equipment.energyUseGroupId ? groupName.get(equipment.energyUseGroupId) ?? equipment.energyUseGroupId : "—"} />
          <InfoLine labelText="Ölçüm" value={`${label(METHOD_OPTIONS, equipment.measurementMethod)} / ${label(CONFIDENCE_OPTIONS, equipment.measurementConfidence)}`} />
          <InfoLine labelText="Birincil kaynak" value={primarySource ? sourceName.get(primarySource.energySourceId) ?? primarySource.energySourceId : "—"} />
          <InfoLine labelText="Diğer kaynak" value={Math.max(0, detail.energySourceLinks.length - (primarySource ? 1 : 0))} />
          <InfoLine labelText="Birincil sayaç" value={primaryMeter ? meterName.get(primaryMeter.meterId) ?? primaryMeter.meterId : "—"} />
          <InfoLine labelText="Diğer sayaç" value={Math.max(0, detail.meterLinks.length - (primaryMeter ? 1 : 0))} />
        </div>
        <RelationDetailTables detail={detail} meterName={meterName} sourceName={sourceName} />
        <CustomFieldDetail customFields={detail.customFields ?? []} />
        <div className="grid grid-cols-2 gap-3">
          <InfoLine labelText="Satın alma" value={equipment.purchaseDate ?? "—"} />
          <InfoLine labelText="Devreye alma" value={equipment.commissioningDate ?? "—"} />
          <InfoLine labelText="Beklenen ömür" value={equipment.expectedLifeYears !== null ? `${equipment.expectedLifeYears} yıl` : "—"} />
          <InfoLine labelText="Arşiv tarihi" value={equipment.archivedAt ? new Date(equipment.archivedAt).toLocaleString("tr-TR") : "—"} />
          <InfoLine labelText="Kritik" value={equipment.isCritical ? <span className="inline-flex items-center gap-1 text-amber-400"><CheckCircle2 className="h-3.5 w-3.5" /> Evet</span> : "Hayır"} />
          <InfoLine labelText="Enerji yoğun" value={equipment.isEnergyIntensive ? "Evet" : "Hayır"} />
        </div>
        <EquipmentAuditHistory events={auditEvents} loading={auditLoading} hasNext={auditHasNext} />
        <div className="space-y-2 text-sm">
          <InfoLine labelText="Teknik notlar" value={equipment.technicalNotes ?? "—"} />
          <InfoLine labelText="Bakım notları" value={equipment.maintenanceNotes ?? "—"} />
        </div>
      </CardContent>
    </Card>
  );
}
