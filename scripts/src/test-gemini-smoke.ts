import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { aiAnalysisResultSchema } from "@workspace/api-zod";

type GeminiProviderConstructor = new (
  config: {
    apiKey: string | null;
    model: string | null;
    maxRetries: number;
    temperature: number;
    apiVersion: string | null;
  },
) => {
  generateAnalysis: (request: unknown, options: { timeoutMs: number; maxOutputTokens?: number }) => Promise<{
    analysis: unknown;
    meta: {
      provider: string;
      model: string;
      usage: {
        inputTokens: number | null;
        outputTokens: number | null;
        thinkingTokens: number | null;
        cachedTokens: number | null;
        totalTokens: number | null;
      };
    };
  }>;
};
type GeminiClientAdapterConstructor = new (
  config: {
    apiKey: string | null;
    model: string | null;
    maxRetries: number;
    temperature: number;
    apiVersion: string | null;
  },
) => {
  generateTextContent: (request: { model: string; contents: string; temperature: number; signal?: AbortSignal }) => Promise<{
    text: string | null;
    responseId: string | null;
    usageMetadata: unknown;
  }>;
  generateStructuredContent: (request: {
    model: string;
    systemInstruction: string;
    contents: string;
    responseJsonSchema: unknown;
    maxOutputTokens: number;
    temperature: number;
    signal?: AbortSignal;
  }) => Promise<{
    text: string | null;
    responseId: string | null;
    usageMetadata: unknown;
  }>;
};
type AiProviderErrorLike = Error & {
  code: string;
  status: number;
  providerStatus?: number;
  providerErrorCode?: string;
  sanitizedMessage?: string;
  fieldPath?: string;
  providerRequestId?: string;
};
type GeminiErrorsModule = {
  classifyGeminiError: (error: unknown) => AiProviderErrorLike;
  geminiDiagnosticSummary: (input: {
    provider: "gemini";
    model: string | null;
    error: AiProviderErrorLike;
  }) => Record<string, unknown>;
};

async function importApiModule<T>(relativePath: string): Promise<T> {
  return await import(pathToFileURL(resolve(import.meta.dirname, "../../artifacts/api-server/src", relativePath)).href) as T;
}

function loadRootEnvFile() {
  const envPath = resolve(import.meta.dirname, "../../.env");
  if (!existsSync(envPath)) return;
  process.loadEnvFile(envPath);
}

function syntheticRequest() {
  return {
    analysisType: "data_quality_and_monitoring",
    scope: { companyId: 1, unitId: 1, year: 2026 },
    context: {
      technicalProfile: {
        status: "resolved",
        effectiveDate: "2026-12-31",
        source: {
          type: "unit_technical_profile_snapshot",
          snapshotId: 1,
          snapshotNumber: 1,
          profileVersion: 1,
          validFrom: "2026-01-01",
          validTo: null,
          publishedAt: "2026-01-15",
          daysSincePublished: 10,
        },
        unit: { id: 1, name: "Synthetic Demo Unit" },
        facility: { mainActivity: "synthetic_demo", totalEnclosedAreaM2: 1000 },
        operation: { dailyOperatingHours: 8, weeklyOperatingDays: 5 },
        systems: { buildingAutomationStatus: { code: "unknown", label: "Bilinmiyor" } },
        observations: [],
        customFacts: [],
        completeness: { percentage: 75, missingGroups: ["systems"] },
        warnings: [],
      },
      equipmentInventory: {
        source: {
          contextType: "equipment_inventory",
          companyId: 1,
          unitId: 1,
          effectiveDate: "2026-12-31",
          generatedAt: "2026-12-31T00:00:00.000Z",
          sourcePolicy: "current_inventory",
          aggregateSourceCount: 1,
          itemLimit: 1,
          totalCount: 1,
          includedCount: 1,
          truncated: false,
          selectionPolicy: "critical_energy_intensive_power_updated_code",
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
          withPrimaryMeter: 0,
          withAnyMeter: 0,
          withPrimaryEnergySource: 1,
          withAnyEnergySource: 1,
          withEnergyUseGroup: 0,
          withRatedPower: 1,
          withLifecycleData: 0,
          withCustomValues: 0,
        },
        aggregates: {
          installedPowerKw: 15,
          ratedPowerKw: 15,
          categoryCounts: { synthetic_motor: 1 },
          statusCounts: { active: 1 },
          measurementMethodCounts: { estimate: 1 },
          confidenceCounts: { low: 1 },
        },
        readiness: {
          status: "partial",
          ready: false,
          activeEquipment: 1,
          coverage: {
            withAnyMeter: 0,
            withAnyEnergySource: 1,
            withTechnicalCapacity: 1,
            criticalOrEnergyIntensive: 1,
          },
          warnings: ["no_primary_meter"],
          note: "Synthetic demo readiness.",
        },
        warnings: ["no_primary_meter"],
        items: [
          {
            id: 1,
            equipmentCode: "SYN-MTR-001",
            name: "Synthetic Motor",
            unitId: 1,
            unitName: "Synthetic Demo Unit",
            subUnitName: null,
            category: "synthetic_motor",
            subType: null,
            status: "active",
            location: null,
            building: null,
            process: null,
            energyUseGroupName: null,
            installedPowerKw: 15,
            ratedPower: { value: 15, unit: "kW" },
            measurementMethod: "estimate",
            measurementConfidence: "low",
            isCritical: true,
            isEnergyIntensive: true,
            plannedReplacementYear: null,
            savingPotential: null,
            meters: [],
            energySources: [{ id: 1, name: "Synthetic Electricity", isPrimary: true, relationRole: "primary", sharePercent: null }],
            customFacts: [],
            updatedAt: null,
          },
        ],
      },
      consumption: { totalKwh: 10000, recordCount: 12 },
      seu: { itemCount: 1, categories: ["synthetic_motor"] },
    },
  };
}

