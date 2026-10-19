// 毛色（見た目だけ）。馬IDから決まり、セーブには保存しない。ゲームの計算には使わない。
export type CoatId = "bay" | "darkbay" | "chestnut" | "grey" | "black";
export const COAT_LABELS: Record<CoatId, string> = { bay: "鹿毛", darkbay: "黒鹿毛", chestnut: "栗毛", grey: "芦毛", black: "青鹿毛" };

export interface CoatColors {
  body: string;
  shade: string;
  mane: string;
  /** 脚の先（鹿毛系は黒い） */
  socks: string | null;
  hoof: string;
}
export const COATS: Record<CoatId, CoatColors> = {
  bay: { body: "#8b5531", shade: "#6c3f23", mane: "#1d1612", socks: "#241a14", hoof: "#2a2420" },
  darkbay: { body: "#55331f", shade: "#3f2416", mane: "#140e0b", socks: "#1a120e", hoof: "#1f1a17" },
  chestnut: { body: "#b4652e", shade: "#8f4c20", mane: "#c98a4e", socks: null, hoof: "#4a3a2c" },
  grey: { body: "#c4c0b8", shade: "#9d9890", mane: "#7c7770", socks: "#8d877f", hoof: "#4a4642" },
  black: { body: "#2e2622", shade: "#1f1916", mane: "#0f0c0a", socks: null, hoof: "#141110" },
};
const COAT_ORDER: CoatId[] = ["bay", "bay", "bay", "darkbay", "darkbay", "chestnut", "chestnut", "grey", "black"];

/** 馬ごとに決まった毛色（馬IDから決める。セーブには保存しない見た目だけの情報） */
export function coatOf(horseId: string): CoatId {
  let h = 2166136261;
  for (let i = 0; i < horseId.length; i++) h = Math.imul(h ^ horseId.charCodeAt(i), 16777619);
  return COAT_ORDER[(h >>> 0) % COAT_ORDER.length];
}

