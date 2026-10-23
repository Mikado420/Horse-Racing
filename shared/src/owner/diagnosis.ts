// レース後の診断（分析システム再設計）。
// 手順：1. 記録を受け取る → 2. 記録から直接確かめられる事実を抜き出す → 3. 事実から見解を判定する
//       → 4. 根拠の数で強さを決める → 5. 根拠のある見解だけを残す → 6. 文面は別（comment.ts）で作る
//
// ここで使ってよいのは、プレイヤーが知り得る情報だけ：着順・タイム・着差・200mごとのラップ・通過順位・上がり3F・
// 出走馬の結果・コースと馬場、そして映像や騎手の報告で分かる出来事（前が壁になった・外を回った・行きたがった・出遅れ・競り合い）。
// レース計算の内部の数値（速度・エネルギー残量・仕掛けた地点・ペース指数など）は使わない。
// 出来事の有無はレース計算の記録から判定するが、秒数やメートルなどの内部の量は表に出さない。
import type { OwnerRaceRecord } from "./analysis";
import { bandForDistance } from "./aptitude";
import type { RunningStyle } from "../types";

/** 情報の分類：記録された事実／観察できる事実／推定・見解／提案 */
export type InfoClass = "record" | "observed" | "estimate" | "proposal";

/** 判定に使う基準値（調整用） */
export const DIAGNOSIS_RULES = {
  /** 前が壁になった：前の馬に抑えられていた時間がこれ以上（秒） */
  blockedSec: 3,
  /** 外を回った：コーナーで余分に走った距離がこれ以上（m） */
  wideMeters: 8,
  /** 行きたがった（騎手の報告）：これ以上（秒） */
  keenSec: 4,
  /** 出遅れ：発走の遅れがこれ以上（秒） */
  slowStartSec: 0.35,
  /** 終盤に順位を上げた／下げた：残り400m からゴールまでの順位の変化 */
  lateMove: 2,
  /** 最後の1ハロンで止まった：その前の1ハロンより何秒以上遅いか */
  finalFurlongSlow: 0.6,
  /**
   * ラップから見た流れ：先頭の「前半の平均ラップ − 後半の平均ラップ」（発走直後の200mを除く）を、
   * 距離ごとの平均的な差（下の式）と比べ、この値より大きく前半が速ければ「速い流れ」、遅ければ「落ち着いた流れ」
   */
  paceMargin: 0.3,
  /** 距離ごとの平均的な前後半の差（秒）＝ a + b × 距離（ゲーム内のレースの記録から求めた目安） */
  paceRef: { a: 1.99, b: -0.00087 },
} as const;

export type PaceShape = "fast" | "even" | "slow";

export type FactId =
  | "result" // 着順・着差（記録）
  | "topThree"
  | "closeFinish" // 勝ち馬から0.5馬身以内（勝った場合は2着と0.5馬身以内）
  | "beatenFar" // 勝ち馬から5馬身以上
  | "ledEarly" // 序盤に先頭
  | "rearEarly" // 序盤に後方（下から3割）
  | "gainedLate" // 残り400mからゴールまでに順位を上げた
  | "lostLate" // 同じく下げた
  | "fastLast3f" // 上がり3Fが出走馬で2位以内
  | "slowLast3f" // 上がり3Fが下から2頭以内
  | "finalFurlongSlowed" // 最後の1ハロンがその前より明らかに遅い
  | "paceFast" // ラップから見て前半が速い流れ
  | "paceSlow"
  | "positionDiffered" // 作戦の脚質と実際の位置取りが違った
  | "blocked" // 前が壁になる場面があった（映像で確認できる）
  | "wide" // 外を回る形になった
  | "keen" // 騎手の報告：行きたがった
  | "slowStart" // 出遅れた
  | "duelWon" // ゴール前の競り合いで前に出た
  | "duelLost"
  | "firstAtDistance" // この距離帯は初めて（戦績から）
  | "longestYet"; // これまでで一番長い距離（戦績から）

