// AppShell：上部ステータスバー・主要メニュー・画面本体。
// 横向きの低い画面では左に細いメニュー、縦向きでは下にメニュー（CSSで切り替え、DOMは同じ）。
import type { ReactNode } from "react";
import { weekLabel, shortWeekLabel } from "@owners/shared";
import { Icon, type IconName } from "./icons";
import { tabOf, type Nav, type NavTab } from "./context";
import { yen } from "./ui";

export const NAV_ITEMS: [NavTab, string, IconName][] = [
  ["home", "ホーム", "home"],
  ["horses", "所有馬", "horse"],
  ["stable", "厩舎", "stable"],
  ["race", "出走", "race"],
  ["records", "記録・分析", "chart"],
];

export interface StatusInfo {
  week: number;
  money: number;
  owner: string;
  notices: number;
  urgent: boolean;
  savedAt: string | null;
  saveError: boolean;
}

export function AppShell({ nav, status, onNotices, onSettings, badges, children }: { nav: Nav; status: StatusInfo; onNotices: () => void; onSettings: () => void; badges: Partial<Record<NavTab, number>>; children: ReactNode }) {
  return (
    <div className="shell">
      <TopStatusBar s={status} onNotices={onNotices} onSettings={onSettings} />
      <PrimaryNavigation nav={nav} badges={badges} />
      <main className="stage" id="main">
        {children}
      </main>
    </div>
  );
}

export function TopStatusBar({ s, onNotices, onSettings }: { s: StatusInfo; onNotices: () => void; onSettings: () => void }) {
  const saved = s.saveError ? "保存できません" : s.savedAt ? `保存済み ${new Date(s.savedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}` : "保存済み";
  return (
    <header className="topbar2">
      <span className="brand2" aria-label="競走馬オーナーズ">
        <span className="brand-mark" aria-hidden>
          O
        </span>
        <span className="brand-name">オーナーズ</span>
      </span>
      <span className="status-week" title={weekLabel(s.week)}>
        <Icon name="clock" size={16} />
        <span className="long">{weekLabel(s.week)}</span>
        <span className="short">{shortWeekLabel(s.week)}</span>
      </span>
      <span className={`status-money ${s.money < 0 ? "is-minus" : ""}`}>
        <Icon name="coin" size={16} />
        {yen(s.money)}
      </span>
      <span className={`status-save ${s.saveError ? "is-error" : ""}`} title={saved}>
        <Icon name={s.saveError ? "alert" : "save"} size={16} />
        <span className="long">{saved}</span>
      </span>
      <button className={`status-btn ${s.urgent ? "is-urgent" : ""}`} onClick={onNotices} aria-label={`お知らせ ${s.notices}件`}>
        <Icon name="bell" />
        <span className="status-btn-label">お知らせ</span>
        {s.notices > 0 && <span className="count">{s.notices}</span>}
      </button>
      <button className="status-btn" onClick={onSettings} aria-label="設定">
        <Icon name="gear" />
        <span className="status-btn-label">設定</span>
      </button>
    </header>
  );
}

export function PrimaryNavigation({ nav, badges }: { nav: Nav; badges: Partial<Record<NavTab, number>> }) {
  const current = tabOf(nav.route);
  return (
    <nav className="primary-nav" aria-label="主要メニュー">
      {NAV_ITEMS.map(([id, label, icon]) => (
        <button key={id} className="nav-item" aria-current={current === id ? "page" : undefined} onClick={() => nav.switchTab(id)}>
          <span className="nav-icon">
            <Icon name={icon} size={22} />
            {!!badges[id] && <span className="nav-badge">{badges[id]}</span>}
          </span>
          <span className="nav-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}

/** 画面の見出し行（戻るボタン付き） */
export function ScreenHead({ title, nav, sub, right }: { title: string; nav?: Nav; sub?: ReactNode; right?: ReactNode }) {
  return (
    <header className="screen-head">
      {nav?.canBack && (
        <button className="icon-btn back-btn" onClick={nav.back} aria-label="戻る">
          <Icon name="back" />
          <span>戻る</span>
        </button>
      )}
      <div className="screen-title">
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {right && <div className="screen-right">{right}</div>}
    </header>
  );
}
