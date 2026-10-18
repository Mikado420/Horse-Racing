// 最初の1頭を選ぶ（1歳馬3頭から。能力は見えず、下見の印象だけが手がかり）
import { useState } from "react";
import { validateRaceHorseName } from "@owners/shared";
import { Notice } from "../components";
import type { OwnerGame } from "../offline/useOwnerGame";
import { OfferCard, TrainerPicker } from "./offers";

export function StarterPick({ game, onDone }: { game: OwnerGame; onDone: () => void }) {
  const save = game.save!;
  const offers = save.starterOffers ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const [trainer, setTrainer] = useState<string>("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const nameError = name.trim() ? validateRaceHorseName(name) : null;

  const submit = () => {
    if (!picked || !trainer || nameError) return;
    try {
      game.chooseStarter(picked, trainer, name.trim() || null);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="app">
      <main className="main">
        <div className="page">
          <h1 className="page-title">最初の1頭を迎える</h1>
          <p className="lead">
            {save.player.username} さん、ようこそ。牧場から1歳馬を1頭、無償で譲ってもらえることになりました。
            本当の能力は誰にも分かりません。下見の印象を手がかりに選び、預ける厩舎を決めてください。
          </p>
          <div className="starter-list" role="radiogroup" aria-label="候補の馬">
            {offers.map((o) => (
              <OfferCard key={o.offerId} offer={o} week={save.week} picked={picked === o.offerId} onPick={() => setPicked(o.offerId)} />
            ))}
          </div>

          <h2 className="section-title">預ける厩舎</h2>
          <p className="hint">
            調教師ごとに、調教の腕と馬を見る目が違います（数値は公開されていません）。預託料は1頭あたり毎週かかります（0〜1歳のうちは半額）。
          </p>
          <TrainerPicker value={trainer} onChange={setTrainer} />

          <div className="starter-name">
            <label>
              馬名（変えない場合は空欄）
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={12} placeholder={offers.find((o) => o.offerId === picked)?.horse.name ?? "2〜12文字"} />
            </label>
            {nameError && <Notice kind="error">{nameError}</Notice>}
            {error && <Notice kind="error">{error}</Notice>}
            <button className="btn btn-primary" disabled={!picked || !trainer || !!nameError} onClick={submit}>
              この馬を迎えて厩舎に預ける
            </button>
            {(!picked || !trainer) && <p className="hint">馬と厩舎を選んでください。</p>}
          </div>
        </div>
      </main>
    </div>
  );
}
