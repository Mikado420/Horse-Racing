// オフライン版（馬主モード）のセーブ・ロードと、旧形式からの引き継ぎ
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OWNER_SAVE_VERSION,
  STARTER_TEMPLATES,
  advanceWeek,
  chooseStarter,
  createRng,
  createStarterHorse,
  newOwnerGame,
  toHorseView,
} from "@owners/shared";
import { BACKUP_KEY, SAVE_KEY, V1_BACKUP_KEY, exportSave, importSave, loadSave, writeSave, type KeyValueStore } from "../src/offline/storage";

function memStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

function started() {
  let s = newOwnerGame("テストオーナー", 1);
  s = chooseStarter(s, s.starterOffers![0].offerId, "t1", "テストホース");
  for (let i = 0; i < 6; i++) s = advanceWeek(s, i).save;
  return s;
}

test("保存して読み込むと同じデータに戻る（書き出し・読み込みも）", () => {
  const s = started();
  const kv = memStore();
  writeSave(kv, s);
  const loaded = loadSave(kv);
  assert.deepEqual(loaded.save, s);
  assert.deepEqual(importSave(exportSave(s)), s);
});

test("壊れたセーブは検出して退避し、新しく始められる", () => {
  const kv = memStore();
  kv.setItem(SAVE_KEY, "{not json");
  const r = loadSave(kv);
  assert.equal(r.save, null);
  assert.ok(r.error);
  assert.equal(kv.getItem(BACKUP_KEY), "{not json");
  assert.equal(kv.getItem(SAVE_KEY), null);

  const s = started();
  const broken = JSON.parse(JSON.stringify(s));
  broken.horses[0].truth.abilities.speed = "速い";
  assert.throws(() => importSave(JSON.stringify(broken)), /壊れています/);
  const noKnowledge = JSON.parse(JSON.stringify(s));
  delete noKnowledge.horses[0].knowledge.entries.stamina;
  assert.throws(() => importSave(JSON.stringify(noKnowledge)), /見立て/);
  assert.throws(() => importSave(JSON.stringify({ ...s, version: 99 })), /バージョン/);
  assert.throws(() => importSave("abc"), /JSON/);
});

test("旧形式（バージョン1）のセーブを新しい馬主システムへ引き継ぐ", () => {
  const old = createStarterHorse(STARTER_TEMPLATES[0], { id: "h1", ownerId: "local-player" }, "キュウケイシキ", createRng(3));
  const v1 = {
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    player: { id: "local-player", username: "むかしのオーナー", money: 512_000, totalPrize: 300_000, races: 5, wins: 2 },
    horses: [{ ...old, races: 5, wins: 2, totalPrize: 300_000 }],
    history: [],
    market: { offers: [], racesAtRefresh: 0 },
    counters: { horseSeq: 1, raceSeq: 5 },
  };
  const kv = memStore();
  kv.setItem(SAVE_KEY, JSON.stringify(v1));
  const r = loadSave(kv);
  assert.ok(r.save && r.notice);
  const s = r.save!;
  assert.equal(s.version, OWNER_SAVE_VERSION);
  assert.equal(s.player.money, 512_000);
  assert.equal(s.horses.length, 1);
  const h = s.horses[0];
  assert.equal(h.name, "キュウケイシキ");
  assert.equal(h.record.wins, 2);
  assert.equal(h.truth.abilities.speed, Math.round(old.stats.speed));
  // 旧形式で見えていた能力は数値まで判明、新しく加わった加速力は未解明
  const v = toHorseView(h, s.week);
  assert.equal(v.knowledge.speed.stage, "numeric");
  assert.equal(v.knowledge.acceleration.stage, "abstract");
  assert.equal(v.age, 3);
  // 変換後の形式で保存し直し、元データも残す
  assert.equal(JSON.parse(kv.getItem(SAVE_KEY)!).version, OWNER_SAVE_VERSION);
  assert.ok(kv.getItem(V1_BACKUP_KEY));
  // 引き継いだ馬で週を進められる
  assert.equal(advanceWeek(s, 1).save.week, s.week + 1);
});
