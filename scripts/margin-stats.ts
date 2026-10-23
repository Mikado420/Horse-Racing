// 着差の統計（実装指示書「レース着差の現実化と競走結果のバランス改善」3章）。
//
// 使い方：
//   npx tsx scripts/margin-stats.ts                       … 集計して表を表示
//   npx tsx scripts/margin-stats.ts out.json              … 集計結果を JSON にも保存
//   npx tsx scripts/margin-stats.ts out.json --legacy     … 変更前の計算（LEGACY_RACE_V20）で集計
//   npx tsx scripts/margin-stats.ts out.json --seeds 4,5,6 … 別のシード組で集計
//
// 同じ番組（週番号から決まる）・同じCPU馬（シードから決まる）・同じレースのシードで走らせるので、
// 計算式を変える前後で同じ条件の比較ができる。シードは複数組（SEED_SETS）を使い、組ごとの差も見る。
import fs from "node:fs";
import {
  CLASS_DEFS,
  STAKES,
  WEEKS_PER_YEAR,
  generateCpuEntries,
  makeCourse,
  raceCard,
  simulateOwnerRace,
  type ClassId,
  type OwnerProgram,
  type GameConfig,
  type SimRunner,
  DEFAULT_CONFIG,
  LEGACY_RACE_V20,
  withConfig,
} from "../shared/src/index";

/** 馬身の換算：ゲーム内の表示と同じ（1馬身 = 2.4m、着差のタイム換算は 16.5m/秒） */
export const LENGTH_M = 2.4;
export const LENGTH_SPEED = 16.5;

export interface RaceRow {
  classId: ClassId;
  distance: number;
  surface: string;
  going: string;
  n: number;
  /** 1着との差（秒）：2着・3着・最下位 */
  t12: number;
  t13: number;
  t1L: number;
  /** 1着がゴールした瞬間の、2着馬・最下位馬との距離差（m） */
  m12: number;
  m1L: number;
  /** 表示上の着差（馬身。1着と2着） */
  lengths12: number;
  /** 出走馬の総合能力（6能力の平均）の最大−最小、勝ち馬の総合能力の順位 */
  abilitySpread: number;
  winnerAbilityRank: number;
  /** 総合能力の1位と2位の差 */
  topAbilityGap: number;
  /** 総合能力の順位と着順の順位相関（スピアマン） */
  rankCorr: number;
  /** エネルギーが尽きた馬の数、最後の200mの平均速度が、最後の600mでの最高速度の92%を下回った馬の数、残り400mから3つ以上順位を落とした馬の数 */
  emptied: number;
  faded: number;
  dropped: number;
  /** 勝ち時計（秒） */
  winTime: number;
}

const overall = (r: Omit<SimRunner, "gate">) => {
  const a = r.abilities;
  return (a.speed + a.acceleration + a.stamina + a.power + a.fightingSpirit + a.raceSense) / 6;
};

/** 1着がゴールした時刻での、ある馬の走行距離（フレームの線形補間） */
function distanceAt(frames: number[][], sampleDt: number, idx: number, t: number): number {
  const k = t / sampleDt;
  const i = Math.min(frames.length - 2, Math.floor(k));
  const f = k - i;
  return frames[i][idx] + (frames[i + 1][idx] - frames[i][idx]) * f;
}

export function runOne(p: OwnerProgram, seed: number, cfg: GameConfig = DEFAULT_CONFIG): RaceRow {
  const cpus = generateCpuEntries(p, p.fieldSize, seed);
  const runners: SimRunner[] = cpus.map((c, i) => ({ ...c.runner, gate: i + 1 }));
  const sim = simulateOwnerRace(runners, { course: p.course, going: p.going }, (seed * 7 + 13) >>> 0, cfg);
  const res = sim.results;
  const t1 = res[0].timeMs / 1000;
  const order = [...runners].sort((a, b) => a.gate - b.gate); // frames の列順
  const col = (id: string) => order.findIndex((r) => r.id === id);
  const D = p.course.distance;
  const ab = runners.map((r) => ({ id: r.id, v: overall(r) })).sort((a, b) => b.v - a.v);
  let emptied = 0, faded = 0, dropped = 0;
  for (const r of runners) {
    const tel = sim.telemetry[r.id];
    if (tel.emptyRemain !== null) emptied++;
    if (tel.lastSegSpeed < tel.topSpeedLate * 0.92) faded++;
    const at400 = tel.positions.find((x) => x.remain === 400)?.pos;
    const fin = res.find((x) => x.id === r.id)!.position;
    if (at400 !== undefined && fin - at400 >= 3) dropped++;
  }
  return {
    classId: p.classId,
    distance: D,
    surface: p.course.surface,
    going: p.going,
    n: runners.length,
    t12: res[1].timeMs / 1000 - t1,
    t13: res[2].timeMs / 1000 - t1,
    t1L: res[res.length - 1].timeMs / 1000 - t1,
    m12: D - distanceAt(sim.frames, sim.sampleDt, col(res[1].id), t1),
    m1L: D - distanceAt(sim.frames, sim.sampleDt, col(res[res.length - 1].id), t1),
    lengths12: ((res[1].timeMs - res[0].timeMs) / 1000) * LENGTH_SPEED / LENGTH_M,
    abilitySpread: ab[0].v - ab[ab.length - 1].v,
    winnerAbilityRank: ab.findIndex((x) => x.id === res[0].id) + 1,
    topAbilityGap: ab[0].v - ab[1].v,
    rankCorr: (() => {
      const n = runners.length;
      let d2 = 0;
      ab.forEach((x, k) => {
        const fin = res.findIndex((y) => y.id === x.id);
        d2 += (k - fin) ** 2;
      });
      return 1 - (6 * d2) / (n * (n * n - 1));
    })(),
    emptied,
    faded,
    dropped,
    winTime: t1,
  };
}

