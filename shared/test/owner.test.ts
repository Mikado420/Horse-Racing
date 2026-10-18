// 馬主モード（開発指示書 v1.4）のテスト。17章のテスト要件に沿って並べている。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ABILITY_KEYS,
  DEFAULT_CONFIG,
  KNOWLEDGE_KEYS,
  TRAINERS,
  WEEKS_PER_YEAR,
  addEvidence,
  advanceWeek,
  applyRaceAnalysis,
  applyWeeklyGrowth,
  chooseStarter,
  createRaceHorse,
  createRng,
  distanceFactor,
  emptyKnowledge,
  entryProblem,
  estimate,
  findTrainer,
  makeCourse,
  makeEvidence,
  newOwnerGame,
  raceCard,
  runOwnerRace,
  runStableWeek,
  runTrials,
  simulateOwnerRace,
  thisWeekCard,
  toHorseView,
  truthValue,
  viewEntry,
  withConfig,
  type OwnerProgram,
  type RaceHorse,
  type SimRunner,
  type Trainer,
} from "../src/index";

const W2 = WEEKS_PER_YEAR * 2 + 24; // 3年目7月（ゲーム開始から）

function horse(age: number, week = W2, seed = 1, potMean = 65): RaceHorse {
  return createRaceHorse(
    { id: `h${seed}`, name: "テストホース", ownerId: "me", trainerId: "t1", week, age, quality: { potMean, potSd: 5 }, purchasePrice: 0 },
    createRng(seed),
  );
}

/** n 週ぶん厩舎で過ごさせる */
function weeks(h: RaceHorse, trainer: Trainer, from: number, n: number, seed = 9): RaceHorse {
  const rng = createRng(seed);
  let x = h;
  for (let w = from; w < from + n; w++) x = runStableWeek({ ...x, state: { ...x.state, fatigue: 0, injuryWeeks: 0 } }, trainer, w, rng).horse;
  return x;
}

const T = (id: string) => findTrainer(id)!;
const turfProgram = (distance = 1600): OwnerProgram => ({
  id: "test",
  week: W2,
  name: "テスト戦",
  classId: "maiden",
  course: makeCourse("midorigaoka", "turf", distance),
  going: "good",
  fieldSize: 8,
  firstPrize: 500_000,
  ageMin: 2,
  ageMax: 9,
  conditionText: "",
  named: false,
});

/* ---------------- 情報解明 ---------------- */

test("年齢だけでは能力値が自動公開されない（証拠がなければ何歳でも抽象表現のまま）", () => {
  for (const age of [0, 1, 2, 3, 5]) {
    const v = toHorseView(horse(age), W2);
    for (const k of KNOWLEDGE_KEYS) {
      assert.equal(v.knowledge[k].stage, "abstract", `${age}歳 ${k}`);
      assert.equal(v.knowledge[k].value, null);
      assert.equal(v.knowledge[k].rank, null);
    }
  }
});

test("0〜1歳の牧場での観察だけではランクも数値も出ない", () => {
  const birthWeek = WEEKS_PER_YEAR * 2; // 3年目に生まれた馬
  let h = horse(0, birthWeek, 3);
  h = weeks(h, T("t2"), birthWeek, WEEKS_PER_YEAR * 2 - 1, 4); // 0歳〜1歳の終わりまで
  const v = toHorseView(h, birthWeek + WEEKS_PER_YEAR * 2 - 1);
  const totalEvidence = ABILITY_KEYS.reduce((a, k) => a + h.knowledge.entries[k].evidence.length, 0);
  assert.ok(totalEvidence > 20, "観察は蓄積されている");
  for (const k of ABILITY_KEYS) assert.equal(v.knowledge[k].stage, "abstract", k);
});

test("観察・調教によって情報が蓄積し、2歳以降の調教でランクが判明していく", () => {
  const h0 = horse(2, W2, 5);
  const h = weeks(h0, T("t1"), W2, 20, 6);
  const v0 = toHorseView(h0, W2);
  const v = toHorseView(h, W2 + 20);
  assert.ok(v.knowledge.speed.knowledgeScore > v0.knowledge.speed.knowledgeScore);
  assert.equal(v.knowledge.speed.stage, "rank", "調教時計でスピードのランクが判明");
  assert.notEqual(v.knowledge.speed.stage, "numeric", "実戦なしでは数値は出ない");
  assert.ok(h.log.some((l) => l.kind === "training" && /F/.test(l.detail ?? "")), "調教時計が記録される");
});

