"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api, dateTime, minutes, PRIORITY } from "@/lib/format";
import type { Plan, PlanInput, PlanRevision } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import PlanForm from "../../PlanForm";

export default function PlanView() {
  const { id } = useParams<{ id: string }>();
  const url = `/api/plans/${encodeURIComponent(id)}`;
  const { data, error, reload } = useApi<{ plan: Plan; revisions: PlanRevision[] }>(url);
  const [editing, setEditing] = useState(false);

  async function save(v: PlanInput) {
    await api(url, { method: "PATCH", body: JSON.stringify(v) });
    setEditing(false);
    reload();
  }

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">불러오는 중…</p>;
  const { plan, revisions } = data;

  return (
    <>
      <h1>{plan.title}</h1>
      {plan.source_improvement && (
        <section className="card">
          <h2>회고에서 반영된 개선점</h2>
          <p className="pre" style={{ margin: 0 }}><strong>{plan.source_improvement}</strong></p>
          {plan.source_plan_id && <p className="muted" style={{ marginTop: 6 }}>이전 계획 <Link href={`/plans/${plan.source_plan_id}`}>#{plan.source_plan_id}</Link> 의 회고에서 나온 개선점으로 만든 계획입니다.</p>}
        </section>
      )}
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>현재 계획 <span className="muted">#{plan.id} · v{plan.version}</span></h2>
          {!editing && <button className="ghost" onClick={() => setEditing(true)}>계획 수정</button>}
        </div>
        {editing ? (
          <PlanForm initial={plan} submitLabel="수정 저장" onSubmit={save} onCancel={() => setEditing(false)} />
        ) : (
          <div className="table-wrap">
            <table>
              <tbody>
                <tr><th>기간</th><td>{plan.start_date} ~ {plan.end_date}</td></tr>
                <tr><th>우선순위</th><td>{PRIORITY[plan.priority]}</td></tr>
                <tr><th>성공 기준</th><td className="pre">{plan.success_criteria}</td></tr>
                <tr><th>예상 시간</th><td>{minutes(plan.estimated_minutes)}</td></tr>
                <tr><th>최초 등록</th><td>{dateTime(plan.created_at)}</td></tr>
                <tr><th>마지막 수정</th><td>{dateTime(plan.updated_at)}</td></tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>수정 이력 <span className="muted">({revisions.length}건 · 수정 전 값이 그대로 보존됩니다)</span></h2>
        {revisions.length === 0 ? (
          <p className="muted">아직 수정한 적이 없습니다. 현재 계획이 최초 계획(v1)입니다.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>버전</th><th>제목</th><th>기간</th><th>우선순위</th><th>성공 기준</th><th>예상</th><th>사용 기간</th></tr>
              </thead>
              <tbody>
                {revisions.map((r) => (
                  <tr key={r.id}>
                    <td>v{r.version}{r.version === 1 && <> <span className="badge">최초 계획</span></>}</td>
                    <td>{r.title}</td>
                    <td>{r.start_date} ~ {r.end_date}</td>
                    <td>{PRIORITY[r.priority]}</td>
                    <td className="pre">{r.success_criteria}</td>
                    <td>{minutes(r.estimated_minutes)}</td>
                    <td className="muted">{dateTime(r.valid_from)} ~<br />{dateTime(r.replaced_at)}</td>
                  </tr>
                ))}
                <tr>
                  <td>v{plan.version} <span className="badge">현재</span></td>
                  <td>{plan.title}</td>
                  <td>{plan.start_date} ~ {plan.end_date}</td>
                  <td>{PRIORITY[plan.priority]}</td>
                  <td className="pre">{plan.success_criteria}</td>
                  <td>{minutes(plan.estimated_minutes)}</td>
                  <td className="muted">{dateTime(plan.updated_at)} ~</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
