// 設定：演出・効果音・描画品質・セーブデータ
import { useState } from "react";
import { downloadText, readFileText, saveFileName } from "../offline/saveFile";
import { useOwner } from "./context";
import { useConfirm, useToast } from "./feedback";
import { Icon } from "./icons";

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
