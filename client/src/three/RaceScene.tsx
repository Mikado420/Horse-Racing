// 3D競馬場とレース再生（仮モデル）。サーバーから届いたフレームを時刻に合わせて補間して動かすだけで、
// 着順の計算は一切しない。
import { forwardRef, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { DEFAULT_COURSE, distancesAt, trackPoint, type CourseDef, type RaceStartMsg } from "@owners/shared";
import { gateColor } from "../format";

export type CameraMode = "follow" | "mine" | "overview";

interface Props {
  race: RaceStartMsg;
  serverNow: () => number;
  camera: CameraMode;
  highlight: number;
  /** 描画品質（low は影なし・等倍解像度で軽くする） */
  quality?: "high" | "low";
}

export function RaceScene({ race, serverNow, camera, highlight, quality = "high" }: Props) {
  // Canvas は親要素の大きさに追従し、回転・サイズ変更時に描画サイズとカメラの縦横比を更新する
  return (
    <Canvas
      className="race-canvas"
      shadows={quality === "high"}
      dpr={quality === "high" ? [1, 2] : 1}
      camera={{ fov: 45, near: 0.5, far: 2000, position: [0, 80, 260] }}
      resize={{ debounce: 120 }}
    >
      <color attach="background" args={["#BFD9E8"]} />
      <fog attach="fog" args={["#BFD9E8", 300, 900]} />
      <hemisphereLight args={["#EAF4FF", "#4C6B3A", 0.9]} />
      <directionalLight
        position={[120, 200, 80]}
        intensity={1.4}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-300}
        shadow-camera-right={300}
        shadow-camera-top={300}
        shadow-camera-bottom={-300}
      />
      <Course course={race.course ?? DEFAULT_COURSE} />
      <Runners race={race} serverNow={serverNow} camera={camera} highlight={highlight} />
      <AspectSync />
    </Canvas>
  );
}

/** 回転などで表示領域が変わったとき、カメラの縦横比を確実に更新する */
function AspectSync() {
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    if (cam.isPerspectiveCamera && size.height > 0) {
      cam.aspect = size.width / size.height;
      // 縦長の画面ではコースが切れないよう少し広角にする
      cam.fov = size.width < size.height ? 60 : 45;
      cam.updateProjectionMatrix();
    }
  }, [camera, size.width, size.height]);
  return null;
}

