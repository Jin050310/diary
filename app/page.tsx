"use client";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { api, kstToday, minutes, noopSubscribe, PRIORITY } from "@/lib/format";
import type { Plan, PlanInput, Task } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import Calendar, { monthLabel, WEEKDAYS } from "./Calendar";
import PlanForm from "./PlanForm";

const weekdayOf = (iso: string) => WEEKDAYS[new Date(iso + "T00:00:00Z").getUTCDay()];

export default function Home() {
  const { data: plans, error, reload } = useApi<Plan[]>("/api/plans");
  const { data: tasks } = useApi<Task[]>("/api/tasks?sort=due");
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

  const activeOnSelected = (plans ?? []).filter(
    (p) => selected && p.start_date <= selected && p.end_date >= selected,
  );
  const dueOnSelected = (tasks ?? []).filter((t) => selected && t.due_date === selected);

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
      {selected && plans && (
        <section className="card">
          <h2>{Number(selected.slice(5, 7))}월 {Number(selected.slice(8))}일 ({weekdayOf(selected)}){selected === today ? " · 오늘" : ""}</h2>
          <h3 className="sub">마감 할 일 {dueOnSelected.length}개</h3>
          {dueOnSelected.length === 0 ? (
            <p className="muted">이 날짜에 마감인 할 일이 없습니다.</p>
          ) : (
            <ul className="day-tasks">
              {dueOnSelected.map((t) => (
                <li key={t.id} className={t.status === "done" ? "done" : ""}>
                  <span className="mark">{t.status === "done" ? "✓" : "○"}</span>
                  <span>{t.title} <span className="muted">· {t.plan_title}</span></span>
                </li>
              ))}
            </ul>
          )}
          <p className="muted" style={{ marginTop: 10 }}><Link href="/tasks">할 일 화면에서 완료·수정하기 →</Link></p>

          <h3 className="sub">진행 중인 계획 {activeOnSelected.length}개</h3>
          {activeOnSelected.length === 0 ? (
            <p className="muted">이 날짜에 진행 중인 계획이 없습니다.</p>
          ) : (
            <ul className="day-list">
              {activeOnSelected.map((p) => (
                <li key={p.id}>
                  <Link href={`/plans/${p.id}`}>{p.title}</Link>
                  <span className={`badge p${p.priority}`}>우선순위 {PRIORITY[p.priority]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
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
