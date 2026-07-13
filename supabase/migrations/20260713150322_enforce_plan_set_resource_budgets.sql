-- Serialize every plan_files size mutation per plan set so direct PostgREST
-- writes and concurrent uploads cannot exceed the worker's aggregate budget.

create or replace function public.enforce_plan_set_resource_budget()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_file_count bigint;
  v_existing_total_size_bytes bigint;
begin
  if new.plan_set_id is null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.plan_set_id::text, 0)
  );

  if new.file_size_bytes is null
    or new.file_size_bytes <= 0
    or new.file_size_bytes > 52428800
  then
    raise exception using
      errcode = '23514',
      message = 'PLAN_FILE_SIZE_BUDGET_EXCEEDED';
  end if;

  if tg_op = 'INSERT' then
    select
      pg_catalog.count(*),
      coalesce(pg_catalog.sum(pf.file_size_bytes)::bigint, 0::bigint)
    into
      v_existing_file_count,
      v_existing_total_size_bytes
    from public.plan_files pf
    where pf.plan_set_id = new.plan_set_id;
  else
    select
      pg_catalog.count(*),
      coalesce(pg_catalog.sum(pf.file_size_bytes)::bigint, 0::bigint)
    into
      v_existing_file_count,
      v_existing_total_size_bytes
    from public.plan_files pf
    where pf.plan_set_id = new.plan_set_id
      and pf.id <> old.id;
  end if;

  if v_existing_file_count + 1 > 20 then
    raise exception using
      errcode = '23514',
      message = 'PLAN_SET_FILE_COUNT_BUDGET_EXCEEDED';
  end if;

  if v_existing_total_size_bytes + new.file_size_bytes > 104857600 then
    raise exception using
      errcode = '23514',
      message = 'PLAN_SET_TOTAL_SIZE_BUDGET_EXCEEDED';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_plan_set_resource_budget()
  from public;

drop trigger if exists aab_enforce_plan_set_resource_budget
  on public.plan_files;
create trigger aab_enforce_plan_set_resource_budget
  before insert or update of plan_set_id, file_size_bytes
  on public.plan_files
  for each row execute function public.enforce_plan_set_resource_budget();
