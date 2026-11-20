"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, dateTime, minutes } from "@/lib/format";
import type { Plan, PlanInput, Retro, RetroNote, RetroTask } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import PlanForm from "../PlanForm";

type Metric = "tasks" | "done" | "late" | "blocked" | "estimated" | "actual" | "diff";

const METRIC_TITLE: Record<Metric, string> = {
  tasks: "계획(할 일) 수의 근거: 삭제되지 않은 할 일 전체",
  done: "완료 수의 근거: 현재 완료 상태인 할 일",
  late: "지연 수의 근거: 미완료이면서 마감일이 오늘(한국 시간)보다 앞선 할 일",
  blocked: "막힘 수의 근거: 막힘 사유가 기록된 할 일과 그 실행 기록",
  estimated: "예상 시간의 근거: 대상 할 일의 예상 시간 (할 일별)",
  actual: "실제 시간의 근거: 대상 할 일의 실행 기록 전체",
  diff: "차이(실제 − 예상)의 근거: 할 일별 예상 vs 실제",
};

const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const isMetric = (value: string | null): value is Metric =>
  value === "tasks" || value === "done" || value === "late" || value === "blocked" || value === "estimated" || value === "actual" || value === "diff";

// 주소의 plan·from·to·metric 값(예: 진행 방향에서 숫자를 눌러 이동)으로 화면을 시작한다.
// 주소가 바뀌면 key 가 바뀌어 화면이 새로 만들어지므로, 효과(useEffect) 안에서 상태를 맞춰 줄 필요가 없다.
export default function RetroView() {
  const search = useSearchParams();
  const requested = search.get("metric");
  return (
    <RetroBody
      key={search.toString()}
      initial={{ plan: search.get("plan") ?? "", from: search.get("from") ?? "", to: search.get("to") ?? "", metric: isMetric(requested) ? requested : null }}
    />
  );
}

