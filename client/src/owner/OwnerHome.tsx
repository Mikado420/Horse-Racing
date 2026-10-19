// 馬主ホーム「オーナーズ・デスク」：今週の判断 → 注目馬 → 厩舎報告 → 週送り
import { useState, type CSSProperties } from "react";
import { findProgramById, type WeeklyReport } from "@owners/shared";
import { useOwner } from "./context";
import { BottomSheet, EmptyState, useBusy, useConfirm, useToast } from "./feedback";
import { HorseFigure, PastureScene, SEASON_LABELS, seasonOf, type HorsePose } from "./art";
import { Icon } from "./icons";
import { ReportSheet } from "./actions";
import { ImportanceTag, trainerName, yen, yenSigned } from "./ui";
import { todos, type TodoItem, type ReportVM } from "./vm";

export function TodoList({ items, onAct, variant = "list" }: { items: TodoItem[]; onAct?: () => void; variant?: "list" | "cards" }) {
  const { nav, vm } = useOwner();
  const [report, setReport] = useState<ReportVM | null>(null);
  if (items.length === 0) {
    return (
      <EmptyState icon="check" title="今週急いで決めることはありません">
        週を進めると、厩舎から新しい報告が届きます。
      </EmptyState>
    );
  }
  const act = (t: TodoItem) => {
    const a = t.action;
    if (a.to === "report") {
      const r = vm.reports.find((x) => x.id === a.arg);
      if (r) return setReport(r);
    }
    onAct?.();
    if (a.to === "horse") nav.push(a.arg ? { tab: "horses", horseId: a.arg, detail: true, horseTab: "care" } : { tab: "horses" });
    else if (a.to === "race") nav.push({ tab: "race", horseId: a.arg });
    else if (a.to === "analysis") nav.push({ tab: "records", sub: "analysis", raceId: a.arg });
    else if (a.to === "shop") nav.push({ tab: "shop" });
  };
  if (variant === "cards")
    return (
      <>
        <ul className="todo-cards">
          {items.map((t) => (
            <li key={t.id}>
              <button className={`todo-card lv-${t.importance}`} onClick={() => act(t)}>
                <span className="todo-card-tag">
                  <ImportanceTag level={t.importance} />
                </span>
                <strong className="todo-card-title">{t.title}</strong>
                <span className="todo-card-detail">{t.detail}</span>
                <span className="todo-card-go">
                  {t.action.label}
                  <Icon name="next" size={14} />
                </span>
              </button>
            </li>
          ))}
        </ul>
        {report && <ReportSheet r={report} onClose={() => setReport(null)} />}
      </>
    );
  return (
    <>
      <ul className="todos">
        {items.map((t) => (
          <li key={t.id} className={`todo imp-border-${t.importance}`}>
            <div className="todo-text">
              <ImportanceTag level={t.importance} />
              <strong>{t.title}</strong>
              <span>{t.detail}</span>
            </div>
            <button className="btn btn-small" onClick={() => act(t)}>
              {t.action.label}
            </button>
          </li>
        ))}
      </ul>
      {report && <ReportSheet r={report} onClose={() => setReport(null)} />}
    </>
  );
}

interface WeekSummary {
  weeks: number;
  moneyDelta: number;
  reports: WeeklyReport[];
  notices: string[];
}

/** 牧場に並べる位置（x：左右 0〜1、y：足元の高さ %、s：大きさ）。手前ほど大きい */
const SPOTS: { x: number; y: number; yp: number; s: number; pose: HorsePose; flip: boolean }[] = [
  { x: 0.42, y: 77, yp: 90, s: 1, pose: "stand", flip: false },
  { x: 0.84, y: 67, yp: 60, s: 0.8, pose: "graze", flip: true },
  { x: 0.1, y: 69, yp: 62, s: 0.8, pose: "graze", flip: false },
  { x: 0.66, y: 81, yp: 98, s: 1.04, pose: "stand", flip: true },
  { x: 0.98, y: 79, yp: 76, s: 0.92, pose: "stand", flip: true },
  { x: 0.2, y: 83, yp: 99, s: 1.02, pose: "graze", flip: false },
];

