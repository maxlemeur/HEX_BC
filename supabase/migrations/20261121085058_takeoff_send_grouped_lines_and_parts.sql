-- Follow-up of lot 2 M2 (…_takeoff_send_receipts.sql): what the reviews of the send left. Forward-only: no table, column,
-- policy or row is created, changed or deleted; four existing functions are replaced with their signatures, owners and
-- grants unchanged, and one private helper is added.
-- 1. The line that represents grouped lengths (private.finalize_takeoff_lengths) is the one whose source comes first in
--    what the member sees: its page, its position, then its first takeoff line. It was the line with the smallest new
--    identifier, drawn at each run, so a preview and its confirmation could store another main page and position. The
--    outcome a send is compared with names each line's source (private.takeoff_send_execute): a confirmation that saw
--    another one is refused.
-- 2. The parts of a line (`takeoff_contributions.parts`) tell its active sources. A page replacement
--    (private.takeoff_replace_pages) kept the parts of the takeoff it replaced, and a later accumulation copied them; both
--    now list the parts from the line's active sources (private.takeoff_line_parts). A line stored with such a part is
--    not rewritten here: its next accumulation lists its parts again.
-- 3. A send command of format 2 writes the application's audit rows in its own transaction (once: a replay writes none);
--    format 1, the command of the previous application, which writes them after the commit itself, gets none.
--    private.takeoff_send_admitted_role admits both formats.
-- The previous application (v0.8.0, and main before this change) calls public.apply_takeoff_job_with_page_decisions,
-- public.apply_takeoff_job_guarded_atomic, public.stage_takeoff_send and public.send_takeoff_job unchanged: the same
-- lines, quantities, prices, sections and refusals, except which line represents grouped lengths and which parts a line
-- lists; its commands (format 1) are compared with the source of each line as well, which their dry run computes the
-- same way.
-- Replacing a function takes no lock on any table, and a running call keeps the definition it started with: nothing
-- needs to be drained. The lock timeout bounds the wait on the catalog rows of the replaced functions.
begin;

set local lock_timeout = '5s';

-- 1. The representative of grouped lengths. Unchanged but for the choice of the line that stays: of the lines grouped,
-- the one whose source comes first in what the member sees — its page (none last), its position in the section, then
-- the first of its takeoff lines (an identifier the takeoff keeps). Each line created here has its own takeoff lines,
-- so no two lines tie: the order is total, and two runs of one command keep the same line, its page and its position.
-- Only the guarded apply entry points can invoke this finalizer. Raw takeoff
-- measures are never changed; only this invocation's new duplicate outputs may be removed.
create or replace function private.finalize_takeoff_lengths(
  p_job_id uuid, p_created_count integer, p_updated_count integer, p_ignored_count integer,
  p_created_ids uuid[], p_scope text, p_links jsonb, p_plan jsonb
)
returns table(created_count integer,updated_count integer,ignored_count integer,created_ids uuid[],scope text,item_links jsonb)
language plpgsql security invoker set search_path = pg_catalog as $$
declare
  job_tenant uuid; job_version uuid; engine smallint;
  previous_writer text:=coalesce(current_setting('miaouffrage.estimate_v3_writer',true),'');
  removed uuid[]:='{}'::uuid[]; changed uuid[]:='{}'::uuid[];
begin
  if coalesce(current_setting('app.takeoff_apply_atomic',true),'')<>'on' then
    raise exception 'TAKEOFF_ATOMIC_APPLY_REQUIRED' using errcode='42501';
  end if;
  select job.tenant_id,job.estimate_version_id,version.calc_engine_version into job_tenant,job_version,engine
  from public.takeoff_jobs job join public.estimate_versions version on version.id=job.estimate_version_id
    and version.tenant_id=job.tenant_id where job.id=p_job_id;

  drop table if exists pg_temp._ti681_length_targets;
  create temporary table _ti681_length_targets on commit drop as
  select item.id,
    -- Existing destinations retain their identity, even when another line looks identical.
    jsonb_build_array(case when item.id=any(p_created_ids) then null else item.id end,
      (select jsonb_object_agg(field.key,field.value) from jsonb_each(to_jsonb(item)) field
        where field.key=any(array['tenant_id','version_id','parent_id','item_type','title','description','unit_code','unit_price_ht_cents','category_id','supply_type_id','labor_role_id','labor_role_atelier_id','labor_role_chantier_id','k_fo','k_mo','k_mo_atelier','k_mo_chantier','h_mo_per_unit','h_mo_atelier_per_unit','h_mo_chantier_per_unit','h_mo_majoration','pricing_status','tax_rate_bp','fo_provision','fo_price_origin','selected_supplier_price_id','product_id']
          ||case when engine=3 then '{}'::text[] else array['h_mo','h_mo_atelier','h_mo_chantier'] end)),
      jsonb_agg(distinct jsonb_build_array(source.metadata#>>'{rule_inputs,kind}',source.metadata#>>'{rule_inputs,network}',
        source.metadata#>>'{rule_inputs,material}',source.metadata#>>'{rule_inputs,dn}'))
    ) as identity,
    case when item.source_provider='dpgf' then item.quantity else sum(source.quantity) end as raw_quantity,
    case coalesce((private.normalize_unit(coalesce(item.unit_code,item.description))).unit_code,
      private.unit_token(coalesce(item.unit_code,item.description)))
      when 'm' then 1::numeric when 'ml' then 1::numeric when 'metre' then 1::numeric when 'metres' then 1::numeric
      when 'cm' then 0.01::numeric when 'mm' then 0.001::numeric when 'km' then 1000::numeric end as factor,
    item.source_page as page,item.position as position,(array_agg(source.id order by source.id))[1] as first_source
  from (select distinct link.takeoff_item_id,link.estimate_item_id
    from jsonb_to_recordset(p_links) as link(takeoff_item_id uuid,estimate_item_id uuid)) link
  join public.takeoff_items source on source.id=link.takeoff_item_id and source.job_id=p_job_id and source.tenant_id=job_tenant
  join public.estimate_items item on item.id=link.estimate_item_id and item.tenant_id=job_tenant and item.version_id=job_version
    and item.item_type='line' and item.source_provider in ('takeoff','dpgf')
  join jsonb_to_recordset(p_plan) as plan(item_id uuid,action text) on plan.item_id=source.id and plan.action<>'apply_assembly'
  group by item.id;
  delete from pg_temp._ti681_length_targets where factor is null;

  drop table if exists pg_temp._ti681_length_groups;
  create temporary table _ti681_length_groups on commit drop as
  select (array_agg(target.id order by target.page nulls last,target.position nulls last,target.first_source))[1] as representative,
    array_agg(target.id order by target.id) as ids,sum(target.raw_quantity) as raw_quantity,min(target.factor) as factor
  from pg_temp._ti681_length_targets target group by target.identity;
  select coalesce(array_agg(g.representative),'{}'::uuid[]) into changed from pg_temp._ti681_length_groups g;
  if cardinality(changed)>0 then
    if engine=3 then perform set_config('miaouffrage.estimate_v3_writer',job_version::text,true); end if;
    update public.estimate_items item set quantity=ceil(g.raw_quantity*g.factor)/g.factor,
      source_metadata=coalesce(item.source_metadata,'{}'::jsonb)||jsonb_build_object('takeoff_length_rounding',
        jsonb_build_object('version',1,'job_id',p_job_id,'raw_quantity',g.raw_quantity,'metres_per_unit',g.factor,
          'item_ids',(select jsonb_agg(link.takeoff_item_id order by link.takeoff_item_id)
            from jsonb_to_recordset(p_links) as link(takeoff_item_id uuid,estimate_item_id uuid)
            where link.estimate_item_id=any(g.ids))))
    from pg_temp._ti681_length_groups g where item.id=g.representative and item.tenant_id=job_tenant and item.version_id=job_version;
    select coalesce(array_agg(id),'{}'::uuid[]) into removed
    from pg_temp._ti681_length_groups g cross join lateral unnest(g.ids) ids(id)
    where id<>g.representative and id=any(p_created_ids);
    delete from public.estimate_items item where item.id=any(removed) and item.tenant_id=job_tenant and item.version_id=job_version;
    if engine=3 then
      perform public.estimate_v3_complete_entry_for_writer(job_version,changed);
      perform set_config('miaouffrage.estimate_v3_writer',previous_writer,true);
    else
      perform public.recalculate_takeoff_estimate_version(job_version,job_tenant);
    end if;
  end if;
  return query select p_created_count-cardinality(removed),p_updated_count,p_ignored_count,
    coalesce((select array_agg(id order by id) from unnest(p_created_ids) ids(id) where not id=any(removed)),'{}'::uuid[]),p_scope,
    coalesce((select jsonb_agg(jsonb_build_object('takeoff_item_id',link.takeoff_item_id,
      'estimate_item_id',coalesce(g.representative,link.estimate_item_id)) order by link.takeoff_item_id)
      from jsonb_to_recordset(p_links) as link(takeoff_item_id uuid,estimate_item_id uuid)
      left join pg_temp._ti681_length_groups g on link.estimate_item_id=any(g.ids)),'[]'::jsonb);
exception when others then
  perform set_config('miaouffrage.estimate_v3_writer',previous_writer,true);
  raise;
end;
$$;
revoke all on function private.finalize_takeoff_lengths(uuid,integer,integer,integer,uuid[],text,jsonb,jsonb)
  from public,anon,authenticated,service_role;

-- 2. The parts of a line, from its active sources (the takeoff lines private.takeoff_estimate_line_item_ids reads for
-- it): a stored part every takeoff line of which is still active, and named by no earlier part, is kept as it was (its
-- quantity and its request); the other active lines form one part per takeoff that measured them, with the sum of their
-- quantities and the request of that takeoff's stored part when there is one. A part whose takeoff lines a page
-- replacement took out is gone. Kept parts first, in their order, then the others in the order of their lines.
create function private.takeoff_line_parts(p_active uuid[], p_stored jsonb, p_tenant_id uuid)
returns jsonb
language sql stable set search_path = '' as $$
  with stored as (
    select part.value, part.ordinality,
      array(select private.takeoff_uuid_or_null(named.value)
        from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(part.value -> 'takeoff_item_ids') = 'array'
          then part.value -> 'takeoff_item_ids' else '[]'::jsonb end) as named(value)) as ids
    from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_stored) = 'array' then p_stored else '[]'::jsonb end)
      with ordinality as part(value, ordinality)
    where pg_catalog.jsonb_typeof(part.value) = 'object'
  ), first_named as (
    select distinct on (named.id) named.id, stored.ordinality
    from stored cross join lateral pg_catalog.unnest(stored.ids) as named(id)
    where named.id is not null
    order by named.id, stored.ordinality
  ), kept as (
    select stored.ordinality, stored.value, stored.ids from stored
    where pg_catalog.cardinality(stored.ids) > 0
      and not exists (select 1 from pg_catalog.unnest(stored.ids) as named(id)
        where named.id is null or not named.id = any(coalesce(p_active, '{}'::uuid[]))
          or exists (select 1 from first_named where first_named.id = named.id and first_named.ordinality <> stored.ordinality))
  ), rest as (
    select active.id, active.ordinality, source.job_id, source.quantity
    from pg_catalog.unnest(coalesce(p_active, '{}'::uuid[])) with ordinality as active(id, ordinality)
    left join public.takeoff_items as source on source.id = active.id and source.tenant_id = p_tenant_id
    where not exists (select 1 from kept where active.id = any(kept.ids))
  ), rebuilt as (
    select pg_catalog.min(rest.ordinality) as ordinality,
      pg_catalog.jsonb_build_object('job_id', rest.job_id,
        'takeoff_item_ids', pg_catalog.jsonb_agg(rest.id order by rest.ordinality),
        'quantity', pg_catalog.trim_scale(pg_catalog.sum(rest.quantity)))
      || coalesce((select pg_catalog.jsonb_build_object('request_id', stored.value -> 'request_id') from stored
          where stored.value ->> 'job_id' = rest.job_id::text and stored.value ? 'request_id'
          order by stored.ordinality limit 1), '{}'::jsonb) as value
    from rest group by rest.job_id
  )
  select coalesce(pg_catalog.jsonb_agg(entry.value order by entry.rank, entry.ordinality), '[]'::jsonb)
  from (select 0 as rank, kept.ordinality, kept.value from kept
    union all select 1, rebuilt.ordinality, rebuilt.value from rebuilt) as entry
