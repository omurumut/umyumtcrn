/**
 * Internal Demo Import Script
 *
 * Kaynak: lib/demo-data/internal/
 * Hedef : "ISO 50001 Kontrol Demo" şirketi (varsa bulur, yoksa oluşturur)
 *
 * Güvenlik:
 * - DB'ye hiçbir DELETE yapmaz.
 * - companyId=1'e kesinlikle dokunmaz.
 * - Sadece upsert / findOrCreate mantığı kullanır.
 * - Mevcut kayıtlar varsa atlar, yenileri ekler (idempotent).
 * - MGM tabloları dahil edilmez (resmi global veri).
 *
 * Çalıştırma:
 *   pnpm --filter scripts import:internal
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq, and, inArray, sql } from "drizzle-orm";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import {
  companiesTable,
  usersTable,
  unitsTable,
  subUnitsTable,
  energySourcesTable,
  energyUseGroupsTable,
  metersTable,
  consumptionTable,
  swotTable,
  risksTable,
  riskNotesTable,
  seuTable,
  energyTargetsTable,
  energyActionPlansTable,
  energyTargetProgressTable,
  vapProjectsTable,
  variablesTable,
  variableValuesTable,
} from "@workspace/db/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL env değişkeni tanımlı değil.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

// ── Kaynak klasör ──────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SOURCE_DIR = join(__dirname, "..", "..", "lib", "demo-data", "internal");

// ── Yardımcı fonksiyonlar ──────────────────────────────────────────────────

function hashPassword(password: string): string {
  return createHash("sha256").update(password + "eys_salt_2024").digest("hex");
}

async function readJson<T>(filename: string): Promise<T> {
  const filePath = join(SOURCE_DIR, filename);
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    console.error(`❌ Dosya okunamadı: ${filePath}`);
    throw new Error(`Kaynak dosya eksik: ${filename}`);
  }
}

// Sayaçlar
let totalInserted = 0;
let totalSkipped = 0;

function trackInsert(count: number) { totalInserted += count; }
function trackSkip(count: number) { totalSkipped += count; }

// ── JSON şema tipleri ──────────────────────────────────────────────────────

interface CompanyJson {
  name: string;
  subdomain: string;
  isActive: boolean;
}

interface UnitJson {
  unitKey: string;
  name: string;
  location: string;
  type: string;
  city: string;
  responsible?: string | null;
  description?: string | null;
  active: boolean;
  isDemo: boolean;
}

interface UserJson {
  username: string;
  name: string;
  role: string;
  unitKey: string | null;
  active: boolean;
  isDemo: boolean;
}

interface SubUnitJson {
  subUnitKey: string;
  unitKey: string;
  name: string;
  city: string;
  description?: string | null;
  active: boolean;
}

interface EnergySourceJson {
  energySourceKey: string;
  unitKey: string;
  type: string;
  name: string;
  unit: string;
  active: boolean;
}

interface EnergyUseGroupJson {
  energyUseGroupKey: string;
  name: string;
  code?: string | null;
  groupType: string;
  unitKey?: string | null;
  subUnitKey?: string | null;
  energySourceKey?: string | null;
  description?: string | null;
  isSeuCandidate: boolean;
  isActive: boolean;
  createdBy?: string | null;
}

interface MeterJson {
  meterKey: string;
  name: string;
  type: string;
  recordType: string;
  location: string;
  city: string;
  unit: string;
  description?: string | null;
  unitKey?: string | null;
  subUnitKey?: string | null;
  energySourceKey?: string | null;
  energyUseGroupKey?: string | null;
}

interface ConsumptionJson {
  meterKey: string;
  year: number;
  month: number;
  kwh: number;
  tep: number;
  co2: number;
  hdd?: number | null;
  cdd?: number | null;
  notes?: string | null;
  weatherStationName?: string | null;
  weatherStationNote?: string | null;
}

interface VariableJson {
  variableKey: string;
  name: string;
  code?: string | null;
  category: string;
  unitLabel?: string | null;
  variableType: string;
  sourceType: string;
  scopeType: string;
  description?: string | null;
  isSystemVariable: boolean;
  isActive: boolean;
}

interface VariableValueJson {
  variableKey: string;
  unitKey?: string | null;
  subUnitKey?: string | null;
  meterKey?: string | null;
  periodStart: string;
  periodEnd: string;
  periodType: string;
  value: number;
  source?: string | null;
  locationProvince?: string | null;
  locationDistrict?: string | null;
  dataQuality?: string | null;
}

interface SwotItemJson {
  unitKey?: string | null;
  category: string;
  title: string;
  description?: string | null;
  score: number;
  impact: string;
}

interface RiskJson {
  riskKey: string;
  unitKey?: string | null;
  type: string;
  title: string;
  description?: string | null;
  foreseenImpact?: string | null;
  probability: number;
  severity: number;
  score: number;
  responseType: string;
  mitigationPlan?: string | null;
  targetProbability?: number | null;
  targetSeverity?: number | null;
  targetScore?: number | null;
  owner?: string | null;
  status: string;
}

interface RiskNoteJson {
  riskKey: string;
  userName: string;
  content: string;
}

interface SeuItemJson {
  unitKey?: string | null;
  name: string;
  category: string;
  annualKwh: number;
  percentage: number;
  priority: number;
  targetReductionPercent?: number | null;
  responsible?: string | null;
  notes?: string | null;
}

interface EnergyTargetJson {
  targetKey: string;
  unitKey?: string | null;
  name: string;
  objectiveText?: string | null;
  targetText?: string | null;
  targetType?: string | null;
  baselineYear: number;
  baselineValue?: number | null;
  targetYear: number;
  targetValue?: number | null;
  actualValue?: number | null;
  unitLabel?: string | null;
  targetReductionPercent: number;
  status?: string | null;
  notes?: string | null;
}

interface EnergyActionPlanJson {
  actionPlanKey: string;
  targetKey: string;
  title: string;
  description?: string | null;
  responsibleName?: string | null;
  priority: string;
  expectedSavingValue?: number | null;
  expectedSavingUnit?: string | null;
  expectedCostSaving?: number | null;
  investmentCost?: number | null;
  paybackMonths?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  completionDate?: string | null;
  progressPercent: number;
  status: string;
  isVap: boolean;
  notes?: string | null;
  createdBy?: string | null;
}

interface EnergyTargetProgressJson {
  targetKey: string;
  periodYear: number;
  periodMonth?: number | null;
  actualValue: number;
  actualSavingValue?: number | null;
  comment?: string | null;
  recordedBy?: string | null;
}

interface VapProjectJson {
  actionPlanKey: string;
  projectCode?: string | null;
  projectTitle: string;
  projectType?: string | null;
  currentSituation?: string | null;
  proposedSolution?: string | null;
  technicalDescription?: string | null;
  annualEnergySavingValue?: number | null;
  annualEnergySavingUnit?: string | null;
  annualCostSaving?: number | null;
  investmentCost?: number | null;
  paybackMonths?: number | null;
  co2ReductionTon?: number | null;
  measurementVerificationMethod?: string | null;
  incentiveStatus?: string | null;
  feasibilityStatus?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status: string;
  notes?: string | null;
  createdBy?: string | null;
}

// ── Ana import fonksiyonu ──────────────────────────────────────────────────

async function importInternal() {
  console.log("\n📥 Internal demo import başlatılıyor...");
  console.log("─────────────────────────────────────────────────────");

  // ── 1. Şirket ─────────────────────────────────────────────────────────
  const companyData = await readJson<CompanyJson>("company.json");
  console.log(`\n  Şirket: ${companyData.name}`);

  let company = (
    await db.select().from(companiesTable).where(eq(companiesTable.name, companyData.name))
  )[0];

  if (!company) {
    const bySubdomain = (
      await db.select().from(companiesTable).where(eq(companiesTable.subdomain, companyData.subdomain))
    )[0];

    if (bySubdomain) {
      console.log(`  ⚠️  Subdomain çakışması — mevcut şirket kullanılıyor: "${bySubdomain.name}" (id: ${bySubdomain.id})`);
      company = bySubdomain;
      trackSkip(1);
    } else {
      await db.execute(sql`SELECT setval(pg_get_serial_sequence('"companies"', 'id'), COALESCE((SELECT MAX(id) FROM companies), 1), true)`);
      console.log("  🔧 companies sequence senkronize edildi");
      const [inserted] = await db.insert(companiesTable).values({
        name: companyData.name,
        subdomain: companyData.subdomain,
        isActive: companyData.isActive,
      }).returning();
      company = inserted;
      console.log(`  ✅ Şirket oluşturuldu (id: ${company.id})`);
      trackInsert(1);
    }
  } else {
    console.log(`  ℹ️  Mevcut şirket kullanılıyor (id: ${company.id})`);
    trackSkip(1);
  }

  const companyId = company.id;

  // Güvenlik: companyId=1'e dokunulmaması
  if (companyId === 1) {
    console.error("❌ Güvenlik ihlali: companyId=1 public demo şirketine dokunulamaz. Çıkılıyor.");
    await pool.end();
    process.exit(1);
  }

  // Key → DB id haritaları
  const unitIdMap = new Map<string, number>();
  const subUnitIdMap = new Map<string, number>();
  const energySourceIdMap = new Map<string, number>();
  const eugIdMap = new Map<string, number>();
  const meterIdMap = new Map<string, number>();
  const variableIdMap = new Map<string, number>();
  const riskIdMap = new Map<string, number>();
  const targetIdMap = new Map<string, number>();
  const actionPlanIdMap = new Map<string, number>();

  // ── 2. Birimler ───────────────────────────────────────────────────────
  console.log("\n  📦 Birimler import ediliyor...");
  const unitsData = await readJson<UnitJson[]>("units.json");
  let unitInserted = 0, unitSkipped = 0;
  for (const u of unitsData) {
    const existing = (
      await db.select({ id: unitsTable.id })
        .from(unitsTable)
        .where(and(eq(unitsTable.companyId, companyId), eq(unitsTable.name, u.name)))
    )[0];

    if (existing) {
      unitIdMap.set(u.unitKey, existing.id);
      unitSkipped++;
    } else {
      const [row] = await db.insert(unitsTable).values({
        companyId,
        name: u.name,
        location: u.location ?? "",
        type: u.type ?? "fabrika",
        city: u.city ?? "Istanbul",
        responsible: u.responsible ?? null,
        description: u.description ?? null,
        active: u.active ?? true,
        isDemo: u.isDemo ?? false,
      }).returning({ id: unitsTable.id });
      unitIdMap.set(u.unitKey, row.id);
      unitInserted++;
    }
  }
  console.log(`    Eklendi: ${unitInserted} | Atlandı: ${unitSkipped}`);
  trackInsert(unitInserted); trackSkip(unitSkipped);

  // ── 3. Kullanıcılar ───────────────────────────────────────────────────
  console.log("  👤 Kullanıcılar import ediliyor...");
  const usersData = await readJson<UserJson[]>("users.json");
  let userInserted = 0, userSkipped = 0;
  for (const u of usersData) {
    const existing = (
      await db.select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.username, u.username))
    )[0];

    if (existing) {
      userSkipped++;
    } else {
      const resolvedUnitId = u.unitKey ? (unitIdMap.get(u.unitKey) ?? null) : null;
      await db.insert(usersTable).values({
        companyId,
        username: u.username,
        passwordHash: hashPassword("admin123"),
        name: u.name,
        role: u.role ?? "user",
        unitId: resolvedUnitId,
        active: u.active ?? true,
        isDemo: u.isDemo ?? false,
      });
      userInserted++;
    }
  }
  console.log(`    Eklendi: ${userInserted} | Atlandı: ${userSkipped}`);
  trackInsert(userInserted); trackSkip(userSkipped);

  // ── 4. Alt birimler ───────────────────────────────────────────────────
  console.log("  🏢 Alt birimler import ediliyor...");
  const subUnitsData = await readJson<SubUnitJson[]>("sub-units.json");
  let subUnitInserted = 0, subUnitSkipped = 0;
  for (const s of subUnitsData) {
    const unitId = unitIdMap.get(s.unitKey);
    if (!unitId) {
      console.warn(`    ⚠️  Birim bulunamadı (unitKey: ${s.unitKey}) — ${s.name} atlandı.`);
      subUnitSkipped++;
      continue;
    }

    const existing = (
      await db.select({ id: subUnitsTable.id })
        .from(subUnitsTable)
        .where(and(eq(subUnitsTable.unitId, unitId), eq(subUnitsTable.name, s.name)))
    )[0];

    if (existing) {
      subUnitIdMap.set(s.subUnitKey, existing.id);
      subUnitSkipped++;
    } else {
      const [row] = await db.insert(subUnitsTable).values({
        companyId,
        unitId,
        name: s.name,
        city: s.city ?? "Istanbul",
        description: s.description ?? null,
        active: s.active ?? true,
      }).returning({ id: subUnitsTable.id });
      subUnitIdMap.set(s.subUnitKey, row.id);
      subUnitInserted++;
    }
  }
  console.log(`    Eklendi: ${subUnitInserted} | Atlandı: ${subUnitSkipped}`);
  trackInsert(subUnitInserted); trackSkip(subUnitSkipped);

  // ── 5. Enerji kaynakları ──────────────────────────────────────────────
  console.log("  ⚡ Enerji kaynakları import ediliyor...");
  const energySourcesData = await readJson<EnergySourceJson[]>("energy-sources.json");
  let esInserted = 0, esSkipped = 0;
  for (const es of energySourcesData) {
    const unitId = unitIdMap.get(es.unitKey);
    if (!unitId) {
      console.warn(`    ⚠️  Birim bulunamadı (unitKey: ${es.unitKey}) — ${es.name} atlandı.`);
      esSkipped++;
      continue;
    }

    const existing = (
      await db.select({ id: energySourcesTable.id })
        .from(energySourcesTable)
        .where(and(eq(energySourcesTable.unitId, unitId), eq(energySourcesTable.name, es.name)))
    )[0];

    if (existing) {
      energySourceIdMap.set(es.energySourceKey, existing.id);
      esSkipped++;
    } else {
      const [row] = await db.insert(energySourcesTable).values({
        companyId,
        unitId,
        type: es.type,
        name: es.name,
        unit: es.unit ?? "kWh",
        active: es.active ?? true,
      }).returning({ id: energySourcesTable.id });
      energySourceIdMap.set(es.energySourceKey, row.id);
      esInserted++;
    }
  }
  console.log(`    Eklendi: ${esInserted} | Atlandı: ${esSkipped}`);
  trackInsert(esInserted); trackSkip(esSkipped);

  // ── 6. Enerji kullanım grupları ───────────────────────────────────────
  console.log("  🗂️  Enerji kullanım grupları import ediliyor...");
  const eugData = await readJson<EnergyUseGroupJson[]>("energy-use-groups.json");
  let eugInserted = 0, eugSkipped = 0;
  for (const g of eugData) {
    const unitId = g.unitKey ? (unitIdMap.get(g.unitKey) ?? null) : null;
    const subUnitId = g.subUnitKey ? (subUnitIdMap.get(g.subUnitKey) ?? null) : null;
    const energySourceId = g.energySourceKey ? (energySourceIdMap.get(g.energySourceKey) ?? null) : null;

    const existing = (
      await db.select({ id: energyUseGroupsTable.id })
        .from(energyUseGroupsTable)
        .where(and(
          eq(energyUseGroupsTable.companyId, companyId),
          eq(energyUseGroupsTable.name, g.name),
        ))
    )[0];

    if (existing) {
      eugIdMap.set(g.energyUseGroupKey, existing.id);
      eugSkipped++;
    } else {
      const [row] = await db.insert(energyUseGroupsTable).values({
        companyId,
        name: g.name,
        code: g.code ?? null,
        groupType: g.groupType ?? "other",
        unitId,
        subUnitId,
        energySourceId,
        description: g.description ?? null,
        isSeuCandidate: g.isSeuCandidate ?? false,
        isActive: g.isActive ?? true,
        createdBy: g.createdBy ?? null,
      }).returning({ id: energyUseGroupsTable.id });
      eugIdMap.set(g.energyUseGroupKey, row.id);
      eugInserted++;
    }
  }
  console.log(`    Eklendi: ${eugInserted} | Atlandı: ${eugSkipped}`);
  trackInsert(eugInserted); trackSkip(eugSkipped);

  // ── 7. Sayaçlar ───────────────────────────────────────────────────────
  console.log("  🔌 Sayaçlar import ediliyor...");
  const metersData = await readJson<MeterJson[]>("meters.json");
  let meterInserted = 0, meterSkipped = 0;
  for (const m of metersData) {
    const unitId = m.unitKey ? (unitIdMap.get(m.unitKey) ?? null) : null;
    const subUnitId = m.subUnitKey ? (subUnitIdMap.get(m.subUnitKey) ?? null) : null;
    const energySourceId = m.energySourceKey ? (energySourceIdMap.get(m.energySourceKey) ?? null) : null;
    const energyUseGroupId = m.energyUseGroupKey ? (eugIdMap.get(m.energyUseGroupKey) ?? null) : null;

    const conditions = subUnitId
      ? and(eq(metersTable.companyId, companyId), eq(metersTable.name, m.name), eq(metersTable.subUnitId, subUnitId))
      : and(eq(metersTable.companyId, companyId), eq(metersTable.name, m.name));

    const existing = (
      await db.select({ id: metersTable.id }).from(metersTable).where(conditions)
    )[0];

    if (existing) {
      meterIdMap.set(m.meterKey, existing.id);
      meterSkipped++;
    } else {
      const [row] = await db.insert(metersTable).values({
        companyId,
        unitId,
        subUnitId,
        energySourceId,
        energyUseGroupId,
        name: m.name,
        type: m.type,
        recordType: m.recordType ?? "physical_meter",
        location: m.location ?? "",
        city: m.city ?? "Istanbul",
        unit: m.unit,
        description: m.description ?? null,
      }).returning({ id: metersTable.id });
      meterIdMap.set(m.meterKey, row.id);
      meterInserted++;
    }
  }
  console.log(`    Eklendi: ${meterInserted} | Atlandı: ${meterSkipped}`);
  trackInsert(meterInserted); trackSkip(meterSkipped);

  // ── 8. Tüketim ────────────────────────────────────────────────────────
  console.log("  📊 Tüketim kayıtları import ediliyor...");
  const consumptionData = await readJson<ConsumptionJson[]>("consumption.json");

  const allMeterIds = [...meterIdMap.values()];
  const existingConsumption = allMeterIds.length > 0
    ? await db.select({
        meterId: consumptionTable.meterId,
        year: consumptionTable.year,
        month: consumptionTable.month,
      })
      .from(consumptionTable)
      .where(inArray(consumptionTable.meterId, allMeterIds))
    : [];

  const existingSet = new Set(
    existingConsumption.map((c) => `${c.meterId}:${c.year}:${c.month}`)
  );

  let consumptionInserted = 0, consumptionSkipped = 0;
  for (const c of consumptionData) {
    const meterId = meterIdMap.get(c.meterKey);
    if (!meterId) {
      console.warn(`    ⚠️  Sayaç bulunamadı (meterKey: ${c.meterKey}) — atlandı.`);
      consumptionSkipped++;
      continue;
    }

    const key = `${meterId}:${c.year}:${c.month}`;
    if (existingSet.has(key)) {
      consumptionSkipped++;
      continue;
    }

    await db.execute(sql`
      INSERT INTO consumption
        (company_id, meter_id, year, month, kwh, tep, co2, hdd, cdd, notes, weather_station_name, weather_station_note)
      VALUES
        (${companyId}, ${meterId}, ${c.year}, ${c.month},
         ${c.kwh ?? 0}, ${c.tep ?? 0}, ${c.co2 ?? 0},
         ${c.hdd ?? null}, ${c.cdd ?? null}, ${c.notes ?? null},
         ${c.weatherStationName ?? null}, ${c.weatherStationNote ?? null})
    `);

    existingSet.add(key);
    consumptionInserted++;
  }
  console.log(`    Eklendi: ${consumptionInserted} | Atlandı: ${consumptionSkipped}`);
  trackInsert(consumptionInserted); trackSkip(consumptionSkipped);

  // ── 9. Değişkenler ────────────────────────────────────────────────────
  console.log("  📐 Değişkenler import ediliyor...");
  const variablesData = await readJson<VariableJson[]>("variables.json");
  let varInserted = 0, varSkipped = 0;
  for (const v of variablesData) {
    const existing = (
      await db.select({ id: variablesTable.id })
        .from(variablesTable)
        .where(and(eq(variablesTable.companyId, companyId), eq(variablesTable.name, v.name)))
    )[0];

    if (existing) {
      variableIdMap.set(v.variableKey, existing.id);
      varSkipped++;
    } else {
      const [row] = await db.insert(variablesTable).values({
        companyId,
        name: v.name,
        code: v.code ?? null,
        category: v.category ?? "operational",
        unitLabel: v.unitLabel ?? null,
        variableType: v.variableType ?? "numeric",
        sourceType: v.sourceType ?? "operation_manual",
        scopeType: v.scopeType ?? "company",
        description: v.description ?? null,
        isSystemVariable: v.isSystemVariable ?? false,
        isActive: v.isActive ?? true,
      }).returning({ id: variablesTable.id });
      variableIdMap.set(v.variableKey, row.id);
      varInserted++;
    }
  }
  console.log(`    Eklendi: ${varInserted} | Atlandı: ${varSkipped}`);
  trackInsert(varInserted); trackSkip(varSkipped);

  // ── 10. Değişken değerleri ────────────────────────────────────────────
  console.log("  📈 Değişken değerleri import ediliyor...");
  const variableValuesData = await readJson<VariableValueJson[]>("variable-values.json");

  // Mevcut değişken değerlerini çek (variableId + periodStart + periodEnd kombinasyonu)
  const allVarIds = [...variableIdMap.values()];
  const existingVarValues = allVarIds.length > 0
    ? await db.select({
        variableId: variableValuesTable.variableId,
        periodStart: variableValuesTable.periodStart,
        periodEnd: variableValuesTable.periodEnd,
      })
      .from(variableValuesTable)
      .where(and(
        eq(variableValuesTable.companyId, companyId),
        inArray(variableValuesTable.variableId, allVarIds),
      ))
    : [];

  const existingVvSet = new Set(
    existingVarValues.map((vv) => `${vv.variableId}:${vv.periodStart}:${vv.periodEnd}`)
  );

  let vvInserted = 0, vvSkipped = 0;
  for (const vv of variableValuesData) {
    const variableId = variableIdMap.get(vv.variableKey);
    if (!variableId) {
      console.warn(`    ⚠️  Değişken bulunamadı (variableKey: ${vv.variableKey}) — atlandı.`);
      vvSkipped++;
      continue;
    }

    const vvKey = `${variableId}:${vv.periodStart}:${vv.periodEnd}`;
    if (existingVvSet.has(vvKey)) {
      vvSkipped++;
      continue;
    }

    await db.insert(variableValuesTable).values({
      companyId,
      variableId,
      unitId: vv.unitKey ? (unitIdMap.get(vv.unitKey) ?? null) : null,
      subUnitId: vv.subUnitKey ? (subUnitIdMap.get(vv.subUnitKey) ?? null) : null,
      meterId: vv.meterKey ? (meterIdMap.get(vv.meterKey) ?? null) : null,
      periodStart: vv.periodStart,
      periodEnd: vv.periodEnd,
      periodType: vv.periodType ?? "monthly",
      value: vv.value,
      source: vv.source ?? null,
      locationProvince: vv.locationProvince ?? null,
      locationDistrict: vv.locationDistrict ?? null,
      dataQuality: vv.dataQuality ?? null,
    });
    existingVvSet.add(vvKey);
    vvInserted++;
  }
  console.log(`    Eklendi: ${vvInserted} | Atlandı: ${vvSkipped}`);
  trackInsert(vvInserted); trackSkip(vvSkipped);

  // ── 11. SWOT maddeleri ────────────────────────────────────────────────
  console.log("  🔲 SWOT maddeleri import ediliyor...");
  const swotData = await readJson<SwotItemJson[]>("swot-items.json");
  let swotInserted = 0, swotSkipped = 0;
  for (const s of swotData) {
    const unitId = s.unitKey ? (unitIdMap.get(s.unitKey) ?? null) : null;

    // Unique: companyId + category + title (+ unitId)
    const existing = (
      await db.select({ id: swotTable.id })
        .from(swotTable)
        .where(and(
          eq(swotTable.companyId, companyId),
          eq(swotTable.category, s.category),
          eq(swotTable.title, s.title),
        ))
    )[0];

    if (existing) {
      swotSkipped++;
      continue;
    }

    await db.insert(swotTable).values({
      companyId,
      unitId,
      category: s.category,
      title: s.title,
      description: s.description ?? null,
      score: s.score ?? 3,
      impact: s.impact ?? "orta",
    });
    swotInserted++;
  }
  console.log(`    Eklendi: ${swotInserted} | Atlandı: ${swotSkipped}`);
  trackInsert(swotInserted); trackSkip(swotSkipped);

  // ── 12. Riskler ───────────────────────────────────────────────────────
  console.log("  ⚠️  Riskler import ediliyor...");
  const risksData = await readJson<RiskJson[]>("risks.json");
  let riskInserted = 0, riskSkipped = 0;
  for (const r of risksData) {
    const unitId = r.unitKey ? (unitIdMap.get(r.unitKey) ?? null) : null;

    // Unique: companyId + title
    const existing = (
      await db.select({ id: risksTable.id })
        .from(risksTable)
        .where(and(
          eq(risksTable.companyId, companyId),
          eq(risksTable.title, r.title),
        ))
    )[0];

    if (existing) {
      riskIdMap.set(r.riskKey, existing.id);
      riskSkipped++;
      continue;
    }

    const [row] = await db.insert(risksTable).values({
      companyId,
      unitId,
      type: r.type ?? "risk",
      title: r.title,
      description: r.description ?? null,
      foreseenImpact: r.foreseenImpact ?? null,
      probability: r.probability ?? 3,
      severity: r.severity ?? 3,
      score: r.score ?? 9,
      responseType: r.responseType ?? "izleme",
      mitigationPlan: r.mitigationPlan ?? null,
      targetProbability: r.targetProbability ?? null,
      targetSeverity: r.targetSeverity ?? null,
      targetScore: r.targetScore ?? null,
      owner: r.owner ?? null,
      status: r.status ?? "acik",
    }).returning({ id: risksTable.id });
    riskIdMap.set(r.riskKey, row.id);
    riskInserted++;
  }
  console.log(`    Eklendi: ${riskInserted} | Atlandı: ${riskSkipped}`);
  trackInsert(riskInserted); trackSkip(riskSkipped);

  // ── 13. Risk notları ──────────────────────────────────────────────────
  console.log("  📝 Risk notları import ediliyor...");
  const riskNotesData = await readJson<RiskNoteJson[]>("risk-notes.json");
  let rnInserted = 0, rnSkipped = 0;

  // Mevcut risk notlarını çek (riskId + content hash kombinasyonu)
  const allRiskIds = [...riskIdMap.values()];
  const existingNotes = allRiskIds.length > 0
    ? await db.select({ riskId: riskNotesTable.riskId, content: riskNotesTable.content })
        .from(riskNotesTable)
        .where(inArray(riskNotesTable.riskId, allRiskIds))
    : [];
  const existingNoteSet = new Set(existingNotes.map((n) => `${n.riskId}:${n.content}`));

  for (const n of riskNotesData) {
    const riskId = riskIdMap.get(n.riskKey);
    if (!riskId) {
      console.warn(`    ⚠️  Risk bulunamadı (riskKey: ${n.riskKey}) — not atlandı.`);
      rnSkipped++;
      continue;
    }

    const noteKey = `${riskId}:${n.content}`;
    if (existingNoteSet.has(noteKey)) {
      rnSkipped++;
      continue;
    }

    await db.insert(riskNotesTable).values({
      companyId,
      riskId,
      userName: n.userName,
      content: n.content,
    });
    existingNoteSet.add(noteKey);
    rnInserted++;
  }
  console.log(`    Eklendi: ${rnInserted} | Atlandı: ${rnSkipped}`);
  trackInsert(rnInserted); trackSkip(rnSkipped);

  // ── 14. SEU / ÖEK ─────────────────────────────────────────────────────
  console.log("  🏭 SEU / ÖEK maddeleri import ediliyor...");
  const seuData = await readJson<SeuItemJson[]>("seu-items.json");
  let seuInserted = 0, seuSkipped = 0;
  for (const s of seuData) {
    const unitId = s.unitKey ? (unitIdMap.get(s.unitKey) ?? null) : null;

    // Unique: companyId + name (+ unitId)
    const existing = (
      await db.select({ id: seuTable.id })
        .from(seuTable)
        .where(and(
          eq(seuTable.companyId, companyId),
          eq(seuTable.name, s.name),
        ))
    )[0];

    if (existing) {
      seuSkipped++;
      continue;
    }

    await db.insert(seuTable).values({
      companyId,
      unitId,
      name: s.name,
      category: s.category,
      annualKwh: s.annualKwh ?? 0,
      percentage: s.percentage ?? 0,
      priority: s.priority ?? 1,
      targetReductionPercent: s.targetReductionPercent ?? null,
      responsible: s.responsible ?? null,
      notes: s.notes ?? null,
    });
    seuInserted++;
  }
  console.log(`    Eklendi: ${seuInserted} | Atlandı: ${seuSkipped}`);
  trackInsert(seuInserted); trackSkip(seuSkipped);

  // ── 15. Enerji hedefleri ───────────────────────────────────────────────
  console.log("  🎯 Enerji hedefleri import ediliyor...");
  const targetsData = await readJson<EnergyTargetJson[]>("energy-targets.json");
  let targetInserted = 0, targetSkipped = 0;
  for (const t of targetsData) {
    const unitId = t.unitKey ? (unitIdMap.get(t.unitKey) ?? null) : null;

    // Unique: companyId + name + baselineYear + targetYear
    const existing = (
      await db.select({ id: energyTargetsTable.id })
        .from(energyTargetsTable)
        .where(and(
          eq(energyTargetsTable.companyId, companyId),
          eq(energyTargetsTable.name, t.name),
          eq(energyTargetsTable.baselineYear, t.baselineYear),
          eq(energyTargetsTable.targetYear, t.targetYear),
        ))
    )[0];

    if (existing) {
      targetIdMap.set(t.targetKey, existing.id);
      targetSkipped++;
      continue;
    }

    const [row] = await db.insert(energyTargetsTable).values({
      companyId,
      unitId,
      name: t.name,
      objectiveText: t.objectiveText ?? null,
      targetText: t.targetText ?? null,
      targetType: t.targetType ?? null,
      baselineYear: t.baselineYear,
      baselineValue: t.baselineValue ?? null,
      targetYear: t.targetYear,
      targetValue: t.targetValue ?? null,
      actualValue: t.actualValue ?? null,
      unitLabel: t.unitLabel ?? null,
      targetReductionPercent: t.targetReductionPercent,
      status: t.status ?? "active",
      notes: t.notes ?? null,
    }).returning({ id: energyTargetsTable.id });
    targetIdMap.set(t.targetKey, row.id);
    targetInserted++;
  }
  console.log(`    Eklendi: ${targetInserted} | Atlandı: ${targetSkipped}`);
  trackInsert(targetInserted); trackSkip(targetSkipped);

  // ── 16. Eylem planları ─────────────────────────────────────────────────
  console.log("  📋 Eylem planları import ediliyor...");
  const actionPlansData = await readJson<EnergyActionPlanJson[]>("energy-action-plans.json");
  let apInserted = 0, apSkipped = 0;
  for (const a of actionPlansData) {
    const targetId = targetIdMap.get(a.targetKey);
    if (!targetId) {
      console.warn(`    ⚠️  Hedef bulunamadı (targetKey: ${a.targetKey}) — eylem planı atlandı.`);
      apSkipped++;
      continue;
    }

    // Unique: companyId + targetId + title
    const existing = (
      await db.select({ id: energyActionPlansTable.id })
        .from(energyActionPlansTable)
        .where(and(
          eq(energyActionPlansTable.companyId, companyId),
          eq(energyActionPlansTable.targetId, targetId),
          eq(energyActionPlansTable.title, a.title),
        ))
    )[0];

    if (existing) {
      actionPlanIdMap.set(a.actionPlanKey, existing.id);
      apSkipped++;
      continue;
    }

    const [row] = await db.insert(energyActionPlansTable).values({
      companyId,
      targetId,
      title: a.title,
      description: a.description ?? null,
      responsibleName: a.responsibleName ?? null,
      priority: a.priority ?? "medium",
      expectedSavingValue: a.expectedSavingValue ?? null,
      expectedSavingUnit: a.expectedSavingUnit ?? null,
      expectedCostSaving: a.expectedCostSaving ?? null,
      investmentCost: a.investmentCost ?? null,
      paybackMonths: a.paybackMonths ?? null,
      startDate: a.startDate ?? null,
      dueDate: a.dueDate ?? null,
      completionDate: a.completionDate ?? null,
      progressPercent: a.progressPercent ?? 0,
      status: a.status ?? "planned",
      isVap: a.isVap ?? false,
      notes: a.notes ?? null,
      createdBy: a.createdBy ?? null,
    }).returning({ id: energyActionPlansTable.id });
    actionPlanIdMap.set(a.actionPlanKey, row.id);
    apInserted++;
  }
  console.log(`    Eklendi: ${apInserted} | Atlandı: ${apSkipped}`);
  trackInsert(apInserted); trackSkip(apSkipped);

  // ── 17. Hedef ilerleme kayıtları ──────────────────────────────────────
  console.log("  📈 Hedef ilerleme kayıtları import ediliyor...");
  const progressData = await readJson<EnergyTargetProgressJson[]>("energy-target-progress.json");
  let progInserted = 0, progSkipped = 0;
  for (const p of progressData) {
    const targetId = targetIdMap.get(p.targetKey);
    if (!targetId) {
      console.warn(`    ⚠️  Hedef bulunamadı (targetKey: ${p.targetKey}) — ilerleme kaydı atlandı.`);
      progSkipped++;
      continue;
    }

    // Unique: companyId + targetId + periodYear + periodMonth
    const existing = (
      await db.select({ id: energyTargetProgressTable.id })
        .from(energyTargetProgressTable)
        .where(and(
          eq(energyTargetProgressTable.companyId, companyId),
          eq(energyTargetProgressTable.targetId, targetId),
          eq(energyTargetProgressTable.periodYear, p.periodYear),
          p.periodMonth != null
            ? eq(energyTargetProgressTable.periodMonth, p.periodMonth)
            : sql`period_month IS NULL`,
        ))
    )[0];

    if (existing) {
      progSkipped++;
      continue;
    }

    await db.insert(energyTargetProgressTable).values({
      companyId,
      targetId,
      periodYear: p.periodYear,
      periodMonth: p.periodMonth ?? null,
      actualValue: p.actualValue,
      actualSavingValue: p.actualSavingValue ?? null,
      comment: p.comment ?? null,
      recordedBy: p.recordedBy ?? null,
    });
    progInserted++;
  }
  console.log(`    Eklendi: ${progInserted} | Atlandı: ${progSkipped}`);
  trackInsert(progInserted); trackSkip(progSkipped);

  // ── 18. VAP projeleri ─────────────────────────────────────────────────
  console.log("  🏗️  VAP projeleri import ediliyor...");
  const vapData = await readJson<VapProjectJson[]>("vap-projects.json");
  let vapInserted = 0, vapSkipped = 0;
  for (const v of vapData) {
    const actionPlanId = actionPlanIdMap.get(v.actionPlanKey);
    if (!actionPlanId) {
      console.warn(`    ⚠️  Eylem planı bulunamadı (actionPlanKey: ${v.actionPlanKey}) — VAP projesi atlandı.`);
      vapSkipped++;
      continue;
    }

    // Unique: companyId + actionPlanId + projectTitle
    const existing = (
      await db.select({ id: vapProjectsTable.id })
        .from(vapProjectsTable)
        .where(and(
          eq(vapProjectsTable.companyId, companyId),
          eq(vapProjectsTable.actionPlanId, actionPlanId),
          eq(vapProjectsTable.projectTitle, v.projectTitle),
        ))
    )[0];

    if (existing) {
      vapSkipped++;
      continue;
    }

    await db.insert(vapProjectsTable).values({
      companyId,
      actionPlanId,
      projectCode: v.projectCode ?? null,
      projectTitle: v.projectTitle,
      projectType: v.projectType ?? null,
      currentSituation: v.currentSituation ?? null,
      proposedSolution: v.proposedSolution ?? null,
      technicalDescription: v.technicalDescription ?? null,
      annualEnergySavingValue: v.annualEnergySavingValue ?? null,
      annualEnergySavingUnit: v.annualEnergySavingUnit ?? null,
      annualCostSaving: v.annualCostSaving ?? null,
      investmentCost: v.investmentCost ?? null,
      paybackMonths: v.paybackMonths ?? null,
      co2ReductionTon: v.co2ReductionTon ?? null,
      measurementVerificationMethod: v.measurementVerificationMethod ?? null,
      incentiveStatus: v.incentiveStatus ?? "none",
      feasibilityStatus: v.feasibilityStatus ?? "not_started",
      startDate: v.startDate ?? null,
      endDate: v.endDate ?? null,
      status: v.status ?? "idea",
      notes: v.notes ?? null,
      createdBy: v.createdBy ?? null,
    });
    vapInserted++;
  }
  console.log(`    Eklendi: ${vapInserted} | Atlandı: ${vapSkipped}`);
  trackInsert(vapInserted); trackSkip(vapSkipped);

  // ── Sequence senkronizasyonu ──────────────────────────────────────────
  console.log("\n  🔧 Sequence'ler senkronize ediliyor...");
  const tables = [
    "companies", "units", "users", "sub_units", "energy_sources",
    "energy_use_groups", "meters", "consumption", "variables", "variable_values",
    "swot_items", "risks", "risk_notes", "seu_assessment_items",
    "energy_targets", "energy_action_plans", "energy_target_progress", "vap_projects",
  ];
  for (const table of tables) {
    try {
      await db.execute(
        sql.raw(`SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 1), true)`)
      );
    } catch {
      // Sequence yoksa atla (örn. sequence olmayan tablolar)
    }
  }
  console.log("    ✅ Tüm sequence'ler güncellendi");

  // ── Özet ──────────────────────────────────────────────────────────────
  console.log(`\n─────────────────────────────────────────────────────`);
  console.log(`🎉 Import tamamlandı!\n`);
  console.log(`  Birimler               : ${unitInserted} eklendi, ${unitSkipped} atlandı`);
  console.log(`  Alt birimler           : ${subUnitInserted} eklendi, ${subUnitSkipped} atlandı`);
  console.log(`  Enerji kaynakları      : ${esInserted} eklendi, ${esSkipped} atlandı`);
  console.log(`  Enerji kullanım grupları: ${eugInserted} eklendi, ${eugSkipped} atlandı`);
  console.log(`  Sayaçlar               : ${meterInserted} eklendi, ${meterSkipped} atlandı`);
  console.log(`  Tüketim kayıtları      : ${consumptionInserted} eklendi, ${consumptionSkipped} atlandı`);
  console.log(`  Kullanıcılar           : ${userInserted} eklendi, ${userSkipped} atlandı`);
  console.log(`  Değişkenler            : ${varInserted} eklendi, ${varSkipped} atlandı`);
  console.log(`  Değişken değerleri     : ${vvInserted} eklendi, ${vvSkipped} atlandı`);
  console.log(`  SWOT maddeleri         : ${swotInserted} eklendi, ${swotSkipped} atlandı`);
  console.log(`  Riskler                : ${riskInserted} eklendi, ${riskSkipped} atlandı`);
  console.log(`  Risk notları           : ${rnInserted} eklendi, ${rnSkipped} atlandı`);
  console.log(`  SEU / ÖEK              : ${seuInserted} eklendi, ${seuSkipped} atlandı`);
  console.log(`  Enerji hedefleri       : ${targetInserted} eklendi, ${targetSkipped} atlandı`);
  console.log(`  Eylem planları         : ${apInserted} eklendi, ${apSkipped} atlandı`);
  console.log(`  Hedef ilerleme         : ${progInserted} eklendi, ${progSkipped} atlandı`);
  console.log(`  VAP projeleri          : ${vapInserted} eklendi, ${vapSkipped} atlandı`);
  console.log(`\n  Toplam eklendi : ${totalInserted}`);
  console.log(`  Toplam atlandı : ${totalSkipped}`);
  console.log(`─────────────────────────────────────────────────────\n`);

  await pool.end();
}

importInternal().catch((err) => {
  console.error("❌ Import hatası:", err);
  pool.end().finally(() => process.exit(1));
});
