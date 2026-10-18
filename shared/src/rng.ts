// シード付き疑似乱数（mulberry32）。同じシードからは常に同じ数列を返す。

export type Rng = () => number;

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 近似正規乱数（一様乱数12個の和）。三角関数を使わず環境差を避ける。 */
export function gaussian(rng: Rng): number {
  let s = 0;
  for (let i = 0; i < 12; i++) s += rng();
  return s - 6;
}

export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}
