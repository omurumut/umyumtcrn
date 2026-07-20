import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  Tooltip as UITooltip, TooltipContent as UITooltipContent,
  TooltipProvider as UITooltipProvider, TooltipTrigger as UITooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertCircle, AlertTriangle, CheckCircle2, Clock, TrendingUp, BarChart2,
  Zap, Target, Activity, Info, ExternalLink, ListChecks, Plus, History, Lock, FileEdit,
  RotateCcw, Trash2,
} from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { useUnit } from "@/context/UnitContext";
import { useYear } from "@/context/YearContext";
import { useToast } from "@/hooks/use-toast";
import { useListUnits, getListUnitsQueryKey } from "@workspace/api-client-react";

const API_BASE = "/api";
const DUPLICATE_REVIEW_RECORD_ERROR = "Bu dönem ve kapsam için zaten bir enerji gözden geçirme kaydı var.";
const DUPLICATE_REVIEW_RECORD_HELP =
  "Bu yıl, dönem ve kapsam için zaten bir gözden geçirme kaydı oluşturulmuş. Mevcut kaydı düzenleyebilir, tamamlanmışsa admin olarak taslağa geri alabilir veya revizyon oluşturabilirsiniz.";
const ENERGY_REVIEW_TAB_VALUES = ["overview", "sources", "enpi", "units", "actions", "records"] as const;
type EnergyReviewTab = typeof ENERGY_REVIEW_TAB_VALUES[number];

function parseEnergyReviewTab(value: string | null): EnergyReviewTab {
  return ENERGY_REVIEW_TAB_VALUES.includes(value as EnergyReviewTab) ? (value as EnergyReviewTab) : "overview";
}

function parseDeepLinkInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function apiFetch<T>(url: string, token: string | null): Promise<T> {
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let msg = "API hatası";
    try {
      const body = await res.json();
      msg = body?.error ?? body?.message ?? msg;
    } catch { /* ignore */ }
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return res.json();
}

async function apiMutate<T>(token: string | null, method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    let msg = "API hatası";
    try {
      const errBody = await res.json();
      msg = errBody?.error ?? errBody?.message ?? msg;
    } catch { /* ignore */ }
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return res.status === 204 ? (null as T) : res.json();
}

