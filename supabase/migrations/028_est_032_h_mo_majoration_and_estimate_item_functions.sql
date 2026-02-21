-- EST-032: add h_mo_majoration and extend estimate item SQL functions.

alter table public.estimate_items
  add column if not exists h_mo_majoration numeric(12,4) default 1.0,
  add column if not exists h_mo_atelier numeric(12,3),
  add column if not exists k_mo_atelier numeric(12,3) default 1.0,
  add column if not exists labor_role_atelier_id uuid,
  add column if not exists h_mo_chantier numeric(12,3),
  add column if not exists k_mo_chantier numeric(12,3) default 1.0,
  add column if not exists labor_role_chantier_id uuid;

update public.estimate_items
set
  h_mo_majoration = case when item_type = 'section' then 1.0 else coalesce(h_mo_majoration, 1.0) end,
  k_mo_atelier = case when item_type = 'section' then 1.0 else coalesce(k_mo_atelier, 1.0) end,
  k_mo_chantier = case when item_type = 'section' then 1.0 else coalesce(k_mo_chantier, 1.0) end,
  h_mo_atelier = case when item_type = 'section' then null else h_mo_atelier end,
  h_mo_chantier = case when item_type = 'section' then null else h_mo_chantier end,
  labor_role_atelier_id = case when item_type = 'section' then null else labor_role_atelier_id end,
  labor_role_chantier_id = case when item_type = 'section' then null else labor_role_chantier_id end
where h_mo_majoration is null
   or k_mo_atelier is null
   or k_mo_chantier is null
   or item_type = 'section';

alter table public.estimate_items
  alter column h_mo_majoration set default 1.0;

alter table public.estimate_items
  alter column h_mo_majoration set not null;

alter table public.estimate_items
  drop constraint if exists estimate_items_h_mo_majoration_nonnegative_check;

alter table public.estimate_items
  add constraint estimate_items_h_mo_majoration_nonnegative_check
  check (h_mo_majoration >= 0);

do $$
declare
  payload_constraint record;
begin
  for payload_constraint in
    select c.conname
    from pg_constraint c
    join pg_class t
      on t.oid = c.conrelid
    join pg_namespace n
      on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'estimate_items'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%item_type = ''section''%'
      and pg_get_constraintdef(c.oid) ilike '%item_type = ''line''%'
  loop
    execute format(
      'alter table public.estimate_items drop constraint if exists %I',
      payload_constraint.conname
    );
  end loop;
end;
$$;

alter table public.estimate_items
  drop constraint if exists estimate_items_item_type_payload_check;

alter table public.estimate_items
  add constraint estimate_items_item_type_payload_check
  check (
    (
      item_type = 'section'
      and quantity is null
      and unit_price_ht_cents is null
      and tax_rate_bp is null
      and k_fo is null
      and h_mo is null
      and h_mo_majoration = 1.0
      and k_mo is null
      and h_mo_atelier is null
      and k_mo_atelier = 1.0
      and labor_role_atelier_id is null
      and h_mo_chantier is null
      and k_mo_chantier = 1.0
      and labor_role_chantier_id is null
      and pu_ht_cents is null
      and labor_role_id is null
      and category_id is null
      and supply_type_id is null
      and line_total_ht_cents is null
      and line_tax_cents is null
      and line_total_ttc_cents is null
    )
    or
    (
      item_type = 'line'
      and quantity is not null
      and unit_price_ht_cents is not null
      and tax_rate_bp is not null
      and k_fo is not null
      and h_mo is not null
      and h_mo_majoration is not null
      and k_mo is not null
      and pu_ht_cents is not null
      and line_total_ht_cents is not null
      and line_tax_cents is not null
      and line_total_ttc_cents is not null
    )
  );

drop function if exists public.snapshot_estimate_item_bulk_updates(uuid, jsonb);

