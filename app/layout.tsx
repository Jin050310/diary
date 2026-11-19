import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Plan-Do-See 다이어리",
  description: "계획·실행·회고를 연결해 내 계획이 어디서 빗나가는지 확인하는 다이어리",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>
        {/* T06-C82: 첫 화면(모든 화면)에 공개 범위 안내 */}
        <div className="notice" role="alert">
          지금은 로그인이 없어 링크를 아는 사람은 누구나 볼 수 있습니다. 남이 봐도 괜찮은 내용만 넣으세요
        </div>
        <header className="topbar">
          <Link href="/" className="brand">Plan-Do-See</Link>
          <nav>
            <Link href="/">달력</Link>
            <Link href="/tasks">할 일</Link>
            <Link href="/records">실행 기록</Link>
            <Link href="/retro">회고</Link>
            <a href="/api/export" download className="export-link">내보내기</a>
          </nav>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
