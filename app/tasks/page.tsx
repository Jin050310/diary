import { Suspense } from "react";
import TasksView from "./TasksView";

export default function TasksPage() {
  return (
    <Suspense fallback={<p className="muted">불러오는 중…</p>}>
      <TasksView />
    </Suspense>
  );
}