export function OwnerHome() {
  const { game, vm, save, nav, markRead, sound } = useOwner();
  const toast = useToast();
  const confirm = useConfirm();
  const { busy, run } = useBusy();
  const [report, setReport] = useState<ReportVM | null>(null);
  const [summary, setSummary] = useState<WeekSummary | null>(null);
  const items = todos(save, vm);
  const season = seasonOf(save.week);
  const unread = vm.reports.filter((r) => r.unread);
  const latest = [...vm.reports].sort((a, b) => b.report.week - a.report.week)[0];
  const placed = vm.horses.slice(0, SPOTS.length).map((h, i) => ({ h, spot: SPOTS[i] }));
  const more = vm.horses.length - placed.length;

  const advance = (weeks: number) =>
    run(async () => {
      // 目標レースの週に出走せずに進めようとしたら確認する（止めはしない）
      const missing = vm.horses.filter((h) => {
        const g = h.view.policy.goalRaceId ? findProgramById(h.view.policy.goalRaceId) : null;
        return g && g.week === save.week && h.view.racedWeek !== save.week;
      });
      if (missing.length && !(await confirm({ title: "目標レースの週です", body: `${missing.map((h) => h.view.name).join("、")}の目標レースが今週あります。出走せずに週を進めますか？`, okLabel: "このまま進める" }))) return;
      const before = save.player.money;
      try {
        const r = game.advance(weeks);
        const after = r.save.player.money;
        const res: WeekSummary = { weeks: Math.max(1, new Set(r.reports.map((x) => x.week)).size), moneyDelta: after - before, reports: r.reports, notices: r.notices };
        setSummary(res);
        if (r.reports.some((x) => x.alerts.length)) sound("report");
      } catch (e) {
        toast((e as Error).message, "error");
      }
    });

  const openReport = (r: ReportVM) => {
    setReport(r);
    markRead([r.id]);
  };
  const openHorse = (id: string) => nav.push({ tab: "horses", horseId: id, detail: true, horseTab: "overview" });

  return (
    <div className="screen home3" data-season={season}>
      <section className="home-scene" aria-label={`牧場（${SEASON_LABELS[season]}）`}>
        <PastureScene season={season} />
        <p className="home-meta">
          <span>
            <Icon name="horse" size={14} />
            現役 {vm.horses.length}頭
          </span>
          <span>
            預託料 <strong>{yen(vm.fees)}</strong>／週
          </span>
        </p>
        {vm.horses.length === 0 ? (
          <div className="home-empty">
            <p>牧場に馬がいません</p>
            <button className="btn btn-primary" onClick={() => nav.push({ tab: "shop" })}>
              <Icon name="cart" />
              馬を買う
            </button>
          </div>
        ) : (
          <ul className="paddock" aria-label="所有馬">
            {placed.map(({ h, spot }) => (
              <li
                key={h.view.id}
                className="paddock-spot"
                style={{ "--x": spot.x, "--y": `${spot.y}%`, "--yp": `${spot.yp}%`, "--s": spot.s, zIndex: Math.round(spot.y) } as CSSProperties}
              >
                <button className="paddock-horse" onClick={() => openHorse(h.view.id)} aria-label={`${h.view.name}（${h.condition.label}）の詳細`}>
                  <span className={`paddock-tag tag-${h.condition.level}`}>
                    <span className="paddock-name">{h.view.name}</span>
                    {h.unreadReports > 0 && (
                      <span className="paddock-rep" title={`未確認の報告 ${h.unreadReports}件`}>
                        <Icon name="report" size={12} />
                        {h.unreadReports}
                      </span>
                    )}
                  </span>
                  <HorseFigure horseId={h.view.id} pose={spot.pose} flip={spot.flip} />
                </button>
              </li>
            ))}
            {more > 0 && (
              <li className="paddock-more">
                <button className="link2" onClick={() => nav.switchTab("horses")}>
                  ほか{more}頭
                </button>
              </li>
            )}
          </ul>
        )}
        <TrainerVoice latest={latest} unread={unread.length} onOpen={openReport} onAll={() => nav.switchTab("stable")} />
      </section>

      <aside className="home-todo" aria-label="今週の判断">
        <header className="home-todo-head">
          <h2>今週の判断</h2>
          <span>{items.length ? `${items.length}件` : ""}</span>
        </header>
        <div className="home-todo-body scroll">
          <TodoList items={items} variant="cards" />
        </div>
      </aside>

      <div className="home-next">
        <button className="btn-next4" disabled={busy || vm.horses.length === 0} onClick={() => advance(4)}>
          4週
          <small>まとめて</small>
        </button>
        <button className="btn-next" disabled={busy || vm.horses.length === 0} onClick={() => advance(1)} aria-busy={busy} aria-label="1週進める">
          {busy ? <span className="spinner" aria-hidden /> : <Icon name="next" size={26} />}
          <span className="btn-next-label">次の週へ</span>
        </button>
      </div>

      {report && <ReportSheet r={report} onClose={() => setReport(null)} />}
      {summary && (
        <BottomSheet
          title={summary.weeks > 1 ? `${summary.weeks}週の結果` : "今週の結果"}
          onClose={() => setSummary(null)}
          actions={
            <>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setSummary(null);
                  nav.switchTab("stable");
                }}
              >
                報告を読む
              </button>
              <button className="btn btn-primary" onClick={() => setSummary(null)}>
                閉じる
              </button>
            </>
          }
        >
          <WeekResult s={summary} />
        </BottomSheet>
      )}
    </div>
  );
}

