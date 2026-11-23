import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { hash, verify } from "@node-rs/argon2";
import { db } from "./db";

// ───── 인증 구현 (과제 7) ─────
// 비밀번호: 널리 쓰는 라이브러리 @node-rs/argon2 (argon2id, 솔트 자동 생성)에 맡긴다. 해시 알고리즘을 직접 만들지 않는다.
// 로그인 상태: "서버 세션". 브라우저 쿠키에는 무작위 토큰 원문(32바이트), DB(sessions)에는 그 토큰의 SHA-256 해시와 만료 시각만 저장한다.
//   → 로그아웃·비밀번호 변경은 DB 행을 지우는 것이라 이전 토큰이 즉시 무효가 되고, 서명용 비밀키가 따로 필요 없다.

export const SESSION_COOKIE = "pds_session";
export const SESSION_DAYS = 7; // 유효 기간: 로그인 시각으로부터 7일

export class Unauthorized extends Error {}
export type User = { id: number; username: string };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const hashPassword = (password: string) => hash(password);

// 아이디가 없을 때도 같은 시간만큼 해시 검증을 해서, 응답 시간으로 "없는 아이디"를 알아내기 어렵게 한다.
let dummy: Promise<string> | undefined;
const dummyHash = () => (dummy ??= hash("dummy-password-for-timing"));

// 아이디·비밀번호 확인. 아이디가 없는 경우와 비밀번호가 틀린 경우를 호출한 쪽이 구분할 수 없게 둘 다 null.
export async function verifyLogin(username: string, password: string): Promise<User | null> {
  const [u] = await db()<{ id: number; username: string; password_hash: string }[]>`
    select id, username, password_hash from users where username = ${username}`;
  const ok = await verify(u?.password_hash ?? (await dummyHash()), password).catch(() => false);
  return u && ok ? { id: u.id, username: u.username } : null;
}

// 새 세션을 만들고 쿠키로 내려준다. 쿠키에는 토큰 원문, DB 에는 해시만.
export async function startSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const [row] = await db()<{ expires_at: Date }[]>`
    insert into sessions (user_id, token_hash, expires_at)
    values (${userId}, ${sha256(token)}, now() + ${SESSION_DAYS + " days"}::interval)
    returning expires_at`;
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, // 브라우저 스크립트가 읽을 수 없음 (XSS 로 토큰이 새는 것을 막음)
    secure: process.env.NODE_ENV === "production", // 배포(https)에서는 https 로만 전송
    sameSite: "lax", // 다른 사이트에서 보낸 POST 에는 쿠키가 붙지 않음 (CSRF 방어)
    path: "/",
    expires: row.expires_at,
  });
}

// 현재 요청의 로그인 사용자. 쿠키가 없거나, DB 에 없거나, 만료됐으면 null.
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [u] = await db()<User[]>`
    select u.id, u.username
    from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${sha256(token)} and s.expires_at > now()`;
  return u ?? null;
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw new Unauthorized("로그인이 필요합니다.");
  return u;
}

// 로그아웃: 서버의 세션 행을 지운다. (브라우저 쿠키만 지우는 것이 아님)
export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db()`delete from sessions where token_hash = ${sha256(token)}`;
  jar.delete(SESSION_COOKIE);
}

// 비밀번호 변경 등: 그 사용자의 모든 세션을 한꺼번에 무효화
export async function endAllSessions(userId: number) {
  await db()`delete from sessions where user_id = ${userId}`;
}
