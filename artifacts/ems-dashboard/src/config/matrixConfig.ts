export interface MatrixLevel {
  value: number;
  label: string;
}

export interface MatrixGrade {
  min: number;
  max: number;
  label: string;
  cellStyle: string;
}

export interface MatrixConfig {
  title: string;
  levels: MatrixLevel[];
  grades: MatrixGrade[];
}

export const MATRIX_LEVELS: MatrixLevel[] = [
  { value: 1, label: "Çok Düşük" },
  { value: 2, label: "Düşük" },
  { value: 3, label: "Orta" },
  { value: 4, label: "Yüksek" },
  { value: 5, label: "Çok Yüksek" },
];

export const riskMatrixConfig: MatrixConfig = {
  title: "Risk Değerlendirme Matrisi",
  levels: MATRIX_LEVELS,
  grades: [
    { min: 1,  max: 3,  label: "Önemsiz (1–3)",        cellStyle: "bg-green-900/30 border-green-700/40" },
    { min: 4,  max: 6,  label: "Katlanılabilir (4–6)",  cellStyle: "bg-green-500/20 border-green-500/35" },
    { min: 8,  max: 12, label: "Orta (8–12)",           cellStyle: "bg-yellow-500/20 border-yellow-500/35" },
    { min: 15, max: 20, label: "Önemli (15–20)",        cellStyle: "bg-orange-500/25 border-orange-500/40" },
    { min: 25, max: 25, label: "Katlanılamaz (25)",     cellStyle: "bg-red-700/30 border-red-600/50" },
  ],
};

export const opportunityMatrixConfig: MatrixConfig = {
  title: "Fırsat Değerlendirme Matrisi",
  levels: MATRIX_LEVELS,
  grades: [
    { min: 1,  max: 3,  label: "Önemsiz (1–3)",    cellStyle: "bg-red-700/20 border-red-600/40" },
    { min: 4,  max: 6,  label: "Düşük (4–6)",       cellStyle: "bg-orange-500/25 border-orange-500/40" },
    { min: 8,  max: 12, label: "Orta (8–12)",        cellStyle: "bg-yellow-500/20 border-yellow-500/35" },
    { min: 15, max: 20, label: "Yüksek (15–20)",     cellStyle: "bg-green-500/20 border-green-500/35" },
    { min: 25, max: 25, label: "Çok Yüksek (25)",    cellStyle: "bg-green-700/35 border-green-600/50" },
  ],
};
