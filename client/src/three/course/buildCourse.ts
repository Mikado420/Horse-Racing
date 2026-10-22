// 競馬場を作る：芝とダートの走路・内外の柵・ハロン棒・ゴール板・スタンドと観客・大型ビジョン・発馬機・木々・遠くの山。
// 走路の形と高さは TrackFrame（レース計算と同じ座標）から作る。建物は本作独自の簡単な形。
import * as THREE from "three";
import { makeCourse, type CourseDef, type Going } from "@owners/shared";
import { TrackFrame } from "./trackFrame";
import { CROWD_COLORS, dirtTexture, grassTexture, labelTexture, turfTexture, windowTexture } from "./textures";

export interface CourseOptions {
  runners: number;
  going: Going;
  quality: "high" | "low";
  /** 発走地点（内ラチ沿いの距離 s） */
  startS: number;
}

export interface CourseScene {
  group: THREE.Group;
  frame: TrackFrame;
  /** 大型ビジョンの画面（中継映像を貼る） */
  screen: THREE.Mesh;
  /** t：発走からの秒数（負なら発走前） */
  update: (t: number) => void;
  dispose: () => void;
}

type OwnerLike = CourseDef & { trackId?: string; direction?: "left" | "right"; slope?: boolean };

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

/** 走路（コースに沿った帯）。lat0〜lat1 の幅、s に沿って step ごとに分割 */
function ribbon(frame: TrackFrame, lat0: number, lat1: number, step: number, cols: number, uLen: number, lift: number): THREE.BufferGeometry {
  const n = Math.ceil(frame.L / step);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * frame.L;
    for (let j = 0; j <= cols; j++) {
      const lat = lat0 + ((lat1 - lat0) * j) / cols;
      const p = frame.point(s, lat);
      pos.push(p.x, p.y + lift, p.z);
      uv.push(s / uLen, (lat - lat0) / (lat1 - lat0));
    }
    if (i < n)
      for (let j = 0; j < cols; j++) {
        const a = i * (cols + 1) + j;
        const b = a + cols + 1;
        // 左回り（反転なし）で上向きになる順
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // 右回りは z を反転しているので、面の向きを裏返して上向きにそろえる
  if (frame.mirror) flipFaces(g);
  return g;
}

function flipFaces(g: THREE.BufferGeometry) {
  const ix = g.getIndex()!;
  for (let i = 0; i < ix.count; i += 3) {
    const b = ix.getX(i + 1);
    ix.setX(i + 1, ix.getX(i + 2));
    ix.setX(i + 2, b);
  }
  g.computeVertexNormals();
}

/** 柵（白い横木と支柱） */
function rail(frame: TrackFrame, lateral: number, height: number, color: string, postEvery: number, radial = 6): THREE.Group {
  const grp = new THREE.Group();
  const pts: THREE.Vector3[] = [];
  for (let s = 0; s < frame.L; s += 4) {
    const p = frame.point(s, lateral);
    pts.push(new THREE.Vector3(p.x, p.y + height, p.z));
  }
  const curve = new THREE.CatmullRomCurve3(pts, true);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.05 });
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.ceil(frame.L / 3), 0.07, radial, true), mat);
  tube.castShadow = false;
  grp.add(tube);
  const posts = Math.ceil(frame.L / postEvery);
  const postGeo = new THREE.CylinderGeometry(0.045, 0.05, height, 4, 1, true);
  postGeo.translate(0, height / 2, 0);
  const inst = new THREE.InstancedMesh(postGeo, mat, posts);
  const m = new THREE.Matrix4();
  for (let i = 0; i < posts; i++) {
    const p = frame.point(i * postEvery, lateral);
    m.makeTranslation(p.x, p.y, p.z);
    inst.setMatrixAt(i, m);
  }
  grp.add(inst);
  return grp;
}

