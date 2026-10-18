// 所有馬：一覧（横向きでは選択中の馬の概要を横に表示）と、馬の詳細（6タブ）
import { useState } from "react";
import {
  DISTANCE_BANDS,
  GOING_LABELS,
  SURFACE_LABELS,
  STYLE_LABELS,
  TRAINERS,
  findTrainer,
  formatRaceTime,
  shortWeekLabel,
  transferFee,
  type HorseView,
  type KnowledgeKey,
} from "@owners/shared";
import { ScreenHead } from "./AppShell";
import { PolicyEditor, ReportSheet } from "./actions";
import { useOwner, type HorseTab, type Route } from "./context";
import { EmptyState, ErrorState, useBusy, useConfirm, useToast } from "./feedback";
import { Icon } from "./icons";
import {
  AbilityDiscoveryPanel,
  ActionBar,
  AptitudeCell,
  HorseConditionBadge,
  HorseSummaryCard,
  Pane,
  StableReportCard,
  StateMeters,
  Tabs,
  TraitChips,
  trainerName,
  yen,
} from "./ui";
import { economyOf, type HorseCardVM, type ReportVM } from "./vm";

type HorsesRoute = Extract<Route, { tab: "horses" }>;

export function HorsesScreen({ route }: { route: HorsesRoute }) {
  if (route.detail && route.horseId) return <HorseDetail horseId={route.horseId} tab={route.horseTab ?? "overview"} />;
  return <HorseList selectedId={route.horseId} />;
}

