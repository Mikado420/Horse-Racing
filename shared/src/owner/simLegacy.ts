// 着差の調整（v2.1、docs/margins）までのレース計算。比較・回帰確認のために残している。
// 既定のレース計算は sim.ts（脚質・ペース・スタミナの再設計）で、cfg.race.engine が "v21" のときだけこちらを使う。
// （v2.1 の main の sim.ts の計算部分をそのまま移したもの。型と共通の定義は sim.ts から読む）
import { createRng, gaussian, type Rng } from "../rng";
import type { Going, RunningStyle } from "../types";
import { distanceFactor, fitMultiplier } from "./aptitude";
import { DEFAULT_CONFIG, type GameConfig } from "./config";
import { cornerRadius, isCorner, SLOPE_REMAIN } from "./courses";
import type { TraitId } from "./model";
import { HORSE_LENGTH, spurtPoint, type PacePlan, type RunnerTelemetry, type SimConditions, type SimResult, type SimResultRow, type SimRunner } from "./sim";

const GOING_INDEX: Record<Going, number> = { good: 0, yielding: 1, soft: 2, heavy: 3 };
const DESIRED_POS: Record<RunningStyle, number> = { front: 0, stalker: 0.25, closer: 0.6, deep: 0.85 };
const EARLY_FRACTION: Record<RunningStyle, number> = { front: 0.965, stalker: 0.952, closer: 0.938, deep: 0.928 };
const MID_FRACTION = 0.915;
const PACE_ADJ: Record<PacePlan, number> = { easy: -0.012, normal: 0, aggressive: 0.012 };
/** エネルギー消費の基準速度（m/秒）。この速度で1mあたり1を消費する */
const COST_REF = 17.5;
/** differenceScale で能力値の差を縮めるときの中心の値 */
const ABILITY_REF = 60;

