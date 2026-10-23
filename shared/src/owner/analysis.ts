// レースの分析（指示書 7・8章）。
// 記録（ラップ・通過順・上がり・不利の有無）から「何が読み取れるか」と、見立てを更新する材料を整理する。
// 馬主向けの報告（記録・観察・推定・提案）と調教師のコメントは report.ts で作る。
// どの能力について情報が得られるかはレースの中身次第で、短距離戦ではスタミナは分からない、
// 競り合いがなければ根性は分からない、といった形で情報量が変わる。
import type { Going, RunningStyle } from "../types";
import { bandForDistance } from "./aptitude";
import type { OwnerCourse } from "./courses";
import { KNOWLEDGE_LABELS, type KnowledgeKey } from "./model";
import type { RunnerTelemetry, Tactics } from "./sim";
import type { ClassId } from "./racecard";
import { STYLE_LABELS, GOING_LABELS } from "../types";
import { formatRaceTime } from "../race";
import { ANALYSIS_RULES, raceFacts } from "./report";

export interface FieldRow {
  gate: number;
  name: string;
  isMine: boolean;
  position: number;
  timeMs: number;
  marginLengths: number;
  last600: number;
  styleShown: RunningStyle;
}

export interface OwnerRaceRecord {
  raceId: string;
  programId: string;
  programName: string;
  classId: ClassId;
  week: number;
  course: OwnerCourse;
  going: Going;
  horseId: string;
  horseName: string;
  trainerId: string;
  tactics: Tactics;
  position: number;
  fieldSize: number;
  timeMs: number;
  /** 勝ち馬との差（馬身）。勝った場合は2着との差をマイナスで持つ */
  marginToWinner: number;
  prize: number;
  field: FieldRow[];
  telemetry: RunnerTelemetry;
  leaderLaps: number[];
  trainerComment: string;
  analyzed: boolean;
}

export type InfoStrength = "高" | "中" | "低";

export interface InfoItem {
  key: KnowledgeKey;
  strength: InfoStrength;
  /** 観測のばらつきの倍率（小さいほど確か） */
  infoScale: number;
}

export interface Finding {
  title: string;
  text: string;
  informs: InfoItem[];
  /** 情報が得られなかった項目とその理由 */
  notInformative: { key: KnowledgeKey; reason: string }[];
}

const strengthOf = (s: number): InfoStrength => (s <= 1.0 ? "高" : s <= 1.4 ? "中" : "低");
const item = (key: KnowledgeKey, infoScale: number): InfoItem => ({ key, infoScale, strength: strengthOf(infoScale) });

/** 最後の600mのタイムの順位（速い順） */
export function last600Rank(r: OwnerRaceRecord): number {
  const sorted = [...r.field].sort((a, b) => a.last600 - b.last600);
  return sorted.findIndex((f) => f.isMine) + 1;
}

/**
 * 記録から読み取れることを並べ、どの見立てを更新する材料になるかを決める（真の値は使わない）。
 * 文章は記録（タイム・上がり3F・通過順・走りの様子）だけで書き、内部の速度やエネルギー残量は出さない。
 */
