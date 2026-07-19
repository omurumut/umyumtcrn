import { and, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import { db, unitTechnicalProfileSnapshotsTable } from "@workspace/db";

export async function resolvePublishedUnitTechnicalProfileSnapshotForDate({
  companyId,
  unitId,
  effectiveDate,
}: {
  companyId: number;
  unitId: number;
  effectiveDate: string;
}) {
  const [snapshot] = await db.select()
    .from(unitTechnicalProfileSnapshotsTable)
    .where(and(
      eq(unitTechnicalProfileSnapshotsTable.companyId, companyId),
      eq(unitTechnicalProfileSnapshotsTable.unitId, unitId),
      lte(unitTechnicalProfileSnapshotsTable.validFrom, effectiveDate),
      or(isNull(unitTechnicalProfileSnapshotsTable.validTo), gt(unitTechnicalProfileSnapshotsTable.validTo, effectiveDate)),
    ))
    .orderBy(desc(unitTechnicalProfileSnapshotsTable.validFrom))
    .limit(1);
  return snapshot ?? null;
}
