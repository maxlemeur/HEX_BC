-- TI-534, lot 1 : provision FO automatique d'une ligne du moteur 3 (pertes, chutes, petites fournitures).
--
-- Décisions validées le 24/10/2026 (TI-534) :
-- - FO_unitaire = P × provision FO × K FO ; la provision est une colonne de ligne, distincte de K FO ;
-- - 1,03 pour un tube ou un calorifuge (type FO « Tube », « Calorifuge » ou « Isolant »), 1,01 pour tout
--   autre type et pour une ligne sans type ;
-- - toute ligne existante, de tout moteur, reçoit 1,000 : aucun montant existant ne change ;
-- - moteur 3 seulement : une ligne v1/v2 et une section gardent 1,000.
--
-- Règle de dérivation (déclencheur ad_derive_estimate_item_fo_provision, miroir TS dans
-- src/lib/estimates/fo-provision.ts) : une ligne v3 créée sans provision reçoit celle de son type FO
-- (supply_types.default_fo_provision, 1,010 sans type) ; changer le type FO d'une ligne v3 redérive sa
-- provision. Une copie de version (duplicate_estimate_version_without_product_id) garde la provision
-- de chaque ligne ; toute autre création (saisie, collage, modèle, ouvrage, import) est une ligne neuve.

-- ---------------------------------------------------------------------------
-- 1. Provision par type de fourniture.
-- ---------------------------------------------------------------------------
alter table public.supply_types
  add column default_fo_provision numeric(4,3) not null default 1.010;

alter table public.supply_types
  add constraint supply_types_default_fo_provision_check
  check (default_fo_provision >= 1 and default_fo_provision <= 2) not valid;
alter table public.supply_types
  validate constraint supply_types_default_fo_provision_check;

comment on column public.supply_types.default_fo_provision is
  'Engine 3 supply provision given to a new line of this supply type (TI-534): 1.030 for tubes and insulation, 1.010 otherwise.';

-- Types semés par 027_draft_locks (codes tube et calorifuge) et types de même nom créés depuis.
update public.supply_types
set default_fo_provision = 1.030
where code in ('tube', 'calorifuge')
  or lower(btrim(name)) in ('tube', 'tubes', 'calorifuge', 'calorifuges', 'isolant', 'isolants');

-- ---------------------------------------------------------------------------
-- 2. Provision de ligne. Le défaut 1,000 ne sert qu'aux lignes existantes (ajout de colonne sans
--    déclencheur ni réécriture) ; il est retiré aussitôt : toute nouvelle ligne passe par la dérivation.
--    Comme h_mo (dérivé par ab_), la colonne reste nullable au catalogue pour qu'un écrivain puisse
--    l'omettre ; le CHECK, évalué après les déclencheurs BEFORE, interdit qu'une ligne la garde nulle.
-- ---------------------------------------------------------------------------
alter table public.estimate_items
  add column fo_provision numeric(4,3) default 1.000;
alter table public.estimate_items
  alter column fo_provision drop default;

alter table public.estimate_items
  add constraint estimate_items_fo_provision_check
  check (fo_provision is not null and fo_provision >= 1 and fo_provision <= 2) not valid;
alter table public.estimate_items
  validate constraint estimate_items_fo_provision_check;

comment on column public.estimate_items.fo_provision is
  'Engine 3 supply provision of the line (TI-534): FO unit cost = unit price × fo_provision × k_fo. Derived from the supply type on creation and on a supply type change; 1.000 on lines that predate it, on engine 1/2 lines and on sections.';

-- ---------------------------------------------------------------------------
-- 3. Dérivation. Après les gardes (aay_, aaz_) et la dérivation des heures (ab_, ac_), qui gardent la
--    priorité de leurs refus. Security definer : lecture du type FO et de la version sous RLS.
--    Le locataire est lu sur la version : set_estimate_items_tenant_id passe après ce déclencheur.
-- ---------------------------------------------------------------------------
create function private.derive_estimate_item_fo_provision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_engine_version smallint;
  target_tenant_id uuid;
