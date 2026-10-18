// 厩舎の1週間（指示書 3.2・4・5・11章）。
// 馬主は方針を伝えるだけで、調教の中身は調教師が馬の状態を見て決めて実行する。
// 1週ごとに：調教の実行 → 状態（疲労・健康・調子・仕上がり）の変化 → 能力の成長 → 観察と報告。
// 成長は truth、観察結果は knowledge へ、それぞれ別々に反映する。
import { gaussian, randInt, type Rng } from "../rng";
import { ageAt, ageStage, weeksSinceBirth } from "./calendar";
import { DEFAULT_CONFIG, type GameConfig } from "./config";
import { truthValue } from "./aptitude";
import { applyWeeklyGrowth } from "./growth";
import { addEvidence, makeEvidence, recordTraitSign, viewEntry } from "./knowledge";
import {
  ABILITY_KEYS,
  DISTANCE_BANDS,
  KNOWLEDGE_LABELS,
  TRAIT_DEFS,
  TRAIT_IDS,
  isAbilityKey,
  type AbilityKey,
  type Evidence,
  type EvidenceKind,
  type HorseLogEntry,
  type KnowledgeKey,
  type PolicyId,
  type RaceHorse,
  type TraitId,
} from "./model";
import { skillScale, trainingEfficiency, type Trainer } from "./trainers";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const PLAN_DEFS = {
  farm: { label: "放牧・観察", load: 0 },
  breaking: { label: "育成調教（馴致）", load: 0.45 },
  rest: { label: "休養", load: 0 },
  light: { label: "軽めの調整", load: 0.5 },
  normal: { label: "通常の調教", load: 1.0 },
  hard: { label: "強めの調教", load: 1.5 },
  trial: { label: "適性を試す調教", load: 1.0 },
  racePrep: { label: "レースに向けた仕上げ", load: 1.1 },
  injuryCare: { label: "故障の治療", load: 0 },
  postRace: { label: "レース後の手入れ", load: 0 },
} as const;
export type PlanId = keyof typeof PLAN_DEFS;

const GROWTH_QUALITY: Record<PlanId, number> = {
  farm: 0.18,
  breaking: 0.38,
  rest: 0,
  light: 0.35,
  normal: 0.62,
  hard: 0.86,
  trial: 0.58,
  racePrep: 0.6,
  injuryCare: 0,
  postRace: 0.2,
};

const POLICY_FOCUS: Record<PolicyId, AbilityKey[]> = {
  growth: [],
  earlyDebut: ["speed", "acceleration"],
  health: [],
  strengthen: [...ABILITY_KEYS],
  recovery: [],
  distanceSurvey: ["stamina"],
  surfaceSurvey: ["power"],
  raceExperience: ["raceSense"],
  longTerm: ["stamina", "speed"],
};

export interface WeekPlan {
  plan: PlanId;
  /** 適性を試す調教の内容 */
  trial: "long" | "dirt" | "turf" | null;
  /** 調教師の判断の理由 */
  reason: string;
  /** 馬主の方針と違う内容になったか（調教師の判断で変えた） */
  adjusted: boolean;
  /** 馬主が方針を優先させたため、調教師の懸念を押し切ったか */
  overridden: boolean;
}

