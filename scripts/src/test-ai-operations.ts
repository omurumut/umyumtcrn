import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { Pool } from "pg";

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
      server.close(() => resolvePort(address.port));
    });
  });
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
      AI_MOCK_MODE: "success",
      RUN_GEMINI_SMOKE: "false",
      GEMINI_API_KEY: "",
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
  await expectStatus(response, 200, `${username} login`);
  const body = await json(response) as { token?: unknown };
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

async function seedAiOperations(pool: Pool, users: FixtureUsers) {
  await pool.query("DELETE FROM ai_analysis_attempts");
  await pool.query("DELETE FROM ai_analyses");
  await pool.query("DELETE FROM company_ai_settings");
  await pool.query("DELETE FROM ai_provider_circuit_state");
  await pool.query("DELETE FROM ai_operational_state");

  await pool.query(
    `INSERT INTO company_ai_settings
      (company_id, data_policy, retention_days, daily_analysis_limit, monthly_analysis_limit, max_concurrent_analyses, fallback_enabled, updated_by)
     VALUES
      ($1, 'production_allowed', 365, 50, 500, 3, true, $2),
      ($3, 'synthetic_only', 180, 10, 100, 2, true, $4)`,
    [users.admin.company_id, users.admin.id, users.standardB.company_id, users.superadmin.id],
  );

  const sourceA = await insertAnalysis(pool, {
    companyId: users.admin.company_id,
    unitId: users.standard.unit_id,
    userId: users.admin.id,
    status: "completed",
    provider: "gemini",
    model: "gemini-test",
    cacheHit: false,
    fallbackUsed: false,
    createdAt: "2026-07-20T10:00:00.000Z",
    completedAt: "2026-07-20T10:00:02.000Z",
    resultJson: { findings: [{ id: "synthetic-finding" }] },
    cacheKey: "ops-a-source",
  });
  await insertAttempt(pool, { analysisId: sourceA, attempt: 1, provider: "gemini", model: "gemini-test", success: true, tokens: 160, cost: "0.001600", latency: 2000, createdAt: "2026-07-20T10:00:00.000Z" });

  const cacheA = await insertAnalysis(pool, {
    companyId: users.admin.company_id,
    unitId: users.standard.unit_id,
    userId: users.kontrol.id,
    status: "completed",
    provider: "gemini",
    model: "gemini-test",
    cacheHit: true,
    sourceAnalysisId: sourceA,
    fallbackUsed: false,
    createdAt: "2026-07-21T10:00:00.000Z",
    completedAt: "2026-07-21T10:00:00.250Z",
    resultJson: null,
    cacheKey: "ops-a-cache",
  });
  assert(cacheA > sourceA, "Cache analysis olusmali.");

  const fallbackA = await insertAnalysis(pool, {
    companyId: users.admin.company_id,
    unitId: null,
    userId: users.admin.id,
    status: "completed",
    provider: "rule_based",
    model: "fallback-v1",
    cacheHit: false,
    fallbackUsed: true,
    createdAt: "2026-07-22T09:00:00.000Z",
    completedAt: "2026-07-22T09:00:03.000Z",
    resultJson: { findings: [] },
    cacheKey: "ops-a-fallback",
  });
  await insertAttempt(pool, { analysisId: fallbackA, attempt: 1, provider: "gemini", model: "gemini-test", success: false, errorCode: "AI_TIMEOUT", tokens: null, cost: null, latency: 3000, createdAt: "2026-07-22T09:00:00.000Z" });
  await insertAttempt(pool, { analysisId: fallbackA, attempt: 2, provider: "rule_based", model: "fallback-v1", success: true, tokens: null, cost: "0.000000", latency: 50, createdAt: "2026-07-22T09:00:03.000Z" });

  const failedA = await insertAnalysis(pool, {
    companyId: users.admin.company_id,
    unitId: users.standard.unit_id,
    userId: users.admin.id,
    status: "failed",
    provider: "gemini",
    model: "gemini-test",
    cacheHit: false,
    fallbackUsed: false,
    errorCode: "AI_SCHEMA_INVALID",
    errorMessageSafe: "Yanit semasi gecersiz.",
    createdAt: "2026-07-22T11:00:00.000Z",
    completedAt: "2026-07-22T11:00:01.000Z",
    resultJson: null,
    cacheKey: "ops-a-failed",
  });
  await insertAttempt(pool, { analysisId: failedA, attempt: 1, provider: "gemini", model: "gemini-test", success: false, errorCode: "AI_SCHEMA_INVALID", tokens: 80, cost: "0.000800", latency: 1000, createdAt: "2026-07-22T11:00:00.000Z" });

  const processingA = await insertAnalysis(pool, {
    companyId: users.admin.company_id,
    unitId: users.standard.unit_id,
    userId: users.admin.id,
    status: "processing",
    provider: "gemini",
    model: "gemini-test",
    cacheHit: false,
    fallbackUsed: false,
    createdAt: "2026-07-23T08:00:00.000Z",
    startedAt: "2026-07-23T08:00:00.000Z",
    resultJson: null,
    cacheKey: "ops-a-processing",
  });
  await pool.query("UPDATE ai_analyses SET started_at=now() - interval '2 hours', updated_at=now() WHERE id=$1", [processingA]);

  const sourceB = await insertAnalysis(pool, {
    companyId: users.standardB.company_id,
    unitId: users.standardB.unit_id,
    userId: users.standardB.id,
    status: "completed",
    provider: "gemini",
    model: "gemini-test",
    cacheHit: false,
    fallbackUsed: false,
    createdAt: "2026-07-20T12:00:00.000Z",
    completedAt: "2026-07-20T12:00:01.500Z",
    resultJson: { findings: [{ id: "tenant-b-finding" }] },
    cacheKey: "ops-b-source",
  });
  await insertAttempt(pool, { analysisId: sourceB, attempt: 1, provider: "gemini", model: "gemini-test", success: true, tokens: 40, cost: "0.000400", latency: 1500, createdAt: "2026-07-20T12:00:00.000Z" });

  await pool.query(
    `INSERT INTO ai_provider_circuit_state
      (provider, model, state, failure_count, opened_at, next_probe_at, last_failure_code, last_failure_at, last_success_at, probe_lease_owner, probe_lease_expires_at)
     VALUES
      ('gemini', 'gemini-test', 'half_open', 2, '2026-07-22T11:00:01Z', '2026-07-23T09:00:00Z', 'AI_TIMEOUT', '2026-07-22T11:00:01Z', '2026-07-20T10:00:02Z', 'hidden-owner', '2026-07-23T09:05:00Z')`,
  );
  await pool.query(
    `INSERT INTO ai_operational_state (state_key, value_json, updated_at)
     VALUES ('ai_retention_cleanup:last_run', $1::jsonb, '2026-07-23T07:00:00Z')`,
    [JSON.stringify({ mode: "dry-run", companyId: users.admin.company_id, deletedAnalyses: 0, deletedAttempts: 0, skippedLinkedAnalyses: 1, durationMs: 123 })],
  );

  return { sourceA, fallbackA, failedA, sourceB };
}

