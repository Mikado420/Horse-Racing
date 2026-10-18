// レースの確定と精算（賞金・戦績・馬の状態）。すべて1トランザクションで行う。
import {
  ECONOMY,
  MIN_RUNNERS,
  applyRaceAftermath,
  canRace,
  conditionsFromSeed,
  createRng,
  prizeFor,
  purseFor,
  simulateRace,
  type CourseDef,
  type Horse,
  type RaceConditions,
  type RaceSimResult,
  type ResultRow,
} from "@owners/shared";
import { isUniqueViolation, withTx, type Db, type Queryable } from "../db/db";
import { notFound } from "../http/errors";
import { HORSE_COLS, PLAYER_COLS, toHorse, toPlayer, type HorseRow, type PlayerRow } from "./mappers";

export interface EntryRequest {
  gate: number;
  playerId: string;
  horseId: string;
}

export interface SettledRunner {
  gate: number;
  playerId: string;
  playerName: string;
  horseId: string;
  horseName: string;
  style: string;
}

export type SettleOutcome =
  | {
      status: "finished";
      raceId: string;
      conditions: RaceConditions;
      runners: SettledRunner[]; // sim.frames の列順
      sim: RaceSimResult;
      results: ResultRow[];
    }
  | { status: "cancelled"; raceId: string; reason: string; scratched: { horseId: string; reason: string }[] };

export class AlreadySettledError extends Error {
  constructor(raceId: string) {
    super(`race ${raceId} is already settled`);
  }
}

/**
 * 出走馬をDBから読み直して検証し、レースを計算し、賞金と戦績を保存する。
 * - クライアントから送られた能力値は一切使わない（DBの値のみ）
 * - races.id の主キー制約により、同じ raceId で二度精算されることはない
 */
