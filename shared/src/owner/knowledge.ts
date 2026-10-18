// 情報解明システム（指示書 6・9・10章）。画面やレース計算から独立したモジュール。
//
// ・馬主が知っているのは「証拠」だけ。証拠は 真の値 + 情報源の偏り + 観測のばらつき として生まれる
// ・同じ情報源の偏りは何度観察しても消えない（調教師の思い込み）。別の情報源で修正できる
// ・古い証拠ほど信頼度を下げる（馬は成長するので、昔の観察は今の能力からずれていく）
// ・推定の不確実性が小さくなった能力から、抽象表現 → 評価ランク → 数値 の順に開示する
// ・この処理は推定だけを更新し、真の能力値には一切触れない
import { rankOf, fitMark } from "./aptitude";
import { DEFAULT_CONFIG, type GameConfig } from "./config";
import { createRng, gaussian, type Rng } from "../rng";
import {
  KNOWLEDGE_KEYS,
  KNOWLEDGE_LABELS,
  MEASURED_KINDS,
  RACE_KINDS,
  SOLID_KINDS,
  TRAIT_DEFS,
  isAbilityKey,
  type DisplayStage,
  type Evidence,
  type EvidenceKind,
  type HorseKnowledge,
  type KnowledgeEntry,
  type KnowledgeEvent,
  type KnowledgeKey,
  type TraitId,
  type TraitKnowledge,
} from "./model";

/** 1項目あたり保持する証拠の上限（古いものから捨てる） */
export const EVIDENCE_CAP = 24;
export const KNOWLEDGE_EVENT_CAP = 200;

const STAGE_ORDER: Record<DisplayStage, number> = { abstract: 0, rank: 1, numeric: 2 };

export function emptyEntry(cfg: GameConfig = DEFAULT_CONFIG): KnowledgeEntry {
  return {
    evidence: [],
    estimatedValue: null,
    uncertainty: cfg.disclosure.priorSd,
    knowledgeScore: 0,
    displayStage: "abstract",
    lastObservedAt: null,
  };
}

export function emptyKnowledge(cfg: GameConfig = DEFAULT_CONFIG): HorseKnowledge {
  const entries = {} as Record<KnowledgeKey, KnowledgeEntry>;
  for (const k of KNOWLEDGE_KEYS) entries[k] = emptyEntry(cfg);
  return { entries, traits: {}, events: [] };
}

/* ---------------- 証拠の生成 ---------------- */

/** 文字列から32bitのハッシュ（FNV-1a） */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 情報源ごとの偏り（同じ馬・同じ情報源・同じ項目なら常に同じ値）。標準正規分布に従う */
export function persistentBias(biasSeed: number, src: string, key: string): number {
  const rng = createRng(hash32(`${biasSeed}|${src}|${key}`));
  return gaussian(rng);
}

export interface ObservationSpec {
  key: KnowledgeKey;
  kind: EvidenceKind;
  src: string;
  /** 真の値（呼び出し側が truth から渡す。ここでは保存しない） */
  trueValue: number;
  /** 観測精度の倍率（調教師の評価能力などで変わる。1が標準、小さいほど正確） */
  skillScale: number;
  /** 情報量の倍率（短距離戦でのスタミナなど、条件が悪いと大きくする） */
  infoScale?: number;
  ref?: string;
}

/** 観察1回分の証拠を作る。真の値は証拠の中には残らない */
export function makeEvidence(
  spec: ObservationSpec,
  biasSeed: number,
  week: number,
  rng: Rng,
  cfg: GameConfig = DEFAULT_CONFIG,
): Evidence {
  const s = cfg.sources[spec.kind];
  const q = s.noise * spec.skillScale * (spec.infoScale ?? 1);
  const b = s.biasSd * spec.skillScale;
  const v = spec.trueValue + b * persistentBias(biasSeed, spec.src, spec.key) + gaussian(rng) * q;
  return {
    w: week,
    src: spec.src,
    k: spec.kind,
    v: Math.round(Math.max(-20, Math.min(120, v)) * 10) / 10,
    q: Math.round(q * 100) / 100,
    b: Math.round(b * 100) / 100,
    ...(spec.ref ? { ref: spec.ref } : {}),
  };
}

/* ---------------- 推定 ---------------- */

export interface Estimate {
  estimatedValue: number | null;
  uncertainty: number;
  knowledgeScore: number;
  measured: number;
  solid: number;
  race: number;
}

/**
 * 証拠から現在の推定を計算する。
 * 情報源ごとにまとめた平均には「その情報源の偏り」の分の不確実性が必ず残るので、
 * 同じ調教師の報告をいくら重ねても確信は頭打ちになり、別の情報源（実戦の分析など）で修正される。
 */
