-- Persist Storage cleanup work before procurement metadata is removed. The
-- queue rows are retained after completion so a database reset can never make
-- an object unreachable without leaving a durable cleanup record.
create table public.procurement_storage_cleanup_outbox (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  purchase_order_id uuid not null,
  bucket_id text not null default 'devis' check (bucket_id = 'devis'),
  storage_path text not null check (
    storage_path = btrim(storage_path)
    and storage_path <> ''
    and storage_path !~ '(^|/)\.\.?(/|$)'
    and storage_path !~ '^/'
    and storage_path like 'purchase-orders/' || purchase_order_id::text || '/%'
    and length(storage_path) > length('purchase-orders/' || purchase_order_id::text || '/')
    and substring(
      storage_path
      from length('purchase-orders/' || purchase_order_id::text || '/') + 1
    ) !~ '/'
  ),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 10 check (
    max_attempts between 1 and 100
  ),
  last_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error text,
  completed_at timestamptz,
  abandoned_at timestamptz,
  check (
    (lease_token is null and lease_expires_at is null)
    or (lease_token is not null and lease_expires_at is not null)
  ),
  check (completed_at is null or lease_token is null),
  check (abandoned_at is null or lease_token is null),
  check (completed_at is null or abandoned_at is null)
);

create unique index procurement_storage_cleanup_outbox_active_path_key
  on public.procurement_storage_cleanup_outbox (tenant_id, storage_path)
  where completed_at is null and abandoned_at is null;

create index procurement_storage_cleanup_outbox_due_idx
  on public.procurement_storage_cleanup_outbox (
    next_attempt_at,
    lease_expires_at,
    created_at,
    id
  )
  where completed_at is null and abandoned_at is null;

create or replace function public.guard_procurement_storage_cleanup_outbox()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '42501',
      message = 'PROCUREMENT_STORAGE_CLEANUP_APPEND_ONLY';
  end if;

  if new.id is distinct from old.id
    or new.created_at is distinct from old.created_at
    or new.tenant_id is distinct from old.tenant_id
    or new.purchase_order_id is distinct from old.purchase_order_id
    or new.bucket_id is distinct from old.bucket_id
    or new.storage_path is distinct from old.storage_path
    or new.attempts < old.attempts
    or new.max_attempts is distinct from old.max_attempts
    or (
      (old.completed_at is not null or old.abandoned_at is not null)
      and to_jsonb(new) is distinct from to_jsonb(old)
    )
  then
    raise exception using
      errcode = '42501',
      message = 'PROCUREMENT_STORAGE_CLEANUP_PAYLOAD_IMMUTABLE';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_procurement_storage_cleanup_outbox()
  from public, anon, authenticated;

create trigger guard_procurement_storage_cleanup_outbox
  before update or delete on public.procurement_storage_cleanup_outbox
  for each row execute function public.guard_procurement_storage_cleanup_outbox();

alter table public.procurement_storage_cleanup_outbox enable row level security;
alter table public.procurement_storage_cleanup_outbox force row level security;

-- The document routes already rely on the existing owner/admin RLS policy.
-- Fresh resets did not grant the underlying relation privileges, making even
-- admin reset previews fail before policy evaluation.
revoke all on table public.purchase_order_devis
  from public, anon, authenticated;
grant select, insert, update, delete on table public.purchase_order_devis
  to authenticated, service_role;

