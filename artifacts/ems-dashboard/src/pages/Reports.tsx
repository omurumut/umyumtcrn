import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListReports, useGenerateReport, getListReportsQueryKey, type ReportRecord, type ReportResult } from "@workspace/api-client-react";
import type { ReportArchiveDetailResponse } from "@workspace/api-zod";
import { useYear } from "@/context/YearContext";
import { useUnit } from "@/context/UnitContext";
import { useCompany } from "@/context/CompanyContext";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FileText, Download, RefreshCw, ClipboardList, Archive, RotateCcw, Trash2, Info, Copy, Eye, AlertTriangle, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { downloadBlobResponse, downloadPdfResponse } from "@/lib/download";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

type ArchiveItem = {
  id: number;
  reportType: string;
  title: string;
  outputName: string;
  status: string;
  sizeBytes: number | null;
  generatedBy: { id: number | null; name: string } | null;
  generatedAt: string;
  completedAt: string | null;
  year: number | null;
  periodLabel: string | null;
  downloadable: boolean;
  failureCategory: string | null;
  lifecycle?: {
    deletedAt: string | null;
    purgeEligibleAt: string | null;
    purgedAt: string | null;
    retentionExpiresAt: string | null;
    deletionLocked: boolean;
  };
};

type ArchiveResponse = {
  items: ArchiveItem[];
  total: number;
  limit: number;
  offset: number;
  hasNext: boolean;
};

const REPORT_TYPE_LABELS: Record<string, string> = {
  annual_energy_performance: "Yıllık Enerji Performansı",
  energy_targets_management: "Enerji Hedefleri Yönetimi",
  energy_performance_monitoring: "Enerji Performansı İzleme",
};

const STATUS_LABELS: Record<string, string> = {
  completed: "Hazir",
  generating: "Uretiliyor",
  failed: "Hatali",
  deleted: "Silinen",
  purging: "Purge ediliyor",
  purged: "Kalici silinmis",
  purge_failed: "Purge hatali",
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  annual_consumption: "Yillik tuketim",
  annual_meters: "Sayaclar",
  annual_swot: "SWOT kayitlari",
  annual_risks: "Risk ve firsatlar",
  annual_seu: "OEK degerlendirmeleri",
  energy_targets: "Enerji hedefleri",
  target_progress: "Hedef gerceklesmeleri",
  action_plans: "Eylem planlari",
  vap_projects: "VAP projeleri",
  report_units: "Birim kapsami",
  energy_baseline: "EnRC modeli",
  energy_baseline_variables: "Model degiskenleri",
  energy_performance_results: "EnPG sonuclari",
  energy_performance_seu: "OEK baglantisi",
  technical_profile: "Teknik profil",
  equipment_inventory: "Ekipman envanteri",
};

const WARNING_LABELS: Record<string, string> = {
  MISSING_CONSUMPTION_MONTHS: "Eksik tuketim donemi",
  PARTIAL_PERIOD: "Kismi donem",
  MISSING_TARGET_PROGRESS: "Hedef gerceklesmesi eksik",
  MISSING_PERFORMANCE_RESULTS: "EnPG sonucu eksik",
  MISSING_MODEL_VARIABLES: "Model degiskeni eksik",
  MISSING_TECHNICAL_PROFILE: "Teknik profil eksik",
  MISSING_EQUIPMENT_INVENTORY: "Ekipman envanteri eksik",
  NO_SOURCE_RECORDS: "Kaynak kayit yok",
};

function formatBytes(value: number | null): string {
  if (!value || value <= 0) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" });
}

function formatDateOnly(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("tr-TR", { year: "numeric", month: "short", day: "numeric" });
}

