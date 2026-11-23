-- Redistribute the existing contributions of one item in an engine-3 draft.
-- No data rewrite. The receipt and the new targets are created only by explicit confirmation.
begin;
set local lock_timeout = '5s';
lock table public.takeoff_item_send_receipts in access exclusive mode nowait;
alter table public.takeoff_item_send_receipts
  drop constraint takeoff_item_send_receipts_command_kind_check,
  drop constraint takeoff_item_send_receipts_send_identity_check,
  add constraint takeoff_item_send_receipts_command_kind_check check (command_kind in ('send','copy','redistribute')),
  add constraint takeoff_item_send_receipts_send_identity_check check (
    (command_kind='send' and job_id is not null and request_id is not null) or
    (command_kind='copy' and job_id is null and request_id is null) or
    (command_kind='redistribute' and job_id is null and request_id is not null));

create or replace function private.guard_takeoff_item_send_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_catalog.pg_trigger_depth() > 1 then
      return old;
    end if;
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
      then return new;
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

-- Any referencing row outside the sending target is a third-party use. Include composite FKs,
-- restricting lookups to the column paired with estimate_items.id (unique across tenants).
create function private.takeoff_redistribution_line_used(p_line uuid)
returns boolean language plpgsql stable set search_path='' as $$
declare ref record; used boolean;
begin
  for ref in select distinct n.nspname,c.relname,a.attname
    from pg_catalog.pg_constraint k
    join pg_catalog.pg_class c on c.oid=k.conrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    cross join lateral pg_catalog.generate_subscripts(k.conkey,1) as cols(idx)
    join pg_catalog.pg_attribute a on a.attrelid=k.conrelid and a.attnum=k.conkey[cols.idx]
    join pg_catalog.pg_attribute target on target.attrelid=k.confrelid and target.attnum=k.confkey[cols.idx]
    where k.contype='f' and k.confrelid='public.estimate_items'::regclass and target.attname='id'
      and n.nspname in ('public','private') and k.conrelid <> 'public.takeoff_item_send_targets'::regclass
  loop
    execute pg_catalog.format('select exists(select 1 from %I.%I where %I=$1)',ref.nspname,ref.relname,ref.attname)
      into used using p_line;
    if used then return true; end if;
  end loop;
  return false;
end;
$$;

-- The same geographic identity as the send. Only an annotation on the plan's exact
-- bytes places its contributions. Nothing downloads the file or reads its pages.
create function private.takeoff_redistribution_location(p_mode text,p_building text,p_level text,p_building_unknown boolean)
returns table(key text,label text) language sql immutable set search_path='' as $$
  with folded as (select to_json(lower(regexp_replace(normalize(btrim(p_building),NFC),'[[:space:]]+',' ','g') collate pg_catalog."und-x-icu"))::text as b,
    to_json(lower(regexp_replace(normalize(btrim(p_level),NFC),'[[:space:]]+',' ','g') collate pg_catalog."und-x-icu"))::text as l)
  select case when p_mode='together' then 'together'
    when p_mode='by_building' and b is not null then 'building:['||b||']'
    when p_mode='by_level' and l is not null and (b is not null or p_building_unknown) then 'level:['||coalesce(b,'null')||','||l||']'
    else 'unallocated' end,
    case when p_mode='together' then 'Ensemble'
      when p_mode='by_building' and b is not null then p_building
      when p_mode='by_level' and l is not null and (b is not null or p_building_unknown) then concat_ws(' · ',p_building,p_level)
      else 'Non réparti' end from folded
$$;

-- A touched section or a line carrying an editor's own fields can never be removed.
-- Financial inputs, third-party uses and quantity are checked on the current row as
-- well, including when a copy inherited a value before the copy's own audit began.
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

