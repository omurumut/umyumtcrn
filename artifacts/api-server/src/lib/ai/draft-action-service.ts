import { and, eq } from "drizzle-orm";
import { aiAnalysisResultSchema, type AiAnalysisResult, type AiFinding } from "@workspace/api-zod";
import {
  aiAnalysesTable,
  aiFindingActionLinksTable,
  db,
  energyActionPlansTable,
} from "@workspace/db";
import type { Request } from "express";
import type { SessionUser } from "../../middlewares/auth.js";
import { writeAuditEvent } from "../audit.js";
import {
  ActionPlanBadRequestError,
  ActionPlanForbiddenError,
  createEnergyActionPlan,
  parsePositiveInteger,
} from "../energy-action-plan-service.js";
import type { AiResolvedScope } from "./scope.js";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class AiDraftActionError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "AiDraftActionError";
  }
}

export type DraftActionRequestBody = {
  title?: unknown;
  description?: unknown;
  priority?: unknown;
  targetId?: unknown;
  responsibleUserId?: unknown;
  dueDate?: unknown;
  startDate?: unknown;
  estimatedCost?: unknown;
  estimatedSavingKwh?: unknown;
  humanApproval?: unknown;
  fallbackAcknowledgement?: unknown;
};

export type DraftActionResponse = {
  action: {
    id: number;
    status: string;
    title: string;
  };
  source: {
    analysisId: number;
    findingId: string;
  };
  created: boolean;
};

