# 인증 구현 설명서 (과제 7 · Plan-Do-See 다이어리 2)

6번 다이어리에 회원 가입·로그인·로그아웃, 세션 관리, 사용자별 접근 제어를 붙였습니다. 모든 증거는 `node scripts/test-auth.mjs`(전체 출력: `docs/evidence/test-auth-output.txt`)가 **실제 서버에 요청을 보내고 받은 응답**을 그대로 출력한 것입니다(비밀번호는 출력하지 않고, 토큰·해시는 앞 6글자만 보여 주고 `...생략` 으로 가림). 계정 이름 `__t7_…` 은 점검 때 만들었다가 지우는 임시 계정입니다.

- 결과물: https://diary-amber-mu.vercel.app (첫 화면은 로그인 화면) · 소스: https://github.com/Jin050310/diary
- 인증 라이브러리: **`@node-rs/argon2` 2.2.2** (비밀번호 해시). 세션은 라이브러리 없이 직접 구현(아래 ②). 그 외 인증 서비스·인증 라이브러리는 쓰지 않았습니다.

---

## ① 무엇으로 붙였나

| 역할 | 선택 | 위치 |
|---|---|---|
| 비밀번호 해시 | `@node-rs/argon2` 2.2.2 — **argon2id**, 솔트는 라이브러리가 자동 생성 (직접 만든 해시 알고리즘 없음) | `lib/auth.ts:20` `hashPassword`, `lib/auth.ts:27` `verifyLogin` |
| 로그인 상태 | **서버 세션**: 쿠키 `pds_session` 에는 무작위 토큰 32바이트, DB `sessions` 에는 그 토큰의 **SHA-256 해시**와 만료 시각만 저장 | `lib/auth.ts:35` `startSession`, `lib/auth.ts:51` `currentUser`, `db/schema.sql:149` |
| 쿠키 속성 | `HttpOnly`(스크립트가 못 읽음), `SameSite=Lax`, 배포(https)에서는 `Secure`, 만료 7일 | `lib/auth.ts:35~48` |
| 로그인 확인 | 모든 데이터 API 는 `handle()` 한 곳에서 로그인 확인 후 사용자 정보를 넘겨받음 | `lib/http.ts:8` |
| 자료 주인 | `plans·tasks·executions·completions·retro_notes` 에 `user_id` 칸, 모든 쿼리에 `user_id = 로그인한 사용자` 조건 | `db/schema.sql:160~164`, `app/api/**/route.ts` |
| 화면 접근 | 세션 쿠키가 없으면 로그인 화면으로 이동 (1차 문지기) | `proxy.ts:26` |
| 쓰기 요청 방어 | 다른 사이트에서 온 POST·PATCH·DELETE 는 403 | `proxy.ts:20` |

가입 `POST /api/auth/signup`, 로그인 `POST /api/auth/login`, 로그아웃 `POST /api/auth/logout`, 내 정보 `GET /api/auth/me`, 비밀번호 변경 `POST /api/auth/password` (`app/api/auth/*/route.ts`). 화면은 `app/login/`, `app/account/`, 상단 메뉴 `app/TopBar.tsx`.

## ② 왜 그걸 골랐나

- **argon2id (비밀번호 해시):** 비밀번호 전용 해시 중 현재 가장 권장되는 방식(메모리를 많이 써서 GPU 대량 대입이 어렵다)이고, 솔트를 라이브러리가 자동으로 만들어 줘서 "계정마다 저장값이 다르게" 되는 것을 내가 직접 챙길 필요가 없다. `@node-rs/argon2` 는 Vercel 에서 컴파일 없이 미리 만들어진 바이너리로 동작해 배포가 안전하다. 해시를 직접 만들면 틀리기 쉬워서 **널리 쓰는 라이브러리에 맡겼다.**
- **직접 구현한 서버 세션 (선택한 방식):** 로그아웃·비밀번호 변경이 "서버의 DB 행을 지우는 일"이라 이전 토큰이 **즉시** 무효가 되고, 서명용 비밀키가 따로 필요 없어서 "비밀키가 코드·Git 에 없다"는 조건이 단순하게 지켜진다.
- **함께 검토했지만 고르지 않은 방법 — JWT(서명된 토큰) 를 쿠키에 담는 방식:** DB 조회 없이 빠르지만, 한 번 발급한 토큰은 만료 전까지 서버가 되돌릴 수 없어서(로그아웃·비밀번호 변경 뒤에도 통한다) 이 과제의 핵심 요구("로그아웃 뒤 같은 토큰으로 요청하면 거절")를 막으려면 결국 서버에 블랙리스트를 따로 저장해야 한다. 그러면 세션 테이블과 다를 게 없어서, 처음부터 세션 테이블을 쓰는 쪽이 더 단순하고 안전했다. Auth.js 같은 인증 서비스도 후보였지만, 가입·세션·소유자 확인이 어디서 이루어지는지 소스 위치로 설명해야 하는 과제라서 직접 구현해 위치를 분명히 했다.

