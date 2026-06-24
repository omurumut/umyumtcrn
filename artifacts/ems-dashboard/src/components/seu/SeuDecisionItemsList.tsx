import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Info } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const MONTH_NAMES = ["", "Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

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
  monitor: "İzleme",
};

const DECISION_STYLE: Record<string, string> = {
  accepted_as_seu: "border-teal-500/40 text-teal-400 bg-teal-500/10",
  not_seu: "border-red-500/40 text-red-400 bg-red-500/10",
  monitor: "border-amber-500/40 text-amber-400 bg-amber-500/10",
};

const SYS_REC_LABEL: Record<string, string> = {
  seu_candidate: "ÖEK Adayı",
  not_seu: "ÖEK Dışı",
};

const SYS_REC_STYLE: Record<string, string> = {
  seu_candidate: "border-teal-500/30 text-teal-400 bg-teal-500/10",
  not_seu: "border-border text-muted-foreground bg-muted/20",
};

const PRIORITY_COLORS: Record<number, string> = {
  1: "bg-red-500/20 text-red-400 border-red-500/30",
  2: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  3: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  4: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  5: "bg-muted/30 text-muted-foreground border-border",
};

type DecisionFilter = "all" | "accepted_as_seu" | "monitor" | "not_seu";

const currentYear = new Date().getFullYear();
const YEARS = ["all", currentYear, currentYear - 1, currentYear - 2, currentYear - 3] as const;

