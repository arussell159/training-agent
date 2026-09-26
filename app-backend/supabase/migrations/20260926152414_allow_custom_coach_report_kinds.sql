alter table public.coach_reports
  drop constraint if exists coach_reports_kind_check;

alter table public.coach_reports
  add constraint coach_reports_kind_check
  check (kind ~ '^[a-z][a-z0-9_]{0,63}$');
