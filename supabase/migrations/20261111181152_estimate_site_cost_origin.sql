-- TI-541: a supply cost typed for one quote, with its source (supplier, offer reference, date, document).
-- It is a third kind of saved price origin, « site », beside « supplier » and « reference ». Nothing of it
-- is written to the catalogue: no product, no supplier offer and no reference price is read or changed.
-- The transport condition of the offer is kept like the catalogue kinds, so an offer with transport
-- included does not take a second transport provision. Typing another cost by hand afterwards drops
-- the source, as it already drops a catalogue origin.
-- A POSE SEULE line (TI-539) takes neither losses nor transport, even when it carries a small supply needed
-- for the fitting: its provision is 1 while it keeps that nature, and is derived again when it leaves it
-- (answer of the business owner, 11 November 2026).
begin;

alter table public.estimate_items drop constraint estimate_items_fo_price_origin_check;
alter table public.estimate_items add constraint estimate_items_fo_price_origin_check check (
  -- coalesce: a missing key makes a comparison null, and a null check would accept the row.
  fo_price_origin is null or coalesce((
    jsonb_typeof(fo_price_origin) = 'object'
    and fo_price_origin ?& array['selection_id','kind','source_id','transport_mode']
    and fo_price_origin->>'selection_id' ~ '^[0-9a-fA-F-]{36}$'
    and fo_price_origin->>'source_id' ~ '^[0-9a-fA-F-]{36}$'
    and (fo_price_origin->'transport_mode' = 'null'::jsonb or fo_price_origin->>'transport_mode' in ('included','excluded'))
    and (
      (fo_price_origin->>'kind' in ('supplier','reference')
        and fo_price_origin - array['selection_id','kind','source_id','transport_mode'] = '{}'::jsonb)
      or (fo_price_origin->>'kind' = 'site'
        and fo_price_origin - array['selection_id','kind','source_id','transport_mode','site'] = '{}'::jsonb
        and fo_price_origin->>'source_id' = fo_price_origin->>'selection_id'
        -- A site origin is stored as sent, so its id is held to what the application reads back (a string, RFC 9562).
        and jsonb_typeof(fo_price_origin->'selection_id') = 'string'
        and fo_price_origin->>'selection_id' ~ '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$'
        and jsonb_typeof(fo_price_origin->'site') = 'object'
        and fo_price_origin->'site' ?& array['supplier','offer_reference','offer_date','document']
        and (fo_price_origin->'site') - array['supplier','offer_reference','offer_date','document'] = '{}'::jsonb
        and jsonb_typeof(fo_price_origin#>'{site,supplier}') = 'string'
        and fo_price_origin#>>'{site,supplier}' ~ '^[^\x01-\x1f ]([^\x01-\x1f]{0,118}[^\x01-\x1f ])?$'
        and (fo_price_origin#>'{site,offer_reference}' = 'null'::jsonb
          or jsonb_typeof(fo_price_origin#>'{site,offer_reference}') = 'string'
            and fo_price_origin#>>'{site,offer_reference}' ~ '^[^\x01-\x1f ]([^\x01-\x1f]{0,118}[^\x01-\x1f ])?$')
        and jsonb_typeof(fo_price_origin#>'{site,offer_date}') = 'string'
        and fo_price_origin#>>'{site,offer_date}' ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
        and (fo_price_origin#>'{site,document}' = 'null'::jsonb
          or jsonb_typeof(fo_price_origin#>'{site,document}') = 'string'
            and fo_price_origin#>>'{site,document}' ~ '^[^\x01-\x1f ]([^\x01-\x1f]{0,198}[^\x01-\x1f ])?$')
      )
    )
  ), false)
);
comment on column public.estimate_items.fo_price_origin is
  'Saved origin of the supply cost of an engine 3 line: a catalogue supplier offer, the catalogue reference price, or a site cost typed for this quote with its source (TI-534, TI-541). Independent of later catalogue changes.';

-- Latest owning definition: 20261109192026_clear_detached_fo_price_origin.sql. Added the site kind and the
-- POSE SEULE rule: the same events derive the provision, plus a line entering or leaving POSE SEULE.
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
  site boolean := false;
  pose_only boolean := false;
  pose_changed boolean := false;
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
    and new.fo_price_origin is not distinct from old.fo_price_origin
    and coalesce(new.line_nature::text='pose_only',false)=coalesce(old.line_nature::text='pose_only',false) then return new; end if;

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

  -- POSE SEULE: no losses, no transport. The nature is explicit (never inferred), so it is read as written.
  pose_only := coalesce(new.line_nature::text='pose_only',false);
  pose_changed := tg_op='UPDATE' and pose_only<>coalesce(old.line_nature::text='pose_only',false);
  if tg_op='INSERT' or selected or pose_changed or new.fo_price_origin is distinct from old.fo_price_origin
    or (new.supply_type_id is distinct from old.supply_type_id and new.fo_provision is not distinct from old.fo_provision)
    or new.fo_provision is null then
    if pose_only then
      new.fo_provision := 1;
    else
      select s.default_fo_provision,
        (lower(btrim(s.code)) in ('tube','tubes','calorifuge','calorifuges','isolant','isolants')
         or lower(btrim(s.name)) in ('tube','tubes','calorifuge','calorifuges','isolant','isolants'))
        into provision,sensitive from public.supply_types s where s.id=new.supply_type_id and s.tenant_id=tenant;
      new.fo_provision := case when sensitive and new.fo_price_origin->>'transport_mode'='included' then 1.010 else coalesce(provision,1.010) end;
    end if;
  end if;
  return new;
end;
$fo$;
revoke all on function private.derive_estimate_item_fo_provision() from public, anon, authenticated, service_role;

commit;
