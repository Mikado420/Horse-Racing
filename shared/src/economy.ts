// ゲーム内経済の定数と計算。バランス調整はこのファイルに集約する。

import type { CourseDef } from "./types";

export const ECONOMY = {
  startingMoney: 300_000,
  /** 調教1回の費用 */
  trainingCost: 10_000,
  /** 休養の費用（無料） */
  restCost: 0,
  /** 出走時の経費（維持費として扱う） */
  entryFee: 5_000,
  /** 1頭あたりの賞金総額の加算分 */
  pursePerRunner: 150_000,
  /** 着順ごとの配分率 */
  prizeShares: [0.5, 0.2, 0.13, 0.08, 0.05, 0.02, 0.01, 0.01],
  /** 全出走馬に支払う出走手当 */
  appearanceFee: 5_000,
} as const;

export const MIN_RUNNERS = 2;
export const MAX_RUNNERS = 8;

/** MVPの競馬場（架空）。1種類・1距離。 */
export const DEFAULT_COURSE: CourseDef = {
  id: "midorigaoka-turf-1600",
  name: "翠ヶ丘競馬場",
  surface: "turf",
  distance: 1600,
  lapLength: 1600,
  straightLength: 320,
  trackWidth: 16,
};

export function purseFor(fieldSize: number): number {
  return ECONOMY.pursePerRunner * fieldSize;
}

/** 着順(1始まり)と頭数から賞金を返す（出走手当込み） */
export function prizeFor(position: number, fieldSize: number): number {
  const share = ECONOMY.prizeShares[position - 1] ?? 0;
  return Math.round(purseFor(fieldSize) * share) + ECONOMY.appearanceFee;
}
