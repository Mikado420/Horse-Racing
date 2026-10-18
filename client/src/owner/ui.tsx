// 馬主モードの共通部品
import type { ReactNode } from "react";
import {
  CONDITION_LABELS,
  findTrainer,
  type DisplayStage,
  type HorseState,
  type KnowledgeView,
  type Stance,
  type TraitView,
} from "@owners/shared";
import { Gauge } from "../components";

export const STAGE_LABELS: Record<DisplayStage, string> = { abstract: "見立て", rank: "ランク", numeric: "数値" };

export function trainerName(id: string): string {
  return findTrainer(id)?.name ?? "（不明）";
}

/** 能力1項目の見え方（抽象表現 → 評価ランク → 数値） */
export function AbilityRow({ v }: { v: KnowledgeView }) {
  return (
    <div className={`kn-row stage-${v.stage}`}>
      <span className="kn-label">{v.label}</span>
      <span className="kn-value" aria-label={`${v.label}：${v.value ?? v.rank ?? "未判明"}`}>
        {v.stage === "numeric" ? (
          <>
            <strong className={`rank-chip rank-${v.rank}`}>{v.rank}</strong>
            <strong className="kn-num">{v.value}</strong>
          </>
        ) : v.stage === "rank" ? (
          <strong className={`rank-chip rank-${v.rank}`}>{v.rank}</strong>
        ) : (
          <span className="kn-unknown">？</span>
        )}
      </span>
      <span className="kn-comment">{v.comment}</span>
      <Certainty v={v} />
    </div>
  );
}

export function Certainty({ v }: { v: KnowledgeView }) {
  const level = v.certainty === "高い" ? 3 : v.certainty === "中程度" ? 2 : v.certainty === "低い" ? 1 : 0;
  return (
    <span className="kn-cert" title={`評価の確かさ：${v.certainty}／解明度 ${v.knowledgeScore}%／証拠 ${v.evidenceCount}件`}>
      <span className="kn-dots" aria-hidden>
        {[1, 2, 3].map((i) => (
          <i key={i} className={i <= level ? "on" : ""} />
        ))}
      </span>
      <small>確かさ {v.certainty}</small>
      <span className="kn-meter" aria-label={`解明度 ${v.knowledgeScore}%`}>
        <span style={{ width: `${v.knowledgeScore}%` }} />
      </span>
    </span>
  );
}

/** 適性1項目（◎○△× または 未検証） */
export function AptitudeCell({ v, short }: { v: KnowledgeView; short?: string }) {
  const label = short ?? v.label;
  return (
    <div className={`apt-cell ${v.unverified ? "is-unverified" : ""} stage-${v.stage}`} title={v.comment}>
      <span className="apt-cell-label">{label}</span>
      <strong className="apt-cell-mark">{v.mark ?? (v.unverified ? "未検証" : "？")}</strong>
      <small className="apt-cell-note">
        {v.unverified && v.mark ? "見込み・未検証" : v.stage === "numeric" ? `適性 ${v.value}` : v.unverified ? "実績なし" : `確かさ ${v.certainty}`}
      </small>
    </div>
  );
}

export function TraitChips({ traits }: { traits: TraitView[] }) {
  if (traits.length === 0) return <p className="muted small">まだ個性ははっきりしていません。観察や実戦を重ねると見えてきます。</p>;
  return (
    <ul className="trait-chips">
      {traits.map((t) => (
        <li key={t.id} className={`trait trait-${t.status}`} title={t.desc}>
          <strong>{t.label}</strong>
          <small>{t.status === "confirmed" ? "判明" : "兆候あり"}</small>
        </li>
      ))}
    </ul>
  );
}

export function StateBlock({ s, compact }: { s: HorseState; compact?: boolean }) {
  return (
    <dl className={`state-block ${compact ? "is-compact" : ""}`}>
      <div>
        <dt>疲労</dt>
        <dd>
          <Gauge value={s.fatigue} danger={70} />
          <span>{s.fatigue}</span>
        </dd>
      </div>
      <div>
        <dt>仕上がり</dt>
        <dd>
          <span className="gauge gauge-ok" role="meter" aria-valuenow={s.fitness}>
            <span style={{ width: `${s.fitness}%` }} />
          </span>
          <span>{s.fitness}</span>
        </dd>
      </div>
      <div>
        <dt>健康</dt>
        <dd>
          <span className={`gauge ${s.health < 40 ? "gauge-danger" : s.health < 60 ? "gauge-warn" : "gauge-ok"}`} role="meter" aria-valuenow={s.health}>
            <span style={{ width: `${s.health}%` }} />
          </span>
          <span>{s.health}</span>
        </dd>
      </div>
      <div>
        <dt>調子</dt>
        <dd className={`mood mood-${s.condition}`}>{CONDITION_LABELS[String(s.condition)]}</dd>
      </div>
      {s.injuryWeeks > 0 && (
        <div className="state-injury">
          <dt>故障</dt>
          <dd>治療中（あと{s.injuryWeeks}週）</dd>
        </div>
      )}
    </dl>
  );
}

export function StanceChip({ stance }: { stance: Stance }) {
  return <span className={`stance stance-${stance}`}>{stance}</span>;
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="o-section">
      <div className="o-section-head">
        <h2 className="section-title">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export const yenSigned = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toLocaleString("ja-JP")}円`;
