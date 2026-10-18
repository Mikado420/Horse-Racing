// 馬主モードの競馬場とコース（すべて架空）。
// 形は既存の楕円コース（track.ts）と同じで、周長・直線の長さ・回り・坂・小回りの有無を持つ。
import type { CourseDef, Surface } from "../types";

export interface OwnerCourse extends CourseDef {
  trackId: string;
  trackName: string;
  direction: "right" | "left";
  /** ゴール前に上り坂があるか */
  slope: boolean;
  /** 小回り（コーナーがきつい）か */
  tight: boolean;
}

interface TrackDef {
  id: string;
  name: string;
  direction: "right" | "left";
  slope: boolean;
  tight: boolean;
  layouts: Record<Surface, { lapLength: number; straightLength: number; distances: number[] }>;
}

export const TRACKS: readonly TrackDef[] = [
  {
    id: "midorigaoka",
    name: "翠ヶ丘",
    direction: "right",
    slope: true,
    tight: false,
    layouts: {
      turf: { lapLength: 1800, straightLength: 380, distances: [1200, 1400, 1600, 1800, 2000, 2400, 3000] },
      dirt: { lapLength: 1600, straightLength: 340, distances: [1200, 1400, 1800, 2100] },
    },
  },
  {
    id: "shiomi",
    name: "汐見",
    direction: "left",
    slope: false,
    tight: true,
    layouts: {
      turf: { lapLength: 1400, straightLength: 260, distances: [1000, 1200, 1500, 1800, 2000, 2600] },
      dirt: { lapLength: 1200, straightLength: 240, distances: [1000, 1300, 1700, 2000] },
    },
  },
];

export const SURFACE_LABELS: Record<Surface, string> = { turf: "芝", dirt: "ダート" };

export function makeCourse(trackId: string, surface: Surface, distance: number): OwnerCourse {
  const t = TRACKS.find((x) => x.id === trackId);
  if (!t) throw new Error(`競馬場が見つかりません: ${trackId}`);
  const l = t.layouts[surface];
  return {
    id: `${t.id}-${surface}-${distance}`,
    name: `${t.name}競馬場`,
    trackId: t.id,
    trackName: t.name,
    surface,
    distance,
    lapLength: l.lapLength,
    straightLength: l.straightLength,
    trackWidth: surface === "turf" ? 18 : 15,
    direction: t.direction,
    slope: t.slope,
    tight: t.tight,
  };
}

export function allCourses(): OwnerCourse[] {
  return TRACKS.flatMap((t) =>
    (["turf", "dirt"] as const).flatMap((s) => t.layouts[s].distances.map((d) => makeCourse(t.id, s, d))),
  );
}

export function courseLabel(c: OwnerCourse): string {
  return `${c.trackName} ${SURFACE_LABELS[c.surface]}${c.distance}m`;
}

/** コーナーの半径 */
export function cornerRadius(c: CourseDef): number {
  return (c.lapLength - 2 * c.straightLength) / (2 * Math.PI);
}

/**
 * スタートからの走行距離 d を、ゴール板を0とする内ラチ上の位置に直す。
 * ゴールは d = distance のときに位置0（=周長の整数倍）に来る。
 */
export function railPosition(c: CourseDef, d: number): number {
  const L = c.lapLength;
  return (((d - c.distance) % L) + L) % L;
}

/** その地点がコーナーか */
export function isCorner(c: CourseDef, d: number): boolean {
  const s = railPosition(c, d);
  const R = cornerRadius(c);
  const turn = Math.PI * R;
  const S = c.straightLength;
  return s < turn || (s >= turn + S && s < 2 * turn + S);
}

/** 最後の直線の長さ（ゴール手前で直線が始まる地点までの距離） */
export function finalStraight(c: CourseDef): number {
  return c.straightLength;
}

/** ゴール前の上り坂の区間（ゴールまでの残り距離で表す） */
export const SLOPE_REMAIN: [number, number] = [320, 120];
