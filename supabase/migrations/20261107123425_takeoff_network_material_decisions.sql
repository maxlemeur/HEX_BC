-- TI-685, with the technical acceptance boundary of TI-686. No remote application is authorized here.
-- The existing verification and failure-key invalidation remain authoritative. A justification is attested in
-- the same row update and journal transaction; editing content or reopening the line discards it.
alter table public.takeoff_items add column verification_justification jsonb;
comment on column public.takeoff_items.verification_justification is
 'Coded reason and system reference for the current technical acceptance; cleared when verification is withdrawn.';

create or replace function public.enforce_authenticated_takeoff_item_fields()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  parent_status public.takeoff_job_status;
  parent_level public.takeoff_job_level;
begin
  if current_user <> 'authenticated'
    or coalesce(current_setting('app.takeoff_apply_atomic', true), '') = 'on'
  then
    return new;
  end if;

  select job.status, job.level
    into parent_status, parent_level
  from public.takeoff_jobs as job
  where job.id = new.job_id
    and job.tenant_id = new.tenant_id;

  if parent_status is distinct from 'completed'::public.takeoff_job_status then
    raise exception 'TAKEOFF_ITEM_COMPLETED_JOB_REQUIRED' using errcode = '42501';
  end if;

  if (to_jsonb(new) - array[
    'designation', 'quantity', 'unit', 'is_excluded', 'exclusion_reason',
    'is_verified', 'verification_justification', 'verified_at', 'verified_by', 'evidence', 'source_page',
    'quantity_entered_at', 'quantity_entered_by', 'updated_at'
  ]) is distinct from (to_jsonb(old) - array[
    'designation', 'quantity', 'unit', 'is_excluded', 'exclusion_reason',
    'is_verified', 'verification_justification', 'verified_at', 'verified_by', 'evidence', 'source_page',
    'quantity_entered_at', 'quantity_entered_by', 'updated_at'
  ]) then
    raise exception 'TAKEOFF_ITEM_TRUSTED_FIELDS_IMMUTABLE' using errcode = '42501';
  end if;

  -- Any content edit invalidates an earlier attestation unless the caller
  -- explicitly re-attests the new value in the same statement.
  if old.is_verified
    and (
      new.designation is distinct from old.designation
      or new.quantity is distinct from old.quantity
      or new.unit is distinct from old.unit
      or new.is_excluded is distinct from old.is_excluded
      or new.exclusion_reason is distinct from old.exclusion_reason
      or new.evidence is distinct from old.evidence
      or new.source_page is distinct from old.source_page
    )
    and new.is_verified is not distinct from old.is_verified
    and new.verified_at is not distinct from old.verified_at
    and new.verified_by is not distinct from old.verified_by
  then
    new.is_verified := false;
    new.verified_at := null;
    new.verified_by := null;
  end if;

  if new.is_verified is distinct from old.is_verified
    or new.verified_at is distinct from old.verified_at
    or new.verified_by is distinct from old.verified_by
  then
    if new.is_verified then
      if new.verified_by is distinct from (select auth.uid())
        or new.verified_at is null
      then
        raise exception 'TAKEOFF_ITEM_VERIFICATION_INVALID' using errcode = '42501';
      end if;
    elsif new.verified_by is not null or new.verified_at is not null then
      raise exception 'TAKEOFF_ITEM_VERIFICATION_INVALID' using errcode = '42501';
    end if;
  end if;

  if parent_level = 'C'::public.takeoff_job_level
    and new.is_verified
    and (
      nullif(btrim(new.evidence), '') is null
      or new.source_page is null
      or new.source_page < 1
    )
  then
    raise exception 'TAKEOFF_ITEM_VERIFICATION_PROOF_REQUIRED' using errcode = '42501';
  end if;

  -- TI-664: a typed quantity is attested by its author, now; a quantity changed
  -- without a new attestation is no longer the one entered.
  if new.quantity is distinct from old.quantity
    and new.quantity_entered_by is not distinct from old.quantity_entered_by
    and new.quantity_entered_at is not distinct from old.quantity_entered_at
  then
    new.quantity_entered_by := null;
    new.quantity_entered_at := null;
  end if;

  if new.quantity_entered_by is distinct from old.quantity_entered_by
    or new.quantity_entered_at is distinct from old.quantity_entered_at
  then
    if new.quantity_entered_by is not null then
      if new.quantity_entered_by is distinct from (select auth.uid())
        or new.quantity_entered_at is null
      then
        raise exception 'TAKEOFF_ITEM_QUANTITY_ENTRY_INVALID' using errcode = '42501';
      end if;
    elsif new.quantity_entered_at is not null then
      raise exception 'TAKEOFF_ITEM_QUANTITY_ENTRY_INVALID' using errcode = '42501';
    end if;
  end if;

  -- TI-664: the rules read the quantity, its entry, the unit, the exclusion
  -- and the page (the scale rule) as they are now; after a client edit their
  -- results wait for the server.
  if (old.rules_evaluated_at is not null or old.rules_stale)
    and (
      new.quantity is distinct from old.quantity
      or new.quantity_entered_by is distinct from old.quantity_entered_by
      or new.unit is distinct from old.unit
      or new.is_excluded is distinct from old.is_excluded
      or new.source_page is distinct from old.source_page
    )
  then
    new.rules_stale := true;
    new.rules_stale_at := pg_catalog.clock_timestamp();
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_authenticated_takeoff_item_fields()
  from public;

