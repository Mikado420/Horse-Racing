// 馬主ホーム「オーナーズ・デスク」：今週の判断 → 注目馬 → 厩舎報告 → 週送り
import { useState } from "react";
import { ABILITY_KEYS, POLICY_DEFS, findProgramById, weekLabel, type WeeklyReport } from "@owners/shared";
import { useOwner } from "./context";
import { BottomSheet, EmptyState, useBusy, useConfirm, useToast } from "./feedback";
import { Icon } from "./icons";
import { ReportSheet } from "./actions";
import { ActionBar, HorseConditionBadge, ImportanceTag, Pane, StableReportCard, StateMeters, yen, yenSigned } from "./ui";
import { todos, type TodoItem, type ReportVM } from "./vm";

export function TodoList({ items, onAct }: { items: TodoItem[]; onAct?: () => void }) {
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

export function OwnerHome() {
  const { game, vm, save, nav, markRead, sound } = useOwner();
  const toast = useToast();
  const confirm = useConfirm();
  const { busy, run } = useBusy();
  const [panel, setPanel] = useState<"horse" | "reports">("horse");
  const [featuredId, setFeaturedId] = useState<string | null>(null);
  const [report, setReport] = useState<ReportVM | null>(null);
  const [summary, setSummary] = useState<WeekSummary | null>(null);
  const items = todos(save, vm);
  const featured = vm.horses.find((h) => h.view.id === featuredId) ?? vm.horses[0];
  const unread = vm.reports.filter((r) => r.unread);
  const recent = vm.reports.slice(0, 12);

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
        const found = r.reports.reduce((a, x) => a + x.discoveries.length, 0);
        if (r.reports.some((x) => x.alerts.length)) sound("report");
        toast(found ? `${res.weeks}週進めました。新しい能力情報が${found}件あります` : `${res.weeks}週進めました`, found ? "good" : "info");
      } catch (e) {
        toast((e as Error).message, "error");
      }
    });

  const openReport = (r: ReportVM) => {
    setReport(r);
    markRead([r.id]);
  };

  return (
    <div className="screen desk">
      <div className="desk-grid">
        <Pane title="今週の判断" className="desk-todo" aside={<span className="pane-note">{weekLabel(save.week)}</span>}>
          <TodoList items={items} />
        </Pane>

        <section className="pane desk-right">
          <header className="pane-head">
            <div className="seg2 pane-switch" role="tablist" aria-label="表示の切り替え">
              <button role="tab" aria-selected={panel === "horse"} onClick={() => setPanel("horse")}>
                <Icon name="horse" size={16} />
                注目馬
              </button>
              <button role="tab" aria-selected={panel === "reports"} onClick={() => setPanel("reports")}>
                <Icon name="report" size={16} />
                厩舎報告{unread.length > 0 && <span className="count">{unread.length}</span>}
              </button>
            </div>
          </header>
          <div className="pane-body desk-panels" data-panel={panel}>
            <div className="desk-horse">
              {!featured ? (
                <EmptyState icon="horse" title="現役の馬がいません" action={<button className="btn btn-primary" onClick={() => nav.push({ tab: "shop" })}>馬を買う</button>} />
              ) : (
                <>
                  {vm.horses.length > 1 && (
                    <div className="chip-row" role="radiogroup" aria-label="注目馬">
                      {vm.horses.map((h) => (
                        <button key={h.view.id} role="radio" aria-checked={h === featured} className="chip" onClick={() => setFeaturedId(h.view.id)}>
                          {h.view.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="featured">
                    <div className="featured-head">
                      <span className="horse-name lg">{featured.view.name}</span>
                      <span className="pill">{featured.view.age}歳</span>
                      <HorseConditionBadge c={featured.condition} />
                    </div>
                    <p className="featured-sub">
                      {featured.trainerName}厩舎／方針「{POLICY_DEFS[featured.view.policy.policy].label}」
                    </p>
                    <p className="featured-plan">
                      <Icon name="clock" size={15} />
                      {featured.nextPlan}
                    </p>
                    <StateMeters s={featured.view.state} compact />
                    <div className="known-row">
                      {ABILITY_KEYS.map((k) => {
                        const kv = featured.view.knowledge[k];
                        return (
                          <span key={k} className={`known stage-${kv.stage}`}>
                            <span>{kv.label}</span>
                            <b>{kv.stage === "numeric" ? kv.value : kv.rank ?? "？"}</b>
                          </span>
                        );
                      })}
                    </div>
                    <div className="btn-row">
                      <button className="btn btn-ghost" onClick={() => nav.push({ tab: "horses", horseId: featured.view.id, detail: true, horseTab: "overview" })}>
                        詳細を見る
                      </button>
                      {featured.runnable > 0 && (
                        <button className="btn btn-primary" onClick={() => nav.push({ tab: "race", horseId: featured.view.id })}>
                          出走を検討
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="desk-reports">
              {recent.length === 0 ? (
                <EmptyState icon="report" title="まだ報告はありません">週を進めると、預けた厩舎から調教の内容と馬の様子が届きます。</EmptyState>
              ) : (
                <>
                  {unread.length > 1 && (
                    <button className="link2" onClick={() => markRead(unread.map((r) => r.id))}>
                      すべて確認済みにする
                    </button>
                  )}
                  <ul className="report-list">
                    {recent.map((r) => (
                      <li key={r.id}>
                        <StableReportCard r={r} onOpen={() => openReport(r)} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        </section>
      </div>

      <ActionBar
        info={
          <>
            <span>
              預託料 <strong>{yen(vm.fees)}</strong>／週
            </span>
            <span className="hide-xs">現役 {vm.horses.length}頭</span>
          </>
        }
      >
        <button className="btn btn-ghost" disabled={busy || vm.horses.length === 0} onClick={() => advance(4)}>
          4週進める
        </button>
        <button className="btn btn-primary btn-week" disabled={busy || vm.horses.length === 0} onClick={() => advance(1)} aria-busy={busy}>
          {busy ? <span className="spinner sm" aria-hidden /> : <Icon name="next" />}
          1週進める
        </button>
      </ActionBar>

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
                  setPanel("reports");
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
