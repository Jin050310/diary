// 사용법: npm run test:schema   (실제 DB 없이 메모리 Postgres 로 스키마 규칙 검증)
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
await db.exec(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
await db.exec(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8")); // 재실행해도 안전한지

let fail = 0;
const check = (id, ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${id} ${msg}`); if (!ok) fail++; };
const one = async (q, p) => (await db.query(q, p)).rows[0];

// 카드 1
const p = await one(`insert into plans (title,start_date,end_date,priority,success_criteria,estimated_minutes)
  values ('일본어 단어 하루 10개','2026-11-20','2026-11-26',1,'70단어 암기',210) returning *`);
check("C04", p.start_date && p.end_date, "기간 저장");
check("C05", p.priority === 1, "우선순위 저장");
check("C06", p.success_criteria === "70단어 암기", "성공 기준 저장");
check("C07", p.estimated_minutes === 210, "예상 시간 저장");

await db.query(`update plans set title='일본어 단어 하루 8개', estimated_minutes=180 where id=$1`, [p.id]);
await db.query(`update plans set title=title where id=$1`, [p.id]); // 변경 없는 저장 → 이력 안 쌓임
const cur = await one(`select * from plans where id=$1`, [p.id]);
const revs = (await db.query(`select * from plan_revisions where plan_id=$1 order by version`, [p.id])).rows;
check("C08", revs.length === 1 && revs[0].version === 1 && revs[0].title === "일본어 단어 하루 10개"
  && revs[0].estimated_minutes === 210, "수정 전 최초 계획 보존");
check("C08", cur.id === p.id && cur.version === 2 && cur.title === "일본어 단어 하루 8개", "ID 유지 + 현재값만 변경");
let blocked = false;
try { await db.query(`update plan_revisions set title='조작' where plan_id=$1`, [p.id]); } catch { blocked = true; }
check("C08", blocked, "이력은 수정 불가");

// 카드 3
const t = await one(`insert into tasks (plan_id,title,estimated_minutes) values ($1,'단어 1~10',30) returning *`, [p.id]);
await db.query(`insert into executions (task_id,started_at,ended_at,actual_minutes,blocker)
  values ($1,'2026-11-20T12:00:00Z','2026-11-20T12:45:00Z',45,'한자 읽기 헷갈림')`, [t.id]);
const t2 = await one(`select * from tasks where id=$1`, [t.id]);
check("C27", t2.estimated_minutes === 30, "실행 기록이 계획 값을 덮어쓰지 않음");

const key1 = crypto.randomUUID(), key2 = crypto.randomUUID();
await db.query(`insert into completions (task_id,idempotency_key) values ($1,$2) on conflict do nothing`, [t.id, key1]);
await db.query(`insert into completions (task_id,idempotency_key) values ($1,$2) on conflict do nothing`, [t.id, key1]);
await db.query(`insert into completions (task_id,idempotency_key) values ($1,$2) on conflict do nothing`, [t.id, key2]);
const c = await one(`select count(*)::int n from completions where task_id=$1 and canceled_at is null`, [t.id]);
check("C21", c.n === 1, "같은 키·다른 키로 연타해도 유효 완료 1건");

console.log(fail ? `\n${fail}개 실패` : "\n모두 통과");
process.exit(fail ? 1 : 0);
