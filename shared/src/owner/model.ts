// 馬主モードのデータ構造。
//
// 1頭の競走馬を次の4つに分けて持つ（指示書 2.3・9・19章）。
//   truth     … 真の能力・適性・個性・成長型。レース計算と育成にだけ使い、画面には出さない
//   state     … 疲労・調子・健康・仕上がり。厩舎が日々把握している状態（馬主にも報告される）
//   knowledge … 馬主側が把握している推定。観察・調教・実戦の証拠から作る
//   record    … 戦績など誰でも見られる公開情報
// 「能力が判明すること」と「能力が成長すること」は truth と knowledge の別々の更新として扱う。

import type { RunningStyle } from "../types";

export const ABILITY_KEYS = ["speed", "acceleration", "stamina", "power", "fightingSpirit", "raceSense"] as const;
export type AbilityKey = (typeof ABILITY_KEYS)[number];
export type Abilities = Record<AbilityKey, number>;

export const ABILITY_LABELS: Record<AbilityKey, string> = {
  speed: "スピード",
  acceleration: "加速力",
  stamina: "スタミナ",
  power: "パワー",
  fightingSpirit: "根性",
  raceSense: "賢さ",
};

/** 距離帯（情報解明の単位）。範囲はメートル */
export const DISTANCE_BANDS = [
  { key: "dist_sprint", label: "短距離", min: 1000, max: 1400 },
  { key: "dist_mile", label: "マイル", min: 1500, max: 1800 },
  { key: "dist_middle", label: "中距離", min: 1900, max: 2400 },
  { key: "dist_long", label: "長距離", min: 2500, max: 3200 },
] as const;
export type DistanceBandKey = (typeof DISTANCE_BANDS)[number]["key"];

export const STYLE_KEYS: readonly RunningStyle[] = ["front", "stalker", "closer", "deep"];

/** 情報解明の対象（能力・適性ごとに独立して管理する） */
export const KNOWLEDGE_KEYS = [
  ...ABILITY_KEYS,
  "dist_sprint",
  "dist_mile",
  "dist_middle",
  "dist_long",
  "surface_turf",
  "surface_dirt",
  "going_heavy",
  "course_right",
  "course_left",
  "course_slope",
  "course_tight",
  "style_front",
  "style_stalker",
  "style_closer",
  "style_deep",
] as const;
export type KnowledgeKey = (typeof KNOWLEDGE_KEYS)[number];

export const KNOWLEDGE_LABELS: Record<KnowledgeKey, string> = {
  ...ABILITY_LABELS,
  dist_sprint: "短距離（〜1400m）",
  dist_mile: "マイル（1500〜1800m）",
  dist_middle: "中距離（1900〜2400m）",
  dist_long: "長距離（2500m〜）",
  surface_turf: "芝",
  surface_dirt: "ダート",
  going_heavy: "道悪（稍重〜不良）",
  course_right: "右回り",
  course_left: "左回り",
  course_slope: "坂のあるコース",
  course_tight: "小回りコース",
  style_front: "逃げ",
  style_stalker: "先行",
  style_closer: "差し",
  style_deep: "追込",
};

export function isAbilityKey(k: string): k is AbilityKey {
  return (ABILITY_KEYS as readonly string[]).includes(k);
}

