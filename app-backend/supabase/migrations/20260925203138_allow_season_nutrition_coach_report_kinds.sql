-- Allow additional report categories under the Coach page's Others filter.
-- Run this once against an existing Supabase project in the SQL editor.
alter table public.coach_reports
  drop constraint if exists coach_reports_kind_check;

alter table public.coach_reports
  add constraint coach_reports_kind_check
  check (kind in ('pre_workout', 'post_workout', 'weekly', 'block', 'season', 'nutrition'));
