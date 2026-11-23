import { db } from "@/lib/db";
import { handle, NotFound, readJson } from "@/lib/http";
import { BadRequest, idParam, planInput } from "@/lib/validate";

// 개선점을 "다음 계획"에 반영: 새 계획을 만들면서 어느 회고 개선점에서 나왔는지(source_retro_note_id)를 함께 저장한다. (T06-C33)
// 같은 개선점으로는 다음 계획을 한 번만 만들 수 있다 (DB 유니크 인덱스 + 사전 확인).
export async function POST(req: Request, ctx: RouteContext<"/api/retro-notes/[id]/next-plan">) {
  return handle(async (user) => {
    const noteId = idParam((await ctx.params).id);
    const input = planInput(await readJson(req));
    const sql = db();
    const [note] = await sql`select id from retro_notes where id = ${noteId} and user_id = ${user.id}`;
    if (!note) throw new NotFound("개선점을 찾을 수 없습니다.");
    const [dup] = await sql`select id from plans where source_retro_note_id = ${noteId}`;
    if (dup) throw new BadRequest("이미 이 개선점으로 만든 다음 계획이 있습니다.");
    try {
      const [row] = await sql`insert into plans ${sql({ ...input, user_id: user.id, source_retro_note_id: noteId })} returning *`;
      return Response.json(row, { status: 201 });
    } catch (e) {
      if (e && typeof e === "object" && "code" in e && e.code === "23505")
        throw new BadRequest("이미 이 개선점으로 만든 다음 계획이 있습니다.");
      throw e;
    }
  });
}
