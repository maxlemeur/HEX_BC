-- SITE-01A: one reviewed intent creates one atomic set of purchase drafts.
-- Private immutable receipts and transfers survive order deletion/cancellation.
begin;
set local lock_timeout = '10s';
lock table public.purchase_orders, public.purchase_order_items in share row exclusive mode;

do $$
declare invalid_count bigint; duplicate_count bigint;
begin
  select count(*) into duplicate_count from (
    select tenant_id,source_estimate_item_id from public.purchase_order_items
    where source_estimate_item_id is not null group by tenant_id,source_estimate_item_id having count(*)>1
  ) duplicates;
  select count(*) into invalid_count from public.purchase_order_items oi
    join public.purchase_orders po on po.id=oi.purchase_order_id
    left join public.estimate_items i on i.id=oi.source_estimate_item_id
    left join public.estimate_versions v on v.id=i.version_id
    where oi.source_estimate_item_id is not null and (
      i.id is null or i.tenant_id<>oi.tenant_id or po.tenant_id<>oi.tenant_id
      or v.tenant_id<>oi.tenant_id or po.source_estimate_version_id is distinct from i.version_id
    );
  if invalid_count>0 or duplicate_count>0 then
    raise exception using errcode='23514',message='ORDER_DRAFT_HISTORY_REQUIRES_REVIEW',
      detail=jsonb_build_object('invalid_scope_count',invalid_count,'duplicate_source_count',duplicate_count)::text;
  end if;
end;
$$;

