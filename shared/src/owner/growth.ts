// 能力の成長（馬そのものの変化）。情報解明とは独立していて、knowledge には触れない。
import { WEEKS_PER_YEAR } from "./calendar";
import { ABILITY_KEYS, type Abilities, type AbilityKey, type GrowthType, type HorseTruth } from "./model";

/** 成長型ごとの成熟度（年齢 → 成長上限に対する割合） */
const MATURITY: Record<GrowthType, number[]> = {
  early: [0.45, 0.62, 0.82, 0.97, 1.0, 0.97, 0.9, 0.82, 0.75],
  normal: [0.42, 0.57, 0.74, 0.9, 1.0, 0.99, 0.93, 0.86, 0.78],
  late: [0.4, 0.52, 0.66, 0.82, 0.94, 1.0, 0.97, 0.9, 0.83],
};

export const GROWTH_TYPE_LABELS: Record<GrowthType, string> = { early: "早熟", normal: "普通", late: "晩成" };

/** 誕生からの週数 → 成熟度 */
export function maturity(type: GrowthType, weeksFromBirth: number): number {
  const y = Math.max(0, weeksFromBirth / WEEKS_PER_YEAR);
  const tbl = MATURITY[type];
  const i = Math.min(Math.floor(y), tbl.length - 2);
  const f = Math.min(1, y - i);
  return tbl[i] + (tbl[i + 1] - tbl[i]) * f;
}

/** 調教の積み重ねを加味した、その時点で到達しうる能力 */
export function growthTarget(potential: number, mat: number, development: number): number {
  return potential * mat * (0.86 + 0.14 * development);
}

/** 初期能力（生成時） */
export function initialAbilities(potential: Abilities, type: GrowthType, weeksFromBirth: number, development: number): Abilities {
  const out = {} as Abilities;
  const m = maturity(type, weeksFromBirth);
  for (const k of ABILITY_KEYS) out[k] = Math.round(growthTarget(potential[k], m, development) * 10) / 10;
  return out;
}

export interface GrowthInput {
  /** 今週の調教の質（能力ごと 0〜1。休養なら0） */
  quality: Partial<Record<AbilityKey, number>>;
  /** 実戦経験による賢さの伸び */
  raceExperience?: number;
}

/**
 * 1週分の成長。成熟度と調教の積み重ねで決まる到達点へ少しずつ近づく。
 * 若いうちは調教しなくても体の成長で伸び、ピークを過ぎると少しずつ衰える。
 */
export function applyWeeklyGrowth(t: HorseTruth, week: number, weeksFromBirth: number, input: GrowthInput): HorseTruth {
  const mat = maturity(t.growthType, weeksFromBirth);
  const abilities = { ...t.abilities };
  const development = { ...t.development };
  const log = [...t.growthLog];
  for (const k of ABILITY_KEYS) {
    const q = Math.max(0, Math.min(1, input.quality[k] ?? 0));
    development[k] = Math.round((development[k] * 0.965 + 0.035 * q) * 1000) / 1000;
    const target = growthTarget(t.potential[k], mat, development[k]);
    const cur = abilities[k];
    const rate = target > cur ? 0.07 : 0.03;
    let next = cur + (target - cur) * rate;
    if (k === "raceSense" && input.raceExperience) next += input.raceExperience;
    next = Math.max(1, Math.min(t.potential[k] + 2, next));
    abilities[k] = Math.round(next * 100) / 100;
  }
  // 4週ごとに、目に見える変化（1以上）を記録する
  if (week % 4 === 0) {
    const last = new Map<AbilityKey, number>();
    for (const e of log) last.set(e.key, e.to);
    for (const k of ABILITY_KEYS) {
      const from = last.get(k);
      const to = Math.round(abilities[k]);
      if (from === undefined) log.push({ week, key: k, from: Math.round(t.abilities[k]), to });
      else if (Math.abs(to - from) >= 1) log.push({ week, key: k, from, to });
    }
  }
  return { ...t, abilities, development, growthLog: log.slice(-150) };
}
