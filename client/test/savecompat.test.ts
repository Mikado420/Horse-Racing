// レース計算の再設計（feature/race-sim-v2）より前に作られたセーブデータが、そのまま読み込めて遊べること
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { advanceWeek, analyzeRace, applyRaceAnalysis, entryProblem, runOwnerRace, thisWeekCard, type OwnerSave } from "@owners/shared";
import { SAVE_KEY, loadSave, parseSave } from "../src/offline/storage";
import { buildVM } from "../src/owner/vm";

// 再設計前の main（コミット 936ce56）の自動プレイで作ったセーブ（ペース・余力などの新しい記録項目を持たない）
const OLD = readFileSync(new URL("./fixtures/save-before-race-sim-v2.json", import.meta.url), "utf8");

test("再設計前のセーブデータを読み込める（変換・初期化なし）", () => {
  const raw = JSON.parse(OLD);
  const save = parseSave(raw);
  assert.equal(save.version, raw.version);
  assert.ok(save.races.length >= 3);
  // 古い記録には新しい項目がない
  for (const r of save.races) {
    assert.equal(r.pace, undefined);
    assert.equal(r.telemetry.reserve, undefined);
  }
  // loadSave 経由でもそのまま読める（控えを取るだけで中身は変えない）
  const kv = new Map<string, string>();
  const store = { getItem: (k: string) => kv.get(k) ?? null, setItem: (k: string, v: string) => void kv.set(k, v), removeItem: (k: string) => void kv.delete(k) };
  store.setItem(SAVE_KEY, OLD);
  const res = loadSave(store as never);
  assert.ok(res.save, res.error);
  assert.deepEqual(res.save, raw);
});

test("古いレース記録も分析・表示でき、新しいレースを走らせても過去の記録は再計算されない", () => {
  let s: OwnerSave = parseSave(JSON.parse(OLD));
  const before = JSON.stringify(s.races);
  for (const r of s.races) {
    const f = analyzeRace(r);
    assert.ok(f.length >= 5);
    assert.ok(!f.some((x) => x.title === "レースの流れ"), "ペースの記録がない古いレースでは流れを推測しない");
  }
  assert.ok(buildVM(s, new Set()));
  // 数週進めて新しいレースに出す
  let ran = false;
  for (let w = 0; w < 12 && !ran; w++) {
    for (const h of s.horses) {
      const p = thisWeekCard(s).find((x) => !entryProblem(s, h, x));
      if (!p) continue;
      s = runOwnerRace(s, h.id, p.id, { style: "closer", pace: "normal", spurt: "normal" }, 99).save;
      ran = true;
      break;
    }
    if (!ran) s = advanceWeek(s, 500 + w).save;
  }
  assert.ok(ran, "新しいレースに出走できた");
  const latest = s.races[0]; // 新しい記録は先頭に入る
  assert.ok(latest.pace && ["slow", "average", "high"].includes(latest.pace.label));
  assert.ok(Array.isArray(latest.telemetry.reserve));
  s = applyRaceAnalysis(s, latest.raceId).save;
  // 過去の記録はそのまま
  const oldIds = new Set((JSON.parse(before) as { raceId: string }[]).map((r) => r.raceId));
  assert.equal(JSON.stringify(s.races.filter((r) => oldIds.has(r.raceId)).map((r) => ({ ...r, analyzed: false }))), JSON.stringify((JSON.parse(before) as object[]).map((r) => ({ ...r, analyzed: false }))));
  assert.ok(analyzeRace(latest).some((x) => x.title === "レースの流れ"));
});
