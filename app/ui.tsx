"use client";
import type { ReactNode } from "react";

// 모든 화면이 같은 모양을 쓰도록 모아 둔 공통 부품

// 화면 맨 위: 제목 + "이 화면에서 무엇을 하나요" 한 줄 + 오른쪽 주요 버튼
export function PageHead({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {hint && <p className="page-hint">{hint}</p>}
      </div>
      {children && <div className="page-head-actions">{children}</div>}
    </header>
  );
}

// 필터·기간처럼 "하나를 고르는" 버튼 줄 (선택지가 한눈에 보인다)
export function Chips<T extends string>({
  value, options, onChange, label,
}: {
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={`chip${o.value === value ? " on" : ""}`} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined && <span className="chip-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// 얼마나 했는지 막대로
export function ProgressBar({ value, max, tone = "accent" }: { value: number; max: number; tone?: "accent" | "warn" | "ok" }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  return (
    <div className={`progress ${tone}`} role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

// 결과 숫자 카드 (눌러서 근거를 보는 카드는 onClick 또는 href 를 쓴다)
export function Stat({ label, value, hint, tone, small }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "bad" | "ok"; small?: boolean }) {
  return (
    <div className={`stat${tone ? ` ${tone}` : ""}${small ? " small" : ""}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}
