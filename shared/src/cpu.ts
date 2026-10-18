// CPU馬の生成（レース番組の強さに合わせる）
import { STAT_KEYS, type Aptitude, type Grade, type Horse, type RunningStyle, type Stats } from "./types";
import { createRng, pick, randInt } from "./rng";
import { generateHorseName } from "./names";
import type { RaceProgram } from "./programs";

export const CPU_OWNER_ID = "cpu";
export const CPU_OWNER_NAME = "CPU厩舎";

const STYLES: RunningStyle[] = ["front", "stalker", "stalker", "closer", "closer", "deep"];

function grade(rng: () => number, good: number): Grade {
  const r = rng();
  if (r < good) return "A";
  if (r < good + 0.35) return "B";
  if (r < good + 0.55) return "C";
  return "D";
}

export function generateCpuHorse(program: RaceProgram, index: number, seed: number, taken: Set<string>): Horse {
  const rng = createRng((seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
  const level = randInt(rng, program.cpuStats.min, program.cpuStats.max);
  const stats = {} as Stats;
  for (const k of STAT_KEYS) stats[k] = Math.max(20, level + randInt(rng, -8, 8));
  const aptitude: Aptitude = {
    // 番組に合った馬が出てくる想定：芝・マイルは A か B
    turf: rng() < 0.6 ? "A" : "B",
    dirt: grade(rng, 0.3),
    sprint: grade(rng, 0.3),
    mile: rng() < 0.6 ? "A" : "B",
    middle: grade(rng, 0.35),
    long: grade(rng, 0.2),
  };
  const name = generateHorseName(rng, taken);
  taken.add(name);
  return {
    id: `cpu-${index}`,
    ownerId: CPU_OWNER_ID,
    name,
    stats,
    potential: { ...stats },
    style: pick(rng, STYLES),
    aptitude,
    fatigue: randInt(rng, 0, 30),
    condition: randInt(rng, -1, 1),
    injuryRestsLeft: 0,
    turns: 0,
    races: 0,
    wins: 0,
    totalPrize: 0,
    retired: false,
  };
}

export function generateCpuField(program: RaceProgram, count: number, seed: number, avoidNames: string[] = []): Horse[] {
  const taken = new Set(avoidNames);
  return Array.from({ length: count }, (_, i) => generateCpuHorse(program, i, seed, taken));
}
