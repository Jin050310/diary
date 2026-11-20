"use client";
import Link from "next/link";
import { useState } from "react";
import { api, dueLabel, shortMin, weekdayKo } from "@/lib/format";
import { toggleTask } from "@/lib/taskActions";
import type { Plan, Task, TaskInput } from "@/lib/types";
import { ProgressBar } from "./ui";
import TaskForm from "./tasks/TaskForm";

// 달력에서 고른 날짜의 패널: 그날 할 일을 바로 체크하고, 하나 추가하고, 기록으로 이어간다.
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
  const [menuId, setMenuId] = useState<number | null>(null);

  const active = plans.filter((p) => p.start_date <= selected && p.end_date >= selected);
  const due = tasks.filter((t) => t.due_date === selected);
  const doneCount = due.filter((t) => t.status === "done").length;
  const overdue = selected === today ? tasks.filter((t) => t.status === "todo" && t.due_date && t.due_date < today) : [];
  const choices = active.length ? active : plans; // 그날 진행 중인 프로젝트가 있으면 그것들 먼저
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
    setMenuId(null);
    onChanged();
  };

  async function remove(t: Task) {
    if (!window.confirm(`"${t.title}" 할 일을 삭제할까요?`)) return;
    setError("");
    setNotice(null);
    try {
      await api(`/api/tasks/${t.id}`, { method: "DELETE" });
      setMenuId(null);
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

  const row = (t: Task, late = false) => {
    if (editingId === t.id) {
      return (
        <li key={t.id} className="trow editing">
          <TaskForm plans={plans} initial={t} submitLabel="수정 저장" onSubmit={update(t.id)} onCancel={() => setEditingId(null)} />
        </li>
      );
    }
    const dl = dueLabel(t.due_date, today, t.status === "todo");
    return (
      <li key={t.id} className={`trow${t.status === "done" ? " done" : ""}`}>
        <button
          type="button"
          className={`check${t.status === "done" ? " on" : ""}`}
          aria-label={t.status === "done" ? `${t.title} 완료 취소` : `${t.title} 완료 처리`}
          onClick={() => toggle(t)}
        >
          {t.status === "done" ? "✓" : ""}
        </button>
        <div className="t-main">
          <div className="t-title">{t.title}</div>
          <div className="t-sub">
            <span>{t.plan_title}</span>
            {late && <span className="due-late">{dl.text}</span>}
            <span>{shortMin(t.estimated_minutes)}</span>
          </div>
          {menuId === t.id && (
            <div className="t-actions" style={{ marginTop: 8, justifyContent: "flex-start", paddingLeft: 0 }}>
              <button type="button" className="mini-btn" onClick={() => { setNotice(null); setEditingId(t.id); }}>수정</button>
              <button type="button" className="mini-btn danger" onClick={() => remove(t)}>삭제</button>
            </div>
          )}
        </div>
        <div className="t-actions" style={{ paddingLeft: 0, width: "auto" }}>
          <Link href={`/records?task=${t.id}`} className="mini-link">기록</Link>
          <button type="button" className="icon-btn" aria-label="더보기" aria-expanded={menuId === t.id} onClick={() => setMenuId(menuId === t.id ? null : t.id)}>⋯</button>
        </div>
      </li>
    );
  };

  return (
    <section className="card day-panel">
      <div className="day-head">
        <h2>{Number(selected.slice(5, 7))}월 {Number(selected.slice(8))}일 <span className="dow">({weekdayKo(selected)})</span></h2>
        {selected === today && <span className="today-pill">오늘</span>}
      </div>

      {due.length > 0 && (
        <div className="day-progress">
          <span>할 일 {due.length}개 중 <strong>{doneCount}개</strong> 완료</span>
          <ProgressBar value={doneCount} max={due.length} tone={doneCount === due.length ? "ok" : "accent"} />
        </div>
      )}

      {notice && (
        <p className="inline-note">
          &quot;{notice.title}&quot; 완료! 한 일을 기록으로 남길까요? <Link href={`/records?task=${notice.id}`}>실행 기록 남기기 →</Link>
        </p>
      )}
      {error && <p className="error">{error}</p>}

      {overdue.length > 0 && (
        <>
          <h3 className="sub late-title">기한이 지났어요 · {overdue.length}개</h3>
          <ul className="trow-list day-tasks">{overdue.map((t) => row(t, true))}</ul>
        </>
      )}

      <h3 className="sub">{selected === today ? "오늘 할 일" : "이 날 할 일"}</h3>
      {due.length === 0
        ? <p className="muted empty">{selected === today ? "오늘 마감인 할 일이 없어요." : "마감인 할 일이 없어요."} 아래에서 바로 추가할 수 있어요.</p>
        : <ul className="trow-list day-tasks">{due.map((t) => row(t))}</ul>}

      {choices.length === 0 ? (
        <p className="muted empty">할 일을 담을 프로젝트가 아직 없어요. 아래에서 프로젝트를 먼저 만들어 주세요.</p>
      ) : (
        <form className="add-row" onSubmit={add}>
          <input value={title} required maxLength={200} placeholder="이 날 할 일을 적고 Enter (예: 단어 20개 외우기)" aria-label="할 일 제목" onChange={(e) => setTitle(e.target.value)} />
          <div className="add-opts">
            <select value={planId} onChange={(e) => setPlanPick(e.target.value)} aria-label="프로젝트">
              {choices.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
            <label className="inline-label">
              <input type="number" min={0} max={100000} step={5} value={minutes} aria-label="예상 시간(분)" onChange={(e) => setMinutes(Number(e.target.value))} style={{ width: 76 }} />
              분
            </label>
            <button disabled={busy || !planId}>{busy ? "추가 중…" : "추가"}</button>
          </div>
        </form>
      )}
    </section>
  );
}
