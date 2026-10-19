import { useState, type FormEvent } from "react";
import { Notice } from "../components";
import { TitleShell } from "../screens/TitleScreen";
import { validateOwnerName } from "@owners/shared";
import { downloadText, readFileText } from "./saveFile";
import { useUpdateBlocker } from "../pwa/hooks";

export function NewGameScreen({
  loadError,
  broken,
  brokenText,
  onRestore,
  onStart,
  onImport,
  onBack,
}: {
  loadError: string | null;
  /** 読み込めないセーブが残っている（初期化していない） */
  broken?: { canRestore: boolean } | null;
  brokenText?: () => string | null;
  onRestore?: () => void;
  onStart: (name: string) => void;
  onImport: (text: string) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  useUpdateBlocker("form:newgame", name.trim().length > 0);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const err = validateOwnerName(name);
    if (err) return setError(err);
    if (broken && !window.confirm("読み込めなかったセーブの代わりに新しく始めます。読み込めなかったデータは控えとしてこのブラウザに残ります。よろしいですか？")) return;
    onStart(name.trim());
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      onImport(await readFileText(file));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <TitleShell>
      <p className="title-lead">馬主として名乗りを上げ、最初の1頭を迎えましょう。馬の本当の能力は誰にも分かりません。調教師の報告とレースの内容から、才能を見極めていきます。</p>
      {loadError && <Notice kind="error">{loadError}</Notice>}
      {broken && (
        <div className="recover">
          <p className="hint">次のどれかを選んでください。何もしなければデータはそのまま残ります。</p>
          {broken.canRestore && onRestore && (
            <button className="btn btn-primary btn-wide" onClick={onRestore}>
              直前に正常に読み込めた状態に戻す
            </button>
          )}
          {brokenText && (
            <button
              className="btn btn-wide"
              onClick={() => {
                const t = brokenText();
                if (t) downloadText(`owners-save-unreadable-${Date.now()}.json`, t);
              }}
            >
              読み込めなかったデータをファイルに書き出す
            </button>
          )}
        </div>
      )}
      <form className="form" onSubmit={submit}>
        <label>
          オーナー名
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={12} placeholder="1〜12文字" autoFocus />
        </label>
        {error && <Notice kind="error">{error}</Notice>}
        <button className="btn btn-primary btn-wide">はじめる</button>
      </form>
      <label className="file-pick">
        セーブファイルから続ける
        <input type="file" accept="application/json,.json" onChange={(e) => importFile(e.target.files?.[0])} />
      </label>
      <button className="link" onClick={onBack}>
        モード選択に戻る
      </button>
    </TitleShell>
  );
}
