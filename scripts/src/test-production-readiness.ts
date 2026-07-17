import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const ALLOWED_ORIGIN = "https://allowed.example";
const UNKNOWN_ORIGIN = "https://unknown.example";
const METRICS_TOKEN = "metrics-readiness-token-000000000000";
const WRONG_METRICS_TOKEN = "wrong-readiness-token-0000000000000";

const STARTUP_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 20_000;
const DOCKER_TIMEOUT_MS = 15_000;
const TEST_DB_LABEL = "com.iso50001-ems.test-db";
const RUN_LABEL = `${TEST_DB_LABEL}.run`;
const METRICS_ENV: NodeJS.ProcessEnv = {
  ENABLE_METRICS_ENDPOINT: "true",
  METRICS_ACCESS_TOKEN: METRICS_TOKEN,
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function assertDisposableEnvironment(): void {
  const databaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
  assert(process.env.NODE_ENV === "test", "Production readiness parent ortamı test olmalı.");
  assert(process.env.TEST_DB_DISPOSABLE === "true", "Disposable DB işareti eksik.");
  assert(databaseUrl?.hostname === "127.0.0.1" && databaseUrl.pathname === "/iso50001_test", "Disposable localhost DB zorunlu.");
  assert(process.env.TEST_DB_CONTAINER_ID && /^[a-f0-9]{64}$/i.test(process.env.TEST_DB_CONTAINER_ID), "Disposable DB container ID eksik.");
  assert(process.env.TEST_DB_RUN_ID && /^[a-f0-9]{24}$/i.test(process.env.TEST_DB_RUN_ID), "Disposable DB run ID eksik.");
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

async function runDocker(args: string[]): Promise<string> {
  return new Promise((resolveRun, reject) => {
    const child = spawn("docker", args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Disposable Docker lifecycle komutu zaman aşımına uğradı."));
    }, DOCKER_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolveRun(stdout.trim());
      else reject(new Error(`Disposable Docker lifecycle komutu başarısız oldu: ${stderr.trim() || code}`));
    });
  });
}

async function assertTestContainerOwnership(): Promise<string> {
  const containerId = process.env.TEST_DB_CONTAINER_ID!;
  const runId = process.env.TEST_DB_RUN_ID!;
  const format = `{{.Id}}|{{index .Config.Labels "${TEST_DB_LABEL}"}}|{{index .Config.Labels "${RUN_LABEL}"}}`;
  const inspected = await runDocker(["inspect", "--format", format, containerId]);
  const [actualId, fixedLabel, actualRunId] = inspected.split("|");
  assert(actualId === containerId && fixedLabel === "true" && actualRunId === runId, "Disposable DB container sahipliği doğrulanamadı.");
  return containerId;
}

type RunningProduction = {
  child: ChildProcess;
  baseUrl: string;
  logs(): string;
};

async function spawnProduction(browserPath: string, overrides: NodeJS.ProcessEnv = {}): Promise<RunningProduction> {
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
      MGM_SCHEDULER_INSTANCE_MODE: undefined,
      ENABLE_DEMO_SEED: "false",
      ENABLE_SEED: "false",
      ENABLE_BOOTSTRAP: "false",
      ENABLE_SUPERADMIN_BOOTSTRAP: "false",
      CORS_ALLOWED_ORIGINS: ` ${ALLOWED_ORIGIN},${ALLOWED_ORIGIN} `,
      ...overrides,
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const append = (chunk: Buffer): void => {
    captured = `${captured}${chunk.toString("utf8")}`.slice(-50_000);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  return { child, baseUrl: `http://127.0.0.1:${port}`, logs: () => captured };
}

async function waitForReady(running: RunningProduction): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (running.child.exitCode !== null) throw new Error("Production process readiness öncesinde sonlandı.");
    try {
      const response = await fetch(`${running.baseUrl}/api/readyz`);
      if (response.status === 200) return;
    } catch {
      // Readiness polling intentionally retries connection refusal.
    }
    await delay(200);
  }
  throw new Error("Production readiness zaman aşımına uğradı.");
}

async function startProduction(browserPath: string, overrides: NodeJS.ProcessEnv = {}): Promise<RunningProduction> {
  const running = await spawnProduction(browserPath, overrides);
  try {
    await waitForReady(running);
    return running;
  } catch (error) {
    if (running.child.exitCode === null) running.child.kill("SIGTERM");
    throw error;
  }
}