/** 集計に使う番組：通常の番組（6年分）と、全重賞（各年） */
export function programs(years = 6): OwnerProgram[] {
  const out: OwnerProgram[] = [];
  for (let w = WEEKS_PER_YEAR; w < WEEKS_PER_YEAR * (years + 1); w++) {
    for (const p of raceCard(w)) if (p.classId !== "stakes") out.push(p);
  }
  for (let y = 1; y <= years * 4; y++) {
    for (const s of STAKES) {
      out.push({
        id: `stat-${y}-${s.key}`,
        week: y * WEEKS_PER_YEAR,
        name: s.name,
        classId: "stakes",
        course: makeCourse(s.track, s.surface, s.distance),
        going: (["good", "good", "good", "yielding", "soft"] as const)[y % 5],
        fieldSize: 8,
        firstPrize: CLASS_DEFS.stakes.firstPrize,
        ageMin: s.ageMin,
        ageMax: s.ageMax,
        conditionText: "",
        named: true,
      });
    }
  }
  return out;
}

export const SEED_SETS = [1, 2, 3];

export function collect(seedSet: number, years = 6, cfg: GameConfig = DEFAULT_CONFIG): RaceRow[] {
  return programs(years).map((p, i) => runOne(p, (Math.imul(seedSet, 0x9e3779b1) + i * 2654435761) >>> 0, cfg));
}

/* ---------------- 集計 ---------------- */

const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const r2 = (x: number) => Math.round(x * 100) / 100;
const pct = (x: number) => Math.round(x * 1000) / 10;

export interface Summary {
  label: string;
  races: number;
  lengths12: { median: number; p90: number; p95: number };
  t12: { median: number; p90: number; p95: number };
  m12: { median: number; p90: number };
  t13: { median: number; p90: number };
  t1L: { median: number; p90: number };
  m1L: { median: number };
  /** 着差の区分ごとの割合（%）：ハナ〜クビ（0.45馬身未満）・1馬身未満・3馬身以上・大差（10馬身超） */
  closeRate: number;
  under1Rate: number;
  over3Rate: number;
  bigRate: number;
  /** タイム差での区分（%）：0.05秒未満（公式の「0.0秒差」に相当）・0.5秒以上 */
  t00Rate: number;
  t05Rate: number;
  /** 勝ち時計に対する差の平均（%）：1-2着・1-3着（英国の研究と同じ定義で比べるため） */
  pct12: number;
  pct13: number;
  /** 総合能力1位の馬の勝率（%） */
  topAbilityWin: number;
  /** 総合能力の順位と着順の順位相関の平均 */
  rankCorr: number;
  /** 1頭あたりの割合（%）：エネルギー切れ・最後の200mの大失速・残り400mから3つ以上後退 */
  emptiedRate: number;
  fadedRate: number;
  droppedRate: number;
  abilitySpread: number;
}