## ③ 어디를 어떻게 고쳤나

가입·로그인·로그아웃·자료 조회가 지나는 소스 위치입니다.

1. **가입** `app/api/auth/signup/route.ts:7` → 입력 검사 `lib/validate.ts` `credentialsInput` → `lib/auth.ts:20` 해시 → `users` INSERT(`username` UNIQUE, `db/schema.sql:140`) → 중복이면 409(`signup/route.ts:18`) → `lib/auth.ts:35` 세션 발급·쿠키.
2. **로그인** `app/api/auth/login/route.ts:6` → `lib/auth.ts:27` 해시 대조(없는 아이디도 같은 시간만큼 대조) → 실패는 한 가지 문구로 401(`login/route.ts:10`) → 옛 세션 삭제 후 새 세션 발급.
3. **로그아웃** `app/api/auth/logout/route.ts:5` → `lib/auth.ts:68` `endSession`: `sessions` 행 삭제 + 쿠키 만료.
4. **자료 조회** 화면(`app/*/…View.tsx`) → `lib/format.ts` `api()` → `proxy.ts`(쿠키 없으면 로그인 화면) → `app/api/…/route.ts` → `lib/http.ts:8` `handle()` → `lib/auth.ts:51` `currentUser`(쿠키 토큰 → SHA-256 → `sessions` 조회, 만료 전만 인정) → 쿼리에 `user_id = ${user.id}` 조건.
5. **남의 자료 거절:** `where id = ${id} and user_id = ${user.id}` 로 조회·수정·삭제가 **한 문장**에서 소유자까지 같이 확인되고(확인 후 쓰기가 아니라 확인과 쓰기가 한 쿼리), 행이 없으면 `NotFound`→**404**. 남의 계획·할 일을 참조하는 쓰기도 먼저 주인을 확인해 404 (`tasks/route.ts:64`, `executions/route.ts:33`, `retro-notes/route.ts:27`, `retro-notes/[id]/next-plan/route.ts:13`). 목록 쿼리의 소유자 조건: `plans/route.ts:14`, `tasks/route.ts:45`, `executions/route.ts:19`, `completions/route.ts:13`, `retro-notes/route.ts:14`, `retro/route.ts:40·51`, `direction/route.ts:16·47`, 내보내기 `export/route.ts:13~20`.
6. **6번 자료 이관:** `scripts/claim-data.mjs` 가 주인 없던 행을 내 계정으로 옮기고 `user_id` 를 NOT NULL 로 바꾼다.
7. **고친 6번 화면:** "로그인이 없어 누구나 볼 수 있다"는 안내(`app/layout.tsx`)를 없애고, 메뉴에 계정 이름·로그아웃(`app/TopBar.tsx`)을 넣었다. API 가 401 을 주면 화면이 로그인으로 보낸다(`lib/format.ts:30`).

## ④ 안 열리는 것을 확인한 기록

`node scripts/test-auth.mjs` 의 **실제 출력**입니다(통과 93 / 실패 0, 개발 서버와 정식 빌드 `npm run start` 양쪽에서 실행). 전체 출력은 [`docs/evidence/test-auth-output.txt`](docs/evidence/test-auth-output.txt). 같은 항목에서 **성공한 요청**과 **거절된 요청**을 나란히 적습니다. (이 실행에서 A 계정 id 33, B 계정 id 34 / A 의 계획 9·할 일 42, B 의 계획 10·할 일 43)

