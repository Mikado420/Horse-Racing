// テスト専用：PostgreSQL ワイヤープロトコルの最小クライアント。
// 開発環境で npm パッケージ（pg）が取得できない場合でも、本物の PostgreSQL に対して
// サーバーのSQLを検証できるようにするためのもの。trust 認証のみ対応。
// 本番は src/db/pg.ts（node-postgres）を使う。型変換は node-postgres の既定動作に合わせてある。

import net from "node:net";
import type { Db, DbClient, QueryResult } from "../../src/db/db";

interface PgError extends Error {
  code?: string;
  detail?: string;
}

function parseValue(oid: number, text: string): unknown {
  switch (oid) {
    case 16:
      return text === "t";
    case 21:
    case 23:
    case 26:
    case 700:
    case 701:
      return Number(text);
    case 114:
    case 3802:
      return JSON.parse(text);
    case 1082:
    case 1114:
    case 1184:
      return new Date(text);
    default:
      return text; // int8 / numeric は文字列（node-postgres と同じ）
  }
}

function encodeParam(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return `{${v.map((x) => `"${String(x).replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

class Conn {
  private sock!: net.Socket;
  private buf = Buffer.alloc(0);
  private waiters: (() => void)[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private opts: { host: string; port: number; user: string; database: string }) {}

  async open(): Promise<void> {
    this.sock = net.connect(this.opts.port, this.opts.host);
    this.sock.on("data", (d: Buffer) => {
      this.buf = Buffer.concat([this.buf, d]);
      const w = this.waiters;
      this.waiters = [];
      w.forEach((f) => f());
    });
    await new Promise<void>((res, rej) => {
      this.sock.once("connect", () => res());
      this.sock.once("error", rej);
    });
    const params = Buffer.from(`user\0${this.opts.user}\0database\0${this.opts.database}\0\0`);
    const head = Buffer.alloc(8);
    head.writeInt32BE(8 + params.length, 0);
    head.writeInt32BE(196608, 4);
    this.sock.write(Buffer.concat([head, params]));
    for (;;) {
      const m = await this.read();
      if (m.type === "R" && m.body.readInt32BE(0) !== 0) throw new Error("minipg: trust 認証以外には未対応です");
      if (m.type === "E") throw this.error(m.body);
      if (m.type === "Z") break;
    }
  }

  private async read(): Promise<{ type: string; body: Buffer }> {
    for (;;) {
      if (this.buf.length >= 5) {
        const len = this.buf.readInt32BE(1);
        if (this.buf.length >= 1 + len) {
          const type = String.fromCharCode(this.buf[0]);
          const body = this.buf.subarray(5, 1 + len);
          this.buf = this.buf.subarray(1 + len);
          return { type, body };
        }
      }
      await new Promise<void>((r) => this.waiters.push(r));
    }
  }

  private error(body: Buffer): PgError {
    const fields: Record<string, string> = {};
    let i = 0;
    while (i < body.length && body[i] !== 0) {
      const code = String.fromCharCode(body[i]);
      const end = body.indexOf(0, i + 1);
      fields[code] = body.subarray(i + 1, end).toString("utf8");
      i = end + 1;
    }
    const e = new Error(fields.M ?? "postgres error") as PgError;
    e.code = fields.C;
    e.detail = fields.D;
    return e;
  }

  private msg(type: string, payload: Buffer): Buffer {
    const h = Buffer.alloc(5);
    h.write(type, 0);
    h.writeInt32BE(4 + payload.length, 1);
    return Buffer.concat([h, payload]);
  }

  query<T>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    const run = this.queue.then(() => this.doQuery<T>(text, params));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async doQuery<T>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    const cstr = (s: string) => Buffer.from(s + "\0", "utf8");
    if (!params || params.length === 0) {
      this.sock.write(this.msg("Q", cstr(text)));
    } else {
      const parse = Buffer.concat([cstr(""), cstr(text), Buffer.from([0, 0])]);
      const parts: Buffer[] = [cstr(""), cstr(""), Buffer.from([0, 0])];
      const n = Buffer.alloc(2);
      n.writeInt16BE(params.length);
      parts.push(n);
      for (const p of params) {
        const v = encodeParam(p);
        const len = Buffer.alloc(4);
        if (v === null) {
          len.writeInt32BE(-1);
          parts.push(len);
        } else {
          const b = Buffer.from(v, "utf8");
          len.writeInt32BE(b.length);
          parts.push(len, b);
        }
      }
      parts.push(Buffer.from([0, 0]));
      this.sock.write(
        Buffer.concat([
          this.msg("P", parse),
          this.msg("B", Buffer.concat(parts)),
          this.msg("D", Buffer.concat([Buffer.from("P"), cstr("")])),
          this.msg("E", Buffer.concat([cstr(""), Buffer.alloc(4)])),
          this.msg("S", Buffer.alloc(0)),
        ]),
      );
    }
    let fields: { name: string; oid: number }[] = [];
    let rows: T[] = [];
    let rowCount: number | null = null;
    let err: PgError | null = null;
    for (;;) {
      const m = await this.read();
      if (m.type === "T") {
        fields = [];
        rows = [];
        const count = m.body.readInt16BE(0);
        let i = 2;
        for (let f = 0; f < count; f++) {
          const end = m.body.indexOf(0, i);
          const name = m.body.subarray(i, end).toString("utf8");
          i = end + 1;
          const oid = m.body.readInt32BE(i + 6);
          i += 18;
          fields.push({ name, oid });
        }
      } else if (m.type === "D") {
        const count = m.body.readInt16BE(0);
        let i = 2;
        const row: Record<string, unknown> = {};
        for (let c = 0; c < count; c++) {
          const len = m.body.readInt32BE(i);
          i += 4;
          if (len === -1) row[fields[c].name] = null;
          else {
            row[fields[c].name] = parseValue(fields[c].oid, m.body.subarray(i, i + len).toString("utf8"));
            i += len;
          }
        }
        rows.push(row as T);
      } else if (m.type === "C") {
        const tag = m.body.subarray(0, m.body.length - 1).toString();
        const num = Number(tag.split(" ").pop());
        rowCount = Number.isFinite(num) ? num : null;
      } else if (m.type === "E") {
        err = this.error(m.body);
      } else if (m.type === "Z") {
        if (err) throw err;
        return { rows, rowCount };
      }
    }
  }

  close() {
    this.sock.write(this.msg("X", Buffer.alloc(0)));
    this.sock.end();
  }
}

export function createMiniPool(url: string): Db {
  const u = new URL(url);
  const opts = {
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username || "postgres"),
    database: u.pathname.slice(1),
  };
  const open = new Set<Conn>();
  const connect = async (): Promise<DbClient & { conn: Conn }> => {
    const c = new Conn(opts);
    await c.open();
    open.add(c);
    return {
      conn: c,
      query: (t, p) => c.query(t, p),
      release: () => {
        open.delete(c);
        c.close();
      },
    };
  };
  return {
    connect,
    async query(text, params) {
      const client = await connect();
      try {
        return await client.query(text, params);
      } finally {
        client.release();
      }
    },
    async end() {
      for (const c of open) c.close();
      open.clear();
    },
  };
}
