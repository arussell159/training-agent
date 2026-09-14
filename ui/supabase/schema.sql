-- Run once in the Supabase SQL editor. All long-lived coaching context stays server-side.
create extension if not exists pgcrypto;

create table if not exists coaching_config (
  athlete_id text primary key,
  vision text not null,
  instructions jsonb not null default '[]',
  race jsonb not null default '{}',
  zones jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
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
  workout_id text, comment_type text not null check (comment_type in ('pre','post','chat','coach_note')),
  body text not null, created_at timestamptz not null default now()
);
create index if not exists athlete_comments_athlete_date on athlete_comments (athlete_id, created_at desc);
create table if not exists coach_conversations (
  id uuid primary key default gen_random_uuid(), athlete_id text not null default 'default',
  title text not null default 'New conversation', messages jsonb not null default '[]',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists workout_library (
  id uuid primary key default gen_random_uuid(), athlete_id text not null default 'default',
  title text not null, sport text not null, purpose text, description text, structure jsonb default '{}',
  tags text[] default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists sync_state (
  athlete_id text primary key, last_trainingpeaks_sync timestamptz, last_backfill_at timestamptz,
  cursor jsonb default '{}', status text default 'idle', error text, updated_at timestamptz default now()
);
create or replace function prune_old_training_context() returns void language sql security definer as $$
  delete from workout_context where workout_date < now() - interval '90 days';
  delete from athlete_comments where created_at < now() - interval '90 days' and comment_type <> 'coach_note';
$$;

alter table coaching_config enable row level security;
alter table workout_context enable row level security;
alter table athlete_comments enable row level security;
alter table coach_conversations enable row level security;
alter table workout_library enable row level security;
alter table sync_state enable row level security;
-- The service-role secret is used only by the local server. No anonymous browser policies are created.
