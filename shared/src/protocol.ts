// サーバー ⇔ クライアント間のメッセージ定義

import type { CourseDef, Going, Weather } from "./types";

export const ROOM_NAME = "race";

/**
 * registering: 出走登録受付中 / closing: 締切後、サーバーで計算・精算中
 * running: 再生中（結果はサーバーで確定済み） / finished: 結果発表済み / cancelled: 中止
 */
export type LobbyPhase = "registering" | "closing" | "running" | "finished" | "cancelled";

export interface LobbyEntryView {
  gate: number;
  playerId: string;
  playerName: string;
  horseId: string;
  horseName: string;
  style: string;
}

export interface LobbyStateMsg {
  raceId: string;
  phase: LobbyPhase;
  entries: LobbyEntryView[];
  /** 出走登録の締切時刻（サーバー時刻ms）。登録が0件なら null */
  deadlineAt: number | null;
  minRunners: number;
  maxRunners: number;
  serverNow: number;
  message?: string;
}

export interface RaceStartMsg {
  raceId: string;
  courseName: string;
  distance: number;
  surface: string;
  going: Going;
  weather: Weather;
  /** frames の列順に対応する出走馬 */
  runners: LobbyEntryView[];
  frames: number[][];
  sampleDt: number;
  durationSec: number;
  /** finishOrder[k] = k着馬の runners インデックス（再生中の順位表示に使う） */
  finishOrder: number[];
  /** 各馬の内ラチからの位置(m)。frames と同じ並び（馬主モードのみ。なければ描画側で決める） */
  lanes?: number[][];
  /** 走るコース（馬主モードのみ。なければ既定のコース） */
  course?: CourseDef;
  /** 再生開始のサーバー時刻(ms) */
  startAt: number;
  /** 再生速度（2なら実時間の2倍速） */
  replaySpeed: number;
  serverNow: number;
}

export interface ResultRow {
  position: number;
  gate: number;
  horseId: string;
  horseName: string;
  playerId: string;
  playerName: string;
  timeMs: number;
  marginLengths: number;
  prize: number;
}

export interface RaceResultMsg {
  raceId: string;
  results: ResultRow[];
  serverNow: number;
}

/** 再接続・途中参加時の全量同期 */
export interface SyncMsg {
  lobby: LobbyStateMsg;
  race: RaceStartMsg | null;
  result: RaceResultMsg | null;
}

export interface ErrorMsg {
  message: string;
}
