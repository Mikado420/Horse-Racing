// オフライン版のゲーム状態を React で扱うフック。操作のたびに自動で保存する。
import { useCallback, useMemo, useRef, useState } from "react";
import { STARTER_TEMPLATES, type Horse, type TrainingMenu } from "@owners/shared";
import type { Backend } from "../backend";
import type { HistoryRow, MyRace } from "../api";
import * as E from "./engine";
import { browserStore, deleteSave, exportSave, importSave, loadSave, writeSave } from "./storage";

/** 操作ごとの乱数シード（暗号論的乱数を使えるときは使う） */
export function freshSeed(): number {
  try {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  } catch {
    return Math.floor(Math.random() * 2 ** 32);
  }
}

export interface OfflineGame {
  save: E.OfflineSave | null;
  loadError: string | null;
  backend: Backend;
  newGame(ownerName: string): void;
  runRace(horseId: string, programId: string): E.OfflineRaceOutcome;
  estimate(horseId: string, programId: string, trials: number): E.RaceEstimate;
  buy(offerId: string): Horse;
  exportText(): string;
  importText(text: string): void;
  reset(): void;
}

export function useOfflineGame(): OfflineGame {
  const store = useMemo(() => browserStore(), []);
  const initial = useMemo(() => loadSave(store), [store]);
  const [save, setSave] = useState<E.OfflineSave | null>(initial.save);
  const [loadError, setLoadError] = useState<string | null>(initial.error ?? null);
  // 非同期の画面処理から常に最新のセーブを参照するため ref にも持つ
  const ref = useRef(save);
  ref.current = save;

  const commit = useCallback(
    (next: E.OfflineSave) => {
      ref.current = next;
      writeSave(store, next);
      setSave(next);
    },
    [store],
  );
  const current = () => ref.current ?? (() => {
    throw new E.GameError("ゲームが始まっていません");
  })();

  const backend = useMemo<Backend>(() => {
    const toHistory = (s: E.OfflineSave, horseId: string): HistoryRow[] =>
      s.history
        .filter((r) => r.horseId === horseId)
        .map((r) => ({
          raceId: r.raceId,
          courseName: `${r.courseName} ${r.programName}`,
          distance: r.distance,
          fieldSize: r.fieldSize,
          position: r.position,
          timeMs: r.timeMs,
          prize: r.prize,
          createdAt: r.createdAt,
        }));
    return {
      mode: "offline",
      me: async () => {
        const s = current();
        return { player: s.player, horses: s.horses.filter((h) => !h.retired) };
      },
      myRaces: async (): Promise<MyRace[]> =>
        current().history.slice(0, 20).map((r) => ({
          raceId: r.raceId,
          courseName: `${r.courseName} ${r.programName}`,
          distance: r.distance,
          fieldSize: r.fieldSize,
          horseName: r.horseName,
          position: r.position,
          prize: r.prize,
          createdAt: r.createdAt,
        })),
      starters: async () => [...STARTER_TEMPLATES],
      selectStarter: async (t, n) => commit(E.selectStarter(current(), t, n, freshSeed())),
      horse: async (id) => {
        const s = current();
        const horse = s.horses.find((h) => h.id === id);
        if (!horse) throw new E.GameError("馬が見つかりません");
        return { horse, history: toHistory(s, id) };
      },
      train: async (id, menu) => {
        const r = E.train(current(), id, menu as TrainingMenu, freshSeed());
        commit(r.save);
        return r;
      },
      rest: async (id) => {
        const r = E.rest(current(), id, freshSeed());
        commit(r.save);
        return r;
      },
      retire: async (id) => {
        const r = E.retireHorse(current(), id);
        commit(r.save);
        return { bonus: r.bonus };
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit]);

  return {
    save,
    loadError,
    backend,
    newGame: (name) => {
      setLoadError(null);
      commit(E.newGame(name, freshSeed()));
    },
    runRace: (horseId, programId) => {
      const out = E.runRace(current(), horseId, programId, freshSeed());
      commit(out.save);
      return out;
    },
    estimate: (horseId, programId, trials) => E.estimateRace(current(), horseId, programId, trials, freshSeed()),
    buy: (offerId) => {
      const r = E.buyHorse(current(), offerId);
      commit(r.save);
      return r.horse;
    },
    exportText: () => exportSave(current()),
    importText: (text) => {
      setLoadError(null);
      commit(importSave(text));
    },
    reset: () => {
      deleteSave(store);
      ref.current = null;
      setSave(null);
    },
  };
}
