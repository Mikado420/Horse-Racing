// 馬主モードの画面で共有する状態（ゲーム・表示用データ・画面遷移・画面設定）
import { createContext, useContext } from "react";
import type { OwnerRaceOutcome, OwnerSave, Tactics } from "@owners/shared";
import type { OwnerGame } from "../offline/useOwnerGame";
import type { UiSettings, UiState } from "./uiState";
import type { OwnerVM } from "./vm";

export type HorseTab = "overview" | "care" | "ability" | "reports" | "races" | "owner";
export type StableTab = "training" | "reports" | "trainers";
export type RecordsTab = "races" | "analysis" | "evals" | "ledger" | "lab";

export type Route =
  | { tab: "home" }
  | { tab: "horses"; horseId?: string; detail?: boolean; horseTab?: HorseTab }
  | { tab: "shop" }
  | { tab: "stable"; sub?: StableTab; reportId?: string; horseId?: string }
  | { tab: "race"; horseId?: string; programId?: string }
  | { tab: "records"; sub?: RecordsTab; raceId?: string; horseId?: string };

export type NavTab = "home" | "horses" | "stable" | "race" | "records";

export interface Nav {
  route: Route;
  /** 同じタブの中で深く進む（戻る操作で戻れる） */
  push(r: Route): void;
  /** 今の画面を置き換える（タブ内の切り替え・選択） */
  replace(r: Route): void;
  /** 主要メニュー：タブの最初の画面へ */
  switchTab(t: NavTab): void;
  back(): void;
  canBack: boolean;
}

export interface OwnerCtxValue {
  game: OwnerGame;
  save: OwnerSave;
  vm: OwnerVM;
  nav: Nav;
  ui: UiState;
  setSettings(p: Partial<UiSettings>): void;
  markRead(ids: string[]): void;
  /** 出走を確定してレース観戦へ */
  startRace(horseId: string, programId: string, tactics: Tactics): OwnerRaceOutcome;
  sound(id: "tap" | "report" | "start" | "goal" | "win"): void;
  openSettings(): void;
}

export const OwnerCtx = createContext<OwnerCtxValue | null>(null);
export function useOwner(): OwnerCtxValue {
  const v = useContext(OwnerCtx);
  if (!v) throw new Error("OwnerCtx がありません");
  return v;
}

export function tabOf(r: Route): NavTab {
  return r.tab === "shop" ? "horses" : r.tab;
}
