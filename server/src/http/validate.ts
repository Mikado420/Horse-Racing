// 入力検証。クライアントから届く値はすべてここを通してから使う。
import { STAT_KEYS, type TrainingMenu } from "@owners/shared";
import { badRequest } from "./errors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME_RE = /^[A-Za-z0-9_-]{3,16}$/;

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function requireBody(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) throw badRequest("リクエスト本文がJSONオブジェクトではありません");
  return body;
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export function requireUuid(v: unknown, label = "ID"): string {
  if (!isUuid(v)) throw badRequest(`${label}の形式が正しくありません`);
  return v.toLowerCase();
}

export function requireUsername(v: unknown): string {
  if (typeof v !== "string" || !USERNAME_RE.test(v)) {
    throw badRequest("ユーザー名は半角英数字・_・- の3〜16文字にしてください");
  }
  return v;
}

export function requirePassword(v: unknown): string {
  if (typeof v !== "string" || v.length < 8 || v.length > 72) {
    throw badRequest("パスワードは8〜72文字にしてください");
  }
  return v;
}

export function requireTrainingMenu(v: unknown): TrainingMenu {
  if (typeof v !== "string" || !(STAT_KEYS as readonly string[]).includes(v)) {
    throw badRequest("調教メニューが正しくありません");
  }
  return v as TrainingMenu;
}

export function requireString(v: unknown, label: string, max = 64): string {
  if (typeof v !== "string" || v.length === 0 || v.length > max) throw badRequest(`${label}が正しくありません`);
  return v;
}
