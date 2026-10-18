import { useState, type FormEvent } from "react";
import { Notice } from "../components";
import { TitleShell } from "../screens/TitleScreen";
import { validateOwnerName } from "./engine";
import { readFileText } from "./saveFile";

export function NewGameScreen({
  loadError,
  onStart,
  onImport,
  onBack,
}: {
  loadError: string | null;
  onStart: (name: string) => void;
  onImport: (text: string) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const err = validateOwnerName(name);
    if (err) return setError(err);
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
      <p className="title-lead">厩舎の名前を決めて、最初の1頭を迎えましょう。</p>
      {loadError && <Notice kind="error">{loadError}</Notice>}
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
