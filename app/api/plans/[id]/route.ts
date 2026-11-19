import { db } from "@/lib/db";
import { handle, NotFound, readJson } from "@/lib/http";
import { idParam, planInput } from "@/lib/validate";

export async function GET(_req: Request, ctx: RouteContext<"/api/plans/[id]">) {
  return handle(async () => {
    const id = idParam((await ctx.params).id);
    const sql = db();
    const [plan] = await sql`
      select p.*, n.improvement as source_improvement, n.plan_id as source_plan_id
      from plans p left join retro_notes n on n.id = p.source_retro_note_id
      where p.id = ${id}`;
    if (!plan) throw new NotFound("계획을 찾을 수 없습니다.");
    const revisions = await sql`
      select * from plan_revisions where plan_id = ${id} order by version asc`;
    return Response.json({ plan, revisions });
  });
}

// 수정: 같은 ID 의 현재 값만 바뀌고, 수정 전 값은 DB 트리거가 plan_revisions 에 보존
export async function PATCH(req: Request, ctx: RouteContext<"/api/plans/[id]">) {
  return handle(async () => {
    const id = idParam((await ctx.params).id);
    const input = planInput(await readJson(req));
    const sql = db();
    const [row] = await sql`update plans set ${sql(input)} where id = ${id} returning *`;
    if (!row) throw new NotFound("계획을 찾을 수 없습니다.");
    return Response.json(row);
  });
}
