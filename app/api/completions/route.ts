import { db } from "@/lib/db";
import { handle } from "@/lib/http";

// 완료 기록 목록 (취소된 기록도 canceled_at 과 함께 보존되어 있어 근거로 볼 수 있다)
export async function GET() {
  return handle(async (user) => {
    const rows = await db()`
      select c.id, c.task_id, c.idempotency_key, c.completed_at, c.canceled_at,
             t.title as task_title, p.title as plan_title
      from completions c
      join tasks t on t.id = c.task_id
      join plans p on p.id = t.plan_id
      where c.user_id = ${user.id}
      order by c.completed_at desc, c.id desc`;
    return Response.json(rows);
  });
}
