// 사용법: 개발 서버를 켠 상태에서  node scripts/test-auth.mjs   (BASE=http://localhost:3000 기본)
// 과제 7 카드 1~4 의 증거를 한 번에 만든다. 계정 2개(__t7_a_…, __t7_b_…)를 만들어 쓰고, 끝나면 계정과 자료를 모두 지운다.
// 출력에는 "요청 → 응답"이 그대로 나오지만 비밀번호는 아예 출력하지 않고, 토큰·해시는 앞부분만 보여 주고 '...생략' 으로 가린다.
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";

try { process.loadEnvFile(".env.local"); } catch { /* 환경변수로 직접 줄 수도 있음 */ }
const BASE = process.env.BASE ?? "http://localhost:3000";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2, onnotice: () => {} });

const tag = randomBytes(3).toString("hex");
const nameA = `__t7_a_${tag}`, nameB = `__t7_b_${tag}`;
const pwShared = randomBytes(12).toString("base64url") + "!1"; // 두 계정이 같은 비밀번호를 쓰도록 (저장값이 다른지 보려고). 출력하지 않는다.
const pwNew = randomBytes(12).toString("base64url") + "!2";

let pass = 0, fail = 0;
const ok = (cond, label, detail = "") => { if (cond) pass++; else fail++; console.log(`  ${cond ? "[통과]" : "[실패]"} ${label}${detail ? "  " + detail : ""}`); };
const mask = (t) => (t ? String(t).slice(0, 6) + "...생략" : "(없음)");
const show = (title, method, path, res, body) =>
  console.log(`    ${title}\n      ${method} ${path} → ${res.status} ${typeof body === "string" ? body : JSON.stringify(body)}`.replace(/\n\s+\n/g, "\n"));

