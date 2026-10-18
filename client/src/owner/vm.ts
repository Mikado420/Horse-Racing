// 表示用データ（ビューモデル）。画面コンポーネントはここで作ったデータだけを使い、
// セーブデータの馬（真の能力・成長上限・偏りの種を含む）を直接受け取らない（指示書 v2.0 14.5）。
// ゲームのルールを使う判断（出走できるか・調教師の意見など）もここで行い、結果だけを渡す。
import {
  ABILITY_KEYS,
  CLASS_DEFS,
  activeHorses,
  ageAt,
  bandForDistance,
  entryProblem,
  findProgramById,
  findTrainer,
  ownerRetirementBonus,
  saleValue,
  thisWeekCard,
  toHorseView,
  trainerOpinion,
  upcomingFees,
  upcomingStakes,
  weeklyFeeFor,
  type HorseView,
  type KnowledgeKey,
  type KnowledgeView,
  type OwnerProgram,
  type OwnerSave,
  type TrainerOpinion,
  type WeeklyReport,
} from "@owners/shared";

export type Importance = "urgent" | "check" | "normal";
export const IMPORTANCE_LABELS: Record<Importance, string> = { urgent: "緊急", check: "要確認", normal: "通常" };

export type ReportKind = "injury" | "discovery" | "proposal" | "warning" | "training";
export const REPORT_KIND_LABELS: Record<ReportKind, string> = {
  injury: "故障",
  discovery: "能力判明",
  proposal: "出走の提案",
  warning: "体調の注意",
  training: "調教報告",
};

export interface ReportVM {
  id: string;
  report: WeeklyReport;
  kind: ReportKind;
  importance: Importance;
  summary: string;
  proposal: string | null;
  needsReply: boolean;
  unread: boolean;
}

export function reportId(r: WeeklyReport): string {
  return `${r.horseId}@${r.week}`;
}

export function classifyReport(r: WeeklyReport, read: ReadonlySet<string>, currentWeek: number): ReportVM {
  const proposal = r.lines.find((l) => l.startsWith("提案：")) ?? null;
  const injury = r.alerts.some((a) => /痛め|故障/.test(a));
  const kind: ReportKind = injury ? "injury" : r.alerts.length ? "warning" : r.discoveries.length ? "discovery" : proposal ? "proposal" : "training";
  const importance: Importance = injury ? "urgent" : r.alerts.length || r.discoveries.length || proposal ? "check" : "normal";
  const obs = r.lines.find((l) => l.startsWith("観察："));
  const summary = injury
    ? r.alerts[0]
    : r.discoveries[0] ?? r.alerts[0] ?? (proposal ? proposal.replace(/^提案：/, "") : obs ? obs.replace(/^観察：/, "") : r.lines[0]);
  return {
    id: reportId(r),
    report: r,
    kind,
    importance,
    summary,
    proposal: proposal ? proposal.replace(/^提案：/, "") : null,
    // 提案は届いた週のうちだけ回答できる（翌週には次の報告が届く）
    needsReply: !!proposal && r.week === currentWeek - 1,
    // 古い報告（8週より前）は確認済みとして扱う
    unread: !read.has(reportId(r)) && r.week >= currentWeek - 8,
  };
}

/* ---------------- 馬 ---------------- */

export interface HorseCardVM {
  view: HorseView;
  trainerName: string;
  nextPlan: string;
  runnable: number;
  unreadReports: number;
  /** 6能力のうちランク以上が判明した数 */
  known: number;
  /** 6能力の解明度の平均 */
  progress: number;
  condition: { level: Importance; label: string };
}

export function conditionBadge(v: HorseView): { level: Importance; label: string } {
  const s = v.state;
  if (s.injuryWeeks > 0) return { level: "urgent", label: `故障（あと${s.injuryWeeks}週）` };
  if (s.fatigue >= 70) return { level: "urgent", label: "疲労が限界" };
  if (s.health < 40) return { level: "urgent", label: "健康に不安" };
  if (s.fatigue >= 50) return { level: "check", label: "疲れ気味" };
  if (s.condition <= -1) return { level: "check", label: "調子落ち" };
  if (s.fitness >= 70 && s.fatigue < 40) return { level: "normal", label: "出走できる状態" };
  return { level: "normal", label: "順調" };
}