export interface Fact {
  id: FactId;
  cls: "record" | "observed";
  /** 文面に差し込む値（すべて公開されている記録から） */
  params?: Record<string, string | number>;
}

export type ViewId =
  | "goodRun" // 力を出せた
  | "paceHurtFront" // 前半の速い流れが前の馬に厳しかった可能性
  | "paceSuitedFront" // 落ち着いた流れが向いた可能性
  | "tooFarBack" // 位置が後ろすぎた可能性（終いは伸びている）
  | "tripTrouble" // 前が壁になったことが影響した可能性
  | "wideCost" // 外を回った分が響いた可能性
  | "keenCost" // 力んだことが影響した可能性
  | "distanceQuestion" // 距離が長かった可能性もある（断定しない）
  | "tacticsMismatch" // 作戦どおりの位置を取れなかった
  | "outclassed" // 大きく離され上がりも遅い：今回の相手には力の差があった可能性
  | "undetermined"; // 原因を特定できない

export interface View {
  id: ViewId;
  /** 根拠にした事実 */
  basis: FactId[];
  /** 根拠が2つ以上そろえば "moderate"、1つなら "weak"（どちらでも断定はしない） */
  strength: "moderate" | "weak";
}

export type SuggestionId =
  | "sameAgain" // 同じ条件でもう一度確かめる
  | "tryForward" // もう少し前で運ぶ作戦を試す
  | "tryRestrained" // 控える作戦を試す
  | "tryShorter" // 短めの距離で比べる
  | "keepPlan" // 今の作戦を続けて確かめる
  | "trySpurtTiming" // 仕掛けのタイミングを見直す
  | "tryOtherConditions"; // 条件（距離・馬場・相手）を変えて比べる

export interface Suggestion {
  id: SuggestionId;
  basis: ViewId[];
}

export interface RaceDiagnosis {
  facts: Fact[];
  views: View[];
  suggestions: Suggestion[];
  pace: PaceShape | null;
}

const has = (facts: Fact[], id: FactId) => facts.some((f) => f.id === id);

