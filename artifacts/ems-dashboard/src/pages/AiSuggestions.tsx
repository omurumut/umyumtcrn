import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getListTargetsQueryKey,
  getListUnitsQueryKey,
  useListTargets,
  useListUnits,
  type EnergyTargetWithProgress,
  type ListTargetsParams,
  type ListUnitsParams,
} from "@workspace/api-client-react";
import type { AiFinding } from "@workspace/api-zod";
import {
  AlertCircle,
  ArrowRight,
  Brain,
  CheckCircle2,
  Clock,
  DatabaseZap,
  Eye,
  FileWarning,
  Info,
  Lightbulb,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { useUnit } from "@/context/UnitContext";
import { useYear } from "@/context/YearContext";
import {
  ApiError,
  createAiAnalysis,
  createDraftActionFromFinding,
  getAiAnalysisDetail,
  getAiPolicy,
  getLegacySuggestions,
  listAiAnalyses,
  type AiAnalysisHistoryItem,
  type AiAnalysisResponse,
  type AiAnalysisType,
  type AiCompanyPolicy,
  type DraftActionResponse,
  type LegacySuggestionsResponse,
} from "@/lib/ai-api";
import {
  ANALYSIS_TYPE_OPTIONS,
  CONFIDENCE_LABELS,
  IMPACT_TYPE_LABELS,
  META_SUFFICIENCY_LABELS,
  MODULE_ROUTES,
  POLICY_LABELS,
  PRIORITY_CLASSES,
  PRIORITY_LABELS,
  RESULT_SUFFICIENCY_LABELS,
  STATUS_LABELS,
  analysisTypeLabel,
  formatDateTime,
  formatNumber,
  formatPeriod,
  labelFrom,
  safeErrorMessage,
} from "@/components/ai/ai-display";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";

const HISTORY_PAGE_SIZE = 8;

const LEGACY_FOCUS_OPTIONS = [
  { value: "genel", label: "Genel Analiz" },
  { value: "seu", label: "OEK Odakli" },
  { value: "co2", label: "CO2 Azaltim" },
  { value: "maliyet", label: "Maliyet Optimizasyonu" },
];

type UnitOption = {
  id: number;
  name: string;
};

type Scope = {
  token: string | null;
  companyId: number | null;
  unitId: number | null;
  year: number;
};

type DraftDialogState = {
  analysis: AiAnalysisResponse;
  finding: AiFinding;
} | null;

type DraftActionForm = {
  targetId: string;
  title: string;
  description: string;
  priority: string;
  responsibleUserId: string;
  startDate: string;
  dueDate: string;
  estimatedCost: string;
  estimatedSavingKwh: string;
  humanApproval: boolean;
  fallbackAcknowledgement: boolean;
};

function isAdminRole(role: string | undefined) {
  return role === "admin" || role === "kontrol_admin" || role === "superadmin";
}

function errorDescription(error: unknown) {
  if (error instanceof ApiError) {
    const byCode: Record<string, string> = {
      AI_DISABLED: "AI analizleri bu kapsam icin kapali.",
      AI_NOT_CONFIGURED: "AI provider yapilandirmasi tamamlanmamis.",
      AI_TIMEOUT: "AI analizi zaman asimina ugradi. Daha sonra tekrar deneyin.",
      AI_RATE_LIMITED: "Benzer bir analiz zaten isleniyor veya servis yogun.",
      AI_QUOTA_EXHAUSTED: "AI servis kotasi dolmus.",
      AI_PROVIDER_UNAVAILABLE: "AI provider su anda erisilebilir degil.",
      AI_SCHEMA_INVALID: "AI yaniti beklenen guvenli sozlesmeye uymadi.",
      CLIENT_SCHEMA_INVALID: "Sunucu yaniti beklenen frontend sozlesmesiyle eslesmedi.",
      AI_USER_CONCURRENCY_LIMIT: "Bu kullanici icin baska bir analiz halen devam ediyor.",
      AI_COMPANY_CONCURRENCY_LIMIT: "Bu firma icin baska analizler halen devam ediyor.",
      AI_DAILY_LIMIT_REACHED: "Firmaniz icin gunluk yeni AI analiz limiti doldu. Daha once olusturulmus analizleri goruntuleyebilirsiniz.",
      AI_MONTHLY_LIMIT_REACHED: "Aylik AI analiz limiti doldu.",
      AI_CIRCUIT_OPEN: "AI saglayicisi gecici olarak kullanilamiyor. Sistem kisa sure sonra yeniden deneyecek.",
    };
    return error.code ? byCode[error.code] ?? error.message : error.message;
  }
  return safeErrorMessage(error);
}

export default function AiSuggestions() {
  const { user, token } = useAuth();
  const { year } = useYear();
  const { unitId, setUnitId } = useUnit();
  const { companyId } = useCompany();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [analysisType, setAnalysisType] = useState<AiAnalysisType>("energy_performance_overview");
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyTypeFilter, setHistoryTypeFilter] = useState<AiAnalysisType | "all">("all");
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>("all");
  const [lastAnalysis, setLastAnalysis] = useState<AiAnalysisResponse | null>(null);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<number | null>(null);
  const [legacyFocus, setLegacyFocus] = useState("genel");
  const [legacyVisible, setLegacyVisible] = useState(false);
  const [draftDialog, setDraftDialog] = useState<DraftDialogState>(null);

  const isSuperAdmin = user?.role === "superadmin";
  const isAdmin = isAdminRole(user?.role);
  const canResolveCompany = !isSuperAdmin || companyId !== null;
  const effectiveUnitId = isAdmin ? unitId : user?.unitId ?? null;
  const scope: Scope = { token, companyId, unitId: effectiveUnitId, year };
  const unitsParams: ListUnitsParams = isSuperAdmin && companyId !== null ? { companyId } : {};
  const unitsQuery = useListUnits<UnitOption[]>(unitsParams, {
    query: { queryKey: [...getListUnitsQueryKey(), companyId], enabled: isAdmin && canResolveCompany },
  });
  const targetParams: ListTargetsParams = {
    ...(isSuperAdmin && companyId !== null ? { companyId } : {}),
    ...(effectiveUnitId !== null ? { unitId: effectiveUnitId } : {}),
  };
  const targetsQuery = useListTargets<EnergyTargetWithProgress[]>(targetParams, {
    query: { queryKey: [...getListTargetsQueryKey(targetParams), companyId, effectiveUnitId], enabled: !!token && canResolveCompany },
  });

  const policyQuery = useQuery<AiCompanyPolicy, ApiError>({
    queryKey: ["ai-policy", user?.role, companyId, year],
    queryFn: () => getAiPolicy(scope),
    enabled: !!token && canResolveCompany,
    retry: false,
  });

  const historyQuery = useQuery({
    queryKey: ["ai-analyses", user?.role, companyId, effectiveUnitId, year, historyOffset, historyTypeFilter, historyStatusFilter],
    queryFn: () => listAiAnalyses(scope, {
      limit: HISTORY_PAGE_SIZE,
      offset: historyOffset,
      analysisType: historyTypeFilter,
      status: historyStatusFilter,
    }),
    enabled: !!token && canResolveCompany,
    retry: false,
  });

  const detailQuery = useQuery({
    queryKey: ["ai-analysis-detail", user?.role, companyId, effectiveUnitId, year, selectedAnalysisId],
    queryFn: () => getAiAnalysisDetail(scope, selectedAnalysisId ?? 0),
    enabled: !!token && canResolveCompany && selectedAnalysisId !== null,
    retry: false,
  });

  const createMutation = useMutation<AiAnalysisResponse, ApiError, AiAnalysisType>({
    mutationFn: (nextType) => createAiAnalysis(scope, nextType),
    onSuccess: async (data) => {
      setLastAnalysis(data);
      await queryClient.invalidateQueries({ queryKey: ["ai-analyses"] });
      toast({
        title: data.meta.cacheHit ? "Analiz cache uzerinden getirildi" : "AI analizi olusturuldu",
        description: data.meta.fallbackUsed
          ? "Gemini servisine erisilemedigi icin kural tabanli fallback sonucu kaydedildi."
          : data.meta.cacheHit
          ? "Ayni veri surumu icin yeni AI cagrisi yapilmadi."
          : "Yeni analiz sonucu dogrulanmis olarak kaydedildi.",
      });
    },
    onError: (error) => {
      toast({ title: "AI analizi olusturulamadi", description: errorDescription(error), variant: "destructive" });
    },
  });

  const legacyMutation = useMutation<LegacySuggestionsResponse, ApiError>({
    mutationFn: () => getLegacySuggestions(scope, legacyFocus),
    onSuccess: () => setLegacyVisible(true),
    onError: (error) => {
      toast({ title: "Kural tabanli oneriler alinamadi", description: errorDescription(error), variant: "destructive" });
    },
  });

  const draftActionMutation = useMutation<DraftActionResponse, ApiError, { analysis: AiAnalysisResponse; finding: AiFinding; form: DraftActionForm }>({
    mutationFn: ({ analysis, finding, form }) => createDraftActionFromFinding(scope, analysis.analysis.id, finding.id, {
      targetId: Number(form.targetId),
      title: form.title,
      description: form.description,
      priority: form.priority,
      responsibleUserId: form.responsibleUserId ? Number(form.responsibleUserId) : null,
      startDate: form.startDate || undefined,
      dueDate: form.dueDate || undefined,
      estimatedCost: form.estimatedCost ? Number(form.estimatedCost) : null,
      estimatedSavingKwh: form.estimatedSavingKwh ? Number(form.estimatedSavingKwh) : null,
      humanApproval: form.humanApproval,
      fallbackAcknowledgement: analysis.meta.fallbackUsed ? form.fallbackAcknowledgement : undefined,
    }),
    onSuccess: (data) => {
      setDraftDialog(null);
      toast({
        title: data.created ? "Taslak aksiyon kaydedildi" : "Bu bulgu daha once donusturulmus",
        description: data.created
          ? "Aksiyon mevcut eylem planlari modulunde planned durumuyla olusturuldu."
          : "Mevcut aksiyon kaydi acilabilir.",
      });
    },
    onError: (error) => {
      toast({ title: "Taslak aksiyon olusturulamadi", description: errorDescription(error), variant: "destructive" });
    },
  });

  const policy = policyQuery.data;
  const submitDisabledReason = useMemo(() => {
    if (!canResolveCompany) return "Superadmin icin once firma secilmelidir.";
    if (policyQuery.isLoading) return "AI firma politikasi yukleniyor.";
    if (policy?.dataPolicy === "disabled") return "AI analizleri bu firma icin kapali.";
    if (createMutation.isPending) return "Analiz su anda olusturuluyor.";
    return null;
  }, [canResolveCompany, createMutation.isPending, policy?.dataPolicy, policyQuery.isLoading]);

  const selectedUnitName = effectiveUnitId === null
    ? "Tum birimler"
    : unitsQuery.data?.find((unit) => unit.id === effectiveUnitId)?.name ?? (isAdmin ? "Secili birim" : "Kendi biriminiz");

  function submitAnalysis() {
    if (submitDisabledReason || createMutation.isPending) return;
    createMutation.mutate(analysisType);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">AI Enerji Analizleri</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {year} donemi icin kullanici tarafindan baslatilan, kayitli ve kanitli AI analizleri.
          </p>
        </div>
        <Badge variant="outline" className="w-fit gap-2 border-teal-600/30 text-teal-400">
          <ShieldCheck className="h-3.5 w-3.5" />
          Backend kontrollu scope
        </Badge>
      </div>

      <AiDisclaimer />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <PolicyStatus policy={policy} isLoading={policyQuery.isLoading} error={policyQuery.error} canResolveCompany={canResolveCompany} />
          <AnalysisForm
            analysisType={analysisType}
            onAnalysisTypeChange={setAnalysisType}
            selectedUnitId={effectiveUnitId}
            selectedUnitName={selectedUnitName}
            units={unitsQuery.data ?? []}
            canChooseUnit={isAdmin}
            onUnitChange={setUnitId}
            isSubmitting={createMutation.isPending}
            disabledReason={submitDisabledReason}
            onSubmit={submitAnalysis}
          />
        </div>

        <ReadinessPanel latest={lastAnalysis} historyCount={historyQuery.data?.items.length ?? 0} />
      </div>

      {createMutation.isPending && (
        <Alert aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin" />
          <AlertTitle>Analiz olusturuluyor</AlertTitle>
          <AlertDescription>
            AI provider yalniz secili kapsam ve donem icin cagriliyor. Sayfadan ayrilmadan gecmis analizleri inceleyebilirsiniz.
          </AlertDescription>
        </Alert>
      )}

      {createMutation.isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Analiz baslatilamadi</AlertTitle>
          <AlertDescription>{errorDescription(createMutation.error)}</AlertDescription>
        </Alert>
      )}

      <LatestAnalysis
        analysis={lastAnalysis}
        targets={targetsQuery.data ?? []}
        canCreateDraftAction={canResolveCompany}
        onCreateDraftAction={(analysis, finding) => setDraftDialog({ analysis, finding })}
      />

      <AnalysisHistory
        items={historyQuery.data?.items ?? []}
        isLoading={historyQuery.isLoading}
        error={historyQuery.error}
        offset={historyOffset}
        pageSize={HISTORY_PAGE_SIZE}
        typeFilter={historyTypeFilter}
        statusFilter={historyStatusFilter}
        onTypeFilterChange={(value) => {
          setHistoryTypeFilter(value);
          setHistoryOffset(0);
        }}
        onStatusFilterChange={(value) => {
          setHistoryStatusFilter(value);
          setHistoryOffset(0);
        }}
        onPrevious={() => setHistoryOffset((current) => Math.max(0, current - HISTORY_PAGE_SIZE))}
        onNext={() => setHistoryOffset((current) => current + HISTORY_PAGE_SIZE)}
        onRefresh={() => historyQuery.refetch()}
        onOpenDetail={setSelectedAnalysisId}
      />

      <LegacySuggestions
        focus={legacyFocus}
        onFocusChange={setLegacyFocus}
        isVisible={legacyVisible}
        response={legacyMutation.data ?? null}
        isLoading={legacyMutation.isPending}
        onLoad={() => legacyMutation.mutate()}
      />

      <Dialog open={selectedAnalysisId !== null} onOpenChange={(open) => !open && setSelectedAnalysisId(null)}>
        <DialogContent className="max-h-[85vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Analiz detayi</DialogTitle>
            <DialogDescription>
              Detaylar kayitli analiz sonucundan yuklenir.
            </DialogDescription>
          </DialogHeader>
          {detailQuery.isLoading && <DetailSkeleton />}
          {detailQuery.isError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Analiz bulunamadi</AlertTitle>
              <AlertDescription>Analiz bulunamadi veya bu kayda erisim yetkiniz yok.</AlertDescription>
            </Alert>
          )}
          {detailQuery.data && (
            <AnalysisResultView
              analysis={detailQuery.data}
              targets={targetsQuery.data ?? []}
              canCreateDraftAction={canResolveCompany}
              onCreateDraftAction={(analysis, finding) => setDraftDialog({ analysis, finding })}
            />
          )}
        </DialogContent>
      </Dialog>
      <DraftActionDialog
        state={draftDialog}
        targets={targetsQuery.data ?? []}
        isSubmitting={draftActionMutation.isPending}
        result={draftActionMutation.data ?? null}
        onClose={() => setDraftDialog(null)}
        onSubmit={(analysis, finding, form) => draftActionMutation.mutate({ analysis, finding, form })}
      />
    </div>
  );
}