async function insertAnalysis(pool: Pool, input: AnalysisInput) {
  const startedAt = input.startedAt ?? input.createdAt;
  const row = await pool.query<{ id: number }>(
    `INSERT INTO ai_analyses
      (company_id, unit_id, requested_by_user_id, analysis_type, period_start, period_end, status, provider, model,
       context_schema_version, output_schema_version, prompt_policy_version, builder_version, redaction_policy_version,
       limit_policy_version, data_version, cache_key, cache_hit, source_analysis_id, fallback_used, data_sufficiency,
       context_truncated, context_warnings_json, result_json, error_code, error_message_safe, started_at, completed_at,
       created_at, updated_at)
     VALUES
      ($1, $2, $3, 'energy_performance_overview', '2026-01-01', '2026-12-31', $4, $5, $6,
       'ai-context-v1', 'ai-output-v1', 'prompt-v1', 'builder-v1', 'redaction-v1', 'limits-v1',
       'data-v1', $7, $8, $9, $10, 'sufficient', false, '[]'::jsonb, $11::jsonb, $12, $13,
       $14::timestamp, $15::timestamp, $16::timestamp, $16::timestamp)
     RETURNING id`,
    [
      input.companyId,
      input.unitId,
      input.userId,
      input.status,
      input.provider,
      input.model,
      `${input.cacheKey}-${input.companyId}`,
      input.cacheHit,
      input.sourceAnalysisId ?? null,
      input.fallbackUsed,
      input.resultJson === null ? null : JSON.stringify(input.resultJson),
      input.errorCode ?? null,
      input.errorMessageSafe ?? null,
      startedAt,
      input.completedAt ?? null,
      input.createdAt,
    ],
  );
  return row.rows[0]!.id;
}