test("能力ごとに独立して解明される：スピードが数値まで判明してもスタミナは判明しない", () => {
  const h = horse(3);
  const rng = createRng(11);
  const items = Array.from({ length: 8 }, (_, i) => ({
    key: "speed" as const,
    evidence: makeEvidence(
      { key: "speed", kind: i % 2 ? "raceAnalysis" : "workout", src: i % 2 ? "analysis" : "trainer:t1:work", trueValue: h.truth.abilities.speed, skillScale: 0.7, ref: `r${i}` },
      h.truth.biasSeed,
      W2,
      rng,
    ),
  }));
  const k = addEvidence(h.knowledge, items, W2, "テスト");
  const sp = viewEntry("speed", k.entries.speed, W2);
  const st = viewEntry("stamina", k.entries.stamina, W2);
  assert.equal(sp.stage, "numeric");
  assert.ok(sp.value !== null && Math.abs(sp.value - h.truth.abilities.speed) < 10);
  assert.equal(st.stage, "abstract");
  assert.equal(st.value, null);
  assert.equal(st.comment, "現時点では判断材料が不足している");
});

test("未経験の距離・馬場は「未検証」として扱われる（芝だけ走ってもダートは断定しない）", () => {
  let s = newOwnerGame("テスト", 1);
  s = chooseStarter(s, s.starterOffers![0].offerId, "t1", null);
  // 3歳の芝のレースまで進める
  const id = s.horses[0].id;
  s = { ...s, week: W2, horses: s.horses.map((h) => ({ ...h, birthYear: 0 + 1, state: { ...h.state, fitness: 90 } })) };
  let ran = 0;
  for (let w = 0; w < 30 && ran < 3; w++) {
    const h = s.horses[0];
    const p = thisWeekCard(s).find((x) => x.course.surface === "turf" && !entryProblem(s, h, x));
    if (p) {
      s = runOwnerRace(s, id, p.id, { style: "stalker", pace: "normal", spurt: "normal" }, 100 + w).save;
      s = applyRaceAnalysis(s, s.races[0].raceId).save;
      ran++;
    }
    s = advanceWeek(s, 200 + w).save;
  }
  assert.ok(ran >= 2, `出走できた回数 ${ran}`);
  const v = toHorseView(s.horses[0], s.week);
  assert.equal(v.knowledge.surface_turf.unverified, false);
  assert.equal(v.knowledge.surface_dirt.unverified, true);
  assert.match(v.knowledge.surface_dirt.comment, /^未検証/);
  assert.equal(v.knowledge.going_heavy.unverified || s.races.some((r) => r.going !== "good"), true);
});

test("厩舎の報告には調教師ごとの評価精度が反映される（目利きの方が誤差が小さい）", () => {
  // スピードの評価が得意な t2 と、苦手な t3 で同じ馬たちを見てもらう
  const err = (tid: string) => {
    let sum = 0;
    for (let i = 0; i < 30; i++) {
      const h = weeks(horse(2, W2, 100 + i), T(tid), W2, 16, 300 + i);
      sum += Math.abs((h.knowledge.entries.speed.estimatedValue ?? 50) - h.truth.abilities.speed);
    }
    return sum / 30;
  };
  const good = err("t2");
  const poor = err("t3");
  assert.ok(good < poor, `目利き ${good.toFixed(2)} < 苦手 ${poor.toFixed(2)}`);
});

test("調教師の報告が毎回正解するわけではない（熟練者にも偏りがあり、大きく外れる馬もいる）", () => {
  const errors: number[] = [];
  for (let i = 0; i < 40; i++) {
    const h = weeks(horse(2, W2, 500 + i), T("t1"), W2, 20, 700 + i);
    errors.push((h.knowledge.entries.speed.estimatedValue ?? 50) - h.truth.abilities.speed);
  }
  assert.ok(errors.some((e) => Math.abs(e) >= 3), "見立てが外れる馬がいる");
  assert.ok(errors.some((e) => e > 0) && errors.some((e) => e < 0), "過大評価も過小評価もある");
});

