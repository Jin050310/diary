"use client";
import Link from "next/link";
import { useState } from "react";
import { api, dueLabel, mdKo, daysBetween, shortMin, minutes as fmtLong } from "@/lib/format";
import { WEEKDAY_NAMES, fmtMin, type DirectionResponse, type Improvement, type SeriesPoint } from "@/lib/directionCalc";
import type { Plan, Task } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { Chips, PageHead, ProgressBar, Stat } from "../ui";

const mmdd = (iso: string) => iso.slice(5).replace("-", "/");
const pctText = (r: number | null) => (r === null ? "-" : `${Math.round(r * 100)}%`);
const biasText = (r: number | null) => (r === null ? "-" : `${r >= 1 ? "+" : "-"}${Math.round(Math.abs(r - 1) * 100)}%`);
const retroHref = (planId: number, metric: string, from?: string, to?: string) => {
  const params = new URLSearchParams({ plan: String(planId), metric });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return `/retro?${params}`;
};

export default function DirectionView() {
  const { data: plans, error } = useApi<Plan[]>("/api/plans");
  const [picked, setPicked] = useState("");
  if (error) return <p className="error">{error}</p>;
  if (!plans) return <p className="muted">불러오는 중…</p>;
  if (plans.length === 0) return <p className="muted">먼저 달력 화면에서 프로젝트를 만들어 주세요.</p>;

  // 처음에는 예상 시간이 가장 큰 프로젝트를 보여 준다
  const biggest = [...plans].sort((a, b) => b.estimated_minutes - a.estimated_minutes || a.id - b.id)[0];
  const planId = picked || String(biggest.id);
  const few = plans.length <= 4;

  return (
    <>
      <PageHead title="진행 방향" hint="큰 프로젝트가 계획대로 가고 있는지 한눈에 봐요. 숫자를 누르면 근거 기록으로 이동해요." />
      <section className="card plan-pick">
        {few ? (
          <Chips label="프로젝트" value={planId} onChange={setPicked} options={plans.map((p) => ({ value: String(p.id), label: p.title }))} />
        ) : (
          <label className="inline-select">프로젝트
            <select value={planId} onChange={(e) => setPicked(e.target.value)}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.title} · 예상 {fmtLong(p.estimated_minutes)}</option>)}
            </select>
          </label>
        )}
      </section>
      <Body key={planId} planId={Number(planId)} />
    </>
  );
}

