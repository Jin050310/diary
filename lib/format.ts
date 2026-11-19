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