function AiDisclaimer() {
  return (
    <Alert>
      <Info className="h-4 w-4" />
      <AlertTitle>AI karar destegi uyarisi</AlertTitle>
      <AlertDescription>
        AI analizleri karar destegi amaclidir. Muhendislik fizibilitesi, yatirim geri donusu veya enerji tasarrufu garantisi degildir.
        Resmi hesaplamalar EnYS tarafindan uretilen dogrulanmis verilere dayanir. Uygulama oncesinde yetkili uzman degerlendirmesi gerekir.
      </AlertDescription>
    </Alert>
  );
}

function PolicyStatus({ policy, isLoading, error, canResolveCompany }: {
  policy: AiCompanyPolicy | undefined;
  isLoading: boolean;
  error: unknown;
  canResolveCompany: boolean;
}) {
  if (!canResolveCompany) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Firma AI kullanimi</CardTitle>
          <CardDescription>Analiz icin once ust bardan firma secin.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (isLoading) {
    return (
      <Card>
        <CardHeader><Skeleton className="h-5 w-48" /></CardHeader>
        <CardContent><Skeleton className="h-12 w-full" /></CardContent>
      </Card>
    );
  }
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>AI politikasi okunamadi</AlertTitle>
        <AlertDescription>{errorDescription(error)}</AlertDescription>
      </Alert>
    );
  }
  const display = POLICY_LABELS[policy?.dataPolicy ?? "disabled"] ?? POLICY_LABELS.disabled;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base">Firma AI kullanimi</CardTitle>
            <CardDescription>{display.description}</CardDescription>
          </div>
        <Badge variant="outline" className="w-fit">{display.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">
        Saklama suresi: {policy?.retentionDays ? `${policy.retentionDays} gun` : "varsayilan veya tanimsiz"} ·
        Gunluk limit: {policy?.dailyAnalysisLimit ?? "sinirsiz"} ·
        Aylik limit: {policy?.monthlyAnalysisLimit ?? "sinirsiz"} ·
        Fallback: {policy?.fallbackEnabled === false ? "kapali" : "acik"}
      </CardContent>
    </Card>
  );
}

