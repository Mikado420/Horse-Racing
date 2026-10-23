// 調教師のレース後コメントの文面。診断（diagnosis.ts）の結果だけを材料にし、文面の選び方で意味は変えない。
// 言い回しは raceId から決まる（同じ記録なら毎回同じ文。別のレースでは言い回しが変わる）。
import { marginLabel } from "../race";
import { hash32 } from "./knowledge";
import type { OwnerRaceRecord } from "./analysis";
import { diagnoseRace, type Fact, type FactId, type RaceDiagnosis, type SuggestionId, type View, type ViewId } from "./diagnosis";

export interface CommentClaims {
  facts: FactId[];
  views: ViewId[];
  suggestions: SuggestionId[];
}

export interface TrainerComment {
  text: string;
  /** コメントで触れた事実・見解・提案（すべて診断に含まれるものだけ） */
  claims: CommentClaims;
}

/** 言い回しの候補から1つ選ぶ（意味は同じ） */
function pick(seed: number, salt: number, options: readonly string[]): string {
  return options[(seed + salt * 7919) % options.length];
}

function fill(s: string, p: Record<string, string | number> = {}): string {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(p[k] ?? ""));
}

const RESULT: Record<"win" | "place" | "close" | "other", readonly string[]> = {
  win: ["よく勝ち切ってくれました", "勝ってくれました。よく頑張りました"],
  place: ["{position}着と上位に来てくれました", "{position}着。上位争いができました"],
  close: ["{position}着でしたが、勝ち馬とは{margin}差でした", "勝ち馬から{margin}差の{position}着でした"],
  other: ["{position}着でした", "結果は{position}着でした"],
};

/** 観察できる出来事・記録の言い方（事実として言ってよいものだけ） */
const FACT_TEXT: Partial<Record<FactId, readonly string[]>> = {
  blocked: ["直線で前が壁になる場面がありました", "前に馬がいて、思うように進路が取れない場面がありました"],
  wide: ["コーナーで外を回る形になりました", "外を回らされる形でした"],
  keen: ["騎手は、道中で行きたがっていたと話しています", "騎手によると、道中で力む場面があったそうです"],
  slowStart: ["スタートで少し後手に回りました", "発馬で後れを取りました"],
  gainedLate: ["残り400mの{from}番手から、最後は{to}着まで順位を上げています", "直線で{from}番手から{to}着まで追い上げました"],
  lostLate: ["残り400mでは{from}番手でしたが、最後は{to}着でした", "残り400mの{from}番手から{to}着まで順位を下げました"],
  fastLast3f: ["上がり3Fは出走馬で{rank}番目に速いタイムでした"],
  duelWon: ["ゴール前の競り合いで前に出てくれました"],
  duelLost: ["ゴール前で並びましたが、前には出られませんでした"],
  ledEarly: ["序盤は先頭で運びました"],
  rearEarly: ["序盤は{pos}番手と後ろからの競馬でした"],
};

/** 見解の言い方。moderate は「可能性があります」、weak は「〜かもしれません」。どちらも断定しない */
const VIEW_TEXT: Record<ViewId, { moderate: readonly string[]; weak: readonly string[] }> = {
  goodRun: { moderate: ["力は出せたと思います"], weak: ["力は出せたと思います", "内容は悪くありませんでした"] },
  paceHurtFront: {
    moderate: ["前半の流れが速く、前で運んだ分が最後に響いた可能性があります"],
    weak: ["前半の流れが速かった影響もあったかもしれません"],
  },
  paceSuitedFront: { moderate: ["落ち着いた流れで、前で運べたのも良かったと思います"], weak: ["流れが落ち着いたのも味方したかもしれません"] },
  tooFarBack: {
    moderate: ["終いは伸びているので、位置取りが後ろすぎた可能性があります"],
    weak: ["位置取りが結果に影響したかもしれません"],
  },
  tripTrouble: {
    moderate: ["最後は伸びているだけに、進路の取りにくさが結果に影響した可能性があります"],
    weak: ["進路の取りにくさも結果に影響したかもしれません"],
  },
  wideCost: { moderate: ["外を回った分の距離が響いた可能性があります"], weak: ["外を回った分も響いたかもしれません"] },
  keenCost: {
    moderate: ["道中で力んだことが、最後の伸びに影響した可能性があります"],
    weak: ["道中で力んだ影響もあったかもしれません"],
  },
  distanceQuestion: {
    moderate: ["距離が長かった可能性もありますが、今回の結果だけでは断定できません"],
    weak: ["距離が長かった可能性もありますが、今回の結果だけでは断定できません", "距離適性については、もう少し確認が必要です"],
  },
  tacticsMismatch: {
    moderate: ["作戦どおりの位置を取れませんでした"],
    weak: ["作戦どおりの位置は取れませんでした", "思っていた位置では運べませんでした"],
  },
  outclassed: {
    moderate: ["離されてしまいました。今回の相手には、まだ力の差があった可能性があります"],
    weak: ["今回の相手には、まだ力の差があったかもしれません"],
  },
  undetermined: {
    moderate: ["今回の結果だけでは、はっきりした原因は分かりません"],
    weak: ["今回の結果だけでは、はっきりした原因は分かりません", "展開や位置取りの影響も考えられますが、原因は特定できません"],
  },
};

