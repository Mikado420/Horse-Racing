// オフライン：レース番組を選んでCPU馬と走る
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { RACE_PROGRAMS, STYLE_LABELS, programPrize, type Horse, type RaceStartMsg, type ResultRow } from "@owners/shared";
import { Notice } from "../components";
import { yen } from "../format";
import { RaceView } from "../screens/RaceView";
import type { Screen } from "../App";
import { entryProblem, LOCAL_PLAYER_ID, type RaceEstimate } from "./engine";
import type { OfflineGame } from "./useOfflineGame";

const REPLAY_SPEED = 2;
const COUNTDOWN_MS = 3000;

interface Running {
  race: RaceStartMsg;
  results: ResultRow[];
  resultAt: number;
  horseId: string;
  programId: string;
}

export function OfflineRaceScreen({ game, initialHorseId, go }: { game: OfflineGame; initialHorseId?: string; go: (s: Screen) => void }) {
  const save = game.save!;
  const horses = save.horses.filter((h) => !h.retired);
  const [horseId, setHorseId] = useState(() => initialHorseId ?? horses[0]?.id ?? "");
  const [running, setRunning] = useState<Running | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [estimates, setEstimates] = useState<Record<string, RaceEstimate>>({});
  const [error, setError] = useState<string | null>(null);
  const horse = horses.find((h) => h.id === horseId) ?? horses[0];

  const start = (programId: string, hId = horseId) => {
    setError(null);
    try {
      const out = game.runRace(hId, programId);
      const now = Date.now();
      const startAt = now + COUNTDOWN_MS;
      const lastFinish = Math.max(...out.results.map((r) => r.timeMs));
      setRunning({
        race: { ...out.replay, startAt, serverNow: now, replaySpeed: REPLAY_SPEED },
        results: out.results,
        resultAt: startAt + lastFinish / REPLAY_SPEED + 500,
        horseId: hId,
        programId,
      });
      setShowResult(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const estimateAll = () => {
    if (!horse) return;
    const next: Record<string, RaceEstimate> = {};
    for (const p of RACE_PROGRAMS) next[p.id] = game.estimate(horse.id, p.id, 80);
    setEstimates(next);
  };

  // 結果発表は再生がゴールに達してから（スキップで即時）
  const now = Date.now;
  if (running) {
    const visible = showResult || now() >= running.resultAt;
    const h = save.horses.find((x) => x.id === running.horseId);
    const again = h ? entryProblem(save, h, running.programId) : "馬が見つかりません";
    return (
      <ResultWatcher running={running} onReveal={() => setShowResult(true)} revealed={visible}>
        <RaceView
          race={running.race}
          now={now}
          results={visible ? running.results : null}
          myId={LOCAL_PLAYER_ID}
          onSkip={() => {
            setRunning({ ...running, race: { ...running.race, startAt: Date.now() - running.race.durationSec * 1000 } });
            setShowResult(true);
          }}
          savedNote="賞金と戦績はこのブラウザに保存しました。"
          backLabel="レース選択に戻る"
          onBack={() => setRunning(null)}
          actions={
            <div className="result-actions">
              <button className="btn btn-wide" disabled={!!again} onClick={() => start(running.programId, running.horseId)}>
                同じレースにもう一度出走
              </button>
              {again && <p className="hint">{again}</p>}
              <button className="btn btn-quiet btn-wide" onClick={() => go({ name: "horse", horseId: running.horseId })}>
                馬の様子を見る（調教・休養）
              </button>
            </div>
          }
        />
      </ResultWatcher>
    );
  }

  return (
    <div className="page">
      <h1 className="page-title">レース選択</h1>
      <p className="lead">出走させる馬とレースを選んでください。相手は CPU 厩舎の馬 7 頭です。</p>

      <fieldset className="pick-horse pick-row">
        <legend>出走させる馬</legend>
        {horses.map((h) => (
          <label key={h.id} className={`pick ${horse?.id === h.id ? "is-picked" : ""}`}>
            <input
              type="radio"
              name="horse"
              checked={horse?.id === h.id}
              onChange={() => {
                setHorseId(h.id);
                setEstimates({});
              }}
            />
            <strong>{h.name}</strong>
            <span className="muted">
              {STYLE_LABELS[h.style]} ・ {h.wins}勝 ・ 疲労 {h.fatigue}
            </span>
          </label>
        ))}
      </fieldset>

      {error && <Notice kind="error">{error}</Notice>}

      <div className="program-head">
        <h2 className="section-title">番組</h2>
        <button className="btn btn-quiet" onClick={estimateAll} disabled={!horse}>
          今の状態で勝率を見積もる
        </button>
      </div>
      <ul className="programs">
        {RACE_PROGRAMS.map((p) => (
          <ProgramCard
            key={p.id}
            programId={p.id}
            horse={horse}
            problem={horse ? entryProblem(save, horse, p.id) : "馬がいません"}
            estimate={estimates[p.id]}
            onRun={() => start(p.id)}
          />
        ))}
      </ul>
    </div>
  );
}

function ProgramCard({
  programId,
  horse,
  problem,
  estimate,
  onRun,
}: {
  programId: string;
  horse?: Horse;
  problem: string | null;
  estimate?: RaceEstimate;
  onRun: () => void;
}) {
  const p = RACE_PROGRAMS.find((x) => x.id === programId)!;
  const strength = useMemo(() => "★".repeat(p.tier) + "☆".repeat(4 - p.tier), [p.tier]);
  return (
    <li className={`program tier-${p.tier}`}>
      <div className="program-name">
        <strong>{p.name}</strong>
        <span className="program-stars" aria-label={`難易度 ${p.tier}/4`}>
          {strength}
        </span>
      </div>
      <dl className="program-facts">
        <div>
          <dt>条件</dt>
          <dd>{p.conditionText}</dd>
        </div>
        <div>
          <dt>コース</dt>
          <dd>
            芝{p.course.distance}m・{p.fieldSize}頭
          </dd>
        </div>
        <div>
          <dt>1着賞金</dt>
          <dd>{yen(programPrize(p, 1))}</dd>
        </div>
        <div>
          <dt>出走経費</dt>
          <dd>{yen(p.entryFee)}</dd>
        </div>
        <div>
          <dt>相手の能力</dt>
          <dd>
            {p.cpuStats.min}〜{p.cpuStats.max}
          </dd>
        </div>
      </dl>
      {estimate && (
        <p className="estimate">
          勝率 <strong>{Math.round(estimate.winRate * 100)}%</strong> ・ 3着内 {Math.round(estimate.top3Rate * 100)}% ・ 期待収支{" "}
          <span className={estimate.expectedNet >= 0 ? "plus" : "minus"}>
            {estimate.expectedNet >= 0 ? "+" : "−"}
            {yen(Math.abs(Math.round(estimate.expectedNet)))}
          </span>
        </p>
      )}
      <button className="btn btn-primary" disabled={!!problem || !horse} onClick={onRun}>
        出走する
      </button>
      {problem && <p className="hint">{problem}</p>}
    </li>
  );
}

/** 再生がゴールに達した時刻に結果を表示する */
function ResultWatcher({ running, revealed, onReveal, children }: { running: Running; revealed: boolean; onReveal: () => void; children: ReactNode }) {
  useEffect(() => {
    if (revealed) return;
    const id = setTimeout(onReveal, Math.max(0, running.resultAt - Date.now()));
    return () => clearTimeout(id);
  }, [running, revealed, onReveal]);
  return <>{children}</>;
}