function AnalysisForm(props: {
  analysisType: AiAnalysisType;
  onAnalysisTypeChange: (value: AiAnalysisType) => void;
  selectedUnitId: number | null;
  selectedUnitName: string;
  units: UnitOption[];
  canChooseUnit: boolean;
  onUnitChange: (value: number | null) => void;
  isSubmitting: boolean;
  disabledReason: string | null;
  onSubmit: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Analiz olustur</CardTitle>
        <CardDescription>Analiz turu, donem ve kapsam secerek yeni bir kayit olusturun.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(220px,0.8fr)]">
          <div className="space-y-2">
            <Label htmlFor="analysis-type">Analiz turu</Label>
            <Select value={props.analysisType} onValueChange={(value) => props.onAnalysisTypeChange(value as AiAnalysisType)}>
              <SelectTrigger id="analysis-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ANALYSIS_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {ANALYSIS_TYPE_OPTIONS.find((option) => option.value === props.analysisType)?.description}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="analysis-unit">Kapsam</Label>
            {props.canChooseUnit ? (
              <Select
                value={props.selectedUnitId === null ? "0" : String(props.selectedUnitId)}
                onValueChange={(value) => props.onUnitChange(value === "0" ? null : Number(value))}
              >
                <SelectTrigger id="analysis-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Tum birimler</SelectItem>
                  {props.units.map((unit) => (
                    <SelectItem key={unit.id} value={String(unit.id)}>{unit.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div id="analysis-unit" className="rounded-md border bg-muted/30 px-3 py-2 text-sm">{props.selectedUnitName}</div>
            )}
            <p className="text-xs text-muted-foreground">Donem ust bardaki yil seciminden gelir.</p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {props.disabledReason ?? "Analiz yalniz bu butona basildiginda olusturulur."}
          </p>
          <Button onClick={props.onSubmit} disabled={props.disabledReason !== null || props.isSubmitting} className="gap-2">
            {props.isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Analiz olustur
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ReadinessPanel({ latest, historyCount }: { latest: AiAnalysisResponse | null; historyCount: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Veri hazirlik ozeti</CardTitle>
        <CardDescription>Hazirlik durumu son analiz metasi ve gecmis kayitlardan ozetlenir.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <StatusLine icon={<DatabaseZap className="h-4 w-4" />} label="Veri yeterliligi" value={latest ? labelFrom(META_SUFFICIENCY_LABELS, latest.meta.dataSufficiency) : "Analiz sonrasi gorunur"} />
        <StatusLine icon={<FileWarning className="h-4 w-4" />} label="Context limiti" value={latest?.meta.contextTruncated ? "Kisitlandi" : latest ? "Kisitlanmadi" : "Analiz sonrasi gorunur"} />
        <StatusLine icon={<Clock className="h-4 w-4" />} label="Gecmis kayit" value={`${historyCount} kayit listelendi`} />
      </CardContent>
    </Card>
  );
}

function StatusLine({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
      <div className="flex items-center gap-2 text-muted-foreground">{icon}<span>{label}</span></div>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function LatestAnalysis(props: {
  analysis: AiAnalysisResponse | null;
  targets: EnergyTargetWithProgress[];
  canCreateDraftAction: boolean;
  onCreateDraftAction: (analysis: AiAnalysisResponse, finding: AiFinding) => void;
}) {
  const { analysis } = props;
  if (!analysis) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon"><Brain className="h-5 w-5" /></EmptyMedia>
          <EmptyTitle>Son analiz henuz secilmedi</EmptyTitle>
          <EmptyDescription>Yeni bir analiz olusturun veya gecmisten bir kaydi acin. Sayfa acilisinda AI provider cagrisi yapilmaz.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <AnalysisResultView
      analysis={analysis}
      targets={props.targets}
      canCreateDraftAction={props.canCreateDraftAction}
      onCreateDraftAction={props.onCreateDraftAction}
    />
  );
}

function AnalysisResultView(props: {
  analysis: AiAnalysisResponse;
  targets: EnergyTargetWithProgress[];
  canCreateDraftAction: boolean;
  onCreateDraftAction: (analysis: AiAnalysisResponse, finding: AiFinding) => void;
}) {
  const { analysis } = props;
  const result = analysis.analysis.result;
  const normalizedMetaSufficiency = analysis.meta.dataSufficiency === "complete" ? "sufficient" : analysis.meta.dataSufficiency;
  const sufficiencyConflict = normalizedMetaSufficiency !== result.dataSufficiency;
  return (
    <div className="space-y-4" data-testid="ai-analysis-result">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle>{analysisTypeLabel(analysis.analysis.analysisType)}</CardTitle>
              <CardDescription>{formatPeriod(analysis.analysis.periodStart, analysis.analysis.periodEnd)} donemi icin kayitli analiz</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{labelFrom(STATUS_LABELS, analysis.analysis.status)}</Badge>
              <Badge variant="outline">{analysis.meta.provider}</Badge>
              <Badge variant="outline">{analysis.meta.fallbackUsed ? "Kural tabanli fallback" : analysis.meta.cacheHit ? "Cache hit" : "Yeni AI cagrisi"}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Olusturma" value={formatDateTime(analysis.meta.createdAt ?? analysis.analysis.createdAt)} />
            <Metric label="Tamamlanma" value={formatDateTime(analysis.meta.completedAt ?? analysis.analysis.completedAt)} />
            <Metric label="Veri yeterliligi" value={labelFrom(META_SUFFICIENCY_LABELS, analysis.meta.dataSufficiency)} />
            <Metric label="Model" value={analysis.meta.model} />
          </div>
          {analysis.meta.fallbackUsed && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Kural tabanli fallback</AlertTitle>
              <AlertDescription>
                Gemini servisine erisilemedigi icin kural tabanli oneriler gosteriliyor. Bu sonuc Gemini AI analizi degildir ve sinirli karar destegi olarak degerlendirilmelidir.
              </AlertDescription>
            </Alert>
          )}
          {analysis.meta.cacheHit ? (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Cache hit</AlertTitle>
              <AlertDescription>Bu sonuc ayni veri surumu icin daha once olusturulan dogrulanmis analizden getirildi. Yeni AI cagrisi yapilmadi.</AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <Zap className="h-4 w-4" />
              <AlertTitle>Yeni analiz</AlertTitle>
              <AlertDescription>Bu veri surumu icin yeni analiz olusturuldu.</AlertDescription>
            </Alert>
          )}
          {analysis.meta.contextTruncated && (
            <Alert>
              <FileWarning className="h-4 w-4" />
              <AlertTitle>Context sinirlandi</AlertTitle>
              <AlertDescription>Analiz context'i guvenli limitler nedeniyle kisaltilmis olabilir.</AlertDescription>
            </Alert>
          )}
          {sufficiencyConflict && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Veri yeterliligi farki</AlertTitle>
              <AlertDescription>Backend meta durumu ana durum olarak kullanildi; AI sonucundaki yeterlilik etiketi farkli olabilir.</AlertDescription>
            </Alert>
          )}
          <div>
            <h2 className="text-base font-semibold">Ozet</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{result.summary}</p>
          </div>
          {result.overallLimitations.length > 0 && (
            <div>
              <h3 className="text-sm font-medium">Genel sinirlamalar</h3>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {result.overallLimitations.map((item) => <li key={item}>- {item}</li>)}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {result.findings.map((finding) => (
          <FindingCard
            key={finding.id}
            analysis={analysis}
            finding={finding}
            targetCount={props.targets.length}
            canCreateDraftAction={props.canCreateDraftAction}
            onCreateDraftAction={props.onCreateDraftAction}
          />
        ))}
      </div>
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>AI sonuc aciklamasi</AlertTitle>
        <AlertDescription>{result.disclaimer}</AlertDescription>
      </Alert>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  );
}

function FindingCard(props: {
  analysis: AiAnalysisResponse;
  finding: AiFinding;
  targetCount: number;
  canCreateDraftAction: boolean;
  onCreateDraftAction: (analysis: AiAnalysisResponse, finding: AiFinding) => void;
}) {
  const { analysis, finding } = props;
  const route = MODULE_ROUTES[finding.moduleTarget];
  const canDraft = props.canCreateDraftAction && finding.draftActionEligibility.eligible && props.targetCount > 0;
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base leading-snug">{finding.title}</CardTitle>
            <CardDescription>{labelFrom(RESULT_SUFFICIENCY_LABELS, finding.dataSufficiency)} veri yeterliligi</CardDescription>
          </div>
          <Badge variant="outline" className={PRIORITY_CLASSES[finding.priority] ?? ""}>
            {labelFrom(PRIORITY_LABELS, finding.priority)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed text-muted-foreground">{finding.observation}</p>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{labelFrom(CONFIDENCE_LABELS, finding.confidence)}</Badge>
          <Badge variant="secondary">{labelFrom(IMPACT_TYPE_LABELS, finding.estimatedImpact.type)}</Badge>
        </div>
        {finding.confidence === "low" && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>Bu oneri sinirli veya eksik verilere dayanmaktadir.</AlertDescription>
          </Alert>
        )}
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Onerilen aksiyon</h4>
          <p className="text-sm text-muted-foreground">{finding.recommendedAction}</p>
        </div>
        <Impact impact={finding.estimatedImpact} />
        <Accordion type="single" collapsible>
          <AccordionItem value="detail">
            <AccordionTrigger>Gerekce, kanit ve sinirlamalar</AccordionTrigger>
            <AccordionContent className="space-y-4">
              <div>
                <h4 className="text-sm font-medium">Gerekce</h4>
                <p className="mt-1 text-sm text-muted-foreground">{finding.reasoning}</p>
              </div>
              <EvidenceList evidence={finding.evidence} />
              <CompactList title="Eksik veriler" items={finding.missingData} />
              <CompactList title="Sinirlamalar" items={finding.limitations} />
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <Metric label="Ekipman referansi" value={finding.equipmentRefs.length > 0 ? `${finding.equipmentRefs.length} kayit` : "-"} />
                <Metric label="Enerji kaynagi referansi" value={finding.energySourceRefs.length > 0 ? `${finding.energySourceRefs.length} kayit` : "-"} />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
        <div className="flex flex-wrap gap-2">
          {finding.draftActionEligibility.eligible ? (
            <Button size="sm" className="gap-2" disabled={!canDraft} onClick={() => props.onCreateDraftAction(analysis, finding)}>
              <Lightbulb className="h-3.5 w-3.5" />
              Taslak aksiyon olustur
            </Button>
          ) : (
            <Badge variant="outline">Aksiyona uygun degil: {finding.draftActionEligibility.reason}</Badge>
          )}
          {route && (
            <Button variant="outline" size="sm" asChild className="gap-2">
              <Link href={route.href}>{route.label}<ArrowRight className="h-3.5 w-3.5" /></Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DraftActionDialog(props: {
  state: DraftDialogState;
  targets: EnergyTargetWithProgress[];
  isSubmitting: boolean;
  result: DraftActionResponse | null;
  onClose: () => void;
  onSubmit: (analysis: AiAnalysisResponse, finding: AiFinding, form: DraftActionForm) => void;
}) {
  const finding = props.state?.finding ?? null;
  const analysis = props.state?.analysis ?? null;
  const [form, setForm] = useState<DraftActionForm>(() => emptyDraftForm(finding));

  useEffect(() => {
    setForm(emptyDraftForm(finding));
  }, [finding?.id]);

  if (!finding || !analysis) return null;
  const scopedTargets = props.targets.filter((target) => target.unitId === finding.scope.unitId);
  const canSubmit = form.humanApproval
    && (!analysis.meta.fallbackUsed || form.fallbackAcknowledgement)
    && form.targetId !== ""
    && form.title.trim().length > 0
    && !props.isSubmitting;
  const previousAction = props.result?.created === false && props.result.source.analysisId === analysis.analysis.id && props.result.source.findingId === finding.id
    ? props.result.action
    : null;

  function update<K extends keyof DraftActionForm>(key: K, value: DraftActionForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <Dialog open={props.state !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Taslak aksiyon olustur</DialogTitle>
          <DialogDescription>Kayit yalniz onay verilip kaydet butonuna basildiginda olusturulur.</DialogDescription>
        </DialogHeader>

        {previousAction && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Bu bulgu icin taslak aksiyon zaten olusturulmus.</AlertTitle>
            <AlertDescription>
              {previousAction.title} kaydi mevcut. <Link href="/targets" className="underline">Mevcut aksiyonu goruntule</Link>
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div className="rounded-md border p-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{labelFrom(PRIORITY_LABELS, finding.priority)}</Badge>
              <Badge variant="outline">{labelFrom(IMPACT_TYPE_LABELS, finding.estimatedImpact.type)}</Badge>
              <Badge variant="outline">{labelFrom(CONFIDENCE_LABELS, finding.confidence)}</Badge>
            </div>
            <h3 className="mt-3 text-base font-semibold">{finding.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{finding.observation}</p>
            <p className="mt-2 text-sm text-muted-foreground">{finding.reasoning}</p>
          </div>

          <EvidenceList evidence={finding.evidence} />
          <CompactList title="Eksik veriler" items={finding.missingData} />
          <CompactList title="Sinirlamalar" items={finding.limitations} />

          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>AI karar destegi uyarisi</AlertTitle>
            <AlertDescription>
              Bu oneri muhendislik fizibilitesi, tasarruf garantisi veya dogrulanmis hesap kaydi degildir. Sorumlu kisi, hedef tarih ve sayisal degerler kullanici kontroluyle girilmelidir.
            </AlertDescription>
          </Alert>

          {analysis.meta.fallbackUsed && (
            <Alert>
              <FileWarning className="h-4 w-4" />
              <AlertTitle>Fallback sonucu</AlertTitle>
              <AlertDescription>Bu bulgu Gemini yerine kural tabanli fallback sonucundan gelmistir; ek manuel onay zorunludur.</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="draft-title">Aksiyon basligi</Label>
              <Input id="draft-title" value={form.title} onChange={(event) => update("title", event.target.value)} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="draft-description">Aciklama</Label>
              <Textarea id="draft-description" rows={5} value={form.description} onChange={(event) => update("description", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="draft-target">Baglanacak hedef</Label>
              <Select value={form.targetId} onValueChange={(value) => update("targetId", value)}>
                <SelectTrigger id="draft-target"><SelectValue placeholder="Hedef secin" /></SelectTrigger>
                <SelectContent>
                  {scopedTargets.map((target) => (
                    <SelectItem key={target.id} value={String(target.id)}>{target.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="draft-priority">Oncelik</Label>
              <Select value={form.priority} onValueChange={(value) => update("priority", value)}>
                <SelectTrigger id="draft-priority"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Dusuk</SelectItem>
                  <SelectItem value="medium">Orta</SelectItem>
                  <SelectItem value="high">Yuksek</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="draft-start">Baslangic tarihi</Label>
              <Input id="draft-start" type="date" value={form.startDate} onChange={(event) => update("startDate", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="draft-due">Hedef tarih</Label>
              <Input id="draft-due" type="date" value={form.dueDate} onChange={(event) => update("dueDate", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="draft-cost">Tahmini maliyet</Label>
              <Input id="draft-cost" inputMode="decimal" value={form.estimatedCost} onChange={(event) => update("estimatedCost", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="draft-saving">Tahmini tasarruf kWh/yil</Label>
              <Input id="draft-saving" inputMode="decimal" value={form.estimatedSavingKwh} onChange={(event) => update("estimatedSavingKwh", event.target.value)} />
            </div>
          </div>

          <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <Checkbox checked={form.humanApproval} onCheckedChange={(checked) => update("humanApproval", checked === true)} />
            <span>Bu onerinin AI destekli karar destegi oldugunu, muhendislik fizibilitesi veya tasarruf garantisi olmadigini ve aksiyon alanlarini kontrol ettigimi onayliyorum.</span>
          </label>
          {analysis.meta.fallbackUsed && (
            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <Checkbox checked={form.fallbackAcknowledgement} onCheckedChange={(checked) => update("fallbackAcknowledgement", checked === true)} />
              <span>Bu bulgunun kural tabanli fallback sonucundan geldigini ve ek manuel degerlendirme gerektirdigini onayliyorum.</span>
            </label>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={props.onClose}>Vazgec</Button>
          <Button disabled={!canSubmit} onClick={() => props.onSubmit(analysis, finding, form)}>
            {props.isSubmitting ? "Kaydediliyor..." : "Taslak aksiyonu kaydet"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function emptyDraftForm(finding: AiFinding | null): DraftActionForm {
  return {
    targetId: "",
    title: finding?.title ?? "",
    description: finding ? `${finding.observation}\n\nOnerilen aksiyon: ${finding.recommendedAction}` : "",
    priority: finding ? priorityToDraftPriority(finding.priority) : "medium",
    responsibleUserId: "",
    startDate: "",
    dueDate: "",
    estimatedCost: "",
    estimatedSavingKwh: "",
    humanApproval: false,
    fallbackAcknowledgement: false,
  };
}

function priorityToDraftPriority(priority: AiFinding["priority"]) {
  return priority === "critical" ? "high" : priority;
}

function Impact({ impact }: { impact: AiFinding["estimatedImpact"] }) {
  const numericAllowed = impact.type === "verified_calculation" || impact.type === "backend_scenario";
  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Tahmini etki</span>
        <Badge variant="outline">{labelFrom(IMPACT_TYPE_LABELS, impact.type)}</Badge>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{impact.description}</p>
      {numericAllowed && (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Metric label="Enerji" value={formatNumber(impact.annualKwh, " kWh/yil")} />
          <Metric label="Maliyet" value={formatNumber(impact.annualCost)} />
          <Metric label="Oran" value={formatNumber(impact.percent, "%")} />
        </div>
      )}
      {impact.type === "qualitative_estimate" && (
        <p className="mt-2 text-xs text-muted-foreground">Sayisal tasarruf garantisi olarak yorumlanmamalidir.</p>
      )}
    </div>
  );
}

function EvidenceList({ evidence }: { evidence: AiFinding["evidence"] }) {
  if (evidence.length === 0) return <CompactList title="Kanitlar" items={["Kanit kaydi bulunmuyor."]} />;
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">Kanitlar</h4>
      <div className="space-y-2">
        {evidence.map((item) => (
          <div key={`${item.source}:${item.description}`} className="rounded-md border px-3 py-2 text-sm">
            <div className="font-medium">{item.source}</div>
            <div className="text-muted-foreground">{item.description}</div>
            {item.value && <div className="mt-1 text-xs text-muted-foreground">Deger: {item.value}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function CompactList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="text-sm font-medium">{title}</h4>
      <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
        {items.map((item) => <li key={item}>- {item}</li>)}
      </ul>
    </div>
  );
}

function AnalysisHistory(props: {
  items: AiAnalysisHistoryItem[];
  isLoading: boolean;
  error: unknown;
  offset: number;
  pageSize: number;
  typeFilter: AiAnalysisType | "all";
  statusFilter: string;
  onTypeFilterChange: (value: AiAnalysisType | "all") => void;
  onStatusFilterChange: (value: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onRefresh: () => void;
  onOpenDetail: (id: number) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>Analiz gecmisi</CardTitle>
            <CardDescription>Liste backend pagination ile yuklenir; tam sonuc detaya tiklandiginda alinir.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={props.onRefresh} className="w-fit gap-2">
            <RefreshCw className="h-3.5 w-3.5" /> Yenile
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Analiz turu</Label>
            <Select value={props.typeFilter} onValueChange={(value) => props.onTypeFilterChange(value as AiAnalysisType | "all")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tum analizler</SelectItem>
                {ANALYSIS_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={props.statusFilter} onValueChange={props.onStatusFilterChange}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tum durumlar</SelectItem>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {props.isLoading && <DetailSkeleton />}
        {Boolean(props.error) && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Gecmis yuklenemedi</AlertTitle>
            <AlertDescription>{errorDescription(props.error)}</AlertDescription>
          </Alert>
        )}
        {!props.isLoading && !props.error && props.items.length === 0 && (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Clock className="h-5 w-5" /></EmptyMedia>
              <EmptyTitle>Analiz gecmisi bos</EmptyTitle>
              <EmptyDescription>Bu kapsam icin henuz kayitli AI analizi yok.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {!props.isLoading && props.items.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tarih</TableHead>
                <TableHead>Tur</TableHead>
                <TableHead>Donem</TableHead>
                <TableHead>Kapsam</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Cache</TableHead>
                <TableHead className="text-right">Detay</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{formatDateTime(item.createdAt)}</TableCell>
                  <TableCell>{analysisTypeLabel(item.analysisType)}</TableCell>
                  <TableCell>{formatPeriod(item.periodStart, item.periodEnd)}</TableCell>
                  <TableCell>{item.unitId === null ? "Tum birimler" : `Unit #${item.unitId}`}</TableCell>
                  <TableCell><Badge variant="outline">{labelFrom(STATUS_LABELS, item.status)}</Badge></TableCell>
                  <TableCell>{item.provider}</TableCell>
                  <TableCell>{item.cacheHit ? "Hit" : "Miss"}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => props.onOpenDetail(item.id)} className="gap-2">
                      <Eye className="h-3.5 w-3.5" /> Goster
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="flex items-center justify-between gap-3">
          <Button variant="outline" size="sm" onClick={props.onPrevious} disabled={props.offset === 0}>Onceki</Button>
          <span className="text-xs text-muted-foreground">Offset {props.offset}</span>
          <Button variant="outline" size="sm" onClick={props.onNext} disabled={props.items.length < props.pageSize}>Sonraki</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LegacySuggestions(props: {
  focus: string;
  onFocusChange: (value: string) => void;
  isVisible: boolean;
  response: LegacySuggestionsResponse | null;
  isLoading: boolean;
  onLoad: () => void;
}) {
  const suggestions = props.response?.suggestions ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Kural tabanli oneriler</CardTitle>
        <CardDescription>Legacy oneriler otomatik calismaz; isterseniz manuel olarak acabilirsiniz.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-1.5">
            <Label>Odak</Label>
            <Select value={props.focus} onValueChange={props.onFocusChange}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LEGACY_FOCUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={props.onLoad} disabled={props.isLoading} className="gap-2">
            {props.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lightbulb className="h-4 w-4" />}
            Kural tabanli onerileri goster
          </Button>
        </div>
        {props.isVisible && suggestions.length === 0 && (
          <p className="text-sm text-muted-foreground">Kural tabanli oneri uretilemedi.</p>
        )}
        {props.isVisible && suggestions.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2">
            {suggestions.map((suggestion) => (
              <div key={`${suggestion.title}:${suggestion.category}`} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-medium">{suggestion.title}</h3>
                    <p className="text-xs text-muted-foreground">{suggestion.category}</p>
                  </div>
                  <Badge variant="outline">{suggestion.priority}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{suggestion.description}</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Metric label="Tasarruf" value={formatNumber(suggestion.potentialSavingKwh, " kWh")} />
                  <Metric label="Azaltim" value={formatNumber(suggestion.potentialSavingPercent, "%")} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-28 w-full" />
    </div>
  );
}
