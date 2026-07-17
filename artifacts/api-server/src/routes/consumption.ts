import { Router } from "express";
import { db, consumptionTable, metersTable, subUnitsTable, energyUseGroupsTable, energySourcesTable, unitsTable } from "@workspace/db";
import { eq, and, ne, sql, inArray, SQL, count, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import { parseIlIlce } from "../services/mgm-stations-data.js";
import { toStationKey, lookupOfficialByStationKey, lookupOfficialWeatherDegreeDay, lookupStationKeyByLocation } from "../services/mgm-sync.js";
import { changedAuditFields, writeAuditEvent } from "../lib/audit.js";
import { observeImport } from "../lib/metrics.js";

const router = Router();

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

const CONSUMPTION_PERIOD_UNIQUE_CONSTRAINT = "consumption_meter_year_month_unique";
const CONSUMPTION_PERIOD_CONFLICT_MESSAGE = "Bu sayaç ve dönem için tüketim kaydı zaten mevcut.";

function isConsumptionPeriodUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && typeof current === "object" && current !== null; depth++) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === "23505" && candidate.constraint === CONSUMPTION_PERIOD_UNIQUE_CONSTRAINT) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

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

function parsePaginationParam(value: unknown, field: "page" | "pageSize", defaultValue: number, max?: number): number {
  if (value === undefined || value === null) return defaultValue;
  const parsed = parsePositiveInteger(value) ?? invalidId(field);
  if (max !== undefined && parsed > max) invalidId(field);
  return parsed;
}

function parseRequiredId(value: unknown, field = "id"): number | null {
  if (value === undefined || value === null) return null;
  return parsePositiveInteger(value) ?? invalidId(field);
}

function parsePathId(value: unknown, field = "id"): number {
  return parsePositiveInteger(value) ?? invalidId(field);
}

function isBadRequestError(err: unknown): err is BadRequestError {
  return err instanceof BadRequestError;
}

const POSTGRES_REAL_MAX = 3.4028234663852886e38;
const DECIMAL_PATTERN = /^(?:\d+|\d*\.\d+)$/;

function parseConsumptionValue(value: unknown, field = "tüketim"): number {
  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized || !DECIMAL_PATTERN.test(normalized)) {
      throw new BadRequestError(`Geçersiz ${field} değeri`);
    }
    parsed = Number(normalized);
  } else {
    throw new BadRequestError(`Geçersiz ${field} değeri`);
  }

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > POSTGRES_REAL_MAX) {
    throw new BadRequestError(`Geçersiz ${field} değeri`);
  }
  return parsed;
}

function parseDegreeDayValue(value: unknown, field: "HDD" | "CDD"): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized || !DECIMAL_PATTERN.test(normalized)) {
      throw new BadRequestError(`Geçersiz ${field} değeri`);
    }
    parsed = Number(normalized);
  } else {
    throw new BadRequestError(`Geçersiz ${field} değeri`);
  }

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > POSTGRES_REAL_MAX) {
    throw new BadRequestError(`Geçersiz ${field} değeri`);
  }
  return parsed;
}

function calculateConsumptionMetrics(consumptionValue: number, energySourceType: string) {
  const factors = energySourceType === "elektrik"
    ? { tep: 0.000086, co2: 0.4 }
    : energySourceType === "dogalgaz"
      ? { tep: 0.00086, co2: 0.202 }
      : null;
  if (!factors) {
    throw new BadRequestError("Desteklenmeyen enerji kaynağı tipi");
  }
  return {
    tep: consumptionValue * factors.tep,
    co2: consumptionValue * factors.co2,
  };
}

type CalculationEnergySource = { id: number; companyId: number; type: string };

function resolveCalculationSourceType(
  meter: typeof metersTable.$inferSelect,
  energySource?: CalculationEnergySource,
) {
  if (meter.energySourceId === null) return meter.type;
  if (!energySource || energySource.id !== meter.energySourceId || energySource.companyId !== meter.companyId) {
    throw new BadRequestError("Geçersiz enerji kaynağı");
  }
  return energySource.type;
}

async function getCalculationSourceType(meter: typeof metersTable.$inferSelect) {
  if (meter.energySourceId === null) return meter.type;
  const [energySource] = await db.select({
    id: energySourcesTable.id,
    companyId: energySourcesTable.companyId,
    type: energySourcesTable.type,
  }).from(energySourcesTable).where(and(
    eq(energySourcesTable.id, meter.energySourceId),
    eq(energySourcesTable.companyId, meter.companyId),
  ));
  return resolveCalculationSourceType(meter, energySource);
}

function firstPresent(...values: unknown[]) {
  return values.find(value => value !== undefined && value !== null);
}

function scopedConsumptionCondition(id: number, role: string, companyId: number) {
  return isSuperAdmin(role)
    ? eq(consumptionTable.id, id)
    : and(eq(consumptionTable.id, id), eq(consumptionTable.companyId, companyId));
}

