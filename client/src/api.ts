// REST API クライアント
import type { Horse, PlayerProfile, Stats, StarterTemplate, CourseDef, ResultRow } from "@owners/shared";

const TOKEN_KEY = "owners.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ストレージが使えない環境では保存しない */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "サーバーに接続できません。サーバーが起動しているか確認してください");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `エラー (${res.status})`);
  return data as T;
}

export interface AuthResponse {
  token: string;
  player: PlayerProfile;
}
export interface MeResponse {
  player: PlayerProfile;
  horses: Horse[];
}
export interface HistoryRow {
  raceId: string;
  courseName: string;
  distance: number;
  fieldSize: number;
  position: number;
  timeMs: number;
  prize: number;
  createdAt: string;
}
export interface GameInfo {
  economy: { trainingCost: number; entryFee: number; startingMoney: number };
  course: CourseDef;
  starters: StarterTemplate[];
}
export interface Rankings {
  players: { rank: number; playerId: string; username: string; totalPrize: number; races: number; wins: number }[];
  horses: { rank: number; horseId: string; horseName: string; owner: string; totalPrize: number; races: number; wins: number }[];
}
export interface MyRace {
  raceId: string;
  courseName: string;
  distance: number;
  fieldSize: number;
  horseName: string;
  position: number;
  prize: number;
  createdAt: string;
}

export const api = {
  register: (username: string, password: string) => request<AuthResponse>("/auth/register", { body: { username, password } }),
  login: (username: string, password: string) => request<AuthResponse>("/auth/login", { body: { username, password } }),
  me: () => request<MeResponse>("/me"),
  myRaces: () => request<{ races: MyRace[] }>("/me/races"),
  gameInfo: () => request<GameInfo>("/game-info"),
  selectStarter: (templateId: string, name: string) => request<{ horse: Horse }>("/starters", { body: { templateId, name } }),
  horse: (id: string) => request<{ horse: Horse; history: HistoryRow[] }>(`/horses/${id}`),
  train: (id: string, menu: keyof Stats) =>
    request<{ horse: Horse; gains: Partial<Stats>; injured: boolean; conditionDelta: number; money: number }>(
      `/horses/${id}/train`,
      { body: { menu } },
    ),
  rest: (id: string) =>
    request<{ horse: Horse; fatigueDelta: number; conditionDelta: number }>(`/horses/${id}/rest`, { body: {} }),
  rankings: () => request<Rankings>("/rankings"),
  race: (id: string) => request<{ id: string; courseName: string; results: ResultRow[] }>(`/races/${id}`),
};
