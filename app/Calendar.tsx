"use client";
import Link from "next/link";
import type { Plan, Task } from "@/lib/types";

// 날짜는 모두 'YYYY-MM-DD' 문자열 + UTC 계산으로만 다룬다. (브라우저 시간대 때문에 하루 밀리는 문제 방지)
const DAY_MS = 86400000;
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

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
  // 날짜별 마감 할 일 수 (전체 / 남은 것)
  const due = new Map<string, { all: number; left: number }>();
  for (const t of tasks) {
    if (!t.due_date) continue;
    const c = due.get(t.due_date) ?? { all: 0, left: 0 };
    c.all++;
    if (t.status === "todo") c.left++;
    due.set(t.due_date, c);
  }

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
      {weeksOf(year, month).map((days) => {
        const bars = sorted
          .filter((p) => p.start_date <= days[6] && p.end_date >= days[0])
          .map((p) => {
            const s = p.start_date > days[0] ? p.start_date : days[0];
            const e = p.end_date < days[6] ? p.end_date : days[6];
            return {
              p,
              col: days.indexOf(s) + 1,
              end: days.indexOf(e) + 2,
              openLeft: p.start_date < days[0],
              openRight: p.end_date > days[6],
            };
          });
        return (
          <div
            key={days[0]}
            className="cal-week"
            role="row"
            style={{ gridTemplateRows: `30px repeat(${Math.max(bars.length, 1)}, 12px)` }}
          >
            {days.map((d, i) => {
              const inMonth = Number(d.slice(5, 7)) - 1 === month;
              const cls = [
                "cal-day",
                inMonth ? "" : "out",
                d === today ? "today" : "",
                d === selected ? "selected" : "",
                i === 0 ? "sun" : i === 6 ? "sat" : "",
              ].join(" ");
              return (
                <button
                  key={d}
                  type="button"
                  role="gridcell"
                  aria-selected={d === selected}
                  className={cls}
                  style={{ gridColumn: i + 1, gridRow: `1 / span ${Math.max(bars.length, 1) + 1}` }}
                  onClick={() => onSelect(d)}
                >
                  <span className="num">{Number(d.slice(8))}</span>
                  {due.has(d) && (
                    <span
                      className={`due-pill${due.get(d)!.left === 0 ? " all-done" : ""}`}
                      title={`마감 할 일 ${due.get(d)!.all}개 (남은 것 ${due.get(d)!.left}개)`}
                    >
                      {due.get(d)!.left === 0 ? "✓" : due.get(d)!.left}
                    </span>
                  )}
                </button>
              );
            })}
            {bars.map((b, lane) => (
              <Link
                key={b.p.id}
                href={`/plans/${b.p.id}`}
                title={`${b.p.title} (${b.p.start_date} ~ ${b.p.end_date})`}
                className={`cal-bar c${b.p.id % 6}${b.openLeft ? " open-l" : ""}${b.openRight ? " open-r" : ""}`}
                style={{ gridColumn: `${b.col} / ${b.end}`, gridRow: lane + 2 }}
              >
                {b.p.title}
              </Link>
            ))}
          </div>
        );
      })}
    </div>
    </>
  );
}
