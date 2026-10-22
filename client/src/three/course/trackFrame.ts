// コースの座標：内ラチ沿いの距離 s と、内ラチからの外向きの距離 lateral から、3D の位置・向き・高さを求める。
// ・レース計算と同じ trackPoint（楕円形：直線2本＋半円2つ）をそのまま使うので、描画とレース結果がずれない。
// ・trackPoint は左回りの形なので、右回りの競馬場は奥行き方向（z）を反転して描く。
// ・高さ：坂のある競馬場はゴール前の直線に上り坂（残り約460m〜300mで2m）を置き、向こう正面で下る。
//   コーナーは外側をわずかに高くする（カント）。
import { trackPoint, turnRadius, type CourseDef } from "@owners/shared";

export interface FramePoint {
  x: number;
  y: number;
  z: number;
  /** 進行方向（ラジアン、+x が0。描画では rotation.y = -heading） */
  heading: number;
  /** 進行方向の傾き（上りが正、ラジアン） */
  grade: number;
  /** コーナーなら曲がる向き（左=1、右=-1、直線=0） */
  turn: number;
}

export interface CourseShape {
  lapLength: number;
  straightLength: number;
  trackWidth: number;
  direction: "left" | "right";
  slope: boolean;
}

const CANT = 0.025; // コーナーの外側の上がり（2.5%）
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export class TrackFrame {
  readonly course: CourseDef;
  readonly L: number;
  readonly S: number;
  readonly R: number;
  readonly mirror: boolean;
  readonly slope: boolean;
  /** 描画上のコース幅（18頭が並べる幅を確保する） */
  readonly width: number;

  /** runners を 0 にすると、コースの幅をそのまま使う（並走する別の走路を描くとき） */
  constructor(course: CourseDef & { direction?: "left" | "right"; slope?: boolean }, runners = 8) {
    this.course = course;
    this.L = course.lapLength;
    this.S = course.straightLength;
    this.R = turnRadius(course);
    this.mirror = course.direction === "right";
    this.slope = !!course.slope;
    this.width = runners > 0 ? Math.max(course.trackWidth, 1.25 * runners + 3, 20) : course.trackWidth;
  }

  /** 内ラチ上の距離 s での高さ（ゴールが s=0） */
  elevation(s: number): number {
    const L = this.L;
    const u = ((s % L) + L) % L;
    if (this.slope) {
      // ゴール前の上り坂（ゴールの460m手前から300m手前で 2m 上がる）→ ゴール後〜向こう正面で下る
      const up = smooth((u - (L - 460)) / 160);
      const down = smooth((u - L * 0.18) / (L * 0.32));
      return 2.0 * (u >= L - 460 ? up : 1 - down) - 1.0;
    }
    // 平坦なコースもわずかに起伏がある
    return 0.25 * Math.sin((u / L) * Math.PI * 2 + 0.6);
  }

  /** s での区間の種類（コーナーかどうか） */
  private turnAt(s: number): number {
    const L = this.L;
    const u = ((s % L) + L) % L;
    const turnLen = Math.PI * this.R;
    const onTurn = u < turnLen || (u >= turnLen + this.S && u < 2 * turnLen + this.S);
    return onTurn ? (this.mirror ? -1 : 1) : 0;
  }

  /** コーナーの中でどれだけ曲がっているか（カントのなめらかな出入りに使う、0〜1） */
  private turnWeight(s: number): number {
    const L = this.L;
    const u = ((s % L) + L) % L;
    const turnLen = Math.PI * this.R;
    const ramp = 40;
    const inTurn = (a: number) => smooth((u - a + ramp) / ramp) * smooth((a + turnLen - u + ramp) / ramp);
    return Math.max(inTurn(0), inTurn(turnLen + this.S), inTurn(L + 0), inTurn(-turnLen - this.S + 0));
  }

  point(s: number, lateral: number): FramePoint {
    const p = trackPoint(this.course, s, lateral);
    const z = this.mirror ? -p.z : p.z;
    const heading = this.mirror ? -p.heading : p.heading;
    const bank = Math.max(0, lateral) * CANT * this.turnWeight(s);
    const y = this.elevation(s) + bank;
    const grade = Math.atan2(this.elevation(s + 1) - this.elevation(s - 1), 2);
    return { x: p.x, y, z, heading, grade, turn: this.turnAt(s) };
  }

  /** 平面上の点 (x,z) から、いちばん近いコース上の s と lateral（地面の高さ合わせに使う） */
  nearest(x: number, zIn: number): { s: number; lateral: number } {
    const z = this.mirror ? -zIn : zIn;
    const { S, R, L } = this;
    const turnLen = Math.PI * R;
    if (x > S / 2) {
      // 右側の半円（s: 0 → turnLen）。中心 (S/2, 0)
      const phi = Math.atan2(z, x - S / 2);
      const s = (Math.PI / 2 - phi) * R;
      return { s: Math.max(0, Math.min(turnLen, s)), lateral: Math.hypot(x - S / 2, z) - R };
    }
    if (x < -S / 2) {
      // 左側の半円（s: turnLen+S → 2turnLen+S）。中心 (-S/2, 0)
      let phi = Math.atan2(z, x + S / 2); // -π〜π、左側なので |phi| > π/2
      if (phi > 0) phi -= 2 * Math.PI; // -π/2 → -3π/2 の範囲に
      const s = turnLen + S + (-Math.PI / 2 - phi) * R;
      return { s, lateral: Math.hypot(x + S / 2, z) - R };
    }
    if (z < 0) return { s: turnLen + (S / 2 - x), lateral: -z - R }; // 向こう正面
    return { s: (2 * turnLen + S + (x + S / 2)) % L, lateral: z - R }; // ホームストレッチ
  }

  /** 地面（芝生・内馬場）の高さ */
  groundHeight(x: number, z: number): number {
    const n = this.nearest(x, z);
    const bank = Math.max(0, Math.min(this.width, n.lateral)) * CANT * this.turnWeight(n.s);
    return this.elevation(n.s) + bank;
  }
}
