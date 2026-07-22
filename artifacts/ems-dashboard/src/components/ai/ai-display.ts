import type { AiAnalysisType } from "@workspace/api-zod";

export const ANALYSIS_TYPE_OPTIONS: Array<{ value: AiAnalysisType; label: string; description: string }> = [
  {
    value: "energy_performance_overview",
    label: "Genel enerji performansi",
    description: "Tuketim, performans gostergeleri, hedefler ve enerji gozden gecirme kayitlarini birlikte degerlendirir.",
  },
  {
    value: "equipment_improvement_opportunities",
    label: "Ekipman iyilestirme firsatlari",
    description: "Ekipman envanteri, teknik profil ve izleme iliskilerinden iyilestirme alanlarini cikarir.",
  },
  {
    value: "data_quality_and_monitoring",
    label: "Veri kalitesi ve izleme",
    description: "Eksik, kismi veya izleme icin zayif veri alanlarini ve takip onerilerini listeler.",
  },
];

export const POLICY_LABELS: Record<string, { label: string; description: string }> = {
  disabled: {
    label: "AI analizleri kapali",
    description: "AI analizleri bu firma icin kapali.",
  },
  synthetic_only: {
    label: "Yalniz sentetik veri",
    description: "AI yalniz demo veya sentetik verilerle kullanilabilir. Gercek musteri verisinin dis servise gonderilmesine izin verilmez.",
  },
  production_allowed: {
    label: "Firma verisiyle kullanilabilir",
    description: "AI analizi firma verilerinin yapilandirilmis ve minimize edilmis bolumuyle kullanilabilir.",
  },
};

export const STATUS_LABELS: Record<string, string> = {
  pending: "Bekliyor",
  processing: "Isleniyor",
  completed: "Tamamlandi",
  failed: "Basarisiz",
};

export const PRIORITY_LABELS: Record<string, string> = {
  critical: "Kritik",
  high: "Yuksek",
  medium: "Orta",
  low: "Dusuk",
};

export const PRIORITY_CLASSES: Record<string, string> = {
  critical: "border-red-500/30 text-red-400 bg-red-500/10",
  high: "border-orange-500/30 text-orange-400 bg-orange-500/10",
  medium: "border-amber-500/30 text-amber-400 bg-amber-500/10",
  low: "border-teal-500/30 text-teal-400 bg-teal-500/10",
};

export const CONFIDENCE_LABELS: Record<string, string> = {
  high: "Yuksek guven",
  medium: "Orta guven",
  low: "Dusuk guven",
};

export const RESULT_SUFFICIENCY_LABELS: Record<string, string> = {
  sufficient: "Yeterli",
  partial: "Kismi",
  insufficient: "Yetersiz",
};

export const META_SUFFICIENCY_LABELS: Record<string, string> = {
  complete: "Tam",
  sufficient: "Tam",
  partial: "Kismi",
  insufficient: "Yetersiz",
  unavailable: "Kullanilamiyor",
};

export const IMPACT_TYPE_LABELS: Record<string, string> = {
  verified_calculation: "EnYS dogrulanmis hesabi",
  backend_scenario: "Senaryo hesabi",
  qualitative_estimate: "Nitel potansiyel",
  not_estimated: "Etki hesaplanmadi",
};

export const MODULE_ROUTES: Record<string, { label: string; href: string }> = {
  energy_review: { label: "Enerji gozden gecirme", href: "/enerji-gozden-gecirme" },
  equipment_inventory: { label: "Ekipman envanteri", href: "/equipment" },
  technical_profile: { label: "Teknik profil", href: "/birimler" },
  action_plan: { label: "Hedefler ve aksiyonlar", href: "/hedefler" },
  monitoring: { label: "Sayaclar ve izleme", href: "/sayaclar" },
};

export function analysisTypeLabel(value: string) {
  return ANALYSIS_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? "Bilinmeyen analiz";
}

export function labelFrom(map: Record<string, string>, value: string | null | undefined, fallback = "Bilinmeyen") {
  return value ? map[value] ?? fallback : fallback;
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatPeriod(start: string | null | undefined, end: string | null | undefined) {
  if (!start && !end) return "-";
  if (start && end) return `${start} / ${end}`;
  return start ?? end ?? "-";
}

export function formatNumber(value: number | null | undefined, suffix = "") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(value)}${suffix}`;
}

export function safeErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Islem guvenli bicimde tamamlanamadi.";
}
