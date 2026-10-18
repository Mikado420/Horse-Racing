// 馬の売買（オフライン版のショップ）と引退時の報奨金
import { STAT_KEYS, type Aptitude, type Grade, type Horse, type RunningStyle, type Stats } from "./types";
import { createRng, pick, randInt } from "./rng";
import { generateHorseName } from "./names";

export interface MarketTier {
  id: "value" | "standard" | "premium";
  label: string;
  price: number;
  base: [number, number];
  potential: [number, number];
}

export const MARKET_TIERS: readonly MarketTier[] = [
  { id: "value", label: "お手ごろ", price: 150_000, base: [40, 50], potential: [85, 100] },
  { id: "standard", label: "期待馬", price: 400_000, base: [48, 58], potential: [96, 112] },
  { id: "premium", label: "良血", price: 1_000_000, base: [55, 64], potential: [106, 124] },
];

export const MAX_STABLE = 5;

export interface MarketOffer {
  offerId: string;
  tier: MarketTier["id"];
  price: number;
  /** 購入時に id と ownerId を付けて厩舎に入る */
  horse: Omit<Horse, "id" | "ownerId">;
}

const STYLES: RunningStyle[] = ["front", "stalker", "closer", "deep"];

function grade(rng: () => number, good: number): Grade {
  const r = rng();
  return r < good ? "A" : r < good + 0.35 ? "B" : r < good + 0.55 ? "C" : "D";
}

export function generateOffer(tier: MarketTier, seed: number, taken: Set<string>): MarketOffer {
  const rng = createRng(seed);
  const stats = {} as Stats;
  const potential = {} as Stats;
  for (const k of STAT_KEYS) {
    stats[k] = randInt(rng, tier.base[0], tier.base[1]);
    potential[k] = Math.max(stats[k] + 10, randInt(rng, tier.potential[0], tier.potential[1]));
  }
  const aptitude: Aptitude = {
    turf: grade(rng, 0.55),
    dirt: grade(rng, 0.3),
    sprint: grade(rng, 0.3),
    mile: grade(rng, 0.5),
    middle: grade(rng, 0.35),
    long: grade(rng, 0.2),
  };
  const name = generateHorseName(rng, taken);
  taken.add(name);
  return {
    offerId: `offer-${seed.toString(36)}`,
    tier: tier.id,
    price: tier.price,
    horse: {
      name,
      stats,
      potential,
      style: pick(rng, STYLES),
      aptitude,
      fatigue: 0,
      condition: 0,
      injuryRestsLeft: 0,
      turns: 0,
      races: 0,
      wins: 0,
      totalPrize: 0,
      retired: false,
    },
  };
}

/** 各ランクから1頭ずつ並べる */
export function generateMarket(seed: number, avoidNames: string[] = []): MarketOffer[] {
  const taken = new Set(avoidNames);
  return MARKET_TIERS.map((t, i) => generateOffer(t, (seed + i * 7919) >>> 0, taken));
}

/** 引退時に受け取る報奨金 */
export function retirementBonus(h: Horse): number {
  return Math.round(h.totalPrize * 0.1 + h.wins * 20_000 + 10_000);
}
