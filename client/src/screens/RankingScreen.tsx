import { useEffect, useState } from "react";
import { api, type Rankings } from "../api";
import { Notice } from "../components";
import { yen } from "../format";

export function RankingScreen({ myId }: { myId: string }) {
  const [data, setData] = useState<Rankings | null>(null);
  const [tab, setTab] = useState<"players" | "horses">("players");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.rankings().then(setData, (e) => setError(e.message));
  }, []);

  return (
    <div className="page">
      <h1 className="page-title">獲得賞金ランキング</h1>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "players"} onClick={() => setTab("players")}>
          オーナー
        </button>
        <button role="tab" aria-selected={tab === "horses"} onClick={() => setTab("horses")}>
          競走馬
        </button>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {!data ? (
        !error && <p className="muted">読み込み中…</p>
      ) : tab === "players" ? (
        <table className="table ranking">
          <thead>
            <tr>
              <th>順位</th>
              <th>オーナー</th>
              <th className="num">戦績</th>
              <th className="num">獲得賞金</th>
            </tr>
          </thead>
          <tbody>
            {data.players.map((p) => (
              <tr key={p.playerId} className={p.playerId === myId ? "is-me" : ""}>
                <td className={`rank rank-${p.rank}`}>{p.rank}</td>
                <td>{p.username}</td>
                <td className="num">
                  {p.races}戦{p.wins}勝
                </td>
                <td className="num">{yen(p.totalPrize)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="table ranking">
          <thead>
            <tr>
              <th>順位</th>
              <th>馬名</th>
              <th>オーナー</th>
              <th className="num">戦績</th>
              <th className="num">獲得賞金</th>
            </tr>
          </thead>
          <tbody>
            {data.horses.map((h) => (
              <tr key={h.horseId}>
                <td className={`rank rank-${h.rank}`}>{h.rank}</td>
                <td>{h.horseName}</td>
                <td>{h.owner}</td>
                <td className="num">
                  {h.races}戦{h.wins}勝
                </td>
                <td className="num">{yen(h.totalPrize)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="hint">シーズン制と報酬は今後追加予定です。現在は通算の獲得賞金で順位を決めています。</p>
    </div>
  );
}
