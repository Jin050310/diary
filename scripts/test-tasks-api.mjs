// 사용법: 개발 서버(npm run dev)를 켠 뒤  node scripts/test-tasks-api.mjs
// 실제 DB 에 "__test__" 제목의 임시 할 일을 만들어 카드 2·3 규칙을 확인하고, 끝나면 전부 지운다.
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

try {
  tu = await newTestUser(BASE);
  const plan = (await post("/api/plans", { title: "__test__ 계획", start_date: "2026-11-20", end_date: "2026-12-17", priority: 2, success_criteria: "테스트", estimated_minutes: 100 })).body;
  const mk = (over) => post("/api/tasks", { plan_id: plan.id, title: "__test__ a", due_date: "2026-12-01", priority: 2, tags: ["테스트", "x"], estimated_minutes: 30, ...over });

  // C09, C14~C17 생성 + 마감일·우선순위·태그·예상 시간 저장
  const a = (await mk({})).body;
  check("C09", a.id > 0 && a.status === "todo", "할 일 생성");
  check("C14", a.due_date === "2026-12-01", "마감일 저장");
  check("C15", a.priority === 2, "우선순위 저장");
  check("C16", JSON.stringify(a.tags) === '["테스트","x"]', "태그 저장");
  check("C17", a.estimated_minutes === 30, "예상 시간 저장");

  // 잘못된 입력은 서버가 거절
  check("검증", (await mk({ priority: 9 })).status === 400 && (await mk({ title: "" })).status === 400
    && (await mk({ plan_id: 99999999 })).status === 404, "잘못된 입력 400, 없는(또는 남의) 계획은 404");

  // C10 수정
  const upd = await call(`/api/tasks/${a.id}`, { method: "PATCH", body: JSON.stringify({ plan_id: plan.id, title: "__test__ a2", due_date: null, priority: 1, tags: [], estimated_minutes: 45 }) });
  check("C10", upd.body.title === "__test__ a2" && upd.body.due_date === null && upd.body.estimated_minutes === 45, "할 일 수정");

  // C11/C21/C22 완료 + 연타
  const k1 = randomUUID();
  const c1 = await post(`/api/tasks/${a.id}/complete`, {}, { "idempotency-key": k1 });
  const c2 = await post(`/api/tasks/${a.id}/complete`, {}, { "idempotency-key": k1 });
  const c3 = await post(`/api/tasks/${a.id}/complete`, {}, { "idempotency-key": randomUUID() });
  const par = await Promise.all([1, 2, 3, 4].map(() => post(`/api/tasks/${a.id}/complete`, {}, { "idempotency-key": randomUUID() })));
  const [{ n }] = await sql`select count(*)::int n from completions where task_id = ${a.id} and canceled_at is null`;
  const done = (await call(`/api/tasks/${a.id}`)).body;
  check("C11", c1.status === 201 && done.status === "done", "완료 처리");
  check("C21", c2.body.duplicate === true && c3.body.duplicate === true && par.every((r) => r.status === 200 && r.body.duplicate) && n === 1,
    `같은 키·다른 키·동시 연타해도 유효한 완료 ${n}건`);
  check("키", (await post(`/api/tasks/${a.id}/complete`, {}, {})).status === 400, "키 없는 완료 요청 거절");

  // C12 완료 취소 → 다시 진행 중, 기록은 남음
  await call(`/api/tasks/${a.id}/complete`, { method: "DELETE" });
  const back = (await call(`/api/tasks/${a.id}`)).body;
  const [{ total }] = await sql`select count(*)::int total from completions where task_id = ${a.id}`;
  check("C12", back.status === "todo" && total === 1, "완료 취소 → 진행 중, 완료 기록은 보존(canceled_at)");
  const re = await post(`/api/tasks/${a.id}/complete`, {}, { "idempotency-key": randomUUID() });
  check("재완료", re.status === 201, "취소 뒤 다시 완료 가능");

  // C18~C20 검색·필터·정렬: 같은 마감일 3개 + 마감 없는 1개
  const mkS = (t, p, tags, due = "2026-12-05") => mk({ title: `__test__ ${t}`, priority: p, tags, due_date: due }).then((r) => r.body);
  const s1 = await mkS("사과", 2, ["과일"]);
  const s2 = await mkS("바나나", 1, ["과일", "노랑"]);
  const s3 = await mkS("당근", 2, ["채소"]);
  const s4 = await mkS("무", 3, ["채소"], null);
  const list = async (qs) => (await call(`/api/tasks?plan=${plan.id}&${qs}`)).body.filter((t) => t.title.startsWith("__test__"));
  const ids = (rows) => rows.map((t) => t.id);

  check("C18", JSON.stringify(ids(await list("q=%EB%B0%94%EB%82%98%EB%82%98"))) === JSON.stringify([s2.id]), "제목 검색");
  check("C18", ids(await list("q=%EC%B1%84%EC%86%8C")).sort().join() === [s3.id, s4.id].sort().join(), "태그 검색");
  check("C18", (await list("q=%25")).length === 0, "검색어의 % 는 글자 그대로 취급");
  const mine = (rows) => ids(rows).filter((id) => [s1.id, s2.id, s3.id, s4.id].includes(id));
  check("C19", mine(await list("priority=1")).join() === String(s2.id), "우선순위 필터");
  check("C19", ids(await list("tag=%EC%B1%84%EC%86%8C")).length === 2, "태그 필터");
  check("C19", mine(await list("due=none")).join() === String(s4.id), "마감 없음 필터");
  check("C19", (await list("status=done")).every((t) => t.status === "done") && (await list("status=todo")).every((t) => t.status === "todo"), "상태 필터");
  const byDue = ids(await list("sort=due&dir=asc"));
  check("C20", byDue.slice(-1)[0] === s4.id, "마감일 정렬: 마감 없는 것은 맨 뒤");
  const sameDay = byDue.filter((id) => [s1.id, s2.id, s3.id].includes(id));
  check("C20", JSON.stringify(sameDay) === JSON.stringify([s1.id, s2.id, s3.id]), "같은 마감일이면 id 순(보조 기준)으로 항상 같은 순서");
  const again = ids(await list("sort=due&dir=asc"));
  check("C20", JSON.stringify(again) === JSON.stringify(byDue), "다시 조회해도 순서 동일");
  const byPri = (await list("sort=priority&dir=asc")).filter((t) => [s1.id, s2.id, s3.id, s4.id].includes(t.id)).map((t) => t.id);
  check("C20", byPri[0] === s2.id && byPri.slice(1, 3).join() === [s1.id, s3.id].join() && byPri[3] === s4.id, "우선순위 정렬 + 보조 기준");
  check("정렬검증", (await call(`/api/tasks?sort=id;drop table tasks`)).status === 400, "허용 목록 밖 정렬 값은 400 (SQL 주입 방지)");

  // C13 삭제: 목록에서 사라지지만 행은 남음
  await call(`/api/tasks/${s1.id}`, { method: "DELETE" });
  const [{ del }] = await sql`select count(*)::int del from tasks where id = ${s1.id} and deleted_at is not null`;
  check("C13", !ids(await list("")).includes(s1.id) && del === 1 && (await call(`/api/tasks/${s1.id}`)).status === 404, "삭제 → 목록에서 제외, 행은 삭제 표시로 보존");
} finally {
  if (tu) await dropTestUser(sql, tu.id);
  const rows = await sql`select id from tasks where title like '__test__%'`;
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await sql`delete from completions where task_id in ${sql(ids)}`;
    await sql`delete from tasks where id in ${sql(ids)}`;
  }
  // 테스트가 올려 둔 id 번호를 되돌려서 실제 데이터의 id 가 띄엄띄엄해지지 않게 한다
  await sql`select setval(pg_get_serial_sequence('tasks','id'), coalesce((select max(id) from tasks), 0) + 1, false)`;
  await sql`select setval(pg_get_serial_sequence('completions','id'), coalesce((select max(id) from completions), 0) + 1, false)`;
  await sql.end();
  console.log(`정리 완료 (임시 할 일 ${ids.length}건 삭제)`);
}
console.log(fail ? `\n실패 ${fail}건` : "\n모두 통과");
process.exit(fail ? 1 : 0);