const SUGGEST_TEXT: Record<SuggestionId, readonly string[]> = {
  sameAgain: ["次も同じような条件で走りを確かめたいですね", "もう一度、似た条件で様子を見たいと思います"],
  tryForward: ["次はもう少し前で運ぶ形も試して、位置取りの違いを比べたいですね"],
  tryRestrained: ["次は少し控える形も試して、どちらが合うか確かめたいですね"],
  tryShorter: ["短めの距離でも走らせて、比べてみたいですね"],
  keepPlan: ["この形で、もう少し確かめていきましょう"],
  tryOtherConditions: ["距離や相手関係を変えて、走りを比べてみたいですね", "条件を変えたときの走りも確かめたいですね"],
  trySpurtTiming: ["展開を見ながら、作戦や仕掛けのタイミングを検討したいですね"],
};

/** コメントで触れる観察の優先順（見解の根拠を先に） */
const FACT_PRIORITY: FactId[] = ["blocked", "slowStart", "keen", "wide", "gainedLate", "lostLate", "fastLast3f", "duelWon", "duelLost", "rearEarly", "ledEarly"];

export function composeTrainerComment(r: OwnerRaceRecord, trainerName: string, diag: RaceDiagnosis = diagnoseRace(r)): TrainerComment {
  const seed = hash32(`comment|${r.raceId}`);
  const claims: CommentClaims = { facts: ["result"], views: [], suggestions: [] };
  const parts: string[] = [];
  const factOf = (id: FactId): Fact | undefined => diag.facts.find((f) => f.id === id);

  // 1. 結果（記録）
  const result = factOf("result")!;
  const kind = r.position === 1 ? "win" : r.position <= 3 ? "place" : factOf("closeFinish") ? "close" : "other";
  parts.push(fill(pick(seed, 1, RESULT[kind]), { ...result.params, margin: marginLabel(Math.max(0, r.marginToWinner)) }));
  if (kind === "close") claims.facts.push("closeFinish");

  // 2. 見解（最大2つ）。根拠となる事実を先に述べる
  const views: View[] = diag.views.filter((v) => v.id !== "goodRun" || r.position > 1).slice(0, 2);
  const mentioned = new Set<FactId>();
  for (const v of views) {
    for (const b of v.basis) {
      if (mentioned.has(b) || !FACT_TEXT[b] || mentioned.size >= 2) continue;
      const f = factOf(b);
      if (!f) continue;
      parts.push(fill(pick(seed, 2 + mentioned.size, FACT_TEXT[b]!), f.params));
      mentioned.add(b);
      claims.facts.push(b);
    }
  }
  // 見解の根拠以外にも目立つ出来事があれば1つだけ触れる
  if (mentioned.size === 0) {
    const extra = FACT_PRIORITY.find((id) => factOf(id) && FACT_TEXT[id]);
    if (extra) {
      parts.push(fill(pick(seed, 4, FACT_TEXT[extra]!), factOf(extra)!.params));
      claims.facts.push(extra);
    }
  }
  for (const v of views) {
    parts.push(pick(seed, 5 + claims.views.length, VIEW_TEXT[v.id][v.strength]));
    claims.views.push(v.id);
  }

  // 3. 次走に向けて（1つ）
  const s = diag.suggestions[0];
  if (s) {
    parts.push(pick(seed, 9, SUGGEST_TEXT[s.id]));
    claims.suggestions.push(s.id);
  }
  return { text: `${trainerName}調教師「${parts.join("。")}。」`, claims };
}

/** 事実の短い言い方（総評の「主な観察事項」用。記録と観察だけ） */
const FACT_SHORT: Partial<Record<FactId, string>> = {
  ledEarly: "序盤は先頭",
  rearEarly: "序盤は{pos}番手と後方",
  gainedLate: "残り400mの{from}番手から{to}着へ順位を上げた",
  lostLate: "残り400mの{from}番手から{to}着へ順位を下げた",
  fastLast3f: "上がり3Fは出走馬で{rank}番目",
  slowLast3f: "上がり3Fは出走馬で{rank}番目（遅い方）",
  finalFurlongSlowed: "最後の1ハロンで脚色が鈍った",
  blocked: "直線で前が壁になる場面があった",
  wide: "コーナーで外を回った",
  keen: "道中で行きたがった（騎手の報告）",
  slowStart: "スタートで後手に回った",
  duelWon: "ゴール前の競り合いで前に出た",
  duelLost: "ゴール前の競り合いで前に出られなかった",
  positionDiffered: "作戦とは違う位置取りになった",
};
const FACT_ORDER: FactId[] = ["blocked", "slowStart", "keen", "wide", "gainedLate", "lostLate", "fastLast3f", "slowLast3f", "finalFurlongSlowed", "duelWon", "duelLost", "rearEarly", "ledEarly", "positionDiffered"];

/** 主な観察事項（最大 max 件。記録・観察の事実だけ。見解は含めない） */
export function keyObservations(diag: RaceDiagnosis, max = 3): { id: FactId; cls: "record" | "observed"; text: string }[] {
  const out: { id: FactId; cls: "record" | "observed"; text: string }[] = [];
  for (const id of FACT_ORDER) {
    const f = diag.facts.find((x) => x.id === id);
    if (!f || !FACT_SHORT[id]) continue;
    out.push({ id, cls: f.cls, text: fill(FACT_SHORT[id]!, f.params) });
    if (out.length >= max) break;
  }
  return out;
}

/** 見解の短い言い方（推定であることが分かる文） */
export function viewText(v: View): string {
  return VIEW_TEXT[v.id][v.strength][0];
}

/** 検討事項の文 */
export function suggestionText(id: SuggestionId): string {
  return SUGGEST_TEXT[id][0];
}
