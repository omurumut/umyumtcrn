import { pool } from "@workspace/db";
import type { SessionUser } from "../../middlewares/auth.js";
import { readAiRuntimeConfig } from "./config.js";

export class AiOperationsError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AiOperationsError";
  }
}

type OperationsScope = {
  role: SessionUser["role"];
  companyId: number | null;
  isSystemWide: boolean;
  canViewSystem: boolean;
};

type DateRange = {
  from: Date;
  toExclusive: Date;
  days: number;
};

type OperationsFilters = {
  provider?: string;
  model?: string;
  status?: string;
  errorCode?: string;
};

type OperationsQuery = OperationsFilters & {
  from?: unknown;
  to?: unknown;
  companyId?: unknown;
  page?: unknown;
  pageSize?: unknown;
};

const MAX_RANGE_DAYS = 366;
const STALE_MINUTES = 30;

export function parseOperationsDateRange(input: Pick<OperationsQuery, "from" | "to">): DateRange {
  const now = new Date();
  const defaultTo = startOfUtcDay(addUtcDays(now, 1));
  const defaultFrom = addUtcDays(defaultTo, -30);
  const from = input.from === undefined ? defaultFrom : parseDateOnly(input.from, "from");
  const toExclusive = input.to === undefined ? defaultTo : addUtcDays(parseDateOnly(input.to, "to"), 1);
  if (from >= toExclusive) throw new AiOperationsError(400, "Gecersiz tarih araligi");
  const days = Math.ceil((toExclusive.getTime() - from.getTime()) / 86_400_000);
  if (days > MAX_RANGE_DAYS) throw new AiOperationsError(400, "Tarih araligi en fazla 12 ay olabilir");
  return { from, toExclusive, days };
}

export function resolveOperationsScope(user: SessionUser | null | undefined, companyIdInput: unknown): OperationsScope {
  if (!user) throw new AiOperationsError(401, "Giris yapmalisiniz");
  if (user.role === "user") throw new AiOperationsError(403, "Bu islem icin yetkiniz yok");
  if (user.role === "superadmin") {
    const companyId = parseOptionalPositiveInteger(companyIdInput, "companyId");
    return { role: user.role, companyId: companyId ?? null, isSystemWide: companyId === undefined, canViewSystem: true };
  }
  return { role: user.role, companyId: user.companyId, isSystemWide: false, canViewSystem: false };
}

export function parseOperationsFilters(query: OperationsQuery): OperationsFilters {
  return {
    provider: parseOptionalToken(query.provider, "provider"),
    model: parseOptionalToken(query.model, "model"),
    status: parseOptionalEnum(query.status, "status", ["pending", "processing", "completed", "failed"]),
    errorCode: parseOptionalToken(query.errorCode, "errorCode"),
  };
}

