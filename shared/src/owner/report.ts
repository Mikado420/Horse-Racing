// レース後の報告（記録・観察・推定・提案）と、調教師のレース後コメント。
//
// 原則
//  ・使うのはレース記録（着順・タイム・ラップ・通過順・上がり3F・走りの様子）だけ。真の能力値・個性・
//    内部のエネルギー残量は見ない
//  ・情報を4種類に分ける
//      記録   … 定義どおりに取れる値（着順・タイム・ラップ・上がり3F・通過順）
//      観察   … 記録から確かめられる出来事（序盤は後方・残り400mから2頭かわした など）
//      推定   … 観察を根拠にした「可能性」。根拠となる観察がそろわなければ出さない
//      提案   … 次走で試せる選択肢。改善を保証しない
//  ・原因が特定できないときは、そのまま「特定できない」と言う
//  ・調教師の言い回しは複数から選ぶが、選ぶのはレースIDで決まり、どの文も同じ意味になる
//    （何を言うかは記録だけで決まり、言い回しで意味が変わらない）
import type { RunningStyle } from "../types";
import { STYLE_LABELS } from "../types";
import { formatRaceTime, marginLabel } from "../race";
import type { OwnerRaceRecord } from "./analysis";
import { hash32 } from "./knowledge";
import { PACE_LABELS, SPURT_LABELS } from "./sim";

/* ---------------- 判定の基準（調整はここで行う） ---------------- */

/**
 * レース分析の判定基準。
 *
 * ペース：「前半の200mあたり平均 − 後半の200mあたり平均」（スタート直後の200mは発馬の加速を含むので除く）を、
 * 同じ距離帯のレースと比べて判断する。基準は、このゲームのレース1,292回（4年分の番組・CPU馬8頭立て）を計算して決めた。
 * 距離帯ごとに下位15%を「前半が速い流れ」、上位15%を「前半がゆったりした流れ」とする。
 * （着差の調整 v2.1、レース計算の再設計 v3 で道中の運び方が変わったため、そのたびに同じ方法で計算し直した。docs/margins・docs/race-sim を参照）
 *   v3：短距離（〜1400m）  15%点 0.33秒・中央値 0.63秒・85%点 0.90秒（n=487）
 *       マイル（〜1800m）  15%点 0.12秒・中央値 0.46秒・85%点 0.75秒（n=353）
 *       中距離（〜2400m）  15%点 0.00秒・中央値 0.35秒・85%点 0.70秒（n=324）
 *       長距離（2500m〜）  15%点 -0.03秒・中央値 0.29秒・85%点 0.64秒（n=128）
 *   （v2.1 では順に 0.15/0.45・0.18/0.39・0.17/0.44・0.13/0.63）
 */
export const ANALYSIS_RULES = {
  pace: [
    { maxDistance: 1400, fastBelow: 0.33, slowAbove: 0.9 },
    { maxDistance: 1800, fastBelow: 0.12, slowAbove: 0.75 },
    { maxDistance: 2400, fastBelow: 0, slowAbove: 0.7 },
    { maxDistance: Infinity, fastBelow: -0.03, slowAbove: 0.64 },
  ],
  /** 出遅れ（秒）。映像で分かる程度の遅れ。全出走馬のうち遅い方の約1割に当たる
   * （v2.1 でスタートのばらつきを半分にしたため 0.35 → 0.175。該当する割合は変更前 9.4%・変更後 8.4%） */
  slowStartSec: 0.175,
  /** 前が壁になった（秒の合計）。一瞬ではなく、はっきり分かる程度 */
  blockedSec: 3,
  /** 外を回った（m）。はっきり外を回ったと分かる程度 */
  wideMeters: 8,
  /** 行きたがった（秒）。騎手と喧嘩しているのが分かる程度 */
  keenSec: 4,
  /** 残り400mからゴールまでに動いた頭数 */
  lateMove: 2,
  /** 着差（馬身）がこれ以下なら「惜しい」 */
  closeMargin: 1.0,
  /** 2・3着で、勝ち馬との差がこれ以下なら「上位争いができた」と言える */
  contendMargin: 2.0,
  /** 過去の成績と比べるときの、着順の割合（着順÷頭数）の差 */
  betterFinish: 0.25,
  maxObservations: 3,
  maxAssessments: 3,
  maxSuggestions: 3,
} as const;

