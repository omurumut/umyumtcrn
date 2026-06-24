import { Router } from "express";
import {
  db,
  consumptionTable,
  metersTable,
  energyUseGroupsTable,
  subUnitsTable,
  energySourcesTable,
  unitsTable,
  seuAssessmentsTable,
  seuAssessmentItemsTable,
  seuTable,
} from "@workspace/db";
import { eq, and, gte, lte, sql, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

function computePriority(share: number, hasOpportunity: boolean): number | null {
  if (share >= 20) return hasOpportunity ? 1 : 2;
  if (share >= 10) return hasOpportunity ? 2 : 3;
  if (share >= 5) return hasOpportunity ? 3 : 4;
  if (hasOpportunity) return 4;
  return null;
}

function computeRecommendation(priority: number | null): "seu_candidate" | "not_seu" {
  return priority !== null ? "seu_candidate" : "not_seu";
}

// ── GET /seu/analyze ─────────────────────────────────────
router.get("/seu/analyze", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const monthStart = parseInt(req.query.monthStart as string) || 1;
    const monthEnd = parseInt(req.query.monthEnd as string) || 12;
    const analysisLevel = (req.query.analysisLevel as string) || "energyUseGroup";
    const energySourceId = req.query.energySourceId ? parseInt(req.query.energySourceId as string) : null;

    let resolvedUnitId: number | null = null;
    if (role === "user" && sessionUnitId !== null) {
      resolvedUnitId = sessionUnitId;
    } else if (role === "admin" || role === "superadmin") {
      resolvedUnitId = req.query.unitId ? parseInt(req.query.unitId as string) : null;
    }

    if (!resolvedUnitId) {
      res.status(400).json({ error: "Birim seçilmedi" });
      return;
    }

    const baseConditions = [
      eq(consumptionTable.companyId, sessionCompanyId),
      eq(metersTable.unitId, resolvedUnitId),
      eq(consumptionTable.year, year),
      gte(consumptionTable.month, monthStart),
      lte(consumptionTable.month, monthEnd),
    ];
    if (energySourceId) baseConditions.push(eq(metersTable.energySourceId, energySourceId));
    const whereClause = and(...baseConditions);

    type RawRow = {
      groupId: number | null;
      groupName: string | null;
      hasOpportunity: boolean | null;
      energyTep: number;
      missingCount: number;
      energyUseGroupId?: number | null;
      meterId?: number | null;
      subUnitId?: number | null;
      energySourceId?: number | null;
    };

    let rawRows: RawRow[] = [];

    if (analysisLevel === "meter") {
      const rows = await db
        .select({
          groupId: metersTable.id,
          groupName: metersTable.name,
          energyTep: sql<number>`COALESCE(SUM(${consumptionTable.tep}), 0)`,
          missingCount: sql<number>`SUM(CASE WHEN ${consumptionTable.tep} = 0 THEN 1 ELSE 0 END)`,
        })
        .from(consumptionTable)
        .innerJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
        .where(whereClause)
        .groupBy(metersTable.id, metersTable.name)
        .orderBy(sql`SUM(${consumptionTable.tep}) DESC NULLS LAST`);
      rawRows = rows.map(r => ({
        groupId: r.groupId, groupName: r.groupName, hasOpportunity: false,
        energyTep: Number(r.energyTep) || 0, missingCount: Number(r.missingCount) || 0,
        meterId: r.groupId,
      }));
    } else if (analysisLevel === "subUnit") {
      const rows = await db
        .select({
          groupId: subUnitsTable.id,
          groupName: subUnitsTable.name,
          energyTep: sql<number>`COALESCE(SUM(${consumptionTable.tep}), 0)`,
          missingCount: sql<number>`SUM(CASE WHEN ${consumptionTable.tep} = 0 THEN 1 ELSE 0 END)`,
        })
        .from(consumptionTable)
        .innerJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
        .leftJoin(subUnitsTable, eq(metersTable.subUnitId, subUnitsTable.id))
        .where(whereClause)
        .groupBy(subUnitsTable.id, subUnitsTable.name)
        .orderBy(sql`SUM(${consumptionTable.tep}) DESC NULLS LAST`);
      rawRows = rows.map(r => ({
        groupId: r.groupId, groupName: r.groupName, hasOpportunity: false,
        energyTep: Number(r.energyTep) || 0, missingCount: Number(r.missingCount) || 0,
        subUnitId: r.groupId,
      }));
    } else if (analysisLevel === "energySource") {
      const rows = await db
        .select({
          groupId: energySourcesTable.id,
          groupName: energySourcesTable.name,
          energyTep: sql<number>`COALESCE(SUM(${consumptionTable.tep}), 0)`,
          missingCount: sql<number>`SUM(CASE WHEN ${consumptionTable.tep} = 0 THEN 1 ELSE 0 END)`,
        })
        .from(consumptionTable)
        .innerJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
        .leftJoin(energySourcesTable, eq(metersTable.energySourceId, energySourcesTable.id))
        .where(whereClause)
        .groupBy(energySourcesTable.id, energySourcesTable.name)
        .orderBy(sql`SUM(${consumptionTable.tep}) DESC NULLS LAST`);
      rawRows = rows.map(r => ({
        groupId: r.groupId, groupName: r.groupName, hasOpportunity: false,
        energyTep: Number(r.energyTep) || 0, missingCount: Number(r.missingCount) || 0,
        energySourceId: r.groupId,
      }));
    } else if (analysisLevel === "unit") {
      const [unitInfo] = await db.select({ name: unitsTable.name }).from(unitsTable).where(eq(unitsTable.id, resolvedUnitId));
      const [totals] = await db
        .select({
          energyTep: sql<number>`COALESCE(SUM(${consumptionTable.tep}), 0)`,
          missingCount: sql<number>`SUM(CASE WHEN ${consumptionTable.tep} = 0 THEN 1 ELSE 0 END)`,
        })
        .from(consumptionTable)
        .innerJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
        .where(whereClause);
      rawRows = [{
        groupId: resolvedUnitId, groupName: unitInfo?.name ?? "Birim", hasOpportunity: false,
        energyTep: Number(totals?.energyTep) || 0, missingCount: Number(totals?.missingCount) || 0,
      }];
    } else {
      const rows = await db
        .select({
          groupId: energyUseGroupsTable.id,
          groupName: energyUseGroupsTable.name,
          hasOpportunity: energyUseGroupsTable.isSeuCandidate,
          energyTep: sql<number>`COALESCE(SUM(${consumptionTable.tep}), 0)`,
          missingCount: sql<number>`SUM(CASE WHEN ${consumptionTable.tep} = 0 THEN 1 ELSE 0 END)`,
        })
        .from(consumptionTable)
        .innerJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
        .leftJoin(energyUseGroupsTable, eq(metersTable.energyUseGroupId, energyUseGroupsTable.id))
        .where(whereClause)
        .groupBy(energyUseGroupsTable.id, energyUseGroupsTable.name, energyUseGroupsTable.isSeuCandidate)
        .orderBy(sql`SUM(${consumptionTable.tep}) DESC NULLS LAST`);
      rawRows = rows.map(r => ({
        groupId: r.groupId, groupName: r.groupName, hasOpportunity: r.hasOpportunity ?? false,
        energyTep: Number(r.energyTep) || 0, missingCount: Number(r.missingCount) || 0,
        energyUseGroupId: r.groupId,
      }));
    }

    const unitTotalTep = rawRows.reduce((sum, r) => sum + r.energyTep, 0);
    const totalMissingTep = rawRows.reduce((sum, r) => sum + r.missingCount, 0);

    const items = rawRows.map(r => {
      const share = unitTotalTep > 0 ? (r.energyTep / unitTotalTep) * 100 : 0;
      const hasOpp = r.hasOpportunity ?? false;
      const priority = computePriority(share, hasOpp);
      return {
        groupId: r.groupId,
        name: r.groupName ?? "Tanımlanmamış",
        analysisLevel,
        energyTep: r.energyTep,
        consumptionSharePercent: Math.round(share * 100) / 100,
        hasOpportunity: hasOpp,
        priorityResult: priority,
        systemRecommendation: computeRecommendation(priority),
        energyUseGroupId: r.energyUseGroupId ?? null,
        meterId: r.meterId ?? null,
        subUnitId: r.subUnitId ?? null,
        energySourceId: r.energySourceId ?? null,
      };
    });

    res.json({
      unitId: resolvedUnitId,
      year,
      periodStart: monthStart,
      periodEnd: monthEnd,
      analysisLevel,
      unitTotalTep,
      missingTepWarning: totalMissingTep > 0,
      missingTepCount: totalMissingTep,
      items,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Analiz hesaplanamadı" });
  }
});

// ── GET /seu/assessments ─────────────────────────────────
router.get("/seu/assessments", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const unitId = req.query.unitId ? parseInt(req.query.unitId as string) : null;
    const year = req.query.year ? parseInt(req.query.year as string) : null;
    const recordType = (req.query.recordType as string) || null;

    const conds = [eq(seuAssessmentsTable.companyId, sessionCompanyId)];

    if (role === "user" && sessionUnitId !== null) {
      conds.push(eq(seuAssessmentsTable.unitId, sessionUnitId));
      conds.push(eq(seuAssessmentsTable.recordType, "unit_official"));
    } else if (role === "admin" || role === "superadmin") {
      if (unitId) conds.push(eq(seuAssessmentsTable.unitId, unitId));
      if (recordType) conds.push(eq(seuAssessmentsTable.recordType, recordType));
    }
    if (year) conds.push(eq(seuAssessmentsTable.year, year));

    const assessments = await db
      .select({
        id: seuAssessmentsTable.id,
        unitId: seuAssessmentsTable.unitId,
        unitName: unitsTable.name,
        year: seuAssessmentsTable.year,
        periodStart: seuAssessmentsTable.periodStart,
        periodEnd: seuAssessmentsTable.periodEnd,
        analysisLevel: seuAssessmentsTable.analysisLevel,
        methodType: seuAssessmentsTable.methodType,
        recordType: seuAssessmentsTable.recordType,
        isOfficial: seuAssessmentsTable.isOfficial,
        unitTotalTep: seuAssessmentsTable.unitTotalTep,
        createdAt: seuAssessmentsTable.createdAt,
        updatedAt: seuAssessmentsTable.updatedAt,
      })
      .from(seuAssessmentsTable)
      .leftJoin(unitsTable, eq(seuAssessmentsTable.unitId, unitsTable.id))
      .where(and(...conds))
      .orderBy(desc(seuAssessmentsTable.createdAt));

    const ids = assessments.map(a => a.id);
    let itemCounts: Record<number, { total: number; seu: number; monitor: number; notSeu: number }> = {};
    if (ids.length > 0) {
      const counts = await db
        .select({
          assessmentId: seuAssessmentItemsTable.assessmentId,
          total: sql<number>`COUNT(*)`,
          seu: sql<number>`SUM(CASE WHEN ${seuAssessmentItemsTable.userDecision} = 'accepted_as_seu' THEN 1 ELSE 0 END)`,
          monitor: sql<number>`SUM(CASE WHEN ${seuAssessmentItemsTable.userDecision} = 'monitor' THEN 1 ELSE 0 END)`,
          notSeu: sql<number>`SUM(CASE WHEN ${seuAssessmentItemsTable.userDecision} = 'not_seu' THEN 1 ELSE 0 END)`,
        })
        .from(seuAssessmentItemsTable)
        .where(inArray(seuAssessmentItemsTable.assessmentId, ids))
        .groupBy(seuAssessmentItemsTable.assessmentId);
      itemCounts = Object.fromEntries(counts.map(c => [
        c.assessmentId,
        { total: Number(c.total) || 0, seu: Number(c.seu) || 0, monitor: Number(c.monitor) || 0, notSeu: Number(c.notSeu) || 0 },
      ]));
    }

    res.json(assessments.map(a => ({
      ...a,
      itemCount: itemCounts[a.id]?.total ?? 0,
      seuCount: itemCounts[a.id]?.seu ?? 0,
      monitorCount: itemCounts[a.id]?.monitor ?? 0,
      notSeuCount: itemCounts[a.id]?.notSeu ?? 0,
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── GET /seu/assessments/:id ─────────────────────────────
router.get("/seu/assessments/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);
    const [assessment] = await db
      .select()
      .from(seuAssessmentsTable)
      .where(and(eq(seuAssessmentsTable.id, id), eq(seuAssessmentsTable.companyId, sessionCompanyId)));
    if (!assessment) { res.status(404).json({ error: "Bulunamadı" }); return; }
    if (role === "user" && assessment.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const items = await db
      .select()
      .from(seuAssessmentItemsTable)
      .where(eq(seuAssessmentItemsTable.assessmentId, id))
      .orderBy(seuAssessmentItemsTable.consumptionSharePercent);
    res.json({ ...assessment, items });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── POST /seu/assessments ────────────────────────────────
router.post("/seu/assessments", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId, id: userId } = req.user!;
    const {
      unitId, year, periodStart = 1, periodEnd = 12,
      analysisLevel = "energyUseGroup",
      methodType = "consumption_share_opportunity_matrix",
      recordType: requestedRecordType,
      unitTotalTep = 0, energySourceId = null,
      items = [],
    } = req.body;

    let resolvedUnitId: number | null = null;
    let recordType = "unit_official";
    let isOfficial = true;

    if (role === "user") {
      resolvedUnitId = sessionUnitId;
      recordType = "unit_official";
      isOfficial = true;
    } else {
      resolvedUnitId = unitId ? parseInt(unitId) : null;
      recordType = requestedRecordType ?? "admin_review";
      isOfficial = recordType === "unit_official";
    }

    if (!resolvedUnitId) { res.status(400).json({ error: "Birim seçilmedi" }); return; }

    const ALLOWED_METHOD_TYPES = ["consumption_share_opportunity_matrix"] as const;
    const resolvedMethodType = methodType || "consumption_share_opportunity_matrix";
    if (!ALLOWED_METHOD_TYPES.includes(resolvedMethodType)) {
      res.status(400).json({ error: `Geçersiz methodType: "${resolvedMethodType}". İzin verilen: ${ALLOWED_METHOD_TYPES.join(", ")}` });
      return;
    }

    if (Array.isArray(items) && items.length > 0) {
      const missingDecision = items.find((item: any) => !item.userDecision);
      if (missingDecision) {
        res.status(400).json({ error: `"${missingDecision.name ?? "Bir kalem"}" için karar seçilmedi. Her satır için karar zorunludur.` });
        return;
      }
    }

    if (recordType === "unit_official") {
      const [existing] = await db
        .select({ id: seuAssessmentsTable.id })
        .from(seuAssessmentsTable)
        .where(and(
          eq(seuAssessmentsTable.companyId, sessionCompanyId),
          eq(seuAssessmentsTable.unitId, resolvedUnitId),
          eq(seuAssessmentsTable.year, parseInt(year)),
          eq(seuAssessmentsTable.analysisLevel, analysisLevel),
          eq(seuAssessmentsTable.methodType, methodType),
          eq(seuAssessmentsTable.recordType, "unit_official"),
        ));
      if (existing) {
        if (role === "admin" || role === "superadmin") {
          res.status(409).json({ error: "Bu birim için resmi kayıt zaten mevcut. Admin kayıtları ezemez." }); return;
        }
        await db.delete(seuAssessmentItemsTable).where(eq(seuAssessmentItemsTable.assessmentId, existing.id));
        await db.delete(seuAssessmentsTable).where(eq(seuAssessmentsTable.id, existing.id));
      }
    }

    const [assessment] = await db.insert(seuAssessmentsTable).values({
      companyId: sessionCompanyId,
      unitId: resolvedUnitId,
      year: parseInt(year),
      periodStart: parseInt(periodStart),
      periodEnd: parseInt(periodEnd),
      analysisLevel,
      methodType,
      recordType,
      isOfficial,
      unitTotalTep: parseFloat(unitTotalTep) || 0,
      energySourceId: energySourceId ? parseInt(energySourceId) : null,
      createdByUserId: userId,
      updatedByUserId: userId,
    }).returning();

    if (items.length > 0) {
      await db.insert(seuAssessmentItemsTable).values(
        items.map((item: any) => ({
          assessmentId: assessment.id,
          energyUseGroupId: item.energyUseGroupId ?? null,
          meterId: item.meterId ?? null,
          unitId: item.unitId ?? null,
          subUnitId: item.subUnitId ?? null,
          energySourceId: item.energySourceId ?? null,
          name: item.name ?? "Tanımlanmamış",
          energyTep: parseFloat(item.energyTep) || 0,
          consumptionSharePercent: parseFloat(item.consumptionSharePercent) || 0,
          hasOpportunity: !!item.hasOpportunity,
          priorityResult: item.priorityResult ?? null,
          systemRecommendation: item.systemRecommendation ?? "not_seu",
          userDecision: item.userDecision || null,
          decisionReason: item.decisionReason || null,
          responsible: item.responsible || null,
          targetReductionPercent: item.targetReductionPercent ? parseFloat(item.targetReductionPercent) : null,
          notes: item.notes || null,
        }))
      );
    }

    res.status(201).json({ id: assessment.id });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── PATCH /seu/assessments/:id/items/:itemId ─────────────
router.patch("/seu/assessments/:id/items/:itemId", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const assessmentId = parseInt(req.params.id as string);
    const itemId = parseInt(req.params.itemId as string);

    const [assessment] = await db
      .select()
      .from(seuAssessmentsTable)
      .where(and(eq(seuAssessmentsTable.id, assessmentId), eq(seuAssessmentsTable.companyId, sessionCompanyId)));
    if (!assessment) { res.status(404).json({ error: "Bulunamadı" }); return; }
    if (role === "user" && assessment.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    const { hasOpportunity, userDecision, decisionReason, responsible, targetReductionPercent, notes } = req.body;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (hasOpportunity !== undefined) updates.hasOpportunity = !!hasOpportunity;
    if (userDecision !== undefined) updates.userDecision = userDecision || null;
    if (decisionReason !== undefined) updates.decisionReason = decisionReason || null;
    if (responsible !== undefined) updates.responsible = responsible || null;
    if (targetReductionPercent !== undefined) updates.targetReductionPercent = targetReductionPercent ? parseFloat(targetReductionPercent) : null;
    if (notes !== undefined) updates.notes = notes || null;

    if (hasOpportunity !== undefined) {
      const [existingItem] = await db
        .select({ consumptionSharePercent: seuAssessmentItemsTable.consumptionSharePercent })
        .from(seuAssessmentItemsTable)
        .where(eq(seuAssessmentItemsTable.id, itemId));
      if (existingItem) {
        const share = existingItem.consumptionSharePercent;
        const newHasOpp = !!hasOpportunity;
        const priority = computePriority(share, newHasOpp);
        updates.priorityResult = priority;
        updates.systemRecommendation = computeRecommendation(priority);
      }
    }

    const [updated] = await db
      .update(seuAssessmentItemsTable)
      .set(updates)
      .where(and(eq(seuAssessmentItemsTable.id, itemId), eq(seuAssessmentItemsTable.assessmentId, assessmentId)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Kalem bulunamadı" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── PATCH /seu/decision-items/analysis/:itemId ───────────
// Shorthand: update an analysis item knowing only itemId (no assessmentId needed)
router.patch("/seu/decision-items/analysis/:itemId", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const itemId = parseInt(req.params.itemId as string);

    const [existingItem] = await db
      .select({ id: seuAssessmentItemsTable.id, assessmentId: seuAssessmentItemsTable.assessmentId, consumptionSharePercent: seuAssessmentItemsTable.consumptionSharePercent })
      .from(seuAssessmentItemsTable)
      .where(eq(seuAssessmentItemsTable.id, itemId));
    if (!existingItem) { res.status(404).json({ error: "Kalem bulunamadı" }); return; }

    const [assessment] = await db
      .select()
      .from(seuAssessmentsTable)
      .where(and(eq(seuAssessmentsTable.id, existingItem.assessmentId), eq(seuAssessmentsTable.companyId, sessionCompanyId)));
    if (!assessment) { res.status(404).json({ error: "Bulunamadı" }); return; }

    if (role === "user" && assessment.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    if ((role === "admin" || role === "superadmin") && assessment.recordType === "unit_official") {
      res.status(403).json({ error: "Admin resmi kayıt kalemlerini düzenleyemez" }); return;
    }

    const { hasOpportunity, userDecision, decisionReason, responsible, targetReductionPercent, notes } = req.body;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (hasOpportunity !== undefined) updates.hasOpportunity = !!hasOpportunity;
    if (userDecision !== undefined) updates.userDecision = userDecision || null;
    if (decisionReason !== undefined) updates.decisionReason = decisionReason || null;
    if (responsible !== undefined) updates.responsible = responsible || null;
    if (targetReductionPercent !== undefined) updates.targetReductionPercent = targetReductionPercent ? parseFloat(targetReductionPercent) : null;
    if (notes !== undefined) updates.notes = notes || null;

    if (hasOpportunity !== undefined) {
      const share = existingItem.consumptionSharePercent;
      const newHasOpp = !!hasOpportunity;
      const priority = computePriority(share, newHasOpp);
      updates.priorityResult = priority;
      updates.systemRecommendation = computeRecommendation(priority);
    }

    const [updated] = await db
      .update(seuAssessmentItemsTable)
      .set(updates)
      .where(eq(seuAssessmentItemsTable.id, itemId))
      .returning();
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── DELETE /seu/assessments/:id ──────────────────────────
router.delete("/seu/assessments/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);
    const [assessment] = await db
      .select()
      .from(seuAssessmentsTable)
      .where(and(eq(seuAssessmentsTable.id, id), eq(seuAssessmentsTable.companyId, sessionCompanyId)));
    if (!assessment) { res.status(404).send(); return; }
    if (role === "user" && assessment.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    if (role === "admin" && assessment.recordType === "unit_official") {
      res.status(403).json({ error: "Admin resmi kayıtları silemez" }); return;
    }
    await db.delete(seuAssessmentsTable).where(eq(seuAssessmentsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── GET /seu/decision-items ──────────────────────────────
// Normal kullanıcı için flat item listesi; hem analiz kaynaklı hem manuel itemları döner.
router.get("/seu/decision-items", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const year = req.query.year ? parseInt(req.query.year as string) : null;
    const unitIdFilter = req.query.unitId ? parseInt(req.query.unitId as string) : null;

    const recordTypeFilter = (req.query.recordType as string) || null;

    // ── Analiz kaynaklı kayıtlar ───────────────────────────
    const assessmentConds = [eq(seuAssessmentsTable.companyId, sessionCompanyId)];
    if (role === "user" && sessionUnitId !== null) {
      assessmentConds.push(eq(seuAssessmentsTable.unitId, sessionUnitId));
      assessmentConds.push(eq(seuAssessmentsTable.recordType, "unit_official"));
    } else if (role === "admin" || role === "superadmin") {
      if (unitIdFilter) assessmentConds.push(eq(seuAssessmentsTable.unitId, unitIdFilter));
      if (recordTypeFilter) assessmentConds.push(eq(seuAssessmentsTable.recordType, recordTypeFilter));
    }
    if (year) assessmentConds.push(eq(seuAssessmentsTable.year, year));

    const analysisRows = await db
      .select({
        itemId: seuAssessmentItemsTable.id,
        assessmentId: seuAssessmentItemsTable.assessmentId,
        name: seuAssessmentItemsTable.name,
        energyTep: seuAssessmentItemsTable.energyTep,
        consumptionSharePercent: seuAssessmentItemsTable.consumptionSharePercent,
        hasOpportunity: seuAssessmentItemsTable.hasOpportunity,
        priorityResult: seuAssessmentItemsTable.priorityResult,
        systemRecommendation: seuAssessmentItemsTable.systemRecommendation,
        userDecision: seuAssessmentItemsTable.userDecision,
        decisionReason: seuAssessmentItemsTable.decisionReason,
        responsible: seuAssessmentItemsTable.responsible,
        targetReductionPercent: seuAssessmentItemsTable.targetReductionPercent,
        notes: seuAssessmentItemsTable.notes,
        itemUpdatedAt: seuAssessmentItemsTable.updatedAt,
        assessmentYear: seuAssessmentsTable.year,
        periodStart: seuAssessmentsTable.periodStart,
        periodEnd: seuAssessmentsTable.periodEnd,
        analysisLevel: seuAssessmentsTable.analysisLevel,
        recordType: seuAssessmentsTable.recordType,
        unitTotalTep: seuAssessmentsTable.unitTotalTep,
        unitId: seuAssessmentsTable.unitId,
        unitName: unitsTable.name,
      })
      .from(seuAssessmentItemsTable)
      .innerJoin(seuAssessmentsTable, eq(seuAssessmentItemsTable.assessmentId, seuAssessmentsTable.id))
      .leftJoin(unitsTable, eq(seuAssessmentsTable.unitId, unitsTable.id))
      .where(and(...assessmentConds))
      .orderBy(desc(seuAssessmentsTable.year), desc(seuAssessmentItemsTable.consumptionSharePercent));

    // ── Manuel kayıtlar (seuTable) ─────────────────────────
    const manualConds = [eq(seuTable.companyId, sessionCompanyId)];
    if (role === "user" && sessionUnitId !== null) {
      manualConds.push(eq(seuTable.unitId, sessionUnitId));
    } else if ((role === "admin" || role === "superadmin") && unitIdFilter) {
      manualConds.push(eq(seuTable.unitId, unitIdFilter));
    }

    const manualRows = await db
      .select({
        id: seuTable.id,
        unitId: seuTable.unitId,
        name: seuTable.name,
        category: seuTable.category,
        annualKwh: seuTable.annualKwh,
        percentage: seuTable.percentage,
        priority: seuTable.priority,
        targetReductionPercent: seuTable.targetReductionPercent,
        responsible: seuTable.responsible,
        notes: seuTable.notes,
        createdAt: seuTable.createdAt,
        unitName: unitsTable.name,
      })
      .from(seuTable)
      .leftJoin(unitsTable, eq(seuTable.unitId, unitsTable.id))
      .where(and(...manualConds))
      .orderBy(seuTable.priority);

    // Normalize manual rows to the same shape as analysis rows
    const normalizedManual = manualRows.map(m => ({
      itemId: null as number | null,
      assessmentId: null as number | null,
      manualId: m.id,
      source: "manual" as const,
      name: m.name,
      energyTep: m.annualKwh,
      consumptionSharePercent: m.percentage,
      hasOpportunity: false,
      priorityResult: m.priority,
      systemRecommendation: "seu_candidate" as const,
      userDecision: null as string | null,
      decisionReason: null as string | null,
      responsible: m.responsible,
      targetReductionPercent: m.targetReductionPercent,
      notes: m.notes,
      itemUpdatedAt: m.createdAt,
      assessmentYear: null as number | null,
      periodStart: null as number | null,
      periodEnd: null as number | null,
      analysisLevel: "manual" as const,
      recordType: "unit_official",
      unitTotalTep: null as number | null,
      unitId: m.unitId,
      unitName: m.unitName,
      category: m.category,
    }));

    const normalizedAnalysis = analysisRows.map(r => ({
      ...r,
      manualId: null as number | null,
      source: "analysis" as const,
      category: null as string | null,
    }));

    res.json([...normalizedAnalysis, ...normalizedManual]);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── GET /seu/admin/unit-summary ───────────────────────────
// Admin için birim kıyaslama özeti
router.get("/seu/admin/unit-summary", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    if (role !== "admin" && role !== "superadmin") {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
    const recordTypeFilter = (req.query.recordType as string) || "all";

    // Tüm birimler
    const allUnits = await db
      .select({ id: unitsTable.id, name: unitsTable.name })
      .from(unitsTable)
      .where(eq(unitsTable.companyId, sessionCompanyId));

    // Assessments for the year
    const assessmentConds = [
      eq(seuAssessmentsTable.companyId, sessionCompanyId),
      eq(seuAssessmentsTable.year, year),
    ];
    if (recordTypeFilter !== "all") {
      assessmentConds.push(eq(seuAssessmentsTable.recordType, recordTypeFilter));
    }

    const assessments = await db
      .select({
        id: seuAssessmentsTable.id,
        unitId: seuAssessmentsTable.unitId,
        recordType: seuAssessmentsTable.recordType,
        unitTotalTep: seuAssessmentsTable.unitTotalTep,
        analysisLevel: seuAssessmentsTable.analysisLevel,
        createdAt: seuAssessmentsTable.createdAt,
        updatedAt: seuAssessmentsTable.updatedAt,
      })
      .from(seuAssessmentsTable)
      .where(and(...assessmentConds))
      .orderBy(desc(seuAssessmentsTable.createdAt));

    const assessmentIds = assessments.map(a => a.id);

    // Item counts per assessment
    let itemDetails: Record<number, { total: number; seu: number; monitor: number; notSeu: number; topName: string | null; topShare: number }> = {};
    if (assessmentIds.length > 0) {
      const counts = await db
        .select({
          assessmentId: seuAssessmentItemsTable.assessmentId,
          total: sql<number>`COUNT(*)`,
          seu: sql<number>`SUM(CASE WHEN ${seuAssessmentItemsTable.userDecision} = 'accepted_as_seu' THEN 1 ELSE 0 END)`,
          monitor: sql<number>`SUM(CASE WHEN ${seuAssessmentItemsTable.userDecision} = 'monitor' THEN 1 ELSE 0 END)`,
          notSeu: sql<number>`SUM(CASE WHEN ${seuAssessmentItemsTable.userDecision} = 'not_seu' THEN 1 ELSE 0 END)`,
        })
        .from(seuAssessmentItemsTable)
        .where(inArray(seuAssessmentItemsTable.assessmentId, assessmentIds))
        .groupBy(seuAssessmentItemsTable.assessmentId);

      const topItems = await db
        .select({
          assessmentId: seuAssessmentItemsTable.assessmentId,
          name: seuAssessmentItemsTable.name,
          share: seuAssessmentItemsTable.consumptionSharePercent,
        })
        .from(seuAssessmentItemsTable)
        .where(inArray(seuAssessmentItemsTable.assessmentId, assessmentIds))
        .orderBy(desc(seuAssessmentItemsTable.consumptionSharePercent));

      const topByAssessment: Record<number, { name: string; share: number }> = {};
      for (const t of topItems) {
        if (!topByAssessment[t.assessmentId]) {
          topByAssessment[t.assessmentId] = { name: t.name, share: Number(t.share) || 0 };
        }
      }

      itemDetails = Object.fromEntries(counts.map(c => [
        c.assessmentId,
        {
          total: Number(c.total) || 0,
          seu: Number(c.seu) || 0,
          monitor: Number(c.monitor) || 0,
          notSeu: Number(c.notSeu) || 0,
          topName: topByAssessment[c.assessmentId]?.name ?? null,
          topShare: topByAssessment[c.assessmentId]?.share ?? 0,
        },
      ]));
    }

    // Manual items per unit
    const manualRows = await db
      .select({
        unitId: seuTable.unitId,
        count: sql<number>`COUNT(*)`,
      })
      .from(seuTable)
      .where(eq(seuTable.companyId, sessionCompanyId))
      .groupBy(seuTable.unitId);
    const manualCountByUnit: Record<number, number> = Object.fromEntries(
      manualRows.map(r => [r.unitId, Number(r.count) || 0])
    );

    // Group assessments by unit
    const byUnit: Record<number, typeof assessments> = {};
    for (const a of assessments) {
      if (!a.unitId) continue;
      if (!byUnit[a.unitId]) byUnit[a.unitId] = [];
      byUnit[a.unitId].push(a);
    }

    // Company total TEP (from official assessments this year)
    const officialAssessments = assessments.filter(a => a.recordType === "unit_official");
    const officialByUnit: Record<number, (typeof assessments)[0]> = {};
    for (const a of officialAssessments) {
      if (!a.unitId) continue;
      if (!officialByUnit[a.unitId] || a.createdAt > officialByUnit[a.unitId].createdAt) {
        officialByUnit[a.unitId] = a;
      }
    }
    const companyTotalTep = Object.values(officialByUnit).reduce((s, a) => s + (a.unitTotalTep || 0), 0);

    const unitSummaries = allUnits.map(unit => {
      const unitAssessments = byUnit[unit.id] ?? [];

      // Latest per analysisLevel (for distinct views)
      const latestByLevel: Record<string, (typeof assessments)[0]> = {};
      for (const a of unitAssessments) {
        const key = `${a.analysisLevel}-${a.recordType}`;
        if (!latestByLevel[key] || a.createdAt > latestByLevel[key].createdAt) {
          latestByLevel[key] = a;
        }
      }
      const latestAssessments = Object.values(latestByLevel);

      const hasOfficialAssessment = unitAssessments.some(a => a.recordType === "unit_official");
      const officialAssessment = officialByUnit[unit.id];
      const unitTotalTep = officialAssessment?.unitTotalTep ?? 0;
      const companySharePercent = companyTotalTep > 0 ? Math.round((unitTotalTep / companyTotalTep) * 10000) / 100 : 0;

      const totalItems = latestAssessments.reduce((s, a) => s + (itemDetails[a.id]?.total ?? 0), 0);
      const seuCount = latestAssessments.reduce((s, a) => s + (itemDetails[a.id]?.seu ?? 0), 0);
      const monitorCount = latestAssessments.reduce((s, a) => s + (itemDetails[a.id]?.monitor ?? 0), 0);
      const notSeuCount = latestAssessments.reduce((s, a) => s + (itemDetails[a.id]?.notSeu ?? 0), 0);
      const manualCount = manualCountByUnit[unit.id] ?? 0;

      // Top energy group from official assessment
      const officialItems = officialAssessment ? itemDetails[officialAssessment.id] : null;
      const topGroupName = officialItems?.topName ?? null;
      const topGroupShare = officialItems?.topShare ?? 0;

      const lastUpdatedAt = latestAssessments.length > 0
        ? latestAssessments.map(a => a.updatedAt).sort((a, b) => b > a ? 1 : -1)[0]
        : null;

      return {
        unitId: unit.id,
        unitName: unit.name,
        unitTotalTep,
        companySharePercent,
        hasOfficialAssessment,
        totalItems,
        seuCount,
        monitorCount,
        notSeuCount,
        manualCount,
        topGroupName,
        topGroupShare,
        lastUpdatedAt,
        assessmentCount: unitAssessments.length,
      };
    });

    res.json({
      year,
      companyTotalTep,
      units: unitSummaries.sort((a, b) => b.unitTotalTep - a.unitTotalTep),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── GET /seu/admin/unit-detail/:unitId ────────────────────
// Admin için birim item detayları
router.get("/seu/admin/unit-detail/:unitId", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    if (role !== "admin" && role !== "superadmin") {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    const unitId = parseInt(req.params.unitId as string);
    const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();

    // Official assessments for this unit/year
    const assessments = await db
      .select()
      .from(seuAssessmentsTable)
      .where(and(
        eq(seuAssessmentsTable.companyId, sessionCompanyId),
        eq(seuAssessmentsTable.unitId, unitId),
        eq(seuAssessmentsTable.year, year),
        eq(seuAssessmentsTable.recordType, "unit_official"),
      ))
      .orderBy(desc(seuAssessmentsTable.createdAt));

    const assessmentIds = assessments.map(a => a.id);
    let analysisItems: any[] = [];
    if (assessmentIds.length > 0) {
      analysisItems = await db
        .select()
        .from(seuAssessmentItemsTable)
        .where(inArray(seuAssessmentItemsTable.assessmentId, assessmentIds))
        .orderBy(desc(seuAssessmentItemsTable.consumptionSharePercent));
    }

    // Manual items for this unit
    const manualItems = await db
      .select()
      .from(seuTable)
      .where(and(eq(seuTable.companyId, sessionCompanyId), eq(seuTable.unitId, unitId)))
      .orderBy(seuTable.priority);

    res.json({
      unitId,
      year,
      analysisItems: analysisItems.map(i => ({ ...i, source: "analysis" })),
      manualItems: manualItems.map(i => ({
        id: i.id,
        name: i.name,
        energyTep: i.annualKwh,
        consumptionSharePercent: i.percentage,
        hasOpportunity: false,
        priorityResult: i.priority,
        userDecision: null,
        decisionReason: null,
        responsible: i.responsible,
        targetReductionPercent: i.targetReductionPercent,
        notes: i.notes,
        source: "manual",
      })),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
