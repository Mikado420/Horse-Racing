import { ECONOMY, type PlayerProfile } from "@owners/shared";
import { hashPassword, verifyPassword } from "../auth/password";
import { isUniqueViolation, type Queryable } from "../db/db";
import { conflict, notFound, unauthorized } from "../http/errors";
import { PLAYER_COLS, toPlayer, type PlayerRow } from "./mappers";

export async function registerPlayer(db: Queryable, username: string, password: string): Promise<PlayerProfile> {
  const hash = await hashPassword(password);
  try {
    const { rows } = await db.query<PlayerRow>(
      `INSERT INTO players (username, password_hash, money) VALUES ($1, $2, $3) RETURNING ${PLAYER_COLS}`,
      [username, hash, ECONOMY.startingMoney],
    );
    return toPlayer(rows[0]);
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("このユーザー名は既に使われています");
    throw e;
  }
}

export async function loginPlayer(db: Queryable, username: string, password: string): Promise<PlayerProfile> {
  const { rows } = await db.query<PlayerRow>(`SELECT ${PLAYER_COLS} FROM players WHERE lower(username) = lower($1)`, [
    username,
  ]);
  // ユーザーの有無が推測されないよう、同じメッセージを返す
  if (rows.length === 0 || !(await verifyPassword(password, rows[0].password_hash))) {
    throw unauthorized("ユーザー名またはパスワードが違います");
  }
  return toPlayer(rows[0]);
}

export async function getPlayer(db: Queryable, id: string): Promise<PlayerProfile> {
  const { rows } = await db.query<PlayerRow>(`SELECT ${PLAYER_COLS} FROM players WHERE id = $1`, [id]);
  if (rows.length === 0) throw notFound("プレイヤーが見つかりません");
  return toPlayer(rows[0]);
}
