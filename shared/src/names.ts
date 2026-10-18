// 馬名の自動生成（CPU馬・販売馬用）。本作独自の音の組み合わせ。
import { pick, type Rng } from "./rng";

const HEAD = [
  "アオ", "ハル", "ミナト", "シロ", "ホシ", "ユメ", "サク", "トキ", "ナギ", "ソラ", "リン", "カエデ",
  "ヒナタ", "ツキ", "コハク", "ミズ", "アカネ", "クロ", "フユ", "ナツ", "ヨル", "アサ", "ハヤ", "モリ",
];
const TAIL = [
  "ノヒカリ", "ボシ", "カゼ", "マル", "ダッシュ", "ステップ", "コメット", "リボン", "ランナー", "ノツバサ",
  "スター", "フラッグ", "アロー", "ミライ", "ノウタ", "ブレイブ", "ウェーブ", "ソング", "ノミチ", "ビート",
];

export function generateHorseName(rng: Rng, taken: ReadonlySet<string> = new Set()): string {
  for (let i = 0; i < 20; i++) {
    const n = pick(rng, HEAD) + pick(rng, TAIL);
    if ([...n].length <= 12 && !taken.has(n)) return n;
  }
  return pick(rng, HEAD) + pick(rng, TAIL) + String(Math.floor(rng() * 90) + 10);
}
