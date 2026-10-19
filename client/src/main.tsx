import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./owner/owner.css";
import "./owner/pasture.css";
import { initPwa } from "./pwa/update";
import { initKeyboardFix } from "./keyboard";

// Service Worker の登録と自動更新（本番ビルドのみ）
initPwa();
// 文字入力でページがずれたまま戻らない不具合の対策
initKeyboardFix();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