**1) 로그인 없이 자료 요청 — 거절**
```
성공   POST /api/auth/login (맞는 아이디·비밀번호)  → 200, 쿠키 pds_session=xH4y8L...생략
성공   GET  /api/auth/me   (로그인 상태)            → 200 {"user":{"id":33,"username":"__t7_a_f78267"}}
거절   GET  /api/tasks        (쿠키 없음)           → 401 {"error":"로그인이 필요합니다."}
거절   GET  /api/plans        (쿠키 없음)           → 401 {"error":"로그인이 필요합니다."}
거절   GET  /api/tasks/42     (쿠키 없음)           → 401 {"error":"로그인이 필요합니다."}
거절   GET  /api/export       (쿠키 없음)           → 401 {"error":"로그인이 필요합니다."}
거절   POST /api/tasks        (쿠키 없음)           → 401 {"error":"로그인이 필요합니다."}
거절   DELETE /api/tasks/42   (쿠키 없음)           → 401 {"error":"로그인이 필요합니다."}
거절   GET /, /tasks, /records, /direction, /retro, /account (화면, 쿠키 없음) → 307 → /login
```

**2) 다른 계정 자료 읽기 — 거절 (A 로 로그인, 반대 방향 B→A 도 같은 결과)**
```
성공   GET /api/tasks/42 (A 가 자기 할 일)            → 200 A계정 할 일
거절   GET /api/tasks/43 (A 가 B 의 할 일)            → 404 {"error":"할 일을 찾을 수 없습니다."}
성공   GET /api/plans/9  (A 가 자기 계획)             → 200 A계정 계획
거절   GET /api/plans/10 (A 가 B 의 계획)             → 404 {"error":"계획을 찾을 수 없습니다."}
성공   GET /api/direction?plan=9  (자기 계획)         → 200 A계정 계획
거절   GET /api/direction?plan=10 (B 의 계획)         → 404 {"error":"계획을 찾을 수 없습니다."}
반대   B 로 로그인해 GET /api/tasks/42 (A 의 할 일)   → 404 {"error":"할 일을 찾을 수 없습니다."}
반대   B 로 로그인해 GET /api/plans/9  (A 의 계획)    → 404 {"error":"계획을 찾을 수 없습니다."}
```
목록 응답: A 로 `/api/plans·tasks·executions·completions·retro-notes·retro·export·direction` 을 호출했을 때 B 의 제목·`user_id` 가 하나도 없고(8개 모두 통과), B 의 계획·할 일로 거른 회고·실행 기록 목록은 빈 목록이다.

**3) 다른 계정 자료 수정·삭제 — 거절 (양방향)**
```
성공   PATCH /api/tasks/42 (A 가 자기 할 일 수정)       → 200 A계정 할 일
거절   PATCH /api/tasks/43 (A 가 B 의 할 일 수정)       → 404 {"error":"할 일을 찾을 수 없습니다."}
거절   PATCH /api/plans/10 (A 가 B 의 계획 수정)        → 404 {"error":"계획을 찾을 수 없습니다."}
거절   DELETE /api/tasks/43 (A 가 B 의 할 일 삭제)      → 404 {"error":"할 일을 찾을 수 없습니다."}
거절   POST /api/tasks/43/complete                     → 404 {"error":"할 일을 찾을 수 없습니다."}
거절   DELETE /api/tasks/43/complete                   → 404 {"error":"할 일을 찾을 수 없습니다."}
거절   POST /api/executions  (B 의 할 일에 기록 추가)   → 404 {"error":"할 일을 찾을 수 없습니다."}
거절   POST /api/tasks       (B 의 계획에 할 일 추가)   → 404 {"error":"계획을 찾을 수 없습니다."}
거절   POST /api/retro-notes (B 의 계획에 회고 추가)    → 404 {"error":"계획을 찾을 수 없습니다."}
거절   POST /api/retro-notes/3/next-plan (B 의 개선점) → 404 {"error":"개선점을 찾을 수 없습니다."}
반대   B 로 로그인해 A 의 자료에 같은 12가지 요청         → 모두 404 (PATCH /api/tasks/42, DELETE /api/tasks/42 …)
```
거절 앞뒤 건수: A·B 모두 `{"plans":1,"tasks":1,"executions":1,"completions":1,"retro_notes":1,"revisions":0}` 로 **그대로**이고, 양방향 시도가 끝난 뒤에도 반대편에 새로 생긴 자료가 없다.

