// サラブレッドの骨格と体の形（基本姿勢）。単位はメートル。馬は +x を向き、地面が y=0、+z が馬の右側。
// 寸法は体高（き甲の高さ）約1.62m・体長（肩端〜臀端）約1.6m・管囲約0.2m のサラブレッドを基準にしている。
// 脚の関節位置は、肩関節・肘・前膝（腕節）・球節・蹄、股関節・後膝（膝関節）・飛節・球節・蹄。
import { boundsOfCone, ellipsoid, roundCone, type Prim, type Vec3 } from "./sdf";

export type Side = "L" | "R";
export const SIDES: Side[] = ["L", "R"];
/** 左右の脚の間隔（中心からの距離） */
export const FRONT_Z = 0.14;
export const HIND_Z = 0.15;
const zOf = (s: Side, z: number) => (s === "R" ? z : -z);

/** 骨：名前・親・基本姿勢での付け根（ワールド座標）・先端 */
export interface BoneDef {
  name: string;
  parent: string | null;
  head: Vec3;
  tail: Vec3;
}

// 前脚（片側）の関節
export const FRONT = {
  shoulder: [0.6, 1.25] as const, // 肩関節（上腕骨の上端）
  elbow: [0.44, 1.0] as const,
  knee: [0.46, 0.52] as const, // 前膝（腕節）
  fetlock: [0.46, 0.2] as const, // 球節
  coronet: [0.52, 0.07] as const, // 蹄冠
  sole: [0.55, 0.0] as const, // 蹄の底の中心
};
// 後脚（片側）の関節
export const HIND = {
  hip: [-0.44, 1.32] as const, // 股関節
  stifle: [-0.24, 1.02] as const, // 後膝（膝関節）
  hock: [-0.62, 0.56] as const, // 飛節
  fetlock: [-0.58, 0.2] as const,
  coronet: [-0.53, 0.07] as const,
  sole: [-0.51, 0.0] as const,
};
export const NECK = {
  base: [0.6, 1.46] as const,
  mid: [0.86, 1.73] as const,
  poll: [1.06, 1.97] as const, // 項（うなじ）
  muzzle: [1.44, 1.48] as const,
};
export const TAIL = {
  dock: [-0.78, 1.5] as const,
  t2: [-0.92, 1.3] as const,
  t3: [-1.02, 1.0] as const,
  tip: [-1.07, 0.66] as const,
};
export const BODY_ORIGIN: Vec3 = [0, 1.3, 0];

const v3 = (p: readonly [number, number], z = 0): Vec3 => [p[0], p[1], z];

export function boneDefs(): BoneDef[] {
  const out: BoneDef[] = [
    { name: "root", parent: null, head: [0, 0, 0], tail: [0, 0.1, 0] },
    { name: "body", parent: "root", head: BODY_ORIGIN, tail: [0.3, 1.3, 0] },
    { name: "neck1", parent: "body", head: v3(NECK.base), tail: v3(NECK.mid) },
    { name: "neck2", parent: "neck1", head: v3(NECK.mid), tail: v3(NECK.poll) },
    { name: "head", parent: "neck2", head: v3(NECK.poll), tail: v3(NECK.muzzle) },
    { name: "tail1", parent: "body", head: v3(TAIL.dock), tail: v3(TAIL.t2) },
    { name: "tail2", parent: "tail1", head: v3(TAIL.t2), tail: v3(TAIL.t3) },
    { name: "tail3", parent: "tail2", head: v3(TAIL.t3), tail: v3(TAIL.tip) },
  ];
  for (const s of SIDES) {
    const fz = zOf(s, FRONT_Z);
    const hz = zOf(s, HIND_Z);
    out.push(
      { name: `fu${s}`, parent: "body", head: v3(FRONT.shoulder, fz), tail: v3(FRONT.elbow, fz) },
      { name: `ff${s}`, parent: `fu${s}`, head: v3(FRONT.elbow, fz), tail: v3(FRONT.knee, fz) },
      { name: `fc${s}`, parent: `ff${s}`, head: v3(FRONT.knee, fz), tail: v3(FRONT.fetlock, fz) },
      { name: `fp${s}`, parent: `fc${s}`, head: v3(FRONT.fetlock, fz), tail: v3(FRONT.coronet, fz) },
      { name: `fh${s}`, parent: `fp${s}`, head: v3(FRONT.coronet, fz), tail: v3(FRONT.sole, fz) },
      { name: `hu${s}`, parent: "body", head: v3(HIND.hip, hz), tail: v3(HIND.stifle, hz) },
      { name: `hl${s}`, parent: `hu${s}`, head: v3(HIND.stifle, hz), tail: v3(HIND.hock, hz) },
      { name: `hc${s}`, parent: `hl${s}`, head: v3(HIND.hock, hz), tail: v3(HIND.fetlock, hz) },
      { name: `hp${s}`, parent: `hc${s}`, head: v3(HIND.fetlock, hz), tail: v3(HIND.coronet, hz) },
      { name: `hh${s}`, parent: `hp${s}`, head: v3(HIND.coronet, hz), tail: v3(HIND.sole, hz) },
    );
  }
  return out;
}

