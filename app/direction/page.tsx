import { Suspense } from "react";
import DirectionView from "./DirectionView";

export default function DirectionPage() {
  return (
    <Suspense fallback={<p className="muted">불러오는 중…</p>}>
      <DirectionView />
    </Suspense>
  );
}
