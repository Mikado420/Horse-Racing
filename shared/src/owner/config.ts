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
    /** 最高速度 = (topBase + topPerSpeed × スピード) × 各種補正（m/秒） */
    topBase: number;
    topPerSpeed: number;
    /** 状態の補正：調子1段階あたり・疲労1あたり・仕上がり（0〜100）の重み */
    conditionPerLevel: number;
    fatiguePerPoint: number;
    fitnessWeight: number;
    /** 芝・ダート適性が最も低いときの速度の低下率 */
    surfaceFit: number;
    /** その日の出来（レースごとの体調のゆらぎ）の標準偏差 */
    formSd: number;
    /** エネルギーが尽きたときに保てる速度（最高速度に対する割合） */
    emptyFloor: number;
    /** エネルギーの残りがこの割合を切ると、そこから徐々に速度が落ち始める（0 なら尽きた瞬間に落ちる） */
    fadeReserve: number;
    /** 馬群について行く：前の馬がこの距離（m）以内にいれば、その馬の速度に合わせようとする */
    followRange: number;
    /** ついて行くときに出してよい速度の上限（最高速度に対する割合。0 ならついて行かない） */
    followMaxFraction: number;
    /** 配分：残りのエネルギーで最後まで持つ速度にこの係数をかけた速度を、道中の上限にする（0 なら配分しない） */
    staminaPacing: number;
    /** 有酸素で賄える消費（1秒あたり）。これを超えた分だけエネルギーが減る（0 なら速度の2乗にそのまま比例） */
    aerobicRate: number;
    /** エネルギー量（無酸素で使える余力）の倍率 */
    energyScale: number;
    /** 競り合いの効果を、並んでいる度合いに応じて弱める度合い（0 なら1.6m以内で一律に効く） */
    duelTaper: number;
    /** 馬ごとの速度差（能力・芝ダート/回り/小回り/脚質の適性・状態・その日の出来）を縮める倍率（1 ならそのまま） */
    differenceScale: number;
    /** ついて行くときに、残りのエネルギーで走り切れる速度の何倍まで無理をするか（配分が有効なときだけ） */
    followOverPace: number;
    /** 道中のペースを 1600m を基準に 1000m あたり何割ゆるめるか（短い距離では逆に速める。0 なら距離によらない） */
    cruisePerKm: number;
    /** スタートのばらつき（出遅れ）の大きさの倍率 */
    startDelayScale: number;
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
    topBase: 16.6,
    topPerSpeed: 0.034,
    conditionPerLevel: 0.012,
    fatiguePerPoint: 0.0008,
    fitnessWeight: 0.05,
    surfaceFit: 0.06,
    formSd: 0.009,
    emptyFloor: 0.89,
    fadeReserve: 0.1,
    followRange: 20,
    followMaxFraction: 0.97,
    staminaPacing: 1,
    aerobicRate: 7.9,
    energyScale: 0.565,
    duelTaper: 1,
    differenceScale: 0.5,
    followOverPace: 1.02,
    cruisePerKm: 0.05,
    startDelayScale: 0.5,
  },
};

/**
 * 着差の調整（docs/margins）より前、v2.0 のレース計算と同じ動きになる race 設定の差分。
 * withConfig({ race: LEGACY_RACE_V20 }) で、同じシードから変更前の結果をそのまま再現できる（比較・検証用）
 */
export const LEGACY_RACE_V20: Partial<GameConfig["race"]> = {
  fadeReserve: 0,
  followRange: 0,
  followMaxFraction: 0,
  staminaPacing: 0,
  aerobicRate: 0,
  energyScale: 1,
  duelTaper: 0,
  differenceScale: 1,
  cruisePerKm: 0,
  startDelayScale: 1,
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
