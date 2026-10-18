// 所有馬の詳細：見立て（情報解明）・育成方針・戦績・履歴・管理
import { useMemo, useState } from "react";
import {
  ABILITY_KEYS,
  AGE_STAGE_LABELS,
  DISTANCE_BANDS,
  POLICY_DEFS,
  POLICY_IDS,
  RETIRE_AGE,
  SURFACE_LABELS,
  GOING_LABELS,
  findTrainer,
  formatRaceTime,
  last600Rank,
  marginLabel,
  ownerRetirementBonus,
  racesOf,
  saleValue,
  shortWeekLabel,
  toHorseView,
  transferFee,
  upcomingStakes,
  courseLabel,
  weeklyFeeFor,
  type HorseLogKind,
  type KnowledgeKey,
  type PolicyId,
} from "@owners/shared";
import { Notice } from "../components";
import { yen } from "../format";
import type { OwnerGame } from "../offline/useOwnerGame";
import type { HorseTab, OScreen } from "./OwnerApp";
import { TrainerPicker } from "./offers";
import { AbilityRow, AptitudeCell, Section, StateBlock, TraitChips, trainerName } from "./ui";

const TABS: [HorseTab, string][] = [
  ["eval", "見立て"],
  ["policy", "方針と状態"],
  ["races", "戦績"],
  ["history", "履歴"],
  ["manage", "管理"],
];

