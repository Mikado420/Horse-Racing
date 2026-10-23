// 着差の現実化（docs/margins）の回帰テスト。
// 着差だけを後から縮めていないこと（タイム・着順・着差・位置の記録が互いに矛盾しないこと）と、
// 能力差が結果に反映されることを、同じシードで繰り返し確かめる。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ABILITY_KEYS,
  CLASS_DEFS,
  DEFAULT_CONFIG,
  LEGACY_RACE_V20,
  generateCpuEntries,
  makeCourse,
  raceCard,
  simulateOwnerRace,
  withConfig,
  type ClassId,
  type Going,
  type OwnerProgram,
  type SimRunner,
} from "../src/index";

const LENGTH_M = 2.4;

function horse(id: string, gate: number, lvl = 60, extra: Partial<SimRunner> = {}): SimRunner {
  return {
    id,
    gate,
    abilities: Object.fromEntries(ABILITY_KEYS.map((k) => [k, lvl])) as SimRunner["abilities"],
    aptitude: { distanceMin: 1000, distanceMax: 3200, turf: 70, dirt: 70, heavy: 60, right: 70, left: 70, slope: 60, tight: 60, styles: { front: 70, stalker: 70, closer: 70, deep: 70 } },
    traits: [],
    tactics: { style: "stalker", pace: "normal", spurt: "normal" },
    condition: 0,
    fatigue: 0,
    fitness: 85,
    experience: 6,
    ...extra,
  };
}

function program(classId: ClassId, distance: number, going: Going = "good"): OwnerProgram {
  return {
    id: "t",
    week: 60,
    name: "t",
    classId,
    course: makeCourse("midorigaoka", "turf", distance),
    going,
    fieldSize: 8,
    firstPrize: CLASS_DEFS[classId].firstPrize,
    ageMin: 2,
    ageMax: 9,
    conditionText: "",
    named: false,
  };
}

function cpuRace(p: OwnerProgram, seed: number, cfg = DEFAULT_CONFIG) {
  const runners = generateCpuEntries(p, 8, seed).map((c, i) => ({ ...c.runner, gate: i + 1 }));
  return { runners, sim: simulateOwnerRace(runners, { course: p.course, going: p.going }, (seed * 7 + 13) >>> 0, cfg) };
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)];

test("同じ入力・同じシードなら、調整後の計算でも完全に同じ結果になる", () => {
  const p = program("c1", 2000);
  const a = cpuRace(p, 42);
  const b = cpuRace(p, 42);
  assert.deepEqual(a.sim, b.sim);
  const c = cpuRace(p, 43);
  assert.notDeepEqual(a.sim.results, c.sim.results);
});

test("変更前の設定を渡すと、変更前の着差（大差が多い）がそのまま再現される", () => {
  // 計算式の比較のために、変更前の動きを残してあることの確認
  const legacy = withConfig({ race: LEGACY_RACE_V20 });
  const before: number[] = [];
  const after: number[] = [];
  for (let s = 0; s < 60; s++) {
    const p = program("c1", 2000);
    for (const [cfg, out] of [[legacy, before], [DEFAULT_CONFIG, after]] as const) {
      const r = cpuRace(p, s * 2654435761 + 1, cfg).sim.results;
      out.push((r[1].timeMs - r[0].timeMs) / 1000);
    }
  }
  assert.ok(median(before) > 2 * median(after), `${median(before)} vs ${median(after)}`);
});

test("着順・タイム・着差・位置の記録が互いに矛盾しない（着差を後から書き換えていない）", () => {
  for (let s = 0; s < 40; s++) {
    const card = raceCard(60 + s);
    const p = card[s % card.length];
    const { runners, sim } = cpuRace(p, s + 100);
    const res = sim.results;
    const cols = [...runners].sort((a, b) => a.gate - b.gate).map((r) => r.id);
    for (let k = 1; k < res.length; k++) {
      assert.ok(res[k].timeMs >= res[k - 1].timeMs);
      // 表示上の着差は、ゴール時刻の差（16.5m/秒・1馬身2.4m）から計算したもの
      const fromTime = ((res[k].timeMs - res[k - 1].timeMs) / 1000) * 16.5 / LENGTH_M;
      assert.ok(Math.abs(res[k].marginLengths - fromTime) < 0.02, `${res[k].marginLengths} vs ${fromTime}`);
    }
    // 1着がゴールした瞬間に、2着以下はまだゴール手前にいる（位置の記録とタイムが一致）
    const t1 = res[0].timeMs / 1000;
    const i = Math.min(sim.frames.length - 1, Math.floor(t1 / sim.sampleDt));
    for (const r of res.slice(1)) {
      if (r.timeMs - res[0].timeMs < 300) continue; // 補間の誤差の範囲は除く
      assert.ok(sim.frames[i][cols.indexOf(r.id)] < p.course.distance, `${r.id} はまだゴールしていないはず`);
    }
    // 通過順位は各地点で 1..n の並べ替えになっている（リプレイ・分析で使う）
    for (const id of cols) assert.equal(sim.telemetry[id].positions.length, sim.telemetry[cols[0]].positions.length);
    const nCp = sim.telemetry[cols[0]].positions.length;
    for (let k = 0; k < nCp; k++) {
      const ps = cols.map((id) => sim.telemetry[id].positions[k].pos).sort((a, b) => a - b);
      assert.deepEqual(ps, cols.map((_, j) => j + 1));
    }
    // ゴール時の通過順位は着順と同じ
    for (const r of res) assert.equal(sim.telemetry[r.id].positions.at(-1)!.pos, r.position);
  }
});

