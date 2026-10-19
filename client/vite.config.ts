import { execSync } from "node:child_process";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// 開発時は API をゲームサーバー(2567)へ中継する。WebSocket は colyseus.js が直接 2567 へ接続する。
// GitHub Pages など、サブパスに置く場合は BASE_PATH（例: /Horse-Racing/）を指定してビルドする。

/** ビルドのバージョン（コミットの短いハッシュ）。公開後の配信確認と画面表示に使う */
function appVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try {
    return execSync("git rev-parse --short=8 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "local";
  }
}
const VERSION = appVersion();
const BUILD_TIME = new Date().toISOString();

/** dist/version.json を出力する（デプロイ後に、公開中のバージョンを確かめるため） */
function versionFile(): Plugin {
  return {
    name: "owners-version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ version: VERSION, builtAt: BUILD_TIME }) });
    },
  };
}

export default defineConfig({
  base: process.env.BASE_PATH || "/",
  define: {
    __APP_VERSION__: JSON.stringify(VERSION),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  plugins: [
    react(),
    versionFile(),
    VitePWA({
      // 登録と更新の切り替えは src/pwa/update.ts で行う（プレイ中に勝手に切り替えない）
      injectRegister: false,
      registerType: "prompt",
      // マニフェストは public/manifest.webmanifest をそのまま使う
      manifest: false,
      strategies: "generateSW",
      // 開発中は Service Worker を使わない（キャッシュで古い画面が出るのを防ぐ）
      devOptions: { enabled: false },
      workbox: {
        // アプリのシェルとビルド済みの静的ファイル（ファイル名にハッシュが付く）だけを事前に取得する
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest,woff2}"],
        globIgnores: ["version.json"],
        // 新しい HTML と古い JS/CSS が混ざらないよう、古いキャッシュは新しい版が有効になった時点で消す
        cleanupOutdatedCaches: true,
        // 「更新待ち」にしてから、安全なときに切り替える
        skipWaiting: false,
        clientsClaim: false,
        // 画面遷移は index.html で返す（SPA）。API とオンライン対戦の通信は対象外
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/\/api\//, /\/matchmake/, /version\.json$/],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          // Web フォント（個人情報を含まない公開ファイル）
          {
            urlPattern: ({ url }) => url.origin === "https://fonts.googleapis.com",
            handler: "StaleWhileRevalidate",
            options: { cacheName: "owners-font-css" },
          },
          {
            urlPattern: ({ url }) => url.origin === "https://fonts.gstatic.com",
            handler: "CacheFirst",
            options: { cacheName: "owners-font-files", expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } },
          },
          // API（ログイン・所持金・レース結果など）は必ずネットワークへ。キャッシュしない
          { urlPattern: ({ url }) => url.pathname.includes("/api/"), handler: "NetworkOnly" },
        ],
      },
    }),
  ],
  build: {
    // 3D表示のライブラリを分けて、更新時に変わらない部分を再取得しないようにする
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three", "@react-three/fiber"],
          react: ["react", "react-dom"],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:2567",
    },
  },
});