/** コース：芝の帯・内外ラチ・ゴール板・残り距離標識・スタンド */
function Course({ course }: { course: CourseDef }) {
  const turf = useMemo(() => ribbon(course, -1, course.trackWidth + 1, 4), [course]);
  const innerRail = useMemo(() => railLine(course, -0.6), [course]);
  const outerRail = useMemo(() => railLine(course, course.trackWidth + 0.6), [course]);
  const markers = useMemo(() => {
    const list: { s: number; label: string }[] = [];
    for (let remain = course.distance - 200; remain >= 200; remain -= 200) {
      // ゴール板を位置0とする内ラチ上の位置（ゴールまで remain の地点）
      list.push({ s: -remain, label: String(remain) });
    }
    return list;
  }, [course]);
  const finish = trackPoint(course, 0, -2);
  const stand = trackPoint(course, -course.straightLength / 2, course.trackWidth + 34);

  return (
    <group>
      {/* 地面 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
        <planeGeometry args={[2000, 2000]} />
        <meshLambertMaterial color="#5E8C4E" />
      </mesh>
      {/* 走路 */}
      <mesh geometry={turf} position={[0, 0.01, 0]} receiveShadow>
        <meshLambertMaterial color={course.surface === "dirt" ? "#A9825A" : "#3E9A52"} side={THREE.DoubleSide} />
      </mesh>
      <primitive object={innerRail} />
      <primitive object={outerRail} />
      {/* ゴールライン */}
      <GoalLine course={course} />
      {/* ゴール板 */}
      <group position={[finish.x, 0, finish.z]}>
        <mesh position={[0, 3, 0]} castShadow>
          <cylinderGeometry args={[0.15, 0.15, 6, 8]} />
          <meshLambertMaterial color="#FFFFFF" />
        </mesh>
        <mesh position={[0, 6.4, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[1.1, 1.1, 0.15, 24]} />
          <meshLambertMaterial color="#B3203A" />
        </mesh>
      </group>
      {markers.map((m) => (
        <DistanceMarker key={m.s} course={course} s={m.s} label={m.label} />
      ))}
      {/* スタンド（仮） */}
      <group position={[stand.x, 0, stand.z]}>
        <mesh position={[0, 6, 0]} castShadow receiveShadow>
          <boxGeometry args={[course.straightLength * 0.8, 12, 18]} />
          <meshLambertMaterial color="#D9D4C7" />
        </mesh>
        <mesh position={[0, 13, -2]}>
          <boxGeometry args={[course.straightLength * 0.82, 1, 24]} />
          <meshLambertMaterial color="#14213D" />
        </mesh>
      </group>
    </group>
  );
}

function ribbon(course: CourseDef, inner: number, outer: number, step: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const n = Math.ceil(course.lapLength / step);
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * course.lapLength;
    const a = trackPoint(course, s, inner);
    const b = trackPoint(course, s, outer);
    pos.push(a.x, 0, a.z, b.x, 0, b.z);
    if (i < n) {
      const k = i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function railLine(course: CourseDef, lateral: number): THREE.Line {
  const pts: THREE.Vector3[] = [];
  for (let s = 0; s <= course.lapLength; s += 4) {
    const p = trackPoint(course, s, lateral);
    pts.push(new THREE.Vector3(p.x, 1.1, p.z));
  }
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.Line(g, new THREE.LineBasicMaterial({ color: "#FFFFFF" }));
}

function GoalLine({ course }: { course: CourseDef }) {
  const a = trackPoint(course, 0, -1);
  const b = trackPoint(course, 0, course.trackWidth + 1);
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  return (
    <mesh position={[(a.x + b.x) / 2, 0.02, (a.z + b.z) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[0.5, len]} />
      <meshBasicMaterial color="#FFFFFF" />
    </mesh>
  );
}

function makeLabelTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = "#14213D";
  ctx.font = "bold 40px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 64, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function DistanceMarker({ course, s, label }: { course: CourseDef; s: number; label: string }) {
  const p = trackPoint(course, s, -2.5);
  const tex = useMemo(() => makeLabelTexture(label), [label]);
  return (
    <group position={[p.x, 0, p.z]}>
      <mesh position={[0, 1.5, 0]}>
        <cylinderGeometry args={[0.1, 0.1, 3, 6]} />
        <meshLambertMaterial color="#FFFFFF" />
      </mesh>
      <sprite position={[0, 3.6, 0]} scale={[3, 1.5, 1]}>
        <spriteMaterial map={tex} />
      </sprite>
    </group>
  );
}

/** 出走馬（仮モデル）とカメラ制御 */
function Runners({ race, serverNow, camera, highlight }: Props) {
  const groups = useRef<(THREE.Group | null)[]>([]);
  const legs = useRef<(THREE.Object3D | null)[][]>([]);
  const prevDist = useRef<number[]>([]);
  const camTarget = useRef(new THREE.Vector3(0, 0, 0));
  const { camera: cam } = useThree();
  const course = race.course ?? DEFAULT_COURSE;
  const n = race.runners.length;
  // 走行距離 d（スタートから）→ 内ラチ上の位置（ゴール板が0）
  const railS = (d: number) => d - race.distance;

  // 内ラチからの位置：計算結果があればそれを使い、なければ枠順から序盤で内へ寄せる
  const lanesNow = useRef<number[]>([]);
  const laneAt = (i: number, d: number) => {
    if (race.lanes) return lanesNow.current[i] ?? 1;
    const settle = Math.min(1, Math.max(0, d / 450));
    const spacing = 1.6 * (1 - 0.45 * settle * settle * (3 - 2 * settle));
    return 1.2 + i * spacing;
  };

  useFrame((state, delta) => {
    const t = Math.max(0, ((serverNow() - race.startAt) / 1000) * race.replaySpeed);
    const dist = distancesAt(race.frames, race.sampleDt, t);
    if (race.lanes) lanesNow.current = distancesAt(race.lanes, race.sampleDt, t);
    let leader = 0;
    for (let i = 0; i < n; i++) {
      const g = groups.current[i];
      if (!g) continue;
      const d = dist[i];
      const p = trackPoint(course, railS(d), laneAt(i, d));
      g.position.set(p.x, 0, p.z);
      g.rotation.y = -p.heading;
      // 脚の動き：速度に応じて回転
      const speed = Math.max(0, (d - (prevDist.current[i] ?? d)) / Math.max(delta, 1e-3));
      prevDist.current[i] = d;
      const phase = state.clock.elapsedTime * (2 + speed * 0.45) + i * 0.7;
      const swing = Math.min(0.9, speed * 0.03);
      legs.current[i]?.forEach((leg, k) => {
        if (leg) leg.rotation.z = Math.sin(phase + (k % 2 === 0 ? 0 : Math.PI) + (k < 2 ? 0.4 : 0)) * swing;
      });
      g.position.y = Math.abs(Math.sin(phase)) * swing * 0.25;
      if (d > dist[leader]) leader = i;
    }

    // カメラ
    const focusIdx = camera === "mine" && highlight >= 0 ? highlight : leader;
    const fd = dist[focusIdx] ?? 0;
    const fp = trackPoint(course, railS(fd), laneAt(focusIdx, fd));
    const k = 1 - Math.exp(-delta * 2.5);
    if (camera === "overview") {
      camTarget.current.lerp(new THREE.Vector3(0, 0, 0), k);
      cam.position.lerp(new THREE.Vector3(0, 230, 330), k);
    } else {
      const outward = trackPoint(course, railS(fd), laneAt(focusIdx, fd) + 30);
      const dirX = Math.cos(fp.heading);
      const dirZ = Math.sin(fp.heading);
      const desired = new THREE.Vector3(outward.x - dirX * 14, 11, outward.z - dirZ * 14);
      camTarget.current.lerp(new THREE.Vector3(fp.x + dirX * 6, 1.5, fp.z + dirZ * 6), k);
      cam.position.lerp(desired, k);
    }
    cam.lookAt(camTarget.current);
  });

  return (
    <group>
      {race.runners.map((r, i) => (
        <HorseModel
          key={r.horseId}
          gate={r.gate}
          highlighted={i === highlight}
          ref={(g) => (groups.current[i] = g)}
          legRefs={(arr) => (legs.current[i] = arr)}
        />
      ))}
    </group>
  );
}


interface HorseModelProps {
  gate: number;
  highlighted: boolean;
  legRefs: (legs: (THREE.Object3D | null)[]) => void;
}

/** 仮の馬モデル（+x 方向を向く）。胴・首・頭・脚4本・騎手・ゼッケン色の鞍下 */
const HorseModel = forwardRef<THREE.Group, HorseModelProps>(function HorseModel({ gate, highlighted, legRefs }, ref) {
  const color = gateColor(gate);
  const legs = useRef<(THREE.Object3D | null)[]>([null, null, null, null]);
  const coat = ["#6B3E26", "#3B2A20", "#8A5A35", "#2B2B2B"][gate % 4];
  const setLeg = (k: number) => (o: THREE.Object3D | null) => {
    legs.current[k] = o;
    legRefs(legs.current);
  };
  const legPos: [number, number][] = [
    [0.75, 0.22],
    [0.75, -0.22],
    [-0.75, 0.22],
    [-0.75, -0.22],
  ];
  return (
    <group ref={ref}>
      {/* 胴 */}
      <mesh position={[0, 1.55, 0]} castShadow>
        <boxGeometry args={[2.0, 0.75, 0.62]} />
        <meshLambertMaterial color={coat} />
      </mesh>
      {/* 首と頭 */}
      <mesh position={[1.15, 2.05, 0]} rotation={[0, 0, -0.75]} castShadow>
        <boxGeometry args={[0.95, 0.38, 0.34]} />
        <meshLambertMaterial color={coat} />
      </mesh>
      <mesh position={[1.55, 2.35, 0]} rotation={[0, 0, 0.35]} castShadow>
        <boxGeometry args={[0.62, 0.3, 0.3]} />
        <meshLambertMaterial color={coat} />
      </mesh>
      {/* 脚（付け根を回転軸にする） */}
      {legPos.map(([x, z], k) => (
        <group key={k} position={[x, 1.25, z]} ref={setLeg(k)}>
          <mesh position={[0, -0.6, 0]} castShadow>
            <boxGeometry args={[0.16, 1.2, 0.16]} />
            <meshLambertMaterial color={coat} />
          </mesh>
        </group>
      ))}
      {/* 尾 */}
      <mesh position={[-1.15, 1.6, 0]} rotation={[0, 0, 0.9]}>
        <boxGeometry args={[0.5, 0.12, 0.12]} />
        <meshLambertMaterial color="#1E1A17" />
      </mesh>
      {/* 鞍下（ゼッケン色） */}
      <mesh position={[0.05, 1.95, 0]}>
        <boxGeometry args={[0.8, 0.06, 0.72]} />
        <meshLambertMaterial color={color.bg} />
      </mesh>
      {/* 騎手（勝負服＝ゼッケン色） */}
      <mesh position={[0.15, 2.35, 0]} castShadow>
        <boxGeometry args={[0.45, 0.6, 0.4]} />
        <meshLambertMaterial color={color.bg} />
      </mesh>
      <mesh position={[0.3, 2.78, 0]} castShadow>
        <sphereGeometry args={[0.17, 12, 10]} />
        <meshLambertMaterial color={highlighted ? "#E7B526" : "#F4F4EE"} />
      </mesh>
      {/* 自分の馬の目印 */}
      {highlighted && (
        <mesh position={[0, 4.2, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.35, 0.7, 4]} />
          <meshBasicMaterial color="#E7B526" />
        </mesh>
      )}
    </group>
  );
});