export function estimate(evidence: readonly Evidence[], now: number, cfg: GameConfig = DEFAULT_CONFIG): Estimate {
  const d = cfg.disclosure;
  const priorPrec = 1 / (d.priorSd * d.priorSd);
  if (evidence.length === 0) {
    return { estimatedValue: null, uncertainty: d.priorSd, knowledgeScore: 0, measured: 0, solid: 0, race: 0 };
  }
  const groups = new Map<string, { sumW: number; sumWV: number; bias: number }>();
  for (const e of evidence) {
    const stale = Math.max(0, now - e.w) * d.staleSdPerWeek;
    const varI = e.q * e.q + stale * stale;
    const g = groups.get(e.src) ?? { sumW: 0, sumWV: 0, bias: 0 };
    g.sumW += 1 / varI;
    g.sumWV += e.v / varI;
    g.bias = Math.max(g.bias, e.b);
    groups.set(e.src, g);
  }
  let prec = priorPrec;
  let sum = d.priorMean * priorPrec;
  for (const g of groups.values()) {
    const mean = g.sumWV / g.sumW;
    const varG = 1 / g.sumW + g.bias * g.bias;
    prec += 1 / varG;
    sum += mean / varG;
  }
  const sd = Math.sqrt(1 / prec);
  const value = Math.max(0, Math.min(100, sum / prec));
  return {
    estimatedValue: Math.round(value * 10) / 10,
    uncertainty: Math.round(sd * 100) / 100,
    knowledgeScore: Math.round(Math.max(0, Math.min(100, (1 - sd / d.priorSd) * 100))),
    measured: evidence.filter((e) => MEASURED_KINDS.includes(e.k)).length,
    solid: evidence.filter((e) => SOLID_KINDS.includes(e.k)).length,
    // 同じレースから得た証拠（調教師の評と馬主の分析）は1レースとして数える
    race: new Set(evidence.filter((e) => RACE_KINDS.includes(e.k)).map((e) => e.ref ?? `w${e.w}`)).size,
  };
}

/** 今の証拠で到達できる開示段階 */
export function reachableStage(est: Estimate, cfg: GameConfig = DEFAULT_CONFIG): DisplayStage {
  const d = cfg.disclosure;
  if (est.estimatedValue === null || est.solid === 0) return "abstract";
  if (est.uncertainty <= d.numericSd && est.measured >= d.numericMinMeasured && est.race >= d.numericMinRace) return "numeric";
  if (est.uncertainty <= d.rankSd) return "rank";
  return "abstract";
}

function maxStage(a: DisplayStage, b: DisplayStage): DisplayStage {
  return STAGE_ORDER[a] >= STAGE_ORDER[b] ? a : b;
}

/* ---------------- 表示用の見え方 ---------------- */

export type Certainty = "高い" | "中程度" | "低い" | "なし";

export interface KnowledgeView {
  key: KnowledgeKey;
  label: string;
  stage: DisplayStage;
  /** 数値（数値開示の段階のみ） */
  value: number | null;
  /** 評価ランク（ランク開示以降） */
  rank: string | null;
  /** 適性の記号（適性項目でランク開示以降） */
  mark: string | null;
  certainty: Certainty;
  knowledgeScore: number;
  uncertainty: number;
  evidenceCount: number;
  measuredCount: number;
  lastObservedAt: number | null;
  /** 計測を伴う証拠がまだない（未検証） */
  unverified: boolean;
  comment: string;
}

export function certaintyOf(sd: number, hasEvidence: boolean): Certainty {
  if (!hasEvidence) return "なし";
  if (sd <= 4) return "高い";
  if (sd <= 8.5) return "中程度";
  return "低い";
}

export function viewEntry(key: KnowledgeKey, entry: KnowledgeEntry, now: number, cfg: GameConfig = DEFAULT_CONFIG): KnowledgeView {
  const est = estimate(entry.evidence, now, cfg);
  const stage = maxStage(entry.displayStage, reachableStage(est, cfg));
  const has = est.estimatedValue !== null;
  const ability = isAbilityKey(key);
  const value = stage === "numeric" && has ? Math.round(est.estimatedValue!) : null;
  const rank = stage !== "abstract" && has ? rankOf(est.estimatedValue!, cfg) : null;
  const mark = !ability && stage !== "abstract" && has ? fitMark(est.estimatedValue!) : null;
  return {
    key,
    label: KNOWLEDGE_LABELS[key],
    stage,
    value,
    rank,
    mark,
    certainty: certaintyOf(est.uncertainty, has),
    knowledgeScore: est.knowledgeScore,
    uncertainty: est.uncertainty,
    evidenceCount: entry.evidence.length,
    measuredCount: est.measured,
    lastObservedAt: entry.lastObservedAt,
    unverified: est.measured === 0,
    comment: describe(key, est, stage),
  };
}

