// レース観戦の3D世界。レース計算の結果（各馬の走行距離と進路）を時刻に合わせて再生するだけで、
// 着順や速度の計算はしない。three.js を直接使い、React からは RaceScene.tsx で包んで使う。
import * as THREE from "three";
import { DEFAULT_COURSE, distancesAt, type RaceStartMsg } from "@owners/shared";
import { gateColor } from "../format";
import { buildCourse, type CourseScene } from "./course/buildCourse";
import { SUN_DIR, environmentFrom, skyDome, skyLook, type WeatherKind } from "./course/sky";
import { blobTexture } from "./course/textures";
import type { TrackFrame } from "./course/trackFrame";
import { createRunner, type Runner } from "./model/runner";

export type CameraMode = "follow" | "mine" | "overview";
export type Quality = "high" | "low";

interface RunnerState {
  runner: Runner;
  /** 左右に並べた入れ物（向き・傾き） */
  yaw: THREE.Group;
  finishT: number | null;
  finishV: number;
  lastV: number;
}

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

export class RaceWorld {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.3, 6000);
  private screenCam = new THREE.PerspectiveCamera(22, 44 / 16, 0.5, 2000);
  private screenTarget: THREE.WebGLRenderTarget | null = null;
  private sun: THREE.DirectionalLight;
  private course: CourseScene;
  private frame: TrackFrame;
  private runners: RunnerState[] = [];
  private blobs: THREE.InstancedMesh;
  private marker: THREE.Mesh;
  private rain: THREE.LineSegments | null = null;
  private race: RaceStartMsg;
  private serverNow: () => number;
  private mode: CameraMode = "follow";
  private highlight = -1;
  private camTarget = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private camFov = 32;
  private lastT: number | null = null;
  private lastFrame = performance.now();
  private frameNo = 0;
  private ro: ResizeObserver;
  private disposed = false;
  readonly quality: Quality;

  constructor(private container: HTMLElement, race: RaceStartMsg, serverNow: () => number, quality: Quality, opts: { preserveDrawingBuffer?: boolean } = {}) {
    this.race = race;
    this.serverNow = serverNow;
    this.quality = quality;
    const high = quality === "high";
    this.renderer = new THREE.WebGLRenderer({ antialias: high, powerPreference: "high-performance", preserveDrawingBuffer: !!opts.preserveDrawingBuffer });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = high;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = "race-canvas";
    container.appendChild(this.renderer.domElement);

    // ---- 空・光 ----
    const weather = (race.weather ?? "sunny") as WeatherKind;
    const look = skyLook(weather);
    this.scene.add(skyDome(look));
    this.scene.environment = environmentFrom(this.renderer, look);
    this.scene.fog = new THREE.FogExp2(look.fog, look.fogDensity);
    this.scene.add(new THREE.HemisphereLight(look.top.clone().lerp(new THREE.Color("#ffffff"), 0.5), look.ground, look.hemiIntensity * 0.6));
    this.sun = new THREE.DirectionalLight(look.sun, look.sunIntensity);
    this.sun.castShadow = high;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 10, far: 400 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    // ---- 競馬場 ----
    const course = race.course ?? DEFAULT_COURSE;
    const startS = -race.distance;
    this.course = buildCourse(course, { runners: race.runners.length, going: race.going, quality, startS });
    this.frame = this.course.frame;
    this.scene.add(this.course.group);

    // ---- 出走馬 ----
    race.runners.forEach((r) => {
      const c = gateColor(r.gate);
      const runner = createRunner(r.horseId, r.gate, c, r.gate - 1, high);
      const yaw = new THREE.Group();
      yaw.add(runner.root);
      this.scene.add(yaw);
      this.runners.push({ runner, yaw, finishT: null, finishV: 0, lastV: 0 });
    });
    // 足元の柔らかい影（影の計算をしないときや遠くの馬にも）
    const blobGeo = new THREE.PlaneGeometry(3.4, 1.4);
    blobGeo.rotateX(-Math.PI / 2);
    this.blobs = new THREE.InstancedMesh(blobGeo, new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: high ? 0.55 : 0.85 }), this.runners.length);
    this.blobs.renderOrder = 1;
    this.scene.add(this.blobs);
    // 自分の馬の目印（金色の逆三角）
    this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.6, 4), new THREE.MeshBasicMaterial({ color: "#e7b526", fog: false }));
    this.marker.rotation.x = Math.PI;
    this.marker.visible = false;
    this.scene.add(this.marker);

    if (weather === "rain") this.rain = this.makeRain();

    // 大型ビジョンへの中継映像（高品質のときだけ）
    if (high) {
      this.screenTarget = new THREE.WebGLRenderTarget(512, 186, { samples: 0 });
      (this.course.screen.material as THREE.MeshBasicMaterial).map = this.screenTarget.texture;
      (this.course.screen.material as THREE.MeshBasicMaterial).color.set("#ffffff");
      (this.course.screen.material as THREE.MeshBasicMaterial).needsUpdate = true;
    }

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.placeCameraInitially();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  /** 描画を止める／1コマだけ進める（確認用。dt は秒） */
  setPaused(p: boolean) {
    this.renderer.setAnimationLoop(p ? null : () => this.tick());
  }
  step(dt: number) {
    this.lastFrame = performance.now() - dt * 1000;
    this.tick();
  }
  private snapCam = false;
  /** 次のコマでカメラを目標位置へ一気に動かす（再生位置を飛ばしたとき） */
  snapCamera() {
    this.snapCam = true;
  }
  /** 今の画面を画像にする（確認用） */
  snapshot(): string {
    return this.renderer.domElement.toDataURL("image/jpeg", 0.9);
  }

  setRace(race: RaceStartMsg) {
    this.race = race;
  }
  setCamera(mode: CameraMode) {
    this.mode = mode;
  }
  setHighlight(i: number) {
    this.highlight = i;
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    this.course.dispose();
    this.runners.forEach((r) => r.runner.dispose());
    this.screenTarget?.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** 再生時刻（発走からの秒、発走前は負） */
  private raceTime(): number {
    return ((this.serverNow() - this.race.startAt) / 1000) * this.race.replaySpeed;
  }

  private makeRain(): THREE.LineSegments {
    const n = 1800;
    const pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * 80;
      const y = Math.random() * 40;
      const z = (Math.random() - 0.5) * 80;
      pos.set([x, y, z, x + 0.05, y - 0.9, z], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: "#c9d3da", transparent: true, opacity: 0.35 }));
    l.frustumCulled = false;
    this.scene.add(l);
    return l;
  }

  private placeCameraInitially() {
    const p = this.frame.point(-this.race.distance + 6, this.frame.width + 26);
    this.camPos.set(p.x, p.y + 6, p.z);
    const g = this.frame.point(-this.race.distance, this.race.runners.length * 0.6);
    this.camTarget.set(g.x, g.y + 1.2, g.z);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  private tick() {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const t = this.raceTime();
    const simDt = this.lastT === null ? 0 : Math.max(0, t - this.lastT);
    this.lastT = t;
    const race = this.race;
    const tc = Math.max(0, t);
    const dist = distancesAt(race.frames, race.sampleDt, tc);
    const distA = distancesAt(race.frames, race.sampleDt, Math.max(0, tc - 0.15));
    const distB = distancesAt(race.frames, race.sampleDt, tc + 0.15);
    const lanes = race.lanes ? distancesAt(race.lanes, race.sampleDt, tc) : null;
    const D = race.distance;
    const frame = this.frame;
    const n = this.runners.length;
    const blobM = new THREE.Matrix4();
    let leader = 0;
    let leaderD = -1;
    const positions: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const st = this.runners[i];
      let d = dist[i] ?? 0;
      let v = t <= 0 ? 0 : Math.max(0, ((distB[i] ?? d) - (distA[i] ?? d)) / 0.3);
      // ゴール後：計算はゴールで止まるので、描画では惰性で走り抜けて減速する
      if (d >= D - 0.01 && t > 0) {
        if (st.finishT === null || t < st.finishT) {
          st.finishT = t;
          st.finishV = Math.max(st.lastV, 12);
        }
        const tau = 5;
        const e = t - st.finishT;
        d = D + st.finishV * tau * (1 - Math.exp(-e / tau));
        v = st.finishV * Math.exp(-e / tau);
      } else {
        st.finishT = null;
        if (v > 1) st.lastV = v;
      }
      const lane = lanes ? (lanes[i] ?? 1) : 0.8 + i * 1.25;
      const s = d - D;
      const p = frame.point(s, lane);
      st.yaw.position.set(p.x, p.y, p.z);
      st.yaw.rotation.set(0, -p.heading, 0);
      // コーナーでは内側へ傾く（遠心力）。坂では前後に傾く
      const lean = p.turn !== 0 ? Math.min(0.2, (v * v) / (9.8 * (frame.R + lane))) * p.turn : 0;
      const root = st.runner.root;
      root.rotation.set(-lean, 0, p.grade, "XZY");
      // 手前：コーナーは内側の脚。最後の直線の途中で手前を替える
      const remain = D - d;
      if (p.turn !== 0) st.runner.setLead(p.turn > 0 ? "L" : "R");
      else if (remain < 330 && remain > 0) st.runner.setLead(frame.mirror ? "L" : "R");
      st.runner.update(Math.min(0.25, simDt), v);
      blobM.makeTranslation(p.x, p.y + 0.04, p.z);
      blobM.multiply(new THREE.Matrix4().makeRotationY(-p.heading));
      this.blobs.setMatrixAt(i, blobM);
      positions.push(new THREE.Vector3(p.x, p.y, p.z));
      if (d > leaderD) {
        leaderD = d;
        leader = i;
      }
    }
    this.blobs.instanceMatrix.needsUpdate = true;
    this.course.update(t);

    // ---- カメラ ----
    const focusIdx = this.mode === "mine" && this.highlight >= 0 ? this.highlight : leader;
    const fd = Math.min(D + 40, dist[focusIdx] ?? 0);
    this.updateCamera(t, dt, fd, focusIdx, positions, leader, dist);

    // 自分の馬の目印
    if (this.highlight >= 0 && positions[this.highlight]) {
      this.marker.visible = true;
      this.marker.position.copy(positions[this.highlight]).add(tmpV.set(0, 3.4 + Math.sin(now / 250) * 0.08, 0));
      this.marker.rotation.y += dt * 2;
    }

    // ---- 細かさ：カメラに近い馬ほど細かく（細かい形は近い6頭まで） ----
    const order = positions.map((p, i) => ({ i, d: p.distanceTo(this.camera.position) })).sort((a, b) => a.d - b.d);
    order.forEach(({ i, d }, rank) => {
      const lod = d < 32 && rank < 4 ? 0 : d < 110 ? 1 : 2;
      this.runners[i].runner.setLod(this.quality === "low" ? Math.max(1, lod) : lod);
    });

    // ---- 影はカメラの見ている所の周りだけ計算する ----
    this.sun.position.copy(this.camTarget).addScaledVector(SUN_DIR, 200);
    this.sun.target.position.copy(this.camTarget);

    if (this.rain) {
      this.rain.position.set(this.camera.position.x, this.camera.position.y - 20, this.camera.position.z);
      const pos = this.rain.geometry.getAttribute("position") as THREE.BufferAttribute;
      const fall = dt * 30;
      for (let k = 0; k < pos.count; k += 2) {
        let y = pos.getY(k) - fall;
        if (y < 0) y += 40;
        pos.setY(k, y);
        pos.setY(k + 1, y - 0.9);
      }
      pos.needsUpdate = true;
    }

    // 大型ビジョン：先頭集団の寄りの映像（2フレームに1回）
    this.frameNo++;
    if (this.screenTarget && this.frameNo % 2 === 0 && positions[leader]) {
      const lp = positions[leader];
      const p = frame.point(Math.min(dist[leader] ?? 0, D + 30) - D + 14, frame.width + 10);
      this.screenCam.position.set(p.x, p.y + 5, p.z);
      this.screenCam.lookAt(lp.x, lp.y + 1.3, lp.z);
      this.marker.visible = false;
      this.course.screen.visible = false;
      this.renderer.setRenderTarget(this.screenTarget);
      this.renderer.render(this.scene, this.screenCam);
      this.renderer.setRenderTarget(null);
      this.course.screen.visible = true;
      this.marker.visible = this.highlight >= 0;
    }
    const tr = performance.now();
    this.renderer.render(this.scene, this.camera);
    const info = this.renderer.info.render;
    this.stats = { updateMs: +(tr - now).toFixed(2), renderMs: +(performance.now() - tr).toFixed(2), calls: info.calls, triangles: info.triangles };
  }
  /** 確認用：直近のコマの処理時間と描画量 */
  stats: { updateMs: number; renderMs: number; calls: number; triangles: number } = { updateMs: 0, renderMs: 0, calls: 0, triangles: 0 };

  private updateCamera(t: number, dt: number, fd: number, focusIdx: number, positions: THREE.Vector3[], leader: number, dist: number[]) {
    const frame = this.frame;
    const D = this.race.distance;
    const portrait = this.camera.aspect < 1;
    const k = this.snapCam ? 1 : 1 - Math.exp(-dt * 3);
    let fov = 30;
    const focusLane = 4;
    // 先頭から5馬身ほどの集団の中心を見る
    const pack = positions.filter((_, i) => (dist[leader] ?? 0) - (dist[i] ?? 0) < 14);
    const center = pack.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, pack.length));
    if (t < 0) {
      // 発走前：ゲートを斜め前から
      const p = frame.point(-D + 16, frame.width + 12);
      tmpV.set(p.x, p.y + 8, p.z);
      const g = frame.point(-D, this.race.runners.length * 0.6);
      tmpV2.set(g.x, g.y + 1.4, g.z);
      fov = 38;
    } else if (this.mode === "overview") {
      // 上空から全体を追う
      const p = frame.point(fd - D - 30, -60);
      tmpV.set(p.x, p.y + 95, p.z);
      tmpV2.copy(center);
      fov = 42;
    } else if (this.mode === "mine" && this.highlight >= 0) {
      // 自分の馬の斜め後ろから
      const me = positions[focusIdx];
      const lane = this.lastLane(focusIdx) ?? focusLane;
      const p = frame.point(fd - D - 13, lane + 6);
      tmpV.set(p.x, p.y + 4.2, p.z);
      const ahead = frame.point(fd - D + 8, lane);
      tmpV2.set(me.x * 0.6 + ahead.x * 0.4, me.y + 1.5, me.z * 0.6 + ahead.z * 0.4);
      fov = 46;
    } else {
      const remain = D - (dist[leader] ?? 0);
      if (remain < 45 && remain > -45) {
        // ゴール前：スタンドからゴール板を真横に見る（中継のゴールの絵）
        const g = frame.point(3, frame.width + 14);
        tmpV.set(g.x, g.y + 8, g.z);
        tmpV2.copy(center);
        tmpV2.y += 1.2;
        fov = 24;
      } else {
        // 中継：外ラチの外の高い所から、集団を横に見ながら並走する
        // ホームストレッチはスタンドの上から、それ以外は外ラチの外のやぐらから
        const sNow = fd - D;
        const L = frame.L;
        const u = ((sNow % L) + L) % L;
        const home = u > L - frame.S - 10 || u < 30;
        const p = frame.point(sNow - 6, frame.width + (home ? 40 : 22));
        tmpV.set(p.x, p.y + (home ? 17 : 7.5), p.z);
        tmpV2.copy(center);
        tmpV2.y += 1.0;
        fov = 27;
      }
    }
    if (portrait) fov *= 1.55;
    this.camPos.lerp(tmpV, k);
    this.camTarget.lerp(tmpV2, this.snapCam ? 1 : 1 - Math.exp(-dt * 6));
    this.snapCam = false;
    this.camFov += (fov - this.camFov) * k;
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
    if (Math.abs(this.camera.fov - this.camFov) > 0.01) {
      this.camera.fov = this.camFov;
      this.camera.updateProjectionMatrix();
    }
  }

  private lastLane(i: number): number | null {
    const r = this.race;
    if (!r.lanes) return null;
    const t = Math.max(0, this.raceTime());
    return distancesAt(r.lanes, r.sampleDt, t)[i] ?? null;
  }
}