/** 発馬機（ゲート）。発走後は外へ引き出して片付ける */
function startingGate(frame: TrackFrame, startS: number, n: number): { group: THREE.Group; update: (t: number) => void } {
  const group = new THREE.Group();
  const green = new THREE.MeshStandardMaterial({ color: "#2f6a4a", roughness: 0.5, metalness: 0.3 });
  const white = new THREE.MeshStandardMaterial({ color: "#f2f2ee", roughness: 0.5 });
  const pad = new THREE.MeshStandardMaterial({ color: "#c9c2b0", roughness: 0.8 });
  const stallW = 1.25;
  const width = n * stallW + 1.2;
  const depth = 3.6;
  const h = 2.6;
  const inner = new THREE.Group(); // ゲートの中心を原点に、+x が前、+z が外側
  const box = (w: number, hh: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    inner.add(m);
    return m;
  };
  // 上の梁と、左右の大きな枠
  box(depth, 0.35, width, 0, h, 0, green);
  box(depth * 0.9, 0.1, width, 0, h + 0.25, 0, white);
  for (const z of [-width / 2, width / 2]) {
    // 両端の枠（柱と横木だけの枠組み）
    for (const x of [-depth / 2 + 0.1, depth / 2 - 0.1]) box(0.16, h, 0.16, x, h / 2, z, green);
    box(depth, 0.14, 0.16, 0, 1.0, z, green);
    // 車輪
    for (const x of [-depth / 2, depth / 2]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.25, 16), new THREE.MeshStandardMaterial({ color: "#222", roughness: 0.9 }));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, 0.45, z + Math.sign(z) * 0.2);
      inner.add(wheel);
    }
  }
  // 馬房の仕切りと前扉、上の番号
  const doors: THREE.Mesh[] = [];
  for (let i = 0; i <= n; i++) {
    const z = -width / 2 + 0.6 + i * stallW;
    // 馬房の仕切り：胴の高さの板と、前後の柱
    box(depth - 0.3, 0.75, 0.05, 0, 1.25, z, pad);
    for (const x of [-depth / 2 + 0.15, depth / 2 - 0.15]) box(0.08, h, 0.08, x, h / 2, z, green);
  }
  for (let i = 0; i < n; i++) {
    const z = -width / 2 + 0.6 + (i + 0.5) * stallW;
    for (const side of [-1, 1]) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.3, stallW / 2 - 0.04), green);
      d.geometry.translate(0, 0, (side * (stallW / 2 - 0.04)) / 2); // 蝶番（扉の端）を回転の軸にする
      d.position.set(depth / 2, 1.2, z - side * (stallW / 2 - 0.02));
      inner.add(d);
      doors.push(d);
      (d.userData as { side: number }).side = side;
    }
    const num = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.45), new THREE.MeshBasicMaterial({ map: labelTexture(String(i + 1), "#f4f4ee", "#14213d", 96, 72) }));
    num.position.set(depth / 2 + 0.02, h - 0.05, z);
    num.rotation.y = Math.PI / 2;
    inner.add(num);
  }
  // ゲートの位置：発走地点、内ラチから外へ並べる。向きはコースの進行方向
  const p = frame.point(startS, width / 2 - 0.6);
  group.position.set(p.x, p.y, p.z);
  group.rotation.y = -p.heading;
  // 右回り（z を反転）なら外側は -z 側
  inner.scale.z = frame.mirror ? -1 : 1;
  // 番号の文字が裏返らないよう、反転時は番号板だけ戻す
  if (frame.mirror) inner.children.forEach((c) => c instanceof THREE.Mesh && c.geometry instanceof THREE.PlaneGeometry && (c.scale.x = -1));
  group.add(inner);
  return {
    group,
    update: (t) => {
      // 発走：前扉が左右に開く
      const open = Math.max(0, Math.min(1, t / 0.35));
      for (const d of doors) d.rotation.y = (d.userData as { side: number }).side * open * 1.45;
      // 発走から6秒後、外へ引き出して片付ける
      const away = Math.max(0, Math.min(1, (t - 6) / 10));
      inner.position.z = away * away * 45;
      group.visible = t < 18;
    },
  };
}