create function public.snapshot_estimate_item_bulk_updates(
  target_version_id uuid,
  item_updates jsonb
)
returns table (
  id uuid,
  parent_id uuid,
  item_position integer,
  title text,
  description text,
  quantity numeric(12,3),
  unit_price_ht_cents integer,
  tax_rate_bp integer,
  k_fo numeric(12,3),
  h_mo numeric(12,3),
  h_mo_majoration numeric(12,4),
  k_mo numeric(12,3),
  h_mo_atelier numeric(12,3),
  k_mo_atelier numeric(12,3),
  labor_role_atelier_id uuid,
  h_mo_chantier numeric(12,3),
  k_mo_chantier numeric(12,3),
  labor_role_chantier_id uuid,
  pu_ht_cents integer,
  labor_role_id uuid,
  category_id uuid,
  supply_type_id uuid,
  line_total_ht_cents integer,
  line_tax_cents integer,
  line_total_ttc_cents integer
)
language sql
stable
set search_path = public
as $$
  with requested_updates as (
    select value as payload
    from jsonb_array_elements(item_updates)
  )
  select
    item.id,
    case
      when requested.payload ? 'parent_id'
        then nullif(requested.payload->>'parent_id', '')::uuid
      else item.parent_id
    end as parent_id,
    case
      when requested.payload ? 'position'
        then (requested.payload->>'position')::integer
      else item.position
    end as item_position,
    case
      when requested.payload ? 'title'
        then requested.payload->>'title'
      else item.title
    end as title,
    case
      when requested.payload ? 'description'
        then nullif(btrim(requested.payload->>'description'), '')
      else item.description
    end as description,
    case
      when requested.payload ? 'quantity'
        then (requested.payload->>'quantity')::numeric(12,3)
      else item.quantity
    end as quantity,
    case
      when requested.payload ? 'unit_price_ht_cents'
        then (requested.payload->>'unit_price_ht_cents')::integer
      else item.unit_price_ht_cents
    end as unit_price_ht_cents,
    case
      when requested.payload ? 'tax_rate_bp'
        then (requested.payload->>'tax_rate_bp')::integer
      else item.tax_rate_bp
    end as tax_rate_bp,
    case
      when requested.payload ? 'k_fo'
        then (requested.payload->>'k_fo')::numeric(12,3)
      else item.k_fo
    end as k_fo,
    case
      when requested.payload ? 'h_mo'
        then (requested.payload->>'h_mo')::numeric(12,3)
      else item.h_mo
    end as h_mo,
    case
      when requested.payload ? 'h_mo_majoration'
        then (requested.payload->>'h_mo_majoration')::numeric(12,4)
      else item.h_mo_majoration
    end as h_mo_majoration,
    case
      when requested.payload ? 'k_mo'
        then (requested.payload->>'k_mo')::numeric(12,3)
      else item.k_mo
    end as k_mo,
    case
      when requested.payload ? 'h_mo_atelier'
        then (requested.payload->>'h_mo_atelier')::numeric(12,3)
      else item.h_mo_atelier
    end as h_mo_atelier,
    case
      when requested.payload ? 'k_mo_atelier'
        then (requested.payload->>'k_mo_atelier')::numeric(12,3)
      else item.k_mo_atelier
    end as k_mo_atelier,
    case
      when requested.payload ? 'labor_role_atelier_id'
        then nullif(requested.payload->>'labor_role_atelier_id', '')::uuid
      else item.labor_role_atelier_id
    end as labor_role_atelier_id,
    case
      when requested.payload ? 'h_mo_chantier'
        then (requested.payload->>'h_mo_chantier')::numeric(12,3)
      else item.h_mo_chantier
    end as h_mo_chantier,
    case
      when requested.payload ? 'k_mo_chantier'
        then (requested.payload->>'k_mo_chantier')::numeric(12,3)
      else item.k_mo_chantier
    end as k_mo_chantier,
    case
      when requested.payload ? 'labor_role_chantier_id'
        then nullif(requested.payload->>'labor_role_chantier_id', '')::uuid
      else item.labor_role_chantier_id
    end as labor_role_chantier_id,
    case
      when requested.payload ? 'pu_ht_cents'
        then (requested.payload->>'pu_ht_cents')::integer
      else item.pu_ht_cents
    end as pu_ht_cents,
    case
      when requested.payload ? 'labor_role_id'
        then nullif(requested.payload->>'labor_role_id', '')::uuid
      else item.labor_role_id
    end as labor_role_id,
    case
      when requested.payload ? 'category_id'
        then nullif(requested.payload->>'category_id', '')::uuid
      else item.category_id
    end as category_id,
    case
      when requested.payload ? 'supply_type_id'
        then nullif(requested.payload->>'supply_type_id', '')::uuid
      else item.supply_type_id
    end as supply_type_id,
    case
      when requested.payload ? 'line_total_ht_cents'
        then (requested.payload->>'line_total_ht_cents')::integer
      else item.line_total_ht_cents
    end as line_total_ht_cents,
    case
      when requested.payload ? 'line_tax_cents'
        then (requested.payload->>'line_tax_cents')::integer
      else item.line_tax_cents
    end as line_tax_cents,
    case
      when requested.payload ? 'line_total_ttc_cents'
        then (requested.payload->>'line_total_ttc_cents')::integer
      else item.line_total_ttc_cents
    end as line_total_ttc_cents
  from requested_updates requested
  join public.estimate_items item
    on item.id = (requested.payload->>'id')::uuid
    and item.version_id = target_version_id;
$$;

