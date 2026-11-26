begin;

create table private.estimate_generation_execution_locks (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  operation text not null check (operation in ('structure_draft', 'version_zero_draft')),
  token uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  primary key (tenant_id, version_id, operation)
);

create index on private.estimate_generation_execution_locks (version_id);
create index on private.estimate_generation_execution_locks (user_id);
alter table private.estimate_generation_execution_locks enable row level security;
alter table private.estimate_generation_execution_locks force row level security;
revoke all on private.estimate_generation_execution_locks from public, anon, authenticated, service_role;

-- An expired legacy caller cannot present a token with its writes. Remember
-- its identity until completion, so a second legacy admission cannot make
-- those late, indistinguishable requests valid again.
create table private.estimate_generation_legacy_drains (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  operation text not null,
  token uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (tenant_id, version_id, operation)
);

create index on private.estimate_generation_legacy_drains (version_id);
create index on private.estimate_generation_legacy_drains (user_id);
alter table private.estimate_generation_legacy_drains enable row level security;
alter table private.estimate_generation_legacy_drains force row level security;
revoke all on private.estimate_generation_legacy_drains from public, anon, authenticated, service_role;

-- Reuse the exact quota algorithm, including the tenant/user caps and window.
-- All public admission paths must go through the execution check first.
alter function public.acquire_estimate_ai_generation_lease(uuid, text, uuid) set schema private;
alter function private.acquire_estimate_ai_generation_lease(uuid, text, uuid) security invoker;
revoke all on function private.acquire_estimate_ai_generation_lease(uuid, text, uuid)
  from public, anon, authenticated, service_role;

create function private.estimate_generation_lock_key(p_tenant_id uuid, p_version_id uuid, p_operation text)
returns bigint
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.hashtextextended(format('estimate-generation:%s:%s:%s', p_tenant_id, p_version_id, p_operation), 0);
$$;

