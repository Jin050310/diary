// 표시 규칙: 시간 단위는 "분", 시각은 Asia/Seoul 로 표시
export const PRIORITY: Record<number, string> = { 1: "높음", 2: "중간", 3: "낮음" };

export function minutes(n: number | null | undefined) {
  if (n == null) return "-";
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  const h = Math.floor(a / 60), m = a % 60;
  return `${sign}${a}분` + (h ? ` (${h}시간${m ? ` ${m}분` : ""})` : "");
}

const kst = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});
export function dateTime(iso: string | null | undefined) {
  return iso ? kst.format(new Date(iso)) : "-";
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `요청 실패 (${res.status})`);
  return data as T;
}

// 오늘 날짜(YYYY-MM-DD)는 한국 시간 기준
export const kstToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
export const noopSubscribe = () => () => {};

// ───── 사람이 읽기 쉬운 표기 (화면 공통) ─────
export const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];
export const weekdayKo = (iso: string) => WEEKDAY_KO[new Date(iso + "T00:00:00Z").getUTCDay()];
const dayNum = (iso: string) => Math.round(Date.parse(iso + "T00:00:00Z") / 86400000);
export const daysBetween = (from: string, to: string) => dayNum(to) - dayNum(from);
export const addDaysIso = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
export const mdKo = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8))}(${weekdayKo(iso)})`;

// 짧은 시간 표기: 45분 · 2시간 · 1시간 30분
export function shortMin(n: number | null | undefined) {
  if (n == null) return "-";
  const a = Math.abs(n), h = Math.floor(a / 60), m = a % 60;
  const body = h ? (m ? `${h}시간 ${m}분` : `${h}시간`) : `${a}분`;
  return n < 0 ? `-${body}` : body;
}

// 마감일: 오늘 · 내일 · 3일 지남 · 11/22(일).  지남(late)은 아직 안 끝낸 할 일에만 쓴다.
export function dueLabel(due: string | null, today: string | null, open = true): { text: string; tone: "late" | "soon" | "normal" | "none" } {
  if (!due) return { text: "마감 없음", tone: "none" };
  if (!today) return { text: mdKo(due), tone: "normal" };
  const d = daysBetween(today, due);
  if (d < 0) return open ? { text: `${-d}일 지남 · ${mdKo(due)}`, tone: "late" } : { text: mdKo(due), tone: "normal" };
  if (d === 0) return { text: "오늘", tone: "soon" };
  if (d === 1) return { text: "내일", tone: "soon" };
  return { text: mdKo(due), tone: "normal" };
}
