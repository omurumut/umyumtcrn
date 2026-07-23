import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { Pool } from "pg";
import { aiAnalysisResultSchema } from "@workspace/api-zod";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function delay(ms: number) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function reservePort() {
  return await new Promise<number>((resolvePort, reject) => {
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

async function startServer(env: Record<string, string>): Promise<{ baseUrl: string; logs: () => string; close: () => Promise<void> }> {
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
      AI_ALLOW_MOCK_PROVIDER: "true",
      AI_DEVELOPMENT_DATA_POLICY: "summary_only",
      AI_CIRCUIT_BREAKER_FAILURE_THRESHOLD: "1",
      AI_CIRCUIT_BREAKER_COOLDOWN_MS: "60000",
      ...env,
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`API erken kapandi: ${output.slice(-1000)}`);
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
  throw new Error(`API readiness zaman asimi: ${output.slice(-1000)}`);
}

async function login(baseUrl: string, username: string) {
  const password = process.env.E2E_TEST_PASSWORD;
  assert(password, "E2E_TEST_PASSWORD yok.");
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  assert(response.status === 200, `${username} login ${response.status}`);
  const body = await response.json() as { token?: unknown };
  assert(typeof body.token === "string", "Token donmedi.");
  return body.token;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function json(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) as unknown : null;
}

async function expectStatus(response: Response, expected: number, label: string) {
  const text = await response.clone().text();
  assert(response.status === expected, `${label}: beklenen ${expected}, alinan ${response.status}: ${text.slice(0, 1000)}`);
}

async function patchPolicy(baseUrl: string, token: string, companyId: number, body: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}/api/company-settings/ai?companyId=${companyId}`, {
    method: "PATCH",
    headers: { ...auth(token), "Content-Type": "application/json" },
    body: JSON.stringify({ dataPolicy: "production_allowed", expectedSettingsVersion: 0, ...body }),
  });
  await expectStatus(response, 200, "AI policy patch");
  return await json(response) as { version: number };
}

async function main() {
  assert(process.env.NODE_ENV === "test" && process.env.TEST_DB_DISPOSABLE === "true", "Disposable test DB gerekli.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let assertions = 0;
  try {
    const userRows = await pool.query<{ username: string; id: number; company_id: number; unit_id: number | null }>(
      "SELECT username, id, company_id, unit_id FROM users WHERE username = ANY($1::text[])",
      [[process.env.E2E_ADMIN_USERNAME, process.env.E2E_SUPERADMIN_USERNAME].filter(Boolean)],
    );
    const admin = userRows.rows.find((row) => row.username === process.env.E2E_ADMIN_USERNAME);
    const superadmin = userRows.rows.find((row) => row.username === process.env.E2E_SUPERADMIN_USERNAME);
    assert(admin && superadmin, "Fixture kullanicilari eksik.");

    const fallbackServer = await startServer({ AI_PROVIDER: "mock", AI_MOCK_MODE: "timeout" });
    try {
      const adminToken = await login(fallbackServer.baseUrl, process.env.E2E_ADMIN_USERNAME!);
      const superToken = await login(fallbackServer.baseUrl, process.env.E2E_SUPERADMIN_USERNAME!);
      await patchPolicy(fallbackServer.baseUrl, adminToken, admin.company_id, { fallbackEnabled: true, maxConcurrentAnalyses: 2 });

      const fallback = await fetch(`${fallbackServer.baseUrl}/api/ai/analyses`, {
        method: "POST",
        headers: { ...auth(adminToken), "Content-Type": "application/json" },
        body: JSON.stringify({ analysisType: "energy_performance_overview", year: 2026, companyId: admin.company_id }),
      });
      await expectStatus(fallback, 201, "Timeout fallback");
      const body = await json(fallback) as { analysis?: { id?: number; result?: unknown }; meta?: { provider?: string; fallbackUsed?: boolean; usage?: { estimatedCost?: number | null; totalTokens?: number | null } } };
      assert(typeof body.analysis?.id === "number", "Fallback analysis id donmeli.");
      assert(body.meta?.fallbackUsed === true && body.meta.provider === "rule_based", "Fallback rule_based olarak etiketlenmeli.");
      assert(body.meta.usage?.estimatedCost === 0 && body.meta.usage.totalTokens === null, "Fallback maliyet/token guvenli olmali.");
      assert(aiAnalysisResultSchema.safeParse(body.analysis.result).success, "Fallback result Zod semasindan gecmeli.");
      const attemptRows = await pool.query<{ provider: string; success: boolean; error_code: string | null }>(
        "SELECT provider, success, error_code FROM ai_analysis_attempts WHERE analysis_id=$1 ORDER BY attempt_number",
        [body.analysis.id],
      );
      assert(attemptRows.rows.length === 2, "Gemini/mock failed attempt ve fallback attempt ayrilmali.");
      assert(attemptRows.rows[0]?.success === false && attemptRows.rows[1]?.provider === "rule_based" && attemptRows.rows[1]?.success === true, "Attempt lifecycle dogru olmali.");
      assertions += 6;

      const diagnostics = await fetch(`${fallbackServer.baseUrl}/api/admin/ai/diagnostics?companyId=${admin.company_id}`, { headers: auth(superToken) });
      await expectStatus(diagnostics, 200, "AI diagnostics");
      const diagnosticsText = JSON.stringify(await json(diagnostics)).toLowerCase();
      assert(diagnosticsText.includes("secretconfigured") && !diagnosticsText.includes("gemini_api_key") && !diagnosticsText.includes("api_key"), "Diagnostics secret deger dondurmemeli.");
      assertions += 1;
    } finally {
      await fallbackServer.close();
    }

    await pool.query("DELETE FROM ai_analysis_attempts");
    await pool.query("DELETE FROM ai_analyses");
    await pool.query("DELETE FROM company_ai_settings WHERE company_id=$1", [admin.company_id]);

    const limitServer = await startServer({
      AI_PROVIDER: "gemini",
      AI_PRODUCTION_DATA_ENABLED: "true",
      RUN_GEMINI_SMOKE: "false",
      GEMINI_API_KEY: "test-key",
      GEMINI_MODEL: "gemini-test-model",
    });
    try {
      const adminToken = await login(limitServer.baseUrl, process.env.E2E_ADMIN_USERNAME!);
      const policy = await patchPolicy(limitServer.baseUrl, adminToken, admin.company_id, { dailyAnalysisLimit: 1, monthlyAnalysisLimit: 1, fallbackEnabled: true });
      await pool.query(
        `INSERT INTO ai_analyses
          (company_id, unit_id, requested_by_user_id, analysis_type, period_start, period_end, status, provider, model,
           context_schema_version, output_schema_version, prompt_policy_version, builder_version, redaction_policy_version,
           limit_policy_version, data_version, cache_key, cache_hit, fallback_used, data_sufficiency, context_truncated,
           result_json, started_at, completed_at)
         VALUES ($1, NULL, $2, 'energy_performance_overview', '2026-01-01', '2026-12-31', 'completed', 'gemini', 'gemini-test-model',
           '1', 'ai-analysis-output-v1', 'test', 'test', 'test', 'test', 'quota-version', 'quota-cache', false, false,
           'sufficient', false, '{}'::jsonb, now(), now())`,
        [admin.company_id, admin.id],
      );
      const quota = await fetch(`${limitServer.baseUrl}/api/ai/analyses`, {
        method: "POST",
        headers: { ...auth(adminToken), "Content-Type": "application/json" },
        body: JSON.stringify({ analysisType: "equipment_improvement_opportunities", year: 2026, companyId: admin.company_id }),
      });
      await expectStatus(quota, 429, "Daily quota block");
      const quotaBody = await json(quota) as { code?: string };
      assert(quotaBody.code === "AI_DAILY_LIMIT_REACHED", "Gunluk kota kodu donmeli.");
      assertions += 1;

      await pool.query("DELETE FROM ai_analyses WHERE cache_key='quota-cache'");
      await pool.query("UPDATE company_ai_settings SET daily_analysis_limit=NULL, monthly_analysis_limit=NULL, max_concurrent_analyses=1 WHERE company_id=$1", [admin.company_id]);
      await pool.query(
        `INSERT INTO ai_analyses
          (company_id, requested_by_user_id, analysis_type, period_start, period_end, status, provider, model,
           context_schema_version, output_schema_version, prompt_policy_version, builder_version, redaction_policy_version,
           limit_policy_version, data_version, cache_key, cache_hit, fallback_used, data_sufficiency, context_truncated, started_at)
         VALUES ($1, $2, 'energy_performance_overview', '2026-01-01', '2026-12-31', 'processing', 'gemini', 'gemini-test-model',
           '1', 'ai-analysis-output-v1', 'test', 'test', 'test', 'test', 'concurrency-version', 'processing-cache', false, false,
           'sufficient', false, now() + interval '1 hour')`,
        [admin.company_id, admin.id],
      );
      await pool.query(
        `INSERT INTO ai_analyses
          (company_id, requested_by_user_id, analysis_type, period_start, period_end, status, provider, model,
           context_schema_version, output_schema_version, prompt_policy_version, builder_version, redaction_policy_version,
           limit_policy_version, data_version, cache_key, cache_hit, fallback_used, data_sufficiency, context_truncated, started_at)
         VALUES ($1, NULL, 'energy_performance_overview', '2026-01-01', '2026-12-31', 'processing', 'gemini', 'gemini-test-model',
           '1', 'ai-analysis-output-v1', 'test', 'test', 'test', 'test', 'concurrency-version-2', 'processing-cache-2', false, false,
           'sufficient', false, now() + interval '1 hour')`,
        [admin.company_id],
      );
      const activeCheck = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM ai_analyses WHERE company_id=$1 AND status='processing' AND completed_at IS NULL", [admin.company_id]);
      assert(Number(activeCheck.rows[0]?.count) >= 2, "Test processing kayitlari DB'de gorunmeli.");
      const limitSuperToken = await login(limitServer.baseUrl, process.env.E2E_SUPERADMIN_USERNAME!);
      const activeDiagnostics = await fetch(`${limitServer.baseUrl}/api/admin/ai/diagnostics`, { headers: auth(limitSuperToken) });
      await expectStatus(activeDiagnostics, 200, "Active diagnostics");
      const activeDiagnosticsBody = await json(activeDiagnostics) as { usage?: { activeProcessing?: number } };
      assert((activeDiagnosticsBody.usage?.activeProcessing ?? 0) >= 2, "API diagnostics processing kayitlarini gormeli.");
      assertions += 1;

      const standardPatch = await fetch(`${limitServer.baseUrl}/api/company-settings/ai`, {
        method: "PATCH",
        headers: { ...auth(adminToken), "Content-Type": "application/json" },
        body: JSON.stringify({ dataPolicy: "production_allowed", expectedSettingsVersion: policy.version - 1 }),
      });
      await expectStatus(standardPatch, 409, "Optimistic lock conflict");
      assertions += 1;
    } finally {
      await limitServer.close();
    }

    const auditRows = await pool.query<{ serialized: string }>("SELECT coalesce(metadata_json::text,'') AS serialized FROM audit_events WHERE action LIKE 'ai.%'");
    const auditText = auditRows.rows.map((row) => row.serialized).join("\n").toLowerCase();
    assert(auditText.includes("fallback") || auditText.includes("quota") || auditText.includes("concurrency"), "AI resilience auditleri olusmali.");
    for (const forbidden of ["prompt", "context", "result_json", "gemini_api_key", "authorization", "password"]) {
      assert(!auditText.includes(forbidden), `Audit hassas alan sizdirdi: ${forbidden}`);
    }
    assertions += 1;

    console.log(JSON.stringify({ aiResilienceAssertions: assertions }));
  } finally {
    await pool.end();
  }
}

await main();
