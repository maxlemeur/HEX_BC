-- Keep sparse product detachment consistent with the TypeScript price-origin projection.
-- A detached reference price no longer proves included transport.
begin;

create or replace function private.derive_estimate_item_fo_provision()
returns trigger language plpgsql security definer set search_path = '' as $fo$
declare
  engine smallint;
  tenant uuid;
  selected boolean := false;
  changed_origin boolean := false;
  source_product uuid;
  source_id uuid;
  source_kind text;
  transport text;
  product_type text;
  provision numeric;
  sensitive boolean;
  inferred_type uuid;
  exact_type_count integer;
  requested_selection uuid;
  preserve_absence boolean := false;
begin
  if tg_op='INSERT' and new.fo_price_origin='{}'::jsonb then
    preserve_absence := true;
    new.fo_price_origin := null;
  end if;
  if tg_op = 'UPDATE' and new.fo_provision is not null
    and new.fo_provision is not distinct from old.fo_provision
    and new.supply_type_id is not distinct from old.supply_type_id
    and new.product_id is not distinct from old.product_id
    and new.selected_supplier_price_id is not distinct from old.selected_supplier_price_id
    and new.unit_price_ht_cents is not distinct from old.unit_price_ht_cents
    and new.fo_price_origin is not distinct from old.fo_price_origin then return new; end if;

  select v.calc_engine_version,v.tenant_id into engine,tenant from public.estimate_versions v where v.id=new.version_id;
  if new.item_type is distinct from 'line'::public.estimate_item_type or engine is distinct from 3 then
    if new.fo_price_origin is not null or coalesce(new.fo_provision,1) <> 1 then
      raise exception using errcode='0A000',message='ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED';
    end if;
    new.fo_provision := 1;
    return new;
  end if;
  -- Version duplication supplies a provision and the saved origin verbatim.
  if tg_op='INSERT' and new.fo_provision is not null then return new; end if;

  if tg_op='INSERT' then
    selected := not preserve_absence and (new.selected_supplier_price_id is not null or new.product_id is not null);
  else
    changed_origin := new.fo_price_origin is distinct from old.fo_price_origin;
    selected := (new.selected_supplier_price_id is not null and new.selected_supplier_price_id is distinct from old.selected_supplier_price_id)
      or (new.product_id is not null and new.product_id is distinct from old.product_id)
      or (changed_origin and new.fo_price_origin is not null);
    if not selected and (new.unit_price_ht_cents is distinct from old.unit_price_ht_cents
      or new.selected_supplier_price_id is distinct from old.selected_supplier_price_id
      or new.product_id is distinct from old.product_id) then
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

  if tg_op='INSERT' or selected or new.fo_price_origin is distinct from old.fo_price_origin
    or (new.supply_type_id is distinct from old.supply_type_id and new.fo_provision is not distinct from old.fo_provision)
    or new.fo_provision is null then
    select s.default_fo_provision,
      (lower(btrim(s.code)) in ('tube','tubes','calorifuge','calorifuges','isolant','isolants')
       or lower(btrim(s.name)) in ('tube','tubes','calorifuge','calorifuges','isolant','isolants'))
      into provision,sensitive from public.supply_types s where s.id=new.supply_type_id and s.tenant_id=tenant;
    new.fo_provision := case when sensitive and new.fo_price_origin->>'transport_mode'='included' then 1.010 else coalesce(provision,1.010) end;
  end if;
  return new;
end;
$fo$;

commit;
