// レースシミュレーション（サーバー権威）。
// サーバーだけがこの関数を実行して着順を確定し、その全経過（フレーム）をクライアントへ配信する。
// クライアントは配信されたフレームを再生するだけで、着順を再計算しない。

import { createRng, gaussian, pick, type Rng } from "./rng";
import type {
  Aptitude,
  CourseDef,
  DistanceBand,
  Going,
  Grade,
  RunningStyle,
  Stats,
  Weather,
} from "./types";

export interface RaceRunnerInput {
  entryId: string;
  gate: number; // 1始まりの馬番
  stats: Stats;
  style: RunningStyle;
  aptitude: Aptitude;
  fatigue: number;
  condition: number;
}

export interface RaceConditions {
  course: CourseDef;
  going: Going;
  weather: Weather;
}

export interface RunnerResult {
  entryId: string;
  gate: number;
  position: number;
  timeMs: number;
  /** 前の馬との差（馬身） */
  marginLengths: number;
}

export interface RaceSimResult {
  sampleDt: number; // 秒
  /** frames[k][i] = 時刻 k*sampleDt における i 番目の出走馬（runners配列順）の走行距離(m) */
  frames: number[][];
  results: RunnerResult[]; // 着順
  durationSec: number;
}

export const SIM_DT = 0.05;
export const SAMPLE_DT = 0.25;
export const HORSE_LENGTH_M = 2.4;

const GRADE_MUL: Record<Grade, number> = { A: 1.0, B: 0.988, C: 0.972, D: 0.95 };
const GOING_INDEX: Record<Going, number> = { good: 0, yielding: 1, soft: 2, heavy: 3 };

interface StyleProfile {
  early: number;
  mid: number;
  spurt: number;
  spurtFrom: number; // ゴール手前何mでスパートするか
}
const STYLE_PROFILE: Record<RunningStyle, StyleProfile> = {
  front: { early: 0.98, mid: 0.95, spurt: 0.99, spurtFrom: 300 },
  stalker: { early: 0.965, mid: 0.95, spurt: 1.02, spurtFrom: 400 },
  closer: { early: 0.945, mid: 0.948, spurt: 1.055, spurtFrom: 420 },
  deep: { early: 0.93, mid: 0.945, spurt: 1.06, spurtFrom: 450 },
};

export function distanceBand(distance: number): DistanceBand {
  if (distance <= 1400) return "sprint";
  if (distance <= 1800) return "mile";
  if (distance <= 2400) return "middle";
  return "long";
}

/** シードから馬場状態と天候を決める */
export function conditionsFromSeed(seed: number, course: CourseDef): RaceConditions {
  const rng = createRng(seed ^ 0x9e3779b9);
  const weather = pick<Weather>(rng, ["sunny", "sunny", "cloudy", "cloudy", "rain"]);
  const going: Going =
    weather === "rain"
      ? pick<Going>(rng, ["yielding", "soft", "heavy"])
      : pick<Going>(rng, ["good", "good", "good", "yielding"]);
  return { course, going, weather };
}

/** 能力・適性・状態から算出した、その馬の実効値（表示・テスト用にも公開） */
export function effectiveMultiplier(r: RaceRunnerInput, cond: RaceConditions): number {
  const condMul = 1 + 0.012 * r.condition;
  const fatigueMul = 1 - 0.0007 * r.fatigue;
  const surfaceMul = GRADE_MUL[r.aptitude[cond.course.surface]];
  const distMul = GRADE_MUL[r.aptitude[distanceBand(cond.course.distance)]];
  return condMul * fatigueMul * surfaceMul * distMul;
}

interface RunnerState {
  input: RaceRunnerInput;
  mul: number;
  top: number;
  accel: number;
  stamina: number;
  d: number;
  v: number;
  startDelay: number;
  pace: number; // 現在のペース補正
  blocked: boolean;
  finishTime: number | null;
}

