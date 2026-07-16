import { Router } from "express";
import { db, companiesTable, consumptionTable, seuTable, metersTable, unitsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();
const FOCUS_VALUES = new Set(["genel", "seu", "co2", "maliyet"]);

class AiScopeError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function isCompanyAdmin(role: string) {
  return role === "admin" || role === "kontrol_admin";
}

function isSuperAdmin(role: string) {
  return role === "superadmin";
}

function parsePositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string") {
    const normalized = value.trim();
    if (/^[1-9]\d*$/.test(normalized)) {
      const parsed = Number(normalized);
      if (Number.isSafeInteger(parsed)) return parsed;
    }
  }
  throw new AiScopeError(400, `Geçersiz ${field}`);
}

function parseMatchingPositiveInteger(bodyValue: unknown, queryValue: unknown, field: string) {
  const bodyId = parsePositiveInteger(bodyValue, field);
  const queryId = parsePositiveInteger(queryValue, field);
  if (bodyId !== undefined && queryId !== undefined && bodyId !== queryId) {
    throw new AiScopeError(400, `Body ve query ${field} değerleri uyuşmuyor`);
  }
  return bodyId ?? queryId;
}

function parseYear(bodyValue: unknown, queryValue: unknown) {
  const year = parseMatchingPositiveInteger(bodyValue, queryValue, "year") ?? new Date().getFullYear();
  if (year < 1900 || year > 3000) throw new AiScopeError(400, "Geçersiz year");
  return year;
}

function parseFocus(value: unknown) {
  if (typeof value !== "string") throw new AiScopeError(400, "focus zorunludur");
  const focus = value.trim();
  if (!FOCUS_VALUES.has(focus)) throw new AiScopeError(400, "Geçersiz focus");
  return focus;
}

router.post("/ai/suggestions", requireAuth, async (req, res) => {
  try {
    const { year, focus: focusValue, unitId: bodyUnitId, companyId: bodyCompanyId } = req.body ?? {};
    const user = req.user!;
    const requestedCompanyId = parseMatchingPositiveInteger(bodyCompanyId, req.query.companyId, "companyId");
    const requestedUnitId = parseMatchingPositiveInteger(bodyUnitId, req.query.unitId, "unitId");
    const yr = parseYear(year, req.query.year);
    const focus = parseFocus(focusValue);
    const sessionCompanyId = parsePositiveInteger(user.companyId, "companyId");
    if (sessionCompanyId === undefined) throw new AiScopeError(400, "Geçersiz companyId");

    let effectiveCompanyId: number;
    if (isSuperAdmin(user.role)) {
      if (requestedCompanyId === undefined) throw new AiScopeError(400, "companyId zorunludur");
      effectiveCompanyId = requestedCompanyId;
    } else {
      effectiveCompanyId = sessionCompanyId;
      if (!isCompanyAdmin(user.role) && requestedCompanyId !== undefined && requestedCompanyId !== sessionCompanyId) {
        throw new AiScopeError(403, "Bu şirket için yetkiniz yok");
      }
    }

    const [company] = await db.select({ id: companiesTable.id })
      .from(companiesTable).where(eq(companiesTable.id, effectiveCompanyId)).limit(1);
    if (!company) throw new AiScopeError(404, "Şirket bulunamadı");

    let effectiveUnitId: number | undefined;
    if (isCompanyAdmin(user.role) || isSuperAdmin(user.role)) {
      effectiveUnitId = requestedUnitId;
    } else {
      const sessionUnitId = parsePositiveInteger(user.unitId, "unitId");
      if (sessionUnitId === undefined) throw new AiScopeError(403, "Birim kapsamı gereklidir.");
      if (requestedUnitId !== undefined && requestedUnitId !== sessionUnitId) {
        throw new AiScopeError(403, "Bu birim için yetkiniz yok");
      }
      effectiveUnitId = sessionUnitId;
    }

    if (effectiveUnitId !== undefined) {
      const [unit] = await db.select({ companyId: unitsTable.companyId })
        .from(unitsTable).where(eq(unitsTable.id, effectiveUnitId)).limit(1);
      if (!unit) throw new AiScopeError(404, "Birim bulunamadı");
      if (unit.companyId !== effectiveCompanyId) {
        throw new AiScopeError(403, "Bu birim için yetkiniz yok");
      }
    }

    const consumptionConditions = [
      eq(consumptionTable.year, yr),
      eq(consumptionTable.companyId, effectiveCompanyId),
      eq(metersTable.companyId, effectiveCompanyId),
    ];
    if (effectiveUnitId !== undefined) {
      consumptionConditions.push(eq(metersTable.unitId, effectiveUnitId));
    }

    const rows = await db.select({ id: consumptionTable.id, kwh: consumptionTable.kwh, year: consumptionTable.year, month: consumptionTable.month, hdd: consumptionTable.hdd, cdd: consumptionTable.cdd, meterId: consumptionTable.meterId, tep: consumptionTable.tep, co2: consumptionTable.co2, notes: consumptionTable.notes, createdAt: consumptionTable.createdAt })
      .from(consumptionTable)
      .innerJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
      .where(and(...consumptionConditions));

    const seuConditions = [eq(seuTable.companyId, effectiveCompanyId)];
    if (effectiveUnitId !== undefined) {
      seuConditions.push(eq(seuTable.unitId, effectiveUnitId));
    }
    const seuItems = await db.select().from(seuTable)
      .where(and(...seuConditions)).orderBy(seuTable.priority);

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
    if (err instanceof AiScopeError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
