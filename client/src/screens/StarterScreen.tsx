import { useEffect, useState } from "react";
import {
  STAT_KEYS,
  STAT_LABELS,
  STYLE_LABELS,
  validateHorseName,
  type PlayerProfile,
  type StarterTemplate,
} from "@owners/shared";
import { api } from "../api";
import { Notice, StatBar } from "../components";

const NAME_IDEAS = ["ミドリノカゼ", "ハルカゼダイヤ", "サクラコンパス", "ユウヒノテラス", "アオイホシ", "シロガネステップ"];

export function StarterScreen({ player, onSelected }: { player: PlayerProfile; onSelected: () => void }) {
  const [templates, setTemplates] = useState<StarterTemplate[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [name, setName] = useState(() => NAME_IDEAS[Math.floor(Math.random() * NAME_IDEAS.length)]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.gameInfo().then((g) => setTemplates(g.starters), (e) => setError(e.message));
  }, []);

  const nameError = validateHorseName(name);

  const submit = async () => {
    if (!picked || nameError) return;
    setBusy(true);
    setError(null);
    try {
      await api.selectStarter(picked, name.trim());
      onSelected();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">最初の1頭を選ぶ</h1>
      <p className="lead">
        {player.username} さん、ようこそ。厩舎に迎える馬を1頭選んで名前をつけてください。能力には少しずつ個体差が出ます。
      </p>
      <div className="starter-list" role="radiogroup" aria-label="初期馬">
        {templates.map((t) => (
          <button
            key={t.id}
            role="radio"
            aria-checked={picked === t.id}
            className={`starter ${picked === t.id ? "is-picked" : ""}`}
            onClick={() => setPicked(t.id)}
          >
            <span className="starter-head">
              <strong>{t.label}</strong>
              <span className="tag">{STYLE_LABELS[t.style]}</span>
            </span>
            <span className="starter-desc">{t.description}</span>
            <span className="starter-stats">
              {STAT_KEYS.map((k) => (
                <StatBar key={k} label={STAT_LABELS[k]} value={t.base[k]} cap={t.potential[k]} />
              ))}
            </span>
          </button>
        ))}
      </div>
      <div className="starter-name">
        <label>
          馬名
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={12} />
        </label>
        {name && nameError && <Notice kind="error">{nameError}</Notice>}
        {error && <Notice kind="error">{error}</Notice>}
        <button className="btn btn-primary" disabled={!picked || !!nameError || busy} onClick={submit}>
          この馬を迎える
        </button>
      </div>
    </div>
  );
}
