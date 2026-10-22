// 画像を使わず、その場で描くテクスチャ（芝・ダート・芝生・窓・看板の文字など）
import * as THREE from "three";

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

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function tex(c: HTMLCanvasElement, repeat = true, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** 細かな点を散らす（草・土の質感） */
function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, colors: string[], size: [number, number], seed: number) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    const s = size[0] + r() * (size[1] - size[0]);
    g.fillRect(r() * w, r() * h, s, s * (0.6 + r()));
  }
}

/**
 * 芝コース：刈り込みの向きで明暗が交互になる帯（斜めの格子模様）。
 * u はコースに沿った方向（1枚で 24m）、v は幅方向（1枚でコース幅）
 */
export function turfTexture(wet: number): THREE.CanvasTexture {
  const W = 512;
  const H = 512;
  const [c, g] = canvas(W, H);
  const base = wet > 0.5 ? ["#3f7a3c", "#4a8745"] : ["#4f9a46", "#5daa52"];
  // 斜めの帯を2方向に重ねて菱形の刈り模様にする
  g.fillStyle = base[0];
  g.fillRect(0, 0, W, H);
  g.save();
  g.globalAlpha = 0.5;
  for (let k = -2; k < 4; k++) {
    g.fillStyle = base[1];
    g.beginPath();
    g.moveTo(k * 256, 0);
    g.lineTo(k * 256 + 128, 0);
    g.lineTo(k * 256 + 128 + 256, H);
    g.lineTo(k * 256 + 256, H);
    g.closePath();
    g.fill();
  }
  g.globalAlpha = 0.25;
  for (let k = -2; k < 4; k++) {
    g.fillStyle = "#2f6a2d";
    g.beginPath();
    g.moveTo(k * 256 + 256, 0);
    g.lineTo(k * 256 + 384, 0);
    g.lineTo(k * 256 + 128, H);
    g.lineTo(k * 256, H);
    g.closePath();
    g.fill();
  }
  g.restore();
  speckle(g, W, H, 26000, ["#3b7d36", "#6bb35c", "#56a04b", "#2f6a2d", "#7cbf68"], [1, 2.2], 7);
  return tex(c);
}

/** ダートコース：砂の粒と、蹄跡の筋 */
export function dirtTexture(wet: number): THREE.CanvasTexture {
  const W = 512;
  const H = 512;
  const [c, g] = canvas(W, H);
  g.fillStyle = wet > 0.5 ? "#6e5236" : "#a98258";
  g.fillRect(0, 0, W, H);
  speckle(g, W, H, 30000, wet > 0.5 ? ["#5d442c", "#7a5c3e", "#4f3a26"] : ["#b9926a", "#9b7650", "#c7a27a", "#8c6a46"], [1, 2.5], 11);
  const r = rng(23);
  g.globalAlpha = 0.18;
  for (let i = 0; i < 260; i++) {
    g.fillStyle = r() > 0.5 ? "#6b4f33" : "#d2b08a";
    const x = r() * W;
    const y = r() * H;
    g.beginPath();
    g.ellipse(x, y, 6 + r() * 4, 3 + r() * 2, 0, 0, Math.PI * 2);
    g.fill();
  }
  // 整地の跡（コースに沿った細い筋）
  g.globalAlpha = 0.08;
  for (let y = 0; y < H; y += 6) {
    g.fillStyle = y % 12 ? "#ffffff" : "#000000";
    g.fillRect(0, y, W, 2);
  }
  return tex(c);
}

/** 芝生（内馬場・外の草地） */
export function grassTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  g.fillStyle = "#5f9448";
  g.fillRect(0, 0, 512, 512);
  speckle(g, 512, 512, 30000, ["#4f8a3e", "#6ea456", "#5a8f45", "#78ad5e", "#46803a"], [1, 3], 3);
  const r = rng(5);
  g.globalAlpha = 0.12;
  for (let i = 0; i < 40; i++) {
    g.fillStyle = r() > 0.5 ? "#3f7434" : "#86b96a";
    g.beginPath();
    g.arc(r() * 512, r() * 512, 20 + r() * 50, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c);
}

/** スタンドのガラス面（窓の格子と映り込み） */
export function windowTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 256);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#8fb4cc");
  grad.addColorStop(0.5, "#5d7f96");
  grad.addColorStop(1, "#3c5566");
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = "#d9dde0";
  g.lineWidth = 4;
  for (let x = 0; x <= 512; x += 32) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 256);
    g.stroke();
  }
  for (let y = 0; y <= 256; y += 64) {
    g.fillStyle = "#e6e8ea";
    g.fillRect(0, y - 6, 512, 12);
  }
  g.globalAlpha = 0.15;
  g.fillStyle = "#ffffff";
  for (let i = 0; i < 6; i++) g.fillRect(i * 90 + 10, 0, 30, 256);
  return tex(c);
}

/** 文字の看板（ハロン棒の距離表示など） */
export function labelTexture(text: string, bg: string, fg: string, w = 128, h = 128): THREE.CanvasTexture {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.font = `bold ${Math.round(h * 0.55)}px 'Helvetica Neue', Arial, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + 2);
  return tex(c, false);
}

/** 柔らかい丸い影（足元の影・遠くの馬用） */
export function blobTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, "rgba(0,0,0,0.55)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return tex(c, false, false);
}

/** 観客席の人（色とりどりの服） */
export const CROWD_COLORS = ["#f2f2f2", "#1f2a44", "#c0392b", "#2e86de", "#f1c40f", "#27ae60", "#8e44ad", "#e67e22", "#7f8c8d", "#ecf0f1", "#34495e", "#d35400", "#16a085", "#2c3e50"];
