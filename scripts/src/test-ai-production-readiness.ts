import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function runScript(args: string[]) {
  return await new Promise<{ code: number | null; output: string }>((resolveRun) => {
    const repoRoot = resolve(import.meta.dirname, "../..");
    const child = spawn(process.execPath, ["./node_modules/tsx/dist/cli.mjs", "./src/ai-retention-cleanup.ts", ...args], {
      cwd: resolve(repoRoot, "scripts"),
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.on("close", (code) => resolveRun({ code, output }));
  });
}

async function main() {
  assert(process.env.NODE_ENV === "test" && process.env.TEST_DB_DISPOSABLE === "true", "Disposable test DB gerekli.");
  const repoRoot = resolve(import.meta.dirname, "../..");
  const apiModule = (relative: string) => pathToFileURL(resolve(repoRoot, relative)).href;
  const { readAiRuntimeConfig } = await import(apiModule("artifacts/api-server/src/lib/ai/config.ts")) as {
    readAiRuntimeConfig(env?: NodeJS.ProcessEnv): {
      productionDataEnabled: boolean;
      circuitBreakerEnabled: boolean;
      circuitBreakerFailureThreshold: number;
      circuitBreakerWindowMs: number;
      circuitBreakerCooldownMs: number;
    };
  };
  const circuit = await import(apiModule("artifacts/api-server/src/lib/ai/circuit-breaker.ts")) as {
    beforeProviderCall(provider: string, model: string, config: ReturnType<typeof readAiRuntimeConfig>, leaseOwner?: string): Promise<{ state: string }>;
    getCircuitDiagnostics(): Promise<Array<{ state: string; failureCount: number }>>;
    recordProviderFailure(provider: string, model: string, code: string, config: ReturnType<typeof readAiRuntimeConfig>): Promise<{ opened: boolean }>;
    recordProviderSuccess(provider: string, model: string): Promise<void>;
    resetCircuitStateForTests(): Promise<void>;
  };
  const { estimateModelUsageCost } = await import(apiModule("artifacts/api-server/src/lib/ai/model-pricing.ts")) as {
    estimateModelUsageCost(provider: string, model: string, usage: Record<string, number | null>): { estimatedCost: string | null; currency: string | null; pricingCatalogVersion: string | null };
  };
  const { runPersistedAiAnalysis } = await import(apiModule("artifacts/api-server/src/lib/ai/analysis-service.ts")) as {
    runPersistedAiAnalysis(input: Record<string, unknown>): Promise<{ analysis: { id: number } }>;
  };
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let assertions = 0;
  const savedEnv = { ...process.env };
  try {
    assert(readAiRuntimeConfig({}).productionDataEnabled === false, "Production data default kapali olmali.");
    assert(readAiRuntimeConfig({ AI_PRODUCTION_DATA_ENABLED: "true" }).productionDataEnabled === true, "Production data yalniz true ile acilmali.");
    assertions += 2;

    await circuit.resetCircuitStateForTests();
    const circuitConfig = readAiRuntimeConfig({
      AI_CIRCUIT_BREAKER_ENABLED: "true",
      AI_CIRCUIT_BREAKER_FAILURE_THRESHOLD: "1",
      AI_CIRCUIT_BREAKER_WINDOW_MS: "60000",
      AI_CIRCUIT_BREAKER_COOLDOWN_MS: "60000",
    });
    assert((await circuit.beforeProviderCall("gemini", "gemini-2.5-flash", circuitConfig)).state === "closed", "Ilk circuit kapali olmali.");
    const opened = await circuit.recordProviderFailure("gemini", "gemini-2.5-flash", "AI_RATE_LIMITED", circuitConfig);
    assert(opened.opened === true, "Threshold sonrasi circuit acilmali.");
    const openDiagnostics = await circuit.getCircuitDiagnostics();
    assert(openDiagnostics[0]?.state === "open" && openDiagnostics[0].failureCount === 1, "Circuit state DB'de acik gorunmeli.");
    let blocked = false;
    try {
      await circuit.beforeProviderCall("gemini", "gemini-2.5-flash", circuitConfig);
    } catch {
      blocked = true;
    }
    assert(blocked, "Acik circuit provider cagrisi engellemeli.");
    await pool.query("UPDATE ai_provider_circuit_state SET next_probe_at=now() - interval '1 second' WHERE provider='gemini' AND model='gemini-2.5-flash'");
    assert((await circuit.beforeProviderCall("gemini", "gemini-2.5-flash", circuitConfig, "probe-1")).state === "half_open_probe", "Cooldown sonrasi tek probe verilmeli.");
    let secondProbeBlocked = false;
    try {
      await circuit.beforeProviderCall("gemini", "gemini-2.5-flash", circuitConfig, "probe-2");
    } catch {
      secondProbeBlocked = true;
    }
    assert(secondProbeBlocked, "Lease varken ikinci half-open probe engellenmeli.");
    await circuit.recordProviderSuccess("gemini", "gemini-2.5-flash");
    assert((await circuit.getCircuitDiagnostics())[0]?.state === "closed", "Basarili probe circuit'i kapatmali.");
    assertions += 7;

    const priced = estimateModelUsageCost("gemini", "gemini-2.5-flash", {
      inputTokens: 1_000_000,
      cachedTokens: 1_000_000,
      outputTokens: 1_000_000,
      thinkingTokens: 1_000_000,
      totalTokens: 4_000_000,
    });
    assert(priced.estimatedCost === "5.330000" && priced.currency === "USD" && priced.pricingCatalogVersion !== null, "Gemini fiyat hesaplama decimal ve kataloglu olmali.");
    assert(estimateModelUsageCost("gemini", "unknown-model", { inputTokens: 1, outputTokens: null, thinkingTokens: null, cachedTokens: null, totalTokens: 1 }).estimatedCost === null, "Bilinmeyen model maliyeti null olmali.");
    assertions += 2;

    const users = await pool.query<{ id: number; company_id: number; unit_id: number | null; role: string }>(
      "SELECT id, company_id, unit_id, role FROM users WHERE username=$1 LIMIT 1",
      [process.env.E2E_ADMIN_USERNAME],
    );
    const admin = users.rows[0];
    assert(admin, "Fixture admin kullanicisi eksik.");
    await pool.query("DELETE FROM ai_analysis_attempts");
    await pool.query("DELETE FROM ai_analyses");
    await pool.query(
      `
        INSERT INTO company_ai_settings (company_id, data_policy, retention_days, settings_version)
        VALUES ($1, 'production_allowed', 30, 1)
        ON CONFLICT (company_id) DO UPDATE SET data_policy='production_allowed', retention_days=30, settings_version=company_ai_settings.settings_version+1
      `,
      [admin.company_id],
    );
    Object.assign(process.env, {
      AI_ENABLED: "true",
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "test-key",
      GEMINI_MODEL: "gemini-2.5-flash",
      AI_PRODUCTION_DATA_ENABLED: "false",
    });
    let productionBlocked = false;
    try {
      await runPersistedAiAnalysis({
        scope: { companyId: admin.company_id, unitId: null, year: 2026 },
        analysisType: "energy_performance_overview",
        user: { userId: admin.id, role: admin.role, companyId: admin.company_id, unitId: admin.unit_id, username: "admin", name: "Admin" },
        requestId: "production-data-disabled-test",
      });
    } catch {
      productionBlocked = true;
    }
    assert(productionBlocked, "Production data bayragi kapaliyken Gemini analizi bloklanmali.");
    const attemptsAfterBlock = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM ai_analysis_attempts");
    assert(Number(attemptsAfterBlock.rows[0]?.count) === 0, "Bloklanan Gemini akisi attempt veya provider cagrisi olusturmamali.");
    assertions += 2;

    Object.assign(process.env, {
      AI_PROVIDER: "mock",
      AI_ALLOW_MOCK_PROVIDER: "true",
      AI_MOCK_MODE: "success",
    });
    const mockResult = await runPersistedAiAnalysis({
      scope: { companyId: admin.company_id, unitId: null, year: 2026 },
      analysisType: "energy_performance_overview",
      user: { userId: admin.id, role: admin.role, companyId: admin.company_id, unitId: admin.unit_id, username: "admin", name: "Admin" },
      requestId: "mock-metadata-test",
    });
    const metadataRows = await pool.query<{ synthetic_context: boolean; provider_data_classification: string; production_data_enabled: boolean; pricing_catalog_version: string | null }>(
      "SELECT synthetic_context, provider_data_classification, production_data_enabled, pricing_catalog_version FROM ai_analysis_attempts WHERE analysis_id=$1",
      [mockResult.analysis.id],
    );
    assert(metadataRows.rows[0]?.synthetic_context === true && metadataRows.rows[0]?.provider_data_classification === "mock_or_synthetic", "Mock attempt synthetic metadata ile kaydedilmeli.");
    assert(metadataRows.rows[0]?.pricing_catalog_version === "non-billable-provider-v1", "Non-billable provider katalog surumu kaydedilmeli.");
    assertions += 2;

    const old = await pool.query<{ id: number }>(
      `
        INSERT INTO ai_analyses
          (company_id, requested_by_user_id, analysis_type, period_start, period_end, status, provider, model,
           context_schema_version, output_schema_version, prompt_policy_version, builder_version, redaction_policy_version,
           limit_policy_version, data_version, cache_key, cache_hit, fallback_used, data_sufficiency, context_truncated,
           result_json, started_at, completed_at, created_at, updated_at)
        VALUES ($1, $2, 'energy_performance_overview', '2026-01-01', '2026-12-31', 'completed', 'mock', 'mock-v1',
          '1', 'ai-analysis-output-v1', 'test', 'test', 'test', 'test', 'retention-old', 'retention-old', false, false,
          'sufficient', false, '{}'::jsonb, now() - interval '60 days', now() - interval '60 days', now() - interval '60 days', now() - interval '60 days')
        RETURNING id
      `,
      [admin.company_id, admin.id],
    );
    const dryRun = await runScript(["--company-id", String(admin.company_id), "--max-rows", "20"]);
    assert(dryRun.code === 0 && dryRun.output.includes(String(old.rows[0]?.id)) && dryRun.output.includes("\"mode\": \"dry-run\""), "Retention dry-run adaylari gostermeli.");
    const stillThere = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM ai_analyses WHERE id=$1", [old.rows[0]?.id]);
    assert(Number(stillThere.rows[0]?.count) === 1, "Dry-run silmemeli.");
    const execute = await runScript(["--company-id", String(admin.company_id), "--execute", "--ack", `EXECUTE_AI_RETENTION_CLEANUP_${admin.company_id}`, "--max-rows", "20"]);
    assert(execute.code === 0 && execute.output.includes("\"deleted\": 1"), "Retention execute uygun eski analizi silmeli.");
    const cleanupState = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM ai_operational_state WHERE state_key='ai_retention_cleanup:last_run'");
    assert(Number(cleanupState.rows[0]?.count) === 1, "Retention cleanup son kosum state'i kaydetmeli.");
    assertions += 4;

    console.log(JSON.stringify({ aiProductionReadinessAssertions: assertions }));
  } finally {
    process.env = savedEnv;
    await pool.end();
  }
}

await main();
