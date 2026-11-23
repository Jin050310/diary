"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { addDaysIso, api, dateTime, kstToday, mdKo, noopSubscribe, shortMin } from "@/lib/format";
import type { Plan, PlanInput, Retro, RetroNote, RetroTask } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import PlanForm from "../PlanForm";
import { Chips, PageHead } from "../ui";

type Metric = "tasks" | "done" | "late" | "blocked" | "estimated" | "actual" | "diff";

const METRIC_TITLE: Record<Metric, string> = {
  tasks: "전체 할 일(계획 수)의 근거: 삭제되지 않은 할 일 전체",
  done: "끝낸 일(완료 수)의 근거: 현재 완료 상태인 할 일",
  late: "지연의 근거: 미완료이면서 마감일이 오늘(한국 시간)보다 앞선 할 일",
  blocked: "막힌 일의 근거: 막힘 사유가 기록된 할 일과 그 실행 기록",
  estimated: "예상 시간의 근거: 대상 할 일의 예상 시간 (할 일별)",
  actual: "실제 시간의 근거: 대상 할 일의 실행 기록 전체",
  diff: "차이(실제 − 예상)의 근거: 할 일별 예상 vs 실제",
};

const isMetric = (value: string | null): value is Metric =>
  value === "tasks" || value === "done" || value === "late" || value === "blocked" || value === "estimated" || value === "actual" || value === "diff";
const signedMin = (n: number) => (n > 0 ? `+${shortMin(n)}` : shortMin(n));

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

type Period = "all" | "week" | "month" | "custom";

