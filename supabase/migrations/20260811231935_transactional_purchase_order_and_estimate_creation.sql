-- Keep the API's nullable ISO date / "TBD" contract representable in PostgreSQL.
alter table public.purchase_orders
  alter column expected_delivery_date type text
  using to_char(expected_delivery_date, 'YYYY-MM-DD');

alter table public.purchase_orders
  drop constraint if exists purchase_orders_expected_delivery_date_check;

alter table public.purchase_orders
  add constraint purchase_orders_expected_delivery_date_check
  check (
    expected_delivery_date is null
    or expected_delivery_date = 'TBD'
    or (
      expected_delivery_date ~ '^\d{4}-\d{2}-\d{2}$'
      and to_char(
        to_date(expected_delivery_date, 'FXYYYY-MM-DD'),
        'YYYY-MM-DD'
      ) = expected_delivery_date
    )
  );

-- Make the relation privileges used by the existing Data API routes explicit.
revoke all privileges
  on table
    public.suppliers,
    public.delivery_sites,
    public.products,
    public.purchase_orders,
    public.purchase_order_items
  from anon, authenticated, PUBLIC;

grant select, insert, update, delete
  on table
    public.suppliers,
    public.delivery_sites,
    public.products,
    public.purchase_orders,
    public.purchase_order_items
  to authenticated;

-- A status check performed before DELETE is subject to a TOCTOU race. This
-- restrictive policy makes the draft invariant authoritative at write time.
drop policy if exists "Draft purchase orders can be deleted"
  on public.purchase_orders;
create policy "Draft purchase orders can be deleted"
  on public.purchase_orders
  as restrictive
  for delete
  to authenticated
  using (status = 'draft'::public.purchase_order_status);

-- PurchaseOrderStatusUpdater historically supports every status-only change,
-- including reopening an order as draft. Preserve that UI contract while
-- preventing all mixed status/header writes and non-draft header edits.
create or replace function public.guard_purchase_order_header_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft'::public.purchase_order_status
    and (to_jsonb(new) - array['status', 'updated_at'])
      is distinct from (to_jsonb(old) - array['status', 'updated_at'])
  then
    raise exception using
      errcode = '55000',
      message = 'PURCHASE_ORDER_HEADER_READ_ONLY';
  end if;

  if new.status is distinct from old.status
    and (to_jsonb(new) - array['status', 'updated_at'])
      is distinct from (to_jsonb(old) - array['status', 'updated_at'])
  then
    raise exception using
      errcode = '55000',
      message = 'PURCHASE_ORDER_STATUS_UPDATE_MUST_BE_ISOLATED';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_purchase_order_header_mutation
  on public.purchase_orders;
create trigger guard_purchase_order_header_mutation
  before update on public.purchase_orders
  for each row execute procedure public.guard_purchase_order_header_mutation();

drop policy if exists "Draft purchase orders accept inserted items"
  on public.purchase_order_items;
create policy "Draft purchase orders accept inserted items"
  on public.purchase_order_items
  as restrictive
  for insert
  to authenticated
  with check (exists (
    select 1
    from public.purchase_orders as purchase_order
    where purchase_order.id = purchase_order_items.purchase_order_id
      and purchase_order.tenant_id = purchase_order_items.tenant_id
      and purchase_order.status = 'draft'::public.purchase_order_status
  ));

drop policy if exists "Draft purchase orders accept updated items"
  on public.purchase_order_items;
create policy "Draft purchase orders accept updated items"
  on public.purchase_order_items
  as restrictive
  for update
  to authenticated
  using (exists (
    select 1
    from public.purchase_orders as purchase_order
    where purchase_order.id = purchase_order_items.purchase_order_id
      and purchase_order.tenant_id = purchase_order_items.tenant_id
      and purchase_order.status = 'draft'::public.purchase_order_status
  ))
  with check (exists (
    select 1
    from public.purchase_orders as purchase_order
    where purchase_order.id = purchase_order_items.purchase_order_id
      and purchase_order.tenant_id = purchase_order_items.tenant_id
      and purchase_order.status = 'draft'::public.purchase_order_status
  ));