async function stopProduction(running: RunningProduction | null, signal: "SIGTERM" | "SIGINT" = "SIGTERM"): Promise<void> {
  if (!running || running.child.exitCode !== null) return;
  const closed = new Promise<void>((resolveClose) => running.child.once("close", () => resolveClose()));
  running.child.kill(signal);
  await Promise.race([
    closed,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Production process ${signal} sonrası kapanmadı.`)), SHUTDOWN_TIMEOUT_MS)),
  ]);
  if (process.platform !== "win32") {
    assert(/Graceful shutdown started/.test(running.logs()), `${signal} graceful shutdown handler çalışmadı.`);
    assert(/Graceful shutdown complete/.test(running.logs()), `${signal} graceful shutdown tamamlanmadı.`);
  }
  await assertListenerClosed(running.baseUrl);
}

async function assertListenerClosed(baseUrl: string): Promise<void> {
  try {
    await fetch(`${baseUrl}/api/healthz`);
    throw new Error("Production listener shutdown sonrasında açık kaldı.");
  } catch (error) {
    if (error instanceof Error && error.message === "Production listener shutdown sonrasında açık kaldı.") throw error;
  }
}

async function waitForLog(running: RunningProduction, pattern: RegExp): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (pattern.test(running.logs())) return;
    await delay(50);
  }
  throw new Error(`Beklenen lifecycle logu oluşmadı: ${pattern.source}`);
}

async function login(baseUrl: string, origin?: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify({ username: process.env.E2E_ADMIN_USERNAME, password: process.env.E2E_TEST_PASSWORD }),
  });
  assert(response.status === 200, `Production login beklenen 200 yerine ${response.status} döndü.`);
  const body = await response.json() as { token?: unknown };
  assert(typeof body.token === "string" && body.token.length > 0, "Production login token üretmedi.");
  return body.token;
}

async function fetchMetrics(baseUrl: string, token?: string, origin?: string): Promise<Response> {
  return fetch(`${baseUrl}/api/metrics`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
  });
}

async function assertMetricsDisabled(baseUrl: string): Promise<void> {
  const response = await fetchMetrics(baseUrl, METRICS_TOKEN);
  assert(response.status === 404, "Metrics endpoint feature flag kapalıyken 404 dönmedi.");
  assertSecurityHeaders(response);
}

async function assertMetricsAuth(baseUrl: string, appToken: string): Promise<void> {
  const missing = await fetchMetrics(baseUrl);
  assert(missing.status === 401, "Metrics endpoint token yokken 401 dönmedi.");
  assertSecurityHeaders(missing);

  const wrong = await fetchMetrics(baseUrl, WRONG_METRICS_TOKEN);
  assert(wrong.status === 403, "Metrics endpoint yanlış token ile 403 dönmedi.");
  assertSecurityHeaders(wrong);

  const appBearer = await fetchMetrics(baseUrl, appToken);
  assert(appBearer.status === 403, "Application bearer token metrics endpointine erişti.");
  assertSecurityHeaders(appBearer);

  const unknownOrigin = await fetchMetrics(baseUrl, METRICS_TOKEN, UNKNOWN_ORIGIN);
  assert(unknownOrigin.status === 403, "Metrics endpoint unknown Origin politikasını korumadı.");
  assertSecurityHeaders(unknownOrigin);

  const ok = await fetchMetrics(baseUrl, METRICS_TOKEN, ALLOWED_ORIGIN);
  assert(ok.status === 200, "Metrics endpoint doğru token ile 200 dönmedi.");
  assert(ok.headers.get("content-type")?.includes("text/plain"), "Metrics endpoint text/plain dönmedi.");
  assert(ok.headers.get("content-type")?.includes("version=0.0.4"), "Metrics endpoint Prometheus content type taşımıyor.");
  assertSecurityHeaders(ok);
}

function assertNoMetricsLeak(metricsText: string): void {
  for (const forbidden of [
    "DATABASE_URL",
    "Bearer",
    "password",
    "token",
    "tokenHash",
    "authorization",
    "cookie",
    process.env.E2E_ADMIN_USERNAME ?? "",
    process.env.E2E_TEST_PASSWORD ?? "",
    "123abc",
    ALLOWED_ORIGIN,
    UNKNOWN_ORIGIN,
  ]) {
    if (forbidden) assert(!metricsText.includes(forbidden), `Metrics çıktısı hassas değer içeriyor: ${forbidden}`);
  }
  assert(!/postgres(?:ql)?:\/\//i.test(metricsText), "Metrics çıktısı database URL içeriyor.");
}

async function assertMetricsOutput(baseUrl: string): Promise<void> {
  const response = await fetchMetrics(baseUrl, METRICS_TOKEN);
  assert(response.status === 200, "Metrics okunamadı.");
  const body = await response.text();
  assertNoMetricsLeak(body);
  for (const expected of [
    "iso50001_http_requests_total",
    "iso50001_http_request_duration_seconds_bucket",
    "iso50001_http_request_duration_seconds_count",
    "iso50001_http_request_duration_seconds_sum",
    "iso50001_http_requests_active",
    "iso50001_auth_events_total",
    "iso50001_db_events_total",
    "iso50001_db_pool_connections",
    "iso50001_pdf_renders_total",
    "iso50001_pdf_render_duration_seconds_count",
    "iso50001_import_attempts_total",
    "iso50001_mgm_sync_total",
    "iso50001_audit_events_total",
    "iso50001_audit_write_failures_total",
    "iso50001_process_resident_memory_bytes",
    "iso50001_nodejs_eventloop_lag_seconds",
  ]) {
    assert(body.includes(expected), `Metrics çıktısında beklenen seri yok: ${expected}`);
  }
  assert(/route="\/api\/healthz"/.test(body), "Health route normalize edilmedi.");
  assert(/route="\/api\/readyz"/.test(body), "Ready route normalize edilmedi.");
  assert(/route="unknown"/.test(body), "Unknown route tek label altında toplanmadı.");
  assert(/status_class="4xx"/.test(body), "4xx status class metriği oluşmadı.");
  assert(/status_class="5xx"/.test(body), "5xx status class metriği oluşmadı.");
  assert(/event="readiness_check",outcome="failure"/.test(body), "DB outage readiness failure metriği oluşmadı.");
  assert(/event="login_success",reason="none"/.test(body), "Login success metriği oluşmadı.");
  assert(/event="login_failure",reason="invalid_credentials"/.test(body), "Login failure metriği oluşmadı.");
  assert(/event="login_rate_limited",reason="rate_limited"/.test(body), "Login rate-limit metriği oluşmadı.");
  assert(/report_type="energy_targets",outcome="success"/.test(body), "PDF success metriği oluşmadı.");
}

async function assertMetricsPerformanceSmoke(baseUrl: string): Promise<void> {
  const startedAt = Date.now();
  const totalRequests = 1_000;
  let nextRequest = 0;
  async function worker(): Promise<void> {
    while (nextRequest < totalRequests) {
      nextRequest += 1;
      const response = await fetch(`${baseUrl}/api/healthz`);
      assert(response.status === 200, "Metrics performance smoke health request başarısız oldu.");
    }
  }
  await Promise.all(Array.from({ length: 20 }, () => worker()));
  const durationMs = Date.now() - startedAt;
  assert(durationMs < 30_000, "Metrics performance smoke makul sürede tamamlanmadı.");

  const metricsResponse = await fetchMetrics(baseUrl, METRICS_TOKEN);
  assert(metricsResponse.status === 200, "Metrics performance smoke sonrası metrics okunamadı.");
  const metricsText = await metricsResponse.text();
  const activeGauge = metricsText.match(/^iso50001_http_requests_active(?:\{[^}]*\})? ([0-9.]+)$/m);
  assert(activeGauge, "Active request gauge bulunamadı.");
  const activeRequests = Number(activeGauge[1]);
  assert(Number.isFinite(activeRequests) && activeRequests >= 0 && activeRequests <= 1, "Active request gauge leak gösteriyor.");
  assertNoMetricsLeak(metricsText);
}

async function fetchPdf(baseUrl: string, token: string, origin?: string): Promise<Response> {
  return fetch(`${baseUrl}/api/reports/energy-targets/pdf?year=2026`, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(origin ? { Origin: origin } : {}),
    },
  });
}

function assertSecurityHeaders(response: Response, production = true): void {
  assert(response.headers.get("x-content-type-options") === "nosniff", "Nosniff header eksik.");
  assert(response.headers.get("x-frame-options") === "DENY", "Frame protection eksik.");
  assert(response.headers.get("referrer-policy") === "strict-origin-when-cross-origin", "Referrer Policy eksik.");
  assert(
    response.headers.get("permissions-policy") === "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Permissions Policy eksik.",
  );
  if (production) {
    assert(response.headers.get("strict-transport-security") === "max-age=31536000; includeSubDomains", "Production HSTS eksik.");
    const csp = response.headers.get("content-security-policy") ?? "";
    assert(csp.includes("default-src 'self'") && csp.includes("frame-ancestors 'none'"), "Production CSP eksik.");
    assert(csp.includes("script-src 'self'") && !csp.includes("unsafe-eval"), "Production script CSP güvensiz.");
  } else {
    assert(response.headers.get("strict-transport-security") === null, "Development HSTS içermemeli.");
    assert(response.headers.get("content-security-policy") === null, "Development API CSP içermemeli.");
  }
}

async function assertCorsPolicy(baseUrl: string): Promise<void> {
  const allowed = await fetch(`${baseUrl}/api/healthz`, { headers: { Origin: ALLOWED_ORIGIN } });
  assert(allowed.status === 200, "Allowed origin read reddedildi.");
  assert(allowed.headers.get("access-control-allow-origin") === ALLOWED_ORIGIN, "Allowed origin exact yansıtılmadı.");
  assert(allowed.headers.get("vary")?.toLowerCase().includes("origin"), "Vary Origin eksik.");
  assert(allowed.headers.get("access-control-allow-credentials") === null, "CORS credentials açık olmamalı.");

  const unknown = await fetch(`${baseUrl}/api/healthz`, { headers: { Origin: UNKNOWN_ORIGIN } });
  assert(unknown.status === 403 && unknown.headers.get("access-control-allow-origin") === null, "Unknown origin güvenli reddedilmedi.");
  assertSecurityHeaders(unknown);

  const originless = await fetch(`${baseUrl}/api/healthz`);
  assert(originless.status === 200 && originless.headers.get("access-control-allow-origin") === null, "Origin'siz request politikası bozuk.");

  const allowedPreflight = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "OPTIONS",
    headers: {
      Origin: ALLOWED_ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, content-type",
    },
  });
  assert(allowedPreflight.status === 204 && (await allowedPreflight.text()) === "", "Allowed preflight 204/boş değil.");
  assert(allowedPreflight.headers.get("access-control-allow-headers") === "Authorization, Content-Type", "Preflight allowed headers hatalı.");
  assert(allowedPreflight.headers.get("access-control-expose-headers") === "Content-Disposition, Retry-After", "Exposed headers eksik.");

  for (const headers of [
    { Origin: UNKNOWN_ORIGIN, "Access-Control-Request-Method": "POST" },
    { Origin: ALLOWED_ORIGIN, "Access-Control-Request-Method": "TRACE" },
    { Origin: ALLOWED_ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-debug" },
  ]) {
    const response = await fetch(`${baseUrl}/api/auth/logout`, { method: "OPTIONS", headers });
    assert(response.status === 403 && response.headers.get("access-control-allow-origin") === null, "Rejected preflight CORS header taşıyor.");
  }

  const mutationToken = await login(baseUrl, ALLOWED_ORIGIN);
  const validationError = await fetch(`${baseUrl}/api/units?companyId=123abc`, {
    headers: { Authorization: `Bearer ${mutationToken}`, Origin: ALLOWED_ORIGIN },
  });
  assert(validationError.status === 400, "Validation error 400 dönmedi.");
  assertSecurityHeaders(validationError);
  const rejectedMutation = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${mutationToken}`, Origin: UNKNOWN_ORIGIN },
  });
  assert(rejectedMutation.status === 403, "Unknown-origin mutation reddedilmedi.");
  assert((await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${mutationToken}` } })).status === 200, "Rejected mutation session'ı değiştirdi.");
  const allowedMutation = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${mutationToken}`, Origin: ALLOWED_ORIGIN },
  });
  assert(allowedMutation.status === 204, "Allowed-origin mutation çalışmadı.");
  assert((await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${mutationToken}` } })).status === 401, "Allowed logout session'ı revoke etmedi.");

  let rateLimited: Response | null = null;
  for (let attempt = 0; attempt < 9; attempt += 1) {
    rateLimited = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ username: "cors_rate_probe", password: "wrong" }),
    });
  }
  assert(rateLimited?.status === 429 && Number(rateLimited.headers.get("retry-after")) >= 1, "Rate-limit 429/Retry-After oluşmadı.");
  assertSecurityHeaders(rateLimited);
  assert(rateLimited.headers.get("access-control-expose-headers")?.includes("Retry-After"), "Retry-After expose edilmedi.");
}

async function assertExports(baseUrl: string, token: string): Promise<void> {
  for (const [path, mime, magic] of [
    ["/api/targets/export?format=csv&year=2026", "text/csv", null],
    ["/api/targets/export?format=xlsx&year=2026", "spreadsheetml", "PK"],
  ] as const) {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Origin: ALLOWED_ORIGIN },
    });
    assert(response.status === 200 && response.headers.get("content-type")?.includes(mime), `Export MIME hatalı: ${path}`);
    assert(response.headers.get("content-disposition")?.includes("attachment"), `Export filename eksik: ${path}`);
    assert(response.headers.get("access-control-expose-headers")?.includes("Content-Disposition"), `Export disposition expose edilmedi: ${path}`);
    assertSecurityHeaders(response);
    const body = Buffer.from(await response.arrayBuffer());
    if (magic) assert(body.subarray(0, 2).toString("ascii") === magic, "XLSX magic geçersiz.");
  }
}

async function assertBrowserCsp(baseUrl: string): Promise<void> {
  const browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath() });
  try {
    const page = await browser.newPage();
    const cspViolations: string[] = [];
    page.on("console", (message) => {
      if (/content security policy|refused to (?:load|execute|connect|apply)/i.test(message.text())) {
        cspViolations.push(message.text());
      }
    });
    await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
    await page.locator("#username").fill(process.env.E2E_ADMIN_USERNAME!);
    await page.locator("#password").fill(process.env.E2E_TEST_PASSWORD!);
    await page.locator('button[type="submit"]').click();
    await page.getByText("Enerji Yönetimi", { exact: true }).first().waitFor({ state: "visible" });
    assert(cspViolations.length === 0, `Browser CSP ihlali: ${cspViolations.join(" | ")}`);
  } finally {
    await browser.close();
  }
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
  assertSecurityHeaders(health);
  const ready = await fetch(`${baseUrl}/api/readyz`);
  assert(ready.status === 200 && (await ready.json() as { status?: unknown }).status === "ready", "Readiness response geçersiz.");
  const unauthenticated = await fetch(`${baseUrl}/api/reports`);
  assert(unauthenticated.status === 401, "Protected API unauthenticated 401 dönmedi.");
  assertSecurityHeaders(unauthenticated);
  const unknownApi = await fetch(`${baseUrl}/api/not-a-real-endpoint`);
  assert(unknownApi.status === 404 && unknownApi.headers.get("content-type")?.includes("application/json"), "Unknown API SPA fallback'e düştü.");
  assertSecurityHeaders(unknownApi);
  const dotfile = await fetch(`${baseUrl}/.env`);
  assert(dotfile.status === 404 && !(await dotfile.text()).includes("<!doctype html>"), "Dotfile isteği güvenli 404 dönmedi.");

  for (const route of ["/", "/login", "/sayaclar"]) {
    const response = await fetch(`${baseUrl}${route}`);
    const html = await response.text();
    assert(response.status === 200 && /<!doctype html>/i.test(html), `${route} SPA artifact dönmedi.`);
    assert(response.headers.get("cache-control") === "no-cache", `${route} no-cache değil.`);
    assertSecurityHeaders(response);
    if (route === "/") {
      const asset = html.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1];
      assert(asset, "Hashed frontend asset bulunamadı.");
      const assetResponse = await fetch(`${baseUrl}${asset}`);
      assert(assetResponse.status === 200, "Hashed frontend asset sunulamadı.");
      assert(assetResponse.headers.get("cache-control")?.includes("immutable"), "Hashed asset immutable cache almıyor.");
      assertSecurityHeaders(assetResponse);
      const contentType = assetResponse.headers.get("content-type") ?? "";
      assert(contentType.includes("javascript") || contentType.includes("text/css"), "Hashed asset MIME hatalı.");
    }
  }
}

async function assertDatabaseOutageRecovery(running: RunningProduction): Promise<void> {
  const containerId = await assertTestContainerOwnership();
  await runDocker(["pause", containerId]);
  try {
    const deadline = Date.now() + 10_000;
    let outageResponse: Response | null = null;
    while (Date.now() < deadline) {
      outageResponse = await fetch(`${running.baseUrl}/api/readyz`);
      if (outageResponse.status === 503) break;
      await delay(100);
    }
    assert(outageResponse?.status === 503, "DB outage sırasında readiness 503 dönmedi.");
    const body = await outageResponse.text();
    assert(body === '{"status":"not_ready"}', "DB outage readiness response güvenli değil.");
    assert((await fetch(`${running.baseUrl}/api/healthz`)).status === 200, "DB outage sırasında liveness 200 dönmedi.");
  } finally {
    await runDocker(["unpause", containerId]);
  }
  await waitForReady(running);
}

async function assertMissingDatabaseStartup(browserPath: string): Promise<void> {
  const unavailablePort = await reservePort();
  const running = await spawnProduction(browserPath, {
    DATABASE_URL: `postgresql://test_runner@127.0.0.1:${unavailablePort}/iso50001_test?sslmode=disable`,
  });
  const result = await Promise.race([
    new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveClose) => {
      running.child.once("close", (code, signal) => resolveClose({ code, signal }));
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Missing DB startup process zamanında sonlanmadı.")), STARTUP_TIMEOUT_MS)),
  ]);
  assert(result.code !== 0 || result.signal !== null, "Missing DB startup process başarılı exit verdi.");
  assert(!/postgres(?:ql)?:\/\//i.test(running.logs()), "Missing DB startup logunda connection URL sızdı.");
  await assertListenerClosed(running.baseUrl);
}

