import type { Metadata } from "next";
import { IBM_Plex_Sans_KR } from "next/font/google";
import Link from "next/link";
import "./globals.css";

// 본문·제목 폰트. 한글은 구글 폰트가 글자 범위별로 쪼개 주므로 필요한 글자만 내려받는다. (--font-sans 로 CSS 에서 사용)
const font = IBM_Plex_Sans_KR({ weight: ["400", "500", "600", "700"], subsets: ["latin"], display: "swap", variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Plan-Do-See 다이어리",
  description: "계획·실행·회고를 연결해 내 계획이 어디서 빗나가는지 확인하는 다이어리",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={font.variable}>
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
