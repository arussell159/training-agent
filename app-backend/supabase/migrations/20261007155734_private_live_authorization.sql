-- Realtime evaluates this helper internally; it is not a public RPC endpoint.
create schema if not exists training_private;
revoke all on schema training_private from public;
grant usage on schema training_private to anon, authenticated;
alter function public.can_receive_training_live() set schema training_private;
