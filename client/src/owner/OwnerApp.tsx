// オフライン版（馬主モード）の画面全体：画面遷移・共通の通知と確認・レース観戦への切り替え
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { OwnerRaceOutcome, Tactics } from "@owners/shared";
import "./v4.css";
import { NewGameScreen } from "../offline/NewGameScreen";
import type { OwnerGame } from "../offline/useOwnerGame";
import { AppShell } from "./AppShell";
import { OwnerCtx, tabOf, type Nav, type NavTab, type OwnerCtxValue, type Route } from "./context";
import { BottomSheet, FeedbackProvider, type ToastKind } from "./feedback";
import { playSound, type SoundId } from "./sound";
import { useUiState } from "./uiState";
import { buildVM, todos } from "./vm";
import { StarterPick } from "./StarterPick";
import { OwnerHome } from "./OwnerHome";
import { HorsesScreen } from "./HorsesScreen";
import { ShopScreen } from "./ShopScreen";
import { StableScreen } from "./StableScreen";
import { RaceEntry } from "./RaceEntry";
import { RecordsScreen } from "./RecordsScreen";
import { RaceViewer } from "./RaceViewer";
import { SettingsPanel } from "./SettingsPanel";
import { TodoList } from "./OwnerHome";
import { useToast } from "./feedback";
import { APP_VERSION, takeUpdatedFlag, useUpdateState } from "../pwa/update";

const TAB_ROOT: Record<NavTab, Route> = {
  home: { tab: "home" },
  horses: { tab: "horses" },
  stable: { tab: "stable", sub: "training" },
  race: { tab: "race" },
  records: { tab: "records", sub: "races" },
};

export interface RunningRace {
  outcome: OwnerRaceOutcome;
  discoveries: string[];
}

/** 画面本体の中でスクロールしている場所（本体と、タブの中身などのスクロール領域）の位置を控える */
function captureScroll(): number[] {
  const main = document.getElementById("main");
  if (!main) return [];
  return [main, ...Array.from(main.querySelectorAll<HTMLElement>(".scroll, .screen"))].map((el) => el.scrollTop);
}
function restoreScroll(pos: number[]) {
  const main = document.getElementById("main");
  if (!main || !pos.length) return;
  [main, ...Array.from(main.querySelectorAll<HTMLElement>(".scroll, .screen"))].forEach((el, i) => {
    if (pos[i] !== undefined) el.scrollTop = pos[i];
  });
}

/**
 * 画面遷移。戻る操作（画面内の戻る・端末の戻る）で前の画面と選択状態に戻る。
 * 一覧から詳細へ進んで戻ったときは、一覧のスクロール位置も元に戻す
 */
