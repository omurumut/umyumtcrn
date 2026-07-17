import { createHash } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { request as httpRequest } from "node:http";
import { createServer, type AddressInfo } from "node:net";
import { resolve } from "node:path";
import { Pool } from "pg";

type RunningApi = { child: ChildProcess; baseUrl: string; logs: () => string };

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

async function startApi(repoRoot: string): Promise<RunningApi> {
  const port = await reservePort();
  let output = "";
  const child = spawn(process.execPath, ["--enable-source-maps", resolve(repoRoot, "artifacts/api-server/dist/index.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      AUTH_SESSION_TTL_HOURS: "24",
      LOGIN_RATE_LIMIT_WINDOW_MS: "1000",
      LOGIN_RATE_LIMIT_MAX_PER_IP: "5",
      LOGIN_RATE_LIMIT_MAX_PER_USERNAME: "3",
      ENABLE_DEMO_SEED: "false",
      ENABLE_DEMO_SEED_USERS: "false",
      ENABLE_SUPERADMIN_BOOTSTRAP: "false",
      ENABLE_MGM_BOOTSTRAP: "false",
      ENABLE_MGM_SCHEDULER: "false",
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`API erken kapandı: ${output.slice(-500)}`);
    try {
      if ((await fetch(`${baseUrl}/api/readyz`, { signal: AbortSignal.timeout(500) })).status === 200) {
        console.log(`[test-shared-auth] API hazır: ${port}`);
        return { child, baseUrl, logs: () => output };
      }
    } catch {}
    await delay(250);
  }
  child.kill("SIGKILL");
  throw new Error(`API readiness zaman aşımı: ${output.slice(-1_000)}`);
}

async function stopApi(api: RunningApi | null): Promise<void> {
  if (!api || api.child.exitCode !== null || api.child.signalCode !== null) return;
  api.child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolveClose) => api.child.once("close", () => resolveClose())),
    delay(20_000).then(() => { throw new Error("API shutdown zaman aşımı."); }),
  ]);
}

async function login(baseUrl: string, username: string, password: string): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

