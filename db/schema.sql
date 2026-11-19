-- Plan-Do-See 다이어리 스키마 v2
-- 규칙: 시간은 모두 "분(minute)" 정수, 날짜(기간·마감일)는 date, 시각은 timestamptz(UTC 저장, 화면은 Asia/Seoul 표시)

-- ───────────── Plan ─────────────
create table if not exists plans (
  id                 bigserial primary key,
  title              text        not null check (char_length(title) between 1 and 200),
  start_date         date        not null,
  end_date           date        not null,
  priority           smallint    not null check (priority between 1 and 3), -- 1=높음 2=중간 3=낮음
  success_criteria   text        not null check (char_length(success_criteria) between 1 and 1000),
  estimated_minutes  integer     not null check (estimated_minutes between 0 and 100000),
  version            integer     not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (end_date >= start_date)
);

-- 카드 1: 수정 이력. 계획이 UPDATE 될 때마다 "수정 전 값"을 그대로 쌓는다. (version 1 = 최초 계획)
create table if not exists plan_revisions (
  id                 bigserial primary key,
  plan_id            bigint      not null references plans(id) on delete cascade,
  version            integer     not null,
  title              text        not null,
  start_date         date        not null,
  end_date           date        not null,
  priority           smallint    not null,
  success_criteria   text        not null,
  estimated_minutes  integer     not null,
  valid_from         timestamptz not null,               -- 이 버전이 만들어진 시각
  replaced_at        timestamptz not null default now(), -- 이 버전이 수정되어 대체된 시각
  unique (plan_id, version)
);

-- API가 실수로 이력을 빼먹어도 DB가 강제로 보존하도록 트리거로 구현
create or replace function plans_keep_revision() returns trigger as $$
begin
  if (new.title, new.start_date, new.end_date, new.priority, new.success_criteria, new.estimated_minutes)
     is distinct from
     (old.title, old.start_date, old.end_date, old.priority, old.success_criteria, old.estimated_minutes) then
    insert into plan_revisions (plan_id, version, title, start_date, end_date, priority,
                                success_criteria, estimated_minutes, valid_from)
    values (old.id, old.version, old.title, old.start_date, old.end_date, old.priority,
            old.success_criteria, old.estimated_minutes, old.updated_at);
    new.version    := old.version + 1;
    new.updated_at := now();
  else
    new.version    := old.version;
    new.updated_at := old.updated_at;
  end if;
  new.id := old.id;          -- 계획 ID는 절대 바뀌지 않음
  new.created_at := old.created_at;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_plans_keep_revision on plans;
create trigger trg_plans_keep_revision
  before update on plans
  for each row execute function plans_keep_revision();

-- 이력은 지우거나 고칠 수 없게 막음
create or replace function plan_revisions_readonly() returns trigger as $$
begin
  raise exception 'plan_revisions is append-only';
end;
$$ language plpgsql;

drop trigger if exists trg_plan_revisions_readonly on plan_revisions;
create trigger trg_plan_revisions_readonly
  before update on plan_revisions
  for each row execute function plan_revisions_readonly();

-- ───────────── Task (할 일) ─────────────
create table if not exists tasks (
  id                 bigserial primary key,
  plan_id            bigint      not null references plans(id) on delete restrict,
  title              text        not null check (char_length(title) between 1 and 200),
  due_date           date,
  priority           smallint    not null default 2 check (priority between 1 and 3),
  tags               text[]      not null default '{}',
  estimated_minutes  integer     not null default 0 check (estimated_minutes between 0 and 100000),
  status             text        not null default 'todo' check (status in ('todo', 'done')),
  deleted_at         timestamptz,                         -- 삭제는 표시만 (회고 근거 추적용)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_tasks_plan on tasks(plan_id) where deleted_at is null;

-- ───────────── Do (실행 기록) ─────────────
-- 계획/할 일 값과 분리된 별도 테이블. 실행 기록 저장은 tasks·plans 를 절대 UPDATE 하지 않음.
create table if not exists executions (
  id                 bigserial primary key,
  task_id            bigint      not null references tasks(id) on delete restrict,
  started_at         timestamptz not null,
  ended_at           timestamptz not null,
  actual_minutes     integer     not null check (actual_minutes between 0 and 100000),
  blocker            text        check (blocker is null or char_length(blocker) <= 1000),
  created_at         timestamptz not null default now(),
  check (ended_at >= started_at)
);
create index if not exists idx_exec_task on executions(task_id);

-- 카드 3: 완료 기록. 멱등성 키 UNIQUE + "할 일당 유효한 완료는 1건" 부분 UNIQUE 로 이중 방어
create table if not exists completions (
  id                 bigserial primary key,
  task_id            bigint      not null references tasks(id) on delete restrict,
  idempotency_key    uuid        not null unique,
  completed_at       timestamptz not null default now(),
  canceled_at        timestamptz                          -- 완료 취소 시 채움 (기록은 남김)
);
create unique index if not exists uq_completion_active
  on completions(task_id) where canceled_at is null;

-- ───────────── See (회고) ─────────────
create table if not exists retro_notes (
  id                 bigserial primary key,
  plan_id            bigint      not null references plans(id) on delete restrict,
  improvement        text        not null check (char_length(improvement) between 1 and 500),
  created_at         timestamptz not null default now()
);

-- 카드 4: 회고 개선점 → 다음 계획 반영
alter table plans add column if not exists source_retro_note_id bigint references retro_notes(id);

-- 외부(Supabase 공개 API)에서 직접 접근 못 하게 RLS 켬. 우리 서버는 DB 소유자 계정으로 접속.
alter table plans          enable row level security;
alter table plan_revisions enable row level security;
alter table tasks          enable row level security;
alter table executions     enable row level security;
alter table completions    enable row level security;
alter table retro_notes    enable row level security;

-- 카드 4: 회고 개선점 한 건은 다음 계획 하나에만 반영된다 (DB 가 중복 반영을 막음)
create unique index if not exists uq_plans_source_retro
  on plans(source_retro_note_id) where source_retro_note_id is not null;
