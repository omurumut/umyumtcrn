import { Router } from "express";
import { db, vapProjectsTable, energyActionPlansTable, energyTargetsTable, energySourcesTable, unitsTable } from "@workspace/db";
import { eq, and, SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

// GET /api/vap-projects
router.get("/vap-projects", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;

    const rows = await db
      .select({
        id: vapProjectsTable.id,
        companyId: vapProjectsTable.companyId,
        actionPlanId: vapProjectsTable.actionPlanId,
        projectCode: vapProjectsTable.projectCode,
        projectTitle: vapProjectsTable.projectTitle,
        projectType: vapProjectsTable.projectType,
        currentSituation: vapProjectsTable.currentSituation,
        proposedSolution: vapProjectsTable.proposedSolution,
        technicalDescription: vapProjectsTable.technicalDescription,
        annualEnergySavingValue: vapProjectsTable.annualEnergySavingValue,
        annualEnergySavingUnit: vapProjectsTable.annualEnergySavingUnit,
        annualCostSaving: vapProjectsTable.annualCostSaving,
        investmentCost: vapProjectsTable.investmentCost,
        paybackMonths: vapProjectsTable.paybackMonths,
        co2ReductionTon: vapProjectsTable.co2ReductionTon,
        measurementVerificationMethod: vapProjectsTable.measurementVerificationMethod,
        incentiveStatus: vapProjectsTable.incentiveStatus,
        feasibilityStatus: vapProjectsTable.feasibilityStatus,
        startDate: vapProjectsTable.startDate,
        endDate: vapProjectsTable.endDate,
        status: vapProjectsTable.status,
        notes: vapProjectsTable.notes,
        createdBy: vapProjectsTable.createdBy,
        createdAt: vapProjectsTable.createdAt,
        updatedAt: vapProjectsTable.updatedAt,
        actionPlanTitle: energyActionPlansTable.title,
        actionPlanStatus: energyActionPlansTable.status,
        targetId: energyActionPlansTable.targetId,
        targetName: energyTargetsTable.name,
        targetUnitId: energyTargetsTable.unitId,
        targetEnergySourceId: energyTargetsTable.energySourceId,
      })
      .from(vapProjectsTable)
      .leftJoin(energyActionPlansTable, eq(vapProjectsTable.actionPlanId, energyActionPlansTable.id))
      .leftJoin(energyTargetsTable, eq(energyActionPlansTable.targetId, energyTargetsTable.id))
      .where(eq(vapProjectsTable.companyId, sessionCompanyId))
      .orderBy(vapProjectsTable.createdAt);

    const filtered =
      role !== "admin" && role !== "superadmin" && sessionUnitId !== null
        ? rows.filter((r) => r.targetUnitId === sessionUnitId)
        : rows;

    res.json(filtered);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/vap-projects
router.post("/vap-projects", requireAuth, async (req, res) => {
  try {
    const { companyId: sessionCompanyId, unitId: sessionUnitId, role, name: userName } = req.user!;
    const { actionPlanId, projectCode, projectTitle, projectType, currentSituation, proposedSolution,
      technicalDescription, annualEnergySavingValue, annualEnergySavingUnit, annualCostSaving,
      investmentCost, paybackMonths, co2ReductionTon, measurementVerificationMethod,
      incentiveStatus, feasibilityStatus, startDate, endDate, status, notes } = req.body;

    if (!actionPlanId || !projectTitle) {
      res.status(400).json({ error: "Eylem planı ve proje başlığı zorunludur" }); return;
    }

    const [ap] = await db.select({ id: energyActionPlansTable.id, companyId: energyActionPlansTable.companyId, isVap: energyActionPlansTable.isVap, targetId: energyActionPlansTable.targetId })
      .from(energyActionPlansTable).where(eq(energyActionPlansTable.id, parseInt(actionPlanId)));
    if (!ap || ap.companyId !== sessionCompanyId) {
      res.status(403).json({ error: "Geçersiz eylem planı" }); return;
    }
    if (!ap.isVap) {
      res.status(400).json({ error: "Eylem planı VAP olarak işaretlenmemiş" }); return;
    }
    if (role !== "admin" && role !== "superadmin" && sessionUnitId !== null) {
      const [target] = await db.select({ unitId: energyTargetsTable.unitId }).from(energyTargetsTable).where(eq(energyTargetsTable.id, ap.targetId));
      if (target?.unitId !== sessionUnitId) { res.status(403).json({ error: "Yetki yok" }); return; }
    }

    const parseOrNull = (v: any) => (v !== undefined && v !== null && v !== "") ? parseFloat(v) : null;

    const [item] = await db.insert(vapProjectsTable).values({
      companyId: sessionCompanyId,
      actionPlanId: parseInt(actionPlanId),
      projectCode: projectCode || null,
      projectTitle,
      projectType: projectType || null,
      currentSituation: currentSituation || null,
      proposedSolution: proposedSolution || null,
      technicalDescription: technicalDescription || null,
      annualEnergySavingValue: parseOrNull(annualEnergySavingValue),
      annualEnergySavingUnit: annualEnergySavingUnit || null,
      annualCostSaving: parseOrNull(annualCostSaving),
      investmentCost: parseOrNull(investmentCost),
      paybackMonths: parseOrNull(paybackMonths),
      co2ReductionTon: parseOrNull(co2ReductionTon),
      measurementVerificationMethod: measurementVerificationMethod || null,
      incentiveStatus: incentiveStatus || "none",
      feasibilityStatus: feasibilityStatus || "not_started",
      startDate: startDate || null,
      endDate: endDate || null,
      status: status || "idea",
      notes: notes || null,
      createdBy: userName,
    }).returning();
    res.status(201).json(item);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PUT /api/vap-projects/:id
router.put("/vap-projects/:id", requireAuth, async (req, res) => {
  try {
    const { companyId: sessionCompanyId } = req.user!;
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(vapProjectsTable).where(eq(vapProjectsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Bulunamadı" }); return; }
    if (existing.companyId !== sessionCompanyId) { res.status(403).json({ error: "Yetki yok" }); return; }

    const { projectCode, projectTitle, projectType, currentSituation, proposedSolution,
      technicalDescription, annualEnergySavingValue, annualEnergySavingUnit, annualCostSaving,
      investmentCost, paybackMonths, co2ReductionTon, measurementVerificationMethod,
      incentiveStatus, feasibilityStatus, startDate, endDate, status, notes } = req.body;

    const parseOrNull = (v: any) => (v !== undefined && v !== null && v !== "") ? parseFloat(v) : null;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (projectCode !== undefined) updates.projectCode = projectCode || null;
    if (projectTitle !== undefined) updates.projectTitle = projectTitle;
    if (projectType !== undefined) updates.projectType = projectType || null;
    if (currentSituation !== undefined) updates.currentSituation = currentSituation || null;
    if (proposedSolution !== undefined) updates.proposedSolution = proposedSolution || null;
    if (technicalDescription !== undefined) updates.technicalDescription = technicalDescription || null;
    if (annualEnergySavingValue !== undefined) updates.annualEnergySavingValue = parseOrNull(annualEnergySavingValue);
    if (annualEnergySavingUnit !== undefined) updates.annualEnergySavingUnit = annualEnergySavingUnit || null;
    if (annualCostSaving !== undefined) updates.annualCostSaving = parseOrNull(annualCostSaving);
    if (investmentCost !== undefined) updates.investmentCost = parseOrNull(investmentCost);
    if (paybackMonths !== undefined) updates.paybackMonths = parseOrNull(paybackMonths);
    if (co2ReductionTon !== undefined) updates.co2ReductionTon = parseOrNull(co2ReductionTon);
    if (measurementVerificationMethod !== undefined) updates.measurementVerificationMethod = measurementVerificationMethod || null;
    if (incentiveStatus !== undefined) updates.incentiveStatus = incentiveStatus;
    if (feasibilityStatus !== undefined) updates.feasibilityStatus = feasibilityStatus;
    if (startDate !== undefined) updates.startDate = startDate || null;
    if (endDate !== undefined) updates.endDate = endDate || null;
    if (status !== undefined) updates.status = status;
    if (notes !== undefined) updates.notes = notes || null;

    const [item] = await db.update(vapProjectsTable).set(updates).where(eq(vapProjectsTable.id, id)).returning();
    res.json(item);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/vap-projects/:id
router.delete("/vap-projects/:id", requireAuth, async (req, res) => {
  try {
    const { companyId: sessionCompanyId } = req.user!;
    const id = parseInt(req.params.id as string);
    const [existing] = await db.select().from(vapProjectsTable).where(eq(vapProjectsTable.id, id));
    if (!existing) { res.status(404).send(); return; }
    if (existing.companyId !== sessionCompanyId) { res.status(403).json({ error: "Yetki yok" }); return; }
    await db.delete(vapProjectsTable).where(eq(vapProjectsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