test("プレイヤーの分析で調教師の誤った評価を修正できる", () => {
  // 調教師の偏りが大きくなる馬（種）を探す
  const trainer = T("t3");
  let target: { h: RaceHorse; bias: number } | null = null;
  for (let i = 0; i < 200 && !target; i++) {
    const h = weeks(horse(2, W2, 1000 + i), trainer, W2, 24, 2000 + i);
    const bias = (h.knowledge.entries.speed.estimatedValue ?? 50) - h.truth.abilities.speed;
    if (Math.abs(bias) >= 6) target = { h, bias };
  }
  assert.ok(target, "偏りの大きい見立てが見つかる");
  const { h } = target!;
  const before = Math.abs(target!.bias);
  const rng = createRng(77);
  const items = Array.from({ length: 6 }, () => ({
    key: "speed" as const,
    evidence: makeEvidence({ key: "speed", kind: "raceAnalysis", src: "analysis", trueValue: h.truth.abilities.speed, skillScale: 1 }, h.truth.biasSeed, W2 + 24, rng),
  }));
  const k = addEvidence(h.knowledge, items, W2 + 24, "馬主の分析");
  const after = Math.abs((k.entries.speed.estimatedValue ?? 50) - h.truth.abilities.speed);
  assert.ok(after < before, `誤差 ${before.toFixed(1)} → ${after.toFixed(1)}`);
});

test("情報解明だけでは真の能力値が変化しない", () => {
  let s = newOwnerGame("テスト", 3);
  s = chooseStarter(s, s.starterOffers![1].offerId, "t4", null);
  s = { ...s, week: W2, horses: s.horses.map((h) => ({ ...h, birthYear: 1, state: { ...h.state, fitness: 90 } })) };
  const h = s.horses[0];
  const p = thisWeekCard(s).find((x) => !entryProblem(s, h, x))!;
  s = runOwnerRace(s, h.id, p.id, { style: "stalker", pace: "normal", spurt: "normal" }, 5).save;
  const truthBefore = structuredClone(s.horses[0].truth);
  const knowledgeBefore = structuredClone(s.horses[0].knowledge);
  const out = applyRaceAnalysis(s, s.races[0].raceId);
  assert.deepEqual(out.save.horses[0].truth, truthBefore, "分析は真の値を変えない");
  assert.notDeepEqual(out.save.horses[0].knowledge, knowledgeBefore, "推定は変わる");
  assert.throws(() => applyRaceAnalysis(out.save, s.races[0].raceId), /分析済み/);
  // 証拠の追加そのものも真の値に触れない
  const t2 = structuredClone(out.save.horses[0].truth);
  addEvidence(out.save.horses[0].knowledge, [], W2, "x");
  assert.deepEqual(out.save.horses[0].truth, t2);
});

test("能力成長による変化と推定修正による変化を区別できる", () => {
  const h = horse(2, W2, 42);
  // 成長：真の値と成長記録だけが変わり、推定（knowledge）は変わらない
  let truth = h.truth;
  for (let w = W2; w < W2 + 24; w++) truth = applyWeeklyGrowth(truth, w, w - (h.birthYear - 1) * WEEKS_PER_YEAR, { quality: { speed: 1, stamina: 1 } });
  assert.ok(truth.abilities.speed > h.truth.abilities.speed, "成長した");
  assert.ok(truth.growthLog.length > 0, "成長の記録が残る");
  assert.equal(h.knowledge.events.length, 0, "成長だけでは推定の履歴は増えない");

  // 推定修正：高めの見立てのあとに実戦の証拠が入ると「下方修正」として記録される（真の値は不変）
  const rng = createRng(3);
  const high = Array.from({ length: 6 }, (_, i) => ({
    key: "speed" as const,
    evidence: { w: W2, src: `trainer:x${i}`, k: "trainerObservation" as const, v: h.truth.abilities.speed + 25, q: 4, b: 2 },
  }));
  let k = addEvidence(emptyKnowledge(), high, W2, "強気な見立て");
  const firstRank = viewEntry("speed", k.entries.speed, W2).rank;
  const real = Array.from({ length: 6 }, (_, i) => ({
    key: "speed" as const,
    evidence: makeEvidence({ key: "speed", kind: "raceAnalysis", src: "analysis", trueValue: h.truth.abilities.speed, skillScale: 1, ref: `r${i}` }, h.truth.biasSeed, W2, rng),
  }));
  k = addEvidence(k, real, W2, "馬主の分析");
  const revise = k.events.find((e) => e.type === "revise");
  assert.ok(firstRank, "最初の見立てでランクが出ている");
  assert.ok(revise && /下方修正/.test(revise.text) && /能力そのものの変化ではありません/.test(revise.text), JSON.stringify(k.events));
});

