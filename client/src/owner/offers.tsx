// 販売馬のカードと、預託先の調教師を選ぶ部品（初期馬選択・馬を買う・転厩で共用）
import {
  ABILITY_KEYS,
  TRAINERS,
  ageAt,
  toHorseView,
  type OwnerMarketOffer,
  type Trainer,
} from "@owners/shared";
import type { ReactNode } from "react";
import { yen } from "../format";

export function OfferCard({
  offer,
  week,
  picked,
  onPick,
  showPrice = true,
  children,
}: {
  offer: OwnerMarketOffer;
  week: number;
  picked?: boolean;
  onPick?: () => void;
  showPrice?: boolean;
  children?: ReactNode;
}) {
  const v = toHorseView(offer.horse, week);
  const seen = ABILITY_KEYS.map((k) => v.knowledge[k]).filter((x) => x.evidenceCount > 0);
  const Tag = onPick ? "button" : "div";
  return (
    <Tag
      className={`starter offer ${picked ? "is-picked" : ""}`}
      {...(onPick ? { onClick: onPick, role: "radio", "aria-checked": !!picked } : {})}
    >
      <span className="starter-head">
        <strong>{offer.horse.name}</strong>
        <span className="tag">{ageAt(offer.horse, week)}歳</span>
      </span>
      <span className="offer-pedigree muted">
        父 {offer.horse.sireName ?? "—"} ／ 母 {offer.horse.damName ?? "—"}
      </span>
      <span className="offer-notes">
        <span className="offer-notes-title">下見の印象</span>
        {seen.length === 0 ? (
          <span className="muted">下見の資料はほとんどない</span>
        ) : (
          <ul>
            {seen.map((x) => (
              <li key={x.key}>
                <span className="muted">{x.label}：</span>
                {x.comment}
              </li>
            ))}
          </ul>
        )}
      </span>
      {showPrice && <span className="shop-price">{offer.price === 0 ? "無償（最初の1頭）" : yen(offer.price)}</span>}
      {children}
    </Tag>
  );
}

export function TrainerPicker({ value, onChange, exclude }: { value: string; onChange: (id: string) => void; exclude?: string }) {
  return (
    <div className="trainer-pick" role="radiogroup" aria-label="預託先の調教師">
      {TRAINERS.filter((t) => t.id !== exclude).map((t) => (
        <TrainerOption key={t.id} t={t} picked={value === t.id} onPick={() => onChange(t.id)} />
      ))}
    </div>
  );
}

function TrainerOption({ t, picked, onPick }: { t: Trainer; picked: boolean; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={picked} className={`trainer-opt ${picked ? "is-picked" : ""}`} onClick={onPick}>
      <strong>{t.name}</strong>
      <span className="muted">
        開業{t.experience}年 ・ 得意：{t.specialties.note}
      </span>
      <span>預託料 {yen(t.weeklyFee)}／週</span>
    </button>
  );
}