interface St {
  r: SimRunner;
  top: number;
  accel: number;
  energy: number;
  energy0: number;
  costMul: number;
  rs: number; // 実効の賢さ
  fs: number;
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

/** 1頭分の能力・適性・状態から、速度・加速・エネルギーの係数を作る */
function prepare(r: SimRunner, cond: SimConditions, rng: Rng, cfg: GameConfig): St {
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
  // 馬ごとの差を生む要素（速度・エネルギーに換算する能力値・芝ダート/回り/小回り/脚質の適性・状態・その日の出来）を、
  // differenceScale 倍に縮める（1 ならそのまま）。馬場全体の重さと距離適性の補正はここでは縮めない
  const k = rc.differenceScale;
  const sc = (m: number) => (k === 1 ? m : 1 + k * (m - 1));
  const pts = (x: number) => (k === 1 ? x : ABILITY_REF + k * (x - ABILITY_REF));
  const surfaceMul = fitMultiplier(c.surface === "turf" ? apt.turf : apt.dirt, rc.surfaceFit);
  const goingMul = 1 - g * 0.01 * (1 - pts(a.power) / 130) - (g > 0 ? 0.035 * (1 - apt.heavy / 100) * (g / 3) : 0);
  const dirMul = fitMultiplier(c.direction === "right" ? apt.right : apt.left, 0.02);
  const tightMul = c.tight ? fitMultiplier(apt.tight, 0.02) : 1;
  const styleMul = fitMultiplier(apt.styles[r.tactics.style], 0.025);
  const condMul =
    (1 + rc.conditionPerLevel * r.condition) * (1 - rc.fatiguePerPoint * r.fatigue) * (1 - rc.fitnessWeight + rc.fitnessWeight * (r.fitness / 100));
  const rs = Math.min(100, a.raceSense + Math.min(r.experience, 12) * 0.5);
  const formSd = rc.formSd * (has(r, "inconsistent") ? 2.4 : 1) * (1.2 - rs / 200);
  const form = 1 + gaussian(rng) * formSd;
  const distSpeed = under ? 1 - de.shortSpeed * (1 - distF) : over ? 1 - de.longSpeed * (1 - distF) : 1;
  const speedMul = sc(surfaceMul) * goingMul * sc(dirMul) * sc(tightMul) * sc(styleMul) * sc(condMul) * sc(form) * distSpeed;
  const top = (rc.topBase + rc.topPerSpeed * pts(a.speed)) * speedMul;
  const accel = (1.5 + 0.022 * pts(a.acceleration)) * (0.85 + 0.15 * (pts(a.power) / 100)) * (under ? 1 - de.shortAccel * (1 - distF) : 1);
  const energy = cfg.race.energyScale * (700 + 27 * pts(a.stamina)) * (1 - 0.003 * r.fatigue) * (0.9 + 0.1 * (r.fitness / 100));
  const costMul =
    (over ? 1 + de.longStamina * (1 - distF) : 1) *
    (1.05 - 0.07 * (rs / 100)) *
    (has(r, "calm") ? 0.97 : 1) *
    (2 - sc(styleMul) * 1) *
    (1 + 0.04 * g);
  const startDelay = rng() * 0.45 * (1.25 - rs / 140) * rc.startDelayScale;

  return {
    r,
    top,
    accel,
    energy,
    energy0: energy,
    costMul,
    rs,
    fs: a.fightingSpirit,
    d: 0,
    v: 0,
    lane: 0.8 + (r.gate - 1) * 1.25,
    targetLane: 0.8,
    startDelay,
    phase: "early",
    finish: null,
    passTimes: [],
    checkpointTimes: new Map(),
    keenNow: false,
    wantOut: false,
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

/** 速度 v で残り remain(m) を走るのに要るエネルギー（有酸素で賄える分を差し引き、消費の倍率をかける） */
function energyNeed(st: St, v: number, remain: number, cfg: GameConfig): number {
  return remain * st.costMul * (Math.pow(v / COST_REF, 2) - cfg.race.aerobicRate / v);
}

/**
 * 道中の配分：仕掛け地点から先を最高速度で走る分のエネルギーを残したうえで、
 * 仕掛け地点まで一定速度で走れる上限の速度（二分法）
 */
function sustainableSpeed(st: St, remain: number, spurtFrom: number, cfg: GameConfig): number {
  const spurtLen = Math.min(remain, spurtFrom);
  const before = remain - spurtLen;
  if (before <= 0) return st.top * 1.2;
  const energy = st.energy - Math.max(0, energyNeed(st, st.top, spurtLen, cfg));
  let lo = 5;
  let hi = st.top * 1.2;
  if (energyNeed(st, hi, before, cfg) <= energy) return hi;
  for (let k = 0; k < 18; k++) {
    const mid = (lo + hi) / 2;
    if (energyNeed(st, mid, before, cfg) <= energy) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function simulateOwnerRaceV21(
  runners: SimRunner[],
  cond: SimConditions,
  seed: number,
  cfg: GameConfig = DEFAULT_CONFIG,
): Omit<SimResult, "pace"> {
  if (runners.length < 1) throw new Error("出走馬がいません");
  const rng = createRng(seed);
  const c = cond.course;
  const D = c.distance;
  const R = cornerRadius(c);
  const dt = 1 / cfg.race.hz;
  const sampleEvery = Math.max(1, Math.round(cfg.race.sampleDt / dt));
  const sorted = [...runners].sort((a, b) => a.gate - b.gate);
  const S: St[] = sorted.map((r) => prepare(r, cond, rng, cfg));
  const n = S.length;
  const checkpoints = [D - 400, 800, 400, 200, 0].filter((x, i, arr) => x >= 0 && arr.indexOf(x) === i && x < D);
  const cpLabels = new Map<number, string>([[D - 400, "序盤"], [800, "残り800m"], [400, "残り400m"], [200, "残り200m"], [0, "ゴール"]]);
  const spurtFrom = S.map((st) => spurtPoint(c, st.r.tactics.spurt));
  const earlyEnd = Math.min(600, D * 0.3);

  const frames: number[][] = [S.map(() => 0)];
  const lanes: number[][] = [S.map((st) => Math.round(st.lane * 10) / 10)];
  const maxSteps = Math.round(400 / dt);
  let step = 0;
  let allDoneAt: number | null = null;
  let order: number[] = S.map((_, i) => i);

  while (step < maxSteps) {
    step++;
    const t = step * dt;
    // 現在の順位（前にいる順）
    order = S.map((_, i) => i).sort((x, y) => S[y].d - S[x].d);
    const rankOf = new Array<number>(n);
    order.forEach((idx, rank) => (rankOf[idx] = rank));

    // 1秒ごとの判断（行きたがる・進路）
    const decide = step % Math.round(1 / dt) === 1;

    for (let i = 0; i < n; i++) {
      const st = S[i];
      if (t < st.startDelay) continue;
      const r = st.r;
      const remain = D - st.d;
      const done = st.finish !== null;
      const rf = n > 1 ? rankOf[i] / (n - 1) : 0;

      // 段階の切り替え
      if (!done) {
        if (st.phase === "early" && st.d >= earlyEnd) st.phase = "mid";
        if (st.phase !== "spurt" && remain <= spurtFrom[i]) {
          // 残りのエネルギーで最後まで脚が持つか見極めてから仕掛ける
          const need = energyNeed(st, st.top, remain, cfg);
          if (st.energy >= need * 0.92 || remain <= 260) {
            st.phase = "spurt";
            st.tel.spurtRemain = Math.round(remain);
          }
        }
      }

      // 周囲の状況
      let blockedBy: St | null = null;
      let crowd = 0;
      let rival = false;
      let duelClose = 0;
      let ahead: St | null = null;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const o = S[j];
        const gap = o.d - st.d;
        const dl = Math.abs(o.lane - st.lane);
        if (Math.abs(gap) < 3 && dl < 2.2) crowd++;
        if (gap > 0 && gap < cfg.race.followRange && o.finish === null && (!ahead || o.d < ahead.d)) ahead = o;
        if (gap > 0 && gap < 2.6 && dl < 1.25 && o.finish === null) {
          if (!blockedBy || o.d < blockedBy.d) blockedBy = o;
        }
        if (!done && remain < 300 && o.finish === null && Math.abs(gap) < 1.6 && dl < 2.6) {
          rival = true;
          duelClose = Math.max(duelClose, 1 - Math.abs(gap) / 1.6);
        }
      }

      // 目標速度
      let target: number;
      if (done) target = st.top * 0.6;
      else if (st.phase === "spurt") {
        target = st.top * (has(r, "closerKick") ? 1.015 : 1.0);
      } else {
        let frac = st.phase === "early" ? EARLY_FRACTION[r.tactics.style] : MID_FRACTION;
        frac += PACE_ADJ[r.tactics.pace];
        // 距離に応じた道中のペース：長い距離ほどゆったり、短い距離ほど速く運ぶ（cruisePerKm が 0 なら距離によらない）
        if (cfg.race.cruisePerKm !== 0) frac = Math.min(0.99, frac * (1 - cfg.race.cruisePerKm * ((D - 1600) / 1000)));
        let desired = DESIRED_POS[r.tactics.style];
        if (has(r, "frontObsessed")) {
          desired = 0;
          frac += 0.008;
        }
        if (st.phase === "early") {
          if (rf > desired + 0.15) frac += 0.012;
          else if (rf < desired - 0.15) frac -= 0.012;
        } else {
          if (rf > desired + 0.25) frac += 0.006;
          else if (rf < desired - 0.25) frac -= 0.006;
        }
        // 行きたがる：騎手が抑えても前に行こうとして消耗する
        if (decide) {
          const chance = has(r, "keen") ? 0.35 * (1.2 - st.rs / 120) : 0.01 * (1 - st.rs / 100);
          st.keenNow = r.tactics.style !== "front" && rng() < chance;
        }
        // 道中の速度：作戦（脚質・ペース・位置取り）による割合を、巡航の基準速度にかける。
        // 基準は最高速度の MID_FRACTION 倍だが、配分（staminaPacing）が有効なら、残りのエネルギーで
        // 最後まで走り切れる速度を超えないように抑える（長い距離ほど道中は遅くなる）
        let own = st.top * frac;
        let sustainable = Infinity;
        if (cfg.race.staminaPacing > 0 && st.energy > 0) {
          sustainable = sustainableSpeed(st, remain, spurtFrom[i], cfg);
          const cruise = Math.min(st.top * MID_FRACTION, Math.max(st.top * 0.8, sustainable * cfg.race.staminaPacing));
          own = cruise * (frac / MID_FRACTION);
        }
        // 行きたがる：騎手が抑えても前に行こうとして消耗する
        if (st.keenNow) {
          own += st.top * 0.02;
          st.tel.keenSec += dt;
        }
        target = own;
        // 馬群について行く：すぐ前の馬が速ければ、その速度に合わせる（離されないように脚を使う）。
        // ただし最高速度の followMaxFraction 倍と、走り切れる速度の followOverPace 倍までしか無理をしない
        if (ahead && cfg.race.followMaxFraction > 0) {
          const limit = Math.min(st.top * cfg.race.followMaxFraction, sustainable * cfg.race.followOverPace);
          target = Math.max(target, Math.min(ahead.v, limit));
        }
      }

      if (!done) {
        // 坂
        if (c.slope && remain <= SLOPE_REMAIN[0] && remain >= SLOPE_REMAIN[1]) {
          target *= 1 - 0.03 * (1 - r.abilities.power / 120) * (1 - 0.5 * (r.aptitude.slope / 100));
        }
        // 競り合い：根性で伸びる
        if (rival) {
          // duelTaper > 0 なら、並んでいるほど強く効く（離れるにつれて連続的に弱まる）
          const strength = 1 - cfg.race.duelTaper * (1 - duelClose);
          target *= 1 + (0.00025 * st.fs + (has(r, "gutsy") ? 0.006 : 0)) * strength;
          st.duelTicks++;
          if (st.rankAtDuel === null) st.rankAtDuel = rankOf[i];
        }
        // 馬群
        if (crowd >= 2) {
          st.tel.crowdedSec += dt;
          if (has(r, "hatesCrowd")) target *= 0.985;
        }
        // スタミナ切れ
        // 尽きたときに保てる速度は根性で少し上がる。fadeReserve > 0 なら、残りが少なくなった所から
        // その速度へ向けて連続的に落ちていく（尽きた瞬間に急に止まるような不連続をなくす）
        const floor = cfg.race.emptyFloor + 0.0006 * st.fs + (has(r, "gutsy") ? 0.008 : 0);
        const reserve = cfg.race.fadeReserve * st.energy0;
        if (st.energy <= 0) {
          if (st.tel.emptyRemain === null) st.tel.emptyRemain = Math.round(remain);
          target = Math.min(target, st.top * floor);
        } else if (st.energy < reserve) {
          const left = st.energy / reserve;
          target = Math.min(target, st.top * (floor + (1 - floor) * left));
        }
        // 前が詰まる（前の馬より速く走りたいのに抜けない）
        st.wantOut = false;
        if (blockedBy && st.d > 150 && target > blockedBy.v + 0.2) {
          target = Math.min(target, blockedBy.v + 0.05);
          st.tel.blockedSec += dt;
          st.wantOut = true;
        }
      }

      // 進路取り：詰まったら外へ出す。そうでなければ序盤・中盤は内へ寄せる
      if (decide && !done) {
        if (st.wantOut && blockedBy) {
          const outside = blockedBy.lane + 1.6;
          if (rng() < 0.55 + st.rs / 250) st.targetLane = Math.min(c.trackWidth - 1, outside);
        } else if (st.phase === "early" || st.phase === "mid") {
          const inside = Math.max(0.6, st.lane - 1.2);
          const occupied = S.some((o, j) => j !== i && Math.abs(o.lane - inside) < 1.1 && Math.abs(o.d - st.d) < 3.2);
          if (!occupied && rng() < 0.4 + st.rs / 250) st.targetLane = inside;
        }
      }
      const laneStep = 0.8 * dt;
      if (Math.abs(st.targetLane - st.lane) <= laneStep) st.lane = st.targetLane;
      else st.lane += Math.sign(st.targetLane - st.lane) * laneStep;

      // 速度の更新（加速力に応じて徐々に）
      const prevD = st.d;
      const boost = (st.v < 10 ? 1.6 : 1) * (st.phase === "spurt" && has(r, "closerKick") ? 1.15 : 1);
      if (st.v < target) st.v = Math.min(target, st.v + st.accel * dt * boost);
      else st.v = Math.max(target, st.v - (st.energy <= 0 ? 0.5 : 1.1) * dt);

      // コーナーでは外を回るほど進まない
      let progress = st.v * dt;
      if (isCorner(c, st.d)) {
        const lanePenalty = st.lane * (has(r, "wideRunner") ? 0.6 : 1);
        const eff = R / (R + lanePenalty);
        st.tel.extraMeters += progress * (1 - eff);
        progress *= eff;
      }
      st.d += progress;

      if (!done) {
        const cost = st.costMul * Math.pow(st.v / COST_REF, 2) * (st.keenNow ? 1.2 : 1) * (crowd >= 2 && has(r, "hatesCrowd") ? 1.05 : 1);
        st.energy = Math.min(st.energy0, st.energy - (cost * st.v - cfg.race.aerobicRate * st.costMul) * dt);
        if (st.phase !== "spurt" && st.d > 200) {
          st.cruiseSum += st.v;
          st.cruiseN++;
        }
        if (remain <= 600) st.tel.topSpeedLate = Math.max(st.tel.topSpeedLate, st.v);
        // 200mごとの通過・チェックポイント
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