export interface OwnerVM {
  week: number;
  player: OwnerSave["player"];
  fees: number;
  horses: HorseCardVM[];
  /** 引退・売却した馬も含む */
  allHorses: HorseView[];
  reports: ReportVM[];
  card: OwnerProgram[];
}

export function buildVM(save: OwnerSave, read: ReadonlySet<string>): OwnerVM {
  const card = thisWeekCard(save);
  const reports = save.reports.map((r) => classifyReport(r, read, save.week));
  const horses = activeHorses(save).map((h): HorseCardVM => {
    const view = toHorseView(h, save.week);
    const runnable = card.filter((p) => !entryProblem(save, h, p)).length;
    const goal = h.policy.goalRaceId ? findProgramById(h.policy.goalRaceId) : undefined;
    const abil = ABILITY_KEYS.map((k) => view.knowledge[k]);
    const nextPlan =
      view.state.injuryWeeks > 0
        ? "故障の治療中"
        : view.age < 2 || (view.age === 2 && runnable === 0 && h.record.races === 0)
          ? view.age < 2
            ? "育成中（2歳6月からデビュー）"
            : "デビューに向けて調整中"
          : goal
            ? `目標：${goal.name}（あと${goal.week - save.week}週）`
            : runnable > 0
              ? `今週出られるレース ${runnable}`
              : "調整中";
    return {
      view,
      trainerName: findTrainer(h.trainerId)?.name ?? "—",
      nextPlan,
      runnable,
      unreadReports: reports.filter((r) => r.unread && r.report.horseId === h.id).length,
      known: abil.filter((a) => a.stage !== "abstract").length,
      progress: Math.round(abil.reduce((a, b) => a + b.knowledgeScore, 0) / abil.length),
      condition: conditionBadge(view),
    };
  });
  return {
    week: save.week,
    player: save.player,
    fees: upcomingFees(save),
    horses,
    allHorses: save.horses.map((h) => toHorseView(h, save.week)),
    reports,
    card,
  };
}

/* ---------------- 重要事項（ホーム） ---------------- */

export interface TodoItem {
  id: string;
  importance: Importance;
  title: string;
  detail: string;
  horseId?: string;
  action: { label: string; to: "horse" | "race" | "report" | "analysis" | "shop"; arg?: string };
}

export function todos(save: OwnerSave, vm: OwnerVM): TodoItem[] {
  const out: TodoItem[] = [];
  for (const h of vm.horses) {
    const v = h.view;
    const s = v.state;
    if (s.injuryWeeks > 0)
      out.push({ id: `inj-${v.id}`, importance: "urgent", title: `${v.name}が故障の治療中`, detail: `あと${s.injuryWeeks}週ほど。方針を「体調・健康優先」にすると無理をさせません`, horseId: v.id, action: { label: "方針を見る", to: "horse", arg: v.id } });
    else if (s.fatigue >= 60)
      out.push({ id: `fat-${v.id}`, importance: "urgent", title: `${v.name}の疲労が蓄積`, detail: `疲労 ${s.fatigue}。休養の方針に切り替えるか、厩舎に任せましょう`, horseId: v.id, action: { label: "方針を見る", to: "horse", arg: v.id } });
    if (v.policy.goalRaceId) {
      const g = findProgramById(v.policy.goalRaceId);
      if (g && g.week - save.week <= 4 && g.week >= save.week)
        out.push({ id: `goal-${v.id}`, importance: "check", title: `目標の${g.name}まであと${g.week - save.week}週`, detail: `${v.name}の仕上がり ${s.fitness}`, horseId: v.id, action: { label: g.week === save.week ? "出走する" : "馬を見る", to: g.week === save.week ? "race" : "horse", arg: v.id } });
    }
    if (h.runnable > 0 && s.fitness >= 65 && s.fatigue < 45 && s.injuryWeeks === 0)
      out.push({ id: `run-${v.id}`, importance: "check", title: `${v.name}の出走計画`, detail: `今週出られるレースが${h.runnable}つあります`, horseId: v.id, action: { label: "出走を検討", to: "race", arg: v.id } });
  }
  const pending = save.races.filter((r) => !r.analyzed && save.horses.find((h) => h.id === r.horseId)?.status === "active");
  if (pending.length)
    out.push({ id: "analysis", importance: "normal", title: `未分析のレース ${pending.length}件`, detail: "分析すると能力の見立てが進みます", action: { label: "分析する", to: "analysis", arg: pending[0].raceId } });
  const replies = vm.reports.filter((r) => r.needsReply);
  if (replies.length)
    out.push({ id: "reply", importance: "check", title: `調教師の提案 ${replies.length}件`, detail: replies[0].summary, action: { label: "回答する", to: "report", arg: replies[0].id } });
  const found = vm.reports.filter((r) => r.unread && r.report.discoveries.length);
  if (found.length)
    out.push({ id: "found", importance: "check", title: "新しい能力情報", detail: found[0].report.discoveries[0], horseId: found[0].report.horseId, action: { label: "見立てを見る", to: "horse", arg: found[0].report.horseId } });
  if (save.player.money < 0)
    out.push({ id: "money", importance: "urgent", title: "所持金がマイナス", detail: "売却や出走で資金を立て直してください", action: { label: "所有馬", to: "horse" } });
  if (vm.horses.length === 0)
    out.push({ id: "nohorse", importance: "urgent", title: "現役の馬がいません", detail: "馬を買って厩舎に預けましょう", action: { label: "馬を買う", to: "shop" } });
  const order: Record<Importance, number> = { urgent: 0, check: 1, normal: 2 };
  return out.sort((a, b) => order[a.importance] - order[b.importance]);
}

