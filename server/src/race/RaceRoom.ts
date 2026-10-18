// Colyseus のルーム。中身は RaceLobby に委譲する薄いアダプタ。
import { Room, type Client } from "colyseus";
import { MAX_RUNNERS, type Horse, type PlayerProfile } from "@owners/shared";
import type { Db } from "../db/db";
import { globalEntryRegistry } from "./entryRegistry";
import { LobbyError, RaceLobby } from "./RaceLobby";

export interface RaceRoomDeps {
  db: Db;
  jwtSecret: string;
  registrationMs: number;
  replaySpeed: number;
}

interface AuthData {
  player: PlayerProfile;
  horse: Horse;
}

/** 登録受付中の通信切断から復帰を待つ秒数 */
const RECONNECT_REGISTERING_SEC = 20;
/** レース中・結果表示中の通信切断から復帰を待つ秒数 */
const RECONNECT_RACING_SEC = 90;

export class RaceRoom extends Room {
  maxClients = MAX_RUNNERS;
  private lobby!: RaceLobby;

  static deps: RaceRoomDeps;

  onCreate() {
    const deps = RaceRoom.deps;
    this.lobby = new RaceLobby(
      {
        broadcast: (type, msg) => this.broadcast(type, msg),
        lock: () => void this.lock(),
        now: () => Date.now(),
      },
      {
        db: deps.db,
        registry: globalEntryRegistry,
        jwtSecret: deps.jwtSecret,
        registrationMs: deps.registrationMs,
        replaySpeed: deps.replaySpeed,
        log: (m) => console.log(`[room ${this.roomId}] ${m}`),
      },
    );
    // クライアントから受け付けるのは「同期要求」だけ。着順や能力値は一切受け取らない
    this.onMessage("sync", (client) => client.send("sync", this.lobby.sync()));
    this.onMessage("*", (client, type) => {
      client.send("error", { message: `不明なメッセージ: ${String(type).slice(0, 32)}` });
    });
    this.clock.setInterval(() => {
      this.lobby.tick().catch((e) => console.error("[room] tick error", e));
    }, 250);
  }

  async onAuth(_client: Client, options: unknown): Promise<AuthData> {
    try {
      return await this.lobby.authorize(options);
    } catch (e) {
      throw new Error(e instanceof LobbyError ? e.message : "参加できませんでした");
    }
  }

  onJoin(client: Client, _options: unknown, auth: AuthData) {
    // 例外を投げると参加は拒否される
    this.lobby.addEntry(client.sessionId, auth.player, auth.horse);
  }

  async onLeave(client: Client, consented: boolean) {
    if (consented) {
      // 自分から退出：登録受付中なら出走取消。締切後はレースはそのまま続行
      this.lobby.removeEntry(client.sessionId);
      return;
    }
    // 通信切断：一定時間の再接続を待つ。レース判定は切断に関係なくサーバーで続行している
    const wait = this.lobby.phase === "registering" ? RECONNECT_REGISTERING_SEC : RECONNECT_RACING_SEC;
    try {
      await this.allowReconnection(client, wait);
      // 再接続したクライアントは自分から "sync" を送って状態を取り直す
    } catch {
      this.lobby.removeEntry(client.sessionId);
    }
  }

  async onDispose() {
    await this.lobby.dispose();
  }
}
