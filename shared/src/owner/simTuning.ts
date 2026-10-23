// レース計算（sim.ts）の調整用パラメータ。数値はすべてここに集め、テストや調整では
// withConfig({ race: { tuning: { ...DEFAULT_SIM_TUNING, ... } } }) で差し替えられる。
import type { RunningStyle } from "../types";
import type { PacePlan, SpurtPlan } from "./sim";

export interface SimTuning {
  /* ---------- 位置取り（第1段階） ---------- */
  /** 脚質ごとの序盤・中盤の目標位置（順位割合。0=先頭、1=最後方） */
  styleBands: Record<RunningStyle, [number, number]>;
  /** 終盤に目標位置を前へ移す割合（1 なら先頭まで） */
  lateBandShift: number;
  /** 仕掛け地点の何m手前から目標位置を前へ移し始めるか */
  lateShiftLead: number;
  /** 順位を連続値にするときの距離のなめらかさ（m） */
  softRankMeters: number;
  /** 少頭数で目標帯に入れる順位がなくならないよう、1順位ぶんの何割だけ帯を広げるか */
  bandWidenSteps: number;
  /** 位置のずれ（順位割合）を速度補正に変える尺度。小さいほど敏感 */
  posErrorScale: number;
  /** 位置取りによる速度補正の上限（最高速度に対する割合）。前へ／後ろへ、序盤／中盤 */
  posGain: { early: { up: number; down: number }; mid: { up: number; down: number } };
  /** 帯の中でも中央へ寄せる弱い補正（posGain に対する割合） */
  posCenterPull: number;
  /** 脚質適性が低いときの位置取りのぶれ（順位割合） */
  styleWobble: number;
  /** 脚質適性が位置取り補正の効きに与える幅（適性0で 1-この値 倍） */
  styleStability: number;
  /** 脚質適性が低いときの余計な消耗（適性0で 1+この値 倍） */
  styleWaste: number;
  /** 脚質適性が低いと行きたがりやすくなる幅 */
  styleKeen: number;

  /* ---------- 巡航速度 ---------- */
  /** 単独で走るときの巡航（最高速度に対する割合） */
  cruise: { early: number; mid: number };
  /** 序盤の巡航の脚質による違い（出走馬全体の速さに対する割合） */
  styleEarlyAdj: Record<RunningStyle, number>;
  /** 巡航のリズムに自分の最高速度をどれだけ反映するか（0=全馬共通の基準、1=自分の最高速度） */
  ownRhythm: number;
  /** ペース作戦による巡航の補正 */
  pacePlanAdj: Record<PacePlan, number>;
  /** 仕掛け前の目標速度の上限・下限（最高速度に対する割合） */
  cruiseMax: { early: number; mid: number };
  cruiseMin: number;
  /** 先頭から何m以内なら自分のリズム、それより後ろは流れ（ペース）に合わせる */
  leadBlendMeters: number;
  /** スタート直後は自分のリズムで出していき、この区間で流れに合わせ始める（m） */
  flowRamp: [number, number];
  /** 流れ（先頭の速度）を平滑化する時定数（秒） */
  paceTau: number;

  /* ---------- ペースと先頭争い（第2段階） ---------- */
  /** 脚質ごとの「先頭に立ちたい度合い」（ペース予測用） */
  leadDesire: Record<RunningStyle, number>;
  /** ペース作戦が先頭を取りに行く度合いに掛かる倍率 */
  pacePlanDesire: Record<PacePlan, number>;
  /** 最初のコーナーまでの距離（m）：この値以下なら「近い」、以上なら「遠い」 */
  cornerNear: number;
  cornerFar: number;
  /** 最初のコーナーが近いとき、大外枠が先手を取りにくくなる割合 */
  gateLeadPenalty: number;
  /** 予測ペース指数 = base + perContender × 先頭を争いそうな馬の数 */
  pacePredict: { base: number; perContender: number };
  /** 予測ペースが序盤の巡航に与える影響（逃げ馬／それ以外） */
  predictedLeadAdj: number;
  predictedFieldAdj: number;
  /** ペース指数の観測：先頭の速度が中盤の巡航からこの割合ずれると ±1 */
  paceObsScale: number;
  /** 序盤のペース指数の基準（先頭の速度が出走馬全体の速さのこの割合なら平均ペース） */
  paceRefEarly: number;
  /** 中盤のペース指数の基準 */
  paceRefMid: number;
  /** ペース指数の平滑化の時定数（秒） */
  paceIndexTau: number;
  /** 先頭争いの激しさがペース指数に加わる量 */
  battlePace: number;
  /** 先頭争いとみなす範囲：先頭からの差（m）と、スタートからの距離（m） */
  battleRange: number;
  battleFrom: number;
  /** 先頭争いの激しさの時定数（秒） */
  battleTau: number;
  /** 先頭争い中の速度の上乗せ（出走馬全体の速さに対する割合）と、消耗の増加 */
  battleBoost: number;
  battleCost: number;
  /** 先頭争いから控える判断の起こりやすさ（1秒あたり）と、ペース作戦による倍率 */
  concedeRate: number;
  concedePlan: Record<PacePlan, number>;
  /** 控えた逃げ馬の目標位置 */
  concededBand: [number, number];
  /** 単騎逃げでペースを落とす量（巡航の割合）と、後ろとの差の目安（m） */
  soloRelax: number;
  soloGap: number;
  /** 逃げたくない馬が先頭に立ったときに落とす量（巡航の割合） */
  reluctantLeadSlow: number;
  /** ハイペースで、先頭から離れた馬が流れを追わなくなる度合いと、その距離（m） */
  paceDetach: number;
  detachFrom: [number, number];
  /** ハイペースでは位置を上げる補正を弱め、スローでは強める */
  paceChaseDamp: number;
  paceSlowPush: number;
  /** スローペースで後ろの馬の目標位置を前へ移す割合 */
  slowBandShift: number;
  /** ペースの表示：平均の指数がこの値以上でハイ、マイナスこの値以下でスロー */
  paceLabelAt: number;

