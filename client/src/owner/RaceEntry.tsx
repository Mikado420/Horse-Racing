// 出走計画：今週の候補レース・調教師の意見・この条件の見立て・リスクと期待・作戦 → 確認して出走
import { useEffect, useMemo, useState } from "react";
import {
  GOING_LABELS,
  PACE_LABELS,
  SPURT_LABELS,
  STYLE_KEYS,
  STYLE_LABELS,
  SURFACE_LABELS,
  shortWeekLabel,
  type PacePlan,
  type SpurtPlan,
  type Tactics,
} from "@owners/shared";
import { ScreenHead } from "./AppShell";
import { useOwner, type Route } from "./context";
import { BottomSheet, EmptyState, useBusy, useConfirm, useToast } from "./feedback";
import { Icon } from "./icons";
import { ActionBar, HorseConditionBadge, StanceTag, StateMeters, trainerName, yen } from "./ui";
import { classLabel, entryOptions, stakesAhead, type EntryVM } from "./vm";

type RaceRoute = Extract<Route, { tab: "race" }>;

const STYLE_DESC: Record<string, string> = { front: "先頭に立って逃げる", stalker: "前の方で運ぶ", closer: "中団から直線で差す", deep: "後方から一気に追い込む" };
const PACE_DESC: Record<PacePlan, string> = { easy: "道中は抑えて脚をためる", normal: "流れに合わせる", aggressive: "前へ攻める（消耗しやすい）" };
const SPURT_DESC: Record<SpurtPlan, string> = { early: "最終コーナーの手前から動く", normal: "最終コーナーで動く", late: "直線に入ってから動く" };