async function getScopedMeter(params: {
  meterId: number;
  role: string;
  sessionCompanyId: number;
  sessionUnitId: number | null;
}) {
  const { meterId, role, sessionCompanyId, sessionUnitId } = params;
  const conditions: SQL[] = [eq(metersTable.id, meterId)];
  if (!isSuperAdmin(role)) conditions.push(eq(metersTable.companyId, sessionCompanyId));

  const [meter] = await db.select().from(metersTable).where(and(...conditions));
  if (!meter) return { status: 404, error: "Sayaç bulunamadı" };
  if (!isPrivileged(role)) {
    if (sessionUnitId === null) return { status: 403, error: "Yetki yok" };
    if (meter.unitId !== sessionUnitId) return { status: 403, error: "Yetki yok" };
  }
  return { meter };
}

async function validateMeterRelations(params: {
  companyId: number;
  meter: typeof metersTable.$inferSelect;
  requestedUnitId?: number;
  requestedSubUnitId?: number;
  requestedEnergySourceId?: number;
}) {
  const { companyId, meter, requestedUnitId, requestedSubUnitId, requestedEnergySourceId } = params;
  const effectiveUnitId = requestedUnitId ?? meter.unitId;

  if (meter.companyId !== companyId) return "Geçersiz sayaç";

  if (requestedUnitId !== undefined && meter.unitId !== requestedUnitId) {
    return "Sayaç seçilen birime ait değil";
  }

  if (requestedSubUnitId !== undefined) {
    const [subUnit] = await db.select({ companyId: subUnitsTable.companyId, unitId: subUnitsTable.unitId })
      .from(subUnitsTable).where(eq(subUnitsTable.id, requestedSubUnitId));
    if (!subUnit || subUnit.companyId !== companyId) return "Geçersiz alt birim";
    if (effectiveUnitId !== null && subUnit.unitId !== effectiveUnitId) return "Alt birim bu birime ait değil";
    if (meter.subUnitId !== requestedSubUnitId) return "Sayaç seçilen alt birime ait değil";
  }

  if (requestedEnergySourceId !== undefined) {
    const [energySource] = await db.select({ companyId: energySourcesTable.companyId, unitId: energySourcesTable.unitId })
      .from(energySourcesTable).where(eq(energySourcesTable.id, requestedEnergySourceId));
    if (!energySource || energySource.companyId !== companyId) return "Geçersiz enerji kaynağı";
    if (effectiveUnitId !== null && energySource.unitId !== effectiveUnitId) return "Enerji kaynağı bu birime ait değil";
    if (meter.energySourceId !== requestedEnergySourceId) return "Sayaç seçilen enerji kaynağına ait değil";
  }

  return null;
}

interface MgmLookupResult {
  hdd: number;
  cdd: number;
  stationName: string;
  stationNote: string | null;
  dataMethod: "official_monthly";
}

interface ConsumptionWeatherSnapshot {
  hdd: number | null;
  cdd: number | null;
  weatherStationName: string | null;
  weatherStationNote: string | null;
  weatherDataMethod: "official_monthly" | "no_official_data" | null;
}

async function autoLookupHddCdd(location: string, year: number, month: number): Promise<MgmLookupResult | null> {
  try {
    const { il, ilce } = parseIlIlce(location);

    if (ilce) {
      const mapping = await lookupStationKeyByLocation(il, ilce);
      if (mapping) {
        const data = await lookupOfficialByStationKey(mapping.stationKey, year, month);
        if (data) {
          return {
            hdd: data.hdd,
            cdd: data.cdd,
            stationName: mapping.stationName ?? data.stationName ?? ilce,
            stationNote: data.stationNote ?? null,
            dataMethod: "official_monthly",
          };
        }
      }
    }

    const mappingByIl = await lookupStationKeyByLocation(il, null);
    if (mappingByIl) {
      const data = await lookupOfficialByStationKey(mappingByIl.stationKey, year, month);
      if (data) {
        const note = ilce
          ? `"${ilce}" için özel MGM istasyonu resmi verisi bulunamadı. ${il} ili merkezi resmi verisi kullanıldı.`
          : null;
        return {
          hdd: data.hdd,
          cdd: data.cdd,
          stationName: mappingByIl.stationName ?? data.stationName ?? il,
          stationNote: data.stationNote ?? note,
          dataMethod: "official_monthly",
        };
      }
    }

    if (ilce) {
      const sk = toStationKey(il, ilce);
      const official = await lookupOfficialByStationKey(sk, year, month);
      if (official) {
        return {
          hdd: official.hdd,
          cdd: official.cdd,
          stationName: official.stationName ?? ilce,
          stationNote: official.stationNote ?? null,
          dataMethod: "official_monthly",
        };
      }
    }

    const ilKey = toStationKey(il, null);
    const officialByIl = await lookupOfficialByStationKey(ilKey, year, month);
    if (officialByIl) {
      const note = ilce
        ? `"${ilce}" için özel MGM istasyonu resmi verisi bulunamadı. ${il} ili merkezi resmi verisi kullanıldı.`
        : null;
      return {
        hdd: officialByIl.hdd,
        cdd: officialByIl.cdd,
        stationName: officialByIl.stationName ?? il,
        stationNote: officialByIl.stationNote ?? note,
        dataMethod: "official_monthly",
      };
    }

    const officialByProv = await lookupOfficialWeatherDegreeDay(il, year, month);
    if (officialByProv) {
      const note = ilce
        ? `"${ilce}" için özel MGM istasyonu resmi verisi bulunamadı. ${il} ili resmi verisi kullanıldı.`
        : null;
      return {
        hdd: officialByProv.hdd,
        cdd: officialByProv.cdd,
        stationName: officialByProv.stationName ?? il,
        stationNote: officialByProv.stationNote ?? note,
        dataMethod: "official_monthly",
      };
    }

    return null;
  } catch {
    return null;
  }
}

