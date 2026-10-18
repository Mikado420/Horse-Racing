// 週ごとのレース番組とCPU馬（指示書 3.3・14章）。番組は週番号から決まるので、いつ見ても同じ。
import { createRng, gaussian, pick, randInt, type Rng } from "../rng";
import type { Going, RunningStyle, Surface } from "../types";
import { generateHorseName } from "../names";
import { ageAt, monthOf, raceEligibleAge, weekInMonth, WEEKS_PER_YEAR } from "./calendar";
import { allCourses, makeCourse, type OwnerCourse } from "./courses";
import { hash32 } from "./knowledge";
import { genAptitude } from "./horsegen";
import { ABILITY_KEYS, STYLE_KEYS, TRAIT_CONFLICTS, TRAIT_IDS, type Abilities, type RaceHorse, type TraitId } from "./model";
import type { SimRunner, Tactics } from "./sim";

export type ClassId = "newcomer" | "maiden" | "c1" | "c2" | "open" | "stakes";

export interface ClassDef {
  id: ClassId;
  label: string;
  /** CPU馬の能力の範囲（6能力の平均） */
  level: [number, number];
  /** 1着賞金 */
  firstPrize: number;
  conditionText: string;
}

export const CLASS_DEFS: Record<ClassId, ClassDef> = {
  newcomer: { id: "newcomer", label: "新馬", level: [33, 47], firstPrize: 700_000, conditionText: "未出走の馬" },
  maiden: { id: "maiden", label: "未勝利", level: [37, 50], firstPrize: 550_000, conditionText: "まだ勝っていない馬" },
  c1: { id: "c1", label: "1勝クラス", level: [45, 57], firstPrize: 900_000, conditionText: "1勝馬" },
  c2: { id: "c2", label: "2勝クラス", level: [52, 64], firstPrize: 1_300_000, conditionText: "2勝馬" },
  open: { id: "open", label: "オープン", level: [58, 71], firstPrize: 2_200_000, conditionText: "3勝以上" },
  stakes: { id: "stakes", label: "重賞", level: [64, 79], firstPrize: 4_500_000, conditionText: "2勝以上" },
};

/** 着順ごとの賞金の割合（1着賞金に対して）と、全頭に出る出走手当 */
export const PRIZE_RATIOS = [1, 0.4, 0.25, 0.15, 0.1];
export const APPEARANCE_FEE = 15_000;
export const FIELD_SIZE = 8;

export interface OwnerProgram {
  id: string;
  week: number;
  name: string;
  classId: ClassId;
  course: OwnerCourse;
  going: Going;
  fieldSize: number;
  firstPrize: number;
  ageMin: number;
  ageMax: number;
  conditionText: string;
  /** 重賞などの名前つきレース */
  named: boolean;
}

interface StakesDef {
  key: string;
  name: string;
  month: number;
  week: number;
  track: string;
  surface: Surface;
  distance: number;
  ageMin: number;
  ageMax: number;
  minWins: number;
}

/** 年間の重賞（すべて架空） */
export const STAKES: readonly StakesDef[] = [
  { key: "wakaba", name: "若葉ステークス", month: 4, week: 2, track: "midorigaoka", surface: "turf", distance: 1600, ageMin: 3, ageMax: 3, minWins: 1 },
  { key: "derby", name: "翠ヶ丘ダービー", month: 6, week: 1, track: "midorigaoka", surface: "turf", distance: 2400, ageMin: 3, ageMax: 3, minWins: 2 },
  { key: "sprint", name: "汐見スプリント", month: 7, week: 3, track: "shiomi", surface: "turf", distance: 1200, ageMin: 3, ageMax: 9, minWins: 2 },
  { key: "dirtcup", name: "汐見ダート大賞", month: 9, week: 2, track: "shiomi", surface: "dirt", distance: 2000, ageMin: 3, ageMax: 9, minWins: 2 },
  { key: "stayers", name: "翠ヶ丘ステイヤーズ", month: 10, week: 2, track: "midorigaoka", surface: "turf", distance: 3000, ageMin: 3, ageMax: 9, minWins: 2 },
  { key: "juvenile", name: "ジュニアカップ", month: 12, week: 1, track: "midorigaoka", surface: "turf", distance: 1600, ageMin: 2, ageMax: 2, minWins: 1 },
  { key: "kinen", name: "翠ヶ丘記念", month: 12, week: 3, track: "midorigaoka", surface: "turf", distance: 2000, ageMin: 3, ageMax: 9, minWins: 2 },
];

