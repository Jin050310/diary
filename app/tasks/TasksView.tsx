"use client";
import Link from "next/link";
import { useDeferredValue, useState, useSyncExternalStore } from "react";
import { api, dueLabel, kstToday, noopSubscribe, PRIORITY, shortMin } from "@/lib/format";
import { toggleTask } from "@/lib/taskActions";
import type { Plan, Task, TaskInput } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { Chips, PageHead } from "../ui";
import TaskForm from "./TaskForm";

type View = "open" | "all" | "today" | "overdue" | "done" | "nodue";
// 화면의 한 줄 선택(칩)이 서버의 상태·마감 조건으로 바뀐다. 필터·정렬은 서버(SQL)에서 처리한다.
const VIEW_PARAMS: Record<View, { status: string; due: string }> = {
  open: { status: "todo", due: "all" },
  all: { status: "all", due: "all" },
  today: { status: "all", due: "today" },
  overdue: { status: "all", due: "overdue" },
  done: { status: "done", due: "all" },
  nodue: { status: "all", due: "none" },
};

const SORT_LABEL: Record<string, Record<"asc" | "desc", string>> = {
  due: { asc: "마감일 빠른 순 (마감 없음은 맨 뒤)", desc: "마감일 늦은 순 (마감 없음은 맨 뒤)" },
  priority: { asc: "우선순위 높은 순", desc: "우선순위 낮은 순" },
  created: { asc: "등록 오래된 순", desc: "최근 등록 순" },
  estimate: { asc: "예상 시간 짧은 순", desc: "예상 시간 긴 순" },
  title: { asc: "제목 가나다 순", desc: "제목 가나다 역순" },
};

