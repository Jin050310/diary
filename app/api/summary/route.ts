import { db } from "@/lib/db";
import { handle } from "@/lib/http";
import { buildSummary, type SChange, type SExec } from "@/lib/summaryCalc";

const DAYS = 5;

// 5일 사용 요약: 로그인한 본인의 실행 기록(삭제하지 않은 것)만 읽어 lib/summaryCalc.ts 로 계산한다.
// 시작일을 정하기 전이면 configured: false 만 돌려준다.
export async function GET() {
  return handle(async (user) => {
    const sql = db();
    const [u] = await sql<{ start: string | null }[]>`select five_day_start::text as start from users where id = ${user.id}`;
    const changeRows = await sql<{ id: number; changed_at: Date; rule_name: string; old_value: string; new_value: string; reason: string }[]>`
      select id, changed_at, rule_name, old_value, new_value, reason from rule_changes where user_id = ${user.id} order by changed_at, id`;
    const changes: SChange[] = changeRows.map((c) => ({ ...c, changed_at: new Date(c.changed_at).toISOString() }));
    if (!u?.start) return Response.json({ configured: false, changes });

    const [{ today }] = await sql<{ today: string }[]>`select (now() at time zone 'Asia/Seoul')::date::text as today`;
    const rows = await sql<{ id: number; task_id: number; started_at: Date; actual_minutes: number; created_at: Date }[]>`
      select id, task_id, started_at, actual_minutes, created_at from executions
      where user_id = ${user.id} and deleted_at is null
        and (started_at at time zone 'Asia/Seoul')::date between ${u.start}::date and (${u.start}::date + ${DAYS - 1}::int)
      order by id`;
    const execs: SExec[] = rows.map((r) => ({ ...r, started_at: new Date(r.started_at).toISOString(), created_at: new Date(r.created_at).toISOString() }));
    return Response.json({ configured: true, ...buildSummary(execs, changes, u.start, DAYS, today) });
  });
}
