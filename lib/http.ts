import "server-only";
import { connection } from "next/server";
import { BadRequest } from "./validate";

// 오류를 JSON 으로 돌려주되, DB 내부 메시지·접속 정보는 절대 응답에 담지 않음 (T06-C58)
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  // Cache Components 가 켜져 있으므로 빌드 시 미리 렌더링(=옛 데이터 고정)되지 않게 요청 시점 실행 강제
  await connection();
  try {
    return await fn();
  } catch (e) {
    if (e instanceof BadRequest) return Response.json({ error: e.message }, { status: 400 });
    if (e instanceof NotFound) return Response.json({ error: e.message }, { status: 404 });
    console.error("[api]", e instanceof Error ? e.message : "unknown error");
    return Response.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export class NotFound extends Error {}

export async function readJson(req: Request) {
  try {
    return await req.json();
  } catch {
    throw new BadRequest("JSON 형식이 올바르지 않습니다.");
  }
}
