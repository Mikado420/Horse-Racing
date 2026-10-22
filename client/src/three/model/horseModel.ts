// 馬の3Dモデルを作る：形（SDF）→ ポリゴン化 → 骨への重み付け → 毛色ごとの頂点色。
// 形は1度だけ作り、全頭で共有する（骨格は1頭ごと）。細かさは3段階（近い馬ほど細かい）。
import * as THREE from "three";
import { COATS, blazeOf, coatOf, type CoatId } from "../../owner/coat";
import { BODY_ORIGIN, boneDefs, type BoneDef } from "./horseAnatomy";
import { LOD_CELLS, REGIONS } from "./assetData";
import { assetData } from "./assets";

export { LOD_CELLS };

interface LodData {
  geometry: THREE.BufferGeometry;
  regions: Uint8Array;
  ao: Float32Array;
  face: Uint8Array;
}

interface HorseAsset {
  defs: BoneDef[];
  lods: LodData[];
  /** 毛色・流星ごとの頂点色（LOD ごと） */
  colorCache: Map<string, THREE.BufferAttribute>[];
}

let asset: HorseAsset | null = null;

/** 形データから three.js のジオメトリを作る（1度だけ） */
export function horseAsset(): HorseAsset {
  if (asset) return asset;
  const defs = boneDefs();
  const lods = assetData().horse.map((r): LodData => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(r.positions, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(r.normals, 3));
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(r.skinIndex, 4));
    g.setAttribute("skinWeight", new THREE.BufferAttribute(r.skinWeight, 4));
    g.setIndex(new THREE.BufferAttribute(r.indices, 1));
    // 脚が動いても画面外判定で消えないよう、少し大きめの外接球にする
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.1, 1.1, 0), 2.3);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-1.8, -0.2, -0.8), new THREE.Vector3(2.0, 2.6, 0.8));
    return { geometry: g, regions: r.regions, ao: r.ao, face: r.face };
  });
  asset = { defs, lods, colorCache: lods.map(() => new Map()) };
  return asset;
}

const tmp = new THREE.Color();
function regionColor(region: string, coat: CoatId): THREE.Color {
  const c = COATS[coat];
  switch (region) {
    case "mane":
    case "tail":
      return tmp.set(c.mane);
    case "hoof":
      return tmp.set(c.hoof);
    case "lowleg":
      return tmp.set(c.socks ?? c.body);
    case "eye":
      return tmp.set("#0c0908");
    case "nostril":
      return tmp.set("#1a1210");
    case "muzzle":
      return tmp.set(c.body).lerp(new THREE.Color("#2a201b"), 0.45);
    case "ear":
      return tmp.set(c.socks ?? c.shade);
    case "saddle":
      return tmp.set("#17140f");
    case "bridle":
      return tmp.set("#2b1c12");
    default:
      return tmp.set(c.body);
  }
}

/** 毛色・流星に応じた頂点色（陰を焼き込む） */
function colorsFor(lod: number, coat: CoatId, blaze: boolean): THREE.BufferAttribute {
  const a = horseAsset();
  const key = `${coat}-${blaze ? 1 : 0}`;
  const cached = a.colorCache[lod].get(key);
  if (cached) return cached;
  const d = a.lods[lod];
  const n = d.regions.length;
  const out = new Float32Array(n * 3);
  const shade = new THREE.Color(COATS[coat].shade);
  const pos = d.geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let v = 0; v < n; v++) {
    const r = REGIONS[d.regions[v]];
    const col = regionColor(r, coat).clone();
    if (r === "coat") {
      // 毛色：上は日に焼けて少し明るく、腹側や筋肉の溝は濃い
      const y = pos.getY(v);
      col.lerp(shade, Math.max(0, Math.min(0.55, (1.2 - y) * 0.9)));
      if (blaze && d.face[v]) col.set("#f2efe8");
    }
    // ソフトな陰影（シェーダーの光と重ねるので控えめに）
    const k = 0.35 + 0.65 * d.ao[v];
    out[v * 3] = col.r * k;
    out[v * 3 + 1] = col.g * k;
    out[v * 3 + 2] = col.b * k;
  }
  const attr = new THREE.BufferAttribute(out, 3);
  a.colorCache[lod].set(key, attr);
  return attr;
}

/** 毛色・流星ごとのジオメトリ（位置などは共有し、色だけ差し替える） */
const geoCache = new Map<string, THREE.BufferGeometry>();
function geometryFor(lod: number, coat: CoatId, blaze: boolean): THREE.BufferGeometry {
  const key = `${lod}-${coat}-${blaze ? 1 : 0}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const base = horseAsset().lods[lod].geometry;
  const g = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "skinIndex", "skinWeight"]) g.setAttribute(name, base.getAttribute(name));
  g.setIndex(base.getIndex());
  g.setAttribute("color", colorsFor(lod, coat, blaze));
  g.boundingSphere = base.boundingSphere;
  g.boundingBox = base.boundingBox;
  geoCache.set(key, g);
  return g;
}

let horseMaterial: THREE.MeshStandardMaterial | null = null;
function material(): THREE.MeshStandardMaterial {
  if (!horseMaterial) horseMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.0, envMapIntensity: 0.9 });
  return horseMaterial;
}

export interface HorseRig {
  /** 馬全体（位置と向きはこれで動かす。+x が前） */
  group: THREE.Group;
  bones: Record<string, THREE.Bone>;
  /** 細かさ別のメッシュ（どれか1つだけ表示する） */
  lods: THREE.SkinnedMesh[];
  setLod: (i: number) => void;
  /** 胴の骨（騎手・ゼッケンを付ける） */
  body: THREE.Bone;
}

/** 1頭分の骨格とメッシュを作る */
export function createHorse(horseId: string, castShadow = true): HorseRig {
  const a = horseAsset();
  const coat = coatOf(horseId);
  const blaze = blazeOf(horseId);
  const group = new THREE.Group();
  const bones: Record<string, THREE.Bone> = {};
  const list: THREE.Bone[] = [];
  const inverses: THREE.Matrix4[] = [];
  for (const d of a.defs) {
    const b = new THREE.Bone();
    b.name = d.name;
    const parent = d.parent ? a.defs.find((x) => x.name === d.parent)! : null;
    b.position.set(d.head[0] - (parent?.head[0] ?? 0), d.head[1] - (parent?.head[1] ?? 0), d.head[2] - (parent?.head[2] ?? 0));
    if (d.parent) bones[d.parent].add(b);
    bones[d.name] = b;
    list.push(b);
    inverses.push(new THREE.Matrix4().makeTranslation(-d.head[0], -d.head[1], -d.head[2]));
  }
  group.add(bones.root);
  const skeleton = new THREE.Skeleton(list, inverses);
  const lods = LOD_CELLS.map((_, i) => {
    const m = new THREE.SkinnedMesh(geometryFor(i, coat, blaze), material());
    m.bind(skeleton, new THREE.Matrix4());
    m.castShadow = castShadow && i < 2;
    m.receiveShadow = i === 0;
    m.visible = i === 0;
    group.add(m);
    return m;
  });
  let cur = 0;
  return {
    group,
    bones,
    lods,
    body: bones.body,
    setLod: (i) => {
      if (i === cur) return;
      lods[cur].visible = false;
      lods[i].visible = true;
      cur = i;
    },
  };
}

/** 基本姿勢での胴の骨の位置（騎手などを胴に付けるときの基準） */
export const BODY_BONE_ORIGIN = BODY_ORIGIN;