drop policy if exists "Draft purchase orders accept deleted items"
  on public.purchase_order_items;
create policy "Draft purchase orders accept deleted items"
  on public.purchase_order_items
  as restrictive
  for delete
  to authenticated
  using (exists (
    select 1
    from public.purchase_orders as purchase_order
    where purchase_order.id = purchase_order_items.purchase_order_id
      and purchase_order.tenant_id = purchase_order_items.tenant_id
      and purchase_order.status = 'draft'::public.purchase_order_status
  ));

-- The admin reset page is an explicit, confirmed destructive workflow. Keep
-- that exceptional all-status cleanup out of the ordinary Data API policies.
create or replace function public.delete_tenant_purchase_orders_for_reset(
  p_tenant_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  if (select auth.uid()) is null
    or not (select public.has_tenant_role(
      p_tenant_id,
      array['admin'::public.tenant_role]
    ))
  then
    raise exception using
      errcode = '42501',
      message = 'PURCHASE_ORDER_RESET_ADMIN_REQUIRED';
  end if;

  delete from public.purchase_orders as purchase_order
  where purchase_order.tenant_id = p_tenant_id;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.delete_tenant_purchase_orders_for_reset(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_tenant_purchase_orders_for_reset(uuid)
  to authenticated;

create or replace function public.replace_purchase_order_draft(
  p_order_id uuid,
  p_header_patch jsonb,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  order_row public.purchase_orders%rowtype;
  existing_items jsonb := '[]'::jsonb;
begin
  if actor_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'PURCHASE_ORDER_AUTH_REQUIRED';
  end if;

  if p_header_patch is null or jsonb_typeof(p_header_patch) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'PURCHASE_ORDER_HEADER_INVALID';
  end if;

  if p_header_patch - array[
    'supplier_id',
    'delivery_site_id',
    'expected_delivery_date',
    'notes'
  ] <> '{}'::jsonb then
    raise exception using
      errcode = '22023',
      message = 'PURCHASE_ORDER_HEADER_FIELDS_INVALID';
  end if;

  select purchase_order.*
    into order_row
  from public.purchase_orders as purchase_order
  where purchase_order.id = p_order_id
  for update;

  if order_row.id is null
    or order_row.status <> 'draft'::public.purchase_order_status
    or not (select public.has_tenant_role(
      order_row.tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
    or (
      order_row.user_id <> actor_user_id
      and not (select public.has_tenant_role(
        order_row.tenant_id,
        array['admin'::public.tenant_role]
      ))
    )
  then
    raise exception using
      errcode = '42501',
      message = 'PURCHASE_ORDER_DRAFT_NOT_EDITABLE';
  end if;

  if p_header_patch ? 'supplier_id'
    and not exists (
      select 1
      from public.suppliers as supplier
      where supplier.id = (p_header_patch->>'supplier_id')::uuid
        and supplier.tenant_id = order_row.tenant_id
    )
  then
    raise exception using
      errcode = '23503',
      message = 'PURCHASE_ORDER_SUPPLIER_SCOPE_INVALID';
  end if;

  if p_header_patch ? 'delivery_site_id'
    and not exists (
      select 1
      from public.delivery_sites as delivery_site
      where delivery_site.id = (p_header_patch->>'delivery_site_id')::uuid
        and delivery_site.tenant_id = order_row.tenant_id
    )
  then
    raise exception using
      errcode = '23503',
      message = 'PURCHASE_ORDER_DELIVERY_SITE_SCOPE_INVALID';
  end if;

  update public.purchase_orders as purchase_order
  set supplier_id = case
        when p_header_patch ? 'supplier_id'
          then (p_header_patch->>'supplier_id')::uuid
        else purchase_order.supplier_id
      end,
      delivery_site_id = case
        when p_header_patch ? 'delivery_site_id'
          then (p_header_patch->>'delivery_site_id')::uuid
        else purchase_order.delivery_site_id
      end,
      expected_delivery_date = case
        when p_header_patch ? 'expected_delivery_date'
          then nullif(p_header_patch->>'expected_delivery_date', '')
        else purchase_order.expected_delivery_date
      end,
      notes = case
        when p_header_patch ? 'notes'
          then nullif(btrim(p_header_patch->>'notes'), '')
        else purchase_order.notes
      end
  where purchase_order.id = order_row.id
    and purchase_order.tenant_id = order_row.tenant_id
    and purchase_order.status = 'draft'::public.purchase_order_status;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'PURCHASE_ORDER_DRAFT_NOT_EDITABLE';
  end if;

  if p_items is not null then
    if jsonb_typeof(p_items) <> 'array'
      or jsonb_array_length(p_items) = 0
    then
      raise exception using
        errcode = '22023',
        message = 'PURCHASE_ORDER_ITEMS_INVALID';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(p_items) as requested(item)
      where btrim(coalesce(requested.item->>'designation', '')) = ''
        or (requested.item->>'quantity')::integer <= 0
        or (requested.item->>'unit_price_ht_cents')::integer < 0
        or (requested.item->>'tax_rate_bp')::integer not between 0 and 10000
    ) then
      raise exception using
        errcode = '22023',
        message = 'PURCHASE_ORDER_ITEMS_INVALID';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(p_items) as requested(item)
      where nullif(requested.item->>'product_id', '') is not null
        and not exists (
          select 1
          from public.products as product
          where product.id = (requested.item->>'product_id')::uuid
            and product.tenant_id = order_row.tenant_id
        )
    ) then
      raise exception using
        errcode = '23503',
        message = 'PURCHASE_ORDER_PRODUCT_SCOPE_INVALID';
    end if;

    select coalesce(jsonb_agg(to_jsonb(existing)), '[]'::jsonb)
      into existing_items
    from (
      select
        item.product_id,
        item.reference,
        item.designation,
        item.quantity,
        item.unit_price_ht_cents,
        item.tax_rate_bp,
        item.source_estimate_item_id,
        item.source_selected_supplier_price_id,
        row_number() over (
          partition by
            item.product_id,
            item.reference,
            item.designation,
            item.quantity,
            item.unit_price_ht_cents,
            item.tax_rate_bp
          order by item.position, item.id
        ) as trace_rank
      from public.purchase_order_items as item
      where item.purchase_order_id = order_row.id
        and item.tenant_id = order_row.tenant_id
    ) as existing;

    delete from public.purchase_order_items as item
    where item.purchase_order_id = order_row.id
      and item.tenant_id = order_row.tenant_id;

    with requested as (
      select
        nullif(entry.item->>'product_id', '')::uuid as product_id,
        nullif(btrim(entry.item->>'reference'), '') as reference,
        btrim(entry.item->>'designation') as designation,
        (entry.item->>'quantity')::integer as quantity,
        (entry.item->>'unit_price_ht_cents')::integer as unit_price_ht_cents,
        (entry.item->>'tax_rate_bp')::integer as tax_rate_bp,
        entry.position::integer as position
      from jsonb_array_elements(p_items) with ordinality
        as entry(item, position)
    ),
    ranked as (
      select
        requested.*,
        row_number() over (
          partition by
            requested.product_id,
            requested.reference,
            requested.designation,
            requested.quantity,
            requested.unit_price_ht_cents,
            requested.tax_rate_bp
          order by requested.position
        ) as trace_rank
      from requested
    ),
    existing as (
      select *
      from jsonb_to_recordset(existing_items) as previous(
        product_id uuid,
        reference text,
        designation text,
        quantity integer,
        unit_price_ht_cents integer,
        tax_rate_bp integer,
        source_estimate_item_id uuid,
        source_selected_supplier_price_id uuid,
        trace_rank bigint
      )
    ),
    prepared as (
      select
        ranked.*,
        (ranked.quantity::numeric * ranked.unit_price_ht_cents::numeric)::integer
          as line_total_ht_cents,
        previous.source_estimate_item_id,
        previous.source_selected_supplier_price_id
      from ranked
      left join existing as previous
        on previous.product_id is not distinct from ranked.product_id
        and previous.reference is not distinct from ranked.reference
        and previous.designation = ranked.designation
        and previous.quantity = ranked.quantity
        and previous.unit_price_ht_cents = ranked.unit_price_ht_cents
        and previous.tax_rate_bp = ranked.tax_rate_bp
        and previous.trace_rank = ranked.trace_rank
    )
    insert into public.purchase_order_items (
      tenant_id,
      purchase_order_id,
      position,
      product_id,
      reference,
      designation,
      unit_price_ht_cents,
      tax_rate_bp,
      quantity,
      line_total_ht_cents,
      line_tax_cents,
      line_total_ttc_cents,
      source_estimate_item_id,
      source_selected_supplier_price_id
    )
    select
      order_row.tenant_id,
      order_row.id,
      prepared.position,
      prepared.product_id,
      prepared.reference,
      prepared.designation,
      prepared.unit_price_ht_cents,
      prepared.tax_rate_bp,
      prepared.quantity,
      prepared.line_total_ht_cents,
      round(
        prepared.line_total_ht_cents::numeric * prepared.tax_rate_bp::numeric
        / 10000
      )::integer,
      prepared.line_total_ht_cents + round(
        prepared.line_total_ht_cents::numeric * prepared.tax_rate_bp::numeric
        / 10000
      )::integer,
      prepared.source_estimate_item_id,
      prepared.source_selected_supplier_price_id
    from prepared;

    update public.purchase_orders as purchase_order
    set total_ht_cents = totals.total_ht_cents,
        total_tax_cents = totals.total_tax_cents,
        total_ttc_cents = totals.total_ttc_cents
    from (
      select
        coalesce(sum(item.line_total_ht_cents), 0)::integer as total_ht_cents,
        coalesce(sum(item.line_tax_cents), 0)::integer as total_tax_cents,
        coalesce(sum(item.line_total_ttc_cents), 0)::integer as total_ttc_cents
      from public.purchase_order_items as item
      where item.purchase_order_id = order_row.id
        and item.tenant_id = order_row.tenant_id
    ) as totals
    where purchase_order.id = order_row.id
      and purchase_order.tenant_id = order_row.tenant_id
      and purchase_order.status = 'draft'::public.purchase_order_status;

    if not found then
      raise exception using
        errcode = '42501',
        message = 'PURCHASE_ORDER_DRAFT_NOT_EDITABLE';
    end if;
  end if;

  return order_row.id;
end;
$$;

revoke all on function public.replace_purchase_order_draft(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_purchase_order_draft(uuid, jsonb, jsonb)
  to authenticated;

create or replace function public.persist_estimate_creation_atomic(
  p_tenant_id uuid,
  p_project_id uuid,
  p_project_payload jsonb,
  p_version_payload jsonb,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  project_row public.estimate_projects%rowtype;
  version_row public.estimate_versions%rowtype;
  next_version_number integer;
begin
  if actor_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_CREATION_AUTH_REQUIRED';
  end if;

  if p_tenant_id is null
    or not (select public.has_tenant_role(
      p_tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
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
      'discount_mode',
      'discount_steps',
      'global_coefficient',
      'tax_rate_bp',
      'rounding_mode',
      'rounding_step_cents',
      'max_section_depth',
      'total_ht_cents',
      'total_tax_cents',
      'total_ttc_cents'
    ] <> '{}'::jsonb
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_PAYLOAD_INVALID';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_ITEMS_PAYLOAD_INVALID';
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
        and not (select public.has_tenant_role(
          p_tenant_id,
          array['admin'::public.tenant_role]
        ))
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
    discount_mode,
    discount_steps,
    global_coefficient,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    max_section_depth,
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
    (p_version_payload->>'total_ht_cents')::integer,
    (p_version_payload->>'total_tax_cents')::integer,
    (p_version_payload->>'total_ttc_cents')::integer
  )
  returning * into version_row;

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
$$;

revoke all on function public.persist_estimate_creation_atomic(
  uuid,
  uuid,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated;
grant execute on function public.persist_estimate_creation_atomic(
  uuid,
  uuid,
  jsonb,
  jsonb,
  jsonb
) to authenticated;
