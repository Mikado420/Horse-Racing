// レース後の報告と調教師コメントのテスト（実装指示書「分析システムの現実化・全面再設計」8章）
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANALYSIS_RULES,
  FORBIDDEN_PATTERNS,
  LAP_TOLERANCE_SEC,
  WEEKS_PER_YEAR,
  analyzeRace,
  buildRaceReport,
  checkReport,
  chooseStarter,
  composeTrainerComment,
  createRaceHorse,
  createRng,
  findTrainer,
  generateCpuEntries,
  newOwnerGame,
  raceCard,
  raceFacts,
  raceLaps,
  raceTraitEvidence,
  runOwnerRace,
  runStableWeek,
  simulateOwnerRace,
  thisWeekCard,
  entryProblem,
  type OwnerRaceRecord,
  type RaceHorse,
  type SimRunner,
} from "../src/index";
import { playOwner } from "./ownerBot";

/* ---------------- 共通：自動プレイで実際のレース記録を集める ---------------- */

let corpus: { races: OwnerRaceRecord[] }[] | null = null;
function races(): { rec: OwnerRaceRecord; all: OwnerRaceRecord[] }[] {
  corpus ??= [21, 22, 23].map((seed) => ({ races: playOwner(seed, WEEKS_PER_YEAR * 3).save.races }));
  return corpus.flatMap((c) => c.races.map((rec) => ({ rec, all: c.races })));
}

function oneRace(): OwnerRaceRecord {
  const s0 = newOwnerGame("テスト", 4);
  let s = chooseStarter(s0, s0.starterOffers![0].offerId, "t4", null);
  const W = WEEKS_PER_YEAR * 2 + 24;
  s = { ...s, week: W, horses: s.horses.map((h) => ({ ...h, birthYear: 1, state: { ...h.state, fitness: 90, fatigue: 0 } })) };
  const h = s.horses[0];
  const p = thisWeekCard(s).find((x) => !entryProblem(s, h, x))!;
  return runOwnerRace(s, h.id, p.id, { style: "closer", pace: "normal", spurt: "normal" }, 7).record;
}

/** 記録の一部だけを差し替えた記録を作る */
function withTelemetry(r: OwnerRaceRecord, patch: Partial<OwnerRaceRecord["telemetry"]>, rest: Partial<OwnerRaceRecord> = {}): OwnerRaceRecord {
  return { ...r, ...rest, telemetry: { ...r.telemetry, ...patch } };
}

/* ---------------- コメントの整合性 ---------------- */

test("同じレース記録からは、毎回まったく同じ報告とコメントができる（ランダムな誤情報が出ない）", () => {
  for (const { rec, all } of races().slice(0, 60)) {
    const a = buildRaceReport(rec, all);
    const b = buildRaceReport(structuredClone(rec), structuredClone(all));
    assert.deepEqual(a, b);
    assert.equal(composeTrainerComment(a, "宮森 千鶴").text, composeTrainerComment(b, "宮森 千鶴").text);
  }
});

test("自動プレイの全レースで、報告とコメントが記録と矛盾せず、禁止表現を含まない", () => {
  const all = races();
  assert.ok(all.length >= 100, `レース数 ${all.length}`);
  for (const { rec, all: hist } of all) {
    const rep = buildRaceReport(rec, hist);
    const c = composeTrainerComment(rep, "七尾 透");
    assert.deepEqual(checkReport(rec, rep, c), [], `${rec.raceId}: ${c.text}`);
    // 保存されたコメントも同じ規則で作られている
    assert.equal(rec.trainerComment, composeTrainerComment(buildRaceReport(rec, hist.filter((x) => x.horseId === rec.horseId)), findTrainer(rec.trainerId)!.name).text);
  }
});

