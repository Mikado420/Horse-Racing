// 馬主モードのゲーム進行（純粋関数）。セーブデータと乱数シードを受け取り、新しいセーブデータを返す。
// 画面・保存先（localStorage や将来のサーバーDB）には依存しない。
import { createRng, gaussian, pick, randInt, type Rng } from "../rng";
import { generateHorseName } from "../names";
import type { Going } from "../types";
import { truthValue, bandForDistance } from "./aptitude";
import { ageAt, monthOf, RETIRE_AGE, WEEKS_PER_YEAR, weekLabel } from "./calendar";
import { DEFAULT_CONFIG, type GameConfig } from "./config";
import { courseLabel } from "./courses";
import { createRaceHorse, genPedigree } from "./horsegen";
import { addEvidence, compactKnowledge, hash32, makeEvidence, recordTraitSign, viewEntry } from "./knowledge";
import {
  ABILITY_KEYS,
  POLICY_DEFS,
  STYLE_KEYS,
  type Evidence,
  type HorseLogEntry,
  type HorsePolicy,
  type KnowledgeKey,
  type RaceHorse,
} from "./model";
import { analysisPlan, raceTraitChecks, raceTraitSignChance, trainerRacePlan, type FieldRow, type OwnerRaceRecord } from "./analysis";
import {
  CLASS_DEFS,
  findProgramById,
  generateCpuEntries,
  ownerPrizeFor,
  programRequirement,
  raceCard,
  type OwnerProgram,
} from "./racecard";
import { simulateOwnerRace, PACE_LABELS, SPURT_LABELS, type SimResult, type SimRunner, type Tactics } from "./sim";
import { runStableWeek, type WeeklyReport } from "./stable";
import { findTrainer, skillScale, TRAINERS, type Trainer } from "./trainers";
import { STYLE_LABELS } from "../types";
import { formatRaceTime, marginLabel } from "../race";

export const OWNER_SAVE_VERSION = 2;
export const LOCAL_OWNER_ID = "local-player";
export const START_MONEY = 3_000_000;
export const MAX_ACTIVE = 6;
export const MARKET_REFRESH_WEEKS = 4;
export const OWNER_RACE_FATIGUE_LIMIT = 75;
export const REPORT_LIMIT = 160;
export const RACE_HISTORY_LIMIT = 400;
export const FINANCE_LIMIT = 300;

export class OwnerGameError extends Error {}
const fail = (m: string): never => {
  throw new OwnerGameError(m);
};

export interface OwnerProfile {
  id: string;
  username: string;
  money: number;
  totalPrize: number;
  races: number;
  wins: number;
}

export interface FinanceEntry {
  week: number;
  amount: number;
  note: string;
}

export interface OwnerMarketOffer {
  offerId: string;
  price: number;
  age: number;
  /** 販売中の馬（購入時に ID と所有者・厩舎が決まる） */
  horse: RaceHorse;
}

export interface OwnerSave {
  version: typeof OWNER_SAVE_VERSION;
  createdAt: string;
  updatedAt: string;
  player: OwnerProfile;
  /** ゲーム内の週（0 = 1年目1月第1週） */
  week: number;
  horses: RaceHorse[];
  races: OwnerRaceRecord[];
  /** 厩舎からの報告（新しい順） */
  reports: WeeklyReport[];
  market: { offers: OwnerMarketOffer[]; refreshedWeek: number };
  /** 最初の1頭の候補（選ぶまで） */
  starterOffers: OwnerMarketOffer[] | null;
  finance: FinanceEntry[];
  counters: { horseSeq: number; raceSeq: number };
}

/* ---------------- 共通 ---------------- */

function touch(s: OwnerSave, now: Date): OwnerSave {
  return { ...s, updatedAt: now.toISOString() };
}
export function activeHorses(s: OwnerSave): RaceHorse[] {
  return s.horses.filter((h) => h.status === "active");
}
export function findHorse(s: OwnerSave, id: string): RaceHorse {
  return s.horses.find((h) => h.id === id) ?? fail("馬が見つかりません");
}
function replaceHorse(s: OwnerSave, h: RaceHorse): RaceHorse[] {
  return s.horses.map((x) => (x.id === h.id ? h : x));
}
function trainerOf(h: RaceHorse): Trainer {
  return findTrainer(h.trainerId) ?? fail("調教師が見つかりません");
}
function addLog(h: RaceHorse, entries: HorseLogEntry[]): RaceHorse {
  return { ...h, log: [...h.log, ...entries].slice(-260) };
}
function money(s: OwnerSave, amount: number, note: string): Pick<OwnerSave, "player" | "finance"> {
  return {
    player: { ...s.player, money: s.player.money + amount },
    finance: [...s.finance, { week: s.week, amount, note }].slice(-FINANCE_LIMIT),
  };
}

