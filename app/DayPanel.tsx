"use client";
import Link from "next/link";
import { useState } from "react";
import { api, PRIORITY } from "@/lib/format";
import { toggleTask } from "@/lib/taskActions";
import type { Plan, Task, TaskInput } from "@/lib/types";
import { WEEKDAYS } from "./Calendar";
import TaskForm from "./tasks/TaskForm";

const weekdayOf = (iso: string) => WEEKDAYS[new Date(iso + "T00:00:00Z").getUTCDay()];

// 달력에서 고른 날짜의 패널: 그날 마감인 할 일을 바로 완료하고, 실행 기록으로 이어가고, 그 날짜로 할 일을 추가한다.
export default function DayPanel({
  selected, today, plans, tasks, onChanged,
}: {
  selected: string;
  today: string;
  plans: Plan[];
  tasks: Task[];
  onChanged: () => void;
}) {
  const [notice, setNotice] = useState<{ id: number; title: string } | null>(null);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState(30);
  const [planPick, setPlanPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const active = plans.filter((p) => p.start_date <= selected && p.end_date >= selected);
  const due = tasks.filter((t) => t.due_date === selected);
  const overdue = selected === today ? tasks.filter((t) => t.status === "todo" && t.due_date && t.due_date < today) : [];
  const choices = active.length ? active : plans; // 그날 진행 중인 계획이 있으면 그 계획들 먼저
  const planId = choices.some((p) => String(p.id) === planPick) ? planPick : String(choices[0]?.id ?? "");

  async function toggle(t: Task) {
    setError("");
    setNotice(null);
    try {
      await toggleTask(t);
      if (t.status === "todo") setNotice({ id: t.id, title: t.title });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리하지 못했어요");
    }
  }

  // 패널 안에서 할 일 수정 (PATCH) — 완료 상태·실행 기록은 건드리지 않는다
  const update = (id: number) => async (v: TaskInput) => {
    await api(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(v) });
    setEditingId(null);
    onChanged();
  };

  async function remove(t: Task) {
    if (!window.confirm(`"${t.title}" 할 일을 삭제할까요?`)) return;
    setError("");
    setNotice(null);
    try {
      await api(`/api/tasks/${t.id}`, { method: "DELETE" });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제하지 못했어요");
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice(null);
    setBusy(true);
    try {
      await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ plan_id: Number(planId), title, due_date: selected, priority: 2, tags: [], estimated_minutes: minutes }),
      });
      setTitle("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "추가하지 못했어요");
    } finally {
      setBusy(false);
    }
  }

  const row = (t: Task, late = false) =>
    editingId === t.id ? (
      <li key={t.id} className="editing">
        <TaskForm plans={plans} initial={t} submitLabel="수정 저장" onSubmit={update(t.id)} onCancel={() => setEditingId(null)} />
      </li>
    ) : (
      <li key={t.id} className={t.status === "done" ? "done" : ""}>
        <button
          type="button"
          className={`check${t.status === "done" ? " on" : ""}`}
          aria-label={t.status === "done" ? `${t.title} 완료 취소` : `${t.title} 완료 처리`}
          onClick={() => toggle(t)}
        >
          {t.status === "done" ? "✓" : ""}
        </button>
        <span className="day-task-text">
          {t.title}
          <span className="muted"> · {t.plan_title}{late && t.due_date ? ` · ${t.due_date} 마감` : ""}</span>
          <span className="row-actions">
            <Link href={`/records?task=${t.id}`} className="mini-link">기록</Link>
            <button type="button" className="mini-btn" onClick={() => { setNotice(null); setEditingId(t.id); }}>수정</button>
            <button type="button" className="mini-btn danger" onClick={() => remove(t)}>삭제</button>
          </span>
        </span>
      </li>
    );

  return (
    <section className="card">
      <h2>{Number(selected.slice(5, 7))}월 {Number(selected.slice(8))}일 ({weekdayOf(selected)}){selected === today ? " · 오늘" : ""}</h2>

      {notice && (
        <p className="inline-note">
          &quot;{notice.title}&quot; 완료! 한 일을 기록으로 남길까요? <Link href={`/records?task=${notice.id}`}>실행 기록 남기기 →</Link>
        </p>
      )}
      {error && <p className="error">{error}</p>}

      {overdue.length > 0 && (
        <>
          <h3 className="sub late-title">기한이 지난 할 일 {overdue.length}개</h3>
          <ul className="day-tasks">{overdue.map((t) => row(t, true))}</ul>
        </>
      )}

      <h3 className="sub">이 날 마감 {due.length}개</h3>
      {due.length === 0
        ? <p className="muted">마감인 할 일이 없어요. 아래에서 바로 추가할 수 있어요.</p>
        : <ul className="day-tasks">{due.map((t) => row(t))}</ul>}

      <h3 className="sub">이 날짜로 할 일 추가</h3>
      {choices.length === 0 ? (
        <p className="muted">할 일을 담을 계획이 아직 없어요. 아래에서 계획을 먼저 등록해 주세요.</p>
      ) : (
        <form className="quick-add" onSubmit={add}>
          <select value={planId} onChange={(e) => setPlanPick(e.target.value)} aria-label="계획">
            {choices.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
          <input value={title} required maxLength={200} placeholder="할 일 (예: 단어 20개 외우기)" aria-label="할 일 제목" onChange={(e) => setTitle(e.target.value)} />
          <div className="row">
            <label className="inline-label">예상
              <input type="number" min={0} max={100000} step={5} value={minutes} aria-label="예상 시간(분)" onChange={(e) => setMinutes(Number(e.target.value))} style={{ width: 84 }} />
              분
            </label>
            <button disabled={busy || !planId}>{busy ? "추가 중…" : "추가"}</button>
          </div>
        </form>
      )}

      <h3 className="sub">진행 중인 계획 {active.length}개</h3>
      {active.length === 0 ? (
        <p className="muted">이 날짜에 진행 중인 계획이 없어요.</p>
      ) : (
        <ul className="day-list">
          {active.map((p) => (
            <li key={p.id}>
              <Link href={`/plans/${p.id}`}>{p.title}</Link>
              <span className={`badge p${p.priority}`}>우선순위 {PRIORITY[p.priority]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
