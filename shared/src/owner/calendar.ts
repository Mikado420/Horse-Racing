// ゲーム内の暦。1年 = 12か月 × 4週 = 48週。全馬は1月第1週に一斉に年を取る。
import type { AgeStage, RaceHorse } from "./model";

export const WEEKS_PER_YEAR = 48;
/** 2歳の何月からデビューできるか */
export const DEBUT_MONTH = 6;
/** 何歳の年末で競走生活を終えるか */
export const RETIRE_AGE = 7;

export function yearOf(week: number): number {
  return Math.floor(week / WEEKS_PER_YEAR) + 1;
}
export function monthOf(week: number): number {
  return Math.floor((week % WEEKS_PER_YEAR) / 4) + 1;
}
export function weekInMonth(week: number): number {
  return (week % 4) + 1;
}
export function weekLabel(week: number): string {
  return `${yearOf(week)}年目 ${monthOf(week)}月 第${weekInMonth(week)}週`;
}
export function shortWeekLabel(week: number): string {
  return `${yearOf(week)}年目${monthOf(week)}月${weekInMonth(week)}週`;
}

export function ageAt(h: Pick<RaceHorse, "birthYear">, week: number): number {
  return yearOf(week) - h.birthYear;
}
export function ageStage(h: Pick<RaceHorse, "birthYear">, week: number): AgeStage {
  return Math.max(0, Math.min(3, ageAt(h, week))) as AgeStage;
}
/** 誕生からの経過週（成長曲線に使う） */
export function weeksSinceBirth(h: Pick<RaceHorse, "birthYear">, week: number): number {
  return week - (h.birthYear - 1) * WEEKS_PER_YEAR;
}

/** レースに出られる年齢か（2歳の6月から） */
export function raceEligibleAge(h: Pick<RaceHorse, "birthYear">, week: number): string | null {
  const age = ageAt(h, week);
  if (age < 2) return `${age}歳のためまだレースには出られません（2歳の${DEBUT_MONTH}月から）`;
  if (age === 2 && monthOf(week) < DEBUT_MONTH) return `2歳馬のデビューは${DEBUT_MONTH}月からです`;
  if (age > RETIRE_AGE) return "競走馬としての年齢を過ぎています";
  return null;
}

export const AGE_STAGE_LABELS: Record<AgeStage, string> = {
  0: "誕生・初期観察",
  1: "成長と素質の観察",
  2: "調教による能力調査",
  3: "実戦による能力評価",
};
