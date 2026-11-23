"use client";
import { useState } from "react";
import { api } from "@/lib/format";
import { PageHead } from "../ui";

export default function AccountView() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setDone(false);
    try {
      await api("/api/auth/password", { method: "POST", body: JSON.stringify({ current_password: current, new_password: next }) });
      setCurrent("");
      setNext("");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "변경 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title="내 계정" hint="비밀번호를 바꾸면 다른 기기·이전에 로그인한 곳은 모두 로그아웃됩니다." />
      <section className="card auth-card">
        <h2>비밀번호 변경</h2>
        <form onSubmit={submit} className="auth-form">
          <label>
            현재 비밀번호
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" maxLength={128} required />
          </label>
          <label>
            새 비밀번호
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" maxLength={128} required />
            <span className="muted">8자 이상</span>
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          {done && <p className="muted" role="status">비밀번호를 바꿨습니다. 이전에 발급된 로그인은 모두 해제되었습니다.</p>}
          <button type="submit" disabled={busy}>{busy ? "변경 중…" : "비밀번호 변경"}</button>
        </form>
      </section>
    </>
  );
}
