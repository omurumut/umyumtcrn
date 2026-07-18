import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCopy, Eye, Filter, History, ShieldCheck } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const ACTION_OPTIONS = [
  "auth.login.success",
  "auth.login.failure",
  "auth.login.rate_limited",
  "auth.logout",
  "security.access.denied",
  "user.create",
  "user.update",
  "user.delete",
  "consumption.create",
  "consumption.update",
  "consumption.delete",
  "consumption.import",
  "seu.assessment.create",
  "seu.assessment.update",
  "seu.assessment.delete",
  "seu.assessment.accept",
  "target.create",
  "target.update",
  "target.delete",
  "action.create",
  "action.update",
  "action.delete",
  "target.progress.update",
  "vap.create",
  "vap.update",
  "vap.delete",
  "seed.execute",
  "seed.reset",
  "mgm.sync",
  "mgm.import",
  "superadmin.bootstrap",
] as const;

const OUTCOME_OPTIONS = ["success", "failure", "denied", "partial"] as const;
const PAGE_SIZE_OPTIONS = ["25", "50", "100"] as const;
const REDACTED_KEY_PATTERN = /(password|hash|token|authorization|cookie|secret|api[_-]?key|database[_-]?url|connection|string|raw|file|stack|sql)/i;

type AuditJson = null | boolean | number | string | AuditJson[] | { [key: string]: AuditJson };

interface AuditEventRecord {
  id: number;
  occurredAt: string;
  requestId: string;
  actorUserId: number | null;
  actorRole: string | null;
  companyId: number | null;
  unitId: number | null;
  action: string;
  entityType: string;
  entityId: string | null;
  outcome: string;
  changes: AuditJson;
  metadata: AuditJson;
}

interface AuditEventsResponse {
  items: AuditEventRecord[];
  page: number;
  pageSize: number;
  total?: number;
  hasNext?: boolean;
}

interface CompanyRecord {
  id: number;
  name: string;
}

interface UnitRecord {
  id: number;
  name: string;
}

interface AuditFilters {
  dateFrom: string;
  dateTo: string;
  action: string;
  outcome: string;
  entityType: string;
  entityId: string;
  actorUserId: string;
  unitId: string;
  requestId: string;
}

const EMPTY_FILTERS: AuditFilters = {
  dateFrom: "",
  dateTo: "",
  action: "all",
  outcome: "all",
  entityType: "",
  entityId: "",
  actorUserId: "",
  unitId: "all",
  requestId: "",
};

const ACTION_LABELS: Record<string, string> = {
  "auth.login.success": "Giriş başarılı",
  "auth.login.failure": "Giriş başarısız",
  "auth.login.rate_limited": "Giriş limiti",
  "auth.logout": "Çıkış",
  "security.access.denied": "Erişim reddi",
  "user.create": "Kullanıcı oluşturma",
  "user.update": "Kullanıcı güncelleme",
  "user.delete": "Kullanıcı silme",
  "consumption.create": "Tüketim oluşturma",
  "consumption.update": "Tüketim güncelleme",
  "consumption.delete": "Tüketim silme",
  "consumption.import": "Tüketim içe aktarma",
  "seu.assessment.create": "ÖEK değerlendirme oluşturma",
  "seu.assessment.update": "ÖEK değerlendirme güncelleme",
  "seu.assessment.delete": "ÖEK değerlendirme silme",
  "seu.assessment.accept": "ÖEK kabul",
  "target.create": "Hedef oluşturma",
  "target.update": "Hedef güncelleme",
  "target.delete": "Hedef silme",
  "action.create": "Aksiyon oluşturma",
  "action.update": "Aksiyon güncelleme",
  "action.delete": "Aksiyon silme",
  "target.progress.update": "Hedef ilerleme",
  "vap.create": "VAP oluşturma",
  "vap.update": "VAP güncelleme",
  "vap.delete": "VAP silme",
  "seed.execute": "Seed çalıştırma",
  "seed.reset": "Seed reset",
  "mgm.sync": "MGM senkronizasyon",
  "mgm.import": "MGM içe aktarma",
  "superadmin.bootstrap": "Superadmin bootstrap",
};

const OUTCOME_LABELS: Record<string, string> = {
  success: "Başarılı",
  failure: "Başarısız",
  denied: "Reddedildi",
  partial: "Kısmi",
};

function isAdminRole(role: string | undefined) {
  return role === "admin" || role === "kontrol_admin" || role === "superadmin";
}

function isPositiveIntegerText(value: string) {
  return /^[1-9]\d*$/.test(value);
}

