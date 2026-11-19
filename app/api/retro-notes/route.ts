import { db } from "@/lib/db";
import { handle, readJson } from "@/lib/http";
import { asObject, BadRequest, int, str } from "@/lib/validate";

// 회고에서 정한 개선점 (계획마다 여러 번 남길 수 있고, 각 개선점은 다음 계획 하나에만 반영된다)
export async function GET() {
  return handle(async () => {
    const rows = await db()`
      select n.id, n.plan_id, p.title as plan_title, n.improvement, n.created_at,
             np.id as next_plan_id, np.title as next_plan_title
      from retro_notes n
      join plans p on p.id = n.plan_id
      left join plans np on np.source_retro_note_id = n.id
      order by n.created_at desc, n.id desc`;
    return Response.json(rows);
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const o = asObject(await readJson(req));
    const plan_id = int(o, "plan_id", "계획", 1, Number.MAX_SAFE_INTEGER);
    const improvement = str(o, "improvement", "개선점", 500)!;
    const sql = db();
    const [plan] = await sql`select id from plans where id = ${plan_id}`;
    if (!plan) throw new BadRequest("존재하지 않는 계획입니다.");
    const [row] = await sql`insert into retro_notes (plan_id, improvement) values (${plan_id}, ${improvement}) returning *`;
    return Response.json(row, { status: 201 });
  });
}
