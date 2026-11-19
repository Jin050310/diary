import { db } from "@/lib/db";
import { handle, NotFound, readJson } from "@/lib/http";
import { BadRequest, executionInput } from "@/lib/validate";

// 실행 기록 목록: 어느 할 일(·계획)에 연결된 기록인지 함께 돌려준다. (T06-C23~C26, 카드 3 남길 것)
export async function GET(req: Request) {
  return handle(async () => {
    const sp = new URL(req.url).searchParams;
    const task = sp.get("task") ? Number(sp.get("task")) : null;
    const plan = sp.get("plan") ? Number(sp.get("plan")) : null;
    if ((task !== null && !Number.isSafeInteger(task)) || (plan !== null && !Number.isSafeInteger(plan)))
      throw new BadRequest("ID가 올바르지 않습니다.");
    const sql = db();
    const rows = await sql`
      select e.*, t.title as task_title, t.plan_id, p.title as plan_title
      from executions e
      join tasks t on t.id = e.task_id
      join plans p on p.id = t.plan_id
      where true
        ${task ? sql`and e.task_id = ${task}` : sql``}
        ${plan ? sql`and t.plan_id = ${plan}` : sql``}
      order by e.started_at desc, e.id desc`;
    return Response.json(rows);
  });
}

// 실행 기록 저장은 executions 에만 INSERT 한다. tasks·plans 는 건드리지 않으므로 원래 계획 값이 덮어써지지 않는다. (T06-C27)
export async function POST(req: Request) {
  return handle(async () => {
    const v = executionInput(await readJson(req));
    const sql = db();
    const [task] = await sql`select id from tasks where id = ${v.task_id} and deleted_at is null`;
    if (!task) throw new NotFound("할 일을 찾을 수 없습니다.");
    const [row] = await sql`
      insert into executions (task_id, started_at, ended_at, actual_minutes, blocker)
      values (${v.task_id}, ${v.started_at}, ${v.ended_at}, ${v.actual_minutes}, ${v.blocker})
      returning *`;
    return Response.json(row, { status: 201 });
  });
}
