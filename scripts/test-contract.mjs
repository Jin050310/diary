// 사용법: node scripts/test-contract.mjs
// contracts/pds-schema-v2.json 이 실제 서버 DB 와 일치하는지 대조한다. (테이블·컬럼·타입·NULL 여부·관계·삭제 규칙)
import { readFileSync } from "node:fs";
import postgres from "postgres";

try { process.loadEnvFile(".env.local"); } catch {}
const contract = JSON.parse(readFileSync(new URL("../contracts/pds-schema-v2.json", import.meta.url), "utf8"));
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

let fail = 0;
const check = (ok, msg) => { if (!ok) { console.log("FAIL", msg); fail++; } };

const TYPE = { bigint: "bigint", text: "text", date: "date", integer: "integer", smallint: "smallint", uuid: "uuid",
  timestamptz: "timestamp with time zone", "text[]": "ARRAY" };

const cols = await sql`select table_name t, column_name c, data_type d, is_nullable n from information_schema.columns where table_schema = 'public'`;
const dbTables = new Set(cols.map((r) => r.t));
const cTables = Object.keys(contract.tables);
check(cTables.every((t) => dbTables.has(t)) && [...dbTables].every((t) => cTables.includes(t)), `테이블 목록 일치 (계약 ${cTables.length}개 / DB ${dbTables.size}개)`);

let colCount = 0;
for (const [t, def] of Object.entries(contract.tables)) {
  const dbCols = cols.filter((r) => r.t === t);
  const names = Object.keys(def.columns);
  check(names.length === dbCols.length && dbCols.every((r) => names.includes(r.c)), `${t}: 컬럼 목록 일치`);
  for (const [c, cd] of Object.entries(def.columns)) {
    const r = dbCols.find((x) => x.c === c);
    if (!r) { check(false, `${t}.${c} 가 DB 에 없음`); continue; }
    colCount++;
    check(r.d === TYPE[cd.type], `${t}.${c}: 타입 ${cd.type} ↔ DB ${r.d}`);
    check((r.n === "YES") === cd.nullable, `${t}.${c}: nullable ${cd.nullable} ↔ DB ${r.n}`);
  }
}

const fks = await sql`
  select tc.table_name t, kcu.column_name c, ccu.table_name ref_t, ccu.column_name ref_c, rc.delete_rule dr
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
  join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
  join information_schema.constraint_column_usage ccu on ccu.constraint_name = rc.unique_constraint_name
  where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'`;
let fkCount = 0;
for (const [t, def] of Object.entries(contract.tables)) {
  for (const fk of def.foreign_keys ?? []) {
    fkCount++;
    const [rt, rc] = fk.references.split(".");
    const hit = fks.find((r) => r.t === t && r.c === fk.column && r.ref_t === rt && r.ref_c === rc);
    check(hit && hit.dr === fk.on_delete, `${t}.${fk.column} → ${fk.references} (${fk.on_delete})`);
  }
}
check(fks.length === fkCount, `외래 키 개수 일치 (계약 ${fkCount} / DB ${fks.length})`);

const idx = await sql`select indexname, indexdef from pg_indexes where schemaname = 'public'`;
const hasUnique = (t, cs, where) => idx.some((i) => i.indexdef.includes("UNIQUE") && i.indexdef.includes(` ON public.${t} `)
  && cs.every((c) => i.indexdef.includes(c)) && (!where || i.indexdef.toLowerCase().includes("where")));
for (const [t, def] of Object.entries(contract.tables)) {
  for (const u of def.unique ?? []) check(hasUnique(t, u.columns, u.where), `${t}: 유니크 ${u.columns.join(",")}${u.where ? ` (where ${u.where})` : ""}`);
}

await sql.end();
console.log(fail ? `\n실패 ${fail}건` : `계약 ↔ DB 일치: 테이블 ${cTables.length}개, 컬럼 ${colCount}개, 외래 키 ${fkCount}개`);
process.exit(fail ? 1 : 0);
