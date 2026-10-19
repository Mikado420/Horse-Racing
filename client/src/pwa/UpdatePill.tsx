// 新しいバージョンの準備ができたことを知らせる小さなボタン（馬主モード以外の画面用）
import { requestApply, useUpdateState } from "./update";
import { blockerLabel } from "./policy";

export function UpdatePill() {
  const u = useUpdateState();
  if (u.status !== "ready" && u.status !== "applying") return null;
  const waiting = u.requested && u.blockers.length > 0;
  return (
    <button className="update-pill" onClick={requestApply} disabled={u.status === "applying"} aria-live="polite">
      {u.status === "applying" ? "更新しています…" : waiting ? `${blockerLabel(u.blockers[0])}が終わったら更新します` : "新しいバージョンがあります：更新を適用"}
    </button>
  );
}
