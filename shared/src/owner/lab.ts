// 統計検証（指示書 17章）。仮の馬を同じ条件で何百回も走らせ、勝率・平均着順を調べる。
// 所有馬の真の値は使わない（開発・バランス調整用）。
import { createRng } from "../rng";
import { DEFAULT_CONFIG, type GameConfig } from "./config";
import { generateCpuEntries, type OwnerProgram } from "./racecard";
import { simulateOwnerRace, type SimRunner } from "./sim";

export interface TrialStats {
  trials: number;
  winRate: number;
  top3Rate: number;
  avgPosition: number;
  avgTimeMs: number;
}

/** 仮の馬（gate は自動）を CPU 馬と何度も走らせる */
export function runTrials(
  runner: Omit<SimRunner, "gate" | "id">,
  program: OwnerProgram,
  trials: number,
  seed: number,
  cfg: GameConfig = DEFAULT_CONFIG,
): TrialStats {
  let wins = 0,
    top3 = 0,
    posSum = 0,
    timeSum = 0;
  for (let i = 0; i < trials; i++) {
    const s = (seed + Math.imul(i + 1, 0x9e3779b1)) >>> 0;
    const rng = createRng(s);
    const gate = 1 + Math.floor(rng() * program.fieldSize);
    const cpus = generateCpuEntries(program, program.fieldSize - 1, (s ^ 0x2545f491) >>> 0);
    const runners: SimRunner[] = [];
    let ci = 0;
    for (let g = 1; g <= program.fieldSize; g++) {
      runners.push(g === gate ? { ...runner, id: "lab", gate: g } : { ...cpus[ci++].runner, gate: g });
    }
    const sim = simulateOwnerRace(runners, { course: program.course, going: program.going }, s, cfg);
    const me = sim.results.find((r) => r.id === "lab")!;
    if (me.position === 1) wins++;
    if (me.position <= 3) top3++;
    posSum += me.position;
    timeSum += me.timeMs;
  }
  return { trials, winRate: wins / trials, top3Rate: top3 / trials, avgPosition: posSum / trials, avgTimeMs: timeSum / trials };
}

/** 同じ馬どうしの直接対決（runners をそのまま走らせて、各馬の勝率を返す） */
export function headToHead(runners: SimRunner[], program: OwnerProgram, trials: number, seed: number, cfg: GameConfig = DEFAULT_CONFIG): Record<string, { winRate: number; avgPosition: number }> {
  const acc: Record<string, { wins: number; pos: number }> = {};
  for (const r of runners) acc[r.id] = { wins: 0, pos: 0 };
  for (let i = 0; i < trials; i++) {
    const s = (seed + Math.imul(i + 1, 0x85ebca6b)) >>> 0;
    // 枠順の有利不利をならすため、毎回枠を回す
    const shifted = runners.map((r, k) => ({ ...r, gate: ((k + i) % runners.length) + 1 }));
    const sim = simulateOwnerRace(shifted, { course: program.course, going: program.going }, s, cfg);
    for (const res of sim.results) {
      acc[res.id].pos += res.position;
      if (res.position === 1) acc[res.id].wins++;
    }
  }
  const out: Record<string, { winRate: number; avgPosition: number }> = {};
  for (const [id, a] of Object.entries(acc)) out[id] = { winRate: a.wins / trials, avgPosition: a.pos / trials };
  return out;
}
