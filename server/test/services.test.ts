// 実際の PostgreSQL に対してサービス層（育成・経済・精算）を検証する
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_COURSE, ECONOMY, createRng, prizeFor } from "@owners/shared";
import { randomUUID } from "node:crypto";
import type { Db } from "../src/db/db";
import { loginPlayer, registerPlayer, getPlayer } from "../src/services/players";
import { listHorses, restHorse, selectStarter, trainHorse, getOwnedHorse } from "../src/services/horses";
import { AlreadySettledError, getRace, rankings, settleRace } from "../src/services/races";
import { createTestDb } from "./support/testDb";

let db: Db;
let drop: () => Promise<void>;
before(async () => {
  ({ db, drop } = await createTestDb());
});
after(async () => {
  await drop();
});

let n = 0;
async function newPlayerWithHorse(template = "balanced") {
  const p = await registerPlayer(db, `user${++n}_${Date.now() % 10000}`, "password123");
  const h = await selectStarter(db, p.id, template, `テスト馬${n}`, createRng(n));
  return { p, h };
}

test("登録・ログイン（ユーザー名の重複は大文字小文字を区別せず拒否）", async () => {
  const p = await registerPlayer(db, "Alice", "password123");
  assert.equal(p.money, ECONOMY.startingMoney);
  await assert.rejects(registerPlayer(db, "alice", "password999"), /既に使われています/);
  assert.equal((await loginPlayer(db, "ALICE", "password123")).id, p.id);
  await assert.rejects(loginPlayer(db, "alice", "wrongpass1"), /違います/);
  await assert.rejects(loginPlayer(db, "nobody", "password123"), /違います/);
});

test("初期馬は1回だけ選べる（同時リクエストでも1頭）", async () => {
  const p = await registerPlayer(db, "starter_user", "password123");
  const results = await Promise.allSettled(
    [0, 1, 2, 3].map((i) => selectStarter(db, p.id, "swift", `ハヤテ${i}号`, createRng(i))),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await listHorses(db, p.id)).length, 1);
  await assert.rejects(selectStarter(db, p.id, "nope", "ナマエ", createRng(1)), /種類/);
});

test("調教で能力が上がり所持金が減る。休養で疲労が回復する", async () => {
  const { p, h } = await newPlayerWithHorse();
  const r = await trainHorse(db, p.id, h.id, "speed", createRng(1));
  assert.ok(r.horse.stats.speed > h.stats.speed);
  assert.equal(r.money, ECONOMY.startingMoney - ECONOMY.trainingCost);
  const saved = await getOwnedHorse(db, p.id, h.id);
  assert.deepEqual(saved.stats, r.horse.stats);
  assert.equal(saved.fatigue, r.horse.fatigue);
  const rest = await restHorse(db, p.id, h.id, createRng(2));
  assert.equal(rest.horse.fatigue, Math.max(0, saved.fatigue - 40));
});

test("他人の馬は調教できない", async () => {
  const a = await newPlayerWithHorse();
  const b = await newPlayerWithHorse();
  await assert.rejects(trainHorse(db, b.p.id, a.h.id, "speed", createRng(1)), /見つかりません/);
});

