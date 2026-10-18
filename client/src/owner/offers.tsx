// 販売馬カードと調教師の選択（初期馬選択・馬を買うで共用）。販売馬も表示用データ（OfferVM）だけを使う
import type { ReactNode } from "react";
import { ABILITY_KEYS, TRAINERS } from "@owners/shared";
import { yen } from "./ui";
import type { OfferVM } from "./vm";

export function OfferCard({ o, picked, onPick, children, free }: { o: OfferVM; picked?: boolean; onPick?: () => void; children?: ReactNode; free?: boolean }) {
  const seen = ABILITY_KEYS.map((k) => o.view.knowledge[k]).filter((x) => x.evidenceCount > 0);
  const body = (
    <>
      <span className="offer-top">
        <span className="horse-name">{o.view.name}</span>
        <span className="pill">{o.age}歳</span>
      </span>
      <span className="offer-ped">
        父 {o.view.sireName ?? "—"}／母 {o.view.damName ?? "—"}
      </span>
      <span className="offer-notes2">
        {seen.length === 0 ? (
          <span className="muted">下見の資料はほとんどありません</span>
        ) : (
          seen.map((x) => (
            <span key={x.key}>
              <b>{x.label}</b>
              {x.comment}
            </span>
          ))
        )}
      </span>
      <span className="offer-price">{free ? "無償（最初の1頭）" : yen(o.price)}</span>
    </>
  );
  if (onPick)
    return (
      <button className="offer2" role="radio" aria-checked={!!picked} onClick={onPick}>
        {body}
        {children}
      </button>
    );
  return (
    <div className="offer2">
      {body}
      {children}
    </div>
  );
}

export function TrainerChoice({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="trainer-list" role="radiogroup" aria-label="預託先の調教師">
      {TRAINERS.map((t) => (
        <button key={t.id} role="radio" aria-checked={value === t.id} className="trainer-opt2" onClick={() => onChange(t.id)}>
          <strong>{t.name}</strong>
          <span>
            開業{t.experience}年／得意：{t.specialties.note}
          </span>
          <span>{yen(t.weeklyFee)}／週</span>
        </button>
      ))}
    </div>
  );
}