test("1着と2着の差が、距離帯ごとに現実的な範囲に収まる（大差がまれ）", () => {
  // 目安：英国の重賞の研究では 1-2着の差は勝ち時計の平均 0.32%。ここでは距離帯ごとに 0.15〜0.6% を許す
  for (const D of [1200, 1600, 2400, 3000]) {
    const pcts: number[] = [];
    let big = 0;
    for (let s = 0; s < 80; s++) {
      const r = cpuRace(program("c1", D), s * 97 + D).sim.results;
      const t12 = (r[1].timeMs - r[0].timeMs) / 1000;
      pcts.push((100 * t12) / (r[0].timeMs / 1000));
      if ((t12 * 16.5) / LENGTH_M > 10) big++;
    }
    const meanPct = pcts.reduce((a, b) => a + b, 0) / pcts.length;
    assert.ok(meanPct > 0.15 && meanPct < 0.6, `${D}m 1-2着 ${meanPct.toFixed(3)}%`);
    assert.ok(big <= 6, `${D}m 大差 ${big}/80`);
  }
});

test("能力が上の馬ほど勝ちやすい（同じ能力の7頭の中に1頭だけ強い馬）", () => {
  for (const D of [1200, 1600, 2400]) {
    const course = makeCourse("midorigaoka", "turf", D);
    const rate = (d: number) => {
      let win = 0;
      for (let s = 1; s <= 80; s++) {
        const rs = Array.from({ length: 8 }, (_, i) => horse(`h${i}`, i + 1));
        const g = s % 8;
        rs[g] = horse(`h${g}`, g + 1, 60 + d);
        const sim = simulateOwnerRace(rs, { course, going: "good" }, s * 7919);
        if (sim.results[0].id === `h${g}`) win++;
      }
      return win / 80;
    };
    const r0 = rate(0);
    const r5 = rate(5);
    const r10 = rate(10);
    assert.ok(r5 > r0 && r10 > r5, `${D}m ${r0} ${r5} ${r10}`);
    assert.ok(r10 >= 0.6, `${D}m +10 の勝率 ${r10}`);
  }
});

test("能力が近い馬どうしなら、レースごとに着順が入れ替わる", () => {
  const course = makeCourse("midorigaoka", "turf", 1800);
  const winners = new Set<string>();
  let favoriteWins = 0;
  for (let s = 1; s <= 60; s++) {
    const rs = Array.from({ length: 8 }, (_, i) => horse(`h${i}`, i + 1, 60 + (i === 0 ? 2 : 0)));
    const sim = simulateOwnerRace(rs, { course, going: "good" }, s * 31);
    winners.add(sim.results[0].id);
    if (sim.results[0].id === "h0") favoriteWins++;
  }
  // わずかに強い馬は勝ちやすいが、毎回は勝たない
  assert.ok(winners.size >= 5, `勝った馬 ${winners.size}頭`);
  assert.ok(favoriteWins > 60 / 8 && favoriteWins < 45, `能力が少し上の馬の勝利 ${favoriteWins}/60`);
});

test("スタミナは長い距離ほど効き、短距離ではほとんど差にならない", () => {
  const gain = (D: number) => {
    const course = makeCourse("midorigaoka", "turf", D);
    let sum = 0;
    for (let s = 1; s <= 60; s++) {
      const rs = Array.from({ length: 8 }, (_, i) => horse(`h${i}`, i + 1));
      const g = s % 8;
      rs[g] = horse(`h${g}`, g + 1, 60, { abilities: { ...rs[g].abilities, stamina: 75 } });
      const sim = simulateOwnerRace(rs, { course, going: "good" }, s * 101);
      const me = sim.results.find((r) => r.id === `h${g}`)!;
      const others = sim.results.filter((r) => r.id !== `h${g}`);
      sum += others.reduce((a, r) => a + r.timeMs, 0) / others.length - me.timeMs;
    }
    return sum / 60 / 1000;
  };
  const short = gain(1200);
  const long = gain(3000);
  assert.ok(long > 0.1 && long > short * 3, `1200m ${short.toFixed(3)}秒 / 3000m ${long.toFixed(3)}秒`);
});

