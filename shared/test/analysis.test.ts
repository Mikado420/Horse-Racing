// 分析システム再設計：診断と調教師コメントの整合性（記録に基づき、誤情報・根拠のない断定を出さない）
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeTrainerComment, diagnoseRace, extractFacts, paceShapeFromLaps, type OwnerRaceRecord } from "../src/index";
import { playOwner } from "./ownerBot";

// 自動プレイで集めたレース記録（いろいろな着順・展開を含む）
const pool: OwnerRaceRecord[] = [];
for (const seed of [3, 5, 8]) pool.push(...playOwner(seed, 150).save.races);

/** 内部の数値（プレイヤーが知り得ない値）だけを書き換えた記録 */
function scrambleInternals(r: OwnerRaceRecord, k: number): OwnerRaceRecord {
  return {
    ...r,
    pace: r.pace ? { ...r.pace, early: -r.pace.early + k, mid: k, label: (["slow", "average", "high"] as const)[k % 3] } : r.pace,
    telemetry: {
      ...r.telemetry,
      emptyRemain: k % 2 ? 350 : null,
      fadeRemain: k % 2 ? 500 : null,
      reserve: r.telemetry.positions.map(() => (k % 2 ? 0 : 0.9)),
      cruiseSpeed: 10 + k,
      topSpeedLate: 25 - k,
      spurtRemain: 100 * k,
      leadBattleSec: 30 * k,
    },
  };
}

const BANNED = [/スタミナ切れ/, /脚が上が/, /敗因/, /必ず/, /失敗/, /m\/秒/, /長すぎ/, /能力不足/, /間違い/, /故障/, /エネルギー/];

test("同じレース記録からは毎回同じ診断とコメントが出る（乱数を使わない）", () => {
  const orig = Math.random;
  Math.random = () => {
    throw new Error("Math.random が呼ばれた");
  };
  try {
    for (const r of pool.slice(0, 40)) {
      const a = composeTrainerComment(r, "テスト", diagnoseRace(r, pool));
      const b = composeTrainerComment(r, "テスト", diagnoseRace(r, pool));
      assert.deepEqual(a, b);
    }
  } finally {
    Math.random = orig;
  }
});

test("コメントが触れる事実・見解・提案は、すべて診断に含まれるものだけ", () => {
  for (const r of pool) {
    const d = diagnoseRace(r, pool);
    const c = composeTrainerComment(r, "テスト", d);
    for (const f of c.claims.facts) assert.ok(d.facts.some((x) => x.id === f), `${r.raceId}：事実 ${f} は診断にない`);
    for (const v of c.claims.views) assert.ok(d.views.some((x) => x.id === v), `${r.raceId}：見解 ${v} は診断にない`);
    for (const s of c.claims.suggestions) assert.ok(d.suggestions.some((x) => x.id === s), `${r.raceId}：提案 ${s} は診断にない`);
  }
});

test("コメントは着順・位置取り・ラップの記録と矛盾しない", () => {
  for (const r of pool) {
    const { text } = composeTrainerComment(r, "テスト", diagnoseRace(r, pool));
    if (r.position === 1) assert.match(text, /勝/, text);
    else assert.ok(text.includes(`${r.position}着`), text);
    if (r.position > 3) assert.ok(!/上位/.test(text), text);
    // 「○番手から○着」の数字は記録の通過順位と一致する
    const m = /残り400mの?(\d+)番手/.exec(text);
    if (m) assert.equal(Number(m[1]), r.telemetry.positions.find((p) => p.remain === 400)!.pos, text);
    const early = /序盤は(\d+)番手/.exec(text);
    if (early) assert.equal(Number(early[1]), r.telemetry.positions[0].pos, text);
    // 勝った馬に敗因めいた見解を付けない
    if (r.position === 1) for (const v of diagnoseRace(r, pool).views) assert.ok(["goodRun", "paceSuitedFront"].includes(v.id), v.id);
    // 勝ち馬から5馬身以上離されたのに「力は出せた」とは言わない
    if (r.marginToWinner >= 5) {
      assert.ok(!diagnoseRace(r, pool).views.some((v) => v.id === "goodRun"), `${r.raceId} ${r.marginToWinner}`);
      assert.ok(!/力は出せた|内容は悪くありません/.test(text), text);
    }
  }
});

test("起きていない不利（前が壁・外を回る・行きたがる・出遅れ）をコメントで述べない", () => {
  for (const r of pool) {
    const clean: OwnerRaceRecord = { ...r, telemetry: { ...r.telemetry, blockedSec: 0, extraMeters: 0, keenSec: 0, startDelay: 0 } };
    const { text } = composeTrainerComment(clean, "テスト", diagnoseRace(clean, pool));
    assert.ok(!/壁|進路が取れない|外を回|行きたが|力む|後手|後れ/.test(text), text);
  }
});