export function validateOwnerName(name: unknown): string | null {
  if (typeof name !== "string") return "名前を入力してください";
  const len = [...name.trim()].length;
  if (len < 1 || len > 12) return "名前は1〜12文字にしてください";
  return null;
}

const NAME_RE = /^[\p{Script=Katakana}\p{Script=Hiragana}\p{Script=Han}ーA-Za-z0-9・ ]+$/u;
export function validateRaceHorseName(name: unknown): string | null {
  if (typeof name !== "string") return "馬名を入力してください";
  const t = name.trim();
  const len = [...t].length;
  if (len < 2 || len > 12) return "馬名は2〜12文字にしてください";
  if (!NAME_RE.test(t)) return "馬名に使えない文字が含まれています";
  return null;
}

/* ---------------- 馬の販売 ---------------- */

/** 販売価格。成長上限が高いほど高いが、ばらつきが大きく価格だけでは才能は分からない */
function offerPrice(h: RaceHorse, age: number, rng: Rng): number {
  const pot = ABILITY_KEYS.reduce((a, k) => a + h.truth.potential[k], 0) / ABILITY_KEYS.length;
  const base = 260_000 * Math.exp((pot - 58) / 10);
  const ageMul = age === 0 ? 0.7 : age === 1 ? 0.9 : 1.15;
  const noise = Math.exp(gaussian(rng) * 0.4);
  return Math.max(100_000, Math.round((base * ageMul * noise) / 10_000) * 10_000);
}

/** 下見（販売資料）の証拠：いくつかの能力について粗い見立てがつく */
function inspect(h: RaceHorse, week: number, src: string, rng: Rng, cfg: GameConfig): RaceHorse {
  const keys = [...ABILITY_KEYS].sort(() => rng() - 0.5).slice(0, randInt(rng, 2, 4));
  const items = keys.map((key) => ({
    key: key as KnowledgeKey,
    evidence: makeEvidence({ key, kind: "saleInspection", src, trueValue: h.truth.abilities[key], skillScale: 1 }, h.truth.biasSeed, week, rng, cfg),
  }));
  return { ...h, knowledge: addEvidence(h.knowledge, items, week, "販売時の下見", cfg) };
}

function makeOffer(week: number, age: number, potMean: number, seed: number, taken: Set<string>, cfg: GameConfig, fixedPrice?: number): OwnerMarketOffer {
  const rng = createRng(seed);
  const name = generateHorseName(rng, taken);
  taken.add(name);
  const offerId = `o${seed.toString(36)}`;
  const ped = genPedigree(rng);
  let horse = createRaceHorse(
    {
      id: offerId,
      name,
      ownerId: "market",
      trainerId: TRAINERS[0].id,
      week,
      age,
      quality: { potMean, potSd: 7 },
      purchasePrice: 0,
      ...ped,
    },
    rng,
  );
  horse = inspect(horse, week, `sale:${offerId}`, rng, cfg);
  const price = fixedPrice ?? offerPrice(horse, age, rng);
  return { offerId, price, age, horse: { ...horse, purchasePrice: price } };
}

export function generateOwnerMarket(week: number, seed: number, avoidNames: string[] = [], cfg: GameConfig = DEFAULT_CONFIG): OwnerMarketOffer[] {
  const rng = createRng(seed);
  const taken = new Set(avoidNames);
  const ages = [0, 1, 1, 2, 2];
  return ages.map((age) => makeOffer(week, age, 50 + rng() * 26, (rng() * 2 ** 32) >>> 0, taken, cfg));
}

/* ---------------- 開始 ---------------- */

export function newOwnerGame(ownerName: string, seed: number, now = new Date(), cfg: GameConfig = DEFAULT_CONFIG): OwnerSave {
  const err = validateOwnerName(ownerName);
  if (err) fail(err);
  const rng = createRng(seed);
  const taken = new Set<string>();
  const starterOffers = [0, 1, 2].map(() => makeOffer(0, 1, 60, (rng() * 2 ** 32) >>> 0, taken, cfg, 0));
  return {
    version: OWNER_SAVE_VERSION,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    player: { id: LOCAL_OWNER_ID, username: ownerName.trim(), money: START_MONEY, totalPrize: 0, races: 0, wins: 0 },
    week: 0,
    horses: [],
    races: [],
    reports: [],
    market: { offers: generateOwnerMarket(0, (rng() * 2 ** 32) >>> 0, [...taken], cfg), refreshedWeek: 0 },
    starterOffers,
    finance: [{ week: 0, amount: START_MONEY, note: "開業資金" }],
    counters: { horseSeq: 0, raceSeq: 0 },
  };
}

