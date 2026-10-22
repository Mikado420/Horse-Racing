// 襲歩（ギャロップ）の動き。速度から歩幅と1秒あたりの完歩数を決め、4本の脚を順に着地させる。
//
// ・足順は交叉襲歩（サラブレッドの競走での走り方）。左手前なら 右後 → 左後 → 右前 → 左前 → 4本とも浮く。
// ・着地している脚の蹄は、胴に対して「いまの速度」で後ろへ動かす。完歩の周期が 歩幅÷速度 なので、
//   蹄は地面に対して止まって見える（脚が地面を滑らない）。
// ・各脚の関節角は逆運動学で求める（肩・股の角度を決め、残り2つの骨を蹄の位置に届くように曲げる）。
//   前脚は前膝が前に、後脚は飛節が後ろに出る向きに曲げる（馬の関節の曲がる向き）。
// ・胴は着地ごとに上下し、前後に揺れる。首と頭は前脚の着地に合わせてうなずく。尾は速さに応じてなびく。
import { FRONT, HIND, BODY_ORIGIN } from "./horseAnatomy";
import type { HorseRig } from "./horseModel";

export type Lead = "L" | "R";
export type LegId = "fL" | "fR" | "hL" | "hR";

/** 速度 v(m/秒) での1完歩の長さ(m)。全力（約17m/秒）で約7m */
export function strideLength(v: number): number {
  return Math.max(2.4, Math.min(7.4, 2.2 + 0.29 * v));
}
/** 1本の脚が地面に着いている時間の割合（速いほど短い） */
export function dutyFactor(v: number): number {
  return Math.max(0.2, Math.min(0.42, 0.39 - 0.0095 * v));
}

/** 左手前のときの各脚の着地のタイミング（完歩に対する割合） */
const OFFSETS_LEFT_LEAD: Record<LegId, number> = { hR: 0, hL: 0.12, fR: 0.33, fL: 0.45 };
const mirror = (o: Record<LegId, number>): Record<LegId, number> => ({ hL: o.hR, hR: o.hL, fL: o.fR, fR: o.fL });
const OFFSETS_RIGHT_LEAD = mirror(OFFSETS_LEFT_LEAD);

const ang = (dx: number, dy: number) => Math.atan2(dy, dx);
const len = (dx: number, dy: number) => Math.sqrt(dx * dx + dy * dy);
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** 角度の差を -π〜π に */
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

interface LegGeom {
  front: boolean;
  /** 付け根の関節（肩関節・股関節）の基本位置 */
  root: [number, number];
  /** 上の骨（上腕・大腿）の長さと基本角度 */
  l0: number;
  a0: number;
  l1: number;
  a1: number;
  l2: number;
  a2: number;
  /** 繋（球節→蹄冠）の長さと基本角度 */
  lp: number;
  ap: number;
  /** 蹄（蹄冠→底）の長さと基本角度 */
  lh: number;
  ah: number;
  /** 基本姿勢での蹄底の x */
  soleX: number;
  bones: [string, string, string, string, string];
}

function legGeom(front: boolean, side: "L" | "R"): LegGeom {
  const J = front ? FRONT : HIND;
  const pts = front
    ? [FRONT.shoulder, FRONT.elbow, FRONT.knee, FRONT.fetlock, FRONT.coronet, FRONT.sole]
    : [HIND.hip, HIND.stifle, HIND.hock, HIND.fetlock, HIND.coronet, HIND.sole];
  const seg = (i: number) => [pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]] as const;
  const [s0, s1, s2, s3, s4] = [0, 1, 2, 3, 4].map(seg);
  const p = front ? "f" : "h";
  return {
    front,
    root: [pts[0][0], pts[0][1]],
    l0: len(...s0),
    a0: ang(...s0),
    l1: len(...s1),
    a1: ang(...s1),
    l2: len(...s2),
    a2: ang(...s2),
    lp: len(...s3),
    ap: ang(...s3),
    lh: len(...s4),
    ah: ang(...s4),
    soleX: J.sole[0],
    bones: front ? [`fu${side}`, `ff${side}`, `fc${side}`, `fp${side}`, `fh${side}`] : [`hu${side}`, `hl${side}`, `hc${side}`, `hp${side}`, `hh${side}`],
  };
}

const LEGS: Record<LegId, LegGeom> = { fL: legGeom(true, "L"), fR: legGeom(true, "R"), hL: legGeom(false, "L"), hR: legGeom(false, "R") };

export interface LegTarget {
  /** 蹄底の位置（馬の座標、x は前、y は高さ） */
  x: number;
  y: number;
  /** 着地しているか */
  stance: boolean;
  /** 体重のかかり具合（0〜1） */
  load: number;
  /** 遊脚中のたたみ具合（0〜1） */
  flex: number;
}