export function HorseDetail({ game, horseId, tab, go }: { game: OwnerGame; horseId: string; tab: HorseTab; go: (s: OScreen) => void }) {
  const save = game.save!;
  const h = save.horses.find((x) => x.id === horseId);
  const [msg, setMsg] = useState<{ kind: "good" | "error"; text: string } | null>(null);
  const v = useMemo(() => (h ? toHorseView(h, save.week) : null), [h, save.week]);
  if (!h || !v) return <div className="page"><Notice kind="error">馬が見つかりません</Notice></div>;
  const setTab = (t: HorseTab) => go({ name: "horse", horseId, tab: t });
  const act = (f: () => string | void) => {
    try {
      const text = f();
      setMsg(text ? { kind: "good", text } : null);
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  };

  return (
    <div className="page">
      <button className="link back" onClick={() => go({ name: "home" })}>
        馬主画面に戻る
      </button>
      <section className="horse-head">
        <h1 className="page-title">{h.name}</h1>
        <p className="muted">
          {v.age}歳（{AGE_STAGE_LABELS[v.ageStage]}） ・ {trainerName(h.trainerId)}厩舎 ・ {h.record.races}戦{h.record.wins}勝 ・ 獲得賞金 {yen(h.record.totalPrize)}
          {h.status !== "active" && <span className="tag tag-bad">{h.status === "retired" ? "引退" : "売却済み"}</span>}
        </p>
        <p className="muted small">
          父 {h.sireName ?? "—"} ／ 母 {h.damName ?? "—"}
        </p>
      </section>
      <div className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      {tab === "eval" && (
        <>
          <Section title="能力の見立て">
            <p className="hint">
              本当の能力は誰にも見えません。表示は厩舎の報告と、レースの分析から推し量った「見立て」です。
              証拠が集まった能力から、言葉 → 評価ランク（S〜E） → 数値（0〜100）の順に分かっていきます。年齢だけで分かることはありません。
            </p>
            <div className="kn-table">
              {ABILITY_KEYS.map((k) => (
                <AbilityRow key={k} v={v.knowledge[k]} />
              ))}
            </div>
          </Section>
          <Section title="適性">
            <p className="hint">走ったことのない条件は「未検証」です。印象（見込み）は参考程度に。◎ よく合う ・ ○ 合う ・ △ 得意ではない ・ × 苦手</p>
            <AptGroup title="距離" keys={DISTANCE_BANDS.map((b) => [b.key, b.label] as [KnowledgeKey, string])} v={v.knowledge} />
            <AptGroup
              title="馬場"
              keys={[
                ["surface_turf", "芝"],
                ["surface_dirt", "ダート"],
                ["going_heavy", "道悪"],
              ]}
              v={v.knowledge}
            />
            <AptGroup
              title="コース"
              keys={[
                ["course_right", "右回り"],
                ["course_left", "左回り"],
                ["course_slope", "坂"],
                ["course_tight", "小回り"],
              ]}
              v={v.knowledge}
            />
            <AptGroup
              title="脚質"
              keys={[
                ["style_front", "逃げ"],
                ["style_stalker", "先行"],
                ["style_closer", "差し"],
                ["style_deep", "追込"],
              ]}
              v={v.knowledge}
            />
          </Section>
          <Section title="個性">
            <TraitChips traits={v.traits} />
          </Section>
        </>
      )}

      {tab === "policy" && <PolicyTab game={game} horseId={horseId} act={act} />}

      {tab === "races" && <RacesTab game={game} horseId={horseId} go={go} />}

      {tab === "history" && <HistoryTab game={game} horseId={horseId} />}

      {tab === "manage" && (
        <ManageTab
          game={game}
          horseId={horseId}
          act={act}
          onGone={() => go({ name: "home" })}
        />
      )}
    </div>
  );
}

function AptGroup({ title, keys, v }: { title: string; keys: [KnowledgeKey, string][]; v: ReturnType<typeof toHorseView>["knowledge"] }) {
  return (
    <div className="apt-group">
      <h3 className="apt-group-title">{title}</h3>
      <div className="apt-cells">
        {keys.map(([k, label]) => (
          <AptitudeCell key={k} v={v[k]} short={label} />
        ))}
      </div>
    </div>
  );
}

function PolicyTab({ game, horseId, act }: { game: OwnerGame; horseId: string; act: (f: () => string | void) => void }) {
  const save = game.save!;
  const h = save.horses.find((x) => x.id === horseId)!;
  const stakes = upcomingStakes(save.week, 12);
  const lastReport = save.reports.find((r) => r.horseId === horseId);
  const active = h.status === "active";
  return (
    <>
      <Section title="状態">
        <StateBlock s={h.state} />
        <p className="hint">
          厩舎との関係 {Math.round(h.relationship)}／100。調教師の懸念を押し切ったり、反対を押して出走させると下がります。
        </p>
        {lastReport && (
          <div className="last-report">
            <h3 className="apt-group-title">最新の報告（{shortWeekLabel(lastReport.week)}）</h3>
            {lastReport.lines.map((l, i) => (
              <p key={i}>{l}</p>
            ))}
            {lastReport.workout && <p className="report-work">調教時計：{lastReport.workout}</p>}
          </div>
        )}
      </Section>
      <Section title="育成方針">
        <p className="hint">方針は調教の命令ではなく、厩舎が計画を立てるときの優先事項です。調教師は馬の状態を見て内容を調整します。</p>
        <div className="policy-grid" role="radiogroup" aria-label="育成方針">
          {POLICY_IDS.map((id) => (
            <button
              key={id}
              role="radio"
              aria-checked={h.policy.policy === id}
              disabled={!active}
              className={`policy-opt ${h.policy.policy === id ? "is-picked" : ""}`}
              onClick={() => act(() => game.setPolicy(horseId, { policy: id as PolicyId }))}
            >
              <strong>{POLICY_DEFS[id].label}</strong>
              <span className="muted">{POLICY_DEFS[id].desc}</span>
            </button>
          ))}
        </div>
        <div className="seg policy-mode" role="group" aria-label="調教師の提案の扱い">
          <button aria-pressed={h.policy.mode === "follow"} disabled={!active} onClick={() => act(() => game.setPolicy(horseId, { mode: "follow" }))}>
            調教師の提案に従う
          </button>
          <button aria-pressed={h.policy.mode === "insist"} disabled={!active} onClick={() => act(() => game.setPolicy(horseId, { mode: "insist" }))}>
            方針を優先させる
          </button>
        </div>
        {h.policy.mode === "insist" && <p className="hint warn">疲れていても方針どおりに調教します。疲労・故障のリスクが上がり、厩舎との関係も悪くなりがちです。</p>}
      </Section>
      <Section title="目標レース">
        <label className="select-row">
          <span>目標</span>
          <select
            value={h.policy.goalRaceId ?? ""}
            disabled={!active}
            onChange={(e) => act(() => game.setPolicy(horseId, { goalRaceId: e.target.value || null }))}
          >
            <option value="">設定しない</option>
            {stakes.map((p) => (
              <option key={p.id} value={p.id}>
                {shortWeekLabel(p.week)} {p.name}（{courseLabel(p.course)}・{p.conditionText}）
              </option>
            ))}
          </select>
        </label>
        <p className="hint">方針が「大レースを目指した長期育成」のとき、厩舎は目標から逆算して仕上げます。</p>
      </Section>
    </>
  );
}

function RacesTab({ game, horseId, go }: { game: OwnerGame; horseId: string; go: (s: OScreen) => void }) {
  const save = game.save!;
  const races = racesOf(save, horseId);
  if (races.length === 0) return <p className="muted section-gap">まだ出走していません。</p>;
  return (
    <Section title="条件ごとの比較">
      <p className="hint">距離・馬場・コースの違いで走りを比べると、適性の手がかりになります。分析していないレースは「分析」から評価に反映できます。</p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>週</th>
              <th>レース</th>
              <th>条件</th>
              <th>着順</th>
              <th>タイム</th>
              <th>上がり3F</th>
              <th>着差</th>
              <th>分析</th>
            </tr>
          </thead>
          <tbody>
            {races.map((r) => (
              <tr key={r.raceId}>
                <td>{shortWeekLabel(r.week)}</td>
                <td>{r.programName}</td>
                <td>
                  {r.course.trackName} {SURFACE_LABELS[r.course.surface]}
                  {r.course.distance}m {GOING_LABELS[r.going]}
                </td>
                <td className={r.position === 1 ? "pos-win" : ""}>
                  {r.position}着<small>/{r.fieldSize}</small>
                </td>
                <td>{formatRaceTime(r.timeMs)}</td>
                <td>
                  {r.telemetry.last600.toFixed(1)}
                  <small>（{last600Rank(r)}位）</small>
                </td>
                <td>{r.position === 1 ? `${marginLabel(Math.abs(r.marginToWinner))}差勝ち` : marginLabel(r.marginToWinner)}</td>
                <td>
                  <button className="link" onClick={() => go({ name: "analysis", raceId: r.raceId })}>
                    {r.analyzed ? "済" : "分析する"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

const LOG_FILTERS: [HorseLogKind | "all", string][] = [
  ["all", "すべて"],
  ["knowledge", "判明・修正"],
  ["report", "報告"],
  ["training", "調教"],
  ["race", "レース"],
  ["owner", "馬主"],
];

function HistoryTab({ game, horseId }: { game: OwnerGame; horseId: string }) {
  const save = game.save!;
  const h = save.horses.find((x) => x.id === horseId)!;
  const [filter, setFilter] = useState<HorseLogKind | "all">("all");
  const logs = [...h.log].reverse().filter((l) => filter === "all" || l.kind === filter);
  return (
    <Section title="履歴">
      <div className="seg" role="group" aria-label="種類">
        {LOG_FILTERS.map(([k, label]) => (
          <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {label}
          </button>
        ))}
      </div>
      <ul className="log-list">
        {logs.length === 0 && <li className="muted">記録はありません。</li>}
        {logs.slice(0, 150).map((l, i) => (
          <li key={i} className={`log log-${l.kind}`}>
            <span className="log-week">{shortWeekLabel(l.week)}</span>
            <span className="log-text">
              {l.text}
              {l.detail && <small className="log-detail">{l.detail}</small>}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function ManageTab({
  game,
  horseId,
  act,
  onGone,
}: {
  game: OwnerGame;
  horseId: string;
  act: (f: () => string | void) => void;
  onGone: () => void;
}) {
  const save = game.save!;
  const h = save.horses.find((x) => x.id === horseId)!;
  const [to, setTo] = useState("");
  if (h.status !== "active") return <p className="muted section-gap">この馬はすでに{h.status === "retired" ? "引退" : "売却"}しています。</p>;
  const t = to ? findTrainer(to) : undefined;
  const value = saleValue(h, save.week);
  const bonus = ownerRetirementBonus(h);
  return (
    <>
      <Section title="転厩（預託先の変更）">
        <p className="hint">
          現在：{trainerName(h.trainerId)}厩舎（預託料 {yen(weeklyFeeFor(h, save.week))}／週）。転厩には手続き費用がかかり、新しい厩舎との関係は一から築き直しです。
          これまでの見立ては引き継がれます。
        </p>
        <TrainerPicker value={to} onChange={setTo} exclude={h.trainerId} />
        <button
          className="btn"
          disabled={!t}
          onClick={() =>
            act(() => {
              if (!t || !window.confirm(`${t.name}厩舎へ転厩させますか？（手続き費用 ${yen(transferFee(t))}）`)) return;
              game.transfer(horseId, t.id);
              setTo("");
              return `${t.name}厩舎へ転厩しました。`;
            })
          }
        >
          {t ? `${t.name}厩舎へ転厩（${yen(transferFee(t))}）` : "転厩先を選んでください"}
        </button>
      </Section>
      <Section title="売却・引退">
        <p className="hint">売却額は戦績と年齢などの公開情報で決まります。{RETIRE_AGE}歳の年末で競走生活を終えます。</p>
        <div className="manage-actions">
          <button
            className="btn"
            onClick={() =>
              act(() => {
                if (!window.confirm(`${h.name}を ${yen(value)} で売却しますか？ 元に戻せません。`)) return;
                const amount = game.sell(horseId);
                onGone();
                return `${yen(amount)}で売却しました。`;
              })
            }
          >
            売却する（{yen(value)}）
          </button>
          <button
            className="btn btn-quiet"
            onClick={() =>
              act(() => {
                if (!window.confirm(`${h.name}を引退させますか？ 報奨金 ${yen(bonus)} を受け取ります。元に戻せません。`)) return;
                game.retire(horseId);
                onGone();
              })
            }
          >
            引退させる（報奨金 {yen(bonus)}）
          </button>
        </div>
      </Section>
    </>
  );
}