test("コメントで触れた出来事は、すべて記録で確かめられる", () => {
  const R = ANALYSIS_RULES;
  for (const { rec, all } of races()) {
    const rep = buildRaceReport(rec, all);
    const f = raceFacts(rec);
    const t = rec.telemetry;
    for (const p of composeTrainerComment(rep, "柏木 誠一").parts) {
      const holds: Record<string, boolean> = {
        blocked: t.blockedSec >= R.blockedSec,
        keen: t.keenSec >= R.keenSec,
        wide: t.extraMeters >= R.wideMeters,
        start_slow: t.startDelay >= R.slowStartSec,
        late_gain: (f.lateChange ?? 0) >= R.lateMove,
        late_loss: (f.lateChange ?? 0) <= -R.lateMove,
        last3f_top: f.last3FRank === 1,
        duel_won: t.duel.occurred && t.duel.gained,
        duel_lost: t.duel.occurred && !t.duel.gained,
        pace_fast: f.pace === "fast",
        pace_slow: f.pace === "slow",
        style_vs_plan: f.earlyGroup !== rec.tactics.style,
      };
      if (p.ref in holds) assert.ok(holds[p.ref], `${rec.raceId} ${p.ref}: ${p.text}`);
      if (p.ref === "open") {
        if (rec.position === 1) assert.match(p.text, /頑張|勝ち切/);
        else assert.doesNotMatch(p.text, /勝ち切|頑張ってくれ/);
        // 「上位争い」と言うのは、2・3着で勝ち馬との差が小さいときだけ
        if (/上位/.test(p.text)) assert.ok(rec.position <= 3 && Math.abs(rec.marginToWinner) <= R.contendMargin, `${rec.raceId}: ${p.text}（${rec.position}着・${rec.marginToWinner}馬身）`);
      }
      // 記録に問題がないのに「スムーズに運べたら」のような前提を置かない
      if (p.ref === "s_retry") assert.ok(rep.assessments.some((a) => a.id === "a_blocked" || a.id === "a_wide"), `${rec.raceId}: ${p.text}`);
    }
  }
});

test("勝ったレースでは敗因を推定せず、負けて根拠がなければ「特定できない」と言う", () => {
  let wins = 0;
  let unknown = 0;
  for (const { rec, all } of races()) {
    const rep = buildRaceReport(rec, all);
    if (rec.position === 1) {
      wins++;
      assert.equal(rep.assessments.length, 0);
      assert.equal(rep.undetermined, false);
    }
    if (rep.undetermined) {
      unknown++;
      assert.ok(rec.position > 3);
      assert.equal(rep.assessments.length, 1);
      assert.match(rep.assessments[0].text, /特定できません/);
      assert.match(composeTrainerComment(rep, "新堂 隼人").text, /特定できません|はっきりしません/);
    }
  }
  assert.ok(wins > 0 && unknown > 0, `勝ち ${wins}／原因不明 ${unknown}`);
});

test("推定には必ず根拠となる観察があり、提案は推定（または原因不明）に結び付いている", () => {
  for (const { rec, all } of races()) {
    const rep = buildRaceReport(rec, all);
    const obs = new Set(rep.observations.map((o) => o.id));
    for (const a of rep.assessments) {
      assert.ok(a.basis.length > 0, a.id);
      if (a.id !== "u_unknown") assert.ok(a.basis.some((b) => obs.has(b)), `${a.id} の根拠に観察がない`);
      assert.match(a.text, /可能性|余地|特定できません/, `推定が断定になっている: ${a.text}`);
    }
    for (const s of rep.suggestions) assert.doesNotMatch(s.text, /必ず|改善します|勝てます/);
    assert.ok(rep.observations.length >= 1);
  }
});

test("過去のレースと比べる推定は、このレースより前の同じ馬のレースだけを根拠にする", () => {
  for (const { rec, all } of races()) {
    for (const a of buildRaceReport(rec, all).assessments) {
      for (const b of a.basis.filter((x) => x.startsWith("history:"))) {
        const past = all.find((x) => x.raceId === b.slice(8))!;
        assert.equal(past.horseId, rec.horseId);
        assert.ok(past.week < rec.week);
      }
    }
  }
});