/** 位相 phase・速度 v・手前 lead のときの4本の蹄の位置（純粋な計算。確認やテストにも使う） */
export function legTargets(phase: number, v: number, lead: Lead): Record<LegId, LegTarget> {
  const run = smooth(clamp((v - 0.6) / 4, 0, 1));
  const L = strideLength(v);
  const duty = dutyFactor(v);
  const offs = lead === "L" ? OFFSETS_LEFT_LEAD : OFFSETS_RIGHT_LEAD;
  const sweep = duty * L * run; // 着地中に蹄が胴に対して後ろへ動く距離
  const out = {} as Record<LegId, LegTarget>;
  for (const id of Object.keys(LEGS) as LegId[]) {
    const g = LEGS[id];
    const t = (((phase - offs[id]) % 1) + 1) % 1; // この脚の着地からの経過（完歩に対する割合）
    // 着地点（付け根の真下より少し前）と離地点
    const td = g.soleX + sweep * (g.front ? 0.55 : 0.48);
    const lo = td - sweep;
    if (t < duty || run === 0) {
      const u = run === 0 ? 0.5 : t / duty;
      out[id] = { x: run === 0 ? g.soleX : td - sweep * u, y: 0, stance: true, load: Math.sin(Math.PI * u) * run, flex: 0 };
    } else {
      // 遊脚：離地点から着地点へ。脚をたたんで高く上げ、着地の直前に少し引き戻す
      const u = (t - duty) / (1 - duty);
      const reach = 0.06 * run;
      const e = smooth(clamp(u * 1.12, 0, 1));
      const x = lo + (td + reach - lo) * e - reach * smooth(clamp((u - 0.82) / 0.18, 0, 1));
      const lift = (g.front ? 0.5 : 0.42) * run * Math.min(1, sweep / 1.2);
      const hu = Math.sin(Math.PI * clamp(u * 1.08, 0, 1));
      const y = lift * Math.pow(hu, 0.75) * (u < 0.5 ? 1 : 1 - 0.25 * (u - 0.5));
      out[id] = { x, y, stance: false, load: 0, flex: Math.sin(Math.PI * clamp(u * 1.25, 0, 1)) * run };
    }
  }
  return out;
}

/** 完歩の位相を進める速さ（1秒あたりの完歩数） */
export function strideFrequency(v: number): number {
  return v / strideLength(v);
}

export class GallopController {
  private phase = Math.random();
  private lead: Lead = "L";
  private wantLead: Lead = "L";
  private vSmooth = 0;
  private tailSwing = 0;
  private readonly rig: HorseRig;

  constructor(rig: HorseRig, phase?: number) {
    this.rig = rig;
    if (phase !== undefined) this.phase = phase;
  }

  /** 手前（どちらの前脚を先に出すか）。コーナーでは内側の脚。切り替えは完歩の区切りで行う */
  setLead(l: Lead) {
    this.wantLead = l;
  }
  get currentLead(): Lead {
    return this.lead;
  }

  /** 指定の速度・位相の姿勢にすぐ合わせる（確認用・出走前の整列用） */
  snap(v: number, phase: number, lead: Lead = this.lead) {
    this.vSmooth = v;
    this.phase = phase;
    this.lead = this.wantLead = lead;
    this.update(0, v);
  }

  /** dt 秒進める。v は速度(m/秒) */
  update(dt: number, v: number) {
    this.vSmooth += (v - this.vSmooth) * Math.min(1, dt * 6);
    const vs = this.vSmooth;
    // 走っている度合い（止まっているときは立ち姿）
    const run = smooth(clamp((vs - 0.6) / 4, 0, 1));
    const L = strideLength(vs);
    const freq = run > 0 ? vs / L : 0;
    const prev = this.phase;
    this.phase = (this.phase + freq * dt) % 1;
    if (this.phase < prev && this.wantLead !== this.lead) this.lead = this.wantLead;
    const duty = dutyFactor(vs);
    const offs = this.lead === "L" ? OFFSETS_LEFT_LEAD : OFFSETS_RIGHT_LEAD;
    const ph = this.phase;
    const b = this.rig.bones;

    // ---- 胴：上下動と前後の揺れ ----
    // 前脚が着地している間は前が沈み、後脚で踏み切ると前が上がる。4本とも浮く間がいちばん高い
    const fore = (offs.fR + offs.fL) / 2 + duty / 2;
    const bob = run * (0.045 * Math.cos(2 * Math.PI * (ph - (fore + 0.5))) - 0.02);
    const pitch = run * 0.055 * Math.sin(2 * Math.PI * (ph - fore + 0.15));
    b.body.position.set(BODY_ORIGIN[0], BODY_ORIGIN[1] + bob, 0);
    b.body.rotation.z = pitch;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    // 胴の骨の座標 → 馬全体の座標
    const toGroup = (x: number, y: number): [number, number] => {
      const lx = x - BODY_ORIGIN[0];
      const ly = y - BODY_ORIGIN[1];
      return [BODY_ORIGIN[0] + lx * cp - ly * sp, BODY_ORIGIN[1] + bob + lx * sp + ly * cp];
    };

    // ---- 脚 ----
    const targets = legTargets(ph, vs, this.lead);
    for (const id of Object.keys(LEGS) as LegId[]) {
      const tg = targets[id];
      this.solveLeg(LEGS[id], tg.x, tg.y, tg.load, tg.flex, toGroup, pitch);
    }

    // ---- 首・頭：前脚の着地に合わせてうなずく。走るときは首を前に伸ばす ----
    const nod = run * 0.07 * Math.sin(2 * Math.PI * (ph - fore + 0.05));
    b.neck1.rotation.z = -0.4 * run - nod - pitch * 0.5;
    b.neck2.rotation.z = -0.1 * run - nod * 0.4;
    b.head.rotation.z = 0.3 * run + nod * 0.6;
    // ---- 尾：速さに応じて後ろへなびき、揺れる ----
    this.tailSwing += dt * (3 + 6 * run);
    const tw = Math.sin(this.tailSwing) * 0.08;
    // 尾は後ろ上方へ流れる（時計回り＝負の回転）
    b.tail1.rotation.z = -0.5 * run - pitch;
    b.tail2.rotation.z = -0.15 * run + tw;
    b.tail3.rotation.z = 0.05 * run + tw * 1.6;
    b.tail2.rotation.y = tw * 0.6;
  }

