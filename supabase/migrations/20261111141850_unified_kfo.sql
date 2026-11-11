-- TI-534 unified K FO. Historical versions keep their engine and frozen amounts.
begin;
alter table public.estimate_items add column k_fo_manual boolean;
alter table public.estimate_items alter column k_fo type numeric(15,6);
-- Reusable prices and the guarded bulk writer must retain the same precision.
alter table public.estimate_template_items alter column k_fo type numeric(15,6);
alter table public.estimate_assembly_items alter column k_fo type numeric(15,6);
alter table public.supply_types alter column default_fo_provision type numeric(15,6);
alter table public.supply_types drop constraint supply_types_default_fo_provision_check;
alter table public.supply_types add constraint supply_types_default_fo_provision_check
  check(default_fo_provision>=0 and default_fo_provision<=999999999.999);
do $bulk_kfo$
declare routine regprocedure; definition text;
begin
  foreach routine in array array[
    'public.bulk_update_estimate_items_without_line_nature(uuid,jsonb,jsonb,timestamp with time zone)'::regprocedure,
    'public.snapshot_estimate_item_bulk_updates(uuid,jsonb)'::regprocedure
  ] loop
    select pg_get_functiondef(routine) into definition;
    definition:=regexp_replace(definition,'(k_fo[[:space:]]+numeric)\(12,[[:space:]]*3\)','\1(15,6)','gi');
    definition:=replace(definition,$old$(requested.payload->>'k_fo')::numeric(12,3)$old$,$new$(requested.payload->>'k_fo')::numeric(15,6)$new$);
    execute definition;
  end loop;
end;
$bulk_kfo$;
comment on column public.estimate_items.k_fo_manual is 'true: manual override; false: company/user default; null: legacy provenance unknown';
create table public.estimate_fo_preferences (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 supply_type_id uuid not null references public.supply_types(id) on delete cascade,
 coefficient numeric(15,6) not null check(coefficient>=0 and coefficient<=999999999.999),
 unique(tenant_id,user_id,supply_type_id),
 foreign key(tenant_id,user_id) references public.tenant_memberships(tenant_id,user_id) on delete cascade
);
alter table public.estimate_fo_preferences enable row level security;
revoke all on public.estimate_fo_preferences from anon;
grant select,insert,update,delete on public.estimate_fo_preferences to authenticated;
grant all on public.estimate_fo_preferences to service_role;
create policy kfo_read on public.estimate_fo_preferences for select to authenticated using(tenant_id=(select public.current_tenant_id()));
create policy kfo_insert on public.estimate_fo_preferences for insert to authenticated with check(tenant_id=(select public.current_tenant_id()) and user_id=(select auth.uid()) and exists(select 1 from public.supply_types s where s.id=supply_type_id and s.tenant_id=estimate_fo_preferences.tenant_id));
create policy kfo_update on public.estimate_fo_preferences for update to authenticated using(tenant_id=(select public.current_tenant_id()) and user_id=(select auth.uid())) with check(tenant_id=(select public.current_tenant_id()) and user_id=(select auth.uid()) and exists(select 1 from public.supply_types s where s.id=supply_type_id and s.tenant_id=estimate_fo_preferences.tenant_id));
create policy kfo_delete on public.estimate_fo_preferences for delete to authenticated using(tenant_id=(select public.current_tenant_id()) and user_id=(select auth.uid()));
alter table public.supply_types alter column default_fo_provision set default 1.020;
update public.supply_types set default_fo_provision=case when lower(btrim(code)) in ('tube','tubes') or lower(btrim(name)) in ('tube','tubes') then 1.130 else 1.020 end where default_fo_provision in(1.010,1.030);
create function private.estimate_kfo_base(p_tenant uuid,p_owner uuid,p_type uuid,p_origin jsonb)
returns numeric language sql stable security invoker set search_path='' as $$
 select coalesce(pref.coefficient,case when p_origin->>'transport_mode'='included' and s.id is not null and s.default_fo_provision = case when lower(btrim(s.code)) in('tube','tubes') or lower(btrim(s.name)) in('tube','tubes') then 1.130 else 1.020 end then case when lower(btrim(s.code)) in('tube','tubes') or lower(btrim(s.name)) in('tube','tubes') then 1.100 else 1.000 end else s.default_fo_provision end,1.020)
 from (values(1)) seed(n) left join public.supply_types s on s.id=p_type and s.tenant_id=p_tenant
 left join public.estimate_fo_preferences pref on pref.tenant_id=p_tenant and pref.user_id=p_owner and pref.supply_type_id=s.id;