/** 個性（2〜4個）。観察・調教・実戦を通じて徐々に分かる */
export const TRAIT_DEFS = {
  calm: { label: "折り合いが良い", desc: "余計なエネルギー消費が少ない", seenIn: "both" },
  keen: { label: "行きたがる", desc: "抑える指示に抵抗し、序盤に消耗しやすい", seenIn: "both" },
  frontObsessed: { label: "逃げへの執着", desc: "先頭を狙う傾向がある", seenIn: "race" },
  hatesCrowd: { label: "馬群が苦手", desc: "密集時に進路選択や速度維持が難しい", seenIn: "race" },
  wideRunner: { label: "外を回るのが得意", desc: "外側を回る不利が小さい", seenIn: "race" },
  gutsy: { label: "勝負根性が強い", desc: "接戦で粘りやすい", seenIn: "race" },
  closerKick: { label: "末脚型", desc: "終盤に強い加速を見せやすい", seenIn: "both" },
  inconsistent: { label: "ムラがある", desc: "能力発揮の変動が大きい", seenIn: "both" },
} as const;
export type TraitId = keyof typeof TRAIT_DEFS;
export const TRAIT_IDS = Object.keys(TRAIT_DEFS) as TraitId[];
/** 同時に持たない組み合わせ */
export const TRAIT_CONFLICTS: [TraitId, TraitId][] = [["calm", "keen"]];

export type GrowthType = "early" | "normal" | "late";

/** 真の適性。fit 系は 0〜100（50が平均的、100が最適） */
export interface TrueAptitude {
  /** 適性距離の下限・上限（100m単位のメートル） */
  distanceMin: number;
  distanceMax: number;
  turf: number;
  dirt: number;
  /** 道悪（稍重〜不良）への適性 */
  heavy: number;
  right: number;
  left: number;
  slope: number;
  tight: number;
  styles: Record<RunningStyle, number>;
}

/** 画面には出さない真の情報 */
export interface HorseTruth {
  abilities: Abilities;
  /** 成長の上限 */
  potential: Abilities;
  growthType: GrowthType;
  /** 調教の積み重ね（能力ごと 0〜1）。成長曲線のどこまで能力を引き出せるかに効く */
  development: Abilities;
  aptitude: TrueAptitude;
  traits: TraitId[];
  /** 調教師ごとの見立ての癖を決める種 */
  biasSeed: number;
  /** 能力成長の記録（情報解明とは別の、馬そのものの変化） */
  growthLog: { week: number; key: AbilityKey; from: number; to: number }[];
}

export interface HorseState {
  /** 疲労 0〜100（短期） */
  fatigue: number;
  /** 調子 -2〜+2 */
  condition: number;
  /** 健康 0〜100（低いと故障しやすい。疲労とは別に管理） */
  health: number;
  /** 仕上がり 0〜100 */
  fitness: number;
  /** 故障による休養の残り週数 */
  injuryWeeks: number;
  /** 経験（調教・実戦の積み重ね） */
  experience: number;
}

export type EvidenceKind =
  | "farmObservation"
  | "trainerObservation"
  | "workout"
  | "raceTrainer"
  | "raceAnalysis"
  | "saleInspection";

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  farmObservation: "牧場での観察",
  trainerObservation: "厩舎の観察",
  workout: "調教時計",
  raceTrainer: "調教師のレース評",
  raceAnalysis: "馬主の分析",
  saleInspection: "販売時の下見",
};

/** 計測を伴う証拠（数値開示の条件に数える） */
export const MEASURED_KINDS: readonly EvidenceKind[] = ["workout", "raceTrainer", "raceAnalysis"];
/** 実戦から得た証拠（数値開示の条件に数える） */
export const RACE_KINDS: readonly EvidenceKind[] = ["raceTrainer", "raceAnalysis"];
/** 牧場・下見より確かな証拠（評価ランク開示の条件に数える） */
export const SOLID_KINDS: readonly EvidenceKind[] = ["trainerObservation", "workout", "raceTrainer", "raceAnalysis"];

/** 証拠1件 */
export interface Evidence {
  /** 観測した週 */
  w: number;
  /** 情報源（同じ情報源の偏りは何度見ても消えない）。例: "trainer:t2", "analysis" */
  src: string;
  k: EvidenceKind;
  /** 観測値（0〜100のスケール） */
  v: number;
  /** 観測のばらつき */
  q: number;
  /** この情報源の偏りの大きさ */
  b: number;
  /** 何から得たか（レースID・調教内容など） */
  ref?: string;
}

export type DisplayStage = "abstract" | "rank" | "numeric";