loadRootEnvFile();

function numericEnv(name: string, fallback: number) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function smokeConfig() {
  const rawModel = process.env.GEMINI_MODEL;
  const model = rawModel?.trim() ?? "";
  return {
    apiKey: process.env.GEMINI_API_KEY ? "present" : "missing",
    apiKeyValue: process.env.GEMINI_API_KEY || null,
    model,
    modelHasWhitespace: rawModel !== undefined && rawModel !== model,
    maxRetries: 0,
    temperature: numericEnv("GEMINI_TEMPERATURE", 0.2),
    apiVersion: process.env.GEMINI_API_VERSION?.trim() || null,
    timeoutMs: numericEnv("AI_TIMEOUT_MS", 30000),
    maxOutputTokens: numericEnv("AI_MAX_OUTPUT_TOKENS", 4096),
  };
}

async function runWithTimeout<T>(timeoutMs: number, work: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

async function runDiagnostic(config: ReturnType<typeof smokeConfig>) {
  const [{ GoogleGenAiClientAdapter }, { buildGeminiSystemInstruction, buildGeminiUserContent }, { geminiAnalysisResponseSchema, geminiMinimalSmokeResponseSchema }] = await Promise.all([
    importApiModule<{ GoogleGenAiClientAdapter: GeminiClientAdapterConstructor }>("lib/ai/gemini-client.ts"),
    importApiModule<{
      buildGeminiSystemInstruction: () => string;
      buildGeminiUserContent: (request: unknown) => string;
    }>("lib/ai/gemini-prompt.ts"),
    importApiModule<{
      geminiAnalysisResponseSchema: () => unknown;
      geminiMinimalSmokeResponseSchema: () => unknown;
    }>("lib/ai/gemini-schema.ts"),
  ]);
  const client = new GoogleGenAiClientAdapter({
    apiKey: config.apiKeyValue,
    model: config.model,
    maxRetries: config.maxRetries,
    temperature: config.temperature,
    apiVersion: config.apiVersion,
  });

  await runDiagnosticStep("A_text", config, async (signal) => {
    const response = await client.generateTextContent({
      model: config.model,
      contents: "Return the word ok.",
      temperature: config.temperature,
      signal,
    });
    return { providerRequestId: response.responseId, hasText: Boolean(response.text), usage: response.usageMetadata };
  });

  await runDiagnosticStep("B_minimal_structured", config, async (signal) => {
    const response = await client.generateStructuredContent({
      model: config.model,
      systemInstruction: "Return only JSON matching the schema.",
      contents: "Return {\"ok\":true,\"summary\":\"synthetic smoke ok\"}.",
      responseJsonSchema: geminiMinimalSmokeResponseSchema(),
      maxOutputTokens: 256,
      temperature: config.temperature,
      signal,
    });
    return { providerRequestId: response.responseId, hasText: Boolean(response.text), usage: response.usageMetadata };
  });

  if (process.env.GEMINI_SMOKE_SCHEMA_PROBE === "true") {
    const enysSchema = geminiAnalysisResponseSchema();
    await runProbeStep("probe_no_additional_properties", config, client, stripSchemaKey(enysSchema, "additionalProperties"));
    await runProbeStep("probe_no_numeric_constraints", config, client, stripNumericConstraints(enysSchema));
    await runProbeStep("probe_no_additional_properties_no_numeric_constraints", config, client, stripNumericConstraints(stripSchemaKey(enysSchema, "additionalProperties")));
    await runProbeStep("probe_integer_as_number", config, client, integerAsNumber(stripNumericConstraints(stripSchemaKey(enysSchema, "additionalProperties"))));
  }

  await runDiagnosticStep("C_enys_schema", config, async (signal) => {
    const response = await client.generateStructuredContent({
      model: config.model,
      systemInstruction: buildGeminiSystemInstruction(),
      contents: buildGeminiUserContent(syntheticRequest()),
      responseJsonSchema: geminiAnalysisResponseSchema(),
      maxOutputTokens: config.maxOutputTokens,
      temperature: config.temperature,
      signal,
    });
    return { providerRequestId: response.responseId, hasText: Boolean(response.text), usage: response.usageMetadata };
  });
}

async function runProbeStep(
  step: string,
  config: ReturnType<typeof smokeConfig>,
  client: InstanceType<GeminiClientAdapterConstructor>,
  schema: unknown,
) {
  try {
    const result = await runWithTimeout(config.timeoutMs, (signal) => client.generateStructuredContent({
      model: config.model,
      systemInstruction: "Return only JSON matching the schema. Use synthetic placeholder text. Do not include markdown.",
      contents: "Generate one synthetic EnYS analysis JSON object for data quality monitoring.",
      responseJsonSchema: schema,
      maxOutputTokens: config.maxOutputTokens,
      temperature: config.temperature,
      signal,
    }));
    console.log(JSON.stringify({
      step,
      provider: "gemini",
      model: config.model,
      ok: true,
      providerRequestId: result.responseId,
      hasText: Boolean(result.text),
      usage: result.usageMetadata,
    }));
  } catch (error) {
    await printSafeError(step, config.model, error);
  }
}

function stripSchemaKey(value: unknown, key: string): unknown {
  if (Array.isArray(value)) return value.map((item) => stripSchemaKey(item, key));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey === key) continue;
    output[entryKey] = stripSchemaKey(entryValue, key);
  }
  return output;
}

