-- Exact fixed discount intent, preserved legacy NULL behavior, and template parent integrity.
-- Prepared from the pinned installed definitions; no backfill or authorization expansion.
begin;

alter table public.estimate_versions add column discount_amount_cents integer null default null;
alter table public.estimate_templates add column discount_amount_cents integer null default null;

alter table public.estimate_versions add constraint estimate_versions_fixed_discount_check check (
  discount_amount_cents is null or (
    discount_amount_cents >= 0
    and discount_mode = 'simple'::public.estimate_discount_mode
    and cardinality(discount_steps) = 0
  )
);
alter table public.estimate_templates add constraint estimate_templates_fixed_discount_check check (
  discount_amount_cents is null or (
    discount_amount_cents >= 0
    and discount_mode = 'simple'::public.estimate_discount_mode
    and cardinality(discount_steps) = 0
  )
);

comment on column public.estimate_versions.discount_amount_cents is
  'Requested fixed discount in integer cents; NULL retains legacy percentage/cascade, zero is explicit. Applied discount is capped by the recalculated base.';
comment on column public.estimate_templates.discount_amount_cents is
  'Copied requested fixed discount in integer cents; NULL retains the historical percentage/cascade configuration.';

CREATE OR REPLACE FUNCTION public.save_estimate_settings_atomic(p_version_id uuid, p_tenant_id uuid, p_actor_user_id uuid, p_expected_updated_at timestamp with time zone, p_expected_content_revision bigint, p_draft_lock_session_id uuid, p_settings_patch jsonb, p_line_projections jsonb, p_totals jsonb, p_expected_dependencies jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  version_row public.estimate_versions%rowtype;
  prospective public.estimate_versions%rowtype;
  project_row public.estimate_projects%rowtype;
  lease_row public.draft_locks%rowtype;
  actor_role public.tenant_role;
  active_tenant uuid;
  projected_ids uuid[];
  actual_ids uuid[];
  role_ids uuid[];
  projection_keys text[];
  raw_dependencies jsonb;
  all_items jsonb;
  previous_marker text;
  ht bigint;
  tax bigint;
  ttc bigint;
  adjustment bigint;
begin
  if current_user <> 'service_role' then
    raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED';
  end if;
  if p_version_id is null or p_tenant_id is null or p_actor_user_id is null
    or p_expected_updated_at is null or p_expected_content_revision is null
    or p_expected_content_revision < 0
    or jsonb_typeof(p_settings_patch) is distinct from 'object'
    or jsonb_typeof(p_line_projections) is distinct from 'array'
    or jsonb_typeof(p_totals) is distinct from 'object'
    or not (p_totals ?& array['total_ht_cents','total_tax_cents','total_ttc_cents','rounding_adjustment_cents'])
    or p_totals-array['total_ht_cents','total_tax_cents','total_ttc_cents','rounding_adjustment_cents'] <> '{}'::jsonb
    or jsonb_typeof(p_expected_dependencies) is distinct from 'object'
    or not (p_expected_dependencies ?& array['labor_roles','margin_tiers','labor_split_flag'])
    or p_expected_dependencies-array['labor_roles','margin_tiers','labor_split_flag'] <> '{}'::jsonb
    or jsonb_typeof(p_expected_dependencies->'labor_roles') is distinct from 'array'
    or jsonb_typeof(p_expected_dependencies->'margin_tiers') is distinct from 'array'
    or jsonb_typeof(p_expected_dependencies->'labor_split_flag') not in ('object','null')
    or p_settings_patch-array['title','exclusions','date_devis','validite_jours','currency','margin_multiplier',
      'margin_mode','margin_bp','discount_bp','discount_amount_cents','discount_mode','discount_steps','global_coefficient','tax_rate_bp',
      'contractor_role','rounding_mode','rounding_step_cents','max_section_depth'] <> '{}'::jsonb
    or coalesce(pg_catalog.current_setting('miaouffrage.estimate_v2_snapshot_freeze',true),'')='on'
    or coalesce(pg_catalog.current_setting('app.takeoff_apply_atomic',true),'')='on'
  then
    raise exception using errcode='22023',message='ESTIMATE_SETTINGS_INVALID_INPUT';
  end if;
  if exists(select 1 from jsonb_each(p_settings_patch) x where
    case
      when x.key in ('title','exclusions') then jsonb_typeof(x.value) not in ('string','null')
      when x.key='discount_amount_cents' then jsonb_typeof(x.value) not in ('number','null')
      when x.key in ('date_devis','currency','margin_mode','discount_mode','contractor_role','rounding_mode') then jsonb_typeof(x.value) <> 'string'
      when x.key='discount_steps' then jsonb_typeof(x.value) <> 'array'
      else jsonb_typeof(x.value) <> 'number'
    end)
    or exists(select 1 from jsonb_each(p_totals) x where jsonb_typeof(x.value)<>'number'
      or x.value::text !~ case when x.key='rounding_adjustment_cents' then '^-?[0-9]+$' else '^[0-9]+$' end)
  then
    raise exception using errcode='22023',message='ESTIMATE_SETTINGS_INVALID_INPUT';
  end if;
  if exists(select 1 from jsonb_each(p_totals) x where abs(x.value::text::numeric)>2147483647)
    or exists(select 1 from jsonb_each(p_settings_patch) x where
      x.key in ('validite_jours','margin_bp','discount_bp','tax_rate_bp','rounding_step_cents','max_section_depth')
      and (x.value::text !~ '^[0-9]+$' or x.value::text::numeric>2147483647))
    or exists(select 1 from jsonb_each(p_settings_patch) x where
      x.key in ('margin_multiplier','global_coefficient') and x.value::text::numeric<0)
    or p_settings_patch ? 'margin_multiplier' and (p_settings_patch->>'margin_multiplier')::numeric>100
    or p_settings_patch ? 'validite_jours' and (p_settings_patch->>'validite_jours')::numeric<1
    or p_settings_patch ? 'rounding_step_cents' and (p_settings_patch->>'rounding_step_cents')::numeric<1
    or p_settings_patch ? 'tax_rate_bp' and (p_settings_patch->>'tax_rate_bp')::numeric>10000
    or p_settings_patch ? 'max_section_depth' and (p_settings_patch->>'max_section_depth')::numeric not between 1 and 4
    or p_settings_patch ? 'currency' and p_settings_patch->>'currency' not in ('EUR','USD','GBP')
    or p_settings_patch ? 'margin_mode' and p_settings_patch->>'margin_mode' not in ('fixed','tiered')
    or p_settings_patch ? 'discount_mode' and p_settings_patch->>'discount_mode' not in ('simple','cascade')
    or p_settings_patch ? 'contractor_role' and p_settings_patch->>'contractor_role' not in ('principal','subcontractor')
    or p_settings_patch ? 'rounding_mode' and p_settings_patch->>'rounding_mode' not in ('none','nearest','up','down')
    or p_settings_patch ? 'date_devis' and p_settings_patch->>'date_devis' !~ '^\d{4}-\d{2}-\d{2}$'
    or p_settings_patch ? 'exclusions' and char_length(p_settings_patch->>'exclusions')>5000
  then
    raise exception using errcode='22023',message='ESTIMATE_SETTINGS_INVALID_INPUT';
  end if;
  if p_settings_patch ? 'discount_amount_cents'
    and p_settings_patch->'discount_amount_cents' <> 'null'::jsonb then
    if p_settings_patch->>'discount_amount_cents' !~ '^[0-9]+$' then
      raise exception using errcode='22023',message='ESTIMATE_SETTINGS_INVALID_INPUT';
    end if;
    if (p_settings_patch->>'discount_amount_cents')::numeric > 2147483647 then
      raise exception using errcode='22023',message='ESTIMATE_SETTINGS_INVALID_INPUT';
    end if;
  end if;
  if p_settings_patch ? 'discount_steps' then
    if exists(select 1 from jsonb_array_elements(p_settings_patch->'discount_steps') x
      where jsonb_typeof(x)<>'number' or x::text !~ '^[0-9]+$') then
      raise exception using errcode='22023',message='ESTIMATE_SETTINGS_INVALID_INPUT';
    end if;
    if exists(select 1 from jsonb_array_elements(p_settings_patch->'discount_steps') x where x::text::numeric>10000) then
      raise exception using errcode='22023',message='ESTIMATE_SETTINGS_INVALID_INPUT';
    end if;
  end if;

  -- These existing gates include absent raw configuration and changes to the
  -- caller's tenant selection. Explicit row locks cover writers without gates.
  if not pg_catalog.pg_try_advisory_xact_lock_shared(pg_catalog.hashtextextended('estimate-create-actor:'||p_actor_user_id::text,0))
    or not pg_catalog.pg_try_advisory_xact_lock_shared(pg_catalog.hashtextextended('estimate-calculation:'||p_tenant_id::text,0)) then
    raise exception using errcode='40001',message='CONTEXT_CHANGED';
  end if;
  if not exists(select 1 from public.estimate_versions where id=p_version_id and tenant_id=p_tenant_id) then
    raise exception using errcode='P0001',message='ESTIMATE_NOT_FOUND';
  end if;
  perform t.id from public.tenants t where t.id=p_tenant_id and t.is_active for share nowait;
  if not found then raise exception using errcode='42501',message='ESTIMATE_WRITE_FORBIDDEN'; end if;
  select m.role into actor_role from public.tenant_memberships m
  where m.user_id=p_actor_user_id and m.tenant_id=p_tenant_id for share nowait;
  if not found or actor_role not in ('admin','engineer') then
    raise exception using errcode='42501',message='ESTIMATE_WRITE_FORBIDDEN';
  end if;
  select m.tenant_id into active_tenant from public.tenant_memberships m join public.tenants t on t.id=m.tenant_id and t.is_active
  where m.user_id=p_actor_user_id order by m.is_default desc,m.created_at asc limit 1;
  if active_tenant is distinct from p_tenant_id then
    raise exception using errcode='42501',message='ESTIMATE_WRITE_FORBIDDEN';
  end if;
  select v.* into version_row from public.estimate_versions v
  where v.id=p_version_id and v.tenant_id=p_tenant_id for update nowait;
  if not found then raise exception using errcode='P0001',message='ESTIMATE_NOT_FOUND'; end if;
  if version_row.status <> 'draft' then raise exception using errcode='42501',message='ESTIMATE_READ_ONLY'; end if;
  select p.* into project_row from public.estimate_projects p
  where p.id=version_row.project_id and p.tenant_id=p_tenant_id for share nowait;
  if not found or (project_row.user_id<>p_actor_user_id and actor_role<>'admin') then
    raise exception using errcode='42501',message='ESTIMATE_WRITE_FORBIDDEN';
  end if;
  if project_row.is_archived then raise exception using errcode='42501',message='ESTIMATE_READ_ONLY'; end if;
  if version_row.updated_at is distinct from p_expected_updated_at
    or version_row.content_revision is distinct from p_expected_content_revision then
    raise exception using errcode='40001',message='ESTIMATE_VERSION_CONFLICT';
  end if;
  select l.* into lease_row from public.draft_locks l
  where l.version_id=p_version_id and l.tenant_id=p_tenant_id for update nowait;
  if not found or lease_row.user_id is distinct from p_actor_user_id
    or p_draft_lock_session_id is null or lease_row.session_id is distinct from p_draft_lock_session_id
    or lease_row.expires_at is null or lease_row.expires_at<=clock_timestamp() then
    raise exception using errcode='40001',message='ESTIMATE_DRAFT_LOCK_REQUIRED';
  end if;
  perform i.id from public.estimate_items i where i.version_id=p_version_id and i.tenant_id=p_tenant_id
  order by i.id for update nowait;

  prospective:=jsonb_populate_record(version_row,p_settings_patch);
  if prospective.discount_mode='simple' and cardinality(prospective.discount_steps)<>0 then
    raise exception using errcode='22023',message='ESTIMATE_SETTINGS_INVALID_INPUT';
  end if;
  if prospective.discount_amount_cents is not null and (
    prospective.discount_mode <> 'simple'::public.estimate_discount_mode
    or cardinality(prospective.discount_steps) <> 0
  ) then
    raise exception using errcode='22023',message='ESTIMATE_SETTINGS_INVALID_INPUT';
  end if;
  projection_keys:=array['id','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents'];
  if version_row.calc_engine_version=1 then projection_keys:=projection_keys||array['tax_rate_bp']; end if;
  if exists(select 1 from jsonb_array_elements(p_line_projections) u where jsonb_typeof(u) is distinct from 'object'
    or not (u ?& projection_keys) or u-projection_keys <> '{}'::jsonb
    or jsonb_typeof(u->'id') is distinct from 'string'
    or u->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception using errcode='22023',message='ESTIMATE_SETTINGS_PROJECTION_MISMATCH';
  end if;
  if exists(select 1 from jsonb_array_elements(p_line_projections) u cross join lateral jsonb_each(u-'id') x
    where jsonb_typeof(x.value)<>'number' or x.value::text !~ '^[0-9]+$') then
    raise exception using errcode='22023',message='ESTIMATE_SETTINGS_PROJECTION_MISMATCH';
  end if;
  if exists(select 1 from jsonb_array_elements(p_line_projections) u cross join lateral jsonb_each(u-'id') x
    where x.value::text::numeric>2147483647 or x.key='tax_rate_bp' and x.value::text::numeric>10000) then
    raise exception using errcode='22023',message='ESTIMATE_SETTINGS_PROJECTION_MISMATCH';
  end if;
  select coalesce(array_agg((u->>'id')::uuid order by (u->>'id')::uuid),'{}'::uuid[]) into projected_ids
  from jsonb_array_elements(p_line_projections) u;
  select coalesce(array_agg(i.id order by i.id),'{}'::uuid[]) into actual_ids from public.estimate_items i
  where i.version_id=p_version_id and i.tenant_id=p_tenant_id and i.item_type='line';
  if projected_ids is distinct from actual_ids then
    raise exception using errcode='22023',message='ESTIMATE_SETTINGS_PROJECTION_MISMATCH';
  end if;
  ht:=(p_totals->>'total_ht_cents')::bigint;
  tax:=(p_totals->>'total_tax_cents')::bigint;
  ttc:=(p_totals->>'total_ttc_cents')::bigint;
  adjustment:=(p_totals->>'rounding_adjustment_cents')::bigint;
  if ht+tax<>ttc or tax-adjustment<0
    or cardinality(actual_ids)=0 and (ht<>0 or tax<>0 or ttc<>0 or adjustment<>0)
    or exists(select 1 from jsonb_array_elements(p_line_projections) u
      where (u->>'line_total_ht_cents')::bigint+(u->>'line_tax_cents')::bigint<>(u->>'line_total_ttc_cents')::bigint
        or version_row.calc_engine_version=1 and (u->>'tax_rate_bp')::integer is distinct from prospective.tax_rate_bp)
    or prospective.contractor_role='subcontractor' and (tax<>0 or adjustment<>0 or
      exists(select 1 from jsonb_array_elements(p_line_projections) u where (u->>'line_tax_cents')::bigint<>0))
    or version_row.calc_engine_version=2 and exists(
      select 1 from (select coalesce(sum((u->>'line_total_ht_cents')::bigint),0) as h,
        coalesce(sum((u->>'line_tax_cents')::bigint),0) as t,coalesce(sum((u->>'line_total_ttc_cents')::bigint),0) as c
        from jsonb_array_elements(p_line_projections) u) sums where sums.h<>ht or sums.t<>tax or sums.c<>ttc)
  then
    raise exception using errcode='22023',message='ESTIMATE_SETTINGS_PROJECTION_MISMATCH';
  end if;

  select coalesce(array_agg(distinct r.id order by r.id),'{}'::uuid[]) into role_ids
  from public.estimate_items i cross join lateral unnest(array[i.labor_role_id,i.labor_role_atelier_id,i.labor_role_chantier_id]) r(id)
  where i.version_id=p_version_id and i.tenant_id=p_tenant_id and i.item_type='line' and r.id is not null;
  perform l.id from public.labor_roles l where l.id=any(role_ids) and l.tenant_id=p_tenant_id
  order by l.id for share nowait;
  if version_row.calc_engine_version=2 and exists(select 1 from unnest(role_ids) r(id)
    where not exists(select 1 from public.labor_roles l where l.id=r.id and l.tenant_id=p_tenant_id and l.user_id=project_row.user_id)) then
    raise exception using errcode='40001',message='CONTEXT_CHANGED';
  end if;
  if prospective.margin_mode='tiered' then
    perform m.id from public.margin_tiers m where m.tenant_id=p_tenant_id order by m.threshold_cents,m.position,m.id for share nowait;
  end if;
  perform f.id from public.feature_flags f where f.tenant_id=p_tenant_id and f.flag_key='EST_031_LABOR_SPLIT' for share nowait;
  select jsonb_build_object(
    'labor_roles',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'tenant_id',l.tenant_id,'user_id',l.user_id,'hourly_rate_cents',l.hourly_rate_cents) order by l.id)
      from public.labor_roles l where l.id=any(role_ids) and l.tenant_id=p_tenant_id and l.user_id=project_row.user_id),'[]'),
    'margin_tiers',case when prospective.margin_mode='tiered' then coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'threshold_cents',m.threshold_cents,'multiplier',m.multiplier,'position',m.position) order by m.threshold_cents,m.position,m.id)
      from public.margin_tiers m where m.tenant_id=p_tenant_id),'[]') else '[]'::jsonb end,
    'labor_split_flag',(select jsonb_build_object('id',f.id,'enabled',f.enabled) from public.feature_flags f where f.tenant_id=p_tenant_id and f.flag_key='EST_031_LABOR_SPLIT')) into raw_dependencies;
  if raw_dependencies is distinct from p_expected_dependencies then
    raise exception using errcode='40001',message='CONTEXT_CHANGED';
  end if;
  if lease_row.expires_at<=clock_timestamp() then
    raise exception using errcode='40001',message='ESTIMATE_DRAFT_LOCK_REQUIRED';
  end if;

  previous_marker:=pg_catalog.current_setting('miaouffrage.estimate_settings_atomic',true);
  perform pg_catalog.set_config('miaouffrage.estimate_settings_atomic',p_version_id::text,true);
  update public.estimate_items i
  set pu_ht_cents=projected.pu_ht_cents,line_total_ht_cents=projected.line_total_ht_cents,
    line_tax_cents=projected.line_tax_cents,line_total_ttc_cents=projected.line_total_ttc_cents,
    tax_rate_bp=case when version_row.calc_engine_version=1 then projected.tax_rate_bp else i.tax_rate_bp end
  from jsonb_populate_recordset(null::public.estimate_items,p_line_projections) projected
  where i.id=projected.id and i.version_id=p_version_id and i.tenant_id=p_tenant_id and i.item_type='line'
    and row(i.pu_ht_cents,i.line_total_ht_cents,i.line_tax_cents,i.line_total_ttc_cents,i.tax_rate_bp)
      is distinct from row(projected.pu_ht_cents,projected.line_total_ht_cents,projected.line_tax_cents,projected.line_total_ttc_cents,
        case when version_row.calc_engine_version=1 then projected.tax_rate_bp else i.tax_rate_bp end);
  update public.estimate_versions v
  set title=prospective.title,exclusions=prospective.exclusions,date_devis=prospective.date_devis,validite_jours=prospective.validite_jours,
    currency=prospective.currency,margin_multiplier=prospective.margin_multiplier,margin_mode=prospective.margin_mode,margin_bp=prospective.margin_bp,
    discount_bp=prospective.discount_bp,discount_amount_cents=prospective.discount_amount_cents,
    discount_mode=prospective.discount_mode,discount_steps=prospective.discount_steps,
    global_coefficient=prospective.global_coefficient,tax_rate_bp=prospective.tax_rate_bp,contractor_role=prospective.contractor_role,
    rounding_mode=prospective.rounding_mode,rounding_step_cents=prospective.rounding_step_cents,max_section_depth=prospective.max_section_depth,
    total_ht_cents=ht::integer,total_tax_cents=tax::integer,total_ttc_cents=ttc::integer,rounding_adjustment_cents=adjustment::integer
  where v.id=p_version_id and v.tenant_id=p_tenant_id
    and row(v.title,v.exclusions,v.date_devis,v.validite_jours,v.currency,v.margin_multiplier,v.margin_mode,v.margin_bp,v.discount_bp,v.discount_amount_cents,
      v.discount_mode,v.discount_steps,v.global_coefficient,v.tax_rate_bp,v.contractor_role,v.rounding_mode,v.rounding_step_cents,
      v.max_section_depth,v.total_ht_cents,v.total_tax_cents,v.total_ttc_cents,v.rounding_adjustment_cents)
      is distinct from row(prospective.title,prospective.exclusions,prospective.date_devis,prospective.validite_jours,prospective.currency,
        prospective.margin_multiplier,prospective.margin_mode,prospective.margin_bp,prospective.discount_bp,prospective.discount_amount_cents,prospective.discount_mode,
        prospective.discount_steps,prospective.global_coefficient,prospective.tax_rate_bp,prospective.contractor_role,prospective.rounding_mode,
        prospective.rounding_step_cents,prospective.max_section_depth,ht::integer,tax::integer,ttc::integer,adjustment::integer);
  if lease_row.expires_at<=clock_timestamp() then
    raise exception using errcode='40001',message='ESTIMATE_DRAFT_LOCK_REQUIRED';
  end if;
  perform pg_catalog.set_config('miaouffrage.estimate_settings_atomic',coalesce(previous_marker,''),true);
  select v.* into version_row from public.estimate_versions v where v.id=p_version_id and v.tenant_id=p_tenant_id;
  select coalesce(jsonb_agg(to_jsonb(i) order by i.position,i.id),'[]') into all_items from public.estimate_items i
  where i.version_id=p_version_id and i.tenant_id=p_tenant_id;
  return jsonb_build_object('version',to_jsonb(version_row),'items',all_items);
