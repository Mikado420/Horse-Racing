// UI v3「牧場」で追加した表示用データ：出走予定表・今のクラス・毛色（見た目）
import { test } from "node:test";
import assert from "node:assert/strict";
import { WEEKS_PER_YEAR, advanceWeek, chooseStarter, newOwnerGame, toHorseView } from "@owners/shared";
import { buildVM, currentClassLabel, entryOptions, entryOverview } from "../src/owner/vm";
import { COAT_LABELS, coatOf } from "../src/owner/coat";

function ready() {
  let s = newOwnerGame("テスト", 33);
  s = chooseStarter(s, s.starterOffers![0].offerId, "t2", null);
  s = { ...s, week: WEEKS_PER_YEAR * 2 + 24, horses: s.horses.map((h) => ({ ...h, birthYear: 1, state: { ...h.state, fitness: 90 } })) };
  for (let i = 0; i < 2; i++) s = advanceWeek(s, i + 1).save;
  return s;
}

test("出走予定表：出られるレースの中から、調教師の意見がいちばん前向きなものを勧める", () => {
  const s = ready();
  const vm = buildVM(s, new Set());
  const rows = entryOverview(s, vm);
  assert.equal(rows.length, vm.horses.length);
  const row = rows[0];
  const ok = entryOptions(s, row.horse.view.id).filter((o) => !o.problem);
  assert.equal(row.eligible, ok.length);
  if (ok.length === 0) {
    assert.equal(row.best, null);
    assert.ok(row.blocked);
    return;
  }
  const rank = { 推奨: 0, 賛成: 1, 慎重: 2, 反対: 3 } as const;
  const bestRank = Math.min(...ok.map((o) => rank[o.opinion!.stance]));
  assert.ok(row.best);
  assert.equal(rank[row.best!.opinion!.stance], bestRank);
  assert.equal(row.blocked, null);
});

test("出走予定表：まだ出られない馬は理由を示す", () => {
  let s = newOwnerGame("テスト", 34);
  s = chooseStarter(s, s.starterOffers![0].offerId, "t1", null);
  const rows = entryOverview(s, buildVM(s, new Set()));
  assert.equal(rows[0].eligible, 0);
  assert.equal(rows[0].best, null);
  assert.ok(rows[0].blocked && rows[0].blocked.length > 0);
});

test("今のクラスは勝ち数から決まる（出走条件と同じ区分）", () => {
  const s = ready();
  const v = toHorseView(s.horses[0], s.week);
  const at = (races: number, wins: number) => currentClassLabel({ ...v, record: { ...v.record, races, wins } });
  assert.equal(at(0, 0), "新馬");
  assert.equal(at(3, 0), "未勝利");
  assert.equal(at(3, 1), "1勝クラス");
  assert.equal(at(5, 2), "2勝クラス");
  assert.equal(at(9, 4), "オープン");
});

test("毛色は馬ごとに決まり、何度呼んでも変わらない（見た目だけの情報）", () => {
  const ids = Array.from({ length: 200 }, (_, i) => `h${i}`);
  for (const id of ids) {
    assert.equal(coatOf(id), coatOf(id));
    assert.ok(COAT_LABELS[coatOf(id)]);
  }
  // いろいろな毛色が出る
  assert.ok(new Set(ids.map(coatOf)).size >= 4);
});
