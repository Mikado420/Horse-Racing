// 出走：今週の番組から選び、調教師の意見を聞いて作戦を決め、レースを観戦する
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CLASS_DEFS,
  GOING_LABELS,
  PACE_LABELS,
  SPURT_LABELS,
  STYLE_KEYS,
  STYLE_LABELS,
  SURFACE_LABELS,
  activeHorses,
  entryProblem,
  ownerPrizeFor,
  thisWeekCard,
  trainerOpinion,
  weekLabel,
  LOCAL_OWNER_ID,
  type OwnerProgram,
  type OwnerRaceOutcome,
  type PacePlan,
  type RaceStartMsg,
  type ResultRow,
  type SpurtPlan,
  type Tactics,
} from "@owners/shared";
import { Notice } from "../components";
import { yen } from "../format";
import { RaceView } from "../screens/RaceView";
import type { OwnerGame } from "../offline/useOwnerGame";
import type { OScreen } from "./OwnerApp";
import { StanceChip, StateBlock, trainerName } from "./ui";

const REPLAY_SPEED = 2;
const COUNTDOWN_MS = 3000;

interface Running {
  race: RaceStartMsg;
  results: ResultRow[];
  resultAt: number;
  outcome: OwnerRaceOutcome;
}

export function RaceEntry({ game, initialHorseId, go }: { game: OwnerGame; initialHorseId?: string; go: (s: OScreen) => void }) {
  const save = game.save!;
  const horses = activeHorses(save);
  const card = thisWeekCard(save);
  const [horseId, setHorseId] = useState(() => initialHorseId ?? horses.find((h) => card.some((p) => !entryProblem(save, h, p)))?.id ?? horses[0]?.id ?? "");
  const horse = horses.find((h) => h.id === horseId);
  const [programId, setProgramId] = useState<string | null>(null);
  const [tactics, setTactics] = useState<Tactics | null>(null);
  const [running, setRunning] = useState<Running | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const program = card.find((p) => p.id === programId);
  const opinion = useMemo(() => (horse && program && !entryProblem(save, horse, program) ? trainerOpinion(save, horse.id, program.id) : null), [save, horse, program]);
  useEffect(() => {
    if (opinion) setTactics(opinion.suggestedTactics);
  }, [opinion]);

  const start = () => {
    if (!horse || !program || !tactics) return;
    if (opinion?.stance === "反対" && !window.confirm("調教師は今回の出走に反対しています。それでも出走させますか？（厩舎との関係が悪くなります）")) return;
    setError(null);
    try {
      const out = game.runRace(horse.id, program.id, tactics);
      const now = Date.now();
      const startAt = now + COUNTDOWN_MS;
      const results: ResultRow[] = out.record.field.map((f) => ({
        position: f.position,
        gate: f.gate,
        horseId: f.isMine ? out.record.horseId : `cpu-${f.gate}`,
        horseName: f.name,
        playerId: f.isMine ? LOCAL_OWNER_ID : "cpu",
        playerName: f.isMine ? save.player.username : "CPU厩舎",
        timeMs: f.timeMs,
        marginLengths: f.marginLengths,
        prize: f.isMine ? out.record.prize : ownerPrizeFor(program, f.position),
      }));
      const lastFinish = Math.max(...results.map((r) => r.timeMs));
      setRunning({
        race: { ...out.replay, startAt, serverNow: now, replaySpeed: REPLAY_SPEED },
        results,
        resultAt: startAt + lastFinish / REPLAY_SPEED + 500,
        outcome: out,
      });
      setShowResult(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (running) {
    const visible = showResult || Date.now() >= running.resultAt;
    const rec = running.outcome.record;
    return (
      <ResultWatcher at={running.resultAt} revealed={visible} onReveal={() => setShowResult(true)}>
        <RaceView
          race={running.race}
          now={Date.now}
          results={visible ? running.results : null}
          myId={LOCAL_OWNER_ID}
          onSkip={() => {
            setRunning({ ...running, race: { ...running.race, startAt: Date.now() - running.race.durationSec * 1000 } });
            setShowResult(true);
          }}
          savedNote="賞金と戦績はこのブラウザに保存しました。"
          backLabel="出走画面に戻る"
          onBack={() => {
            setRunning(null);
            setProgramId(null);
          }}
          actions={
            <div className="result-actions">
              <p className="trainer-comment">{rec.trainerComment}</p>
              {running.outcome.injured && <Notice kind="error">レース後に脚元の不安が見つかりました。治療が必要です。</Notice>}
              <button className="btn btn-primary btn-wide" onClick={() => go({ name: "analysis", raceId: rec.raceId })}>
                このレースを分析する
              </button>
              <button className="btn btn-quiet btn-wide" onClick={() => go({ name: "horse", horseId: rec.horseId })}>
                馬の見立てを見る
              </button>
            </div>
          }
        />
      </ResultWatcher>
    );
  }

  return (
    <div className="page">
      <h1 className="page-title">出走</h1>
      <p className="lead">
        {weekLabel(save.week)}の番組です。出走させる馬とレースを選び、調教師の意見を聞いて作戦を決めてください。相手は CPU 厩舎の馬です。
      </p>

      {horses.length === 0 ? (
        <p className="muted">現役の馬がいません。</p>
      ) : (
        <fieldset className="pick-horse pick-row">
          <legend>出走させる馬</legend>
          {horses.map((h) => {
            const n = card.filter((p) => !entryProblem(save, h, p)).length;
            return (
              <label key={h.id} className={`pick ${horse?.id === h.id ? "is-picked" : ""}`}>
                <input
                  type="radio"
                  name="horse"
                  checked={horse?.id === h.id}
                  onChange={() => {
                    setHorseId(h.id);
                    setProgramId(null);
                  }}
                />
                <strong>{h.name}</strong>
                <span className="muted">
                  {h.record.races}戦{h.record.wins}勝 ・ {n > 0 ? `出られるレース ${n}` : "今週は出られません"}
                </span>
              </label>
            );
          })}
        </fieldset>
      )}
      {horse && <StateBlock s={horse.state} compact />}
      {error && <Notice kind="error">{error}</Notice>}

      <h2 className="section-title">今週の番組</h2>
      <ul className="programs">
        {card.map((p) => {
          const problem = horse ? entryProblem(save, horse, p) : "馬を選んでください";
          return (
            <ProgramItem key={p.id} p={p} problem={problem} picked={programId === p.id} onPick={() => setProgramId(p.id)} />
          );
        })}
      </ul>

      {program && horse && opinion && tactics && (
        <section className="entry-panel" aria-label="出走の確認">
          <h2 className="section-title">
            {program.name}に{horse.name}で出走
          </h2>
          <div className="opinion">
            <p>
              {trainerName(horse.trainerId)}調教師の意見：<StanceChip stance={opinion.stance} />
            </p>
            <ul>
              {opinion.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
          <div className="tactics">
            <TacticRow
              label="脚質"
              value={tactics.style}
              options={STYLE_KEYS.map((s) => [s, STYLE_LABELS[s]])}
              onChange={(style) => setTactics({ ...tactics, style })}
            />
            <TacticRow
              label="ペース"
              value={tactics.pace}
              options={(Object.keys(PACE_LABELS) as PacePlan[]).map((s) => [s, PACE_LABELS[s]])}
              onChange={(pace) => setTactics({ ...tactics, pace })}
            />
            <TacticRow
              label="仕掛け"
              value={tactics.spurt}
              options={(Object.keys(SPURT_LABELS) as SpurtPlan[]).map((s) => [s, SPURT_LABELS[s]])}
              onChange={(spurt) => setTactics({ ...tactics, spurt })}
            />
            <p className="hint">作戦は騎手への指示です。馬の気性や展開、スタミナによって、実際の動きは変わることがあります。</p>
          </div>
          <button className="btn btn-primary btn-wide" onClick={start}>
            出走する
          </button>
        </section>
      )}
    </div>
  );
}

function ProgramItem({ p, problem, picked, onPick }: { p: OwnerProgram; problem: string | null; picked: boolean; onPick: () => void }) {
  const c = p.course;
  return (
    <li className={`program ${p.named ? "tier-4" : ""} ${picked ? "is-picked" : ""}`}>
      <div className="program-name">
        <strong>{p.name}</strong>
        <span className="tag">{CLASS_DEFS[p.classId].label}</span>
      </div>
      <dl className="program-facts">
        <div>
          <dt>コース</dt>
          <dd>
            {c.trackName} {SURFACE_LABELS[c.surface]}
            {c.distance}m
          </dd>
        </div>
        <div>
          <dt>特徴</dt>
          <dd>
            {c.direction === "right" ? "右回り" : "左回り"}
            {c.slope ? "・坂" : ""}
            {c.tight ? "・小回り" : ""}
          </dd>
        </div>
        <div>
          <dt>馬場</dt>
          <dd>{GOING_LABELS[p.going]}</dd>
        </div>
        <div>
          <dt>条件</dt>
          <dd>{p.conditionText}</dd>
        </div>
        <div>
          <dt>1着賞金</dt>
          <dd>{yen(p.firstPrize)}</dd>
        </div>
      </dl>
      <button className={`btn ${picked ? "btn-primary" : ""}`} disabled={!!problem} onClick={onPick}>
        {picked ? "選択中" : "このレースを検討"}
      </button>
      {problem && <p className="hint">{problem}</p>}
    </li>
  );
}

function TacticRow<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="tactic-row">
      <span className="tactic-label">{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} aria-pressed={value === v} onClick={() => onChange(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 再生がゴールに達した時刻に結果を表示する */
function ResultWatcher({ at, revealed, onReveal, children }: { at: number; revealed: boolean; onReveal: () => void; children: ReactNode }) {
  useEffect(() => {
    if (revealed) return;
    const id = setTimeout(onReveal, Math.max(0, at - Date.now()));
    return () => clearTimeout(id);
  }, [at, revealed, onReveal]);
  return <>{children}</>;
}