function adopt(s: OwnerSave, offer: OwnerMarketOffer, trainerId: string, name: string | null, note: string): { horses: RaceHorse[]; horse: RaceHorse; counters: OwnerSave["counters"] } {
  if (!findTrainer(trainerId)) fail("預託先の調教師を選んでください");
  const id = `h${s.counters.horseSeq + 1}`;
  const finalName = name?.trim() || offer.horse.name;
  if (name) {
    const e = validateRaceHorseName(name);
    if (e) fail(e);
  }
  if (s.horses.some((h) => h.name === finalName && h.status === "active")) fail("同じ名前の馬がすでにいます");
  const horse: RaceHorse = addLog(
    { ...offer.horse, id, name: finalName, ownerId: LOCAL_OWNER_ID, trainerId, relationship: 60, acquiredWeek: s.week },
    [{ week: s.week, kind: "owner", text: `${note}。${findTrainer(trainerId)!.name}厩舎に預けた。` }],
  );
  return { horses: [...s.horses, horse], horse, counters: { ...s.counters, horseSeq: s.counters.horseSeq + 1 } };
}

export function chooseStarter(s: OwnerSave, offerId: string, trainerId: string, name: string | null, now = new Date()): OwnerSave {
  if (!s.starterOffers) fail("最初の1頭はすでに選んでいます");
  const offer = s.starterOffers!.find((o) => o.offerId === offerId) ?? fail("候補が見つかりません");
  const r = adopt(s, offer, trainerId, name, "最初の1頭として迎えた");
  return touch({ ...s, horses: r.horses, counters: r.counters, starterOffers: null }, now);
}

export function buyHorse(s: OwnerSave, offerId: string, trainerId: string, name: string | null, now = new Date()): { save: OwnerSave; horse: RaceHorse } {
  const offer = s.market.offers.find((o) => o.offerId === offerId) ?? fail("この馬はもう販売されていません");
  if (activeHorses(s).length >= MAX_ACTIVE) fail(`所有できるのは${MAX_ACTIVE}頭までです。売却か引退で空きを作ってください`);
  if (s.player.money < offer.price) fail("所持金が足りません");
  const r = adopt(s, offer, trainerId, name, `${offer.price.toLocaleString("ja-JP")}円で購入`);
  const m = money(s, -offer.price, `${r.horse.name}を購入`);
  const save = touch(
    {
      ...s,
      ...m,
      horses: r.horses,
      counters: r.counters,
      market: { ...s.market, offers: s.market.offers.filter((o) => o.offerId !== offerId) },
    },
    now,
  );
  return { save, horse: r.horse };
}

/* ---------------- 馬主の指示 ---------------- */

export function setPolicy(s: OwnerSave, horseId: string, patch: Partial<HorsePolicy>, now = new Date()): OwnerSave {
  const h = findHorse(s, horseId);
  if (h.status !== "active") fail("現役の馬ではありません");
  if (patch.policy && !(patch.policy in POLICY_DEFS)) fail("方針が正しくありません");
  if (patch.goalRaceId) {
    const p = findProgramById(patch.goalRaceId);
    if (!p || !p.named || p.week < s.week) fail("目標レースが正しくありません");
  }
  const policy: HorsePolicy = { ...h.policy, ...patch };
  const changes: string[] = [];
  if (patch.policy && patch.policy !== h.policy.policy) changes.push(`育成方針を「${POLICY_DEFS[patch.policy].label}」に`);
  if (patch.mode && patch.mode !== h.policy.mode) changes.push(patch.mode === "insist" ? "方針を優先させるように" : "調教師の提案に従うように");
  if (patch.goalRaceId !== undefined && patch.goalRaceId !== h.policy.goalRaceId) {
    changes.push(patch.goalRaceId ? `目標を「${findProgramById(patch.goalRaceId)!.name}」に` : "目標レースを取り消しに");
  }
  const next = changes.length ? addLog({ ...h, policy }, [{ week: s.week, kind: "owner", text: `${changes.join("、")}した。` }]) : { ...h, policy };
  return touch({ ...s, horses: replaceHorse(s, next) }, now);
}

/** 転厩（預託先の変更）。手続き費用がかかり、新しい厩舎との関係は一から */
export function transferHorse(s: OwnerSave, horseId: string, trainerId: string, now = new Date()): OwnerSave {
  const h = findHorse(s, horseId);
  if (h.status !== "active") fail("現役の馬ではありません");
  if (h.trainerId === trainerId) fail("すでにこの厩舎に預けています");
  const t = findTrainer(trainerId) ?? fail("調教師が見つかりません");
  const fee = transferFee(t);
  if (s.player.money < fee) fail("転厩の手続き費用が足りません");
  const next = addLog({ ...h, trainerId, relationship: 55 }, [
    { week: s.week, kind: "owner", text: `${trainerOf(h).name}厩舎から${t.name}厩舎へ転厩した。` },
  ]);
  return touch({ ...s, ...money(s, -fee, `${h.name}の転厩手続き`), horses: replaceHorse(s, next) }, now);
}
export function transferFee(t: Trainer): number {
  return t.weeklyFee * 3;
}