test("内部の数値（エネルギー残量・速度・仕掛け地点・内部のペース指数）だけでは診断もコメントも変わらない", () => {
  for (const r of pool.slice(0, 60)) {
    const base = diagnoseRace(r, pool);
    const baseText = composeTrainerComment(r, "テスト", base).text;
    for (let k = 1; k <= 3; k++) {
      const x = scrambleInternals(r, k);
      assert.deepEqual(diagnoseRace(x, pool), base);
      assert.equal(composeTrainerComment(x, "テスト", diagnoseRace(x, pool)).text, baseText);
    }
  }
});

test("禁止表現（スタミナ切れの断定・敗因の断定・保証など）を使わない", () => {
  for (const r of pool) {
    const { text } = composeTrainerComment(r, "テスト", diagnoseRace(r, pool));
    for (const b of BANNED) assert.ok(!b.test(text), `${b} が含まれる：${text}`);
  }
});

test("根拠が足りないときは、原因を特定できないと伝える", () => {
  const r = pool.find((x) => x.position >= 5)!;
  // 目立つ出来事も通過順位の変化もない負け
  const plain: OwnerRaceRecord = {
    ...r,
    marginToWinner: 2,
    telemetry: {
      ...r.telemetry,
      blockedSec: 0,
      extraMeters: 0,
      keenSec: 0,
      startDelay: 0,
      duel: { occurred: false, gained: false },
      styleShown: r.tactics.style,
      positions: r.telemetry.positions.map((p) => ({ ...p, pos: r.position })),
    },
    field: r.field.map((f) => ({ ...f, last600: f.isMine ? 36 : 36 + (f.gate % 3) * 0.2 - 0.2 })),
  };
  const d = diagnoseRace(plain, []);
  assert.deepEqual(d.views.map((v) => v.id), ["undetermined"]);
  const { text } = composeTrainerComment(plain, "テスト", d);
  assert.match(text, /原因は(分かりません|特定できません)/);
});

test("文面の言い回しが変わっても、同じ事実からは同じ見解になる", () => {
  for (const r of pool.slice(0, 30)) {
    const d1 = diagnoseRace(r, pool);
    const other = { ...r, raceId: `${r.raceId}-x` };
    const d2 = diagnoseRace(other, pool.map((x) => (x.raceId === r.raceId ? other : x)));
    assert.deepEqual(d2.views, d1.views);
    assert.deepEqual(composeTrainerComment(other, "テスト", d2).claims, composeTrainerComment(r, "テスト", d1).claims);
  }
});

test("見解はいつも推定の言い方（断定しない）で、距離適性は1回では断定しない", () => {
  for (const r of pool) {
    const d = diagnoseRace(r, pool);
    const { text } = composeTrainerComment(r, "テスト", d);
    if (d.views.some((v) => v.id === "distanceQuestion")) assert.match(text, /断定できません|確認が必要/);
    for (const v of d.views) if (v.id !== "goodRun" && v.id !== "tacticsMismatch") assert.ok(/可能性|かもしれません|分かりません|特定できません|良かった/.test(text), text);
  }
});

test("ラップから見た流れは、記録されたラップだけで決まる", () => {
  assert.equal(paceShapeFromLaps([13, 11, 11, 11, 12, 12.5, 12.5, 12.5], 1600), "fast");
  assert.equal(paceShapeFromLaps([13, 12.6, 12.6, 12.4, 11.5, 11.3, 11.2, 11.4], 1600), "slow");
  assert.equal(paceShapeFromLaps([13, 12], 400), null);
  // 事実の抽出に内部の値を書き換えても影響しない
  for (const r of pool.slice(0, 20)) assert.deepEqual(extractFacts(scrambleInternals(r, 2), pool), extractFacts(r, pool));
});

/* ---------------- 情報の公開範囲 ---------------- */
import { analyzeRace, finalFurlong, keyObservations } from "../src/index";

test("分析画面の項目に、観測できない内部の数値（速度・エネルギー・仕掛け地点・内部の距離や秒数）が出ない", () => {
  for (const r of pool) {
    const findings = analyzeRace(r, pool);
    for (const f of findings) {
      assert.ok(["record", "observed", "estimate"].includes(f.cls));
      assert.ok(!/m\/秒|エネルギー|脚が上が|仕掛け[たて]|余分に|秒ほど|秒あった/.test(f.text), `${f.title}：${f.text}`);
    }
    // 内部の数値を書き換えても、分析の内容は変わらない
    assert.deepEqual(analyzeRace(scrambleInternals(r, 1), pool), findings);
    for (const o of keyObservations(diagnoseRace(r, pool))) assert.ok(!/\d+(\.\d+)?(m|秒)/.test(o.text.replace(/残り400m/, "")), o.text);
  }
});

