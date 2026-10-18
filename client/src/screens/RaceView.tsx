import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  GOING_LABELS,
  WEATHER_LABELS,
  distancesAt,
  formatRaceTime,
  liveOrder,
  marginLabel,
  type RaceStartMsg,
  type ResultRow,
} from "@owners/shared";
import { SaddleCloth } from "../components";
import { yen } from "../format";
import { RaceScene, type CameraMode } from "../three/RaceScene";

/** 再生時刻（レース内の経過秒） */
export function raceClock(race: RaceStartMsg, serverNow: number): number {
  return Math.max(0, ((serverNow - race.startAt) / 1000) * race.replaySpeed);
}

export function useNow(serverNow: () => number, intervalMs: number) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(id);
  }, [serverNow, intervalMs]);
  return now;
}


export interface RaceViewProps {
  race: RaceStartMsg;
  /** 現在時刻（オンラインはサーバー時刻の推定値、オフラインは端末の時刻） */
  now: () => number;
  results: ResultRow[] | null;
  myId: string;
  reconnecting?: boolean;
  onBack: () => void;
  backLabel?: string;
  /** 結果表の下に出す追加の操作（オフラインの「もう一度」など） */
  actions?: ReactNode;
  /** 再生を飛ばして結果へ（オフラインのみ） */
  onSkip?: () => void;
  savedNote?: string;
}

export function RaceView({ race, now: nowFn, results, myId, reconnecting, onBack, backLabel = "厩舎に戻る", actions, onSkip, savedNote = "賞金と戦績はサーバーで保存済みです。" }: RaceViewProps) {
  const [camera, setCamera] = useState<CameraMode>("follow");
  const now = useNow(nowFn, 100);
  const t = raceClock(race, now);
  const countdown = Math.ceil((race.startAt - now) / 1000);
  const dist = useMemo(() => distancesAt(race.frames, race.sampleDt, t), [race, t]);
  const order = liveOrder(dist, race.distance, race.finishOrder);
  const leaderRemain = Math.max(0, race.distance - (dist[order[0]] ?? 0));
  const myIndex = race.runners.findIndex((r) => r.playerId === myId);

  return (
    <div className="race-stage">
      <RaceScene race={race} serverNow={nowFn} camera={camera} highlight={myIndex} />

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
        {reconnecting && <span className="hud-warn">再接続中…</span>}
        {onSkip && !results && (
          <button className="btn btn-quiet hud-skip" onClick={onSkip}>
            結果へスキップ
          </button>
        )}
      </div>

      {countdown > 0 && (
        <div className="countdown" aria-live="assertive">
          {countdown}
        </div>
      )}

      {results && (
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
              {results.map((r) => (
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
          <p className="hint">{savedNote}</p>
          {actions}
          <button className="btn btn-primary btn-wide" onClick={onBack}>
            {backLabel}
          </button>
        </div>
      )}
    </div>
  );
}
