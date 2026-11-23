// 사용법:  node scripts/split-tasks.mjs <아이디>          (미리보기: 날짜별로 어떻게 나뉘는지만 보여 줌)
//          node scripts/split-tasks.mjs <아이디> --yes    (실제 반영. 반영 전에 원래 할 일을 백업 파일로 저장)
// 옵션:    --weekday=180 --weekend=300 --chunk=90   (하루 가능 시간(분), 조각 최대 길이(분))
//
// 아직 안 끝낸 큰 할 일을 chunk 분 이하 조각으로 나누고, 마감이 빠른 것부터 하루 가능 시간 안에서 날짜를 배정한다.
//  - 총 예상 시간은 그대로 (나눈 조각의 합 = 원래 예상 시간)
//  - 조각의 마감일은 원래 마감일을 넘지 않는다. 그 안에 자리가 없으면 원래 마감일에 두고 "초과"로 표시한다.
//  - 끝낸 할 일, 이미 실행 기록이 있는 할 일, 삭제한 할 일은 건드리지 않는다.
//  - 원래 할 일은 1번째 조각으로 바뀌고(id 유지), 나머지 조각은 새 할 일로 만든다.
import { mkdirSync, writeFileSync } from "node:fs";
import postgres from "postgres";

try { process.loadEnvFile(".env.local"); } catch {}
const args = process.argv.slice(2);
const username = (args.find((a) => !a.startsWith("--")) ?? "").trim().toLowerCase();
const apply = args.includes("--yes");
const opt = (name, dflt) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? Number(a.split("=")[1]) : dflt; };
const WEEKDAY = opt("weekday", 180), WEEKEND = opt("weekend", 300), CHUNK = opt("chunk", 90);
if (!username || [WEEKDAY, WEEKEND, CHUNK].some((n) => !Number.isFinite(n) || n <= 0)) {
  console.error("사용법: node scripts/split-tasks.mjs <아이디> [--yes] [--weekday=180] [--weekend=300] [--chunk=90]");
  process.exit(1);
}
if (username.startsWith("__t7_")) { console.error("점검용 임시 계정에는 쓰지 않습니다."); process.exit(1); }

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const isWeekend = (iso) => [0, 6].includes(new Date(iso + "T00:00:00Z").getUTCDay());
const WD = ["일", "월", "화", "수", "목", "금", "토"];
const md = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8))}(${WD[new Date(iso + "T00:00:00Z").getUTCDay()]})`;

try {
  const [user] = await sql`select id, username from users where username = ${username}`;
  if (!user) { console.error(`아이디 '${username}' 가 없습니다.`); process.exit(1); }
  const [{ today }] = await sql`select (now() at time zone 'Asia/Seoul')::date::text as today`;

  const open = await sql`
    select t.id, t.plan_id, p.title as plan_title, t.title, t.due_date::text as due, t.priority, t.tags, t.estimated_minutes as est,
           (select count(*)::int from executions e where e.task_id = t.id) as execs
    from tasks t join plans p on p.id = t.plan_id
    where t.user_id = ${user.id} and t.deleted_at is null and t.status = 'todo' and t.due_date is not null
    order by t.due_date, t.priority, t.id`;

  // 1) 조각 나누기
  const pieces = []; // { task, idx, n, title, minutes }
  const keep = [];   // 나누지 않는 할 일(길이가 짧거나 이미 실행 기록이 있음)
  for (const t of open) {
    if (t.est <= CHUNK || t.execs > 0) { keep.push(t); pieces.push({ task: t, idx: 1, n: 1, title: t.title, minutes: t.est, whole: true }); continue; }
    const n = Math.ceil(t.est / CHUNK);
    const base = Math.floor(t.est / n / 5) * 5;           // 5분 단위로 맞춘 기본 길이
    let rest = t.est;
    for (let i = 1; i <= n; i++) {
      const m = i === n ? rest : base;
      rest -= m;
      const suffix = ` (${i}/${n})`;
      pieces.push({ task: t, idx: i, n, title: t.title.slice(0, 200 - suffix.length) + suffix, minutes: m });
    }
  }

  // 2) 날짜 배정: 마감이 빠른 것부터, 오늘부터 하루 가능 시간 안에서 채운다
  const used = new Map(); // 날짜 → 배정된 분
  const capOf = (d) => (isWeekend(d) ? WEEKEND : WEEKDAY);
  const placed = [];
  let overflow = 0;
  // 커서 방식: 마감 순서대로 앞에서부터 이어서 채운다. (앞쪽 빈틈을 되짚어 채우면 뒤 마감의 일이 앞날에 끼어들어
  // "개발 전에 배포 점검" 같은 순서 뒤바뀜이 생긴다.) 한 할 일의 조각은 연속된 날짜에 놓인다.
  let cursor = today;
  for (const p of pieces) {
    const due = p.task.due;
    while ((used.get(cursor) ?? 0) + p.minutes > capOf(cursor)) cursor = addDays(cursor, 1);
    let got = cursor;
    if (cursor > due) {
      // 순서대로는 마감 안에 못 들어감 → 마감 전에 남은 앞쪽 빈 시간을 찾아 넣는다. 그래도 없으면 마감일에 두고 "초과"로 표시
      got = null;
      for (let d = today; d <= due; d = addDays(d, 1)) if ((used.get(d) ?? 0) + p.minutes <= capOf(d)) { got = d; break; }
      if (!got) { got = due < today ? today : due; overflow += p.minutes; p.over = true; }
    }
    used.set(got, (used.get(got) ?? 0) + p.minutes);
    placed.push({ ...p, date: got });
  }

  // 3) 미리보기
  const days = [...new Set(placed.map((x) => x.date))].sort();
  console.log(`대상 계정 ${user.username} · 오늘 ${today} · 평일 ${WEEKDAY}분 / 주말 ${WEEKEND}분 / 조각 최대 ${CHUNK}분`);
  console.log(`아직 안 끝낸 할 일 ${open.length}개 → 조각 ${placed.length}개 (나누지 않는 것 ${keep.length}개), 총 ${placed.reduce((s, x) => s + x.minutes, 0)}분\n`);
  for (const d of days) {
    const list = placed.filter((x) => x.date === d);
    const sum = used.get(d);
    console.log(`${md(d)}  ${String(sum).padStart(3)}분 / ${capOf(d)}${sum > capOf(d) ? "  ← 초과" : ""}`);
    for (const x of list) console.log(`     ${String(x.minutes).padStart(3)}분  ${x.title}${x.over ? "  ⚠ 마감 안에 자리 없음" : ""}`);
  }
  const sumBefore = open.reduce((s, t) => s + t.est, 0), sumAfter = placed.reduce((s, x) => s + x.minutes, 0);
  console.log(`\n총 예상 시간 보존: 전 ${sumBefore}분 → 후 ${sumAfter}분 ${sumBefore === sumAfter ? "(같음)" : "(달라짐! 중단)"}`);
  console.log(overflow ? `마감 안에 못 넣은 분량 ${overflow}분 (마감일에 그대로 둠)` : "모든 조각이 마감 안에 배정됨");
  if (sumBefore !== sumAfter) process.exit(1);

  if (!apply) { console.log("\n미리보기입니다. 실제로 반영하려면 끝에 --yes 를 붙여 다시 실행하세요."); process.exit(0); }

  // 4) 백업 후 반영 (한 트랜잭션)
  const dir = "D:/diary-backup";
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/tasks-before-split-${today}.json`;
  writeFileSync(file, JSON.stringify(open, null, 2));
  console.log(`\n원래 할 일을 백업했습니다: ${file}`);

  await sql.begin(async (tx) => {
    for (const x of placed) {
      if (x.whole) {
        await tx`update tasks set due_date = ${x.date}, updated_at = now() where id = ${x.task.id} and user_id = ${user.id}`;
      } else if (x.idx === 1) {
        await tx`update tasks set title = ${x.title}, due_date = ${x.date}, estimated_minutes = ${x.minutes}, updated_at = now() where id = ${x.task.id} and user_id = ${user.id}`;
      } else {
        await tx`insert into tasks (user_id, plan_id, title, due_date, priority, tags, estimated_minutes)
                 values (${user.id}, ${x.task.plan_id}, ${x.title}, ${x.date}, ${x.task.priority}, ${x.task.tags}::text[], ${x.minutes})`;
      }
    }
  });
  const [{ n }] = await sql`select count(*)::int n from tasks where user_id = ${user.id} and deleted_at is null and status = 'todo'`;
  console.log(`반영 완료. 지금 안 끝낸 할 일 ${n}개`);
} finally {
  await sql.end();
}
