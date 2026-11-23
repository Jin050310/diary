// 사용법:  node scripts/claim-data.mjs <아이디>          (미리보기: 무엇이 바뀌는지만 보여 줌)
//          node scripts/claim-data.mjs <아이디> --yes    (실제로 이관)
// 과제 7: 로그인이 없던 6번에서 입력한 자료(주인 없는 행)를 내 계정의 것으로 옮긴다.
// 먼저 화면에서 가입한 뒤 그 아이디로 실행한다. 이관이 끝나면 각 자료의 user_id 를 NOT NULL 로 바꿔서,
// 앞으로는 주인 없는 자료가 생길 수 없게 DB 가 막는다. 여러 번 실행해도 안전하다. (이미 주인이 있는 행은 건드리지 않음)
import postgres from "postgres";

try { process.loadEnvFile(".env.local"); } catch {}
const username = (process.argv[2] ?? "").trim().toLowerCase();
const apply = process.argv.includes("--yes");
if (!username || username.startsWith("-")) {
  console.error("사용법: node scripts/claim-data.mjs <아이디> [--yes]");
  process.exit(1);
}
if (username.startsWith("__t7_")) {
  console.error("점검용 임시 계정(__t7_…)에는 이관하지 않습니다.");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });
const TABLES = ["plans", "tasks", "executions", "completions", "retro_notes"];
try {
  const [user] = await sql`select id, username from users where username = ${username}`;
  if (!user) {
    console.error(`아이디 '${username}' 가 없습니다. 먼저 화면에서 가입하세요.`);
    process.exit(1);
  }

  const unowned = {};
  for (const t of TABLES) unowned[t] = (await sql`select count(*)::int n from ${sql(t)} where user_id is null`)[0].n;
  const total = Object.values(unowned).reduce((a, b) => a + b, 0);
  console.log(`대상 계정: ${user.username} (id ${user.id})`);
  console.log("주인 없는 자료:", unowned);

  if (!apply) {
    console.log(total ? "\n미리보기입니다. 실제로 옮기려면 끝에 --yes 를 붙여 다시 실행하세요." : "\n옮길 자료가 없습니다.");
  } else {
    await sql.begin(async (tx) => {
      for (const t of TABLES) await tx`update ${tx(t)} set user_id = ${user.id} where user_id is null`;
      for (const t of TABLES) await tx.unsafe(`alter table ${t} alter column user_id set not null`);
    });
    const after = {};
    for (const t of TABLES) after[t] = (await sql`select count(*)::int n from ${sql(t)} where user_id = ${user.id}`)[0].n;
    console.log("\n이관 완료. 이 계정의 자료:", after);
    console.log("user_id 는 이제 NOT NULL 입니다.");
  }
} finally {
  await sql.end();
}
