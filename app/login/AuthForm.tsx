"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/format";

// 로그인·가입 한 화면. 로그인하지 않은 사람이 어느 화면 주소를 열어도 여기로 온다.
export default function AuthForm() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // 이미 로그인된 상태라면 바로 달력으로
  useEffect(() => {
    api("/api/auth/me").then(() => window.location.replace("/")).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(mode === "login" ? "/api/auth/login" : "/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      window.location.assign("/"); // 전체를 새로 불러와 로그인 이전 상태가 남지 않게 한다
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청 실패");
      setPassword("");
      setBusy(false);
    }
  }

  const isLogin = mode === "login";
  return (
    <div className="auth-wrap">
      <section className="card auth-card">
        <h1 className="auth-title">Plan-Do-See</h1>
        <p className="page-hint">내 계획·실행·회고는 로그인한 본인만 볼 수 있습니다.</p>

        <div className="chips" role="group" aria-label="로그인 또는 가입">
          <button type="button" className={`chip${isLogin ? " on" : ""}`} aria-pressed={isLogin} onClick={() => { setMode("login"); setError(""); }}>로그인</button>
          <button type="button" className={`chip${!isLogin ? " on" : ""}`} aria-pressed={!isLogin} onClick={() => { setMode("signup"); setError(""); }}>가입</button>
        </div>

        <form onSubmit={submit} className="auth-form">
          <label>
            아이디
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={30} required />
            {!isLogin && <span className="muted">영문 소문자·숫자·밑줄(_) 3~30자</span>}
          </label>
          <label>
            비밀번호
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={isLogin ? "current-password" : "new-password"} maxLength={128} required />
            {!isLogin && <span className="muted">8자 이상</span>}
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" disabled={busy}>{busy ? "처리 중…" : isLogin ? "로그인" : "가입하고 시작"}</button>
        </form>
      </section>
    </div>
  );
}
