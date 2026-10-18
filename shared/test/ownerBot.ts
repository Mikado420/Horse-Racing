// 自動プレイ（バランス検証用）：単純な方針で馬主モードを進める
import {
  activeHorses,
  advanceWeek,
  applyRaceAnalysis,
  buyHorse,
  chooseStarter,
  createRng,
  entryProblem,
  newOwnerGame,
  runOwnerRace,
  setPolicy,
  suggestedStyle,
  thisWeekCard,
  trainerOpinion,
  TRAINERS,
  bandForDistance,
  type KnowledgeKey,
  type OwnerProgram,
  type OwnerSave,
  type RaceHorse,
} from "../src/index";

export interface OwnerBotLog {
  save: OwnerSave;
  races: number;
  wins: number;
  weeks: number;
  /** 週ごとの所持金 */
  moneyByYear: number[];
  bought: number;
}

/** 推定（knowledge）だけを使って、距離・馬場の合い具合を点数にする */
function fitScore(h: RaceHorse, p: OwnerProgram): number {
  const band = bandForDistance(p.course.distance).key;
  const sk = p.course.surface === "turf" ? "surface_turf" : "surface_dirt";
  const v = (k: KnowledgeKey) => h.knowledge.entries[k].estimatedValue ?? 55;
  return v(band) + v(sk);
}

export function playOwner(seed: number, weeks: number, opts: { analyze?: boolean; buy?: boolean } = {}): OwnerBotLog {
  const rng = createRng(seed);
  const next = () => Math.floor(rng() * 2 ** 31);
  let s = newOwnerGame("ボット", next());
  s = chooseStarter(s, s.starterOffers![0].offerId, TRAINERS[3].id, null);
  let races = 0;
  let wins = 0;
  let bought = 0;
  const moneyByYear: number[] = [];
  for (let i = 0; i < weeks; i++) {
    for (const h of activeHorses(s)) {
      if (h.policy.policy === "growth" && s.week - h.acquiredWeek > 0 && h.birthYear <= Math.floor(s.week / 48) - 1) {
        s = setPolicy(s, h.id, { policy: "earlyDebut" });
      }
      // 出走：条件を満たすレースのうち、調教師が反対しないもの
      const card = thisWeekCard(s);
      const cur = s.horses.find((x) => x.id === h.id)!;
      if (cur.state.fitness < 60 || cur.state.fatigue > 40) continue;
      if (cur.record.lastRaceWeek !== null && s.week - cur.record.lastRaceWeek < 3) continue;
      const options = card
        .filter((p) => !entryProblem(s, cur, p))
        .map((p) => ({ p, op: trainerOpinion(s, cur.id, p.id) }))
        .filter((x) => x.op.stance === "推奨" || x.op.stance === "賛成")
        .map((x) => ({ ...x, fit: fitScore(cur, x.p) }))
        .sort((a, b) => b.fit - a.fit || b.p.firstPrize - a.p.firstPrize);
      if (!options.length) continue;
      const pick = options[0];
      const out = runOwnerRace(s, cur.id, pick.p.id, { style: suggestedStyle(cur), pace: "normal", spurt: "normal" }, next());
      s = out.save;
      races++;
      if (out.record.position === 1) wins++;
      if (opts.analyze !== false) s = applyRaceAnalysis(s, out.record.raceId).save;
    }
    if (opts.buy !== false && activeHorses(s).length < 4 && s.player.money > 2_500_000) {
      const offer = [...s.market.offers].filter((o) => o.price < s.player.money - 1_500_000).sort((a, b) => a.price - b.price)[0];
      if (offer) {
        s = buyHorse(s, offer.offerId, TRAINERS[bought % TRAINERS.length].id, null).save;
        bought++;
      }
    }
    s = advanceWeek(s, next()).save;
    if (s.week % 48 === 0) moneyByYear.push(s.player.money);
  }
  return { save: s, races, wins, weeks, moneyByYear, bought };
}
