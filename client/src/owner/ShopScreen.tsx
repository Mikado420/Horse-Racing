// 馬を買う：手がかりは年齢・血統・下見の印象・価格だけ。購入は確認してから
import { useState } from "react";
import { MARKET_REFRESH_WEEKS, MAX_ACTIVE, findTrainer, validateRaceHorseName } from "@owners/shared";
import { ScreenHead } from "./AppShell";
import { useOwner } from "./context";
import { BottomSheet, EmptyState, useBusy, useConfirm, useToast } from "./feedback";
import { OfferCard, TrainerChoice } from "./offers";
import { yen } from "./ui";
import { marketVM, type OfferVM } from "./vm";
import { useUpdateBlocker } from "../pwa/hooks";

export function ShopScreen() {
  const { save, vm, game, nav } = useOwner();
  const toast = useToast();
  const confirm = useConfirm();
  const { busy, run } = useBusy();
  const [buying, setBuying] = useState<OfferVM | null>(null);
  const [trainer, setTrainer] = useState("");
  const [name, setName] = useState("");
  const offers = marketVM(save);
  const active = vm.horses.length;
  const untilRefresh = Math.max(1, MARKET_REFRESH_WEEKS - (save.week - save.market.refreshedWeek));
  const nameError = name.trim() ? validateRaceHorseName(name) : null;
  useUpdateBlocker("form:shop", !!buying);

  const buy = () =>
    run(async () => {
      if (!buying || !trainer || nameError) return;
      const t = findTrainer(trainer)!;
      if (!(await confirm({ title: "購入の確認", body: `${buying.view.name}を${yen(buying.price)}で購入し、${t.name}厩舎に預けます。購入後の所持金は${yen(save.player.money - buying.price)}です。`, okLabel: "購入する" }))) return;
      try {
        const h = game.buy(buying.offerId, trainer, name.trim() || null);
        toast(`${h.name}を迎えました`, "good");
        setBuying(null);
        setName("");
        nav.push({ tab: "horses", horseId: h.id, detail: true, horseTab: "overview" });
      } catch (e) {
        toast((e as Error).message, "error");
      }
    });

  return (
    <div className="screen">
      <ScreenHead nav={nav} title="馬を買う" sub={`所有 ${active}/${MAX_ACTIVE}頭／入れ替えまであと${untilRefresh}週`} />
      <p className="hint2 screen-note">能力は買ってから見極めます。価格は評判を反映しますが、才能と一致するとは限りません。</p>
      {offers.length === 0 ? (
        <EmptyState icon="cart" title="今は売りに出ている馬がいません">{untilRefresh}週後に入れ替わります。</EmptyState>
      ) : (
        <div className="scroll">
          <div className="offer-row wrap">
            {offers.map((o) => {
              const blocked = active >= MAX_ACTIVE ? "所有頭数の上限です" : save.player.money < o.price ? "所持金が足りません" : null;
              return (
                <OfferCard key={o.offerId} o={o}>
                  <button className="btn btn-primary btn-block" disabled={!!blocked} onClick={() => setBuying(o)}>
                    購入を検討
                  </button>
                  {blocked && <span className="hint2">{blocked}</span>}
                </OfferCard>
              );
            })}
          </div>
        </div>
      )}
      {buying && (
        <BottomSheet
          title={`${buying.view.name}（${yen(buying.price)}）`}
          onClose={() => setBuying(null)}
          actions={
            <button className="btn btn-primary" disabled={!trainer || !!nameError || busy} onClick={buy}>
              購入して預ける
            </button>
          }
        >
          <h3 className="settings-sub">預ける厩舎</h3>
          <TrainerChoice value={trainer} onChange={setTrainer} />
          <label className="field">
            <span>馬名（変えない場合は空欄）</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={12} placeholder={buying.view.name} />
          </label>
          {nameError && <p className="error-text">{nameError}</p>}
        </BottomSheet>
      )}
    </div>
  );
}
