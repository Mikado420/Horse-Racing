import { test } from "node:test";
import assert from "node:assert/strict";
import { CAREER_TURNS, ECONOMY, MAX_STABLE, RACE_PROGRAMS, findProgram, programPrize, careerLeft } from "@owners/shared";
import * as E from "../src/offline/engine";
import { BACKUP_KEY, SAVE_KEY, exportSave, importSave, loadSave, writeSave, type KeyValueStore } from "../src/offline/storage";
import { playCareer } from "./bot";

function start(template = "balanced") {
  const s = E.newGame("テストオーナー", 1);
  return E.selectStarter(s, template, "テストホース", 2);
}
const hid = (s: E.OfflineSave) => s.horses[0].id;

function memStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

test("新規ゲーム → 初期馬は1回だけ", () => {
  const s = start();
  assert.equal(s.player.money, ECONOMY.startingMoney);
  assert.equal(s.horses.length, 1);
  assert.equal(s.market.offers.length, 3);
  assert.throws(() => E.selectStarter(s, "swift", "ニトウメ", 3), /選択済み/);
  assert.throws(() => E.newGame("", 1), /名前/);
});

test("調教で能力が伸び所持金が減る、休養で疲労が戻る。元のセーブは変更しない", () => {
  const s0 = start();
  const r = E.train(s0, hid(s0), "speed", 10);
  assert.ok(r.horse.stats.speed > s0.horses[0].stats.speed);
  assert.equal(r.save.player.money, s0.player.money - ECONOMY.trainingCost);
  assert.equal(r.horse.turns, 1);
  assert.equal(s0.horses[0].turns, 0, "不変");
  const rest = E.rest(r.save, hid(s0), 11);
  assert.equal(rest.horse.fatigue, Math.max(0, r.horse.fatigue - 40));
});

test("CPU馬7頭とのレース：着順・賞金・所持金・戦績が反映される", () => {
  const s0 = start();
  const out = E.runRace(s0, hid(s0), "maiden", 99);
  const p = findProgram("maiden")!;
  assert.equal(out.results.length, p.fieldSize);
  assert.equal(out.replay.runners.length, p.fieldSize);
  assert.equal(out.replay.runners.filter((r) => r.playerId === "cpu").length, p.fieldSize - 1);
  const mine = out.results.find((r) => r.horseId === hid(s0))!;
  assert.equal(mine.prize, programPrize(p, mine.position));
  assert.equal(out.save.player.money, s0.player.money - p.entryFee + mine.prize);
  assert.equal(out.save.player.races, 1);
  const h = out.save.horses[0];
  assert.equal(h.races, 1);
  assert.equal(h.turns, 1);
  assert.ok(h.fatigue >= 22);
  assert.equal(out.save.history[0].position, mine.position);
  // 再生データの着順と結果が一致
  assert.deepEqual(out.replay.finishOrder.map((i) => out.replay.runners[i].horseId), out.results.map((r) => r.horseId));
});

test("同じシードなら同じ結果（再現性）", () => {
  const s0 = start();
  assert.deepEqual(E.runRace(s0, hid(s0), "allowance", 5).results, E.runRace(s0, hid(s0), "allowance", 5).results);
});

test("出走条件：疲労・クラス条件・出走経費", () => {
  const s0 = start();
  const tired = { ...s0, horses: [{ ...s0.horses[0], fatigue: 85 }] };
  assert.throws(() => E.runRace(tired, hid(s0), "maiden", 1), /疲労/);
  assert.throws(() => E.runRace(s0, hid(s0), "special", 1), /1勝以上/);
  const winner = { ...s0, horses: [{ ...s0.horses[0], wins: 1 }] };
  assert.throws(() => E.runRace(winner, hid(s0), "maiden", 1), /勝ち上がった/);
  const poor = { ...s0, player: { ...s0.player, money: 0 } };
  assert.throws(() => E.runRace(poor, hid(s0), "maiden", 1), /経費/);
  assert.throws(() => E.train(poor, hid(s0), "speed", 1), /所持金/);
});

test("競走生活の終わり：上限ターンで調教・出走できなくなり、引退で報奨金", () => {
  const s0 = start();
  const old = { ...s0, horses: [{ ...s0.horses[0], turns: CAREER_TURNS, totalPrize: 1_000_000, wins: 2 }] };
  assert.equal(careerLeft(old.horses[0]), 0);
  assert.throws(() => E.train(old, hid(s0), "speed", 1), /引退/);
  assert.throws(() => E.runRace(old, hid(s0), "allowance", 1), /引退/);
  const r = E.retireHorse(old, hid(s0));
  assert.equal(r.bonus, 100_000 + 40_000 + 10_000);
  assert.equal(r.save.horses[0].retired, true);
});