test("言い回しを変えても、述べる内容（どの項目に触れるか）は変わらない", () => {
  for (const { rec, all } of races().slice(0, 80)) {
    const rep = buildRaceReport(rec, all);
    const refs = composeTrainerComment(rep, "早瀬 美咲", "a").parts.map((p) => p.ref);
    for (const seed of ["b", "c", "d", "e"]) {
      const c = composeTrainerComment(rep, "早瀬 美咲", seed);
      assert.deepEqual(c.parts.map((p) => p.ref), refs);
      assert.deepEqual(checkReport(rec, rep, c), []);
    }
  }
});

test("内部のエネルギー残量だけでは、報告もコメントも変わらない（スタミナ切れを断定しない）", () => {
  const r = oneRace();
  const a = buildRaceReport(withTelemetry(r, { emptyRemain: null }));
  const b = buildRaceReport(withTelemetry(r, { emptyRemain: 350 }));
  assert.deepEqual(a, b);
  const text = composeTrainerComment(b, "柏木 誠一").text;
  assert.doesNotMatch(text, /スタミナ|エネルギー|脚が上が/);
  for (const f of analyzeRace(withTelemetry(r, { emptyRemain: 350 }))) assert.doesNotMatch(f.text, /エネルギー|脚が上が|m\/秒/);
});

test("記録されていない不利や出来事を述べない（前が壁になった時間が短ければ触れない）", () => {
  const r = oneRace();
  const quiet = withTelemetry(r, { blockedSec: 0, keenSec: 0, extraMeters: 0, startDelay: 0, duel: { occurred: false, gained: false } });
  const rep = buildRaceReport(quiet);
  const ids = rep.observations.map((o) => o.id);
  for (const id of ["blocked", "keen", "wide", "start_slow", "duel_won", "duel_lost"]) assert.ok(!ids.includes(id), id);
  const c = composeTrainerComment(rep, "柏木 誠一").text;
  assert.doesNotMatch(c, /壁|詰ま|行きたが|外を回|後手|遅れ|競り合/);
  // 前が壁になった場面があれば観察として述べるが、場所（直線）は言わない
  const blocked = buildRaceReport(withTelemetry(r, { blockedSec: 5 }));
  const item = blocked.observations.find((o) => o.id === "blocked")!;
  assert.ok(item);
  assert.doesNotMatch(item.text, /直線/);
});

test("負けて目立った出来事がない記録では、原因を特定できないと答える", () => {
  const r = oneRace();
  const plain = withTelemetry(
    r,
    { blockedSec: 0, keenSec: 0, extraMeters: 0, startDelay: 0, duel: { occurred: false, gained: false }, positions: [
      { label: "序盤", remain: r.course.distance - 400, pos: 4 },
      { label: "残り400m", remain: 400, pos: 5 },
      { label: "ゴール", remain: 0, pos: 5 },
    ] },
    { position: 5, marginToWinner: 3 },
  );
  const field = r.field.map((f) => ({ ...f, last600: f.isMine ? 35.5 : 35.5 + (f.gate % 3) * 0.01 }));
  const rep = buildRaceReport({ ...plain, field });
  assert.equal(rep.undetermined, true);
  assert.deepEqual(rep.assessments.map((a) => a.id), ["u_unknown"]);
  assert.match(composeTrainerComment(rep, "大門 剛").text, /特定できません|はっきりしません/);
});

test("データが足りない記録でも、架空の数値や断定を作らない", () => {
  const r = oneRace();
  const thin = withTelemetry(r, { positions: [], splits: [], spurtRemain: null }, { leaderLaps: [] });
  const rep = buildRaceReport(thin);
  assert.equal(rep.facts.earlyPos, null);
  assert.equal(rep.facts.earlyGroup, null);
  assert.equal(rep.facts.lateChange, null);
  assert.equal(rep.facts.pace, null);
  assert.deepEqual(checkReport(thin, rep, composeTrainerComment(rep, "七尾 透")), []);
  assert.ok(!rep.observations.some((o) => /番手|流れ|頭をかわ|先を越/.test(o.text)));
});