/** 預託料（週）。0〜1歳は牧場での育成なので半額 */
export function weeklyFeeFor(h: RaceHorse, week: number): number {
  const t = findTrainer(h.trainerId);
  if (!t) return 0;
  return ageAt(h, week) <= 1 ? Math.round(t.weeklyFee / 2) : t.weeklyFee;
}

/* ---------------- 週を進める ---------------- */

export interface AdvanceResult {
  save: OwnerSave;
  reports: WeeklyReport[];
  notices: string[];
}

export function advanceWeek(s: OwnerSave, seed: number, now = new Date(), cfg: GameConfig = DEFAULT_CONFIG): AdvanceResult {
  if (s.starterOffers) fail("最初の1頭を選んでください");
  const rng = createRng(seed);
  const week = s.week;
  const reports: WeeklyReport[] = [];
  const notices: string[] = [];
  let horses = s.horses;
  let fees = 0;
  let feeCount = 0;
  for (const h of [...activeHorses(s)].sort((a, b) => a.id.localeCompare(b.id))) {
    const goal = h.policy.goalRaceId ? findProgramById(h.policy.goalRaceId) : undefined;
    const goalWeeksAway = goal && goal.week >= week ? goal.week - week : null;
    const out = runStableWeek(h, trainerOf(h), week, rng, goalWeeksAway, cfg);
    let next = out.horse;
    if (goal && goal.week < week) next = { ...next, policy: { ...next.policy, goalRaceId: null } };
    horses = horses.map((x) => (x.id === next.id ? next : x));
    reports.push(out.report);
    fees += weeklyFeeFor(h, week);
    feeCount++;
  }
  let save: OwnerSave = { ...s, horses, week: week + 1 };
  if (fees > 0) save = { ...save, ...money(save, -fees, `預託料（${feeCount}頭・${weekLabel(week)}）`) };

  // 年が変わったら、競走年齢を過ぎた馬を引退させる
  if ((week + 1) % WEEKS_PER_YEAR === 0) {
    for (const h of activeHorses(save)) {
      if (ageAt(h, week + 1) > RETIRE_AGE) {
        const r = retireHorse(save, h.id, now, "競走年齢の上限に達したため");
        save = r.save;
        notices.push(`${h.name}が引退しました（報奨金 ${r.bonus.toLocaleString("ja-JP")}円）。`);
      }
    }
  }
  // 販売馬の入れ替え
  if (save.week - save.market.refreshedWeek >= MARKET_REFRESH_WEEKS) {
    save = {
      ...save,
      market: { offers: generateOwnerMarket(save.week, (rng() * 2 ** 32) >>> 0, save.horses.map((h) => h.name), cfg), refreshedWeek: save.week },
    };
    notices.push("販売馬が入れ替わりました。");
  }
  if (save.player.money < 0) notices.push("所持金がマイナスです。馬の売却や出走で資金を立て直してください。");
  save = { ...save, reports: [...reports, ...s.reports].slice(0, REPORT_LIMIT) };
  return { save: touch(save, now), reports, notices };
}

/* ---------------- 出走 ---------------- */

export function thisWeekCard(s: OwnerSave): OwnerProgram[] {
  return raceCard(s.week);
}

/** 出走できない理由（なければ null） */
export function entryProblem(s: OwnerSave, h: RaceHorse, p: OwnerProgram): string | null {
  if (h.status !== "active") return "現役の馬ではありません";
  if (p.week !== s.week) return "今週のレースではありません";
  if (h.racedWeek === s.week) return "今週はすでに出走しました";
  if (h.state.injuryWeeks > 0) return "故障の治療中です";
  if (h.state.fatigue >= OWNER_RACE_FATIGUE_LIMIT) return `疲労が${OWNER_RACE_FATIGUE_LIMIT}以上のため出走できません`;
  return programRequirement(p, h, s.week);
}

export type Stance = "推奨" | "賛成" | "慎重" | "反対";
export interface TrainerOpinion {
  stance: Stance;
  reasons: string[];
  suggestedTactics: Tactics;
}

/** 推定のうち最も合っていそうな脚質（未検証なら先行） */
export function suggestedStyle(h: RaceHorse): Tactics["style"] {
  let best: Tactics["style"] = "stalker";
  let bestV = -1;
  for (const st of STYLE_KEYS) {
    const v = h.knowledge.entries[`style_${st}` as KnowledgeKey].estimatedValue;
    if (v !== null && v > bestV) {
      bestV = v;
      best = st;
    }
  }
  return best;
}

/**
 * 調教師の出走に対する意見。判断材料は「推定」と「状態」だけで、真の能力値は使わない。
 */
