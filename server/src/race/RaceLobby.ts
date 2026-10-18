// レースロビーの中核ロジック。Colyseus には依存しない（テストで直接動かせる）。
//
// 流れ: 出走登録 → 締切 → サーバーで着順計算＋賞金精算（DB確定）→ 全員に同じ経過データを配信
//       → 各クライアントが3D再生 → 再生終了時刻に結果発表
// 着順・賞金は締切時点でサーバーが確定させるため、クライアントの切断や不正な入力は結果に影響しない。

import {
  DEFAULT_COURSE,
  ECONOMY,
  MAX_RUNNERS,
  MIN_RUNNERS,
  STYLE_LABELS,
  canRace,
  type CourseDef,
  type Horse,
  type LobbyEntryView,
  type LobbyPhase,
  type LobbyStateMsg,
  type PlayerProfile,
  type RaceResultMsg,
  type RaceStartMsg,
  type SyncMsg,
} from "@owners/shared";
import { randomUUID, randomInt } from "node:crypto";
import { verifyToken } from "../auth/jwt";
import type { Db } from "../db/db";
import { isUuid } from "../http/validate";
import { getOwnedHorse } from "../services/horses";
import { getPlayer } from "../services/players";
import { AlreadySettledError, settleRace, type EntryRequest } from "../services/races";
import type { EntryRegistry } from "./entryRegistry";

export interface LobbyIO {
  broadcast(type: string, msg: unknown): void;
  lock(): void;
  now(): number;
}

export interface LobbyOptions {
  db: Db;
  registry: EntryRegistry;
  jwtSecret: string;
  registrationMs: number;
  replaySpeed: number;
  /** 締切から再生開始までの猶予 */
  countdownMs?: number;
  course?: CourseDef;
  seedSource?: () => number;
  log?: (msg: string) => void;
}

interface Entry {
  sessionId: string;
  gate: number;
  player: PlayerProfile;
  horse: Horse;
}

export class LobbyError extends Error {}

export class RaceLobby {
  readonly raceId = randomUUID();
  phase: LobbyPhase = "registering";
  private entries = new Map<string, Entry>(); // sessionId -> entry
  private deadlineAt: number | null = null;
  private raceStart: RaceStartMsg | null = null;
  private result: RaceResultMsg | null = null;
  private resultAt: number | null = null;
  private message: string | undefined;
  private busy = false;
  private closing: Promise<void> | null = null;
  private readonly course: CourseDef;
  private readonly countdownMs: number;

  constructor(
    private io: LobbyIO,
    private opts: LobbyOptions,
  ) {
    this.course = opts.course ?? DEFAULT_COURSE;
    this.countdownMs = opts.countdownMs ?? 4000;
  }

  /** 参加前の認証と検証（DB参照）。成功すればプレイヤーと馬を返す */
  async authorize(options: unknown): Promise<{ player: PlayerProfile; horse: Horse }> {
    const o = (typeof options === "object" && options !== null ? options : {}) as Record<string, unknown>;
    const token = verifyToken(o.token, this.opts.jwtSecret);
    if (!token) throw new LobbyError("認証に失敗しました。ログインし直してください");
    if (!isUuid(o.horseId)) throw new LobbyError("馬の指定が正しくありません");
    if (this.phase !== "registering") throw new LobbyError("このレースの出走登録は締め切られました");
    const player = await getPlayer(this.opts.db, token.sub).catch(() => null);
    if (!player) throw new LobbyError("プレイヤーが見つかりません");
    const horse = await getOwnedHorse(this.opts.db, player.id, o.horseId.toLowerCase()).catch(() => null);
    if (!horse) throw new LobbyError("自分の所有馬ではありません");
    const err = canRace(horse);
    if (err) throw new LobbyError(err);
    if (player.money < ECONOMY.entryFee) throw new LobbyError("出走経費が払えません");
    return { player, horse };
  }

  /** 出走登録（同期的に状態を確定させる） */
  addEntry(sessionId: string, player: PlayerProfile, horse: Horse): LobbyEntryView {
    if (this.phase !== "registering") throw new LobbyError("このレースの出走登録は締め切られました");
    if (this.entries.size >= MAX_RUNNERS) throw new LobbyError("出走枠が埋まっています");
    for (const e of this.entries.values()) {
      if (e.player.id === player.id) throw new LobbyError("1つのレースに登録できるのは1頭までです");
    }
    if (!this.opts.registry.tryAcquire(horse.id, this.raceId)) {
      throw new LobbyError("この馬は別のレースに登録済みです");
    }
    const used = new Set([...this.entries.values()].map((e) => e.gate));
    let gate = 1;
    while (used.has(gate)) gate++;
    const entry: Entry = { sessionId, gate, player, horse };
    this.entries.set(sessionId, entry);
    if (this.deadlineAt === null) this.deadlineAt = this.io.now() + this.opts.registrationMs;
    this.message = undefined;
    this.broadcastLobby();
    return this.view(entry);
  }

  /** 登録受付中の取り消し（退出）。締切後は何もしない（レースは続行） */
  removeEntry(sessionId: string): void {
    if (this.phase !== "registering") return;
    const e = this.entries.get(sessionId);
    if (!e) return;
    this.entries.delete(sessionId);
    this.opts.registry.release(e.horse.id, this.raceId);
    if (this.entries.size === 0) this.deadlineAt = null;
    this.broadcastLobby();
  }

