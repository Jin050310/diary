// 사용법: node scripts/test-direction-calc.mjs   (서버·DB 불필요)
// "방향 보기" 계산(lib/directionCalc.ts)을 손으로 계산해 둔 값과 대조한다.
import { buildDirection, planMetrics } from "../lib/directionCalc.ts";

let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); if (!ok) fail++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b) => Math.abs(a - b) < 1e-9;

// 2026-11-16 은 월요일.  시각은 UTC ISO 이고 한국 시간은 +9시간.
const plan = { id: 1, title: "테스트 프로젝트", start_date: "2026-11-16", end_date: "2026-12-06", estimated_minutes: 560 };
const T = (id, title, due, est, status, completed, tags = []) => ({ id, title, due_date: due, estimated_minutes: est, status, tags, completed_at: completed });
const tasks = [
  T(1, "A 제때 끝냄", "2026-11-17", 60, "done", "2026-11-17T03:00:00.000Z", ["단어"]),
  T(2, "B 늦게 끝냄", "2026-11-18", 60, "done", "2026-11-20T03:00:00.000Z", ["단어"]),
  T(3, "C 마감 지남", "2026-11-20", 120, "todo", null, ["문법"]),
  T(4, "D 마감 지남", "2026-11-24", 30, "todo", null),
  T(5, "E 미리 끝냄", "2026-11-27", 90, "done", "2026-11-23T03:00:00.000Z", ["문법"]),
  T(6, "F 아직 먼 마감", "2026-12-01", 200, "todo", null),
  T(7, "G 마감 없음", null, 0, "todo", null),
];
const X = (id, task, started, min, blocker) => ({ id, task_id: task, started_at: started, actual_minutes: min, blocker });
const execs = [
  X(1, 1, "2026-11-17T01:00:00.000Z", 90, null),
  X(2, 2, "2026-11-18T01:00:00.000Z", 30, "집중이 안됨"),
  X(3, 3, "2026-11-19T01:00:00.000Z", 60, "집중 안 됨"),
  X(4, 5, "2026-11-22T16:00:00.000Z", 100, null), // UTC 로는 11-22 이지만 한국 시간 11-23 01:00
];

const d = buildDirection(plan, tasks, execs, "2026-11-25");
const t = d.totals, p = d.progress, pt = d.patterns;

check(eq([t.task_count, t.est_total, t.done_count, t.done_est, t.actual_total, t.no_due_count], [7, 560, 3, 210, 280, 1]), `합계: 할 일 7, 예상 560, 완료 3(예상 210), 실제 280, 마감 없음 1 → ${[t.task_count, t.est_total, t.done_count, t.done_est, t.actual_total, t.no_due_count]}`);
check(p.planned_to_date === 270 && p.done_total_est === 210 && p.gap === -60 && p.pace === "behind" && p.overdue_open_est === 150,
  `진행: 오늘까지 마감 270, 완료 210, 차이 -60 → 뒤처짐, 마감 지난 미완료 150 → ${p.planned_to_date}/${p.done_total_est}/${p.gap}/${p.pace}/${p.overdue_open_est}`);
check(near(p.percent_done, 0.375) && near(p.percent_planned, 270 / 560), "진행률 37.5%, 계획 대비 기준 48.2%");

check(pt.bias.n === 3 && pt.bias.est === 210 && pt.bias.actual === 220 && near(pt.bias.ratio, 220 / 210),
  `예상 정확도: 끝난 3개(예상 210/실제 220) → ${pt.bias.ratio?.toFixed(4)} (미완료 C 의 기록은 제외)`);
check(eq(pt.by_tag.map((x) => [x.tag, +x.ratio.toFixed(4), x.n]), [["문법", 1.1111, 1], ["단어", 1, 2]]), "태그별: 더 어긋난 '문법'(+11%)이 먼저, '단어' 0%");
check(pt.delay.past_due === 4 && pt.delay.late_open === 2 && pt.delay.late_done === 1 && near(pt.delay.rate, 0.75),
  `지연: 마감 지난 4개 중 3개(미완료 2 + 늦게 완료 1), A 는 마감 당일 완료라 제외 → ${pt.delay.late_open}+${pt.delay.late_done}/${pt.delay.past_due}`);
check(eq(pt.late_tasks.map((x) => [x.id, x.state]), [[2, "done_late"], [3, "open"], [4, "open"]]) || eq(pt.late_tasks.map((x) => [x.id, x.state]).sort(), [[2, "done_late"], [3, "open"], [4, "open"]].sort()), "지연 근거 목록: B(늦게 완료), C·D(미완료)");
check(pt.blocked.execs_total === 4 && pt.blocked.execs_with === 2 && pt.blocked.tasks_with === 2 && near(pt.blocked.rate, 0.5), "막힘: 실행 4건 중 2건(할 일 2개)");
check(pt.blockers.length === 1 && pt.blockers[0].word === "집중" && pt.blockers[0].count === 2 && pt.blockers[0].example === "집중이 안됨",
  `반복 낱말: '집중이'/'집중' 이 2번 → '집중' (조사 제거), '안됨'은 1번이라 제외 → ${JSON.stringify(pt.blockers)}`);