export function trainerOpinion(s: OwnerSave, horseId: string, programId: string): TrainerOpinion {
  const h = findHorse(s, horseId);
  const p = findProgramById(programId) ?? fail("レースが見つかりません");
  const reasons: string[] = [];
  let score = 0;
  const st = h.state;
  if (st.fatigue >= 55) {
    reasons.push("疲れが残っていて、本来の走りは難しい");
    score -= 3;
  } else if (st.fatigue >= 35) {
    reasons.push("少し疲れが残っている");
    score -= 1;
  }
  if (st.fitness < 50) {
    reasons.push("まだ仕上がり途上");
    score -= 2;
  } else if (st.fitness >= 75) {
    reasons.push("仕上がりは良好");
    score += 1;
  }
  if (st.condition <= -1) {
    reasons.push("調子が落ちている");
    score -= 1;
  } else if (st.condition >= 1) {
    reasons.push("調子が良い");
    score += 1;
  }
  if (st.health < 45) {
    reasons.push("健康面に不安がある");
    score -= 2;
  }
  // 適性（推定）
  const band = bandForDistance(p.course.distance);
  const bv = viewEntry(band.key, h.knowledge.entries[band.key], s.week);
  const sk: KnowledgeKey = p.course.surface === "turf" ? "surface_turf" : "surface_dirt";
  const sv = viewEntry(sk, h.knowledge.entries[sk], s.week);
  for (const v of [bv, sv]) {
    const est = h.knowledge.entries[v.key].estimatedValue;
    if (v.unverified) reasons.push(`${v.label.replace(/（.*）/, "")}は未検証${est !== null && est < 45 ? "で、合わない印象もある" : "。試してみる価値はある"}`);
    else if (est !== null && est < 40) {
      reasons.push(`${v.label.replace(/（.*）/, "")}は合っていない見立て`);
      score -= 2;
    } else if (est !== null && est >= 70) {
      reasons.push(`${v.label.replace(/（.*）/, "")}は合っている見立て`);
      score += 1;
    }
  }
  // 相手関係（推定した能力の平均と、クラスの水準を比べる）
  const ests = ABILITY_KEYS.map((k) => h.knowledge.entries[k].estimatedValue).filter((v): v is number => v !== null);
  if (ests.length >= 3) {
    const avg = ests.reduce((a, b) => a + b, 0) / ests.length;
    const [lo, hi] = CLASS_DEFS[p.classId].level;
    if (avg < lo - 3) {
      reasons.push("今の見立てでは相手関係が厳しい");
      score -= 2;
    } else if (avg > (lo + hi) / 2 + 2) {
      reasons.push("このクラスなら能力は足りていそう");
      score += 1;
    }
  } else reasons.push("能力の見立てがまだ固まっていない");
  if (ageAt(h, s.week) === 2 && p.course.distance >= 2200) {
    reasons.push("2歳馬には長い距離");
    score -= 1;
  }
  const stance: Stance = score >= 2 ? "推奨" : score >= 0 ? "賛成" : score >= -2 ? "慎重" : "反対";
  return { stance, reasons, suggestedTactics: { style: suggestedStyle(h), pace: "normal", spurt: "normal" } };
}

export interface RaceReplay {
  raceId: string;
  courseName: string;
  distance: number;
  surface: string;
  going: Going;
  weather: "sunny" | "cloudy" | "rain";
  runners: { gate: number; playerId: string; playerName: string; horseId: string; horseName: string; style: string }[];
  frames: number[][];
  lanes: number[][];
  sampleDt: number;
  durationSec: number;
  finishOrder: number[];
  course: OwnerProgram["course"];
}

export interface OwnerRaceOutcome {
  save: OwnerSave;
  record: OwnerRaceRecord;
  replay: RaceReplay;
  opinion: TrainerOpinion;
  injured: boolean;
}

function weatherFor(going: Going, seed: number): RaceReplay["weather"] {
  if (going === "good") return createRng(seed)() < 0.6 ? "sunny" : "cloudy";
  return going === "yielding" ? "cloudy" : "rain";
}

/** 出走馬（自分の馬1頭 + CPU）を組み立ててレースを計算する。セーブは変えない */
export function computeOwnerRace(h: RaceHorse, p: OwnerProgram, tactics: Tactics, seed: number, ownerName: string, avoidNames: string[], cfg: GameConfig = DEFAULT_CONFIG) {
  const rng = createRng(seed);
  const myGate = 1 + Math.floor(rng() * p.fieldSize);
  const cpus = generateCpuEntries(p, p.fieldSize - 1, (seed ^ 0x2545f491) >>> 0, avoidNames);
  const runners: SimRunner[] = [];
  const names = new Map<string, { name: string; owner: string; mine: boolean }>();
  let ci = 0;
  for (let gate = 1; gate <= p.fieldSize; gate++) {
    if (gate === myGate) {
      runners.push({
        id: h.id,
        gate,
        abilities: h.truth.abilities,
        aptitude: h.truth.aptitude,
        traits: h.truth.traits,
        tactics,
        condition: h.state.condition,
        fatigue: h.state.fatigue,
        fitness: h.state.fitness,
        experience: h.record.races,
      });
      names.set(h.id, { name: h.name, owner: ownerName, mine: true });
    } else {
      const c = cpus[ci++];
      runners.push({ ...c.runner, gate });
      names.set(c.runner.id, { name: c.name, owner: "CPU厩舎", mine: false });
    }
  }
  const sim = simulateOwnerRace(runners, { course: p.course, going: p.going }, seed, cfg);
  return { sim, runners, names };
}

