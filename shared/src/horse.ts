// 競走馬の生成・育成ルール（純粋関数）。サーバーが乱数を与えて実行し、結果をDBに保存する。

import { randInt, type Rng } from "./rng";
import {
  STAT_KEYS,
  type Aptitude,
  type Horse,
  type RunningStyle,
  type StatKey,
  type Stats,
  type TrainingMenu,
} from "./types";

export const FATIGUE_MAX = 100;
export const RACE_FATIGUE_LIMIT = 80; // これ以上は出走不可
export const INJURY_REST_COUNT = 3;
/** 競走生活の長さ（ターン数）。調教・休養・出走のたびに1進む */
export const CAREER_TURNS = 60;

/** 年齢（経過ターン）による成長のしやすさ。若いほど伸び、晩年は伸びにくい */
export function growthMultiplier(turns: number): number {
  if (turns < 15) return 1.2;
  if (turns < 40) return 1.0;
  if (turns < 50) return 0.6;
  return 0.3;
}

export function careerLeft(h: Horse): number {
  return Math.max(0, CAREER_TURNS - h.turns);
}

export interface StarterTemplate {
  id: string;
  label: string;
  description: string;
  style: RunningStyle;
  base: Stats;
  potential: Stats;
  aptitude: Aptitude;
}

export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  {
    id: "swift",
    label: "快速タイプ",
    description: "序盤から先頭を奪う逃げ馬。スピード自慢だがスタミナは控えめ。",
    style: "front",
    base: { speed: 61, stamina: 46, power: 52, guts: 46, wisdom: 48 },
    potential: { speed: 115, stamina: 90, power: 100, guts: 95, wisdom: 100 },
    aptitude: { turf: "A", dirt: "C", sprint: "A", mile: "A", middle: "C", long: "D" },
  },
  {
    id: "balanced",
    label: "万能タイプ",
    description: "好位につける先行馬。能力のバランスがよく扱いやすい。",
    style: "stalker",
    base: { speed: 54, stamina: 52, power: 52, guts: 50, wisdom: 52 },
    potential: { speed: 105, stamina: 105, power: 105, guts: 105, wisdom: 105 },
    aptitude: { turf: "A", dirt: "B", sprint: "B", mile: "A", middle: "B", long: "C" },
  },
  {
    id: "stayer",
    label: "末脚タイプ",
    description: "後方から直線で差し切る差し馬。スタミナと根性に優れる。",
    style: "closer",
    base: { speed: 52, stamina: 58, power: 49, guts: 56, wisdom: 50 },
    potential: { speed: 105, stamina: 115, power: 100, guts: 110, wisdom: 100 },
    aptitude: { turf: "A", dirt: "C", sprint: "C", mile: "A", middle: "A", long: "B" },
  },
];

export function findTemplate(id: string): StarterTemplate | undefined {
  return STARTER_TEMPLATES.find((t) => t.id === id);
}

/** テンプレートから個体差のある初期馬を作る */
export function createStarterHorse(
  template: StarterTemplate,
  ids: { id: string; ownerId: string },
  name: string,
  rng: Rng,
): Horse {
  const stats = {} as Stats;
  const potential = {} as Stats;
  for (const k of STAT_KEYS) {
    stats[k] = template.base[k] + randInt(rng, -4, 4);
    potential[k] = template.potential[k] + randInt(rng, -5, 5);
  }
  return {
    id: ids.id,
    ownerId: ids.ownerId,
    name,
    stats,
    potential,
    style: template.style,
    aptitude: { ...template.aptitude },
    fatigue: 0,
    condition: 0,
    injuryRestsLeft: 0,
    turns: 0,
    races: 0,
    wins: 0,
    totalPrize: 0,
    retired: false,
  };
}

const NAME_RE = /^[\p{Script=Katakana}\p{Script=Hiragana}\p{Script=Han}ーA-Za-z0-9・ ]+$/u;

