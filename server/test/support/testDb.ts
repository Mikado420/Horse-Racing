// テストごとに使い捨てのデータベースを作る
import { randomBytes } from "node:crypto";
import { migrate, type Db } from "../../src/db/db";
import { createMiniPool } from "./minipg";

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";

async function createPool(url: string): Promise<Db> {
  // node-postgres が入っていればそれを使い、無ければテスト用の最小クライアントで代用する
  try {
    const mod = await import("../../src/db/pg");
    return mod.createPgPool(url);
  } catch {
    return createMiniPool(url);
  }
}

export async function createTestDb(): Promise<{ db: Db; url: string; drop: () => Promise<void> }> {
  const name = `horses_test_${randomBytes(4).toString("hex")}`;
  const admin = await createPool(ADMIN_URL);
  await admin.query(`CREATE DATABASE ${name}`);
  const url = ADMIN_URL.replace(/\/[^/]*$/, `/${name}`);
  const db = await createPool(url);
  await migrate(db);
  return {
    db,
    url,
    drop: async () => {
      await db.end();
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}
