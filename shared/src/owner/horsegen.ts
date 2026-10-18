// 馬の生成（販売馬・初期馬・CPU馬）
import { gaussian, pick, randInt, type Rng } from "../rng";
import type { RunningStyle } from "../types";
import { WEEKS_PER_YEAR, yearOf } from "./calendar";
import { initialAbilities } from "./growth";
import { emptyKnowledge } from "./knowledge";
import {
  ABILITY_KEYS,
  STYLE_KEYS,
  TRAIT_CONFLICTS,
  TRAIT_IDS,
  type Abilities,
  type GrowthType,
  type HorseTruth,
  type RaceHorse,
  type TraitId,
  type TrueAptitude,
} from "./model";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round100 = (v: number) => Math.round(v / 100) * 100;

export interface GenQuality {
  /** 成長上限の平均とばらつき */
  potMean: number;
  potSd: number;
}

function genPotential(q: GenQuality, rng: Rng): Abilities {
  const base = q.potMean + gaussian(rng) * q.potSd;
  const out = {} as Abilities;
  for (const k of ABILITY_KEYS) out[k] = Math.round(clamp(base + gaussian(rng) * 9, 22, 100));
  return out;
}

function genTraits(rng: Rng): TraitId[] {
  const count = randInt(rng, 2, 4);
  const out: TraitId[] = [];
  let guard = 0;
  while (out.length < count && guard++ < 50) {
    const t = pick(rng, TRAIT_IDS);
    if (out.includes(t)) continue;
    if (TRAIT_CONFLICTS.some(([a, b]) => (t === a && out.includes(b)) || (t === b && out.includes(a)))) continue;
    out.push(t);
  }
  return out;
}

/** 能力の形・個性から自然な適性を作る */
export function genAptitude(pot: Abilities, traits: TraitId[], rng: Rng): TrueAptitude {
  // スタミナ寄りなら長め、スピード寄りなら短め
  const lean = pot.stamina - (pot.speed + pot.acceleration) / 2;
  const center = clamp(round100(1750 + lean * 22 + gaussian(rng) * 260), 1100, 2900);
  const width = pick(rng, [300, 400, 400, 500, 600, 800]);
  const distanceMin = clamp(round100(center - width / 2), 1000, 3000);
  const distanceMax = clamp(round100(center + width / 2), distanceMin + 200, 3200);
  const turfFirst = rng() < 0.62;
  const good = clamp(Math.round(72 + gaussian(rng) * 12), 35, 100);
  const other = clamp(Math.round(48 + gaussian(rng) * 20), 0, 100);
  const powerLean = (pot.power - 60) * 0.4;
  let primary: RunningStyle;
  if (traits.includes("frontObsessed")) primary = "front";
  else if (traits.includes("closerKick")) primary = rng() < 0.6 ? "closer" : "deep";
  else {
    const r = rng();
    primary = r < 0.2 ? "front" : r < 0.55 ? "stalker" : r < 0.85 ? "closer" : "deep";
  }
  const idx = STYLE_KEYS.indexOf(primary);
  const styles = {} as Record<RunningStyle, number>;
  STYLE_KEYS.forEach((s, i) => {
    const dist = Math.abs(i - idx);
    styles[s] = clamp(Math.round([88, 66, 42, 25][dist] + gaussian(rng) * 6), 0, 100);
  });
  return {
    distanceMin,
    distanceMax,
    turf: turfFirst ? good : other,
    dirt: turfFirst ? other : good,
    heavy: clamp(Math.round(50 + powerLean + gaussian(rng) * 18), 0, 100),
    right: clamp(Math.round(58 + gaussian(rng) * 16), 0, 100),
    left: clamp(Math.round(58 + gaussian(rng) * 16), 0, 100),
    slope: clamp(Math.round(52 + powerLean * 0.8 + gaussian(rng) * 15), 0, 100),
    tight: clamp(Math.round(52 + (pot.acceleration - 60) * 0.3 + gaussian(rng) * 15), 0, 100),
    styles,
  };
}

function genGrowthType(rng: Rng): GrowthType {
  const r = rng();
  return r < 0.28 ? "early" : r < 0.75 ? "normal" : "late";
}

export function genTruth(q: GenQuality, weeksFromBirth: number, rng: Rng): HorseTruth {
  const potential = genPotential(q, rng);
  const growthType = genGrowthType(rng);
  const traits = genTraits(rng);
  const devLevel = clamp(0.2 + weeksFromBirth / (WEEKS_PER_YEAR * 6), 0.2, 0.55);
  const development = {} as Abilities;
  for (const k of ABILITY_KEYS) development[k] = devLevel;
  return {
    abilities: initialAbilities(potential, growthType, weeksFromBirth, devLevel),
    potential,
    growthType,
    development,
    aptitude: genAptitude(potential, traits, rng),
    traits,
    biasSeed: Math.floor(rng() * 2 ** 32) >>> 0,
    growthLog: [],
  };
}

export interface NewHorseOptions {
  id: string;
  name: string;
  ownerId: string;
  trainerId: string;
  /** 現在のゲーム週 */
  week: number;
  /** 何歳の馬か */
  age: number;
  quality: GenQuality;
  purchasePrice: number;
  sireName?: string | null;
  damName?: string | null;
}

export function createRaceHorse(o: NewHorseOptions, rng: Rng): RaceHorse {
  const birthYear = yearOf(o.week) - o.age;
  const weeksFromBirth = o.week - (birthYear - 1) * WEEKS_PER_YEAR;
  return {
    id: o.id,
    name: o.name,
    ownerId: o.ownerId,
    birthYear,
    sireId: null,
    damId: null,
    sireName: o.sireName ?? null,
    damName: o.damName ?? null,
    trainerId: o.trainerId,
    relationship: 60,
    truth: genTruth(o.quality, weeksFromBirth, rng),
    state: { fatigue: 0, condition: 0, health: 85, fitness: o.age >= 2 ? 30 : 10, injuryWeeks: 0, experience: 0 },
    policy: { policy: o.age >= 2 ? "earlyDebut" : "growth", mode: "follow", goalRaceId: null },
    knowledge: emptyKnowledge(),
    record: { races: 0, wins: 0, seconds: 0, thirds: 0, totalPrize: 0, lastRaceWeek: null },
    racedWeek: null,
    status: "active",
    purchasePrice: o.purchasePrice,
    acquiredWeek: o.week,
    log: [],
  };
}

/* 架空の血統名（父・母）。将来の繁殖機能までは表示用 */
const SIRE_NAMES = ["ミドリノオウ", "ハヤテライン", "シロガネボルト", "トキノカンムリ", "ナギサキング", "ソラノコテイ", "アオバレジェンド", "ホクトスピア"];
const DAM_NAMES = ["ユメノシズク", "サクラノウタ", "ハルカゼレディ", "ミナトノヒメ", "コハクノツキ", "ヨアケノハナ", "アカネグレース", "シオサイローズ"];

export function genPedigree(rng: Rng): { sireName: string; damName: string } {
  return { sireName: pick(rng, SIRE_NAMES), damName: pick(rng, DAM_NAMES) };
}