/** 調教師のひとこと：いちばん新しい報告を吹き出しで */
function TrainerVoice({ latest, unread, onOpen, onAll }: { latest?: ReportVM; unread: number; onOpen: (r: ReportVM) => void; onAll: () => void }) {
  if (!latest)
    return (
      <div className="voice is-empty">
        <span className="voice-crest" aria-hidden>
          <Icon name="stable" size={18} />
        </span>
        <p className="voice-text">週を進めると、預けた厩舎から調教の様子が届きます。</p>
      </div>
    );
  const name = trainerName(latest.report.trainerId);
  return (
    <div className={`voice lv-${latest.importance}`}>
      <button className="voice-main" onClick={() => onOpen(latest)}>
        <span className="voice-crest" aria-hidden>
          {name.slice(0, 1)}
        </span>
        <span className="voice-body">
          <span className="voice-who">
            {name}調教師
            <span className="voice-horse">{latest.report.horseName}</span>
            {latest.unread && <span className="unread-dot" aria-label="未確認" />}
          </span>
          <span className="voice-text">「{latest.summary}」</span>
        </span>
      </button>
      {unread > 1 && (
        <button className="voice-more" onClick={onAll}>
          未確認 {unread}件
        </button>
      )}
    </div>
  );
}

function WeekResult({ s }: { s: WeekSummary }) {
  const alerts = s.reports.flatMap((r) => r.alerts.map((a) => `${r.horseName}：${a}`));
  const found = s.reports.flatMap((r) => r.discoveries.map((d) => `${r.horseName}：${d}`));
  const byHorse = new Map<string, WeeklyReport>();
  for (const r of s.reports) byHorse.set(r.horseId, r);
  return (
    <div className="week-result">
      <p className="week-money">
        <Icon name="coin" />
        資金の変化 <strong className={s.moneyDelta < 0 ? "minus2" : "plus2"}>{yenSigned(s.moneyDelta)}</strong>
        <span className="muted">（預託料など）</span>
      </p>
      {alerts.map((a, i) => (
        <p key={`a${i}`} className="alert-line">
          <Icon name="alert" size={16} />
          {a}
        </p>
      ))}
      {found.map((d, i) => (
        <p key={`d${i}`} className="discovery">
          <Icon name="spark" size={16} />
          {d}
        </p>
      ))}
      <h3 className="settings-sub">育成の結果</h3>
      <ul className="plain-list">
        {[...byHorse.values()].map((r) => (
          <li key={r.horseId}>
            <strong>{r.horseName}</strong>：{r.planLabel}
            {r.workout ? `（${r.workout}）` : ""}
          </li>
        ))}
      </ul>
      {s.notices.map((n, i) => (
        <p key={`n${i}`} className="hint2">
          {n}
        </p>
      ))}
    </div>
  );
}
