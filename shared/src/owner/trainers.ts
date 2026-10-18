// 厩舎・調教師（指示書 4章）。
// 調教師ごとに「調教を実行する腕」と「才能を見抜く目」を別々に持つ。
// 腕と目の数値は内部データで、馬主に見えるのは経歴・得意分野・預託料・評判だけ。
import type { Surface } from "../types";
import { isAbilityKey, type KnowledgeKey } from "./model";

export interface Trainer {
  id: string;
  name: string;
  /** 調教師としての経験（年） */
  experience: number;
  observationSkill: number;
  speedAssessment: number;
  staminaAssessment: number;
  temperamentAssessment: number;
  distanceAssessment: number;
  surfaceAssessment: number;
  trainingSkill: number;
  specialties: {
    surface?: Surface;
    distance?: "short" | "long";
    note: string;
  };
  /** 1頭あたりの預託料（週） */
  weeklyFee: number;
  /** 公開されている紹介文 */
  profile: string;
}

export const TRAINERS: readonly Trainer[] = [
  {
    id: "t1",
    name: "柏木 誠一",
    experience: 28,
    observationSkill: 80,
    speedAssessment: 72,
    staminaAssessment: 88,
    temperamentAssessment: 70,
    distanceAssessment: 86,
    surfaceAssessment: 62,
    trainingSkill: 84,
    specialties: { surface: "turf", distance: "long", note: "芝の中長距離" },
    weeklyFee: 18_000,
    profile: "開業28年の大ベテラン。じっくり乗り込んで長い距離に向く馬を育てるのが持ち味。",
  },
  {
    id: "t2",
    name: "早瀬 美咲",
    experience: 6,
    observationSkill: 84,
    speedAssessment: 90,
    staminaAssessment: 52,
    temperamentAssessment: 74,
    distanceAssessment: 50,
    surfaceAssessment: 68,
    trainingSkill: 68,
    specialties: { distance: "short", note: "短距離・スピード馬" },
    weeklyFee: 11_000,
    profile: "開業6年目の若手。スピードの素質を見抜く目には定評があるが、長い距離の経験は浅い。",
  },
  {
    id: "t3",
    name: "大門 剛",
    experience: 19,
    observationSkill: 50,
    speedAssessment: 52,
    staminaAssessment: 55,
    temperamentAssessment: 45,
    distanceAssessment: 48,
    surfaceAssessment: 58,
    trainingSkill: 90,
    specialties: { surface: "dirt", note: "ダート・強い調教" },
    weeklyFee: 15_000,
    profile: "ハードな調教で馬を鍛え上げる。評価のコメントはおおざっぱだと言われることもある。",
  },
  {
    id: "t4",
    name: "七尾 透",
    experience: 12,
    observationSkill: 74,
    speedAssessment: 70,
    staminaAssessment: 70,
    temperamentAssessment: 66,
    distanceAssessment: 76,
    surfaceAssessment: 88,
    trainingSkill: 72,
    specialties: { note: "芝・ダートの適性の見極め" },
    weeklyFee: 12_000,
    profile: "芝とダートの両方で結果を出してきた中堅。馬場への向き不向きの判断が的確だと評判。",
  },
  {
    id: "t5",
    name: "宮森 千鶴",
    experience: 24,
    observationSkill: 86,
    speedAssessment: 66,
    staminaAssessment: 70,
    temperamentAssessment: 92,
    distanceAssessment: 68,
    surfaceAssessment: 64,
    trainingSkill: 76,
    specialties: { note: "気性の難しい馬" },
    weeklyFee: 14_000,
    profile: "馬の気持ちをくみ取るのが上手く、癖のある馬を任されることが多い。",
  },
  {
    id: "t6",
    name: "新堂 隼人",
    experience: 3,
    observationSkill: 55,
    speedAssessment: 56,
    staminaAssessment: 50,
    temperamentAssessment: 52,
    distanceAssessment: 46,
    surfaceAssessment: 50,
    trainingSkill: 58,
    specialties: { note: "特になし（何でも挑戦中）" },
    weeklyFee: 7_000,
    profile: "開業3年目。預託料が安く、意欲的に色々な条件を試してくれる。",
  },
];

export function findTrainer(id: string): Trainer | undefined {
  return TRAINERS.find((t) => t.id === id);
}

/** その項目を評価するときに使う評価能力 */
export function assessmentFor(t: Trainer, key: KnowledgeKey): number {
  if (isAbilityKey(key)) {
    switch (key) {
      case "speed":
      case "acceleration":
        return t.speedAssessment;
      case "stamina":
        return t.staminaAssessment;
      case "power":
        return t.observationSkill;
      case "fightingSpirit":
      case "raceSense":
        return t.temperamentAssessment;
    }
  }
  if (key.startsWith("dist_")) return t.distanceAssessment;
  if (key.startsWith("surface_") || key === "going_heavy") return t.surfaceAssessment;
  if (key.startsWith("course_")) return (t.distanceAssessment + t.observationSkill) / 2;
  return t.observationSkill;
}

/** 観察精度の倍率（1が標準。小さいほど正確）。苦手な分野ほど不確実になる */
export function skillScale(t: Trainer, key: KnowledgeKey): number {
  const a = assessmentFor(t, key);
  const exp = Math.min(t.experience, 30);
  return Math.round((1.55 - a / 100) * (1.08 - exp / 150) * 1000) / 1000;
}

/** 調教の腕による育成効果の倍率（0.75〜1.05程度） */
export function trainingEfficiency(t: Trainer): number {
  return 0.5 + t.trainingSkill / 200 + Math.min(t.experience, 30) / 300;
}

/** 得意分野に合う馬か（公開情報で判断できる範囲） */
export function specialtyNote(t: Trainer): string {
  return t.specialties.note;
}