create table private.estimate_purchase_receipts (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_version_id uuid not null,
  idempotency_key uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  request_payload jsonb not null check(jsonb_typeof(request_payload)='object'),
  review_snapshot jsonb not null check(jsonb_typeof(review_snapshot)='array'),
  result jsonb not null check(jsonb_typeof(result)='object'),
  primary key(tenant_id,source_version_id,idempotency_key)
);
create table private.estimate_purchase_transfers (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_version_id uuid not null,
  source_item_id uuid not null,
  item_title text not null,
  purchase_order_id uuid not null,
  reference text not null,
  quantity integer not null check(quantity>0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key(tenant_id,source_item_id)
);
create index estimate_purchase_transfers_version_idx
  on private.estimate_purchase_transfers(tenant_id,source_version_id);
create index estimate_purchase_transfers_order_idx
  on private.estimate_purchase_transfers(purchase_order_id);
alter table private.estimate_purchase_receipts enable row level security;
alter table private.estimate_purchase_transfers enable row level security;
revoke all on private.estimate_purchase_receipts, private.estimate_purchase_transfers
  from public,anon,authenticated,service_role;

insert into private.estimate_purchase_transfers(tenant_id,source_version_id,source_item_id,item_title,purchase_order_id,reference,quantity,created_by,created_at)
select oi.tenant_id,i.version_id,i.id,oi.designation,po.id,po.reference,oi.quantity,po.user_id,oi.created_at
from public.purchase_order_items oi join public.purchase_orders po on po.id=oi.purchase_order_id
join public.estimate_items i on i.id=oi.source_estimate_item_id;
create unique index purchase_order_items_one_source_transfer_idx
  on public.purchase_order_items(tenant_id,source_estimate_item_id)
  where source_estimate_item_id is not null;

-- Unlike generic tenant helpers, this boundary requires an actual active
-- membership and the same owner/admin project contract as the application.
create function private.estimate_purchase_access(p_version_id uuid,p_write boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare tenant_value uuid; member_role public.tenant_role; owner_id uuid; actor uuid:=auth.uid();
begin
  if actor is null then raise exception using errcode='42501',message='ORDER_DRAFT_ACCESS_DENIED'; end if;
  select tm.tenant_id,tm.role into tenant_value,member_role
    from public.tenant_memberships tm join public.tenants t on t.id=tm.tenant_id
    where tm.user_id=actor and tm.tenant_id=public.current_tenant_id() and t.is_active;
  if tenant_value is null or (p_write and member_role not in ('admin','engineer')) then
    raise exception using errcode='42501',message='ORDER_DRAFT_ACCESS_DENIED';
  end if;
  select p.user_id into owner_id from public.estimate_versions v
    join public.estimate_projects p on p.id=v.project_id and p.tenant_id=v.tenant_id
    where v.id=p_version_id and v.tenant_id=tenant_value;
  if owner_id is null or (owner_id<>actor and member_role<>'admin' and (p_write or member_role<>'director')) then
    raise exception using errcode='42501',message='ORDER_DRAFT_ACCESS_DENIED';
  end if;
  return tenant_value;
end;
$$;

-- Serialize policy insertion as well as updates: no row exists to lock while
-- the tenant still uses the default policy. Only this flag participates.
create function private.lock_estimate_purchase_policy()
returns trigger language plpgsql security definer set search_path='' as $$
declare tenant_value uuid;
begin
  for tenant_value in
    select distinct tenant_id from (values
      (case when tg_op<>'INSERT' and old.flag_key='STALE_PRICE_DAYS' then old.tenant_id end),
      (case when tg_op<>'DELETE' and new.flag_key='STALE_PRICE_DAYS' then new.tenant_id end)
    ) tenants(tenant_id) where tenant_id is not null order by tenant_id
  loop
    perform pg_advisory_xact_lock(hashtextextended('estimate-purchase-policy:'||tenant_value::text,0));
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger lock_estimate_purchase_policy before insert or update or delete on public.feature_flags
  for each row execute function private.lock_estimate_purchase_policy();

create function private.estimate_purchase_stale_days(p_tenant_id uuid)
returns integer language sql stable security definer set search_path='' as $$
  select coalesce((select case when parsed between 1 and 3650 then parsed::integer else 90 end
    from (select substring(btrim(value) from '^[+-]?[0-9]+')::numeric parsed
      from public.feature_flags where tenant_id=p_tenant_id and flag_key='STALE_PRICE_DAYS' and enabled) flag),90);
$$;

create function private.estimate_purchase_review_lines(p_tenant_id uuid,p_version_id uuid,p_item_ids uuid[])
returns jsonb language sql stable security definer set search_path='' set timezone='UTC' as $$
  select coalesce(jsonb_agg(base.display||jsonb_build_object('_snapshot',base.snapshot,'review_fingerprint',
    encode(sha256(convert_to(base.snapshot::text,'UTF8')),'hex')) order by base.id),'[]'::jsonb)
  from (
    select i.id,
      jsonb_build_object('item_id',i.id,'item_title',i.title,'quantity',i.quantity,
        'unit_price_ht_cents',i.unit_price_ht_cents,'tax_rate_bp',i.tax_rate_bp,'unit',btrim(i.description),
        'selected_supplier_price_id',i.selected_supplier_price_id,'supplier_id',s.id,
        'supplier_name',s.name,'supplier_reference',case when ci.id is not null then ci.supplier_sku else sp.supplier_sku end) display,
      jsonb_build_object('version_currency',v.currency,'stale_price_days',private.estimate_purchase_stale_days(p_tenant_id),
        'item_id',i.id,'item_type',i.item_type,'item_title',i.title,'quantity',i.quantity,'unit_price_ht_cents',i.unit_price_ht_cents,
        'tax_rate_bp',i.tax_rate_bp,'unit',btrim(i.description),'selected_supplier_price_id',i.selected_supplier_price_id,
        'supplier_id',s.id,'supplier_name',s.name,'supplier_active',s.is_active,
        'supplier_reference',case when ci.id is not null then ci.supplier_sku else sp.supplier_sku end,'catalog_item_id',sp.supplier_catalog_item_id,
        'product_id',sp.product_id,'offer_unit',sp.unit,'offer_currency',sp.currency,'offer_min_quantity',sp.min_quantity,
        'offer_valid_from',sp.valid_from,'offer_valid_to',sp.valid_to,'offer_active',sp.is_active,
        'offer_unit_price_cents',sp.unit_price_cents,'offer_updated_at',sp.updated_at,'offer_created_at',sp.created_at,
        'offer_source_import_id',sp.source_import_id,'offer_source_mapped_row_id',sp.source_mapped_row_id,
        'offer_transport_mode',sp.transport_mode) snapshot
    from public.estimate_items i join public.estimate_versions v on v.id=i.version_id and v.tenant_id=i.tenant_id
    join public.supplier_pricebook sp on sp.id=i.selected_supplier_price_id and sp.tenant_id=i.tenant_id
    join public.suppliers s on s.id=sp.supplier_id and s.tenant_id=i.tenant_id
    left join public.supplier_catalog_items ci on ci.id=sp.supplier_catalog_item_id and ci.tenant_id=i.tenant_id
    where i.version_id=p_version_id and i.tenant_id=p_tenant_id and i.id=any(p_item_ids) and i.item_type='line'
  ) base;
$$;

create function public.get_estimate_purchase_order_review(p_version_id uuid,p_item_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare tenant_value uuid:=private.estimate_purchase_access(p_version_id,false);
begin
  if p_item_ids is null or cardinality(p_item_ids)>10000 then
    raise exception using errcode='22023',message='ORDER_DRAFT_INPUT_INVALID';
  end if;
  return jsonb_build_object('lines',coalesce((select jsonb_agg(line-'_snapshot' order by line->>'item_id')
    from jsonb_array_elements(private.estimate_purchase_review_lines(tenant_value,p_version_id,p_item_ids)) line),'[]'::jsonb));
end;
$$;

create function private.estimate_purchase_present_receipt(p_result jsonb)
returns jsonb language sql stable security definer set search_path='' as $$
  select p_result||jsonb_build_object('replayed',true,'orders',coalesce((select jsonb_agg(o.value||jsonb_build_object(
    'current_status',coalesce(po.status::text,'deleted'),
    'can_open',po.id is not null and (po.user_id=auth.uid() or exists(select 1 from public.tenant_memberships tm where tm.tenant_id=po.tenant_id and tm.user_id=auth.uid() and tm.role='admin')))
    order by o.ordinality)
    from jsonb_array_elements(p_result->'orders') with ordinality o(value,ordinality)
    left join public.purchase_orders po on po.id=(o.value->>'purchase_order_id')::uuid),'[]'::jsonb));
$$;

create function public.get_estimate_purchase_order_receipt(p_version_id uuid,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tenant_value uuid:=private.estimate_purchase_access(p_version_id,false); receipt private.estimate_purchase_receipts%rowtype;
begin
  -- Wait for a concurrent create on this version before reporting absence.
  perform 1 from public.estimate_versions where id=p_version_id and tenant_id=tenant_value for update;
  perform private.estimate_purchase_access(p_version_id,false);
  select * into receipt from private.estimate_purchase_receipts r
    where r.tenant_id=tenant_value and r.source_version_id=p_version_id and r.idempotency_key=p_idempotency_key;
  if receipt.idempotency_key is null then return null; end if;
  if receipt.created_by<>auth.uid() and not exists(select 1 from public.tenant_memberships where user_id=auth.uid() and tenant_id=tenant_value and role='admin') then
    raise exception using errcode='42501',message='ORDER_DRAFT_ACCESS_DENIED';
  end if;
  return private.estimate_purchase_present_receipt(receipt.result);
end;
$$;

create function public.get_estimate_purchase_order_transfers(p_version_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tenant_value uuid:=private.estimate_purchase_access(p_version_id,false);
begin
  return jsonb_build_object('lines',coalesce((select jsonb_agg(jsonb_build_object(
    'item_id',t.source_item_id,'item_title',t.item_title,'purchase_order_id',t.purchase_order_id,
    'reference',t.reference,'status',coalesce(po.status::text,'deleted'),'quantity',t.quantity,
    'can_open',po.id is not null and (po.user_id=auth.uid() or exists(select 1 from public.tenant_memberships tm where tm.tenant_id=tenant_value and tm.user_id=auth.uid() and tm.role='admin')))
    order by t.source_item_id)
    from private.estimate_purchase_transfers t left join public.purchase_orders po on po.id=t.purchase_order_id and po.tenant_id=t.tenant_id
    where t.tenant_id=tenant_value and t.source_version_id=p_version_id),'[]'::jsonb));
end;
$$;

-- Every insertion path reserves the source, including legacy/direct Data API
-- writes. Replacing the lines of the same draft retains the original transfer.
create function private.reserve_estimate_purchase_transfer()
returns trigger language plpgsql security definer set search_path='' as $$
declare po public.purchase_orders%rowtype; source_line public.estimate_items%rowtype; existing private.estimate_purchase_transfers%rowtype;
begin
  if new.source_estimate_item_id is null then return new; end if;
  select * into po from public.purchase_orders where id=new.purchase_order_id;
  select * into source_line from public.estimate_items where id=new.source_estimate_item_id;
  if po.id is null or source_line.id is null or po.tenant_id<>new.tenant_id or source_line.tenant_id<>new.tenant_id
    or po.source_estimate_version_id is distinct from source_line.version_id then
    raise exception using errcode='23514',message='ORDER_DRAFT_SOURCE_SCOPE_INVALID';
  end if;
  if auth.uid() is not null then
    perform private.estimate_purchase_access(source_line.version_id,true);
    if po.user_id<>auth.uid() and not exists(select 1 from public.tenant_memberships where user_id=auth.uid() and tenant_id=po.tenant_id and role='admin') then
      raise exception using errcode='42501',message='ORDER_DRAFT_ACCESS_DENIED';
    end if;
  elsif session_user not in ('postgres','supabase_admin') then
    raise exception using errcode='42501',message='ORDER_DRAFT_ACCESS_DENIED';
  end if;
  insert into private.estimate_purchase_transfers(tenant_id,source_version_id,source_item_id,item_title,purchase_order_id,reference,quantity,created_by)
    values(new.tenant_id,source_line.version_id,source_line.id,new.designation,po.id,po.reference,new.quantity,po.user_id)
    on conflict(tenant_id,source_item_id) do nothing;
  select * into existing from private.estimate_purchase_transfers where tenant_id=new.tenant_id and source_item_id=source_line.id;
  if existing.purchase_order_id<>po.id or existing.source_version_id<>source_line.version_id then
    raise exception using errcode='23505',message='ORDER_DRAFT_ALREADY_EXISTS';
  end if;
  return new;
end;
$$;
create trigger zz_reserve_estimate_purchase_transfer before insert or update of tenant_id,purchase_order_id,source_estimate_item_id
  on public.purchase_order_items for each row execute function private.reserve_estimate_purchase_transfer();

create function private.guard_estimate_purchase_source_header()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (new.tenant_id is distinct from old.tenant_id or new.source_estimate_version_id is distinct from old.source_estimate_version_id)
    and exists(select 1 from private.estimate_purchase_transfers where purchase_order_id=old.id) then
    -- Preserve the existing source-version FK ON DELETE SET NULL contract.
    -- A direct detach still sees its parent and cannot use this exception.
    if new.tenant_id=old.tenant_id and new.source_estimate_version_id is null
      and old.source_estimate_version_id is not null
      and not exists(select 1 from public.estimate_versions where id=old.source_estimate_version_id) then
      return new;
    end if;
    raise exception using errcode='23514',message='ORDER_DRAFT_SOURCE_SCOPE_INVALID';
  end if;
  return new;
end;
$$;
create trigger guard_estimate_purchase_source_header before update of tenant_id,source_estimate_version_id
  on public.purchase_orders for each row execute function private.guard_estimate_purchase_source_header();

create function private.guard_transferred_estimate_scope()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='estimate_items' then
    if (new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id or new.version_id is distinct from old.version_id)
      and exists(select 1 from private.estimate_purchase_transfers where source_item_id=old.id) then
      raise exception using errcode='23514',message='ORDER_DRAFT_SOURCE_SCOPE_INVALID';
    end if;
  elsif tg_table_name='estimate_versions' then
    if (new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id or new.project_id is distinct from old.project_id)
      and exists(select 1 from private.estimate_purchase_transfers where source_version_id=old.id) then
      raise exception using errcode='23514',message='ORDER_DRAFT_SOURCE_SCOPE_INVALID';
    end if;
  end if;
  return new;
end;
$$;
create trigger aaa_guard_transferred_purchase_item before update of id,tenant_id,version_id
  on public.estimate_items for each row execute function private.guard_transferred_estimate_scope();
create trigger aaa_guard_transferred_purchase_version before update of id,tenant_id,project_id
  on public.estimate_versions for each row execute function private.guard_transferred_estimate_scope();

create function public.create_estimate_purchase_order_drafts(
  p_version_id uuid,p_idempotency_key uuid,p_reviewed_lines jsonb,p_groups jsonb
) returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare
  tenant_value uuid:=private.estimate_purchase_access(p_version_id,true);
  actor uuid:=auth.uid();
  selected_ids uuid[]; review_ids uuid[]; snapshot jsonb; request_value jsonb;
  receipt private.estimate_purchase_receipts%rowtype;
  group_value jsonb; line_value jsonb; order_row public.purchase_orders%rowtype;
  orders_result jsonb:='[]'::jsonb; result_value jsonb;
  ht bigint; tax bigint; ttc bigint; position_value integer;
  line_ht bigint; line_tax bigint; count_value integer; total_lines integer:=0;
  stale_days integer; today_value date;
begin
  if p_idempotency_key is null or jsonb_typeof(p_groups) is distinct from 'array'
    or jsonb_typeof(p_reviewed_lines) is distinct from 'array'
    or jsonb_array_length(p_groups) not between 1 and 50
    or jsonb_array_length(p_reviewed_lines) not between 1 and 10000 then
    raise exception using errcode='22023',message='ORDER_DRAFT_INPUT_INVALID';
  end if;
  if exists(select 1 from jsonb_array_elements(p_groups) g where jsonb_typeof(g) is distinct from 'object'
    or g-array['supplier_id','delivery_site_id','delivery_site_updated_at','item_ids','expected_delivery_date','notes']<>'{}'::jsonb
    or g->>'supplier_id' is null or g->>'delivery_site_id' is null or g->>'delivery_site_updated_at' is null
    or jsonb_typeof(g->'item_ids') is distinct from 'array') then
    raise exception using errcode='22023',message='ORDER_DRAFT_INPUT_INVALID';
  end if;
  for group_value in select g from jsonb_array_elements(p_groups) g loop
    if (group_value ? 'notes' and jsonb_typeof(group_value->'notes') not in ('string','null'))
      or (group_value ? 'expected_delivery_date' and jsonb_typeof(group_value->'expected_delivery_date') not in ('string','null')) then
      raise exception using errcode='22023',message='ORDER_DRAFT_INPUT_INVALID';
    end if;
    if group_value->>'expected_delivery_date' is not null and group_value->>'expected_delivery_date'<>'TBD' then
      if group_value->>'expected_delivery_date'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception using errcode='22023',message='ORDER_DRAFT_INPUT_INVALID';
      end if;
      begin
        if to_char((group_value->>'expected_delivery_date')::date,'YYYY-MM-DD')<>group_value->>'expected_delivery_date' then
          raise exception using errcode='22023',message='ORDER_DRAFT_INPUT_INVALID';
        end if;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception using errcode='22023',message='ORDER_DRAFT_INPUT_INVALID';
      end;
    end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_groups) g where jsonb_array_length(g->'item_ids') not between 1 and 200)
    or exists(select 1 from jsonb_array_elements(p_reviewed_lines) l where jsonb_typeof(l) is distinct from 'object'
      or l-array['item_id','review_fingerprint']<>'{}'::jsonb or l->>'item_id' is null
      or coalesce(l->>'review_fingerprint','')!~'^[0-9a-f]{64}$') then
    raise exception using errcode='22023',message='ORDER_DRAFT_INPUT_INVALID';
  end if;
  -- PostgreSQL UUID input is case-insensitive; all subsequent JSON comparisons
  -- and the immutable idempotency payload must use that same identity contract.
  select jsonb_agg(l||jsonb_build_object('item_id',(l->>'item_id')::uuid) order by (l->>'item_id')::uuid)
    into p_reviewed_lines from jsonb_array_elements(p_reviewed_lines) l;
  select jsonb_agg(g||jsonb_build_object('supplier_id',(g->>'supplier_id')::uuid,
    'delivery_site_id',(g->>'delivery_site_id')::uuid,
    'delivery_site_updated_at',(g->>'delivery_site_updated_at')::timestamptz,
    'item_ids',(select jsonb_agg(ids.value::uuid order by ids.value::uuid)
      from jsonb_array_elements_text(g->'item_ids') ids(value))))
    into p_groups from jsonb_array_elements(p_groups) g;
  select array_agg(id order by id) into selected_ids from (
    select ids.value::uuid id from jsonb_array_elements(p_groups) g cross join lateral jsonb_array_elements_text(g->'item_ids') ids(value)
  ) ids;
  select array_agg((l->>'item_id')::uuid order by (l->>'item_id')::uuid) into review_ids from jsonb_array_elements(p_reviewed_lines) l;
  if selected_ids is distinct from review_ids or cardinality(selected_ids)<>(select count(distinct id) from unnest(selected_ids) id)
    or exists(select 1 from unnest(selected_ids) id where id is null) then
    raise exception using errcode='22023',message='ORDER_DRAFT_INPUT_INVALID';
  end if;
  select jsonb_build_object('reviewed_lines',(select jsonb_agg(l order by l->>'item_id') from jsonb_array_elements(p_reviewed_lines) l),
    'groups',(select jsonb_agg((g-'item_ids')||jsonb_build_object('item_ids',(select jsonb_agg(i order by i) from jsonb_array_elements(g->'item_ids') i))
      order by g->>'supplier_id',g->>'delivery_site_id') from jsonb_array_elements(p_groups) g)) into request_value;

  perform 1 from public.estimate_versions where id=p_version_id and tenant_id=tenant_value for update;
  -- Re-evaluate scope after waiting; membership and parent locks keep it valid.
  perform 1 from public.tenants where id=tenant_value for share;
  perform 1 from public.tenant_memberships where tenant_id=tenant_value and user_id=actor for share;
  perform 1 from public.estimate_projects p join public.estimate_versions v on v.project_id=p.id
    where v.id=p_version_id and p.tenant_id=tenant_value for share of p;
  perform private.estimate_purchase_access(p_version_id,true);
  select * into receipt from private.estimate_purchase_receipts r
    where r.tenant_id=tenant_value and r.source_version_id=p_version_id and r.idempotency_key=p_idempotency_key;
  if receipt.idempotency_key is not null then
    if receipt.created_by<>actor and not exists(select 1 from public.tenant_memberships where tenant_id=tenant_value and user_id=actor and role='admin') then
      raise exception using errcode='42501',message='ORDER_DRAFT_ACCESS_DENIED';
    end if;
    if receipt.request_payload is distinct from request_value then
      raise exception using errcode='23505',message='ORDER_DRAFT_IDEMPOTENCY_CONFLICT';
    end if;
    return private.estimate_purchase_present_receipt(receipt.result);
  end if;
  if exists(select 1 from private.estimate_purchase_transfers where tenant_id=tenant_value and source_item_id=any(selected_ids)) then
    raise exception using errcode='23505',message='ORDER_DRAFT_ALREADY_EXISTS';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('estimate-purchase-policy:'||tenant_value::text,0));
  begin
  -- Direct item writes take the item tuple before their revision-bump trigger
  -- takes the version. Do not wait in the opposite order while holding it.
  perform 1 from public.estimate_items where tenant_id=tenant_value and version_id=p_version_id and id=any(selected_ids) order by id for update nowait;
  if (select count(*) from public.estimate_items where tenant_id=tenant_value and version_id=p_version_id and id=any(selected_ids) and item_type='line')<>cardinality(selected_ids) then
    raise exception using errcode='40001',message='ORDER_DRAFT_PREPARATION_STALE';
  end if;
  -- Products are also locked by existing supplier mutation triggers. NOWAIT on
  -- the supplier tuples avoids opposite tuple/trigger lock-order deadlocks.
  perform 1 from public.products p where p.tenant_id=tenant_value and p.id in (
    select sp.product_id from public.supplier_pricebook sp join public.estimate_items i on i.selected_supplier_price_id=sp.id
    where i.id=any(selected_ids) and i.tenant_id=tenant_value and sp.tenant_id=tenant_value
  ) order by p.id for update;
    perform 1 from public.supplier_pricebook sp where sp.tenant_id=tenant_value and sp.id in (
      select selected_supplier_price_id from public.estimate_items where id=any(selected_ids) and tenant_id=tenant_value
    ) order by sp.id for share nowait;
    perform 1 from public.supplier_catalog_items ci where ci.tenant_id=tenant_value and ci.id in (
      select sp.supplier_catalog_item_id from public.supplier_pricebook sp join public.estimate_items i on i.selected_supplier_price_id=sp.id
      where i.id=any(selected_ids) and i.tenant_id=tenant_value and sp.tenant_id=tenant_value
    ) order by ci.id for share nowait;
    perform 1 from public.suppliers s where s.tenant_id=tenant_value and s.id in (
      select (g->>'supplier_id')::uuid from jsonb_array_elements(p_groups) g
    ) order by s.id for share nowait;
    perform 1 from public.delivery_sites s where s.tenant_id=tenant_value and s.id in (
      select (g->>'delivery_site_id')::uuid from jsonb_array_elements(p_groups) g
    ) order by s.id for share nowait;
    perform 1 from public.feature_flags where tenant_id=tenant_value and flag_key='STALE_PRICE_DAYS' for share nowait;
  exception when lock_not_available then
    raise exception using errcode='40001',message='ORDER_DRAFT_PREPARATION_STALE';
  end;
  snapshot:=private.estimate_purchase_review_lines(tenant_value,p_version_id,selected_ids);
  if jsonb_array_length(snapshot)<>cardinality(selected_ids) or exists(
    select 1 from jsonb_array_elements(snapshot) s join jsonb_array_elements(p_reviewed_lines) r on (r->>'item_id')::uuid=(s->>'item_id')::uuid
    where r->>'review_fingerprint' is distinct from s->>'review_fingerprint'
  ) then raise exception using errcode='40001',message='ORDER_DRAFT_PREPARATION_STALE'; end if;
  stale_days:=private.estimate_purchase_stale_days(tenant_value);
  today_value:=(clock_timestamp() at time zone 'UTC')::date;
  if exists(select 1 from public.estimate_versions where id=p_version_id and upper(btrim(currency))<>'EUR')
    or exists(select 1 from public.estimate_items i join public.supplier_pricebook sp on sp.id=i.selected_supplier_price_id
      join public.suppliers s on s.id=sp.supplier_id
      where i.id=any(selected_ids) and (
        i.quantity is null or i.quantity<=0 or i.quantity<>trunc(i.quantity) or i.quantity>2147483647
        or i.unit_price_ht_cents is null or i.unit_price_ht_cents<0 or i.tax_rate_bp is null or i.tax_rate_bp not between 0 and 10000
        or nullif(btrim(i.description),'') is null or nullif(btrim(sp.unit),'') is null
        or (case when lower(btrim(i.description))='ml' then 'm' else lower(btrim(i.description)) end)
          <>(case when lower(btrim(sp.unit))='ml' then 'm' else lower(btrim(sp.unit)) end)
        or upper(btrim(sp.currency))<>'EUR' or not sp.is_active or not s.is_active or i.quantity<sp.min_quantity
        or sp.valid_from is null or sp.valid_to is null or sp.valid_from>today_value or sp.valid_to<today_value
        or sp.valid_to>(sp.valid_from+interval '6 months')::date
        or coalesce(sp.updated_at,sp.created_at)<clock_timestamp()-make_interval(days=>stale_days)
      )) then raise exception using errcode='40001',message='ORDER_DRAFT_PREPARATION_STALE'; end if;

  for group_value in select g from jsonb_array_elements(p_groups) g order by g->>'supplier_id',g->>'delivery_site_id' loop
    if not exists(select 1 from public.delivery_sites s where s.id=(group_value->>'delivery_site_id')::uuid
      and s.tenant_id=tenant_value and s.is_active and s.updated_at=(group_value->>'delivery_site_updated_at')::timestamptz)
      or exists(select 1 from jsonb_array_elements(snapshot) l where l->>'item_id' in(select jsonb_array_elements_text(group_value->'item_ids'))
        and l->>'supplier_id' is distinct from group_value->>'supplier_id') then
      raise exception using errcode='40001',message='ORDER_DRAFT_PREPARATION_STALE';
    end if;
    ht:=0; tax:=0; ttc:=0; count_value:=0;
    for line_value in select l from jsonb_array_elements(snapshot) l where l->>'item_id' in(select jsonb_array_elements_text(group_value->'item_ids')) loop
      line_ht:=(line_value->>'quantity')::numeric*(line_value->>'unit_price_ht_cents')::bigint;
      line_tax:=round(line_ht::numeric*(line_value->>'tax_rate_bp')::integer/10000);
      if line_ht+line_tax>2147483647 then
        raise exception using errcode='22023',message='ORDER_DRAFT_INPUT_INVALID';
      end if;
      ht:=ht+line_ht; tax:=tax+line_tax; ttc:=ttc+line_ht+line_tax; count_value:=count_value+1;
    end loop;
    if count_value<>jsonb_array_length(group_value->'item_ids') or greatest(ht,tax,ttc)>2147483647 then
      raise exception using errcode='22023',message='ORDER_DRAFT_INPUT_INVALID';
    end if;
    insert into public.purchase_orders(tenant_id,user_id,reference,supplier_id,delivery_site_id,status,expected_delivery_date,notes,
      total_ht_cents,total_tax_cents,total_ttc_cents,currency,source_estimate_version_id)
      values(tenant_value,actor,'TEMP-'||gen_random_uuid()::text,(group_value->>'supplier_id')::uuid,(group_value->>'delivery_site_id')::uuid,
        'draft',nullif(group_value->>'expected_delivery_date',''),nullif(btrim(group_value->>'notes'),''),ht,tax,ttc,'EUR',p_version_id)
      returning * into order_row;
    update public.purchase_orders set reference='C-'||to_char(order_row.order_date,'YYMM')||'-'||lpad(order_row.order_number::text,greatest(3,length(order_row.order_number::text)),'0')
      where id=order_row.id returning * into order_row;
    position_value:=0;
    for line_value in select l from jsonb_array_elements(snapshot) l where l->>'item_id' in(select jsonb_array_elements_text(group_value->'item_ids')) order by l->>'item_id' loop
      position_value:=position_value+1;
      line_ht:=(line_value->>'quantity')::numeric*(line_value->>'unit_price_ht_cents')::bigint;
      line_tax:=round(line_ht::numeric*(line_value->>'tax_rate_bp')::integer/10000);
      insert into public.purchase_order_items(tenant_id,purchase_order_id,position,product_id,reference,designation,unit_price_ht_cents,
        tax_rate_bp,quantity,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,source_estimate_item_id,source_selected_supplier_price_id)
      values(tenant_value,order_row.id,position_value,null,line_value->>'supplier_reference',line_value->>'item_title',
        (line_value->>'unit_price_ht_cents')::integer,(line_value->>'tax_rate_bp')::integer,(line_value->>'quantity')::numeric::integer,
        line_ht,line_tax,line_ht+line_tax,(line_value->>'item_id')::uuid,(line_value->>'selected_supplier_price_id')::uuid);
    end loop;
    orders_result:=orders_result||jsonb_build_array(jsonb_build_object('purchase_order_id',order_row.id,'reference',order_row.reference,
      'supplier_id',order_row.supplier_id,'supplier_name',(select l->>'supplier_name' from jsonb_array_elements(snapshot) l where l->>'supplier_id'=group_value->>'supplier_id' limit 1),
      'delivery_site_id',order_row.delivery_site_id,'item_count',count_value,'total_ht_cents',ht,'total_tax_cents',tax,'total_ttc_cents',ttc,
      'ordered_source_item_ids',(select jsonb_agg(i order by i) from jsonb_array_elements(group_value->'item_ids') i),'current_status','draft','can_open',true));
    total_lines:=total_lines+count_value;
  end loop;
  result_value:=jsonb_build_object('source_version_id',p_version_id,'idempotency_key',p_idempotency_key,'replayed',false,
    'summary',jsonb_build_object('draft_orders_created',jsonb_array_length(orders_result),'draft_lines_created',total_lines),'orders',orders_result);
  insert into private.estimate_purchase_receipts(tenant_id,source_version_id,idempotency_key,created_by,request_payload,review_snapshot,result)
    values(tenant_value,p_version_id,p_idempotency_key,actor,request_value,snapshot,result_value);
  return result_value;
end;
$$;

revoke all on function private.estimate_purchase_access(uuid,boolean), private.estimate_purchase_stale_days(uuid),
  private.estimate_purchase_review_lines(uuid,uuid,uuid[]), private.estimate_purchase_present_receipt(jsonb),
  private.reserve_estimate_purchase_transfer(),private.guard_estimate_purchase_source_header(),private.lock_estimate_purchase_policy(),private.guard_transferred_estimate_scope()
  from public,anon,authenticated,service_role;
revoke all on function public.get_estimate_purchase_order_review(uuid,uuid[]),
  public.get_estimate_purchase_order_receipt(uuid,uuid),public.get_estimate_purchase_order_transfers(uuid),
  public.create_estimate_purchase_order_drafts(uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_estimate_purchase_order_review(uuid,uuid[]),
  public.get_estimate_purchase_order_receipt(uuid,uuid),public.get_estimate_purchase_order_transfers(uuid),
  public.create_estimate_purchase_order_drafts(uuid,uuid,jsonb,jsonb) to authenticated;
commit;