$$;
revoke all on function private.takeoff_line_parts(uuid[], jsonb, uuid) from public, anon, authenticated, service_role;

-- After the atomic application (and the DPGF consolidation): each earlier estimate line the estimator replaces keeps
-- its identity, title, price, category, settings and lot C columns; its quantity is its measured quantity less the
-- earlier source lines of the replaced pages plus the new lines paired with it (rounded once, up to the unit, for a
-- length), or stays the estimator's own (« keep_mine »); its provenance becomes the new takeoff's. The lines this call
-- created for the paired new lines are deleted, the lines the estimator removes too. Returns the links it handled (the
-- paired new lines, now on their earlier line), the links left for finalize_takeoff_lengths, the deleted and the
-- updated ids. Unchanged but for `takeoff_contributions` (its parts from the line's active sources).
create or replace function private.takeoff_replace_pages(
  p_job_id uuid,
  p_tenant_id uuid,
  p_version_id uuid,
  p_links jsonb,
  p_created_ids uuid[]
)
returns table (handled_links jsonb, remaining_links jsonb, removed_ids uuid[], updated_ids uuid[])
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  engine smallint;
  old_writer text := coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true), '');
  conflict uuid;
  conflict_item uuid;
  conflict_pair uuid;
  deleted uuid[] := '{}'::uuid[];
  updated uuid[] := '{}'::uuid[];
