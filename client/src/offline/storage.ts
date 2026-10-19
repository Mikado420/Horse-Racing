// オフライン版（馬主モード）のセーブ・ロード。ブラウザの localStorage に保存し、JSONファイルへの書き出し・読み込みもできる。
// 読み込み時は必ず検証し、壊れたデータで画面が落ちないようにする。
// 旧形式（バージョン1：プレイヤーが直接調教する方式）のセーブは、新しい形式へ変換して引き継ぐ。
import {
  ABILITY_KEYS,
  KNOWLEDGE_KEYS,
  OWNER_SAVE_VERSION,
  STAT_KEYS,
  TRAINERS,
  WEEKS_PER_YEAR,
  addEvidence,
  createRng,
  emptyKnowledge,
  generateOwnerMarket,
  hash32,
  OwnerGameError,
  TRAIT_IDS,
  yearOf,
  type Abilities,
  type Evidence,
  type Horse,
  type KnowledgeKey,
  type OwnerSave,
  type RaceHorse,
  type RunningStyle,
  type TraitId,
} from "@owners/shared";

export const SAVE_KEY = "owners.offline.save";
export const BACKUP_KEY = "owners.offline.save.broken";
/** 旧形式から変換したときに、変換前のデータを残しておく場所 */
export const V1_BACKUP_KEY = "owners.offline.save.v1";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown, min = -Infinity, max = Infinity): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const isStr = (v: unknown, max = 200): v is string => typeof v === "string" && v.length <= max;

function bad(where: string): never {
  throw new OwnerGameError(`セーブデータが壊れています（${where}）`);
}

function checkHorse(h: unknown, i: number): RaceHorse {
  const w = `馬${i + 1}`;
  if (!isObj(h)) bad(w);
  if (!isStr(h.id, 40) || !isStr(h.name, 40) || !isStr(h.ownerId, 60) || !isStr(h.trainerId, 20)) bad(`${w}の名前`);
  if (!isNum(h.birthYear, -10, 1000)) bad(`${w}の年齢`);
  const t = h.truth;
  if (!isObj(t) || !isObj(t.abilities) || !isObj(t.potential) || !isObj(t.development) || !isObj(t.aptitude) || !Array.isArray(t.traits)) bad(`${w}の能力`);
  for (const k of ABILITY_KEYS) {
    if (!isNum(t.abilities[k], 0, 150) || !isNum(t.potential[k], 0, 150) || !isNum(t.development[k], 0, 1)) bad(`${w}の能力`);
  }
  if (!t.traits.every((x) => TRAIT_IDS.includes(x as TraitId))) bad(`${w}の個性`);
  const s = h.state;
  if (!isObj(s)) bad(`${w}の状態`);
  for (const k of ["fatigue", "health", "fitness"]) if (!isNum(s[k], 0, 100)) bad(`${w}の状態`);
  if (!isNum(s.condition, -2, 2) || !isNum(s.injuryWeeks, 0, 60)) bad(`${w}の状態`);
  const k = h.knowledge;
  if (!isObj(k) || !isObj(k.entries) || !isObj(k.traits) || !Array.isArray(k.events)) bad(`${w}の見立て`);
  for (const key of KNOWLEDGE_KEYS) {
    const e = k.entries[key];
    if (!isObj(e) || !Array.isArray(e.evidence)) bad(`${w}の見立て`);
    for (const ev of e.evidence) if (!isObj(ev) || !isNum(ev.v) || !isNum(ev.q, 0) || !isNum(ev.w)) bad(`${w}の見立て`);
  }
  const r = h.record;
  if (!isObj(r) || !isNum(r.races, 0) || !isNum(r.wins, 0) || !isNum(r.totalPrize, 0)) bad(`${w}の戦績`);
  if (!["active", "retired", "sold"].includes(h.status as string)) bad(`${w}の所属`);
  if (!Array.isArray(h.log)) bad(`${w}の記録`);
  return h as unknown as RaceHorse;
}

