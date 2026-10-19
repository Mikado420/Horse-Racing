import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./owner/owner.css";
import { initPwa } from "./pwa/update";

// Service Worker の登録と自動更新（本番ビルドのみ）
initPwa();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
