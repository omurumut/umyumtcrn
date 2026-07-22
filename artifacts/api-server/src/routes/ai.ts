import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { aiAnalysisTypeSchema } from "@workspace/api-zod";
import { db, consumptionTable, metersTable, seuTable, unitsTable } from "@workspace/db";
import { requireAuth, requireCompanyAdmin } from "../middlewares/auth.js";
import {
  buildEquipmentInventoryContext,
  toEquipmentAiReadiness,
} from "../lib/equipment-inventory-context.js";
import {
  buildTechnicalProfileAiContext,
  endOfYearEffectiveDate,
} from "../lib/unit-technical-profile-effective.js";
import { readAiRuntimeConfig } from "../lib/ai/config.js";
import { AiProviderError, providerErrorResponse } from "../lib/ai/errors.js";
import { createAiProvider } from "../lib/ai/registry.js";
import { buildAiAnalysisContext } from "../lib/ai/context-builder.js";
import {
  getAiAnalysisDetail,
  listAiAnalyses,
  loadCompanyAiPolicy,
  runPersistedAiAnalysis,
  upsertCompanyAiPolicy,
  type CompanyAiDataPolicy,
} from "../lib/ai/analysis-service.js";
import { writeBestEffortAudit } from "../lib/audit.js";
import {
  aiReadinessFromTechnicalProfile,
  AI_SUGGESTION_FOCUS_VALUES,
  buildRuleBasedSuggestions,
} from "../lib/ai/rule-based-suggestions.js";
import {
  AiScopeError,
  parseMatchingPositiveInteger,
  resolveAiScopeFromRequest,
} from "../lib/ai/scope.js";
import type { AiProviderRequest } from "../lib/ai/provider.js";

const router = Router();

function parseFocus(value: unknown) {
  if (typeof value !== "string") throw new AiScopeError(400, "focus zorunludur");
  const focus = value.trim();
  if (!AI_SUGGESTION_FOCUS_VALUES.has(focus)) throw new AiScopeError(400, "Gecersiz focus");
  return focus;
}

function requestIdFromHeaders(header: unknown) {
  return typeof header === "string" && header.trim().length > 0 ? header.trim() : undefined;
}

function parseLimit(value: unknown) {
  const raw = parseMatchingPositiveInteger(undefined, value, "limit") ?? 20;
  return Math.max(1, Math.min(100, raw));
}

function parseOffset(value: unknown) {
  const raw = parseOptionalNonNegativeInteger(value, "offset") ?? 0;
  return Math.max(0, raw);
}

function parsePolicy(value: unknown): CompanyAiDataPolicy {
  if (value === "disabled" || value === "synthetic_only" || value === "production_allowed") return value;
  throw new AiScopeError(400, "Gecersiz AI dataPolicy");
}

function parseOptionalNonNegativeInteger(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value.trim())) return Number(value.trim());
  throw new AiScopeError(400, `Gecersiz ${field}`);
}

