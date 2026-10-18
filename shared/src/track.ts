// コース形状と再生用の補助関数（描画専用。着順の判定には使わない）。
//
// 楕円形（直線2本＋半円2つ）の周回コース。距離 s=0 がゴール板。
// s が増える方向に 3〜4コーナー型の半円 → 向こう正面 → 半円 → ホームストレッチの順に進み、
// 一周するとゴール板に戻る。座標は x-z 平面（y は上方向）、単位はメートル。

import type { CourseDef } from "./types";

export interface TrackPoint {
  x: number;
  z: number;
  /** 進行方向の角度（ラジアン、x軸正方向から z軸正方向へ） */
  heading: number;
}

export function turnRadius(course: CourseDef): number {
  return (course.lapLength - 2 * course.straightLength) / (2 * Math.PI);
}

/** 内ラチ沿いの距離 s と、外側へのずれ lateral(m) からワールド座標を求める */
export function trackPoint(course: CourseDef, s: number, lateral = 0): TrackPoint {
  const S = course.straightLength;
  const R = turnRadius(course);
  const L = course.lapLength;
  const turnLen = Math.PI * R;
  let u = ((s % L) + L) % L;

  if (u < turnLen) {
    // 右側の半円：中心 (S/2, 0)、角度 +π/2 から -π/2 へ
    const phi = Math.PI / 2 - u / R;
    const r = R + lateral;
    return { x: S / 2 + r * Math.cos(phi), z: r * Math.sin(phi), heading: phi - Math.PI / 2 };
  }
  u -= turnLen;
  if (u < S) {
    // 向こう正面：z = -R、x は +S/2 → -S/2
    return { x: S / 2 - u, z: -(R + lateral), heading: Math.PI };
  }
  u -= S;
  if (u < turnLen) {
    // 左側の半円：中心 (-S/2, 0)、角度 -π/2 から -3π/2 へ
    const phi = -Math.PI / 2 - u / R;
    const r = R + lateral;
    return { x: -S / 2 + r * Math.cos(phi), z: r * Math.sin(phi), heading: phi - Math.PI / 2 };
  }
  u -= turnLen;
  // ホームストレッチ：z = +R、x は -S/2 → +S/2（終点がゴール板）
  return { x: -S / 2 + u, z: R + lateral, heading: 0 };
}

/** 再生時刻 t(秒) における各馬の走行距離を、フレーム間の線形補間で求める */
export function distancesAt(frames: number[][], sampleDt: number, t: number): number[] {
  if (frames.length === 0) return [];
  if (t <= 0) return frames[0].slice();
  const k = t / sampleDt;
  const i = Math.floor(k);
  if (i >= frames.length - 1) return frames[frames.length - 1].slice();
  const f = k - i;
  const a = frames[i];
  const b = frames[i + 1];
  return a.map((v, j) => v + (b[j] - v) * f);
}

/**
 * レース中の順位。ゴール済みの馬は確定着順を優先し、
 * 未ゴールの馬は走行距離の大きい順に並べる。戻り値は runners 配列のインデックス。
 */
export function liveOrder(distances: number[], raceDistance: number, finishOrder: number[]): number[] {
  const finished = finishOrder.filter((i) => distances[i] >= raceDistance);
  const running = distances
    .map((d, i) => ({ d, i }))
    .filter(({ i }) => !finished.includes(i))
    .sort((a, b) => b.d - a.d)
    .map(({ i }) => i);
  return [...finished, ...running];
}