async function main(): Promise<void> {
  assertDisposableEnvironment();
  let running: RunningProduction | null = null;
  let missingBrowserDirectory: string | null = null;
  try {
    running = await startProduction(process.env.PLAYWRIGHT_BROWSERS_PATH!);
    await assertMetricsDisabled(running.baseUrl);
    await stopProduction(running, "SIGTERM");
    running = null;

    running = await startProduction(process.env.PLAYWRIGHT_BROWSERS_PATH!, METRICS_ENV);
    await assertStaticAndApi(running.baseUrl);
    await assertCorsPolicy(running.baseUrl);
    await waitForLog(running, /MGM scheduler disabled/);
    await assertDatabaseOutageRecovery(running);
    const token = await login(running.baseUrl, ALLOWED_ORIGIN);
    await assertMetricsAuth(running.baseUrl, token);
    await assertMetricsPerformanceSmoke(running.baseUrl);
    const pdf = await fetchPdf(running.baseUrl, token, ALLOWED_ORIGIN);
    assertSecurityHeaders(pdf);
    assert(pdf.headers.get("access-control-expose-headers")?.includes("Content-Disposition"), "PDF disposition expose edilmedi.");
    await assertPdf(pdf);
    await assertExports(running.baseUrl, token);
    await assertBrowserCsp(running.baseUrl);
    const concurrentPdfs = Promise.all([1, 2, 3].map(async () => assertPdf(await fetchPdf(running!.baseUrl, token))));
    if (process.platform === "win32") {
      await concurrentPdfs;
      await assertMetricsOutput(running.baseUrl);
      await stopProduction(running, "SIGTERM");
    } else {
      await delay(25);
      await concurrentPdfs;
      await assertMetricsOutput(running.baseUrl);
      await stopProduction(running, "SIGTERM");
    }
    running = null;

    running = await startProduction(process.env.PLAYWRIGHT_BROWSERS_PATH!, {
      CORS_ALLOWED_ORIGINS: undefined,
    });
    assert((await fetch(`${running.baseUrl}/api/healthz`)).status === 200, "Allowlist'siz originless production request çalışmadı.");
    assert((await fetch(`${running.baseUrl}/api/healthz`, { headers: { Origin: ALLOWED_ORIGIN } })).status === 403, "Allowlist'siz production Origin reddedilmedi.");
    await stopProduction(running, "SIGTERM");
    running = null;

    for (const invalidValue of [
      "*",
      "https://example.com/path",
      "https://user@example.com",
      "https://example.com?query=1",
      "ftp://example.com",
    ]) {
      const invalidCors = await spawnProduction(process.env.PLAYWRIGHT_BROWSERS_PATH!, {
        CORS_ALLOWED_ORIGINS: invalidValue,
      });
      const invalidCorsExit = await Promise.race([
        new Promise<number | null>((resolveClose) => invalidCors.child.once("close", (code) => resolveClose(code))),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Invalid CORS process zamanında sonlanmadı.")), STARTUP_TIMEOUT_MS)),
      ]);
      assert(invalidCorsExit !== 0, `Invalid production CORS config fail-fast olmadı: ${invalidValue}`);
      assert(!invalidCors.logs().includes(invalidValue), "CORS allowlist değeri loglandı.");
    }

    running = await startProduction(process.env.PLAYWRIGHT_BROWSERS_PATH!, {
      NODE_ENV: "development",
      CORS_ALLOWED_ORIGINS: undefined,
    });
    const developmentHealth = await fetch(`${running.baseUrl}/api/healthz`, {
      headers: { Origin: "http://127.0.0.1:5000" },
    });
    assert(developmentHealth.status === 200 && developmentHealth.headers.get("access-control-allow-origin") === "http://127.0.0.1:5000", "Development localhost CORS çalışmadı.");
    assertSecurityHeaders(developmentHealth, false);
    await stopProduction(running, "SIGTERM");
    running = null;

    running = await startProduction(process.env.PLAYWRIGHT_BROWSERS_PATH!, {
      ENABLE_MGM_SCHEDULER: "true",
      MGM_SCHEDULER_INSTANCE_MODE: "autoscale",
    });
    await waitForLog(running, /MGM scheduler refused/);
    await stopProduction(running, "SIGTERM");
    running = null;

    running = await startProduction(process.env.PLAYWRIGHT_BROWSERS_PATH!, {
      ENABLE_MGM_SCHEDULER: "true",
      MGM_SCHEDULER_INSTANCE_MODE: "single",
    });
    await waitForLog(running, /MGM scheduler enabled in approved single-instance mode/);
    await stopProduction(running, "SIGINT");
    running = null;

    missingBrowserDirectory = await mkdtemp(join(tmpdir(), "iso50001-missing-browser-"));
    running = await startProduction(missingBrowserDirectory);
    const missingToken = await login(running.baseUrl);
    const missingResponse = await fetchPdf(running.baseUrl, missingToken);
    const missingBody = await missingResponse.text();
    assert(missingResponse.status >= 500 && missingResponse.status < 600, "Missing browser kontrollü 5xx dönmedi.");
    assert(missingResponse.headers.get("content-type")?.includes("application/json"), "Missing browser JSON hata dönmedi.");
    assertSecurityHeaders(missingResponse);
    assert(!/stack|node_modules|ms-playwright|chromium-[0-9]|[A-Z]:\\/i.test(missingBody), "Missing browser response path/stack sızdırdı.");
    assert((await fetch(`${running.baseUrl}/api/healthz`)).status === 200, "Missing browser sonrası API çalışmıyor.");
    await stopProduction(running, "SIGTERM");
    running = null;

    await assertMissingDatabaseStartup(process.env.PLAYWRIGHT_BROWSERS_PATH!);
  } catch (error) {
    const safeLogs = running?.logs().replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted-database-url]").slice(-2_000);
    if (safeLogs) console.error(`[test-production-readiness] Son process logları:\n${safeLogs}`);
    throw error;
  } finally {
    await stopProduction(running).catch(() => undefined);
    if (missingBrowserDirectory) await rm(missingBrowserDirectory, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ productionReadinessScenarios: 20, corsSecurityScenarios: 22, metricsScenarios: 9 }));
}

main().catch((error: unknown) => {
  console.error(`[test-production-readiness] Başarısız: ${error instanceof Error ? error.message : "Bilinmeyen hata"}`);
  process.exitCode = 1;
});
