import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { resolve } from "node:path";
import { Pool } from "pg";

type RunningApi = { child: ChildProcess; baseUrl: string; logs: () => string };

const STARTUP_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 20_000;
const METRICS_TOKEN = "proxy-pool-metrics-token-0000000000";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

async function spawnApi(overrides: NodeJS.ProcessEnv = {}): Promise<RunningApi> {
  const repoRoot = resolve(import.meta.dirname, "../..");
  const port = await reservePort();
  let output = "";
  const child = spawn(process.execPath, ["--enable-source-maps", resolve(repoRoot, "artifacts/api-server/dist/index.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      AUTH_SESSION_TTL_HOURS: "24",
      LOGIN_RATE_LIMIT_WINDOW_MS: "3000",
      LOGIN_RATE_LIMIT_MAX_PER_IP: "2",
      LOGIN_RATE_LIMIT_MAX_PER_USERNAME: "50",
      DB_POOL_MAX: "4",
      DB_POOL_CONNECTION_TIMEOUT_MS: "500",
      ENABLE_DEMO_SEED: "false",
      ENABLE_DEMO_SEED_USERS: "false",
      ENABLE_SUPERADMIN_BOOTSTRAP: "false",
      ENABLE_MGM_BOOTSTRAP: "false",
      ENABLE_MGM_SCHEDULER: "false",
      ENABLE_METRICS_ENDPOINT: "true",
      METRICS_ACCESS_TOKEN: METRICS_TOKEN,
      CORS_ALLOWED_ORIGINS: undefined,
      ...overrides,
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.on("data", (chunk: Buffer) => { output = `${output}${chunk.toString("utf8")}`.slice(-60_000); });
  child.stderr?.on("data", (chunk: Buffer) => { output = `${output}${chunk.toString("utf8")}`.slice(-60_000); });
  return { child, baseUrl: `http://127.0.0.1:${port}`, logs: () => output };
}

async function startApi(overrides: NodeJS.ProcessEnv = {}): Promise<RunningApi> {
  const api = await spawnApi(overrides);
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (api.child.exitCode !== null) throw new Error(`API erken kapandı: ${api.logs().slice(-1_000)}`);
    try {
      const response = await fetch(`${api.baseUrl}/api/readyz`, { signal: AbortSignal.timeout(500) });
      if (response.status === 200) return api;
    } catch {
      // retry until listener is ready
    }
    await delay(150);
  }
  api.child.kill("SIGKILL");
  throw new Error(`API readiness zaman aşımı: ${api.logs().slice(-1_000)}`);
}

async function stopApi(api: RunningApi | null): Promise<void> {
  if (!api || api.child.exitCode !== null) return;
  const closed = new Promise<void>((resolveClose) => api.child.once("close", () => resolveClose()));
  api.child.kill("SIGTERM");
  await Promise.race([
    closed,
    delay(SHUTDOWN_TIMEOUT_MS).then(() => { throw new Error("API shutdown zaman aşımı."); }),
  ]);
}

async function expectStartupFailure(overrides: NodeJS.ProcessEnv, expectedLog: RegExp): Promise<void> {
  const api = await spawnApi(overrides);
  const exit = await Promise.race([
    new Promise<number | null>((resolveClose) => api.child.once("close", (code) => resolveClose(code))),
    delay(STARTUP_TIMEOUT_MS).then(() => { throw new Error("Invalid config process zamanında sonlanmadı."); }),
  ]);
  assert(exit !== 0, "Invalid config process başarılı exit verdi.");
  assert(expectedLog.test(api.logs()), `Invalid config safe log üretmedi: ${expectedLog.source}`);
  assert(!/postgres(?:ql)?:\/\//i.test(api.logs()), "Invalid config logunda DATABASE_URL sızdı.");
  try {
    await fetch(`${api.baseUrl}/api/healthz`, { signal: AbortSignal.timeout(300) });
    throw new Error("Invalid config listener açtı.");
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid config listener açtı.") throw error;
  }
}

async function failedLogin(baseUrl: string, username: string, xff?: string): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(xff ? { "X-Forwarded-For": xff } : {}),
    },
    body: JSON.stringify({ username, password: "wrong-password" }),
  });
}

async function clearRateLimits(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  assert(databaseUrl && new URL(databaseUrl).hostname === "127.0.0.1", "Disposable DB zorunlu.");
  const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 1_000 });
  try {
    await pool.query("DELETE FROM auth_rate_limits");
  } finally {
    await pool.end();
  }
}

async function assertProxyDisabledSpoofing(): Promise<void> {
  let api: RunningApi | null = null;
  try {
    await clearRateLimits();
    api = await startApi({ TRUST_PROXY_MODE: "none" });
    assert((await failedLogin(api.baseUrl, "proxy-none-1", "1.1.1.1")).status === 401, "Proxy none ilk deneme 401 değil.");
    assert((await failedLogin(api.baseUrl, "proxy-none-2", "2.2.2.2")).status === 401, "Proxy none ikinci deneme 401 değil.");
    assert((await failedLogin(api.baseUrl, "proxy-none-3", "3.3.3.3")).status === 429, "Proxy none XFF spoof ile IP limit bypass edildi.");
  } finally {
    await stopApi(api);
  }
}