function buildRecord(
  raceId: string,
  p: OwnerProgram,
  h: RaceHorse,
  tactics: Tactics,
  sim: SimResult,
  names: Map<string, { name: string; mine: boolean }>,
  prize: number,
): OwnerRaceRecord {
  const mine = sim.results.find((r) => r.id === h.id)!;
  const winner = sim.results[0];
  const second = sim.results[1];
  const field: FieldRow[] = sim.results.map((r) => ({
    gate: r.gate,
    name: names.get(r.id)!.name,
    isMine: r.id === h.id,
    position: r.position,
    timeMs: r.timeMs,
    marginLengths: r.marginLengths,
    last600: sim.telemetry[r.id].last600,
    styleShown: sim.telemetry[r.id].styleShown,
  }));
  const toWinner = mine.position === 1 ? -(second ? second.marginLengths : 0) : ((mine.timeMs - winner.timeMs) / 1000) * 16.5 / 2.4;
  return {
    raceId,
    programId: p.id,
    programName: p.name,
    classId: p.classId,
    week: p.week,
    course: p.course,
    going: p.going,
    horseId: h.id,
    horseName: h.name,
    trainerId: h.trainerId,
    tactics,
    position: mine.position,
    fieldSize: p.fieldSize,
    timeMs: mine.timeMs,
    marginToWinner: Math.round(toWinner * 100) / 100,
    prize,
    field,
    telemetry: sim.telemetry[h.id],
    leaderLaps: sim.leaderLaps,
    trainerComment: "",
    analyzed: false,
  };
}

function trainerRaceComment(r: OwnerRaceRecord, t: Trainer, opinion: TrainerOpinion): string {
  const tel = r.telemetry;
  const parts: string[] = [];
  if (r.position === 1) parts.push("よく頑張ってくれました");
  else if (r.position <= 3) parts.push("上位争いができたのは収穫です");
  else {
    const m = marginLabel(Math.max(0, r.marginToWinner));
    parts.push(`${m.endsWith("差") ? m : `${m}差`}の${r.position}着でした`);
  }
  if (tel.blockedSec >= 3) parts.push("直線で前が詰まる不利がありました");
  if (tel.emptyRemain !== null) parts.push(`残り${tel.emptyRemain}mあたりで脚が上がっています`);
  if (tel.keenSec >= 4) parts.push("道中で行きたがって力みました");
  if (tel.extraMeters >= 8) parts.push("外を回らされる形になりました");
  if (opinion.stance === "反対") parts.push("やはり今回は無理をさせたと思います");
  return `${t.name}調教師「${parts.join("。")}。」`;
}