test("古い証拠ほど信頼度が下がる（成長して昔の観察がずれていく）", () => {
  const ev = [{ w: 0, src: "a", k: "workout" as const, v: 60, q: 5, b: 2 }];
  const now = estimate(ev, 0);
  const later = estimate(ev, 40);
  assert.ok(later.uncertainty > now.uncertainty);
});

test("数値の開示には複数のレースが必要（1レースの調教師評と分析は1回として数える）", () => {
  let s = newOwnerGame("テスト", 11);
  s = chooseStarter(s, s.starterOffers![0].offerId, "t2", null);
  s = { ...s, week: W2, horses: s.horses.map((h) => ({ ...h, birthYear: 1, state: { ...h.state, fitness: 90 } })) };
  for (let i = 0; i < 6; i++) s = advanceWeek(s, 50 + i).save; // 調教時計を積む
  const h = s.horses[0];
  const p = thisWeekCard(s).find((x) => !entryProblem(s, h, x))!;
  s = runOwnerRace(s, h.id, p.id, { style: "stalker", pace: "normal", spurt: "normal" }, 9).save;
  s = applyRaceAnalysis(s, s.races[0].raceId).save;
  const v = toHorseView(s.horses[0], s.week);
  for (const k of ABILITY_KEYS) assert.notEqual(v.knowledge[k].stage, "numeric", k);
});

test("数値公開条件は設定ファイルから調整できる", () => {
  const h = horse(3, W2, 8);
  const rng = createRng(1);
  const items = [0, 1].map(() => ({
    key: "speed" as const,
    evidence: makeEvidence({ key: "speed", kind: "workout", src: "trainer:t1:work", trueValue: h.truth.abilities.speed, skillScale: 0.6 }, h.truth.biasSeed, W2, rng),
  }));
  const strict = addEvidence(h.knowledge, items, W2, "x");
  assert.notEqual(viewEntry("speed", strict.entries.speed, W2).stage, "numeric");
  const loose = withConfig({ disclosure: { numericSd: 15, numericMinMeasured: 1, numericMinRace: 0 } });
  const k = addEvidence(h.knowledge, items, W2, "x", loose);
  assert.equal(viewEntry("speed", k.entries.speed, W2, loose).stage, "numeric");
  // ランクの境界も設定で変えられる
  const allS = withConfig({ rankBands: [{ rank: "S", min: 0 }] });
  const kr = addEvidence(h.knowledge, items, W2, "x", allS);
  assert.equal(viewEntry("speed", kr.entries.speed, W2, allS).rank, "S");
  assert.equal(DEFAULT_CONFIG.rankBands[0].min, 90);
});

test("馬主に見せるデータに真の能力値・成長上限・偏りの種が含まれない", () => {
  let s = newOwnerGame("テスト", 4);
  s = chooseStarter(s, s.starterOffers![0].offerId, "t1", null);
  for (let i = 0; i < 10; i++) s = advanceWeek(s, i).save;
  const view = toHorseView(s.horses[0], s.week);
  const json = JSON.stringify(view);
  for (const banned of ["truth", "potential", "biasSeed", "growthType", "development", "evidence", "trueValue"]) {
    assert.ok(!json.includes(`"${banned}"`), `${banned} が含まれている`);
  }
  // 抽象表現の段階では推定値そのものも出さない
  for (const k of KNOWLEDGE_KEYS) if (view.knowledge[k].stage === "abstract") assert.equal(view.knowledge[k].value, null);
});

