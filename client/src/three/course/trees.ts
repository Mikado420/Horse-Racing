// 競馬場の木々。東京競馬場のように、向こう正面の外に背の高い木立、内馬場に林、3〜4コーナーの内側に大木、
// 外ラチの外には生け垣を置く。
//
// 重くしない工夫
// ・近くの木（カメラが寄る場所）だけ立体（低ポリゴン）。種類ごとに1回の描画（インスタンス描画）でまとめて描く
// ・遠くの木は「十字に組んだ2枚の板に木の絵」を貼る（1本4三角形）。数千本でも1回の描画
// ・木は影を落とさない（大木だけ例外）。揺れは高品質のときだけ、GPU で計算する
import * as THREE from "three";
import type { TrackFrame } from "./trackFrame";

export interface TreeArea {
  frame: TrackFrame;
  /** 描画上のコース幅 */
  width: number;
  quality: "high" | "low";
  /** スタンドの範囲（x）。z の符号はコースの外側（ホーム側） */
  stand: { x0: number; x1: number; depth: number };
  /** 避ける場所（大型ビジョン・池など）。中心と半径 */
  avoid: { x: number; z: number; r: number }[];
  /** もう一方の走路（芝なら内側のダート、ダートなら外側の芝）。木はどちらの走路にも置かない */
  other?: TrackFrame;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 複数のジオメトリを1つに（頂点色つき・インデックスなし） */
function merge(parts: { g: THREE.BufferGeometry; color: THREE.Color }[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  for (const { g, color } of parts) {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.computeVertexNormals();
    const p = ng.getAttribute("position");
    const n = ng.getAttribute("normal");
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      // 下の方を少し暗く（葉の内側の陰）
      const shade = 0.75 + 0.25 * Math.min(1, Math.max(0, (p.getY(i) - 2) / 8));
      col.push(color.r * shade, color.g * shade, color.b * shade);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return out;
}

const TRUNK = new THREE.Color("#4a3a2c");
const LEAF = new THREE.Color("#ffffff"); // 葉の色は1本ずつの色（インスタンス色）で決める

/** 欅（ケヤキ）型：幹が途中で分かれ、上に扇形に広がる樹冠 */
function zelkova(): THREE.BufferGeometry {
  const parts: { g: THREE.BufferGeometry; color: THREE.Color }[] = [];
  const trunk = new THREE.CylinderGeometry(0.35, 0.55, 5, 6, 1, true);
  trunk.translate(0, 2.5, 0);
  parts.push({ g: trunk, color: TRUNK });
  for (const [x, z, a] of [
    [1.2, 0, 0.5],
    [-0.9, 0.8, -0.45],
    [-0.4, -1.1, 0.4],
  ] as const) {
    const br = new THREE.CylinderGeometry(0.18, 0.3, 4, 5, 1, true);
    br.translate(0, 2, 0);
    br.rotateZ(-a * Math.sign(x || 1));
    br.rotateX(z * 0.35);
    br.translate(x * 0.3, 4.6, z * 0.3);
    parts.push({ g: br, color: TRUNK });
  }
  const lumps: [number, number, number, number][] = [
    [0, 10.5, 0, 4.6],
    [3.2, 9.2, 0.6, 3.4],
    [-3.0, 9.4, -0.4, 3.5],
    [0.6, 9.0, 3.0, 3.3],
    [-0.5, 9.1, -3.1, 3.3],
    [0, 12.6, 0, 3.0],
  ];
  for (const [x, y, z, r] of lumps) {
    const s = new THREE.IcosahedronGeometry(r, 0);
    s.scale(1, 0.78, 1);
    s.translate(x, y, z);
    parts.push({ g: s, color: LEAF });
  }
  return merge(parts);
}

/** 丸い広葉樹 */
function broadleaf(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.25, 0.38, 4, 6, 1, true);
  trunk.translate(0, 2, 0);
  const parts: { g: THREE.BufferGeometry; color: THREE.Color }[] = [{ g: trunk, color: TRUNK }];
  for (const [x, y, z, r] of [
    [0, 6.4, 0, 3.2],
    [1.5, 5.6, 0.8, 2.3],
    [-1.4, 5.8, -0.6, 2.4],
    [0.2, 7.8, -0.3, 2.1],
  ] as const) {
    const s = new THREE.IcosahedronGeometry(r, 0);
    s.translate(x, y, z);
    parts.push({ g: s, color: LEAF });
  }
  return merge(parts);
}

/** 針葉樹（松・杉） */
function conifer(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.2, 0.3, 3, 5, 1, true);
  trunk.translate(0, 1.5, 0);
  const parts: { g: THREE.BufferGeometry; color: THREE.Color }[] = [{ g: trunk, color: TRUNK }];
  for (const [y, r, h] of [
    [4, 2.8, 4.5],
    [6.6, 2.2, 4],
    [9, 1.5, 3.4],
  ] as const) {
    const c = new THREE.ConeGeometry(r, h, 7, 1, true);
    c.translate(0, y, 0);
    parts.push({ g: c, color: LEAF });
  }
  return merge(parts);
}

/** 遠景の木の絵（3種類を横に並べた1枚の画像） */
function billboardTexture(): THREE.CanvasTexture {
  const W = 384;
  const H = 128;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const r = rng(11);
  const blob = (cx: number, cy: number, rad: number, light: number) => {
    const grad = g.createRadialGradient(cx - rad * 0.3, cy - rad * 0.4, rad * 0.1, cx, cy, rad);
    grad.addColorStop(0, `rgb(${Math.round(255 * light)},${Math.round(255 * light)},${Math.round(255 * light)})`);
    grad.addColorStop(1, `rgb(${Math.round(150 * light)},${Math.round(150 * light)},${Math.round(150 * light)})`);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, rad, 0, Math.PI * 2);
    g.fill();
  };
  // 0：欅（扇形）、1：丸い広葉樹、2：針葉樹
  for (let k = 0; k < 3; k++) {
    const ox = k * 128;
    g.fillStyle = "#3a2e24";
    g.fillRect(ox + 60, k === 2 ? 96 : 84, 8, 44);
    if (k === 2) {
      for (let i = 0; i < 4; i++) {
        const y = 30 + i * 22;
        const w = 18 + i * 10;
        g.fillStyle = i % 2 ? "#cfcfcf" : "#e6e6e6";
        g.beginPath();
        g.moveTo(ox + 64, y - 26);
        g.lineTo(ox + 64 + w, y + 14);
        g.lineTo(ox + 64 - w, y + 14);
        g.closePath();
        g.fill();
      }
    } else {
      const n = k === 0 ? 14 : 10;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const rx = k === 0 ? 40 : 30;
        const ry = k === 0 ? 26 : 30;
        blob(ox + 64 + Math.cos(a) * rx * r(), (k === 0 ? 48 : 52) + Math.sin(a) * ry * r(), 16 + r() * 12, 0.85 + r() * 0.15);
      }
      blob(ox + 64, k === 0 ? 40 : 46, k === 0 ? 30 : 28, 1);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** 十字に組んだ2枚の板（下端が原点、高さ1・幅1）。種類 k の絵の範囲を UV に */
function crossQuad(): THREE.BufferGeometry {
  const a = new THREE.PlaneGeometry(1, 1);
  a.translate(0, 0.5, 0);
  const b = a.clone();
  b.rotateY(Math.PI / 2);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const g of [a, b]) {
    const p = g.getAttribute("position");
    const u = g.getAttribute("uv");
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      uv.push(u.getX(i), u.getY(i));
    }
    const ix = g.getIndex()!;
    for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
    base += p.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** 葉の揺れ（頂点シェーダーで、木ごとに位相をずらす）。高さが高いほど大きく揺れる */
function addSway(mat: THREE.Material, time: { value: number }, amount: number) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float ph = ip.x * 0.13 + ip.z * 0.07;
          float k = max(0.0, transformed.y - 3.0) * ${amount.toFixed(4)};
          transformed.x += sin(uTime * 1.3 + ph) * k;
          transformed.z += cos(uTime * 1.1 + ph * 1.7) * k * 0.6;
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => `owners-sway-${amount}`;
}

export function buildTrees(area: TreeArea): { group: THREE.Group; update: (t: number) => void; dispose: () => void } {
  const { frame, width: W, quality } = area;
  const high = quality === "high";
  const group = new THREE.Group();
  const r = rng(7);
  const zs = frame.mirror ? -1 : 1;
  const L = frame.L;
  const turnLen = Math.PI * frame.R;
  const time = { value: 0 };
  const disposables: { dispose: () => void }[] = [];

  const surfaces = [frame, ...(area.other ? [area.other] : [])];
  /** 場所が使えるか（走路・スタンド・ビジョン・池を避ける）。minLat/maxLat はこのレースの走路から見た位置 */
  const free = (x: number, z: number, minLat: number, maxLat: number): boolean => {
    const n = frame.nearest(x, z);
    if (n.lateral < minLat || n.lateral > maxLat) return false;
    // 内馬場の木は、いちばん内側の走路よりさらに内側。外周の木は、いちばん外側の走路よりさらに外側
    const inside = minLat < 0;
    for (const f of surfaces) {
      const l = f.nearest(x, z).lateral;
      if (inside ? l > -22 : l < f.width + 28) return false;
    }
    // ホーム側（スタンドの前後）は、スタンドより後ろだけ
    const homeSide = z * zs > frame.R && Math.abs(x) <= frame.S / 2 + 40;
    if (homeSide && x > area.stand.x0 - 30 && x < area.stand.x1 + 30 && n.lateral < W + area.stand.depth + 20) return false;
    for (const a of area.avoid) if (Math.hypot(x - a.x, z - a.z) < a.r) return false;
    return true;
  };
  const at = (s: number, lat: number) => {
    const p = frame.point(s, lat);
    return { x: p.x, z: p.z };
  };

  // ---- 立体の木（近景）：種類ごとの配置を集める ----
  type Spot = { x: number; z: number; s: number; rot: number; tint: THREE.Color };
  const near: Spot[][] = [[], [], []]; // 0 欅、1 広葉樹、2 針葉樹
  const leaf = (h: number, sat: number, l: number) => new THREE.Color().setHSL(h, sat, l);
  const put = (kind: number, x: number, z: number, scale: number) => {
    near[kind].push({ x, z, s: scale, rot: r() * Math.PI * 2, tint: kind === 2 ? leaf(0.33 + r() * 0.04, 0.35, 0.2 + r() * 0.06) : leaf(0.25 + r() * 0.07, 0.38 + r() * 0.2, 0.26 + r() * 0.1) });
  };
  // 向こう正面の外：欅の並木（2〜3列）
  const backFrom = turnLen;
  const backTo = turnLen + frame.S;
  for (let row = 0; row < (high ? 3 : 2); row++) {
    for (let s = backFrom - 60; s < backTo + 60; s += 9 + r() * 4) {
      const p = at(s, W + 34 + row * 11 + r() * 4);
      if (free(p.x, p.z, W + 30, 1e9)) put(r() < 0.75 ? 0 : 1, p.x, p.z, 0.85 + r() * 0.35);
    }
  }
  // 1〜2コーナー、3〜4コーナーの外：まばらな木立
  for (const [from, to] of [
    [10, turnLen - 10],
    [backTo + 10, backTo + turnLen - 10],
  ]) {
    for (let s = from; s < to; s += 16 + r() * 10) {
      const p = at(s, W + 36 + r() * 20);
      if (free(p.x, p.z, W + 30, 1e9)) put(r() < 0.6 ? 1 : r() < 0.5 ? 0 : 2, p.x, p.z, 0.8 + r() * 0.4);
    }
  }
  // 内馬場：向こう正面の内側と3〜4コーナーの内側に林（内ラチから 25m 以上離す）
  const innerFrame = surfaces.reduce((a, f) => (f.R < a.R ? f : a));
  const woods = [
    { u: (turnLen + frame.S * 0.5) / L, lat: -40, n: high ? 45 : 22, spread: 36 },
    { u: (backTo + turnLen * 0.35) / L, lat: -46, n: high ? 60 : 30, spread: 34 },
    { u: (turnLen * 0.5) / L, lat: -50, n: high ? 35 : 16, spread: 32 },
    { u: (backTo + turnLen * 0.75) / L, lat: -38, n: high ? 25 : 12, spread: 26 },
  ];
  for (const w of woods) {
    const cp = innerFrame.point(w.u * innerFrame.L, w.lat);
    const c = { x: cp.x, z: cp.z };
    let guard = 0;
    for (let i = 0; i < w.n && guard++ < w.n * 10; ) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * w.spread;
      const x = c.x + Math.cos(a) * d;
      const z = c.z + Math.sin(a) * d;
      if (!free(x, z, -1e9, -25)) continue;
      put(r() < 0.55 ? 1 : r() < 0.6 ? 0 : 2, x, z, 0.75 + r() * 0.45);
      i++;
    }
  }

