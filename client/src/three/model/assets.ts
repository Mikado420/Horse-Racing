// 3Dモデルの形データの読み込み。最初の1回だけ作り（Web Worker があれば裏で）、以後は使い回す。
import { buildAssetData, type AssetData } from "./assetData";

let data: AssetData | null = null;
let pending: Promise<AssetData> | null = null;

/** 形データを用意する（すでにあればすぐ返る）。レース観戦の前に呼んでおく */
export function loadAssets(): Promise<AssetData> {
  if (data) return Promise.resolve(data);
  if (pending) return pending;
  pending = new Promise<AssetData>((resolve) => {
    const sync = () => {
      data ??= buildAssetData();
      resolve(data);
    };
    if (typeof Worker === "undefined") return sync();
    let w: Worker;
    try {
      w = new Worker(new URL("./assets.worker.ts", import.meta.url), { type: "module" });
    } catch {
      return sync();
    }
    const timer = setTimeout(() => {
      // 万一 Worker が応答しなければ、こちらで作る
      w.terminate();
      sync();
    }, 20000);
    w.onmessage = (e: MessageEvent<AssetData>) => {
      clearTimeout(timer);
      data ??= e.data;
      w.terminate();
      resolve(data);
    };
    w.onerror = () => {
      clearTimeout(timer);
      w.terminate();
      sync();
    };
    w.postMessage("build");
  });
  return pending;
}

/** 用意済みの形データ。まだなら、その場で作る（画面が少し止まる） */
export function assetData(): AssetData {
  data ??= buildAssetData();
  return data;
}

export function assetsReady(): boolean {
  return data !== null;
}

/** 観戦の前に裏で用意を始める */
export function preloadRaceAssets(): void {
  void loadAssets();
}
