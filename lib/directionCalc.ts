// "방향 보기" 계산 (순수 함수). DB·브라우저에 의존하지 않아서 정해 둔 예제로 값이 맞는지 그대로 검증할 수 있다.
// 날짜는 'YYYY-MM-DD'(한국 날짜), 시각은 ISO 문자열. 시간 길이는 모두 분.
// 이 파일은 서버(API)와 브라우저(화면)가 함께 쓰므로 경로 별칭(@/)이나 서버 전용 모듈을 가져오지 않는다.

export type DPlan = { id: number; title: string; start_date: string; end_date: string; estimated_minutes: number };
export type DTask = {
  id: number; title: string; due_date: string | null; estimated_minutes: number;
  status: "todo" | "done"; tags: string[]; completed_at: string | null;
};
export type DExec = { id: number; task_id: number; started_at: string; actual_minutes: number; blocker: string | null };

export type SeriesPoint = { date: string; planned: number; completed: number | null; actual: number | null };
export type WeekRow = {
  start: string; end: string; future: boolean;
  planned: number; actual: number; due_count: number; done_count: number; late_open: number; late_done: number;
};
export type LateTask = { id: number; title: string; due_date: string; est: number; state: "open" | "done_late"; completed_on: string | null };

export type Direction = {
  plan: DPlan;
  today: string;
  totals: { task_count: number; est_total: number; done_count: number; done_est: number; actual_total: number; no_due_count: number };
  progress: {
    planned_to_date: number;    // 오늘까지 마감인 할 일의 예상 시간 합
    done_total_est: number;     // 완료한 할 일의 예상 시간 합 (미리 끝낸 것 포함)
    gap: number;                // done_total_est − planned_to_date  (+ 앞섬 / − 뒤처짐)
    overdue_open_est: number;   // 마감이 지났는데 아직 안 끝난 할 일의 예상 시간 합
    percent_done: number | null;
    percent_planned: number | null;
    pace: "ahead" | "behind" | "on";
  };
  series: SeriesPoint[];
  weeks: WeekRow[];
  trend: { state: "widening" | "narrowing" | "flat" | null; from: number | null; to: number | null };
  patterns: {
    bias: { ratio: number | null; n: number; est: number; actual: number };
    by_tag: { tag: string; ratio: number; n: number }[];
    delay: { past_due: number; late_open: number; late_done: number; rate: number | null };
    blocked: { execs_total: number; execs_with: number; rate: number | null; tasks_with: number };
    blockers: { word: string; count: number; example: string }[];
    weekday: number[]; // 일~토 실제 작업 분
    off_tasks: { id: number; title: string; est: number; actual: number; diff: number }[];
    late_tasks: LateTask[];
  };
  verdict: { lines: string[]; suggestions: string[] };
};

export type PlanMetrics = {
  task_count: number; done_rate: number | null; bias_ratio: number | null; delay_rate: number | null;
  blocked_rate: number | null; planned_est: number; actual_total: number; exec_count: number;
};
export type Improvement = {
  note_id: number; improvement: string; created_at: string;
  from: PlanMetrics;
  next: { id: number; title: string; metrics: PlanMetrics } | null;
};
export type DirectionResponse = Direction & { improvements: Improvement[] };

const DAY = 86400000;
export const WEEKDAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
export const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
export const kstDate = (iso: string) => new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 10);
const dow = (iso: string) => new Date(iso + "T00:00:00Z").getUTCDay();
const weekStart = (iso: string) => addDays(iso, -((dow(iso) + 6) % 7)); // 월요일 시작
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const pct = (r: number) => Math.round(Math.abs(r - 1) * 100);

export function fmtMin(n: number) {
  const a = Math.abs(n);
  const h = Math.floor(a / 60), m = a % 60;
  return `${a}분${h ? ` (${h}시간${m ? ` ${m}분` : ""})` : ""}`;
}

// ───── 막힘 사유에서 반복되는 낱말 찾기 (형태소 분석 없이 어미·조사만 대충 떼는 근사) ─────
const STOP = new Set(["너무", "조금", "많이", "있어서", "있어", "해서", "하는", "했다", "때문", "때문에", "그냥", "계속", "다시", "자꾸"]);
const PARTICLES = ["에서는", "으로는", "에서", "으로", "에는", "라서", "은", "는", "이", "가", "을", "를", "에", "도", "의", "와", "과", "로", "만"];
function tokensOf(text: string) {
  const out = new Set<string>();
  for (let w of text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    for (const p of PARTICLES) {
      if (w.length > p.length + 1 && w.endsWith(p)) { w = w.slice(0, -p.length); break; }
    }
    if (w.length >= 2 && !STOP.has(w)) out.add(w);
  }
  return out;
}

