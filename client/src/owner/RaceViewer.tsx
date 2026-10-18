// レース観戦（経営画面とは独立したモード）。3D映像を主役にし、UIは状況理解に必要なものだけ重ねる。
// 着順はシミュレーションの結果（record）を使い、映像の見た目では決めない。
// 状態は親（OwnerApp）が持つので、端末を回転してもレースは止まらず、やり直しにもならない。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GOING_LABELS,
  PACE_LABELS,
  SPURT_LABELS,
  STYLE_LABELS,
  SURFACE_LABELS,
  WEATHER_LABELS,
  cornerRadius,
  distancesAt,
  formatRaceTime,
  last600Rank,
  liveOrder,
  marginLabel,
  type RaceStartMsg,
} from "@owners/shared";
import { SaddleCloth } from "../components";
import { RaceScene, type CameraMode } from "../three/RaceScene";
import { useOwner } from "./context";
import { Icon } from "./icons";
import type { RunningRace } from "./OwnerApp";
import { StanceTag, trainerName, yen } from "./ui";

const COUNTDOWN_MS = 3200;

export function RaceViewer({ running, onExit }: { running: RunningRace; onExit: (to: "analysis" | "horse" | "race" | "home") => void }) {
  const { ui, setSettings, sound } = useOwner();
  const { outcome } = running;
  const rec = outcome.record;
  const replay = outcome.replay;
  const [race, setRace] = useState<RaceStartMsg>(() => {
    const now = Date.now();
    return { ...replay, startAt: now + COUNTDOWN_MS, serverNow: now, replaySpeed: ui.settings.replaySpeed };
  });
  const [camera, setCamera] = useState<CameraMode>("follow");
  const [showTable, setShowTable] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const now = useTicker(revealed ? 500 : 100);
  const t = Math.max(0, ((now - race.startAt) / 1000) * race.replaySpeed);
  const lastFinish = Math.max(...rec.field.map((f) => f.timeMs)) / 1000;
  const dist = useMemo(() => distancesAt(race.frames, race.sampleDt, t), [race, t]);
  const order = liveOrder(dist, race.distance, race.finishOrder);
  const myIndex = race.runners.findIndex((r) => r.horseId === rec.horseId);
  const leaderRemain = Math.max(0, race.distance - (dist[order[0]] ?? 0));
  const countdown = Math.ceil((race.startAt - now) / 1000);
  const banner = useRaceEvents(race, t, dist, order, myIndex);

  // 全頭がゴールしたら結果へ
  useEffect(() => {
    if (!revealed && t >= lastFinish + 0.8) setRevealed(true);
  }, [t, lastFinish, revealed]);
  useEffect(() => {
    if (revealed) sound(rec.position === 1 ? "win" : "goal");
  }, [revealed]); // eslint-disable-line react-hooks/exhaustive-deps

  const setSpeed = (s: 1 | 2 | 4) => {
    const n = Date.now();
    const cur = Math.max(0, ((n - race.startAt) / 1000) * race.replaySpeed);
    setRace((r) => ({ ...r, replaySpeed: s, startAt: n >= r.startAt ? n - (cur * 1000) / s : r.startAt }));
    setSettings({ replaySpeed: s });
  };
  const skip = () => {
    setRace((r) => ({ ...r, startAt: Date.now() - ((r.durationSec + 1) * 1000) / r.replaySpeed }));
    setRevealed(true);
  };

  const myRank = order.indexOf(myIndex) + 1;
  const top = order.slice(0, 3);
  const mini = top.includes(myIndex) || myIndex < 0 ? top : [...top, myIndex];

  return (
    <div className={`viewer ${revealed ? "is-done" : ""}`}>
      <div className="viewer-canvas">
        <RaceScene race={race} serverNow={Date.now} camera={camera} highlight={myIndex} quality={ui.settings.quality} />
      </div>

      <header className="viewer-top">
        <div className="viewer-race">
          <strong>{rec.programName}</strong>
          <span>
            {SURFACE_LABELS[rec.course.surface]}
            {rec.course.distance}m／{WEATHER_LABELS[race.weather]}／馬場{GOING_LABELS[rec.going]}
          </span>
        </div>
        <div className="viewer-remain" aria-label={`残り${Math.ceil(leaderRemain)}メートル`}>
          <span>残り</span>
          <strong>{Math.ceil(leaderRemain)}</strong>
          <span>m</span>
        </div>
        <div className="viewer-clock">{formatRaceTime(Math.min(t, race.durationSec) * 1000)}</div>
      </header>

      <button className="viewer-mini" onClick={() => setShowTable(true)} aria-label="順位表を開く">
        <ol>
          {mini.map((idx) => {
            const r = race.runners[idx];
            return (
              <li key={r.horseId} className={idx === myIndex ? "is-me" : ""}>
                <span className="mini-rank">{order.indexOf(idx) + 1}</span>
                <SaddleCloth gate={r.gate} size="sm" />
                <span className="mini-name">{r.horseName}</span>
              </li>
            );
          })}
        </ol>
        <span className="mini-more">
          <Icon name="list" size={14} />
          順位表
        </span>
      </button>

      {banner && !revealed && (
        <div className={`viewer-banner banner-${banner.kind}`} role="status" aria-live="polite" key={banner.text}>
          {banner.text}
        </div>
      )}
      {countdown > 0 && (
        <div className="viewer-countdown" aria-live="assertive">
          <span>{countdown > 3 ? "ゲートイン" : countdown}</span>
          {myRank > 0 && <small>{race.runners[myIndex].horseName}は{race.runners[myIndex].gate}番</small>}
        </div>
      )}

      {!revealed && (
        <footer className="viewer-controls">
          <div className="seg2 seg-dark" role="radiogroup" aria-label="カメラ">
            {(
              [
                ["follow", "先頭"],
                ["mine", "自分の馬"],
                ["overview", "全体"],
              ] as [CameraMode, string][]
            ).map(([c, l]) => (
              <button key={c} role="radio" aria-checked={camera === c} onClick={() => setCamera(c)}>
                {c === "follow" && <Icon name="camera" size={16} />}
                {l}
              </button>
            ))}
          </div>
          <div className="seg2 seg-dark" role="radiogroup" aria-label="再生速度">
            {([1, 2, 4] as const).map((s) => (
              <button key={s} role="radio" aria-checked={race.replaySpeed === s} onClick={() => setSpeed(s)}>
                {s === 1 ? "等速" : `${s}倍`}
              </button>
            ))}
          </div>
          <button className="btn btn-dark" onClick={skip}>
            結果へ
            <Icon name="next" size={16} />
          </button>
        </footer>
      )}

      {showTable && !revealed && (
        <div className="viewer-overlay" role="dialog" aria-label="現在の順位" onClick={() => setShowTable(false)}>
          <div className="viewer-table" onClick={(e) => e.stopPropagation()}>
            <header>
              <h2>現在の順位</h2>
              <button className="icon-btn" onClick={() => setShowTable(false)} aria-label="閉じる">
                <Icon name="close" />
              </button>
            </header>
            <ol>
              {order.map((idx, rank) => {
                const r = race.runners[idx];
                return (
                  <li key={r.horseId} className={idx === myIndex ? "is-me" : ""}>
                    <span className="mini-rank">{rank + 1}</span>
                    <SaddleCloth gate={r.gate} size="sm" />
                    <span className="mini-name">{r.horseName}</span>
                    <span className="mini-gap">{rank === 0 ? "" : `−${(dist[order[0]] - dist[idx]).toFixed(1)}m`}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}

      {revealed && <RaceResult running={running} onExit={onExit} />}
    </div>
  );
}

function useTicker(ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

interface Banner {
  kind: "info" | "hot" | "goal";
  text: string;
}

/** 重要な場面（最終コーナー・直線・競り合い・先頭交代・ゴール）を検出する。表示専用 */
function useRaceEvents(race: RaceStartMsg, t: number, dist: number[], order: number[], myIndex: number): Banner | null {
  const [banner, setBanner] = useState<(Banner & { until: number }) | null>(null);
  const fired = useRef(new Set<string>());
  const prevLeader = useRef<number | null>(null);
  const show = useCallback((key: string, b: Banner, sec = 2.2) => {
    if (fired.current.has(key)) return;
    fired.current.add(key);
    setBanner({ ...b, until: Date.now() + sec * 1000 });
  }, []);
  const course = race.course;
  useEffect(() => {
    if (t <= 0 || !course) return;
    const D = race.distance;
    const lead = order[0];
    const remain = D - (dist[lead] ?? 0);
    const S = course.straightLength;
    const turn = Math.PI * cornerRadius(course);
    if (remain <= S + turn && remain > S + turn * 0.5) show("corner", { kind: "info", text: "最終コーナー" });
    if (remain <= S && remain > S - 80) show("straight", { kind: "info", text: "最後の直線" });
    const gap = (dist[order[0]] ?? 0) - (dist[order[1]] ?? 0);
    if (remain <= 220 && remain > 20 && gap < 1.5) show("duel", { kind: "hot", text: "ゴール前の競り合い" });
    if (remain <= 0) show("goal", { kind: "goal", text: "ゴール" }, 1.6);
    // 中盤の先頭交代・自分の馬の進出
    if (prevLeader.current !== null && lead !== prevLeader.current && remain < D * 0.7 && remain > S + turn) show(`lead-${lead}`, { kind: "info", text: `${race.runners[lead].horseName}が先頭に` });
    prevLeader.current = lead;
    const myRank = order.indexOf(myIndex);
    if (myIndex >= 0 && myRank <= 2 && remain < D * 0.5 && remain > 100) show("me-top3", { kind: "info", text: `${race.runners[myIndex].horseName}が${myRank + 1}番手に上がる` });
  }, [t, dist, order, race, course, myIndex, show]);
  if (!banner || Date.now() > banner.until) return null;
  return banner;
}

/** レース結果：着順・タイム・着差・賞金・要約・調教師の振り返り・判明したこと・次の行動 */
function RaceResult({ running, onExit }: { running: RunningRace; onExit: (to: "analysis" | "horse" | "race" | "home") => void }) {
  const { ui } = useOwner();
  const { outcome, discoveries } = running;
  const rec = outcome.record;
  const tel = rec.telemetry;
  const before = ui.opinions[rec.raceId] ?? { stance: outcome.opinion.stance, reasons: outcome.opinion.reasons };
  const early = tel.positions[0]?.pos;
  const summary = [
    `${STYLE_LABELS[tel.styleShown]}の位置（序盤${early}番手）から`,
    tel.spurtRemain !== null ? `残り${tel.spurtRemain}mで仕掛け` : "",
    `上がり3F ${tel.last600.toFixed(1)}秒（${last600Rank(rec)}位）`,
    tel.blockedSec >= 3 ? `。直線で前が詰まる不利が${tel.blockedSec.toFixed(0)}秒あった` : "",
    tel.emptyRemain !== null ? `。残り${tel.emptyRemain}m付近で脚が上がった` : "",
  ]
    .filter(Boolean)
    .join("、")
    .replace(/、。/g, "。");
  const win = rec.position === 1;
  return (
    <div className="result-overlay" role="dialog" aria-label="レース結果">
      <div className="result-panel">
        <section className="result-mine">
          <p className="result-label">{rec.horseName}</p>
          <p className={`result-pos ${win ? "is-win" : ""}`}>
            {rec.position}
            <span>着／{rec.fieldSize}頭</span>
          </p>
          <dl className="facts compact">
            <div>
              <dt>タイム</dt>
              <dd>{formatRaceTime(rec.timeMs)}</dd>
            </div>
            <div>
              <dt>着差</dt>
              <dd>{win ? `${marginLabel(Math.abs(rec.marginToWinner))}差で勝利` : `勝ち馬から${marginLabel(rec.marginToWinner)}`}</dd>
            </div>
            <div>
              <dt>賞金</dt>
              <dd className={rec.prize > 20_000 ? "gold-num" : ""}>{yen(rec.prize)}</dd>
            </div>
            <div>
              <dt>作戦</dt>
              <dd>
                {STYLE_LABELS[rec.tactics.style]}・{PACE_LABELS[rec.tactics.pace]}・仕掛け{SPURT_LABELS[rec.tactics.spurt]}
              </dd>
            </div>
          </dl>
          <p className="result-summary">{summary}。</p>
          <p className="trainer-voice">{rec.trainerComment}</p>
          <p className="result-before">
            出走前の意見 <StanceTag stance={before.stance} />（{trainerName(rec.trainerId)}調教師）
          </p>
          {discoveries.length > 0 && (
            <div className="result-found">
              <h3>
                <Icon name="spark" size={16} />
                このレースで分かったこと
              </h3>
              <ul>
                {discoveries.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}
          {outcome.injured && (
            <p className="alert-line">
              <Icon name="alert" size={16} />
              レース後に脚元の不安が見つかりました。治療が必要です。
            </p>
          )}
        </section>
        <section className="result-list">
          <h2>確定</h2>
          <ol>
            {rec.field.map((f) => (
              <li key={f.gate} className={f.isMine ? "is-me" : ""}>
                <span className={`mini-rank ${f.position === 1 ? "is-win" : ""}`}>{f.position}</span>
                <SaddleCloth gate={f.gate} size="sm" />
                <span className="mini-name">{f.name}</span>
                <span className="mini-time">{formatRaceTime(f.timeMs)}</span>
                <span className="mini-gap">{f.position === 1 ? "" : marginLabel(f.marginLengths)}</span>
              </li>
            ))}
          </ol>
        </section>
        <footer className="result-actions2">
          <button className="btn btn-primary" onClick={() => onExit("analysis")}>
            <Icon name="chart" />
            このレースを分析
          </button>
          <button className="btn btn-ghost" onClick={() => onExit("horse")}>
            見立てを見る
          </button>
          <button className="btn btn-ghost" onClick={() => onExit("race")}>
            出走計画へ
          </button>
          <button className="btn btn-ghost" onClick={() => onExit("home")}>
            ホームへ
          </button>
        </footer>
      </div>
    </div>
  );
}