/** 方針から、本来やりたい調教 */
function basePlan(h: RaceHorse, week: number, goalWeeksAway: number | null): { plan: PlanId; trial: WeekPlan["trial"] } {
  const p = h.policy.policy;
  const s = h.state;
  switch (p) {
    case "growth":
      return { plan: ageAt(h, week) === 2 && s.fitness > 60 ? "light" : "normal", trial: null };
    case "earlyDebut":
      return { plan: s.fitness < 60 && s.fatigue < 40 ? "hard" : "normal", trial: null };
    case "health":
      return { plan: "light", trial: null };
    case "strengthen":
      return { plan: "hard", trial: null };
    case "recovery":
      return { plan: "rest", trial: null };
    case "distanceSurvey":
      return { plan: "trial", trial: "long" };
    case "surfaceSurvey": {
      const dirtKnown = h.knowledge.entries.surface_dirt.evidence.length;
      const turfKnown = h.knowledge.entries.surface_turf.evidence.length;
      return { plan: "trial", trial: dirtKnown <= turfKnown ? "dirt" : "turf" };
    }
    case "raceExperience":
      return { plan: s.fitness < 70 ? "racePrep" : "normal", trial: null };
    case "longTerm":
      if (goalWeeksAway !== null && goalWeeksAway <= 6) return { plan: "racePrep", trial: null };
      return { plan: goalWeeksAway !== null && goalWeeksAway > 20 && s.fatigue > 30 ? "light" : "normal", trial: null };
  }
}

const HEAVIER: Record<PlanId, number> = {
  farm: 0, rest: 0, injuryCare: 0, postRace: 0, breaking: 1, light: 1, normal: 2, trial: 2, racePrep: 2, hard: 3,
};

/** 調教師が今週の調教を決める（馬主の方針＋馬の状態） */
export function proposePlan(h: RaceHorse, week: number, goalWeeksAway: number | null = null): WeekPlan {
  const age = ageAt(h, week);
  const s = h.state;
  if (s.injuryWeeks > 0) return { plan: "injuryCare", trial: null, reason: "故障の治療を最優先します", adjusted: false, overridden: false };
  if (h.racedWeek === week) return { plan: "postRace", trial: null, reason: "レースを走ったので手入れと様子見です", adjusted: false, overridden: false };
  if (age <= 0) return { plan: "farm", trial: null, reason: "牧場で放牧しながら成長を観察します", adjusted: false, overridden: false };
  if (age === 1) {
    const plan: PlanId = h.policy.policy === "recovery" || s.fatigue > 50 ? "rest" : "breaking";
    return { plan, trial: null, reason: "人や馬具に慣らしながら、体の使い方を見ていきます", adjusted: false, overridden: false };
  }
  const base = basePlan(h, week, goalWeeksAway);
  let safe: PlanId = base.plan;
  let reason = "";
  if (s.fatigue >= 70) {
    safe = "rest";
    reason = "疲れがたまっているので休ませたいと考えています";
  } else if (s.health < 40) {
    safe = HEAVIER[base.plan] >= 1 ? "light" : base.plan;
    reason = "体調面が心配なので軽めにとどめます";
  } else if (s.fatigue >= 50 && HEAVIER[base.plan] >= 2) {
    safe = "light";
    reason = "疲れが見えるので今週は軽めにします";
  } else if (s.condition <= -2 && HEAVIER[base.plan] >= 2) {
    safe = "light";
    reason = "調子が落ちているので負荷を下げます";
  }
  if (safe === base.plan) {
    return { plan: base.plan, trial: base.trial, reason: reason || "方針どおりに進めます", adjusted: false, overridden: false };
  }
  if (h.policy.mode === "insist" && s.fatigue < 85) {
    return { plan: base.plan, trial: base.trial, reason: `${reason}が、方針どおりに実施します`, adjusted: false, overridden: true };
  }
  return { plan: safe, trial: null, reason, adjusted: true, overridden: false };
}

export interface WeeklyReport {
  horseId: string;
  horseName: string;
  week: number;
  trainerId: string;
  plan: PlanId;
  planLabel: string;
  lines: string[];
  /** 調教時計（計測した場合） */
  workout: string | null;
  /** 判明したこと（情報解明の履歴） */
  discoveries: string[];
  alerts: string[];
}