/** 先頭の200mラップから見た流れ（発走直後の200mを除く。前後半の差を距離ごとの平均と比べる） */
export function paceShapeFromLaps(leaderLaps: readonly number[], distance: number): PaceShape | null {
  const L = leaderLaps.slice(1);
  if (L.length < 4) return null;
  const h = Math.floor(L.length / 2);
  const avg = (a: readonly number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const diff = avg(L.slice(0, h)) - avg(L.slice(L.length - h));
  const ref = DIAGNOSIS_RULES.paceRef.a + DIAGNOSIS_RULES.paceRef.b * distance;
  // 前半が速い（前半のラップが小さい）ほど diff は小さくなる
  if (diff < ref - DIAGNOSIS_RULES.paceMargin) return "fast";
  if (diff > ref + DIAGNOSIS_RULES.paceMargin) return "slow";
  return "even";
}

/** 実際の位置取りの脚質（記録の styleShown）が、作戦の脚質から2段階以上離れているか */
function styleGap(plan: RunningStyle, shown: RunningStyle): number {
  const order: RunningStyle[] = ["front", "stalker", "closer", "deep"];
  return Math.abs(order.indexOf(plan) - order.indexOf(shown));
}

/**
 * 記録から事実を抜き出す。history は同じ馬のこれより前のレース記録（距離の比較に使う。なくてもよい）
 */
export function extractFacts(r: OwnerRaceRecord, history: readonly OwnerRaceRecord[] = []): Fact[] {
  const R = DIAGNOSIS_RULES;
  const t = r.telemetry;
  const n = r.fieldSize;
  const facts: Fact[] = [{ id: "result", cls: "record", params: { position: r.position, field: n } }];
  if (r.position <= 3) facts.push({ id: "topThree", cls: "record" });
  if (Math.abs(r.marginToWinner) <= 0.5) facts.push({ id: "closeFinish", cls: "record" });
  if (r.marginToWinner >= 5) facts.push({ id: "beatenFar", cls: "record" });

  const pos = (remain: number) => t.positions.find((p) => p.remain === remain)?.pos;
  const early = t.positions[0]?.pos;
  if (early === 1) facts.push({ id: "ledEarly", cls: "record" });
  else if (early !== undefined && n > 3 && early >= Math.ceil(n * 0.7)) facts.push({ id: "rearEarly", cls: "record", params: { pos: early } });
  const p400 = pos(400);
  if (p400 !== undefined) {
    if (p400 - r.position >= R.lateMove) facts.push({ id: "gainedLate", cls: "record", params: { from: p400, to: r.position } });
    if (r.position - p400 >= R.lateMove) facts.push({ id: "lostLate", cls: "record", params: { from: p400, to: r.position } });
  }
  // 上がり3Fの順位（出走馬の記録から）
  const sorted = [...r.field].sort((a, b) => a.last600 - b.last600);
  const l3rank = sorted.findIndex((f) => f.isMine) + 1;
  if (l3rank > 0 && l3rank <= 2) facts.push({ id: "fastLast3f", cls: "record", params: { rank: l3rank } });
  if (l3rank > 0 && n > 4 && l3rank >= n - 1) facts.push({ id: "slowLast3f", cls: "record", params: { rank: l3rank } });
  // 自分の最後の2ハロン（200mごとの通過時刻から）
  const sp = t.splits;
  if (sp.length >= 2 && r.course.distance % 200 === 0) {
    const last = r.timeMs / 1000 - sp[sp.length - 2];
    const prev = sp[sp.length - 2] - (sp.length >= 3 ? sp[sp.length - 3] : 0);
    if (sp.length >= 3 && last - prev >= R.finalFurlongSlow) facts.push({ id: "finalFurlongSlowed", cls: "record" });
  }
  const shape = paceShapeFromLaps(r.leaderLaps, r.course.distance);
  if (shape === "fast") facts.push({ id: "paceFast", cls: "record" });
  if (shape === "slow") facts.push({ id: "paceSlow", cls: "record" });
  if (styleGap(r.tactics.style, t.styleShown) >= 2) facts.push({ id: "positionDiffered", cls: "record" });

  // 映像・騎手の報告で分かる出来事（量は出さない）
  if (t.blockedSec >= R.blockedSec) facts.push({ id: "blocked", cls: "observed" });
  if (t.extraMeters >= R.wideMeters) facts.push({ id: "wide", cls: "observed" });
  if (t.keenSec >= R.keenSec) facts.push({ id: "keen", cls: "observed" });
  if (t.startDelay >= R.slowStartSec) facts.push({ id: "slowStart", cls: "observed" });
  // 競り合いは上位争いのときだけ取り上げる
  if (t.duel.occurred && r.position <= 4) facts.push({ id: t.duel.gained ? "duelWon" : "duelLost", cls: "observed" });

  // 戦績との比較（同じ馬の過去のレース）
  const prior = history.filter((h) => h.horseId === r.horseId && h.raceId !== r.raceId && h.week <= r.week);
  if (prior.length > 0) {
    const band = bandForDistance(r.course.distance).key;
    if (!prior.some((h) => bandForDistance(h.course.distance).key === band)) facts.push({ id: "firstAtDistance", cls: "record" });
    if (prior.every((h) => h.course.distance < r.course.distance)) facts.push({ id: "longestYet", cls: "record" });
  }
  return facts;
}

/** 事実から見解を判定する。根拠のない見解は作らない */
export function judgeViews(r: OwnerRaceRecord, facts: Fact[]): View[] {
  const views: View[] = [];
  const add = (id: ViewId, basis: FactId[]) => views.push({ id, basis, strength: basis.length >= 2 ? "moderate" : "weak" });
  const f = (id: FactId) => has(facts, id);
  const good = f("topThree") || f("closeFinish");
  if (good) add("goodRun", f("topThree") ? ["topThree"] : ["closeFinish"]);

  if (!good) {
    if (f("paceFast") && (f("ledEarly") || r.telemetry.styleShown === "front" || r.telemetry.styleShown === "stalker") && (f("lostLate") || f("finalFurlongSlowed")))
      add("paceHurtFront", ["paceFast", f("lostLate") ? "lostLate" : "finalFurlongSlowed"]);
    if (f("rearEarly") && f("fastLast3f")) add("tooFarBack", ["rearEarly", "fastLast3f"]);
    if (f("blocked")) add("tripTrouble", f("gainedLate") || f("fastLast3f") ? ["blocked", f("gainedLate") ? "gainedLate" : "fastLast3f"] : ["blocked"]);
    if (f("wide") && !f("blocked")) add("wideCost", ["wide"]);
    if (f("keen") && (f("lostLate") || f("finalFurlongSlowed"))) add("keenCost", ["keen", f("lostLate") ? "lostLate" : "finalFurlongSlowed"]);
    // 距離：終盤に止まった＋初めて／一番長い距離のときだけ「可能性」として挙げる（流れや位置取りでも説明できるので強くはしない）
    if ((f("lostLate") || f("finalFurlongSlowed")) && (f("firstAtDistance") || f("longestYet")) && !f("paceFast") && !f("keen"))
      views.push({ id: "distanceQuestion", basis: [f("lostLate") ? "lostLate" : "finalFurlongSlowed", f("firstAtDistance") ? "firstAtDistance" : "longestYet"], strength: "weak" });
    // 大きく負けて上がりも遅く、ほかに説明となる出来事がない
    if (f("beatenFar") && f("slowLast3f") && !f("blocked") && !f("keen") && !f("wide") && !f("paceFast")) add("outclassed", ["beatenFar", "slowLast3f"]);
    if (f("positionDiffered") && !f("slowStart")) add("tacticsMismatch", ["positionDiffered"]);
    else if (f("positionDiffered") && f("slowStart")) add("tacticsMismatch", ["positionDiffered", "slowStart"]);
  } else if (f("paceSlow") && (f("ledEarly") || r.telemetry.styleShown === "front")) {
    add("paceSuitedFront", ["paceSlow", "ledEarly"].filter((x) => f(x as FactId)) as FactId[]);
  }
  if (!good && !views.some((v) => v.id !== "tacticsMismatch")) views.push({ id: "undetermined", basis: [], strength: "weak" });
  return views;
}

/** 見解から次走に向けた検討事項を選ぶ（効果の保証はしない） */
export function suggest(views: View[]): Suggestion[] {
  const out: Suggestion[] = [];
  const v = (id: ViewId) => views.some((x) => x.id === id);
  if (v("tooFarBack")) out.push({ id: "tryForward", basis: ["tooFarBack"] });
  if (v("paceHurtFront")) out.push({ id: "tryRestrained", basis: ["paceHurtFront"] });
  if (v("keenCost")) out.push({ id: "tryRestrained", basis: ["keenCost"] });
  if (v("distanceQuestion")) out.push({ id: "tryShorter", basis: ["distanceQuestion"] });
  if (v("tripTrouble") || v("wideCost")) out.push({ id: "sameAgain", basis: views.filter((x) => x.id === "tripTrouble" || x.id === "wideCost").map((x) => x.id) });
  if (v("outclassed")) out.push({ id: "tryOtherConditions", basis: ["outclassed"] });
  if (v("tacticsMismatch") && !out.length) out.push({ id: "trySpurtTiming", basis: ["tacticsMismatch"] });
  if (v("undetermined")) out.push({ id: "sameAgain", basis: ["undetermined"] });
  if (v("goodRun") && !out.length) out.push({ id: "keepPlan", basis: ["goodRun"] });
  // 同じ提案は1つに
  return out.filter((s, i) => out.findIndex((x) => x.id === s.id) === i).slice(0, 3);
}

export function diagnoseRace(r: OwnerRaceRecord, history: readonly OwnerRaceRecord[] = []): RaceDiagnosis {
  const facts = extractFacts(r, history);
  const views = judgeViews(r, facts);
  return { facts, views, suggestions: suggest(views), pace: paceShapeFromLaps(r.leaderLaps, r.course.distance) };
}
