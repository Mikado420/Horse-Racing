import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`環境変数 ${name} が数値ではありません: ${v}`);
  return n;
}

const DEV_SECRET = "dev-only-secret-do-not-use-in-production";

export function loadConfig() {
  const jwtSecret = process.env.JWT_SECRET || DEV_SECRET;
  if (jwtSecret === DEV_SECRET) {
    if (process.env.NODE_ENV === "production") throw new Error("本番環境では JWT_SECRET を設定してください");
    console.warn("[config] JWT_SECRET が未設定のため開発用の鍵を使用しています");
  }
  return {
    port: num("PORT", 2567),
    databaseUrl: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/horses",
    jwtSecret,
    registrationMs: num("REGISTRATION_SECONDS", 30) * 1000,
    replaySpeed: num("REPLAY_SPEED", 2),
    /** ビルド済みクライアント（あれば同じポートで配信する） */
    staticDir: path.resolve(here, "../../client/dist"),
  };
}

export type AppConfig = ReturnType<typeof loadConfig>;