async function resolveConsumptionWeatherSnapshot(
  meter: typeof metersTable.$inferSelect,
  year: number,
  month: number,
  providedHdd: number | null | undefined,
  providedCdd: number | null | undefined,
): Promise<ConsumptionWeatherSnapshot> {
  const hasManualValue = providedHdd !== undefined && providedHdd !== null
    || providedCdd !== undefined && providedCdd !== null;

  if (hasManualValue) {
    return {
      hdd: providedHdd ?? null,
      cdd: providedCdd ?? null,
      weatherStationName: null,
      weatherStationNote: null,
      weatherDataMethod: null,
    };
  }

  if (meter.city) {
    const mgmResult = await autoLookupHddCdd(meter.city, year, month);
    if (mgmResult) {
      return {
        hdd: mgmResult.hdd,
        cdd: mgmResult.cdd,
        weatherStationName: mgmResult.stationName,
        weatherStationNote: mgmResult.stationNote,
        weatherDataMethod: mgmResult.dataMethod,
      };
    }
    return {
      hdd: null,
      cdd: null,
      weatherStationName: null,
      weatherStationNote: `Bu dönem (${year}/${month}) ve lokasyon ("${meter.city}") için resmi MGM HDD/CDD verisi bulunamadı. Veri senkronizasyonu için yöneticinize başvurun.`,
      weatherDataMethod: "no_official_data",
    };
  }

  return {
    hdd: null,
    cdd: null,
    weatherStationName: null,
    weatherStationNote: null,
    weatherDataMethod: null,
  };
}

