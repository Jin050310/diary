// 사용법: node scripts/test-summary-calc.mjs   (서버·DB 불필요, Node 22.18+ 는 .ts 를 바로 불러옴)
// 5일 요약 계산을 "손으로 계산한 값"과 그대로 비교한다. (T07-C132: 화면의 합계·평균 = 손으로 더한 값)
import { buildSummary } from "../lib/summaryCalc.ts";

let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); if (!ok) fail++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 손으로 계산한 예제 (시작 11/23, 5일, 오늘 11/26) ──
//  11/23: 60분(할 일1 10:00) + 같은 할 일1·같은 시각 중복 60분(→ 무시) + 30분(할 일2 20:00)  → 90분, 중복 1건
//  11/24: 100분(할 일3)                                                                      → 100분
//  11/25: 기록 없음                                                                           → 결측 0분
//  11/26: 500분 + 500분 = 1000분 (> 960)                                                      → 이상값, 합계·평균에서 제외
//  11/27: 아직 안 지난 날                                                                     → 계산 제외
//  지난 날 중 이상값 아닌 날 = 11/23, 11/24, 11/25 (3일), 합계 90+100+0 = 190, 평균 190/3 = 63.33 → 반올림 63
const execs = [
  { id: 1, task_id: 1, started_at: "2026-11-23T10:00:00+09:00", actual_minutes: 60, created_at: "2026-11-23T02:00:00Z" },
  { id: 2, task_id: 1, started_at: "2026-11-23T10:00:00+09:00", actual_minutes: 60, created_at: "2026-11-23T02:05:00Z" },
  { id: 3, task_id: 2, started_at: "2026-11-23T20:00:00+09:00", actual_minutes: 30, created_at: "2026-11-23T11:30:00Z" },
  { id: 4, task_id: 3, started_at: "2026-11-24T10:00:00+09:00", actual_minutes: 100, created_at: "2026-11-24T01:00:00Z" },
  { id: 5, task_id: 4, started_at: "2026-11-26T09:00:00+09:00", actual_minutes: 500, created_at: "2026-11-26T00:00:00Z" },
  { id: 6, task_id: 5, started_at: "2026-11-26T12:00:00+09:00", actual_minutes: 500, created_at: "2026-11-26T03:00:00Z" },
];
const s0 = buildSummary(execs, [], "2026-11-23", 5, "2026-11-26");
check(eq(s0.days.map((d) => d.status), ["ok", "ok", "missing", "outlier", "future"]), "날짜별 상태: 정상·정상·기록 없음·이상값·아직 안 지남");
check(eq(s0.days.map((d) => d.minutes), [90, 100, 0, 0, 0]), "날짜별 분 = [90, 100, 0, 0(이상값 제외), 0]");
check(s0.days[0].count === 2 && s0.days[0].duplicates === 1, "11/23: 2건으로 세고 중복 1건은 무시");
check(s0.days[3].raw_minutes === 1000, "이상값 날의 원래 합계 1000분은 따로 보존");
check(s0.counted_days === 3 && s0.total === 190, "합계 190분, 계산에 쓴 날 3일 (이상값·미래 제외)");
check(s0.average === 63, "하루 평균 = 190 ÷ 3 = 63.33 → 반올림 63분");
check(s0.comparison === null, "규칙 변경 기록이 없으면 전후 비교 없음");

// ── 규칙 변경: 11/24 23:00(한국) = 2026-11-24T14:00:00Z. 11/24 의 첫 기록(01:00Z)이 변경보다 먼저 → 11/24 는 '변경 전'
//  변경 전 = 11/23(90), 11/24(100) → 합계 190, 평균 95 / 변경 후 = 11/25(결측 0) → 합계 0, 평균 0 / 차이 = 0 − 95 = −95
const chg = [{ id: 1, changed_at: "2026-11-24T14:00:00Z", rule_name: "하루 목표 작업 시간", old_value: "60분", new_value: "90분", reason: "더 오래 집중하기 위해" }];
const s1 = buildSummary(execs, chg, "2026-11-23", 5, "2026-11-26");
check(eq(s1.days.map((d) => d.period), ["before", "before", "after", "after", null]), "11/23·11/24 는 변경 전, 11/25·11/26 은 변경 후 (아직 안 지난 날만 구분 안 함. 이상값 날은 표시만 하고 비교 계산에는 안 씀)");
check(eq(s1.comparison.before, { days: 2, total: 190, average: 95 }), "변경 전: 2일 합계 190분, 평균 95분");
check(eq(s1.comparison.after, { days: 1, total: 0, average: 0 }), "변경 후: 1일 합계 0분, 평균 0분 (기록 없는 날도 0분으로 센다)");
check(s1.comparison.diff === -95, "차이(후 − 전) = −95분 (나빠진 결과도 그대로 보여 준다)");

