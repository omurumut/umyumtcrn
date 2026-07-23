const DEFAULT_FOOTER_TEXT = "Bu rapor ISO 50001 Enerji Yonetim Sistemi kapsaminda otomatik olarak uretilmistir.";
const MAX_LOGO_BYTES = 256 * 1024;

export type CorporatePdfIdentity = {
  companyName: string;
  companyLegalName?: string | null;
  companyShortName?: string | null;
  companyAddress?: string | null;
  reportTitle: string;
  reportDisplayName: string;
  reportPeriod: string;
  unitLabel?: string | null;
  documentNumber?: string | null;
  revisionNumber?: string | null;
  revisionDate?: string | null;
  preparedBy?: string | null;
  checkedBy?: string | null;
  approvedBy?: string | null;
  confidentialityLabel?: string | null;
  footerText?: string | null;
  generatedAt: Date;
  generatedByName?: string | null;
  locale?: string | null;
  showSignatureFields?: boolean;
  showPageNumbers?: boolean;
  logoDataUri?: string | null;
  logoAltText?: string | null;
};

export type CorporatePdfRender = {
  html: string;
  headerTemplate: string;
  footerTemplate: string;
  displayHeaderFooter: boolean;
};

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cleanText(value: string | null | undefined, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function field(label: string, value: string | number | null | undefined): string {
  const cleaned = cleanText(value === null || value === undefined ? null : String(value), 240);
  return cleaned ? `<div class="doc-field"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(cleaned)}</dd></div>` : "";
}

function formatDate(value: Date, locale: string): string {
  return value.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

function companyDisplayName(identity: CorporatePdfIdentity): string {
  return cleanText(identity.companyLegalName, 250) ?? cleanText(identity.companyName, 250) ?? "Firma";
}

function shortCompanyName(identity: CorporatePdfIdentity): string {
  return cleanText(identity.companyShortName, 80) ?? companyDisplayName(identity);
}

function footerText(identity: CorporatePdfIdentity): string | null {
  return cleanText(identity.footerText ?? DEFAULT_FOOTER_TEXT, 500);
}

function safeLogoDataUri(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  return /^data:image\/(?:png|jpeg);base64,[a-z0-9+/]+=*$/i.test(value) ? value : null;
}

export function buildCorporateSectionHeading(index: number, title: string): string {
  return `<h2 class="section-title">${index}. ${escapeHtml(title)}</h2>`;
}

export function logoBufferToDataUri(input: { mimeType: string | null | undefined; content: Buffer | null | undefined; maxBytes?: number }): string | null {
  const content = input.content;
  const mimeType = input.mimeType;
  const maxBytes = input.maxBytes ?? MAX_LOGO_BYTES;
  if (!content || !mimeType || content.length === 0 || content.length > maxBytes) return null;
  const isPng = mimeType === "image/png" && content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = (mimeType === "image/jpeg" || mimeType === "image/jpg") && content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[content.length - 2] === 0xff && content[content.length - 1] === 0xd9;
  if (!isPng && !isJpeg) return null;
  return `data:${mimeType === "image/jpg" ? "image/jpeg" : mimeType};base64,${content.toString("base64")}`;
}

export function buildCorporateDocumentInfo(identity: CorporatePdfIdentity): string {
  const locale = identity.locale || "tr-TR";
  const generatedAt = formatDate(identity.generatedAt, locale);
  return `<section class="document-info">
    <h2>Dokuman Bilgileri</h2>
    <dl class="doc-grid">
      ${field("Rapor turu", identity.reportDisplayName)}
      ${field("Rapor donemi", identity.reportPeriod)}
      ${field("Sirket", companyDisplayName(identity))}
      ${field("Birim kapsami", identity.unitLabel)}
      ${field("Dokuman numarasi", identity.documentNumber)}
      ${field("Revizyon", identity.revisionNumber)}
      ${field("Gizlilik", identity.confidentialityLabel)}
      ${field("Olusturulma zamani", generatedAt)}
    </dl>
  </section>`;
}

function buildCover(identity: CorporatePdfIdentity): string {
  const locale = identity.locale || "tr-TR";
  const generatedAt = formatDate(identity.generatedAt, locale);
  const companyName = companyDisplayName(identity);
  const logoDataUri = safeLogoDataUri(identity.logoDataUri);
  const logo = logoDataUri
    ? `<img class="cover-logo" src="${escapeHtml(logoDataUri)}" alt="${escapeHtml(cleanText(identity.logoAltText, 120) ?? "Firma logosu")}">`
    : `<div class="cover-logo-fallback">${escapeHtml(shortCompanyName(identity).slice(0, 2).toLocaleUpperCase("tr-TR"))}</div>`;
  const address = cleanText(identity.companyAddress, 500);
  const generatedBy = cleanText(identity.generatedByName, 160);
  const signatureFields = identity.showSignatureFields === false ? "" : [
    field("Hazirlayan", identity.preparedBy),
    field("Kontrol eden", identity.checkedBy),
    field("Onaylayan", identity.approvedBy),
  ].join("");

  return `<section class="corporate-cover">
    <div class="cover-brand">
      ${logo}
      <div>
        <div class="company-name">${escapeHtml(companyName)}</div>
        ${address ? `<div class="company-address">${escapeHtml(address)}</div>` : ""}
      </div>
    </div>
    <div class="cover-title-block">
      <div class="report-kind">${escapeHtml(identity.reportDisplayName)}</div>
      <h1>${escapeHtml(identity.reportTitle)}</h1>
      <div class="report-period">${escapeHtml(identity.reportPeriod)}</div>
    </div>
    <dl class="doc-grid cover-grid">
      ${field("Dokuman numarasi", identity.documentNumber)}
      ${field("Revizyon numarasi", identity.revisionNumber)}
      ${field("Revizyon tarihi", identity.revisionDate)}
      ${field("Gizlilik derecesi", identity.confidentialityLabel)}
      ${field("Olusturma zamani", generatedAt)}
      ${field("Olusturan", generatedBy)}
      ${signatureFields}
    </dl>
  </section>`;
}

export function buildCorporateHeaderFooter(identity: CorporatePdfIdentity): Pick<CorporatePdfRender, "headerTemplate" | "footerTemplate" | "displayHeaderFooter"> {
  const docNo = cleanText(identity.documentNumber, 80);
  const footer = footerText(identity);
  const confidentiality = cleanText(identity.confidentialityLabel, 80);
  const pageNumber = identity.showPageNumbers === false ? "" : `<span class="page-number">Sayfa <span class="pageNumber"></span> / <span class="totalPages"></span></span>`;
  const headerTemplate = `<style>
    .pdf-header { width:100%; font-family: Arial, sans-serif; font-size:8px; color:#475569; padding:0 10mm; display:flex; justify-content:space-between; gap:8px; box-sizing:border-box; }
    .pdf-header span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  </style><div class="pdf-header"><span>${escapeHtml(shortCompanyName(identity))}</span><span>${escapeHtml(cleanText(identity.reportDisplayName, 90) ?? identity.reportTitle)}</span><span>${docNo ? escapeHtml(docNo) : ""}</span></div>`;
  const footerParts = [
    footer ? `<span>${escapeHtml(footer)}</span>` : "",
    confidentiality ? `<span>${escapeHtml(confidentiality)}</span>` : "",
    pageNumber,
  ].filter(Boolean).join(`<span class="sep">|</span>`);
  const footerTemplate = `<style>
    .pdf-footer { width:100%; font-family: Arial, sans-serif; font-size:8px; color:#64748b; padding:0 10mm; box-sizing:border-box; display:flex; justify-content:center; gap:6px; }
    .pdf-footer span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .pdf-footer .sep { color:#cbd5e1; flex:0 0 auto; }
    .pdf-footer .page-number { flex:0 0 auto; }
  </style><div class="pdf-footer">${footerParts}</div>`;
  return { headerTemplate, footerTemplate, displayHeaderFooter: true };
}

export function buildCorporateReportHtml(input: {
  identity: CorporatePdfIdentity;
  bodyHtml: string;
  extraCss?: string;
}): CorporatePdfRender {
  const { headerTemplate, footerTemplate, displayHeaderFooter } = buildCorporateHeaderFooter(input.identity);
  const html = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(input.identity.reportTitle)}</title>
  <style>
    @page { size: A4; }
    * { box-sizing: border-box; }
    body { font-family: Arial, "Segoe UI", sans-serif; max-width: 1100px; margin: 0 auto; padding: 24px 28px; color: #1a202c; font-size: 12px; line-height: 1.45; }
    h1, h2, h3 { color: #1e3a5f; page-break-after: avoid; break-after: avoid; }
    h1 { font-size: 24px; margin: 0; }
    .section-title { margin-top: 28px; padding-bottom: 6px; border-bottom: 1px solid #cbd5e1; font-size: 16px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 11px; page-break-inside: auto; }
    tr { page-break-inside: avoid; break-inside: avoid; }
    th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
    th { background: #f1f5f9; font-weight: 700; color: #1e3a5f; }
    .corporate-cover { min-height: 92vh; page-break-after: always; break-after: page; display: flex; flex-direction: column; justify-content: space-between; gap: 28px; padding: 16px 0 24px; }
    .cover-brand { display: flex; gap: 16px; align-items: center; min-width: 0; }
    .cover-logo { width: 120px; max-height: 80px; object-fit: contain; }
    .cover-logo-fallback { width: 76px; height: 76px; border: 2px solid #0f766e; color: #0f766e; font-weight: 700; font-size: 24px; display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
    .company-name { font-size: 19px; font-weight: 700; color: #0f172a; overflow-wrap: anywhere; }
    .company-address { max-width: 620px; margin-top: 5px; color: #64748b; overflow-wrap: anywhere; }
    .cover-title-block { border-top: 3px solid #0f766e; border-bottom: 1px solid #cbd5e1; padding: 28px 0; }
    .report-kind { color: #0f766e; font-weight: 700; margin-bottom: 8px; text-transform: uppercase; letter-spacing: .04em; }
    .report-period { margin-top: 10px; color: #475569; font-size: 16px; }
    .document-info { margin: 0 0 24px; page-break-inside: avoid; break-inside: avoid; }
    .document-info h2 { font-size: 15px; margin: 0 0 10px; }
    .doc-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 0; }
    .cover-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .doc-field { border: 1px solid #e2e8f0; padding: 8px 10px; min-width: 0; background: #f8fafc; }
    .doc-field dt { margin: 0 0 3px; color: #64748b; font-size: 10px; }
    .doc-field dd { margin: 0; font-weight: 700; color: #1e293b; overflow-wrap: anywhere; }
    .kpi-grid { page-break-inside: avoid; break-inside: avoid; }
    @media print { body { padding: 12px 16px; } }
    ${input.extraCss ?? ""}
  </style>
</head>
<body>
  ${buildCover(input.identity)}
  ${buildCorporateDocumentInfo(input.identity)}
  ${input.bodyHtml}
</body>
</html>`;
  return { html, headerTemplate, footerTemplate, displayHeaderFooter };
}