**4) 로그아웃 뒤 옛 토큰 — 거절 (같은 주소·같은 방식, 달라진 것은 로그아웃 여부뿐)**
```
성공   GET /api/auth/me (쿠키 xH4y8L...생략)       → 200 {"user":{"id":33,"username":"__t7_a_f78267"}}
   ↓ POST /api/auth/logout
거절   GET /api/auth/me (같은 쿠키 값)             → 401 {"error":"로그인이 필요합니다."}
```
DB 확인: 로그아웃 뒤 `sessions` 에서 그 토큰 해시 행이 **삭제됨**(브라우저 쿠키만 지운 것이 아님). 만료 시각을 과거로 돌린 세션도 `GET /api/auth/me → 401`. 비밀번호를 바꾸면 변경 전에 발급된 다른 기기의 토큰(`-eFNyv...생략`)도 `GET /api/auth/me → 401`, 변경한 기기에는 새 세션이 발급되어 계속 쓸 수 있고, 옛 비밀번호로는 로그인이 안 된다.

**5) 주소·헤더·본문에 다른 계정을 적어 보낸 요청 — 소용없음 (A 로 로그인)**
```
GET  /api/plans?user_id=34&owner=__t7_b_… + 헤더 X-User-Id: 34 → 200 ["A계정 계획"]   (A 의 계획만 돌아옴)
POST /api/plans {"user_id":34, …} + 헤더 X-User-Id: 34         → 201 {"id":11,"user_id":33}  (주인은 로그인한 A, B 에게는 생기지 않음)
POST /api/plans (헤더 Origin: https://evil.example)            → 403 {"error":"허용되지 않은 요청입니다."}
```

**가입·로그인 안내 문구 (카드 1)**
```
거절   POST /api/auth/signup (이미 있는 아이디)            → 409 {"error":"이미 사용 중인 아이디입니다."}
거절   POST /api/auth/login (아이디는 맞고 비밀번호 틀림)   → 401 {"error":"아이디 또는 비밀번호가 올바르지 않습니다."}
거절   POST /api/auth/login (아이디 자체가 없음)            → 401 {"error":"아이디 또는 비밀번호가 올바르지 않습니다."}   ← 위와 똑같음
```

**비밀번호 저장과 세션 값 (카드 2·3)** — 같은 비밀번호로 가입한 두 계정의 DB 저장값:
```
A: $argon2id$v=19$m=19456,t=2,p=1$kv53Ogurdwtx78/vxhMVBw$9x1ege...생략
B: $argon2id$v=19$m=19456,t=2,p=1$VpS2Cp/83i3x2kKNdHQ9Vw$ph/vU6...생략
```
솔트가 달라 저장값이 서로 다르고, `users`·`sessions` 어느 열에도 입력한 비밀번호가 그대로 있지 않다. 로그인 응답의 쿠키: `pds_session=xH4y8L...생략; Path=/; Expires=Mon, 30 Nov 2026 00:44:50 GMT; HttpOnly; SameSite=lax` (유효 7일, DB `expires_at − created_at` = 7.00일). DB 에는 토큰 원문이 아니라 해시(`ef06dd...생략`)만 있고, 토큰은 URL 이 아니라 쿠키로만 오간다. 서버 로그(정식 빌드 서버 로그 10줄)에서 점검 중 쓴 비밀번호·토큰 12개의 원문이 한 줄도 나오지 않았다.

비밀키: 서명용 비밀키가 없다(세션 방식). DB 접속 문자열은 `.env.local`(Git 제외)에만 있고, `node scripts/test-security.mjs` 가 소스·빌드 산출물 623개 파일에 접속 문자열·비밀번호가 없음을 확인한다.

## ⑤ AI와 나

