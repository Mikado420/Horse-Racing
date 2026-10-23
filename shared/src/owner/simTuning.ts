// レース計算（sim.ts）の調整用パラメータ。数値はすべてここに集め、テストや調整では
// withConfig({ race: { tuning: { ...DEFAULT_SIM_TUNING, ... } } }) で差し替えられる。
import type { RunningStyle } from "../types";
import type { PacePlan } from "./sim";

export interface SimTuning {
  /* ---------- 位置取り（第1段階） ---------- */
  /** 脚質ごとの序盤・中盤の目標位置（順位割合。0=先頭、1=最後方） */
  styleBands: Record<RunningStyle, [number, number]>;
  /** 終盤に目標位置を前へ移す割合（1 なら先頭まで） */
  lateBandShift: number;
  /** 仕掛け地点の何m手前から目標位置を前へ移し始めるか */
  lateShiftLead: number;
  /** 順位を連続値にするときの距離のなめらかさ（m） */
  softRankMeters: number;
  /** 少頭数で目標帯に入れる順位がなくならないよう、1順位ぶんの何割だけ帯を広げるか */
  bandWidenSteps: number;
  /** 位置のずれ（順位割合）を速度補正に変える尺度。小さいほど敏感 */
  posErrorScale: number;
  /** 位置取りによる速度補正の上限（最高速度に対する割合）。前へ／後ろへ、序盤／中盤 */
  posGain: { early: { up: number; down: number }; mid: { up: number; down: number } };
  /** 帯の中でも中央へ寄せる弱い補正（posGain に対する割合） */
  posCenterPull: number;
  /** 脚質適性が低いときの位置取りのぶれ（順位割合） */
  styleWobble: number;
  /** 脚質適性が位置取り補正の効きに与える幅（適性0で 1-この値 倍） */
  styleStability: number;
  /** 脚質適性が低いときの余計な消耗（適性0で 1+この値 倍） */
  styleWaste: number;
  /** 脚質適性が低いと行きたがりやすくなる幅 */
  styleKeen: number;

  /* ---------- 巡航速度 ---------- */
  /** 単独で走るときの巡航（最高速度に対する割合） */
  cruise: { early: number; mid: number };
  /** 序盤の巡航の脚質による違い（出走馬全体の速さに対する割合） */
  styleEarlyAdj: Record<RunningStyle, number>;
  /** 巡航のリズムに自分の最高速度をどれだけ反映するか（0=全馬共通の基準、1=自分の最高速度） */
  ownRhythm: number;
  /** ペース作戦による巡航の補正 */
  pacePlanAdj: Record<PacePlan, number>;
  /** 仕掛け前の目標速度の上限・下限（最高速度に対する割合） */
  cruiseMax: { early: number; mid: number };
  cruiseMin: number;
  /** 先頭から何m以内なら自分のリズム、それより後ろは流れ（ペース）に合わせる */
  leadBlendMeters: number;
  /** スタート直後は自分のリズムで出していき、この区間で流れに合わせ始める（m） */
  flowRamp: [number, number];
  /** 流れ（先頭の速度）を平滑化する時定数（秒） */
  paceTau: number;

