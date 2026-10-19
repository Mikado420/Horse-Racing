// PWA の Service Worker 登録と自動更新（指示書 21章）。
// 「新しいファイルの取得」と「アプリへの適用」を分けて扱う：
//  1. 起動時・画面への復帰時・プレイ中は約45分ごとに更新を確認する
//  2. 新しいバージョンがあれば、ブラウザが裏で新しい Service Worker とファイルを取得する（この間もプレイは続く）
//  3. 準備ができたら「更新待ち」になる
//  4. レース観戦中・週送り中・出走確定などの処理中・未確定の入力があるときは切り替えない
//  5. 画面が裏に回ったとき・起動直後でまだ操作していないとき・「更新を適用」を押したときに切り替える
// 取得に失敗しても、今のバージョンのまま遊び続けられる。
import { useSyncExternalStore } from "react";
import { Workbox } from "workbox-window";
import { shouldApply, shouldCheck, shouldReloadForOtherTab, type ApplyMoment, type CheckTrigger } from "./policy";

export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
export const BUILD_TIME: string = typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : "";

export type UpdateStatus =
  /** 開発環境・非対応ブラウザ（Service Worker を使わない） */
  | "unsupported"
  | "idle"
  | "checking"
  /** 新しいバージョンを裏で取得中 */
  | "downloading"
  /** 新しいバージョンの準備ができた（適用待ち） */
  | "ready"
  /** 切り替え中（まもなく読み込み直す） */
  | "applying";

export interface UpdateState {
  status: UpdateStatus;
  lastCheck: number | null;
  lastError: string | null;
  /** 切り替えを止めている理由 */
  blockers: string[];
  /** 「更新を適用」が押されたが、処理が終わるのを待っている */
  requested: boolean;
  offlineReady: boolean;
  /** ホーム画面に追加できる（Android などで案内を出せる） */
  canPrompt: boolean;
  standalone: boolean;
}

let state: UpdateState = {
  status: "unsupported",
  lastCheck: null,
  lastError: null,
  blockers: [],
  requested: false,
  offlineReady: false,
  canPrompt: false,
  standalone: isStandalone(),
};
const listeners = new Set<() => void>();
function set(p: Partial<UpdateState>) {
  state = { ...state, ...p };
  for (const l of listeners) l();
}
export function getUpdateState(): UpdateState {
  return state;
}
export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function useUpdateState(): UpdateState {
  return useSyncExternalStore(subscribe, getUpdateState, getUpdateState);
}

/* ---------------- 切り替えを止める理由（ブロッカー） ---------------- */

const blockers = new Map<string, number>();
let pendingReload = false;

/** 処理中・観戦中などに true にする。同じ key を複数箇所で使ってもよい（回数で数える） */
export function setUpdateBlocker(key: string, on: boolean) {
  const n = (blockers.get(key) ?? 0) + (on ? 1 : -1);
  if (n > 0) blockers.set(key, n);
  else blockers.delete(key);
  set({ blockers: [...blockers.keys()] });
  if (blockers.size === 0) {
    if (pendingReload) return reload("other-tab");
    tryApply("unblocked");
  }
}

/* ---------------- 登録と確認 ---------------- */

let wb: Workbox | null = null;
let registration: ServiceWorkerRegistration | null = null;
let initiatedHere = false;
const launchedAt = Date.now();
let interacted = false;
let installEvent: (Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }) | null = null;

export const UPDATED_FLAG = "owners.pwa.updatedFrom";

