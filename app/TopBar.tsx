"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/format";

// 로그인 화면에서는 아무것도 그리지 않고, 나머지 화면에서는 메뉴 + "누구로 로그인했는지" + 로그아웃을 보여준다.
// 메뉴의 사용자 이름은 화면 표시용일 뿐이고, 자료를 지키는 것은 서버(API)의 로그인·소유자 확인이다.
// usePathname() 은 요청 시점에만 알 수 있으므로 layout.tsx 에서 이 컴포넌트만 <Suspense> 로 감싼다. (페이지 본문은 막지 않음)
export default function TopBar() {
  const pathname = usePathname();
  const onLogin = pathname === "/login";
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    if (onLogin) return;
    let alive = true;
    api<{ user: { username: string } }>("/api/auth/me")
      .then((d) => { if (alive) setUsername(d.user.username); })
      .catch(() => {}); // 401 이면 api() 가 로그인 화면으로 보낸다
    return () => { alive = false; };
  }, [onLogin]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.assign("/login");
  }

  if (onLogin) return null;
  return (
    <header className="topbar">
      <Link href="/" className="brand">Plan-Do-See</Link>
      <nav>
        <Link href="/">달력</Link>
        <Link href="/tasks">할 일</Link>
        <Link href="/records">실행 기록</Link>
        <Link href="/direction">진행 방향</Link>
        <Link href="/retro">회고</Link>
        <a href="/api/export" download className="export-link">내보내기</a>
      </nav>
      <div className="who">
        {username && <Link href="/account" className="who-name">{username}</Link>}
        <button type="button" className="ghost" onClick={logout}>로그아웃</button>
      </div>
    </header>
  );
}
