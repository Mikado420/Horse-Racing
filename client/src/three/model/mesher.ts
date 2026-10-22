// 距離関数からポリゴンを作る（Surface Nets 法）。
// 格子の各セルで表面をまたぐ辺の交点の平均に頂点を置き、表面を横切る格子の辺ごとに四角形を張る。
// 最後に頂点を勾配方向へ表面上まで寄せ、法線も勾配から求めるので、なめらかな曲面になる。

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

export function polygonize(f: (x: number, y: number, z: number) => number, bounds: Bounds, cell: number): MeshData {
  const [x0, y0, z0] = bounds.min;
  const nx = Math.ceil((bounds.max[0] - x0) / cell) + 1;
  const ny = Math.ceil((bounds.max[1] - y0) / cell) + 1;
  const nz = Math.ceil((bounds.max[2] - z0) / cell) + 1;
  const sxy = nx * ny;
  const field = new Float32Array(nx * ny * nz);
  // 粗い格子で先に距離を測り、表面から遠い場所は細かく測らない（距離の値をそのまま使う）
  const step = 4;
  const band = cell * step * 1.8;
  const cxn = Math.ceil((nx - 1) / step) + 1;
  const cyn = Math.ceil((ny - 1) / step) + 1;
  const czn = Math.ceil((nz - 1) / step) + 1;
  const coarse = new Float32Array(cxn * cyn * czn);
  for (let k = 0; k < czn; k++)
    for (let j = 0; j < cyn; j++)
      for (let i = 0; i < cxn; i++) coarse[i + j * cxn + k * cxn * cyn] = f(x0 + i * step * cell, y0 + j * step * cell, z0 + k * step * cell);
  for (let k = 0; k < nz; k++) {
    const z = z0 + k * cell;
    const ck = k / step;
    const k0 = Math.floor(ck);
    const k1 = Math.min(czn - 1, k0 + 1);
    const fk = ck - k0;
    for (let j = 0; j < ny; j++) {
      const y = y0 + j * cell;
      const cj = j / step;
      const j0 = Math.floor(cj);
      const j1 = Math.min(cyn - 1, j0 + 1);
      const fj = cj - j0;
      for (let i = 0; i < nx; i++) {
        const ci = i / step;
        const i0 = Math.floor(ci);
        const i1 = Math.min(cxn - 1, i0 + 1);
        const fi = ci - i0;
        // 粗い格子の8点から補間した距離
        const c = (a: number, b: number, d: number) => coarse[a + b * cxn + d * cxn * cyn];
        const est =
          (c(i0, j0, k0) * (1 - fi) + c(i1, j0, k0) * fi) * (1 - fj) * (1 - fk) +
          (c(i0, j1, k0) * (1 - fi) + c(i1, j1, k0) * fi) * fj * (1 - fk) +
          (c(i0, j0, k1) * (1 - fi) + c(i1, j0, k1) * fi) * (1 - fj) * fk +
          (c(i0, j1, k1) * (1 - fi) + c(i1, j1, k1) * fi) * fj * fk;
        field[i + j * nx + k * sxy] = Math.abs(est) > band ? est : f(x0 + i * cell, y, z);
      }
    }
  }

  // セル（i,j,k は最小の角）→ 頂点番号
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cnx = nx - 1;
  const cny = ny - 1;
  const pos: number[] = [];
  const corner = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
  ];
  const edges = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  const v = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const [a, b, d] = corner[c];
          v[c] = field[i + a + (j + b) * nx + (k + d) * sxy];
          if (v[c] < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (const [ea, eb] of edges) {
          const va = v[ea];
          const vb = v[eb];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          const A = corner[ea];
          const B = corner[eb];
          sx += A[0] + (B[0] - A[0]) * t;
          sy += A[1] + (B[1] - A[1]) * t;
          sz += A[2] + (B[2] - A[2]) * t;
          n++;
        }
        cellVert[i + j * cnx + k * cnx * cny] = pos.length / 3;
        pos.push(x0 + (i + sx / n) * cell, y0 + (j + sy / n) * cell, z0 + (k + sz / n) * cell);
      }

  // 面：表面を横切る格子の辺ごとに、その辺を囲む4つのセルの頂点で四角形を張る
  const idx: number[] = [];
  const cv = (i: number, j: number, k: number) => (i < 0 || j < 0 || k < 0 || i >= cnx || j >= cny || k >= nz - 1 ? -1 : cellVert[i + j * cnx + k * cnx * cny]);
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, c, b, a, d, c);
    else idx.push(a, b, c, a, c, d);
  };
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const here = field[i + j * nx + k * sxy];
        const inside = here < 0;
        // x 方向の辺
        if (i < nx - 1 && inside !== field[i + 1 + j * nx + k * sxy] < 0)
          quad(cv(i, j - 1, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i, j - 1, k), !inside);
        // y 方向の辺
        if (j < ny - 1 && inside !== field[i + (j + 1) * nx + k * sxy] < 0)
          quad(cv(i - 1, j, k - 1), cv(i - 1, j, k), cv(i, j, k), cv(i, j, k - 1), !inside);
        // z 方向の辺
        if (k < nz - 1 && inside !== field[i + j * nx + (k + 1) * sxy] < 0)
          quad(cv(i - 1, j - 1, k), cv(i, j - 1, k), cv(i, j, k), cv(i - 1, j, k), !inside);
      }

  // 頂点を表面へ寄せ、勾配から法線を求める
  const positions = new Float32Array(pos);
  const normals = new Float32Array(pos.length);
  const e = cell * 0.25;
  for (let p = 0; p < positions.length; p += 3) {
    let x = positions[p];
    let y = positions[p + 1];
    let z = positions[p + 2];
    let gx = 0;
    let gy = 0;
    let gz = 0;
    for (let it = 0; it < 2; it++) {
      const d = f(x, y, z);
      gx = f(x + e, y, z) - f(x - e, y, z);
      gy = f(x, y + e, z) - f(x, y - e, z);
      gz = f(x, y, z + e) - f(x, y, z - e);
      const g2 = (gx * gx + gy * gy + gz * gz) / (4 * e * e);
      if (g2 < 1e-8) break;
      const s = d / g2 / (2 * e);
      // 大きく飛ばないように、1セルの半分までに抑える
      const mx = Math.max(-cell * 0.5, Math.min(cell * 0.5, gx * s));
      const my = Math.max(-cell * 0.5, Math.min(cell * 0.5, gy * s));
      const mz = Math.max(-cell * 0.5, Math.min(cell * 0.5, gz * s));
      x -= mx;
      y -= my;
      z -= mz;
      if (Math.abs(d) < cell * 0.01) break;
    }
    positions[p] = x;
    positions[p + 1] = y;
    positions[p + 2] = z;
    const gl = Math.hypot(gx, gy, gz) || 1;
    normals[p] = gx / gl;
    normals[p + 1] = gy / gl;
    normals[p + 2] = gz / gl;
  }
  return { positions, normals, indices: new Uint32Array(idx) };
}