/** 読み込んだ値を検証してセーブデータとして返す（旧形式はここで変換する） */
export function parseSave(raw: unknown): OwnerSave {
  if (!isObj(raw)) bad("形式");
  if (raw.version === 1) return migrateV1(raw);
  if (raw.version !== OWNER_SAVE_VERSION) {
    throw new OwnerGameError(`対応していないセーブデータのバージョンです（${String(raw.version)}）`);
  }
  const p = raw.player;
  if (!isObj(p) || !isStr(p.id) || !isStr(p.username, 40)) bad("オーナー");
  if (!isNum(p.money) || !isNum(p.totalPrize, 0) || !isNum(p.races, 0) || !isNum(p.wins, 0)) bad("所持金・戦績");
  if (!isNum(raw.week, 0, 100_000)) bad("日付");
  if (!Array.isArray(raw.horses)) bad("所有馬");
  const horses = raw.horses.map(checkHorse);
  if (new Set(horses.map((h) => h.id)).size !== horses.length) bad("馬のID重複");
  if (!Array.isArray(raw.races) || !Array.isArray(raw.reports) || !Array.isArray(raw.finance)) bad("記録");
  const m = raw.market;
  if (!isObj(m) || !Array.isArray(m.offers) || !isNum(m.refreshedWeek, 0)) bad("販売リスト");
  m.offers.forEach((o, i) => {
    if (!isObj(o) || !isStr(o.offerId) || !isNum(o.price, 0)) bad("販売リスト");
    checkHorse(o.horse, i);
  });
  if (raw.starterOffers !== null && !Array.isArray(raw.starterOffers)) bad("初期馬");
  const c = raw.counters;
  if (!isObj(c) || !isNum(c.horseSeq, 0) || !isNum(c.raceSeq, 0)) bad("カウンタ");
  if (!isStr(raw.createdAt) || !isStr(raw.updatedAt)) bad("日時");
  return raw as unknown as OwnerSave;
}

/* ---------------- 旧形式（バージョン1）からの変換 ---------------- */

const GRADE_FIT: Record<string, number> = { A: 85, B: 65, C: 45, D: 25 };

/**
 * 旧形式の馬を新しい形式へ。旧形式では能力値がそのまま見えていたので、
 * 対応する5能力は「数値まで判明済み」として引き継ぎ、新しく加わった加速力や適性は未解明から始める。
 */
