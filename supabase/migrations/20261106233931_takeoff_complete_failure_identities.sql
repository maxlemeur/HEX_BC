-- Displayed results stay bounded. Only overflow lines have a private, complete identity set.
create schema takeoff_internal;
revoke all on schema takeoff_internal from public, anon, authenticated;
grant usage on schema takeoff_internal to service_role;

create table takeoff_internal.rule_failure_proofs (
  item_id uuid primary key references public.takeoff_items(id) on delete cascade,
  failure_keys jsonb not null check (jsonb_typeof(failure_keys) = 'array')
);
alter table takeoff_internal.rule_failure_proofs enable row level security;
revoke all on takeoff_internal.rule_failure_proofs from public, anon, authenticated;
grant select, insert, update, delete on takeoff_internal.rule_failure_proofs to service_role;

-- Canonical TS keys contain ASCII and cannot contain a newline. No pgcrypto extension is needed.
create function takeoff_internal.failure_digest(keys jsonb)
returns text language sql immutable strict set search_path = pg_catalog as $$
  select encode(sha256(convert_to(coalesce(string_agg(value, chr(10) order by pos), ''), 'UTF8')), 'hex')
  from jsonb_array_elements_text(keys) with ordinality as k(value,pos)
$$;

-- Null rejects a write that cannot establish the complete set. Legacy counts were added after the
-- display bounds: the old cutoff sizes and the numbers-only fallback can also conceal partners.
create function takeoff_internal.complete_keys(results jsonb, proof jsonb)
returns jsonb language plpgsql immutable set search_path = pg_catalog as $$
declare
  entry jsonb;
  visible jsonb;
  shown integer;
  total numeric;
  prefix text;
  count_field text;
  identities_field text;
  needs_proof boolean := false;
  markers integer := 0;
  marker text;
  expected integer := 0;
begin
  if jsonb_typeof(results) is distinct from 'array' then return null; end if;
  if jsonb_array_length(results)>16 or octet_length(results::text)>65536 then return null; end if;
  if proof is not null and jsonb_typeof(proof) is distinct from 'array' then return null; end if;
  for entry in select value from jsonb_array_elements(results) where value->>'status'='fail' loop
    if (entry->'details') ? 'failure_keys_sha256' then
      markers := markers+1;
      marker := entry#>>'{details,failure_keys_sha256}';
    end if;
    case entry->>'code'
      when 'ZONE_OVERLAP_DUPLICATE' then count_field := 'partner_count'; identities_field := 'partners';
      when 'ROOM_OVERLAP' then count_field := 'overlap_count'; identities_field := 'overlapping_item_ids';
      else count_field := null;
    end case;
    if count_field is not null then
      shown := case when jsonb_typeof(entry->'details'->identities_field)='array'
        then jsonb_array_length(entry->'details'->identities_field) else 0 end;
      if jsonb_typeof(entry->'details'->count_field)='number' then
        total := (entry->'details'->>count_field)::numeric;
        if total < shown or total < 1 or total <> trunc(total) then return null; end if;
        needs_proof := needs_proof or total > shown;
      else
        -- A count-free, small unambiguous list from an older writer remains usable.
        if entry ? 'details' and ((identities_field='partners' and shown in (0,5,20,50)) or
           (identities_field='overlapping_item_ids' and shown in (0,20,100,500))) then return null; end if;
        total := shown;
      end if;
    else
      total := null;
    end if;
    if proof is not null then
      visible := public.takeoff_rule_failure_keys(jsonb_build_array(entry));
      prefix := regexp_replace(visible->>0, '[^|]*$', '');
      total := coalesce(total, jsonb_array_length(visible));
      -- Each reported partner belongs to this rule, including all displayed identities.
      if total > 2147483647 or
        (select count(*) from jsonb_array_elements_text(proof) k(value) where starts_with(k.value,prefix)) <> total or
        (count_field is not null and proof ? prefix) or
        exists(select 1 from jsonb_array_elements_text(visible) k(value)
          where (k.value <> prefix or total=1 and count_field is null) and not (proof ? k.value))
      then return null; end if;
      expected := expected + total::integer;
    end if;
  end loop;
  if proof is null then
    if needs_proof or markers>0 then return null; end if;
    return public.takeoff_rule_failure_keys(results);
  end if;
  if not needs_proof or markers<>1 or marker is null or expected<>jsonb_array_length(proof)
    or marker is distinct from takeoff_internal.failure_digest(proof)
    or exists(select 1 from (
      select value, lag(value) over (order by pos) as prev
      from jsonb_array_elements_text(proof) with ordinality as keys(value,pos)
    ) as k where k.value is null or k.value !~ '^[A-Za-z0-9_?]{1,64}[|][A-Za-z0-9_?]{1,64}[|][0-9?]{1,10}[|][a-z0-9?-]{0,64}$'
      or k.value collate "C" <= k.prev collate "C")
  then return null; end if;
  return proof;