test("エネルギーが尽きても速度は連続的に落ち、急に止まったり急加速したりしない", () => {
  for (const D of [1600, 3000]) {
    const course = makeCourse("midorigaoka", "turf", D);
    // スタミナの低い馬・距離が長すぎる馬・行きたがる馬を混ぜる
    const rs = [
      horse("weak", 1, 60, { abilities: { ...horse("x", 1).abilities, stamina: 20 } }),
      horse("short", 2, 60, { aptitude: { ...horse("x", 1).aptitude, distanceMin: 1000, distanceMax: 1400 } }),
      horse("keen", 3, 60, { traits: ["keen"], tactics: { style: "closer", pace: "aggressive", spurt: "early" } }),
      ...Array.from({ length: 5 }, (_, i) => horse(`h${i}`, i + 4)),
    ];
    for (let s = 1; s <= 10; s++) {
      const sim = simulateOwnerRace(rs, { course, going: "soft" }, s);
      const dt = sim.sampleDt;
      for (let col = 0; col < rs.length; col++) {
        let prevV: number | null = null;
        for (let k = 2; k < sim.frames.length; k++) {
          const d0 = sim.frames[k - 1][col];
          const d1 = sim.frames[k][col];
          if (d1 >= D || d0 < 50) continue; // スタート直後とゴール後は除く
          const v: number = (d1 - d0) / dt;
          if (prevV !== null) {
            const dv: number = v - prevV;
            // 加速は加速力の上限（約 3.7m/秒² × 1.15 倍）まで、減速は 1.1m/秒² まで（コーナーの距離ロスの分を少し許す）
            assert.ok(dv < 4.5 * dt + 0.15, `${D}m ${rs[col].id} 急加速 ${dv.toFixed(2)}`);
            assert.ok(dv > -(1.1 * dt + 0.25), `${D}m ${rs[col].id} 急減速 ${dv.toFixed(2)}`);
          }
          prevV = v;
        }
      }
    }
  }
});

test("距離が合う馬が、ゴール前にエネルギーを使い切って大きく失速することはまれ", () => {
  // 変更前は 2500m 以上で 97% の馬がエネルギー切れになっていた（docs/margins）
  let n = 0;
  let collapsed = 0;
  let emptied = 0;
  for (let s = 0; s < 60; s++) {
    for (const D of [1600, 2400, 3000]) {
      const { runners, sim } = cpuRace(program("c2", D), s * 13 + D);
      for (const r of runners) {
        if (D > r.aptitude.distanceMax) continue;
        n++;
        const t = sim.telemetry[r.id];
        if (t.lastSegSpeed < t.topSpeedLate * 0.88) collapsed++;
        if (t.emptyRemain !== null && t.emptyRemain > 50) emptied++;
      }
    }
  }
  assert.ok(collapsed / n < 0.02, `大失速 ${collapsed}/${n}`);
  assert.ok(emptied / n < 0.05, `残り50mより前にエネルギー切れ ${emptied}/${n}`);
});

test("道悪では同じ馬たちの勝ち時計が遅くなり、距離が長いほど平均速度が下がる", () => {
  const speed = (D: number, going: Going) => {
    let sum = 0;
    for (let s = 0; s < 30; s++) {
      const r = cpuRace(program("c1", D, going), s * 7 + 1).sim.results[0];
      sum += D / (r.timeMs / 1000);
    }
    return sum / 30;
  };
  const good = speed(1600, "good");
  const heavy = speed(1600, "heavy");
  assert.ok(heavy < good * 0.99, `良 ${good} 不良 ${heavy}`);
  const v2400 = speed(2400, "good");
  const v3000 = speed(3000, "good");
  // 実際の東京芝（1勝クラス）では 2400m の平均速度は 1600m の約96%
  assert.ok(v2400 < good * 0.985 && v2400 > good * 0.93, `1600m ${good} 2400m ${v2400}`);
  assert.ok(v3000 < v2400, `2400m ${v2400} 3000m ${v3000}`);
});

test("クラスが上がるほど勝ち時計が速いが、差は現実と同じ数%以内に収まる", () => {
  const time = (c: ClassId) => {
    let sum = 0;
    for (let s = 0; s < 40; s++) sum += cpuRace(program(c, 1600), s * 11 + 3).sim.results[0].timeMs / 1000;
    return sum / 40;
  };
  const maiden = time("maiden");
  const c2 = time("c2");
  const stakes = time("stakes");
  assert.ok(maiden > c2 && c2 > stakes, `${maiden} ${c2} ${stakes}`);
  // 東京芝1600m（良）の平均勝ち時計：未勝利 1:34.2 → G1 1:31.9（約2.5%）。ゲームでは 1〜4.5% を許す
  const spread = (maiden - stakes) / stakes;
  assert.ok(spread > 0.01 && spread < 0.045, `未勝利→重賞 ${(100 * spread).toFixed(2)}%`);
});
