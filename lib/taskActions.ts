// 할 일 완료/완료 취소 (브라우저에서 호출). 여러 화면이 같은 규칙을 쓰도록 한곳에 둔다.
import { api } from "./format";
import type { Task } from "./types";

// 클릭마다 새 멱등성 키를 만들지만, 서버가 "할 일당 유효한 완료 1건"을 DB 제약으로 보장한다.
export const completeTask = (id: number) =>
  api(`/api/tasks/${id}/complete`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } });

export const uncompleteTask = (id: number) => api(`/api/tasks/${id}/complete`, { method: "DELETE" });

export const toggleTask = (t: Pick<Task, "id" | "status">) => (t.status === "done" ? uncompleteTask(t.id) : completeTask(t.id));
