/**
 * Internal Demo Seed Script
 *
 * Şirket: "ISO 50001 Kontrol Demo"
 * Amaç: Kişisel/internal test verilerinin ayrı bir şirket altında
 *       güvenli biçimde yüklenmesi.
 *
 * Özellikler:
 * - Tamamen idempotent: aynı veri varsa atlar, yoksa ekler.
 * - Mevcut public demo (companyId: 1) verilerine hiç dokunmaz.
 * - DATABASE_URL env değişkeni ile çalışır.
 *
 * Çalıştırma:
 *   pnpm --filter scripts seed:internal
 */

import { createHash } from "crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq, and, sql } from "drizzle-orm";
import {
  companiesTable,
  usersTable,
  unitsTable,
  subUnitsTable,
  energySourcesTable,
  metersTable,
  consumptionTable,
  swotTable,
  risksTable,
  energyTargetsTable,
  energyActionPlansTable,
  vapProjectsTable,
} from "@workspace/db/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL env değişkeni tanımlı değil.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

function hashPassword(password: string): string {
  return createHash("sha256").update(password + "eys_salt_2024").digest("hex");
}

async function findOrCreate<T extends { id: number }>(
  label: string,
  finder: () => Promise<T[]>,
  creator: () => Promise<T[]>
): Promise<T> {
  const existing = await finder();
  if (existing.length > 0) {
    console.log(`  ↩  ${label} zaten mevcut (id: ${existing[0].id})`);
    return existing[0];
  }
  const created = await creator();
  console.log(`  ✅ ${label} oluşturuldu (id: ${created[0].id})`);
  return created[0];
}

async function syncSerialSequence(tableName: string, idColumn: string = "id"): Promise<void> {
  await db.execute(
    sql.raw(
      `SELECT setval(pg_get_serial_sequence('"${tableName}"', '${idColumn}'), COALESCE((SELECT MAX(${idColumn}) FROM "${tableName}"), 1), true)`
    )
  );
  console.log(`  🔧 ${tableName} sequence senkronize edildi`);
}

