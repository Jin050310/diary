import { db } from "@/lib/db";
import { handle, NotFound } from "@/lib/http";
import { idParam } from "@/lib/validate";

// 실행 기록 삭제: 행을 지우지 않고 deleted_at 만 채운다. (할 일 삭제와 같은 방식)
//  - 화면·합계(할 일의 실제 시간, 진행 방향, 회고)에서는 빠지고, 내보내기 파일에는 deleted_at 과 함께 남는다.
//  - 소유자 확인과 삭제가 한 쿼리라서, 남의 기록이거나 이미 삭제했거나 없는 기록이면 모두 404 (존재 여부도 드러내지 않음)
//  - 수정(PATCH)은 만들지 않았다. 잘못 입력했다면 삭제하고 다시 기록한다.
export async function DELETE(_req: Request, ctx: RouteContext<"/api/executions/[id]">) {
  return handle(async (user) => {
    const id = idParam((await ctx.params).id);
    const [row] = await db()`
      update executions set deleted_at = now()
      where id = ${id} and user_id = ${user.id} and deleted_at is null
      returning id`;
    if (!row) throw new NotFound("실행 기록을 찾을 수 없습니다.");
    return Response.json({ ok: true });
  });
}