export function migrateV1Horse(h: Horse, week: number, ownerId: string): RaceHorse {
  const rng = createRng(hash32(`v1|${h.id}|${h.name}`));
  const map = (v: number) => Math.round(Math.min(100, Math.max(1, v)));
  const abilities: Abilities = {
    speed: map(h.stats.speed),
    acceleration: map((h.stats.speed + h.stats.power) / 2),
    stamina: map(h.stats.stamina),
    power: map(h.stats.power),
    fightingSpirit: map(h.stats.guts),
    raceSense: map(h.stats.wisdom),
  };
  const potential: Abilities = {
    speed: map(h.potential.speed),
    acceleration: map((h.potential.speed + h.potential.power) / 2),
    stamina: map(h.potential.stamina),
    power: map(h.potential.power),
    fightingSpirit: map(h.potential.guts),
    raceSense: map(h.potential.wisdom),
  };
  for (const k of ABILITY_KEYS) potential[k] = Math.max(potential[k], abilities[k]);
  const bands: [string, number, number][] = [
    ["sprint", 1000, 1400],
    ["mile", 1500, 1800],
    ["middle", 1900, 2400],
    ["long", 2500, 3200],
  ];
  const good = bands.filter(([k]) => ["A", "B"].includes(h.aptitude[k as keyof Horse["aptitude"]]));
  const distanceMin = good.length ? good[0][1] : 1400;
  const distanceMax = good.length ? good[good.length - 1][2] : 1800;
  const styles = { front: 40, stalker: 40, closer: 40, deep: 40 } as Record<RunningStyle, number>;
  styles[h.style] = 85;
  const traits: TraitId[] = [];
  while (traits.length < 2) {
    const t = TRAIT_IDS[Math.floor(rng() * TRAIT_IDS.length)];
    if (!traits.includes(t) && !(t === "calm" && traits.includes("keen")) && !(t === "keen" && traits.includes("calm"))) traits.push(t);
  }
  const development = Object.fromEntries(ABILITY_KEYS.map((k) => [k, 0.5])) as Abilities;
  const truth: RaceHorse["truth"] = {
    abilities,
    potential,
    growthType: "normal",
    development,
    aptitude: {
      distanceMin,
      distanceMax,
      turf: GRADE_FIT[h.aptitude.turf],
      dirt: GRADE_FIT[h.aptitude.dirt],
      heavy: 50,
      right: 60,
      left: 60,
      slope: 50,
      tight: 50,
      styles,
    },
    traits,
    biasSeed: hash32(`bias|${h.id}`),
    growthLog: [],
  };
  // 旧形式で見えていた5能力は判明済みとして引き継ぐ
  const known: KnowledgeKey[] = ["speed", "stamina", "power", "fightingSpirit", "raceSense"];
  const items: { key: KnowledgeKey; evidence: Evidence }[] = known.flatMap((key) =>
    [0, 1, 2].map((i) => ({ key, evidence: { w: week, src: "v1", k: "raceAnalysis" as const, v: abilities[key as keyof Abilities], q: 1.5, b: 0.5, ref: `v1-${i}` } })),
  );
  const knowledge = addEvidence(emptyKnowledge(), items, week, "旧形式のデータから引き継ぎ");
  return {
    id: h.id,
    name: h.name,
    ownerId,
    birthYear: yearOf(week) - 3,
    sireId: null,
    damId: null,
    sireName: null,
    damName: null,
    trainerId: TRAINERS[3].id,
    relationship: 60,
    truth,
    state: {
      fatigue: Math.round(h.fatigue),
      condition: h.condition,
      health: 80,
      fitness: 70,
      injuryWeeks: h.injuryRestsLeft > 0 ? h.injuryRestsLeft * 2 : 0,
      experience: h.races,
    },
    policy: { policy: "raceExperience", mode: "follow", goalRaceId: null },
    knowledge,
    record: { races: h.races, wins: h.wins, seconds: 0, thirds: 0, totalPrize: h.totalPrize, lastRaceWeek: null },
    racedWeek: null,
    status: h.retired ? "retired" : "active",
    purchasePrice: 0,
    acquiredWeek: week,
    log: [
      {
        week,
        kind: "owner",
        text: `旧形式のセーブデータから引き継いだ（${h.races}戦${h.wins}勝・獲得賞金${h.totalPrize.toLocaleString("ja-JP")}円）。旧形式で見えていた能力は判明済み、加速力・適性・個性は未解明から始まる。`,
      },
    ],
  };
}

export function migrateV1(raw: Record<string, unknown>): OwnerSave {
  const p = raw.player;
  if (!isObj(p) || !isStr(p.username, 40) || !isNum(p.money) || !Array.isArray(raw.horses)) bad("旧形式のデータ");
  const week = WEEKS_PER_YEAR * 2 + 16; // 3年目5月：引き継いだ馬が3歳で走れる時期
  const horses = (raw.horses as unknown[]).map((h, i) => {
    if (!isObj(h) || !isObj(h.stats) || !isObj(h.potential)) bad(`旧形式の馬${i + 1}`);
    for (const k of STAT_KEYS) if (!isNum((h.stats as Record<string, unknown>)[k], 0, 200)) bad(`旧形式の馬${i + 1}`);
    return migrateV1Horse(h as unknown as Horse, week, String(p.id ?? "local-player"));
  });
  const counters = isObj(raw.counters) && isNum(raw.counters.horseSeq, 0) ? (raw.counters.horseSeq as number) : horses.length;
  const now = new Date().toISOString();
  return {
    version: OWNER_SAVE_VERSION,
    createdAt: isStr(raw.createdAt) ? raw.createdAt : now,
    updatedAt: now,
    player: {
      id: String(p.id ?? "local-player"),
      username: p.username,
      money: p.money,
      totalPrize: isNum(p.totalPrize, 0) ? p.totalPrize : 0,
      races: isNum(p.races, 0) ? p.races : 0,
      wins: isNum(p.wins, 0) ? p.wins : 0,
    },
    week,
    horses,
    races: [],
    reports: [],
    market: { offers: generateOwnerMarket(week, hash32(`market|${now}`), horses.map((h) => h.name)), refreshedWeek: week },
    starterOffers: null,
    finance: [{ week, amount: p.money, note: "旧形式のセーブデータから引き継ぎ" }],
    counters: { horseSeq: counters, raceSeq: 0 },
  };
}