export function isStandalone(): boolean {
  try {
    return window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

export function initPwa() {
  // ホーム画面への追加（対応ブラウザのみ。表示するかどうかはブラウザが決める）
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e as typeof installEvent;
    set({ canPrompt: true });
  });
  window.addEventListener("appinstalled", () => set({ canPrompt: false, standalone: true }));
  const mark = () => (interacted = true);
  window.addEventListener("pointerdown", mark, { once: true, capture: true });
  window.addEventListener("keydown", mark, { once: true, capture: true });

  if (import.meta.env.DEV || !("serviceWorker" in navigator)) return; // 開発中は Service Worker を使わない
  const base = import.meta.env.BASE_URL;
  const hadController = !!navigator.serviceWorker.controller;
  wb = new Workbox(`${base}sw.js`, { scope: base, updateViaCache: "none" });

  wb.addEventListener("waiting", () => {
    set({ status: "ready" });
    tryApply("launch");
  });
  wb.addEventListener("installed", (e) => {
    if (!e.isUpdate) set({ offlineReady: true });
  });
  // 新しいバージョンが動き始めた（このタブ・ほかのタブのどちらが切り替えても届く）
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController && !initiatedHere) return; // 初回インストール
    if (initiatedHere) return reload("self");
    if (shouldReloadForOtherTab(blockers.size)) reload("other-tab");
    else {
      pendingReload = true;
      set({ status: "ready" });
    }
  });

  set({ status: "idle" });
  wb.register()
    .then((reg) => {
      registration = reg ?? null;
      if (!reg) return;
      if (reg.active) set({ offlineReady: true });
      reg.addEventListener("updatefound", () => {
        // 初回インストール以外は「新しいバージョンを取得中」
        if (reg.active) set({ status: "downloading" });
      });
      void check("launch");
    })
    .catch((e) => set({ status: "idle", lastError: String(e?.message ?? e) }));

  setInterval(() => void check("interval"), 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void check("resume");
    else tryApply("hidden");
  });
}

/** 更新を確認する（取得はブラウザが裏で行い、終わると status が ready になる） */
export async function check(trigger: CheckTrigger): Promise<void> {
  if (!wb || !registration) return;
  if (!shouldCheck(trigger, Date.now(), state.lastCheck, document.visibilityState === "visible")) return;
  if (state.status === "ready" || state.status === "applying") return;
  set({ status: state.status === "downloading" ? "downloading" : "checking", lastCheck: Date.now(), lastError: null });
  try {
    await registration.update();
    if (getUpdateState().status === "checking") set({ status: registration.waiting ? "ready" : "idle" });
  } catch (e) {
    // オフラインなど。今のバージョンのまま続ける
    set({ status: "idle", lastError: navigator.onLine ? "更新を確認できませんでした" : "オフラインのため更新を確認できません" });
  }
}

function tryApply(moment: ApplyMoment) {
  if (!wb || state.status !== "ready") return;
  const ok = shouldApply(moment, {
    ready: true,
    blockers: blockers.size,
    sinceLaunchMs: Date.now() - launchedAt,
    interacted,
    requested: state.requested,
  });
  if (!ok) return;
  initiatedHere = true;
  set({ status: "applying" });
  try {
    sessionStorage.setItem(UPDATED_FLAG, APP_VERSION);
  } catch {
    /* 表示用の印なので失敗してもよい */
  }
  const w = registration?.waiting;
  if (!navigator.serviceWorker.controller) {
    // このページがまだ Service Worker の管理下にない（初回訪問のまま更新が来た）
    w?.addEventListener("statechange", () => w.state === "activated" && reload("self"));
  }
  wb.messageSkipWaiting();
  // 念のため：切り替えの通知が来なければ数秒後に読み込み直す
  setTimeout(() => reload("self"), 4000);
}

/** 「更新を適用」ボタン。処理中なら終わってから切り替える */
export function requestApply() {
  set({ requested: true });
  tryApply("manual");
}

let reloading = false;
function reload(_why: "self" | "other-tab") {
  if (reloading) return;
  reloading = true;
  window.location.reload();
}

/** ホーム画面への追加を促す（対応ブラウザのみ） */
export async function promptInstall(): Promise<boolean> {
  if (!installEvent) return false;
  await installEvent.prompt();
  const r = await installEvent.userChoice.catch(() => ({ outcome: "dismissed" }));
  installEvent = null;
  set({ canPrompt: false });
  return r.outcome === "accepted";
}

export type Platform = "ios" | "android" | "other";
export function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}

/** 更新後の最初の起動か（表示用）。一度読んだら消す */
export function takeUpdatedFlag(): string | null {
  try {
    const v = sessionStorage.getItem(UPDATED_FLAG);
    if (v) sessionStorage.removeItem(UPDATED_FLAG);
    return v && v !== APP_VERSION ? v : null;
  } catch {
    return null;
  }
}
