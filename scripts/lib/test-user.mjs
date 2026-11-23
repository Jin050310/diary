// 점검 스크립트 공용: 임시 계정을 가입시켜 로그인 쿠키를 돌려준다. (인증이 붙은 뒤로는 모든 API 점검이 로그인이 필요하다)
// 계정 이름은 __t7_ 로 시작하고, 비밀번호는 매번 무작위로 만들어 어디에도 출력·저장하지 않는다. 점검이 끝나면 호출한 쪽이 users 행을 지운다.
import { randomBytes } from "node:crypto";

export async function newTestUser(base) {
  const username = `__t7_${randomBytes(4).toString("hex")}`;
  const password = randomBytes(12).toString("base64url") + "!1";
  const res = await fetch(base + "/api/auth/signup", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }),
  });
  if (res.status !== 201) throw new Error(`점검용 계정 가입 실패 (${res.status})`);
  const set = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("pds_session="));
  if (!set) throw new Error("로그인 쿠키를 받지 못했습니다");
  const body = await res.json();
  return { id: body.user.id, username, cookie: set.split(";")[0] };
}

// 점검이 끝난 뒤 임시 계정과 그 계정의 자료를 의존 순서대로 모두 지운다 (외래 키 때문에 순서가 중요)
export async function dropTestUser(sql, id) {
  await sql`update plans set source_retro_note_id = null where user_id = ${id}`;
  await sql`delete from executions where user_id = ${id} or task_id in (select id from tasks where user_id = ${id})`;
  await sql`delete from completions where user_id = ${id} or task_id in (select id from tasks where user_id = ${id})`;
  await sql`delete from retro_notes where user_id = ${id} or plan_id in (select id from plans where user_id = ${id})`;
  await sql`delete from tasks where user_id = ${id}`;
  await sql`delete from plans where user_id = ${id}`;
  await sql`delete from users where id = ${id}`; // sessions 는 ON DELETE CASCADE
}