create function public.preview_takeoff_item_redistribution(p_tenant uuid,p_actor uuid,p_project uuid,p_version uuid,p_item uuid,
  p_mode text,p_module boolean)
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
  has_buildings boolean;
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
  select exists(select 1 from public.takeoff_plan_locations where project_id=p_project and tenant_id=p_tenant and building_choice='value')
    into has_buildings;

  for source in select t as target,i as line,
      coalesce(sum(p.quantity),0) raw_quantity,
      coalesce(i.title,(select e.label from public.takeoff_list_revision_entries e
        where e.project_id=p_project and e.item_id=p_item order by e.revision_id limit 1),'Ligne supprimée') as title
    from public.takeoff_item_send_targets t left join public.takeoff_item_send_parts p on p.target_id=t.id and p.state='live'
    left join public.estimate_items i on i.id=t.estimate_item_id
    where t.tenant_id=p_tenant and t.project_id=p_project and t.version_id=p_version and t.item_id=p_item
    group by t.id,i.id having count(p.id)>0 or t.estimate_item_id is not null order by t.id
  loop
    reason := null;
    identity := jsonb_build_array((source.line).title,(source.line).category_id,(source.line).tax_rate_bp,(source.line).k_fo,(source.target).unit_code,(source.target).basis,(source.target).network,(source.target).material,(source.target).diameter);
    if (source.target).breakdown='dpgf' then reason:='dpgf';
    elsif (source.line).id is null then reason:='deleted';
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
      or (source.line).source_provider is distinct from 'takeoff'
      or (source.line).source_file_name is not null or (source.line).source_page is not null
      or (source.line).source_metadata is distinct from jsonb_build_object('takeoff_item_send',jsonb_build_object(
        'version',1,'item_id',p_item,'compartment_key',(source.target).compartment_key,'breakdown',(source.target).breakdown)) then reason:='edited';
    elsif private.takeoff_redistribution_line_used((source.line).id) then reason:='used';
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
    select p.*,loc.key,loc.label,a.revision,d.document
    from public.takeoff_item_send_parts p
    left join lateral (select g.document from public.takeoff_item_send_pages g
      where g.version_id=p_version and g.receipt_id=p.receipt_id and p.id=any(g.part_ids) order by g.id limit 1) d on true
    left join public.takeoff_plan_location_sources origin on origin.plan_file_id=(d.document->>'plan_file_id')::uuid
      and origin.tenant_id=p_tenant and origin.project_id=p_project
    left join public.takeoff_plan_locations a on a.tenant_id=p_tenant and a.project_id=p_project and
      a.source_kind=coalesce(origin.source_kind,'plan_file') and a.source_id=coalesce(origin.source_id,(d.document->>'plan_file_id')::uuid)
      and a.content_hash=d.document->>'content_hash'
    cross join lateral private.takeoff_redistribution_location(p_mode,a.building,a.level,a.building_choice='unknown' and not has_buildings) loc
    where p.version_id=p_version and p.tenant_id=p_tenant and p.project_id=p_project and p.item_id=p_item and p.state='live'
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'from_target',target_id,'key',key,'label',label,'quantity',quantity,
    'unit',unit_code,'pages',pages,'plan_name',document->>'file_name','job_id',job_id,'receipt_id',receipt_id,'location_revision',revision) order by id),'[]') into parts from located;
  if parts='[]' then raise exception 'REDISTRIBUTION_EMPTY' using errcode='22023'; end if;
  select jsonb_agg(jsonb_build_object('key',g.key,'label',g.label,'raw',g.raw,'quantity',g.quantity,'line_id',t.estimate_item_id,
    'target_id',t.id,'quantity_before',(select i.quantity from public.estimate_items i where i.id=t.estimate_item_id),'section_id',s.estimate_item_id,'section_key',g.section_key) order by g.key) into destinations
  from (select x->>'key' key,min(x->>'label') label,sum((x->>'quantity')::numeric) raw,
      private.takeoff_item_send_rounded(sum((x->>'quantity')::numeric),private.takeoff_item_send_length_factor(min(x->>'unit'))) quantity,
      case when p_mode='together' then base_key else base_key||'/'||(x->>'key') end section_key
    from jsonb_array_elements(parts)x group by x->>'key') g
  left join public.takeoff_item_send_targets t on t.item_id=p_item and t.version_id=p_version and t.breakdown=p_mode
    and t.compartment_key=g.key and t.estimate_item_id is not null
  left join public.takeoff_item_send_sections s on s.version_id=p_version and s.section_key=g.section_key and s.estimate_item_id is not null;
  -- Check both paths, including an existing destination section no part has reached yet.
  for section in with recursive paths(id) as (
      select distinct id from (select i.parent_id as id from public.estimate_items i where i.id in
        (select (x->>'line_id')::uuid from jsonb_array_elements(sources)x)
        union select (x->>'section_id')::uuid from jsonb_array_elements(destinations)x) roots where id is not null
      union select i.parent_id from paths join public.estimate_items i on i.id=paths.id where i.parent_id is not null)
    select i.id,i.title from paths join public.estimate_items i on i.id=paths.id
      left join public.takeoff_item_send_sections s on s.version_id=p_version and s.estimate_item_id=i.id
      where s.id is null or s.title<>i.title or private.takeoff_redistribution_edited(i) order by i.id
  loop
    blockers:=blockers||jsonb_build_array(jsonb_build_object('reason','section','title',section.title,'line_id',section.id));
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
    'version_revision',version_row.content_revision,'sources',sources,'parts',parts,'destinations',destinations,'blockers',blockers,
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
  p_mode text,p_module boolean,p_request uuid,p_digest text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  prior public.takeoff_item_send_receipts;
  plan jsonb;
  receipt uuid:=gen_random_uuid();
  destination jsonb;
  target uuid;
  line_id uuid;
  parent uuid;
  prototype public.estimate_items;
  origin public.takeoff_item_send_targets;
  next_pos integer;
  moves jsonb:='[]';
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
  perform 1 from public.estimate_versions where id=p_version and project_id=p_project and tenant_id=p_tenant for no key update;
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
  plan:=public.preview_takeoff_item_redistribution(p_tenant,p_actor,p_project,p_version,p_item,p_mode,p_module);
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
      select coalesce(max(position),0)+1 into next_pos from public.estimate_items where version_id=p_version and parent_id=parent;
      insert into public.estimate_items(tenant_id,version_id,parent_id,item_type,position,title,description,quantity,unit_code,
        pricing_status,unit_price_ht_cents,tax_rate_bp,k_fo,fo_provision,k_fo_manual,h_mo,h_mo_majoration,k_mo,pu_ht_cents,line_total_ht_cents,
        line_tax_cents,line_total_ttc_cents,category_id,source_provider,source_job_id,source_metadata)
      values(p_tenant,p_version,parent,'line',next_pos,prototype.title,origin.unit_code,(destination->>'quantity')::numeric,
        origin.unit_code,'priced',0,prototype.tax_rate_bp,prototype.k_fo,prototype.fo_provision,prototype.k_fo_manual,0,1,1,0,0,0,0,prototype.category_id,'takeoff',prototype.source_job_id,
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
    moved as (update public.takeoff_item_send_parts part set target_id=target from changing c
      where part.id=c.id and part.target_id=c.old_target and part.state='live'
      returning part.id,c.old_target,part.receipt_id,part.quantity)
    select moves||coalesce(jsonb_agg(jsonb_build_object('part_id',id,'from_target',old_target,'to_target',target,
      'from_line',s->'line_id','to_line',line_id,'from_line_before',s->'quantity',
      'from_line_after',(select d->'quantity' from jsonb_array_elements(plan->'destinations')d where d->>'target_id'=old_target::text),
      'to_line_before',destination->'quantity_before','to_line_after',destination->'quantity',
      'receipt_id',receipt_id,'quantity',quantity) order by id),'[]') into moves from moved
      join jsonb_array_elements(plan->'sources')s on s->>'target_id'=old_target::text;
    written:=array_append(written,line_id);
    reached:=reached||jsonb_build_array(destination||jsonb_build_object('line_id',line_id,'target_id',target));
  end loop;
  delete from public.estimate_items i where i.version_id=p_version and i.id in
    (select value::uuid from jsonb_array_elements_text(plan->'remove_lines'));
  perform public.estimate_v3_complete_entry_for_writer(p_version,written);
  if other_amounts is distinct from private.takeoff_redistribution_other_amounts(p_version,p_item) then
    raise exception 'REDISTRIBUTION_OTHER_AMOUNTS' using errcode='55000';
  end if;
  result:=jsonb_build_object('destinations',reached,'moves',moves,'source_receipts',
    (with recursive receipts(id) as (
      select (m->>'receipt_id')::uuid from jsonb_array_elements(moves)m
      union select (r.write_plan->>'copied_from_receipt_id')::uuid from receipts c
        join public.takeoff_item_send_receipts r on r.id=c.id and r.tenant_id=p_tenant and r.project_id=p_project
        where r.command_kind='copy' and r.write_plan->>'copied_from_receipt_id' is not null
    ), sources as (select id from receipts union
      select r.id from jsonb_array_elements(plan->'parts')p join public.takeoff_item_send_receipts r on r.job_id=(p->>'job_id')::uuid
      where r.tenant_id=p_tenant and r.project_id=p_project and r.command_kind='send'
        and exists(select 1 from jsonb_array_elements(moves)m where m->>'part_id'=p->>'id'))
    select coalesce(jsonb_agg(id order by id),'[]') from sources));
  insert into public.takeoff_item_send_receipts(id,tenant_id,project_id,version_id,request_id,command_kind,format_version,
    actor_id,plan_sha256,version_created,write_plan,result)
  values(receipt,p_tenant,p_project,p_version,p_request,'redistribute',1,p_actor,p_digest,false,plan,result);
  perform set_config('miaouffrage.estimate_v3_writer',old_writer,true);
  perform set_config('mergeone.takeoff_item_redistribution',old_redistribution,true);
  perform set_config('mergeone.takeoff_item_send',old_send,true);
  return result||jsonb_build_object('receipt_id',receipt,'replayed',false);
end;
$$;
revoke all on function private.takeoff_redistribution_check_scope(uuid,uuid,uuid,uuid,boolean),
  private.takeoff_redistribution_line_used(uuid),private.takeoff_redistribution_location(text,text,text,boolean),
  private.takeoff_redistribution_edited(public.estimate_items),private.takeoff_redistribution_other_amounts(uuid,uuid),
  public.preview_takeoff_item_redistribution(uuid,uuid,uuid,uuid,uuid,text,boolean),
  public.redistribute_takeoff_item(uuid,uuid,uuid,uuid,uuid,text,boolean,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.preview_takeoff_item_redistribution(uuid,uuid,uuid,uuid,uuid,text,boolean),
  public.redistribute_takeoff_item(uuid,uuid,uuid,uuid,uuid,text,boolean,uuid,text) to service_role;
commit;
