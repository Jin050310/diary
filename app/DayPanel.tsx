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
  // 간단 실행 기록 (오늘 패널에서만): 걸린 시간 + 막힌 점 한 줄. "방금 끝난 일"로 저장된다.
  const [recId, setRecId] = useState<number | null>(null);
  const [recDur, setRecDur] = useState(30);
  const [recBlocker, setRecBlocker] = useState("");
  const [recBusy, setRecBusy] = useState(false);
  const [recMsg, setRecMsg] = useState("");
  const canQuick = selected === today; // 다른 날짜는 시각을 직접 넣어야 하므로 실행 기록 화면으로 보낸다

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

  // 저장하는 지금 시각에 끝난 것으로, 걸린 시간만큼 전에 시작한 것으로 기록한다. (실행 기록 화면의 "방금 끝났어요"와 같은 방식)
  async function saveRec(t: Task, complete: boolean) {
    setError("");
    setRecMsg("");
    setRecBusy(true);
    try {
      const end = new Date();
      await api("/api/executions", {
        method: "POST",
        body: JSON.stringify({
          task_id: t.id, started_at: new Date(end.getTime() - recDur * 60000).toISOString(), ended_at: end.toISOString(),
          actual_minutes: recDur, blocker: recBlocker.trim() || null,
        }),
      });
      if (complete && t.status === "todo") await toggleTask(t);
      setRecMsg(`"${t.title}" ${shortMin(recDur)} 기록했어요${complete && t.status === "todo" ? " · 완료 처리도 했어요" : ""}`);
      setRecId(null);
      setRecBlocker("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "기록하지 못했어요");
    } finally {
      setRecBusy(false);
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
          {/* 체크해서 줄이 그어져도 "기록"은 누를 수 있다는 게 한눈에 보이도록, 완료한 줄에서는 진한 채움 버튼으로 */}
          {(() => {
            const label = t.status === "done" ? ((t.exec_count ?? 0) > 0 ? "기록 더하기" : "기록 남기기") : "기록";
            const cls = `mini-link${t.status === "done" ? " primary" : ""}`;
            return canQuick
              ? <button type="button" className={cls} aria-expanded={recId === t.id} onClick={() => { setRecMsg(""); setNotice(null); setRecId(recId === t.id ? null : t.id); }}>{label}</button>
              : <Link href={`/records?task=${t.id}`} className={cls}>{label}</Link>;
          })()}
          <button type="button" className="icon-btn" aria-label="더보기" aria-expanded={menuId === t.id} onClick={() => setMenuId(menuId === t.id ? null : t.id)}>⋯</button>
        </div>
        {canQuick && recId === t.id && (
          <div className="quick-rec">
            <div className="chips" role="group" aria-label="걸린 시간">
              {[15, 30, 60, 90, 120].map((m) => (
                <button key={m} type="button" className={`chip${recDur === m ? " on" : ""}`} aria-pressed={recDur === m} onClick={() => setRecDur(m)}>{shortMin(m)}</button>
              ))}
            </div>
            <input value={recBlocker} maxLength={1000} placeholder="막힌 점이 있었다면 한 줄 (없으면 비워 두세요)" aria-label="막힌 점" onChange={(e) => setRecBlocker(e.target.value)} />
            <div className="row">
              <button type="button" disabled={recBusy} onClick={() => saveRec(t, false)}>{recBusy ? "저장 중…" : "기록 저장"}</button>
              {t.status === "todo" && <button type="button" className="ghost" disabled={recBusy} onClick={() => saveRec(t, true)}>저장하고 완료</button>}
              <button type="button" className="ghost" disabled={recBusy} onClick={() => setRecId(null)}>닫기</button>
              <Link href={`/records?task=${t.id}`} className="quick-more">시각 직접 입력 →</Link>
            </div>
            <p className="muted">지금 끝난 것으로, {shortMin(recDur)} 전에 시작한 것으로 기록해요.</p>
          </div>
        )}
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
          &quot;{notice.title}&quot; 완료! 한 일을 기록으로 남길까요?{" "}
          {canQuick
            ? <button type="button" className="linklike" onClick={() => { setRecId(notice.id); setNotice(null); }}>여기서 바로 기록하기 →</button>
            : <Link href={`/records?task=${notice.id}`}>실행 기록 남기기 →</Link>}
        </p>
      )}
      {recMsg && <p className="inline-note">{recMsg} <Link href="/records">실행 기록에서 보기 →</Link></p>}
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
