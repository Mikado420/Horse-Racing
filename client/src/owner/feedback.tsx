// 共通の通知（ToastNotification）と確認ダイアログ（ConfirmActionDialog）
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons";
import { useUpdateBlocker } from "../pwa/hooks";

/* ---------------- Toast ---------------- */

export type ToastKind = "info" | "good" | "error" | "gold";
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}
const ToastCtx = createContext<(text: string, kind?: ToastKind) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

const TOAST_ICON: Record<ToastKind, IconName> = { info: "info", good: "check", error: "alert", gold: "trophy" };

/* ---------------- Confirm ---------------- */

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  okLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}
const ConfirmCtx = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function FeedbackProvider({ children, onSound }: { children: ReactNode; onSound?: (k: ToastKind) => void }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirm, setConfirm] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const seq = useRef(0);

  const toast = useCallback(
    (text: string, kind: ToastKind = "info") => {
      const id = ++seq.current;
      setToasts([{ id, kind, text }]);
      onSound?.(kind);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 5000 : 2600);
    },
    [onSound],
  );
  const ask = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setConfirm({ ...o, resolve })), []);
  // 確認の途中は新しいバージョンへ切り替えない
  useUpdateBlocker("dialog", !!confirm);
  const close = (v: boolean) => {
    confirm?.resolve(v);
    setConfirm(null);
  };

  return (
    <ToastCtx.Provider value={toast}>
      <ConfirmCtx.Provider value={ask}>
        {children}
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.kind}`}>
              <Icon name={TOAST_ICON[t.kind]} />
              <span>{t.text}</span>
            </div>
          ))}
        </div>
        {confirm && (
          <ModalDialog title={confirm.title} onClose={() => close(false)} labelledBy="confirm-title">
            <div className="confirm-body">{confirm.body}</div>
            <div className="dialog-actions">
              <button className="btn btn-ghost" onClick={() => close(false)}>
                {confirm.cancelLabel ?? "やめる"}
              </button>
              <button className={`btn ${confirm.danger ? "btn-danger" : "btn-primary"}`} onClick={() => close(true)} autoFocus>
                {confirm.okLabel}
              </button>
            </div>
          </ModalDialog>
        )}
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  );
}

/* ---------------- ModalDialog / BottomSheet ---------------- */

function useEscape(onClose: () => void) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
}

export function ModalDialog({ title, onClose, children, labelledBy, wide }: { title: string; onClose: () => void; children: ReactNode; labelledBy?: string; wide?: boolean }) {
  useEscape(onClose);
  const id = labelledBy ?? "dialog-title";
  return createPortal(
    <div className="scrim" onClick={onClose}>
      <div className={`dialog ${wide ? "is-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={id} onClick={(e) => e.stopPropagation()}>
        <h2 id={id} className="dialog-title">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** 下から出るシート。横向きの低い画面では右側から出るパネルになる（CSSで切り替え） */
export function BottomSheet({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  useEscape(onClose);
  // 画面の重なり（牧場の景色の上の部品など）に関係なく、いちばん手前に出す
  return createPortal(
    <div className="scrim scrim-sheet" onClick={onClose}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="閉じる">
            <Icon name="close" />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {actions && <footer className="sheet-actions">{actions}</footer>}
      </section>
    </div>,
    document.body,
  );
}

/* ---------------- 状態表示 ---------------- */

export function EmptyState({ icon = "info", title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state-box">
      <Icon name={icon} />
      <p className="state-title">{title}</p>
      {children && <p className="state-text">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state-box is-error" role="alert">
      <Icon name="alert" />
      <p className="state-title">{title}</p>
      {children && <p className="state-text">{children}</p>}
    </div>
  );
}

export function LoadingState({ label = "読み込み中" }: { label?: string }) {
  return (
    <div className="state-box" aria-busy="true">
      <span className="spinner" aria-hidden />
      <p className="state-title">{label}</p>
    </div>
  );
}

/** 二重実行を防ぐ。処理中は busy が true になる */
export function useBusy() {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  // 週送り・出走確定・購入などの処理中は新しいバージョンへ切り替えない
  useUpdateBlocker("busy", busy);
  const run = useCallback(async (f: () => unknown | Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await f();
    } finally {
      // 画面の更新が終わってから解除する
      setTimeout(() => {
        lock.current = false;
        setBusy(false);
      }, 250);
    }
  }, []);
  return { busy, run };
}
