-- Migration S5/S4: fix stale bulk updates, tenant bootstrap, and admin hardening.

create or replace function public.is_admin_user()
returns boolean
language sql
stable
set search_path = public
as $$
  select
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    or coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true', false);
$$;

create or replace function public.guard_profile_role_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role is distinct from old.role and (select auth.uid()) is not null then
    raise exception
      using
        errcode = '42501',
        message = 'PROFILE_ROLE_IMMUTABLE',
        detail = 'Only server-side workflows can change profiles.role.';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_profile_role_update on public.profiles;
create trigger guard_profile_role_update
  before update on public.profiles
  for each row execute procedure public.guard_profile_role_update();

create or replace function public.reorder_purchase_order_devis(
  target_purchase_order_id uuid,
  ordered_devis_ids uuid[]
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  updated_count integer := 0;
begin
  if coalesce(array_length(ordered_devis_ids, 1), 0) = 0 then
    return 0;
  end if;

  if not exists (
    select 1
    from public.purchase_orders po
    where po.id = target_purchase_order_id
      and po.tenant_id is not null
      and (
        exists (
          select 1
          from public.tenant_memberships tm
          where tm.tenant_id = po.tenant_id
            and tm.user_id = (select auth.uid())
        )
        or (select public.is_admin_user())
      )
      and (
        po.user_id = (select auth.uid())
        or exists (
          select 1
          from public.tenant_memberships tm
          where tm.tenant_id = po.tenant_id
            and tm.user_id = (select auth.uid())
            and tm.role::text = 'admin'
        )
        or (select public.is_admin_user())
      )
  ) then
    return 0;
  end if;

  with ordered as (
    select
      src.id,
      src.ordinality::integer as position
    from unnest(ordered_devis_ids) with ordinality as src(id, ordinality)
  )
  update public.purchase_order_devis devis
  set position = -ordered.position
  from ordered
  where devis.id = ordered.id
    and devis.purchase_order_id = target_purchase_order_id;

  with ordered as (
    select
      src.id,
      src.ordinality::integer as position
    from unnest(ordered_devis_ids) with ordinality as src(id, ordinality)
  )
  update public.purchase_order_devis devis
  set position = ordered.position
  from ordered
  where devis.id = ordered.id
    and devis.purchase_order_id = target_purchase_order_id;

  get diagnostics updated_count = row_count;

  if updated_count <> coalesce(array_length(ordered_devis_ids, 1), 0) then
    raise exception
      using
        errcode = 'P0001',
        message = 'STALE_REORDER_PURCHASE_ORDER_DEVIS',
        detail = format(
          'expected_count=%s,updated_count=%s',
          coalesce(array_length(ordered_devis_ids, 1), 0),
          updated_count
        );
  end if;

  return updated_count;
end;
$$;

create or replace function public.bulk_update_estimate_items(
  target_version_id uuid,
  item_updates jsonb
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
begin
  if coalesce(jsonb_typeof(item_updates), '') <> 'array' then
    raise exception 'item_updates must be a JSON array';
  end if;

  expected_count := coalesce(jsonb_array_length(item_updates), 0);

  if expected_count = 0 then
    return 0;
  end if;

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
    k_mo numeric(12,3),
    pu_ht_cents integer,
    labor_role_id uuid,
    category_id uuid,
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
    k_mo,
    pu_ht_cents,
    labor_role_id,
    category_id,
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
    snapshot.k_mo,
    snapshot.pu_ht_cents,
    snapshot.labor_role_id,
    snapshot.category_id,
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
    k_mo = snapshot.k_mo,
    pu_ht_cents = snapshot.pu_ht_cents,
    labor_role_id = snapshot.labor_role_id,
    category_id = snapshot.category_id,
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

  return updated_count;
end;
$$;

alter table public.tenants
  alter column created_by set default auth.uid();

create or replace function public.can_bootstrap_tenant_membership(
  target_tenant_id uuid,
  target_user_id uuid,
  target_role public.tenant_role
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    target_tenant_id is not null
    and target_user_id = (select auth.uid())
    and target_role = 'admin'::public.tenant_role
    and exists (
      select 1
      from public.tenants t
      where t.id = target_tenant_id
        and t.created_by = (select auth.uid())
    )
    and not exists (
      select 1
      from public.tenant_memberships tm
      where tm.tenant_id = target_tenant_id
    );
$$;

grant execute on function public.can_bootstrap_tenant_membership(uuid, uuid, public.tenant_role) to authenticated;

drop policy if exists "Users can view own tenants" on public.tenants;
create policy "Users can view own tenants"
  on public.tenants
  for select
  to authenticated
  using (
    (select public.is_tenant_member(id))
    or created_by = (select auth.uid())
  );

drop policy if exists "Authenticated can create tenants" on public.tenants;
create policy "Authenticated can create tenants"
  on public.tenants
  for insert
  to authenticated
  with check (
    (select auth.uid()) is not null
    and created_by = (select auth.uid())
  );

drop policy if exists "Tenant admins can insert memberships" on public.tenant_memberships;
create policy "Tenant admins can insert memberships"
  on public.tenant_memberships
  for insert
  to authenticated
  with check (
    (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    or (select public.can_bootstrap_tenant_membership(tenant_id, user_id, role))
  );