export async function settleRace(
  db: Db,
  raceId: string,
  entries: EntryRequest[],
  course: CourseDef,
  seed: number,
): Promise<SettleOutcome> {
  try {
    return await withTx(db, async (tx) => {
      // デッドロックを避けるため id 順にロック
      const playerIds = [...new Set(entries.map((e) => e.playerId))].sort();
      const horseIds = entries.map((e) => e.horseId).sort();
      const pRows = await tx.query<PlayerRow>(
        `SELECT ${PLAYER_COLS} FROM players WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
        [playerIds],
      );
      const hRows = await tx.query<HorseRow>(
        `SELECT ${HORSE_COLS} FROM horses WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
        [horseIds],
      );
      const players = new Map(pRows.rows.map((r) => [r.id, toPlayer(r)]));
      const horses = new Map(hRows.rows.map((r) => [r.id, toHorse(r)]));

      const scratched: { horseId: string; reason: string }[] = [];
      const valid: { entry: EntryRequest; horse: Horse; playerName: string }[] = [];
      for (const e of [...entries].sort((a, b) => a.gate - b.gate)) {
        const horse = horses.get(e.horseId);
        const player = players.get(e.playerId);
        if (!horse || !player || horse.ownerId !== player.id) {
          scratched.push({ horseId: e.horseId, reason: "所有者が一致しません" });
          continue;
        }
        const err = canRace(horse);
        if (err) {
          scratched.push({ horseId: e.horseId, reason: err });
          continue;
        }
        if (player.money < ECONOMY.entryFee) {
          scratched.push({ horseId: e.horseId, reason: "出走経費が払えません" });
          continue;
        }
        valid.push({ entry: e, horse, playerName: player.username });
      }
      if (valid.length < MIN_RUNNERS) {
        return { status: "cancelled" as const, raceId, reason: "出走可能な馬が不足したためレースは中止になりました", scratched };
      }

      const conditions = conditionsFromSeed(seed, course);
      const sim = simulateRace(
        valid.map((v) => ({
          entryId: v.horse.id,
          gate: v.entry.gate,
          stats: v.horse.stats,
          style: v.horse.style,
          aptitude: v.horse.aptitude,
          fatigue: v.horse.fatigue,
          condition: v.horse.condition,
        })),
        conditions,
        seed,
      );
      const fieldSize = valid.length;
      const runners: SettledRunner[] = valid.map((v) => ({
        gate: v.entry.gate,
        playerId: v.entry.playerId,
        playerName: v.playerName,
        horseId: v.horse.id,
        horseName: v.horse.name,
        style: v.horse.style,
      }));

      // ここで主キー重複なら既に精算済み → 例外でロールバック
      await tx.query(
        `INSERT INTO races (id, course_id, course_name, distance, surface, going, weather, seed, field_size, purse, replay)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          raceId,
          course.id,
          course.name,
          course.distance,
          course.surface,
          conditions.going,
          conditions.weather,
          seed,
          fieldSize,
          purseFor(fieldSize),
          JSON.stringify({ runners, sampleDt: sim.sampleDt, frames: sim.frames, durationSec: sim.durationSec }),
        ],
      );

      const afterRng = createRng(seed ^ 0x5bd1e995);
      const results: ResultRow[] = [];
      for (const r of sim.results) {
        const v = valid.find((x) => x.horse.id === r.entryId)!;
        const prize = prizeFor(r.position, fieldSize);
        await tx.query(
          `INSERT INTO race_entries (race_id, horse_id, player_id, gate, position, time_ms, margin_lengths, prize, horse_name, player_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [raceId, v.horse.id, v.entry.playerId, r.gate, r.position, r.timeMs, r.marginLengths, prize, v.horse.name, v.playerName],
        );
        await tx.query(
          `UPDATE players SET money = money - $2 + $3, total_prize = total_prize + $3,
             races = races + 1, wins = wins + $4 WHERE id = $1`,
          [v.entry.playerId, ECONOMY.entryFee, prize, r.position === 1 ? 1 : 0],
        );
        const after = applyRaceAftermath(v.horse, r.position, prize, afterRng);
        await tx.query(
          `UPDATE horses SET fatigue = $2, condition = $3, races = $4, wins = $5, total_prize = $6 WHERE id = $1`,
          [after.id, after.fatigue, after.condition, after.races, after.wins, after.totalPrize],
        );
        results.push({
          position: r.position,
          gate: r.gate,
          horseId: v.horse.id,
          horseName: v.horse.name,
          playerId: v.entry.playerId,
          playerName: v.playerName,
          timeMs: r.timeMs,
          marginLengths: r.marginLengths,
          prize,
        });
      }
      return { status: "finished" as const, raceId, conditions, runners, sim, results };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AlreadySettledError(raceId);
    throw e;
  }
}

export async function getRace(db: Queryable, raceId: string) {
  const { rows } = await db.query(
    `SELECT id, course_name, distance, surface, going, weather, field_size, purse, replay, created_at FROM races WHERE id = $1`,
    [raceId],
  );
  if (rows.length === 0) throw notFound("レースが見つかりません");
  const r = rows[0];
  const entries = await db.query(
    `SELECT position, gate, horse_id, horse_name, player_id, player_name, time_ms, margin_lengths, prize
       FROM race_entries WHERE race_id = $1 ORDER BY position`,
    [raceId],
  );
  const results: ResultRow[] = entries.rows.map((e) => ({
    position: e.position,
    gate: e.gate,
    horseId: e.horse_id,
    horseName: e.horse_name,
    playerId: e.player_id,
    playerName: e.player_name,
    timeMs: e.time_ms,
    marginLengths: Number(e.margin_lengths),
    prize: Number(e.prize),
  }));
  return {
    id: r.id as string,
    courseName: r.course_name as string,
    distance: r.distance as number,
    surface: r.surface as string,
    going: r.going as string,
    weather: r.weather as string,
    fieldSize: r.field_size as number,
    purse: Number(r.purse),
    createdAt: new Date(r.created_at).toISOString(),
    replay: r.replay,
    results,
  };
}

export async function recentRacesForPlayer(db: Queryable, playerId: string, limit = 20) {
  const { rows } = await db.query(
    `SELECT r.id, r.course_name, r.distance, r.field_size, r.created_at, e.horse_name, e.position, e.prize
       FROM race_entries e JOIN races r ON r.id = e.race_id
      WHERE e.player_id = $1 ORDER BY r.created_at DESC LIMIT $2`,
    [playerId, limit],
  );
  return rows.map((r) => ({
    raceId: r.id as string,
    courseName: r.course_name as string,
    distance: r.distance as number,
    fieldSize: r.field_size as number,
    horseName: r.horse_name as string,
    position: r.position as number,
    prize: Number(r.prize),
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function rankings(db: Queryable, limit = 50) {
  const players = await db.query(
    `SELECT id, username, total_prize, races, wins FROM players
      ORDER BY total_prize DESC, wins DESC, created_at ASC LIMIT $1`,
    [limit],
  );
  const horses = await db.query(
    `SELECT h.id, h.name, p.username, h.total_prize, h.races, h.wins FROM horses h JOIN players p ON p.id = h.owner_id
      ORDER BY h.total_prize DESC, h.wins DESC, h.created_at ASC LIMIT $1`,
    [limit],
  );
  return {
    players: players.rows.map((r, i) => ({
      rank: i + 1,
      playerId: r.id as string,
      username: r.username as string,
      totalPrize: Number(r.total_prize),
      races: r.races as number,
      wins: r.wins as number,
    })),
    horses: horses.rows.map((r, i) => ({
      rank: i + 1,
      horseId: r.id as string,
      horseName: r.name as string,
      owner: r.username as string,
      totalPrize: Number(r.total_prize),
      races: r.races as number,
      wins: r.wins as number,
    })),
  };
}
