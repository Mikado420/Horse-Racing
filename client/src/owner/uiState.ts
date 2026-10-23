// 画面だけで使う設定と既読状態（ゲームのセーブデータとは別に、このブラウザに保存する）
import { useCallback, useState } from "react";
import type { Stance } from "@owners/shared";

export interface UiSettings {
  /** 演出：standard 標準 / reduced 簡略 */
  effects: "standard" | "reduced";
  sound: boolean;
  /** 3D描画の品質 */
  quality: "high" | "low";
  /** レースの再生速度 */
  replaySpeed: 1 | 2 | 4;
  /** 開発者向け機能（バランス調整用の検証）を表示する。通常のプレイでは使わない */
  devTools: boolean;
}

export interface UiState {
  settings: UiSettings;
  /** セーブ（createdAt）ごとの、確認済みの報告ID */
  readReports: Record<string, string[]>;
  /** 出走時の調教師の意見（レースID → 意見）。事前評価と結果の比較に使う */
  opinions: Record<string, { stance: Stance; reasons: string[] }>;
}

const KEY = "owners.ui.v2";
const DEFAULT: UiState = {
  settings: { effects: "standard", sound: false, quality: "high", replaySpeed: 2, devTools: false },
  readReports: {},
  opinions: {},
};

function load(): UiState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!raw || typeof raw !== "object") return DEFAULT;
    return { ...DEFAULT, ...raw, settings: { ...DEFAULT.settings, ...(raw.settings ?? {}) } };
  } catch {
    return DEFAULT;
  }
}

export function useUiState() {
  const [ui, setUi] = useState<UiState>(load);
  const update = useCallback((f: (u: UiState) => UiState) => {
    setUi((prev) => {
      const next = f(prev);
      try {
        // 古い意見は捨てて小さく保つ
        const ids = Object.keys(next.opinions);
        if (ids.length > 300) for (const id of ids.slice(0, ids.length - 300)) delete next.opinions[id];
        for (const k of Object.keys(next.readReports)) next.readReports[k] = next.readReports[k].slice(-400);
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* 保存できなくても続行 */
      }
      return next;
    });
  }, []);
  return { ui, update };
}
