-- One round trip and transaction for both prepared views. A late provider job
-- cannot overwrite a newer optimistic or verified calendar mutation.
create function public.save_training_views(p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare item jsonb; full_id text; result jsonb;
begin
  if jsonb_array_length(p_rows) <> 2 then raise exception 'Expected two training views'; end if;
  for item in select value from jsonb_array_elements(p_rows) order by value->>'athlete_id'
  loop
    if (item->>'athlete_id') !~ '^view:v1:[a-f0-9]{64}:(training|startup)$'
      or item->>'status' <> 'view' then raise exception 'Invalid training view'; end if;
    insert into public.sync_state as existing(athlete_id, status, cursor, updated_at)
      values (item->>'athlete_id', 'view', item->'cursor', clock_timestamp())
    on conflict (athlete_id) do update set status = excluded.status,
      cursor = excluded.cursor, updated_at = greatest(clock_timestamp(), existing.updated_at + interval '1 microsecond')
    where existing.cursor->>'queue_snapshot_revision' is null
      or ((excluded.cursor->>'queue_snapshot_revision') is not null
        and (excluded.cursor->>'queue_snapshot_revision')::timestamptz > (existing.cursor->>'queue_snapshot_revision')::timestamptz);
    if (item->>'athlete_id') like '%:training' then full_id := item->>'athlete_id'; end if;
  end loop;
  select jsonb_build_object('version', view_version, 'revision', cursor->>'queue_snapshot_revision')
    into result from public.sync_state where athlete_id = full_id;
  return result;
end;
$$;
revoke all on function public.save_training_views(jsonb) from public, anon, authenticated;
grant execute on function public.save_training_views(jsonb) to service_role;
