// 사용법:  node scripts/name-steps.mjs <아이디>          (미리보기)
//          node scripts/name-steps.mjs <아이디> --yes    (반영. 반영 전에 현재 제목을 백업 파일로 저장)
// scripts/split-tasks.mjs 가 만든 "제목 (1/7)" 같은 조각 이름을, 단계가 드러나는 서로 다른 이름으로 바꾼다.
// 시간·마감일·프로젝트는 그대로 두고 제목만 바꾼다. 제목이 예상한 "원래 제목 (i/n)" 과 정확히 같은 할 일만 바꾼다.
import { mkdirSync, writeFileSync } from "node:fs";
import postgres from "postgres";

try { process.loadEnvFile(".env.local"); } catch {}
const args = process.argv.slice(2);
const username = (args.find((a) => !a.startsWith("--")) ?? "").trim().toLowerCase();
const apply = args.includes("--yes");
if (!username || username.startsWith("__t7_")) { console.error("사용법: node scripts/name-steps.mjs <아이디> [--yes]"); process.exit(1); }

// 원래 제목 → 단계 이름 (개수가 곧 조각 수 n). 제목 앞의 "화면:" 같은 말은 어느 일의 단계인지 보이게 하려는 것.
const STEPS = {
  "번역 기능 화면 만들기": ["번역 화면: 입력창·결과창 구성 잡기", "번역 화면: 일본어 입력과 번역 요청 연결", "번역 화면: 번역 결과 표시", "번역 화면: 읽는 법(후리가나) 표시", "번역 화면: 오류·빈 입력 처리", "번역 화면: 번역 기록 저장·불러오기", "번역 화면: 모바일 화면 다듬기와 점검"],
  "단어장 저장 기능": ["단어장: 저장할 항목(단어·뜻·읽기) 정하기", "단어장: 저장용 표(DB) 만들기", "단어장: 번역 결과에서 '단어장에 추가' 버튼", "단어장: 단어 목록 화면", "단어장: 단어 수정·삭제", "단어장: 같은 단어 중복 처리", "단어장: 저장 기능 점검"],
  "테스트(퀴즈) 기능 만들기": ["퀴즈: 출제 방식(뜻 고르기·읽기 맞히기) 정하기", "퀴즈: 단어장에서 문제 뽑기", "퀴즈: 보기 4개 만들기", "퀴즈: 문제 풀이 화면", "퀴즈: 채점과 결과 화면", "퀴즈: 틀린 단어 다시 풀기"],
  "번역·단어장·테스트 연결과 오류 점검": ["연결 점검: 번역 → 단어장 흐름 확인", "연결 점검: 단어장 → 퀴즈 흐름 확인", "연결 점검: 발견된 오류 고치기", "연결 점검: 처음부터 끝까지 다시 써 보기"],
  "사용 문서 작성과 최종 배포": ["최종 배포: 사용 방법 문서 쓰기", "최종 배포: 배포하고 새 창에서 확인"],
  "옷 정보 데이터 항목 정리": ["옷 데이터: 필요한 항목(종류·색·계절·핏) 정하기", "옷 데이터: 항목별 입력 예시 만들고 확정"],
  "옷 정보 목록·검색 화면 만들기": ["옷 목록: 카드형 목록 화면", "옷 목록: 검색창과 필터(종류·색)", "옷 목록: 옷 상세 보기", "옷 목록: 결과 없음·오류 화면"],
  "트렌드 코디 추천 규칙 설계": ["추천 규칙: 참고할 트렌드 자료 모으기", "추천 규칙: 상의·하의 어울림 기준 정하기", "추천 규칙: 계절·날씨 기준 정하기", "추천 규칙: 점수 계산 방식 정하기", "추천 규칙: 예시 10개로 손으로 검증"],
  "코디 추천 결과 화면 만들기": ["추천 화면: 추천 조건 입력", "추천 화면: 추천 코디 카드 표시", "추천 화면: 추천 이유 한 줄 표시", "추천 화면: 다시 추천·저장"],
  "추천 품질 점검과 개선": ["품질 점검: 추천 결과 20개 직접 평가", "품질 점검: 어색한 추천의 원인 찾기", "품질 점검: 규칙 고치고 다시 평가"],
  "배포와 사용 점검": ["배포 점검: 배포하고 주소 확인", "배포 점검: 새 창에서 처음부터 사용해 보기"],
  "자동화할 업무 흐름 설계": ["업무 흐름: 지금 업무 순서 그리기", "업무 흐름: 자동화할 구간 표시", "업무 흐름: 자동화한 뒤의 순서 설계"],
  "첫 자동화 도구 만들기": ["자동화 도구: 입력 항목 정하기", "자동화 도구: 화면 뼈대 만들기", "자동화 도구: 핵심 계산·변환 만들기", "자동화 도구: 결과 복사·내보내기", "자동화 도구: 입력 오류 처리", "자동화 도구: 예시 데이터로 시험", "자동화 도구: 담당자가 쓸 수 있게 정리"],
  "담당자 시범 적용과 피드백 받기": ["시범 적용: 담당자에게 써 보게 하기", "시범 적용: 피드백 정리"],
  "개선 반영과 효과 측정 (적용 전·후 소요 시간 비교)": ["효과 측정: 적용 전 소요 시간 확인", "효과 측정: 피드백 반영해 개선", "효과 측정: 적용 후 소요 시간 비교"],
  "결과 정리와 다음 단계 정하기": ["결과 정리: 줄어든 시간을 수치로 정리", "결과 정리: 다음 단계 정하기"],
  "추천 기능 개선·보완": ["추천 개선: 점검에서 나온 문제 목록", "추천 개선: 규칙 수정", "추천 개선: 화면 보완", "추천 개선: 다시 점검"],
  "사용 점검과 정리": ["마무리: 전체 사용 점검", "마무리: 정리와 최종 확인"],
};

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });
try {
  const [user] = await sql`select id from users where username = ${username}`;
  if (!user) { console.error(`아이디 '${username}' 가 없습니다.`); process.exit(1); }
  const open = await sql`select id, title, due_date::text as due, estimated_minutes as min from tasks where user_id = ${user.id} and deleted_at is null and status = 'todo' order by due_date, id`;
  const byTitle = new Map(open.map((t) => [t.title, t]));

  const plan = []; const missing = [];
  for (const [base, steps] of Object.entries(STEPS)) {
    const n = steps.length;
    // 조각 번호가 아니라 "날짜 순서"대로 단계 이름을 붙인다. (마감 안에 못 들어간 조각을 앞쪽 빈 시간에 끼워 넣은 적이 있어서
    // 번호 순서와 날짜 순서가 다를 수 있다. 날짜 순서대로 붙여야 '줄어든 시간 정리 → 다음 단계 정하기' 같은 흐름이 맞는다.)
    const found = [];
    for (let i = 1; i <= n; i++) {
      const old = `${base} (${i}/${n})`;
      const t = byTitle.get(old);
      if (t) found.push({ ...t, old }); else missing.push(old);
    }
    found.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.id - b.id));
    // 일부만 남았다면(끝낸 조각이 있을 때) 남은 조각이 앞 단계부터가 아니라 "마지막 단계들"에 해당하므로 뒤에서부터 맞춘다
    const offset = n - found.length;
    // 같은 할 일의 조각이 7일 넘게 떨어져 있으면(앞쪽 빈 날에 끼워 넣은 조각) 가장 늦은 조각이 있는 날로 모은다
    const last = found.length ? found[found.length - 1].due : null;
    const gap = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
    found.forEach((t, k) => plan.push({ id: t.id, old: t.old, name: steps[offset + k], due: t.due, newDue: last && gap(t.due, last) > 7 ? last : t.due, min: t.min }));
  }
  const names = plan.map((p) => p.name);
  const dupNames = names.filter((x, i) => names.indexOf(x) !== i);

  for (const p of plan) console.log(`${p.due.slice(5)}${p.newDue !== p.due ? ` → ${p.newDue.slice(5)} (날짜 이동)` : ""}  ${String(p.min).padStart(3)}분  ${p.old}\n              → ${p.name}`);
  console.log(`\n바꿀 할 일 ${plan.length}개 / 안 끝낸 할 일 ${open.length}개 (나머지는 원래 제목 그대로: 나누지 않은 것)`);
  if (missing.length) console.log(`⚠ 예상한 제목을 못 찾은 것 ${missing.length}개 (이미 바뀌었거나 끝냈을 수 있음):`, missing);
  if (dupNames.length) { console.error("⚠ 새 이름이 서로 겹침 → 중단:", dupNames); process.exit(1); }

  if (!apply) { console.log("\n미리보기입니다. 반영하려면 끝에 --yes 를 붙여 다시 실행하세요."); process.exit(0); }

  mkdirSync("D:/diary-backup", { recursive: true });
  const file = `D:/diary-backup/task-titles-before-rename-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(file, JSON.stringify(plan.map(({ id, old, due }) => ({ id, title: old, due_date: due })), null, 2));
  console.log(`\n원래 제목을 백업했습니다: ${file}`);
  await sql.begin(async (tx) => {
    for (const p of plan) await tx`update tasks set title = ${p.name}, due_date = ${p.newDue}, updated_at = now() where id = ${p.id} and user_id = ${user.id}`;
  });
  const [{ n }] = await sql`select count(*)::int n from tasks where user_id = ${user.id} and deleted_at is null and title ~ '\\(\\d+/\\d+\\)$'`;
  console.log(`반영 완료. 아직 "(1/7)" 형태로 남은 제목: ${n}개`);
} finally {
  await sql.end();
}