function dateRangeError(filters: AuditFilters) {
  if (filters.dateFrom && Number.isNaN(new Date(filters.dateFrom).getTime())) return "Başlangıç tarihi geçersiz.";
  if (filters.dateTo && Number.isNaN(new Date(filters.dateTo).getTime())) return "Bitiş tarihi geçersiz.";
  if (filters.dateFrom && filters.dateTo && new Date(filters.dateFrom) > new Date(filters.dateTo)) {
    return "Başlangıç tarihi bitiş tarihinden sonra olamaz.";
  }
  return null;
}

function queryError(filters: AuditFilters) {
  const numericFields = [
    ["actorUserId", "Aktör ID"],
    ["unitId", "Birim"],
  ] as const;
  for (const [field, label] of numericFields) {
    const value = filters[field];
    if (value !== "" && value !== "all" && !isPositiveIntegerText(value)) return `${label} pozitif tam sayı olmalı.`;
  }
  return dateRangeError(filters);
}

async function fetchJson<T>(token: string | null, url: string): Promise<T> {
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error ?? `HTTP ${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return response.json() as Promise<T>;
}

function buildAuditQuery(
  filters: AuditFilters,
  page: number,
  pageSize: string,
  role: string | undefined,
  superadminScope: string,
  selectedCompanyId: string,
) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", pageSize);
  if (role === "superadmin") {
    if (superadminScope === "platform") params.set("scope", "platform");
    if (superadminScope === "company") params.set("companyId", selectedCompanyId);
  }
  if (filters.dateFrom) params.set("dateFrom", `${filters.dateFrom}T00:00:00.000Z`);
  if (filters.dateTo) params.set("dateTo", `${filters.dateTo}T23:59:59.999Z`);
  if (filters.action !== "all") params.set("action", filters.action);
  if (filters.outcome !== "all") params.set("outcome", filters.outcome);
  if (filters.entityType.trim()) params.set("entityType", filters.entityType.trim());
  if (filters.entityId.trim()) params.set("entityId", filters.entityId.trim());
  if (filters.actorUserId.trim()) params.set("actorUserId", filters.actorUserId.trim());
  if (filters.unitId !== "all") params.set("unitId", filters.unitId);
  if (filters.requestId.trim()) params.set("requestId", filters.requestId.trim());
  return params.toString();
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("tr-TR", {
    dateStyle: "short",
    timeStyle: "medium",
  });
}

function outcomeClassName(outcome: string) {
  if (outcome === "success") return "border-emerald-500/30 bg-emerald-500/15 text-emerald-300";
  if (outcome === "denied") return "border-amber-500/30 bg-amber-500/15 text-amber-300";
  if (outcome === "partial") return "border-blue-500/30 bg-blue-500/15 text-blue-300";
  return "border-red-500/30 bg-red-500/15 text-red-300";
}

function sanitizeForDisplay(value: AuditJson, depth = 0): AuditJson {
  if (value === null || typeof value !== "object") return value;
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeForDisplay(item, depth + 1));
  const output: Record<string, AuditJson> = {};
  for (const [key, raw] of Object.entries(value).slice(0, 40)) {
    output[key] = REDACTED_KEY_PATTERN.test(key) ? "[redacted]" : sanitizeForDisplay(raw, depth + 1);
  }
  return output;
}

function renderJson(value: AuditJson) {
  const sanitized = sanitizeForDisplay(value);
  const text = JSON.stringify(sanitized, null, 2) ?? "null";
  return text.length > 6000 ? `${text.slice(0, 6000)}\n...` : text;
}

function ChangesView({ value }: { value: AuditJson }) {
  const objectValue = value && !Array.isArray(value) && typeof value === "object" ? value as Record<string, AuditJson> : null;
  const entries = objectValue
    ? Object.entries(objectValue).filter(([, raw]) => raw && typeof raw === "object" && !Array.isArray(raw) && "before" in raw && "after" in raw)
    : [];

  if (entries.length === 0) {
    return (
      <pre data-testid="audit-detail-changes-json" className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
        {renderJson(value)}
      </pre>
    );
  }

  return (
    <div data-testid="audit-detail-changes-table" className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Alan</TableHead>
            <TableHead>Önce</TableHead>
            <TableHead>Sonra</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map(([key, raw]) => {
            const change = raw as { before?: AuditJson; after?: AuditJson };
            return (
              <TableRow key={key}>
                <TableCell className="font-medium">{key}</TableCell>
                <TableCell><code className="break-all text-xs">{renderJson(change.before ?? null)}</code></TableCell>
                <TableCell><code className="break-all text-xs">{renderJson(change.after ?? null)}</code></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default function AuditEvents() {
  const { token, user } = useAuth();
  const isSuperadmin = user?.role === "superadmin";
  const canViewAudit = isAdminRole(user?.role);
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState("50");
  const [superadminScope, setSuperadminScope] = useState("none");
  const [selectedCompanyId, setSelectedCompanyId] = useState("none");
  const [selectedEvent, setSelectedEvent] = useState<AuditEventRecord | null>(null);
  const [copyState, setCopyState] = useState("");

  const validationError = queryError(filters);
  const superadminReady = !isSuperadmin || superadminScope === "platform" || (superadminScope === "company" && selectedCompanyId !== "none");
  const queryEnabled = Boolean(token && canViewAudit && !validationError && superadminReady);

  const companiesQuery = useQuery<CompanyRecord[]>({
    queryKey: ["audit-companies"],
    queryFn: () => fetchJson<CompanyRecord[]>(token, "/api/companies"),
    enabled: Boolean(token && isSuperadmin),
  });

  const unitsQuery = useQuery<UnitRecord[]>({
    queryKey: ["audit-units", isSuperadmin, selectedCompanyId],
    queryFn: () => {
      const query = isSuperadmin && selectedCompanyId !== "none" ? `?companyId=${selectedCompanyId}` : "";
      return fetchJson<UnitRecord[]>(token, `/api/units${query}`);
    },
    enabled: Boolean(token && canViewAudit && (!isSuperadmin || (superadminScope === "company" && selectedCompanyId !== "none"))),
  });

  const auditQueryString = useMemo(
    () => buildAuditQuery(filters, page, pageSize, user?.role, superadminScope, selectedCompanyId),
    [filters, page, pageSize, selectedCompanyId, superadminScope, user?.role],
  );

  const auditQuery = useQuery<AuditEventsResponse>({
    queryKey: ["audit-events", auditQueryString],
    queryFn: () => fetchJson<AuditEventsResponse>(token, `/api/audit-events?${auditQueryString}`),
    enabled: queryEnabled,
  });

  const items = auditQuery.data?.items ?? [];
  const total = auditQuery.data?.total;
  const hasNext = auditQuery.data?.hasNext ?? items.length === Number(pageSize);

  useEffect(() => {
    setPage(1);
  }, [filters, pageSize, selectedCompanyId, superadminScope]);

  function updateFilter<K extends keyof AuditFilters>(key: K, value: AuditFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  }

  async function copyRequestId(requestId: string) {
    try {
      await navigator.clipboard.writeText(requestId);
      setCopyState("Kopyalandı");
      window.setTimeout(() => setCopyState(""), 1500);
    } catch {
      setCopyState("Kopyalama desteklenmiyor");
    }
  }

  if (!canViewAudit) {
    return (
      <Card className="rounded-lg border-destructive/30 bg-destructive/5">
        <CardContent className="p-6 text-sm text-destructive">Bu sayfaya erişim yetkiniz yok.</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="audit-page">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-teal-600/15 p-2 text-teal-300">
            <History className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">İşlem Geçmişi</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Kritik yönetim işlemlerini tenant kapsamı, aktör, sonuç ve istek kimliği ile izleyin.
            </p>
          </div>
        </div>
        <Badge variant="outline" className="w-fit gap-1 text-xs">
          <ShieldCheck className="h-3.5 w-3.5" />
          Salt okunur audit
        </Badge>
      </div>

      {isSuperadmin && (
        <Card data-testid="audit-superadmin-context" className="rounded-lg">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Superadmin audit kapsamı</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Kapsam</Label>
              <Select value={superadminScope} onValueChange={(value) => { setSuperadminScope(value); setSelectedCompanyId("none"); updateFilter("unitId", "all"); }}>
                <SelectTrigger data-testid="audit-scope-select" className="bg-background">
                  <SelectValue placeholder="Kapsam seçin" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="none">Kapsam seçin</SelectItem>
                  <SelectItem value="company">Firma audit kayıtları</SelectItem>
                  <SelectItem value="platform">Platform audit kayıtları</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {superadminScope === "company" && (
              <div className="space-y-1.5">
                <Label>Firma</Label>
                <Select value={selectedCompanyId} onValueChange={(value) => { setSelectedCompanyId(value); updateFilter("unitId", "all"); }}>
                  <SelectTrigger data-testid="audit-company-select" className="bg-background">
                    <SelectValue placeholder="Firma seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Firma seçin</SelectItem>
                    {(companiesQuery.data ?? []).map((company) => (
                      <SelectItem key={company.id} value={String(company.id)}>{company.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="rounded-lg">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="h-4 w-4 text-teal-400" />
            Filtreler
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Başlangıç</Label>
              <Input data-testid="audit-date-from" type="date" value={filters.dateFrom} onChange={(event) => updateFilter("dateFrom", event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Bitiş</Label>
              <Input data-testid="audit-date-to" type="date" value={filters.dateTo} onChange={(event) => updateFilter("dateTo", event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Action</Label>
              <Select value={filters.action} onValueChange={(value) => updateFilter("action", value)}>
                <SelectTrigger data-testid="audit-action-filter" className="bg-background"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="all">Tüm action değerleri</SelectItem>
                  {ACTION_OPTIONS.map((action) => <SelectItem key={action} value={action}>{ACTION_LABELS[action] ?? action}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Sonuç</Label>
              <Select value={filters.outcome} onValueChange={(value) => updateFilter("outcome", value)}>
                <SelectTrigger data-testid="audit-outcome-filter" className="bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tüm sonuçlar</SelectItem>
                  {OUTCOME_OPTIONS.map((outcome) => <SelectItem key={outcome} value={outcome}>{OUTCOME_LABELS[outcome]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Entity type</Label>
              <Input data-testid="audit-entity-type-filter" value={filters.entityType} onChange={(event) => updateFilter("entityType", event.target.value)} placeholder="örn. target" />
            </div>
            <div className="space-y-1.5">
              <Label>Entity ID</Label>
              <Input data-testid="audit-entity-id-filter" value={filters.entityId} onChange={(event) => updateFilter("entityId", event.target.value)} placeholder="örn. 42" />
            </div>
            <div className="space-y-1.5">
              <Label>Aktör ID</Label>
              <Input data-testid="audit-actor-filter" inputMode="numeric" value={filters.actorUserId} onChange={(event) => updateFilter("actorUserId", event.target.value)} placeholder="Kullanıcı ID" />
            </div>
            <div className="space-y-1.5">
              <Label>Request ID</Label>
              <Input data-testid="audit-request-filter" value={filters.requestId} onChange={(event) => updateFilter("requestId", event.target.value)} placeholder="İstek kimliği" />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Birim</Label>
              <Select
                value={filters.unitId}
                onValueChange={(value) => updateFilter("unitId", value)}
                disabled={isSuperadmin && superadminScope !== "company"}
              >
                <SelectTrigger data-testid="audit-unit-filter" className="bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tüm birimler</SelectItem>
                  {(unitsQuery.data ?? []).map((unit) => <SelectItem key={unit.id} value={String(unit.id)}>{unit.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Sayfa boyutu</Label>
              <Select value={pageSize} onValueChange={setPageSize}>
                <SelectTrigger data-testid="audit-page-size" className="bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2 md:col-span-2">
              <Button data-testid="audit-clear-filters" type="button" variant="outline" onClick={clearFilters}>Filtreleri temizle</Button>
              {auditQuery.isFetching && <span className="text-xs text-muted-foreground">Güncelleniyor...</span>}
            </div>
          </div>

          {validationError && <p data-testid="audit-validation-error" className="text-sm text-destructive">{validationError}</p>}
        </CardContent>
      </Card>

      {isSuperadmin && !superadminReady ? (
        <Card className="rounded-lg">
          <CardContent data-testid="audit-context-required" className="p-8 text-center text-sm text-muted-foreground">
            Audit kayıtlarını görüntülemek için firma veya platform kapsamı seçin.
          </CardContent>
        </Card>
      ) : auditQuery.isLoading ? (
        <div className="space-y-3" data-testid="audit-loading">
          {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-14 rounded-lg" />)}
        </div>
      ) : auditQuery.error ? (
        <Card className="rounded-lg border-destructive/30 bg-destructive/5">
          <CardContent data-testid="audit-error" className="p-6 text-sm text-destructive">
            Audit kayıtları yüklenemedi: {(auditQuery.error as Error).message}
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card className="rounded-lg">
          <CardContent data-testid="audit-empty" className="p-8 text-center text-sm text-muted-foreground">
            Seçili filtrelere uygun audit kaydı bulunamadı.
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-lg">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table data-testid="audit-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Zaman</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Sonuç</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Aktör</TableHead>
                    <TableHead>Rol</TableHead>
                    <TableHead>Birim</TableHead>
                    <TableHead>Request ID</TableHead>
                    <TableHead className="text-right">Detay</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((event) => (
                    <TableRow key={event.id} data-testid="audit-row">
                      <TableCell className="whitespace-nowrap text-xs">{formatDateTime(event.occurredAt)}</TableCell>
                      <TableCell>
                        <div className="font-medium">{ACTION_LABELS[event.action] ?? event.action}</div>
                        <div className="text-xs text-muted-foreground">{event.action}</div>
                      </TableCell>
                      <TableCell>
                        <Badge className={`${outcomeClassName(event.outcome)} text-xs`}>{OUTCOME_LABELS[event.outcome] ?? event.outcome}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div>{event.entityType}</div>
                        <div className="text-muted-foreground">{event.entityId ?? "—"}</div>
                      </TableCell>
                      <TableCell className="text-xs">{event.actorUserId ? `#${event.actorUserId}` : "Sistem"}</TableCell>
                      <TableCell className="text-xs">{event.actorRole ?? "—"}</TableCell>
                      <TableCell className="text-xs">{event.unitId ? `#${event.unitId}` : "—"}</TableCell>
                      <TableCell className="max-w-48 truncate font-mono text-xs" title={event.requestId}>{event.requestId}</TableCell>
                      <TableCell className="text-right">
                        <Button data-testid="audit-detail-button" size="sm" variant="ghost" onClick={() => setSelectedEvent(event)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p data-testid="audit-pagination-summary" className="text-sm text-muted-foreground">
          Sayfa {page}{typeof total === "number" ? ` — toplam ${total.toLocaleString("tr-TR")} kayıt` : ""}
        </p>
        <div className="flex gap-2">
          <Button data-testid="audit-prev-page" variant="outline" disabled={page <= 1 || auditQuery.isFetching} onClick={() => setPage((current) => Math.max(1, current - 1))}>Önceki</Button>
          <Button data-testid="audit-next-page" variant="outline" disabled={!hasNext || auditQuery.isFetching} onClick={() => setPage((current) => current + 1)}>Sonraki</Button>
        </div>
      </div>

      <Dialog open={selectedEvent !== null} onOpenChange={(open) => { if (!open) setSelectedEvent(null); }}>
        <DialogContent data-testid="audit-detail-dialog" className="max-h-[90vh] max-w-4xl overflow-y-auto bg-card">
          {selectedEvent && (
            <>
              <DialogHeader>
                <DialogTitle>Audit kaydı #{selectedEvent.id}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-3 text-sm md:grid-cols-2">
                <div><span className="text-muted-foreground">Tarih:</span> {formatDateTime(selectedEvent.occurredAt)}</div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Request ID:</span>
                  <code data-testid="audit-detail-request-id" className="break-all rounded bg-muted px-1.5 py-0.5 text-xs">{selectedEvent.requestId}</code>
                  <Button data-testid="audit-copy-request" type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyRequestId(selectedEvent.requestId)}>
                    <ClipboardCopy className="h-3.5 w-3.5" />
                  </Button>
                  {copyState && <span data-testid="audit-copy-state" className="text-xs text-teal-300">{copyState}</span>}
                </div>
                <div><span className="text-muted-foreground">Aktör:</span> {selectedEvent.actorUserId ? `#${selectedEvent.actorUserId}` : "Sistem"}</div>
                <div><span className="text-muted-foreground">Rol:</span> {selectedEvent.actorRole ?? "—"}</div>
                <div><span className="text-muted-foreground">Firma:</span> {selectedEvent.companyId ?? "Platform"}</div>
                <div><span className="text-muted-foreground">Birim:</span> {selectedEvent.unitId ?? "—"}</div>
                <div><span className="text-muted-foreground">Action:</span> {selectedEvent.action}</div>
                <div><span className="text-muted-foreground">Sonuç:</span> {OUTCOME_LABELS[selectedEvent.outcome] ?? selectedEvent.outcome}</div>
                <div><span className="text-muted-foreground">Entity:</span> {selectedEvent.entityType} / {selectedEvent.entityId ?? "—"}</div>
              </div>
              <div className="space-y-2">
                <h3 className="font-medium">Değişiklikler</h3>
                <ChangesView value={selectedEvent.changes} />
              </div>
              <div className="space-y-2">
                <h3 className="font-medium">Metadata</h3>
                <pre data-testid="audit-detail-metadata" className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
                  {renderJson(selectedEvent.metadata)}
                </pre>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