export function buildDirection(plan: DPlan, tasks: DTask[], execs: DExec[], today: string): Direction {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ex = execs.filter((e) => byId.has(e.task_id)).map((e) => ({ ...e, date: kstDate(e.started_at) }));
  const doneOn = (t: DTask) => (t.status === "done" ? (t.completed_at ? kstDate(t.completed_at) : today) : null);

  const actualOf = new Map<number, number>();
  for (const e of ex) actualOf.set(e.task_id, (actualOf.get(e.task_id) ?? 0) + e.actual_minutes);

  const estTotal = sum(tasks.map((t) => t.estimated_minutes));
  const doneTasks = tasks.filter((t) => t.status === "done");
  const doneEst = sum(doneTasks.map((t) => t.estimated_minutes));
  const actualTotal = sum(ex.map((e) => e.actual_minutes));

  // ① 계획 대비 진행 (오늘 기준)
  const plannedToDate = sum(tasks.filter((t) => t.due_date && t.due_date <= today).map((t) => t.estimated_minutes));
  const overdueOpenEst = sum(tasks.filter((t) => t.status === "todo" && t.due_date && t.due_date < today).map((t) => t.estimated_minutes));
  const gap = doneEst - plannedToDate;
  const pace = gap >= 30 ? "ahead" : gap <= -30 ? "behind" : "on";

  // 누적 선 그래프: 계획(마감 기준) / 완료(완료한 할 일의 예상 시간) / 투입(실제 작업 시간)
  const firstDue = tasks.map((t) => t.due_date).filter((d): d is string => !!d).sort()[0];
  const seriesStart = firstDue && firstDue < plan.start_date ? firstDue : plan.start_date;
  let seriesEnd = plan.end_date > today ? plan.end_date : today;
  if (Date.parse(seriesEnd) - Date.parse(seriesStart) > 400 * DAY) seriesEnd = addDays(seriesStart, 400);
  const series: SeriesPoint[] = [];
  for (let d = seriesStart; d <= seriesEnd; d = addDays(d, 1)) {
    const past = d <= today;
    series.push({
      date: d,
      planned: sum(tasks.filter((t) => t.due_date && t.due_date <= d).map((t) => t.estimated_minutes)),
      completed: past ? sum(doneTasks.filter((t) => (doneOn(t) as string) <= d).map((t) => t.estimated_minutes)) : null,
      actual: past ? sum(ex.filter((e) => e.date <= d).map((e) => e.actual_minutes)) : null,
    });
  }

  // ② 주별 추이 (월~일)
  const weeks: WeekRow[] = [];
  for (let w = weekStart(seriesStart); w <= weekStart(seriesEnd); w = addDays(w, 7)) {
    const end = addDays(w, 6);
    const due = tasks.filter((t) => t.due_date && t.due_date >= w && t.due_date <= end);
    weeks.push({
      start: w, end, future: w > today,
      planned: sum(due.map((t) => t.estimated_minutes)),
      actual: sum(ex.filter((e) => e.date >= w && e.date <= end).map((e) => e.actual_minutes)),
      due_count: due.length,
      done_count: due.filter((t) => t.status === "done").length,
      late_open: due.filter((t) => t.status === "todo" && (t.due_date as string) < today).length,
      late_done: due.filter((t) => t.status === "done" && (doneOn(t) as string) > (t.due_date as string)).length,
    });
  }
  // 추세: 이미 끝난 최근 두 주의 계획과 실제 차이가 커지는지 줄어드는지
  const elapsed = weeks.filter((w) => w.end < today && w.planned > 0);
  let trend: Direction["trend"] = { state: null, from: null, to: null };
  if (elapsed.length >= 2) {
    const a = elapsed[elapsed.length - 2], b = elapsed[elapsed.length - 1];
    const from = Math.abs(a.planned - a.actual), to = Math.abs(b.planned - b.actual);
    trend = { state: to - from > 30 ? "widening" : to - from < -30 ? "narrowing" : "flat", from, to };
  }

  // ③ 빗나감 패턴
  const basis = doneTasks.filter((t) => t.estimated_minutes > 0 && actualOf.has(t.id)); // 끝났고 예상·실제가 모두 있는 할 일
  const bEst = sum(basis.map((t) => t.estimated_minutes)), bAct = sum(basis.map((t) => actualOf.get(t.id) as number));
  const bias = { ratio: basis.length ? bAct / bEst : null, n: basis.length, est: bEst, actual: bAct };
  const tagMap = new Map<string, { est: number; act: number; n: number }>();
  for (const t of basis) for (const tag of t.tags) {
    const c = tagMap.get(tag) ?? { est: 0, act: 0, n: 0 };
    c.est += t.estimated_minutes; c.act += actualOf.get(t.id) as number; c.n++;
    tagMap.set(tag, c);
  }
  const byTag = [...tagMap.entries()].map(([tag, c]) => ({ tag, ratio: c.act / c.est, n: c.n }))
    .sort((a, b) => Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1) || a.tag.localeCompare(b.tag));

  const pastDue = tasks.filter((t) => t.due_date && t.due_date < today);
  const lateTasks: LateTask[] = [];
  for (const t of pastDue) {
    if (t.status === "todo") lateTasks.push({ id: t.id, title: t.title, due_date: t.due_date as string, est: t.estimated_minutes, state: "open", completed_on: null });
    else if ((doneOn(t) as string) > (t.due_date as string)) lateTasks.push({ id: t.id, title: t.title, due_date: t.due_date as string, est: t.estimated_minutes, state: "done_late", completed_on: doneOn(t) });
  }
  lateTasks.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id - b.id); // 입력 순서와 상관없이 항상 같은 순서
  const lateOpen = lateTasks.filter((l) => l.state === "open").length, lateDone = lateTasks.length - lateOpen;
  const delay = { past_due: pastDue.length, late_open: lateOpen, late_done: lateDone, rate: pastDue.length ? lateTasks.length / pastDue.length : null };

  const withBlocker = ex.filter((e) => e.blocker && e.blocker.trim());
  const blocked = {
    execs_total: ex.length, execs_with: withBlocker.length, rate: ex.length ? withBlocker.length / ex.length : null,
    tasks_with: new Set(withBlocker.map((e) => e.task_id)).size,
  };
  const wordCount = new Map<string, number>();
  for (const e of withBlocker) for (const w of tokensOf(e.blocker as string)) wordCount.set(w, (wordCount.get(w) ?? 0) + 1);
  const blockers = [...wordCount.entries()].filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5)
    .map(([word, count]) => ({ word, count, example: (withBlocker.find((e) => (e.blocker as string).toLowerCase().includes(word))?.blocker as string) ?? "" }));

  const weekday = [0, 0, 0, 0, 0, 0, 0];
  for (const e of ex) weekday[dow(e.date)] += e.actual_minutes;
  const offTasks = tasks.filter((t) => t.estimated_minutes > 0 && actualOf.has(t.id))
    .map((t) => ({ id: t.id, title: t.title, est: t.estimated_minutes, actual: actualOf.get(t.id) as number, diff: (actualOf.get(t.id) as number) - t.estimated_minutes }))
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || a.id - b.id).slice(0, 3);

  // ④ 한 줄 요약과 개선점 후보 (제안일 뿐, 저장 여부는 사용자가 정한다)
  const lines: string[] = [];
  if (!tasks.length) lines.push("이 계획에는 아직 할 일이 없어요. 마일스톤 할 일(마감일·예상 시간 포함)을 넣으면 방향을 볼 수 있어요.");
  else {
    lines.push(pace === "on"
      ? `오늘까지 마감인 분량(${fmtMin(plannedToDate)})과 완료한 분량(${fmtMin(doneEst)})이 거의 같아요. 계획한 속도대로 가고 있어요.`
      : pace === "behind"
        ? `오늘까지 마감인 분량 ${fmtMin(plannedToDate)} 중 완료한 분량이 ${fmtMin(doneEst)}라서 ${fmtMin(-gap)} 뒤처져 있어요.`
        : `오늘까지 마감인 분량 ${fmtMin(plannedToDate)}보다 ${fmtMin(gap)} 더 앞서 끝내 두었어요.`);
    if (trend.state === "widening") lines.push(`최근 두 주 사이 계획과 실제의 차이가 벌어지고 있어요 (${fmtMin(trend.from as number)} 차이 → ${fmtMin(trend.to as number)} 차이).`);
    else if (trend.state === "narrowing") lines.push(`최근 두 주 사이 계획과 실제의 차이가 좁혀지고 있어요 (${fmtMin(trend.from as number)} 차이 → ${fmtMin(trend.to as number)} 차이).`);
    else if (trend.state === "flat") lines.push("최근 두 주의 계획 대비 실제 차이는 비슷해요.");
    if (bias.ratio === null) lines.push("끝낸 할 일 중 실행 기록이 있는 게 아직 없어서 예상 정확도는 계산할 수 없어요.");
    else if (bias.ratio > 1.1) lines.push(`끝낸 할 일 ${bias.n}개 기준으로 예상보다 평균 ${pct(bias.ratio)}% 더 걸렸어요.`);
    else if (bias.ratio < 0.9) lines.push(`끝낸 할 일 ${bias.n}개 기준으로 예상보다 평균 ${pct(bias.ratio)}% 덜 걸렸어요.`);
    else lines.push(`끝낸 할 일 ${bias.n}개 기준으로 예상과 실제가 비슷해요 (차이 ${pct(bias.ratio)}%).`);
    if (delay.rate !== null) lines.push(`마감이 지난 할 일 ${delay.past_due}개 중 ${lateTasks.length}개(${Math.round(delay.rate * 100)}%)가 제때 끝나지 않았어요 (아직 못 끝냄 ${lateOpen}, 늦게 끝냄 ${lateDone}).`);
    if (blockers[0]) lines.push(`막힘 사유에서 '${blockers[0].word}'이(가) ${blockers[0].count}번 반복돼요.`);
    if (actualTotal > 0) {
      const lo = Math.min(...weekday), idx = weekday.indexOf(lo);
      lines.push(lo === 0 ? `${WEEKDAY_NAMES[idx]}요일에는 한 번도 작업하지 않았어요.` : `작업 시간이 가장 적은 요일은 ${WEEKDAY_NAMES[idx]}요일(${lo}분)이에요.`);
    }
  }
  const suggestions: string[] = [];
  if (bias.ratio !== null && bias.n >= 2 && bias.ratio >= 1.2) suggestions.push(`예상 시간을 실제 기록 기준으로 ${bias.ratio.toFixed(1)}배 넉넉하게 잡는다`);
  if (delay.rate !== null && delay.past_due >= 3 && delay.rate >= 0.3) suggestions.push("마감 하루 전에 진행 상황을 확인하고, 못 끝낼 것 같으면 그때 일정을 조정한다");
  if (blockers[0]) suggestions.push(`'${blockers[0].word}' 때문에 막히는 일이 반복되므로, 작업 시작 전에 미리 대비책을 정해 둔다`);
  if (actualTotal > 0 && weekday.some((m) => m === 0)) suggestions.push(`${WEEKDAY_NAMES[weekday.indexOf(0)]}요일에는 작업 기록이 없으니 최소 시간을 정해 두거나 일정을 다른 날로 옮긴다`);

  return {
    plan, today,
    totals: { task_count: tasks.length, est_total: estTotal, done_count: doneTasks.length, done_est: doneEst, actual_total: actualTotal, no_due_count: tasks.filter((t) => !t.due_date).length },
    progress: {
      planned_to_date: plannedToDate, done_total_est: doneEst, gap, overdue_open_est: overdueOpenEst,
      percent_done: estTotal ? doneEst / estTotal : null, percent_planned: estTotal ? plannedToDate / estTotal : null, pace,
    },
    series, weeks, trend,
    patterns: { bias, by_tag: byTag, delay, blocked, blockers, weekday, off_tasks: offTasks, late_tasks: lateTasks },
    verdict: { lines, suggestions: suggestions.slice(0, 4) },
  };
}

// 개선점을 반영하기 전/후 계획을 같은 잣대로 비교하기 위한 요약
export function planMetrics(d: Direction): PlanMetrics {
  return {
    task_count: d.totals.task_count,
    done_rate: d.totals.task_count ? d.totals.done_count / d.totals.task_count : null,
    bias_ratio: d.patterns.bias.ratio,
    delay_rate: d.patterns.delay.rate,
    blocked_rate: d.patterns.blocked.rate,
    planned_est: d.totals.est_total,
    actual_total: d.totals.actual_total,
    exec_count: d.patterns.blocked.execs_total,
  };
}