exception when lock_not_available or deadlock_detected then
  raise exception using errcode='40001',message='ESTIMATE_VERSION_CONFLICT';
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
    raise exception using errcode='22023',message='ESTIMATE_SETTINGS_INVALID_INPUT';
end;
$function$;

CREATE OR REPLACE FUNCTION public.guard_estimate_version_workflow_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.calc_engine_version is distinct from old.calc_engine_version then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_CALC_ENGINE_VERSION_IMMUTABLE';
  end if;

  if (
      new.calc_snapshot_content_revision is distinct from
        old.calc_snapshot_content_revision
      or new.calc_snapshot_context is distinct from old.calc_snapshot_context
    )
    and not (
      (
        current_user = 'service_role'
        and coalesce(
          pg_catalog.current_setting(
            'miaouffrage.estimate_v2_snapshot_freeze',
            true
          ),
          ''
        ) = 'on'
      )
      or (
        pg_trigger_depth() > 1
        and coalesce(
          pg_catalog.current_setting(
            'miaouffrage.estimate_v2_snapshot_invalidation',
            true
          ),
          ''
        ) = 'on'
        and new.calc_snapshot_content_revision is null
        and new.calc_snapshot_context is null
      )
    )
  then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_V2_SNAPSHOT_IS_MANAGED';
  end if;

  if (
    new.status is distinct from old.status
    or new.seal_hash is distinct from old.seal_hash
  ) and current_user <> 'service_role' then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_STATUS_REQUIRES_TRUSTED_WORKFLOW';
  end if;

  if new.content_revision is distinct from old.content_revision
    and pg_trigger_depth() = 1
  then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_CONTENT_REVISION_IS_MANAGED';
  end if;

  if new.tenant_id is distinct from old.tenant_id
    or new.project_id is distinct from old.project_id
    or new.version_number is distinct from old.version_number
    or new.title is distinct from old.title
    or new.exclusions is distinct from old.exclusions
    or new.date_devis is distinct from old.date_devis
    or new.validite_jours is distinct from old.validite_jours
    or new.margin_multiplier is distinct from old.margin_multiplier
    or new.margin_mode is distinct from old.margin_mode
    or new.currency is distinct from old.currency
    or new.margin_bp is distinct from old.margin_bp
    or new.discount_bp is distinct from old.discount_bp
    or new.discount_amount_cents is distinct from old.discount_amount_cents
    or new.discount_mode is distinct from old.discount_mode
    or new.discount_steps is distinct from old.discount_steps
    or new.global_coefficient is distinct from old.global_coefficient
    or new.max_section_depth is distinct from old.max_section_depth
    or new.tax_rate_bp is distinct from old.tax_rate_bp
    or new.rounding_mode is distinct from old.rounding_mode
    or new.rounding_step_cents is distinct from old.rounding_step_cents
    or new.total_ht_cents is distinct from old.total_ht_cents
    or new.total_tax_cents is distinct from old.total_tax_cents
    or (
      new.rounding_adjustment_cents is distinct from old.rounding_adjustment_cents
      and current_user = 'service_role'
      and old.status = 'draft'
      and new.status = 'draft'
      and coalesce(
        pg_catalog.current_setting('miaouffrage.estimate_settings_atomic', true),
        ''
      ) = new.id::text
    )
    or new.total_ttc_cents is distinct from old.total_ttc_cents
    or new.parent_version_id is distinct from old.parent_version_id
    or new.variant_label is distinct from old.variant_label
    or new.calc_engine_version is distinct from old.calc_engine_version
    or new.contractor_role is distinct from old.contractor_role
    or new.calc_snapshot_context is distinct from old.calc_snapshot_context
  then
    new.content_revision := old.content_revision + 1;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.persist_estimate_creation_atomic(p_tenant_id uuid, p_actor_user_id uuid, p_project_id uuid, p_project_payload jsonb, p_version_payload jsonb, p_items jsonb, p_import_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  actor_user_id uuid := p_actor_user_id;
  actor_role public.tenant_role;
  project_row public.estimate_projects%rowtype;
  version_row public.estimate_versions%rowtype;
  import_row public.dpgf_imports%rowtype;
  import_claimed_rows integer := 0;
  item_total_ht bigint := 0;
  item_total_tax bigint := 0;
  item_total_ttc bigint := 0;
  next_version_number integer;
  version_contractor_role text;
  previous_insert_contract text;
begin
  if current_user <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'SERVICE_ROLE_REQUIRED';
  end if;

  select membership.role
    into actor_role
  from public.tenant_memberships membership
  join public.tenants tenant
    on tenant.id = membership.tenant_id
   and tenant.is_active
  where membership.tenant_id = p_tenant_id
    and membership.user_id = actor_user_id;

  if actor_user_id is null
    or p_tenant_id is null
    or actor_role is null
    or actor_role not in (
      'admin'::public.tenant_role,
      'engineer'::public.tenant_role
    )
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_CREATION_ROLE_REQUIRED';
  end if;

  if p_version_payload is null
    or jsonb_typeof(p_version_payload) <> 'object'
    or p_version_payload - array[
      'id',
      'title',
      'date_devis',
      'validite_jours',
      'margin_multiplier',
      'margin_mode',
      'currency',
      'margin_bp',
      'discount_bp',
      'discount_amount_cents',
      'discount_mode',
      'discount_steps',
      'global_coefficient',
      'tax_rate_bp',
      'rounding_mode',
      'rounding_step_cents',
      'max_section_depth',
      'calc_engine_version',
      'contractor_role',
      'total_ht_cents',
      'total_tax_cents',
      'total_ttc_cents'
    ] <> '{}'::jsonb
    or coalesce(
      (p_version_payload->>'calc_engine_version')::smallint,
      2
    ) <> 2
    or coalesce(
      nullif(btrim(p_version_payload->>'contractor_role'), ''),
      'principal'
    ) not in ('principal', 'subcontractor')
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_PAYLOAD_INVALID';
  end if;

  if p_version_payload ? 'discount_amount_cents'
    and p_version_payload->'discount_amount_cents' <> 'null'::jsonb then
    if jsonb_typeof(p_version_payload->'discount_amount_cents') <> 'number'
      or p_version_payload->>'discount_amount_cents' !~ '^[0-9]+$' then
      raise exception using errcode='22023',message='ESTIMATE_VERSION_PAYLOAD_INVALID';
    end if;
    if (p_version_payload->>'discount_amount_cents')::numeric > 2147483647
      or p_version_payload->>'discount_mode' is distinct from 'simple'
      or coalesce(jsonb_array_length(p_version_payload->'discount_steps'),0) <> 0 then
      raise exception using errcode='22023',message='ESTIMATE_VERSION_PAYLOAD_INVALID';
    end if;
  end if;

  version_contractor_role := coalesce(
    nullif(btrim(p_version_payload->>'contractor_role'), ''),
    'principal'
  )::text;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_ITEMS_PAYLOAD_INVALID';
  end if;

  -- The FK and hierarchy trigger are immediate, so make the accepted payload
  -- order explicit before any project/import mutation: every child must follow
  -- its section parent and every payload id must be unique and concrete.
  if exists (
    with payload_item as (
      select
        entry.ordinality,
        (entry.value->>'id')::uuid as id,
        (entry.value->>'parent_id')::uuid as parent_id,
        entry.value->>'item_type' as item_type
      from jsonb_array_elements(p_items) with ordinality
        as entry(value, ordinality)
    )
    select 1
    from payload_item as child
    left join payload_item as parent on parent.id = child.parent_id
    where child.id is null
      or child.item_type is null
      or child.item_type not in ('section', 'line')
      or (child.item_type = 'line' and child.parent_id is null)
      or (
        child.parent_id is not null
        and (
          parent.id is null
          or parent.item_type <> 'section'
          or parent.ordinality >= child.ordinality
        )
      )
    union all
    select 1
    from payload_item
    group by payload_item.id
    having count(*) > 1
  ) then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_ITEMS_HIERARCHY_INVALID';
  end if;

  if p_import_id is not null then
    select source_import.*
      into import_row
    from public.dpgf_imports as source_import
    where source_import.id = p_import_id
      and source_import.tenant_id = p_tenant_id
      and (
        source_import.user_id = actor_user_id
        or actor_role = 'admin'::public.tenant_role
      )
    for update;

    if import_row.id is null then
      raise exception using
        errcode = '42501',
        message = 'DPGF_IMPORT_NOT_WRITABLE';
    end if;

    if import_row.project_id is not null
      and (
        p_project_id is null
        or import_row.project_id <> p_project_id
      )
    then
      raise exception using
        errcode = '23505',
        message = 'DPGF_IMPORT_ALREADY_LINKED';
    end if;
  end if;

  if (p_version_payload->>'total_ht_cents') is null
    or (p_version_payload->>'total_tax_cents') is null
    or (p_version_payload->>'total_ttc_cents') is null
    or (p_version_payload->>'total_ht_cents')::integer < 0
    or (p_version_payload->>'total_tax_cents')::integer < 0
    or (p_version_payload->>'total_ttc_cents')::integer < 0
    or (p_version_payload->>'total_ttc_cents')::integer <>
      (p_version_payload->>'total_ht_cents')::integer
      + (p_version_payload->>'total_tax_cents')::integer
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_TOTALS_INVALID';
  end if;

  if version_contractor_role = 'subcontractor'
    and (
      (p_version_payload->>'total_tax_cents')::integer <> 0
      or (p_version_payload->>'total_ttc_cents')::integer <>
        (p_version_payload->>'total_ht_cents')::integer
    )
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_REVERSE_CHARGE_TOTALS_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(
      item_type public.estimate_item_type,
      line_total_ht_cents integer,
      line_tax_cents integer,
      line_total_ttc_cents integer
    )
    where item.item_type = 'line'
      and (
        item.line_total_ht_cents is null
        or item.line_tax_cents is null
        or item.line_total_ttc_cents is null
        or item.line_total_ht_cents < 0
        or item.line_tax_cents < 0
        or item.line_total_ttc_cents < 0
        or item.line_total_ttc_cents <>
          item.line_total_ht_cents + item.line_tax_cents
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_ITEM_TOTALS_INVALID';
  end if;

  select
    coalesce(sum(item.line_total_ht_cents), 0),
    coalesce(sum(item.line_tax_cents), 0),
    coalesce(sum(item.line_total_ttc_cents), 0)
    into item_total_ht, item_total_tax, item_total_ttc
  from jsonb_to_recordset(p_items) as item(
    item_type public.estimate_item_type,
    line_total_ht_cents integer,
    line_tax_cents integer,
    line_total_ttc_cents integer
  )
  where item.item_type = 'line'::public.estimate_item_type;

  if item_total_ht <> (p_version_payload->>'total_ht_cents')::integer
    or item_total_tax <> (p_version_payload->>'total_tax_cents')::integer
    or item_total_ttc <> (p_version_payload->>'total_ttc_cents')::integer
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_TOTALS_DO_NOT_MATCH_ITEMS';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(
      category_id uuid,
      supply_type_id uuid,
      selected_supplier_price_id uuid,
      source_job_id uuid
    )
    left join public.estimate_categories category
      on category.id = item.category_id
     and category.tenant_id = p_tenant_id
    left join public.supply_types supply_type
      on supply_type.id = item.supply_type_id
     and supply_type.tenant_id = p_tenant_id
    left join public.supplier_pricebook supplier_price
      on supplier_price.id = item.selected_supplier_price_id
     and supplier_price.tenant_id = p_tenant_id
    left join public.takeoff_jobs source_job
      on source_job.id = item.source_job_id
     and source_job.tenant_id = p_tenant_id
    where (item.category_id is not null and category.id is null)
      or (item.supply_type_id is not null and supply_type.id is null)
      or (
        item.selected_supplier_price_id is not null
        and supplier_price.id is null
      )
      or (item.source_job_id is not null and source_job.id is null)
  ) then
    raise exception using
      errcode = '23503',
      message = 'ESTIMATE_ITEM_REFERENCE_TENANT_MISMATCH';
  end if;

  if p_project_id is null then
    if p_project_payload is null
      or jsonb_typeof(p_project_payload) <> 'object'
      or p_project_payload - array[
        'id',
        'name',
        'reference',
        'client_name',
        'notes'
      ] <> '{}'::jsonb
      or btrim(coalesce(p_project_payload->>'name', '')) = ''
    then
      raise exception using
        errcode = '22023',
        message = 'ESTIMATE_PROJECT_PAYLOAD_INVALID';
    end if;

    insert into public.estimate_projects (
      id,
      tenant_id,
      user_id,
      name,
      reference,
      client_name,
      notes,
      is_archived
    )
    values (
      (p_project_payload->>'id')::uuid,
      p_tenant_id,
      actor_user_id,
      btrim(p_project_payload->>'name'),
      nullif(btrim(p_project_payload->>'reference'), ''),
      nullif(btrim(p_project_payload->>'client_name'), ''),
      nullif(btrim(p_project_payload->>'notes'), ''),
      false
    )
    returning * into project_row;

    next_version_number := 1;
  else
    if p_project_payload is not null then
      raise exception using
        errcode = '22023',
        message = 'ESTIMATE_PROJECT_SELECTOR_INVALID';
    end if;

    select project.*
      into project_row
    from public.estimate_projects as project
    where project.id = p_project_id
      and project.tenant_id = p_tenant_id
    for update;

    if project_row.id is null
      or project_row.is_archived
      or (
        project_row.user_id <> actor_user_id
        and actor_role <> 'admin'::public.tenant_role
      )
    then
      raise exception using
        errcode = '42501',
        message = 'ESTIMATE_PROJECT_NOT_WRITABLE';
    end if;

    select coalesce(max(version.version_number), 0) + 1
      into next_version_number
    from public.estimate_versions as version
    where version.project_id = project_row.id
      and version.tenant_id = p_tenant_id;
  end if;

  perform role.id
  from public.labor_roles role
  where role.id in (
    select referenced.role_id
    from (
      select item.labor_role_id as role_id
      from jsonb_to_recordset(p_items) as item(labor_role_id uuid)
      union
      select item.labor_role_atelier_id
      from jsonb_to_recordset(p_items) as item(labor_role_atelier_id uuid)
      union
      select item.labor_role_chantier_id
      from jsonb_to_recordset(p_items) as item(labor_role_chantier_id uuid)
    ) referenced
    where referenced.role_id is not null
  )
  order by role.id
  for share of role;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(
      labor_role_id uuid,
      labor_role_atelier_id uuid,
      labor_role_chantier_id uuid
    )
    left join public.labor_roles labor_role
      on labor_role.id = item.labor_role_id
     and labor_role.tenant_id = p_tenant_id
     and labor_role.user_id = project_row.user_id
    left join public.labor_roles atelier_role
      on atelier_role.id = item.labor_role_atelier_id
     and atelier_role.tenant_id = p_tenant_id
     and atelier_role.user_id = project_row.user_id
    left join public.labor_roles chantier_role
      on chantier_role.id = item.labor_role_chantier_id
     and chantier_role.tenant_id = p_tenant_id
     and chantier_role.user_id = project_row.user_id
    where (item.labor_role_id is not null and labor_role.id is null)
      or (item.labor_role_atelier_id is not null and atelier_role.id is null)
      or (item.labor_role_chantier_id is not null and chantier_role.id is null)
  ) then
    raise exception using
      errcode = '23503',
      message = 'ESTIMATE_LABOR_ROLE_OWNER_MISMATCH';
  end if;

  if import_row.id is not null and import_row.project_id is null then
    update public.dpgf_imports as source_import
    set project_id = project_row.id
    where source_import.id = import_row.id
      and source_import.tenant_id = p_tenant_id
      and source_import.project_id is null;

    get diagnostics import_claimed_rows = row_count;
    if import_claimed_rows <> 1 then
      raise exception using
        errcode = '23505',
        message = 'DPGF_IMPORT_ALREADY_LINKED';
    end if;
  end if;

  previous_insert_contract := coalesce(
    pg_catalog.current_setting(
      'miaouffrage.estimate_version_insert_contract',
      true
    ),
    ''
  );
  perform pg_catalog.set_config(
    'miaouffrage.estimate_version_insert_contract',
    'canonical_v2',
    true
  );

  insert into public.estimate_versions (
    id,
    tenant_id,
    project_id,
    version_number,
    status,
    title,
    date_devis,
    validite_jours,
    margin_multiplier,
    margin_mode,
    currency,
    margin_bp,
    discount_bp,
    discount_amount_cents,
    discount_mode,
    discount_steps,
    global_coefficient,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    max_section_depth,
    calc_engine_version,
    contractor_role,
    total_ht_cents,
    total_tax_cents,
    total_ttc_cents
  )
  values (
    (p_version_payload->>'id')::uuid,
    p_tenant_id,
    project_row.id,
    next_version_number,
    'draft'::public.estimate_status,
    nullif(btrim(p_version_payload->>'title'), ''),
    (p_version_payload->>'date_devis')::date,
    (p_version_payload->>'validite_jours')::integer,
    (p_version_payload->>'margin_multiplier')::numeric,
    (p_version_payload->>'margin_mode')::public.estimate_margin_mode,
    p_version_payload->>'currency',
    (p_version_payload->>'margin_bp')::integer,
    (p_version_payload->>'discount_bp')::integer,
    (p_version_payload->>'discount_amount_cents')::integer,
    (p_version_payload->>'discount_mode')::public.estimate_discount_mode,
    array(
      select discount_step.value::integer
      from jsonb_array_elements_text(p_version_payload->'discount_steps')
        as discount_step(value)
    ),
    (p_version_payload->>'global_coefficient')::numeric,
    (p_version_payload->>'tax_rate_bp')::integer,
    (p_version_payload->>'rounding_mode')::public.estimate_rounding_mode,
    (p_version_payload->>'rounding_step_cents')::integer,
    (p_version_payload->>'max_section_depth')::integer,
    coalesce((p_version_payload->>'calc_engine_version')::smallint, 2),
    version_contractor_role::text,
    (p_version_payload->>'total_ht_cents')::integer,
    (p_version_payload->>'total_tax_cents')::integer,
    (p_version_payload->>'total_ttc_cents')::integer
  )
  returning * into version_row;

  perform pg_catalog.set_config(
    'miaouffrage.estimate_version_insert_contract',
    previous_insert_contract,
    true
  );

  if jsonb_array_length(p_items) > 0 then
    insert into public.estimate_items (
      id,
      tenant_id,
      version_id,
      parent_id,
      item_type,
      position,
      title,
      description,
      quantity,
      unit_price_ht_cents,
      tax_rate_bp,
      k_fo,
      h_mo,
      h_mo_majoration,
      k_mo,
      h_mo_atelier,
      k_mo_atelier,
      labor_role_atelier_id,
      h_mo_chantier,
      k_mo_chantier,
      labor_role_chantier_id,
      pu_ht_cents,
      labor_role_id,
      category_id,
      supply_type_id,
      selected_supplier_price_id,
      source_provider,
      source_job_id,
      source_file_name,
      source_page,
      source_metadata,
      line_total_ht_cents,
      line_tax_cents,
      line_total_ttc_cents
    )
    select
      coalesce(item.id, gen_random_uuid()),
      p_tenant_id,
      version_row.id,
      item.parent_id,
      item.item_type,
      item.position,
      item.title,
      item.description,
      item.quantity,
      item.unit_price_ht_cents,
      item.tax_rate_bp,
      item.k_fo,
      item.h_mo,
      coalesce(item.h_mo_majoration, 1),
      item.k_mo,
      item.h_mo_atelier,
      coalesce(item.k_mo_atelier, 1),
      item.labor_role_atelier_id,
      item.h_mo_chantier,
      coalesce(item.k_mo_chantier, 1),
      item.labor_role_chantier_id,
      item.pu_ht_cents,
      item.labor_role_id,
      item.category_id,
      item.supply_type_id,
      item.selected_supplier_price_id,
      item.source_provider,
      item.source_job_id,
      item.source_file_name,
      item.source_page,
      coalesce(item.source_metadata, '{}'::jsonb),
      item.line_total_ht_cents,
      item.line_tax_cents,
      item.line_total_ttc_cents
    from jsonb_to_recordset(p_items) as item(
      id uuid,
      parent_id uuid,
      item_type public.estimate_item_type,
      position integer,
      title text,
      description text,
      quantity numeric,
      unit_price_ht_cents integer,
      tax_rate_bp integer,
      k_fo numeric,
      h_mo numeric,
      h_mo_majoration numeric,
      k_mo numeric,
      h_mo_atelier numeric,
      k_mo_atelier numeric,
      labor_role_atelier_id uuid,
      h_mo_chantier numeric,
      k_mo_chantier numeric,
      labor_role_chantier_id uuid,
      pu_ht_cents integer,
      labor_role_id uuid,
      category_id uuid,
      supply_type_id uuid,
      selected_supplier_price_id uuid,
      source_provider text,
      source_job_id uuid,
      source_file_name text,
      source_page integer,
      source_metadata jsonb,
      line_total_ht_cents integer,
      line_tax_cents integer,
      line_total_ttc_cents integer
    );
  end if;

  return jsonb_build_object(
    'project', to_jsonb(project_row),
    'version', to_jsonb(version_row)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.duplicate_estimate_version_without_product_id(source_version_id uuid, as_variant boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_user_id uuid := (select auth.uid());
  source_version public.estimate_versions%rowtype;
  new_version_id uuid := gen_random_uuid();
  new_version_number integer;
  variant_parent_id uuid := null;
  next_variant_index integer := 0;
  next_variant_label text := null;
  item_id_map jsonb := '{}'::jsonb;
  previous_insert_contract text;
begin
  if actor_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'AUTHENTICATION_REQUIRED';
  end if;

  select v.*
    into source_version
  from public.estimate_versions v
  join public.estimate_projects p on p.id = v.project_id
    and p.tenant_id = v.tenant_id
  join public.tenants tenant
    on tenant.id = p.tenant_id
    and tenant.is_active
  join public.tenant_memberships membership
    on membership.tenant_id = p.tenant_id
    and membership.user_id = actor_user_id
  where v.id = duplicate_estimate_version_without_product_id.source_version_id
    and not p.is_archived
    and membership.role in (
      'admin'::public.tenant_role,
      'engineer'::public.tenant_role
    )
    and (
      p.user_id = actor_user_id
      or membership.role = 'admin'::public.tenant_role
    )
  for update of p, v;

  if not found then
    raise exception 'Estimate version not found or access denied';
  end if;

  select coalesce(max(version_number), 0) + 1
    into new_version_number
  from public.estimate_versions
  where project_id = source_version.project_id;

  if coalesce(as_variant, false) then
    variant_parent_id := duplicate_estimate_version_without_product_id.source_version_id;

    loop
      next_variant_index := next_variant_index + 1;
      next_variant_label := public.estimate_variant_label_from_index(next_variant_index);

      exit when not exists (
        select 1
        from public.estimate_versions existing_variant
        where existing_variant.parent_version_id = variant_parent_id
          and existing_variant.variant_label = next_variant_label
      );
    end loop;
  end if;

  previous_insert_contract := coalesce(
    pg_catalog.current_setting(
      'miaouffrage.estimate_version_insert_contract',
      true
    ),
    ''
  );
  perform pg_catalog.set_config(
    'miaouffrage.estimate_version_insert_contract',
    'duplicate_source',
    true
  );

  insert into public.estimate_versions (
    id,
    tenant_id,
    project_id,
    version_number,
    status,
    title,
    exclusions,
    date_devis,
    validite_jours,
    margin_multiplier,
    margin_mode,
    currency,
    margin_bp,
    discount_bp,
    discount_amount_cents,
    discount_mode,
    discount_steps,
    global_coefficient,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    calc_engine_version,
    contractor_role,
    total_ht_cents,
    total_tax_cents,
    total_ttc_cents,
    parent_version_id,
    variant_label,
    max_section_depth
  )
  values (
    new_version_id,
    source_version.tenant_id,
    source_version.project_id,
    new_version_number,
    'draft',
    source_version.title,
    source_version.exclusions,
    source_version.date_devis,
    source_version.validite_jours,
    source_version.margin_multiplier,
    source_version.margin_mode,
    source_version.currency,
    source_version.margin_bp,
    source_version.discount_bp,
    source_version.discount_amount_cents,
    source_version.discount_mode,
    source_version.discount_steps,
    source_version.global_coefficient,
    source_version.tax_rate_bp,
    source_version.rounding_mode,
    source_version.rounding_step_cents,
    source_version.calc_engine_version,
    source_version.contractor_role,
    source_version.total_ht_cents,
    source_version.total_tax_cents,
    source_version.total_ttc_cents,
    variant_parent_id,
    next_variant_label,
    source_version.max_section_depth
  );

  perform pg_catalog.set_config(
    'miaouffrage.estimate_version_insert_contract',
    previous_insert_contract,
    true
  );

  select coalesce(
    jsonb_object_agg(item.id::text, gen_random_uuid()::text),
    '{}'::jsonb
  )
    into item_id_map
  from public.estimate_items as item
  where item.version_id = duplicate_estimate_version_without_product_id.source_version_id
    and item.tenant_id = source_version.tenant_id;

  with recursive source_item_hierarchy as (
    select
      root.id,
      root.parent_id,
      0 as depth
    from public.estimate_items root
    where root.version_id = duplicate_estimate_version_without_product_id.source_version_id
      and root.parent_id is null

    union all

    select
      child.id,
      child.parent_id,
      parent.depth + 1
    from public.estimate_items child
    join source_item_hierarchy parent on parent.id = child.parent_id
    where child.version_id = duplicate_estimate_version_without_product_id.source_version_id
  )
  insert into public.estimate_items (
    id,
    tenant_id,
    version_id,
    parent_id,
    item_type,
    position,
    title,
    description,
    aid,
    quantity,
    unit_price_ht_cents,
    tax_rate_bp,
    k_fo,
    h_mo,
    h_mo_majoration,
    k_mo,
    h_mo_atelier,
    k_mo_atelier,
    labor_role_atelier_id,
    h_mo_chantier,
    k_mo_chantier,
    labor_role_chantier_id,
    pu_ht_cents,
    labor_role_id,
    category_id,
    supply_type_id,
    selected_supplier_price_id,
    source_provider,
    source_job_id,
    source_file_name,
    source_page,
    source_metadata,
    line_total_ht_cents,
    line_tax_cents,
    line_total_ttc_cents
  )
  select
    (item_id_map->>hierarchy.id::text)::uuid,
    source_version.tenant_id,
    new_version_id,
    (item_id_map->>src.parent_id::text)::uuid,
    src.item_type,
    src.position,
    src.title,
    src.description,
    src.aid,
    src.quantity,
    src.unit_price_ht_cents,
    src.tax_rate_bp,
    src.k_fo,
    src.h_mo,
    src.h_mo_majoration,
    src.k_mo,
    src.h_mo_atelier,
    src.k_mo_atelier,
    src.labor_role_atelier_id,
    src.h_mo_chantier,
    src.k_mo_chantier,
    src.labor_role_chantier_id,
    src.pu_ht_cents,
    src.labor_role_id,
    src.category_id,
    src.supply_type_id,
    src.selected_supplier_price_id,
    src.source_provider,
    src.source_job_id,
    src.source_file_name,
    src.source_page,
    coalesce(src.source_metadata, '{}'::jsonb),
    src.line_total_ht_cents,
    src.line_tax_cents,
    src.line_total_ttc_cents
  from source_item_hierarchy hierarchy
  join public.estimate_items src on src.id = hierarchy.id
  order by hierarchy.depth asc, src.position asc, src.id asc;

  with carry_over_takeoff_jobs as materialized (
    select
      job.id as takeoff_job_id,
      job.estimate_version_id as provenance_source_version_id
    from public.takeoff_jobs job
    where job.tenant_id = source_version.tenant_id
      and (
        job.estimate_version_id = duplicate_estimate_version_without_product_id.source_version_id
        or exists (
          select 1
          from public.takeoff_version_links inherited_link
          where inherited_link.tenant_id = source_version.tenant_id
            and inherited_link.takeoff_job_id = job.id
            and inherited_link.target_version_id =
              duplicate_estimate_version_without_product_id.source_version_id
        )
        or exists (
          select 1
          from public.takeoff_dpgf_review_decisions decision
          where decision.tenant_id = source_version.tenant_id
            and decision.takeoff_job_id = job.id
            and decision.version_id =
              duplicate_estimate_version_without_product_id.source_version_id
        )
      )
    order by job.id
    for share of job
  )
  insert into public.takeoff_version_links (
    tenant_id,
    takeoff_job_id,
    source_version_id,
    target_version_id,
    linked_at,
    linked_by
  )
  select
    source_version.tenant_id,
    candidate.takeoff_job_id,
    candidate.provenance_source_version_id,
    new_version_id,
    now(),
    null
  from carry_over_takeoff_jobs candidate
  on conflict (takeoff_job_id, target_version_id) do nothing;

  insert into public.takeoff_dpgf_review_decisions (
    id,
    tenant_id,
    version_id,
    takeoff_job_id,
    estimate_item_id,
    review_reference,
    line_label,
    line_position,
    source_file_name,
    source_page,
    carried_over_from_version_id,
    carried_over_at,
    decision,
    reason,
    decided_at,
    updated_at,
    decided_by
  )
  select
    gen_random_uuid(),
    src.tenant_id,
    new_version_id,
    src.takeoff_job_id,
    (item_id_map->>src.estimate_item_id::text)::uuid,
    src.review_reference,
    src.line_label,
    src.line_position,
    src.source_file_name,
    src.source_page,
    duplicate_estimate_version_without_product_id.source_version_id,
    now(),
    src.decision,
    src.reason,
    src.decided_at,
    src.updated_at,
    src.decided_by
  from public.takeoff_dpgf_review_decisions src
  where src.version_id = duplicate_estimate_version_without_product_id.source_version_id;

  return new_version_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_estimate_template_from_version(p_source_version_id uuid, p_name text, p_description text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  source_version public.estimate_versions%rowtype;
  current_user_id uuid := (select auth.uid());
  new_template_id uuid := gen_random_uuid();
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'Template name is required';
  end if;

  select v.*
    into source_version
  from public.estimate_versions v
  join public.estimate_projects p
    on p.id = v.project_id
   and p.tenant_id = v.tenant_id
  where v.id = p_source_version_id
    and (select public.is_tenant_member(v.tenant_id))
    and (
      p.user_id = current_user_id
      or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
    );

  if not found then
    raise exception 'Template source version not found or access denied';
  end if;

  insert into public.estimate_templates (
    id,
    tenant_id,
    created_by,
    source_version_id,
    name,
    description,
    margin_multiplier,
    margin_mode,
    currency,
    margin_bp,
    discount_bp,
    discount_amount_cents,
    discount_mode,
    discount_steps,
    global_coefficient,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    validite_jours
  )
  values (
    new_template_id,
    source_version.tenant_id,
    current_user_id,
    source_version.id,
    btrim(p_name),
    nullif(btrim(coalesce(p_description, '')), ''),
    source_version.margin_multiplier,
    source_version.margin_mode,
    source_version.currency,
    source_version.margin_bp,
    source_version.discount_bp,
    source_version.discount_amount_cents,
    source_version.discount_mode,
    source_version.discount_steps,
    source_version.global_coefficient,
    source_version.tax_rate_bp,
    source_version.rounding_mode,
    source_version.rounding_step_cents,
    source_version.validite_jours
  );

  create temporary table _estimate_template_item_map (
    old_id uuid primary key,
    new_id uuid not null
  ) on commit drop;

  insert into _estimate_template_item_map (old_id, new_id)
  select id, gen_random_uuid()
  from public.estimate_items
  where version_id = p_source_version_id;

  insert into public.estimate_template_items (
    id,
    tenant_id,
    template_id,
    parent_id,
    item_type,
    position,
    title,
    description,
    quantity,
    unit_price_ht_cents,
    tax_rate_bp,
    k_fo,
    h_mo,
    h_mo_majoration,
    k_mo,
    h_mo_atelier,
    k_mo_atelier,
    labor_role_atelier_id,
    h_mo_chantier,
    k_mo_chantier,
    labor_role_chantier_id,
    pu_ht_cents,
    labor_role_id,
    category_id,
    supply_type_id,
    line_total_ht_cents,
    line_tax_cents,
    line_total_ttc_cents
  )
  select
    map.new_id,
    source_version.tenant_id,
    new_template_id,
    parent_map.new_id,
    src.item_type,
    src.position,
    src.title,
    src.description,
    src.quantity,
    src.unit_price_ht_cents,
    src.tax_rate_bp,
    src.k_fo,
    src.h_mo,
    src.h_mo_majoration,
    src.k_mo,
    src.h_mo_atelier,
    src.k_mo_atelier,
    src.labor_role_atelier_id,
    src.h_mo_chantier,
    src.k_mo_chantier,
    src.labor_role_chantier_id,
    src.pu_ht_cents,
    src.labor_role_id,
    src.category_id,
    src.supply_type_id,
    src.line_total_ht_cents,
    src.line_tax_cents,
    src.line_total_ttc_cents
  from public.estimate_items src
  join _estimate_template_item_map map on map.old_id = src.id
  left join _estimate_template_item_map parent_map on parent_map.old_id = src.parent_id
  where src.version_id = p_source_version_id;

  return new_template_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.duplicate_estimate_template(p_template_id uuid, p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  source_template public.estimate_templates%rowtype;
  current_user_id uuid := (select auth.uid());
  new_template_id uuid := gen_random_uuid();
  duplicate_name text;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select t.*
    into source_template
  from public.estimate_templates t
  where t.id = p_template_id
    and (select public.is_tenant_member(t.tenant_id))
    and (
      t.created_by = current_user_id
      or (select public.has_tenant_role(t.tenant_id, array['admin'::public.tenant_role]))
    );

  if not found then
    raise exception 'Template not found or access denied';
  end if;

  duplicate_name := nullif(btrim(coalesce(p_name, '')), '');
  if duplicate_name is null then
    duplicate_name := source_template.name || ' (copie)';
  end if;

  insert into public.estimate_templates (
    id,
    tenant_id,
    created_by,
    source_version_id,
    name,
    description,
    margin_multiplier,
    margin_mode,
    currency,
    margin_bp,
    discount_bp,
    discount_amount_cents,
    discount_mode,
    discount_steps,
    global_coefficient,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    validite_jours
  )
  values (
    new_template_id,
    source_template.tenant_id,
    current_user_id,
    source_template.source_version_id,
    duplicate_name,
    source_template.description,
    source_template.margin_multiplier,
    source_template.margin_mode,
    source_template.currency,
    source_template.margin_bp,
    source_template.discount_bp,
    source_template.discount_amount_cents,
    source_template.discount_mode,
    source_template.discount_steps,
    source_template.global_coefficient,
    source_template.tax_rate_bp,
    source_template.rounding_mode,
    source_template.rounding_step_cents,
    source_template.validite_jours
  );

  create temporary table _estimate_template_duplicate_map (
    old_id uuid primary key,
    new_id uuid not null
  ) on commit drop;

  insert into _estimate_template_duplicate_map (old_id, new_id)
  select id, gen_random_uuid()
  from public.estimate_template_items
  where template_id = p_template_id;

  insert into public.estimate_template_items (
    id,
    tenant_id,
    template_id,
    parent_id,
    item_type,
    position,
    title,
    description,
    quantity,
    unit_price_ht_cents,
    tax_rate_bp,
    k_fo,
    h_mo,
    h_mo_majoration,
    k_mo,
    h_mo_atelier,
    k_mo_atelier,
    labor_role_atelier_id,
    h_mo_chantier,
    k_mo_chantier,
    labor_role_chantier_id,
    pu_ht_cents,
    labor_role_id,
    category_id,
    supply_type_id,
    line_total_ht_cents,
    line_tax_cents,
    line_total_ttc_cents
  )
  select
    map.new_id,
    source_template.tenant_id,
    new_template_id,
    parent_map.new_id,
    src.item_type,
    src.position,
    src.title,
    src.description,
    src.quantity,
    src.unit_price_ht_cents,
    src.tax_rate_bp,
    src.k_fo,
    src.h_mo,
    src.h_mo_majoration,
    src.k_mo,
    src.h_mo_atelier,
    src.k_mo_atelier,
    src.labor_role_atelier_id,
    src.h_mo_chantier,
    src.k_mo_chantier,
    src.labor_role_chantier_id,
    src.pu_ht_cents,
    src.labor_role_id,
    src.category_id,
    src.supply_type_id,
    src.line_total_ht_cents,
    src.line_tax_cents,
    src.line_total_ttc_cents
  from public.estimate_template_items src
  join _estimate_template_duplicate_map map on map.old_id = src.id
  left join _estimate_template_duplicate_map parent_map on parent_map.old_id = src.parent_id
  where src.template_id = p_template_id;

  return new_template_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_takeoff_estimate_version(p_version_id uuid, p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare
  target_version public.estimate_versions%rowtype;
  project_owner_id uuid;
  labor_split_enabled boolean := false;
  raw_cost_subtotal numeric := 0;
  effective_margin numeric;
  raw_ht bigint := 0;
  raw_tax bigint := 0;
  scaled_ht integer := 0;
  fixed_scaled_ht numeric;
  fixed_scaled_ht_floor numeric;
  scaled_tax integer := 0;
  discount_cents integer := 0;
  running_ht integer := 0;
  step_bp integer := 0;
  step_discount integer := 0;
  total_ht integer := 0;
  true_tax integer := 0;
  total_tax integer := 0;
  total_ttc integer := 0;
  unrounded_ttc integer := 0;
  rounding_adjustment integer := 0;
  effective_tax_rate_bp integer := 0;
  global_coefficient numeric := 1;
  rounding_step integer := 1;
  coefficient_shares bigint[] := '{}'::bigint[];
  discount_shares bigint[] := '{}'::bigint[];
  gross_sale_weights bigint[] := '{}'::bigint[];
  net_tax_weights bigint[] := '{}'::bigint[];
  adjusted_tax_shares bigint[] := '{}'::bigint[];
  max_cents constant integer := 2147483647;
begin
  if coalesce(
    current_setting('app.takeoff_apply_atomic', true),
    ''
  ) <> 'on' then
    raise exception 'TAKEOFF_ATOMIC_APPLY_REQUIRED' using errcode = '42501';
  end if;

  select version.*
    into target_version
  from public.estimate_versions as version
  where version.id = p_version_id
    and version.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'ESTIMATE_VERSION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if target_version.status <> 'draft'::public.estimate_status then
    raise exception 'ESTIMATE_VERSION_READ_ONLY' using errcode = '42501';
  end if;

  select project.user_id
    into project_owner_id
  from public.estimate_projects as project
  where project.id = target_version.project_id
    and project.tenant_id = target_version.tenant_id;

  if project_owner_id is null then
    raise exception 'ESTIMATE_PROJECT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(bool_or(flag.enabled), false)
    into labor_split_enabled
  from public.feature_flags as flag
  where flag.tenant_id = target_version.tenant_id
    and flag.flag_key = 'EST_031_LABOR_SPLIT';

  drop table if exists pg_temp._atomic_takeoff_line_calculations;
  create temporary table _atomic_takeoff_line_calculations (
    sequence integer not null unique,
    id uuid primary key,
    quantity numeric not null,
    cost_line_cents bigint not null,
    sale_line_cents integer,
    pu_ht_cents integer,
    tax_rate_bp integer not null,
    line_tax_cents integer,
    line_total_ttc_cents integer,
    coefficient_share_cents integer,
    discount_share_cents integer,
    net_ht_cents integer,
    net_tax_cents integer
  ) on commit drop;

  insert into pg_temp._atomic_takeoff_line_calculations (
    sequence,
    id,
    quantity,
    cost_line_cents,
    tax_rate_bp
  )
  select
    row_number() over (order by item.position, item.id)::integer,
    item.id,
    greatest(coalesce(item.quantity, 0), 0),
    least(
      max_cents,
      greatest(
        0,
        floor(
          least(
            max_cents::numeric,
            greatest(coalesce(item.quantity, 0), 0)
              * greatest(coalesce(item.unit_price_ht_cents, 0), 0)
              * greatest(coalesce(item.k_fo, 1), 0)
            + case
                when labor_split_enabled and (
                  coalesce(item.h_mo_atelier, 0) > 0
                  or item.labor_role_atelier_id is not null
                  or coalesce(item.h_mo_chantier, 0) > 0
                  or item.labor_role_chantier_id is not null
                  or coalesce(item.k_mo_atelier, 1) <> 1
                  or coalesce(item.k_mo_chantier, 1) <> 1
                ) then
                  greatest(coalesce(item.h_mo_majoration, 1), 0) * (
                    greatest(coalesce(item.h_mo_atelier, 0), 0)
                      * greatest(coalesce(role_atelier.hourly_rate_cents, 0), 0)
                      * greatest(coalesce(item.k_mo_atelier, 1), 0)
                    + greatest(coalesce(item.h_mo_chantier, 0), 0)
                      * greatest(coalesce(role_chantier.hourly_rate_cents, 0), 0)
                      * greatest(coalesce(item.k_mo_chantier, 1), 0)
                  )
                else
                  greatest(coalesce(item.h_mo_majoration, 1), 0)
                    * greatest(coalesce(item.h_mo, 0), 0)
                    * greatest(coalesce(role_legacy.hourly_rate_cents, 0), 0)
                    * greatest(coalesce(item.k_mo, 1), 0)
              end
          ) + 0.5
        )
      )
    ),
    case
      when target_version.contractor_role = 'subcontractor' then 0
      when coalesce(target_version.calc_engine_version, 1) = 2
        then greatest(coalesce(item.tax_rate_bp, target_version.tax_rate_bp, 0), 0)
      else greatest(coalesce(target_version.tax_rate_bp, item.tax_rate_bp, 0), 0)
    end
  from public.estimate_items as item
  left join public.labor_roles as role_legacy
    on role_legacy.id = item.labor_role_id
   and role_legacy.tenant_id = target_version.tenant_id
   and role_legacy.user_id = project_owner_id
  left join public.labor_roles as role_atelier
    on role_atelier.id = item.labor_role_atelier_id
   and role_atelier.tenant_id = target_version.tenant_id
   and role_atelier.user_id = project_owner_id
  left join public.labor_roles as role_chantier
    on role_chantier.id = item.labor_role_chantier_id
   and role_chantier.tenant_id = target_version.tenant_id
   and role_chantier.user_id = project_owner_id
  where item.version_id = target_version.id
    and item.tenant_id = target_version.tenant_id
    and item.item_type = 'line'::public.estimate_item_type;

  select coalesce(sum(calculation.cost_line_cents), 0)
    into raw_cost_subtotal
  from pg_temp._atomic_takeoff_line_calculations as calculation;

  if target_version.margin_mode = 'tiered'::public.estimate_margin_mode then
    select least(greatest(tier.multiplier, 0), 100)
      into effective_margin
    from public.margin_tiers as tier
    where tier.tenant_id = target_version.tenant_id
    order by
      (tier.threshold_cents <= raw_cost_subtotal) desc,
      case
        when tier.threshold_cents <= raw_cost_subtotal
          then tier.threshold_cents
      end desc nulls last,
      case
        when tier.threshold_cents <= raw_cost_subtotal
          then tier.position
      end desc nulls last,
      case
        when tier.threshold_cents > raw_cost_subtotal
          then tier.threshold_cents
      end asc nulls last,
      case
        when tier.threshold_cents > raw_cost_subtotal
          then tier.position
      end asc nulls last,
      tier.id
    limit 1;

    if effective_margin is null then
      effective_margin := case
        when raw_cost_subtotal >= 100000000 then 1.4
        when raw_cost_subtotal >= 10000000 then 1.45
        else 1.6
      end;
    end if;
  else
    effective_margin := least(
      greatest(coalesce(target_version.margin_multiplier, 1), 0),
      100
    );
  end if;

  with computed as (
    select
      calculation.id,
      least(
        max_cents,
        greatest(
          0,
          floor(
            calculation.cost_line_cents::numeric * effective_margin + 0.5
          )
        )
      )::integer as sale_line_cents
    from pg_temp._atomic_takeoff_line_calculations as calculation
  ), complete as (
    select
      computed.id,
      computed.sale_line_cents,
      least(
        max_cents,
        greatest(
          0,
          floor(
            computed.sale_line_cents::numeric
              * calculation.tax_rate_bp::numeric / 10000 + 0.5
          )
        )
      )::integer as line_tax_cents
    from computed
    join pg_temp._atomic_takeoff_line_calculations as calculation
      on calculation.id = computed.id
  )
  update pg_temp._atomic_takeoff_line_calculations as calculation
  set
    sale_line_cents = complete.sale_line_cents,
    pu_ht_cents = case
      when calculation.quantity > 0 then least(
        max_cents,
        greatest(
          0,
          public.takeoff_round_half_even(
            complete.sale_line_cents::numeric / calculation.quantity
          )
        )
      )
      else 0
    end,
    line_tax_cents = complete.line_tax_cents,
    line_total_ttc_cents = least(
      max_cents,
      complete.sale_line_cents + complete.line_tax_cents
    )
  from complete
  where calculation.id = complete.id;

  select
    coalesce(sum(calculation.sale_line_cents), 0),
    coalesce(sum(calculation.line_tax_cents), 0)
    into raw_ht, raw_tax
  from pg_temp._atomic_takeoff_line_calculations as calculation;

  global_coefficient := greatest(
    coalesce(target_version.global_coefficient, 1),
    0
  );
  if target_version.discount_amount_cents is not null then
    -- Fixed-amount calculations match the active JS coefficient's strict
    -- near-half tolerance. Cap numeric before any bigint/integer conversion.
    fixed_scaled_ht := greatest(raw_ht::numeric * global_coefficient, 0);
    if fixed_scaled_ht >= max_cents then
      scaled_ht := max_cents;
    else
      fixed_scaled_ht_floor := floor(fixed_scaled_ht);
      scaled_ht := (case
        when abs(fixed_scaled_ht - fixed_scaled_ht_floor - 0.5) < 0.000000001
          then fixed_scaled_ht_floor + mod(fixed_scaled_ht_floor, 2)
        else floor(fixed_scaled_ht + 0.5)
      end)::integer;
    end if;
  else
    scaled_ht := least(
      max_cents,
      greatest(
        0,
        public.takeoff_round_half_even(raw_ht::numeric * global_coefficient)
      )
    )::integer;
  end if;

  effective_tax_rate_bp := case
    when target_version.contractor_role = 'subcontractor' then 0
    else greatest(coalesce(target_version.tax_rate_bp, 0), 0)
  end;
  scaled_tax := case
    when global_coefficient = 1 then least(max_cents, greatest(raw_tax, 0))::integer
    else least(
      max_cents,
      greatest(
        0,
        floor(
          scaled_ht::numeric * effective_tax_rate_bp::numeric / 10000 + 0.5
        )::integer
      )
    )
  end;

  if target_version.discount_amount_cents is not null then
    -- Keep the requested amount; only the applied discount is capped.
    discount_cents := least(scaled_ht, target_version.discount_amount_cents);
  elsif target_version.discount_mode = 'cascade'::public.estimate_discount_mode then
    running_ht := scaled_ht;
    foreach step_bp in array coalesce(target_version.discount_steps, '{}'::integer[]) loop
      step_bp := least(greatest(coalesce(step_bp, 0), 0), 10000);
      step_discount := least(
        running_ht,
        greatest(
          0,
          public.takeoff_round_half_even(
            running_ht::numeric * step_bp::numeric / 10000
          )
        )::integer
      );
      discount_cents := discount_cents + step_discount;
      running_ht := running_ht - step_discount;
      exit when running_ht <= 0;
    end loop;
  else
    step_bp := case
      when coalesce(cardinality(target_version.discount_steps), 0) > 0
        then coalesce(target_version.discount_steps[1], 0)
      else coalesce(target_version.discount_bp, 0)
    end;
    step_bp := least(greatest(step_bp, 0), 10000);
    discount_cents := least(
      scaled_ht,
      greatest(
        0,
        public.takeoff_round_half_even(
          scaled_ht::numeric * step_bp::numeric / 10000
        )
      )::integer
    );
  end if;

  total_ht := greatest(scaled_ht - discount_cents, 0);

  if coalesce(target_version.calc_engine_version, 1) = 2 then
    select coalesce(
      array_agg(calculation.sale_line_cents::bigint order by calculation.sequence),
      '{}'::bigint[]
    )
      into gross_sale_weights
    from pg_temp._atomic_takeoff_line_calculations as calculation;

    coefficient_shares := public.takeoff_allocate_pro_rata(
      scaled_ht,
      gross_sale_weights
    );
    discount_shares := public.takeoff_allocate_pro_rata(
      discount_cents,
      coefficient_shares
    );

    update pg_temp._atomic_takeoff_line_calculations as calculation
    set
      coefficient_share_cents = coefficient_shares[calculation.sequence],
      discount_share_cents = discount_shares[calculation.sequence],
      net_ht_cents = coefficient_shares[calculation.sequence]
        - discount_shares[calculation.sequence],
      net_tax_cents = least(
        max_cents,
        greatest(
          0,
          floor(
            (
              coefficient_shares[calculation.sequence]
                - discount_shares[calculation.sequence]
            )::numeric * calculation.tax_rate_bp::numeric / 10000 + 0.5
          )
        )
      )::integer;

    select
      coalesce(sum(calculation.net_ht_cents), 0),
      coalesce(sum(calculation.net_tax_cents), 0)
      into total_ht, true_tax
    from pg_temp._atomic_takeoff_line_calculations as calculation;
  else
    true_tax := greatest(
      scaled_tax - floor(
        discount_cents::numeric * effective_tax_rate_bp::numeric / 10000 + 0.5
      )::integer,
      0
    );
  end if;

  unrounded_ttc := least(max_cents, total_ht + true_tax);
  total_ttc := unrounded_ttc;
  rounding_step := greatest(coalesce(target_version.rounding_step_cents, 1), 1);

  if target_version.contractor_role <> 'subcontractor' then
    if target_version.rounding_mode = 'nearest'::public.estimate_rounding_mode then
      total_ttc := floor(
        total_ttc::numeric / rounding_step::numeric + 0.5
      )::integer * rounding_step;
    elsif target_version.rounding_mode = 'up'::public.estimate_rounding_mode then
      total_ttc := ceil(
        total_ttc::numeric / rounding_step::numeric
      )::integer * rounding_step;
    elsif target_version.rounding_mode = 'down'::public.estimate_rounding_mode then
      total_ttc := floor(
        total_ttc::numeric / rounding_step::numeric
      )::integer * rounding_step;
    end if;
  end if;

  total_ttc := least(max_cents, greatest(total_ttc, total_ht));
  rounding_adjustment := total_ttc - unrounded_ttc;
  total_tax := greatest(total_ttc - total_ht, 0);

  if coalesce(target_version.calc_engine_version, 1) = 2 then
    select coalesce(
      array_agg(calculation.net_tax_cents::bigint order by calculation.sequence),
      '{}'::bigint[]
    )
      into net_tax_weights
    from pg_temp._atomic_takeoff_line_calculations as calculation;

    adjusted_tax_shares := public.takeoff_allocate_pro_rata(
      total_tax,
      net_tax_weights
    );

    update public.estimate_items as item
    set
      pu_ht_cents = case
        when calculation.quantity > 0 then least(
          max_cents,
          greatest(
            0,
            public.takeoff_round_half_even(
              calculation.net_ht_cents::numeric / calculation.quantity
            )
          )
        )
        else 0
      end,
      line_total_ht_cents = calculation.net_ht_cents,
      line_tax_cents = adjusted_tax_shares[calculation.sequence],
      line_total_ttc_cents = calculation.net_ht_cents
        + adjusted_tax_shares[calculation.sequence],
      updated_at = statement_timestamp()
    from pg_temp._atomic_takeoff_line_calculations as calculation
    where item.id = calculation.id
      and item.version_id = target_version.id
      and item.tenant_id = target_version.tenant_id;
  else
    update public.estimate_items as item
    set
      tax_rate_bp = target_version.tax_rate_bp,
      pu_ht_cents = calculation.pu_ht_cents,
      line_total_ht_cents = calculation.sale_line_cents,
      line_tax_cents = calculation.line_tax_cents,
      line_total_ttc_cents = calculation.line_total_ttc_cents,
      updated_at = statement_timestamp()
    from pg_temp._atomic_takeoff_line_calculations as calculation
    where item.id = calculation.id
      and item.version_id = target_version.id
      and item.tenant_id = target_version.tenant_id;
  end if;

  update public.estimate_versions as version
  set
    total_ht_cents = total_ht,
    total_tax_cents = total_tax,
    total_ttc_cents = total_ttc,
    rounding_adjustment_cents = rounding_adjustment,
    updated_at = statement_timestamp()
  where version.id = target_version.id
    and version.tenant_id = target_version.tenant_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.freeze_estimate_v2_snapshot_without_explicit_rounding(p_version_id uuid, p_tenant_id uuid, p_expected_updated_at timestamp with time zone, p_expected_content_revision bigint, p_actor_user_id uuid, p_purpose text, p_calculation_context jsonb, p_item_snapshots jsonb, p_version_totals jsonb)
 RETURNS estimate_versions
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  target_version public.estimate_versions%rowtype;
  project_owner_id uuid;
  actor_role public.tenant_role;
  fixed_base_cents integer;
  fixed_applied_cents integer;
  fixed_cost_subtotal numeric;
  fixed_cost_lines numeric[];
  fixed_effective_margin numeric;
  fixed_scaled_base numeric;
  fixed_base_floor numeric;
  max_cents constant integer := 2147483647;
  snapshot_count bigint;
  distinct_snapshot_count bigint;
  stored_line_count bigint;
  snapshot_total_ht bigint;
  snapshot_total_tax bigint;
  snapshot_total_ttc bigint;
  expected_total_ht integer;
  expected_total_tax integer;
  expected_total_ttc integer;
  expected_calculation_context jsonb;
  effective_labor_roles jsonb;
  effective_margin_tiers jsonb;
  effective_margin_multiplier numeric;
  labor_split_enabled boolean;
  frozen_version public.estimate_versions;
begin
  if current_user <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'SERVICE_ROLE_REQUIRED';
  end if;

  if p_purpose not in ('send', 'approval') then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V2_SNAPSHOT_PURPOSE_INVALID';
  end if;

  select version.*
    into target_version
  from public.estimate_versions version
  join public.estimate_projects project
    on project.id = version.project_id
   and project.tenant_id = version.tenant_id
  join public.tenants tenant
    on tenant.id = version.tenant_id
   and tenant.is_active
  join public.tenant_memberships membership
    on membership.tenant_id = version.tenant_id
   and membership.user_id = p_actor_user_id
  where version.id = p_version_id
    and version.tenant_id = p_tenant_id
  for update of version;

  select project.user_id, membership.role
    into project_owner_id, actor_role
  from public.estimate_projects project
  join public.tenants tenant
    on tenant.id = project.tenant_id
   and tenant.is_active
  join public.tenant_memberships membership
    on membership.tenant_id = project.tenant_id
   and membership.user_id = p_actor_user_id
  where project.id = target_version.project_id
    and project.tenant_id = target_version.tenant_id
  for share of project, tenant, membership;

  if target_version.id is null then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_V2_SNAPSHOT_NOT_WRITABLE';
  end if;

  if actor_role is null
    or actor_role not in (
      'admin'::public.tenant_role,
      'engineer'::public.tenant_role
    )
    or (
      project_owner_id <> p_actor_user_id
      and actor_role <> 'admin'::public.tenant_role
    )
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_V2_SNAPSHOT_NOT_WRITABLE';
  end if;

  if p_purpose = 'send' and not exists (
      select 1
      from public.draft_locks lock
      where lock.version_id = target_version.id
        and lock.tenant_id = target_version.tenant_id
        and lock.user_id = p_actor_user_id
        and lock.expires_at > statement_timestamp()
    ) then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_DRAFT_LOCK_REQUIRED';
  end if;

  if p_purpose = 'approval' and exists (
      select 1
      from public.draft_locks lock
      where lock.version_id = target_version.id
        and lock.tenant_id = target_version.tenant_id
        and lock.user_id <> p_actor_user_id
        and lock.expires_at > statement_timestamp()
    ) then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_DRAFT_LOCK_CONFLICT';
  end if;

  if target_version.updated_at is distinct from p_expected_updated_at then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_VERSION_CONFLICT';
  end if;

  if target_version.content_revision is distinct from p_expected_content_revision then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_VERSION_CONFLICT';
  end if;

  if target_version.status <> 'draft'::public.estimate_status
    or target_version.calc_engine_version <> 2
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_V2_SNAPSHOT_REQUIRES_DRAFT';
  end if;

  if p_calculation_context is null
    or jsonb_typeof(p_calculation_context) <> 'object'
    or p_calculation_context - (case when target_version.discount_amount_cents is null then array[
      'labor_split_enabled',
      'labor_roles',
      'margin_tiers',
      'effective_margin_multiplier'
    ] else array[
      'labor_split_enabled',
      'labor_roles',
      'margin_tiers',
      'effective_margin_multiplier',
      'fixed_discount'
    ] end) <> '{}'::jsonb
    or not p_calculation_context ?& (case when target_version.discount_amount_cents is null then array[
      'labor_split_enabled',
      'labor_roles',
      'margin_tiers',
      'effective_margin_multiplier'
    ] else array[
      'labor_split_enabled',
      'labor_roles',
      'margin_tiers',
      'effective_margin_multiplier',
      'fixed_discount'
    ] end)
    or jsonb_typeof(p_calculation_context->'labor_split_enabled') <> 'boolean'
    or jsonb_typeof(p_calculation_context->'labor_roles') <> 'array'
    or jsonb_typeof(p_calculation_context->'margin_tiers') <> 'array'
    or jsonb_typeof(
      p_calculation_context->'effective_margin_multiplier'
    ) <> 'number'
    or (p_calculation_context->>'effective_margin_multiplier')::numeric <= 0
    or (p_calculation_context->>'effective_margin_multiplier')::numeric > 100
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V2_CALCULATION_CONTEXT_INVALID';
  end if;

  if target_version.discount_amount_cents is not null then
    if jsonb_typeof(p_calculation_context->'fixed_discount') is distinct from 'object'
      or not (p_calculation_context->'fixed_discount' ?& array['requested_cents','base_cents','applied_cents'])
      or (p_calculation_context->'fixed_discount') - array['requested_cents','base_cents','applied_cents'] <> '{}'::jsonb then
      raise exception using errcode='22023',message='ESTIMATE_V2_CALCULATION_CONTEXT_INVALID';
    end if;
    if exists (
      select 1 from jsonb_each(p_calculation_context->'fixed_discount') value
      where jsonb_typeof(value.value) <> 'number' or value.value::text !~ '^[0-9]+$'
    ) then
      raise exception using errcode='22023',message='ESTIMATE_V2_CALCULATION_CONTEXT_INVALID';
    end if;
    if exists (
      select 1 from jsonb_each(p_calculation_context->'fixed_discount') value
      where value.value::text::numeric > max_cents
    ) then
      raise exception using errcode='22023',message='ESTIMATE_V2_CALCULATION_CONTEXT_INVALID';
    end if;
  end if;

  perform role.id
  from public.labor_roles role
  where role.id in (
    select referenced.role_id
    from (
      select item.labor_role_id as role_id
      from public.estimate_items item
      where item.version_id = target_version.id
        and item.tenant_id = target_version.tenant_id
      union
      select item.labor_role_atelier_id
      from public.estimate_items item
      where item.version_id = target_version.id
        and item.tenant_id = target_version.tenant_id
      union
      select item.labor_role_chantier_id
      from public.estimate_items item
      where item.version_id = target_version.id
        and item.tenant_id = target_version.tenant_id
    ) referenced
    where referenced.role_id is not null
  )
  order by role.id
  for share of role;

  if exists (
    select 1
    from (
      select item.labor_role_id as role_id
      from public.estimate_items item
      where item.version_id = target_version.id
        and item.tenant_id = target_version.tenant_id
      union
      select item.labor_role_atelier_id
      from public.estimate_items item
      where item.version_id = target_version.id
        and item.tenant_id = target_version.tenant_id
      union
      select item.labor_role_chantier_id
      from public.estimate_items item
      where item.version_id = target_version.id
        and item.tenant_id = target_version.tenant_id
    ) referenced
    left join public.labor_roles role
      on role.id = referenced.role_id
     and role.tenant_id = target_version.tenant_id
     and role.user_id = project_owner_id
    where referenced.role_id is not null
      and role.id is null
  ) then
    raise exception using
      errcode = '23503',
      message = 'ESTIMATE_LABOR_ROLE_OWNER_MISMATCH';
  end if;

  select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', referenced.role_id,
          'hourly_rate_cents', coalesce(role.hourly_rate_cents, 0)
        )
        order by referenced.role_id
      ),
      '[]'::jsonb
    )
    into effective_labor_roles
  from (
    select item.labor_role_id as role_id
    from public.estimate_items item
    where item.version_id = target_version.id
      and item.tenant_id = target_version.tenant_id
    union
    select item.labor_role_atelier_id
    from public.estimate_items item
    where item.version_id = target_version.id
      and item.tenant_id = target_version.tenant_id
    union
    select item.labor_role_chantier_id
    from public.estimate_items item
    where item.version_id = target_version.id
      and item.tenant_id = target_version.tenant_id
  ) referenced
  left join public.labor_roles role
    on role.id = referenced.role_id
   and role.tenant_id = target_version.tenant_id
   and role.user_id = project_owner_id
  where referenced.role_id is not null;

  if target_version.margin_mode = 'tiered'::public.estimate_margin_mode then
    perform tier.id
    from public.margin_tiers tier
    where tier.tenant_id = target_version.tenant_id
    order by tier.threshold_cents, tier.position, tier.id
    for share;

    select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'threshold_cents', tier.threshold_cents,
            'multiplier', tier.multiplier
          )
          order by tier.threshold_cents, tier.position, tier.id
        ),
        '[]'::jsonb
      )
      into effective_margin_tiers
    from public.margin_tiers tier
    where tier.tenant_id = target_version.tenant_id;

    if effective_margin_tiers = '[]'::jsonb then
      effective_margin_tiers := '[
        {"threshold_cents": 0, "multiplier": 1.6},
        {"threshold_cents": 10000000, "multiplier": 1.45},
        {"threshold_cents": 100000000, "multiplier": 1.4}
      ]'::jsonb;
    end if;
  else
    effective_margin_tiers := '[]'::jsonb;
  end if;

  effective_margin_multiplier :=
    (p_calculation_context->>'effective_margin_multiplier')::numeric;

  if target_version.margin_mode = 'fixed'::public.estimate_margin_mode then
    if effective_margin_multiplier is distinct from
      target_version.margin_multiplier
    then
      raise exception using
        errcode = '40001',
        message = 'ESTIMATE_V2_EFFECTIVE_MARGIN_CONFLICT';
    end if;
  elsif not exists (
    select 1
    from jsonb_to_recordset(effective_margin_tiers) as tier(
      threshold_cents bigint,
      multiplier numeric
    )
    where tier.multiplier = effective_margin_multiplier
  ) then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_V2_EFFECTIVE_MARGIN_CONFLICT';
  end if;

  perform flag.id
  from public.feature_flags flag
  where flag.tenant_id = target_version.tenant_id
    and flag.flag_key = 'EST_031_LABOR_SPLIT'
  for share;

  select coalesce(bool_or(flag.enabled), false)
    into labor_split_enabled
  from public.feature_flags flag
  where flag.tenant_id = target_version.tenant_id
    and flag.flag_key = 'EST_031_LABOR_SPLIT';

  -- Mirror the v2 calculator's mode selection. When the tenant flag is on but
  -- a line has no active split payload, h_mo still uses the legacy role. Once
  -- a split payload is active, legacy h_mo is ignored and each positive
  -- atelier/chantier duration must carry its dedicated role.
  if exists (
    select 1
    from public.estimate_items item
    cross join lateral (
      select labor_split_enabled and (
        coalesce(item.h_mo_atelier, 0) > 0
        or item.labor_role_atelier_id is not null
        or coalesce(item.h_mo_chantier, 0) > 0
        or item.labor_role_chantier_id is not null
        or coalesce(item.k_mo_atelier, 1) <> 1
        or coalesce(item.k_mo_chantier, 1) <> 1
      ) as use_split
    ) calculation_mode
    where item.version_id = target_version.id
      and item.tenant_id = target_version.tenant_id
      and item.item_type = 'line'::public.estimate_item_type
      and (
        (
          not calculation_mode.use_split
          and coalesce(item.h_mo, 0) > 0
          and item.labor_role_id is null
        )
        or (
          calculation_mode.use_split
          and (
            (
              coalesce(item.h_mo_atelier, 0) > 0
              and item.labor_role_atelier_id is null
            )
            or (
              coalesce(item.h_mo_chantier, 0) > 0
              and item.labor_role_chantier_id is null
            )
          )
        )
      )
  ) then
    raise exception using
      errcode = '23502',
      message = 'ESTIMATE_V2_LABOR_ROLE_REQUIRED';
  end if;

  expected_calculation_context := jsonb_build_object(
    'labor_split_enabled', labor_split_enabled,
    'labor_roles', effective_labor_roles,
    'margin_tiers', effective_margin_tiers,
    'effective_margin_multiplier', effective_margin_multiplier
  );

  if target_version.discount_amount_cents is not null then
    -- Reconstruct the pre-discount base from source inputs, never from net V2
    -- snapshots or footer values supplied by the caller. MO is line duration.
    -- Cost and sale use Math.round's positive rule; coefficient uses bankers.
    with raw_costs as (
      select least(max_cents, greatest(0, floor(
        greatest(coalesce(item.quantity,0),0)
          * greatest(coalesce(item.unit_price_ht_cents,0),0)
          * greatest(coalesce(item.k_fo,1),0)
        + case when labor_split_enabled and (
            coalesce(item.h_mo_atelier,0)>0 or item.labor_role_atelier_id is not null
            or coalesce(item.h_mo_chantier,0)>0 or item.labor_role_chantier_id is not null
            or coalesce(item.k_mo_atelier,1)<>1 or coalesce(item.k_mo_chantier,1)<>1
          ) then greatest(coalesce(item.h_mo_majoration,1),0) * (
            greatest(coalesce(item.h_mo_atelier,0),0)
              * greatest(coalesce(role_atelier.hourly_rate_cents,0),0)
              * greatest(coalesce(item.k_mo_atelier,1),0)
            + greatest(coalesce(item.h_mo_chantier,0),0)
              * greatest(coalesce(role_chantier.hourly_rate_cents,0),0)
              * greatest(coalesce(item.k_mo_chantier,1),0)
          ) else greatest(coalesce(item.h_mo_majoration,1),0)
            * greatest(coalesce(item.h_mo,0),0)
            * greatest(coalesce(role_legacy.hourly_rate_cents,0),0)
            * greatest(coalesce(item.k_mo,1),0)
          end + 0.5
      ))) as cost_line_cents
      from public.estimate_items item
      left join public.labor_roles role_legacy on role_legacy.id=item.labor_role_id
        and role_legacy.tenant_id=target_version.tenant_id and role_legacy.user_id=project_owner_id
      left join public.labor_roles role_atelier on role_atelier.id=item.labor_role_atelier_id
        and role_atelier.tenant_id=target_version.tenant_id and role_atelier.user_id=project_owner_id
      left join public.labor_roles role_chantier on role_chantier.id=item.labor_role_chantier_id
        and role_chantier.tenant_id=target_version.tenant_id and role_chantier.user_id=project_owner_id
      where item.version_id=target_version.id and item.tenant_id=target_version.tenant_id
        and item.item_type='line'::public.estimate_item_type
    )
    select coalesce(sum(cost_line_cents),0),
      coalesce(array_agg(cost_line_cents),'{}'::numeric[])
      into fixed_cost_subtotal,fixed_cost_lines
    from raw_costs;

    fixed_effective_margin := effective_margin_multiplier;
    if target_version.margin_mode = 'tiered'::public.estimate_margin_mode then
      -- The captured tier array is already ordered by threshold/position/id.
      -- Resolve its last admissible tier (or first tier above the subtotal),
      -- matching JS resolution and its historical default array when empty.
      select least(greatest((tier.value->>'multiplier')::numeric,0),100)
        into fixed_effective_margin
      from jsonb_array_elements(effective_margin_tiers) with ordinality as tier(value,ordinality)
      order by
        ((tier.value->>'threshold_cents')::numeric <= fixed_cost_subtotal) desc,
        case when (tier.value->>'threshold_cents')::numeric <= fixed_cost_subtotal
          then (tier.value->>'threshold_cents')::numeric end desc nulls last,
        case when (tier.value->>'threshold_cents')::numeric <= fixed_cost_subtotal
          then tier.ordinality end desc nulls last,
        case when (tier.value->>'threshold_cents')::numeric > fixed_cost_subtotal
          then (tier.value->>'threshold_cents')::numeric end asc nulls last,
        tier.ordinality
      limit 1;
      if fixed_effective_margin is distinct from effective_margin_multiplier then
        raise exception using
          errcode = '40001',
          message = 'ESTIMATE_V2_EFFECTIVE_MARGIN_CONFLICT';
      end if;
    end if;

    select greatest(coalesce(sum(least(max_cents,greatest(0,
      floor(cost.cost_line_cents*fixed_effective_margin+0.5)))),0)
      * greatest(coalesce(target_version.global_coefficient,1),0),0)
      into fixed_scaled_base
    from unnest(fixed_cost_lines) as cost(cost_line_cents);
    -- Keep the existing NULL helper unchanged. The fixed branch caps before
    -- integer conversion and applies the JS coefficient's strict 1e-9 rule.
    if fixed_scaled_base >= max_cents then
      fixed_base_cents := max_cents;
    else
      fixed_base_floor := floor(fixed_scaled_base);
      fixed_base_cents := (case
        when abs(fixed_scaled_base - fixed_base_floor - 0.5) < 0.000000001
          then fixed_base_floor + mod(fixed_base_floor,2)
        else floor(fixed_scaled_base + 0.5)
      end)::integer;
    end if;
    fixed_applied_cents := least(target_version.discount_amount_cents,fixed_base_cents);
    expected_calculation_context := expected_calculation_context || jsonb_build_object(
      'fixed_discount',jsonb_build_object('requested_cents',target_version.discount_amount_cents,
        'base_cents',fixed_base_cents,'applied_cents',fixed_applied_cents)
    );
  end if;

  if p_calculation_context is distinct from expected_calculation_context then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_V2_CALCULATION_CONTEXT_CONFLICT';
  end if;

  if p_item_snapshots is null
    or jsonb_typeof(p_item_snapshots) <> 'array'
    or exists (
      select 1
      from jsonb_array_elements(p_item_snapshots) snapshot(value)
      where jsonb_typeof(snapshot.value) <> 'object'
        or snapshot.value - array[
          'id',
          'snapshot_pu_ht_cents',
          'snapshot_fo_ht_cents',
          'snapshot_mo_ht_cents',
          'snapshot_mo_atelier_ht_cents',
          'snapshot_mo_chantier_ht_cents',
          'line_total_ht_cents',
          'line_tax_cents',
          'line_total_ttc_cents'
        ] <> '{}'::jsonb
    )
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V2_ITEM_SNAPSHOT_INVALID';
  end if;

  if p_version_totals is null
    or jsonb_typeof(p_version_totals) <> 'object'
    or p_version_totals - array[
      'total_ht_cents',
      'total_tax_cents',
      'total_ttc_cents'
    ] <> '{}'::jsonb
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V2_TOTALS_INVALID';
  end if;

  expected_total_ht := (p_version_totals->>'total_ht_cents')::integer;
  expected_total_tax := (p_version_totals->>'total_tax_cents')::integer;
  expected_total_ttc := (p_version_totals->>'total_ttc_cents')::integer;

  if expected_total_ht is null
    or expected_total_tax is null
    or expected_total_ttc is null
    or expected_total_ht < 0
    or expected_total_tax < 0
    or expected_total_ttc < 0
    or expected_total_ttc <> expected_total_ht + expected_total_tax
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V2_TOTALS_INVALID';
  end if;

  if target_version.discount_amount_cents is not null
    and expected_total_ht <> fixed_base_cents - fixed_applied_cents then
    raise exception using errcode='22023',message='ESTIMATE_V2_SNAPSHOT_TOTALS_MISMATCH';
  end if;

  select
    count(*),
    count(distinct snapshot.id),
    coalesce(sum(snapshot.line_total_ht_cents), 0),
    coalesce(sum(snapshot.line_tax_cents), 0),
    coalesce(sum(snapshot.line_total_ttc_cents), 0)
  into
    snapshot_count,
    distinct_snapshot_count,
    snapshot_total_ht,
    snapshot_total_tax,
    snapshot_total_ttc
  from jsonb_to_recordset(p_item_snapshots) as snapshot(
    id uuid,
    snapshot_pu_ht_cents integer,
    snapshot_fo_ht_cents integer,
    snapshot_mo_ht_cents integer,
    snapshot_mo_atelier_ht_cents integer,
    snapshot_mo_chantier_ht_cents integer,
    line_total_ht_cents integer,
    line_tax_cents integer,
    line_total_ttc_cents integer
  )
  where snapshot.id is not null
    and snapshot.snapshot_pu_ht_cents is not null
    and snapshot.snapshot_fo_ht_cents is not null
    and snapshot.snapshot_mo_ht_cents is not null
    and snapshot.snapshot_mo_atelier_ht_cents is not null
    and snapshot.snapshot_mo_chantier_ht_cents is not null
    and snapshot.snapshot_pu_ht_cents >= 0
    and snapshot.snapshot_fo_ht_cents >= 0
    and snapshot.snapshot_mo_ht_cents >= 0
    and snapshot.snapshot_mo_atelier_ht_cents >= 0
    and snapshot.snapshot_mo_chantier_ht_cents >= 0
    and snapshot.snapshot_fo_ht_cents + snapshot.snapshot_mo_ht_cents =
      snapshot.line_total_ht_cents
    and snapshot.snapshot_mo_atelier_ht_cents
      + snapshot.snapshot_mo_chantier_ht_cents = snapshot.snapshot_mo_ht_cents
    and snapshot.line_total_ht_cents is not null
    and snapshot.line_tax_cents is not null
    and snapshot.line_total_ttc_cents is not null
    and snapshot.line_total_ht_cents >= 0
    and snapshot.line_tax_cents >= 0
    and snapshot.line_total_ttc_cents >= 0
    and snapshot.line_total_ttc_cents =
      snapshot.line_total_ht_cents + snapshot.line_tax_cents;

  if snapshot_count <> jsonb_array_length(p_item_snapshots)
    or distinct_snapshot_count <> snapshot_count
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V2_ITEM_SNAPSHOT_INVALID';
  end if;

  select count(*)
    into stored_line_count
  from public.estimate_items item
  where item.version_id = target_version.id
    and item.tenant_id = target_version.tenant_id
    and item.item_type = 'line'::public.estimate_item_type;

  if stored_line_count <> snapshot_count
    or exists (
      select 1
      from jsonb_to_recordset(p_item_snapshots) as snapshot(id uuid)
      left join public.estimate_items item
        on item.id = snapshot.id
       and item.version_id = target_version.id
       and item.tenant_id = target_version.tenant_id
       and item.item_type = 'line'::public.estimate_item_type
      where item.id is null
    )
  then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_V2_ITEM_SNAPSHOT_CONFLICT';
  end if;

  if snapshot_total_ht <> expected_total_ht
    or snapshot_total_tax <> expected_total_tax
    or snapshot_total_ttc <> expected_total_ttc
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V2_SNAPSHOT_TOTALS_MISMATCH';
  end if;

  if target_version.calc_snapshot_content_revision =
      target_version.content_revision
    and target_version.calc_snapshot_context = p_calculation_context
    and target_version.total_ht_cents = expected_total_ht
    and target_version.total_tax_cents = expected_total_tax
    and target_version.total_ttc_cents = expected_total_ttc
    and not exists (
      select 1
      from public.estimate_items item
      join jsonb_to_recordset(p_item_snapshots) as snapshot(
        id uuid,
        snapshot_pu_ht_cents integer,
        snapshot_fo_ht_cents integer,
        snapshot_mo_ht_cents integer,
        snapshot_mo_atelier_ht_cents integer,
        snapshot_mo_chantier_ht_cents integer,
        line_total_ht_cents integer,
        line_tax_cents integer,
        line_total_ttc_cents integer
      ) on snapshot.id = item.id
      where item.version_id = target_version.id
        and item.tenant_id = target_version.tenant_id
        and item.item_type = 'line'::public.estimate_item_type
        and (
          item.snapshot_pu_ht_cents is distinct from
            snapshot.snapshot_pu_ht_cents
          or item.snapshot_fo_ht_cents is distinct from
            snapshot.snapshot_fo_ht_cents
          or item.snapshot_mo_ht_cents is distinct from
            snapshot.snapshot_mo_ht_cents
          or item.snapshot_mo_atelier_ht_cents is distinct from
            snapshot.snapshot_mo_atelier_ht_cents
          or item.snapshot_mo_chantier_ht_cents is distinct from
            snapshot.snapshot_mo_chantier_ht_cents
          or item.line_total_ht_cents is distinct from
            snapshot.line_total_ht_cents
          or item.line_tax_cents is distinct from snapshot.line_tax_cents
          or item.line_total_ttc_cents is distinct from
            snapshot.line_total_ttc_cents
        )
    )
  then
    return target_version;
  end if;

  perform pg_catalog.set_config(
    'miaouffrage.estimate_v2_snapshot_freeze',
    'on',
    true
  );

  update public.estimate_items item
  set
    snapshot_pu_ht_cents = snapshot.snapshot_pu_ht_cents,
    snapshot_fo_ht_cents = snapshot.snapshot_fo_ht_cents,
    snapshot_mo_ht_cents = snapshot.snapshot_mo_ht_cents,
    snapshot_mo_atelier_ht_cents = snapshot.snapshot_mo_atelier_ht_cents,
    snapshot_mo_chantier_ht_cents = snapshot.snapshot_mo_chantier_ht_cents,
    line_total_ht_cents = snapshot.line_total_ht_cents,
    line_tax_cents = snapshot.line_tax_cents,
    line_total_ttc_cents = snapshot.line_total_ttc_cents
  from jsonb_to_recordset(p_item_snapshots) as snapshot(
    id uuid,
    snapshot_pu_ht_cents integer,
    snapshot_fo_ht_cents integer,
    snapshot_mo_ht_cents integer,
    snapshot_mo_atelier_ht_cents integer,
    snapshot_mo_chantier_ht_cents integer,
    line_total_ht_cents integer,
    line_tax_cents integer,
    line_total_ttc_cents integer
  )
  where item.id = snapshot.id
    and item.version_id = target_version.id
    and item.tenant_id = target_version.tenant_id;

  update public.estimate_versions version
  set
    total_ht_cents = expected_total_ht,
    total_tax_cents = expected_total_tax,
    total_ttc_cents = expected_total_ttc,
    calc_snapshot_context = p_calculation_context
  where version.id = target_version.id
    and version.tenant_id = target_version.tenant_id
  returning version.* into frozen_version;

  update public.estimate_versions version
  set calc_snapshot_content_revision = version.content_revision
  where version.id = frozen_version.id
    and version.tenant_id = frozen_version.tenant_id
  returning version.* into frozen_version;

  perform pg_catalog.set_config(
    'miaouffrage.estimate_v2_snapshot_freeze',
    'off',
    true
  );

  if frozen_version.id is null then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_VERSION_CONFLICT';
  end if;

  return frozen_version;
