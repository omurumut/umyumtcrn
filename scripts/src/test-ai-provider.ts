import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { aiAnalysisResultSchema } from "@workspace/api-zod";

type LoginBody = { token?: string };
type ProviderResult = {
  analysis: { findings: Array<{ estimatedImpact: { type: string } }> };
  meta: {
    provider: string;
    model: string;
    providerRequestId: string | null;
    usage?: {
      inputTokens: number | null;
      outputTokens: number | null;
      thinkingTokens: number | null;
      cachedTokens: number | null;
      totalTokens: number | null;
    };
  };
};
type MockProviderConstructor = new (mode?: string) => {
  generateAnalysis: (request: unknown, options: { timeoutMs: number }) => Promise<ProviderResult>;
};
type GeminiAdapter = {
  generateStructuredContent: (request: unknown) => Promise<{
    text: string | null;
    responseId: string | null;
    usageMetadata: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
      cachedContentTokenCount?: number;
      totalTokenCount?: number;
    } | null;
  }>;
};
type GeminiProviderConstructor = new (
  config: {
    apiKey: string | null;
    model: string | null;
    maxRetries: number;
    temperature: number;
    apiVersion: string | null;
  },
  client?: GeminiAdapter,
  sleeper?: (milliseconds: number) => Promise<void>,
) => {
  getModelName: () => string;
  generateAnalysis: (request: unknown, options: { timeoutMs: number; maxOutputTokens?: number }) => Promise<ProviderResult>;
};
type ProviderErrorConstructor = new (...args: never[]) => Error & { code: string };
type ScopeResolver = (input: {
  user: {
    userId: number;
    username: string;
    name: string;
    role: string;
    companyId: number;
    unitId: number | null;
    active: boolean;
  };
  requestedCompanyId?: number;
  requestedUnitId?: number;
  year: number;
  companyExists: (companyId: number) => Promise<boolean>;
  unitCompanyId: (unitId: number) => Promise<number | null>;
}) => Promise<unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function importApiModule<T>(relativePath: string): Promise<T> {
  return await import(pathToFileURL(resolve(import.meta.dirname, "../../artifacts/api-server/src", relativePath)).href) as T;
}