async function assertSingleHopProxyTrust(): Promise<void> {
  let api: RunningApi | null = null;
  try {
    await clearRateLimits();
    api = await startApi({ TRUST_PROXY_MODE: "hops", TRUST_PROXY_HOPS: "1" });
    assert((await failedLogin(api.baseUrl, "proxy-hop-a1", "203.0.113.10")).status === 401, "Hops=1 ilk client başarısız.");
    assert((await failedLogin(api.baseUrl, "proxy-hop-b1", "203.0.113.11")).status === 401, "Hops=1 farklı client ayrışmadı.");
    assert((await failedLogin(api.baseUrl, "proxy-hop-a2", "attacker-controlled, 203.0.113.10")).status === 401, "Hops=1 spoof zincir ikinci deneme başarısız.");
    assert((await failedLogin(api.baseUrl, "proxy-hop-a3", "another-spoof, 203.0.113.10")).status === 429, "Hops=1 sol spoof değeri IP limit bypass etti.");
  } finally {
    await stopApi(api);
  }
}

async function assertMultiInstanceIpRateLimit(): Promise<void> {
  let apiA: RunningApi | null = null;
  let apiB: RunningApi | null = null;
  try {
    await clearRateLimits();
    apiA = await startApi({ TRUST_PROXY_MODE: "none" });
    apiB = await startApi({ TRUST_PROXY_MODE: "none" });
    assert((await failedLogin(apiA.baseUrl, "multi-ip-1", "198.51.100.1")).status === 401, "Multi A ilk deneme 401 değil.");
    assert((await failedLogin(apiB.baseUrl, "multi-ip-2", "198.51.100.2")).status === 401, "Multi B ikinci deneme 401 değil.");
    assert((await failedLogin(apiA.baseUrl, "multi-ip-3", "198.51.100.3")).status === 429, "Multi-instance spoofed XFF ile IP limit bypass edildi.");
  } finally {
    await stopApi(apiA);
    await stopApi(apiB);
  }
}

async function assertPoolSaturation(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  assert(databaseUrl && new URL(databaseUrl).hostname === "127.0.0.1", "Disposable DB zorunlu.");
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 2,
    idleTimeoutMillis: 1_000,
    connectionTimeoutMillis: 300,
  });
  const clientA = await pool.connect();
  const clientB = await pool.connect();
  const startedAt = Date.now();
  try {
    let timedOut = false;
    try {
      const clientC = await pool.connect();
      clientC.release();
    } catch (error) {
      timedOut = /timeout|Connection terminated|aborted/i.test(error instanceof Error ? error.message : String(error));
    }
    assert(timedOut, "Pool saturation bounded timeout üretmedi.");
    assert(Date.now() - startedAt < 5_000, "Pool saturation uzun süre bekledi.");
  } finally {
    clientA.release();
    clientB.release();
    await pool.end();
  }

  const recoveryPool = new Pool({
    connectionString: databaseUrl,
    max: 2,
    idleTimeoutMillis: 1_000,
    connectionTimeoutMillis: 500,
  });
  try {
    const result = await recoveryPool.query("SELECT 1 AS ok");
    assert(result.rows[0]?.ok === 1, "Pool saturation sonrası recovery başarısız.");
  } finally {
    await recoveryPool.end();
  }
}

async function assertPoolMetrics(): Promise<void> {
  let api: RunningApi | null = null;
  try {
    api = await startApi({ DB_POOL_MAX: "2", TRUST_PROXY_MODE: "none" });
    const response = await fetch(`${api.baseUrl}/api/metrics`, {
      headers: { Authorization: `Bearer ${METRICS_TOKEN}` },
    });
    assert(response.status === 200, "Metrics endpoint pool testinde okunamadı.");
    const body = await response.text();
    assert(/^iso50001_db_pool_connections\{[^}]*state="total"[^}]*\} /m.test(body), "Pool total gauge yok.");
    assert(/^iso50001_db_pool_connections\{[^}]*state="idle"[^}]*\} /m.test(body), "Pool idle gauge yok.");
    assert(/^iso50001_db_pool_connections\{[^}]*state="waiting"[^}]*\} /m.test(body), "Pool waiting gauge yok.");
    assert(!/postgres(?:ql)?:\/\//i.test(body), "Metrics DB URL sızdırdı.");
    assert(!/198\.51\.100|203\.0\.113|attacker-controlled/.test(body), "Metrics XFF/IP değerlerini sızdırdı.");
  } finally {
    await stopApi(api);
  }
}

async function main(): Promise<void> {
  assert(process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).hostname === "127.0.0.1", "Disposable DB zorunlu.");

  await expectStartupFailure({ TRUST_PROXY_MODE: "true" }, /TRUST_PROXY_MODE must be one of/i);
  await expectStartupFailure({ TRUST_PROXY_MODE: "hops", TRUST_PROXY_HOPS: "0" }, /TRUST_PROXY_HOPS must be/i);
  await expectStartupFailure({ DB_POOL_MAX: "0" }, /DB_POOL_MAX must be/i);
  await expectStartupFailure({ DB_POOL_CONNECTION_TIMEOUT_MS: "0" }, /DB_POOL_CONNECTION_TIMEOUT_MS must be/i);

  await assertProxyDisabledSpoofing();
  await assertSingleHopProxyTrust();
  await assertMultiInstanceIpRateLimit();
  await assertPoolSaturation();
  await assertPoolMetrics();

  console.log(JSON.stringify({
    proxyPoolScenarios: 9,
    proxySpoofing: true,
    multiInstanceRateLimit: true,
    poolSaturation: true,
    poolMetrics: true,
  }));
}

main().catch((error: unknown) => {
  console.error(`[test-proxy-pool] ${error instanceof Error ? error.message : "Bilinmeyen hata"}`);
  process.exitCode = 1;
});
