import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STARTER_TEMPLATES,
  applyRaceAftermath,
  applyRest,
  applyTraining,
  canRace,
  canTrain,
  createRng,
  createStarterHorse,
  prizeFor,
  validateHorseName,
  ECONOMY,
  type Horse,
} from "../src/index";

function starter(): Horse {
  return createStarterHorse(STARTER_TEMPLATES[1], { id: "h1", ownerId: "p1" }, "テストホース", createRng(1));
}

test("初期馬はテンプレートに近い能力で作られる", () => {
  const h = starter();
  for (const k of Object.keys(h.stats) as (keyof Horse["stats"])[]) {
    assert.ok(Math.abs(h.stats[k] - STARTER_TEMPLATES[1].base[k]) <= 4);
    assert.ok(h.potential[k] > h.stats[k]);
  }
  assert.equal(h.fatigue, 0);
  assert.equal(h.condition, 0);
});

test("調教で対象能力が伸び、疲労がたまる", () => {
  const h = starter();
  const r = applyTraining(h, "speed", createRng(5));
  assert.ok(r.horse.stats.speed > h.stats.speed);
  assert.ok(r.horse.fatigue >= 12 && r.horse.fatigue <= 18);
  assert.equal(h.stats.speed, starter().stats.speed, "元のオブジェクトは変更しない");
});

test("能力は成長上限を超えない", () => {
  let h = starter();
  const rng = createRng(3);
  for (let i = 0; i < 300; i++) {
    if (canTrain(h)) h = applyRest(h, rng).horse;
    else h = applyTraining(h, "stamina", rng).horse;
  }
  assert.ok(h.stats.stamina <= h.potential.stamina);
  assert.ok(h.stats.stamina >= h.potential.stamina - 3, "十分に調教すれば上限付近まで伸びる");
});

test("疲労が高い状態での調教は故障することがあり、故障中は調教・出走不可", () => {
  let injuredSeen = 0;
  for (let s = 0; s < 200; s++) {
    const h = { ...starter(), fatigue: 95 };
    const r = applyTraining(h, "power", createRng(s));
    if (r.injured) {
      injuredSeen++;
      assert.ok(canTrain(r.horse));
      assert.ok(canRace(r.horse));
      // 休養3回で回復
      let x = r.horse;
      const rng = createRng(s);
      for (let i = 0; i < 3; i++) x = applyRest(x, rng).horse;
      assert.equal(x.injuryRestsLeft, 0);
    }
  }
  assert.ok(injuredSeen > 0);
  // 疲労が低ければ故障しない
  for (let s = 0; s < 200; s++) assert.equal(applyTraining(starter(), "power", createRng(s)).injured, false);
});

test("休養で疲労が回復する", () => {
  const h = { ...starter(), fatigue: 70 };
  const r = applyRest(h, createRng(2));
  assert.equal(r.horse.fatigue, 30);
});

test("疲労80以上は出走できない", () => {
  assert.equal(canRace({ ...starter(), fatigue: 79 }), null);
  assert.ok(canRace({ ...starter(), fatigue: 80 }));
});

test("レース後に戦績と疲労が更新される", () => {
  const h = applyRaceAftermath(starter(), 1, 500_000, createRng(1));
  assert.equal(h.races, 1);
  assert.equal(h.wins, 1);
  assert.equal(h.totalPrize, 500_000);
  assert.ok(h.fatigue >= 22);
});

test("馬名の検証", () => {
  assert.equal(validateHorseName("ミドリノカゼ"), null);
  assert.equal(validateHorseName("Blue Comet"), null);
  assert.ok(validateHorseName("ア"));
  assert.ok(validateHorseName("<script>"));
  assert.ok(validateHorseName("あいうえおかきくけこさしす"));
  assert.ok(validateHorseName(123));
});

test("賞金：1着が最も多く、全頭に出走手当がつく", () => {
  assert.equal(prizeFor(1, 8), 600_000 + ECONOMY.appearanceFee);
  assert.equal(prizeFor(2, 2), 60_000 + ECONOMY.appearanceFee);
  assert.equal(prizeFor(9, 8), ECONOMY.appearanceFee);
  assert.ok(prizeFor(1, 2) > prizeFor(2, 2));
});
