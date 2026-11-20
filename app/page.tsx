"use client";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { api, kstToday, minutes, noopSubscribe, PRIORITY } from "@/lib/format";
import type { Plan, PlanInput, Task } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import Calendar, { monthLabel } from "./Calendar";
import DayPanel from "./DayPanel";
import PlanForm from "./PlanForm";

export default function Home() {
  const { data: plans, error, reload } = useApi<Plan[]>("/api/plans");
  const { data: tasks, reload: reloadTasks } = useApi<Task[]>("/api/tasks?sort=due");
  // "오늘"은 브라우저에서만 읽는다. (서버 사전 렌더링 중에는 null → Cache Components 의 new Date() 오류 방지)
  const today = useSyncExternalStore(noopSubscribe, kstToday, () => null);
  const [pickedMonth, setPickedMonth] = useState<{ y: number; m: number } | null>(null);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const cursor = pickedMonth ?? (today ? { y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 } : null);
  const selected = pickedDay ?? today ?? "";

  async function create(v: PlanInput) {
    await api("/api/plans", { method: "POST", body: JSON.stringify(v) });
    reload();
  }

  function move(delta: number) {
    if (!cursor) return;
    const d = new Date(Date.UTC(cursor.y, cursor.m + delta, 1));
    setPickedMonth({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
  }

  // 할 일을 바꾸면 달력의 점/개수와 계획 카드의 "할 일 N개"가 함께 갱신되도록 둘 다 다시 불러온다
  const changed = () => { reloadTasks(); reload(); };

  return (
    <>
      {error && <p className="error">{error}</p>}

      <div className="home-grid">
      <section className="card cal-card">
        <div className="cal-title">
          <div className="row">
            <button type="button" className="ghost" onClick={() => move(-1)} aria-label="이전 달">◀</button>
            <h1 style={{ margin: 0 }}>{plans && cursor ? monthLabel(cursor.y, cursor.m) : "달력"}</h1>
            <button type="button" className="ghost" onClick={() => move(1)} aria-label="다음 달">▶</button>
          </div>
          <button
            type="button"
            className="ghost"
            disabled={!plans || !today}
            onClick={() => { setPickedMonth(null); setPickedDay(null); }}
          >
            오늘
          </button>
        </div>

        {plans && cursor && today ? (
          <Calendar
            year={cursor.y}
            month={cursor.m}
            today={today}
            selected={selected}
            plans={plans}
            tasks={tasks ?? []}
            onSelect={setPickedDay}
          />
        ) : (
          !error && <p className="muted">불러오는 중…</p>
        )}
      </section>

      <aside className="side">
      {selected && today && plans && (
        <DayPanel selected={selected} today={today} plans={plans} tasks={tasks ?? []} onChanged={changed} />
      )}

      <details className="card">
        <summary><strong>+ 새 계획 등록</strong></summary>
        <div style={{ marginTop: 12 }}>
          <PlanForm submitLabel="계획 저장" onSubmit={create} />
        </div>
      </details>
      </aside>
      </div>

      <h2>계획 목록</h2>
      {plans === null && !error && <p className="muted">불러오는 중…</p>}
      {plans?.length === 0 && <p className="muted">아직 계획이 없습니다. 실제로 하고 있는 일 하나를 계획으로 등록해 보세요.</p>}
      <div className="plan-grid">
      {plans?.map((p) => (
        <Link key={p.id} href={`/plans/${p.id}`} className="card plan-item">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{p.title}</strong>
            <span className={`badge p${p.priority}`}>우선순위 {PRIORITY[p.priority]}</span>
          </div>
          <div className="muted">
            #{p.id} · {p.start_date} ~ {p.end_date} · 예상 {minutes(p.estimated_minutes)} · 할 일 {p.task_count}개
            · 버전 v{p.version}{p.revision_count ? ` (수정 이력 ${p.revision_count}건)` : ""}
          </div>
          <div className="pre" style={{ marginTop: 6 }}>성공 기준: {p.success_criteria}</div>
          {p.source_improvement && <div className="muted" style={{ marginTop: 6 }}>↳ 회고 개선점 반영: {p.source_improvement}</div>}
        </Link>
      ))}
      </div>
    </>
  );
}
