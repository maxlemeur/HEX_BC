begin;

-- Materialization is an earlier transaction. This narrow finalizer guarantees
-- financial coherence of a SUCCESS only, using the caller's existing TS engine.
-- It does not delete materialized rows, replay an insertion or publish snapshots.
create function public.finalize_estimate_assembly_calculation(
  p_version_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_content_revision bigint,
  p_draft_lock_session_id uuid,
  p_inserted_item_ids uuid[],
  p_item_updates jsonb,
  p_version_patch jsonb,
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
  actual_ids uuid[];
  projected_ids uuid[];
  role_ids uuid[];
  raw_context jsonb;
  inserted_items jsonb;
begin
  if actor_id is null then
    raise exception using errcode='42501',message='ESTIMATE_ASSEMBLY_CALCULATION_FORBIDDEN';
  end if;
  -- Same advisory order as atomic_create_estimate_item. Membership/default
  -- changes and absent configuration rows use the existing exclusive gates.
  if not pg_catalog.pg_try_advisory_xact_lock_shared(pg_catalog.hashtextextended('estimate-create-actor:'||actor_id::text,0)) then
    raise exception using errcode='40001',message='ESTIMATE_ASSEMBLY_CALCULATION_CONTEXT_CHANGED';
  end if;
  target_tenant:=public.current_tenant_id();
  if target_tenant is null then
    raise exception using errcode='42501',message='ESTIMATE_ASSEMBLY_CALCULATION_FORBIDDEN';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock_shared(pg_catalog.hashtextextended('estimate-calculation:'||target_tenant::text,0)) then
    raise exception using errcode='40001',message='ESTIMATE_ASSEMBLY_CALCULATION_CONTEXT_CHANGED';
  end if;
  select m.role into actor_role from public.tenant_memberships m
  join public.tenants t on t.id=m.tenant_id and t.is_active
  where m.tenant_id=target_tenant and m.user_id=actor_id;
  if actor_role is null or actor_role not in ('admin','engineer') then
    raise exception using errcode='42501',message='ESTIMATE_ASSEMBLY_CALCULATION_FORBIDDEN';
  end if;

  if p_version_id is null or p_expected_updated_at is null
    or p_expected_content_revision is null or p_expected_content_revision<0
    or p_draft_lock_session_id is null
    or p_inserted_item_ids is null or cardinality(p_inserted_item_ids)=0
    or array_ndims(p_inserted_item_ids) is distinct from 1
    or exists(select 1 from unnest(p_inserted_item_ids) id where id is null)
    or cardinality(p_inserted_item_ids)<>(select count(distinct id) from unnest(p_inserted_item_ids) id)
    or jsonb_typeof(p_item_updates) is distinct from 'array'
    or jsonb_typeof(p_version_patch) is distinct from 'object'
    or not(p_version_patch ?& array['total_ht_cents','total_tax_cents','total_ttc_cents'])
    or p_version_patch-array['total_ht_cents','total_tax_cents','total_ttc_cents']<>'{}'::jsonb
    or jsonb_typeof(p_calculation_context) is distinct from 'object'
    or not(p_calculation_context ?& array['labor_roles','margin_tiers','labor_split_flag'])
    or p_calculation_context-array['labor_roles','margin_tiers','labor_split_flag']<>'{}'::jsonb
    or jsonb_typeof(p_calculation_context->'labor_roles') is distinct from 'array'
    or jsonb_typeof(p_calculation_context->'margin_tiers') is distinct from 'array'
    or jsonb_typeof(p_calculation_context->'labor_split_flag') not in ('object','null')
  then
    raise exception using errcode='22023',message='ESTIMATE_ASSEMBLY_CALCULATION_INVALID_INPUT';
  end if;
  if exists(select 1 from jsonb_each(p_version_patch) x
    where jsonb_typeof(x.value)<>'number' or x.value::text !~ '^[0-9]+$') then
    raise exception using errcode='22023',message='ESTIMATE_ASSEMBLY_CALCULATION_INVALID_INPUT';
  end if;
  if exists(select 1 from jsonb_each(p_version_patch) x where x.value::text::numeric>2147483647) then
    raise exception using errcode='22023',message='ESTIMATE_ASSEMBLY_CALCULATION_INVALID_INPUT';
  end if;
  if exists(select 1 from jsonb_array_elements(p_item_updates) u
    where jsonb_typeof(u) is distinct from 'object'
    or not(u ?& array['id','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents'])
    or u-array['id','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents']<>'{}'::jsonb
    or jsonb_typeof(u->'id') is distinct from 'string'
    or u->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception using errcode='22023',message='ESTIMATE_ASSEMBLY_CALCULATION_PROJECTION_MISMATCH';
  end if;
  if exists(select 1 from jsonb_array_elements(p_item_updates) u
    cross join lateral jsonb_each(u-'id') x
    where jsonb_typeof(x.value)<>'number' or x.value::text !~ '^[0-9]+$') then
    raise exception using errcode='22023',message='ESTIMATE_ASSEMBLY_CALCULATION_PROJECTION_MISMATCH';
  end if;
  if exists(select 1 from jsonb_array_elements(p_item_updates) u
    cross join lateral jsonb_each(u-'id') x where x.value::text::numeric>2147483647) then
    raise exception using errcode='22023',message='ESTIMATE_ASSEMBLY_CALCULATION_PROJECTION_MISMATCH';
  end if;

  -- NOWAIT converts inverse direct-item/version locking into an explicit
  -- conflict. Authenticated invoker RLS applies to these reads and the writer.
  select v.* into version_row from public.estimate_versions v
  where v.id=p_version_id and v.tenant_id=target_tenant for update nowait;
  if not found or version_row.status<>'draft' then
    raise exception using errcode='42501',message='ESTIMATE_ASSEMBLY_CALCULATION_FORBIDDEN';
  end if;
  select p.* into project_row from public.estimate_projects p
  where p.id=version_row.project_id and p.tenant_id=target_tenant for share nowait;
  if not found or project_row.is_archived or (project_row.user_id<>actor_id and actor_role<>'admin') then
    raise exception using errcode='42501',message='ESTIMATE_ASSEMBLY_CALCULATION_FORBIDDEN';
  end if;
  if version_row.updated_at is distinct from p_expected_updated_at
    or version_row.content_revision is distinct from p_expected_content_revision then
    raise exception using errcode='40001',message='ESTIMATE_ASSEMBLY_CALCULATION_STALE';
  end if;
  select l.* into lock_row from public.draft_locks l
  where l.version_id=p_version_id and l.tenant_id=target_tenant for update nowait;
  if not found or lock_row.user_id is distinct from actor_id
    or lock_row.session_id is distinct from p_draft_lock_session_id
    or lock_row.expires_at<=clock_timestamp() then
    raise exception using errcode='55000',message='ESTIMATE_ASSEMBLY_CALCULATION_LOCK_REQUIRED';
  end if;
  perform i.id from public.estimate_items i
  where i.version_id=p_version_id and i.tenant_id=target_tenant order by i.id for update nowait;
  if exists(select 1 from unnest(p_inserted_item_ids) requested(id)
    where not exists(select 1 from public.estimate_items i where i.id=requested.id and i.version_id=p_version_id and i.tenant_id=target_tenant)) then
    raise exception using errcode='22023',message='ESTIMATE_ASSEMBLY_CALCULATION_INVALID_INPUT';
  end if;
  select coalesce(array_agg((u->>'id')::uuid order by (u->>'id')::uuid),'{}'::uuid[])
  into projected_ids from jsonb_array_elements(p_item_updates) u;
  select coalesce(array_agg(i.id order by i.id),'{}'::uuid[]) into actual_ids
  from public.estimate_items i where i.version_id=p_version_id and i.tenant_id=target_tenant and i.item_type='line';
  -- Both engines project every line. V1 values remain gross; the TS engine
  -- supplies that distinction. SQL neither recomputes nor allocates money.
  if projected_ids is distinct from actual_ids then
    raise exception using errcode='22023',message='ESTIMATE_ASSEMBLY_CALCULATION_PROJECTION_MISMATCH';
  end if;
  select coalesce(array_agg(distinct role_id order by role_id),'{}'::uuid[]) into role_ids
  from public.estimate_items i cross join lateral unnest(array[i.labor_role_id,i.labor_role_atelier_id,i.labor_role_chantier_id]) r(role_id)
  where i.version_id=p_version_id and i.tenant_id=target_tenant and i.item_type='line' and role_id is not null;
  if version_row.calc_engine_version=2 and exists(select 1 from unnest(role_ids) r(id)
    where not exists(select 1 from public.labor_roles l where l.id=r.id and l.tenant_id=target_tenant and l.user_id=project_row.user_id)) then
    raise exception using errcode='40001',message='ESTIMATE_ASSEMBLY_CALCULATION_CONTEXT_CHANGED';
  end if;
  select jsonb_build_object(
    'labor_roles',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'tenant_id',l.tenant_id,'user_id',l.user_id,'hourly_rate_cents',l.hourly_rate_cents) order by l.id) from public.labor_roles l where l.id=any(role_ids) and l.tenant_id=target_tenant and l.user_id=project_row.user_id),'[]'),
    'margin_tiers',case when version_row.margin_mode='tiered' then coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'threshold_cents',m.threshold_cents,'multiplier',m.multiplier,'position',m.position) order by m.threshold_cents,m.position,m.id) from public.margin_tiers m where m.tenant_id=target_tenant),'[]') else '[]'::jsonb end,
    'labor_split_flag',(select jsonb_build_object('id',f.id,'enabled',f.enabled) from public.feature_flags f where f.tenant_id=target_tenant and f.flag_key='EST_031_LABOR_SPLIT')) into raw_context;
  if raw_context is distinct from p_calculation_context then
    raise exception using errcode='40001',message='ESTIMATE_ASSEMBLY_CALCULATION_CONTEXT_CHANGED';
  end if;
  -- The canonical bulk is the ONE financial writer in this transaction. No
  -- fresh token after projection, snapshot publication or role/provenance patch.
  perform public.bulk_update_estimate_items(p_version_id,p_item_updates,p_version_patch,p_expected_updated_at);
  select coalesce(jsonb_agg(to_jsonb(i) order by requested.ordinality),'[]') into inserted_items
  from unnest(p_inserted_item_ids) with ordinality requested(id,ordinality)
  join public.estimate_items i on i.id=requested.id and i.version_id=p_version_id and i.tenant_id=target_tenant;
  select v.* into version_row from public.estimate_versions v where v.id=p_version_id and v.tenant_id=target_tenant;
  return jsonb_build_object('items',inserted_items,
    'version',jsonb_build_object('id',version_row.id,'updated_at',version_row.updated_at),
    'totals',jsonb_build_object('total_ht_cents',version_row.total_ht_cents,'total_tax_cents',version_row.total_tax_cents,'total_ttc_cents',version_row.total_ttc_cents));
exception when lock_not_available then
  raise exception using errcode='40001',message='ESTIMATE_ASSEMBLY_CALCULATION_STALE';
end;
$$;
revoke all on function public.finalize_estimate_assembly_calculation(uuid,timestamptz,bigint,uuid,uuid[],jsonb,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.finalize_estimate_assembly_calculation(uuid,timestamptz,bigint,uuid,uuid[],jsonb,jsonb,jsonb) to authenticated;
comment on function public.finalize_estimate_assembly_calculation(uuid,timestamptz,bigint,uuid,uuid[],jsonb,jsonb,jsonb) is
  'Finalize every financial line and footer after library materialization with the existing bulk writer, guarded by actor/tenant, draft/session, version/content CAS and raw calculation dependencies. Materialization is a previous transaction; no insertion retry or publication snapshot.';

commit;