  const geos = [zelkova(), broadleaf(), conifer()];
  const nearMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
  if (high) addSway(nearMat, time, 0.012);
  disposables.push(nearMat);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  geos.forEach((geo, kind) => {
    const list = near[kind];
    disposables.push(geo);
    if (!list.length) return;
    const inst = new THREE.InstancedMesh(geo, nearMat, list.length);
    list.forEach((t, i) => {
      q.setFromAxisAngle(up, t.rot);
      m.compose(new THREE.Vector3(t.x, frame.groundHeight(t.x, t.z) - 0.2, t.z), q, new THREE.Vector3(t.s, t.s * (0.9 + r() * 0.25), t.s));
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, t.tint);
    });
    inst.computeBoundingSphere();
    group.add(inst);
  });

  // ---- 大木（3〜4コーナーの内側の目印）：いちばん内側の走路のさらに内側 ----
  {
    const s = backTo + turnLen * 0.22;
    const inner = surfaces.reduce((a, f) => (f.R < a.R ? f : a));
    const pp = inner.point(s * (inner.L / L), -30);
    const p = { x: pp.x, z: pp.z };
    const big = new THREE.Mesh(zelkova(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true, color: "#6f9a4f" }));
    big.scale.setScalar(2.1);
    big.position.set(p.x, frame.groundHeight(p.x, p.z) - 0.3, p.z);
    big.rotation.y = 0.7;
    big.castShadow = high;
    disposables.push(big.geometry, big.material as THREE.Material);
    group.add(big);
  }

  // ---- 遠景の木（板の絵）：外周をぐるりと厚い帯で ----
  {
    const tex = billboardTexture();
    disposables.push(tex);
    const geo = crossQuad();
    disposables.push(geo);
    const mat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, fog: true });
    // 種類ごとに絵の範囲を変える（インスタンスごとに UV をずらす）
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float kind;").replace("#include <uv_vertex>", "#include <uv_vertex>\nvMapUv = vec2((uv.x + kind) / 3.0, uv.y);");
    };
    mat.customProgramCacheKey = () => "owners-billboard";
    disposables.push(mat);
    const count = high ? 2600 : 1100;
    const kinds = new Float32Array(count);
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const col = new THREE.Color();
    let k = 0;
    let guard = 0;
    while (k < count && guard++ < count * 8) {
      const s = r() * L;
      // 向こう正面の外は特に厚く
      const u = ((s % L) + L) % L;
      const back = u > backFrom - 80 && u < backTo + 80;
      const lat = W + (back ? 62 : 75) + Math.pow(r(), 1.6) * (back ? 160 : 140);
      const p = at(s, lat);
      if (!free(p.x, p.z, W + 55, 1e9)) continue;
      const kind = r() < 0.5 ? 0 : r() < 0.7 ? 1 : 2;
      const h = (kind === 2 ? 11 : 12) + r() * 7;
      q.setFromAxisAngle(up, r() * Math.PI);
      m.compose(new THREE.Vector3(p.x, frame.groundHeight(p.x, p.z) - 0.3, p.z), q, new THREE.Vector3(h * 1.05, h, h * 1.05));
      inst.setMatrixAt(k, m);
      inst.setColorAt(k, col.setHSL(0.27 + r() * 0.06, 0.35 + r() * 0.15, 0.3 + r() * 0.1));
      kinds[k] = kind;
      k++;
    }
    inst.count = k;
    geo.setAttribute("kind", new THREE.InstancedBufferAttribute(kinds, 1));
    inst.computeBoundingSphere();
    group.add(inst);
  }

  // ---- 生け垣（外ラチの外。ホームストレッチ以外） ----
  {
    const pos: number[] = [];
    const idx: number[] = [];
    const lat0 = W + 5;
    const hgt = 1.4;
    const step = 4;
    let v = 0;
    for (let s = 6; s < L - frame.S - 6; s += step) {
      const a = frame.point(s, lat0);
      const b = frame.point(s, lat0 + 1.2);
      // 内側の面と上の面（外側は見えないので省く）
      pos.push(a.x, a.y, a.z, a.x, a.y + hgt, a.z, b.x, b.y + hgt, b.z);
      if (s + step < L - frame.S - 6) idx.push(v, v + 3, v + 1, v + 1, v + 3, v + 4, v + 1, v + 4, v + 2, v + 2, v + 4, v + 5);
      v += 3;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const hedge = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: "#3f6e35", roughness: 1, side: THREE.DoubleSide }));
    disposables.push(g, hedge.material as THREE.Material);
    group.add(hedge);
  }

  return {
    group,
    update: (t) => {
      time.value = t;
    },
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}