  hasEntry(sessionId: string): boolean {
    return this.entries.has(sessionId);
  }

  /** 定期的に呼ぶ（Colyseus では clock.setInterval） */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = this.io.now();
      if (this.phase === "registering") {
        if (this.entries.size >= MAX_RUNNERS) {
          await this.close();
        } else if (this.deadlineAt !== null && now >= this.deadlineAt) {
          if (this.entries.size >= MIN_RUNNERS) {
            await this.close();
          } else {
            // 頭数不足：締切を延長して待つ
            this.deadlineAt = now + this.opts.registrationMs;
            this.message = `出走頭数が${MIN_RUNNERS}頭に満たないため締切を延長しました`;
            this.broadcastLobby();
          }
        }
      } else if (this.phase === "running" && this.resultAt !== null && now >= this.resultAt && this.result) {
        this.phase = "finished";
        this.io.broadcast("race_result", { ...this.result, serverNow: now });
        this.broadcastLobby();
      }
    } finally {
      this.busy = false;
    }
  }

  private close(): Promise<void> {
    if (!this.closing) this.closing = this.doClose();
    return this.closing;
  }

  private async doClose(): Promise<void> {
    this.phase = "closing";
    this.io.lock();
    this.broadcastLobby();
    const entries = [...this.entries.values()];
    const requests: EntryRequest[] = entries.map((e) => ({ gate: e.gate, playerId: e.player.id, horseId: e.horse.id }));
    const seed = this.opts.seedSource ? this.opts.seedSource() : randomInt(0, 2 ** 31);
    try {
      const outcome = await settleRace(this.opts.db, this.raceId, requests, this.course, seed);
      if (outcome.status === "cancelled") {
        this.phase = "cancelled";
        this.message = outcome.reason;
        this.broadcastLobby();
        return;
      }
      const now = this.io.now();
      const startAt = now + this.countdownMs;
      const runners: LobbyEntryView[] = outcome.runners.map((r) => ({
        gate: r.gate,
        playerId: r.playerId,
        playerName: r.playerName,
        horseId: r.horseId,
        horseName: r.horseName,
        style: STYLE_LABELS[r.style as keyof typeof STYLE_LABELS] ?? r.style,
      }));
      const finishOrder = outcome.sim.results.map((res) => runners.findIndex((r) => r.horseId === res.entryId));
      const lastFinishSec = Math.max(...outcome.sim.results.map((r) => r.timeMs)) / 1000;
      this.raceStart = {
        raceId: this.raceId,
        courseName: this.course.name,
        distance: this.course.distance,
        surface: this.course.surface,
        going: outcome.conditions.going,
        weather: outcome.conditions.weather,
        runners,
        frames: outcome.sim.frames,
        sampleDt: outcome.sim.sampleDt,
        durationSec: outcome.sim.durationSec,
        finishOrder,
        startAt,
        replaySpeed: this.opts.replaySpeed,
        serverNow: now,
      };
      this.result = { raceId: this.raceId, results: outcome.results, serverNow: now };
      this.resultAt = startAt + Math.ceil((lastFinishSec * 1000) / this.opts.replaySpeed) + 500;
      this.phase = "running";
      this.io.broadcast("race_start", this.raceStart);
      this.broadcastLobby();
      this.opts.log?.(`race ${this.raceId} settled: ${outcome.results.map((r) => `${r.position}.${r.horseName}`).join(" ")}`);
    } catch (e) {
      this.phase = "cancelled";
      this.message =
        e instanceof AlreadySettledError ? "このレースは既に確定しています" : "サーバーエラーによりレースは中止になりました";
      this.opts.log?.(`race ${this.raceId} failed: ${(e as Error).message}`);
      this.broadcastLobby();
    } finally {
      for (const e of entries) this.opts.registry.release(e.horse.id, this.raceId);
    }
  }

  /** ルーム破棄時。精算中なら完了を待ち、登録だけの馬は解放する */
  async dispose(): Promise<void> {
    if (this.closing) await this.closing;
    for (const e of this.entries.values()) this.opts.registry.release(e.horse.id, this.raceId);
  }

  lobbyState(): LobbyStateMsg {
    return {
      raceId: this.raceId,
      phase: this.phase,
      entries: [...this.entries.values()].sort((a, b) => a.gate - b.gate).map((e) => this.view(e)),
      deadlineAt: this.deadlineAt,
      minRunners: MIN_RUNNERS,
      maxRunners: MAX_RUNNERS,
      serverNow: this.io.now(),
      message: this.message,
    };
  }

  /** 再接続・参加直後の全量同期 */
  sync(): SyncMsg {
    const now = this.io.now();
    return {
      lobby: this.lobbyState(),
      race: this.raceStart ? { ...this.raceStart, serverNow: now } : null,
      result: this.phase === "finished" && this.result ? { ...this.result, serverNow: now } : null,
    };
  }

  private view(e: Entry): LobbyEntryView {
    return {
      gate: e.gate,
      playerId: e.player.id,
      playerName: e.player.username,
      horseId: e.horse.id,
      horseName: e.horse.name,
      style: STYLE_LABELS[e.horse.style],
    };
  }

  private broadcastLobby() {
    this.io.broadcast("lobby", this.lobbyState());
  }
}
