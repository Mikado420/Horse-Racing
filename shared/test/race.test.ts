import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_COURSE,
  STARTER_TEMPLATES,
  conditionsFromSeed,
  distancesAt,
  liveOrder,
  marginLabel,
  simulateRace,
  trackPoint,
  formatRaceTime,
  type RaceRunnerInput,
  type RaceConditions,
} from "../src/index";

const GOOD: RaceConditions = { course: DEFAULT_COURSE, going: "good", weather: "sunny" };

function field(n = 6): RaceRunnerInput[] {
  return Array.from({ length: n }, (_, i) => {
    const t = STARTER_TEMPLATES[i % STARTER_TEMPLATES.length];
    return {
      entryId: `e${i}`,
      gate: i + 1,
      stats: { ...t.base },
      style: t.style,
      aptitude: t.aptitude,
      fatigue: 0,
      condition: 0,
    };
  });
}

test("同じシード・同じ入力なら結果は完全に一致する", () => {
  const a = simulateRace(field(), GOOD, 12345);
  const b = simulateRace(field(), GOOD, 12345);
  assert.deepEqual(a, b);
});

test("シードが違えば展開が変わる", () => {
  const a = simulateRace(field(), GOOD, 1);
  const b = simulateRace(field(), GOOD, 2);
  assert.notDeepEqual(a.frames, b.frames);
});

test("全頭がゴールし、着順は1..Nで重複しない", () => {
  for (let n = 2; n <= 8; n++) {
    const r = simulateRace(field(n), GOOD, 100 + n);
    assert.equal(r.results.length, n);
    assert.deepEqual(r.results.map((x) => x.position), Array.from({ length: n }, (_, i) => i + 1));
    assert.equal(new Set(r.results.map((x) => x.entryId)).size, n);
    for (let i = 1; i < n; i++) assert.ok(r.results[i].timeMs >= r.results[i - 1].timeMs);
    // 勝ち時計は現実的な範囲（1600mで1:30〜1:50）
    assert.ok(r.results[0].timeMs > 90_000 && r.results[0].timeMs < 110_000, `${r.results[0].timeMs}`);
    // 最終フレームでは全頭がゴールを越えている
    const last = r.frames[r.frames.length - 1];
    assert.ok(last.every((d) => d >= DEFAULT_COURSE.distance));
  }
});

test("フレームの走行距離は単調増加", () => {
  const r = simulateRace(field(8), GOOD, 9);
  for (let k = 1; k < r.frames.length; k++) {
    r.frames[k].forEach((d, i) => assert.ok(d >= r.frames[k - 1][i]));
  }
});

test("能力が高い馬ほど勝ちやすい", () => {
  const base = field(6);
  let wins = 0;
  for (let s = 1; s <= 200; s++) {
    const strong = { ...base[1], entryId: "strong", stats: { speed: 80, stamina: 75, power: 75, guts: 70, wisdom: 70 } };
    const r = simulateRace([strong, ...base.slice(1)], GOOD, s);
    if (r.results[0].entryId === "strong") wins++;
  }
  assert.ok(wins / 200 > 0.8, `win rate ${wins / 200}`);
});

function winRate(mod: Partial<RaceRunnerInput>, trials = 300): number {
  let wins = 0;
  for (let s = 1; s <= trials; s++) {
    const f: RaceRunnerInput[] = field(2).map((r) => ({ ...r, stats: { ...STARTER_TEMPLATES[1].base }, style: "stalker" as const, aptitude: STARTER_TEMPLATES[1].aptitude }));
    f[0] = { ...f[0], ...mod };
    const r = simulateRace(f, GOOD, s);
    if (r.results[0].entryId === "e0") wins++;
  }
  return wins / trials;
}

test("疲労・調子・適性が結果に反映される（同能力の2頭比較）", () => {
  const even = winRate({});
  assert.ok(even > 0.3 && even < 0.7, `互角なら勝率は五分前後: ${even}`);
  assert.ok(winRate({ fatigue: 70 }) < 0.15, "疲労が大きいと不利");
  assert.ok(winRate({ condition: 2 }) > 0.8, "絶好調は有利");
  assert.ok(winRate({ condition: -2 }) < 0.2, "絶不調は不利");
  const badApt = { ...STARTER_TEMPLATES[1].aptitude, turf: "D" as const };
  assert.ok(winRate({ aptitude: badApt }) < 0.1, "芝適性Dは不利");
});

test("脚質ごとの勝率が極端に偏らない（初期馬3タイプ）", () => {
  const wins: Record<string, number> = {};
  for (let s = 1; s <= 400; s++) {
    const r = simulateRace(field(6), conditionsFromSeed(s, DEFAULT_COURSE), s);
    const idx = Number(r.results[0].entryId.slice(1));
    const id = STARTER_TEMPLATES[idx % 3].id;
    wins[id] = (wins[id] ?? 0) + 1;
  }
  for (const t of STARTER_TEMPLATES) {
    const rate = (wins[t.id] ?? 0) / 400;
    assert.ok(rate > 0.15 && rate < 0.55, `${t.id}: ${rate}`);
  }
});

test("馬場状態と天候はシードで決まる", () => {
  assert.deepEqual(conditionsFromSeed(77, DEFAULT_COURSE), conditionsFromSeed(77, DEFAULT_COURSE));
});

test("コース座標は一周でつながり、継ぎ目で連続している", () => {
  const c = DEFAULT_COURSE;
  const p0 = trackPoint(c, 0);
  const pL = trackPoint(c, c.lapLength);
  assert.ok(Math.abs(p0.x - pL.x) < 1e-6 && Math.abs(p0.z - pL.z) < 1e-6);
  for (let s = 0; s < c.lapLength; s += 0.5) {
    const a = trackPoint(c, s);
    const b = trackPoint(c, s + 0.5);
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    assert.ok(Math.abs(d - 0.5) < 0.01, `s=${s} step=${d}`);
  }
});

test("再生補間と途中順位", () => {
  const frames = [
    [0, 0],
    [10, 20],
  ];
  assert.deepEqual(distancesAt(frames, 1, 0.5), [5, 10]);
  assert.deepEqual(distancesAt(frames, 1, 5), [10, 20]);
  // 1番目(index0)が先にゴール済みなら、距離に関係なく先頭
  assert.deepEqual(liveOrder([1600, 1601], 1600, [0, 1]), [0, 1]);
  assert.deepEqual(liveOrder([500, 600], 1600, [0, 1]), [1, 0]);
});

test("着差とタイムの表記", () => {
  assert.equal(marginLabel(0.1), "ハナ");
  assert.equal(marginLabel(0.4), "クビ");
  assert.equal(marginLabel(1.5), "1 1/2馬身");
  assert.equal(marginLabel(0.75), "3/4馬身");
  assert.equal(marginLabel(12), "大差");
  assert.equal(formatRaceTime(94_321), "1:34.3");
});
