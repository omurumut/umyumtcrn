import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListReports, useGenerateReport, getListReportsQueryKey } from "@workspace/api-client-react";
import { useYear } from "@/context/YearContext";
import { useUnit } from "@/context/UnitContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Download, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Reports() {
  const { year } = useYear();
  const { unitId } = useUnit();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [reportYear, setReportYear] = useState(year.toString());
  const [includeSwot, setIncludeSwot] = useState(true);
  const [includeRisks, setIncludeRisks] = useState(true);
  const [includeSeu, setIncludeSeu] = useState(true);
  const [includeRegression, setIncludeRegression] = useState(true);

  const listParams = unitId !== null ? { unitId } : undefined;
  const { data: reports, isLoading } = useListReports({ query: { queryKey: getListReportsQueryKey() } });
  const generate = useGenerateReport();

  const filteredReports = unitId !== null
    ? (reports ?? []).filter((r: any) => r.unitId === unitId)
    : (reports ?? []);

  function handleGenerate() {
    generate.mutate({
      data: {
        year: parseInt(reportYear),
        includeSwot,
        includeRisks,
        includeSeu,
        includeRegression,
        ...(unitId !== null ? { unitId } : {}),
      },
    }, {
      onSuccess: (result: any) => {
        queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() });
        toast({ title: `${reportYear} yılı raporu oluşturuldu` });
        if (result?.downloadUrl) {
          const a = document.createElement("a");
          a.href = result.downloadUrl;
          a.download = `enerji-raporu-${reportYear}.html`;
          a.click();
        }
      },
      onError: () => toast({ title: "Rapor oluşturulamadı", variant: "destructive" }),
    });
  }

  function handleDownload(report: any) {
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
                    onCheckedChange={(v) => item.setter(v === true)}
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
                  [...filteredReports].reverse().map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.year} Yılı Raporu</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(r.createdAt).toLocaleDateString("tr-TR", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}
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