$$;
revoke all on function private.estimate_kfo_base(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
-- Rebuilt from TI-541 on origin/main (20261111181152): site origin guards retained.
create or replace function private.derive_estimate_item_fo_provision()
returns trigger language plpgsql security definer set search_path = '' as $fo$
declare
  engine smallint;
  version_status public.estimate_status;
  owner_id uuid;
  manual boolean;
  tenant uuid;
  selected boolean := false;
  changed_origin boolean := false;
  source_product uuid;
  source_id uuid;
  source_kind text;
  transport text;
  product_type text;
  inferred_type uuid;
  exact_type_count integer;
  requested_selection uuid;
  preserve_absence boolean := false;
  site boolean := false;
begin
  if tg_op='INSERT' and new.fo_price_origin='{}'::jsonb then
    preserve_absence := true;
    new.fo_price_origin := null;
  end if;
  if tg_op = 'UPDATE' and new.k_fo is not distinct from old.k_fo
    and new.k_fo_manual is not distinct from old.k_fo_manual
    and new.fo_provision is not null
    and new.fo_provision is not distinct from old.fo_provision
    and new.supply_type_id is not distinct from old.supply_type_id
    and new.product_id is not distinct from old.product_id
    and new.selected_supplier_price_id is not distinct from old.selected_supplier_price_id
    and new.unit_price_ht_cents is not distinct from old.unit_price_ht_cents
    and new.fo_price_origin is not distinct from old.fo_price_origin
    and coalesce(new.line_nature::text='pose_only',false)=coalesce(old.line_nature::text='pose_only',false) then return new; end if;

  select v.calc_engine_version,v.tenant_id,v.status,p.user_id into engine,tenant,version_status,owner_id from public.estimate_versions v join public.estimate_projects p on p.id=v.project_id and p.tenant_id=v.tenant_id where v.id=new.version_id;
  if new.item_type is distinct from 'line'::public.estimate_item_type or engine is distinct from 3 then
    if new.fo_price_origin is not null or coalesce(new.fo_provision,1) <> 1 then
      raise exception using errcode='0A000',message='ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED';
    end if;
    new.fo_provision := 1;
    return new;
  end if;
  if version_status is distinct from 'draft'::public.estimate_status then return new; end if;
  -- Version duplication supplies the coefficient, provenance and saved origin verbatim.
  if tg_op='INSERT' and new.fo_provision is not null then return new; end if;

  -- Unknown legacy provenance is conservatively manual, even when K FO equals one.
  manual := coalesce(new.k_fo_manual,case when tg_op='UPDATE' then true else coalesce(new.k_fo,1) <> 1 end);
  if tg_op='UPDATE' and old.k_fo_manual is null and new.k_fo_manual is null then
    new.k_fo := coalesce(new.k_fo,1)*coalesce(old.fo_provision,1);
  end if;
  if tg_op='UPDATE' then
    if new.k_fo is null then manual := false;
    elsif new.k_fo is distinct from old.k_fo and new.k_fo_manual is null then manual := true; end if;
  end if;

  -- TI-541: a site cost is typed for this quote with its source. It never comes from the catalogue,
  -- so no catalogue row is read for it and it replaces any retained supplier offer.
  site := coalesce(new.fo_price_origin->>'kind'='site',false)
    and (tg_op='INSERT' or new.fo_price_origin is distinct from old.fo_price_origin);
  if site and new.selected_supplier_price_id is not null then
    raise exception using errcode='22023',message='FO_PRICE_SOURCE_INVALID';
  end if;

  if tg_op='INSERT' then
    selected := not preserve_absence and not site and (new.selected_supplier_price_id is not null or new.product_id is not null);
  else
    changed_origin := new.fo_price_origin is distinct from old.fo_price_origin;
    selected := not site and ((new.selected_supplier_price_id is not null and new.selected_supplier_price_id is distinct from old.selected_supplier_price_id)
      or (new.product_id is not null and new.product_id is distinct from old.product_id)
      or (changed_origin and new.fo_price_origin is not null));
    -- A catalogue origin falls with its price, its offer or its article. A kept site cost is proven by its offer,
    -- not by the catalogue: it only falls with its price, and survives a detached or deleted article.
    if not selected and not site and (new.unit_price_ht_cents is distinct from old.unit_price_ht_cents
      or coalesce(old.fo_price_origin->>'kind','')<>'site'
        and (new.selected_supplier_price_id is distinct from old.selected_supplier_price_id
          or new.product_id is distinct from old.product_id)) then
      new.fo_price_origin := null;
    end if;
  end if;

  if tg_op='INSERT' and new.fo_price_origin is not null and exists (
    select 1 from public.estimate_items source where source.tenant_id=tenant
      and source.fo_price_origin->>'selection_id'=new.fo_price_origin->>'selection_id'
      and source.fo_price_origin=new.fo_price_origin
      and (new.selected_supplier_price_id is not null and new.fo_price_origin->>'kind'='supplier'
        and new.fo_price_origin->>'source_id'=new.selected_supplier_price_id::text
        or new.selected_supplier_price_id is null and (new.product_id is null
          or new.fo_price_origin->>'kind'='reference' and new.fo_price_origin->>'source_id'=new.product_id::text))
  ) then selected := false; end if;

  if selected then
    requested_selection := (new.fo_price_origin->>'selection_id')::uuid;
    if new.selected_supplier_price_id is not null then
      select s.product_id,s.transport_mode into source_product,transport from public.supplier_pricebook s
        where s.id=new.selected_supplier_price_id and s.tenant_id=tenant for share;
      if source_product is null or new.product_id is not null and new.product_id<>source_product then
        raise exception using errcode='22023',message='FO_PRICE_SOURCE_INVALID';
      end if;
      source_kind := 'supplier'; source_id := new.selected_supplier_price_id;
      select p.product_type into product_type from public.products p where p.id=source_product and p.tenant_id=tenant for share;
    else
      source_product := new.product_id; source_kind := 'reference'; source_id := new.product_id;
      select p.product_type,p.reference_transport_mode into product_type,transport from public.products p
        where p.id=source_product and p.tenant_id=tenant for share;
      if not found then raise exception using errcode='22023',message='FO_PRICE_SOURCE_INVALID'; end if;
    end if;
    new.fo_price_origin := jsonb_build_object('selection_id',coalesce(requested_selection,source_id),
      'kind',source_kind,'source_id',source_id,'transport_mode',transport);
    if new.supply_type_id is null or tg_op='UPDATE' and new.supply_type_id is not distinct from old.supply_type_id then
      -- Exact declared family first. Isolant falls back to Calorifuge when no exact tenant type exists.
      select count(*),case when count(*)=1 then min(s.id::text)::uuid else null end into exact_type_count,inferred_type
      from public.supply_types s where s.tenant_id=tenant and (
        regexp_replace(lower(btrim(s.code)),'s$','')=regexp_replace(lower(btrim(product_type)),'s$','')
        or regexp_replace(lower(btrim(s.name)),'s$','')=regexp_replace(lower(btrim(product_type)),'s$',''));
      if exact_type_count=0 and regexp_replace(lower(btrim(product_type)),'s$','')='isolant' then
        select case when count(*)=1 then min(s.id::text)::uuid else null end into inferred_type
          from public.supply_types s where s.tenant_id=tenant and (
            regexp_replace(lower(btrim(s.code)),'s$','')='calorifuge'
            or regexp_replace(lower(btrim(s.name)),'s$','')='calorifuge');
      end if;
      new.supply_type_id := inferred_type;
    end if;
  end if;

  -- TI-534: K FO is the only supply factor. POSE SEULE has a neutral automatic base,
  -- including a site cost or small supplies; an explicit user override is always retained.
  new.k_fo_manual := manual;
  new.fo_provision := 1;
  if not manual then
    new.k_fo := case when new.line_nature::text='pose_only' then 1
      else private.estimate_kfo_base(tenant,owner_id,new.supply_type_id,new.fo_price_origin) end;
  end if;
  return new;
end;
$fo$;

do $precision$
declare definition text;
begin
 select pg_get_functiondef('private.estimate_v3_read_item(jsonb)'::regprocedure) into definition;
 definition:=replace(definition,$old$'k_fo', 3,$old$,$new$'k_fo', 6,$new$);
 execute definition;
end;
$precision$;
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
  source_is_v3 boolean;
  previous_v3_writer text;
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
  source_is_v3 := source_version.calc_engine_version = 3;
  perform pg_catalog.set_config(
    'miaouffrage.estimate_version_insert_contract',
    case when source_is_v3 then 'duplicate_source_v3' else 'duplicate_source' end,
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
    max_section_depth,
    sale_coefficient_fo,
    sale_coefficient_mo,
    gross_ht_cents,
    discount_applied_cents,
    commercial_rounding_cents
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
    source_version.max_section_depth,
    source_version.sale_coefficient_fo,
    source_version.sale_coefficient_mo,
    source_version.gross_ht_cents,
    source_version.discount_applied_cents,
    source_version.commercial_rounding_cents
  );

  perform pg_catalog.set_config(
    'miaouffrage.estimate_version_insert_contract',
    previous_insert_contract,
    true
  );

  previous_v3_writer := coalesce(
    pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true),
    ''
  );
  if source_is_v3 then
    perform pg_catalog.set_config(
      'miaouffrage.estimate_v3_writer',
      new_version_id::text,
      true
    );
  end if;

  if source_is_v3 then
    -- D13 : les répartitions exactes v3 (remise, TVA) départagent leurs ex aequo par identifiant de ligne
    -- croissant. Les identifiants neufs suivent donc l'ordre des identifiants source (le k-ième plus petit
    -- source reçoit le k-ième plus petit neuf) : les montants copiés restent ceux que le moteur calcule
    -- sur la copie, et ni son gel ni son lot suivant ne déplacent un centime d'une ligne non touchée.
    select coalesce(
      jsonb_object_agg(source_ids.id::text, fresh_ids.id::text),
      '{}'::jsonb
    )
      into item_id_map
    from (
      select item.id, row_number() over (order by item.id) as id_rank
      from public.estimate_items as item
      where item.version_id = duplicate_estimate_version_without_product_id.source_version_id
        and item.tenant_id = source_version.tenant_id
    ) as source_ids
    join (
      select fresh.id, row_number() over (order by fresh.id) as id_rank
      from (
        select gen_random_uuid() as id
        from public.estimate_items as item
        where item.version_id = duplicate_estimate_version_without_product_id.source_version_id
          and item.tenant_id = source_version.tenant_id
      ) as fresh
    ) as fresh_ids on fresh_ids.id_rank = source_ids.id_rank;
  else
    select coalesce(
      jsonb_object_agg(item.id::text, gen_random_uuid()::text),
      '{}'::jsonb
    )
      into item_id_map
    from public.estimate_items as item
    where item.version_id = duplicate_estimate_version_without_product_id.source_version_id
      and item.tenant_id = source_version.tenant_id;
  end if;

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
    k_fo_manual,
    fo_provision, -- TI-534 (ajout) : la copie garde la provision de chaque ligne
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
    selected_supplier_price_id,fo_price_origin,
    source_provider,
    source_job_id,
    source_file_name,
    source_page,
    source_metadata,
    line_total_ht_cents,
    line_tax_cents,
    line_total_ttc_cents,
    unit_code,
    pricing_status,
    h_mo_per_unit,
    h_mo_atelier_per_unit,
    h_mo_chantier_per_unit,
    product_id,
    was_not_priced, -- TI-682 (ajout) : la copie garde « a été Non chiffrée »
    status_reason, -- TI-682 (ajout) : et le motif interne
    line_nature -- TI-539 (ajout) : la copie garde la nature choisie de chaque ligne
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
    case when source_is_v3 then round(coalesce(src.k_fo,1)*coalesce(src.fo_provision,1),6) else src.k_fo end,
    case when source_is_v3 then coalesce(src.k_fo_manual,true) end,
    case when source_is_v3 then 1 else src.fo_provision end, -- unified factor copied once
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
    src.selected_supplier_price_id,src.fo_price_origin,
    src.source_provider,
    src.source_job_id,
    src.source_file_name,
    src.source_page,
    coalesce(src.source_metadata, '{}'::jsonb),
    src.line_total_ht_cents,
    src.line_tax_cents,
    src.line_total_ttc_cents,
    src.unit_code,
    src.pricing_status,
    src.h_mo_per_unit,
    src.h_mo_atelier_per_unit,
    src.h_mo_chantier_per_unit,
    case when source_is_v3 then src.product_id end,
    src.was_not_priced, -- TI-682 (ajout)
    src.status_reason, -- TI-682 (ajout)
    src.line_nature -- TI-539 (ajout)
  from source_item_hierarchy hierarchy
  join public.estimate_items src on src.id = hierarchy.id
  order by hierarchy.depth asc, src.position asc, src.id asc;

  if source_is_v3 then
    perform pg_catalog.set_config(
      'miaouffrage.estimate_v3_writer',
      previous_v3_writer,
      true
    );
  end if;

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
    decided_by,
    quantity_snapshot
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
    src.decided_by,
    src.quantity_snapshot
  from public.takeoff_dpgf_review_decisions src
  where src.version_id = duplicate_estimate_version_without_product_id.source_version_id;

  return new_version_id;
