// 画面から自動更新の切り替えを一時的に止めるためのフック
import { useEffect } from "react";
import { setUpdateBlocker } from "./update";

/** active の間、新しいバージョンへの切り替えを延期する（レース観戦中・処理中・入力の途中など） */
export function useUpdateBlocker(key: string, active: boolean) {
  useEffect(() => {
    if (!active) return;
    setUpdateBlocker(key, true);
    return () => setUpdateBlocker(key, false);
  }, [key, active]);
}
