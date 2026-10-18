// オフライン：検証（同じ条件のレースを何度も走らせて、難易度と報酬のバランスを確かめる）
import { useState } from "react";
import { RACE_PROGRAMS, STAT_KEYS, STAT_LABELS, type Horse, type Stats } from "@owners/shared";
import { Notice } from "../components";
import { yen } from "../format";
import { estimateRace, type OfflineSave, type RaceEstimate } from "./engine";
import { freshSeed, type OfflineGame } from "./useOfflineGame";

const TRIALS = [50, 200, 500];

export function LabScreen({ game }: { game: OfflineGame }) {
  const save = game.save!;
  const horses = save.horses.filter((h) => !h.retired);
  const [horseId, setHorseId] = useState(horses[0]?.id ?? "");
  const [trials, setTrials] = useState(200);
  const [overrides, setOverrides] = useState<Partial<Stats> & { fatigue?: number; condition?: number }>({});
  const [rows, setRows] = useState<{ id: string; name: string; est: RaceEstimate }[] | null>(null);
  const [ms, setMs] = useState(0);
  const base = horses.find((h) => h.id === horseId);

  const probe = (): { save: OfflineSave; horse: Horse } | null => {
    if (!base) return null;
    const stats = { ...base.stats };
    for (const k of STAT_KEYS) if (overrides[k] !== undefined) stats[k] = overrides[k]!;
    const horse: Horse = {
      ...base,
      stats,
      fatigue: overrides.fatigue ?? base.fatigue,
      condition: overrides.condition ?? base.condition,
    };
    return { save: { ...save, horses: save.horses.map((h) => (h.id === horse.id ? horse : h)) }, horse };
  };

  const run = () => {
    const p = probe();
    if (!p) return;
    const t0 = performance.now();
    const seed = freshSeed();
    setRows(RACE_PROGRAMS.map((prog) => ({ id: prog.id, name: prog.name, est: estimateRace(p.save, p.horse.id, prog.id, trials, seed) })));
    setMs(Math.round(performance.now() - t0));
  };

  const setNum = (key: string, v: string) => {
    const n = v === "" ? undefined : Math.max(-2, Math.min(130, Number(v)));
    setOverrides((o) => ({ ...o, [key]: Number.isFinite(n as number) ? n : undefined }));
  };

  return (
    <div className="page">
      <h1 className="page-title">検証</h1>
      <p className="lead">
        CPU馬とのレースを何度も計算して、各クラスの勝ちやすさと収支を確かめます。セーブデータは変わりません。
      </p>
      {horses.length === 0 ? (
        <Notice>現役の馬がいません。</Notice>
      ) : (
        <>
          <div className="lab-controls">
            <label>
              馬
              <select value={horseId} onChange={(e) => setHorseId(e.target.value)}>
                {horses.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              回数
              <select value={trials} onChange={(e) => setTrials(Number(e.target.value))}>
                {TRIALS.map((t) => (
                  <option key={t} value={t}>
                    {t}回
                  </option>
                ))}
              </select>
            </label>
          </div>
          <details className="lab-override">
            <summary>能力や状態を仮に変えて試す</summary>
            <div className="lab-grid">
              {STAT_KEYS.map((k) => (
                <label key={k}>
                  {STAT_LABELS[k]}
                  <input type="number" min={0} max={130} placeholder={String(base?.stats[k] ?? "")} onChange={(e) => setNum(k, e.target.value)} />
                </label>
              ))}
              <label>
                疲労
                <input type="number" min={0} max={100} placeholder={String(base?.fatigue ?? "")} onChange={(e) => setNum("fatigue", e.target.value)} />
              </label>
              <label>
                調子(−2〜2)
                <input type="number" min={-2} max={2} placeholder={String(base?.condition ?? "")} onChange={(e) => setNum("condition", e.target.value)} />
              </label>
            </div>
          </details>
          <button className="btn btn-primary" onClick={run}>
            全クラスで{trials}回ずつ走らせる
          </button>
        </>
      )}
      {rows && (
        <>
          <table className="table lab-table">
            <thead>
              <tr>
                <th>レース</th>
                <th className="num">勝率</th>
                <th className="num">3着内</th>
                <th className="num">平均着順</th>
                <th className="num">平均賞金</th>
                <th className="num">期待収支/回</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td className="num">{(r.est.winRate * 100).toFixed(1)}%</td>
                  <td className="num">{(r.est.top3Rate * 100).toFixed(1)}%</td>
                  <td className="num">{r.est.avgPosition.toFixed(2)}</td>
                  <td className="num">{yen(Math.round(r.est.avgPrize))}</td>
                  <td className={`num ${r.est.expectedNet >= 0 ? "plus" : "minus"}`}>
                    {r.est.expectedNet >= 0 ? "+" : "−"}
                    {yen(Math.abs(Math.round(r.est.expectedNet)))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">
            計算時間 {ms}ms。出走条件（勝利数など）は無視して計算しています。
          </p>
        </>
      )}
    </div>
  );
}
