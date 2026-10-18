// ゲーム全体で共有する型定義（クライアント・サーバー共通）

export const STAT_KEYS = ["speed", "stamina", "power", "guts", "wisdom"] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

export const STAT_LABELS: Record<StatKey, string> = {
  speed: "スピード",
  stamina: "スタミナ",
  power: "パワー",
  guts: "根性",
  wisdom: "賢さ",
};

/** 脚質 */
export type RunningStyle = "front" | "stalker" | "closer" | "deep";
export const STYLE_LABELS: Record<RunningStyle, string> = {
  front: "逃げ",
  stalker: "先行",
  closer: "差し",
  deep: "追込",
};

/** 適性ランク */
export type Grade = "A" | "B" | "C" | "D";
export interface Aptitude {
  turf: Grade;
  dirt: Grade;
  sprint: Grade; // 〜1400m
  mile: Grade; // 1401〜1800m
  middle: Grade; // 1801〜2400m
  long: Grade; // 2401m〜
}

export type Surface = "turf" | "dirt";
export type DistanceBand = "sprint" | "mile" | "middle" | "long";
export type Going = "good" | "yielding" | "soft" | "heavy";
export type Weather = "sunny" | "cloudy" | "rain";

export const GOING_LABELS: Record<Going, string> = {
  good: "良",
  yielding: "稍重",
  soft: "重",
  heavy: "不良",
};
export const WEATHER_LABELS: Record<Weather, string> = {
  sunny: "晴",
  cloudy: "曇",
  rain: "雨",
};

/** 調子 -2(絶不調) 〜 +2(絶好調) */
export const CONDITION_LABELS: Record<string, string> = {
  "-2": "絶不調",
  "-1": "不調",
  "0": "普通",
  "1": "好調",
  "2": "絶好調",
};

export interface Horse {
  id: string;
  ownerId: string;
  name: string;
  stats: Stats;
  /** 各能力の成長上限 */
  potential: Stats;
  style: RunningStyle;
  aptitude: Aptitude;
  fatigue: number; // 0-100
  condition: number; // -2..2
  /** 故障中なら残り休養回数（0なら健康） */
  injuryRestsLeft: number;
  races: number;
  wins: number;
  totalPrize: number;
  retired: boolean;
}

export interface PlayerProfile {
  id: string;
  username: string;
  money: number;
  totalPrize: number;
  races: number;
  wins: number;
}

export type TrainingMenu = StatKey;

export interface CourseDef {
  id: string;
  name: string;
  surface: Surface;
  distance: number; // m
  lapLength: number; // m
  straightLength: number; // m
  trackWidth: number; // m
}