export function analyzeRace(r: OwnerRaceRecord): Finding[] {
  const t = r.telemetry;
  const D = r.course.distance;
  const out: Finding[] = [];
  const f = raceFacts(r);
  const l3 = f.last3FRank !== null ? `（出走馬中${f.last3FRank}位）` : "";

  // 1. スピード（走破タイム）
  const blocked = t.blockedSec >= ANALYSIS_RULES.blockedSec;
  out.push({
    title: "走破タイム",
    text: `走破タイム ${formatRaceTime(r.timeMs)}（勝ち時計 ${formatRaceTime(f.winnerTimeMs)}）。${
      blocked ? "道中で前が壁になる場面があり、能力を出し切れていない可能性がある。" : ""
    }`,
    informs: [item("speed", blocked ? 1.6 : 1.0)],
    notInformative: [],
  });

  // 2. 終いの脚
  const move =
    t.spurtRemain === null ? "はっきり動く場面はなかった。" : t.spurtRemain > r.course.straightLength + 60 ? "直線に入る前から動いた。" : t.spurtRemain <= r.course.straightLength ? "直線に向いてから追い出した。" : "";
  out.push({
    title: "終いの脚",
    text: `${move}上がり3F ${t.last600.toFixed(1)}秒${l3}。`,
    informs: t.spurtRemain !== null ? [item("acceleration", blocked ? 1.5 : 1.0)] : [item("acceleration", 1.8)],
    notInformative: [],
  });

  // 3. 持久力：距離と、記録に表れた終盤の伸び（順位の変化・上がり）から判断する
  const stamina: Finding = { title: "終盤の伸び", text: "", informs: [], notInformative: [] };
  const faded =
    (f.lateChange !== null && f.lateChange <= -ANALYSIS_RULES.lateMove) || (f.last3FRank !== null && f.last3FRank >= f.fieldSize - 1);
  if (D < 1500) {
    stamina.text = `${D}mの短距離戦。`;
    stamina.notInformative.push({ key: "stamina", reason: "短距離戦のため、スタミナは判断できない" });
  } else if (faded) {
    stamina.text = `終盤に伸びを欠いた。${D}mの終盤の走りは持久力を推し量る材料になるが、ペースや位置取りの影響もありうる。`;
    stamina.informs.push(item("stamina", 0.95));
  } else if (D >= 1800) {
    stamina.text = `${D}mで終盤まで大きく崩れなかった。`;
    stamina.informs.push(item("stamina", D >= 2200 ? 1.0 : 1.2));
  } else {
    stamina.text = `終盤に大きく崩れることはなかったが、${D}mでは持久力の限界までは分からない。`;
    stamina.informs.push(item("stamina", 1.7));
  }
  out.push(stamina);

  // 4. 競り合い
  if (t.duel.occurred) {
    out.push({
      title: "競り合い",
      text: t.duel.gained ? "ゴール前の競り合いで前に出た。" : "ゴール前で競り合ったが、前に出ることはできなかった。",
      informs: [item("fightingSpirit", 0.95)],
      notInformative: [],
    });
  } else {
    out.push({
      title: "競り合い",
      text: "ゴール前で他馬と並ぶ場面はなかった。",
      informs: [],
      notInformative: [{ key: "fightingSpirit", reason: "競り合いがなかったため、根性は判断できない" }],
    });
  }

  // 5. 位置取り・折り合い
  const posText = t.positions.map((p) => `${p.label}${p.pos}番手`).join(" → ");
  const extras: string[] = [];
  if (t.keenSec >= ANALYSIS_RULES.keenSec) extras.push("道中で行きたがる素振りがあった");
  if (t.extraMeters >= ANALYSIS_RULES.wideMeters) extras.push("コーナーで外を回った");
  if (t.startDelay >= ANALYSIS_RULES.slowStartSec) extras.push("スタートでやや後手を踏んだ");
  out.push({
    title: "位置取りと折り合い",
    text: `${STYLE_LABELS[t.styleShown]}の位置で運んだ（作戦：${STYLE_LABELS[r.tactics.style]}）。${posText}。${extras.length ? extras.join("、") + "。" : ""}`,
    informs: [item("raceSense", 1.3), item(`style_${t.styleShown}` as KnowledgeKey, 1.2)],
    notInformative: [],
  });

  // 6. 条件
  const cond: Finding = { title: "条件", text: "", informs: [], notInformative: [] };
  const band = bandForDistance(D);
  const surfaceKey: KnowledgeKey = r.course.surface === "turf" ? "surface_turf" : "surface_dirt";
  cond.informs.push(item(band.key, 1.0), item(surfaceKey, 1.0));
  const notes = [`${KNOWLEDGE_LABELS[band.key]}・${KNOWLEDGE_LABELS[surfaceKey]}での走り`];
  if (r.going !== "good") {
    cond.informs.push(item("going_heavy", r.going === "yielding" ? 1.5 : 1.1));
    cond.informs.push(item("power", 1.3));
    notes.push(`馬場${GOING_LABELS[r.going]}`);
  } else {
    cond.notInformative.push({ key: "going_heavy", reason: "良馬場だったため、道悪への適性は判断できない" });
  }
  cond.informs.push(item(r.course.direction === "right" ? "course_right" : "course_left", 1.6));
  if (r.course.slope) {
    cond.informs.push(item("course_slope", 1.5));
    if (r.going === "good") cond.informs.push(item("power", 1.6));
    notes.push("ゴール前の坂");
  }
  if (r.course.tight) {
    cond.informs.push(item("course_tight", 1.5));
    notes.push("小回り");
  }
  cond.text = `${notes.join("・")}。着順と走りの内容から、この条件への向き不向きを判断する材料になる。`;
  out.push(cond);
  return out;
}

/** 分析で得られる情報の一覧（同じ項目が複数あれば確かな方を使う） */
export function analysisPlan(r: OwnerRaceRecord): InfoItem[] {
  const best = new Map<KnowledgeKey, InfoItem>();
  for (const f of analyzeRace(r)) for (const it of f.informs) {
    const cur = best.get(it.key);
    if (!cur || it.infoScale < cur.infoScale) best.set(it.key, it);
  }
  return [...best.values()];
}

/** 調教師がレース後に自動で見立てる項目（馬主の分析より範囲が狭い） */
export function trainerRacePlan(r: OwnerRaceRecord): InfoItem[] {
  const keep: KnowledgeKey[] = ["speed", "stamina", "acceleration", "dist_sprint", "dist_mile", "dist_middle", "dist_long", "surface_turf", "surface_dirt", "going_heavy"];
  return analysisPlan(r).filter((i) => keep.includes(i.key)).map((i) => ({ ...i, infoScale: i.infoScale * 1.15 }));
}
