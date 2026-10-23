// レースの分析（指示書 7・8章）。
// 記録（ラップ・通過順・上がり・不利の有無）から「何が読み取れるか」を整理する。
// どの能力について情報が得られるかはレースの中身次第で、短距離戦ではスタミナは分からない、
// 競り合いがなければ根性は分からない、といった形で情報量が変わる。
import type { Going, RunningStyle } from "../types";
import { bandForDistance } from "./aptitude";
import type { OwnerCourse } from "./courses";
import { KNOWLEDGE_LABELS, type KnowledgeKey, type TraitId } from "./model";
import type { RacePace, RunnerTelemetry, Tactics } from "./sim";
import type { ClassId } from "./racecard";
import { STYLE_LABELS, GOING_LABELS } from "../types";
import { formatRaceTime } from "../race";

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
  /** レース全体のペース（レース計算の再設計以降の記録のみ。古い記録にはない） */
  pace?: RacePace;
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

/** 記録から読み取れることを並べる（真の値は使わない） */
export function analyzeRace(r: OwnerRaceRecord): Finding[] {
  const t = r.telemetry;
  const D = r.course.distance;
  const out: Finding[] = [];
  const l3rank = last600Rank(r);

  // 1. スピード（走破タイムとラップ）
  const blocked = t.blockedSec >= 3;
  out.push({
    title: "走破タイムと巡航速度",
    text: `走破タイム ${formatRaceTime(r.timeMs)}、道中の平均速度 ${t.cruiseSpeed.toFixed(1)}m/秒。${
      blocked ? `ただし前が詰まった時間が${t.blockedSec.toFixed(1)}秒あり、能力を出し切れていない可能性がある。` : ""
    }`,
    informs: [item("speed", blocked ? 1.6 : 1.0)],
    notInformative: [],
  });

  // 2. 仕掛けと加速
  out.push({
    title: "仕掛けと終いの脚",
    text:
      t.spurtRemain !== null
        ? `残り${t.spurtRemain}mで仕掛け、上がり3F ${t.last600.toFixed(1)}秒（出走馬中${l3rank}位）。終盤の最高速度は${t.topSpeedLate.toFixed(1)}m/秒。`
        : `はっきりと仕掛ける場面がなかった。上がり3F ${t.last600.toFixed(1)}秒（出走馬中${l3rank}位）。`,
    informs: t.spurtRemain !== null ? [item("acceleration", blocked ? 1.5 : 1.0)] : [item("acceleration", 1.8)],
    notInformative: [],
  });

  // 3. 持久力
  const stamina: Finding = { title: "終盤の余力", text: "", informs: [], notInformative: [] };
  if (t.emptyRemain !== null) {
    stamina.text = `残り${t.emptyRemain}m付近で脚が上がった（エネルギー切れ）。最後の200mの平均速度は${t.lastSegSpeed.toFixed(1)}m/秒。`;
    stamina.informs.push(item("stamina", 0.9));
  } else if (D >= 1800) {
    stamina.text = `${D}mを最後まで脚を残して走り切った。最後の200mは${t.lastSegSpeed.toFixed(1)}m/秒。`;
    stamina.informs.push(item("stamina", D >= 2200 ? 1.0 : 1.2));
  } else if (D >= 1500) {
    stamina.text = `最後まで大きな失速はなかったが、${D}mでは持久力の限界までは分からない。`;
    stamina.informs.push(item("stamina", 1.7));
  } else {
    stamina.text = `${D}mの短距離戦で失速はなかった。`;
    stamina.notInformative.push({ key: "stamina", reason: "短距離戦のため、スタミナは判断できない" });
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
  if (t.keenSec >= 4) extras.push(`道中で${t.keenSec.toFixed(0)}秒ほど行きたがった`);
  if (t.extraMeters >= 8) extras.push(`外を回って約${t.extraMeters.toFixed(0)}m余分に走った`);
  if (t.startDelay >= 0.35) extras.push("スタートで少し出遅れた");
  out.push({
    title: "位置取りと折り合い",
    text: `${STYLE_LABELS[t.styleShown]}の位置で運んだ（作戦：${STYLE_LABELS[r.tactics.style]}）。${posText}。${extras.length ? extras.join("、") + "。" : ""}`,
    informs: [item("raceSense", 1.3), item(`style_${t.styleShown}` as KnowledgeKey, 1.2)],
    notInformative: [],
  });

  // 6. レースの流れ（ラップの前半・後半と、先頭争いの有無。再設計前の記録にはペースの情報がないので出さない）
  if (r.pace && r.leaderLaps.length >= 4) {
    const L = r.leaderLaps.slice(1); // 発走直後の200mは加速中なので除く
    const h = Math.floor(L.length / 2);
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const first = avg(L.slice(0, h));
    const second = avg(L.slice(L.length - h));
    const label = r.pace.label === "high" ? "速い流れ" : r.pace.label === "slow" ? "落ち着いた流れ" : "平均的な流れ";
    out.push({
      title: "レースの流れ",
      text: `先頭の200mごとのラップ（発走直後を除く）は前半平均${first.toFixed(1)}秒、後半平均${second.toFixed(1)}秒。${
        r.pace.battleSec >= 5 ? "序盤に複数の馬が先頭を争った。" : ""
      }全体としては${label}だったとみられる。`,
      informs: [],
      notInformative: [],
    });
  }

  // 7. 条件
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

/**
 * レース中に個性の兆候が見えたか。has は「その馬が本当にその個性を持つか」で、
 * 呼び出し側（エンジン）が真の情報から渡す。兆候は記録された走りの内容がきっかけになる。
 */
export function raceTraitChecks(r: OwnerRaceRecord): { trait: TraitId; opportunity: boolean }[] {
  const t = r.telemetry;
  return [
    { trait: "keen", opportunity: r.tactics.style !== "front" },
    { trait: "calm", opportunity: r.tactics.style !== "front" },
    { trait: "hatesCrowd", opportunity: t.crowdedSec >= 5 },
    { trait: "wideRunner", opportunity: t.extraMeters >= 6 },
    { trait: "gutsy", opportunity: t.duel.occurred },
    { trait: "frontObsessed", opportunity: r.tactics.style !== "front" },
    { trait: "closerKick", opportunity: t.spurtRemain !== null },
    { trait: "inconsistent", opportunity: true },
  ];
}

/** 個性があるときに、その場面で兆候として見える確率 */
export function raceTraitSignChance(trait: TraitId, r: OwnerRaceRecord, has: boolean): number {
  const t = r.telemetry;
  if (!has) {
    // 本当は持っていなくても、たまたまそう見えることがある
    if (trait === "keen") return t.keenSec >= 4 ? 0.5 : 0.02;
    return 0.02;
  }
  switch (trait) {
    case "keen":
      return t.keenSec >= 4 ? 0.85 : 0.25;
    case "calm":
      return t.keenSec === 0 ? 0.45 : 0.1;
    case "hatesCrowd":
      return 0.6;
    case "wideRunner":
      return 0.5;
    case "gutsy":
      return t.duel.gained ? 0.75 : 0.3;
    case "frontObsessed":
      return t.styleShown === "front" ? 0.8 : 0.3;
    case "closerKick":
      return last600Rank(r) <= 2 ? 0.6 : 0.2;
    case "inconsistent":
      return 0.25;
    default:
      return 0.2;
  }
}
