import { Router } from "express";
import { db, consumptionTable, seuTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

router.post("/ai/suggestions", requireAuth, async (req, res) => {
  try {
    const { year, focus, unitId: bodyUnitId } = req.body;
    const yr = parseInt(year) || new Date().getFullYear();

    const user = req.user!;
    const resolvedUnitId: number | null =
      user.role !== "admin" && user.unitId !== null
        ? user.unitId
        : (bodyUnitId !== undefined && bodyUnitId !== null ? parseInt(bodyUnitId) : null);

    const consumptionWhere = resolvedUnitId !== null
      ? and(eq(consumptionTable.year, yr), eq(consumptionTable.unitId, resolvedUnitId))
      : eq(consumptionTable.year, yr);

    const rows = await db.select().from(consumptionTable).where(consumptionWhere);

    const seuItems = resolvedUnitId !== null
      ? await db.select().from(seuTable).where(eq(seuTable.unitId, resolvedUnitId)).orderBy(seuTable.priority)
      : await db.select().from(seuTable).orderBy(seuTable.priority);

    const totalKwh = rows.reduce((a, r) => a + r.kwh, 0);

    const suggestions = [];

    const lightingSeu = seuItems.find(s => s.category === "aydinlatma");
    const lightingKwh = lightingSeu?.annualKwh ?? totalKwh * 0.15;
    suggestions.push({
      title: "LED Aydınlatmaya Geçiş",
      description: `Tesisteki geleneksel aydınlatma sistemlerini LED teknolojisiyle değiştirerek %60-70 enerji tasarrufu sağlanabilir. Yıllık tahmini tüketim ${Math.round(lightingKwh).toLocaleString("tr-TR")} kWh olan aydınlatma sisteminde bu dönüşüm kritik öneme sahiptir.`,
      potentialSavingKwh: Math.round(lightingKwh * 0.6),
      potentialSavingPercent: Math.round((lightingKwh * 0.6 / (totalKwh || 1)) * 1000) / 10,
      paybackMonths: 15,
      priority: "yuksek",
      category: "Aydınlatma",
    });

    const compressorSeu = seuItems.find(s => s.category === "kompresör");
    const compressorKwh = compressorSeu?.annualKwh ?? totalKwh * 0.12;
    suggestions.push({
      title: "Kompresör Sistem Optimizasyonu",
      description: "Basınçlı hava sistemlerinde tespit edilen kaçakların giderilmesi ve basınç setpointinin optimize edilmesi ile %20-30 enerji tasarrufu mümkündür. Hava kaçağı tespiti için ultrasonik dedektör kullanılması önerilir.",
      potentialSavingKwh: Math.round(compressorKwh * 0.25),
      potentialSavingPercent: Math.round((compressorKwh * 0.25 / (totalKwh || 1)) * 1000) / 10,
      paybackMonths: 9,
      priority: "yuksek",
      category: "Kompresör",
    });

    const hvacSeu = seuItems.find(s => s.category === "iklimlendirme");
    const hvacKwh = hvacSeu?.annualKwh ?? totalKwh * 0.25;
    suggestions.push({
      title: "HVAC Sistem Optimizasyonu ve BMS Entegrasyonu",
      description: "Bina yönetim sistemi entegrasyonu ile iklim kontrolü otomasyonu sağlanarak %15-25 tasarruf elde edilebilir. Setpoint optimizasyonu ve bölgesel kontrol stratejileri uygulanmalıdır.",
      potentialSavingKwh: Math.round(hvacKwh * 0.2),
      potentialSavingPercent: Math.round((hvacKwh * 0.2 / (totalKwh || 1)) * 1000) / 10,
      paybackMonths: 21,
      priority: "orta",
      category: "İklimlendirme",
    });

    suggestions.push({
      title: "IE3/IE4 Yüksek Verimli Motor Değişimi",
      description: "Üretim hatlarındaki eski IE1 sınıfı motorların IE3 veya IE4 sınıfı yüksek verimli motorlarla değiştirilmesi yıllık %3-8 tasarruf sağlar. Frekans invertörü eklenmesi bu tasarrufu %10-15 seviyesine çıkarabilir.",
      potentialSavingKwh: Math.round(totalKwh * 0.06),
      potentialSavingPercent: 6,
      paybackMonths: 30,
      priority: "orta",
      category: "Motor Sistemleri",
    });

    suggestions.push({
      title: "Çatı Güneş Enerji Sistemi (GES) Kurulumu",
      description: `Tesisin çatı alanına kurulacak GES ile yıllık ${Math.round(totalKwh * 0.15).toLocaleString("tr-TR")} kWh yenilenebilir enerji üretimi hedeflenebilir. CO₂ emisyonunu önemli ölçüde azaltacaktır.`,
      potentialSavingKwh: Math.round(totalKwh * 0.15),
      potentialSavingPercent: 15,
      paybackMonths: 72,
      priority: "yuksek",
      category: "Yenilenebilir Enerji",
    });

    suggestions.push({
      title: "Termal İzolasyon İyileştirmesi",
      description: "Üretim binasının dış cephesi, çatı ve boru hatlarındaki ısı kayıplarının termal kamera ile tespit edilmesi ve izolasyon iyileştirmesi yapılması.",
      potentialSavingKwh: Math.round(totalKwh * 0.08),
      potentialSavingPercent: 8,
      paybackMonths: 24,
      priority: "orta",
      category: "Isı Yönetimi",
    });

    suggestions.push({
      title: "Alt Sayaç ve Enerji Yönetim Yazılımı Genişletmesi",
      description: "Mevcut ölçüm altyapısını genişleterek her üretim hattı ve kritik ekipman bazında alt sayaç kurulumu yapılması. Gerçek zamanlı veri izleme ile enerji verimsizlikleri anında tespit edilebilir.",
      potentialSavingKwh: Math.round(totalKwh * 0.05),
      potentialSavingPercent: 5,
      paybackMonths: 9,
      priority: "yuksek",
      category: "Enerji Yönetimi",
    });

    suggestions.push({
      title: "Yük Dengeleme ve Vardiya Optimizasyonu",
      description: "Enerji yoğun ekipmanların kullanımının düşük tarife saatlerine kaydırılması ve tepe yük yönetimi stratejilerinin uygulanması ile enerji maliyetleri %10-15 oranında azaltılabilir.",
      potentialSavingKwh: Math.round(totalKwh * 0.03),
      potentialSavingPercent: 3,
      paybackMonths: 0,
      priority: "dusuk",
      category: "Operasyonel",
    });

    let filtered = suggestions;
    if (focus === "seu" && seuItems.length > 0) {
      filtered = suggestions.filter(s => ["Aydınlatma", "Kompresör", "İklimlendirme"].includes(s.category));
    } else if (focus === "co2") {
      filtered = suggestions.filter(s => ["Yenilenebilir Enerji", "Isı Yönetimi"].includes(s.category));
    } else if (focus === "maliyet") {
      filtered = suggestions.filter(s => ["Operasyonel", "Enerji Yönetimi", "Kompresör"].includes(s.category));
    }

    res.json({ suggestions: filtered.slice(0, 6) });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
