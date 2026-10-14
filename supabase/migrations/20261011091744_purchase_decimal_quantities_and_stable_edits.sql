-- SITE-01B: exact purchase quantities, explicit units and auditable stable edits.
-- Do not use numeric(p,3): its coercion would round before validation.
begin;
set local lock_timeout='10s';
lock table public.purchase_orders,public.purchase_order_items in share row exclusive mode;

alter table public.purchase_order_items alter column quantity type numeric using quantity::numeric;
alter table private.estimate_purchase_transfers alter column quantity type numeric using quantity::numeric;
alter table public.purchase_order_items add constraint purchase_order_quantity_precision
  check(quantity>0 and quantity<=2147483647 and quantity=trunc(quantity,3));
alter table private.estimate_purchase_transfers add constraint estimate_purchase_transfer_quantity_precision
  check(quantity>0 and quantity<=2147483647 and quantity=trunc(quantity,3));
alter table public.purchase_order_items add column unit text,add column price_unit text,
  add column is_source_linked boolean not null default false;
alter table public.purchase_orders add column edit_revision bigint not null default 1
  check(edit_revision between 0 and 9007199254740991);

-- A surviving FK proves origin, never the current unit of an old transaction.
-- Metadata backfill is not a user edit: retain the historical timestamps.
alter table public.purchase_order_items disable trigger set_purchase_order_items_updated_at;
update public.purchase_order_items set is_source_linked=true
  where source_estimate_item_id is not null or source_selected_supplier_price_id is not null;
with trusted as (
  select r.tenant_id,(o->>'purchase_order_id')::uuid order_id,(s->>'item_id')::uuid item_id,
    s->'_snapshot'->>'unit' unit,s->'_snapshot'->>'offer_unit' price_unit
  from private.estimate_purchase_receipts r
  cross join lateral jsonb_array_elements(r.result->'orders') o
  cross join lateral jsonb_array_elements(r.review_snapshot) s
  where o->'ordered_source_item_ids' @> jsonb_build_array(s->'item_id')
)
update public.purchase_order_items oi set unit=t.unit,price_unit=t.price_unit
from trusted t where oi.tenant_id=t.tenant_id and oi.purchase_order_id=t.order_id
  and oi.source_estimate_item_id=t.item_id and nullif(btrim(t.unit),'') is not null
  and nullif(btrim(t.price_unit),'') is not null;
alter table public.purchase_order_items enable trigger set_purchase_order_items_updated_at;

-- Deferral is local to the stable edit transaction; direct writes remain immediate.
drop index public.purchase_order_items_position_unique;
alter table public.purchase_order_items add constraint purchase_order_items_position_unique
  unique(purchase_order_id,position) deferrable initially immediate;

create table private.purchase_order_item_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  purchase_order_id uuid not null,item_id uuid not null,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid,actor_name text,
  operation text not null check(operation in ('insert','update','delete')),
  before_value jsonb,after_value jsonb
);
create index purchase_order_item_history_order_idx
  on private.purchase_order_item_history(tenant_id,purchase_order_id,occurred_at,id);
alter table private.purchase_order_item_history enable row level security;
revoke all on private.purchase_order_item_history from public,anon,authenticated,service_role;