function stripNumericConstraints(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNumericConstraints);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey === "minimum" || entryKey === "maximum" || entryKey === "minItems" || entryKey === "maxItems") continue;
    output[entryKey] = stripNumericConstraints(entryValue);
  }
  return output;
}

function integerAsNumber(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(integerAsNumber);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    output[entryKey] = entryKey === "type" && entryValue === "integer" ? "number" : integerAsNumber(entryValue);
  }
  return output;
}

async function runDiagnosticStep(
  step: string,
  config: ReturnType<typeof smokeConfig>,
  work: (signal: AbortSignal) => Promise<Record<string, unknown>>,
) {
  try {
    const result = await runWithTimeout(config.timeoutMs, work);
    console.log(JSON.stringify({
      step,
      provider: "gemini",
      model: config.model,
      ok: true,
      providerRequestId: result.providerRequestId ?? null,
      hasText: result.hasText ?? null,
      usage: result.usage ?? null,
    }));
  } catch (error) {
    await printSafeError(step, config.model, error);
    throw error;
  }
}

async function printSafeError(step: string, model: string | null, error: unknown) {
  const { classifyGeminiError, geminiDiagnosticSummary } = await importApiModule<GeminiErrorsModule>("lib/ai/gemini-errors.ts");
  const classified = classifyGeminiError(error);
  console.error(JSON.stringify({
    step,
    ...geminiDiagnosticSummary({ provider: "gemini", model, error: classified }),
  }));
}

async function runMainSmoke(config: ReturnType<typeof smokeConfig>) {
  const { GeminiAiProvider } = await importApiModule<{ GeminiAiProvider: GeminiProviderConstructor }>("lib/ai/gemini-provider.ts");
  const provider = new GeminiAiProvider({
    apiKey: config.apiKeyValue,
    model: config.model,
    maxRetries: config.maxRetries,
    temperature: config.temperature,
    apiVersion: config.apiVersion,
  });
  const result = await provider.generateAnalysis(syntheticRequest(), {
    timeoutMs: config.timeoutMs,
    maxOutputTokens: config.maxOutputTokens,
  });
  if (!aiAnalysisResultSchema.safeParse(result.analysis).success) {
    throw new Error("Gemini smoke structured output validation failed.");
  }
  console.log(JSON.stringify({
    provider: result.meta.provider,
    model: result.meta.model,
    usage: result.meta.usage,
    findings: (result.analysis as { findings?: unknown[] }).findings?.length ?? 0,
  }));
}

async function main() {
  if (process.env.RUN_GEMINI_SMOKE !== "true") {
    console.log("Gemini smoke skipped: RUN_GEMINI_SMOKE=true degil.");
    return;
  }
  const config = smokeConfig();
  if (config.apiKey !== "present" || !config.model) {
    console.log("Gemini smoke skipped: GEMINI_API_KEY veya GEMINI_MODEL yok.");
    return;
  }
  if (config.modelHasWhitespace) {
    console.error(JSON.stringify({
      provider: "gemini",
      model: config.model,
      classifiedCode: "AI_NOT_CONFIGURED",
      httpStatus: null,
      providerErrorCode: null,
      sanitizedMessage: "GEMINI_MODEL basinda veya sonunda whitespace iceremez.",
      fieldPath: "GEMINI_MODEL",
      providerRequestId: null,
    }));
    process.exitCode = 1;
    return;
  }
  try {
    if (process.env.GEMINI_SMOKE_DIAGNOSTIC === "true") {
      await runDiagnostic(config);
      return;
    }
    await runMainSmoke(config);
  } catch (error) {
    if (process.env.GEMINI_SMOKE_DIAGNOSTIC !== "true") {
      await printSafeError("C_enys_schema", config.model, error);
    }
    process.exitCode = 1;
  }
}

await main();