end;
$function$;

-- Candidate fragment only: integrate into the ONE new amount migration.
-- Frozen 25-case RLS precode and admission precede this fragment. No application here.
do $template_parent_preflight$
begin
  if exists (
    select 1 from public.estimate_template_items c
    left join public.estimate_template_items p on p.id = c.parent_id
    where c.parent_id is not null
      and (p.id is null or p.template_id <> c.template_id or p.tenant_id <> c.tenant_id)
  ) then
    raise exception 'Template parent scope violations must be reviewed before migration';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.estimate_template_items'::regclass
      and conname = 'estimate_template_items_parent_id_fkey'
      and pg_get_constraintdef(oid, false) = 'FOREIGN KEY (parent_id) REFERENCES estimate_template_items(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED'
      and convalidated
  ) then
    raise exception 'Expected template parent foreign key differs';
  end if;
end;
$template_parent_preflight$;

alter table public.estimate_template_items
  add constraint estimate_template_items_parent_scope_key unique (id, template_id, tenant_id);
alter table public.estimate_template_items
  drop constraint estimate_template_items_parent_id_fkey;
alter table public.estimate_template_items
  add constraint estimate_template_items_parent_id_fkey
  foreign key (parent_id, template_id, tenant_id)
  references public.estimate_template_items (id, template_id, tenant_id)
  on delete cascade deferrable initially deferred;

