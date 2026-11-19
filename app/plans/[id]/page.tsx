import { Suspense } from "react";
import PlanView from "./PlanView";

export default function PlanPage() {
  return (
    <Suspense fallback={<p className="muted">불러오는 중…</p>}>
      <PlanView />
    </Suspense>
  );
}