export function parsePagination(query: Pick<OperationsQuery, "page" | "pageSize">) {
  const page = parseOptionalPositiveInteger(query.page, "page") ?? 1;
  const pageSize = parseOptionalPositiveInteger(query.pageSize, "pageSize") ?? 20;
  if (pageSize > 100) throw new AiOperationsError(400, "pageSize en fazla 100 olabilir");
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export async function getAiOperationsSummary(input: { user: SessionUser; query: OperationsQuery }) {
  const range = parseOperationsDateRange(input.query);
  const scope = resolveOperationsScope(input.user, input.query.companyId);
  const filters = parseOperationsFilters(input.query);
  const config = readAiRuntimeConfig();
  const where = buildAnalysisWhere(scope, range, filters);
  const attemptWhere = buildAttemptWhere(scope, range, filters);
  const [analysisTotals, attemptTotals, errorRows, circuitRows, cleanupRows, policyRows] = await Promise.all([
    pool.query<AnalysisTotalsRow>(`
      SELECT
        count(*)::int AS total_requests,
        count(*) FILTER (WHERE status='completed')::int AS completed_count,
        count(*) FILTER (WHERE status='failed')::int AS failed_count,
        count(*) FILTER (WHERE status='processing')::int AS active_processing,
        count(*) FILTER (WHERE status='processing' AND started_at < now() - ($${where.params.length + 1}::int * interval '1 minute'))::int AS stale_processing,
        count(*) FILTER (WHERE cache_hit=true)::int AS cache_hit_count,
        count(*) FILTER (WHERE cache_hit=false)::int AS cache_miss_count,
        count(*) FILTER (WHERE fallback_used=true)::int AS fallback_count,
        count(*) FILTER (WHERE provider='gemini')::int AS gemini_count,
        count(*) FILTER (WHERE provider='mock')::int AS mock_count,
        count(*) FILTER (WHERE provider='rule_based')::int AS rule_based_count,
        max(created_at) FILTER (WHERE status='completed') AS last_completed_at,
        (array_remove(array_agg(error_code ORDER BY updated_at DESC), NULL))[1] AS last_error_code,
        avg(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) FILTER (WHERE completed_at IS NOT NULL AND started_at IS NOT NULL) AS avg_latency_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)
          FILTER (WHERE completed_at IS NOT NULL AND started_at IS NOT NULL) AS p95_latency_ms,
        avg(jsonb_array_length(COALESCE(result_json->'findings', '[]'::jsonb))) FILTER (WHERE result_json IS NOT NULL) AS avg_finding_count
      FROM ai_analyses a
      ${where.sql}`, [...where.params, STALE_MINUTES]),
    pool.query<AttemptTotalsRow>(`
      SELECT
        count(*) FILTER (WHERE at.provider <> 'rule_based')::int AS provider_call_count,
        count(*) FILTER (WHERE at.estimated_cost IS NULL)::int AS cost_unknown_count,
        sum(at.input_tokens)::bigint AS input_tokens,
        sum(at.output_tokens)::bigint AS output_tokens,
        sum(at.thinking_tokens)::bigint AS thinking_tokens,
        sum(at.cached_tokens)::bigint AS cached_tokens,
        sum(at.total_tokens)::bigint AS total_tokens,
        sum(at.estimated_cost)::text AS estimated_cost,
        count(DISTINCT at.currency) FILTER (WHERE at.currency IS NOT NULL)::int AS currency_count,
        (array_remove(array_agg(DISTINCT at.currency), NULL))[1] AS currency,
        (array_remove(array_agg(DISTINCT at.pricing_catalog_version), NULL))[1] AS pricing_catalog_version
      FROM ai_analysis_attempts at
      JOIN ai_analyses a ON a.id=at.analysis_id
      ${attemptWhere.sql}`, attemptWhere.params),
    pool.query<{ error_code: string | null; count: number }>(`
      SELECT COALESCE(a.error_code, at.error_code) AS error_code, count(*)::int AS count
      FROM ai_analyses a
      LEFT JOIN ai_analysis_attempts at ON at.analysis_id=a.id AND at.success=false
      ${where.sql}
      GROUP BY COALESCE(a.error_code, at.error_code)
      ORDER BY count(*) DESC, error_code ASC
      LIMIT 10`, where.params),
    pool.query<CircuitRow>(`
      SELECT provider, model, state, failure_count, last_failure_code, last_failure_at,
             last_success_at, opened_at, next_probe_at, (probe_lease_expires_at > now()) AS lease_active
      FROM ai_provider_circuit_state
      ORDER BY provider, model`),
    pool.query<{ value_json: Record<string, unknown>; updated_at: Date }>(
      "SELECT value_json, updated_at FROM ai_operational_state WHERE state_key='ai_retention_cleanup:last_run' LIMIT 1",
    ).catch(() => ({ rows: [] })),
    scope.companyId !== null
      ? pool.query<PolicyRow>("SELECT data_policy, retention_days, daily_analysis_limit, monthly_analysis_limit, max_concurrent_analyses, fallback_enabled, settings_version, updated_at FROM company_ai_settings WHERE company_id=$1", [scope.companyId])
      : Promise.resolve({ rows: [] as PolicyRow[] }),
  ]);
  const totals = analysisTotals.rows[0] ?? emptyAnalysisTotals();
  const attempts = attemptTotals.rows[0] ?? emptyAttemptTotals();
  const cacheRate = rate(totals.cache_hit_count, totals.total_requests);
  const fallbackRate = rate(totals.fallback_count, totals.total_requests);
  const failureRate = rate(totals.failed_count, totals.total_requests);
  const circuit = mapCircuit(circuitRows.rows, scope);
  return {
    range: serializeRange(range),
    scope,
    global: {
      enabled: config.enabled,
      provider: config.provider,
      providerConfigured: config.providerConfigured === config.provider,
      modelConfigured: config.provider === "gemini" ? Boolean(config.gemini.model) : true,
      secretConfigured: config.provider === "gemini" ? Boolean(config.gemini.apiKey) : false,
      productionDataEnabled: config.productionDataEnabled,
      limits: {
        globalMaxConcurrent: config.globalMaxConcurrent,
        globalDailyLimit: config.globalDailyLimit,
        circuitBreakerEnabled: config.circuitBreakerEnabled,
      },
    },
    policy: policyRows.rows[0] ? mapPolicy(policyRows.rows[0]) : null,
    totals: {
      totalRequests: totals.total_requests,
      providerCalls: attempts.provider_call_count,
      completed: totals.completed_count,
      failed: totals.failed_count,
      cacheHit: totals.cache_hit_count,
      cacheMiss: totals.cache_miss_count,
      fallback: totals.fallback_count,
      gemini: totals.gemini_count,
      mock: totals.mock_count,
      ruleBased: totals.rule_based_count,
      activeProcessing: totals.active_processing,
      staleProcessing: totals.stale_processing,
      cacheHitRate: cacheRate,
      fallbackRate,
      failureRate,
      avgLatencyMs: nullableNumber(totals.avg_latency_ms),
      p95LatencyMs: nullableNumber(totals.p95_latency_ms),
      avgFindingCount: nullableNumber(totals.avg_finding_count),
      lastCompletedAt: toIso(totals.last_completed_at),
      lastErrorCode: totals.last_error_code,
    },
    tokens: {
      input: nullableInteger(attempts.input_tokens),
      output: nullableInteger(attempts.output_tokens),
      thinking: nullableInteger(attempts.thinking_tokens),
      cached: nullableInteger(attempts.cached_tokens),
      total: nullableInteger(attempts.total_tokens),
    },
    cost: {
      estimatedCost: attempts.currency_count > 1 ? null : attempts.estimated_cost,
      currency: attempts.currency_count > 1 ? null : attempts.currency,
      mixedCurrency: attempts.currency_count > 1,
      unknownCount: attempts.cost_unknown_count,
      pricingCatalogVersion: attempts.pricing_catalog_version,
      label: "Tahmini API maliyeti",
    },
    errors: errorRows.rows
      .filter((row) => row.error_code)
      .map((row) => ({ code: row.error_code!, count: row.count, group: errorGroup(row.error_code!) })),
    circuit,
    retentionCleanup: cleanupRows.rows[0]
      ? { lastRunAt: toIso(cleanupRows.rows[0].updated_at), summary: sanitizeRetention(cleanupRows.rows[0].value_json) }
      : null,
    pilotHealth: pilotHealth({ totals, attempts, circuitRows: circuitRows.rows, config }),
  };
}

export async function getAiOperationsTimeseries(input: { user: SessionUser; query: OperationsQuery }) {
  const range = parseOperationsDateRange(input.query);
  const scope = resolveOperationsScope(input.user, input.query.companyId);
  const filters = parseOperationsFilters(input.query);
  const where = buildAnalysisWhere(scope, range, filters, "a", 3);
  const attemptWhere = buildAttemptWhere(scope, range, filters, "a", "at", 3);
  const analysis = await pool.query<TimeSeriesAnalysisRow>(`
    WITH days AS (
      SELECT generate_series($1::date, ($2::date - interval '1 day')::date, interval '1 day')::date AS day
    ),
    analysis_daily AS (
      SELECT date_trunc('day', a.created_at AT TIME ZONE 'UTC')::date AS day,
             count(*)::int AS total,
             count(*) FILTER (WHERE a.cache_hit=true)::int AS cache_hit,
             count(*) FILTER (WHERE a.status='completed')::int AS completed,
             count(*) FILTER (WHERE a.status='failed')::int AS failed,
             count(*) FILTER (WHERE a.fallback_used=true)::int AS fallback
      FROM ai_analyses a
      ${where.sql}
      GROUP BY 1
    ),
    cost_daily AS (
      SELECT date_trunc('day', at.created_at AT TIME ZONE 'UTC')::date AS day,
             sum(at.estimated_cost)::text AS estimated_cost,
             count(*) FILTER (WHERE at.estimated_cost IS NULL)::int AS cost_unknown
      FROM ai_analysis_attempts at
      JOIN ai_analyses a ON a.id=at.analysis_id
      ${attemptWhere.sql}
      GROUP BY 1
    )
    SELECT days.day::text, COALESCE(ad.total,0)::int AS total,
           COALESCE(ad.cache_hit,0)::int AS cache_hit,
           COALESCE(ad.completed,0)::int AS completed,
           COALESCE(ad.failed,0)::int AS failed,
           COALESCE(ad.fallback,0)::int AS fallback,
           cd.estimated_cost, COALESCE(cd.cost_unknown,0)::int AS cost_unknown
    FROM days
    LEFT JOIN analysis_daily ad ON ad.day=days.day
    LEFT JOIN cost_daily cd ON cd.day=days.day
    ORDER BY days.day`, [dateOnly(range.from), dateOnly(range.toExclusive), ...where.params]);
  return { range: serializeRange(range), points: analysis.rows };
}

export async function getAiOperationsErrors(input: { user: SessionUser; query: OperationsQuery }) {
  const range = parseOperationsDateRange(input.query);
  const scope = resolveOperationsScope(input.user, input.query.companyId);
  const filters = parseOperationsFilters(input.query);
  const where = buildAnalysisWhere(scope, range, filters);
  const rows = await pool.query<{ code: string | null; status: number | null; count: number; latest_at: Date | null }>(`
    SELECT COALESCE(a.error_code, at.error_code) AS code,
           max(at.provider_http_status) AS status,
           count(*)::int AS count,
           max(COALESCE(at.completed_at, a.completed_at, a.updated_at)) AS latest_at
    FROM ai_analyses a
    LEFT JOIN ai_analysis_attempts at ON at.analysis_id=a.id AND at.success=false
    ${where.sql}
    GROUP BY COALESCE(a.error_code, at.error_code)
    HAVING COALESCE(a.error_code, at.error_code) IS NOT NULL
    ORDER BY count(*) DESC, latest_at DESC`, where.params);
  return {
    range: serializeRange(range),
    items: rows.rows.map((row) => ({
      code: row.code!,
      group: errorGroup(row.code!),
      label: errorLabel(row.code!),
      providerStatus: row.status,
      count: row.count,
      latestAt: toIso(row.latest_at),
    })),
  };
}

export async function listAiOperationsAnalyses(input: { user: SessionUser; query: OperationsQuery }) {
  const range = parseOperationsDateRange(input.query);
  const scope = resolveOperationsScope(input.user, input.query.companyId);
  const filters = parseOperationsFilters(input.query);
  const page = parsePagination(input.query);
  const where = buildAnalysisWhere(scope, range, filters);
  const rows = await pool.query<AnalysisListRow>(`
    SELECT a.id, a.company_id, c.name AS company_name, a.unit_id, u.name AS unit_name,
           a.analysis_type, a.status, a.provider, a.model, a.cache_hit, a.fallback_used,
           a.error_code, a.started_at, a.completed_at, a.created_at,
           CASE WHEN a.completed_at IS NOT NULL AND a.started_at IS NOT NULL
             THEN EXTRACT(EPOCH FROM (a.completed_at - a.started_at)) * 1000
             ELSE NULL END AS latency_ms,
           count(*) OVER()::int AS total_count
    FROM ai_analyses a
    LEFT JOIN companies c ON c.id=a.company_id
    LEFT JOIN units u ON u.id=a.unit_id AND u.company_id=a.company_id
    ${where.sql}
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT $${where.params.length + 1} OFFSET $${where.params.length + 2}`, [...where.params, page.pageSize, page.offset]);
  return {
    range: serializeRange(range),
    items: rows.rows.map(mapAnalysisListRow),
    pagination: { page: page.page, pageSize: page.pageSize, total: rows.rows[0]?.total_count ?? 0 },
  };
}

export async function getAiOperationsAnalysisDetail(input: { user: SessionUser; id: number; query: OperationsQuery }) {
  const scope = resolveOperationsScope(input.user, input.query.companyId);
  const params: unknown[] = [input.id];
  let companySql = "";
  if (scope.companyId !== null) {
    params.push(scope.companyId);
    companySql = ` AND a.company_id=$${params.length}`;
  }
  const analysis = await pool.query<AnalysisDetailRow>(`
    SELECT a.id, a.company_id, c.name AS company_name, a.unit_id, u.name AS unit_name,
           a.requested_by_user_id, a.analysis_type, a.period_start, a.period_end, a.status,
           a.provider, a.model, a.context_schema_version, a.output_schema_version,
           a.prompt_policy_version, a.builder_version, a.redaction_policy_version,
           a.limit_policy_version, a.data_version, a.cache_key, a.cache_hit,
           a.source_analysis_id, a.fallback_used, a.data_sufficiency, a.context_truncated,
           a.context_warnings_json, a.error_code, a.error_message_safe,
           a.started_at, a.completed_at, a.created_at, a.updated_at
    FROM ai_analyses a
    LEFT JOIN companies c ON c.id=a.company_id
    LEFT JOIN units u ON u.id=a.unit_id AND u.company_id=a.company_id
    WHERE a.id=$1${companySql}
    LIMIT 1`, params);
  if (!analysis.rows[0]) throw new AiOperationsError(404, "Analiz bulunamadi");
  const attempts = await pool.query<AttemptDetailRow>(`
    SELECT attempt_number, provider, model, started_at, completed_at, success, retryable,
           error_code, provider_http_status, input_tokens, output_tokens, thinking_tokens,
           cached_tokens, total_tokens, estimated_cost::text AS estimated_cost, currency,
           cost_calculation_version, pricing_catalog_version, data_policy,
           production_data_enabled, context_truncated, data_sufficiency,
           synthetic_context, provider_data_classification, latency_ms
    FROM ai_analysis_attempts
    WHERE analysis_id=$1
    ORDER BY attempt_number`, [input.id]);
  return { analysis: mapAnalysisDetailRow(analysis.rows[0], scope.canViewSystem), attempts: attempts.rows.map(mapAttemptDetailRow) };
}

export async function getAiOperationsCompanyUsage(input: { user: SessionUser; query: OperationsQuery }) {
  const range = parseOperationsDateRange(input.query);
  const scope = resolveOperationsScope(input.user, input.query.companyId);
  if (!scope.canViewSystem) throw new AiOperationsError(403, "Bu islem icin sistem yoneticisi yetkisi gereklidir");
  const rows = await pool.query<CompanyUsageRow>(`
    SELECT c.id AS company_id, c.name AS company_name,
           COALESCE(s.data_policy, 'disabled') AS data_policy,
           s.daily_analysis_limit, s.monthly_analysis_limit, s.max_concurrent_analyses, s.fallback_enabled,
           count(DISTINCT a.id)::int AS total_requests,
           count(DISTINCT a.id) FILTER (WHERE a.cache_hit=true)::int AS cache_hit,
           count(DISTINCT a.id) FILTER (WHERE a.fallback_used=true)::int AS fallback,
           count(DISTINCT a.id) FILTER (WHERE a.status='failed')::int AS failed,
           count(DISTINCT a.id) FILTER (WHERE a.status='processing')::int AS active_processing,
           count(at.id) FILTER (WHERE at.provider <> 'rule_based')::int AS provider_calls,
           sum(at.total_tokens)::bigint AS total_tokens,
           sum(at.estimated_cost)::text AS estimated_cost,
           count(at.id) FILTER (WHERE at.estimated_cost IS NULL)::int AS cost_unknown_count,
           (array_remove(array_agg(DISTINCT at.currency), NULL))[1] AS currency,
           count(DISTINCT at.currency) FILTER (WHERE at.currency IS NOT NULL)::int AS currency_count,
           max(a.created_at) AS last_analysis_at
    FROM companies c
    LEFT JOIN company_ai_settings s ON s.company_id=c.id
    LEFT JOIN ai_analyses a ON a.company_id=c.id AND a.created_at >= $1 AND a.created_at < $2
    LEFT JOIN ai_analysis_attempts at ON at.analysis_id=a.id
    GROUP BY c.id, c.name, s.data_policy, s.daily_analysis_limit, s.monthly_analysis_limit, s.max_concurrent_analyses, s.fallback_enabled
    ORDER BY total_requests DESC, c.name ASC`, [range.from, range.toExclusive]);
  return { range: serializeRange(range), items: rows.rows.map(mapCompanyUsageRow) };
}

function buildAnalysisWhere(scope: OperationsScope, range: DateRange, filters: OperationsFilters, alias = "a", startIndex = 1) {
  const params: unknown[] = [range.from, range.toExclusive];
  const clauses = [`${alias}.created_at >= $${startIndex}`, `${alias}.created_at < $${startIndex + 1}`];
  let index = startIndex + 2;
  if (scope.companyId !== null) {
    params.push(scope.companyId);
    clauses.push(`${alias}.company_id=$${index++}`);
  }
  if (filters.provider) {
    params.push(filters.provider);
    clauses.push(`${alias}.provider=$${index++}`);
  }
  if (filters.model) {
    params.push(filters.model);
    clauses.push(`${alias}.model=$${index++}`);
  }
  if (filters.status) {
    params.push(filters.status);
    clauses.push(`${alias}.status=$${index++}`);
  }
  if (filters.errorCode) {
    params.push(filters.errorCode);
    clauses.push(`${alias}.error_code=$${index++}`);
  }
  return { sql: `WHERE ${clauses.join(" AND ")}`, params };
}

function buildAttemptWhere(scope: OperationsScope, range: DateRange, filters: OperationsFilters, analysisAlias = "a", attemptAlias = "at", startIndex = 1) {
  const base = buildAnalysisWhere(scope, range, filters, analysisAlias, startIndex);
  return { sql: base.sql, params: base.params, attemptAlias };
}

function parseDateOnly(value: unknown, field: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AiOperationsError(400, `Gecersiz ${field}`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new AiOperationsError(400, `Gecersiz ${field}`);
  return date;
}

function parseOptionalPositiveInteger(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value.trim())) throw new AiOperationsError(400, `Gecersiz ${field}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new AiOperationsError(400, `Gecersiz ${field}`);
  return parsed;
}

function parseOptionalToken(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,80}$/.test(value.trim())) throw new AiOperationsError(400, `Gecersiz ${field}`);
  return value.trim();
}

function parseOptionalEnum(value: unknown, field: string, allowed: string[]) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !allowed.includes(value)) throw new AiOperationsError(400, `Gecersiz ${field}`);
  return value;
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addUtcDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function serializeRange(range: DateRange) {
  return { from: dateOnly(range.from), to: dateOnly(addUtcDays(range.toExclusive, -1)), timezone: "UTC", bucket: "day" };
}

function toIso(value: Date | string | null) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableInteger(value: string | number | null) {
  if (value === null || value === undefined) return null;
  return Number(value);
}

function nullableNumber(value: string | number | null) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rate(count: number, total: number) {
  return total > 0 ? count / total : 0;
}

function errorGroup(code: string) {
  if (code.includes("DAILY") || code.includes("MONTHLY") || code.includes("QUOTA")) return "quota";
  if (code.includes("CONCURRENCY")) return "concurrency";
  if (code.includes("CIRCUIT")) return "circuit";
  if (code.includes("DISABLED") || code.includes("NOT_CONFIGURED")) return "policy";
  if (code.includes("SCHEMA") || code.includes("VALIDATION")) return "validation";
  if (code.includes("RATE") || code.includes("TIMEOUT") || code.includes("PROVIDER")) return "provider";
  return "other";
}

function errorLabel(code: string) {
  const labels: Record<string, string> = {
    AI_RATE_LIMITED: "Provider rate limit",
    AI_PROVIDER_UNAVAILABLE: "Provider gecici kullanilamiyor",
    AI_TIMEOUT: "Provider zaman asimi",
    AI_DAILY_LIMIT_REACHED: "Gunluk kota doldu",
    AI_MONTHLY_LIMIT_REACHED: "Aylik kota doldu",
    AI_COMPANY_CONCURRENCY_LIMIT: "Firma concurrency limiti",
    AI_USER_CONCURRENCY_LIMIT: "Kullanici concurrency limiti",
    AI_CIRCUIT_OPEN: "Circuit breaker acik",
    AI_DISABLED: "AI politika nedeniyle kapali",
    AI_NOT_CONFIGURED: "Provider yapilandirilmamis",
    AI_SCHEMA_INVALID: "Yanit semasi gecersiz",
  };
  return labels[code] ?? code;
}

function mapCircuit(rows: CircuitRow[], scope: OperationsScope) {
  if (!scope.canViewSystem) {
    const hasOpen = rows.some((row) => row.state === "open");
    const hasHalfOpen = rows.some((row) => row.state === "half_open");
    return { state: hasOpen ? "open" : hasHalfOpen ? "half_open" : "closed", label: circuitLabel(hasOpen ? "open" : hasHalfOpen ? "half_open" : "closed"), items: [] };
  }
  const state = rows.some((row) => row.state === "open") ? "open" : rows.some((row) => row.state === "half_open") ? "half_open" : "closed";
  return {
    state,
    label: circuitLabel(state),
    items: rows.map((row) => ({
      provider: row.provider,
      model: row.model,
      state: row.state,
      label: circuitLabel(row.state),
      failureCount: row.failure_count,
      lastFailureCode: row.last_failure_code,
      lastFailureAt: toIso(row.last_failure_at),
      lastSuccessAt: toIso(row.last_success_at),
      openedAt: toIso(row.opened_at),
      nextProbeAt: toIso(row.next_probe_at),
      leaseActive: row.lease_active,
    })),
  };
}

function circuitLabel(state: string) {
  if (state === "open") return "Gecici olarak kapali";
  if (state === "half_open") return "Kontrollu test cagrisi";
  return "Normal";
}

function mapPolicy(row: PolicyRow) {
  return {
    dataPolicy: row.data_policy,
    retentionDays: row.retention_days,
    dailyAnalysisLimit: row.daily_analysis_limit,
    monthlyAnalysisLimit: row.monthly_analysis_limit,
    maxConcurrentAnalyses: row.max_concurrent_analyses,
    fallbackEnabled: row.fallback_enabled,
    version: row.settings_version,
    updatedAt: toIso(row.updated_at),
  };
}

function sanitizeRetention(value: Record<string, unknown>) {
  return {
    mode: typeof value.mode === "string" ? value.mode : null,
    companyId: typeof value.companyId === "number" ? value.companyId : null,
    deletedAnalyses: typeof value.deletedAnalyses === "number" ? value.deletedAnalyses : null,
    deletedAttempts: typeof value.deletedAttempts === "number" ? value.deletedAttempts : null,
    skippedLinkedAnalyses: typeof value.skippedLinkedAnalyses === "number" ? value.skippedLinkedAnalyses : null,
    durationMs: typeof value.durationMs === "number" ? value.durationMs : null,
  };
}

function pilotHealth(input: { totals: AnalysisTotalsRow; attempts: AttemptTotalsRow; circuitRows: CircuitRow[]; config: ReturnType<typeof readAiRuntimeConfig> }) {
  if (input.circuitRows.some((row) => row.state === "open") || input.totals.stale_processing > 0) {
    return { status: "action_required", label: "Mudahale gerekli" };
  }
  if ((input.totals.total_requests > 0 && input.totals.fallback_count / input.totals.total_requests > 0.25)
    || (input.attempts.provider_call_count > 0 && input.attempts.cost_unknown_count / input.attempts.provider_call_count > 0.2)
    || (input.config.provider === "gemini" && input.config.productionDataEnabled && !input.config.gemini.apiKey)) {
    return { status: "watch", label: "Izlenmeli" };
  }
  return { status: "normal", label: "Normal" };
}

function mapAnalysisListRow(row: AnalysisListRow) {
  return {
    id: row.id,
    companyId: row.company_id,
    companyName: row.company_name,
    unitId: row.unit_id,
    unitName: row.unit_name,
    analysisType: row.analysis_type,
    status: row.status,
    provider: row.provider,
    model: row.model,
    cacheHit: row.cache_hit,
    fallbackUsed: row.fallback_used,
    errorCode: row.error_code,
    latencyMs: nullableNumber(row.latency_ms),
    startedAt: toIso(row.started_at),
    completedAt: toIso(row.completed_at),
    createdAt: toIso(row.created_at),
  };
}

function mapAnalysisDetailRow(row: AnalysisDetailRow, includeCompany: boolean) {
  return {
    id: row.id,
    companyId: includeCompany ? row.company_id : null,
    companyName: includeCompany ? row.company_name : null,
    unitId: row.unit_id,
    unitName: row.unit_name,
    requestedByUserId: row.requested_by_user_id,
    analysisType: row.analysis_type,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status,
    provider: row.provider,
    model: row.model,
    contextSchemaVersion: row.context_schema_version,
    outputSchemaVersion: row.output_schema_version,
    promptPolicyVersion: row.prompt_policy_version,
    builderVersion: row.builder_version,
    redactionPolicyVersion: row.redaction_policy_version,
    limitPolicyVersion: row.limit_policy_version,
    dataVersion: row.data_version,
    cacheKey: row.cache_key,
    cacheHit: row.cache_hit,
    sourceAnalysisId: row.source_analysis_id,
    fallbackUsed: row.fallback_used,
    dataSufficiency: row.data_sufficiency,
    contextTruncated: row.context_truncated,
    contextWarnings: Array.isArray(row.context_warnings_json) ? row.context_warnings_json : [],
    errorCode: row.error_code,
    errorMessageSafe: row.error_message_safe,
    startedAt: toIso(row.started_at),
    completedAt: toIso(row.completed_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapAttemptDetailRow(row: AttemptDetailRow) {
  return {
    attemptNumber: row.attempt_number,
    provider: row.provider,
    model: row.model,
    success: row.success,
    retryable: row.retryable,
    errorCode: row.error_code,
    providerHttpStatus: row.provider_http_status,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    thinkingTokens: row.thinking_tokens,
    cachedTokens: row.cached_tokens,
    totalTokens: row.total_tokens,
    estimatedCost: row.estimated_cost,
    currency: row.currency,
    costCalculationVersion: row.cost_calculation_version,
    pricingCatalogVersion: row.pricing_catalog_version,
    dataPolicy: row.data_policy,
    productionDataEnabled: row.production_data_enabled,
    contextTruncated: row.context_truncated,
    dataSufficiency: row.data_sufficiency,
    syntheticContext: row.synthetic_context,
    providerDataClassification: row.provider_data_classification,
    latencyMs: row.latency_ms,
    startedAt: toIso(row.started_at),
    completedAt: toIso(row.completed_at),
  };
}

function mapCompanyUsageRow(row: CompanyUsageRow) {
  return {
    companyId: row.company_id,
    companyName: row.company_name,
    policy: row.data_policy,
    dailyAnalysisLimit: row.daily_analysis_limit,
    monthlyAnalysisLimit: row.monthly_analysis_limit,
    maxConcurrentAnalyses: row.max_concurrent_analyses,
    fallbackEnabled: row.fallback_enabled,
    totalRequests: row.total_requests,
    providerCalls: row.provider_calls,
    cacheHit: row.cache_hit,
    fallback: row.fallback,
    failed: row.failed,
    totalTokens: nullableInteger(row.total_tokens),
    estimatedCost: row.currency_count > 1 ? null : row.estimated_cost,
    currency: row.currency_count > 1 ? null : row.currency,
    mixedCurrency: row.currency_count > 1,
    costUnknownCount: row.cost_unknown_count,
    activeProcessing: row.active_processing,
    lastAnalysisAt: toIso(row.last_analysis_at),
  };
}

function emptyAnalysisTotals(): AnalysisTotalsRow {
  return {
    total_requests: 0,
    completed_count: 0,
    failed_count: 0,
    active_processing: 0,
    stale_processing: 0,
    cache_hit_count: 0,
    cache_miss_count: 0,
    fallback_count: 0,
    gemini_count: 0,
    mock_count: 0,
    rule_based_count: 0,
    last_completed_at: null,
    last_error_code: null,
    avg_latency_ms: null,
    p95_latency_ms: null,
    avg_finding_count: null,
  };
}

function emptyAttemptTotals(): AttemptTotalsRow {
  return {
    provider_call_count: 0,
    cost_unknown_count: 0,
    input_tokens: null,
    output_tokens: null,
    thinking_tokens: null,
    cached_tokens: null,
    total_tokens: null,
    estimated_cost: null,
    currency_count: 0,
    currency: null,
    pricing_catalog_version: null,
  };
}

type AnalysisTotalsRow = {
  total_requests: number;
  completed_count: number;
  failed_count: number;
  active_processing: number;
  stale_processing: number;
  cache_hit_count: number;
  cache_miss_count: number;
  fallback_count: number;
  gemini_count: number;
  mock_count: number;
  rule_based_count: number;
  last_completed_at: Date | null;
  last_error_code: string | null;
  avg_latency_ms: string | number | null;
  p95_latency_ms: string | number | null;
  avg_finding_count: string | number | null;
};

type AttemptTotalsRow = {
  provider_call_count: number;
  cost_unknown_count: number;
  input_tokens: string | null;
  output_tokens: string | null;
  thinking_tokens: string | null;
  cached_tokens: string | null;
  total_tokens: string | null;
  estimated_cost: string | null;
  currency_count: number;
  currency: string | null;
  pricing_catalog_version: string | null;
};

type CircuitRow = {
  provider: string;
  model: string;
  state: string;
  failure_count: number;
  last_failure_code: string | null;
  last_failure_at: Date | null;
  last_success_at: Date | null;
  opened_at: Date | null;
  next_probe_at: Date | null;
  lease_active: boolean;
};

type PolicyRow = {
  data_policy: string;
  retention_days: number | null;
  daily_analysis_limit: number | null;
  monthly_analysis_limit: number | null;
  max_concurrent_analyses: number;
  fallback_enabled: boolean;
  settings_version: number;
  updated_at: Date | null;
};

type TimeSeriesAnalysisRow = {
  day: string;
  total: number;
  cache_hit: number;
  completed: number;
  failed: number;
  fallback: number;
  estimated_cost: string | null;
  cost_unknown: number;
};

type AnalysisListRow = {
  id: number;
  company_id: number;
  company_name: string | null;
  unit_id: number | null;
  unit_name: string | null;
  analysis_type: string;
  status: string;
  provider: string;
  model: string;
  cache_hit: boolean;
  fallback_used: boolean;
  error_code: string | null;
  latency_ms: string | number | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  total_count: number;
};

type AnalysisDetailRow = Omit<AnalysisListRow, "latency_ms" | "total_count"> & {
  requested_by_user_id: number | null;
  period_start: string;
  period_end: string;
  context_schema_version: string;
  output_schema_version: string;
  prompt_policy_version: string;
  builder_version: string;
  redaction_policy_version: string;
  limit_policy_version: string;
  data_version: string;
  cache_key: string;
  source_analysis_id: number | null;
  data_sufficiency: string;
  context_truncated: boolean;
  context_warnings_json: unknown;
  error_message_safe: string | null;
  updated_at: Date;
};

type AttemptDetailRow = {
  attempt_number: number;
  provider: string;
  model: string;
  started_at: Date;
  completed_at: Date | null;
  success: boolean;
  retryable: boolean;
  error_code: string | null;
  provider_http_status: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  thinking_tokens: number | null;
  cached_tokens: number | null;
  total_tokens: number | null;
  estimated_cost: string | null;
  currency: string | null;
  cost_calculation_version: string | null;
  pricing_catalog_version: string | null;
  data_policy: string | null;
  production_data_enabled: boolean | null;
  context_truncated: boolean | null;
  data_sufficiency: string | null;
  synthetic_context: boolean | null;
  provider_data_classification: string | null;
  latency_ms: number | null;
};

type CompanyUsageRow = {
  company_id: number;
  company_name: string;
  data_policy: string;
  daily_analysis_limit: number | null;
  monthly_analysis_limit: number | null;
  max_concurrent_analyses: number | null;
  fallback_enabled: boolean | null;
  total_requests: number;
  cache_hit: number;
  fallback: number;
  failed: number;
  active_processing: number;
  provider_calls: number;
  total_tokens: string | null;
  estimated_cost: string | null;
  cost_unknown_count: number;
  currency: string | null;
  currency_count: number;
  last_analysis_at: Date | null;
};
