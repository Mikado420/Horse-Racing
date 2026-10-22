// 出走馬1頭（馬・騎手・ゼッケン・走りの制御）をまとめたもの
import * as THREE from "three";
import { BODY_ORIGIN } from "./horseAnatomy";
import { createHorse, type HorseRig } from "./horseModel";
import { GallopController, type Lead } from "./gait";
import { SILKS, jockeyAssets, jockeyMaterial, saddleCloth } from "./jockey";

/** 騎手の体の揺れを支点（鞍の上）で打ち消すための位置 */
const SADDLE: [number, number] = [0.14, 1.6];
/** 騎手の形を基本位置からずらす量（鞍に近づける） */
const JOCKEY_SHIFT: [number, number] = [0.04, -0.1];

export interface Runner {
  rig: HorseRig;
  gait: GallopController;
  /** 世界の中での位置・向き（+x が前） */
  root: THREE.Group;
  setLod: (i: number) => void;
  update: (dt: number, speed: number) => void;
  setLead: (l: Lead) => void;
  dispose: () => void;
}

export function createRunner(horseId: string, number: number, cloth: { bg: string; fg: string }, silkIndex: number, shadows: boolean): Runner {
  const rig = createHorse(horseId, shadows);
  const gait = new GallopController(rig);
  const silk = SILKS[silkIndex % SILKS.length];
  const jm = jockeyMaterial(...silk);
  const jockeys = jockeyAssets().map((a, i) => {
    const m = new THREE.Mesh(a.geometry, jm);
    m.castShadow = shadows && i === 0;
    m.visible = i === 0;
    m.position.set(-(SADDLE[0] - BODY_ORIGIN[0]) + JOCKEY_SHIFT[0], -(SADDLE[1] - BODY_ORIGIN[1]) + JOCKEY_SHIFT[1], 0);
    return m;
  });
  // 支点（鞍）を胴の骨に付け、その下に騎手を置く
  const pivot = new THREE.Group();
  pivot.position.set(SADDLE[0] - BODY_ORIGIN[0], SADDLE[1] - BODY_ORIGIN[1], 0);
  jockeys.forEach((j) => pivot.add(j));
  rig.body.add(pivot);
  const clothGroup = saddleCloth(number, cloth.bg, cloth.fg);
  rig.body.add(clothGroup);
  const root = rig.group;
  let lod = 0;
  let t = Math.random() * 10;
  return {
    rig,
    gait,
    root,
    setLod: (i) => {
      if (i === lod) return;
      lod = i;
      rig.setLod(i);
      jockeys[0].visible = i === 0;
      jockeys[1].visible = i !== 0;
      clothGroup.visible = i < 2;
    },
    setLead: (l) => gait.setLead(l),
    update: (dt, speed) => {
      gait.update(dt, speed);
      // 騎手は胴の上下・前後の揺れを脚で吸収する（7割ほど打ち消す）
      t += dt;
      const bob = rig.body.position.y - BODY_ORIGIN[1];
      pivot.rotation.z = -rig.body.rotation.z * 0.75;
      pivot.position.y = SADDLE[1] - BODY_ORIGIN[1] - bob * 0.6 + Math.sin(t * 9) * 0.004;
    },
    dispose: () => {
      jm.dispose();
      clothGroup.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          const mat = m.material as THREE.MeshStandardMaterial;
          mat.map?.dispose();
          mat.dispose();
        }
      });
    },
  };
}
