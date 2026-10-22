// 騎手（前傾して鐙に立つ「モンキー乗り」の姿勢）と、鞍下のゼッケン。
// 騎手の形も距離関数で作る。勝負服の色は1頭ごとに変えるので、色は頂点ではなくシェーダーで塗る。
import * as THREE from "three";
import { BODY_ORIGIN } from "./horseAnatomy";
import { assetData } from "./assets";

interface JockeyAsset {
  geometry: THREE.BufferGeometry;
}
let cache: JockeyAsset[] | null = null;

/** 騎手の形（2段階の細かさ）。胴の骨からの相対座標 */
export function jockeyAssets(): JockeyAsset[] {
  if (cache) return cache;
  cache = assetData().jockey.map((r) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(r.positions, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(r.normals, 3));
    g.setAttribute("part", new THREE.BufferAttribute(r.part, 1));
    g.setIndex(new THREE.BufferAttribute(r.indices, 1));
    g.computeBoundingSphere();
    return { geometry: g };
  });
  return cache;
}

/** 勝負服（胴・袖・帽子）の色を1頭ごとに変えられる材質 */
export function jockeyMaterial(silk: string, sleeve: string, cap: string): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 });
  const uniforms = {
    uSilk: { value: new THREE.Color(silk) },
    uSleeve: { value: new THREE.Color(sleeve) },
    uCap: { value: new THREE.Color(cap) },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float part;\nvarying float vPart;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvPart = part;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vPart;\nuniform vec3 uSilk;\nuniform vec3 uSleeve;\nuniform vec3 uCap;")
      .replace(
        "vec4 diffuseColor = vec4( diffuse, opacity );",
        `vec3 pc = uSilk;
        float p = floor(vPart + 0.5);
        if (p == 1.0) pc = uSleeve;
        else if (p == 2.0) pc = uCap;
        else if (p == 3.0) pc = vec3(0.93, 0.92, 0.88);
        else if (p == 4.0) pc = vec3(0.07, 0.06, 0.05);
        else if (p == 5.0) pc = vec3(0.78, 0.6, 0.48);
        else if (p == 6.0) pc = vec3(0.12, 0.13, 0.15);
        else if (p == 7.0) pc = vec3(0.09, 0.08, 0.07);
        else if (p == 8.0) pc = vec3(0.93, 0.93, 0.9);
        vec4 diffuseColor = vec4( pc, opacity );`,
      );
  };
  m.customProgramCacheKey = () => "owners-jockey";
  return m;
}

/** 勝負服の配色（18頭まで重ならない組み合わせ）。[胴, 袖, 帽子] */
export const SILKS: [string, string, string][] = [
  ["#f4f4ee", "#14213d", "#14213d"],
  ["#14213d", "#e7b526", "#e7b526"],
  ["#b3203a", "#f4f4ee", "#b3203a"],
  ["#1e5fa8", "#f4f4ee", "#f4f4ee"],
  ["#e7b526", "#2e6b3f", "#2e6b3f"],
  ["#2e6b3f", "#e2752b", "#e2752b"],
  ["#e2752b", "#14213d", "#e2752b"],
  ["#d86c9e", "#f4f4ee", "#d86c9e"],
  ["#5b2a86", "#e7b526", "#f4f4ee"],
  ["#0f7b7b", "#f4f4ee", "#0f7b7b"],
  ["#7a4a1e", "#e7b526", "#7a4a1e"],
  ["#f4f4ee", "#b3203a", "#b3203a"],
  ["#14213d", "#d86c9e", "#f4f4ee"],
  ["#9bc53d", "#14213d", "#9bc53d"],
  ["#c0c5ce", "#1e5fa8", "#1e5fa8"],
  ["#8b1e3f", "#c0c5ce", "#c0c5ce"],
  ["#f2d0a4", "#5b2a86", "#5b2a86"],
  ["#1b1b1b", "#e2752b", "#e2752b"],
];

/** ゼッケン（左右の脇腹）。馬番と枠の色を描いた布 */
export function saddleCloth(number: number, bg: string, fg: string): THREE.Group {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 160;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 160);
  g.strokeStyle = fg;
  g.lineWidth = 6;
  g.strokeRect(8, 8, 240, 144);
  g.fillStyle = fg;
  g.font = "bold 104px 'Helvetica Neue', Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(number), 128, 86);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide });
  const group = new THREE.Group();
  for (const side of [1, -1]) {
    // 胴の丸みに沿わせて曲げた布
    const geo = new THREE.PlaneGeometry(0.5, 0.3, 8, 6);
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i); // -0.15〜0.15（上が背中側）
      const zz = 0.022 + Math.max(0, y + 0.02) * Math.max(0, y + 0.02) * 2.2;
      pos.setZ(i, -zz);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    // 胴の骨からの位置（鞍の下、脇腹）
    m.position.set(0.12 - BODY_ORIGIN[0], 1.44 - BODY_ORIGIN[1], 0.285 * side);
    if (side < 0) m.rotation.y = Math.PI;
    group.add(m);
  }
  return group;
}
