// レース番組（クラス）の定義。オフラインのCPU戦で使う。
// オンラインでも同じ形式でレースを増やせるよう、コース・頭数・賞金・出走条件をデータで持つ。
import { DEFAULT_COURSE } from "./economy";
import type { CourseDef, Horse } from "./types";

export interface RaceProgram {
  id: string;
  name: string;
  /** 一覧で並べる順（易しい順） */
  tier: number;
  course: CourseDef;
  fieldSize: number;
  entryFee: number;
  /** 賞金総額（着順ごとに PROGRAM_PRIZE_SHARES で配分） */
  purse: number;
  /** CPU馬の能力の範囲 */
  cpuStats: { min: number; max: number };
  /** 出走条件の説明 */
  conditionText: string;
  /** 出走条件。満たさなければ理由を返す */
  requirement: (h: Horse) => string | null;
}

/** 番組レースの賞金配分（5着まで）と、全頭に出る出走手当 */
export const PROGRAM_PRIZE_SHARES = [0.55, 0.22, 0.13, 0.06, 0.04];
export const PROGRAM_APPEARANCE_FEE = 2_000;

export const RACE_PROGRAMS: readonly RaceProgram[] = [
  {
    id: "maiden",
    name: "未勝利戦",
    tier: 1,
    course: DEFAULT_COURSE,
    fieldSize: 8,
    entryFee: 3_000,
    purse: 200_000,
    cpuStats: { min: 44, max: 58 },
    conditionText: "まだ勝っていない馬",
    requirement: (h) => (h.wins === 0 ? null : "勝ち上がった馬は出走できません"),
  },
  {
    id: "allowance",
    name: "一般戦",
    tier: 2,
    course: DEFAULT_COURSE,
    fieldSize: 8,
    entryFee: 5_000,
    purse: 360_000,
    cpuStats: { min: 50, max: 66 },
    conditionText: "どの馬でも出走できます",
    requirement: () => null,
  },
  {
    id: "special",
    name: "翠ヶ丘特別",
    tier: 3,
    course: DEFAULT_COURSE,
    fieldSize: 8,
    entryFee: 15_000,
    purse: 800_000,
    cpuStats: { min: 64, max: 82 },
    conditionText: "1勝以上",
    requirement: (h) => (h.wins >= 1 ? null : "1勝以上が必要です"),
  },
  {
    id: "stakes",
    name: "翠ヶ丘記念",
    tier: 4,
    course: DEFAULT_COURSE,
    fieldSize: 8,
    entryFee: 40_000,
    purse: 2_000_000,
    cpuStats: { min: 78, max: 96 },
    conditionText: "3勝以上",
    requirement: (h) => (h.wins >= 3 ? null : "3勝以上が必要です"),
  },
];

export function findProgram(id: string): RaceProgram | undefined {
  return RACE_PROGRAMS.find((p) => p.id === id);
}

/** 番組の着順別賞金（出走手当込み） */
export function programPrize(p: RaceProgram, position: number): number {
  const share = PROGRAM_PRIZE_SHARES[position - 1] ?? 0;
  return Math.round(p.purse * share) + PROGRAM_APPEARANCE_FEE;
}
