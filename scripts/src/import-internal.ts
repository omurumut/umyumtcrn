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
 * - Mevcut kayıtlar varsa atlar, yenileri ekler.
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
  unitKey?: string | null;
  name: string;
  baselineYear: number;
  targetYear: number;
  targetReductionPercent: number;
  notes?: string | null;
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
    // Subdomain çakışması varsa mevcut şirketi isimle bulmaya çalış (zaten yapıldı)
    // Subdomain ile deneme yapalım
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
  const unitIdMap = new Map<string, number>();       // unitKey → id
  const subUnitIdMap = new Map<string, number>();    // subUnitKey → id
  const energySourceIdMap = new Map<string, number>(); // energySourceKey → id
  const eugIdMap = new Map<string, number>();        // energyUseGroupKey → id
  const meterIdMap = new Map<string, number>();      // meterKey → id
  const variableIdMap = new Map<string, number>();   // variableKey → id
  const riskIdMap = new Map<string, number>();       // riskKey → id

  // Sayaçlar
  let unitInserted = 0, unitSkipped = 0;
  let subUnitInserted = 0, subUnitSkipped = 0;
  let esInserted = 0, esSkipped = 0;
  let eugInserted = 0, eugSkipped = 0;
  let meterInserted = 0, meterSkipped = 0;
  let consumptionInserted = 0, consumptionSkipped = 0;
  let userInserted = 0, userSkipped = 0;
  let varInserted = 0, varSkipped = 0;

  // ── 2. Birimler ───────────────────────────────────────────────────────
  console.log("\n  📦 Birimler import ediliyor...");
  const unitsData = await readJson<UnitJson[]>("units.json");
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
  for (const g of eugData) {
    const unitId = g.unitKey ? (unitIdMap.get(g.unitKey) ?? null) : null;
    const subUnitId = g.subUnitKey ? (subUnitIdMap.get(g.subUnitKey) ?? null) : null;
    const energySourceId = g.energySourceKey ? (energySourceIdMap.get(g.energySourceKey) ?? null) : null;

    // Mevcut kayıt: companyId + name + (unitId varsa) eşleşmesi
    const existingRows = await db.select({ id: energyUseGroupsTable.id })
      .from(energyUseGroupsTable)
      .where(and(
        eq(energyUseGroupsTable.companyId, companyId),
        eq(energyUseGroupsTable.name, g.name),
      ));

    const existing = existingRows[0];

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
  for (const m of metersData) {
    const unitId = m.unitKey ? (unitIdMap.get(m.unitKey) ?? null) : null;
    const subUnitId = m.subUnitKey ? (subUnitIdMap.get(m.subUnitKey) ?? null) : null;
    const energySourceId = m.energySourceKey ? (energySourceIdMap.get(m.energySourceKey) ?? null) : null;
    const energyUseGroupId = m.energyUseGroupKey ? (eugIdMap.get(m.energyUseGroupKey) ?? null) : null;

    // Mevcut: companyId + name + subUnitId
    const conditions = subUnitId
      ? and(
          eq(metersTable.companyId, companyId),
          eq(metersTable.name, m.name),
          eq(metersTable.subUnitId, subUnitId),
        )
      : and(
          eq(metersTable.companyId, companyId),
          eq(metersTable.name, m.name),
        );

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

  // Mevcut sayaç id listesi
  const allMeterIds = [...meterIdMap.values()];

  // Tek sorguda tüm mevcut tüketim kayıtlarını çek (duplicate önleme)
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
        (company_id, meter_id, year, month, kwh, tep, co2, hdd, cdd, notes)
      VALUES
        (${companyId}, ${meterId}, ${c.year}, ${c.month},
         ${c.kwh ?? 0}, ${c.tep ?? 0}, ${c.co2 ?? 0},
         ${c.hdd ?? null}, ${c.cdd ?? null}, ${c.notes ?? null})
    `);

    existingSet.add(key); // aynı çalıştırmada tekrar eklemeyi önle
    consumptionInserted++;
  }
  console.log(`    Eklendi: ${consumptionInserted} | Atlandı: ${consumptionSkipped}`);
  trackInsert(consumptionInserted); trackSkip(consumptionSkipped);

  // ── 9. Değişkenler ────────────────────────────────────────────────────
  console.log("  📐 Değişkenler import ediliyor...");
  const variablesData = await readJson<VariableJson[]>("variables.json");
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
  let vvInserted = 0;
  for (const vv of variableValuesData) {
    const variableId = variableIdMap.get(vv.variableKey);
    if (!variableId) {
      console.warn(`    ⚠️  Değişken bulunamadı (variableKey: ${vv.variableKey}) — atlandı.`);
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
    vvInserted++;
  }
  console.log(`    Eklendi: ${vvInserted}`);
  trackInsert(vvInserted);

  // ── 11. SWOT maddeleri ────────────────────────────────────────────────
  console.log("  🔲 SWOT maddeleri import ediliyor...");
  const swotData = await readJson<SwotItemJson[]>("swot-items.json");
  let swotInserted = 0;
  for (const s of swotData) {
    await db.insert(swotTable).values({
      companyId,
      unitId: s.unitKey ? (unitIdMap.get(s.unitKey) ?? null) : null,
      category: s.category,
      title: s.title,
      description: s.description ?? null,
      score: s.score ?? 3,
      impact: s.impact ?? "orta",
    });
    swotInserted++;
  }
  console.log(`    Eklendi: ${swotInserted}`);
  trackInsert(swotInserted);

  // ── 12. Riskler ───────────────────────────────────────────────────────
  console.log("  ⚠️  Riskler import ediliyor...");
  const risksData = await readJson<RiskJson[]>("risks.json");
  for (const r of risksData) {
    const [row] = await db.insert(risksTable).values({
      companyId,
      unitId: r.unitKey ? (unitIdMap.get(r.unitKey) ?? null) : null,
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
  }
  console.log(`    Eklendi: ${risksData.length}`);
  trackInsert(risksData.length);

  // ── 13. Risk notları ──────────────────────────────────────────────────
  console.log("  📝 Risk notları import ediliyor...");
  const riskNotesData = await readJson<RiskNoteJson[]>("risk-notes.json");
  let rnInserted = 0;
  for (const n of riskNotesData) {
    const riskId = riskIdMap.get(n.riskKey);
    if (!riskId) {
      console.warn(`    ⚠️  Risk bulunamadı (riskKey: ${n.riskKey}) — not atlandı.`);
      continue;
    }
    await db.insert(riskNotesTable).values({
      companyId,
      riskId,
      userName: n.userName,
      content: n.content,
    });
    rnInserted++;
  }
  console.log(`    Eklendi: ${rnInserted}`);
  trackInsert(rnInserted);

  // ── 14. SEU / ÖEK ─────────────────────────────────────────────────────
  console.log("  🏭 SEU / ÖEK maddeleri import ediliyor...");
  const seuData = await readJson<SeuItemJson[]>("seu-items.json");
  let seuInserted = 0;
  for (const s of seuData) {
    await db.insert(seuTable).values({
      companyId,
      unitId: s.unitKey ? (unitIdMap.get(s.unitKey) ?? null) : null,
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
  console.log(`    Eklendi: ${seuInserted}`);
  trackInsert(seuInserted);

  // ── 15. Enerji hedefleri ───────────────────────────────────────────────
  console.log("  🎯 Enerji hedefleri import ediliyor...");
  const targetsData = await readJson<EnergyTargetJson[]>("energy-targets.json");
  let targetInserted = 0;
  for (const t of targetsData) {
    await db.insert(energyTargetsTable).values({
      companyId,
      unitId: t.unitKey ? (unitIdMap.get(t.unitKey) ?? null) : null,
      name: t.name,
      baselineYear: t.baselineYear,
      targetYear: t.targetYear,
      targetReductionPercent: t.targetReductionPercent,
      notes: t.notes ?? null,
    });
    targetInserted++;
  }
  console.log(`    Eklendi: ${targetInserted}`);
  trackInsert(targetInserted);

  // ── Özet ──────────────────────────────────────────────────────────────
  console.log(`\n─────────────────────────────────────────────────────`);
  console.log(`🎉 Import tamamlandı!\n`);
  console.log(`  Şirket            : 1 işlendi`);
  console.log(`  Birimler          : ${unitInserted} eklendi, ${unitSkipped} atlandı`);
  console.log(`  Alt birimler      : ${subUnitInserted} eklendi, ${subUnitSkipped} atlandı`);
  console.log(`  Enerji kaynakları : ${esInserted} eklendi, ${esSkipped} atlandı`);
  console.log(`  Enerji kullanım grupları: ${eugInserted} eklendi, ${eugSkipped} atlandı`);
  console.log(`  Sayaçlar          : ${meterInserted} eklendi, ${meterSkipped} atlandı`);
  console.log(`  Tüketim kayıtları : ${consumptionInserted} eklendi, ${consumptionSkipped} atlandı`);
  console.log(`  Kullanıcılar      : ${userInserted} eklendi, ${userSkipped} atlandı`);
  console.log(`  Değişkenler       : ${varInserted} eklendi, ${varSkipped} atlandı`);
  console.log(`\n  Toplam eklendi : ${totalInserted}`);
  console.log(`  Toplam atlandı : ${totalSkipped}`);
  console.log(`─────────────────────────────────────────────────────\n`);

  await pool.end();
}

importInternal().catch((err) => {
  console.error("❌ Import hatası:", err);
  pool.end().finally(() => process.exit(1));
});