/** 骨に沿ったカプセル（両端で親・子の骨と重みを分け合う） */
function seg(bone: string, a: Vec3, b: Vec3, ra: number, rb: number, blend: number, opts: Partial<Prim> & { squash?: number } = {}): Prim {
  const { squash, ...rest } = opts;
  return { eval: roundCone(a, b, ra, rb, squash ?? 1), blend, ...boundsOfCone(a, b, ra, rb), bone, a, b, ...rest };
}
function ell(bone: string, c: Vec3, r: Vec3, angle: number, blend: number, opts: Partial<Prim> & { yaw?: number } = {}): Prim {
  const { yaw, ...rest } = opts;
  return { eval: ellipsoid(c, r, angle, yaw ?? 0), blend, cx: c[0], cy: c[1], cz: c[2], cr: Math.max(...r), bone, ...rest };
}

/** 馬の体を作る形の一覧 */
export function horsePrims(): Prim[] {
  const P: Prim[] = [];
  const deg = Math.PI / 180;
  // ---- 胴 ----
  P.push(ell("body", [-0.02, 1.27, 0], [0.6, 0.3, 0.285], 0, 0.1)); // 胴（肋）
  P.push(ell("body", [0.44, 1.27, 0], [0.3, 0.31, 0.255], -8 * deg, 0.12)); // 胸
  P.push(ell("body", [0.36, 1.49, 0], [0.26, 0.11, 0.15], -10 * deg, 0.1)); // き甲
  P.push(ell("body", [0.0, 1.47, 0], [0.42, 0.1, 0.2], 0, 0.12)); // 背
  P.push(ell("body", [-0.5, 1.33, 0], [0.34, 0.3, 0.27], 0, 0.12)); // 後躯
  P.push(ell("body", [-0.46, 1.5, 0], [0.3, 0.12, 0.19], 6 * deg, 0.1)); // 尻
  P.push(ell("body", [0.52, 1.07, 0], [0.12, 0.1, 0.18], 0, 0.08)); // 胸前の下（き甲から下がった胸底）
  P.push(ell("body", [0.62, 1.3, 0], [0.12, 0.16, 0.18], -20 * deg, 0.08)); // 胸の前
  for (const s of SIDES) {
    const z = zOf(s, 1);
    P.push(ell("body", [0.47, 1.36, 0.1 * z], [0.25, 0.17, 0.12], -55 * deg, 0.08)); // 肩（肩甲骨まわりの筋肉）
    P.push(ell("body", [-0.67, 1.3, 0.09 * z], [0.15, 0.21, 0.14], 8 * deg, 0.07)); // 臀
    P.push(ell(`hu${s}`, [-0.4, 1.13, 0.125 * z], [0.25, 0.27, 0.13], 30 * deg, 0.09)); // 大腿（後躯から後膝まで続く厚い筋肉）
    P.push(ell(`hu${s}`, [-0.28, 1.0, 0.14 * z], [0.08, 0.08, 0.07], 0, 0.05)); // 後膝
    P.push(ell(`fu${s}`, [0.53, 1.12, 0.12 * z], [0.16, 0.14, 0.11], -40 * deg, 0.08)); // 上腕
  }
  P.push(ell("body", [-0.36, 1.07, 0], [0.24, 0.12, 0.22], 18 * deg, 0.1)); // ひばら（腹の後ろ）

  // ---- 首・頭 ----
  const nb = v3(NECK.base);
  const nm = v3(NECK.mid);
  const np = v3(NECK.poll);
  P.push(seg("neck1", [0.52, 1.38, 0], nm, 0.24, 0.155, 0.1, { squash: 0.6, parentBone: "body", childBone: "neck2" }));
  P.push(seg("neck2", nm, [1.02, 1.91, 0], 0.155, 0.1, 0.07, { squash: 0.6, parentBone: "neck1", childBone: "head" }));
  P.push(seg("neck1", [0.58, 1.56, 0], [0.9, 1.84, 0], 0.09, 0.07, 0.07, { squash: 0.55, parentBone: "body", childBone: "neck2" })); // 首の上側（き甲から項へ弧を描く）
  // たてがみ（首の上側の薄い帯）
  P.push(seg("neck1", [0.46, 1.6, 0], [0.82, 1.86, 0], 0.05, 0.045, 0.03, { squash: 0.35, region: "mane", parentBone: "body", childBone: "neck2" }));
  P.push(seg("neck2", [0.82, 1.86, 0], [1.02, 2.05, 0], 0.045, 0.035, 0.03, { squash: 0.35, region: "mane", parentBone: "neck1", childBone: "head" }));
  // 頭：頭頂・頬（下あご）・鼻梁・鼻先
  P.push(ell("head", [1.1, 1.94, 0], [0.11, 0.08, 0.1], -45 * deg, 0.05)); // 額
  P.push(ell("head", [1.07, 1.8, 0], [0.14, 0.115, 0.09], -38 * deg, 0.06)); // 頬（下あご）
  P.push(seg("head", [1.12, 1.9, 0], [1.4, 1.55, 0], 0.08, 0.052, 0.05, { squash: 0.82 })); // 鼻梁
  P.push(seg("head", [1.12, 1.76, 0], [1.36, 1.5, 0], 0.06, 0.04, 0.05, { squash: 0.8 })); // 下あごの線
  P.push(ell("head", [1.41, 1.51, 0], [0.065, 0.055, 0.058], -55 * deg, 0.035)); // 鼻先
  for (const s of SIDES) {
    const z = zOf(s, 1);
    P.push(seg("head", [1.04, 2.02, 0.065 * z], [1.0, 2.15, 0.08 * z], 0.032, 0.012, 0.025, { region: "ear" })); // 耳
    P.push(ell("head", [1.14, 1.9, 0.08 * z], [0.018, 0.014, 0.016], -45 * deg, 0.008, { region: "eye" })); // 目
    P.push(ell("head", [1.43, 1.55, 0.04 * z], [0.022, 0.012, 0.015], -55 * deg, 0.012, { region: "nostril", subtract: true })); // 鼻孔
  }

  // ---- 尾 ----
  P.push(seg("tail1", v3(TAIL.dock), v3(TAIL.t2), 0.06, 0.07, 0.05, { squash: 0.7, parentBone: "body", childBone: "tail2", region: "tail" }));
  P.push(seg("tail2", v3(TAIL.t2), v3(TAIL.t3), 0.085, 0.09, 0.04, { squash: 0.45, parentBone: "tail1", childBone: "tail3", region: "tail" }));
  P.push(seg("tail3", v3(TAIL.t3), v3(TAIL.tip), 0.09, 0.035, 0.04, { squash: 0.4, parentBone: "tail2", region: "tail" }));

  // ---- 脚 ----
  for (const s of SIDES) {
    const fz = zOf(s, FRONT_Z);
    const hz = zOf(s, HIND_Z);
    const F = (p: readonly [number, number]) => v3(p, fz);
    const H = (p: readonly [number, number]) => v3(p, hz);
    // 前脚：前腕（筋肉で太い）→ 前膝 → 管（細く、腱で前後に平たい）→ 球節 → 繋 → 蹄
    P.push(seg(`ff${s}`, F(FRONT.elbow), F(FRONT.knee), 0.09, 0.05, 0.05, { parentBone: `fu${s}`, childBone: `fc${s}` }));
    P.push(ell(`ff${s}`, [0.455, 0.86, fz], [0.075, 0.15, 0.065], 0, 0.05)); // 前腕の筋肉
    P.push(ell(`ff${s}`, [0.4, 1.0, fz], [0.07, 0.07, 0.06], 0, 0.05)); // 肘頭
    P.push(ell(`fc${s}`, [FRONT.knee[0], FRONT.knee[1] + 0.01, fz], [0.055, 0.065, 0.05], 0, 0.03)); // 前膝
    P.push(seg(`fc${s}`, F(FRONT.knee), F(FRONT.fetlock), 0.04, 0.036, 0.02, { parentBone: `ff${s}`, childBone: `fp${s}` }));
    P.push(seg(`fc${s}`, [FRONT.knee[0] - 0.025, FRONT.knee[1] - 0.05, fz], [FRONT.fetlock[0] - 0.028, FRONT.fetlock[1] + 0.03, fz], 0.022, 0.024, 0.02)); // 屈腱
    P.push(ell(`fp${s}`, [FRONT.fetlock[0] - 0.008, FRONT.fetlock[1], fz], [0.05, 0.048, 0.045], 0, 0.02)); // 球節
    P.push(seg(`fp${s}`, F(FRONT.fetlock), F(FRONT.coronet), 0.036, 0.04, 0.02, { parentBone: `fc${s}`, childBone: `fh${s}` }));
    P.push(seg(`fh${s}`, [0.525, 0.075, fz], [0.565, 0.012, fz], 0.05, 0.062, 0.012, { region: "hoof" }));
    // 後脚：脛（下腿、筋肉）→ 飛節 → 管 → 球節 → 繋 → 蹄
    P.push(seg(`hl${s}`, H(HIND.stifle), H(HIND.hock), 0.1, 0.05, 0.06, { parentBone: `hu${s}`, childBone: `hc${s}` }));
    P.push(ell(`hl${s}`, [-0.47, 0.82, hz], [0.085, 0.17, 0.075], -40 * deg, 0.05)); // 脛の筋肉（脛骨に沿って後ろ寄り）
    P.push(ell(`hc${s}`, [HIND.hock[0] + 0.005, HIND.hock[1] + 0.01, hz], [0.07, 0.065, 0.05], 0, 0.03)); // 飛節
    P.push(ell(`hc${s}`, [HIND.hock[0] - 0.05, HIND.hock[1] + 0.04, hz], [0.03, 0.03, 0.03], 0, 0.03)); // 飛端
    P.push(seg(`hc${s}`, H(HIND.hock), H(HIND.fetlock), 0.045, 0.038, 0.02, { parentBone: `hl${s}`, childBone: `hp${s}` }));
    P.push(seg(`hc${s}`, [HIND.hock[0] - 0.035, HIND.hock[1] - 0.05, hz], [HIND.fetlock[0] - 0.03, HIND.fetlock[1] + 0.03, hz], 0.022, 0.024, 0.02)); // 屈腱
    P.push(ell(`hp${s}`, [HIND.fetlock[0] - 0.008, HIND.fetlock[1], hz], [0.05, 0.048, 0.045], 0, 0.02));
    P.push(seg(`hp${s}`, H(HIND.fetlock), H(HIND.coronet), 0.036, 0.04, 0.02, { parentBone: `hc${s}`, childBone: `hh${s}` }));
    P.push(seg(`hh${s}`, [-0.535, 0.075, hz], [-0.5, 0.012, hz], 0.05, 0.06, 0.012, { region: "hoof" }));
  }
  return P;
}

/** 部位の判定（色分け用）。基本姿勢の座標と、いちばん近い形の部位から決める */
export function regionAt(x: number, y: number, z: number, primRegion: string | undefined): string {
  if (primRegion) return primRegion;
  // 鞍（背中の上、き甲の後ろ）
  if (y > 1.52 && x > 0.02 && x < 0.3 && Math.abs(z) < 0.15) return "saddle";
  // 頭絡（鼻革・項革）
  if (x > 1.0) {
    // 鼻革：鼻梁の途中を巻く帯
    const u = (x - 1.12) * 0.62 - (y - 1.9) * 0.78; // 鼻梁に沿った座標
    if (Math.abs(u - 0.24) < 0.016) return "bridle";
  }
  // 鼻先
  if (x > 1.33 && y < 1.6) return "muzzle";
  // 脚の先（前膝・飛節より下）
  if (y < 0.5) return "lowleg";
  return "coat";
}
