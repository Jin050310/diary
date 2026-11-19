import "server-only"; // 이 파일이 브라우저 번들에 섞이면 빌드가 실패함 → DB 접속 문자열 노출 방지
import postgres from "postgres";

const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 환경변수가 설정되지 않았습니다.");
  return postgres(url, {
    prepare: false, // Supabase 트랜잭션 풀러(6543) 호환
    // 연결은 필요할 때만 열린다. 상한을 넉넉히 둔 이유: postgres 4.1.1 은 "동시 쿼리 수 > max" 가 되면
    // 대기 중인 쿼리가 영영 풀리지 않고 멈춘다(max 1 에서 쿼리 4개만 보내도 재현). 대기열 상태가 아예 생기지 않게 한다.
    max: 30,
    types: {
      // date(1082)는 'YYYY-MM-DD' 문자열 그대로 받음 → 시간대 변환으로 날짜가 하루 밀리는 문제 방지
      date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
      // bigint(20)는 숫자로 받음 (id 범위는 안전 정수 이내)
      bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
    },
  });
}

export function db() {
  if (!globalForDb.sql) globalForDb.sql = createClient();
  return globalForDb.sql;
}
