-- NGCC Proactive Federal Procurement Engine
-- Operational persistence only: stores APROPOS mission execution state and evidence.
-- SAM.gov remains authoritative for opportunity and registered-entity data.

create table if not exists public.ngcc_procurement_missions (
  id uuid primary key default gen_random_uuid(),
  mission_number text not null unique,
  sam_notice_id text not null,
  solicitation_number text,
  contract_title text,
  issuing_agency text,
  source_url text,
  current_step text not null default 'CONTRACT_DNA',
  overall_status text not null default 'ACTIVE',
  completion_percentage integer not null default 12 check (completion_percentage between 0 and 100),
  next_required_action text,
  waiting_condition text,
  selected_opportunity_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

create index if not exists ngcc_procurement_missions_notice_idx
  on public.ngcc_procurement_missions(sam_notice_id, created_at desc);
create index if not exists ngcc_procurement_missions_status_idx
  on public.ngcc_procurement_missions(overall_status, last_activity_at desc);

create table if not exists public.ngcc_procurement_mission_steps (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.ngcc_procurement_missions(id) on delete cascade,
  step_code text not null,
  step_name text not null,
  sequence_number integer not null,
  status text not null default 'NOT_STARTED',
  progress_percentage integer not null default 0 check (progress_percentage between 0 and 100),
  current_activity text,
  started_at timestamptz,
  last_heartbeat_at timestamptz,
  completed_at timestamptz,
  records_examined integer not null default 0,
  records_accepted integer not null default 0,
  records_rejected integer not null default 0,
  output_summary jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  error_code text,
  error_message text,
  retry_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(mission_id, step_code),
  unique(mission_id, sequence_number)
);

create index if not exists ngcc_procurement_mission_steps_mission_idx
  on public.ngcc_procurement_mission_steps(mission_id, sequence_number);

create table if not exists public.ngcc_procurement_mission_events (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.ngcc_procurement_missions(id) on delete cascade,
  event_type text not null,
  event_summary text not null,
  event_payload jsonb not null default '{}'::jsonb,
  actor_type text not null default 'SYSTEM',
  created_at timestamptz not null default now()
);

create index if not exists ngcc_procurement_mission_events_mission_idx
  on public.ngcc_procurement_mission_events(mission_id, created_at desc);

alter table public.ngcc_procurement_missions enable row level security;
alter table public.ngcc_procurement_mission_steps enable row level security;
alter table public.ngcc_procurement_mission_events enable row level security;

-- No browser policies are created intentionally. These tables are internal operator
-- state and are accessed only by server-side Netlify functions using the service role.
