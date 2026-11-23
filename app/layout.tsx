import type { Metadata } from "next";
import { IBM_Plex_Sans_KR } from "next/font/google";
import { Suspense } from "react";
import TopBar from "./TopBar";
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
        {/* 과제 7: 로그인이 생겨 6번의 "누구나 볼 수 있음" 안내는 없앴다. 메뉴·사용자 표시는 TopBar */}
        <Suspense fallback={null}>
          <TopBar />
        </Suspense>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