drop policy "Users can manage estimate templates" on public.estimate_templates;
create policy "Users can manage estimate templates" on public.estimate_templates
  for select to authenticated
  using (((select public.is_tenant_member(estimate_templates.tenant_id))
  and (created_by = (select auth.uid())
    or (select public.has_tenant_role(estimate_templates.tenant_id, array['admin'::public.tenant_role])))));

create policy "Users can insert estimate templates" on public.estimate_templates
  for insert to authenticated
  with check ((((select public.is_tenant_member(estimate_templates.tenant_id))
  and (created_by = (select auth.uid())
    or (select public.has_tenant_role(estimate_templates.tenant_id, array['admin'::public.tenant_role]))))
  and (select public.has_tenant_role(estimate_templates.tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))));

create policy "Users can update estimate templates" on public.estimate_templates
  for update to authenticated
  using ((((select public.is_tenant_member(estimate_templates.tenant_id))
  and (created_by = (select auth.uid())
    or (select public.has_tenant_role(estimate_templates.tenant_id, array['admin'::public.tenant_role]))))
  and (select public.has_tenant_role(estimate_templates.tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))))
  with check ((((select public.is_tenant_member(estimate_templates.tenant_id))
  and (created_by = (select auth.uid())
    or (select public.has_tenant_role(estimate_templates.tenant_id, array['admin'::public.tenant_role]))))
  and (select public.has_tenant_role(estimate_templates.tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))));

