-- One line added to a v3 estimate through the grid (POST /api/estimates/{versionId}/items,
-- public.atomic_create_estimate_item). Contract and probe: docs/testing/large-estimate-statement-budget.md,
-- supabase/tests/database/estimate-large-v3-scale.test.sql.
--
-- Observed (owned native stack, production build, the public 2 031-item workbook imported through the application):
-- the statement ran 9,9 s and the API roles' 8 s statement_timeout cancelled it (57014, 400 « Impossible de créer la
-- ligne et ses totaux. », three attempts out of three); the same action took about 2 s on an ordinary estimate. The
-- profile (pg_stat_xact_user_functions): the v3 projection of every line of the version went to
-- public.bulk_update_estimate_items, which wrote each of the 1 901 lines twice (its position negated, then every
-- column restored) with its stored amounts; each of these UPDATEs ran the row policies (268 009 is_tenant_member,
-- 137 331 is_admin_user), the per-line content revision trigger and an audit row. 20261018180306 removed the same
-- rewrite from public.commit_estimate_batch only.
--
-- On a v3 only, the projection passed to public.bulk_update_estimate_items keeps the lines whose amounts differ from
-- the stored ones, with the statement public.commit_estimate_batch uses; every other line keeps its stored amounts,
-- which public.estimate_v3_assert_draft_for_writer still checks against the engine 3 with the footer, as before.
-- v1/v2 versions keep the full projection. After: 180 ms for the same statement, the created line written and no
-- stored line updated.
--
-- The version of the result also carries its content_revision, read from the same row as its updated_at (every
-- engine). Without it, the editor read the whole estimate again after each added line only to learn that number
-- (5 Mo for 2 031 items). The server passes the version through, and the response contract already declares the
-- field as optional: a server that predates this migration, or this function without it, keeps the read.
-- Same signature, checks, errors and grants; nothing else changes.
begin;