export async function createDraftActionFromAiFinding(input: {
  scope: AiResolvedScope;
  analysisId: number;
  findingId: string;
  body: DraftActionRequestBody;
  user: SessionUser;
  request?: Request;
}): Promise<DraftActionResponse> {
  if (input.body.humanApproval !== true) {
    throw new AiDraftActionError(400, "Insan onayi zorunludur", "AI_HUMAN_APPROVAL_REQUIRED");
  }
  const existing = await findExistingLink(input.scope.companyId, input.analysisId, input.findingId);
  if (existing) return duplicateResponse(existing, input.analysisId, input.findingId);

  try {
    return await db.transaction(async (tx) => {
      const analysis = await loadAnalysisForConversion(tx, input.scope, input.analysisId);
      const result = parseStoredAnalysisResult(analysis.resultJson);
      const finding = result.findings.find((item) => item.id === input.findingId);
      if (!finding) throw new AiDraftActionError(404, "Finding bulunamadi", "AI_FINDING_NOT_FOUND");
      validateFindingForConversion({ finding, result, analysis, scope: input.scope, user: input.user, body: input.body });

      const existingInTx = await findExistingLink(input.scope.companyId, input.analysisId, input.findingId, tx);
      if (existingInTx) return duplicateResponse(existingInTx, input.analysisId, input.findingId);

      const payload = actionPayloadFromBody(input.body, finding);
      const created = await createEnergyActionPlan({
        session: input.user,
        body: payload,
        companyIdInput: input.scope.companyId,
        request: input.request,
        executor: tx,
        auditMetadata: {
          source: "ai_finding",
          analysisId: input.analysisId,
          findingId: input.findingId,
        },
      });

      if (created.target.unitId !== finding.scope.unitId) {
        throw new AiDraftActionError(403, "Hedef finding kapsami ile uyusmuyor", "AI_TARGET_SCOPE_MISMATCH");
      }

      const [link] = await tx.insert(aiFindingActionLinksTable).values({
        companyId: input.scope.companyId,
        unitId: finding.scope.unitId,
        analysisId: input.analysisId,
        findingId: finding.id,
        actionId: created.action.id,
        createdByUserId: input.user.userId ?? null,
      }).returning();

      await writeAuditEvent(tx, {
        request: input.request,
        companyId: input.scope.companyId,
        unitId: finding.scope.unitId,
        action: "AI_FINDING_CONVERTED_TO_DRAFT_ACTION",
        entityType: "ai_finding_action_link",
        entityId: link.id,
        metadata: {
          companyId: input.scope.companyId,
          unitId: finding.scope.unitId,
          analysisId: input.analysisId,
          findingId: finding.id,
          actionId: created.action.id,
          userId: input.user.userId ?? null,
          analysisType: analysis.analysisType,
          provider: analysis.provider,
          fallbackUsed: analysis.fallbackUsed,
          findingPriority: finding.priority,
          humanApproval: true,
          timestamp: new Date().toISOString(),
        },
      });

      return {
        action: {
          id: created.action.id,
          status: created.action.status,
          title: created.action.title,
        },
        source: {
          analysisId: input.analysisId,
          findingId: finding.id,
        },
        created: true,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const duplicate = await findExistingLink(input.scope.companyId, input.analysisId, input.findingId);
      if (duplicate) return duplicateResponse(duplicate, input.analysisId, input.findingId);
    }
    if (error instanceof ActionPlanBadRequestError) {
      throw new AiDraftActionError(400, error.message, "AI_ACTION_VALIDATION_FAILED");
    }
    if (error instanceof ActionPlanForbiddenError) {
      throw new AiDraftActionError(403, error.message, "AI_ACTION_FORBIDDEN");
    }
    throw error;
  }
}

async function loadAnalysisForConversion(tx: DbTransaction, scope: AiResolvedScope, analysisId: number) {
  const conditions = [eq(aiAnalysesTable.id, analysisId), eq(aiAnalysesTable.companyId, scope.companyId)];
  if (scope.unitId !== null) conditions.push(eq(aiAnalysesTable.unitId, scope.unitId));
  const [analysis] = await tx.select().from(aiAnalysesTable).where(and(...conditions)).limit(1);
  if (!analysis) throw new AiDraftActionError(404, "Analiz bulunamadi", "AI_ANALYSIS_NOT_FOUND");
  if (analysis.status !== "completed" || !analysis.resultJson) {
    throw new AiDraftActionError(409, "Analiz tamamlanmadan aksiyona donusturulemez", "AI_ANALYSIS_NOT_COMPLETED");
  }
  return analysis;
}

function parseStoredAnalysisResult(value: unknown): AiAnalysisResult {
  const parsed = aiAnalysisResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new AiDraftActionError(409, "Analiz sonucu gecerli semadan gecmedi", "AI_RESULT_SCHEMA_INVALID");
  }
  return parsed.data;
}

function validateFindingForConversion(input: {
  finding: AiFinding;
  result: AiAnalysisResult;
  analysis: typeof aiAnalysesTable.$inferSelect;
  scope: AiResolvedScope;
  user: SessionUser;
  body: DraftActionRequestBody;
}) {
  const { finding, analysis, scope, user, body } = input;
  if (!finding.draftActionEligibility.eligible) {
    throw new AiDraftActionError(409, "Bu finding taslak aksiyona uygun degil", "AI_FINDING_NOT_ELIGIBLE");
  }
  if (analysis.companyId !== finding.scope.companyId || analysis.unitId !== finding.scope.unitId) {
    throw new AiDraftActionError(403, "Finding kapsami analiz kapsami ile uyusmuyor", "AI_FINDING_SCOPE_MISMATCH");
  }
  if (finding.scope.companyId !== scope.companyId) {
    throw new AiDraftActionError(403, "Finding firma kapsami gecersiz", "AI_FINDING_TENANT_MISMATCH");
  }
  if (scope.unitId !== null && finding.scope.unitId !== scope.unitId) {
    throw new AiDraftActionError(403, "Finding birim kapsami gecersiz", "AI_FINDING_UNIT_MISMATCH");
  }
  if (user.role !== "admin" && user.role !== "kontrol_admin" && user.role !== "superadmin") {
    if (user.unitId === null || finding.scope.unitId === null || user.unitId !== finding.scope.unitId) {
      throw new AiDraftActionError(403, "Bu finding icin aksiyon olusturma yetkiniz yok", "AI_FINDING_FORBIDDEN");
    }
  }
  if (analysis.fallbackUsed && body.fallbackAcknowledgement !== true) {
    throw new AiDraftActionError(400, "Fallback sonucu icin ek manuel onay zorunludur", "AI_FALLBACK_ACK_REQUIRED");
  }
  if (finding.evidence.some((evidence) => !evidence.source.startsWith("ev:"))) {
    throw new AiDraftActionError(409, "Finding evidence referanslari gecersiz", "AI_FINDING_EVIDENCE_INVALID");
  }
}

function actionPayloadFromBody(body: DraftActionRequestBody, finding: AiFinding): Record<string, unknown> {
  const targetId = parsePositiveInteger(body.targetId);
  if (targetId === undefined) throw new AiDraftActionError(400, "targetId zorunludur", "AI_TARGET_REQUIRED");
  const title = typeof body.title === "string" && body.title.trim() ? body.title : finding.title;
  const description = typeof body.description === "string" && body.description.trim()
    ? body.description
    : defaultDescription(finding);
  return {
    targetId,
    title,
    description,
    responsibleUserId: body.responsibleUserId === undefined ? null : body.responsibleUserId,
    priority: body.priority ?? priorityToActionPriority(finding.priority),
    expectedSavingValue: null,
    expectedSavingUnit: null,
    expectedCostSaving: null,
    investmentCost: body.estimatedCost ?? null,
    startDate: body.startDate,
    dueDate: body.dueDate,
    progressPercent: 0,
    status: "planned",
    isVap: false,
    notes: actionNotes(finding),
  };
}

function defaultDescription(finding: AiFinding) {
  const limitations = finding.limitations.length > 0 ? `\n\nSinirlamalar: ${finding.limitations.slice(0, 3).join("; ")}` : "";
  return `${finding.observation}\n\nOnerilen aksiyon: ${finding.recommendedAction}${limitations}`;
}

function actionNotes(finding: AiFinding) {
  const parts = [
    "AI karar destegi ile taslak aksiyona donusturuldu; muhendislik fizibilitesi veya tasarruf garantisi degildir.",
  ];
  if (finding.estimatedImpact.type === "backend_scenario") {
    parts.push(`Senaryo notu: ${finding.estimatedImpact.description}`);
  }
  if (finding.estimatedImpact.type === "qualitative_estimate") {
    parts.push("Nitel etki tahmini sayisal tasarruf alani olarak aktarilmadi.");
  }
  return parts.join("\n");
}

function priorityToActionPriority(priority: AiFinding["priority"]) {
  if (priority === "critical") return "high";
  return priority;
}

async function findExistingLink(companyId: number, analysisId: number, findingId: string, tx?: DbTransaction) {
  const executor = tx ?? db;
  const [row] = await executor.select({
    actionId: aiFindingActionLinksTable.actionId,
    actionStatus: energyActionPlansTable.status,
    actionTitle: energyActionPlansTable.title,
  }).from(aiFindingActionLinksTable)
    .innerJoin(energyActionPlansTable, eq(aiFindingActionLinksTable.actionId, energyActionPlansTable.id))
    .where(and(
      eq(aiFindingActionLinksTable.companyId, companyId),
      eq(aiFindingActionLinksTable.analysisId, analysisId),
      eq(aiFindingActionLinksTable.findingId, findingId),
      eq(energyActionPlansTable.companyId, companyId),
    ))
    .limit(1);
  return row ?? null;
}

function duplicateResponse(existing: NonNullable<Awaited<ReturnType<typeof findExistingLink>>>, analysisId: number, findingId: string): DraftActionResponse {
  return {
    action: {
      id: existing.actionId,
      status: existing.actionStatus,
      title: existing.actionTitle,
    },
    source: { analysisId, findingId },
    created: false,
  };
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "23505");
}
