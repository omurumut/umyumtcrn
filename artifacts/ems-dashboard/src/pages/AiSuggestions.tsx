import { useState, useEffect } from "react";
import { useGetAiSuggestions } from "@workspace/api-client-react";
import { useYear } from "@/context/YearContext";
import { useUnit } from "@/context/UnitContext";
import { useCompany } from "@/context/CompanyContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Lightbulb, Zap, RefreshCw, TrendingDown, Timer } from "lucide-react";

const FOCUS_OPTIONS = [
  { value: "genel", label: "Genel Analiz" },
  { value: "seu", label: "ÖEK Odaklı" },
  { value: "co2", label: "CO₂ Azaltım" },
  { value: "maliyet", label: "Maliyet Optimizasyonu" },
];

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  yuksek: { label: "Yüksek Öncelik", color: "bg-red-500/10 text-red-400 border-red-500/20" },
  orta: { label: "Orta Öncelik", color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  dusuk: { label: "Düşük Öncelik", color: "bg-green-500/10 text-green-400 border-green-500/20" },
};

export default function AiSuggestions() {
  const { year } = useYear();
  const { unitId } = useUnit();
  const { companyId } = useCompany();
  const [focus, setFocus] = useState("genel");
  const [triggered, setTriggered] = useState(false);

  const getSuggestions = useGetAiSuggestions();

  useEffect(() => {
    setTriggered(false);
  }, [unitId, companyId]);

  function handleGet() {
    getSuggestions.reset();
    setTriggered(true);
    getSuggestions.mutate({
      data: {
        focus,
        ...(companyId !== null ? { companyId } : {}),
        ...(unitId !== null ? { unitId } : {}),
      } as any,
    });
  }

  const suggestions = getSuggestions.data?.suggestions ?? [];
  const totalSavingKwh = suggestions.reduce((a, s) => a + (s.potentialSavingKwh ?? 0), 0);
  const errorMessage = getSuggestions.error instanceof Error
    ? getSuggestions.error.message
    : "Öneriler üretilirken bir hata oluştu.";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">AI Enerji Önerileri</h1>
        <p className="text-sm text-muted-foreground mt-1">{year} yılı verilerine göre yapay zeka destekli enerji iyileştirme önerileri</p>
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="space-y-1.5">
              <Label>Analiz Odağı</Label>
              <Select value={focus} onValueChange={setFocus}>
                <SelectTrigger className="w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FOCUS_OPTIONS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleGet} disabled={getSuggestions.isPending} className="gap-2">
              {getSuggestions.isPending ? (
                <><RefreshCw className="h-4 w-4 animate-spin" /> Analiz ediliyor...</>
              ) : (
                <><Lightbulb className="h-4 w-4" /> {triggered ? "Yenile" : "Önerileri Al"}</>
              )}
            </Button>
          </div>
          {!triggered && (
            <p className="text-xs text-muted-foreground mt-3">
              Biriminize ait tüketim, ÖEK ve SWOT verileriniz analiz edilerek kişiselleştirilmiş iyileştirme önerileri üretilecektir.
            </p>
          )}
        </CardContent>
      </Card>

      {triggered && !getSuggestions.isPending && suggestions.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <Card><CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-teal-400">{suggestions.length}</p>
            <p className="text-xs text-muted-foreground mt-1">Öneri</p>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-green-400">{Math.round(totalSavingKwh).toLocaleString("tr-TR")}</p>
            <p className="text-xs text-muted-foreground mt-1">Tahmini Tasarruf (kWh)</p>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-amber-400">
              {Math.round(suggestions.reduce((a, s) => a + (s.potentialSavingPercent ?? 0), 0) * 10) / 10}%
            </p>
            <p className="text-xs text-muted-foreground mt-1">Potansiyel Azaltım</p>
          </CardContent></Card>
        </div>
      )}

      {triggered && !getSuggestions.isPending && suggestions.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {suggestions.map((s, idx) => (
            <Card key={idx} className="group hover:shadow-lg transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-teal-500/10 flex items-center justify-center shrink-0">
                      <Lightbulb className="h-4 w-4 text-teal-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm leading-tight">{s.title}</h3>
                      <span className="text-xs text-muted-foreground">{s.category}</span>
                    </div>
                  </div>
                  <Badge variant="outline" className={`text-xs shrink-0 ${PRIORITY_CONFIG[s.priority]?.color ?? ""}`}>
                    {PRIORITY_CONFIG[s.priority]?.label ?? s.priority}
                  </Badge>
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed mb-4">{s.description}</p>

                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-muted/30 rounded-md p-2 text-center">
                    <div className="flex items-center justify-center gap-1 mb-0.5">
                      <TrendingDown className="h-3 w-3 text-green-400" />
                      <span className="text-xs text-muted-foreground">Tasarruf</span>
                    </div>
                    <p className="text-xs font-bold text-green-400">{Math.round(s.potentialSavingKwh).toLocaleString("tr-TR")} kWh</p>
                    <p className="text-xs text-muted-foreground">%{s.potentialSavingPercent?.toFixed(1)}</p>
                  </div>
                  <div className="bg-muted/30 rounded-md p-2 text-center">
                    <div className="flex items-center justify-center gap-1 mb-0.5">
                      <Timer className="h-3 w-3 text-blue-400" />
                      <span className="text-xs text-muted-foreground">Geri Dönüş</span>
                    </div>
                    <p className="text-xs font-bold text-blue-400">
                      {s.paybackMonths > 0 ? `${s.paybackMonths} ay` : "—"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {triggered && !getSuggestions.isPending && getSuggestions.isError && (
        <Card role="alert">
          <CardContent className="py-10 text-center text-destructive">
            <AlertCircle className="h-10 w-10 mx-auto mb-3" />
            <p className="font-medium">Öneriler üretilemedi</p>
            <p className="text-sm mt-1">{errorMessage}</p>
          </CardContent>
        </Card>
      )}

      {triggered && !getSuggestions.isPending && !getSuggestions.isError && suggestions.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Lightbulb className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>Öneri üretilemedi. Daha fazla tüketim verisi girildiğinde daha iyi sonuçlar elde edilir.</p>
          </CardContent>
        </Card>
      )}

      {!triggered && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Zap className="h-12 w-12 mb-4 opacity-20" />
          <p className="text-sm font-medium">Yapay Zeka Analizi Hazır</p>
          <p className="text-xs mt-1">Yukarıdan odak seçip "Önerileri Al" butonuna basın</p>
        </div>
      )}
    </div>
  );
}