end;
$function$
;
-- The neutral retired provision carries no information; omit it from compact write receipts.
-- Public read decoders restore its neutral default. Non-neutral historical provisions are kept.
create function private.estimate_kfo_receipt_item(p_item jsonb) returns jsonb language sql immutable set search_path='' as $$
 select (case when p_item->>'fo_provision'='1.000' then p_item-'fo_provision' else p_item end)
  || case when p_item->>'k_fo' is not null then jsonb_build_object('k_fo',trim_scale((p_item->>'k_fo')::numeric)) else '{}'::jsonb end;
$$;
revoke all on function private.estimate_kfo_receipt_item(jsonb) from public,anon,authenticated;

-- Extend the existing guarded writers rather than adding a bypass path.
do $writers$
declare routine record; definition text;
begin
 for routine in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.proname in ('canonical_estimate_batch_operations','commit_estimate_batch','atomic_create_estimate_item','persist_estimate_creation_atomic') loop
   select pg_get_functiondef(routine.oid) into definition;
   definition:=replace(definition,$old$'k_fo','h_mo'$old$,$new$'k_fo','k_fo_manual','h_mo'$new$);
   definition:=replace(definition,'tax_rate_bp,k_fo,h_mo','tax_rate_bp,k_fo,k_fo_manual,h_mo');
   definition:=replace(definition,'i.tax_rate_bp,i.k_fo,i.h_mo','i.tax_rate_bp,i.k_fo,i.k_fo_manual,i.h_mo');
   definition:=replace(definition,'item.tax_rate_bp,item.k_fo,item.h_mo','item.tax_rate_bp,item.k_fo,item.k_fo_manual,item.h_mo');
   definition:=replace(definition,'k_fo=item.k_fo,','k_fo=item.k_fo,k_fo_manual=item.k_fo_manual,');
   definition:=replace(definition,$old$elsif key='fo_price_origin' then$old$,$new$elsif key='k_fo_manual' then
        if jsonb_typeof(value) is distinct from 'boolean' then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      elsif key='fo_price_origin' then$new$);
   definition:=replace(definition,'item_row.tax_rate_bp,item_row.k_fo,item_row.h_mo','item_row.tax_rate_bp,item_row.k_fo,item_row.k_fo_manual,item_row.h_mo');
   definition:=replace(definition,'k_fo=item_row.k_fo,','k_fo=item_row.k_fo,k_fo_manual=item_row.k_fo_manual,');
   if (select proname from pg_proc where oid=routine.oid)='commit_estimate_batch' then
     -- An explicit coefficient without a mode is a manual API edit; false is an explicit refresh.
     definition:=replace(definition,
       $old$select * into item from jsonb_populate_record(old_item,data-array[$old$,
       $new$if is_v3 and data ? 'k_fo' and not (data ? 'k_fo_manual') then
         data:=data||jsonb_build_object('k_fo_manual',true);
       end if;
       select * into item from jsonb_populate_record(old_item,data-array[$new$);
     definition:=replace(definition,'to_jsonb(i)', 'private.estimate_kfo_receipt_item(to_jsonb(i))');
   end if;
   execute definition;
 end loop;
end;
$writers$;

-- New supply families get current defaults without requiring a material-name heuristic.
alter table public.supply_types alter column default_fo_provision drop default;
create function private.initialize_kfo_company_default() returns trigger language plpgsql set search_path='' as $$
begin
 if new.default_fo_provision is null then new.default_fo_provision:=case when lower(btrim(new.code)) in ('tube','tubes') or lower(btrim(new.name)) in ('tube','tubes') then 1.130 else 1.020 end; end if;
 return new;
end;
$$;
revoke all on function private.initialize_kfo_company_default() from public,anon,authenticated;
create trigger initialize_kfo_company_default before insert on public.supply_types for each row execute function private.initialize_kfo_company_default();

-- Persist the kit boundary so editors and client documents can hide decomposition without losing its costs.
do $kit$
declare definition text;
begin
 select pg_get_functiondef('public.materialize_estimate_assembly_tree(uuid,uuid,uuid,integer,numeric,integer)'::regprocedure) into definition;
 definition:=replace(definition,$old$tenant_id, version_id, parent_id, item_type, position, title
  )$old$,$new$tenant_id, version_id, parent_id, item_type, position, title, source_metadata
  )$new$);
 definition:=replace(definition,$old$    source_assembly.name
  )$old$,$new$    source_assembly.name,
    jsonb_build_object('kit_metier',true,'assembly_id',source_assembly.id)
  )$new$);
 execute definition;