/* ---------------- 厩舎・育成方針 ---------------- */

test("育成方針は調教師の判断で調整され、方針を優先させると関係が悪化しうる", () => {
  const h0 = horse(3, W2, 21);
  const tired = { ...h0, state: { ...h0.state, fatigue: 60 }, policy: { ...h0.policy, policy: "strengthen" as const, mode: "follow" as const } };
  const follow = runStableWeek(tired, T("t1"), W2, createRng(1));
  assert.notEqual(follow.report.plan, "hard", "疲れているので調教師は負荷を下げる");
  const insist = runStableWeek({ ...tired, policy: { ...tired.policy, mode: "insist" } }, T("t1"), W2, createRng(1));
  assert.equal(insist.report.plan, "hard");
  assert.ok(insist.horse.relationship < tired.relationship);
  assert.ok(insist.report.alerts.some((a) => /懸念/.test(a)));
});

test("疲労と健康は別々に管理され、休養で疲労が抜ける", () => {
  const h0 = horse(3, W2, 22);
  const tired = { ...h0, state: { ...h0.state, fatigue: 80, health: 70 }, policy: { ...h0.policy, policy: "recovery" as const } };
  const r = runStableWeek(tired, T("t1"), W2, createRng(2));
  assert.ok(r.horse.state.fatigue < 80);
  assert.ok(r.horse.state.health >= 70);
});

test("週を進めると預託料がかかり、報告が届く", () => {
  let s = newOwnerGame("テスト", 5);
  s = chooseStarter(s, s.starterOffers![2].offerId, "t2", "ハルノテスト");
  assert.equal(s.horses[0].name, "ハルノテスト");
  const money0 = s.player.money;
  const r = advanceWeek(s, 1);
  assert.ok(r.save.player.money < money0);
  assert.equal(r.reports.length, 1);
  assert.equal(r.save.week, 1);
  assert.ok(r.reports[0].lines.length > 0);
});

test("1歳馬はレースに出られない（年齢による出走条件）", () => {
  let s = newOwnerGame("テスト", 6);
  s = chooseStarter(s, s.starterOffers![0].offerId, "t1", null);
  const h = s.horses[0];
  for (const p of thisWeekCard(s)) assert.match(entryProblem(s, h, p) ?? "", /歳/);
});

/* ---------------- レース ---------------- */

function runner(id: string, gate: number, lvl = 60, extra: Partial<SimRunner> = {}): SimRunner {
  const abilities = Object.fromEntries(ABILITY_KEYS.map((k) => [k, lvl])) as SimRunner["abilities"];
  return {
    id,
    gate,
    abilities,
    aptitude: { distanceMin: 1400, distanceMax: 2000, turf: 75, dirt: 60, heavy: 50, right: 60, left: 60, slope: 50, tight: 50, styles: { front: 70, stalker: 80, closer: 70, deep: 60 } },
    traits: [],
    tactics: { style: "stalker", pace: "normal", spurt: "normal" },
    condition: 0,
    fatigue: 10,
    fitness: 85,
    experience: 4,
    ...extra,
  };
}
const field = (n = 8) => Array.from({ length: n }, (_, i) => runner(`r${i}`, i + 1, 55 + (i % 3) * 3, { tactics: { style: (["front", "stalker", "closer", "deep"] as const)[i % 4], pace: "normal", spurt: "normal" } }));

test("同じ入力と乱数シードでレース結果を再現できる", () => {
  const cond = { course: makeCourse("midorigaoka", "turf", 2000), going: "good" as const };
  const a = simulateOwnerRace(field(), cond, 123);
  const b = simulateOwnerRace(field(), cond, 123);
  assert.deepEqual(a, b);
  const c = simulateOwnerRace(field(), cond, 124);
  assert.notDeepEqual(a.frames, c.frames);
});

