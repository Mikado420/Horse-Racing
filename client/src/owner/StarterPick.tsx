// 最初の1頭を迎える（3段階：馬を選ぶ → 厩舎を選ぶ → 名前を決める）。どの段階も1画面に収まる
import { useMemo, useState } from "react";
import { findTrainer, validateRaceHorseName } from "@owners/shared";
import type { OwnerGame } from "../offline/useOwnerGame";
import { Icon } from "./icons";
import { OfferCard, TrainerChoice } from "./offers";
import { marketVM } from "./vm";

export function StarterPick({ game }: { game: OwnerGame }) {
  const save = game.save!;
  const offers = useMemo(() => marketVM(save, save.starterOffers ?? []), [save]);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [picked, setPicked] = useState<string | null>(null);
  const [trainer, setTrainer] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const offer = offers.find((o) => o.offerId === picked);
  const nameError = name.trim() ? validateRaceHorseName(name) : null;

  const submit = () => {
    if (!picked || !trainer || nameError || busy) return;
    setBusy(true);
    try {
      game.chooseStarter(picked, trainer, name.trim() || null);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const steps = ["馬を選ぶ", "厩舎を選ぶ", "名前を決める"];
  return (
    <div className="onboard">
      <header className="onboard-head">
        <h1>最初の1頭を迎える</h1>
        <ol className="steps" aria-label="手順">
          {steps.map((s, i) => (
            <li key={s} aria-current={step === i + 1 ? "step" : undefined} className={step > i + 1 ? "is-done" : ""}>
              {step > i + 1 ? <Icon name="check" size={14} /> : <span>{i + 1}</span>}
              {s}
            </li>
          ))}
        </ol>
      </header>
      <div className="onboard-body">
        {step === 1 && (
          <>
            <p className="lead2">牧場から1歳馬を1頭、無償で譲ってもらえます。本当の能力は誰にも分かりません。下見の印象を手がかりに選んでください。</p>
            <div className="offer-row" role="radiogroup" aria-label="候補の馬">
              {offers.map((o) => (
                <OfferCard key={o.offerId} o={o} free picked={picked === o.offerId} onPick={() => setPicked(o.offerId)} />
              ))}
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <p className="lead2">調教師ごとに、調教の腕と馬を見る目が違います（数値は公開されていません）。預託料は毎週かかります（0〜1歳は半額）。</p>
            <TrainerChoice value={trainer} onChange={setTrainer} />
          </>
        )}
        {step === 3 && offer && (
          <div className="onboard-final">
            <label className="field">
              <span>馬名（変えない場合は空欄）</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={12} placeholder={offer.view.name} />
            </label>
            {nameError && <p className="error-text">{nameError}</p>}
            {error && <p className="error-text">{error}</p>}
            <p className="confirm-line">
              {name.trim() || offer.view.name}（{offer.age}歳）を{findTrainer(trainer)?.name}厩舎に預けます。
            </p>
          </div>
        )}
      </div>
      <footer className="action-bar">
        <div className="action-buttons">
          {step > 1 && (
            <button className="btn btn-ghost" onClick={() => setStep((step - 1) as 1 | 2)}>
              戻る
            </button>
          )}
          {step < 3 ? (
            <button className="btn btn-primary" disabled={step === 1 ? !picked : !trainer} onClick={() => setStep((step + 1) as 2 | 3)}>
              次へ
              <Icon name="next" />
            </button>
          ) : (
            <button className="btn btn-primary" disabled={!!nameError || busy} onClick={submit}>
              迎えて厩舎に預ける
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