create or replace function public.update_takeoff_item_for_review(
  p_tenant_id uuid,
  p_job_id uuid,
  p_item_id uuid,
  p_expected_updated_at timestamptz,
  p_fields jsonb
)
returns setof public.takeoff_items
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  version_id uuid;
  assignments text;
begin
  if pg_catalog.jsonb_typeof(p_fields) is distinct from 'object'
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(p_fields) as field(name)
      where field.name <> all (array[
        'designation', 'quantity', 'unit', 'source_page', 'is_excluded', 'exclusion_reason', 'is_verified',
        'verified_at', 'verified_by', 'verification_justification', 'evidence', 'quantity_entered_at', 'quantity_entered_by', 'updated_at'
      ])
    )
  then
    raise exception 'TAKEOFF_ITEM_PATCH_INVALID' using errcode = '22023';
  end if;

  select pg_catalog.string_agg(pg_catalog.format('%I = patch.%I', field.name, field.name), ', ' order by field.name)
    into assignments
  from pg_catalog.jsonb_object_keys(p_fields) as field(name);
  if assignments is null then
    return;
  end if;

  select job.estimate_version_id
    into version_id
  from public.takeoff_jobs as job
  where job.id = p_job_id
    and job.tenant_id = p_tenant_id;
  if version_id is null then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-rules:' || version_id::text, 0));

  return query execute pg_catalog.format(
    'update public.takeoff_items as item set %s
     from pg_catalog.jsonb_populate_record(null::public.takeoff_items, $1) as patch
     where item.id = $2 and item.job_id = $3 and item.tenant_id = $4 and item.updated_at = $5
     returning item.*',
    assignments
  ) using p_fields, p_item_id, p_job_id, p_tenant_id, p_expected_updated_at;
end;
$$;

revoke all on function public.update_takeoff_item_for_review(uuid, uuid, uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.update_takeoff_item_for_review(uuid, uuid, uuid, timestamptz, jsonb) to authenticated, service_role;


create function public.validate_takeoff_rule_acceptance()
returns trigger language plpgsql
set search_path = pg_catalog
as $$
declare
  justification jsonb := new.verification_justification;
  technical boolean;
begin
  if not new.is_verified then
    new.verification_justification := null;
    return new;
  end if;
  -- Computations only preserve a previous attestation or withdraw it; they cannot invent a user decision.
  if current_user <> 'authenticated'
    or coalesce(current_setting('app.takeoff_apply_atomic', true), '') = 'on' then return new; end if;
  if new.verification_justification is distinct from old.verification_justification
    and (new.verified_by is distinct from (select auth.uid()) or new.verified_at is null) then
    raise exception 'TAKEOFF_ITEM_VERIFICATION_INVALID' using errcode = '42501';
  end if;
  if new.rules_stale then
    raise exception 'TAKEOFF_RULES_STALE' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_array_elements(new.rule_results) r
    where r->>'status'='fail' and coalesce(r->>'acceptable','false') <> 'true') then
    raise exception 'TAKEOFF_RULE_NOT_ACCEPTABLE' using errcode = '23514';
  end if;
  select exists(select 1 from jsonb_array_elements(new.rule_results) r
    where r->>'status'='fail' and r->>'rule'='dn_network') into technical;
  if not technical then
    new.verification_justification := null;
    return new;
  end if;
  if jsonb_typeof(justification) is distinct from 'object'
    or jsonb_typeof(justification->'reason_code') is distinct from 'string'
    or jsonb_typeof(justification->'system_reference') is distinct from 'string'
    or length(btrim(justification->>'system_reference')) not between 10 and 500
    or justification->>'system_reference' !~ '[^[:space:]]'
    or coalesce(justification->>'reason_code','') not in
      ('system_documented','gas_pe_buried_outside','gas_pe_facade_transition')
    or justification - array['reason_code','system_reference'] <> '{}'::jsonb
  then
    raise exception 'TAKEOFF_RULE_JUSTIFICATION_REQUIRED' using errcode = '23514';
  end if;
  if exists(select 1 from jsonb_array_elements(new.rule_results) r where r->>'status'='fail'
    and r->>'code'='DN_NETWORK_GAS_PE_REQUIRES_JUSTIFICATION')
    and justification->>'reason_code' not in ('gas_pe_buried_outside','gas_pe_facade_transition') then
    raise exception 'TAKEOFF_RULE_GAS_PE_REASON_REQUIRED' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_takeoff_rule_acceptance() from public, anon, authenticated, service_role;
-- Runs after the existing field whitelist and content-attestation invalidation.
create trigger zz_validate_takeoff_rule_acceptance before update on public.takeoff_items
for each row execute function public.validate_takeoff_rule_acceptance();

