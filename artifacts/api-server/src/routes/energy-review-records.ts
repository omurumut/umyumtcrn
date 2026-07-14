import { Router } from "express";
import type { Request, Response } from "express";
import { db, companiesTable, energyReviewRecordsTable, unitsTable, usersTable } from "@workspace/db";
import { eq, and, type SQL, desc, isNull, ne } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

const PERIOD_TYPES = ["annual", "semi_annual", "custom"];
const SCOPE_TYPES = ["company", "unit"];
const DUPLICATE_REVIEW_RECORD_ERROR = "Bu dönem ve kapsam için zaten bir enerji gözden geçirme kaydı var.";

class ReviewScopeError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type ReviewScope = {
  companyId: number;
  unitId?: number;
  standard: boolean;
  empty: boolean;
};

function isCompanyAdmin(role: string) {
  return role === "admin" || role === "kontrol_admin";
}

function isSuperAdmin(role: string) {
  return role === "superadmin";
}

function isPrivileged(role: string) {
  return isCompanyAdmin(role) || isSuperAdmin(role);
}

function parsePositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new ReviewScopeError(400, `Geçersiz ${field}`);
}

function parseReviewYear(value: unknown, field = "reviewYear"): number | undefined {
  const year = parsePositiveInteger(value, field);
  if (year !== undefined && (year < 1900 || year > 3000)) {
    throw new ReviewScopeError(400, `Geçersiz ${field}`);
  }
  return year;
}

function getBodyValue(req: Request, field: string): unknown {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) return undefined;
  return (req.body as Record<string, unknown>)[field];
}

function parseMatchingValue(
  bodyValue: unknown,
  queryValue: unknown,
  field: string,
  parser: (value: unknown, field: string) => number | undefined = parsePositiveInteger,
) {
  const bodyParsed = parser(bodyValue, field);
  const queryParsed = parser(queryValue, field);
  if (bodyParsed !== undefined && queryParsed !== undefined && bodyParsed !== queryParsed) {
    throw new ReviewScopeError(400, `Body ve query ${field} değerleri uyuşmuyor`);
  }
  return bodyParsed ?? queryParsed;
}

function parseRequestReviewYear(req: Request): number | undefined {
  const bodyYear = parseReviewYear(getBodyValue(req, "reviewYear"));
  const queryReviewYear = parseReviewYear(req.query.reviewYear);
  const queryYear = parseReviewYear(req.query.year, "year");
  if (queryReviewYear !== undefined && queryYear !== undefined && queryReviewYear !== queryYear) {
    throw new ReviewScopeError(400, "year ve reviewYear değerleri uyuşmuyor");
  }
  const queryValue = queryReviewYear ?? queryYear;
  if (bodyYear !== undefined && queryValue !== undefined && bodyYear !== queryValue) {
    throw new ReviewScopeError(400, "Body ve query reviewYear değerleri uyuşmuyor");
  }
  return bodyYear ?? queryValue;
}

async function validateUnitScope(unitId: number, companyId: number) {
  const [unit] = await db.select({ companyId: unitsTable.companyId })
    .from(unitsTable).where(eq(unitsTable.id, unitId)).limit(1);
  if (!unit) throw new ReviewScopeError(404, "Birim bulunamadı");
  if (unit.companyId !== companyId) throw new ReviewScopeError(403, "Bu birim şirketinize ait değil");
}

async function resolveReviewScope(
  req: Request,
  standardNullPolicy: "empty" | "forbid",
  includeBodyUnit = false,
): Promise<ReviewScope> {
  const { role, companyId: sessionCompanyIdValue, unitId: sessionUnitIdValue } = req.user!;
  const requestedCompanyId = parseMatchingValue(
    getBodyValue(req, "companyId"),
    req.query.companyId,
    "companyId",
  );
  const requestedUnitId = parseMatchingValue(
    includeBodyUnit ? getBodyValue(req, "unitId") : undefined,
    req.query.unitId,
    "unitId",
  );
  const sessionCompanyId = parsePositiveInteger(sessionCompanyIdValue, "companyId");
  if (sessionCompanyId === undefined) throw new ReviewScopeError(400, "Geçersiz companyId");

  const companyId = isSuperAdmin(role) ? (requestedCompanyId ?? sessionCompanyId) : sessionCompanyId;
  const [company] = await db.select({ id: companiesTable.id })
    .from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  if (!company) throw new ReviewScopeError(404, "Şirket bulunamadı");

  const standard = !isPrivileged(role);
  let unitId: number | undefined;
  if (standard) {
    unitId = parsePositiveInteger(sessionUnitIdValue, "unitId");
    if (unitId === undefined) {
      if (standardNullPolicy === "forbid") {
        throw new ReviewScopeError(403, "Birim yetkisi gerekli");
      }
      return { companyId, standard, empty: true };
    }
  } else {
    unitId = requestedUnitId;
  }

  if (unitId !== undefined) await validateUnitScope(unitId, companyId);
  return { companyId, unitId, standard, empty: false };
}