function goingFor(seed: number): Going {
  const rng = createRng(seed);
  const r = rng();
  return r < 0.62 ? "good" : r < 0.82 ? "yielding" : r < 0.94 ? "soft" : "heavy";
}

const PROGRAM_CLASSES: ClassId[] = ["newcomer", "maiden", "maiden", "c1", "c1", "c2", "open"];

/** その週の番組（重賞があれば重賞を含む） */
export function raceCard(week: number): OwnerProgram[] {
  const rng = createRng(hash32(`card|${week}`));
  const courses = allCourses();
  const list: OwnerProgram[] = [];
  const m = monthOf(week);
  PROGRAM_CLASSES.forEach((cls, i) => {
    if (cls === "newcomer" && (m < 6 || m > 12)) {
      rng();
      return;
    }
    const course = pick(rng, courses);
    const def = CLASS_DEFS[cls];
    list.push({
      id: `w${week}-${i + 1}`,
      week,
      name: `${course.trackName}${def.label}`,
      classId: cls,
      course,
      going: goingFor(hash32(`going|${week}|${i}`)),
      fieldSize: FIELD_SIZE,
      firstPrize: def.firstPrize,
      ageMin: 2,
      ageMax: cls === "newcomer" || cls === "maiden" ? 3 : 9,
      conditionText: def.conditionText,
      named: false,
    });
  });
  for (const s of STAKES) {
    if (s.month !== m || s.week !== weekInMonth(week)) continue;
    list.push({
      id: `w${week}-${s.key}`,
      week,
      name: s.name,
      classId: "stakes",
      course: makeCourse(s.track, s.surface, s.distance),
      going: goingFor(hash32(`going|${week}|${s.key}`)),
      fieldSize: FIELD_SIZE,
      firstPrize: CLASS_DEFS.stakes.firstPrize,
      ageMin: s.ageMin,
      ageMax: s.ageMax,
      conditionText: `${s.ageMin === s.ageMax ? `${s.ageMin}歳` : `${s.ageMin}歳以上`}・${s.minWins}勝以上`,
      named: true,
    });
  }
  return list;
}

export function findProgramById(id: string): OwnerProgram | undefined {
  const m = /^w(\d+)-/.exec(id);
  if (!m) return undefined;
  return raceCard(Number(m[1])).find((p) => p.id === id);
}

/** 今後の重賞の予定（目標レースの候補） */
export function upcomingStakes(fromWeek: number, count = 10): OwnerProgram[] {
  const out: OwnerProgram[] = [];
  for (let w = fromWeek; w < fromWeek + WEEKS_PER_YEAR * 2 && out.length < count; w++) {
    for (const p of raceCard(w)) if (p.named) out.push(p);
  }
  return out;
}

export function ownerPrizeFor(p: OwnerProgram, position: number): number {
  const r = PRIZE_RATIOS[position - 1] ?? 0;
  return Math.round(p.firstPrize * r) + APPEARANCE_FEE;
}

