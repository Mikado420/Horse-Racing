// オフライン版（馬主モード）のゲーム状態を React で扱うフック。操作のたびに自動で保存する。
// ルールと計算はすべて shared の純粋関数（advanceWeek・runOwnerRace など）に任せ、ここでは保存と画面への受け渡しだけをする。
import { useCallback, useMemo, useRef, useState } from "react";
import * as G from "@owners/shared";
import { browserStore, deleteSave, exportSave, importSave, loadSave, writeSave } from "./storage";

/** 操作ごとの乱数シード（暗号論的乱数を使えるときは使う） */
export function freshSeed(): number {
  try {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  } catch {
    return Math.floor(Math.random() * 2 ** 32);
  }
}

export interface OwnerGame {
  save: G.OwnerSave | null;
  loadError: string | null;
  notice: string | null;
  storageError: string | null;
  dismissNotice(): void;
  newGame(ownerName: string): void;
  chooseStarter(offerId: string, trainerId: string, name: string | null): void;
  advance(weeks: number): { reports: G.WeeklyReport[]; notices: string[]; save: G.OwnerSave };
  setPolicy(horseId: string, patch: Partial<G.HorsePolicy>): void;
  transfer(horseId: string, trainerId: string): void;
  runRace(horseId: string, programId: string, tactics: G.Tactics): G.OwnerRaceOutcome;
  analyze(raceId: string): G.AnalysisOutcome;
  buy(offerId: string, trainerId: string, name: string | null): G.RaceHorse;
  sell(horseId: string): number;
  retire(horseId: string): number;
  exportText(): string;
  importText(text: string): void;
  reset(): void;
}

export function useOwnerGame(): OwnerGame {
  const store = useMemo(() => browserStore(), []);
  const initial = useMemo(() => loadSave(store), [store]);
  const [save, setSave] = useState<G.OwnerSave | null>(initial.save);
  const [loadError, setLoadError] = useState<string | null>(initial.error ?? null);
  const [notice, setNotice] = useState<string | null>(initial.notice ?? null);
  const [storageError, setStorageError] = useState<string | null>(null);
  // 非同期の画面処理から常に最新のセーブを参照するため ref にも持つ
  const ref = useRef(save);
  ref.current = save;

  const commit = useCallback(
    (next: G.OwnerSave) => {
      ref.current = next;
      try {
        writeSave(store, next);
        setStorageError(null);
      } catch {
        setStorageError("ブラウザへの保存に失敗しました（容量不足の可能性があります）。ファイルに書き出して保管してください。");
      }
      setSave(next);
    },
    [store],
  );
  const current = (): G.OwnerSave =>
    ref.current ??
    (() => {
      throw new G.OwnerGameError("ゲームが始まっていません");
    })();

  return {
    save,
    loadError,
    notice,
    storageError,
    dismissNotice: () => setNotice(null),
    newGame: (name) => {
      setLoadError(null);
      commit(G.newOwnerGame(name, freshSeed()));
    },
    chooseStarter: (offerId, trainerId, name) => commit(G.chooseStarter(current(), offerId, trainerId, name)),
    advance: (weeks) => {
      let s = current();
      const reports: G.WeeklyReport[] = [];
      const notices: string[] = [];
      for (let i = 0; i < weeks; i++) {
        const r = G.advanceWeek(s, freshSeed());
        s = r.save;
        reports.push(...r.reports);
        notices.push(...r.notices);
        // 故障や注意が出た週で止める（まとめて進めるときに見落とさないように）
        if (i < weeks - 1 && r.reports.some((x) => x.alerts.some((a) => /痛め|故障/.test(a)))) break;
      }
      commit(s);
      return { reports, notices, save: s };
    },
    setPolicy: (id, patch) => commit(G.setPolicy(current(), id, patch)),
    transfer: (id, trainerId) => commit(G.transferHorse(current(), id, trainerId)),
    runRace: (horseId, programId, tactics) => {
      const out = G.runOwnerRace(current(), horseId, programId, tactics, freshSeed());
      commit(out.save);
      return out;
    },
    analyze: (raceId) => {
      const out = G.applyRaceAnalysis(current(), raceId);
      commit(out.save);
      return out;
    },
    buy: (offerId, trainerId, name) => {
      const r = G.buyHorse(current(), offerId, trainerId, name);
      commit(r.save);
      return r.horse;
    },
    sell: (id) => {
      const r = G.sellHorse(current(), id);
      commit(r.save);
      return r.amount;
    },
    retire: (id) => {
      const r = G.retireHorse(current(), id);
      commit(r.save);
      return r.bonus;
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