// 쿠키를 들고 다니는 작은 클라이언트
function client() {
  const c = { cookie: "" };
  c.req = async (method, path, body, headers = {}) => {
    const res = await fetch(BASE + path, {
      method, redirect: "manual",
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(c.cookie ? { Cookie: c.cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.getSetCookie?.() ?? [];
    c.setCookieRaw = sc.find((x) => x.startsWith("pds_session=")) ?? c.setCookieRaw;
    const mine = sc.find((x) => x.startsWith("pds_session="));
    if (mine) seenTokens.add(mine.split(";")[0].replace("pds_session=", ""));
    if (mine) c.cookie = mine.split(";")[0].startsWith("pds_session=;") || /Max-Age=0|expires=Thu, 01 Jan 1970/i.test(mine) ? "" : mine.split(";")[0];
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text.slice(0, 80); }
    return { status: res.status, json, headers: res.headers };
  };
  return c;
}
const token = (c) => c.cookie.replace("pds_session=", "");

const seenTokens = new Set(); // 이 점검에서 발급된 토큰 원문들 (끝에서 서버 로그에 남지 않았는지 확인)
const created = { A: {}, B: {} };
async function seed(c, who, label) {
  const plan = await c.req("POST", "/api/plans", { title: `${label} 계획`, start_date: "2026-11-23", end_date: "2026-12-20", priority: 2, success_criteria: `${label} 기준`, estimated_minutes: 300 });
  const task = await c.req("POST", "/api/tasks", { plan_id: plan.json.id, title: `${label} 할 일`, due_date: "2026-11-30", priority: 2, tags: [], estimated_minutes: 60 });
  const exec = await c.req("POST", "/api/executions", { task_id: task.json.id, started_at: "2026-11-23T10:00:00+09:00", ended_at: "2026-11-23T10:30:00+09:00", blocker: `${label} 막힘` });
  const done = await c.req("POST", `/api/tasks/${task.json.id}/complete`, undefined, { "Idempotency-Key": randomUUID() });
  const note = await c.req("POST", "/api/retro-notes", { plan_id: plan.json.id, improvement: `${label} 개선점` });
  created[who] = { plan: plan.json.id, task: task.json.id, exec: exec.json.id, note: note.json.id, planRes: plan.status, taskRes: task.status, execRes: exec.status, doneRes: done.status, noteRes: note.status };
}
async function counts(userName) {
  const [r] = await sql`
    select (select count(*)::int from plans where user_id = u.id) plans, (select count(*)::int from tasks where user_id = u.id) tasks,
           (select count(*)::int from executions where user_id = u.id) executions, (select count(*)::int from completions where user_id = u.id) completions,
           (select count(*)::int from retro_notes where user_id = u.id) retro_notes, (select count(*)::int from plan_revisions r join plans p on p.id = r.plan_id where p.user_id = u.id) revisions,
           (select string_agg(title, '|' order by id) from tasks where user_id = u.id) task_titles
    from users u where username = ${userName}`;
  return r;
}

async function cleanup() {
  const ids = (await sql`select id from users where username in (${nameA}, ${nameB})`).map((r) => r.id);
  if (!ids.length) return;
  await sql`update plans set source_retro_note_id = null where user_id in ${sql(ids)}`;
  await sql`delete from executions where user_id in ${sql(ids)}`;
  await sql`delete from completions where user_id in ${sql(ids)}`;
  await sql`delete from retro_notes where user_id in ${sql(ids)}`;
  await sql`delete from tasks where user_id in ${sql(ids)}`;
  await sql`delete from plans where user_id in ${sql(ids)}`;
  await sql`delete from users where id in ${sql(ids)}`; // sessions 는 ON DELETE CASCADE
}

try {
  const A = client(), B = client(), anon = client();

  console.log("\n━━ 카드 1  가입·로그인·로그아웃, 비로그인 접근 ━━");
  let r = await A.req("POST", "/api/auth/signup", { username: nameA, password: pwShared });
  ok(r.status === 201, "가입 A 성공(201)", `→ ${JSON.stringify(r.json)}`);
  r = await B.req("POST", "/api/auth/signup", { username: nameB, password: pwShared });
  ok(r.status === 201, "가입 B 성공(201)");
  r = await anon.req("POST", "/api/auth/signup", { username: nameA, password: pwShared });
  show("같은 아이디로 다시 가입", "POST", "/api/auth/signup", r, r.json);
  ok(r.status === 409, "같은 아이디 중복 가입 거절(409)");
  r = await anon.req("POST", "/api/auth/signup", { username: nameA.toUpperCase(), password: pwShared });
  ok(r.status === 409, "대소문자만 다른 아이디도 중복으로 거절(409)");
  r = await anon.req("POST", "/api/auth/signup", { username: `${nameA}x`, password: "short" });
  ok(r.status === 400, "8자 미만 비밀번호 가입 거절(400)", JSON.stringify(r.json));

  const wrongPw = await anon.req("POST", "/api/auth/login", { username: nameA, password: pwNew });
  const noUser = await anon.req("POST", "/api/auth/login", { username: `__t7_none_${tag}`, password: pwNew });
  show("아이디는 맞고 비밀번호만 틀림", "POST", "/api/auth/login", wrongPw, wrongPw.json);
  show("아이디 자체가 없음", "POST", "/api/auth/login", noUser, noUser.json);
  ok(wrongPw.status === 401 && noUser.status === 401 && JSON.stringify(wrongPw.json) === JSON.stringify(noUser.json), "두 경우의 상태·안내 문구가 똑같음");

  const A2 = client();
  r = await A2.req("POST", "/api/auth/login", { username: nameA, password: pwShared });
  ok(r.status === 200 && !!A2.cookie, "만든 계정으로 로그인 성공", `→ 쿠키 pds_session=${mask(token(A2))}`);
  const me = await A2.req("GET", "/api/auth/me");
  ok(me.status === 200 && me.json.user.username === nameA, "로그인 상태에서 내 정보 조회 성공", JSON.stringify(me.json));

  for (const p of ["/", "/tasks", "/records", "/direction", "/retro", "/account"]) {
    r = await anon.req("GET", p);
    ok(r.status === 307 && new URL(r.headers.get("location"), BASE).pathname === "/login", `로그인 없이 ${p} → 로그인 화면으로 이동`, `(${r.status} → ${r.headers.get("location")})`);
  }

  console.log("\n━━ 카드 2  비밀번호 저장 ━━");
  const [ha] = await sql`select password_hash from users where username = ${nameA}`;
  const [hb] = await sql`select password_hash from users where username = ${nameB}`;
  const shape = (h) => h.split("$").slice(0, 5).join("$") + "$" + mask(h.split("$")[5]);
  console.log(`    DB 에 저장된 A 의 비밀번호 값: ${shape(ha.password_hash)}`);
  console.log(`    DB 에 저장된 B 의 비밀번호 값: ${shape(hb.password_hash)}   (A·B 는 같은 비밀번호로 가입)`);
  ok(ha.password_hash.startsWith("$argon2id$"), "알고리즘 argon2id (솔트·비용 값이 해시 안에 들어 있음)");
  ok(ha.password_hash !== hb.password_hash, "같은 비밀번호인데 두 계정의 저장값이 서로 다름(솔트)");
  ok(!ha.password_hash.includes(pwShared) && !hb.password_hash.includes(pwShared), "저장값에 입력한 비밀번호 글자가 그대로 보이지 않음");
  const everything = JSON.stringify(await sql`select * from users where username in (${nameA}, ${nameB})`) + JSON.stringify(await sql`select * from sessions`);
  ok(!everything.includes(pwShared), "users·sessions 어느 열에도 비밀번호 평문이 없음");

  console.log("\n━━ 카드 3  세션·토큰 ━━");
  const S = client();
  r = await S.req("POST", "/api/auth/login", { username: nameA, password: pwShared });
  const setCookie = S.setCookieRaw ?? "";
  console.log(`    로그인 응답의 Set-Cookie: ${setCookie.replace(/pds_session=[^;]+/, "pds_session=" + mask(token(S)))}`);
  ok(/HttpOnly/i.test(setCookie), "쿠키에 HttpOnly (브라우저 스크립트가 못 읽음)");
  ok(/SameSite=lax/i.test(setCookie), "쿠키에 SameSite=Lax (다른 사이트의 요청에 안 붙음)");
  ok(/expires=/i.test(setCookie) || /max-age=/i.test(setCookie), "쿠키에 만료 시각이 있음");
  const tokHash = createHash("sha256").update(token(S)).digest("hex");
  const [srow] = await sql`select token_hash, extract(epoch from (expires_at - created_at))/86400 as days from sessions where token_hash = ${tokHash}`;
  ok(!!srow && srow.token_hash !== token(S), "DB 에는 토큰 원문이 아니라 해시만 저장", `(저장된 값 ${mask(srow?.token_hash)})`);
  ok(srow && Math.abs(srow.days - 7) < 0.01, "유효 기간 7일 (DB 의 expires_at)", `(${Number(srow?.days).toFixed(2)}일)`);

  const before = await S.req("GET", "/api/auth/me");
  const oldCookie = S.cookie;
  await S.req("POST", "/api/auth/logout");
  const replay = client(); replay.cookie = oldCookie;
  const after = await replay.req("GET", "/api/auth/me");
  console.log("    같은 주소·같은 방식, 달라진 것은 로그아웃 여부뿐:");
  console.log(`      로그인 상태   GET /api/auth/me (쿠키 ${mask(oldCookie.replace("pds_session=", ""))}) → ${before.status} ${JSON.stringify(before.json)}`);
  console.log(`      로그아웃 뒤   GET /api/auth/me (같은 쿠키 값)  → ${after.status} ${JSON.stringify(after.json)}`);
  ok(before.status === 200 && after.status === 401, "로그아웃 뒤 같은 토큰으로 요청하면 거절(401)");
  const [gone] = await sql`select count(*)::int n from sessions where token_hash = ${tokHash}`;
  ok(gone.n === 0, "서버(DB)에서 세션이 실제로 삭제됨 — 브라우저 쿠키만 지운 것이 아님");

  // 만료
  const E = client(); await E.req("POST", "/api/auth/login", { username: nameA, password: pwShared });
  await sql`update sessions set expires_at = now() - interval '1 minute' where token_hash = ${createHash("sha256").update(token(E)).digest("hex")}`;
  r = await E.req("GET", "/api/auth/me");
  show("만료 시각이 지난 세션", "GET", "/api/auth/me", r, r.json);
  ok(r.status === 401, "만료된 세션은 거절(401)");

  // 비밀번호 변경 → 이전 세션 모두 무효
  const P1 = client(), P2 = client();
  await P1.req("POST", "/api/auth/login", { username: nameA, password: pwShared });
  await P2.req("POST", "/api/auth/login", { username: nameA, password: pwShared });
  const p2old = P2.cookie;
  r = await P1.req("POST", "/api/auth/password", { current_password: pwNew, new_password: pwNew });
  ok(r.status === 400, "현재 비밀번호가 틀리면 변경 거절(400)", JSON.stringify(r.json));
  r = await P1.req("POST", "/api/auth/password", { current_password: pwShared, new_password: pwNew });
  ok(r.status === 200, "비밀번호 변경 성공");
  const stale = client(); stale.cookie = p2old;
  r = await stale.req("GET", "/api/auth/me");
  console.log(`      변경 전 다른 기기의 토큰 ${mask(p2old.replace("pds_session=", ""))} → GET /api/auth/me → ${r.status} ${JSON.stringify(r.json)}`);
  ok(r.status === 401, "비밀번호를 바꾸면 이전에 발급된 토큰은 더 통하지 않음");
  r = await P1.req("GET", "/api/auth/me");
  ok(r.status === 200, "변경한 기기에는 새 세션이 발급되어 계속 사용 가능");
  r = await anon.req("POST", "/api/auth/login", { username: nameA, password: pwShared });
  ok(r.status === 401, "옛 비밀번호로는 로그인 안 됨");
  r = await A.req("POST", "/api/auth/login", { username: nameA, password: pwNew });
  ok(r.status === 200, "새 비밀번호로 로그인 됨");

  // 토큰이 URL·본문에 나오지 않는지: 로그인 응답 본문
  const T = client(); // 로그인하는 용도의 별도 클라이언트 (anon 은 끝까지 로그인하지 않은 상태로 둔다)
  r = await T.req("POST", "/api/auth/login", { username: nameB, password: pwShared });
  ok(!JSON.stringify(r.json).includes(token(T)) && token(T).length > 20, "로그인 응답 본문에 토큰이 없고 쿠키로만 전달됨");
  await B.req("POST", "/api/auth/login", { username: nameB, password: pwShared });
  ok(!anon.cookie, "(점검 자체 확인) 비로그인 용도의 anon 클라이언트는 쿠키가 없음");

  console.log("\n━━ 카드 4  다른 계정 자료 접근 ━━");
  await seed(A, "A", "A계정");
  await seed(B, "B", "B계정");
  const ca = await counts(nameA), cb = await counts(nameB);
  console.log(`    A 의 자료: ${JSON.stringify({ ...ca, task_titles: undefined })}`);
  console.log(`    B 의 자료: ${JSON.stringify({ ...cb, task_titles: undefined })}   (비밀번호는 기록하지 않음)`);
  ok([ca, cb].every((c) => c.plans === 1 && c.tasks === 1 && c.executions === 1 && c.completions === 1 && c.retro_notes === 1), "계정 두 개를 만들어 각각 계획·할 일·실행 기록·완료·회고를 1건씩 넣음");

  console.log("\n  ── 성공하는 쪽: 같은 요청을 자기 자료로 하면 열린다 (거절 쪽과 나란히 비교) ──");
  for (const [who, c, ids] of [["A", A, created.A], ["B", B, created.B]]) {
    for (const [label, method, path, body] of [
      [`${who} 가 자기 할 일 읽기`, "GET", `/api/tasks/${ids.task}`],
      [`${who} 가 자기 계획 읽기`, "GET", `/api/plans/${ids.plan}`],
      [`${who} 가 자기 계획의 진행 방향 읽기`, "GET", `/api/direction?plan=${ids.plan}`],
      [`${who} 가 자기 할 일 수정`, "PATCH", `/api/tasks/${ids.task}`, { plan_id: ids.plan, title: `${who}계정 할 일`, due_date: "2026-11-30", priority: 2, tags: [], estimated_minutes: 60 }],
    ]) {
      r = await c.req(method, path, body);
      show(label, method, path, r, r.json?.title ?? r.json?.plan?.title ?? (r.json?.plan ? r.json.plan.title : "(본문 생략)"));
      ok(r.status === 200, `${label} → 200 성공`);
    }
  }
  r = await A.req("GET", "/api/tasks");
  ok(r.status === 200 && r.json.length === 1, "로그인한 A 의 GET /api/tasks → 200, 자기 할 일 1건", `(${r.status}, ${r.json.length}건)`);

  const attacks = (them, mine) => [
    ["읽기: 할 일 1건", "GET", `/api/tasks/${them.task}`],
    ["읽기: 계획 상세", "GET", `/api/plans/${them.plan}`],
    ["읽기: 진행 방향", "GET", `/api/direction?plan=${them.plan}`],
    ["수정: 할 일", "PATCH", `/api/tasks/${them.task}`, { plan_id: mine.plan, title: "탈취", due_date: null, priority: 1, tags: [], estimated_minutes: 1 }],
    ["수정: 계획", "PATCH", `/api/plans/${them.plan}`, { title: "탈취", start_date: "2026-11-23", end_date: "2026-12-01", priority: 1, success_criteria: "탈취", estimated_minutes: 1 }],
    ["수정: 완료 처리", "POST", `/api/tasks/${them.task}/complete`, undefined, { "Idempotency-Key": randomUUID() }],
    ["수정: 완료 취소", "DELETE", `/api/tasks/${them.task}/complete`],
    ["삭제: 할 일", "DELETE", `/api/tasks/${them.task}`],
    ["쓰기: 남의 할 일에 실행 기록 추가", "POST", "/api/executions", { task_id: them.task, started_at: "2026-11-24T10:00:00+09:00", ended_at: "2026-11-24T10:10:00+09:00" }],
    ["쓰기: 남의 계획에 할 일 추가", "POST", "/api/tasks", { plan_id: them.plan, title: "끼워넣기", due_date: null, priority: 2, tags: [], estimated_minutes: 1 }],
    ["쓰기: 남의 계획에 회고 추가", "POST", "/api/retro-notes", { plan_id: them.plan, improvement: "끼워넣기" }],
    ["쓰기: 남의 개선점으로 다음 계획 생성", "POST", `/api/retro-notes/${them.note}/next-plan`, { title: "끼워넣기", start_date: "2026-12-01", end_date: "2026-12-02", priority: 2, success_criteria: "x", estimated_minutes: 0 }],
  ];

  for (const [from, fc, to, , themIds, mineIds] of [["A", A, "B", B, created.B, created.A], ["B", B, "A", A, created.A, created.B]]) {
    console.log(`\n  ── ${from} 로 로그인해 ${to} 의 자료를 요청 ──`);
    const beforeN = await counts(to === "B" ? nameB : nameA);
    for (const [label, method, path, body, hdr] of attacks(themIds, mineIds)) {
      r = await fc.req(method, path, body, hdr ?? {});
      show(label, method, path, r, r.json);
      ok(r.status === 404 || r.status === 403, `${label} → ${r.status} 거절`);
    }
    const afterN = await counts(to === "B" ? nameB : nameA);
    ok(JSON.stringify(beforeN) === JSON.stringify(afterN), `거절 앞뒤로 ${to} 의 자료 건수·제목이 그대로`, `(${JSON.stringify({ ...beforeN, task_titles: undefined })})`);
  }
  ok(JSON.stringify(await counts(nameA)) === JSON.stringify(ca) && JSON.stringify(await counts(nameB)) === JSON.stringify(cb), "양방향 시도가 끝난 뒤에도 A·B 의 건수와 제목이 처음과 같음(반대편에 새로 생긴 자료 없음)");

  console.log("\n  ── 주소·헤더·본문에 다른 계정을 적어 보냄 (A 로 로그인) ──");
  // DB 의 bigint 는 문자열로 오므로 숫자로 바꿔 API 응답(숫자)과 비교한다
  const idB = Number((await sql`select id from users where username = ${nameB}`)[0].id);
  const idA = Number((await sql`select id from users where username = ${nameA}`)[0].id);
  const plansBefore = (await counts(nameB)).plans;
  r = await A.req("GET", `/api/plans?user_id=${idB}&owner=${nameB}`, undefined, { "X-User-Id": String(idB), "X-User": nameB });
  show("주소·헤더에 B 를 적은 목록 요청", "GET", `/api/plans?user_id=${idB}…`, r, r.json.map((p) => p.title));
  ok(r.status === 200 && r.json.every((p) => p.user_id === idA) && !JSON.stringify(r.json).includes("B계정"), "그래도 A 자신의 계획만 돌아옴");
  r = await A.req("POST", "/api/plans", { user_id: idB, owner: nameB, title: "본문에 B 를 적은 계획", start_date: "2026-11-23", end_date: "2026-12-01", priority: 2, success_criteria: "x", estimated_minutes: 0 }, { "X-User-Id": String(idB) });
  const [owner] = await sql`select user_id from plans where id = ${r.json.id}`;
  show("본문·헤더에 B 를 적어 계획 생성", "POST", "/api/plans", r, { id: r.json.id, user_id: r.json.user_id });
  ok(r.status === 201 && Number(owner.user_id) === idA && (await counts(nameB)).plans === plansBefore, "새 계획의 주인은 A(로그인한 사람)이고 B 에게는 생기지 않음");

  console.log("\n  ── 로그인하지 않고 직접 요청 ──");
  for (const [m, p, b] of [["GET", "/api/tasks"], ["GET", "/api/plans"], ["GET", `/api/tasks/${created.A.task}`], ["GET", "/api/export"], ["GET", "/api/retro"], ["POST", "/api/tasks", { plan_id: created.A.plan, title: "x", priority: 2, tags: [], estimated_minutes: 0 }], ["DELETE", `/api/tasks/${created.A.task}`]]) {
    r = await anon.req(m, p, b);
    show("로그인 없음", m, p, r, r.json);
    ok(r.status === 401, `${m} ${p} → 401`);
  }

  console.log("\n  ── 목록 응답에 다른 계정 자료가 섞이지 않는가 (A 로 로그인) ──");
  const bTitles = ["B계정 계획", "B계정 할 일", "B계정 막힘", "B계정 개선점"];
  const lists = [["/api/plans"], ["/api/tasks"], ["/api/executions"], ["/api/completions"], ["/api/retro-notes"], ["/api/retro"], ["/api/export"], [`/api/direction?plan=${created.A.plan}`]];
  for (const [p] of lists) {
    r = await A.req("GET", p);
    const text = JSON.stringify(r.json);
    ok(r.status === 200 && !bTitles.some((t) => text.includes(t)) && !new RegExp(`"user_id":${idB}[,}]`).test(text), `${p} 응답에 B 의 자료·user_id 가 하나도 없음`);
  }
  r = await A.req("GET", `/api/retro?plan=${created.B.plan}`);
  ok(r.status === 200 && r.json.totals.task_count === 0 && r.json.tasks.length === 0 && r.json.executions.length === 0, "B 의 계획을 지정한 회고 집계도 비어 있음");
  r = await A.req("GET", `/api/executions?task=${created.B.task}`);
  ok(r.status === 200 && r.json.length === 0, "B 의 할 일로 거른 실행 기록 목록도 비어 있음");

  console.log("\n  ── 다른 사이트에서 온 쓰기 요청 ──");
  r = await A.req("POST", "/api/plans", { title: "x", start_date: "2026-11-23", end_date: "2026-12-01", priority: 2, success_criteria: "x", estimated_minutes: 0 }, { Origin: "https://evil.example" });
  show("Origin 이 다른 사이트", "POST", "/api/plans", r, r.json);
  ok(r.status === 403, "다른 사이트에서 온 쓰기 요청은 거절(403)");
  console.log("\n━━ 서버 로그에 비밀값이 남지 않았는가 (카드 2·3) ━━");
  const log = process.env.DEV_LOG ?? join(tmpdir(), "dev.log");
  if (existsSync(log) && Date.now() - statSync(log).mtimeMs < 2 * 3600 * 1000) {
    const t = readFileSync(log, "utf8");
    ok(!t.includes(pwShared) && !t.includes(pwNew), "서버 로그에 비밀번호 원문이 없음", `(로그 ${t.split("\n").length}줄 검사)`);
    ok(![...seenTokens].some((tok) => tok.length > 20 && t.includes(tok)), "서버 로그에 세션 토큰 원문이 없음", `(토큰 ${seenTokens.size}개 대조)`);
  } else console.log("  INFO  최근 서버 로그 파일이 없어 로그 검사는 건너뜀 (서버를 npm run start > 임시폴더/dev.log 로 켜면 검사됨)");
} catch (e) {
  fail++;
  console.log("\n[오류] 점검 중 예외:", e instanceof Error ? e.message : e);
} finally {
  await cleanup().catch((e) => console.log("정리 중 오류:", e.message));
  await sql.end();
  console.log(`\n${fail ? "실패" : "모두 통과"}: 통과 ${pass} / 실패 ${fail}  (임시 계정·자료는 모두 삭제함)`);
  process.exit(fail ? 1 : 0);
}