/** 調教時計の表示（観測値から作るので、表示と推定は一致する） */
function workoutText(speedObs: number, accelObs: number, staminaObs: number | null, surface: "turf" | "dirt", long: boolean, rng: Rng): string {
  const place = surface === "dirt" ? "ダートコース" : long ? "ウッドチップ" : "坂路";
  const last1 = clamp(13.4 - 0.018 * accelObs - 0.006 * speedObs + gaussian(rng) * 0.05, 11.0, 14.5);
  const pace = clamp(15.1 - 0.024 * speedObs, 12.6, 15.5);
  if (long) {
    const fade = staminaObs === null ? 0.3 : clamp(0.9 - 0.012 * staminaObs, -0.2, 1.2);
    const f6 = pace * 6 + fade * 2;
    return `${place} 6F ${f6.toFixed(1)} - 3F ${(pace * 3 + fade).toFixed(1)} - 1F ${(last1 + fade * 0.3).toFixed(1)}`;
  }
  const f4 = pace * 4 + 0.6;
  return `${place} 4F ${f4.toFixed(1)} - 1F ${last1.toFixed(1)}`;
}

export const OBS_COMMENT: Record<AbilityKey, [string, string, string]> = {
  speed: ["脚の回転が軽く、素早い動きが見られる", "スピードは平均的に見える", "速い走りにはまだ物足りなさがある"],
  acceleration: ["加速時の反応が鋭い", "反応は普通", "エンジンのかかりがゆっくりしている"],
  stamina: ["運動後の回復が早い", "息の持ちは普通", "速いペースでは終盤に余裕がなくなる"],
  power: ["走りに力強さがある", "力強さは平均的", "馬体の力強さはまだこれから"],
  fightingSpirit: ["負けん気が強い", "気の強さは普通", "併せると気持ちが引いてしまう面がある"],
  raceSense: ["落ち着きがあり、指示に従いやすい", "指示への反応は普通", "周りに気を取られやすい"],
};

const FARM_COMMENT: Record<AbilityKey, [string, string, string]> = {
  speed: ["脚の運びが柔らかい", "歩様は素直", "まだ体の使い方がぎこちない"],
  acceleration: ["身のこなしが軽い", "動きは年相応", "反応はおっとりしている"],
  stamina: ["よく動いても息が上がりにくい", "体力は年相応", "疲れやすい様子がある"],
  power: ["馬体のバランスが良い", "体つきは年相応", "まだ線が細い"],
  fightingSpirit: ["仲間との駆けっこで負けず嫌いなところを見せる", "おとなしい", "群れの後ろにいることが多い"],
  raceSense: ["人に従順で落ち着いている", "人への反応は普通", "物音に敏感な様子がある"],
};

function level(v: number): 0 | 1 | 2 {
  return v >= 62 ? 0 : v >= 45 ? 1 : 2;
}

/** 観察する項目を選ぶ（年齢で観察できるものが変わる） */
function observationTargets(h: RaceHorse, week: number, rng: Rng, count: number): KnowledgeKey[] {
  const stage = ageStage(h, week);
  const pool: KnowledgeKey[] =
    stage <= 1 ? [...ABILITY_KEYS] : [...ABILITY_KEYS, "dist_sprint", "dist_mile", "dist_middle", "dist_long", "surface_turf", "surface_dirt"];
  const out: KnowledgeKey[] = [];
  for (let i = 0; i < count && pool.length; i++) {
    const k = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    out.push(k);
  }
  return out;
}

export interface WeekOutcome {
  horse: RaceHorse;
  report: WeeklyReport;
}

/**
 * 1頭の1週間を進める。乱数の消費順は一定（同じシードなら同じ結果）。
 * goalWeeksAway は目標レースまでの週数（なければ null）。
 */