export function simulateRace(
  runners: RaceRunnerInput[],
  cond: RaceConditions,
  seed: number,
): RaceSimResult {
  if (runners.length < 1) throw new Error("出走馬がいません");
  const rng: Rng = createRng(seed);
  const L = cond.course.distance;
  const g = GOING_INDEX[cond.going];

  const states: RunnerState[] = runners.map((input) => {
    const s = input.stats;
    const mul = effectiveMultiplier(input, cond);
    const goingPenalty = 1 - g * 0.01 * (1 - Math.min(s.power, 120) / 200);
    // その日の出来（レースごとの揺らぎ）。賢さが高いほど安定する
    const form = 1 + gaussian(rng) * 0.012 * (1.3 - Math.min(s.wisdom, 120) / 200);
    return {
      input,
      mul,
      top: (15.9 + 0.03 * s.speed) * mul * goingPenalty * form,
      accel: (1.6 + 0.016 * s.power) * mul,
      stamina: (500 + 12 * s.stamina) * (1 - input.fatigue * 0.002),
      d: 0,
      v: 0,
      startDelay: rng() * 0.35 * (1.2 - Math.min(s.wisdom, 120) / 150),
      pace: 1,
      blocked: false,
      finishTime: null,
    };
  });

  const stepsPerSample = Math.round(SAMPLE_DT / SIM_DT);
  const stepsPerSecond = Math.round(1 / SIM_DT);
  const frames: number[][] = [states.map(() => 0)];
  const maxSteps = Math.round(300 / SIM_DT);
  let step = 0;
  let allFinishedAt: number | null = null;

  while (step < maxSteps) {
    step++;
    const t = step * SIM_DT;

    // 1秒ごとにペースの揺らぎと進路の詰まりを更新
    if (step % stepsPerSecond === 1) {
      for (const st of states) {
        const w = Math.min(st.input.stats.wisdom, 120);
        st.pace = 1 + gaussian(rng) * 0.012 * (1.25 - w / 160);
        st.blocked = false;
        const prof = STYLE_PROFILE[st.input.style];
        if (st.finishTime === null && st.d > L - prof.spurtFrom && (st.input.style === "closer" || st.input.style === "deep")) {
          const ahead = states.filter((o) => o !== st && o.finishTime === null && o.d > st.d && o.d - st.d < 4).length;
          if (ahead >= 2 && rng() < 0.5 * (1 - w / 150)) st.blocked = true;
        }
      }
    }

    for (const st of states) {
      if (t < st.startDelay) continue;
      const s = st.input.stats;
      const prof = STYLE_PROFILE[st.input.style];
      let target: number;
      if (st.finishTime !== null) {
        target = st.top * 0.55; // ゴール後は流す
      } else {
        const phase = st.d < L * 0.3 ? prof.early : st.d < L - prof.spurtFrom ? prof.mid : prof.spurt;
        target = st.top * phase * st.pace;
        if (st.d >= L - prof.spurtFrom) {
          // 競り合い：近くに他馬がいると根性で伸びる
          const rival = states.some((o) => o !== st && o.finishTime === null && Math.abs(o.d - st.d) < 1.5);
          if (rival) target *= 1 + Math.min(s.guts, 120) * 0.0003;
          if (st.blocked) target *= 0.96;
        }
        if (st.stamina <= 0) {
          target = Math.min(target, st.top * (0.86 + Math.min(s.guts, 120) * 0.0011));
        }
      }
      const prevD = st.d;
      if (st.v < target) st.v = Math.min(target, st.v + st.accel * SIM_DT);
      else st.v = Math.max(target, st.v - 1.2 * SIM_DT);
      st.d += st.v * SIM_DT;
      if (st.finishTime === null) {
        const ratio = st.v / 16.5;
        st.stamina -= 11 * ratio * ratio * ratio * (1 + g * 0.04) * SIM_DT;
        if (st.d >= L) {
          const frac = (L - prevD) / (st.d - prevD);
          st.finishTime = t - SIM_DT + frac * SIM_DT;
        }
      }
    }

    if (step % stepsPerSample === 0) {
      frames.push(states.map((st) => Math.round(st.d * 100) / 100));
    }
    if (allFinishedAt === null && states.every((st) => st.finishTime !== null)) allFinishedAt = t;
    // 全頭ゴール後、3秒分の流しを記録して終了
    if (allFinishedAt !== null && t >= allFinishedAt + 3 && step % stepsPerSample === 0) break;
  }

  // 万一ゴールしない馬がいた場合（理論上起きない）は最後尾扱い
  for (const st of states) if (st.finishTime === null) st.finishTime = 999;

  const order = states
    .map((st, i) => ({ st, i }))
    .sort((a, b) => {
      const ta = Math.round(a.st.finishTime! * 1000);
      const tb = Math.round(b.st.finishTime! * 1000);
      return ta - tb || a.st.input.gate - b.st.input.gate;
    });

  const results: RunnerResult[] = order.map(({ st }, idx) => {
    const prev = idx > 0 ? order[idx - 1].st : null;
    const margin = prev ? ((st.finishTime! - prev.finishTime!) * 16.5) / HORSE_LENGTH_M : 0;
    return {
      entryId: st.input.entryId,
      gate: st.input.gate,
      position: idx + 1,
      timeMs: Math.round(st.finishTime! * 1000),
      marginLengths: Math.round(margin * 100) / 100,
    };
  });

  return {
    sampleDt: SAMPLE_DT,
    frames,
    results,
    durationSec: (frames.length - 1) * SAMPLE_DT,
  };
}

/** 着差の表記 */
export function marginLabel(lengths: number): string {
  if (lengths <= 0.05) return "同着";
  if (lengths < 0.15) return "ハナ";
  if (lengths < 0.3) return "アタマ";
  if (lengths < 0.45) return "クビ";
  if (lengths > 10) return "大差";
  const q = Math.round(lengths * 4) / 4;
  const whole = Math.floor(q);
  const frac = q - whole;
  const fracLabel = frac === 0.25 ? "1/4" : frac === 0.5 ? "1/2" : frac === 0.75 ? "3/4" : "";
  if (whole === 0) return `${fracLabel}馬身`;
  return `${whole}${fracLabel ? " " + fracLabel : ""}馬身`;
}

export function formatRaceTime(ms: number): string {
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = totalSec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
