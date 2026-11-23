// 사용법: 개발 서버를 켠 뒤  node scripts/test-retro-api.mjs
// "__test__" 임시 계획·할 일로 카드 4(회고 집계 C28~C33)를 실제 DB 에서 확인하고, 끝나면 전부 지운다.
import postgres from "postgres";
import { dropTestUser, newTestUser } from "./lib/test-user.mjs";
import { randomUUID } from "node:crypto";

try { process.loadEnvFile(".env.local"); } catch {}
const BASE = process.env.BASE ?? "http://localhost:3000";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });

let fail = 0;
const check = (id, ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${id} ${msg}`); if (!ok) fail++; };
let tu; // 점검용 임시 계정 (로그인 쿠키). 인증이 붙은 뒤로는 모든 API 가 로그인을 요구한다
const call = async (path, init = {}) => {
  const res = await fetch(BASE + path, { ...init, headers: { "content-type": "application/json", ...(tu ? { cookie: tu.cookie } : {}), ...(init.headers ?? {}) } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const post = (path, body, headers) => call(path, { method: "POST", body: JSON.stringify(body), headers });
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

try {
  tu = await newTestUser(BASE);
  const today = (await call("/api/retro")).body.today;
  const past = addDays(today, -10), future = addDays(today, 10);

  const mkPlan = async (title) => (await post("/api/plans", { title, start_date: past, end_date: future, priority: 2, success_criteria: "테스트", estimated_minutes: 100 })).body;
  const P = await mkPlan("__test__ 회고 대상");
  const E = await mkPlan("__test__ 빈 계획");
  const mkTask = async (title, due, est) => (await post("/api/tasks", { plan_id: P.id, title: `__test__ ${title}`, due_date: due, priority: 2, tags: [], estimated_minutes: est })).body;
  const exec = (task, minutes, blocker) => post("/api/executions", {
    task_id: task.id, started_at: "2026-11-19T10:00:00+09:00", ended_at: "2026-11-19T11:00:00+09:00", actual_minutes: minutes, blocker });
  const done = (task) => post(`/api/tasks/${task.id}/complete`, {}, { "idempotency-key": randomUUID() });

  const a = await mkTask("a 완료·과거", past, 60);    await done(a);  await exec(a, 50, null);
  const b = await mkTask("b 미완료·과거", past, 30);                  await exec(b, 20, "막혔다");
  const c = await mkTask("c 미완료·오늘", today, 30);
  const d = await mkTask("d 미완료·미래", future, 120);               await exec(d, 10, "   ");
  const e = await mkTask("e 완료·마감없음", null, 40); await done(e);
  const f = await mkTask("f 삭제됨", past, 999);       await done(f); await call(`/api/tasks/${f.id}`, { method: "DELETE" });

  const R = (await call(`/api/retro?plan=${P.id}`)).body;
  const t = R.totals;
  check("C28", t.task_count === 5, `계획 수 = 삭제되지 않은 할 일 수 (5, 삭제된 1개 제외) → ${t.task_count}`);
  check("C29", t.done_count === 2, `완료 수 = 현재 완료 상태 할 일 수 (2) → ${t.done_count}`);
  check("C30", t.late_count === 1 && R.tasks.find((x) => x.late)?.id === b.id,
    `지연 수 = 미완료+마감 지남 (1: b만. 완료한 a, 오늘 마감 c, 미래 d는 제외) → ${t.late_count}`);
  check("C31", t.blocked_count === 1 && R.tasks.find((x) => x.blocked)?.id === b.id,
    `막힘 수 = 막힘 사유가 기록된 할 일 수 (1: b. 공백뿐인 사유는 제외) → ${t.blocked_count}`);
  check("C32", t.estimated_minutes === 280 && t.actual_minutes === 80 && t.diff_minutes === -200,
    `예상 280 / 실제 80 / 차이(실제−예상) -200 → ${t.estimated_minutes}/${t.actual_minutes}/${t.diff_minutes}`);

  const Z = (await call(`/api/retro?plan=${E.id}`)).body.totals;
  check("C32", Object.values(Z).every((v) => v === 0), "대상 데이터가 없으면 모든 값이 0");

  // C83 근거 기록: 집계 값과 근거 목록이 같은 데이터에서 나와 항상 일치
  check("C83", R.tasks.length === t.task_count && R.tasks.filter((x) => x.status === "done").length === t.done_count
    && R.tasks.filter((x) => x.late).length === t.late_count && R.tasks.filter((x) => x.blocked).length === t.blocked_count,
    "각 집계 값의 근거 목록 개수가 집계 값과 일치");
  check("C83", R.tasks.reduce((s, x) => s + x.estimated_minutes, 0) === t.estimated_minutes
    && R.tasks.reduce((s, x) => s + x.actual_minutes, 0) === t.actual_minutes
    && R.executions.reduce((s, x) => s + x.actual_minutes, 0) === t.actual_minutes, "예상·실제 시간 합계가 근거 기록 합계와 일치");
  check("C83", R.executions.some((x) => x.blocker === "막혔다"), "막힘 근거 기록에 막힘 사유가 보임");

  // 기간 필터 (마감일 기준): 오늘~오늘 → c 하나
  const day = (await call(`/api/retro?plan=${P.id}&from=${today}&to=${today}`)).body;
  check("기간", day.totals.task_count === 1 && day.tasks[0].id === c.id, "기간(마감일) 필터: 오늘 하루 → 오늘 마감 할 일 1개");
  check("검증", (await call(`/api/retro?from=2026-12-01&to=2026-11-01`)).status === 400 && (await call(`/api/retro?plan=abc`)).status === 400, "잘못된 기간·ID 는 400");

  // 완료 취소하면 완료 수 즉시 반영, 다시 완료하면 1 증가 (C22)
  await call(`/api/tasks/${a.id}/complete`, { method: "DELETE" });
  const r2 = (await call(`/api/retro?plan=${P.id}`)).body.totals;
  await done(a); await done(a); await done(a);
  const r3 = (await call(`/api/retro?plan=${P.id}`)).body.totals;
  check("C22", r2.done_count === 1 && r3.done_count === 2, `완료 취소 → 1, 완료 3번 연타 → ${r3.done_count} (정확히 1만 증가)`);

  // C33 개선점 → 다음 계획
  const note = (await post("/api/retro-notes", { plan_id: P.id, improvement: "막힘이 있던 b 는 20분 단위로 쪼갠다" })).body;
  check("C33", note.id > 0, "회고 개선점 한 줄 저장");
  const next = await post(`/api/retro-notes/${note.id}/next-plan`, { title: "__test__ 다음 계획", start_date: addDays(future, 1), end_date: addDays(future, 15),
    priority: 1, success_criteria: "개선: 막힘 작업은 20분 단위로 쪼갠다", estimated_minutes: 200 });
  check("C33", next.status === 201 && next.body.source_retro_note_id === note.id, "다음 계획이 개선점(source_retro_note_id)과 연결되어 저장됨");
  const detail = (await call(`/api/plans/${next.body.id}`)).body.plan;
  check("C33", detail.source_improvement === "막힘이 있던 b 는 20분 단위로 쪼갠다" && detail.source_plan_id === P.id, "다음 계획 상세에서 반영된 개선점·원래 계획이 보임");
  const again = await post(`/api/retro-notes/${note.id}/next-plan`, { title: "__test__ 중복", start_date: future, end_date: addDays(future, 3), priority: 2, success_criteria: "x", estimated_minutes: 1 });
  check("C33", again.status === 400, "같은 개선점으로 다음 계획을 두 번 만들 수 없음");
  const notes = (await call("/api/retro-notes")).body.find((n) => n.id === note.id);
  check("C33", notes?.next_plan_id === next.body.id, "개선점 목록에서 반영된 다음 계획이 보임");
  check("검증", (await post("/api/retro-notes", { plan_id: P.id, improvement: "" })).status === 400 && (await post("/api/retro-notes", { plan_id: 99999999, improvement: "x" })).status === 404, "빈 개선점은 400, 없는(또는 남의) 계획은 404");
} finally {
  if (tu) await dropTestUser(sql, tu.id);
  const plans = (await sql`select id from plans where title like '__test__%'`).map((r) => r.id);
  const tasks = (await sql`select id from tasks where title like '__test__%'`).map((r) => r.id);
  if (tasks.length) {
    await sql`delete from executions where task_id in ${sql(tasks)}`;
    await sql`delete from completions where task_id in ${sql(tasks)}`;
    await sql`delete from tasks where id in ${sql(tasks)}`;
  }
  if (plans.length) {
    await sql`delete from plans where id in ${sql(plans)} and source_retro_note_id is not null`;
    await sql`delete from retro_notes where plan_id in ${sql(plans)}`;
    await sql`delete from plans where id in ${sql(plans)}`;
  }
  for (const tbl of ["plans", "tasks", "executions", "completions", "retro_notes", "plan_revisions"]) {
    await sql`select setval(pg_get_serial_sequence(${tbl}, 'id'), coalesce((select max(id) from ${sql(tbl)}), 0) + 1, false)`;
  }
  await sql.end();
  console.log(`정리 완료 (임시 계획 ${plans.length}건, 할 일 ${tasks.length}건 삭제)`);
}
console.log(fail ? `\n실패 ${fail}건` : "\n모두 통과");
process.exit(fail ? 1 : 0);
