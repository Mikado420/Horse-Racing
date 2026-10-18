// レースの分析（指示書 8章）：ラップ・通過順・上がり・不利を振り返り、評価に反映する
import { useMemo, useState } from "react";
import {
  GOING_LABELS,
  KNOWLEDGE_LABELS,
  STYLE_LABELS,
  SURFACE_LABELS,
  analyzeRace,
  bandForDistance,
  formatRaceTime,
  last600Rank,
  marginLabel,
  shortWeekLabel,
  type OwnerRaceRecord,
} from "@owners/shared";
import { Notice, SaddleCloth } from "../components";
import { yen } from "../format";
import type { OwnerGame } from "../offline/useOwnerGame";
import type { OScreen } from "./OwnerApp";
import { Section } from "./ui";

const COLOR_MINE = "#1E5FA8";
const COLOR_LEAD = "#C77A1A";

export function AnalysisScreen({ game, raceId, horseId, go }: { game: OwnerGame; raceId?: string; horseId?: string; go: (s: OScreen) => void }) {
  const save = game.save!;
  const [filter, setFilter] = useState<string>(horseId ?? "");
  const [result, setResult] = useState<{ kind: "good" | "error"; text: string; items?: string[] } | null>(null);
  const races = save.races.filter((r) => !filter || r.horseId === filter);
  const selected = save.races.find((r) => r.raceId === raceId) ?? null;
  const horseNames = [...new Map(save.races.map((r) => [r.horseId, r.horseName])).entries()];

  if (save.races.length === 0) {
    return (
      <div className="page">
        <h1 className="page-title">分析</h1>
        <p className="muted">まだレースの記録がありません。出走すると、ラップや通過順からその馬の能力を推し量れるようになります。</p>
      </div>
    );
  }

  const apply = () => {
    if (!selected) return;
    try {
      const out = game.analyze(selected.raceId);
      setResult({
        kind: "good",
        text: out.discoveries.length ? "分析を評価に反映しました。新しく分かったこと：" : "分析を評価に反映しました（見立ての段階は変わりませんでしたが、確かさが増しています）。",
        items: out.discoveries,
      });
    } catch (e) {
      setResult({ kind: "error", text: (e as Error).message });
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">分析</h1>
      <p className="lead">
        レース映像とラップを見直して、能力を推し量ります。何が分かるかはレースの中身次第です。短距離戦ではスタミナは分からず、競り合いがなければ根性も分かりません。
      </p>
      <div className="analysis-layout">
        <aside className="race-list" aria-label="レースの記録">
          <label className="select-row">
            <span>馬</span>
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">すべて</option>
              {horseNames.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <ul>
            {races.slice(0, 60).map((r) => (
              <li key={r.raceId}>
                <button
                  className={`race-li ${r.raceId === selected?.raceId ? "is-picked" : ""}`}
                  onClick={() => {
                    setResult(null);
                    go({ name: "analysis", raceId: r.raceId, horseId: filter || undefined });
                  }}
                >
                  <strong>
                    {r.horseName} <span className={r.position === 1 ? "pos-win" : ""}>{r.position}着</span>
                  </strong>
                  <span className="muted small">
                    {shortWeekLabel(r.week)} {r.programName} {SURFACE_LABELS[r.course.surface]}
                    {r.course.distance}m
                  </span>
                  {!r.analyzed && <span className="tag">未分析</span>}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="analysis-main">
          {!selected ? (
            <p className="muted">左の一覧からレースを選んでください。</p>
          ) : (
            <RaceAnalysis r={selected} result={result} onApply={apply} onHorse={() => go({ name: "horse", horseId: selected.horseId })} />
          )}
        </div>
      </div>
    </div>
  );
}

function RaceAnalysis({
  r,
  result,
  onApply,
  onHorse,
}: {
  r: OwnerRaceRecord;
  result: { kind: "good" | "error"; text: string; items?: string[] } | null;
  onApply: () => void;
  onHorse: () => void;
}) {
  const findings = useMemo(() => analyzeRace(r), [r]);
  const band = bandForDistance(r.course.distance);
  return (
    <>
      <h2 className="analysis-title">
        {r.programName}　{r.horseName} {r.position}着
      </h2>
      <p className="muted">
        {shortWeekLabel(r.week)} ・ {r.course.trackName} {SURFACE_LABELS[r.course.surface]}
        {r.course.distance}m（{band.label}・{r.course.direction === "right" ? "右回り" : "左回り"}
        {r.course.slope ? "・坂あり" : ""}
        {r.course.tight ? "・小回り" : ""}） ・ 馬場{GOING_LABELS[r.going]} ・ 作戦 {STYLE_LABELS[r.tactics.style]}
      </p>
      <p className="trainer-comment">{r.trainerComment}</p>

      <Section title="何が読み取れるか">
        <ul className="findings">
          {findings.map((f, i) => (
            <li key={i} className="finding">
              <h3>{f.title}</h3>
              <p>{f.text}</p>
              <p className="finding-info">
                {f.informs.map((it) => (
                  <span key={it.key} className={`info-chip info-${it.strength}`}>
                    {KNOWLEDGE_LABELS[it.key].replace(/（.*）/, "")}
                    <small>情報量 {it.strength}</small>
                  </span>
                ))}
                {f.notInformative.map((n) => (
                  <span key={n.key} className="info-chip info-none" title={n.reason}>
                    {KNOWLEDGE_LABELS[n.key].replace(/（.*）/, "")}
                    <small>判断できない</small>
                  </span>
                ))}
              </p>
              {f.notInformative.map((n) => (
                <p key={n.key} className="hint">
                  {n.reason}
                </p>
              ))}
            </li>
          ))}
        </ul>
        {result && (
          <Notice kind={result.kind}>
            {result.text}
            {result.items && result.items.length > 0 && (
              <ul className="discoveries">
                {result.items.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
          </Notice>
        )}
        {r.analyzed ? (
          <p className="hint">
            このレースの分析は評価に反映済みです。{" "}
            <button className="link" onClick={onHorse}>
              見立てを見る
            </button>
          </p>
        ) : (
          <button className="btn btn-primary" onClick={onApply}>
            分析結果を評価に反映する
          </button>
        )}
      </Section>

      <Section title="ラップ（200mごと）">
        <LapChart r={r} />
      </Section>

      <Section title="通過順">
        <PositionFlow r={r} />
      </Section>

      <Section title="出走馬">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>着</th>
                <th>馬</th>
                <th>タイム</th>
                <th>着差</th>
                <th>上がり3F</th>
                <th>位置取り</th>
              </tr>
            </thead>
            <tbody>
              {r.field.map((f) => (
                <tr key={f.gate} className={f.isMine ? "is-me" : ""}>
                  <td className={`rank rank-${f.position}`}>{f.position}</td>
                  <td>
                    <SaddleCloth gate={f.gate} size="sm" /> {f.name}
                  </td>
                  <td>{formatRaceTime(f.timeMs)}</td>
                  <td>{f.position === 1 ? "" : marginLabel(f.marginLengths)}</td>
                  <td>{f.last600.toFixed(1)}</td>
                  <td>{STYLE_LABELS[f.styleShown]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">
          上がり3F は出走馬中{last600Rank(r)}位。賞金 {yen(r.prize)}。
        </p>
      </Section>
    </>
  );
}

/** 先頭と自分の馬の200mごとのラップ（1本の軸の折れ線。小さいほど速い） */
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
  const W = 640;
  const H = 220;
  const pad = { l: 40, r: 64, t: 12, b: 28 };
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / (n - 1);
  const y = (v: number) => pad.t + ((v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const path = (vals: number[]) => vals.slice(0, n).map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const ticks = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);

  return (
    <div className="lap-chart">
      <div className="chart-legend" aria-hidden>
        <span>
          <i style={{ background: COLOR_MINE }} />
          {r.horseName}
        </span>
        <span>
          <i style={{ background: COLOR_LEAD }} />
          先頭
        </span>
        <button className="link" onClick={() => setAsTable(!asTable)}>
          {asTable ? "グラフで見る" : "表で見る"}
        </button>
      </div>
      {asTable ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>区間</th>
                <th className="num">{r.horseName}</th>
                <th className="num">先頭</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: n }, (_, i) => (
                <tr key={i}>
                  <td>
                    {i * 200}〜{(i + 1) * 200}m
                  </td>
                  <td className="num">{mine[i].toFixed(1)}秒</td>
                  <td className="num">{lead[i].toFixed(1)}秒</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="200mごとのラップ。上ほど速い" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
              <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="axis">
                {t}
              </text>
            </g>
          ))}
          {Array.from({ length: n }, (_, i) =>
            i % Math.ceil(n / 8) === 0 || i === n - 1 ? (
              <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="axis">
                {(i + 1) * 200}m
              </text>
            ) : null,
          )}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="crosshair" />}
          <path d={path(lead)} fill="none" stroke={COLOR_LEAD} strokeWidth={2} strokeLinejoin="round" />
          <path d={path(mine)} fill="none" stroke={COLOR_MINE} strokeWidth={2} strokeLinejoin="round" />
          {/* 直接ラベル（右端）。近いときは上下に離す */}
          {(() => {
            let ym = y(mine[n - 1]);
            let yl = y(lead[n - 1]);
            if (Math.abs(ym - yl) < 14) {
              const mid = (ym + yl) / 2;
              const up = ym <= yl;
              ym = mid + (up ? -7 : 7);
              yl = mid + (up ? 7 : -7);
            }
            return (
              <>
                <text x={x(n - 1) + 8} y={ym + 4} className="axis-strong">
                  {r.horseName.length > 5 ? r.horseName.slice(0, 4) + "…" : r.horseName}
                </text>
                <text x={x(n - 1) + 8} y={yl + 4} className="axis-strong">
                  先頭
                </text>
              </>
            );
          })()}
          {hover !== null && (
            <>
              <circle cx={x(hover)} cy={y(mine[hover])} r={4} fill={COLOR_MINE} stroke="#fbfcf9" strokeWidth={2} />
              <circle cx={x(hover)} cy={y(lead[hover])} r={4} fill={COLOR_LEAD} stroke="#fbfcf9" strokeWidth={2} />
            </>
          )}
          {Array.from({ length: n }, (_, i) => (
            <rect
              key={i}
              x={x(i) - (W - pad.l - pad.r) / (n - 1) / 2}
              y={pad.t}
              width={(W - pad.l - pad.r) / (n - 1)}
              height={H - pad.t - pad.b}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
            />
          ))}
        </svg>
      )}
      {hover !== null && !asTable && (
        <p className="chart-tip">
          {hover * 200}〜{(hover + 1) * 200}m：{r.horseName} {mine[hover].toFixed(1)}秒 ／ 先頭 {lead[hover].toFixed(1)}秒
        </p>
      )}
      <p className="hint">縦軸は200mを走るのにかかった秒数です（上ほど速い）。終盤に線が上がっていれば末脚を使えています。</p>
    </div>
  );
}

function PositionFlow({ r }: { r: OwnerRaceRecord }) {
  const pos = r.telemetry.positions;
  return (
    <ol className="pos-flow">
      {pos.map((p) => (
        <li key={p.label}>
          <span className="muted small">{p.label}</span>
          <strong>{p.pos}</strong>
          <span className="muted small">番手</span>
        </li>
      ))}
    </ol>
  );
}
