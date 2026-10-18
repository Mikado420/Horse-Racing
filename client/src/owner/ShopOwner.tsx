// 馬を買う：販売馬は年齢・血統・下見の印象・価格だけが手がかり。価格と才能は必ずしも一致しない
import { useState } from "react";
import { MARKET_REFRESH_WEEKS, MAX_ACTIVE, activeHorses, validateRaceHorseName } from "@owners/shared";
import { Notice } from "../components";
import { yen } from "../format";
import type { OwnerGame } from "../offline/useOwnerGame";
import type { OScreen } from "./OwnerApp";
import { OfferCard, TrainerPicker } from "./offers";

export function ShopOwner({ game, go }: { game: OwnerGame; go: (s: OScreen) => void }) {
  const save = game.save!;
  const [buying, setBuying] = useState<string | null>(null);
  const [trainer, setTrainer] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ kind: "good" | "error"; text: string; horseId?: string } | null>(null);
  const active = activeHorses(save).length;
  const untilRefresh = MARKET_REFRESH_WEEKS - (save.week - save.market.refreshedWeek);
  const offer = save.market.offers.find((o) => o.offerId === buying);
  const nameError = name.trim() ? validateRaceHorseName(name) : null;

  const buy = () => {
    if (!offer || !trainer || nameError) return;
    try {
      const h = game.buy(offer.offerId, trainer, name.trim() || null);
      setMsg({ kind: "good", text: `${h.name}を迎えました。`, horseId: h.id });
      setBuying(null);
      setName("");
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">馬を買う</h1>
      <p className="lead">
        所有 {active}/{MAX_ACTIVE}頭 ・ 所持金 {yen(save.player.money)}
      </p>
      <p className="hint">
        販売馬は{MARKET_REFRESH_WEEKS}週ごとに入れ替わります（あと{Math.max(1, untilRefresh)}週）。能力は買ってから厩舎の観察と実戦で見極めていきます。
        価格は評判を反映しますが、才能と必ずしも一致しません。
      </p>
      {msg && (
        <Notice kind={msg.kind}>
          {msg.text}{" "}
          {msg.horseId && (
            <button className="link" onClick={() => go({ name: "horse", horseId: msg.horseId! })}>
              見に行く
            </button>
          )}
        </Notice>
      )}
      {save.market.offers.length === 0 ? (
        <p className="muted">今は売りに出ている馬がいません。</p>
      ) : (
        <div className="starter-list">
          {save.market.offers.map((o) => {
            const blocked = active >= MAX_ACTIVE ? "所有頭数の上限です" : save.player.money < o.price ? "所持金が足りません" : null;
            return (
              <OfferCard key={o.offerId} offer={o} week={save.week}>
                <button className="btn btn-primary" disabled={!!blocked} onClick={() => setBuying(o.offerId)}>
                  購入を検討する
                </button>
                {blocked && <span className="hint">{blocked}</span>}
              </OfferCard>
            );
          })}
        </div>
      )}

      {offer && (
        <section className="entry-panel" aria-label="購入の手続き">
          <h2 className="section-title">
            {offer.horse.name}を{yen(offer.price)}で購入
          </h2>
          <p className="hint">預ける厩舎を選んでください。</p>
          <TrainerPicker value={trainer} onChange={setTrainer} />
          <div className="starter-name">
            <label>
              馬名（変えない場合は空欄）
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={12} placeholder={offer.horse.name} />
            </label>
            {nameError && <Notice kind="error">{nameError}</Notice>}
            <div className="manage-actions">
              <button className="btn btn-primary" disabled={!trainer || !!nameError} onClick={buy}>
                購入して預ける
              </button>
              <button className="btn btn-quiet" onClick={() => setBuying(null)}>
                やめる
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
