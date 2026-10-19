// 自動更新の判断（指示書 21章）：いつ確認し、いつ新しいバージョンへ切り替えてよいか
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHECK_INTERVAL_MS, LAUNCH_APPLY_WINDOW_MS, MIN_CHECK_GAP_MS, blockerLabel, shouldApply, shouldCheck, shouldReloadForOtherTab } from "../src/pwa/policy";

const base = { ready: true, blockers: 0, sinceLaunchMs: 60_000, interacted: true, requested: false };

test("レース観戦中・処理中など、ブロッカーがあるときはどの場面でも切り替えない", () => {
  for (const m of ["hidden", "launch", "unblocked", "manual"] as const) {
    assert.equal(shouldApply(m, { ...base, blockers: 1, requested: true, interacted: false, sinceLaunchMs: 0 }), false, m);
  }
});

test("準備ができていなければ切り替えない", () => {
  assert.equal(shouldApply("manual", { ...base, ready: false }), false);
});

test("画面が裏に回ったとき・「更新を適用」を押したときは切り替える", () => {
  assert.equal(shouldApply("hidden", base), true);
  assert.equal(shouldApply("manual", base), true);
});

test("起動直後でまだ操作していなければその場で切り替え、操作を始めていたら待つ", () => {
  assert.equal(shouldApply("launch", { ...base, interacted: false, sinceLaunchMs: 3000 }), true);
  assert.equal(shouldApply("launch", { ...base, interacted: true, sinceLaunchMs: 3000 }), false);
  assert.equal(shouldApply("launch", { ...base, interacted: false, sinceLaunchMs: LAUNCH_APPLY_WINDOW_MS + 1 }), false);
});

test("処理が終わったときは、「更新を適用」を押して待っていた場合だけ切り替える", () => {
  assert.equal(shouldApply("unblocked", { ...base, requested: false }), false);
  assert.equal(shouldApply("unblocked", { ...base, requested: true }), true);
});

test("ほかのタブが更新したとき、レース中のタブは読み込み直さない", () => {
  assert.equal(shouldReloadForOtherTab(0), true);
  assert.equal(shouldReloadForOtherTab(1), false);
});

test("更新の確認：起動時と手動は必ず、復帰時は10分以上、定期は約45分ごと、裏にいる間はしない", () => {
  const now = 10_000_000;
  assert.equal(shouldCheck("launch", now, now - 1000, false), true);
  assert.equal(shouldCheck("manual", now, now - 1000, true), true);
  assert.equal(shouldCheck("resume", now, now - MIN_CHECK_GAP_MS + 5000, true), false);
  assert.equal(shouldCheck("resume", now, now - MIN_CHECK_GAP_MS, true), true);
  assert.equal(shouldCheck("interval", now, now - 20 * 60 * 1000, true), false);
  assert.equal(shouldCheck("interval", now, now - CHECK_INTERVAL_MS, true), true);
  assert.equal(shouldCheck("interval", now, now - CHECK_INTERVAL_MS, false), false);
  assert.equal(shouldCheck("resume", now, null, true), true);
});

test("ブロッカーの表示名", () => {
  assert.equal(blockerLabel("race"), "レース観戦中");
  assert.equal(blockerLabel("form:shop"), "入力の途中");
});