function Body({ planId }: { planId: number }) {
  const { data: d, error, reload } = useApi<DirectionResponse>(`/api/direction?plan=${planId}`);
  const { data: openTasks } = useApi<Task[]>(`/api/tasks?plan=${planId}&status=todo&sort=due`);
  const [saved, setSaved] = useState<string[]>([]);
  const [saveError, setSaveError] = useState("");

  if (error) return <p className="error">{error}</p>;
  if (!d) return <p className="muted">계산하는 중…</p>;
  const { progress: p, patterns: pt, totals: t } = d;
  const noTasks = t.task_count === 0;

  async function saveNote(text: string) {
    setSaveError("");
    try {
      await api("/api/retro-notes", { method: "POST", body: JSON.stringify({ plan_id: planId, improvement: text }) });
      setSaved((s) => [...s, text]);
      reload();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "저장하지 못했어요");
    }
  }

  const left = daysBetween(d.today, d.plan.end_date);
  const week = d.weeks.find((w) => d.today >= w.start && d.today <= w.end);
  const maxWeek = Math.max(1, ...d.weeks.map((w) => Math.max(w.planned, w.actual)));
  const maxDay = Math.max(1, ...pt.weekday);
  const title = noTasks ? "할 일을 추가하면 방향을 볼 수 있어요"
    : p.pace === "behind" ? `계획보다 ${shortMin(-p.gap)} 뒤처졌어요`
    : p.pace === "ahead" ? `계획보다 ${shortMin(p.gap)} 앞서 있어요`
    : "계획대로 가고 있어요";
  const sub = noTasks ? "달력에서 날짜를 눌러 할 일을 넣어 보세요."
    : p.planned_to_date === 0 ? "아직 마감이 지났거나 오늘인 할 일이 없어요."
    : `오늘까지 끝냈어야 할 분량 ${shortMin(p.planned_to_date)} 중 ${shortMin(p.done_total_est)}을 끝냈어요.`;
  const next = (openTasks ?? []).slice(0, 4);
  const sugCount = d.verdict.suggestions.length;

  return (
    <>
      {/* ① 결론 먼저 */}
      <section className={`hero ${noTasks ? "none" : p.pace}`}>
        <div className="hero-plan">{d.plan.title}</div>
        <h2 className="hero-title">{title}</h2>
        <p className="hero-sub">{sub}</p>
        {!noTasks && (
          <div className="hero-progress">
            <ProgressBar value={Math.round((p.percent_done ?? 0) * 100)} max={100} tone={p.pace === "behind" ? "warn" : "accent"} />
            <span>전체 {pctText(p.percent_done)} 진행 · {t.done_count}/{t.task_count}개 끝냄</span>
          </div>
        )}
        {p.overdue_open_est > 0 && <p className="hero-warn">기한이 지났는데 아직 안 끝난 분량이 {shortMin(p.overdue_open_est)} 있어요.</p>}
      </section>

      {/* ② 지금 해야 할 것 */}
      <section className="card">
        <div className="rec-top">
          <h2>다음에 할 일</h2>
          <Link href="/tasks" className="muted">할 일 전체 보기 →</Link>
        </div>
        {next.length === 0 ? <p className="muted empty">{noTasks ? "아직 할 일이 없어요." : "남은 할 일이 없어요 🎉"}</p> : (
          <ul className="trow-list">
            {next.map((x) => {
              const dl = dueLabel(x.due_date, d.today);
              return (
                <li key={x.id} className="trow">
                  <div className="t-main">
                    <div className="t-title">{x.title}</div>
                    <div className="t-sub">
                      <span className={dl.tone === "late" ? "due-late" : dl.tone === "soon" ? "due-soon" : ""}>{dl.text}</span>
                      <span>예상 {shortMin(x.estimated_minutes)}</span>
                    </div>
                  </div>
                  <div className="t-actions"><Link href={`/records?task=${x.id}`} className="btn-link">기록하기</Link></div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="stat-grid dir-stats">
        <Link href={retroHref(planId, "done")} className="stat">
          <span className="stat-label">끝낸 일</span>
          <span className="stat-value">{t.done_count}<span className="stat-unit">/{t.task_count}개</span></span>
          <span className="stat-hint">전체의 {pctText(p.percent_done)} (예상 시간 기준)</span>
        </Link>
        <Stat label="남은 기간" value={left < 0 ? "종료" : left === 0 ? "오늘까지" : `D-${left}`} hint={`${mdKo(d.plan.end_date)}까지`} />
        <Link href={retroHref(planId, "diff")} className="stat">
          <span className="stat-label">걸린 시간 (예상 대비)</span>
          <span className="stat-value">{pt.bias.ratio === null ? "-" : `예상의 ${pt.bias.ratio.toFixed(1)}배`}</span>
          <span className="stat-hint">{pt.bias.ratio === null ? "끝낸 일 중 기록이 있는 게 아직 없어요" : pt.bias.ratio > 1.1 ? `예상보다 오래 걸려요 (끝낸 ${pt.bias.n}개 기준)` : pt.bias.ratio < 0.9 ? `예상보다 빨리 끝나요 (끝낸 ${pt.bias.n}개 기준)` : `예상과 비슷해요 (끝낸 ${pt.bias.n}개 기준)`}</span>
        </Link>
        <Link href={week ? retroHref(planId, "tasks", week.start, week.end) : retroHref(planId, "tasks")} className="stat">
          <span className="stat-label">이번 주</span>
          <span className="stat-value small">{week ? `${shortMin(week.planned)} 계획` : "-"}</span>
          <span className="stat-hint">{week ? `실제 ${shortMin(week.actual)} · 마감 ${week.due_count}개 중 ${week.done_count}개 완료` : "이번 주 계획이 없어요"}</span>
        </Link>
      </div>

      {/* ③ 계획 대비 진행 그래프 */}
      <details className="acc">
        <summary><span>그래프로 보기 <span className="acc-hint">계획·완료·쓴 시간</span></span></summary>
        <div className="acc-body">
        <div className="chart-legend">
          <span><i className="lg plan" />계획 (마감일까지 끝냈어야 할 분량)</span>
          <span><i className="lg done" />완료 (끝낸 할 일)</span>
          <span><i className="lg act" />쓴 시간 (실제 작업)</span>
        </div>
        <Chart series={d.series} today={d.today} />
        <p className="muted">파란 선(완료)이 점선(계획)보다 아래면 뒤처진 거예요. 주황 선(쓴 시간)이 파란 선보다 위면 예상보다 시간을 더 쓰고 있다는 뜻이에요.</p>
        </div>
      </details>

      {/* ④ 자세히: 필요할 때만 펼친다 */}
      <details className="acc">
        <summary>
          <span>주별로 보기 <span className="acc-hint">{d.trend.state === "widening" ? "최근 차이가 벌어지는 중" : d.trend.state === "narrowing" ? "최근 차이가 좁혀지는 중" : `${d.weeks.length}주`}</span></span>
        </summary>
        <div className="acc-body">
          {d.trend.state && (
            <p className={`inline-note${d.trend.state === "widening" ? " warn" : ""}`}>
              {d.trend.state === "widening" ? "최근 두 주 사이 계획과 실제의 차이가 벌어지고 있어요" : d.trend.state === "narrowing" ? "최근 두 주 사이 계획과 실제의 차이가 좁혀지고 있어요" : "최근 두 주의 차이는 비슷해요"}
              {" "}({fmtMin(d.trend.from as number)} 차이 → {fmtMin(d.trend.to as number)} 차이)
            </p>
          )}
          <div className="week-list">
            {d.weeks.map((w) => (
              <div key={w.start} className={`week-row${w.future ? " future" : ""}`}>
                <div className="week-name">{mmdd(w.start)}~{mmdd(w.end)}{w.future && <span className="muted"> 예정</span>}</div>
                <div className="week-bars">
                  <div className="bar-line"><span className="bar plan" style={{ width: `${(w.planned / maxWeek) * 100}%` }} /><em><Link href={retroHref(planId, "tasks", w.start, w.end)}>계획 {w.planned}분 · 근거</Link></em></div>
                  <div className="bar-line"><span className="bar act" style={{ width: `${(w.actual / maxWeek) * 100}%` }} /><em>실제 {w.actual}분 · <Link href={retroHref(planId, "actual")}>전체 기록</Link></em></div>
                </div>
                <div className="week-meta">
                  마감 {w.due_count}개 · 완료 {w.done_count}
                  {w.late_open > 0 && <span className="late"> · 못 끝냄 {w.late_open}</span>}
                  {w.late_done > 0 && <span className="muted"> · 늦게 끝냄 {w.late_done}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </details>

      <details className="acc">
        <summary>
          <span>반복해서 빗나가는 패턴 <span className="acc-hint">예상 대비 {biasText(pt.bias.ratio)} · 막힘 {pt.blocked.execs_with}건 · 제때 못 끝냄 {pctText(pt.delay.rate)}</span></span>
        </summary>
        <div className="acc-body">
          <div className="pattern-grid">
            <div>
              <h3 className="sub"><Link href={retroHref(planId, "diff")}>예상 vs 실제 (태그별) · 근거 보기</Link></h3>
              {pt.bias.ratio === null ? <p className="muted">끝낸 할 일 중 실행 기록이 있는 게 아직 없어요.</p> : (
                <>
                  <p>전체 <strong>{biasText(pt.bias.ratio)}</strong> <span className="muted">(예상 {pt.bias.est}분 → 실제 {pt.bias.actual}분, {pt.bias.n}개)</span></p>
                  <ul className="plain-list">
                    {pt.by_tag.map((x) => (
                      <li key={x.tag}><span className="badge tag">{x.tag}</span> {biasText(x.ratio)} <span className="muted">({x.n}개)</span></li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <div>
              <h3 className="sub"><Link href={retroHref(planId, "blocked")}>막힘 사유 ({pt.blocked.execs_with}/{pt.blocked.execs_total}건에 적힘) · 근거 보기</Link></h3>
              {pt.blockers.length === 0 ? <p className="muted">두 번 이상 반복된 낱말은 아직 없어요.</p> : (
                <ul className="plain-list">
                  {pt.blockers.map((b) => (
                    <li key={b.word}><strong>{b.word}</strong> <span className="muted">{b.count}번 · 예: &quot;{b.example}&quot;</span></li>
                  ))}
                </ul>
              )}
              <p className="muted">낱말은 조사를 대충 떼서 세는 근사값이라, 같은 말도 조금 다르게 나뉠 수 있어요.</p>
            </div>
            <div>
              <h3 className="sub">요일별로 실제 작업한 시간 (분)</h3>
              <div className="weekday-chart" role="img" aria-label="요일별 실제 작업 시간">
                {pt.weekday.map((m, i) => (
                  <div key={i} className="wd">
                    <span className="wd-val">{m}</span>
                    <span className="wd-bar" style={{ height: `${(m / maxDay) * 80 + (m ? 4 : 1)}px` }} />
                    <span className="wd-name">{WEEKDAY_NAMES[i]}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="sub">가장 많이 어긋난 할 일</h3>
              {pt.off_tasks.length === 0 ? <p className="muted">실행 기록이 있는 할 일이 아직 없어요.</p> : (
                <ul className="plain-list">
                  {pt.off_tasks.map((o) => (
                    <li key={o.id}><Link href={`/records?task=${o.id}`}>{o.title}</Link> <span className="muted">예상 {o.est}분 → 실제 {o.actual}분 ({o.diff > 0 ? "+" : ""}{o.diff}분)</span></li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <details id="late-evidence" className="late-details" open={pt.late_tasks.length > 0 && pt.late_tasks.length <= 6}>
            <summary><strong>제때 끝나지 않은 할 일 {pt.late_tasks.length}개</strong> <span className="muted">(숫자의 근거)</span></summary>
            {pt.late_tasks.length === 0 ? <p className="muted">마감이 지난 할 일이 모두 제때 끝났거나, 아직 마감이 지난 할 일이 없어요.</p> : (
              <ul className="plain-list" style={{ marginTop: 10 }}>
                {pt.late_tasks.map((l) => (
                  <li key={l.id}>
                    <span className={`badge ${l.state === "open" ? "p1" : "p3"}`}>{l.state === "open" ? "아직 못 끝냄" : `${mmdd(l.completed_on as string)}에 끝냄`}</span>{" "}
                    <Link href={`/records?task=${l.id}`}>{l.title}</Link> <span className="muted">마감 {l.due_date} · 예상 {l.est}분</span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </div>
      </details>

      <details className="acc" open={sugCount > 0}>
        <summary>
          <span>개선점 <span className="acc-hint">후보 {sugCount}개 · 저장한 개선점 {d.improvements.length}개</span></span>
        </summary>
        <div className="acc-body">
          <h3 className="sub">이 결과로 정해 볼 만한 개선점</h3>
          {sugCount === 0 ? <p className="muted">지금은 눈에 띄는 반복 패턴이 없어요. 실행 기록이 더 쌓이면 제안이 나와요.</p> : (
            <>
              <p className="muted" style={{ marginBottom: 10 }}>계산 결과에서 자동으로 만든 <strong>후보</strong>예요. 맞다고 생각하는 것만 저장하세요. 저장하면 회고의 개선점이 되고, 거기서 다음 계획에 반영할 수 있어요.</p>
              <ul className="suggest-list">
                {d.verdict.suggestions.map((s) => (
                  <li key={s}>
                    <span>{s}</span>
                    {saved.includes(s) || d.improvements.some((n) => n.improvement === s)
                      ? <span className="badge">저장됨</span>
                      : <button type="button" className="ghost" onClick={() => saveNote(s)}>개선점으로 저장</button>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {saveError && <p className="error">{saveError}</p>}
          {saved.length > 0 && <p className="inline-note">저장했어요. <Link href="/retro">회고에서 다음 계획 만들기 →</Link></p>}

          <h3 className="sub" style={{ marginTop: 22 }}>정한 개선점이 효과가 있었을까</h3>
          {d.improvements.length === 0 ? <p className="muted">아직 이 프로젝트에서 정한 개선점이 없어요. 위 후보를 저장하거나 회고에서 직접 적어 보세요.</p> : (
            <div style={{ display: "grid", gap: 14 }}>
              {d.improvements.map((n) => <Effect key={n.note_id} n={n} title={d.plan.title} />)}
            </div>
          )}
        </div>
      </details>
    </>
  );
}

function Chart({ series, today }: { series: SeriesPoint[]; today: string }) {
  const W = 760, H = 300, L = 54, R = 16, T = 16, B = 34;
  const maxY = Math.max(1, ...series.flatMap((p) => [p.planned, p.completed ?? 0, p.actual ?? 0]));
  const n = Math.max(series.length - 1, 1);
  const x = (i: number) => L + (i / n) * (W - L - R);
  const y = (v: number) => T + (1 - v / maxY) * (H - T - B);
  const path = (key: "planned" | "completed" | "actual") => {
    let dstr = "";
    series.forEach((pt, i) => { const v = pt[key]; if (v !== null) dstr += `${dstr ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; });
    return dstr;
  };
  const ti = series.findIndex((s) => s.date === today);
  const ticks = [0, 0.5, 1].map((r) => Math.round(maxY * r));
  const axis = (v: number) => (maxY >= 120 ? `${Math.round(v / 60)}시간` : `${v}분`);
  const xs = [0, Math.floor(series.length / 2), series.length - 1];
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="계획, 완료, 쓴 시간의 누적 그래프">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid-line" />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" className="axis">{axis(v)}</text>
        </g>
      ))}
      {xs.map((i) => series[i] && <text key={i} x={x(i)} y={H - 10} textAnchor="middle" className="axis">{mmdd(series[i].date)}</text>)}
      {ti >= 0 && (
        <g>
          <line x1={x(ti)} x2={x(ti)} y1={T} y2={H - B} className="today-line" />
          <text x={Math.max(x(ti), L + 18)} y={T + 10} textAnchor="middle" className="today-text">오늘</text>
        </g>
      )}
      <path d={path("planned")} className="ln plan" fill="none" />
      <path d={path("actual")} className="ln act" fill="none" />
      <path d={path("completed")} className="ln done" fill="none" />
    </svg>
  );
}

function Effect({ n, title }: { n: Improvement; title: string }) {
  const rows: { label: string; from: string; next: string; verdict: "better" | "worse" | "same" | null }[] = [];
  if (n.next) {
    const a = n.from, b = n.next.metrics;
    const cmp = (x: number | null, y: number | null, goodWhen: "higher" | "lower" | "closer1") => {
      if (x === null || y === null) return null;
      const dx = goodWhen === "closer1" ? Math.abs(x - 1) : x, dy = goodWhen === "closer1" ? Math.abs(y - 1) : y;
      if (Math.abs(dy - dx) < 0.03) return "same" as const;
      return (goodWhen === "higher" ? dy > dx : dy < dx) ? ("better" as const) : ("worse" as const);
    };
    rows.push({ label: "완료율", from: pctText(a.done_rate), next: pctText(b.done_rate), verdict: cmp(a.done_rate, b.done_rate, "higher") });
    rows.push({ label: "예상 대비 실제 (0%에 가까울수록 정확)", from: biasText(a.bias_ratio), next: biasText(b.bias_ratio), verdict: cmp(a.bias_ratio, b.bias_ratio, "closer1") });
    rows.push({ label: "제때 못 끝낸 비율", from: pctText(a.delay_rate), next: pctText(b.delay_rate), verdict: cmp(a.delay_rate, b.delay_rate, "lower") });
    rows.push({ label: "막힘 사유가 적힌 기록 비율", from: pctText(a.blocked_rate), next: pctText(b.blocked_rate), verdict: cmp(a.blocked_rate, b.blocked_rate, "lower") });
  }
  const few = n.next && n.next.metrics.exec_count < 3;
  const mark = { better: "좋아짐", worse: "나빠짐", same: "비슷" } as const;
  return (
    <div className="note">
      <div><strong>{n.improvement}</strong></div>
      {!n.next ? (
        <p className="muted" style={{ marginTop: 6 }}>아직 다음 계획에 반영하지 않았어요. <Link href="/retro">회고에서 다음 계획 만들기 →</Link></p>
      ) : (
        <>
          <p className="muted" style={{ margin: "6px 0 10px" }}>반영한 다음 계획: <Link href={`/plans/${n.next.id}`}>{n.next.title}</Link></p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>지표</th><th>{title}</th><th>{n.next.title}</th><th>변화</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <td>{r.label}</td><td>{r.from}</td><td>{r.next}</td>
                    <td className={r.verdict ? `v-${r.verdict}` : "muted"}>{r.verdict ? mark[r.verdict] : "비교 불가"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {few && <p className="muted" style={{ marginTop: 8 }}>다음 계획의 실행 기록이 아직 {n.next.metrics.exec_count}건이라 참고용이에요. 기록이 쌓이면 다시 비교해 보세요.</p>}
        </>
      )}
    </div>
  );
}
