import { endSession } from "@/lib/auth";
import { handlePublic } from "@/lib/http";

// 로그아웃: sessions 행을 지워서 서버에서 이 토큰을 무효화한다. 같은 토큰으로 다시 요청하면 401. (T07-C96, C114)
export async function POST() {
  return handlePublic(async () => {
    await endSession();
    return Response.json({ ok: true });
  });
}
