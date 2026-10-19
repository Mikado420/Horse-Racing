// 絵の部品：馬の姿（毛色つき）と、季節で変わる牧場の景色。すべて本作独自の図形で描く。
// 見た目だけのもので、ゲームの計算には使わない。
import { useId } from "react";
import { monthOf } from "@owners/shared";

import { COATS, coatOf } from "./coat";
export { COAT_LABELS, coatOf, type CoatId } from "./coat";

/** 顔の白斑（流星など）があるか。これも見た目だけ */
function blazeOf(horseId: string): boolean {
  let h = 7;
  for (let i = 0; i < horseId.length; i++) h = (h * 31 + horseId.charCodeAt(i)) >>> 0;
  return h % 3 === 0;
}

/* ---------------- 馬の姿 ---------------- */

export type HorsePose = "stand" | "graze";

/** 横から見た馬（右向き）。viewBox は 240×180、地面は y=164 */
export function HorseFigure({ horseId, pose = "stand", flip = false, shadow = true, className = "" }: { horseId: string; pose?: HorsePose; flip?: boolean; shadow?: boolean; className?: string }) {
  const uid = useId().replace(/:/g, "");
  const c = COATS[coatOf(horseId)];
  const blaze = blazeOf(horseId);
  const leg = `url(#leg-${uid})`;
  const legFar = `url(#legfar-${uid})`;
  return (
    <svg className={`horse-fig ${className}`} viewBox="0 0 240 180" aria-hidden focusable="false">
      <defs>
        <linearGradient id={`leg-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c.body} />
          <stop offset="0.5" stopColor={c.body} />
          <stop offset="0.62" stopColor={c.socks ?? c.body} />
          <stop offset="1" stopColor={c.socks ?? c.body} />
        </linearGradient>
        <linearGradient id={`legfar-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c.shade} />
          <stop offset="0.5" stopColor={c.shade} />
          <stop offset="0.62" stopColor={c.socks ?? c.shade} />
          <stop offset="1" stopColor={c.socks ?? c.shade} />
        </linearGradient>
        <linearGradient id={`body-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c.body} />
          <stop offset="0.7" stopColor={c.body} />
          <stop offset="1" stopColor={c.shade} />
        </linearGradient>
      </defs>
      <g transform={flip ? "translate(240 0) scale(-1 1)" : undefined}>
        {shadow && <ellipse cx="122" cy="165" rx="78" ry="7" fill="rgba(20,30,20,0.22)" />}
        {/* 尾 */}
        <path d="M66 72 C46 74 36 96 38 124 C39 138 44 148 50 154 C49 134 50 110 64 88 Z" fill={c.mane} />
        {/* 奥の脚 */}
        <path d="M84 98 L98 100 L99 128 L102 158 L92 159 L89 130 Z" fill={legFar} />
        <path d="M150 100 L162 100 L161 130 L163 158 L153 159 L151 131 Z" fill={legFar} />
        <rect x="91" y="156" width="12" height="6" rx="1.5" fill={c.hoof} />
        <rect x="152" y="156" width="12" height="6" rx="1.5" fill={c.hoof} />
        {/* 胴 */}
        <path d="M64 80 C62 62 84 57 106 59 L150 58 C168 56 182 66 183 84 C184 100 172 109 156 109 L98 111 C76 112 64 100 64 80 Z" fill={`url(#body-${uid})`} />
        {pose === "stand" ? (
          <>
            {/* 首と頭（立っている） */}
            <path d="M150 74 C155 52 167 36 184 26 L203 39 C193 51 186 67 181 92 Z" fill={c.body} />
            <path d="M182 23 C189 14 202 13 209 21 L227 49 C230 56 226 62 219 62 C212 62 205 58 199 52 L188 42 C182 36 179 29 182 23 Z" fill={c.body} />
            <path d="M186 21 L190 8 L197 20 Z" fill={c.shade} />
            <path d="M183 24 C171 31 160 47 152 68 L159 68 C167 49 177 37 190 30 Z" fill={c.mane} />
            {blaze && <path d="M204 24 L222 50 L218 52 L201 27 Z" fill="#f4f1ea" opacity="0.9" />}
            <circle cx="203" cy="31" r="2" fill="#120d0a" />
            <circle cx="221" cy="56" r="1.4" fill="rgba(0,0,0,0.45)" />
          </>
        ) : (
          <>
            {/* 首と頭（草を食べている） */}
            <path d="M150 72 C162 80 176 102 186 128 L201 122 C192 98 182 78 178 62 Z" fill={c.body} />
            <path d="M184 120 C190 113 203 115 206 124 L214 154 C215 161 210 165 204 163 L193 157 C187 149 182 134 184 120 Z" fill={c.body} />
            <path d="M188 118 L182 106 L194 114 Z" fill={c.shade} />
            <path d="M178 62 C186 80 194 100 200 120 L194 122 C188 102 180 82 170 66 Z" fill={c.mane} />
            {blaze && <path d="M199 124 L210 156 L206 157 L196 127 Z" fill="#f4f1ea" opacity="0.9" />}
            <circle cx="194" cy="129" r="2" fill="#120d0a" />
          </>
        )}
        {/* 手前の脚 */}
        <path d="M66 92 C70 106 80 110 90 111 L88 128 L86 158 L76 158 L77 128 C72 120 67 108 66 92 Z" fill={leg} />
        <path d="M162 100 L176 101 L174 130 L176 158 L165 158 L164 131 Z" fill={leg} />
        <rect x="75" y="155" width="13" height="7" rx="1.5" fill={c.hoof} />
        <rect x="164" y="155" width="13" height="7" rx="1.5" fill={c.hoof} />
        {/* 光沢 */}
        <path d="M86 66 C110 60 140 60 166 64 C140 66 112 68 88 72 Z" fill="rgba(255,255,255,0.16)" />
      </g>
    </svg>
  );
}

/* ---------------- 季節 ---------------- */

export type Season = "spring" | "summer" | "autumn" | "winter";
export const SEASON_LABELS: Record<Season, string> = { spring: "春", summer: "夏", autumn: "秋", winter: "冬" };

export function seasonOf(week: number): Season {
  const m = monthOf(week);
  return m >= 3 && m <= 5 ? "spring" : m >= 6 && m <= 8 ? "summer" : m >= 9 && m <= 11 ? "autumn" : "winter";
}

interface Palette {
  skyTop: string;
  skyBottom: string;
  mountain: string;
  hillFar: string;
  hillNear: string;
  grassTop: string;
  grassBottom: string;
  crown: [string, string, string];
  trunk: string;
  roof: string;
}
const PALETTES: Record<Season, Palette> = {
  spring: { skyTop: "#7fbde8", skyBottom: "#e8f4fa", mountain: "#a9c3d3", hillFar: "#a8cc95", hillNear: "#86b76c", grassTop: "#8fc463", grassBottom: "#5d9a43", crown: ["#f3c9d3", "#eaaebf", "#f8dde3"], trunk: "#6b4b36", roof: "#9a3f33" },
  summer: { skyTop: "#3f97dc", skyBottom: "#d4ecf8", mountain: "#8fb2c9", hillFar: "#73a866", hillNear: "#4f8c48", grassTop: "#6cab45", grassBottom: "#3f7c32", crown: ["#3d7d38", "#2f6a2d", "#4f9246"], trunk: "#5a3e2b", roof: "#8f3a2f" },
  autumn: { skyTop: "#6faad8", skyBottom: "#f2e7d2", mountain: "#a8a99a", hillFar: "#bba769", hillNear: "#9c9150", grassTop: "#a9b75c", grassBottom: "#7c893b", crown: ["#e7b53d", "#d48c2b", "#f0cd62"], trunk: "#5d4330", roof: "#8a3b2e" },
  winter: { skyTop: "#9fbad0", skyBottom: "#eef3f6", mountain: "#d6e0e8", hillFar: "#e3eaef", hillNear: "#d2dde4", grassTop: "#f2f6f8", grassBottom: "#d7e1e6", crown: ["#f6f9fb", "#e4ebf0", "#ffffff"], trunk: "#5b4a3d", roof: "#7f3a31" },
};

/** 牧場の景色（背景）。下端を基準に切り抜くので、横長でも縦長でも地面の位置は保たれる */
export function PastureScene({ season, className = "" }: { season: Season; className?: string }) {
  const p = PALETTES[season];
  const uid = useId().replace(/:/g, "");
  const winter = season === "winter";
  return (
    <svg className={`pasture-scene ${className}`} viewBox="0 0 1000 400" preserveAspectRatio="xMidYMax slice" aria-hidden focusable="false">
      <defs>
        <linearGradient id={`sky-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.skyTop} />
          <stop offset="1" stopColor={p.skyBottom} />
        </linearGradient>
        <linearGradient id={`grass-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.grassTop} />
          <stop offset="1" stopColor={p.grassBottom} />
        </linearGradient>
        <radialGradient id={`sun-${uid}`} cx="0.82" cy="0.08" r="0.45">
          <stop offset="0" stopColor="#fffbe8" stopOpacity="0.9" />
          <stop offset="1" stopColor="#fffbe8" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`fade-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.72" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#0d1f18" stopOpacity="0.28" />
        </linearGradient>
        <pattern id={`blades-${uid}`} width="36" height="18" patternUnits="userSpaceOnUse">
          <path d="M4 18 L6 9 M12 18 L11 11 M22 18 L24 8 M30 18 L29 12" stroke={winter ? "rgba(140,160,170,0.25)" : "rgba(30,70,20,0.22)"} strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </pattern>
      </defs>
      <rect width="1000" height="400" fill={`url(#sky-${uid})`} />
      <rect width="1000" height="400" fill={`url(#sun-${uid})`} />
      {/* 雲 */}
      <g fill="#fff" opacity={winter ? 0.75 : 0.88}>
        <Cloud x={160} y={52} s={1} />
        <Cloud x={520} y={34} s={0.75} />
        <Cloud x={820} y={92} s={0.9} />
      </g>
      {/* 遠くの山 */}
      <path d="M0 176 L70 140 L140 162 L240 118 L330 156 L430 128 L520 152 L640 108 L760 150 L860 126 L1000 152 V240 H0 Z" fill={p.mountain} opacity="0.85" />
      {winter && <path d="M222 128 L240 118 L258 128 L248 132 L240 127 L232 133 Z M622 118 L640 108 L660 120 L648 124 L640 119 L630 125 Z" fill="#fff" />}
      {/* 丘 */}
      <path d="M0 196 C140 168 300 190 460 178 C620 166 780 194 1000 172 V260 H0 Z" fill={p.hillFar} />
      {/* 丘の上の厩舎 */}
      <g transform="translate(700 158)">
        <rect x="0" y="10" width="64" height="20" fill="#efe8dc" />
        <path d="M-6 12 L32 -6 L70 12 Z" fill={p.roof} />
        <rect x="26" y="16" width="12" height="14" fill="#6f5a49" />
        <rect x="70" y="16" width="40" height="14" fill="#e6dccd" />
        <path d="M66 18 L90 6 L114 18 Z" fill={p.roof} opacity="0.9" />
      </g>
      <path d="M0 214 C180 198 380 214 560 204 C720 196 860 212 1000 202 V280 H0 Z" fill={p.hillNear} />
      {/* 木 */}
      <Tree x={150} y={236} p={p} bare={winter} />
      <Tree x={905} y={222} p={p} bare={winter} small />
      {/* 牧草地 */}
      <path d="M0 230 C220 222 520 236 1000 224 V400 H0 Z" fill={`url(#grass-${uid})`} />
      <path d="M0 230 C220 222 520 236 1000 224 V400 H0 Z" fill={`url(#blades-${uid})`} />
      {/* 柵 */}
      <g>
        <path d="M0 238 C250 230 520 242 1000 232" stroke="#8a6a48" strokeWidth="4" fill="none" />
        <path d="M0 252 C250 244 520 256 1000 246" stroke="#7a5b3c" strokeWidth="4" fill="none" />
        {Array.from({ length: 15 }, (_, i) => {
          const x = 20 + i * 70;
          const y = 228 + Math.sin(i * 0.9) * 2;
          return <rect key={i} x={x} y={y} width="6" height="32" rx="1.5" fill="#6d5034" />;
        })}
      </g>
      {/* 手前の草むら（奥行き） */}
      <g fill={winter ? "#c9d5dc" : p.grassBottom} opacity="0.9">
        {[40, 210, 380, 600, 770, 950].map((x, i) => (
          <path key={x} d={`M${x - 26} 400 C${x - 18} ${372 - (i % 3) * 6} ${x - 8} ${362 - (i % 2) * 8} ${x} ${356 - (i % 3) * 6} C${x + 6} ${366} ${x + 16} ${374} ${x + 30} 400 Z`} />
        ))}
      </g>
      {season === "spring" && (
        <g fill="#fff7d6">
          {[[90, 300], [260, 330], [470, 290], [640, 340], [830, 300], [930, 350], [350, 370], [560, 360]].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="2.6" />
          ))}
        </g>
      )}
      {season === "autumn" && (
        <g fill="#d9902e" opacity="0.85">
          {[[120, 310], [300, 290], [520, 330], [700, 300], [880, 340]].map(([x, y]) => (
            <ellipse key={`${x}-${y}`} cx={x} cy={y} rx="4" ry="2" transform={`rotate(25 ${x} ${y})`} />
          ))}
        </g>
      )}
      <rect width="1000" height="400" fill={`url(#fade-${uid})`} />
    </svg>
  );
}

function Cloud({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="0" cy="10" rx="58" ry="14" />
      <ellipse cx="-22" cy="2" rx="26" ry="16" />
      <ellipse cx="12" cy="-4" rx="30" ry="20" />
      <ellipse cx="40" cy="4" rx="22" ry="13" />
    </g>
  );
}

function Tree({ x, y, p, bare, small }: { x: number; y: number; p: Palette; bare?: boolean; small?: boolean }) {
  const s = small ? 0.55 : 1;
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-9 2 C-6 -30 -5 -62 -10 -92 L0 -96 C2 -64 4 -32 9 2 Z" fill={p.trunk} />
      <g stroke={p.trunk} strokeWidth="5" strokeLinecap="round" fill="none">
        <path d="M-6 -70 C-14 -84 -20 -92 -24 -100" />
        <path d="M-2 -82 C6 -94 16 -100 26 -104" />
        <path d="M-4 -92 C-2 -104 2 -112 4 -118" />
      </g>
      {bare ? (
        <g stroke={p.trunk} strokeWidth="3" fill="none" strokeLinecap="round">
          <path d="M-22 -98 L-40 -126 M-22 -98 L-14 -132 M5 -108 L-2 -150 M5 -108 L22 -146 M26 -104 L48 -128 M26 -104 L30 -136" />
          <path d="M-44 -128 L-36 -128 M-4 -150 L4 -150 M20 -147 L28 -147" stroke="#fff" strokeWidth="5" />
        </g>
      ) : (
        <g>
          <circle cx="-26" cy="-108" r="34" fill={p.crown[1]} />
          <circle cx="24" cy="-112" r="36" fill={p.crown[1]} />
          <circle cx="-2" cy="-140" r="38" fill={p.crown[0]} />
          <circle cx="-34" cy="-136" r="24" fill={p.crown[0]} />
          <circle cx="36" cy="-140" r="24" fill={p.crown[0]} />
          <circle cx="-10" cy="-158" r="20" fill={p.crown[2]} />
          <circle cx="20" cy="-128" r="14" fill={p.crown[2]} opacity="0.8" />
        </g>
      )}
    </g>
  );
}

