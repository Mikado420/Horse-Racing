import { useEffect, useMemo, useState } from "react";
import {
  ECONOMY,
  GOING_LABELS,
  MAX_RUNNERS,
  RACE_FATIGUE_LIMIT,
  STYLE_LABELS,
  WEATHER_LABELS,
  canRace,
  distancesAt,
  formatRaceTime,
  liveOrder,
  marginLabel,
  prizeFor,
  DEFAULT_COURSE,
  type RaceStartMsg,
} from "@owners/shared";
import { getToken, type MeResponse } from "../api";
import { Notice, SaddleCloth } from "../components";
import { yen } from "../format";
import type { RaceConnection } from "../net/raceClient";
import { RaceScene, type CameraMode } from "../three/RaceScene";
import type { Screen } from "../App";

interface Props {
  me: MeResponse;
  conn: RaceConnection;
  initialHorseId?: string;
  go: (s: Screen) => void;
  onChanged: () => void;
}

/** 再生時刻（レース内の経過秒） */
export function raceClock(race: RaceStartMsg, serverNow: number): number {
  return Math.max(0, ((serverNow - race.startAt) / 1000) * race.replaySpeed);
}

export function RaceScreen({ me, conn, initialHorseId, go, onChanged }: Props) {
  const { status, lobby, race, result, error } = conn;

  // 結果が出たら所持金・戦績を取り直す
  useEffect(() => {
    if (result) onChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.raceId]);

  const backHome = () => {
    conn.leave();
    conn.reset();
    onChanged();
    go({ name: "home" });
  };

  if (status === "reconnecting" && !race) {
    return (
      <div className="page narrow">
        <Notice>サーバーに再接続しています…（レースはサーバー側で進行しています）</Notice>
      </div>
    );
  }

  if (race && (lobby?.phase === "running" || lobby?.phase === "finished" || result)) {
    return <RaceView race={race} conn={conn} myId={me.player.id} onBack={backHome} />;
  }

  if (lobby && (status === "connected" || status === "reconnecting")) {
    return <LobbyView conn={conn} myId={me.player.id} onCancel={backHome} />;
  }

  return <EntryForm me={me} conn={conn} initialHorseId={initialHorseId} error={error} />;
}

function EntryForm({ me, conn, initialHorseId, error }: { me: MeResponse; conn: RaceConnection; initialHorseId?: string; error: string | null }) {
  const eligible = me.horses.filter((h) => !canRace(h));
  const [horseId, setHorseId] = useState<string>(
    () => (initialHorseId && eligible.some((h) => h.id === initialHorseId) ? initialHorseId : eligible[0]?.id) ?? "",
  );
  const c = DEFAULT_COURSE;
  const canPay = me.player.money >= ECONOMY.entryFee;

  return (
    <div className="page narrow">
      <h1 className="page-title">出走登録</h1>
      <section className="race-card">
        <div className="race-card-name">
          <strong>{c.name}</strong>
          <span>
            芝 {c.distance}m ・ 2〜{MAX_RUNNERS}頭立て
          </span>
        </div>
        <dl className="race-card-facts">
          <div>
            <dt>1着賞金</dt>
            <dd>{yen(prizeFor(1, MAX_RUNNERS))}〜</dd>
          </div>
          <div>
            <dt>出走経費</dt>
            <dd>{yen(ECONOMY.entryFee)}</dd>
          </div>
          <div>
            <dt>出走手当</dt>
            <dd>全頭に{yen(ECONOMY.appearanceFee)}</dd>
          </div>
        </dl>
        <p className="hint">
          最初の登録から一定時間で締め切ります。2頭そろわない場合は締切を延長します。8頭そろうとすぐに発走します。
        </p>
      </section>

      {eligible.length === 0 ? (
        <Notice kind="error">出走できる馬がいません。疲労が{RACE_FATIGUE_LIMIT}未満で、故障していない馬が必要です。厩舎で休養させましょう。</Notice>
      ) : (
        <>
          <fieldset className="pick-horse">
            <legend>出走させる馬</legend>
            {eligible.map((h) => (
              <label key={h.id} className={`pick ${horseId === h.id ? "is-picked" : ""}`}>
                <input type="radio" name="horse" value={h.id} checked={horseId === h.id} onChange={() => setHorseId(h.id)} />
                <strong>{h.name}</strong>
                <span className="muted">
                  {STYLE_LABELS[h.style]} ・ 疲労 {h.fatigue}
                </span>
              </label>
            ))}
          </fieldset>
          {!canPay && <Notice kind="error">出走経費が足りません。</Notice>}
          {error && <Notice kind="error">{error}</Notice>}
          <button
            className="btn btn-primary btn-wide"
            disabled={!horseId || !canPay || conn.status === "joining"}
            onClick={() => conn.join(getToken() ?? "", horseId)}
          >
            {conn.status === "joining" ? "登録中…" : "このレースに登録する"}
          </button>
        </>
      )}
    </div>
  );
}

function useNow(serverNow: () => number, intervalMs: number) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(id);
  }, [serverNow, intervalMs]);
  return now;
}

