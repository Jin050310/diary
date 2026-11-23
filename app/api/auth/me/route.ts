import { handle } from "@/lib/http";

// 지금 로그인한 사용자. 로그인하지 않았거나 세션이 만료·무효면 handle() 이 401 을 돌려준다.
export async function GET() {
  return handle(async (user) => Response.json({ user }));
}
