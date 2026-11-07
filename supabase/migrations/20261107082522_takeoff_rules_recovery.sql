-- TI-677 C: cheap presence probe, and a guided decision bound to the computation the user saw.
-- Existing inputs remain authoritative regardless of the worker's feature flag.
create function public.takeoff_rule_version_has_inputs(p_tenant_id uuid, p_estimate_version_id uuid)
returns boolean
language sql stable security invoker
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1 from public.takeoff_jobs j
    join public.takeoff_items i on i.job_id = j.id and i.tenant_id = j.tenant_id
    where j.tenant_id = p_tenant_id and j.estimate_version_id = p_estimate_version_id
      and j.status in ('completed', 'applied') and i.metadata ? 'rule_inputs'
  );
$$;
revoke all on function public.takeoff_rule_version_has_inputs(uuid, uuid) from public, anon, authenticated;
grant execute on function public.takeoff_rule_version_has_inputs(uuid, uuid) to service_role;

-- The ordinary review RPC is preserved. Guided actions use this overload and the same RLS/whitelist/attestations.
-- Peer invalidation does not move updated_at; rules_stale and rules_evaluated_at therefore belong to the decision's
-- optimistic check, under the version lock, before any row lock. A stale view cannot deduct both copies of a run.
create function public.update_takeoff_item_for_review(
  p_tenant_id uuid, p_job_id uuid, p_item_id uuid, p_expected_updated_at timestamptz,
  p_fields jsonb, p_expected_rules_evaluated_at timestamptz
)
returns setof public.takeoff_items
language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $$
declare version_id uuid;
begin
  select j.estimate_version_id into version_id from public.takeoff_jobs j
  where j.id = p_job_id and j.tenant_id = p_tenant_id;
  if version_id is null or p_expected_rules_evaluated_at is null then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-rules:' || version_id::text, 0));
  if not exists (
    select 1 from public.takeoff_items i
    where i.id = p_item_id and i.job_id = p_job_id and i.tenant_id = p_tenant_id
      and not i.rules_stale and i.rules_evaluated_at = p_expected_rules_evaluated_at
  ) then return; end if;
  return query select * from public.update_takeoff_item_for_review(
    p_tenant_id, p_job_id, p_item_id, p_expected_updated_at, p_fields
  );
end;
$$;
revoke all on function public.update_takeoff_item_for_review(uuid, uuid, uuid, timestamptz, jsonb, timestamptz)
  from public, anon;
grant execute on function public.update_takeoff_item_for_review(uuid, uuid, uuid, timestamptz, jsonb, timestamptz)
  to authenticated, service_role;

-- Application excludes the mapping's skipped/assembly lines without the ordinary invalidation. At its completion
-- the remaining jobs must be re-evaluated with those exclusions. Guarded application already holds the version lock.
create function public.stale_takeoff_rule_peers_after_apply()
returns trigger language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  update public.takeoff_items i set rules_stale = true, rules_stale_at = pg_catalog.clock_timestamp()
  from public.takeoff_jobs j
  where j.id = i.job_id and j.tenant_id = i.tenant_id and j.tenant_id = new.tenant_id
    and j.estimate_version_id = new.estimate_version_id and j.status = 'completed'
    and (i.rules_evaluated_at is not null or i.metadata ? 'rule_inputs');
  return new;
end;
$$;
revoke all on function public.stale_takeoff_rule_peers_after_apply() from public, anon, authenticated, service_role;
create trigger stale_takeoff_rule_peers_after_apply after update of status on public.takeoff_jobs
for each row when (new.status = 'applied' and old.status is distinct from new.status)
execute function public.stale_takeoff_rule_peers_after_apply();
