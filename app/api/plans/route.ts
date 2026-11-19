import { db } from "@/lib/db";
import { handle, readJson } from "@/lib/http";
import { planInput } from "@/lib/validate";

export async function GET() {
  return handle(async () => {
    const sql = db();
    const rows = await sql`
      select p.*,
             (select n.improvement from retro_notes n where n.id = p.source_retro_note_id) as source_improvement,
             (select count(*)::int from plan_revisions r where r.plan_id = p.id) as revision_count,
             (select count(*)::int from tasks t where t.plan_id = p.id and t.deleted_at is null) as task_count
      from plans p
      order by p.start_date desc, p.id desc`;
    return Response.json(rows);
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const input = planInput(await readJson(req));
    const sql = db();
    const [row] = await sql`insert into plans ${sql(input)} returning *`;
    return Response.json(row, { status: 201 });
  });
}
