import { useState, type FormEvent } from "react";
import { api, setToken } from "../api";
import { Notice } from "../components";
import { TitleShell } from "./TitleScreen";

export function LoginScreen({ onLoggedIn, onBack }: { onLoggedIn: () => void; onBack: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = mode === "login" ? await api.login(username, password) : await api.register(username, password);
      setToken(res.token);
      onLoggedIn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <TitleShell>
        <p className="title-lead">ほかのオーナーと同じレースで競います。</p>
        <form className="form" onSubmit={submit}>
          <label>
            ユーザー名
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="半角英数字 3〜16文字"
              required
            />
          </label>
          <label>
            パスワード
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder="8文字以上"
              required
            />
          </label>
          {error && <Notice kind="error">{error}</Notice>}
          <button className="btn btn-primary btn-wide" disabled={busy}>
            {mode === "login" ? "ログイン" : "オーナー登録"}
          </button>
        </form>
        <button className="link" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "はじめての方はオーナー登録" : "登録済みの方はログイン"}
        </button>
        <p className="hint">オンライン対戦にはゲームサーバー（npm run dev:server）の起動が必要です。</p>
        <button className="link" onClick={onBack}>
          モード選択に戻る
        </button>
  </TitleShell>
  );
}
