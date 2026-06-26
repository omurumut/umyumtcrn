/**
 * Internal Demo Export Script
 *
 * Şirket: "ISO 50001 Kontrol Demo"
 * Amaç: Internal demo şirketindeki tüm verileri JSON fixture dosyaları
 *       olarak lib/demo-data/internal/ klasörüne aktarır.
 *
 * Özellikler:
 * - Salt okunur: DB'ye hiçbir insert/update/delete yapmaz.
 * - DB id değerleri yerine stable key kullanır.
 * - Aynı isimden dolayı key çakışması olursa id suffix'i ekler.
 * - passwordHash export edilmez.
 * - createdAt/updatedAt export edilmez.
 * - MGM tabloları (mgm_stations, mgm_degree_data vb.) resmi global veri
 *   olduğundan internal demo scope'una dahil edilmez.
 *
 * Çalıştırma:
 *   pnpm --filter scripts export:internal
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq } from "drizzle-orm";
import { writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
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

// ── Çıktı klasörü ─────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_DIR = join(__dirname, "..", "..", "lib", "demo-data", "internal");

// ── Yardımcı fonksiyonlar ──────────────────────────────────────────────────

/** Türkçe karakterleri dönüştürüp URL-safe slug üretir (max 60 karakter). */
function slugify(text: string): string {
  return text
    .replace(/İ/g, "i").replace(/ı/g, "i")
    .replace(/Ş/g, "s").replace(/ş/g, "s")
    .replace(/Ğ/g, "g").replace(/ğ/g, "g")
    .replace(/Ü/g, "u").replace(/ü/g, "u")
    .replace(/Ö/g, "o").replace(/ö/g, "o")
    .replace(/Ç/g, "c").replace(/ç/g, "c")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 60);
}

/**
 * Verilen aday key'i registry'ye ekler ve döndürür.
 * Çakışma varsa sonuna `-{id}` suffix'i ekler.
 */
function makeUniqueKey(candidate: string, registry: Set<string>, id: number): string {
  if (!registry.has(candidate)) {
    registry.add(candidate);
    return candidate;
  }
  const withSuffix = `${candidate}-${id}`;
  registry.add(withSuffix);
  return withSuffix;
}

/** JSON dosyasını güzel formatlı yazar. */
async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

// ── Ana export fonksiyonu ──────────────────────────────────────────────────

