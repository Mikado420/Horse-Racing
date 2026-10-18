import { useEffect, useState, type ReactNode } from "react";
import { STYLE_LABELS, canRace } from "@owners/shared";
import type { MeResponse, MyRace } from "../api";
import { useBackend } from "../backend";
import { Gauge } from "../components";
import { conditionLabel, yen } from "../format";
import type { Screen } from "../App";

export function HomeScreen({ me, go, onLogout, footer }: { me: MeResponse; go: (s: Screen) => void; onLogout: () => void; footer?: ReactNode }) {
  const backend = useBackend();
  const [races, setRaces] = useState<MyRace[] | null>(null);
  useEffect(() => {
    backend.myRaces().then(setRaces, () => setRaces([]));
  }, [backend, me]);
  const p = me.player;

  return (
    <div className="page">
      <section className="owner-strip">
        <div>
          <h1 className="page-title">{p.username} 厩舎</h1>
          <p className="muted">
            通算 {p.races}戦 {p.wins}勝 ・ 獲得賞金 {yen(p.totalPrize)}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => go({ name: "race" })}>
          {backend.mode === "offline" ? "レースに出る" : "レースに出走登録"}
        </button>
      </section>

      <h2 className="section-title">所有馬</h2>
      <ul className="horse-list">
        {me.horses.map((h) => {
          const blocked = canRace(h);
          return (
            <li key={h.id}>
              <button className="horse-row" onClick={() => go({ name: "horse", horseId: h.id })}>
                <span className="horse-row-name">
                  <strong>{h.name}</strong>
                  <span className="tag">{STYLE_LABELS[h.style]}</span>
                  {h.injuryRestsLeft > 0 && <span className="tag tag-bad">故障</span>}
                </span>
                <span className="horse-row-meta">
                  <span>
                    疲労 <Gauge value={h.fatigue} />
                    {h.fatigue}
                  </span>
                  <span>調子 {conditionLabel(h.condition)}</span>
                  <span>
                    {h.races}戦{h.wins}勝
                  </span>
                </span>
                <span className={`horse-row-status ${blocked ? "is-blocked" : ""}`}>{blocked ?? "出走できます"}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <h2 className="section-title">最近の戦績</h2>
      {races === null ? (
        <p className="muted">読み込み中…</p>
      ) : races.length === 0 ? (
        <p className="muted">まだレースに出ていません。調教で仕上げたら出走登録しましょう。</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>日時</th>
              <th>レース</th>
              <th>馬</th>
              <th>着順</th>
              <th className="num">賞金</th>
            </tr>
          </thead>
          <tbody>
            {races.map((r) => (
              <tr key={r.raceId + r.horseName}>
                <td>{new Date(r.createdAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                <td>
                  {r.courseName} {r.distance}m
                </td>
                <td>{r.horseName}</td>
                <td className={r.position === 1 ? "pos-win" : ""}>
                  {r.position}着<small>/{r.fieldSize}頭</small>
                </td>
                <td className="num">{yen(r.prize)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {footer ?? (
        <p className="footer-actions">
          <button className="link" onClick={onLogout}>
            ログアウト
          </button>
        </p>
      )}
    </div>
  );
}