/* ---------------- 型 ---------------- */

export type InfoClass = "record" | "observation" | "assessment" | "suggestion";

export const INFO_CLASS_LABELS: Record<InfoClass, string> = {
  record: "記録",
  observation: "観察",
  assessment: "推定",
  suggestion: "提案",
};

export interface LapSegment {
  from: number;
  to: number;
  sec: number;
}

/** 記録（定義どおりに取れる値）。すべてゲーム内のシミュレーションで計測したもの */
export interface RaceFacts {
  raceId: string;
  position: number;
  fieldSize: number;
  won: boolean;
  timeMs: number;
  winnerTimeMs: number;
  /** 勝ち馬との差（馬身）。勝った場合は2着との差 */
  margin: number;
  distance: number;
  /**
   * レースラップ：各区間を最初に通過した馬の時刻の差（スタートから200mごと。
   * 距離が200mの倍数でないときは、最後の区間が100mになる）
   */
  laps: LapSegment[];
  /** ラップの合計が勝ち時計と許容誤差内で一致するか */
  lapsConsistent: boolean;
  /** 前半・後半の200mあたりの平均（秒。スタート直後の200mを除く） */
  firstHalfPer200: number | null;
  secondHalfPer200: number | null;
  pace: "fast" | "even" | "slow" | null;
  /** 上がり3F（最後の600mにかかった時間）と、出走馬の中での順位（速い順） */
  last3F: number | null;
  last3FRank: number | null;
  /** 地点ごとの通過順（通過した順に並べる） */
  passing: { label: string; remain: number; pos: number }[];
  earlyPos: number | null;
  /** 序盤の位置から見た実際の位置取り */
  earlyGroup: RunningStyle | null;
  posAt400: number | null;
  /** 残り400mからゴールまでの順位の変化（+ は順位を上げた） */
  lateChange: number | null;
}

export interface ReportItem {
  id: string;
  cls: InfoClass;
  text: string;
  /** 根拠（記録の項目名・観察のID・比較した過去のレースID） */
  basis: string[];
}

export interface RaceReport {
  facts: RaceFacts;
  observations: ReportItem[];
  assessments: ReportItem[];
  suggestions: ReportItem[];
  /** 負けたのに、根拠のある推定が1つもない */
  undetermined: boolean;
}

/** ラップの合計と勝ち時計の許容誤差（秒）。各区間を0.01秒単位に丸めているため */
export const LAP_TOLERANCE_SEC = 0.06;

/* ---------------- 記録 ---------------- */

/** 先頭のラップ（スタートから200mごと）に、200mの倍数でない距離の最後の区間を補う */
export function raceLaps(r: Pick<OwnerRaceRecord, "leaderLaps" | "course" | "field">): LapSegment[] {
  const D = r.course.distance;
  const winner = Math.min(...r.field.map((f) => f.timeMs)) / 1000;
  const laps: LapSegment[] = r.leaderLaps.map((sec, i) => ({ from: i * 200, to: (i + 1) * 200, sec }));
  const covered = laps.length * 200;
  if (covered < D) {
    const sum = laps.reduce((a, l) => a + l.sec, 0);
    laps.push({ from: covered, to: D, sec: Math.round((winner - sum) * 100) / 100 });
  }
  return laps;
}

/** 前半・後半の200mあたりの平均（スタート直後の200mは発馬の加速を含むので除く） */
function halves(laps: LapSegment[], D: number): { first: number | null; second: number | null } {
  let t1 = 0, d1 = 0, t2 = 0, d2 = 0;
  for (const l of laps) {
    if (l.from === 0) continue;
    const len = l.to - l.from;
    if (l.to <= D / 2) {
      t1 += l.sec;
      d1 += len;
    } else {
      t2 += l.sec;
      d2 += len;
    }
  }
  return { first: d1 ? (t1 / d1) * 200 : null, second: d2 ? (t2 / d2) * 200 : null };
}

