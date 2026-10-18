// JWT (HS256) の発行と検証。node:crypto のみで実装。
import { createHmac, timingSafeEqual } from "node:crypto";

export interface TokenPayload {
  sub: string; // player id
  name: string;
  iat: number;
  exp: number;
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

export function signToken(
  claims: { sub: string; name: string },
  secret: string,
  ttlSec = 7 * 24 * 3600,
  nowSec = Math.floor(Date.now() / 1000),
): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ ...claims, iat: nowSec, exp: nowSec + ttlSec }));
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

/** 正しく署名され有効期限内なら payload、そうでなければ null */
export function verifyToken(token: unknown, secret: string, nowSec = Math.floor(Date.now() / 1000)): TokenPayload | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const h = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
    if (h.alg !== "HS256") return null;
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TokenPayload;
    if (typeof p.sub !== "string" || typeof p.exp !== "number" || p.exp <= nowSec) return null;
    return p;
  } catch {
    return null;
  }
}