test("上がり3F・最後の1ハロン・ラップは元の記録と一致する（区間タイムの合計＝走破タイム）", () => {
  for (const r of pool) {
    const t = r.telemetry;
    const D = r.course.distance;
    if (D % 200 === 0) {
      // 200mごとの通過時刻の最後はゴール時刻（ミリ秒の丸めの範囲で一致）
      assert.ok(Math.abs(t.splits[t.splits.length - 1] - r.timeMs / 1000) <= 0.01, `${r.raceId} ${t.splits[t.splits.length - 1]} vs ${r.timeMs}`);
      const ff = finalFurlong(r)!;
      assert.ok(Math.abs(ff - (t.splits[t.splits.length - 1] - t.splits[t.splits.length - 2])) <= 0.06);
      // 上がり3F＝ゴール時刻−残り600m通過時刻（残り600mは200mごとの通過記録の1つ）
      const at600 = t.splits[D / 200 - 4];
      assert.ok(Math.abs(t.last600 - (r.timeMs / 1000 - at600)) <= 0.02, `${r.raceId} 上がり ${t.last600} vs ${r.timeMs / 1000 - at600}`);
    }
    // 区間タイムは正の値で、合計は通過時刻に一致する
    const laps = t.splits.map((x, i) => x - (i ? t.splits[i - 1] : 0));
    assert.ok(laps.every((x) => x > 8 && x < 25), JSON.stringify(laps));
    // 通過順位は1〜頭数、ゴールの順位は着順と一致
    for (const p of t.positions) assert.ok(p.pos >= 1 && p.pos <= r.fieldSize);
    const goal = t.positions.find((p) => p.remain === 0);
    if (goal) assert.equal(goal.pos, r.position);
    // 出走馬の着順は1から順に並ぶ
    assert.deepEqual(r.field.map((f) => f.position), r.field.map((_, i) => i + 1));
  }
});

test("記録が足りないときは、数値や断定を作らない（短距離・距離が200mで割り切れない・ラップが少ない）", () => {
  const r = pool[0];
  const short: OwnerRaceRecord = { ...r, course: { ...r.course, distance: 1300 }, leaderLaps: r.leaderLaps.slice(0, 3) };
  assert.equal(finalFurlong(short), null);
  const f = analyzeRace(short, []);
  assert.ok(!f.some((x) => x.title === "レースの流れ"));
  assert.ok(f.find((x) => x.title === "終盤の粘り")!.notInformative.some((n) => n.key === "stamina"));
  assert.ok(!/最後の1ハロン \d/.test(f[0].text));
});

/* ---------------- 厩舎の報告 ---------------- */
import { OBS_COMMENT, TRAIT_IDS, WEEKS_PER_YEAR, createRaceHorse, createRng, findTrainer, runStableWeek } from "../src/index";

test("厩舎の報告は、持っていない個性の兆候を作らない", () => {
  for (let seed = 1; seed <= 6; seed++) {
    let h = createRaceHorse({ id: `h${seed}`, name: "テスト", ownerId: "me", trainerId: "t1", week: WEEKS_PER_YEAR * 2, age: 2, quality: { potMean: 60, potSd: 5 }, purchasePrice: 0 }, createRng(seed));
    const rng = createRng(seed * 31);
    for (let w = 0; w < 60; w++) h = runStableWeek({ ...h, state: { ...h.state, fatigue: 0, injuryWeeks: 0 } }, findTrainer("t3")!, WEEKS_PER_YEAR * 2 + w, rng).horse;
    for (const t of TRAIT_IDS) {
      if (h.truth.traits.includes(t)) continue;
      assert.equal(h.knowledge.traits[t]?.signs ?? 0, 0, `${seed}：持っていない「${t}」の兆候が記録された`);
    }
  }
});

test("厩舎の観察コメントは、積み上げた見立てに沿っていて、週ごとに正反対のことを言わない", () => {
  let flips = 0;
  let total = 0;
  for (let seed = 1; seed <= 6; seed++) {
    let h = createRaceHorse({ id: `h${seed}`, name: "テスト", ownerId: "me", trainerId: "t1", week: WEEKS_PER_YEAR * 2, age: 2, quality: { potMean: 60, potSd: 8 }, purchasePrice: 0 }, createRng(seed));
    const rng = createRng(seed * 17);
    const last: Record<string, number> = {};
    for (let w = 0; w < 80; w++) {
      const out = runStableWeek({ ...h, state: { ...h.state, fatigue: 0, injuryWeeks: 0 } }, findTrainer("t2")!, WEEKS_PER_YEAR * 2 + w, rng);
      h = out.horse;
      const text = out.report.lines.join(" ");
      for (const [key, levels] of Object.entries(OBS_COMMENT)) {
        const lv = levels.findIndex((x) => text.includes(x));
        if (lv < 0) continue;
        if (w >= 20 && last[key] !== undefined) {
          total++;
          if (Math.abs(lv - last[key]) === 2) flips++;
        }
        last[key] = lv;
        // 見立てが固まっていないときは、そう添える
        const e = h.knowledge.entries[key as keyof typeof OBS_COMMENT];
        if (e.uncertainty > 8.5) assert.ok(text.includes(`${levels[lv]}（まだ見極め中）`), text);
      }
    }
  }
  assert.ok(total >= 20, `比較できた回数 ${total}`);
  assert.equal(flips, 0, `正反対の評価に変わった回数 ${flips}/${total}`);
});