/* ---------------- 出走 ---------------- */

export interface EntryVM {
  program: OwnerProgram;
  problem: string | null;
  opinion: TrainerOpinion | null;
  /** この条件に関する見立て（距離帯・馬場） */
  fit: KnowledgeView[];
  risks: string[];
  expectations: string[];
}

export function entryOptions(save: OwnerSave, horseId: string): EntryVM[] {
  const h = save.horses.find((x) => x.id === horseId);
  if (!h) return [];
  const view = toHorseView(h, save.week);
  return thisWeekCard(save).map((p) => {
    const problem = entryProblem(save, h, p);
    const opinion = problem ? null : trainerOpinion(save, horseId, p.id);
    const band = bandForDistance(p.course.distance).key;
    const sk: KnowledgeKey = p.course.surface === "turf" ? "surface_turf" : "surface_dirt";
    const keys: KnowledgeKey[] = [band, sk];
    if (p.going !== "good") keys.push("going_heavy");
    const fit = keys.map((k) => view.knowledge[k]);
    const risks: string[] = [];
    const expectations: string[] = [];
    if (view.state.fatigue >= 45) risks.push("疲れが残っていて、レース後の故障リスクが上がる");
    if (view.state.fitness < 55) risks.push("仕上がり途上で力を出し切れない");
    for (const f of fit) if (f.unverified) expectations.push(`${f.label.replace(/（.*）/, "")}の適性を確かめられる（未検証）`);
    if (p.course.distance >= 1800) expectations.push("スタミナを判断する材料になる");
    else risks.push("短い距離なのでスタミナは判断できない");
    const prize = p.firstPrize;
    expectations.push(`1着賞金 ${prize.toLocaleString("ja-JP")}円`);
    return { program: p, problem, opinion, fit, risks, expectations };
  });
}

export function classLabel(p: OwnerProgram): string {
  return CLASS_DEFS[p.classId].label;
}

/* ---------------- 経営 ---------------- */

export interface EconomyVM {
  weeklyFee: number;
  saleValue: number;
  retirementBonus: number;
}

export function economyOf(save: OwnerSave, horseId: string): EconomyVM | null {
  const h = save.horses.find((x) => x.id === horseId);
  if (!h) return null;
  return { weeklyFee: weeklyFeeFor(h, save.week), saleValue: saleValue(h, save.week), retirementBonus: ownerRetirementBonus(h) };
}

export function stakesAhead(save: OwnerSave) {
  return upcomingStakes(save.week, 12).map((p) => ({ program: p, weeksAway: p.week - save.week }));
}

/** 販売馬（下見の印象だけを見せる） */
export function marketVM(save: OwnerSave, offers = save.market.offers) {
  return offers.map((o) => ({ offerId: o.offerId, price: o.price, age: ageAt(o.horse, save.week), view: toHorseView(o.horse, save.week) }));
}
export type OfferVM = ReturnType<typeof marketVM>[number];