export default function SeuDecisionItemsList() {
  const { token } = useAuth();
  const [year, setYear] = useState<number | "all">("all");
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>("all");

  const { data: items, isLoading } = useQuery({
    queryKey: ["seu-decision-items", year],
    queryFn: async () => {
      const url = year === "all"
        ? "/api/seu/decision-items"
        : `/api/seu/decision-items?year=${year}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Yüklenemedi");
      return res.json() as Promise<any[]>;
    },
    enabled: !!token,
  });

  const allItems = items ?? [];

  const filtered = decisionFilter === "all"
    ? allItems
    : allItems.filter((i: any) => i.userDecision === decisionFilter);

  const seuCount = allItems.filter((i: any) => i.userDecision === "accepted_as_seu").length;
  const monitorCount = allItems.filter((i: any) => i.userDecision === "monitor").length;
  const notSeuCount = allItems.filter((i: any) => i.userDecision === "not_seu").length;

  const FILTER_TABS: { value: DecisionFilter; label: string; count: number }[] = [
    { value: "all", label: "Tüm Kararlar", count: allItems.length },
    { value: "accepted_as_seu", label: "ÖEK", count: seuCount },
    { value: "monitor", label: "İzleme", count: monitorCount },
    { value: "not_seu", label: "ÖEK Dışı", count: notSeuCount },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 p-3 rounded-md border border-border/60 bg-muted/10 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 shrink-0" />
        Kapsam: Biriminize ait resmi ÖEK değerlendirme kararları
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="space-y-1">
          <Label className="text-xs">Yıl</Label>
          <Select value={String(year)} onValueChange={v => setYear(v === "all" ? "all" : parseInt(v))}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm Yıllar</SelectItem>
              {YEARS.filter(y => y !== "all").map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!isLoading && allItems.length > 0 && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground pt-4">
            <span className="font-medium text-foreground">{allItems.length} toplam karar</span>
            {seuCount > 0 && <span className="text-teal-400 font-medium">{seuCount} ÖEK</span>}
            {monitorCount > 0 && <span className="text-amber-400 font-medium">{monitorCount} İzleme</span>}
            {notSeuCount > 0 && <span className="text-red-400 font-medium">{notSeuCount} ÖEK Dışı</span>}
          </div>
        )}
      </div>

      {!isLoading && allItems.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {FILTER_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setDecisionFilter(tab.value)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                decisionFilter === tab.value
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted/40"
              }`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : allItems.length === 0 ? (
        <Card>
          <CardContent className="py-14 flex flex-col items-center text-muted-foreground">
            <AlertTriangle className="h-8 w-8 mb-3 opacity-30" />
            <p className="font-medium">{year} yılı için kayıtlı ÖEK kararı bulunamadı</p>
            <p className="text-sm mt-1">Önce ÖEK Analizi sekmesinden analiz yapıp kararları kaydedin</p>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            Bu filtrede karar yok
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left p-2 pl-3 font-medium text-muted-foreground whitespace-nowrap">Analiz Öğesi</th>
                <th className="text-right p-2 font-medium text-muted-foreground whitespace-nowrap">TEP</th>
                <th className="text-right p-2 font-medium text-muted-foreground whitespace-nowrap">Pay %</th>
                <th className="text-center p-2 font-medium text-muted-foreground whitespace-nowrap">Fırsat</th>
                <th className="text-center p-2 font-medium text-muted-foreground whitespace-nowrap">Öncelik</th>
                <th className="text-center p-2 font-medium text-muted-foreground whitespace-nowrap">Sistem Önerisi</th>
                <th className="text-center p-2 font-medium text-muted-foreground whitespace-nowrap">Karar</th>
                <th className="text-left p-2 font-medium text-muted-foreground whitespace-nowrap">Gerekçe</th>
                <th className="text-right p-2 font-medium text-muted-foreground whitespace-nowrap">Hedef %</th>
                <th className="text-left p-2 font-medium text-muted-foreground whitespace-nowrap">Sorumlu</th>
                <th className="text-left p-2 font-medium text-muted-foreground whitespace-nowrap">Not</th>
                <th className="text-left p-2 font-medium text-muted-foreground whitespace-nowrap">Dönem</th>
                <th className="text-left p-2 pr-3 font-medium text-muted-foreground whitespace-nowrap">Güncelleme</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item: any) => (
                <tr key={`${item.assessmentId}-${item.itemId}`} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="p-2 pl-3">
                    <div className="flex items-center gap-1.5">
                      {item.userDecision && (
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          item.userDecision === "accepted_as_seu" ? "bg-teal-400" :
                          item.userDecision === "monitor" ? "bg-amber-400" : "bg-red-400"
                        }`} />
                      )}
                      <span className="font-medium max-w-[180px] truncate" title={item.name}>{item.name}</span>
                    </div>
                    <div className="text-muted-foreground mt-0.5 pl-3">
                      {LEVEL_LABELS[item.analysisLevel] ?? item.analysisLevel}
                    </div>
                  </td>
                  <td className="p-2 text-right font-mono">{Number(item.energyTep).toFixed(4)}</td>
                  <td className="p-2 text-right font-mono font-medium">{Number(item.consumptionSharePercent).toFixed(1)}%</td>
                  <td className="p-2 text-center">
                    <span className={`px-1.5 py-0.5 rounded text-xs border ${
                      item.hasOpportunity
                        ? "border-green-500/30 text-green-400 bg-green-500/10"
                        : "border-border text-muted-foreground bg-muted/20"
                    }`}>
                      {item.hasOpportunity ? "Var" : "Yok"}
                    </span>
                  </td>
                  <td className="p-2 text-center">
                    {item.priorityResult != null ? (
                      <Badge variant="outline" className={`text-xs ${PRIORITY_COLORS[item.priorityResult] ?? ""}`}>
                        {item.priorityResult}
                      </Badge>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="p-2 text-center">
                    <Badge variant="outline" className={`text-xs ${SYS_REC_STYLE[item.systemRecommendation] ?? ""}`}>
                      {SYS_REC_LABEL[item.systemRecommendation] ?? item.systemRecommendation}
                    </Badge>
                  </td>
                  <td className="p-2 text-center">
                    {item.userDecision ? (
                      <Badge variant="outline" className={`text-xs ${DECISION_STYLE[item.userDecision] ?? ""}`}>
                        {DECISION_LABEL[item.userDecision] ?? item.userDecision}
                      </Badge>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="p-2 max-w-[160px]">
                    <span className="text-muted-foreground line-clamp-2" title={item.decisionReason ?? ""}>
                      {item.decisionReason || "—"}
                    </span>
                  </td>
                  <td className="p-2 text-right text-muted-foreground">
                    {item.targetReductionPercent != null ? `%${item.targetReductionPercent}` : "—"}
                  </td>
                  <td className="p-2 max-w-[100px] truncate text-muted-foreground" title={item.responsible ?? ""}>
                    {item.responsible || "—"}
                  </td>
                  <td className="p-2 max-w-[120px] truncate text-muted-foreground" title={item.notes ?? ""}>
                    {item.notes || "—"}
                  </td>
                  <td className="p-2 text-muted-foreground whitespace-nowrap">
                    {MONTH_NAMES[item.periodStart]}–{MONTH_NAMES[item.periodEnd]}
                  </td>
                  <td className="p-2 pr-3 text-muted-foreground whitespace-nowrap">
                    {new Date(item.itemUpdatedAt).toLocaleDateString("tr-TR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