export function viewKnowledge(k: HorseKnowledge, now: number, cfg: GameConfig = DEFAULT_CONFIG): Record<KnowledgeKey, KnowledgeView> {
  const out = {} as Record<KnowledgeKey, KnowledgeView>;
  for (const key of KNOWLEDGE_KEYS) out[key] = viewEntry(key, k.entries[key], now, cfg);
  return out;
}

/* ---------------- 更新 ---------------- */

function summary(v: KnowledgeView): string {
  if (v.stage === "numeric") return isAbilityKey(v.key) ? `${v.value}` : `${v.mark}（${v.value}）`;
  if (v.stage === "rank") return isAbilityKey(v.key) ? `${v.rank}` : `${v.mark}`;
  return "不明";
}

/**
 * 証拠を追加して推定を更新する（元の knowledge は変更しない）。
 * 開示段階が上がったときと、評価が変わったときに履歴（events）を残す。
 */
export function addEvidence(
  k: HorseKnowledge,
  items: { key: KnowledgeKey; evidence: Evidence }[],
  now: number,
  sourceLabel: string,
  cfg: GameConfig = DEFAULT_CONFIG,
): HorseKnowledge {
  if (items.length === 0) return k;
  const entries = { ...k.entries };
  const events: KnowledgeEvent[] = [];
  const touched = new Set<KnowledgeKey>();
  const before = new Map<KnowledgeKey, KnowledgeView>();
  for (const it of items) {
    if (!before.has(it.key)) before.set(it.key, viewEntry(it.key, entries[it.key], now, cfg));
    const e = entries[it.key];
    const evidence = [...e.evidence, it.evidence].slice(-EVIDENCE_CAP);
    entries[it.key] = { ...e, evidence, lastObservedAt: Math.max(e.lastObservedAt ?? -Infinity, it.evidence.w) };
    touched.add(it.key);
  }
  for (const key of touched) {
    const e = entries[key];
    const est = estimate(e.evidence, now, cfg);
    const stage = maxStage(e.displayStage, reachableStage(est, cfg));
    entries[key] = {
      ...e,
      estimatedValue: est.estimatedValue,
      uncertainty: est.uncertainty,
      knowledgeScore: est.knowledgeScore,
      displayStage: stage,
    };
    const prev = before.get(key)!;
    const next = viewEntry(key, entries[key], now, cfg);
    const label = KNOWLEDGE_LABELS[key];
    const stageUp = STAGE_ORDER[next.stage] > STAGE_ORDER[prev.stage];
    if (stageUp) {
      events.push({
        week: now,
        key,
        type: "stage",
        text: next.stage === "numeric" ? `${label}の数値が判明：${summary(next)}` : `${label}の評価が判明：${summary(next)}`,
        source: sourceLabel,
      });
    }
    // すでに評価が出ていた項目の評価が変わったら「評価の修正」として残す（段階が上がった場合も含む）
    if (cfg.disclosure.logRankChanges && prev.stage !== "abstract" && next.stage !== "abstract") {
      const changed = isAbilityKey(key) ? prev.rank !== next.rank : prev.mark !== next.mark;
      if (changed) {
        const up = rankScore(next) > rankScore(prev);
        const from = isAbilityKey(key) ? prev.rank : prev.mark;
        const to = isAbilityKey(key) ? next.rank : next.mark;
        events.push({
          week: now,
          key,
          type: "revise",
          text: `${label}の評価を${up ? "上方" : "下方"}修正：${from} → ${to}（推定の修正であり、能力そのものの変化ではありません）`,
          source: sourceLabel,
        });
      }
    }
  }
  return { ...k, entries, events: [...k.events, ...events].slice(-KNOWLEDGE_EVENT_CAP) };
}

function rankScore(v: KnowledgeView): number {
  const order = ["E", "D", "C", "B", "A", "S"];
  if (v.rank) return order.indexOf(v.rank) * 20;
  const marks = ["×", "△", "○", "◎"];
  return v.mark ? marks.indexOf(v.mark) * 25 : 0;
}

/* ---------------- 個性 ---------------- */

/**
 * 個性の兆候を記録する。appeared=false は「兆候が出てもおかしくない場面で出なかった」こと。
 * 兆候ありの見立てが外れていた場合は、出ない場面が続くと取り下げる。
 */
