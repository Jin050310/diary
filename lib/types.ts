export type Plan = {
  id: number;
  title: string;
  start_date: string;
  end_date: string;
  priority: number;
  success_criteria: string;
  estimated_minutes: number;
  version: number;
  source_retro_note_id: number | null;
  source_improvement?: string | null;
  source_plan_id?: number | null;
  created_at: string;
  updated_at: string;
  revision_count?: number;
  task_count?: number;
};

export type PlanRevision = Omit<Plan, "id" | "created_at" | "updated_at" | "source_retro_note_id"> & {
  id: number;
  plan_id: number;
  valid_from: string;
  replaced_at: string;
};

export type PlanInput = Pick<Plan, "title" | "start_date" | "end_date" | "priority" | "success_criteria" | "estimated_minutes">;

export type Task = {
  id: number;
  plan_id: number;
  plan_title?: string;
  title: string;
  due_date: string | null;
  priority: number;
  tags: string[];
  estimated_minutes: number;
  status: "todo" | "done";
  exec_count?: number;
  actual_minutes?: number;
  created_at: string;
  updated_at: string;
};

export type TaskInput = Pick<Task, "plan_id" | "title" | "due_date" | "priority" | "tags" | "estimated_minutes">;

export type Execution = {
  id: number;
  task_id: number;
  task_title: string;
  plan_id: number;
  plan_title: string;
  started_at: string;
  ended_at: string;
  actual_minutes: number;
  blocker: string | null;
  created_at: string;
};

export type Completion = {
  id: number;
  task_id: number;
  task_title: string;
  plan_title: string;
  idempotency_key: string;
  completed_at: string;
  canceled_at: string | null;
};

export type RetroTask = {
  id: number; title: string; plan_id: number; plan_title: string; due_date: string | null;
  status: "todo" | "done"; estimated_minutes: number; actual_minutes: number; exec_count: number;
  blocked: boolean; late: boolean;
};
export type RetroExecution = {
  id: number; task_id: number; task_title: string; started_at: string; ended_at: string;
  actual_minutes: number; blocker: string | null;
};
export type Retro = {
  today: string;
  filters: { plan: number | null; from: string | null; to: string | null };
  totals: {
    task_count: number; done_count: number; late_count: number; blocked_count: number;
    estimated_minutes: number; actual_minutes: number; diff_minutes: number;
  };
  tasks: RetroTask[];
  executions: RetroExecution[];
};
export type RetroNote = {
  id: number; plan_id: number; plan_title: string; improvement: string; created_at: string;
  next_plan_id: number | null; next_plan_title: string | null;
};