/** 季節のアイコン（上部バーの日付に添える） */
export function SeasonIcon({ season, size = 16 }: { season: Season; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true as const, className: `season-icon season-${season}` };
  if (season === "spring")
    return (
      <svg {...common}>
        {[0, 72, 144, 216, 288].map((a) => (
          <ellipse key={a} cx="12" cy="6.5" rx="3.6" ry="5" transform={`rotate(${a} 12 12)`} fill="currentColor" opacity="0.9" />
        ))}
        <circle cx="12" cy="12" r="2.2" fill="#fff6c8" />
      </svg>
    );
  if (season === "summer")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4.6" fill="currentColor" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
          <rect key={a} x="11" y="1.5" width="2" height="4" rx="1" transform={`rotate(${a} 12 12)`} fill="currentColor" />
        ))}
      </svg>
    );
  if (season === "autumn")
    return (
      <svg {...common}>
        <path d="M12 2 L14 8 L19.5 6 L16.5 11 L21 13.5 L15.5 14.5 L16 20 L12 16.5 L8 20 L8.5 14.5 L3 13.5 L7.5 11 L4.5 6 L10 8 Z" fill="currentColor" />
        <path d="M12 16 L12 22.5" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  return (
    <svg {...common}>
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M12 2.5 V21.5 M3.8 7.2 L20.2 16.8 M3.8 16.8 L20.2 7.2" />
        <path d="M9.5 4.5 L12 7 L14.5 4.5 M9.5 19.5 L12 17 L14.5 19.5" fill="none" />
      </g>
    </svg>
  );
}