/** 馬名の検証。問題があればエラーメッセージを返す */
export function validateHorseName(name: unknown): string | null {
  if (typeof name !== "string") return "馬名を入力してください";
  const trimmed = name.trim();
  const len = [...trimmed].length;
  if (len < 2 || len > 12) return "馬名は2〜12文字にしてください";
  if (!NAME_RE.test(trimmed)) return "馬名に使えない文字が含まれています";
  return null;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function canTrain(h: Horse): string | null {
  if (h.retired) return "引退した馬は調教できません";
  if (careerLeft(h) === 0) return "競走生活を終える時期です。引退させてください";
  if (h.injuryRestsLeft > 0) return `故障中です（あと${h.injuryRestsLeft}回の休養が必要）`;
  if (h.fatigue >= FATIGUE_MAX) return "疲労が限界です。休養させてください";
  return null;
}

export function canRace(h: Horse): string | null {
  if (h.retired) return "引退した馬は出走できません";
  if (careerLeft(h) === 0) return "競走生活を終える時期です。引退させてください";
  if (h.injuryRestsLeft > 0) return "故障中の馬は出走できません";
  if (h.fatigue >= RACE_FATIGUE_LIMIT) return `疲労が${RACE_FATIGUE_LIMIT}以上のため出走できません`;
  return null;
}

export interface TrainingResult {
  horse: Horse;
  gains: Partial<Stats>;
  fatigueDelta: number;
  conditionDelta: number;
  injured: boolean;
}

const SECONDARY: Record<StatKey, StatKey> = {
  speed: "power",
  stamina: "guts",
  power: "speed",
  guts: "stamina",
  wisdom: "speed",
};

function gainWithCap(current: number, cap: number, raw: number): number {
  if (current >= cap) return 0;
  // 上限に近づくほど伸びにくい
  const room = (cap - current) / cap;
  const scaled = raw * (0.35 + 0.65 * Math.min(1, room * 2.5));
  return Math.min(cap - current, Math.max(0, Math.round(scaled)));
}

export function applyTraining(h: Horse, menu: TrainingMenu, rng: Rng): TrainingResult {
  const err = canTrain(h);
  if (err) throw new Error(err);
  const horse: Horse = { ...h, stats: { ...h.stats }, turns: h.turns + 1 };
  const condMul = (1 + 0.1 * horse.condition) * growthMultiplier(h.turns);
  const fatigueMul = 1 - horse.fatigue / 200;
  const gains: Partial<Stats> = {};

  const main = gainWithCap(horse.stats[menu], horse.potential[menu], randInt(rng, 3, 6) * condMul * fatigueMul);
  horse.stats[menu] += main;
  gains[menu] = main;
  const sk = SECONDARY[menu];
  const sub = gainWithCap(horse.stats[sk], horse.potential[sk], randInt(rng, 0, 2) * fatigueMul);
  horse.stats[sk] += sub;
  if (sub > 0) gains[sk] = (gains[sk] ?? 0) + sub;

  const fatigueDelta = randInt(rng, 12, 18);
  horse.fatigue = clamp(horse.fatigue + fatigueDelta, 0, FATIGUE_MAX);

  let conditionDelta = 0;
  if (rng() < 0.25) conditionDelta = -1;
  else if (rng() < 0.1) conditionDelta = 1;
  horse.condition = clamp(horse.condition + conditionDelta, -2, 2);

  // 疲労70超から故障リスク（最大30%）
  const injuryChance = horse.fatigue > 70 ? Math.min(0.3, (horse.fatigue - 70) * 0.01) : 0;
  const injured = rng() < injuryChance;
  if (injured) {
    horse.injuryRestsLeft = INJURY_REST_COUNT;
    horse.condition = clamp(horse.condition - 1, -2, 2);
  }
  return { horse, gains, fatigueDelta, conditionDelta, injured };
}

export interface RestResult {
  horse: Horse;
  fatigueDelta: number;
  conditionDelta: number;
}

export function applyRest(h: Horse, rng: Rng): RestResult {
  if (h.retired) throw new Error("引退した馬は休養できません");
  const horse: Horse = { ...h, turns: h.turns + 1 };
  const before = horse.fatigue;
  horse.fatigue = clamp(horse.fatigue - 40, 0, FATIGUE_MAX);
  let conditionDelta = 0;
  if (rng() < 0.5) conditionDelta = 1;
  horse.condition = clamp(horse.condition + conditionDelta, -2, 2);
  if (horse.injuryRestsLeft > 0) horse.injuryRestsLeft -= 1;
  return { horse, fatigueDelta: horse.fatigue - before, conditionDelta: horse.condition - h.condition };
}

/** レース後の状態変化 */
export function applyRaceAftermath(h: Horse, position: number, prize: number, rng: Rng): Horse {
  const horse: Horse = { ...h, turns: h.turns + 1 };
  horse.fatigue = clamp(horse.fatigue + randInt(rng, 22, 30), 0, FATIGUE_MAX);
  const r = rng();
  const delta = position === 1 ? (r < 0.5 ? 1 : 0) : r < 0.3 ? -1 : r < 0.45 ? 1 : 0;
  horse.condition = clamp(horse.condition + delta, -2, 2);
  horse.races += 1;
  if (position === 1) horse.wins += 1;
  horse.totalPrize += prize;
  return horse;
}
