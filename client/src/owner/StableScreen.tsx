// 厩舎：報告一覧（要約 → タップで詳細と直接操作）と調教師
import { useState } from "react";
import { TRAINERS } from "@owners/shared";
import { ScreenHead } from "./AppShell";
import { ReportSheet } from "./actions";
import { useOwner, type Route, type StableTab } from "./context";
import { EmptyState } from "./feedback";
import { Icon } from "./icons";
import { StableReportCard, Tabs, yen } from "./ui";
import type { ReportVM } from "./vm";

type StableRoute = Extract<Route, { tab: "stable" }>;
type Filter = "all" | "unread" | "reply" | "urgent";

export function StableScreen({ route }: { route: StableRoute }) {
  const { nav, vm } = useOwner();
  const sub = route.sub ?? "reports";
  const unread = vm.reports.filter((r) => r.unread).length;
  return (
    <div className="screen">
      <div className="head-tabs">
        <ScreenHead nav={nav} title="厩舎" sub={unread ? `未確認の報告 ${unread}件` : "報告はすべて確認済み"} />
        <Tabs<StableTab>
          label="厩舎"
          value={sub}
          items={[
            ["reports", "報告"],
            ["trainers", "調教師"],
          ]}
          onChange={(t) => nav.replace({ tab: "stable", sub: t })}
        />
      </div>
      <div className="tab-body scroll">{sub === "reports" ? <Reports initial={route.reportId} /> : <Trainers />}</div>
    </div>
  );
}

function Reports({ initial }: { initial?: string }) {
  const { vm, markRead } = useOwner();
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<ReportVM | null>(() => vm.reports.find((r) => r.id === initial) ?? null);
  const list = vm.reports.filter((r) => (filter === "unread" ? r.unread : filter === "reply" ? r.needsReply : filter === "urgent" ? r.importance === "urgent" : true)).slice(0, 60);
  const unread = vm.reports.filter((r) => r.unread);
  const filters: [Filter, string][] = [
    ["all", "すべて"],
    ["unread", `未確認 ${unread.length}`],
    ["reply", `回答待ち ${vm.reports.filter((r) => r.needsReply).length}`],
    ["urgent", "緊急"],
  ];
  return (
    <>
      <div className="filter-row">
        <div className="seg2" role="radiogroup" aria-label="絞り込み">
          {filters.map(([f, l]) => (
            <button key={f} role="radio" aria-checked={filter === f} onClick={() => setFilter(f)}>
              {l}
            </button>
          ))}
        </div>
        {unread.length > 0 && (
          <button className="link2" onClick={() => markRead(unread.map((r) => r.id))}>
            すべて確認済みにする
          </button>
        )}
      </div>
      {list.length === 0 ? (
        <EmptyState icon="report" title={filter === "all" ? "まだ報告はありません" : "該当する報告はありません"}>
          {filter === "all" ? "ホームで週を進めると、預けた厩舎から報告が届きます。" : undefined}
        </EmptyState>
      ) : (
        <ul className="report-list grid">
          {list.map((r) => (
            <li key={r.id}>
              <StableReportCard
                r={r}
                onOpen={() => {
                  setOpen(r);
                  markRead([r.id]);
                }}
              />
            </li>
          ))}
        </ul>
      )}
      {open && <ReportSheet r={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Trainers() {
  const { save, vm, nav } = useOwner();
  return (
    <>
      <p className="hint2">
        調教の腕と馬を見る目は数値では公開されていません。預けた馬の見立てが、その後の実戦や分析でどれだけ修正されたかが判断材料になります。
      </p>
      <ul className="trainer-cards2">
        {TRAINERS.map((t) => {
          const horses = vm.allHorses.filter((h) => h.trainerId === t.id);
          const races = save.races.filter((r) => r.trainerId === t.id);
          const wins = races.filter((r) => r.position === 1).length;
          const revised = horses.reduce((a, h) => a + h.knowledgeEvents.filter((e) => e.type === "revise").length, 0);
          const found = horses.reduce((a, h) => a + h.knowledgeEvents.filter((e) => e.type === "stage").length, 0);
          return (
            <li key={t.id} className="trainer-card2">
              <h2 className="horse-name">{t.name}</h2>
              <p className="muted">
                開業{t.experience}年／{yen(t.weeklyFee)}／週
              </p>
              <p className="trainer-spec">
                <Icon name="spark" size={14} />
                得意：{t.specialties.note}
              </p>
              <p>{t.profile}</p>
              <dl className="facts compact">
                <div>
                  <dt>あなたの馬での実績</dt>
                  <dd>
                    {races.length}戦{wins}勝
                  </dd>
                </div>
                <div>
                  <dt>見立ての修正</dt>
                  <dd>{found ? `判明${found}件のうち修正${revised}件` : "まだ実績なし"}</dd>
                </div>
              </dl>
              {horses.filter((h) => h.status === "active").length > 0 && (
                <p className="trainer-horses2">
                  預けている馬：
                  {horses
                    .filter((h) => h.status === "active")
                    .map((h) => (
                      <button key={h.id} className="link2" onClick={() => nav.push({ tab: "horses", horseId: h.id, detail: true, horseTab: "overview" })}>
                        {h.name}
                      </button>
                    ))}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