function LobbyView({ conn, myId, onCancel }: { conn: RaceConnection; myId: string; onCancel: () => void }) {
  const lobby = conn.lobby!;
  const now = useNow(conn.serverNow, 250);
  const remain = lobby.deadlineAt ? Math.max(0, Math.ceil((lobby.deadlineAt - now) / 1000)) : null;
  const slots = Array.from({ length: lobby.maxRunners }, (_, i) => lobby.entries.find((e) => e.gate === i + 1));

  return (
    <div className="page narrow">
      <h1 className="page-title">出馬表</h1>
      {lobby.phase === "registering" && (
        <div className="deadline" aria-live="polite">
          {remain !== null ? (
            <>
              <span>締切まで</span>
              <strong className="deadline-num">{remain}</strong>
              <span>秒</span>
            </>
          ) : (
            <span>登録を待っています</span>
          )}
        </div>
      )}
      {lobby.phase === "closing" && <Notice>締め切りました。サーバーで出走馬を確定し、レースを計算しています…</Notice>}
      {lobby.phase === "cancelled" && <Notice kind="error">{lobby.message ?? "レースは中止になりました"}</Notice>}
      {lobby.message && lobby.phase === "registering" && <Notice>{lobby.message}</Notice>}

      <ol className="entries">
        {slots.map((e, i) => (
          <li key={i} className={`${e ? "" : "is-empty"} ${e?.playerId === myId ? "is-me" : ""}`}>
            <SaddleCloth gate={i + 1} />
            {e ? (
              <>
                <strong>{e.horseName}</strong>
                <span className="muted">{e.style}</span>
                <span className="owner">{e.playerName}</span>
              </>
            ) : (
              <span className="muted">空き</span>
            )}
          </li>
        ))}
      </ol>
      <p className="hint">
        {lobby.entries.length}/{lobby.maxRunners}頭 ・ 最低{lobby.minRunners}頭で発走
      </p>
      {conn.status === "reconnecting" && <Notice>再接続しています…</Notice>}
      <button className="btn btn-quiet btn-wide" onClick={onCancel} disabled={lobby.phase === "closing"}>
        {lobby.phase === "cancelled" ? "厩舎に戻る" : "登録を取り消す"}
      </button>
    </div>
  );
}

function RaceView({ race, conn, myId, onBack }: { race: RaceStartMsg; conn: RaceConnection; myId: string; onBack: () => void }) {
  const [camera, setCamera] = useState<CameraMode>("follow");
  const now = useNow(conn.serverNow, 100);
  const t = raceClock(race, now);
  const countdown = Math.ceil((race.startAt - now) / 1000);
  const dist = useMemo(() => distancesAt(race.frames, race.sampleDt, t), [race, t]);
  const order = liveOrder(dist, race.distance, race.finishOrder);
  const leaderRemain = Math.max(0, race.distance - (dist[order[0]] ?? 0));
  const myIndex = race.runners.findIndex((r) => r.playerId === myId);
  const result = conn.result;

  return (
    <div className="race-stage">
      <RaceScene race={race} serverNow={conn.serverNow} camera={camera} highlight={myIndex} />

      <div className="hud hud-top">
        <div className="hud-race">
          <strong>{race.courseName}</strong>
          <span>
            芝{race.distance}m ・ {WEATHER_LABELS[race.weather]} ・ 馬場{GOING_LABELS[race.going]}
          </span>
        </div>
        <div className="hud-remain">
          <span>残り</span>
          <strong>{Math.ceil(leaderRemain)}</strong>
          <span>m</span>
        </div>
      </div>

      <ol className="hud hud-order" aria-label="現在の順位">
        {order.map((idx, rank) => {
          const r = race.runners[idx];
          const gap = rank === 0 ? "" : `−${(dist[order[0]] - dist[idx]).toFixed(1)}m`;
          return (
            <li key={r.horseId} className={idx === myIndex ? "is-me" : ""}>
              <span className="hud-rank">{rank + 1}</span>
              <SaddleCloth gate={r.gate} size="sm" />
              <span className="hud-name">{r.horseName}</span>
              <span className="hud-gap">{gap}</span>
            </li>
          );
        })}
      </ol>

      <div className="hud hud-bottom">
        <span className="hud-clock">{formatRaceTime(Math.min(t, race.durationSec) * 1000)}</span>
        <div className="seg" role="group" aria-label="カメラ">
          <button aria-pressed={camera === "follow"} onClick={() => setCamera("follow")}>
            先頭を追う
          </button>
          <button aria-pressed={camera === "mine"} onClick={() => setCamera("mine")} disabled={myIndex < 0}>
            自分の馬
          </button>
          <button aria-pressed={camera === "overview"} onClick={() => setCamera("overview")}>
            全体
          </button>
        </div>
        {conn.status === "reconnecting" && <span className="hud-warn">再接続中…</span>}
      </div>

      {countdown > 0 && (
        <div className="countdown" aria-live="assertive">
          {countdown}
        </div>
      )}

      {result && (
        <div className="result-sheet" role="dialog" aria-label="レース結果">
          <h2>確定</h2>
          <table className="table result-table">
            <thead>
              <tr>
                <th>着</th>
                <th>馬</th>
                <th className="hide-sm">オーナー</th>
                <th>タイム</th>
                <th>着差</th>
                <th className="num">賞金</th>
              </tr>
            </thead>
            <tbody>
              {result.results.map((r) => (
                <tr key={r.horseId} className={r.playerId === myId ? "is-me" : ""}>
                  <td className={`rank rank-${r.position}`}>{r.position}</td>
                  <td>
                    <SaddleCloth gate={r.gate} size="sm" /> {r.horseName}
                  </td>
                  <td className="hide-sm">{r.playerName}</td>
                  <td>{formatRaceTime(r.timeMs)}</td>
                  <td>{r.position === 1 ? "" : marginLabel(r.marginLengths)}</td>
                  <td className="num">{yen(r.prize)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">賞金と戦績はサーバーで保存済みです。</p>
          <button className="btn btn-primary btn-wide" onClick={onBack}>
            厩舎に戻る
          </button>
        </div>
      )}
    </div>
  );
}
