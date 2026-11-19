// 서버에서 모든 입력을 검증한다. (클라이언트 검증은 편의용일 뿐, 신뢰하지 않음)
export class BadRequest extends Error {}

type Obj = Record<string, unknown>;

export function asObject(v: unknown): Obj {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new BadRequest("요청 형식이 올바르지 않습니다.");
  return v as Obj;
}

export function str(o: Obj, key: string, label: string, max: number, opts: { optional?: boolean } = {}) {
  const v = o[key];
  if (v === undefined || v === null || v === "") {
    if (opts.optional) return null;
    throw new BadRequest(`${label}을(를) 입력하세요.`);
  }
  if (typeof v !== "string") throw new BadRequest(`${label} 형식이 올바르지 않습니다.`);
  const s = v.trim();
  if (!s && !opts.optional) throw new BadRequest(`${label}을(를) 입력하세요.`);
  if (s.length > max) throw new BadRequest(`${label}은(는) ${max}자 이하로 입력하세요.`);
  return s || null;
}

export function date(o: Obj, key: string, label: string): string;
export function date(o: Obj, key: string, label: string, opts: { optional: true }): string | null;
export function date(o: Obj, key: string, label: string, opts: { optional?: boolean } = {}): string | null {
  const v = o[key];
  if ((v === undefined || v === null || v === "") && opts.optional) return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v + "T00:00:00Z")))
    throw new BadRequest(`${label}은(는) YYYY-MM-DD 형식이어야 합니다.`);
  return v;
}

export function int(o: Obj, key: string, label: string, min: number, max: number) {
  const v = typeof o[key] === "string" ? Number(o[key]) : o[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max)
    throw new BadRequest(`${label}은(는) ${min}~${max} 사이의 정수여야 합니다.`);
  return v;
}

export function idParam(raw: string) {
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) throw new BadRequest("ID가 올바르지 않습니다.");
  return n;
}

export function planInput(body: unknown) {
  const o = asObject(body);
  const input = {
    title: str(o, "title", "계획 제목", 200)!,
    start_date: date(o, "start_date", "시작일"),
    end_date: date(o, "end_date", "종료일"),
    priority: int(o, "priority", "우선순위", 1, 3),
    success_criteria: str(o, "success_criteria", "성공 기준", 1000)!,
    estimated_minutes: int(o, "estimated_minutes", "예상 시간(분)", 0, 100000),
  };
  if (input.end_date < input.start_date) throw new BadRequest("종료일은 시작일보다 빠를 수 없습니다.");
  return input;
}

// 태그: 배열 또는 쉼표 문자열. 공백 제거·중복 제거, 최대 10개·각 20자
export function tagsOf(o: Obj, key = "tags"): string[] {
  const raw = o[key];
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : raw == null ? [] : null;
  if (!list) throw new BadRequest("태그 형식이 올바르지 않습니다.");
  const out: string[] = [];
  for (const t of list) {
    if (typeof t !== "string") throw new BadRequest("태그 형식이 올바르지 않습니다.");
    const s = t.trim();
    if (!s) continue;
    if (s.length > 20) throw new BadRequest("태그는 20자 이하로 입력하세요.");
    if (!out.includes(s)) out.push(s);
  }
  if (out.length > 10) throw new BadRequest("태그는 10개 이하로 입력하세요.");
  return out;
}

export function taskInput(body: unknown) {
  const o = asObject(body);
  return {
    plan_id: int(o, "plan_id", "계획", 1, Number.MAX_SAFE_INTEGER),
    title: str(o, "title", "할 일 제목", 200)!,
    due_date: date(o, "due_date", "마감일", { optional: true }),
    priority: int(o, "priority", "우선순위", 1, 3),
    tags: tagsOf(o),
    estimated_minutes: int(o, "estimated_minutes", "예상 시간(분)", 0, 100000),
  };
}

// 시각은 시간대가 붙은 ISO 형식(예: 2026-11-19T14:30:00+09:00)만 받는다. 저장은 UTC(timestamptz), 화면 표시는 Asia/Seoul.
const ISO_WITH_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
function instant(o: Obj, key: string, label: string) {
  const v = o[key];
  if (typeof v !== "string" || !ISO_WITH_TZ.test(v) || isNaN(Date.parse(v)))
    throw new BadRequest(`${label}은(는) 시간대가 포함된 날짜·시각 형식이어야 합니다.`);
  return new Date(v);
}

// 실행 기록: 계획·할 일 값과 별개로 "실제로 한 것"만 담는다.
export function executionInput(body: unknown) {
  const o = asObject(body);
  const started = instant(o, "started_at", "시작 시각");
  const ended = instant(o, "ended_at", "종료 시각");
  if (ended < started) throw new BadRequest("종료 시각은 시작 시각보다 빠를 수 없습니다.");
  const given = o.actual_minutes;
  const actual =
    given === undefined || given === null || given === ""
      ? Math.round((ended.getTime() - started.getTime()) / 60000) // 안 적으면 시작~종료 차이로 계산
      : int(o, "actual_minutes", "실제 소요 시간(분)", 0, 100000);
  if (actual > 100000) throw new BadRequest("실제 소요 시간(분)은 0~100000 사이여야 합니다.");
  return {
    task_id: int(o, "task_id", "할 일", 1, Number.MAX_SAFE_INTEGER),
    started_at: started.toISOString(),
    ended_at: ended.toISOString(),
    actual_minutes: actual,
    blocker: str(o, "blocker", "막힘 사유", 1000, { optional: true }),
  };
}
