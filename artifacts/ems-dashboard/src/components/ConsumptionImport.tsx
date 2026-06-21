import { useState, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

const MONTHS = ["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"];

const COLUMN_ALIASES: Record<string, string> = {
  sayac_adi: "meterName", sayac: "meterName", "sayaç adı": "meterName", "sayaç": "meterName",
  metername: "meterName", meter_name: "meterName", meter: "meterName",
  meterid: "meterId", sayac_id: "meterId", "sayaç id": "meterId",
  yil: "year", "yıl": "year", year: "year",
  ay: "month", month: "month",
  kwh: "kwh", tuketim: "kwh", "tüketim": "kwh", consumption: "kwh",
  tep: "tep",
  co2: "co2", "co₂": "co2",
  hdd: "hdd",
  cdd: "cdd",
  notlar: "notes", not: "notes", notes: "notes", note: "notes", aciklama: "notes", "açıklama": "notes",
};

function normalizeKey(k: string): string {
  return k.toLowerCase().trim().replace(/\s+/g, "_");
}

function mapRow(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const mapped = COLUMN_ALIASES[normalizeKey(k)] ?? COLUMN_ALIASES[k.toLowerCase().trim()] ?? normalizeKey(k);
    out[mapped] = v;
  }
  return out;
}

function validateRow(row: Record<string, unknown>, idx: number): string | null {
  if (!row.meterName && !row.meterId) return `Satır ${idx + 1}: Sayaç adı veya ID gerekli`;
  const year = parseInt(String(row.year ?? ""));
  const month = parseInt(String(row.month ?? ""));
  if (!year || year < 2000 || year > 2100) return `Satır ${idx + 1}: Geçersiz yıl (${row.year})`;
  if (!month || month < 1 || month > 12) return `Satır ${idx + 1}: Geçersiz ay (${row.month})`;
  const kwh = parseFloat(String(row.kwh ?? ""));
  if (isNaN(kwh)) return `Satır ${idx + 1}: Geçersiz tüketim değeri (${row.kwh})`;
  return null;
}

