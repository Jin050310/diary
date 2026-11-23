import "server-only";
import { connection } from "next/server";
import { requireUser, Unauthorized, type User } from "./auth";
import { BadRequest } from "./validate";

// 로그인한 사용자만 부를 수 있는 API 는 모두 이 함수를 거친다. 로그인 확인은 여기 한 곳(requireUser)에서 하고,
// 확인된 사용자를 fn 에 넘기므로 각 API 는 "이 사용자의 자료만" 다루도록 SQL 에 user.id 조건을 붙인다. (T07-C126)
export function handle(fn: (user: User) => Promise<Response>): Promise<Response> {
  return run(async () => fn(await requireUser()));
}

// 가입·로그인·로그아웃처럼 로그인 전에도 불러야 하는 API
export function handlePublic(fn: () => Promise<Response>): Promise<Response> {
  return run(fn);
}

// 오류를 JSON 으로 돌려주되, DB 내부 메시지·접속 정보는 절대 응답에 담지 않음 (T06-C58)
async function run(fn: () => Promise<Response>): Promise<Response> {
  // Cache Components 가 켜져 있으므로 빌드 시 미리 렌더링(=옛 데이터 고정)되지 않게 요청 시점 실행 강제
  await connection();
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Unauthorized) return Response.json({ error: e.message }, { status: 401 });
    if (e instanceof BadRequest) return Response.json({ error: e.message }, { status: 400 });
    if (e instanceof NotFound) return Response.json({ error: e.message }, { status: 404 });
    if (e instanceof Conflict) return Response.json({ error: e.message }, { status: 409 });
    console.error("[api]", e instanceof Error ? e.message : "unknown error");
    return Response.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export class NotFound extends Error {}
export class Conflict extends Error {}

export async function readJson(req: Request) {
  try {
    return await req.json();
  } catch {
    throw new BadRequest("JSON 형식이 올바르지 않습니다.");
  }
}
