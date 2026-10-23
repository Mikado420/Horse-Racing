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

test("重要事項は要対応 → 確認 → お知らせの順に並ぶ", () => {
  const s = played();
  const tired = { ...s, horses: s.horses.map((h) => ({ ...h, state: { ...h.state, fatigue: 75 } })) };
  const list = todos(tired, buildVM(tired, new Set()));
  assert.equal(list[0].importance, "urgent");
  const order = { urgent: 0, check: 1, normal: 2 } as const;
  for (let i = 1; i < list.length; i++) assert.ok(order[list[i].importance] >= order[list[i - 1].importance]);
});

/* ---------------- UI v4 の表示用データ ---------------- */
import { IMPORTANCE_LABELS, horseRow, planPreview, programOverview, recentEvents } from "../src/owner/vm";
import { POLICY_IDS, entryProblem as _entryProblem, thisWeekCard as _card } from "@owners/shared";

test("UI v4 の表示用データ（愛馬の行・最近の出来事・調教の見込み・番組）に非公開データが含まれない", () => {
  const s = played();
  const vm = buildVM(s, new Set());
  const h = s.horses[0];
  const all = JSON.stringify({
    rows: vm.horses.map((x) => horseRow(s, x.view)),
    events: recentEvents(s, 20, 100),
    plans: POLICY_IDS.map((p) => planPreview(s, h.id, { ...h.policy, policy: p })),
    programs: programOverview(s, vm),
  });
  for (const b of BANNED) assert.ok(!all.includes(b), `${b} が含まれている`);
});

test("重要度の表示は 要対応／確認／お知らせ。新しい見立ては急ぎ扱いしない", () => {
  assert.deepEqual(IMPORTANCE_LABELS, { urgent: "要対応", check: "確認", normal: "お知らせ" });
  const s = played();
  const vm = buildVM(s, new Set());
  for (const t of todos(s, vm)) if (t.id === "found" || t.id === "analysis") assert.equal(t.importance, "normal");
  // 回答できない（前の週以前の）提案だけの報告は「お知らせ」
  const r = s.reports.find((x) => x.lines.some((l) => l.startsWith("提案："))) ?? { ...s.reports[0], lines: ["提案：テスト"], alerts: [], discoveries: [] };
  const old = classifyReport({ ...r, alerts: [], discoveries: [], week: s.week - 5 }, new Set(), s.week);
  assert.equal(old.importance, "normal");
});

test("愛馬の行：近走は記録の着順（新しい順）、適性は見立ての ◎・○ だけ", () => {
  const s = played();
  const vm = buildVM(s, new Set());
  const v = vm.horses[0].view;
  const row = horseRow(s, v);
  assert.deepEqual(row.form, s.races.filter((r) => r.horseId === v.id).slice(0, 5).map((r) => r.position));
  for (const a of row.apt) assert.match(a, /[◎○]$/);
});

test("番組の一覧に載る馬は、出走条件を満たす馬だけ", () => {
  const s = played();
  const vm = buildVM(s, new Set());
  for (const row of programOverview(s, vm)) {
    for (const h of row.horses) assert.equal(_entryProblem(s, s.horses.find((x) => x.id === h.id)!, row.program), null);
  }
  assert.equal(programOverview(s, vm).length, _card(s).length);
});

test("調教の見込みはゲームの規則どおり：疲れていれば休ませ、方針を優先させると押し切る", () => {
  const s = played();
  const h = s.horses[0];
  const tired = { ...s, horses: s.horses.map((x) => (x.id === h.id ? { ...x, racedWeek: null, state: { ...x.state, fatigue: 75, injuryWeeks: 0 } } : x)) };
  const follow = planPreview(tired, h.id, { ...h.policy, policy: "strengthen", mode: "follow" })!;
  assert.equal(follow.adjusted, true);
  assert.equal(follow.label, "休養");
  const insist = planPreview(tired, h.id, { ...h.policy, policy: "strengthen", mode: "insist" })!;
  assert.equal(insist.overridden, true);
});