export function summarize(label: string, rows: RaceRow[]): Summary {
  const L = rows.map((r) => r.lengths12);
  const per = (f: (r: RaceRow) => number) => pct(rows.reduce((a, r) => a + f(r), 0) / rows.reduce((a, r) => a + r.n, 0));
  return {
    label,
    races: rows.length,
    lengths12: { median: r2(q(L, 0.5)), p90: r2(q(L, 0.9)), p95: r2(q(L, 0.95)) },
    t12: { median: r2(q(rows.map((r) => r.t12), 0.5)), p90: r2(q(rows.map((r) => r.t12), 0.9)), p95: r2(q(rows.map((r) => r.t12), 0.95)) },
    m12: { median: r2(q(rows.map((r) => r.m12), 0.5)), p90: r2(q(rows.map((r) => r.m12), 0.9)) },
    t13: { median: r2(q(rows.map((r) => r.t13), 0.5)), p90: r2(q(rows.map((r) => r.t13), 0.9)) },
    t1L: { median: r2(q(rows.map((r) => r.t1L), 0.5)), p90: r2(q(rows.map((r) => r.t1L), 0.9)) },
    m1L: { median: r2(q(rows.map((r) => r.m1L), 0.5)) },
    closeRate: pct(mean(L.map((x) => (x < 0.45 ? 1 : 0)))),
    under1Rate: pct(mean(L.map((x) => (x < 1 ? 1 : 0)))),
    over3Rate: pct(mean(L.map((x) => (x >= 3 ? 1 : 0)))),
    bigRate: pct(mean(L.map((x) => (x > 10 ? 1 : 0)))),
    t00Rate: pct(mean(rows.map((r) => (r.t12 < 0.05 ? 1 : 0)))),
    t05Rate: pct(mean(rows.map((r) => (r.t12 >= 0.5 ? 1 : 0)))),
    pct12: Math.round(mean(rows.map((r) => (100 * r.t12) / r.winTime)) * 1000) / 1000,
    pct13: Math.round(mean(rows.map((r) => (100 * r.t13) / r.winTime)) * 1000) / 1000,
    topAbilityWin: pct(mean(rows.map((r) => (r.winnerAbilityRank === 1 ? 1 : 0)))),
    rankCorr: r2(mean(rows.map((r) => r.rankCorr))),
    emptiedRate: per((r) => r.emptied),
    fadedRate: per((r) => r.faded),
    droppedRate: per((r) => r.dropped),
    abilitySpread: r2(mean(rows.map((r) => r.abilitySpread))),
  };
}

export function breakdown(rows: RaceRow[]): Summary[] {
  const groups: [string, (r: RaceRow) => boolean][] = [
    ["全体", () => true],
    ["下級（新馬・未勝利）", (r) => r.classId === "newcomer" || r.classId === "maiden"],
    ["中級（1勝・2勝）", (r) => r.classId === "c1" || r.classId === "c2"],
    ["上級（オープン）", (r) => r.classId === "open"],
    ["重賞", (r) => r.classId === "stakes"],
    ["短距離（〜1400m）", (r) => r.distance <= 1400],
    ["マイル（〜1800m）", (r) => r.distance > 1400 && r.distance <= 1800],
    ["中距離（〜2400m）", (r) => r.distance > 1800 && r.distance <= 2400],
    ["長距離（2500m〜）", (r) => r.distance > 2400],
    ["良馬場", (r) => r.going === "good"],
    ["道悪", (r) => r.going !== "good"],
  ];
  return groups.map(([label, f]) => summarize(label, rows.filter(f))).filter((s) => s.races > 0);
}

export function table(rows: Summary[]): string {
  const head = "| 条件 | レース | 着差中央値（馬身） | 90% | 95% | 0.45馬身未満 | 1馬身未満 | 3馬身以上 | 大差 | 0.05秒未満 | 0.5秒以上 | 1-2着（勝ち時計比・平均） | 1-3着（同） | 1-2着 中央値（秒） | 1-3着（秒） | 1-最下位（秒） | 能力1位の勝率 | 能力順と着順の相関 | エネルギー切れ | 大失速 | 3つ以上後退 | 能力差（最大−最小） |";
  const sep = "|" + "---|".repeat(22);
  const lines = rows.map(
    (s) =>
      `| ${s.label} | ${s.races} | ${s.lengths12.median} | ${s.lengths12.p90} | ${s.lengths12.p95} | ${s.closeRate}% | ${s.under1Rate}% | ${s.over3Rate}% | ${s.bigRate}% | ${s.t00Rate}% | ${s.t05Rate}% | ${s.pct12}% | ${s.pct13}% | ${s.t12.median} | ${s.t13.median} | ${s.t1L.median} | ${s.topAbilityWin}% | ${s.rankCorr} | ${s.emptiedRate}% | ${s.fadedRate}% | ${s.droppedRate}% | ${s.abilitySpread} |`,
  );
  return [head, sep, ...lines].join("\n");
}

// 使い方：npx tsx scripts/margin-stats.ts [出力.json] [--legacy] [--seeds 1,2,3]
if (process.argv[1] && process.argv[1].endsWith("margin-stats.ts")) {
  const args = process.argv.slice(2);
  const legacy = args.includes("--legacy");
  const si = args.indexOf("--seeds");
  const seeds = si >= 0 ? args[si + 1].split(",").map(Number) : SEED_SETS;
  const out = args.find((a, i) => !a.startsWith("--") && (si < 0 || i !== si + 1));
  const cfg = legacy ? withConfig({ race: LEGACY_RACE_V20 }) : DEFAULT_CONFIG;
  const all: RaceRow[] = [];
  const perSet: Summary[] = [];
  for (const s of seeds) {
    const rows = collect(s, 6, cfg);
    all.push(...rows);
    perSet.push(summarize(`シード組${s}`, rows));
  }
  const res = { config: legacy ? "legacy" : "current", seeds, all: breakdown(all), perSet };
  console.log(table(res.all));
  console.log();
  console.log(table(res.perSet));
  if (out) fs.writeFileSync(out, JSON.stringify(res, null, 2));
}