end;
$kit$;
create function private.guard_kfo_company_update()
returns trigger language plpgsql security definer set search_path='' as $$
declare expected numeric;
begin
  if current_setting('role',true) = 'authenticated'
    and not public.has_tenant_role(new.tenant_id,array['admin'::public.tenant_role]) then
    if tg_op='UPDATE' then
      if new.default_fo_provision is distinct from old.default_fo_provision then
        raise exception using errcode='42501',message='KFO_COMPANY_ADMIN_REQUIRED';
      end if;
    else
      expected := case when lower(btrim(new.code)) in ('tube','tubes') or lower(btrim(new.name)) in ('tube','tubes') then 1.130 else 1.020 end;
      if new.default_fo_provision is not null and new.default_fo_provision <> expected then
        raise exception using errcode='42501',message='KFO_COMPANY_ADMIN_REQUIRED';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_kfo_company_update() from public,anon,authenticated;
create trigger guard_kfo_company_update before insert or update of default_fo_provision on public.supply_types
for each row execute function private.guard_kfo_company_update();
do $kit_contract$
declare definition text; previous text; signature text;
begin
 foreach signature in array array['public.estimate_offer_client_valid(jsonb,jsonb)','public.estimate_offer_client_valid_v2(jsonb,jsonb)'] loop
  select pg_get_functiondef(signature::regprocedure) into definition;
  previous := definition;
  definition := replace(definition,
    $old$if row_value->>'kind'='section' then required:=required||array['number'];$old$,
    $new$if row_value->>'kind'='section' then
      required:=required||array['number'];
      if row_value ? 'kitMetier' then
        if row_value->'kitMetier' is distinct from 'true'::jsonb then return false; end if;
        required:=required||array['kitMetier'];
      end if;$new$);
  if definition=previous then raise exception 'TI534_KIT_CONTRACT_ANCHOR %',signature; end if;
  execute definition;
 end loop;
