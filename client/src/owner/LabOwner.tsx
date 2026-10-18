// 検証（開発・バランス調整用）：仮の馬を同じ条件で何百回も走らせ、勝率・平均着順を調べる。
// 所有馬の真の能力は使わない（使えば見極めの意味がなくなるため）。
import { useState } from "react";
import {
  ABILITY_KEYS,
  ABILITY_LABELS,
  CLASS_DEFS,
  PACE_LABELS,
  SPURT_LABELS,
  STYLE_KEYS,
  STYLE_LABELS,
  allCourses,
  courseLabel,
  formatRaceTime,
  runTrials,
  type Abilities,
  type ClassId,
  type OwnerProgram,
  type PacePlan,
  type SpurtPlan,
  type Tactics,
  type TrialStats,
} from "@owners/shared";

const CLASSES = Object.keys(CLASS_DEFS) as ClassId[];

export function LabOwner() {
  const courses = allCourses();
  const [abilities, setAbilities] = useState<Abilities>(() => Object.fromEntries(ABILITY_KEYS.map((k) => [k, 60])) as Abilities);
  const [courseId, setCourseId] = useState(courses.find((c) => c.distance === 1600)!.id);
  const [range, setRange] = useState<[number, number]>([1400, 2000]);
  const [surfaceFit, setSurfaceFit] = useState(75);
  const [tactics, setTactics] = useState<Tactics>({ style: "stalker", pace: "normal", spurt: "normal" });
  const [trials, setTrials] = useState(200);
  const [rows, setRows] = useState<{ cls: ClassId; s: TrialStats }[] | null>(null);
  const [busy, setBusy] = useState(false);

  const run = () => {
    setBusy(true);
    setTimeout(() => {
      const course = courses.find((c) => c.id === courseId)!;
      const out = CLASSES.map((cls) => {
        const p: OwnerProgram = {
          id: "lab",
          week: 0,
          name: "検証",
          classId: cls,
          course,
          going: "good",
          fieldSize: 8,
          firstPrize: CLASS_DEFS[cls].firstPrize,
          ageMin: 2,
          ageMax: 9,
          conditionText: "",
          named: false,
        };
        const s = runTrials(
          {
            abilities,
            aptitude: {
              distanceMin: range[0],
              distanceMax: range[1],
              turf: course.surface === "turf" ? surfaceFit : 50,
              dirt: course.surface === "dirt" ? surfaceFit : 50,
              heavy: 50,
              right: 60,
              left: 60,
              slope: 50,
              tight: 50,
              styles: { front: 70, stalker: 70, closer: 70, deep: 70 },
            },
            traits: [],
            tactics,
            condition: 0,
            fatigue: 10,
            fitness: 85,
            experience: 5,
          },
          p,
          trials,
          12345,
        );
        return { cls, s };
      });
      setRows(out);
      setBusy(false);
    }, 20);
  };

  return (
    <div className="page">
      <h1 className="page-title">検証</h1>
      <p className="lead">
        開発・バランス調整用の画面です。仮の馬（能力を自由に設定）を CPU 馬と何百回も走らせて、クラスごとの勝率を調べます。
        所有馬の本当の能力はここでも使いません。
      </p>
      <div className="lab-grid">
        {ABILITY_KEYS.map((k) => (
          <label key={k}>
            {ABILITY_LABELS[k]} <strong>{abilities[k]}</strong>
            <input type="range" min={20} max={100} value={abilities[k]} onChange={(e) => setAbilities({ ...abilities, [k]: Number(e.target.value) })} />
          </label>
        ))}
        <label>
          適性距離 {range[0]}〜{range[1]}m
          <input type="range" min={1000} max={3000} step={100} value={range[0]} onChange={(e) => setRange([Number(e.target.value), Math.max(Number(e.target.value) + 200, range[1])])} />
          <input type="range" min={1200} max={3200} step={100} value={range[1]} onChange={(e) => setRange([Math.min(range[0], Number(e.target.value) - 200), Number(e.target.value)])} />
        </label>
        <label>
          馬場適性 <strong>{surfaceFit}</strong>
          <input type="range" min={0} max={100} value={surfaceFit} onChange={(e) => setSurfaceFit(Number(e.target.value))} />
        </label>
      </div>
      <div className="lab-controls">
        <label className="select-row">
          <span>コース</span>
          <select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {courseLabel(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="select-row">
          <span>脚質</span>
          <select value={tactics.style} onChange={(e) => setTactics({ ...tactics, style: e.target.value as Tactics["style"] })}>
            {STYLE_KEYS.map((s) => (
              <option key={s} value={s}>
                {STYLE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="select-row">
          <span>ペース</span>
          <select value={tactics.pace} onChange={(e) => setTactics({ ...tactics, pace: e.target.value as PacePlan })}>
            {(Object.keys(PACE_LABELS) as PacePlan[]).map((s) => (
              <option key={s} value={s}>
                {PACE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="select-row">
          <span>仕掛け</span>
          <select value={tactics.spurt} onChange={(e) => setTactics({ ...tactics, spurt: e.target.value as SpurtPlan })}>
            {(Object.keys(SPURT_LABELS) as SpurtPlan[]).map((s) => (
              <option key={s} value={s}>
                {SPURT_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="select-row">
          <span>回数</span>
          <select value={trials} onChange={(e) => setTrials(Number(e.target.value))}>
            {[50, 200, 500].map((n) => (
              <option key={n} value={n}>
                {n}回
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-primary" disabled={busy} onClick={run}>
          {busy ? "計算中…" : "実行する"}
        </button>
      </div>
      {rows && (
        <div className="table-wrap">
          <table className="table lab-table">
            <thead>
              <tr>
                <th>クラス</th>
                <th>相手の能力</th>
                <th className="num">勝率</th>
                <th className="num">3着内</th>
                <th className="num">平均着順</th>
                <th className="num">平均タイム</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ cls, s }) => (
                <tr key={cls}>
                  <td>{CLASS_DEFS[cls].label}</td>
                  <td>
                    {CLASS_DEFS[cls].level[0]}〜{CLASS_DEFS[cls].level[1]}
                  </td>
                  <td className="num">{Math.round(s.winRate * 100)}%</td>
                  <td className="num">{Math.round(s.top3Rate * 100)}%</td>
                  <td className="num">{s.avgPosition.toFixed(2)}</td>
                  <td className="num">{formatRaceTime(s.avgTimeMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
