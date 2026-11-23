"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { api, dateTime, daysBetween, dueLabel, kstToday, mdKo, noopSubscribe, shortMin } from "@/lib/format";
import { toggleTask } from "@/lib/taskActions";
import type { Completion, Execution, Task } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { Chips, PageHead } from "../ui";

// 직접 입력하는 시각(예: 2026-11-19T14:30)은 한국 시간으로 보고, 시간대(+09:00)를 붙여 서버로 보낸다.
const toIso = (local: string) => `${local}:00+09:00`;
const diffMinutes = (a: string, b: string) => (a && b ? Math.round((Date.parse(toIso(b)) - Date.parse(toIso(a))) / 60000) : null);
const KST = 9 * 3600000;
const kstDay = (iso: string) => new Date(Date.parse(iso) + KST).toISOString().slice(0, 10);
const kstHm = (iso: string) => new Date(Date.parse(iso) + KST).toISOString().slice(11, 16);

// 선택 목록을 날짜별로 묶는다. (서버가 마감일 순으로 주므로 이웃한 같은 날짜만 모으면 된다)
function groupByDate(tasks: Task[], today: string | null) {
  const out: { key: string; label: string; items: Task[] }[] = [];
  for (const t of tasks) {
    const key = t.due_date ?? "none";
    let g = out[out.length - 1];
    if (!g || g.key !== key) { g = { key, label: "", items: [] }; out.push(g); }
    g.items.push(t);
  }
  for (const g of out) {
    const due = g.key === "none" ? null : g.key;
    if (!due) { g.label = "마감 없음"; continue; }
    const d = today ? daysBetween(today, due) : null;
    g.label = d === null ? mdKo(due) : d === 0 ? `오늘 · ${mdKo(due)}` : d === 1 ? `내일 · ${mdKo(due)}` : d < 0 ? `${-d}일 지남 · ${mdKo(due)}` : mdKo(due);
  }
  return out;
}
// "일본어 번역·테스트·단어장 프로젝트" → "일본어 번역·테스트·단어장" (목록에서 한눈에 구분되게 뒤의 '프로젝트'만 뺌)
const shortPlan = (title?: string) => (title ?? "").replace(/\s*프로젝트.*$/, "");

type Mode = "quick" | "manual";
const PRESETS = [15, 30, 60, 90, 120];

