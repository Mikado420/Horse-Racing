// オフライン（1人用）モードのゲームエンジン。
// 画面にもストレージにも依存しない純粋関数の集まり：セーブデータと乱数シードを受け取り、
// 新しいセーブデータを返す。レース計算・育成ルールはオンライン版と同じ shared のものを使う。
import {
  CPU_OWNER_NAME,
  ECONOMY,
  MAX_STABLE,
  STYLE_LABELS,
  applyRest,
  applyTraining,
  canRace,
  createRng,
  createStarterHorse,
  findProgram,
  findTemplate,
  generateCpuField,
  generateMarket,
  programPrize,
  resolveRace,
  retirementBonus,
  validateHorseName,
  type Horse,
  type LobbyEntryView,
  type MarketOffer,
  type PlayerProfile,
  type RaceStartMsg,
  type ResultRow,
  type Stats,
  type TrainingMenu,
} from "@owners/shared";

export const SAVE_VERSION = 1;
export const LOCAL_PLAYER_ID = "local-player";
export const HISTORY_LIMIT = 200;
/** 何レースごとに馬の販売リストを入れ替えるか */
export const MARKET_REFRESH_RACES = 3;

export interface OfflineRaceRecord {
  raceId: string;
  programId: string;
  programName: string;
  courseName: string;
  distance: number;
  going: string;
  weather: string;
  fieldSize: number;
  createdAt: string;
  horseId: string;
  horseName: string;
  position: number;
  timeMs: number;
  prize: number;
  entryFee: number;
  results: ResultRow[];
}

export interface OfflineSave {
  version: typeof SAVE_VERSION;
  createdAt: string;
  updatedAt: string;
  player: PlayerProfile;
  horses: Horse[];
  history: OfflineRaceRecord[];
  market: { offers: MarketOffer[]; racesAtRefresh: number };
  counters: { horseSeq: number; raceSeq: number };
}

export class GameError extends Error {}

const fail = (m: string): never => {
  throw new GameError(m);
};

function touch(s: OfflineSave, now: Date): OfflineSave {
  return { ...s, updatedAt: now.toISOString() };
}

function activeHorses(s: OfflineSave): Horse[] {
  return s.horses.filter((h) => !h.retired);
}

function findHorse(s: OfflineSave, horseId: string): Horse {
  return s.horses.find((h) => h.id === horseId) ?? fail("馬が見つかりません");
}

function replaceHorse(s: OfflineSave, h: Horse): Horse[] {
  return s.horses.map((x) => (x.id === h.id ? h : x));
}

export function validateOwnerName(name: unknown): string | null {
  if (typeof name !== "string") return "名前を入力してください";
  const len = [...name.trim()].length;
  if (len < 1 || len > 12) return "名前は1〜12文字にしてください";
  return null;
}

export function newGame(ownerName: string, seed: number, now = new Date()): OfflineSave {
  const err = validateOwnerName(ownerName);
  if (err) fail(err);
  return {
    version: SAVE_VERSION,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    player: {
      id: LOCAL_PLAYER_ID,
      username: ownerName.trim(),
      money: ECONOMY.startingMoney,
      totalPrize: 0,
      races: 0,
      wins: 0,
    },
    horses: [],
    history: [],
    market: { offers: generateMarket(seed), racesAtRefresh: 0 },
    counters: { horseSeq: 0, raceSeq: 0 },
  };
}

export function selectStarter(s: OfflineSave, templateId: string, name: string, seed: number, now = new Date()): OfflineSave {
  if (s.horses.length > 0) fail("初期馬は既に選択済みです");
  const t = findTemplate(templateId) ?? fail("初期馬の種類が正しくありません");
  const nameErr = validateHorseName(name);
  if (nameErr) fail(nameErr);
  const id = `h${s.counters.horseSeq + 1}`;
  const horse = createStarterHorse(t, { id, ownerId: LOCAL_PLAYER_ID }, name.trim(), createRng(seed));
  return touch({ ...s, horses: [horse], counters: { ...s.counters, horseSeq: s.counters.horseSeq + 1 } }, now);
}

export function train(s: OfflineSave, horseId: string, menu: TrainingMenu, seed: number, now = new Date()) {
  const h = findHorse(s, horseId);
  if (s.player.money < ECONOMY.trainingCost) fail("所持金が足りません");
  let r;
  try {
    r = applyTraining(h, menu, createRng(seed));
  } catch (e) {
    return fail((e as Error).message);
  }
  const save = touch(
    { ...s, horses: replaceHorse(s, r.horse), player: { ...s.player, money: s.player.money - ECONOMY.trainingCost } },
    now,
  );
  return { save, horse: r.horse, gains: r.gains, injured: r.injured, conditionDelta: r.conditionDelta };
}

