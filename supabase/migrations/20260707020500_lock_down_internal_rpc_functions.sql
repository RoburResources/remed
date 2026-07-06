create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.claim_next_task(text, integer) from public, anon, authenticated;
revoke execute on function public.expire_old_approvals() from public, anon, authenticated;
revoke execute on function public.increment_daily_metric(text, integer) from public, anon, authenticated;
revoke execute on function public.recover_stale_in_progress_tasks(integer, integer) from public, anon, authenticated;

grant execute on function public.claim_next_task(text, integer) to service_role;
grant execute on function public.expire_old_approvals() to service_role;
grant execute on function public.increment_daily_metric(text, integer) to service_role;
grant execute on function public.recover_stale_in_progress_tasks(integer, integer) to service_role;

alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
