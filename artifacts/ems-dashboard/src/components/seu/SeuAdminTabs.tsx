import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronRight, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useListUnits, getListUnitsQueryKey } from "@workspace/api-client-react";
import SeuAnalysisTab from "./SeuAnalysisTab";
import SeuAssessmentList from "./SeuAssessmentList";
import SeuDecisionItemsList from "./SeuDecisionItemsList";
import SeuMethodTab from "./SeuMethodTab";

const LEVEL_LABELS: Record<string, string> = {
  energyUseGroup: "Enerji Kullanım Grubu",
  meter: "Sayaç",
  subUnit: "Alt Birim",
  energySource: "Enerji Kaynağı",
  unit: "Birim",
};

const DECISION_LABEL: Record<string, string> = {
  accepted_as_seu: "ÖEK",
  not_seu: "ÖEK Dışı",
  monitor: "İzle",
};

const DECISION_STYLE: Record<string, string> = {
  accepted_as_seu: "border-teal-500/30 text-teal-400 bg-teal-500/10",
  not_seu: "border-red-500/30 text-red-400 bg-red-500/10",
  monitor: "border-amber-500/30 text-amber-400 bg-amber-500/10",
};

const PRIORITY_COLORS: Record<number, string> = {
  1: "bg-red-500/20 text-red-400 border-red-500/30",
  2: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  3: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  4: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

const currentYear = new Date().getFullYear();
const YEARS = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3];