function RetroBody({ initial }: { initial: { plan: string; from: string; to: string; metric: Metric | null } }) {
  const [plan, setPlan] = useState(initial.plan);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [metric, setMetric] = useState<Metric | null>(initial.metric);
  const evidenceRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!metric) return;
    const frame = requestAnimationFrame(() => evidenceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [metric]);

  const params = new URLSearchParams();
  if (plan) params.set("plan", plan);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const { data: retro, error, reload } = useApi<Retro>(`/api/retro?${params}`);
  const { data: plans, reload: reloadPlans } = useApi<Plan[]>("/api/plans");
  const { data: notes, reload: reloadNotes } = useApi<RetroNote[]>("/api/retro-notes");

  const [noteText, setNoteText] = useState("");
  const [notePlan, setNotePlan] = useState("");
  const [noteError, setNoteError] = useState("");
  const [makingFor, setMakingFor] = useState<number | null>(null);

  function pick(m: Metric) {
    setMetric(m);
    // 집계 값을 누르면 그 값의 근거 기록 영역으로 이동 (T06-C83)
    setTimeout(() => evidenceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    setNoteError("");
    try {
      await api("/api/retro-notes", { method: "POST", body: JSON.stringify({ plan_id: Number(notePlan || plan), improvement: noteText }) });
      setNoteText("");
      reloadNotes();
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : "저장 실패");
    }
  }

  async function makeNext(n: RetroNote, v: PlanInput) {
    await api(`/api/retro-notes/${n.id}/next-plan`, { method: "POST", body: JSON.stringify(v) });
    setMakingFor(null);
    reloadNotes(); reloadPlans(); reload();
  }

  const totals = retro?.totals;
  const empty = totals?.task_count === 0;

  let evTasks: RetroTask[] = [];
  if (retro && metric) {
    evTasks = retro.tasks.filter((t) =>
      metric === "done" ? t.status === "done" : metric === "late" ? t.late : metric === "blocked" ? t.blocked : true);
  }
  const evExecs = !retro || !metric ? [] : metric === "actual" ? retro.executions
    : metric === "blocked" ? retro.executions.filter((e) => e.blocker && evTasks.some((t) => t.id === e.task_id)) : [];

  const cards: { key: Metric; label: string; value: string; hint?: string; tone?: string }[] = totals ? [
    { key: "tasks", label: "계획(할 일) 수", value: `${totals.task_count}개` },
    { key: "done", label: "완료 수", value: `${totals.done_count}개`, hint: totals.task_count ? `완료율 ${Math.round((totals.done_count / totals.task_count) * 100)}%` : undefined },
    { key: "late", label: "지연 수", value: `${totals.late_count}개`, tone: totals.late_count ? "bad" : undefined },
    { key: "blocked", label: "막힘 수", value: `${totals.blocked_count}개`, tone: totals.blocked_count ? "bad" : undefined },
    { key: "estimated", label: "예상 시간", value: minutes(totals.estimated_minutes) },
    { key: "actual", label: "실제 시간", value: minutes(totals.actual_minutes) },
    { key: "diff", label: "차이 (실제 − 예상)", value: `${signed(totals.diff_minutes)}분`,
      hint: totals.diff_minutes > 0 ? "예상보다 더 걸렸어요" : totals.diff_minutes < 0 ? "예상보다 덜 걸렸어요 (또는 아직 기록 전)" : "예상과 같아요",
      tone: totals.diff_minutes > 0 ? "bad" : undefined },
  ] : [];

  return (
    <>
      <h1>회고</h1>
      <p className="muted" style={{ margin: "-8px 4px 16px" }}>
        숫자만 보지 말고, 숫자를 누르면 그 값이 어떤 기록에서 나왔는지 바로 볼 수 있어요.
      </p>

      <section className="card">
        <div className="grid">
          <label>계획
            <select value={plan} onChange={(e) => { setPlan(e.target.value); setMetric(null); }}>
              <option value="">전체 계획</option>
              {plans?.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
          <label>마감일 기간 (시작)
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setMetric(null); }} />
          </label>
          <label>마감일 기간 (끝)
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setMetric(null); }} />
          </label>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          기간을 비우면 전체. 기간은 할 일의 마감일 기준이며, 마감일이 없는 할 일은 기간을 정하지 않았을 때만 포함돼요.
          지연은 한국 시간 기준 오늘({retro?.today ?? "-"})보다 마감이 앞선 미완료 할 일입니다.
        </p>
      </section>

      {error && <p className="error">{error}</p>}
      {!retro && !error && <p className="muted">불러오는 중…</p>}
      {empty && <p className="muted" style={{ margin: "0 4px 12px" }}>선택한 조건에 해당하는 할 일이 없어 모든 값이 0입니다.</p>}

      {totals && (
        <div className="metric-grid">
          {cards.map((c) => (
            <button key={c.key} type="button" className={`metric${metric === c.key ? " on" : ""}${c.tone ? ` ${c.tone}` : ""}`} onClick={() => pick(c.key)}>
              <span className="metric-label">{c.label}</span>
              <span className="metric-value">{c.value}</span>
              <span className="metric-hint">{c.hint ?? "근거 보기 →"}</span>
            </button>
          ))}
        </div>
      )}

      <section className="card" ref={evidenceRef} style={{ scrollMarginTop: 80 }}>
        <h2>근거 기록</h2>
        {!metric && <p className="muted">위 숫자 중 하나를 눌러 보세요.</p>}
        {metric && retro && (
          <>
            <p className="muted" style={{ marginBottom: 10 }}>{METRIC_TITLE[metric]} · {metric === "actual" ? `실행 기록 ${evExecs.length}건` : `할 일 ${evTasks.length}개`}</p>
            {metric !== "actual" && (evTasks.length === 0 ? <p className="muted">해당하는 기록이 없습니다.</p> : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>할 일</th><th>계획</th><th>마감</th><th>상태</th><th>예상</th><th>실제</th><th>차이</th><th></th></tr>
                  </thead>
                  <tbody>
                    {evTasks.map((t) => (
                      <tr key={t.id}>
                        <td>{t.title}{t.late && <span className="badge p1" style={{ marginLeft: 6 }}>지연</span>}{t.blocked && <span className="badge p3" style={{ marginLeft: 6 }}>막힘</span>}</td>
                        <td><Link href={`/plans/${t.plan_id}`}>{t.plan_title}</Link></td>
                        <td>{t.due_date ?? "-"}</td>
                        <td>{t.status === "done" ? "완료" : "진행 중"}</td>
                        <td>{t.estimated_minutes}분</td>
                        <td>{t.actual_minutes}분 ({t.exec_count}회)</td>
                        <td>{signed(t.actual_minutes - t.estimated_minutes)}분</td>
                        <td><Link href={`/records?task=${t.id}`}>기록 →</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {(metric === "actual" || metric === "blocked") && (
              <>
                <h3 className="sub">{metric === "blocked" ? "막힘 사유가 적힌 실행 기록" : "실행 기록"}</h3>
                {evExecs.length === 0 ? <p className="muted">해당하는 실행 기록이 없습니다.</p> : (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>할 일</th><th>시작</th><th>종료</th><th>실제 소요</th><th>막힘 사유</th></tr></thead>
                      <tbody>
                        {evExecs.map((e) => (
                          <tr key={e.id}>
                            <td><Link href={`/records?task=${e.task_id}`}>{e.task_title}</Link></td>
                            <td>{dateTime(e.started_at)}</td>
                            <td>{dateTime(e.ended_at)}</td>
                            <td>{minutes(e.actual_minutes)}</td>
                            <td className="pre">{e.blocker ?? "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2>개선점 한 줄 → 다음 계획</h2>
        <form onSubmit={addNote}>
          <label>어느 계획의 회고인가요?
            <select value={notePlan || plan} required onChange={(e) => setNotePlan(e.target.value)}>
              <option value="">계획을 고르세요</option>
              {plans?.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
          <label style={{ marginTop: 10 }}>이번 회고에서 다음에 바꿀 점 (한 줄)
            <input value={noteText} maxLength={500} required placeholder="예: 막힘이 많은 작업은 20분 단위로 쪼갠다" onChange={(e) => setNoteText(e.target.value)} />
          </label>
          {noteError && <p className="error">{noteError}</p>}
          <div className="row" style={{ marginTop: 10 }}><button>개선점 저장</button></div>
        </form>

        {notes && notes.length > 0 && (
          <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
            {notes.map((n) => {
              const src = plans?.find((p) => p.id === n.plan_id);
              return (
                <div key={n.id} className="note">
                  <div><strong>{n.improvement}</strong></div>
                  <div className="muted">{n.plan_title} 회고 · {dateTime(n.created_at)}</div>
                  {n.next_plan_id ? (
                    <div style={{ marginTop: 6 }}>
                      <span className="badge">다음 계획에 반영됨</span>{" "}
                      <Link href={`/plans/${n.next_plan_id}`}>{n.next_plan_title} →</Link>
                    </div>
                  ) : makingFor === n.id && src ? (
                    <div style={{ marginTop: 10 }}>
                      <PlanForm
                        submitLabel="다음 계획 만들기"
                        initial={{
                          title: `${src.title} (다음)`,
                          start_date: addDays(src.end_date, 1),
                          end_date: addDays(src.end_date, 28),
                          priority: src.priority,
                          success_criteria: `[개선] ${n.improvement}\n${src.success_criteria}`,
                          estimated_minutes: src.estimated_minutes,
                        }}
                        onSubmit={(v) => makeNext(n, v)}
                        onCancel={() => setMakingFor(null)}
                      />
                    </div>
                  ) : (
                    <div style={{ marginTop: 6 }}><button type="button" className="ghost" onClick={() => setMakingFor(n.id)}>이 개선점으로 다음 계획 만들기</button></div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
