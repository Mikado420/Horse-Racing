// 着差の調整を1つずつ加えたときの変化（同じ番組・同じCPU馬・同じシード）。
// 「変更前の設定」から、変更を1つずつ積み上げた場合と、1つだけ入れた場合の両方を表示する。
//   npx tsx scripts/margin-steps.ts [出力.json]
import fs from "node:fs";
import { LEGACY_RACE_V20, RACE_V21, withConfig, type GameConfig } from "../shared/src/index";
import { collect, summarize } from "./margin-stats";

type Race = Partial<GameConfig["race"]>;
// v2.1 の調整を一つずつ積み上げる（既定の計算は v3 になったので、v2.1 の設定を基準にする）
const now = withConfig({ race: RACE_V21 }).race;
const STEPS: [string, Race][] = [
  ["① 馬群について行く", { followRange: now.followRange, followMaxFraction: now.followMaxFraction }],
  ["② エネルギーの配分（有酸素分・配分）", { aerobicRate: now.aerobicRate, energyScale: now.energyScale, staminaPacing: now.staminaPacing }],
  ["③ 距離に応じた道中のペース", { cruisePerKm: now.cruisePerKm }],
  ["④ 競り合いの効果を連続に", { duelTaper: now.duelTaper }],
  ["⑤ エネルギー切れの手前から徐々に失速", { fadeReserve: now.fadeReserve }],
  ["⑥ 馬ごとの速度差の換算を縮める", { differenceScale: now.differenceScale }],
  ["⑦ スタートのばらつきを縮める", { startDelayScale: now.startDelayScale }],
];

function row(label: string, race: Race) {
  const s = summarize(label, collect(1, 6, withConfig({ race })));
  return {
    label,
    lengthsMedian: s.lengths12.median,
    lengthsP90: s.lengths12.p90,
    t00: s.t00Rate,
    t05: s.t05Rate,
    big: s.bigRate,
    pct12: s.pct12,
    pct13: s.pct13,
    t1L: s.t1L.median,
    topAbilityWin: s.topAbilityWin,
    rankCorr: s.rankCorr,
    emptied: s.emptiedRate,
  };
}

const cumulative = [row("変更前", { ...LEGACY_RACE_V20 })];
let acc: Race = { ...LEGACY_RACE_V20 };
for (const [label, patch] of STEPS) {
  acc = { ...acc, ...patch };
  cumulative.push(row(`＋${label}`, acc));
}
const single = STEPS.map(([label, patch]) => row(`${label}だけ`, { ...LEGACY_RACE_V20, ...patch }));

const head =
  "| 設定 | 着差中央値（馬身） | 90% | 0.05秒未満 | 0.5秒以上 | 大差 | 1-2着（勝ち時計比） | 1-3着（同） | 1-最下位（秒） | 能力1位の勝率 | 能力順と着順の相関 | エネルギー切れ |\n|---|---|---|---|---|---|---|---|---|---|---|---|";
const fmt = (r: ReturnType<typeof row>) =>
  `| ${r.label} | ${r.lengthsMedian} | ${r.lengthsP90} | ${r.t00}% | ${r.t05}% | ${r.big}% | ${r.pct12}% | ${r.pct13}% | ${r.t1L} | ${r.topAbilityWin}% | ${r.rankCorr} | ${r.emptied}% |`;
console.log("積み上げ（シード組1・2,064レース）\n" + head + "\n" + cumulative.map(fmt).join("\n"));
console.log("\n1つだけ入れた場合\n" + head + "\n" + single.map(fmt).join("\n"));
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify({ cumulative, single }, null, 2));
