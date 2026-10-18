// オフライン：セーブデータの管理（書き出し・読み込み・最初から）
import { useState } from "react";
import { Notice } from "../components";
import { downloadText, readFileText, saveFileName } from "./saveFile";
import type { OfflineGame } from "./useOfflineGame";

export function SaveDataPanel({ game, onSwitchMode }: { game: OfflineGame; onSwitchMode: () => void }) {
  const [msg, setMsg] = useState<{ kind: "good" | "error"; text: string } | null>(null);
  const save = game.save!;

  const exportFile = () => {
    downloadText(saveFileName(save.player.username), game.exportText());
    setMsg({ kind: "good", text: "セーブファイルを書き出しました。" });
  };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    if (!window.confirm("今のデータを、選んだファイルの内容で置き換えます。よろしいですか？")) return;
    try {
      game.importText(await readFileText(file));
      setMsg({ kind: "good", text: "セーブファイルを読み込みました。" });
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  };
  const reset = () => {
    if (!window.confirm("このブラウザのセーブデータを消して最初からやり直します。元に戻せません。よろしいですか？")) return;
    game.reset();
  };

  return (
    <section className="save-panel">
      <h2 className="section-title">セーブデータ</h2>
      <p className="hint">
        操作のたびにこのブラウザへ自動保存しています（最終保存 {new Date(save.updatedAt).toLocaleString("ja-JP")}）。
        別のブラウザへ移すときはファイルに書き出してください。
      </p>
      <div className="save-actions">
        <button className="btn" onClick={exportFile}>
          ファイルに書き出す
        </button>
        <label className="btn file-btn">
          ファイルから読み込む
          <input type="file" accept="application/json,.json" onChange={(e) => importFile(e.target.files?.[0])} />
        </label>
        <button className="btn btn-quiet" onClick={reset}>
          最初からやり直す
        </button>
        <button className="link" onClick={onSwitchMode}>
          モード選択に戻る
        </button>
      </div>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
    </section>
  );
}
