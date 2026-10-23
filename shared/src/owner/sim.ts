// 馬主モードのレースシミュレーション（指示書 13・14章）。
// ・10Hz の離散時間計算。描画は記録したフレームを補間して行う
// ・目標速度へは加速力に応じて徐々に近づく。スタミナ（エネルギー）は速度の2乗に比例して減る
// ・コーナーの外を回る距離ロス、前が詰まる不利、進路を外へ出す移動時間を簡易に表現
// ・騎手AIはルールベース。参照するのは自馬の能力・作戦・周りの馬の位置・残り距離・残りスタミナだけ
// ・着順はシミュレーション上のゴール通過時刻（補間）で決める。同じ入力と乱数シードなら同じ結果
import { createRng, gaussian, type Rng } from "../rng";
import type { Going, RunningStyle } from "../types";
import { distanceFactor, fitMultiplier } from "./aptitude";
import { DEFAULT_CONFIG, type GameConfig } from "./config";
import type { SimTuning } from "./simTuning";
import { simulateOwnerRaceV21 } from "./simLegacy";
import { cornerRadius, isCorner, railPosition, SLOPE_REMAIN, type OwnerCourse } from "./courses";
import type { Abilities, TraitId, TrueAptitude } from "./model";

export type PacePlan = "easy" | "normal" | "aggressive";
export type SpurtPlan = "early" | "normal" | "late";

export interface Tactics {
  style: RunningStyle;
  pace: PacePlan;
  spurt: SpurtPlan;
}

export const PACE_LABELS: Record<PacePlan, string> = { easy: "控えめ", normal: "標準", aggressive: "積極的" };
export const SPURT_LABELS: Record<SpurtPlan, string> = { early: "早め", normal: "標準", late: "直線勝負" };

export interface SimRunner {
  id: string;
  gate: number;
  abilities: Abilities;
  aptitude: TrueAptitude;
  traits: readonly TraitId[];
  tactics: Tactics;
  condition: number;
  fatigue: number;
  fitness: number;
  experience: number;
}

export interface SimConditions {
  course: OwnerCourse;
  going: Going;
}

export interface RunnerTelemetry {
  id: string;
  /** スタートから200mごとの通過時刻（秒） */
  splits: number[];
  /** 上がり3ハロン（最後の600mのタイム） */
  last600: number;
  /** 通過順位（序盤・残り800m・残り400m・残り200m・ゴール） */
  positions: { label: string; remain: number; pos: number }[];
  /** 仕掛けた地点（ゴールまでの残り距離） */
  spurtRemain: number | null;
  /** 脚が上がった（エネルギーが尽きた）地点 */
  emptyRemain: number | null;
  /** 最後の600mの最高速度と、最後の200mの平均速度 */
  topSpeedLate: number;
  lastSegSpeed: number;
  /** 序盤〜中盤の巡航速度 */
  cruiseSpeed: number;
  /** 前が詰まっていた時間 */
  blockedSec: number;
  /** 外を回って余分に走った距離 */
  extraMeters: number;
  /** 騎手に逆らって行きたがった時間 */
  keenSec: number;
  /** 馬群の中にいた時間 */
  crowdedSec: number;
  /** 最後の300mで競り合いがあったか、その結果前に出たか */
  duel: { occurred: boolean; gained: boolean };
  /** 実際に走った位置取り（脚質） */
  styleShown: RunningStyle;
  /** スタートの出遅れ（秒） */
  startDelay: number;
  /** 先頭争いをしていた時間（秒）。再設計前の記録にはない */
  leadBattleSec?: number;
  /** 余力が減って速度を保てなくなり始めた地点（ゴールまでの残り距離）。再設計前の記録にはない */
  fadeRemain?: number | null;
  /** positions と同じ地点での残りエネルギーの割合（0〜1）。再設計前の記録にはない */
  reserve?: number[];
}

export type PaceLabel = "slow" | "average" | "high";
export const PACE_STATE_LABELS: Record<PaceLabel, string> = { slow: "スローペース", average: "平均ペース", high: "ハイペース" };

/** レース全体のペース。指数は -1（スロー）〜 +1（ハイ） */
export interface RacePace {
  /** レース前の予測（逃げ候補の数・個性・発馬・枠・最初のコーナーまでの距離・作戦から） */
  predicted: number;
  /** 先頭を争いそうな馬の数（予測） */
  contenders: number;
  /** 序盤・中盤の実際のペース指数 */
  early: number;
  mid: number;
  label: PaceLabel;
  /** 2頭以上で先頭を争っていた時間（秒） */
  battleSec: number;
}

/**
 * コーナーの中での曲がりの強さ（0〜1）。入口と出口の ease（m）の間で 0 から 1 へ滑らかに変わる
 * （実際のコースでも直線とコーナーの間は緩和曲線でつながっている）
 */
function cornerDepth(c: OwnerCourse, d: number, R: number, ease: number): number {
  if (ease <= 0) return 1;
  const s = railPosition(c, d);
  const turn = Math.PI * R;
  const S = c.straightLength;
  const inside = s < turn ? Math.min(s, turn - s) : Math.min(s - (turn + S), 2 * turn + S - s);
  return smoothstep(0, ease, Math.max(0, inside));
}

/** v21 の計算にはペースの判定がないため、記録の形だけを合わせる（平均ペース・争いなし） */
function legacyPace(): RacePace {
  return { predicted: 0, contenders: 0, early: 0, mid: 0, label: "average", battleSec: 0 };
}

export interface SimResultRow {
  id: string;
  gate: number;
  position: number;
  timeMs: number;
  marginLengths: number;
}

export interface SimResult {
  sampleDt: number;
  frames: number[][];
  lanes: number[][];
  results: SimResultRow[];
  durationSec: number;
  telemetry: Record<string, RunnerTelemetry>;
  /** 先頭の200mごとのラップ（秒） */
  leaderLaps: number[];
  /** レース全体のペース */
  pace: RacePace;
}

const GOING_INDEX: Record<Going, number> = { good: 0, yielding: 1, soft: 2, heavy: 3 };
export const HORSE_LENGTH = 2.4;
/** 能力60の馬の最高速度。エネルギー消費の「楽に走れる度合い」の基準 */
const TOP_REF = 16.6 + 0.034 * 60;

