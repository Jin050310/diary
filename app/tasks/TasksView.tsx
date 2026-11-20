"use client";
import Link from "next/link";
import { useDeferredValue, useState, useSyncExternalStore } from "react";
import { api, kstToday, minutes, noopSubscribe, PRIORITY } from "@/lib/format";
import type { Plan, Task, TaskInput } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import TaskForm from "./TaskForm";

const SORT_LABEL: Record<string, Record<"asc" | "desc", string>> = {
  due: { asc: "마감일 빠른 순 (마감 없음은 맨 뒤)", desc: "마감일 늦은 순 (마감 없음은 맨 뒤)" },
  priority: { asc: "우선순위 높은 순", desc: "우선순위 낮은 순" },
  created: { asc: "등록 오래된 순", desc: "최근 등록 순" },
  estimate: { asc: "예상 시간 짧은 순", desc: "예상 시간 긴 순" },
  title: { asc: "제목 가나다 순", desc: "제목 가나다 역순" },
};

export default function TasksView() {
  const today = useSyncExternalStore(noopSubscribe, kstToday, () => null);
  const [q, setQ] = useState("");
  const [plan, setPlan] = useState("");
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("");
  const [tag, setTag] = useState("");
  const [due, setDue] = useState("all");
  const [sort, setSort] = useState("due");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState("");
  const deferredQ = useDeferredValue(q);

  const params = new URLSearchParams({ status, due, sort, dir });
  if (deferredQ.trim()) params.set("q", deferredQ.trim());
  if (plan) params.set("plan", plan);
  if (priority) params.set("priority", priority);
  if (tag) params.set("tag", tag);

  const { data: tasks, error, reload } = useApi<Task[]>(`/api/tasks?${params}`);
  const { data: all, reload: reloadAll } = useApi<Task[]>("/api/tasks"); // 태그 목록·전체 개수용
  const { data: plans } = useApi<Plan[]>("/api/plans");

  const allTags = [...new Set((all ?? []).flatMap((t) => t.tags))].sort();
  const refresh = () => { reload(); reloadAll(); };

  async function run(fn: () => Promise<unknown>) {
    setActionError("");
    try { await fn(); refresh(); } catch (e) { setActionError(e instanceof Error ? e.message : "처리 실패"); }
  }
  const create = (v: TaskInput) => api("/api/tasks", { method: "POST", body: JSON.stringify(v) }).then(refresh);
  const update = (id: number) => async (v: TaskInput) => {
    await api(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(v) });
    setEditingId(null);
    refresh();
  };
  // 완료: 클릭마다 새 키를 만들지만, 서버가 "할 일당 유효한 완료 1건"을 DB 제약으로 보장한다.
  const toggle = (t: Task) => run(() =>
    t.status === "done"
      ? api(`/api/tasks/${t.id}/complete`, { method: "DELETE" })
      : api(`/api/tasks/${t.id}/complete`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } }));
  const remove = (t: Task) => {
    if (window.confirm(`"${t.title}" 할 일을 삭제할까요?`)) run(() => api(`/api/tasks/${t.id}`, { method: "DELETE" }));
  };

  const filtered = q.trim() || plan || status !== "all" || priority || tag || due !== "all";
  const reset = () => { setQ(""); setPlan(""); setStatus("all"); setPriority(""); setTag(""); setDue("all"); };

  return (
    <>
      <h1>할 일</h1>

      <details className="card">
        <summary><strong>+ 새 할 일 등록</strong></summary>
        <div style={{ marginTop: 12 }}>
          {plans && plans.length > 0
            ? <TaskForm plans={plans} defaultPlanId={plan ? Number(plan) : undefined} submitLabel="할 일 저장" onSubmit={create} />
            : <p className="muted">먼저 계획을 등록하세요.</p>}
        </div>
      </details>

      <section className="card">
        <div className="grid filters">
          <label>검색 (제목·태그)
            <input value={q} placeholder="예: 단어" onChange={(e) => setQ(e.target.value)} />
          </label>
          <label>계획
            <select value={plan} onChange={(e) => setPlan(e.target.value)}>
              <option value="">전체</option>
              {plans?.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
          <label>상태
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">전체</option>
              <option value="todo">진행 중</option>
              <option value="done">완료</option>
            </select>
          </label>
          <label>우선순위
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="">전체</option>
              <option value="1">높음</option>
              <option value="2">중간</option>
              <option value="3">낮음</option>
            </select>
          </label>
          <label>태그
            <select value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">전체</option>
              {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label>마감
            <select value={due} onChange={(e) => setDue(e.target.value)}>
              <option value="all">전체</option>
              <option value="overdue">기한 지남 (진행 중)</option>
              <option value="today">오늘</option>
              <option value="none">마감일 없음</option>
            </select>
          </label>
          <label>정렬 기준
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="due">마감일</option>
              <option value="priority">우선순위</option>
              <option value="created">등록순</option>
              <option value="estimate">예상 시간</option>
              <option value="title">제목</option>
            </select>
          </label>
          <label>정렬 방향
            <select value={dir} onChange={(e) => setDir(e.target.value as "asc" | "desc")}>
              <option value="asc">오름차순</option>
              <option value="desc">내림차순</option>
            </select>
          </label>
        </div>
        <div className="row" style={{ marginTop: 12, justifyContent: "space-between" }}>
          {/* 정렬 기준을 화면에 항상 글자로 표시 (T06-C20) */}
          <span className="muted" data-testid="sort-basis">
            정렬 기준: <strong>{SORT_LABEL[sort][dir]}</strong> · 같은 값이면 등록 번호(#) 순
          </span>
          {filtered && <button type="button" className="ghost" onClick={reset}>검색·필터 초기화</button>}
        </div>
      </section>

      {(error || actionError) && <p className="error">{error || actionError}</p>}
      {tasks === null && !error && <p className="muted">불러오는 중…</p>}
      {tasks && (
        <p className="muted" style={{ margin: "0 4px 10px" }}>
          {filtered ? `조건에 맞는 할 일 ${tasks.length}개 (전체 ${all?.length ?? "-"}개)` : `전체 ${tasks.length}개`}
        </p>
      )}
      {tasks?.length === 0 && (
        <p className="muted">{filtered ? "조건에 맞는 할 일이 없습니다." : "아직 할 일이 없습니다. 위에서 등록해 보세요."}</p>
      )}

      <div className="task-list">
        {tasks?.map((t) =>
          editingId === t.id && plans ? (
            <div key={t.id} className="card">
              <TaskForm plans={plans} initial={t} submitLabel="수정 저장" onSubmit={update(t.id)} onCancel={() => setEditingId(null)} />
            </div>
          ) : (
            <div key={t.id} className={`card task${t.status === "done" ? " done" : ""}`}>
              <button
                type="button"
                className={`check${t.status === "done" ? " on" : ""}`}
                aria-label={t.status === "done" ? "완료 취소" : "완료 처리"}
                title={t.status === "done" ? "완료 취소" : "완료 처리"}
                onClick={() => toggle(t)}
              >
                {t.status === "done" ? "✓" : ""}
              </button>
              <div className="task-body">
                <div className="task-title">{t.title}</div>
                <div className="muted task-meta">
                  <Link href={`/plans/${t.plan_id}`}>{t.plan_title}</Link>
                  {" · "}
                  <span className={today && t.due_date && t.status === "todo" && t.due_date < today ? "late" : ""}>
                    {t.due_date ? `마감 ${t.due_date}${today && t.status === "todo" && t.due_date < today ? " (기한 지남)" : ""}` : "마감일 없음"}
                  </span>
                  {" · "}예상 {minutes(t.estimated_minutes)} · #{t.id}
                  {" · "}실행 {t.exec_count ?? 0}회{t.exec_count ? ` (실제 ${minutes(t.actual_minutes)})` : ""}
                </div>
                <div className="row" style={{ marginTop: 6 }}>
                  <span className={`badge p${t.priority}`}>우선순위 {PRIORITY[t.priority]}</span>
                  {t.tags.map((x) => <span key={x} className="badge tag">{x}</span>)}
                </div>
              </div>
              <div className="row task-actions">
                <Link href={`/records?task=${t.id}`} className="btn-link">기록하기</Link>
                <button type="button" className="ghost" onClick={() => setEditingId(t.id)}>수정</button>
                <button type="button" className="danger" onClick={() => remove(t)}>삭제</button>
              </div>
            </div>
          ),
        )}
      </div>
    </>
  );
}