/* ---------------- 表示データの整合性 ---------------- */

test("報告（プレイヤー向けのデータ）に内部の数値が含まれない", () => {
  const internal = ["cruiseSpeed", "topSpeedLate", "lastSegSpeed", "emptyRemain", "energy", "blockedSec", "extraMeters", "keenSec", "crowdedSec", "startDelay", "spurtRemain", "abilities", "truth"];
  for (const { rec, all } of races().slice(0, 50)) {
    const rep = buildRaceReport(rec, all);
    const json = JSON.stringify(rep);
    for (const k of internal) assert.ok(!json.includes(`"${k}"`), `報告に ${k} が含まれる`);
    for (const t of [...rep.observations, ...rep.assessments, ...rep.suggestions].map((i) => i.text)) {
      assert.doesNotMatch(t, /m\/秒|秒間|\d+(\.\d+)?秒(ほど|あり)|約\d+m余分/);
      for (const re of FORBIDDEN_PATTERNS) assert.doesNotMatch(t, re);
    }
    for (const f of analyzeRace(rec)) assert.doesNotMatch(f.text, /m\/秒|エネルギー|脚が上が|秒ほど行きたが|m余分/);
  }
});

test("レースラップの合計は勝ち時計と一致する（200mの倍数でない距離も含む）", () => {
  const distances = new Set<number>();
  for (const w of [60, 75, 90, 105, 120]) {
    for (const p of raceCard(w)) {
      const cpus = generateCpuEntries(p, 8, w * 11 + p.course.distance);
      const runners: SimRunner[] = cpus.map((c, i) => ({ ...c.runner, gate: i + 1 }));
      const sim = simulateOwnerRace(runners, { course: p.course, going: p.going }, w * 17);
      const field = sim.results.map((r) => ({ gate: r.gate, name: r.id, isMine: false, position: r.position, timeMs: r.timeMs, marginLengths: r.marginLengths, last600: sim.telemetry[r.id].last600, styleShown: sim.telemetry[r.id].styleShown }));
      const laps = raceLaps({ leaderLaps: sim.leaderLaps, course: p.course, field });
      const sum = laps.reduce((a, l) => a + l.sec, 0);
      assert.ok(Math.abs(sum - sim.results[0].timeMs / 1000) <= LAP_TOLERANCE_SEC, `${p.course.distance}m: ${sum} vs ${sim.results[0].timeMs}`);
      assert.equal(laps[laps.length - 1].to, p.course.distance);
      assert.equal(laps.reduce((a, l) => a + (l.to - l.from), 0), p.course.distance);
      for (const l of laps) assert.ok(l.sec > 0, "区間タイムは正");
      distances.add(p.course.distance);
    }
  }
  assert.ok([...distances].some((d) => d % 200 !== 0), "200mの倍数でない距離を含む");
});

