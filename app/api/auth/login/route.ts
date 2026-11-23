import { endSession, startSession, verifyLogin, Unauthorized } from "@/lib/auth";
import { handlePublic, readJson } from "@/lib/http";
import { credentialsInput } from "@/lib/validate";

// 로그인. 아이디가 없을 때와 비밀번호가 틀렸을 때의 응답(상태·문구)을 똑같이 한다. (T07-C99)
export async function POST(req: Request) {
  return handlePublic(async () => {
    const { username, password } = credentialsInput(await readJson(req), { strict: false });
    const user = await verifyLogin(username, password);
    if (!user) throw new Unauthorized("아이디 또는 비밀번호가 올바르지 않습니다.");
    await endSession(); // 이미 들고 있던 옛 세션이 있으면 서버에서 지우고, 새 세션으로 바꾼다 (세션 고정 방지)
    await startSession(user.id);
    return Response.json({ user });
  });
}
