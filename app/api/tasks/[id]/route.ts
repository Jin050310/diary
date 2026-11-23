import { db } from "@/lib/db";
import { handle, NotFound, readJson } from "@/lib/http";
import { idParam, taskInput } from "@/lib/validate";

export async function GET(_req: Request, ctx: RouteContext<"/api/tasks/[id]">) {
  return handle(async (user) => {
    const id = idParam((await ctx.params).id);
    const [row] = await db()`select * from tasks where id = ${id} and user_id = ${user.id} and deleted_at is null`;
    if (!row) throw new NotFound("할 일을 찾을 수 없습니다.");
    return Response.json(row);
  });
}

// 내용 수정 (상태·완료 기록은 건드리지 않음 — 완료/취소는 /complete 로만)
export async function PATCH(req: Request, ctx: RouteContext<"/api/tasks/[id]">) {
  return handle(async (user) => {
    const id = idParam((await ctx.params).id);
    const v = taskInput(await readJson(req));
    const sql = db();
    const [plan] = await sql`select id from plans where id = ${v.plan_id} and user_id = ${user.id}`;
    if (!plan) throw new NotFound("계획을 찾을 수 없습니다.");
    const [row] = await sql`
      update tasks set plan_id = ${v.plan_id}, title = ${v.title}, due_date = ${v.due_date},
        priority = ${v.priority}, tags = ${v.tags}::text[], estimated_minutes = ${v.estimated_minutes},
        updated_at = now()
      where id = ${id} and user_id = ${user.id} and deleted_at is null returning *`;
    if (!row) throw new NotFound("할 일을 찾을 수 없습니다.");
    return Response.json(row);
  });
}

// 삭제: 행을 지우지 않고 삭제 표시만 한다. (회고에서 "삭제되지 않은 할 일"만 세고, 근거 추적은 가능하게)
export async function DELETE(_req: Request, ctx: RouteContext<"/api/tasks/[id]">) {
  return handle(async (user) => {
    const id = idParam((await ctx.params).id);
    const [row] = await db()`
      update tasks set deleted_at = now(), updated_at = now()
      where id = ${id} and user_id = ${user.id} and deleted_at is null returning id`;
    if (!row) throw new NotFound("할 일을 찾을 수 없습니다.");
    return Response.json({ ok: true });
  });
}
