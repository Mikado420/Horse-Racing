// 自動プレイ（バランス検証用）：単純な方針で1頭の競走生活を最後まで進める
import { CAREER_TURNS, ECONOMY, RACE_PROGRAMS, STAT_KEYS, careerLeft, createRng, type Horse } from "@owners/shared";
import * as E from "../src/offline/engine";

export interface BotLog { races: number; wins: number; byProgram: Record<string, { runs: number; wins: number }>; money: number; prize: number; trained: number; horse: Horse }

export function playCareer(template: string, seed: number): BotLog {
  const rng = createRng(seed);
  const next = () => Math.floor(rng() * 2 ** 31);
  let s = E.newGame("ボット", next());
  s = E.selectStarter(s, template, "ボットホース", next());
  const id = s.horses[0].id;
  const byProgram: BotLog["byProgram"] = {};
  let trained = 0, sinceRace = 0;
  for (let guard = 0; guard < 500; guard++) {
    const h = s.horses.find((x) => x.id === id)!;
    if (careerLeft(h) === 0) break;
    if (h.injuryRestsLeft > 0 || h.fatigue >= 55 || h.condition <= -1) { s = E.rest(s, id, next()).save; continue; }
    // 出走できる番組のうち期待収支が最もよいもの
    const options = RACE_PROGRAMS.filter((p) => !E.entryProblem(s, h, p.id))
      .map((p) => ({ p, est: E.estimateRace(s, id, p.id, 30, next()) }))
      .sort((a, b) => b.est.expectedNet - a.est.expectedNet);
    const wantTrain = sinceRace < 2 && s.player.money >= ECONOMY.trainingCost + 20_000 && h.turns < CAREER_TURNS - 10;
    if (wantTrain || options.length === 0) {
      if (s.player.money < ECONOMY.trainingCost) { s = E.rest(s, id, next()).save; continue; }
      const weakest = STAT_KEYS.filter((k) => h.stats[k] < h.potential[k]).sort((a, b) => h.stats[a] / h.potential[a] - h.stats[b] / h.potential[b])[0] ?? "speed";
      s = E.train(s, id, weakest, next()).save; trained++; sinceRace++; continue;
    }
    const pick = options[0].p;
    const out = E.runRace(s, id, pick.id, next());
    s = out.save; sinceRace = 0;
    byProgram[pick.id] ??= { runs: 0, wins: 0 };
    byProgram[pick.id].runs++;
    if (out.record.position === 1) byProgram[pick.id].wins++;
  }
  const h = s.horses.find((x) => x.id === id)!;
  return { races: h.races, wins: h.wins, byProgram, money: s.player.money, prize: s.player.totalPrize, trained, horse: h };
}