/** 同じ距離帯のレースと比べたペースの判断 */
export function paceOf(diff: number | null, D: number): RaceFacts["pace"] {
  if (diff === null) return null;
  const b = ANALYSIS_RULES.pace.find((x) => D <= x.maxDistance)!;
  return diff <= b.fastBelow ? "fast" : diff >= b.slowAbove ? "slow" : "even";
}

export function raceFacts(r: OwnerRaceRecord): RaceFacts {
  const t = r.telemetry;
  const D = r.course.distance;
  const winnerTimeMs = Math.min(...r.field.map((f) => f.timeMs));
  const laps = raceLaps(r);
  const sum = laps.reduce((a, l) => a + l.sec, 0);
  const { first, second } = halves(laps, D);
  const diff = first !== null && second !== null ? first - second : null;
  const pace = paceOf(diff, D);
  const mine = r.field.find((f) => f.isMine);
  const last3F = mine ? mine.last600 : t.last600 || null;
  const last3FRank = last3F ? [...r.field].sort((a, b) => a.last600 - b.last600).findIndex((f) => f.isMine) + 1 || null : null;
  // 通過した順（残り距離の大きい順）に並べる。短い距離では「残り800m」が「序盤（400m地点）」より先に来る
  const passing = t.positions
    .map((p) => ({ label: p.remain === D - 400 ? "序盤（400m地点）" : p.label, remain: p.remain, pos: p.pos }))
    .sort((a, b) => b.remain - a.remain);
  const posAt400 = passing.find((p) => p.remain === 400)?.pos ?? null;
  // 序盤の位置は、実際の位置取り（styleShown）と同じ「スタートから400m地点」の通過順
  const early = passing.find((p) => p.remain === D - 400) ?? null;
  return {
    raceId: r.raceId,
    position: r.position,
    fieldSize: r.fieldSize,
    won: r.position === 1,
    timeMs: r.timeMs,
    winnerTimeMs,
    margin: Math.abs(r.marginToWinner),
    distance: D,
    laps,
    lapsConsistent: laps.length > 0 && Math.abs(sum - winnerTimeMs / 1000) <= LAP_TOLERANCE_SEC,
    firstHalfPer200: first === null ? null : Math.round(first * 100) / 100,
    secondHalfPer200: second === null ? null : Math.round(second * 100) / 100,
    pace,
    last3F: last3F ?? null,
    last3FRank,
    passing,
    earlyPos: early?.pos ?? null,
    earlyGroup: early ? t.styleShown : null,
    posAt400,
    lateChange: posAt400 === null ? null : posAt400 - r.position,
  };
}

/* ---------------- 観察 ---------------- */

const groupLabel = (g: RunningStyle) => ({ front: "先頭", stalker: "前のほう", closer: "中団", deep: "後方" })[g];