test("上がり3F・通過順・着順が、ゴール通過時刻と矛盾しない", () => {
  for (const w of [60, 90]) {
    for (const p of raceCard(w)) {
      const cpus = generateCpuEntries(p, 8, w * 5 + 1);
      const runners: SimRunner[] = cpus.map((c, i) => ({ ...c.runner, gate: i + 1 }));
      const sim = simulateOwnerRace(runners, { course: p.course, going: p.going }, w * 3 + 2);
      const D = p.course.distance;
      // 着順はタイム順
      for (let i = 1; i < sim.results.length; i++) assert.ok(sim.results[i].timeMs >= sim.results[i - 1].timeMs);
      for (const res of sim.results) {
        const tel = sim.telemetry[res.id];
        // ゴールの通過順＝着順
        assert.equal(tel.positions.find((x) => x.remain === 0)!.pos, res.position);
        // 上がり3F は走破タイムより短く、200mの倍数の距離では自分の最後の3区間の合計と一致する
        assert.ok(tel.last600 > 0 && tel.last600 < res.timeMs / 1000);
        if (D % 200 === 0) {
          const s = tel.splits;
          const last3 = s[s.length - 1] - s[s.length - 4];
          assert.ok(Math.abs(last3 - tel.last600) <= 0.03, `${D}m 上がり ${tel.last600} vs 区間 ${last3}`);
          assert.ok(Math.abs(s[s.length - 1] - res.timeMs / 1000) <= 0.01);
        }
      }
      // 各地点の通過順は 1〜頭数 の並べ替え
      const n = runners.length;
      for (let k = 0; k < sim.telemetry[runners[0].id].positions.length; k++) {
        const ps = runners.map((r) => sim.telemetry[r.id].positions[k].pos).sort((a, b) => a - b);
        assert.deepEqual(ps, Array.from({ length: n }, (_, i) => i + 1));
      }
    }
  }
});

/* ---------------- 個性の兆候 ---------------- */

test("レースでの個性の兆候は記録に表れた行動だけで決まる（真の個性を見ない）", () => {
  const r = oneRace();
  assert.deepEqual(raceTraitEvidence(withTelemetry(r, { keenSec: 0 })), [{ trait: "keen", opportunity: true, appeared: false }]);
  assert.deepEqual(raceTraitEvidence(withTelemetry(r, { keenSec: 6 })), [{ trait: "keen", opportunity: true, appeared: true }]);
  // 逃げの作戦では騎手が抑えないので、判断の機会にならない
  assert.deepEqual(raceTraitEvidence({ ...withTelemetry(r, { keenSec: 6 }), tactics: { ...r.tactics, style: "front" } }), [{ trait: "keen", opportunity: false, appeared: false }]);
});

test("レース後の個性の兆候は、記録に行きたがる素振りが表れたときだけ増える", () => {
  for (const { rec } of races()) void rec;
  const s0 = newOwnerGame("テスト", 31);
  let s = chooseStarter(s0, s0.starterOffers![0].offerId, "t5", null);
  const W = WEEKS_PER_YEAR * 2 + 24;
  s = { ...s, week: W, horses: s.horses.map((h) => ({ ...h, birthYear: 1, state: { ...h.state, fitness: 90, fatigue: 0 } })) };
  const h = s.horses[0];
  const card = thisWeekCard(s).filter((x) => !entryProblem(s, h, x));
  for (let seed = 1; seed <= 12; seed++) {
    const out = runOwnerRace(s, h.id, card[seed % card.length].id, { style: "closer", pace: "normal", spurt: "normal" }, seed);
    const before = s.horses[0].knowledge.traits;
    const after = out.save.horses[0].knowledge.traits;
    const ev = raceTraitEvidence(out.record)[0];
    for (const t of Object.keys({ ...before, ...after })) {
      if (t === "keen") continue;
      assert.deepEqual(after[t as keyof typeof after], before[t as keyof typeof before], `${t} はレースからは変わらない`);
    }
    const signsBefore = before.keen?.signs ?? 0;
    const signsAfter = after.keen?.signs ?? 0;
    assert.equal(signsAfter - signsBefore, ev.appeared ? 1 : 0);
  }
});

