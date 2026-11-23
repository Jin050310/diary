import { endSession, verifyLogin } from "@/lib/auth";
import { db } from "@/lib/db";
import { handle, readJson } from "@/lib/http";
import { asObject, BadRequest } from "@/lib/validate";

// 계정 삭제 (T07-C134): 내 계정을 지우면 내 자료도 함께 지워진다. 되돌릴 수 없다.
//  - 로그인한 상태에서, 비밀번호를 다시 확인하고 아이디를 한 번 더 입력해야 한다. (실수·남의 손에 의한 삭제 방지)
//  - 자료는 외래 키 순서대로 한 트랜잭션에서 지운다. 중간에 실패하면 아무것도 지워지지 않는다.
//  - 삭제 표시(deleted_at)만 된 할 일·실행 기록도 이때는 실제로 지운다. (계정을 지우는 것이 목적이므로)
export async function DELETE(req: Request) {
  return handle(async (user) => {
    const o = asObject(await readJson(req));
    const password = typeof o.password === "string" ? o.password : "";
    const confirmName = typeof o.confirm_username === "string" ? o.confirm_username.trim().toLowerCase() : "";
    if (!password) throw new BadRequest("비밀번호를 입력하세요.");
    if (confirmName !== user.username) throw new BadRequest("확인을 위해 내 아이디를 정확히 입력하세요.");
    if (!(await verifyLogin(user.username, password))) throw new BadRequest("비밀번호가 올바르지 않습니다.");

    const counts = await db().begin(async (tx) => {
      const id = user.id;
      await tx`update plans set source_retro_note_id = null where user_id = ${id}`; // 회고 ← 다음 계획 연결을 먼저 풀어야 회고를 지울 수 있다
      const e = await tx`delete from executions where user_id = ${id} returning id`;
      const c = await tx`delete from completions where user_id = ${id} returning id`;
      const n = await tx`delete from retro_notes where user_id = ${id} returning id`;
      const t = await tx`delete from tasks where user_id = ${id} returning id`;
      const p = await tx`delete from plans where user_id = ${id} returning id`; // plan_revisions 는 계획과 함께 지워짐(ON DELETE CASCADE)
      await tx`delete from users where id = ${id}`; // sessions·rule_changes 는 계정과 함께 지워짐(ON DELETE CASCADE)
      return { plans: p.length, tasks: t.length, executions: e.length, completions: c.length, retro_notes: n.length };
    });
    await endSession(); // 쿠키도 지운다 (서버의 세션 행은 이미 계정과 함께 지워짐)
    return Response.json({ ok: true, deleted: counts });
  });
}
