// レース計算の再設計（feature/race-sim-v2）より前に作られたセーブデータが、そのまま読み込めて遊べること
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { advanceWeek, analyzeRace, applyRaceAnalysis, buildRaceReport, entryProblem, refreshRaceComments, runOwnerRace, thisWeekCard, type OwnerSave } from "@owners/shared";
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
  // loadSave 経由でもそのまま読める（控えを取るだけで中身は変えない）。
  // ただし調教師のレース後コメントだけは、分析の再設計（main の PR #1）の方針どおり記録から作り直される
  // （根拠のない断定を残さないため。形式・レース記録そのものは変えない）
  const kv = new Map<string, string>();
  const store = { getItem: (k: string) => kv.get(k) ?? null, setItem: (k: string, v: string) => void kv.set(k, v), removeItem: (k: string) => void kv.delete(k) };
  store.setItem(SAVE_KEY, OLD);
  const res = loadSave(store as never);
  assert.ok(res.save, res.error);
  assert.deepEqual(res.save, refreshRaceComments(raw));
  const noComments = (x: OwnerSave) => ({
    ...x,
    races: x.races.map((r) => ({ ...r, trainerComment: "" })),
    horses: x.horses.map((h) => ({ ...h, log: h.log.map((e) => (e.kind === "report" ? { ...e, text: "" } : e)) })),
  });
  assert.deepEqual(noComments(res.save!), noComments(raw), "コメント以外は何も変わらない");
});

test("古いレース記録も分析・表示でき、新しいレースを走らせても過去の記録は再計算されない", () => {
  let s: OwnerSave = parseSave(JSON.parse(OLD));
  const before = JSON.stringify(s.races);
  for (const r of s.races) {
    const f = analyzeRace(r);
    assert.ok(f.length >= 5);
    // 流れ（ペース）は記録に残っているラップから判断する（計算内部のペース指数がない古い記録でも同じ方法）
    assert.ok(buildRaceReport(r).facts.laps.length > 0);
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
  assert.ok(buildRaceReport(latest).facts.pace !== null);
});
