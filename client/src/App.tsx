import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, getToken, setToken, type MeResponse } from "./api";
import { BackendContext, OFFLINE_ONLY, loadMode, onlineBackend, saveMode, type GameMode } from "./backend";
import { yen } from "./format";
import { TitleScreen } from "./screens/TitleScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { StarterScreen } from "./screens/StarterScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { HorseScreen } from "./screens/HorseScreen";
import { RaceScreen } from "./screens/RaceScreen";
import { RankingScreen } from "./screens/RankingScreen";
import { hasPendingReconnect, useRaceConnection } from "./net/raceClient";
import { useOwnerGame } from "./offline/useOwnerGame";
import { OwnerApp } from "./owner/OwnerApp";

/** オンライン対戦の画面（オフラインの馬主モードは owner/OwnerApp.tsx） */
export type Screen =
  | { name: "home" }
  | { name: "horse"; horseId: string }
  | { name: "race"; horseId?: string }
  | { name: "rankings" };

export function App() {
  const [mode, setModeState] = useState<GameMode | null>(() => (!OFFLINE_ONLY && hasPendingReconnect() ? "online" : loadMode()));
  // フックは常に同じ順で呼ぶ（どちらのモードでも両方用意しておく）
  const offline = useOwnerGame();
  const conn = useRaceConnection();

  const setMode = (m: GameMode | null) => {
    saveMode(m);
    setModeState(m);
  };

  if (mode === null) return <TitleScreen onPick={setMode} />;
  if (mode === "offline") return <OwnerApp game={offline} onSwitchMode={() => setMode(null)} />;
  return <OnlineApp conn={conn} onSwitchMode={() => setMode(null)} />;
}

/* ---------------- オンライン対戦 ---------------- */

function OnlineApp({ conn, onSwitchMode }: { conn: ReturnType<typeof useRaceConnection>; onSwitchMode: () => void }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<Screen>(() => (hasPendingReconnect() ? { name: "race" } : { name: "home" }));
  const inRace = conn.status === "connected" || conn.status === "reconnecting";

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await api.me());
    } catch {
      setToken(null);
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = () => {
    conn.leave();
    setToken(null);
    setMe(null);
    setScreen({ name: "home" });
  };

  if (loading) return <div className="boot">読み込み中…</div>;
  if (!me) return <LoginScreen onLoggedIn={refresh} onBack={onSwitchMode} />;

  return (
    <BackendContext.Provider value={onlineBackend}>
      {me.horses.length === 0 ? (
        <StarterScreen player={me.player} onSelected={refresh} />
      ) : (
        <Shell
          mode="online"
          screen={screen}
          go={setScreen}
          owner={me.player.username}
          money={me.player.money}
          liveRace={inRace}
          nav={[
            ["home", "厩舎"],
            ["race", "レース"],
            ["rankings", "ランキング"],
          ]}
        >
          {screen.name === "home" && <HomeScreen me={me} go={setScreen} onLogout={logout} />}
          {screen.name === "horse" && <HorseScreen horseId={screen.horseId} money={me.player.money} go={setScreen} onChanged={refresh} />}
          {screen.name === "race" && <RaceScreen me={me} conn={conn} initialHorseId={screen.horseId} go={setScreen} onChanged={refresh} />}
          {screen.name === "rankings" && <RankingScreen myId={me.player.id} />}
        </Shell>
      )}
    </BackendContext.Provider>
  );
}

/* ---------------- 共通の枠 ---------------- */

function Shell({
  mode,
  screen,
  go,
  owner,
  money,
  nav,
  liveRace,
  children,
}: {
  mode: GameMode;
  screen: Screen;
  go: (s: Screen) => void;
  owner: string;
  money: number;
  nav: [Screen["name"], string][];
  liveRace?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`app ${screen.name === "race" ? "app-race" : ""}`}>
      <header className="topbar">
        <button className="brand" onClick={() => go({ name: "home" })}>
          競走馬オーナーズ
          <span className={`mode-badge mode-${mode}`}>{mode === "offline" ? "ひとりで" : "オンライン"}</span>
        </button>
        <nav className="topnav" aria-label="メインメニュー">
          {nav.map(([name, label]) => (
            <button key={name} aria-current={screen.name === name} onClick={() => go({ name } as Screen)}>
              {label}
              {name === "race" && liveRace && screen.name !== "race" && (
                <span className="live-dot" aria-label="参加中のレースがあります" />
              )}
            </button>
          ))}
        </nav>
        <div className="purse" title="所持金">
          <span className="purse-owner">{owner}</span>
          <strong>{yen(money)}</strong>
        </div>
      </header>
      <main className="main">{children}</main>
    </div>
  );
}