function observe(r: OwnerRaceRecord, f: RaceFacts): ReportItem[] {
  const t = r.telemetry;
  const R = ANALYSIS_RULES;
  const out: ReportItem[] = [];
  const add = (id: string, text: string, basis: string[]) => out.push({ id, cls: "observation", text, basis });
  if (t.startDelay >= R.slowStartSec) add("start_slow", "スタートでやや後手を踏みました", ["スタート"]);
  if (f.earlyPos !== null && f.earlyGroup) {
    add("position_early", `序盤は${f.earlyPos}番手（${groupLabel(f.earlyGroup)}）で運びました`, ["通過順"]);
    if (f.earlyGroup !== r.tactics.style) {
      add("style_vs_plan", `作戦は${STYLE_LABELS[r.tactics.style]}でしたが、実際には${STYLE_LABELS[f.earlyGroup]}の位置になりました`, ["通過順", "作戦"]);
    }
  }
  if (f.pace === "fast") add("pace_fast", "前半から速い流れでした", ["ラップ"]);
  if (f.pace === "slow") add("pace_slow", "前半はゆったりした流れでした", ["ラップ"]);
  if (t.keenSec >= R.keenSec) add("keen", "道中、行きたがる素振りを見せました", ["走りの様子"]);
  if (t.blockedSec >= R.blockedSec) add("blocked", "道中、前が壁になって動きにくい場面がありました", ["走りの様子"]);
  if (t.extraMeters >= R.wideMeters) add("wide", "コーナーで外を回る形になりました", ["走りの様子"]);
  if (t.spurtRemain !== null) {
    if (t.spurtRemain > r.course.straightLength + 60) add("move_early", "直線に入る前から動いていきました", ["走りの様子"]);
    else if (t.spurtRemain <= r.course.straightLength) add("move_straight", "直線に向いてから追い出しました", ["走りの様子"]);
  }
  if (f.lateChange !== null && f.lateChange >= R.lateMove) add("late_gain", `残り400mから${f.lateChange}頭をかわしました`, ["通過順"]);
  if (f.lateChange !== null && f.lateChange <= -R.lateMove) add("late_loss", `残り400mから${-f.lateChange}頭に先を越されました`, ["通過順"]);
  if (f.last3FRank !== null) {
    if (f.last3FRank === 1) add("last3f_top", "上がり3Fはメンバー中でいちばん速いタイムでした", ["上がり3F"]);
    else if (f.last3FRank <= 3) add("last3f_good", `上がり3Fはメンバー中${f.last3FRank}番目の速さでした`, ["上がり3F"]);
    else if (f.last3FRank >= f.fieldSize - 1) add("last3f_slow", "上がり3Fはメンバーの中で遅いほうでした", ["上がり3F"]);
  }
  if (t.duel.occurred) {
    add(t.duel.gained ? "duel_won" : "duel_lost", t.duel.gained ? "ゴール前の競り合いで前に出ました" : "ゴール前で競り合いましたが、前に出ることはできませんでした", ["走りの様子"]);
  }
  return out;
}

/* ---------------- 推定・提案 ---------------- */

interface Rule {
  id: string;
  /** 根拠となる観察がそろっていれば、根拠のIDを返す。そろわなければ null */
  when: (c: Ctx) => string[] | null;
  text: (c: Ctx) => string;
  suggestion: string;
}

interface Ctx {
  r: OwnerRaceRecord;
  f: RaceFacts;
  obs: Set<string>;
  history: OwnerRaceRecord[];
}

const SUGGESTIONS: Record<string, { text: string; voice: string[] }> = {
  s_pace: {
    text: "ペースを「控えめ」にして、終盤の脚の残り方を比べる",
    voice: ["次はペースを控えめにして、終いの脚の残り方を比べてみたいですね", "次は道中を控えめに運んで、最後の伸びがどう変わるか見てみたいですね"],
  },
  s_forward: {
    text: "もう少し前の位置で運ぶ作戦も試し、どちらが合うか比べる",
    voice: ["次はもう少し前の位置で運んで、どちらが合うか確かめたいですね", "前目の位置で運ぶ形も試して、比べてみたいですね"],
  },
  s_retry: {
    text: "似た条件でもう一度走らせ、スムーズに運べたときの走りを確かめる",
    voice: ["似た条件で、スムーズに運べたときの走りをもう一度見てみたいですね", "同じような条件でもう一度使って、走りを確かめたいですね"],
  },
  s_settle: {
    text: "前の位置で運ぶ作戦（逃げ・先行）で、力みが出るかを比べる",
    voice: ["前の位置で運ぶ形にして、力みが出るかどうか見てみたいですね", "前で運ぶ作戦も試して、落ち着いて走れるか確かめたいですね"],
  },
  s_spurt: {
    text: "仕掛けを「標準」か「早め」にして比べる",
    voice: ["次は仕掛けを少し早めにして、比べてみたいですね", "仕掛けのタイミングを変えて、どうなるか見てみたいですね"],
  },
  s_shorter: {
    text: "距離を短くして、適性を確かめる",
    voice: ["次は距離を短くして、適性を確かめたいですね", "一度距離を詰めて、走りを比べてみたいですね"],
  },
  s_longer: {
    text: "距離を延ばして、適性を確かめる",
    voice: ["次は距離を延ばして、適性を確かめたいですね", "一度距離を延ばして、走りを比べてみたいですね"],
  },
  s_confirm: {
    text: "似た条件でもう一度走らせ、今回の走りが続くか確かめる",
    voice: ["似た条件でもう一度使って、今回の走りが続くか見てみたいですね", "同じような条件でもう一度使って、今回の内容を確かめたいですね"],
  },
  s_other: {
    text: "距離や作戦を一つずつ変えて、もう一度走りを確かめる",
    voice: ["距離か作戦を変えて、もう一度走りを確かめたいですね", "条件を一つ変えて、もう一度様子を見たいですね"],
  },
  s_keep: {
    text: "今回の作戦を基準に、距離やクラスを一つずつ変えて確かめる",
    voice: ["今回の形を基準に、次の条件を考えたいと思います", "今回の運び方を土台に、次の舞台を考えたいですね"],
  },
};