export function recordTraitSign(
  k: HorseKnowledge,
  trait: TraitId,
  appeared: boolean,
  week: number,
  sourceLabel: string,
  cfg: GameConfig = DEFAULT_CONFIG,
): HorseKnowledge {
  const cur: TraitKnowledge = k.traits[trait] ?? { signs: 0, misses: 0, status: "unknown", firstSeenWeek: null };
  if (cur.status === "confirmed") return k;
  let next: TraitKnowledge;
  const events: KnowledgeEvent[] = [];
  const label = TRAIT_DEFS[trait].label;
  if (appeared) {
    const signs = cur.signs + 1;
    const status = signs >= cfg.traitConfirmAt ? "confirmed" : signs >= cfg.traitHintAt ? "hint" : "unknown";
    next = { signs, misses: 0, status, firstSeenWeek: cur.firstSeenWeek ?? week };
    if (status !== cur.status) {
      events.push({
        week,
        key: trait,
        type: "trait",
        text: status === "confirmed" ? `個性が判明：「${label}」` : `個性の兆候：「${label}」かもしれない`,
        source: sourceLabel,
      });
    }
  } else {
    if (cur.status !== "hint") return k;
    const misses = cur.misses + 1;
    if (misses >= 8) {
      next = { signs: 0, misses: 0, status: "unknown", firstSeenWeek: null };
      events.push({ week, key: trait, type: "revise", text: `「${label}」の見立てを取り下げ（その後兆候が見られない）`, source: sourceLabel });
    } else next = { ...cur, misses };
  }
  return { ...k, traits: { ...k.traits, [trait]: next }, events: [...k.events, ...events].slice(-KNOWLEDGE_EVENT_CAP) };
}

/** 引退・売却した馬の証拠を間引いてセーブを小さく保つ */
export function compactKnowledge(k: HorseKnowledge): HorseKnowledge {
  const entries = {} as Record<KnowledgeKey, KnowledgeEntry>;
  for (const key of KNOWLEDGE_KEYS) entries[key] = { ...k.entries[key], evidence: k.entries[key].evidence.slice(-4) };
  return { ...k, entries, events: k.events.slice(-40) };
}

/* ---------------- 抽象表現 ---------------- */

type Level = "high" | "mid" | "low";
const COMMENTS: Record<string, Record<Level, string>> = {
  speed: {
    high: "脚の回転が軽く、素早い動きが見られる",
    mid: "スピードは平均的な水準に見える",
    low: "速い走りにはまだ物足りなさがある",
  },
  acceleration: {
    high: "加速時の反応が鋭い",
    mid: "反応は悪くないが、鋭さは判断しきれない",
    low: "エンジンのかかりがゆっくりしている",
  },
  stamina: {
    high: "運動後の回復が早く、息の持ちが良さそう",
    mid: "持久力は並程度に見える",
    low: "長く走ると余裕がなくなる様子がある",
  },
  power: {
    high: "走りに力強さがある",
    mid: "力強さは平均的",
    low: "馬体の力強さはまだこれから",
  },
  fightingSpirit: {
    high: "負けん気が強く、並ばれると踏ん張る",
    mid: "気の強さは普通に見える",
    low: "競り合いになると気持ちが引いてしまう面がある",
  },
  raceSense: {
    high: "落ち着きがあり、指示に従いやすい",
    mid: "人の指示への反応は普通",
    low: "周りに気を取られやすく、集中が続かない",
  },
};

function levelOf(v: number): Level {
  return v >= 65 ? "high" : v >= 45 ? "mid" : "low";
}

/** 推定を言葉にする（抽象表現の段階では数値もランクも出さない） */
export function describe(key: KnowledgeKey, est: Estimate, stage: DisplayStage): string {
  if (est.estimatedValue === null) {
    return isAbilityKey(key) ? "現時点では判断材料が不足している" : "未検証";
  }
  const v = est.estimatedValue;
  const sd = est.uncertainty;
  if (isAbilityKey(key)) {
    const base = COMMENTS[key][levelOf(v)];
    if (stage === "numeric") return sd <= 3 ? `${base}。実戦データで裏付けられている` : base;
    if (stage === "rank") {
      const r = rankOf(v);
      if (sd > 5.5 && (r === "B" || r === "A")) return `${base}。上位水準かどうかは追加調査が必要`;
      return base;
    }
    if (sd > 14) return `${base}（まだ断定はできない）`;
    return `${base}（判断材料はまだ少ない）`;
  }
  // 適性
  const unverified = est.measured === 0;
  const lean = v >= 70 ? "合っていそう" : v >= 45 ? "こなせそう" : "合わない可能性がある";
  if (unverified) return `未検証（見た目の印象では${lean}）`;
  if (stage === "abstract") return `${lean}。判断にはもう少し材料が必要`;
  return v >= 85 ? "よく合っている" : v >= 65 ? "合っている" : v >= 40 ? "大きな問題はないが得意ではない" : "苦手としている";
}