/** 出走条件を満たすか（理由を返す。満たせば null） */
export function programRequirement(p: OwnerProgram, h: RaceHorse, week: number): string | null {
  const ageErr = raceEligibleAge(h, week);
  if (ageErr) return ageErr;
  const age = ageAt(h, week);
  if (age < p.ageMin || age > p.ageMax) return `${p.ageMin === p.ageMax ? `${p.ageMin}歳` : `${p.ageMin}〜${p.ageMax}歳`}の馬のレースです`;
  const w = h.record.wins;
  switch (p.classId) {
    case "newcomer":
      return h.record.races === 0 ? null : "新馬戦はデビュー前の馬だけが出られます";
    case "maiden":
      return w === 0 ? (h.record.races === 0 && age === 2 && monthOf(week) < 9 ? "デビュー前の2歳馬は新馬戦から始めます" : null) : "勝ち上がった馬は出られません";
    case "c1":
      return w === 1 ? null : w < 1 ? "1勝が必要です" : "格上の馬は出られません";
    case "c2":
      return w === 2 ? null : w < 2 ? "2勝が必要です" : "格上の馬は出られません";
    case "open":
      return w >= 3 ? null : "3勝以上が必要です";
    case "stakes": {
      const s = STAKES.find((x) => p.id.endsWith(x.key));
      const need = s?.minWins ?? 2;
      return w >= need ? null : `${need}勝以上が必要です`;
    }
  }
}

/* ---------------- CPU馬 ---------------- */

const CPU_STYLES: RunningStyle[] = ["front", "stalker", "stalker", "closer", "closer", "deep"];

function cpuTraits(rng: Rng): TraitId[] {
  const out: TraitId[] = [];
  const n = randInt(rng, 0, 2);
  while (out.length < n) {
    const t = pick(rng, TRAIT_IDS);
    if (out.includes(t) || TRAIT_CONFLICTS.some(([a, b]) => (t === a && out.includes(b)) || (t === b && out.includes(a)))) continue;
    out.push(t);
  }
  return out;
}

export interface CpuEntry {
  name: string;
  runner: Omit<SimRunner, "gate">;
}

/** 番組の強さに合わせたCPU馬。多くは条件に合う馬だが、適性外の馬も混じる */
export function generateCpuEntries(p: OwnerProgram, count: number, seed: number, avoidNames: string[] = []): CpuEntry[] {
  const taken = new Set(avoidNames);
  const out: CpuEntry[] = [];
  const def = CLASS_DEFS[p.classId];
  for (let i = 0; i < count; i++) {
    const rng = createRng((seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0);
    const lvl = def.level[0] + rng() * (def.level[1] - def.level[0]);
    const abilities = {} as Abilities;
    for (const k of ABILITY_KEYS) abilities[k] = Math.max(15, Math.min(100, Math.round(lvl + gaussian(rng) * 5)));
    const traits = cpuTraits(rng);
    const apt = genAptitude(abilities, traits, rng);
    // 多くの馬は条件に合うように出てくる
    if (rng() < 0.75) {
      const D = p.course.distance;
      const w = apt.distanceMax - apt.distanceMin;
      const lo = Math.max(1000, Math.round((D - rng() * w) / 100) * 100);
      apt.distanceMin = Math.min(lo, D);
      apt.distanceMax = Math.max(apt.distanceMin + w, D);
      if (p.course.surface === "turf") apt.turf = Math.max(apt.turf, 65);
      else apt.dirt = Math.max(apt.dirt, 65);
    }
    const style = pick(rng, CPU_STYLES);
    apt.styles[style] = Math.max(apt.styles[style], 70);
    const name = generateHorseName(rng, taken);
    taken.add(name);
    const tactics: Tactics = { style, pace: "normal", spurt: rng() < 0.7 ? "normal" : rng() < 0.5 ? "early" : "late" };
    out.push({
      name,
      runner: {
        id: `cpu-${i + 1}`,
        abilities,
        aptitude: apt,
        traits,
        tactics,
        condition: randInt(rng, -1, 1),
        fatigue: randInt(rng, 0, 25),
        fitness: randInt(rng, 70, 95),
        experience: randInt(rng, 1, 12),
      },
    });
  }
  return out;
}

export { STYLE_KEYS };
