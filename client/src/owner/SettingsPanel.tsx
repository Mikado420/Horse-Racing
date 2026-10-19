// 設定：演出・効果音・描画品質・セーブデータ
import { useState } from "react";
import { downloadText, readFileText, saveFileName } from "../offline/saveFile";
import { useOwner } from "./context";
import { useConfirm, useToast } from "./feedback";
import { Icon } from "./icons";
import { APP_VERSION, BUILD_TIME, check, detectPlatform, promptInstall, requestApply, useUpdateState } from "../pwa/update";
import { blockerLabel } from "../pwa/policy";

export function SettingsPanel({ onSwitchMode }: { onSwitchMode: () => void }) {
  const { ui, setSettings, game, save } = useOwner();
  const s = ui.settings;
  const confirm = useConfirm();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  const seg = <T extends string | number | boolean>(label: string, value: T, options: [T, string][], on: (v: T) => void, hint?: string) => (
    <div className="setting">
      <span className="setting-label">{label}</span>
      <div className="seg2" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={String(v)} role="radio" aria-checked={value === v} onClick={() => on(v)}>
            {l}
          </button>
        ))}
      </div>
      {hint && <p className="hint2">{hint}</p>}
    </div>
  );

  return (
    <div className="settings">
      {seg("演出", s.effects, [["standard", "標準"], ["reduced", "簡略"]], (v) => setSettings({ effects: v }), "簡略にすると動きを最小限にします（端末の「視差効果を減らす」設定にも従います）")}
      {seg(
        "効果音",
        s.sound,
        [[false, "オフ"], [true, "オン"]],
        (v) => {
          setSettings({ sound: v });
          if (v) import("./sound").then((m) => m.playSound("tap"));
        },
        "音がなくても、すべての情報は画面で分かります",
      )}
      {seg("3D描画", s.quality, [["high", "高品質"], ["low", "軽量"]], (v) => setSettings({ quality: v }), "動きが重いときは軽量にしてください")}
      {seg("レースの再生速度", s.replaySpeed, [[1, "等速"], [2, "2倍"], [4, "4倍"]], (v) => setSettings({ replaySpeed: v }))}

      <AppSection />

      <h3 className="settings-sub">セーブデータ</h3>
      <p className="hint2">
        操作のたびにこのブラウザへ自動保存しています（最終保存 {new Date(save.updatedAt).toLocaleString("ja-JP")}）。別の端末へ移すときはファイルに書き出してください。
      </p>
      {game.storageError && <p className="error-text">{game.storageError}</p>}
      {error && <p className="error-text">{error}</p>}
      <div className="btn-row">
        <button
          className="btn btn-ghost"
          onClick={() => {
            downloadText(saveFileName(save.player.username), game.exportText());
            toast("セーブファイルを書き出しました", "good");
          }}
        >
          <Icon name="save" />
          ファイルに書き出す
        </button>
        <label className="btn btn-ghost file-label">
          ファイルから読み込む
          <input
            type="file"
            accept="application/json,.json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (!(await confirm({ title: "セーブデータを読み込む", body: "今のデータを、選んだファイルの内容で置き換えます。", okLabel: "置き換える", danger: true }))) return;
              try {
                game.importText(await readFileText(file));
                setError(null);
                toast("セーブファイルを読み込みました", "good");
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          />
        </label>
        <button
          className="btn btn-ghost btn-danger-text"
          onClick={async () => {
            if (await confirm({ title: "最初からやり直す", body: "このブラウザのセーブデータを消して最初からやり直します。元に戻せません。", okLabel: "消してやり直す", danger: true })) game.reset();
          }}
        >
          最初からやり直す
        </button>
        <button className="btn btn-ghost" onClick={onSwitchMode}>
          モード選択に戻る
        </button>
      </div>
    </div>
  );
}

const STATUS_TEXT: Record<string, string> = {
  unsupported: "このブラウザ（または開発環境）では自動更新を使いません",
  idle: "最新の状態です",
  checking: "更新を確認しています",
  downloading: "新しいバージョンを裏で取得しています（このまま遊べます）",
  ready: "新しいバージョンの準備ができました",
  applying: "更新しています",
};

/** アプリの情報：バージョン・更新・ホーム画面への追加 */
function AppSection() {
  const u = useUpdateState();
  const platform = detectPlatform();
  const toast = useToast();
  return (
    <>
      <h3 className="settings-sub">アプリ</h3>
      <div className="app-info">
        <span>
          バージョン <strong>{APP_VERSION}</strong>
          {BUILD_TIME && <span className="muted">（{new Date(BUILD_TIME).toLocaleString("ja-JP")}）</span>}
        </span>
        <span>
          {STATUS_TEXT[u.status]}
          {u.status === "ready" && u.requested && u.blockers.length > 0 && `。${blockerLabel(u.blockers[0])}のため、終わってから切り替えます`}
        </span>
        {u.lastError && <span className="muted">{u.lastError}（今のバージョンのまま遊べます）</span>}
        {u.offlineReady && <span className="muted">オフラインでも起動できます（ひとりで遊ぶモード）</span>}
        {u.lastCheck && <span className="muted">最終確認 {new Date(u.lastCheck).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</span>}
      </div>
      <div className="btn-row">
        {u.status === "ready" ? (
          <button className="btn btn-primary" onClick={requestApply}>
            <Icon name="spark" />
            更新を適用
          </button>
        ) : (
          <button className="btn btn-ghost" disabled={u.status === "unsupported" || u.status === "checking" || u.status === "applying"} onClick={() => void check("manual")}>
            更新を確認
          </button>
        )}
      </div>
      <p className="hint2">新しいバージョンは自動で取得され、レースや処理の途中を避けて切り替わります。セーブデータは更新しても消えません。</p>

      {!u.standalone && (
        <>
          <h3 className="settings-sub">ホーム画面に追加</h3>
          {u.canPrompt ? (
            <button
              className="btn btn-ghost"
              onClick={async () => {
                if (await promptInstall()) toast("ホーム画面に追加しました", "good");
              }}
            >
              ホーム画面に追加する
            </button>
          ) : platform === "ios" ? (
            <ol className="install-steps">
              <li>Safari で開き、画面下（iPadは上）の共有ボタンを押します</li>
              <li>「ホーム画面に追加」を選びます</li>
              <li>ホーム画面のアイコンから起動すると、アプリのように全画面で遊べます</li>
            </ol>
          ) : platform === "android" ? (
            <ol className="install-steps">
              <li>Chrome のメニュー（右上の︙）を開きます</li>
              <li>「ホーム画面に追加」または「アプリをインストール」を選びます</li>
            </ol>
          ) : (
            <p className="hint2">ブラウザのメニューやアドレスバーに「インストール」「ホーム画面に追加」があれば、アプリのように起動できます。表示されない場合は、このままブラウザで遊べます。</p>
          )}
          <p className="hint2">表示や手順はブラウザや OS の種類・バージョンによって異なります。</p>
        </>
      )}
    </>
  );
}