export default function RecordsView() {
  const sp = useSearchParams();
  const today = useSyncExternalStore(noopSubscribe, kstToday, () => null);
  // 선택한 할 일: 주소의 ?task= 값을 항상 따라간다. (처음 한 번만 읽으면, 화면이 먼저 그려질 때 주소 값이 비어 있는 경우
  // 눌렀던 할 일이 아니라 빈 선택이 되어 버린다.) 사용자가 직접 고르면 그 선택이 우선하고, 주소가 바뀌면 다시 주소를 따른다.
  const urlTask = sp.get("task") ?? "";
  const [pick, setPick] = useState<{ base: string; id: string } | null>(null);
  const taskId = pick && pick.base === urlTask ? pick.id : urlTask;
  const setTaskId = (id: string) => setPick({ base: urlTask, id });
  const [mode, setMode] = useState<Mode>("quick");
  const [dur, setDur] = useState(30);
  const [started, setStarted] = useState("");
  const [ended, setEnded] = useState("");
  const [actual, setActual] = useState("");
  const [actualTouched, setActualTouched] = useState(false);
  const [blocker, setBlocker] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");

  const { data: tasks, reload: reloadTasks } = useApi<Task[]>("/api/tasks?sort=due");
  const { data: execs, error: execError, reload: reloadExecs } = useApi<Execution[]>("/api/executions");
  const { data: comps, reload: reloadComps } = useApi<Completion[]>("/api/completions");
  const selectedTask = tasks?.find((t) => String(t.id) === taskId);
  const open = (tasks ?? []).filter((t) => t.status === "todo");
  const doneTasks = (tasks ?? []).filter((t) => t.status === "done");
  const todayTasks = today ? (tasks ?? []).filter((t) => t.due_date === today) : [];
  const openGroups = groupByDate(open, today);

  function setTimes(s: string, e: string) {
    setStarted(s);
    setEnded(e);
    const d = diffMinutes(s, e);
    if (!actualTouched && d !== null && d >= 0) setActual(String(d)); // 직접 고치기 전까지는 시작~종료 차이를 자동 입력
  }

  async function save(andComplete: boolean) {
    if (!taskId) { setError("어떤 일을 했는지 먼저 골라 주세요."); return; }
    setBusy(true);
    setError("");
    try {
      let body: Record<string, unknown>;
      if (mode === "quick") {
        const end = new Date();
        body = { task_id: Number(taskId), started_at: new Date(end.getTime() - dur * 60000).toISOString(), ended_at: end.toISOString(), actual_minutes: dur };
      } else {
        if (!started || !ended) throw new Error("시작 시각과 종료 시각을 모두 넣어 주세요.");
        body = { task_id: Number(taskId), started_at: toIso(started), ended_at: toIso(ended), actual_minutes: actual === "" ? undefined : Number(actual) };
      }
      body.blocker = blocker.trim() || null;
      await api("/api/executions", { method: "POST", body: JSON.stringify(body) });
      let msg = `"${selectedTask?.title ?? "할 일"}" 기록을 저장했어요.`;
      if (andComplete && selectedTask?.status === "todo") { await toggleTask(selectedTask); msg += " 완료 처리도 했어요."; }
      setSaved(msg);
      setStarted(""); setEnded(""); setActual(""); setActualTouched(false); setBlocker("");
      reloadExecs(); reloadTasks(); reloadComps();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했어요");
    } finally {
      setBusy(false);
    }
  }

  async function toggleDone(t: Task) {
    setError("");
    try {
      await toggleTask(t);
      reloadTasks(); reloadComps();
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리하지 못했어요");
    }
  }

  // 날짜별로 묶어서 보여 준다 (최근 날짜 먼저)
  const groups = new Map<string, Execution[]>();
  for (const e of execs ?? []) { const k = kstDay(e.started_at); groups.set(k, [...(groups.get(k) ?? []), e]); }
  const days = [...groups.keys()].sort().reverse();
  const todayExecs = today ? groups.get(today) ?? [] : [];
  const todayMin = todayExecs.reduce((s, e) => s + e.actual_minutes, 0);
  const activeCount = (comps ?? []).filter((c) => !c.canceled_at).length;
  const dl = selectedTask ? dueLabel(selectedTask.due_date, today, selectedTask.status === "todo") : null;

  return (
    <>
      <PageHead title="실행 기록" hint="방금 한 일을 30초 안에 남겨요. 계획 값은 바뀌지 않고, 실제로 한 것만 따로 쌓여요." />

      <section className="card">
        <div className="rec-top">
          <h2>방금 한 일 기록하기</h2>
          {today && <span className="muted">오늘 기록 {todayExecs.length}건 · {shortMin(todayMin)}</span>}
        </div>

        <div className="steps">
          <div>
            <div className="step-title"><span className="step-no">1</span>어떤 일을 했나요?</div>
            {/* 오늘 마감인 할 일은 버튼 한 번으로 고른다 (긴 목록에서 찾지 않아도 되게) */}
            {todayTasks.length > 0 && (
              <div className="today-pick">
                <span className="today-pick-label">오늘 할 일</span>
                <div className="chips" role="group" aria-label="오늘 할 일">
                  {todayTasks.map((t) => (
                    <button key={t.id} type="button" className={`chip${taskId === String(t.id) ? " on" : ""}`} aria-pressed={taskId === String(t.id)}
                      onClick={() => { setTaskId(String(t.id)); setSaved(""); }}>
                      {t.status === "done" ? "✓ " : ""}{t.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <select value={taskId} aria-label="한 일" onChange={(e) => { setTaskId(e.target.value); setSaved(""); }}>
              <option value="">{todayTasks.length > 0 ? "다른 날짜의 할 일 고르기" : "할 일을 고르세요"}</option>
              {openGroups.map((g) => (
                <optgroup key={g.key} label={g.label}>
                  {g.items.map((t) => <option key={t.id} value={t.id}>{t.title} · {shortPlan(t.plan_title)}</option>)}
                </optgroup>
              ))}
              {doneTasks.length > 0 && (
                <optgroup label="이미 끝낸 일">
                  {doneTasks.map((t) => <option key={t.id} value={t.id}>✓ {t.title} · {shortPlan(t.plan_title)}</option>)}
                </optgroup>
              )}
            </select>
            {selectedTask && dl && (
              <p className="muted sel-info">
                <b>{selectedTask.plan_title}</b> · 마감 <b className={dl.tone === "late" ? "due-late" : dl.tone === "soon" ? "due-soon" : ""}>{dl.text}</b> · 예상 {shortMin(selectedTask.estimated_minutes)}
                {(selectedTask.exec_count ?? 0) > 0 ? ` · 지금까지 ${selectedTask.exec_count}번, 실제 ${shortMin(selectedTask.actual_minutes)}` : " · 아직 기록이 없어요"}
              </p>
            )}
          </div>

          <div>
            <div className="step-title"><span className="step-no">2</span>얼마나 했나요?</div>
            <Chips<Mode> label="입력 방식" value={mode} onChange={setMode} options={[{ value: "quick", label: "방금 끝났어요" }, { value: "manual", label: "시각을 직접 입력" }]} />
            {mode === "quick" ? (
              <div style={{ marginTop: 12 }}>
                <div className="chips" role="group" aria-label="한 시간">
                  {PRESETS.map((m) => (
                    <button key={m} type="button" className={`chip${dur === m ? " on" : ""}`} aria-pressed={dur === m} onClick={() => setDur(m)}>{shortMin(m)}</button>
                  ))}
                  <label className="inline-label dur-custom">
                    <input type="number" min={1} max={1440} value={dur} aria-label="직접 입력(분)" onChange={(e) => setDur(Math.max(1, Number(e.target.value) || 1))} style={{ width: 84 }} /> 분
                  </label>
                </div>
                <p className="muted" style={{ marginTop: 8 }}>저장하는 지금 시각에 끝난 것으로, {shortMin(dur)} 전에 시작한 것으로 기록해요.</p>
              </div>
            ) : (
              <div className="grid" style={{ marginTop: 12 }}>
                <label>시작 (한국 시간)
                  <input type="datetime-local" value={started} aria-label="시작 시각" onChange={(e) => setTimes(e.target.value, ended)} />
                </label>
                <label>종료 (한국 시간)
                  <input type="datetime-local" value={ended} aria-label="종료 시각" onChange={(e) => setTimes(started, e.target.value)} />
                </label>
                <label>실제 한 시간 (분)
                  <input type="number" min={0} max={100000} step={1} value={actual} placeholder="자동 계산" aria-label="실제 소요 시간(분)"
                    onChange={(e) => { setActual(e.target.value); setActualTouched(true); }} />
                  <span className="muted">쉰 시간을 빼려면 직접 고치세요</span>
                </label>
              </div>
            )}
          </div>

          <div>
            <div className="step-title"><span className="step-no">3</span>막힌 점이 있었나요? <span className="muted">(없으면 비워 두세요)</span></div>
            <textarea value={blocker} maxLength={1000} placeholder="예: 무료로 쓸 수 있는 API를 찾느라 시간이 걸림" aria-label="막힘 사유" onChange={(e) => setBlocker(e.target.value)} style={{ minHeight: 64 }} />
          </div>
        </div>

        {saved && !error && (
          <p className="inline-note">{saved} <Link href="/direction">진행 방향 보기 →</Link></p>
        )}
        {error && <p className="error">{error}</p>}
        <div className="row" style={{ marginTop: 14 }}>
          <button type="button" disabled={busy || !taskId} onClick={() => save(false)}>{busy ? "저장 중…" : "기록 저장"}</button>
          {selectedTask?.status === "todo" && (
            <button type="button" className="ghost" disabled={busy} onClick={() => save(true)}>저장하고 완료 처리</button>
          )}
          {selectedTask && (
            <button type="button" className="ghost" onClick={() => toggleDone(selectedTask)}>
              {selectedTask.status === "done" ? "완료 취소" : "기록 없이 완료만"}
            </button>
          )}
        </div>
      </section>

      <div className="section-head"><h2>기록 목록 <span className="muted">({execs?.length ?? 0}건)</span></h2></div>
      {execError && <p className="error">{execError}</p>}
      {execs?.length === 0 && <section className="card"><p className="muted empty">아직 실행 기록이 없어요. 위에서 방금 한 일을 하나 남겨 보세요.</p></section>}
      {days.map((day) => {
        const list = (groups.get(day) ?? []).sort((a, b) => b.started_at.localeCompare(a.started_at));
        return (
          <section key={day} className="card day-group">
            <div className="day-group-head">
              <strong>{mdKo(day)}{day === today && <span className="today-pill" style={{ marginLeft: 8 }}>오늘</span>}</strong>
              <span className="muted">{list.length}건 · {shortMin(list.reduce((s, e) => s + e.actual_minutes, 0))}</span>
            </div>
            <ul className="rec-list">
              {list.map((e) => (
                <li key={e.id} className="rec-row">
                  <div className="rec-time">{kstHm(e.started_at)}–{kstHm(e.ended_at)}</div>
                  <div className="rec-main">
                    <Link href={`/records?task=${e.task_id}`} onClick={() => { setTaskId(String(e.task_id)); setSaved(""); }}>{e.task_title}</Link>
                    <span className="muted"> · <Link href={`/plans/${e.plan_id}`}>{e.plan_title}</Link></span>
                    {e.blocker && <div className="rec-block">막힌 점: {e.blocker}</div>}
                  </div>
                  <div className="rec-min">{shortMin(e.actual_minutes)}</div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <details className="acc" style={{ marginTop: 18 }}>
        <summary>
          <span>완료 기록 <span className="acc-hint">유효한 완료 {activeCount}건 · 같은 할 일을 여러 번 눌러도 1건만 남아요</span></span>
        </summary>
        <div className="acc-body">
          {comps?.length === 0 && <p className="muted">아직 완료한 할 일이 없어요. 할 일 화면에서 동그라미를 눌러 완료해 보세요.</p>}
          {comps && comps.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>할 일</th><th>완료 시각</th><th>상태</th><th>요청 키</th></tr>
                </thead>
                <tbody>
                  {comps.map((c) => (
                    <tr key={c.id}>
                      <td>{c.task_title}<div className="muted">{c.plan_title}</div></td>
                      <td>{dateTime(c.completed_at)}</td>
                      <td>{c.canceled_at ? <span className="muted">취소됨 ({dateTime(c.canceled_at)})</span> : <span className="badge">유효</span>}</td>
                      <td className="muted">{c.idempotency_key.slice(0, 8)}…</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </details>
    </>
  );
}