async function pureProviderAndScopeTests() {
  const mockModule = await importApiModule<{ MockAiProvider: MockProviderConstructor }>("lib/ai/mock-provider.ts");
  const geminiModule = await importApiModule<{ GeminiAiProvider: GeminiProviderConstructor }>("lib/ai/gemini-provider.ts");
  const errorModule = await importApiModule<{ AiProviderError: ProviderErrorConstructor }>("lib/ai/errors.ts");
  const scopeModule = await importApiModule<{ resolveAiScope: ScopeResolver }>("lib/ai/scope.ts");
  const { MockAiProvider } = mockModule;
  const { GeminiAiProvider } = geminiModule;
  const { AiProviderError } = errorModule;
  const { resolveAiScope } = scopeModule;

  const request = {
    analysisType: "energy_performance_overview" as const,
    scope: { companyId: 1, unitId: 10, year: 2026 },
    context: {
      technicalProfile: {
        status: "resolved" as const,
        effectiveDate: "2026-12-31",
        source: {
          type: "unit_technical_profile_snapshot" as const,
          snapshotId: 1,
          snapshotNumber: 1,
          profileVersion: 1,
          validFrom: "2026-01-01",
          validTo: null,
          publishedAt: "2026-01-01",
          daysSincePublished: 1,
        },
        unit: { id: 10, name: "Unit A" },
        facility: {},
        operation: {},
        systems: {},
        observations: [],
        customFacts: [],
        completeness: { percentage: 80, missingGroups: [] },
        warnings: [],
      },
      equipmentInventory: {
        source: {
          contextType: "equipment_inventory" as const,
          companyId: 1,
          unitId: 10,
          effectiveDate: "2026-12-31",
          generatedAt: "2026-12-31T00:00:00.000Z",
          sourcePolicy: "current_inventory" as const,
          aggregateSourceCount: 1,
          itemLimit: 0,
          totalCount: 1,
          includedCount: 0,
          truncated: false,
          selectionPolicy: "critical_energy_intensive_power_updated_code" as const,
          lastEquipmentUpdatedAt: null,
        },
        scope: {
          totalEquipment: 1,
          activeEquipment: 1,
          archivedEquipment: 0,
          criticalEquipment: 1,
          energyIntensiveEquipment: 1,
        },
        coverage: {
          withPrimaryMeter: 1,
          withAnyMeter: 1,
          withPrimaryEnergySource: 1,
          withAnyEnergySource: 1,
          withEnergyUseGroup: 0,
          withRatedPower: 1,
          withLifecycleData: 0,
          withCustomValues: 0,
        },
        aggregates: {
          installedPowerKw: 12,
          ratedPowerKw: 12,
          categoryCounts: { motor: 1 },
          statusCounts: { active: 1 },
          measurementMethodCounts: { measured: 1 },
          confidenceCounts: { high: 1 },
        },
        readiness: {
          status: "ready" as const,
          ready: true,
          activeEquipment: 1,
          coverage: {
            withAnyMeter: 1,
            withAnyEnergySource: 1,
            withTechnicalCapacity: 1,
            criticalOrEnergyIntensive: 1,
          },
          warnings: [],
          note: "ready",
        },
        warnings: [],
        items: [],
      },
      consumption: { totalKwh: 12_000, recordCount: 12 },
      seu: { itemCount: 1, categories: ["motor"] },
    },
  };

  const provider = new MockAiProvider();
  const first = await provider.generateAnalysis(request, { timeoutMs: 5_000 });
  const second = await provider.generateAnalysis(request, { timeoutMs: 5_000 });
  assert(first.meta.provider === "mock", "Provider adi mock olmali");
  assert(first.meta.model === "mock-v1", "Mock model adi korunmali");
  assert(first.meta.providerRequestId === second.meta.providerRequestId, "Mock request id deterministik olmali");
  assert(JSON.stringify(first.analysis) === JSON.stringify(second.analysis), "Mock analysis deterministik olmali");
  assert(aiAnalysisResultSchema.safeParse(first.analysis).success, "Mock analysis Zod semasindan gecmeli");
  assert(first.analysis.findings.every((finding) => finding.estimatedImpact.type !== "verified_calculation"), "Provider verified_calculation uretememeli");

  for (const [mode, code] of [
    ["timeout", "AI_TIMEOUT"],
    ["rate_limited", "AI_RATE_LIMITED"],
    ["invalid_schema", "AI_SCHEMA_INVALID"],
    ["empty_response", "AI_EMPTY_RESPONSE"],
    ["provider_unavailable", "AI_PROVIDER_UNAVAILABLE"],
  ] as const) {
    try {
      await new MockAiProvider(mode).generateAnalysis(request, { timeoutMs: 5_000 });
      throw new Error(`${mode} hata uretmedi`);
    } catch (error) {
      assert(error instanceof AiProviderError, `${mode} AiProviderError olmali`);
      assert(error.code === code, `${mode} ${code} koduna cevrilmeli`);
    }
  }

  const validGeminiText = JSON.stringify(first.analysis);
  const geminiCalls: unknown[] = [];
  const gemini = new GeminiAiProvider(
    { apiKey: "test-key", model: "env-model", maxRetries: 0, temperature: 0.1, apiVersion: null },
    {
      generateStructuredContent: async (call) => {
        geminiCalls.push(call);
        return {
          text: validGeminiText,
          responseId: "gemini-response-1",
          usageMetadata: {
            promptTokenCount: 11,
            candidatesTokenCount: 22,
            thoughtsTokenCount: 3,
            cachedContentTokenCount: 4,
            totalTokenCount: 40,
          },
        };
      },
    },
  );
  const geminiResult = await gemini.generateAnalysis(request, { timeoutMs: 5_000, maxOutputTokens: 777 });
  assert(gemini.getModelName() === "env-model", "Gemini model env/config degerinden alinmali");
  assert(geminiResult.meta.provider === "gemini", "Gemini provider adi korunmali");
  assert(geminiResult.meta.model === "env-model", "Gemini response model configden gelmeli");
  assert(geminiResult.meta.providerRequestId === "gemini-response-1", "Gemini response id map edilmeli");
  assert(geminiResult.meta.usage?.inputTokens === 11, "Prompt token map edilmeli");
  assert(geminiResult.meta.usage?.outputTokens === 22, "Candidate token map edilmeli");
  assert(geminiResult.meta.usage?.thinkingTokens === 3, "Thinking token map edilmeli");
  assert(geminiResult.meta.usage?.cachedTokens === 4, "Cached token map edilmeli");
  assert(geminiResult.meta.usage?.totalTokens === 40, "Total token map edilmeli");
  assert(aiAnalysisResultSchema.safeParse(geminiResult.analysis).success, "Gemini structured response Zod semasindan gecmeli");
  assert(geminiCalls.length === 1, "Gemini basarili cagri tek adapter cagrisi yapmali");
  const serializedGeminiCall = JSON.stringify(geminiCalls[0]);
  assert(serializedGeminiCall.includes('"responseMimeType"') === false, "Adapter disindaki test request SDK detayina baglanmamali");
  assert(!serializedGeminiCall.includes("test-key"), "Gemini API key adapter requeste sizmamali");

  for (const [config, code, message] of [
    [{ apiKey: null, model: "env-model", maxRetries: 0, temperature: 0.1, apiVersion: null }, "AI_NOT_CONFIGURED", "missing api key"],
    [{ apiKey: "test-key", model: null, maxRetries: 0, temperature: 0.1, apiVersion: null }, "AI_NOT_CONFIGURED", "missing model"],
  ] as const) {
    try {
      await new GeminiAiProvider(config, { generateStructuredContent: async () => ({ text: validGeminiText, responseId: null, usageMetadata: null }) })
        .generateAnalysis(request, { timeoutMs: 5_000 });
      throw new Error(`${message} hata uretmedi`);
    } catch (error) {
      assert(error instanceof AiProviderError, `${message} AiProviderError olmali`);
      assert(error.code === code, `${message} ${code} olmali`);
      assert(!String(error.message).includes("test-key"), `${message} secret sizdirmemeli`);
    }
  }

  for (const [text, code, message] of [
    [null, "AI_EMPTY_RESPONSE", "empty response"],
    ["```json\n{}\n```", "AI_SCHEMA_INVALID", "markdown response"],
    [JSON.stringify({ schemaVersion: "1.0", findings: [] }), "AI_SCHEMA_INVALID", "schema invalid"],
    [JSON.stringify({ ...first.analysis, findings: [{ ...first.analysis.findings[0], estimatedImpact: { type: "verified_calculation", description: "bad" } }] }), "AI_SCHEMA_INVALID", "verified calculation"],
  ] as const) {
    try {
      await new GeminiAiProvider(
        { apiKey: "test-key", model: "env-model", maxRetries: 0, temperature: 0.1, apiVersion: null },
        { generateStructuredContent: async () => ({ text, responseId: null, usageMetadata: null }) },
      ).generateAnalysis(request, { timeoutMs: 5_000 });
      throw new Error(`${message} hata uretmedi`);
    } catch (error) {
      assert(error instanceof AiProviderError, `${message} AiProviderError olmali`);
      assert(error.code === code, `${message} ${code} olmali`);
    }
  }

  for (const [status, code] of [
    [401, "AI_AUTHENTICATION_FAILED"],
    [403, "AI_AUTHENTICATION_FAILED"],
    [429, "AI_RATE_LIMITED"],
    [500, "AI_PROVIDER_UNAVAILABLE"],
    [502, "AI_PROVIDER_UNAVAILABLE"],
    [503, "AI_PROVIDER_UNAVAILABLE"],
    [504, "AI_PROVIDER_UNAVAILABLE"],
  ] as const) {
    try {
      await new GeminiAiProvider(
        { apiKey: "test-key", model: "env-model", maxRetries: 0, temperature: 0.1, apiVersion: null },
        { generateStructuredContent: async () => { throw { status, message: `raw ${status}` }; } },
      ).generateAnalysis(request, { timeoutMs: 5_000 });
      throw new Error(`${status} hata uretmedi`);
    } catch (error) {
      assert(error instanceof AiProviderError, `${status} AiProviderError olmali`);
      assert(error.code === code, `${status} ${code} olmali`);
    }
  }

  try {
    await new GeminiAiProvider(
      { apiKey: "test-key", model: "env-model", maxRetries: 0, temperature: 0.1, apiVersion: null },
      { generateStructuredContent: async () => { throw { status: 429, message: "quota exceeded" }; } },
    ).generateAnalysis(request, { timeoutMs: 5_000 });
    throw new Error("quota hata uretmedi");
  } catch (error) {
    assert(error instanceof AiProviderError, "quota AiProviderError olmali");
    assert(error.code === "AI_QUOTA_EXHAUSTED", "quota reliable detail ile ayrilmali");
  }

  let retryCalls = 0;
  const retrySleeps: number[] = [];
  const retryingGemini = new GeminiAiProvider(
    { apiKey: "test-key", model: "env-model", maxRetries: 1, temperature: 0.1, apiVersion: null },
    {
      generateStructuredContent: async () => {
        retryCalls += 1;
        if (retryCalls === 1) throw { status: 429, response: { headers: { "retry-after": "0" } } };
        return { text: validGeminiText, responseId: null, usageMetadata: {} };
      },
    },
    async (milliseconds) => { retrySleeps.push(milliseconds); },
  );
  await retryingGemini.generateAnalysis(request, { timeoutMs: 5_000 });
  assert(retryCalls === 2, "Retryable Gemini hata en fazla bir kez retry edilmeli");
  assert(retrySleeps.length === 1, "Retry backoff sleeper kullanmali");

  let nonRetryCalls = 0;
  try {
    await new GeminiAiProvider(
      { apiKey: "test-key", model: "env-model", maxRetries: 1, temperature: 0.1, apiVersion: null },
      { generateStructuredContent: async () => { nonRetryCalls += 1; throw { status: 401 }; } },
      async () => {},
    ).generateAnalysis(request, { timeoutMs: 5_000 });
    throw new Error("non-retry auth hata uretmedi");
  } catch (error) {
    assert(error instanceof AiProviderError, "non-retry AiProviderError olmali");
    assert(error.code === "AI_AUTHENTICATION_FAILED", "401 auth olmali");
    assert(nonRetryCalls === 1, "Non-retryable hata tekrar denenmemeli");
  }

  const companyExists = async (companyId: number) => companyId === 1 || companyId === 2;
  const unitCompanyId = async (unitId: number) => ({ 10: 1, 20: 1, 30: 2 } as Record<number, number | undefined>)[unitId] ?? null;
  const baseUser = { userId: 1, username: "u", name: "User", role: "user", companyId: 1, unitId: 10, active: true };
  await resolveAiScope({ user: baseUser, requestedUnitId: 10, year: 2026, companyExists, unitCompanyId });
  for (const scenario of [
    { user: baseUser, requestedUnitId: 20, requestedCompanyId: undefined, message: "standard other unit" },
    { user: baseUser, requestedUnitId: 10, requestedCompanyId: 2, message: "standard other company" },
    { user: { ...baseUser, role: "admin" }, requestedCompanyId: 2, requestedUnitId: undefined, message: "admin other company" },
    { user: { ...baseUser, role: "kontrol_admin" }, requestedCompanyId: 2, requestedUnitId: undefined, message: "kontrol admin other company" },
    { user: { ...baseUser, role: "superadmin" }, requestedCompanyId: undefined, requestedUnitId: undefined, message: "superadmin no company" },
    { user: { ...baseUser, role: "superadmin" }, requestedCompanyId: 1, requestedUnitId: 30, message: "superadmin unit mismatch" },
  ]) {
    try {
      await resolveAiScope({ ...scenario, year: 2026, companyExists, unitCompanyId });
      throw new Error(`${scenario.message} reddedilmedi`);
    } catch (error) {
      assert(error instanceof Error, `${scenario.message} hata uretmeli`);
    }
  }
}

