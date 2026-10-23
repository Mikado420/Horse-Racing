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
import { diagnoseRace, type FactId, type InfoClass } from "./diagnosis";

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
  /** 情報の分類：記録された事実／観察できる事実／推定・見解 */
  cls: InfoClass;
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
 * 記録から読み取れることを並べる（真の値もレース計算の内部の数値も使わない）。
 * 使うのは着順・タイム・ラップ・通過順位・上がり3F・出走馬の結果・条件と、映像や騎手の報告で分かる出来事だけ。
 * 各項目には情報の分類（記録・観察・推定）を付ける
 */
export function analyzeRace(r: OwnerRaceRecord, history: readonly OwnerRaceRecord[] = []): Finding[] {
  const t = r.telemetry;
  const D = r.course.distance;
  const out: Finding[] = [];
  const l3rank = last600Rank(r);
  const d = diagnoseRace(r, history);
  const f = (id: FactId) => d.facts.some((x) => x.id === id);
  const fact = (id: FactId) => d.facts.find((x) => x.id === id);
  const p400 = t.positions.find((p) => p.remain === 400)?.pos;
  const blocked = f("blocked");

  // 1. 走破タイムとラップ（記録）
  const lastF = finalFurlong(r);
  out.push({
    title: "走破タイム",
    cls: "record",
    text: `走破タイム ${formatRaceTime(r.timeMs)}${lastF !== null ? `、最後の1ハロン ${lastF.toFixed(1)}秒` : ""}（ゲーム内の計測）。${
      blocked ? "直線で前が壁になる場面があり、力を出し切れていない可能性がある。" : ""
    }`,
    informs: [item("speed", blocked ? 1.6 : 1.0)],
    notInformative: [],
  });

  // 2. 終いの脚（記録）
  const move = p400 !== undefined ? `残り400mの${p400}番手から${r.position}着` : `${r.position}着`;
  out.push({
    title: "終いの脚",
    cls: "record",
    text: `上がり3F ${t.last600.toFixed(1)}秒（出走馬中${l3rank}位）。${move}。`,
    informs: [item("acceleration", blocked ? 1.5 : f("fastLast3f") || f("gainedLate") ? 1.0 : 1.2)],
    notInformative: [],
  });

  // 3. 終盤の粘り（記録＋推定）。内部のエネルギー残量は使わず、終盤の順位と区間タイムの推移から見る
  const stamina: Finding = { title: "終盤の粘り", cls: "record", text: "", informs: [], notInformative: [] };
  const faded = f("lostLate") || f("finalFurlongSlowed");
  if (D < 1500) {
    stamina.text = `${D}mの短距離戦。${faded ? "最後に失速したが、" : ""}この距離ではスタミナまでは判断できない。`;
    stamina.notInformative.push({ key: "stamina", reason: "短距離戦のため、スタミナは判断できない" });
  } else {
    const parts: string[] = [];
    if (f("lostLate")) parts.push(`残り400mの${fact("lostLate")!.params!.from}番手から${r.position}着まで順位を下げた`);
    if (f("finalFurlongSlowed")) parts.push("最後の1ハロンはその前より明らかに遅かった");
    if (!faded) parts.push(`${D}mを最後まで大きく失速せずに走った`);
    let est = "";
    if (faded) {
      stamina.cls = "estimate";
      const others = [f("paceFast") && "前半の速い流れ", f("keen") && "道中の力み", f("wide") && "外を回ったこと"].filter(Boolean);
      est = others.length
        ? `持久力の不足だけでなく、${others.join("・")}も影響した可能性があり、原因は一つに絞れない。`
        : "距離や持久力が影響した可能性もあるが、この1戦だけでは断定できない。";
    }
    stamina.text = `${parts.join("。")}。${est}`;
    stamina.informs.push(item("stamina", D >= 2200 ? 1.0 : D >= 1800 ? 1.2 : 1.7));
  }
  out.push(stamina);

  // 4. 競り合い（観察）
  if (t.duel.occurred) {
    out.push({
      title: "競り合い",
      cls: "observed",
      text: t.duel.gained ? "ゴール前で他馬と並び、前に出た。" : "ゴール前で他馬と並んだが、前に出ることはできなかった。",
      informs: [item("fightingSpirit", 0.95)],
      notInformative: [],
    });
  } else {
    out.push({
      title: "競り合い",
      cls: "observed",
      text: "ゴール前で他馬と並ぶ場面はなかった。",
      informs: [],
      notInformative: [{ key: "fightingSpirit", reason: "競り合いがなかったため、根性は判断できない" }],
    });
  }

  // 5. 位置取りと折り合い（記録＋観察）
  const posText = t.positions.map((p) => `${p.label}${p.pos}番手`).join(" → ");
  const extras: string[] = [];
  if (f("keen")) extras.push("騎手によると道中で行きたがる場面があった");
  if (f("wide")) extras.push("コーナーで外を回る形になった");
  if (f("slowStart")) extras.push("スタートで後手に回った");
  if (blocked) extras.push("直線で前が壁になる場面があった");
  out.push({
    title: "位置取りと折り合い",
    cls: "observed",
    text: `${STYLE_LABELS[t.styleShown]}の位置で運んだ（作戦：${STYLE_LABELS[r.tactics.style]}）。${posText}。${extras.length ? extras.join("、") + "。" : ""}`,
    informs: [item("raceSense", 1.3), item(`style_${t.styleShown}` as KnowledgeKey, 1.2)],
    notInformative: [],
  });

  // 6. レースの流れ（推定）：記録されたラップの前後半の差を、距離ごとの平均的な差と比べる
  if (d.pace && r.leaderLaps.length >= 4) {
    const L = r.leaderLaps.slice(1); // 発走直後の200mは加速中なので除く
    const h = Math.floor(L.length / 2);
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const label = d.pace === "fast" ? "前半が速い流れ" : d.pace === "slow" ? "前半が落ち着いた流れ" : "平均的な流れ";
    out.push({
      title: "レースの流れ",
      cls: "estimate",
      text: `先頭の200mごとのラップ（発走直後を除く）は前半平均${avg(L.slice(0, h)).toFixed(1)}秒、後半平均${avg(L.slice(L.length - h)).toFixed(1)}秒。この距離の平均的な形と比べると、${label}だったとみられる。`,
      informs: [],
      notInformative: [],
    });
  }

  // 7. 条件
  const cond: Finding = { title: "条件", cls: "record", text: "", informs: [], notInformative: [] };
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
  cond.text = `${notes.join("・")}。1戦だけで向き不向きは決められないが、判断材料の一つになる。`;
  out.push(cond);
  return out;
}

/** 自分の最後の1ハロンのタイム（200mごとの通過記録から。距離が200mで割り切れないときは null） */
export function finalFurlong(r: OwnerRaceRecord): number | null {
  const sp = r.telemetry.splits;
  if (r.course.distance % 200 !== 0 || sp.length < 2) return null;
  return Math.round((r.timeMs / 1000 - sp[sp.length - 2]) * 10) / 10;
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
    // 個性を持たない馬に、根拠のない兆候は作らない。
    // ただし実際に行きたがる走りをした（騎手の報告がある）ときは、その事実から兆候と受け取られることがある
    if (trait === "keen") return t.keenSec >= 4 ? 0.5 : 0;
    return 0;
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
