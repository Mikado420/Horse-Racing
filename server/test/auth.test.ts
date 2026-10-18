import { test } from "node:test";
import assert from "node:assert/strict";
import { signToken, verifyToken } from "../src/auth/jwt";
import { hashPassword, verifyPassword } from "../src/auth/password";
import { RateLimiter } from "../src/http/rateLimit";

test("JWT: 正しいトークンは検証でき、改ざん・期限切れ・別鍵は拒否", () => {
  const t = signToken({ sub: "p1", name: "alice" }, "secret", 60, 1000);
  assert.equal(verifyToken(t, "secret", 1001)?.sub, "p1");
  assert.equal(verifyToken(t, "other", 1001), null);
  assert.equal(verifyToken(t, "secret", 1061), null);
  const [h, p, s] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ sub: "admin", name: "x", iat: 1000, exp: 9999 })).toString("base64url");
  assert.equal(verifyToken(`${h}.${forged}.${s}`, "secret", 1001), null);
  assert.equal(verifyToken(`${h}.${p}`, "secret", 1001), null);
  assert.equal(verifyToken(123, "secret", 1001), null);
  // alg=none 攻撃
  const none = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  assert.equal(verifyToken(`${none}.${p}.`, "secret", 1001), null);
});

test("パスワード: ハッシュは毎回異なり、正しいパスワードだけ通る", async () => {
  const a = await hashPassword("password123");
  const b = await hashPassword("password123");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("password123", a), true);
  assert.equal(await verifyPassword("password124", a), false);
  assert.equal(await verifyPassword("x", "garbage"), false);
});

test("レート制限", () => {
  let now = 0;
  const rl = new RateLimiter(2, 1, () => now);
  assert.equal(rl.take("k"), true);
  assert.equal(rl.take("k"), true);
  assert.equal(rl.take("k"), false);
  now = 1000;
  assert.equal(rl.take("k"), true);
  assert.equal(rl.take("other"), true);
});