function pastComparable(c: Ctx, cmp: (d: number) => boolean): OwnerRaceRecord | null {
  const ratio = c.f.position / c.f.fieldSize;
  const better = c.history
    .filter((h) => cmp(h.course.distance) && h.position / h.fieldSize <= ratio - ANALYSIS_RULES.betterFinish)
    .sort((a, b) => a.position / a.fieldSize - b.position / b.fieldSize);
  return better[0] ?? null;
}

const RULES: Rule[] = [
  {
    id: "a_blocked",
    when: ({ f, obs }) => {
      if (f.won || !obs.has("blocked")) return null;
      const late = ["last3f_top", "last3f_good", "late_gain"].find((k) => obs.has(k));
      return late ? ["blocked", late] : null;
    },
    text: () => "最後は伸びていたので、前が壁になった場面が結果に響いた可能性があります",
    suggestion: "s_retry",
  },
  {
    id: "a_pace_tough",
    when: ({ f, obs }) => {
      if (f.won || !obs.has("pace_fast") || f.earlyPos === null || f.earlyPos > Math.ceil(f.fieldSize * 0.4)) return null;
      const late = ["late_loss", "last3f_slow"].find((k) => obs.has(k));
      return late ? ["pace_fast", "position_early", late] : null;
    },
    text: () => "前半の速い流れを前の位置で追いかけたぶん、最後に苦しくなった可能性があります",
    suggestion: "s_pace",
  },
  {
    id: "a_pace_slow_rear",
    when: ({ f, obs }) => {
      if (f.won || !obs.has("pace_slow") || f.earlyPos === null || f.earlyPos < Math.ceil(f.fieldSize * 0.6)) return null;
      const late = ["last3f_top", "last3f_good"].find((k) => obs.has(k));
      return late ? ["pace_slow", "position_early", late] : null;
    },
    text: () => "流れが落ち着いたぶん、後ろの位置からでは届きにくかった可能性があります",
    suggestion: "s_forward",
  },
  {
    id: "a_keen",
    when: ({ f, obs }) => {
      if (f.won || !obs.has("keen")) return null;
      const late = ["late_loss", "last3f_slow"].find((k) => obs.has(k));
      return late ? ["keen", late] : null;
    },
    text: () => "道中で力んだことが、終盤の伸びに影響した可能性もあります",
    suggestion: "s_settle",
  },
  {
    id: "a_spurt_late",
    when: ({ r, f, obs }) => {
      if (f.won || r.tactics.spurt !== "late" || f.margin > ANALYSIS_RULES.closeMargin) return null;
      const late = ["last3f_top", "last3f_good"].find((k) => obs.has(k));
      return late && f.last3FRank !== null && f.last3FRank <= 2 ? [late, "作戦"] : null;
    },
    text: ({ r }) => `仕掛けは「${SPURT_LABELS[r.tactics.spurt]}」で、最後はよく伸びていたので、仕掛けのタイミングには見直す余地がありそうです`,
    suggestion: "s_spurt",
  },
  {
    id: "a_wide",
    when: ({ f, obs }) => (!f.won && obs.has("wide") && f.margin <= 1.5 ? ["wide", "着差"] : null),
    text: () => "着差が小さかったので、外を回ったぶんが着差につながった可能性があります",
    suggestion: "s_retry",
  },
  {
    id: "a_dist_long",
    when: (c) => {
      if (c.f.won) return null;
      const late = ["late_loss", "last3f_slow"].find((k) => c.obs.has(k));
      const past = pastComparable(c, (d) => d <= c.f.distance - 200);
      return late && past ? [late, `history:${past.raceId}`] : null;
    },
    text: (c) => {
      const past = pastComparable(c, (d) => d <= c.f.distance - 200)!;
      return `${past.course.distance}mでは${past.position}着だったことを考えると、今回の${c.f.distance}mは少し長かった可能性があります`;
    },
    suggestion: "s_shorter",
  },
  {
    id: "a_dist_short",
    when: (c) => {
      if (c.f.won || c.f.earlyPos === null || c.f.earlyPos < Math.ceil(c.f.fieldSize * 0.6)) return null;
      const late = ["last3f_top", "last3f_good"].find((k) => c.obs.has(k));
      const past = pastComparable(c, (d) => d >= c.f.distance + 200);
      return late && past ? ["position_early", late, `history:${past.raceId}`] : null;
    },
    text: (c) => {
      const past = pastComparable(c, (d) => d >= c.f.distance + 200)!;
      return `${past.course.distance}mでは${past.position}着だったので、今回の${c.f.distance}mでは追走に忙しかった可能性があります`;
    },
    suggestion: "s_longer",
  },
];

