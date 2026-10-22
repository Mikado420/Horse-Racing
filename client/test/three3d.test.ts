// 3D表示の計算（走りの動き・コースの座標・モデルの形データ）。描画そのものではなく、正しさを数値で確かめる
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCourse, trackPoint } from "@owners/shared";
import { dutyFactor, legTargets, strideFrequency, strideLength, type LegId } from "../src/three/model/gait";
import { TrackFrame } from "../src/three/course/trackFrame";
import { buildAssetData, REGIONS } from "../src/three/model/assetData";

test("歩幅と完歩数：全力で歩幅約7m・毎秒2回強。速いほど歩幅が伸び、接地時間の割合は短くなる", () => {
  assert.ok(Math.abs(strideLength(17) - 7.1) < 0.3);
  const f = strideFrequency(17);
  assert.ok(f > 2.1 && f < 2.7, `完歩数 ${f}`);
  for (let v = 6; v < 18; v++) {
    assert.ok(strideLength(v + 1) >= strideLength(v));
    assert.ok(dutyFactor(v + 1) <= dutyFactor(v));
  }
});

test("着地している蹄は地面に対して止まっている（胴に対して速度 v で後ろへ動く）", () => {
  for (const v of [10, 14, 17]) {
    const f = strideFrequency(v);
    const dt = 0.002;
    for (let ph = 0; ph < 1; ph += 0.01) {
      const a = legTargets(ph, v, "L");
      const b = legTargets(ph + f * dt, v, "L");
      for (const id of Object.keys(a) as LegId[]) {
        if (!a[id].stance || !b[id].stance) continue;
        assert.equal(a[id].y, 0);
        const rel = (b[id].x - a[id].x) / dt; // 胴に対する速度
        assert.ok(Math.abs(rel + v) < 0.05, `${id} が滑っている：${rel.toFixed(2)} m/秒（v=${v}）`);
      }
    }
  }
});

/** 各脚が着地する位相 */
function touchdowns(lead: "L" | "R"): Record<LegId, number> {
  const out = {} as Record<LegId, number>;
  let prev = legTargets(0.999, 17, lead);
  for (let i = 0; i <= 1000; i++) {
    const ph = i / 1000;
    const cur = legTargets(ph, 17, lead);
    for (const id of Object.keys(cur) as LegId[]) if (cur[id].stance && !prev[id].stance && out[id] === undefined) out[id] = ph;
    prev = cur;
  }
  return out;
}

test("交叉襲歩の足順：左手前は 右後→左後→右前→左前、右手前はその左右反対。最後に4本とも浮く", () => {
  const l = touchdowns("L");
  const orderL = (Object.keys(l) as LegId[]).sort((a, b) => l[a] - l[b]);
  assert.deepEqual(orderL, ["hR", "hL", "fR", "fL"]);
  const r = touchdowns("R");
  const orderR = (Object.keys(r) as LegId[]).sort((a, b) => r[a] - r[b]);
  assert.deepEqual(orderR, ["hL", "hR", "fL", "fR"]);
  // 浮いている時間（4本とも地面を離れている）がある
  let flight = 0;
  for (let i = 0; i < 1000; i++) {
    const t = legTargets(i / 1000, 17, "L");
    if (Object.values(t).every((x) => !x.stance)) flight++;
  }
  assert.ok(flight > 150 && flight < 450, `浮いている割合 ${flight / 10}%`);
});

test("止まっているときは4本とも着地して立つ", () => {
  const t = legTargets(0.3, 0, "L");
  for (const x of Object.values(t)) {
    assert.equal(x.stance, true);
    assert.equal(x.y, 0);
  }
});