create or replace function public.audit_takeoff_item_decisions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor uuid := (select auth.uid());
begin
  if pg_catalog.current_setting('role', true) is distinct from 'authenticated'
    or coalesce(pg_catalog.current_setting('app.takeoff_apply_atomic', true), '') = 'on'
  then
    return null;
  end if;

  insert into public.audit_logs (tenant_id, user_id, table_name, record_id, estimate_version_id, action, after_data)
  select new.tenant_id, actor, 'takeoff_items', new.job_id, job.estimate_version_id, change.action,
    pg_catalog.jsonb_build_object('schema_version', 1, 'action', change.action, 'job_id', new.job_id,
      'tenant_id', new.tenant_id, 'user_id', actor, 'metadata', change.metadata)
  from (
    select field.position,
      case when field.name = 'is_excluded' and new.is_excluded then 'takeoff.item.excluded' else 'takeoff.item.modified' end
        as action,
      case when field.name = 'is_excluded' and new.is_excluded
        then pg_catalog.jsonb_build_object('item_id', new.id, 'is_excluded', true, 'reason', new.exclusion_reason)
        else pg_catalog.jsonb_build_object('item_id', new.id, 'field', field.name, 'previous_value', field.previous,
          'next_value', field.next, 'reason', null)
          || case when field.name = 'is_verified' and new.is_verified then pg_catalog.jsonb_build_object(
            'justification', new.verification_justification,
            'rule_failures', coalesce((select proof.failure_keys from takeoff_internal.rule_failure_proofs proof
              where proof.item_id = new.id), public.takeoff_rule_failure_keys(new.rule_results)))
            else '{}'::jsonb end
      end as metadata
    from (values
      (1, 'designation', pg_catalog.to_jsonb(old.designation), pg_catalog.to_jsonb(new.designation)),
      (2, 'quantity', pg_catalog.to_jsonb(old.quantity), pg_catalog.to_jsonb(new.quantity)),
      (3, 'quantity_entered_by', pg_catalog.to_jsonb(old.quantity_entered_by), pg_catalog.to_jsonb(new.quantity_entered_by)),
      (4, 'unit', pg_catalog.to_jsonb(old.unit), pg_catalog.to_jsonb(new.unit)),
      (5, 'source_page', pg_catalog.to_jsonb(old.source_page), pg_catalog.to_jsonb(new.source_page)),
      (6, 'evidence', pg_catalog.to_jsonb(old.evidence), pg_catalog.to_jsonb(new.evidence)),
      (7, 'is_excluded', pg_catalog.to_jsonb(old.is_excluded), pg_catalog.to_jsonb(new.is_excluded)),
      -- The reason of a line that stays excluded (an exclusion carries its own, an inclusion clears it).
      (8, 'exclusion_reason',
        case when old.is_excluded is not distinct from new.is_excluded then pg_catalog.to_jsonb(old.exclusion_reason) end,
        case when old.is_excluded is not distinct from new.is_excluded then pg_catalog.to_jsonb(new.exclusion_reason) end),
      (9, 'is_verified', pg_catalog.to_jsonb(old.is_verified), pg_catalog.to_jsonb(new.is_verified))
    ) as field(position, name, previous, next)
    where field.previous is distinct from field.next
      -- A verification another user takes over is theirs (true to true, in their name).
      or (field.name = 'is_verified' and new.is_verified and (old.verified_by is distinct from new.verified_by
        or old.verification_justification is distinct from new.verification_justification))
  ) as change
  left join public.takeoff_jobs as job on job.id = new.job_id and job.tenant_id = new.tenant_id
  order by change.position;

  return null;
end;
$$;


drop trigger audit_takeoff_item_decisions on public.takeoff_items;
create trigger audit_takeoff_item_decisions after update on public.takeoff_items for each row
when (old.designation is distinct from new.designation or old.quantity is distinct from new.quantity
  or old.quantity_entered_by is distinct from new.quantity_entered_by or old.unit is distinct from new.unit
  or old.source_page is distinct from new.source_page or old.evidence is distinct from new.evidence
  or old.is_excluded is distinct from new.is_excluded or old.exclusion_reason is distinct from new.exclusion_reason
  or old.is_verified is distinct from new.is_verified or old.verified_by is distinct from new.verified_by
  or old.verification_justification is distinct from new.verification_justification)
execute function public.audit_takeoff_item_decisions();

-- Deploying a new table must not keep old passing/verified network decisions usable until the next edit.
-- Applied jobs remain frozen. Existing audits are kept; the new rule version reopens decisions on recomputation.
update public.takeoff_items i set rules_stale=true, rules_stale_at=clock_timestamp()
from public.takeoff_jobs j where j.id=i.job_id and j.tenant_id=i.tenant_id and j.status='completed'
 and (i.metadata->'rule_inputs'->>'kind'='network'
   or exists(select 1 from jsonb_array_elements(i.rule_results) r where r->>'rule'='dn_network'));
