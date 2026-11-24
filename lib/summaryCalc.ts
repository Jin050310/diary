// 5일 사용 요약 계산 (순수 함수: DB·화면과 분리해서, 정해 둔 예제를 손으로 계산한 값과 그대로 비교해 검증한다)
//
// 1일차에 고정한 것 (SUBMISSION-7.md 와 같은 내용)
//  - 답하려는 질문: "내 큰 프로젝트가 계획한 만큼 실제로 진행되고 있는가?"
//  - 관찰 지표: 하루 실제 작업 시간 합계 · 단위: 분(정수) · 날짜는 Asia/Seoul 기준
// 계산 규칙
//  - 결측값: 기록이 없는 날은 0분으로 계산하고 "기록 없음"으로 표시한다. 평균의 날 수에도 포함한다.
//  - 중복값: 같은 할 일·같은 시작 시각의 기록은 1건으로 센다. (먼저 저장된 것만)
//  - 이상값: 하루 합계가 960분(16시간)을 넘으면 입력 오류로 보고 합계·평균에서 제외하고 "이상값"으로 표시한다. (평균의 날 수에서도 뺀다)
//  - 반올림: 하루 평균은 소수점 첫째 자리에서 반올림해 정수 분으로 한다. (합계는 정수라 반올림 없음)
//  - 주 시작 요일: 월요일
//  - 아직 안 지난 날(오늘 이후)은 계산에서 뺀다. 평균은 "오늘까지 지난 날" 기준이다.
//  - 규칙 변경 전·후: 변경 시각(서버가 찍음)의 한국 날짜보다 앞선 날은 '변경 전', 뒤의 날은 '변경 후'.
//    변경한 날 자체는 그날 첫 기록이 변경 시각보다 먼저 저장됐으면 '변경 전', 아니면(기록이 없는 날 포함) '변경 후'.

export const OUTLIER_MINUTES = 960;
export const WEEK_STARTS_ON = "월요일";

export type SExec = { id: number; task_id: number; started_at: string; actual_minutes: number; created_at: string };
export type SChange = { id: number; changed_at: string; rule_name: string; old_value: string; new_value: string; reason: string };
export type DayStatus = "ok" | "missing" | "outlier" | "future";
// 규칙 변경이 "어느 기록 사이"에 놓였는지 가리키는 근거 (저장 시각 기준, 서버가 찍은 값으로만 계산)
export type RecordRef = { id: number; day_no: number; date: string; saved_at: string };
export type ChangeEvidence = SChange & {
  before_last: RecordRef | null; // 변경 직전에 저장된 마지막 기록
  after_first: RecordRef | null; // 변경 직후 처음 저장된 기록
  order_ok: boolean;             // 2일차 기록 뒤 · 3일차 기록 앞 (T07-C09·C12)
};
export type DayRow = {
  day_no: number; record_ids: number[]; date: string; minutes: number; raw_minutes: number; count: number; duplicates: number;
  status: DayStatus; period: "before" | "after" | null;
};
export type PeriodStat = { days: number; total: number; average: number | null };
export type Summary = {
  start: string; end: string; today: string; day_count: number;
  days: DayRow[]; counted_days: number; total: number; average: number | null;
  changes: ChangeEvidence[];
  comparison: null | { change_id: number; before: PeriodStat; after: PeriodStat; diff: number | null };
};

const KST = 9 * 3600000;
export const kstDate = (iso: string) => new Date(Date.parse(iso) + KST).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const stat = (rows: DayRow[]): PeriodStat => {
  const total = rows.reduce((s, r) => s + r.minutes, 0);
  return { days: rows.length, total, average: rows.length ? Math.round(total / rows.length) : null };
};

export function buildSummary(execs: SExec[], changes: SChange[], start: string, dayCount: number, today: string): Summary {
  // 중복 제거: 같은 할 일·같은 시작 시각은 먼저 저장된 1건만
  const seen = new Set<string>();
  const dupByDay = new Map<string, number>();
  const kept: SExec[] = [];
  for (const e of [...execs].sort((a, b) => a.id - b.id)) {
    const key = `${e.task_id}|${Date.parse(e.started_at)}`;
    if (seen.has(key)) { const d = kstDate(e.started_at); dupByDay.set(d, (dupByDay.get(d) ?? 0) + 1); continue; }
    seen.add(key);
    kept.push(e);
  }

  const sortedChanges = [...changes].sort((a, b) => Date.parse(a.changed_at) - Date.parse(b.changed_at) || a.id - b.id);
  const first = sortedChanges[0] ?? null;

  const days: DayRow[] = [];
  for (let i = 0; i < dayCount; i++) {
    const date = addDays(start, i);
    const recs = kept.filter((e) => kstDate(e.started_at) === date);
    const raw = recs.reduce((s, e) => s + e.actual_minutes, 0);
    const status: DayStatus = date > today ? "future" : recs.length === 0 ? "missing" : raw > OUTLIER_MINUTES ? "outlier" : "ok";
    let period: DayRow["period"] = null;
    if (first && status !== "future") {
      const cd = kstDate(first.changed_at);
      if (date < cd) period = "before";
      else if (date > cd) period = "after";
      else {
        const firstSaved = recs.length ? Math.min(...recs.map((e) => Date.parse(e.created_at))) : Infinity;
        period = firstSaved < Date.parse(first.changed_at) ? "before" : "after";
      }
    }
    days.push({ day_no: i + 1, record_ids: recs.map((e) => e.id), date, minutes: status === "ok" ? raw : 0, raw_minutes: raw, count: recs.length, duplicates: dupByDay.get(date) ?? 0, status, period });
  }

  // 규칙 변경의 근거: 저장 시각이 변경 시각보다 앞선 마지막 기록 / 뒤인 첫 기록. 변경은 2일차 기록 뒤, 3일차 기록 앞이어야 한다.
  const dayNo = (date: string) => Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86400000) + 1;
  const refs: RecordRef[] = kept
    .map((e) => ({ id: e.id, day_no: dayNo(kstDate(e.started_at)), date: kstDate(e.started_at), saved_at: e.created_at }))
    .sort((a, b) => Date.parse(a.saved_at) - Date.parse(b.saved_at) || a.id - b.id);
  const evidence: ChangeEvidence[] = sortedChanges.map((ch) => {
    const t = Date.parse(ch.changed_at);
    const before = refs.filter((r) => Date.parse(r.saved_at) < t);
    const after = refs.filter((r) => Date.parse(r.saved_at) >= t);
    const before_last = before.length ? before[before.length - 1] : null;
    const after_first = after.length ? after[0] : null;
    return { ...ch, before_last, after_first, order_ok: !!before_last && before_last.day_no === 2 && (!after_first || after_first.day_no >= 3) };
  });

  const counted = days.filter((d) => d.status === "ok" || d.status === "missing");
  const total = counted.reduce((s, d) => s + d.minutes, 0);
  return {
    start, end: addDays(start, dayCount - 1), today, day_count: dayCount,
    days, counted_days: counted.length, total, average: counted.length ? Math.round(total / counted.length) : null,
    changes: evidence,
    comparison: first ? (() => {
      const before = stat(counted.filter((d) => d.period === "before"));
      const after = stat(counted.filter((d) => d.period === "after"));
      return { change_id: first.id, before, after, diff: before.average !== null && after.average !== null ? after.average - before.average : null };
    })() : null,
  };
}
