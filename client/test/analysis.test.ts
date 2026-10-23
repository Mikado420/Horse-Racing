// 分析システムの改修に伴うセーブの扱い（実装指示書「分析システムの現実化・全面再設計」8章）
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OWNER_SAVE_VERSION,
  WEEKS_PER_YEAR,
  buildRaceReport,
  checkReport,
  chooseStarter,
  composeTrainerComment,
  entryProblem,
  findTrainer,
  newOwnerGame,
  refreshRaceComments,
  runOwnerRace,
  thisWeekCard,
  type OwnerSave,
} from "@owners/shared";
import { exportSave, importSave, loadSave, writeSave, type KeyValueStore } from "../src/offline/storage";

function memStore(): KeyValueStore {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

/** 2レース走ったセーブ */
function raced(): OwnerSave {
  const s0 = newOwnerGame("テスト", 12);
  let s = chooseStarter(s0, s0.starterOffers![0].offerId, "t2", null);
  const W = WEEKS_PER_YEAR * 2 + 24;
  s = { ...s, week: W, horses: s.horses.map((h) => ({ ...h, birthYear: 1, state: { ...h.state, fitness: 90, fatigue: 0 } })) };
  for (let i = 0; i < 2; i++) {
    const h = s.horses[0];
    const p = thisWeekCard(s).find((x) => !entryProblem(s, h, x))!;
    s = runOwnerRace(s, h.id, p.id, { style: "stalker", pace: "normal", spurt: "normal" }, 40 + i).save;
    s = { ...s, week: s.week + 3, horses: s.horses.map((x) => ({ ...x, state: { ...x.state, fatigue: 0, fitness: 90 } })) };
  }
  return s;
}

/** 以前のバージョンが保存していた形のコメント（内部の数値から断定していた） */
function withOldComments(s: OwnerSave): OwnerSave {
  const old = (i: number) => `${findTrainer(s.races[i].trainerId)!.name}調教師「4馬身差の6着でした。直線で前が詰まる不利がありました。残り320mあたりで脚が上がっています。やはり今回は無理をさせたと思います。」`;
  const races = s.races.map((r, i) => ({ ...r, trainerComment: old(i) }));
  const horses = s.horses.map((h) => ({
    ...h,
    log: h.log.map((e) => {
      const i = s.races.findIndex((r) => r.horseId === h.id && r.week === e.week && r.trainerComment === e.text);
      return i >= 0 ? { ...e, text: old(i) } : e;
    }),
  }));
  return { ...s, races, horses };
}

test("以前のバージョンのコメントは、読み込み時にレース記録から作り直す（セーブの形式は変えない）", () => {
  const fresh = raced();
  assert.equal(fresh.races.length, 2);
  const old = withOldComments(fresh);
  assert.ok(old.horses[0].log.some((e) => e.text.includes("脚が上がって")), "準備：ログにも古いコメントがある");

  const kv = memStore();
  writeSave(kv, old);
  const loaded = loadSave(kv).save!;
  assert.equal(loaded.version, OWNER_SAVE_VERSION);
  // コメントは記録から作り直したものに戻り、ログの同じ文も置き換わる
  assert.deepEqual(loaded.races.map((r) => r.trainerComment), fresh.races.map((r) => r.trainerComment));
  assert.ok(!JSON.stringify(loaded).includes("脚が上がって"));
  assert.ok(!JSON.stringify(loaded).includes("無理をさせた"));
  // コメント以外は変わらない
  const strip = (s: OwnerSave) => ({ ...s, races: s.races.map((r) => ({ ...r, trainerComment: "" })), horses: s.horses.map((h) => ({ ...h, log: h.log.map((e) => ({ ...e, text: e.kind === "report" ? "" : e.text })) })) });
  assert.deepEqual(strip(loaded), strip(old));
  // 書き出し・読み込みでも同じ
  assert.deepEqual(importSave(exportSave(old)), loaded);
});

test("コメントの作り直しは何度実行しても同じで、新しいセーブは変えない", () => {
  const s = raced();
  assert.equal(refreshRaceComments(s), s, "新しいセーブはそのまま");
  const once = refreshRaceComments(withOldComments(s));
  assert.deepEqual(refreshRaceComments(once), once);
});

test("読み込んだセーブのレース記録から作る報告とコメントは、記録と矛盾しない", () => {
  const loaded = importSave(exportSave(withOldComments(raced())));
  for (const r of loaded.races) {
    const rep = buildRaceReport(r, loaded.races);
    const c = composeTrainerComment(rep, findTrainer(r.trainerId)!.name);
    assert.deepEqual(checkReport(r, rep, c), []);
    assert.equal(r.trainerComment, c.text);
  }
});
