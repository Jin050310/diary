// 사용법: 개발 서버를 켠 뒤  node scripts/test-executions-api.mjs
// "__test__" 임시 할 일로 카드 3(실행 기록·중복 완료 방지)을 실제 DB 에서 확인하고, 끝나면 전부 지운다.
import postgres from "postgres";
import { randomUUID } from "node:crypto";

try { process.loadEnvFile(".env.local"); } catch {}
const BASE = process.env.BASE ?? "http://localhost:3000";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });

let fail = 0;
const check = (id, ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${id} ${msg}`); if (!ok) fail++; };
const call = async (path, init = {}) => {
  const res = await fetch(BASE + path, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const post = (path, body, headers) => call(path, { method: "POST", body: JSON.stringify(body), headers });

try {
  const [plan] = await sql`select * from plans order by id limit 1`;
  const t = (await post("/api/tasks", { plan_id: plan.id, title: "__test__ exec", due_date: "2026-12-01", priority: 2, tags: ["t"], estimated_minutes: 60 })).body;

  const planBefore = (await sql`select * from plans where id = ${plan.id}`)[0];
  const taskBefore = (await sql`select * from tasks where id = ${t.id}`)[0];

  // C23~C26: 시작 시각·종료 시각·실제 소요 시간·막힘 사유 저장 (시각은 한국 시간으로 입력)
  const r = await post("/api/executions", {
    task_id: t.id, started_at: "2026-11-19T14:00:00+09:00", ended_at: "2026-11-19T15:10:00+09:00",
    actual_minutes: 55, blocker: "집중이 안 됨",
  });
  check("C23", r.status === 201 && new Date(r.body.started_at).toISOString() === "2026-11-19T05:00:00.000Z", "시작 시각 저장 (KST 14:00 → UTC 05:00)");
  check("C24", new Date(r.body.ended_at).toISOString() === "2026-11-19T06:10:00.000Z", "종료 시각 저장");
  check("C25", r.body.actual_minutes === 55, "실제 소요 시간 저장 (직접 입력한 값 그대로)");
  check("C26", r.body.blocker === "집중이 안 됨", "막힘 사유 저장");

  // 소요 시간을 안 적으면 시작~종료 차이로 계산, 막힘 사유는 비워도 됨
  const r2 = await post("/api/executions", { task_id: t.id, started_at: "2026-11-20T09:00:00+09:00", ended_at: "2026-11-20T09:45:00+09:00" });
  check("C25", r2.status === 201 && r2.body.actual_minutes === 45 && r2.body.blocker === null, "소요 시간 자동 계산 + 막힘 사유 없음 허용");

  // C27: 실행 기록을 저장해도 원래 계획·할 일 값은 그대로
  const planAfter = (await sql`select * from plans where id = ${plan.id}`)[0];
  const taskAfter = (await sql`select * from tasks where id = ${t.id}`)[0];
  check("C27", JSON.stringify(planBefore) === JSON.stringify(planAfter), "계획 행이 전혀 바뀌지 않음 (수정 이력·버전 포함)");
  check("C27", JSON.stringify(taskBefore) === JSON.stringify(taskAfter)
    && taskAfter.estimated_minutes === 60, "할 일 행이 전혀 바뀌지 않음 (예상 시간 60분 유지)");

  // 연결: 기록 목록에서 어느 할 일·계획인지 보임
  const list = (await call(`/api/executions?task=${t.id}`)).body;
  check("연결", list.length === 2 && list.every((e) => e.task_id === t.id && e.task_title === "__test__ exec" && e.plan_id === Number(plan.id)), "각 기록이 해당 할 일·계획에 연결되어 보임");
  const tl = (await call(`/api/tasks?plan=${plan.id}`)).body.find((x) => x.id === t.id);
  check("집계", tl.exec_count === 2 && tl.actual_minutes === 100, "할 일 목록에 실행 횟수 2회·실제 100분 합계");

  // 잘못된 입력은 서버가 거절
  const bad = (over) => post("/api/executions", { task_id: t.id, started_at: "2026-11-19T14:00:00+09:00", ended_at: "2026-11-19T15:00:00+09:00", ...over });
  check("검증", (await bad({ ended_at: "2026-11-19T13:00:00+09:00" })).status === 400, "종료가 시작보다 빠르면 400");
  check("검증", (await bad({ started_at: "2026-11-19 14:00" })).status === 400, "시간대 없는 시각은 400");
  check("검증", (await bad({ actual_minutes: -5 })).status === 400 && (await bad({ actual_minutes: 1.5 })).status === 400, "소요 시간이 음수·소수면 400");
  check("검증", (await bad({ task_id: 99999999 })).status === 404, "없는 할 일이면 404");
  check("검증", (await bad({ blocker: "x".repeat(1001) })).status === 400, "막힘 사유 1000자 초과면 400");
  const [{ n: before }] = await sql`select count(*)::int n from executions where task_id = ${t.id}`;
  check("검증", before === 2, "거절된 요청은 저장되지 않음");

  // XSS: 스크립트 문자열도 글자 그대로 저장 (화면에서는 React 가 텍스트로 이스케이프)
  const xss = '<script>alert("x")</script>';
  const rx = await bad({ blocker: xss });
  check("C57", rx.status === 201 && rx.body.blocker === xss, "스크립트 모양 문자열을 가공 없이 텍스트로 저장");

  // C21/C22: 완료 버튼 연타 → 유효한 완료 1건 (API 수준; 화면 연타는 브라우저에서 확인)
  const key = randomUUID();
  const clicks = await Promise.all([
    post(`/api/tasks/${t.id}/complete`, {}, { "idempotency-key": key }),
    post(`/api/tasks/${t.id}/complete`, {}, { "idempotency-key": key }),
    post(`/api/tasks/${t.id}/complete`, {}, { "idempotency-key": randomUUID() }),
  ]);
  const [{ active }] = await sql`select count(*)::int active from completions where task_id = ${t.id} and canceled_at is null`;
  const [{ total }] = await sql`select count(*)::int total from completions where task_id = ${t.id}`;
  check("C21", clicks.every((c) => c.status === 200 || c.status === 201) && clicks.filter((c) => c.status === 201).length === 1 && active === 1 && total === 1,
    `동시에 3번 눌러도 완료 기록 ${total}건 (유효 ${active}건)`);
  const comps = (await call("/api/completions")).body.filter((c) => c.task_id === t.id);
  check("C22", comps.length === 1 && comps[0].canceled_at === null && comps[0].task_title === "__test__ exec", "완료 기록 목록에도 1건만 보임");
} finally {
  const rows = await sql`select id from tasks where title like '__test__%'`;
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await sql`delete from executions where task_id in ${sql(ids)}`;
    await sql`delete from completions where task_id in ${sql(ids)}`;
    await sql`delete from tasks where id in ${sql(ids)}`;
  }
  for (const tbl of ["tasks", "executions", "completions"]) {
    await sql`select setval(pg_get_serial_sequence(${tbl}, 'id'), coalesce((select max(id) from ${sql(tbl)}), 0) + 1, false)`;
  }
  await sql.end();
  console.log(`정리 완료 (임시 할 일 ${ids.length}건 삭제)`);
}
console.log(fail ? `\n실패 ${fail}건` : "\n모두 통과");
process.exit(fail ? 1 : 0);