test("週報で、個性を持たない馬に個性の兆候を報告しない", () => {
  const W = WEEKS_PER_YEAR * 2 + 10;
  const base: RaceHorse = createRaceHorse(
    { id: "nt", name: "ムコセイ", ownerId: "me", trainerId: "t6", week: W, age: 3, quality: { potMean: 60, potSd: 5 }, purchasePrice: 0 },
    createRng(5),
  );
  const h0: RaceHorse = { ...base, truth: { ...base.truth, traits: [] } };
  const rng = createRng(77);
  let h = h0;
  for (let w = W; w < W + 150; w++) {
    const out = runStableWeek({ ...h, state: { ...h.state, fatigue: 10, injuryWeeks: 0 } }, findTrainer("t6")!, w, rng);
    h = out.horse;
    assert.ok(!out.report.lines.some((l) => /行きたがる素振り|折り合いがつき|終いの伸びに目立つ|日によって動き/.test(l)), l(out.report.lines));
  }
  for (const k of Object.values(h.knowledge.traits)) assert.notEqual(k?.status, "confirmed");
  assert.ok(Object.values(h.knowledge.traits).every((k) => (k?.signs ?? 0) === 0));
  function l(x: string[]) {
    return x.join(" / ");
  }
});

test("週報の観察は「印象」として述べ、事実として断定しない", () => {
  const W = WEEKS_PER_YEAR * 2 + 10;
  const h0 = createRaceHorse({ id: "ob", name: "インショウ", ownerId: "me", trainerId: "t3", week: W, age: 3, quality: { potMean: 60, potSd: 5 }, purchasePrice: 0 }, createRng(9));
  const rng = createRng(3);
  let h = h0;
  let seen = 0;
  for (let w = W; w < W + 40; w++) {
    const out = runStableWeek({ ...h, state: { ...h.state, fatigue: 10, injuryWeeks: 0 } }, findTrainer("t3")!, w, rng);
    h = out.horse;
    const obs = out.report.lines.find((x) => x.startsWith("観察："));
    if (!obs) continue;
    seen++;
    for (const sentence of obs.replace(/^観察：/, "").split("。").filter(Boolean)) {
      assert.match(sentence, /印象|見え|かもしれない|こなせそう|合いそう|確かめました|素振り|折り合い|伸び|差がある|ことがあります/, sentence);
    }
  }
  assert.ok(seen > 10);
});

test("通過順は通過した順に並び、序盤の位置は400m地点の通過順になる", () => {
  for (const { rec } of races()) {
    const f = raceFacts(rec);
    for (let i = 1; i < f.passing.length; i++) assert.ok(f.passing[i - 1].remain > f.passing[i].remain, `${rec.course.distance}m の通過順の並び`);
    const at400 = rec.telemetry.positions.find((p) => p.remain === rec.course.distance - 400);
    assert.equal(f.earlyPos, at400?.pos ?? null);
    if (f.passing.length) assert.equal(f.passing[f.passing.length - 1].pos, rec.position);
  }
});

test("ペースは同じ距離帯のレースと比べて判断し、どの距離帯でも速い・平均的・ゆったりが出る", () => {
  const seen: Record<string, Set<string>> = {};
  for (const w of [60, 70, 80, 90, 100, 110, 120, 130, 140, 150]) {
    for (const p of raceCard(w)) {
      const cpus = generateCpuEntries(p, 8, w * 31 + p.course.distance);
      const sim = simulateOwnerRace(cpus.map((c, i) => ({ ...c.runner, gate: i + 1 })), { course: p.course, going: p.going }, w * 7 + 3);
      const field = sim.results.map((r) => ({ gate: r.gate, name: r.id, isMine: r.position === 1, position: r.position, timeMs: r.timeMs, marginLengths: r.marginLengths, last600: sim.telemetry[r.id].last600, styleShown: sim.telemetry[r.id].styleShown }));
      const rec = { ...oneRace(), course: p.course, leaderLaps: sim.leaderLaps, field, position: 1, telemetry: sim.telemetry[sim.results[0].id] } as OwnerRaceRecord;
      const pace = raceFacts(rec).pace;
      const band = p.course.distance <= 1400 ? "短" : p.course.distance <= 1800 ? "マ" : p.course.distance <= 2400 ? "中" : "長";
      (seen[band] ??= new Set()).add(String(pace));
    }
  }
  for (const b of ["短", "マ", "中"]) assert.ok(seen[b] && seen[b].size >= 2, `${b}: ${[...(seen[b] ?? [])]}`);
});