// ── Unit detail modal ──────────────────────────────────────
function UnitDetailModal({ unitId, unitName, year, token, onClose }: {
  unitId: number; unitName: string; year: number; token: string; onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["seu-admin-unit-detail", unitId, year],
    queryFn: async () => {
      const res = await fetch(`/api/seu/admin/unit-detail/${unitId}?year=${year}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Yüklenemedi");
      return res.json() as Promise<{ unitId: number; year: number; analysisItems: any[]; manualItems: any[] }>;
    },
    enabled: !!unitId,
  });

  const allItems = [...(data?.analysisItems ?? []), ...(data?.manualItems ?? [])];

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            {unitName}
            <span className="ml-2 text-sm font-normal text-muted-foreground">· {year} Yılı ÖEK Detayı</span>
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2 py-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : allItems.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-sm">
            Bu birim için {year} yılına ait resmi ÖEK kaydı bulunamadı.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border mt-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left p-2 pl-3 font-medium text-muted-foreground">Enerji Kullanım Grubu / Ad</th>
                  <th className="text-left p-2 font-medium text-muted-foreground">Kaynak</th>
                  <th className="text-right p-2 font-medium text-muted-foreground">TEP</th>
                  <th className="text-right p-2 font-medium text-muted-foreground">Pay %</th>
                  <th className="text-center p-2 font-medium text-muted-foreground">Fırsat</th>
                  <th className="text-center p-2 font-medium text-muted-foreground">Öncelik</th>
                  <th className="text-center p-2 font-medium text-muted-foreground">Karar</th>
                  <th className="text-left p-2 font-medium text-muted-foreground">Gerekçe</th>
                  <th className="text-right p-2 pr-3 font-medium text-muted-foreground">Hedef %</th>
                </tr>
              </thead>
              <tbody>
                {allItems.map((item: any, i: number) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="p-2 pl-3 font-medium max-w-[200px] truncate" title={item.name}>{item.name}</td>
                    <td className="p-2">
                      {item.source === "manual" ? (
                        <Badge variant="outline" className="text-xs border-violet-500/30 text-violet-400 bg-violet-500/10">Manuel Kayıt</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs border-teal-500/30 text-teal-400 bg-teal-500/10">Analizden Oluşturuldu</Badge>
                      )}
                    </td>
                    <td className="p-2 text-right font-mono">{Number(item.energyTep).toFixed(4)}</td>
                    <td className="p-2 text-right font-mono font-medium">{Number(item.consumptionSharePercent).toFixed(1)}%</td>
                    <td className="p-2 text-center">
                      {item.source === "manual" ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className={`px-1.5 py-0.5 rounded text-xs border ${item.hasOpportunity ? "border-green-500/30 text-green-400 bg-green-500/10" : "border-border text-muted-foreground bg-muted/20"}`}>
                          {item.hasOpportunity ? "Var" : "Yok"}
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-center">
                      {item.priorityResult != null ? (
                        <Badge variant="outline" className={`text-xs ${PRIORITY_COLORS[item.priorityResult] ?? ""}`}>{item.priorityResult}</Badge>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-2 text-center">
                      {item.userDecision ? (
                        <Badge variant="outline" className={`text-xs ${DECISION_STYLE[item.userDecision] ?? ""}`}>
                          {DECISION_LABEL[item.userDecision] ?? item.userDecision}
                        </Badge>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-2 max-w-[140px] truncate text-muted-foreground" title={item.decisionReason ?? ""}>
                      {item.decisionReason || "—"}
                    </td>
                    <td className="p-2 pr-3 text-right text-muted-foreground">
                      {item.targetReductionPercent != null ? `%${item.targetReductionPercent}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Admin unit comparison summary ─────────────────────────
function AdminSummaryTab() {
  const { token } = useAuth();
  const [year, setYear] = useState(currentYear);
  const [recordType, setRecordType] = useState("all");
  const [detailUnit, setDetailUnit] = useState<{ id: number; name: string } | null>(null);
  const [sortBy, setSortBy] = useState<"tep" | "seu" | "share">("tep");

  const { data, isLoading } = useQuery({
    queryKey: ["seu-admin-unit-summary", year, recordType],
    queryFn: async () => {
      const res = await fetch(`/api/seu/admin/unit-summary?year=${year}&recordType=${recordType}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Yüklenemedi");
      return res.json() as Promise<{
        year: number;
        companyTotalTep: number;
        units: Array<{
          unitId: number;
          unitName: string;
          unitTotalTep: number;
          companySharePercent: number;
          hasOfficialAssessment: boolean;
          totalItems: number;
          seuCount: number;
          monitorCount: number;
          notSeuCount: number;
          manualCount: number;
          topGroupName: string | null;
          topGroupShare: number;
          lastUpdatedAt: string | null;
          assessmentCount: number;
        }>;
      }>;
    },
    enabled: !!token,
  });

  const units = data?.units ?? [];
  const sorted = [...units].sort((a, b) => {
    if (sortBy === "tep") return b.unitTotalTep - a.unitTotalTep;
    if (sortBy === "seu") return b.seuCount - a.seuCount;
    return b.companySharePercent - a.companySharePercent;
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="space-y-1">
          <Label className="text-xs">Yıl</Label>
          <Select value={String(year)} onValueChange={v => setYear(parseInt(v))}>
            <SelectTrigger className="h-8 text-xs w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Kayıt Türü</Label>
          <Select value={recordType} onValueChange={setRecordType}>
            <SelectTrigger className="h-8 text-xs w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tümü</SelectItem>
              <SelectItem value="unit_official">Resmi Kullanıcı Kayıtları</SelectItem>
              <SelectItem value="admin_review">Admin Kontrol Analizleri</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Sıralama</Label>
          <Select value={sortBy} onValueChange={v => setSortBy(v as any)}>
            <SelectTrigger className="h-8 text-xs w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tep">Yıllık TEP</SelectItem>
              <SelectItem value="seu">ÖEK Sayısı</SelectItem>
              <SelectItem value="share">Firma Payı %</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {data && (
          <div className="pt-4 text-xs text-muted-foreground">
            Firma toplam: <span className="font-medium text-foreground">{data.companyTotalTep.toFixed(2)} TEP</span>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : sorted.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center text-muted-foreground">
            <p>Bu yıl için ÖEK değerlendirmesi bulunamadı.</p>
            <p className="text-sm mt-1">Birim kullanıcıları analiz tamamlayıp kaydettiğinde burada görünür.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left p-2 pl-3 font-medium text-muted-foreground whitespace-nowrap">Birim Adı</th>
                <th className="text-right p-2 font-medium text-muted-foreground whitespace-nowrap">Yıllık TEP</th>
                <th className="text-right p-2 font-medium text-muted-foreground whitespace-nowrap">Firma Payı %</th>
                <th className="text-center p-2 font-medium text-muted-foreground whitespace-nowrap">Resmi Değ.</th>
                <th className="text-right p-2 font-medium text-muted-foreground whitespace-nowrap">Toplam Kalem</th>
                <th className="text-right p-2 font-medium text-muted-foreground whitespace-nowrap">ÖEK</th>
                <th className="text-right p-2 font-medium text-muted-foreground whitespace-nowrap">İzleme</th>
                <th className="text-right p-2 font-medium text-muted-foreground whitespace-nowrap">ÖEK Dışı</th>
                <th className="text-right p-2 font-medium text-muted-foreground whitespace-nowrap">Manuel</th>
                <th className="text-left p-2 font-medium text-muted-foreground whitespace-nowrap">En Yüksek TEP Grubu</th>
                <th className="text-right p-2 font-medium text-muted-foreground whitespace-nowrap">Pay %</th>
                <th className="text-left p-2 font-medium text-muted-foreground whitespace-nowrap">Son Güncelleme</th>
                <th className="text-center p-2 pr-3 font-medium text-muted-foreground whitespace-nowrap">Detay</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(unit => (
                <tr key={unit.unitId} className="border-b border-border/50 hover:bg-muted/20 cursor-pointer" onClick={() => setDetailUnit({ id: unit.unitId, name: unit.unitName })}>
                  <td className="p-2 pl-3 font-medium">{unit.unitName}</td>
                  <td className="p-2 text-right font-mono text-teal-400 font-medium">
                    {unit.unitTotalTep > 0 ? unit.unitTotalTep.toFixed(2) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="p-2 text-right">
                    {unit.companySharePercent > 0 ? (
                      <span className="font-medium">{unit.companySharePercent.toFixed(1)}%</span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="p-2 text-center">
                    {unit.hasOfficialAssessment ? (
                      <CheckCircle2 className="h-4 w-4 text-green-400 inline" />
                    ) : (
                      <XCircle className="h-4 w-4 text-muted-foreground/50 inline" />
                    )}
                  </td>
                  <td className="p-2 text-right text-muted-foreground">{unit.totalItems || "—"}</td>
                  <td className="p-2 text-right">
                    {unit.seuCount > 0 ? <span className="text-teal-400 font-medium">{unit.seuCount}</span> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="p-2 text-right">
                    {unit.monitorCount > 0 ? <span className="text-amber-400 font-medium">{unit.monitorCount}</span> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="p-2 text-right">
                    {unit.notSeuCount > 0 ? <span className="text-red-400 font-medium">{unit.notSeuCount}</span> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="p-2 text-right">
                    {unit.manualCount > 0 ? <span className="text-violet-400 font-medium">{unit.manualCount}</span> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="p-2 max-w-[160px] truncate text-muted-foreground" title={unit.topGroupName ?? ""}>
                    {unit.topGroupName ?? "—"}
                  </td>
                  <td className="p-2 text-right text-muted-foreground">
                    {unit.topGroupShare > 0 ? `${unit.topGroupShare.toFixed(1)}%` : "—"}
                  </td>
                  <td className="p-2 text-muted-foreground whitespace-nowrap">
                    {unit.lastUpdatedAt ? new Date(unit.lastUpdatedAt).toLocaleDateString("tr-TR") : "—"}
                  </td>
                  <td className="p-2 pr-3 text-center" onClick={e => { e.stopPropagation(); setDetailUnit({ id: unit.unitId, name: unit.unitName }); }}>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs gap-1">
                      <ChevronRight className="h-3 w-3" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      {sorted.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap pt-1">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
            <span>Resmi değerlendirme mevcut</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-teal-500/20 border border-teal-500/30 inline-block" />
            <span>ÖEK sayısı</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-violet-500/20 border border-violet-500/30 inline-block" />
            <span>Manuel kayıt sayısı</span>
          </div>
          <span>· Satıra tıklayarak birim detayını açabilirsiniz</span>
        </div>
      )}

      {detailUnit && (
        <UnitDetailModal
          unitId={detailUnit.id}
          unitName={detailUnit.name}
          year={year}
          token={token ?? ""}
          onClose={() => setDetailUnit(null)}
        />
      )}
    </div>
  );
}

// ── Admin Control Analysis history ─────────────────────────
function AdminAnalysisTab() {
  const [unitFilter, setUnitFilter] = useState<number | null>(null);
  const { data: allUnits } = useListUnits({}, { query: { queryKey: getListUnitsQueryKey({}) } });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Birim Filtresi</Label>
          <Select value={unitFilter ? String(unitFilter) : "all"} onValueChange={v => setUnitFilter(v === "all" ? null : parseInt(v))}>
            <SelectTrigger className="h-8 text-xs w-52">
              <SelectValue placeholder="Tüm Birimler" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm Birimler</SelectItem>
              {(allUnits ?? []).map((u: any) => (
                <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-2 p-3 rounded-md border border-violet-500/20 bg-violet-500/5 text-xs text-violet-300">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        Bu sekmede yapılan analizler admin_review olarak kaydedilir ve resmi birim kayıtlarını etkilemez.
      </div>
      {/* Admin analysis history */}
      <SeuAssessmentList
        unitIdFilter={unitFilter}
        recordTypeFilter="admin_review"
        showAllTypes={true}
      />
      {/* New analysis */}
      <div className="pt-2">
        <SeuAnalysisTab isAdminMode={true} adminRecordType="admin_review" />
      </div>
    </div>
  );
}

export default function SeuAdminTabs() {
  const [unitFilter, setUnitFilter] = useState<number | null>(null);
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "superadmin";
  const { data: allUnits } = useListUnits({}, { query: { queryKey: getListUnitsQueryKey({}) } });

  return (
    <Tabs defaultValue="records">
      <TabsList className="mb-4">
        <TabsTrigger value="records">Birim ÖEK Kayıtları</TabsTrigger>
        <TabsTrigger value="analysis">Admin Kontrol Analizi</TabsTrigger>
        <TabsTrigger value="summary">Tüm Birimler Özeti</TabsTrigger>
        <TabsTrigger value="method">Metot</TabsTrigger>
      </TabsList>

      <TabsContent value="records">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Birim</Label>
              <Select value={unitFilter ? String(unitFilter) : "all"} onValueChange={v => setUnitFilter(v === "all" ? null : parseInt(v))}>
                <SelectTrigger className="h-8 text-xs w-52">
                  <SelectValue placeholder="Tüm Birimler" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tüm Birimler</SelectItem>
                  {(allUnits ?? []).map((u: any) => (
                    <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <SeuDecisionItemsList
            unitIdFilter={unitFilter}
            recordTypeFilter="unit_official"
            adminMode={true}
          />
        </div>
      </TabsContent>

      <TabsContent value="analysis">
        <AdminAnalysisTab />
      </TabsContent>

      <TabsContent value="summary">
        <AdminSummaryTab />
      </TabsContent>

      <TabsContent value="method">
        <SeuMethodTab isAdmin={true} isSuperAdmin={isSuperAdmin} />
      </TabsContent>
    </Tabs>
  );
}
