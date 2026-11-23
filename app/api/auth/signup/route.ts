import { hashPassword, startSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { Conflict, handlePublic, readJson } from "@/lib/http";
import { credentialsInput } from "@/lib/validate";

// 가입: 같은 아이디(대소문자 무시)로는 한 번만 가입된다. users.username UNIQUE 가 최종으로 막는다. (T07-C98)
export async function POST(req: Request) {
  return handlePublic(async () => {
    const { username, password } = credentialsInput(await readJson(req), { strict: true });
    const password_hash = await hashPassword(password); // 평문은 여기서 해시로 바뀌고, 이후 어디에도 저장·기록하지 않는다
    try {
      const [user] = await db()`
        insert into users (username, password_hash) values (${username}, ${password_hash})
        returning id, username`;
      await startSession(user.id);
      return Response.json({ user }, { status: 201 });
    } catch (e) {
      if (e && typeof e === "object" && "code" in e && e.code === "23505") throw new Conflict("이미 사용 중인 아이디입니다.");
      throw e;
    }
  });
}
