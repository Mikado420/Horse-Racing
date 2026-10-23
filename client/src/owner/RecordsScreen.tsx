// 記録・分析：戦績カード・レース分析・評価の推移・収支・検証。表は控えめにして、カードとグラフで比べる
import { useMemo, useState } from "react";
import {
  ABILITY_KEYS,
  ABILITY_LABELS,
  CLASS_DEFS,
  GOING_LABELS,
  KNOWLEDGE_LABELS,
  PACE_LABELS,
  SPURT_LABELS,
  STYLE_KEYS,
  STYLE_LABELS,
  SURFACE_LABELS,
  allCourses,
  analyzeRace,
  composeTrainerComment,
  diagnoseRace,
  keyObservations,
  suggestionText,
  viewText,
  type InfoClass,
  bandForDistance,
  courseLabel,
  formatRaceTime,
  last600Rank,
  marginLabel,
  runTrials,
  shortWeekLabel,
  type Abilities,
  type ClassId,
  type OwnerProgram,
  type OwnerRaceRecord,
  type PacePlan,
  type SpurtPlan,
  type Tactics,
  type TrialStats,
} from "@owners/shared";
import { SaddleCloth } from "../components";
import { ScreenHead } from "./AppShell";
import { useOwner, type RecordsTab, type Route } from "./context";
import { EmptyState, useBusy, useToast } from "./feedback";
import { Icon } from "./icons";
import { Pane, StanceTag, Tabs, trainerName, yen, yenSigned } from "./ui";

type RecordsRoute = Extract<Route, { tab: "records" }>;

export function RecordsScreen({ route }: { route: RecordsRoute }) {
  const { nav } = useOwner();
  const sub = route.sub ?? "races";
  return (
    <div className="screen">
      <div className="head-tabs">
        <ScreenHead nav={nav} title="記録・分析" />
        <Tabs<RecordsTab>
          label="記録・分析"
          value={sub}
          items={[
            ["races", "戦績"],
            ["analysis", "レース分析"],
            ["evals", "評価の推移"],
            ["ledger", "収支・名簿"],
            ["lab", "検証"],
          ]}
          onChange={(t) => nav.replace({ tab: "records", sub: t, raceId: route.raceId, horseId: route.horseId })}
        />
      </div>
      <div className="tab-body scroll">
        {sub === "races" && <RaceHistory horseId={route.horseId} />}
        {sub === "analysis" && <Analysis raceId={route.raceId} />}
        {sub === "evals" && <Evals horseId={route.horseId} />}
        {sub === "ledger" && <Ledger />}
        {sub === "lab" && <Lab />}
      </div>
    </div>
  );
}

