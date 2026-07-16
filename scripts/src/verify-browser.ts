import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { chromium, type Browser } from "playwright";

async function main(): Promise<void> {
  const executablePath = chromium.executablePath();
  await access(executablePath, process.platform === "win32" ? constants.F_OK : constants.X_OK);

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath,
      args: process.env.PDF_CHROMIUM_NO_SANDBOX === "true"
        ? ["--no-sandbox", "--disable-setuid-sandbox"]
        : [],
    });
    const context = await browser.newContext({
      javaScriptEnabled: false,
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    const page = await context.newPage();
    await page.setContent("<!doctype html><title>Browser readiness</title><p>ISO 50001 EMS</p>");
    const output = await page.pdf({ format: "A4" });
    if (output.length < 1_024 || Buffer.from(output).subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("Chromium PDF doğrulaması geçersiz çıktı üretti.");
    }
    await context.close();
  } finally {
    await browser?.close().catch(() => undefined);
  }

  console.log("[verify-browser] Chromium launch, page ve PDF doğrulaması başarılı.");
}

main().catch((error: unknown) => {
  console.error(`[verify-browser] Başarısız: ${error instanceof Error ? error.message : "Bilinmeyen hata"}`);
  process.exitCode = 1;
});
