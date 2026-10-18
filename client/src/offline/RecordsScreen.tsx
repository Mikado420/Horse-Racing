// オフライン：記録（これまでの馬と成績）
import { RACE_PROGRAMS, formatRaceTime } from "@owners/shared";
import { yen } from "../format";
import { hallOfFame } from "./engine";
import type { OfflineGame } from "./useOfflineGame";

export function RecordsScreen({ game }: { game: OfflineGame }) {
  const save = game.save!;
  const fame = hallOfFame(save);
  const byProgram = RACE_PROGRAMS.map((p) => {
    const rs = save.history.filter((r) => r.programId === p.id);
    const best = rs.reduce<number | null>((b, r) => (b === null || r.timeMs < b ? r.timeMs : b), null);
    return { p, runs: rs.length, wins: rs.filter((r) => r.position === 1).length, best };
  });
  const p = save.player;

  return (
    <div className="page">
      <h1 className="page-title">記録</h1>
      <p className="lead">
        {p.username} 厩舎 ・ 通算 {p.races}戦 {p.wins}勝 ・ 獲得賞金 {yen(p.totalPrize)}
      </p>

      <h2 className="section-title">これまでの馬</h2>
      <table className="table ranking">
        <thead>
          <tr>
            <th>順位</th>
            <th>馬名</th>
            <th className="num">戦績</th>
            <th className="num">獲得賞金</th>
            <th>状態</th>
          </tr>
        </thead>
        <tbody>
          {fame.map((h, i) => (
            <tr key={h.id}>
              <td className={`rank rank-${i + 1}`}>{i + 1}</td>
              <td>{h.name}</td>
              <td className="num">
                {h.races}戦{h.wins}勝
              </td>
              <td className="num">{yen(h.totalPrize)}</td>
              <td>{h.retired ? "引退" : "現役"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="section-title">クラス別</h2>
      <table className="table">
        <thead>
          <tr>
            <th>レース</th>
            <th className="num">出走</th>
            <th className="num">勝利</th>
            <th className="num">最高タイム</th>
          </tr>
        </thead>
        <tbody>
          {byProgram.map(({ p: prog, runs, wins, best }) => (
            <tr key={prog.id}>
              <td>{prog.name}</td>
              <td className="num">{runs}</td>
              <td className="num">{wins}</td>
              <td className="num">{best === null ? "—" : formatRaceTime(best)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">オンライン対戦のランキングは、オンラインモードで見られます。</p>
    </div>
  );
}