function safeText(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function shortHash(value: string | null | undefined): string {
  if (!value) return "-";
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}...${value.slice(-8)}`;
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? "Bilinmeyen durum";
}

function statusClassName(status: string): string {
  if (status === "completed") return "bg-green-500/10 text-green-400 border-green-500/20";
  if (status === "failed" || status === "purge_failed") return "bg-red-500/10 text-red-400 border-red-500/20";
  if (status === "deleted" || status === "purged") return "bg-slate-500/10 text-slate-300 border-slate-500/20";
  return "bg-amber-500/10 text-amber-400 border-amber-500/20";
}

function warningLabel(code: string): string {
  return WARNING_LABELS[code] ?? "Denetim uyarisi";
}

function sourceTypeLabel(sourceType: string): string {
  return SOURCE_TYPE_LABELS[sourceType] ?? "Kaynak kategori";
}

function buildArchiveScopeParams(unitId: number | null, isSuperAdmin: boolean, companyId: number | null): URLSearchParams | null {
  if (isSuperAdmin && companyId === null) return null;
  const params = new URLSearchParams();
  if (unitId !== null) params.set("unitId", String(unitId));
  if (isSuperAdmin && companyId !== null) params.set("companyId", String(companyId));
  return params;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReportArchiveDetailResponse(value: unknown): value is ReportArchiveDetailResponse {
  if (!isRecord(value)) return false;
  return isRecord(value.archive)
    && typeof value.archive.id === "number"
    && typeof value.archive.reportType === "string"
    && typeof value.archive.reportName === "string"
    && typeof value.archive.status === "string"
    && isRecord(value.scope)
    && isRecord(value.generation)
    && isRecord(value.document)
    && (value.dataScope === null || isRecord(value.dataScope))
    && isRecord(value.failure)
    && isRecord(value.retry)
    && isRecord(value.lifecycle);
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm font-medium">{value}</div>
    </div>
  );
}

function HashValue({ label, value, onCopy }: { label: string; value: string | null | undefined; onCopy: (value: string) => void }) {
  const hasValue = typeof value === "string" && value.length > 0;
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 break-all font-mono text-sm">{shortHash(value)}</div>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`${label} tam hash kopyala`}
            disabled={!hasValue}
            onClick={() => hasValue && onCopy(value)}
          >
            <Copy className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Tam hash degerini kopyalar</TooltipContent>
      </Tooltip>
    </div>
  );
}

function QualityWarnings({ detail }: { detail: ReportArchiveDetailResponse }) {
  const dataScope = detail.dataScope;
  if (!dataScope) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Manifest yok</AlertTitle>
        <AlertDescription>Bu rapor eski surumde uretildigi icin veri kapsam manifesti bulunmuyor.</AlertDescription>
      </Alert>
    );
  }
  const warnings = dataScope.qualityWarnings;
  return (
    <div className="space-y-3">
      {dataScope.isPartial && (
        <Alert className="border-amber-500/30 bg-amber-500/10">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Kismi veri kapsami</AlertTitle>
          <AlertDescription>Bu rapor kismi veri kapsami ile olusturulmustur.</AlertDescription>
        </Alert>
      )}
      {warnings.length === 0 ? (
        <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground">Kayitli kalite uyarisi yok.</div>
      ) : (
        warnings.map((warning, index) => (
          <div key={`${warning.code}-${index}`} className="rounded-md border border-border/60 bg-muted/20 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={warning.severity === "warning" ? "border-amber-500/30 text-amber-400" : "border-sky-500/30 text-sky-400"}>
                {warning.severity === "warning" ? "Uyari" : "Bilgi"}
              </Badge>
              <span className="text-sm font-medium">{warningLabel(warning.code)}</span>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              Kaynak: {warning.sourceType ? sourceTypeLabel(warning.sourceType) : "Genel"}{typeof warning.count === "number" ? ` | Adet: ${warning.count}` : ""}
            </div>
            {warning.periods && warning.periods.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {warning.periods.slice(0, 12).map((period) => <Badge key={period} variant="secondary">{period}</Badge>)}
              </div>
            )}
            {warning.message && <p className="mt-2 text-sm text-muted-foreground">{warning.message}</p>}
          </div>
        ))
      )}
    </div>
  );
}

function ManifestView({ detail, onCopyHash }: { detail: ReportArchiveDetailResponse; onCopyHash: (value: string) => void }) {
  const manifest = detail.dataScope;
  if (!manifest) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Veri kapsam manifesti bulunmuyor</AlertTitle>
        <AlertDescription>Bu rapor eski surumde uretildigi icin veri kapsam manifesti bulunmuyor.</AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="space-y-3" data-testid="archive-detail-manifest">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <KeyValue label="Manifest sema surumu" value={`v${manifest.schemaVersion}`} />
        <KeyValue label="Kapsanan donem" value={`${formatDateOnly(manifest.period.periodStart)} - ${formatDateOnly(manifest.period.periodEnd)}`} />
        <KeyValue label="Kismi kapsam" value={manifest.isPartial ? "Evet" : "Hayir"} />
        <KeyValue label="Timezone" value={manifest.period.timezone} />
      </div>
      <HashValue label="Manifest hash" value={manifest.manifestHash} onCopy={onCopyHash} />
      <p className="text-xs text-muted-foreground">
        Manifest hash tam veri snapshot'i degildir; canonical manifestin butunlugunu dogrulamak icin kullanilir.
      </p>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kaynak</TableHead>
              <TableHead className="text-right">Kayit</TableHead>
              <TableHead>Identity hash</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {manifest.sources.map((source) => (
              <TableRow key={source.sourceType}>
                <TableCell>{sourceTypeLabel(source.sourceType)}</TableCell>
                <TableCell className="text-right">{source.recordCount}</TableCell>
                <TableCell>
                  <HashValue label="Identity" value={source.identityHash} onCopy={onCopyHash} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ArchiveDetailSheet({
  item,
  detail,
  loading,
  error,
  open,
  canMutate,
  actionLoading,
  onOpenChange,
  onRetry,
  onDownload,
  onDelete,
  onRestore,
  onRetryArchive,
  onCopyHash,
}: {
  item: ArchiveItem | null;
  detail: ReportArchiveDetailResponse | null;
  loading: boolean;
  error: string | null;
  open: boolean;
  canMutate: boolean;
  actionLoading: number | null;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
  onDownload: (item: ArchiveItem) => void;
  onDelete: (item: ArchiveItem) => void;
  onRestore: (item: ArchiveItem) => void;
  onRetryArchive: (item: ArchiveItem) => void;
  onCopyHash: (value: string) => void;
}) {
  const archive = detail?.archive;
  const canDownload = Boolean(item && archive?.canDownload === true);
  const canRestore = Boolean(item && canMutate && archive?.canRestore === true);
  const canDelete = Boolean(item && canMutate && archive && (archive.status === "completed" || archive.status === "failed"));
  const canRetry = Boolean(item && canMutate && detail?.retry.canRetry === true);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex h-full w-full flex-col overflow-y-auto sm:max-w-2xl lg:max-w-3xl" data-testid="archive-detail-sheet">
        <SheetHeader className="pr-8">
          <SheetTitle>Rapor detayi</SheetTitle>
          <SheetDescription>{item?.title ?? "Secili rapor arsiv kaydi"}</SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="space-y-3" data-testid="archive-detail-loading">
            {Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-12" />)}
          </div>
        ) : error ? (
          <Alert variant="destructive" data-testid="archive-detail-error">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Rapor detayi alinamadi</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{error}</p>
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>Tekrar dene</Button>
            </AlertDescription>
          </Alert>
        ) : detail && item ? (
          <div className="space-y-6 pb-6">
            <div className="sticky top-0 z-10 -mx-6 border-b bg-background/95 px-6 py-3 backdrop-blur">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={statusClassName(detail.archive.status)}>{statusLabel(detail.archive.status)}</Badge>
                {canDownload && <Button size="sm" className="gap-2" onClick={() => onDownload(item)}><Download className="h-4 w-4" /> Indir</Button>}
                {canRetry && <Button size="sm" variant="outline" className="gap-2" disabled={actionLoading === item.id} onClick={() => onRetryArchive(item)}><RefreshCw className="h-4 w-4" /> Yeniden Dene</Button>}
                {canDelete && <Button size="sm" variant="outline" className="gap-2 text-destructive hover:text-destructive" disabled={actionLoading === item.id} onClick={() => onDelete(item)}><Trash2 className="h-4 w-4" /> Sil</Button>}
                {canRestore && <Button size="sm" variant="outline" className="gap-2" disabled={actionLoading === item.id} onClick={() => onRestore(item)}><RotateCcw className="h-4 w-4" /> Geri al</Button>}
              </div>
              {canRetry && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Yeni rapor guncel veri ve rapor ayarlariyla olusturulur. Mevcut basarisiz kayit degismeden korunur.
                </p>
              )}
            </div>

            <DetailSection title="Genel bilgiler">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <KeyValue label="Rapor adi" value={detail.archive.reportName} />
                <KeyValue label="Rapor turu" value={REPORT_TYPE_LABELS[detail.archive.reportType] ?? detail.archive.reportType} />
                <KeyValue label="Dosya adi" value={detail.archive.fileName} />
                <KeyValue label="MIME turu" value={detail.archive.mimeType} />
                <KeyValue label="Dosya boyutu" value={formatBytes(detail.archive.sizeBytes)} />
                <KeyValue label="Olusturulma" value={formatDateTime(detail.archive.createdAt)} />
                <KeyValue label="Tamamlanma" value={formatDateTime(detail.archive.completedAt)} />
                <KeyValue label="Basarisizlik" value={formatDateTime(detail.archive.failedAt)} />
                <KeyValue label="Arsivlenme/silinme" value={formatDateTime(detail.archive.deletedAt)} />
                <KeyValue label="Retention expiry" value={formatDateTime(detail.archive.expiresAt)} />
                <KeyValue label="Lifecycle version" value={detail.archive.lifecycleVersion} />
                <KeyValue label="Stale generation" value={detail.lifecycle.isStale ? "Evet" : "Hayir"} />
              </div>
            </DetailSection>

            <DetailSection title="Kapsam">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <KeyValue label="Firma" value={`Firma #${detail.scope.companyId}`} />
                <KeyValue label="Birim" value={detail.scope.unitId === null ? "Company-wide" : `Birim #${detail.scope.unitId}`} />
                <KeyValue label="Rapor donemi" value={`${formatDateOnly(detail.scope.periodStart)} - ${formatDateOnly(detail.scope.periodEnd)}`} />
                <KeyValue label="Olusturan" value={detail.generation.generatedByUserId === null ? "-" : `Kullanici #${detail.generation.generatedByUserId}`} />
                <KeyValue label="Ayar profil versiyonu" value={safeText(detail.generation.settingsProfileVersion)} />
                <KeyValue label="Rapor turu ayar versiyonu" value={safeText(detail.generation.reportTypeSettingsVersion)} />
              </div>
            </DetailSection>

            <DetailSection title="Dokuman bilgileri">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <KeyValue label="Dokuman no" value={safeText(detail.document.documentNumber)} />
                <KeyValue label="Revizyon no" value={safeText(detail.document.revisionNumber)} />
                <KeyValue label="Revizyon tarihi" value={safeText(detail.document.revisionDate)} />
                <KeyValue label="Hazirlayan" value={safeText(detail.document.preparedBy)} />
                <KeyValue label="Kontrol eden" value={safeText(detail.document.checkedBy)} />
                <KeyValue label="Onaylayan" value={safeText(detail.document.approvedBy)} />
                <KeyValue label="Gizlilik" value={safeText(detail.document.confidentialityLevel)} />
                <KeyValue label="Alt bilgi" value={safeText(detail.document.footerText)} />
              </div>
            </DetailSection>

            <DetailSection title="Veri kapsam manifesti">
              <ManifestView detail={detail} onCopyHash={onCopyHash} />
            </DetailSection>

            <DetailSection title="Veri kalite durumu">
              <QualityWarnings detail={detail} />
            </DetailSection>

            <DetailSection title="Lifecycle ve hata bilgisi">
              {!detail.retry.canRetry && detail.retry.reason && (
                <Alert className="mb-3">
                  <Info className="h-4 w-4" />
                  <AlertTitle>Retry uygun degil</AlertTitle>
                  <AlertDescription>{detail.retry.reason}</AlertDescription>
                </Alert>
              )}
              {detail.archive.status === "failed" || detail.archive.status === "purge_failed" ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <KeyValue label="Hata kategorisi" value={safeText(detail.failure.category)} />
                  <KeyValue label="Hata mesaji" value={safeText(detail.failure.message)} />
                  <KeyValue label="Retryable" value={detail.failure.retryable ? "Evet" : "Hayir"} />
                </div>
              ) : detail.archive.status === "deleted" ? (
                <Alert>
                  <RotateCcw className="h-4 w-4" />
                  <AlertTitle>Silinen arsiv kaydi</AlertTitle>
                  <AlertDescription>{detail.archive.canRestore ? "Bu rapor geri alinabilir." : "Bu rapor geri alma icin uygun degil."}</AlertDescription>
                </Alert>
              ) : (
                <Alert>
                  <ShieldCheck className="h-4 w-4" />
                  <AlertTitle>Lifecycle durumu</AlertTitle>
                  <AlertDescription>{statusLabel(detail.archive.status)}</AlertDescription>
                </Alert>
              )}
            </DetailSection>

            <DetailSection title="Teknik dogrulama bilgileri">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <KeyValue label="Archive ID" value={detail.archive.id} />
                <KeyValue label="Retry source" value={safeText(detail.retry.retryOfArchiveId)} />
                <KeyValue label="Son retry archive" value={safeText(detail.retry.latestRetryArchiveId)} />
                <KeyValue label="Son retry durumu" value={detail.retry.latestRetryStatus ? statusLabel(detail.retry.latestRetryStatus) : "-"} />
                <KeyValue label="Snapshot ID" value={safeText(detail.generation.snapshotId)} />
                <KeyValue label="Boyut" value={formatBytes(detail.archive.sizeBytes)} />
                <KeyValue label="Lifecycle version" value={detail.archive.lifecycleVersion} />
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3">
                <HashValue label="Checksum" value={detail.archive.checksum} onCopy={onCopyHash} />
                <HashValue label="Manifest hash" value={detail.dataScope?.manifestHash ?? null} onCopy={onCopyHash} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Checksum saklanan rapor dosyasinin butunlugunu, manifest hash ise veri kapsam manifestinin butunlugunu temsil eder.
              </p>
            </DetailSection>
          </div>
        ) : (
          <div className="rounded-md border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">Detay icin bir arsiv kaydi secin.</div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function Reports() {
  const { year } = useYear();
  const { unitId } = useUnit();
  const { companyId } = useCompany();
  const { token, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [reportYear, setReportYear] = useState(year.toString());
  const [includeSwot, setIncludeSwot] = useState(true);
  const [includeRisks, setIncludeRisks] = useState(true);
  const [includeSeu, setIncludeSeu] = useState(true);
  const [includeRegression, setIncludeRegression] = useState(true);
  const [annualOverrideTouched, setAnnualOverrideTouched] = useState<Record<string, boolean>>({});

  // ── ISO 50001 Hedef/Eylem/VAP raporu state ─────────────────────────────
  const [targetYear, setTargetYear] = useState(year.toString());
  const [targetStatus, setTargetStatus] = useState("all");
  const [targetIncludeVap, setTargetIncludeVap] = useState(true);
  const [targetIncludeProgress, setTargetIncludeProgress] = useState(true);
  const [targetOverrideTouched, setTargetOverrideTouched] = useState<Record<string, boolean>>({});
  const [targetLoading, setTargetLoading] = useState(false);
  const [archiveType, setArchiveType] = useState("all");
  const [archiveYear, setArchiveYear] = useState("all");
  const [archiveStatus, setArchiveStatus] = useState("completed");
  const [archivePage, setArchivePage] = useState(0);
  const [archiveData, setArchiveData] = useState<ArchiveResponse | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveActionLoading, setArchiveActionLoading] = useState<number | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<ArchiveItem | null>(null);
  const [retryCandidate, setRetryCandidate] = useState<ArchiveItem | null>(null);
  const [detailArchive, setDetailArchive] = useState<ArchiveItem | null>(null);
  const [archiveDetail, setArchiveDetail] = useState<ReportArchiveDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRefreshKey, setDetailRefreshKey] = useState(0);
  const archiveLimit = 10;
  const canMutateArchive = user?.role === "admin" || user?.role === "superadmin";
  const isSuperAdmin = user?.role === "superadmin";

  function archiveScopeParams(): URLSearchParams | null {
    return buildArchiveScopeParams(unitId, isSuperAdmin, companyId);
  }

  async function fetchArchive(page = archivePage) {
    if (!token) return;
    const scopeParams = archiveScopeParams();
    if (scopeParams === null) {
      setArchiveData({ items: [], total: 0, limit: archiveLimit, offset: 0, hasNext: false });
      setArchiveError("Superadmin için firma context'i gereklidir.");
      return;
    }
    setArchiveLoading(true);
    setArchiveError(null);
    try {
      const params = new URLSearchParams({ limit: String(archiveLimit), offset: String(page * archiveLimit) });
      scopeParams.forEach((value, key) => params.set(key, value));
      if (archiveType !== "all") params.set("reportType", archiveType);
      if (archiveYear !== "all") params.set("year", archiveYear);
      if (archiveStatus !== "all") params.set("status", archiveStatus);
      const response = await fetch(`/api/reports/archive?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
      setArchiveData(body as ArchiveResponse);
      setArchivePage(page);
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : "Rapor arşivi yüklenemedi.");
    } finally {
      setArchiveLoading(false);
    }
  }

  useEffect(() => {
    void fetchArchive(0);
  }, [token, user?.role, unitId, companyId, archiveType, archiveYear, archiveStatus]);

  function archiveUrl(path: string): string | null {
    const params = archiveScopeParams();
    if (params === null) return null;
    const query = params.toString();
    return query ? `${path}?${query}` : path;
  }

  useEffect(() => {
    if (!token || detailArchive === null) {
      setArchiveDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    const url = archiveUrl(`/api/reports/archive/${detailArchive.id}/detail`);
    if (url === null) {
      setArchiveDetail(null);
      setDetailError("Superadmin icin once firma secimi yapin.");
      setDetailLoading(false);
      return;
    }
    const controller = new AbortController();
    setArchiveDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message = response.status === 400
            ? "Firma secimi gerekli olabilir."
            : response.status === 403 || response.status === 404
              ? "Rapor bulunamadi veya bu rapora erisim yetkiniz yok."
              : "Rapor detayi yuklenemedi.";
          throw new Error(message);
        }
        if (!isReportArchiveDetailResponse(body)) throw new Error("Rapor detayi beklenen formatta degil.");
        setArchiveDetail(body);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setArchiveDetail(null);
        setDetailError(error instanceof Error ? error.message : "Rapor detayi yuklenemedi.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [token, detailArchive?.id, detailRefreshKey, unitId, companyId, user?.role]);

  async function refreshOpenDetail(item: ArchiveItem) {
    setDetailArchive({ ...item });
    setDetailRefreshKey((current) => current + 1);
    await fetchArchive(archivePage);
  }

  function openArchiveDetail(item: ArchiveItem) {
    setDetailArchive(item);
    setArchiveDetail(null);
    setDetailError(null);
  }

  async function copyHash(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: "Hash kopyalandi" });
    } catch {
      toast({ title: "Hash kopyalanamadi", variant: "destructive" });
    }
  }

  async function downloadArchiveByUrl(url: string, fallback: string) {
    if (!token) return;
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${response.status}`);
      }
      await downloadBlobResponse(response, fallback);
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : "Rapor indirilemedi.", variant: "destructive" });
    }
  }

  async function downloadArchive(item: ArchiveItem) {
    const url = archiveUrl(`/api/reports/archive/${item.id}/download`);
    if (url === null) {
      toast({ title: "Firma secimi gerekli", variant: "destructive" });
      return;
    }
    await downloadArchiveByUrl(url, item.outputName);
  }

  async function softDeleteArchive(item: ArchiveItem) {
    if (!token) return;
    const url = archiveUrl(`/api/reports/archive/${item.id}`);
    if (url === null) {
      toast({ title: "Firma secimi gerekli", variant: "destructive" });
      return;
    }
    setArchiveActionLoading(item.id);
    try {
      const response = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "manual_admin_delete" }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
      setDeleteCandidate(null);
      toast({ title: "Rapor arsivden kaldirildi", description: "Kalici silme yalniz operasyonel temizleme surecinde yapilir." });
      if (detailArchive?.id === item.id) setDetailArchive(null);
      void fetchArchive(0);
    } catch (error) {
      toast({ title: "Rapor silinemedi", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setArchiveActionLoading(null);
    }
  }

  async function restoreArchive(item: ArchiveItem) {
    if (!token) return;
    const url = archiveUrl(`/api/reports/archive/${item.id}/restore`);
    if (url === null) {
      toast({ title: "Firma secimi gerekli", variant: "destructive" });
      return;
    }
    setArchiveActionLoading(item.id);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
      toast({ title: "Rapor geri alindi" });
      void refreshOpenDetail(item);
    } catch (error) {
      toast({ title: "Rapor geri alinamadi", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setArchiveActionLoading(null);
    }
  }

  async function retryArchive(item: ArchiveItem) {
    if (!token || !archiveDetail) return;
    const url = archiveUrl(`/api/reports/archive/${item.id}/retry`);
    if (url === null) {
      toast({ title: "Firma secimi gerekli", variant: "destructive" });
      return;
    }
    setArchiveActionLoading(item.id);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ expectedLifecycleVersion: archiveDetail.archive.lifecycleVersion, reason: "manual_retry" }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(body) || typeof body.newArchiveId !== "number") {
        const message = isRecord(body) && typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
        throw new Error(message);
      }
      setRetryCandidate(null);
      toast({ title: "Retry tamamlandi", description: `Yeni arsiv kaydi #${body.newArchiveId} olusturuldu.` });
      await fetchArchive(0);
      setDetailArchive({
        ...item,
        id: body.newArchiveId,
        title: `${item.title} - Yeniden deneme`,
        status: typeof body.status === "string" ? body.status : "generating",
      });
      setDetailRefreshKey((current) => current + 1);
    } catch (error) {
      toast({ title: "Retry baslatilamadi", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setArchiveActionLoading(null);
    }
  }

  async function handleTargetReport() {
    setTargetLoading(true);
    try {
      const params = new URLSearchParams({ year: targetYear });
      if (unitId !== null) params.set("unitId", String(unitId));
      if (targetStatus !== "all") params.set("status", targetStatus);
      if (targetOverrideTouched.includeVap) params.set("includeVap", String(targetIncludeVap));
      if (targetOverrideTouched.includeProgress) params.set("includeProgress", String(targetIncludeProgress));

      const res = await fetch(`/api/reports/energy-targets/pdf?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }

      await downloadPdfResponse(res, `enerji-hedefleri-${targetYear}.pdf`);
      void fetchArchive(0);

      toast({ title: `${targetYear} yılı yönetim raporu indirildi` });
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "Yönetim raporu oluşturulamadı.",
        variant: "destructive",
      });
    } finally {
      setTargetLoading(false);
    }
  }

  const { data: reports, isLoading } = useListReports({ query: { queryKey: getListReportsQueryKey() } });
  const generate = useGenerateReport();

  const filteredReports = unitId !== null
    ? (reports ?? []).filter((report: ReportRecord) => report.unitId === unitId)
    : (reports ?? []);

  function handleGenerate() {
    const legacyOverrides = {
      ...(annualOverrideTouched.includeSwot ? { includeSwot } : {}),
      ...(annualOverrideTouched.includeRisks ? { includeRisks } : {}),
      ...(annualOverrideTouched.includeSeu ? { includeSeu } : {}),
      ...(annualOverrideTouched.includeRegression ? { includeRegression } : {}),
    };
    generate.mutate({
      data: {
        year: parseInt(reportYear),
        ...legacyOverrides,
        ...(unitId !== null ? { unitId } : {}),
      },
    }, {
      onSuccess: (result: ReportResult) => {
        queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() });
        toast({ title: `${reportYear} yılı raporu oluşturuldu` });
        if (result?.downloadUrl) {
          void downloadArchiveByUrl(result.downloadUrl, `enerji-raporu-${reportYear}.html`);
        }
        void fetchArchive(0);
      },
      onError: () => toast({ title: "Rapor oluşturulamadı", variant: "destructive" }),
    });
  }

  function handleDownload(report: ReportRecord) {
    if (!report.downloadUrl) return;
    const a = document.createElement("a");
    a.href = report.downloadUrl;
    a.download = `enerji-raporu-${report.year}.html`;
    a.click();
  }

  const years = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Raporlar</h1>
        <p className="text-sm text-muted-foreground mt-1">Yıllık enerji performans raporları</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" /> Rapor Oluştur
          </CardTitle>
          <CardDescription>Seçilen yıl için kapsamlı ISO 50001 enerji performans raporu hazırlanır ve HTML olarak indirilir</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Rapor Yılı</Label>
            <Select value={reportYear} onValueChange={setReportYear}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>{years.map(y => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div>
            <Label className="mb-2 block">Dahil Edilecek Bölümler</Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: "swot", label: "SWOT Analizi", checked: includeSwot, setter: setIncludeSwot },
                { id: "risks", label: "Risk & Fırsat", checked: includeRisks, setter: setIncludeRisks },
                { id: "seu", label: "Önemli Enerji Kullanımları", checked: includeSeu, setter: setIncludeSeu },
                { id: "regression", label: "Regresyon Analizi", checked: includeRegression, setter: setIncludeRegression },
              ].map(item => (
                <div key={item.id} className="flex items-center gap-2 p-2 rounded-md border border-border/50 bg-muted/20">
                  <Checkbox
                    id={item.id}
                    checked={item.checked}
                    onCheckedChange={(v) => {
                      item.setter(v === true);
                      setAnnualOverrideTouched((current) => ({ ...current, [`include${item.id === "swot" ? "Swot" : item.id === "risks" ? "Risks" : item.id === "seu" ? "Seu" : "Regression"}`]: true }));
                    }}
                  />
                  <label htmlFor={item.id} className="text-sm cursor-pointer">{item.label}</label>
                </div>
              ))}
            </div>
          </div>

          <Button onClick={handleGenerate} disabled={generate.isPending} className="gap-2 w-full sm:w-auto">
            {generate.isPending ? (
              <><RefreshCw className="h-4 w-4 animate-spin" /> Hazırlanıyor...</>
            ) : (
              <><FileText className="h-4 w-4" /> Rapor Oluştur & İndir</>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-4 w-4" /> ISO 50001 Hedef, Eylem Planı ve VAP Yönetim Raporu
          </CardTitle>
          <CardDescription>
            Enerji hedefleri, eylem planları, gerçekleşme kayıtları ve VAP bağlantılarını yönetim raporu olarak indirir.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Rapor Yılı</Label>
              <Select value={targetYear} onValueChange={setTargetYear}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>{years.map(y => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Hedef Durumu</Label>
              <Select value={targetStatus} onValueChange={setTargetStatus}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  <SelectItem value="active">Aktif</SelectItem>
                  <SelectItem value="completed">Tamamlandı</SelectItem>
                  <SelectItem value="cancelled">İptal</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="mb-2 block">Dahil Edilecek Bölümler</Label>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-2 p-2 rounded-md border border-border/50 bg-muted/20">
                <Checkbox
                  id="target-include-vap"
                  checked={targetIncludeVap}
                  onCheckedChange={(v) => {
                    setTargetIncludeVap(v === true);
                    setTargetOverrideTouched((current) => ({ ...current, includeVap: true }));
                  }}
                />
                <label htmlFor="target-include-vap" className="text-sm cursor-pointer">VAP Portföyü</label>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-md border border-border/50 bg-muted/20">
                <Checkbox
                  id="target-include-progress"
                  checked={targetIncludeProgress}
                  onCheckedChange={(v) => {
                    setTargetIncludeProgress(v === true);
                    setTargetOverrideTouched((current) => ({ ...current, includeProgress: true }));
                  }}
                />
                <label htmlFor="target-include-progress" className="text-sm cursor-pointer">Gerçekleşme Kronolojisi</label>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Button
              onClick={handleTargetReport}
              disabled={targetLoading}
              className="gap-2 w-full sm:w-auto"
            >
              {targetLoading ? (
                <><RefreshCw className="h-4 w-4 animate-spin" /> Rapor hazırlanıyor...</>
              ) : (
                <><Download className="h-4 w-4" /> PDF Raporu İndir</>
              )}
            </Button>
            <p className="text-xs text-muted-foreground">
              Rapor güvenli PDF dosyası olarak indirilir.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Archive className="h-4 w-4" /> Rapor Arşivi
          </CardTitle>
          <CardDescription>Oluşturulan raporları tenant kapsamı içinde listeler ve güvenli endpoint üzerinden indirir.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label>Rapor Türü</Label>
              <Select value={archiveType} onValueChange={(value) => { setArchiveType(value); setArchivePage(0); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  <SelectItem value="annual_energy_performance">Yıllık Enerji Performansı</SelectItem>
                  <SelectItem value="energy_targets_management">Enerji Hedefleri Yönetimi</SelectItem>
                  <SelectItem value="energy_performance_monitoring">Enerji Performansı İzleme</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Yıl</Label>
              <Select value={archiveYear} onValueChange={(value) => { setArchiveYear(value); setArchivePage(0); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  {years.map(y => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Durum</Label>
              <Select value={archiveStatus} onValueChange={(value) => { setArchiveStatus(value); setArchivePage(0); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  <SelectItem value="completed">Hazır</SelectItem>
                  <SelectItem value="generating">Üretiliyor</SelectItem>
                  <SelectItem value="failed">Hatalı</SelectItem>
                  <SelectItem value="deleted">Silinen</SelectItem>
                  <SelectItem value="purged">Kalıcı silinmiş</SelectItem>
                  <SelectItem value="purge_failed">Purge hatalı</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button variant="outline" className="gap-2 w-full" onClick={() => fetchArchive(0)} disabled={archiveLoading}>
                <RefreshCw className={`h-4 w-4 ${archiveLoading ? "animate-spin" : ""}`} /> Yenile
              </Button>
            </div>
          </div>

          {archiveError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{archiveError}</div>
          ) : archiveLoading && !archiveData ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rapor</TableHead>
                    <TableHead>Dönem</TableHead>
                    <TableHead>Oluşturan</TableHead>
                    <TableHead>Tarih</TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead>Boyut</TableHead>
                    <TableHead className="text-right">Aksiyon</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(archiveData?.items ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">Seçili filtrelere uygun arşiv kaydı yok</TableCell></TableRow>
                  ) : (
                    archiveData!.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="font-medium">{item.title}</div>
                          <div className="text-xs text-muted-foreground">{REPORT_TYPE_LABELS[item.reportType] ?? item.reportType}</div>
                        </TableCell>
                        <TableCell>{item.year ?? item.periodLabel ?? "-"}</TableCell>
                        <TableCell>{item.generatedBy?.name ?? "-"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(item.generatedAt).toLocaleDateString("tr-TR", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            item.status === "completed" ? "bg-green-500/10 text-green-400 border-green-500/20" :
                            item.status === "failed" || item.status === "purge_failed" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                            item.status === "deleted" || item.status === "purged" ? "bg-slate-500/10 text-slate-300 border-slate-500/20" :
                            "bg-amber-500/10 text-amber-400 border-amber-500/20"
                          }>
                            {item.status === "completed" ? "Hazır" :
                              item.status === "failed" ? `Hata${item.failureCategory ? `: ${item.failureCategory}` : ""}` :
                              item.status === "deleted" ? "Silinen" :
                              item.status === "purged" ? "Kalıcı silinmiş" :
                              item.status === "purge_failed" ? `Purge hatası${item.failureCategory ? `: ${item.failureCategory}` : ""}` :
                              item.status === "purging" ? "Purge ediliyor" : "Üretiliyor"}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatBytes(item.sizeBytes)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => openArchiveDetail(item)} data-testid={`archive-detail-open-${item.id}`}>
                              <Eye className="h-3.5 w-3.5" /> Detay
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" disabled={!item.downloadable} onClick={() => downloadArchive(item)}>
                              <Download className="h-3.5 w-3.5" /> İndir
                            </Button>
                            {canMutateArchive && (item.status === "completed" || item.status === "failed") && (
                              <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-destructive hover:text-destructive" disabled={archiveActionLoading === item.id || item.lifecycle?.deletionLocked === true} onClick={() => setDeleteCandidate(item)}>
                                <Trash2 className="h-3.5 w-3.5" /> Sil
                              </Button>
                            )}
                            {canMutateArchive && item.status === "deleted" && (
                              <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" disabled={archiveActionLoading === item.id} onClick={() => restoreArchive(item)}>
                                <RotateCcw className="h-3.5 w-3.5" /> Geri al
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{archiveData ? `${archiveData.total} kayıt` : ""}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={archivePage <= 0 || archiveLoading} onClick={() => fetchArchive(Math.max(0, archivePage - 1))}>Önceki</Button>
              <Button variant="outline" size="sm" disabled={!archiveData?.hasNext || archiveLoading} onClick={() => fetchArchive(archivePage + 1)}>Sonraki</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <ArchiveDetailSheet
        item={detailArchive}
        detail={archiveDetail}
        loading={detailLoading}
        error={detailError}
        open={detailArchive !== null}
        canMutate={canMutateArchive}
        actionLoading={archiveActionLoading}
        onOpenChange={(open) => {
          if (!open) setDetailArchive(null);
        }}
        onRetry={() => setDetailRefreshKey((current) => current + 1)}
        onDownload={downloadArchive}
        onDelete={setDeleteCandidate}
        onRestore={restoreArchive}
        onRetryArchive={setRetryCandidate}
        onCopyHash={copyHash}
      />

      <AlertDialog open={retryCandidate !== null} onOpenChange={(open) => !open && setRetryCandidate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rapor yeniden denensin mi?</AlertDialogTitle>
            <AlertDialogDescription>
              Yeni rapor guncel veri ve rapor ayarlariyla olusturulur. Mevcut basarisiz kayit degismeden korunur.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Vazgec</AlertDialogCancel>
            <AlertDialogAction disabled={retryCandidate ? archiveActionLoading === retryCandidate.id : false} onClick={() => retryCandidate && retryArchive(retryCandidate)}>
              Yeniden Dene
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteCandidate !== null} onOpenChange={(open) => !open && setDeleteCandidate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Raporu arşivden kaldır</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteCandidate ? `${deleteCandidate.title} (${REPORT_TYPE_LABELS[deleteCandidate.reportType] ?? deleteCandidate.reportType}, ${new Date(deleteCandidate.generatedAt).toLocaleDateString("tr-TR")}) soft-delete durumuna alınacak. Grace süresi bitene kadar operasyonel purge yapılmadan geri alınabilir.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Vazgeç</AlertDialogCancel>
            <AlertDialogAction disabled={!deleteCandidate || archiveActionLoading === deleteCandidate.id} onClick={() => deleteCandidate && softDeleteArchive(deleteCandidate)}>
              Soft-delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Geçmiş Raporlar</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Yıl</TableHead>
                  <TableHead>Oluşturma Tarihi</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead className="text-right">İndir</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReports.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-10 text-muted-foreground">Henüz rapor oluşturulmadı</TableCell></TableRow>
                ) : (
                  [...filteredReports].reverse().map((r: ReportRecord) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.year} Yılı Raporu</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDateTime(r.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={
                          r.status === "complete" ? "bg-green-500/10 text-green-400 border-green-500/20" :
                          r.status === "error" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                          "bg-amber-500/10 text-amber-400 border-amber-500/20"
                        }>
                          {r.status === "complete" ? "Hazır" : r.status === "error" ? "Hata" : "İşleniyor"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {r.downloadUrl && (
                          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => handleDownload(r)}>
                            <Download className="h-3.5 w-3.5" /> HTML
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
