// 画面からゲームデータを扱う窓口。オフライン（ブラウザ内で完結）とオンライン（サーバーAPI）で
// 同じ形を持たせ、画面側はどちらのモードかを意識せずに使えるようにする。
import { createContext, useContext } from "react";
import type { Horse, StarterTemplate, Stats } from "@owners/shared";
import { api, type HistoryRow, type MeResponse, type MyRace } from "./api";

export type GameMode = "offline" | "online";

export interface TrainResponse {
  horse: Horse;
  gains: Partial<Stats>;
  injured: boolean;
  conditionDelta: number;
}
export interface RestResponse {
  horse: Horse;
  fatigueDelta: number;
  conditionDelta: number;
}

export interface Backend {
  mode: GameMode;
  me(): Promise<MeResponse>;
  myRaces(): Promise<MyRace[]>;
  starters(): Promise<StarterTemplate[]>;
  selectStarter(templateId: string, name: string): Promise<void>;
  horse(id: string): Promise<{ horse: Horse; history: HistoryRow[] }>;
  train(id: string, menu: keyof Stats): Promise<TrainResponse>;
  rest(id: string): Promise<RestResponse>;
  /** オフラインのみ：引退させて報奨金を受け取る */
  retire?(id: string): Promise<{ bonus: number }>;
}

export const onlineBackend: Backend = {
  mode: "online",
  me: () => api.me(),
  myRaces: async () => (await api.myRaces()).races,
  starters: async () => (await api.gameInfo()).starters,
  selectStarter: async (t, n) => void (await api.selectStarter(t, n)),
  horse: (id) => api.horse(id),
  train: (id, menu) => api.train(id, menu),
  rest: (id) => api.rest(id),
};

export const BackendContext = createContext<Backend>(onlineBackend);
export const useBackend = () => useContext(BackendContext);

/** GitHub Pages 版などサーバーのない公開ではオフラインのみ */
export const OFFLINE_ONLY = import.meta.env.VITE_OFFLINE_ONLY === "true";

const MODE_KEY = "owners.mode";
export function loadMode(): GameMode | null {
  try {
    const m = localStorage.getItem(MODE_KEY);
    if (OFFLINE_ONLY) return m === "offline" ? m : null;
    return m === "offline" || m === "online" ? m : null;
  } catch {
    return null;
  }
}
export function saveMode(m: GameMode | null) {
  try {
    if (m) localStorage.setItem(MODE_KEY, m);
    else localStorage.removeItem(MODE_KEY);
  } catch {
    /* 保存できなくても続行 */
  }
}
