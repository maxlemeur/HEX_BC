-- TI-690, lot 1, livraison 1 : un article du catalogue est « brouillon » ou « validé ».
-- Le catalogue va recevoir des articles incomplets (import d'une base de chiffrage, puis articles créés depuis une
-- demande de matériel). Un brouillon se rattache à une demande, mais ne doit pas alimenter un chiffrage par mégarde :
-- l'éditeur de devis ne suggère que les articles validés (filtre TypeScript, supplier-comparison-server.ts).
--
-- - products.catalogue_status ('draft' | 'validated'), « validated » par défaut : les chemins d'écriture existants
--   (import CSV, modèle, RPC d'offre, liaison DPGF) ne posent aucun état et leurs articles restent suggérés.
--   Le brouillon est toujours posé explicitement.
-- - products.supply_type_id : le type de fourniture de l'article, dans la liste des chiffrages (supply_types).
--   Même tenant exigé par déclencheur, la clé étrangère n'étant pas composite.
-- - products.reliability_score (0 à 10, nul) : note reprise de la base importée ; elle trie la file des brouillons.
-- - products.catalogue_validated_at / _by : posés par le serveur au passage brouillon -> validé, effacés au retour
--   en brouillon, jamais acceptés du client.
-- - Passage brouillon -> validé : type, matériau, unité et type de fourniture exigés (PRODUCT_VALIDATION_INCOMPLETE).
--   La dimension n'est pas exigée : elle n'a pas de sens pour tous les articles. La référence, le fournisseur et le
--   prix non plus : ils arrivent avec la première consultation ou le premier achat.
--   La règle ne porte que sur ce passage : les articles déjà validés par défaut ne sont pas revisités.
-- - catalogue_products_page : filtre p_catalogue_statuses, tri reliability_score, colonnes d'état en sortie.
--   La signature change : suppression puis création, droits rétablis.

begin;

alter table public.products
  add column catalogue_status text not null default 'validated',
  add column supply_type_id uuid references public.supply_types(id) on delete set null,
  add column reliability_score smallint,
  add column catalogue_validated_at timestamptz,
  add column catalogue_validated_by uuid references auth.users(id) on delete set null,
  add constraint products_catalogue_status_check check (catalogue_status in ('draft', 'validated')),
  add constraint products_reliability_score_check check (reliability_score between 0 and 10);

comment on column public.products.catalogue_status is
  'draft: incomplete or unreviewed, kept out of estimate suggestions. validated: approved by an administrator, or created by a path that predates the status.';
comment on column public.products.reliability_score is
  'Imported 0-10 confidence note. Orders the review queue; never read by pricing.';

create index products_supply_type_id_idx
  on public.products (supply_type_id)
  where supply_type_id is not null;

create index products_catalogue_validated_by_idx
  on public.products (catalogue_validated_by)
  where catalogue_validated_by is not null;

create function private.enforce_product_catalogue_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  missing text[] := '{}'::text[];
begin
  if new.supply_type_id is not null
    and (tg_op = 'INSERT' or new.supply_type_id is distinct from old.supply_type_id
      or new.tenant_id is distinct from old.tenant_id)
    and not exists (
      select 1
      from public.supply_types supply_type
      where supply_type.id = new.supply_type_id
        and supply_type.tenant_id = new.tenant_id
    )
  then
    raise exception using errcode = '23514', message = 'PRODUCT_SUPPLY_TYPE_INVALID';
  end if;

  if tg_op = 'INSERT' then
    new.catalogue_validated_at := null;
    new.catalogue_validated_by := null;
    return new;
  end if;

  if old.catalogue_status = 'draft' and new.catalogue_status = 'validated' then
    if nullif(pg_catalog.btrim(coalesce(new.product_type, '')), '') is null then
      missing := pg_catalog.array_append(missing, 'product_type');
    end if;
    if nullif(pg_catalog.btrim(coalesce(new.material, '')), '') is null then
      missing := pg_catalog.array_append(missing, 'material');
    end if;
    if nullif(pg_catalog.btrim(coalesce(new.unit, '')), '') is null then
      missing := pg_catalog.array_append(missing, 'unit');
    end if;
    if new.supply_type_id is null then
      missing := pg_catalog.array_append(missing, 'supply_type_id');
    end if;
    if pg_catalog.cardinality(missing) > 0 then
      raise exception using
        errcode = '23514',
        message = 'PRODUCT_VALIDATION_INCOMPLETE',
        detail = pg_catalog.array_to_string(missing, ',');
    end if;
    new.catalogue_validated_at := pg_catalog.clock_timestamp();
    new.catalogue_validated_by := (select auth.uid());
  elsif new.catalogue_status = 'draft' then
    new.catalogue_validated_at := null;
    new.catalogue_validated_by := null;
  else
    new.catalogue_validated_at := old.catalogue_validated_at;
    -- The author may be erased, never forged: restoring it unconditionally would undo ON DELETE SET NULL
    -- when the validator's account is deleted, and leave a reference to a user that no longer exists.
    if new.catalogue_validated_by is not null then
      new.catalogue_validated_by := old.catalogue_validated_by;
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function private.enforce_product_catalogue_status() from public, anon, authenticated;

-- Named to fire after set_products_tenant_id: the supply type is checked against the assigned tenant.
create trigger validate_product_catalogue_status
  before insert or update on public.products
  for each row execute function private.enforce_product_catalogue_status();

drop function public.catalogue_products_page(text, text[], text[], text[], text[], text[], text, text, integer, integer);

-- Copied from 20261017172127; adds the catalogue status filter, the reliability sort and the status columns.
create function public.catalogue_products_page(
  p_q text default null,
  p_materials text[] default '{}'::text[],
  p_categories text[] default '{}'::text[],
  p_units text[] default '{}'::text[],
  p_price_statuses text[] default '{}'::text[],
  p_statuses text[] default '{}'::text[],
  p_sort text default 'designation',
  p_dir text default 'asc',
  p_page integer default 1,
  p_size integer default 25,
  p_catalogue_statuses text[] default '{}'::text[]
)
returns table (
  id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  reference text,
  designation text,
  unit_price_cents integer,
  is_active boolean,
  category text,
  product_type text,
  material text,
  grade text,
  dimensions text,
  standard text,
  unit text,
  reference_quantity numeric,
  reference_transport_mode text,
  reference_price_validation_id uuid,
  reference_price_source_order_id uuid,
  reference_price_source_order_reference text,
  reference_price_source_supplier_name text,
  reference_price_source_date date,
  supplier_price_count bigint,
  best_supplier_price_cents integer,
  best_supplier_name text,
  best_supplier_price_updated_at timestamptz,
  price_status text,
  catalogue_status text,
  supply_type_id uuid,
  supply_type_name text,
  reliability_score smallint,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with enriched as (
    select
      product.id,
      product.created_at,
      product.updated_at,
      product.reference,
      product.designation,
      product.unit_price_cents,
      product.is_active,
      product.category,
      product.product_type,
      product.material,
      product.grade,
      product.dimensions,
      product.standard,
      product.unit,
      product.reference_quantity,
      product.reference_transport_mode,
      product.reference_price_validation_id,
      product.reference_price_source_order_id,
      reference_order.reference as reference_price_source_order_reference,
      reference_supplier.name as reference_price_source_supplier_name,
      product.reference_price_source_date,
      coalesce(best_price.price_count, 0)::bigint as supplier_price_count,
      case when best_price.price_eligible then best_price.unit_price_cents end as best_supplier_price_cents,
      case when best_price.price_eligible then best_price.supplier_name end as best_supplier_name,
      case when best_price.price_eligible then best_price.price_updated_at end as best_supplier_price_updated_at,
      case
        when best_price.id is null or not best_price.price_eligible then 'none'
        when current_date - best_price.price_updated_at::date <= 30 then 'fresh'
        when current_date - best_price.price_updated_at::date <= 90 then 'aging'
        else 'stale'
      end as price_status,
      product.catalogue_status,
      product.supply_type_id,
      supply_type.name as supply_type_name,
      product.reliability_score
    from public.products product
    left join public.supply_types supply_type
      on supply_type.id = product.supply_type_id
      and supply_type.tenant_id = product.tenant_id
    left join public.purchase_orders reference_order
      on reference_order.id = product.reference_price_source_order_id
      and reference_order.tenant_id = product.tenant_id
    left join public.suppliers reference_supplier
      on reference_supplier.id = reference_order.supplier_id
      and reference_supplier.tenant_id = product.tenant_id
    left join lateral (
      select
        supplier_price.id,
        -- 2.9: compared and shown per estimate unit (a bar of 3 m at 262,45 € is 87,48 € per metre).
        case when supplier_price.estimate_units_per_purchase_unit is not null
          then pg_catalog.round(supplier_price.unit_price_cents / supplier_price.estimate_units_per_purchase_unit)::integer
          else supplier_price.unit_price_cents end as unit_price_cents,
        supplier.name as supplier_name,
        coalesce(supplier_price.updated_at, supplier_price.created_at) as price_updated_at,
        public.supplier_offer_price_eligible(supplier_price.unit_price_cents, supplier_price.zero_price_kind) as price_eligible,
        count(*) over ()::bigint as price_count
      from public.supplier_pricebook supplier_price
      join public.suppliers supplier on supplier.id = supplier_price.supplier_id
      where supplier_price.product_id = product.id
        and supplier_price.is_active
        and supplier_price.valid_from <= current_date
        and (supplier_price.valid_to is null or supplier_price.valid_to >= current_date)
      order by public.supplier_offer_price_eligible(supplier_price.unit_price_cents, supplier_price.zero_price_kind) desc,
        case when supplier_price.estimate_units_per_purchase_unit is not null
          then pg_catalog.round(supplier_price.unit_price_cents / supplier_price.estimate_units_per_purchase_unit)
          else supplier_price.unit_price_cents end asc, supplier_price.updated_at desc, supplier_price.id asc
      limit 1
    ) best_price on true
  ),
  filtered as (
    select enriched.*
    from enriched
    where (
      nullif(btrim(p_q), '') is null
      or public.catalogue_normalize_search(
        coalesce(enriched.reference, '') || ' ' ||
        coalesce(enriched.designation, '') || ' ' ||
        coalesce(enriched.category, '') || ' ' ||
        coalesce(enriched.product_type, '') || ' ' ||
        coalesce(enriched.material, '') || ' ' ||
        coalesce(enriched.grade, '') || ' ' ||
        coalesce(enriched.dimensions, '') || ' ' ||
        coalesce(enriched.standard, '')
      ) like '%' || public.catalogue_normalize_search(btrim(p_q)) || '%'
    )
      and (cardinality(p_materials) = 0 or coalesce(enriched.material, '') = any(p_materials))
      and (cardinality(p_categories) = 0 or coalesce(enriched.category, '') = any(p_categories))
      and (cardinality(p_units) = 0 or coalesce(enriched.unit, '') = any(p_units))
      and (cardinality(p_price_statuses) = 0 or enriched.price_status = any(p_price_statuses))
      and (
        cardinality(p_statuses) = 0
        or (enriched.is_active and 'active' = any(p_statuses))
        or (not enriched.is_active and 'archived' = any(p_statuses))
      )
      and (cardinality(p_catalogue_statuses) = 0 or enriched.catalogue_status = any(p_catalogue_statuses))
  )
  select
    filtered.id,
    filtered.created_at,
    filtered.updated_at,
    filtered.reference,
    filtered.designation,
    filtered.unit_price_cents,
    filtered.is_active,
    filtered.category,
    filtered.product_type,
    filtered.material,
    filtered.grade,
    filtered.dimensions,
    filtered.standard,
    filtered.unit,
    filtered.reference_quantity,
    filtered.reference_transport_mode,
    filtered.reference_price_validation_id,
    filtered.reference_price_source_order_id,
    filtered.reference_price_source_order_reference,
    filtered.reference_price_source_supplier_name,
    filtered.reference_price_source_date,
    filtered.supplier_price_count,
    filtered.best_supplier_price_cents,
    filtered.best_supplier_name,
    filtered.best_supplier_price_updated_at,
    filtered.price_status,
    filtered.catalogue_status,
    filtered.supply_type_id,
    filtered.supply_type_name,
    filtered.reliability_score,
    count(*) over ()::bigint as total_count
  from filtered
  order by
    case when p_sort = 'designation' and p_dir = 'asc' then lower(filtered.designation) end asc,
    case when p_sort = 'designation' and p_dir = 'desc' then lower(filtered.designation) end desc,
    case when p_sort = 'material' and p_dir = 'asc' then lower(filtered.material) end asc nulls last,
    case when p_sort = 'material' and p_dir = 'desc' then lower(filtered.material) end desc nulls last,
    case when p_sort = 'unit_price_cents' and p_dir = 'asc' then filtered.unit_price_cents end asc,
    case when p_sort = 'unit_price_cents' and p_dir = 'desc' then filtered.unit_price_cents end desc,
    case when p_sort = 'best_supplier_price_cents' and p_dir = 'asc' then filtered.best_supplier_price_cents end asc nulls last,
    case when p_sort = 'best_supplier_price_cents' and p_dir = 'desc' then filtered.best_supplier_price_cents end desc nulls last,
    case when p_sort = 'updated_at' and p_dir = 'asc' then filtered.updated_at end asc,
    case when p_sort = 'updated_at' and p_dir = 'desc' then filtered.updated_at end desc,
    -- Review queue: an unrated article never outranks a rated one, whatever the direction.
    case when p_sort = 'reliability_score' and p_dir = 'asc' then filtered.reliability_score end asc nulls last,
    case when p_sort = 'reliability_score' and p_dir = 'desc' then filtered.reliability_score end desc nulls last,
    filtered.id asc
  offset (greatest(p_page, 1) - 1) * least(greatest(p_size, 1), 100)
  limit least(greatest(p_size, 1), 100);
$$;

revoke execute on function public.catalogue_products_page(text, text[], text[], text[], text[], text[], text, text, integer, integer, text[]) from public, anon;
grant execute on function public.catalogue_products_page(text, text[], text[], text[], text[], text[], text, text, integer, integer, text[]) to authenticated;

commit;
