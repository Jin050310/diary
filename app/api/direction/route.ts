import { buildDirection, planMetrics, type DExec, type DPlan, type DTask, type Improvement } from "@/lib/directionCalc";
import { db } from "@/lib/db";
import { handle, NotFound } from "@/lib/http";
import { BadRequest } from "@/lib/validate";

type Tx = Parameters<Parameters<ReturnType<typeof db>["begin"]>[1]>[0];

// 한 계획의 할 일·실행 기록을 읽어 DTask/DExec 로 바꾼다. (계산은 lib/directionCalc.ts 가 한다)
async function load(tx: Tx, planId: number, userId: number) {
  const [plan] = await tx<DPlan[]>`select id, title, start_date, end_date, estimated_minutes from plans where id = ${planId} and user_id = ${userId}`;
  if (!plan) return null;
  const taskRows = await tx<(Omit<DTask, "completed_at"> & { completed_at: Date | null })[]>`
    select t.id, t.title, t.due_date, t.estimated_minutes, t.status, t.tags, c.completed_at
    from tasks t
    left join completions c on c.task_id = t.id and c.canceled_at is null
    where t.plan_id = ${planId} and t.user_id = ${userId} and t.deleted_at is null
    order by t.id`;
  const tasks: DTask[] = taskRows.map((r) => ({ ...r, completed_at: r.completed_at ? new Date(r.completed_at).toISOString() : null }));
  const execRows = tasks.length
    ? await tx<(Omit<DExec, "started_at"> & { started_at: Date })[]>`
        select e.id, e.task_id, e.started_at, e.actual_minutes, e.blocker
        from executions e where e.deleted_at is null and e.task_id in ${tx(tasks.map((t) => t.id))}
        order by e.started_at, e.id`
    : [];
  const execs: DExec[] = execRows.map((r) => ({ ...r, started_at: new Date(r.started_at).toISOString() }));
  return { plan, tasks, execs };
}

// 큰 프로젝트(계획) 하나가 계획 대비 어느 방향으로 가고 있는지: 진행·주별 추이·빗나감 패턴·개선점 효과.
// 새 입력 없이 기존 할 일과 실행 기록으로만 계산하며, 모든 숫자는 같은 시점(읽기 전용 트랜잭션)의 데이터에서 나온다.
export async function GET(req: Request) {
  return handle(async (user) => {
    const raw = new URL(req.url).searchParams.get("plan");
    const planId = Number(raw);
    if (!raw || !Number.isSafeInteger(planId) || planId <= 0) throw new BadRequest("계획 ID가 필요합니다.");

    const result = await db().begin("read only", async (tx) => {
      const [{ today }] = await tx<{ today: string }[]>`select (now() at time zone 'Asia/Seoul')::date as today`;
      const main = await load(tx, planId, user.id);
      if (!main) return null;
      const direction = buildDirection(main.plan, main.tasks, main.execs, today);

      // 이 계획의 회고 개선점과, 그 개선점을 반영해 만든 다음 계획의 결과를 같은 잣대로 비교
      const notes = await tx<{ id: number; improvement: string; created_at: Date; next_id: number | null }[]>`
        select n.id, n.improvement, n.created_at, np.id as next_id
        from retro_notes n left join plans np on np.source_retro_note_id = n.id
        where n.plan_id = ${planId} and n.user_id = ${user.id} order by n.id`;
      const fromMetrics = planMetrics(direction);
      const improvements: Improvement[] = [];
      for (const n of notes) {
        let next: Improvement["next"] = null;
        if (n.next_id) {
          const nd = await load(tx, n.next_id, user.id);
          if (nd) next = { id: nd.plan.id, title: nd.plan.title, metrics: planMetrics(buildDirection(nd.plan, nd.tasks, nd.execs, today)) };
        }
        improvements.push({ note_id: n.id, improvement: n.improvement, created_at: new Date(n.created_at).toISOString(), from: fromMetrics, next });
      }
      return { ...direction, improvements };
    });

    if (!result) throw new NotFound("계획을 찾을 수 없습니다.");
    return Response.json(result);
  });
}