> 아래 세 줄은 초안입니다. **본인이 실제로 한 일에 맞게 직접 확인·수정하세요.** 특히 "내가 판단한 일"과 "따르지 않은 일"은 본인만 압니다.

- **AI에게 맡긴 일:** 인증 구조 설계(서버 세션, 비밀번호 해시 선택), `users`·`sessions`·`user_id` DB 변경, 가입·로그인·로그아웃·비밀번호 변경 API, 모든 데이터 API 의 로그인·소유자 확인, 로그인·계정 화면, 접근 차단·쓰기 요청 방어, 인증·접근 제어 점검 스크립트와 기존 점검 스크립트의 로그인 대응, 화면 개편(밝은 테마·날짜별 묶음·요약 카드), 남은 할 일을 조각으로 나누고 날짜를 배정한 일정(제안), 이 설명서의 초안.
- **내가 판단한 일:** [본인 확인 필요 — 예: 6번 다이어리를 이어서 쓰기로 한 것, 직접 세션 방식과 argon2 라이브러리 설계를 승인한 것, 내 계정을 직접 가입해 6번 자료를 내 계정으로 옮기기로 한 것, 5일 동안 쓸 질문·지표·계획 규칙을 정한 것]
- **AI 제안을 따르지 않은 일:** [본인 확인 필요 — 따르지 않은 제안이 없었다면 "없음 — AI 의 제안(직접 세션 + argon2, 소유자 404 처리)이 과제 요구와 내 판단에 맞아 그대로 따랐고, 대신 이 설명서와 점검 결과를 직접 읽어 확인했다" 처럼 이유를 적으세요]

## ⑥ 아직 못 막은 것

위험이 큰 순서로, 막지 못한 이유와 함께 적습니다.

1. **무차별 대입(brute force) 로그인 시도를 막지 않았다.** 로그인 실패 횟수 제한·잠금·지연이 없어서, 공격자가 한 계정에 비밀번호를 계속 시도할 수 있다. 비밀번호는 8자 이상만 검사해서 약한 비밀번호도 가입된다. (대응 방향: IP·계정별 실패 횟수 제한, 일정 횟수 후 지연)
2. **가입 응답으로 아이디 존재 여부를 알아낼 수 있다.** 로그인은 "아이디 또는 비밀번호"로 같은 응답을 주지만, 가입은 "이미 사용 중인 아이디입니다"(409)를 주므로 어떤 아이디가 있는지 확인할 수 있다.
3. **비밀번호 분실 복구·이메일 인증이 없다.** 비밀번호를 잊으면 복구할 방법이 없고(DB 에서 직접 처리해야 함), 가입 시 본인 확인도 없다.
4. **CSRF 전용 토큰이 없다.** `SameSite=Lax` 쿠키와 `Origin` 검사(`proxy.ts`)로 막지만, 별도의 CSRF 토큰은 두지 않았다. `Origin` 헤더를 아예 보내지 않는 쓰기 요청은 쿠키 속성에만 기댄다.
5. **세션 관리가 거칠다.** 유효 기간 7일 고정(활동해도 연장 안 됨), "다른 기기 목록·개별 로그아웃" 화면이 없고(비밀번호 변경 시 전체 무효화만 가능), 만료된 `sessions` 행을 지우는 정리 작업이 없어 계속 쌓인다.
6. **앱 밖에서의 접근은 막지 못한다.** 접근 제어는 앱 코드의 `user_id` 조건이다. DB 접속 정보를 가진 사람(나 자신, 호스팅 관리자)은 모든 계정의 자료를 볼 수 있고, DB 에서 행 단위 보안(RLS 정책)으로 한 번 더 막는 것은 하지 않았다(RLS 는 켜 두었지만 서버 접속 계정은 우회한다).
7. **배포 환경의 로그는 확인하지 못했다.** 내 컴퓨터의 서버 로그에서 비밀번호·토큰이 없음을 확인했지만, Vercel 쪽 로그·모니터링에 남는 값은 점검하지 않았다. 또한 점검은 개발 DB 에 직접 임시 계정을 만들어 실행한다.
8. **역할·관리자 개념이 없다.** 모든 계정이 같은 권한이고, 계정 삭제(탈퇴) 기능도 없다.