begin
  if coalesce(pg_catalog.current_setting('app.takeoff_apply_atomic', true), '') <> 'on' then
    raise exception 'TAKEOFF_ATOMIC_APPLY_REQUIRED' using errcode = '42501';
  end if;
  if pg_catalog.to_regclass('pg_temp._ti682_lines') is null then
    raise exception 'TAKEOFF_ATOMIC_APPLY_REQUIRED' using errcode = '42501';
  end if;

  drop table if exists pg_temp._ti682_links;
  create temporary table _ti682_links on commit drop as
  select distinct link.takeoff_item_id, link.estimate_item_id
  from pg_catalog.jsonb_to_recordset(coalesce(p_links, '[]'::jsonb)) as link(takeoff_item_id uuid, estimate_item_id uuid);

  -- A paired new line must come out of the application as a line created by this call, or as its own earlier line (a
  -- `merge` by title). A new line `merge` sent onto another earlier line of these pages replaced it silently: without
  -- any decision, that is the page applied again; with decisions, a replacement the estimator did not see.
  select link.estimate_item_id, pair.takeoff_item_id, pair.estimate_item_id into conflict, conflict_item, conflict_pair
  from pg_temp._ti682_pairs as pair
  left join pg_temp._ti682_links as link on link.takeoff_item_id = pair.takeoff_item_id
  where link.estimate_item_id is null
    or not (link.estimate_item_id = pair.estimate_item_id or link.estimate_item_id = any(coalesce(p_created_ids, '{}'::uuid[])))
  order by pair.takeoff_item_id
  limit 1;
  if conflict_item is null then
    select link.estimate_item_id, link.takeoff_item_id into conflict, conflict_item
    from pg_temp._ti682_links as link
    join pg_temp._ti682_lines as line on line.id = link.estimate_item_id and line.source_provider is distinct from 'dpgf'
    where not exists (select 1 from pg_temp._ti682_pairs as pair where pair.takeoff_item_id = link.takeoff_item_id
      and pair.estimate_item_id = link.estimate_item_id)
    order by link.estimate_item_id, link.takeoff_item_id
    limit 1;
    if conflict is not null and not exists (select 1 from pg_temp._ti682_choices) then
      raise exception 'TAKEOFF_PAGE_ALREADY_APPLIED' using errcode = '23514',
        detail = private.takeoff_page_refusal_detail('merged_without_decision', (select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object('estimate_item_id', page.estimate_item_id, 'earlier_job_id', page.earlier_job_id,
            'source_file_name', page.source_file_name, 'source_page', page.source_page) order by page.page_rank)
          from pg_temp._ti682_conflicts as page where page.estimate_item_id = conflict));
    end if;
  end if;
  if conflict_item is not null then
    -- The new line, the earlier line `merge` put it on (null: none) and the line it was paired with (null: none).
    raise exception 'TAKEOFF_PAGE_REPLACE_CONFLICT' using errcode = '40001',
      detail = pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('scope', 'page', 'reason', 'merge_elsewhere',
        'takeoff_item_id', conflict_item, 'estimate_item_id', conflict, 'paired_estimate_item_id', conflict_pair))::text;
  end if;
  if not exists (select 1 from pg_temp._ti682_pairs) and not exists (select 1 from pg_temp._ti682_choices) then
    return query select '[]'::jsonb, coalesce(p_links, '[]'::jsonb), '{}'::uuid[], '{}'::uuid[];
    return;
  end if;

  select version.calc_engine_version into engine from public.estimate_versions as version
  where version.id = p_version_id and version.tenant_id = p_tenant_id;
  if engine = 3 then
    perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', p_version_id::text, true);
  end if;

  drop table if exists pg_temp._ti682_replaced;
  create temporary table _ti682_replaced on commit drop as
  select line.id, line.quantity as previous_quantity, line.factor, line.measured_raw,
    pg_catalog.max(choice.take) as take,
    coalesce((select pg_catalog.array_agg(distinct removed.id) from pg_temp._ti682_choices as removing
      cross join lateral pg_catalog.unnest(removing.item_ids) as removed(id)
      where removing.estimate_item_id = line.id and removing.action = 'update'), '{}'::uuid[]) as removed_ids,
    line.source_ids
  from pg_temp._ti682_lines as line
  join pg_temp._ti682_choices as choice on choice.estimate_item_id = line.id and choice.action = 'update'
  group by line.id, line.quantity, line.factor, line.measured_raw, line.source_ids;

  drop table if exists pg_temp._ti682_outcome;
  create temporary table _ti682_outcome on commit drop as
  select replaced.id, replaced.previous_quantity, replaced.take, replaced.factor,
    -- An engine 1/2 line names no source: the page's earlier part is the whole line.
    case when pg_catalog.cardinality(replaced.source_ids) = 0 then replaced.previous_quantity
      else coalesce((select pg_catalog.sum(source.quantity) from public.takeoff_items as source
        where source.id = any(replaced.removed_ids) and source.tenant_id = p_tenant_id), 0) end as removed_raw,
    added.raw as added_raw,
    case when pg_catalog.cardinality(replaced.source_ids) = 0 then 0
      else coalesce((select pg_catalog.sum(source.quantity) from public.takeoff_items as source
        where source.id = any(replaced.source_ids) and not source.id = any(replaced.removed_ids)
          and source.tenant_id = p_tenant_id), 0) end + added.raw as new_raw,
    added.ids || array(select kept.id from pg_catalog.unnest(replaced.source_ids) as kept(id)
      where not kept.id = any(replaced.removed_ids)) as item_ids,
    added.first_id, added.file_name, added.page,
    (select pg_catalog.array_agg(distinct source.job_id) from public.takeoff_items as source
      where source.id = any(replaced.removed_ids)) as replaced_job_ids
  from pg_temp._ti682_replaced as replaced
  cross join lateral (
    select pg_catalog.sum(source.quantity) as raw, pg_catalog.array_agg(source.id order by source.id) as ids,
      (pg_catalog.array_agg(source.id order by source.id))[1] as first_id,
      (pg_catalog.array_agg(source.source_file_name order by source.id))[1] as file_name,
      (pg_catalog.array_agg(source.source_page order by source.id))[1] as page
    from pg_temp._ti682_pairs as pair
    join public.takeoff_items as source on source.id = pair.takeoff_item_id and source.job_id = p_job_id
      and source.tenant_id = p_tenant_id
    where pair.estimate_item_id = replaced.id
  ) as added;

  update public.estimate_items as item
  set quantity = case when outcome.take = 'keep_mine' then outcome.previous_quantity
      when outcome.factor is not null then pg_catalog.ceil(outcome.new_raw * outcome.factor) / outcome.factor
      else outcome.new_raw end,
    -- What `merge` may have rewritten on its own earlier line is the estimator's: title and description. Its price and
    -- category are never written (private.takeoff_page_writer_plan), so no trigger derives anything from them.
    title = line.title, description = line.description,
    source_provider = 'takeoff', source_job_id = p_job_id,
    source_file_name = outcome.file_name, source_page = outcome.page,
    -- A line several sends fed (`takeoff_contributions`, lot 2 M2) lists its parts again from its active sources: the
    -- replaced takeoff's part goes, the new takeoff's comes. A line without them gets none.
    source_metadata = rewritten.value || case when line.source_metadata ? 'takeoff_contributions'
      then pg_catalog.jsonb_build_object('takeoff_contributions', pg_catalog.jsonb_build_object('version', 1, 'job_id', p_job_id,
        'item_ids', pg_catalog.to_jsonb(rewritten.active),
        'parts', private.takeoff_line_parts(rewritten.active, line.source_metadata #> '{takeoff_contributions,parts}', p_tenant_id)))
      else '{}'::jsonb end,
    updated_at = pg_catalog.statement_timestamp()
  from pg_temp._ti682_outcome as outcome
  join pg_temp._ti682_lines as line on line.id = outcome.id
  cross join lateral (select written.value,
      private.takeoff_estimate_line_item_ids(written.value - 'takeoff_contributions', p_job_id) as active
    from (select (coalesce(line.source_metadata, '{}'::jsonb) - 'takeoff_length_rounding' - 'takeoff_page_replacement')
      || pg_catalog.jsonb_build_object('takeoff_item_id', outcome.first_id)
      || case when outcome.factor is not null then pg_catalog.jsonb_build_object('takeoff_length_rounding',
        pg_catalog.jsonb_build_object('version', 1, 'job_id', p_job_id, 'raw_quantity', outcome.new_raw,
          'metres_per_unit', outcome.factor, 'item_ids', pg_catalog.to_jsonb(outcome.item_ids))) else '{}'::jsonb end
      || pg_catalog.jsonb_build_object('takeoff_page_replacement', pg_catalog.jsonb_build_object('version', 1,
        'job_id', p_job_id, 'replaced_job_ids', pg_catalog.to_jsonb(coalesce(outcome.replaced_job_ids, '{}'::uuid[])),
        'previous_quantity', outcome.previous_quantity, 'removed_raw', outcome.removed_raw, 'added_raw', outcome.added_raw,
        'take', coalesce(outcome.take, 'new'), 'item_ids', pg_catalog.to_jsonb(outcome.item_ids))) as value) as written
  ) as rewritten
  where item.id = outcome.id and item.version_id = p_version_id and item.tenant_id = p_tenant_id;
  select coalesce(pg_catalog.array_agg(outcome.id order by outcome.id), '{}'::uuid[]) into updated from pg_temp._ti682_outcome as outcome;

  -- The lines this call created for the paired new lines, and the earlier lines the estimator removes.
  select coalesce(pg_catalog.array_agg(distinct deleted_id.id), '{}'::uuid[]) into deleted
  from (
    select link.estimate_item_id as id from pg_temp._ti682_pairs as pair
    join pg_temp._ti682_links as link on link.takeoff_item_id = pair.takeoff_item_id
    where link.estimate_item_id = any(coalesce(p_created_ids, '{}'::uuid[])) and link.estimate_item_id <> pair.estimate_item_id
    union
    select choice.estimate_item_id from pg_temp._ti682_choices as choice where choice.action = 'remove'
  ) as deleted_id;
  delete from public.estimate_items as item
  where item.id = any(deleted) and item.version_id = p_version_id and item.tenant_id = p_tenant_id;

  if engine = 3 then
    perform public.estimate_v3_complete_entry_for_writer(p_version_id, updated);
    perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', old_writer, true);
  else
    perform public.recalculate_takeoff_estimate_version(p_version_id, p_tenant_id);
  end if;

  return query select
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('takeoff_item_id', pair.takeoff_item_id,
      'estimate_item_id', pair.estimate_item_id) order by pair.takeoff_item_id) from pg_temp._ti682_pairs as pair), '[]'::jsonb),
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('takeoff_item_id', link.takeoff_item_id,
      'estimate_item_id', link.estimate_item_id) order by link.takeoff_item_id) from pg_temp._ti682_links as link
      where not exists (select 1 from pg_temp._ti682_pairs as pair where pair.takeoff_item_id = link.takeoff_item_id)), '[]'::jsonb),
    deleted, updated;
exception when others then
  perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', old_writer, true);
  raise;
end;
$$;
revoke all on function private.takeoff_replace_pages(uuid, uuid, uuid, jsonb, uuid[]) from public, anon, authenticated, service_role;