function getReviewRecordMutationErrorMessage(err: Error & { status?: number }) {
  if (err.status === 409 && err.message === DUPLICATE_REVIEW_RECORD_ERROR) {
    return DUPLICATE_REVIEW_RECORD_HELP;
  }
  return err.message;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface OverviewData {
  year: number;
  totalTep: number;
  totalCo2Ton: number;
  seuCount: number;
  activeEnpiCount: number;
  monitoredSeuCount: number;
  unmonitoredSeuCount: number;
  targetsCount: number;
  openActionsCount: number;
  overdueActionsCount: number;
  activeVapCount: number;
  technicalProfileContext: TechnicalProfileReportContext;
}

interface TechnicalProfileReportField {
  code: string;
  label: string;
  displayValue: string;
  unitLabel: string | null;
}

interface TechnicalProfileReportContext {
  status: "resolved" | "no_published_snapshot" | "no_snapshot_for_date" | "not_applicable";
  effectiveDate: string;
  unitId: number | null;
  unitName: string | null;
  snapshotId: number | null;
  snapshotNumber: number | null;
  profileVersion: number | null;
  validFrom: string | null;
  validTo: string | null;
  publishedAt: string | null;
  completionPercentage: number | null;
  warning: string | null;
  standardSummary: TechnicalProfileReportField[];
  customSummary: TechnicalProfileReportField[];
}

interface SourceBreakdownItem {
  energySourceId: number;
  energySourceName: string;
  unitOfMeasure: string;
  rawConsumption: number;
  tep: number;
  co2Ton: number;
  tepSharePercent: number;
}

interface SourceComparisonItem {
  energySourceId: number;
  energySourceName: string;
  unitOfMeasure: string;
  selectedYearRawConsumption: number;
  previousYearRawConsumption: number;
  rawConsumptionChangePercent: number | null;
  selectedYearTep: number;
  previousYearTep: number;
  tepChangePercent: number | null;
  selectedYearCo2Ton: number;
  previousYearCo2Ton: number;
  co2ChangePercent: number | null;
}

interface EnpiSummaryItem {
  seuItemId: number;
  seuName: string;
  unitId: number | null;
  unitName: string | null;
  energyUseGroupName: string | null;
  energySourceName: string | null;
  baselineId: number | null;
  baselineStatus: string | null;
  baselinePeriod: string | null;
  regressionFormula: string | null;
  r2Score: number | null;
  adjustedR2Score: number | null;
  resultCount: number;
  lastResultYear: number | null;
  lastResultMonth: number | null;
  lastResultPeriod: string | null;
  // Yıllık özet alanları
  annualResultCount: number;
  annualActualConsumption: number | null;
  annualExpectedConsumption: number | null;
  annualVariance: number | null;
  annualVariancePercent: number | null;
  annualEei: number | null;
  annualValidEeiCount: number;
  periodEndCusum: number | null;
  latestSet: number | null;
  // Geriye dönük uyumluluk
  latestEei: number | null;
  cumulativeCusum: number | null;
  latestExpectedConsumption: number | null;
  latestActualConsumption: number | null;
  latestVariance: number | null;
  latestVariancePercent: number | null;
  existingStatus: string | null;
  monitoringState: "not_monitored" | "baseline_without_results" | "monitored" | "missing_relation";
  dataRelationState: "complete" | "missing_unit" | "missing_energy_source" | "missing_energy_use_group" | "missing_baseline_link" | "missing_result_link";
}

interface TargetActionVap {
  id: number;
  projectCode: string | null;
  projectTitle: string;
  projectType: string | null;
  annualEnergySavingValue: number | null;
  annualEnergySavingUnit: string | null;
  annualCostSaving: number | null;
  investmentCost: number | null;
  paybackMonths: number | null;
  co2ReductionTon: number | null;
  incentiveStatus: string | null;
}

interface TargetActionItem {
  id: number;
  title: string;
  description: string | null;
  responsibleName: string | null;
  priority: string | null;
  status: string | null;
  startDate: string | null;
  dueDate: string | null;
  completionDate: string | null;
  progressPercent: number | null;
  expectedSavingValue: number | null;
  expectedSavingUnit: string | null;
  expectedCostSaving: number | null;
  investmentCost: number | null;
  paybackMonths: number | null;
  isVap: boolean;
  overdue: boolean;
  notes: string | null;
  vap: TargetActionVap | null;
}

interface TargetsActionsSummaryItem {
  id: number;
  name: string;
  unitId: number | null;
  unitName: string | null;
  subUnitId: number | null;
  subUnitName: string | null;
  energySourceId: number | null;
  energySourceName: string | null;
  objectiveText: string | null;
  targetText: string | null;
  targetType: string | null;
  baselineYear: number;
  baselineValue: number | null;
  targetYear: number;
  targetValue: number | null;
  actualValue: number | null;
  unitLabel: string | null;
  targetReductionPercent: number;
  status: string | null;
  notes: string | null;
  baselineKwh: number | null;
  yearlyProgress: { year: number; actualKwh: number | null; reductionPercent: number | null }[];
  currentReductionPercent: number | null;
  achievementStatus: "achieved" | "on_track" | "at_risk" | "no_data";
  relationState: "complete" | "company_wide" | "missing_consumption_data" | "no_actions";
  relatedSeu: {
    seuAssessmentId: number;
    seuAssessmentYear: number | null;
    itemCount: number;
    monitoredCount: number;
    baselineWithoutResultsCount: number;
    notMonitoredCount: number;
  } | null;
  actions: TargetActionItem[];
  actionsCount: number;
  openActionsCount: number;
  overdueActionsCount: number;
  completedActionsCount: number;
  vapCount: number;
}

interface UnitComparisonItem {
  unitId: number;
  unitName: string;
  totalTep: number;
  totalCo2Ton: number;
  seuCount: number;
  activeEnpiCount: number;
  monitoredSeuCount: number;
  unmonitoredSeuCount: number;
  openActionsCount: number;
  overdueActionsCount: number;
}

// ── Dönemsel Gözden Geçirme Kaydı ────────────────────────────────────────────
type ReviewPeriodType = "annual" | "semi_annual" | "custom";
type ReviewScopeType = "company" | "unit";
type ReviewStatus = "draft" | "completed" | "revised";

interface EnergyReviewRecordItem {
  id: number;
  companyId: number;
  unitId: number | null;
  unitName: string | null;
  reviewName: string;
  reviewYear: number;
  periodType: ReviewPeriodType;
  periodStart: string;
  periodEnd: string;
  scopeType: ReviewScopeType;
  status: ReviewStatus;
  preparedByUserId: number;
  preparedByName: string | null;
  completedByUserId: number | null;
  completedAt: string | null;
  revisionNo: number;
  previousRevisionId: number | null;
  generalNotes: string | null;
  deletedAt: string | null;
  deletedByUserId: number | null;
  deleteReason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ReviewRecordForm {
  reviewName: string;
  reviewYear: string;
  periodType: ReviewPeriodType;
  periodStart: string;
  periodEnd: string;
  scopeType: ReviewScopeType;
  unitId: string;
  generalNotes: string;
}

const REVIEW_PERIOD_LABELS: Record<string, string> = {
  annual: "Yıllık",
  semi_annual: "Altı Aylık",
  custom: "Özel",
};

const REVIEW_STATUS_LABELS: Record<string, string> = {
  draft: "Taslak",
  completed: "Tamamlandı",
  revised: "Revize Edildi",
};

function emptyReviewForm(currentYear: number, defaultUnitId: number | null): ReviewRecordForm {
  return {
    reviewName: "",
    reviewYear: String(currentYear),
    periodType: "annual",
    periodStart: `${currentYear}-01-01`,
    periodEnd: `${currentYear}-12-31`,
    scopeType: defaultUnitId !== null ? "unit" : "company",
    unitId: defaultUnitId !== null ? String(defaultUnitId) : "",
    generalNotes: "",
  };
}

// ── Renk paleti ──────────────────────────────────────────────────────────────
const PIE_COLORS = ["#14b8a6", "#6366f1", "#f59e0b", "#ef4444", "#8b5cf6", "#10b981", "#f97316", "#06b6d4"];

// ── Küçük yardımcı bileşenler ────────────────────────────────────────────────
function KpiCard({
  title,
  value,
  unit,
  icon: Icon,
  accent = "teal",
  tooltip,
}: {
  title: string;
  value: string | number;
  unit?: string;
  icon?: React.ElementType;
  accent?: "teal" | "amber" | "red" | "indigo" | "muted";
  tooltip?: string;
}) {
  const accentMap: Record<string, string> = {
    teal: "text-teal-400 bg-teal-600/10",
    amber: "text-amber-400 bg-amber-600/10",
    red: "text-red-400 bg-red-600/10",
    indigo: "text-indigo-400 bg-indigo-600/10",
    muted: "text-muted-foreground bg-muted/30",
  };
  const cls = accentMap[accent] ?? accentMap.teal;
  return (
    <Card className="bg-card border-border">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground mb-1 truncate">{title}</p>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold">{value}</span>
              {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
            </div>
          </div>
          {Icon && (
            <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${cls}`}>
              <Icon className="h-4 w-4" />
            </div>
          )}
        </div>
        {tooltip && (
          <p className="text-[10px] text-muted-foreground/70 mt-2 leading-tight">{tooltip}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Hedefler & Aksiyonlar sekmesi: etiket tabloları ve rozet bileşenleri ─────
const TA_ACTION_STATUS_LABELS: Record<string, string> = {
  planned: "Planlandı",
  in_progress: "Devam Ediyor",
  completed: "Tamamlandı",
  delayed: "Gecikti",
  cancelled: "İptal",
};

const TA_PRIORITY_LABELS: Record<string, string> = {
  low: "Düşük",
  medium: "Orta",
  high: "Yüksek",
};

const TA_TARGET_STATUS_LABELS: Record<string, string> = {
  draft: "Taslak",
  active: "Devam Ediyor",
  completed: "Tamamlandı",
  cancelled: "İptal",
};

function fmtNum(n: number | null | undefined, dec = 1) {
  if (n == null) return "—";
  return n.toLocaleString("tr-TR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function AchievementBadge({ state }: { state: TargetsActionsSummaryItem["achievementStatus"] }) {
  if (state === "achieved")
    return <Badge className="bg-green-500/20 text-green-400 border-0 text-[10px]">Hedefe Ulaşıldı</Badge>;
  if (state === "on_track")
    return <Badge className="bg-blue-500/20 text-blue-400 border-0 text-[10px]">İlerliyor</Badge>;
  if (state === "at_risk")
    return <Badge className="bg-red-500/20 text-red-400 border-0 text-[10px]">Risk Altında</Badge>;
  return <Badge className="bg-muted/30 text-muted-foreground border-0 text-[10px]">Veri Yok</Badge>;
}

function RelationBadge({ state }: { state: TargetsActionsSummaryItem["relationState"] }) {
  if (state === "complete")
    return <Badge className="bg-teal-600/20 text-teal-400 border-teal-600/30 text-[10px]">Aksiyon bağlantısı var</Badge>;
  if (state === "company_wide")
    return <Badge className="bg-indigo-500/20 text-indigo-400 border-0 text-[10px]">Kuruluş geneli hedef</Badge>;
  if (state === "missing_consumption_data")
    return <Badge className="bg-amber-600/20 text-amber-400 border-amber-600/30 text-[10px]">İzleme verisi yok</Badge>;
  return <Badge className="bg-amber-600/20 text-amber-400 border-amber-600/30 text-[10px]">Aksiyon tanımlı değil</Badge>;
}

function TargetActionStatusBadge({ status }: { status: string | null }) {
  const colorMap: Record<string, string> = {
    planned: "bg-muted/30 text-muted-foreground",
    in_progress: "bg-blue-500/20 text-blue-400",
    completed: "bg-green-500/20 text-green-400",
    delayed: "bg-orange-500/20 text-orange-400",
    cancelled: "bg-red-500/20 text-red-400",
  };
  const cls = (status && colorMap[status]) ?? "bg-muted/30 text-muted-foreground";
  return <Badge className={`${cls} border-0 text-[10px]`}>{(status && TA_ACTION_STATUS_LABELS[status]) ?? status ?? "—"}</Badge>;
}

function MonitoringBadge({ state }: { state: EnpiSummaryItem["monitoringState"] }) {
  if (state === "monitored")
    return <Badge className="bg-teal-600/20 text-teal-400 border-teal-600/30 text-[10px]">İzleniyor</Badge>;
  if (state === "baseline_without_results")
    return <Badge className="bg-amber-600/20 text-amber-400 border-amber-600/30 text-[10px]">EnRÇ Var / Sonuç Yok</Badge>;
  if (state === "missing_relation")
    return <Badge className="bg-red-600/20 text-red-400 border-red-600/30 text-[10px]">Veri İlişkisi Eksik</Badge>;
  return <Badge className="bg-muted/30 text-muted-foreground border-border text-[10px]">İzlenmiyor</Badge>;
}

// Değişim yüzdesini nötr biçimde gösterir: artış/azalış/değişim yok / karşılaştırılamıyor.
// Pozitif/negatif değişim renklendirmesi yapılmaz (üretim/hava/faaliyet farklılıklarından kaynaklayabilir).
function ChangeCell({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span className="text-muted-foreground text-[10px]">Karşılaştırılamıyor</span>;
  }
  if (pct === 0) {
    return <span className="text-muted-foreground tabular-nums">—</span>;
  }
  const sign = pct > 0 ? "▲" : "▼";
  const abs = Math.abs(pct);
  return (
    <span className="text-foreground tabular-nums">
      {sign} {pct > 0 ? "+" : ""}{abs.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%
    </span>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
      <Info className="h-8 w-8 opacity-40" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

function LoadingRows({ cols }: { cols: number }) {
  return (
    <>
      {[1, 2, 3].map((i) => (
        <TableRow key={i}>
          {Array.from({ length: cols }).map((_, j) => (
            <TableCell key={j}>
              <div className="h-4 rounded bg-muted/30 animate-pulse w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

// ── Ana bileşen ──────────────────────────────────────────────────────────────

export default function EnergyReview() {
  const { user, token } = useAuth();
  const { companyId } = useCompany();
  const { unitId: ctxUnitId } = useUnit();
  const { year, setYear } = useYear();
  const [deepLinkParams] = useState(() => new URLSearchParams(window.location.search));
  const deepLinkYear = parseDeepLinkInt(deepLinkParams.get("year"));
  const deepLinkUnitId = parseDeepLinkInt(deepLinkParams.get("unitId"));
  const deepLinkReviewRecordId = deepLinkParams.get("reviewRecordId")?.trim() || null;
  const reviewRecordRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  const isCompanyAdmin = user?.role === "admin" || user?.role === "kontrol_admin";
  const isSuperAdmin = user?.role === "superadmin";
  const isAdmin = isCompanyAdmin || isSuperAdmin;

  // Admin kullanıcı için lokal birim filtresi (context'ten bağımsız seçim)
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<EnergyReviewTab>(() => parseEnergyReviewTab(deepLinkParams.get("tab")));
  const [deepLinkApplied, setDeepLinkApplied] = useState(false);

  // ÖEK & EnPG sekmesi filtreleri
  const [enpiFilterState, setEnpiFilterState] = useState("all");
  const [enpiFilterUnit, setEnpiFilterUnit] = useState("all");
  const [enpiFilterSource, setEnpiFilterSource] = useState("all");
  const [enpiFilterOnlyMissing, setEnpiFilterOnlyMissing] = useState(false);

  // Hedefler & Aksiyonlar sekmesi filtreleri
  const [taFilterStatus, setTaFilterStatus] = useState("all");
  const [taFilterAchievement, setTaFilterAchievement] = useState("all");
  const [taFilterOnlyOverdue, setTaFilterOnlyOverdue] = useState(false);
  const [expandedTargetId, setExpandedTargetId] = useState<number | null>(null);

  const { data: units } = useListUnits(
    {} as any,
    { query: { queryKey: getListUnitsQueryKey() } },
  );

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Dönemsel Gözden Geçirme Kaydı sekmesi
  const [reviewFormOpen, setReviewFormOpen] = useState(false);
  const [reviewEditingId, setReviewEditingId] = useState<number | null>(null);
  const [reviewForm, setReviewForm] = useState<ReviewRecordForm>(() => emptyReviewForm(year, user?.unitId ?? null));
  const [reviewDetailId, setReviewDetailId] = useState<number | null>(null);
  const [reviewDeleteId, setReviewDeleteId] = useState<number | null>(null);
  const [reviewDeleteReason, setReviewDeleteReason] = useState("");

  // Efektif birim: admin → local state; standart kullanıcı → context
  const effectiveUnitId: number | null = isAdmin ? selectedUnitId : (user?.unitId ?? null);
  const energyReviewQueriesEnabled = !isSuperAdmin || companyId !== null;

  useEffect(() => {
    if (deepLinkApplied || !user) return;

    setActiveTab(parseEnergyReviewTab(deepLinkParams.get("tab")));

    if (deepLinkYear !== null) {
      setYear(deepLinkYear);
    }

    if (isCompanyAdmin && deepLinkUnitId !== null) {
      setSelectedUnitId(deepLinkUnitId);
    }

    setDeepLinkApplied(true);
  }, [deepLinkApplied, deepLinkParams, deepLinkUnitId, deepLinkYear, isCompanyAdmin, setYear, user]);

  function buildParams(extra?: Record<string, string | number | undefined>) {
    const p = new URLSearchParams();
    p.set("year", String(year));
    if (isSuperAdmin && companyId !== null) p.set("companyId", String(companyId));
    if (isAdmin && effectiveUnitId !== null) p.set("unitId", String(effectiveUnitId));
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        if (v !== undefined) p.set(k, String(v));
      }
    }
    return p.toString();
  }

  const overviewQ = useQuery<OverviewData>({
    queryKey: ["energy-review-overview", year, effectiveUnitId, companyId],
    queryFn: () => apiFetch(`${API_BASE}/energy-review/overview?${buildParams()}`, token),
    enabled: energyReviewQueriesEnabled,
  });

  const sourceQ = useQuery<SourceBreakdownItem[]>({
    queryKey: ["energy-review-source", year, effectiveUnitId, companyId],
    queryFn: () => apiFetch(`${API_BASE}/energy-review/source-breakdown?${buildParams()}`, token),
    enabled: energyReviewQueriesEnabled,
  });

  const enpiQ = useQuery<EnpiSummaryItem[]>({
    queryKey: ["energy-review-enpi", year, effectiveUnitId, companyId],
    queryFn: () => apiFetch(`${API_BASE}/energy-review/enpi-summary?${buildParams()}`, token),
    enabled: energyReviewQueriesEnabled,
  });

  const sourceCompQ = useQuery<SourceComparisonItem[]>({
    queryKey: ["energy-review-source-comparison", year, effectiveUnitId, companyId],
    queryFn: () => apiFetch(`${API_BASE}/energy-review/source-comparison?${buildParams()}`, token),
    enabled: energyReviewQueriesEnabled,
  });

  const unitCompQ = useQuery<UnitComparisonItem[]>({
    queryKey: ["energy-review-units", year, companyId],
    queryFn: () => apiFetch(`${API_BASE}/energy-review/unit-comparison?${buildParams()}`, token),
    enabled: isAdmin && energyReviewQueriesEnabled,
  });

  const taSummaryQ = useQuery<TargetsActionsSummaryItem[]>({
    queryKey: ["energy-review-targets-actions", year, effectiveUnitId, companyId],
    queryFn: () => apiFetch(`${API_BASE}/energy-review/targets-actions-summary?${buildParams()}`, token),
    enabled: energyReviewQueriesEnabled,
  });

  const reviewRecordsQ = useQuery<EnergyReviewRecordItem[]>({
    queryKey: ["energy-review-records", effectiveUnitId, deepLinkYear !== null ? year : "all", companyId],
    queryFn: () => {
      const p = new URLSearchParams();
      if (isSuperAdmin && companyId !== null) p.set("companyId", String(companyId));
      if (isAdmin && effectiveUnitId !== null) p.set("unitId", String(effectiveUnitId));
      if (deepLinkYear !== null) p.set("year", String(year));
      return apiFetch(`${API_BASE}/energy-review-records?${p.toString()}`, token);
    },
    enabled: energyReviewQueriesEnabled,
  });

  const createReviewMut = useMutation({
    mutationFn: (d: ReviewRecordForm) => apiMutate<EnergyReviewRecordItem>(token, "POST", `${API_BASE}/energy-review-records`, {
      reviewName: d.reviewName,
      reviewYear: parseInt(d.reviewYear),
      periodType: d.periodType,
      periodStart: d.periodStart,
      periodEnd: d.periodEnd,
      scopeType: d.scopeType,
      unitId: d.scopeType === "unit" ? (d.unitId ? parseInt(d.unitId) : undefined) : undefined,
      generalNotes: d.generalNotes || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["energy-review-records"] });
      toast({ title: "Gözden geçirme kaydı oluşturuldu" });
      setReviewFormOpen(false);
    },
    onError: (err: Error & { status?: number }) => toast({
      title: "Hata",
      description: getReviewRecordMutationErrorMessage(err),
      variant: "destructive",
    }),
  });

  const updateReviewMut = useMutation({
    mutationFn: ({ id, d }: { id: number; d: ReviewRecordForm }) => apiMutate<EnergyReviewRecordItem>(token, "PATCH", `${API_BASE}/energy-review-records/${id}`, {
      reviewName: d.reviewName,
      reviewYear: parseInt(d.reviewYear),
      periodType: d.periodType,
      periodStart: d.periodStart,
      periodEnd: d.periodEnd,
      scopeType: d.scopeType,
      unitId: d.scopeType === "unit" ? (d.unitId ? parseInt(d.unitId) : undefined) : undefined,
      generalNotes: d.generalNotes || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["energy-review-records"] });
      toast({ title: "Taslak güncellendi" });
      setReviewFormOpen(false);
      setReviewEditingId(null);
    },
    onError: (err: Error & { status?: number }) => toast({
      title: "Hata",
      description: getReviewRecordMutationErrorMessage(err),
      variant: "destructive",
    }),
  });

  const completeReviewMut = useMutation({
    mutationFn: (id: number) => apiMutate<EnergyReviewRecordItem>(token, "POST", `${API_BASE}/energy-review-records/${id}/complete`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["energy-review-records"] });
      toast({ title: "Kayıt tamamlandı ve kilitlendi" });
    },
    onError: (err: Error) => toast({ title: "Hata", description: err.message, variant: "destructive" }),
  });

  const reopenReviewMut = useMutation({
    mutationFn: (id: number) => apiMutate<EnergyReviewRecordItem>(token, "POST", `${API_BASE}/energy-review-records/${id}/reopen`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["energy-review-records"] });
      toast({ title: "Kayıt taslağa geri alındı" });
      setReviewDetailId(null);
    },
    onError: (err: Error & { status?: number }) => toast({
      title: "Hata",
      description: getReviewRecordMutationErrorMessage(err),
      variant: "destructive",
    }),
  });

  const reviseReviewMut = useMutation({
    mutationFn: (id: number) => apiMutate<{ revisedRecord: EnergyReviewRecordItem; newRecord: EnergyReviewRecordItem }>(token, "POST", `${API_BASE}/energy-review-records/${id}/revise`),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["energy-review-records"] });
      toast({ title: "Yeni revizyon oluşturuldu" });
      setReviewDetailId(data.newRecord.id);
    },
    onError: (err: Error) => toast({ title: "Hata", description: err.message, variant: "destructive" }),
  });

  const deleteReviewMut = useMutation({
    mutationFn: ({ id, deleteReason }: { id: number; deleteReason: string }) => apiMutate<EnergyReviewRecordItem>(
      token,
      "DELETE",
      `${API_BASE}/energy-review-records/${id}`,
      { deleteReason: deleteReason.trim() || undefined },
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["energy-review-records"] });
      toast({ title: "Kayıt kaldırıldı" });
      setReviewDeleteId(null);
      setReviewDeleteReason("");
      setReviewDetailId(null);
    },
    onError: (err: Error & { status?: number }) => toast({
      title: "Hata",
      description: getReviewRecordMutationErrorMessage(err),
      variant: "destructive",
    }),
  });

  const ov = overviewQ.data;
  const sources = sourceQ.data ?? [];
  const enpiList = enpiQ.data ?? [];
  const unitList = unitCompQ.data ?? [];
  const taList = taSummaryQ.data ?? [];
  const reviewRecords = reviewRecordsQ.data ?? [];
  const reviewDetailRecord = reviewRecords.find((r) => r.id === reviewDetailId) ?? null;

  useEffect(() => {
    if (!deepLinkReviewRecordId || activeTab !== "records" || reviewRecordsQ.isLoading) return;

    const node = reviewRecordRefs.current[deepLinkReviewRecordId];
    if (!node) return;

    const scrollTimer = window.setTimeout(() => {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);

    return () => window.clearTimeout(scrollTimer);
  }, [activeTab, deepLinkReviewRecordId, reviewRecords.length, reviewRecordsQ.isLoading]);

  function openCreateReview() {
    setReviewEditingId(null);
    setReviewForm(emptyReviewForm(year, isAdmin ? null : (user?.unitId ?? null)));
    setReviewFormOpen(true);
  }

  function openEditReview(rec: EnergyReviewRecordItem) {
    setReviewEditingId(rec.id);
    setReviewForm({
      reviewName: rec.reviewName,
      reviewYear: String(rec.reviewYear),
      periodType: rec.periodType,
      periodStart: rec.periodStart,
      periodEnd: rec.periodEnd,
      scopeType: rec.scopeType,
      unitId: rec.unitId !== null ? String(rec.unitId) : "",
      generalNotes: rec.generalNotes ?? "",
    });
    setReviewFormOpen(true);
  }

  function submitReviewForm() {
    if (!reviewForm.reviewName.trim()) {
      toast({ title: "Gözden geçirme adı zorunludur", variant: "destructive" });
      return;
    }
    if (reviewForm.scopeType === "unit" && !reviewForm.unitId) {
      toast({ title: "Birim kapsamlı kayıt için birim seçilmelidir", variant: "destructive" });
      return;
    }
    if (reviewEditingId !== null) {
      updateReviewMut.mutate({ id: reviewEditingId, d: reviewForm });
    } else {
      createReviewMut.mutate(reviewForm);
    }
  }

  const filteredTaList = taList.filter((t) => {
    if (taFilterStatus !== "all" && t.status !== taFilterStatus) return false;
    if (taFilterAchievement !== "all" && t.achievementStatus !== taFilterAchievement) return false;
    if (taFilterOnlyOverdue && t.overdueActionsCount === 0) return false;
    return true;
  });

  const taKpis = {
    total: taList.length,
    achieved: taList.filter((t) => t.achievementStatus === "achieved").length,
    onTrack: taList.filter((t) => t.achievementStatus === "on_track").length,
    atRisk: taList.filter((t) => t.achievementStatus === "at_risk").length,
    noData: taList.filter((t) => t.achievementStatus === "no_data").length,
    openActions: taList.reduce((s, t) => s + t.openActionsCount, 0),
    overdueActions: taList.reduce((s, t) => s + t.overdueActionsCount, 0),
    vapCount: taList.reduce((s, t) => s + t.vapCount, 0),
  };

  // ÖEK filtreli liste
  const filteredEnpiList = enpiList.filter((item) => {
    if (enpiFilterState !== "all" && item.monitoringState !== enpiFilterState) return false;
    if (isAdmin && enpiFilterUnit !== "all" && String(item.unitId) !== enpiFilterUnit) return false;
    if (enpiFilterSource !== "all" && item.energySourceName !== enpiFilterSource) return false;
    if (enpiFilterOnlyMissing && item.monitoringState !== "missing_relation") return false;
    return true;
  });

  const unitName: string = isAdmin
    ? (effectiveUnitId !== null ? (units as any[])?.find((u: any) => u.id === effectiveUnitId)?.name ?? "" : "Tüm Birimler")
    : ((units as any[])?.find((u: any) => u.id === (user?.unitId ?? null))?.name ?? "");

  return (
    <div className="p-6 space-y-6">
      {/* ── Başlık ── */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4 justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart2 className="h-6 w-6 text-teal-400" />
            Enerji Gözden Geçirme
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            ISO 50001:2018 Madde 6.3 — Enerji kullanımları, ÖEK'ler, EnPG'ler, EnRÇ sonuçları, hedefler ve aksiyonların bütüncül değerlendirmesi
          </p>
        </div>

        {/* Birim filtresi (sadece admin) */}
        {isAdmin && (
          <div className="flex items-center gap-2 shrink-0">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">Birim</Label>
            <Select
              value={selectedUnitId !== null ? String(selectedUnitId) : "all"}
              onValueChange={(v) => setSelectedUnitId(v === "all" ? null : parseInt(v))}
            >
              <SelectTrigger className="w-52 h-8 text-xs">
                <SelectValue placeholder="Tüm Birimler" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tüm Birimler</SelectItem>
                {(units as any[] | undefined)?.map((u: any) => (
                  <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Standart kullanıcı: sabit birim kapsam etiketi */}
        {!isAdmin && unitName && (
          <Badge variant="outline" className="text-xs border-teal-600/30 text-teal-400 bg-teal-600/10 shrink-0">
            Birim: {unitName}
          </Badge>
        )}
      </div>

      {/* ── Sekmeler ── */}
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as EnergyReviewTab)}>
        <TabsList className="bg-muted/30">
          <TabsTrigger value="overview">Genel Performans</TabsTrigger>
          <TabsTrigger value="sources">Enerji Kaynakları</TabsTrigger>
          <TabsTrigger value="enpi">ÖEK & EnPG Performansı</TabsTrigger>
          {isAdmin && <TabsTrigger value="units">Birim Karşılaştırma</TabsTrigger>}
          <TabsTrigger value="actions">Hedefler & Aksiyonlar</TabsTrigger>
          <TabsTrigger value="records">Dönemsel Gözden Geçirme Kaydı</TabsTrigger>
        </TabsList>

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* Tab 1: Genel Performans                                        */}
        {/* ══════════════════════════════════════════════════════════════ */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          {overviewQ.isError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Veriler yüklenemedi: {(overviewQ.error as Error)?.message}
            </div>
          )}

          {!energyReviewQueriesEnabled && (
            <div className="rounded-lg border border-amber-600/30 bg-amber-600/10 p-4 text-sm text-amber-300 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Energy Review icin sirket baglami secilmelidir.
            </div>
          )}

          <TechnicalProfileContextCard
            context={ov?.technicalProfileContext}
            isLoading={overviewQ.isLoading}
          />

          {/* KPI grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard
              title="Toplam TEP"
              value={overviewQ.isLoading ? "—" : ov ? ov.totalTep.toLocaleString("tr-TR", { maximumFractionDigits: 1 }) : "0"}
              unit="TEP"
              icon={Activity}
              accent="teal"
              tooltip="Ton Eşdeğer Petrol (TEP) — tüm enerji kaynaklarının ortak birimi"
            />
            <KpiCard
              title="Toplam CO₂"
              value={overviewQ.isLoading ? "—" : ov ? ov.totalCo2Ton.toLocaleString("tr-TR", { maximumFractionDigits: 1 }) : "0"}
              unit="ton CO₂"
              icon={TrendingUp}
              accent="indigo"
            />
            <KpiCard
              title="ÖEK Sayısı"
              value={overviewQ.isLoading ? "—" : ov?.seuCount ?? 0}
              icon={AlertTriangle}
              accent="amber"
              tooltip="Kabul edilmiş Önemli Enerji Kullanımı sayısı"
            />
            <KpiCard
              title="Aktif EnPG / EnRÇ Modeli"
              value={overviewQ.isLoading ? "—" : ov?.activeEnpiCount ?? 0}
              icon={TrendingUp}
              accent="teal"
              tooltip="Aktif Enerji Performans Göstergesi / Enerji Referans Çizgisi Modeli sayısı"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard
              title="İzlenen ÖEK"
              value={overviewQ.isLoading ? "—" : ov?.monitoredSeuCount ?? 0}
              icon={CheckCircle2}
              accent="teal"
              tooltip={`${year} yılı için EnPG sonucu bulunan ÖEK`}
            />
            <KpiCard
              title="İzlenmeyen ÖEK"
              value={overviewQ.isLoading ? "—" : ov?.unmonitoredSeuCount ?? 0}
              icon={AlertCircle}
              accent={(ov?.unmonitoredSeuCount ?? 0) > 0 ? "amber" : "muted"}
              tooltip="Henüz EnPG sonucu bulunmayan ÖEK"
            />
            <KpiCard
              title="Açık Aksiyon"
              value={overviewQ.isLoading ? "—" : ov?.openActionsCount ?? 0}
              icon={Clock}
              accent="muted"
            />
            <KpiCard
              title="Gecikmiş Aksiyon"
              value={overviewQ.isLoading ? "—" : ov?.overdueActionsCount ?? 0}
              icon={AlertCircle}
              accent={(ov?.overdueActionsCount ?? 0) > 0 ? "red" : "muted"}
            />
          </div>

          {/* Ek bilgi kartları */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card className="bg-card border-border">
              <CardContent className="pt-5 pb-4 flex items-center gap-4">
                <div className="h-10 w-10 rounded-lg flex items-center justify-center bg-teal-600/10 shrink-0">
                  <Target className="h-5 w-5 text-teal-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Aktif Hedef</p>
                  <p className="text-xl font-bold">{overviewQ.isLoading ? "—" : ov?.targetsCount ?? 0}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="pt-5 pb-4 flex items-center gap-4">
                <div className="h-10 w-10 rounded-lg flex items-center justify-center bg-indigo-600/10 shrink-0">
                  <Zap className="h-5 w-5 text-indigo-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Aktif VAP Projesi</p>
                  <p className="text-xl font-bold">{overviewQ.isLoading ? "—" : ov?.activeVapCount ?? 0}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border col-span-1">
              <CardContent className="pt-5 pb-4">
                <p className="text-xs text-muted-foreground mb-2">ÖEK İzleme Durumu</p>
                {ov && ov.seuCount > 0 ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-3 rounded-full bg-muted/30 overflow-hidden">
                      <div
                        className="h-full bg-teal-500 rounded-full transition-all"
                        style={{ width: `${Math.round((ov.monitoredSeuCount / ov.seuCount) * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium tabular-nums">
                      %{Math.round((ov.monitoredSeuCount / ov.seuCount) * 100)}
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Veri yok</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* Tab 2: Enerji Kaynakları                                       */}
        {/* ══════════════════════════════════════════════════════════════ */}
        <TabsContent value="sources" className="mt-4">
          {sourceQ.isError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Veriler yüklenemedi: {(sourceQ.error as Error)?.message}
            </div>
          )}

          {!sourceQ.isLoading && sources.length === 0 && !sourceQ.isError && (
            <EmptyState message={`${year} yılı için kaynak tüketimi bulunamadı.`} />
          )}

          {sources.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
              {/* Tablo */}
              <div className="lg:col-span-3">
                <Card className="bg-card border-border">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Kaynak Bazlı Tüketim</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border hover:bg-transparent">
                          <TableHead className="text-xs">Enerji Kaynağı</TableHead>
                          <TableHead className="text-xs text-right">Tüketim</TableHead>
                          <TableHead className="text-xs text-right">Birim</TableHead>
                          <TableHead className="text-xs text-right">TEP</TableHead>
                          <TableHead className="text-xs text-right">TEP Payı</TableHead>
                          <TableHead className="text-xs text-right">ton CO₂</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sourceQ.isLoading ? (
                          <LoadingRows cols={6} />
                        ) : (
                          sources.map((s) => (
                            <TableRow key={s.energySourceId} className="border-border">
                              <TableCell className="text-xs font-medium">{s.energySourceName}</TableCell>
                              <TableCell className="text-xs text-right tabular-nums">
                                {s.rawConsumption.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}
                              </TableCell>
                              <TableCell className="text-xs text-right text-muted-foreground">{s.unitOfMeasure}</TableCell>
                              <TableCell className="text-xs text-right tabular-nums">
                                {s.tep.toLocaleString("tr-TR", { maximumFractionDigits: 3 })}
                              </TableCell>
                              <TableCell className="text-xs text-right">
                                <Badge variant="outline" className="text-[10px] border-teal-600/30 text-teal-400">
                                  %{s.tepSharePercent.toFixed(1)}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs text-right tabular-nums">
                                {s.co2Ton.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                        {/* Toplam satırı — sadece TEP ve CO₂ toplanır */}
                        {sources.length > 1 && !sourceQ.isLoading && (
                          <TableRow className="border-border border-t-2 font-semibold">
                            <TableCell className="text-xs">Toplam</TableCell>
                            <TableCell className="text-xs text-right text-muted-foreground text-[10px]">
                              —
                            </TableCell>
                            <TableCell />
                            <TableCell className="text-xs text-right tabular-nums">
                              {sources.reduce((a, s) => a + s.tep, 0).toLocaleString("tr-TR", { maximumFractionDigits: 3 })}
                            </TableCell>
                            <TableCell className="text-xs text-right">%100</TableCell>
                            <TableCell className="text-xs text-right tabular-nums">
                              {sources.reduce((a, s) => a + s.co2Ton, 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
                <p className="text-[10px] text-muted-foreground/60 mt-2 px-1">
                  * Farklı enerji kaynakları farklı doğal birimlerle ölçülür (kWh, m³, litre, ton). Ham tüketim değerleri birbiriyle toplanmaz. Ortak ölçüm yalnızca TEP ve ton CO₂ sütunlarındadır.
                </p>
              </div>

              {/* Pie chart */}
              <div className="lg:col-span-2">
                <Card className="bg-card border-border">
                  <CardHeader className="pb-1 pt-4 px-4">
                    <CardTitle className="text-sm">TEP Payı Dağılımı</CardTitle>
                    <p className="text-[10px] text-muted-foreground leading-tight">
                      Grafik yalnızca TEP payını gösterir — farklı doğal birimler karşılaştırılmaz.
                    </p>
                  </CardHeader>
                  <CardContent className="px-2 pb-3 pt-1">
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie
                          data={sources}
                          dataKey="tep"
                          nameKey="energySourceName"
                          cx="50%"
                          cy="50%"
                          outerRadius={72}
                          labelLine={false}
                          label={({ tepSharePercent }) => tepSharePercent > 5 ? `%${tepSharePercent.toFixed(0)}` : ""}
                        >
                          {sources.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                          formatter={(value: number, name: string) => [
                            `${value.toLocaleString("tr-TR", { maximumFractionDigits: 3 })} TEP`,
                            name,
                          ]}
                        />
                        <Legend iconSize={9} iconType="circle" wrapperStyle={{ fontSize: 10 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {/* ── Yıllık Karşılaştırma Tablosu ── */}
          <div className="mt-6 space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Yıllık Enerji Kaynağı Karşılaştırması</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Seçili yıl ile bir önceki yıl aynı enerji kaynağı bazında karşılaştırılır. Farklı doğal birimler birbiriyle toplanmaz.
              </p>
            </div>

            {sourceCompQ.isError && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                Karşılaştırma verileri yüklenemedi: {(sourceCompQ.error as Error)?.message}
              </div>
            )}

            {!sourceCompQ.isLoading && !sourceCompQ.isError && (sourceCompQ.data ?? []).length === 0 && (
              <EmptyState message={`${year} ve ${year - 1} yılları için karşılaştırılacak kaynak tüketimi bulunamadı.`} />
            )}

            {(sourceCompQ.isLoading || (sourceCompQ.data ?? []).length > 0) && !sourceCompQ.isError && (
              <Card className="bg-card border-border">
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border hover:bg-transparent">
                          <TableHead className="text-xs min-w-[140px]">Enerji Kaynağı</TableHead>
                          <TableHead className="text-xs">Birim</TableHead>
                          <TableHead className="text-xs text-right min-w-[90px]">{year} Tüketim</TableHead>
                          <TableHead className="text-xs text-right min-w-[90px]">{year - 1} Tüketim</TableHead>
                          <TableHead className="text-xs text-right min-w-[110px]">Tüketim Değişimi</TableHead>
                          <TableHead className="text-xs text-right min-w-[80px]">{year} TEP</TableHead>
                          <TableHead className="text-xs text-right min-w-[80px]">{year - 1} TEP</TableHead>
                          <TableHead className="text-xs text-right min-w-[100px]">TEP Değişimi</TableHead>
                          <TableHead className="text-xs text-right min-w-[90px]">{year} ton CO₂</TableHead>
                          <TableHead className="text-xs text-right min-w-[90px]">{year - 1} ton CO₂</TableHead>
                          <TableHead className="text-xs text-right min-w-[100px]">CO₂ Değişimi</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sourceCompQ.isLoading ? (
                          <LoadingRows cols={11} />
                        ) : (
                          (sourceCompQ.data ?? []).map((row) => (
                            <TableRow key={row.energySourceId} className="border-border">
                              <TableCell className="text-xs font-medium">{row.energySourceName}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{row.unitOfMeasure}</TableCell>
                              <TableCell className="text-xs text-right tabular-nums">
                                {row.selectedYearRawConsumption.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}
                              </TableCell>
                              <TableCell className="text-xs text-right tabular-nums text-muted-foreground">
                                {row.previousYearRawConsumption.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}
                              </TableCell>
                              <TableCell className="text-xs text-right">
                                <ChangeCell pct={row.rawConsumptionChangePercent} />
                              </TableCell>
                              <TableCell className="text-xs text-right tabular-nums">
                                {row.selectedYearTep.toLocaleString("tr-TR", { maximumFractionDigits: 3 })}
                              </TableCell>
                              <TableCell className="text-xs text-right tabular-nums text-muted-foreground">
                                {row.previousYearTep.toLocaleString("tr-TR", { maximumFractionDigits: 3 })}
                              </TableCell>
                              <TableCell className="text-xs text-right">
                                <ChangeCell pct={row.tepChangePercent} />
                              </TableCell>
                              <TableCell className="text-xs text-right tabular-nums">
                                {row.selectedYearCo2Ton.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}
                              </TableCell>
                              <TableCell className="text-xs text-right tabular-nums text-muted-foreground">
                                {row.previousYearCo2Ton.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}
                              </TableCell>
                              <TableCell className="text-xs text-right">
                                <ChangeCell pct={row.co2ChangePercent} />
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* Tab 3: ÖEK & EnPG Performansı                                 */}
        {/* ══════════════════════════════════════════════════════════════ */}
        <TabsContent value="enpi" className="mt-4 space-y-4">
          {enpiQ.isError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Veriler yüklenemedi: {(enpiQ.error as Error)?.message}
            </div>
          )}

          {/* ── Özet KPI kartları ── */}
          {(enpiList.length > 0 || enpiQ.isFetching) && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <KpiCard
                title="Toplam ÖEK"
                value={enpiQ.isFetching ? "—" : enpiList.length}
                icon={Activity}
                accent="muted"
              />
              <KpiCard
                title="Aktif EnRÇ Modeli"
                value={enpiQ.isFetching ? "—" : enpiList.filter((i) => i.baselineId !== null).length}
                icon={TrendingUp}
                accent="teal"
              />
              <KpiCard
                title="İzlenen ÖEK"
                value={enpiQ.isFetching ? "—" : enpiList.filter((i) => i.monitoringState === "monitored").length}
                icon={CheckCircle2}
                accent="teal"
              />
              <KpiCard
                title="EnRÇ Var / Sonuç Yok"
                value={enpiQ.isFetching ? "—" : enpiList.filter((i) => i.monitoringState === "baseline_without_results").length}
                icon={Clock}
                accent="amber"
              />
              <KpiCard
                title="İzlenmeyen ÖEK"
                value={enpiQ.isFetching ? "—" : enpiList.filter((i) => i.monitoringState === "not_monitored").length}
                icon={AlertCircle}
                accent="muted"
              />
              <KpiCard
                title="Veri İlişkisi Eksik"
                value={enpiQ.isFetching ? "—" : enpiList.filter((i) => i.monitoringState === "missing_relation").length}
                icon={AlertTriangle}
                accent={enpiList.filter((i) => i.monitoringState === "missing_relation").length > 0 ? "red" : "muted"}
              />
            </div>
          )}

          {/* ── Filtreler ── */}
          {(enpiList.length > 0 || enpiQ.isFetching) && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">İzleme</Label>
                <Select value={enpiFilterState} onValueChange={setEnpiFilterState}>
                  <SelectTrigger className="h-8 text-xs w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tümü</SelectItem>
                    <SelectItem value="monitored">İzleniyor</SelectItem>
                    <SelectItem value="baseline_without_results">EnRÇ Var / Sonuç Yok</SelectItem>
                    <SelectItem value="not_monitored">İzlenmiyor</SelectItem>
                    <SelectItem value="missing_relation">Veri İlişkisi Eksik</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {isAdmin && (
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">Birim</Label>
                  <Select value={enpiFilterUnit} onValueChange={setEnpiFilterUnit}>
                    <SelectTrigger className="h-8 text-xs w-40">
                      <SelectValue placeholder="Tümü" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tümü</SelectItem>
                      {Array.from(new Set(enpiList.map((i) => i.unitId).filter(Boolean))).map((uid) => {
                        const found = enpiList.find((i) => i.unitId === uid);
                        return found ? (
                          <SelectItem key={uid!} value={String(uid)}>{found.unitName ?? String(uid)}</SelectItem>
                        ) : null;
                      })}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Enerji Kaynağı</Label>
                <Select value={enpiFilterSource} onValueChange={setEnpiFilterSource}>
                  <SelectTrigger className="h-8 text-xs w-36">
                    <SelectValue placeholder="Tümü" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tümü</SelectItem>
                    {Array.from(new Set(enpiList.map((i) => i.energySourceName).filter((s): s is string => s !== null))).map((src) => (
                      <SelectItem key={src} value={src}>{src}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="enpiOnlyMissing"
                  checked={enpiFilterOnlyMissing}
                  onChange={(e) => setEnpiFilterOnlyMissing(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border accent-teal-500"
                />
                <Label htmlFor="enpiOnlyMissing" className="text-xs text-muted-foreground cursor-pointer whitespace-nowrap">
                  Sadece eksik ilişkiler
                </Label>
              </div>
            </div>
          )}

          {/* ── Boş durum ── */}
          {!enpiQ.isFetching && enpiList.length === 0 && !enpiQ.isError && (
            <EmptyState message="Bu dönem için kabul edilmiş ÖEK bulunamadı." />
          )}

          {!enpiQ.isFetching && enpiList.length > 0 && filteredEnpiList.length === 0 && (
            <EmptyState message="Seçili filtrelere uyan ÖEK bulunamadı." />
          )}

          {/* ── Tablo ── */}
          {(filteredEnpiList.length > 0 || enpiQ.isFetching) && (
            <Card className="bg-card border-border">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border hover:bg-transparent">
                        <TableHead className="text-xs min-w-[140px]">ÖEK</TableHead>
                        {isAdmin && <TableHead className="text-xs min-w-[100px]">Birim</TableHead>}
                        <TableHead className="text-xs min-w-[120px]">Enerji Kul. Grubu</TableHead>
                        <TableHead className="text-xs min-w-[100px]">Enerji Kaynağı</TableHead>
                        <TableHead className="text-xs min-w-[80px]">EnRÇ</TableHead>
                        <TableHead className="text-xs text-right min-w-[110px]">R² / Düz. R²</TableHead>
                        <TableHead className="text-xs min-w-[80px]">Son Dönem</TableHead>
                        <TableHead className="text-xs text-right min-w-[110px]">Yıllık Beklenen</TableHead>
                        <TableHead className="text-xs text-right min-w-[110px]">Yıllık Gerçekleşen</TableHead>
                        <TableHead className="text-xs text-right min-w-[110px]">Yıllık Sapma</TableHead>
                        <TableHead className="text-xs text-right min-w-[70px]">Yıllık EEI</TableHead>
                        <TableHead className="text-xs text-right min-w-[80px]">Son SET</TableHead>
                        <TableHead className="text-xs text-right min-w-[110px]">Dönem Sonu CUSUM</TableHead>
                        <TableHead className="text-xs min-w-[130px]">İzleme Durumu</TableHead>
                        <TableHead className="text-xs text-right">Detay</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {enpiQ.isFetching ? (
                        <LoadingRows cols={isAdmin ? 15 : 14} />
                      ) : (
                        filteredEnpiList.map((item) => (
                          <TableRow key={item.seuItemId} className="border-border">
                            <TableCell className="text-xs font-medium">{item.seuName}</TableCell>
                            {isAdmin && (
                              <TableCell className="text-xs text-muted-foreground">{item.unitName ?? "—"}</TableCell>
                            )}
                            <TableCell className="text-xs text-muted-foreground">{item.energyUseGroupName ?? "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{item.energySourceName ?? "—"}</TableCell>
                            <TableCell className="text-xs">
                              {item.baselineId ? (
                                <Badge className="bg-teal-600/20 text-teal-400 border-teal-600/30 text-[10px]">Var</Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] text-muted-foreground">Yok</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-right tabular-nums">
                              {item.r2Score != null || item.adjustedR2Score != null
                                ? `${item.r2Score != null ? Number(item.r2Score).toFixed(3) : "—"} / ${item.adjustedR2Score != null ? Number(item.adjustedR2Score).toFixed(3) : "—"}`
                                : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{item.lastResultPeriod ?? "—"}</TableCell>
                            {/* Yıllık Beklenen */}
                            <TableCell className="text-xs text-right tabular-nums">
                              {item.annualExpectedConsumption != null
                                ? Number(item.annualExpectedConsumption).toLocaleString("tr-TR", { maximumFractionDigits: 2 })
                                : "—"}
                            </TableCell>
                            {/* Yıllık Gerçekleşen */}
                            <TableCell className="text-xs text-right tabular-nums">
                              {item.annualActualConsumption != null
                                ? Number(item.annualActualConsumption).toLocaleString("tr-TR", { maximumFractionDigits: 2 })
                                : "—"}
                            </TableCell>
                            {/* Yıllık Sapma */}
                            <TableCell className="text-xs text-right tabular-nums">
                              {item.annualVariance != null ? (
                                <span>
                                  {Number(item.annualVariance) > 0 ? "▲ " : Number(item.annualVariance) < 0 ? "▼ " : ""}
                                  {Number(item.annualVariance).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}
                                  {item.annualVariancePercent != null
                                    ? ` (${Number(item.annualVariancePercent) > 0 ? "+" : ""}${Number(item.annualVariancePercent).toFixed(1)}%)`
                                    : ""}
                                </span>
                              ) : "—"}
                            </TableCell>
                            {/* Yıllık EEI (null olmayan ayların ortalaması) — tooltip ile ay sayısı */}
                            <TableCell className="text-xs text-right tabular-nums">
                              {item.annualEei != null ? (
                                <UITooltipProvider delayDuration={150}>
                                  <UITooltip>
                                    <UITooltipTrigger asChild>
                                      <span className="inline-flex items-center gap-1 cursor-default">
                                        {Number(item.annualEei).toLocaleString("tr-TR", { maximumFractionDigits: 4 })}
                                        {item.annualValidEeiCount < 12 && (
                                          <Info className="h-3 w-3 text-amber-400 shrink-0" />
                                        )}
                                      </span>
                                    </UITooltipTrigger>
                                    <UITooltipContent side="top" className="text-xs max-w-[200px] text-center">
                                      {item.annualValidEeiCount > 0
                                        ? `${item.annualValidEeiCount} geçerli aylık sonuç üzerinden hesaplandı.`
                                        : "Yıllık EEI hesaplanamadı."}
                                    </UITooltipContent>
                                  </UITooltip>
                                </UITooltipProvider>
                              ) : (
                                item.annualValidEeiCount === 0 ? "—" : "—"
                              )}
                            </TableCell>
                            {/* Son SET */}
                            <TableCell className="text-xs text-right tabular-nums">
                              {item.latestSet != null
                                ? Number(item.latestSet).toLocaleString("tr-TR", { maximumFractionDigits: 4 })
                                : "—"}
                            </TableCell>
                            {/* Dönem Sonu CUSUM */}
                            <TableCell className="text-xs text-right tabular-nums">
                              {item.periodEndCusum != null
                                ? Number(item.periodEndCusum).toLocaleString("tr-TR", { maximumFractionDigits: 4 })
                                : "—"}
                            </TableCell>
                            <TableCell>
                              <MonitoringBadge state={item.monitoringState} />
                            </TableCell>
                            <TableCell className="text-right">
                              <Link href="/performans-gostergeleri">
                                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-teal-400 hover:text-teal-300">
                                  <ExternalLink className="h-3 w-3" />
                                  Detay
                                </Button>
                              </Link>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* Tab 4: Birim Karşılaştırma (sadece admin)                     */}
        {/* ══════════════════════════════════════════════════════════════ */}
        {isAdmin && (
          <TabsContent value="units" className="mt-4">
            {unitCompQ.isError && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                Veriler yüklenemedi: {(unitCompQ.error as Error)?.message}
              </div>
            )}

            {!unitCompQ.isLoading && unitList.length === 0 && !unitCompQ.isError && (
              <EmptyState message="Karşılaştırılacak birim bulunamadı." />
            )}

            {(unitList.length > 0 || unitCompQ.isLoading) && (
              <Card className="bg-card border-border">
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border hover:bg-transparent">
                          <TableHead className="text-xs min-w-[140px]">Birim</TableHead>
                          <TableHead className="text-xs text-right">TEP</TableHead>
                          <TableHead className="text-xs text-right">ton CO₂</TableHead>
                          <TableHead className="text-xs text-right">ÖEK</TableHead>
                          <TableHead className="text-xs text-right">Aktif EnPG / EnRÇ Modeli</TableHead>
                          <TableHead className="text-xs text-right">İzlenen ÖEK</TableHead>
                          <TableHead className="text-xs text-right">İzlenmeyen ÖEK</TableHead>
                          <TableHead className="text-xs text-right">Açık Aksiyon</TableHead>
                          <TableHead className="text-xs text-right">Gecikmiş</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {unitCompQ.isLoading ? (
                          <LoadingRows cols={9} />
                        ) : (
                          unitList.map((u) => (
                            <TableRow key={u.unitId} className="border-border">
                              <TableCell className="text-xs font-medium">{u.unitName}</TableCell>
                              <TableCell className="text-xs text-right tabular-nums">
                                {u.totalTep.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}
                              </TableCell>
                              <TableCell className="text-xs text-right tabular-nums">
                                {u.totalCo2Ton.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}
                              </TableCell>
                              <TableCell className="text-xs text-right">{u.seuCount}</TableCell>
                              <TableCell className="text-xs text-right">{u.activeEnpiCount}</TableCell>
                              <TableCell className="text-xs text-right">
                                <span className="text-teal-400">{u.monitoredSeuCount}</span>
                              </TableCell>
                              <TableCell className="text-xs text-right">
                                <span className={u.unmonitoredSeuCount > 0 ? "text-amber-400" : ""}>
                                  {u.unmonitoredSeuCount}
                                </span>
                              </TableCell>
                              <TableCell className="text-xs text-right">{u.openActionsCount}</TableCell>
                              <TableCell className="text-xs text-right">
                                <span className={u.overdueActionsCount > 0 ? "text-red-400" : ""}>
                                  {u.overdueActionsCount}
                                </span>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
            <p className="text-[10px] text-muted-foreground/60 mt-2 px-1">
              * Birimler TEP (Ton Eşdeğer Petrol) üzerinden karşılaştırılır. Farklı enerji kaynaklarının doğal tüketim değerleri (kWh, m³, litre) birbiriyle kıyaslanmaz.
            </p>
          </TabsContent>
        )}

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* Tab 5: Hedefler & Aksiyonlar                                  */}
        {/* ══════════════════════════════════════════════════════════════ */}
        <TabsContent value="actions" className="mt-4 space-y-4">
          {taSummaryQ.isError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Veriler yüklenemedi: {(taSummaryQ.error as Error)?.message}
            </div>
          )}

          {/* KPI grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard
              title="Toplam Hedef"
              value={taSummaryQ.isLoading ? "—" : taKpis.total}
              icon={Target}
              accent="teal"
              tooltip="Kapsam içindeki tüm enerji hedefleri (durumdan bağımsız)"
            />
            <KpiCard
              title="Hedefe Ulaşıldı"
              value={taSummaryQ.isLoading ? "—" : taKpis.achieved}
              icon={CheckCircle2}
              accent="teal"
            />
            <KpiCard
              title="İlerliyor"
              value={taSummaryQ.isLoading ? "—" : taKpis.onTrack}
              icon={TrendingUp}
              accent="indigo"
            />
            <KpiCard
              title="Risk Altındaki Hedef"
              value={taSummaryQ.isLoading ? "—" : taKpis.atRisk}
              icon={AlertTriangle}
              accent={taKpis.atRisk > 0 ? "amber" : "muted"}
            />
            <KpiCard
              title="İzleme Verisi Olmayan Hedef"
              value={taSummaryQ.isLoading ? "—" : taKpis.noData}
              icon={AlertTriangle}
              accent={taKpis.noData > 0 ? "amber" : "muted"}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <KpiCard
              title="Açık Aksiyon"
              value={taSummaryQ.isLoading ? "—" : taKpis.openActions}
              icon={Clock}
              accent="muted"
            />
            <KpiCard
              title="Gecikmiş Aksiyon"
              value={taSummaryQ.isLoading ? "—" : taKpis.overdueActions}
              icon={AlertCircle}
              accent={taKpis.overdueActions > 0 ? "red" : "muted"}
            />
            <KpiCard
              title="İlişkili VAP Projesi"
              value={taSummaryQ.isLoading ? "—" : taKpis.vapCount}
              icon={Zap}
              accent="indigo"
            />
          </div>

          {!taSummaryQ.isLoading && taList.length === 0 && !taSummaryQ.isError && (
            <EmptyState message="Kapsam içinde enerji hedefi bulunamadı." />
          )}

          {/* Filtreler */}
          {(taList.length > 0 || taSummaryQ.isLoading) && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Hedef Durumu</Label>
                <Select value={taFilterStatus} onValueChange={setTaFilterStatus}>
                  <SelectTrigger className="w-40 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tümü</SelectItem>
                    {Object.entries(TA_TARGET_STATUS_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Başarı Durumu</Label>
                <Select value={taFilterAchievement} onValueChange={setTaFilterAchievement}>
                  <SelectTrigger className="w-44 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tümü</SelectItem>
                    <SelectItem value="achieved">Hedefe Ulaşıldı</SelectItem>
                    <SelectItem value="on_track">İlerliyor</SelectItem>
                    <SelectItem value="at_risk">Risk Altında</SelectItem>
                    <SelectItem value="no_data">Veri Yok</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <Checkbox
                  checked={taFilterOnlyOverdue}
                  onCheckedChange={(v) => setTaFilterOnlyOverdue(!!v)}
                />
                Sadece gecikmiş aksiyonu olanlar
              </label>
            </div>
          )}

          {/* Hedef tablosu */}
          {(taList.length > 0 || taSummaryQ.isLoading) && (
            <Card className="bg-card border-border">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border hover:bg-transparent">
                        <TableHead className="text-xs min-w-[180px]">Hedef</TableHead>
                        {isAdmin && <TableHead className="text-xs">Birim / Kaynak</TableHead>}
                        <TableHead className="text-xs">Dönem</TableHead>
                        <TableHead className="text-xs text-right">Hedef %</TableHead>
                        <TableHead className="text-xs text-right">Gerçekleşen %</TableHead>
                        <TableHead className="text-xs">Başarı</TableHead>
                        <TableHead className="text-xs">Hedef Durumu</TableHead>
                        <TableHead className="text-xs">Veri İlişkisi</TableHead>
                        <TableHead className="text-xs text-right">Aksiyon</TableHead>
                        <TableHead className="text-xs text-right">Gecikmiş</TableHead>
                        <TableHead className="text-xs text-right">VAP</TableHead>
                        <TableHead className="text-xs text-right">Detay</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {taSummaryQ.isFetching ? (
                        <LoadingRows cols={isAdmin ? 12 : 11} />
                      ) : (
                        filteredTaList.map((t) => (
                          <>
                            <TableRow key={t.id} className="border-border">
                              <TableCell className="text-xs font-medium max-w-[220px] truncate" title={t.name}>{t.name}</TableCell>
                              {isAdmin && (
                                <TableCell className="text-xs text-muted-foreground">
                                  {t.unitName ?? "Tüm Birimler"}
                                  {t.subUnitName ? ` / ${t.subUnitName}` : ""}
                                  {t.energySourceName ? <><br />{t.energySourceName}</> : ""}
                                </TableCell>
                              )}
                              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                {t.baselineYear} → {t.targetYear}
                              </TableCell>
                              <TableCell className="text-xs text-right tabular-nums">{fmtNum(t.targetReductionPercent)}%</TableCell>
                              <TableCell className="text-xs text-right tabular-nums">
                                {t.currentReductionPercent != null ? `${fmtNum(t.currentReductionPercent)}%` : "—"}
                              </TableCell>
                              <TableCell><AchievementBadge state={t.achievementStatus} /></TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-[10px]">
                                  {(t.status && TA_TARGET_STATUS_LABELS[t.status]) ?? t.status ?? "—"}
                                </Badge>
                              </TableCell>
                              <TableCell><RelationBadge state={t.relationState} /></TableCell>
                              <TableCell className="text-xs text-right tabular-nums">{t.actionsCount}</TableCell>
                              <TableCell className="text-xs text-right tabular-nums">
                                {t.overdueActionsCount > 0 ? (
                                  <span className="text-red-400 font-medium">{t.overdueActionsCount}</span>
                                ) : "0"}
                              </TableCell>
                              <TableCell className="text-xs text-right tabular-nums">{t.vapCount}</TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs gap-1 text-teal-400 hover:text-teal-300"
                                  onClick={() => setExpandedTargetId(expandedTargetId === t.id ? null : t.id)}
                                >
                                  {expandedTargetId === t.id ? "Kapat" : "İncele"}
                                </Button>
                              </TableCell>
                            </TableRow>
                            {expandedTargetId === t.id && (
                              <TableRow key={`${t.id}-detail`} className="border-border hover:bg-transparent">
                                <TableCell colSpan={isAdmin ? 12 : 11} className="bg-muted/10 p-4">
                                  <div className="space-y-4">
                                    {/* Hedef metni */}
                                    {(t.objectiveText || t.targetText) && (
                                      <div className="grid sm:grid-cols-2 gap-3 text-xs">
                                        {t.objectiveText && (
                                          <div>
                                            <p className="text-muted-foreground mb-1">Amaç</p>
                                            <p>{t.objectiveText}</p>
                                          </div>
                                        )}
                                        {t.targetText && (
                                          <div>
                                            <p className="text-muted-foreground mb-1">Hedef</p>
                                            <p>{t.targetText}</p>
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {/* İlişkili ÖEK/EnPG */}
                                    <div>
                                      <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                                        <BarChart2 className="h-3.5 w-3.5" /> İlişkili ÖEK / EnPG İzleme Durumu
                                      </p>
                                      {t.relatedSeu ? (
                                        <div className="space-y-1.5">
                                          <Badge className="bg-teal-600/20 text-teal-400 border-teal-600/30 text-[11px]">ÖEK değerlendirmesi bağlantısı var</Badge>
                                          <div className="flex flex-wrap gap-2 text-[11px]">
                                            <Badge variant="outline">{t.relatedSeu.itemCount} kalem</Badge>
                                            <Badge className="bg-teal-600/20 text-teal-400 border-teal-600/30">{t.relatedSeu.monitoredCount} izleniyor</Badge>
                                            <Badge className="bg-amber-600/20 text-amber-400 border-amber-600/30">{t.relatedSeu.baselineWithoutResultsCount} EnRÇ var / sonuç yok</Badge>
                                            <Badge className="bg-muted/30 text-muted-foreground">{t.relatedSeu.notMonitoredCount} izlenmiyor</Badge>
                                          </div>
                                          <p className="text-[11px] text-muted-foreground/70 flex items-start gap-1">
                                            <Info className="h-3 w-3 shrink-0 mt-0.5" />
                                            Bu hedef ÖEK değerlendirmesi seviyesinde ilişkilidir; belirli bir ÖEK veya EnPG bağlantısı tanımlanmamıştır.
                                          </p>
                                        </div>
                                      ) : (
                                        <p className="text-xs text-muted-foreground flex items-start gap-1">
                                          <Info className="h-3 w-3 shrink-0 mt-0.5" />
                                          Bu hedef ÖEK değerlendirmesi seviyesinde ilişkilidir; belirli bir ÖEK veya EnPG bağlantısı tanımlanmamıştır.
                                        </p>
                                      )}
                                    </div>

                                    {/* Aksiyon planları */}
                                    <div>
                                      <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                                        <ListChecks className="h-3.5 w-3.5" /> Aksiyon Planları ({t.actionsCount})
                                      </p>
                                      {t.actions.length === 0 ? (
                                        <p className="text-xs text-muted-foreground">Bu hedefe bağlı aksiyon planı bulunmuyor.</p>
                                      ) : (
                                        <div className="space-y-2">
                                          {t.actions.map((a) => (
                                            <div key={a.id} className="rounded-md border border-border bg-card p-3 text-xs space-y-2">
                                              <div className="flex flex-wrap items-center justify-between gap-2">
                                                <p className="font-medium">{a.title}</p>
                                                <div className="flex items-center gap-1.5">
                                                  {a.overdue && (
                                                    <Badge className="bg-red-500/20 text-red-400 border-0 text-[10px]">Gecikmiş</Badge>
                                                  )}
                                                  <TargetActionStatusBadge status={a.status} />
                                                  {a.priority && (
                                                    <Badge variant="outline" className="text-[10px]">{TA_PRIORITY_LABELS[a.priority] ?? a.priority}</Badge>
                                                  )}
                                                </div>
                                              </div>
                                              {a.description && <p className="text-muted-foreground">{a.description}</p>}
                                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-muted-foreground">
                                                <span>Sorumlu: <span className="text-foreground">{a.responsibleName ?? "—"}</span></span>
                                                <span>Termin: <span className="text-foreground">{a.dueDate ?? "—"}</span></span>
                                                <span>İlerleme: <span className="text-foreground">{a.progressPercent != null ? `%${a.progressPercent}` : "—"}</span></span>
                                                <span>Beklenen Tasarruf: <span className="text-foreground">{a.expectedSavingValue != null ? `${fmtNum(a.expectedSavingValue, 0)} ${a.expectedSavingUnit ?? ""}` : "—"}</span></span>
                                              </div>
                                              {a.vap && (
                                                <div className="mt-2 pt-2 border-t border-border/50 flex flex-wrap items-center gap-3 text-[11px]">
                                                  <Badge className="bg-indigo-500/20 text-indigo-400 border-0 text-[10px]">
                                                    VAP: {a.vap.projectCode ?? a.vap.projectTitle}
                                                  </Badge>
                                                  <span className="text-muted-foreground">Yıllık Tasarruf: <span className="text-foreground">{a.vap.annualEnergySavingValue != null ? `${fmtNum(a.vap.annualEnergySavingValue, 0)} ${a.vap.annualEnergySavingUnit ?? ""}` : "—"}</span></span>
                                                  <span className="text-muted-foreground">CO₂ Azaltımı: <span className="text-foreground">{a.vap.co2ReductionTon != null ? `${fmtNum(a.vap.co2ReductionTon)} ton` : "—"}</span></span>
                                                  <span className="text-muted-foreground">Teşvik: <span className="text-foreground">{a.vap.incentiveStatus ?? "—"}</span></span>
                                                  <Link href="/vap-projeler">
                                                    <Button variant="ghost" size="sm" className="h-6 text-[11px] gap-1 text-teal-400 hover:text-teal-300 px-1.5">
                                                      <ExternalLink className="h-3 w-3" /> VAP Detayı
                                                    </Button>
                                                  </Link>
                                                </div>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-wrap gap-3 pt-2">
            <Link href="/hedefler">
              <Button variant="outline" size="sm" className="gap-2 text-xs">
                <Target className="h-3.5 w-3.5" />
                Enerji Hedefleri Modülüne Git
              </Button>
            </Link>
            <Link href="/vap-projeler">
              <Button variant="outline" size="sm" className="gap-2 text-xs">
                <Zap className="h-3.5 w-3.5" />
                VAP Projeleri Modülüne Git
              </Button>
            </Link>
          </div>

          <Card className="bg-muted/20 border-border">
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground flex items-start gap-2">
                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                Bu sekme salt okunurdur. Hedef ekleme, düzenleme ve aksiyon yönetimi için ilgili modüllere gidin.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* Tab 6: Dönemsel Gözden Geçirme Kaydı                           */}
        {/* ══════════════════════════════════════════════════════════════ */}
        <TabsContent value="records" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Dönemsel enerji gözden geçirme kayıtlarının oluşturulması, taslak düzenlenmesi, tamamlanması ve revize edilmesi.
            </p>
            <Button size="sm" className="gap-2" onClick={openCreateReview}>
              <Plus className="h-4 w-4" />
              Yeni Gözden Geçirme
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Gözden Geçirme Kayıtları</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kayıt Adı</TableHead>
                    <TableHead>Yıl</TableHead>
                    <TableHead>Dönem</TableHead>
                    <TableHead>Kapsam</TableHead>
                    <TableHead>Birim</TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead>Revizyon</TableHead>
                    <TableHead>Hazırlayan</TableHead>
                    <TableHead>Tamamlanma</TableHead>
                    <TableHead className="text-right">İşlemler</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reviewRecordsQ.isLoading && <LoadingRows cols={10} />}
                  {!reviewRecordsQ.isLoading && reviewRecords.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-8">
                        Henüz gözden geçirme kaydı yok.
                      </TableCell>
                    </TableRow>
                  )}
                  {reviewRecords.map((rec) => {
                    const recordId = String(rec.id);
                    const isDeepLinkedReviewRecord = deepLinkReviewRecordId === recordId;

                    return (
                    <TableRow
                      key={rec.id}
                      ref={(node) => {
                        reviewRecordRefs.current[recordId] = node;
                      }}
                      className={`cursor-pointer transition-colors ${isDeepLinkedReviewRecord ? "bg-teal-500/10 ring-1 ring-inset ring-teal-400/50" : ""}`}
                      onClick={() => setReviewDetailId(rec.id)}
                    >
                      <TableCell className="font-medium">{rec.reviewName}</TableCell>
                      <TableCell>{rec.reviewYear}</TableCell>
                      <TableCell>{REVIEW_PERIOD_LABELS[rec.periodType] ?? rec.periodType}</TableCell>
                      <TableCell>{rec.scopeType === "company" ? "Şirket" : "Birim"}</TableCell>
                      <TableCell>{rec.unitName ?? "—"}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            rec.status === "completed"
                              ? "border-emerald-500/40 text-emerald-600 bg-emerald-500/10"
                              : rec.status === "revised"
                                ? "border-muted-foreground/30 text-muted-foreground bg-muted/30"
                                : "border-amber-500/40 text-amber-600 bg-amber-500/10"
                          }
                        >
                          {REVIEW_STATUS_LABELS[rec.status] ?? rec.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{rec.revisionNo}</TableCell>
                      <TableCell>{rec.preparedByName ?? "—"}</TableCell>
                      <TableCell>{rec.completedAt ? new Date(rec.completedAt).toLocaleDateString("tr-TR") : "—"}</TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          {rec.status === "draft" && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Düzenle" onClick={() => openEditReview(rec)}>
                              <FileEdit className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {isAdmin && rec.status === "completed" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="Taslağa Geri Al"
                              onClick={() => reopenReviewMut.mutate(rec.id)}
                              disabled={reopenReviewMut.isPending}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              title="Kaydı Kaldır"
                              onClick={() => {
                                setReviewDeleteId(rec.id);
                                setReviewDeleteReason("");
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {rec.status === "completed" && !isAdmin && (
                            <Lock className="h-3.5 w-3.5 text-muted-foreground self-center mr-1" />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Oluştur / Düzenle formu */}
      <Dialog open={reviewFormOpen} onOpenChange={setReviewFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{reviewEditingId !== null ? "Taslağı Düzenle" : "Yeni Gözden Geçirme Kaydı"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Kayıt Adı</Label>
              <Input
                value={reviewForm.reviewName}
                onChange={(e) => setReviewForm((f) => ({ ...f, reviewName: e.target.value }))}
                placeholder="Örn: 2026 Yıllık Enerji Gözden Geçirmesi"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Yıl</Label>
                <Input
                  type="number"
                  value={reviewForm.reviewYear}
                  onChange={(e) => setReviewForm((f) => ({ ...f, reviewYear: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Dönem Tipi</Label>
                <Select
                  value={reviewForm.periodType}
                  onValueChange={(v) => setReviewForm((f) => ({ ...f, periodType: v as ReviewPeriodType }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="annual">Yıllık</SelectItem>
                    <SelectItem value="semi_annual">Altı Aylık</SelectItem>
                    <SelectItem value="custom">Özel</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Başlangıç Tarihi</Label>
                <Input
                  type="date"
                  value={reviewForm.periodStart}
                  onChange={(e) => setReviewForm((f) => ({ ...f, periodStart: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Bitiş Tarihi</Label>
                <Input
                  type="date"
                  value={reviewForm.periodEnd}
                  onChange={(e) => setReviewForm((f) => ({ ...f, periodEnd: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Kapsam</Label>
                <Select
                  value={reviewForm.scopeType}
                  onValueChange={(v) => setReviewForm((f) => ({ ...f, scopeType: v as ReviewScopeType }))}
                  disabled={!isAdmin}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {isAdmin && <SelectItem value="company">Şirket Geneli</SelectItem>}
                    <SelectItem value="unit">Birim Bazlı</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {reviewForm.scopeType === "unit" && (
                <div className="space-y-1">
                  <Label>Birim</Label>
                  <Select
                    value={reviewForm.unitId}
                    onValueChange={(v) => setReviewForm((f) => ({ ...f, unitId: v }))}
                    disabled={!isAdmin}
                  >
                    <SelectTrigger><SelectValue placeholder="Birim seçin" /></SelectTrigger>
                    <SelectContent>
                      {(units ?? []).map((u: any) => (
                        <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label>Genel Notlar</Label>
              <Textarea
                value={reviewForm.generalNotes}
                onChange={(e) => setReviewForm((f) => ({ ...f, generalNotes: e.target.value }))}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewFormOpen(false)}>İptal</Button>
            <Button
              onClick={submitReviewForm}
              disabled={createReviewMut.isPending || updateReviewMut.isPending}
            >
              {reviewEditingId !== null ? "Kaydet" : "Oluştur"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detay */}
      <Dialog open={reviewDetailId !== null} onOpenChange={(o) => { if (!o) setReviewDetailId(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Gözden Geçirme Kaydı Detayı</DialogTitle>
          </DialogHeader>
          {reviewDetailRecord && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-base">{reviewDetailRecord.reviewName}</span>
                <Badge
                  variant="outline"
                  className={
                    reviewDetailRecord.status === "completed"
                      ? "border-emerald-500/40 text-emerald-600 bg-emerald-500/10"
                      : reviewDetailRecord.status === "revised"
                        ? "border-muted-foreground/30 text-muted-foreground bg-muted/30"
                        : "border-amber-500/40 text-amber-600 bg-amber-500/10"
                  }
                >
                  {REVIEW_STATUS_LABELS[reviewDetailRecord.status] ?? reviewDetailRecord.status}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                <div>Yıl: <span className="text-foreground">{reviewDetailRecord.reviewYear}</span></div>
                <div>Dönem: <span className="text-foreground">{REVIEW_PERIOD_LABELS[reviewDetailRecord.periodType]}</span></div>
                <div>Başlangıç: <span className="text-foreground">{reviewDetailRecord.periodStart}</span></div>
                <div>Bitiş: <span className="text-foreground">{reviewDetailRecord.periodEnd}</span></div>
                <div>Kapsam: <span className="text-foreground">{reviewDetailRecord.scopeType === "company" ? "Şirket" : "Birim"}</span></div>
                <div>Birim: <span className="text-foreground">{reviewDetailRecord.unitName ?? "—"}</span></div>
                <div>Revizyon No: <span className="text-foreground">{reviewDetailRecord.revisionNo}</span></div>
                <div>Hazırlayan: <span className="text-foreground">{reviewDetailRecord.preparedByName ?? "—"}</span></div>
                <div>Tamamlanma: <span className="text-foreground">{reviewDetailRecord.completedAt ? new Date(reviewDetailRecord.completedAt).toLocaleDateString("tr-TR") : "—"}</span></div>
              </div>
              {reviewDetailRecord.generalNotes && (
                <div>
                  <div className="text-muted-foreground mb-1">Genel Notlar</div>
                  <div className="rounded-md bg-muted/30 p-2 whitespace-pre-wrap">{reviewDetailRecord.generalNotes}</div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            {reviewDetailRecord?.status === "draft" && (
              <>
                <Button variant="outline" onClick={() => { openEditReview(reviewDetailRecord); setReviewDetailId(null); }}>
                  <FileEdit className="h-3.5 w-3.5 mr-1.5" />
                  Düzenle
                </Button>
                <Button
                  onClick={() => completeReviewMut.mutate(reviewDetailRecord.id)}
                  disabled={completeReviewMut.isPending}
                >
                  <Lock className="h-3.5 w-3.5 mr-1.5" />
                  Tamamla ve Kilitle
                </Button>
              </>
            )}
            {reviewDetailRecord?.status === "completed" && (
              <Button
                variant="outline"
                onClick={() => reviseReviewMut.mutate(reviewDetailRecord.id)}
                disabled={reviseReviewMut.isPending}
              >
                <History className="h-3.5 w-3.5 mr-1.5" />
                Revize Et
              </Button>
            )}
            {isAdmin && reviewDetailRecord?.status === "completed" && (
              <Button
                variant="outline"
                onClick={() => reopenReviewMut.mutate(reviewDetailRecord.id)}
                disabled={reopenReviewMut.isPending}
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                Taslağa Geri Al
              </Button>
            )}
            {isAdmin && reviewDetailRecord && (
              <Button
                variant="destructive"
                onClick={() => {
                  setReviewDeleteId(reviewDetailRecord.id);
                  setReviewDeleteReason("");
                }}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Kaydı Kaldır
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={reviewDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setReviewDeleteId(null);
            setReviewDeleteReason("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Kaydı Kaldır</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Bu kayıt listeden kaldırılacak. Veritabanından fiziksel olarak silinmeyecek ve denetim izi korunacaktır.
            </p>
            <div className="space-y-2">
              <Label>Silme nedeni (opsiyonel, önerilir)</Label>
              <Textarea
                value={reviewDeleteReason}
                onChange={(e) => setReviewDeleteReason(e.target.value)}
                placeholder="Örn. deneme amaçlı oluşturulan kayıt"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setReviewDeleteId(null);
                setReviewDeleteReason("");
              }}
            >
              İptal
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (reviewDeleteId !== null) {
                  deleteReviewMut.mutate({ id: reviewDeleteId, deleteReason: reviewDeleteReason });
                }
              }}
              disabled={deleteReviewMut.isPending}
            >
              Kaydı Kaldır
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TechnicalProfileContextCard({
  context,
  isLoading,
}: {
  context: TechnicalProfileReportContext | undefined;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="pt-5 pb-4">
          <div className="h-4 rounded bg-muted/30 animate-pulse w-48 mb-3" />
          <div className="h-16 rounded bg-muted/20 animate-pulse w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!context) return null;
  const resolved = context.status === "resolved";
  const summaryFields = [...context.standardSummary.slice(0, 6), ...context.customSummary.slice(0, 4)];

  return (
    <Card className="bg-card border-border" data-testid="energy-review-technical-profile-context">
      <CardHeader className="pb-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="h-4 w-4 text-teal-400" />
            Birim Teknik Profili
          </CardTitle>
          <Badge
            variant="outline"
            className={resolved ? "border-teal-600/30 text-teal-400 bg-teal-600/10" : "border-amber-600/30 text-amber-400 bg-amber-600/10"}
          >
            {resolved ? `Snapshot #${context.snapshotNumber}` : "Snapshot yok"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <p className="text-muted-foreground">Etki tarihi</p>
            <p className="font-medium">{context.effectiveDate}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Birim</p>
            <p className="font-medium">{context.unitName ?? "Kurulus geneli"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Gecerlilik</p>
            <p className="font-medium">{context.validFrom ? `${context.validFrom} / ${context.validTo ?? "devam"}` : "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Tamamlanma</p>
            <p className="font-medium">{context.completionPercentage !== null ? `%${context.completionPercentage}` : "-"}</p>
          </div>
        </div>

        {!resolved && context.warning && (
          <div className="rounded-md border border-amber-600/30 bg-amber-600/10 p-3 text-xs text-amber-300 flex gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{context.warning}</span>
          </div>
        )}

        {summaryFields.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {summaryFields.map((field) => (
              <div key={field.code} className="rounded-md bg-muted/20 px-3 py-2 text-xs">
                <p className="text-muted-foreground truncate">{field.label}</p>
                <p className="font-medium break-words">{field.displayValue}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
