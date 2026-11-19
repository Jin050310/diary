"use client";
import { useState } from "react";
import type { PlanInput } from "@/lib/types";

const empty: PlanInput = {
  title: "", start_date: "", end_date: "", priority: 2, success_criteria: "", estimated_minutes: 0,
};

export default function PlanForm({
  initial, submitLabel, onSubmit, onCancel,
}: {
  initial?: PlanInput;
  submitLabel: string;
  onSubmit: (v: PlanInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const [v, setV] = useState<PlanInput>(initial ?? empty);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof PlanInput>(k: K, val: PlanInput[K]) => setV((p) => ({ ...p, [k]: val }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(v);
      if (!initial) setV(empty);
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="grid">
        <label style={{ gridColumn: "1 / -1" }}>계획 제목
          <input value={v.title} maxLength={200} required onChange={(e) => set("title", e.target.value)} />
        </label>
        <label>시작일
          <input type="date" value={v.start_date} required onChange={(e) => set("start_date", e.target.value)} />
        </label>
        <label>종료일
          <input type="date" value={v.end_date} required onChange={(e) => set("end_date", e.target.value)} />
        </label>
        <label>우선순위
          <select value={v.priority} onChange={(e) => set("priority", Number(e.target.value))}>
            <option value={1}>높음</option>
            <option value={2}>중간</option>
            <option value={3}>낮음</option>
          </select>
        </label>
        <label>예상 시간 (분)
          <input type="number" min={0} max={100000} step={1} value={v.estimated_minutes} required
            onChange={(e) => set("estimated_minutes", Number(e.target.value))} />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>성공 기준
          <textarea value={v.success_criteria} maxLength={1000} required
            onChange={(e) => set("success_criteria", e.target.value)} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row" style={{ marginTop: 12 }}>
        <button disabled={busy}>{busy ? "저장 중…" : submitLabel}</button>
        {onCancel && <button type="button" className="ghost" onClick={onCancel}>취소</button>}
      </div>
    </form>
  );
}
