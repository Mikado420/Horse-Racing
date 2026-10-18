import type { ReactNode } from "react";
import { OFFLINE_ONLY, type GameMode } from "../backend";

/** タイトル画面の背景（8色のゼッケンが走り出す帯） */
export function TitleShell({ children }: { children: ReactNode }) {
  return (
    <div className="title-screen">
      <div className="title-art" aria-hidden>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((g) => (
          <span key={g} className={`title-lane lane-${g}`} />
        ))}
      </div>
      <div className="title-panel">
        <h1 className="title-logo">
          <span>オンライン</span>競走馬オーナーズ
        </h1>
        {children}
      </div>
    </div>
  );
}

export function TitleScreen({ onPick }: { onPick: (m: GameMode) => void }) {
  return (
    <TitleShell>
      <p className="title-lead">馬主として馬を厩舎に預け、隠れた才能を見極め、レースで結果を出す。</p>
      <div className="mode-pick">
        <button className="btn btn-primary btn-wide mode-btn" onClick={() => onPick("offline")}>
          <strong>ひとりで遊ぶ</strong>
          <span>馬主として厩舎に預け、CPU馬と競う。データはこのブラウザに保存されます</span>
        </button>
        {OFFLINE_ONLY ? (
          <p className="hint">この公開版はひとりで遊ぶモードのみです。オンライン対戦はゲームサーバーを起動した環境で遊べます。</p>
        ) : (
          <button className="btn btn-wide mode-btn" onClick={() => onPick("online")}>
            <strong>オンライン対戦</strong>
            <span>ゲームサーバーに接続して、ほかのオーナーと同じレースに出走します</span>
          </button>
        )}
      </div>
    </TitleShell>
  );
}
