begin;

-- The server supplies a prospective TS projection. This RPC admits only its
-- privileged server context and writes every derived line/settings/footer
-- together; it never publishes or makes a calculation snapshot fresh.
create function public.save_estimate_settings_atomic(
  p_version_id uuid,
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_content_revision bigint,
  p_draft_lock_session_id uuid,
  p_settings_patch jsonb,
  p_line_projections jsonb,
  p_totals jsonb,
  p_expected_dependencies jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
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
      'margin_mode','margin_bp','discount_bp','discount_mode','discount_steps','global_coefficient','tax_rate_bp',
      'contractor_role','rounding_mode','rounding_step_cents','max_section_depth'] <> '{}'::jsonb
    or coalesce(pg_catalog.current_setting('miaouffrage.estimate_v2_snapshot_freeze',true),'')='on'
    or coalesce(pg_catalog.current_setting('app.takeoff_apply_atomic',true),'')='on'
  then
    raise exception using errcode='22023',message='ESTIMATE_SETTINGS_INVALID_INPUT';
  end if;
  if exists(select 1 from jsonb_each(p_settings_patch) x where
    case
      when x.key in ('title','exclusions') then jsonb_typeof(x.value) not in ('string','null')
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
    discount_bp=prospective.discount_bp,discount_mode=prospective.discount_mode,discount_steps=prospective.discount_steps,
    global_coefficient=prospective.global_coefficient,tax_rate_bp=prospective.tax_rate_bp,contractor_role=prospective.contractor_role,
    rounding_mode=prospective.rounding_mode,rounding_step_cents=prospective.rounding_step_cents,max_section_depth=prospective.max_section_depth,
    total_ht_cents=ht::integer,total_tax_cents=tax::integer,total_ttc_cents=ttc::integer,rounding_adjustment_cents=adjustment::integer
  where v.id=p_version_id and v.tenant_id=p_tenant_id
    and row(v.title,v.exclusions,v.date_devis,v.validite_jours,v.currency,v.margin_multiplier,v.margin_mode,v.margin_bp,v.discount_bp,
      v.discount_mode,v.discount_steps,v.global_coefficient,v.tax_rate_bp,v.contractor_role,v.rounding_mode,v.rounding_step_cents,
      v.max_section_depth,v.total_ht_cents,v.total_tax_cents,v.total_ttc_cents,v.rounding_adjustment_cents)
      is distinct from row(prospective.title,prospective.exclusions,prospective.date_devis,prospective.validite_jours,prospective.currency,
        prospective.margin_multiplier,prospective.margin_mode,prospective.margin_bp,prospective.discount_bp,prospective.discount_mode,
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
$$;
revoke all on function public.save_estimate_settings_atomic(uuid,uuid,uuid,timestamptz,bigint,uuid,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_estimate_settings_atomic(uuid,uuid,uuid,timestamptz,bigint,uuid,jsonb,jsonb,jsonb,jsonb) to service_role;
comment on function public.save_estimate_settings_atomic(uuid,uuid,uuid,timestamptz,bigint,uuid,jsonb,jsonb,jsonb,jsonb) is
  'Save complete prospective settings/line/footer projections under original timestamp+revision CAS, exact page lease, authorization and raw dependency gates. Server service role only; no structural/source changes, publication or snapshot refresh.';

-- Guard replacements follow below, retaining their installed ACLs and bodies
-- except the narrow admission/content predicate for this draft transaction.

CREATE OR REPLACE FUNCTION public.guard_estimate_rounding_adjustment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.rounding_adjustment_cents is distinct from old.rounding_adjustment_cents
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
        current_user = 'service_role'
        and old.status = 'draft'
        and new.status = 'draft'
        and coalesce(
          pg_catalog.current_setting('miaouffrage.estimate_settings_atomic', true),
          ''
        ) = new.id::text
      )
      or coalesce(
        pg_catalog.current_setting('app.takeoff_apply_atomic', true),
        ''
      ) = 'on'
    )
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_ROUNDING_ADJUSTMENT_IS_MANAGED';
  end if;

  return new;
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

commit;