create function private.acquire_estimate_generation_execution(
  p_version_id uuid,
  p_operation text,
  p_token uuid,
  p_draft_lock_session_id uuid,
  p_use_ai boolean,
  p_legacy boolean
)
returns table (status text, retry_after_seconds integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_tenant_id uuid := public.current_tenant_id();
  v_now timestamptz;
  v_page_expires_at timestamptz;
  v_retry_at timestamptz;
  v_execution private.estimate_generation_execution_locks%rowtype;
  v_budget public.estimate_ai_generation_budgets%rowtype;
  v_legacy_pending boolean;
  v_quota record;
begin
  if p_version_id is null or p_token is null or p_use_ai is null
    or p_operation is null or p_operation not in ('structure_draft', 'version_zero_draft')
  then
    raise exception 'estimate_generation_invalid_claim' using errcode = '22023';
  end if;

  if v_user_id is null or not exists (
    select 1
    from public.estimate_versions ev
    join public.estimate_projects ep on ep.id = ev.project_id and ep.tenant_id = ev.tenant_id
    join public.tenant_memberships tm on tm.tenant_id = ev.tenant_id and tm.user_id = v_user_id
    where ev.id = p_version_id and ev.tenant_id = v_tenant_id
      and ev.status = 'draft' and not ep.is_archived
      and (tm.role = 'admin' or (tm.role = 'engineer' and ep.user_id = v_user_id))
  ) then
    raise exception 'estimate_generation_access_denied' using errcode = '42501';
  end if;

  -- Read the current page lease after serializing admission with the same
  -- tenant lock as the AI quota. Do not take a row lock on the page lease:
  -- version deletion can cascade to the page before the execution rows.
  perform pg_catalog.pg_advisory_xact_lock(private.estimate_generation_lock_key(v_tenant_id, p_version_id, p_operation));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_tenant_id::text, 0));

  select dl.expires_at into v_page_expires_at
  from public.draft_locks dl
  where dl.tenant_id = v_tenant_id and dl.version_id = p_version_id
    and dl.user_id = v_user_id and dl.session_id = p_draft_lock_session_id;

  v_now := clock_timestamp();
  if v_page_expires_at is null or v_page_expires_at <= v_now then
    raise exception 'estimate_generation_page_lock_required' using errcode = '40001';
  end if;

  select * into v_execution
  from private.estimate_generation_execution_locks l
  where l.tenant_id = v_tenant_id and l.version_id = p_version_id and l.operation = p_operation;

  select * into v_budget
  from public.estimate_ai_generation_budgets b
  where b.tenant_id = v_tenant_id and b.version_id = p_version_id and b.operation = p_operation
    and b.lease_token is not null;

  -- A budget token without a matching execution token is a legacy caller,
  -- including a request that acquired its lease before the migration.
  v_legacy_pending := v_budget.lease_token is not null and v_budget.lease_token is distinct from v_execution.token;
  v_retry_at := greatest(v_execution.expires_at, v_budget.lease_expires_at);
  if v_retry_at > v_now then
    return query select 'busy'::text, ceil(extract(epoch from v_retry_at - v_now))::integer;
    return;
  end if;

  if p_legacy and (v_legacy_pending or exists (
    select 1 from private.estimate_generation_legacy_drains l
    where l.tenant_id = v_tenant_id and l.version_id = p_version_id and l.operation = p_operation
  )) then
    return query select 'busy'::text, 1;
    return;
  end if;

  if p_use_ai then
    select * into strict v_quota
    from private.acquire_estimate_ai_generation_lease(p_version_id, p_operation, p_token);

    if not v_quota.claimed then
      return query select 'quota_exceeded'::text, v_quota.retry_after_seconds;
      return;
    end if;
  end if;

  if p_legacy then
    -- Older handlers can neither renew nor send a token with their writes.
    -- Give them the full existing window to finish. The write fence also
    -- covers older leases that began before this migration.
    update public.estimate_ai_generation_budgets b
    set lease_expires_at = b.window_expires_at
    where b.tenant_id = v_tenant_id and b.version_id = p_version_id and b.operation = p_operation;
    return query select 'acquired'::text, 0;
    return;
  end if;

  if v_legacy_pending then
    insert into private.estimate_generation_legacy_drains (tenant_id, version_id, operation, token, user_id)
    values (v_tenant_id, p_version_id, p_operation, v_budget.lease_token, v_budget.created_by);
  end if;

  -- A fallback may replace an abandoned execution while its quota window is
  -- still active. Clear only the expired AI lease marker in that case.
  if not p_use_ai and v_budget.lease_token is not null then
    update public.estimate_ai_generation_budgets b
    set lease_token = null
    where b.tenant_id = v_tenant_id and b.version_id = p_version_id and b.operation = p_operation;
  end if;

  insert into private.estimate_generation_execution_locks
    (tenant_id, version_id, operation, token, user_id, expires_at)
  values (v_tenant_id, p_version_id, p_operation, p_token, v_user_id, clock_timestamp() + interval '5 minutes')
  on conflict (tenant_id, version_id, operation) do update
    set token = excluded.token, user_id = excluded.user_id, expires_at = excluded.expires_at;

  return query select 'acquired'::text, 0;
end;
$$;

create function public.acquire_estimate_generation_execution(
  p_version_id uuid,
  p_operation text,
  p_token uuid,
  p_draft_lock_session_id uuid,
  p_use_ai boolean
)
returns table (status text, retry_after_seconds integer)
language sql
security definer
set search_path = ''
as $$
  select * from private.acquire_estimate_generation_execution(
    p_version_id, p_operation, p_token, p_draft_lock_session_id, p_use_ai, false
  );
$$;

