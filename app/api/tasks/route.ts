import { db } from "@/lib/db";
import { handle, readJson } from "@/lib/http";
import { BadRequest, taskInput } from "@/lib/validate";

// 정렬은 허용 목록(화이트리스트)만 SQL 에 붙인다. 사용자 입력을 그대로 넣지 않는다. (SQL 주입 방지)
const SORTS: Record<string, string> = {
  due: "t.due_date", // 마감일 (없는 것은 항상 맨 뒤)
  priority: "t.priority", // 우선순위 (1=높음)
  created: "t.created_at", // 등록순
  estimate: "t.estimated_minutes",
  title: "t.title",
};

// 필터·검색·정렬은 서버(SQL)에서 처리한다. 같은 조건이면 언제나 같은 순서가 나온다.
// 정렬 키 값이 같을 때는 t.id 오름차순을 마지막 보조 기준(tie-breaker)으로 쓴다.
export async function GET(req: Request) {
  return handle(async () => {
    const sp = new URL(req.url).searchParams;
    const sql = db();

    const plan = sp.get("plan") ? Number(sp.get("plan")) : null;
    if (plan !== null && (!Number.isSafeInteger(plan) || plan <= 0)) throw new BadRequest("계획 ID가 올바르지 않습니다.");
    const status = sp.get("status") ?? "all";
    if (!["all", "todo", "done"].includes(status)) throw new BadRequest("상태 값이 올바르지 않습니다.");
    const priority = sp.get("priority") ? Number(sp.get("priority")) : null;
    if (priority !== null && ![1, 2, 3].includes(priority)) throw new BadRequest("우선순위 값이 올바르지 않습니다.");
    const due = sp.get("due") ?? "all";
    if (!["all", "overdue", "today", "none"].includes(due)) throw new BadRequest("마감 조건이 올바르지 않습니다.");
    const sortKey = sp.get("sort") ?? "due";
    if (!(sortKey in SORTS)) throw new BadRequest("정렬 기준이 올바르지 않습니다.");
    const dir = sp.get("dir") ?? "asc";
    if (!["asc", "desc"].includes(dir)) throw new BadRequest("정렬 방향이 올바르지 않습니다.");
    const q = (sp.get("q") ?? "").trim().slice(0, 100);
    const tag = (sp.get("tag") ?? "").trim().slice(0, 20);

    const today = sql`(now() at time zone 'Asia/Seoul')::date`;
    const like = "%" + q.replace(/[\\%_]/g, (m) => "\\" + m) + "%";
    const orderBy = sql.unsafe(`${SORTS[sortKey]} ${dir} nulls last, t.id asc`);

    const rows = await sql`
      select t.*, p.title as plan_title,
             (select count(*)::int from executions e where e.task_id = t.id) as exec_count,
             (select coalesce(sum(e.actual_minutes), 0)::int from executions e where e.task_id = t.id) as actual_minutes
      from tasks t join plans p on p.id = t.plan_id
      where t.deleted_at is null
        ${plan ? sql`and t.plan_id = ${plan}` : sql``}
        ${status !== "all" ? sql`and t.status = ${status}` : sql``}
        ${priority ? sql`and t.priority = ${priority}` : sql``}
        ${tag ? sql`and ${tag} = any(t.tags)` : sql``}
        ${q ? sql`and (t.title ilike ${like} or array_to_string(t.tags, ' ') ilike ${like})` : sql``}
        ${due === "overdue" ? sql`and t.status = 'todo' and t.due_date < ${today}` : sql``}
        ${due === "today" ? sql`and t.due_date = ${today}` : sql``}
        ${due === "none" ? sql`and t.due_date is null` : sql``}
      order by ${orderBy}`;
    return Response.json(rows);
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const v = taskInput(await readJson(req));
    const sql = db();
    const [plan] = await sql`select id from plans where id = ${v.plan_id}`;
    if (!plan) throw new BadRequest("존재하지 않는 계획입니다.");
    const [row] = await sql`
      insert into tasks (plan_id, title, due_date, priority, tags, estimated_minutes)
      values (${v.plan_id}, ${v.title}, ${v.due_date}, ${v.priority}, ${v.tags}::text[], ${v.estimated_minutes})
      returning *`;
    return Response.json(row, { status: 201 });
  });
}
