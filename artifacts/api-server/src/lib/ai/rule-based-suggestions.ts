import type { TechnicalProfileAiContext } from "../unit-technical-profile-effective.js";

export type RuleBasedSuggestion = {
  title: string;
  description: string;
  potentialSavingKwh: number;
  potentialSavingPercent: number;
  paybackMonths: number;
  priority: "dusuk" | "orta" | "yuksek";
  category: string;
};

export type RuleBasedSeuItem = {
  category: string;
  annualKwh: number | null;
  priority?: number | null;
};

export const AI_SUGGESTION_FOCUS_VALUES = new Set(["genel", "seu", "co2", "maliyet"]);

export function aiReadinessFromTechnicalProfile(context: TechnicalProfileAiContext) {
  const ready = context.status === "resolved";
  return {
    status: context.status,
    ready,
    effectiveDate: context.effectiveDate,
    source: {
      type: context.source.type,
      snapshotId: context.source.snapshotId,
      snapshotNumber: context.source.snapshotNumber,
      profileVersion: context.source.profileVersion,
      validFrom: context.source.validFrom,
      validTo: context.source.validTo,
      publishedAt: context.source.publishedAt,
    },
    unit: context.unit,
    completeness: context.completeness,
    warnings: context.warnings,
    note: ready
      ? "Teknik profil AI baglamina hazir; bu pakette dis AI servisine gonderilmedi."
      : "Yayimlanmis teknik profil baglami hazir degil; bu pakette dis AI servisine gonderilmedi.",
  };
}