router.post("/ai/suggestions", requireAuth, async (req, res) => {
  try {
    const focus = parseFocus((req.body as { focus?: unknown } | undefined)?.focus);
    const scope = await resolveAiScopeFromRequest(req);
    const effectiveDate = endOfYearEffectiveDate(scope.year);
    const consumptionConditions = [
      eq(consumptionTable.year, scope.year),
      eq(consumptionTable.companyId, scope.companyId),
      eq(metersTable.companyId, scope.companyId),
    ];
    if (scope.unitId !== null) consumptionConditions.push(eq(metersTable.unitId, scope.unitId));

    const rows = await db.select({
      id: consumptionTable.id,
      kwh: consumptionTable.kwh,
    })
      .from(consumptionTable)
      .innerJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
      .where(and(...consumptionConditions));

    const seuConditions = [eq(seuTable.companyId, scope.companyId)];
    if (scope.unitId !== null) seuConditions.push(eq(seuTable.unitId, scope.unitId));
    const seuItems = await db.select({
      category: seuTable.category,
      annualKwh: seuTable.annualKwh,
      priority: seuTable.priority,
    })
      .from(seuTable)
      .where(and(...seuConditions))
      .orderBy(seuTable.priority);

    const totalKwh = rows.reduce((sum, row) => sum + row.kwh, 0);
    const [technicalProfileContext, equipmentInventoryContext] = await Promise.all([
      buildTechnicalProfileAiContext({
        companyId: scope.companyId,
        unitId: scope.unitId,
        effectiveDate,
      }),
      buildEquipmentInventoryContext({
        companyId: scope.companyId,
        unitId: scope.unitId,
        effectiveDate,
        includeItems: false,
      }),
    ]);

    res.json({
      suggestions: buildRuleBasedSuggestions({ totalKwh, seuItems, focus }).slice(0, 6),
      technicalProfileReadiness: aiReadinessFromTechnicalProfile(technicalProfileContext),
      equipmentInventoryReadiness: toEquipmentAiReadiness(equipmentInventoryContext),
    });
  } catch (err) {
    if (err instanceof AiScopeError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatasi" });
  }
});

router.post("/ai/analyses/preview", requireAuth, async (req, res) => {
  let timeout: NodeJS.Timeout | null = null;
  try {
    const body = req.body as { analysisType?: unknown } | undefined;
    const analysisType = aiAnalysisTypeSchema.parse(body?.analysisType);
    parseMatchingPositiveInteger(undefined, req.query.companyId, "companyId");
    const scope = await resolveAiScopeFromRequest(req);
    const effectiveDate = endOfYearEffectiveDate(scope.year);
    const config = readAiRuntimeConfig();
    if (config.provider === "gemini" && config.developmentDataPolicy !== "demo_only") {
      res.status(403).json({
        error: "Gemini preview yalniz acik demo/development veri politikasi ile calisir",
        code: "AI_INVALID_REQUEST",
      });
      return;
    }
    if (config.provider === "gemini" && !await isTrustedDemoScope(scope.companyId, scope.unitId)) {
      res.status(403).json({
        error: "Gemini preview bu fazda yalniz guvenilir demo unit context'i ile calisir",
        code: "AI_INVALID_REQUEST",
      });
      return;
    }
    const provider = createAiProvider(config);

    const builtContext = await buildAiAnalysisContext(scope, {
      analysisType,
      effectiveDate,
    });

    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    const providerRequest: AiProviderRequest = {
      analysisType,
      scope,
      context: builtContext.context,
      evidenceRegistry: builtContext.evidenceRegistry,
      dataVersion: builtContext.dataVersion,
    };
    const result = await provider.generateAnalysis(providerRequest, {
      signal: controller.signal,
      timeoutMs: config.timeoutMs,
      maxOutputTokens: config.maxOutputTokens,
      requestId: requestIdFromHeaders(req.headers["x-request-id"]),
    });

    res.json({
      mode: result.meta.provider,
      analysis: result.analysis,
      meta: {
        provider: result.meta.provider,
        model: result.meta.model,
        cacheHit: false,
        fallbackUsed: false,
        dataVersion: builtContext.dataVersion,
        contextSchemaVersion: builtContext.context.contextSchemaVersion,
        dataSufficiency: builtContext.context.dataSufficiency,
        contextWarnings: builtContext.warnings,
        contextTruncated: builtContext.context.contextTruncated,
        providerRequestId: result.meta.providerRequestId,
        startedAt: result.meta.startedAt,
        finishedAt: result.meta.finishedAt,
        durationMs: result.meta.durationMs,
        usage: result.meta.usage,
      },
    });
  } catch (err) {
    if (err instanceof AiScopeError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof AiProviderError) {
      res.status(err.status).json(providerErrorResponse(err));
      return;
    }
    if (err && typeof err === "object" && "name" in err && err.name === "ZodError") {
      res.status(400).json({ error: "Gecersiz analiz istegi" });
      return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatasi" });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
});

router.post("/ai/analyses", requireAuth, async (req, res) => {
  try {
    const body = req.body as { analysisType?: unknown } | undefined;
    const analysisType = aiAnalysisTypeSchema.parse(body?.analysisType);
    parseMatchingPositiveInteger(undefined, req.query.companyId, "companyId");
    const scope = await resolveAiScopeFromRequest(req);
    const result = await runPersistedAiAnalysis({
      scope,
      analysisType,
      user: req.user!,
      requestId: requestIdFromHeaders(req.headers["x-request-id"]) ?? String(req.id ?? "ai-analysis"),
    });
    res.status(result.meta.cacheHit ? 200 : 201).json(result);
  } catch (err) {
    if (err instanceof AiScopeError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof AiProviderError) {
      res.status(err.status).json(providerErrorResponse(err));
      return;
    }
    if (err && typeof err === "object" && "name" in err && err.name === "ZodError") {
      res.status(400).json({ error: "Gecersiz analiz istegi" });
      return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatasi" });
  }
});

router.get("/ai/analyses", requireAuth, async (req, res) => {
  try {
    const scope = await resolveAiScopeFromRequest(req);
    const analysisType = req.query.analysisType === undefined ? undefined : aiAnalysisTypeSchema.parse(req.query.analysisType);
    const status = typeof req.query.status === "string" && ["pending", "processing", "completed", "failed"].includes(req.query.status)
      ? req.query.status
      : undefined;
    const items = await listAiAnalyses(scope, {
      limit: parseLimit(req.query.limit),
      offset: parseOffset(req.query.offset),
      analysisType,
      status,
    });
    res.json({ items, pagination: { limit: parseLimit(req.query.limit), offset: parseOffset(req.query.offset) } });
  } catch (err) {
    if (err instanceof AiScopeError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err && typeof err === "object" && "name" in err && err.name === "ZodError") {
      res.status(400).json({ error: "Gecersiz analiz filtreleri" });
      return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatasi" });
  }
});

router.get("/ai/analyses/:id", requireAuth, async (req, res) => {
  try {
    const id = parseMatchingPositiveInteger(undefined, req.params.id, "id");
    if (id === undefined) throw new AiScopeError(400, "Gecersiz id");
    const scope = await resolveAiScopeFromRequest(req);
    const detail = await getAiAnalysisDetail(scope, id);
    if (!detail) {
      res.status(404).json({ error: "Analiz bulunamadi" });
      return;
    }
    res.json({
      analysis: {
        id: detail.analysis.id,
        status: detail.analysis.status,
        analysisType: detail.analysis.analysisType,
        periodStart: detail.analysis.periodStart,
        periodEnd: detail.analysis.periodEnd,
        result: detail.result,
        createdAt: detail.analysis.createdAt,
        completedAt: detail.analysis.completedAt,
      },
      meta: {
        provider: detail.analysis.provider,
        model: detail.analysis.model,
        cacheHit: detail.analysis.cacheHit,
        sourceAnalysisId: detail.analysis.sourceAnalysisId,
        fallbackUsed: detail.analysis.fallbackUsed,
        dataVersion: detail.analysis.dataVersion,
        dataSufficiency: detail.analysis.dataSufficiency,
        contextTruncated: detail.analysis.contextTruncated,
        attempts: detail.attempts,
      },
    });
  } catch (err) {
    if (err instanceof AiScopeError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatasi" });
  }
});

router.get("/company-settings/ai", requireAuth, async (req, res) => {
  try {
    const scope = await resolveAiScopeFromRequest(req);
    const policy = await loadCompanyAiPolicy(scope.companyId);
    res.json(policy);
  } catch (err) {
    if (err instanceof AiScopeError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatasi" });
  }
});

router.patch("/company-settings/ai", requireAuth, requireCompanyAdmin, async (req, res) => {
  try {
    const body = req.body as { dataPolicy?: unknown; retentionDays?: unknown; expectedSettingsVersion?: unknown } | undefined;
    const scope = await resolveAiScopeFromRequest(req);
    const dataPolicy = parsePolicy(body?.dataPolicy);
    const retentionDays = body?.retentionDays === null || body?.retentionDays === undefined
      ? null
      : parseMatchingPositiveInteger(body.retentionDays, undefined, "retentionDays") ?? null;
    if (retentionDays !== null && (retentionDays < 30 || retentionDays > 3650)) throw new AiScopeError(400, "Gecersiz retentionDays");
    const expectedSettingsVersion = parseOptionalNonNegativeInteger(body?.expectedSettingsVersion, "expectedSettingsVersion");
    const result = await upsertCompanyAiPolicy({
      companyId: scope.companyId,
      dataPolicy,
      retentionDays,
      expectedSettingsVersion,
      userId: req.user?.userId ?? null,
    });
    if (result.status === "conflict") {
      res.status(409).json({ error: "AI ayar surumu guncel degil", currentVersion: result.settings.settingsVersion });
      return;
    }
    await writeBestEffortAudit(db, {
      request: req,
      action: result.status === "created" ? "company_ai_settings.created" : "company_ai_settings.updated",
      entityType: "company_ai_settings",
      entityId: result.settings.id,
      companyId: scope.companyId,
      unitId: null,
      metadata: {
        dataPolicy: result.settings.dataPolicy,
        retentionDays: result.settings.retentionDays,
        version: result.settings.settingsVersion,
      },
    });
    res.json({
      dataPolicy: result.settings.dataPolicy,
      retentionDays: result.settings.retentionDays,
      version: result.settings.settingsVersion,
      updatedAt: result.settings.updatedAt.toISOString(),
    });
  } catch (err) {
    if (err instanceof AiScopeError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatasi" });
  }
});

async function isTrustedDemoScope(companyId: number, unitId: number | null) {
  if (unitId === null) return false;
  const [unit] = await db.select({ isDemo: unitsTable.isDemo })
    .from(unitsTable)
    .where(and(eq(unitsTable.companyId, companyId), eq(unitsTable.id, unitId)))
    .limit(1);
  return unit?.isDemo === true;
}

export default router;
