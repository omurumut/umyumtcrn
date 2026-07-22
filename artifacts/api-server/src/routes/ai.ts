import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { aiAnalysisTypeSchema } from "@workspace/api-zod";
import { db, consumptionTable, metersTable, seuTable, unitsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";
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

async function isTrustedDemoScope(companyId: number, unitId: number | null) {
  if (unitId === null) return false;
  const [unit] = await db.select({ isDemo: unitsTable.isDemo })
    .from(unitsTable)
    .where(and(eq(unitsTable.companyId, companyId), eq(unitsTable.id, unitId)))
    .limit(1);
  return unit?.isDemo === true;
}

export default router;