/**
 * レース記録から報告を作る。history は同じ馬の過去のレース（このレースより前のものだけを使う）。
 * 真の値は使わないので、同じ記録からは必ず同じ報告ができる。
 */
export function buildRaceReport(r: OwnerRaceRecord, history: readonly OwnerRaceRecord[] = []): RaceReport {
  const f = raceFacts(r);
  const observations = observe(r, f);
  const obs = new Set(observations.map((o) => o.id));
  const past = history.filter((h) => h.horseId === r.horseId && h.raceId !== r.raceId && h.week < r.week);
  const ctx: Ctx = { r, f, obs, history: past };

  const assessments: ReportItem[] = [];
  const suggestionIds: string[] = [];
  for (const rule of RULES) {
    const basis = rule.when(ctx);
    if (!basis) continue;
    assessments.push({ id: rule.id, cls: "assessment", text: rule.text(ctx), basis });
    if (!suggestionIds.includes(rule.suggestion)) suggestionIds.push(rule.suggestion);
  }
  const lostBadly = !f.won && f.position > 3;
  const undetermined = lostBadly && assessments.length === 0;
  if (undetermined) {
    assessments.push({ id: "u_unknown", cls: "assessment", text: "今回の結果だけでは、明確な原因を特定できません", basis: ["着順"] });
    suggestionIds.push("s_other");
  }
  if (f.won) suggestionIds.push("s_keep");
  else if (!lostBadly && suggestionIds.length === 0) suggestionIds.push("s_confirm");

  const suggestions: ReportItem[] = suggestionIds.slice(0, ANALYSIS_RULES.maxSuggestions).map((id) => ({
    id,
    cls: "suggestion",
    text: SUGGESTIONS[id].text,
    basis: assessments.filter((a) => RULES.find((x) => x.id === a.id)?.suggestion === id || (id === "s_other" && a.id === "u_unknown")).map((a) => a.id),
  }));

  return {
    facts: f,
    observations,
    assessments: assessments.slice(0, ANALYSIS_RULES.maxAssessments),
    suggestions,
    undetermined,
  };
}

/** 総評に出す主な観察（重要なものから最大3つ） */
const OBS_PRIORITY = ["blocked", "keen", "start_slow", "wide", "late_gain", "late_loss", "last3f_top", "pace_fast", "pace_slow", "style_vs_plan", "duel_won", "duel_lost", "last3f_good", "last3f_slow", "move_early", "move_straight", "position_early"];
export function keyObservations(rep: RaceReport, max: number = ANALYSIS_RULES.maxObservations): ReportItem[] {
  return [...rep.observations].sort((a, b) => OBS_PRIORITY.indexOf(a.id) - OBS_PRIORITY.indexOf(b.id)).slice(0, max);
}

/* ---------------- 調教師のレース後コメント ---------------- */

