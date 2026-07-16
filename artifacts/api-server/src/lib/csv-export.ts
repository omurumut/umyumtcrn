/**
 * Modüler CSV export yardımcısı
 * - UTF-8 BOM (Excel uyumluluğu için)
 * - Delimiter: noktalı virgül (;)
 * - Türkçe boolean ve enum etiketleri
 * - Güvenli hücre escape
 *
 * İleride firma bazlı Word/Excel/PDF şablonlarına taşınabilecek şekilde
 * veri toplama ve çıktı üretme mantığı ayrı katmanlarda tutulmuştur.
 */

// ─── Enum çeviri tabloları ────────────────────────────────────────────────────

export const TARGET_STATUS_LABELS: Record<string, string> = {
  draft: "Taslak",
  active: "Devam Ediyor",
  completed: "Tamamlandı",
  cancelled: "İptal",
};

export const TARGET_TYPE_LABELS: Record<string, string> = {
  consumption_reduction: "Tüketim Azaltımı",
  efficiency_improvement: "Verimlilik Artışı",
  emission_reduction: "Emisyon Azaltımı",
  cost_reduction: "Maliyet Azaltımı",
  monitoring: "İzleme / Kontrol",
};

export const ACTION_STATUS_LABELS: Record<string, string> = {
  planned: "Planlandı",
  in_progress: "Devam Ediyor",
  completed: "Tamamlandı",
  delayed: "Gecikti",
  cancelled: "İptal",
};

export const PRIORITY_LABELS: Record<string, string> = {
  low: "Düşük",
  medium: "Orta",
  high: "Yüksek",
};

export const VAP_STATUS_LABELS: Record<string, string> = {
  idea: "Fikir",
  feasibility: "Fizibilite",
  planned: "Planlandı",
  in_progress: "Devam Ediyor",
  completed: "Tamamlandı",
  cancelled: "İptal",
};

export const FEASIBILITY_STATUS_LABELS: Record<string, string> = {
  not_started: "Başlanmadı",
  pre_feasibility: "Ön Fizibilite",
  detailed_feasibility: "Detay Fizibilite",
  approved: "Onaylandı",
  rejected: "Reddedildi",
};

export const INCENTIVE_STATUS_LABELS: Record<string, string> = {
  none: "Yok",
  evaluating: "Değerlendiriliyor",
  application_prepared: "Başvuru Hazırlanıyor",
  applied: "Başvuru Yapıldı",
  approved: "Onaylandı",
  rejected: "Reddedildi",
};

// ─── Hücre değeri normalleştirme ─────────────────────────────────────────────

/**
 * Ham değeri CSV hücresi için stringe dönüştürür.
 * - null/undefined → boş string
 * - boolean → Evet/Hayır
 * - sayılar → toString
 */
export function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Evet" : "Hayır";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/** Spreadsheet uygulamalarının formül olarak yorumlayabileceği text hücrelerini nötralize eder. */
export function sanitizeCsvCell(value: unknown): string {
  const normalized = normalizeCell(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(value)) return `'${normalized}`;
  return normalized;
}

/**
 * Bir CSV hücresini RFC 4180 uyumlu şekilde escape eder.
 * Hücre içinde ; " veya satır sonu varsa çift tırnak ile sarar.
 */
export function escapeCell(raw: string): string {
  if (raw.includes(";") || raw.includes('"') || raw.includes("\n") || raw.includes("\r")) {
    return '"' + raw.replace(/"/g, '""') + '"';
  }
  return raw;
}

// ─── CSV üretici ──────────────────────────────────────────────────────────────

export type CsvRow = Record<string, unknown>;

/**
 * Kolon başlıkları ve satır dizisinden CSV string üretir.
 * @param headers - [ { key: string, label: string } ] dizisi
 * @param rows    - Her satır için alan değerlerini içeren nesne dizisi
 * @returns UTF-8 BOM ile başlayan, ; delimited CSV string
 */
export function buildCsv(
  headers: Array<{ key: string; label: string }>,
  rows: CsvRow[],
): string {
  const DELIMITER = ";";
  const BOM = "\uFEFF";

  const headerLine = headers.map((h) => escapeCell(h.label)).join(DELIMITER);
  const dataLines = rows.map((row) =>
    headers
      .map((h) => escapeCell(sanitizeCsvCell(row[h.key])))
      .join(DELIMITER),
  );

  return BOM + [headerLine, ...dataLines].join("\r\n");
}

/**
 * Express response'a CSV dosyası olarak yazar.
 * @param res      - Express Response
 * @param filename - İndirme dosya adı (.csv dahil)
 * @param csv      - buildCsv() sonucu
 */
export function sendCsvResponse(res: import("express").Response, filename: string, csv: string): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader("Cache-Control", "no-store");
  res.end(Buffer.from(csv, "utf8"));
}