test("馬の購入：所持金と厩舎の上限を確認", () => {
  let s = { ...start(), player: { ...start().player, money: 10_000_000 } };
  const offer = s.market.offers[0];
  const r = E.buyHorse(s, offer.offerId);
  assert.equal(r.save.player.money, 10_000_000 - offer.price);
  assert.equal(r.save.horses.length, 2);
  assert.ok(!r.save.market.offers.some((o) => o.offerId === offer.offerId));
  assert.throws(() => E.buyHorse(r.save, offer.offerId), /販売されていません/);
  const poor = { ...s, player: { ...s.player, money: 0 } };
  assert.throws(() => E.buyHorse(poor, s.market.offers[0].offerId), /所持金/);
  // 上限
  s = r.save;
  for (let i = 0; i < MAX_STABLE - 2; i++) s = { ...s, horses: [...s.horses, { ...s.horses[0], id: `x${i}` }] };
  assert.throws(() => E.buyHorse(s, s.market.offers[0].offerId), /まで/);
});

test("販売リストは3レースごとに入れ替わる", () => {
  let s = start();
  const first = s.market.offers.map((o) => o.offerId).join();
  for (let i = 0; i < 3; i++) {
    s = E.rest(s, hid(s), i).save;
    s = E.runRace(s, hid(s), "allowance", 100 + i).save;
  }
  assert.notEqual(s.market.offers.map((o) => o.offerId).join(), first);
});

test("勝率の見積もり（セーブは変更されない）", () => {
  const s0 = start();
  const before = JSON.stringify(s0);
  const est = Object.fromEntries(RACE_PROGRAMS.map((p) => [p.id, E.estimateRace(s0, hid(s0), p.id, 120, 7)]));
  assert.equal(JSON.stringify(s0), before);
  // 難易度の順序：上のクラスほど勝ちにくい
  assert.ok(est.maiden.winRate > est.allowance.winRate);
  assert.ok(est.allowance.winRate >= est.special.winRate);
  assert.ok(est.special.winRate >= est.stakes.winRate);
  // 初期馬でも未勝利戦なら勝ち目がある／重賞では赤字
  assert.ok(est.maiden.winRate > 0.25 && est.maiden.winRate < 0.75, `maiden ${est.maiden.winRate}`);
  assert.ok(est.stakes.expectedNet < 0);
});

test("セーブ・ロード：保存して読み戻すと同じ。壊れたデータは退避して新規開始できる", () => {
  const kv = memStore();
  const s = E.runRace(start(), "h1", "maiden", 3).save;
  writeSave(kv, s);
  assert.deepEqual(loadSave(kv).save, s);
  assert.deepEqual(importSave(exportSave(s)), s);

  kv.setItem(SAVE_KEY, '{"version":1,"player":{"money":-5}}');
  const r = loadSave(kv);
  assert.equal(r.save, null);
  assert.match(r.error!, /壊れて/);
  assert.ok(kv.getItem(BACKUP_KEY));
  assert.equal(kv.getItem(SAVE_KEY), null);

  assert.throws(() => importSave("not json"), /JSON/);
  assert.throws(() => importSave(JSON.stringify({ ...s, version: 99 })), /バージョン/);
  const tampered = JSON.parse(exportSave(s));
  tampered.horses[0].stats.speed = 9999;
  assert.throws(() => importSave(JSON.stringify(tampered)), /能力/);
});

test("自動プレイ：初期馬で競走生活を最後まで進めると黒字になり、次の馬を買える", () => {
  for (const t of ["swift", "balanced", "stayer"]) {
    const log = playCareer(t, 2024);
    assert.equal(log.horse.turns >= CAREER_TURNS, true, `${t} は最後まで進む`);
    assert.ok(log.wins >= 1, `${t} は1勝以上`);
    assert.ok(log.money > ECONOMY.startingMoney + 400_000, `${t} は期待馬を買える程度に黒字: ${log.money}`);
    assert.ok(log.money < 10_000_000, `${t} の稼ぎ過ぎ: ${log.money}`);
  }
});