function assertDisposableDatabase(): void {
  assert(process.env.NODE_ENV === "test", "AI test NODE_ENV=test gerektirir.");
  assert(process.env.TEST_DB_DISPOSABLE === "true", "AI test disposable DB gerektirir.");
  const rawUrl = process.env.DATABASE_URL;
  assert(rawUrl, "DATABASE_URL yok.");
  const url = new URL(rawUrl);
  assert(url.hostname === "127.0.0.1", "Test yalniz localhost disposable DB kullanir.");
  assert(url.pathname === "/iso50001_test", "Test DB adi gecersiz.");
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

function delay(ms: number): Promise<void> {
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
    if (child.exitCode !== null) throw new Error(`API erken kapandi: ${output.slice(-500)}`);
    try {
      if ((await fetch(`${baseUrl}/api/healthz`, { signal: AbortSignal.timeout(500) })).status === 200) {
        return {
          baseUrl,
          logs: () => output,
          close: async () => {
            if (child.exitCode !== null || child.signalCode !== null) return;
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
  const body = await response.json() as LoginBody;
  assert(typeof body.token === "string", `${username} token alamadi.`);
  return body.token;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function json(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function expectStatus(response: Response, expected: number, message: string) {
  const text = await response.clone().text();
  assert(response.status === expected, `${message} beklenen ${expected}, alinan ${response.status}: ${text.slice(0, 1_000)}`);
}

async function endpointTests() {
  assertDisposableDatabase();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const server = await startServer();
  let assertions = 0;
  try {
    const adminToken = await login(server.baseUrl, process.env.E2E_ADMIN_USERNAME!);
    const standardToken = await login(server.baseUrl, process.env.E2E_STANDARD_USERNAME!);
    const superadminToken = await login(server.baseUrl, process.env.E2E_SUPERADMIN_USERNAME!);
    const users = await pool.query<{ username: string; company_id: number; unit_id: number | null }>(
      `SELECT username, company_id, unit_id FROM users WHERE username = ANY($1::text[])`,
      [[process.env.E2E_ADMIN_USERNAME, process.env.E2E_STANDARD_USERNAME].filter(Boolean)],
    );
    const admin = users.rows.find((row) => row.username === process.env.E2E_ADMIN_USERNAME);
    const standard = users.rows.find((row) => row.username === process.env.E2E_STANDARD_USERNAME);
    assert(admin && standard?.unit_id, "Fixture kullanicilari eksik.");
    const otherUnit = await pool.query<{ id: number }>(
      "SELECT id FROM units WHERE company_id=$1 AND id<>$2 LIMIT 1",
      [admin.company_id, standard.unit_id],
    );
    assert(otherUnit.rows[0], "Standard kullanici negatif unit testi icin ikinci unit eksik.");

    const suggestions = await fetch(`${server.baseUrl}/api/ai/suggestions`, {
      method: "POST",
      headers: { ...auth(adminToken), "Content-Type": "application/json" },
      body: JSON.stringify({ focus: "genel", year: 2026, companyId: admin.company_id }),
    });
    await expectStatus(suggestions, 200, "AI suggestions regresyon");
    const suggestionsBody = await json(suggestions) as { suggestions?: unknown[]; technicalProfileReadiness?: unknown; equipmentInventoryReadiness?: unknown };
    assert(Array.isArray(suggestionsBody.suggestions), "AI suggestions array donmeli");
    assert(suggestionsBody.technicalProfileReadiness, "Teknik profil readiness korunmali");
    assert(suggestionsBody.equipmentInventoryReadiness, "Ekipman readiness korunmali");
    assertions += 3;

    const preview = await fetch(`${server.baseUrl}/api/ai/analyses/preview`, {
      method: "POST",
      headers: { ...auth(adminToken), "Content-Type": "application/json" },
      body: JSON.stringify({ analysisType: "energy_performance_overview", year: 2026, companyId: admin.company_id }),
    });
    await expectStatus(preview, 200, "AI preview");
    const previewBody = await json(preview) as {
      mode?: string;
      analysis?: unknown;
      meta?: {
        provider?: string;
        model?: string;
        cacheHit?: boolean;
        fallbackUsed?: boolean;
        dataVersion?: string;
        contextSchemaVersion?: string;
        dataSufficiency?: string;
        contextWarnings?: unknown[];
        contextTruncated?: boolean;
      };
    };
    assert(previewBody.mode === "mock", "Preview mode mock olmali");
    assert(previewBody.meta?.provider === "mock", "Preview meta provider mock olmali");
    assert(previewBody.meta?.model === "mock-v1", "Preview mock model donmeli");
    assert(previewBody.meta?.cacheHit === false && previewBody.meta?.fallbackUsed === false, "Preview cache/fallback false olmali");
    assert(typeof previewBody.meta?.dataVersion === "string" && previewBody.meta.dataVersion.startsWith("sha256:"), "Preview dataVersion meta tasimali");
    assert(previewBody.meta?.contextSchemaVersion === "1", "Preview context schema version tasimali");
    assert(["sufficient", "partial", "insufficient"].includes(String(previewBody.meta?.dataSufficiency)), "Preview data sufficiency meta tasimali");
    assert(Array.isArray(previewBody.meta?.contextWarnings), "Preview context warnings meta tasimali");
    assert(typeof previewBody.meta?.contextTruncated === "boolean", "Preview truncation meta tasimali");
    assert(aiAnalysisResultSchema.safeParse(previewBody.analysis).success, "Preview analysis Zod semasindan gecmeli");
    assertions += 10;

    const forbiddenStandard = await fetch(`${server.baseUrl}/api/ai/analyses/preview`, {
      method: "POST",
      headers: { ...auth(standardToken), "Content-Type": "application/json" },
      body: JSON.stringify({ analysisType: "energy_performance_overview", year: 2026, unitId: otherUnit.rows[0].id }),
    });
    await expectStatus(forbiddenStandard, 403, "Standard kullanici baska unit preview alamamali");
    assertions += 1;

    const superNoCompany = await fetch(`${server.baseUrl}/api/ai/analyses/preview`, {
      method: "POST",
      headers: { ...auth(superadminToken), "Content-Type": "application/json" },
      body: JSON.stringify({ analysisType: "energy_performance_overview", year: 2026 }),
    });
    await expectStatus(superNoCompany, 400, "Superadmin company olmadan preview alamamali");
    assertions += 1;

    const serializedPreview = JSON.stringify(previewBody).toLowerCase();
    for (const forbidden of ["gemini_api_key", "api_key", "secret", "\"items\""]) {
      assert(!serializedPreview.includes(forbidden), `Preview hassas/ham context sizdirdi: ${forbidden}`);
      assertions += 1;
    }
    const logs = server.logs().toLowerCase();
    assert(!logs.includes("gemini_api_key") && !logs.includes("ai_migrated_full_context"), "AI secret veya tam context loglanmamali");
    assertions += 1;

    console.log(`AI provider and scope tests passed (${assertions} endpoint assertions).`);
  } finally {
    await pool.end();
    await server.close().catch((error) => {
      throw new Error(`API kapatilamadi: ${error instanceof Error ? error.message : String(error)}\n${server.logs().slice(-1_000)}`);
    });
  }
}

await pureProviderAndScopeTests();
await endpointTests();
