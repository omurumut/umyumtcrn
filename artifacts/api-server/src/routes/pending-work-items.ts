import { Router } from "express";
import {
  db,
  consumptionTable,
  energyActionPlansTable,
  energyTargetsTable,
  metersTable,
  unitsTable,
} from "@workspace/db";
import { and, eq, type SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

type PendingWorkItemSeverity = "info" | "warning" | "critical";

interface PendingWorkItem {
  id: string;
  type: string;
  severity: PendingWorkItemSeverity;
  title: string;
  description: string;
  sourceModule: string;
  sourceRecordId: number | null;
  unitId: number | null;
  unitName: string | null;
  dueDate: string | null;
  actionUrl: string | null;
}

interface MissingConsumptionGroup {
  unitId: number | null;
  unitName: string | null;
  meterNames: string[];
}

const ACTION_PLAN_COMPLETED_STATUSES = new Set(["completed", "cancelled"]);
const severityOrder: Record<PendingWorkItemSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function parseOptionalInt(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toDateOnlyString(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDateOnly(value: string | null): string | null {
  if (!value) return null;
  const dateOnly = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly : null;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getPreviousMonthPeriod(now = new Date()) {
  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return {
    year: previousMonth.getFullYear(),
    month: previousMonth.getMonth() + 1,
  };
}

function formatPeriod(year: number, month: number): string {
  return `${year}/${`${month}`.padStart(2, "0")}`;
}

function isIncompleteActionPlan(row: {
  status: string;
  completionDate: string | null;
  progressPercent: number;
}): boolean {
  if (ACTION_PLAN_COMPLETED_STATUSES.has(row.status)) return false;
  if (row.completionDate) return false;
  return row.progressPercent < 100;
}

function buildWhere(conditions: SQL[]) {
  return conditions.length === 1 ? conditions[0] : and(...conditions);
}

// GET /api/pending-work-items
router.get("/pending-work-items", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const isAdmin = role === "admin" || role === "kontrol_admin" || role === "superadmin";

    if (!isAdmin && sessionUnitId === null) {
      res.json([]);
      return;
    }

    const requestedUnitId = parseOptionalInt(req.query.unitId);
    const effectiveUnitId = isAdmin ? requestedUnitId : sessionUnitId ?? undefined;

    const today = new Date();
    const todayDateOnly = toDateOnlyString(today);
    const soonLimitDateOnly = toDateOnlyString(addDays(today, 7));
    const items: PendingWorkItem[] = [];

    const actionConditions: SQL[] = [eq(energyActionPlansTable.companyId, sessionCompanyId)];
    if (effectiveUnitId !== undefined) {
      actionConditions.push(eq(energyTargetsTable.unitId, effectiveUnitId));
    }

    const actionPlans = await db
      .select({
        id: energyActionPlansTable.id,
        targetId: energyActionPlansTable.targetId,
        title: energyActionPlansTable.title,
        status: energyActionPlansTable.status,
        completionDate: energyActionPlansTable.completionDate,
        progressPercent: energyActionPlansTable.progressPercent,
        dueDate: energyActionPlansTable.dueDate,
        targetName: energyTargetsTable.name,
        unitId: energyTargetsTable.unitId,
        unitName: unitsTable.name,
      })
      .from(energyActionPlansTable)
      .innerJoin(energyTargetsTable, eq(energyActionPlansTable.targetId, energyTargetsTable.id))
      .leftJoin(unitsTable, eq(energyTargetsTable.unitId, unitsTable.id))
      .where(buildWhere(actionConditions));

    for (const plan of actionPlans) {
      if (!isIncompleteActionPlan(plan)) continue;

      const dueDate = normalizeDateOnly(plan.dueDate);
      if (!dueDate) continue;

      if (dueDate < todayDateOnly) {
        items.push({
          id: `energy-action-plan-overdue-${plan.id}`,
          type: "energy_action_plan_overdue",
          severity: "critical",
          title: `Geciken aksiyon planı: ${plan.title}`,
          description: `${plan.targetName ?? "Enerji hedefi"} kapsamındaki aksiyon planının termin tarihi geçti.`,
          sourceModule: "Enerji Aksiyon Planları",
          sourceRecordId: plan.id,
          unitId: plan.unitId,
          unitName: plan.unitName,
          dueDate,
          actionUrl: `/hedefler?targetId=${plan.targetId}&actionPlanId=${plan.id}`,
        });
      } else if (dueDate <= soonLimitDateOnly) {
        items.push({
          id: `energy-action-plan-due-soon-${plan.id}`,
          type: "energy_action_plan_due_soon",
          severity: "warning",
          title: `Yaklaşan aksiyon planı termin tarihi: ${plan.title}`,
          description: `${plan.targetName ?? "Enerji hedefi"} kapsamındaki aksiyon planının termin tarihi 7 gün içinde.`,
          sourceModule: "Enerji Aksiyon Planları",
          sourceRecordId: plan.id,
          unitId: plan.unitId,
          unitName: plan.unitName,
          dueDate,
          actionUrl: `/hedefler?targetId=${plan.targetId}&actionPlanId=${plan.id}`,
        });
      }
    }

    const previousPeriod = getPreviousMonthPeriod(today);
    const meterConditions: SQL[] = [eq(metersTable.companyId, sessionCompanyId)];
    if (effectiveUnitId !== undefined) {
      meterConditions.push(eq(metersTable.unitId, effectiveUnitId));
    }

    const meters = await db
      .select({
        id: metersTable.id,
        name: metersTable.name,
        unitId: metersTable.unitId,
        unitName: unitsTable.name,
      })
      .from(metersTable)
      .leftJoin(unitsTable, eq(metersTable.unitId, unitsTable.id))
      .where(buildWhere(meterConditions));

    const consumptionRecords = await db
      .select({ meterId: consumptionTable.meterId })
      .from(consumptionTable)
      .where(and(
        eq(consumptionTable.companyId, sessionCompanyId),
        eq(consumptionTable.year, previousPeriod.year),
        eq(consumptionTable.month, previousPeriod.month),
      ));
    const metersWithConsumption = new Set(consumptionRecords.map((record) => record.meterId));
    const periodLabel = formatPeriod(previousPeriod.year, previousPeriod.month);

    const missingConsumptionGroups = new Map<string, MissingConsumptionGroup>();

    for (const meter of meters) {
      if (metersWithConsumption.has(meter.id)) continue;

      const groupKey = `${previousPeriod.year}-${previousPeriod.month}-${meter.unitId ?? "none"}`;
      const group = missingConsumptionGroups.get(groupKey) ?? {
        unitId: meter.unitId,
        unitName: meter.unitName,
        meterNames: [],
      };
      group.meterNames.push(meter.name);
      missingConsumptionGroups.set(groupKey, group);
    }

    for (const [groupKey, group] of missingConsumptionGroups) {
      const params = new URLSearchParams({
        year: String(previousPeriod.year),
        month: String(previousPeriod.month),
      });
      if (group.unitId !== null) {
        params.set("unitId", String(group.unitId));
      }

      const meterCount = group.meterNames.length;
      const sortedMeterNames = [...group.meterNames].sort((a, b) => a.localeCompare(b, "tr"));

      items.push({
        id: `missing-consumption-${groupKey}`,
        type: "missing_consumption_previous_month",
        severity: "warning",
        title: `${periodLabel} döneminde ${meterCount} sayaç için tüketim verisi eksik`,
        description: `Eksik sayaçlar: ${sortedMeterNames.join(", ")}.`,
        sourceModule: "Tüketim Verileri",
        sourceRecordId: null,
        unitId: group.unitId,
        unitName: group.unitName,
        dueDate: null,
        actionUrl: `/tuketim?${params.toString()}`,
      });
    }

    items.sort((a, b) => {
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (severityDiff !== 0) return severityDiff;
      if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate && !b.dueDate) return -1;
      if (!a.dueDate && b.dueDate) return 1;
      return a.title.localeCompare(b.title, "tr");
    });

    res.json(items);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
