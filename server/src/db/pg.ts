// node-postgres を使った本番用の接続
import pg from "pg";
import type { Db } from "./db";

export function createPgPool(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 });
  pool.on("error", (err) => console.error("[db] idle client error", err));
  return pool as unknown as Db;
}
