"use client";
import { useState } from "react";
import { api } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import { PageHead } from "../ui";

export default function AccountView() {
  const { data: me } = useApi<{ user: { username: string } }>("/api/auth/me");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const [delPw, setDelPw] = useState("");
  const [delName, setDelName] = useState("");
  const [delError, setDelError] = useState("");
  const [delBusy, setDelBusy] = useState(false);

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

  // 계정 삭제: 서버가 비밀번호와 아이디를 다시 확인한 뒤 내 자료를 모두 지운다. 되돌릴 수 없다. (T07-C134)
  async function removeAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!window.confirm("정말 계정을 삭제할까요?\n\n내 계획·할 일·실행 기록·회고·규칙 변경 기록이 모두 함께 지워지고 되돌릴 수 없어요.")) return;
    setDelBusy(true);
    setDelError("");
    try {
      await api("/api/auth/account", { method: "DELETE", body: JSON.stringify({ password: delPw, confirm_username: delName }) });
      window.location.assign("/login");
    } catch (err) {
      setDelError(err instanceof Error ? err.message : "삭제하지 못했어요");
      setDelBusy(false);
    }
  }

  return (
    <>
      <PageHead title="내 계정" hint="비밀번호를 바꾸거나, 자료를 내려받거나, 계정을 지울 수 있어요." />
      <section className="card auth-card">
        <h2>비밀번호 변경</h2>
        <p className="muted">바꾸면 다른 기기·이전에 로그인한 곳은 모두 로그아웃돼요.</p>
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

      <section className="card auth-card danger-zone">
        <h2>계정 삭제</h2>
        <div className="danger-note" role="note">
          <strong>계정을 지우면 내 자료도 함께 지워져요.</strong>
          <ul>
            <li>내 계획, 할 일, 실행 기록, 완료 기록, 회고, 규칙 변경 기록이 <b>모두 삭제</b>돼요.</li>
            <li><b>되돌릴 수 없어요.</b> 지운 뒤에는 같은 아이디로 가입해도 자료가 돌아오지 않아요.</li>
            <li>지우기 전에 <a href="/api/export" download>내 자료를 파일로 내보내기</a>로 받아 두세요.</li>
          </ul>
        </div>
        <form onSubmit={removeAccount} className="auth-form">
          <label>
            확인을 위해 내 아이디를 입력하세요{me ? ` (${me.user.username})` : ""}
            <input value={delName} onChange={(e) => setDelName(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={30} required />
          </label>
          <label>
            비밀번호
            <input type="password" value={delPw} onChange={(e) => setDelPw(e.target.value)} autoComplete="current-password" maxLength={128} required />
          </label>
          {delError && <p className="error" role="alert">{delError}</p>}
          <button type="submit" className="danger" disabled={delBusy || !delName || !delPw}>{delBusy ? "삭제 중…" : "계정과 내 자료 모두 삭제"}</button>
        </form>
      </section>
    </>
  );
}