async function seed() {
  console.log("\n🌱 Internal demo seed başlatılıyor...");
  console.log("─────────────────────────────────────────────────────");

  // ── 1. Şirket ─────────────────────────────────────────────────────────────
  console.log("\n[1/9] Şirket");
  await syncSerialSequence("companies");
  const company = await findOrCreate(
    "ISO 50001 Kontrol Demo şirketi",
    () => db.select().from(companiesTable).where(eq(companiesTable.name, "ISO 50001 Kontrol Demo")),
    () => db.insert(companiesTable).values({
      name: "ISO 50001 Kontrol Demo",
      subdomain: "iso50001-kontrol-demo",
      isActive: true,
    }).returning()
  );

  const companyId = company.id;

  // ── 2. Admin kullanıcı ────────────────────────────────────────────────────
  console.log("\n[2/9] Admin kullanıcı");
  const ADMIN_USERNAME = "kontrol_admin";
  await findOrCreate(
    `Kullanıcı: ${ADMIN_USERNAME}`,
    () => db.select().from(usersTable).where(eq(usersTable.username, ADMIN_USERNAME)),
    () => db.insert(usersTable).values({
      companyId,
      username: ADMIN_USERNAME,
      passwordHash: hashPassword("admin123"),
      name: "Kontrol Yöneticisi",
      role: "admin",
      unitId: null,
      active: true,
      isDemo: false,
    }).returning()
  );

  // ── 3. Birim ──────────────────────────────────────────────────────────────
  console.log("\n[3/9] Birim");
  const UNIT_NAME = "Kontrol Fabrikası";
  const unit = await findOrCreate(
    `Birim: ${UNIT_NAME}`,
    () => db.select().from(unitsTable).where(
      and(eq(unitsTable.name, UNIT_NAME), eq(unitsTable.companyId, companyId))
    ),
    () => db.insert(unitsTable).values({
      companyId,
      name: UNIT_NAME,
      location: "Ostim OSB, Ankara",
      type: "fabrika",
      city: "Ankara",
      responsible: "Kontrol Yöneticisi",
      description: "Internal demo için iskelet fabrika birimi",
      active: true,
      isDemo: false,
    }).returning()
  );

  // ── 4. Alt birim ──────────────────────────────────────────────────────────
  console.log("\n[4/9] Alt birim");
  const SUB_UNIT_NAME = "Üretim Bölümü";
  const subUnit = await findOrCreate(
    `Alt birim: ${SUB_UNIT_NAME}`,
    () => db.select().from(subUnitsTable).where(
      and(eq(subUnitsTable.name, SUB_UNIT_NAME), eq(subUnitsTable.unitId, unit.id))
    ),
    () => db.insert(subUnitsTable).values({
      companyId,
      unitId: unit.id,
      name: SUB_UNIT_NAME,
      city: "Ankara",
      description: "Ana üretim bölümü",
      active: true,
    }).returning()
  );

  // ── 5. Enerji kaynağı ─────────────────────────────────────────────────────
  console.log("\n[5/9] Enerji kaynağı");
  const SOURCE_NAME = "Ana Elektrik Panosu";
  const energySource = await findOrCreate(
    `Enerji kaynağı: ${SOURCE_NAME}`,
    () => db.select().from(energySourcesTable).where(
      and(eq(energySourcesTable.name, SOURCE_NAME), eq(energySourcesTable.unitId, unit.id))
    ),
    () => db.insert(energySourcesTable).values({
      companyId,
      unitId: unit.id,
      type: "elektrik",
      name: SOURCE_NAME,
      unit: "kWh",
      active: true,
    }).returning()
  );

  // ── 6. Sayaç ──────────────────────────────────────────────────────────────
  console.log("\n[6/9] Sayaç");
  const METER_NAME = "Ana Elektrik Sayacı";
  const meter = await findOrCreate(
    `Sayaç: ${METER_NAME}`,
    () => db.select().from(metersTable).where(
      and(eq(metersTable.name, METER_NAME), eq(metersTable.subUnitId, subUnit.id))
    ),
    () => db.insert(metersTable).values({
      companyId,
      unitId: unit.id,
      subUnitId: subUnit.id,
      energySourceId: energySource.id,
      name: METER_NAME,
      type: "elektrik",
      recordType: "physical_meter",
      location: "Üretim Bölümü Ana Pano",
      city: "Ankara",
      unit: "kWh",
      description: "İskelet sayaç — gerçek veriler uygulama üzerinden girilecek",
    }).returning()
  );

  // ── 7. Tüketim verileri (2 aylık iskelet) ─────────────────────────────────
  console.log("\n[7/9] Tüketim verileri");

  const skeletonConsumption = [
    { year: 2025, month: 1, kwh: 0, tep: 0, co2: 0, hdd: 420, cdd: 0 },
    { year: 2025, month: 2, kwh: 0, tep: 0, co2: 0, hdd: 380, cdd: 0 },
  ];

  let consumptionInserted = 0;
  let consumptionSkipped = 0;

  for (const row of skeletonConsumption) {
    const existing = await db.select({ id: consumptionTable.id })
      .from(consumptionTable)
      .where(and(
        eq(consumptionTable.meterId, meter.id),
        eq(consumptionTable.year, row.year),
        eq(consumptionTable.month, row.month)
      ))
      .limit(1);

    if (existing.length > 0) {
      console.log(`  ↩  Tüketim ${row.year}/${String(row.month).padStart(2, "0")} zaten mevcut — atlandı`);
      consumptionSkipped++;
    } else {
      await db.insert(consumptionTable).values({
        companyId,
        meterId: meter.id,
        year: row.year,
        month: row.month,
        kwh: row.kwh,
        tep: row.tep,
        co2: row.co2,
        hdd: row.hdd,
        cdd: row.cdd,
        notes: "İskelet kayıt — gerçek değer girilecek",
      });
      console.log(`  ✅ Tüketim ${row.year}/${String(row.month).padStart(2, "0")} oluşturuldu`);
      consumptionInserted++;
    }
  }

  // ── 8. Enerji hedefleri ───────────────────────────────────────────────────
  console.log("\n[8/11] Enerji hedefleri");

  const targetItems = [
    {
      name: "Elektrik Tüketimi Azaltma Hedefi",
      objectiveText: "2025–2027 döneminde elektrik tüketimini baz yılına göre azaltmak",
      targetText: "Baz yıl 2023 elektrik tüketimine kıyasla 2027 yılı sonunda %10 azalma sağlamak",
      targetType: "reduction_percent",
      baselineYear: 2023,
      baselineValue: 450000,
      targetYear: 2027,
      targetValue: 405000,
      actualValue: null as number | null,
      unitLabel: "kWh",
      targetReductionPercent: 10,
      status: "active",
      notes: "ISO 50001 enerji hedef ve amaçları kapsamında belirlenmiştir.",
    },
    {
      name: "Doğalgaz Tüketimi Azaltma Hedefi",
      objectiveText: "2025–2027 döneminde doğalgaz tüketimini baz yılına göre azaltmak",
      targetText: "Baz yıl 2023 doğalgaz tüketimine kıyasla 2027 yılı sonunda %8 azalma sağlamak",
      targetType: "reduction_percent",
      baselineYear: 2023,
      baselineValue: 180000,
      targetYear: 2027,
      targetValue: 165600,
      actualValue: null as number | null,
      unitLabel: "m³",
      targetReductionPercent: 8,
      status: "active",
      notes: "Isıtma ve proses ısısı kaynaklı tüketim hedeflenmiştir.",
    },
    {
      name: "Toplam Enerji Yoğunluğu İyileştirme Hedefi",
      objectiveText: "Üretim bazında birim ürün başına enerji tüketimini düşürmek",
      targetText: "Birim üretim başına düşen enerji tüketimini 2023 baz yılına göre %12 azaltmak",
      targetType: "intensity",
      baselineYear: 2023,
      baselineValue: 2.4,
      targetYear: 2026,
      targetValue: 2.11,
      actualValue: null as number | null,
      unitLabel: "kWh/adet",
      targetReductionPercent: 12,
      status: "active",
      notes: "Üretim miktarı değişkenine bağlı performans göstergesi olarak izlenecektir.",
    },
  ];

  let targetInserted = 0;
  let targetSkipped = 0;
  // name → DB id (eylem planları için gerekli)
  const targetIdMap = new Map<string, number>();

  for (const item of targetItems) {
    const existing = await db.select({ id: energyTargetsTable.id })
      .from(energyTargetsTable)
      .where(and(
        eq(energyTargetsTable.companyId, companyId),
        eq(energyTargetsTable.name, item.name),
      ))
      .limit(1);

    if (existing.length > 0) {
      console.log(`  ↩  Hedef zaten mevcut: ${item.name}`);
      targetIdMap.set(item.name, existing[0].id);
      targetSkipped++;
    } else {
      const [row] = await db.insert(energyTargetsTable).values({
        companyId,
        unitId: unit.id,
        name: item.name,
        objectiveText: item.objectiveText,
        targetText: item.targetText,
        targetType: item.targetType,
        baselineYear: item.baselineYear,
        baselineValue: item.baselineValue,
        targetYear: item.targetYear,
        targetValue: item.targetValue,
        actualValue: item.actualValue,
        unitLabel: item.unitLabel,
        targetReductionPercent: item.targetReductionPercent,
        status: item.status,
        notes: item.notes,
      }).returning({ id: energyTargetsTable.id });
      console.log(`  ✅ Hedef oluşturuldu: ${item.name}`);
      targetIdMap.set(item.name, row.id);
      targetInserted++;
    }
  }
  console.log(`  Enerji hedefleri: ${targetInserted} eklendi, ${targetSkipped} atlandı`);

  // ── 9. Eylem planları (yeni demo hedefler için) ───────────────────────────
  console.log("\n[9/13] Eylem planları (demo hedefler)");

  const elektrikTargetId = targetIdMap.get("Elektrik Tüketimi Azaltma Hedefi");
  const dogalgazTargetId = targetIdMap.get("Doğalgaz Tüketimi Azaltma Hedefi");
  const yogunlukTargetId = targetIdMap.get("Toplam Enerji Yoğunluğu İyileştirme Hedefi");

  interface ActionPlanSeed {
    targetId: number;
    title: string;
    description: string;
    responsibleName: string;
    priority: string;
    expectedSavingValue: number | null;
    expectedSavingUnit: string;
    expectedCostSaving: number | null;
    investmentCost: number | null;
    paybackMonths: number | null;
    startDate: string;
    dueDate: string;
    progressPercent: number;
    status: string;
    isVap: boolean;
    notes: string | null;
  }

  const actionPlanItems: ActionPlanSeed[] = [];

  if (elektrikTargetId) {
    actionPlanItems.push(
      {
        targetId: elektrikTargetId,
        title: "LED Aydınlatma Dönüşümü",
        description: "Tüm üretim bölümü aydınlatma armatürlerinin LED teknolojisine dönüştürülmesi. Mevcut floresan ve HİD armatürler yüksek verimli LED ile değiştirilecektir.",
        responsibleName: "Teknik Hizmetler Müdürü",
        priority: "high",
        expectedSavingValue: 45000,
        expectedSavingUnit: "kWh",
        expectedCostSaving: 135000,
        investmentCost: 280000,
        paybackMonths: 25,
        startDate: "2025-03-01",
        dueDate: "2025-09-30",
        progressPercent: 35,
        status: "in_progress",
        isVap: true,  // Bu eylem planına VAP bağlanacak
        notes: "Pilot uygulama Mart ayında başlatıldı. Montaj %35 tamamlandı.",
      },
      {
        targetId: elektrikTargetId,
        title: "Kompresör Enerji Verimliliği Optimizasyonu",
        description: "Basınçlı hava sisteminde kaçak tespiti, basınç set noktası optimizasyonu ve mesai dışı otomatik kapatma sistemi kurulumu.",
        responsibleName: "Bakım Mühendisi",
        priority: "high",
        expectedSavingValue: 38000,
        expectedSavingUnit: "kWh",
        expectedCostSaving: 114000,
        investmentCost: 45000,
        paybackMonths: 5,
        startDate: "2025-01-15",
        dueDate: "2025-06-30",
        progressPercent: 60,
        status: "in_progress",
        isVap: false,
        notes: "Kaçak tespiti tamamlandı. Basınç optimizasyonu devam ediyor.",
      },
    );
  }

  if (dogalgazTargetId) {
    actionPlanItems.push(
      {
        targetId: dogalgazTargetId,
        title: "Kazan Baca Gazı Isı Geri Kazanımı",
        description: "Doğalgaz kazanına ekonomizer ünite eklenerek baca gazı atık ısısından besi suyu ön ısıtmasında yararlanılacaktır.",
        responsibleName: "Enerji Yöneticisi",
        priority: "medium",
        expectedSavingValue: 18000,
        expectedSavingUnit: "m³",
        expectedCostSaving: 216000,
        investmentCost: 320000,
        paybackMonths: 18,
        startDate: "2025-06-01",
        dueDate: "2025-12-31",
        progressPercent: 10,
        status: "planned",
        isVap: false,
        notes: "Teknik şartname hazırlanıyor. Tedarikçi teklifleri bekleniyor.",
      },
      {
        targetId: dogalgazTargetId,
        title: "Buhar Dağıtım Hattı Yalıtım İyileştirmesi",
        description: "Üretim bölümündeki buhar dağıtım borularının yalıtım kalınlıklarının artırılması ve hasarlı yalıtım kısımlarının yenilenmesi.",
        responsibleName: "Bakım Mühendisi",
        priority: "medium",
        expectedSavingValue: 6500,
        expectedSavingUnit: "m³",
        expectedCostSaving: 78000,
        investmentCost: 55000,
        paybackMonths: 8,
        startDate: "2025-04-01",
        dueDate: "2025-07-31",
        progressPercent: 80,
        status: "in_progress",
        isVap: false,
        notes: "Boru hattı yalıtım çalışmaları %80 tamamlandı.",
      },
    );
  }

  if (yogunlukTargetId) {
    actionPlanItems.push(
      {
        targetId: yogunlukTargetId,
        title: "Enerji İzleme ve Raporlama Sistemi Kurulumu",
        description: "Sayaç bazında gerçek zamanlı enerji izleme altyapısı kurulumu ve otomatik üretim bazlı EnPI hesaplama modülü devreye alınması.",
        responsibleName: "Bilgi İşlem ve Enerji Yönetimi",
        priority: "high",
        expectedSavingValue: null,
        expectedSavingUnit: "kWh",
        expectedCostSaving: null,
        investmentCost: 120000,
        paybackMonths: null,
        startDate: "2025-02-01",
        dueDate: "2025-08-31",
        progressPercent: 45,
        status: "in_progress",
        isVap: false,
        notes: "Altyapı kurulumu tamamlandı. Yazılım entegrasyonu devam ediyor.",
      },
      {
        targetId: yogunlukTargetId,
        title: "Üretim Çizelgeleme Optimizasyonu ile Pik Yük Yönetimi",
        description: "Yüksek enerji çeken ekipmanların çalışma saatlerini pik tarife dönemlerinden kaçıracak şekilde üretim çizelgesinin yeniden düzenlenmesi.",
        responsibleName: "Üretim Müdürü",
        priority: "medium",
        expectedSavingValue: 22000,
        expectedSavingUnit: "kWh",
        expectedCostSaving: 88000,
        investmentCost: 0,
        paybackMonths: 1,
        startDate: "2025-01-01",
        dueDate: "2025-03-31",
        progressPercent: 100,
        status: "completed",
        isVap: false,
        notes: "Çizelge revize edildi. Pik tarife döneminde yük %18 azaldı.",
      },
    );
  }

  let apInserted = 0;
  let apSkipped = 0;
  // title → DB id (VAP için gerekli)
  const actionPlanIdMap = new Map<string, number>();

  for (const ap of actionPlanItems) {
    const existing = await db.select({ id: energyActionPlansTable.id })
      .from(energyActionPlansTable)
      .where(and(
        eq(energyActionPlansTable.companyId, companyId),
        eq(energyActionPlansTable.targetId, ap.targetId),
        eq(energyActionPlansTable.title, ap.title),
      ))
      .limit(1);

    if (existing.length > 0) {
      console.log(`  ↩  Eylem planı zaten mevcut: ${ap.title}`);
      actionPlanIdMap.set(ap.title, existing[0].id);
      apSkipped++;
    } else {
      const [row] = await db.insert(energyActionPlansTable).values({
        companyId,
        targetId: ap.targetId,
        title: ap.title,
        description: ap.description,
        responsibleName: ap.responsibleName,
        priority: ap.priority,
        expectedSavingValue: ap.expectedSavingValue,
        expectedSavingUnit: ap.expectedSavingUnit,
        expectedCostSaving: ap.expectedCostSaving,
        investmentCost: ap.investmentCost,
        paybackMonths: ap.paybackMonths,
        startDate: ap.startDate,
        dueDate: ap.dueDate,
        progressPercent: ap.progressPercent,
        status: ap.status,
        isVap: ap.isVap,
        notes: ap.notes,
        createdBy: ADMIN_USERNAME,
      }).returning({ id: energyActionPlansTable.id });
      console.log(`  ✅ Eylem planı oluşturuldu: ${ap.title}`);
      actionPlanIdMap.set(ap.title, row.id);
      apInserted++;
    }
  }
  console.log(`  Eylem planları: ${apInserted} eklendi, ${apSkipped} atlandı`);

  // ── 10. VAP projesi (yalnızca LED Aydınlatma eylemine bağlı) ─────────────
  console.log("\n[10/13] VAP projesi (demo)");

  const ledActionPlanId = actionPlanIdMap.get("LED Aydınlatma Dönüşümü");
  let vapInserted = 0;
  let vapSkipped = 0;

  if (ledActionPlanId) {
    const existingVap = await db.select({ id: vapProjectsTable.id })
      .from(vapProjectsTable)
      .where(and(
        eq(vapProjectsTable.companyId, companyId),
        eq(vapProjectsTable.actionPlanId, ledActionPlanId),
      ))
      .limit(1);

    if (existingVap.length > 0) {
      console.log("  ↩  VAP projesi zaten mevcut: LED Aydınlatma Dönüşümü");
      vapSkipped++;
    } else {
      await db.insert(vapProjectsTable).values({
        companyId,
        actionPlanId: ledActionPlanId,
        projectCode: "VAP-2025-001",
        projectTitle: "LED Aydınlatma Dönüşümü VAP Projesi",
        projectType: "aydinlatma",
        currentSituation: "Üretim bölümünde 320 adet floresan (T8 36W) ve 48 adet HİD (250W) armatür kullanılmaktadır. Toplam kurulu aydınlatma gücü 23.6 kW'dır.",
        proposedSolution: "Tüm armatürlerin yüksek verimli LED ile değiştirilmesi: 320 adet T8 LED (18W) ve 48 adet LED projektör (120W). Toplam kurulu güç 11.5 kW'a düşecektir.",
        technicalDescription: "LED dönüşüm ile kurulu güç %51 azalacak, aydınlatma süresi günde 16 saat olarak alındığında yıllık tasarruf 45.000 kWh olarak hesaplanmıştır. Renk sıcaklığı 4000K, Ra≥80 seçilecektir.",
        annualEnergySavingValue: 45000,
        annualEnergySavingUnit: "kWh",
        annualCostSaving: 135000,
        investmentCost: 280000,
        paybackMonths: 25,
        co2ReductionTon: 18.9,
        measurementVerificationMethod: "Proje öncesi ve sonrası sayaç bazlı aylık elektrik tüketim karşılaştırması. Üretim saati normalleştirmesi uygulanacaktır.",
        incentiveStatus: "applied",
        feasibilityStatus: "approved",
        startDate: "2025-03-01",
        endDate: "2025-09-30",
        status: "in_progress",
        notes: "KOSGEB enerji verimliliği destek programına başvuru yapıldı.",
        createdBy: ADMIN_USERNAME,
      });
      console.log("  ✅ VAP projesi oluşturuldu: VAP-2025-001 LED Aydınlatma Dönüşümü");
      vapInserted++;
    }
  } else {
    console.log("  ⚠️  LED Aydınlatma eylem planı bulunamadı — VAP atlandı.");
  }
  console.log(`  VAP projeleri: ${vapInserted} eklendi, ${vapSkipped} atlandı`);

  // ── 11. SWOT maddeleri ────────────────────────────────────────────────────
  console.log("\n[11/13] SWOT maddeleri");

  const swotItems = [
    // Güçlü Yönler
    {
      category: "strengths",
      title: "Enerji tüketim verilerinin sayaç bazında düzenli takip ediliyor olması",
      description: "Her alt birim ve enerji kaynağı için sayaç bazlı aylık tüketim verileri sistematik şekilde kayıt altına alınmaktadır.",
      score: 4,
      impact: "yuksek",
    },
    {
      category: "strengths",
      title: "Üst yönetimin enerji performansı iyileştirme çalışmalarını desteklemesi",
      description: "ISO 50001 kapsamında yürütülen faaliyetler üst yönetim tarafından desteklenmekte ve gerekli kaynaklar tahsis edilmektedir.",
      score: 4,
      impact: "yuksek",
    },
    {
      category: "strengths",
      title: "Elektrik ve doğalgaz tüketimlerinin geçmiş yıllara göre karşılaştırılabilir olması",
      description: "Çok yıllı tüketim verileri sisteme kayıtlı olup trend analizi ve performans karşılaştırması yapılabilmektedir.",
      score: 3,
      impact: "orta",
    },
    {
      category: "strengths",
      title: "Önemli enerji kullanımlarının Pareto analizi ile belirlenebilmesi",
      description: "Tüketim verileri üzerinden önemli enerji kullanım alanları analitik olarak tespit edilerek önceliklendirme yapılabilmektedir.",
      score: 4,
      impact: "yuksek",
    },
    // Zayıf Yönler
    {
      category: "weaknesses",
      title: "Bazı alt birimlerde sayaç okuma ve veri girişlerinin manuel yapılması",
      description: "Otomatik veri toplama altyapısı olmayan noktalarda manuel sayaç okuma yapılması veri hata riskini artırmaktadır.",
      score: 3,
      impact: "orta",
    },
    {
      category: "weaknesses",
      title: "Enerji performans göstergelerinin tüm tüketim noktalarında henüz olgunlaşmamış olması",
      description: "EnPI hesaplamaları için gerekli değişken verileri bazı tüketim noktaları için eksik ya da tutarsız olabilmektedir.",
      score: 3,
      impact: "orta",
    },
    {
      category: "weaknesses",
      title: "HDD/CDD dışındaki operasyonel değişkenlerin düzenli takip edilmemesi",
      description: "Üretim miktarı, çalışma saati gibi enerji performansını etkileyen operasyonel değişkenler sistematik şekilde kaydedilmemektedir.",
      score: 2,
      impact: "orta",
    },
    {
      category: "weaknesses",
      title: "Enerji verimliliği projeleri için finansal fizibilite kayıtlarının eksik olması",
      description: "Planlanan iyileştirme projelerinde yatırım geri dönüş süresi ve tasarruf hesaplamalarına ilişkin kayıtlar yetersiz kalmaktadır.",
      score: 3,
      impact: "orta",
    },
    // Fırsatlar
    {
      category: "opportunities",
      title: "Yüksek tüketimli alanlarda VAP projeleri ile enerji tasarrufu potansiyeli bulunması",
      description: "Kompresör, kazan ve HVAC sistemleri başta olmak üzere yüksek tüketimli noktalarda somut tasarruf projeleri hayata geçirilebilir.",
      score: 5,
      impact: "yuksek",
    },
    {
      category: "opportunities",
      title: "Kompresör, aydınlatma ve HVAC sistemlerinde verimlilik artırıcı iyileştirmeler yapılabilmesi",
      description: "Teknik denetim ve ölçüm sonuçları, mevcut ekipmanlarda verimlilik artırıcı iyileştirme fırsatlarına işaret etmektedir.",
      score: 4,
      impact: "yuksek",
    },
    {
      category: "opportunities",
      title: "ISO 50001 sistemi sayesinde enerji performansının düzenli raporlanabilmesi",
      description: "Kurulan sistem altyapısı, enerji performans verilerinin periyodik olarak raporlanmasını ve karar alma süreçlerinde kullanılmasını mümkün kılmaktadır.",
      score: 4,
      impact: "yuksek",
    },
    {
      category: "opportunities",
      title: "Dijital sayaç ve otomatik veri toplama altyapısına geçiş imkânı",
      description: "Mevcut sayaçların dijital sisteme entegrasyonu ile anlık izleme ve otomatik raporlama yapısı kurulabilir.",
      score: 3,
      impact: "orta",
    },
    // Tehditler
    {
      category: "threats",
      title: "Enerji birim fiyatlarındaki artışların işletme maliyetlerini yükseltmesi",
      description: "Elektrik ve doğalgaz tarifelerindeki yükseliş eğilimi enerji maliyetlerini bütçenin üzerinde gerçekleşme riskini artırmaktadır.",
      score: 4,
      impact: "yuksek",
    },
    {
      category: "threats",
      title: "İklim koşullarındaki değişim nedeniyle ısıtma/soğutma yüklerinin artması",
      description: "Aşırı hava koşulları ve iklim değişikliği kaynaklı yük artışları planlanan tüketim bütçelerini aşabilmektedir.",
      score: 3,
      impact: "orta",
    },
    {
      category: "threats",
      title: "Yasal enerji verimliliği yükümlülüklerinin zamanında karşılanamaması",
      description: "İlgili mevzuat kapsamında hazırlanması gereken raporların veya iyileştirme planlarının gecikmesi uygunluk riski doğurabilir.",
      score: 3,
      impact: "yuksek",
    },
    {
      category: "threats",
      title: "Eski ekipmanların arıza ve verimsizlik kaynaklı enerji kayıplarını artırması",
      description: "Ekonomik ömrünü tamamlamış ekipmanlar beklenmedik arızalara ve enerji verimsizliğine yol açabilmektedir.",
      score: 4,
      impact: "yuksek",
    },
  ];

  let swotInserted = 0;
  let swotSkipped = 0;

  for (const item of swotItems) {
    const existing = await db.select({ id: swotTable.id })
      .from(swotTable)
      .where(and(
        eq(swotTable.companyId, companyId),
        eq(swotTable.category, item.category),
        eq(swotTable.title, item.title),
      ))
      .limit(1);

    if (existing.length > 0) {
      swotSkipped++;
    } else {
      await db.insert(swotTable).values({
        companyId,
        unitId: unit.id,
        category: item.category,
        title: item.title,
        description: item.description,
        score: item.score,
        impact: item.impact,
      });
      swotInserted++;
    }
  }
  console.log(`  SWOT: ${swotInserted} eklendi, ${swotSkipped} atlandı`);

  // ── 12. Risk ve Fırsat kayıtları ──────────────────────────────────────────
  console.log("\n[12/13] Risk ve Fırsat kayıtları");

  const riskItems = [
    // Riskler
    {
      type: "risk",
      title: "Enerji tüketim verilerinin eksik veya hatalı girilmesi",
      description: "Sayaç okuma veya manuel giriş hataları enerji performans analizlerinin doğruluğunu etkileyebilir.",
      foreseenImpact: "Aylık tüketim girişlerinin sorumlu personel tarafından kontrol edilmesi",
      probability: 3,
      severity: 4,
      score: 12,
      responseType: "aksiyon",
      mitigationPlan: "Veri giriş ekranlarında zorunlu alan ve tutarlılık kontrollerinin artırılması",
      owner: "Enerji Yöneticisi",
      status: "acik",
    },
    {
      type: "risk",
      title: "Önemli enerji kullanımlarında hedeflenen tasarrufun sağlanamaması",
      description: "Belirlenen ÖEK alanlarında planlanan iyileştirme faaliyetleri uygulanmazsa enerji performansı beklenen seviyede iyileşmeyebilir.",
      foreseenImpact: "ÖEK analizi ve yıllık hedef takibi",
      probability: 3,
      severity: 5,
      score: 15,
      responseType: "aksiyon",
      mitigationPlan: "Hedeflere bağlı eylem planlarının aylık izlenmesi",
      owner: "Birim Enerji Sorumlusu",
      status: "acik",
    },
    {
      type: "risk",
      title: "Enerji maliyetlerinin bütçe üzerinde gerçekleşmesi",
      description: "Elektrik ve doğalgaz birim fiyatlarındaki artış enerji maliyetlerinin planlanan bütçeyi aşmasına neden olabilir.",
      foreseenImpact: "Aylık enerji maliyet takibi",
      probability: 4,
      severity: 4,
      score: 16,
      responseType: "aksiyon",
      mitigationPlan: "Yüksek tüketimli noktalarda tasarruf projelerinin önceliklendirilmesi",
      owner: "Mali İşler ve Enerji Yönetimi",
      status: "izlemede",
    },
    {
      type: "risk",
      title: "Kritik ekipmanlarda verimsiz çalışma",
      description: "Kompresör, kazan, pompa veya HVAC ekipmanlarının verimsiz çalışması enerji tüketimini artırabilir.",
      foreseenImpact: "Periyodik bakım planı",
      probability: 4,
      severity: 5,
      score: 20,
      responseType: "aksiyon",
      mitigationPlan: "Bakım kayıtları ile enerji tüketimlerinin karşılaştırılması",
      owner: "Bakım Sorumlusu",
      status: "acik",
    },
    {
      type: "risk",
      title: "Yasal enerji verimliliği yükümlülüklerinin zamanında karşılanamaması",
      description: "Enerji yönetimi sistemi kayıtları, raporları veya iyileştirme planları zamanında tamamlanmazsa yasal ve kurumsal uygunluk riski oluşabilir.",
      foreseenImpact: "ISO 50001 dokümantasyon takibi",
      probability: 2,
      severity: 5,
      score: 10,
      responseType: "aksiyon",
      mitigationPlan: "Yıllık uygunluk takvimi oluşturulması",
      owner: "Yönetim Temsilcisi",
      status: "acik",
    },
    // Fırsatlar
    {
      type: "firsat",
      title: "Yüksek verimli aydınlatma dönüşümü",
      description: "Mevcut aydınlatma sistemlerinin LED armatürlerle değiştirilmesi elektrik tüketimini azaltabilir.",
      foreseenImpact: "Elektrik tüketiminde azalma ve bakım maliyetlerinde düşüş",
      probability: 4,
      severity: 4,
      score: 16,
      responseType: "aksiyon",
      mitigationPlan: "Aydınlatma envanteri çıkarılarak yatırım fizibilitesi hazırlanması",
      owner: "Teknik Hizmetler",
      status: "acik",
    },
    {
      type: "firsat",
      title: "Kompresör basınç optimizasyonu",
      description: "Basınç set değerlerinin optimize edilmesi ve kaçakların giderilmesi ile elektrik tüketimi azaltılabilir.",
      foreseenImpact: "Kompresör elektrik tüketiminde düşüş",
      probability: 5,
      severity: 4,
      score: 20,
      responseType: "aksiyon",
      mitigationPlan: "Basınç ihtiyacı analizi ve kaçak kontrol programı oluşturulması",
      owner: "Bakım Sorumlusu",
      status: "izlemede",
    },
    {
      type: "firsat",
      title: "Kazan ekonomizer uygulaması",
      description: "Baca gazı atık ısısından yararlanılarak kazan besi suyu ön ısıtması yapılabilir.",
      foreseenImpact: "Doğalgaz tüketiminde azalma",
      probability: 3,
      severity: 5,
      score: 15,
      responseType: "aksiyon",
      mitigationPlan: "Ön fizibilite çalışması yapılması",
      owner: "Enerji Yöneticisi",
      status: "acik",
    },
    {
      type: "firsat",
      title: "HDD/CDD bazlı enerji performansı izleme",
      description: "Isıtma ve soğutma tüketimleri HDD/CDD verileriyle ilişkilendirilerek daha doğru performans analizi yapılabilir.",
      foreseenImpact: "İklim etkisinden arındırılmış enerji performansı takibi",
      probability: 4,
      severity: 3,
      score: 12,
      responseType: "aksiyon",
      mitigationPlan: "Tüketim verileri ile meteorolojik değişkenlerin düzenli analiz edilmesi",
      owner: "Enerji Yönetimi Ekibi",
      status: "acik",
    },
    {
      type: "firsat",
      title: "Dijital sayaç ve otomatik veri toplama altyapısı",
      description: "Manuel sayaç okuma yerine otomatik veri toplama altyapısı kurulması veri doğruluğunu ve izleme hızını artırabilir.",
      foreseenImpact: "Daha hızlı raporlama, düşük veri hatası, anlık tüketim takibi",
      probability: 3,
      severity: 4,
      score: 12,
      responseType: "aksiyon",
      mitigationPlan: "Kritik sayaçlar için pilot otomatik okuma projesi planlanması",
      owner: "Bilgi İşlem ve Enerji Yönetimi",
      status: "acik",
    },
  ];

  let riskInserted = 0;
  let riskSkipped = 0;

  for (const item of riskItems) {
    const existing = await db.select({ id: risksTable.id })
      .from(risksTable)
      .where(and(
        eq(risksTable.companyId, companyId),
        eq(risksTable.title, item.title),
      ))
      .limit(1);

    if (existing.length > 0) {
      riskSkipped++;
    } else {
      await db.insert(risksTable).values({
        companyId,
        unitId: unit.id,
        type: item.type,
        title: item.title,
        description: item.description,
        foreseenImpact: item.foreseenImpact,
        probability: item.probability,
        severity: item.severity,
        score: item.score,
        responseType: item.responseType,
        mitigationPlan: item.mitigationPlan,
        owner: item.owner,
        status: item.status,
      });
      riskInserted++;
    }
  }

  const riskCount = riskItems.filter(r => r.type === "risk");
  const firsatCount = riskItems.filter(r => r.type === "firsat");
  console.log(`  Riskler (${riskCount.length} toplam): ${riskInserted > 0 ? Math.min(riskInserted, riskCount.length) : 0} eklendi, ${riskSkipped > 0 ? Math.min(riskSkipped, riskCount.length) : riskCount.length} atlandı`);
  console.log(`  Fırsatlar (${firsatCount.length} toplam): ${riskInserted > riskCount.length ? riskInserted - riskCount.length : 0} eklendi, ${riskSkipped > riskCount.length ? riskSkipped - riskCount.length : firsatCount.length} atlandı`);

  // ── Özet ──────────────────────────────────────────────────────────────────
  console.log(`\n─────────────────────────────────────────────────────`);
  console.log(`🎉 Internal demo seed tamamlandı.`);
  console.log(`\n  Şirket         : ${company.name} (id: ${companyId})`);
  console.log(`  Birim          : ${unit.name} (id: ${unit.id})`);
  console.log(`  Sayaç          : ${meter.name} (id: ${meter.id})`);
  console.log(`  Tüketim        : ${consumptionInserted} eklendi, ${consumptionSkipped} atlandı`);
  console.log(`  Enerji hedefleri: ${targetInserted} eklendi, ${targetSkipped} atlandı (toplam: ${targetItems.length})`);
  console.log(`  Eylem planları : ${apInserted} eklendi, ${apSkipped} atlandı (toplam: ${actionPlanItems.length})`);
  console.log(`  VAP projeleri  : ${vapInserted} eklendi, ${vapSkipped} atlandı`);
  console.log(`  SWOT           : ${swotInserted} eklendi, ${swotSkipped} atlandı (toplam: ${swotItems.length})`);
  console.log(`  Risk+Fırsat    : ${riskInserted} eklendi, ${riskSkipped} atlandı (toplam: ${riskItems.length})`);
  console.log(`\n  Giriş bilgileri:`);
  console.log(`    Kullanıcı: ${ADMIN_USERNAME}`);
  console.log(`    Şifre    : admin123`);
  console.log(`─────────────────────────────────────────────────────\n`);

  await pool.end();
}

seed().catch((err) => {
  console.error("❌ Seed hatası:", err);
  pool.end().finally(() => process.exit(1));
});