test("着順はゴール通過時刻で決まり、全頭がゴールする（全コースで異常な挙動がない）", () => {
  const courses = [...new Set(Array.from({ length: 48 }, (_, w) => raceCard(w)).flat().map((p) => p.course.id))];
  for (const id of courses) {
    const [track, surface, dist] = id.split("-");
    const cond = { course: makeCourse(track, surface as "turf" | "dirt", Number(dist)), going: "soft" as const };
    const r = simulateOwnerRace(field(), cond, 7);
    assert.deepEqual(r.results.map((x) => x.position), [1, 2, 3, 4, 5, 6, 7, 8]);
    for (let i = 1; i < 8; i++) assert.ok(r.results[i].timeMs >= r.results[i - 1].timeMs);
    for (const res of r.results) {
      assert.ok(Number.isFinite(res.timeMs) && res.timeMs < 300_000, `${id} ${res.timeMs}`);
      const tel = r.telemetry[res.id];
      assert.equal(tel.splits.length, Math.floor(Number(dist) / 200));
      assert.ok(tel.last600 > 25 && tel.last600 < 60, `${id} 上がり ${tel.last600}`);
    }
    // 勝ち時計は現実的な範囲（1mあたり 0.055〜0.075 秒）
    const perM = r.results[0].timeMs / 1000 / Number(dist);
    assert.ok(perM > 0.055 && perM < 0.075, `${id} ${perM}`);
    // フレームは単調増加
    for (let k = 1; k < r.frames.length; k++) r.frames[k].forEach((d, i) => assert.ok(d >= r.frames[k - 1][i] - 1e-9));
  }
});

test("能力差が勝率・平均着順に反映される（数百回の自動実行）", () => {
  const p = turfProgram(1600);
  const base = runner("x", 1).aptitude;
  const stats = [45, 55, 65, 75].map((lvl) =>
    runTrials({ abilities: Object.fromEntries(ABILITY_KEYS.map((k) => [k, lvl])) as SimRunner["abilities"], aptitude: base, traits: [], tactics: { style: "stalker", pace: "normal", spurt: "normal" }, condition: 0, fatigue: 10, fitness: 85, experience: 4 }, p, 200, 1),
  );
  for (let i = 1; i < stats.length; i++) {
    assert.ok(stats[i].winRate >= stats[i - 1].winRate, JSON.stringify(stats));
    assert.ok(stats[i].avgPosition < stats[i - 1].avgPosition, JSON.stringify(stats));
  }
  assert.ok(stats[3].winRate > 0.6 && stats[0].winRate < 0.15, JSON.stringify(stats));
});

test("距離適性が結果に影響する（適性外の距離では勝率が下がる）", () => {
  const p = turfProgram(2400);
  const r = runner("x", 1, 62);
  const fit = runTrials({ ...r, aptitude: { ...r.aptitude, distanceMin: 2200, distanceMax: 2600 } }, p, 250, 3);
  const off = runTrials({ ...r, aptitude: { ...r.aptitude, distanceMin: 1200, distanceMax: 1600 } }, p, 250, 3);
  assert.ok(fit.winRate > off.winRate + 0.1, `${fit.winRate} vs ${off.winRate}`);
  assert.equal(distanceFactor({ distanceMin: 1200, distanceMax: 1600 }, 2400), 0.5);
  assert.equal(distanceFactor({ distanceMin: 1200, distanceMax: 1600 }, 1700), 0.9);
  assert.equal(distanceFactor({ distanceMin: 1200, distanceMax: 1600 }, 1000), 0.8);
  assert.equal(distanceFactor({ distanceMin: 1200, distanceMax: 1600 }, 1400), 1.0);
});