check(eq(pt.weekday, [0, 100, 90, 30, 60, 0, 0]), `요일별 작업 분(일~토): 한국 시간 자정 넘긴 기록이 월요일(11-23)로 → ${pt.weekday}`);
check(eq(pt.off_tasks.map((x) => [x.id, x.diff]), [[3, -60], [1, 30], [2, -30]]) || pt.off_tasks[0].id === 3, `가장 어긋난 할 일: C(-60) 먼저 → ${pt.off_tasks.map((x) => x.id + ":" + x.diff)}`);

const w = d.weeks;
check(w.length === 3 && eq(w.map((x) => x.start), ["2026-11-16", "2026-11-23", "2026-11-30"]), "주 3개(월요일 시작): 11/16, 11/23, 11/30");
check(eq([w[0].planned, w[0].actual, w[0].due_count, w[0].done_count, w[0].late_open, w[0].late_done, w[0].future], [240, 180, 3, 2, 1, 1, false]), `1주차: 계획 240/실제 180, 마감 3개 중 완료 2, 미완료 지연 1, 늦게 완료 1 → ${JSON.stringify(w[0])}`);
check(eq([w[1].planned, w[1].actual, w[1].due_count, w[1].done_count, w[1].late_open, w[1].late_done], [120, 100, 2, 1, 1, 0]), "2주차: 계획 120/실제 100, 완료 1, 지연 1");
check(eq([w[2].planned, w[2].actual, w[2].future, w[2].late_open], [200, 0, true, 0]), "3주차: 아직 오지 않은 주(미래)로 표시, 지연 없음");
check(d.trend.state === null, "추세: 끝난 주가 1개뿐이라 판단하지 않음(null)");

const s = (date) => d.series.find((x) => x.date === date);
check(d.series.length === 21 && d.series[0].date === "2026-11-16" && d.series[20].date === "2026-12-06", "누적 그래프: 11/16~12/06 21일");
check(eq([s("2026-11-20").planned, s("2026-11-20").completed, s("2026-11-20").actual], [240, 120, 180]), "11/20: 계획 누적 240, 완료 누적 120(B 가 이날 완료), 투입 누적 180");
check(eq([s("2026-11-23").planned, s("2026-11-23").completed, s("2026-11-23").actual], [240, 210, 280]), "11/23: 완료 누적 210(E 를 마감 전에 완료), 투입 280");
check(s("2026-11-26").completed === null && s("2026-11-26").actual === null && s("2026-11-27").planned === 360, "오늘(11/25) 이후는 완료·투입이 비어 있고(null) 계획 선만 이어짐");

const lines = d.verdict.lines.join(" | ");
check(/뒤처져/.test(lines) && /집중/.test(lines) && /일요일에는 한 번도/.test(lines) && /3개\(75%\)/.test(lines), "요약 문장: 뒤처짐, 반복 낱말, 일요일 미작업, 지연 75% 포함");
check(d.verdict.suggestions.length === 3 && /마감 하루 전/.test(d.verdict.suggestions[0]) && /'집중'/.test(d.verdict.suggestions[1]) && /일요일/.test(d.verdict.suggestions[2]), `개선점 후보 3개: ${d.verdict.suggestions.length}개`);

const d2 = buildDirection(plan, tasks, execs, "2026-12-01");
check(d2.trend.state === "narrowing" && d2.trend.from === 60 && d2.trend.to === 20, `추세(12/01 기준): 부족분 60 → 20 이라 '좁혀지는 중' → ${JSON.stringify(d2.trend)}`);
const d3 = buildDirection(plan, tasks.map((x) => (x.id === 3 ? { ...x, status: "done", completed_at: "2026-11-20T03:00:00.000Z" } : x)), execs, "2026-11-25");
check(d3.patterns.bias.n === 4 && d3.progress.gap === 210 + 120 - 270, "C 를 완료로 바꾸면 예상 정확도 표본 4개, 앞섬 차이 +60 (완료 330 - 계획 270)");

const m = planMetrics(d);
check(near(m.done_rate, 3 / 7) && near(m.delay_rate, 0.75) && near(m.blocked_rate, 0.5) && m.planned_est === 560 && m.actual_total === 280, "개선 효과 비교용 요약(planMetrics)");

const e = buildDirection(plan, [], [], "2026-11-25");
check(e.totals.task_count === 0 && e.progress.percent_done === null && e.patterns.bias.ratio === null && e.patterns.delay.rate === null
  && /할 일이 없어요/.test(e.verdict.lines[0]) && e.series.every((x) => x.planned === 0), "할 일이 없는 계획: 0 나눗셈 없이 값은 null, 안내 문구 표시");
const bad = JSON.stringify(e).includes("NaN") || JSON.stringify(d).includes("NaN") || JSON.stringify(d2).includes("NaN");
check(!bad, "어떤 결과에도 NaN 이 섞이지 않음");

console.log(fail ? `\n실패 ${fail}건` : "\n모두 통과");
process.exit(fail ? 1 : 0);
