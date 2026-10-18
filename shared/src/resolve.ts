// レースの確定処理（純粋関数）。オフライン版もオンラインサーバーもこの関数で着順・賞金・
// 馬の状態変化を決める。保存（localStorage や PostgreSQL）は呼び出し側の責任。
import { applyRaceAftermath } from "./horse";
import { conditionsFromSeed, simulateRace, type RaceConditions, type RaceSimResult } from "./race";
import { createRng } from "./rng";
import type { CourseDef, Horse } from "./types";

export interface ResolveEntry {
  horse: Horse;
  gate: number;
  /** null は CPU 馬（状態変化を記録しない） */
  ownerId: string | null;
  ownerName: string;
}

export interface ResolvedResult {
  position: number;
  gate: number;
  horseId: string;
  horseName: string;
  ownerId: string | null;
  ownerName: string;
  timeMs: number;
  marginLengths: number;
  prize: number;
}

export interface ResolvedRace {
  conditions: RaceConditions;
  sim: RaceSimResult;
  /** sim.frames の列順＝entries をゲート順に並べた順 */
  runners: ResolveEntry[];
  results: ResolvedResult[];
  /** 所有馬（ownerId が null でない馬）のレース後の状態 */
  horsesAfter: Horse[];
}

export function resolveRace(
  entries: ResolveEntry[],
  course: CourseDef,
  seed: number,
  prizeFor: (position: number, fieldSize: number) => number,
): ResolvedRace {
  const runners = [...entries].sort((a, b) => a.gate - b.gate);
  const conditions = conditionsFromSeed(seed, course);
  const sim = simulateRace(
    runners.map((e) => ({
      entryId: e.horse.id,
      gate: e.gate,
      stats: e.horse.stats,
      style: e.horse.style,
      aptitude: e.horse.aptitude,
      fatigue: e.horse.fatigue,
      condition: e.horse.condition,
    })),
    conditions,
    seed,
  );
  const fieldSize = runners.length;
  const afterRng = createRng(seed ^ 0x5bd1e995);
  const results: ResolvedResult[] = [];
  const horsesAfter: Horse[] = [];
  for (const r of sim.results) {
    const e = runners.find((x) => x.horse.id === r.entryId)!;
    const prize = prizeFor(r.position, fieldSize);
    results.push({
      position: r.position,
      gate: r.gate,
      horseId: e.horse.id,
      horseName: e.horse.name,
      ownerId: e.ownerId,
      ownerName: e.ownerName,
      timeMs: r.timeMs,
      marginLengths: r.marginLengths,
      prize,
    });
    // 乱数列の消費順を一定に保つため、CPU馬の分も計算してから捨てる
    const after = applyRaceAftermath(e.horse, r.position, prize, afterRng);
    if (e.ownerId !== null) horsesAfter.push(after);
  }
  return { conditions, sim, runners, results, horsesAfter };
}
