// 馬と騎手の形のデータを作る（three.js を使わない純粋な計算）。重いので Web Worker でも動かせるようにしてある。
import { BODY_ORIGIN, boneDefs, horsePrims, regionAt, type BoneDef } from "./horseAnatomy";
import { polygonize } from "./mesher";
import { boundsOfCone, ellipsoid, fieldOf, roundCone, type Prim, type Vec3 } from "./sdf";

/** 細かさ（格子の大きさ m）。0 が近景用 */
export const LOD_CELLS = [0.03, 0.05, 0.09];
export const JOCKEY_CELLS = [0.028, 0.055];

/** 色分けの部位（頂点ごとに番号で持つ） */
export const REGIONS = ["coat", "mane", "tail", "hoof", "lowleg", "eye", "nostril", "muzzle", "ear", "saddle", "bridle"] as const;
const REGION_INDEX: Record<string, number> = Object.fromEntries(REGIONS.map((r, i) => [r, i]));

export interface HorseLodRaw {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  regions: Uint8Array;
  ao: Float32Array;
  /** 顔の正面（流星を描く場所）か */
  face: Uint8Array;
}
export interface JockeyRaw {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  part: Float32Array;
}
export interface AssetData {
  horse: HorseLodRaw[];
  jockey: JockeyRaw[];
}

export function buildAssetData(): AssetData {
  const defs = boneDefs();
  const prims = horsePrims();
  return { horse: LOD_CELLS.map((c) => buildHorseLod(prims, defs, c)), jockey: JOCKEY_CELLS.map(buildJockey) };
}

/** Worker から本体へ渡すときに、コピーせずに移せる配列 */
export function transferablesOf(d: AssetData): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  const add = (...a: { buffer: ArrayBufferLike }[]) => a.forEach((x) => out.push(x.buffer as ArrayBuffer));
  for (const h of d.horse) add(h.positions, h.normals, h.indices, h.skinIndex, h.skinWeight, h.regions, h.ao, h.face);
  for (const j of d.jockey) add(j.positions, j.normals, j.indices, j.part);
  return out;
}

function buildHorseLod(prims: Prim[], defs: BoneDef[], cell: number): HorseLodRaw {
  const body = fieldOf(prims);
  // 蹄の底を平らにする（地面 y=0 より下を切り落とし、閉じた面にする）
  const f = (x: number, y: number, z: number) => Math.max(body(x, y, z), -y);
  const mesh = polygonize(f, { min: [-1.25, -0.03, -0.42], max: [1.52, 2.25, 0.42] }, cell);
  const n = mesh.positions.length / 3;
  const boneIndex = new Map(defs.map((d, i) => [d.name, i]));
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const regions = new Uint8Array(n);
  const ao = new Float32Array(n);
  const face = new Uint8Array(n);
  const solid = prims.filter((p) => !p.subtract);
  const acc = new Map<number, number>();
  for (let v = 0; v < n; v++) {
    const x = mesh.positions[v * 3];
    const y = mesh.positions[v * 3 + 1];
    const z = mesh.positions[v * 3 + 2];
    // いちばん近い形と、その近くの形から重みを決める
    let dmin = 1e9;
    let near: Prim | null = null;
    const ds: number[] = new Array(solid.length);
    for (let i = 0; i < solid.length; i++) {
      const p = solid[i];
      const ddx = x - p.cx;
      const ddy = y - p.cy;
      const ddz = z - p.cz;
      const lim = p.cr + 0.25;
      ds[i] = ddx * ddx + ddy * ddy + ddz * ddz > lim * lim ? 1e9 : p.eval(x, y, z);
      if (ds[i] < dmin) {
        dmin = ds[i];
        near = p;
      }
    }
    acc.clear();
    for (let i = 0; i < solid.length; i++) {
      const p = solid[i];
      const w0 = Math.max(0.012, p.blend * 0.7);
      const dd = ds[i] - dmin;
      if (dd >= w0) continue;
      let w = (1 - dd / w0) ** 2;
      // 骨に沿った形は、端で親・子の骨と重みを分け合う（関節で滑らかに曲がる）
      let parentShare = 0;
      let childShare = 0;
      if (p.a && p.b) {
        const bx = p.b[0] - p.a[0];
        const by = p.b[1] - p.a[1];
        const bz = p.b[2] - p.a[2];
        const t = ((x - p.a[0]) * bx + (y - p.a[1]) * by + (z - p.a[2]) * bz) / (bx * bx + by * by + bz * bz);
        const zone = 0.22;
        if (p.parentBone && t < zone) parentShare = 0.5 * (1 - Math.max(0, t) / zone);
        if (p.childBone && t > 1 - zone) childShare = 0.5 * (1 - Math.max(0, 1 - t) / zone);
      }
      const add = (bone: string | undefined, ww: number) => {
        if (!bone || ww <= 0) return;
        const bi = boneIndex.get(bone)!;
        acc.set(bi, (acc.get(bi) ?? 0) + ww);
      };
      add(p.bone, w * (1 - parentShare - childShare));
      add(p.parentBone, w * parentShare);
      add(p.childBone, w * childShare);
    }
    const top = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((s, e) => s + e[1], 0) || 1;
    for (let k = 0; k < 4; k++) {
      skinIndex[v * 4 + k] = top[k]?.[0] ?? 0;
      skinWeight[v * 4 + k] = top[k] ? top[k][1] / sum : 0;
    }
    regions[v] = REGION_INDEX[regionAt(x, y, z, near?.region)] ?? 0;
    // 流星（顔の正面の白い筋）を描ける場所
    face[v] = near?.bone === "head" && !near.region && Math.abs(z) < 0.032 && x > 1.08 && y > 1.6 && y < 1.98 ? 1 : 0;
    // 陰（くぼみほど暗く）：法線方向に少しずつ離れた点の距離から求める
    const nx = mesh.normals[v * 3];
    const ny = mesh.normals[v * 3 + 1];
    const nz = mesh.normals[v * 3 + 2];
    let occ = 0;
    let wsum = 0.5;
    for (const h of [0.03, 0.07, 0.13, 0.22]) {
      occ += (h - Math.min(h, f(x + nx * h, y + ny * h, z + nz * h))) * wsum;
      wsum *= 0.55;
    }
    // 下向きの面（腹・脚の内側）は空からの光が少ない
    ao[v] = Math.max(0.42, Math.min(1, 1 - occ * 4.2)) * (0.86 + 0.14 * Math.max(0, ny * 0.5 + 0.5));
  }
  return { positions: mesh.positions, normals: mesh.normals, indices: mesh.indices, skinIndex, skinWeight, regions, ao, face };
}

