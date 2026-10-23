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
import { cornerRadius, isCorner, SLOPE_REMAIN, type OwnerCourse } from "./courses";
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
  const surfaceMul = fitMultiplier(c.surface === "turf" ? apt.turf : apt.dirt, 0.06);
  const goingMul = 1 - g * 0.01 * (1 - a.power / 130) - (g > 0 ? 0.035 * (1 - apt.heavy / 100) * (g / 3) : 0);
  const dirMul = fitMultiplier(c.direction === "right" ? apt.right : apt.left, 0.02);
  const tightMul = c.tight ? fitMultiplier(apt.tight, 0.02) : 1;
  const condMul = (1 + 0.012 * r.condition) * (1 - 0.0008 * r.fatigue) * (0.95 + 0.05 * (r.fitness / 100));
  const distSpeed = under ? 1 - de.shortSpeed * (1 - distF) : over ? 1 - de.longSpeed * (1 - distF) : 1;
  return (16.6 + 0.034 * a.speed) * surfaceMul * goingMul * dirMul * tightMul * condMul * distSpeed;
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

  const rs = Math.min(100, a.raceSense + Math.min(r.experience, 12) * 0.5);
  const formSd = 0.009 * (has(r, "inconsistent") ? 2.4 : 1) * (1.2 - rs / 200);
  const form = 1 + gaussian(rng) * formSd;
  const styleFit = clamp(apt.styles[r.tactics.style] / 100, 0, 1);
  const top = baseTopSpeed(r, cond, cfg) * form;
  const accel = (1.5 + 0.022 * a.acceleration) * (0.85 + 0.15 * (a.power / 100)) * (under ? 1 - de.shortAccel * (1 - distF) : 1);
  const energy = (700 + 27 * a.stamina) * (1 - 0.003 * r.fatigue) * (0.9 + 0.1 * (r.fitness / 100));
  const costMul =
    (over ? 1 + de.longStamina * (1 - distF) : 1) *
    (1.05 - 0.07 * (rs / 100)) *
    (has(r, "calm") ? 0.97 : 1) *
    (1 + T.styleWaste * (1 - styleFit)) *
    (1 + 0.04 * g);
  const startDelay = rng() * 0.45 * (1.25 - rs / 140);

  return {
    r,
    top,
    accel,
    energy,
    energy0: energy,
    costMul,
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
    keenNow: false,
    wantOut: false,
    wobble: 0,
    cruiseSum: 0,
    cruiseN: 0,
    late200Start: null,
    late600Start: null,
    duelTicks: 0,
    rankAtDuel: null,
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

export function simulateOwnerRace(
  runners: SimRunner[],
  cond: SimConditions,
  seed: number,
  cfg: GameConfig = DEFAULT_CONFIG,
): SimResult {
  if (runners.length < 1) throw new Error("出走馬がいません");
  const T = cfg.race.tuning;
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
  const spurtFrom = S.map((st) => spurtPoint(c, st.r.tactics.spurt));
  const earlyEnd = Math.min(T.earlyMeters, D * T.earlyFraction);
  const paceK = 1 - Math.exp(-dt / T.paceTau);

  const frames: number[][] = [S.map(() => 0)];
  const lanes: number[][] = [S.map((st) => Math.round(st.lane * 10) / 10)];
  const maxSteps = Math.round(400 / dt);
  let step = 0;
  let allDoneAt: number | null = null;
  /** レースの流れ（先頭の速度を平滑化したもの） */
  let paceV = 0;

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

    // ---- 3. レース全体の流れを更新する ----
    if (lead >= 0) paceV += (v0[lead] - paceV) * paceK;

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
        if (st.phase !== "spurt" && remain <= spurtFrom[i]) {
          // 残りのエネルギーで最後まで脚が持つか見極めてから仕掛ける
          const need = remain * st.costMul * Math.pow(st.top / T.costRef, 2);
          if (st.energy >= need * 0.92 || remain <= 260) {
            st.phase = "spurt";
            st.tel.spurtRemain = Math.round(remain);
          }
        }
      }

      // 周囲の状況
      let blockedBy = -1;
      let crowd = 0;
      let rival = false;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const gap = d0[j] - d0[i];
        const dl = Math.abs(l0[j] - l0[i]);
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
        target = st.top * (has(r, "closerKick") ? 1.015 : 1.0);
      } else {
        const ph = st.phase === "early" ? "early" : "mid";
        const style: RunningStyle = has(r, "frontObsessed") ? "front" : r.tactics.style;
        // 自分のリズムで走るときの巡航。出走馬全体の速さを基準にし、自分の最高速度は一部だけ反映する
        // （能力の高い馬ほど同じ流れを楽に走れるが、脚質に関係なく前へ飛ばしていくわけではない）
        const own = fieldTop + (st.top - fieldTop) * T.ownRhythm;
        const comfort =
          own * (T.cruise[ph] + (ph === "early" ? T.styleEarlyAdj[style] : 0) + T.pacePlanAdj[r.tactics.pace] + (has(r, "frontObsessed") ? 0.008 : 0));
        // 先頭の馬が逃げたくて逃げているか（目標帯より大きく前にいるなら、仕方なく先頭にいるだけ）
        const leaderReluctant = lead >= 0 && lead !== i && leadErr < -0.1;
        const wantsLead = T.styleBands[style][0] <= 0.001;
        // 先頭から離れるほど、流れ（ペース）に合わせて走る。速い馬でも後方では流れ以上に飛ばさない
        const follow =
          wantsLead && leaderReluctant ? 0 : smoothstep(T.flowRamp[0], T.flowRamp[1], d0[i]) * smoothstep(0, T.leadBlendMeters, leaderD - d0[i]);
        const base = comfort + (paceV - comfort) * follow;
        // 脚質に応じた目標位置との差から補正する
        const band = bands[i];
        if (decide) {
          // 脚質適性が低いほど位置取りが安定しない（ゆっくり動くぶれ）
          const amp = T.styleWobble * (1 - st.styleFit);
          st.wobble = clamp(st.wobble * 0.8 + gaussian(rng) * amp * 0.5, -amp, amp);
        }
        let corr = positionCorrection(softPos[i] + st.wobble, band, T.posGain[ph], T) * (1 - T.styleStability * (1 - st.styleFit));
        if (wantsLead && leaderReluctant) corr = Math.max(corr, T.posGain[ph].up);
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
        // スタミナ切れ
        if (st.energy <= 0) {
          if (st.tel.emptyRemain === null) st.tel.emptyRemain = Math.round(remain);
          target = Math.min(target, st.top * (0.89 + 0.0006 * st.fs + (has(r, "gutsy") ? 0.008 : 0)));
        }
        // 前が詰まる（前の馬より速く走りたいのに抜けない）
        st.wantOut = false;
        if (blockedBy >= 0 && d0[i] > 150 && target > v0[blockedBy] + 0.2) {
          target = Math.min(target, v0[blockedBy] + 0.05);
          st.tel.blockedSec += dt;
          st.wantOut = true;
        }
      }

      // 進路取り：詰まったら外へ出す。そうでなければ序盤・中盤は内へ寄せる
      if (decide && !done) {
        if (st.wantOut && blockedBy >= 0) {
          const outside = l0[blockedBy] + 1.6;
          if (rng() < 0.55 + st.rs / 250) st.targetLane = Math.min(c.trackWidth - 1, outside);
        } else if (st.phase === "early" || st.phase === "mid") {
          const inside = Math.max(0.6, l0[i] - 1.2);
          let occupied = false;
          for (let j = 0; j < n; j++) if (j !== i && Math.abs(l0[j] - inside) < 1.1 && Math.abs(d0[j] - d0[i]) < 3.2) occupied = true;
          if (!occupied && rng() < 0.4 + st.rs / 250) st.targetLane = inside;
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
      else v = Math.max(target, v - (st.energy <= 0 ? 0.5 : 1.1) * dt);

      // コーナーでは外を回るほど進まない
      let progress = v * dt;
      if (isCorner(c, d0[i])) {
        const lanePenalty = lane * (has(r, "wideRunner") ? 0.6 : 1);
        const eff = R / (R + lanePenalty);
        st.tel.extraMeters += progress * (1 - eff);
        progress *= eff;
      }

      if (!done) {
        // 最高速度が高い馬ほど同じ速度を楽に走れる
        const effort = Math.pow(TOP_REF / st.top, T.costEconomy);
        const cost = st.costMul * effort * Math.pow(v / T.costRef, 2) * (st.keenNow ? 1.2 : 1) * (crowd >= 2 && has(r, "hatesCrowd") ? 1.05 : 1);
        st.energy -= cost * v * dt;
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
        if (!st.checkpointTimes.has(cp) && st.d >= mark) st.checkpointTimes.set(cp, interp(mark));
      }
      if (st.late600Start === null && st.d >= D - 600) st.late600Start = interp(D - 600);
      if (st.late200Start === null && st.d >= D - 200) st.late200Start = interp(D - 200);
      if (st.d >= D) {
        st.finish = interp(D);
        if (!st.checkpointTimes.has(0)) st.checkpointTimes.set(0, st.finish);
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
    const passed = S.map((st) => ({ st, t: st.checkpointTimes.get(cp) ?? 999 })).sort((a, b) => a.t - b.t);
    passed.forEach(({ st }, k) => st.tel.positions.push({ label: cpLabels.get(cp) ?? `残り${cp}m`, remain: cp, pos: k + 1 }));
  }
  // 実際に見せた位置取り（序盤の通過順位から）
  for (const st of S) {
    const early = st.tel.positions.find((p) => p.remain === D - 400)?.pos ?? 1;
    const f = n > 1 ? (early - 1) / (n - 1) : 0;
    st.tel.styleShown = f <= 0.12 ? "front" : f <= 0.42 ? "stalker" : f <= 0.72 ? "closer" : "deep";
    st.tel.splits = st.passTimes.map((x) => Math.round(x * 100) / 100);
    st.tel.last600 = Math.round((st.finish! - (st.late600Start ?? 0)) * 100) / 100;
    st.tel.lastSegSpeed = Math.round((200 / Math.max(0.1, st.finish! - (st.late200Start ?? st.finish! - 12))) * 100) / 100;
    st.tel.cruiseSpeed = st.cruiseN > 0 ? Math.round((st.cruiseSum / st.cruiseN) * 100) / 100 : 0;
    st.tel.topSpeedLate = Math.round(st.tel.topSpeedLate * 100) / 100;
    st.tel.extraMeters = Math.round(st.tel.extraMeters * 10) / 10;
    st.tel.blockedSec = Math.round(st.tel.blockedSec * 10) / 10;
    st.tel.keenSec = Math.round(st.tel.keenSec * 10) / 10;
    st.tel.crowdedSec = Math.round(st.tel.crowdedSec * 10) / 10;
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
  };
}