export function runOwnerRace(
  s: OwnerSave,
  horseId: string,
  programId: string,
  tactics: Tactics,
  seed: number,
  now = new Date(),
  cfg: GameConfig = DEFAULT_CONFIG,
): OwnerRaceOutcome {
  const h0 = findHorse(s, horseId);
  const p = findProgramById(programId) ?? fail("レースが見つかりません");
  const problem = entryProblem(s, h0, p);
  if (problem) fail(problem);
  if (!STYLE_KEYS.includes(tactics.style) || !(tactics.pace in PACE_LABELS) || !(tactics.spurt in SPURT_LABELS)) fail("作戦が正しくありません");
  const opinion = trainerOpinion(s, horseId, programId);
  const trainer = trainerOf(h0);
  const { sim, runners, names } = computeOwnerRace(h0, p, tactics, seed, s.player.username, s.horses.map((x) => x.name), cfg);
  const mine = sim.results.find((r) => r.id === h0.id)!;
  const prize = ownerPrizeFor(p, mine.position);
  const raceSeq = s.counters.raceSeq + 1;
  const raceId = `r${raceSeq}`;
  const record = buildRecord(raceId, p, h0, tactics, sim, names, prize);
  record.trainerComment = trainerRaceComment(record, trainer, opinion);

  // レース後の状態（真の情報と状態）
  const rng = createRng((seed ^ 0x5bd1e995) >>> 0);
  const D = p.course.distance;
  const stt = { ...h0.state };
  const fatigueBefore = stt.fatigue;
  stt.fatigue = Math.min(100, Math.round(stt.fatigue + 16 + (D / 200) * 1.3 + (record.telemetry.emptyRemain !== null ? 6 : 0)));
  stt.health = Math.max(0, Math.round(stt.health - (2 + (D >= 2400 ? 2 : 0))));
  stt.fitness = Math.max(0, stt.fitness - 4);
  const rc = rng();
  stt.condition = Math.max(-2, Math.min(2, stt.condition + (mine.position === 1 ? (rc < 0.5 ? 1 : 0) : rc < 0.25 ? -1 : rc > 0.85 ? 1 : 0)));
  stt.experience = Math.round((stt.experience + 1) * 100) / 100;
  const injured = rng() < 0.004 + Math.max(0, fatigueBefore - 55) * 0.004;
  if (injured) {
    stt.injuryWeeks = randInt(rng, 6, 14);
    stt.health = Math.max(0, stt.health - 15);
    stt.condition = Math.max(-2, stt.condition - 1);
  }
  const truth = {
    ...h0.truth,
    abilities: {
      ...h0.truth.abilities,
      raceSense: Math.round((h0.truth.abilities.raceSense + Math.max(0, (h0.truth.potential.raceSense - h0.truth.abilities.raceSense) * 0.02)) * 100) / 100,
    },
  };

  // 調教師のレース後の見立て（推定の更新）
  const label = `${trainer.name}調教師のレース評`;
  const items: { key: KnowledgeKey; evidence: Evidence }[] = trainerRacePlan(record).map((it) => ({
    key: it.key,
    evidence: makeEvidence(
      { key: it.key, kind: "raceTrainer", src: `trainer:${trainer.id}:race`, trueValue: truthValue(truth, it.key, cfg), skillScale: skillScale(trainer, it.key), infoScale: it.infoScale, ref: raceId },
      truth.biasSeed,
      s.week,
      rng,
      cfg,
    ),
  }));
  let knowledge = addEvidence(h0.knowledge, items, s.week, label, cfg);
  for (const c of raceTraitChecks(record)) {
    if (!c.opportunity) continue;
    const has = truth.traits.includes(c.trait);
    const seen = rng() < raceTraitSignChance(c.trait, record, has);
    if (seen || !has) knowledge = recordTraitSign(knowledge, c.trait, seen, s.week, label, cfg);
  }
  const prevEvents = new Set(h0.knowledge.events);
  const newEvents = knowledge.events.filter((e) => !prevEvents.has(e));

  const relationship = opinion.stance === "反対" ? Math.max(0, h0.relationship - 5) : h0.relationship;
  const resultText = `${p.name}（${courseLabel(p.course)}）${mine.position}着／${p.fieldSize}頭 ${formatRaceTime(mine.timeMs)}${prize ? ` 賞金${prize.toLocaleString("ja-JP")}円` : ""}`;
  let horse: RaceHorse = {
    ...h0,
    truth,
    state: stt,
    knowledge,
    relationship,
    racedWeek: s.week,
    record: {
      races: h0.record.races + 1,
      wins: h0.record.wins + (mine.position === 1 ? 1 : 0),
      seconds: h0.record.seconds + (mine.position === 2 ? 1 : 0),
      thirds: h0.record.thirds + (mine.position === 3 ? 1 : 0),
      totalPrize: h0.record.totalPrize + prize,
      lastRaceWeek: s.week,
    },
  };
  horse = addLog(horse, [
    { week: s.week, kind: "race", text: `${resultText}（作戦：${STYLE_LABELS[tactics.style]}・${PACE_LABELS[tactics.pace]}・仕掛け${SPURT_LABELS[tactics.spurt]}）`, raceId },
    { week: s.week, kind: "report", text: record.trainerComment },
    ...(injured ? [{ week: s.week, kind: "report" as const, text: `レース後に脚元の不安が見つかりました。${stt.injuryWeeks}週ほど治療します。` }] : []),
    ...newEvents.map((e) => ({ week: s.week, kind: "knowledge" as const, text: e.text })),
  ]);

  const m = money(s, prize, `${h0.name} ${p.name} ${mine.position}着`);
  const player = {
    ...m.player,
    totalPrize: s.player.totalPrize + prize,
    races: s.player.races + 1,
    wins: s.player.wins + (mine.position === 1 ? 1 : 0),
  };
  const save = touch(
    {
      ...s,
      player,
      finance: m.finance,
      horses: replaceHorse(s, horse),
      races: [record, ...s.races].slice(0, RACE_HISTORY_LIMIT),
      counters: { ...s.counters, raceSeq },
    },
    now,
  );

  const order = [...runners].sort((a, b) => a.gate - b.gate);
  const replay: RaceReplay = {
    raceId,
    courseName: p.name,
    distance: D,
    surface: p.course.surface,
    going: p.going,
    weather: weatherFor(p.going, seed),
    runners: order.map((r) => {
      const n = names.get(r.id)!;
      return { gate: r.gate, playerId: n.mine ? LOCAL_OWNER_ID : "cpu", playerName: n.owner, horseId: r.id, horseName: n.name, style: STYLE_LABELS[r.tactics.style] };
    }),
    frames: sim.frames,
    lanes: sim.lanes,
    sampleDt: sim.sampleDt,
    durationSec: sim.durationSec,
    finishOrder: sim.results.map((r) => order.findIndex((x) => x.id === r.id)),
    course: p.course,
  };
  return { save, record, replay, opinion, injured };
}

