import { fileURLToPath, pathToFileURL } from "node:url";
import path, { resolve } from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const layoutModule = await import(pathToFileURL(resolve(__dirname, "../../artifacts/api-server/src/lib/report-pdf-layout.ts")).href) as {
  buildCorporateReportHtml(input: {
    identity: Record<string, unknown>;
    bodyHtml: string;
    extraCss?: string;
  }): { html: string; headerTemplate: string; footerTemplate: string; displayHeaderFooter: boolean };
  logoBufferToDataUri(input: { mimeType: string | null | undefined; content: Buffer | null | undefined; maxBytes?: number }): string | null;
};

const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const tinyJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const pngDataUri = layoutModule.logoBufferToDataUri({ mimeType: "image/png", content: tinyPng });
const jpegDataUri = layoutModule.logoBufferToDataUri({ mimeType: "image/jpeg", content: tinyJpeg });
assert(pngDataUri?.startsWith("data:image/png;base64,"), "PNG logo data URI olusmadi.");
assert(jpegDataUri?.startsWith("data:image/jpeg;base64,"), "JPEG logo data URI olusmadi.");
assert(layoutModule.logoBufferToDataUri({ mimeType: "image/svg+xml", content: Buffer.from("<svg></svg>") }) === null, "SVG logo kabul edildi.");
assert(layoutModule.logoBufferToDataUri({ mimeType: "image/png", content: Buffer.concat([tinyPng, Buffer.alloc(20)]), maxBytes: tinyPng.length }) === null, "Buyuk logo kabul edildi.");
assert(layoutModule.logoBufferToDataUri({ mimeType: "image/png", content: null }) === null, "Eksik logo kabul edildi.");

const rendered = layoutModule.buildCorporateReportHtml({
  identity: {
    companyName: "Acme <script>alert(1)</script>",
    companyLegalName: "ACME Enerji A.S.",
    companyShortName: "ACME",
    companyAddress: "Organize Sanayi <b>Bolgesi</b>",
    reportTitle: "Enerji Hedefleri Raporu",
    reportDisplayName: "Enerji hedefleri yonetim raporu",
    reportPeriod: "2026",
    unitLabel: "Uretim <Unit>",
    documentNumber: "DOC-<42>",
    revisionNumber: "R&1",
    revisionDate: "2026-07-23",
    preparedBy: "Hazir <img>",
    checkedBy: "Kontrol <script>",
    approvedBy: "Onay & Yetkili",
    confidentialityLabel: "Gizli <x>",
    footerText: "Footer <script>alert(1)</script>",
    generatedAt: new Date("2026-07-23T10:15:00.000Z"),
    generatedByName: "Rapor Kullanici",
    locale: "tr-TR",
    showSignatureFields: true,
    showPageNumbers: true,
    logoDataUri: pngDataUri,
    logoAltText: "Logo <alt>",
  },
  bodyHtml: "<section><p>Guvende kalan icerik</p></section>",
});

assert(rendered.displayHeaderFooter === true, "Header/footer aktif degil.");
assert(rendered.html.includes("Enerji Hedefleri Raporu"), "Kapakta rapor adi yok.");
assert(rendered.html.includes("ACME Enerji A.S."), "Kapakta ticari unvan yok.");
assert(rendered.html.includes("DOC-&lt;42&gt;"), "Dokuman numarasi escape edilmedi.");
assert(rendered.html.includes("R&amp;1"), "Revizyon numarasi escape edilmedi.");
assert(rendered.html.includes("Hazir &lt;img&gt;"), "Hazirlayan escape edilmedi.");
assert(rendered.html.includes("Kontrol &lt;script&gt;"), "Kontrol eden escape edilmedi.");
assert(rendered.html.includes("Onay &amp; Yetkili"), "Onaylayan escape edilmedi.");
assert(rendered.footerTemplate.includes("Footer &lt;script&gt;alert(1)&lt;/script&gt;"), "Footer escape edilmedi.");
assert(!rendered.html.includes("<script>alert(1)</script>"), "Script tag HTML'e sizdi.");
assert(!rendered.html.includes("storageKey") && !rendered.footerTemplate.includes("companies/"), "Header/footer internal storage bilgisi iceriyor.");
assert(rendered.footerTemplate.includes("pageNumber") && rendered.footerTemplate.includes("totalPages"), "Sayfa numarasi placeholder'i yok.");
assert(rendered.html.includes("data:image/png;base64,"), "Gecerli logo kullanilmadi.");

const noNumbers = layoutModule.buildCorporateReportHtml({
  identity: {
    companyName: "ACME",
    reportTitle: "Enerji Performansi",
    reportDisplayName: "Enerji performansi izleme raporu",
    reportPeriod: "2026",
    generatedAt: new Date("2026-07-23T10:15:00.000Z"),
    showPageNumbers: false,
    logoDataUri: "https://example.test/logo.png",
  },
  bodyHtml: "<p>body</p>",
});
assert(!noNumbers.footerTemplate.includes("pageNumber") && !noNumbers.footerTemplate.includes("totalPages"), "showPageNumbers=false iken placeholder var.");
assert(!noNumbers.html.includes("https://example.test/logo.png"), "External HTTP logo HTML'e girdi.");
assert(noNumbers.html.includes("cover-logo-fallback"), "Gecersiz logo fallback uretmedi.");

console.log(JSON.stringify({ reportPdfLayoutScenarios: 20 }, null, 2));