export function runStableWeek(
  h0: RaceHorse,
  trainer: Trainer,
  week: number,
  rng: Rng,
  goalWeeksAway: number | null = null,
  cfg: GameConfig = DEFAULT_CONFIG,
): WeekOutcome {
  const plan = proposePlan(h0, week, goalWeeksAway);
  const def = PLAN_DEFS[plan.plan];
  const L = def.load;
  const age = ageAt(h0, week);
  const s = { ...h0.state };
  const lines: string[] = [];
  const alerts: string[] = [];
  let relationship = h0.relationship;

  lines.push(`${def.label}：${plan.reason}。`);

  /* ---- 状態の変化 ---- */
  const staminaRelief = 1.15 - h0.truth.abilities.stamina / 250;
  if (plan.plan === "injuryCare") {
    s.injuryWeeks = Math.max(0, s.injuryWeeks - 1);
    s.health = clamp(s.health + 4, 0, 100);
    s.fatigue = clamp(s.fatigue - 20, 0, 100);
    s.fitness = clamp(s.fitness - 4, 0, 100);
    lines.push(s.injuryWeeks > 0 ? `治療中です（あと${s.injuryWeeks}週ほど）。` : "故障が癒えました。少しずつ調教を再開します。");
  } else if (L === 0) {
    s.fatigue = clamp(s.fatigue - (plan.plan === "postRace" ? 14 : 28), 0, 100);
    s.health = clamp(s.health + 5, 0, 100);
    s.fitness = clamp(s.fitness - (plan.plan === "postRace" ? 1 : 5), 0, 100);
  } else {
    // 負荷で疲れ、疲れているほど回復も進む（通常の調教を続けると15前後で落ち着く）
    s.fatigue = clamp(s.fatigue + L * 12 * staminaRelief - 10 - 0.12 * s.fatigue, 0, 100);
    s.fitness = clamp(s.fitness + (L * 7 - 1) * (1 - s.fitness / 125), 0, age < 2 ? 40 : 100);
    if (s.fatigue > 60) s.health = clamp(s.health - (s.fatigue - 60) * 0.12 * Math.max(L, 0.5), 0, 100);
    else s.health = clamp(s.health + (L <= 0.5 ? 2 : 0.6), 0, 100);
    s.experience = Math.round((s.experience + L * 0.1) * 100) / 100;
  }
  // 調子
  const r = rng();
  let dc = 0;
  if (L === 0) dc = r < 0.4 ? 1 : 0;
  else if (plan.plan === "hard" || s.fatigue > 65) dc = r < 0.32 ? -1 : r > 0.9 ? 1 : 0;
  else dc = r < 0.15 ? -1 : r > 0.75 && s.fatigue < 45 ? 1 : 0;
  if (Math.abs(s.condition) === 2 && rng() < 0.25) dc = -Math.sign(s.condition);
  else rng();
  s.condition = clamp(s.condition + dc, -2, 2);
  // 故障
  const injuryChance =
    L === 0
      ? 0
      : (0.002 + Math.max(0, s.fatigue - 65) * 0.0035 * Math.max(L, 0.3) + Math.max(0, 45 - s.health) * 0.003) *
        (plan.overridden ? 1.3 : 1);
  const injured = rng() < injuryChance;
  const injuryLen = randInt(rng, 4, 10);
  if (injured) {
    s.injuryWeeks = injuryLen;
    s.health = clamp(s.health - 15, 0, 100);
    s.fitness = clamp(s.fitness - 25, 0, 100);
    s.condition = clamp(s.condition - 1, -2, 2);
    alerts.push(`調教中に脚元を痛めました。${injuryLen}週ほどの治療が必要です。`);
  }

  /* ---- 能力の成長（真の値） ---- */
  const eff = trainingEfficiency(trainer);
  const focus = POLICY_FOCUS[h0.policy.policy];
  const quality: Partial<Record<AbilityKey, number>> = {};
  for (const k of ABILITY_KEYS) {
    const f = focus.length === 0 ? 1 : focus.includes(k) ? 1.15 : 0.88;
    quality[k] = GROWTH_QUALITY[plan.plan] * eff * f * (s.fatigue > 70 ? 0.7 : 1);
  }
  const truth = applyWeeklyGrowth(h0.truth, week, weeksSinceBirth(h0, week), { quality });

  /* ---- 観察と報告（推定の更新） ---- */
  const src = `trainer:${trainer.id}`;
  const label = `${trainer.name}調教師の報告`;
  const stage = ageStage(h0, week);
  const kind: EvidenceKind = stage <= 1 ? "farmObservation" : "trainerObservation";
  const obsCount = relationship < 30 ? 1 : stage <= 1 ? 1 + (rng() < 0.5 ? 1 : 0) : 2;
  const items: { key: KnowledgeKey; evidence: Evidence }[] = [];
  const obsLines: string[] = [];
  const targets = plan.plan === "injuryCare" ? [] : observationTargets(h0, week, rng, obsCount);
  for (const key of targets) {
    const ev = makeEvidence(
      { key, kind, src, trueValue: truthValue(truth, key, cfg), skillScale: skillScale(trainer, key) },
      truth.biasSeed,
      week,
      rng,
      cfg,
    );
    items.push({ key, evidence: ev });
    if (isAbilityKey(key)) obsLines.push((stage <= 1 ? FARM_COMMENT : OBS_COMMENT)[key][level(ev.v)]);
    else obsLines.push(aptitudeImpression(key, ev.v));
  }

  // 調教時計（2歳以上で、負荷のある調教をしたとき）
  let workout: string | null = null;
  if (stage >= 2 && L >= 1 && !injured) {
    const surface = plan.trial === "dirt" ? "dirt" : "turf";
    const long = plan.trial === "long";
    const mk = (key: KnowledgeKey, infoScale = 1) =>
      makeEvidence(
        { key, kind: "workout", src: `${src}:work`, trueValue: truthValue(truth, key, cfg), skillScale: skillScale(trainer, key), infoScale, ref: "調教時計" },
        truth.biasSeed,
        week,
        rng,
        cfg,
      );
    const sp = mk("speed");
    const ac = mk("acceleration", 1.2);
    items.push({ key: "speed", evidence: sp }, { key: "acceleration", evidence: ac });
    let stObs: number | null = null;
    if (long) {
      const st = mk("stamina", 1.3);
      stObs = st.v;
      items.push({ key: "stamina", evidence: st });
      // 長めの調教で距離への対応を見る（実戦ほど確かではないので観察扱い）
      for (const band of ["dist_middle", "dist_long"] as const) {
        items.push({
          key: band,
          evidence: makeEvidence(
            { key: band, kind: "trainerObservation", src: `${src}:long`, trueValue: truthValue(truth, band, cfg), skillScale: skillScale(trainer, band), infoScale: 1.2 },
            truth.biasSeed,
            week,
            rng,
            cfg,
          ),
        });
      }
    }
    if (plan.trial === "dirt" || plan.trial === "turf") {
      const key = plan.trial === "dirt" ? "surface_dirt" : "surface_turf";
      items.push({ key, evidence: mk(key, 1.3) });
      obsLines.push(`${plan.trial === "dirt" ? "ダート" : "芝"}での走りを確かめました`);
    }
    workout = workoutText(sp.v, ac.v, stObs, surface, long, rng);
  }

  let knowledge = addEvidence(h0.knowledge, items, week, label, cfg);

  // 個性の兆候（日常の様子・調教で見えるもの）
  if (plan.plan !== "injuryCare") {
    const tScale = skillScale(trainer, "raceSense");
    for (const t of TRAIT_IDS) {
      if (TRAIT_DEFS[t].seenIn !== "both") continue;
      const hasTrait = truth.traits.includes(t);
      const p = hasTrait ? (stage <= 1 ? 0.1 : 0.2) / tScale : 0.004 * tScale;
      const seen = rng() < p;
      if (seen) {
        knowledge = recordTraitSign(knowledge, t, true, week, label, cfg);
        obsLines.push(traitSignText(t));
      } else if (rng() < 0.5) {
        // 兆候が出てもおかしくない場面で出なかった（兆候ありの見立てを見直す材料）
        knowledge = recordTraitSign(knowledge, t, false, week, label, cfg);
      }
    }
  }
  // events は上限で切り詰められるので、件数ではなく「前からあったか」で新しい分を数える
  const prevEvents = new Set(h0.knowledge.events);
  const newEvents = knowledge.events.filter((e) => !prevEvents.has(e));

  if (obsLines.length) lines.push(`観察：${[...new Set(obsLines)].join("。")}。`);
  if (plan.adjusted) lines.push("※方針とは違う内容にしました（馬の状態を優先）。");
  if (plan.overridden) {
    relationship = clamp(relationship - 2, 0, 100);
    alerts.push("調教師は無理をさせることに懸念を示しています。");
  } else relationship = clamp(relationship + 0.5, 0, 85);
  if (s.fatigue >= 70 && !injured) alerts.push("疲労がかなりたまっています。");
  if (s.health < 40) alerts.push("健康状態に注意が必要です。");

  // 出走の提案
  const proposal = raceProposal({ ...h0, state: s, knowledge }, week);
  if (proposal) lines.push(proposal);

  const report: WeeklyReport = {
    horseId: h0.id,
    horseName: h0.name,
    week,
    trainerId: trainer.id,
    plan: plan.plan,
    planLabel: def.label,
    lines,
    workout,
    discoveries: newEvents.map((e) => e.text),
    alerts,
  };

  const logEntries: HorseLogEntry[] = [
    { week, kind: "report", text: [...lines, ...alerts].join(" ") },
    ...(workout ? [{ week, kind: "training" as const, text: `${def.label}`, detail: workout }] : []),
    ...newEvents.map((e) => ({ week, kind: "knowledge" as const, text: e.text })),
  ];

  const horse: RaceHorse = {
    ...h0,
    truth,
    state: { ...s, fatigue: Math.round(s.fatigue), health: Math.round(s.health), fitness: Math.round(s.fitness) },
    knowledge,
    relationship: Math.round(relationship * 10) / 10,
    log: [...h0.log, ...logEntries].slice(-260),
  };
  return { horse, report };
}

