import { Router } from "express";
import { db, energyReviewRecordsTable, unitsTable, usersTable } from "@workspace/db";
import { eq, and, SQL, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

const PERIOD_TYPES = ["annual", "semi_annual", "custom"];
const SCOPE_TYPES = ["company", "unit"];

function isPrivileged(role: string) {
  return role === "admin" || role === "superadmin";
}

function validateDates(periodStart: string, periodEnd: string, reviewYear: number): string | null {
  if (Number.isNaN(Date.parse(periodStart)) || Number.isNaN(Date.parse(periodEnd))) {
    return "Geçersiz tarih formatı";
  }
  if (periodStart > periodEnd) {
    return "Başlangıç tarihi bitiş tarihinden sonra olamaz";
  }
  const startYear = parseInt(periodStart.slice(0, 4), 10);
  if (startYear !== reviewYear) {
    return "Gözden geçirme yılı, başlangıç tarihi yılı ile uyumlu olmalı";
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/energy-review-records
// ─────────────────────────────────────────────────────────────────────────────
router.get("/energy-review-records", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const conditions: SQL[] = [eq(energyReviewRecordsTable.companyId, sessionCompanyId)];

    if (!isPrivileged(role)) {
      if (sessionUnitId === null) {
        res.status(403).json({ error: "Birim yetkisi gerekli" });
        return;
      }
      conditions.push(eq(energyReviewRecordsTable.unitId, sessionUnitId));
    } else {
      const unitIdParam = req.query.unitId ? parseInt(req.query.unitId as string) : undefined;
      if (unitIdParam !== undefined && !isNaN(unitIdParam)) {
        conditions.push(eq(energyReviewRecordsTable.unitId, unitIdParam));
      }
    }

    const yearParam = req.query.year ? parseInt(req.query.year as string) : undefined;
    if (yearParam !== undefined && !isNaN(yearParam)) {
      conditions.push(eq(energyReviewRecordsTable.reviewYear, yearParam));
    }

    const statusParam = req.query.status as string | undefined;
    if (statusParam) conditions.push(eq(energyReviewRecordsTable.status, statusParam));

    const scopeTypeParam = req.query.scopeType as string | undefined;
    if (scopeTypeParam) conditions.push(eq(energyReviewRecordsTable.scopeType, scopeTypeParam));

    const rows = await db
      .select({
        record: energyReviewRecordsTable,
        unitName: unitsTable.name,
        preparedByName: usersTable.name,
      })
      .from(energyReviewRecordsTable)
      .leftJoin(unitsTable, eq(energyReviewRecordsTable.unitId, unitsTable.id))
      .leftJoin(usersTable, eq(energyReviewRecordsTable.preparedByUserId, usersTable.id))
      .where(and(...conditions))
      .orderBy(desc(energyReviewRecordsTable.createdAt));

    const result = rows.map((r) => ({
      ...r.record,
      unitName: r.unitName ?? null,
      preparedByName: r.preparedByName ?? null,
    }));

    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/energy-review-records/:id
// ─────────────────────────────────────────────────────────────────────────────
router.get("/energy-review-records/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) { res.status(400).json({ error: "Geçersiz id" }); return; }

    const [existing] = await db.select().from(energyReviewRecordsTable).where(eq(energyReviewRecordsTable.id, id));
    if (!existing || existing.companyId !== sessionCompanyId) {
      res.status(404).json({ error: "Bulunamadı" });
      return;
    }
    if (!isPrivileged(role) && existing.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" });
      return;
    }

    res.json(existing);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/energy-review-records
// ─────────────────────────────────────────────────────────────────────────────
router.post("/energy-review-records", requireAuth, async (req, res) => {
  try {
    const { userId, role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const {
      reviewName, reviewYear, periodType, periodStart, periodEnd,
      scopeType, unitId, generalNotes,
    } = req.body;

    if (!reviewName || !reviewYear || !periodStart || !periodEnd) {
      res.status(400).json({ error: "Zorunlu alanlar eksik" });
      return;
    }

    const resolvedPeriodType = periodType && PERIOD_TYPES.includes(periodType) ? periodType : "annual";
    let resolvedScopeType: string;
    let resolvedUnitId: number | null;

    if (!isPrivileged(role)) {
      // Standart kullanıcı: yalnızca kendi birimi için, scope her zaman "unit"
      if (sessionUnitId === null) {
        res.status(403).json({ error: "Birim yetkisi gerekli" });
        return;
      }
      if (scopeType === "company") {
        res.status(403).json({ error: "Kuruluş kapsamlı kayıt oluşturma yetkiniz yok" });
        return;
      }
      resolvedScopeType = "unit";
      resolvedUnitId = sessionUnitId;
    } else {
      resolvedScopeType = scopeType && SCOPE_TYPES.includes(scopeType) ? scopeType : "unit";
      if (resolvedScopeType === "unit") {
        if (!unitId) {
          res.status(400).json({ error: "Birim kapsamlı kayıt için birim seçilmeli" });
          return;
        }
        const parsedUnitId = parseInt(unitId);
        const [unitRow] = await db.select().from(unitsTable).where(eq(unitsTable.id, parsedUnitId));
        if (!unitRow || unitRow.companyId !== sessionCompanyId) {
          res.status(403).json({ error: "Bu birim şirketinize ait değil" });
          return;
        }
        resolvedUnitId = parsedUnitId;
      } else {
        resolvedUnitId = null;
      }
    }

    const parsedYear = parseInt(reviewYear);
    const dateError = validateDates(periodStart, periodEnd, parsedYear);
    if (dateError) {
      res.status(400).json({ error: dateError });
      return;
    }

    const [item] = await db.insert(energyReviewRecordsTable).values({
      companyId: sessionCompanyId,
      unitId: resolvedUnitId,
      reviewName,
      reviewYear: parsedYear,
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
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/energy-review-records/:id  (yalnızca draft düzenlenebilir)
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/energy-review-records/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) { res.status(400).json({ error: "Geçersiz id" }); return; }

    const [existing] = await db.select().from(energyReviewRecordsTable).where(eq(energyReviewRecordsTable.id, id));
    if (!existing || existing.companyId !== sessionCompanyId) {
      res.status(404).json({ error: "Bulunamadı" });
      return;
    }
    if (!isPrivileged(role) && existing.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" });
      return;
    }
    if (existing.status !== "draft") {
      res.status(409).json({ error: "Yalnızca taslak kayıtlar düzenlenebilir" });
      return;
    }

    const {
      reviewName, reviewYear, periodType, periodStart, periodEnd,
      scopeType, unitId, generalNotes,
    } = req.body;

    const updates: Record<string, unknown> = {};

    if (reviewName !== undefined) updates.reviewName = reviewName;
    if (periodType !== undefined && PERIOD_TYPES.includes(periodType)) updates.periodType = periodType;
    if (generalNotes !== undefined) updates.generalNotes = generalNotes || null;

    // scopeType / unitId sadece admin+ tarafından değiştirilebilir
    if (isPrivileged(role)) {
      if (scopeType !== undefined && SCOPE_TYPES.includes(scopeType)) {
        if (scopeType === "unit") {
          const targetUnitId = unitId !== undefined ? parseInt(unitId) : existing.unitId;
          if (!targetUnitId) {
            res.status(400).json({ error: "Birim kapsamlı kayıt için birim seçilmeli" });
            return;
          }
          const [unitRow] = await db.select().from(unitsTable).where(eq(unitsTable.id, targetUnitId));
          if (!unitRow || unitRow.companyId !== sessionCompanyId) {
            res.status(403).json({ error: "Bu birim şirketinize ait değil" });
            return;
          }
          updates.scopeType = "unit";
          updates.unitId = targetUnitId;
        } else {
          updates.scopeType = "company";
          updates.unitId = null;
        }
      } else if (unitId !== undefined && existing.scopeType === "unit") {
        const parsedUnitId = parseInt(unitId);
        const [unitRow] = await db.select().from(unitsTable).where(eq(unitsTable.id, parsedUnitId));
        if (!unitRow || unitRow.companyId !== sessionCompanyId) {
          res.status(403).json({ error: "Bu birim şirketinize ait değil" });
          return;
        }
        updates.unitId = parsedUnitId;
      }
    }

    const nextYear = reviewYear !== undefined ? parseInt(reviewYear) : existing.reviewYear;
    const nextStart = periodStart !== undefined ? periodStart : existing.periodStart;
    const nextEnd = periodEnd !== undefined ? periodEnd : existing.periodEnd;
    if (reviewYear !== undefined || periodStart !== undefined || periodEnd !== undefined) {
      const dateError = validateDates(nextStart, nextEnd, nextYear);
      if (dateError) {
        res.status(400).json({ error: dateError });
        return;
      }
      updates.reviewYear = nextYear;
      updates.periodStart = nextStart;
      updates.periodEnd = nextEnd;
    }

    updates.updatedAt = new Date();

    const [item] = await db.update(energyReviewRecordsTable).set(updates).where(eq(energyReviewRecordsTable.id, id)).returning();
    res.json(item);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/energy-review-records/:id/complete
// ─────────────────────────────────────────────────────────────────────────────
router.post("/energy-review-records/:id/complete", requireAuth, async (req, res) => {
  try {
    const { userId, role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) { res.status(400).json({ error: "Geçersiz id" }); return; }

    const [existing] = await db.select().from(energyReviewRecordsTable).where(eq(energyReviewRecordsTable.id, id));
    if (!existing || existing.companyId !== sessionCompanyId) {
      res.status(404).json({ error: "Bulunamadı" });
      return;
    }
    if (!isPrivileged(role) && existing.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" });
      return;
    }
    if (existing.status !== "draft") {
      res.status(409).json({ error: "Yalnızca taslak kayıtlar tamamlanabilir" });
      return;
    }

    const [item] = await db.update(energyReviewRecordsTable).set({
      status: "completed",
      completedByUserId: userId,
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(energyReviewRecordsTable.id, id)).returning();

    res.json(item);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/energy-review-records/:id/revise
// ─────────────────────────────────────────────────────────────────────────────
router.post("/energy-review-records/:id/revise", requireAuth, async (req, res) => {
  try {
    const { userId, role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) { res.status(400).json({ error: "Geçersiz id" }); return; }

    const [existing] = await db.select().from(energyReviewRecordsTable).where(eq(energyReviewRecordsTable.id, id));
    if (!existing || existing.companyId !== sessionCompanyId) {
      res.status(404).json({ error: "Bulunamadı" });
      return;
    }
    if (!isPrivileged(role) && existing.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" });
      return;
    }
    if (existing.status !== "completed") {
      res.status(409).json({ error: "Yalnızca tamamlanmış kayıtlardan revizyon oluşturulabilir" });
      return;
    }

    const [revised] = await db.update(energyReviewRecordsTable).set({
      status: "revised",
      updatedAt: new Date(),
    }).where(eq(energyReviewRecordsTable.id, id)).returning();

    const [newDraft] = await db.insert(energyReviewRecordsTable).values({
      companyId: existing.companyId,
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

    res.status(201).json({ revisedRecord: revised, newRecord: newDraft });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
