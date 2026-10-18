// 記録：これまでに所有した馬と、お金の出入り
import { shortWeekLabel, toHorseView } from "@owners/shared";
import { yen } from "../format";
import type { OwnerGame } from "../offline/useOwnerGame";
import type { OScreen } from "./OwnerApp";
import { trainerName, yenSigned } from "./ui";

export function RecordsOwner({ game, go }: { game: OwnerGame; go: (s: OScreen) => void }) {
  const save = game.save!;
  const horses = [...save.horses].sort((a, b) => b.record.totalPrize - a.record.totalPrize || b.record.wins - a.record.wins);
  const finance = [...save.finance].reverse().slice(0, 80);
  return (
    <div className="page">
      <h1 className="page-title">記録</h1>
      <h2 className="section-title">所有した馬（獲得賞金順）</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>馬</th>
              <th>年齢</th>
              <th>厩舎</th>
              <th>戦績</th>
              <th className="num">獲得賞金</th>
              <th>状態</th>
            </tr>
          </thead>
          <tbody>
            {horses.map((h) => (
              <tr key={h.id}>
                <td>
                  <button className="link" onClick={() => go({ name: "horse", horseId: h.id })}>
                    {h.name}
                  </button>
                </td>
                <td>{toHorseView(h, save.week).age}歳</td>
                <td>{trainerName(h.trainerId)}</td>
                <td>
                  {h.record.races}戦{h.record.wins}勝（2着{h.record.seconds}・3着{h.record.thirds}）
                </td>
                <td className="num">{yen(h.record.totalPrize)}</td>
                <td>{h.status === "active" ? "現役" : h.status === "retired" ? "引退" : "売却"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 className="section-title">お金の出入り（最近）</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>週</th>
              <th>内容</th>
              <th className="num">金額</th>
            </tr>
          </thead>
          <tbody>
            {finance.map((f, i) => (
              <tr key={i}>
                <td>{shortWeekLabel(f.week)}</td>
                <td>{f.note}</td>
                <td className={`num ${f.amount >= 0 ? "plus" : "minus"}`}>{yenSigned(f.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