begin
  -- Mise à jour sans changement de type FO ni de provision : rien à lire.
  if tg_op = 'UPDATE'
    and new.fo_provision is not null
    and new.fo_provision is not distinct from old.fo_provision
    and new.supply_type_id is not distinct from old.supply_type_id
  then
    return new;
  end if;

  select version.calc_engine_version, version.tenant_id
    into target_engine_version, target_tenant_id
  from public.estimate_versions version
  where version.id = new.version_id;

  -- Section ou ligne v1/v2 : aucune provision (1,000), refus nommé d'une autre valeur.
  if new.item_type is distinct from 'line'::public.estimate_item_type
    or target_engine_version is distinct from 3
  then
    if new.fo_provision is null then
      new.fo_provision := 1.000;
    elsif new.fo_provision <> 1 then
      raise exception using
        errcode = '0A000',
        message = 'ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED',
        detail = 'fo_provision is an engine 3 line column';
    end if;
    return new;
  end if;

  -- Ligne v3 : provision du type FO à la création sans valeur et à chaque changement de type FO.
  if new.fo_provision is null
    or (
      tg_op = 'UPDATE'
      and new.supply_type_id is distinct from old.supply_type_id
      and new.fo_provision is not distinct from old.fo_provision
    )
  then
    new.fo_provision := coalesce(
      (
        select supply_type.default_fo_provision
        from public.supply_types supply_type
        where supply_type.id = new.supply_type_id
          and supply_type.tenant_id = target_tenant_id
      ),
      1.010
    );
  end if;

  return new;
end;
$$;

comment on function private.derive_estimate_item_fo_provision() is
  'Engine 3 line trigger (TI-534): fo_provision of the supply type (1.010 without one) on a creation without value and on a supply type change; 1.000 on sections and engine 1/2 lines, ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED for another value there.';

revoke all on function private.derive_estimate_item_fo_provision()
  from public, anon, authenticated, service_role;

create trigger ad_derive_estimate_item_fo_provision
  before insert or update on public.estimate_items
  for each row execute function private.derive_estimate_item_fo_provision();

