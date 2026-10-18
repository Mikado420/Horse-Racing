// 画面に渡す表示用データ（ビューモデル）に、非公開の内部情報が含まれないこと（指示書 v2.0 14.5・16章）
import { test } from "node:test";
import assert from "node:assert/strict";
import { WEEKS_PER_YEAR, advanceWeek, applyRaceAnalysis, chooseStarter, entryProblem, newOwnerGame, runOwnerRace, thisWeekCard } from "@owners/shared";
import { buildVM, entryOptions, marketVM, todos, classifyReport, reportId } from "../src/owner/vm";

function played() {
  let s = newOwnerGame("テスト", 21);
  s = chooseStarter(s, s.starterOffers![0].offerId, "t2", null);
  s = { ...s, week: WEEKS_PER_YEAR * 2 + 24, horses: s.horses.map((h) => ({ ...h, birthYear: 1, state: { ...h.state, fitness: 90 } })) };
  for (let i = 0; i < 4; i++) s = advanceWeek(s, i + 1).save;
  const h = s.horses[0];
  const p = thisWeekCard(s).find((x) => !entryProblem(s, h, x))!;
  s = runOwnerRace(s, h.id, p.id, { style: "stalker", pace: "normal", spurt: "normal" }, 7).save;
  s = applyRaceAnalysis(s, s.races[0].raceId).save;
  return s;
}

const BANNED = ['"truth"', '"potential"', '"biasSeed"', '"growthType"', '"development"', '"evidence"', '"growthLog"', '"traits":["'];

test("ビューモデル（所有馬・報告・出走候補・販売馬・重要事項）に非公開データが含まれない", () => {
  const s = played();
  const vm = buildVM(s, new Set());
  const all = JSON.stringify({ vm, entry: entryOptions(s, s.horses[0].id), market: marketVM(s), todos: todos(s, vm) });
  for (const b of BANNED) assert.ok(!all.includes(b), `${b} が含まれている`);
  // 真の能力値そのもの（小数を含む内部値）が数値として出ていない
  const truth = s.horses[0].truth.abilities;
  for (const v of Object.values(truth)) if (!Number.isInteger(v)) assert.ok(!all.includes(String(v)), `真の値 ${v} が含まれている`);
});

test("報告の重要度と未確認の判定", () => {
  const s = played();
  const r = s.reports[0];
  const unread = classifyReport(r, new Set(), s.week);
  const read = classifyReport(r, new Set([reportId(r)]), s.week);
  assert.equal(unread.unread, true);
  assert.equal(read.unread, false);
  const injured = classifyReport({ ...r, alerts: ["調教中に脚元を痛めました。"] }, new Set(), s.week);
  assert.equal(injured.importance, "urgent");
  assert.equal(injured.kind, "injury");
});

test("重要事項は緊急 → 要確認 → 通常の順に並ぶ", () => {
  const s = played();
  const tired = { ...s, horses: s.horses.map((h) => ({ ...h, state: { ...h.state, fatigue: 75 } })) };
  const list = todos(tired, buildVM(tired, new Set()));
  assert.equal(list[0].importance, "urgent");
  const order = { urgent: 0, check: 1, normal: 2 } as const;
  for (let i = 1; i < list.length; i++) assert.ok(order[list[i].importance] >= order[list[i - 1].importance]);
});
