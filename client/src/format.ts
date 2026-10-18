import { CONDITION_LABELS } from "@owners/shared";

export const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

export const conditionLabel = (c: number) => CONDITION_LABELS[String(c)] ?? "普通";

/** 馬番ごとのゼッケン色（本作独自の配色） */
export const GATE_COLORS: { bg: string; fg: string }[] = [
  { bg: "#F4F4EE", fg: "#14213D" }, // 1
  { bg: "#14213D", fg: "#F4F4EE" }, // 2
  { bg: "#B3203A", fg: "#FFFFFF" }, // 3
  { bg: "#1E5FA8", fg: "#FFFFFF" }, // 4
  { bg: "#E7B526", fg: "#14213D" }, // 5
  { bg: "#2E6B3F", fg: "#FFFFFF" }, // 6
  { bg: "#E2752B", fg: "#FFFFFF" }, // 7
  { bg: "#D86C9E", fg: "#FFFFFF" }, // 8
];

export const gateColor = (gate: number) => GATE_COLORS[(gate - 1) % GATE_COLORS.length];