  /* ---------- スタミナと仕掛け（第3段階） ---------- */
  /* 失速が始まる余力の割合（fadeReserve）と尽きたときに保てる速度（emptyFloor）は cfg.race にある */
  /** 余力が尽きたときの速度への、根性・勝負根性による上乗せ */
  fadeGrit: number;
  gutsyGrit: number;
  /** 余力が減るにつれて速度が落ちる曲線（1 で直線、小さいほど終わり際に急） と根性による粘り */
  fadeCurve: number;
  fadeResist: number;
  /** 保てる速度が最高速度のこの割合を下回ったら「失速が始まった」と記録する */
  fadeMark: number;
  /** 失速するときの減速の速さ（m/秒²） */
  fadeDecel: number;
  /** 前の馬の後ろで楽に走れる量（消耗の削減率）、効く距離（m：この間で弱まる）、横の幅（m） */
  draftSave: number;
  draftRange: [number, number];
  draftLane: number;
  /** 加速 1 m/秒 あたりの消耗と、横へ 1m 動くときの消耗 */
  accelCost: number;
  lateralCost: number;
  /** コーナー・坂での消耗の増加（パワーで軽くなる） */
  cornerCost: number;
  slopeCost: number;
  /** 仕掛けの目安への加算：脚質（m）、距離 1m あたり（上限あり）、加速力 1 あたり */
  spurtStyleAdj: Record<RunningStyle, number>;
  spurtPerMeter: number;
  spurtDistCap: number;
  spurtPerAccel: number;
  /** 仕掛け位置のずれ（m）と、残りの脚の見積もりのずれ（割合）。賢さが高いほど小さい */
  spurtExecSd: number;
  spurtJudgeSd: number;
  /** 目標位置より後ろにいるとき、順位割合 1 あたり何m早く動くか */
  spurtLagMeters: number;
  /** 手応えに余裕があるとき、目安より何m早く動けるか、その余裕の基準（必要量の倍率） */
  spurtSurplusLead: number;
  spurtSurplus: number;
  /** 仕掛けに必要とみなす余力の割合（作戦ごと。早めの作戦ほど足りなくても動く）、温存しておく余力（cfg.race.fadeReserve に対する割合）、必ず仕掛ける地点（m） */
  spurtNeed: Record<SpurtPlan, number>;
  spurtKeep: number;
  spurtForce: number;

  /** 全力疾走の消耗の増加（最高速度で 1+この値 倍）と、増え始める速さ（最高速度に対する割合） */
  anaerobic: number;
  anaerobicFrom: number;
  /** 仕掛けの判断で見込む全力疾走の消耗の割合（1 で最高速度のまま走り切る想定） */
  anaerobicNeed: number;
  /** スタミナが有酸素で賄える量にも効く度合い（スタミナ 60 を基準に、100 あたりの増減。持久戦ほど差になる） */
  aerobicStamina: number;
  /** 溜めた脚：残り距離に必要な分より余力が多いほど最高速度を上乗せできる量と、上乗せが最大になる余裕（必要量に対する超過の割合） */
  saveKick: number;
  saveKickRange: number;

  /* ---------- コース・馬群・進路（第4段階） ---------- */
  /** コーナーでの減速：半径 R(m) に対して K/R の割合。パワー・回りの適性で軽くなる割合 */
  cornerSpeedK: number;
  /** コーナーの入口・出口で、外を回る距離のロスが 0 から最大まで変わるのにかける距離（m） */
  cornerEase: number;
  cornerPower: number;
  cornerAptitude: number;
  /** 小回りコースで、小回り適性が低いときに減速が増える割合 */
  tightCornerPenalty: number;
  /** 前の馬より何 m/秒 以上速く走りたいのに抜けないとき「前が詰まった」とするか */
  blockedMargin: number;
  /** 前の遅い馬に気づく距離の、賢さ100での上乗せ（m） */
  lookAhead: number;
  /** 仕掛けの何m手前から進路を確保しに動くか、その判断の起こりやすさ（賢さ100で1秒あたり） */
  preSpurtLead: number;
  preSpurtMove: number;
  /** 進路が開いているとみなす前後の余裕（m）と、賢さ100で縮む量 */
  gapRoom: number;
  gapRoomWise: number;
  /** コーナーで外へ持ち出さずに待つ判断（賢さ100での確率） */
  waitInCorner: number;

