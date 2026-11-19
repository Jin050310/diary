"use client";
import { useState } from "react";
import type { Plan, Task, TaskInput } from "@/lib/types";

// 태그는 화면에서는 "쉼표로 구분한 한 줄"로 입력받고, 서버로 보낼 때 배열로 바꾼다.
export default function TaskForm({
  plans, initial, defaultPlanId, submitLabel, onSubmit, onCancel,
}: {
  plans: Plan[];
  initial?: Task;
  defaultPlanId?: number;
  submitLabel: string;
  onSubmit: (v: TaskInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const [planId, setPlanId] = useState(initial?.plan_id ?? defaultPlanId ?? plans[0]?.id ?? 0);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [due, setDue] = useState(initial?.due_date ?? "");
  const [priority, setPriority] = useState(initial?.priority ?? 2);
  const [tags, setTags] = useState(initial?.tags.join(", ") ?? "");
  const [minutes, setMinutes] = useState(initial?.estimated_minutes ?? 30);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit({
        plan_id: planId,
        title,
        due_date: due || null,
        priority,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        estimated_minutes: minutes,
      });
      if (!initial) { setTitle(""); setDue(""); setTags(""); }
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="grid">
        <label>계획
          <select value={planId} onChange={(e) => setPlanId(Number(e.target.value))} required>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </label>
        <label style={{ gridColumn: "span 2" }}>할 일
          <input value={title} maxLength={200} required onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>마감일
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label>우선순위
          <select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
            <option value={1}>높음</option>
            <option value={2}>중간</option>
            <option value={3}>낮음</option>
          </select>
        </label>
        <label>태그 (쉼표로 구분)
          <input value={tags} placeholder="예: 단어, 복습" onChange={(e) => setTags(e.target.value)} />
        </label>
        <label>예상 시간 (분)
          <input type="number" min={0} max={100000} step={1} value={minutes} required
            onChange={(e) => setMinutes(Number(e.target.value))} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row" style={{ marginTop: 12 }}>
        <button disabled={busy || !planId}>{busy ? "저장 중…" : submitLabel}</button>
        {onCancel && <button type="button" className="ghost" onClick={onCancel}>취소</button>}
      </div>
    </form>
  );
}