function HorseList({ selectedId }: { selectedId?: string }) {
  const { vm, nav } = useOwner();
  const sel = vm.horses.find((h) => h.view.id === selectedId) ?? vm.horses[0];
  const retired = vm.allHorses.filter((h) => h.status !== "active");
  const open = (id: string) => nav.push({ tab: "horses", horseId: id, detail: true, horseTab: "overview" });
  return (
    <div className="screen">
      <ScreenHead
        title="所有馬"
        sub={`現役 ${vm.horses.length}頭${retired.length ? `／引退・売却 ${retired.length}頭` : ""}`}
        right={
          <button className="btn btn-ghost btn-small" onClick={() => nav.push({ tab: "shop" })}>
            <Icon name="cart" />
            馬を買う
          </button>
        }
      />
      {vm.horses.length === 0 ? (
        <EmptyState icon="horse" title="現役の馬がいません" action={<button className="btn btn-primary" onClick={() => nav.push({ tab: "shop" })}>馬を買う</button>}>
          販売馬を買って厩舎に預けましょう。
        </EmptyState>
      ) : (
        <div className="split">
          <div className="split-main scroll">
            <ul className="horse-grid2">
              {vm.horses.map((h) => (
                <li key={h.view.id}>
                  <HorseSummaryCard
                    h={h}
                    selected={h === sel}
                    onOpen={() => {
                      // 横向き（横に概要がある）では選択、縦向きでは詳細へ
                      if (window.matchMedia("(min-width: 700px)").matches && h !== sel) nav.replace({ tab: "horses", horseId: h.view.id });
                      else open(h.view.id);
                    }}
                  />
                </li>
              ))}
            </ul>
          </div>
          {sel && (
            <aside className="split-side scroll" aria-label="選択中の馬">
              <HorseBrief h={sel} />
              <button className="btn btn-primary btn-block" onClick={() => open(sel.view.id)}>
                {sel.view.name}の詳細
              </button>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

function HorseBrief({ h }: { h: HorseCardVM }) {
  const v = h.view;
  return (
    <div className="brief">
      <p className="horse-name lg">{v.name}</p>
      <p className="muted">
        {v.age}歳／{h.trainerName}厩舎／{v.record.races}戦{v.record.wins}勝
      </p>
      <HorseConditionBadge c={h.condition} />
      <StateMeters s={v.state} compact />
      <p className="brief-plan">
        <Icon name="clock" size={15} />
        {h.nextPlan}
      </p>
    </div>
  );
}

const TABS: [HorseTab, string][] = [
  ["overview", "概要"],
  ["care", "育成・状態"],
  ["ability", "能力・適性"],
  ["reports", "厩舎報告"],
  ["races", "戦績・分析"],
  ["owner", "所有・経営"],
];

function HorseDetail({ horseId, tab }: { horseId: string; tab: HorseTab }) {
  const { vm, nav } = useOwner();
  const v = vm.allHorses.find((h) => h.id === horseId);
  const card = vm.horses.find((h) => h.view.id === horseId);
  if (!v) return <ErrorState title="馬が見つかりません" />;
  return (
    <div className="screen">
      <div className="head-tabs">
        <ScreenHead
          nav={nav}
          title={v.name}
          sub={`${v.age}歳／${trainerName(v.trainerId)}厩舎／${v.record.races}戦${v.record.wins}勝${v.status !== "active" ? (v.status === "retired" ? "／引退" : "／売却済み") : ""}`}
          right={card && <HorseConditionBadge c={card.condition} />}
        />
        <Tabs label="馬の情報" value={tab} items={TABS} onChange={(t) => nav.replace({ tab: "horses", horseId, detail: true, horseTab: t })} />
      </div>
      <div className="tab-body scroll">
        {tab === "overview" && <Overview v={v} card={card} />}
        {tab === "care" && <Care v={v} />}
        {tab === "ability" && <Ability v={v} />}
        {tab === "reports" && <HorseReports v={v} />}
        {tab === "races" && <HorseRaces v={v} />}
        {tab === "owner" && <Ownership v={v} />}
      </div>
      {v.status === "active" && card && card.runnable > 0 && tab !== "owner" && (
        <ActionBar info={<span>今週出られるレース {card.runnable}</span>}>
          <button className="btn btn-primary" onClick={() => nav.push({ tab: "race", horseId })}>
            <Icon name="race" />
            出走を検討
          </button>
        </ActionBar>
      )}
    </div>
  );
}

function Overview({ v, card }: { v: HorseView; card?: HorseCardVM }) {
  const recent = [...v.knowledgeEvents].reverse().slice(0, 4);
  return (
    <div className="cols">
      <Pane title="この馬について">
        <dl className="facts">
          <div>
            <dt>血統</dt>
            <dd>
              父 {v.sireName ?? "—"}／母 {v.damName ?? "—"}
            </dd>
          </div>
          <div>
            <dt>預託先</dt>
            <dd>{trainerName(v.trainerId)}厩舎</dd>
          </div>
          <div>
            <dt>戦績</dt>
            <dd>
              {v.record.races}戦{v.record.wins}勝（2着{v.record.seconds}・3着{v.record.thirds}）
            </dd>
          </div>
          <div>
            <dt>獲得賞金</dt>
            <dd className="gold-num">{yen(v.record.totalPrize)}</dd>
          </div>
          {card && (
            <div>
              <dt>次の予定</dt>
              <dd>{card.nextPlan}</dd>
            </div>
          )}
        </dl>
        <h3 className="settings-sub">個性</h3>
        <TraitChips traits={v.traits} />
      </Pane>
      <Pane title="最近わかったこと">
        {recent.length === 0 ? (
          <p className="muted">まだ判明したことはありません。</p>
        ) : (
          <ul className="event-list">
            {recent.map((e, i) => (
              <EventRow key={i} e={e} />
            ))}
          </ul>
        )}
      </Pane>
    </div>
  );
}

function EventRow({ e }: { e: HorseView["knowledgeEvents"][number] }) {
  const kind = e.type === "revise" ? "推定の修正" : e.type === "trait" ? "個性" : "判明";
  return (
    <li className={`event event-${e.type}`}>
      <span className="event-kind">
        <Icon name={e.type === "revise" ? "info" : "spark"} size={14} />
        {kind}
      </span>
      <span className="event-week">{shortWeekLabel(e.week)}</span>
      <span className="event-text">{e.text}</span>
      <span className="event-src">{e.source}</span>
    </li>
  );
}

function Care({ v }: { v: HorseView }) {
  const { save } = useOwner();
  const last = save.reports.find((r) => r.horseId === v.id);
  return (
    <div className="cols">
      <Pane title="状態">
        <StateMeters s={v.state} />
        <p className="hint2">
          厩舎との関係 {Math.round(v.relationship)}／100（調教師の懸念を押し切ったり、反対を押して出走させると下がります）
        </p>
        {last && (
          <div className="last-rep">
            <p className="muted">{shortWeekLabel(last.week)}の報告</p>
            {last.lines.map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </div>
        )}
      </Pane>
      <Pane title="育成方針">
        {v.status === "active" ? (
          <>
            <p className="hint2">方針は調教の命令ではなく、厩舎が計画を立てるときの優先事項です。</p>
            <PolicyEditor horseId={v.id} compact />
          </>
        ) : (
          <p className="muted">現役の馬ではありません。</p>
        )}
      </Pane>
    </div>
  );
}

const APT_GROUPS: [string, [KnowledgeKey, string][]][] = [
  ["距離", DISTANCE_BANDS.map((b) => [b.key, b.label] as [KnowledgeKey, string])],
  [
    "馬場",
    [
      ["surface_turf", "芝"],
      ["surface_dirt", "ダート"],
      ["going_heavy", "道悪"],
    ],
  ],
  [
    "コース",
    [
      ["course_right", "右回り"],
      ["course_left", "左回り"],
      ["course_slope", "坂"],
      ["course_tight", "小回り"],
    ],
  ],
  [
    "脚質",
    [
      ["style_front", "逃げ"],
      ["style_stalker", "先行"],
      ["style_closer", "差し"],
      ["style_deep", "追込"],
    ],
  ],
];

function Ability({ v }: { v: HorseView }) {
  const { save } = useOwner();
  // 直近2週に判明・修正された能力を「新たに判明」として示す
  const fresh = new Set(v.knowledgeEvents.filter((e) => e.week >= save.week - 2 && e.type !== "trait").map((e) => e.key as string));
  const history = [...v.knowledgeEvents].reverse();
  return (
    <div className="cols cols-ability">
      <Pane title="能力の見立て">
        <p className="hint2">本当の能力は誰にも見えません。証拠がそろった能力から「言葉 → ランク → 数値」の順に分かります。確かさは推定の精度で、ランクとは別のものです。</p>
        <AbilityDiscoveryPanel view={v} freshKeys={fresh} />
      </Pane>
      <Pane title="適性">
        {APT_GROUPS.map(([g, keys]) => (
          <div key={g} className="apt-group2">
            <h3>{g}</h3>
            <div className="apt-row">
              {keys.map(([k, label]) => (
                <AptitudeCell key={k} v={v.knowledge[k]} label={label} />
              ))}
            </div>
          </div>
        ))}
        <p className="hint2">◎よく合う ○合う △得意ではない ×苦手 ／ 点線は未検証（走ったことがない）</p>
        <h3 className="settings-sub">個性</h3>
        <TraitChips traits={v.traits} />
      </Pane>
      <Pane title="評価の推移">
        <p className="hint2">「推定の修正」は見立てが変わったもので、馬の能力そのものが変わったわけではありません。</p>
        {history.length === 0 ? (
          <p className="muted">まだ記録はありません。</p>
        ) : (
          <ul className="event-list">
            {history.map((e, i) => (
              <EventRow key={i} e={e} />
            ))}
          </ul>
        )}
      </Pane>
    </div>
  );
}

function HorseReports({ v }: { v: HorseView }) {
  const { vm, markRead } = useOwner();
  const [open, setOpen] = useState<ReportVM | null>(null);
  const list = vm.reports.filter((r) => r.report.horseId === v.id);
  if (list.length === 0) return <EmptyState icon="report" title="報告はまだありません" />;
  return (
    <>
      <ul className="report-list grid">
        {list.map((r) => (
          <li key={r.id}>
            <StableReportCard
              r={r}
              showHorse={false}
              onOpen={() => {
                setOpen(r);
                markRead([r.id]);
              }}
            />
          </li>
        ))}
      </ul>
      {open && <ReportSheet r={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function HorseRaces({ v }: { v: HorseView }) {
  const { save, nav } = useOwner();
  const races = save.races.filter((r) => r.horseId === v.id);
  if (races.length === 0) return <EmptyState icon="race" title="まだ出走していません">2歳の6月からデビューできます。</EmptyState>;
  return (
    <ul className="rcards">
      {races.map((r) => (
        <li key={r.raceId}>
          <button className="rcard" onClick={() => nav.push({ tab: "records", sub: "analysis", raceId: r.raceId })}>
            <span className={`race-pos ${r.position === 1 ? "is-win" : ""}`}>
              {r.position}
              <small>着</small>
            </span>
            <span className="rcard-body">
              <strong>{r.programName}</strong>
              <span>
                {shortWeekLabel(r.week)}／{r.course.trackName} {SURFACE_LABELS[r.course.surface]}
                {r.course.distance}m／馬場{GOING_LABELS[r.going]}
              </span>
              <span>
                {formatRaceTime(r.timeMs)}／上がり{r.telemetry.last600.toFixed(1)}／{STYLE_LABELS[r.tactics.style]}
              </span>
            </span>
            {!r.analyzed && <span className="pill pill-new">未分析</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Ownership({ v }: { v: HorseView }) {
  const { save, game, nav } = useOwner();
  const confirm = useConfirm();
  const toast = useToast();
  const { busy, run } = useBusy();
  const [to, setTo] = useState("");
  const eco = economyOf(save, v.id);
  if (!eco) return null;
  const active = v.status === "active";
  const t = to ? findTrainer(to) : undefined;
  return (
    <div className="cols">
      <Pane title="経営情報">
        <dl className="facts">
          <div>
            <dt>購入価格</dt>
            <dd>{v.purchasePrice ? yen(v.purchasePrice) : "無償"}</dd>
          </div>
          <div>
            <dt>所有開始</dt>
            <dd>{shortWeekLabel(v.acquiredWeek)}</dd>
          </div>
          <div>
            <dt>獲得賞金</dt>
            <dd className="gold-num">{yen(v.record.totalPrize)}</dd>
          </div>
          <div>
            <dt>預託料</dt>
            <dd>{yen(eco.weeklyFee)}／週</dd>
          </div>
          <div>
            <dt>今の売却額</dt>
            <dd>{yen(eco.saleValue)}</dd>
          </div>
          <div>
            <dt>引退報奨金</dt>
            <dd>{yen(eco.retirementBonus)}</dd>
          </div>
        </dl>
        {active && (
          <div className="btn-row">
            <button
              className="btn btn-ghost"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (!(await confirm({ title: `${v.name}を売却`, body: `${yen(eco.saleValue)}で売却します。元に戻せません。`, okLabel: "売却する", danger: true }))) return;
                  try {
                    const amount = game.sell(v.id);
                    toast(`${v.name}を${yen(amount)}で売却しました`, "good");
                    nav.switchTab("horses");
                  } catch (e) {
                    toast((e as Error).message, "error");
                  }
                })
              }
            >
              売却する
            </button>
            <button
              className="btn btn-ghost btn-danger-text"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (!(await confirm({ title: `${v.name}を引退させる`, body: `報奨金 ${yen(eco.retirementBonus)} を受け取ります。元に戻せません。`, okLabel: "引退させる", danger: true }))) return;
                  try {
                    game.retire(v.id);
                    toast(`${v.name}が引退しました`, "good");
                    nav.switchTab("horses");
                  } catch (e) {
                    toast((e as Error).message, "error");
                  }
                })
              }
            >
              引退させる
            </button>
          </div>
        )}
      </Pane>
      {active && (
        <Pane title="転厩（預託先の変更）">
          <p className="hint2">手続き費用がかかり、新しい厩舎との関係は一から築き直しです。これまでの見立ては引き継がれます。</p>
          <div className="trainer-list">
            {TRAINERS.filter((x) => x.id !== v.trainerId).map((x) => (
              <button key={x.id} role="radio" aria-checked={to === x.id} className="trainer-opt2" onClick={() => setTo(x.id)}>
                <strong>{x.name}</strong>
                <span>得意：{x.specialties.note}</span>
                <span>{yen(x.weeklyFee)}／週</span>
              </button>
            ))}
          </div>
          <button
            className="btn btn-primary btn-block"
            disabled={!t || busy}
            onClick={() =>
              run(async () => {
                if (!t) return;
                if (!(await confirm({ title: "転厩の確認", body: `${v.name}を${t.name}厩舎へ移します。手続き費用 ${yen(transferFee(t))}。`, okLabel: "転厩させる" }))) return;
                try {
                  game.transfer(v.id, t.id);
                  setTo("");
                  toast(`${t.name}厩舎へ転厩しました`, "good");
                } catch (e) {
                  toast((e as Error).message, "error");
                }
              })
            }
          >
            {t ? `${t.name}厩舎へ転厩（${yen(transferFee(t))}）` : "転厩先を選んでください"}
          </button>
        </Pane>
      )}
    </div>
  );
}