/* ---------------- 馬主自身の分析 ---------------- */

export interface AnalysisOutcome {
  save: OwnerSave;
  discoveries: string[];
}

/** レース記録を分析して、推定に反映する（1レースにつき1回） */
export function applyRaceAnalysis(s: OwnerSave, raceId: string, now = new Date(), cfg: GameConfig = DEFAULT_CONFIG): AnalysisOutcome {
  const rec = s.races.find((r) => r.raceId === raceId) ?? fail("レースの記録が見つかりません");
  if (rec.analyzed) fail("このレースはすでに分析済みです");
  const h = findHorse(s, rec.horseId);
  const rng = createRng(hash32(`analysis|${raceId}`));
  const items = analysisPlan(rec).map((it) => ({
    key: it.key,
    evidence: makeEvidence(
      { key: it.key, kind: "raceAnalysis", src: "analysis", trueValue: truthValue(h.truth, it.key, cfg), skillScale: 1, infoScale: it.infoScale, ref: raceId },
      h.truth.biasSeed,
      rec.week,
      rng,
      cfg,
    ),
  }));
  const knowledge = addEvidence(h.knowledge, items, s.week, `馬主の分析（${rec.programName}）`, cfg);
  const prev = new Set(h.knowledge.events);
  const newEvents = knowledge.events.filter((e) => !prev.has(e));
  const horse = addLog({ ...h, knowledge }, [
    { week: s.week, kind: "owner", text: `${rec.programName}のレースを分析した。`, raceId },
    ...newEvents.map((e) => ({ week: s.week, kind: "knowledge" as const, text: e.text })),
  ]);
  const races = s.races.map((r) => (r.raceId === raceId ? { ...r, analyzed: true } : r));
  return { save: touch({ ...s, horses: replaceHorse(s, horse), races }, now), discoveries: newEvents.map((e) => e.text) };
}

/* ---------------- 売却・引退 ---------------- */

/** 売却額（戦績・年齢など公開情報から決まる） */
export function saleValue(h: RaceHorse, week: number): number {
  const age = ageAt(h, week);
  const ageMul = age <= 3 ? 1 : age === 4 ? 0.8 : age === 5 ? 0.6 : 0.4;
  const raced = h.record.races > 0;
  const base = raced ? 120_000 + h.record.totalPrize * 0.25 + h.record.wins * 250_000 : h.purchasePrice * 0.65 + 60_000;
  const injuredMul = h.state.injuryWeeks > 0 ? 0.6 : 1;
  return Math.max(30_000, Math.round((base * ageMul * injuredMul) / 10_000) * 10_000);
}

export function ownerRetirementBonus(h: RaceHorse): number {
  return Math.round(50_000 + h.record.totalPrize * 0.08 + h.record.wins * 100_000);
}

export function sellHorse(s: OwnerSave, horseId: string, now = new Date()): { save: OwnerSave; amount: number } {
  const h = findHorse(s, horseId);
  if (h.status !== "active") fail("現役の馬ではありません");
  const amount = saleValue(h, s.week);
  const next = addLog({ ...h, status: "sold", knowledge: compactKnowledge(h.knowledge) }, [
    { week: s.week, kind: "owner", text: `${amount.toLocaleString("ja-JP")}円で売却した。` },
  ]);
  return { save: touch({ ...s, ...money(s, amount, `${h.name}を売却`), horses: replaceHorse(s, next) }, now), amount };
}

export function retireHorse(s: OwnerSave, horseId: string, now = new Date(), reason = "馬主の判断"): { save: OwnerSave; bonus: number } {
  const h = findHorse(s, horseId);
  if (h.status !== "active") fail("現役の馬ではありません");
  const bonus = ownerRetirementBonus(h);
  const next = addLog({ ...h, status: "retired", knowledge: compactKnowledge(h.knowledge) }, [
    { week: s.week, kind: "owner", text: `引退（${reason}）。報奨金 ${bonus.toLocaleString("ja-JP")}円。` },
  ]);
  return { save: touch({ ...s, ...money(s, bonus, `${h.name}の引退報奨金`), horses: replaceHorse(s, next) }, now), bonus };
}

/* ---------------- 補助 ---------------- */

/** 次の週の預託料の合計 */
export function upcomingFees(s: OwnerSave): number {
  return activeHorses(s).reduce((a, h) => a + weeklyFeeFor(h, s.week), 0);
}

export function racesOf(s: OwnerSave, horseId: string): OwnerRaceRecord[] {
  return s.races.filter((r) => r.horseId === horseId);
}

export function isNewYearWeek(week: number): boolean {
  return week % WEEKS_PER_YEAR === 0;
}

