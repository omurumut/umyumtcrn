import { createHash } from "crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
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
} from "@workspace/db/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

function hashPassword(password: string): string {
  return createHash("sha256").update(password + "eys_salt_2024").digest("hex");
}

// Mevsimsel HDD/CDD değerleri (Türkiye şehirleri)
const weatherProfiles: Record<string, { hdd: number[]; cdd: number[]; avgTemp: number[] }> = {
  Istanbul: {
    hdd: [310, 270, 200, 80, 20, 0, 0, 0, 10, 80, 190, 280],
    cdd: [0, 0, 0, 10, 50, 150, 220, 210, 120, 30, 5, 0],
    avgTemp: [5, 6, 8, 13, 18, 23, 26, 26, 22, 16, 11, 7],
  },
  Ankara: {
    hdd: [420, 380, 280, 120, 30, 0, 0, 0, 20, 110, 270, 380],
    cdd: [0, 0, 0, 5, 40, 130, 210, 200, 100, 20, 0, 0],
    avgTemp: [0, 2, 6, 12, 17, 22, 26, 26, 21, 14, 7, 2],
  },
  Izmir: {
    hdd: [200, 170, 110, 30, 5, 0, 0, 0, 0, 30, 100, 180],
    cdd: [0, 0, 5, 30, 90, 190, 290, 280, 180, 70, 15, 0],
    avgTemp: [8, 9, 12, 17, 22, 27, 31, 31, 26, 20, 14, 10],
  },
};

// Tüketim profili: mevsim faktörü (elektrik)
function electricityFactor(month: number, city: string): number {
  const w = weatherProfiles[city];
  const hdd = w.hdd[month - 1];
  const cdd = w.cdd[month - 1];
  const base = 0.7;
  return base + (hdd / 500) * 0.3 + (cdd / 300) * 0.2;
}

// Tüketim profili: doğalgaz (kış yüksek)
function gasFactorFn(month: number, city: string): number {
  const w = weatherProfiles[city];
  const hdd = w.hdd[month - 1];
  return 0.2 + (hdd / 450) * 1.2;
}