end;
$kit_contract$;

-- Saved templates carry effective supply prices and their hidden-kit boundary.
alter table public.estimate_template_items add column k_fo_manual boolean;
alter table public.estimate_template_items add column kit_metier boolean not null default false;
alter table public.estimate_template_items add column line_nature public.estimate_line_nature;
alter table public.estimate_template_items add column fo_price_origin jsonb;
do $templates$
declare definition text; previous text;
begin
 select pg_get_functiondef('public.create_estimate_template_from_version(uuid,text,text)'::regprocedure) into definition;
 previous := definition;
 definition := replace(definition,'    src.k_fo,','    case when source_version.calc_engine_version=3 and src.item_type=''line'' then round(coalesce(src.k_fo,1)*coalesce(src.fo_provision,1),6) else src.k_fo end,');
 definition := replace(definition,E'    h_mo_chantier_per_unit\n  )',E'    h_mo_chantier_per_unit, k_fo_manual, kit_metier, line_nature, fo_price_origin\n  )');
 definition := replace(definition,E'    src.h_mo_chantier_per_unit\n  from',E'    src.h_mo_chantier_per_unit,\n    case when source_version.calc_engine_version=3 and src.item_type=''line'' then true end,\n    coalesce(src.source_metadata @> ''{"kit_metier":true}''::jsonb,false), src.line_nature, src.fo_price_origin\n  from');
 if definition=previous or position('kit_metier' in definition)=0 then raise exception 'TI534_TEMPLATE_SAVE_ANCHOR'; end if;
 execute definition;
 select pg_get_functiondef('public.duplicate_estimate_template(uuid,text)'::regprocedure) into definition;
 previous := definition;
 definition := replace(definition,E'    h_mo_chantier_per_unit\n  )',E'    h_mo_chantier_per_unit, k_fo_manual, kit_metier, line_nature, fo_price_origin\n  )');
 definition := replace(definition,E'    src.h_mo_chantier_per_unit\n  from',E'    src.h_mo_chantier_per_unit, src.k_fo_manual, src.kit_metier, src.line_nature, src.fo_price_origin\n  from');
 if definition=previous or position('src.kit_metier' in definition)=0 then raise exception 'TI534_TEMPLATE_DUPLICATE_ANCHOR'; end if;
 execute definition;
 select pg_get_functiondef('public.insert_estimate_template_into_version(uuid,uuid,uuid)'::regprocedure) into definition;
 previous := definition;
 definition := replace(definition,E'h_mo_atelier_per_unit, h_mo_chantier_per_unit\n    )',E'h_mo_atelier_per_unit, h_mo_chantier_per_unit, k_fo_manual, source_metadata, line_nature, fo_price_origin\n    )');
 definition := replace(definition,E'      chantier_per_unit\n    )',E'      chantier_per_unit,\n      case when is_v3 then tpl_item.k_fo_manual end,\n      case when tpl_item.kit_metier then ''{"kit_metier":true}''::jsonb else ''{}''::jsonb end,\n      tpl_item.line_nature,\n      case when is_v3 then tpl_item.fo_price_origin end\n    )');
 if definition=previous or position('tpl_item.kit_metier' in definition)=0 then raise exception 'TI534_TEMPLATE_INSERT_ANCHOR'; end if;
 execute definition;
 -- A section saved as an ouvrage records an explicit coefficient in component metadata.
 select pg_get_functiondef('public.materialize_estimate_assembly_tree(uuid,uuid,uuid,integer,numeric,integer)'::regprocedure) into definition;
 previous := definition;
 definition := replace(definition,'description, quantity, unit_price_ht_cents, tax_rate_bp, k_fo,','description, quantity, unit_price_ht_cents, tax_rate_bp, k_fo, k_fo_manual,');
 definition := replace(definition,'        coalesce(assembly_item.k_fo, 1),',E'        coalesce(assembly_item.k_fo, 1),\n        case when target_version.calc_engine_version=3 and assembly_item.source_metadata @> ''{"k_fo_manual":true}''::jsonb then true end,');
 if definition=previous or position('k_fo_manual' in definition)=0 then raise exception 'TI534_ASSEMBLY_SNAPSHOT_ANCHOR'; end if;
 execute definition;
end;
$templates$;
commit;
