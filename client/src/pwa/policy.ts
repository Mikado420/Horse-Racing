// 自動更新の判断（純粋関数）。いつ更新を確認し、いつ新しいバージョンへ切り替えてよいかを決める。
// 実際の Service Worker の操作は update.ts が行う。

/** 定期確認の間隔（プレイ中・画面が表示されているとき） */
export const CHECK_INTERVAL_MS = 45 * 60 * 1000;
/** これより短い間隔では確認しない（復帰のたびに何度も確認しない） */
export const MIN_CHECK_GAP_MS = 10 * 60 * 1000;
/** 起動直後、まだ操作していなければその場で切り替えてよい時間 */
export const LAUNCH_APPLY_WINDOW_MS = 20 * 1000;

export type CheckTrigger = "launch" | "interval" | "resume" | "manual";

export function shouldCheck(trigger: CheckTrigger, now: number, lastCheck: number | null, visible: boolean): boolean {
  if (trigger === "manual" || trigger === "launch") return true;
  if (!visible) return false;
  if (lastCheck === null) return true;
  const gap = now - lastCheck;
  return trigger === "interval" ? gap >= CHECK_INTERVAL_MS - 1000 : gap >= MIN_CHECK_GAP_MS;
}

/**
 * 切り替えを妨げる理由（ブロッカー）の名前と表示用の説明。
 * レース観戦中・週送り中・出走確定などの重要処理中・未確定の入力があるときは切り替えない。
 */
export const BLOCKER_LABELS: Record<string, string> = {
  race: "レース観戦中",
  busy: "処理の実行中",
  dialog: "確認の途中",
  form: "入力の途中",
  online: "オンラインのレースに参加中",
};

export function blockerLabel(key: string): string {
  return BLOCKER_LABELS[key.split(":")[0]] ?? "操作の途中";
}

export type ApplyMoment =
  /** 画面が裏に回った（ほかのアプリへ切り替え・画面を消した） */
  | "hidden"
  /** 起動直後でまだ操作していない */
  | "launch"
  /** ブロッカーが解除された（「更新を適用」を押した後の延期分） */
  | "unblocked"
  /** プレイヤーが「更新を適用」を押した */
  | "manual";

export interface ApplyContext {
  ready: boolean;
  blockers: number;
  /** 起動からの経過時間 */
  sinceLaunchMs: number;
  /** 起動後にプレイヤーが操作したか */
  interacted: boolean;
  /** 「更新を適用」が押されたが延期中 */
  requested: boolean;
}

/** この瞬間に新しいバージョンへ切り替えてよいか */
export function shouldApply(moment: ApplyMoment, c: ApplyContext): boolean {
  if (!c.ready || c.blockers > 0) return false;
  switch (moment) {
    case "manual":
    case "hidden":
      return true;
    case "launch":
      return !c.interacted && c.sinceLaunchMs <= LAUNCH_APPLY_WINDOW_MS;
    case "unblocked":
      return c.requested;
  }
}

/**
 * ほかのタブが新しいバージョンに切り替えたとき、このタブを今すぐ読み込み直してよいか。
 * レース中などは読み込み直さず、終わってから読み込み直す。
 */
export function shouldReloadForOtherTab(blockers: number): boolean {
  return blockers === 0;
}
