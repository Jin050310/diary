// 사용법: 개발 서버를 켠 뒤  node scripts/test-direction-api.mjs
// "__test__" 임시 계획으로 /api/direction 이 DB 값을 그대로 읽어 순수 계산(lib/directionCalc.ts)과 같은 결과를 내는지 확인하고, 끝나면 지운다.
// (마감이 지난 날·늦게 끝낸 날처럼 과거 완료 시각이 필요해서 completions 는 SQL 로 직접 넣는다)
import postgres from "postgres";
import { dropTestUser, newTestUser } from "./lib/test-user.mjs";
import { randomUUID } from "node:crypto";
import { buildDirection, planMetrics, addDays } from "../lib/directionCalc.ts";

try { process.loadEnvFile(".env.local"); } catch {}
const BASE = process.env.BASE ?? "http://localhost:3000";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });

let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); if (!ok) fail++; };
let tu; // 점검용 임시 계정 (로그인 쿠키). 인증이 붙은 뒤로는 모든 API 가 로그인을 요구한다
const call = async (path, init = {}) => {
  const res = await fetch(BASE + path, { ...init, headers: { "content-type": "application/json", ...(tu ? { cookie: tu.cookie } : {}), ...(init.headers ?? {}) } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const post = (path, body, headers) => call(path, { method: "POST", body: JSON.stringify(body), headers });
const J = (x) => JSON.stringify(x);

try {
  tu = await newTestUser(BASE);
  const today = (await call("/api/retro")).body.today;
  const at = (offset, hhmm = "10:00") => `${addDays(today, offset)}T${hhmm}:00+09:00`;

  const P = (await post("/api/plans", { title: "__test__ 방향 대상", start_date: addDays(today, -14), end_date: addDays(today, 14), priority: 1, success_criteria: "테스트", estimated_minutes: 600 })).body;
  const mk = async (title, off, est, tags = []) => (await post("/api/tasks", { plan_id: P.id, title: `__test__ ${title}`, due_date: off === null ? null : addDays(today, off), priority: 2, tags, estimated_minutes: est })).body;
  const a = await mk("a 제때", -12, 60, ["단어"]);
  const b = await mk("b 늦게 끝냄", -9, 90, ["단어"]);
  const c = await mk("c 마감 지남", -5, 120, ["문법"]);
  await mk("d 마감 지남", -1, 30);
  const e = await mk("e 미리 끝냄", 3, 100, ["문법"]);
  await mk("f 먼 마감", 10, 200);
  await mk("g 마감 없음", null, 0);
  const h = await mk("h 삭제될 것", -3, 999); // 삭제된 할 일은 계산에서 빠져야 함
  const i = await mk("i 완료 취소", -2, 45);   // 완료했다가 취소 → 진행 중으로 계산돼야 함

  const completedAt = { [a.id]: at(-12, "15:00"), [b.id]: at(-6, "15:00"), [e.id]: at(-1, "09:00") };
  for (const [taskId, when] of Object.entries(completedAt)) {
    await sql`insert into completions (user_id, task_id, idempotency_key, completed_at) values (${tu.id}, ${taskId}, ${randomUUID()}, ${when})`;
    await sql`update tasks set status = 'done' where id = ${taskId}`;
  }
  await post(`/api/tasks/${i.id}/complete`, {}, { "idempotency-key": randomUUID() });
  await call(`/api/tasks/${i.id}/complete`, { method: "DELETE" });

  const execLog = [];
  const ex = async (task, off, hhmm, min, blocker) => {
    const r = (await post("/api/executions", { task_id: task.id, started_at: at(off, hhmm), ended_at: at(off, "23:00"), actual_minutes: min, blocker })).body;
    execLog.push({ id: r.id, task_id: task.id, started_at: new Date(at(off, hhmm)).toISOString(), actual_minutes: min, blocker: blocker ?? null });
  };
  await ex(a, -12, "10:00", 80, null);
  await ex(b, -8, "10:00", 60, "환경 설정이 안됨");
  await ex(b, -7, "00:30", 50, "환경 설정 문제"); // 한국 시간 자정 직후
  await ex(c, -4, "10:00", 70, "환경 문제");
  await ex(e, -1, "10:00", 90, null);
  await ex(h, -3, "10:00", 500, "삭제된 할 일의 기록"); // 삭제된 할 일의 기록도 계산에서 빠져야 함
  await call(`/api/tasks/${h.id}`, { method: "DELETE" });

  // 기대값: 같은 입력(DB 에서 읽은 할 일 + 방금 만든 기록)을 순수 계산에 넣은 결과
  const listed = (await call(`/api/tasks?plan=${P.id}`)).body;
  check(!listed.some((x) => x.id === h.id) && listed.length === 8, `삭제된 할 일은 목록에서 빠짐 (할 일 ${listed.length}개)`);
  const dtasks = listed.map((x) => ({ id: x.id, title: x.title, due_date: x.due_date, estimated_minutes: x.estimated_minutes, status: x.status, tags: x.tags,
    completed_at: completedAt[x.id] ? new Date(completedAt[x.id]).toISOString() : null }));
  const dexecs = execLog.filter((x) => x.task_id !== h.id);
  const planDto = { id: P.id, title: P.title, start_date: P.start_date, end_date: P.end_date, estimated_minutes: P.estimated_minutes };
  const expected = buildDirection(planDto, dtasks, dexecs, today);

  const r = await call(`/api/direction?plan=${P.id}`);
  const got = r.body;
  check(r.status === 200 && got.today === today, "API 응답 200, 기준일은 한국 날짜");
  for (const key of ["totals", "progress", "trend", "patterns", "weeks", "series", "verdict"]) {
    const same = J(got[key]) === J(expected[key]);
    check(same, `${key}: DB 에서 읽은 결과가 순수 계산 결과와 완전히 같음${same ? "" : "\n   got " + J(got[key]).slice(0, 300) + "\n   exp " + J(expected[key]).slice(0, 300)}`);
  }
  check(got.totals.task_count === 8 && got.totals.done_count === 3 && got.progress.pace !== undefined, `삭제 제외 8개, 완료 3개(취소한 i 는 진행 중) → ${got.totals.task_count}/${got.totals.done_count}`);
  check(got.totals.actual_total === 80 + 60 + 50 + 70 + 90, `실제 합계 350분: 삭제된 할 일의 500분은 제외 → ${got.totals.actual_total}`);
  check(got.patterns.late_tasks.some((x) => x.id === b.id && x.state === "done_late") && got.patterns.late_tasks.some((x) => x.id === c.id && x.state === "open"), "b 는 늦게 끝냄, c 는 아직 못 끝냄으로 분류");
  check(got.patterns.blockers[0]?.word === "환경" && got.patterns.blockers[0]?.count === 3, `반복 낱말: 서로 다른 세 문장의 '환경' → ${J(got.patterns.blockers[0])}`);
  const dowKst = (off, hhmm) => new Date(Date.parse(at(off, hhmm)) + 9 * 3600000).getUTCDay();
  check(got.patterns.weekday[dowKst(-7, "00:30")] >= 50, "한국 시간 자정 직후 기록(-7일 00:30)이 그날 요일로 집계됨");

  // 개선점 → 다음 계획 → 효과 비교
  const note = (await post("/api/retro-notes", { plan_id: P.id, improvement: "__test__ 환경 문제를 작업 전에 미리 점검한다" })).body;
  const next = (await post(`/api/retro-notes/${note.id}/next-plan`, { title: "__test__ 다음 계획", start_date: addDays(today, 15), end_date: addDays(today, 30), priority: 1, success_criteria: "개선 반영", estimated_minutes: 100 })).body;
  const r2 = (await call(`/api/direction?plan=${P.id}`)).body;
  const imp = r2.improvements.find((x) => x.note_id === note.id);
  const nextExpected = planMetrics(buildDirection({ id: next.id, title: next.title, start_date: next.start_date, end_date: next.end_date, estimated_minutes: next.estimated_minutes }, [], [], today));
  check(imp && imp.next?.id === next.id && J(imp.next.metrics) === J(nextExpected), "개선점 효과: 반영한 다음 계획이 연결되고 그 지표는 같은 계산으로 나옴 (아직 할 일 없음 → 비교 불가 값)");
  check(J(imp.from) === J(planMetrics(expected)), "개선점 효과: 이전 계획 지표가 방향 계산과 일치");
  const r3 = (await call(`/api/direction?plan=${next.id}`)).body;
  check(r3.totals.task_count === 0 && /할 일이 없어요/.test(r3.verdict.lines[0]) && r3.improvements.length === 0, "다음 계획(할 일 없음)도 오류 없이 안내 문구로 응답");

  check((await call("/api/direction")).status === 400 && (await call("/api/direction?plan=abc")).status === 400 && (await call("/api/direction?plan=99999999")).status === 404, "계획 ID 가 없거나 잘못되면 400, 없는 계획이면 404");
  check(!J(got).includes("NaN") && !J(r3).includes("NaN"), "응답에 NaN 없음");
} finally {
  if (tu) await dropTestUser(sql, tu.id);
  const plans = (await sql`select id from plans where title like '__test__%'`).map((x) => x.id);
  const tasks = (await sql`select id from tasks where title like '__test__%'`).map((x) => x.id);
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