export function rest(s: OfflineSave, horseId: string, seed: number, now = new Date()) {
  const h = findHorse(s, horseId);
  let r;
  try {
    r = applyRest(h, createRng(seed));
  } catch (e) {
    return fail((e as Error).message);
  }
  return { save: touch({ ...s, horses: replaceHorse(s, r.horse) }, now), horse: r.horse, fatigueDelta: r.fatigueDelta, conditionDelta: r.conditionDelta };
}

/** 出走できるか（理由を返す。問題なければ null） */
export function entryProblem(s: OfflineSave, horse: Horse, programId: string): string | null {
  const p = findProgram(programId);
  if (!p) return "レースが見つかりません";
  return canRace(horse) ?? p.requirement(horse) ?? (s.player.money < p.entryFee ? "出走経費が足りません" : null);
}

export interface OfflineRaceOutcome {
  save: OfflineSave;
  /** 3D再生用（オンライン版と同じ形式。startAt は再生側で決める） */
  replay: Omit<RaceStartMsg, "startAt" | "serverNow" | "replaySpeed">;
  results: ResultRow[];
  record: OfflineRaceRecord;
}

/** 出走条件を確認せずに1レースを計算する（runRace と estimateRace の共通部分） */
function computeRace(s: OfflineSave, horse: Horse, programId: string, seed: number) {
  const program = findProgram(programId) ?? fail("レースが見つかりません");
  const rng = createRng(seed);
  const myGate = 1 + Math.floor(rng() * program.fieldSize);
  const cpus = generateCpuField(program, program.fieldSize - 1, seed ^ 0x2545f491, s.horses.map((h) => h.name));
  let cpuIdx = 0;
  const entries = Array.from({ length: program.fieldSize }, (_, i) => {
    const gate = i + 1;
    if (gate === myGate) return { horse, gate, ownerId: LOCAL_PLAYER_ID, ownerName: s.player.username };
    return { horse: cpus[cpuIdx++], gate, ownerId: null, ownerName: CPU_OWNER_NAME };
  });
  const resolved = resolveRace(entries, program.course, seed, (pos) => programPrize(program, pos));
  const mine = resolved.results.find((r) => r.horseId === horse.id)!;
  return { program, resolved, mine };
}

/** CPU馬とのレースを実行し、賞金・戦績・馬の状態を反映したセーブを返す */
export function runRace(s: OfflineSave, horseId: string, programId: string, seed: number, now = new Date()): OfflineRaceOutcome {
  const horse = findHorse(s, horseId);
  const problem = entryProblem(s, horse, programId);
  if (problem) fail(problem);
  const { program, resolved, mine } = computeRace(s, horse, programId, seed);

  const toRow = (r: (typeof resolved.results)[number]): ResultRow => ({
    position: r.position,
    gate: r.gate,
    horseId: r.horseId,
    horseName: r.horseName,
    playerId: r.ownerId ?? "cpu",
    playerName: r.ownerName,
    timeMs: r.timeMs,
    marginLengths: r.marginLengths,
    prize: r.prize,
  });
  const results = resolved.results.map(toRow);
  const after = resolved.horsesAfter[0];
  const raceSeq = s.counters.raceSeq + 1;
  const raceId = `r${raceSeq}`;

  const runners: LobbyEntryView[] = resolved.runners.map((e) => ({
    gate: e.gate,
    playerId: e.ownerId ?? "cpu",
    playerName: e.ownerName,
    horseId: e.horse.id,
    horseName: e.horse.name,
    style: STYLE_LABELS[e.horse.style],
  }));
  const replay: OfflineRaceOutcome["replay"] = {
    raceId,
    courseName: `${program.course.name} ${program.name}`,
    distance: program.course.distance,
    surface: program.course.surface,
    going: resolved.conditions.going,
    weather: resolved.conditions.weather,
    runners,
    frames: resolved.sim.frames,
    sampleDt: resolved.sim.sampleDt,
    durationSec: resolved.sim.durationSec,
    finishOrder: resolved.sim.results.map((r) => runners.findIndex((x) => x.horseId === r.entryId)),
  };

  const record: OfflineRaceRecord = {
    raceId,
    programId: program.id,
    programName: program.name,
    courseName: program.course.name,
    distance: program.course.distance,
    going: resolved.conditions.going,
    weather: resolved.conditions.weather,
    fieldSize: program.fieldSize,
    createdAt: now.toISOString(),
    horseId: horse.id,
    horseName: horse.name,
    position: mine.position,
    timeMs: mine.timeMs,
    prize: mine.prize,
    entryFee: program.entryFee,
    results,
  };

  const player: PlayerProfile = {
    ...s.player,
    money: s.player.money - program.entryFee + mine.prize,
    totalPrize: s.player.totalPrize + mine.prize,
    races: s.player.races + 1,
    wins: s.player.wins + (mine.position === 1 ? 1 : 0),
  };

  let market = s.market;
  if (player.races - s.market.racesAtRefresh >= MARKET_REFRESH_RACES) {
    market = { offers: generateMarket(seed ^ 0x6c8e9cf5, s.horses.map((h) => h.name)), racesAtRefresh: player.races };
  }

  const save = touch(
    {
      ...s,
      player,
      horses: replaceHorse(s, after),
      history: [record, ...s.history].slice(0, HISTORY_LIMIT),
      market,
      counters: { ...s.counters, raceSeq },
    },
    now,
  );
  return { save, replay, results, record };
}

