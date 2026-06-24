import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { useListUnits, getListUnitsQueryKey } from "@workspace/api-client-react";
import SeuAnalysisTab from "./SeuAnalysisTab";
import SeuAssessmentList from "./SeuAssessmentList";
import SeuMethodTab from "./SeuMethodTab";

const LEVEL_LABELS: Record<string, string> = {
  energyUseGroup: "Enerji Kullanım Grubu",
  meter: "Sayaç",
  subUnit: "Alt Birim",
  energySource: "Enerji Kaynağı",
  unit: "Birim",
};

function AdminSummaryTab() {
  const { token } = useAuth();
  const [filterUnitId, setFilterUnitId] = useState<string>("all");
  const currentYear = new Date().getFullYear();

  const { data: allUnits } = useListUnits({}, { query: { queryKey: getListUnitsQueryKey({}) } });

  const { data: officialAssessments, isLoading } = useQuery({
    queryKey: ["seu-assessments-summary"],
    queryFn: async () => {
      const res = await fetch("/api/seu/assessments?recordType=unit_official", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Yüklenemedi");
      return res.json() as Promise<any[]>;
    },
    enabled: !!token,
  });

  const filtered = (officialAssessments ?? []).filter(
    a => filterUnitId === "all" || String(a.unitId) === filterUnitId
  );

  const unitMap: Record<number, string> = Object.fromEntries(
    (allUnits ?? []).map((u: any) => [u.id, u.name])
  );

  const byUnit: Record<number, any[]> = {};
  for (const a of filtered) {
    if (!byUnit[a.unitId]) byUnit[a.unitId] = [];
    byUnit[a.unitId].push(a);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Birim Filtresi</Label>
          <Select value={filterUnitId} onValueChange={setFilterUnitId}>
            <SelectTrigger className="h-8 text-xs w-52">
              <SelectValue />
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

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : Object.keys(byUnit).length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center text-muted-foreground">
            <p>Henüz resmi ÖEK kaydı yok.</p>
            <p className="text-sm mt-1">Birim kullanıcıları ÖEK analizi tamamlayıp kaydettiğinde burada görünür.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(byUnit).map(([unitId, unitAssessments]) => {
            const latestByLevel: Record<string, any> = {};
            for (const a of unitAssessments) {
              const key = `${a.year}-${a.analysisLevel}`;
              if (!latestByLevel[key] || a.createdAt > latestByLevel[key].createdAt) {
                latestByLevel[key] = a;
              }
            }
            const latest = Object.values(latestByLevel);
            const totalSeu = latest.reduce((s: number, a: any) => s + (a.seuCount ?? 0), 0);
            const totalTep = latest.reduce((s: number, a: any) => s + (a.unitTotalTep ?? 0), 0) / Math.max(latest.length, 1);

            return (
              <Card key={unitId}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">{unitMap[parseInt(unitId)] ?? `Birim #${unitId}`}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs border-teal-500/30 text-teal-400">
                        {totalTep.toFixed(2)} TEP
                      </Badge>
                      <Badge variant="outline" className="text-xs border-amber-500/30 text-amber-400">
                        {totalSeu} ÖEK
                      </Badge>
                    </div>
                  </div>
                  <CardDescription className="text-xs">{latest.length} analiz kaydı</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1.5">
                    {latest.map((a: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">{a.year}</span>
                          <span>{LEVEL_LABELS[a.analysisLevel] ?? a.analysisLevel}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">{(a.unitTotalTep ?? 0).toFixed(2)} TEP</span>
                          <span>{a.itemCount ?? 0} kalem</span>
                          {a.seuCount > 0 && <span className="text-amber-400">{a.seuCount} ÖEK</span>}
                          <span className="text-muted-foreground">{new Date(a.createdAt).toLocaleDateString("tr-TR")}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
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
          <SeuAssessmentList
            unitIdFilter={unitFilter}
            recordTypeFilter="unit_official"
            showAllTypes={false}
          />
        </div>
      </TabsContent>

      <TabsContent value="analysis">
        <SeuAnalysisTab isAdminMode={true} adminRecordType="admin_review" />
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
