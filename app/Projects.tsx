"use client";
import Link from "next/link";
import { daysBetween, dueLabel, shortMin } from "@/lib/format";
import type { Plan, Task } from "@/lib/types";
import { ProgressBar } from "./ui";

// 프로젝트(계획)마다: 얼마나 끝냈는지, 마감까지 며칠 남았는지, 다음에 할 일 하나
export default function Projects({ plans, tasks, today }: { plans: Plan[]; tasks: Task[]; today: string }) {
  if (plans.length === 0) return <p className="muted">아직 프로젝트가 없어요. 위의 &quot;+ 새 프로젝트&quot;로 지금 하고 있는 일 하나를 등록해 보세요.</p>;
  const sorted = [...plans].sort((a, b) => a.end_date.localeCompare(b.end_date) || a.id - b.id);
  return (
    <div className="project-grid">
      {sorted.map((p) => {
        const mine = tasks.filter((t) => t.plan_id === p.id);
        const done = mine.filter((t) => t.status === "done").length;
        const next = mine.filter((t) => t.status === "todo").sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.id - b.id)[0];
        const left = daysBetween(today, p.end_date);
        const dday = left < 0 ? "종료" : left === 0 ? "오늘 마감" : `D-${left}`;
        const dl = next ? dueLabel(next.due_date, today) : null;
        return (
          <Link key={p.id} href={`/plans/${p.id}`} className="project-card">
            <div className="pc-head">
              <strong>{p.title}</strong>
              <span className="pc-dday">{dday}</span>
            </div>
            <div>
              <ProgressBar value={done} max={mine.length} tone={mine.length > 0 && done === mine.length ? "ok" : "accent"} />
              <div className="pc-stat">
                <span>{mine.length ? `${done}/${mine.length}개 끝냈어요` : "할 일이 아직 없어요"}</span>
                <span className="muted">{p.start_date.slice(5).replace("-", "/")} ~ {p.end_date.slice(5).replace("-", "/")} · 예상 {shortMin(p.estimated_minutes)}</span>
              </div>
            </div>
            <div className="pc-next">
              {next
                ? <><span className="muted">다음</span> <b className={dl?.tone === "late" ? "due-late" : dl?.tone === "soon" ? "due-soon" : ""}>{dl?.text}</b> {next.title}</>
                : mine.length > 0 ? <span className="muted">모든 할 일을 끝냈어요 🎉</span> : null}
            </div>
            {p.source_improvement && <div className="pc-note">↳ 회고 개선점 반영: {p.source_improvement}</div>}
          </Link>
        );
      })}
    </div>
  );
}
