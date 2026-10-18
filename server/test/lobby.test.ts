// ロビー〜締切〜計算・精算〜配信〜結果発表の流れを、実DBと疑似クライアントで検証する。
// （Colyseus の RaceRoom はこのクラスへ委譲するだけの薄いアダプタ）
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { ECONOMY, createRng, prizeFor, type RaceStartMsg, type RaceResultMsg, type LobbyStateMsg } from "@owners/shared";
import type { Db } from "../src/db/db";
import { signToken } from "../src/auth/jwt";
import { registerPlayer, getPlayer } from "../src/services/players";
import { selectStarter, getOwnedHorse } from "../src/services/horses";
import { EntryRegistry } from "../src/race/entryRegistry";
import { RaceLobby, type LobbyIO } from "../src/race/RaceLobby";
import { createTestDb } from "./support/testDb";

const SECRET = "test-secret";
let db: Db;
let drop: () => Promise<void>;
before(async () => {
  ({ db, drop } = await createTestDb());
});
after(async () => {
  await drop();
});

/** 疑似クライアント付きの部屋 */
class FakeRoom implements LobbyIO {
  t = 1_000_000;
  locked = false;
  clients = new Map<string, { connected: boolean; inbox: { type: string; msg: any }[] }>();
  now = () => this.t;
  lock() {
    this.locked = true;
  }
  broadcast(type: string, msg: unknown) {
    // JSON を通して、実際の通信と同じく値だけが届くようにする
    const copy = JSON.parse(JSON.stringify(msg));
    for (const c of this.clients.values()) if (c.connected) c.inbox.push({ type, msg: copy });
  }
  connect(sid: string) {
    this.clients.set(sid, { connected: true, inbox: [] });
  }
  last<T>(sid: string, type: string): T | undefined {
    const box = this.clients.get(sid)!.inbox.filter((m) => m.type === type);
    return box[box.length - 1]?.msg as T | undefined;
  }
}

let seq = 0;
async function makePlayer() {
  const p = await registerPlayer(db, `lob${++seq}_${process.pid % 1000}`, "password123");
  const h = await selectStarter(db, p.id, ["swift", "balanced", "stayer"][seq % 3], `ロビー馬${seq}`, createRng(seq));
  return { p, h, token: signToken({ sub: p.id, name: p.username }, SECRET) };
}

function makeLobby(room: FakeRoom, registry = new EntryRegistry()) {
  return new RaceLobby(room, {
    db,
    registry,
    jwtSecret: SECRET,
    registrationMs: 30_000,
    replaySpeed: 2,
    countdownMs: 3000,
  });
}

async function join(lobby: RaceLobby, room: FakeRoom, sid: string, token: string, horseId: string) {
  const auth = await lobby.authorize({ token, horseId });
  room.connect(sid);
  return lobby.addEntry(sid, auth.player, auth.horse);
}

test("2人が登録 → 締切 → 全員に同一のレース経過と同一の着順が届き、賞金と戦績が保存される", async () => {
  const room = new FakeRoom();
  const lobby = makeLobby(room);
  const A = await makePlayer();
  const B = await makePlayer();
  await join(lobby, room, "sA", A.token, A.h.id);
  await join(lobby, room, "sB", B.token, B.h.id);

  // 締切前は始まらない
  room.t += 29_000;
  await lobby.tick();
  assert.equal(lobby.phase, "registering");
  const lob = room.last<LobbyStateMsg>("sA", "lobby")!;
  assert.equal(lob.entries.length, 2);
  assert.deepEqual(lob.entries.map((e) => e.gate), [1, 2]);

  // 締切
  room.t += 1_000;
  await lobby.tick();
  assert.equal(lobby.phase, "running");
  assert.equal(room.locked, true, "締切後は新規参加を受け付けない");

  const startA = room.last<RaceStartMsg>("sA", "race_start")!;
  const startB = room.last<RaceStartMsg>("sB", "race_start")!;
  assert.deepEqual(startA, startB, "全参加者に同じデータ");
  assert.equal(startA.runners.length, 2);
  assert.ok(startA.startAt > room.t);

  // 再生が終わるまで結果は発表されない
  await lobby.tick();
  assert.equal(room.last("sA", "race_result"), undefined);
  room.t += 120_000;
  await lobby.tick();
  assert.equal(lobby.phase, "finished");
  const resA = room.last<RaceResultMsg>("sA", "race_result")!;
  const resB = room.last<RaceResultMsg>("sB", "race_result")!;
  assert.deepEqual(resA.results, resB.results);
  assert.deepEqual(
    resA.results.map((r) => r.horseId),
    startA.finishOrder.map((i) => startA.runners[i].horseId),
    "再生データの着順と結果発表が一致",
  );

  // DBに保存されている
  for (const r of resA.results) {
    const player = await getPlayer(db, r.playerId);
    assert.equal(player.money, ECONOMY.startingMoney - ECONOMY.entryFee + prizeFor(r.position, 2));
    assert.equal(player.races, 1);
    const horse = await getOwnedHorse(db, r.playerId, r.horseId);
    assert.equal(horse.races, 1);
  }
  // 結果発表は1回だけ
  room.t += 10_000;
  await lobby.tick();
  assert.equal(room.clients.get("sA")!.inbox.filter((m) => m.type === "race_result").length, 1);
});

