import { db } from "@/lib/db";
import { handle, readJson } from "@/lib/http";
import { asObject, date } from "@/lib/validate";

// 5일 사용을 시작한 날(Asia/Seoul 날짜)을 정한다. 이 날부터 5일을 "5일 요약"으로 계산한다.
export async function POST(req: Request) {
  return handle(async (user) => {
    const start = date(asObject(await readJson(req)), "date", "시작일");
    await db()`update users set five_day_start = ${start} where id = ${user.id}`;
    return Response.json({ ok: true, start });
  });
}
