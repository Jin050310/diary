import { db } from "@/lib/db";
import { handle } from "@/lib/http";

// 본인 데이터 전체를 JSON 파일 하나로 내보낸다. (T06-C36)
// 삭제 표시된 할 일·취소된 완료 기록까지 모두 담아서, 이 파일만으로 계획 → 실행 → 회고 흐름을 복원해 볼 수 있다.
// 접속 정보·비밀값은 DB 행에 없으므로 포함되지 않는다. 형식은 contracts/pds-schema-v2.json 참고.
export async function GET() {
  return handle(async (user) => {
    const sql = db();
    // 한 연결로 순서대로 읽는다. (동시에 여러 개를 날리면 연결 풀에서 대기하다 응답이 수십 초씩 늦어졌다)
    // 하나의 트랜잭션(읽기 전용)으로 읽어서, 내보내는 도중 데이터가 바뀌어도 표들이 서로 같은 시점 기준이 된다.
    const { plans, plan_revisions, tasks, executions, completions, retro_notes, today } = await sql.begin("read only", async (tx) => ({
      plans: await tx`select * from plans where user_id = ${user.id} order by id`,
      plan_revisions: await tx`
        select r.* from plan_revisions r join plans p on p.id = r.plan_id
        where p.user_id = ${user.id} order by r.plan_id, r.version`,
      tasks: await tx`select * from tasks where user_id = ${user.id} order by id`,
      executions: await tx`select * from executions where user_id = ${user.id} order by id`,
      completions: await tx`select * from completions where user_id = ${user.id} order by id`,
      retro_notes: await tx`select * from retro_notes where user_id = ${user.id} order by id`,
      today: (await tx<{ today: string }[]>`select (now() at time zone 'Asia/Seoul')::date as today`)[0].today,
    }));

    const body = {
      schema: "pds-schema-v2",
      exported_at: new Date().toISOString(),
      timezone: { storage: "UTC", display: "Asia/Seoul" },
      units: { duration: "minutes", date: "YYYY-MM-DD" },
      counts: {
        plans: plans.length, plan_revisions: plan_revisions.length, tasks: tasks.length,
        executions: executions.length, completions: completions.length, retro_notes: retro_notes.length,
      },
      data: { plans, plan_revisions, tasks, executions, completions, retro_notes },
    };

    return new Response(JSON.stringify(body, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="pds-diary-export-${today}.json"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
