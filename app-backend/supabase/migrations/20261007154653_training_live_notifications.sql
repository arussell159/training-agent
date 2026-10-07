-- Only an authenticated app request can mint a 256-bit, expiring capability.
-- Broadcasts carry a version, never workouts, identity, credentials or health data.
alter table public.sync_state add column if not exists view_version text
  generated always as (cursor ->> 'version') stored;

create table public.training_live_channels (
  topic text primary key check (topic ~ '^training:[a-f0-9]{64}$'),
  view_id text not null,
  expires_at timestamptz not null
);
create index training_live_channels_view_expiry on public.training_live_channels (view_id, expires_at);
create index training_live_channels_expiry on public.training_live_channels (expires_at);
alter table public.training_live_channels enable row level security;
revoke all on public.training_live_channels from public, anon, authenticated;
grant all on public.training_live_channels to service_role;

create function public.can_receive_training_live() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.training_live_channels
    where topic = (select realtime.topic()) and expires_at > now()
  );
$$;
revoke all on function public.can_receive_training_live() from public;
grant execute on function public.can_receive_training_live() to anon, authenticated;
create policy training_live_receive on realtime.messages for select to anon, authenticated
  using (extension = 'broadcast' and (select public.can_receive_training_live()));
-- No INSERT/Presence policies: a browser can receive invalidations, never publish.

create function public.register_training_live(p_topic text, p_view_id text, p_expires_at timestamptz)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_expires_at > now() + interval '1 hour' or p_expires_at <= now() then
    raise exception 'Invalid notification expiry';
  end if;
  delete from public.training_live_channels where expires_at <= now();
  insert into public.training_live_channels(topic, view_id, expires_at)
    values (p_topic, p_view_id, p_expires_at);
end;
$$;
revoke all on function public.register_training_live(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.register_training_live(text, text, timestamptz) to service_role;

create function public.notify_training_live() returns trigger
language plpgsql security definer set search_path = '' as $$
declare destination text;
begin
  if new.status = 'view' and new.athlete_id like 'view:v1:%:training'
    and new.view_version is not null
    and (tg_op = 'INSERT' or new.view_version is distinct from old.view_version) then
    for destination in select topic from public.training_live_channels
      where view_id = new.athlete_id and expires_at > now()
    loop
      perform realtime.send(jsonb_build_object('version', new.view_version), 'training_changed', destination, true);
    end loop;
  end if;
  return null;
end;
$$;
revoke all on function public.notify_training_live() from public, anon, authenticated;
create trigger training_live_changed after insert or update on public.sync_state
  for each row execute function public.notify_training_live();
