// 사용법: node scripts/cleanup-test-data.mjs
// 테스트가 중간에 멈춰서 남은 "__test__" 임시 데이터를 지우고, id 번호를 실제 데이터 기준으로 되돌린다.
import postgres from "postgres";
import { dropTestUser } from "./lib/test-user.mjs";

try { process.loadEnvFile(".env.local"); } catch {}
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });
const plans = (await sql`select id from plans where title like '__test__%'`).map((r) => r.id);
const tasks = (await sql`select id from tasks where title like '__test__%' ${plans.length ? sql`or plan_id in ${sql(plans)}` : sql``}`).map((r) => r.id);
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
// 점검이 중간에 멈춰 남은 임시 계정(__t7_…, __test__…)과 그 계정의 자료
for (const u of await sql`select id from users where starts_with(username, '__t7_')`) await dropTestUser(sql, u.id);
for (const tbl of ["plans", "tasks", "executions", "completions", "retro_notes", "plan_revisions"]) {
  await sql`select setval(pg_get_serial_sequence(${tbl}, 'id'), coalesce((select max(id) from ${sql(tbl)}), 0) + 1, false)`;
}
const [{ p }] = await sql`select count(*)::int p from plans`;
const [{ t }] = await sql`select count(*)::int t from tasks`;
console.log(`정리 완료: 임시 계획 ${plans.length}건, 임시 할 일 ${tasks.length}건 삭제 → 남은 계획 ${p}개, 할 일 ${t}개`);
await sql.end();