  /* ---------- ペースと先頭争い（第2段階） ---------- */
  /** 脚質ごとの「先頭に立ちたい度合い」（ペース予測用） */
  leadDesire: Record<RunningStyle, number>;
  /** ペース作戦が先頭を取りに行く度合いに掛かる倍率 */
  pacePlanDesire: Record<PacePlan, number>;
  /** 最初のコーナーまでの距離（m）：この値以下なら「近い」、以上なら「遠い」 */
  cornerNear: number;
  cornerFar: number;
  /** 最初のコーナーが近いとき、大外枠が先手を取りにくくなる割合 */
  gateLeadPenalty: number;
  /** 予測ペース指数 = base + perContender × 先頭を争いそうな馬の数 */
  pacePredict: { base: number; perContender: number };
  /** 予測ペースが序盤の巡航に与える影響（逃げ馬／それ以外） */
  predictedLeadAdj: number;
  predictedFieldAdj: number;
  /** ペース指数の観測：先頭の速度が中盤の巡航からこの割合ずれると ±1 */
  paceObsScale: number;
  /** 序盤のペース指数の基準（先頭の速度が出走馬全体の速さのこの割合なら平均ペース） */
  paceRefEarly: number;
  /** ペース指数の平滑化の時定数（秒） */
  paceIndexTau: number;
  /** 先頭争いの激しさがペース指数に加わる量 */
  battlePace: number;
  /** 先頭争いとみなす範囲：先頭からの差（m）と、スタートからの距離（m） */
  battleRange: number;
  battleFrom: number;
  /** 先頭争いの激しさの時定数（秒） */
  battleTau: number;
  /** 先頭争い中の速度の上乗せ（出走馬全体の速さに対する割合）と、消耗の増加 */
  battleBoost: number;
  battleCost: number;
  /** 先頭争いから控える判断の起こりやすさ（1秒あたり）と、ペース作戦による倍率 */
  concedeRate: number;
  concedePlan: Record<PacePlan, number>;
  /** 控えた逃げ馬の目標位置 */
  concededBand: [number, number];
  /** 単騎逃げでペースを落とす量（巡航の割合）と、後ろとの差の目安（m） */
  soloRelax: number;
  soloGap: number;
  /** 逃げたくない馬が先頭に立ったときに落とす量（巡航の割合） */
  reluctantLeadSlow: number;
  /** ハイペースで、先頭から離れた馬が流れを追わなくなる度合いと、その距離（m） */
  paceDetach: number;
  detachFrom: [number, number];
  /** ハイペースでは位置を上げる補正を弱め、スローでは強める */
  paceChaseDamp: number;
  paceSlowPush: number;
  /** スローペースで後ろの馬の目標位置を前へ移す割合 */
  slowBandShift: number;
  /** ペースの表示：平均の指数がこの値以上でハイ、マイナスこの値以下でスロー */
  paceLabelAt: number;

  /* ---------- エネルギー ---------- */
  /** この速度で1mあたり1を消費する（m/秒） */
  costRef: number;
  /** 最高速度が高い馬ほど同じ速度を楽に走れる度合い（基準の最高速度との比のべき） */
  costEconomy: number;
  /** 序盤の区間（m）。D*earlyFraction と比べて短い方 */
  earlyMeters: number;
  earlyFraction: number;
}

export const DEFAULT_SIM_TUNING: SimTuning = {
  styleBands: { front: [0, 0.15], stalker: [0.1, 0.35], closer: [0.35, 0.7], deep: [0.65, 0.95] },
  lateBandShift: 0.6,
  lateShiftLead: 450,
  softRankMeters: 0.9,
  bandWidenSteps: 0.35,
  posErrorScale: 0.12,
  posGain: { early: { up: 0.035, down: 0.05 }, mid: { up: 0.018, down: 0.03 } },
  posCenterPull: 0.2,
  styleWobble: 0.08,
  styleStability: 0.35,
  styleWaste: 0.04,
  styleKeen: 0.6,

  cruise: { early: 0.95, mid: 0.915 },
  styleEarlyAdj: { front: 0.03, stalker: 0.008, closer: -0.012, deep: -0.028 },
  ownRhythm: 0.4,
  pacePlanAdj: { easy: -0.012, normal: 0, aggressive: 0.012 },
  cruiseMax: { early: 0.985, mid: 0.955 },
  cruiseMin: 0.86,
  leadBlendMeters: 4,
  flowRamp: [60, 260],
  paceTau: 2,

  leadDesire: { front: 1, stalker: 0.12, closer: 0, deep: 0 },
  pacePlanDesire: { easy: 0.7, normal: 1, aggressive: 1.25 },
  cornerNear: 100,
  cornerFar: 350,
  gateLeadPenalty: 0.4,
  pacePredict: { base: -0.75, perContender: 0.6 },
  predictedLeadAdj: 0.01,
  predictedFieldAdj: 0.004,
  paceObsScale: 0.015,
  paceRefEarly: 0.945,
  paceIndexTau: 6,
  battlePace: 0.6,
  battleRange: 3.6,
  battleFrom: 40,
  battleTau: 2,
  battleBoost: 0.02,
  battleCost: 0.12,
  concedeRate: 0.04,
  concedePlan: { easy: 1.6, normal: 1, aggressive: 0.4 },
  concededBand: [0.06, 0.3],
  soloRelax: 0.012,
  soloGap: 3.5,
  reluctantLeadSlow: 0.02,
  paceDetach: 0.6,
  detachFrom: [8, 30],
  paceChaseDamp: 0.5,
  paceSlowPush: 0.5,
  slowBandShift: 0.15,
  paceLabelAt: 0.3,

  costRef: 17.5,
  costEconomy: 1.0,
  earlyMeters: 600,
  earlyFraction: 0.3,
};