export function RaceEntry({ route }: { route: RaceRoute }) {
  const { vm, save, nav, startRace } = useOwner();
  const toast = useToast();
  const confirm = useConfirm();
  const { busy, run } = useBusy();
  const defaultHorse = route.horseId ?? vm.horses.find((h) => h.runnable > 0)?.view.id ?? vm.horses[0]?.view.id;
  const [horseId, setHorseId] = useState(defaultHorse);
  const [programId, setProgramId] = useState<string | null>(route.programId ?? null);
  const [tactics, setTactics] = useState<Tactics | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const horse = vm.horses.find((h) => h.view.id === horseId);
  const options = useMemo(() => (horseId ? entryOptions(save, horseId) : []), [save, horseId]);
  const selected = options.find((o) => o.program.id === programId && !o.problem) ?? null;
  const eligible = options.filter((o) => !o.problem);

  useEffect(() => {
    if (selected?.opinion) setTactics(selected.opinion.suggestedTactics);
  }, [selected?.program.id, horseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (o: EntryVM) => {
    setProgramId(o.program.id);
    nav.replace({ tab: "race", horseId, programId: o.program.id });
    if (!window.matchMedia("(min-width: 700px)").matches) setSheetOpen(true);
  };

  const go = () =>
    run(async () => {
      if (!horse || !selected || !tactics) return;
      const p = selected.program;
      const ok = await confirm({
        title: "出走の確認",
        okLabel: "出走を確定する",
        danger: selected.opinion?.stance === "反対",
        body: (
          <dl className="facts compact">
            <div>
              <dt>馬</dt>
              <dd>{horse.view.name}</dd>
            </div>
            <div>
              <dt>レース</dt>
              <dd>
                {p.name}（{classLabel(p)}）
              </dd>
            </div>
            <div>
              <dt>コース</dt>
              <dd>
                {p.course.trackName} {SURFACE_LABELS[p.course.surface]}
                {p.course.distance}m／馬場{GOING_LABELS[p.going]}
              </dd>
            </div>
            <div>
              <dt>作戦</dt>
              <dd>
                {STYLE_LABELS[tactics.style]}・ペース{PACE_LABELS[tactics.pace]}・仕掛け{SPURT_LABELS[tactics.spurt]}
              </dd>
            </div>
            {selected.opinion?.stance === "反対" && (
              <div>
                <dt>注意</dt>
                <dd className="warn-text">調教師は反対しています。厩舎との関係が悪くなります。</dd>
              </div>
            )}
          </dl>
        ),
      });
      if (!ok) return;
      try {
        startRace(horse.view.id, p.id, tactics);
      } catch (e) {
        toast((e as Error).message, "error");
      }
    });

  if (vm.horses.length === 0) {
    return (
      <div className="screen">
        <ScreenHead title="出走" />
        <EmptyState icon="horse" title="現役の馬がいません" action={<button className="btn btn-primary" onClick={() => nav.push({ tab: "shop" })}>馬を買う</button>} />
      </div>
    );
  }

  const detail = selected && horse && tactics && <EntryDetail e={selected} tactics={tactics} setTactics={setTactics} trainer={trainerName(horse.view.trainerId)} />;

  return (
    <div className="screen">
      <div className="head-tabs">
      <ScreenHead nav={nav} title="出走計画" sub={`${shortWeekLabel(save.week)}の番組`} />
      <div className="chip-row horse-chips" role="radiogroup" aria-label="出走させる馬">
        {vm.horses.map((h) => (
          <button
            key={h.view.id}
            role="radio"
            aria-checked={h.view.id === horseId}
            className="chip"
            onClick={() => {
              setHorseId(h.view.id);
              setProgramId(null);
              nav.replace({ tab: "race", horseId: h.view.id });
            }}
          >
            {h.view.name}
            <small>{h.runnable ? `出走可 ${h.runnable}` : "今週は不可"}</small>
          </button>
        ))}
      </div>
      </div>
      <div className="split">
        <div className="split-main scroll">
          {horse && (
            <div className="entry-horse">
              <HorseConditionBadge c={horse.condition} />
              <StateMeters s={horse.view.state} compact />
            </div>
          )}
          {eligible.length === 0 && <EmptyState icon="race" title="今週出られるレースはありません">{options.find((o) => o.problem)?.problem}</EmptyState>}
          <ul className="program-list">
            {options.map((o) => (
              <li key={o.program.id}>
                <button className="program-row" disabled={!!o.problem} aria-pressed={o.program.id === programId} onClick={() => pick(o)}>
                  <span className="program-row-main">
                    <strong>{o.program.name}</strong>
                    <span className="pill">{classLabel(o.program)}</span>
                    {o.program.named && <span className="pill pill-gold">重賞</span>}
                  </span>
                  <span className="program-row-sub">
                    {o.program.course.trackName} {SURFACE_LABELS[o.program.course.surface]}
                    {o.program.course.distance}m／馬場{GOING_LABELS[o.program.going]}／1着 {yen(o.program.firstPrize)}
                  </span>
                  {o.problem ? <span className="program-row-problem">{o.problem}</span> : o.opinion && <StanceTag stance={o.opinion.stance} />}
                </button>
              </li>
            ))}
          </ul>
          <details className="stakes-ahead">
            <summary>今後の重賞（開催時期）</summary>
            <ul className="plain-list">
              {stakesAhead(save).map(({ program: p, weeksAway }) => (
                <li key={p.id}>
                  {shortWeekLabel(p.week)}（あと{weeksAway}週） <strong>{p.name}</strong> {SURFACE_LABELS[p.course.surface]}
                  {p.course.distance}m・{p.conditionText}
                </li>
              ))}
            </ul>
          </details>
        </div>
        <aside className="split-side scroll entry-side" aria-label="出走の検討">
          {detail ?? <EmptyState icon="race" title="レースを選んでください">調教師の意見と、この条件についての見立てが表示されます。</EmptyState>}
        </aside>
      </div>
      <ActionBar info={selected ? <span>{selected.program.name}</span> : <span className="muted">レースを選ぶと出走できます</span>}>
        <button className="btn btn-primary" disabled={!selected || !tactics || busy} onClick={go}>
          <Icon name="race" />
          出走を確定する
        </button>
      </ActionBar>
      {sheetOpen && detail && (
        <BottomSheet
          title={selected!.program.name}
          onClose={() => setSheetOpen(false)}
          actions={
            <button className="btn btn-primary" disabled={busy} onClick={() => (setSheetOpen(false), go())}>
              出走を確定する
            </button>
          }
        >
          {detail}
        </BottomSheet>
      )}
    </div>
  );
}

function EntryDetail({ e, tactics, setTactics, trainer }: { e: EntryVM; tactics: Tactics; setTactics: (t: Tactics) => void; trainer: string }) {
  const p = e.program;
  const c = p.course;
  return (
    <div className="entry-detail">
      <p className="entry-course">
        {c.trackName}競馬場 {SURFACE_LABELS[c.surface]}
        {c.distance}m／{c.direction === "right" ? "右回り" : "左回り"}
        {c.slope ? "・坂あり" : ""}
        {c.tight ? "・小回り" : ""}／馬場{GOING_LABELS[p.going]}／{p.conditionText}
      </p>
      {e.opinion && (
        <section className="opinion2">
          <h3>
            {trainer}調教師の意見 <StanceTag stance={e.opinion.stance} />
          </h3>
          <ul>
            {e.opinion.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3>この条件の見立て</h3>
        <ul className="fit-list">
          {e.fit.map((f) => (
            <li key={f.key} className={f.unverified ? "is-unverified" : ""}>
              <span>{f.label.replace(/（.*）/, "")}</span>
              <strong>{f.unverified ? "未検証" : f.stage === "abstract" ? "判断材料不足" : f.mark}</strong>
              <small>{f.comment}</small>
            </li>
          ))}
        </ul>
      </section>
      <section className="risk-exp">
        <div>
          <h3>
            <Icon name="alert" size={15} />
            リスク
          </h3>
          <ul>{e.risks.length ? e.risks.map((r, i) => <li key={i}>{r}</li>) : <li>大きな不安はありません</li>}</ul>
        </div>
        <div>
          <h3>
            <Icon name="spark" size={15} />
            期待
          </h3>
          <ul>
            {e.expectations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      </section>
      <section className="tactics2">
        <h3>作戦</h3>
        <p className="hint2">作戦は騎手への優先方針です。馬の気性や展開、スタミナによって実際の動きは変わります。</p>
        <TacticRow label="脚質" value={tactics.style} options={STYLE_KEYS.map((s) => [s, STYLE_LABELS[s], STYLE_DESC[s]])} onChange={(style) => setTactics({ ...tactics, style })} />
        <TacticRow label="ペース" value={tactics.pace} options={(Object.keys(PACE_LABELS) as PacePlan[]).map((s) => [s, PACE_LABELS[s], PACE_DESC[s]])} onChange={(pace) => setTactics({ ...tactics, pace })} />
        <TacticRow label="仕掛け" value={tactics.spurt} options={(Object.keys(SPURT_LABELS) as SpurtPlan[]).map((s) => [s, SPURT_LABELS[s], SPURT_DESC[s]])} onChange={(spurt) => setTactics({ ...tactics, spurt })} />
      </section>
    </div>
  );
}

function TacticRow<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string, string][]; onChange: (v: T) => void }) {
  const cur = options.find((o) => o[0] === value);
  return (
    <div className="tactic2">
      <span className="setting-label">{label}</span>
      <div className="seg2" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)}>
            {l}
          </button>
        ))}
      </div>
      <span className="hint2">{cur?.[2]}</span>
    </div>
  );
}
