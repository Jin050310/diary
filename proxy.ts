import { NextResponse, type NextRequest } from "next/server";

// 이 파일은 "1차 문지기"다. 진짜 로그인 확인(세션이 DB 에 있고 만료 전인지)은 API 에서 lib/http.ts 의 handle() → requireUser() 가 한다.
// 여기서는 두 가지만 한다.
//  1) 세션 쿠키가 없는 사람이 화면 주소를 열면 로그인 화면으로 보낸다. (T07-C97)
//     쿠키가 "있기만 하면" 통과시키므로, 만료·폐기된 쿠키는 화면은 열려도 API 가 401 을 주고 화면이 로그인으로 돌려보낸다.
//  2) 다른 사이트에서 온 쓰기 요청(POST·PATCH·DELETE)을 막는다. (Origin 이 이 사이트와 다르면 403) — 쿠키의 SameSite=Lax 와 이중 방어
const SESSION_COOKIE = "pds_session"; // lib/auth.ts 의 SESSION_COOKIE 와 같아야 한다 (proxy 는 다른 모듈에 기대지 않는다)

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/")) {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.get("origin");
      let sameSite = true;
      if (origin) {
        try { sameSite = new URL(origin).host === req.headers.get("host"); } catch { sameSite = false; }
      }
      if (!sameSite) return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
    }
    return NextResponse.next();
  }

  if (pathname === "/login") return NextResponse.next();
  if (!req.cookies.has(SESSION_COOKIE)) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|webp)$).*)"],
};