async function insertAttempt(pool: Pool, input: AttemptInput) {
  await pool.query(
    `INSERT INTO ai_analysis_attempts
      (analysis_id, attempt_number, provider, model, started_at, completed_at, success, retryable, error_code,
       provider_http_status, input_tokens, output_tokens, thinking_tokens, cached_tokens, total_tokens, estimated_cost,
       currency, cost_calculation_version, pricing_catalog_version, data_policy, production_data_enabled,
       context_truncated, data_sufficiency, synthetic_context, provider_data_classification, latency_ms, created_at)
     VALUES
      ($1, $2, $3, $4, $5::timestamp, ($5::timestamp + ($6::int * interval '1 millisecond')), $7, false, $8,
       $9, $10, $11, 0, 0, $12, $13::numeric, 'USD', 'cost-v1', 'catalog-v1',
       'production_allowed', true, false, 'sufficient', true, 'synthetic', $6, $5::timestamp)`,
    [
      input.analysisId,
      input.attempt,
      input.provider,
      input.model,
      input.createdAt,
      input.latency,
      input.success,
      input.errorCode ?? null,
      input.success ? null : 503,
      input.tokens,
      input.tokens === null ? null : Math.floor(input.tokens / 2),
      input.tokens,
      input.cost,
    ],
  );
}

function rejectSensitivePayload(payload: unknown) {
  const text = JSON.stringify(payload).toLowerCase();
  for (const forbidden of ["prompt_text", "promptjson", "context_json", "contextjson", "result_json", "resultjson", "evidence", "api_key", "gemini_api_key", "hidden-owner"]) {
    assert(!text.includes(forbidden), `Hassas alan dondu: ${forbidden}`);
  }
}

