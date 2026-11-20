"use client";
import Link from "next/link";
import type { Plan, Task } from "@/lib/types";

// 날짜는 모두 'YYYY-MM-DD' 문자열 + UTC 계산으로만 다룬다. (브라우저 시간대 때문에 하루 밀리는 문제 방지)
const DAY_MS = 86400000;
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const SHOW_CHIPS = 2; // 칸 안에 이름을 보여 줄 할 일 수 (넓은 화면에서만 보임)

export function monthLabel(y: number, m: number) {
  return `${y}년 ${m + 1}월`;
}

// 해당 달이 포함된 주(일~토)들을 만들어 6주 이하의 행으로 돌려준다.
function weeksOf(y: number, m: number) {
  const first = Date.UTC(y, m, 1);
  const last = Date.UTC(y, m + 1, 0);
  const start = first - new Date(first).getUTCDay() * DAY_MS;
  const weeks: string[][] = [];
  for (let w = start; w <= last; w += 7 * DAY_MS) {
    weeks.push(Array.from({ length: 7 }, (_, i) => toIso(w + i * DAY_MS)));
  }
  return weeks;
}

// 칸 하나는: 날짜 숫자 + 마감 개수, 그날 마감 할 일 이름(최대 2개, 계획 색), 진행 중인 계획 색 점.
// (예전의 기간 막대는 계획이 겹치면 줄무늬처럼 쌓여서 없앴다. 계획 기간은 범례·점·오른쪽 패널에서 확인)
export default function Calendar({
  year, month, today, selected, plans, tasks, onSelect,
}: {
  year: number;
  month: number; // 0~11
  today: string;
  selected: string;
  plans: Plan[];
  tasks: Task[];
  onSelect: (iso: string) => void;
}) {
  const sorted = [...plans].sort((a, b) => a.id - b.id);

  // 날짜별 마감 할 일 (남은 것 먼저)
  const byDay = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.due_date) continue;
    byDay.set(t.due_date, [...(byDay.get(t.due_date) ?? []), t]);
  }
  for (const list of byDay.values()) list.sort((a, b) => (a.status === b.status ? a.id - b.id : a.status === "todo" ? -1 : 1));

  // 이번 달에 걸쳐 있는 계획만 범례에 표시
  const monthStart = toIso(Date.UTC(year, month, 1));
  const monthEnd = toIso(Date.UTC(year, month + 1, 0));
  const legend = sorted.filter((p) => p.start_date <= monthEnd && p.end_date >= monthStart);

  return (
    <>
      {legend.length > 0 && (
        <div className="cal-legend" aria-label="계획 색상 범례">
          {legend.map((p) => (
            <Link key={p.id} href={`/plans/${p.id}`} className={`legend-chip c${p.id % 6}`} title={`${p.start_date} ~ ${p.end_date}`}>
              {p.title}
              <span className="legend-period">{p.start_date.slice(5).replace("-", "/")}~{p.end_date.slice(5).replace("-", "/")}</span>
            </Link>
          ))}
        </div>
      )}
      <div className="cal" role="grid" aria-label={monthLabel(year, month)}>
        <div className="cal-head" role="row">
          {WEEKDAYS.map((d, i) => (
            <div key={d} role="columnheader" className={i === 0 ? "sun" : i === 6 ? "sat" : ""}>{d}</div>
          ))}
        </div>
        {weeksOf(year, month).map((days) => (
          <div key={days[0]} className="cal-week" role="row">
            {days.map((d, i) => {
              const inMonth = Number(d.slice(5, 7)) - 1 === month;
              const list = byDay.get(d) ?? [];
              const left = list.filter((t) => t.status === "todo").length;
              const active = sorted.filter((p) => p.start_date <= d && p.end_date >= d);
              const cls = ["cal-day", inMonth ? "" : "out", d === today ? "today" : "", d === selected ? "selected" : "", i === 0 ? "sun" : i === 6 ? "sat" : ""].join(" ");
              return (
                <button key={d} type="button" role="gridcell" aria-selected={d === selected} className={cls} onClick={() => onSelect(d)}>
                  <span className="cal-top">
                    <span className="num">{Number(d.slice(8))}</span>
                    {list.length > 0 && (
                      <span className={`due-pill${left === 0 ? " all-done" : ""}`} title={`마감 할 일 ${list.length}개 (남은 것 ${left}개)`}>
                        {left === 0 ? "✓" : left}
                      </span>
                    )}
                  </span>
                  <span className="cal-chips">
                    {list.slice(0, SHOW_CHIPS).map((t) => (
                      <span key={t.id} className={`cal-chip c${t.plan_id % 6}${t.status === "done" ? " done" : ""}`} title={`${t.title} · ${t.plan_title}`}>{t.title}</span>
                    ))}
                    {list.length > SHOW_CHIPS && <span className="cal-more">+{list.length - SHOW_CHIPS}개 더</span>}
                  </span>
                  <span className="cal-dots" aria-hidden>
                    {active.map((p) => <i key={p.id} className={`dot c${p.id % 6}`} />)}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}