test("コースの座標：左回りはレース計算の位置と一致し、右回りは奥行きを反転する。nearest は point の逆", () => {
  const left = makeCourse("shiomi", "turf", 1800);
  const right = makeCourse("midorigaoka", "turf", 1800);
  const fl = new TrackFrame(left, 18);
  const fr = new TrackFrame(right, 18);
  for (let s = -left.lapLength; s < left.lapLength; s += 37) {
    const tp = trackPoint(left, s, 5);
    const p = fl.point(s, 5);
    assert.ok(Math.abs(p.x - tp.x) < 1e-9 && Math.abs(p.z - tp.z) < 1e-9);
    const tr = trackPoint(right, s, 5);
    const q = fr.point(s, 5);
    assert.ok(Math.abs(q.x - tr.x) < 1e-9 && Math.abs(q.z + tr.z) < 1e-9);
  }
  for (const f of [fl, fr]) {
    for (let s = 3; s < f.L; s += 53) {
      for (const lat of [0, 6, 15]) {
        const p = f.point(s, lat);
        const n = f.nearest(p.x, p.z);
        const ds = Math.abs(((n.s - s + f.L / 2) % f.L) - f.L / 2);
        assert.ok(ds < 0.01 && Math.abs(n.lateral - lat) < 0.01, `s=${s} lat=${lat} → ${n.s.toFixed(2)}, ${n.lateral.toFixed(2)}`);
      }
    }
  }
  // コーナーの向き：左回りのコーナーは左（+1）、右回りは右（-1）
  assert.equal(fl.point(10, 0).turn, 1);
  assert.equal(fr.point(10, 0).turn, -1);
});

test("コースの高さ：坂のある競馬場はゴール前で約2m上り、1周でつながる。18頭が並べる幅を確保する", () => {
  const f = new TrackFrame(makeCourse("midorigaoka", "turf", 1600), 18);
  const rise = f.elevation(-300) - f.elevation(-460);
  assert.ok(Math.abs(rise - 2) < 0.05, `上り ${rise}`);
  assert.ok(Math.abs(f.elevation(0) - f.elevation(f.L)) < 1e-9);
  // 段差がない（1m ごとの変化が小さい）
  for (let s = 0; s < f.L; s += 1) assert.ok(Math.abs(f.elevation(s + 1) - f.elevation(s)) < 0.05);
  assert.ok(f.width >= 1.25 * 18 + 3);
});

test("馬と騎手の形データ：頂点・面があり、骨の重みの合計が1、部位がすべて決まっている", () => {
  const d = buildAssetData();
  assert.equal(d.horse.length, 3);
  // 細かいものほど面が多い
  assert.ok(d.horse[0].indices.length > d.horse[1].indices.length && d.horse[1].indices.length > d.horse[2].indices.length);
  for (const h of d.horse) {
    const n = h.positions.length / 3;
    assert.ok(n > 500);
    assert.equal(h.indices.length % 3, 0);
    for (let i = 0; i < h.indices.length; i++) assert.ok(h.indices[i] < n);
    for (let v = 0; v < n; v++) {
      const w = h.skinWeight[v * 4] + h.skinWeight[v * 4 + 1] + h.skinWeight[v * 4 + 2] + h.skinWeight[v * 4 + 3];
      assert.ok(Math.abs(w - 1) < 1e-4, `頂点 ${v} の重みの合計 ${w}`);
      assert.ok(h.regions[v] < REGIONS.length);
      assert.ok(h.ao[v] > 0 && h.ao[v] <= 1);
    }
    // 体の大きさ：蹄は地面近く、き甲の高さ（約1.6m）付近まである
    let minY = 9;
    let maxY = -9;
    for (let v = 0; v < n; v++) {
      minY = Math.min(minY, h.positions[v * 3 + 1]);
      maxY = Math.max(maxY, h.positions[v * 3 + 1]);
    }
    assert.ok(minY > -0.03 && minY < 0.03, `蹄の高さ ${minY}`);
    assert.ok(maxY > 2.0 && maxY < 2.3, `いちばん高い所（耳） ${maxY}`);
  }
  for (const j of d.jockey) {
    assert.ok(j.positions.length > 300);
    for (let i = 0; i < j.part.length; i++) assert.ok(j.part[i] >= 0 && j.part[i] <= 8);
  }
});