router.get("/consumption", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const page = parsePaginationParam(req.query.page, "page", 1);
    const pageSize = parsePaginationParam(req.query.pageSize, "pageSize", 50, 100);
    const meterId = parseOptionalId(req.query.meterId, "meterId");
    const unitId = parseOptionalId(req.query.unitId, "unitId");
    const subUnitId = parseOptionalId(req.query.subUnitId, "subUnitId");
    const energySourceId = parseOptionalId(req.query.energySourceId, "energySourceId");
    const companyId = parseOptionalId(req.query.companyId, "companyId");
    const year = parseOptionalId(req.query.year, "year");
    const month = parseOptionalId(req.query.month, "month");
    const conditions: SQL[] = [];

    if (isSuperAdmin(role)) {
      if (companyId !== undefined) {
        conditions.push(eq(consumptionTable.companyId, companyId));
        conditions.push(eq(metersTable.companyId, companyId));
      }
      if (unitId !== undefined) {
        const [unit] = await db.select({ companyId: unitsTable.companyId }).from(unitsTable).where(eq(unitsTable.id, unitId));
        if (!unit || (companyId !== undefined && unit.companyId !== companyId)) {
          res.status(403).json({ error: "Yetki yok" }); return;
        }
        conditions.push(eq(metersTable.unitId, unitId));
      }
    } else {
      conditions.push(eq(consumptionTable.companyId, sessionCompanyId));
      conditions.push(eq(metersTable.companyId, sessionCompanyId));
      if (!isPrivileged(role)) {
        if (sessionUnitId === null) {
          res.json({
            items: [],
            pagination: { page, pageSize, totalItems: 0, totalPages: 0 },
          });
          return;
        }
        conditions.push(eq(metersTable.unitId, sessionUnitId));
      } else if (unitId !== undefined) {
        const [unit] = await db.select({ companyId: unitsTable.companyId }).from(unitsTable).where(eq(unitsTable.id, unitId));
        if (!unit || unit.companyId !== sessionCompanyId) {
          res.status(403).json({ error: "Yetki yok" }); return;
        }
        conditions.push(eq(metersTable.unitId, unitId));
      }
    }

    if (meterId !== undefined) conditions.push(eq(consumptionTable.meterId, meterId));
    if (subUnitId !== undefined) conditions.push(eq(metersTable.subUnitId, subUnitId));
    if (energySourceId !== undefined) conditions.push(eq(metersTable.energySourceId, energySourceId));
    if (year !== undefined) conditions.push(eq(consumptionTable.year, year));
    if (month !== undefined) conditions.push(eq(consumptionTable.month, month));

    const query = db
      .select({
        id: consumptionTable.id,
        companyId: consumptionTable.companyId,
        meterId: consumptionTable.meterId,
        meterName: metersTable.name,
        meterUnitId: metersTable.unitId,
        meterCompanyId: metersTable.companyId,
        meterSubUnitId: metersTable.subUnitId,
        meterEnergySourceId: metersTable.energySourceId,
        meterType: metersTable.type,
        energyUseGroupId: metersTable.energyUseGroupId,
        energyUseGroupName: energyUseGroupsTable.name,
        year: consumptionTable.year,
        month: consumptionTable.month,
        kwh: consumptionTable.kwh,
        tep: consumptionTable.tep,
        co2: consumptionTable.co2,
        hdd: consumptionTable.hdd,
        cdd: consumptionTable.cdd,
        notes: consumptionTable.notes,
        weatherStationName: consumptionTable.weatherStationName,
        weatherStationNote: consumptionTable.weatherStationNote,
        createdAt: consumptionTable.createdAt,
      })
      .from(consumptionTable)
      .leftJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
      .leftJoin(energyUseGroupsTable, eq(metersTable.energyUseGroupId, energyUseGroupsTable.id));

    const totalQuery = db
      .select({ totalItems: count() })
      .from(consumptionTable)
      .leftJoin(metersTable, eq(consumptionTable.meterId, metersTable.id));
    const totalRows = conditions.length > 0
      ? await totalQuery.where(and(...conditions))
      : await totalQuery;
    const totalItems = Number(totalRows[0]?.totalItems ?? 0);
    const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);
    const offset = (page - 1) * pageSize;

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(consumptionTable.year), desc(consumptionTable.month), desc(consumptionTable.id)).limit(pageSize).offset(offset)
      : await query.orderBy(desc(consumptionTable.year), desc(consumptionTable.month), desc(consumptionTable.id)).limit(pageSize).offset(offset);

    res.json({
      items: rows.map(({ meterUnitId, meterCompanyId, meterSubUnitId, meterEnergySourceId, ...r }) => r),
      pagination: { page, pageSize, totalItems, totalPages },
    });
  } catch (err) {
    if (isBadRequestError(err)) {
      res.status(400).json({ error: err.message }); return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.post("/consumption", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const { meterId, year, month, kwh, hdd, cdd, notes, unitId, subUnitId, energySourceId } = req.body;
    const parsedMeterId = parseRequiredId(meterId, "meterId");
    if (!parsedMeterId || year === undefined || year === null || month === undefined || month === null) {
      res.status(400).json({ error: "Zorunlu alanlar eksik" }); return;
    }
    const yr = parseRequiredId(year, "year");
    const mo = parseRequiredId(month, "month");
    const parsedHdd = parseDegreeDayValue(hdd, "HDD");
    const parsedCdd = parseDegreeDayValue(cdd, "CDD");
    if (!yr || !mo || mo < 1 || mo > 12) {
      res.status(400).json({ error: "GeÃ§ersiz yÄ±l/ay deÄŸeri" }); return;
    }

    const requestedUnitId = parseOptionalId(unitId, "unitId");
    if (!isPrivileged(role) && requestedUnitId !== undefined && requestedUnitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    const meterResult = await getScopedMeter({ meterId: parsedMeterId, role, sessionCompanyId, sessionUnitId });
    if (!meterResult.meter) {
      res.status(meterResult.status ?? 403).json({ error: meterResult.error ?? "Yetki yok" }); return;
    }
    const meter = meterResult.meter;

    const relationError = await validateMeterRelations({
      companyId: meter.companyId,
      meter,
      requestedUnitId,
      requestedSubUnitId: parseOptionalId(subUnitId, "subUnitId"),
      requestedEnergySourceId: parseOptionalId(energySourceId, "energySourceId"),
    });
    if (relationError) {
      res.status(400).json({ error: relationError }); return;
    }

    const kwhVal = parseConsumptionValue(kwh);
    const sourceType = await getCalculationSourceType(meter);
    const { tep: tepVal, co2: co2Val } = calculateConsumptionMetrics(kwhVal, sourceType);

    const [dupCheck] = await db
      .select({ id: consumptionTable.id })
      .from(consumptionTable)
      .where(and(
        eq(consumptionTable.companyId, meter.companyId),
        eq(consumptionTable.meterId, meter.id),
        eq(consumptionTable.year, yr),
        eq(consumptionTable.month, mo)
      ));
    if (dupCheck) {
      res.status(409).json({ error: CONSUMPTION_PERIOD_CONFLICT_MESSAGE }); return;
    }

    const weatherSnapshot = await resolveConsumptionWeatherSnapshot(meter, yr, mo, parsedHdd, parsedCdd);

    const record = await db.transaction(async (tx) => {
      const [created] = await tx.insert(consumptionTable).values({
        companyId: meter.companyId,
        meterId: meter.id,
        year: yr,
        month: mo,
        kwh: kwhVal,
        tep: tepVal,
        co2: co2Val,
        hdd: weatherSnapshot.hdd,
        cdd: weatherSnapshot.cdd,
        notes: notes || null,
        weatherStationName: weatherSnapshot.weatherStationName,
        weatherStationNote: weatherSnapshot.weatherStationNote,
      }).returning();
      await writeAuditEvent(tx, {
        request: req,
        companyId: created.companyId,
        unitId: meter.unitId,
        action: "consumption.create",
        entityType: "consumption",
        entityId: created.id,
        outcome: "success",
        changes: { created: { meterId: created.meterId, year: created.year, month: created.month, kwh: created.kwh, tep: created.tep, co2: created.co2, hdd: created.hdd, cdd: created.cdd } },
      });
      return created;
    });

    res.status(201).json({
      ...record,
      meterName: meter.name,
      weatherDataMethod: weatherSnapshot.weatherDataMethod,
    });
  } catch (err) {
    if (isBadRequestError(err)) {
      res.status(400).json({ error: err.message }); return;
    }
    if (isConsumptionPeriodUniqueViolation(err)) {
      res.status(409).json({ error: CONSUMPTION_PERIOD_CONFLICT_MESSAGE }); return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.patch("/consumption/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parsePathId(req.params.id, "consumption id");
    if (!isPrivileged(role) && sessionUnitId === null) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    const [existing] = await db
      .select({
        companyId: consumptionTable.companyId,
        meterId: consumptionTable.meterId,
        year: consumptionTable.year,
        month: consumptionTable.month,
        kwh: consumptionTable.kwh,
        tep: consumptionTable.tep,
        co2: consumptionTable.co2,
        hdd: consumptionTable.hdd,
        cdd: consumptionTable.cdd,
        meterUnitId: metersTable.unitId,
        meterCompanyId: metersTable.companyId,
      })
      .from(consumptionTable)
      .leftJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
      .where(scopedConsumptionCondition(id, role, sessionCompanyId));
    if (!existing) { res.status(404).json({ error: "Kayıt bulunamadı" }); return; }
    if (!isSuperAdmin(role) && existing.meterCompanyId !== sessionCompanyId) {
      res.status(404).json({ error: "Kayıt bulunamadı" }); return;
    }
    if (!isPrivileged(role) && existing.meterUnitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    const { meterId, year, month, kwh, hdd, cdd, notes, unitId, subUnitId, energySourceId } = req.body;
    const parsedHdd = parseDegreeDayValue(hdd, "HDD");
    const parsedCdd = parseDegreeDayValue(cdd, "CDD");
    const finalMeterId = meterId !== undefined ? parseRequiredId(meterId, "meterId") : existing.meterId;
    if (!finalMeterId) {
      res.status(400).json({ error: "Geçersiz sayaç" }); return;
    }
    const finalYear = year !== undefined ? parseRequiredId(year, "year") : existing.year;
    const finalMonth = month !== undefined ? parseRequiredId(month, "month") : existing.month;
    if (!finalYear || !finalMonth || finalMonth < 1 || finalMonth > 12) {
      res.status(400).json({ error: "Geçersiz yıl/ay değeri" }); return;
    }

    const requestedUnitId = parseOptionalId(unitId, "unitId");
    if (!isPrivileged(role) && requestedUnitId !== undefined && requestedUnitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    const meterResult = await getScopedMeter({ meterId: finalMeterId, role, sessionCompanyId, sessionUnitId });
    if (!meterResult.meter) {
      res.status(meterResult.status ?? 403).json({ error: meterResult.error ?? "Yetki yok" }); return;
    }
    const finalMeter = meterResult.meter;

    const relationError = await validateMeterRelations({
      companyId: finalMeter.companyId,
      meter: finalMeter,
      requestedUnitId,
      requestedSubUnitId: parseOptionalId(subUnitId, "subUnitId"),
      requestedEnergySourceId: parseOptionalId(energySourceId, "energySourceId"),
    });
    if (relationError) {
      res.status(400).json({ error: relationError }); return;
    }

    const [dupCheck] = await db
      .select({ id: consumptionTable.id })
      .from(consumptionTable)
      .where(and(
        eq(consumptionTable.companyId, finalMeter.companyId),
        eq(consumptionTable.meterId, finalMeter.id),
        eq(consumptionTable.year, finalYear),
        eq(consumptionTable.month, finalMonth),
        ne(consumptionTable.id, id)
      ));
    if (dupCheck) {
      res.status(409).json({ error: CONSUMPTION_PERIOD_CONFLICT_MESSAGE }); return;
    }

    const updates: Record<string, unknown> = {};
    let responseWeatherDataMethod: ConsumptionWeatherSnapshot["weatherDataMethod"] | undefined;
    if (meterId !== undefined) {
      updates.meterId = finalMeter.id;
      updates.companyId = finalMeter.companyId;
    }
    if (year !== undefined) updates.year = finalYear;
    if (month !== undefined) updates.month = finalMonth;
    if (kwh !== undefined || meterId !== undefined) {
      const finalKwh = kwh !== undefined ? parseConsumptionValue(kwh) : existing.kwh;
      const sourceType = await getCalculationSourceType(finalMeter);
      const metrics = calculateConsumptionMetrics(finalKwh, sourceType);
      updates.kwh = finalKwh;
      updates.tep = metrics.tep;
      updates.co2 = metrics.co2;
    }
    const snapshotContextChanged = finalMeter.id !== existing.meterId
      || finalYear !== existing.year
      || finalMonth !== existing.month;
    const weatherFieldsProvided = hdd !== undefined || cdd !== undefined;
    if (snapshotContextChanged) {
      const weatherSnapshot = await resolveConsumptionWeatherSnapshot(
        finalMeter,
        finalYear,
        finalMonth,
        parsedHdd,
        parsedCdd,
      );
      updates.hdd = weatherSnapshot.hdd;
      updates.cdd = weatherSnapshot.cdd;
      updates.weatherStationName = weatherSnapshot.weatherStationName;
      updates.weatherStationNote = weatherSnapshot.weatherStationNote;
      responseWeatherDataMethod = weatherSnapshot.weatherDataMethod;
    } else if (weatherFieldsProvided) {
      if (parsedHdd !== undefined) updates.hdd = parsedHdd;
      if (parsedCdd !== undefined) updates.cdd = parsedCdd;
      updates.weatherStationName = null;
      updates.weatherStationNote = null;
      responseWeatherDataMethod = null;
    }
    if (notes !== undefined) updates.notes = notes;

    const record = await db.transaction(async (tx) => {
      const [updated] = await tx.update(consumptionTable).set(updates).where(scopedConsumptionCondition(id, role, sessionCompanyId)).returning();
      if (!updated) return null;
      await writeAuditEvent(tx, {
        request: req,
        companyId: updated.companyId,
        unitId: finalMeter.unitId,
        action: "consumption.update",
        entityType: "consumption",
        entityId: updated.id,
        outcome: "success",
        changes: changedAuditFields(existing, updated as unknown as Record<string, unknown>, ["meterId", "year", "month", "kwh", "tep", "co2", "hdd", "cdd"]),
      });
      return updated;
    });
    if (!record) { res.status(404).json({ error: "KayÄ±t bulunamadÄ±" }); return; }
    res.json(responseWeatherDataMethod === undefined ? record : { ...record, weatherDataMethod: responseWeatherDataMethod });
  } catch (err) {
    if (isBadRequestError(err)) {
      res.status(400).json({ error: err.message }); return;
    }
    if (isConsumptionPeriodUniqueViolation(err)) {
      res.status(409).json({ error: CONSUMPTION_PERIOD_CONFLICT_MESSAGE }); return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.post("/consumption/batch", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "Geçerli satır dizisi gerekli" }); return;
    }
    if (rows.length > 5000) {
      res.status(400).json({ error: "En fazla 5000 satır içe aktarılabilir" }); return;
    }
    if (!isPrivileged(role) && sessionUnitId === null) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    const meterConditions: SQL[] = [];
    if (!isSuperAdmin(role)) meterConditions.push(eq(metersTable.companyId, sessionCompanyId));
    if (!isPrivileged(role) && sessionUnitId !== null) meterConditions.push(eq(metersTable.unitId, sessionUnitId));
    const importCompanyId = isSuperAdmin(role)
      ? parseOptionalId(req.body?.companyId, "companyId")
      : undefined;
    if (importCompanyId !== undefined) meterConditions.push(eq(metersTable.companyId, importCompanyId));
    const allMeters = meterConditions.length > 0
      ? await db.select().from(metersTable).where(and(...meterConditions))
      : await db.select().from(metersTable);
    const sourceIds = [...new Set(allMeters.map(meter => meter.energySourceId).filter((id): id is number => id !== null))];
    const calculationSources = sourceIds.length > 0
      ? await db.select({
          id: energySourcesTable.id,
          companyId: energySourcesTable.companyId,
          type: energySourcesTable.type,
        }).from(energySourcesTable).where(inArray(energySourcesTable.id, sourceIds))
      : [];
    const calculationSourceById = new Map(calculationSources.map(source => [source.id, source]));

    let imported = 0;
    const errors: { row: number; message: string }[] = [];

    await db.transaction(async (tx) => {
      for (const [i, row] of rows.entries()) {
        const rowNum = i + 1;
        try {
        const rowMeterId = parseOptionalId(row.meterId, "meterId");
        let meter: typeof metersTable.$inferSelect | undefined;
        if (rowMeterId !== undefined) {
          meter = allMeters.find(m => m.id === rowMeterId);
        } else if (row.meterName) {
          const normalizedMeterName = String(row.meterName).toLowerCase().trim();
          const matchingMeters = allMeters.filter(m => m.name.toLowerCase().trim() === normalizedMeterName);
          const matchingCompanyIds = new Set(matchingMeters.map(m => m.companyId));
          if (isSuperAdmin(role) && importCompanyId === undefined && matchingCompanyIds.size > 1) {
            errors.push({
              row: rowNum,
              message: "Sayaç adı birden fazla şirkette eşleşiyor. companyId veya meterId belirtin.",
            });
            continue;
          }
          meter = matchingMeters[0];
        }
        if (!meter) {
          errors.push({ row: rowNum, message: "Sayaç bulunamadı" });
          continue;
        }

        const requestedUnitId = parseOptionalId(firstPresent(row.unitId, row.unitid, row.unit_id), "unitId");
        if (!isPrivileged(role) && requestedUnitId !== undefined && requestedUnitId !== sessionUnitId) {
          errors.push({ row: rowNum, message: "Bu sayaç için yetkiniz yok" });
          continue;
        }
        const relationError = await validateMeterRelations({
          companyId: meter.companyId,
          meter,
          requestedUnitId,
          requestedSubUnitId: parseOptionalId(firstPresent(row.subUnitId, row.subunitid, row.sub_unit_id), "subUnitId"),
          requestedEnergySourceId: parseOptionalId(firstPresent(row.energySourceId, row.energysourceid, row.energy_source_id), "energySourceId"),
        });
        if (relationError) {
          errors.push({ row: rowNum, message: "Geçersiz sayaç ilişkisi" });
          continue;
        }

        const year = parseRequiredId(row.year, "year");
        const month = parseRequiredId(row.month, "month");
        if (!year || !month || month < 1 || month > 12) {
          errors.push({ row: rowNum, message: "Geçersiz yıl/ay değeri" });
          continue;
        }
        const kwh = parseConsumptionValue(row.kwh);
        const sourceType = resolveCalculationSourceType(
          meter,
          meter.energySourceId === null ? undefined : calculationSourceById.get(meter.energySourceId),
        );
        const { tep: tepVal, co2: co2Val } = calculateConsumptionMetrics(kwh, sourceType);

        let hddVal: number | null = row.hdd !== undefined && row.hdd !== ""
          ? parseDegreeDayValue(row.hdd, "HDD") ?? null
          : null;
        let cddVal: number | null = row.cdd !== undefined && row.cdd !== ""
          ? parseDegreeDayValue(row.cdd, "CDD") ?? null
          : null;

        if (hddVal === null && cddVal === null && meter.city) {
          const mgmResult = await autoLookupHddCdd(meter.city, year, month);
          if (mgmResult) {
            hddVal = mgmResult.hdd;
            cddVal = mgmResult.cdd;
          }
        }

        const [batchDup] = await tx
          .select({ id: consumptionTable.id })
          .from(consumptionTable)
          .where(and(
            eq(consumptionTable.companyId, meter.companyId),
            eq(consumptionTable.meterId, meter.id),
            eq(consumptionTable.year, year),
            eq(consumptionTable.month, month)
          ));
        if (batchDup) {
          errors.push({ row: rowNum, message: CONSUMPTION_PERIOD_CONFLICT_MESSAGE });
          continue;
        }

        await tx.execute(sql`
          INSERT INTO consumption
            (company_id, meter_id, year, month, kwh, tep, co2, hdd, cdd, notes)
          VALUES
            (${meter.companyId}, ${meter.id}, ${year}, ${month},
             ${kwh}, ${tepVal}, ${co2Val},
             ${hddVal}, ${cddVal}, ${row.notes ? String(row.notes) : null})
        `);
          imported++;
        } catch (rowErr: unknown) {
          errors.push({
            row: rowNum,
            message: isConsumptionPeriodUniqueViolation(rowErr)
              ? CONSUMPTION_PERIOD_CONFLICT_MESSAGE
              : rowErr instanceof Error ? rowErr.message : "Bilinmeyen hata",
          });
        }
      }
      await writeAuditEvent(tx, {
        request: req,
        companyId: importCompanyId ?? (isSuperAdmin(role) ? null : sessionCompanyId),
        unitId: !isPrivileged(role) ? sessionUnitId : null,
        action: "consumption.import",
        entityType: "consumption_import",
        entityId: req.id === undefined ? null : String(req.id),
        outcome: errors.length > 0 ? (imported > 0 ? "partial" : "failure") : "success",
        changes: { total: rows.length, inserted: imported, failed: errors.length },
        metadata: { errors: errors.slice(0, 20) },
      });
    });

    observeImport("consumption", errors.length > 0 ? (imported > 0 ? "partial" : "failure") : "success", {
      total: rows.length,
      inserted: imported,
      failed: errors.length,
    });
    res.json({ imported, total: rows.length, errors });
  } catch (err) {
    if (isBadRequestError(err)) {
      res.status(400).json({ error: err.message }); return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.post("/admin/consumption/refresh-weather", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId } = req.user!;
    if (!isPrivileged(role)) {
      res.status(403).json({ error: "Bu işlem için yetkiniz yok" }); return;
    }

    const dryRun = req.body?.dryRun === true;
    let targetCompanyId: number | null = sessionCompanyId;
    if (isSuperAdmin(role) && req.body?.companyId !== undefined && req.body?.companyId !== null) {
      targetCompanyId = parseOptionalId(req.body.companyId, "companyId") ?? targetCompanyId;
    }

    const baseQuery = db
      .select({
        id: consumptionTable.id,
        year: consumptionTable.year,
        month: consumptionTable.month,
        hdd: consumptionTable.hdd,
        city: metersTable.city,
        meterCompanyId: metersTable.companyId,
      })
      .from(consumptionTable)
      .leftJoin(metersTable, eq(consumptionTable.meterId, metersTable.id));

    const records = targetCompanyId !== null
      ? await baseQuery.where(eq(metersTable.companyId, targetCompanyId))
      : await baseQuery;

    let updated = 0;
    let noData = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const rec of records) {
      if (!rec.city) { skipped++; continue; }
      try {
        const mgmResult = await autoLookupHddCdd(rec.city, rec.year, rec.month);

        if (dryRun) {
          if (mgmResult) updated++;
          else noData++;
          continue;
        }

        if (mgmResult) {
          await db.update(consumptionTable).set({
            hdd: mgmResult.hdd,
            cdd: mgmResult.cdd,
            weatherStationName: mgmResult.stationName,
            weatherStationNote: mgmResult.stationNote ?? null,
          }).where(eq(consumptionTable.id, rec.id));
          updated++;
        } else {
          await db.update(consumptionTable).set({
            hdd: null,
            cdd: null,
            weatherStationName: null,
            weatherStationNote: `Bu dönem (${rec.year}/${rec.month}) ve lokasyon ("${rec.city}") için resmi MGM HDD/CDD verisi bulunamadı.`,
          }).where(eq(consumptionTable.id, rec.id));
          noData++;
        }
      } catch (err: any) {
        errors.push(`id=${rec.id}: ${err?.message ?? err}`);
      }
    }

    res.json({
      message: dryRun ? "Kuru çalışma tamamlandı" : "Hava durumu yenileme tamamlandı",
      dryRun,
      total: records.length,
      updated,
      noData,
      skipped,
      errors: errors.slice(0, 20),
    });
  } catch (err) {
    if (isBadRequestError(err)) {
      res.status(400).json({ error: err.message }); return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

router.delete("/consumption/:id", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const id = parsePathId(req.params.id, "consumption id");
    if (!isPrivileged(role) && sessionUnitId === null) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    const [existing] = await db
      .select({
        companyId: consumptionTable.companyId,
        meterId: consumptionTable.meterId,
        year: consumptionTable.year,
        month: consumptionTable.month,
        kwh: consumptionTable.kwh,
        meterUnitId: metersTable.unitId,
        meterCompanyId: metersTable.companyId,
      })
      .from(consumptionTable)
      .leftJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
      .where(scopedConsumptionCondition(id, role, sessionCompanyId));
    if (!existing) { res.status(404).send(); return; }
    if (!isSuperAdmin(role) && existing.meterCompanyId !== sessionCompanyId) {
      res.status(404).send(); return;
    }
    if (!isPrivileged(role) && existing.meterUnitId !== sessionUnitId) {
      res.status(403).json({ error: "Yetki yok" }); return;
    }

    await db.transaction(async (tx) => {
      await writeAuditEvent(tx, {
        request: req,
        companyId: existing.companyId,
        unitId: existing.meterUnitId,
        action: "consumption.delete",
        entityType: "consumption",
        entityId: id,
        outcome: "success",
        changes: { deleted: { meterId: existing.meterId, year: existing.year, month: existing.month, kwh: existing.kwh } },
      });
      await tx.delete(consumptionTable).where(scopedConsumptionCondition(id, role, sessionCompanyId));
    });
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
