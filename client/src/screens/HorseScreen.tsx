import { useCallback, useEffect, useState } from "react";
import {
  ECONOMY,
  RACE_FATIGUE_LIMIT,
  STAT_KEYS,
  STAT_LABELS,
  STYLE_LABELS,
  canRace,
  canTrain,
  formatRaceTime,
  type Horse,
  type StatKey,
} from "@owners/shared";
import { api, type HistoryRow } from "../api";
import { Gauge, Notice, StatBar } from "../components";
import { conditionLabel, yen } from "../format";
import type { Screen } from "../App";

const APT_ROWS: [string, keyof Horse["aptitude"]][] = [
  ["芝", "turf"],
  ["ダート", "dirt"],
  ["短距離", "sprint"],
  ["マイル", "mile"],
  ["中距離", "middle"],
  ["長距離", "long"],
];

export function HorseScreen({
  horseId,
  money,
  go,
  onChanged,
}: {
  horseId: string;
  money: number;
  go: (s: Screen) => void;
  onChanged: () => Promise<void> | void;
}) {
  const [horse, setHorse] = useState<Horse | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [log, setLog] = useState<{ kind: "info" | "error" | "good"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.horse(horseId);
      setHorse(r.horse);
      setHistory(r.history);
    } catch (e) {
      setLog({ kind: "error", text: (e as Error).message });
    }
  }, [horseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const train = async (menu: StatKey) => {
    setBusy(true);
    try {
      const r = await api.train(horseId, menu);
      setHorse(r.horse);
      const gains = Object.entries(r.gains)
        .filter(([, v]) => (v ?? 0) > 0)
        .map(([k, v]) => `${STAT_LABELS[k as StatKey]} +${v}`)
        .join("、");
      if (r.injured) setLog({ kind: "error", text: `調教中に故障しました。休養が${r.horse.injuryRestsLeft}回必要です。` });
      else setLog({ kind: gains ? "good" : "info", text: gains ? `${STAT_LABELS[menu]}調教：${gains}` : "能力は伸びませんでした（成長の上限に近づいています）" });
      await onChanged();
    } catch (e) {
      setLog({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const rest = async () => {
    setBusy(true);
    try {
      const r = await api.rest(horseId);
      setHorse(r.horse);
      setLog({ kind: "good", text: `休養しました。疲労 ${r.fatigueDelta}${r.conditionDelta > 0 ? "、調子が上向きました" : ""}` });
      await onChanged();
    } catch (e) {
      setLog({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!horse) return <div className="page">{log ? <Notice kind="error">{log.text}</Notice> : <p className="muted">読み込み中…</p>}</div>;

  const trainBlocked = canTrain(horse);
  const raceBlocked = canRace(horse);
  const noMoney = money < ECONOMY.trainingCost;

  return (
    <div className="page">
      <button className="link back" onClick={() => go({ name: "home" })}>
        厩舎に戻る
      </button>
      <section className="horse-head">
        <h1 className="page-title">{horse.name}</h1>
        <p className="muted">
          {STYLE_LABELS[horse.style]} ・ {horse.races}戦{horse.wins}勝 ・ 獲得賞金 {yen(horse.totalPrize)}
        </p>
      </section>

      <div className="horse-grid">
        <section className="panel">
          <h2 className="panel-title">能力</h2>
          {STAT_KEYS.map((k) => (
            <StatBar key={k} label={STAT_LABELS[k]} value={horse.stats[k]} cap={horse.potential[k]} />
          ))}
          <p className="hint">薄い帯は成長の上限です。</p>
          <h2 className="panel-title">適性</h2>
          <dl className="apt">
            {APT_ROWS.map(([label, key]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd className={`grade grade-${horse.aptitude[key]}`}>{horse.aptitude[key]}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="panel">
          <h2 className="panel-title">状態</h2>
          <div className="condition">
            <div>
              <span className="muted">疲労</span>
              <Gauge value={horse.fatigue} danger={RACE_FATIGUE_LIMIT} />
              <strong>{horse.fatigue}</strong>
            </div>
            <div>
              <span className="muted">調子</span>
              <strong className={`mood mood-${horse.condition}`}>{conditionLabel(horse.condition)}</strong>
            </div>
            {horse.injuryRestsLeft > 0 && <Notice kind="error">故障中：あと{horse.injuryRestsLeft}回の休養で回復します</Notice>}
          </div>

          <h2 className="panel-title">調教 <small className="muted">1回 {yen(ECONOMY.trainingCost)}</small></h2>
          <div className="train-grid">
            {STAT_KEYS.map((k) => (
              <button key={k} className="btn" disabled={busy || !!trainBlocked || noMoney} onClick={() => train(k)}>
                {STAT_LABELS[k]}
              </button>
            ))}
          </div>
          <button className="btn btn-quiet btn-wide" disabled={busy} onClick={rest}>
            休養させる（無料・疲労−40）
          </button>
          {trainBlocked && <p className="hint">{trainBlocked}</p>}
          {noMoney && !trainBlocked && <p className="hint">所持金が足りないため調教できません。レースで賞金を稼ぎましょう。</p>}
          {horse.fatigue > 70 && !trainBlocked && <p className="hint warn">疲労が70を超えると調教で故障することがあります。</p>}
          {log && <Notice kind={log.kind}>{log.text}</Notice>}

          <button
            className="btn btn-primary btn-wide"
            disabled={!!raceBlocked}
            onClick={() => go({ name: "race", horseId: horse.id })}
          >
            この馬で出走登録
          </button>
          {raceBlocked && <p className="hint">{raceBlocked}</p>}
        </section>
      </div>

      <h2 className="section-title">戦績</h2>
      {history.length === 0 ? (
        <p className="muted">まだ出走していません。</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>日時</th>
              <th>レース</th>
              <th>着順</th>
              <th>タイム</th>
              <th className="num">賞金</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.raceId}>
                <td>{new Date(h.createdAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                <td>
                  {h.courseName} {h.distance}m
                </td>
                <td className={h.position === 1 ? "pos-win" : ""}>
                  {h.position}着<small>/{h.fieldSize}頭</small>
                </td>
                <td>{formatRaceTime(h.timeMs)}</td>
                <td className="num">{yen(h.prize)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