function aptitudeImpression(key: KnowledgeKey, v: number): string {
  const name = KNOWLEDGE_LABELS[key].replace(/（.*）/, "");
  if (v >= 70) return `${name}は合いそうな印象`;
  if (v >= 45) return `${name}もこなせそう`;
  return `${name}はあまり向いていないかもしれない`;
}

function traitSignText(t: TraitId): string {
  switch (t) {
    case "calm":
      return "調教で折り合いがつき、無駄な力みがない";
    case "keen":
      return "調教で行きたがる素振りを見せた";
    case "closerKick":
      return "終いの伸びに目立つものがあった";
    case "inconsistent":
      return "日によって動きの良し悪しに差がある";
    default:
      return `${TRAIT_DEFS[t].label}ような様子があった`;
  }
}

/** 調教師からの出走の提案（推定だけを根拠にする。真の値は見ない） */
export function raceProposal(h: RaceHorse, week: number): string | null {
  const s = h.state;
  if (ageAt(h, week) < 2 || s.injuryWeeks > 0) return null;
  if (s.fitness < 65 || s.fatigue >= 45) return null;
  if (h.record.lastRaceWeek !== null && week - h.record.lastRaceWeek < 3) return null;
  // 推定で一番良さそうな距離帯（未検証なら印象で）
  let best: { label: string; v: number } | null = null;
  for (const b of DISTANCE_BANDS) {
    const view = viewEntry(b.key, h.knowledge.entries[b.key], week);
    const v = h.knowledge.entries[b.key].estimatedValue;
    if (v === null) continue;
    if (!best || v > best.v) best = { label: `${b.label}${view.unverified ? "（未検証）" : ""}`, v };
  }
  const where = best ? `${best.label}あたり` : "まずは手頃な距離";
  return h.record.races === 0
    ? `提案：仕上がってきました。${where}でデビューを考えてもよい頃です。`
    : `提案：出走できる状態です。次は${where}を考えています。`;
}
