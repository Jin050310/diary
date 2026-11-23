// 사용법: 개발(또는 배포 빌드) 서버를 켠 뒤  node scripts/test-security.mjs
// 카드 5 점검: ① 스크립트 삽입(XSS)이 텍스트로만 보이는지  ② 비밀값(DB 접속 문자열·비밀번호)이 어디에도 남지 않았는지
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import postgres from "postgres";
import { dropTestUser, newTestUser } from "./lib/test-user.mjs";

try { process.loadEnvFile(".env.local"); } catch {}
const BASE = process.env.BASE ?? "http://localhost:3000";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });

let fail = 0;
const check = (id, ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${id} ${msg}`); if (!ok) fail++; };
let tu; // 점검용 임시 계정 (로그인 쿠키). 인증이 붙은 뒤로는 모든 API 가 로그인을 요구한다
const call = async (path, init = {}) => {
  const res = await fetch(BASE + path, { ...init, headers: { "content-type": "application/json", ...(tu ? { cookie: tu.cookie } : {}), ...(init.headers ?? {}) } });
  return { status: res.status, text: await res.text() };
};
const post = (path, body) => call(path, { method: "POST", body: JSON.stringify(body) });

// ───────────── 파일 탐색 ─────────────
const SKIP_DIRS = new Set(["node_modules", "cache", "dev", ".git", "types"]);
function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) yield* walk(p); }
    else if (st.size < 8_000_000 && !/\.(png|ico|woff2?|jpg|svg)$/.test(name)) yield p;
  }
}

// ───────────── ② 비밀값 ─────────────
const url = new URL(process.env.DATABASE_URL);
const secrets = {
  "DB 비밀번호": decodeURIComponent(url.password),
  "접속 문자열 전체": process.env.DATABASE_URL,
  "DB 호스트": url.hostname,
};
const roots = ["app", "lib", "public", "contracts", "scripts", "db", "package.json", "README.md", ".env.example", "next.config.ts"];
const hasBuild = existsSync(".next/BUILD_ID");
if (hasBuild) roots.push(".next");

const leaks = [];
let scanned = 0;
for (const root of roots) {
  const files = existsSync(root) && statSync(root).isFile() ? [root] : [...walk(root)];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    scanned++;
    for (const [label, s] of Object.entries(secrets)) if (s && text.includes(s)) leaks.push(`${label} ← ${relative(".", f)}`);
  }
}
check("C58", leaks.length === 0, `소스${hasBuild ? "·빌드 산출물(.next)" : ""} 파일 ${scanned}개에 DB 비밀번호·접속 문자열·호스트 없음${leaks.length ? " → " + leaks.join(", ") : ""}`);
if (!hasBuild) console.log("INFO  배포용 빌드(.next/BUILD_ID)가 없어 브라우저로 나가는 번들은 검사하지 못함 → npm run build 후 다시 실행");

const envNames = readFileSync(".env.example", "utf8");
check("C58", !envNames.includes(secrets["DB 비밀번호"]) && /xxxxxxxx|YOUR-PASSWORD/.test(envNames), ".env.example 은 자리표시자만 있음");
const clientEnv = [...walk("app")].filter((f) => /NEXT_PUBLIC_/.test(readFileSync(f, "utf8")));
check("C58", clientEnv.length === 0, "브라우저로 공개되는 NEXT_PUBLIC_ 환경변수를 쓰지 않음");
const dbImporters = [...walk("app"), ...walk("lib")].filter((f) => /from "@\/lib\/db"|from "\.\/db"/.test(readFileSync(f, "utf8"))).map((f) => relative(".", f).replaceAll("\\", "/"));
check("C58", dbImporters.every((f) => f.startsWith("app/api/") || f.startsWith("lib/")) && !dbImporters.some((f) => /^app\/(?!api\/).*\.tsx$/.test(f)),
  `DB 접속 코드는 서버 전용(app/api, lib)에서만 불림 (${dbImporters.length}곳)`);

tu = await newTestUser(BASE);
// API 응답(정상·오류)과 내보내기 파일, 서버 로그에도 비밀값이 없는지
const probes = ["/api/plans", "/api/tasks", "/api/executions", "/api/completions", "/api/retro", "/api/retro-notes", "/api/export",
  "/api/plans/abc", "/api/plans/99999999", "/api/tasks?sort=x", "/api/tasks/99999999"];
const bodies = [];
for (const p of probes) bodies.push((await call(p)).text);
bodies.push((await post("/api/tasks", { plan_id: "x" })).text, (await post("/api/executions", { task_id: 1 })).text);
const apiLeak = bodies.some((b) => Object.values(secrets).some((s) => s && b.includes(s)));
check("C58", !apiLeak, `API 응답 ${bodies.length}개(정상·오류·내보내기 파일)에 비밀값 없음`);
const errBodies = bodies.filter((b) => b.includes('"error"'));
check("C58", errBodies.every((b) => !/postgres|SQL|stack| at |ECONN|password/i.test(b)), `오류 응답 ${errBodies.length}개에 DB 내부 정보·스택 없음`);
const log = process.env.DEV_LOG ?? join(tmpdir(), "dev.log");
// 오래된 로그 파일을 읽고 "문제없음" 으로 통과시키지 않도록, 최근 2시간 안에 기록된 로그일 때만 검사한다
const logFresh = existsSync(log) && Date.now() - statSync(log).mtimeMs < 2 * 3600 * 1000;
if (logFresh) {
  const t = readFileSync(log, "utf8");
  check("C58", !Object.values(secrets).some((s) => s && t.includes(s)), "서버 콘솔 로그에 비밀값 없음");
} else console.log("INFO  최근 서버 로그 파일이 없어 콘솔 로그 검사는 건너뜀 → 서버를 켤 때 출력을 임시 폴더의 dev.log 로 저장하면(npm run start > dev.log) 검사됨");

// ───────────── ① XSS ─────────────
const src = [...walk("app"), ...walk("lib")].filter((f) => /\.(tsx?|jsx?)$/.test(f));
const dangerous = src.filter((f) => /dangerouslySetInnerHTML|\.innerHTML\s*=|document\.write|\beval\(|new Function\(/.test(readFileSync(f, "utf8")));
check("C57", dangerous.length === 0, `HTML 을 직접 꽂는 코드(dangerouslySetInnerHTML·innerHTML·eval 등) 없음 (${src.length}개 소스 검사)`);

// 로그인 쿠키를 심은 헤드리스 Edge 로 화면을 열어 렌더링된 HTML 을 돌려준다 (Chrome DevTools Protocol)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function renderPages(edgePath, paths, cookieValue) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const userDir = mkdtempSync(join(tmpdir(), "edge-sec-"));
  const proc = spawn(edgePath, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`, "about:blank"], { stdio: "ignore" });
  try {
    let page;
    for (let i = 0; i < 60 && !page; i++) {
      try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {}
      if (!page) await sleep(250);
    }
    if (!page) return {};
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const waiting = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
    const send = (method, params = {}) => new Promise((res) => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    await send("Network.enable");
    await send("Network.setCookie", { name: "pds_session", value: cookieValue, url: BASE });
    const out = {};
    for (const p of paths) {
      await send("Page.navigate", { url: BASE + p });
      await sleep(6000);
      const r = await send("Runtime.evaluate", { expression: "document.documentElement.outerHTML", returnByValue: true });
      out[p] = r.result?.result?.value ?? "";
    }
    ws.close();
    return out;
  } finally { proc.kill(); try { rmSync(userDir, { recursive: true, force: true }); } catch {} }
}

