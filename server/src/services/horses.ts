import {
  ECONOMY,
  applyRest,
  applyTraining,
  createStarterHorse,
  findTemplate,
  validateHorseName,
  type Horse,
  type Rng,
  type TrainingMenu,
} from "@owners/shared";
import { randomUUID } from "node:crypto";
import { withTx, type Db, type Queryable } from "../db/db";
import { badRequest, conflict, notFound } from "../http/errors";
import { HORSE_COLS, toHorse, toPlayer, PLAYER_COLS, type HorseRow, type PlayerRow } from "./mappers";

export async function listHorses(db: Queryable, ownerId: string): Promise<Horse[]> {
  const { rows } = await db.query<HorseRow>(
    `SELECT ${HORSE_COLS} FROM horses WHERE owner_id = $1 ORDER BY created_at, id`,
    [ownerId],
  );
  return rows.map(toHorse);
}

export async function getOwnedHorse(db: Queryable, ownerId: string, horseId: string, forUpdate = false): Promise<Horse> {
  const { rows } = await db.query<HorseRow>(
    `SELECT ${HORSE_COLS} FROM horses WHERE id = $1 AND owner_id = $2${forUpdate ? " FOR UPDATE" : ""}`,
    [horseId, ownerId],
  );
  if (rows.length === 0) throw notFound("馬が見つかりません");
  return toHorse(rows[0]);
}

async function lockPlayer(tx: Queryable, playerId: string) {
  const { rows } = await tx.query<PlayerRow>(`SELECT ${PLAYER_COLS} FROM players WHERE id = $1 FOR UPDATE`, [playerId]);
  if (rows.length === 0) throw notFound("プレイヤーが見つかりません");
  return toPlayer(rows[0]);
}

async function saveHorseState(tx: Queryable, h: Horse) {
  await tx.query(
    `UPDATE horses SET stats = $2, fatigue = $3, condition = $4, injury_rests_left = $5,
       races = $6, wins = $7, total_prize = $8 WHERE id = $1`,
    [h.id, JSON.stringify(h.stats), h.fatigue, h.condition, h.injuryRestsLeft, h.races, h.wins, h.totalPrize],
  );
}

/** 初期馬の選択（所有馬が0頭のプレイヤーだけが1回選べる） */
export async function selectStarter(db: Db, ownerId: string, templateId: unknown, name: unknown, rng: Rng): Promise<Horse> {
  const template = typeof templateId === "string" ? findTemplate(templateId) : undefined;
  if (!template) throw badRequest("初期馬の種類が正しくありません");
  const nameErr = validateHorseName(name);
  if (nameErr) throw badRequest(nameErr);
  return withTx(db, async (tx) => {
    await lockPlayer(tx, ownerId); // 同時リクエストで2頭作られないよう行ロック
    const { rows } = await tx.query<{ n: string }>(`SELECT count(*) AS n FROM horses WHERE owner_id = $1`, [ownerId]);
    if (Number(rows[0].n) > 0) throw conflict("初期馬は既に選択済みです");
    const horse = createStarterHorse(template, { id: randomUUID(), ownerId }, (name as string).trim(), rng);
    await tx.query(
      `INSERT INTO horses (id, owner_id, name, template, stats, potential, style, aptitude)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        horse.id,
        ownerId,
        horse.name,
        template.id,
        JSON.stringify(horse.stats),
        JSON.stringify(horse.potential),
        horse.style,
        JSON.stringify(horse.aptitude),
      ],
    );
    return horse;
  });
}

export async function trainHorse(db: Db, ownerId: string, horseId: string, menu: TrainingMenu, rng: Rng) {
  return withTx(db, async (tx) => {
    const player = await lockPlayer(tx, ownerId);
    const horse = await getOwnedHorse(tx, ownerId, horseId, true);
    if (player.money < ECONOMY.trainingCost) throw badRequest("所持金が足りません");
    let result;
    try {
      result = applyTraining(horse, menu, rng);
    } catch (e) {
      throw badRequest((e as Error).message);
    }
    await saveHorseState(tx, result.horse);
    const { rows } = await tx.query<{ money: string }>(
      `UPDATE players SET money = money - $2 WHERE id = $1 RETURNING money`,
      [ownerId, ECONOMY.trainingCost],
    );
    return { ...result, money: Number(rows[0].money) };
  });
}

export async function restHorse(db: Db, ownerId: string, horseId: string, rng: Rng) {
  return withTx(db, async (tx) => {
    const horse = await getOwnedHorse(tx, ownerId, horseId, true);
    let result;
    try {
      result = applyRest(horse, rng);
    } catch (e) {
      throw badRequest((e as Error).message);
    }
    await saveHorseState(tx, result.horse);
    return result;
  });
}

export interface HistoryRow {
  raceId: string;
  courseName: string;
  distance: number;
  fieldSize: number;
  position: number;
  timeMs: number;
  prize: number;
  createdAt: string;
}

export async function horseHistory(db: Queryable, horseId: string, limit = 20): Promise<HistoryRow[]> {
  const { rows } = await db.query(
    `SELECT r.id, r.course_name, r.distance, r.field_size, e.position, e.time_ms, e.prize, r.created_at
       FROM race_entries e JOIN races r ON r.id = e.race_id
      WHERE e.horse_id = $1 ORDER BY r.created_at DESC LIMIT $2`,
    [horseId, limit],
  );
  return rows.map((r) => ({
    raceId: r.id,
    courseName: r.course_name,
    distance: r.distance,
    fieldSize: r.field_size,
    position: r.position,
    timeMs: r.time_ms,
    prize: Number(r.prize),
    createdAt: new Date(r.created_at).toISOString(),
  }));
}
