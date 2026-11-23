import { endAllSessions, hashPassword, startSession, verifyLogin } from "@/lib/auth";
import { db } from "@/lib/db";
import { handle, readJson } from "@/lib/http";
import { BadRequest, newPasswordInput } from "@/lib/validate";

// 비밀번호 변경: 현재 비밀번호를 다시 확인하고, 바꾼 뒤 이 사용자의 모든 세션을 지운다. (T07-C114)
// 이 기기에는 새 세션을 발급하므로 계속 쓸 수 있고, 이전에 발급된 토큰은 모두 무효가 된다.
export async function POST(req: Request) {
  return handle(async (user) => {
    const { current, next } = newPasswordInput(await readJson(req));
    if (!(await verifyLogin(user.username, current))) throw new BadRequest("현재 비밀번호가 올바르지 않습니다.");
    const password_hash = await hashPassword(next);
    await db()`update users set password_hash = ${password_hash} where id = ${user.id}`;
    await endAllSessions(user.id);
    await startSession(user.id);
    return Response.json({ ok: true });
  });
}
