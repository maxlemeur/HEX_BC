begin;

-- A tenant-scoped shared/exclusive gate protects the calculator's RAW inputs,
-- including absent flags and empty tier tables. Row locks alone miss INSERTs.
-- A configuration writer already owns its row before a BEFORE trigger runs;
-- try-locks avoid an inverse row/version/advisory wait cycle. The caller retries
-- an explicit conflict from a fresh context. No role/table privilege is added.
create function private.guard_estimate_calculation_context_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare affected_tenant uuid; old_tenant uuid; new_tenant uuid;
begin
  if tg_table_name = 'feature_flags' then
    if tg_op <> 'INSERT' and old.flag_key = 'EST_031_LABOR_SPLIT' then old_tenant := old.tenant_id; end if;
    if tg_op <> 'DELETE' and new.flag_key = 'EST_031_LABOR_SPLIT' then new_tenant := new.tenant_id; end if;
  else
    if tg_op <> 'INSERT' then old_tenant := old.tenant_id; end if;
    if tg_op <> 'DELETE' then new_tenant := new.tenant_id; end if;
  end if;
  for affected_tenant in select distinct t from unnest(array[old_tenant,new_tenant]) t where t is not null order by t loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('estimate-calculation:'||affected_tenant::text,0)) then
      raise exception using errcode='40001',message='ESTIMATE_CREATE_CONTEXT_CHANGED';
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.guard_estimate_calculation_context_write() from public,anon,authenticated,service_role;

create trigger aaa_guard_estimate_calculation_context
before insert or update or delete on public.labor_roles
for each row execute function private.guard_estimate_calculation_context_write();
create trigger aaa_guard_estimate_calculation_context
before insert or update or delete on public.margin_tiers
for each row execute function private.guard_estimate_calculation_context_write();
create trigger aaa_guard_estimate_calculation_context
before insert or update or delete on public.feature_flags
for each row execute function private.guard_estimate_calculation_context_write();

-- Membership changes coordinate both actor selection and tenant activation.
-- A writer takes the tenant gate before actor gates; all gates are try-locks,
-- so the opposite RPC order cannot deadlock. Membership phantoms cannot appear
-- after the tenant trigger enumerates its affected actors.
create function private.guard_estimate_create_membership_write()
returns trigger language plpgsql security invoker set search_path='' as $$
declare old_tenant uuid; new_tenant uuid; old_actor uuid; new_actor uuid; target uuid;
begin
  if tg_op<>'INSERT' then old_tenant:=old.tenant_id; old_actor:=old.user_id; end if;
  if tg_op<>'DELETE' then new_tenant:=new.tenant_id; new_actor:=new.user_id; end if;
  for target in select distinct id from unnest(array[old_tenant,new_tenant]) x(id) where id is not null order by id loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('estimate-calculation:'||target::text,0)) then
      raise exception using errcode='40001',message='ESTIMATE_CREATE_CONTEXT_CHANGED';
    end if;
  end loop;
  for target in select distinct id from unnest(array[old_actor,new_actor]) x(id) where id is not null order by id loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('estimate-create-actor:'||target::text,0)) then
      raise exception using errcode='40001',message='ESTIMATE_CREATE_CONTEXT_CHANGED';
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.guard_estimate_create_membership_write() from public,anon,authenticated,service_role;
create trigger aaa_guard_estimate_create_membership
before insert or update or delete on public.tenant_memberships
for each row execute function private.guard_estimate_create_membership_write();

