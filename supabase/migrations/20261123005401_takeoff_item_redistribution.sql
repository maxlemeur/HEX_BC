-- Redistribute the existing contributions of one item in an engine-3 draft.
-- No data rewrite. The receipt and the new targets are created only by explicit confirmation.
begin;
set local lock_timeout = '5s';
lock table public.takeoff_item_send_receipts, public.takeoff_item_send_targets in access exclusive mode nowait;
alter table public.takeoff_item_send_receipts
  drop constraint takeoff_item_send_receipts_command_kind_check,
  drop constraint takeoff_item_send_receipts_send_identity_check,
  add constraint takeoff_item_send_receipts_command_kind_check check (command_kind in ('send','copy','redistribute')),
  add constraint takeoff_item_send_receipts_send_identity_check check (
    (command_kind='send' and job_id is not null and request_id is not null) or
    (command_kind='copy' and job_id is null and request_id is null) or
    (command_kind='redistribute' and job_id is null and request_id is not null));

-- Release the writer's lookup key while keeping the target ID, its former compartment,
-- and every historical part referencing it. Existing targets acquire only a null column.
alter table public.takeoff_item_send_targets add column vacated_compartment_key text;
comment on column public.takeoff_item_send_targets.vacated_compartment_key is
  'Original compartment of a target emptied by redistribution. Its lookup key is then vacated:<target UUID>.';

create or replace function private.guard_takeoff_item_send_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_catalog.pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'TAKEOFF_ITEM_SEND_IMMUTABLE' using errcode = '42501';
  end if;
  if tg_op='INSERT' and tg_table_name='takeoff_item_send_targets'
    and pg_catalog.to_jsonb(new)->>'vacated_compartment_key' is not null then
    raise exception 'TAKEOFF_ITEM_SEND_IMMUTABLE' using errcode = '42501';
  end if;
  -- A line deleted: its foreign key empties the link, from inside the deletion; nothing else of the row moves.
  if tg_op = 'UPDATE' and pg_catalog.pg_trigger_depth() > 1
    and tg_table_name in ('takeoff_item_send_targets', 'takeoff_item_send_sections') then
    if pg_catalog.to_jsonb(old) ->> 'estimate_item_id' is not null and pg_catalog.to_jsonb(new) ->> 'estimate_item_id' is null
      and (pg_catalog.to_jsonb(new) - 'estimate_item_id') = (pg_catalog.to_jsonb(old) - 'estimate_item_id') then
      return new;
    end if;
  end if;
  -- A move keeps every column of the live contribution except its destination. The
  -- command's marker names its receipt. Ordinary members have SELECT only and the
  -- service role cannot write directly even when it sets a transaction setting.
  if nullif(pg_catalog.current_setting('mergeone.takeoff_item_redistribution', true), '') is not null
    and coalesce(pg_catalog.current_setting('mergeone.takeoff_item_send', true), '') = '' then
    if current_user = 'service_role' then
      raise exception 'TAKEOFF_ITEM_SEND_WRITER_REQUIRED' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and tg_table_name = 'takeoff_item_send_parts' then
      if old.state = 'live' and new.target_id <> old.target_id
        and pg_catalog.to_jsonb(new) - 'target_id' = pg_catalog.to_jsonb(old) - 'target_id'
        and exists (select 1 from public.takeoff_item_send_targets t
          where (t.id,t.tenant_id,t.project_id,t.version_id,t.item_id) =
            (new.target_id,old.tenant_id,old.project_id,old.version_id,old.item_id) and t.estimate_item_id is not null)
        and exists (select 1 from public.takeoff_item_send_receipts r
          where r.id=private.takeoff_uuid_or_null(to_jsonb(current_setting('mergeone.takeoff_item_redistribution'))) and r.command_kind='redistribute'
            and (r.tenant_id,r.project_id,r.version_id)=(old.tenant_id,old.project_id,old.version_id)
            and r.result->'moves' @> jsonb_build_array(jsonb_build_object('part_id',old.id,'from_target',old.target_id,'to_target',new.target_id)))
      then return new;
      end if;
    elsif tg_op='UPDATE' and tg_table_name='takeoff_item_send_targets' then
      -- A prior member-deleted target for this same compartment can still own
      -- replaced parts after a recreation. Keep it too, under its own archive key.
      if old.estimate_item_id is null and old.vacated_compartment_key is null
        and new.vacated_compartment_key=old.compartment_key and new.compartment_key='vacated:'||old.id
        and to_jsonb(new)-array['compartment_key','vacated_compartment_key']
          = to_jsonb(old)-array['compartment_key','vacated_compartment_key']
        and not exists(select from public.takeoff_item_send_parts p where p.target_id=old.id and p.state='live')
        and exists(select from public.takeoff_item_send_receipts r
          where r.id=private.takeoff_uuid_or_null(to_jsonb(current_setting('mergeone.takeoff_item_redistribution')))
            and r.command_kind='redistribute' and (r.tenant_id,r.project_id,r.version_id)=(old.tenant_id,old.project_id,old.version_id)
            and r.write_plan->>'item_id'=old.item_id::text and r.result->'vacated_target_ids' @> jsonb_build_array(old.id)) then
        return new;
      end if;
    elsif tg_op = 'INSERT' then
      if (tg_table_name = 'takeoff_item_send_receipts' and pg_catalog.to_jsonb(new)->>'command_kind' = 'redistribute'
          and pg_catalog.to_jsonb(new)->>'id' = pg_catalog.current_setting('mergeone.takeoff_item_redistribution'))
        or (tg_table_name = 'takeoff_item_send_targets' and pg_catalog.to_jsonb(new)->>'created_by_receipt_id' =
          pg_catalog.current_setting('mergeone.takeoff_item_redistribution'))
        or (tg_table_name = 'takeoff_item_send_sections' and pg_catalog.to_jsonb(new)->>'receipt_id' =
          pg_catalog.current_setting('mergeone.takeoff_item_redistribution')) then
        return new;
      end if;
    end if;
    raise exception 'TAKEOFF_ITEM_SEND_IMMUTABLE' using errcode = '42501';
  end if;
  if coalesce(pg_catalog.current_setting('mergeone.takeoff_item_send', true), '') = '' or current_user = 'service_role' then
    raise exception 'TAKEOFF_ITEM_SEND_WRITER_REQUIRED' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if tg_table_name = 'takeoff_item_send_parts' then
      if pg_catalog.to_jsonb(old) ->> 'state' = 'live' and pg_catalog.to_jsonb(new) ->> 'state' = 'replaced'
        and pg_catalog.to_jsonb(new) ->> 'replaced_by_receipt_id' is not null
        and (pg_catalog.to_jsonb(new) - array['state', 'replaced_by_receipt_id', 'replaced_at'])
          = (pg_catalog.to_jsonb(old) - array['state', 'replaced_by_receipt_id', 'replaced_at']) then
        return new;
      end if;
    end if;
    raise exception 'TAKEOFF_ITEM_SEND_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_takeoff_item_send_write() from public, anon, authenticated, service_role;