export interface KnowledgeEntry {
  evidence: Evidence[];
  /** 証拠から計算した推定（null は証拠なし） */
  estimatedValue: number | null;
  uncertainty: number;
  knowledgeScore: number;
  /** 一度到達した開示段階（後戻りしない） */
  displayStage: DisplayStage;
  lastObservedAt: number | null;
}

export type TraitStatus = "unknown" | "hint" | "confirmed";
export interface TraitKnowledge {
  signs: number;
  /** 兆候が出る機会があったのに出なかった回数（兆候ありの見立てを取り下げる判断に使う） */
  misses: number;
  status: TraitStatus;
  firstSeenWeek: number | null;
}

export interface KnowledgeEvent {
  week: number;
  key: KnowledgeKey | TraitId;
  type: "stage" | "rank" | "revise" | "trait";
  text: string;
  source: string;
}

export interface HorseKnowledge {
  entries: Record<KnowledgeKey, KnowledgeEntry>;
  traits: Partial<Record<TraitId, TraitKnowledge>>;
  events: KnowledgeEvent[];
}

/** 馬主が厩舎に伝える育成方針 */
export const POLICY_DEFS = {
  growth: { label: "成長重視", desc: "無理をさせず、体の成長を優先する" },
  earlyDebut: { label: "早期デビュー重視", desc: "早めに仕上げて実戦に向かう" },
  health: { label: "体調・健康優先", desc: "疲労と健康を最優先に管理する" },
  strengthen: { label: "能力強化重視", desc: "負荷を高めて能力を伸ばす" },
  recovery: { label: "疲労回復優先", desc: "休養を中心にして疲れを抜く" },
  distanceSurvey: { label: "距離適性の調査", desc: "長めの調教で距離への対応を確かめる" },
  surfaceSurvey: { label: "芝・ダート適性の調査", desc: "芝とダートの両方で走らせて確かめる" },
  raceExperience: { label: "実戦経験の獲得", desc: "使いながら経験を積ませる" },
  longTerm: { label: "大レースを目指した長期育成", desc: "目標レースから逆算してじっくり育てる" },
} as const;
export type PolicyId = keyof typeof POLICY_DEFS;
export const POLICY_IDS = Object.keys(POLICY_DEFS) as PolicyId[];

export interface HorsePolicy {
  policy: PolicyId;
  /** follow: 調教師の提案に従う / insist: 方針を優先させる（無理をさせることもある） */
  mode: "follow" | "insist";
  /** 目標レース（番組ID） */
  goalRaceId: string | null;
}

export interface HorseRecord {
  races: number;
  wins: number;
  seconds: number;
  thirds: number;
  totalPrize: number;
  lastRaceWeek: number | null;
}

export type HorseLogKind = "report" | "training" | "race" | "knowledge" | "owner";
export interface HorseLogEntry {
  week: number;
  kind: HorseLogKind;
  text: string;
  /** 調教の詳細（調教時計など） */
  detail?: string;
  raceId?: string;
}

export type HorseStatus = "active" | "retired" | "sold";

export interface RaceHorse {
  id: string;
  name: string;
  ownerId: string;
  /** 生まれた年（ゲーム内の年） */
  birthYear: number;
  /** 血統（将来の繁殖・配合に備えた欄） */
  sireId: string | null;
  damId: string | null;
  sireName: string | null;
  damName: string | null;
  trainerId: string;
  /** 現在の調教師との関係 0〜100 */
  relationship: number;
  truth: HorseTruth;
  state: HorseState;
  policy: HorsePolicy;
  knowledge: HorseKnowledge;
  record: HorseRecord;
  /** このゲーム週に出走済み（同じ週に2度は走れない） */
  racedWeek: number | null;
  status: HorseStatus;
  /** 購入価格（売却・記録用） */
  purchasePrice: number;
  acquiredWeek: number;
  log: HorseLogEntry[];
}

/** 年齢による成長段階 */
export type AgeStage = 0 | 1 | 2 | 3;
