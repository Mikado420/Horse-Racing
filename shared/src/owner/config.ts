// 馬主モード（指示書 v1.4）のバランス設定ファイル。
// 情報解明の開示条件・評価ランクの境界・距離適性の補正・観測の精度などはすべてここで調整する。
// ゲームロジックは引数で設定を受け取れるので、テストや将来のサーバーから別の設定を渡せる。

export interface RankBand {
  rank: "S" | "A" | "B" | "C" | "D" | "E";
  min: number;
}

export interface EvidenceSourceConfig {
  /** 1回の観測のばらつき（能力値の標準偏差） */
  noise: number;
  /** 情報源ごとの思い込み・偏りの大きさ（同じ情報源で何度見ても消えない誤差） */
  biasSd: number;
}

export interface GameConfig {
  /** 評価ランクの境界（上から順に判定） */
  rankBands: RankBand[];
  disclosure: {
    /** 何も知らない状態の推定（母集団の平均とばらつき） */
    priorMean: number;
    priorSd: number;
    /** この不確実性以下になったら評価ランクを開示 */
    rankSd: number;
    /** この不確実性以下になったら数値を開示 */
    numericSd: number;
    /** 数値開示に必要な「計測を伴う証拠」（調教時計・実戦）の最少件数 */
    numericMinMeasured: number;
    /** 数値開示に必要な実戦の数（調教師のレース評・馬主の分析を、レース単位で数える） */
    numericMinRace: number;
    /** 古い観測の信頼度を下げる量（1週あたりの標準偏差の増加） */
    staleSdPerWeek: number;
    /** 評価ランクが変わったときに「評価修正」として記録する */
    logRankChanges: boolean;
  };
  /** 個性：何回兆候が見えたら「兆候あり」「判明」とするか */
  traitHintAt: number;
  traitConfirmAt: number;
  /** 情報源ごとの観測精度。調教師の評価能力でさらに補正される */
  sources: Record<
    "farmObservation" | "trainerObservation" | "workout" | "raceTrainer" | "raceAnalysis" | "saleInspection",
    EvidenceSourceConfig
  >;
  /** 適性範囲からの距離差（100m単位）→ 補正。最後の値はそれ以上すべてに使う */
  distanceFactors: number[];
  /** 距離適性の補正をどう配分するか（二重減衰を防ぐため分離） */
  distanceEffect: {
    /** 適性より短い：速度と加速に効く */
    shortSpeed: number;
    shortAccel: number;
    /** 適性より長い：主にスタミナ消費に効く */
    longStamina: number;
    longSpeed: number;
  };
  /** レース計算 */
  race: {
    hz: number;
    sampleDt: number;
  };
}

export const DEFAULT_CONFIG: GameConfig = {
  rankBands: [
    { rank: "S", min: 90 },
    { rank: "A", min: 80 },
    { rank: "B", min: 65 },
    { rank: "C", min: 45 },
    { rank: "D", min: 25 },
    { rank: "E", min: 0 },
  ],
  disclosure: {
    priorMean: 50,
    priorSd: 20,
    rankSd: 8.5,
    numericSd: 3.6,
    numericMinMeasured: 3,
    numericMinRace: 2,
    staleSdPerWeek: 0.35,
    logRankChanges: true,
  },
  traitHintAt: 1,
  traitConfirmAt: 3,
  sources: {
    // 0〜1歳の牧場での観察：体つきや身のこなしから推し量るだけなので粗い
    farmObservation: { noise: 18, biasSd: 13 },
    // 2歳以降の日常観察（調教師の目）
    trainerObservation: { noise: 12, biasSd: 8 },
    // 調教時計など計測を伴う調教
    workout: { noise: 7, biasSd: 4.5 },
    // 調教師によるレース後の見立て
    raceTrainer: { noise: 6, biasSd: 5 },
    // 馬主自身によるレース映像・ラップの分析（偏りが小さい）
    raceAnalysis: { noise: 5, biasSd: 1.5 },
    // 購入前の下見（販売資料）
    saleInspection: { noise: 20, biasSd: 14 },
  },
  distanceFactors: [1.0, 0.9, 0.8, 0.7, 0.6, 0.5],
  distanceEffect: {
    shortSpeed: 0.06,
    shortAccel: 0.25,
    longStamina: 0.5,
    longSpeed: 0.012,
  },
  race: {
    hz: 10,
    sampleDt: 0.25,
  },
};

/** 一部だけ差し替えた設定を作る（テストや調整用） */
export function withConfig(patch: {
  [K in keyof GameConfig]?: GameConfig[K] extends unknown[] ? GameConfig[K] : Partial<GameConfig[K]>;
}): GameConfig {
  const out = { ...DEFAULT_CONFIG } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    const base = (DEFAULT_CONFIG as unknown as Record<string, unknown>)[k];
    out[k] = Array.isArray(v) || typeof v !== "object" || v === null ? v : { ...(base as object), ...(v as object) };
  }
  return out as unknown as GameConfig;
}
