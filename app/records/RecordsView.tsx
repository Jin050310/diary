"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { api, dateTime, minutes } from "@/lib/format";
import { toggleTask } from "@/lib/taskActions";
import type { Completion, Execution, Task } from "@/lib/types";
import { useApi } from "@/lib/useApi";

// <input type="datetime-local"> 값(예: 2026-11-19T14:30)은 한국 시간으로 보고, 시간대(+09:00)를 붙여 서버로 보낸다.
const toIso = (local: string) => `${local}:00+09:00`;
const nowKst = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" })
  .format(new Date()).replace(" ", "T");
const diffMinutes = (a: string, b: string) =>
  a && b ? Math.round((Date.parse(toIso(b)) - Date.parse(toIso(a))) / 60000) : null;

export default function RecordsView() {
  const sp = useSearchParams();
  const [taskId, setTaskId] = useState(sp.get("task") ?? "");
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

  function setTimes(s: string, e: string) {
    setStarted(s);
    setEnded(e);
    const d = diffMinutes(s, e);
    if (!actualTouched && d !== null && d >= 0) setActual(String(d)); // 직접 고치기 전까지는 시작~종료 차이를 자동 입력
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/executions", {
        method: "POST",
        body: JSON.stringify({
          task_id: Number(taskId),
          started_at: toIso(started),
          ended_at: toIso(ended),
          actual_minutes: actual === "" ? undefined : Number(actual),
          blocker: blocker.trim() || null,
        }),
      });
      setStarted(""); setEnded(""); setActual(""); setActualTouched(false); setBlocker("");
      setSaved(selectedTask?.title ?? "할 일"); // 할 일은 그대로 선택해 두어 같은 일의 기록을 이어서 남길 수 있다
      reloadExecs(); reloadTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
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
      setError(e instanceof Error ? e.message : "처리 실패");
    }
  }

  const activeCount = (comps ?? []).filter((c) => !c.canceled_at).length;

  return (
    <>
      <h1>실행 기록</h1>
      <p className="muted" style={{ margin: "-8px 4px 16px" }}>
        계획과 별개로 &quot;실제로 한 것&quot;을 남깁니다. 기록을 저장해도 원래 계획·할 일 값은 바뀌지 않습니다.
      </p>

      <section className="card">
        <h2>실행 기록 남기기</h2>
        <form onSubmit={submit}>
          <div className="grid">
            <label style={{ gridColumn: "1 / -1" }}>어느 할 일을 했나요?
              <select value={taskId} required onChange={(e) => setTaskId(e.target.value)}>
                <option value="">할 일을 고르세요</option>
                {tasks?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.status === "done" ? "✓ " : ""}{t.title} — {t.plan_title}
                  </option>
                ))}
              </select>
            </label>
            <label>시작 시각 (한국 시간)
              <input type="datetime-local" value={started} required onChange={(e) => setTimes(e.target.value, ended)} />
              <button type="button" className="ghost" onClick={() => setTimes(nowKst(), ended)}>지금으로</button>
            </label>
            <label>종료 시각 (한국 시간)
              <input type="datetime-local" value={ended} required onChange={(e) => setTimes(started, e.target.value)} />
              <button type="button" className="ghost" onClick={() => setTimes(started, nowKst())}>지금으로</button>
            </label>
            <label>실제 소요 시간 (분)
              <input type="number" min={0} max={100000} step={1} value={actual} required placeholder="자동 계산"
                onChange={(e) => { setActual(e.target.value); setActualTouched(true); }} />
              <span className="muted">쉰 시간을 빼는 등 직접 고칠 수 있어요</span>
            </label>
            <label style={{ gridColumn: "1 / -1" }}>막힘 사유 (없으면 비워 두세요)
              <textarea value={blocker} maxLength={1000} onChange={(e) => setBlocker(e.target.value)} />
            </label>
          </div>
          {selectedTask && (
            <p className="muted" style={{ marginTop: 10 }}>
              이 할 일의 계획 값(변경되지 않음): 마감 {selectedTask.due_date ?? "없음"} · 예상 {minutes(selectedTask.estimated_minutes)}
              {" · "}지금까지 기록 {selectedTask.exec_count ?? 0}회 / 실제 {minutes(selectedTask.actual_minutes ?? 0)}
            </p>
          )}
          {saved && !error && (
            <p className="inline-note">
              &quot;{saved}&quot; 기록을 저장했어요. <Link href="/retro">회고에서 확인하기 →</Link>
            </p>
          )}
          {error && <p className="error">{error}</p>}
          <div className="row" style={{ marginTop: 12 }}>
            <button disabled={busy || !taskId}>{busy ? "저장 중…" : "실행 기록 저장"}</button>
            {selectedTask && (
              <button type="button" className="ghost" onClick={() => toggleDone(selectedTask)}>
                {selectedTask.status === "done" ? "완료 취소" : "이 할 일 완료 처리"}
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="card">
        <h2>기록 목록 <span className="muted">({execs?.length ?? 0}건 · 최근 순)</span></h2>
        {execError && <p className="error">{execError}</p>}
        {execs?.length === 0 && <p className="muted">아직 실행 기록이 없어요. 할 일을 하고 나서 시작·종료 시각을 남겨 보세요.</p>}
        {execs && execs.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>할 일 (연결)</th><th>시작</th><th>종료</th><th>실제 소요</th><th>막힘 사유</th></tr>
              </thead>
              <tbody>
                {execs.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link href={`/records?task=${e.task_id}`} onClick={() => setTaskId(String(e.task_id))}>{e.task_title}</Link>
                      <div className="muted"><Link href={`/plans/${e.plan_id}`}>{e.plan_title}</Link> · 기록 #{e.id}</div>
                    </td>
                    <td>{dateTime(e.started_at)}</td>
                    <td>{dateTime(e.ended_at)}</td>
                    <td>{minutes(e.actual_minutes)}</td>
                    <td className="pre">{e.blocker ?? <span className="muted">-</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>완료 기록 <span className="muted">(유효한 완료 {activeCount}건 · 같은 할 일을 여러 번 눌러도 1건만 남습니다)</span></h2>
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
      </section>
    </>
  );
}
