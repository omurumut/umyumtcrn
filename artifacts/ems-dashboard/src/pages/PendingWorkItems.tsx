import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CircleAlert,
  Filter,
  Info,
  ListChecks,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useUnit } from "@/context/UnitContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

type PendingWorkItemSeverity = "info" | "warning" | "critical";

interface PendingWorkItem {
  id: string;
  type: string;
  severity: PendingWorkItemSeverity;
  title: string;
  description: string;
  sourceModule: string;
  sourceRecordId: number | null;
  unitId: number | null;
  unitName: string | null;
  dueDate: string | null;
  actionUrl: string | null;
}

const SEVERITY_OPTIONS = [
  { value: "all", label: "Tümü" },
  { value: "critical", label: "Kritik" },
  { value: "warning", label: "Uyarı" },
  { value: "info", label: "Bilgi" },
] as const;

const SEVERITY_CONFIG: Record<PendingWorkItemSeverity, { label: string; className: string; icon: typeof AlertTriangle }> = {
  critical: {
    label: "Kritik",
    className: "bg-red-500/20 text-red-400 border-red-500/30",
    icon: AlertTriangle,
  },
  warning: {
    label: "Uyarı",
    className: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    icon: CircleAlert,
  },
  info: {
    label: "Bilgi",
    className: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    icon: Info,
  },
};

async function fetchPendingWorkItems(token: string | null, unitId: number | null, isAdmin: boolean) {
  const params = new URLSearchParams();
  if (isAdmin && unitId !== null) params.set("unitId", String(unitId));
  const query = params.toString();
  const res = await fetch(`/api/pending-work-items${query ? `?${query}` : ""}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) {
    const error = new Error(`HTTP ${res.status}`) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }

  return res.json() as Promise<PendingWorkItem[]>;
}

function formatDate(date: string | null) {
  if (!date) return null;
  return new Date(`${date}T00:00:00`).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function SummaryCard({
  title,
  value,
  tone,
}: {
  title: string;
  value: number;
  tone: "total" | PendingWorkItemSeverity;
}) {
  const color =
    tone === "critical"
      ? "text-red-400"
      : tone === "warning"
        ? "text-amber-300"
        : tone === "info"
          ? "text-blue-300"
          : "text-foreground";

  return (
    <Card className="rounded-lg">
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
        <p className={`mt-2 text-3xl font-bold ${color}`}>{value.toLocaleString("tr-TR")}</p>
      </CardContent>
    </Card>
  );
}

function SeverityBadge({ severity }: { severity: PendingWorkItemSeverity }) {
  const config = SEVERITY_CONFIG[severity];
  const Icon = config.icon;
  return (
    <Badge className={`${config.className} text-xs`}>
      <Icon className="mr-1 h-3 w-3" />
      {config.label}
    </Badge>
  );
}

export default function PendingWorkItems() {
  const { token, user } = useAuth();
  const { unitId } = useUnit();
  const canUseUnitFilter = user?.role === "admin" || user?.role === "kontrol_admin";
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [moduleFilter, setModuleFilter] = useState<string>("all");

  const { data, isLoading, isFetching, error } = useQuery<PendingWorkItem[]>({
    queryKey: ["pending-work-items", unitId, canUseUnitFilter],
    queryFn: () => fetchPendingWorkItems(token, unitId, canUseUnitFilter),
    enabled: token !== null,
  });

  const items = data ?? [];
  const modules = useMemo(
    () => Array.from(new Set(items.map((item) => item.sourceModule))).sort((a, b) => a.localeCompare(b, "tr")),
    [items],
  );

  const filteredItems = useMemo(
    () => items.filter((item) => {
      if (severityFilter !== "all" && item.severity !== severityFilter) return false;
      if (moduleFilter !== "all" && item.sourceModule !== moduleFilter) return false;
      return true;
    }),
    [items, severityFilter, moduleFilter],
  );

  const totals = useMemo(
    () => ({
      total: items.length,
      critical: items.filter((item) => item.severity === "critical").length,
      warning: items.filter((item) => item.severity === "warning").length,
      info: items.filter((item) => item.severity === "info").length,
    }),
    [items],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Bekleyen İşler</h1>
          <p className="mt-1 text-sm text-muted-foreground">Aksiyon planları ve tüketim dönemleri için açık uyarılar</p>
        </div>
        {isFetching && !isLoading && (
          <Badge variant="outline" className="w-fit text-xs">
            Güncelleniyor
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryCard title="Toplam" value={totals.total} tone="total" />
        <SummaryCard title="Kritik" value={totals.critical} tone="critical" />
        <SummaryCard title="Uyarı" value={totals.warning} tone="warning" />
        <SummaryCard title="Bilgi" value={totals.info} tone="info" />
      </div>

      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Filter className="h-4 w-4" />
          Filtreler
        </div>
        <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="bg-background">
              <SelectValue placeholder="Öncelik" />
            </SelectTrigger>
            <SelectContent>
              {SEVERITY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger className="bg-background">
              <SelectValue placeholder="Modül" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tümü</SelectItem>
              {modules.map((module) => (
                <SelectItem key={module} value={module}>
                  {module}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-32 rounded-lg" />
          ))}
        </div>
      ) : error ? (
        <Card className="rounded-lg border-destructive/30 bg-destructive/5">
          <CardContent className="p-6 text-sm text-destructive">Bekleyen işler yüklenemedi.</CardContent>
        </Card>
      ) : filteredItems.length === 0 ? (
        <Card className="rounded-lg">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <div className="rounded-full bg-teal-600/15 p-3">
              <ListChecks className="h-6 w-6 text-teal-400" />
            </div>
            <div>
              <p className="font-medium text-foreground">Kayıt bulunmuyor</p>
              <p className="mt-1 text-sm text-muted-foreground">Seçili filtrelere uygun bekleyen iş yok.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => (
            <Card key={item.id} className="rounded-lg">
              <CardHeader className="p-4 pb-2">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={item.severity} />
                      <Badge variant="outline" className="text-xs">{item.sourceModule}</Badge>
                    </div>
                    <CardTitle className="text-base leading-snug">{item.title}</CardTitle>
                  </div>
                  {item.actionUrl && (
                    <Button asChild variant="outline" size="sm" className="w-fit shrink-0">
                      <Link href={item.actionUrl}>
                        İlgili ekrana git
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3 p-4 pt-0">
                <p className="text-sm text-muted-foreground">{item.description}</p>
                <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                  <div>
                    <span className="block uppercase tracking-wider">Modül</span>
                    <span className="mt-0.5 block font-medium text-foreground">{item.sourceModule}</span>
                  </div>
                  <div>
                    <span className="block uppercase tracking-wider">Birim</span>
                    <span className="mt-0.5 block font-medium text-foreground">{item.unitName ?? "Şirket geneli"}</span>
                  </div>
                  {item.dueDate && (
                    <div>
                      <span className="block uppercase tracking-wider">Termin</span>
                      <span className="mt-0.5 block font-medium text-foreground">{formatDate(item.dueDate)}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
