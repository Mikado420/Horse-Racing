// npm run migrate で手動実行する場合のエントリーポイント（サーバー起動時にも自動実行される）
import { loadConfig } from "../config";
import { migrate } from "./db";
import { createPgPool } from "./pg";

const cfg = loadConfig();
const db = createPgPool(cfg.databaseUrl);
await migrate(db);
console.log("migration completed");
await db.end();