/** 言い回しの候補。同じキーの文はすべて同じ意味 */
const VOICE: Record<string, string[]> = {
  open_win: ["よく頑張ってくれました", "しっかり勝ち切ってくれました"],
  open_place: ["上位争いができたのは収穫です", "上位に食い込めたのは収穫です"],
  start_slow: ["スタートで少し後手を踏みました", "出だしで少し遅れました"],
  keen: ["道中で行きたがる素振りがありました", "道中は少し力んで走っていました"],
  blocked: ["道中、前が壁になる場面がありました", "道中、前が詰まって動きにくいところがありました"],
  wide: ["コーナーで外を回る形になりました", "外を回らされる形になりました"],
  late_gain: ["最後はよく差を詰めてくれました", "直線ではしっかり前との差を詰めました"],
  late_loss: ["最後は伸び切れませんでした", "直線では伸びを欠きました"],
  last3f_top: ["終いの脚はメンバーでいちばんでした", "上がりはメンバー最速でした"],
  pace_fast: ["前半から速い流れになりました", "流れは前半から速くなりました"],
  pace_slow: ["前半はゆったりした流れでした", "流れは前半落ち着いていました"],
  style_vs_plan: ["思っていた位置とは違う形になりました", "作戦どおりの位置は取れませんでした"],
  duel_won: ["競り合いでよく前に出てくれました", "並ばれてからもよく踏ん張りました"],
  duel_lost: ["競り合いで前に出ることはできませんでした", "並んでからは前に出られませんでした"],
  u_unknown: ["今回の結果だけでは、明確な原因を特定できません", "今回の記録だけでは、負けた理由ははっきりしません"],
};

/** コメントに入れる観察の優先順（調教師が触れる順） */
const COMMENT_OBS = ["blocked", "keen", "start_slow", "wide", "late_gain", "late_loss", "last3f_top", "duel_won", "duel_lost", "pace_fast", "pace_slow", "style_vs_plan"];

export interface CommentPart {
  /** 報告のどの項目を述べた文か（"open" は着順） */
  ref: string;
  text: string;
}

function variant(list: readonly string[], seed: string): string {
  return list[hash32(seed) % list.length];
}

/**
 * 報告から調教師のコメントを組み立てる。述べる内容は報告の項目だけで、言い回しは variantSeed（通常はレースID）で選ぶ。
 */
export function composeTrainerComment(rep: RaceReport, trainerName: string, variantSeed: string = rep.facts.raceId): { text: string; parts: CommentPart[] } {
  const f = rep.facts;
  const parts: CommentPart[] = [];
  const say = (ref: string, list: readonly string[]) => parts.push({ ref, text: variant(list, `${variantSeed}|${ref}`) });

  if (f.won) say("open", VOICE.open_win);
  else if (f.position <= 3 && f.margin <= ANALYSIS_RULES.contendMargin) say("open", VOICE.open_place);
  else {
    const m = marginLabel(f.margin);
    parts.push({ ref: "open", text: `${m.endsWith("差") ? m : `${m}差`}の${f.position}着でした` });
  }
  const obsIds = new Set(rep.observations.map((o) => o.id));
  const mentioned = COMMENT_OBS.filter((id) => obsIds.has(id) && VOICE[id]).slice(0, 2);
  for (const id of mentioned) say(id, VOICE[id]);
  for (const a of rep.assessments.slice(0, 2)) {
    if (a.id === "u_unknown") say(a.id, VOICE.u_unknown);
    else parts.push({ ref: a.id, text: a.text });
  }
  const s = rep.suggestions[0];
  if (s) say(s.id, SUGGESTIONS[s.id].voice);
  return { text: `${trainerName}調教師「${parts.map((p) => p.text).join("。")}。」`, parts };
}

/** レース記録から、そのまま調教師のコメント文を作る */
export function trainerRaceReview(r: OwnerRaceRecord, trainerName: string, history: readonly OwnerRaceRecord[] = []): string {
  return composeTrainerComment(buildRaceReport(r, history), trainerName).text;
}

/* ---------------- 整合性の検証 ---------------- */

