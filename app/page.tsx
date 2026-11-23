"use client";
import { useState, useSyncExternalStore } from "react";
import { api, kstToday, noopSubscribe } from "@/lib/format";
import type { Plan, PlanInput, Task } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import Calendar, { monthLabel } from "./Calendar";
import DayPanel from "./DayPanel";
import PlanForm from "./PlanForm";
import Projects from "./Projects";

const MONTH_EN = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

export default function Home() {
  const { data: plans, error, reload } = useApi<Plan[]>("/api/plans");
  const { data: tasks, reload: reloadTasks } = useApi<Task[]>("/api/tasks?sort=due");
  // "오늘"은 브라우저에서만 읽는다. (서버 사전 렌더링 중에는 null → Cache Components 의 new Date() 오류 방지)
  const today = useSyncExternalStore(noopSubscribe, kstToday, () => null);
  const [pickedMonth, setPickedMonth] = useState<{ y: number; m: number } | null>(null);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [showPlanForm, setShowPlanForm] = useState(false);
  const cursor = pickedMonth ?? (today ? { y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 } : null);
  const selected = pickedDay ?? today ?? "";

  async function create(v: PlanInput) {
    await api("/api/plans", { method: "POST", body: JSON.stringify(v) });
    setShowPlanForm(false);
    reload();
  }

  function move(delta: number) {
    if (!cursor) return;
    const d = new Date(Date.UTC(cursor.y, cursor.m + delta, 1));
    setPickedMonth({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
  }

  // 할 일을 바꾸면 달력의 숫자와 프로젝트 카드의 진행이 함께 갱신되도록 둘 다 다시 불러온다
  const changed = () => { reloadTasks(); reload(); };

  return (
    <>
      {/* 잡지 표지처럼: 연도가 반복되는 띠 + 아주 큰 월 이름. (장식이라 스크린 리더에는 읽히지 않게 하고, 제목은 아래 sr-only h1 하나) */}
      <h1 className="sr-only">달력 {cursor ? monthLabel(cursor.y, cursor.m) : ""}</h1>
      <div className="year-strip" aria-hidden="true">{cursor ? Array.from({ length: 40 }, () => cursor.y).join(" / ") : ""}</div>
      <div className="month-giant" aria-hidden="true">{cursor ? MONTH_EN[cursor.m] : "\u00a0"}</div>
      <p className="page-hint cal-hint">날짜를 누르면 그날 할 일을 바로 체크하고 추가할 수 있어요.</p>
      {error && <p className="error">{error}</p>}

      <div className="home-grid">
        <section className="card cal-card">
          <div className="cal-title">
            <div className="row">
              <button type="button" className="ghost" onClick={() => move(-1)} aria-label="이전 달">◀</button>
              <h2 className="cal-month">{plans && cursor ? monthLabel(cursor.y, cursor.m) : "달력"}</h2>
              <button type="button" className="ghost" onClick={() => move(1)} aria-label="다음 달">▶</button>
            </div>
            <button type="button" className="ghost" disabled={!plans || !today} onClick={() => { setPickedMonth(null); setPickedDay(null); }}>
              오늘
            </button>
          </div>

          {plans && cursor && today ? (
            <Calendar year={cursor.y} month={cursor.m} today={today} selected={selected} plans={plans} tasks={tasks ?? []} onSelect={setPickedDay} />
          ) : (
            !error && <p className="muted">불러오는 중…</p>
          )}
        </section>

        <aside className="side">
          {selected && today && plans && (
            <DayPanel selected={selected} today={today} plans={plans} tasks={tasks ?? []} onChanged={changed} />
          )}
        </aside>
      </div>

      <div className="section-head">
        <h2>프로젝트</h2>
        <button type="button" className="ghost" onClick={() => setShowPlanForm((v) => !v)}>{showPlanForm ? "닫기" : "+ 새 프로젝트"}</button>
      </div>
      {showPlanForm && (
        <section className="card">
          <h2>새 프로젝트(계획) 등록</h2>
          <PlanForm submitLabel="프로젝트 저장" onSubmit={create} />
        </section>
      )}
      {plans && tasks && today ? <Projects plans={plans} tasks={tasks} today={today} /> : !error && <p className="muted">불러오는 중…</p>}
    </>
  );
}
