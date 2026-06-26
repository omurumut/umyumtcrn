/**
 * Modüler XLSX export yardımcısı (ExcelJS)
 * - Kalın başlık satırı + dondurulmuş ilk satır
 * - Otomatik / sabit kolon genişlikleri
 * - Uzun metin kolonlarında wrap text
 * - Sayısal değerler number tipinde
 * - Tarihler string (YYYY-MM-DD)
 * - Boolean → Evet/Hayır
 * - null/undefined → boş hücre
 *
 * İleride firma bazlı Excel şablonlarına geçilebilecek şekilde modüler tutulmuştur.
 */

import ExcelJS from "exceljs";

// ─── Kolon tipi tanımı ──────────────────────────────────────────────────────

export type XlsxColType = "text" | "number" | "date" | "boolean";

export interface XlsxColDef {
  key: string;
  label: string;
  type?: XlsxColType; // default: "text"
  width?: number;     // karakter cinsinden; verilmezse otomatik
  wrapText?: boolean;
}

// ─── Kolon genişliği tahmini ────────────────────────────────────────────────

const DEFAULT_WIDTHS: Record<XlsxColType, number> = {
  text: 20,
  number: 14,
  date: 14,
  boolean: 10,
};

// Uzun metin sütunları için eşik — bu genişlikten büyükse wrap text açılır
const WRAP_TEXT_WIDTH_THRESHOLD = 30;

// ─── Hücre değeri normalleştirme ────────────────────────────────────────────

function normalizeXlsxCell(value: unknown, type: XlsxColType): string | number | null {
  if (value === null || value === undefined || value === "") return null;

  if (type === "boolean") {
    if (typeof value === "boolean") return value ? "Evet" : "Hayır";
    if (value === "Evet" || value === "Hayır") return value as string;
    return null;
  }

  if (type === "number") {
    const n = typeof value === "number" ? value : parseFloat(String(value));
    return isNaN(n) ? null : n;
  }

  if (type === "date") {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    const s = String(value).trim();
    return s || null;
  }

  // text
  return String(value);
}

// ─── XLSX üretici ───────────────────────────────────────────────────────────

export type XlsxRow = Record<string, unknown>;

/**
 * ExcelJS workbook buffer üretir.
 *
 * @param sheetName  - Çalışma sayfası adı
 * @param headers    - Kolon tanımları
 * @param rows       - Veri satırları
 */
export async function buildXlsx(
  sheetName: string,
  headers: XlsxColDef[],
  rows: XlsxRow[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "EMS";
  wb.created = new Date();

  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 1 }], // İlk satır dondur
  });

  // ── Kolon tanımları ──────────────────────────────────────────
  ws.columns = headers.map((h) => {
    const colType = h.type ?? "text";
    const width = h.width ?? DEFAULT_WIDTHS[colType];
    return {
      key: h.key,
      header: h.label,
      width,
    };
  });

  // ── Başlık satırı biçimlendirme ──────────────────────────────
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, size: 11 };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD9E1F2" }, // Açık mavi
  };
  headerRow.border = {
    bottom: { style: "thin", color: { argb: "FF8EA9C1" } },
  };
  headerRow.alignment = { vertical: "middle", wrapText: false };
  headerRow.height = 18;
  headerRow.commit();

  // ── Veri satırları ───────────────────────────────────────────
  for (const row of rows) {
    const xlsxRow = ws.addRow(
      headers.map((h) => normalizeXlsxCell(row[h.key], h.type ?? "text")),
    );

    // Hücre düzeyinde biçimlendirme
    headers.forEach((h, colIdx) => {
      const cell = xlsxRow.getCell(colIdx + 1);
      const colType = h.type ?? "text";
      const shouldWrap = h.wrapText ?? (h.width ?? DEFAULT_WIDTHS[colType]) >= WRAP_TEXT_WIDTH_THRESHOLD;

      cell.alignment = {
        vertical: "top",
        wrapText: shouldWrap,
        shrinkToFit: !shouldWrap,
      };

      if (colType === "number" && cell.value !== null && cell.value !== undefined) {
        cell.numFmt = "#,##0.##";
      }
    });

    xlsxRow.commit();
  }

  // ── Otomatik filtre ──────────────────────────────────────────
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ─── HTTP response yardımcısı ────────────────────────────────────────────────

/**
 * Express response'a XLSX dosyası olarak yazar.
 */
export function sendXlsxResponse(
  res: import("express").Response,
  filename: string,
  buffer: Buffer,
): void {
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  res.setHeader("Cache-Control", "no-store");
  res.end(buffer);
}
