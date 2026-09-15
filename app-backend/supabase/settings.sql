-- Run once in your existing Supabase project's SQL editor.
-- This is a single-user, backend-only store. Never add browser policies to this table.
begin;
create table if not exists public.app_settings (
  scope text not null default 'default',
  name text not null,
  encrypted_value text not null,
  updated_at timestamptz not null default now(),
  primary key (scope, name)
);
alter table public.app_settings enable row level security;
revoke all on table public.app_settings from public, anon, authenticated;
grant select, insert, update on table public.app_settings to service_role;
commit;