async function seed() {
  console.log("🌱 Demo veri yükleniyor...\n");

  // ─── Birimleri temizle (cascade ile alt veriler de silinir) ───────────────
  await db.delete(consumptionTable);
  await db.delete(metersTable);
  await db.delete(energySourcesTable);
  await db.delete(subUnitsTable);
  await db.delete(swotTable);
  await db.delete(risksTable);
  await db.delete(seuTable);
  await db.delete(unitsTable);
  // admin kullanıcısını silme, sadece demo kullanıcıları ekle
  await db.delete(usersTable).where(
    // @ts-ignore
    usersTable.username !== "admin"
  );
  console.log("🗑️  Eski demo veriler temizlendi");

  // ─── Birimler ─────────────────────────────────────────────────────────────
  const units = await db.insert(unitsTable).values([
    {
      name: "İstanbul Fabrika A",
      location: "Dudullu OSB, İstanbul",
      type: "fabrika",
      city: "Istanbul",
      responsible: "Mehmet Yılmaz",
      description: "Tekstil üretim fabrikası — 45.000 m²",
      active: true,
    },
    {
      name: "Ankara Merkez Ofis",
      location: "Çankaya, Ankara",
      type: "ofis",
      city: "Ankara",
      responsible: "Ayşe Kaya",
      description: "Genel merkez ofisi — 8.500 m²",
      active: true,
    },
    {
      name: "İzmir Lojistik Depo",
      location: "Kemalpaşa OSB, İzmir",
      type: "depo",
      city: "Izmir",
      responsible: "Fatih Demir",
      description: "Soğuk zincir lojistik deposu — 22.000 m²",
      active: true,
    },
  ]).returning();

  console.log(`✅ ${units.length} birim oluşturuldu`);

  // ─── Kullanıcılar ─────────────────────────────────────────────────────────
  await db.insert(usersTable).values([
    {
      username: "istanbul_yonetici",
      passwordHash: hashPassword("demo123"),
      name: "Mehmet Yılmaz",
      role: "user",
      unitId: units[0].id,
      active: true,
    },
    {
      username: "ankara_yonetici",
      passwordHash: hashPassword("demo123"),
      name: "Ayşe Kaya",
      role: "user",
      unitId: units[1].id,
      active: true,
    },
    {
      username: "izmir_yonetici",
      passwordHash: hashPassword("demo123"),
      name: "Fatih Demir",
      role: "user",
      unitId: units[2].id,
      active: true,
    },
  ]).onConflictDoNothing();
  console.log("✅ Demo kullanıcılar oluşturuldu (şifre: demo123)");

  // ─── Alt Birimler ─────────────────────────────────────────────────────────
  const subUnitsData = [
    // İstanbul
    { unitId: units[0].id, name: "Üretim Hattı 1", city: "Istanbul", description: "Ana üretim hattı" },
    { unitId: units[0].id, name: "Üretim Hattı 2", city: "Istanbul", description: "İkincil üretim hattı" },
    { unitId: units[0].id, name: "Boya & Apre", city: "Istanbul", description: "Boya ve apre bölümü" },
    { unitId: units[0].id, name: "Yardımcı İşletme", city: "Istanbul", description: "Kompresör, buhar, soğutma" },
    // Ankara
    { unitId: units[1].id, name: "Ofis Katı 1-5", city: "Ankara", description: "1-5. kat ofis alanları" },
    { unitId: units[1].id, name: "Toplantı & Konferans", city: "Ankara", description: "Konferans salonları ve toplantı odaları" },
    { unitId: units[1].id, name: "Veri Merkezi", city: "Ankara", description: "Sunucu odası ve UPS sistemleri" },
    // İzmir
    { unitId: units[2].id, name: "Soğuk Depo A Blok", city: "Izmir", description: "-20°C donmuş ürün deposu" },
    { unitId: units[2].id, name: "Soğuk Depo B Blok", city: "Izmir", description: "+4°C soğutmalı depo" },
    { unitId: units[2].id, name: "Yükleme Rampası", city: "Izmir", description: "Araç yükleme/boşaltma alanı" },
  ];

  const subUnits = await db.insert(subUnitsTable).values(subUnitsData).returning();
  console.log(`✅ ${subUnits.length} alt birim oluşturuldu`);

  // ─── Enerji Kaynakları ────────────────────────────────────────────────────
  const sourcesData = [
    // İstanbul - fabrika: elektrik + dogalgaz + buhar
    { unitId: units[0].id, type: "elektrik", name: "Trafo Merkezi A", unit: "kWh" },
    { unitId: units[0].id, type: "elektrik", name: "Trafo Merkezi B", unit: "kWh" },
    { unitId: units[0].id, type: "dogalgaz", name: "Doğalgaz Ana Hat", unit: "m3" },
    { unitId: units[0].id, type: "buhar", name: "Buhar Üretim Merkezi", unit: "ton" },
    // Ankara - ofis: elektrik + dogalgaz
    { unitId: units[1].id, type: "elektrik", name: "Ana Elektrik Panosu", unit: "kWh" },
    { unitId: units[1].id, type: "dogalgaz", name: "Isıtma Sistemi", unit: "m3" },
    // İzmir - depo: elektrik (yoğun soğutma)
    { unitId: units[2].id, type: "elektrik", name: "Soğutma Sistemleri Elektrik", unit: "kWh" },
    { unitId: units[2].id, type: "dogalgaz", name: "Isıtma & Jeneratör", unit: "m3" },
  ];

  const sources = await db.insert(energySourcesTable).values(sourcesData).returning();
  console.log(`✅ ${sources.length} enerji kaynağı oluşturuldu`);

  // ─── Sayaçlar ─────────────────────────────────────────────────────────────
  // Her alt birim için ilgili enerji kaynağından sayaç
  // İstanbul alt birimleri: [0]=Hat1 [1]=Hat2 [2]=Boya [3]=Yardımcı
  // İstanbul kaynaklar: [0]=TrafoA [1]=TrafoB [2]=DogGaz [3]=Buhar
  const metersData = [
    // İstanbul Hat1
    { unitId: units[0].id, subUnitId: subUnits[0].id, energySourceId: sources[0].id, name: "Hat-1 Elektrik Sayacı", type: "elektrik", location: "Üretim Hattı 1 Panosu", city: "Istanbul", unit: "kWh" },
    { unitId: units[0].id, subUnitId: subUnits[0].id, energySourceId: sources[2].id, name: "Hat-1 Gaz Sayacı", type: "dogalgaz", location: "Üretim Hattı 1 Gaz Bağlantısı", city: "Istanbul", unit: "m3" },
    // İstanbul Hat2
    { unitId: units[0].id, subUnitId: subUnits[1].id, energySourceId: sources[1].id, name: "Hat-2 Elektrik Sayacı", type: "elektrik", location: "Üretim Hattı 2 Panosu", city: "Istanbul", unit: "kWh" },
    { unitId: units[0].id, subUnitId: subUnits[1].id, energySourceId: sources[2].id, name: "Hat-2 Gaz Sayacı", type: "dogalgaz", location: "Üretim Hattı 2 Gaz Bağlantısı", city: "Istanbul", unit: "m3" },
    // İstanbul Boya
    { unitId: units[0].id, subUnitId: subUnits[2].id, energySourceId: sources[1].id, name: "Boya Elektrik Sayacı", type: "elektrik", location: "Boya Bölümü Panosu", city: "Istanbul", unit: "kWh" },
    { unitId: units[0].id, subUnitId: subUnits[2].id, energySourceId: sources[3].id, name: "Boya Buhar Sayacı", type: "buhar", location: "Boya Buhar Hattı", city: "Istanbul", unit: "ton" },
    // İstanbul Yardımcı
    { unitId: units[0].id, subUnitId: subUnits[3].id, energySourceId: sources[0].id, name: "Yardımcı İşletme Elektrik", type: "elektrik", location: "Kompresör Odası", city: "Istanbul", unit: "kWh" },
    // Ankara Ofis 1-5
    { unitId: units[1].id, subUnitId: subUnits[4].id, energySourceId: sources[4].id, name: "Ofis Elektrik Sayacı", type: "elektrik", location: "Kat Panosu", city: "Ankara", unit: "kWh" },
    { unitId: units[1].id, subUnitId: subUnits[4].id, energySourceId: sources[5].id, name: "Merkezi Isıtma Sayacı", type: "dogalgaz", location: "Kazan Dairesi", city: "Ankara", unit: "m3" },
    // Ankara Toplantı
    { unitId: units[1].id, subUnitId: subUnits[5].id, energySourceId: sources[4].id, name: "Konferans Elektrik Sayacı", type: "elektrik", location: "Konferans Panosu", city: "Ankara", unit: "kWh" },
    // Ankara Veri Merkezi
    { unitId: units[1].id, subUnitId: subUnits[6].id, energySourceId: sources[4].id, name: "Veri Merkezi UPS Sayacı", type: "elektrik", location: "Sunucu Odası", city: "Ankara", unit: "kWh" },
    // İzmir Soğuk A
    { unitId: units[2].id, subUnitId: subUnits[7].id, energySourceId: sources[6].id, name: "A Blok Soğutucu Elektrik", type: "elektrik", location: "A Blok Makine Dairesi", city: "Izmir", unit: "kWh" },
    // İzmir Soğuk B
    { unitId: units[2].id, subUnitId: subUnits[8].id, energySourceId: sources[6].id, name: "B Blok Soğutucu Elektrik", type: "elektrik", location: "B Blok Makine Dairesi", city: "Izmir", unit: "kWh" },
    // İzmir Rampa
    { unitId: units[2].id, subUnitId: subUnits[9].id, energySourceId: sources[6].id, name: "Rampa Aydınlatma & Sistem", type: "elektrik", location: "Yükleme Rampası", city: "Izmir", unit: "kWh" },
    { unitId: units[2].id, subUnitId: subUnits[9].id, energySourceId: sources[7].id, name: "Jeneratör Gaz Sayacı", type: "dogalgaz", location: "Jeneratör Odası", city: "Izmir", unit: "m3" },
  ];

  const meters = await db.insert(metersTable).values(metersData).returning();
  console.log(`✅ ${meters.length} sayaç oluşturuldu`);

  // ─── Tüketim Verileri (2024-2025) ─────────────────────────────────────────
  // Baz tüketimler (aylık) sayaç türüne göre
  const baselines: Record<number, { kwh: number; co2Factor: number; tepFactor: number }> = {
    // İstanbul
    0: { kwh: 420000, co2Factor: 0.000472, tepFactor: 0.0000860 },  // Hat1 Elekt
    1: { kwh: 38000,  co2Factor: 0.002016, tepFactor: 0.0000083 },  // Hat1 Gaz (m3)
    2: { kwh: 390000, co2Factor: 0.000472, tepFactor: 0.0000860 },  // Hat2 Elekt
    3: { kwh: 32000,  co2Factor: 0.002016, tepFactor: 0.0000083 },  // Hat2 Gaz
    4: { kwh: 280000, co2Factor: 0.000472, tepFactor: 0.0000860 },  // Boya Elekt
    5: { kwh: 85,     co2Factor: 0.2700,   tepFactor: 0.0000860 },  // Boya Buhar (ton)
    6: { kwh: 160000, co2Factor: 0.000472, tepFactor: 0.0000860 },  // Yardımcı Elekt
    // Ankara
    7: { kwh: 95000,  co2Factor: 0.000472, tepFactor: 0.0000860 },  // Ofis Elekt
    8: { kwh: 18000,  co2Factor: 0.002016, tepFactor: 0.0000083 },  // Ofis Gaz
    9: { kwh: 22000,  co2Factor: 0.000472, tepFactor: 0.0000860 },  // Konf Elekt
    10: { kwh: 75000,  co2Factor: 0.000472, tepFactor: 0.0000860 }, // Veri Merkezi
    // İzmir
    11: { kwh: 310000, co2Factor: 0.000472, tepFactor: 0.0000860 }, // A Blok Soğ
    12: { kwh: 240000, co2Factor: 0.000472, tepFactor: 0.0000860 }, // B Blok Soğ
    13: { kwh: 45000,  co2Factor: 0.000472, tepFactor: 0.0000860 }, // Rampa Elekt
    14: { kwh: 8500,   co2Factor: 0.002016, tepFactor: 0.0000083 }, // Jener Gaz
  };

  const consumptionRows: {
    meterId: number; year: number; month: number;
    kwh: number; tep: number; co2: number;
    hdd: number; cdd: number; notes: string | null;
  }[] = [];

  const years = [2024, 2025];

  for (const year of years) {
    for (let month = 1; month <= 12; month++) {
      // 2025 için Haziran'dan sonra veri yok
      if (year === 2025 && month > 5) continue;

      for (let mIdx = 0; mIdx < meters.length; mIdx++) {
        const meter = meters[mIdx];
        const base = baselines[mIdx];
        const city = meter.city;
        const w = weatherProfiles[city] ?? weatherProfiles["Istanbul"];

        // Yıllık trend: 2025 biraz daha verimli (-3%)
        const yearTrend = year === 2025 ? 0.97 : 1.0;

        // Mevsimsellik
        let factor: number;
        if (meter.type === "dogalgaz") {
          factor = gasFactorFn(month, city);
        } else if (meter.type === "buhar") {
          factor = gasFactorFn(month, city) * 0.8 + 0.2;
        } else {
          factor = electricityFactor(month, city);
        }

        // Küçük rastlantısal varyasyon (±8%)
        const noise = 0.92 + (((mIdx * 7 + month * 13 + year * 3) % 100) / 100) * 0.16;

        const kwh = Math.round(base.kwh * factor * yearTrend * noise);
        const tep = parseFloat((kwh * base.tepFactor).toFixed(2));
        const co2 = parseFloat((kwh * base.co2Factor).toFixed(2));
        const hdd = w.hdd[month - 1];
        const cdd = w.cdd[month - 1];

        consumptionRows.push({
          meterId: meter.id,
          year,
          month,
          kwh,
          tep,
          co2,
          hdd,
          cdd,
          notes: null,
        });
      }
    }
  }

  // Toplu insert (500'lük batch)
  for (let i = 0; i < consumptionRows.length; i += 500) {
    await db.insert(consumptionTable).values(consumptionRows.slice(i, i + 500));
  }
  console.log(`✅ ${consumptionRows.length} tüketim kaydı oluşturuldu (2024-2025)`);

  // ─── SWOT ─────────────────────────────────────────────────────────────────
  const swotData = [
    // İstanbul
    { unitId: units[0].id, category: "guc", title: "ISO 50001 Sertifikası", description: "2022'den beri aktif enerji yönetim sistemi sertifikası", score: 4, impact: "yuksek" },
    { unitId: units[0].id, category: "guc", title: "Enerji İzleme Altyapısı", description: "Tüm sayaçlar SCADA sistemine entegre", score: 4, impact: "yuksek" },
    { unitId: units[0].id, category: "zayiflik", title: "Eski Kompresörler", description: "20+ yıllık hava kompresörleri %35 fazla enerji tüketiyor", score: 2, impact: "yuksek" },
    { unitId: units[0].id, category: "zayiflik", title: "Çatı İzolasyon Eksikliği", description: "Boya binası çatısında ısı kayıpları", score: 2, impact: "orta" },
    { unitId: units[0].id, category: "firsat", title: "Çatı GES Kurulumu", description: "45.000 m² çatıda 2 MWp güneş enerji sistemi potansiyeli", score: 5, impact: "yuksek" },
    { unitId: units[0].id, category: "firsat", title: "Atık Isı Geri Kazanımı", description: "Boya fırınlarından çıkan atık ısının kullanımı", score: 4, impact: "yuksek" },
    { unitId: units[0].id, category: "tehdit", title: "Elektrik Fiyat Artışı", description: "Endüstriyel elektrik tarifelerindeki öngörülemeyen artışlar", score: 3, impact: "yuksek" },
    // Ankara
    { unitId: units[1].id, category: "guc", title: "LED Aydınlatma Dönüşümü", description: "2023'te tamamlanan tam LED dönüşümü — %42 tasarruf", score: 5, impact: "orta" },
    { unitId: units[1].id, category: "zayiflik", title: "Eski Klima Sistemleri", description: "5 kattaki klima sistemleri 15 yıllık, EER değerleri düşük", score: 2, impact: "orta" },
    { unitId: units[1].id, category: "firsat", title: "Akıllı Bina Yönetimi", description: "BMS sistemi ile %15-20 ek tasarruf potansiyeli", score: 4, impact: "orta" },
    { unitId: units[1].id, category: "tehdit", title: "Doğalgaz Arz Güvenliği", description: "Kış aylarında gaz arzında kesinti riski", score: 3, impact: "yuksek" },
    // İzmir
    { unitId: units[2].id, category: "guc", title: "Modern Soğutma Sistemleri", description: "2021 yılında yenilenen A++ sınıfı soğutucular", score: 5, impact: "yuksek" },
    { unitId: units[2].id, category: "zayiflik", title: "Yüksek Baz Enerji Tüketimi", description: "7/24 soğutma zorunluluğu nedeniyle tüketim azaltmak zor", score: 2, impact: "yuksek" },
    { unitId: units[2].id, category: "firsat", title: "Güneş Enerjisi + Depolama", description: "GES + batarya sistemi ile gece enerji maliyeti düşürme", score: 4, impact: "yuksek" },
    { unitId: units[2].id, category: "tehdit", title: "İklim Değişikliği", description: "Artan sıcaklıklar soğutma yükünü artırıyor", score: 4, impact: "yuksek" },
  ];

  await db.insert(swotTable).values(swotData);
  console.log(`✅ ${swotData.length} SWOT maddesi oluşturuldu`);

  // ─── Riskler ──────────────────────────────────────────────────────────────
  const risksData = [
    { unitId: units[0].id, type: "risk", title: "Transformatör Arızası", description: "Ana trafonun ömrü dolmaya yaklaşıyor", probability: 3, severity: 5, score: 15, mitigationPlan: "Yedek trafo temin edilmesi planlanıyor", owner: "Elektrik Bakım", status: "acik" },
    { unitId: units[0].id, type: "risk", title: "Mevzuat Uyumsuzluğu", description: "Yeni enerji verimliliği yönetmeliğine uyum eksikliği", probability: 2, severity: 4, score: 8, mitigationPlan: "Danışmanlık hizmeti alınacak", owner: "Çevre & Enerji Bölümü", status: "devam" },
    { unitId: units[0].id, type: "firsat", title: "Reaktif Güç Cezası Azaltma", description: "Güç faktörü düzeltme ile fatura cezalarının önlenmesi", probability: 5, severity: 3, score: 15, mitigationPlan: "Kondansatör bankaları kurulumu", owner: "Elektrik Bakım", status: "acik" },
    { unitId: units[1].id, type: "risk", title: "Veri Merkezi Soğutma Arızası", description: "Klima arızasında sunucu ekipmanı zarar görür", probability: 2, severity: 5, score: 10, mitigationPlan: "Yedek klima ünitesi ve sıcaklık alarmı", owner: "IT Altyapı", status: "devam" },
    { unitId: units[1].id, type: "firsat", title: "Doğalgaz Verimlilik İyileştirmesi", description: "Kazan verimini %85'ten %92'ye çıkarmak", probability: 4, severity: 3, score: 12, mitigationPlan: "Kazan modernizasyonu ihaleye çıkarılacak", owner: "Teknik Servis", status: "acik" },
    { unitId: units[2].id, type: "risk", title: "Freon Kaçağı", description: "Soğutucu akışkan kaçağı hem verimlilik hem çevre riski", probability: 3, severity: 4, score: 12, mitigationPlan: "6 aylık periyodik bakım ve kaçak testi", owner: "Soğutma Bakım", status: "devam" },
    { unitId: units[2].id, type: "firsat", title: "Termal Depolama Sistemi", description: "Gece saatlerinde buz üreterek gündüz yükü düşürme", probability: 4, severity: 4, score: 16, mitigationPlan: "FS çalışması başlatıldı", owner: "Proje Departmanı", status: "acik" },
  ];

  await db.insert(risksTable).values(risksData);
  console.log(`✅ ${risksData.length} risk/fırsat maddesi oluşturuldu`);

  // ─── SEU / ÖEK ────────────────────────────────────────────────────────────
  const seuData = [
    // İstanbul
    { unitId: units[0].id, name: "Üretim Hattı Motorları", category: "motor", annualKwh: 4800000, percentage: 38.5, priority: 1, targetReductionPercent: 12, responsible: "Üretim Müdürü", notes: "VFD sürücü eklenecek" },
    { unitId: units[0].id, name: "Boya Fırınları", category: "isi", annualKwh: 3200000, percentage: 25.7, priority: 2, targetReductionPercent: 8, responsible: "Boya Bölüm Şefi", notes: "Atık ısı geri kazanım projesi" },
    { unitId: units[0].id, name: "Kompresör Sistemi", category: "basinclihava", annualKwh: 1900000, percentage: 15.2, priority: 3, targetReductionPercent: 20, responsible: "Bakım Müdürü", notes: "Kaçak tespiti ve yeni nesil kompresör" },
    { unitId: units[0].id, name: "Aydınlatma", category: "aydinlatma", annualKwh: 580000, percentage: 4.7, priority: 4, targetReductionPercent: 40, responsible: "Bina Yöneticisi", notes: "LED dönüşümü devam ediyor" },
    // Ankara
    { unitId: units[1].id, name: "HVAC Sistemi", category: "iklimlendirme", annualKwh: 820000, percentage: 52.1, priority: 1, targetReductionPercent: 18, responsible: "Tesis Yöneticisi", notes: "Klima yenileme projesi" },
    { unitId: units[1].id, name: "Bilgisayar & Sunucu", category: "bilisim", annualKwh: 420000, percentage: 26.7, priority: 2, targetReductionPercent: 10, responsible: "IT Direktörü", notes: "Sanallaştırma ile fiziksel sunucu azaltma" },
    { unitId: units[1].id, name: "Aydınlatma", category: "aydinlatma", annualKwh: 185000, percentage: 11.8, priority: 3, targetReductionPercent: 5, responsible: "Bina Yöneticisi", notes: "LED tamamlandı, sensör eklenecek" },
    // İzmir
    { unitId: units[2].id, name: "Soğutma Kompresörleri", category: "sogutma", annualKwh: 5200000, percentage: 61.3, priority: 1, targetReductionPercent: 7, responsible: "Soğutma Mühendisi", notes: "Frekans konvertörü ile kısmi yük optimizasyonu" },
    { unitId: units[2].id, name: "Kondenser Fanları", category: "sogutma", annualKwh: 1100000, percentage: 13.0, priority: 2, targetReductionPercent: 15, responsible: "Soğutma Mühendisi", notes: "EC fan motoru yenileme" },
    { unitId: units[2].id, name: "Aydınlatma & Yardımcı", category: "aydinlatma", annualKwh: 380000, percentage: 4.5, priority: 3, targetReductionPercent: 30, responsible: "Depo Müdürü", notes: "Hareket sensörlü LED" },
  ];

  await db.insert(seuTable).values(seuData);
  console.log(`✅ ${seuData.length} ÖEK (SEU) maddesi oluşturuldu`);

  console.log("\n🎉 Demo veri yükleme tamamlandı!");
  console.log("─────────────────────────────────────────");
  console.log("Giriş bilgileri:");
  console.log("  Admin    : admin / admin123");
  console.log("  İstanbul : istanbul_yonetici / demo123");
  console.log("  Ankara   : ankara_yonetici / demo123");
  console.log("  İzmir    : izmir_yonetici / demo123");
  console.log("─────────────────────────────────────────");

  await pool.end();
}

seed().catch((err) => {
  console.error("❌ Seed hatası:", err);
  process.exit(1);
});
