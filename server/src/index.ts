// サーバーのエントリーポイント：REST API + Colyseus（WebSocket）を同じポートで起動する
import http from "node:http";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME } from "@owners/shared";
import { loadConfig } from "./config";
import { migrate } from "./db/db";
import { createPgPool } from "./db/pg";
import { createApp } from "./http/app";
import { RaceRoom } from "./race/RaceRoom";

const cfg = loadConfig();
const db = createPgPool(cfg.databaseUrl);
await migrate(db);

const handler = createApp({ db, jwtSecret: cfg.jwtSecret, staticDir: cfg.staticDir });
const httpServer = http.createServer((req, res) => {
  void handler(req, res);
});

RaceRoom.deps = {
  db,
  jwtSecret: cfg.jwtSecret,
  registrationMs: cfg.registrationMs,
  replaySpeed: cfg.replaySpeed,
};

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});
gameServer.define(ROOM_NAME, RaceRoom);

await gameServer.listen(cfg.port);
console.log(`[server] listening on http://localhost:${cfg.port}  (API: /api, WebSocket: Colyseus room "${ROOM_NAME}")`);

const shutdown = async () => {
  console.log("[server] shutting down");
  await gameServer.gracefullyShutdown(false).catch(() => {});
  await db.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
