import { chromium, type Browser, type BrowserContext } from "playwright";

const PDF_RENDER_TIMEOUT_MS = 30_000;

export class PdfRenderError extends Error {
  constructor() {
    super("PDF render failed");
    this.name = "PdfRenderError";
  }
}

type RenderHtmlToPdfOptions = {
  html: string;
  title: string;
  landscape?: boolean;
};

function launchArgs(): string[] {
  const args = ["--disable-dev-shm-usage"];
  if (process.env.PDF_CHROMIUM_NO_SANDBOX === "true") {
    args.push("--no-sandbox", "--disable-setuid-sandbox");
  }
  return args;
}

async function withTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new PdfRenderError()), PDF_RENDER_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function renderHtmlToPdf({
  html,
  title,
  landscape = false,
}: RenderHtmlToPdfOptions): Promise<Buffer> {
  if (!html.trim() || !title.trim()) throw new PdfRenderError();

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PDF_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: launchArgs(),
    });
    context = await browser.newContext({
      javaScriptEnabled: false,
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    await context.route(/.*/, async (route) => {
      const url = route.request().url();
      if (url === "about:blank" || url.startsWith("data:")) {
        await route.continue();
      } else {
        await route.abort("blockedbyclient");
      }
    });

    const page = await context.newPage();
    page.setDefaultTimeout(PDF_RENDER_TIMEOUT_MS);
    await page.emulateMedia({ media: "print" });
    await page.setContent(html, {
      waitUntil: "domcontentloaded",
      timeout: PDF_RENDER_TIMEOUT_MS,
    });
    await page.evaluate(async (safeTitle) => {
      const pageGlobal = globalThis as unknown as {
        document: { title: string; fonts: { ready: Promise<unknown> } };
      };
      if (!pageGlobal.document.title) pageGlobal.document.title = safeTitle;
      await pageGlobal.document.fonts.ready;
    }, title);

    const output = await withTimeout(page.pdf({
      format: "A4",
      landscape,
      printBackground: true,
      preferCSSPageSize: false,
      scale: 0.8,
      margin: {
        top: "12mm",
        right: "10mm",
        bottom: "12mm",
        left: "10mm",
      },
    }));
    const pdf = Buffer.from(output);
    if (pdf.length < 1_024 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new PdfRenderError();
    }
    return pdf;
  } catch {
    throw new PdfRenderError();
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

export function safePdfFilename(parts: Array<string | number>): string {
  const base = parts
    .map((part) => String(part))
    .join("-")
    .replace(/[\u0000-\u001f\u007f"/\\]/g, "-")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 96)
    .toLowerCase();
  return `${base || "rapor"}.pdf`;
}
