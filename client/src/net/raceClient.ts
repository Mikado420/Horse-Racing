// Colyseus 接続（出走登録・観戦）。クライアントは状態を「受け取って表示する」だけで、
// 着順や賞金に関わる値をサーバーへ送ることはない。
import { useCallback, useEffect, useRef, useState } from "react";
import { Client, type Room } from "colyseus.js";
import { ROOM_NAME, type LobbyStateMsg, type RaceResultMsg, type RaceStartMsg, type SyncMsg } from "@owners/shared";

const RECONNECT_KEY = "owners.reconnectToken";

export function serverUrl(): string {
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  // HTTPS で公開しているページからは暗号化された WebSocket（wss）でしか接続できない
  if (env) return location.protocol === "https:" ? env.replace(/^ws:\/\//, "wss://") : env;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  // 開発時（Vite）はゲームサーバーの 2567 番へ、本番は同じホストへ接続
  return import.meta.env.DEV ? `${proto}://${location.hostname}:2567` : `${proto}://${location.host}`;
}

function readReconnectToken(): string | null {
  try {
    return sessionStorage.getItem(RECONNECT_KEY);
  } catch {
    return null;
  }
}
function writeReconnectToken(t: string | null) {
  try {
    if (t) sessionStorage.setItem(RECONNECT_KEY, t);
    else sessionStorage.removeItem(RECONNECT_KEY);
  } catch {
    /* 保存できない環境では再読み込み後の復帰をあきらめる */
  }
}

export function hasPendingReconnect(): boolean {
  return readReconnectToken() !== null;
}

export type ConnStatus = "idle" | "joining" | "connected" | "reconnecting" | "closed";

export interface RaceConnection {
  status: ConnStatus;
  lobby: LobbyStateMsg | null;
  race: RaceStartMsg | null;
  result: RaceResultMsg | null;
  error: string | null;
  /** サーバー時刻の推定値(ms) */
  serverNow: () => number;
  join: (token: string, horseId: string) => Promise<void>;
  leave: () => void;
  reset: () => void;
}

export function useRaceConnection(): RaceConnection {
  const clientRef = useRef<Client | null>(null);
  const roomRef = useRef<Room | null>(null);
  const leavingRef = useRef(false);
  const reconnectingRef = useRef(false);
  const offsetRef = useRef(0);
  const [status, setStatus] = useState<ConnStatus>("idle");
  const [lobby, setLobby] = useState<LobbyStateMsg | null>(null);
  const [race, setRace] = useState<RaceStartMsg | null>(null);
  const [result, setResult] = useState<RaceResultMsg | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getClient = () => (clientRef.current ??= new Client(serverUrl()));
  const syncClock = (serverNow: number) => {
    offsetRef.current = serverNow - Date.now();
  };
  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  const attach = useCallback((room: Room) => {
    roomRef.current = room;
    leavingRef.current = false;
    writeReconnectToken(room.reconnectionToken);
    setStatus("connected");
    room.onMessage("lobby", (m: LobbyStateMsg) => {
      syncClock(m.serverNow);
      setLobby(m);
    });
    room.onMessage("race_start", (m: RaceStartMsg) => {
      syncClock(m.serverNow);
      setRace(m);
    });
    room.onMessage("race_result", (m: RaceResultMsg) => {
      syncClock(m.serverNow);
      setResult(m);
    });
    room.onMessage("sync", (m: SyncMsg) => {
      syncClock(m.lobby.serverNow);
      setLobby(m.lobby);
      setRace(m.race);
      setResult(m.result);
    });
    room.onMessage("error", (m: { message: string }) => setError(m.message));
    room.onLeave(() => {
      roomRef.current = null;
      if (leavingRef.current) {
        writeReconnectToken(null);
        setStatus("closed");
        return;
      }
      // 意図しない切断：再接続を試みる（サーバー側ではレースはそのまま進行している）
      void reconnect();
    });
    room.send("sync");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reconnect = useCallback(async () => {
    const token = readReconnectToken();
    if (!token) {
      setStatus("closed");
      return;
    }
    if (reconnectingRef.current) return;
    reconnectingRef.current = true;
    setStatus("reconnecting");
    try {
      for (let attempt = 0; attempt < 15; attempt++) {
        try {
          const room = await getClient().reconnect(token);
          attach(room);
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      writeReconnectToken(null);
      setStatus("closed");
      setError("サーバーとの接続が切れました。レース結果は戦績から確認できます。");
    } finally {
      reconnectingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attach]);

  // ページ再読み込み後でも、直前のレースに戻る
  useEffect(() => {
    if (readReconnectToken() && !roomRef.current) void reconnect();
  }, [reconnect]);

  const join = useCallback(
    async (token: string, horseId: string) => {
      setError(null);
      setLobby(null);
      setRace(null);
      setResult(null);
      setStatus("joining");
      try {
        const room = await getClient().joinOrCreate(ROOM_NAME, { token, horseId });
        attach(room);
      } catch (e) {
        setStatus("idle");
        setError((e as Error).message || "出走登録に失敗しました");
      }
    },
    [attach],
  );

  const leave = useCallback(() => {
    leavingRef.current = true;
    writeReconnectToken(null);
    const room = roomRef.current;
    if (room) room.leave(true);
    else setStatus("closed");
  }, []);

  const reset = useCallback(() => {
    setLobby(null);
    setRace(null);
    setResult(null);
    setError(null);
    setStatus("idle");
  }, []);

  return { status, lobby, race, result, error, serverNow, join, leave, reset };
}