-- ---------------------------------------------------------------------------
-- 4. Moteur 3 SQL : lecture de la provision (copie de 20261017134443, une ligne ajoutée).
-- ---------------------------------------------------------------------------
create or replace function private.estimate_v3_read_item(p_item jsonb)
returns private.estimate_v3_item_input
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  item private.estimate_v3_item_input;
  uuid_pattern constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if jsonb_typeof(p_item) is distinct from 'object'
    or jsonb_typeof(p_item -> 'id') is distinct from 'string'
    or (p_item ->> 'id') !~ uuid_pattern
    or jsonb_typeof(p_item -> 'item_type') is distinct from 'string'
    or (p_item ->> 'item_type') not in ('section', 'line')
    or coalesce(jsonb_typeof(p_item -> 'parent_id'), 'null') not in ('null', 'string')
    or (jsonb_typeof(p_item -> 'parent_id') = 'string' and (p_item ->> 'parent_id') !~ uuid_pattern) then
    raise exception using errcode = '22023', message = 'ESTIMATE_V3_INPUT_INVALID',
      detail = 'every item is an object with a uuid id, an item_type section or line and a null or uuid parent_id';
  end if;
  item.id := (p_item ->> 'id')::uuid;
  item.item_type := p_item ->> 'item_type';
  item.parent_id := (p_item ->> 'parent_id')::uuid;
  if item.item_type = 'section' then
    return item;
  end if;

  if jsonb_typeof(p_item -> 'pricing_status') is distinct from 'string'
    or (p_item ->> 'pricing_status') not in ('priced', 'included', 'for_memory', 'not_priced', 'out_of_scope', 'not_applicable')
    or coalesce(jsonb_typeof(p_item -> 'unit_code'), 'null') not in ('null', 'string') then
    raise exception using errcode = '22023', message = 'ESTIMATE_V3_INPUT_INVALID',
      detail = format('line %s needs one of the six pricing statuses and a null or text unit_code', item.id);
  end if;
  item.pricing_status := p_item ->> 'pricing_status';
  item.unit_code := p_item ->> 'unit_code';
  item.tax_rate_bp := private.estimate_v3_input_number(p_item, 'tax_rate_bp', 0, 10000, null, false);
  item.quantity := private.estimate_v3_input_number(p_item, 'quantity', 3, 999999999.999, 0, false);
  item.unit_price_ht_cents := private.estimate_v3_input_number(p_item, 'unit_price_ht_cents', 0, 2147483647, 0, false);
  item.k_fo := private.estimate_v3_input_number(p_item, 'k_fo', 3, 999999999.999, 1, false);
  -- TI-534 (ajout) : provision FO de la ligne, numeric(4,3), 1 si absente, repliée dans K FO par un
  -- produit exact : FO_u = P × provision × K FO. Le type d'entrée garde ses 19 attributs.
  item.k_fo := item.k_fo * private.estimate_v3_input_number(p_item, 'fo_provision', 3, 9.999, 1, false);
  -- Heures par unité nullables : une colonne nulle donne des heures de ligne nulles (I-04) et
  -- vaut 0 dans la MO.
  item.h_mo_per_unit := private.estimate_v3_input_number(p_item, 'h_mo_per_unit', 4, 99999999.9999, null, true);
  item.h_mo_atelier_per_unit := private.estimate_v3_input_number(p_item, 'h_mo_atelier_per_unit', 4, 99999999.9999, null, true);
  item.h_mo_chantier_per_unit := private.estimate_v3_input_number(p_item, 'h_mo_chantier_per_unit', 4, 99999999.9999, null, true);
  item.h_mo_majoration := private.estimate_v3_input_number(p_item, 'h_mo_majoration', 4, 99999999.9999, 1, false);
  item.k_mo := private.estimate_v3_input_number(p_item, 'k_mo', 3, 999999999.999, 1, false);
  item.k_mo_atelier := private.estimate_v3_input_number(p_item, 'k_mo_atelier', 3, 999999999.999, 1, false);
  item.k_mo_chantier := private.estimate_v3_input_number(p_item, 'k_mo_chantier', 3, 999999999.999, 1, false);
  item.labor_rate_cents := private.estimate_v3_input_number(p_item, 'labor_rate_cents', 0, 2147483647, 0, false);
  item.labor_rate_atelier_cents := private.estimate_v3_input_number(p_item, 'labor_rate_atelier_cents', 0, 2147483647, null, true);
  item.labor_rate_chantier_cents := private.estimate_v3_input_number(p_item, 'labor_rate_chantier_cents', 0, 2147483647, null, true);
  return item;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Entrée canonique depuis les lignes stockées (copie de 20261017162000, une clé ajoutée).