test("レース中に通信が切れてもサーバーで判定は進み、再接続すると同じ結果を受け取れる", async () => {
  const room = new FakeRoom();
  const lobby = makeLobby(room);
  const A = await makePlayer();
  const B = await makePlayer();
  await join(lobby, room, "sA", A.token, A.h.id);
  await join(lobby, room, "sB", B.token, B.h.id);
  room.t += 30_000;
  await lobby.tick();
  assert.equal(lobby.phase, "running");

  // B が切断（RaceRoom では removeEntry は締切後は何もしない）
  room.clients.get("sB")!.connected = false;
  lobby.removeEntry("sB");
  room.t += 120_000;
  await lobby.tick();
  assert.equal(lobby.phase, "finished");
  assert.equal(room.last("sB", "race_result"), undefined, "切断中は届かない");

  // 再接続して同期
  room.clients.get("sB")!.connected = true;
  const sync = JSON.parse(JSON.stringify(lobby.sync()));
  const resA = room.last<RaceResultMsg>("sA", "race_result")!;
  assert.deepEqual(sync.result.results, resA.results);
  assert.equal(sync.race.raceId, resA.raceId);
  // 切断した B にも賞金は付与済み
  const bRow = resA.results.find((r) => r.playerId === B.p.id)!;
  assert.equal((await getPlayer(db, B.p.id)).money, ECONOMY.startingMoney - ECONOMY.entryFee + bRow.prize);
});

test("全員が切断してもレースは確定・保存される", async () => {
  const room = new FakeRoom();
  const lobby = makeLobby(room);
  const A = await makePlayer();
  const B = await makePlayer();
  await join(lobby, room, "sA", A.token, A.h.id);
  await join(lobby, room, "sB", B.token, B.h.id);
  room.t += 30_000;
  for (const c of room.clients.values()) c.connected = false;
  await lobby.tick();
  await lobby.dispose();
  assert.equal((await getPlayer(db, A.p.id)).races, 1);
  assert.equal((await getPlayer(db, B.p.id)).races, 1);
});

test("1頭だけなら締切を延長し、2頭目の登録後に開始する", async () => {
  const room = new FakeRoom();
  const lobby = makeLobby(room);
  const A = await makePlayer();
  await join(lobby, room, "sA", A.token, A.h.id);
  room.t += 30_000;
  await lobby.tick();
  assert.equal(lobby.phase, "registering");
  assert.match(room.last<LobbyStateMsg>("sA", "lobby")!.message ?? "", /延長/);
  const B = await makePlayer();
  await join(lobby, room, "sB", B.token, B.h.id);
  room.t += 30_000;
  await lobby.tick();
  assert.equal(lobby.phase, "running");
});

test("8頭そろった時点で締切を待たずに開始し、9頭目は登録できない", async () => {
  const room = new FakeRoom();
  const lobby = makeLobby(room);
  const ps = [];
  for (let i = 0; i < 9; i++) ps.push(await makePlayer());
  for (let i = 0; i < 8; i++) await join(lobby, room, `s${i}`, ps[i].token, ps[i].h.id);
  await assert.rejects(join(lobby, room, "s8", ps[8].token, ps[8].h.id), /埋まって/);
  await lobby.tick();
  assert.equal(lobby.phase, "running");
  const start = room.last<RaceStartMsg>("s0", "race_start")!;
  assert.equal(start.runners.length, 8);
  // 締切後の参加は拒否
  await assert.rejects(lobby.authorize({ token: ps[8].token, horseId: ps[8].h.id }), /締め切/);
});

test("不正な参加は拒否される（認証なし・他人の馬・二重登録・別レースとの重複・疲労過多）", async () => {
  const registry = new EntryRegistry();
  const room = new FakeRoom();
  const lobby = makeLobby(room, registry);
  const A = await makePlayer();
  const B = await makePlayer();
  await assert.rejects(lobby.authorize({ token: "bad", horseId: A.h.id }), /認証/);
  await assert.rejects(lobby.authorize({ token: A.token, horseId: "not-a-uuid" }), /指定/);
  await assert.rejects(lobby.authorize({ token: A.token, horseId: B.h.id }), /所有馬ではありません/);
  await join(lobby, room, "sA", A.token, A.h.id);
  // 同じプレイヤーが同じレースに2回
  const again = await lobby.authorize({ token: A.token, horseId: A.h.id });
  assert.throws(() => lobby.addEntry("sA2", again.player, again.horse), /1頭まで/);
  // 同じ馬を別のレースに
  const room2 = new FakeRoom();
  const lobby2 = makeLobby(room2, registry);
  await assert.rejects(join(lobby2, room2, "x", A.token, A.h.id), /別のレース/);
  // 登録取消すれば別レースに出せる
  lobby.removeEntry("sA");
  await join(lobby2, room2, "x", A.token, A.h.id);
  // 疲労過多
  await db.query("UPDATE horses SET fatigue = 85 WHERE id = $1", [B.h.id]);
  await assert.rejects(lobby.authorize({ token: B.token, horseId: B.h.id }), /疲労/);
});

test("登録受付中に退出すると出走取消になり、0頭なら締切はリセット", async () => {
  const room = new FakeRoom();
  const lobby = makeLobby(room);
  const A = await makePlayer();
  await join(lobby, room, "sA", A.token, A.h.id);
  assert.ok(lobby.lobbyState().deadlineAt);
  lobby.removeEntry("sA");
  assert.equal(lobby.lobbyState().entries.length, 0);
  assert.equal(lobby.lobbyState().deadlineAt, null);
});