/* ---------------- 保存先 ---------------- */

/** 起動時に正常に読み込めたセーブの控え（更新後に読めなくなった場合などに戻せるように） */
export const GOOD_KEY = "owners.offline.save.lastGood";

export interface LoadResult {
  save: OwnerSave | null;
  error?: string;
  notice?: string;
  /** 読み込めないデータが残っている（初期化はしていない） */
  broken?: boolean;
  /** 戻せる控えがある */
  canRestore?: boolean;
}

/**
 * セーブを読み込む。
 * ・読み込めたら、その内容を控え（GOOD_KEY）として保存する
 * ・旧形式なら変換する。変換前のデータは V1_BACKUP_KEY に残す
 * ・読み込めない（壊れている・変換できない）場合は、データを消さずにそのまま残し、
 *   控えにも写してからプレイヤーに選んでもらう（無断で初期化しない）
 */
export function loadSave(kv: KeyValueStore): LoadResult {
  const text = kv.getItem(SAVE_KEY);
  if (!text) return { save: null };
  try {
    const raw = JSON.parse(text) as unknown;
    const save = parseSave(raw);
    if (isObj(raw) && raw.version === 1) {
      kv.setItem(V1_BACKUP_KEY, text);
      kv.setItem(SAVE_KEY, JSON.stringify(save));
      snapshot(kv, JSON.stringify(save));
      return {
        save,
        notice: "旧形式のセーブデータを新しい馬主システムへ引き継ぎました。旧形式で見えていた能力は判明済みとして扱い、加速力・適性・個性はこれから見極めます。",
      };
    }
    snapshot(kv, text);
    return { save };
  } catch (e) {
    try {
      kv.setItem(BACKUP_KEY, text);
    } catch {
      /* 控えを書けなくても、元のデータは SAVE_KEY に残っている */
    }
    const msg = e instanceof OwnerGameError ? e.message : "セーブデータを読み込めませんでした";
    return { save: null, broken: true, canRestore: restorable(kv) !== null, error: `${msg}。データは消さずに残してあります。` };
  }
}

function snapshot(kv: KeyValueStore, text: string) {
  try {
    kv.setItem(GOOD_KEY, text);
  } catch {
    // 容量不足のときは控えを作らない（本体の保存を優先する）
  }
}

/** 戻せる控え（読み込めるもの）があれば返す。直近の正常な控え → 旧形式の元データ の順に探す */
export function restorable(kv: KeyValueStore): OwnerSave | null {
  for (const key of [GOOD_KEY, V1_BACKUP_KEY]) {
    const t = kv.getItem(key);
    if (!t) continue;
    try {
      return parseSave(JSON.parse(t));
    } catch {
      /* 次の候補へ */
    }
  }
  return null;
}

/** 控えから戻す。今の（読み込めない）データは BACKUP_KEY に残したまま */
export function restoreFromBackup(kv: KeyValueStore): OwnerSave {
  const save = restorable(kv);
  if (!save) throw new OwnerGameError("戻せる控えがありません");
  writeSave(kv, save);
  return save;
}

/** 読み込めなかったデータの中身（ファイルへの書き出し用） */
export function brokenText(kv: KeyValueStore): string | null {
  return kv.getItem(SAVE_KEY) ?? kv.getItem(BACKUP_KEY);
}

export function writeSave(kv: KeyValueStore, save: OwnerSave): void {
  kv.setItem(SAVE_KEY, JSON.stringify(save));
}

export function deleteSave(kv: KeyValueStore): void {
  kv.removeItem(SAVE_KEY);
}

export function exportSave(save: OwnerSave): string {
  return JSON.stringify(save);
}

export function importSave(text: string): OwnerSave {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new OwnerGameError("ファイルの形式が正しくありません（JSONではありません）");
  }
  return parseSave(raw);
}

/** ブラウザの localStorage（使えない環境ではメモリ上に保持） */
export function browserStore(): KeyValueStore {
  try {
    const t = "__owners_test__";
    localStorage.setItem(t, "1");
    localStorage.removeItem(t);
    return localStorage;
  } catch {
    const mem = new Map<string, string>();
    return {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
    };
  }
}