// ── 변경 근거 (T07-C09·C12): 변경 직전 마지막 기록 / 직후 첫 기록 / 2일차 뒤·3일차 앞 판정
//  변경 11/24 23:00(한국) 직전에 저장된 마지막 기록 = 기록 4 (11/24 2일차), 직후 첫 기록 = 기록 5 (11/26 4일차) → 조건 충족
const ev = s1.changes[0];
check(ev.before_last?.id === 4 && ev.before_last.day_no === 2, "변경 직전 마지막 기록 = #4 (2일차)");
check(ev.after_first?.id === 5 && ev.after_first.day_no === 4, "변경 직후 첫 기록 = #5 (4일차)");
check(ev.order_ok === true, "2일차 기록 뒤 · 3일차 기록 앞이면 order_ok = true");
check(eq(s1.days.map((d) => d.record_ids), [[1, 3], [4], [], [5, 6], []]) && eq(s1.days.map((d) => d.day_no), [1, 2, 3, 4, 5]), "날짜별 기록 번호와 몇 일차인지 (중복 #2 는 제외)");
const early = buildSummary(execs, [{ id: 3, changed_at: "2026-11-24T00:30:00Z", rule_name: "x", old_value: "a", new_value: "b", reason: "c" }], "2026-11-23", 5, "2026-11-26");
check(early.changes[0].before_last?.day_no === 1 && early.changes[0].order_ok === false, "2일차 기록보다 먼저 바꾸면 order_ok = false");
const late = buildSummary([...execs, { id: 7, task_id: 9, started_at: "2026-11-24T21:00:00+09:00", actual_minutes: 10, created_at: "2026-11-24T14:30:00Z" }], chg, "2026-11-23", 5, "2026-11-26");
check(late.changes[0].after_first?.id === 7 && late.changes[0].order_ok === false, "변경한 뒤에 2일차 기록을 더 넣으면 order_ok = false");

// ── 변경한 날 처리: 그날 첫 기록이 변경 시각보다 나중에 저장되면 그날은 '변경 후'
const chgMorning = [{ id: 2, changed_at: "2026-11-24T00:30:00Z", rule_name: "x", old_value: "a", new_value: "b", reason: "c" }]; // 11/24 09:30 한국, 첫 기록(01:00Z)보다 앞
const s2 = buildSummary(execs, chgMorning, "2026-11-23", 5, "2026-11-26");
check(s2.days[1].period === "after" && s2.days[0].period === "before", "변경 시각이 그날 첫 기록보다 먼저면 그날은 '변경 후'");

// ── 경계값: 정확히 960분은 이상값이 아님, 기록이 하나도 없으면 평균은 0
const edge = buildSummary([{ id: 1, task_id: 1, started_at: "2026-11-23T08:00:00+09:00", actual_minutes: 960, created_at: "2026-11-23T01:00:00Z" }], [], "2026-11-23", 5, "2026-11-23");
check(edge.days[0].status === "ok" && edge.total === 960 && edge.average === 960, "정확히 960분은 이상값이 아님 (초과일 때만)");
const none = buildSummary([], [], "2026-11-23", 5, "2026-11-25");
check(none.total === 0 && none.average === 0 && none.counted_days === 3, "기록이 없는 3일: 합계 0, 평균 0 (결측 3일)");
const before = buildSummary([], [], "2026-11-23", 5, "2026-11-22");
check(before.counted_days === 0 && before.average === null, "시작 전이면 계산할 날이 없어 평균은 없음(null)");

// 반올림: 평균 .5 는 올림 (예: 합계 5 ÷ 2일 = 2.5 → 3)
const half = buildSummary([{ id: 1, task_id: 1, started_at: "2026-11-23T08:00:00+09:00", actual_minutes: 5, created_at: "2026-11-23T01:00:00Z" }], [], "2026-11-23", 5, "2026-11-24");
check(half.total === 5 && half.counted_days === 2 && half.average === 3, "평균 2.5 → 반올림 3");

console.log(fail ? `\n실패 ${fail}건` : "\n모두 통과");
process.exit(fail ? 1 : 0);
