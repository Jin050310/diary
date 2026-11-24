// 사용법: 개발 서버를 켠 뒤  node scripts/test-summary-api.mjs
// 5일 요약 API 가 DB 의 실행 기록에서 계산한 값이 "손으로 구한 값"과 같은지, 규칙 변경 기록(시각은 서버가 찍음·수정 불가)이 맞는지 확인한다.
// 임시 계정을 만들어 쓰고 끝나면 지운다.
import postgres from "postgres";
import { dropTestUser, newTestUser } from "./lib/test-user.mjs";

try { process.loadEnvFile(".env.local"); } catch {}
const BASE = process.env.BASE ?? "http://localhost:3000";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });
let fail = 0;
const check = (id, ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${id} ${msg}`); if (!ok) fail++; };
const api = async (u, path, init = {}) => {
  const res = await fetch(BASE + path, { ...init, headers: { "content-type": "application/json", ...(u ? { cookie: u.cookie } : {}), ...(init.headers ?? {}) } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const post = (u, path, body) => api(u, path, { method: "POST", body: JSON.stringify(body) });
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

let u1, u2;
try {
  u1 = await newTestUser(BASE);
  u2 = await newTestUser(BASE);
  const [{ today }] = await sql`select (now() at time zone 'Asia/Seoul')::date::text as today`;
  const start = addDays(today, -10); // 5일 전부 이미 지난 날로 잡아서 오늘 날짜에 결과가 흔들리지 않게 한다

  check("C132", (await api(u1, "/api/summary")).body.configured === false, "시작일을 정하기 전에는 configured: false");
  check("검증", (await post(u1, "/api/summary/start", { date: "2026-13-45" })).status === 400, "잘못된 시작일은 400");
  check("C132", (await post(u1, "/api/summary/start", { date: start })).status === 200, "시작일 저장");

  const plan = (await post(u1, "/api/plans", { title: "__test__ 요약", start_date: start, end_date: addDays(start, 20), priority: 2, success_criteria: "x", estimated_minutes: 100 })).body;
  const mkTask = async (title) => (await post(u1, "/api/tasks", { plan_id: plan.id, title: `__test__ ${title}`, due_date: null, priority: 2, tags: [], estimated_minutes: 10 })).body;
  const [ta, tb, tc, td, te] = [await mkTask("a"), await mkTask("b"), await mkTask("c"), await mkTask("d"), await mkTask("e")];
  const ex = (t, day, hm, mins) => {
    const s = new Date(`${addDays(start, day)}T${hm}:00+09:00`);
    return post(u1, "/api/executions", { task_id: t.id, started_at: s.toISOString(), ended_at: new Date(s.getTime() + mins * 60000).toISOString(), actual_minutes: mins });
  };
  // 손으로 계산: 0일차 60+60(같은 할 일·같은 시각 중복, 무시)+30 = 90 / 1일차 100 / 2일차 기록 없음(0) / 3일차 500+500=1000(이상값, 제외) / 4일차 45
  //   계산에 쓰는 날 = 0,1,2,4 (4일) → 합계 90+100+0+45 = 235, 평균 235/4 = 58.75 → 59
  await ex(ta, 0, "10:00", 60); await ex(ta, 0, "10:00", 60); await ex(tb, 0, "20:00", 30);
  await ex(tc, 1, "10:00", 100);
  const big1 = await ex(td, 3, "09:00", 500); await ex(te, 3, "12:00", 500);
  await ex(ta, 4, "09:00", 45);
  void big1;

  const s = (await api(u1, "/api/summary")).body;
  check("C132", s.configured && s.start === start && s.end === addDays(start, 4), "시작일부터 5일 구간");
  check("C132", JSON.stringify(s.days.map((d) => d.minutes)) === "[90,100,0,0,45]", "날짜별 분 [90, 100, 0, 0(이상값 제외), 45]", JSON.stringify(s.days.map((d) => d.minutes)));
  check("C23~C25", JSON.stringify(s.days.map((d) => d.status)) === '["ok","ok","missing","outlier","ok"]', "정상·정상·결측·이상값·정상");
  check("C24", s.days[0].count === 2 && s.days[0].duplicates === 1, "같은 할 일·같은 시각 중복은 1건으로 계산");
  check("C132", s.total === 235 && s.counted_days === 4, "합계 235분, 계산에 쓴 날 4일", `(${s.total}분, ${s.counted_days}일)`);
  check("C26", s.average === 59, "하루 평균 235 ÷ 4 = 58.75 → 반올림 59분", `(${s.average}분)`);

  // 삭제한 기록은 합계에서 빠진다
  const list = (await api(u1, "/api/executions")).body;
  const day1 = list.find((e) => e.actual_minutes === 100);
  await api(u1, `/api/executions/${day1.id}`, { method: "DELETE" });
  const s2 = (await api(u1, "/api/summary")).body;
  check("삭제", s2.total === 135 && s2.days[1].status === "missing" && s2.average === 34, "100분 기록을 삭제하면 합계 135분·평균 34분, 그날은 기록 없음으로 바뀜", `(${s2.total}분, 평균 ${s2.average})`);

  // 규칙 변경 기록
  check("검증", (await post(u1, "/api/rule-changes", { rule_name: "하루 목표", old_value: "60분", new_value: "90분" })).status === 400, "이유가 없으면 400");
  const forged = "2020-01-01T00:00:00Z";
  const ch = await post(u1, "/api/rule-changes", { rule_name: "하루 목표 작업 시간", old_value: "60분", new_value: "90분", reason: "점검", changed_at: forged });
  check("C10", ch.status === 201 && Math.abs(Date.now() - Date.parse(ch.body.changed_at)) < 60000 && !ch.body.changed_at.startsWith("2020"), "바꾼 시각은 서버가 지금 시각으로 찍음 (요청에 과거 시각을 적어도 무시)", ch.body.changed_at);
  check("C11", ch.body.reason === "점검", "바꾼 이유가 기록됨");
  let blocked = false;
  try { await sql`update rule_changes set reason = 'x' where id = ${ch.body.id}`; } catch { blocked = true; }
  check("C10", blocked, "저장된 규칙 변경 기록은 고칠 수 없음 (DB 가 막음)");
  const s3 = (await api(u1, "/api/summary")).body;
  // 변경 시각이 오늘이라 5일(모두 지난 날)은 전부 '변경 전'. 계산에 쓰는 날 = 90분·기록 없음·기록 없음·45분 (이상값 날 제외) = 4일, 합계 135, 평균 34
  check("C13~C15", s3.comparison && s3.comparison.before.days === 4 && s3.comparison.before.total === 135 && s3.comparison.before.average === 34 && s3.comparison.after.days === 0 && s3.comparison.after.average === null,
    "변경 전 4일 합계 135분·평균 34분 / 변경 후 0일 (같은 계산 규칙으로 나눔)", JSON.stringify(s3.comparison));

  check("C12", s3.changes[0].before_last !== null && s3.changes[0].after_first === null && typeof s3.changes[0].order_ok === "boolean", "규칙 변경에 근거(직전 기록·직후 기록·순서 판정)가 함께 옴");
  check("C12", s3.days.every((d) => Array.isArray(d.record_ids) && d.day_no >= 1), "날짜별로 몇 일차인지와 기록 번호가 함께 옴");

  // 다른 계정에는 보이지 않는다
  const o = (await api(u2, "/api/summary")).body;
  check("접근 제어", o.configured === false && o.changes.length === 0, "다른 계정의 5일 요약·규칙 변경 기록은 섞이지 않음");
  check("접근 제어", (await api(null, "/api/summary")).status === 401 && (await post(null, "/api/rule-changes", { rule_name: "a", old_value: "b", new_value: "c", reason: "d" })).status === 401, "로그인 없이는 5일 요약·규칙 변경 기록 모두 401");
} finally {
  if (u1) await dropTestUser(sql, u1.id);
  if (u2) await dropTestUser(sql, u2.id);
  await sql.end();
  console.log("정리 완료 (임시 계정 삭제)");
}
console.log(fail ? `\n실패 ${fail}건` : "\n모두 통과");
process.exit(fail ? 1 : 0);
