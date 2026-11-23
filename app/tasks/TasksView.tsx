"use client";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { api, daysBetween, dueLabel, kstToday, mdKo, noopSubscribe, PRIORITY, shortMin } from "@/lib/format";
import { toggleTask } from "@/lib/taskActions";
import type { Plan, Task, TaskInput } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { PageHead } from "../ui";
import TaskForm from "./TaskForm";

const SOON_DAYS = 7; // 오늘부터 며칠 앞까지를 "다가오는 할 일"로 바로 보여 줄지 (그 뒤는 접어 둔다)

// 검색·필터 칸은 없앴다. 화면이 알아서 나눠 보여 준다:
//  ① 오늘 할 일(맨 위)  ② 앞으로 7일 안의 할 일(날짜별)  ③ 기한 지난 할 일(접어서)  ④ 그 이후 할 일(접어서)  ⑤ 끝낸 일(접어서)
// (서버의 검색·필터·정렬 기능은 그대로 있다: /api/tasks?q=&status=&due=&sort= )
export default function TasksView() {
  const today = useSyncExternalStore(noopSubscribe, kstToday, () => null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState<{ id: number; title: string } | null>(null);

  const { data: tasks, error, reload } = useApi<Task[]>("/api/tasks?sort=due");
  const { data: plans } = useApi<Plan[]>("/api/plans");

  async function run(fn: () => Promise<unknown>) {
    setActionError("");
    try { await fn(); reload(); } catch (e) { setActionError(e instanceof Error ? e.message : "처리하지 못했어요"); }
  }
  const create = (v: TaskInput) => api("/api/tasks", { method: "POST", body: JSON.stringify(v) }).then(() => { setShowNew(false); reload(); });
  const update = (id: number) => async (v: TaskInput) => {
    await api(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(v) });
    setEditingId(null);
    reload();
  };
  // 완료: 클릭마다 새 키를 만들지만, 서버가 "할 일당 유효한 완료 1건"을 DB 제약으로 보장한다. (lib/taskActions.ts)
  const toggle = (t: Task) => run(async () => {
    await toggleTask(t);
    setNotice(t.status === "todo" ? { id: t.id, title: t.title } : null); // 완료하면 바로 기록 남기기로 이어지게 안내
  });
  const remove = (t: Task) => {
    if (window.confirm(`"${t.title}" 할 일을 삭제할까요?`)) run(() => api(`/api/tasks/${t.id}`, { method: "DELETE" }));
  };

  // 한 줄: 동그라미(완료) · 제목/프로젝트/시간 · 기록하기·수정·삭제
  const row = (t: Task, showDue: boolean) => {
    if (editingId === t.id && plans) {
      return (
        <li key={t.id} className="trow editing">
          <TaskForm plans={plans} initial={t} submitLabel="수정 저장" onSubmit={update(t.id)} onCancel={() => setEditingId(null)} />
        </li>
      );
    }
    const dl = dueLabel(t.due_date, today, t.status === "todo");
    return (
      <li key={t.id} className={`trow${t.status === "done" ? " done" : ""}`}>
        <button type="button" className={`check${t.status === "done" ? " on" : ""}`}
          aria-label={t.status === "done" ? `${t.title} 완료 취소` : `${t.title} 완료 처리`} onClick={() => toggle(t)}>
          {t.status === "done" ? "✓" : ""}
        </button>
        <div className="t-main">
          <div className="t-title">
            {t.title}
            {t.priority === 1 && <span className="badge p1" style={{ marginLeft: 8 }}>우선순위 {PRIORITY[1]}</span>}
          </div>
          <div className="t-sub">
            <Link href={`/plans/${t.plan_id}`}>{t.plan_title}</Link>
            {showDue && <span className={dl.tone === "late" ? "due-late" : dl.tone === "soon" ? "due-soon" : ""}>{dl.text}</span>}
            <span>예상 {shortMin(t.estimated_minutes)}</span>
            {(t.exec_count ?? 0) > 0 && <span>기록 {t.exec_count}회 · 실제 {shortMin(t.actual_minutes)}</span>}
            {t.tags.length > 0 && <span className="t-tags">{t.tags.map((x) => <span key={x} className="tag-mini">{x}</span>)}</span>}
          </div>
        </div>
        <div className="t-actions">
          <Link href={`/records?task=${t.id}`} className="btn-link">기록하기</Link>
          <button type="button" className="mini-btn" onClick={() => setEditingId(t.id)}>수정</button>
          <button type="button" className="mini-btn danger" onClick={() => remove(t)}>삭제</button>
        </div>
      </li>
    );
  };

  // 날짜별 묶음(제목에 날짜가 있으므로 줄마다 마감을 반복하지 않는다)
  const groups = (items: Task[]) => groupByDue(items, today).map((g) => (
    <div key={g.key} className="date-group">
      <h3 className={`date-head${g.tone ? ` ${g.tone}` : ""}`}>{g.label}<span className="date-count">{g.items.length}개</span></h3>
      <ul className="trow-list">{g.items.map((t) => row(t, false))}</ul>
    </div>
  ));

  const list = tasks ?? [];
  const todayList = today ? list.filter((t) => t.due_date === today) : [];
  const overdue = today ? list.filter((t) => t.status === "todo" && t.due_date && t.due_date < today) : [];
  const open = today ? list.filter((t) => t.status === "todo" && (!t.due_date || t.due_date > today)) : [];
  const soon = today ? open.filter((t) => t.due_date && daysBetween(today, t.due_date) <= SOON_DAYS) : [];
  const later = today ? open.filter((t) => !t.due_date || daysBetween(today, t.due_date) > SOON_DAYS) : [];
  const done = today ? list.filter((t) => t.status === "done" && t.due_date !== today) : [];
  const todayDone = todayList.filter((t) => t.status === "done").length;

  return (
    <>
      <PageHead title="할 일" hint="오늘 할 일이 맨 위에 있어요. 끝낸 일은 동그라미를 눌러 체크하고, 한 일은 '기록하기'로 시간을 남겨요.">
        <button type="button" onClick={() => setShowNew((v) => !v)}>{showNew ? "닫기" : "+ 새 할 일"}</button>
      </PageHead>

      {showNew && (
        <section className="card">
          <h2>새 할 일</h2>
          {plans && plans.length > 0
            ? <TaskForm plans={plans} submitLabel="할 일 저장" onSubmit={create} onCancel={() => setShowNew(false)} />
            : <p className="muted">먼저 달력 화면에서 프로젝트를 만들어 주세요.</p>}
        </section>
      )}

      {notice && (
        <p className="inline-note">
          &quot;{notice.title}&quot; 완료! 한 일을 기록으로 남길까요? <Link href={`/records?task=${notice.id}`}>실행 기록 남기기 →</Link>
        </p>
      )}
      {(error || actionError) && <p className="error">{error || actionError}</p>}
      {tasks === null && !error && <p className="muted">불러오는 중…</p>}

      {tasks && today && (
        <>
          {/* ① 오늘 */}
          <section className="card today-card">
            <div className="rec-top">
              <h2>오늘 · {mdKo(today)}</h2>
              <span className="muted">{todayList.length > 0 ? `${todayList.length}개 중 ${todayDone}개 끝냈어요` : ""}</span>
            </div>
            {todayList.length === 0
              ? <p className="muted empty">오늘 마감인 할 일이 없어요. 아래 &quot;다가오는 할 일&quot;에서 이어서 해 보세요.</p>
              : <ul className="trow-list">{todayList.map((t) => row(t, false))}</ul>}
          </section>

          {/* ② 기한 지난 것은 따로 접어 둔다 */}
          {overdue.length > 0 && (
            <details className="acc overdue-acc">
              <summary><span>기한 지난 할 일 <span className="acc-hint late">{overdue.length}개 · 눌러서 열기</span></span></summary>
              <div className="acc-body">{groups(overdue)}</div>
            </details>
          )}

          {/* ③ 앞으로 7일 */}
          <section className="card">
            <h2>다가오는 할 일 <span className="muted">(앞으로 {SOON_DAYS}일)</span></h2>
            {soon.length === 0 ? <p className="muted empty">앞으로 {SOON_DAYS}일 안에 마감인 할 일이 없어요.</p> : groups(soon)}
          </section>

          {later.length > 0 && (
            <details className="acc">
              <summary><span>그 이후 할 일 <span className="acc-hint">{later.length}개</span></span></summary>
              <div className="acc-body">{groups(later)}</div>
            </details>
          )}

          {done.length > 0 && (
            <details className="acc">
              <summary><span>끝낸 일 <span className="acc-hint">{done.length}개</span></span></summary>
              <div className="acc-body"><ul className="trow-list">{done.map((t) => row(t, true))}</ul></div>
            </details>
          )}
        </>
      )}
    </>
  );
}

// 마감일 순으로 이미 정렬된 목록에서, 이웃한 같은 날짜끼리 묶는다.
type Section = { key: string; label: string; tone: "" | "late" | "today"; items: Task[] };
function groupByDue(tasks: Task[], today: string | null): Section[] {
  const out: Section[] = [];
  for (const t of tasks) {
    const key = t.due_date ?? "none";
    let g = out[out.length - 1];
    if (!g || g.key !== key) { g = { key, label: "", tone: "", items: [] }; out.push(g); }
    g.items.push(t);
  }
  for (const g of out) {
    const due = g.key === "none" ? null : g.key;
    if (!due) { g.label = "마감 없음"; continue; }
    if (!today) { g.label = mdKo(due); continue; }
    const d = daysBetween(today, due);
    const open = g.items.some((t) => t.status === "todo");
    if (d === 0) { g.label = `오늘 · ${mdKo(due)}`; g.tone = "today"; }
    else if (d === 1) g.label = `내일 · ${mdKo(due)}`;
    else if (d < 0 && open) { g.label = `${-d}일 지남 · ${mdKo(due)}`; g.tone = "late"; }
    else g.label = mdKo(due);
  }
  return out;
}