function RetroBody({ initial }: { initial: { plan: string; from: string; to: string; metric: Metric | null } }) {
  const nowKst = useSyncExternalStore(noopSubscribe, kstToday, () => null);
  const [plan, setPlan] = useState(initial.plan);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [metric, setMetric] = useState<Metric | null>(initial.metric);
  const [showCustom, setShowCustom] = useState(!!(initial.from || initial.to));
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

  // 기간 고르기: 전체 / 최근 7일 / 이번 달 / 직접 정하기
  const today = nowKst ?? "";
  const week = today ? { from: addDaysIso(today, -6), to: today } : null;
  const month = today ? (() => {
    const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
    return { from: `${y}-${String(m).padStart(2, "0")}-01`, to: `${y}-${String(m).padStart(2, "0")}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}` };
  })() : null;
  const period: Period = showCustom ? "custom" : !from && !to ? "all"
    : week && from === week.from && to === week.to ? "week"
    : month && from === month.from && to === month.to ? "month" : "custom";
  function setPeriod(p: Period) {
    setMetric(null);
    if (p === "all") { setShowCustom(false); setFrom(""); setTo(""); }
    else if (p === "week" && week) { setShowCustom(false); setFrom(week.from); setTo(week.to); }
    else if (p === "month" && month) { setShowCustom(false); setFrom(month.from); setTo(month.to); }
    else setShowCustom(true);
  }

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

  // 시간 차이를 사람이 읽을 수 있게: 아직 안 끝낸 일이 많으면 전체 차이는 크게 음수로 나온다 → 끝낸 일만 따로 비교해서 보여 준다
  const finished = retro?.tasks.filter((t) => t.status === "done" && t.exec_count > 0) ?? [];
  const finEst = finished.reduce((s, t) => s + t.estimated_minutes, 0);
  const finAct = finished.reduce((s, t) => s + t.actual_minutes, 0);
  const openCount = totals ? totals.task_count - totals.done_count : 0;
  const diffHint = !totals ? "" : totals.diff_minutes > 0 ? "예상보다 더 걸렸어요"
    : totals.diff_minutes < 0 && openCount > 0 ? `아직 안 끝낸 일 ${openCount}개의 예상 시간이 포함돼서 적게 나와요`
    : totals.diff_minutes < 0 ? "예상보다 덜 걸렸어요" : "예상과 같아요";

  const filteredPlanName = plan ? plans?.find((p) => String(p.id) === plan)?.title : null;

  return (
    <>
      <PageHead title="회고" hint="한 기간을 돌아보고, 다음엔 무엇을 바꿀지 한 줄로 정해요. 숫자를 누르면 근거를 볼 수 있어요." />

      <section className="card filter-card">
        <div className="filter-row">
          <label className="inline-select">프로젝트
            <select value={plan} onChange={(e) => { setPlan(e.target.value); setMetric(null); }}>
              <option value="">전체</option>
              {plans?.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
          <Chips<Period>
            label="기간"
            value={period}
            onChange={setPeriod}
            options={[{ value: "all", label: "전체 기간" }, { value: "week", label: "최근 7일" }, { value: "month", label: "이번 달" }, { value: "custom", label: "직접 정하기" }]}
          />
        </div>
        {period === "custom" && (
          <div className="grid">
            <label>시작일
              <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setMetric(null); }} />
            </label>
            <label>종료일
              <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setMetric(null); }} />
            </label>
          </div>
        )}
        <p className="muted" style={{ margin: 0 }}>
          기간은 할 일의 마감일 기준이에요{filteredPlanName ? ` · ${filteredPlanName}` : ""}. 지연은 오늘({retro?.today ?? "-"})보다 마감이 앞선 미완료 할 일이에요.
        </p>
      </section>

      {error && <p className="error">{error}</p>}
      {!retro && !error && <p className="muted">불러오는 중…</p>}
      {empty && <p className="muted" style={{ margin: "0 4px 12px" }}>선택한 조건에 해당하는 할 일이 없어서 모든 값이 0이에요.</p>}

      {totals && (
        <>
          {/* 맨 위 한 줄 결론: 가장 헷갈리는 "시간 차이"는 끝낸 일만 비교한 값으로 보여 준다 */}
          {totals.task_count > 0 && (
            <section className={`hero${totals.late_count > 0 ? " behind" : ""}`} style={{ marginTop: 18 }}>
              <div className="hero-plan">{filteredPlanName ?? "전체 프로젝트"} · 한 줄 결론</div>
              <h2 className="hero-title">할 일 {totals.task_count}개 중 {totals.done_count}개를 끝냈어요</h2>
              <p className="hero-sub">
                {finished.length > 0
                  ? `끝낸 일은 예상 ${shortMin(finEst)}, 실제 ${shortMin(finAct)}로 ${finAct > finEst ? `예상보다 ${shortMin(finAct - finEst)} 더 걸렸어요.` : finAct < finEst ? `예상보다 ${shortMin(finEst - finAct)} 덜 걸렸어요.` : "예상과 같았어요."}`
                  : "시간 기록이 있는 끝낸 일이 아직 없어요. 실행 기록을 남기면 예상과 실제를 비교해 드려요."}
              </p>
              {(totals.late_count > 0 || totals.blocked_count > 0) && (
                <p className="hero-warn">
                  {totals.late_count > 0 && `기한이 지났는데 못 끝낸 일 ${totals.late_count}개`}
                  {totals.late_count > 0 && totals.blocked_count > 0 && " · "}
                  {totals.blocked_count > 0 && `막힌 일 ${totals.blocked_count}개`}
                </p>
              )}
            </section>
          )}
          <div className="section-head" style={{ marginTop: 22 }}><h2>할 일은 어땠나요?</h2></div>
          <div className="stat-grid">
            <button type="button" className={`stat${metric === "tasks" ? " on" : ""}`} onClick={() => pick("tasks")}>
              <span className="stat-label">전체 할 일 (계획 수)</span>
              <span className="stat-value">{totals.task_count}개</span>
              <span className="stat-link">근거 보기 →</span>
            </button>
            <button type="button" className={`stat${metric === "done" ? " on" : ""}${totals.task_count > 0 && totals.done_count === totals.task_count ? " ok" : ""}`} onClick={() => pick("done")}>
              <span className="stat-label">끝낸 일 (완료 수)</span>
              <span className="stat-value">{totals.done_count}개</span>
              <span className="stat-hint">{totals.task_count ? `전체의 ${Math.round((totals.done_count / totals.task_count) * 100)}%` : "-"} · <span className="stat-link">근거 보기 →</span></span>
            </button>
            <button type="button" className={`stat${metric === "late" ? " on" : ""}${totals.late_count ? " bad" : ""}`} onClick={() => pick("late")}>
              <span className="stat-label">지연 (기한 지났는데 못 끝냄)</span>
              <span className="stat-value">{totals.late_count}개</span>
              <span className="stat-link">근거 보기 →</span>
            </button>
            <button type="button" className={`stat${metric === "blocked" ? " on" : ""}${totals.blocked_count ? " bad" : ""}`} onClick={() => pick("blocked")}>
              <span className="stat-label">막힌 일 (막힘 사유 있음)</span>
              <span className="stat-value">{totals.blocked_count}개</span>
              <span className="stat-link">근거 보기 →</span>
            </button>
          </div>

          <div className="section-head" style={{ marginTop: 22 }}><h2>시간은 어땠나요?</h2></div>
          <div className="stat-grid">
            <button type="button" className={`stat${metric === "estimated" ? " on" : ""}`} onClick={() => pick("estimated")}>
              <span className="stat-label">예상 시간</span>
              <span className="stat-value">{shortMin(totals.estimated_minutes)}</span>
              <span className="stat-link">근거 보기 →</span>
            </button>
            <button type="button" className={`stat${metric === "actual" ? " on" : ""}`} onClick={() => pick("actual")}>
              <span className="stat-label">실제 시간</span>
              <span className="stat-value">{shortMin(totals.actual_minutes)}</span>
              <span className="stat-link">근거 보기 →</span>
            </button>
            <button type="button" className={`stat${metric === "diff" ? " on" : ""}${totals.diff_minutes > 0 ? " bad" : ""}`} onClick={() => pick("diff")}>
              <span className="stat-label">차이 (실제 − 예상)</span>
              <span className="stat-value">{signedMin(totals.diff_minutes)}</span>
              <span className="stat-hint">{diffHint}</span>
            </button>
          </div>
          {finished.length > 0 && (
            <p className="muted" style={{ margin: "10px 4px 0" }}>
              💡 끝낸 일 {finished.length}개만 비교하면: 예상 {shortMin(finEst)} → 실제 {shortMin(finAct)} ({signedMin(finAct - finEst)})
            </p>
          )}
        </>
      )}

      <section className="card" ref={evidenceRef} style={{ scrollMarginTop: 80, marginTop: 18 }}>
        <h2>근거 기록</h2>
        {!metric && <p className="muted">위 숫자 중 하나를 누르면, 그 숫자가 어떤 할 일과 기록에서 나왔는지 여기에 보여요.</p>}
        {metric && retro && (
          <>
            <p className="muted" style={{ marginBottom: 10 }}>{METRIC_TITLE[metric]} · {metric === "actual" ? `실행 기록 ${evExecs.length}건` : `할 일 ${evTasks.length}개`}</p>
            {metric !== "actual" && (evTasks.length === 0 ? <p className="muted">해당하는 기록이 없어요.</p> : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>할 일</th><th>프로젝트</th><th>마감</th><th>상태</th><th>예상</th><th>실제</th><th>차이</th><th></th></tr>
                  </thead>
                  <tbody>
                    {evTasks.map((t) => (
                      <tr key={t.id}>
                        <td>{t.title}{t.late && <span className="badge p1" style={{ marginLeft: 6 }}>지연</span>}{t.blocked && <span className="badge p3" style={{ marginLeft: 6 }}>막힘</span>}</td>
                        <td><Link href={`/plans/${t.plan_id}`}>{t.plan_title}</Link></td>
                        <td>{t.due_date ? mdKo(t.due_date) : "-"}</td>
                        <td>{t.status === "done" ? "완료" : "진행 중"}</td>
                        <td>{t.estimated_minutes}분</td>
                        <td>{t.actual_minutes}분 ({t.exec_count}회)</td>
                        <td>{t.actual_minutes - t.estimated_minutes > 0 ? "+" : ""}{t.actual_minutes - t.estimated_minutes}분</td>
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
                {evExecs.length === 0 ? <p className="muted">해당하는 실행 기록이 없어요.</p> : (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>할 일</th><th>시작</th><th>종료</th><th>실제 소요</th><th>막힘 사유</th></tr></thead>
                      <tbody>
                        {evExecs.map((e) => (
                          <tr key={e.id}>
                            <td><Link href={`/records?task=${e.task_id}`}>{e.task_title}</Link></td>
                            <td>{dateTime(e.started_at)}</td>
                            <td>{dateTime(e.ended_at)}</td>
                            <td>{shortMin(e.actual_minutes)}</td>
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
        <h2>다음엔 이렇게 해볼래요</h2>
        <ol className="how-steps">
          <li><b>1</b> 이번에 배운 점을 한 줄로 적어요</li>
          <li><b>2</b> 저장하면 아래 목록에 남아요</li>
          <li><b>3</b> &quot;다음 계획 만들기&quot;로 다음 계획에 반영해요</li>
        </ol>
        <form onSubmit={addNote}>
          <div className="grid">
            <label>어느 프로젝트의 회고인가요?
              <select value={notePlan || plan} required onChange={(e) => setNotePlan(e.target.value)}>
                <option value="">프로젝트를 고르세요</option>
                {plans?.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </label>
            <label style={{ gridColumn: "span 2" }}>다음에 바꿀 점 (한 줄)
              <input value={noteText} maxLength={500} required placeholder="예: 외부 API는 연결하기 전에 무료 사용 범위를 먼저 확인한다" onChange={(e) => setNoteText(e.target.value)} />
            </label>
          </div>
          {noteError && <p className="error">{noteError}</p>}
          <div className="row" style={{ marginTop: 12 }}><button>개선점 저장</button></div>
        </form>

        {notes && notes.length > 0 && (
          <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
            {notes.map((n) => {
              const src = plans?.find((p) => p.id === n.plan_id);
              return (
                <div key={n.id} className="note">
                  <div><strong>{n.improvement}</strong></div>
                  <div className="muted">{n.plan_title} 회고 · {dateTime(n.created_at)}</div>
                  {n.next_plan_id ? (
                    <div style={{ marginTop: 8 }}>
                      <span className="badge">다음 계획에 반영됨</span>{" "}
                      <Link href={`/plans/${n.next_plan_id}`}>{n.next_plan_title} →</Link>
                    </div>
                  ) : makingFor === n.id && src ? (
                    <div style={{ marginTop: 10 }}>
                      <PlanForm
                        submitLabel="다음 계획 만들기"
                        initial={{
                          title: `${src.title} (다음)`,
                          start_date: addDaysIso(src.end_date, 1),
                          end_date: addDaysIso(src.end_date, 28),
                          priority: src.priority,
                          success_criteria: `[개선] ${n.improvement}\n${src.success_criteria}`,
                          estimated_minutes: src.estimated_minutes,
                        }}
                        onSubmit={(v) => makeNext(n, v)}
                        onCancel={() => setMakingFor(null)}
                      />
                    </div>
                  ) : (
                    <div style={{ marginTop: 8 }}><button type="button" onClick={() => setMakingFor(n.id)}>이 개선점으로 다음 계획 만들기</button></div>
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