-- 3. Both formats of a send command. Unchanged but for its format: 1 (the previous application, which writes the
-- application's audit rows after the commit) or 2 (the send writes them in its transaction, private.takeoff_send_execute).
-- The staged command as public.send_takeoff_job admits it: its shape, no price effect, and the actor an operator of the
-- tenant. Returns the actor's role; raises the refusal.
create or replace function private.takeoff_send_admitted_role(p_command jsonb, p_request uuid, p_job_id uuid, p_actor uuid, p_tenant uuid)
returns public.tenant_role
language plpgsql set search_path = '' as $$
declare
  actor_role public.tenant_role;
begin
  if pg_catalog.jsonb_typeof(p_command) is distinct from 'object'
    or p_command - array['format_version', 'mode', 'request_id', 'job_id', 'fingerprint', 'client', 'destination', 'section',
      'expected', 'mapping_plan', 'page_decisions', 'rule_results', 'rule_transforms', 'accumulations', 'override',
      'price_rules_ignored', 'expected_outcome'] <> '{}'::jsonb
    or p_command ->> 'request_id' is distinct from p_request::text or p_command ->> 'job_id' is distinct from p_job_id::text
    or p_command -> 'format_version' is null or p_command -> 'format_version' not in ('1'::jsonb, '2'::jsonb)
    or (p_command ->> 'mode') is null or (p_command ->> 'mode') not in ('send', 'dry_run')
    or pg_catalog.jsonb_typeof(p_command -> 'destination') is distinct from 'object'
    or (p_command #>> '{destination,kind}') is null
    or (p_command #>> '{destination,kind}') not in ('first_draft', 'existing_draft', 'version_copy')
    or pg_catalog.jsonb_typeof(p_command -> 'section') is distinct from 'object'
    or (p_command #>> '{section,kind}') is null or (p_command #>> '{section,kind}') not in ('new', 'existing')
    or coalesce(p_command #>> '{section,id}', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or ((p_command #>> '{section,kind}') = 'new' and char_length(btrim(coalesce(p_command #>> '{section,title}', '')))
      not between 1 and 200)
    or pg_catalog.jsonb_typeof(p_command -> 'expected') is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_command #> '{expected,versions}') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_command #> '{expected,job_stamp}') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_command #> '{expected,mapping_stamp}') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_command -> 'mapping_plan') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_command -> 'page_decisions') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_command -> 'rule_results') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_command -> 'rule_transforms') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_command -> 'accumulations') is distinct from 'array'
    or pg_catalog.jsonb_typeof(coalesce(p_command -> 'price_rules_ignored', '[]'::jsonb)) is distinct from 'array'
    or coalesce(pg_catalog.jsonb_typeof(p_command -> 'override'), 'null') not in ('null', 'object')
    -- A send carries the outcome its member saw; a dry run computes it.
    or ((p_command ->> 'mode') = 'send' and pg_catalog.jsonb_typeof(p_command -> 'expected_outcome') is distinct from 'object')
    or ((p_command ->> 'mode') = 'dry_run' and coalesce(pg_catalog.jsonb_typeof(p_command -> 'expected_outcome'), 'null') <> 'null')
    or ((p_command #>> '{destination,kind}') = 'first_draft'
      and pg_catalog.jsonb_typeof(p_command #> '{destination,version_payload}') is distinct from 'object')
    or ((p_command #>> '{destination,kind}') = 'existing_draft'
      and coalesce(p_command #>> '{destination,version_id}', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    or ((p_command #>> '{destination,kind}') = 'version_copy'
      and coalesce(p_command #>> '{destination,source_version_id}', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    -- A new version gets a new section; a section of the version is chosen only in an existing draft.
    or ((p_command #>> '{destination,kind}') <> 'existing_draft' and (p_command #>> '{section,kind}') <> 'new')
  then
    raise exception 'TAKEOFF_SEND_COMMAND_INVALID' using errcode = '22023';
  end if;
  -- Prices are never touched by this journey: a mapping rule that sets a price or folds lines into a priced ouvrage is
  -- neutralised by the server before the plan is built (it is reported in the preview and the receipt).
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_command -> 'mapping_plan') as plan_entry(value)
    where pg_catalog.jsonb_typeof(plan_entry.value) <> 'object'
      or plan_entry.value ->> 'action' in ('set_price', 'apply_assembly')
      or plan_entry.value -> 'unit_price_cents' is distinct from 'null'::jsonb
      or plan_entry.value -> 'assembly_id' is distinct from 'null'::jsonb
  ) then
    raise exception 'TAKEOFF_SEND_PRICE_RULE_REFUSED' using errcode = '22023';
  end if;

  select membership.role into actor_role
  from public.tenant_memberships as membership
  join public.tenants as tenant_row on tenant_row.id = membership.tenant_id and tenant_row.is_active
  where membership.tenant_id = p_tenant and membership.user_id = p_actor;
  if actor_role is null or actor_role not in ('admin'::public.tenant_role, 'engineer'::public.tenant_role) then
    raise exception 'TAKEOFF_APPLY_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  return actor_role;
end;
$$;
revoke all on function private.takeoff_send_admitted_role(jsonb, uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- 4. The send. Unchanged but for three things: the outcome names each line's source (its file, its page and the takeoff
-- line it names), so that a confirmation that saw another line represent grouped lengths is refused; an addition to an
-- earlier line lists its parts from the line's active sources (private.takeoff_line_parts) before its own; a command of
-- format 2 writes the application's audit rows in this transaction, as the server wrote them after the commit.
-- The send, run once by public.send_takeoff_job (and rolled back when the command is a dry run: the preview).
--
-- Lock order, one for every destination and shared with the import and the first creation of a version
-- (persist_estimate_creation_atomic) and with the application (apply_takeoff_job_with_page_decisions): the tenant's
-- calculation policy (shared), the affaire's row (and, at once, the comparison of its versions: a command read before a
-- version was created waits for nothing else), then for an existing draft its rule lock `takeoff-rules:<version>`, the
-- estimate editor's lock of the draft (the key its lease acquisition takes before the version's row) and the version's
-- row, then the job's locks and row, then the tenant's mapping rules (shared), then the lines. Never the reverse.
-- The affaire's row is held FOR NO KEY UPDATE: two sends, and a send and the creation of a version (which holds it FOR
-- UPDATE), wait for each other, and the versions of the affaire are compared only once it is held, so no version is
-- created after the comparison; the key-share locks of foreign keys to the affaire (the notice of an analysis that ends,
-- whose worker holds the version's rule lock; this send's own receipt) are not blocked by it. A preview of an existing
-- draft creates no version and holds the affaire FOR SHARE, as the editor's saves read it, so that it never makes a save
-- fail; a preview of a new version holds it as the send does. The version's row is held FOR NO KEY UPDATE (the send
-- updates it, never its key): the foreign keys of the editor's lease and of new lines are not blocked by it.
create or replace function private.takeoff_send_execute(p_actor uuid, p_tenant uuid, p_role public.tenant_role, p_request uuid,
  p_command jsonb, p_dry_run boolean)
returns jsonb
language plpgsql set search_path = '' as $$
declare
  kind text := p_command #>> '{destination,kind}';
  target_job_id uuid := (p_command ->> 'job_id')::uuid;
  job public.takeoff_jobs%rowtype;
  project public.estimate_projects%rowtype;
  existing public.takeoff_send_receipts%rowtype;
  target_version uuid;
  source_version uuid;
  target_engine smallint;
  version_created boolean := false;
  created_lock uuid;
  section_id uuid;
  section_created boolean := false;
  section_position integer;
  current_versions jsonb;
  stale_reason text;
  created jsonb;
  applied record;
  links jsonb;
  created_ids uuid[];
  accumulated uuid[] := '{}'::uuid[];
  removed uuid[] := '{}'::uuid[];
  entry record;
  rules_written integer;
  previous_writer text;
  outcome jsonb;
  result jsonb;
  plan jsonb;
  mapped jsonb;
begin
  select * into job from public.takeoff_jobs as candidate where candidate.id = target_job_id;
  if not found or job.tenant_id is distinct from p_tenant then
    raise exception 'TAKEOFF_JOB_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('estimate-calc-policy:' || p_tenant::text, 0));
  if p_dry_run and kind = 'existing_draft' then
    select * into project from public.estimate_projects as row_project
    where row_project.id = job.project_id and row_project.tenant_id = p_tenant
    for share;
  else
    select * into project from public.estimate_projects as row_project
    where row_project.id = job.project_id and row_project.tenant_id = p_tenant
    for no key update;
  end if;
  if project.id is null or project.is_archived
    or (p_role <> 'admin'::public.tenant_role and project.user_id is distinct from p_actor) then
    raise exception 'TAKEOFF_SEND_PROJECT_NOT_WRITABLE' using errcode = '42501';
  end if;
  -- The affaire held, a command of this request that committed meanwhile is visible now (two sends of one affaire wait
  -- for each other on its row).
  if not p_dry_run then
    select * into existing from public.takeoff_send_receipts as stored
    where stored.tenant_id = p_tenant and stored.request_id = p_request;
    if found then
      return pg_catalog.jsonb_build_object('replay', existing.id);
    end if;
  end if;
  -- The affaire's versions, compared as soon as its row is held and before any other wait: a command read before a version
  -- was created or changed status (a first draft on an affaire that has one) is refused at once, and holds the affaire no
  -- longer than that, so that the saves of that version's editor are not refused meanwhile. Their dates are compared again
  -- once every lock is held, below.
  if (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', version.id, 'status', version.status)
        order by version.id::text), '[]'::jsonb)
      from public.estimate_versions as version where version.project_id = job.project_id and version.tenant_id = p_tenant)
    is distinct from (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', expected.value -> 'id',
        'status', expected.value -> 'status') order by expected.value ->> 'id'), '[]'::jsonb)
      from pg_catalog.jsonb_array_elements(p_command #> '{expected,versions}') as expected(value)) then
    raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', 'destination_changed')::text;
  end if;
  if kind = 'existing_draft' then
    target_version := (p_command #>> '{destination,version_id}')::uuid;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-rules:' || target_version::text, 0));
    -- The editor's lock, in the editor's order: its lease acquisition takes this key, then the version's row through the
    -- lease's foreign key (public.assign_draft_lock_tenant_id).
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_version::text, 0));
    if p_dry_run then
      -- As the editor's acquisition does first, expired leases go (here with the preview's rollback). A member who
      -- edits the draft refuses the preview before it takes anything their saves need.
      delete from public.draft_locks as expired
      where expired.version_id = target_version and expired.tenant_id = p_tenant
        and expired.expires_at <= pg_catalog.statement_timestamp();
      if exists (select 1 from public.draft_locks as lock_row where lock_row.version_id = target_version
        and lock_row.user_id <> p_actor and lock_row.expires_at > pg_catalog.statement_timestamp()) then
        raise exception 'TAKEOFF_SEND_DRAFT_LOCKED' using errcode = '55P03';
      end if;
    end if;
    select version.calc_engine_version into target_engine from public.estimate_versions as version
    where version.id = target_version and version.tenant_id = p_tenant and version.project_id = job.project_id
      and version.status = 'draft'::public.estimate_status
    for no key update;
    if not found then
      raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'destination_changed')::text;
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-job-rules:' || target_job_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-job:' || target_job_id::text, 0));
  select * into job from public.takeoff_jobs as candidate where candidate.id = target_job_id for update;
  if job.estimate_version_id is not null or job.status is distinct from 'completed'::public.takeoff_job_status then
    if exists (select 1 from public.takeoff_send_receipts as stored
      where stored.job_id = target_job_id and stored.command_kind = 'send') then
      raise exception 'TAKEOFF_SEND_ALREADY_SENT' using errcode = '40001';
    end if;
    raise exception 'TAKEOFF_SEND_JOB_NOT_READY' using errcode = '40001';
  end if;
  -- The mapping rules the preview's plan comes from stay as they are until this transaction ends.
  perform 1 from public.takeoff_mapping_rules as rule where rule.tenant_id = p_tenant for share;

  -- What the preview evaluated, read again under the locks.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', version.id, 'status', version.status,
      'updated_at', version.updated_at) order by version.id), '[]'::jsonb)
    into current_versions
  from public.estimate_versions as version
  where version.project_id = job.project_id and version.tenant_id = p_tenant;
  stale_reason := case
    when current_versions is distinct from p_command #> '{expected,versions}' then 'destination_changed'
    when kind = 'first_draft' and current_versions <> '[]'::jsonb then 'destination_changed'
    when public.takeoff_rule_job_stamp(p_tenant, job.project_id, target_job_id) is distinct from p_command #>> '{expected,job_stamp}'
      then 'takeoff_changed'
    when public.takeoff_mapping_rules_stamp(p_tenant) is distinct from p_command #>> '{expected,mapping_stamp}' then 'mapping_changed'
    when kind = 'existing_draft' and public.takeoff_send_peers_stamp(p_tenant, target_version)
      is distinct from p_command #>> '{expected,peers_stamp}' then 'estimate_changed'
    -- A copy is compared with the takeoffs of the version it copies (they become the copy's peers).
    when kind = 'version_copy' and public.takeoff_send_peers_stamp(p_tenant, (p_command #>> '{destination,source_version_id}')::uuid)
      is distinct from p_command #>> '{expected,peers_stamp}' then 'estimate_changed'
  end;
  if stale_reason is not null then
    raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', stale_reason)::text;
  end if;

  if kind = 'first_draft' then
    section_id := (p_command #>> '{section,id}')::uuid;
    created := public.persist_estimate_creation_atomic(p_tenant, p_actor, job.project_id, null,
      p_command #> '{destination,version_payload}',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', section_id, 'parent_id', null, 'item_type', 'section',
        'position', 1, 'title', btrim(p_command #>> '{section,title}'))),
      null);
    target_version := (created #>> '{version,id}')::uuid;
    version_created := true;
    section_created := true;
  elsif kind = 'version_copy' then
    source_version := (p_command #>> '{destination,source_version_id}')::uuid;
    if not exists (select 1 from public.estimate_versions as version where version.id = source_version
      and version.tenant_id = p_tenant and version.project_id = job.project_id
      and version.status <> 'draft'::public.estimate_status) then
      raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'destination_changed')::text;
    end if;
    target_version := public.duplicate_estimate_version(source_version, false);
    version_created := true;
  end if;
  select version.calc_engine_version into target_engine from public.estimate_versions as version
  where version.id = target_version and version.tenant_id = p_tenant;

  -- A version that holds a DPGF line is sent through its reconciliation, which needs the job on the version first:
  -- refused before anything is attached (the preview names this blocker first and offers no confirmation).
  if exists (select 1 from public.estimate_items as item where item.version_id = target_version and item.tenant_id = p_tenant
    and item.item_type = 'line'::public.estimate_item_type and item.source_provider = 'dpgf') then
    raise exception 'TAKEOFF_SEND_DPGF_RECONCILIATION_REQUIRED' using errcode = '22023';
  end if;

  -- The section that receives the lines: created here for a new version or on request, else one of the draft's.
  if not section_created then
    section_id := (p_command #>> '{section,id}')::uuid;
    if (p_command #>> '{section,kind}') = 'new' then
      select coalesce(max(item.position), 0) + 1 into section_position from public.estimate_items as item
      where item.version_id = target_version and item.tenant_id = p_tenant and item.parent_id is null;
      previous_writer := coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true), '');
      if target_engine = 3 then
        perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', target_version::text, true);
      end if;
      insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title)
      values (section_id, p_tenant, target_version, null, 'section'::public.estimate_item_type, section_position,
        btrim(p_command #>> '{section,title}'));
      perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', previous_writer, true);
      section_created := true;
    elsif not exists (select 1 from public.estimate_items as item where item.id = section_id
      and item.version_id = target_version and item.tenant_id = p_tenant and item.item_type = 'section'::public.estimate_item_type) then
      raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'estimate_changed')::text;
    end if;
  end if;

  -- What the destination holds before the send, and a reference of each item that does not depend on this run: its id in
  -- an existing draft, the id of the item it copies in a copy (copies map by position, as duplicate_estimate_version
  -- maps them), « new » for the section this command creates. The outcome compares the dry run with the send by them.
  drop table if exists pg_temp._takeoff_send_refs;
  create temporary table _takeoff_send_refs (id uuid primary key, ref text not null) on commit drop;
  if kind = 'existing_draft' then
    insert into pg_temp._takeoff_send_refs (id, ref)
    select item.id, 'item:' || item.id::text from public.estimate_items as item
    where item.version_id = target_version and item.tenant_id = p_tenant;
  elsif kind = 'version_copy' then
    insert into pg_temp._takeoff_send_refs (id, ref)
    with recursive source_tree as (
      select item.id, array[item.position] as path from public.estimate_items as item
      where item.version_id = source_version and item.parent_id is null
      union all
      select child.id, parent.path || child.position from public.estimate_items as child
      join source_tree as parent on parent.id = child.parent_id where child.version_id = source_version
    ), copy_tree as (
      select item.id, array[item.position] as path from public.estimate_items as item
      where item.version_id = target_version and item.parent_id is null and item.id <> section_id
      union all
      select child.id, parent.path || child.position from public.estimate_items as child
      join copy_tree as parent on parent.id = child.parent_id where child.version_id = target_version
    )
    select copied.id, 'copy:' || original.id::text from copy_tree as copied join source_tree as original on original.path = copied.path;
  end if;
  if section_created then
    insert into pg_temp._takeoff_send_refs (id, ref) values (section_id, 'new') on conflict (id) do update set ref = 'new';
  end if;
  drop table if exists pg_temp._takeoff_send_before;
  create temporary table _takeoff_send_before on commit drop as
  select item.id, item.parent_id, item.title,
    private.takeoff_send_line_unit(target_engine, item.unit_code, item.description) as unit,
    case when private.takeoff_send_line_unit(target_engine, item.unit_code, item.description) is null
      then item.pricing_status::text end as unitless_status,
    item.quantity, item.unit_price_ht_cents, item.source_job_id, item.updated_at,
    pg_catalog.jsonb_build_object('file', item.source_file_name, 'page', item.source_page,
      'takeoff_item_id', item.source_metadata ->> 'takeoff_item_id') as source
  from public.estimate_items as item
  where item.version_id = target_version and item.tenant_id = p_tenant and item.item_type = 'line'::public.estimate_item_type;

  -- The application checks the actor's draft lock. A version created here has no other holder: its lock lives only in
  -- this transaction. An existing draft is locked by the actor before the send, as for any application; its dry run
  -- uses the actor's lease as it is, or, when the draft has none (another member's refused the preview above, expired
  -- ones went), takes one for its rolled-back run. No lease is ever changed.
  if version_created then
    insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
    values (target_version, p_actor, p_tenant, pg_catalog.statement_timestamp() + interval '5 minutes', gen_random_uuid())
    returning id into created_lock;
  elsif p_dry_run and not exists (select 1 from public.draft_locks as lock_row where lock_row.version_id = target_version
    and lock_row.user_id = p_actor and lock_row.expires_at > pg_catalog.statement_timestamp()) then
    insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
    values (target_version, p_actor, p_tenant, pg_catalog.statement_timestamp() + interval '5 minutes', gen_random_uuid());
  end if;

  -- The historical receipt of a launch on a version (takeoff_jobs_prepared_plan_receipt_uidx) holds one job per version,
  -- plan set, preparation revision, level and provider. A versionless job of that same launch is refused by name here;
  -- the launch requests of a later migration narrow that index to the jobs they do not own.
  if exists (select 1 from public.takeoff_jobs as other
    where other.tenant_id = p_tenant and other.estimate_version_id = target_version and other.id <> target_job_id
      and other.plan_set_id = job.plan_set_id and other.level = job.level
      and other.execution_provider is not distinct from job.execution_provider
      and other.preparation_snapshot is not null
      and other.preparation_snapshot ->> 'preparation_revision' = job.preparation_snapshot ->> 'preparation_revision') then
    raise exception 'TAKEOFF_SEND_PREPARATION_ALREADY_SENT' using errcode = '22023';
  end if;

  -- The door: the job's version goes from NULL to this draft of its affaire, once, by this command's permit.
  insert into private.takeoff_job_attachment_permits (job_id, tenant_id, project_id, version_id)
  values (target_job_id, p_tenant, job.project_id, target_version);
  update public.takeoff_jobs as attached set estimate_version_id = target_version where attached.id = target_job_id;
  if exists (select 1 from private.takeoff_job_attachment_permits as permit where permit.job_id = target_job_id) then
    raise exception 'TAKEOFF_SEND_PERMIT_NOT_CONSUMED' using errcode = 'P0001';
  end if;

  -- The controls that compare with other takeoffs and with the DPGF, evaluated for this destination by the preview from
  -- the state checked above: every line with rule inputs receives them, or nothing is sent.
  select pg_catalog.count(*) into rules_written
  from takeoff_internal.persist_rule_results(p_tenant, target_version, array[target_job_id], p_command -> 'rule_results',
    p_command -> 'rule_transforms');
  if rules_written <> pg_catalog.jsonb_array_length(p_command -> 'rule_results')
    or exists (select 1 from public.takeoff_items as item
      cross join lateral pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(item.rule_results) = 'array'
        then item.rule_results else '[]'::jsonb end) as rule_result(value)
      where item.job_id = target_job_id and item.tenant_id = p_tenant
        and rule_result.value #>> '{details,cross_job_comparison}' = 'deferred') then
    raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', 'rules_changed')::text;
  end if;

  -- An administrator's override, bound to this destination, checked again by the application's trigger.
  if pg_catalog.jsonb_typeof(p_command -> 'override') = 'object' then
    if p_role <> 'admin'::public.tenant_role then
      raise exception 'TAKEOFF_APPLY_GUARD_FAILED' using errcode = 'P0001';
    end if;
    insert into public.audit_logs (tenant_id, user_id, table_name, record_id, estimate_version_id, action, after_data)
    values (p_tenant, p_actor, 'takeoff_jobs', target_job_id, target_version, 'takeoff.apply.override',
      pg_catalog.jsonb_build_object('schema_version', 1, 'action', 'takeoff.apply.override', 'job_id', target_job_id,
        'tenant_id', p_tenant, 'user_id', p_actor,
        'metadata', (p_command -> 'override') || pg_catalog.jsonb_build_object('estimate_version_id', target_version)));
  end if;

  -- The lines a mapping rule changes (renamed, classified or set aside), read before the writer applies the plan: what
  -- the application's audit names for a command of format 2.
  mapped := (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('item_id', source.id,
      'rule_id', private.takeoff_uuid_or_null(plan_entry.value -> 'rule_id'), 'action', plan_entry.value ->> 'action')
      order by plan_entry.ordinality), '[]'::jsonb)
    from pg_catalog.jsonb_array_elements(p_command -> 'mapping_plan') with ordinality as plan_entry(value, ordinality)
    join public.takeoff_items as source on source.id = private.takeoff_uuid_or_null(plan_entry.value -> 'item_id')
      and source.job_id = target_job_id and source.tenant_id = p_tenant
    where plan_entry.value ->> 'action' is distinct from 'none' and not source.is_excluded);

  select result_row.* into applied from public.apply_takeoff_job_with_page_decisions(target_job_id, 'append', section_id,
    p_command -> 'mapping_plan', p_command -> 'page_decisions', null) as result_row;
  links := coalesce(applied.item_links, '[]'::jsonb);
  created_ids := coalesce(applied.created_ids, '{}'::uuid[]);

  -- An engine 2 line names no takeoff line of its own. Each line this send creates there names the ones it sums, as a
  -- DPGF line names the measures it keeps (takeoff_quantity_policy): a later send can add to it (plan A then plan B)
  -- and a page re-read finds it.
  if target_engine is distinct from 3 then
    update public.estimate_items as line set source_metadata = coalesce(line.source_metadata, '{}'::jsonb)
      || pg_catalog.jsonb_build_object('takeoff_contributions', pg_catalog.jsonb_build_object('version', 1, 'job_id', target_job_id,
        'item_ids', sources.ids, 'parts', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('job_id', target_job_id,
          'request_id', p_request, 'takeoff_item_ids', sources.ids, 'quantity', pg_catalog.trim_scale(line.quantity)))))
    from (select (output.value ->> 'estimate_item_id')::uuid as estimate_item_id,
        pg_catalog.jsonb_agg(output.value -> 'takeoff_item_id' order by output.value ->> 'takeoff_item_id') as ids
      from pg_catalog.jsonb_array_elements(links) as output(value) group by 1) as sources
    where line.id = sources.estimate_item_id and line.id = any(created_ids) and line.version_id = target_version
      and line.tenant_id = p_tenant and line.source_provider = 'takeoff'
      and pg_catalog.cardinality(private.takeoff_estimate_line_item_ids(line.source_metadata, line.source_job_id)) = 0;
  end if;

  -- Earlier takeoff lines of the same item (plan A sent 3, plan B adds 2: one line of 5). The preview proposed each part,
  -- with the line as it read it; the line must still be that line, measured by its takeoff lines only (never a quantity
  -- typed by hand), in the section, of the same title and unit, with no hypothesis nor rounded length on either side.
  -- On both engines: engine 3 completes the line as its writer does, engine 2 recalculates the version (as the DPGF
  -- composition does); the price, unit, hours and supplier stay the line's.
  for entry in
    select part.takeoff_item_id, part.estimate_item_id, part.expected_updated_at, part.expected_quantity, link.created_id
    from pg_catalog.jsonb_to_recordset(p_command -> 'accumulations')
      as part(takeoff_item_id uuid, estimate_item_id uuid, expected_updated_at timestamptz, expected_quantity numeric)
    left join lateral (select (output.value ->> 'estimate_item_id')::uuid as created_id
      from pg_catalog.jsonb_array_elements(links) as output(value)
      where (output.value ->> 'takeoff_item_id')::uuid = part.takeoff_item_id) as link on true
    order by part.estimate_item_id, part.takeoff_item_id
  loop
    if entry.created_id is null or not entry.created_id = any(created_ids)
      or entry.estimate_item_id = any(created_ids) or entry.estimate_item_id = any(removed) then
      raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'accumulation_changed', 'estimate_item_id', entry.estimate_item_id)::text;
    end if;
    perform 1 from public.estimate_items as earlier where earlier.id = entry.estimate_item_id for update;
    if not exists (
      select 1
      from public.estimate_items as earlier
      join public.estimate_items as added on added.id = entry.created_id and added.version_id = earlier.version_id
      join public.takeoff_items as source on source.id = entry.takeoff_item_id and source.job_id = target_job_id
      cross join lateral (select private.takeoff_estimate_line_item_ids(earlier.source_metadata, earlier.source_job_id) as ids) as sources
      cross join lateral (select pg_catalog.sum(own.quantity) as raw, pg_catalog.count(*) as readable
        from public.takeoff_items as own where own.id = any(sources.ids) and own.tenant_id = p_tenant) as measured
      where earlier.id = entry.estimate_item_id and earlier.version_id = target_version and earlier.tenant_id = p_tenant
        and earlier.item_type = 'line'::public.estimate_item_type and earlier.parent_id = section_id
        and earlier.source_provider = 'takeoff'
        -- The line as the preview read it, before this send (the engine 2 writer recalculates and dates anew every line of
        -- the version); a second part for the same line finds it as the first part left it.
        and (entry.estimate_item_id = any(accumulated)
          or exists (select 1 from pg_temp._takeoff_send_before as before_line where before_line.id = entry.estimate_item_id
            and before_line.updated_at = entry.expected_updated_at and before_line.quantity = entry.expected_quantity
            and earlier.quantity = before_line.quantity))
        and pg_catalog.cardinality(sources.ids) > 0 and measured.readable = pg_catalog.cardinality(sources.ids)
        and measured.raw = earlier.quantity
        and not (earlier.source_metadata ? 'takeoff_length_rounding') and not (earlier.source_metadata ? 'takeoff_provision')
        and not (added.source_metadata ? 'takeoff_length_rounding') and not (added.source_metadata ? 'takeoff_provision')
        and public.takeoff_item_hypothesis_cause(source.metadata, source.quantity_entry_category) is null
        and added.parent_id = earlier.parent_id
        and lower(regexp_replace(btrim(added.title), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(earlier.title), '\s+', ' ', 'g'))
        -- The same unit as the outcome shows (on engine 2 the description, where the unit is kept); lines without one by
        -- their pricing status.
        and (private.takeoff_send_line_unit(target_engine, added.unit_code, added.description),
            case when private.takeoff_send_line_unit(target_engine, added.unit_code, added.description) is null
              then added.pricing_status end)
          is not distinct from (private.takeoff_send_line_unit(target_engine, earlier.unit_code, earlier.description),
            case when private.takeoff_send_line_unit(target_engine, earlier.unit_code, earlier.description) is null
              then earlier.pricing_status end)
    ) then
      raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'accumulation_changed', 'estimate_item_id', entry.estimate_item_id)::text;
    end if;

    previous_writer := coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true), '');
    if target_engine = 3 then
      perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', target_version::text, true);
    end if;
    -- Only the quantity and the provenance move: price, unit, hours, supplier and status stay the line's. Its parts are
    -- those of its active sources (never a part a page replacement took out), then this send's.
    update public.estimate_items as earlier set
      quantity = earlier.quantity + added.quantity,
      source_job_id = target_job_id,
      source_metadata = coalesce(earlier.source_metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object('takeoff_contributions',
        pg_catalog.jsonb_build_object('version', 1, 'job_id', target_job_id,
          'item_ids', (select pg_catalog.jsonb_agg(source_id order by ordinal) from pg_catalog.unnest(
              private.takeoff_estimate_line_item_ids(earlier.source_metadata, earlier.source_job_id) || entry.takeoff_item_id)
              with ordinality as listed(source_id, ordinal)),
          'parts', private.takeoff_line_parts(private.takeoff_estimate_line_item_ids(earlier.source_metadata, earlier.source_job_id),
              earlier.source_metadata #> '{takeoff_contributions,parts}', p_tenant)
            || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('job_id', target_job_id, 'request_id', p_request,
              'takeoff_item_ids', pg_catalog.jsonb_build_array(entry.takeoff_item_id),
              'quantity', pg_catalog.trim_scale(added.quantity))))),
      updated_at = pg_catalog.statement_timestamp()
    from public.estimate_items as added
    where earlier.id = entry.estimate_item_id and added.id = entry.created_id;
    delete from public.estimate_items as added where added.id = entry.created_id and added.version_id = target_version;
    if target_engine = 3 then
      perform public.estimate_v3_complete_entry_for_writer(target_version, array[entry.estimate_item_id]);
    end if;
    perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', previous_writer, true);
    removed := removed || entry.created_id;
    accumulated := accumulated || entry.estimate_item_id;
    links := (select pg_catalog.jsonb_agg(case when (output.value ->> 'takeoff_item_id')::uuid = entry.takeoff_item_id
        then pg_catalog.jsonb_build_object('takeoff_item_id', entry.takeoff_item_id, 'estimate_item_id', entry.estimate_item_id)
        else output.value end order by output.ordinality)
      from pg_catalog.jsonb_array_elements(links) with ordinality as output(value, ordinality));
  end loop;
  if target_engine is distinct from 3 and pg_catalog.cardinality(accumulated) > 0 then
    perform public.recalculate_takeoff_estimate_version(target_version, p_tenant);
  end if;

  if created_lock is not null then
    delete from public.draft_locks as lock_row where lock_row.id = created_lock;
  end if;

  -- What the send leaves, against what the destination held: the lines created, changed and removed, each in its
  -- section, and where each takeoff line went. The dry run of the preview computes it the same way, from the same state.
  drop table if exists pg_temp._takeoff_send_after;
  create temporary table _takeoff_send_after on commit drop as
  select item.id, item.parent_id, item.title,
    private.takeoff_send_line_unit(target_engine, item.unit_code, item.description) as unit,
    case when private.takeoff_send_line_unit(target_engine, item.unit_code, item.description) is null
      then item.pricing_status::text end as unitless_status,
    item.quantity, item.unit_price_ht_cents, item.source_job_id,
    (select pg_catalog.jsonb_agg(output.value ->> 'takeoff_item_id' order by output.value ->> 'takeoff_item_id')
      from pg_catalog.jsonb_array_elements(links) as output(value)
      where (output.value ->> 'estimate_item_id')::uuid = item.id) as takeoff_item_ids,
    -- The line's own source: for a line that groups equal lengths, the measure that represents it.
    pg_catalog.jsonb_build_object('file', item.source_file_name, 'page', item.source_page,
      'takeoff_item_id', item.source_metadata ->> 'takeoff_item_id') as source
  from public.estimate_items as item
  where item.version_id = target_version and item.tenant_id = p_tenant and item.item_type = 'line'::public.estimate_item_type;
  with changes as (
    select 'created' as change, null::text as ref, refs.ref as section, after_line.title, after_line.unit,
      after_line.unitless_status, after_line.quantity,
      null::numeric as quantity_before, after_line.unit_price_ht_cents, coalesce(after_line.takeoff_item_ids, '[]'::jsonb) as takeoff_item_ids,
      after_line.source
    from pg_temp._takeoff_send_after as after_line
    left join pg_temp._takeoff_send_refs as refs on refs.id = after_line.parent_id
    where not exists (select 1 from pg_temp._takeoff_send_before as before_line where before_line.id = after_line.id)
    union all
    select 'changed', line_ref.ref, refs.ref, after_line.title, after_line.unit, after_line.unitless_status, after_line.quantity,
      before_line.quantity,
      after_line.unit_price_ht_cents, coalesce(after_line.takeoff_item_ids, '[]'::jsonb), after_line.source
    from pg_temp._takeoff_send_after as after_line
    join pg_temp._takeoff_send_before as before_line on before_line.id = after_line.id
    left join pg_temp._takeoff_send_refs as line_ref on line_ref.id = after_line.id
    left join pg_temp._takeoff_send_refs as refs on refs.id = after_line.parent_id
    where (after_line.parent_id, after_line.title, after_line.unit, after_line.unitless_status, after_line.quantity,
        after_line.unit_price_ht_cents, after_line.source_job_id)
      is distinct from (before_line.parent_id, before_line.title, before_line.unit, before_line.unitless_status,
        before_line.quantity, before_line.unit_price_ht_cents, before_line.source_job_id)
    union all
    select 'removed', line_ref.ref, refs.ref, before_line.title, before_line.unit, before_line.unitless_status,
      before_line.quantity, before_line.quantity,
      before_line.unit_price_ht_cents, '[]'::jsonb, before_line.source
    from pg_temp._takeoff_send_before as before_line
    left join pg_temp._takeoff_send_refs as line_ref on line_ref.id = before_line.id
    left join pg_temp._takeoff_send_refs as refs on refs.id = before_line.parent_id
    where not exists (select 1 from pg_temp._takeoff_send_after as after_line where after_line.id = before_line.id)
  )
  select pg_catalog.jsonb_build_object('format_version', 1, 'engine', target_engine,
    -- A version this send creates, with the settings it is stored with — the ones the payload names and the ones the
    -- creation takes from the tenant's policy (the sale coefficients of engine 3): a policy changed since the preview
    -- changes the outcome. Not its identifier nor its date (the day it is created).
    'version', case when version_created then (select pg_catalog.jsonb_build_object('title', created_version.title,
        'validite_jours', created_version.validite_jours, 'margin_multiplier', created_version.margin_multiplier,
        'margin_mode', created_version.margin_mode, 'currency', created_version.currency, 'margin_bp', created_version.margin_bp,
        'discount_bp', created_version.discount_bp, 'discount_amount_cents', created_version.discount_amount_cents,
        'discount_mode', created_version.discount_mode, 'discount_steps', created_version.discount_steps,
        'global_coefficient', created_version.global_coefficient, 'tax_rate_bp', created_version.tax_rate_bp,
        'rounding_mode', created_version.rounding_mode, 'rounding_step_cents', created_version.rounding_step_cents,
        'max_section_depth', created_version.max_section_depth, 'calc_engine_version', created_version.calc_engine_version,
        'contractor_role', created_version.contractor_role, 'sale_coefficient_fo', created_version.sale_coefficient_fo,
        'sale_coefficient_mo', created_version.sale_coefficient_mo)
      from public.estimate_versions as created_version where created_version.id = target_version) end,
    'sections_created', case when section_created
      then pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('title', btrim(p_command #>> '{section,title}')))
      else '[]'::jsonb end,
    'lines', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('change', change.change, 'ref', change.ref,
        'section', change.section, 'title', change.title, 'unit', change.unit, 'unitless_status', change.unitless_status,
        'quantity', pg_catalog.trim_scale(change.quantity),
        'quantity_before', pg_catalog.trim_scale(change.quantity_before), 'unit_price_ht_cents', change.unit_price_ht_cents,
        'takeoff_item_ids', change.takeoff_item_ids, 'source', change.source)
      order by change.change, change.section collate "C", change.title collate "C", change.unit collate "C",
        change.unitless_status collate "C", change.quantity,
        change.ref collate "C", change.takeoff_item_ids::text collate "C") from changes as change), '[]'::jsonb),
    'parts', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('takeoff_item_id', output.value ->> 'takeoff_item_id',
        'target', case when exists (select 1 from pg_temp._takeoff_send_before as before_line
          where before_line.id = (output.value ->> 'estimate_item_id')::uuid) then 'existing_line' else 'new_line' end,
        'line', (select refs.ref from pg_temp._takeoff_send_refs as refs where refs.id = (output.value ->> 'estimate_item_id')::uuid),
        'section', (select refs.ref from pg_temp._takeoff_send_after as after_line
          join pg_temp._takeoff_send_refs as refs on refs.id = after_line.parent_id
          where after_line.id = (output.value ->> 'estimate_item_id')::uuid))
      order by output.value ->> 'takeoff_item_id') from pg_catalog.jsonb_array_elements(links) as output(value)), '[]'::jsonb))
  into outcome;

  -- What the member confirmed is what is written: any other line, quantity, unit, section or target refuses everything.
  if not p_dry_run and outcome is distinct from p_command -> 'expected_outcome' then
    raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', 'outcome_changed')::text;
  end if;
  if p_dry_run then
    return pg_catalog.jsonb_build_object('outcome', outcome);
  end if;

  -- The parts as stored: each one names its takeoff line, its real target (the line it entered, new or earlier, and the
  -- section that line is in), the page, the plan's attested content, the source of its quantity and the revision of its
  -- evidence, read here from the rows the application wrote from.
  plan := pg_catalog.jsonb_build_object('format_version', 1,
    'destination', pg_catalog.jsonb_build_object('kind', kind, 'version_id', target_version, 'source_version_id', source_version,
      'version_created', version_created),
    'price_rules_ignored', coalesce(p_command -> 'price_rules_ignored', '[]'::jsonb),
    'sections', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', section_id, 'created', section_created,
      'title', (select item.title from public.estimate_items as item where item.id = section_id))),
    'parts', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'takeoff_item_id', source.id, 'designation', source.designation,
          'estimate_item_id', target_line.id, 'section_id', target_line.parent_id,
          'target', case when before_line.id is not null
            then pg_catalog.jsonb_build_object('kind', 'existing_line', 'estimate_item_id', before_line.id,
              'quantity_before', pg_catalog.trim_scale(before_line.quantity))
            else pg_catalog.jsonb_build_object('kind', 'new_line') end,
          'quantity', pg_catalog.trim_scale(source.quantity), 'unit', source.unit,
          'source', pg_catalog.jsonb_build_object('job_id', target_job_id, 'answer_id', null, 'observation_id', source.id,
            'plan_file_id', source.metadata #>> '{source_document,plan_file_id}', 'source_file_name', source.source_file_name,
            'source_page', source.source_page,
            'quantity_source', case
              when public.takeoff_item_hypothesis_cause(source.metadata, source.quantity_entry_category) is not null
                then 'hypothesis:' || public.takeoff_item_hypothesis_cause(source.metadata, source.quantity_entry_category)
              when source.quantity_entry_category is not null then 'entered' else 'measured' end,
            -- The plan's bytes as the takeoff attested them (its preparation), never the plan centre's current file.
            'plan_content_hash', (select attested.value ->> 'content_hash'
              from pg_catalog.jsonb_array_elements(job.preparation_snapshot #> '{preparation,sources}') as attested(value)
              where attested.value ->> 'document_id' = source.metadata #>> '{source_document,plan_file_id}' limit 1),
            'evidence_revision', pg_catalog.md5(pg_catalog.jsonb_build_array(source.updated_at, source.evidence,
              source.source_file_name, source.source_page, source.metadata,
              (select pg_catalog.jsonb_agg(geometry.geometry - 'transform' order by geometry.vector_page_id)
                from public.takeoff_item_geometries as geometry where geometry.takeoff_item_id = source.id))::text)))
        order by source.id)
      from pg_catalog.jsonb_array_elements(links) as output(value)
      join public.takeoff_items as source on source.id = (output.value ->> 'takeoff_item_id')::uuid
        and source.job_id = target_job_id and source.tenant_id = p_tenant
      join pg_temp._takeoff_send_after as target_line on target_line.id = (output.value ->> 'estimate_item_id')::uuid
      left join pg_temp._takeoff_send_before as before_line on before_line.id = target_line.id), '[]'::jsonb));

  result := pg_catalog.jsonb_build_object(
    'format_version', 1,
    'version_id', target_version,
    'version_created', version_created,
    'source_version_id', source_version,
    'outcome', outcome,
    'sections_created', case when section_created then pg_catalog.jsonb_build_array(section_id) else '[]'::jsonb end,
    'sections_changed', coalesce((select pg_catalog.jsonb_agg(distinct touched.section_id) from (
        select after_line.parent_id as section_id from pg_temp._takeoff_send_after as after_line
        left join pg_temp._takeoff_send_before as before_line on before_line.id = after_line.id
        where after_line.parent_id is not null and (before_line.id is null
          or (after_line.parent_id, after_line.title, after_line.unit, after_line.unitless_status, after_line.quantity,
            after_line.unit_price_ht_cents, after_line.source_job_id) is distinct from (before_line.parent_id, before_line.title,
            before_line.unit, before_line.unitless_status, before_line.quantity, before_line.unit_price_ht_cents,
            before_line.source_job_id))
        union
        select before_line.parent_id from pg_temp._takeoff_send_before as before_line
        left join pg_temp._takeoff_send_after as after_line on after_line.id = before_line.id
        where before_line.parent_id is not null and (after_line.id is null or after_line.parent_id is distinct from before_line.parent_id)
      ) as touched), '[]'::jsonb),
    'lines_created', coalesce((select pg_catalog.jsonb_agg(after_line.id order by after_line.id) from pg_temp._takeoff_send_after as after_line
      where not exists (select 1 from pg_temp._takeoff_send_before as before_line where before_line.id = after_line.id)), '[]'::jsonb),
    'lines_changed', coalesce((select pg_catalog.jsonb_agg(after_line.id order by after_line.id)
      from pg_temp._takeoff_send_after as after_line join pg_temp._takeoff_send_before as before_line on before_line.id = after_line.id
      where (after_line.parent_id, after_line.title, after_line.unit, after_line.unitless_status, after_line.quantity,
          after_line.unit_price_ht_cents, after_line.source_job_id) is distinct from (before_line.parent_id, before_line.title,
          before_line.unit, before_line.unitless_status, before_line.quantity, before_line.unit_price_ht_cents,
          before_line.source_job_id)), '[]'::jsonb),
    'lines_removed', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', before_line.id,
        'section_id', before_line.parent_id, 'title', before_line.title, 'quantity', pg_catalog.trim_scale(before_line.quantity),
        'unit', before_line.unit) order by before_line.id)
      from pg_temp._takeoff_send_before as before_line
      where not exists (select 1 from pg_temp._takeoff_send_after as after_line where after_line.id = before_line.id)), '[]'::jsonb),
    'item_links', links,
    'ignored_count', applied.ignored_count,
    'scope', applied.scope);
  result := result || pg_catalog.jsonb_build_object(
    'created_count', pg_catalog.jsonb_array_length(result -> 'lines_created'),
    'updated_count', pg_catalog.jsonb_array_length(result -> 'lines_changed'),
    'removed_count', pg_catalog.jsonb_array_length(result -> 'lines_removed'),
    'sent_count', pg_catalog.jsonb_array_length(links),
    'accumulated_count', pg_catalog.cardinality(accumulated));

  -- A command of format 2: the application's audit rows, written here once, in the transaction of the send (a replay
  -- returns the receipt and writes nothing), as the server wrote them after the commit — the application completed, and
  -- each line a mapping rule changed with the line it entered. A command of format 1 comes from the previous application,
  -- whose server still writes them itself.
  if p_command -> 'format_version' = '2'::jsonb then
    insert into public.audit_logs (tenant_id, user_id, table_name, record_id, estimate_version_id, action, after_data)
    values (p_tenant, p_actor, 'takeoff_jobs', target_job_id, target_version, 'takeoff.apply.completed',
      pg_catalog.jsonb_build_object('schema_version', 1, 'action', 'takeoff.apply.completed', 'job_id', target_job_id,
        'tenant_id', p_tenant, 'user_id', p_actor, 'metadata', pg_catalog.jsonb_build_object('estimate_version_id', target_version,
          'applied_items_count', (result ->> 'created_count')::integer + (result ->> 'updated_count')::integer,
          'excluded_items_count', coalesce((result ->> 'ignored_count')::integer, 0))));
    insert into public.audit_logs (tenant_id, user_id, table_name, record_id, estimate_version_id, action, after_data)
    select p_tenant, p_actor, 'takeoff_items', target_job_id, target_version, 'takeoff.mapping.applied',
      pg_catalog.jsonb_build_object('schema_version', 1, 'action', 'takeoff.mapping.applied', 'job_id', target_job_id,
        'tenant_id', p_tenant, 'user_id', p_actor, 'metadata', pg_catalog.jsonb_build_object('job_id', target_job_id,
          'item_id', mapped_line.value -> 'item_id', 'rule_id', mapped_line.value -> 'rule_id',
          'action', mapped_line.value -> 'action', 'estimate_item_id', written.estimate_item_id))
    from pg_catalog.jsonb_array_elements(mapped) with ordinality as mapped_line(value, ordinality)
    -- The line each one entered (none for a line a rule set aside), read once from the final links.
    left join (select distinct on (output.value ->> 'takeoff_item_id') output.value ->> 'takeoff_item_id' as takeoff_item_id,
        output.value -> 'estimate_item_id' as estimate_item_id
      from pg_catalog.jsonb_array_elements(links) as output(value)
      order by output.value ->> 'takeoff_item_id') as written on written.takeoff_item_id = mapped_line.value ->> 'item_id'
    order by mapped_line.ordinality;
  end if;
  return pg_catalog.jsonb_build_object('version_id', target_version, 'project_id', job.project_id, 'plan', plan, 'result', result);
end;
$$;
revoke all on function private.takeoff_send_execute(uuid, uuid, public.tenant_role, uuid, jsonb, boolean)
  from public, anon, authenticated, service_role;

commit;