end
$$;

-- Compare override equality by the full digest, whether or not bounding was required when
-- the state was recorded. A legacy result that might conceal identities never authorizes an override.
create function takeoff_internal.override_keys_match(state_keys jsonb, results jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare
  recorded text;
  current_digest text;
  visible jsonb;
begin
  if jsonb_typeof(state_keys) is distinct from 'array' or jsonb_typeof(results) is distinct from 'array' then return false; end if;
  if jsonb_array_length(state_keys)=1 and (state_keys->>0) ~ '^sha256:[a-f0-9]{64}$' then
    recorded:=substr(state_keys->>0,8);
  end if;
  select value#>>'{details,failure_keys_sha256}' into current_digest
    from jsonb_array_elements(results) where value->>'status'='fail' and value#>>'{details,failure_keys_sha256}' ~ '^[a-f0-9]{64}$' limit 1;
  if current_digest is null then
    visible:=takeoff_internal.complete_keys(results,null);
    if visible is null then return false; end if;
    if recorded is null then return state_keys=visible; end if;
    current_digest:=takeoff_internal.failure_digest(visible);
  end if;
  if recorded is null then
    -- Only real strings without the joining delimiter can represent an old explicit list.
    if exists(select 1 from jsonb_array_elements(state_keys) k(value)
      where jsonb_typeof(k.value)<>'string' or strpos(k.value#>>'{}',chr(10))>0) then return false; end if;
    recorded:=takeoff_internal.failure_digest(state_keys);
  end if;
  return current_digest=recorded;
end
$$;

revoke all on all functions in schema takeoff_internal from public, anon, authenticated;
grant execute on all functions in schema takeoff_internal to service_role;

-- Only completed jobs can be recomputed. Applied jobs and their archived results stay frozen.
update public.takeoff_items i set rules_stale=true, rules_stale_at=statement_timestamp()
from public.takeoff_jobs j where j.id=i.job_id and j.tenant_id=i.tenant_id and j.status='completed'
  and (i.rule_results @> '[{"status":"fail","code":"ZONE_OVERLAP_DUPLICATE"}]'::jsonb or
       i.rule_results @> '[{"status":"fail","code":"ROOM_OVERLAP"}]'::jsonb)
  and takeoff_internal.complete_keys(i.rule_results,null) is null;

drop function if exists public.write_takeoff_rule_results(uuid, uuid, jsonb, jsonb, text);

create function public.write_takeoff_rule_results(
  p_tenant_id uuid,
  p_estimate_version_id uuid,
  p_items jsonb,
  p_transforms jsonb default '[]'::jsonb,
  p_stamp text default null
)
returns table (item_id uuid, version_stamp text, reopened boolean)
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  writable uuid[];
  grew boolean;
  reopened_ids uuid[];
  written uuid[];
  stamp_after text := p_stamp;
begin
  if pg_catalog.jsonb_typeof(p_items) is distinct from 'array'
    or pg_catalog.jsonb_typeof(coalesce(p_transforms, '[]'::jsonb)) is distinct from 'array'
  then
    raise exception 'TAKEOFF_RULE_RESULTS_INVALID' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('takeoff-rules:' || p_estimate_version_id::text, 0)
  );
  if p_stamp is not null and p_stamp is distinct from public.takeoff_rule_version_stamp(p_tenant_id, p_estimate_version_id) then
    return;
  end if;

  -- Completed jobs no application holds; holding them keeps an application from starting meanwhile.
  select coalesce(pg_catalog.array_agg(job.id), '{}'::uuid[])
    into writable
  from (
    select candidate.id
    from public.takeoff_jobs as candidate
    where candidate.tenant_id = p_tenant_id
      and candidate.estimate_version_id = p_estimate_version_id
      and candidate.status = 'completed'::public.takeoff_job_status
    for share skip locked
  ) as job;

  update public.takeoff_item_geometries as stored
  set geometry = pg_catalog.jsonb_set(stored.geometry, '{transform}', coalesce(entry.transform, 'null'::jsonb))
  from pg_catalog.jsonb_to_recordset(coalesce(p_transforms, '[]'::jsonb)) as entry(item_id uuid, transform jsonb)
  where stored.takeoff_item_id = entry.item_id
    and stored.tenant_id = p_tenant_id
    and stored.job_id = any(writable)
    and (
      entry.transform is null
      or entry.transform = 'null'::jsonb
      or (pg_catalog.jsonb_typeof(entry.transform) = 'array' and pg_catalog.jsonb_array_length(entry.transform) = 6)
    );

  -- Lock only current rows of writable jobs, then decide and persist once from those exact rows.
  with locked as materialized (
    select item.id, item.job_id, item.is_verified, item.verified_at, item.verified_by, item.rule_results,
      entry.results, entry.complete_failure_keys
    from public.takeoff_items item join jsonb_to_recordset(p_items) entry(id uuid, results jsonb,
      expected_updated_at timestamptz, expected_stale_at timestamptz, complete_failure_keys jsonb) on item.id=entry.id
    where item.tenant_id=p_tenant_id and item.job_id=any(writable) and item.updated_at=entry.expected_updated_at
      and item.rules_stale_at is not distinct from entry.expected_stale_at
    for update of item
  ), identities as materialized (
    select line.*, coalesce(proof.failure_keys,public.takeoff_rule_failure_keys(line.rule_results)) as previous_keys,
      takeoff_internal.complete_keys(line.results,line.complete_failure_keys) as next_keys
    from locked line left join takeoff_internal.rule_failure_proofs proof on proof.item_id=line.id
  ), mark_unproved as (
    update public.takeoff_items item set rules_stale=true,rules_stale_at=statement_timestamp()
    from identities line where item.id=line.id and not item.rules_stale and line.next_keys is null
  ), decisions as materialized (
    select line.*, fresh.codes
    from identities line cross join lateral (
      select string_agg(distinct split_part(key,'|',2), ', ' order by split_part(key,'|',2)) as codes
      from (select value as key from jsonb_array_elements_text(line.next_keys)
        except select value from jsonb_array_elements_text(line.previous_keys)) as added
    ) fresh where line.next_keys is not null
  ), saved as (
    update public.takeoff_items item set
      rule_results=d.results, rules_evaluated_at=statement_timestamp(), rules_stale=false,
      is_verified=case when d.codes is null then item.is_verified else false end,
      verified_at=case when d.codes is null or not d.is_verified then item.verified_at else null end,
      verified_by=case when d.codes is null or not d.is_verified then item.verified_by else null end,
      updated_at=case when d.codes is null then item.updated_at else now() end
    from decisions d where item.id=d.id
    returning item.id, item.job_id, d.is_verified as was_verified, d.verified_at, d.verified_by,
      d.rule_results as previous, d.codes, d.complete_failure_keys
  ), keep_proofs as (
    insert into takeoff_internal.rule_failure_proofs as p (item_id,failure_keys)
    select id,complete_failure_keys from saved where complete_failure_keys is not null
    on conflict on constraint rule_failure_proofs_pkey do update set failure_keys=excluded.failure_keys
    where p.failure_keys is distinct from excluded.failure_keys
  ), clear_proofs as (
    delete from takeoff_internal.rule_failure_proofs p using saved
    where p.item_id=saved.id and saved.complete_failure_keys is null
  ), journal as (
    insert into public.audit_logs (tenant_id,user_id,table_name,record_id,estimate_version_id,action,before_data,after_data)
    select p_tenant_id,null,'takeoff_items',s.job_id,p_estimate_version_id,'takeoff.item.modified',
      jsonb_build_object('is_verified',true,'verified_at',s.verified_at,'verified_by',s.verified_by,
        'rule_failures',public.takeoff_rule_failure_keys(s.previous)),
      jsonb_build_object('schema_version',1,'action','takeoff.item.modified','job_id',s.job_id,
        'tenant_id',p_tenant_id,'user_id',null,'metadata',jsonb_build_object('item_id',s.id,'field','is_verified',
        'previous_value',true,'next_value',false,'reason',left('Règles recalculées : nouvel échec à vérifier (' || s.codes || ').',500)))
    from saved s where s.was_verified and s.codes is not null
  )
  select coalesce(array_agg(id),'{}'::uuid[]),coalesce(array_agg(id) filter (where codes is not null and was_verified),'{}'::uuid[]),
         coalesce(bool_or(codes is not null),false)
    into written,reopened_ids,grew from saved;
  if grew then stamp_after:=public.takeoff_rule_version_stamp(p_tenant_id,p_estimate_version_id); end if;
  return query select id,stamp_after,id=any(reopened_ids) from unnest(written) as w(id);
end;
$$;

revoke all on function public.write_takeoff_rule_results(uuid, uuid, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.write_takeoff_rule_results(uuid, uuid, jsonb, jsonb, text) to service_role;

create or replace function public.takeoff_apply_override_state_holds(p_state jsonb, p_item public.takeoff_items)
returns boolean
language plpgsql
stable
set search_path = pg_catalog
as $$
begin
  if pg_catalog.jsonb_typeof(p_state) is distinct from 'object'
    or p_state ->> 'item_id' is distinct from p_item.id::text
    or pg_catalog.jsonb_typeof(p_state -> 'quantity') is distinct from 'number'
    or pg_catalog.jsonb_typeof(p_state -> 'unit') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_state -> 'updated_at') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_state -> 'rule_failures') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_state -> 'rules_stale') is distinct from 'boolean'
    or pg_catalog.jsonb_typeof(p_state -> 'designation') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_state -> 'is_verified') is distinct from 'boolean'
    or not (p_state ? 'evidence' and p_state ? 'source_page' and p_state ? 'quantity_entered_by')
  then
    return false;
  end if;

  if (p_state ->> 'quantity')::numeric is distinct from p_item.quantity
    or p_state ->> 'unit' is distinct from p_item.unit
    or not takeoff_internal.override_keys_match(p_state -> 'rule_failures', p_item.rule_results)
    or p_state -> 'rules_stale' is distinct from pg_catalog.to_jsonb(coalesce(p_item.rules_stale, false))
    or p_state -> 'evidence' is distinct from coalesce(pg_catalog.to_jsonb(p_item.evidence), 'null'::jsonb)
    or p_state -> 'source_page' is distinct from coalesce(pg_catalog.to_jsonb(p_item.source_page), 'null'::jsonb)
    or p_state -> 'is_verified' is distinct from pg_catalog.to_jsonb(p_item.is_verified)
    or p_state -> 'quantity_entered_by' is distinct from coalesce(pg_catalog.to_jsonb(p_item.quantity_entered_by), 'null'::jsonb)
  then
    return false;
  end if;

  -- Unchanged since recorded, or changed in this transaction only (the application's own renaming).
  return ((p_state ->> 'updated_at')::timestamptz = p_item.updated_at and p_state ->> 'designation' = p_item.designation)
    or p_item.updated_at = pg_catalog.now();
exception
  when others then
    return false;
end;
$$;
