// DBアクセスの最小インターフェース。node-postgres の Pool がそのまま満たす形にしてある。

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface QueryResult<T> {
  rows: T[];
  rowCount: number | null;
}

export interface Queryable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T = any>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface DbClient extends Queryable {
  release(): void;
}

export interface Db extends Queryable {
  connect(): Promise<DbClient>;
  end(): Promise<void>;
}

/** トランザクション内で fn を実行する。例外時はロールバック */
export async function withTx<T>(db: Db, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* 接続断などは無視 */
    }
    throw e;
  } finally {
    client.release();
  }
}

export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
}

const here = path.dirname(fileURLToPath(import.meta.url));

export async function migrate(db: Queryable): Promise<void> {
  const sql = await fs.readFile(path.join(here, "schema.sql"), "utf8");
  await db.query(sql);
}