CREATE OR REPLACE FUNCTION public.atomic_create_estimate_item(p_version_id uuid, p_item jsonb, p_item_updates jsonb, p_version_patch jsonb, p_expected_updated_at timestamp with time zone, p_draft_lock_session_id uuid, p_calculation_context jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  is_v3 boolean;
  previous_v3_writer text;
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
    or p_item - array['id','parent_id','item_type','position','title','description','aid','quantity','unit_price_ht_cents','tax_rate_bp','k_fo','h_mo','h_mo_majoration','k_mo','h_mo_atelier','k_mo_atelier','labor_role_atelier_id','h_mo_chantier','k_mo_chantier','labor_role_chantier_id','pu_ht_cents','labor_role_id','category_id','supply_type_id','product_id','selected_supplier_price_id','fo_price_origin','line_total_ht_cents','line_tax_cents','line_total_ttc_cents','line_nature','source_provider','source_job_id','source_file_name','source_page','unit_code','pricing_status','h_mo_per_unit','h_mo_atelier_per_unit','h_mo_chantier_per_unit'] <> '{}'::jsonb
    or not (p_version_patch ?& array['total_ht_cents','total_tax_cents','total_ttc_cents'])
    or p_version_patch - array['total_ht_cents','total_tax_cents','total_ttc_cents','gross_ht_cents','discount_applied_cents','commercial_rounding_cents'] <> '{}'::jsonb
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
  is_v3:=version_row.calc_engine_version=3;
  if (p_version_patch ?| array['gross_ht_cents','discount_applied_cents','commercial_rounding_cents']) is distinct from is_v3
    or is_v3 and not (p_version_patch ?& array['gross_ht_cents','discount_applied_cents','commercial_rounding_cents']) then
    raise exception using errcode='22023',message='ESTIMATE_CREATE_INVALID_INPUT';
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
  select * into item_row from jsonb_populate_record(null::public.estimate_items,public.estimate_fo_price_origin_write_input(normalized_item));
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

  previous_v3_writer:=coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer',true),'');
  if is_v3 then perform pg_catalog.set_config('miaouffrage.estimate_v3_writer',p_version_id::text,true); end if;
  insert into public.estimate_items(id,tenant_id,version_id,parent_id,item_type,position,title,description,aid,quantity,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,h_mo_majoration,k_mo,h_mo_atelier,k_mo_atelier,labor_role_atelier_id,h_mo_chantier,k_mo_chantier,labor_role_chantier_id,pu_ht_cents,labor_role_id,category_id,supply_type_id,product_id,selected_supplier_price_id,fo_price_origin,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,line_nature,source_provider,source_job_id,source_file_name,source_page,unit_code,pricing_status,h_mo_per_unit,h_mo_atelier_per_unit,h_mo_chantier_per_unit)
  values(item_row.id,target_tenant,p_version_id,item_row.parent_id,item_row.item_type,item_row.position,item_row.title,item_row.description,item_row.aid,item_row.quantity,item_row.unit_price_ht_cents,item_row.tax_rate_bp,item_row.k_fo,item_row.h_mo,item_row.h_mo_majoration,item_row.k_mo,item_row.h_mo_atelier,item_row.k_mo_atelier,item_row.labor_role_atelier_id,item_row.h_mo_chantier,item_row.k_mo_chantier,item_row.labor_role_chantier_id,item_row.pu_ht_cents,item_row.labor_role_id,item_row.category_id,item_row.supply_type_id,item_row.product_id,item_row.selected_supplier_price_id,item_row.fo_price_origin,item_row.line_total_ht_cents,item_row.line_tax_cents,item_row.line_total_ttc_cents,item_row.line_nature,item_row.source_provider,item_row.source_job_id,item_row.source_file_name,item_row.source_page,item_row.unit_code,coalesce(item_row.pricing_status,'priced'::public.estimate_line_pricing_status),item_row.h_mo_per_unit,item_row.h_mo_atelier_per_unit,item_row.h_mo_chantier_per_unit);

  select coalesce(array_agg(distinct role_id order by role_id),'{}'::uuid[]) into role_ids
  from public.estimate_items i cross join lateral unnest(array[i.labor_role_id,i.labor_role_atelier_id,i.labor_role_chantier_id]) r(role_id)
  where i.version_id=p_version_id and i.item_type='line' and role_id is not null;
  if version_row.calc_engine_version in (2, 3) and exists(select 1 from unnest(role_ids) r(id) where not exists(select 1 from public.labor_roles l where l.id=r.id and l.tenant_id=target_tenant and l.user_id=project_row.user_id)) then
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
    if exists(select 1 from jsonb_array_elements(p_item_updates) u cross join lateral jsonb_each(u-'id') x where not (is_v3 and x.key='pu_ht_cents' and x.value='null'::jsonb) and (jsonb_typeof(x.value)<>'number' or x.value::text !~ '^-?[0-9]+$')) then
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
  -- A v3 rewrites only the lines whose projection differs from the stored amounts, as public.commit_estimate_batch
  -- does since 20261018180306; every other line keeps them, and public.estimate_v3_assert_draft_for_writer below still
  -- checks every line and the footer against the engine 3.
  perform public.bulk_update_estimate_items(p_version_id,case when not is_v3 then p_item_updates else coalesce((
      select jsonb_agg(u.value order by u.ordinality) from jsonb_array_elements(p_item_updates) with ordinality u
      join public.estimate_items i on i.id=(u.value->>'id')::uuid and i.version_id=p_version_id
      where (i.pu_ht_cents,i.line_total_ht_cents,i.line_tax_cents,i.line_total_ttc_cents) is distinct from
        ((u.value->>'pu_ht_cents')::integer,(u.value->>'line_total_ht_cents')::integer,(u.value->>'line_tax_cents')::integer,(u.value->>'line_total_ttc_cents')::integer)),'[]'::jsonb) end,
    case when is_v3 then null else p_version_patch end,version_token);
  if is_v3 then
    update public.estimate_versions v set total_ht_cents=(p_version_patch->>'total_ht_cents')::integer,total_tax_cents=(p_version_patch->>'total_tax_cents')::integer,total_ttc_cents=(p_version_patch->>'total_ttc_cents')::integer,
      gross_ht_cents=(p_version_patch->>'gross_ht_cents')::integer,discount_applied_cents=(p_version_patch->>'discount_applied_cents')::integer,commercial_rounding_cents=(p_version_patch->>'commercial_rounding_cents')::integer
    where v.id=p_version_id and v.tenant_id=target_tenant;
    perform public.estimate_v3_assert_draft_for_writer(p_version_id);
    perform pg_catalog.set_config('miaouffrage.estimate_v3_writer',previous_v3_writer,true);
  end if;
  select i.* into result_item from public.estimate_items i where i.id=item_row.id and i.version_id=p_version_id;
  select v.* into version_row from public.estimate_versions v where v.id=p_version_id;
  return jsonb_build_object('item',to_jsonb(result_item),'version',jsonb_build_object('id',version_row.id,'updated_at',version_row.updated_at,'content_revision',version_row.content_revision),'totals',jsonb_build_object('total_ht_cents',version_row.total_ht_cents,'total_tax_cents',version_row.total_tax_cents,'total_ttc_cents',version_row.total_ttc_cents));
exception when lock_not_available then
  raise exception using errcode='40001',message='ESTIMATE_CREATE_STALE';
end;
$function$;

commit;
