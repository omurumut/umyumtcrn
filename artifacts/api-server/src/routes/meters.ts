import { Router } from "express";
import { db, metersTable, consumptionTable, subUnitsTable, energySourcesTable, unitsTable, energyUseGroupsTable, equipmentMeterLinksTable } from "@workspace/db";
import { eq, and, SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

const METER_ENERGY_TYPES = new Set(["elektrik", "dogalgaz", "buhar", "su", "diger"]);
const UI_RECORD_TYPE_MAP = new Map([
  ["measurement", "physical_meter"],
  ["manual", "manual_consumption_point"],
]);
const METER_NAME_MAX_LENGTH = 255;

function isCompanyAdmin(role: string) {
  return role === "admin" || role === "kontrol_admin";
}

function isSuperAdmin(role: string) {
  return role === "superadmin";
}

function isPrivileged(role: string) {
  return isCompanyAdmin(role) || isSuperAdmin(role);
}

class BadRequestError extends Error {}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === "string") {
    if (!/^[1-9]\d*$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function invalidId(field: string): never {
  throw new BadRequestError(`Gecersiz ${field}`);
}

function parseOptionalId(value: unknown, field = "id"): number | undefined {
  if (value === undefined || value === null) return undefined;
  return parsePositiveInteger(value) ?? invalidId(field);
}

function parseNullableId(value: unknown, field = "id"): number | null {
  if (value === undefined || value === null) return null;
  return parsePositiveInteger(value) ?? invalidId(field);
}

function parsePathId(value: unknown, field = "id"): number {
  return parsePositiveInteger(value) ?? invalidId(field);
}

function isBadRequestError(err: unknown): err is BadRequestError {
  return err instanceof BadRequestError;
}

function parseMeterName(value: unknown): string {
  if (typeof value !== "string") throw new BadRequestError("Geçersiz sayaç adı");
  const normalized = value.trim();
  if (!normalized || normalized.length > METER_NAME_MAX_LENGTH) {
    throw new BadRequestError("Geçersiz sayaç adı");
  }
  return normalized;
}

function parseMeterEnergyType(value: unknown): string {
  if (typeof value !== "string" || !METER_ENERGY_TYPES.has(value)) {
    throw new BadRequestError("Geçersiz enerji kaynağı türü");
  }
  return value;
}

function parseUiRecordType(value: unknown, allowLegacyDefault = false): string {
  if (value === undefined && allowLegacyDefault) return "physical_meter";
  if (typeof value !== "string") throw new BadRequestError("Geçersiz kayıt tipi");
  const recordType = UI_RECORD_TYPE_MAP.get(value);
  if (!recordType) throw new BadRequestError("Geçersiz kayıt tipi");
  return recordType;
}

function scopedMeterCondition(id: number, role: string, companyId: number) {
  return isSuperAdmin(role)
    ? eq(metersTable.id, id)
    : and(eq(metersTable.id, id), eq(metersTable.companyId, companyId));
}

async function validateMeterRelations(params: {
  companyId: number;
  unitId: number | null;
  subUnitId: number | null;
  energySourceId: number | null;
  energyUseGroupId: number | null;
}) {
  const { companyId, unitId, subUnitId, energySourceId, energyUseGroupId } = params;

  if (unitId !== null) {
    const [unit] = await db.select({ companyId: unitsTable.companyId })
      .from(unitsTable).where(eq(unitsTable.id, unitId));
    if (!unit || unit.companyId !== companyId) return "Geçersiz birim";
  }

  if (subUnitId !== null) {
    const [subUnit] = await db.select({ companyId: subUnitsTable.companyId, unitId: subUnitsTable.unitId })
      .from(subUnitsTable).where(eq(subUnitsTable.id, subUnitId));
    if (!subUnit || subUnit.companyId !== companyId) return "Geçersiz alt birim";
    if (unitId !== null && subUnit.unitId !== unitId) return "Alt birim bu birime ait değil";
  }

  if (energySourceId !== null) {
    const [energySource] = await db.select({ companyId: energySourcesTable.companyId, unitId: energySourcesTable.unitId })
      .from(energySourcesTable).where(eq(energySourcesTable.id, energySourceId));
    if (!energySource || energySource.companyId !== companyId) return "Geçersiz enerji kaynağı";
    if (unitId !== null && energySource.unitId !== unitId) return "Enerji kaynağı bu birime ait değil";
  }

  if (energyUseGroupId !== null) {
    const [group] = await db.select({
      companyId: energyUseGroupsTable.companyId,
      unitId: energyUseGroupsTable.unitId,
      subUnitId: energyUseGroupsTable.subUnitId,
      energySourceId: energyUseGroupsTable.energySourceId,
    }).from(energyUseGroupsTable).where(eq(energyUseGroupsTable.id, energyUseGroupId));
    if (!group || group.companyId !== companyId) return "Geçersiz enerji kullanım grubu";
    if (group.unitId !== null && group.unitId !== unitId) return "Enerji kullanım grubu bu birime ait değil";
    if (group.subUnitId !== null && group.subUnitId !== subUnitId) return "Enerji kullanım grubu bu alt birime ait değil";
    if (group.energySourceId !== null && group.energySourceId !== energySourceId) return "Enerji kullanım grubu bu enerji kaynağına ait değil";
  }

  return null;
}

// GET /api/meters?unitId=1&subUnitId=2&energySourceId=3
router.get("/meters", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const unitId = parseOptionalId(req.query.unitId, "unitId");
    const subUnitId = parseOptionalId(req.query.subUnitId, "subUnitId");
    const energySourceId = parseOptionalId(req.query.energySourceId, "energySourceId");
    const companyId = parseOptionalId(req.query.companyId, "companyId");
    const conditions: SQL[] = [];

    if (isSuperAdmin(role)) {
      if (companyId !== undefined) conditions.push(eq(metersTable.companyId, companyId));
      if (unitId !== undefined) conditions.push(eq(metersTable.unitId, unitId));
    } else {
      conditions.push(eq(metersTable.companyId, sessionCompanyId));
      if (!isPrivileged(role)) {
        if (sessionUnitId === null) {
          res.json([]);
          return;
        }
        conditions.push(eq(metersTable.unitId, sessionUnitId));
      } else if (unitId !== undefined) {
        conditions.push(eq(metersTable.unitId, unitId));
      }
    }

    if (subUnitId !== undefined) conditions.push(eq(metersTable.subUnitId, subUnitId));
    if (energySourceId !== undefined) conditions.push(eq(metersTable.energySourceId, energySourceId));

    const query = db
      .select({
        id: metersTable.id,
        companyId: metersTable.companyId,
        unitId: metersTable.unitId,
        subUnitId: metersTable.subUnitId,
        energySourceId: metersTable.energySourceId,
        energyUseGroupId: metersTable.energyUseGroupId,
        name: metersTable.name,
        type: metersTable.type,
        recordType: metersTable.recordType,
        location: metersTable.location,
        city: metersTable.city,
        unit: metersTable.unit,
        description: metersTable.description,
        createdAt: metersTable.createdAt,
        subUnitName: subUnitsTable.name,
        energySourceName: energySourcesTable.name,
        energyUseGroupName: energyUseGroupsTable.name,
      })
      .from(metersTable)
      .leftJoin(subUnitsTable, eq(metersTable.subUnitId, subUnitsTable.id))
      .leftJoin(energySourcesTable, eq(metersTable.energySourceId, energySourcesTable.id))
      .leftJoin(energyUseGroupsTable, eq(metersTable.energyUseGroupId, energyUseGroupsTable.id));

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(metersTable.createdAt)
      : await query.orderBy(metersTable.createdAt);

    res.json(rows);
  } catch (err) {
    if (isBadRequestError(err)) {
      res.status(400).json({ error: err.message }); return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/meters
router.post("/meters", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const { name, type, location, city, unit, description, unitId, subUnitId, energySourceId, energyUseGroupId, uiRecordType } = req.body;
    if (name === undefined || type === undefined || !unit) {
      res.status(400).json({ error: "Zorunlu alanlar eksik" }); return;
    }

    const normalizedName = parseMeterName(name);
    const normalizedType = parseMeterEnergyType(type);
    const recordType = parseUiRecordType(uiRecordType, true);
    const requestedUnitId = parseNullableId(unitId, "unitId");
    let parsedUnitId = requestedUnitId;
    let targetCompanyId = sessionCompanyId;

    if (!isPrivileged(role)) {
      if (sessionUnitId === null) {
        res.status(403).json({ error: "Yetki yok" }); return;
      }
      if (requestedUnitId !== null && requestedUnitId !== sessionUnitId) {
        res.status(403).json({ error: "Yetki yok" }); return;
      }
      parsedUnitId = sessionUnitId;
    } else if (isSuperAdmin(role) && parsedUnitId !== null) {
      const [parentUnit] = await db.select({ companyId: unitsTable.companyId })
        .from(unitsTable).where(eq(unitsTable.id, parsedUnitId));
      if (!parentUnit) {
        res.status(400).json({ error: "Geçersiz birim" }); return;
      }
      targetCompanyId = parentUnit.companyId;
    }

    const parsedSubUnitId = parseNullableId(subUnitId, "subUnitId");
    const parsedEnergySourceId = parseNullableId(energySourceId, "energySourceId");
    const parsedGroupId = parseNullableId(energyUseGroupId, "energyUseGroupId");

    const relationError = await validateMeterRelations({
      companyId: targetCompanyId,
      unitId: parsedUnitId,
      subUnitId: parsedSubUnitId,
      energySourceId: parsedEnergySourceId,
      energyUseGroupId: parsedGroupId,
    });
    if (relationError) {
      res.status(400).json({ error: relationError }); return;
    }

    const [meter] = await db.insert(metersTable).values({
      name: normalizedName, type: normalizedType, recordType, location: location ?? "",
      city: city || "Istanbul",
      unit, description: description || null,
      unitId: parsedUnitId,
      subUnitId: parsedSubUnitId,
      energySourceId: parsedEnergySourceId,
      energyUseGroupId: parsedGroupId,
      companyId: targetCompanyId,
    }).returning();
    res.status(201).json(meter);
  } catch (err) {
    if (isBadRequestError(err)) {
      res.status(400).json({ error: err.message }); return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// GET /api/meters/:id
router.get("/meters/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parsePathId(req.params.id, "meter id");
    if (!isPrivileged(role) && sessionUnitId === null) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    const [meter] = await db.select().from(metersTable).where(scopedMeterCondition(id, role, sessionCompanyId));
    if (!meter) { res.status(404).json({ error: "Sayaç bulunamadı" }); return; }
    if (!isPrivileged(role) && meter.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }
    res.json(meter);
  } catch (err) {
    if (isBadRequestError(err)) {
      res.status(400).json({ error: err.message }); return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// PATCH /api/meters/:id
router.patch("/meters/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parsePathId(req.params.id, "meter id");
    if (!isPrivileged(role) && sessionUnitId === null) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    const [existing] = await db.select().from(metersTable).where(scopedMeterCondition(id, role, sessionCompanyId));
    if (!existing) { res.status(404).json({ error: "Sayaç bulunamadı" }); return; }
    if (!isPrivileged(role) && existing.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    const { name, type, location, city, unit, description, unitId, subUnitId, energySourceId, energyUseGroupId, uiRecordType } = req.body;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = parseMeterName(name);
    if (type !== undefined) updates.type = parseMeterEnergyType(type);
    if (uiRecordType !== undefined) updates.recordType = parseUiRecordType(uiRecordType);
    if (location !== undefined) updates.location = location;
    if (city !== undefined) updates.city = city;
    if (unit !== undefined) updates.unit = unit;
    if (description !== undefined) updates.description = description;
    if (unitId !== undefined) updates.unitId = parseNullableId(unitId, "unitId");

    const effectiveUnitId = "unitId" in updates ? (updates.unitId as number | null) : existing.unitId;
    const effectiveSubUnitId = subUnitId !== undefined ? parseNullableId(subUnitId, "subUnitId") : existing.subUnitId;
    const effectiveEnergySourceId = energySourceId !== undefined ? parseNullableId(energySourceId, "energySourceId") : existing.energySourceId;
    const effectiveEnergyUseGroupId = energyUseGroupId !== undefined ? parseNullableId(energyUseGroupId, "energyUseGroupId") : existing.energyUseGroupId;

    if (!isPrivileged(role) && effectiveUnitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    const relationError = await validateMeterRelations({
      companyId: existing.companyId,
      unitId: effectiveUnitId,
      subUnitId: effectiveSubUnitId,
      energySourceId: effectiveEnergySourceId,
      energyUseGroupId: effectiveEnergyUseGroupId,
    });
    if (relationError) {
      res.status(400).json({ error: relationError }); return;
    }

    if (subUnitId !== undefined) updates.subUnitId = effectiveSubUnitId;
    if (energySourceId !== undefined) updates.energySourceId = effectiveEnergySourceId;
    if (energyUseGroupId !== undefined) updates.energyUseGroupId = effectiveEnergyUseGroupId;

    const [meter] = await db.update(metersTable).set(updates).where(scopedMeterCondition(id, role, sessionCompanyId)).returning();
    res.json(meter);
  } catch (err) {
    if (isBadRequestError(err)) {
      res.status(400).json({ error: err.message }); return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// DELETE /api/meters/:id
router.delete("/meters/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parsePathId(req.params.id, "meter id");
    if (!isPrivileged(role) && sessionUnitId === null) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    const [existing] = await db.select().from(metersTable).where(scopedMeterCondition(id, role, sessionCompanyId));
    if (!existing) { res.status(404).send(); return; }
    if (!isPrivileged(role) && existing.unitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    const [usage] = await db.select({ id: consumptionTable.id })
      .from(consumptionTable).where(eq(consumptionTable.meterId, id)).limit(1);
    if (usage) {
      res.status(409).json({ error: "Bu sayaçta tüketim kayıtları bulunduğu için silinemez." }); return;
    }

    const [equipmentLink] = await db.select({ id: equipmentMeterLinksTable.id })
      .from(equipmentMeterLinksTable).where(eq(equipmentMeterLinksTable.meterId, id)).limit(1);
    if (equipmentLink) {
      res.status(409).json({ error: "Bu sayac ekipman iliskilerinde kullanildigi icin silinemez." }); return;
    }

    await db.delete(metersTable).where(scopedMeterCondition(id, role, sessionCompanyId));
    res.status(204).send();
  } catch (err) {
    if (isBadRequestError(err)) {
      res.status(400).json({ error: err.message }); return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
