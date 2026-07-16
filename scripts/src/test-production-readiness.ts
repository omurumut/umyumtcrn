import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const STARTUP_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertDisposableEnvironment(): void {
  const databaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
  assert(process.env.NODE_ENV === "test", "Production readiness parent ortamı test olmalı.");
  assert(process.env.TEST_DB_DISPOSABLE === "true", "Disposable DB işareti eksik.");
  assert(databaseUrl?.hostname === "127.0.0.1" && databaseUrl.pathname === "/iso50001_test", "Disposable localhost DB zorunlu.");
  assert(process.env.E2E_ADMIN_USERNAME && process.env.E2E_TEST_PASSWORD, "Fixture credential env değerleri eksik.");
  assert(process.env.PLAYWRIGHT_BROWSERS_PATH, "İzole PLAYWRIGHT_BROWSERS_PATH zorunlu.");
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

type RunningProduction = {
  child: ChildProcess;
  baseUrl: string;
  logs(): string;
};

async function startProduction(browserPath: string): Promise<RunningProduction> {
  const repoRoot = resolve(import.meta.dirname, "../..");
  const port = await reservePort();
  let captured = "";
  const child = spawn(process.execPath, ["--enable-source-maps", resolve(repoRoot, "artifacts/api-server/dist/index.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      PLAYWRIGHT_BROWSERS_PATH: browserPath,
      PDF_CHROMIUM_EXECUTABLE_PATH: undefined,
      PDF_CHROMIUM_NO_SANDBOX: "false",
      ENABLE_MGM_BOOTSTRAP: "false",
      ENABLE_MGM_SCHEDULER: "false",
      ENABLE_DEMO_SEED: "false",
      ENABLE_SEED: "false",
      ENABLE_BOOTSTRAP: "false",
      ENABLE_DEFAULT_SUPERADMIN: "false",
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const append = (chunk: Buffer) => { captured = `${captured}${chunk.toString("utf8")}`.slice(-50_000); };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error("Production process readiness öncesinde sonlandı.");
      try {
        const response = await fetch(`${baseUrl}/api/healthz`);
        if (response.ok) return { child, baseUrl, logs: () => captured };
      } catch {
        // Readiness polling intentionally retries connection refusal.
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    }
    throw new Error("Production readiness zaman aşımına uğradı.");
  } catch (error) {
    if (child.exitCode === null) child.kill("SIGTERM");
    throw error;
  }
}

async function stopProduction(running: RunningProduction | null): Promise<void> {
  if (!running || running.child.exitCode !== null) return;
  const closed = new Promise<void>((resolveClose) => running.child.once("close", () => resolveClose()));
  running.child.kill("SIGTERM");
  await Promise.race([
    closed,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Production process SIGTERM sonrası kapanmadı.")), SHUTDOWN_TIMEOUT_MS)),
  ]);
}

async function login(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: process.env.E2E_ADMIN_USERNAME, password: process.env.E2E_TEST_PASSWORD }),
  });
  assert(response.status === 200, `Production login beklenen 200 yerine ${response.status} döndü.`);
  const body = await response.json() as { token?: unknown };
  assert(typeof body.token === "string" && body.token.length > 0, "Production login token üretmedi.");
  return body.token;
}