-- Both entry points are server-only. The route supplies the session's actor and module default.
create function private.takeoff_redistribution_check_scope(p_tenant uuid,p_actor uuid,p_project uuid,p_version uuid,p_module boolean)
returns void language plpgsql stable set search_path='' as $$
begin
  if (select m.tenant_id from public.tenant_memberships m join public.tenants t on t.id=m.tenant_id and t.is_active
      where m.user_id=p_actor order by m.is_default desc,m.created_at limit 1) is distinct from p_tenant
    or not exists (select 1 from public.estimate_versions v join public.estimate_projects p on p.id=v.project_id
      join public.tenant_memberships m on m.tenant_id=p.tenant_id and m.user_id=p_actor
      where v.id=p_version and p.id=p_project and v.tenant_id=p_tenant and p.tenant_id=p_tenant and not p.is_archived
        and (m.role='admin' or (m.role='engineer' and p.user_id=p_actor)))
    or not coalesce(private.takeoff_module_enabled(p_tenant,coalesce(p_module,false)),false) then
    raise exception 'REDISTRIBUTION_FORBIDDEN' using errcode='42501';
  end if;
end;
$$;

-- Each (relation, column) below is a live business dependency. This covers the
-- complete current FK inventory, the polymorphic review/register scopes and
-- CCTP links. Material requests link through their purchase-order source line.
-- A section or a line in another version can still name a parent in this one.
-- estimate_line_evidences.source_record_id is the evidence graph's polymorphic origin.
-- estimate_explanation_sources.source_record_id can name the line explained by another proof.
-- takeoff_price_suggestion_sources.source_record_id can name a different version's historical price.
-- estimate_source_coverage_requirements.scope.dpgfLotId is the DPGF lot inside a JSON scope.
-- Completed receipts, snapshots of previous actions and audit events retain past
-- identities intentionally. The item's own target is the association we move.
-- Resolve all candidates at once; never rescan the FK catalog per estimate line.
create function private.takeoff_redistribution_used_lines(p_lines uuid[])
returns uuid[] language plpgsql stable set search_path='' as $$
declare statement text; used uuid[];
begin
  if coalesce(cardinality(p_lines),0)=0 then return '{}'::uuid[]; end if;
  with known(relation,column_name) as (values
      ('public.estimate_items'::regclass,'parent_id'),
      ('public.estimate_explanations'::regclass,'line_id'),
      ('public.estimate_item_outlier_dismissals'::regclass,'item_id'),
      ('public.estimate_line_evidences'::regclass,'estimate_item_id'),
      ('public.estimate_generated_ouvrage_applications'::regclass,'estimate_item_id'),
      ('public.estimate_generated_ouvrage_candidates'::regclass,'suggested_lot_id'),
      ('public.estimate_generated_ouvrage_drafts'::regclass,'preferred_lot_id'),
      ('public.estimate_generated_ouvrage_work_snapshots'::regclass,'estimate_item_id'),
      ('public.estimate_risk_alerts'::regclass,'line_id'),
      ('public.estimate_risk_alerts'::regclass,'lot_id'),
      ('public.estimate_risk_alerts'::regclass,'scope_id'),
      ('public.estimate_structure_draft_applications'::regclass,'estimate_item_id'),
      ('public.estimate_structure_draft_nodes'::regclass,'duplicate_match_item_id'),
      ('public.estimate_version_zero_applications'::regclass,'estimate_item_id'),
      ('public.estimate_version_zero_applications'::regclass,'parent_section_item_id'),
      ('public.estimate_version_zero_lines'::regclass,'materialized_estimate_item_id'),
      ('public.purchase_order_items'::regclass,'source_estimate_item_id'),
      ('private.estimate_purchase_transfers'::regclass,'source_item_id'),
      ('public.takeoff_dpgf_links'::regclass,'estimate_item_id'),
      ('public.takeoff_dpgf_review_decisions'::regclass,'estimate_item_id'),
      ('public.takeoff_price_suggestions'::regclass,'estimate_item_id'),
      ('public.takeoff_price_suggestion_sources'::regclass,'estimate_item_id'),
      ('public.takeoff_item_send_sections'::regclass,'estimate_item_id'),
      ('private.estimate_source_coverage_links'::regclass,'item_id'),
      ('public.affaire_register_entries'::regclass,'scope_id'),
      ('public.estimate_review_comments'::regclass,'scope_id'),
      ('public.estimate_review_correction_items'::regclass,'scope_id')),
  foreign_keys as (
    select k.conrelid::regclass relation,a.attname::text column_name
    from pg_catalog.pg_constraint k
    cross join lateral generate_subscripts(k.conkey,1) as cols(idx)
    join pg_catalog.pg_attribute a on a.attrelid=k.conrelid and a.attnum=k.conkey[cols.idx]
    join pg_catalog.pg_attribute target on target.attrelid=k.confrelid and target.attnum=k.confkey[cols.idx]
    where k.contype='f' and k.confrelid='public.estimate_items'::regclass and target.attname='id'
      and k.conrelid<>'public.takeoff_item_send_targets'::regclass),
  refs as (select * from known union select * from foreign_keys)
  select string_agg(format('select %1$I as id from %2$s where %1$I=any($1)',column_name,relation),' union all ')
    into statement from refs;
  execute 'select coalesce(array_agg(distinct id),array[]::uuid[]) from ('||statement||$refs$
    union all select source_record_id from public.estimate_line_evidences
      where source_record_table='estimate_items' and source_record_id=any($1)
    union all select source_record_id from public.estimate_explanation_sources
      where source_record_table='estimate_items' and source_record_id=any($1)
    union all select candidate.id from unnest($1) as candidate(id) join public.takeoff_price_suggestion_sources p
      on p.source_record_table='estimate_items' and p.source_record_id=candidate.id::text
    union all select candidate.id from unnest($1) as candidate(id)
      where exists (select 1 from private.estimate_source_coverage_requirements q
        where q.scope @> jsonb_build_object('dpgfLotId',candidate.id))
  ) as hits$refs$ into used using p_lines;
  return used;