export function buyHorse(s: OfflineSave, offerId: string, now = new Date()): { save: OfflineSave; horse: Horse } {
  const offer = s.market.offers.find((o) => o.offerId === offerId) ?? fail("この馬はもう販売されていません");
  if (activeHorses(s).length >= MAX_STABLE) fail(`厩舎に入れられるのは${MAX_STABLE}頭までです。引退させてから購入してください`);
  if (s.player.money < offer.price) fail("所持金が足りません");
  const id = `h${s.counters.horseSeq + 1}`;
  const horse: Horse = { ...offer.horse, stats: { ...offer.horse.stats }, id, ownerId: LOCAL_PLAYER_ID };
  const save = touch(
    {
      ...s,
      horses: [...s.horses, horse],
      player: { ...s.player, money: s.player.money - offer.price },
      market: { ...s.market, offers: s.market.offers.filter((o) => o.offerId !== offerId) },
      counters: { ...s.counters, horseSeq: s.counters.horseSeq + 1 },
    },
    now,
  );
  return { save, horse };
}

export function retireHorse(s: OfflineSave, horseId: string, now = new Date()): { save: OfflineSave; bonus: number } {
  const h = findHorse(s, horseId);
  if (h.retired) fail("既に引退しています");
  if (activeHorses(s).length <= 1 && s.player.money < 150_000) {
    fail("最後の1頭です。新しい馬を買える所持金がないため引退させられません");
  }
  const bonus = retirementBonus(h);
  const save = touch(
    { ...s, horses: replaceHorse(s, { ...h, retired: true }), player: { ...s.player, money: s.player.money + bonus } },
    now,
  );
  return { save, bonus };
}

export interface RaceEstimate {
  trials: number;
  winRate: number;
  top3Rate: number;
  avgPosition: number;
  avgPrize: number;
  /** 1回あたりの期待収支（賞金 − 出走経費） */
  expectedNet: number;
}

/** 現在の状態で同じレースを何度も走らせた場合の成績（セーブは変更しない） */
export function estimateRace(s: OfflineSave, horseId: string, programId: string, trials: number, seed: number): RaceEstimate {
  const horse = findHorse(s, horseId);
  let wins = 0, top3 = 0, posSum = 0, prizeSum = 0, fee = 0;
  for (let i = 0; i < trials; i++) {
    const { program, mine } = computeRace(s, horse, programId, (seed + Math.imul(i + 1, 0x9e3779b1)) >>> 0);
    fee = program.entryFee;
    if (mine.position === 1) wins++;
    if (mine.position <= 3) top3++;
    posSum += mine.position;
    prizeSum += mine.prize;
  }
  return {
    trials,
    winRate: wins / trials,
    top3Rate: top3 / trials,
    avgPosition: posSum / trials,
    avgPrize: prizeSum / trials,
    expectedNet: prizeSum / trials - fee,
  };
}

/** 記録画面用：所有したことのある馬の獲得賞金順 */
export function hallOfFame(s: OfflineSave) {
  return [...s.horses].sort((a, b) => b.totalPrize - a.totalPrize || b.wins - a.wins);
}

export type { Stats };