-- ---------------------------------------------------------------------------
create or replace function private.estimate_v3_canonical_input(p_version_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  target_version public.estimate_versions%rowtype;
  project_owner_id uuid;
  labor_split_enabled boolean;
  canonical_items jsonb;
  context_labor_roles jsonb;
begin
  select version.*
    into target_version
  from public.estimate_versions version
  where version.id = p_version_id;

  if target_version.id is null or target_version.calc_engine_version is distinct from 3 then
    raise exception using errcode = '22023', message = 'ESTIMATE_V3_VERSION_REQUIRED';
  end if;

  select project.user_id
    into project_owner_id
  from public.estimate_projects project
  where project.id = target_version.project_id
    and project.tenant_id = target_version.tenant_id;

  select coalesce(bool_or(flag.enabled), false)
    into labor_split_enabled
  from public.feature_flags flag
  where flag.tenant_id = target_version.tenant_id
    and flag.flag_key = 'EST_031_LABOR_SPLIT';

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', item.id,
      'item_type', 'line',
      'parent_id', item.parent_id,
      'pricing_status', item.pricing_status,
      'tax_rate_bp', item.tax_rate_bp,
      'unit_code', item.unit_code,
      'quantity', coalesce(item.quantity, 0),
      'unit_price_ht_cents', coalesce(item.unit_price_ht_cents, 0),
      'k_fo', coalesce(item.k_fo, 1),
      'fo_provision', coalesce(item.fo_provision, 1), -- TI-534 (ajout)
      'h_mo_per_unit', item.h_mo_per_unit,
      'h_mo_atelier_per_unit', item.h_mo_atelier_per_unit,
      'h_mo_chantier_per_unit', item.h_mo_chantier_per_unit,
      'h_mo_majoration', coalesce(item.h_mo_majoration, 1),
      'k_mo', coalesce(item.k_mo, 1),
      'k_mo_atelier', coalesce(item.k_mo_atelier, 1),
      'k_mo_chantier', coalesce(item.k_mo_chantier, 1),
      'labor_rate_cents', coalesce(role_legacy.hourly_rate_cents, 0),
      'labor_rate_atelier_cents', role_atelier.hourly_rate_cents,
      'labor_rate_chantier_cents', role_chantier.hourly_rate_cents
    ) order by item.id), '[]'::jsonb)
    into canonical_items
  from public.estimate_items item
  left join public.labor_roles role_legacy
    on role_legacy.id = item.labor_role_id
   and role_legacy.tenant_id = target_version.tenant_id
   and role_legacy.user_id = project_owner_id
  left join public.labor_roles role_atelier
    on role_atelier.id = item.labor_role_atelier_id
   and role_atelier.tenant_id = target_version.tenant_id
   and role_atelier.user_id = project_owner_id
  left join public.labor_roles role_chantier
    on role_chantier.id = item.labor_role_chantier_id
   and role_chantier.tenant_id = target_version.tenant_id
   and role_chantier.user_id = project_owner_id
  where item.version_id = target_version.id
    and item.tenant_id = target_version.tenant_id
    and item.item_type = 'line'::public.estimate_item_type;

  -- Contexte figé (§6.5) : rôles cités par les lignes, par id croissant, comme le gel v2.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', referenced.role_id,
      'hourly_rate_cents', coalesce(role.hourly_rate_cents, 0)
    ) order by referenced.role_id), '[]'::jsonb)
    into context_labor_roles
  from (
    select item.labor_role_id as role_id
    from public.estimate_items item
    where item.version_id = target_version.id
      and item.tenant_id = target_version.tenant_id
    union
    select item.labor_role_atelier_id
    from public.estimate_items item
    where item.version_id = target_version.id
      and item.tenant_id = target_version.tenant_id
    union
    select item.labor_role_chantier_id
    from public.estimate_items item
    where item.version_id = target_version.id
      and item.tenant_id = target_version.tenant_id
  ) referenced
  left join public.labor_roles role
    on role.id = referenced.role_id
   and role.tenant_id = target_version.tenant_id
   and role.user_id = project_owner_id
  where referenced.role_id is not null;

  return jsonb_build_object(
    'params', jsonb_build_object(
      'sale_coefficient_fo', target_version.sale_coefficient_fo,
      'sale_coefficient_mo', target_version.sale_coefficient_mo,
      'discount_amount_cents', target_version.discount_amount_cents,
      'discount_bp', target_version.discount_bp,
      'rounding_mode', target_version.rounding_mode::text,
      'rounding_step_cents', target_version.rounding_step_cents,
      'reverse_charge', target_version.contractor_role = 'subcontractor',
      'labor_split_enabled', labor_split_enabled
    ),
    'items', canonical_items,
    'labor_roles', context_labor_roles
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Duplication de version : la copie garde la provision de chaque ligne, ses montants restent ceux
--    de la source (copie de 20261017162000, deux lignes ajoutées).
-- ---------------------------------------------------------------------------
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
    selected_supplier_price_id,
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
    product_id
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
    src.k_fo,
    src.fo_provision, -- TI-534 (ajout)
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
    src.selected_supplier_price_id,
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
    case when source_is_v3 then src.product_id end
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
    decided_by
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
    src.decided_by
  from public.takeoff_dpgf_review_decisions src
  where src.version_id = duplicate_estimate_version_without_product_id.source_version_id;

  return new_version_id;
end;
$function$
;
