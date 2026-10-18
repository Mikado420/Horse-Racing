// オフライン版のセーブ・ロード。ブラウザの localStorage に保存し、JSONファイルへの書き出し・読み込みもできる。
// 読み込み時は必ず検証し、壊れたデータで画面が落ちないようにする。
import { STAT_KEYS, type Horse } from "@owners/shared";
import { GameError, SAVE_VERSION, type OfflineSave } from "./engine";

export const SAVE_KEY = "owners.offline.save";
export const BACKUP_KEY = "owners.offline.save.broken";

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
  throw new GameError(`セーブデータが壊れています（${where}）`);
}

const GRADES = ["A", "B", "C", "D"];
const STYLES = ["front", "stalker", "closer", "deep"];

function checkHorse(h: unknown, i: number): Horse {
  const w = `馬${i + 1}`;
  if (!isObj(h)) bad(w);
  if (!isStr(h.id, 40) || !isStr(h.name, 40) || !isStr(h.ownerId, 60)) bad(`${w}の名前`);
  for (const key of ["stats", "potential"] as const) {
    const st = h[key];
    if (!isObj(st)) bad(`${w}の能力`);
    for (const k of STAT_KEYS) if (!isNum(st[k], 0, 200)) bad(`${w}の能力`);
  }
  if (!STYLES.includes(h.style as string)) bad(`${w}の脚質`);
  if (!isObj(h.aptitude)) bad(`${w}の適性`);
  for (const k of ["turf", "dirt", "sprint", "mile", "middle", "long"]) {
    if (!GRADES.includes(h.aptitude[k] as string)) bad(`${w}の適性`);
  }
  if (!isNum(h.fatigue, 0, 100) || !isNum(h.condition, -2, 2) || !isNum(h.injuryRestsLeft, 0, 10)) bad(`${w}の状態`);
  if (!isNum(h.turns, 0, 10_000) || !isNum(h.races, 0) || !isNum(h.wins, 0) || !isNum(h.totalPrize, 0)) bad(`${w}の戦績`);
  if (typeof h.retired !== "boolean") bad(`${w}の引退`);
  return h as unknown as Horse;
}

/** 読み込んだ値を検証してセーブデータとして返す（古い形式はここで変換する） */
export function parseSave(raw: unknown): OfflineSave {
  if (!isObj(raw)) bad("形式");
  if (raw.version !== SAVE_VERSION) {
    // 将来、形式を変えたらここで旧バージョンから変換する
    throw new GameError(`対応していないセーブデータのバージョンです（${String(raw.version)}）`);
  }
  const p = raw.player;
  if (!isObj(p) || !isStr(p.id) || !isStr(p.username, 40)) bad("オーナー");
  if (!isNum(p.money, 0) || !isNum(p.totalPrize, 0) || !isNum(p.races, 0) || !isNum(p.wins, 0)) bad("所持金・戦績");
  if (!Array.isArray(raw.horses)) bad("所有馬");
  const horses = raw.horses.map(checkHorse);
  if (new Set(horses.map((h) => h.id)).size !== horses.length) bad("馬のID重複");
  if (!Array.isArray(raw.history)) bad("戦績");
  const m = raw.market;
  if (!isObj(m) || !Array.isArray(m.offers) || !isNum(m.racesAtRefresh, 0)) bad("販売リスト");
  m.offers.forEach((o, i) => {
    if (!isObj(o) || !isStr(o.offerId) || !isNum(o.price, 0)) bad("販売リスト");
    checkHorse({ ...(o.horse as object), id: `offer${i}`, ownerId: "market" }, i);
  });
  const c = raw.counters;
  if (!isObj(c) || !isNum(c.horseSeq, 0) || !isNum(c.raceSeq, 0)) bad("カウンタ");
  if (!isStr(raw.createdAt) || !isStr(raw.updatedAt)) bad("日時");
  return raw as unknown as OfflineSave;
}

export function loadSave(kv: KeyValueStore): { save: OfflineSave | null; error?: string } {
  const text = kv.getItem(SAVE_KEY);
  if (!text) return { save: null };
  try {
    return { save: parseSave(JSON.parse(text)) };
  } catch (e) {
    // 壊れたデータは消さずに退避しておく
    kv.setItem(BACKUP_KEY, text);
    kv.removeItem(SAVE_KEY);
    const msg = e instanceof GameError ? e.message : "セーブデータを読み込めませんでした";
    return { save: null, error: `${msg}。壊れたデータは退避し、新しく始められる状態にしました。` };
  }
}

export function writeSave(kv: KeyValueStore, save: OfflineSave): void {
  kv.setItem(SAVE_KEY, JSON.stringify(save));
}

export function deleteSave(kv: KeyValueStore): void {
  kv.removeItem(SAVE_KEY);
}

export function exportSave(save: OfflineSave): string {
  return JSON.stringify(save, null, 2);
}

export function importSave(text: string): OfflineSave {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new GameError("ファイルの形式が正しくありません（JSONではありません）");
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
