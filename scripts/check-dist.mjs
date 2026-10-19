// ビルド成果物の確認（CI 用）。PWA として配信するのに必要なものがそろっているかを調べる。
//   node scripts/check-dist.mjs client/dist
// 失敗したら終了コード 1。公開前の最後の確認として使う。
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2] ?? "client/dist";
const errors = [];
const ok = (m) => console.log(`✓ ${m}`);
const ng = (m) => {
  errors.push(m);
  console.log(`✗ ${m}`);
};
const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");
const exists = (f) => fs.existsSync(path.join(dir, f));

for (const f of ["index.html", "sw.js", "manifest.webmanifest", "version.json", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"]) {
  exists(f) ? ok(`${f} がある`) : ng(`${f} がない`);
}

if (exists("manifest.webmanifest")) {
  try {
    const m = JSON.parse(read("manifest.webmanifest"));
    const need = { name: "競走馬オーナーズ", short_name: "競馬オーナーズ", display: "standalone", background_color: "#F4F2EA", theme_color: "#183C30" };
    for (const [k, v] of Object.entries(need)) m[k] === v ? ok(`manifest.${k} = ${v}`) : ng(`manifest.${k} が ${JSON.stringify(m[k])}（期待：${v}）`);
    const sizes = (m.icons ?? []).map((i) => `${i.sizes}:${i.purpose ?? "any"}`);
    for (const s of ["192x192:any", "512x512:any", "512x512:maskable"]) sizes.includes(s) ? ok(`アイコン ${s}`) : ng(`アイコン ${s} がない`);
    for (const i of m.icons ?? []) if (!exists(i.src)) ng(`アイコンのファイル ${i.src} がない`);
  } catch (e) {
    ng(`manifest.webmanifest が JSON として読めない：${e.message}`);
  }
}

if (exists("index.html")) {
  const html = read("index.html");
  /<link rel="manifest" href="[^"]*manifest\.webmanifest"/.test(html) ? ok("index.html がマニフェストを参照") : ng("index.html にマニフェストの参照がない");
  /<link rel="apple-touch-icon"/.test(html) ? ok("apple-touch-icon の参照") : ng("apple-touch-icon の参照がない");
  html.includes("%BASE_URL%") ? ng("index.html に %BASE_URL% が置換されずに残っている") : ok("BASE_URL が置換済み");
  // HTML が参照する JS/CSS はハッシュ付きで、Service Worker の事前取得の対象に入っていること
  const refs = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1].replace(/^.*\/assets\//, "assets/"));
  if (refs.length === 0) ng("index.html から JS/CSS の参照が見つからない");
  const sw = exists("sw.js") ? read("sw.js") : "";
  for (const r of refs) {
    /-[A-Za-z0-9_-]{6,}\.(js|css)$/.test(r) ? ok(`ハッシュ付き：${r}`) : ng(`ハッシュが付いていない：${r}`);
    if (!r.startsWith("http")) sw.includes(r) ? ok(`事前取得の対象：${r}`) : ng(`Service Worker の事前取得に ${r} がない`);
  }
  sw.includes('"index.html"') || sw.includes("url:\"index.html\"") || /index\.html/.test(sw) ? ok("事前取得の対象：index.html") : ng("Service Worker の事前取得に index.html がない");
  /api/.test((sw.match(/precacheAndRoute\(\[[\s\S]*?\]/) ?? [""])[0]) ? ng("API が事前取得の対象に入っている") : ok("API は事前取得しない");
}

if (exists("version.json")) {
  const v = JSON.parse(read("version.json"));
  v.version ? ok(`version.json：${v.version}`) : ng("version.json にバージョンがない");
}

if (errors.length) {
  console.log(`\n${errors.length}件の問題があります`);
  process.exit(1);
}
console.log("\nビルド成果物は公開できる状態です");
