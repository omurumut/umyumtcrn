import { Router } from "express";
import { createHash } from "crypto";
import { db } from "@workspace/db";
import {
  usersTable,
  unitsTable,
  subUnitsTable,
  energySourcesTable,
  metersTable,
  consumptionTable,
  swotTable,
  risksTable,
  seuTable,
  energyTargetsTable,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";
import { eq, inArray, ne, and } from "drizzle-orm";


const router = Router();

function hashPassword(password: string): string {
  return createHash("sha256").update(password + "eys_salt_2024").digest("hex");
}

const weatherProfiles: Record<string, { hdd: number[]; cdd: number[] }> = {
  Istanbul: {
    hdd: [310, 270, 200, 80, 20, 0, 0, 0, 10, 80, 190, 280],
    cdd: [0, 0, 0, 10, 50, 150, 220, 210, 120, 30, 5, 0],
  },
  Ankara: {
    hdd: [420, 380, 280, 120, 30, 0, 0, 0, 20, 110, 270, 380],
    cdd: [0, 0, 0, 5, 40, 130, 210, 200, 100, 20, 0, 0],
  },
  Izmir: {
    hdd: [200, 170, 110, 30, 5, 0, 0, 0, 0, 30, 100, 180],
    cdd: [0, 0, 5, 30, 90, 190, 290, 280, 180, 70, 15, 0],
  },
};

function electricityFactor(month: number, city: string): number {
  const w = weatherProfiles[city] ?? weatherProfiles["Istanbul"];
  const base = 0.7;
  return base + (w.hdd[month - 1] / 500) * 0.3 + (w.cdd[month - 1] / 300) * 0.2;
}

function gasFactor(month: number, city: string): number {
  const w = weatherProfiles[city] ?? weatherProfiles["Istanbul"];
  return 0.2 + (w.hdd[month - 1] / 450) * 1.2;
}

router.post("/admin/seed", requireAuth, requireAdmin, async (req, res) => {
  try {
    const companyId: number = req.body?.companyId ? parseInt(req.body.companyId) : 1;

    // ── Mevcut demo verileri temizle (sadece aynı firma) ────────────────────
    await db.delete(usersTable).where(and(eq(usersTable.isDemo, true), eq(usersTable.companyId, companyId)));
    const existingDemoUnits = await db
      .select({ id: unitsTable.id })
      .from(unitsTable)
      .where(and(eq(unitsTable.isDemo, true), eq(unitsTable.companyId, companyId)));
    if (existingDemoUnits.length > 0) {
      const ids = existingDemoUnits.map((u) => u.id);
      await db.delete(metersTable).where(inArray(metersTable.unitId, ids));
      await db.delete(unitsTable).where(and(eq(unitsTable.isDemo, true), eq(unitsTable.companyId, companyId)));
    }

    // ── Birimler ────────────────────────────────────────────────────────────
    const units = await db.insert(unitsTable).values([
      { name: "İstanbul Fabrika A", location: "Dudullu OSB, İstanbul", type: "fabrika", city: "Istanbul", responsible: "Mehmet Yılmaz", description: "Tekstil üretim fabrikası — 45.000 m²", active: true, isDemo: true, companyId },
      { name: "Ankara Merkez Ofis", location: "Çankaya, Ankara", type: "ofis", city: "Ankara", responsible: "Ayşe Kaya", description: "Genel merkez ofisi — 8.500 m²", active: true, isDemo: true, companyId },
      { name: "İzmir Lojistik Depo", location: "Kemalpaşa OSB, İzmir", type: "depo", city: "Izmir", responsible: "Fatih Demir", description: "Soğuk zincir lojistik deposu — 22.000 m²", active: true, isDemo: true, companyId },
    ]).returning();

    // ── Demo kullanıcılar ───────────────────────────────────────────────────
    const userSuffix = companyId !== 1 ? `_c${companyId}` : "";
    await db.insert(usersTable).values([
      { username: `istanbul_yonetici${userSuffix}`, passwordHash: hashPassword("demo123"), name: "Mehmet Yılmaz", role: "user", unitId: units[0].id, active: true, isDemo: true, companyId },
      { username: `ankara_yonetici${userSuffix}`,   passwordHash: hashPassword("demo123"), name: "Ayşe Kaya",    role: "user", unitId: units[1].id, active: true, isDemo: true, companyId },
      { username: `izmir_yonetici${userSuffix}`,    passwordHash: hashPassword("demo123"), name: "Fatih Demir",  role: "user", unitId: units[2].id, active: true, isDemo: true, companyId },
    ]).onConflictDoNothing();

    // ── Alt Birimler ────────────────────────────────────────────────────────
    const subUnits = await db.insert(subUnitsTable).values([
      { unitId: units[0].id, name: "Üretim Hattı 1",       city: "Istanbul", description: "Ana üretim hattı",           companyId },
      { unitId: units[0].id, name: "Üretim Hattı 2",       city: "Istanbul", description: "İkincil üretim hattı",       companyId },
      { unitId: units[0].id, name: "Boya & Apre",           city: "Istanbul", description: "Boya ve apre bölümü",        companyId },
      { unitId: units[0].id, name: "Yardımcı İşletme",      city: "Istanbul", description: "Kompresör, buhar, soğutma",  companyId },
      { unitId: units[1].id, name: "Ofis Katı 1-5",         city: "Ankara",  description: "1-5. kat ofis alanları",     companyId },
      { unitId: units[1].id, name: "Toplantı & Konferans",  city: "Ankara",  description: "Konferans salonları",         companyId },
      { unitId: units[1].id, name: "Veri Merkezi",          city: "Ankara",  description: "Sunucu odası ve UPS",         companyId },
      { unitId: units[2].id, name: "Soğuk Depo A Blok",     city: "Izmir",   description: "-20°C donmuş ürün deposu",   companyId },
      { unitId: units[2].id, name: "Soğuk Depo B Blok",     city: "Izmir",   description: "+4°C soğutmalı depo",        companyId },
      { unitId: units[2].id, name: "Yükleme Rampası",       city: "Izmir",   description: "Araç yükleme/boşaltma",      companyId },
    ]).returning();

    // ── Enerji Kaynakları ───────────────────────────────────────────────────
    const sources = await db.insert(energySourcesTable).values([
      { unitId: units[0].id, type: "elektrik",  name: "Trafo Merkezi A",            unit: "kWh", companyId },
      { unitId: units[0].id, type: "elektrik",  name: "Trafo Merkezi B",            unit: "kWh", companyId },
      { unitId: units[0].id, type: "dogalgaz",  name: "Doğalgaz Ana Hat",           unit: "m3",  companyId },
      { unitId: units[0].id, type: "buhar",     name: "Buhar Üretim Merkezi",       unit: "ton", companyId },
      { unitId: units[1].id, type: "elektrik",  name: "Ana Elektrik Panosu",        unit: "kWh", companyId },
      { unitId: units[1].id, type: "dogalgaz",  name: "Isıtma Sistemi",             unit: "m3",  companyId },
      { unitId: units[2].id, type: "elektrik",  name: "Soğutma Sistemleri Elektrik",unit: "kWh", companyId },
      { unitId: units[2].id, type: "dogalgaz",  name: "Isıtma & Jeneratör",         unit: "m3",  companyId },
    ]).returning();

    // ── Sayaçlar ────────────────────────────────────────────────────────────
    const meters = await db.insert(metersTable).values([
      { unitId: units[0].id, subUnitId: subUnits[0].id, energySourceId: sources[0].id, name: "Hat-1 Elektrik Sayacı",     type: "elektrik", location: "Üretim Hattı 1 Panosu",          city: "Istanbul", unit: "kWh", companyId },
      { unitId: units[0].id, subUnitId: subUnits[0].id, energySourceId: sources[2].id, name: "Hat-1 Gaz Sayacı",          type: "dogalgaz", location: "Üretim Hattı 1 Gaz Bağlantısı",  city: "Istanbul", unit: "m3",  companyId },
      { unitId: units[0].id, subUnitId: subUnits[1].id, energySourceId: sources[1].id, name: "Hat-2 Elektrik Sayacı",     type: "elektrik", location: "Üretim Hattı 2 Panosu",          city: "Istanbul", unit: "kWh", companyId },
      { unitId: units[0].id, subUnitId: subUnits[1].id, energySourceId: sources[2].id, name: "Hat-2 Gaz Sayacı",          type: "dogalgaz", location: "Üretim Hattı 2 Gaz Bağlantısı",  city: "Istanbul", unit: "m3",  companyId },
      { unitId: units[0].id, subUnitId: subUnits[2].id, energySourceId: sources[1].id, name: "Boya Elektrik Sayacı",      type: "elektrik", location: "Boya Bölümü Panosu",              city: "Istanbul", unit: "kWh", companyId },
      { unitId: units[0].id, subUnitId: subUnits[2].id, energySourceId: sources[3].id, name: "Boya Buhar Sayacı",         type: "buhar",    location: "Boya Buhar Hattı",                city: "Istanbul", unit: "ton", companyId },
      { unitId: units[0].id, subUnitId: subUnits[3].id, energySourceId: sources[0].id, name: "Yardımcı İşletme Elektrik", type: "elektrik", location: "Kompresör Odası",                 city: "Istanbul", unit: "kWh", companyId },
      { unitId: units[1].id, subUnitId: subUnits[4].id, energySourceId: sources[4].id, name: "Ofis Elektrik Sayacı",      type: "elektrik", location: "Kat Panosu",                      city: "Ankara",   unit: "kWh", companyId },
      { unitId: units[1].id, subUnitId: subUnits[4].id, energySourceId: sources[5].id, name: "Merkezi Isıtma Sayacı",     type: "dogalgaz", location: "Kazan Dairesi",                   city: "Ankara",   unit: "m3",  companyId },
      { unitId: units[1].id, subUnitId: subUnits[5].id, energySourceId: sources[4].id, name: "Konferans Elektrik Sayacı", type: "elektrik", location: "Konferans Panosu",                 city: "Ankara",   unit: "kWh", companyId },
      { unitId: units[1].id, subUnitId: subUnits[6].id, energySourceId: sources[4].id, name: "Veri Merkezi UPS Sayacı",   type: "elektrik", location: "Sunucu Odası",                    city: "Ankara",   unit: "kWh", companyId },
      { unitId: units[2].id, subUnitId: subUnits[7].id, energySourceId: sources[6].id, name: "A Blok Soğutucu Elektrik",  type: "elektrik", location: "A Blok Makine Dairesi",           city: "Izmir",    unit: "kWh", companyId },
      { unitId: units[2].id, subUnitId: subUnits[8].id, energySourceId: sources[6].id, name: "B Blok Soğutucu Elektrik",  type: "elektrik", location: "B Blok Makine Dairesi",           city: "Izmir",    unit: "kWh", companyId },
      { unitId: units[2].id, subUnitId: subUnits[9].id, energySourceId: sources[6].id, name: "Rampa Aydınlatma & Sistem", type: "elektrik", location: "Yükleme Rampası",                 city: "Izmir",    unit: "kWh", companyId },
      { unitId: units[2].id, subUnitId: subUnits[9].id, energySourceId: sources[7].id, name: "Jeneratör Gaz Sayacı",      type: "dogalgaz", location: "Jeneratör Odası",                 city: "Izmir",    unit: "m3",  companyId },
    ]).returning();

    // ── Tüketim Verileri ────────────────────────────────────────────────────
    const baselines = [
      { kwh: 420000, co2: 0.000472, tep: 0.0000860 },
      { kwh: 38000,  co2: 0.002016, tep: 0.0000083 },
      { kwh: 390000, co2: 0.000472, tep: 0.0000860 },
      { kwh: 32000,  co2: 0.002016, tep: 0.0000083 },
      { kwh: 280000, co2: 0.000472, tep: 0.0000860 },
      { kwh: 85,     co2: 0.2700,   tep: 0.0000860 },
      { kwh: 160000, co2: 0.000472, tep: 0.0000860 },
      { kwh: 95000,  co2: 0.000472, tep: 0.0000860 },
      { kwh: 18000,  co2: 0.002016, tep: 0.0000083 },
      { kwh: 22000,  co2: 0.000472, tep: 0.0000860 },
      { kwh: 75000,  co2: 0.000472, tep: 0.0000860 },
      { kwh: 310000, co2: 0.000472, tep: 0.0000860 },
      { kwh: 240000, co2: 0.000472, tep: 0.0000860 },
      { kwh: 45000,  co2: 0.000472, tep: 0.0000860 },
      { kwh: 8500,   co2: 0.002016, tep: 0.0000083 },
    ];

    const rows: {
      meterId: number; year: number; month: number;
      kwh: number; tep: number; co2: number;
      hdd: number; cdd: number; notes: string | null;
    }[] = [];

    const nowYear = new Date().getFullYear();
    const nowMonth = new Date().getMonth() + 1;
    const startYear = nowYear - 2;
    for (let year = startYear; year <= nowYear; year++) {
      for (let month = 1; month <= 12; month++) {
        if (year === nowYear && month > nowMonth) continue;
        for (let mi = 0; mi < meters.length; mi++) {
          const m = meters[mi];
          const b = baselines[mi];
          const w = weatherProfiles[m.city] ?? weatherProfiles["Istanbul"];
          const yearOffset = year - startYear;
          const yearTrend = 1.0 - yearOffset * 0.03;
          let factor: number;
          if (m.type === "dogalgaz") factor = gasFactor(month, m.city);
          else if (m.type === "buhar") factor = gasFactor(month, m.city) * 0.8 + 0.2;
          else factor = electricityFactor(month, m.city);
          const noise = 0.92 + (((mi * 7 + month * 13 + year * 3) % 100) / 100) * 0.16;
          const kwh = Math.round(b.kwh * factor * yearTrend * noise);
          rows.push({
            meterId: m.id, year, month,
            kwh,
            tep: parseFloat((kwh * b.tep).toFixed(2)),
            co2: parseFloat((kwh * b.co2).toFixed(2)),
            hdd: w.hdd[month - 1],
            cdd: w.cdd[month - 1],
            notes: null,
          });
        }
      }
    }

    for (let i = 0; i < rows.length; i += 500) {
      await db.insert(consumptionTable).values(rows.slice(i, i + 500));
    }

    // ── SWOT ────────────────────────────────────────────────────────────────
    await db.insert(swotTable).values([
      { unitId: units[0].id, category: "strengths",    title: "ISO 50001 Sertifikası",      description: "2022'den beri aktif enerji yönetim sistemi",         score: 4, impact: "yuksek", companyId },
      { unitId: units[0].id, category: "strengths",    title: "Enerji İzleme Altyapısı",    description: "Tüm sayaçlar SCADA sistemine entegre",               score: 4, impact: "yuksek", companyId },
      { unitId: units[0].id, category: "weaknesses",   title: "Eski Kompresörler",           description: "20+ yıllık hava kompresörleri %35 fazla tüketiyor", score: 2, impact: "yuksek", companyId },
      { unitId: units[0].id, category: "opportunities",title: "Çatı GES Kurulumu",           description: "45.000 m² çatıda 2 MWp güneş enerji potansiyeli",   score: 5, impact: "yuksek", companyId },
      { unitId: units[0].id, category: "threats",      title: "Elektrik Fiyat Artışı",       description: "Endüstriyel tarifelerdeki öngörülemeyen artışlar",   score: 3, impact: "yuksek", companyId },
      { unitId: units[1].id, category: "strengths",    title: "LED Aydınlatma Dönüşümü",    description: "2023'te tamamlanan tam LED dönüşümü — %42 tasarruf", score: 5, impact: "orta",   companyId },
      { unitId: units[1].id, category: "weaknesses",   title: "Eski Klima Sistemleri",       description: "5 kattaki klimalar 15 yıllık, EER değerleri düşük",  score: 2, impact: "orta",   companyId },
      { unitId: units[1].id, category: "opportunities",title: "Akıllı Bina Yönetimi",        description: "BMS sistemi ile %15-20 ek tasarruf potansiyeli",      score: 4, impact: "orta",   companyId },
      { unitId: units[1].id, category: "threats",      title: "Doğalgaz Arz Güvenliği",      description: "Kış aylarında gaz arzında kesinti riski",            score: 3, impact: "yuksek", companyId },
      { unitId: units[2].id, category: "strengths",    title: "Modern Soğutma Sistemleri",  description: "2021 yılında yenilenen A++ sınıfı soğutucular",       score: 5, impact: "yuksek", companyId },
      { unitId: units[2].id, category: "weaknesses",   title: "Yüksek Baz Enerji Tüketimi", description: "7/24 soğutma nedeniyle tüketim azaltmak zor",        score: 2, impact: "yuksek", companyId },
      { unitId: units[2].id, category: "opportunities",title: "Güneş Enerjisi + Depolama",  description: "GES + batarya ile gece enerji maliyeti düşürme",     score: 4, impact: "yuksek", companyId },
      { unitId: units[2].id, category: "threats",      title: "İklim Değişikliği",           description: "Artan sıcaklıklar soğutma yükünü artırıyor",         score: 4, impact: "yuksek", companyId },
    ]);

    // ── Riskler ─────────────────────────────────────────────────────────────
    await db.insert(risksTable).values([
      { unitId: units[0].id, type: "risk",    title: "Transformatör Arızası",            description: "Ana trafonun ömrü dolmaya yaklaşıyor",                  probability: 3, severity: 5, score: 15, mitigationPlan: "Yedek trafo temin planlanıyor",          owner: "Elektrik Bakım",   status: "acik",  companyId },
      { unitId: units[0].id, type: "firsat",  title: "Reaktif Güç Cezası Azaltma",       description: "Güç faktörü düzeltme ile fatura cezalarının önlenmesi", probability: 5, severity: 3, score: 15, mitigationPlan: "Kondansatör bankaları kurulumu",          owner: "Elektrik Bakım",   status: "acik",  companyId },
      { unitId: units[1].id, type: "risk",    title: "Veri Merkezi Soğutma Arızası",     description: "Klima arızasında sunucu ekipmanı zarar görür",           probability: 2, severity: 5, score: 10, mitigationPlan: "Yedek klima ünitesi ve sıcaklık alarmı", owner: "IT Altyapı",       status: "devam", companyId },
      { unitId: units[1].id, type: "firsat",  title: "Doğalgaz Verimlilik İyileştirmesi",description: "Kazan verimini %85'ten %92'ye çıkarmak",                probability: 4, severity: 3, score: 12, mitigationPlan: "Kazan modernizasyonu ihaleye çıkarılacak",owner: "Teknik Servis",    status: "acik",  companyId },
      { unitId: units[2].id, type: "risk",    title: "Freon Kaçağı",                     description: "Soğutucu akışkan kaçağı verimlilik ve çevre riski",      probability: 3, severity: 4, score: 12, mitigationPlan: "6 aylık periyodik bakım ve kaçak testi", owner: "Soğutma Bakım",    status: "devam", companyId },
      { unitId: units[2].id, type: "firsat",  title: "Termal Depolama Sistemi",          description: "Gece saatlerinde buz üreterek gündüz yükü düşürme",     probability: 4, severity: 4, score: 16, mitigationPlan: "FS çalışması başlatıldı",                owner: "Proje Departmanı", status: "acik",  companyId },
    ]);

    // ── SEU / ÖEK ───────────────────────────────────────────────────────────
    await db.insert(seuTable).values([
      { unitId: units[0].id, name: "Üretim Hattı Motorları", category: "motor",         annualKwh: 4800000, percentage: 38.5, priority: 1, targetReductionPercent: 12, responsible: "Üretim Müdürü",    notes: "VFD sürücü eklenecek",                         companyId },
      { unitId: units[0].id, name: "Boya Fırınları",         category: "isi",           annualKwh: 3200000, percentage: 25.7, priority: 2, targetReductionPercent: 8,  responsible: "Boya Bölüm Şefi",  notes: "Atık ısı geri kazanım projesi",                 companyId },
      { unitId: units[0].id, name: "Kompresör Sistemi",      category: "basinclihava",  annualKwh: 1900000, percentage: 15.2, priority: 3, targetReductionPercent: 20, responsible: "Bakım Müdürü",     notes: "Kaçak tespiti ve yeni nesil kompresör",         companyId },
      { unitId: units[1].id, name: "HVAC Sistemi",           category: "iklimlendirme", annualKwh: 820000,  percentage: 52.1, priority: 1, targetReductionPercent: 18, responsible: "Tesis Yöneticisi", notes: "Klima yenileme projesi",                        companyId },
      { unitId: units[1].id, name: "Bilgisayar & Sunucu",    category: "bilisim",       annualKwh: 420000,  percentage: 26.7, priority: 2, targetReductionPercent: 10, responsible: "IT Direktörü",     notes: "Sanallaştırma ile fiziksel sunucu azaltma",    companyId },
      { unitId: units[2].id, name: "Soğutma Kompresörleri",  category: "sogutma",       annualKwh: 5200000, percentage: 61.3, priority: 1, targetReductionPercent: 7,  responsible: "Soğutma Mühendisi",notes: "Frekans konvertörü ile kısmi yük optimizasyonu",companyId },
      { unitId: units[2].id, name: "Kondenser Fanları",      category: "sogutma",       annualKwh: 1100000, percentage: 13.0, priority: 2, targetReductionPercent: 15, responsible: "Soğutma Mühendisi",notes: "EC fan motoru yenileme",                        companyId },
    ]);

    // ── Enerji Hedefleri ────────────────────────────────────────────────────
    await db.insert(energyTargetsTable).values([
      { unitId: units[0].id, name: "İstanbul Fabrika 2030 Karbon Nötr Yolu",  baselineYear: 2022, targetYear: 2030, targetReductionPercent: 20, notes: "ISO 50001 revizyon hedefi — VFD, GES ve atık ısı geri kazanım projeleri kapsamında", companyId },
      { unitId: units[0].id, name: "Kompresör & Motor Verimliliği Projesi",   baselineYear: 2023, targetYear: 2026, targetReductionPercent: 12, notes: "ÖEK 1 ve 3 kapsamındaki motor grubu için kısa vadeli hedef",                        companyId },
      { unitId: units[1].id, name: "Ankara Ofis Net-Sıfır Enerji Hedefi",    baselineYear: 2022, targetYear: 2028, targetReductionPercent: 15, notes: "LED dönüşümü tamamlandı; BMS ve klima yenileme ile kalan %9 hedefleniyor",          companyId },
      { unitId: units[1].id, name: "Veri Merkezi PUE İyileştirmesi",         baselineYear: 2023, targetYear: 2025, targetReductionPercent: 10, notes: "Sanallaştırma ve soğutma optimizasyonu ile PUE 1.8 → 1.5 hedefi",                  companyId },
      { unitId: units[2].id, name: "İzmir Soğuk Zincir Uzun Vadeli Azalma",  baselineYear: 2021, targetYear: 2030, targetReductionPercent: 25, notes: "Termal depolama + GES + EC fan projeleri; soğutma yükü optimizasyonu odaklı",      companyId },
      { unitId: units[2].id, name: "Kondenser Fan Yenileme Kısa Vadeli Hedef",baselineYear: 2023, targetYear: 2025, targetReductionPercent: 15, notes: "EC fan motoru yenileme tamamlanınca hedef aşılabilir",                            companyId },
    ]);

    res.json({
      ok: true,
      summary: {
        units: units.length,
        subUnits: subUnits.length,
        energySources: sources.length,
        meters: meters.length,
        consumptionRecords: rows.length,
      },
    });
  } catch (err: any) {
    console.error("[seed] Hata:", err);
    res.status(500).json({ ok: false, error: err?.message ?? "Bilinmeyen hata" });
  }
});

// POST /api/admin/reset — body: { mode: "demo" | "all" }
router.post("/admin/reset", requireAuth, requireAdmin, async (req, res) => {
  const mode = req.body?.mode as string;
  if (mode !== "demo" && mode !== "all") {
    res.status(400).json({ ok: false, error: "mode 'demo' veya 'all' olmalı" });
    return;
  }

  try {
    if (mode === "all") {
      await db.delete(consumptionTable);
      await db.delete(metersTable);
      await db.delete(energySourcesTable);
      await db.delete(subUnitsTable);
      await db.delete(swotTable);
      await db.delete(risksTable);
      await db.delete(seuTable);
      await db.delete(energyTargetsTable);
      await db.delete(unitsTable);
      await db.delete(usersTable).where(ne(usersTable.username, "admin"));
      res.json({ ok: true, mode: "all" });
      return;
    }

    // mode === "demo": sadece is_demo=true olan verileri sil
    await db.delete(usersTable).where(eq(usersTable.isDemo, true));

    const demoUnits = await db
      .select({ id: unitsTable.id })
      .from(unitsTable)
      .where(eq(unitsTable.isDemo, true));

    if (demoUnits.length > 0) {
      const demoUnitIds = demoUnits.map((u) => u.id);
      // meters'ın cascade'i yok, önce sil (consumption cascade ile silinir)
      await db.delete(metersTable).where(inArray(metersTable.unitId, demoUnitIds));
      // unitsTable silince: sub_units, energy_sources, swot, risks, seu cascade ile silinir
      await db.delete(unitsTable).where(eq(unitsTable.isDemo, true));
    }

    res.json({ ok: true, mode: "demo" });
  } catch (err: any) {
    console.error("[reset] Hata:", err);
    res.status(500).json({ ok: false, error: err?.message ?? "Bilinmeyen hata" });
  }
});

export default router;
