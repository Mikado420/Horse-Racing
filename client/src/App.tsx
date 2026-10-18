import { useCallback, useEffect, useState } from "react";
import { api, getToken, setToken, type MeResponse } from "./api";
import { yen } from "./format";
import { LoginScreen } from "./screens/LoginScreen";
import { StarterScreen } from "./screens/StarterScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { HorseScreen } from "./screens/HorseScreen";
import { RaceScreen } from "./screens/RaceScreen";
import { RankingScreen } from "./screens/RankingScreen";
import { hasPendingReconnect, useRaceConnection } from "./net/raceClient";

export type Screen =
  | { name: "home" }
  | { name: "horse"; horseId: string }
  | { name: "race"; horseId?: string }
  | { name: "rankings" };

export function App() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<Screen>(() => (hasPendingReconnect() ? { name: "race" } : { name: "home" }));
  // レース接続は画面を移動しても維持する（観戦中に厩舎を見に行っても切れない）
  const conn = useRaceConnection();
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
  if (!me) return <LoginScreen onLoggedIn={refresh} />;
  if (me.horses.length === 0) return <StarterScreen player={me.player} onSelected={refresh} />;

  const go = (s: Screen) => setScreen(s);

  return (
    <div className={`app ${screen.name === "race" ? "app-race" : ""}`}>
      <header className="topbar">
        <button className="brand" onClick={() => go({ name: "home" })}>
          競走馬オーナーズ
        </button>
        <nav className="topnav" aria-label="メインメニュー">
          <button aria-current={screen.name === "home"} onClick={() => go({ name: "home" })}>
            厩舎
          </button>
          <button aria-current={screen.name === "race"} onClick={() => go({ name: "race" })}>
            レース
            {inRace && screen.name !== "race" && <span className="live-dot" aria-label="参加中のレースがあります" />}
          </button>
          <button aria-current={screen.name === "rankings"} onClick={() => go({ name: "rankings" })}>
            ランキング
          </button>
        </nav>
        <div className="purse" title="所持金">
          <span className="purse-owner">{me.player.username}</span>
          <strong>{yen(me.player.money)}</strong>
        </div>
      </header>
      <main className="main">
        {screen.name === "home" && <HomeScreen me={me} go={go} onLogout={logout} />}
        {screen.name === "horse" && <HorseScreen horseId={screen.horseId} money={me.player.money} go={go} onChanged={refresh} />}
        {screen.name === "race" && <RaceScreen me={me} conn={conn} initialHorseId={screen.horseId} go={go} onChanged={refresh} />}
        {screen.name === "rankings" && <RankingScreen myId={me.player.id} />}
      </main>
    </div>
  );
}