/** 報告・コメントに使ってはいけない表現（断定・内部値・記録にない出来事） */
export const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /必ず/,
  /間違いなく/,
  /確実に/,
  /敗因は/,
  /が敗因/,
  /スタミナ切れ/,
  /スタミナが(切|尽)/,
  /エネルギー/,
  /脚が上がっ/,
  /m\/秒/,
  /故障/,
  /落馬/,
  /斜行/,
  /進路妨害/,
  /直線で前が詰/,
  /無理をさせた/,
];

/**
 * 報告とコメントが記録と矛盾しないかを調べ、問題の一覧を返す（空なら問題なし）。
 * テストと開発用。プレイヤーの画面では使わない。
 */
export function checkReport(r: OwnerRaceRecord, rep: RaceReport, comment?: { text: string; parts: CommentPart[] }): string[] {
  const problems: string[] = [];
  const obsIds = new Set(rep.observations.map((o) => o.id));
  const known = new Set([...obsIds, "通過順", "作戦", "ラップ", "上がり3F", "走りの様子", "スタート", "着順", "着差"]);
  for (const a of rep.assessments) {
    for (const b of a.basis) {
      if (b.startsWith("history:")) continue;
      if (!known.has(b)) problems.push(`推定 ${a.id} の根拠 ${b} が報告にない`);
    }
  }
  if (rep.facts.won && rep.assessments.length > 0) problems.push("勝ったレースで敗因の推定を出している");
  if (rep.facts.position !== r.position) problems.push("着順が記録と違う");
  const goal = rep.facts.passing.find((p) => p.remain === 0);
  if (goal && goal.pos !== r.position) problems.push("ゴールの通過順が着順と違う");
  const texts = [...rep.observations, ...rep.assessments, ...rep.suggestions].map((i) => i.text);
  if (comment) texts.push(comment.text);
  for (const t of texts) for (const re of FORBIDDEN_PATTERNS) if (re.test(t)) problems.push(`禁止表現 ${re} を含む：${t}`);
  if (comment) {
    const refs = new Set(["open", ...obsIds, ...rep.assessments.map((a) => a.id), ...rep.suggestions.map((s) => s.id)]);
    for (const p of comment.parts) if (!refs.has(p.ref)) problems.push(`コメントが報告にない項目 ${p.ref} を述べている`);
    if (rep.facts.won && comment.parts.some((p) => p.ref === "u_unknown")) problems.push("勝ったのに原因不明と言っている");
  }
  return problems;
}

/* ---------------- 表示用の補助 ---------------- */

export function paceLabel(p: RaceFacts["pace"]): string {
  return p === "fast" ? "前半が速い流れ" : p === "slow" ? "前半がゆったりした流れ" : p === "even" ? "平均的な流れ" : "—";
}

export function lapText(f: RaceFacts): string {
  return f.laps.map((l) => l.sec.toFixed(1)).join(" - ");
}

export function resultLine(f: RaceFacts): string {
  return `${f.position}着／${f.fieldSize}頭　${formatRaceTime(f.timeMs)}　${f.won ? `${marginLabel(f.margin)}差で勝利` : `勝ち馬から${marginLabel(f.margin)}`}`;
}

export function tacticsLine(r: Pick<OwnerRaceRecord, "tactics">): string {
  return `${STYLE_LABELS[r.tactics.style]}・ペース${PACE_LABELS[r.tactics.pace]}・仕掛け${SPURT_LABELS[r.tactics.spurt]}`;
}

/* ---------------- レースでの個性の兆候（記録から決める） ---------------- */

/**
 * 1レースの記録から判断できる個性の兆候。真の個性は見ない。
 * レース486回の計算で、記録に表れる行動が個性の有無ではっきり違ったのは「行きたがる」だけだった
 * （個性あり 83.5%／なし 0.24%）。ほかの個性は1レースの記録では区別できないので、ここでは扱わない。
 */
export function raceTraitEvidence(r: OwnerRaceRecord): { trait: "keen"; opportunity: boolean; appeared: boolean }[] {
  // 逃げの作戦では騎手が抑えないので、行きたがるかどうかは表れない
  const opportunity = r.tactics.style !== "front";
  return [{ trait: "keen", opportunity, appeared: opportunity && r.telemetry.keenSec >= ANALYSIS_RULES.keenSec }];
}
