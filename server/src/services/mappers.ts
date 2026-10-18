import type { Aptitude, Horse, PlayerProfile, RunningStyle, Stats } from "@owners/shared";

export interface PlayerRow {
  id: string;
  username: string;
  password_hash: string;
  money: string | number;
  total_prize: string | number;
  races: number;
  wins: number;
}

export interface HorseRow {
  id: string;
  owner_id: string;
  name: string;
  template: string;
  stats: Stats;
  potential: Stats;
  style: RunningStyle;
  aptitude: Aptitude;
  fatigue: number;
  condition: number;
  injury_rests_left: number;
  turns: number;
  races: number;
  wins: number;
  total_prize: string | number;
  retired: boolean;
}

export const PLAYER_COLS = "id, username, password_hash, money, total_prize, races, wins";
export const HORSE_COLS =
  "id, owner_id, name, template, stats, potential, style, aptitude, fatigue, condition, injury_rests_left, turns, races, wins, total_prize, retired";

export function toPlayer(r: PlayerRow): PlayerProfile {
  return {
    id: r.id,
    username: r.username,
    money: Number(r.money),
    totalPrize: Number(r.total_prize),
    races: r.races,
    wins: r.wins,
  };
}

export function toHorse(r: HorseRow): Horse {
  return {
    id: r.id,
    ownerId: r.owner_id,
    name: r.name,
    stats: r.stats,
    potential: r.potential,
    style: r.style,
    aptitude: r.aptitude,
    fatigue: r.fatigue,
    condition: r.condition,
    injuryRestsLeft: r.injury_rests_left,
    turns: r.turns,
    races: r.races,
    wins: r.wins,
    totalPrize: Number(r.total_prize),
    retired: r.retired,
  };
}