  /* ---------- その日の出来 ---------- */
  /** 出来のぶれ（標準偏差は cfg.race.formSd）のスタミナへの効き（最高速度へのぶれの倍率） */
  formEnergy: number;

  /* ---------- エネルギー ---------- */
  /** この速度で1mあたり1を消費する（m/秒） */
  costRef: number;
  /** 最高速度が高い馬ほど同じ速度を楽に走れる度合い（基準の最高速度との比のべき） */
  costEconomy: number;
  /** 序盤の区間（m）。D*earlyFraction と比べて短い方 */
  earlyMeters: number;
  earlyFraction: number;
}

export const DEFAULT_SIM_TUNING: SimTuning = {
  styleBands: { front: [0, 0.15], stalker: [0.1, 0.35], closer: [0.35, 0.7], deep: [0.65, 0.95] },
  lateBandShift: 0.6,
  lateShiftLead: 450,
  softRankMeters: 0.9,
  bandWidenSteps: 0.35,
  posErrorScale: 0.12,
  posGain: { early: { up: 0.035, down: 0.05 }, mid: { up: 0.018, down: 0.03 } },
  posCenterPull: 0.2,
  styleWobble: 0.08,
  styleStability: 0.35,
  styleWaste: 0.04,
  styleKeen: 0.6,

  cruise: { early: 0.95, mid: 0.915 },
  styleEarlyAdj: { front: 0.03, stalker: 0.008, closer: -0.012, deep: -0.028 },
  ownRhythm: 0.4,
  pacePlanAdj: { easy: -0.012, normal: 0, aggressive: 0.012 },
  cruiseMax: { early: 0.985, mid: 0.955 },
  cruiseMin: 0.86,
  leadBlendMeters: 4,
  flowRamp: [60, 260],
  paceTau: 2,

  leadDesire: { front: 1, stalker: 0.12, closer: 0, deep: 0 },
  pacePlanDesire: { easy: 0.7, normal: 1, aggressive: 1.25 },
  cornerNear: 100,
  cornerFar: 350,
  gateLeadPenalty: 0.4,
  pacePredict: { base: -0.75, perContender: 0.6 },
  predictedLeadAdj: 0.01,
  predictedFieldAdj: 0.004,
  paceObsScale: 0.025,
  paceRefEarly: 0.99,
  paceRefMid: 0.934,
  paceIndexTau: 6,
  battlePace: 0.6,
  battleRange: 3.6,
  battleFrom: 40,
  battleTau: 2,
  battleBoost: 0.02,
  battleCost: 0.12,
  concedeRate: 0.04,
  concedePlan: { easy: 1.6, normal: 1, aggressive: 0.4 },
  concededBand: [0.06, 0.3],
  soloRelax: 0.012,
  soloGap: 3.5,
  reluctantLeadSlow: 0.02,
  paceDetach: 0.6,
  detachFrom: [8, 30],
  paceChaseDamp: 0.5,
  paceSlowPush: 0.5,
  slowBandShift: 0.15,
  paceLabelAt: 0.3,

  fadeGrit: 0.05,
  gutsyGrit: 0.012,
  fadeCurve: 0.7,
  fadeResist: 0.4,
  fadeMark: 0.97,
  fadeDecel: 0.5,
  draftSave: 0.07,
  draftRange: [3, 7],
  draftLane: 1.1,
  accelCost: 5,
  lateralCost: 2,
  cornerCost: 0.03,
  slopeCost: 0.25,
  spurtStyleAdj: { front: -20, stalker: 0, closer: 30, deep: 50 },
  spurtPerMeter: 0.04,
  spurtDistCap: 60,
  spurtPerAccel: 1.5,
  spurtExecSd: 40,
  spurtJudgeSd: 0.12,
  spurtLagMeters: 250,
  spurtSurplusLead: 120,
  spurtSurplus: 1.3,
  spurtNeed: { early: 0.75, normal: 0.92, late: 1 },
  spurtKeep: 0.5,
  spurtForce: 260,

  anaerobic: 0.75,
  anaerobicFrom: 0.93,
  anaerobicNeed: 0.7,
  aerobicStamina: 0.9,
  saveKick: 0.035,
  saveKickRange: 0.8,

  cornerSpeedK: 2.0,
  cornerEase: 20,
  cornerPower: 0.4,
  cornerAptitude: 0.3,
  tightCornerPenalty: 0.6,
  blockedMargin: 0.5,
  lookAhead: 4,
  waitInCorner: 0.5,
  gapRoom: 4,
  gapRoomWise: 2,
  preSpurtLead: 250,
  preSpurtMove: 0.5,

  formEnergy: 1.5,

  costRef: 17.5,
  costEconomy: 1.0,
  earlyMeters: 600,
  earlyFraction: 0.3,
};