async function exportInternal() {
  console.log("\n📦 Internal demo export başlatılıyor...");
  console.log("─────────────────────────────────────────────────────");

  // ── Şirketi bul ─────────────────────────────────────────────────────────
  const COMPANY_NAME = "ISO 50001 Kontrol Demo";
  const [company] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.name, COMPANY_NAME));

  if (!company) {
    console.error(`❌ Şirket bulunamadı: "${COMPANY_NAME}"`);
    console.error("   Önce seed:internal komutunu çalıştırın.");
    await pool.end();
    process.exit(1);
  }

  const companyId = company.id;
  console.log(`\n  Şirket: ${company.name} (id: ${companyId})`);

  // ── Çıktı klasörünü oluştur ──────────────────────────────────────────────
  await mkdir(OUTPUT_DIR, { recursive: true });
  console.log(`  Çıktı : ${OUTPUT_DIR}`);

  // ── Tüm verileri çek ────────────────────────────────────────────────────
  const [
    units,
    users,
    subUnits,
    energySources,
    energyUseGroups,
    meters,
    consumptionRows,
    swotItems,
    risks,
    riskNotes,
    seuItems,
    energyTargets,
    actionPlans,
    targetProgress,
    vapProjects,
    variables,
    variableValues,
  ] = await Promise.all([
    db.select().from(unitsTable).where(eq(unitsTable.companyId, companyId)),
    db.select().from(usersTable).where(eq(usersTable.companyId, companyId)),
    db.select().from(subUnitsTable).where(eq(subUnitsTable.companyId, companyId)),
    db.select().from(energySourcesTable).where(eq(energySourcesTable.companyId, companyId)),
    db.select().from(energyUseGroupsTable).where(eq(energyUseGroupsTable.companyId, companyId)),
    db.select().from(metersTable).where(eq(metersTable.companyId, companyId)),
    db.select().from(consumptionTable).where(eq(consumptionTable.companyId, companyId)),
    db.select().from(swotTable).where(eq(swotTable.companyId, companyId)),
    db.select().from(risksTable).where(eq(risksTable.companyId, companyId)),
    db.select().from(riskNotesTable).where(eq(riskNotesTable.companyId, companyId)),
    db.select().from(seuTable).where(eq(seuTable.companyId, companyId)),
    db.select().from(energyTargetsTable).where(eq(energyTargetsTable.companyId, companyId)),
    db.select().from(energyActionPlansTable).where(eq(energyActionPlansTable.companyId, companyId)),
    db.select().from(energyTargetProgressTable).where(eq(energyTargetProgressTable.companyId, companyId)),
    db.select().from(vapProjectsTable).where(eq(vapProjectsTable.companyId, companyId)),
    db.select().from(variablesTable).where(eq(variablesTable.companyId, companyId)),
    db.select().from(variableValuesTable).where(eq(variableValuesTable.companyId, companyId)),
  ]);

  // ── Stable key haritaları ────────────────────────────────────────────────

  // Unit keys
  const unitKeyRegistry = new Set<string>();
  const unitKeyMap = new Map<number, string>(); // id → key
  for (const u of units) {
    const key = makeUniqueKey(slugify(u.name), unitKeyRegistry, u.id);
    unitKeyMap.set(u.id, key);
  }

  // Sub-unit keys: unitKey + subUnit.name
  const subUnitKeyRegistry = new Set<string>();
  const subUnitKeyMap = new Map<number, string>();
  for (const s of subUnits) {
    const unitKey = unitKeyMap.get(s.unitId) ?? "unknown";
    const candidate = `${unitKey}--${slugify(s.name)}`;
    const key = makeUniqueKey(candidate, subUnitKeyRegistry, s.id);
    subUnitKeyMap.set(s.id, key);
  }

  // Energy source keys: unitKey + source.name
  const energySourceKeyRegistry = new Set<string>();
  const energySourceKeyMap = new Map<number, string>();
  for (const es of energySources) {
    const unitKey = unitKeyMap.get(es.unitId) ?? "unknown";
    const candidate = `${unitKey}--${slugify(es.name)}`;
    const key = makeUniqueKey(candidate, energySourceKeyRegistry, es.id);
    energySourceKeyMap.set(es.id, key);
  }

  // Energy use group keys: unitKey + (subUnitKey if set) + group.name
  const eugKeyRegistry = new Set<string>();
  const eugKeyMap = new Map<number, string>();
  for (const g of energyUseGroups) {
    const unitKey = g.unitId ? (unitKeyMap.get(g.unitId) ?? "unknown") : "company";
    const subKey = g.subUnitId ? (subUnitKeyMap.get(g.subUnitId) ?? "") : "";
    const prefix = subKey ? `${unitKey}--${subKey}` : unitKey;
    const candidate = `${prefix}--${slugify(g.name)}`;
    const key = makeUniqueKey(candidate, eugKeyRegistry, g.id);
    eugKeyMap.set(g.id, key);
  }

  // Meter keys: subUnitKey (if set) + meter.name, else unitKey + meter.name
  const meterKeyRegistry = new Set<string>();
  const meterKeyMap = new Map<number, string>();
  for (const m of meters) {
    const subKey = m.subUnitId ? (subUnitKeyMap.get(m.subUnitId) ?? "") : "";
    const unitKey = m.unitId ? (unitKeyMap.get(m.unitId) ?? "unknown") : "unknown";
    const prefix = subKey || unitKey;
    const candidate = `${prefix}--${slugify(m.name)}`;
    const key = makeUniqueKey(candidate, meterKeyRegistry, m.id);
    meterKeyMap.set(m.id, key);
  }

  // Variable keys: code if set, else slug of name
  const variableKeyRegistry = new Set<string>();
  const variableKeyMap = new Map<number, string>();
  for (const v of variables) {
    const candidate = v.code ? v.code.toLowerCase() : slugify(v.name);
    const key = makeUniqueKey(candidate, variableKeyRegistry, v.id);
    variableKeyMap.set(v.id, key);
  }

  // Risk key map (for risk notes): risk id → stable identifier (title slug)
  const riskKeyRegistry = new Set<string>();
  const riskKeyMap = new Map<number, string>();
  for (const r of risks) {
    const unitKey = r.unitId ? (unitKeyMap.get(r.unitId) ?? "unknown") : "company";
    const candidate = `${unitKey}--${slugify(r.title)}`;
    const key = makeUniqueKey(candidate, riskKeyRegistry, r.id);
    riskKeyMap.set(r.id, key);
  }

  // Energy target keys: unitKey + name
  const targetKeyRegistry = new Set<string>();
  const targetKeyMap = new Map<number, string>();
  for (const t of energyTargets) {
    const unitKey = t.unitId ? (unitKeyMap.get(t.unitId) ?? "unknown") : "company";
    const candidate = `${unitKey}--${slugify(t.name)}`;
    const key = makeUniqueKey(candidate, targetKeyRegistry, t.id);
    targetKeyMap.set(t.id, key);
  }

  // Action plan keys: targetKey + title slug
  const actionPlanKeyRegistry = new Set<string>();
  const actionPlanKeyMap = new Map<number, string>();
  for (const a of actionPlans) {
    const targetKey = targetKeyMap.get(a.targetId) ?? "unknown";
    const candidate = `${targetKey}--${slugify(a.title)}`;
    const key = makeUniqueKey(candidate, actionPlanKeyRegistry, a.id);
    actionPlanKeyMap.set(a.id, key);
  }

  // ── company.json ────────────────────────────────────────────────────────
  await writeJson(join(OUTPUT_DIR, "company.json"), {
    name: company.name,
    subdomain: company.subdomain,
    isActive: company.isActive,
  });

  // ── units.json ──────────────────────────────────────────────────────────
  const unitsOut = units.map((u) => ({
    unitKey: unitKeyMap.get(u.id)!,
    name: u.name,
    location: u.location,
    type: u.type,
    city: u.city,
    responsible: u.responsible,
    description: u.description,
    active: u.active,
    isDemo: u.isDemo,
  }));
  await writeJson(join(OUTPUT_DIR, "units.json"), unitsOut);

  // ── users.json ──────────────────────────────────────────────────────────
  const usersOut = users.map((u) => ({
    username: u.username,
    name: u.name,
    role: u.role,
    unitKey: u.unitId ? (unitKeyMap.get(u.unitId) ?? null) : null,
    active: u.active,
    isDemo: u.isDemo,
    // passwordHash intentionally omitted
  }));
  await writeJson(join(OUTPUT_DIR, "users.json"), usersOut);

  // ── sub-units.json ───────────────────────────────────────────────────────
  const subUnitsOut = subUnits.map((s) => ({
    subUnitKey: subUnitKeyMap.get(s.id)!,
    unitKey: unitKeyMap.get(s.unitId)!,
    name: s.name,
    city: s.city,
    description: s.description,
    active: s.active,
  }));
  await writeJson(join(OUTPUT_DIR, "sub-units.json"), subUnitsOut);

  // ── energy-sources.json ──────────────────────────────────────────────────
  const energySourcesOut = energySources.map((es) => ({
    energySourceKey: energySourceKeyMap.get(es.id)!,
    unitKey: unitKeyMap.get(es.unitId)!,
    type: es.type,
    name: es.name,
    unit: es.unit,
    active: es.active,
  }));
  await writeJson(join(OUTPUT_DIR, "energy-sources.json"), energySourcesOut);

  // ── energy-use-groups.json ───────────────────────────────────────────────
  const energyUseGroupsOut = energyUseGroups.map((g) => ({
    energyUseGroupKey: eugKeyMap.get(g.id)!,
    name: g.name,
    code: g.code,
    groupType: g.groupType,
    unitKey: g.unitId ? (unitKeyMap.get(g.unitId) ?? null) : null,
    subUnitKey: g.subUnitId ? (subUnitKeyMap.get(g.subUnitId) ?? null) : null,
    energySourceKey: g.energySourceId ? (energySourceKeyMap.get(g.energySourceId) ?? null) : null,
    description: g.description,
    isSeuCandidate: g.isSeuCandidate,
    isActive: g.isActive,
    createdBy: g.createdBy,
  }));
  await writeJson(join(OUTPUT_DIR, "energy-use-groups.json"), energyUseGroupsOut);

  // ── meters.json ─────────────────────────────────────────────────────────
  const metersOut = meters.map((m) => ({
    meterKey: meterKeyMap.get(m.id)!,
    name: m.name,
    type: m.type,
    recordType: m.recordType,
    location: m.location,
    city: m.city,
    unit: m.unit,
    description: m.description,
    unitKey: m.unitId ? (unitKeyMap.get(m.unitId) ?? null) : null,
    subUnitKey: m.subUnitId ? (subUnitKeyMap.get(m.subUnitId) ?? null) : null,
    energySourceKey: m.energySourceId ? (energySourceKeyMap.get(m.energySourceId) ?? null) : null,
    energyUseGroupKey: m.energyUseGroupId ? (eugKeyMap.get(m.energyUseGroupId) ?? null) : null,
  }));
  await writeJson(join(OUTPUT_DIR, "meters.json"), metersOut);

  // ── consumption.json ─────────────────────────────────────────────────────
  const consumptionOut = consumptionRows.map((c) => ({
    meterKey: meterKeyMap.get(c.meterId)!,
    year: c.year,
    month: c.month,
    kwh: c.kwh,
    tep: c.tep,
    co2: c.co2,
    hdd: c.hdd,
    cdd: c.cdd,
    notes: c.notes,
    weatherStationName: c.weatherStationName,
    weatherStationNote: c.weatherStationNote,
  }));
  await writeJson(join(OUTPUT_DIR, "consumption.json"), consumptionOut);

  // ── variables.json ───────────────────────────────────────────────────────
  const variablesOut = variables.map((v) => ({
    variableKey: variableKeyMap.get(v.id)!,
    name: v.name,
    code: v.code,
    category: v.category,
    unitLabel: v.unitLabel,
    variableType: v.variableType,
    sourceType: v.sourceType,
    scopeType: v.scopeType,
    description: v.description,
    isSystemVariable: v.isSystemVariable,
    isActive: v.isActive,
  }));
  await writeJson(join(OUTPUT_DIR, "variables.json"), variablesOut);

  // ── variable-values.json ─────────────────────────────────────────────────
  const variableValuesOut = variableValues.map((vv) => ({
    variableKey: variableKeyMap.get(vv.variableId)!,
    unitKey: vv.unitId ? (unitKeyMap.get(vv.unitId) ?? null) : null,
    subUnitKey: vv.subUnitId ? (subUnitKeyMap.get(vv.subUnitId) ?? null) : null,
    meterKey: vv.meterId ? (meterKeyMap.get(vv.meterId) ?? null) : null,
    periodStart: vv.periodStart,
    periodEnd: vv.periodEnd,
    periodType: vv.periodType,
    value: vv.value,
    source: vv.source,
    locationProvince: vv.locationProvince,
    locationDistrict: vv.locationDistrict,
    dataQuality: vv.dataQuality,
  }));
  await writeJson(join(OUTPUT_DIR, "variable-values.json"), variableValuesOut);

  // ── swot-items.json (boş veya dolu) ─────────────────────────────────────
  const swotOut = swotItems.map((s) => ({
    unitKey: s.unitId ? (unitKeyMap.get(s.unitId) ?? null) : null,
    category: s.category,
    title: s.title,
    description: s.description,
    score: s.score,
    impact: s.impact,
  }));
  await writeJson(join(OUTPUT_DIR, "swot-items.json"), swotOut);

  // ── risks.json ───────────────────────────────────────────────────────────
  const risksOut = risks.map((r) => ({
    riskKey: riskKeyMap.get(r.id)!,
    unitKey: r.unitId ? (unitKeyMap.get(r.unitId) ?? null) : null,
    type: r.type,
    title: r.title,
    description: r.description,
    foreseenImpact: r.foreseenImpact,
    probability: r.probability,
    severity: r.severity,
    score: r.score,
    responseType: r.responseType,
    mitigationPlan: r.mitigationPlan,
    targetProbability: r.targetProbability,
    targetSeverity: r.targetSeverity,
    targetScore: r.targetScore,
    owner: r.owner,
    status: r.status,
  }));
  await writeJson(join(OUTPUT_DIR, "risks.json"), risksOut);

  // ── risk-notes.json ──────────────────────────────────────────────────────
  const riskNotesOut = riskNotes.map((n) => ({
    riskKey: riskKeyMap.get(n.riskId)!,
    userName: n.userName,
    content: n.content,
  }));
  await writeJson(join(OUTPUT_DIR, "risk-notes.json"), riskNotesOut);

  // ── seu-items.json ───────────────────────────────────────────────────────
  const seuOut = seuItems.map((s) => ({
    unitKey: s.unitId ? (unitKeyMap.get(s.unitId) ?? null) : null,
    name: s.name,
    category: s.category,
    annualKwh: s.annualKwh,
    percentage: s.percentage,
    priority: s.priority,
    targetReductionPercent: s.targetReductionPercent,
    responsible: s.responsible,
    notes: s.notes,
  }));
  await writeJson(join(OUTPUT_DIR, "seu-items.json"), seuOut);

  // ── energy-targets.json ──────────────────────────────────────────────────
  const energyTargetsOut = energyTargets.map((t) => ({
    targetKey: targetKeyMap.get(t.id)!,
    unitKey: t.unitId ? (unitKeyMap.get(t.unitId) ?? null) : null,
    name: t.name,
    baselineYear: t.baselineYear,
    targetYear: t.targetYear,
    targetReductionPercent: t.targetReductionPercent,
    notes: t.notes,
  }));
  await writeJson(join(OUTPUT_DIR, "energy-targets.json"), energyTargetsOut);

  // ── energy-action-plans.json ─────────────────────────────────────────────
  const actionPlansOut = actionPlans.map((a) => ({
    actionPlanKey: actionPlanKeyMap.get(a.id)!,
    targetKey: targetKeyMap.get(a.targetId)!,
    title: a.title,
    description: a.description,
    responsibleName: a.responsibleName,
    priority: a.priority,
    expectedSavingValue: a.expectedSavingValue,
    expectedSavingUnit: a.expectedSavingUnit,
    expectedCostSaving: a.expectedCostSaving,
    investmentCost: a.investmentCost,
    paybackMonths: a.paybackMonths,
    startDate: a.startDate,
    dueDate: a.dueDate,
    completionDate: a.completionDate,
    progressPercent: a.progressPercent,
    status: a.status,
    isVap: a.isVap,
    notes: a.notes,
    createdBy: a.createdBy,
  }));
  await writeJson(join(OUTPUT_DIR, "energy-action-plans.json"), actionPlansOut);

  // ── energy-target-progress.json ──────────────────────────────────────────
  const progressOut = targetProgress.map((p) => ({
    targetKey: targetKeyMap.get(p.targetId)!,
    periodYear: p.periodYear,
    periodMonth: p.periodMonth,
    actualValue: p.actualValue,
    actualSavingValue: p.actualSavingValue,
    comment: p.comment,
    recordedBy: p.recordedBy,
  }));
  await writeJson(join(OUTPUT_DIR, "energy-target-progress.json"), progressOut);

  // ── vap-projects.json ────────────────────────────────────────────────────
  const vapOut = vapProjects.map((v) => ({
    actionPlanKey: actionPlanKeyMap.get(v.actionPlanId)!,
    projectCode: v.projectCode,
    projectTitle: v.projectTitle,
    projectType: v.projectType,
    currentSituation: v.currentSituation,
    proposedSolution: v.proposedSolution,
    technicalDescription: v.technicalDescription,
    annualEnergySavingValue: v.annualEnergySavingValue,
    annualEnergySavingUnit: v.annualEnergySavingUnit,
    annualCostSaving: v.annualCostSaving,
    investmentCost: v.investmentCost,
    paybackMonths: v.paybackMonths,
    co2ReductionTon: v.co2ReductionTon,
    measurementVerificationMethod: v.measurementVerificationMethod,
    incentiveStatus: v.incentiveStatus,
    feasibilityStatus: v.feasibilityStatus,
    startDate: v.startDate,
    endDate: v.endDate,
    status: v.status,
    notes: v.notes,
    createdBy: v.createdBy,
  }));
  await writeJson(join(OUTPUT_DIR, "vap-projects.json"), vapOut);

  // ── Özet ────────────────────────────────────────────────────────────────
  console.log(`\n─────────────────────────────────────────────────────`);
  console.log(`🎉 Export tamamlandı!\n`);
  console.log(`  Birimler               : ${units.length}`);
  console.log(`  Alt birimler           : ${subUnits.length}`);
  console.log(`  Enerji kaynakları      : ${energySources.length}`);
  console.log(`  Enerji kullanım grupları: ${energyUseGroups.length}`);
  console.log(`  Sayaçlar               : ${meters.length}`);
  console.log(`  Tüketim kayıtları      : ${consumptionRows.length}`);
  console.log(`  Kullanıcılar           : ${users.length} (passwordHash hariç)`);
  console.log(`  Değişkenler            : ${variables.length}`);
  console.log(`  Değişken değerleri     : ${variableValues.length}`);
  console.log(`  SWOT maddeleri         : ${swotItems.length}`);
  console.log(`  Riskler                : ${risks.length}`);
  console.log(`  Risk notları           : ${riskNotes.length}`);
  console.log(`  SEU / ÖEK              : ${seuItems.length}`);
  console.log(`  Enerji hedefleri       : ${energyTargets.length}`);
  console.log(`  Eylem planları         : ${actionPlans.length}`);
  console.log(`  Hedef ilerleme kayıtları: ${targetProgress.length}`);
  console.log(`  VAP projeleri          : ${vapProjects.length}`);
  console.log(`\n  Not: MGM tabloları (mgm_stations, mgm_degree_data) resmi global veri`);
  console.log(`       olduğundan internal demo kapsamı dışında bırakılmıştır.`);
  console.log(`\n  Çıktı klasörü: ${OUTPUT_DIR}`);
  console.log(`─────────────────────────────────────────────────────\n`);

  await pool.end();
}

exportInternal().catch((err) => {
  console.error("❌ Export hatası:", err);
  pool.end().finally(() => process.exit(1));
});