end;
$$;

-- The server reads these exact files with the send's location reader. Each part
-- names its original document and the current annotation generation. SQL never
-- reads a PDF or guesses a compartment from its name or location choices.
create function public.read_takeoff_item_redistribution_documents(p_tenant uuid,p_actor uuid,p_project uuid,
  p_version uuid,p_item uuid,p_module boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare documents jsonb; has_buildings boolean;
begin
  perform private.takeoff_redistribution_check_scope(p_tenant,p_actor,p_project,p_version,p_module);
  select exists(select 1 from public.takeoff_plan_locations where project_id=p_project and tenant_id=p_tenant
    and building_choice='value') into has_buildings;
  with parts as materialized (
    select p.id,p.job_id,(g.document->>'plan_file_id')::uuid file_id,g.document->>'content_hash' hash,g.document->>'file_name' name
    from public.takeoff_item_send_parts p
    left join lateral (select page.document from public.takeoff_item_send_pages page where page.version_id=p_version
      and page.receipt_id=p.receipt_id and p.id=any(page.part_ids) order by page.id limit 1) g on true
    where p.tenant_id=p_tenant and p.version_id=p_version and p.project_id=p_project and p.item_id=p_item and p.state='live'
  ), files as materialized (
    select f.id,src.source_kind,src.source_id,
      case when src.current_copy then jsonb_build_object('source_kind',src.source_kind,'source_id',src.source_id,
        'identity',encode(sha256(convert_to(jsonb_build_array(f.id,f.plan_set_id,f.file_path,f.file_hash,
          f.file_size_bytes,f.page_count,extract(epoch from f.updated_at))::text,'UTF8')),'hex')) end as current_file
    from (select distinct file_id from parts) wanted
    join public.plan_files f on f.id=wanted.file_id and f.tenant_id=p_tenant
    cross join lateral private.resolve_takeoff_plan_location_source(p_tenant,p_project,f.id) src
  )
  select coalesce(jsonb_object_agg(p.id,jsonb_build_object('part_id',p.id,'job_id',p.job_id,'file_id',p.file_id,
    'hash',p.hash,'name',p.name,'revision',a.revision,'current_file',f.current_file)),'{}') into documents
    from parts p left join files f on f.id=p.file_id
    left join public.takeoff_plan_locations a on a.tenant_id=p_tenant and a.project_id=p_project
      and a.source_kind=f.source_kind and a.source_id=f.source_id and a.content_hash=p.hash;
  return jsonb_build_object('has_buildings',has_buildings,'parts',documents);
end;
$$;

-- A touched section or a line carrying an editor's own fields can never be removed.
-- Financial inputs, third-party uses and quantity are checked on the current row as
-- well, including when a copy inherited a value before the copy's own audit began.
-- The audit compares every stored column except updated_at, the four derived prices/totals
-- and the quantity transitions explained by receipts. In particular it protects:
-- title, description, position, parent_id, quantity, unit_code, category_id, aid, line_nature,
-- pricing_status, unit_price_ht_cents, selected_supplier_price_id, fo_price_origin, offer_choice,
-- product_id, supply_type_id, was_not_priced, status_reason, tax_rate_bp, fo_provision, k_fo,
-- k_fo_manual, k_mo, k_mo_atelier, k_mo_chantier, h_mo, h_mo_per_unit, h_mo_atelier,
-- h_mo_atelier_per_unit, h_mo_chantier, h_mo_chantier_per_unit, h_mo_majoration,
-- labor_role_id, labor_role_atelier_id, labor_role_chantier_id and all source fields.
-- External components, evidence and review notes are checked as line uses.
create function private.takeoff_redistribution_edited(p_line public.estimate_items)
returns boolean language sql stable set search_path='' as $$
  -- Match the multiset of committed quantity transitions against receipt lines.
  -- A writer can insert its receipt in a subtransaction. A manual round trip
  -- contributes extra audit transitions that no confirmed writer can account for.
  with edits as (
    select a.before_data,a.after_data from public.audit_logs a where a.tenant_id=p_line.tenant_id
      and a.estimate_version_id=p_line.version_id and a.record_id=p_line.id and a.table_name='estimate_items' and a.action='UPDATE'
  ), changes as (
    select before_data->'quantity' as before_qty,after_data->'quantity' as after_qty,count(*) as n from edits
    where before_data->'quantity' is distinct from after_data->'quantity' group by 1,2
  )
  select exists(select 1 from edits where
    (before_data - array['updated_at','quantity','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents'])
    is distinct from (after_data - array['updated_at','quantity','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents']))
    or exists(select 1 from changes c where c.n>(
      select count(*) from public.takeoff_item_send_receipts r where r.version_id=p_line.version_id and r.tenant_id=p_line.tenant_id
        and (exists(select 1 from jsonb_array_elements(r.result->'lines') e where e->>'estimate_item_id'=p_line.id::text
              and e->'quantity_before'=c.before_qty and e->'quantity_after'=c.after_qty)
          or exists(select 1 from jsonb_array_elements(r.result->'destinations') e where e->>'line_id'=p_line.id::text
              and e->'quantity_before'=c.before_qty and e->'quantity'=c.after_qty))))
$$;

-- A copy starts with new physical lines and a new audit trail. Snapshot the source's
-- protected identities in the new copy receipt, while the source still exists.
-- Only copy inserts execute this trigger; a copy of a copy carries the same flags.
create function private.takeoff_redistribution_copy_protections()
returns trigger language plpgsql set search_path='' as $$
declare
  source public.takeoff_item_send_receipts;
  protected_targets jsonb;
  protected_sections jsonb;
begin
  select * into source from public.takeoff_item_send_receipts r
    where r.id=new.copied_from_receipt_id and r.tenant_id=new.tenant_id and r.project_id=new.project_id;
  -- A historical copy has no contemporaneous record of its protected fields.
  -- Carry that absence forward; a later copy cannot certify the earlier snapshot.
  if not found or (source.command_kind='copy' and
    (jsonb_typeof(source.write_plan->'protected_targets') is distinct from 'array' or
     jsonb_typeof(source.write_plan->'protected_sections') is distinct from 'array')) then return new; end if;
  select coalesce(jsonb_agg(jsonb_build_array(t.item_id,t.breakdown,t.compartment_key) order by t.id),'[]') into protected_targets
  from public.takeoff_item_send_targets t join public.estimate_items i on i.id=t.estimate_item_id
  where t.created_by_receipt_id=source.id and (private.takeoff_redistribution_edited(i) or
    source.write_plan->'protected_targets' @> jsonb_build_array(jsonb_build_array(t.item_id,t.breakdown,t.compartment_key)));
  select coalesce(jsonb_agg(s.section_key order by s.section_key),'[]') into protected_sections
  from public.takeoff_item_send_sections s join public.estimate_items i on i.id=s.estimate_item_id
  where s.receipt_id=source.id and (private.takeoff_redistribution_edited(i) or source.write_plan->'protected_sections' ? s.section_key);
  new.write_plan:=new.write_plan||jsonb_strip_nulls(jsonb_build_object(
    'protected_targets',protected_targets,'protected_sections',protected_sections,
    'original_send_time',case when source.command_kind='send' then to_jsonb(source.created_at) else source.write_plan->'original_send_time' end,
    'original_send_receipt_id',case when source.command_kind='send' then source.id::text
      when source.command_kind='copy' then source.write_plan->>'original_send_receipt_id' end));
  return new;
end;
$$;
revoke all on function private.takeoff_redistribution_copy_protections() from public,anon,authenticated,service_role;
create trigger takeoff_item_redistribution_copy_protections before insert on public.takeoff_item_send_receipts
  for each row when (new.command_kind='copy') execute function private.takeoff_redistribution_copy_protections();

create function public.preview_takeoff_item_redistribution(p_tenant uuid,p_actor uuid,p_project uuid,p_version uuid,p_item uuid,
  p_mode text,p_module boolean,p_locations jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  version_row public.estimate_versions;
  source record;
  section record;
  base_id uuid;
  base_key text;
  expected_base uuid;
  expected_identity jsonb;
  identity jsonb;
  sources jsonb := '[]';
  blockers jsonb := '[]';
  parts jsonb;
  destinations jsonb;
  plan jsonb;
  reason text;
  document_facts jsonb;
  used_lines uuid[];
begin
  perform private.takeoff_redistribution_check_scope(p_tenant,p_actor,p_project,p_version,p_module);
  if p_mode is null or p_mode not in ('together','by_level','by_building') then
    raise exception 'REDISTRIBUTION_INVALID' using errcode='22023';
  end if;
  select * into strict version_row from public.estimate_versions where id=p_version;
  if version_row.status<>'draft' or version_row.seal_hash is not null then
    raise exception 'REDISTRIBUTION_SEALED' using errcode='55000';
  end if;
  if version_row.calc_engine_version is distinct from 3 then raise exception 'REDISTRIBUTION_ENGINE' using errcode='22023'; end if;
  document_facts:=public.read_takeoff_item_redistribution_documents(p_tenant,p_actor,p_project,p_version,p_item,p_module);
  if jsonb_typeof(p_locations->'parts') is distinct from 'object' or (p_locations->'has_buildings') is distinct from (document_facts->'has_buildings')
    or (select coalesce(jsonb_object_agg(entry.key,entry.value->'source'),'{}') from jsonb_each(p_locations->'parts') entry)
      is distinct from (document_facts->'parts')
    or exists(select from jsonb_each(p_locations->'parts') e where e.value->'available'='true'::jsonb
      and e.value#>>'{source,current_file,identity}' is null) then
    raise exception 'REDISTRIBUTION_STALE' using errcode='40001';
  end if;
  -- Same trust as the send: the server's planner owns geography, the writer
  -- accepts a bounded key in the selected breakdown and computes all quantities.
  if exists(select 1 from jsonb_each(p_locations->'parts') e
    where jsonb_typeof(e.value->'available') is distinct from 'boolean' or (e.value->'available'='true'::jsonb and (
      private.takeoff_item_send_text(e.value->'key',400) is not true or private.takeoff_item_send_text(e.value->'label',200) is not true
      or (case p_mode when 'together' then e.value->>'key'='together' when 'by_level' then
        e.value->>'key'='unallocated' or e.value->>'key' like 'level:%' else e.value->>'key'='unallocated' or e.value->>'key' like 'building:%' end) is not true))) then
    raise exception 'REDISTRIBUTION_INVALID' using errcode='22023';
  end if;

  select private.takeoff_redistribution_used_lines(array_agg(t.estimate_item_id)) into used_lines
    from public.takeoff_item_send_targets t where t.tenant_id=p_tenant and t.version_id=p_version and t.item_id=p_item
      and t.estimate_item_id is not null;
  for source in select t as target,i as line,r.write_plan as origin_plan,r.command_kind,
      coalesce(sum(p.quantity),0) raw_quantity,
      coalesce(i.title,(select a.before_data->>'title' from public.audit_logs a
        where a.tenant_id=p_tenant and a.estimate_version_id=p_version and a.table_name='estimate_items' and a.action='DELETE'
          and a.before_data#>>'{source_metadata,takeoff_item_send,item_id}'=p_item::text
          and a.before_data#>>'{source_metadata,takeoff_item_send,compartment_key}'=t.compartment_key
        order by a.created_at desc,a.id desc limit 1),(select e.label from public.takeoff_list_revision_entries e
        where e.project_id=p_project and e.item_id=p_item order by e.revision_id limit 1),'Ligne supprimée') as title
    from public.takeoff_item_send_targets t join public.takeoff_item_send_receipts r on r.id=t.created_by_receipt_id
    left join public.takeoff_item_send_parts p on p.target_id=t.id and p.state='live'
    left join public.estimate_items i on i.id=t.estimate_item_id
    where t.tenant_id=p_tenant and t.project_id=p_project and t.version_id=p_version and t.item_id=p_item
    group by t.id,i.id,r.id having count(p.id)>0 or t.estimate_item_id is not null order by t.id
  loop
    reason := null;
    identity := jsonb_build_array((source.line).title,(source.line).category_id,(source.line).tax_rate_bp,(source.line).k_fo,(source.target).unit_code,(source.target).basis,(source.target).network,(source.target).material,(source.target).diameter);
    if (source.target).breakdown='dpgf' then reason:='dpgf';
    elsif (source.line).id is null then reason:='deleted';
    elsif source.command_kind='copy' and jsonb_typeof(source.origin_plan->'protected_targets') is distinct from 'array'
      then reason:='copy_history';
    elsif (source.line).quantity is distinct from private.takeoff_item_send_rounded(source.raw_quantity,
        private.takeoff_item_send_length_factor((source.target).unit_code)) then reason:='quantity';
    elsif (source.line).unit_price_ht_cents is distinct from 0 or (source.line).tax_rate_bp is distinct from version_row.tax_rate_bp
      or (source.line).k_mo is distinct from 1 or (source.line).h_mo is distinct from 0
      or (source.line).h_mo_majoration is distinct from 1 or (source.line).selected_supplier_price_id is not null
      or (source.line).fo_price_origin is not null or (source.line).h_mo_per_unit is not null
      or (source.line).h_mo_atelier_per_unit is not null or (source.line).h_mo_chantier_per_unit is not null
      or (source.line).fo_provision is distinct from 1 or (source.line).k_fo_manual is distinct from false
      or (source.line).offer_choice is not null or (source.line).product_id is not null or (source.line).labor_role_id is not null
      or (source.line).description is distinct from (source.target).unit_code or (source.line).unit_code is distinct from (source.target).unit_code
      or (source.line).status_reason is not null or (source.line).supply_type_id is not null or (source.line).aid is not null
      or (source.line).h_mo_atelier is not null or (source.line).h_mo_chantier is not null
      or (source.line).k_mo_atelier is distinct from 1 or (source.line).k_mo_chantier is distinct from 1
      or (source.line).labor_role_atelier_id is not null or (source.line).labor_role_chantier_id is not null
      or (source.line).was_not_priced or (source.line).line_nature is distinct from 'supply_only'
      or (source.line).pricing_status<>'priced' or private.takeoff_redistribution_edited(source.line)
      or source.origin_plan->'protected_targets' @> jsonb_build_array(jsonb_build_array(p_item,(source.target).breakdown,(source.target).compartment_key))
      or (source.line).source_provider is distinct from 'takeoff'
      or (source.line).source_file_name is not null or (source.line).source_page is not null
      or (source.line).source_metadata is distinct from jsonb_build_object('takeoff_item_send',jsonb_build_object(
        'version',1,'item_id',p_item,'compartment_key',(source.target).compartment_key,'breakdown',(source.target).breakdown)) then reason:='edited';
    elsif (source.line).id=any(used_lines) then reason:='used';
    elsif expected_identity is not null and expected_identity<>identity then reason:='identity';
    end if;
    expected_identity:=identity;
    select s.section_key,s.estimate_item_id into base_key,base_id from public.takeoff_item_send_sections s
      where s.version_id=p_version and s.estimate_item_id=(source.line).parent_id;
    if (source.target).breakdown not in ('together','dpgf') then
      select s.section_key,s.estimate_item_id into base_key,base_id from public.estimate_items child
        join public.takeoff_item_send_sections s on s.estimate_item_id=child.parent_id and s.version_id=p_version
        where child.id=base_id;
    end if;
    if reason is null and (base_id is null or (expected_base is not null and expected_base<>base_id)) then reason:='section'; end if;
    if reason is not null then blockers:=blockers||jsonb_build_array(jsonb_build_object('reason',reason,'line_id',(source.line).id,'title',source.title)); end if;
    expected_base:=base_id;
    sources:=sources||jsonb_build_array(jsonb_build_object('target_id',(source.target).id,'line_id',(source.line).id,'title',source.title,
      'label',case when (source.target).breakdown='together' then 'Ensemble'
        else (select parent.title from public.estimate_items parent where parent.id=(source.line).parent_id) end,
      'breakdown',(source.target).breakdown,'key',(source.target).compartment_key,'quantity',(source.line).quantity,'raw',source.raw_quantity,
      'unit',(source.target).unit_code,'price_cents',(source.line).unit_price_ht_cents,'tax_rate_bp',(source.line).tax_rate_bp,
      'hours_per_unit',(source.line).h_mo_per_unit,'k_fo',(source.line).k_fo,'k_mo',(source.line).k_mo,'stamp',(source.line).updated_at));
  end loop;
  if sources='[]' then raise exception 'REDISTRIBUTION_EMPTY' using errcode='22023'; end if;
  if (select count(distinct s->>'breakdown') from jsonb_array_elements(sources)s where (s->>'raw')::numeric>0)>1 then
    blockers:=blockers||(select jsonb_agg(jsonb_build_object('reason','mixed','title',s->>'title','line_id',s->'line_id')) from jsonb_array_elements(sources)s);
  end if;

  with located as (
    select p.*,info->>'key' as key,info->>'label' as label,info->'source' as document,
      info->'building_state' as building_state,info->'level_state' as level_state,(info->>'available')::boolean as available
    from public.takeoff_item_send_parts p
    cross join lateral (select p_locations->'parts'->p.id::text as info) as read
    where p.version_id=p_version and p.tenant_id=p_tenant and p.project_id=p_project and p.item_id=p_item and p.state='live'
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'from_target',target_id,'key',key,'label',label,'quantity',quantity,
    'unit',unit_code,'pages',pages,'plan_name',document->>'name','job_id',job_id,'receipt_id',receipt_id,'location_revision',document->'revision',
    'current_file',document->'current_file','available',available,'building_state',building_state,'level_state',level_state) order by id),'[]') into parts from located;
  if parts='[]' then raise exception 'REDISTRIBUTION_EMPTY' using errcode='22023'; end if;
  select blockers||coalesce(jsonb_agg(jsonb_build_object('reason','location_unavailable','title',coalesce(x->>'plan_name','Plan indisponible')) order by x->>'id'),'[]')
    into blockers from jsonb_array_elements(parts)x where x->'available'='false'::jsonb;
  select jsonb_agg(jsonb_build_object('key',g.key,'label',g.label,'raw',g.raw,'quantity',g.quantity,'line_id',t.estimate_item_id,
    'target_id',t.id,'quantity_before',(select i.quantity from public.estimate_items i where i.id=t.estimate_item_id),'section_id',s.estimate_item_id,'section_key',g.section_key) order by g.key) into destinations
  from (select x->>'key' key,min(x->>'label') label,sum((x->>'quantity')::numeric) raw,
      private.takeoff_item_send_rounded(sum((x->>'quantity')::numeric),private.takeoff_item_send_length_factor(min(x->>'unit'))) quantity,
      case when p_mode='together' then base_key else base_key||'/'||(x->>'key') end section_key
    from jsonb_array_elements(parts)x where x->'available'='true'::jsonb group by x->>'key') g
  left join public.takeoff_item_send_targets t on t.item_id=p_item and t.version_id=p_version and t.breakdown=p_mode
    and t.compartment_key=g.key and t.estimate_item_id is not null
  left join public.takeoff_item_send_sections s on s.version_id=p_version and s.section_key=g.section_key and s.estimate_item_id is not null;
  -- Check both paths, including an existing destination section no part has reached yet.
  for section in with recursive paths(id) as (
      select distinct id from (select i.parent_id as id from public.estimate_items i where i.id in
        (select (x->>'line_id')::uuid from jsonb_array_elements(sources)x)
        union select (x->>'section_id')::uuid from jsonb_array_elements(destinations)x) roots where id is not null
      union select i.parent_id from paths join public.estimate_items i on i.id=paths.id where i.parent_id is not null)
    select i.id,i.title,case when r.command_kind='copy' and jsonb_typeof(r.write_plan->'protected_sections') is distinct from 'array'
      then 'copy_history' else 'section' end as reason from paths join public.estimate_items i on i.id=paths.id
      left join public.takeoff_item_send_sections s on s.version_id=p_version and s.estimate_item_id=i.id
      left join public.takeoff_item_send_receipts r on r.id=s.receipt_id
      where (r.command_kind='copy' and jsonb_typeof(r.write_plan->'protected_sections') is distinct from 'array')
        or s.id is null or s.title<>i.title or private.takeoff_redistribution_edited(i) or r.write_plan->'protected_sections' ? s.section_key order by i.id
  loop
    blockers:=blockers||jsonb_build_array(jsonb_build_object('reason',section.reason,'title',section.title,'line_id',section.id));
  end loop;
  if blockers='[]' and not exists(select 1 from jsonb_array_elements(parts)p join jsonb_array_elements(destinations)d
    on d->>'key'=p->>'key' where d->>'target_id' is distinct from p->>'from_target') then
    blockers:=jsonb_build_array(jsonb_build_object('reason','unchanged','title',sources#>>'{0,title}'));
  end if;
  if exists(select 1 from jsonb_array_elements(destinations) d where (d->>'quantity')::numeric>999999999.999) then
    blockers:=blockers||jsonb_build_array(jsonb_build_object('reason','quantity_limit','title',sources#>>'{0,title}'));
  end if;
  if p_mode<>'together' and (with recursive ancestors(id,parent_id) as (
    select i.id,i.parent_id from public.estimate_items i where i.id=base_id union all
    select i.id,i.parent_id from ancestors a join public.estimate_items i on i.id=a.parent_id)
    select count(*)>=version_row.max_section_depth from ancestors) then
    blockers:=blockers||jsonb_build_array(jsonb_build_object('reason','depth','title',sources#>>'{0,title}'));
  end if;
  plan:=jsonb_build_object('version_id',p_version,'currency',version_row.currency,'item_id',p_item,'breakdown',p_mode,'base_section_id',base_id,
    'version_revision',version_row.content_revision,'sources',sources,'parts',parts,'destinations',coalesce(destinations,'[]'),'blockers',blockers,
    'remove_lines',(select coalesce(jsonb_agg(s->'line_id' order by s->>'line_id'),'[]') from jsonb_array_elements(sources)s
      where s->>'line_id' is not null and not exists(select 1 from jsonb_array_elements(destinations)d where d->>'line_id'=s->>'line_id')));
  return plan||jsonb_build_object('digest',encode(sha256(convert_to(plan::text,'UTF8')),'hex'));
end;
$$;

-- The engine owns the allocation across the draft. Reject the whole write if completing
-- the moved lines would change a stored amount on another line.
create function private.takeoff_redistribution_other_amounts(p_version uuid,p_item uuid)
returns jsonb language sql stable set search_path='' as $$
  select coalesce(jsonb_object_agg(i.id,jsonb_build_array(i.pu_ht_cents,i.line_total_ht_cents,i.line_tax_cents,i.line_total_ttc_cents)),'{}')
  from public.estimate_items i where i.version_id=p_version and i.item_type='line'
    and not exists(select 1 from public.takeoff_item_send_targets t where t.estimate_item_id=i.id and t.item_id=p_item)
$$;

create function public.redistribute_takeoff_item(p_tenant uuid,p_actor uuid,p_project uuid,p_version uuid,p_item uuid,
  p_mode text,p_module boolean,p_request uuid,p_digest text,p_locations jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  prior public.takeoff_item_send_receipts;
  plan jsonb;
  receipt uuid:=gen_random_uuid();
  destination jsonb;
  target uuid;
  line_id uuid;
  creating_job uuid;
  parent uuid;
  prototype public.estimate_items;
  origin public.takeoff_item_send_targets;
  next_pos integer;
  moves jsonb:='[]';
  moved_count bigint;
  reached jsonb:='[]';
  result jsonb;
  other_amounts jsonb;
  written uuid[]:='{}';
  old_writer text:=coalesce(current_setting('miaouffrage.estimate_v3_writer',true),'');
  old_send text:=coalesce(current_setting('mergeone.takeoff_item_send',true),'');
  old_redistribution text:=coalesce(current_setting('mergeone.takeoff_item_redistribution',true),'');
begin
  if p_digest is null or p_digest !~ '^[0-9a-f]{64}$' or p_request is null then raise exception 'REDISTRIBUTION_INVALID' using errcode='22023'; end if;
  perform private.takeoff_redistribution_check_scope(p_tenant,p_actor,p_project,p_version,p_module);
  -- Shared rank 1; affaire rank 2; version keys and row rank 3. No analysis or request is written.
  perform pg_advisory_xact_lock_shared(hashtextextended('estimate-calc-policy:'||p_tenant,0));
  perform 1 from public.estimate_projects where id=p_project and tenant_id=p_tenant for no key update;
  perform pg_advisory_xact_lock(hashtextextended('takeoff-rules:'||p_version,0));
  perform pg_advisory_xact_lock(hashtextextended(p_version::text,0));
  -- The estimate-item revision trigger takes UPDATE on this version. Take the
  -- same lock at rank 3, before a line FK can hold KEY SHARE on the version
  -- while waiting for our rank-8 line lock.
  perform 1 from public.estimate_versions where id=p_version and project_id=p_project and tenant_id=p_tenant for update;
  -- Rank 8. A referencing FK must acquire KEY SHARE on the line we might delete. Taking
  -- UPDATE before re-reading its uses prevents even an ON DELETE CASCADE from losing a use.
  perform 1 from public.estimate_items i where i.version_id=p_version and (i.item_type='section' or exists
    (select 1 from public.takeoff_item_send_targets t where t.estimate_item_id=i.id and t.item_id=p_item))
    order by i.id for update;
  perform private.takeoff_redistribution_check_scope(p_tenant,p_actor,p_project,p_version,p_module);
  select * into prior from public.takeoff_item_send_receipts where tenant_id=p_tenant and request_id=p_request;
  if found then
    if prior.command_kind='redistribute' and prior.actor_id=p_actor and prior.project_id=p_project and prior.version_id=p_version
      and prior.write_plan->>'item_id'=p_item::text and prior.write_plan->>'breakdown'=p_mode and prior.plan_sha256=p_digest then
      return prior.result||jsonb_build_object('receipt_id',prior.id,'replayed',true);
    end if;
    raise exception 'REDISTRIBUTION_REQUEST_CONFLICT' using errcode='40001';
  end if;
  plan:=public.preview_takeoff_item_redistribution(p_tenant,p_actor,p_project,p_version,p_item,p_mode,p_module,p_locations);
  if plan->>'digest' is distinct from p_digest then raise exception 'REDISTRIBUTION_STALE' using errcode='40001'; end if;
  if plan->'blockers'<>'[]'::jsonb then raise exception 'REDISTRIBUTION_PROTECTED' using errcode='55000', detail=(plan->'blockers')::text; end if;
  if not exists(select 1 from public.draft_locks l where l.version_id=p_version and l.tenant_id=p_tenant
    and l.user_id=p_actor and l.expires_at>clock_timestamp()) then raise exception 'REDISTRIBUTION_LEASE' using errcode='55P03'; end if;
  other_amounts:=private.takeoff_redistribution_other_amounts(p_version,p_item);
  perform set_config('mergeone.takeoff_item_send','',true);
  perform set_config('mergeone.takeoff_item_redistribution',receipt::text,true);
  perform set_config('miaouffrage.estimate_v3_writer',p_version::text,true);
  select * into strict origin from public.takeoff_item_send_targets where id=(plan#>>'{sources,0,target_id}')::uuid;
  select * into strict prototype from public.estimate_items where id=origin.estimate_item_id;
  for destination in select value from jsonb_array_elements(plan->'destinations') loop
    target:=(destination->>'target_id')::uuid;
    line_id:=(destination->>'line_id')::uuid;
    parent:=(destination->>'section_id')::uuid;
    if parent is null then
      parent:=(plan->>'base_section_id')::uuid;
      select coalesce(max(position),0)+1 into next_pos from public.estimate_items where version_id=p_version and parent_id=parent;
      insert into public.estimate_items(tenant_id,version_id,parent_id,item_type,position,title)
      values(p_tenant,p_version,parent,'section',next_pos,destination->>'label') returning id into parent;
      insert into public.takeoff_item_send_sections(tenant_id,project_id,version_id,section_key,title,estimate_item_id,receipt_id)
      values(p_tenant,p_project,p_version,destination->>'section_key',destination->>'label',parent,receipt);
    end if;
    if target is null then
      -- The send sets only its creating job when inserting a line, and keeps that job
      -- on later contributions. Select the earliest send among the parts reaching this
      -- destination. The page reader resolves their individual documents from the journal.
      select p.job_id into creating_job from jsonb_array_elements(plan->'parts') as x
        join public.takeoff_item_send_parts p on p.id=(x->>'id')::uuid
        join public.takeoff_item_send_receipts r on r.id=p.receipt_id
        where x->>'key'=destination->>'key'
        order by coalesce((r.write_plan->>'original_send_time')::timestamptz,r.created_at),
          coalesce((r.write_plan->>'original_send_receipt_id')::uuid,r.id),p.id limit 1;
      select coalesce(max(position),0)+1 into next_pos from public.estimate_items where version_id=p_version and parent_id=parent;
      insert into public.estimate_items(tenant_id,version_id,parent_id,item_type,position,title,description,quantity,unit_code,
        pricing_status,unit_price_ht_cents,tax_rate_bp,k_fo,fo_provision,k_fo_manual,h_mo,h_mo_majoration,k_mo,pu_ht_cents,line_total_ht_cents,
        line_tax_cents,line_total_ttc_cents,category_id,source_provider,source_job_id,source_metadata)
      values(p_tenant,p_version,parent,'line',next_pos,prototype.title,origin.unit_code,(destination->>'quantity')::numeric,
        origin.unit_code,'priced',0,prototype.tax_rate_bp,prototype.k_fo,prototype.fo_provision,prototype.k_fo_manual,0,1,1,0,0,0,0,prototype.category_id,'takeoff',creating_job,
        jsonb_build_object('takeoff_item_send',jsonb_build_object('version',1,'item_id',p_item,'compartment_key',destination->>'key','breakdown',p_mode)))
      returning id into line_id;
      insert into public.takeoff_item_send_targets(tenant_id,project_id,version_id,item_id,breakdown,compartment_key,estimate_item_id,
        line_kind,unit_code,basis,network,material,diameter,created_by_receipt_id)
      values(p_tenant,p_project,p_version,p_item,p_mode,destination->>'key',line_id,'new_line',origin.unit_code,origin.basis,
        origin.network,origin.material,origin.diameter,receipt) returning id into target;
    else
      update public.estimate_items set quantity=(destination->>'quantity')::numeric where id=line_id and quantity<>(destination->>'quantity')::numeric;
    end if;
    with changing as (select (p->>'id')::uuid id,(p->>'from_target')::uuid old_target
      from jsonb_array_elements(plan->'parts')p where p->>'key'=destination->>'key' and p->>'from_target'<>target::text),
    moved as (select p.id,c.old_target,p.receipt_id,p.quantity from changing c join public.takeoff_item_send_parts p
      on p.id=c.id and p.target_id=c.old_target and p.state='live')
    select moves||coalesce(jsonb_agg(jsonb_build_object('part_id',id,'from_target',old_target,'to_target',target,
      'from_line',s->'line_id','to_line',line_id,'from_line_before',s->'quantity',
      'from_line_after',(select d->'quantity' from jsonb_array_elements(plan->'destinations')d where d->>'target_id'=old_target::text),
      'to_line_before',destination->'quantity_before','to_line_after',destination->'quantity',
      'receipt_id',receipt_id,'quantity',quantity) order by id),'[]') into moves from moved
      join jsonb_array_elements(plan->'sources')s on s->>'target_id'=old_target::text;
    written:=array_append(written,line_id);
    reached:=reached||jsonb_build_array(destination||jsonb_build_object('line_id',line_id,'target_id',target));
  end loop;
  -- Separate READ COMMITTED statement after taking the rank-8 locks, immediately
  -- before removal. It sees business links committed since the locked preview.
  if cardinality(private.takeoff_redistribution_used_lines(array(
    select value::uuid from jsonb_array_elements_text(plan->'remove_lines'))))>0 then
    raise exception 'REDISTRIBUTION_STALE' using errcode='40001';
  end if;
  delete from public.estimate_items i where i.version_id=p_version and i.id in
    (select value::uuid from jsonb_array_elements_text(plan->'remove_lines'));
  perform public.estimate_v3_complete_entry_for_writer(p_version,written);
  if other_amounts is distinct from private.takeoff_redistribution_other_amounts(p_version,p_item) then
    raise exception 'REDISTRIBUTION_OTHER_AMOUNTS' using errcode='55000';
  end if;
  result:=jsonb_build_object('destinations',reached,'moves',moves,'vacated_target_ids',(
    select coalesce(jsonb_agg(t.id order by t.id),'[]') from public.takeoff_item_send_targets t
    join jsonb_array_elements(plan->'sources') s on t.breakdown=s->>'breakdown' and t.compartment_key=s->>'key'
    where t.version_id=p_version and t.item_id=p_item and t.estimate_item_id is null
      and plan->'remove_lines' @> jsonb_build_array(s->'line_id')
      and (t.id=(s->>'target_id')::uuid or not exists(
        select from public.takeoff_item_send_parts p where p.target_id=t.id and p.state='live'))),'source_receipts',
    (with recursive receipts(id) as (
      select (m->>'receipt_id')::uuid from jsonb_array_elements(moves)m
      union select (r.write_plan->>'copied_from_receipt_id')::uuid from receipts c
        join public.takeoff_item_send_receipts r on r.id=c.id and r.tenant_id=p_tenant and r.project_id=p_project
        where r.command_kind='copy' and r.write_plan->>'copied_from_receipt_id' is not null
    ), sources as (select id from receipts union
      select (r.write_plan->>'original_send_receipt_id')::uuid from receipts c
      join public.takeoff_item_send_receipts r on r.id=c.id and r.tenant_id=p_tenant and r.project_id=p_project
      where r.command_kind='copy' and r.write_plan->>'original_send_receipt_id' is not null)
    select coalesce(jsonb_agg(id order by id),'[]') from sources));
  insert into public.takeoff_item_send_receipts(id,tenant_id,project_id,version_id,request_id,command_kind,format_version,
    actor_id,plan_sha256,version_created,write_plan,result)
  values(receipt,p_tenant,p_project,p_version,p_request,'redistribute',1,p_actor,p_digest,false,plan,result);
  -- Receipt and moves commit atomically. The journal guard authorizes only the
  -- exact transitions listed by this receipt; every listed part must be updated.
  update public.takeoff_item_send_parts p set target_id=m.to_target from jsonb_to_recordset(moves)
    as m(part_id uuid,from_target uuid,to_target uuid)
    where p.id=m.part_id and p.target_id=m.from_target and p.state='live';
  get diagnostics moved_count=row_count;
  if moved_count<>jsonb_array_length(moves) then raise exception 'REDISTRIBUTION_STALE' using errcode='40001'; end if;
  -- The ordinary writer treats a matching line-less target as a member deletion.
  -- Release only compartments whose line this receipt removed and whose live parts have moved.
  update public.takeoff_item_send_targets t set vacated_compartment_key=t.compartment_key,compartment_key='vacated:'||t.id
    where t.id in (select value::uuid from jsonb_array_elements_text(result->'vacated_target_ids'));
  perform set_config('miaouffrage.estimate_v3_writer',old_writer,true);
  perform set_config('mergeone.takeoff_item_redistribution',old_redistribution,true);
  perform set_config('mergeone.takeoff_item_send',old_send,true);
  return result||jsonb_build_object('receipt_id',receipt,'replayed',false);
end;
$$;
revoke all on function private.takeoff_redistribution_check_scope(uuid,uuid,uuid,uuid,boolean),
  private.takeoff_redistribution_used_lines(uuid[]),public.read_takeoff_item_redistribution_documents(uuid,uuid,uuid,uuid,uuid,boolean),
  private.takeoff_redistribution_edited(public.estimate_items),private.takeoff_redistribution_other_amounts(uuid,uuid),
  public.preview_takeoff_item_redistribution(uuid,uuid,uuid,uuid,uuid,text,boolean,jsonb),
  public.redistribute_takeoff_item(uuid,uuid,uuid,uuid,uuid,text,boolean,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.read_takeoff_item_redistribution_documents(uuid,uuid,uuid,uuid,uuid,boolean),
  public.preview_takeoff_item_redistribution(uuid,uuid,uuid,uuid,uuid,text,boolean,jsonb),
  public.redistribute_takeoff_item(uuid,uuid,uuid,uuid,uuid,text,boolean,uuid,text,jsonb) to service_role;
commit;
