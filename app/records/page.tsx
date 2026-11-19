import { Suspense } from "react";
import RecordsView from "./RecordsView";

export default function RecordsPage() {
  return (
    <Suspense fallback={<p className="muted">불러오는 중…</p>}>
      <RecordsView />
    </Suspense>
  );
}