function HorseFilter({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { save } = useOwner();
  const names = [...new Map(save.races.map((r) => [r.horseId, r.horseName])).entries()];
  return (
    <label className="select-inline">
      <span>馬</span>
      <select className="select2" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">すべて</option>
        {names.map(([id, n]) => (
          <option key={id} value={id}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

function RaceCard({ r, onOpen }: { r: OwnerRaceRecord; onOpen: () => void }) {
  return (
    <button className="rcard" onClick={onOpen}>
      <span className={`race-pos ${r.position === 1 ? "is-win" : ""}`}>
        {r.position}
        <small>着</small>
      </span>
      <span className="rcard-body">
        <strong>
          {r.horseName}　{r.programName}
        </strong>
        <span>
          {shortWeekLabel(r.week)}／{r.course.trackName} {SURFACE_LABELS[r.course.surface]}
          {r.course.distance}m／馬場{GOING_LABELS[r.going]}
        </span>
        <span>
          {formatRaceTime(r.timeMs)}／{r.position === 1 ? "勝利" : marginLabel(r.marginToWinner)}／上がり{r.telemetry.last600.toFixed(1)}（{last600Rank(r)}位）／{STYLE_LABELS[r.tactics.style]}
        </span>
      </span>
      <span className="rcard-side">
        {r.prize > 20_000 && <span className="gold-num">{yen(r.prize)}</span>}
        {!r.analyzed && <span className="pill pill-new">未分析</span>}
      </span>
    </button>
  );
}

function RaceHistory({ horseId }: { horseId?: string }) {
  const { save, nav } = useOwner();
  const [filter, setFilter] = useState(horseId ?? "");
  const races = save.races.filter((r) => !filter || r.horseId === filter);
  if (save.races.length === 0) return <EmptyState icon="race" title="まだレースの記録がありません">出走すると、ここにタイムやラップが残ります。</EmptyState>;
  return (
    <>
      <div className="filter-row">
        <HorseFilter value={filter} onChange={setFilter} />
        <span className="muted">
          {races.length}戦{races.filter((r) => r.position === 1).length}勝
        </span>
      </div>
      <ul className="rcards">
        {races.slice(0, 80).map((r) => (
          <li key={r.raceId}>
            <RaceCard r={r} onOpen={() => nav.push({ tab: "records", sub: "analysis", raceId: r.raceId })} />
          </li>
        ))}
      </ul>
    </>
  );
}

/* ---------------- レース分析 ---------------- */

const COLOR_MINE = "#1E5FA8";
const COLOR_LEAD = "#C77A1A";

type AnalysisView = "summary" | "flow" | "run" | "detail";
const ANALYSIS_VIEWS: [AnalysisView, string][] = [
  ["summary", "総評"],
  ["flow", "レース展開"],
  ["run", "競走馬の走り"],
  ["detail", "詳細データ"],
];
const CLS_LABEL: Record<InfoClass, string> = { record: "記録", observed: "観察", estimate: "推定", proposal: "提案" };

/** 情報の分類を示す小さな札（色だけに頼らず文字で示す） */
function ClsTag({ cls }: { cls: InfoClass }) {
  return <span className={`cls-tag cls-${cls}`}>{CLS_LABEL[cls]}</span>;
}

/**
 * レース分析。総評 → レース展開 → 競走馬の走り → 詳細データ の順に深くなる。
 * 表示するのは記録・観察できる事実と、根拠を示した推定・提案だけ（レース計算の内部の数値は出さない）
 */
function Analysis({ raceId }: { raceId?: string }) {
  const { save, nav, game, ui } = useOwner();
  const toast = useToast();
  const { busy, run } = useBusy();
  const [found, setFound] = useState<string[] | null>(null);
  const [view, setView] = useState<AnalysisView>("summary");
  const r = save.races.find((x) => x.raceId === raceId) ?? save.races.find((x) => !x.analyzed) ?? save.races[0];
  const findings = useMemo(() => (r ? analyzeRace(r, save.races) : []), [r, save.races]);
  const diag = useMemo(() => (r ? diagnoseRace(r, save.races) : null), [r, save.races]);
  if (!r || !diag) return <EmptyState icon="chart" title="分析できるレースがありません">出走すると、ラップや通過順から能力を推し量れるようになります。</EmptyState>;
  const before = ui.opinions[r.raceId];
  // 調教師の見解は記録から作り直して表示する（古い記録に残る、内部の数値に基づく言い方を出さないため。記録そのものは変えない）
  const comment = composeTrainerComment(r, trainerName(r.trainerId), diag);
  const finding = (title: string) => findings.find((f) => f.title === title);
  const apply = () =>
    run(() => {
      try {
        const out = game.analyze(r.raceId);
        setFound(out.discoveries);
        toast(out.discoveries.length ? `分析を反映しました。${out.discoveries.length}件の新しい情報` : "分析を反映しました（確かさが増しました）", "good");
      } catch (e) {
        toast((e as Error).message, "error");
      }
    });
  const findingBlock = (title: string) => {
    const f = finding(title);
    if (!f) return null;
    return (
      <li key={title}>
        <h3>
          {f.title} <ClsTag cls={f.cls} />
        </h3>
        <p>{f.text}</p>
      </li>
    );
  };
  const history = save.races.filter((x) => x.horseId === r.horseId && x.week <= r.week).slice(0, 6);
  const p400 = r.telemetry.positions.find((p) => p.remain === 400)?.pos;
  const leaders = r.field.filter((f) => f.styleShown === "front");
  return (
    <div className="analysis2">
      <div className="analysis-head">
        <div>
          <h2 className="horse-name">
            {r.horseName}　{r.programName} {r.position}着
          </h2>
          <p className="muted">
            {shortWeekLabel(r.week)}／{courseLabel(r.course)}（{bandForDistance(r.course.distance).label}・{r.course.direction === "right" ? "右回り" : "左回り"}
            {r.course.slope ? "・坂" : ""}
            {r.course.tight ? "・小回り" : ""}）／馬場{GOING_LABELS[r.going]}
          </p>
        </div>
        <label className="select-inline">
          <span>レース</span>
          <select className="select2" value={r.raceId} onChange={(e) => nav.replace({ tab: "records", sub: "analysis", raceId: e.target.value })}>
            {save.races.slice(0, 60).map((x) => (
              <option key={x.raceId} value={x.raceId}>
                {shortWeekLabel(x.week)} {x.horseName} {x.programName} {x.position}着{x.analyzed ? "" : "（未分析）"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Tabs label="分析の表示" value={view} items={ANALYSIS_VIEWS} onChange={setView} />

      {view === "summary" && (
        <div className="cols">
          <Pane title="レース結果">
            <dl className="facts compact">
              <div>
                <dt>着順</dt>
                <dd>
                  {r.position}着／{r.fieldSize}頭
                </dd>
              </div>
              <div>
                <dt>走破タイム</dt>
                <dd>{formatRaceTime(r.timeMs)}</dd>
              </div>
              <div>
                <dt>着差</dt>
                <dd>{r.position === 1 ? `${marginLabel(Math.abs(r.marginToWinner))}差で勝利` : `勝ち馬から${marginLabel(r.marginToWinner)}`}</dd>
              </div>
              <div>
                <dt>上がり3F</dt>
                <dd>
                  {r.telemetry.last600.toFixed(1)}秒（{last600Rank(r)}位）
                </dd>
              </div>
              <div>
                <dt>作戦</dt>
                <dd>
                  {STYLE_LABELS[r.tactics.style]}・{PACE_LABELS[r.tactics.pace]}・仕掛け{SPURT_LABELS[r.tactics.spurt]}
                </dd>
              </div>
            </dl>
            <h3 className="settings-sub">主な観察事項</h3>
            {keyObservations(diag, 3).length ? (
              <ul className="obs-list">
                {keyObservations(diag, 3).map((o) => (
                  <li key={o.id}>
                    <ClsTag cls={o.cls} /> {o.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">特に目立った出来事は記録されていません。</p>
            )}
          </Pane>
          <Pane title="調教師の見解">
            <p className="trainer-voice">{comment.text}</p>
            {diag.views.length > 0 && (
              <ul className="obs-list">
                {diag.views.slice(0, 3).map((v) => (
                  <li key={v.id}>
                    <ClsTag cls="estimate" /> {viewText(v)}
                  </li>
                ))}
              </ul>
            )}
            <h3 className="settings-sub">次走に向けて検討すること</h3>
            <ul className="obs-list">
              {diag.suggestions.map((s) => (
                <li key={s.id}>
                  <ClsTag cls="proposal" /> {suggestionText(s.id)}
                </li>
              ))}
            </ul>
            <p className="hint2">提案は検討の材料です。変えれば必ず良くなるわけではありません。</p>
            {found && found.length > 0 && (
              <div className="result-found">
                <h3>
                  <Icon name="spark" size={16} />
                  分析で分かったこと
                </h3>
                <ul>
                  {found.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>
            )}
            {r.analyzed ? (
              <p className="hint2">
                <Icon name="check" size={14} /> 評価に反映済みです。
                <button className="link2" onClick={() => nav.push({ tab: "horses", horseId: r.horseId, detail: true, horseTab: "ability" })}>
                  見立てを見る
                </button>
              </p>
            ) : (
              <button className="btn btn-primary btn-block" disabled={busy} onClick={apply}>
                分析結果を評価に反映する
              </button>
            )}
          </Pane>
        </div>
      )}

      {view === "flow" && (
        <div className="cols">
          <Pane title="ラップ（200mごと・ゲーム内の計測）">
            <LapChart r={r} />
          </Pane>
          <Pane title="展開">
            <ul className="findings2">
              {findingBlock("レースの流れ")}
              <li>
                <h3>
                  逃げ・先行した馬 <ClsTag cls="record" />
                </h3>
                <p>{leaders.length ? `序盤から前で運んだのは ${leaders.map((f) => `${f.gate}番 ${f.name}（${f.position}着）`).join("、")}。` : "はっきり逃げた馬はいなかった。"}</p>
              </li>
              <li>
                <h3>
                  {r.horseName}の通過順 <ClsTag cls="record" />
                </h3>
                <ol className="pos-flow2">
                  {r.telemetry.positions.map((p) => (
                    <li key={p.label}>
                      <span>{p.label}</span>
                      <strong>{p.pos}</strong>
                    </li>
                  ))}
                </ol>
                {p400 !== undefined && (
                  <p className="muted">
                    最後の直線：残り400mの{p400}番手 → {r.position}着
                  </p>
                )}
              </li>
            </ul>
          </Pane>
        </div>
      )}

      {view === "run" && (
        <div className="cols">
          <Pane title="この馬の走り">
            <ul className="findings2">
              {findingBlock("位置取りと折り合い")}
              {findingBlock("終いの脚")}
              {findingBlock("終盤の粘り")}
              {findingBlock("競り合い")}
            </ul>
          </Pane>
          <Pane title="過去のレースと比べる">
            {history.length > 1 ? (
              <ol className="field-list">
                {history.map((h) => (
                  <li key={h.raceId} className={h.raceId === r.raceId ? "is-me" : ""}>
                    <span className={`mini-rank ${h.position === 1 ? "is-win" : ""}`}>{h.position}</span>
                    <span className="mini-name">
                      {shortWeekLabel(h.week)} {h.programName}
                    </span>
                    <span className="mini-time">
                      {SURFACE_LABELS[h.course.surface]}
                      {h.course.distance}m
                    </span>
                    <span className="mini-gap">
                      上がり{h.telemetry.last600.toFixed(1)}／{STYLE_LABELS[h.telemetry.styleShown]}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">比べられる過去のレースがまだありません。</p>
            )}
            <p className="hint2">距離・馬場・相手が違うレースどうしは、単純には比べられません。</p>
          </Pane>
        </div>
      )}

      {view === "detail" && (
        <div className="cols">
          <Pane title="分析項目と、推定に使える情報">
            <ul className="findings2">
              {findings.map((f, i) => (
                <li key={i}>
                  <h3>
                    {f.title} <ClsTag cls={f.cls} />
                  </h3>
                  <p>{f.text}</p>
                  <p className="chips">
                    {f.informs.map((it) => (
                      <span key={it.key} className={`info2 info-${it.strength}`}>
                        {KNOWLEDGE_LABELS[it.key].replace(/（.*）/, "")}：情報量{it.strength}
                      </span>
                    ))}
                    {f.notInformative.map((n) => (
                      <span key={n.key} className="info2 info-none" title={n.reason}>
                        {KNOWLEDGE_LABELS[n.key].replace(/（.*）/, "")}：判断できない
                      </span>
                    ))}
                  </p>
                </li>
              ))}
            </ul>
          </Pane>
          <Pane title="出走馬">
            <ol className="field-list">
              {r.field.map((f) => (
                <li key={f.gate} className={f.isMine ? "is-me" : ""}>
                  <span className={`mini-rank ${f.position === 1 ? "is-win" : ""}`}>{f.position}</span>
                  <SaddleCloth gate={f.gate} size="sm" />
                  <span className="mini-name">{f.name}</span>
                  <span className="mini-time">{formatRaceTime(f.timeMs)}</span>
                  <span className="mini-gap">
                    上がり{f.last600.toFixed(1)}／{STYLE_LABELS[f.styleShown]}
                  </span>
                </li>
              ))}
            </ol>
            <h3 className="settings-sub">調教師の事前評価と結果</h3>
            <div className="compare">
              <p>
                出走前：{before ? <StanceTag stance={before.stance} /> : <span className="muted">記録なし</span>}
                {before?.reasons.length ? <span className="muted">（{before.reasons.slice(0, 2).join("、")}）</span> : null}
              </p>
              <p>
                結果：<strong>{r.position}着</strong>
              </p>
            </div>
            <p className="hint2">
              {trainerName(r.trainerId)}厩舎／賞金 {yen(r.prize)}。タイム・ラップ・上がり3Fはゲーム内のシミュレーションの計測値です。実際の位置（脚質）は序盤・中盤・終盤の通過順位から判定しています。
            </p>
          </Pane>
        </div>
      )}
    </div>
  );
}

/** 先頭と自分の馬の200mごとのラップ（1本の軸。上ほど速い） */
function LapChart({ r }: { r: OwnerRaceRecord }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const mine = r.telemetry.splits.map((t, i, a) => Math.round((t - (i ? a[i - 1] : 0)) * 100) / 100);
  const lead = r.leaderLaps;
  const n = Math.min(mine.length, lead.length);
  if (n < 2) return <p className="muted">ラップを表示できるほどの距離がありません。</p>;
  const all = [...mine.slice(0, n), ...lead.slice(0, n)];
  const lo = Math.floor(Math.min(...all) - 0.3);
  const hi = Math.ceil(Math.max(...all) + 0.3);
  const W = 560;
  const H = 200;
  const pad = { l: 34, r: 52, t: 10, b: 24 };
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / (n - 1);
  const y = (v: number) => pad.t + ((v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const path = (vals: number[]) => vals.slice(0, n).map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const ticks = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
  let ym = y(mine[n - 1]);
  let yl = y(lead[n - 1]);
  if (Math.abs(ym - yl) < 14) {
    const mid = (ym + yl) / 2;
    const up = ym <= yl;
    ym = mid + (up ? -7 : 7);
    yl = mid + (up ? 7 : -7);
  }
  const step = (W - pad.l - pad.r) / (n - 1);
  return (
    <div className="lap2">
      <div className="chart-legend">
        <span>
          <i style={{ background: COLOR_MINE }} />
          {r.horseName}
        </span>
        <span>
          <i style={{ background: COLOR_LEAD }} />
          先頭
        </span>
        <button className="link2" onClick={() => setAsTable(!asTable)}>
          {asTable ? "グラフで見る" : "数値で見る"}
        </button>
      </div>
      {asTable ? (
        <ul className="lap-cards">
          {Array.from({ length: n }, (_, i) => (
            <li key={i}>
              <span>
                {i * 200}〜{(i + 1) * 200}m
              </span>
              <strong>{mine[i].toFixed(1)}</strong>
              <span className="muted">先頭 {lead[i].toFixed(1)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="200mごとのラップ（上ほど速い）" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
              <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="axis">
                {t}
              </text>
            </g>
          ))}
          {Array.from({ length: n }, (_, i) =>
            i % Math.ceil(n / 7) === 0 || i === n - 1 ? (
              <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="axis">
                {(i + 1) * 200}m
              </text>
            ) : null,
          )}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="crosshair" />}
          <path d={path(lead)} fill="none" stroke={COLOR_LEAD} strokeWidth={2} strokeLinejoin="round" />
          <path d={path(mine)} fill="none" stroke={COLOR_MINE} strokeWidth={2} strokeLinejoin="round" />
          <text x={x(n - 1) + 6} y={ym + 4} className="axis-strong">
            {r.horseName.length > 4 ? r.horseName.slice(0, 3) + "…" : r.horseName}
          </text>
          <text x={x(n - 1) + 6} y={yl + 4} className="axis-strong">
            先頭
          </text>
          {hover !== null && (
            <>
              <circle cx={x(hover)} cy={y(lead[hover])} r={4} fill={COLOR_LEAD} stroke="#fff" strokeWidth={2} />
              <circle cx={x(hover)} cy={y(mine[hover])} r={4} fill={COLOR_MINE} stroke="#fff" strokeWidth={2} />
            </>
          )}
          {Array.from({ length: n }, (_, i) => (
            <rect key={i} x={x(i) - step / 2} y={pad.t} width={step} height={H - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
          ))}
        </svg>
      )}
      <p className="chart-tip2">
        {hover !== null && !asTable
          ? `${hover * 200}〜${(hover + 1) * 200}m：${r.horseName} ${mine[hover].toFixed(1)}秒／先頭 ${lead[hover].toFixed(1)}秒`
          : "縦軸は200mにかかった秒数（上ほど速い）。終盤に線が上がっていれば末脚を使えています。"}
      </p>
    </div>
  );
}

/* ---------------- 評価の推移 ---------------- */

function Evals({ horseId }: { horseId?: string }) {
  const { vm, nav } = useOwner();
  const horses = vm.allHorses.filter((h) => h.knowledgeEvents.length > 0 || h.status === "active");
  const [id, setId] = useState(horseId ?? horses[0]?.id ?? "");
  const h = vm.allHorses.find((x) => x.id === id);
  if (!h) return <EmptyState icon="chart" title="記録がありません" />;
  return (
    <>
      <div className="filter-row">
        <label className="select-inline">
          <span>馬</span>
          <select className="select2" value={id} onChange={(e) => setId(e.target.value)}>
            {horses.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <button className="link2" onClick={() => nav.push({ tab: "horses", horseId: id, detail: true, horseTab: "ability" })}>
          今の見立てを開く
        </button>
      </div>
      <p className="hint2">各能力の、最初に分かった評価と今の評価です。「推定の修正」は見立ての変化で、能力そのものの変化ではありません。</p>
      <ul className="eval-cards">
        {ABILITY_KEYS.map((k) => {
          const now = h.knowledge[k];
          const evs = h.knowledgeEvents.filter((e) => e.key === k);
          const first = evs[0];
          return (
            <li key={k} className="eval-card">
              <div className="eval-top">
                <strong>{ABILITY_LABELS[k]}</strong>
                <span className="eval-now">{now.stage === "abstract" ? "未判明" : now.stage === "numeric" ? `${now.rank}・${now.value}` : now.rank}</span>
              </div>
              {evs.length === 0 ? (
                <p className="muted">まだ評価は出ていません（{now.comment}）</p>
              ) : (
                <ol className="eval-steps">
                  {evs.map((e, i) => (
                    <li key={i} className={`event-${e.type}`}>
                      <span>{shortWeekLabel(e.week)}</span>
                      <span>{e.type === "revise" ? "推定の修正" : "判明"}</span>
                      <span className="eval-text">{e.text.replace(`${ABILITY_LABELS[k]}の`, "").replace(/（推定の修正であり.*）/, "")}</span>
                    </li>
                  ))}
                </ol>
              )}
              {first && evs.some((e) => e.type === "revise") && <p className="hint2">最初の評価から見立てが修正されています。</p>}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* ---------------- 収支・名簿 ---------------- */

function Ledger() {
  const { save, vm, nav } = useOwner();
  const horses = [...vm.allHorses].sort((a, b) => b.record.totalPrize - a.record.totalPrize);
  const finance = [...save.finance].reverse().slice(0, 60);
  const income = save.finance.filter((f) => f.amount > 0 && f.week > 0).reduce((a, f) => a + f.amount, 0);
  const spend = save.finance.filter((f) => f.amount < 0).reduce((a, f) => a + f.amount, 0);
  return (
    <div className="cols">
      <Pane title="所有した馬（獲得賞金順）">
        <ul className="ledger-horses">
          {horses.map((h) => (
            <li key={h.id}>
              <button className="ledger-horse" onClick={() => nav.push({ tab: "horses", horseId: h.id, detail: true, horseTab: "overview" })}>
                <strong className="horse-name">{h.name}</strong>
                <span>
                  {h.age}歳／{h.record.races}戦{h.record.wins}勝／{h.status === "active" ? "現役" : h.status === "retired" ? "引退" : "売却"}
                </span>
                <span className="gold-num">{yen(h.record.totalPrize)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Pane>
      <Pane title="お金の出入り">
        <p className="ledger-sum">
          収入 <strong className="plus2">{yenSigned(income)}</strong>　支出 <strong className="minus2">{yenSigned(spend)}</strong>
        </p>
        <ul className="ledger-list">
          {finance.map((f, i) => (
            <li key={i}>
              <span className="muted">{shortWeekLabel(f.week)}</span>
              <span>{f.note}</span>
              <strong className={f.amount >= 0 ? "plus2" : "minus2"}>{yenSigned(f.amount)}</strong>
            </li>
          ))}
        </ul>
      </Pane>
    </div>
  );
}

/* ---------------- 検証（開発・バランス調整用） ---------------- */

const CLASSES = Object.keys(CLASS_DEFS) as ClassId[];

function Lab() {
  const courses = useMemo(() => allCourses(), []);
  const [abilities, setAbilities] = useState<Abilities>(() => Object.fromEntries(ABILITY_KEYS.map((k) => [k, 60])) as Abilities);
  const [courseId, setCourseId] = useState(courses.find((c) => c.distance === 1600)!.id);
  const [range, setRange] = useState<[number, number]>([1400, 2000]);
  const [tactics, setTactics] = useState<Tactics>({ style: "stalker", pace: "normal", spurt: "normal" });
  const [rows, setRows] = useState<{ cls: ClassId; s: TrialStats }[] | null>(null);
  const { busy, run } = useBusy();
  const exec = () =>
    run(
      () =>
        new Promise<void>((res) =>
          setTimeout(() => {
            const course = courses.find((c) => c.id === courseId)!;
            setRows(
              CLASSES.map((cls) => {
                const p: OwnerProgram = { id: "lab", week: 0, name: "検証", classId: cls, course, going: "good", fieldSize: 8, firstPrize: 0, ageMin: 2, ageMax: 9, conditionText: "", named: false };
                const s = runTrials(
                  {
                    abilities,
                    aptitude: { distanceMin: range[0], distanceMax: range[1], turf: 75, dirt: 75, heavy: 50, right: 60, left: 60, slope: 50, tight: 50, styles: { front: 70, stalker: 70, closer: 70, deep: 70 } },
                    traits: [],
                    tactics,
                    condition: 0,
                    fatigue: 10,
                    fitness: 85,
                    experience: 5,
                  },
                  p,
                  100,
                  12345,
                );
                return { cls, s };
              }),
            );
            res();
          }, 30),
        ),
    );
  return (
    <div className="cols">
      <Pane title="仮の馬">
        <p className="hint2">開発・バランス調整用です。所有馬の本当の能力はここでも使いません。</p>
        <div className="lab-sliders">
          {ABILITY_KEYS.map((k) => (
            <label key={k}>
              <span>
                {ABILITY_LABELS[k]} <strong>{abilities[k]}</strong>
              </span>
              <input type="range" min={20} max={100} value={abilities[k]} onChange={(e) => setAbilities({ ...abilities, [k]: Number(e.target.value) })} />
            </label>
          ))}
          <label>
            <span>
              適性距離 {range[0]}〜{range[1]}m
            </span>
            <input type="range" min={1000} max={3000} step={100} value={range[0]} onChange={(e) => setRange([Number(e.target.value), Math.max(Number(e.target.value) + 200, range[1])])} />
          </label>
        </div>
      </Pane>
      <Pane title="条件と結果">
        <label className="select-inline">
          <span>コース</span>
          <select className="select2" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {courseLabel(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="select-inline">
          <span>脚質</span>
          <select className="select2" value={tactics.style} onChange={(e) => setTactics({ ...tactics, style: e.target.value as Tactics["style"] })}>
            {STYLE_KEYS.map((s) => (
              <option key={s} value={s}>
                {STYLE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="select-inline">
          <span>ペース</span>
          <select className="select2" value={tactics.pace} onChange={(e) => setTactics({ ...tactics, pace: e.target.value as PacePlan })}>
            {(Object.keys(PACE_LABELS) as PacePlan[]).map((s) => (
              <option key={s} value={s}>
                {PACE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="select-inline">
          <span>仕掛け</span>
          <select className="select2" value={tactics.spurt} onChange={(e) => setTactics({ ...tactics, spurt: e.target.value as SpurtPlan })}>
            {(Object.keys(SPURT_LABELS) as SpurtPlan[]).map((s) => (
              <option key={s} value={s}>
                {SPURT_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-primary btn-block" disabled={busy} onClick={exec}>
          {busy ? "計算中…" : "各クラスで100回走らせる"}
        </button>
        {rows && (
          <ul className="lab-results">
            {rows.map(({ cls, s }) => (
              <li key={cls}>
                <strong>{CLASS_DEFS[cls].label}</strong>
                <span>勝率 {Math.round(s.winRate * 100)}%</span>
                <span>3着内 {Math.round(s.top3Rate * 100)}%</span>
                <span>平均 {s.avgPosition.toFixed(1)}着</span>
              </li>
            ))}
          </ul>
        )}
      </Pane>
    </div>
  );
}