function recordConditions(scope: ReviewScope, id?: number): SQL[] {
  const conditions: SQL[] = [eq(energyReviewRecordsTable.companyId, scope.companyId)];
  if (id !== undefined) conditions.unshift(eq(energyReviewRecordsTable.id, id));
  if (scope.unitId !== undefined) conditions.push(eq(energyReviewRecordsTable.unitId, scope.unitId));
  return conditions;
}

function handleReviewScopeError(res: Response, err: unknown) {
  if (!(err instanceof ReviewScopeError)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

function shouldIncludeDeleted(role: string, includeDeleted: unknown) {
  return isPrivileged(role) && includeDeleted === "true";
}

async function hasActiveDuplicateReviewRecord(params: {
  companyId: number;
  reviewYear: number;
  periodType: string;
  scopeType: string;
  unitId: number | null;
  excludeId?: number;
}) {
  const conditions: SQL[] = [
    eq(energyReviewRecordsTable.companyId, params.companyId),
    eq(energyReviewRecordsTable.reviewYear, params.reviewYear),
    eq(energyReviewRecordsTable.periodType, params.periodType),
    eq(energyReviewRecordsTable.scopeType, params.scopeType),
    isNull(energyReviewRecordsTable.deletedAt),
  ];

  if (params.scopeType === "company") {
    conditions.push(isNull(energyReviewRecordsTable.unitId));
  } else {
    if (params.unitId === null) return false;
    conditions.push(eq(energyReviewRecordsTable.unitId, params.unitId));
  }

  if (params.excludeId !== undefined) {
    conditions.push(ne(energyReviewRecordsTable.id, params.excludeId));
  }

  const [duplicate] = await db
    .select({ id: energyReviewRecordsTable.id })
    .from(energyReviewRecordsTable)
    .where(and(...conditions))
    .limit(1);

  return duplicate !== undefined;
}

function validateDates(periodStart: string, periodEnd: string, reviewYear: number): string | null {
  if (Number.isNaN(Date.parse(periodStart)) || Number.isNaN(Date.parse(periodEnd))) {
    return "Geçersiz tarih formatı";
  }
  if (periodStart > periodEnd) {
    return "Başlangıç tarihi bitiş tarihinden sonra olamaz";
  }
  const startYearMatch = /^(\d{4})-/.exec(periodStart);
  if (!startYearMatch || Number(startYearMatch[1]) !== reviewYear) {
    return "Gözden geçirme yılı, başlangıç tarihi yılı ile uyumlu olmalı";
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/energy-review-records
// ─────────────────────────────────────────────────────────────────────────────
router.get("/energy-review-records", requireAuth, async (req, res) => {
  try {
    const { role } = req.user!;
    const yearParam = parseRequestReviewYear(req);
    const scope = await resolveReviewScope(req, "empty");
    if (scope.empty) {
      res.json([]);
      return;
    }

    const conditions = recordConditions(scope);
    const includeDeleted = shouldIncludeDeleted(role, req.query.includeDeleted);

    if (!includeDeleted) {
      conditions.push(isNull(energyReviewRecordsTable.deletedAt));
    }

    if (yearParam !== undefined) conditions.push(eq(energyReviewRecordsTable.reviewYear, yearParam));

    const statusParam = typeof req.query.status === "string" ? req.query.status : undefined;
    if (statusParam) conditions.push(eq(energyReviewRecordsTable.status, statusParam));

    const scopeTypeParam = typeof req.query.scopeType === "string" ? req.query.scopeType : undefined;
    if (scopeTypeParam && !SCOPE_TYPES.includes(scopeTypeParam)) {
      throw new ReviewScopeError(400, "Geçersiz scopeType");
    }
    if (scopeTypeParam) conditions.push(eq(energyReviewRecordsTable.scopeType, scopeTypeParam));

    const rows = await db
      .select({
        record: energyReviewRecordsTable,
        unitName: unitsTable.name,
        preparedByName: usersTable.name,
      })
      .from(energyReviewRecordsTable)
      .leftJoin(unitsTable, and(
        eq(energyReviewRecordsTable.unitId, unitsTable.id),
        eq(unitsTable.companyId, scope.companyId),
      ))
      .leftJoin(usersTable, and(
        eq(energyReviewRecordsTable.preparedByUserId, usersTable.id),
        eq(usersTable.companyId, scope.companyId),
      ))
      .where(and(...conditions))
      .orderBy(desc(energyReviewRecordsTable.createdAt));

    const result = rows.map((r) => ({
      ...r.record,
      unitName: r.unitName ?? null,
      preparedByName: r.preparedByName ?? null,
    }));

    res.json(result);
  } catch (err) {
    if (handleReviewScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/energy-review-records/:id
// ─────────────────────────────────────────────────────────────────────────────
router.get("/energy-review-records/:id", requireAuth, async (req, res) => {
  try {
    const { role } = req.user!;
    const id = parsePositiveInteger(req.params.id, "id");
    if (id === undefined) throw new ReviewScopeError(400, "Geçersiz id");
    const scope = await resolveReviewScope(req, "forbid");
    const includeDeleted = shouldIncludeDeleted(role, req.query.includeDeleted);
    const conditions = recordConditions(scope, id);
    if (!includeDeleted) conditions.push(isNull(energyReviewRecordsTable.deletedAt));

    const [existing] = await db.select().from(energyReviewRecordsTable).where(and(...conditions));
    if (!existing) {
      res.status(404).json({ error: "Bulunamadı" });
      return;
    }

    res.json(existing);
  } catch (err) {
    if (handleReviewScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/energy-review-records
// ─────────────────────────────────────────────────────────────────────────────
router.post("/energy-review-records", requireAuth, async (req, res) => {
  try {
    const { userId } = req.user!;
    const scope = await resolveReviewScope(req, "forbid", true);
    const {
      reviewName, periodType, periodStart, periodEnd,
      scopeType, generalNotes,
    } = req.body;
    const reviewYear = parseRequestReviewYear(req);

    if (!reviewName || reviewYear === undefined || typeof periodStart !== "string" || typeof periodEnd !== "string") {
      res.status(400).json({ error: "Zorunlu alanlar eksik" });
      return;
    }
    if (periodType !== undefined && !PERIOD_TYPES.includes(periodType)) {
      throw new ReviewScopeError(400, "Geçersiz periodType");
    }
    if (scopeType !== undefined && !SCOPE_TYPES.includes(scopeType)) {
      throw new ReviewScopeError(400, "Geçersiz scopeType");
    }

    const resolvedPeriodType = periodType && PERIOD_TYPES.includes(periodType) ? periodType : "annual";
    let resolvedScopeType: string;
    let resolvedUnitId: number | null;

    if (scope.standard) {
      // Standart kullanıcı: yalnızca kendi birimi için, scope her zaman "unit"
      if (scopeType === "company") {
        res.status(403).json({ error: "Kuruluş kapsamlı kayıt oluşturma yetkiniz yok" });
        return;
      }
      resolvedScopeType = "unit";
      resolvedUnitId = scope.unitId!;
    } else {
      resolvedScopeType = scopeType && SCOPE_TYPES.includes(scopeType) ? scopeType : "unit";
      if (resolvedScopeType === "unit") {
        if (scope.unitId === undefined) {
          res.status(400).json({ error: "Birim kapsamlı kayıt için birim seçilmeli" });
          return;
        }
        resolvedUnitId = scope.unitId;
      } else {
        resolvedUnitId = null;
      }
    }

    const dateError = validateDates(periodStart, periodEnd, reviewYear);
    if (dateError) {
      res.status(400).json({ error: dateError });
      return;
    }

    const hasDuplicate = await hasActiveDuplicateReviewRecord({
      companyId: scope.companyId,
      reviewYear,
      periodType: resolvedPeriodType,
      scopeType: resolvedScopeType,
      unitId: resolvedUnitId,
    });
    if (hasDuplicate) {
      res.status(409).json({ error: DUPLICATE_REVIEW_RECORD_ERROR });
      return;
    }

    const [item] = await db.insert(energyReviewRecordsTable).values({
      companyId: scope.companyId,
      unitId: resolvedUnitId,
      reviewName,
      reviewYear,
      periodType: resolvedPeriodType,
      periodStart,
      periodEnd,
      scopeType: resolvedScopeType,
      status: "draft",
      preparedByUserId: userId,
      generalNotes: generalNotes || null,
      revisionNo: 1,
      previousRevisionId: null,
    }).returning();

    res.status(201).json(item);
  } catch (err) {
    if (handleReviewScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/energy-review-records/:id  (yalnızca draft düzenlenebilir)
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/energy-review-records/:id", requireAuth, async (req, res) => {
  try {
    const { role } = req.user!;
    const id = parsePositiveInteger(req.params.id, "id");
    if (id === undefined) throw new ReviewScopeError(400, "Geçersiz id");
    const scope = await resolveReviewScope(req, "forbid");
    const existingConditions = recordConditions(scope, id);
    existingConditions.push(isNull(energyReviewRecordsTable.deletedAt));
    const [existing] = await db.select().from(energyReviewRecordsTable).where(and(...existingConditions));
    if (!existing) {
      res.status(404).json({ error: "Bulunamadı" });
      return;
    }
    if (existing.status !== "draft") {
      res.status(409).json({ error: "Yalnızca taslak kayıtlar düzenlenebilir" });
      return;
    }

    const {
      reviewName, periodType, periodStart, periodEnd,
      scopeType, generalNotes,
    } = req.body;
    const bodyUnitId = parsePositiveInteger(getBodyValue(req, "unitId"), "unitId");
    const bodyReviewYear = parseReviewYear(getBodyValue(req, "reviewYear"));
    parseReviewYear(req.query.year, "year");
    parseReviewYear(req.query.reviewYear);
    if (periodType !== undefined && !PERIOD_TYPES.includes(periodType)) {
      throw new ReviewScopeError(400, "Geçersiz periodType");
    }
    if (scopeType !== undefined && !SCOPE_TYPES.includes(scopeType)) {
      throw new ReviewScopeError(400, "Geçersiz scopeType");
    }
    if (periodStart !== undefined && typeof periodStart !== "string") {
      throw new ReviewScopeError(400, "Geçersiz periodStart");
    }
    if (periodEnd !== undefined && typeof periodEnd !== "string") {
      throw new ReviewScopeError(400, "Geçersiz periodEnd");
    }

    const updates: Record<string, unknown> = {};
    let nextScopeType = existing.scopeType;
    let nextUnitId = existing.unitId;
    const nextPeriodType = periodType !== undefined && PERIOD_TYPES.includes(periodType) ? periodType : existing.periodType;

    if (reviewName !== undefined) updates.reviewName = reviewName;
    if (periodType !== undefined && PERIOD_TYPES.includes(periodType)) updates.periodType = nextPeriodType;
    if (generalNotes !== undefined) updates.generalNotes = generalNotes || null;

    // scopeType / unitId sadece admin+ tarafından değiştirilebilir
    if (isPrivileged(role)) {
      if (scopeType !== undefined && SCOPE_TYPES.includes(scopeType)) {
        if (scopeType === "unit") {
          const targetUnitId = bodyUnitId ?? existing.unitId;
          if (!targetUnitId) {
            res.status(400).json({ error: "Birim kapsamlı kayıt için birim seçilmeli" });
            return;
          }
          await validateUnitScope(targetUnitId, scope.companyId);
          updates.scopeType = "unit";
          updates.unitId = targetUnitId;
          nextScopeType = "unit";
          nextUnitId = targetUnitId;
        } else {
          updates.scopeType = "company";
          updates.unitId = null;
          nextScopeType = "company";
          nextUnitId = null;
        }
      } else if (bodyUnitId !== undefined && existing.scopeType === "unit") {
        await validateUnitScope(bodyUnitId, scope.companyId);
        updates.unitId = bodyUnitId;
        nextUnitId = bodyUnitId;
      }
    }

    const nextYear = bodyReviewYear ?? existing.reviewYear;
    const nextStart = periodStart !== undefined ? periodStart : existing.periodStart;
    const nextEnd = periodEnd !== undefined ? periodEnd : existing.periodEnd;
    if (bodyReviewYear !== undefined || periodStart !== undefined || periodEnd !== undefined) {
      const dateError = validateDates(nextStart, nextEnd, nextYear);
      if (dateError) {
        res.status(400).json({ error: dateError });
        return;
      }
      updates.reviewYear = nextYear;
      updates.periodStart = nextStart;
      updates.periodEnd = nextEnd;
    }

    const identityChanged =
      nextYear !== existing.reviewYear ||
      nextPeriodType !== existing.periodType ||
      nextScopeType !== existing.scopeType ||
      nextUnitId !== existing.unitId;

    if (identityChanged) {
      const hasDuplicate = await hasActiveDuplicateReviewRecord({
        companyId: scope.companyId,
        reviewYear: nextYear,
        periodType: nextPeriodType,
        scopeType: nextScopeType,
        unitId: nextUnitId,
        excludeId: existing.id,
      });
      if (hasDuplicate) {
        res.status(409).json({ error: DUPLICATE_REVIEW_RECORD_ERROR });
        return;
      }
    }

    updates.updatedAt = new Date();

    const mutationConditions = recordConditions(scope, id);
    mutationConditions.push(
      isNull(energyReviewRecordsTable.deletedAt),
      eq(energyReviewRecordsTable.status, "draft"),
    );
    const [item] = await db.update(energyReviewRecordsTable).set(updates)
      .where(and(...mutationConditions)).returning();
    if (!item) {
      res.status(409).json({ error: "Kayıt artık düzenlenebilir durumda değil" });
      return;
    }
    res.json(item);
  } catch (err) {
    if (handleReviewScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/energy-review-records/:id/complete
// ─────────────────────────────────────────────────────────────────────────────
router.post("/energy-review-records/:id/complete", requireAuth, async (req, res) => {
  try {
    const { userId } = req.user!;
    const id = parsePositiveInteger(req.params.id, "id");
    if (id === undefined) throw new ReviewScopeError(400, "Geçersiz id");
    const scope = await resolveReviewScope(req, "forbid");
    const existingConditions = recordConditions(scope, id);
    existingConditions.push(isNull(energyReviewRecordsTable.deletedAt));
    const [existing] = await db.select().from(energyReviewRecordsTable).where(and(...existingConditions));
    if (!existing) {
      res.status(404).json({ error: "Bulunamadı" });
      return;
    }
    if (existing.status !== "draft") {
      res.status(409).json({ error: "Yalnızca taslak kayıtlar tamamlanabilir" });
      return;
    }

    const mutationConditions = recordConditions(scope, id);
    mutationConditions.push(
      isNull(energyReviewRecordsTable.deletedAt),
      eq(energyReviewRecordsTable.status, "draft"),
    );
    const [item] = await db.update(energyReviewRecordsTable).set({
      status: "completed",
      completedByUserId: userId,
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(...mutationConditions)).returning();
    if (!item) {
      res.status(409).json({ error: "Kayıt artık tamamlanabilir durumda değil" });
      return;
    }

    res.json(item);
  } catch (err) {
    if (handleReviewScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/energy-review-records/:id/reopen
router.post("/energy-review-records/:id/reopen", requireAuth, async (req, res) => {
  try {
    const { role } = req.user!;
    if (!isPrivileged(role)) {
      res.status(403).json({ error: "Yetki yok" });
      return;
    }

    const id = parsePositiveInteger(req.params.id, "id");
    if (id === undefined) throw new ReviewScopeError(400, "Geçersiz id");
    const scope = await resolveReviewScope(req, "forbid");

    const existingConditions = recordConditions(scope, id);
    existingConditions.push(isNull(energyReviewRecordsTable.deletedAt));
    const [existing] = await db.select().from(energyReviewRecordsTable).where(and(...existingConditions));
    if (!existing) {
      res.status(404).json({ error: "Bulunamadı" });
      return;
    }
    if (existing.status !== "completed") {
      res.status(409).json({ error: "Yalnızca tamamlanmış kayıtlar taslağa geri alınabilir" });
      return;
    }

    const mutationConditions = recordConditions(scope, id);
    mutationConditions.push(
      isNull(energyReviewRecordsTable.deletedAt),
      eq(energyReviewRecordsTable.status, "completed"),
    );
    const [item] = await db.update(energyReviewRecordsTable).set({
      status: "draft",
      completedByUserId: null,
      completedAt: null,
      updatedAt: new Date(),
    }).where(and(...mutationConditions)).returning();
    if (!item) {
      res.status(409).json({ error: "Kayıt artık taslağa alınabilir durumda değil" });
      return;
    }

    res.json(item);
  } catch (err) {
    if (handleReviewScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/energy-review-records/:id/revise
// ─────────────────────────────────────────────────────────────────────────────
router.post("/energy-review-records/:id/revise", requireAuth, async (req, res) => {
  try {
    const { userId } = req.user!;
    const id = parsePositiveInteger(req.params.id, "id");
    if (id === undefined) throw new ReviewScopeError(400, "Geçersiz id");
    const scope = await resolveReviewScope(req, "forbid");
    const existingConditions = recordConditions(scope, id);
    existingConditions.push(isNull(energyReviewRecordsTable.deletedAt));
    const [existing] = await db.select().from(energyReviewRecordsTable).where(and(...existingConditions));
    if (!existing) {
      res.status(404).json({ error: "Bulunamadı" });
      return;
    }
    if (existing.status !== "completed") {
      res.status(409).json({ error: "Yalnızca tamamlanmış kayıtlardan revizyon oluşturulabilir" });
      return;
    }

    const { revised, newDraft } = await db.transaction(async (tx) => {
      const mutationConditions = recordConditions(scope, id);
      mutationConditions.push(
        isNull(energyReviewRecordsTable.deletedAt),
        eq(energyReviewRecordsTable.status, "completed"),
      );
      const [revisedRecord] = await tx.update(energyReviewRecordsTable).set({
        status: "revised",
        updatedAt: new Date(),
      }).where(and(...mutationConditions)).returning();
      if (!revisedRecord) {
        throw new ReviewScopeError(409, "Kayıt artık revize edilebilir durumda değil");
      }

      const [draftRecord] = await tx.insert(energyReviewRecordsTable).values({
        companyId: scope.companyId,
        unitId: existing.unitId,
        reviewName: existing.reviewName,
        reviewYear: existing.reviewYear,
        periodType: existing.periodType,
        periodStart: existing.periodStart,
        periodEnd: existing.periodEnd,
        scopeType: existing.scopeType,
        status: "draft",
        preparedByUserId: userId,
        generalNotes: existing.generalNotes,
        revisionNo: existing.revisionNo + 1,
        previousRevisionId: existing.id,
      }).returning();

      return { revised: revisedRecord, newDraft: draftRecord };
    });

    res.status(201).json({ revisedRecord: revised, newRecord: newDraft });
  } catch (err) {
    if (handleReviewScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/energy-review-records/:id
router.delete("/energy-review-records/:id", requireAuth, async (req, res) => {
  try {
    const { userId, role } = req.user!;
    if (!isPrivileged(role)) {
      res.status(403).json({ error: "Yetki yok" });
      return;
    }

    const id = parsePositiveInteger(req.params.id, "id");
    if (id === undefined) throw new ReviewScopeError(400, "Geçersiz id");
    const scope = await resolveReviewScope(req, "forbid");

    const [existing] = await db.select().from(energyReviewRecordsTable)
      .where(and(...recordConditions(scope, id)));
    if (!existing) {
      res.status(404).json({ error: "Bulunamadı" });
      return;
    }
    if (existing.deletedAt) {
      res.status(409).json({ error: "Kayıt zaten kaldırılmış" });
      return;
    }

    const rawReason = typeof req.body?.deleteReason === "string" ? req.body.deleteReason.trim() : "";
    const mutationConditions = recordConditions(scope, id);
    mutationConditions.push(isNull(energyReviewRecordsTable.deletedAt));
    const [item] = await db.update(energyReviewRecordsTable).set({
      deletedAt: new Date(),
      deletedByUserId: userId,
      deleteReason: rawReason || null,
      updatedAt: new Date(),
    }).where(and(...mutationConditions)).returning();
    if (!item) {
      res.status(409).json({ error: "Kayıt zaten kaldırılmış" });
      return;
    }

    res.json(item);
  } catch (err) {
    if (handleReviewScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