async function main() {
  assert(process.env.NODE_ENV === "test" && process.env.TEST_DB_DISPOSABLE === "true", "Disposable test DB gerekli.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const server = await startServer();
  let assertions = 0;
  try {
    const users = await loadUsers(pool);
    const ids = await seedAiOperations(pool, users);
    const adminToken = await login(server.baseUrl, process.env.E2E_ADMIN_USERNAME!);
    const kontrolToken = await login(server.baseUrl, process.env.E2E_KONTROL_ADMIN_USERNAME!);
    const standardToken = await login(server.baseUrl, process.env.E2E_STANDARD_USERNAME!);
    const superToken = await login(server.baseUrl, process.env.E2E_SUPERADMIN_USERNAME!);
    const range = "from=2026-07-20&to=2026-07-23";

    const standardSummary = await fetch(`${server.baseUrl}/api/admin/ai/operations/summary?${range}`, { headers: auth(standardToken) });
    await expectStatus(standardSummary, 403, "standard summary");
    assertions += 1;

    const injectedAdminSummary = await fetch(`${server.baseUrl}/api/admin/ai/operations/summary?${range}&companyId=${users.standardB.company_id}`, { headers: auth(adminToken) });
    await expectStatus(injectedAdminSummary, 200, "admin summary injection");
    const adminSummary = await json(injectedAdminSummary) as SummaryResponse;
    assert(adminSummary.scope.companyId === users.admin.company_id && adminSummary.scope.isSystemWide === false, "Admin scope kendi firmasina zorlanmali.");
    assert(adminSummary.totals.totalRequests === 5, "Admin toplam request yanlis.");
    assert(adminSummary.totals.providerCalls === 3, "Cache hit provider call sayilmamali, fallback cift analiz olmamali.");
    assert(adminSummary.totals.cacheHit === 1 && adminSummary.totals.fallback === 1 && adminSummary.totals.failed === 1, "Admin cache/fallback/failed sayimlari yanlis.");
    assert(adminSummary.totals.activeProcessing === 1 && adminSummary.totals.staleProcessing === 1, "Active/stale sayimlari yanlis.");
    assert(adminSummary.tokens.total === 240 && adminSummary.cost.unknownCount === 1 && adminSummary.cost.currency === "USD", "Token/cost aggregate yanlis.");
    assert(adminSummary.circuit.items.length === 0 && adminSummary.circuit.label === "Kontrollu test cagrisi", "Admin circuit detayi gizlenmeli.");
    rejectSensitivePayload(adminSummary);
    assertions += 8;

    const kontrolSummary = await fetch(`${server.baseUrl}/api/admin/ai/operations/summary?${range}`, { headers: auth(kontrolToken) });
    await expectStatus(kontrolSummary, 200, "kontrol admin summary");
    const kontrolBody = await json(kontrolSummary) as SummaryResponse;
    assert(kontrolBody.scope.companyId === users.kontrol.company_id, "Kontrol admin kendi firmasini gormeli.");
    assertions += 1;

    const superSummaryResponse = await fetch(`${server.baseUrl}/api/admin/ai/operations/summary?${range}`, { headers: auth(superToken) });
    await expectStatus(superSummaryResponse, 200, "super summary");
    const superSummary = await json(superSummaryResponse) as SummaryResponse;
    assert(superSummary.scope.isSystemWide === true && superSummary.totals.totalRequests === 6, "Superadmin system-wide summary yanlis.");
    assert(superSummary.circuit.items.length === 1, "Superadmin circuit detayi gormeli.");
    rejectSensitivePayload(superSummary);
    assertions += 3;

    const timeseriesResponse = await fetch(`${server.baseUrl}/api/admin/ai/operations/timeseries?${range}`, { headers: auth(adminToken) });
    await expectStatus(timeseriesResponse, 200, "timeseries");
    const timeseries = await json(timeseriesResponse) as TimeseriesResponse;
    assert(timeseries.points.length === 4, "Daily bucket sayisi yanlis.");
    assert(timeseries.points.some((point) => point.day === "2026-07-23" && point.total === 1), "Bugun bucket/stale kaydi eksik.");
    assert(timeseries.points.some((point) => point.day === "2026-07-21" && point.cache_hit === 1), "Cache bucket eksik.");
    assertions += 3;

    const errorsResponse = await fetch(`${server.baseUrl}/api/admin/ai/operations/errors?${range}`, { headers: auth(adminToken) });
    await expectStatus(errorsResponse, 200, "errors");
    const errors = await json(errorsResponse) as ErrorsResponse;
    assert(errors.items.some((item) => item.code === "AI_TIMEOUT" && item.group === "provider"), "Provider hata grubu eksik.");
    assert(errors.items.some((item) => item.code === "AI_SCHEMA_INVALID" && item.group === "validation"), "Validation hata grubu eksik.");
    rejectSensitivePayload(errors);
    assertions += 3;

    const analysesResponse = await fetch(`${server.baseUrl}/api/admin/ai/operations/analyses?${range}&companyId=${users.standardB.company_id}&page=1&pageSize=2`, { headers: auth(adminToken) });
    await expectStatus(analysesResponse, 200, "analyses list");
    const analyses = await json(analysesResponse) as AnalysesResponse;
    assert(analyses.items.length === 2 && analyses.pagination.total === 5, "Pagination sonucu yanlis.");
    assert(analyses.items.every((item) => item.companyId === users.admin.company_id), "Admin list tenant disina cikti.");
    rejectSensitivePayload(analyses);
    assertions += 3;

    const detailResponse = await fetch(`${server.baseUrl}/api/admin/ai/operations/analyses/${ids.fallbackA}?${range}`, { headers: auth(adminToken) });
    await expectStatus(detailResponse, 200, "analysis detail");
    const detail = await json(detailResponse) as DetailResponse;
    assert(detail.attempts.length === 2, "Fallback detail attemptleri eksik.");
    assert(detail.analysis.sourceAnalysisId === null && detail.analysis.companyId === null, "Admin detail system alanlarini gizlemeli.");
    rejectSensitivePayload(detail);
    assertions += 3;

    const crossDetail = await fetch(`${server.baseUrl}/api/admin/ai/operations/analyses/${ids.sourceB}?${range}`, { headers: auth(adminToken) });
    await expectStatus(crossDetail, 404, "cross tenant detail");
    const badRange = await fetch(`${server.baseUrl}/api/admin/ai/operations/summary?from=2025-01-01&to=2026-07-23`, { headers: auth(superToken) });
    await expectStatus(badRange, 400, "range too large");
    assertions += 2;

    const adminCompanies = await fetch(`${server.baseUrl}/api/admin/ai/operations/companies?${range}`, { headers: auth(adminToken) });
    await expectStatus(adminCompanies, 403, "admin company usage denied");
    const superCompaniesResponse = await fetch(`${server.baseUrl}/api/admin/ai/operations/companies?${range}`, { headers: auth(superToken) });
    await expectStatus(superCompaniesResponse, 200, "super company usage");
    const companies = await json(superCompaniesResponse) as CompaniesResponse;
    const companyA = companies.items.find((item) => item.companyId === users.admin.company_id);
    const companyB = companies.items.find((item) => item.companyId === users.standardB.company_id);
    assert(companyA?.totalRequests === 5 && companyA.providerCalls === 3, "Firma A usage aggregate yanlis.");
    assert(companyB?.totalRequests === 1 && companyB.providerCalls === 1, "Firma B usage aggregate yanlis.");
    assert(companyA.costUnknownCount === 1 && companyA.policy === "production_allowed" && companyB.policy === "synthetic_only", "Policy/cost unknown usage yanlis.");
    rejectSensitivePayload(companies);
    assertions += 5;

    assert(!server.logs().toLowerCase().includes("gemini_api_key"), "Log secret adi sizdirmemeli.");
    assertions += 1;
    console.log(JSON.stringify({ aiOperationsAssertions: assertions }));
  } finally {
    await server.close();
    await pool.end();
  }
}

async function loadUsers(pool: Pool): Promise<FixtureUsers> {
  const rows = await pool.query<UserRow>(
    "SELECT username, id, company_id, unit_id FROM users WHERE username = ANY($1::text[])",
    [[process.env.E2E_ADMIN_USERNAME, process.env.E2E_KONTROL_ADMIN_USERNAME, process.env.E2E_STANDARD_USERNAME, process.env.E2E_STANDARD_B_USERNAME, process.env.E2E_SUPERADMIN_USERNAME].filter(Boolean)],
  );
  const byUsername = (username: string | undefined) => rows.rows.find((row) => row.username === username);
  const admin = byUsername(process.env.E2E_ADMIN_USERNAME);
  const kontrol = byUsername(process.env.E2E_KONTROL_ADMIN_USERNAME);
  const standard = byUsername(process.env.E2E_STANDARD_USERNAME);
  const standardB = byUsername(process.env.E2E_STANDARD_B_USERNAME);
  const superadmin = byUsername(process.env.E2E_SUPERADMIN_USERNAME);
  assert(admin && kontrol && standard?.unit_id && standardB?.unit_id && superadmin, "Fixture kullanicilari eksik.");
  return { admin, kontrol, standard: withUnit(standard), standardB: withUnit(standardB), superadmin };
}

function withUnit(user: UserRow): UserRow & { unit_id: number } {
  assert(user.unit_id !== null, "Fixture user unit eksik.");
  return user as UserRow & { unit_id: number };
}

type UserRow = {
  username: string;
  id: number;
  company_id: number;
  unit_id: number | null;
};

type FixtureUsers = {
  admin: UserRow;
  kontrol: UserRow;
  standard: UserRow & { unit_id: number };
  standardB: UserRow & { unit_id: number };
  superadmin: UserRow;
};

type AnalysisInput = {
  companyId: number;
  unitId: number | null;
  userId: number;
  status: string;
  provider: string;
  model: string;
  cacheHit: boolean;
  sourceAnalysisId?: number;
  fallbackUsed: boolean;
  errorCode?: string;
  errorMessageSafe?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  resultJson: Record<string, unknown> | null;
  cacheKey: string;
};

type AttemptInput = {
  analysisId: number;
  attempt: number;
  provider: string;
  model: string;
  success: boolean;
  errorCode?: string;
  tokens: number | null;
  cost: string | null;
  latency: number;
  createdAt: string;
};

type SummaryResponse = {
  scope: { companyId: number | null; isSystemWide: boolean };
  totals: {
    totalRequests: number;
    providerCalls: number;
    cacheHit: number;
    fallback: number;
    failed: number;
    activeProcessing: number;
    staleProcessing: number;
  };
  tokens: { total: number | null };
  cost: { unknownCount: number; currency: string | null };
  circuit: { label: string; items: Array<{ leaseActive: boolean }> };
};

type TimeseriesResponse = {
  points: Array<{ day: string; total: number; cache_hit: number }>;
};

type ErrorsResponse = {
  items: Array<{ code: string; group: string }>;
};

type AnalysesResponse = {
  items: Array<{ companyId: number }>;
  pagination: { total: number };
};

type DetailResponse = {
  analysis: { sourceAnalysisId: number | null; companyId: number | null };
  attempts: unknown[];
};

type CompaniesResponse = {
  items: Array<{ companyId: number; totalRequests: number; providerCalls: number; costUnknownCount: number; policy: string }>;
};

await main();
