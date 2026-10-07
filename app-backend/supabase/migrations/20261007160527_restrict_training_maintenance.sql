-- Maintenance is server-only, including when an anonymous Realtime key is public.
revoke all on function public.prune_old_training_context() from public, anon, authenticated;
grant execute on function public.prune_old_training_context() to service_role;
alter function public.prune_old_training_context() set search_path = public, pg_temp;