function generateTemplate(): void {
  const rows = [
    { sayac_adi: "Ana Elektrik Sayacı", meterId: "", yil: 2024, ay: 1, kwh: 15000, tep: "", co2: "", hdd: "", cdd: "", notlar: "" },
    { sayac_adi: "Doğalgaz Sayacı", meterId: "", yil: 2024, ay: 2, kwh: 3500, tep: "", co2: "", hdd: "", cdd: "", notlar: "Kış dönemi" },
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Tüketim");
  XLSX.writeFile(wb, "tuketim_sablonu.xlsx");
}

interface ImportResult {
  imported: number;
  total: number;
  errors: { row: number; message: string }[];
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export default function ConsumptionImport({ open, onOpenChange }: Props) {
  const { token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  function reset() {
    setFileName(null);
    setRows([]);
    setValidationErrors([]);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleClose() {
    reset();
    onOpenChange(false);
  }

  function parseFile(file: File) {
    setResult(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
        const mapped = raw.map(mapRow);
        const errs: string[] = [];
        mapped.forEach((r, i) => {
          const err = validateRow(r, i);
          if (err) errs.push(err);
        });
        setRows(mapped);
        setValidationErrors(errs);
      } catch {
        toast({ title: "Dosya okunamadı", description: "Geçerli bir CSV veya Excel dosyası seçin", variant: "destructive" });
        reset();
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) parseFile(file);
  }, []);

  async function handleImport() {
    if (rows.length === 0 || validationErrors.length > 0) return;
    setImporting(true);
    try {
      const res = await fetch("/api/consumption/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error ?? "İçe aktarma başarısız", variant: "destructive" });
        return;
      }
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["consumption"] });
      if (data.imported > 0) {
        toast({ title: `${data.imported} kayıt başarıyla içe aktarıldı` });
      }
    } catch {
      toast({ title: "Bağlantı hatası", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  }

  const previewRows = rows.slice(0, 8);
  const hasErrors = validationErrors.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Toplu Tüketim Verisi İçe Aktar
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
          {!result && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  CSV veya Excel (.xlsx) dosyası yükleyin. Gerekli sütunlar: <span className="font-mono text-xs bg-muted px-1 rounded">sayac_adi</span>, <span className="font-mono text-xs bg-muted px-1 rounded">yil</span>, <span className="font-mono text-xs bg-muted px-1 rounded">ay</span>, <span className="font-mono text-xs bg-muted px-1 rounded">kwh</span>
                </p>
                <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={generateTemplate}>
                  <Download className="h-3.5 w-3.5" />
                  Şablon İndir
                </Button>
              </div>

              <div
                className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer
                  ${dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"}`}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
              >
                <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileChange} />
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                {fileName ? (
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-sm font-medium">{fileName}</span>
                    <button className="text-muted-foreground hover:text-foreground" onClick={e => { e.stopPropagation(); reset(); }}>
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm font-medium">Dosyayı buraya sürükleyin veya tıklayın</p>
                    <p className="text-xs text-muted-foreground mt-1">CSV, XLS, XLSX desteklenir</p>
                  </>
                )}
              </div>

              {hasErrors && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1">
                  <div className="flex items-center gap-2 text-destructive text-sm font-medium">
                    <AlertCircle className="h-4 w-4" />
                    {validationErrors.length} doğrulama hatası
                  </div>
                  {validationErrors.slice(0, 5).map((e, i) => (
                    <p key={i} className="text-xs text-destructive/80 pl-6">{e}</p>
                  ))}
                  {validationErrors.length > 5 && (
                    <p className="text-xs text-muted-foreground pl-6">… ve {validationErrors.length - 5} hata daha</p>
                  )}
                </div>
              )}

              {rows.length > 0 && !hasErrors && (
                <div className="rounded-lg border border-green-500/30 bg-green-500/5 px-3 py-2 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-green-600">{rows.length} satır doğrulandı, içe aktarmaya hazır</span>
                </div>
              )}

              {previewRows.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5 font-medium uppercase tracking-wide">
                    Önizleme {rows.length > 8 ? `(ilk 8 / ${rows.length} satır)` : ""}
                  </p>
                  <div className="rounded-md border overflow-auto max-h-52">
                    <Table>
                      <TableHeader>
                        <TableRow className="text-xs">
                          <TableHead className="py-2">Sayaç</TableHead>
                          <TableHead className="py-2">Yıl</TableHead>
                          <TableHead className="py-2">Ay</TableHead>
                          <TableHead className="py-2 text-right">kWh</TableHead>
                          <TableHead className="py-2 text-right">TEP</TableHead>
                          <TableHead className="py-2 text-right">CO₂</TableHead>
                          <TableHead className="py-2">Not</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewRows.map((r, i) => (
                          <TableRow key={i} className="text-xs">
                            <TableCell className="py-1.5 font-medium max-w-[140px] truncate">
                              {String(r.meterName ?? r.meterId ?? "—")}
                            </TableCell>
                            <TableCell className="py-1.5">{String(r.year ?? "")}</TableCell>
                            <TableCell className="py-1.5">{MONTHS[(parseInt(String(r.month ?? 1)) - 1)] ?? r.month}</TableCell>
                            <TableCell className="py-1.5 text-right font-mono">{String(r.kwh ?? "")}</TableCell>
                            <TableCell className="py-1.5 text-right font-mono text-muted-foreground">{r.tep !== "" ? String(r.tep ?? "") : <span className="opacity-40">oto</span>}</TableCell>
                            <TableCell className="py-1.5 text-right font-mono text-muted-foreground">{r.co2 !== "" ? String(r.co2 ?? "") : <span className="opacity-40">oto</span>}</TableCell>
                            <TableCell className="py-1.5 max-w-[100px] truncate text-muted-foreground">{String(r.notes ?? "")}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </>
          )}

          {result && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border bg-card p-4 text-center">
                  <p className="text-2xl font-bold text-green-500">{result.imported}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Başarıyla Aktarıldı</p>
                </div>
                <div className="rounded-lg border bg-card p-4 text-center">
                  <p className="text-2xl font-bold text-destructive">{result.errors.length}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Hatalı Satır</p>
                </div>
                <div className="rounded-lg border bg-card p-4 text-center">
                  <p className="text-2xl font-bold">{result.total}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Toplam Satır</p>
                </div>
              </div>
              {result.errors.length > 0 && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1 max-h-48 overflow-y-auto">
                  <p className="text-sm font-medium text-destructive flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" /> Aktarılamayan satırlar
                  </p>
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs text-destructive/80 pl-6">Satır {e.row}: {e.message}</p>
                  ))}
                </div>
              )}
              {result.imported === result.total && (
                <div className="rounded-lg border border-green-500/30 bg-green-500/5 px-3 py-3 flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  <span className="text-sm text-green-600 font-medium">Tüm satırlar başarıyla içe aktarıldı!</span>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="mt-2 gap-2">
          {result ? (
            <>
              <Button variant="outline" onClick={reset}>Yeni Dosya Yükle</Button>
              <Button onClick={handleClose}>Kapat</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose}>İptal</Button>
              <Button
                onClick={handleImport}
                disabled={rows.length === 0 || hasErrors || importing}
                className="gap-2 min-w-[130px]"
              >
                {importing
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Aktarılıyor…</>
                  : <><Upload className="h-4 w-4" /> {rows.length > 0 ? `${rows.length} Satırı Aktar` : "İçe Aktar"}</>
                }
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