export default function TasksView() {
  const today = useSyncExternalStore(noopSubscribe, kstToday, () => null);
  const [view, setView] = useState<View>("open");
  const [q, setQ] = useState("");
  const [plan, setPlan] = useState("");
  const [priority, setPriority] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState("due");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState<{ id: number; title: string } | null>(null);
  const deferredQ = useDeferredValue(q);

  const { status, due } = VIEW_PARAMS[view];
  const params = new URLSearchParams({ status, due, sort, dir });
  if (deferredQ.trim()) params.set("q", deferredQ.trim());
  if (plan) params.set("plan", plan);
  if (priority) params.set("priority", priority);
  if (tag) params.set("tag", tag);

  const { data: tasks, error, reload } = useApi<Task[]>(`/api/tasks?${params}`);
  const { data: all, reload: reloadAll } = useApi<Task[]>("/api/tasks"); // 칩 옆 개수·태그 목록용
  const { data: plans } = useApi<Plan[]>("/api/plans");

  const allTags = [...new Set((all ?? []).flatMap((t) => t.tags))].sort();
  const refresh = () => { reload(); reloadAll(); };

  const counts = all && today ? {
    open: all.filter((t) => t.status === "todo").length,
    all: all.length,
    today: all.filter((t) => t.due_date === today).length,
    overdue: all.filter((t) => t.status === "todo" && t.due_date && t.due_date < today).length,
    done: all.filter((t) => t.status === "done").length,
    nodue: all.filter((t) => !t.due_date).length,
  } : null;

  async function run(fn: () => Promise<unknown>) {
    setActionError("");
    try { await fn(); refresh(); } catch (e) { setActionError(e instanceof Error ? e.message : "처리하지 못했어요"); }
  }
  const create = (v: TaskInput) => api("/api/tasks", { method: "POST", body: JSON.stringify(v) }).then(() => { setShowNew(false); refresh(); });
  const update = (id: number) => async (v: TaskInput) => {
    await api(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(v) });
    setEditingId(null);
    refresh();
  };
  // 완료: 클릭마다 새 키를 만들지만, 서버가 "할 일당 유효한 완료 1건"을 DB 제약으로 보장한다. (lib/taskActions.ts)
  const toggle = (t: Task) => run(async () => {
    await toggleTask(t);
    setNotice(t.status === "todo" ? { id: t.id, title: t.title } : null); // 완료하면 바로 기록 남기기로 이어지게 안내
  });
  const remove = (t: Task) => {
    if (window.confirm(`"${t.title}" 할 일을 삭제할까요?`)) run(() => api(`/api/tasks/${t.id}`, { method: "DELETE" }));
  };

  const filtered = view !== "open" || !!(q.trim() || plan || priority || tag);
  const reset = () => { setView("open"); setQ(""); setPlan(""); setPriority(""); setTag(""); };

  return (
    <>
      <PageHead title="할 일" hint="끝낸 일은 동그라미를 눌러 체크하고, 한 일은 '기록하기'로 시간을 남겨요.">
        <button type="button" onClick={() => setShowNew((v) => !v)}>{showNew ? "닫기" : "+ 새 할 일"}</button>
      </PageHead>

      {showNew && (
        <section className="card">
          <h2>새 할 일</h2>
          {plans && plans.length > 0
            ? <TaskForm plans={plans} defaultPlanId={plan ? Number(plan) : undefined} submitLabel="할 일 저장" onSubmit={create} onCancel={() => setShowNew(false)} />
            : <p className="muted">먼저 달력 화면에서 프로젝트를 만들어 주세요.</p>}
        </section>
      )}

      <section className="card filter-card">
        <input type="search" value={q} placeholder="🔍 할 일 검색 (제목·태그)" aria-label="할 일 검색" onChange={(e) => setQ(e.target.value)} />
        <Chips<View>
          label="보기"
          value={view}
          onChange={setView}
          options={[
            { value: "open", label: "진행 중", count: counts?.open },
            { value: "today", label: "오늘", count: counts?.today },
            { value: "overdue", label: "기한 지남", count: counts?.overdue },
            { value: "done", label: "완료", count: counts?.done },
            { value: "all", label: "전체", count: counts?.all },
            { value: "nodue", label: "마감 없음", count: counts?.nodue },
          ]}
        />
        <div className="filter-row">
          <label className="inline-select">프로젝트
            <select value={plan} onChange={(e) => setPlan(e.target.value)}>
              <option value="">전체</option>
              {plans?.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
          <details className="more-filters">
            <summary>자세히 (우선순위·태그·정렬)</summary>
            <div className="grid filters">
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
          </details>
        </div>
        {/* 정렬 기준을 화면에 항상 글자로 표시 (T06-C20) */}
        <div className="sort-line">
          <span data-testid="sort-basis">정렬 기준: <strong>{SORT_LABEL[sort][dir]}</strong> · 같은 값이면 등록 번호(#) 순</span>
          {filtered && <button type="button" className="ghost" onClick={reset}>조건 초기화</button>}
        </div>
      </section>

      {notice && (
        <p className="inline-note">
          &quot;{notice.title}&quot; 완료! 한 일을 기록으로 남길까요? <Link href={`/records?task=${notice.id}`}>실행 기록 남기기 →</Link>
        </p>
      )}
      {(error || actionError) && <p className="error">{error || actionError}</p>}
      {tasks === null && !error && <p className="muted">불러오는 중…</p>}

      {tasks && (
        <section className="card task-list-card">
          <p className="list-count">{filtered ? `조건에 맞는 할 일 ${tasks.length}개` : `해야 할 일 ${tasks.length}개`}</p>
          {tasks.length === 0 ? (
            <p className="muted empty">
              {filtered ? "조건에 맞는 할 일이 없어요. 위의 '조건 초기화'를 눌러 보세요." : "해야 할 일이 없어요 🎉 오른쪽 위 '+ 새 할 일'로 추가해 보세요."}
            </p>
          ) : (
            <ul className="trow-list">
              {tasks.map((t) => {
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
                    <button
                      type="button"
                      className={`check${t.status === "done" ? " on" : ""}`}
                      aria-label={t.status === "done" ? `${t.title} 완료 취소` : `${t.title} 완료 처리`}
                      onClick={() => toggle(t)}
                    >
                      {t.status === "done" ? "✓" : ""}
                    </button>
                    <div className="t-main">
                      <div className="t-title">
                        {t.title}
                        {t.priority === 1 && <span className="badge p1" style={{ marginLeft: 8 }}>우선순위 {PRIORITY[1]}</span>}
                      </div>
                      <div className="t-sub">
                        <Link href={`/plans/${t.plan_id}`}>{t.plan_title}</Link>
                        <span className={dl.tone === "late" ? "due-late" : dl.tone === "soon" ? "due-soon" : ""}>{dl.text}</span>
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
              })}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