test("芝・ダート適性と個性・作戦が結果に影響する", () => {
  const p = turfProgram(1600);
  const r = runner("x", 1, 60);
  const turfFit = runTrials({ ...r, aptitude: { ...r.aptitude, turf: 95 } }, p, 250, 5);
  const turfBad = runTrials({ ...r, aptitude: { ...r.aptitude, turf: 5 } }, p, 250, 5);
  assert.ok(turfFit.winRate > turfBad.winRate, `芝 ${turfFit.winRate} vs ${turfBad.winRate}`);

  // 行きたがる馬は道中で消耗する
  const cond = { course: p.course, going: "good" as const };
  let keenSec = 0;
  let calmSec = 0;
  for (let s = 0; s < 40; s++) {
    const keen = simulateOwnerRace([runner("k", 1, 60, { traits: ["keen"], tactics: { style: "closer", pace: "normal", spurt: "normal" } }), ...field(7).map((x, i) => ({ ...x, gate: i + 2 }))], cond, s);
    const calm = simulateOwnerRace([runner("k", 1, 60, { traits: ["calm"], tactics: { style: "closer", pace: "normal", spurt: "normal" } }), ...field(7).map((x, i) => ({ ...x, gate: i + 2 }))], cond, s);
    keenSec += keen.telemetry.k.keenSec;
    calmSec += calm.telemetry.k.keenSec;
  }
  assert.ok(keenSec > calmSec * 3 + 10, `${keenSec} vs ${calmSec}`);

  // 脚質の作戦で位置取りが変わる
  const front = simulateOwnerRace([runner("m", 1, 60, { tactics: { style: "front", pace: "aggressive", spurt: "normal" } }), ...field(7).map((x, i) => ({ ...x, gate: i + 2 }))], cond, 9);
  const deep = simulateOwnerRace([runner("m", 1, 60, { tactics: { style: "deep", pace: "easy", spurt: "late" } }), ...field(7).map((x, i) => ({ ...x, gate: i + 2 }))], cond, 9);
  const earlyPos = (r: typeof front) => r.telemetry.m.positions[0].pos;
  assert.ok(earlyPos(front) < earlyPos(deep), `${earlyPos(front)} vs ${earlyPos(deep)}`);
});

test("出走すると賞金・戦績が保存され、調教師のレース評で推定が更新される", () => {
  let s = newOwnerGame("テスト", 8);
  s = chooseStarter(s, s.starterOffers![0].offerId, "t5", null);
  s = { ...s, week: W2, horses: s.horses.map((h) => ({ ...h, birthYear: 1, state: { ...h.state, fitness: 90 } })) };
  const h = s.horses[0];
  const p = thisWeekCard(s).find((x) => !entryProblem(s, h, x))!;
  const out = runOwnerRace(s, h.id, p.id, { style: "closer", pace: "normal", spurt: "late" }, 3);
  const after = out.save.horses[0];
  assert.equal(after.record.races, 1);
  assert.equal(out.save.races.length, 1);
  assert.equal(out.save.player.money, s.player.money + out.record.prize);
  assert.ok(after.knowledge.entries.speed.evidence.some((e) => e.k === "raceTrainer"));
  assert.equal(entryProblem(out.save, after, p), "今週はすでに出走しました");
  assert.equal(out.replay.frames[0].length, 8);
  assert.equal(out.replay.lanes.length, out.replay.frames.length);
  assert.ok(out.record.trainerComment.includes("調教師"));
});

test("真の値と観測のもとになる値の対応（適性の距離帯）", () => {
  const h = horse(3);
  const band = truthValue(h.truth, "dist_mile");
  assert.ok(band >= 0 && band <= 100);
  assert.equal(TRAINERS.length >= 5, true);
});

/* ---------------- 通しの自動プレイ ---------------- */
import { playOwner } from "./ownerBot";

test("自動プレイで3年進めても破綻せず、数値まで判明した能力は真の値に近い", () => {
  let numeric = 0;
  let close = 0;
  for (const seed of [1, 2, 3]) {
    const r = playOwner(seed, WEEKS_PER_YEAR * 3);
    assert.ok(r.races >= 20, `出走数 ${r.races}`);
    assert.ok(Number.isFinite(r.save.player.money));
    assert.ok(JSON.stringify(r.save).length < 2_000_000, "セーブの大きさ");
    for (const h of r.save.horses) {
      const v = toHorseView(h, r.save.week);
      for (const k of ABILITY_KEYS) {
        if (v.knowledge[k].stage !== "numeric") continue;
        numeric++;
        if (Math.abs(v.knowledge[k].value! - h.truth.abilities[k]) <= 6) close++;
      }
    }
  }
  assert.ok(numeric >= 10, `数値まで判明した能力 ${numeric}`);
  assert.ok(close / numeric >= 0.85, `真の値に近い割合 ${close}/${numeric}`);
});