test("所持金不足の調教は拒否。同時に連打しても残高はマイナスにならない", async () => {
  const { p, h } = await newPlayerWithHorse();
  await db.query("UPDATE players SET money = $2 WHERE id = $1", [p.id, ECONOMY.trainingCost * 2]);
  const results = await Promise.allSettled(
    [0, 1, 2, 3, 4].map((i) => trainHorse(db, p.id, h.id, "stamina", createRng(i))),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
  assert.equal((await getPlayer(db, p.id)).money, 0);
});

test("レース精算：賞金・戦績・馬の状態が保存され、同じレースは二度精算されない", async () => {
  const a = await newPlayerWithHorse("swift");
  const b = await newPlayerWithHorse("stayer");
  const raceId = randomUUID();
  const entries = [
    { gate: 1, playerId: a.p.id, horseId: a.h.id },
    { gate: 2, playerId: b.p.id, horseId: b.h.id },
  ];
  const out = await settleRace(db, raceId, entries, DEFAULT_COURSE, 42);
  assert.equal(out.status, "finished");
  if (out.status !== "finished") return;
  assert.equal(out.results.length, 2);

  for (const r of out.results) {
    const player = await getPlayer(db, r.playerId);
    assert.equal(r.prize, prizeFor(r.position, 2));
    assert.equal(player.money, ECONOMY.startingMoney - ECONOMY.entryFee + r.prize);
    assert.equal(player.races, 1);
    assert.equal(player.wins, r.position === 1 ? 1 : 0);
    const horse = await getOwnedHorse(db, r.playerId, r.horseId);
    assert.equal(horse.races, 1);
    assert.equal(horse.totalPrize, r.prize);
    assert.ok(horse.fatigue >= 22);
  }

  // 再実行しても二重付与されない
  await assert.rejects(settleRace(db, raceId, entries, DEFAULT_COURSE, 42), AlreadySettledError);
  const winner = await getPlayer(db, out.results[0].playerId);
  assert.equal(winner.money, ECONOMY.startingMoney - ECONOMY.entryFee + out.results[0].prize);

  // 保存されたレースを読み出せる
  const saved = await getRace(db, raceId);
  assert.equal(saved.results.length, 2);
  assert.deepEqual(saved.results.map((r) => r.horseId), out.results.map((r) => r.horseId));
  assert.equal(saved.replay.frames.length, out.sim.frames.length);
});

test("同じ raceId で同時に精算を呼んでも1回しか成功しない", async () => {
  const a = await newPlayerWithHorse();
  const b = await newPlayerWithHorse();
  const raceId = randomUUID();
  const entries = [
    { gate: 1, playerId: a.p.id, horseId: a.h.id },
    { gate: 2, playerId: b.p.id, horseId: b.h.id },
  ];
  const rs = await Promise.allSettled([1, 2, 3].map(() => settleRace(db, raceId, entries, DEFAULT_COURSE, 7)));
  assert.equal(rs.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await getPlayer(db, a.p.id)).races, 1);
});

test("精算時に出走条件を満たさない馬は除外され、2頭未満なら中止（賞金なし）", async () => {
  const a = await newPlayerWithHorse();
  const b = await newPlayerWithHorse();
  await db.query("UPDATE horses SET fatigue = 90 WHERE id = $1", [b.h.id]);
  const out = await settleRace(
    db,
    randomUUID(),
    [
      { gate: 1, playerId: a.p.id, horseId: a.h.id },
      { gate: 2, playerId: b.p.id, horseId: b.h.id },
    ],
    DEFAULT_COURSE,
    1,
  );
  assert.equal(out.status, "cancelled");
  assert.equal((await getPlayer(db, a.p.id)).money, ECONOMY.startingMoney);
});

test("他人の馬を自分の名義で精算させようとしても除外される", async () => {
  const a = await newPlayerWithHorse();
  const b = await newPlayerWithHorse();
  const c = await newPlayerWithHorse();
  const out = await settleRace(
    db,
    randomUUID(),
    [
      { gate: 1, playerId: a.p.id, horseId: a.h.id },
      { gate: 2, playerId: b.p.id, horseId: b.h.id },
      { gate: 3, playerId: a.p.id, horseId: c.h.id }, // 不正
    ],
    DEFAULT_COURSE,
    3,
  );
  assert.equal(out.status, "finished");
  if (out.status === "finished") assert.ok(!out.results.some((r) => r.horseId === c.h.id));
});

test("ランキングは獲得賞金順", async () => {
  const r = await rankings(db);
  for (let i = 1; i < r.players.length; i++) assert.ok(r.players[i - 1].totalPrize >= r.players[i].totalPrize);
  assert.ok(r.players[0].totalPrize > 0);
  assert.ok(r.horses.length > 0);
});
