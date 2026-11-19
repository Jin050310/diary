// 사용법: npm run db:migrate   (.env.local 의 DATABASE_URL 로 db/schema.sql 실행)
import { readFileSync } from "node:fs";
import postgres from "postgres";

try { process.loadEnvFile(".env.local"); } catch { /* 환경변수로 직접 줄 수도 있음 */ }
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL 이 없습니다. .env.local 을 확인하세요.");
  process.exit(1);
}
const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
try {
  await sql.unsafe(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
  console.log("스키마 적용 완료");
} finally {
  await sql.end();
}
