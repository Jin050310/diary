# Plan-Do-See 다이어리 (과제 6)

계획(Plan) → 실행(Do) → 회고(See) 데이터를 서버 DB에서 연결하는 다이어리입니다.
**로그인이 없습니다.** 링크를 아는 사람은 누구나 볼 수 있으므로, 남이 봐도 괜찮은 내용만 넣습니다(모든 화면 위에 안내가 표시됩니다). 접근 제어는 7번 과제에서 적용합니다.

## 화면
| 메뉴 | 하는 일 |
|---|---|
| 달력 | 월간 달력에 계획 기간(막대)과 마감 할 일 수를 표시. 날짜를 누르면 그날 마감 할 일·진행 중인 계획 |
| 할 일 | 할 일 생성·수정·완료·완료 취소·삭제, 검색·필터·정렬(정렬 기준을 화면에 표시) |
| 실행 기록 | 시작·종료 시각, 실제 소요 시간, 막힘 사유를 할 일에 연결해 저장. 완료 기록 목록 |
| 회고 | 계획 수·완료 수·지연 수·막힘 수·예상/실제 시간·차이 집계. 숫자를 누르면 근거 기록으로 이동. 개선점 한 줄 → 다음 계획 |
| 내보내기 | 모든 데이터를 JSON 파일 하나로 내려받기 |
| 계획 상세 | 계획 수정 + 수정 전 값이 보존된 수정 이력 |

## 실행
```bash
npm install
cp .env.example .env.local   # DATABASE_URL 을 본인 값으로 (Supabase Transaction pooler, 포트 6543)
npm run db:migrate           # db/schema.sql 을 DB에 적용 (여러 번 실행해도 안전)
npm run dev                  # http://localhost:3000
```
`.env.local` 은 Git 에 올라가지 않습니다(`.gitignore`). 비밀번호·접속 문자열을 코드나 화면에 넣지 마세요.

## 데이터 규칙 (contracts/pds-schema-v2.json)
- 날짜(`YYYY-MM-DD`)는 시간대 변환 없이 그대로, 시각은 UTC 로 저장하고 화면은 한국 시간(Asia/Seoul)으로 표시
- 모든 시간 길이는 **분(minute)** 정수
- 계획 수정 → DB 트리거가 수정 전 값을 `plan_revisions` 에 보존 (이력은 수정 불가)
- 할 일 삭제 → 행은 남기고 `deleted_at` 표시만 (회고 근거 추적)
- 완료 → 멱등성 키 UNIQUE + "할 일당 유효한 완료 1건" 부분 UNIQUE (버튼 비활성화에 의존하지 않음)
- 개선점 한 건 → 다음 계획 하나에만 반영 (UNIQUE)

## 점검 스크립트
개발 서버를 켠 상태에서 실행합니다. 임시 데이터(`__test__`)를 만들었다가 끝나면 지웁니다.
```bash
npm run test:schema                    # 메모리 DB 로 스키마 규칙 (서버 불필요)
node scripts/test-contract.mjs         # 계약 파일 ↔ 실제 DB 일치
node scripts/test-tasks-api.mjs        # 할 일 CRUD·검색·필터·정렬·중복 완료 방지
node scripts/test-executions-api.mjs   # 실행 기록, 원래 계획 값 불변
node scripts/test-retro-api.mjs        # 회고 집계 정의·근거 일치·다음 계획
node scripts/test-security.mjs         # XSS, 비밀값 노출 (npm run build 후 실행하면 빌드 산출물도 검사)
node scripts/cleanup-test-data.mjs     # 테스트가 중간에 멈춰 남은 임시 데이터 정리
```

## 알려진 한계
- 로그인·권한이 없습니다(7번 과제).
- `postgres` 4.1.1 은 동시 쿼리 수가 연결 수 상한을 넘으면 멈추는 문제가 있어 `lib/db.ts` 에서 상한을 30 으로 둡니다.