// 部位の番号（頂点属性 part に入れる）
export const PART = { silk: 0, sleeve: 1, cap: 2, breeches: 3, boots: 4, skin: 5, goggles: 6, saddle: 7, glove: 8 } as const;
type Part = keyof typeof PART;

function cone(part: Part, a: Vec3, b: Vec3, ra: number, rb: number, blend: number, squash = 1): Prim & { part: Part } {
  return { eval: roundCone(a, b, ra, rb, squash), blend, ...boundsOfCone(a, b, ra, rb), bone: "body", part };
}
function ell(part: Part, c: Vec3, r: Vec3, angle: number, blend: number): Prim & { part: Part } {
  return { eval: ellipsoid(c, r, angle), blend, cx: c[0], cy: c[1], cz: c[2], cr: Math.max(...r), bone: "body", part };
}

function jockeyPrims(): (Prim & { part: Part })[] {
  const deg = Math.PI / 180;
  const P: (Prim & { part: Part })[] = [];
  // 鞍（小さな競走用の鞍）
  P.push(ell("saddle", [0.12, 1.685, 0], [0.2, 0.035, 0.15], 0, 0.02)); // 騎手と一緒に 0.1 下げて置くので、ここでは 0.1 上に作る
  // 腰・胴（ほぼ水平に前傾）
  P.push(ell("breeches", [0.04, 1.86, 0], [0.13, 0.11, 0.13], 10 * deg, 0.05));
  P.push(cone("silk", [0.08, 1.9, 0], [0.42, 2.0, 0], 0.13, 0.15, 0.06, 0.82));
  P.push(ell("silk", [0.36, 1.98, 0], [0.13, 0.11, 0.16], 0, 0.05)); // 胸・肩
  // 首・頭・帽子・ゴーグル
  P.push(cone("skin", [0.48, 2.02, 0], [0.56, 2.07, 0], 0.045, 0.045, 0.03));
  P.push(ell("skin", [0.61, 2.08, 0], [0.095, 0.1, 0.085], -20 * deg, 0.03));
  P.push(ell("cap", [0.6, 2.13, 0], [0.11, 0.075, 0.1], -15 * deg, 0.02));
  P.push(ell("cap", [0.7, 2.12, 0], [0.06, 0.012, 0.07], -10 * deg, 0.01)); // ひさし
  P.push(ell("goggles", [0.675, 2.08, 0], [0.04, 0.03, 0.085], -20 * deg, 0.01));
  for (const s of [1, -1]) {
    // 脚：鐙に足を置き、膝を高く曲げる
    P.push(cone("breeches", [0.05, 1.85, 0.1 * s], [0.38, 1.7, 0.21 * s], 0.075, 0.06, 0.04)); // 太もも
    P.push(cone("boots", [0.38, 1.7, 0.21 * s], [0.25, 1.46, 0.25 * s], 0.055, 0.045, 0.03)); // すね
    P.push(cone("boots", [0.23, 1.43, 0.25 * s], [0.34, 1.42, 0.25 * s], 0.035, 0.03, 0.02)); // 足
    // 腕：肩から肘、肘から手綱を持つ手へ
    P.push(cone("sleeve", [0.42, 1.99, 0.15 * s], [0.52, 1.82, 0.17 * s], 0.05, 0.042, 0.03));
    P.push(cone("sleeve", [0.52, 1.82, 0.17 * s], [0.74, 1.74, 0.08 * s], 0.042, 0.036, 0.02));
    P.push(ell("glove", [0.77, 1.74, 0.07 * s], [0.04, 0.035, 0.035], 0, 0.015));
  }
  return P;
}

function buildJockey(cell: number): JockeyRaw {
  const prims = jockeyPrims();
  const f = fieldOf(prims);
  const m = polygonize(f, { min: [-0.15, 1.25, -0.36], max: [0.86, 2.26, 0.36] }, cell);
  const n = m.positions.length / 3;
  const part = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const x = m.positions[v * 3];
    const y = m.positions[v * 3 + 1];
    const z = m.positions[v * 3 + 2];
    let best = 1e9;
    let bp: Part = "silk";
    for (const p of prims) {
      const d = p.eval(x, y, z);
      if (d < best) {
        best = d;
        bp = p.part;
      }
    }
    part[v] = PART[bp];
    // 胴の骨からの相対座標にする
    m.positions[v * 3] -= BODY_ORIGIN[0];
    m.positions[v * 3 + 1] -= BODY_ORIGIN[1];
  }
  return { positions: m.positions, normals: m.normals, indices: m.indices, part };
}
