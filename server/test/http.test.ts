// REST API を実際の HTTP サーバーとして起動し、ブラウザと同じ fetch で叩いて検証する
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { ECONOMY } from "@owners/shared";
import { createApp } from "../src/http/app";
import { createTestDb } from "./support/testDb";

let base = "";
let server: http.Server;
let drop: () => Promise<void>;

before(async () => {
  const t = await createTestDb();
  drop = t.drop;
  const handler = createApp({ db: t.db, jwtSecret: "http-test" });
  server = http.createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  server.close();
  await drop();
});

async function api(path: string, opts: { method?: string; body?: unknown; token?: string; raw?: string } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? (opts.body !== undefined || opts.raw ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  return { status: res.status, data: (await res.json()) as any };
}

test("新規登録 → 初期馬選択 → 調教 → 休養 → 詳細表示 の一連の流れ", async () => {
  const reg = await api("/api/auth/register", { body: { username: "http_user", password: "password123" } });
  assert.equal(reg.status, 200);
  const token = reg.data.token as string;

  const me0 = await api("/api/me", { token });
  assert.equal(me0.data.horses.length, 0);
  assert.equal(me0.data.player.money, ECONOMY.startingMoney);

  const info = await api("/api/game-info");
  assert.equal(info.data.starters.length, 3);

  const pick = await api("/api/starters", { token, body: { templateId: "stayer", name: "スエヒロボシ" } });
  assert.equal(pick.status, 200, JSON.stringify(pick.data));
  const horseId = pick.data.horse.id;

  const again = await api("/api/starters", { token, body: { templateId: "swift", name: "ニトウメ" } });
  assert.equal(again.status, 409);

  const tr = await api(`/api/horses/${horseId}/train`, { token, body: { menu: "guts" } });
  assert.equal(tr.status, 200);
  assert.ok(tr.data.horse.stats.guts > pick.data.horse.stats.guts);
  assert.equal(tr.data.money, ECONOMY.startingMoney - ECONOMY.trainingCost);

  const rs = await api(`/api/horses/${horseId}/rest`, { token, body: {} });
  assert.equal(rs.status, 200);
  assert.equal(rs.data.horse.fatigue, 0);

  const detail = await api(`/api/horses/${horseId}`, { token });
  assert.equal(detail.data.horse.name, "スエヒロボシ");
  assert.deepEqual(detail.data.history, []);

  const login = await api("/api/auth/login", { body: { username: "HTTP_USER", password: "password123" } });
  assert.equal(login.status, 200);

  const rank = await api("/api/rankings");
  assert.equal(rank.status, 200);
  assert.ok(Array.isArray(rank.data.players));
});

test("認証と入力検証", async () => {
  assert.equal((await api("/api/me")).status, 401);
  assert.equal((await api("/api/me", { token: "forged.token.value" })).status, 401);
  assert.equal((await api("/api/auth/register", { body: { username: "a", password: "password123" } })).status, 400);
  assert.equal((await api("/api/auth/register", { body: { username: "valid_name", password: "short" } })).status, 400);
  assert.equal((await api("/api/auth/register", { raw: "{not json" })).status, 400);
  assert.equal((await api("/api/auth/register", { raw: JSON.stringify({ username: "x".repeat(20000) }) })).status, 413);

  const reg = await api("/api/auth/register", { body: { username: "validator", password: "password123" } });
  const token = reg.data.token;
  assert.equal((await api("/api/starters", { token, body: { templateId: "swift", name: "<b>悪</b>" } })).status, 400);
  const ok = await api("/api/starters", { token, body: { templateId: "swift", name: "ケンシュウバ" } });
  const id = ok.data.horse.id;
  assert.equal((await api(`/api/horses/${id}/train`, { token, body: { menu: "money" } })).status, 400);
  assert.equal((await api(`/api/horses/not-uuid/train`, { token, body: { menu: "speed" } })).status, 400);
  assert.equal((await api(`/api/horses/${id}/train`, { token, body: { menu: "speed", stats: { speed: 999 } } })).data.horse.stats.speed < 200, true, "クライアントが送った能力値は無視");
  // 他人の馬
  const other = await api("/api/auth/register", { body: { username: "intruder", password: "password123" } });
  assert.equal((await api(`/api/horses/${id}/train`, { token: other.data.token, body: { menu: "speed" } })).status, 404);
  assert.equal((await api(`/api/horses/${id}`, { token: other.data.token })).status, 404);
  assert.equal((await api("/api/unknown")).status, 404);
});

test("操作の連打はレート制限される", async () => {
  const reg = await api("/api/auth/register", { body: { username: "spammer", password: "password123" } });
  const token = reg.data.token;
  const h = await api("/api/starters", { token, body: { templateId: "balanced", name: "レンダウマ" } });
  const statuses = await Promise.all(
    Array.from({ length: 15 }, () => api(`/api/horses/${h.data.horse.id}/rest`, { token, body: {} }).then((r) => r.status)),
  );
  assert.ok(statuses.includes(429));
});
