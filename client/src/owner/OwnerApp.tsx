// オフライン版（馬主モード）の画面全体
import { useState, type ReactNode } from "react";
import { weekLabel } from "@owners/shared";
import { Notice } from "../components";
import { yen } from "../format";
import { NewGameScreen } from "../offline/NewGameScreen";
import { SaveDataPanel } from "../offline/SaveDataPanel";
import type { OwnerGame } from "../offline/useOwnerGame";
import { StarterPick } from "./StarterPick";
import { OwnerHome } from "./OwnerHome";
import { HorseDetail } from "./HorseDetail";
import { RaceEntry } from "./RaceEntry";
import { AnalysisScreen } from "./AnalysisScreen";
import { TrainersScreen } from "./TrainersScreen";
import { ShopOwner } from "./ShopOwner";
import { RecordsOwner } from "./RecordsOwner";
import { LabOwner } from "./LabOwner";

export type OScreen =
  | { name: "home" }
  | { name: "horse"; horseId: string; tab?: HorseTab }
  | { name: "race"; horseId?: string }
  | { name: "analysis"; raceId?: string; horseId?: string }
  | { name: "trainers" }
  | { name: "shop" }
  | { name: "records" }
  | { name: "lab" };

export type HorseTab = "eval" | "policy" | "races" | "history" | "manage";

const NAV: [OScreen["name"], string][] = [
  ["home", "馬主"],
  ["race", "出走"],
  ["analysis", "分析"],
  ["trainers", "厩舎"],
  ["shop", "馬を買う"],
  ["records", "記録"],
  ["lab", "検証"],
];

export function OwnerApp({ game, onSwitchMode }: { game: OwnerGame; onSwitchMode: () => void }) {
  const [screen, setScreen] = useState<OScreen>({ name: "home" });
  const save = game.save;

  if (!save) {
    return (
      <NewGameScreen
        loadError={game.loadError}
        onStart={(n) => {
          game.newGame(n);
          setScreen({ name: "home" });
        }}
        onImport={(t) => game.importText(t)}
        onBack={onSwitchMode}
      />
    );
  }
  if (save.starterOffers) return <StarterPick game={game} onDone={() => setScreen({ name: "home" })} />;

  const go = (s: OScreen) => {
    setScreen(s);
    window.scrollTo?.(0, 0);
  };

  return (
    <OwnerShell screen={screen} go={go} owner={save.player.username} money={save.player.money} week={save.week}>
      {game.notice && (
        <div className="page page-notice">
          <Notice kind="good">
            {game.notice}{" "}
            <button className="link" onClick={game.dismissNotice}>
              閉じる
            </button>
          </Notice>
        </div>
      )}
      {game.storageError && (
        <div className="page page-notice">
          <Notice kind="error">{game.storageError}</Notice>
        </div>
      )}
      {screen.name === "home" && <OwnerHome game={game} go={go} footer={<SaveDataPanel game={game} onSwitchMode={onSwitchMode} />} />}
      {screen.name === "horse" && <HorseDetail key={screen.horseId} game={game} horseId={screen.horseId} tab={screen.tab ?? "eval"} go={go} />}
      {screen.name === "race" && <RaceEntry game={game} initialHorseId={screen.horseId} go={go} />}
      {screen.name === "analysis" && <AnalysisScreen game={game} raceId={screen.raceId} horseId={screen.horseId} go={go} />}
      {screen.name === "trainers" && <TrainersScreen game={game} go={go} />}
      {screen.name === "shop" && <ShopOwner game={game} go={go} />}
      {screen.name === "records" && <RecordsOwner game={game} go={go} />}
      {screen.name === "lab" && <LabOwner />}
    </OwnerShell>
  );
}

function OwnerShell({
  screen,
  go,
  owner,
  money,
  week,
  children,
}: {
  screen: OScreen;
  go: (s: OScreen) => void;
  owner: string;
  money: number;
  week: number;
  children: ReactNode;
}) {
  return (
    <div className={`app ${screen.name === "race" ? "app-race" : ""}`}>
      <header className="topbar">
        <button className="brand" onClick={() => go({ name: "home" })}>
          競走馬オーナーズ
          <span className="mode-badge mode-offline">馬主</span>
        </button>
        <nav className="topnav" aria-label="メインメニュー">
          {NAV.map(([name, label]) => (
            <button key={name} aria-current={screen.name === name} onClick={() => go({ name } as OScreen)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="purse" title="所持金">
          <span className="purse-owner">
            {owner} ・ {weekLabel(week)}
          </span>
          <strong className={money < 0 ? "minus" : ""}>{yen(money)}</strong>
        </div>
      </header>
      <main className="main">{children}</main>
    </div>
  );
}