-- The transaction that admits a write retains the admission lock until it
-- commits. The same check renews the lease before each provider step.
create function public.require_estimate_generation_execution(p_version_id uuid, p_operation text, p_token uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_now timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(private.estimate_generation_lock_key(v_tenant_id, p_version_id, p_operation));
  v_now := clock_timestamp();

  update private.estimate_generation_execution_locks l
  set expires_at = v_now + interval '5 minutes'
  where l.tenant_id = v_tenant_id and l.version_id = p_version_id and l.operation = p_operation
    and l.token = p_token and l.user_id = auth.uid() and l.expires_at > v_now;
  if not found then
    raise exception 'estimate_generation_execution_lost' using errcode = '23505';
  end if;

  perform pg_catalog.set_config('mergeone.estimate_generation_execution_token', p_token::text, true);
end;
$$;

create function public.release_estimate_generation_execution(
  p_version_id uuid,
  p_operation text,
  p_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_tenant_id uuid := public.current_tenant_id();
  v_now timestamptz := clock_timestamp();
  v_released boolean;
begin
  if v_user_id is null then
    raise exception 'estimate_generation_access_denied' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(private.estimate_generation_lock_key(v_tenant_id, p_version_id, p_operation));

  -- Same write order as admission. A matching AI lease is closed without
  -- changing the replay window. This also completes pre-migration requests.
  update public.estimate_ai_generation_budgets b
  set lease_token = null, lease_expires_at = least(v_now, b.window_expires_at),
    completed_at = v_now, updated_at = v_now
  where b.tenant_id = v_tenant_id and b.version_id = p_version_id and b.operation = p_operation
    and b.lease_token = p_token and b.created_by = v_user_id;
  v_released := found;

  delete from private.estimate_generation_execution_locks l
  where l.tenant_id = v_tenant_id and l.version_id = p_version_id and l.operation = p_operation
    and l.token = p_token and l.user_id = v_user_id;

  v_released := found or v_released;
  delete from private.estimate_generation_legacy_drains l
  where l.tenant_id = v_tenant_id and l.version_id = p_version_id and l.operation = p_operation
    and l.token = p_token and l.user_id = v_user_id;

  return found or v_released;
end;
$$;

-- Keep the old API safe during deployment and rollback. Older app versions
-- checked the page session themselves and sent only the version and token.
create function public.acquire_estimate_ai_generation_lease(
  p_version_id uuid,
  p_operation text,
  p_lease_token uuid
)
returns table (claimed boolean, retry_after_seconds integer)
language sql
security definer
set search_path = ''
as $$
  select admission.status = 'acquired', admission.retry_after_seconds
  from private.acquire_estimate_generation_execution(
    p_version_id, p_operation, p_lease_token,
    (select dl.session_id from public.draft_locks dl
     where dl.version_id = p_version_id and dl.user_id = (select auth.uid())
       and dl.tenant_id = (select public.current_tenant_id())),
    true, true
  ) admission;
$$;

create or replace function public.complete_estimate_ai_generation_lease(
  p_version_id uuid,
  p_operation text,
  p_lease_token uuid
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select public.release_estimate_generation_execution(p_version_id, p_operation, p_lease_token);
$$;

revoke all on function public.acquire_estimate_generation_execution(uuid, text, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.release_estimate_generation_execution(uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.acquire_estimate_ai_generation_lease(uuid, text, uuid) from public, anon;
grant execute on function public.acquire_estimate_generation_execution(uuid, text, uuid, uuid, boolean) to authenticated;
grant execute on function public.release_estimate_generation_execution(uuid, text, uuid) to authenticated;
grant execute on function public.acquire_estimate_ai_generation_lease(uuid, text, uuid) to authenticated;


-- Old HTTP requests send ordinary table writes without a token. A nonblocking
-- transaction lock avoids lock inversion when an old UPDATE already owns a
-- draft row and a fenced writer is about to update it. Existing RLS still
-- decides access to the draft itself.
create function private.fence_estimate_generation_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation text := tg_argv[0];
  v_version_id uuid;
  v_tenant_id uuid := new.tenant_id;
  v_token text := nullif(current_setting('mergeone.estimate_generation_execution_token', true), '');
begin
  if current_setting('role', true) <> 'authenticated' then
    return new;
  end if;

  if tg_table_name = 'estimate_structure_drafts' then
    v_version_id := new.target_version_id;
  elsif tg_table_name = 'estimate_structure_draft_nodes' then
    select d.tenant_id, d.target_version_id into v_tenant_id, v_version_id
    from public.estimate_structure_drafts d where d.id = new.draft_id;
  else
    v_version_id := new.version_id;
  end if;

  if not pg_catalog.pg_try_advisory_xact_lock(private.estimate_generation_lock_key(v_tenant_id, v_version_id, v_operation)) then
    raise exception 'estimate_generation_execution_lost' using errcode = '23505';
  end if;

  if v_token is not null and exists (
    select 1 from private.estimate_generation_execution_locks l
    where l.tenant_id = v_tenant_id and l.version_id = v_version_id and l.operation = v_operation
      and l.token::text = v_token and l.user_id = auth.uid()
  ) then
    return new;
  end if;

  if exists (
    select 1 from private.estimate_generation_execution_locks l
    where l.tenant_id = v_tenant_id and l.version_id = v_version_id and l.operation = v_operation
  ) or exists (
    select 1 from private.estimate_generation_legacy_drains d
    where d.tenant_id = v_tenant_id and d.version_id = v_version_id and d.operation = v_operation
  ) or exists (
    select 1 from public.estimate_ai_generation_budgets b
    where b.tenant_id = v_tenant_id and b.version_id = v_version_id and b.operation = v_operation
      and b.lease_token is not null
      and (b.created_by is distinct from auth.uid() or b.lease_expires_at <= clock_timestamp())
  ) then
    raise exception 'estimate_generation_execution_lost' using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger zz_fence_estimate_structure_generation_insert
before insert on public.estimate_structure_drafts
for each row execute function private.fence_estimate_generation_write('structure_draft');
create trigger zz_fence_estimate_structure_generation_discard
before update of status on public.estimate_structure_drafts
for each row when (old.status = 'pending' and new.status = 'discarded')
execute function private.fence_estimate_generation_write('structure_draft');
create trigger zz_fence_estimate_structure_generation_nodes
before insert on public.estimate_structure_draft_nodes
for each row execute function private.fence_estimate_generation_write('structure_draft');
create trigger zz_fence_estimate_v0_generation_insert
before insert on public.estimate_version_zero_drafts
for each row execute function private.fence_estimate_generation_write('version_zero_draft');
create trigger zz_fence_estimate_v0_generation_supersede
before update of status on public.estimate_version_zero_drafts
for each row when (old.status in ('ia_a_revoir', 'ready_for_version') and new.status = 'superseded')
execute function private.fence_estimate_generation_write('version_zero_draft');
create trigger zz_fence_estimate_v0_generation_lots
before insert on public.estimate_version_zero_lots
for each row execute function private.fence_estimate_generation_write('version_zero_draft');
create trigger zz_fence_estimate_v0_generation_lines
before insert on public.estimate_version_zero_lines
for each row execute function private.fence_estimate_generation_write('version_zero_draft');

-- Invoker writes keep the existing table policies. Parent and children are
-- replaced together, with the execution check in that same transaction.
create function public.persist_estimate_structure_generation(
  p_version_id uuid, p_token uuid, p_summary jsonb, p_sources jsonb, p_metadata jsonb, p_nodes jsonb
)
returns table (id uuid, created_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_user_id uuid := auth.uid();
  v_draft public.estimate_structure_drafts%rowtype;
begin
  perform public.require_estimate_generation_execution(p_version_id, 'structure_draft', p_token);

  update public.estimate_structure_drafts d set status = 'discarded'
  where d.tenant_id = v_tenant_id and d.target_version_id = p_version_id
    and d.created_by = v_user_id and d.status = 'pending';

  insert into public.estimate_structure_drafts as d
    (tenant_id, project_id, target_version_id, created_by, summary, source_overview, generation_metadata)
  select v_tenant_id, ev.project_id, p_version_id, v_user_id, p_summary, p_sources, p_metadata
  from public.estimate_versions ev where ev.id = p_version_id and ev.tenant_id = v_tenant_id
  returning d.* into strict v_draft;

  insert into public.estimate_structure_draft_nodes
    (id, tenant_id, draft_id, parent_node_id, order_index, hierarchy_level, label, normalized_label,
      confidence, default_action, duplicate_match_item_id, duplicate_match_path, provenance, facts, hypotheses, inferences)
  select n.id, v_tenant_id, v_draft.id, n.parent_node_id, n.order_index, n.hierarchy_level, n.label, n.normalized_label,
    n.confidence, n.default_action, n.duplicate_match_item_id, n.duplicate_match_path, n.provenance, n.facts, n.hypotheses, n.inferences
  from jsonb_populate_recordset(null::public.estimate_structure_draft_nodes, p_nodes) n;

  return query select v_draft.id, v_draft.created_at;
end;
$$;

create function public.persist_estimate_v0_generation(
  p_version_id uuid, p_token uuid, p_draft jsonb, p_lots jsonb, p_lines jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_project_id uuid;
  v_draft_id uuid;
  v_line_count integer;
begin
  perform public.require_estimate_generation_execution(p_version_id, 'version_zero_draft', p_token);

  select ev.project_id into strict v_project_id
  from public.estimate_versions ev where ev.id = p_version_id and ev.tenant_id = v_tenant_id;

  insert into public.estimate_version_zero_drafts
    (tenant_id, project_id, version_id, brief_id, created_by, summary, generation_metadata, selected_lots)
  select v_tenant_id, v_project_id, p_version_id, d.brief_id, auth.uid(), d.summary, d.generation_metadata, d.selected_lots
  from jsonb_populate_record(null::public.estimate_version_zero_drafts, p_draft) d
  returning id into v_draft_id;

  insert into public.estimate_version_zero_lots
    (id, tenant_id, project_id, version_id, draft_id, lot_key, lot_order, lot_label, status, confidence, provenance, risk_signals, metadata)
  select l.id, v_tenant_id, v_project_id, p_version_id, v_draft_id, l.lot_key, l.lot_order, l.lot_label,
    l.status, l.confidence, l.provenance, l.risk_signals, l.metadata
  from jsonb_populate_recordset(null::public.estimate_version_zero_lots, p_lots) l;

  insert into public.estimate_version_zero_lines
    (tenant_id, project_id, version_id, draft_id, lot_id, line_order, proposed_title, proposed_description, proposed_quantity,
      proposed_unit, confidence, provenance, facts, hypotheses, inferences, missing_signals, metadata)
  select v_tenant_id, v_project_id, p_version_id, v_draft_id, n.lot_id, n.line_order, n.proposed_title, n.proposed_description,
    n.proposed_quantity, n.proposed_unit, n.confidence, n.provenance, n.facts, n.hypotheses, n.inferences, n.missing_signals, n.metadata
  from jsonb_populate_recordset(null::public.estimate_version_zero_lines, p_lines) n
  join public.estimate_version_zero_lots l on l.id = n.lot_id and l.draft_id = v_draft_id;
  get diagnostics v_line_count = row_count;
  if v_line_count <> jsonb_array_length(p_lines) then
    raise exception 'estimate_generation_invalid_lines' using errcode = '22023';
  end if;

  update public.estimate_version_zero_drafts d set status = 'superseded', superseded_by_draft_id = v_draft_id
  where d.tenant_id = v_tenant_id and d.version_id = p_version_id
    and d.status in ('ia_a_revoir', 'ready_for_version') and d.id <> v_draft_id;

  return v_draft_id;
end;
$$;

revoke all on function private.acquire_estimate_generation_execution(uuid, text, uuid, uuid, boolean, boolean),
  private.fence_estimate_generation_write(), private.estimate_generation_lock_key(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.require_estimate_generation_execution(uuid, text, uuid),
  public.persist_estimate_structure_generation(uuid, uuid, jsonb, jsonb, jsonb, jsonb),
  public.persist_estimate_v0_generation(uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.require_estimate_generation_execution(uuid, text, uuid),
  public.persist_estimate_structure_generation(uuid, uuid, jsonb, jsonb, jsonb, jsonb),
  public.persist_estimate_v0_generation(uuid, uuid, jsonb, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
