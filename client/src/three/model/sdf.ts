// 符号付き距離関数（SDF）の基本形と、なめらかな合成。
// 馬・騎手の形は、楕円体や「太さが変わるカプセル」をなめらかに足し合わせて作る（外部のモデルファイルは使わない）。

export type Vec3 = [number, number, number];

/** 1つの形。eval は点までの距離（内側は負）。bone は皮膚の重み付けに使う骨、region は色分けに使う部位 */
export interface Prim {
  eval: (x: number, y: number, z: number) => number;
  /** なめらかにつなぐ幅（m）。大きいほど丸く溶け合う */
  blend: number;
  /** 近くにあるかを素早く判定するための外接球 */
  cx: number;
  cy: number;
  cz: number;
  cr: number;
  bone: string;
  /** 骨に沿って隣の骨と重みを分け合う区間（カプセルの両端） */
  a?: Vec3;
  b?: Vec3;
  parentBone?: string;
  childBone?: string;
  region?: string;
  /** 形を削る（くぼみ）なら true */
  subtract?: boolean;
}

/** 多項式によるなめらかな最小値（合成） */
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** なめらかな差（くぼみ） */
export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

/** 楕円体（中心 c、半径 r、y-x 面内の回転 angle） */
export function ellipsoid(c: Vec3, r: Vec3, angle = 0, yaw = 0) {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const ir0 = 1 / r[0];
  const ir1 = 1 / r[1];
  const ir2 = 1 / r[2];
  return (x: number, y: number, z: number) => {
    let px = x - c[0];
    let py = y - c[1];
    let pz = z - c[2];
    // 縦の回転（x-y 面）
    const qx = px * ca + py * sa;
    const qy = -px * sa + py * ca;
    px = qx;
    py = qy;
    // 横の回転（x-z 面）
    const rx = px * cy + pz * sy;
    const rz = -px * sy + pz * cy;
    px = rx;
    pz = rz;
    const ax = px * ir0;
    const ay = py * ir1;
    const az = pz * ir2;
    const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
    const bx = ax * ir0;
    const by = ay * ir1;
    const bz = az * ir2;
    const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
    return k1 === 0 ? -Math.min(r[0], r[1], r[2]) : (k0 * (k0 - 1)) / k1;
  };
}

/** 太さが変わるカプセル（a で半径 ra、b で半径 rb）。squashZ は横方向のつぶれ（1で丸、0.5で平たい） */
export function roundCone(a: Vec3, b: Vec3, ra: number, rb: number, squashZ = 1, zCenter?: number) {
  const bax = b[0] - a[0];
  const bay = b[1] - a[1];
  const baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const zc = zCenter ?? (a[2] + b[2]) / 2;
  return (x: number, y: number, z0: number) => {
    // 横方向につぶす：z を中心からの距離で引き伸ばして評価し、最後に縮め戻す近似
    const z = squashZ === 1 ? z0 : zc + (z0 - zc) / squashZ;
    const pax = x - a[0];
    const pay = y - a[1];
    const paz = z - a[2];
    const dot = pax * bax + pay * bay + paz * baz;
    const yy = dot;
    const qx = pax * l2 - bax * yy;
    const qy = pay * l2 - bay * yy;
    const qz = paz * l2 - baz * yy;
    const x2 = qx * qx + qy * qy + qz * qz;
    const y2 = yy * yy * l2;
    const z2 = (yy - l2) * (yy - l2) * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    let d: number;
    if (Math.sign(yy - l2) * a2 * z2 > k) d = Math.sqrt(x2 + z2) * il2 - rb;
    else if (Math.sign(yy) * a2 * y2 < k) d = Math.sqrt(x2 + y2) * il2 - ra;
    else d = (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - ra;
    return squashZ === 1 ? d : d * Math.min(1, squashZ * 1.15);
  };
}

/** 外接球を計算して Prim を作るための補助 */
export function boundsOfCone(a: Vec3, b: Vec3, ra: number, rb: number) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return { cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, cz: (a[2] + b[2]) / 2, cr: Math.sqrt(dx * dx + dy * dy + dz * dz) / 2 + Math.max(ra, rb) };
}

/** すべての形をなめらかに合成した距離。外接球で遠い形を省いて速くする */
export function fieldOf(prims: Prim[]) {
  const n = prims.length;
  const cx = new Float64Array(n);
  const cy = new Float64Array(n);
  const cz = new Float64Array(n);
  const cr = new Float64Array(n);
  const bl = new Float64Array(n);
  const sub = new Uint8Array(n);
  const ev = prims.map((p) => p.eval);
  prims.forEach((p, i) => {
    cx[i] = p.cx;
    cy[i] = p.cy;
    cz[i] = p.cz;
    cr[i] = p.cr;
    bl[i] = p.blend;
    sub[i] = p.subtract ? 1 : 0;
  });
  return (x: number, y: number, z: number): number => {
    let d = 1e9;
    for (let i = 0; i < n; i++) {
      const dx = x - cx[i];
      const dy = y - cy[i];
      const dz = z - cz[i];
      const r2 = dx * dx + dy * dy + dz * dz;
      if (sub[i]) {
        const lim = cr[i] + bl[i];
        if (r2 > lim * lim) continue;
        d = smax(d, -ev[i](x, y, z), bl[i]);
        continue;
      }
      // 外接球までの距離が今の距離＋つなぎ幅より遠ければ、結果は変わらない
      const lim = cr[i] + d + bl[i];
      if (lim > 0 && r2 > lim * lim) continue;
      d = smin(d, ev[i](x, y, z), bl[i]);
    }
    return d;
  };
}