interface St {
  r: SimRunner;
  top: number;
  accel: number;
  energy: number;
  energy0: number;
  costMul: number;
  /** 有酸素で賄える消耗（1秒あたり）。スタミナが高いほど多い */
  aerobic: number;
  rs: number; // 実効の賢さ
  fs: number;
  /** 指示された脚質への適性（0〜1）。最高速度ではなく、位置取りの安定・折り合い・消耗に効く */
  styleFit: number;
  d: number;
  v: number;
  lane: number;
  targetLane: number;
  startDelay: number;
  phase: "early" | "mid" | "spurt";
  finish: number | null;
  tel: RunnerTelemetry;
  passTimes: number[]; // 200mごと
  checkpointTimes: Map<number, number>;
  checkpointReserve: Map<number, number>;
  keenNow: boolean;
  wantOut: boolean;
  /** 位置取りのぶれ（脚質適性が低いほど大きい） */
  wobble: number;
  cruiseSum: number;
  cruiseN: number;
  late200Start: number | null;
  late600Start: number | null;
  duelTicks: number;
  rankAtDuel: number | null;
  /** 先頭争いから引いた（2番手以下で控えると決めた） */
  conceded: boolean;
  /** 作戦・脚質・距離・加速力・騎手の判断のずれから決まる仕掛けの目安（ゴールまでの残り距離） */
  spurtBase: number;
  /** 残りの脚の見積もりのずれ（賢さが低いほど大きい） */
  judgeErr: number;
}

