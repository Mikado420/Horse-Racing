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
