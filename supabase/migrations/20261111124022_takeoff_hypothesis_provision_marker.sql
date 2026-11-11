-- TI-682 lot C (PR 2). No remote application is authorized here.
-- An hypothesis included without an entry is marked at application, with why it is an hypothesis.
-- Since lot B (20261111035718_takeoff_hypothesis_preselection.sql) a takeoff line whose quantity is an hypothesis nobody
-- attested arrives excluded: an estimate (metadata.quantity_nature « estimated ») or a quantity a plan cannot show
-- (metadata.rule_inputs.non_observable). Its reviewer may include it without entering its quantity (« I » in the targeted
-- review, the include toggle of the complete review). The marker (TI-686) kept only forced sources and quantities entered
-- as a hypothesis: such a line reached the estimate as an ordinary line. Now:
-- - private.takeoff_mark_provisions keeps every source whose public.takeoff_item_hypothesis_cause is not null (the one
--   definition of an hypothesis, lot B), besides the forced ones; an entered hypothesis is one of them, as before;
-- - each source gains hypothesis_cause: entered_hypothesis, estimated, non_observable, or null (a forced source no
--   hypothesis rests on). The marker stays version 1; the key is optional to its reader
--   (src/lib/estimates/takeoff-provision.ts), which reads a non-null cause as an hypothesis and an older marker, without
--   the key, exactly as before.
-- Re-created from its newest body, 20261110094504_takeoff_apply_force_reasons.sql, copied whole: only the source filter
-- and the new key change (lines marked « TI-682 lot C »). Neither overload of apply_takeoff_job_guarded_atomic,
-- apply_takeoff_job_atomic nor finalize_takeoff_lengths is redefined: both overloads call the writer unchanged, on
-- finalize_takeoff_lengths' output. It reads the takeoff lines as stored, frozen once applied. No amount changes: the
-- writer only sets source_metadata. The client sees an ordinary priced line (H9). No data is rewritten: estimates applied
-- before keep their marker, or none. CREATE OR REPLACE keeps owner and grants (restated below).
begin;

-- From 20261110094504_takeoff_apply_force_reasons.sql (TI-686 M4); only the lines marked « TI-682 lot C » change.
create or replace function private.takeoff_mark_provisions(
  p_job_id uuid,
  p_tenant_id uuid,
  p_version_id uuid,
  p_item_links jsonb,
  p_created_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  engine smallint;
  old_writer text := coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true), '');
begin
  select version.calc_engine_version
    into engine
  from public.estimate_versions as version
  where version.id = p_version_id
    and version.tenant_id = p_tenant_id;

  -- A v3 draft's lines are written under its writer contract (the amounts are not touched).
  if engine = 3 then
    perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', p_version_id::text, true);
  end if;

  -- TI-686 M4: the forced lines and their coded reason, from the forced entries of the consumed audit (one per blocked
  -- line, enforce_takeoff_apply_security); a job applies once, the latest audit wins should it not.
  with forced as (
    select distinct on (entry.value ->> 'item_id')
      entry.value ->> 'item_id' as item_id,
      entry.value ->> 'reason_code' as reason_code
    from public.takeoff_apply_override_consumptions as consumed
    join public.audit_logs as audit
      on audit.id = consumed.audit_log_id
     and audit.tenant_id = consumed.tenant_id
    cross join lateral pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(audit.after_data #> '{metadata,forced_items}') = 'array'
        then audit.after_data #> '{metadata,forced_items}' else '[]'::jsonb end
    ) as entry(value)
    where consumed.job_id = p_job_id
      and consumed.tenant_id = p_tenant_id
      and consumed.estimate_version_id = p_version_id
      and pg_catalog.jsonb_typeof(entry.value) = 'object'
      and pg_catalog.jsonb_typeof(entry.value -> 'item_id') = 'string'
    order by entry.value ->> 'item_id', audit.created_at desc, audit.id desc
  ),
  links as (
    select link.estimate_item_id, link.takeoff_item_id
    from pg_catalog.jsonb_to_recordset(
      case when pg_catalog.jsonb_typeof(p_item_links) = 'array' then p_item_links else '[]'::jsonb end
    ) as link(takeoff_item_id text, estimate_item_id uuid)
    union
    select item.id, item.source_metadata ->> 'takeoff_item_id'
    from public.estimate_items as item
    where item.id = any(coalesce(p_created_ids, '{}'::uuid[]))
      and item.version_id = p_version_id
      and item.tenant_id = p_tenant_id
      and item.item_type = 'line'::public.estimate_item_type
      and item.source_metadata ->> 'mapping_action' = 'apply_assembly'
  ),
  marked as (
    select
      links.estimate_item_id,
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'takeoff_item_id', source.id,
          'forced', forced.item_id is not null,
          'forced_reason', forced.reason_code,
          'entry_category', source.quantity_entry_category,
          -- TI-682 lot C: why the source is an hypothesis (entered_hypothesis, estimated, non_observable), or null.
          'hypothesis_cause', public.takeoff_item_hypothesis_cause(source.metadata, source.quantity_entry_category)
        )
        order by source.id
      -- TI-682 lot C: a forced source, or any hypothesis (an entered one as before, now also an estimate or a quantity a
      -- plan cannot show that its reviewer included without entering it).
      ) filter (where forced.item_id is not null
        or public.takeoff_item_hypothesis_cause(source.metadata, source.quantity_entry_category) is not null) as sources
    from links
    left join public.takeoff_items as source
      on source.id::text = links.takeoff_item_id
     and source.job_id = p_job_id
     and source.tenant_id = p_tenant_id
    left join forced
      on forced.item_id = source.id::text
    group by links.estimate_item_id
  ),
  next_state as (
    select
      item.id,
      case
        when marked.sources is null then item.source_metadata - 'takeoff_provision'
        else coalesce(item.source_metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object('takeoff_provision',
          pg_catalog.jsonb_build_object('version', 1, 'job_id', p_job_id, 'sources', marked.sources))
      end as source_metadata
    from marked
    join public.estimate_items as item
      on item.id = marked.estimate_item_id
     and item.version_id = p_version_id
     and item.tenant_id = p_tenant_id
     and item.item_type = 'line'::public.estimate_item_type
  )
  update public.estimate_items as item
  set source_metadata = next_state.source_metadata
  from next_state
  where item.id = next_state.id
    and item.version_id = p_version_id
    and item.tenant_id = p_tenant_id
    and item.source_metadata is distinct from next_state.source_metadata;

  if engine = 3 then
    perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', old_writer, true);
  end if;
end;
$$;

comment on function private.takeoff_mark_provisions(uuid, uuid, uuid, jsonb, uuid[]) is
  'TI-686 D10/D12, TI-682 lot C: writes or removes source_metadata.takeoff_provision on the estimate lines a takeoff application touched (final links and materialized ouvrage lines): sources forced by the consumed override audit of the job (with their coded reason) or resting on an hypothesis (public.takeoff_item_hypothesis_cause: entered, estimated or not observable), each with its hypothesis_cause. Internal display only (H9). Called by both overloads of public.apply_takeoff_job_guarded_atomic only.';

revoke all on function private.takeoff_mark_provisions(uuid, uuid, uuid, jsonb, uuid[])
  from public, anon, authenticated, service_role;

commit;
