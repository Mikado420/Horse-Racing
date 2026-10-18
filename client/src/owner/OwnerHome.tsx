// 馬主のトップ画面：所有馬・厩舎からの報告・週の進行
import { useState, type ReactNode } from "react";
import {
  ABILITY_KEYS,
  AGE_STAGE_LABELS,
  POLICY_DEFS,
  activeHorses,
  entryProblem,
  thisWeekCard,
  toHorseView,
  upcomingFees,
  weekLabel,
  shortWeekLabel,
  type WeeklyReport,
} from "@owners/shared";
import { Notice } from "../components";
import { yen } from "../format";
import type { OwnerGame } from "../offline/useOwnerGame";
import type { OScreen } from "./OwnerApp";
import { StateBlock, trainerName } from "./ui";

export function OwnerHome({ game, go, footer }: { game: OwnerGame; go: (s: OScreen) => void; footer?: ReactNode }) {
  const save = game.save!;
  const [last, setLast] = useState<{ reports: WeeklyReport[]; notices: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const horses = activeHorses(save);
  const card = thisWeekCard(save);
  const fees = upcomingFees(save);
  const p = save.player;

  const advance = (n: number) => {
    setError(null);
    try {
      setLast(game.advance(n));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // 表示する報告：直前に進めた週の分、なければ最新週の分
  const reports = last ? [...last.reports].reverse() : save.reports.length ? save.reports.filter((r) => r.week === save.reports[0].week) : [];

  return (
    <div className="page">
      <section className="owner-strip">
        <div>
          <h1 className="page-title">{p.username} オーナー</h1>
          <p className="muted">
            通算 {p.races}戦{p.wins}勝 ・ 獲得賞金 {yen(p.totalPrize)}
          </p>
        </div>
        <div className="week-box">
          <span className="week-now">{weekLabel(save.week)}</span>
          <span className="muted small">
            来週の預託料 {yen(fees)}（{horses.length}頭）
          </span>
          <div className="week-actions">
            <button className="btn btn-primary" onClick={() => advance(1)} disabled={horses.length === 0}>
              1週進める
            </button>
            <button className="btn" onClick={() => advance(4)} disabled={horses.length === 0}>
              4週進める
            </button>
          </div>
        </div>
      </section>
      {error && <Notice kind="error">{error}</Notice>}
      {p.money < 0 && <Notice kind="error">所持金がマイナスです。馬の売却や出走で資金を立て直してください。</Notice>}
      {last?.notices.map((n, i) => (
        <Notice key={i}>{n}</Notice>
      ))}

      <h2 className="section-title">所有馬</h2>
      {horses.length === 0 ? (
        <p className="muted">
          現役の馬がいません。
          <button className="link" onClick={() => go({ name: "shop" })}>
            馬を買う
          </button>
        </p>
      ) : (
        <ul className="o-horses">
          {horses.map((h) => {
            const v = toHorseView(h, save.week);
            const runnable = card.filter((pr) => !entryProblem(save, h, pr)).length;
            const known = ABILITY_KEYS.map((k) => v.knowledge[k]).filter((x) => x.stage !== "abstract");
            return (
              <li key={h.id}>
                <button className="o-horse" onClick={() => go({ name: "horse", horseId: h.id })}>
                  <span className="o-horse-head">
                    <strong>{h.name}</strong>
                    <span className="tag">{v.age}歳</span>
                    {h.state.injuryWeeks > 0 && <span className="tag tag-bad">故障</span>}
                    {h.racedWeek === save.week && <span className="tag">今週出走済み</span>}
                  </span>
                  <span className="o-horse-sub muted">
                    {trainerName(h.trainerId)}厩舎 ・ 方針「{POLICY_DEFS[h.policy.policy].label}」 ・ {AGE_STAGE_LABELS[v.ageStage]}
                  </span>
                  <StateBlock s={h.state} compact />
                  <span className="o-horse-known">
                    {known.length === 0 ? (
                      <span className="muted">能力はまだ見立ての段階</span>
                    ) : (
                      known.map((k) => (
                        <span key={k.key} className="o-known">
                          {k.label}
                          <b className={`rank-chip rank-${k.rank}`}>{k.stage === "numeric" ? k.value : k.rank}</b>
                        </span>
                      ))
                    )}
                  </span>
                  <span className="o-horse-foot">
                    {h.record.races}戦{h.record.wins}勝 ・ 賞金 {yen(h.record.totalPrize)}
                    {runnable > 0 && <span className="o-runnable">今週出られるレース {runnable}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="section-title">厩舎からの報告</h2>
      {reports.length === 0 ? (
        <p className="muted">週を進めると、預けた厩舎から調教の内容と馬の様子が報告されます。</p>
      ) : (
        <ul className="reports">
          {reports.map((r, i) => (
            <ReportCard key={`${r.horseId}-${r.week}-${i}`} r={r} onOpen={() => go({ name: "horse", horseId: r.horseId })} />
          ))}
        </ul>
      )}
      {save.reports.length > reports.length && (
        <p className="hint">過去の報告は各馬の「履歴」で見られます。</p>
      )}

      {horses.some((h) => card.some((pr) => !entryProblem(save, h, pr))) && (
        <p className="footer-actions">
          <button className="btn btn-primary" onClick={() => go({ name: "race" })}>
            今週のレースを見る
          </button>
        </p>
      )}
      {footer}
    </div>
  );
}

export function ReportCard({ r, onOpen }: { r: WeeklyReport; onOpen?: () => void }) {
  return (
    <li className={`report ${r.alerts.length ? "has-alert" : ""}`}>
      <div className="report-head">
        <span className="report-week">{shortWeekLabel(r.week)}</span>
        <strong>{r.horseName}</strong>
        <span className="muted">
          {trainerName(r.trainerId)}調教師 ・ {r.planLabel}
        </span>
        {onOpen && (
          <button className="link report-open" onClick={onOpen}>
            詳しく
          </button>
        )}
      </div>
      {r.lines.map((l, i) => (
        <p key={i}>{l}</p>
      ))}
      {r.workout && <p className="report-work">調教時計：{r.workout}</p>}
      {r.discoveries.map((d, i) => (
        <p key={i} className="report-discovery">
          {d}
        </p>
      ))}
      {r.alerts.map((a, i) => (
        <p key={i} className="report-alert">
          {a}
        </p>
      ))}
    </li>
  );
}