  private solveLeg(g: LegGeom, sx: number, sy: number, load: number, flex: number, toGroup: (x: number, y: number) => [number, number], pitch: number) {
    const bn = this.rig.bones;
    // 蹄の向き：着地中は地面と平行、遊脚中は蹄を後ろへ返す
    const hoofAbs = g.ah - flex * (g.front ? 1.4 : 1.1);
    // 蹄冠 = 蹄底 − 蹄の向き×長さ
    const cx = sx - Math.cos(hoofAbs) * g.lh;
    const cy = sy - Math.sin(hoofAbs) * g.lh;
    // 繋：体重がかかると球節が沈む（繋が寝る）。遊脚中は折りたたむ
    const pasternAbs = g.ap - load * 0.45 * (g.front ? 1 : 0.85) - flex * (g.front ? 1.1 : 0.9);
    const fx = cx - Math.cos(pasternAbs) * g.lp;
    const fy = cy - Math.sin(pasternAbs) * g.lp;
    // 付け根の関節
    const [jx, jy] = toGroup(g.root[0], g.root[1]);
    // 上の骨（上腕・大腿）：蹄が前にあるほど前へ振る
    const swingRel = clamp((sx - g.soleX) / 1.4, -0.7, 0.7);
    const upper = g.a0 + pitch + swingRel * (g.front ? 0.55 : 0.5) + (g.front ? 0.12 : -0.05) * flex;
    const ex = jx + Math.cos(upper) * g.l0;
    const ey = jy + Math.sin(upper) * g.l0;
    // 残り2本（前腕＋管／脛＋管）で球節に届かせる
    let dx = fx - ex;
    let dy = fy - ey;
    let d = len(dx, dy);
    const maxR = g.l1 + g.l2 - 1e-4;
    const minR = Math.abs(g.l1 - g.l2) + 0.02;
    if (d > maxR) {
      dx *= maxR / d;
      dy *= maxR / d;
      d = maxR;
    } else if (d < minR) {
      dx *= minR / d;
      dy *= minR / d;
      d = minR;
    }
    const base = ang(dx, dy);
    const cosA = clamp((g.l1 * g.l1 + d * d - g.l2 * g.l2) / (2 * g.l1 * d), -1, 1);
    const off = Math.acos(cosA);
    // 前膝は前（反時計回り側）、飛節は後ろ（時計回り側）へ曲げる
    const mid = g.front ? base + off : base - off;
    const kx = ex + Math.cos(mid) * g.l1;
    const ky = ey + Math.sin(mid) * g.l1;
    const lower = ang(ex + dx - kx, ey + dy - ky);
    // 実際に届いた球節の位置から、繋・蹄の向きを決め直す
    const rfx = ex + dx;
    const rfy = ey + dy;
    const past = ang(cx - rfx, cy - rfy);
    const abs = [upper, mid, lower, past, hoofAbs];
    const rest = [g.a0, g.a1, g.a2, g.ap, g.ah];
    // 骨のローカル回転 = (この骨の向きの変化) − (親の向きの変化)
    let parentDelta = pitch;
    for (let i = 0; i < 5; i++) {
      const delta = abs[i] - rest[i];
      bn[g.bones[i]].rotation.z = wrap(delta - parentDelta);
      parentDelta = delta;
    }
  }
}
