// REST API（Node標準の http モジュールのみで実装した小さなルーター）
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomInt } from "node:crypto";
import { STARTER_TEMPLATES, createRng, ECONOMY, DEFAULT_COURSE } from "@owners/shared";
import { signToken, verifyToken, type TokenPayload } from "../auth/jwt";
import type { Db } from "../db/db";
import { getPlayer, loginPlayer, registerPlayer } from "../services/players";
import { getOwnedHorse, horseHistory, listHorses, restHorse, selectStarter, trainHorse } from "../services/horses";
import { getRace, rankings, recentRacesForPlayer } from "../services/races";
import { HttpError, badRequest, notFound, tooMany, unauthorized } from "./errors";
import { RateLimiter } from "./rateLimit";
import { requireBody, requirePassword, requireTrainingMenu, requireUsername, requireUuid } from "./validate";

export interface AppDeps {
  db: Db;
  jwtSecret: string;
  staticDir?: string;
  /** API の呼び出しを許可する別ドメインのオリジン */
  corsOrigins?: string[];
}

interface Ctx {
  req: IncomingMessage;
  params: Record<string, string>;
  body: unknown;
  auth: TokenPayload | null;
  ip: string;
}

type Handler = (ctx: Ctx) => Promise<unknown>;
interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  auth: boolean;
  handler: Handler;
}

const MAX_BODY = 16 * 1024;

function compile(p: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const re = p.replace(/:([a-zA-Z]+)/g, (_, k) => {
    keys.push(k);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${re}$`), keys };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "リクエストが大きすぎます");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw badRequest("JSONの形式が正しくありません");
  }
}

function send(res: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

/**
 * 静的ファイルのキャッシュ設定：
 * ・ファイル名にハッシュが付いた assets/ は長期キャッシュ（中身が変わると名前も変わる）
 * ・HTML・Service Worker・マニフェスト・version.json は毎回確認させ、更新の検知を妨げない
 */
export function cacheControlFor(dir: string, file: string): string {
  const rel = path.relative(dir, file).split(path.sep).join("/");
  if (rel.startsWith("assets/")) return "public, max-age=31536000, immutable";
  if (/(^|\/)(sw\.js|workbox-[^/]+\.js|index\.html|manifest\.webmanifest|version\.json)$/.test(rel) || rel.endsWith(".html")) return "no-cache";
  return "public, max-age=3600";
}

function serveStatic(dir: string, urlPath: string, res: ServerResponse): boolean {
  if (!fs.existsSync(dir)) return false;
  const safe = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  let file = path.join(dir, safe);
  if (!file.startsWith(dir)) return false;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, "index.html"); // SPA
  if (!fs.existsSync(file)) return false;
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream", "Cache-Control": cacheControlFor(dir, file) });
  fs.createReadStream(file).pipe(res);
  return true;
}

export function createApp(deps: AppDeps) {
  const { db, jwtSecret } = deps;
  const authLimiter = new RateLimiter(10, 10 / 60); // 1分あたり10回
  const actionLimiter = new RateLimiter(8, 4); // 1秒あたり4回まで

  const routes: Route[] = [];
  const add = (method: string, p: string, auth: boolean, handler: Handler) =>
    routes.push({ method, ...compile(p), auth, handler });

  const issue = (p: { id: string; username: string }) => signToken({ sub: p.id, name: p.username }, jwtSecret);
  const me = (ctx: Ctx) => ctx.auth!.sub;
  const limitAction = (ctx: Ctx) => {
    if (!actionLimiter.take(me(ctx))) throw tooMany();
  };
  const serverRng = () => createRng(randomInt(0, 2 ** 31));

  add("GET", "/api/health", false, async () => ({ ok: true }));

  add("POST", "/api/auth/register", false, async (ctx) => {
    if (!authLimiter.take(`reg:${ctx.ip}`)) throw tooMany();
    const b = requireBody(ctx.body);
    const player = await registerPlayer(db, requireUsername(b.username), requirePassword(b.password));
    return { token: issue(player), player };
  });

  add("POST", "/api/auth/login", false, async (ctx) => {
    if (!authLimiter.take(`login:${ctx.ip}`)) throw tooMany();
    const b = requireBody(ctx.body);
    const player = await loginPlayer(db, requireUsername(b.username), requirePassword(b.password));
    return { token: issue(player), player };
  });

  add("GET", "/api/me", true, async (ctx) => {
    const player = await getPlayer(db, me(ctx));
    const horses = await listHorses(db, player.id);
    return { player, horses };
  });

  add("GET", "/api/me/races", true, async (ctx) => ({ races: await recentRacesForPlayer(db, me(ctx)) }));

  add("GET", "/api/game-info", false, async () => ({
    economy: ECONOMY,
    course: DEFAULT_COURSE,
    starters: STARTER_TEMPLATES,
  }));

  add("POST", "/api/starters", true, async (ctx) => {
    limitAction(ctx);
    const b = requireBody(ctx.body);
    const horse = await selectStarter(db, me(ctx), b.templateId, b.name, serverRng());
    return { horse };
  });

  add("GET", "/api/horses/:id", true, async (ctx) => {
    const id = requireUuid(ctx.params.id, "馬ID");
    const horse = await getOwnedHorse(db, me(ctx), id);
    return { horse, history: await horseHistory(db, id) };
  });

  add("POST", "/api/horses/:id/train", true, async (ctx) => {
    limitAction(ctx);
    const id = requireUuid(ctx.params.id, "馬ID");
    const menu = requireTrainingMenu(requireBody(ctx.body).menu);
    const r = await trainHorse(db, me(ctx), id, menu, serverRng());
    return { horse: r.horse, gains: r.gains, injured: r.injured, conditionDelta: r.conditionDelta, money: r.money };
  });

  add("POST", "/api/horses/:id/rest", true, async (ctx) => {
    limitAction(ctx);
    const id = requireUuid(ctx.params.id, "馬ID");
    const r = await restHorse(db, me(ctx), id, serverRng());
    return { horse: r.horse, fatigueDelta: r.fatigueDelta, conditionDelta: r.conditionDelta };
  });

  add("GET", "/api/races/:id", true, async (ctx) => getRace(db, requireUuid(ctx.params.id, "レースID")));

  add("GET", "/api/rankings", false, async () => rankings(db));

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    // Colyseus のマッチメイク用パスには触れない
    if (url.pathname.startsWith("/matchmake")) return;

    // 別ドメインのクライアント（許可したオリジンだけ）からの API 呼び出し
    const origin = req.headers.origin;
    if (origin && url.pathname.startsWith("/api/") && deps.corsOrigins?.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Max-Age", "600");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
    }

    if (!url.pathname.startsWith("/api/")) {
      if ((req.method === "GET" || req.method === "HEAD") && deps.staticDir && serveStatic(deps.staticDir, url.pathname, res)) {
        return;
      }
      return send(res, 404, { error: "見つかりません" });
    }

    try {
      const route = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
      if (!route) throw notFound("APIが見つかりません");
      const m = url.pathname.match(route.pattern)!;
      const params: Record<string, string> = {};
      route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      let auth: TokenPayload | null = null;
      if (route.auth) {
        const h = req.headers.authorization ?? "";
        auth = verifyToken(h.startsWith("Bearer ") ? h.slice(7) : "", jwtSecret);
        if (!auth) throw unauthorized();
      }
      const body = await readJson(req);
      const ip = req.socket.remoteAddress ?? "unknown";
      const data = await route.handler({ req, params, body, auth, ip });
      send(res, 200, data);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error("[http] unexpected error", e);
      send(res, 500, { error: "サーバーエラーが発生しました" });
    }
  };
}
