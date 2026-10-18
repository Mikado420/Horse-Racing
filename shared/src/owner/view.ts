// 馬主に見せてよい情報だけを取り出す（指示書 15章）。
// 画面はこの「見え方」だけを使い、真の能力値（truth）には触れない。
// オンライン化したときは、サーバーがこの形に変換してから送れば非公開データは漏れない。
import { ageAt, ageStage } from "./calendar";
import { DEFAULT_CONFIG, type GameConfig } from "./config";
import { viewKnowledge, type KnowledgeView } from "./knowledge";
import {
  TRAIT_DEFS,
  type AgeStage,
  type HorseLogEntry,
  type HorsePolicy,
  type HorseRecord,
  type HorseState,
  type HorseStatus,
  type KnowledgeEvent,
  type KnowledgeKey,
  type RaceHorse,
  type TraitId,
  type TraitStatus,
} from "./model";

export interface TraitView {
  id: TraitId;
  label: string;
  desc: string;
  status: Exclude<TraitStatus, "unknown">;
}

export interface HorseView {
  id: string;
  name: string;
  age: number;
  ageStage: AgeStage;
  birthYear: number;
  sireName: string | null;
  damName: string | null;
  trainerId: string;
  relationship: number;
  state: HorseState;
  policy: HorsePolicy;
  record: HorseRecord;
  status: HorseStatus;
  racedWeek: number | null;
  purchasePrice: number;
  acquiredWeek: number;
  knowledge: Record<KnowledgeKey, KnowledgeView>;
  traits: TraitView[];
  knowledgeEvents: KnowledgeEvent[];
  log: HorseLogEntry[];
}

export function traitViews(h: RaceHorse): TraitView[] {
  const out: TraitView[] = [];
  for (const [id, k] of Object.entries(h.knowledge.traits) as [TraitId, { status: TraitStatus }][]) {
    if (k.status === "unknown") continue;
    out.push({ id, label: TRAIT_DEFS[id].label, desc: TRAIT_DEFS[id].desc, status: k.status });
  }
  return out.sort((a, b) => (a.status === b.status ? 0 : a.status === "confirmed" ? -1 : 1));
}

export function toHorseView(h: RaceHorse, week: number, cfg: GameConfig = DEFAULT_CONFIG): HorseView {
  return {
    id: h.id,
    name: h.name,
    age: ageAt(h, week),
    ageStage: ageStage(h, week),
    birthYear: h.birthYear,
    sireName: h.sireName,
    damName: h.damName,
    trainerId: h.trainerId,
    relationship: h.relationship,
    state: { ...h.state },
    policy: { ...h.policy },
    record: { ...h.record },
    status: h.status,
    racedWeek: h.racedWeek,
    purchasePrice: h.purchasePrice,
    acquiredWeek: h.acquiredWeek,
    knowledge: viewKnowledge(h.knowledge, week, cfg),
    traits: traitViews(h),
    knowledgeEvents: [...h.knowledge.events],
    log: [...h.log],
  };
}