function has(r: SimRunner, t: TraitId) {
  return r.traits.includes(t);
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
/** a で0、b で1 になるなめらかな階段（a > b も可） */
function smoothstep(a: number, b: number, x: number): number {
  const u = clamp((x - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
}

/** 能力値の差を縮める中心の値（differenceScale） */
const ABILITY_REF = 60;
/**
 * 馬ごとの差を cfg.race.differenceScale 倍に縮める（着差の現実化、docs/margins）。
 * pts は能力値（60 を中心に）、sc は倍率（1 を中心に）に使う
 */
function scaler(cfg: GameConfig) {
  const k = cfg.race.differenceScale;
  return {
    pts: (x: number) => (k === 1 ? x : ABILITY_REF + k * (x - ABILITY_REF)),
    sc: (m: number) => (k === 1 ? m : 1 + k * (m - 1)),
  };
}

/**
 * その日の調子のぶれを除いた最高速度（m/秒）。能力・適性・状態・コース条件だけで決まり、
 * 脚質や作戦（ペース・仕掛け）では変わらない
 */
export function baseTopSpeed(r: SimRunner, cond: SimConditions, cfg: GameConfig = DEFAULT_CONFIG): number {
  const a = r.abilities;
  const apt = r.aptitude;
  const c = cond.course;
  const D = c.distance;
  const g = GOING_INDEX[cond.going];
  const distF = distanceFactor(apt, D, cfg);
  const under = D < apt.distanceMin;
  const over = D > apt.distanceMax;
  const de = cfg.distanceEffect;
  const rc = cfg.race;
  const { pts, sc } = scaler(cfg);
  const surfaceMul = fitMultiplier(c.surface === "turf" ? apt.turf : apt.dirt, rc.surfaceFit);
  // 馬場全体の重さと距離適性の補正は縮めない（馬ごとの差ではなく条件の差のため）
  const goingMul = 1 - g * 0.01 * (1 - pts(a.power) / 130) - (g > 0 ? 0.035 * (1 - apt.heavy / 100) * (g / 3) : 0);
  const dirMul = fitMultiplier(c.direction === "right" ? apt.right : apt.left, 0.02);
  const condMul = (1 + rc.conditionPerLevel * r.condition) * (1 - rc.fatiguePerPoint * r.fatigue) * (1 - rc.fitnessWeight + rc.fitnessWeight * (r.fitness / 100));
  const distSpeed = under ? 1 - de.shortSpeed * (1 - distF) : over ? 1 - de.longSpeed * (1 - distF) : 1;
  return (rc.topBase + rc.topPerSpeed * pts(a.speed)) * sc(surfaceMul) * goingMul * sc(dirMul) * sc(condMul) * distSpeed;
}

/** 1頭分の能力・適性・状態から、速度・加速・エネルギーの係数を作る */
function prepare(r: SimRunner, cond: SimConditions, rng: Rng, cfg: GameConfig, laneGap: number): St {
  const a = r.abilities;
  const apt = r.aptitude;
  const D = cond.course.distance;
  const g = GOING_INDEX[cond.going];
  const distF = distanceFactor(apt, D, cfg);
  const under = D < apt.distanceMin;
  const over = D > apt.distanceMax;
  const de = cfg.distanceEffect;
  const T = cfg.race.tuning;
  const rc = cfg.race;
  const { pts, sc } = scaler(cfg);

  const rs = Math.min(100, a.raceSense + Math.min(r.experience, 12) * 0.5);
  // その日の出来（最高速度とスタミナの両方に出る）
  const formSd = rc.formSd * (has(r, "inconsistent") ? 2.4 : 1) * (1.2 - rs / 200);
  const form = sc(1 + gaussian(rng) * formSd);
  const styleFit = clamp(apt.styles[r.tactics.style] / 100, 0, 1);
  const top = baseTopSpeed(r, cond, cfg) * form;
  const accel = (1.5 + 0.022 * pts(a.acceleration)) * (0.85 + 0.15 * (pts(a.power) / 100)) * (under ? 1 - de.shortAccel * (1 - distF) : 1);
  const energy =
    rc.energyScale * (700 + 27 * pts(a.stamina)) * (1 - 0.003 * r.fatigue) * (0.9 + 0.1 * (r.fitness / 100)) * (1 + (form - 1) * T.formEnergy);
  const costMul =
    (over ? 1 + de.longStamina * (1 - distF) : 1) *
    (1.05 - 0.07 * (rs / 100)) *
    (has(r, "calm") ? 0.97 : 1) *
    (1 + T.styleWaste * (1 - styleFit)) *
    (1 + 0.04 * g);
  const startDelay = rng() * 0.45 * (1.25 - rs / 140) * rc.startDelayScale;
  // 仕掛けの目安：作戦の基準に、脚質（後ろの馬ほど早めに動く）・距離・加速力（鈍いほど早め）を加え、
  // 作戦遂行の精度（賢さと脚質適性）に応じたずれを乗せる
  const style: RunningStyle = has(r, "frontObsessed") ? "front" : r.tactics.style;
  const exec = T.spurtExecSd * (1.3 - 0.5 * styleFit - rs / 200);
  const spurtBase =
    spurtPoint(cond.course, r.tactics.spurt) +
    T.spurtStyleAdj[style] +
    clamp((D - 1600) * T.spurtPerMeter, -T.spurtDistCap, T.spurtDistCap) +
    (60 - a.acceleration) * T.spurtPerAccel +
    gaussian(rng) * exec;
  const judgeErr = gaussian(rng) * T.spurtJudgeSd * (1 - rs / 100);

  return {
    r,
    top,
    accel,
    energy,
    energy0: energy,
    costMul,
    aerobic: rc.aerobicRate * Math.max(0, 1 + T.aerobicStamina * ((a.stamina - 60) / 100)),
    rs,
    fs: a.fightingSpirit,
    styleFit,
    d: 0,
    v: 0,
    lane: 0.8 + (r.gate - 1) * laneGap,
    targetLane: 0.8,
    startDelay,
    phase: "early",
    finish: null,
    passTimes: [],
    checkpointTimes: new Map(),
    checkpointReserve: new Map(),
    keenNow: false,
    wantOut: false,
    wobble: 0,
    cruiseSum: 0,
    cruiseN: 0,
    late200Start: null,
    late600Start: null,
    duelTicks: 0,
    rankAtDuel: null,
    conceded: false,
    spurtBase,
    judgeErr,
    tel: {
      id: r.id,
      splits: [],
      last600: 0,
      positions: [],
      spurtRemain: null,
      emptyRemain: null,
      topSpeedLate: 0,
      lastSegSpeed: 0,
      cruiseSpeed: 0,
      blockedSec: 0,
      extraMeters: 0,
      keenSec: 0,
      crowdedSec: 0,
      duel: { occurred: false, gained: false },
      styleShown: r.tactics.style,
      startDelay: Math.round(startDelay * 100) / 100,
      leadBattleSec: 0,
      fadeRemain: null,
    },
  };
}

/** 作戦から決まる仕掛け地点（ゴールまでの残り距離） */
export function spurtPoint(course: OwnerCourse, plan: SpurtPlan): number {
  const s = course.straightLength;
  if (plan === "early") return s + 320;
  if (plan === "late") return Math.max(200, s - 40);
  return s + 140;
}

/** 脚質の目標位置の帯（順位割合）。終盤ほど前へ移る。少頭数では1順位ぶんの幅を確保する */
export function styleBand(style: RunningStyle, n: number, lateShift: number, T: SimTuning): [number, number] {
  const [lo0, hi0] = T.styleBands[style];
  const k = 1 - T.lateBandShift * clamp(lateShift, 0, 1);
  const w = n > 1 ? T.bandWidenSteps / (n - 1) : 0;
  return [lo0 * k - w, hi0 * k + w];
}

/**
 * 位置のずれから目標速度への補正（最高速度に対する割合）。
 * 帯の外では tanh で連続的に強まり、上限・下限がある。帯の中では中央へ弱く寄せるだけ
 */
export function positionCorrection(p: number, band: [number, number], gain: { up: number; down: number }, T: SimTuning): number {
  const [lo, hi] = band;
  const sc = T.posErrorScale;
  let corr = 0;
  if (p > hi) corr = gain.up * Math.tanh((p - hi) / sc);
  else if (p < lo) corr = gain.down * Math.tanh((p - lo) / sc);
  const mid = (lo + hi) / 2;
  const half = Math.max(0.01, (hi - lo) / 2);
  corr += T.posCenterPull * gain.up * Math.tanh((p - mid) / (half + sc));
  return corr;
}

/**
 * 通過順位から、実際に見せた位置取り（脚質）を判定する。序盤（重み0.45）・残り800m（0.4）・残り400m（0.15）の
 * 位置の加重平均で決め、序盤だけ前にいて中盤に下がった馬や、早めに進出した馬も実際の走りに近く分類する
 */
export function styleFromPositions(positions: readonly { remain: number; pos: number }[], n: number, distance: number): RunningStyle {
  const at = (remain: number) => positions.find((p) => p.remain === remain)?.pos;
  const parts: [number | undefined, number][] = [
    [at(distance - 400), 0.45],
    [at(800), 0.4],
    [at(400), 0.15],
  ];
  let sum = 0;
  let w = 0;
  for (const [pos, wt] of parts) if (pos !== undefined) {
    sum += (n > 1 ? (pos - 1) / (n - 1) : 0) * wt;
    w += wt;
  }
  const f = w > 0 ? sum / w : 0;
  return f <= 0.14 ? "front" : f <= 0.42 ? "stalker" : f <= 0.72 ? "closer" : "deep";
}

/** スタートから最初のコーナーまでの距離（m） */
export function firstCornerDistance(c: OwnerCourse): number {
  for (let d = 0; d < c.distance; d += 5) if (isCorner(c, d)) return d;
  return c.distance;
}

/**
 * レース前のペース予測。逃げたい馬の数と、その馬たちが先手を取れそうか（加速力・賢さ・パワー）、
 * 枠順と最初のコーナーまでの距離、ペースの作戦から、先頭争いの起こりやすさを見積もる。
 * あくまで初期値で、レース中の実際の動きで更新される
 */
export function predictPace(runners: readonly SimRunner[], course: OwnerCourse, T: SimTuning = DEFAULT_CONFIG.race.tuning): { contenders: number; index: number } {
  const n = runners.length;
  if (n === 0) return { contenders: 0, index: 0 };
  const dash = (r: SimRunner) => r.abilities.acceleration + 0.5 * r.abilities.power + 0.3 * r.abilities.raceSense;
  const mean = runners.reduce((a, r) => a + dash(r), 0) / n;
  // 最初のコーナーが近いほど、外枠からは先手を取りにくい
  const close = smoothstep(T.cornerFar, T.cornerNear, firstCornerDistance(course));
  let contenders = 0;
  for (const r of runners) {
    const style: RunningStyle = r.traits.includes("frontObsessed") ? "front" : r.tactics.style;
    let desire = T.leadDesire[style];
    if (r.traits.includes("frontObsessed")) desire = Math.max(desire, 1);
    desire *= T.pacePlanDesire[r.tactics.pace];
    const quick = 1 / (1 + Math.exp(-(dash(r) - mean) / 12));
    const gateF = 1 - T.gateLeadPenalty * close * (n > 1 ? (r.gate - 1) / (n - 1) : 0);
    contenders += clamp(desire, 0, 1.3) * (0.4 + 1.2 * quick) * gateF;
  }
  return { contenders, index: clamp(T.pacePredict.base + T.pacePredict.perContender * contenders, -1, 1) };
}

export function simulateOwnerRace(
  runners: SimRunner[],
  cond: SimConditions,
  seed: number,
  cfg: GameConfig = DEFAULT_CONFIG,
): SimResult {
  if (runners.length < 1) throw new Error("出走馬がいません");
  if (cfg.race.engine === "v21") {
    // v2.1 の計算（比較・過去の再現用）。ペースの判定は v3 の仕組みなので、記録の形だけ合わせる
    return { ...simulateOwnerRaceV21(runners, cond, seed, cfg), pace: legacyPace() };
  }
  const T = cfg.race.tuning;
  const rc = cfg.race;
  const rng = createRng(seed);
  const c = cond.course;
  const D = c.distance;
  const R = cornerRadius(c);
  const dt = 1 / cfg.race.hz;
  const sampleEvery = Math.max(1, Math.round(cfg.race.sampleDt / dt));
  const sorted = [...runners].sort((a, b) => a.gate - b.gate);
  const n = sorted.length;
  // 多頭数でもゲートがコース幅に収まるように間隔を詰める
  const laneGap = n > 1 ? Math.min(1.25, (c.trackWidth - 1.6) / (n - 1)) : 1.25;
  const S: St[] = sorted.map((r) => prepare(r, cond, rng, cfg, laneGap));
  const checkpoints = [D - 400, 800, 400, 200, 0].filter((x, i, arr) => x >= 0 && arr.indexOf(x) === i && x < D);
  const cpLabels = new Map<number, string>([[D - 400, "序盤"], [800, "残り800m"], [400, "残り400m"], [200, "残り200m"], [0, "ゴール"]]);
  const spurtFrom = S.map((st) => st.spurtBase);
  const earlyEnd = Math.min(T.earlyMeters, D * T.earlyFraction);
  const paceK = 1 - Math.exp(-dt / T.paceTau);

  const frames: number[][] = [S.map(() => 0)];
  const lanes: number[][] = [S.map((st) => Math.round(st.lane * 10) / 10)];
  const maxSteps = Math.round(400 / dt);
  let step = 0;
  let allDoneAt: number | null = null;
  /** レースの流れ（先頭の速度を平滑化したもの） */
  let paceV = 0;
  // 距離に応じた道中の運び：長い距離ほどゆったり、短い距離ほど速く（1600m を基準に 1000m あたり cruisePerKm）。
  // ペース指数の基準も同じだけずらすので、距離が違っても「平均的な流れ」の判定は変わらない
  const distCruise = 1 - rc.cruisePerKm * ((D - 1600) / 1000);
  // ペース：レース前の予測を初期値にし、先頭の実際の速度と先頭争いで更新する
  const predicted = predictPace(sorted, c, T);
  let paceIdx = predicted.index;
  const paceIdxK = 1 - Math.exp(-dt / T.paceIndexTau);
  let battle = 0;
  const battleK = 1 - Math.exp(-dt / T.battleTau);
  let battleSec = 0;
  const paceAcc = { early: 0, earlyN: 0, mid: 0, midN: 0 };
  const contending = new Array<boolean>(n).fill(false);

  const nextD = new Array<number>(n);
  const nextV = new Array<number>(n);
  const nextLane = new Array<number>(n);
  const softPos = new Array<number>(n);
  const rankOf = new Array<number>(n);
  const bands = new Array<[number, number]>(n);
  /** 出走馬の最高速度の平均。道中の巡航・位置取りの補正はこの値を基準にする */
  const fieldTop = S.reduce((a, st) => a + st.top, 0) / n;

  while (step < maxSteps) {
    step++;
    const t = step * dt;
    // ---- 1. 全馬の現在の状態を読み取る（この刻みの計算はすべてこの値だけを見る） ----
    const d0 = S.map((st) => st.d);
    const v0 = S.map((st) => st.v);
    const l0 = S.map((st) => st.lane);
    const done0 = S.map((st) => st.finish !== null);

    // ---- 2. 位置・順位・馬群を評価する ----
    const order = S.map((_, i) => i).sort((x, y) => d0[y] - d0[x] || x - y);
    order.forEach((idx, rank) => (rankOf[idx] = rank));
    for (let i = 0; i < n; i++) {
      // 連続値の順位割合：前にいる馬の数を距離差でなめらかに数える（1頭抜いただけで段差が出ない）
      let ahead = 0;
      for (let j = 0; j < n; j++) if (j !== i) ahead += 1 / (1 + Math.exp(-(d0[j] - d0[i]) / T.softRankMeters));
      softPos[i] = n > 1 ? ahead / (n - 1) : 0;
    }
    let lead = -1;
    for (const idx of order) if (!done0[idx]) { lead = idx; break; }
    const leaderD = lead >= 0 ? d0[lead] : D;

    // 脚質の目標帯と、先頭の馬が目標よりどれだけ前にいるか
    for (let i = 0; i < n; i++) {
      const st = S[i];
      const style: RunningStyle = has(st.r, "frontObsessed") ? "front" : st.r.tactics.style;
      bands[i] = styleBand(style, n, smoothstep(spurtFrom[i] + T.lateShiftLead, spurtFrom[i], D - d0[i]), T);
    }
    const leadErr = lead >= 0 ? softPos[lead] - bands[lead][0] : 0;
    // 先頭争い：逃げたい馬（控えると決めた馬を除く）が先頭から一定の差の中に何頭いるか
    let contest = 0;
    for (let i = 0; i < n; i++) {
      const st = S[i];
      const style: RunningStyle = has(st.r, "frontObsessed") ? "front" : st.r.tactics.style;
      contending[i] =
        !done0[i] && st.phase !== "spurt" && !st.conceded && T.styleBands[style][0] <= 0.001 && d0[i] > T.battleFrom && leaderD - d0[i] < T.battleRange;
      if (contending[i]) contest++;
    }

    // ---- 3. レース全体のペースを更新する ----
    if (lead >= 0) paceV += (v0[lead] - paceV) * paceK;
    battle += ((contest >= 2 ? Math.min(1, (contest - 1) * 0.7) : 0) - battle) * battleK;
    if (battle > 0.3) battleSec += dt;
    if (leaderD > T.flowRamp[1]) {
      // 実際の流れ（出走馬全体の速さに対する先頭の速度）と先頭争いの激しさから、ペース指数をゆっくり動かす
      // コーナーではどの馬も速度を落とすので、その分を基準から差し引く
      const ref = (leaderD < earlyEnd ? T.paceRefEarly : T.paceRefMid) * (isCorner(c, leaderD) ? 1 - T.cornerSpeedK / R : 1) * distCruise;
      const obs = clamp((paceV / fieldTop - ref) / T.paceObsScale + T.battlePace * battle, -1.5, 1.5);
      paceIdx += (clamp(obs, -1, 1) - paceIdx) * paceIdxK;
      if (leaderD < earlyEnd + 200) {
        paceAcc.early += paceIdx;
        paceAcc.earlyN++;
      } else if (leaderD < D - 600) {
        paceAcc.mid += paceIdx;
        paceAcc.midN++;
      }
    }
    const fast = Math.max(0, paceIdx);
    const slow = Math.max(0, -paceIdx);

    // 1秒ごとの判断（行きたがる・進路・位置取りのぶれ）
    const decide = step % Math.round(1 / dt) === 1;

    // ---- 4・5. 各馬の目標・進路・加速・移動・消耗を計算する ----
    for (let i = 0; i < n; i++) {
      const st = S[i];
      nextD[i] = d0[i];
      nextV[i] = v0[i];
      nextLane[i] = l0[i];
      if (t < st.startDelay) continue;
      const r = st.r;
      const remain = D - d0[i];
      const done = done0[i];

      // 段階の切り替え
      if (!done) {
        if (st.phase === "early" && d0[i] >= earlyEnd) st.phase = "mid";
        if (st.phase !== "spurt") {
          // 目標位置より後ろにいるほど早めに動く
          const lag = Math.max(0, softPos[i] - bands[i][1]);
          const point = spurtFrom[i] + lag * T.spurtLagMeters;
          if (remain <= point + T.spurtSurplusLead) {
            // 残りのエネルギーで最後まで脚が持つか見極めてから仕掛ける（見積もりは騎手の判断でずれる）
            const effort = Math.pow(TOP_REF / st.top, T.costEconomy);
            const need =
              Math.max(0, remain * st.costMul * (effort * Math.pow(st.top / T.costRef, 2) * (1 + T.anaerobic * T.anaerobicNeed) - st.aerobic / st.top)) *
              (1 + st.judgeErr);
            const spare = st.energy - rc.fadeReserve * st.energy0 * T.spurtKeep;
            const go =
              remain <= T.spurtForce ||
              (remain <= point && spare >= need * T.spurtNeed[r.tactics.spurt]) ||
              spare >= need * T.spurtSurplus; // 手応えに余裕があれば少し早めに動く
            if (go) {
              st.phase = "spurt";
              st.tel.spurtRemain = Math.round(remain);
            }
          }
        }
      }

      // 周囲の状況
      let blockedBy = -1;
      let crowd = 0;
      let rival = false;
      let draft = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const gap = d0[j] - d0[i];
        const dl = Math.abs(l0[j] - l0[i]);
        // 前の馬の真後ろで流れに乗っていると楽に走れる
        if (gap > 0.5 && gap < T.draftRange[1] && dl < T.draftLane && !done0[j]) draft = Math.max(draft, 1 - smoothstep(T.draftRange[0], T.draftRange[1], gap));
        if (Math.abs(gap) < 3 && dl < 2.2) crowd++;
        if (gap > 0 && gap < 2.6 && dl < 1.25 && !done0[j]) {
          if (blockedBy < 0 || d0[j] < d0[blockedBy]) blockedBy = j;
        }
        if (!done && remain < 300 && !done0[j] && Math.abs(gap) < 1.6 && dl < 2.6) rival = true;
      }

      // 目標速度
      let target: number;
      if (done) target = st.top * 0.6;
      else if (st.phase === "spurt") {
        // 溜めた脚：残りの距離に対して余力が多いほど、仕掛けてからさらに伸びる（使い切れる分だけ）
        const effortS = Math.pow(TOP_REF / st.top, T.costEconomy);
        const needS = Math.max(1, Math.max(1, remain) * st.costMul * (effortS * Math.pow(st.top / T.costRef, 2) * (1 + T.anaerobic) - st.aerobic / st.top));
        const saved = clamp((st.energy - rc.fadeReserve * st.energy0 * T.spurtKeep) / needS - 1, 0, T.saveKickRange) / T.saveKickRange;
        target = st.top * ((has(r, "closerKick") ? 1.015 : 1.0) + T.saveKick * saved);
      } else {
        const ph = st.phase === "early" ? "early" : "mid";
        const style: RunningStyle = has(r, "frontObsessed") ? "front" : r.tactics.style;
        const wantsLead = T.styleBands[style][0] <= 0.001 && !st.conceded;
        const gapLead = leaderD - d0[i];
        // 自分のリズムで走るときの巡航。出走馬全体の速さを基準にし、自分の最高速度は一部だけ反映する
        // （能力の高い馬ほど同じ流れを楽に走れるが、脚質に関係なく前へ飛ばしていくわけではない）
        const own = fieldTop + (st.top - fieldTop) * T.ownRhythm;
        let rhythm = T.cruise[ph] + T.pacePlanAdj[r.tactics.pace] + (has(r, "frontObsessed") ? 0.008 : 0);
        // 単騎で楽に先頭か：後ろとの差（競りかける馬がいなければ、騎手はペースを落とせる）
        let soloFree = 0;
        if (lead === i && contest < 2) {
          let nearest = Infinity;
          for (let j = 0; j < n; j++) if (j !== i) nearest = Math.min(nearest, d0[i] - d0[j]);
          soloFree = smoothstep(T.soloGap * 0.3, T.soloGap, nearest) * smoothstep(T.flowRamp[0], T.flowRamp[1], d0[i]);
        }
        if (ph === "early") {
          // 序盤の脚質による出し方の違い。先頭を確保した逃げ馬はそれ以上出していかない
          rhythm += T.styleEarlyAdj[style] * (wantsLead ? 1 - soloFree : 1);
          // 先頭争いが予想されるときは逃げ馬が序盤から出していき、少なければ落ち着いて入る
          rhythm += (wantsLead ? T.predictedLeadAdj : T.predictedFieldAdj) * predicted.index;
        }
        if (lead === i) {
          if (wantsLead) rhythm -= T.soloRelax * (0.5 + st.rs / 200) * soloFree;
          else rhythm -= T.reluctantLeadSlow * smoothstep(T.flowRamp[0], T.flowRamp[1], d0[i]);
        }
        const comfort = own * rhythm * distCruise;
        // 先頭の馬が逃げたくて逃げているか（目標帯より大きく前にいるなら、仕方なく先頭にいるだけ）
        const leaderReluctant = lead >= 0 && lead !== i && leadErr < -0.1;
        const battling = contending[i] && contest >= 2;
        // 先頭から離れるほど、流れ（ペース）に合わせて走る。速い馬でも後方では流れ以上に飛ばさない。
        // ハイペースでは、先頭集団から離れた馬は無理に追いかけず自分のリズムに戻す
        // 逃げたい馬は先頭近くでは自分のリズム、それ以外の馬は先頭の後ろでは流れに乗る
        const near = lead === i ? 0 : wantsLead ? smoothstep(0, T.leadBlendMeters, gapLead) : 1;
        let follow = battling || (wantsLead && leaderReluctant) ? 0 : smoothstep(T.flowRamp[0], T.flowRamp[1], d0[i]) * near;
        follow *= 1 - T.paceDetach * fast * smoothstep(T.detachFrom[0], T.detachFrom[1], gapLead);
        const base = comfort + (paceV - comfort) * follow;
        // 脚質に応じた目標位置との差から補正する。スローペースでは後ろの馬も早めに位置を上げる
        let band = bands[i];
        if (st.conceded) band = T.concededBand;
        else if (!wantsLead) band = [band[0] * (1 - T.slowBandShift * slow), band[1] * (1 - T.slowBandShift * slow)];
        if (decide) {
          // 脚質適性が低いほど位置取りが安定しない（ゆっくり動くぶれ）
          const amp = T.styleWobble * (1 - st.styleFit);
          st.wobble = clamp(st.wobble * 0.8 + gaussian(rng) * amp * 0.5, -amp, amp);
        }
        const g0 = T.posGain[ph];
        const gain = { up: g0.up * (1 - T.paceChaseDamp * fast + T.paceSlowPush * slow), down: g0.down };
        let corr = positionCorrection(softPos[i] + st.wobble, band, gain, T) * (1 - T.styleStability * (1 - st.styleFit));
        if (wantsLead && leaderReluctant) corr = Math.max(corr, gain.up);
        if (battling) {
          // 先頭争い：互いに譲らず速度が上がり、そのぶん消耗する
          corr = Math.max(corr, gain.up) + T.battleBoost * battle;
          st.tel.leadBattleSec! += dt;
          // 2番手以下の馬は、賢さや作戦に応じて控える判断をする
          if (decide && lead !== i) {
            const plan = T.concedePlan[r.tactics.pace];
            const tired = st.energy < st.energy0 * 0.75 ? 2 : 1;
            const p = T.concedeRate * (0.3 + st.rs / 100) * plan * tired * (has(r, "frontObsessed") ? 0.15 : 1);
            if (rng() < p) st.conceded = true;
          }
        }
        // 行きたがる：騎手が抑えても前に行こうとして消耗する
        if (decide) {
          const base0 = has(r, "keen") ? 0.35 * (1.2 - st.rs / 120) : 0.01 * (1 - st.rs / 100);
          const chance = base0 * (1 + T.styleKeen * (1 - st.styleFit));
          st.keenNow = r.tactics.style !== "front" && rng() < chance;
        }
        if (st.keenNow) {
          corr = Math.max(corr * 0.3, 0) + 0.02;
          st.tel.keenSec += dt;
        }
        target = clamp(base + corr * fieldTop, st.top * T.cruiseMin, st.top * T.cruiseMax[ph]);
      }

      if (!done) {
        // コーナー：きついほど速度を落とす。パワー・回りの適性・小回り適性があれば保ちやすい
        if (isCorner(c, d0[i])) {
          const pw = r.abilities.power / 100;
          const dirFit = (c.direction === "right" ? r.aptitude.right : r.aptitude.left) / 100;
          const tightPen = c.tight ? 1 + T.tightCornerPenalty * (1 - r.aptitude.tight / 100) : 1;
          target *= 1 - (T.cornerSpeedK / R) * (1 - T.cornerPower * pw - T.cornerAptitude * dirFit) * tightPen;
        }
        // 坂
        if (c.slope && remain <= SLOPE_REMAIN[0] && remain >= SLOPE_REMAIN[1]) {
          target *= 1 - 0.03 * (1 - r.abilities.power / 120) * (1 - 0.5 * (r.aptitude.slope / 100));
        }
        // 競り合い：根性で伸びる
        if (rival) {
          target *= 1 + 0.00025 * st.fs + (has(r, "gutsy") ? 0.006 : 0);
          st.duelTicks++;
          if (st.rankAtDuel === null) st.rankAtDuel = rankOf[i];
        }
        // 馬群
        if (crowd >= 2) {
          st.tel.crowdedSec += dt;
          if (has(r, "hatesCrowd")) target *= 0.985;
        }
        // 余力の減少：残りが少なくなるほど速度を保てなくなる（急にではなく徐々に）。根性が粘りを支える
        const res = st.energy / st.energy0;
        if (res <= 0 && st.tel.emptyRemain === null) st.tel.emptyRemain = Math.round(remain);
        if (res < rc.fadeReserve) {
          const grit = st.fs / 100;
          const floor = rc.emptyFloor + T.fadeGrit * grit + (has(r, "gutsy") ? T.gutsyGrit : 0);
          const u = rc.fadeReserve > 0 ? clamp((res / rc.fadeReserve) * (1 + T.fadeResist * grit), 0, 1) : 0;
          const cap = st.top * (floor + (1 - floor) * Math.pow(u, T.fadeCurve));
          // 失速が始まった地点は、出したい速度にかかわらず「保てる速度」が下がった地点として記録する
          if (st.tel.fadeRemain === null && cap < st.top * T.fadeMark) st.tel.fadeRemain = Math.round(remain);
          if (cap < target) target = cap;
        }
        // 前が詰まる（前の馬より速く走りたいのに抜けない）
        st.wantOut = false;
        if (blockedBy >= 0 && d0[i] > 150 && target > v0[blockedBy] + 0.2) {
          // 少し速く走りたいだけなら後ろで流れに乗る。はっきり行きたいのに抜けないとき（前の馬が止まった・
          // 仕掛けたいのに前が遅い）が「前が詰まった」状態
          const stuck = target > v0[blockedBy] + T.blockedMargin;
          target = Math.min(target, v0[blockedBy] + 0.05);
          if (stuck) {
            st.tel.blockedSec += dt;
            st.wantOut = true;
          }
        }
      }

      // 進路取り：詰まったら外へ出す。そうでなければ序盤・中盤は内へ寄せる
      if (decide && !done) {
        // 前の遅い馬：詰まってから気づくのではなく、賢い馬ほど早めに気づいて進路を考える
        let slow = st.wantOut ? blockedBy : -1;
        if (slow < 0 && d0[i] > 150 && (st.phase === "spurt" || remain < spurtFrom[i] + T.preSpurtLead)) {
          const look = 2.6 + T.lookAhead * (st.rs / 100);
          for (let j = 0; j < n; j++) {
            const gap = d0[j] - d0[i];
            if (j !== i && !done0[j] && gap > 0 && gap < look && Math.abs(l0[j] - l0[i]) < 1.25 && v0[j] < target - T.blockedMargin && (slow < 0 || d0[j] < d0[slow])) slow = j;
          }
        }
        // 進路が開いているか：賢い馬ほど狭い隙間も見逃さない（必要な前後の余裕が小さい）
        const room = T.gapRoom - T.gapRoomWise * (st.rs / 100);
        const free = (lane: number) => {
          for (let j = 0; j < n; j++) if (j !== i && j !== slow && Math.abs(l0[j] - lane) < 1.2 && Math.abs(d0[j] - d0[i]) < room) return false;
          return true;
        };
        // 仕掛けの前の進路確保：賢い馬は動き出す前に、前が開いている外へ持ち出しておく
        // （コーナーで大きく外へ出すと距離を損するので、コーナーでは1頭分だけ）
        if (slow < 0 && st.phase === "mid" && remain < spurtFrom[i] + T.preSpurtLead && rng() < T.preSpurtMove * (st.rs / 100)) {
          const clearAhead = (lane: number) => {
            for (let j = 0; j < n; j++) {
              const gap = d0[j] - d0[i];
              if (j !== i && !done0[j] && gap > 0 && gap < 10 && Math.abs(l0[j] - lane) < 1.25) return false;
            }
            return true;
          };
          // 前に馬がいれば、すぐ外から順に「並ばれておらず前も開いている」進路を探す（外へ行くほど距離を損する）
          if (!clearAhead(l0[i])) {
            for (let k = 1; k <= (isCorner(c, d0[i]) ? 1 : 3); k++) {
              const lane2 = l0[i] + 1.6 * k;
              if (lane2 > c.trackWidth - 1) break;
              if (free(lane2) && clearAhead(lane2)) {
                st.targetLane = lane2;
                break;
              }
            }
          }
        }
        if (slow >= 0) {
          // 進路の候補：すぐ外・その馬の内・さらに外。開いているか、どれだけ距離を損するかで選ぶ
          const late = remain < c.straightLength + 100;
          const cornerNow = isCorner(c, d0[i]);
          const out1 = Math.min(c.trackWidth - 1, l0[slow] + 1.6);
          const in1 = l0[slow] - 1.6;
          let choice: number | null = null;
          if (in1 >= 0.6 && free(in1) && rng() < 0.25 + st.rs / 200) choice = in1;
          else if (free(out1)) choice = out1;
          else if (late || st.phase === "spurt" || st.tel.blockedSec > 4) {
            // 外が塞がっている：さらに外を回るか、開くのを待つか
            let far = out1;
            for (let j = 0; j < n; j++) if (j !== i && Math.abs(d0[j] - d0[i]) < 3.5 && l0[j] >= out1 - 1.2) far = Math.max(far, l0[j] + 1.6);
            far = Math.min(c.trackWidth - 1, far);
            if (far > out1 && free(far) && rng() < (late ? 0.6 : 0.3) * (1 - 0.4 * (st.rs / 100) * (cornerNow ? 1 : 0))) choice = far;
          }
          // コーナーでの外への持ち出しは損が大きいので、賢い馬は直線まで待つことがある
          // （実際に詰まっているときは待たない）
          if (choice !== null && !st.wantOut && choice > l0[i] && cornerNow && !late && rng() < T.waitInCorner * (st.rs / 100)) choice = null;
          // 反応の早さ：賢いほど迷わず進路を選ぶ。早めに気づいた段階では賢い馬だけが動く
          const react = st.wantOut ? 0.45 + 0.55 * (st.rs / 100) : (st.rs / 100) * 0.8;
          if (choice !== null && rng() < react) st.targetLane = choice;
        } else if (st.phase === "early" || st.phase === "mid") {
          const inside = Math.max(0.6, l0[i] - 1.2);
          let occupied = false;
          for (let j = 0; j < n; j++) if (j !== i && Math.abs(l0[j] - inside) < 1.1 && Math.abs(d0[j] - d0[i]) < 3.2) occupied = true;
          // 内へ寄せる先に遅い馬がいれば、賢い馬は入らない（詰まる位置を避ける）
          let pocket = false;
          for (let j = 0; j < n; j++) if (j !== i && Math.abs(l0[j] - inside) < 1.2 && d0[j] > d0[i] && d0[j] - d0[i] < 8 && v0[j] < v0[i] - 0.2) pocket = true;
          if (!occupied && !(pocket && rng() < st.rs / 100) && rng() < 0.4 + st.rs / 250) st.targetLane = inside;
        }
      }
      const laneStep = 0.8 * dt;
      let lane = l0[i];
      if (Math.abs(st.targetLane - lane) <= laneStep) lane = st.targetLane;
      else lane += Math.sign(st.targetLane - lane) * laneStep;

      // 速度の更新（加速力に応じて徐々に）
      let v = v0[i];
      const boost = (v < 10 ? 1.6 : 1) * (st.phase === "spurt" && has(r, "closerKick") ? 1.15 : 1);
      if (v < target) v = Math.min(target, v + st.accel * dt * boost);
      else v = Math.max(target, v - (st.energy < st.energy0 * rc.fadeReserve ? T.fadeDecel : 1.1) * dt);

      // コーナーでは外を回るほど進まない
      let progress = v * dt;
      if (isCorner(c, d0[i])) {
        const lanePenalty = lane * (has(r, "wideRunner") ? 0.6 : 1);
        // コーナーの入口と出口では曲がり方が緩やかに変わる（外を回るロスが急に生じたり消えたりしない）
        const eff = 1 - cornerDepth(c, d0[i], R, T.cornerEase) * (1 - R / (R + lanePenalty));
        st.tel.extraMeters += progress * (1 - eff);
        progress *= eff;
      }

      if (!done) {
        // 最高速度が高い馬ほど同じ速度を楽に走れる
        const effort = Math.pow(TOP_REF / st.top, T.costEconomy);
        const pw = r.abilities.power / 100;
        const corner = isCorner(c, d0[i]) ? 1 + T.cornerCost * (1 - 0.6 * pw) : 1;
        const slope =
          c.slope && remain <= SLOPE_REMAIN[0] && remain >= SLOPE_REMAIN[1] ? 1 + T.slopeCost * (1 - 0.6 * pw) * (1 - 0.5 * (r.aptitude.slope / 100)) : 1;
        const cost =
          st.costMul *
          effort *
          Math.pow(v / T.costRef, 2) *
          (st.keenNow ? 1.2 : 1) *
          (crowd >= 2 && has(r, "hatesCrowd") ? 1.05 : 1) *
          (contending[i] && contest >= 2 ? 1 + T.battleCost * battle : 1) *
          (1 - T.draftSave * draft) *
          corner *
          slope *
          // 最高速度に近い全力疾走は、巡航よりずっと消耗が激しい（早仕掛けほど長く払う）
          (1 + T.anaerobic * Math.pow(clamp((v / st.top - T.anaerobicFrom) / (1 - T.anaerobicFrom), 0, 1), 2));
        // 走る距離のぶん＋加速（緩急の繰り返し）＋横への進路変更
        // 有酸素で賄える分（aerobicRate）を超えた消耗だけが余力を減らす
        st.energy -= Math.max(0, cost * v - st.aerobic * st.costMul) * dt + T.accelCost * Math.max(0, v - v0[i]) * (st.phase === "spurt" ? 0.5 : 1) + T.lateralCost * Math.abs(lane - l0[i]);
        if (st.phase !== "spurt" && d0[i] > 200) {
          st.cruiseSum += v;
          st.cruiseN++;
        }
        if (remain <= 600) st.tel.topSpeedLate = Math.max(st.tel.topSpeedLate, v);
      }
      nextD[i] = d0[i] + progress;
      nextV[i] = v;
      nextLane[i] = lane;
    }

    // ---- 6. 全馬の新しい状態を一括で反映する ----
    for (let i = 0; i < n; i++) {
      S[i].d = nextD[i];
      S[i].v = nextV[i];
      S[i].lane = nextLane[i];
    }

    // ---- 7. 通過時刻・ゴールを記録する ----
    for (let i = 0; i < n; i++) {
      const st = S[i];
      if (done0[i] || st.d === d0[i]) continue;
      const prevD = d0[i];
      const interp = (mark: number) => t - dt + ((mark - prevD) / (st.d - prevD)) * dt;
      while (st.passTimes.length < Math.floor(Math.min(st.d, D) / 200)) {
        const mark = (st.passTimes.length + 1) * 200;
        st.passTimes.push(interp(mark));
      }
      for (const cp of checkpoints) {
        const mark = D - cp;
        if (!st.checkpointTimes.has(cp) && st.d >= mark) {
          st.checkpointTimes.set(cp, interp(mark));
          st.checkpointReserve.set(cp, Math.max(0, st.energy) / st.energy0);
        }
      }
      if (st.late600Start === null && st.d >= D - 600) st.late600Start = interp(D - 600);
      if (st.late200Start === null && st.d >= D - 200) st.late200Start = interp(D - 200);
      if (st.d >= D) {
        st.finish = interp(D);
        if (!st.checkpointTimes.has(0)) st.checkpointTimes.set(0, st.finish);
        if (!st.checkpointReserve.has(0)) st.checkpointReserve.set(0, Math.max(0, st.energy) / st.energy0);
      }
    }

    if (step % sampleEvery === 0) {
      frames.push(S.map((st) => Math.round(st.d * 100) / 100));
      lanes.push(S.map((st) => Math.round(st.lane * 10) / 10));
    }
    if (allDoneAt === null && S.every((st) => st.finish !== null)) allDoneAt = t;
    if (allDoneAt !== null && t >= allDoneAt + 3 && step % sampleEvery === 0) break;
  }
  for (const st of S) if (st.finish === null) st.finish = 999;

  const finishOrder = S.map((st, i) => ({ st, i })).sort(
    (a, b) => Math.round(a.st.finish! * 1000) - Math.round(b.st.finish! * 1000) || a.st.r.gate - b.st.r.gate,
  );
  const results: SimResultRow[] = finishOrder.map(({ st }, k) => {
    const prev = k > 0 ? finishOrder[k - 1].st : null;
    const margin = prev ? ((st.finish! - prev.finish!) * 16.5) / HORSE_LENGTH : 0;
    return {
      id: st.r.id,
      gate: st.r.gate,
      position: k + 1,
      timeMs: Math.round(st.finish! * 1000),
      marginLengths: Math.round(margin * 100) / 100,
    };
  });
  const finalPos = new Map(results.map((r) => [r.id, r.position]));

  // 通過順位
  for (const cp of checkpoints) {
    // ゴールの通過順は着順と同じ（着順はミリ秒に丸めた時刻と枠順で決めているため、それに合わせる）
    const passed = S.map((st) => ({ st, t: st.checkpointTimes.get(cp) ?? 999 })).sort((a, b) =>
      cp === 0 ? finalPos.get(a.st.r.id)! - finalPos.get(b.st.r.id)! : a.t - b.t || finalPos.get(a.st.r.id)! - finalPos.get(b.st.r.id)!,
    );
    passed.forEach(({ st }, k) => {
      st.tel.positions.push({ label: cpLabels.get(cp) ?? `残り${cp}m`, remain: cp, pos: k + 1 });
      (st.tel.reserve ??= []).push(Math.round((st.checkpointReserve.get(cp) ?? 0) * 100) / 100);
    });
  }
  // 実際に見せた位置取り：序盤だけでなく、中盤・終盤の通過順位も合わせて判定する
  for (const st of S) {
    st.tel.styleShown = styleFromPositions(st.tel.positions, n, D);
    st.tel.splits = st.passTimes.map((x) => Math.round(x * 100) / 100);
    st.tel.last600 = Math.round((st.finish! - (st.late600Start ?? 0)) * 100) / 100;
    st.tel.lastSegSpeed = Math.round((200 / Math.max(0.1, st.finish! - (st.late200Start ?? st.finish! - 12))) * 100) / 100;
    st.tel.cruiseSpeed = st.cruiseN > 0 ? Math.round((st.cruiseSum / st.cruiseN) * 100) / 100 : 0;
    st.tel.topSpeedLate = Math.round(st.tel.topSpeedLate * 100) / 100;
    st.tel.extraMeters = Math.round(st.tel.extraMeters * 10) / 10;
    st.tel.blockedSec = Math.round(st.tel.blockedSec * 10) / 10;
    st.tel.keenSec = Math.round(st.tel.keenSec * 10) / 10;
    st.tel.crowdedSec = Math.round(st.tel.crowdedSec * 10) / 10;
    st.tel.leadBattleSec = Math.round(st.tel.leadBattleSec! * 10) / 10;
    const duelOccurred = st.duelTicks >= 15;
    st.tel.duel = { occurred: duelOccurred, gained: duelOccurred && st.rankAtDuel !== null && finalPos.get(st.r.id)! - 1 < st.rankAtDuel };
  }

  // 先頭の200mラップ
  const leaderLaps: number[] = [];
  const marks = Math.floor(D / 200);
  let prevT = 0;
  for (let k = 0; k < marks; k++) {
    const tMin = Math.min(...S.map((st) => st.passTimes[k] ?? 999));
    leaderLaps.push(Math.round((tMin - prevT) * 100) / 100);
    prevT = tMin;
  }

  function racePace(): RacePace {
    const early = paceAcc.earlyN ? paceAcc.early / paceAcc.earlyN : predicted.index;
    const mid = paceAcc.midN ? paceAcc.mid / paceAcc.midN : early;
    const overall = 0.5 * early + 0.5 * mid;
    const r2 = (x: number) => Math.round(x * 100) / 100;
    return {
      predicted: r2(predicted.index),
      contenders: r2(predicted.contenders),
      early: r2(early),
      mid: r2(mid),
      label: overall >= T.paceLabelAt ? "high" : overall <= -T.paceLabelAt ? "slow" : "average",
      battleSec: Math.round(battleSec * 10) / 10,
    };
  }

  const telemetry: Record<string, RunnerTelemetry> = {};
  for (const st of S) telemetry[st.r.id] = st.tel;

  return {
    sampleDt: dt * sampleEvery,
    frames,
    lanes,
    results,
    durationSec: (frames.length - 1) * dt * sampleEvery,
    telemetry,
    leaderLaps,
    pace: racePace(),
  };
}