async function loginStatusFromAddress(
  baseUrl: string,
  username: string,
  password: string,
  localAddress: string,
): Promise<number> {
  const body = JSON.stringify({ username, password });
  return new Promise<number>((resolveStatus, reject) => {
    const request = httpRequest(new URL("/api/auth/login", baseUrl), {
      method: "POST",
      localAddress,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (response) => {
      response.resume();
      response.once("end", () => resolveStatus(response.statusCode ?? 0));
    });
    request.once("error", reject);
    request.end(body);
  });
}

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function tokenFrom(response: Response): Promise<string> {
  assert(response.status === 200, `Login 200 yerine ${response.status} döndü.`);
  const body = await response.json() as { token?: unknown };
  assert(typeof body.token === "string", "Login token üretmedi.");
  return body.token;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  assert(databaseUrl && new URL(databaseUrl).hostname === "127.0.0.1", "Disposable DB zorunlu.");
  const repoRoot = resolve(import.meta.dirname, "../..");
  const pool = new Pool({ connectionString: databaseUrl });
  const username = process.env.E2E_SESSION_USERNAME!;
  const password = process.env.E2E_TEST_PASSWORD!;
  const companyBUsername = process.env.E2E_STANDARD_B_USERNAME!;
  let apiA: RunningApi | null = null;
  let apiB: RunningApi | null = null;
  let apiC: RunningApi | null = null;
  const tokens: string[] = [];
  let assertions = 0;
  try {
    console.log("[test-shared-auth] Instance A başlatılıyor.");
    apiA = await startApi(repoRoot);
    console.log("[test-shared-auth] Instance B başlatılıyor.");
    apiB = await startApi(repoRoot);

    console.log("[test-shared-auth] Cross-instance session senaryosu.");
    const sharedToken = await tokenFrom(await login(apiA.baseUrl, username, password));
    tokens.push(sharedToken);
    assert((await fetch(`${apiB.baseUrl}/api/auth/me`, { headers: auth(sharedToken) })).status === 200, "Instance B shared session görmedi.");
    assert((await fetch(`${apiB.baseUrl}/api/dashboard/kpi`, { headers: auth(sharedToken) })).status === 200, "Instance B dashboard shared session ile çalışmadı.");
    assertions += 2;
    assert((await fetch(`${apiB.baseUrl}/api/auth/logout`, { method: "POST", headers: auth(sharedToken) })).status === 204, "Cross-instance logout başarısız.");
    assert((await fetch(`${apiA.baseUrl}/api/auth/me`, { headers: auth(sharedToken) })).status === 401, "Cross-instance revoke Instance A'ya yansımadı.");
    assertions += 2;

    const restartToken = await tokenFrom(await login(apiA.baseUrl, username, password));
    tokens.push(restartToken);
    await stopApi(apiA);
    apiA = null;
    apiC = await startApi(repoRoot);
    assert((await fetch(`${apiC.baseUrl}/api/auth/me`, { headers: auth(restartToken) })).status === 200, "Restart sonrası session kayboldu.");
    assertions += 1;

    const tokenHash = createHash("sha256").update(restartToken).digest("hex");
    const stored = await pool.query<{ token_hash: string; expires_at: Date }>("SELECT token_hash, expires_at FROM auth_sessions WHERE token_hash=$1", [tokenHash]);
    assert(stored.rows[0]?.token_hash === tokenHash && stored.rows[0].token_hash !== restartToken && stored.rows[0].token_hash.length === 64, "Token hash güvenli saklanmıyor.");
    assert(stored.rows[0].expires_at.getTime() > Date.now(), "Session expiration yazılmadı.");
    assertions += 2;
    await pool.query("UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1", [tokenHash]);
    assert((await fetch(`${apiB.baseUrl}/api/auth/me`, { headers: auth(restartToken) })).status === 401, "Expired token reddedilmedi.");
    assertions += 1;

    const concurrentResponses = await Promise.all(Array.from({ length: 4 }, () => login(apiB!.baseUrl, username, password)));
    const concurrentTokens = await Promise.all(concurrentResponses.map(tokenFrom));
    tokens.push(...concurrentTokens);
    assert(new Set(concurrentTokens).size === 4, "Concurrent login tokenları benzersiz değil.");
    assert((await pool.query("SELECT count(*)::int AS count FROM auth_sessions WHERE token_hash=ANY($1)", [concurrentTokens.map((token) => createHash("sha256").update(token).digest("hex"))])).rows[0].count === 4, "Concurrent session satırları eksik.");
    await fetch(`${apiB.baseUrl}/api/auth/logout`, { method: "POST", headers: auth(concurrentTokens[0]!) });
    assert((await fetch(`${apiC.baseUrl}/api/auth/me`, { headers: auth(concurrentTokens[1]!) })).status === 200, "Bir logout diğer sessionı etkiledi.");
    assertions += 3;

    await pool.query("UPDATE users SET role='admin' WHERE username=$1", [username]);
    const changedRole = await (await fetch(`${apiB.baseUrl}/api/auth/me`, { headers: auth(concurrentTokens[1]!) })).json() as { role?: string };
    assert(changedRole.role === "admin", "Role değişikliği active tokena yansımadı.");
    await pool.query("UPDATE users SET role='user' WHERE username=$1", [username]);
    assertions += 1;

    const sessionUserScope = await pool.query<{ id: number; company_id: number; unit_id: number | null }>(
      "SELECT id, company_id, unit_id FROM users WHERE username=$1",
      [username],
    );
    const sessionUser = sessionUserScope.rows[0];
    assert(sessionUser, "Session test kullanıcısı bulunamadı.");
    const alternateUnit = await pool.query<{ id: number }>(
      "SELECT id FROM units WHERE company_id=$1 AND id IS DISTINCT FROM $2 ORDER BY id LIMIT 1",
      [sessionUser.company_id, sessionUser.unit_id],
    );
    assert(alternateUnit.rows[0], "Unit değişikliği test birimi bulunamadı.");
    await pool.query("UPDATE users SET unit_id=$1 WHERE id=$2", [alternateUnit.rows[0].id, sessionUser.id]);
    const changedUnit = await (await fetch(`${apiC.baseUrl}/api/auth/me`, { headers: auth(concurrentTokens[1]!) })).json() as { unitId?: number | null };
    assert(changedUnit.unitId === alternateUnit.rows[0].id, "Unit değişikliği active tokena yansımadı.");
    await pool.query("UPDATE users SET unit_id=$1 WHERE id=$2", [sessionUser.unit_id, sessionUser.id]);
    await pool.query("UPDATE users SET active=false WHERE id=$1", [sessionUser.id]);
    assert((await fetch(`${apiB.baseUrl}/api/auth/me`, { headers: auth(concurrentTokens[1]!) })).status === 401, "Pasif user active tokenı reddetmedi.");
    await pool.query("UPDATE users SET active=true WHERE id=$1", [sessionUser.id]);
    assertions += 2;

    const companyToken = await tokenFrom(await login(apiB.baseUrl, companyBUsername, password));
    tokens.push(companyToken);
    const companyId = Number((await pool.query("SELECT company_id FROM users WHERE username=$1", [companyBUsername])).rows[0].company_id);
    await pool.query("UPDATE companies SET is_active=false WHERE id=$1", [companyId]);
    assert((await fetch(`${apiC.baseUrl}/api/auth/me`, { headers: auth(companyToken) })).status === 401, "Pasif company active tokenı reddetmedi.");
    await pool.query("UPDATE companies SET is_active=true WHERE id=$1", [companyId]);
    assertions += 1;

    await pool.query("DELETE FROM auth_rate_limits");
    const usernameStatuses: number[] = [];
    for (const baseUrl of [apiB.baseUrl, apiC.baseUrl, apiB.baseUrl]) {
      usernameStatuses.push((await login(baseUrl, "shared_limit_user", "wrong")).status);
    }
    assert(JSON.stringify(usernameStatuses) === "[401,401,401]", `Username threshold beklenmedik: ${usernameStatuses}`);
    assert((await login(apiC.baseUrl, "shared_limit_user", "wrong")).status === 429, "Username limiti Instance B'de devreye girmedi.");
    assert((await login(apiB.baseUrl, "shared_limit_user", "wrong")).status === 429, "Username limiti Instance A'da paylaşılmadı.");
    assertions += 3;
    await delay(1_100);
    assert((await login(apiB.baseUrl, "shared_limit_user", "wrong")).status === 401, "Rate-limit window reset olmadı.");
    assertions += 1;

    await pool.query("DELETE FROM auth_rate_limits");
    const differentIpUsernameStatuses = [];
    for (const [baseUrl, localAddress] of [
      [apiB.baseUrl, "127.0.0.2"],
      [apiC.baseUrl, "127.0.0.3"],
      [apiB.baseUrl, "127.0.0.4"],
      [apiC.baseUrl, "127.0.0.5"],
    ] as const) {
      differentIpUsernameStatuses.push(
        await loginStatusFromAddress(baseUrl, "shared_multi_ip_user", "wrong", localAddress),
      );
    }
    assert(
      JSON.stringify(differentIpUsernameStatuses) === "[401,401,401,429]",
      `Aynı username/farklı IP limiti beklenmedik: ${differentIpUsernameStatuses}`,
    );
    assertions += 1;

    await pool.query("DELETE FROM auth_rate_limits");
    for (let index = 0; index < 5; index += 1) {
      assert((await login(index % 2 ? apiB.baseUrl : apiC.baseUrl, `ip_limit_${index}`, "wrong")).status === 401, "IP limiti erken devreye girdi.");
    }
    assert((await login(apiB.baseUrl, "ip_limit_blocked", "wrong")).status === 429, "IP limiti cross-instance çalışmadı.");
    assertions += 2;

    await pool.query("DELETE FROM auth_rate_limits");
    const concurrentFailures = await Promise.all(Array.from({ length: 10 }, (_, index) => login(index % 2 ? apiB!.baseUrl : apiC!.baseUrl, "parallel_limit", "wrong")));
    const failureStatuses = concurrentFailures.map((response) => response.status);
    assert(!failureStatuses.includes(500) && !failureStatuses.includes(503), "Concurrent rate-limit DB hatası üretti.");
    assert(failureStatuses.filter((status) => status !== 429).length <= 3 && failureStatuses.includes(429), `Concurrent threshold aşıldı: ${failureStatuses}`);
    assertions += 2;

    const outageToken = concurrentTokens[1]!;
    const containerId = process.env.TEST_DB_CONTAINER_ID!;
    spawnSync("docker", ["pause", containerId], { stdio: "ignore", shell: false });
    try {
      const [authResponse, loginResponse, readyResponse] = await Promise.all([
        fetch(`${apiB.baseUrl}/api/auth/me`, { headers: auth(outageToken), signal: AbortSignal.timeout(8_000) }),
        login(apiC.baseUrl, username, password),
        fetch(`${apiB.baseUrl}/api/readyz`, { signal: AbortSignal.timeout(8_000) }),
      ]);
      assert(authResponse.status !== 200 && loginResponse.status !== 200 && readyResponse.status === 503, "DB outage fail-closed değil.");
      const bodies = `${await authResponse.text()} ${await loginResponse.text()} ${await readyResponse.text()}`;
      assert(!/postgres|database_url|node_modules|password|token_hash/i.test(bodies), "DB outage response iç detay sızdırdı.");
      assertions += 2;
    } finally {
      spawnSync("docker", ["unpause", containerId], { stdio: "ignore", shell: false });
    }
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if ((await fetch(`${apiB.baseUrl}/api/readyz`)).status === 200) break;
      await delay(100);
    }

    await pool.query("UPDATE auth_sessions SET expires_at=now()-interval '2 days' WHERE token_hash=$1", [createHash("sha256").update(outageToken).digest("hex")]);
    await pool.query("INSERT INTO auth_rate_limits(scope,key_hash,window_started_at,attempt_count,updated_at) VALUES('username',$1,now()-interval '2 days',1,now()-interval '2 days') ON CONFLICT DO NOTHING", [createHash("sha256").update("cleanup-probe").digest("hex")]);
    const disabledCleanup = spawnSync(process.execPath, [resolve(repoRoot, "scripts/node_modules/tsx/dist/cli.mjs"), resolve(repoRoot, "scripts/src/cleanup-auth-state.ts")], {
      cwd: repoRoot,
      env: { ...process.env, ENABLE_AUTH_MAINTENANCE: "false" },
      encoding: "utf8",
      shell: false,
    });
    assert(disabledCleanup.status !== 0, "Auth cleanup exact opt-in flag olmadan çalıştı.");
    assertions += 1;
    const cleanup = spawnSync(process.execPath, [resolve(repoRoot, "scripts/node_modules/tsx/dist/cli.mjs"), resolve(repoRoot, "scripts/src/cleanup-auth-state.ts")], {
      cwd: repoRoot,
      env: { ...process.env, ENABLE_AUTH_MAINTENANCE: "true", AUTH_CLEANUP_BATCH_SIZE: "100" },
      encoding: "utf8",
      shell: false,
    });
    assert(
      cleanup.status === 0 && /"sessions":\d+,"rateLimits":\d+/.test(cleanup.stdout),
      `Auth cleanup komutu başarısız: status=${cleanup.status}; stdout=${cleanup.stdout.slice(-300)}; stderr=${cleanup.stderr.slice(-300)}`,
    );
    assertions += 1;

    const performanceToken = concurrentTokens[2]!;
    const performanceRequests = [
      { path: "/api/dashboard/kpi", init: {} },
      { path: "/api/consumption", init: {} },
      {
        path: "/api/ai/suggestions",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ focus: "genel", year: 2025 }),
        },
      },
      { path: "/api/reports/energy-targets/pdf?year=2026", init: {} },
    ];
    const performance = [];
    for (const { path, init } of performanceRequests) {
      const started = Date.now();
      const response = await fetch(`${apiB.baseUrl}${path}`, {
        ...init,
        headers: { ...init.headers, ...auth(performanceToken) },
      });
      assert(response.status === 200, `Auth performans smoke ${path}: ${response.status}`);
      await response.arrayBuffer();
      performance.push({ path, durationMs: Date.now() - started });
    }
    assertions += performance.length;

    const combinedLogs = `${apiB.logs()} ${apiC.logs()}`;
    assert(tokens.every((token) => !combinedLogs.includes(token)), "Raw bearer token loglandı.");
    assert(tokens.every((token) => !combinedLogs.includes(createHash("sha256").update(token).digest("hex"))), "Token hash loglandı.");
    assertions += 2;

    console.log(JSON.stringify({ assertions, crossInstance: true, restartPersistence: true, rateLimitShared: true, performance }));
  } finally {
    await pool.query("UPDATE users SET role='user' WHERE username=$1", [username]).catch(() => undefined);
    await pool.query("UPDATE companies SET is_active=true WHERE subdomain='e2e-tenant-b'").catch(() => undefined);
    await stopApi(apiA).catch(() => undefined);
    await stopApi(apiB).catch(() => undefined);
    await stopApi(apiC).catch(() => undefined);
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`[test-shared-auth] ${error instanceof Error ? error.stack ?? error.message : "Bilinmeyen hata"}`);
  process.exitCode = 1;
});
