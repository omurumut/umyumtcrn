import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { resolve } from "node:path";
import { chromium, type Page, type Route } from "playwright";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address() as AddressInfo;
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

async function startDashboard(): Promise<{ baseUrl: string; logs: () => string; close: () => Promise<void> }> {
  const repoRoot = resolve(import.meta.dirname, "../..");
  const port = await reservePort();
  let output = "";
  const dashboardRoot = resolve(repoRoot, "artifacts", "ems-dashboard");
  const viteCli = resolve(dashboardRoot, "node_modules", "vite", "bin", "vite.js");
  const child: ChildProcess = spawn(
    process.execPath,
    [viteCli, "--config", "vite.config.ts", "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: dashboardRoot,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, NODE_ENV: "test" },
    },
  );
  child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });

  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Dashboard erken kapandi: ${output.slice(-1200)}`);
    try {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(500) });
      if (response.status === 200) {
        return {
          baseUrl,
          logs: () => output,
          close: async () => {
            child.kill("SIGTERM");
            await Promise.race([
              new Promise<void>((resolveClose) => child.once("close", () => resolveClose())),
              delay(15_000).then(() => {
                child.kill("SIGKILL");
                throw new Error("Dashboard shutdown zaman asimi.");
              }),
            ]);
          },
        };
      }
    } catch {
      // Dev server readiness polling intentionally retries connection refusal.
    }
    await delay(250);
  }
  child.kill("SIGKILL");
  throw new Error(`Dashboard readiness zaman asimi: ${output.slice(-1200)}`);
}

const archiveItem = {
  id: 7001,
  reportType: "annual_energy_performance",
  title: "E2E Denetim Izlenebilirlik Raporu",
  outputName: "e2e-denetim-izlenebilirlik.html",
  status: "failed",
  sizeBytes: 24576,
  generatedBy: { id: 12, name: "E2E Admin" },
  generatedAt: "2026-07-23T09:00:00.000Z",
  completedAt: "2026-07-23T09:01:30.000Z",
  year: 2026,
  periodLabel: "2026",
  downloadable: false,
  failureCategory: "render_failed",
  lifecycle: {
    deletedAt: null,
    purgeEligibleAt: null,
    purgedAt: null,
    retentionExpiresAt: "2036-07-23T09:01:30.000Z",
    deletionLocked: false,
  },
};

const detailResponse = {
  archive: {
    id: archiveItem.id,
    reportType: archiveItem.reportType,
    reportName: "Yillik Enerji Performansi",
    status: "failed",
    fileName: archiveItem.outputName,
    mimeType: "text/html; charset=utf-8",
    sizeBytes: archiveItem.sizeBytes,
    checksum: "b".repeat(64),
    createdAt: "2026-07-23T09:00:00.000Z",
    completedAt: null,
    failedAt: "2026-07-23T09:01:30.000Z",
    deletedAt: null,
    restoredAt: null,
    expiresAt: archiveItem.lifecycle.retentionExpiresAt,
    lifecycleVersion: 3,
    canDownload: false,
    canRestore: false,
  },
  scope: {
    companyId: 101,
    unitId: 201,
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
  },
  generation: {
    generatedByUserId: 12,
    generatedAt: archiveItem.generatedAt,
    snapshotId: 9001,
    settingsProfileVersion: 7,
    reportTypeSettingsVersion: 11,
  },
  document: {
    documentNumber: "ENR-RPT-001",
    revisionNumber: "R1",
    revisionDate: "2026-07-23",
    preparedBy: "Hazirlayan",
    checkedBy: "Kontrol",
    approvedBy: "Onay",
    confidentialityLevel: "internal",
    footerText: "ISO 50001",
  },
  dataScope: {
    schemaVersion: 1,
    period: {
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      year: 2026,
      timezone: "Europe/Istanbul",
    },
    sources: [
      {
        sourceType: "annual_consumption",
        recordCount: 12,
        identityHash: "a".repeat(64),
        identityAlgorithm: "sha256",
        identitySchemaVersion: 1,
      },
    ],
    qualityWarnings: [
      {
        code: "MISSING_CONSUMPTION_MONTHS",
        severity: "warning",
        sourceType: "annual_consumption",
        count: 1,
        periods: ["2026-03"],
      },
    ],
    isPartial: true,
    manifestHash: "c".repeat(64),
  },
  failure: {
    category: "render_failed",
    message: "Rapor ciktisi olusturulamadi.",
    retryable: true,
  },
  retry: {
    canRetry: true,
    retryOfArchiveId: null,
    latestRetryArchiveId: null,
    latestRetryStatus: null,
    reason: null,
  },
  lifecycle: {
    isStale: false,
  },
};

const retryDetailResponse = {
  ...detailResponse,
  archive: {
    ...detailResponse.archive,
    id: 7002,
    status: "completed",
    fileName: "e2e-denetim-izlenebilirlik-retry.html",
    completedAt: "2026-07-23T09:03:30.000Z",
    failedAt: null,
    canDownload: true,
  },
  failure: {
    category: null,
    message: null,
    retryable: false,
  },
  retry: {
    canRetry: false,
    retryOfArchiveId: 7001,
    latestRetryArchiveId: null,
    latestRetryStatus: null,
    reason: null,
  },
  lifecycle: {
    isStale: false,
  },
};

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(body),
  });
}

async function installApiMocks(page: Page): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (request.method() === "GET" && path === "/api/reports/archive") {
      assert(url.searchParams.get("limit") === "10", "Archive list page size korunmali.");
      await fulfillJson(route, { items: [archiveItem], total: 1, limit: 10, offset: 0, hasNext: false });
      return;
    }
    if (request.method() === "GET" && path === `/api/reports/archive/${archiveItem.id}/detail`) {
      await delay(100);
      await fulfillJson(route, detailResponse);
      return;
    }
    if (request.method() === "POST" && path === `/api/reports/archive/${archiveItem.id}/retry`) {
      await fulfillJson(route, { sourceArchiveId: archiveItem.id, newArchiveId: 7002, status: "completed" });
      return;
    }
    if (request.method() === "GET" && path === "/api/reports/archive/7002/detail") {
      await fulfillJson(route, retryDetailResponse);
      return;
    }
    if (request.method() === "GET" && path === "/api/reports") {
      await fulfillJson(route, []);
      return;
    }
    if (request.method() === "GET" && path === "/api/units") {
      await fulfillJson(route, [{ id: 201, companyId: 101, name: "E2E Birim", location: "Test", active: true }]);
      return;
    }
    await fulfillJson(route, []);
  });
}

async function main(): Promise<void> {
  const dashboard = await startDashboard();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await context.addInitScript(`
      localStorage.setItem("eys_token", "e2e-token");
      localStorage.setItem("eys_user", JSON.stringify({
        id: 12,
        username: "e2e_admin",
        name: "E2E Admin",
        role: "admin",
        unitId: null,
        companyId: 101,
      }));
    `);
    const page = await context.newPage();
    await installApiMocks(page);
    await page.goto(`${dashboard.baseUrl}/raporlar`, { waitUntil: "domcontentloaded" });

    await page.getByTestId(`archive-detail-open-${archiveItem.id}`).click();
    const detailSheet = page.getByTestId("archive-detail-sheet");
    await detailSheet.waitFor({ state: "visible" });
    await detailSheet.getByText("E2E Denetim Izlenebilirlik Raporu").waitFor();
    await page.getByTestId("archive-detail-manifest").waitFor();

    await detailSheet.getByRole("heading", { name: "Veri kapsam manifesti" }).waitFor();
    await detailSheet.getByRole("heading", { name: "Kismi veri kapsami" }).waitFor();
    await detailSheet.getByText("Eksik tuketim donemi").waitFor();
    await detailSheet.getByText("cccccccc...cccccccc").first().waitFor();
    await detailSheet.getByText("aaaaaaaa...aaaaaaaa").first().waitFor();
    await detailSheet.getByRole("button", { name: "Yeniden Dene" }).click();
    const retryDialog = page.getByRole("alertdialog", { name: "Rapor yeniden denensin mi?" });
    await retryDialog.getByText("Yeni rapor guncel veri ve rapor ayarlariyla olusturulur").waitFor();
    await retryDialog.getByRole("button", { name: "Yeniden Dene" }).click();
    await page.getByText("Yeni arsiv kaydi #7002 olusturuldu.").waitFor();
    await detailSheet.getByText("Archive ID").waitFor();
    await detailSheet.getByText("7002").waitFor();

    const bodyText = await page.locator("body").innerText();
    assert(!bodyText.includes("companies/"), "UI storage path sızdırmamalı.");
    assert(!bodyText.includes(detailResponse.dataScope.manifestHash), "Manifest hash varsayilan gorunumde tam basilmamali.");
    assert(!bodyText.includes(detailResponse.dataScope.sources[0]!.identityHash), "Source identity hash varsayilan gorunumde tam basilmamali.");

    await page.getByRole("button", { name: "Sil" }).waitFor({ state: "visible" });

    await browser.close();
    await dashboard.close();
    console.log("Report detail UX browser smoke passed.");
  } catch (error) {
    await browser.close().catch(() => undefined);
    await dashboard.close().catch(() => undefined);
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nDashboard loglari:\n${dashboard.logs().slice(-1500)}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
