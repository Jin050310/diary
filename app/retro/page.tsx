import { Suspense } from "react";
import RetroView from "./RetroView";

export default function RetroPage() {
  return (
    <Suspense fallback={<p className="muted">불러오는 중…</p>}>
      <RetroView />
    </Suspense>
  );
}