create function private.purchase_order_access(p_order_id uuid,p_write boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare tenant_value uuid; member_role public.tenant_role; owner_id uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='PURCHASE_ORDER_AUTH_REQUIRED'; end if;
  select tm.tenant_id,tm.role into tenant_value,member_role
    from public.tenant_memberships tm join public.tenants t on t.id=tm.tenant_id
    where tm.user_id=auth.uid() and tm.tenant_id=public.current_tenant_id() and t.is_active;
  if tenant_value is null or (p_write and member_role not in ('admin','engineer')) then
    raise exception using errcode='42501',message='PURCHASE_ORDER_ACCESS_DENIED';
  end if;
  if p_order_id is not null then
    select user_id into owner_id from public.purchase_orders where id=p_order_id and tenant_id=tenant_value;
    if owner_id is null or (owner_id<>auth.uid() and member_role<>'admin') then
      raise exception using errcode='42501',message='PURCHASE_ORDER_ACCESS_DENIED';
    end if;
  end if;
  return tenant_value;
end;
$$;

create function private.validate_purchase_order_item(p_item jsonb,p_existing boolean)
returns void language plpgsql set search_path='' as $$
declare quantity_value numeric; cost numeric; tax numeric;
begin
  if jsonb_typeof(p_item) is distinct from 'object'
    or p_item-array['id','product_id','reference','designation','quantity','unit','unit_price_ht_cents','tax_rate_bp']<>'{}'::jsonb
    or jsonb_typeof(p_item->'designation') is distinct from 'string' or nullif(btrim(p_item->>'designation'),'') is null
    or (p_item ? 'reference' and jsonb_typeof(p_item->'reference') not in ('string','null'))
    or (p_item ? 'unit' and jsonb_typeof(p_item->'unit') not in ('string','null'))
    or (p_item ? 'product_id' and jsonb_typeof(p_item->'product_id') not in ('string','null'))
    or (p_item ? 'id' and jsonb_typeof(p_item->'id') not in ('string','null')) then
    raise exception using errcode='22023',message='PURCHASE_ORDER_INPUT_INVALID';
  end if;
  if jsonb_typeof(p_item->'quantity') is distinct from 'number' then
    raise exception using errcode='22023',message='PURCHASE_ORDER_QUANTITY_INVALID';
  end if;
  quantity_value:=(p_item->>'quantity')::numeric;
  if quantity_value<=0 or quantity_value>2147483647 or quantity_value<>trunc(quantity_value,3) then
    raise exception using errcode='22023',message='PURCHASE_ORDER_QUANTITY_INVALID';
  end if;
  if jsonb_typeof(p_item->'unit_price_ht_cents') is distinct from 'number'
    or jsonb_typeof(p_item->'tax_rate_bp') is distinct from 'number' then
    raise exception using errcode='22023',message='PURCHASE_ORDER_INPUT_INVALID';
  end if;
  cost:=(p_item->>'unit_price_ht_cents')::numeric; tax:=(p_item->>'tax_rate_bp')::numeric;
  if cost not between 0 and 2147483647 or cost<>trunc(cost) or tax not between 0 and 10000 or tax<>trunc(tax) then
    raise exception using errcode='22023',message='PURCHASE_ORDER_INPUT_INVALID';
  end if;
  if not p_existing and nullif(btrim(p_item->>'unit'),'') is null then
    raise exception using errcode='22023',message='PURCHASE_ORDER_UNIT_REQUIRED';
  end if;
  perform (p_item->>'id')::uuid,(p_item->>'product_id')::uuid;
exception when invalid_text_representation then
  raise exception using errcode='22023',message='PURCHASE_ORDER_INPUT_INVALID';
end;
$$;

create function private.validate_purchase_order_header(p_header jsonb,p_tenant uuid,p_create boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if jsonb_typeof(p_header) is distinct from 'object'
    or p_header-array['supplier_id','delivery_site_id','notes','expected_delivery_date']<>'{}'::jsonb
    or (p_header ? 'notes' and jsonb_typeof(p_header->'notes') not in ('string','null'))
    or (p_header ? 'expected_delivery_date' and jsonb_typeof(p_header->'expected_delivery_date') not in ('string','null'))
    or (p_create and (not p_header ? 'supplier_id' or not p_header ? 'delivery_site_id')) then
    raise exception using errcode='22023',message='PURCHASE_ORDER_HEADER_INVALID';
  end if;
  if p_header ? 'supplier_id' then
    if jsonb_typeof(p_header->'supplier_id') is distinct from 'string' then
      raise exception using errcode='22023',message='PURCHASE_ORDER_HEADER_INVALID';
    end if;
    perform 1 from public.suppliers where id=(p_header->>'supplier_id')::uuid and tenant_id=p_tenant and is_active for share nowait;
    if not found then raise exception using errcode='22023',message='PURCHASE_ORDER_HEADER_INVALID'; end if;
  end if;
  if p_header ? 'delivery_site_id' then
    if jsonb_typeof(p_header->'delivery_site_id') is distinct from 'string' then
      raise exception using errcode='22023',message='PURCHASE_ORDER_HEADER_INVALID';
    end if;
    perform 1 from public.delivery_sites where id=(p_header->>'delivery_site_id')::uuid and tenant_id=p_tenant and is_active for share nowait;
    if not found then raise exception using errcode='22023',message='PURCHASE_ORDER_HEADER_INVALID'; end if;
  end if;
  if p_header->>'expected_delivery_date' is not null and p_header->>'expected_delivery_date'<>'TBD' then
    if p_header->>'expected_delivery_date'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or to_char((p_header->>'expected_delivery_date')::date,'YYYY-MM-DD')<>p_header->>'expected_delivery_date' then
      raise exception using errcode='22023',message='PURCHASE_ORDER_HEADER_INVALID';
    end if;
  end if;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
  raise exception using errcode='22023',message='PURCHASE_ORDER_HEADER_INVALID';
when lock_not_available then
  raise exception using errcode='40001',message='PURCHASE_ORDER_REVISION_CONFLICT';
end;
$$;

create function private.normalize_purchase_order_item()
returns trigger language plpgsql security definer set search_path='' as $$
declare ht numeric; tax numeric; source_unit text; offer_unit text; po public.purchase_orders%rowtype;
begin
  select * into po from public.purchase_orders where id=new.purchase_order_id for update;
  if po.id is null or po.tenant_id<>new.tenant_id then
    raise exception using errcode='22023',message='PURCHASE_ORDER_ITEMS_INVALID';
  end if;
  -- The FK's genuine detach is permitted even after sending; it changes no economics.
  if tg_op='UPDATE' and (new.source_estimate_item_id is distinct from old.source_estimate_item_id
    or new.source_selected_supplier_price_id is distinct from old.source_selected_supplier_price_id) then
    if (new.source_estimate_item_id is distinct from old.source_estimate_item_id and not
      (new.source_estimate_item_id is null and old.source_estimate_item_id is not null and not exists(select 1 from public.estimate_items where id=old.source_estimate_item_id)))
      or (new.source_selected_supplier_price_id is distinct from old.source_selected_supplier_price_id and not
      (new.source_selected_supplier_price_id is null and old.source_selected_supplier_price_id is not null and not exists(select 1 from public.supplier_pricebook where id=old.source_selected_supplier_price_id))) then
      raise exception using errcode='22023',message='PURCHASE_ORDER_ITEMS_INVALID';
    end if;
  end if;
  if tg_op='UPDATE' and (new.id<>old.id or new.tenant_id<>old.tenant_id or new.purchase_order_id<>old.purchase_order_id or new.is_source_linked<>old.is_source_linked) then
    raise exception using errcode='22023',message='PURCHASE_ORDER_ITEMS_INVALID';
  end if;
  -- Recheck after acquiring the parent lock. The RLS scan may have observed a
  -- draft before a concurrent status transition committed while this row waited.
  if po.status<>'draft' then
    if tg_op='UPDATE'
      and (new.source_estimate_item_id is distinct from old.source_estimate_item_id
        or new.source_selected_supplier_price_id is distinct from old.source_selected_supplier_price_id
        or new.product_id is distinct from old.product_id)
      and (new.product_id is not distinct from old.product_id or
        (new.product_id is null and old.product_id is not null and not exists(select 1 from public.products where id=old.product_id)))
      and (to_jsonb(new)-array['source_estimate_item_id','source_selected_supplier_price_id','product_id','updated_at'])=
          (to_jsonb(old)-array['source_estimate_item_id','source_selected_supplier_price_id','product_id','updated_at']) then
      return new;
    end if;
    raise exception using errcode='42501',message='PURCHASE_ORDER_DRAFT_NOT_EDITABLE';
  end if;
  if new.quantity is null or new.quantity<=0 or new.quantity>2147483647 or new.quantity<>trunc(new.quantity,3) then
    raise exception using errcode='22023',message='PURCHASE_ORDER_QUANTITY_INVALID';
  end if;
  if new.unit_price_ht_cents is null or new.unit_price_ht_cents<0 or new.tax_rate_bp is null or new.tax_rate_bp not between 0 and 10000
    or nullif(btrim(new.designation),'') is null then
    raise exception using errcode='22023',message='PURCHASE_ORDER_INPUT_INVALID';
  end if;
  new.unit:=nullif(btrim(new.unit),'');
  if tg_op='INSERT' then
    new.price_unit:=nullif(btrim(new.price_unit),'');
    new.is_source_linked:=new.source_estimate_item_id is not null or new.source_selected_supplier_price_id is not null;
    if new.is_source_linked then
      select btrim(i.description),btrim(sp.unit) into source_unit,offer_unit
      from public.estimate_items i join public.supplier_pricebook sp on sp.id=i.selected_supplier_price_id and sp.tenant_id=i.tenant_id
      where i.id=new.source_estimate_item_id and i.tenant_id=new.tenant_id and sp.id=new.source_selected_supplier_price_id
        and i.version_id=po.source_estimate_version_id for share of i,sp nowait;
      if not found or nullif(source_unit,'') is null or nullif(offer_unit,'') is null then
        raise exception using errcode='22023',message='PURCHASE_ORDER_UNIT_REQUIRED';
      end if;
      if (new.unit is not null and new.unit<>source_unit) or (new.price_unit is not null and new.price_unit<>offer_unit) then
        raise exception using errcode='22023',message='PURCHASE_ORDER_SOURCE_UNIT_IMMUTABLE';
      end if;
      new.unit:=source_unit; new.price_unit:=offer_unit;
    else new.price_unit:=new.unit; end if;
    if new.unit is null then raise exception using errcode='22023',message='PURCHASE_ORDER_UNIT_REQUIRED'; end if;
  else
    if old.is_source_linked and old.unit is not null and new.unit is distinct from old.unit then
      raise exception using errcode='22023',message='PURCHASE_ORDER_SOURCE_UNIT_IMMUTABLE';
    end if;
    if new.price_unit is distinct from old.price_unit then
      raise exception using errcode='22023',message='PURCHASE_ORDER_SOURCE_UNIT_IMMUTABLE';
    end if;
    if new.unit is null and (old.unit is not null or new.quantity is distinct from old.quantity or new.unit_price_ht_cents is distinct from old.unit_price_ht_cents) then
      raise exception using errcode='22023',message='PURCHASE_ORDER_UNIT_REQUIRED';
    end if;
    if not old.is_source_linked or old.unit is null then new.price_unit:=new.unit; end if;
  end if;
  ht:=round(new.quantity*new.unit_price_ht_cents); tax:=round(ht*new.tax_rate_bp/10000);
  if greatest(ht,tax,ht+tax)>2147483647 then
    raise exception using errcode='22023',message='PURCHASE_ORDER_AMOUNT_OUT_OF_RANGE';
  end if;
  new.line_total_ht_cents:=ht::integer; new.line_tax_cents:=tax::integer; new.line_total_ttc_cents:=(ht+tax)::integer;
  return new;
exception when lock_not_available then
  raise exception using errcode='40001',message='PURCHASE_ORDER_REVISION_CONFLICT';
end;
$$;
create trigger zz_normalize_purchase_order_item before insert or update on public.purchase_order_items
  for each row execute function private.normalize_purchase_order_item();

create function private.guard_purchase_order_item_deletion()
returns trigger language plpgsql security definer set search_path='' as $$
declare po public.purchase_orders%rowtype;
begin
  select * into po from public.purchase_orders where id=old.purchase_order_id for update;
  -- ON DELETE CASCADE sees its already deleted parent and retains the audit.
  if po.id is not null and po.status<>'draft' then
    raise exception using errcode='42501',message='PURCHASE_ORDER_DRAFT_NOT_EDITABLE';
  end if;
  return old;
end;
$$;
create trigger guard_purchase_order_item_deletion before delete on public.purchase_order_items
  for each row execute function private.guard_purchase_order_item_deletion();

create function private.revise_purchase_order_header()
returns trigger language plpgsql security definer set search_path='' as $$
declare ht numeric; tax numeric; ttc numeric;
begin
  if tg_op='INSERT' then
    new.edit_revision:=1; new.total_ht_cents:=0; new.total_tax_cents:=0; new.total_ttc_cents:=0;
    return new;
  end if;
  if new.id<>old.id or new.tenant_id<>old.tenant_id then
    raise exception using errcode='22023',message='PURCHASE_ORDER_INPUT_INVALID';
  end if;
  if new.supplier_id is distinct from old.supplier_id and (
    old.source_estimate_version_id is not null
    or exists(select 1 from public.purchase_order_items where purchase_order_id=old.id and is_source_linked)
    or exists(select 1 from private.estimate_purchase_transfers where purchase_order_id=old.id)
  ) then
    raise exception using errcode='22023',message='PURCHASE_ORDER_SOURCE_SUPPLIER_IMMUTABLE';
  end if;
  if old.edit_revision>=9007199254740991 then
    raise exception using errcode='40001',message='PURCHASE_ORDER_REVISION_CONFLICT';
  end if;
  new.edit_revision:=old.edit_revision+1;
  if old.status='draft' and new.status='draft' then
    select coalesce(sum(line_total_ht_cents),0),coalesce(sum(line_tax_cents),0),coalesce(sum(line_total_ttc_cents),0)
      into ht,tax,ttc from public.purchase_order_items where purchase_order_id=old.id and tenant_id=old.tenant_id;
    if greatest(ht,tax,ttc)>2147483647 then raise exception using errcode='22023',message='PURCHASE_ORDER_AMOUNT_OUT_OF_RANGE'; end if;
    new.total_ht_cents:=ht::integer; new.total_tax_cents:=tax::integer; new.total_ttc_cents:=ttc::integer;
  end if;
  return new;
end;
$$;
-- Run after the pre-existing status/header guard so status-only writes stay valid.
create trigger zz_revise_purchase_order_header before insert or update on public.purchase_orders
  for each row execute function private.revise_purchase_order_header();

create function private.record_purchase_order_item_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare before_value jsonb; after_value jsonb; row_value public.purchase_order_items%rowtype; actor_name_value text;
begin
  if tg_op<>'INSERT' then before_value:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then after_value:=to_jsonb(new); end if;
  if tg_op='UPDATE' and (before_value-'updated_at')=(after_value-'updated_at') then return new; end if;
  if tg_op='DELETE' then row_value:=old; else row_value:=new; end if;
  select full_name into actor_name_value from public.profiles where id=auth.uid();
  insert into private.purchase_order_item_history(tenant_id,purchase_order_id,item_id,actor_id,actor_name,operation,before_value,after_value)
    values(row_value.tenant_id,row_value.purchase_order_id,row_value.id,auth.uid(),actor_name_value,lower(tg_op),before_value,after_value);
  -- A sent order can receive a genuine FK detach; its money remains frozen.
  update public.purchase_orders set updated_at=clock_timestamp()
    where id=row_value.purchase_order_id and tenant_id=row_value.tenant_id;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger record_purchase_order_item_change after insert or update or delete on public.purchase_order_items
  for each row execute function private.record_purchase_order_item_change();

create function public.create_purchase_order_draft(p_header jsonb,p_items jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tenant_value uuid:=private.purchase_order_access(null,true); po public.purchase_orders%rowtype; item jsonb; ordinal bigint;
begin
  perform 1 from public.tenants where id=tenant_value for share;
  perform 1 from public.tenant_memberships where tenant_id=tenant_value and user_id=auth.uid() for share;
  perform private.purchase_order_access(null,true);
  perform private.validate_purchase_order_header(p_header,tenant_value,true);
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 1000 then
    raise exception using errcode='22023',message='PURCHASE_ORDER_ITEMS_INVALID';
  end if;
  for item in select value from jsonb_array_elements(p_items) loop
    perform private.validate_purchase_order_item(item,false);
    if item->>'id' is not null then raise exception using errcode='22023',message='PURCHASE_ORDER_ITEMS_INVALID'; end if;
    if item->>'product_id' is not null then
      perform 1 from public.products where id=(item->>'product_id')::uuid and tenant_id=tenant_value for share nowait;
      if not found then raise exception using errcode='22023',message='PURCHASE_ORDER_ITEMS_INVALID'; end if;
    end if;
  end loop;
  insert into public.purchase_orders(tenant_id,user_id,reference,supplier_id,delivery_site_id,status,expected_delivery_date,notes,currency)
    values(tenant_value,auth.uid(),'TEMP-'||gen_random_uuid(),(p_header->>'supplier_id')::uuid,(p_header->>'delivery_site_id')::uuid,
      'draft',p_header->>'expected_delivery_date',nullif(btrim(p_header->>'notes'),''),'EUR') returning * into po;
  update public.purchase_orders set reference='C-'||to_char(po.order_date,'YYMM')||'-'||lpad(po.order_number::text,greatest(3,length(po.order_number::text)),'0') where id=po.id;
  for item,ordinal in select value,ordinality from jsonb_array_elements(p_items) with ordinality loop
    insert into public.purchase_order_items(tenant_id,purchase_order_id,position,product_id,reference,designation,quantity,unit,unit_price_ht_cents,tax_rate_bp,line_total_ht_cents,line_tax_cents,line_total_ttc_cents)
      values(tenant_value,po.id,ordinal,(item->>'product_id')::uuid,item->>'reference',btrim(item->>'designation'),(item->>'quantity')::numeric,
        item->>'unit',(item->>'unit_price_ht_cents')::integer,(item->>'tax_rate_bp')::integer,0,0,0);
  end loop;
  select * into po from public.purchase_orders where id=po.id;
  return jsonb_build_object('id',po.id,'reference',po.reference,'edit_revision',po.edit_revision);
exception when lock_not_available then
  raise exception using errcode='40001',message='PURCHASE_ORDER_REVISION_CONFLICT';
end;
$$;

-- The old three-argument entry point cannot silently bypass revision control.
revoke all on function public.replace_purchase_order_draft(uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.replace_purchase_order_draft(p_order_id uuid,p_header_patch jsonb,p_items jsonb,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tenant_value uuid:=private.purchase_order_access(p_order_id,true); po public.purchase_orders%rowtype;
  item jsonb; ordinal bigint; ids uuid[];
begin
  select * into po from public.purchase_orders where id=p_order_id and tenant_id=tenant_value for update;
  perform 1 from public.tenants where id=tenant_value for share;
  perform 1 from public.tenant_memberships where tenant_id=tenant_value and user_id=auth.uid() for share;
  perform private.purchase_order_access(p_order_id,true);
  if po.status<>'draft' then raise exception using errcode='42501',message='PURCHASE_ORDER_DRAFT_NOT_EDITABLE'; end if;
  if p_expected_revision is null then raise exception using errcode='40001',message='PURCHASE_ORDER_REVISION_REQUIRED'; end if;
  if p_expected_revision<>po.edit_revision or p_expected_revision not between 0 and 9007199254740991 then
    raise exception using errcode='40001',message='PURCHASE_ORDER_REVISION_CONFLICT';
  end if;
  perform private.validate_purchase_order_header(p_header_patch,tenant_value,false);
  perform 1 from public.purchase_order_items where purchase_order_id=p_order_id order by id for update nowait;
  if p_items is not null then
    if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 1000 then
      raise exception using errcode='22023',message='PURCHASE_ORDER_ITEMS_INVALID';
    end if;
    for item in select value from jsonb_array_elements(p_items) loop
      perform private.validate_purchase_order_item(item,item->>'id' is not null);
      if item->>'id' is not null and not exists(select 1 from public.purchase_order_items where id=(item->>'id')::uuid and purchase_order_id=p_order_id and tenant_id=tenant_value) then
        raise exception using errcode='22023',message='PURCHASE_ORDER_ITEMS_INVALID';
      end if;
      if item->>'product_id' is not null then
        perform 1 from public.products where id=(item->>'product_id')::uuid and tenant_id=tenant_value for share nowait;
        if not found then raise exception using errcode='22023',message='PURCHASE_ORDER_ITEMS_INVALID'; end if;
      end if;
    end loop;
    select coalesce(array_agg((value->>'id')::uuid) filter(where value->>'id' is not null),'{}'::uuid[]) into ids from jsonb_array_elements(p_items);
    if cardinality(ids)<>(select count(distinct id) from unnest(ids) id) then
      raise exception using errcode='22023',message='PURCHASE_ORDER_ITEMS_INVALID';
    end if;
  end if;
  update public.purchase_orders set
    supplier_id=case when p_header_patch ? 'supplier_id' then (p_header_patch->>'supplier_id')::uuid else supplier_id end,
    delivery_site_id=case when p_header_patch ? 'delivery_site_id' then (p_header_patch->>'delivery_site_id')::uuid else delivery_site_id end,
    expected_delivery_date=case when p_header_patch ? 'expected_delivery_date' then p_header_patch->>'expected_delivery_date' else expected_delivery_date end,
    notes=case when p_header_patch ? 'notes' then nullif(btrim(p_header_patch->>'notes'),'') else notes end where id=p_order_id;
  if p_items is not null then
    set constraints public.purchase_order_items_position_unique deferred;
    delete from public.purchase_order_items where purchase_order_id=p_order_id and not id=any(ids);
    for item,ordinal in select value,ordinality from jsonb_array_elements(p_items) with ordinality loop
      if item->>'id' is not null then
        update public.purchase_order_items set position=ordinal,
          product_id=case when item ? 'product_id' then (item->>'product_id')::uuid else product_id end,
          reference=case when item ? 'reference' then item->>'reference' else reference end,
          designation=btrim(item->>'designation'),quantity=(item->>'quantity')::numeric,
          unit=case when item ? 'unit' then item->>'unit' else unit end,
          unit_price_ht_cents=(item->>'unit_price_ht_cents')::integer,tax_rate_bp=(item->>'tax_rate_bp')::integer
          where id=(item->>'id')::uuid and purchase_order_id=p_order_id;
      else
        insert into public.purchase_order_items(tenant_id,purchase_order_id,position,product_id,reference,designation,quantity,unit,unit_price_ht_cents,tax_rate_bp,line_total_ht_cents,line_tax_cents,line_total_ttc_cents)
          values(tenant_value,p_order_id,ordinal,(item->>'product_id')::uuid,item->>'reference',btrim(item->>'designation'),(item->>'quantity')::numeric,
            item->>'unit',(item->>'unit_price_ht_cents')::integer,(item->>'tax_rate_bp')::integer,0,0,0);
      end if;
    end loop;
    set constraints public.purchase_order_items_position_unique immediate;
  end if;
  select * into po from public.purchase_orders where id=p_order_id;
  return jsonb_build_object('id',po.id,'edit_revision',po.edit_revision);
exception when lock_not_available then
  raise exception using errcode='40001',message='PURCHASE_ORDER_REVISION_CONFLICT';
end;
$$;

create function public.get_purchase_order_item_history(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tenant_value uuid:=private.purchase_order_access(p_order_id,false);
begin
  return jsonb_build_object('events',coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'occurred_at',occurred_at,'actor_id',actor_id,'actor_name',actor_name,'operation',operation,
    'item_id',item_id,'before',before_value,'after',after_value) order by occurred_at,id)
    from private.purchase_order_item_history where tenant_id=tenant_value and purchase_order_id=p_order_id),'[]'::jsonb));
end;
$$;

-- A single STABLE invocation reads headers and every line from one MVCC
-- snapshot. Its JSON aggregate is not truncated by PostgREST's row limit.
-- SECURITY INVOKER deliberately retains the existing SELECT RLS policies.
create function public.get_purchase_order_documents(p_order_ids uuid[])
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare tenant_value uuid:=public.current_tenant_id(); accessible integer; item_count bigint;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='PURCHASE_ORDER_AUTH_REQUIRED'; end if;
  if p_order_ids is null or cardinality(p_order_ids) not between 1 and 1000
    or exists(select 1 from unnest(p_order_ids) id where id is null)
    or cardinality(p_order_ids)<>(select count(distinct id) from unnest(p_order_ids) id) then
    raise exception using errcode='22023',message='PURCHASE_ORDER_INPUT_INVALID';
  end if;
  if not exists(select 1 from public.tenant_memberships tm join public.tenants t on t.id=tm.tenant_id
    where tm.tenant_id=tenant_value and tm.user_id=auth.uid() and t.is_active) then
    raise exception using errcode='42501',message='PURCHASE_ORDER_ACCESS_DENIED';
  end if;
  select count(*) into accessible from public.purchase_orders where id=any(p_order_ids) and tenant_id=tenant_value;
  if accessible<>cardinality(p_order_ids) then raise exception using errcode='42501',message='PURCHASE_ORDER_ACCESS_DENIED'; end if;
  select count(*) into item_count from public.purchase_order_items where purchase_order_id=any(p_order_ids) and tenant_id=tenant_value;
  if item_count>10000 then raise exception using errcode='22023',message='PURCHASE_ORDER_EXPORT_TOO_LARGE'; end if;
  return jsonb_build_object('orders',(select jsonb_agg(jsonb_build_object(
    'id',po.id,'reference',po.reference,'created_at',po.created_at,'status',po.status,
    'expected_delivery_date',po.expected_delivery_date,'total_ht_cents',po.total_ht_cents,
    'total_tax_cents',po.total_tax_cents,'total_ttc_cents',po.total_ttc_cents,'edit_revision',po.edit_revision,
    'suppliers',case when s.id is not null then jsonb_build_object('id',s.id,'name',s.name) end,
    'delivery_sites',case when ds.id is not null then jsonb_build_object('id',ds.id,'name',ds.name) end,
    'items',(select coalesce(jsonb_agg(to_jsonb(oi) order by oi.position,oi.id),'[]'::jsonb)
      from public.purchase_order_items oi where oi.purchase_order_id=po.id and oi.tenant_id=tenant_value)
    ) order by array_position(p_order_ids,po.id))
    from public.purchase_orders po left join public.suppliers s on s.id=po.supplier_id and s.tenant_id=po.tenant_id
    left join public.delivery_sites ds on ds.id=po.delivery_site_id and ds.tenant_id=po.tenant_id
    where po.id=any(p_order_ids) and po.tenant_id=tenant_value));
end;
$$;

revoke all on function private.purchase_order_access(uuid,boolean),private.validate_purchase_order_item(jsonb,boolean),
  private.validate_purchase_order_header(jsonb,uuid,boolean),private.normalize_purchase_order_item(),
  private.revise_purchase_order_header(),private.record_purchase_order_item_change(),private.guard_purchase_order_item_deletion()
  from public,anon,authenticated,service_role;
revoke all on function public.create_purchase_order_draft(jsonb,jsonb),public.replace_purchase_order_draft(uuid,jsonb,jsonb,bigint),
  public.get_purchase_order_item_history(uuid),public.get_purchase_order_documents(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.create_purchase_order_draft(jsonb,jsonb),public.replace_purchase_order_draft(uuid,jsonb,jsonb,bigint),
  public.get_purchase_order_item_history(uuid),public.get_purchase_order_documents(uuid[]) to authenticated;

-- Preserve SITE-01A receipt, ledger, idempotency and locking contracts.
create or replace function public.create_estimate_purchase_order_drafts(
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
        i.quantity is null or i.quantity<=0 or i.quantity<>trunc(i.quantity,3) or i.quantity>2147483647
        or i.unit_price_ht_cents is null or i.unit_price_ht_cents<0 or i.tax_rate_bp is null or i.tax_rate_bp not between 0 and 10000
        or nullif(btrim(i.description),'') is null or nullif(btrim(sp.unit),'') is null
        or (case when btrim(i.description)='ml' then 'm' when lower(btrim(i.description))='ml' then 'millilitre' else lower(btrim(i.description)) end)
          <>(case when btrim(sp.unit)='ml' then 'm' when lower(btrim(sp.unit))='ml' then 'millilitre' else lower(btrim(sp.unit)) end)
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
      line_ht:=round((line_value->>'quantity')::numeric*(line_value->>'unit_price_ht_cents')::bigint);
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
      line_ht:=round((line_value->>'quantity')::numeric*(line_value->>'unit_price_ht_cents')::bigint);
      line_tax:=round(line_ht::numeric*(line_value->>'tax_rate_bp')::integer/10000);
      insert into public.purchase_order_items(tenant_id,purchase_order_id,position,product_id,reference,designation,unit_price_ht_cents,
        tax_rate_bp,quantity,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,source_estimate_item_id,source_selected_supplier_price_id,unit,price_unit)
      values(tenant_value,order_row.id,position_value,(line_value->'_snapshot'->>'product_id')::uuid,line_value->>'supplier_reference',line_value->>'item_title',
        (line_value->>'unit_price_ht_cents')::integer,(line_value->>'tax_rate_bp')::integer,(line_value->>'quantity')::numeric,
        line_ht,line_tax,line_ht+line_tax,(line_value->>'item_id')::uuid,(line_value->>'selected_supplier_price_id')::uuid,line_value->>'unit',line_value->'_snapshot'->>'offer_unit');
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

commit;
