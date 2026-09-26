-- Run once in the Supabase SQL editor. All long-lived training context stays server-side.
create extension if not exists pgcrypto;

-- Settings credentials are encrypted by the backend and inaccessible to browser roles.
create table if not exists public.app_settings (
  scope text not null default 'default', name text not null,
  encrypted_value text not null, updated_at timestamptz not null default now(),
  primary key (scope, name)
);
alter table public.app_settings enable row level security;
revoke all on table public.app_settings from public, anon, authenticated;
grant select, insert, update on table public.app_settings to service_role;

-- Annual plans are mirrored from legacy encrypted APP_DATA into a dedicated
-- backend-only table. APP_DATA remains the recovery copy during/after cutover.
create table if not exists public.annual_plans (
  scope text not null default 'default',
  plan_id text not null,
  plan jsonb not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (scope, plan_id)
);
create unique index if not exists annual_plans_one_active_per_scope
  on public.annual_plans (scope)
  where is_active;
alter table public.annual_plans enable row level security;
revoke all on table public.annual_plans from public, anon, authenticated;
grant select, insert, update, delete on table public.annual_plans to service_role;

create table if not exists workout_context (
  id text primary key,
  athlete_id text not null default 'default',
  workout_date timestamptz not null,
  sport text, title text, planned jsonb default '{}', completed jsonb default '{}',
  recovery jsonb default '{}', compliance numeric, risk_level text,
  failure_signals jsonb default '[]', source_updated_at timestamptz, synced_at timestamptz default now()
);
create index if not exists workout_context_athlete_date on workout_context (athlete_id, workout_date desc);
create table if not exists athlete_comments (
  id uuid primary key default gen_random_uuid(), athlete_id text not null default 'default',
  workout_id text, comment_type text not null check (comment_type in ('pre','post')),
  body text not null, created_at timestamptz not null default now()
);
create index if not exists athlete_comments_athlete_date on athlete_comments (athlete_id, created_at desc);
create table if not exists workout_library (
  id uuid primary key default gen_random_uuid(), athlete_id text not null default 'default',
  title text not null, sport text not null, purpose text, description text, structure jsonb default '{}',
  tags text[] default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists sync_state (
  athlete_id text primary key, last_backfill_at timestamptz,
  cursor jsonb default '{}', status text default 'idle', error text, updated_at timestamptz default now()
);
-- App-owned Section 11 reports. Legacy encrypted report records and Intervals.icu
-- notes are copied here during the one-time catalog migration; neither is deleted.
create table if not exists public.coach_reports (
  id text primary key,
  scope text not null default 'default',
  athlete_id text not null default 'default',
  kind text not null check (kind ~ '^[a-z][a-z0-9_]{0,63}$'),
  sport text,
  workout_id text,
  event_id text,
  activity_id text,
  plan_id text,
  start_date date not null,
  end_date date not null,
  title text not null,
  body text not null,
  generated_at timestamptz not null,
  source_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_reports_date_order check (end_date >= start_date),
  constraint coach_reports_source_key_unique unique (scope, source_key)
);
create index if not exists coach_reports_scope_generated_at
  on public.coach_reports (scope, generated_at desc);
alter table public.coach_reports enable row level security;
revoke all on table public.coach_reports from public, anon, authenticated;
grant select, insert, update on table public.coach_reports to service_role;
-- status='ready' rows contain normal training snapshots. Backend-only
-- status='archived', athlete_id='completed:v1:<connection-hash>:<activity>:<kind>'
-- rows retain completed-workout source data and downloaded charts/routes.
-- These archive rows are intentionally not pruned by the 90-day context RPC.
-- kind='bundle' contains all streams, ready-to-display views and original-file
-- bytes/checksum. Large cursor.data payloads use encoding='gzip-json-v1'.
-- Ready snapshots retain the 12-week app window and the wellness/performance
-- lead-in needed for baseline charts. Older archived activity rows are preserved.
create or replace function prune_old_training_context() returns void language sql security definer as $$
  delete from workout_context where workout_date < now() - interval '90 days';
  delete from athlete_comments where created_at < now() - interval '90 days' and comment_type in ('pre','post');
$$;

alter table workout_context enable row level security;
alter table athlete_comments enable row level security;
alter table workout_library enable row level security;
alter table sync_state enable row level security;
-- The service-role secret is used only by the local server. No anonymous browser policies are created.