async function fetchPdf(baseUrl: string, token: string): Promise<Response> {
  return fetch(`${baseUrl}/api/reports/energy-targets/pdf?year=2026`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function assertPdf(response: Response): Promise<void> {
  assert(response.status === 200, `PDF beklenen 200 yerine ${response.status} döndü.`);
  assert(response.headers.get("content-type")?.startsWith("application/pdf"), "PDF MIME geçersiz.");
  assert(/^attachment; filename="[a-z0-9._-]+\.pdf"$/i.test(response.headers.get("content-disposition") ?? ""), "PDF filename güvenli değil.");
  const body = Buffer.from(await response.arrayBuffer());
  assert(body.length >= 1_024 && body.subarray(0, 5).toString("ascii") === "%PDF-", "PDF magic/uzunluk geçersiz.");
}

async function assertStaticAndApi(baseUrl: string): Promise<void> {
  const health = await fetch(`${baseUrl}/api/healthz`);
  assert(health.status === 200 && (await health.json() as { status?: unknown }).status === "ok", "Health response geçersiz.");
  const unauthenticated = await fetch(`${baseUrl}/api/reports`);
  assert(unauthenticated.status === 401, "Protected API unauthenticated 401 dönmedi.");
  const unknownApi = await fetch(`${baseUrl}/api/not-a-real-endpoint`);
  assert(unknownApi.status === 404 && unknownApi.headers.get("content-type")?.includes("application/json"), "Unknown API SPA fallback'e düştü.");
  const dotfile = await fetch(`${baseUrl}/.env`);
  assert(dotfile.status === 404 && !(await dotfile.text()).includes("<!doctype html>"), "Dotfile isteği güvenli 404 dönmedi.");

  for (const route of ["/", "/login", "/sayaclar"]) {
    const response = await fetch(`${baseUrl}${route}`);
    const html = await response.text();
    assert(response.status === 200 && /<!doctype html>/i.test(html), `${route} SPA artifact dönmedi.`);
    assert(response.headers.get("cache-control") === "no-cache", `${route} no-cache değil.`);
    if (route === "/") {
      const asset = html.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1];
      assert(asset, "Hashed frontend asset bulunamadı.");
      const assetResponse = await fetch(`${baseUrl}${asset}`);
      assert(assetResponse.status === 200, "Hashed frontend asset sunulamadı.");
      assert(assetResponse.headers.get("cache-control")?.includes("immutable"), "Hashed asset immutable cache almıyor.");
    }
  }
}

async function main(): Promise<void> {
  assertDisposableEnvironment();
  let running: RunningProduction | null = null;
  let missingBrowserDirectory: string | null = null;
  try {
    running = await startProduction(process.env.PLAYWRIGHT_BROWSERS_PATH!);
    await assertStaticAndApi(running.baseUrl);
    const token = await login(running.baseUrl);
    await assertPdf(await fetchPdf(running.baseUrl, token));
    await Promise.all([1, 2, 3].map(async () => assertPdf(await fetchPdf(running!.baseUrl, token))));
    await stopProduction(running);
    running = null;

    missingBrowserDirectory = await mkdtemp(join(tmpdir(), "iso50001-missing-browser-"));
    running = await startProduction(missingBrowserDirectory);
    const missingToken = await login(running.baseUrl);
    const missingResponse = await fetchPdf(running.baseUrl, missingToken);
    const missingBody = await missingResponse.text();
    assert(missingResponse.status >= 500 && missingResponse.status < 600, "Missing browser kontrollü 5xx dönmedi.");
    assert(missingResponse.headers.get("content-type")?.includes("application/json"), "Missing browser JSON hata dönmedi.");
    assert(!/stack|node_modules|ms-playwright|chromium-[0-9]|[A-Z]:\\/i.test(missingBody), "Missing browser response path/stack sızdırdı.");
    assert((await fetch(`${running.baseUrl}/api/healthz`)).status === 200, "Missing browser sonrası API çalışmıyor.");
  } catch (error) {
    const safeLogs = running?.logs().replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted-database-url]").slice(-2_000);
    if (safeLogs) console.error(`[test-production-readiness] Son process logları:\n${safeLogs}`);
    throw error;
  } finally {
    await stopProduction(running).catch(() => undefined);
    if (missingBrowserDirectory) await rm(missingBrowserDirectory, { recursive: true, force: true });
  }
  console.log("[test-production-readiness] Static, API, PDF, concurrency, missing-browser ve cleanup doğrulandı.");
}

main().catch((error: unknown) => {
  console.error(`[test-production-readiness] Başarısız: ${error instanceof Error ? error.message : "Bilinmeyen hata"}`);
  process.exitCode = 1;
});