-- Definer is limited to discovering actors hidden by membership RLS. It is not
-- callable by app roles and never mutates rows, grants privileges or accepts IDs.
create function private.guard_estimate_create_tenant_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare affected_actor uuid;
begin
  if tg_op='UPDATE' and new.is_active is not distinct from old.is_active then return new; end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('estimate-calculation:'||old.id::text,0)) then
    raise exception using errcode='40001',message='ESTIMATE_CREATE_CONTEXT_CHANGED';
  end if;
  for affected_actor in select distinct user_id from public.tenant_memberships where tenant_id=old.id order by user_id loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('estimate-create-actor:'||affected_actor::text,0)) then
      raise exception using errcode='40001',message='ESTIMATE_CREATE_CONTEXT_CHANGED';
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.guard_estimate_create_tenant_write() from public,anon,authenticated,service_role;
create trigger aaa_guard_estimate_create_tenant
before update of is_active or delete on public.tenants
for each row execute function private.guard_estimate_create_tenant_write();

create function public.atomic_create_estimate_item(
  p_version_id uuid,
  p_item jsonb,
  p_item_updates jsonb,
  p_version_patch jsonb,
  p_expected_updated_at timestamptz,
  p_draft_lock_session_id uuid,
  p_calculation_context jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_tenant uuid;
  actor_role public.tenant_role;
  version_row public.estimate_versions%rowtype;
  project_row public.estimate_projects%rowtype;
  lock_row public.draft_locks%rowtype;
  item_row public.estimate_items%rowtype;
  result_item public.estimate_items%rowtype;
  normalized_item jsonb;
  raw_context jsonb;
  role_ids uuid[];
  actual_ids uuid[];
  projected_ids uuid[];
  version_token timestamptz;
  effective_defaults jsonb;
begin
  if actor_id is null then
    raise exception using errcode='42501',message='ESTIMATE_CREATE_FORBIDDEN';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock_shared(pg_catalog.hashtextextended('estimate-create-actor:'||actor_id::text,0)) then
    raise exception using errcode='40001',message='ESTIMATE_CREATE_CONTEXT_CHANGED';
  end if;
  target_tenant:=public.current_tenant_id();
  if target_tenant is null then
    raise exception using errcode='42501',message='ESTIMATE_CREATE_FORBIDDEN';
  end if;
  select membership.role into actor_role
  from public.tenant_memberships membership
  where membership.tenant_id=target_tenant and membership.user_id=actor_id;
  if actor_role is null or actor_role not in ('admin','engineer') then
    raise exception using errcode='42501',message='ESTIMATE_CREATE_FORBIDDEN';
  end if;
  if p_draft_lock_session_id is null then
    raise exception using errcode='55000',message='ESTIMATE_CREATE_LOCK_REQUIRED';
  end if;
  if p_version_id is null or p_expected_updated_at is null
    or jsonb_typeof(p_item) is distinct from 'object'
    or jsonb_typeof(p_item_updates) is distinct from 'array'
    or jsonb_typeof(p_version_patch) is distinct from 'object'
    or jsonb_typeof(p_calculation_context) is distinct from 'object'
    or not (p_item ?& array['id','item_type','position','title'])
    or p_item - array['id','parent_id','item_type','position','title','description','aid','quantity','unit_price_ht_cents','tax_rate_bp','k_fo','h_mo','h_mo_majoration','k_mo','h_mo_atelier','k_mo_atelier','labor_role_atelier_id','h_mo_chantier','k_mo_chantier','labor_role_chantier_id','pu_ht_cents','labor_role_id','category_id','supply_type_id','product_id','selected_supplier_price_id','line_total_ht_cents','line_tax_cents','line_total_ttc_cents','line_nature','source_provider','source_job_id','source_file_name','source_page'] <> '{}'::jsonb
    or not (p_version_patch ?& array['total_ht_cents','total_tax_cents','total_ttc_cents'])
    or p_version_patch - array['total_ht_cents','total_tax_cents','total_ttc_cents'] <> '{}'::jsonb
    or not (p_calculation_context ?& array['labor_roles','margin_tiers','labor_split_flag'])
    or p_calculation_context - array['labor_roles','margin_tiers','labor_split_flag'] <> '{}'::jsonb
    or jsonb_typeof(p_calculation_context->'labor_roles') is distinct from 'array'
    or jsonb_typeof(p_calculation_context->'margin_tiers') is distinct from 'array'
    or jsonb_typeof(p_calculation_context->'labor_split_flag') not in ('object','null')
  then
    raise exception using errcode='22023',message='ESTIMATE_CREATE_INVALID_INPUT';
  end if;
  if exists(select 1 from jsonb_each(p_version_patch) x where jsonb_typeof(x.value)<>'number' or x.value::text !~ '^[0-9]+$')
    or jsonb_typeof(p_item->'id') is distinct from 'string'
    or jsonb_typeof(p_item->'title') is distinct from 'string'
    or p_item->>'item_type' not in ('section','line')
    or jsonb_typeof(p_item->'position') is distinct from 'number'
    or p_item->>'position' !~ '^[0-9]+$'
  then raise exception using errcode='22023',message='ESTIMATE_CREATE_INVALID_INPUT'; end if;

  if not pg_catalog.pg_try_advisory_xact_lock_shared(pg_catalog.hashtextextended('estimate-calculation:'||target_tenant::text,0)) then
    raise exception using errcode='40001',message='ESTIMATE_CREATE_CONTEXT_CHANGED';
  end if;
  -- SELECT FOR UPDATE follows the invoker's UPDATE policies as well as RLS.
  select v.* into version_row from public.estimate_versions v
  where v.id=p_version_id and v.tenant_id=target_tenant for update nowait;
  if not found or version_row.status<>'draft' then
    raise exception using errcode='42501',message='ESTIMATE_CREATE_FORBIDDEN';
  end if;
  select p.* into project_row from public.estimate_projects p
  where p.id=version_row.project_id and p.tenant_id=target_tenant for share nowait;
  if not found or project_row.is_archived or (project_row.user_id<>actor_id and actor_role<>'admin') then
    raise exception using errcode='42501',message='ESTIMATE_CREATE_FORBIDDEN';
  end if;
  if version_row.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode='40001',message='ESTIMATE_CREATE_STALE';
  end if;
  select l.* into lock_row from public.draft_locks l
  where l.version_id=p_version_id and l.tenant_id=target_tenant for update nowait;
  if not found or lock_row.user_id is distinct from actor_id or lock_row.session_id is distinct from p_draft_lock_session_id or lock_row.expires_at<=clock_timestamp() then
    raise exception using errcode='55000',message='ESTIMATE_CREATE_LOCK_REQUIRED';
  end if;
  -- Stabilize hierarchy and projected rows before insertion. A direct row writer
  -- may already wait on the version; NOWAIT converts that inversion to conflict.
  perform i.id from public.estimate_items i where i.version_id=p_version_id and i.tenant_id=target_tenant order by i.id for update nowait;
  effective_defaults:=case p_item->>'item_type'
    when 'line' then jsonb_build_object('quantity',1,'unit_price_ht_cents',0,'tax_rate_bp',version_row.tax_rate_bp,'k_fo',1,'h_mo',0,'h_mo_majoration',1,'k_mo',1,'k_mo_atelier',1,'k_mo_chantier',1,'pu_ht_cents',0,'line_total_ht_cents',0,'line_tax_cents',0,'line_total_ttc_cents',0)
    else '{"h_mo_majoration":1,"k_mo_atelier":1,"k_mo_chantier":1}'::jsonb end;
  normalized_item:=effective_defaults||p_item||jsonb_build_object('tenant_id',target_tenant,'version_id',p_version_id);
  -- jsonb_populate_record applies the real column typmods (12,3 and 12,4),
  -- preserving the existing numeric coercion rather than inventing new rounding.
  select * into item_row from jsonb_populate_record(null::public.estimate_items,normalized_item);
  if item_row.id is null or item_row.position is null or item_row.title is null then
    raise exception using errcode='22023',message='ESTIMATE_CREATE_INVALID_INPUT';
  end if;
  if item_row.parent_id is not null and not exists(select 1 from public.estimate_items p where p.id=item_row.parent_id and p.version_id=p_version_id and p.tenant_id=target_tenant and p.item_type='section') then
    raise exception using errcode='22023',message='ESTIMATE_CREATE_INVALID_INPUT';
  end if;
  if item_row.category_id is not null and not exists(select 1 from public.estimate_categories c where c.id=item_row.category_id and c.tenant_id=target_tenant and c.user_id=project_row.user_id)
    or item_row.supply_type_id is not null and not exists(select 1 from public.supply_types s where s.id=item_row.supply_type_id and s.tenant_id=target_tenant)
    or item_row.product_id is not null and not exists(select 1 from public.products p where p.id=item_row.product_id and p.tenant_id=target_tenant)
    or item_row.selected_supplier_price_id is not null and not exists(select 1 from public.supplier_pricebook s where s.id=item_row.selected_supplier_price_id and s.tenant_id=target_tenant)
  then raise exception using errcode='22023',message='ESTIMATE_CREATE_INVALID_INPUT'; end if;
  if exists(select 1 from unnest(array[item_row.labor_role_id,item_row.labor_role_atelier_id,item_row.labor_role_chantier_id]) r(id)
    where r.id is not null and not exists(select 1 from public.labor_roles l where l.id=r.id and l.tenant_id=target_tenant and l.user_id=project_row.user_id)) then
    raise exception using errcode='22023',message='ESTIMATE_CREATE_INVALID_INPUT';
  end if;

  insert into public.estimate_items(id,tenant_id,version_id,parent_id,item_type,position,title,description,aid,quantity,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,h_mo_majoration,k_mo,h_mo_atelier,k_mo_atelier,labor_role_atelier_id,h_mo_chantier,k_mo_chantier,labor_role_chantier_id,pu_ht_cents,labor_role_id,category_id,supply_type_id,product_id,selected_supplier_price_id,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,line_nature,source_provider,source_job_id,source_file_name,source_page)
  values(item_row.id,target_tenant,p_version_id,item_row.parent_id,item_row.item_type,item_row.position,item_row.title,item_row.description,item_row.aid,item_row.quantity,item_row.unit_price_ht_cents,item_row.tax_rate_bp,item_row.k_fo,item_row.h_mo,item_row.h_mo_majoration,item_row.k_mo,item_row.h_mo_atelier,item_row.k_mo_atelier,item_row.labor_role_atelier_id,item_row.h_mo_chantier,item_row.k_mo_chantier,item_row.labor_role_chantier_id,item_row.pu_ht_cents,item_row.labor_role_id,item_row.category_id,item_row.supply_type_id,item_row.product_id,item_row.selected_supplier_price_id,item_row.line_total_ht_cents,item_row.line_tax_cents,item_row.line_total_ttc_cents,item_row.line_nature,item_row.source_provider,item_row.source_job_id,item_row.source_file_name,item_row.source_page);

  select coalesce(array_agg(distinct role_id order by role_id),'{}'::uuid[]) into role_ids
  from public.estimate_items i cross join lateral unnest(array[i.labor_role_id,i.labor_role_atelier_id,i.labor_role_chantier_id]) r(role_id)
  where i.version_id=p_version_id and i.item_type='line' and role_id is not null;
  if version_row.calc_engine_version=2 and exists(select 1 from unnest(role_ids) r(id) where not exists(select 1 from public.labor_roles l where l.id=r.id and l.tenant_id=target_tenant and l.user_id=project_row.user_id)) then
    raise exception using errcode='40001',message='ESTIMATE_CREATE_CONTEXT_CHANGED';
  end if;
  select jsonb_build_object(
    'labor_roles',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'tenant_id',l.tenant_id,'user_id',l.user_id,'hourly_rate_cents',l.hourly_rate_cents) order by l.id) from public.labor_roles l where l.id=any(role_ids) and l.tenant_id=target_tenant and l.user_id=project_row.user_id),'[]'),
    'margin_tiers',case when version_row.margin_mode='tiered' then coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'threshold_cents',m.threshold_cents,'multiplier',m.multiplier,'position',m.position) order by m.threshold_cents,m.position,m.id) from public.margin_tiers m where m.tenant_id=target_tenant),'[]') else '[]'::jsonb end,
    'labor_split_flag',(select jsonb_build_object('id',f.id,'enabled',f.enabled) from public.feature_flags f where f.tenant_id=target_tenant and f.flag_key='EST_031_LABOR_SPLIT')) into raw_context;
  if raw_context is distinct from p_calculation_context then
    raise exception using errcode='40001',message='ESTIMATE_CREATE_CONTEXT_CHANGED';
  end if;
  if version_row.calc_engine_version=1 then
    if p_item_updates<>'[]'::jsonb then raise exception using errcode='22023',message='ESTIMATE_CREATE_PROJECTION_MISMATCH'; end if;
  else
    if exists(select 1 from jsonb_array_elements(p_item_updates) u where jsonb_typeof(u)<>'object'
      or not(u ?& array['id','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents'])
      or u-array['id','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents']<>'{}'::jsonb
      or jsonb_typeof(u->'id')<>'string') then
      raise exception using errcode='22023',message='ESTIMATE_CREATE_PROJECTION_MISMATCH';
    end if;
    if exists(select 1 from jsonb_array_elements(p_item_updates) u cross join lateral jsonb_each(u-'id') x where jsonb_typeof(x.value)<>'number' or x.value::text !~ '^-?[0-9]+$') then
      raise exception using errcode='22023',message='ESTIMATE_CREATE_PROJECTION_MISMATCH';
    end if;
    select coalesce(array_agg((u->>'id')::uuid order by (u->>'id')::uuid),'{}'::uuid[]) into projected_ids from jsonb_array_elements(p_item_updates) u;
    select coalesce(array_agg(i.id order by i.id),'{}'::uuid[]) into actual_ids from public.estimate_items i where i.version_id=p_version_id and i.tenant_id=target_tenant and i.item_type='line';
    if projected_ids is distinct from actual_ids then
      raise exception using errcode='22023',message='ESTIMATE_CREATE_PROJECTION_MISMATCH';
    end if;
  end if;
  -- INSERT's content-revision trigger has advanced this token. The existing bulk
  -- implementation remains the sole projection writer, in this same transaction.
  select v.updated_at into version_token from public.estimate_versions v where v.id=p_version_id;
  perform public.bulk_update_estimate_items(p_version_id,p_item_updates,p_version_patch,version_token);
  select i.* into result_item from public.estimate_items i where i.id=item_row.id and i.version_id=p_version_id;
  select v.* into version_row from public.estimate_versions v where v.id=p_version_id;
  return jsonb_build_object('item',to_jsonb(result_item),'version',jsonb_build_object('id',version_row.id,'updated_at',version_row.updated_at),'totals',jsonb_build_object('total_ht_cents',version_row.total_ht_cents,'total_tax_cents',version_row.total_tax_cents,'total_ttc_cents',version_row.total_ttc_cents));
exception when lock_not_available then
  raise exception using errcode='40001',message='ESTIMATE_CREATE_STALE';
end;
$$;
revoke all on function public.atomic_create_estimate_item(uuid,jsonb,jsonb,jsonb,timestamptz,uuid,jsonb) from public,anon,service_role;
grant execute on function public.atomic_create_estimate_item(uuid,jsonb,jsonb,jsonb,timestamptz,uuid,jsonb) to authenticated;
comment on function public.atomic_create_estimate_item(uuid,jsonb,jsonb,jsonb,timestamptz,uuid,jsonb) is
  'Atomically create an estimate item and persist the caller-computed canonical projection under draft/session/CAS and raw calculation-context guards. No publication snapshot or SQL financial recalculation.';

commit;
