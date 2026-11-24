"use client";
import { useState, useSyncExternalStore } from "react";
import { api, dateTime, kstToday, mdKo, noopSubscribe } from "@/lib/format";
import { OUTLIER_MINUTES, WEEK_STARTS_ON, type ChangeEvidence, type SChange, type Summary } from "@/lib/summaryCalc";
import { useApi } from "@/lib/useApi";
import { Stat } from "../ui";

// 시작일을 정하기 전에는 근거 계산이 없으므로 규칙 변경 기록은 근거 없이 온다
type ChangeView = SChange & Partial<Pick<ChangeEvidence, "before_last" | "after_first" | "order_ok">>;
type Resp = Omit<Partial<Summary>, "changes"> & { configured: boolean; changes: ChangeView[] };

// 5일 사용 요약 (T07-C132 등): 화면의 합계·평균은 lib/summaryCalc.ts 가 계산한다. (scripts/test-summary-calc.mjs 가 손으로 구한 값과 대조)
export default function FiveDaySummary({ refreshKey }: { refreshKey: string }) {
  const today = useSyncExternalStore(noopSubscribe, kstToday, () => null);
  const { data, error, reload } = useApi<Resp>(`/api/summary?k=${refreshKey}`);
  const [startPick, setStartPick] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ rule_name: "", old_value: "", new_value: "", reason: "" });

  async function saveStart() {
    const date = startPick || today;
    if (!date) return;
    setBusy(true); setMsg("");
    try { await api("/api/summary/start", { method: "POST", body: JSON.stringify({ date }) }); reload(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "저장하지 못했어요"); }
    finally { setBusy(false); }
  }

  async function saveChange(e: React.FormEvent) {
    e.preventDefault();
    const already = (data?.changes.length ?? 0) > 0;
    const ask = `${already ? "이미 규칙 변경이 1건 있어요. 5일 사용에서는 규칙을 하나만 바꾸는 것이 기준이에요.\n\n" : ""}변경을 기록할까요?\n\n바뀐 시각은 서버가 지금 시각으로 남기고, 한 번 기록하면 고치거나 지울 수 없어요.`;
    if (!window.confirm(ask)) return;
    setBusy(true); setMsg("");
    try {
      await api("/api/rule-changes", { method: "POST", body: JSON.stringify(f) });
      setF({ rule_name: "", old_value: "", new_value: "", reason: "" });
      setMsg("규칙 변경을 기록했어요.");
      reload();
    } catch (err) { setMsg(err instanceof Error ? err.message : "저장하지 못했어요"); }
    finally { setBusy(false); }
  }

  if (error) return <section className="card"><p className="error">{error}</p></section>;
  if (!data) return <section className="card"><p className="muted">5일 요약을 불러오는 중…</p></section>;

  const s = data.configured ? (data as unknown as Summary) : null;
  const cmp = s?.comparison ?? null;

  return (
    // 시작일을 정하기 전에는 눈에 띄게 열어 두고(시작일을 정해야 하므로), 정한 뒤에는 접어서 한 줄만 보여 준다
    <details className="acc five" open={!s}>
      <summary>
        <span>5일 사용 요약 <span className="acc-hint">
          {s ? `${mdKo(s.start)}~${mdKo(s.end)} · 합계 ${s.total}분 · 하루 평균 ${s.average === null ? "-" : `${s.average}분`}` : "시작일을 정해 주세요"}
        </span></span>
      </summary>
      <div className="acc-body">
      <p className="five-q"><b>질문</b> 내 큰 프로젝트가 계획한 만큼 실제로 진행되고 있는가? · <b>지표</b> 하루 실제 작업 시간 합계 (분)</p>

      {!s ? (
        <div className="five-start">
          <p>5일 사용을 시작한 날을 정하면, 그날부터 5일의 작업 시간을 날짜별로 모아서 합계와 평균을 보여 드려요.</p>
          <div className="row">
            <input type="date" value={startPick || today || ""} onChange={(e) => setStartPick(e.target.value)} aria-label="5일 사용 시작일" />
            <button type="button" disabled={busy || !(startPick || today)} onClick={saveStart}>이 날부터 5일 시작</button>
          </div>
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <Stat label="5일 합계" value={`${s.total}분`} hint={`지난 ${s.counted_days}일 기준 (이상값·아직 안 지난 날 제외)`} />
            <Stat label="하루 평균" value={s.average === null ? "-" : `${s.average}분`} hint="합계 ÷ 지난 날 수, 반올림" />
            <Stat label="기록 없는 날" value={`${s.days.filter((d) => d.status === "missing").length}일`} hint="0분으로 계산" />
          </div>

          <div className="table-wrap">
            <table className="five-table">
              <thead><tr><th>날짜</th><th>기록</th><th>작업 시간</th><th>상태</th></tr></thead>
              <tbody>
                {s.days.map((d) => (
                  <tr key={d.date} className={d.date === s.today ? "five-today" : ""}>
                    <td><b>{d.day_no}일차</b> <span className="muted">{mdKo(d.date)}</span>{d.date === s.today && <span className="today-pill" style={{ marginLeft: 6 }}>오늘</span>}</td>
                    <td>{d.status === "future" ? "-" : <>{`${d.count}건${d.duplicates ? ` (중복 ${d.duplicates}건 제외)` : ""}`}{d.record_ids.length > 0 && <span className="muted"> · {d.record_ids.map((n) => `#${n}`).join(" ")}</span>}</>}</td>
                    <td className="five-min">{d.status === "future" ? "-" : d.status === "outlier" ? <span title="합계에서 제외">{d.raw_minutes}분</span> : `${d.minutes}분`}</td>
                    <td>
                      {d.status === "missing" && <span className="pill warn">기록 없음 · 0분 계산</span>}
                      {d.status === "outlier" && <span className="pill bad">이상값 · 합계에서 제외</span>}
                      {d.status === "future" && <span className="pill">아직 안 지남</span>}
                      {d.status === "ok" && <span className="pill ok">정상</span>}
                      {d.period && <span className={`pill ${d.period === "before" ? "" : "acc"}`}>규칙 변경 {d.period === "before" ? "전" : "후"}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details className="five-rules">
            <summary>계산 규칙 보기 (1일차에 정한 것, 바꾸지 않아요)</summary>
            <ul>
              <li><b>지표·단위</b> 하루 실제 작업 시간 합계, 분(정수). 날짜는 한국 시간 기준</li>
              <li><b>결측값</b> 기록 없는 날은 0분으로 계산하고 &quot;기록 없음&quot;으로 표시, 평균의 날 수에 포함</li>
              <li><b>중복값</b> 같은 할 일·같은 시작 시각의 기록은 1건으로 계산</li>
              <li><b>이상값</b> 하루 합계가 {OUTLIER_MINUTES}분(16시간)을 넘으면 입력 오류로 보고 합계·평균에서 제외하고 표시</li>
              <li><b>반올림</b> 하루 평균은 소수점 첫째 자리에서 반올림해 정수 분으로</li>
              <li><b>주 시작 요일</b> {WEEK_STARTS_ON}</li>
              <li><b>평균</b> 오늘까지 지난 날만 계산 (아직 안 지난 날은 제외)</li>
              <li><b>규칙 변경 전·후</b> 변경 시각의 한국 날짜보다 앞선 날은 전, 뒤의 날은 후. 변경한 날은 그날 첫 기록이 변경 시각보다 먼저 저장됐으면 전, 아니면 후</li>
            </ul>
          </details>
        </>
      )}

      <h3 className="sub">계획 규칙 변경 기록 <span className="muted">(5일 사용 중 규칙은 하나만 바꿔요)</span></h3>
      {data.changes.length === 0 ? <p className="muted">아직 바꾼 규칙이 없어요.</p> : (
        <ul className="change-list">
          {data.changes.map((c) => (
            <li key={c.id}>
              <div className="change-when">{dateTime(c.changed_at)} <span className="muted">(서버가 기록한 시각)</span></div>
              <div><b>{c.rule_name}</b>: {c.old_value} → <b>{c.new_value}</b></div>
              <div className="change-reason"><span className="rec-block-label">이유</span>{c.reason}</div>
              {c.order_ok !== undefined && (
                <div className="change-proof">
                  <b>근거 (서버가 저장한 시각 기준)</b>
                  <span>변경 전 마지막 기록: {c.before_last ? `#${c.before_last.id} · ${c.before_last.day_no}일차 ${mdKo(c.before_last.date)}` : "없음"}</span>
                  <span>변경 후 첫 기록: {c.after_first ? `#${c.after_first.id} · ${c.after_first.day_no}일차 ${mdKo(c.after_first.date)}` : "아직 없음"}</span>
                  <span className={c.order_ok ? "ok" : "bad"}>
                    {c.order_ok ? "✓ 2일차 기록 뒤 · 3일차 기록 앞에 기록됨" : "✗ 기준(2일차 기록을 마친 뒤, 3일차 기록 전)과 다르게 기록됨 — 이유를 문서에 적어 주세요"}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {cmp && (
        <div className="cmp-card">
          <div className="cmp-title">규칙 바꾸기 전과 후 비교 <span className="muted">(같은 지표·같은 단위·같은 계산 규칙)</span></div>
          <div className="cmp-row">
            <div><span className="muted">변경 전 {cmp.before.days}일</span><b>{cmp.before.average === null ? "-" : `하루 평균 ${cmp.before.average}분`}</b><span className="muted">합계 {cmp.before.total}분</span></div>
            <div className="cmp-arrow">→</div>
            <div><span className="muted">변경 후 {cmp.after.days}일</span><b>{cmp.after.average === null ? "-" : `하루 평균 ${cmp.after.average}분`}</b><span className="muted">합계 {cmp.after.total}분</span></div>
            <div className={`cmp-diff ${cmp.diff !== null && cmp.diff < 0 ? "bad" : "ok"}`}>{cmp.diff === null ? "-" : `${cmp.diff > 0 ? "+" : ""}${cmp.diff}분`}</div>
          </div>
          <p className="muted">결과가 나빠졌어도 그대로 보여요. 왜 그런지는 직접 한 줄로 적어 두세요.</p>
        </div>
      )}

      <details className="five-form">
        <summary>규칙 바꾸기 (변경 기록 남기기)</summary>
        <form onSubmit={saveChange} className="auth-form" style={{ maxWidth: 560 }}>
          <label>바꾼 규칙<input value={f.rule_name} maxLength={200} required placeholder="예: 하루 목표 작업 시간" onChange={(e) => setF({ ...f, rule_name: e.target.value })} /></label>
          <label>이전 값<input value={f.old_value} maxLength={200} required placeholder="예: 60분" onChange={(e) => setF({ ...f, old_value: e.target.value })} /></label>
          <label>새 값<input value={f.new_value} maxLength={200} required placeholder="예: 90분" onChange={(e) => setF({ ...f, new_value: e.target.value })} /></label>
          <label>바꾼 이유<textarea value={f.reason} maxLength={1000} required style={{ minHeight: 70 }} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
          <p className="muted">바꾼 시각은 서버가 지금 시각으로 남겨요. 2일차 기록을 마친 뒤, 3일차 기록을 하기 전에 기록하세요.</p>
          <button type="submit" disabled={busy}>변경 기록 남기기</button>
        </form>
      </details>
      {msg && <p className="inline-note" style={{ marginTop: 10 }}>{msg}</p>}
      </div>
    </details>
  );
}
