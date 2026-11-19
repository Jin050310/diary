import { db } from "@/lib/db";
import { handle } from "@/lib/http";
import { BadRequest, date } from "@/lib/validate";

// 회고 집계. 집계 값과 "근거 기록"이 같은 행에서 나오도록, 대상 할 일을 한 번만 조회하고
// 거기서 모든 값을 계산한다. (집계 숫자와 근거 목록이 어긋날 수 없다)
//  - 계획 수(C28)   : 대상 계획에 속한 삭제되지 않은 할 일 수
//  - 완료 수(C29)   : 그중 현재 완료 상태인 할 일 수
//  - 지연 수(C30)   : 미완료 + 마감일이 서울 시간 기준 오늘보다 앞선 할 일 수 (완료한 것은 지연으로 세지 않음)
//  - 막힘 수(C31)   : 막힘 사유가 하나 이상 기록된 할 일 수
//  - 시간(C32)      : 예상 = 할 일 예상 시간 합, 실제 = 실행 기록 합, 차이 = 실제 − 예상 (대상이 없으면 모두 0)
export async function GET(req: Request) {
  return handle(async () => {
    const sp = new URL(req.url).searchParams;
    const sql = db();
    const plan = sp.get("plan") ? Number(sp.get("plan")) : null;
    if (plan !== null && (!Number.isSafeInteger(plan) || plan <= 0)) throw new BadRequest("계획 ID가 올바르지 않습니다.");
    const from = sp.get("from") ? date({ from: sp.get("from") }, "from", "시작일") : null;
    const to = sp.get("to") ? date({ to: sp.get("to") }, "to", "종료일") : null;
    if (from && to && to < from) throw new BadRequest("종료일은 시작일보다 빠를 수 없습니다.");

    const [{ today }] = await sql<{ today: string }[]>`select (now() at time zone 'Asia/Seoul')::date as today`;

    const tasks = await sql<{
      id: number; title: string; plan_id: number; plan_title: string; due_date: string | null; status: string;
      estimated_minutes: number; actual_minutes: number; exec_count: number; blocked: boolean; late: boolean;
    }[]>`
      select t.id, t.title, t.plan_id, p.title as plan_title, t.due_date, t.status, t.estimated_minutes,
             coalesce(x.actual, 0)::int as actual_minutes,
             coalesce(x.cnt, 0)::int as exec_count,
             coalesce(x.blocked, false) as blocked,
             (t.status = 'todo' and t.due_date is not null and t.due_date < ${today}::date) as late
      from tasks t
      join plans p on p.id = t.plan_id
      left join lateral (
        select sum(e.actual_minutes) as actual, count(*) as cnt,
               bool_or(e.blocker is not null and btrim(e.blocker) <> '') as blocked
        from executions e where e.task_id = t.id
      ) x on true
      where t.deleted_at is null
        ${plan ? sql`and t.plan_id = ${plan}` : sql``}
        ${from ? sql`and t.due_date >= ${from}::date` : sql``}
        ${to ? sql`and t.due_date <= ${to}::date` : sql``}
      order by t.due_date nulls last, t.id`;

    const ids = tasks.map((t) => t.id);
    const executions = ids.length
      ? await sql`
          select e.id, e.task_id, t.title as task_title, e.started_at, e.ended_at, e.actual_minutes, e.blocker
          from executions e join tasks t on t.id = e.task_id
          where e.task_id in ${sql(ids)}
          order by e.started_at desc, e.id desc`
      : [];

    const estimated = tasks.reduce((s, t) => s + t.estimated_minutes, 0);
    const actual = tasks.reduce((s, t) => s + t.actual_minutes, 0);
    const totals = {
      task_count: tasks.length,
      done_count: tasks.filter((t) => t.status === "done").length,
      late_count: tasks.filter((t) => t.late).length,
      blocked_count: tasks.filter((t) => t.blocked).length,
      estimated_minutes: estimated,
      actual_minutes: actual,
      diff_minutes: actual - estimated,
    };
    return Response.json({ today, filters: { plan, from, to }, totals, tasks, executions });
  });
}