const PAYLOAD = '<script>window.__pwn=1</script><img src="/__xss_probe__" onerror="window.__pwn=2">';
const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
let planId, taskId;
try {
  const plan = JSON.parse((await post("/api/plans", { title: `__test__ ${PAYLOAD}`, start_date: "2026-11-20", end_date: "2026-12-17", priority: 2, success_criteria: PAYLOAD, estimated_minutes: 10 })).text);
  planId = plan.id;
  const task = JSON.parse((await post("/api/tasks", { plan_id: planId, title: `__test__ ${PAYLOAD}`, due_date: "2026-11-25", priority: 2, tags: [PAYLOAD.slice(0, 20)], estimated_minutes: 5 })).text);
  taskId = task.id;
  await post("/api/executions", { task_id: taskId, started_at: "2026-11-19T10:00:00+09:00", ended_at: "2026-11-19T10:10:00+09:00", actual_minutes: 10, blocker: PAYLOAD });
  const stored = JSON.parse((await call(`/api/tasks/${taskId}`)).text);
  check("C57", stored.title === `__test__ ${PAYLOAD}`, "서버는 스크립트 모양 문자열을 가공 없이 그대로 저장(저장 시 변형·실행 없음)");

  if (!edge) console.log("INFO  Edge 를 찾지 못해 화면 렌더링 검사는 건너뜀");
  else {
    const pages = [["/tasks", "할 일 목록"], ["/records", "실행 기록(막힘 사유 포함)"], ["/retro", "회고"], [`/plans/${planId}`, "계획 상세"], ["/", "달력·계획 목록"]];
    const doms = await renderPages(edge, pages.map(([p]) => p), tu.cookie.replace("pds_session=", ""));
    for (const [p, label] of pages) {
      const d = doms[p];
      check("C57", d.includes("&lt;script&gt;window.__pwn=1&lt;/script&gt;"), `${label}(${p}): 스크립트 문자열이 글자 그대로(이스케이프되어) 표시됨`);
    }
    // 진짜 <img> 요소로 해석되었다면 브라우저가 /__xss_probe__ 를 요청해 서버 로그에 남는다
    const bad = [...Object.values(doms)].filter((d) => !d.length).length;
    check("C57", bad === 0, "모든 화면이 렌더링됨(빈 응답 없음)");
    if (logFresh) {
      const t = readFileSync(log, "utf8");
      check("C57", !t.includes("__xss_probe__"), "삽입한 <img> 가 실제 요소로 실행되지 않음(서버에 /__xss_probe__ 요청이 오지 않음)");
    } else console.log("INFO  최근 서버 로그가 없어 <img> 실행 여부 검사는 건너뜀");
  }
} finally {
  if (tu) await dropTestUser(sql, tu.id);
  if (taskId) { await sql`delete from executions where task_id = ${taskId}`; await sql`delete from completions where task_id = ${taskId}`; await sql`delete from tasks where id = ${taskId}`; }
  if (planId) await sql`delete from plans where id = ${planId}`;
  for (const tbl of ["plans", "tasks", "executions", "completions", "plan_revisions"]) {
    await sql`select setval(pg_get_serial_sequence(${tbl}, 'id'), coalesce((select max(id) from ${sql(tbl)}), 0) + 1, false)`;
  }
  await sql.end();
  console.log("정리 완료 (임시 계획·할 일 삭제)");
}
console.log(fail ? `\n실패 ${fail}건` : "\n모두 통과");
process.exit(fail ? 1 : 0);
