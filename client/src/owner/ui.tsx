// 馬主モードの共通表示部品。受け取るのは表示用データ（HorseView・ReportVM など）だけ。
import type { ReactNode } from "react";
import {
  ABILITY_KEYS,
  CONDITION_LABELS,
  findTrainer,
  shortWeekLabel,
  type DisplayStage,
  type HorseState,
  type HorseView,
  type KnowledgeView,
  type Stance,
  type TraitView,
} from "@owners/shared";
import { Icon, type IconName } from "./icons";
import { COAT_LABELS, HorseFigure, coatOf } from "./art";
import { IMPORTANCE_LABELS, REPORT_KIND_LABELS, type HorseCardVM, type Importance, type ReportVM } from "./vm";

export const STAGE_LABELS: Record<DisplayStage, string> = { abstract: "見立て", rank: "ランク判明", numeric: "数値判明" };

export const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
export const yenSigned = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toLocaleString("ja-JP")}円`;

export function trainerName(id: string): string {
  return findTrainer(id)?.name ?? "（不明）";
}

const IMP_ICON: Record<Importance, IconName> = { urgent: "alert", check: "bell", normal: "info" };

/** 重要度（色＋アイコン＋文字） */
export function ImportanceTag({ level, label }: { level: Importance; label?: string }) {
  return (
    <span className={`imp imp-${level}`}>
      <Icon name={IMP_ICON[level]} size={14} />
      {label ?? IMPORTANCE_LABELS[level]}
    </span>
  );
}

/** HorseConditionBadge：体調・疲労をひとことで */
export function HorseConditionBadge({ c }: { c: HorseCardVM["condition"] }) {
  return <ImportanceTag level={c.level} label={c.label} />;
}

/** 疲労・仕上がり・健康・調子 */
export function StateMeters({ s, compact }: { s: HorseState; compact?: boolean }) {
  const meter = (label: string, v: number, warnAt: number, dangerAt: number, inverse = false) => {
    const lvl = inverse ? (v >= dangerAt ? "bad" : v >= warnAt ? "warn" : "ok") : v < dangerAt ? "bad" : v < warnAt ? "warn" : "ok";
    return (
      <div className={`meter meter-${lvl}`}>
        <span className="meter-label">{label}</span>
        <span className="meter-track" aria-hidden>
          <span style={{ width: `${v}%` }} />
        </span>
        <span className="meter-value">{v}</span>
      </div>
    );
  };
  return (
    <div className={`meters ${compact ? "is-compact" : ""}`}>
      {meter("疲労", s.fatigue, 45, 70, true)}
      {meter("仕上がり", s.fitness, 60, 35)}
      {meter("健康", s.health, 60, 40)}
      <div className={`meter meter-mood mood-${s.condition}`}>
        <span className="meter-label">調子</span>
        <strong>{CONDITION_LABELS[String(s.condition)]}</strong>
      </div>
    </div>
  );
}

/** HorseSummaryCard：所有馬の要点（絵・名前・状態・次の予定・能力調査の進み具合） */
export function HorseSummaryCard({ h, selected, onOpen }: { h: HorseCardVM; selected?: boolean; onOpen: () => void }) {
  const v = h.view;
  return (
    <button className={`horse-card horse-tile ${selected ? "is-selected" : ""} lv-${h.condition.level}`} onClick={onOpen} aria-pressed={selected}>
      <span className="horse-tile-pic" aria-hidden>
        <HorseFigure horseId={v.id} shadow={false} />
      </span>
      <span className="horse-tile-body">
        <span className="horse-card-top">
          <span className="horse-name">{v.name}</span>
          <span className="pill">{v.age}歳</span>
          {h.unreadReports > 0 && (
            <span className="pill pill-new">
              <Icon name="report" size={13} />
              報告 {h.unreadReports}
            </span>
          )}
        </span>
        <span className="horse-card-sub">
          {COAT_LABELS[coatOf(v.id)]}／{h.trainerName}厩舎／{v.record.races}戦{v.record.wins}勝
        </span>
        <span className="horse-tile-state">
          <HorseConditionBadge c={h.condition} />
          <Mood c={v.state.condition} />
        </span>
        <span className="horse-card-plan">
          <Icon name="clock" size={14} />
          {h.nextPlan}
        </span>
        <span className="horse-card-progress" aria-label={`能力調査 ${h.known}/6 判明、解明度 ${h.progress}%`}>
          <span className="progress-track" aria-hidden>
            <span style={{ width: `${h.progress}%` }} />
          </span>
          <span>能力調査 {h.known}/6</span>
        </span>
      </span>
    </button>
  );
}

/** 調子（矢印＋言葉） */
export function Mood({ c, large }: { c: number; large?: boolean }) {
  const icon: IconName = c >= 1 ? "up" : c <= -1 ? "down" : "flat";
  return (
    <span className={`mood mood-${c} ${large ? "is-large" : ""}`}>
      <Icon name={icon} size={large ? 20 : 14} />
      {CONDITION_LABELS[String(c)]}
    </span>
  );
}

/** 円形のゲージ（疲労・仕上がり・健康など）。inverse は「少ないほど良い」 */
export function Ring({ label, value, warnAt, dangerAt, inverse = false, note }: { label: string; value: number; warnAt: number; dangerAt: number; inverse?: boolean; note?: string }) {
  const lvl = inverse ? (value >= dangerAt ? "bad" : value >= warnAt ? "warn" : "ok") : value < dangerAt ? "bad" : value < warnAt ? "warn" : "ok";
  const word = lvl === "ok" ? "良好" : lvl === "warn" ? "注意" : "危険";
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <div className={`ring ring-${lvl}`} role="img" aria-label={`${label} ${value}（${word}）`}>
      <svg viewBox="0 0 56 56" aria-hidden>
        <circle cx="28" cy="28" r={r} className="ring-track" />
        <circle cx="28" cy="28" r={r} className="ring-bar" strokeDasharray={`${(c * Math.max(0, Math.min(100, value))) / 100} ${c}`} transform="rotate(-90 28 28)" />
        <text x="28" y="33" textAnchor="middle">
          {value}
        </text>
      </svg>
      <span className="ring-label">{label}</span>
      <span className="ring-note">{note ?? word}</span>
    </div>
  );
}

/** 適性の短い表示（距離・馬場・脚質）。未検証は点線、未判明は「？」 */
export function AptMark({ v, label }: { v: KnowledgeView; label: string }) {
  const mark = v.stage === "abstract" && !v.mark ? "？" : v.mark ?? "？";
  const cls = mark === "◎" ? "m-best" : mark === "○" ? "m-good" : mark === "△" ? "m-fair" : mark === "×" ? "m-bad" : "m-unknown";
  return (
    <span className={`aptm ${cls} ${v.unverified ? "is-unverified" : ""}`} title={`${v.label}：${v.unverified ? "未検証" : v.comment}`}>
      <span>{label}</span>
      <b>{mark}</b>
    </span>
  );
}

/** 能力1行：段階（見立て・ランク・数値）と推定の確かさを分けて表示する */
export function AbilityRow({ v, fresh }: { v: KnowledgeView; fresh?: boolean }) {
  return (
    <div className={`ability stage-${v.stage} ${fresh ? "is-fresh" : ""}`}>
      <span className="ability-label">{v.label}</span>
      <span className="ability-value">
        {v.stage === "abstract" ? (
          <span className="rank-box is-unknown" aria-label="未判明">
            ？
          </span>
        ) : (
          <span className={`rank-box rank-${v.rank}`}>{v.rank}</span>
        )}
        {v.stage === "numeric" && <span className="ability-num">{v.value}</span>}
      </span>
      <span className="ability-comment">{v.comment}</span>
      <Certainty v={v} />
      {fresh && (
        <span className="ability-fresh">
          <Icon name="spark" size={13} />
          新たに判明
        </span>
      )}
    </div>
  );
}

export function Certainty({ v }: { v: KnowledgeView }) {
  const level = v.certainty === "高い" ? 3 : v.certainty === "中程度" ? 2 : v.certainty === "低い" ? 1 : 0;
  return (
    <span className="cert" title={`解明度 ${v.knowledgeScore}%／証拠 ${v.evidenceCount}件`}>
      <span className="cert-dots" aria-hidden>
        {[1, 2, 3].map((i) => (
          <i key={i} className={i <= level ? "on" : ""} />
        ))}
      </span>
      <span>確かさ：{v.certainty}</span>
    </span>
  );
}

/** AbilityDiscoveryPanel：6能力 */
export function AbilityDiscoveryPanel({ view, freshKeys }: { view: HorseView; freshKeys?: Set<string> }) {
  return (
    <div className="ability-list">
      {ABILITY_KEYS.map((k) => (
        <AbilityRow key={k} v={view.knowledge[k]} fresh={freshKeys?.has(k)} />
      ))}
    </div>
  );
}

/** 適性1項目 */
export function AptitudeCell({ v, label }: { v: KnowledgeView; label: string }) {
  const note = v.unverified ? (v.mark ? "見込み・未検証" : "未検証") : v.stage === "abstract" ? "判断材料不足" : `確かさ：${v.certainty}`;
  return (
    <div className={`aptc ${v.unverified ? "is-unverified" : ""}`} title={v.comment}>
      <span className="aptc-label">{label}</span>
      <strong className="aptc-mark">{v.mark ?? "−"}</strong>
      <span className="aptc-note">{note}</span>
    </div>
  );
}

export function TraitChips({ traits }: { traits: TraitView[] }) {
  if (traits.length === 0) return <p className="muted">まだ個性ははっきりしていません。観察や実戦を重ねると見えてきます。</p>;
  return (
    <ul className="traits">
      {traits.map((t) => (
        <li key={t.id} className={`trait trait-${t.status}`} title={t.desc}>
          <strong>{t.label}</strong>
          <span>{t.status === "confirmed" ? "判明" : "兆候あり"}</span>
        </li>
      ))}
    </ul>
  );
}

/** StableReportCard：要約を先に出し、タップで詳細 */
export function StableReportCard({ r, onOpen, showHorse = true }: { r: ReportVM; onOpen: () => void; showHorse?: boolean }) {
  return (
    <button className={`report-card imp-border-${r.importance} ${r.unread ? "is-unread" : ""}`} onClick={onOpen}>
      <span className="report-top">
        <ImportanceTag level={r.importance} />
        <span className="report-kind">{REPORT_KIND_LABELS[r.kind]}</span>
        {r.needsReply && <span className="pill pill-reply">回答待ち</span>}
        {r.unread && <span className="unread-dot" aria-label="未確認" />}
      </span>
      <span className="report-meta">
        {showHorse && <strong>{r.report.horseName}</strong>}
        <span>{shortWeekLabel(r.report.week)}</span>
        <span>{trainerName(r.report.trainerId)}調教師</span>
      </span>
      <span className="report-summary">{r.summary}</span>
    </button>
  );
}

export function StanceTag({ stance }: { stance: Stance }) {
  const icon: Record<Stance, IconName> = { 推奨: "check", 賛成: "check", 慎重: "alert", 反対: "close" };
  return (
    <span className={`stance stance-${stance}`}>
      <Icon name={icon[stance]} size={14} />
      {stance}
    </span>
  );
}

/** ActionBar：画面下部の主要操作 */
export function ActionBar({ children, info }: { children: ReactNode; info?: ReactNode }) {
  return (
    <div className="action-bar">
      {info && <div className="action-info">{info}</div>}
      <div className="action-buttons">{children}</div>
    </div>
  );
}

/** 画面内のペイン（中だけスクロールする） */
export function Pane({ title, aside, children, className = "" }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`pane ${className}`}>
      {(title || aside) && (
        <header className="pane-head">
          {title && <h2>{title}</h2>}
          {aside}
        </header>
      )}
      <div className="pane-body">{children}</div>
    </section>
  );
}

/** タブ（あふれたらタブ列の中だけ横にスクロールする） */
export function Tabs<T extends string>({ value, items, onChange, label }: { value: T; items: [T, string][]; onChange: (t: T) => void; label: string }) {
  return (
    <div className="tabs-row" role="tablist" aria-label={label}>
      {items.map(([id, l]) => (
        <button key={id} role="tab" aria-selected={value === id} onClick={() => onChange(id)}>
          {l}
        </button>
      ))}
    </div>
  );
}