function useNavStack(): Nav {
  const [stack, setStack] = useState<Route[]>([{ tab: "home" }]);
  const ref = useRef(stack);
  ref.current = stack;
  const scrolls = useRef<number[][]>([]);
  const prevLen = useRef(1);
  useLayoutEffect(() => {
    if (stack.length < prevLen.current) {
      const pos = scrolls.current[stack.length - 1];
      if (pos) requestAnimationFrame(() => restoreScroll(pos));
    }
    prevLen.current = stack.length;
  }, [stack]);
  useEffect(() => {
    const onPop = () => {
      if (ref.current.length > 1) setStack((s) => s.slice(0, -1));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return useMemo<Nav>(
    () => ({
      route: stack[stack.length - 1],
      canBack: stack.length > 1,
      push: (r) => {
        try {
          history.pushState({ owners: true }, "");
        } catch {
          /* 履歴が使えなくても画面内の戻るは動く */
        }
        scrolls.current[ref.current.length - 1] = captureScroll();
        setStack((s) => [...s, r]);
      },
      replace: (r) => setStack((s) => [...s.slice(0, -1), r]),
      switchTab: (t) => {
        scrolls.current = [];
        setStack([TAB_ROOT[t]]);
      },
      back: () => {
        if (ref.current.length <= 1) return;
        try {
          history.back();
        } catch {
          setStack((s) => s.slice(0, -1));
        }
      },
    }),
    [stack],
  );
}

export function OwnerApp({ game, onSwitchMode }: { game: OwnerGame; onSwitchMode: () => void }) {
  const { ui, update } = useUiState();
  const settings = ui.settings;
  const sound = useCallback((id: SoundId) => settings.sound && playSound(id), [settings.sound]);
  const onToastSound = useCallback((k: ToastKind) => (k === "gold" ? sound("win") : k === "good" ? sound("report") : undefined), [sound]);

  useEffect(() => {
    document.documentElement.classList.toggle("fx-reduced", settings.effects === "reduced");
  }, [settings.effects]);

  return (
    <FeedbackProvider onSound={onToastSound}>
      <OwnerInner game={game} onSwitchMode={onSwitchMode} ui={ui} update={update} sound={sound} />
    </FeedbackProvider>
  );
}

function OwnerInner({
  game,
  onSwitchMode,
  ui,
  update,
  sound,
}: {
  game: OwnerGame;
  onSwitchMode: () => void;
  ui: ReturnType<typeof useUiState>["ui"];
  update: ReturnType<typeof useUiState>["update"];
  sound: (id: SoundId) => void;
}) {
  const nav = useNavStack();
  const toast = useToast();
  // 新しいバージョンに切り替わった直後なら知らせる（セーブは通常どおり読み込み済み）
  useEffect(() => {
    const from = takeUpdatedFlag();
    if (from && game.save && !game.loadError) toast(`新しいバージョン（${APP_VERSION}）に更新しました。セーブデータはそのままです`, "good");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 新しいバージョンの準備ができたら一度だけ知らせる（切り替えは上部の更新ボタンか、安全なときに自動で）
  const upd = useUpdateState();
  const watching = upd.blockers.some((b) => b.startsWith("race"));
  const toldReady = useRef(false);
  useEffect(() => {
    if (upd.status !== "ready" || watching || toldReady.current) return;
    toldReady.current = true;
    toast("新しいバージョンの準備ができました。上部の更新ボタンで切り替えられます（セーブデータはそのまま）", "info");
  }, [upd.status, watching]); // eslint-disable-line react-hooks/exhaustive-deps
  // ほかのタブで保存された内容を読み込んだら知らせる
  const syncs = game.externalSyncs;
  useEffect(() => {
    if (syncs > 0) toast("別のタブでの変更を読み込みました", "info");
  }, [syncs]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sheet, setSheet] = useState<"notices" | "settings" | null>(null);
  const [running, setRunning] = useState<RunningRace | null>(null);
  const save = game.save;
  const saveKey = save?.createdAt ?? "";
  const read = useMemo(() => new Set(ui.readReports[saveKey] ?? []), [ui.readReports, saveKey]);
  const vm = useMemo(() => (save ? buildVM(save, read) : null), [save, read]);

  const markRead = useCallback(
    (ids: string[]) =>
      update((u) => {
        const cur = new Set(u.readReports[saveKey] ?? []);
        let changed = false;
        for (const id of ids) if (!cur.has(id)) (cur.add(id), (changed = true));
        return changed ? { ...u, readReports: { ...u.readReports, [saveKey]: [...cur] } } : u;
      }),
    [update, saveKey],
  );

  const startRace = useCallback(
    (horseId: string, programId: string, tactics: Tactics) => {
      const before = new Set(game.save!.horses.find((h) => h.id === horseId)!.knowledge.events);
      const outcome = game.runRace(horseId, programId, tactics);
      const after = outcome.save.horses.find((h) => h.id === horseId)!.knowledge.events;
      const discoveries = after.filter((e) => !before.has(e)).map((e) => e.text);
      update((u) => ({ ...u, opinions: { ...u.opinions, [outcome.record.raceId]: { stance: outcome.opinion.stance, reasons: outcome.opinion.reasons } } }));
      sound("start");
      setRunning({ outcome, discoveries });
      return outcome;
    },
    [game, update, sound],
  );

  if (!save || !vm) {
    return (
      <NewGameScreen
        loadError={game.loadError}
        broken={game.broken}
        brokenText={game.brokenText}
        onRestore={() => {
          try {
            game.restoreBackup();
          } catch (e) {
            window.alert((e as Error).message);
          }
        }}
        onStart={(n) => {
          game.newGame(n);
          nav.switchTab("home");
        }}
        onImport={(t) => game.importText(t)}
        onBack={onSwitchMode}
      />
    );
  }
  if (save.starterOffers) return <StarterPick game={game} />;

  const ctx: OwnerCtxValue = {
    game,
    save,
    vm,
    nav,
    ui,
    setSettings: (p) => update((u) => ({ ...u, settings: { ...u.settings, ...p } })),
    markRead,
    startRace,
    sound,
    openSettings: () => setSheet("settings"),
  };

  if (running) {
    return (
      <OwnerCtx.Provider value={ctx}>
        <RaceViewer
          running={running}
          onExit={(to) => {
            setRunning(null);
            if (to === "analysis") nav.switchTab("records"), nav.push({ tab: "records", sub: "analysis", raceId: running.outcome.record.raceId });
            else if (to === "horse") nav.switchTab("horses"), nav.push({ tab: "horses", horseId: running.outcome.record.horseId, detail: true, horseTab: "ability" });
            else nav.switchTab(to === "home" ? "home" : "race");
          }}
        />
      </OwnerCtx.Provider>
    );
  }

  const items = todos(save, vm);
  const r = nav.route;
  const unread = vm.reports.filter((x) => x.unread).length;
  return (
    <OwnerCtx.Provider value={ctx}>
      <AppShell
        nav={nav}
        status={{
          week: save.week,
          money: save.player.money,
          owner: save.player.username,
          notices: items.filter((t) => t.importance !== "normal").length,
          urgent: items.some((t) => t.importance === "urgent"),
          savedAt: save.updatedAt,
          saveError: !!game.storageError,
        }}
        onNotices={() => setSheet("notices")}
        onSettings={() => setSheet("settings")}
        badges={{ home: items.filter((t) => t.importance === "urgent").length, stable: unread }}
      >
        {r.tab === "home" && <OwnerHome key="home" />}
        {r.tab === "horses" && <HorsesScreen key={`horses-${r.detail ? r.horseId : "list"}`} route={r} />}
        {r.tab === "shop" && <ShopScreen />}
        {r.tab === "stable" && <StableScreen route={r} />}
        {r.tab === "race" && <RaceEntry key={`race-${r.horseId ?? ""}`} route={r} />}
        {r.tab === "records" && <RecordsScreen route={r} />}
      </AppShell>
      {sheet === "notices" && (
        <BottomSheet title="お知らせ" onClose={() => setSheet(null)}>
          <TodoList items={items} onAct={() => setSheet(null)} />
        </BottomSheet>
      )}
      {sheet === "settings" && (
        <BottomSheet title="設定" onClose={() => setSheet(null)}>
          <SettingsPanel onSwitchMode={onSwitchMode} />
        </BottomSheet>
      )}
      {game.notice && <NoticeToast text={game.notice} onDone={game.dismissNotice} />}
    </OwnerCtx.Provider>
  );
}

/** 起動時のお知らせ（旧形式からの引き継ぎなど）。一度だけ表示 */
function NoticeToast({ text, onDone }: { text: string; onDone: () => void }) {
  return (
    <BottomSheet title="お知らせ" onClose={onDone} actions={<button className="btn btn-primary" onClick={onDone}>閉じる</button>}>
      <p>{text}</p>
    </BottomSheet>
  );
}

export { tabOf };