drop function if exists public.bulk_update_estimate_items(uuid, jsonb);
drop function if exists public.bulk_update_estimate_items(uuid, jsonb, jsonb);
drop function if exists public.bulk_update_estimate_items(uuid, jsonb, jsonb, timestamptz);

create or replace function public.bulk_update_estimate_items(
  target_version_id uuid,
  item_updates jsonb,
  version_patch jsonb default null,
  expected_version_updated_at timestamptz default null
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  updated_count integer := 0;
  expected_count integer := 0;
  snapshot_count integer := 0;
  locked_count integer := 0;
  version_locked_count integer := 0;
  effective_version_patch jsonb := coalesce(version_patch, '{}'::jsonb);
begin
  if coalesce(jsonb_typeof(item_updates), '') <> 'array' then
    raise exception 'item_updates must be a JSON array';
  end if;

  if expected_version_updated_at is null then
    raise exception 'expected_version_updated_at is required';
  end if;

  if version_patch is not null and jsonb_typeof(version_patch) <> 'object' then
    raise exception 'version_patch must be a JSON object';
  end if;

  if effective_version_patch - array['total_ht_cents', 'total_tax_cents', 'total_ttc_cents'] <> '{}'::jsonb then
    raise exception 'version_patch supports only total_ht_cents, total_tax_cents, total_ttc_cents';
  end if;

  expected_count := coalesce(jsonb_array_length(item_updates), 0);

  perform ev.id
  from public.estimate_versions ev
  where ev.id = target_version_id
    and ev.updated_at = expected_version_updated_at
  for update;

  get diagnostics version_locked_count = row_count;

  if version_locked_count <> 1 then
    raise exception
      using
        errcode = 'P0001',
        message = 'STALE_BULK_UPDATE_ITEMS',
        detail = format(
          'expected_count=%s,locked_count=%s',
          1,
          version_locked_count
        );
  end if;

  if expected_count > 0 then
    create temporary table _estimate_item_bulk_snapshot (
      id uuid primary key,
      parent_id uuid,
      item_position integer,
      title text,
      description text,
      quantity numeric(12,3),
      unit_price_ht_cents integer,
      tax_rate_bp integer,
      k_fo numeric(12,3),
      h_mo numeric(12,3),
      h_mo_majoration numeric(12,4),
      k_mo numeric(12,3),
      h_mo_atelier numeric(12,3),
      k_mo_atelier numeric(12,3),
      labor_role_atelier_id uuid,
      h_mo_chantier numeric(12,3),
      k_mo_chantier numeric(12,3),
      labor_role_chantier_id uuid,
      pu_ht_cents integer,
      labor_role_id uuid,
      category_id uuid,
      supply_type_id uuid,
      line_total_ht_cents integer,
      line_tax_cents integer,
      line_total_ttc_cents integer
    ) on commit drop;

    insert into _estimate_item_bulk_snapshot (
      id,
      parent_id,
      item_position,
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
      snapshot.id,
      snapshot.parent_id,
      snapshot.item_position,
      snapshot.title,
      snapshot.description,
      snapshot.quantity,
      snapshot.unit_price_ht_cents,
      snapshot.tax_rate_bp,
      snapshot.k_fo,
      snapshot.h_mo,
      snapshot.h_mo_majoration,
      snapshot.k_mo,
      snapshot.h_mo_atelier,
      snapshot.k_mo_atelier,
      snapshot.labor_role_atelier_id,
      snapshot.h_mo_chantier,
      snapshot.k_mo_chantier,
      snapshot.labor_role_chantier_id,
      snapshot.pu_ht_cents,
      snapshot.labor_role_id,
      snapshot.category_id,
      snapshot.supply_type_id,
      snapshot.line_total_ht_cents,
      snapshot.line_tax_cents,
      snapshot.line_total_ttc_cents
    from public.snapshot_estimate_item_bulk_updates(target_version_id, item_updates) snapshot;

    select count(*)
      into snapshot_count
    from _estimate_item_bulk_snapshot;

    if snapshot_count <> expected_count then
      raise exception
        using
          errcode = 'P0001',
          message = 'STALE_BULK_UPDATE_ITEMS',
          detail = format(
            'expected_count=%s,updated_count=%s',
            expected_count,
            snapshot_count
          );
    end if;

    perform item.id
    from public.estimate_items item
    join _estimate_item_bulk_snapshot snapshot
      on item.id = snapshot.id
      and item.version_id = target_version_id
    for update;

    get diagnostics locked_count = row_count;

    if locked_count <> expected_count then
      raise exception
        using
          errcode = 'P0001',
          message = 'STALE_BULK_UPDATE_ITEMS',
          detail = format(
            'expected_count=%s,locked_count=%s',
            expected_count,
            locked_count
          );
    end if;

    update public.estimate_items item
    set position = -snapshot.item_position
    from _estimate_item_bulk_snapshot snapshot
    where item.id = snapshot.id
      and item.version_id = target_version_id;

    update public.estimate_items item
    set
      parent_id = snapshot.parent_id,
      position = snapshot.item_position,
      title = snapshot.title,
      description = snapshot.description,
      quantity = snapshot.quantity,
      unit_price_ht_cents = snapshot.unit_price_ht_cents,
      tax_rate_bp = snapshot.tax_rate_bp,
      k_fo = snapshot.k_fo,
      h_mo = snapshot.h_mo,
      h_mo_majoration = snapshot.h_mo_majoration,
      k_mo = snapshot.k_mo,
      h_mo_atelier = snapshot.h_mo_atelier,
      k_mo_atelier = snapshot.k_mo_atelier,
      labor_role_atelier_id = snapshot.labor_role_atelier_id,
      h_mo_chantier = snapshot.h_mo_chantier,
      k_mo_chantier = snapshot.k_mo_chantier,
      labor_role_chantier_id = snapshot.labor_role_chantier_id,
      pu_ht_cents = snapshot.pu_ht_cents,
      labor_role_id = snapshot.labor_role_id,
      category_id = snapshot.category_id,
      supply_type_id = snapshot.supply_type_id,
      line_total_ht_cents = snapshot.line_total_ht_cents,
      line_tax_cents = snapshot.line_tax_cents,
      line_total_ttc_cents = snapshot.line_total_ttc_cents
    from _estimate_item_bulk_snapshot snapshot
    where item.id = snapshot.id
      and item.version_id = target_version_id;

    get diagnostics updated_count = row_count;

    if updated_count <> expected_count then
      raise exception
        using
          errcode = 'P0001',
          message = 'STALE_BULK_UPDATE_ITEMS',
          detail = format(
            'expected_count=%s,updated_count=%s',
            expected_count,
            updated_count
          );
    end if;
  end if;

  if effective_version_patch <> '{}'::jsonb then
    update public.estimate_versions ev
    set
      total_ht_cents = case
        when effective_version_patch ? 'total_ht_cents'
          then (effective_version_patch->>'total_ht_cents')::integer
        else ev.total_ht_cents
      end,
      total_tax_cents = case
        when effective_version_patch ? 'total_tax_cents'
          then (effective_version_patch->>'total_tax_cents')::integer
        else ev.total_tax_cents
      end,
      total_ttc_cents = case
        when effective_version_patch ? 'total_ttc_cents'
          then (effective_version_patch->>'total_ttc_cents')::integer
        else ev.total_ttc_cents
      end
    where ev.id = target_version_id;
  end if;

  return updated_count;
end;
$$;

create or replace function public.duplicate_estimate_version(source_version_id uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  source_version public.estimate_versions%rowtype;
  new_version_id uuid := gen_random_uuid();
  new_version_number integer;
begin
  select v.*
    into source_version
  from public.estimate_versions v
  join public.estimate_projects p on p.id = v.project_id
  where v.id = source_version_id
    and (select public.is_tenant_member(p.tenant_id))
    and (
      p.user_id = (select auth.uid())
      or (select public.has_tenant_role(p.tenant_id, array['admin'::public.tenant_role]))
    );

  if not found then
    raise exception 'Estimate version not found or access denied';
  end if;

  select coalesce(max(version_number), 0) + 1
    into new_version_number
  from public.estimate_versions
  where project_id = source_version.project_id;

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
    currency,
    margin_bp,
    discount_bp,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    total_ht_cents,
    total_tax_cents,
    total_ttc_cents
  )
  values (
    new_version_id,
    source_version.tenant_id,
    source_version.project_id,
    new_version_number,
    'draft',
    source_version.title,
    source_version.date_devis,
    source_version.validite_jours,
    source_version.margin_multiplier,
    source_version.currency,
    source_version.margin_bp,
    source_version.discount_bp,
    source_version.tax_rate_bp,
    source_version.rounding_mode,
    source_version.rounding_step_cents,
    source_version.total_ht_cents,
    source_version.total_tax_cents,
    source_version.total_ttc_cents
  );

  create temporary table _estimate_item_map (
    old_id uuid primary key,
    new_id uuid not null
  ) on commit drop;

  insert into _estimate_item_map (old_id, new_id)
  select id, gen_random_uuid()
  from public.estimate_items
  where version_id = source_version_id;

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
    line_total_ht_cents,
    line_tax_cents,
    line_total_ttc_cents
  )
  select
    map.new_id,
    source_version.tenant_id,
    new_version_id,
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
  join _estimate_item_map map on map.old_id = src.id
  left join _estimate_item_map parent_map on parent_map.old_id = src.parent_id;

  return new_version_id;
end;
$$;
