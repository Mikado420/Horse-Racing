// 馬と騎手の形を裏で作る（画面を止めないため）
import { buildAssetData, transferablesOf } from "./assetData";

const post = (self as unknown as { postMessage: (d: unknown, t: Transferable[]) => void }).postMessage.bind(self);
self.onmessage = () => {
  const data = buildAssetData();
  post(data, transferablesOf(data));
};
