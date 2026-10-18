// オフライン：馬を買う
import { useState } from "react";
import { MARKET_TIERS, MAX_STABLE, STAT_KEYS, STAT_LABELS, STYLE_LABELS } from "@owners/shared";
import { Notice, StatBar } from "../components";
import { yen } from "../format";
import type { Screen } from "../App";
import { MARKET_REFRESH_RACES } from "./engine";
import type { OfflineGame } from "./useOfflineGame";

export function ShopScreen({ game, go }: { game: OfflineGame; go: (s: Screen) => void }) {
  const save = game.save!;
  const [msg, setMsg] = useState<{ kind: "error" | "good"; text: string } | null>(null);
  const active = save.horses.filter((h) => !h.retired).length;
  const untilRefresh = MARKET_REFRESH_RACES - (save.player.races - save.market.racesAtRefresh);

  const buy = (offerId: string, name: string, price: number) => {
    if (!window.confirm(`${name} を ${yen(price)} で購入しますか？`)) return;
    try {
      const h = game.buy(offerId);
      setMsg({ kind: "good", text: `${h.name} が厩舎に入りました。` });
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">馬を買う</h1>
      <p className="lead">
        厩舎 {active}/{MAX_STABLE}頭 ・ 所持金 {yen(save.player.money)}
      </p>
      <p className="hint">
        販売リストは{MARKET_REFRESH_RACES}レースごとに入れ替わります（あと{Math.max(1, untilRefresh)}レース）。薄い帯は成長の上限で、高い馬ほど大きく伸びます。
      </p>
      {msg && (
        <Notice kind={msg.kind}>
          {msg.text}{" "}
          {msg.kind === "good" && (
            <button className="link" onClick={() => go({ name: "home" })}>
              厩舎で見る
            </button>
          )}
        </Notice>
      )}
      {save.market.offers.length === 0 ? (
        <p className="muted">今は売りに出ている馬がいません。レースに出ると入れ替わります。</p>
      ) : (
        <div className="starter-list">
          {save.market.offers.map((o) => {
            const tier = MARKET_TIERS.find((t) => t.id === o.tier)!;
            const blocked = active >= MAX_STABLE ? "厩舎がいっぱいです" : save.player.money < o.price ? "所持金が足りません" : null;
            return (
              <div key={o.offerId} className={`starter shop-card tier-${o.tier}`}>
                <span className="starter-head">
                  <strong>{o.horse.name}</strong>
                  <span className="tag">{STYLE_LABELS[o.horse.style]}</span>
                  <span className="tag">{tier.label}</span>
                </span>
                <span className="starter-stats">
                  {STAT_KEYS.map((k) => (
                    <StatBar key={k} label={STAT_LABELS[k]} value={o.horse.stats[k]} cap={o.horse.potential[k]} />
                  ))}
                </span>
                <span className="shop-apt muted">
                  芝{o.horse.aptitude.turf} ダ{o.horse.aptitude.dirt} ・ 短{o.horse.aptitude.sprint} マ{o.horse.aptitude.mile} 中
                  {o.horse.aptitude.middle} 長{o.horse.aptitude.long}
                </span>
                <span className="shop-price">{yen(o.price)}</span>
                <button className="btn btn-primary" disabled={!!blocked} onClick={() => buy(o.offerId, o.horse.name, o.price)}>
                  購入する
                </button>
                {blocked && <span className="hint">{blocked}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
