import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { Pool } from "pg";
import { aiAnalysisResultSchema } from "@workspace/api-zod";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertDisposableDatabase() {
  assert(process.env.NODE_ENV === "test" && process.env.TEST_DB_DISPOSABLE === "true", "Disposable test DB gerekli.");
}

async function reservePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Port alinamadi.")));
        return;
      }
      const port = address.port;
      server.close(() => resolvePort(port));
    });
  });
}

function delay(ms: number) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function startServer(): Promise<{ baseUrl: string; logs: () => string; close: () => Promise<void> }> {
  const port = await reservePort();
  const repoRoot = resolve(import.meta.dirname, "../..");
  let output = "";
  const child: ChildProcess = spawn(process.execPath, ["--enable-source-maps", resolve(repoRoot, "artifacts/api-server/dist/index.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      ENABLE_DEMO_SEED: "false",
      ENABLE_DEMO_SEED_USERS: "false",
      ENABLE_SUPERADMIN_BOOTSTRAP: "false",
      ENABLE_MGM_BOOTSTRAP: "false",
      ENABLE_MGM_SCHEDULER: "false",
      AI_ENABLED: "true",
      AI_PROVIDER: "mock",
      AI_ALLOW_MOCK_PROVIDER: "true",
      AI_DEVELOPMENT_DATA_POLICY: "summary_only",
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`API erken kapandi: ${output.slice(-800)}`);
    try {
      if ((await fetch(`${baseUrl}/api/healthz`, { signal: AbortSignal.timeout(500) })).status === 200) {
        return {
          baseUrl,
          logs: () => output,
          close: async () => {
            child.kill("SIGTERM");
            await Promise.race([
              new Promise<void>((resolveClose) => child.once("close", () => resolveClose())),
              delay(20_000).then(() => {
                child.kill("SIGKILL");
                throw new Error("API shutdown zaman asimi.");
              }),
            ]);
          },
        };
      }
    } catch {}
    await delay(250);
  }
  child.kill("SIGKILL");
  throw new Error(`API readiness zaman asimi: ${output.slice(-1_000)}`);
}

async function login(baseUrl: string, username: string): Promise<string> {
  const password = process.env.E2E_TEST_PASSWORD;
  assert(password, "E2E_TEST_PASSWORD yok.");
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  assert(response.status === 200, `${username} login 200 yerine ${response.status}`);
  const body = await response.json() as { token?: unknown };
  assert(typeof body.token === "string", `${username} token alamadi.`);
  return body.token;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function json(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) as unknown : null;
}

async function expectStatus(response: Response, expected: number, message: string) {
  const text = await response.clone().text();
  assert(response.status === expected, `${message} beklenen ${expected}, alinan ${response.status}: ${text.slice(0, 1_000)}`);
}

async function main() {
  assertDisposableDatabase();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const server = await startServer();
  let assertions = 0;
  try {
    const adminToken = await login(server.baseUrl, process.env.E2E_ADMIN_USERNAME!);
    const standardToken = await login(server.baseUrl, process.env.E2E_STANDARD_USERNAME!);
    const superadminToken = await login(server.baseUrl, process.env.E2E_SUPERADMIN_USERNAME!);
    const users = await pool.query<{ username: string; company_id: number; unit_id: number | null }>(
      "SELECT username, company_id, unit_id FROM users WHERE username = ANY($1::text[])",
      [[process.env.E2E_ADMIN_USERNAME, process.env.E2E_STANDARD_USERNAME, process.env.E2E_SUPERADMIN_USERNAME].filter(Boolean)],
    );
    const admin = users.rows.find((row) => row.username === process.env.E2E_ADMIN_USERNAME);
    const standard = users.rows.find((row) => row.username === process.env.E2E_STANDARD_USERNAME);
    assert(admin && standard?.unit_id, "Fixture kullanicilari eksik.");

    const defaultPolicy = await fetch(`${server.baseUrl}/api/company-settings/ai?companyId=${admin.company_id}`, { headers: auth(adminToken) });
    await expectStatus(defaultPolicy, 200, "Default AI policy");
    const defaultBody = await json(defaultPolicy) as { dataPolicy?: unknown; version?: unknown };
    assert(defaultBody.dataPolicy === "disabled" && defaultBody.version === 0, "Default AI policy disabled olmali.");
    assertions += 1;

    const disabledCreate = await fetch(`${server.baseUrl}/api/ai/analyses`, {
      method: "POST",
      headers: { ...auth(adminToken), "Content-Type": "application/json" },
      body: JSON.stringify({ analysisType: "energy_performance_overview", year: 2026, companyId: admin.company_id, provider: "gemini", cacheKey: "evil" }),
    });
    await expectStatus(disabledCreate, 403, "Disabled policy provider cagrisi");
    assertions += 1;

    const standardPatch = await fetch(`${server.baseUrl}/api/company-settings/ai`, {
      method: "PATCH",
      headers: { ...auth(standardToken), "Content-Type": "application/json" },
      body: JSON.stringify({ dataPolicy: "production_allowed" }),
    });
    await expectStatus(standardPatch, 403, "Standard policy degistiremez");
    assertions += 1;

    const patched = await fetch(`${server.baseUrl}/api/company-settings/ai?companyId=${admin.company_id}`, {
      method: "PATCH",
      headers: { ...auth(adminToken), "Content-Type": "application/json" },
      body: JSON.stringify({ dataPolicy: "production_allowed", retentionDays: 365, expectedSettingsVersion: 0 }),
    });
    await expectStatus(patched, 200, "Admin policy patch");
    const patchedBody = await json(patched) as { dataPolicy?: unknown; version?: number };
    assert(patchedBody.dataPolicy === "production_allowed" && patchedBody.version === 1, "Policy production_allowed olmali.");
    assertions += 1;

    const conflict = await fetch(`${server.baseUrl}/api/company-settings/ai?companyId=${admin.company_id}`, {
      method: "PATCH",
      headers: { ...auth(adminToken), "Content-Type": "application/json" },
      body: JSON.stringify({ dataPolicy: "production_allowed", expectedSettingsVersion: 0 }),
    });
    await expectStatus(conflict, 409, "Policy optimistic conflict");
    assertions += 1;

    const first = await fetch(`${server.baseUrl}/api/ai/analyses`, {
      method: "POST",
      headers: { ...auth(adminToken), "Content-Type": "application/json" },
      body: JSON.stringify({ analysisType: "energy_performance_overview", year: 2026, companyId: admin.company_id, model: "evil" }),
    });
    await expectStatus(first, 201, "Persisted AI create");
    const firstBody = await json(first) as {
      analysis?: { id?: number; result?: unknown; status?: string };
      meta?: { cacheHit?: boolean; dataVersion?: string; usage?: { inputTokens?: number | null; estimatedCost?: number | null; currency?: string | null } };
    };
    assert(typeof firstBody.analysis?.id === "number", "Analysis id donmeli.");
    assert(firstBody.analysis?.status === "completed", "Analysis completed olmali.");
    assert(aiAnalysisResultSchema.safeParse(firstBody.analysis?.result).success, "Result Zod semasindan gecmeli.");
    assert(firstBody.meta?.cacheHit === false && typeof firstBody.meta.dataVersion === "string", "Ilk istek cache miss olmali.");
    assert(firstBody.meta.usage?.estimatedCost === 0 && firstBody.meta.usage.currency === "USD", "Mock maliyet 0 olarak kaydedilmeli.");
    assertions += 5;

    const analysisId = firstBody.analysis.id;
    const rowsAfterFirst = await pool.query<{ analysis_count: string; attempt_count: string; prompt_count: string }>(
      `SELECT
        (SELECT count(*) FROM ai_analyses)::text AS analysis_count,
        (SELECT count(*) FROM ai_analysis_attempts)::text AS attempt_count,
        (SELECT count(*) FROM ai_analyses WHERE result_json::text ILIKE '%raw prompt%' OR result_json::text ILIKE '%api_key%' OR result_json::text ILIKE '%authorization%')::text AS prompt_count`,
    );
    assert(Number(rowsAfterFirst.rows[0]?.analysis_count) === 1 && Number(rowsAfterFirst.rows[0]?.attempt_count) === 1, "Ilk analiz ve attempt kaydi olusmali.");
    assert(Number(rowsAfterFirst.rows[0]?.prompt_count) === 0, "DB result raw prompt/secret saklamamali.");
    assertions += 2;

    const second = await fetch(`${server.baseUrl}/api/ai/analyses`, {
      method: "POST",
      headers: { ...auth(adminToken), "Content-Type": "application/json" },
      body: JSON.stringify({ analysisType: "energy_performance_overview", year: 2026, companyId: admin.company_id }),
    });
    await expectStatus(second, 200, "Persisted AI cache hit");
    const secondBody = await json(second) as { meta?: { cacheHit?: boolean; sourceAnalysisId?: number | null } };
    assert(secondBody.meta?.cacheHit === true && secondBody.meta.sourceAnalysisId === analysisId, "Ikinci istek cache hit olmali.");
    const rowsAfterSecond = await pool.query<{ analysis_count: string; attempt_count: string }>("SELECT (SELECT count(*) FROM ai_analyses)::text AS analysis_count, (SELECT count(*) FROM ai_analysis_attempts)::text AS attempt_count");
    assert(Number(rowsAfterSecond.rows[0]?.analysis_count) === 2 && Number(rowsAfterSecond.rows[0]?.attempt_count) === 1, "Cache hit yeni attempt olusturmamali.");
    assertions += 2;

    const detail = await fetch(`${server.baseUrl}/api/ai/analyses/${analysisId}?companyId=${admin.company_id}`, { headers: auth(adminToken) });
    await expectStatus(detail, 200, "Analysis detail");
    const detailBody = await json(detail) as { analysis?: { result?: unknown }; meta?: { attempts?: unknown[] } };
    assert(aiAnalysisResultSchema.safeParse(detailBody.analysis?.result).success, "Detail result parse edilmis olmali.");
    assert(Array.isArray(detailBody.meta?.attempts) && detailBody.meta.attempts.length === 1, "Detail attempt ozeti donmeli.");
    assertions += 2;

    const list = await fetch(`${server.baseUrl}/api/ai/analyses?companyId=${admin.company_id}&limit=10&offset=0`, { headers: auth(adminToken) });
    await expectStatus(list, 200, "Analysis list");
    const listBody = await json(list) as { items?: Array<Record<string, unknown>> };
    assert(Array.isArray(listBody.items) && listBody.items.length >= 2, "List analizleri donmeli.");
    assert(!JSON.stringify(listBody.items).includes("findings"), "List tam result JSON dondurmemeli.");
    assertions += 2;

    const standardOtherDetail = await fetch(`${server.baseUrl}/api/ai/analyses/${analysisId}`, { headers: auth(standardToken) });
    await expectStatus(standardOtherDetail, 404, "Standard company-level analizi okuyamaz");
    const superNoCompany = await fetch(`${server.baseUrl}/api/ai/analyses`, { headers: auth(superadminToken) });
    await expectStatus(superNoCompany, 400, "Superadmin explicit company olmadan listeleyemez");
    assertions += 2;

    await pool.query(
      `UPDATE consumption SET kwh = kwh + 1
       WHERE id = (SELECT c.id FROM consumption c JOIN meters m ON m.id=c.meter_id WHERE c.company_id=$1 AND c.year=2026 ORDER BY c.id LIMIT 1)`,
      [admin.company_id],
    );
    const third = await fetch(`${server.baseUrl}/api/ai/analyses`, {
      method: "POST",
      headers: { ...auth(adminToken), "Content-Type": "application/json" },
      body: JSON.stringify({ analysisType: "energy_performance_overview", year: 2026, companyId: admin.company_id }),
    });
    await expectStatus(third, 201, "DataVersion degisince cache miss");
    const thirdBody = await json(third) as { meta?: { cacheHit?: boolean; dataVersion?: string } };
    assert(thirdBody.meta?.cacheHit === false && thirdBody.meta.dataVersion !== firstBody.meta.dataVersion, "Tuketim degisikligi cache miss uretmeli.");
    assertions += 1;

    const audit = await pool.query<{ serialized: string }>("SELECT coalesce(changes_json::text,'') || coalesce(metadata_json::text,'') AS serialized FROM audit_events WHERE action LIKE 'ai.%' OR action LIKE 'company_ai_settings.%'");
    const auditText = audit.rows.map((row) => row.serialized).join("\n").toLowerCase();
    assert((audit.rowCount ?? 0) >= 4, "AI audit eventleri olusmali.");
    for (const forbidden of ["api_key", "gemini_api_key", "prompt", "resultjson", "authorization", "password"]) {
      assert(!auditText.includes(forbidden), `Audit hassas alan sizdirdi: ${forbidden}`);
    }
    const dbLeak = await pool.query<{ leaks: string }>(
      `SELECT (
        SELECT count(*) FROM ai_analyses
        WHERE coalesce(result_json::text,'') ILIKE '%api_key%'
          OR coalesce(result_json::text,'') ILIKE '%authorization%'
          OR coalesce(error_message_safe,'') ILIKE '%secret%'
      )::text AS leaks`,
    );
    assert(Number(dbLeak.rows[0]?.leaks) === 0, "AI DB kayitlari secret sizdirmemeli.");
    assertions += 3;

    console.log(JSON.stringify({ aiAnalysisPersistenceAssertions: assertions }));
  } finally {
    await pool.end();
    await server.close().catch((error) => {
      throw new Error(`API kapatilamadi: ${error instanceof Error ? error.message : String(error)}\n${server.logs().slice(-1_000)}`);
    });
  }
}

await main();
