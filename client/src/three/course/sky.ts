// 空（グラデーション・太陽・雲）と、天候による光の設定。空はシェーダーで描き、反射用の環境マップにも使う。
import * as THREE from "three";

export type WeatherKind = "sunny" | "cloudy" | "rain";

export interface SkyLook {
  top: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
  sun: THREE.Color;
  sunIntensity: number;
  hemiIntensity: number;
  cloud: number; // 雲の量 0〜1
  fog: THREE.Color;
  fogDensity: number;
}

export function skyLook(w: WeatherKind): SkyLook {
  if (w === "rain")
    return { top: new THREE.Color("#6f7b86"), horizon: new THREE.Color("#a7b0b6"), ground: new THREE.Color("#4c5a44"), sun: new THREE.Color("#dfe4e8"), sunIntensity: 0.9, hemiIntensity: 1.25, cloud: 0.95, fog: new THREE.Color("#9aa4ab"), fogDensity: 0.0024 };
  if (w === "cloudy")
    return { top: new THREE.Color("#7f9bb3"), horizon: new THREE.Color("#c9d4dc"), ground: new THREE.Color("#55684a"), sun: new THREE.Color("#fff2df"), sunIntensity: 1.5, hemiIntensity: 1.15, cloud: 0.72, fog: new THREE.Color("#c3ccd2"), fogDensity: 0.0014 };
  return { top: new THREE.Color("#3f86cf"), horizon: new THREE.Color("#cfe3f0"), ground: new THREE.Color("#5b7247"), sun: new THREE.Color("#fff1d8"), sunIntensity: 2.6, hemiIntensity: 0.95, cloud: 0.35, fog: new THREE.Color("#c8dbe8"), fogDensity: 0.0009 };
}

export const SUN_DIR = new THREE.Vector3(0.45, 0.62, 0.35).normalize();

export function skyDome(look: SkyLook): THREE.Mesh {
  const geo = new THREE.SphereGeometry(4000, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: look.top },
      uHorizon: { value: look.horizon },
      uGround: { value: look.ground },
      uSun: { value: look.sun },
      uSunDir: { value: SUN_DIR },
      uCloud: { value: look.cloud },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
        gl_Position.z = gl_Position.w * 0.99999; // いちばん奥に描く
      }`,
    fragmentShader: `
      uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSun; uniform vec3 uSunDir; uniform float uCloud;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(uHorizon, uGround, clamp(-h * 6.0, 0.0, 1.0));
        // 太陽
        float s = max(dot(d, uSunDir), 0.0);
        col += uSun * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.18) * (1.0 - uCloud * 0.8);
        // 雲（地平線に近いほど平たく、遠い）
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.12) * 1.6;
          float c = fbm(uv + vec2(3.0, 1.0));
          float cover = smoothstep(1.0 - uCloud - 0.05, 1.0 - uCloud + 0.35, c);
          vec3 cloudCol = mix(vec3(1.0), uHorizon * 0.85, clamp(uCloud * 0.9, 0.0, 1.0));
          cloudCol *= 0.82 + 0.25 * fbm(uv * 2.0 + 7.0);
          col = mix(col, cloudCol, cover * smoothstep(0.0, 0.12, h));
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.renderOrder = -1;
  return m;
}

/** 空から環境マップ（反射と環境光）を作る */
export function environmentFrom(renderer: THREE.WebGLRenderer, look: SkyLook): THREE.Texture {
  const pm = new THREE.PMREMGenerator(renderer);
  const sc = new THREE.Scene();
  sc.add(skyDome(look));
  // 地面の照り返し
  const g = new THREE.Mesh(new THREE.CircleGeometry(3000, 16), new THREE.MeshBasicMaterial({ color: look.ground }));
  g.rotation.x = -Math.PI / 2;
  g.position.y = -5;
  sc.add(g);
  const rt = pm.fromScene(sc, 0.02, 1, 5000);
  pm.dispose();
  return rt.texture;
}