export function buildCourse(courseIn: CourseDef, opt: CourseOptions): CourseScene {
  const course = courseIn as OwnerLike;
  const frame = new TrackFrame(course, opt.runners);
  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);
  const wet = opt.going === "good" ? 0 : opt.going === "yielding" ? 0.35 : 0.8;
  const W = frame.width;
  const zs = frame.mirror ? -1 : 1;

  // ---- 地面（芝生）：コースの高さに合わせた格子 ----
  const ext = { x: frame.S / 2 + frame.R + W + 260, z: frame.R + W + 260 };
  const gw = opt.quality === "high" ? 150 : 90;
  const gh = opt.quality === "high" ? 100 : 60;
  const groundGeo = new THREE.PlaneGeometry(ext.x * 2, ext.z * 2, gw, gh);
  groundGeo.rotateX(-Math.PI / 2);
  const gp = groundGeo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < gp.count; i++) gp.setY(i, frame.groundHeight(gp.getX(i), gp.getZ(i)) - 0.12);
  groundGeo.computeVertexNormals();
  const grass = track(grassTexture());
  grass.repeat.set((ext.x * 2) / 22, (ext.z * 2) / 22);
  const ground = new THREE.Mesh(groundGeo, track(new THREE.MeshStandardMaterial({ map: grass, roughness: 1, color: "#c9cfb0" })));
  ground.receiveShadow = true;
  group.add(ground);
  // 遠くの地面（地平線まで）
  const far = new THREE.Mesh(new THREE.RingGeometry(Math.max(ext.x, ext.z) * 0.95, 3800, 64, 1), track(new THREE.MeshStandardMaterial({ color: "#5d8a45", roughness: 1 })));
  far.rotation.x = -Math.PI / 2;
  far.position.y = -1.2;
  group.add(far);

  // ---- 走路 ----
  const raceIsTurf = course.surface === "turf";
  const turfTex = track(turfTexture(wet));
  turfTex.repeat.set(1, 1);
  const dirtTex = track(dirtTexture(wet));
  const surfaceMat = (turf: boolean) =>
    track(new THREE.MeshStandardMaterial({ map: turf ? turfTex : dirtTex, roughness: turf ? 0.92 : wet > 0.5 ? 0.55 : 0.98, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const main = new THREE.Mesh(ribbon(frame, -1.2, W + 1.2, 3, 6, raceIsTurf ? 24 : 16, 0.02), surfaceMat(raceIsTurf));
  main.receiveShadow = true;
  group.add(main);
  const radial = opt.quality === "high" ? 6 : 4;
  group.add(rail(frame, -0.6, 1.0, "#f6f6f2", opt.quality === "high" ? 2.5 : 4, radial)); // 内ラチ
  group.add(rail(frame, W + 0.9, 1.2, "#f6f6f2", opt.quality === "high" ? 3 : 5, radial)); // 外ラチ
  // もう一方の走路（芝なら内側のダート、ダートなら外側の芝）
  if (course.trackId) {
    try {
      const sib = makeCourse(course.trackId, raceIsTurf ? "dirt" : "turf", course.distance);
      const sf = new TrackFrame(sib, 0);
      const m = new THREE.Mesh(ribbon(sf, -1, sf.width + 1, 4, 3, raceIsTurf ? 16 : 24, 0.01), surfaceMat(!raceIsTurf));
      m.receiveShadow = true;
      group.add(m);
      group.add(rail(sf, -0.6, 1.0, "#f6f6f2", 5, 4));
    } catch {
      /* 対応する走路がなければ描かない */
    }
  }

  // ---- ゴール板と決勝線、ハロン棒 ----
  const goal = frame.point(0, -2.4);
  const goalPole = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 6, 12), track(new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.4 })));
  pole.position.y = 3;
  pole.castShadow = true;
  goalPole.add(pole);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.12, 32), [
    track(new THREE.MeshStandardMaterial({ color: "#f4f4ee" })),
    track(new THREE.MeshStandardMaterial({ map: track(labelTexture("", "#b3203a", "#fff")) })),
    track(new THREE.MeshStandardMaterial({ map: track(labelTexture("", "#b3203a", "#fff")) })),
  ]);
  disc.rotation.z = Math.PI / 2;
  disc.position.y = 6.6;
  goalPole.add(disc);
  goalPole.position.set(goal.x, goal.y, goal.z);
  goalPole.rotation.y = -goal.heading;
  group.add(goalPole);
  {
    const a = frame.point(0, -0.6);
    const b = frame.point(0, W + 0.9);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.35, len), track(new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85 })));
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = -a.heading;
    line.position.set((a.x + b.x) / 2, Math.max(a.y, b.y) + 0.05, (a.z + b.z) / 2);
    group.add(line);
  }
  const poleMat = track(new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.5 }));
  for (let d = 200; d < Math.min(frame.L, course.distance + 1); d += 200) {
    const p = frame.point(-d, -1.6);
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 3, 8), poleMat);
    post.position.y = 1.5;
    g.add(post);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), track(new THREE.MeshBasicMaterial({ map: track(labelTexture(String(d / 100), d % 1000 === 0 ? "#b3203a" : "#f4f4ee", d % 1000 === 0 ? "#ffffff" : "#b3203a")), side: THREE.DoubleSide })));
    sign.position.y = 3.2;
    sign.rotation.y = Math.PI / 2;
    g.add(sign);
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = -p.heading;
    group.add(g);
  }

  // ---- スタンド（ホームストレッチの外側、ゴール付近を中心に） ----
  const standLen = Math.min(260, frame.S * 0.9);
  const zFront = frame.R + W + 26; // 走路の外側の端からエプロン（立ち見の場所）を挟んで
  const xc = frame.S / 2 - standLen * 0.42;
  const stand = new THREE.Group();
  const concrete = track(new THREE.MeshStandardMaterial({ color: "#d9d6cf", roughness: 0.85 }));
  const darker = track(new THREE.MeshStandardMaterial({ color: "#a9a59c", roughness: 0.9 }));
  // 段々の観客席（断面を押し出す）
  const prof = new THREE.Shape();
  const rows = 34;
  const rowD = 0.85;
  const rowH = 0.45;
  prof.moveTo(0, 0);
  prof.lineTo(0, 2.4);
  for (let i = 0; i < rows; i++) {
    prof.lineTo(i * rowD, 2.4 + i * rowH + rowH);
    prof.lineTo((i + 1) * rowD, 2.4 + i * rowH + rowH);
  }
  prof.lineTo(rows * rowD, 0);
  prof.closePath();
  const seatsGeo = new THREE.ExtrudeGeometry(prof, { depth: standLen, bevelEnabled: false, steps: 1 });
  // 断面は (z, y)、押し出しは x 方向にしたい
  seatsGeo.rotateY(-Math.PI / 2);
  seatsGeo.translate(xc + standLen / 2, 0, 0);
  const seats = new THREE.Mesh(seatsGeo, concrete);
  seats.position.z = zFront;
  seats.receiveShadow = true;
  stand.add(seats);
  // 後ろの建物（ガラス面）と屋根
  const backZ = zFront + rows * rowD;
  const bH = 2.4 + rows * rowH + 14;
  const win = track(windowTexture());
  win.repeat.set(standLen / 40, 2);
  const building = new THREE.Mesh(new THREE.BoxGeometry(standLen, bH, 16), [concrete, concrete, concrete, darker, track(new THREE.MeshStandardMaterial({ map: win, roughness: 0.15, metalness: 0.4 })), concrete]);
  // BoxGeometry の面の順：+x, -x, +y, -y, +z, -z。走路側（-z）にガラス
  (building.material as THREE.Material[])[4] = concrete;
  (building.material as THREE.Material[])[5] = track(new THREE.MeshStandardMaterial({ map: win, roughness: 0.15, metalness: 0.4 }));
  building.position.set(xc, bH / 2, backZ + 8);
  building.castShadow = true;
  stand.add(building);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(standLen + 6, 0.8, rows * rowD + 6), track(new THREE.MeshStandardMaterial({ color: "#eceae4", roughness: 0.6, metalness: 0.2 })));
  roof.position.set(xc, bH + 0.4, zFront + (rows * rowD) / 2 - 1);
  roof.rotation.x = 0.04;
  roof.castShadow = true;
  stand.add(roof);
  for (let i = 0; i <= 6; i++) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, bH, 10), darker);
    col.position.set(xc - standLen / 2 + (i * standLen) / 6, bH / 2, backZ - 1);
    stand.add(col);
  }
  // エプロン（立ち見の舗装）
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(standLen + 60, 24), track(new THREE.MeshStandardMaterial({ color: "#c9c5bb", roughness: 0.95 })));
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(xc, frame.groundHeight(xc, zs * (zFront - 12)) - 0.05, zFront - 12.5);
  apron.receiveShadow = true;
  stand.add(apron);
  // 観客（1回の描画で数千人）
  {
    const r = rng(42);
    const personGeo = new THREE.CylinderGeometry(0.15, 0.19, 1.3, 5, 1, true);
    personGeo.translate(0, 0.65, 0);
    const headGeo = new THREE.IcosahedronGeometry(0.115, 0);
    headGeo.translate(0, 1.47, 0);
    const seated = Math.floor((standLen / 0.75) * rows * (opt.quality === "high" ? 0.3 : 0.08));
    const standing = opt.quality === "high" ? 1000 : 300;
    const crowd = new THREE.InstancedMesh(personGeo, track(new THREE.MeshStandardMaterial({ roughness: 0.9 })), seated + standing);
    const heads = new THREE.InstancedMesh(headGeo, track(new THREE.MeshStandardMaterial({ roughness: 0.8 })), seated + standing);
    const skin = ["#e2b896", "#c99a76", "#8a5a3c", "#f0cfb4", "#3b2a20"];
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    let k = 0;
    for (let i = 0; i < seated; i++) {
      const row = Math.floor(r() * rows);
      const x = xc - standLen / 2 + 1 + r() * (standLen - 2);
      const z = zFront + row * rowD + rowD * 0.55;
      const y = 2.4 + row * rowH + rowH - 0.25;
      m.makeScale(1, 0.62 + r() * 0.08, 1).setPosition(x, y, z);
      crowd.setMatrixAt(k, m);
      heads.setMatrixAt(k, m);
      heads.setColorAt(k, col.set(r() < 0.25 ? "#2b241f" : skin[Math.floor(r() * skin.length)]));
      crowd.setColorAt(k++, col.set(CROWD_COLORS[Math.floor(r() * CROWD_COLORS.length)]));
    }
    for (let i = 0; i < standing; i++) {
      const x = xc - standLen / 2 - 20 + r() * (standLen + 40);
      // 外ラチの柵際ほど人が多い
      const zz = frame.R + W + 3.5 + Math.pow(r(), 2.4) * 20;
      const y = frame.groundHeight(x, zs * zz);
      m.makeScale(1, 0.95 + r() * 0.12, 1).setPosition(x, y, zz);
      crowd.setMatrixAt(k, m);
      heads.setMatrixAt(k, m);
      heads.setColorAt(k, col.set(r() < 0.3 ? "#2b241f" : skin[Math.floor(r() * skin.length)]));
      crowd.setColorAt(k++, col.set(CROWD_COLORS[Math.floor(r() * CROWD_COLORS.length)]));
    }
    crowd.instanceMatrix.needsUpdate = true;
    stand.add(crowd, heads);
  }
  stand.scale.z = zs;
  group.add(stand);

  // ---- 大型ビジョン（内馬場、スタンドの向かい） ----
  const screenGroup = new THREE.Group();
  const sw = 44;
  const sh = 16;
  const frameMesh = new THREE.Mesh(new THREE.BoxGeometry(sw + 2, sh + 2, 1.2), track(new THREE.MeshStandardMaterial({ color: "#222629", roughness: 0.6 })));
  frameMesh.position.y = 8 + sh / 2;
  screenGroup.add(frameMesh);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), track(new THREE.MeshBasicMaterial({ color: "#20303a", toneMapped: false })));
  screen.position.set(0, 8 + sh / 2, 0.62);
  screenGroup.add(screen);
  for (const x of [-sw / 3, sw / 3]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 8, 1.2), darker);
    leg.position.set(x, 4, 0);
    screenGroup.add(leg);
  }
  const scx = frame.S / 2 - 140;
  const scz = frame.R - 55;
  screenGroup.position.set(scx, frame.groundHeight(scx, zs * scz), zs * scz);
  screenGroup.rotation.y = frame.mirror ? Math.PI : 0;
  group.add(screenGroup);

  // ---- 内馬場の池 ----
  const pond = new THREE.Mesh(new THREE.CircleGeometry(1, 48), track(new THREE.MeshStandardMaterial({ color: "#4f7f95", roughness: 0.08, metalness: 0.2 })));
  pond.scale.set(Math.min(90, frame.S * 0.3), Math.min(36, frame.R * 0.25), 1);
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(-frame.S * 0.15, frame.groundHeight(-frame.S * 0.15, 0) - 0.05, 0);
  group.add(pond);

  // ---- 木々（外周と内馬場） ----
  {
    const r = rng(7);
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 4, 6);
    trunkGeo.translate(0, 2, 0);
    const crownGeo = new THREE.IcosahedronGeometry(3.2, opt.quality === "high" ? 1 : 0);
    crownGeo.translate(0, 6.2, 0);
    const count = opt.quality === "high" ? 520 : 240;
    const trunks = new THREE.InstancedMesh(trunkGeo, track(new THREE.MeshStandardMaterial({ color: "#5b4636", roughness: 1 })), count);
    const crowns = new THREE.InstancedMesh(crownGeo, track(new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true })), count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    let k = 0;
    let guard = 0;
    while (k < count && guard++ < count * 20) {
      // 外周の帯か、内馬場
      const inField = r() < 0.18;
      const a = r() * Math.PI * 2;
      const rad = inField ? r() * 0.7 : 1.08 + r() * 0.35;
      const x = Math.cos(a) * (frame.S / 2 + frame.R) * rad * (inField ? 0.8 : 1);
      const z = Math.sin(a) * frame.R * rad * (inField ? 0.7 : 1);
      const n = frame.nearest(x, z);
      // 外周の木は、中継カメラの通り道（外ラチから 60m まで）を避ける
      if (inField ? n.lateral > -18 : n.lateral < W + 70) continue;
      // スタンドの前後は避ける
      if (!inField && Math.abs(x - xc) < standLen / 2 + 20 && z * zs > 0) continue;
      if (inField && Math.abs(x - scx) < 40 && Math.abs(z - zs * scz) < 25) continue;
      const s = 0.7 + r() * 0.8;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
      m.compose(new THREE.Vector3(x, frame.groundHeight(x, z) - 0.2, z), q, new THREE.Vector3(s, s * (0.9 + r() * 0.5), s));
      trunks.setMatrixAt(k, m);
      crowns.setMatrixAt(k, m);
      crowns.setColorAt(k, col.setHSL(0.27 + r() * 0.07, 0.42 + r() * 0.2, 0.22 + r() * 0.12));
      k++;
    }
    trunks.count = crowns.count = k;
    crowns.castShadow = opt.quality === "high";
    group.add(trunks, crowns);
  }

  // ---- 遠くの山並み ----
  {
    const pts = 96;
    const pos: number[] = [];
    const idx: number[] = [];
    const r = rng(99);
    const R0 = 2600;
    for (let i = 0; i <= pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const hgt = 90 + 160 * Math.abs(Math.sin(a * 3.1 + 1)) * (0.6 + 0.4 * r()) + 60 * r();
      pos.push(Math.cos(a) * R0, -2, Math.sin(a) * R0, Math.cos(a) * R0, hgt, Math.sin(a) * R0);
      if (i < pts) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const hills = new THREE.Mesh(g, track(new THREE.MeshBasicMaterial({ color: "#7d97a6", side: THREE.DoubleSide, fog: true })));
    group.add(hills);
  }

  // ---- 発馬機 ----
  const gate = startingGate(frame, opt.startS, opt.runners);
  group.add(gate.group);

  return {
    group,
    frame,
    screen,
    update: (t) => gate.update(t),
    dispose: () => {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      disposables.forEach((d) => d.dispose());
    },
  };
}