create policy "Users can delete estimate templates" on public.estimate_templates
  for delete to authenticated
  using ((((select public.is_tenant_member(estimate_templates.tenant_id))
  and (created_by = (select auth.uid())
    or (select public.has_tenant_role(estimate_templates.tenant_id, array['admin'::public.tenant_role]))))
  and (select public.has_tenant_role(estimate_templates.tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))));

drop policy "Users can insert estimate template items" on public.estimate_template_items;
create policy "Users can insert estimate template items" on public.estimate_template_items
  for insert to authenticated
  with check (((exists (
  select 1 from public.estimate_templates t
  where t.id = estimate_template_items.template_id
    and t.tenant_id = estimate_template_items.tenant_id
    and (select public.is_tenant_member(t.tenant_id))
    and (t.created_by = (select auth.uid())
      or (select public.has_tenant_role(t.tenant_id, array['admin'::public.tenant_role])))
))
  and (select public.has_tenant_role(estimate_template_items.tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))));

drop policy "Users can update estimate template items" on public.estimate_template_items;
create policy "Users can update estimate template items" on public.estimate_template_items
  for update to authenticated
  using (((exists (
  select 1 from public.estimate_templates t
  where t.id = estimate_template_items.template_id
    and t.tenant_id = estimate_template_items.tenant_id
    and (select public.is_tenant_member(t.tenant_id))
    and (t.created_by = (select auth.uid())
      or (select public.has_tenant_role(t.tenant_id, array['admin'::public.tenant_role])))
))
  and (select public.has_tenant_role(estimate_template_items.tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))))
  with check (((exists (
  select 1 from public.estimate_templates t
  where t.id = estimate_template_items.template_id
    and t.tenant_id = estimate_template_items.tenant_id
    and (select public.is_tenant_member(t.tenant_id))
    and (t.created_by = (select auth.uid())
      or (select public.has_tenant_role(t.tenant_id, array['admin'::public.tenant_role])))
))
  and (select public.has_tenant_role(estimate_template_items.tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))));

drop policy "Users can delete estimate template items" on public.estimate_template_items;
create policy "Users can delete estimate template items" on public.estimate_template_items
  for delete to authenticated
  using (((exists (
  select 1 from public.estimate_templates t
  where t.id = estimate_template_items.template_id
    and t.tenant_id = estimate_template_items.tenant_id
    and (select public.is_tenant_member(t.tenant_id))
    and (t.created_by = (select auth.uid())
      or (select public.has_tenant_role(t.tenant_id, array['admin'::public.tenant_role])))
))
  and (select public.has_tenant_role(estimate_template_items.tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))));

commit;
