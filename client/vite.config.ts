import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 開発時は API をゲームサーバー(2567)へ中継する。WebSocket は colyseus.js が直接 2567 へ接続する。
// GitHub Pages など、サブパスに置く場合は BASE_PATH（例: /Horse-Racing/）を指定してビルドする。
export default defineConfig({
  base: process.env.BASE_PATH || "/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:2567",
    },
  },
});
