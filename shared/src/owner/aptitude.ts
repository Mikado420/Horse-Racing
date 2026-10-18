// 適性の計算。距離は100m単位の下限・上限で持ち、範囲外は距離差に応じて補正する（指示書 12.2）。
import { DEFAULT_CONFIG, type GameConfig, type RankBand } from "./config";
import { DISTANCE_BANDS, isAbilityKey, type HorseTruth, type KnowledgeKey, type TrueAptitude } from "./model";

/** 適性範囲からの距離差（m）。範囲内なら0 */
export function distanceGap(apt: Pick<TrueAptitude, "distanceMin" | "distanceMax">, distance: number): number {
  if (distance < apt.distanceMin) return apt.distanceMin - distance;
  if (distance > apt.distanceMax) return distance - apt.distanceMax;
  return 0;
}

/** 距離適性の補正（適性内 1.0、100mごとに下がる。短い場合も長い場合も同じ規則） */
export function distanceFactor(
  apt: Pick<TrueAptitude, "distanceMin" | "distanceMax">,
  distance: number,
  cfg: GameConfig = DEFAULT_CONFIG,
): number {
  const steps = Math.ceil(distanceGap(apt, distance) / 100 - 1e-9);
  const t = cfg.distanceFactors;
  return t[Math.min(steps, t.length - 1)];
}

/** 距離帯ごとの適性（0〜100）。帯の中の100mごとの補正の平均 */
export function bandFit(apt: TrueAptitude, band: (typeof DISTANCE_BANDS)[number], cfg: GameConfig = DEFAULT_CONFIG): number {
  let sum = 0;
  let n = 0;
  for (let d = band.min; d <= band.max; d += 100) {
    sum += distanceFactor(apt, d, cfg);
    n++;
  }
  // 補正0.5（大きく外れる）を0、1.0（適性内）を100に対応させる
  return Math.round(Math.max(0, Math.min(100, ((sum / n - 0.5) / 0.5) * 100)));
}

/** 情報解明の対象それぞれの「真の値」（観測のもとになる値。0〜100） */
export function truthValue(t: HorseTruth, key: KnowledgeKey, cfg: GameConfig = DEFAULT_CONFIG): number {
  if (isAbilityKey(key)) return t.abilities[key];
  const a = t.aptitude;
  switch (key) {
    case "surface_turf":
      return a.turf;
    case "surface_dirt":
      return a.dirt;
    case "going_heavy":
      return a.heavy;
    case "course_right":
      return a.right;
    case "course_left":
      return a.left;
    case "course_slope":
      return a.slope;
    case "course_tight":
      return a.tight;
    case "style_front":
      return a.styles.front;
    case "style_stalker":
      return a.styles.stalker;
    case "style_closer":
      return a.styles.closer;
    case "style_deep":
      return a.styles.deep;
    default: {
      const band = DISTANCE_BANDS.find((b) => b.key === key);
      if (!band) throw new Error(`未知の項目: ${key}`);
      return bandFit(a, band, cfg);
    }
  }
}

export function bandForDistance(distance: number) {
  return DISTANCE_BANDS.find((b) => distance >= b.min && distance <= b.max) ?? (distance < 1000 ? DISTANCE_BANDS[0] : DISTANCE_BANDS[3]);
}

/** 能力値 → 評価ランク */
export function rankOf(value: number, cfg: GameConfig = DEFAULT_CONFIG): RankBand["rank"] {
  for (const b of cfg.rankBands) if (value >= b.min) return b.rank;
  return cfg.rankBands[cfg.rankBands.length - 1].rank;
}

/** 適性値（0〜100）→ 記号 */
export function fitMark(value: number): "◎" | "○" | "△" | "×" {
  if (value >= 85) return "◎";
  if (value >= 65) return "○";
  if (value >= 40) return "△";
  return "×";
}

/** 適性値を 0.94〜1.0 の倍率にする（芝・ダートなど） */
export function fitMultiplier(fit: number, spread = 0.06): number {
  return 1 - spread * (1 - Math.max(0, Math.min(100, fit)) / 100);
}
