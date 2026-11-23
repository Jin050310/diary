import { db } from "@/lib/db";
import { handle, NotFound } from "@/lib/http";
import { BadRequest, idParam } from "@/lib/validate";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 완료 처리. 같은 요청(Idempotency-Key)이 다시 와도, 다른 키로 연타해도 "유효한 완료"는 할 일당 1건만 남는다.
//  1) completions.idempotency_key UNIQUE   2) uq_completion_active (할 일당 취소 안 된 완료 1건) — DB 가 직접 막는다.
//  3) 할 일 행을 for update 로 잠가서 동시에 들어온 두 요청이 순서대로 처리되게 한다.
export async function POST(req: Request, ctx: RouteContext<"/api/tasks/[id]/complete">) {
  return handle(async (user) => {
    const id = idParam((await ctx.params).id);
    const key = req.headers.get("idempotency-key") ?? "";
    if (!UUID.test(key)) throw new BadRequest("Idempotency-Key(UUID) 헤더가 필요합니다.");

    const result = await db().begin(async (tx) => {
      const [task] = await tx`select id from tasks where id = ${id} and user_id = ${user.id} and deleted_at is null for update`;
      if (!task) throw new NotFound("할 일을 찾을 수 없습니다.");

      const inserted = await tx`
        insert into completions (user_id, task_id, idempotency_key) values (${user.id}, ${id}, ${key})
        on conflict do nothing returning *`;
      let completion = inserted[0];
      const duplicate = !completion;
      if (!completion) {
        const [byKey] = await tx`select * from completions where idempotency_key = ${key} and user_id = ${user.id}`;
        if (byKey && byKey.task_id !== id) throw new BadRequest("이미 다른 할 일에 사용된 요청 키입니다.");
        if (byKey && byKey.canceled_at) throw new BadRequest("이미 취소된 완료 요청입니다. 새 요청으로 다시 시도하세요.");
        completion = byKey ?? (await tx`select * from completions where task_id = ${id} and user_id = ${user.id} and canceled_at is null`)[0];
        if (!completion) throw new BadRequest("이미 사용된 요청 키입니다. 새 요청으로 다시 시도하세요.");
      }
      await tx`update tasks set status = 'done', updated_at = now() where id = ${id} and user_id = ${user.id} and status <> 'done'`;
      return { completion, duplicate };
    });
    return Response.json(result, { status: result.duplicate ? 200 : 201 });
  });
}

// 완료 취소: 완료 기록은 지우지 않고 canceled_at 만 채운다. 할 일은 다시 진행 중(todo)이 된다.
export async function DELETE(_req: Request, ctx: RouteContext<"/api/tasks/[id]/complete">) {
  return handle(async (user) => {
    const id = idParam((await ctx.params).id);
    await db().begin(async (tx) => {
      const [task] = await tx`select id from tasks where id = ${id} and user_id = ${user.id} and deleted_at is null for update`;
      if (!task) throw new NotFound("할 일을 찾을 수 없습니다.");
      await tx`update completions set canceled_at = now() where task_id = ${id} and user_id = ${user.id} and canceled_at is null`;
      await tx`update tasks set status = 'todo', updated_at = now() where id = ${id} and user_id = ${user.id}`;
    });
    return Response.json({ ok: true });
  });
}