export function buildRuleBasedSuggestions({
  totalKwh,
  seuItems,
  focus,
}: {
  totalKwh: number;
  seuItems: RuleBasedSeuItem[];
  focus: string;
}): RuleBasedSuggestion[] {
  const suggestions: RuleBasedSuggestion[] = [];

  const lightingSeu = seuItems.find((s) => s.category === "aydinlatma");
  const lightingKwh = lightingSeu?.annualKwh ?? totalKwh * 0.15;
  suggestions.push({
    title: "LED Aydinlatmaya Gecis",
    description: `Tesisteki geleneksel aydinlatma sistemlerini LED teknolojisiyle degistirerek %60-70 enerji tasarrufu saglanabilir. Yillik tahmini tuketim ${Math.round(lightingKwh).toLocaleString("tr-TR")} kWh olan aydinlatma sisteminde bu donusum kritik oneme sahiptir.`,
    potentialSavingKwh: Math.round(lightingKwh * 0.6),
    potentialSavingPercent: Math.round((lightingKwh * 0.6 / (totalKwh || 1)) * 1000) / 10,
    paybackMonths: 15,
    priority: "yuksek",
    category: "Aydinlatma",
  });

  const compressorSeu = seuItems.find((s) => s.category === "kompresor");
  const compressorKwh = compressorSeu?.annualKwh ?? totalKwh * 0.12;
  suggestions.push({
    title: "Kompresor Sistem Optimizasyonu",
    description: "Basincli hava sistemlerinde tespit edilen kacaklarin giderilmesi ve basinc setpointinin optimize edilmesi ile %20-30 enerji tasarrufu mumkundur. Hava kacagi tespiti icin ultrasonik dedektor kullanilmasi onerilir.",
    potentialSavingKwh: Math.round(compressorKwh * 0.25),
    potentialSavingPercent: Math.round((compressorKwh * 0.25 / (totalKwh || 1)) * 1000) / 10,
    paybackMonths: 9,
    priority: "yuksek",
    category: "Kompresor",
  });

  const hvacSeu = seuItems.find((s) => s.category === "iklimlendirme");
  const hvacKwh = hvacSeu?.annualKwh ?? totalKwh * 0.25;
  suggestions.push({
    title: "HVAC Sistem Optimizasyonu ve BMS Entegrasyonu",
    description: "Bina yonetim sistemi entegrasyonu ile iklim kontrolu otomasyonu saglanarak %15-25 tasarruf elde edilebilir. Setpoint optimizasyonu ve bolgesel kontrol stratejileri uygulanmalidir.",
    potentialSavingKwh: Math.round(hvacKwh * 0.2),
    potentialSavingPercent: Math.round((hvacKwh * 0.2 / (totalKwh || 1)) * 1000) / 10,
    paybackMonths: 21,
    priority: "orta",
    category: "Iklimlendirme",
  });

  suggestions.push({
    title: "IE3/IE4 Yuksek Verimli Motor Degisimi",
    description: "Uretim hatlarindaki eski IE1 sinifi motorlarin IE3 veya IE4 sinifi yuksek verimli motorlarla degistirilmesi yillik %3-8 tasarruf saglar. Frekans invertoru eklenmesi bu tasarrufu %10-15 seviyesine cikarabilir.",
    potentialSavingKwh: Math.round(totalKwh * 0.06),
    potentialSavingPercent: 6,
    paybackMonths: 30,
    priority: "orta",
    category: "Motor Sistemleri",
  });

  suggestions.push({
    title: "Cati Gunes Enerji Sistemi (GES) Kurulumu",
    description: `Tesisin cati alanina kurulacak GES ile yillik ${Math.round(totalKwh * 0.15).toLocaleString("tr-TR")} kWh yenilenebilir enerji uretimi hedeflenebilir. CO2 emisyonunu onemli olcude azaltacaktir.`,
    potentialSavingKwh: Math.round(totalKwh * 0.15),
    potentialSavingPercent: 15,
    paybackMonths: 72,
    priority: "yuksek",
    category: "Yenilenebilir Enerji",
  });

  suggestions.push({
    title: "Termal Izolasyon Iyilestirmesi",
    description: "Uretim binasinin dis cephesi, cati ve boru hatlarindaki isi kayiplarinin termal kamera ile tespit edilmesi ve izolasyon iyilestirmesi yapilmasi.",
    potentialSavingKwh: Math.round(totalKwh * 0.08),
    potentialSavingPercent: 8,
    paybackMonths: 24,
    priority: "orta",
    category: "Isi Yonetimi",
  });

  suggestions.push({
    title: "Alt Sayac ve Enerji Yonetim Yazilimi Genisletmesi",
    description: "Mevcut olcum altyapisini genisleterek her uretim hatti ve kritik ekipman bazinda alt sayac kurulumu yapilmasi. Gercek zamanli veri izleme ile enerji verimsizlikleri aninda tespit edilebilir.",
    potentialSavingKwh: Math.round(totalKwh * 0.05),
    potentialSavingPercent: 5,
    paybackMonths: 9,
    priority: "yuksek",
    category: "Enerji Yonetimi",
  });

  suggestions.push({
    title: "Yuk Dengeleme ve Vardiya Optimizasyonu",
    description: "Enerji yogun ekipmanlarin kullaniminin dusuk tarife saatlerine kaydirilmasi ve tepe yuk yonetimi stratejilerinin uygulanmasi ile enerji maliyetleri %10-15 oraninda azaltilabilir.",
    potentialSavingKwh: Math.round(totalKwh * 0.03),
    potentialSavingPercent: 3,
    paybackMonths: 0,
    priority: "dusuk",
    category: "Operasyonel",
  });

  if (focus === "seu" && seuItems.length > 0) {
    return suggestions.filter((s) => ["Aydinlatma", "Kompresor", "Iklimlendirme"].includes(s.category));
  }
  if (focus === "co2") {
    return suggestions.filter((s) => ["Yenilenebilir Enerji", "Isi Yonetimi"].includes(s.category));
  }
  if (focus === "maliyet") {
    return suggestions.filter((s) => ["Operasyonel", "Enerji Yonetimi", "Kompresor"].includes(s.category));
  }
  return suggestions;
}