create or replace function public.guard_purchase_order_devis_storage_path()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  canonical_prefix text := 'purchase-orders/' || new.purchase_order_id::text || '/';
begin
  if tg_op = 'UPDATE' and (
    new.storage_path is distinct from old.storage_path
    or new.purchase_order_id is distinct from old.purchase_order_id
    or new.tenant_id is distinct from old.tenant_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'PURCHASE_ORDER_DEVIS_STORAGE_PATH_IMMUTABLE';
  end if;

  if new.storage_path is distinct from btrim(new.storage_path)
    or not new.storage_path like canonical_prefix || '%'
    or length(new.storage_path) <= length(canonical_prefix)
    or substring(new.storage_path from length(canonical_prefix) + 1) ~ '/'
    or new.storage_path ~ '(^|/)\.\.?(/|$)'
  then
    raise exception using
      errcode = '23514',
      message = 'PURCHASE_ORDER_DEVIS_STORAGE_PATH_INVALID';
  end if;

  if not exists (
    select 1
    from public.purchase_orders as purchase_order
    where purchase_order.id = new.purchase_order_id
      and purchase_order.tenant_id = new.tenant_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'PURCHASE_ORDER_DEVIS_TENANT_MISMATCH';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_purchase_order_devis_storage_path()
  from public, anon, authenticated;

drop trigger if exists guard_purchase_order_devis_storage_path
  on public.purchase_order_devis;
create trigger guard_purchase_order_devis_storage_path
  before insert or update of storage_path, purchase_order_id, tenant_id
  on public.purchase_order_devis
  for each row execute function public.guard_purchase_order_devis_storage_path();

create policy "Tenant admins can view procurement storage cleanup"
  on public.procurement_storage_cleanup_outbox
  for select
  to authenticated
  using ((select public.has_tenant_role(
    tenant_id,
    array['admin'::public.tenant_role]
  )));

revoke all on table public.procurement_storage_cleanup_outbox
  from public, anon, authenticated;
grant select on table public.procurement_storage_cleanup_outbox
  to authenticated;
-- Repository security invariants require complete service-role relation
-- privileges. DELETE still fails closed through the append-only trigger.
grant select, insert, update, delete
  on table public.procurement_storage_cleanup_outbox
  to service_role;

create or replace function public.delete_purchase_order_draft_atomic(
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  order_row public.purchase_orders%rowtype;
  cleanup_queued_count integer := 0;
begin
  if actor_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'PURCHASE_ORDER_AUTH_REQUIRED';
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
      message = 'PURCHASE_ORDER_DRAFT_NOT_DELETABLE';
  end if;

  if exists (
    select 1
    from public.purchase_order_devis as document
    where document.purchase_order_id = order_row.id
      and document.tenant_id = order_row.tenant_id
      and (
        document.storage_path is distinct from btrim(document.storage_path)
        or not document.storage_path like
          'purchase-orders/' || order_row.id::text || '/%'
        or length(document.storage_path) <=
          length('purchase-orders/' || order_row.id::text || '/')
        or substring(
          document.storage_path
          from length('purchase-orders/' || order_row.id::text || '/') + 1
        ) ~ '/'
        or document.storage_path ~ '(^|/)\.\.?(/|$)'
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'PURCHASE_ORDER_DEVIS_STORAGE_PATH_INVALID';
  end if;

  insert into public.procurement_storage_cleanup_outbox (
    tenant_id,
    purchase_order_id,
    bucket_id,
    storage_path
  )
  select distinct
    order_row.tenant_id,
    order_row.id,
    'devis',
    btrim(document.storage_path)
  from public.purchase_order_devis as document
  where document.purchase_order_id = order_row.id
    and document.tenant_id = order_row.tenant_id
    and nullif(btrim(document.storage_path), '') is not null
  on conflict (tenant_id, storage_path)
    where completed_at is null and abandoned_at is null
    do nothing;

  get diagnostics cleanup_queued_count = row_count;

  delete from public.purchase_orders as purchase_order
  where purchase_order.id = order_row.id
    and purchase_order.tenant_id = order_row.tenant_id
    and purchase_order.status = 'draft'::public.purchase_order_status;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'PURCHASE_ORDER_DRAFT_NOT_DELETABLE';
  end if;

  return jsonb_build_object(
    'id', order_row.id,
    'tenant_id', order_row.tenant_id,
    'storage_cleanup_queued', cleanup_queued_count
  );
end;
$$;

revoke all on function public.delete_purchase_order_draft_atomic(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_purchase_order_draft_atomic(uuid)
  to authenticated;

drop function if exists public.delete_tenant_purchase_orders_for_reset(uuid);

create or replace function public.reset_tenant_procurement_data(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleanup_queued_count integer := 0;
  deleted_orders_count integer := 0;
  deleted_supplier_prices_count integer := 0;
  deleted_supplier_catalog_items_count integer := 0;
  deleted_suppliers_count integer := 0;
begin
  if (select auth.uid()) is null
    or not (select public.has_tenant_role(
      p_tenant_id,
      array['admin'::public.tenant_role]
    ))
  then
    raise exception using
      errcode = '42501',
      message = 'PROCUREMENT_RESET_ADMIN_REQUIRED';
  end if;

  if exists (
    select 1
    from public.purchase_order_devis as document
    join public.purchase_orders as purchase_order
      on purchase_order.id = document.purchase_order_id
     and purchase_order.tenant_id = document.tenant_id
    where purchase_order.tenant_id = p_tenant_id
      and (
        document.storage_path is distinct from btrim(document.storage_path)
        or not document.storage_path like
          'purchase-orders/' || purchase_order.id::text || '/%'
        or length(document.storage_path) <=
          length('purchase-orders/' || purchase_order.id::text || '/')
        or substring(
          document.storage_path
          from length('purchase-orders/' || purchase_order.id::text || '/') + 1
        ) ~ '/'
        or document.storage_path ~ '(^|/)\.\.?(/|$)'
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'PURCHASE_ORDER_DEVIS_STORAGE_PATH_INVALID';
  end if;

  insert into public.procurement_storage_cleanup_outbox (
    tenant_id,
    purchase_order_id,
    bucket_id,
    storage_path
  )
  select distinct
    purchase_order.tenant_id,
    purchase_order.id,
    'devis',
    btrim(document.storage_path)
  from public.purchase_order_devis as document
  join public.purchase_orders as purchase_order
    on purchase_order.id = document.purchase_order_id
    and purchase_order.tenant_id = document.tenant_id
  where purchase_order.tenant_id = p_tenant_id
    and nullif(btrim(document.storage_path), '') is not null
  on conflict (tenant_id, storage_path)
    where completed_at is null and abandoned_at is null
    do nothing;

  get diagnostics cleanup_queued_count = row_count;

  delete from public.purchase_orders as purchase_order
  where purchase_order.tenant_id = p_tenant_id;
  get diagnostics deleted_orders_count = row_count;

  delete from public.supplier_pricebook as supplier_price
  where supplier_price.tenant_id = p_tenant_id;
  get diagnostics deleted_supplier_prices_count = row_count;

  -- supplier_catalog_items references suppliers with ON DELETE RESTRICT and
  -- therefore belongs to the same atomic reset boundary.
  delete from public.supplier_catalog_items as supplier_catalog_item
  where supplier_catalog_item.tenant_id = p_tenant_id;
  get diagnostics deleted_supplier_catalog_items_count = row_count;

  delete from public.suppliers as supplier
  where supplier.tenant_id = p_tenant_id;
  get diagnostics deleted_suppliers_count = row_count;

  return jsonb_build_object(
    'orders_deleted', deleted_orders_count,
    'supplier_prices_deleted', deleted_supplier_prices_count,
    'supplier_catalog_items_deleted', deleted_supplier_catalog_items_count,
    'suppliers_deleted', deleted_suppliers_count,
    'storage_cleanup_queued', cleanup_queued_count
  );
end;
$$;

revoke all on function public.reset_tenant_procurement_data(uuid)
  from public, anon, authenticated;
grant execute on function public.reset_tenant_procurement_data(uuid)
  to authenticated;

create or replace function public.claim_procurement_storage_cleanup(
  p_tenant_id uuid default null,
  p_limit integer default 25,
  p_lease_seconds integer default 120
)
returns setof public.procurement_storage_cleanup_outbox
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'PROCUREMENT_STORAGE_CLEANUP_SERVICE_ROLE_REQUIRED';
  end if;

  if p_limit < 1 or p_limit > 100
    or p_lease_seconds < 30 or p_lease_seconds > 600
  then
    raise exception using
      errcode = '22023',
      message = 'PROCUREMENT_STORAGE_CLEANUP_CLAIM_INVALID';
  end if;

  -- A worker can crash after consuming its final allowed attempt. Once that
  -- lease expires, retain the row as an explicit terminal failure instead of
  -- leaving it forever active but impossible to claim.
  update public.procurement_storage_cleanup_outbox as cleanup
  set abandoned_at = now(),
      lease_token = null,
      lease_expires_at = null,
      last_error = 'PROCUREMENT_STORAGE_CLEANUP_MAX_ATTEMPTS_EXHAUSTED'
  where cleanup.completed_at is null
    and cleanup.abandoned_at is null
    and cleanup.attempts >= cleanup.max_attempts
    and (
      cleanup.lease_expires_at is null
      or cleanup.lease_expires_at <= now()
    )
    and (p_tenant_id is null or cleanup.tenant_id = p_tenant_id);

  return query
  with candidates as (
    select cleanup.id
    from public.procurement_storage_cleanup_outbox as cleanup
    where cleanup.completed_at is null
      and cleanup.abandoned_at is null
      and cleanup.attempts < cleanup.max_attempts
      and cleanup.next_attempt_at <= now()
      and (
        cleanup.lease_expires_at is null
        or cleanup.lease_expires_at <= now()
      )
      and (p_tenant_id is null or cleanup.tenant_id = p_tenant_id)
    order by cleanup.next_attempt_at, cleanup.created_at, cleanup.id
    for update skip locked
    limit p_limit
  )
  update public.procurement_storage_cleanup_outbox as cleanup
  set attempts = cleanup.attempts + 1,
      last_attempt_at = now(),
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      last_error = null
  from candidates
  where cleanup.id = candidates.id
  returning cleanup.*;
end;
$$;

revoke all on function public.claim_procurement_storage_cleanup(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_procurement_storage_cleanup(uuid, integer, integer)
  to service_role;

create or replace function public.complete_procurement_storage_cleanup(
  p_cleanup_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'PROCUREMENT_STORAGE_CLEANUP_SERVICE_ROLE_REQUIRED';
  end if;

  update public.procurement_storage_cleanup_outbox as cleanup
  set completed_at = now(),
      lease_token = null,
      lease_expires_at = null,
      last_error = null
  where cleanup.id = p_cleanup_id
    and cleanup.completed_at is null
    and cleanup.abandoned_at is null
    and cleanup.lease_token = p_lease_token
    and cleanup.lease_expires_at > now();

  return found;
end;
$$;

revoke all on function public.complete_procurement_storage_cleanup(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_procurement_storage_cleanup(uuid, uuid)
  to service_role;

create or replace function public.fail_procurement_storage_cleanup(
  p_cleanup_id uuid,
  p_lease_token uuid,
  p_error text,
  p_base_delay_seconds integer default 30
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'PROCUREMENT_STORAGE_CLEANUP_SERVICE_ROLE_REQUIRED';
  end if;

  if nullif(btrim(p_error), '') is null
    or p_base_delay_seconds < 1
    or p_base_delay_seconds > 300
  then
    raise exception using
      errcode = '22023',
      message = 'PROCUREMENT_STORAGE_CLEANUP_FAILURE_INVALID';
  end if;

  update public.procurement_storage_cleanup_outbox as cleanup
  set lease_token = null,
      lease_expires_at = null,
      last_error = left(btrim(p_error), 2000),
      next_attempt_at = case
        when cleanup.attempts >= cleanup.max_attempts
          then cleanup.next_attempt_at
        else now() + make_interval(
          secs => least(
            3600::double precision,
            p_base_delay_seconds::double precision
              * power(2::double precision, least(cleanup.attempts - 1, 7))
          )
        )
      end,
      abandoned_at = case
        when cleanup.attempts >= cleanup.max_attempts then now()
        else null
      end
  where cleanup.id = p_cleanup_id
    and cleanup.completed_at is null
    and cleanup.abandoned_at is null
    and cleanup.lease_token = p_lease_token
    and cleanup.lease_expires_at > now();

  return found;
end;
$$;

revoke all on function public.fail_procurement_storage_cleanup(uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.fail_procurement_storage_cleanup(uuid, uuid, text, integer)
  to service_role;
