-- Lot 2, sous-lot 2.5 (M4) : persistance, gel et règles du moteur 3, derrière la politique
-- d'entreprise. Conception : docs/audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md
-- (D2 à D9, D12, D15, D17, §6.1 « M4 », §6.2 à §6.5, §7) ; contrat et preuves :
-- docs/testing/estimate-engine-v3-2.5.md et supabase/tests/database/estimate-engine-v3-persistence.test.sql.
--
-- Après cette migration :
--   - public.tenant_calc_policies (une ligne par entreprise, absente = moteur 2) et son journal
--     public.tenant_calc_policy_events ; écriture par public.set_tenant_calc_policy, exécutable
--     par service_role seul (P-13) ;
--   - persist_estimate_creation_atomic lit la politique FOR SHARE et compare le moteur attendu
--     par le client (absent = 2) : écart = 40001 ESTIMATE_CALC_POLICY_CONTEXT_CHANGED, rien d'écrit ;
--     sous politique 3, contrat d'insertion canonical_v3 ;
--   - colonnes v3 des versions et des lignes (D4 à D9), CHECK de forme v3 ; colonnes v1/v2
--     neutres (aucune reprise, D17) ;
--   - création, lot, ligne, réglages et duplication écrivent une v3 sous le contrat d'écrivain
--     et contrôlent la projection (private.estimate_v3_assert_draft, D12) ;
--   - gel v3 par public.freeze_estimate_v3_snapshot (recalcul complet, égalité au centime) ;
--   - list_approval_queue lit la marque nette d'un gel v3 frais ;
--   - l'émission d'une v3 reste refusée (M1, jusqu'à M5).
--
-- Les fonctions redéfinies partent de pg_get_functiondef sur une pile native reconstruite à
-- 20261017134443 ; seules les lignes v3 changent. Fonctions security invoker inchangées en mode :
-- elles atteignent les fonctions privées du moteur par deux passerelles security definer
-- liées au contrat d'écrivain (public.estimate_v3_assert_draft_for_writer,
-- public.estimate_v3_compute_for_writer) ; la dérivation des heures passe par un déclencheur
-- security definer du schéma private (les fonctions de déclencheur ne sont pas appelables).

do $preflight$
begin
  if to_regclass('public.tenant_calc_policies') is not null
    or to_regclass('public.tenant_calc_policy_events') is not null then
    raise exception 'LOT2_2_5_PREFLIGHT: the tenant calculation policy already exists';
  end if;
  if to_regtype('public.estimate_line_pricing_status') is null
    or to_regclass('public.measurement_units') is null
    or to_regprocedure('private.estimate_v3_compute_items(jsonb,jsonb)') is null
    or to_regprocedure('private.estimate_v3_line_values(private.estimate_v3_item_input,private.estimate_v3_params_input)') is null then
    raise exception 'LOT2_2_5_PREFLIGHT: M3 (20261017134443) must be applied first';
  end if;
  if exists (
    select 1
    from pg_attribute attribute
    where attribute.attrelid in ('public.estimate_versions'::regclass, 'public.estimate_items'::regclass)
      and attribute.attname in (
        'sale_coefficient_fo', 'sale_coefficient_mo', 'gross_ht_cents', 'discount_applied_cents',
        'commercial_rounding_cents', 'unit_code', 'pricing_status', 'h_mo_per_unit',
        'h_mo_atelier_per_unit', 'h_mo_chantier_per_unit', 'snapshot_gross_ht_cents',
        'snapshot_gross_fo_ht_cents'
      )
      and not attribute.attisdropped
  ) then
    raise exception 'LOT2_2_5_PREFLIGHT: a v3 column already exists';
  end if;
  -- D17 : aucune v3 n'existe avant M4 (M1 n'en admet que par une fixture de test).
  if exists (select 1 from public.estimate_versions version where version.calc_engine_version = 3) then
    raise exception 'LOT2_2_5_PREFLIGHT: an engine 3 version already exists';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Politique d'entreprise typée (D3, §6.3, P-13).
-- ---------------------------------------------------------------------------
create table public.tenant_calc_policies (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  new_estimate_calc_engine smallint not null default 2
    check (new_estimate_calc_engine in (2, 3)),
  default_sale_coefficient_fo numeric(8,4)
    check (default_sale_coefficient_fo > 0 and default_sale_coefficient_fo <= 10),
  default_sale_coefficient_mo numeric(8,4)
    check (default_sale_coefficient_mo > 0 and default_sale_coefficient_mo <= 10),
  allowed_tax_rates_bp integer[] not null default '{2000,1000,550,210}'
    check (
      cardinality(allowed_tax_rates_bp) > 0
      and array_position(allowed_tax_rates_bp, null) is null
      and 0 <= all(allowed_tax_rates_bp)
      and 10000 >= all(allowed_tax_rates_bp)
    ),
  change_reason text not null check (char_length(change_reason) between 5 and 500),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint tenant_calc_policies_v3_requires_defaults check (
    new_estimate_calc_engine = 2
    or (default_sale_coefficient_fo is not null and default_sale_coefficient_mo is not null)
  )
);

comment on table public.tenant_calc_policies is
  'Typed tenant calculation policy (lot 2, D3): engine of new estimate versions (absent row = 2), default v3 sale coefficients, VAT rates allowed at the v3 freeze, reason and author. Written only by public.set_tenant_calc_policy (service_role, P-13).';

create table public.tenant_calc_policy_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  previous_policy jsonb,
  new_policy jsonb not null,
  change_reason text not null,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index tenant_calc_policy_events_tenant_created_idx
  on public.tenant_calc_policy_events (tenant_id, created_at);
create index tenant_calc_policies_updated_by_idx
  on public.tenant_calc_policies (updated_by);
create index tenant_calc_policy_events_changed_by_idx
  on public.tenant_calc_policy_events (changed_by);

comment on table public.tenant_calc_policy_events is
  'Journal of tenant calculation policy changes (before/after images, reason, author), one row per set_tenant_calc_policy call.';

alter table public.tenant_calc_policies enable row level security;
alter table public.tenant_calc_policy_events enable row level security;

create policy "Tenant members read their calculation policy"
  on public.tenant_calc_policies
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_calc_policies.tenant_id)));

create policy "Tenant members read their calculation policy journal"
  on public.tenant_calc_policy_events
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_calc_policy_events.tenant_id)));

revoke all on table public.tenant_calc_policies from public, anon, authenticated;
revoke all on table public.tenant_calc_policy_events from public, anon, authenticated;
grant select on table public.tenant_calc_policies to authenticated;
grant select on table public.tenant_calc_policy_events to authenticated;
grant select, insert, update, delete on table public.tenant_calc_policies to service_role;
grant select, insert, update, delete on table public.tenant_calc_policy_events to service_role;

-- Les créations lisent la politique sous ce verrou partagé ; l'écrivain le prend exclusif, ce
-- qui couvre aussi la première écriture (aucune ligne à verrouiller FOR SHARE).
create function public.set_tenant_calc_policy(
  p_tenant_id uuid,
  p_new_estimate_calc_engine smallint,
  p_default_sale_coefficient_fo numeric,
  p_default_sale_coefficient_mo numeric,
  p_allowed_tax_rates_bp integer[],
  p_change_reason text,
  p_actor_user_id uuid
)
returns public.tenant_calc_policies
language plpgsql
security definer
set search_path = ''
as $$
declare
  change_reason text := pg_catalog.btrim(p_change_reason);
  previous_policy public.tenant_calc_policies%rowtype;
  written_policy public.tenant_calc_policies%rowtype;
begin
  if change_reason is null or char_length(change_reason) < 5 or char_length(change_reason) > 500 then
    raise exception using errcode = '22023', message = 'TENANT_CALC_POLICY_REASON_REQUIRED';
  end if;
  if p_tenant_id is null
    or p_actor_user_id is null
    or p_new_estimate_calc_engine is null
    or p_new_estimate_calc_engine not in (2, 3)
    or not exists (select 1 from public.tenants tenant where tenant.id = p_tenant_id)
  then
    raise exception using errcode = '22023', message = 'TENANT_CALC_POLICY_INVALID';
  end if;
  if p_new_estimate_calc_engine = 3
    and (p_default_sale_coefficient_fo is null or p_default_sale_coefficient_mo is null)
  then
    raise exception using errcode = '22023', message = 'TENANT_CALC_POLICY_V3_DEFAULTS_REQUIRED';
  end if;
  -- Un coefficient au-delà de 4 décimales serait arrondi en silence par numeric(8,4).
  if (p_default_sale_coefficient_fo is not null and (
        p_default_sale_coefficient_fo <= 0 or p_default_sale_coefficient_fo > 10
        or pg_catalog.min_scale(p_default_sale_coefficient_fo) > 4))
    or (p_default_sale_coefficient_mo is not null and (
        p_default_sale_coefficient_mo <= 0 or p_default_sale_coefficient_mo > 10
        or pg_catalog.min_scale(p_default_sale_coefficient_mo) > 4))
    or (p_allowed_tax_rates_bp is not null and (
        cardinality(p_allowed_tax_rates_bp) = 0
        or array_position(p_allowed_tax_rates_bp, null) is not null
        or not (0 <= all(p_allowed_tax_rates_bp) and 10000 >= all(p_allowed_tax_rates_bp))))
  then
    raise exception using errcode = '22023', message = 'TENANT_CALC_POLICY_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('estimate-calc-policy:' || p_tenant_id::text, 0)
  );

  select policy.*
    into previous_policy
  from public.tenant_calc_policies policy
  where policy.tenant_id = p_tenant_id
  for update;

  insert into public.tenant_calc_policies as policy (
    tenant_id,
    new_estimate_calc_engine,
    default_sale_coefficient_fo,
    default_sale_coefficient_mo,
    allowed_tax_rates_bp,
    change_reason,
    updated_by,
    updated_at
  )
  values (
    p_tenant_id,
    p_new_estimate_calc_engine,
    p_default_sale_coefficient_fo,
    p_default_sale_coefficient_mo,
    coalesce(p_allowed_tax_rates_bp, '{2000,1000,550,210}'::integer[]),
    change_reason,
    p_actor_user_id,
    now()
  )
  on conflict (tenant_id) do update
  set
    new_estimate_calc_engine = excluded.new_estimate_calc_engine,
    default_sale_coefficient_fo = excluded.default_sale_coefficient_fo,
    default_sale_coefficient_mo = excluded.default_sale_coefficient_mo,
    allowed_tax_rates_bp = excluded.allowed_tax_rates_bp,
    change_reason = excluded.change_reason,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at
  returning policy.* into written_policy;

  insert into public.tenant_calc_policy_events (
    tenant_id,
    previous_policy,
    new_policy,
    change_reason,
    changed_by
  )
  values (
    p_tenant_id,
    case when previous_policy.tenant_id is null then null else to_jsonb(previous_policy) end,
    to_jsonb(written_policy),
    change_reason,
    p_actor_user_id
  );

  return written_policy;
end;
$$;

comment on function public.set_tenant_calc_policy(uuid, smallint, numeric, numeric, integer[], text, uuid) is
  'Sole writer of the tenant calculation policy (D3, P-13: service_role only during lot 2). Reason of 5 to 500 characters (TENANT_CALC_POLICY_REASON_REQUIRED), engine 3 needs both default sale coefficients (TENANT_CALC_POLICY_V3_DEFAULTS_REQUIRED); writes the row and one journal event.';

revoke all on function public.set_tenant_calc_policy(uuid, smallint, numeric, numeric, integer[], text, uuid)
  from public, anon, authenticated;
grant execute on function public.set_tenant_calc_policy(uuid, smallint, numeric, numeric, integer[], text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. Colonnes et contraintes v3 (§6.2, D4 à D9, D17 : nulles ou défaut constant, sans reprise).
-- ---------------------------------------------------------------------------
alter table public.estimate_versions
  add column sale_coefficient_fo numeric(8,4),
  add column sale_coefficient_mo numeric(8,4),
  add column gross_ht_cents integer,
  add column discount_applied_cents integer,
  add column commercial_rounding_cents integer;

comment on column public.estimate_versions.sale_coefficient_fo is
  'Engine 3 supply sale coefficient c_FO in ]0, 10] (D5); NULL on engines 1 and 2.';
comment on column public.estimate_versions.sale_coefficient_mo is
  'Engine 3 labour sale coefficient c_MO in ]0, 10] (D5); NULL on engines 1 and 2.';
comment on column public.estimate_versions.gross_ht_cents is
  'Engine 3 gross HT G = sum of priced line gross amounts (D7); NULL on engines 1 and 2.';
comment on column public.estimate_versions.discount_applied_cents is
  'Engine 3 applied commercial discount R (D6); NULL on engines 1 and 2.';
comment on column public.estimate_versions.commercial_rounding_cents is
  'Engine 3 commercial rounding A treated as an HT discount (D7); NULL on engines 1 and 2.';

alter table public.estimate_items
  add column unit_code text references public.measurement_units(code),
  add column pricing_status public.estimate_line_pricing_status not null default 'priced',
  add column h_mo_per_unit numeric(12,4),
  add column h_mo_atelier_per_unit numeric(12,4),
  add column h_mo_chantier_per_unit numeric(12,4),
  add column snapshot_gross_ht_cents integer,
  add column snapshot_gross_fo_ht_cents integer;

create index estimate_items_unit_code_idx
  on public.estimate_items (unit_code)
  where unit_code is not null;

comment on column public.estimate_items.unit_code is
  'Engine 3 unit code (D9, FK measurement_units); required on a priced line at the v3 freeze; NULL on engines 1 and 2 (unit stays in description).';
comment on column public.estimate_items.pricing_status is
  'Line pricing status (D9); only priced on engines 1 and 2 and on sections; a non-priced v3 line contributes 0 everywhere and stores no unit price.';
comment on column public.estimate_items.h_mo_per_unit is
  'Engine 3 labour hours per unit (D4); h_mo = round(quantity x h/u, 3) is derived by private.derive_estimate_item_v3_columns; NULL on engines 1 and 2.';
comment on column public.estimate_items.h_mo_atelier_per_unit is
  'Engine 3 workshop hours per unit (D4); h_mo_atelier is derived; NULL on engines 1 and 2.';
comment on column public.estimate_items.h_mo_chantier_per_unit is
  'Engine 3 site hours per unit (D4); h_mo_chantier is derived; NULL on engines 1 and 2.';
comment on column public.estimate_items.snapshot_gross_ht_cents is
  'Engine 3 frozen gross line amount round(Q x PU) (D7), written by freeze_estimate_v3_snapshot only.';
comment on column public.estimate_items.snapshot_gross_fo_ht_cents is
  'Engine 3 frozen gross supply share of the line (D7), written by freeze_estimate_v3_snapshot only.';

-- §6.2, avec « is not null » explicite sur les colonnes v3 : sans lui, un coefficient ou un
-- montant v3 nul rendrait le CHECK NULL, donc admis (écart consigné dans estimate-engine-v3-2.5.md).
alter table public.estimate_versions
  add constraint estimate_versions_engine_v3_shape_check check (
    case when calc_engine_version = 3 then
      sale_coefficient_fo is not null and sale_coefficient_fo > 0 and sale_coefficient_fo <= 10
      and sale_coefficient_mo is not null and sale_coefficient_mo > 0 and sale_coefficient_mo <= 10
      and margin_mode = 'fixed' and margin_multiplier = 1 and global_coefficient = 1
      and discount_mode = 'simple' and coalesce(cardinality(discount_steps), 0) = 0
      and discount_bp between 0 and 10000
      and not (discount_amount_cents is not null and discount_bp <> 0)
      and rounding_mode in ('none', 'down') and rounding_adjustment_cents = 0
      and gross_ht_cents is not null and gross_ht_cents >= 0
      and discount_applied_cents is not null and discount_applied_cents >= 0
      and commercial_rounding_cents is not null and commercial_rounding_cents >= 0
      and total_ht_cents = gross_ht_cents - discount_applied_cents - commercial_rounding_cents
    else
      sale_coefficient_fo is null and sale_coefficient_mo is null and gross_ht_cents is null
      and discount_applied_cents is null and commercial_rounding_cents is null
    end
  ) not valid;
alter table public.estimate_versions
  validate constraint estimate_versions_engine_v3_shape_check;

alter table public.estimate_items
  add constraint estimate_items_v3_section_columns_check check (
    item_type = 'line'
    or (
      unit_code is null and pricing_status = 'priced'
      and h_mo_per_unit is null and h_mo_atelier_per_unit is null and h_mo_chantier_per_unit is null
      and snapshot_gross_ht_cents is null and snapshot_gross_fo_ht_cents is null
    )
  ) not valid;
alter table public.estimate_items
  validate constraint estimate_items_v3_section_columns_check;

alter table public.estimate_items
  add constraint estimate_items_v3_hours_per_unit_nonnegative_check check (
    (h_mo_per_unit is null or h_mo_per_unit >= 0)
    and (h_mo_atelier_per_unit is null or h_mo_atelier_per_unit >= 0)
    and (h_mo_chantier_per_unit is null or h_mo_chantier_per_unit >= 0)
  ) not valid;
alter table public.estimate_items
  validate constraint estimate_items_v3_hours_per_unit_nonnegative_check;

alter table public.estimate_items
  add constraint estimate_items_v3_snapshot_gross_check check (
    (snapshot_gross_ht_cents is null and snapshot_gross_fo_ht_cents is null)
    or (
      snapshot_gross_ht_cents is not null and snapshot_gross_fo_ht_cents is not null
      and snapshot_gross_fo_ht_cents >= 0
      and snapshot_gross_fo_ht_cents <= snapshot_gross_ht_cents
    )
  ) not valid;
alter table public.estimate_items
  validate constraint estimate_items_v3_snapshot_gross_check;

-- Une ligne v3 non chiffrée n'a pas de PU (D9, contrat client 2 : unitSaleHtCents null) : la
-- seule détente porte sur les lignes non chiffrées, que la garde de colonnes réserve à la v3.
-- Toute ligne existante est chiffrée (défaut 'priced') : la validation la retrouve inchangée.
alter table public.estimate_items
  drop constraint estimate_items_item_type_payload_check;
alter table public.estimate_items
  add constraint estimate_items_item_type_payload_check check (
    (
      item_type = 'section'::public.estimate_item_type
      and quantity is null and unit_price_ht_cents is null and tax_rate_bp is null and k_fo is null
      and h_mo is null and h_mo_majoration = 1.0 and k_mo is null and h_mo_atelier is null
      and k_mo_atelier = 1.0 and labor_role_atelier_id is null and h_mo_chantier is null
      and k_mo_chantier = 1.0 and labor_role_chantier_id is null and pu_ht_cents is null
      and labor_role_id is null and category_id is null and supply_type_id is null
      and selected_supplier_price_id is null and line_total_ht_cents is null
      and line_tax_cents is null and line_total_ttc_cents is null
    )
    or (
      item_type = 'line'::public.estimate_item_type
      and quantity is not null and unit_price_ht_cents is not null and tax_rate_bp is not null
      and k_fo is not null and h_mo is not null and h_mo_majoration is not null and k_mo is not null
      and (pu_ht_cents is not null or pricing_status <> 'priced'::public.estimate_line_pricing_status)
      and line_total_ht_cents is not null and line_tax_cents is not null
      and line_total_ttc_cents is not null
    )
  ) not valid;
alter table public.estimate_items
  validate constraint estimate_items_item_type_payload_check;

-- Même détente pour le PU figé d'une ligne v3 non chiffrée (ses parts figées valent 0).
alter table public.estimate_items
  drop constraint estimate_items_v2_snapshot_complete_check;
alter table public.estimate_items
  add constraint estimate_items_v2_snapshot_complete_check check (
    (
      snapshot_pu_ht_cents is null and snapshot_fo_ht_cents is null and snapshot_mo_ht_cents is null
      and snapshot_mo_atelier_ht_cents is null and snapshot_mo_chantier_ht_cents is null
    )
    or (
      (snapshot_pu_ht_cents is not null or pricing_status <> 'priced'::public.estimate_line_pricing_status)
      and snapshot_fo_ht_cents is not null and snapshot_mo_ht_cents is not null
      and snapshot_mo_atelier_ht_cents is not null and snapshot_mo_chantier_ht_cents is not null
      and (snapshot_fo_ht_cents + snapshot_mo_ht_cents) = line_total_ht_cents
      and (snapshot_mo_atelier_ht_cents + snapshot_mo_chantier_ht_cents) = snapshot_mo_ht_cents
    )
  ) not valid;
alter table public.estimate_items
  validate constraint estimate_items_v2_snapshot_complete_check;

-- ---------------------------------------------------------------------------
-- 3. Recalcul v3 sur les lignes stockées (D12) et passerelles liées au contrat d'écrivain.
-- ---------------------------------------------------------------------------
-- Entrées canoniques de private.estimate_v3_compute_items depuis les lignes stockées : lignes
-- par id croissant, taux horaires des rôles du propriétaire du projet (même lecture que le gel
-- v2 : rôle absent = taux 0 en MO simple, taux NULL en ventilation), ventilation selon le
-- drapeau EST_031_LABOR_SPLIT, autoliquidation = contractor_role 'subcontractor' (2.4, R-02).
create function private.estimate_v3_canonical_input(p_version_id uuid)
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

comment on function private.estimate_v3_canonical_input(uuid) is
  'Canonical engine 3 input {params, items, labor_roles} built from the stored rows of a v3 version (D12): lines by id, owner labour rates, labour split flag, reverse charge from contractor_role.';

-- Recalcul complet (D12) : sortie de private.estimate_v3_compute_items, plus params et rôles.
create function private.estimate_v3_compute(p_version_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  canonical jsonb := private.estimate_v3_canonical_input(p_version_id);
begin
  return private.estimate_v3_compute_items(canonical -> 'items', canonical -> 'params')
    || jsonb_build_object('params', canonical -> 'params', 'labor_roles', canonical -> 'labor_roles');
end;
$$;

comment on function private.estimate_v3_compute(uuid) is
  'Full engine 3 recomputation of a stored v3 version (D12): {lines, totals} of private.estimate_v3_compute_items plus the canonical params and the context labour roles. Owner only.';

-- Contrôle de sauvegarde (D12) : par ligne, PU recalculé et 0 <= net <= ⌈Q × PU⌋ (ligne non
-- chiffrée : PU nul, net et TVA nuls) ; identités de version (brut, remise et arrondi selon
-- l'intention et G, HT = G − R − A, Σ nets, Σ TVA, TTC, ajustement nul) ; par taux,
-- Σ TVA de ligne = ⌈base × r⌋ sur les nets stockés (0 en autoliquidation). La répartition
-- exacte n'est contrôlée qu'au gel. R et A suivent les formules de
-- private.estimate_v3_compute_items (M3), sans répartition.
create function private.estimate_v3_assert_draft(p_version_id uuid)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  target_version public.estimate_versions%rowtype;
  canonical jsonb;
  params private.estimate_v3_params_input;
  entry record;
  line private.estimate_v3_line_gross;
  gross_total bigint := 0;
  net_total bigint := 0;
  tax_total bigint := 0;
  discount_applied bigint;
  commercial_rounding bigint;
  priced_rates integer[] := '{}';
  priced_nets bigint[] := '{}';
  priced_taxes bigint[] := '{}';
  failed_check text;
begin
  select version.*
    into target_version
  from public.estimate_versions version
  where version.id = p_version_id;

  canonical := private.estimate_v3_canonical_input(p_version_id);
  params := private.estimate_v3_read_params(canonical -> 'params');

  for entry in
    select
      input.value as item_input,
      stored.pu_ht_cents,
      stored.line_total_ht_cents,
      stored.line_tax_cents,
      stored.line_total_ttc_cents
    from jsonb_array_elements(canonical -> 'items') as input(value)
    join public.estimate_items stored
      on stored.id = (input.value ->> 'id')::uuid
     and stored.version_id = target_version.id
  loop
    line := private.estimate_v3_line_values(private.estimate_v3_read_item(entry.item_input), params);
    if failed_check is null and (
        entry.line_total_ht_cents is null or entry.line_tax_cents is null
        or entry.line_total_ttc_cents is null or entry.line_total_ht_cents < 0
        or entry.line_tax_cents < 0
        or entry.line_total_ttc_cents::bigint <> entry.line_total_ht_cents::bigint + entry.line_tax_cents
      ) then
      failed_check := format('line %s: totals', line.id);
    end if;
    if failed_check is null and line.pricing_status = 'priced' and (
        entry.pu_ht_cents is distinct from line.pu_ht_cents
        or entry.line_total_ht_cents > line.gross_ht_cents
      ) then
      failed_check := format('line %s: PU %s (expected %s), net %s, gross %s',
        line.id, entry.pu_ht_cents, line.pu_ht_cents, entry.line_total_ht_cents, line.gross_ht_cents);
    end if;
    if failed_check is null and line.pricing_status <> 'priced' and (
        entry.pu_ht_cents is not null or entry.line_total_ht_cents <> 0 or entry.line_tax_cents <> 0
      ) then
      failed_check := format('line %s: a non-priced line carries an amount', line.id);
    end if;
    gross_total := gross_total + line.gross_ht_cents;
    net_total := net_total + coalesce(entry.line_total_ht_cents, 0);
    tax_total := tax_total + coalesce(entry.line_tax_cents, 0);
    if line.pricing_status = 'priced' then
      priced_rates := array_append(priced_rates, line.tax_rate_bp);
      priced_nets := array_append(priced_nets, coalesce(entry.line_total_ht_cents, 0)::bigint);
      priced_taxes := array_append(priced_taxes, coalesce(entry.line_tax_cents, 0)::bigint);
    end if;
  end loop;

  if params.discount_amount_cents is not null then
    discount_applied := least(params.discount_amount_cents, gross_total);
  else
    discount_applied := least(div(2::numeric * gross_total * params.discount_bp + 10000, 20000)::bigint, gross_total);
  end if;
  commercial_rounding := case
    when params.rounding_mode = 'down' then (gross_total - discount_applied) % params.rounding_step_cents
    else 0
  end;

  if failed_check is null and (
      target_version.gross_ht_cents is distinct from gross_total
      or target_version.discount_applied_cents is distinct from discount_applied
      or target_version.commercial_rounding_cents is distinct from commercial_rounding
      or target_version.total_ht_cents is distinct from gross_total - discount_applied - commercial_rounding
      or target_version.total_ht_cents is distinct from net_total
      or target_version.total_tax_cents is distinct from tax_total
      or target_version.total_ttc_cents is distinct from target_version.total_ht_cents + target_version.total_tax_cents
      or target_version.rounding_adjustment_cents is distinct from 0
    ) then
    failed_check := format(
      'version: gross %s (expected %s), discount %s (expected %s), rounding %s (expected %s), HT %s (lines %s), VAT %s (lines %s)',
      target_version.gross_ht_cents, gross_total, target_version.discount_applied_cents, discount_applied,
      target_version.commercial_rounding_cents, commercial_rounding, target_version.total_ht_cents, net_total,
      target_version.total_tax_cents, tax_total);
  end if;

  if failed_check is null then
    select format('VAT rate %s: %s (expected %s)', grouped.rate_bp, grouped.tax_cents, grouped.expected_cents)
      into failed_check
    from (
      select
        rate_entry.rate_bp,
        sum(rate_entry.tax_cents) as tax_cents,
        case when params.reverse_charge then 0
          else div(2 * sum(rate_entry.net_cents)::numeric * rate_entry.rate_bp + 10000, 20000)
        end as expected_cents
      from unnest(priced_rates, priced_nets, priced_taxes) as rate_entry(rate_bp, net_cents, tax_cents)
      group by rate_entry.rate_bp
    ) grouped
    where grouped.tax_cents <> grouped.expected_cents
    order by grouped.rate_bp
    limit 1;
  end if;

  if failed_check is not null then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V3_PROJECTION_MISMATCH',
      detail = failed_check;
  end if;
end;
$$;

comment on function private.estimate_v3_assert_draft(uuid) is
  'Save-time engine 3 projection check (D12): line PU and 0 <= net <= gross, version identities, VAT by rate on stored nets. ESTIMATE_V3_PROJECTION_MISMATCH (22023). Owner only.';

revoke all on function private.estimate_v3_canonical_input(uuid) from public, anon, authenticated, service_role;
revoke all on function private.estimate_v3_compute(uuid) from public, anon, authenticated, service_role;
revoke all on function private.estimate_v3_assert_draft(uuid) from public, anon, authenticated, service_role;

-- Passerelles des RPC security invoker (le schéma private reste fermé à authenticated et à
-- service_role) : elles n'agissent que dans la transaction d'un écrivain v3 qui a posé
-- miaouffrage.estimate_v3_writer sur cette version, même modèle de confiance que le contrat.
create function public.estimate_v3_assert_draft_for_writer(p_version_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_version_id is null
    or coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true), '') <> p_version_id::text
  then
    raise exception using errcode = '0A000', message = 'ESTIMATE_V3_WRITER_NOT_SUPPORTED';
  end if;
  perform private.estimate_v3_assert_draft(p_version_id);
end;
$$;

comment on function public.estimate_v3_assert_draft_for_writer(uuid) is
  'Bridge for the security invoker v3 writers (creation, item creation, settings): runs private.estimate_v3_assert_draft only inside the writer contract of that version.';

revoke all on function public.estimate_v3_assert_draft_for_writer(uuid) from public, anon, authenticated, service_role;
grant execute on function public.estimate_v3_assert_draft_for_writer(uuid) to authenticated, service_role;

create function public.estimate_v3_compute_for_writer(p_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_version_id is null
    or coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true), '') <> p_version_id::text
  then
    raise exception using errcode = '0A000', message = 'ESTIMATE_V3_WRITER_NOT_SUPPORTED';
  end if;
  return private.estimate_v3_compute(p_version_id);
end;
$$;

comment on function public.estimate_v3_compute_for_writer(uuid) is
  'Bridge for public.freeze_estimate_v3_snapshot (service_role): runs private.estimate_v3_compute only inside the writer contract of that version.';

revoke all on function public.estimate_v3_compute_for_writer(uuid) from public, anon, authenticated, service_role;
grant execute on function public.estimate_v3_compute_for_writer(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Déclencheurs complétés (§6.4).
-- ---------------------------------------------------------------------------
-- Point 1 (M1 complété) : sur une v1/v2, les colonnes v3 de ligne restent nulles et le statut
-- 'priced' (ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED) ; sur une v3, les nouvelles colonnes sont des
-- colonnes de calcul du contrat d'écrivain (comparaison to_jsonb existante, inchangée).
create or replace function public.guard_estimate_item_engine_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_engine_version smallint;
  previous_engine_version smallint;
begin
  select version.calc_engine_version
    into target_engine_version
  from public.estimate_versions version
  where version.id = new.version_id;

  if tg_op = 'UPDATE' and old.version_id is distinct from new.version_id then
    select version.calc_engine_version
      into previous_engine_version
    from public.estimate_versions version
    where version.id = old.version_id;
  end if;

  -- Lot 2, sub-lot 2.5 (M4): the v3 line columns are reserved to engine 3 (D4, D9).
  if target_engine_version is distinct from 3
    and (
      new.unit_code is not null
      or new.pricing_status is distinct from 'priced'::public.estimate_line_pricing_status
      or new.h_mo_per_unit is not null
      or new.h_mo_atelier_per_unit is not null
      or new.h_mo_chantier_per_unit is not null
      or new.snapshot_gross_ht_cents is not null
      or new.snapshot_gross_fo_ht_cents is not null
    )
  then
    raise exception using
      errcode = '0A000',
      message = 'ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED';
  end if;

  if target_engine_version is distinct from 3
    and previous_engine_version is distinct from 3
  then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and old.version_id is not distinct from new.version_id
    and to_jsonb(new) - array['title', 'position', 'aid', 'parent_id', 'updated_at']
      = to_jsonb(old) - array['title', 'position', 'aid', 'parent_id', 'updated_at']
  then
    return new;
  end if;

  if previous_engine_version is not distinct from 3
    or coalesce(
      pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true),
      ''
    ) <> new.version_id::text
  then
    raise exception using
      errcode = '0A000',
      message = 'ESTIMATE_V3_WRITER_NOT_SUPPORTED';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_estimate_item_engine_columns()
  from public, anon, authenticated;

-- Point 1 (suite), après le contrat d'écrivain (aay_) et la garde de gel héritée (aaz_, rôle du
-- propriétaire et colonnes figées), qui gardent la priorité de leurs refus : sur une ligne v3,
-- taux de version par défaut (D8), refus A1 de D4, heures de ligne dérivées par
-- private.estimate_v3_line_values (M3, 2.4 R-08 : 0.000 sur une ligne non chiffrée dont h/u est
-- renseigné, NULL si h/u est NULL ; h_mo, NOT NULL sur une ligne, vaut alors 0). Security
-- definer : seule voie vers le schéma private depuis un écrivain security invoker ; une
-- fonction de déclencheur n'est pas appelable directement.
create function private.derive_estimate_item_v3_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_engine_version smallint;
  version_tax_rate_bp integer;
  derived private.estimate_v3_line_gross;
begin
  if new.item_type is distinct from 'line'::public.estimate_item_type then
    return new;
  end if;

  select version.calc_engine_version, version.tax_rate_bp
    into target_engine_version, version_tax_rate_bp
  from public.estimate_versions version
  where version.id = new.version_id;

  if target_engine_version is distinct from 3 then
    return new;
  end if;

  if new.tax_rate_bp is null then
    new.tax_rate_bp := version_tax_rate_bp;
  end if;

  if tg_op = 'INSERT' then
    if (coalesce(new.h_mo, 0) > 0 and new.h_mo_per_unit is null)
      or (coalesce(new.h_mo_atelier, 0) > 0 and new.h_mo_atelier_per_unit is null)
      or (coalesce(new.h_mo_chantier, 0) > 0 and new.h_mo_chantier_per_unit is null)
    then
      raise exception using
        errcode = '22023',
        message = 'ESTIMATE_V3_LABOR_HOURS_PER_UNIT_REQUIRED';
    end if;
  elsif (
      new.h_mo is distinct from old.h_mo
      or new.h_mo_atelier is distinct from old.h_mo_atelier
      or new.h_mo_chantier is distinct from old.h_mo_chantier
    )
    and new.quantity is not distinct from old.quantity
    and new.h_mo_per_unit is not distinct from old.h_mo_per_unit
    and new.h_mo_atelier_per_unit is not distinct from old.h_mo_atelier_per_unit
    and new.h_mo_chantier_per_unit is not distinct from old.h_mo_chantier_per_unit
    and new.pricing_status is not distinct from old.pricing_status
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V3_LABOR_HOURS_PER_UNIT_REQUIRED';
  end if;

  -- Seules les heures sont lues : les autres entrées sont neutres (aucun montant n'est stocké ici).
  derived := private.estimate_v3_line_values(
    row(
      new.id, 'line', new.parent_id, new.pricing_status::text, new.tax_rate_bp, new.unit_code,
      coalesce(new.quantity, 0), 0, 1, new.h_mo_per_unit, new.h_mo_atelier_per_unit,
      new.h_mo_chantier_per_unit, 1, 1, 1, 1, 0, null, null
    )::private.estimate_v3_item_input,
    row(1, 1, null, 0, 'none', 1, false, false)::private.estimate_v3_params_input
  );
  new.h_mo := coalesce(derived.h_mo::numeric, 0);
  new.h_mo_atelier := derived.h_mo_atelier::numeric;
  new.h_mo_chantier := derived.h_mo_chantier::numeric;

  return new;
end;
$$;

comment on function private.derive_estimate_item_v3_columns() is
  'Engine 3 line trigger (D4, D8, R-08): version VAT rate by default, ESTIMATE_V3_LABOR_HOURS_PER_UNIT_REQUIRED for line hours without hours per unit or edited alone, h_mo* derived by private.estimate_v3_line_values.';

revoke all on function private.derive_estimate_item_v3_columns()
  from public, anon, authenticated, service_role;

create trigger ab_derive_estimate_item_v3_columns
  before insert or update on public.estimate_items
  for each row execute function private.derive_estimate_item_v3_columns();

-- Point 2 (M1 complété) : les cinq colonnes de version v3 entrent dans le contrat d'écrivain.
create or replace function public.guard_estimate_version_engine_v3_writer()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.calc_engine_version is distinct from 3
    or new.calc_engine_version is distinct from old.calc_engine_version
    or coalesce(
      pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true),
      ''
    ) = old.id::text
  then
    return new;
  end if;

  if new.margin_multiplier is distinct from old.margin_multiplier
    or new.margin_mode is distinct from old.margin_mode
    or new.margin_bp is distinct from old.margin_bp
    or new.global_coefficient is distinct from old.global_coefficient
    or new.discount_bp is distinct from old.discount_bp
    or new.discount_amount_cents is distinct from old.discount_amount_cents
    or new.discount_mode is distinct from old.discount_mode
    or new.discount_steps is distinct from old.discount_steps
    or new.tax_rate_bp is distinct from old.tax_rate_bp
    or new.rounding_mode is distinct from old.rounding_mode
    or new.rounding_step_cents is distinct from old.rounding_step_cents
    or new.rounding_adjustment_cents is distinct from old.rounding_adjustment_cents
    or new.total_ht_cents is distinct from old.total_ht_cents
    or new.total_tax_cents is distinct from old.total_tax_cents
    or new.total_ttc_cents is distinct from old.total_ttc_cents
    or new.contractor_role is distinct from old.contractor_role
    or new.currency is distinct from old.currency
    or new.sale_coefficient_fo is distinct from old.sale_coefficient_fo
    or new.sale_coefficient_mo is distinct from old.sale_coefficient_mo
    or new.gross_ht_cents is distinct from old.gross_ht_cents
    or new.discount_applied_cents is distinct from old.discount_applied_cents
    or new.commercial_rounding_cents is distinct from old.commercial_rounding_cents
    or (
      new.calc_snapshot_content_revision is not null
      and new.calc_snapshot_content_revision is distinct from
        old.calc_snapshot_content_revision
    )
    or (
      new.calc_snapshot_context is not null
      and new.calc_snapshot_context is distinct from old.calc_snapshot_context
    )
  then
    raise exception using
      errcode = '0A000',
      message = 'ESTIMATE_V3_WRITER_NOT_SUPPORTED';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_estimate_version_engine_v3_writer()
  from public, anon, authenticated;

-- Point 4 : chacune des cinq colonnes de version v3 incrémente content_revision (R4).
create or replace function public.guard_estimate_version_workflow_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.calc_engine_version is distinct from old.calc_engine_version then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_CALC_ENGINE_VERSION_IMMUTABLE';
  end if;

  if (
      new.calc_snapshot_content_revision is distinct from
        old.calc_snapshot_content_revision
      or new.calc_snapshot_context is distinct from old.calc_snapshot_context
    )
    and not (
      (
        current_user = 'service_role'
        and coalesce(
          pg_catalog.current_setting(
            'miaouffrage.estimate_v2_snapshot_freeze',
            true
          ),
          ''
        ) = 'on'
      )
      or (
        pg_trigger_depth() > 1
        and coalesce(
          pg_catalog.current_setting(
            'miaouffrage.estimate_v2_snapshot_invalidation',
            true
          ),
          ''
        ) = 'on'
        and new.calc_snapshot_content_revision is null
        and new.calc_snapshot_context is null
      )
    )
  then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_V2_SNAPSHOT_IS_MANAGED';
  end if;

  if (
    new.status is distinct from old.status
    or new.seal_hash is distinct from old.seal_hash
  ) and current_user <> 'service_role' then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_STATUS_REQUIRES_TRUSTED_WORKFLOW';
  end if;

  if new.content_revision is distinct from old.content_revision
    and pg_trigger_depth() = 1
  then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_CONTENT_REVISION_IS_MANAGED';
  end if;

  if new.tenant_id is distinct from old.tenant_id
    or new.project_id is distinct from old.project_id
    or new.version_number is distinct from old.version_number
    or new.title is distinct from old.title
    or new.exclusions is distinct from old.exclusions
    or new.date_devis is distinct from old.date_devis
    or new.validite_jours is distinct from old.validite_jours
    or new.margin_multiplier is distinct from old.margin_multiplier
    or new.margin_mode is distinct from old.margin_mode
    or new.currency is distinct from old.currency
    or new.margin_bp is distinct from old.margin_bp
    or new.discount_bp is distinct from old.discount_bp
    or new.discount_amount_cents is distinct from old.discount_amount_cents
    or new.discount_mode is distinct from old.discount_mode
    or new.discount_steps is distinct from old.discount_steps
    or new.global_coefficient is distinct from old.global_coefficient
    or new.max_section_depth is distinct from old.max_section_depth
    or new.tax_rate_bp is distinct from old.tax_rate_bp
    or new.rounding_mode is distinct from old.rounding_mode
    or new.rounding_step_cents is distinct from old.rounding_step_cents
    or new.total_ht_cents is distinct from old.total_ht_cents
    or new.total_tax_cents is distinct from old.total_tax_cents
    or (
      new.rounding_adjustment_cents is distinct from old.rounding_adjustment_cents
      and current_user = 'service_role'
      and old.status = 'draft'
      and new.status = 'draft'
      and coalesce(
        pg_catalog.current_setting('miaouffrage.estimate_settings_atomic', true),
        ''
      ) = new.id::text
    )
    or new.total_ttc_cents is distinct from old.total_ttc_cents
    or new.parent_version_id is distinct from old.parent_version_id
    or new.variant_label is distinct from old.variant_label
    or new.calc_engine_version is distinct from old.calc_engine_version
    or new.contractor_role is distinct from old.contractor_role
    or new.calc_snapshot_context is distinct from old.calc_snapshot_context
    or new.sale_coefficient_fo is distinct from old.sale_coefficient_fo
    or new.sale_coefficient_mo is distinct from old.sale_coefficient_mo
    or new.gross_ht_cents is distinct from old.gross_ht_cents
    or new.discount_applied_cents is distinct from old.discount_applied_cents
    or new.commercial_rounding_cents is distinct from old.commercial_rounding_cents
  then
    new.content_revision := old.content_revision + 1;
  end if;

  return new;
end;
$$;

-- Point 5 (M1 complété) : snapshot_gross_* rejoignent les colonnes figées gérées ; unit_code,
-- pricing_status et h_mo*_per_unit rejoignent les colonnes dont l'édition efface le gel.
create or replace function public.guard_estimate_v2_snapshot_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_version_id uuid;
  target_engine_version smallint;
  target_version_status public.estimate_status;
  target_project_owner_id uuid;
  target_tenant_id uuid;
begin
  if tg_op = 'DELETE' then
    target_version_id := old.version_id;
  else
    target_version_id := new.version_id;
  end if;

  select
    version.calc_engine_version,
    version.status,
    project.user_id,
    version.tenant_id
  into
    target_engine_version,
    target_version_status,
    target_project_owner_id,
    target_tenant_id
  from public.estimate_versions version
  join public.estimate_projects project
    on project.id = version.project_id
   and project.tenant_id = version.tenant_id
  where version.id = target_version_id
  for share of project;

  if target_engine_version in (2, 3)
    and target_version_status <> 'draft'::public.estimate_status
  then
    if tg_op = 'DELETE'
      or (
        tg_op = 'UPDATE'
        and to_jsonb(new) - 'updated_at' is distinct from
          to_jsonb(old) - 'updated_at'
      )
    then
      raise exception using
        errcode = '42501',
        message = 'ESTIMATE_VERSION_READ_ONLY';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if target_engine_version in (2, 3) then
    perform role.id
    from public.labor_roles role
    join (
      select distinct referenced.role_id
      from unnest(array[
        new.labor_role_id,
        new.labor_role_atelier_id,
        new.labor_role_chantier_id
      ]::uuid[]) as referenced(role_id)
      where referenced.role_id is not null
    ) referenced on referenced.role_id = role.id
    order by role.id
    for share of role;
  end if;

  if target_engine_version in (2, 3) and (
      (
        new.labor_role_id is not null
        and not exists (
          select 1
          from public.labor_roles role
          where role.id = new.labor_role_id
            and role.tenant_id = target_tenant_id
            and role.user_id = target_project_owner_id
        )
      )
      or (
        new.labor_role_atelier_id is not null
        and not exists (
          select 1
          from public.labor_roles role
          where role.id = new.labor_role_atelier_id
            and role.tenant_id = target_tenant_id
            and role.user_id = target_project_owner_id
        )
      )
      or (
        new.labor_role_chantier_id is not null
        and not exists (
          select 1
          from public.labor_roles role
          where role.id = new.labor_role_chantier_id
            and role.tenant_id = target_tenant_id
            and role.user_id = target_project_owner_id
        )
      )
    )
  then
    raise exception using
      errcode = '23503',
      message = 'ESTIMATE_LABOR_ROLE_OWNER_MISMATCH';
  end if;

  if tg_op = 'INSERT' then
    if (
        new.snapshot_pu_ht_cents is not null
        or new.snapshot_fo_ht_cents is not null
        or new.snapshot_mo_ht_cents is not null
        or new.snapshot_mo_atelier_ht_cents is not null
        or new.snapshot_mo_chantier_ht_cents is not null
        or new.snapshot_gross_ht_cents is not null
        or new.snapshot_gross_fo_ht_cents is not null
      )
      and (
        current_user <> 'service_role'
        or coalesce(
          pg_catalog.current_setting(
            'miaouffrage.estimate_v2_snapshot_freeze',
            true
          ),
          ''
        ) <> 'on'
      )
    then
      raise exception using
        errcode = '42501',
        message = 'ESTIMATE_V2_SNAPSHOT_IS_MANAGED';
    end if;
    return new;
  end if;

  if (
      new.snapshot_pu_ht_cents is distinct from old.snapshot_pu_ht_cents
      or new.snapshot_fo_ht_cents is distinct from old.snapshot_fo_ht_cents
      or new.snapshot_mo_ht_cents is distinct from old.snapshot_mo_ht_cents
      or new.snapshot_mo_atelier_ht_cents is distinct from
        old.snapshot_mo_atelier_ht_cents
      or new.snapshot_mo_chantier_ht_cents is distinct from
        old.snapshot_mo_chantier_ht_cents
      or new.snapshot_gross_ht_cents is distinct from old.snapshot_gross_ht_cents
      or new.snapshot_gross_fo_ht_cents is distinct from
        old.snapshot_gross_fo_ht_cents
    )
    and (
      current_user <> 'service_role'
      or coalesce(
        pg_catalog.current_setting(
          'miaouffrage.estimate_v2_snapshot_freeze',
          true
        ),
        ''
      ) <> 'on'
    )
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_V2_SNAPSHOT_IS_MANAGED';
  end if;

  if coalesce(
      pg_catalog.current_setting(
        'miaouffrage.estimate_v2_snapshot_freeze',
        true
      ),
      ''
    ) <> 'on'
    and (
      new.parent_id is distinct from old.parent_id
      or new.item_type is distinct from old.item_type
      or new.quantity is distinct from old.quantity
      or new.unit_price_ht_cents is distinct from old.unit_price_ht_cents
      or new.tax_rate_bp is distinct from old.tax_rate_bp
      or new.k_fo is distinct from old.k_fo
      or new.h_mo is distinct from old.h_mo
      or new.h_mo_majoration is distinct from old.h_mo_majoration
      or new.k_mo is distinct from old.k_mo
      or new.h_mo_atelier is distinct from old.h_mo_atelier
      or new.k_mo_atelier is distinct from old.k_mo_atelier
      or new.labor_role_atelier_id is distinct from old.labor_role_atelier_id
      or new.h_mo_chantier is distinct from old.h_mo_chantier
      or new.k_mo_chantier is distinct from old.k_mo_chantier
      or new.labor_role_chantier_id is distinct from old.labor_role_chantier_id
      or new.pu_ht_cents is distinct from old.pu_ht_cents
      or new.labor_role_id is distinct from old.labor_role_id
      or new.line_total_ht_cents is distinct from old.line_total_ht_cents
      or new.line_tax_cents is distinct from old.line_tax_cents
      or new.line_total_ttc_cents is distinct from old.line_total_ttc_cents
      or new.unit_code is distinct from old.unit_code
      or new.pricing_status is distinct from old.pricing_status
      or new.h_mo_per_unit is distinct from old.h_mo_per_unit
      or new.h_mo_atelier_per_unit is distinct from old.h_mo_atelier_per_unit
      or new.h_mo_chantier_per_unit is distinct from old.h_mo_chantier_per_unit
    )
  then
    new.snapshot_pu_ht_cents := null;
    new.snapshot_fo_ht_cents := null;
    new.snapshot_mo_ht_cents := null;
    new.snapshot_mo_atelier_ht_cents := null;
    new.snapshot_mo_chantier_ht_cents := null;
    new.snapshot_gross_ht_cents := null;
    new.snapshot_gross_fo_ht_cents := null;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_estimate_v2_snapshot_columns()
  from public, anon, authenticated;

-- §7 : contrats canonical_v3 (création sous politique 3) et duplicate_source_v3 (duplication
-- d'une v3) ; duplicate_source et tout autre contrat ne produisent toujours pas de v3.
create or replace function public.enforce_estimate_calc_engine_on_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.calc_engine_version not in (1, 2, 3) then
    raise exception using
      errcode = '23514',
      message = 'ESTIMATE_CALC_ENGINE_VERSION_UNSUPPORTED';
  end if;

  if (select auth.uid()) is not null
    and coalesce(
      pg_catalog.current_setting(
        'miaouffrage.estimate_version_insert_contract',
        true
      ),
      ''
    ) not in ('canonical_v2', 'canonical_v3', 'duplicate_source', 'duplicate_source_v3', 'legacy_v1')
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_VERSION_CREATION_RPC_REQUIRED';
  end if;

  if coalesce(
    pg_catalog.current_setting(
      'miaouffrage.estimate_version_insert_contract',
      true
    ),
    ''
  ) = 'canonical_v2'
  then
    new.calc_engine_version := 2;
  end if;

  -- Lot 2, sub-lot 2.5 (M4): the canonical creation under a policy at 3 and the
  -- duplication of a v3 are the two contracts that produce engine 3.
  if coalesce(
    pg_catalog.current_setting(
      'miaouffrage.estimate_version_insert_contract',
      true
    ),
    ''
  ) in ('canonical_v3', 'duplicate_source_v3')
  then
    new.calc_engine_version := 3;
  end if;

  if coalesce(
    pg_catalog.current_setting(
      'miaouffrage.estimate_version_insert_contract',
      true
    ),
    ''
  ) = 'legacy_v1'
  then
    new.calc_engine_version := 1;
  end if;

  -- Besides those two contracts, only a contract-less insertion by the native owner (test
  -- fixtures) creates a v3; any other contract keeps its engine and is refused.
  if new.calc_engine_version = 3
    and coalesce(
      pg_catalog.current_setting(
        'miaouffrage.estimate_version_insert_contract',
        true
      ),
      ''
    ) not in ('canonical_v3', 'duplicate_source_v3')
    and (
      current_user <> 'postgres'
      or coalesce(
        pg_catalog.current_setting(
          'miaouffrage.estimate_version_insert_contract',
          true
        ),
        ''
      ) <> ''
    )
  then
    raise exception using
      errcode = '0A000',
      message = 'ESTIMATE_V3_WRITER_NOT_SUPPORTED';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_estimate_calc_engine_on_insert()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Écrivains v3 : création, lot, ligne, réglages, duplication (§7).
-- ---------------------------------------------------------------------------
-- Création canonique (D3) : la clé calc_engine_version de la charge de version est le moteur
-- attendu par le client (absente = 2) ; la politique est lue FOR SHARE sous le verrou partagé
-- de son écrivain ; écart = 40001 ESTIMATE_CALC_POLICY_CONTEXT_CHANGED avant toute écriture.
-- Sous politique 3 : contrat canonical_v3, colonnes v3, coefficients par défaut de la
-- politique, lignes sous le contrat d'écrivain, puis contrôle D12 de la projection.
create or replace function public.persist_estimate_creation_atomic(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_project_id uuid,
  p_project_payload jsonb,
  p_version_payload jsonb,
  p_items jsonb,
  p_import_id uuid default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  actor_user_id uuid := p_actor_user_id;
  actor_role public.tenant_role;
  project_row public.estimate_projects%rowtype;
  version_row public.estimate_versions%rowtype;
  import_row public.dpgf_imports%rowtype;
  import_claimed_rows integer := 0;
  item_total_ht bigint := 0;
  item_total_tax bigint := 0;
  item_total_ttc bigint := 0;
  next_version_number integer;
  version_contractor_role text;
  previous_insert_contract text;
  policy_row public.tenant_calc_policies%rowtype;
  policy_engine smallint;
  creates_v3 boolean;
  previous_v3_writer text;
begin
  if current_user <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'SERVICE_ROLE_REQUIRED';
  end if;

  select membership.role
    into actor_role
  from public.tenant_memberships membership
  join public.tenants tenant
    on tenant.id = membership.tenant_id
   and tenant.is_active
  where membership.tenant_id = p_tenant_id
    and membership.user_id = actor_user_id;

  if actor_user_id is null
    or p_tenant_id is null
    or actor_role is null
    or actor_role not in (
      'admin'::public.tenant_role,
      'engineer'::public.tenant_role
    )
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
      'discount_amount_cents',
      'discount_mode',
      'discount_steps',
      'global_coefficient',
      'tax_rate_bp',
      'rounding_mode',
      'rounding_step_cents',
      'max_section_depth',
      'calc_engine_version',
      'contractor_role',
      'total_ht_cents',
      'total_tax_cents',
      'total_ttc_cents',
      'sale_coefficient_fo',
      'sale_coefficient_mo',
      'gross_ht_cents',
      'discount_applied_cents',
      'commercial_rounding_cents'
    ] <> '{}'::jsonb
    or coalesce(
      (p_version_payload->>'calc_engine_version')::smallint,
      2
    ) not in (1, 2, 3)
    or coalesce(
      nullif(btrim(p_version_payload->>'contractor_role'), ''),
      'principal'
    ) not in ('principal', 'subcontractor')
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_PAYLOAD_INVALID';
  end if;

  -- Lot 2, sub-lot 2.5 (D3): the engine is decided by the tenant policy, never by the
  -- client, which only states the engine its projections expect (absent = 2).
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('estimate-calc-policy:' || p_tenant_id::text, 0)
  );
  select policy.*
    into policy_row
  from public.tenant_calc_policies policy
  where policy.tenant_id = p_tenant_id
  for share;
  policy_engine := coalesce(policy_row.new_estimate_calc_engine, 2);
  if coalesce((p_version_payload->>'calc_engine_version')::smallint, 2) <> policy_engine then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_CALC_POLICY_CONTEXT_CHANGED';
  end if;
  creates_v3 := policy_engine = 3;

  if not creates_v3
    and exists (
      select 1
      from jsonb_each(p_version_payload) entry
      where entry.key in (
          'sale_coefficient_fo', 'sale_coefficient_mo', 'gross_ht_cents',
          'discount_applied_cents', 'commercial_rounding_cents'
        )
        and entry.value <> 'null'::jsonb
    )
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_PAYLOAD_INVALID';
  end if;

  if creates_v3 and (
      exists (
        select 1
        from jsonb_each(p_version_payload) entry
        where entry.key in ('sale_coefficient_fo', 'sale_coefficient_mo')
          and entry.value <> 'null'::jsonb
          and (
            jsonb_typeof(entry.value) <> 'number'
            or entry.value::text::numeric <= 0
            or entry.value::text::numeric > 10
            or pg_catalog.min_scale(entry.value::text::numeric) > 4
          )
      )
      or exists (
        select 1
        from unnest(array['gross_ht_cents', 'discount_applied_cents', 'commercial_rounding_cents']) as required(key)
        where jsonb_typeof(p_version_payload->required.key) is distinct from 'number'
          or p_version_payload->>required.key !~ '^[0-9]+$'
          or (p_version_payload->>required.key)::numeric > 2147483647
      )
    )
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_PAYLOAD_INVALID';
  end if;

  if p_version_payload ? 'discount_amount_cents'
    and p_version_payload->'discount_amount_cents' <> 'null'::jsonb then
    if jsonb_typeof(p_version_payload->'discount_amount_cents') <> 'number'
      or p_version_payload->>'discount_amount_cents' !~ '^[0-9]+$' then
      raise exception using errcode='22023',message='ESTIMATE_VERSION_PAYLOAD_INVALID';
    end if;
    if (p_version_payload->>'discount_amount_cents')::numeric > 2147483647
      or p_version_payload->>'discount_mode' is distinct from 'simple'
      or coalesce(jsonb_array_length(p_version_payload->'discount_steps'),0) <> 0 then
      raise exception using errcode='22023',message='ESTIMATE_VERSION_PAYLOAD_INVALID';
    end if;
  end if;

  version_contractor_role := coalesce(
    nullif(btrim(p_version_payload->>'contractor_role'), ''),
    'principal'
  )::text;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_ITEMS_PAYLOAD_INVALID';
  end if;

  -- The FK and hierarchy trigger are immediate, so make the accepted payload
  -- order explicit before any project/import mutation: every child must follow
  -- its section parent and every payload id must be unique and concrete.
  if exists (
    with payload_item as (
      select
        entry.ordinality,
        (entry.value->>'id')::uuid as id,
        (entry.value->>'parent_id')::uuid as parent_id,
        entry.value->>'item_type' as item_type
      from jsonb_array_elements(p_items) with ordinality
        as entry(value, ordinality)
    )
    select 1
    from payload_item as child
    left join payload_item as parent on parent.id = child.parent_id
    where child.id is null
      or child.item_type is null
      or child.item_type not in ('section', 'line')
      or (child.item_type = 'line' and child.parent_id is null)
      or (
        child.parent_id is not null
        and (
          parent.id is null
          or parent.item_type <> 'section'
          or parent.ordinality >= child.ordinality
        )
      )
    union all
    select 1
    from payload_item
    group by payload_item.id
    having count(*) > 1
  ) then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_ITEMS_HIERARCHY_INVALID';
  end if;

  if p_import_id is not null then
    select source_import.*
      into import_row
    from public.dpgf_imports as source_import
    where source_import.id = p_import_id
      and source_import.tenant_id = p_tenant_id
      and (
        source_import.user_id = actor_user_id
        or actor_role = 'admin'::public.tenant_role
      )
    for update;

    if import_row.id is null then
      raise exception using
        errcode = '42501',
        message = 'DPGF_IMPORT_NOT_WRITABLE';
    end if;

    if import_row.project_id is not null
      and (
        p_project_id is null
        or import_row.project_id <> p_project_id
      )
    then
      raise exception using
        errcode = '23505',
        message = 'DPGF_IMPORT_ALREADY_LINKED';
    end if;
  end if;

  if (p_version_payload->>'total_ht_cents') is null
    or (p_version_payload->>'total_tax_cents') is null
    or (p_version_payload->>'total_ttc_cents') is null
    or (p_version_payload->>'total_ht_cents')::integer < 0
    or (p_version_payload->>'total_tax_cents')::integer < 0
    or (p_version_payload->>'total_ttc_cents')::integer < 0
    or (p_version_payload->>'total_ttc_cents')::integer <>
      (p_version_payload->>'total_ht_cents')::integer
      + (p_version_payload->>'total_tax_cents')::integer
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_TOTALS_INVALID';
  end if;

  if version_contractor_role = 'subcontractor'
    and (
      (p_version_payload->>'total_tax_cents')::integer <> 0
      or (p_version_payload->>'total_ttc_cents')::integer <>
        (p_version_payload->>'total_ht_cents')::integer
    )
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_REVERSE_CHARGE_TOTALS_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(
      item_type public.estimate_item_type,
      line_total_ht_cents integer,
      line_tax_cents integer,
      line_total_ttc_cents integer
    )
    where item.item_type = 'line'
      and (
        item.line_total_ht_cents is null
        or item.line_tax_cents is null
        or item.line_total_ttc_cents is null
        or item.line_total_ht_cents < 0
        or item.line_tax_cents < 0
        or item.line_total_ttc_cents < 0
        or item.line_total_ttc_cents <>
          item.line_total_ht_cents + item.line_tax_cents
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_ITEM_TOTALS_INVALID';
  end if;

  select
    coalesce(sum(item.line_total_ht_cents), 0),
    coalesce(sum(item.line_tax_cents), 0),
    coalesce(sum(item.line_total_ttc_cents), 0)
    into item_total_ht, item_total_tax, item_total_ttc
  from jsonb_to_recordset(p_items) as item(
    item_type public.estimate_item_type,
    line_total_ht_cents integer,
    line_tax_cents integer,
    line_total_ttc_cents integer
  )
  where item.item_type = 'line'::public.estimate_item_type;

  if item_total_ht <> (p_version_payload->>'total_ht_cents')::integer
    or item_total_tax <> (p_version_payload->>'total_tax_cents')::integer
    or item_total_ttc <> (p_version_payload->>'total_ttc_cents')::integer
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_TOTALS_DO_NOT_MATCH_ITEMS';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(
      category_id uuid,
      supply_type_id uuid,
      selected_supplier_price_id uuid,
      source_job_id uuid
    )
    left join public.estimate_categories category
      on category.id = item.category_id
     and category.tenant_id = p_tenant_id
    left join public.supply_types supply_type
      on supply_type.id = item.supply_type_id
     and supply_type.tenant_id = p_tenant_id
    left join public.supplier_pricebook supplier_price
      on supplier_price.id = item.selected_supplier_price_id
     and supplier_price.tenant_id = p_tenant_id
    left join public.takeoff_jobs source_job
      on source_job.id = item.source_job_id
     and source_job.tenant_id = p_tenant_id
    where (item.category_id is not null and category.id is null)
      or (item.supply_type_id is not null and supply_type.id is null)
      or (
        item.selected_supplier_price_id is not null
        and supplier_price.id is null
      )
      or (item.source_job_id is not null and source_job.id is null)
  ) then
    raise exception using
      errcode = '23503',
      message = 'ESTIMATE_ITEM_REFERENCE_TENANT_MISMATCH';
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
        and actor_role <> 'admin'::public.tenant_role
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

  perform role.id
  from public.labor_roles role
  where role.id in (
    select referenced.role_id
    from (
      select item.labor_role_id as role_id
      from jsonb_to_recordset(p_items) as item(labor_role_id uuid)
      union
      select item.labor_role_atelier_id
      from jsonb_to_recordset(p_items) as item(labor_role_atelier_id uuid)
      union
      select item.labor_role_chantier_id
      from jsonb_to_recordset(p_items) as item(labor_role_chantier_id uuid)
    ) referenced
    where referenced.role_id is not null
  )
  order by role.id
  for share of role;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(
      labor_role_id uuid,
      labor_role_atelier_id uuid,
      labor_role_chantier_id uuid
    )
    left join public.labor_roles labor_role
      on labor_role.id = item.labor_role_id
     and labor_role.tenant_id = p_tenant_id
     and labor_role.user_id = project_row.user_id
    left join public.labor_roles atelier_role
      on atelier_role.id = item.labor_role_atelier_id
     and atelier_role.tenant_id = p_tenant_id
     and atelier_role.user_id = project_row.user_id
    left join public.labor_roles chantier_role
      on chantier_role.id = item.labor_role_chantier_id
     and chantier_role.tenant_id = p_tenant_id
     and chantier_role.user_id = project_row.user_id
    where (item.labor_role_id is not null and labor_role.id is null)
      or (item.labor_role_atelier_id is not null and atelier_role.id is null)
      or (item.labor_role_chantier_id is not null and chantier_role.id is null)
  ) then
    raise exception using
      errcode = '23503',
      message = 'ESTIMATE_LABOR_ROLE_OWNER_MISMATCH';
  end if;

  if import_row.id is not null and import_row.project_id is null then
    update public.dpgf_imports as source_import
    set project_id = project_row.id
    where source_import.id = import_row.id
      and source_import.tenant_id = p_tenant_id
      and source_import.project_id is null;

    get diagnostics import_claimed_rows = row_count;
    if import_claimed_rows <> 1 then
      raise exception using
        errcode = '23505',
        message = 'DPGF_IMPORT_ALREADY_LINKED';
    end if;
  end if;

  previous_insert_contract := coalesce(
    pg_catalog.current_setting(
      'miaouffrage.estimate_version_insert_contract',
      true
    ),
    ''
  );
  perform pg_catalog.set_config(
    'miaouffrage.estimate_version_insert_contract',
    case when creates_v3 then 'canonical_v3' else 'canonical_v2' end,
    true
  );

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
    discount_amount_cents,
    discount_mode,
    discount_steps,
    global_coefficient,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    max_section_depth,
    calc_engine_version,
    contractor_role,
    total_ht_cents,
    total_tax_cents,
    total_ttc_cents,
    sale_coefficient_fo,
    sale_coefficient_mo,
    gross_ht_cents,
    discount_applied_cents,
    commercial_rounding_cents
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
    (p_version_payload->>'discount_amount_cents')::integer,
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
    policy_engine,
    version_contractor_role::text,
    (p_version_payload->>'total_ht_cents')::integer,
    (p_version_payload->>'total_tax_cents')::integer,
    (p_version_payload->>'total_ttc_cents')::integer,
    case when creates_v3 then coalesce(
      (p_version_payload->>'sale_coefficient_fo')::numeric,
      policy_row.default_sale_coefficient_fo
    ) end,
    case when creates_v3 then coalesce(
      (p_version_payload->>'sale_coefficient_mo')::numeric,
      policy_row.default_sale_coefficient_mo
    ) end,
    case when creates_v3 then (p_version_payload->>'gross_ht_cents')::integer end,
    case when creates_v3 then (p_version_payload->>'discount_applied_cents')::integer end,
    case when creates_v3 then (p_version_payload->>'commercial_rounding_cents')::integer end
  )
  returning * into version_row;

  perform pg_catalog.set_config(
    'miaouffrage.estimate_version_insert_contract',
    previous_insert_contract,
    true
  );

  previous_v3_writer := coalesce(
    pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true),
    ''
  );
  if creates_v3 then
    perform pg_catalog.set_config(
      'miaouffrage.estimate_v3_writer',
      version_row.id::text,
      true
    );
  end if;

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
      source_metadata,
      line_total_ht_cents,
      line_tax_cents,
      line_total_ttc_cents,
      unit_code,
      pricing_status,
      h_mo_per_unit,
      h_mo_atelier_per_unit,
      h_mo_chantier_per_unit
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
      coalesce(item.source_metadata, '{}'::jsonb),
      item.line_total_ht_cents,
      item.line_tax_cents,
      item.line_total_ttc_cents,
      item.unit_code,
      coalesce(item.pricing_status, 'priced'::public.estimate_line_pricing_status),
      item.h_mo_per_unit,
      item.h_mo_atelier_per_unit,
      item.h_mo_chantier_per_unit
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
      source_metadata jsonb,
      line_total_ht_cents integer,
      line_tax_cents integer,
      line_total_ttc_cents integer,
      unit_code text,
      pricing_status public.estimate_line_pricing_status,
      h_mo_per_unit numeric,
      h_mo_atelier_per_unit numeric,
      h_mo_chantier_per_unit numeric
    );
  end if;

  if creates_v3 then
    perform public.estimate_v3_assert_draft_for_writer(version_row.id);
    perform pg_catalog.set_config(
      'miaouffrage.estimate_v3_writer',
      previous_v3_writer,
      true
    );
  end if;

  return jsonb_build_object(
    'project', to_jsonb(project_row),
    'version', to_jsonb(version_row)
  );
end;
$$;

-- Lot : clés de ligne v3 (unit_code, pricing_status, h_mo*_per_unit), heures par unité à au
-- plus 4 décimales (numeric(12,4) arrondirait en silence). Sur une v1/v2, la garde de colonnes
-- refuse toute valeur v3.
CREATE OR REPLACE FUNCTION private.canonical_estimate_batch_operations(operations jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare op jsonb; result jsonb:='[]'; data jsonb; pair record; key text; value jsonb; name text;
  common_keys text[]:=array['parent_id','position','title','aid'];
  line_keys text[]:=array['line_nature','description','quantity','unit_price_ht_cents','tax_rate_bp','k_fo','h_mo','h_mo_majoration','k_mo','h_mo_atelier','k_mo_atelier','labor_role_atelier_id','h_mo_chantier','k_mo_chantier','labor_role_chantier_id','labor_role_id','category_id','supply_type_id','product_id','selected_supplier_price_id','unit_code','pricing_status','h_mo_per_unit','h_mo_atelier_per_unit','h_mo_chantier_per_unit'];
  source_keys text[]:=array['source_provider','source_job_id','source_file_name','source_page'];
  money_keys text[]:=array['pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents'];
  allowed text[];
begin
  if jsonb_typeof(operations) is distinct from 'array' or jsonb_array_length(operations) not between 1 and 1000 or octet_length(operations::text)>1048576 then perform private.estimate_batch_error('INVALID_INPUT'); end if;
  for op in select * from jsonb_array_elements(operations) loop
    name:=op->>'op';
    if jsonb_typeof(op) is distinct from 'object' or name not in('create','update','delete','reorder') or name is null then perform private.estimate_batch_error('INVALID_INPUT'); end if;
    if op - (case name when 'create' then array['op','data'] when 'update' then array['op','id','data'] when 'delete' then array['op','id'] else array['op','data'] end) <> '{}'::jsonb then perform private.estimate_batch_error('INVALID_INPUT'); end if;
    if name in('update','delete') then
      if jsonb_typeof(op->'id') is distinct from 'string' then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      op:=jsonb_set(op,'{id}',to_jsonb((op->>'id')::uuid));
    end if;
    if name='delete' then result:=result||jsonb_build_array(op); continue; end if;
    data:=op->'data';
    if jsonb_typeof(data) is distinct from 'object' then perform private.estimate_batch_error('INVALID_INPUT'); end if;
    if name='reorder' then
      if data-array['parent_id','ordered_ids']<>'{}'::jsonb or jsonb_typeof(data->'ordered_ids') is distinct from 'array' or jsonb_array_length(data->'ordered_ids')<1 then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      if exists(select 1 from jsonb_array_elements(data->'ordered_ids') x where jsonb_typeof(x)<>'string') then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      select jsonb_agg(to_jsonb((x.value#>>'{}')::uuid) order by x.ordinality) into value from jsonb_array_elements(data->'ordered_ids') with ordinality x;
      data:=jsonb_set(data,'{ordered_ids}',value);
      if data ? 'parent_id' and data->'parent_id'<>'null'::jsonb then data:=jsonb_set(data,'{parent_id}',to_jsonb((data->>'parent_id')::uuid)); end if;
      result:=result||jsonb_build_array(jsonb_set(op,'{data}',data)); continue;
    end if;
    if name='create' then
      if data->>'item_type' not in('line','section') or data->>'item_type' is null then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      allowed:=common_keys||source_keys||array['item_type']||case when data->>'item_type'='line' then line_keys else '{}'::text[] end;
    else allowed:=common_keys||line_keys||money_keys; end if;
    if data-allowed<>'{}'::jsonb or data='{}'::jsonb then perform private.estimate_batch_error('INVALID_INPUT'); end if;
    for pair in select * from jsonb_each(data) loop
      key:=pair.key; value:=pair.value;
      if key in('parent_id','labor_role_id','labor_role_atelier_id','labor_role_chantier_id','category_id','supply_type_id','product_id','selected_supplier_price_id','source_job_id') then
        if value<>'null'::jsonb then
          if jsonb_typeof(value)<>'string' then perform private.estimate_batch_error('INVALID_INPUT'); end if;
          data:=jsonb_set(data,array[key],to_jsonb((data->>key)::uuid));
        end if;
      elsif key='unit_code' then
        if value<>'null'::jsonb and jsonb_typeof(value)<>'string' then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        data:=jsonb_set(data,array[key],coalesce(to_jsonb(nullif(btrim(data->>key),'')),'null'));
      elsif key='pricing_status' then
        if jsonb_typeof(value)<>'string' or data->>key not in('priced','included','for_memory','not_priced','out_of_scope','not_applicable') then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      elsif key in('title','aid','description','source_provider','source_file_name') then
        if value<>'null'::jsonb and jsonb_typeof(value)<>'string' or key='title' and (value='null'::jsonb or btrim(data->>key)='') then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        data:=jsonb_set(data,array[key],coalesce(to_jsonb(case when key='aid' then upper(nullif(btrim(data->>key),'')) when key='title' then btrim(data->>key) else nullif(btrim(data->>key),'') end),'null'));
      elsif key in('item_type','line_nature') then
        if jsonb_typeof(value)<>'string' or key='line_nature' and data->>key not in('supply_only','supply_and_labor','labor_only') then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      else
        if value='null'::jsonb and key in('h_mo_atelier','k_mo_atelier','h_mo_chantier','k_mo_chantier','source_page','h_mo_per_unit','h_mo_atelier_per_unit','h_mo_chantier_per_unit') then continue; end if;
        if jsonb_typeof(value)<>'number' or (data->>key)::numeric<0 then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        if key in('position','source_page','unit_price_ht_cents','tax_rate_bp') or key=any(money_keys) then
          if (data->>key)::numeric<>trunc((data->>key)::numeric) or (data->>key)::numeric>2147483647 then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        end if;
        if key in('position','source_page') and (data->>key)::numeric<1 or key='tax_rate_bp' and (data->>key)::numeric>10000 then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        if key in('h_mo_per_unit','h_mo_atelier_per_unit','h_mo_chantier_per_unit') and (min_scale((data->>key)::numeric)>4 or (data->>key)::numeric>99999999.9999) then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      end if;
    end loop;
    result:=result||jsonb_build_array(jsonb_set(op,'{data}',data));
  end loop;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then perform private.estimate_batch_error('INVALID_INPUT'); return null;
end $function$
;


-- Lot : branche v3 sous le contrat d'écrivain (couvre bulk_update_estimate_items appelée à
-- l'intérieur) ; pied v3 complet (brut, remise appliquée, arrondi commercial) écrit en une
-- instruction (CHECK de forme) ; projection de toutes les lignes ; contrôle D12.
CREATE OR REPLACE FUNCTION public.commit_estimate_batch(p_version_id uuid, p_operation_key uuid, p_expected_updated_at timestamp with time zone, p_draft_lock_session_id uuid, p_operations jsonb, p_created_ids jsonb, p_item_updates jsonb, p_version_patch jsonb, p_calculation_context jsonb, p_expected_aid_policy jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ctx jsonb; actor uuid; target_tenant uuid; project_owner uuid;
  v public.estimate_versions%rowtype; lease public.draft_locks%rowtype; item public.estimate_items%rowtype; old_item public.estimate_items%rowtype;
  saved private.estimate_batch_receipts%rowtype; operations jsonb; canonical jsonb; raw_context jsonb; aid_policy jsonb;
  op jsonb; data jsonb; normalized jsonb; projected jsonb; results jsonb:='[]'; response jsonb; operation_index integer:=-1;
  item_id uuid; target_parent uuid; actual_ids uuid[]; supplied_ids uuid[]; affected_ids uuid[]:='{}'; deleted_ids uuid[]; role_ids uuid[];
  depth integer; parent_depth integer; hierarchy_invalid boolean; position_value integer; create_count integer; changed integer; event_time timestamptz;
  has_supply boolean; has_labor boolean; failure_code text; failure_message text; operation_stage boolean:=true;
  is_v3 boolean; previous_v3_writer text;
begin
  ctx:=private.estimate_batch_context(p_version_id,true);
  actor:=(ctx->>'actor_id')::uuid; target_tenant:=(ctx->>'tenant_id')::uuid; project_owner:=(ctx->>'user_id')::uuid;
  if p_operation_key is null then perform private.estimate_batch_error('OPERATION_KEY_REQUIRED'); end if;
  if p_expected_updated_at is null then perform private.estimate_batch_error('INVALID_INPUT'); end if;
  operations:=private.canonical_estimate_batch_operations(p_operations);
  canonical:=jsonb_build_object('versionId',p_version_id,'actorId',actor,'expectedUpdatedAt',p_expected_updated_at,'operations',operations);
  -- A matching request waits for the in-flight transaction and resolves its
  -- receipt before stale-token, lease, status or derived-context checks.
  select * into v from public.estimate_versions where id=p_version_id for update;
  perform 1 from public.estimate_projects where id=v.project_id for share nowait;
  ctx:=private.estimate_batch_context(p_version_id,true);
  actor:=(ctx->>'actor_id')::uuid; target_tenant:=(ctx->>'tenant_id')::uuid; project_owner:=(ctx->>'user_id')::uuid;
  if v.tenant_id is distinct from target_tenant or v.project_id is distinct from (ctx->>'project_id')::uuid then perform private.estimate_batch_error('STALE'); end if;
  select * into saved from private.estimate_batch_receipts where version_id=p_version_id and operation_key=p_operation_key;
  if found then
    if saved.actor_id<>actor or saved.tenant_id<>target_tenant or saved.project_id<>v.project_id or saved.canonical_request is distinct from canonical then perform private.estimate_batch_error('IDEMPOTENCY_CONFLICT'); end if;
    return saved.response||jsonb_build_object('replayed',true,'current_version',jsonb_build_object('id',v.id,'updated_at',v.updated_at,'status',v.status));
  end if;
  if v.status<>'draft' or (ctx->>'is_archived')::boolean then perform private.estimate_batch_error('FORBIDDEN'); end if;
  is_v3:=v.calc_engine_version=3;
  if v.updated_at is distinct from p_expected_updated_at then perform private.estimate_batch_error('STALE'); end if;
  select * into lease from public.draft_locks where version_id=p_version_id and tenant_id=target_tenant for update nowait;
  if not found or p_draft_lock_session_id is null or lease.user_id is distinct from actor or lease.session_id is distinct from p_draft_lock_session_id or lease.expires_at<=clock_timestamp() then perform private.estimate_batch_error('LOCK_REQUIRED'); end if;
  perform id from public.estimate_items where version_id=p_version_id order by id for update nowait;
  if jsonb_typeof(p_created_ids) is distinct from 'array' or jsonb_typeof(p_item_updates) is distinct from 'array' or jsonb_typeof(p_version_patch) is distinct from 'object' or jsonb_typeof(p_calculation_context) is distinct from 'object'
    or not(p_version_patch ?& array['total_ht_cents','total_tax_cents','total_ttc_cents']) or p_version_patch-array['total_ht_cents','total_tax_cents','total_ttc_cents','gross_ht_cents','discount_applied_cents','commercial_rounding_cents']<>'{}'::jsonb
    or (p_version_patch ?| array['gross_ht_cents','discount_applied_cents','commercial_rounding_cents']) is distinct from is_v3
    or is_v3 and not(p_version_patch ?& array['gross_ht_cents','discount_applied_cents','commercial_rounding_cents']) then perform private.estimate_batch_error('INVALID_INPUT'); end if;
  if exists(select 1 from jsonb_each(p_version_patch) x where jsonb_typeof(x.value)<>'number' or x.value::text !~ '^[0-9]+$' or x.value::text::numeric>2147483647) then perform private.estimate_batch_error('INVALID_INPUT'); end if;
  select count(*) into create_count from jsonb_array_elements(operations) x where x->>'op'='create';
  if jsonb_array_length(p_created_ids)<>create_count or exists(select 1 from jsonb_array_elements(p_created_ids) x where jsonb_typeof(x)<>'object' or not(x?&array['index','id']) or x-array['index','id']<>'{}'::jsonb or jsonb_typeof(x->'id')<>'string' or jsonb_typeof(x->'index')<>'number' or x->>'index'!~'^[0-9]+$') then perform private.estimate_batch_error('INVALID_INPUT'); end if;
  if exists(select 1 from jsonb_array_elements(p_created_ids) x where (x->>'index')::numeric>999 or operations->(x->>'index')::integer->>'op' is distinct from 'create')
    or (select count(distinct (x->>'id')::uuid) from jsonb_array_elements(p_created_ids) x)<>create_count
    or (select count(distinct (x->>'index')::integer) from jsonb_array_elements(p_created_ids) x)<>create_count
    or exists(select 1 from jsonb_array_elements(p_created_ids) x join public.estimate_items i on i.id=(x->>'id')::uuid) then perform private.estimate_batch_error('INVALID_INPUT'); end if;
  if exists(select 1 from jsonb_array_elements(p_item_updates) x where jsonb_typeof(x)<>'object' or not(x?&array['id','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents']) or x-array['id','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents']<>'{}'::jsonb or jsonb_typeof(x->'id')<>'string')
    or exists(select 1 from jsonb_array_elements(p_item_updates) x cross join lateral jsonb_each(x-'id') n where not(is_v3 and n.key='pu_ht_cents' and n.value='null'::jsonb) and (jsonb_typeof(n.value)<>'number' or n.value::text!~'^[0-9]+$' or n.value::text::numeric>2147483647)) then perform private.estimate_batch_error('PROJECTION_MISMATCH'); end if;
  select coalesce(array_agg((x->>'id')::uuid order by (x->>'id')::uuid),'{}') into supplied_ids from jsonb_array_elements(p_item_updates) x;
  if cardinality(supplied_ids)<>(select count(distinct x) from unnest(supplied_ids) x) then perform private.estimate_batch_error('PROJECTION_MISMATCH'); end if;
  select jsonb_build_object('id',id,'enabled',enabled,'value',value) into aid_policy from public.feature_flags where tenant_id=target_tenant and flag_key='ESTIMATE_ITEM_AID_REGEX';
  if coalesce(aid_policy,'null'::jsonb) is distinct from coalesce(p_expected_aid_policy,'null'::jsonb) then perform private.estimate_batch_error('CONTEXT_CHANGED'); end if;

  -- Catch confirmed operation failure only around ALL writes. Subtransaction
  -- rollback restores cascades, technical revisions, audit, footer and receipt.
  begin
    previous_v3_writer:=coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer',true),'');
    if is_v3 then perform pg_catalog.set_config('miaouffrage.estimate_v3_writer',p_version_id::text,true); end if;
    for op in select * from jsonb_array_elements(operations) loop
      operation_index:=operation_index+1; data:=op->'data'; item_id:=null;
      if op->>'op'='create' then
        select (x->>'id')::uuid into item_id from jsonb_array_elements(p_created_ids) x where (x->>'index')::integer=operation_index;
        target_parent:=(data->>'parent_id')::uuid;
        select coalesce(max(position),0)+1 into position_value from public.estimate_items where version_id=p_version_id and parent_id is not distinct from target_parent;
        depth:=1;
        if target_parent is not null then
          with recursive ancestors as(select id,parent_id,1 as d from public.estimate_items where id=target_parent and version_id=p_version_id union all select i.id,i.parent_id,a.d+1 from public.estimate_items i join ancestors a on i.id=a.parent_id where a.d<5) select coalesce(max(d),0)+1 into depth from ancestors;
        end if;
        normalized:=jsonb_build_object('id',item_id,'tenant_id',target_tenant,'version_id',p_version_id,'parent_id',target_parent,'position',coalesce((data->>'position')::integer,position_value),'title',coalesce(data->>'title',case when data->>'item_type'='line' then 'Nouvelle ligne' else 'Nouveau '||case depth when 1 then 'lot' when 2 then 'chapitre' when 3 then 'sous-chapitre' else 'ouvrage' end end),'source_provider',coalesce(data->>'source_provider','manual'))||data;
        -- Explicit null provider still means manual; do not inject this default
        -- into the canonical request retained in the receipt.
        normalized:=normalized||jsonb_build_object('source_provider',coalesce(data->>'source_provider','manual'));
        if data->>'item_type'='line' then
          select x into projected from jsonb_array_elements(p_item_updates) x where (x->>'id')::uuid=item_id;
          -- A later parent deletion can remove this create before the final
          -- projection. Temporary zeros satisfy storage constraints only;
          -- the exact final-ID check still rejects every surviving omission.
          if projected is null then projected:='{"pu_ht_cents":0,"line_total_ht_cents":0,"line_tax_cents":0,"line_total_ttc_cents":0}'::jsonb; end if;
          normalized:=jsonb_build_object('quantity',1,'unit_price_ht_cents',0,'tax_rate_bp',v.tax_rate_bp,'k_fo',1,'h_mo',0,'h_mo_majoration',1,'k_mo',1)||normalized||(projected-'id');
        else normalized:=normalized||'{"h_mo_majoration":1,"k_mo_atelier":1,"k_mo_chantier":1}'; end if;
        select * into item from jsonb_populate_record(null::public.estimate_items,normalized);
      elsif op->>'op'='update' then
        item_id:=(op->>'id')::uuid;
        select * into old_item from public.estimate_items where id=item_id and version_id=p_version_id and tenant_id=target_tenant;
        if not found then perform private.estimate_batch_error('NOT_FOUND'); end if;
        if old_item.item_type='section' and data-array['parent_id','position','title','aid']<>'{}'::jsonb then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        select * into item from jsonb_populate_record(old_item,data-array['pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents']);
      elsif op->>'op'='delete' then
        item_id:=(op->>'id')::uuid;
        if not exists(select 1 from public.estimate_items where id=item_id and version_id=p_version_id and tenant_id=target_tenant) then perform private.estimate_batch_error('NOT_FOUND'); end if;
        with recursive closure as(select id from public.estimate_items where id=item_id and version_id=p_version_id union select i.id from public.estimate_items i join closure c on i.parent_id=c.id where i.version_id=p_version_id) select array_agg(id order by id) into deleted_ids from closure;
        delete from public.estimate_items where id=item_id and version_id=p_version_id;
        results:=results||jsonb_build_array(jsonb_build_object('index',operation_index,'op','delete','status','ok','data',jsonb_build_object('deleted_id',item_id,'deleted_ids',deleted_ids)));
        continue;
      else
        target_parent:=(data->>'parent_id')::uuid;
        if target_parent is not null and not exists(select 1 from public.estimate_items where id=target_parent and version_id=p_version_id and tenant_id=target_tenant and item_type='section') then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        select coalesce(array_agg(id order by id),'{}') into actual_ids from public.estimate_items where version_id=p_version_id and tenant_id=target_tenant and parent_id is not distinct from target_parent;
        select array_agg((x#>>'{}')::uuid order by (x#>>'{}')::uuid) into deleted_ids from jsonb_array_elements(data->'ordered_ids') x;
        if actual_ids is distinct from deleted_ids then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        with ordered as(select (x.value#>>'{}')::uuid as id,x.ordinality::integer as pos from jsonb_array_elements(data->'ordered_ids') with ordinality x)
          update public.estimate_items i set position=-o.pos from ordered o where i.id=o.id and i.version_id=p_version_id;
        with ordered as(select (x.value#>>'{}')::uuid as id,x.ordinality::integer as pos from jsonb_array_elements(data->'ordered_ids') with ordinality x)
          update public.estimate_items i set position=o.pos from ordered o where i.id=o.id and i.version_id=p_version_id;
        get diagnostics changed=row_count;
        results:=results||jsonb_build_array(jsonb_build_object('index',operation_index,'op','reorder','status','ok','data',jsonb_build_object('parent_id',target_parent,'ordered_ids',data->'ordered_ids','updated_count',changed)));
        continue;
      end if;

      if item.parent_id is not null and not exists(select 1 from public.estimate_items p where p.id=item.parent_id and p.version_id=p_version_id and p.tenant_id=target_tenant and p.item_type='section') then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      if op->>'op'='update' and item.item_type='section' and item.parent_id is distinct from old_item.parent_id then
        -- The generic BEFORE trigger validates the moved node, not its retained
        -- descendants. Validate both trees before UPDATE while all version items
        -- are locked. Paths and the version depth bound stop corrupt/cyclic
        -- inputs explicitly; no timeout is used as hierarchy validation.
        with recursive parents as (
          select p.id,p.parent_id,p.item_type,1 as d,array[p.id] as path,false as cycle
          from public.estimate_items p where p.id=item.parent_id and p.version_id=p_version_id and p.tenant_id=target_tenant
          union all
          select p.id,p.parent_id,p.item_type,a.d+1,a.path||p.id,p.id=any(a.path)
          from public.estimate_items p join parents a on p.id=a.parent_id
          where p.version_id=p_version_id and p.tenant_id=target_tenant and not a.cycle and a.d<=coalesce(v.max_section_depth,3)
        ) select coalesce(max(d),0),coalesce(bool_or(cycle or d>coalesce(v.max_section_depth,3) or item_type<>'section'),false)
          into parent_depth,hierarchy_invalid from parents;
        if hierarchy_invalid then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        with recursive subtree as (
          select p.id,p.item_type,0 as d,array[p.id] as path,false as cycle
          from public.estimate_items p where p.id=item.id and p.version_id=p_version_id and p.tenant_id=target_tenant
          union all
          select c.id,c.item_type,s.d+1,s.path||c.id,c.id=any(s.path)
          from public.estimate_items c join subtree s on c.parent_id=s.id
          where c.version_id=p_version_id and c.tenant_id=target_tenant and not s.cycle and s.d<=coalesce(v.max_section_depth,3)
        ) select coalesce(bool_or(cycle or id=item.parent_id
          or (item_type='section' and parent_depth+1+d>coalesce(v.max_section_depth,3))
          or (item_type='line' and parent_depth+d>coalesce(v.max_section_depth,3))),false)
          into hierarchy_invalid from subtree;
        if hierarchy_invalid then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      end if;
      if item.source_job_id is not null then
        perform 1 from public.takeoff_jobs j where j.id=item.source_job_id and j.tenant_id=target_tenant for share nowait;
        if not found then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        -- Version duplication retains the original source_job_id. UPDATE never
        -- accepts a new source ID. A new attachment needs the target job or an
        -- explicit, locked carry-over link, not just another job in the tenant.
        if op->>'op'='create' and not exists(select 1 from public.takeoff_jobs j where j.id=item.source_job_id and j.estimate_version_id=p_version_id) then
          perform 1 from public.takeoff_version_links l join public.takeoff_jobs j on j.id=l.takeoff_job_id and j.tenant_id=l.tenant_id and j.estimate_version_id=l.source_version_id
          where l.tenant_id=target_tenant and l.takeoff_job_id=item.source_job_id and l.target_version_id=p_version_id for share of l nowait;
          if not found then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        end if;
      end if;
      -- Rows behind retained references are stabilized too: a concurrent scope
      -- move cannot pass the validation and commit before this item transaction.
      if item.category_id is not null then perform 1 from public.estimate_categories c where c.id=item.category_id and c.tenant_id=target_tenant and c.user_id=project_owner for share nowait; if not found then perform private.estimate_batch_error('INVALID_INPUT'); end if; end if;
      if item.supply_type_id is not null then perform 1 from public.supply_types s where s.id=item.supply_type_id and s.tenant_id=target_tenant for share nowait; if not found then perform private.estimate_batch_error('INVALID_INPUT'); end if; end if;
      if item.product_id is not null then perform 1 from public.products p where p.id=item.product_id and p.tenant_id=target_tenant for share nowait; if not found then perform private.estimate_batch_error('INVALID_INPUT'); end if; end if;
      if item.selected_supplier_price_id is not null then perform 1 from public.supplier_pricebook s where s.id=item.selected_supplier_price_id and s.tenant_id=target_tenant for share nowait; if not found then perform private.estimate_batch_error('INVALID_INPUT'); end if; end if;
      if exists(select 1 from unnest(array[item.labor_role_id,item.labor_role_atelier_id,item.labor_role_chantier_id]) r(id) where r.id is not null and not exists(select 1 from public.labor_roles l where l.id=r.id and l.tenant_id=target_tenant and l.user_id=project_owner)) then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      if item.item_type='line' then
        has_supply:=coalesce(item.unit_price_ht_cents,0)>0 or item.supply_type_id is not null or item.selected_supplier_price_id is not null;
        has_labor:=coalesce(item.h_mo,0)>0 or coalesce(item.h_mo_atelier,0)>0 or coalesce(item.h_mo_chantier,0)>0 or item.labor_role_id is not null or item.labor_role_atelier_id is not null or item.labor_role_chantier_id is not null
          or coalesce(item.h_mo_per_unit,0)>0 or coalesce(item.h_mo_atelier_per_unit,0)>0 or coalesce(item.h_mo_chantier_per_unit,0)>0;
        if not(data?'line_nature') then
          if op->>'op'='create' then item.line_nature:=(case when has_labor and not has_supply then 'labor_only' when has_labor then 'supply_and_labor' else 'supply_only' end)::public.estimate_line_nature;
          elsif old_item.line_nature='supply_only' and data?|array['h_mo','h_mo_atelier','h_mo_chantier','labor_role_id','labor_role_atelier_id','labor_role_chantier_id','h_mo_per_unit','h_mo_atelier_per_unit','h_mo_chantier_per_unit'] and has_labor or old_item.line_nature='labor_only' and data?|array['unit_price_ht_cents','supply_type_id','selected_supplier_price_id'] and has_supply then item.line_nature:='supply_and_labor'; end if;
        end if;
        affected_ids:=array_append(affected_ids,item.id);
      end if;
      if op->>'op'='create' then
        insert into public.estimate_items(id,tenant_id,version_id,parent_id,item_type,position,title,description,aid,quantity,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,h_mo_majoration,k_mo,h_mo_atelier,k_mo_atelier,labor_role_atelier_id,h_mo_chantier,k_mo_chantier,labor_role_chantier_id,pu_ht_cents,labor_role_id,category_id,supply_type_id,product_id,selected_supplier_price_id,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,line_nature,source_provider,source_job_id,source_file_name,source_page,unit_code,pricing_status,h_mo_per_unit,h_mo_atelier_per_unit,h_mo_chantier_per_unit)
        values(item.id,item.tenant_id,item.version_id,item.parent_id,item.item_type,item.position,item.title,item.description,item.aid,item.quantity,item.unit_price_ht_cents,item.tax_rate_bp,item.k_fo,item.h_mo,item.h_mo_majoration,item.k_mo,item.h_mo_atelier,item.k_mo_atelier,item.labor_role_atelier_id,item.h_mo_chantier,item.k_mo_chantier,item.labor_role_chantier_id,item.pu_ht_cents,item.labor_role_id,item.category_id,item.supply_type_id,item.product_id,item.selected_supplier_price_id,item.line_total_ht_cents,item.line_tax_cents,item.line_total_ttc_cents,item.line_nature,item.source_provider,item.source_job_id,item.source_file_name,item.source_page,item.unit_code,coalesce(item.pricing_status,'priced'::public.estimate_line_pricing_status),item.h_mo_per_unit,item.h_mo_atelier_per_unit,item.h_mo_chantier_per_unit);
      else
        update public.estimate_items set parent_id=item.parent_id,position=item.position,title=item.title,description=item.description,aid=item.aid,quantity=item.quantity,unit_price_ht_cents=item.unit_price_ht_cents,tax_rate_bp=item.tax_rate_bp,k_fo=item.k_fo,h_mo=item.h_mo,h_mo_majoration=item.h_mo_majoration,k_mo=item.k_mo,h_mo_atelier=item.h_mo_atelier,k_mo_atelier=item.k_mo_atelier,labor_role_atelier_id=item.labor_role_atelier_id,h_mo_chantier=item.h_mo_chantier,k_mo_chantier=item.k_mo_chantier,labor_role_chantier_id=item.labor_role_chantier_id,labor_role_id=item.labor_role_id,category_id=item.category_id,supply_type_id=item.supply_type_id,product_id=item.product_id,selected_supplier_price_id=item.selected_supplier_price_id,line_nature=item.line_nature,unit_code=item.unit_code,pricing_status=item.pricing_status,h_mo_per_unit=item.h_mo_per_unit,h_mo_atelier_per_unit=item.h_mo_atelier_per_unit,h_mo_chantier_per_unit=item.h_mo_chantier_per_unit where id=item.id and version_id=p_version_id;
      end if;
      results:=results||jsonb_build_array(jsonb_build_object('index',operation_index,'op',op->>'op','status','ok','data',jsonb_build_object('item_id',item.id)));
    end loop;
    operation_stage:=false;
    select coalesce(array_agg(id order by id),'{}') into actual_ids from public.estimate_items where version_id=p_version_id and item_type='line' and (private.calc_engine_freezes_snapshot(v.calc_engine_version) or id=any(affected_ids));
    if supplied_ids is distinct from actual_ids then perform private.estimate_batch_error('PROJECTION_MISMATCH'); end if;
    select coalesce(array_agg(distinct r.id order by r.id),'{}') into role_ids from public.estimate_items i cross join lateral unnest(array[i.labor_role_id,i.labor_role_atelier_id,i.labor_role_chantier_id]) r(id) where i.version_id=p_version_id and i.item_type='line' and r.id is not null;
    if private.calc_engine_freezes_snapshot(v.calc_engine_version) and exists(select 1 from unnest(role_ids) r(id) where not exists(select 1 from public.labor_roles l where l.id=r.id and l.tenant_id=target_tenant and l.user_id=project_owner)) then perform private.estimate_batch_error('CONTEXT_CHANGED'); end if;
    select jsonb_build_object('labor_roles',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'tenant_id',l.tenant_id,'user_id',l.user_id,'hourly_rate_cents',l.hourly_rate_cents) order by l.id) from public.labor_roles l where l.id=any(role_ids) and l.tenant_id=target_tenant and l.user_id=project_owner),'[]'),
      'margin_tiers',case when v.margin_mode='tiered' then coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'threshold_cents',m.threshold_cents,'multiplier',m.multiplier,'position',m.position) order by m.threshold_cents,m.position,m.id) from public.margin_tiers m where m.tenant_id=target_tenant),'[]') else '[]'::jsonb end,
      'labor_split_flag',(select jsonb_build_object('id',f.id,'enabled',f.enabled) from public.feature_flags f where f.tenant_id=target_tenant and f.flag_key='EST_031_LABOR_SPLIT')) into raw_context;
    if raw_context is distinct from p_calculation_context then perform private.estimate_batch_error('CONTEXT_CHANGED'); end if;
    select * into v from public.estimate_versions where id=p_version_id;
    perform public.bulk_update_estimate_items(p_version_id,p_item_updates,case when is_v3 then null else p_version_patch end,v.updated_at);
    if is_v3 then
      update public.estimate_versions set total_ht_cents=(p_version_patch->>'total_ht_cents')::integer,total_tax_cents=(p_version_patch->>'total_tax_cents')::integer,total_ttc_cents=(p_version_patch->>'total_ttc_cents')::integer,
        gross_ht_cents=(p_version_patch->>'gross_ht_cents')::integer,discount_applied_cents=(p_version_patch->>'discount_applied_cents')::integer,commercial_rounding_cents=(p_version_patch->>'commercial_rounding_cents')::integer
      where id=p_version_id and tenant_id=target_tenant;
      perform private.estimate_v3_assert_draft(p_version_id);
      perform pg_catalog.set_config('miaouffrage.estimate_v3_writer',previous_v3_writer,true);
    end if;
    select * into v from public.estimate_versions where id=p_version_id;
    select coalesce(jsonb_agg(case when x->>'op' in('create','update') then jsonb_set(x,'{data}',case when i.id is null then jsonb_build_object('item',null,'deleted_in_batch',true,'deleted_item_id',x->'data'->'item_id') else jsonb_build_object('item',to_jsonb(i)) end) else x end order by (x->>'index')::integer),'[]') into results
    from jsonb_array_elements(results) x left join public.estimate_items i on i.id=(x->'data'->>'item_id')::uuid and i.version_id=p_version_id;
    perform public.log_estimate_batch_audit(p_version_id,operations);
    event_time:=clock_timestamp();
    response:=jsonb_build_object('committed',true,'results',results,'version',jsonb_build_object('id',v.id,'updated_at',v.updated_at),'totals',jsonb_build_object('total_ht_cents',v.total_ht_cents,'total_tax_cents',v.total_tax_cents,'total_ttc_cents',v.total_ttc_cents),
      'receipt',jsonb_build_object('operation_key',p_operation_key,'actor_id',actor,'version_id',p_version_id,'expected_updated_at',p_expected_updated_at,'operations',operations,'committed_at',event_time));
    if octet_length(response::text)>2097152 then perform private.estimate_batch_error('INVALID_INPUT'); end if;
    insert into private.estimate_batch_receipts(version_id,operation_key,tenant_id,project_id,actor_id,canonical_request,response,committed_at) values(p_version_id,p_operation_key,target_tenant,v.project_id,actor,canonical,response,event_time);
    return response||jsonb_build_object('replayed',false,'current_version',jsonb_build_object('id',v.id,'updated_at',v.updated_at,'status',v.status));
  exception when others then
    get stacked diagnostics failure_code=returned_sqlstate,failure_message=message_text;
    if failure_message='ESTIMATE_V3_PROJECTION_MISMATCH' then failure_message:='ESTIMATE_BATCH_PROJECTION_MISMATCH'; end if;
    if failure_message not in('ESTIMATE_BATCH_INVALID_INPUT','ESTIMATE_BATCH_NOT_FOUND','ESTIMATE_BATCH_PROJECTION_MISMATCH','ESTIMATE_BATCH_CONTEXT_CHANGED','ESTIMATE_BATCH_STALE','ESTIMATE_BATCH_FORBIDDEN','ESTIMATE_BATCH_LOCK_REQUIRED') then
      failure_message:=case when failure_code in('40001','40P01','55P03') then 'ESTIMATE_BATCH_STALE' else 'ESTIMATE_BATCH_INVALID_INPUT' end;
    end if;
    -- Context/projection/finalization failures have no invented operation index.
    if not operation_stage then raise exception using errcode=case when failure_message like '%CONTEXT_CHANGED' or failure_message like '%STALE' then '40001' else '22023' end,message=failure_message; end if;
    select coalesce(jsonb_agg(jsonb_build_object('index',x->'index','op',x->'op','status','ok','data',jsonb_build_object('rolled_back',true)) order by (x->>'index')::integer),'[]') into results from jsonb_array_elements(results) x;
    results:=results||jsonb_build_array(jsonb_build_object('index',operation_index,'op',op->>'op','status','error','code',failure_message,'message','Le lot a été annulé.'));
    return jsonb_build_object('committed',false,'results',results,'version',jsonb_build_object('id',p_version_id,'updated_at',p_expected_updated_at));
  end;
exception when lock_not_available or deadlock_detected then perform private.estimate_batch_error('STALE'); return null;
  when invalid_text_representation or numeric_value_out_of_range then perform private.estimate_batch_error('INVALID_INPUT'); return null;
end $function$
;


-- Ligne : branche v3 sous le contrat d'écrivain, pied v3 complet en une instruction, contrôle
-- D12 par la passerelle (fonction security invoker). Rôles du propriétaire exigés en v2 et v3.
CREATE OR REPLACE FUNCTION public.atomic_create_estimate_item(p_version_id uuid, p_item jsonb, p_item_updates jsonb, p_version_patch jsonb, p_expected_updated_at timestamp with time zone, p_draft_lock_session_id uuid, p_calculation_context jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  target_tenant uuid;
  actor_role public.tenant_role;
  version_row public.estimate_versions%rowtype;
  project_row public.estimate_projects%rowtype;
  lock_row public.draft_locks%rowtype;
  item_row public.estimate_items%rowtype;
  result_item public.estimate_items%rowtype;
  normalized_item jsonb;
  raw_context jsonb;
  role_ids uuid[];
  actual_ids uuid[];
  projected_ids uuid[];
  version_token timestamptz;
  effective_defaults jsonb;
  is_v3 boolean;
  previous_v3_writer text;
begin
  if actor_id is null then
    raise exception using errcode='42501',message='ESTIMATE_CREATE_FORBIDDEN';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock_shared(pg_catalog.hashtextextended('estimate-create-actor:'||actor_id::text,0)) then
    raise exception using errcode='40001',message='ESTIMATE_CREATE_CONTEXT_CHANGED';
  end if;
  target_tenant:=public.current_tenant_id();
  if target_tenant is null then
    raise exception using errcode='42501',message='ESTIMATE_CREATE_FORBIDDEN';
  end if;
  select membership.role into actor_role
  from public.tenant_memberships membership
  where membership.tenant_id=target_tenant and membership.user_id=actor_id;
  if actor_role is null or actor_role not in ('admin','engineer') then
    raise exception using errcode='42501',message='ESTIMATE_CREATE_FORBIDDEN';
  end if;
  if p_draft_lock_session_id is null then
    raise exception using errcode='55000',message='ESTIMATE_CREATE_LOCK_REQUIRED';
  end if;
  if p_version_id is null or p_expected_updated_at is null
    or jsonb_typeof(p_item) is distinct from 'object'
    or jsonb_typeof(p_item_updates) is distinct from 'array'
    or jsonb_typeof(p_version_patch) is distinct from 'object'
    or jsonb_typeof(p_calculation_context) is distinct from 'object'
    or not (p_item ?& array['id','item_type','position','title'])
    or p_item - array['id','parent_id','item_type','position','title','description','aid','quantity','unit_price_ht_cents','tax_rate_bp','k_fo','h_mo','h_mo_majoration','k_mo','h_mo_atelier','k_mo_atelier','labor_role_atelier_id','h_mo_chantier','k_mo_chantier','labor_role_chantier_id','pu_ht_cents','labor_role_id','category_id','supply_type_id','product_id','selected_supplier_price_id','line_total_ht_cents','line_tax_cents','line_total_ttc_cents','line_nature','source_provider','source_job_id','source_file_name','source_page','unit_code','pricing_status','h_mo_per_unit','h_mo_atelier_per_unit','h_mo_chantier_per_unit'] <> '{}'::jsonb
    or not (p_version_patch ?& array['total_ht_cents','total_tax_cents','total_ttc_cents'])
    or p_version_patch - array['total_ht_cents','total_tax_cents','total_ttc_cents','gross_ht_cents','discount_applied_cents','commercial_rounding_cents'] <> '{}'::jsonb
    or not (p_calculation_context ?& array['labor_roles','margin_tiers','labor_split_flag'])
    or p_calculation_context - array['labor_roles','margin_tiers','labor_split_flag'] <> '{}'::jsonb
    or jsonb_typeof(p_calculation_context->'labor_roles') is distinct from 'array'
    or jsonb_typeof(p_calculation_context->'margin_tiers') is distinct from 'array'
    or jsonb_typeof(p_calculation_context->'labor_split_flag') not in ('object','null')
  then
    raise exception using errcode='22023',message='ESTIMATE_CREATE_INVALID_INPUT';
  end if;
  if exists(select 1 from jsonb_each(p_version_patch) x where jsonb_typeof(x.value)<>'number' or x.value::text !~ '^[0-9]+$')
    or jsonb_typeof(p_item->'id') is distinct from 'string'
    or jsonb_typeof(p_item->'title') is distinct from 'string'
    or p_item->>'item_type' not in ('section','line')
    or jsonb_typeof(p_item->'position') is distinct from 'number'
    or p_item->>'position' !~ '^[0-9]+$'
  then raise exception using errcode='22023',message='ESTIMATE_CREATE_INVALID_INPUT'; end if;

  if not pg_catalog.pg_try_advisory_xact_lock_shared(pg_catalog.hashtextextended('estimate-calculation:'||target_tenant::text,0)) then
    raise exception using errcode='40001',message='ESTIMATE_CREATE_CONTEXT_CHANGED';
  end if;
  -- SELECT FOR UPDATE follows the invoker's UPDATE policies as well as RLS.
  select v.* into version_row from public.estimate_versions v
  where v.id=p_version_id and v.tenant_id=target_tenant for update nowait;
  if not found or version_row.status<>'draft' then
    raise exception using errcode='42501',message='ESTIMATE_CREATE_FORBIDDEN';
  end if;
  select p.* into project_row from public.estimate_projects p
  where p.id=version_row.project_id and p.tenant_id=target_tenant for share nowait;
  if not found or project_row.is_archived or (project_row.user_id<>actor_id and actor_role<>'admin') then
    raise exception using errcode='42501',message='ESTIMATE_CREATE_FORBIDDEN';
  end if;
  if version_row.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode='40001',message='ESTIMATE_CREATE_STALE';
  end if;
  is_v3:=version_row.calc_engine_version=3;
  if (p_version_patch ?| array['gross_ht_cents','discount_applied_cents','commercial_rounding_cents']) is distinct from is_v3
    or is_v3 and not (p_version_patch ?& array['gross_ht_cents','discount_applied_cents','commercial_rounding_cents']) then
    raise exception using errcode='22023',message='ESTIMATE_CREATE_INVALID_INPUT';
  end if;
  select l.* into lock_row from public.draft_locks l
  where l.version_id=p_version_id and l.tenant_id=target_tenant for update nowait;
  if not found or lock_row.user_id is distinct from actor_id or lock_row.session_id is distinct from p_draft_lock_session_id or lock_row.expires_at<=clock_timestamp() then
    raise exception using errcode='55000',message='ESTIMATE_CREATE_LOCK_REQUIRED';
  end if;
  -- Stabilize hierarchy and projected rows before insertion. A direct row writer
  -- may already wait on the version; NOWAIT converts that inversion to conflict.
  perform i.id from public.estimate_items i where i.version_id=p_version_id and i.tenant_id=target_tenant order by i.id for update nowait;
  effective_defaults:=case p_item->>'item_type'
    when 'line' then jsonb_build_object('quantity',1,'unit_price_ht_cents',0,'tax_rate_bp',version_row.tax_rate_bp,'k_fo',1,'h_mo',0,'h_mo_majoration',1,'k_mo',1,'k_mo_atelier',1,'k_mo_chantier',1,'pu_ht_cents',0,'line_total_ht_cents',0,'line_tax_cents',0,'line_total_ttc_cents',0)
    else '{"h_mo_majoration":1,"k_mo_atelier":1,"k_mo_chantier":1}'::jsonb end;
  normalized_item:=effective_defaults||p_item||jsonb_build_object('tenant_id',target_tenant,'version_id',p_version_id);
  -- jsonb_populate_record applies the real column typmods (12,3 and 12,4),
  -- preserving the existing numeric coercion rather than inventing new rounding.
  select * into item_row from jsonb_populate_record(null::public.estimate_items,normalized_item);
  if item_row.id is null or item_row.position is null or item_row.title is null then
    raise exception using errcode='22023',message='ESTIMATE_CREATE_INVALID_INPUT';
  end if;
  if item_row.parent_id is not null and not exists(select 1 from public.estimate_items p where p.id=item_row.parent_id and p.version_id=p_version_id and p.tenant_id=target_tenant and p.item_type='section') then
    raise exception using errcode='22023',message='ESTIMATE_CREATE_INVALID_INPUT';
  end if;
  if item_row.category_id is not null and not exists(select 1 from public.estimate_categories c where c.id=item_row.category_id and c.tenant_id=target_tenant and c.user_id=project_row.user_id)
    or item_row.supply_type_id is not null and not exists(select 1 from public.supply_types s where s.id=item_row.supply_type_id and s.tenant_id=target_tenant)
    or item_row.product_id is not null and not exists(select 1 from public.products p where p.id=item_row.product_id and p.tenant_id=target_tenant)
    or item_row.selected_supplier_price_id is not null and not exists(select 1 from public.supplier_pricebook s where s.id=item_row.selected_supplier_price_id and s.tenant_id=target_tenant)
  then raise exception using errcode='22023',message='ESTIMATE_CREATE_INVALID_INPUT'; end if;
  if exists(select 1 from unnest(array[item_row.labor_role_id,item_row.labor_role_atelier_id,item_row.labor_role_chantier_id]) r(id)
    where r.id is not null and not exists(select 1 from public.labor_roles l where l.id=r.id and l.tenant_id=target_tenant and l.user_id=project_row.user_id)) then
    raise exception using errcode='22023',message='ESTIMATE_CREATE_INVALID_INPUT';
  end if;

  previous_v3_writer:=coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer',true),'');
  if is_v3 then perform pg_catalog.set_config('miaouffrage.estimate_v3_writer',p_version_id::text,true); end if;
  insert into public.estimate_items(id,tenant_id,version_id,parent_id,item_type,position,title,description,aid,quantity,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,h_mo_majoration,k_mo,h_mo_atelier,k_mo_atelier,labor_role_atelier_id,h_mo_chantier,k_mo_chantier,labor_role_chantier_id,pu_ht_cents,labor_role_id,category_id,supply_type_id,product_id,selected_supplier_price_id,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,line_nature,source_provider,source_job_id,source_file_name,source_page,unit_code,pricing_status,h_mo_per_unit,h_mo_atelier_per_unit,h_mo_chantier_per_unit)
  values(item_row.id,target_tenant,p_version_id,item_row.parent_id,item_row.item_type,item_row.position,item_row.title,item_row.description,item_row.aid,item_row.quantity,item_row.unit_price_ht_cents,item_row.tax_rate_bp,item_row.k_fo,item_row.h_mo,item_row.h_mo_majoration,item_row.k_mo,item_row.h_mo_atelier,item_row.k_mo_atelier,item_row.labor_role_atelier_id,item_row.h_mo_chantier,item_row.k_mo_chantier,item_row.labor_role_chantier_id,item_row.pu_ht_cents,item_row.labor_role_id,item_row.category_id,item_row.supply_type_id,item_row.product_id,item_row.selected_supplier_price_id,item_row.line_total_ht_cents,item_row.line_tax_cents,item_row.line_total_ttc_cents,item_row.line_nature,item_row.source_provider,item_row.source_job_id,item_row.source_file_name,item_row.source_page,item_row.unit_code,coalesce(item_row.pricing_status,'priced'::public.estimate_line_pricing_status),item_row.h_mo_per_unit,item_row.h_mo_atelier_per_unit,item_row.h_mo_chantier_per_unit);

  select coalesce(array_agg(distinct role_id order by role_id),'{}'::uuid[]) into role_ids
  from public.estimate_items i cross join lateral unnest(array[i.labor_role_id,i.labor_role_atelier_id,i.labor_role_chantier_id]) r(role_id)
  where i.version_id=p_version_id and i.item_type='line' and role_id is not null;
  if version_row.calc_engine_version in (2, 3) and exists(select 1 from unnest(role_ids) r(id) where not exists(select 1 from public.labor_roles l where l.id=r.id and l.tenant_id=target_tenant and l.user_id=project_row.user_id)) then
    raise exception using errcode='40001',message='ESTIMATE_CREATE_CONTEXT_CHANGED';
  end if;
  select jsonb_build_object(
    'labor_roles',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'tenant_id',l.tenant_id,'user_id',l.user_id,'hourly_rate_cents',l.hourly_rate_cents) order by l.id) from public.labor_roles l where l.id=any(role_ids) and l.tenant_id=target_tenant and l.user_id=project_row.user_id),'[]'),
    'margin_tiers',case when version_row.margin_mode='tiered' then coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'threshold_cents',m.threshold_cents,'multiplier',m.multiplier,'position',m.position) order by m.threshold_cents,m.position,m.id) from public.margin_tiers m where m.tenant_id=target_tenant),'[]') else '[]'::jsonb end,
    'labor_split_flag',(select jsonb_build_object('id',f.id,'enabled',f.enabled) from public.feature_flags f where f.tenant_id=target_tenant and f.flag_key='EST_031_LABOR_SPLIT')) into raw_context;
  if raw_context is distinct from p_calculation_context then
    raise exception using errcode='40001',message='ESTIMATE_CREATE_CONTEXT_CHANGED';
  end if;
  if version_row.calc_engine_version=1 then
    if p_item_updates<>'[]'::jsonb then raise exception using errcode='22023',message='ESTIMATE_CREATE_PROJECTION_MISMATCH'; end if;
  else
    if exists(select 1 from jsonb_array_elements(p_item_updates) u where jsonb_typeof(u)<>'object'
      or not(u ?& array['id','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents'])
      or u-array['id','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents']<>'{}'::jsonb
      or jsonb_typeof(u->'id')<>'string') then
      raise exception using errcode='22023',message='ESTIMATE_CREATE_PROJECTION_MISMATCH';
    end if;
    if exists(select 1 from jsonb_array_elements(p_item_updates) u cross join lateral jsonb_each(u-'id') x where not (is_v3 and x.key='pu_ht_cents' and x.value='null'::jsonb) and (jsonb_typeof(x.value)<>'number' or x.value::text !~ '^-?[0-9]+$')) then
      raise exception using errcode='22023',message='ESTIMATE_CREATE_PROJECTION_MISMATCH';
    end if;
    select coalesce(array_agg((u->>'id')::uuid order by (u->>'id')::uuid),'{}'::uuid[]) into projected_ids from jsonb_array_elements(p_item_updates) u;
    select coalesce(array_agg(i.id order by i.id),'{}'::uuid[]) into actual_ids from public.estimate_items i where i.version_id=p_version_id and i.tenant_id=target_tenant and i.item_type='line';
    if projected_ids is distinct from actual_ids then
      raise exception using errcode='22023',message='ESTIMATE_CREATE_PROJECTION_MISMATCH';
    end if;
  end if;
  -- INSERT's content-revision trigger has advanced this token. The existing bulk
  -- implementation remains the sole projection writer, in this same transaction.
  select v.updated_at into version_token from public.estimate_versions v where v.id=p_version_id;
  perform public.bulk_update_estimate_items(p_version_id,p_item_updates,case when is_v3 then null else p_version_patch end,version_token);
  if is_v3 then
    update public.estimate_versions v set total_ht_cents=(p_version_patch->>'total_ht_cents')::integer,total_tax_cents=(p_version_patch->>'total_tax_cents')::integer,total_ttc_cents=(p_version_patch->>'total_ttc_cents')::integer,
      gross_ht_cents=(p_version_patch->>'gross_ht_cents')::integer,discount_applied_cents=(p_version_patch->>'discount_applied_cents')::integer,commercial_rounding_cents=(p_version_patch->>'commercial_rounding_cents')::integer
    where v.id=p_version_id and v.tenant_id=target_tenant;
    perform public.estimate_v3_assert_draft_for_writer(p_version_id);
    perform pg_catalog.set_config('miaouffrage.estimate_v3_writer',previous_v3_writer,true);
  end if;
  select i.* into result_item from public.estimate_items i where i.id=item_row.id and i.version_id=p_version_id;
  select v.* into version_row from public.estimate_versions v where v.id=p_version_id;
  return jsonb_build_object('item',to_jsonb(result_item),'version',jsonb_build_object('id',version_row.id,'updated_at',version_row.updated_at),'totals',jsonb_build_object('total_ht_cents',version_row.total_ht_cents,'total_tax_cents',version_row.total_tax_cents,'total_ttc_cents',version_row.total_ttc_cents));
exception when lock_not_available then
  raise exception using errcode='40001',message='ESTIMATE_CREATE_STALE';
end;
$function$
;


-- Réglages : branche v3 (coefficients de vente, intention de remise montant XOR taux sans
-- dérivation, arrondi none/down, apply_tax_rate_to_lines (D8), projections avec taux de ligne,
-- pied v3, rôles du propriétaire, contrat d'écrivain, contrôle D12 par la passerelle).
CREATE OR REPLACE FUNCTION public.save_estimate_settings_atomic(p_version_id uuid, p_tenant_id uuid, p_actor_user_id uuid, p_expected_updated_at timestamp with time zone, p_expected_content_revision bigint, p_draft_lock_session_id uuid, p_settings_patch jsonb, p_line_projections jsonb, p_totals jsonb, p_expected_dependencies jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  version_row public.estimate_versions%rowtype;
  prospective public.estimate_versions%rowtype;
  project_row public.estimate_projects%rowtype;
  lease_row public.draft_locks%rowtype;
  actor_role public.tenant_role;
  active_tenant uuid;
  projected_ids uuid[];
  actual_ids uuid[];
  role_ids uuid[];
  projection_keys text[];
  raw_dependencies jsonb;
  all_items jsonb;
  previous_marker text;
  ht bigint;
  tax bigint;
  ttc bigint;
  adjustment bigint;
  is_v3 boolean;
  apply_tax_rate_to_lines boolean;
  previous_v3_writer text;
begin
  if current_user <> 'service_role' then
    raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED';
  end if;
  if p_version_id is null or p_tenant_id is null or p_actor_user_id is null
    or p_expected_updated_at is null or p_expected_content_revision is null
    or p_expected_content_revision < 0
    or jsonb_typeof(p_settings_patch) is distinct from 'object'
    or jsonb_typeof(p_line_projections) is distinct from 'array'
    or jsonb_typeof(p_totals) is distinct from 'object'
    or not (p_totals ?& array['total_ht_cents','total_tax_cents','total_ttc_cents','rounding_adjustment_cents'])
    or p_totals-array['total_ht_cents','total_tax_cents','total_ttc_cents','rounding_adjustment_cents','gross_ht_cents','discount_applied_cents','commercial_rounding_cents'] <> '{}'::jsonb
    or jsonb_typeof(p_expected_dependencies) is distinct from 'object'
    or not (p_expected_dependencies ?& array['labor_roles','margin_tiers','labor_split_flag'])
    or p_expected_dependencies-array['labor_roles','margin_tiers','labor_split_flag'] <> '{}'::jsonb
    or jsonb_typeof(p_expected_dependencies->'labor_roles') is distinct from 'array'
    or jsonb_typeof(p_expected_dependencies->'margin_tiers') is distinct from 'array'
    or jsonb_typeof(p_expected_dependencies->'labor_split_flag') not in ('object','null')
    or p_settings_patch-array['title','exclusions','date_devis','validite_jours','currency','margin_multiplier',
      'margin_mode','margin_bp','discount_bp','discount_amount_cents','discount_mode','discount_steps','global_coefficient','tax_rate_bp',
      'contractor_role','rounding_mode','rounding_step_cents','max_section_depth',
      'sale_coefficient_fo','sale_coefficient_mo','apply_tax_rate_to_lines'] <> '{}'::jsonb
    or coalesce(pg_catalog.current_setting('miaouffrage.estimate_v2_snapshot_freeze',true),'')='on'
    or coalesce(pg_catalog.current_setting('app.takeoff_apply_atomic',true),'')='on'
  then
    raise exception using errcode='22023',message='ESTIMATE_SETTINGS_INVALID_INPUT';
  end if;
  if exists(select 1 from jsonb_each(p_settings_patch) x where
    case
      when x.key in ('title','exclusions') then jsonb_typeof(x.value) not in ('string','null')
      when x.key='discount_amount_cents' then jsonb_typeof(x.value) not in ('number','null')
      when x.key in ('date_devis','currency','margin_mode','discount_mode','contractor_role','rounding_mode') then jsonb_typeof(x.value) <> 'string'
      when x.key='discount_steps' then jsonb_typeof(x.value) <> 'array'
      when x.key='apply_tax_rate_to_lines' then jsonb_typeof(x.value) <> 'boolean'
      else jsonb_typeof(x.value) <> 'number'
    end)
    or exists(select 1 from jsonb_each(p_totals) x where jsonb_typeof(x.value)<>'number'
      or x.value::text !~ case when x.key='rounding_adjustment_cents' then '^-?[0-9]+$' else '^[0-9]+$' end)
  then
    raise exception using errcode='22023',message='ESTIMATE_SETTINGS_INVALID_INPUT';
  end if;
  if exists(select 1 from jsonb_each(p_totals) x where abs(x.value::text::numeric)>2147483647)
    or exists(select 1 from jsonb_each(p_settings_patch) x where
      x.key in ('validite_jours','margin_bp','discount_bp','tax_rate_bp','rounding_step_cents','max_section_depth')
      and (x.value::text !~ '^[0-9]+$' or x.value::text::numeric>2147483647))
    or exists(select 1 from jsonb_each(p_settings_patch) x where
      x.key in ('margin_multiplier','global_coefficient') and x.value::text::numeric<0)
    or p_settings_patch ? 'margin_multiplier' and (p_settings_patch->>'margin_multiplier')::numeric>100
    or exists(select 1 from jsonb_each(p_settings_patch) x where
      x.key in ('sale_coefficient_fo','sale_coefficient_mo') and (x.value::text::numeric<=0
        or x.value::text::numeric>10 or pg_catalog.min_scale(x.value::text::numeric)>4))
    or p_settings_patch ? 'validite_jours' and (p_settings_patch->>'validite_jours')::numeric<1
    or p_settings_patch ? 'rounding_step_cents' and (p_settings_patch->>'rounding_step_cents')::numeric<1
    or p_settings_patch ? 'tax_rate_bp' and (p_settings_patch->>'tax_rate_bp')::numeric>10000
    or p_settings_patch ? 'max_section_depth' and (p_settings_patch->>'max_section_depth')::numeric not between 1 and 4
    or p_settings_patch ? 'currency' and p_settings_patch->>'currency' not in ('EUR','USD','GBP')
    or p_settings_patch ? 'margin_mode' and p_settings_patch->>'margin_mode' not in ('fixed','tiered')
    or p_settings_patch ? 'discount_mode' and p_settings_patch->>'discount_mode' not in ('simple','cascade')
    or p_settings_patch ? 'contractor_role' and p_settings_patch->>'contractor_role' not in ('principal','subcontractor')
    or p_settings_patch ? 'rounding_mode' and p_settings_patch->>'rounding_mode' not in ('none','nearest','up','down')
    or p_settings_patch ? 'date_devis' and p_settings_patch->>'date_devis' !~ '^\d{4}-\d{2}-\d{2}$'
    or p_settings_patch ? 'exclusions' and char_length(p_settings_patch->>'exclusions')>5000
  then
    raise exception using errcode='22023',message='ESTIMATE_SETTINGS_INVALID_INPUT';
  end if;
  if p_settings_patch ? 'discount_amount_cents'
    and p_settings_patch->'discount_amount_cents' <> 'null'::jsonb then
    if p_settings_patch->>'discount_amount_cents' !~ '^[0-9]+$' then
      raise exception using errcode='22023',message='ESTIMATE_SETTINGS_INVALID_INPUT';
    end if;
    if (p_settings_patch->>'discount_amount_cents')::numeric > 2147483647 then
      raise exception using errcode='22023',message='ESTIMATE_SETTINGS_INVALID_INPUT';
    end if;
  end if;
  if p_settings_patch ? 'discount_steps' then
    if exists(select 1 from jsonb_array_elements(p_settings_patch->'discount_steps') x
      where jsonb_typeof(x)<>'number' or x::text !~ '^[0-9]+$') then
      raise exception using errcode='22023',message='ESTIMATE_SETTINGS_INVALID_INPUT';
    end if;
    if exists(select 1 from jsonb_array_elements(p_settings_patch->'discount_steps') x where x::text::numeric>10000) then
      raise exception using errcode='22023',message='ESTIMATE_SETTINGS_INVALID_INPUT';
    end if;
  end if;

  -- These existing gates include absent raw configuration and changes to the
  -- caller's tenant selection. Explicit row locks cover writers without gates.
  if not pg_catalog.pg_try_advisory_xact_lock_shared(pg_catalog.hashtextextended('estimate-create-actor:'||p_actor_user_id::text,0))
    or not pg_catalog.pg_try_advisory_xact_lock_shared(pg_catalog.hashtextextended('estimate-calculation:'||p_tenant_id::text,0)) then
    raise exception using errcode='40001',message='CONTEXT_CHANGED';
  end if;
  if not exists(select 1 from public.estimate_versions where id=p_version_id and tenant_id=p_tenant_id) then
    raise exception using errcode='P0001',message='ESTIMATE_NOT_FOUND';
  end if;
  perform t.id from public.tenants t where t.id=p_tenant_id and t.is_active for share nowait;
  if not found then raise exception using errcode='42501',message='ESTIMATE_WRITE_FORBIDDEN'; end if;
  select m.role into actor_role from public.tenant_memberships m
  where m.user_id=p_actor_user_id and m.tenant_id=p_tenant_id for share nowait;
  if not found or actor_role not in ('admin','engineer') then
    raise exception using errcode='42501',message='ESTIMATE_WRITE_FORBIDDEN';
  end if;
  select m.tenant_id into active_tenant from public.tenant_memberships m join public.tenants t on t.id=m.tenant_id and t.is_active
  where m.user_id=p_actor_user_id order by m.is_default desc,m.created_at asc limit 1;
  if active_tenant is distinct from p_tenant_id then
    raise exception using errcode='42501',message='ESTIMATE_WRITE_FORBIDDEN';
  end if;
  select v.* into version_row from public.estimate_versions v
  where v.id=p_version_id and v.tenant_id=p_tenant_id for update nowait;
  if not found then raise exception using errcode='P0001',message='ESTIMATE_NOT_FOUND'; end if;
  if version_row.status <> 'draft' then raise exception using errcode='42501',message='ESTIMATE_READ_ONLY'; end if;
  select p.* into project_row from public.estimate_projects p
  where p.id=version_row.project_id and p.tenant_id=p_tenant_id for share nowait;
  if not found or (project_row.user_id<>p_actor_user_id and actor_role<>'admin') then
    raise exception using errcode='42501',message='ESTIMATE_WRITE_FORBIDDEN';
  end if;
  if project_row.is_archived then raise exception using errcode='42501',message='ESTIMATE_READ_ONLY'; end if;
  is_v3:=version_row.calc_engine_version=3;
  apply_tax_rate_to_lines:=coalesce((p_settings_patch->>'apply_tax_rate_to_lines')::boolean,false);
  if not is_v3 and (p_settings_patch ?| array['sale_coefficient_fo','sale_coefficient_mo','apply_tax_rate_to_lines']
      or p_totals ?| array['gross_ht_cents','discount_applied_cents','commercial_rounding_cents'])
    or is_v3 and not (p_totals ?& array['gross_ht_cents','discount_applied_cents','commercial_rounding_cents']) then
    raise exception using errcode='22023',message='ESTIMATE_SETTINGS_INVALID_INPUT';
  end if;
  if version_row.updated_at is distinct from p_expected_updated_at
    or version_row.content_revision is distinct from p_expected_content_revision then
    raise exception using errcode='40001',message='ESTIMATE_VERSION_CONFLICT';
  end if;
  select l.* into lease_row from public.draft_locks l
  where l.version_id=p_version_id and l.tenant_id=p_tenant_id for update nowait;
  if not found or lease_row.user_id is distinct from p_actor_user_id
    or p_draft_lock_session_id is null or lease_row.session_id is distinct from p_draft_lock_session_id
    or lease_row.expires_at is null or lease_row.expires_at<=clock_timestamp() then
    raise exception using errcode='40001',message='ESTIMATE_DRAFT_LOCK_REQUIRED';
  end if;
  perform i.id from public.estimate_items i where i.version_id=p_version_id and i.tenant_id=p_tenant_id
  order by i.id for update nowait;

  prospective:=jsonb_populate_record(version_row,p_settings_patch);
  if prospective.discount_mode='simple' and cardinality(prospective.discount_steps)<>0 then
    raise exception using errcode='22023',message='ESTIMATE_SETTINGS_INVALID_INPUT';
  end if;
  if prospective.discount_amount_cents is not null and (
    prospective.discount_mode <> 'simple'::public.estimate_discount_mode
    or cardinality(prospective.discount_steps) <> 0
  ) then
    raise exception using errcode='22023',message='ESTIMATE_SETTINGS_INVALID_INPUT';
  end if;
  -- D5, D6, D7 : forme v3 refusée avant toute écriture (le CHECK de forme reste la garantie).
  if is_v3 and not coalesce(prospective.margin_mode='fixed' and prospective.margin_multiplier=1
      and prospective.global_coefficient=1 and prospective.discount_mode='simple'
      and cardinality(prospective.discount_steps)=0 and prospective.discount_bp between 0 and 10000
      and not (prospective.discount_amount_cents is not null and prospective.discount_bp<>0)
      and prospective.rounding_mode in ('none','down'),false) then
    raise exception using errcode='22023',message='ESTIMATE_SETTINGS_INVALID_INPUT';
  end if;
  projection_keys:=array['id','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents'];
  if is_v3 then projection_keys:=projection_keys||array['tax_rate_bp']; end if;
  if version_row.calc_engine_version=1 then projection_keys:=projection_keys||array['tax_rate_bp']; end if;
  if exists(select 1 from jsonb_array_elements(p_line_projections) u where jsonb_typeof(u) is distinct from 'object'
    or not (u ?& projection_keys) or u-projection_keys <> '{}'::jsonb
    or jsonb_typeof(u->'id') is distinct from 'string'
    or u->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception using errcode='22023',message='ESTIMATE_SETTINGS_PROJECTION_MISMATCH';
  end if;
  if exists(select 1 from jsonb_array_elements(p_line_projections) u cross join lateral jsonb_each(u-'id') x
    where not (is_v3 and x.key='pu_ht_cents' and x.value='null'::jsonb)
      and (jsonb_typeof(x.value)<>'number' or x.value::text !~ '^[0-9]+$')) then
    raise exception using errcode='22023',message='ESTIMATE_SETTINGS_PROJECTION_MISMATCH';
  end if;
  if exists(select 1 from jsonb_array_elements(p_line_projections) u cross join lateral jsonb_each(u-'id') x
    where x.value<>'null'::jsonb and (x.value::text::numeric>2147483647 or x.key='tax_rate_bp' and x.value::text::numeric>10000)) then
    raise exception using errcode='22023',message='ESTIMATE_SETTINGS_PROJECTION_MISMATCH';
  end if;
  select coalesce(array_agg((u->>'id')::uuid order by (u->>'id')::uuid),'{}'::uuid[]) into projected_ids
  from jsonb_array_elements(p_line_projections) u;
  select coalesce(array_agg(i.id order by i.id),'{}'::uuid[]) into actual_ids from public.estimate_items i
  where i.version_id=p_version_id and i.tenant_id=p_tenant_id and i.item_type='line';
  if projected_ids is distinct from actual_ids then
    raise exception using errcode='22023',message='ESTIMATE_SETTINGS_PROJECTION_MISMATCH';
  end if;
  ht:=(p_totals->>'total_ht_cents')::bigint;
  tax:=(p_totals->>'total_tax_cents')::bigint;
  ttc:=(p_totals->>'total_ttc_cents')::bigint;
  adjustment:=(p_totals->>'rounding_adjustment_cents')::bigint;
  if ht+tax<>ttc or tax-adjustment<0
    or cardinality(actual_ids)=0 and (ht<>0 or tax<>0 or ttc<>0 or adjustment<>0)
    or exists(select 1 from jsonb_array_elements(p_line_projections) u
      where (u->>'line_total_ht_cents')::bigint+(u->>'line_tax_cents')::bigint<>(u->>'line_total_ttc_cents')::bigint
        or version_row.calc_engine_version=1 and (u->>'tax_rate_bp')::integer is distinct from prospective.tax_rate_bp)
    or prospective.contractor_role='subcontractor' and (tax<>0 or adjustment<>0 or
      exists(select 1 from jsonb_array_elements(p_line_projections) u where (u->>'line_tax_cents')::bigint<>0))
    or is_v3 and exists(select 1 from jsonb_array_elements(p_line_projections) u
      join public.estimate_items i on i.id=(u->>'id')::uuid and i.version_id=p_version_id and i.tenant_id=p_tenant_id
      where (u->>'tax_rate_bp')::integer is distinct from case when apply_tax_rate_to_lines then prospective.tax_rate_bp else i.tax_rate_bp end)
    or version_row.calc_engine_version in (2, 3) and exists(
      select 1 from (select coalesce(sum((u->>'line_total_ht_cents')::bigint),0) as h,
        coalesce(sum((u->>'line_tax_cents')::bigint),0) as t,coalesce(sum((u->>'line_total_ttc_cents')::bigint),0) as c
        from jsonb_array_elements(p_line_projections) u) sums where sums.h<>ht or sums.t<>tax or sums.c<>ttc)
  then
    raise exception using errcode='22023',message='ESTIMATE_SETTINGS_PROJECTION_MISMATCH';
  end if;

  select coalesce(array_agg(distinct r.id order by r.id),'{}'::uuid[]) into role_ids
  from public.estimate_items i cross join lateral unnest(array[i.labor_role_id,i.labor_role_atelier_id,i.labor_role_chantier_id]) r(id)
  where i.version_id=p_version_id and i.tenant_id=p_tenant_id and i.item_type='line' and r.id is not null;
  perform l.id from public.labor_roles l where l.id=any(role_ids) and l.tenant_id=p_tenant_id
  order by l.id for share nowait;
  if version_row.calc_engine_version in (2, 3) and exists(select 1 from unnest(role_ids) r(id)
    where not exists(select 1 from public.labor_roles l where l.id=r.id and l.tenant_id=p_tenant_id and l.user_id=project_row.user_id)) then
    raise exception using errcode='40001',message='CONTEXT_CHANGED';
  end if;
  if prospective.margin_mode='tiered' then
    perform m.id from public.margin_tiers m where m.tenant_id=p_tenant_id order by m.threshold_cents,m.position,m.id for share nowait;
  end if;
  perform f.id from public.feature_flags f where f.tenant_id=p_tenant_id and f.flag_key='EST_031_LABOR_SPLIT' for share nowait;
  select jsonb_build_object(
    'labor_roles',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'tenant_id',l.tenant_id,'user_id',l.user_id,'hourly_rate_cents',l.hourly_rate_cents) order by l.id)
      from public.labor_roles l where l.id=any(role_ids) and l.tenant_id=p_tenant_id and l.user_id=project_row.user_id),'[]'),
    'margin_tiers',case when prospective.margin_mode='tiered' then coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'threshold_cents',m.threshold_cents,'multiplier',m.multiplier,'position',m.position) order by m.threshold_cents,m.position,m.id)
      from public.margin_tiers m where m.tenant_id=p_tenant_id),'[]') else '[]'::jsonb end,
    'labor_split_flag',(select jsonb_build_object('id',f.id,'enabled',f.enabled) from public.feature_flags f where f.tenant_id=p_tenant_id and f.flag_key='EST_031_LABOR_SPLIT')) into raw_dependencies;
  if raw_dependencies is distinct from p_expected_dependencies then
    raise exception using errcode='40001',message='CONTEXT_CHANGED';
  end if;
  if lease_row.expires_at<=clock_timestamp() then
    raise exception using errcode='40001',message='ESTIMATE_DRAFT_LOCK_REQUIRED';
  end if;

  previous_marker:=pg_catalog.current_setting('miaouffrage.estimate_settings_atomic',true);
  perform pg_catalog.set_config('miaouffrage.estimate_settings_atomic',p_version_id::text,true);
  previous_v3_writer:=coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer',true),'');
  if is_v3 then perform pg_catalog.set_config('miaouffrage.estimate_v3_writer',p_version_id::text,true); end if;
  update public.estimate_items i
  set pu_ht_cents=projected.pu_ht_cents,line_total_ht_cents=projected.line_total_ht_cents,
    line_tax_cents=projected.line_tax_cents,line_total_ttc_cents=projected.line_total_ttc_cents,
    tax_rate_bp=case when version_row.calc_engine_version=1 or is_v3 then projected.tax_rate_bp else i.tax_rate_bp end
  from jsonb_populate_recordset(null::public.estimate_items,p_line_projections) projected
  where i.id=projected.id and i.version_id=p_version_id and i.tenant_id=p_tenant_id and i.item_type='line'
    and row(i.pu_ht_cents,i.line_total_ht_cents,i.line_tax_cents,i.line_total_ttc_cents,i.tax_rate_bp)
      is distinct from row(projected.pu_ht_cents,projected.line_total_ht_cents,projected.line_tax_cents,projected.line_total_ttc_cents,
        case when version_row.calc_engine_version=1 or is_v3 then projected.tax_rate_bp else i.tax_rate_bp end);
  update public.estimate_versions v
  set title=prospective.title,exclusions=prospective.exclusions,date_devis=prospective.date_devis,validite_jours=prospective.validite_jours,
    currency=prospective.currency,margin_multiplier=prospective.margin_multiplier,margin_mode=prospective.margin_mode,margin_bp=prospective.margin_bp,
    discount_bp=prospective.discount_bp,discount_amount_cents=prospective.discount_amount_cents,
    discount_mode=prospective.discount_mode,discount_steps=prospective.discount_steps,
    global_coefficient=prospective.global_coefficient,tax_rate_bp=prospective.tax_rate_bp,contractor_role=prospective.contractor_role,
    rounding_mode=prospective.rounding_mode,rounding_step_cents=prospective.rounding_step_cents,max_section_depth=prospective.max_section_depth,
    total_ht_cents=ht::integer,total_tax_cents=tax::integer,total_ttc_cents=ttc::integer,rounding_adjustment_cents=adjustment::integer,
    sale_coefficient_fo=prospective.sale_coefficient_fo,sale_coefficient_mo=prospective.sale_coefficient_mo,
    gross_ht_cents=case when is_v3 then (p_totals->>'gross_ht_cents')::integer end,
    discount_applied_cents=case when is_v3 then (p_totals->>'discount_applied_cents')::integer end,
    commercial_rounding_cents=case when is_v3 then (p_totals->>'commercial_rounding_cents')::integer end
  where v.id=p_version_id and v.tenant_id=p_tenant_id
    and row(v.title,v.exclusions,v.date_devis,v.validite_jours,v.currency,v.margin_multiplier,v.margin_mode,v.margin_bp,v.discount_bp,v.discount_amount_cents,
      v.discount_mode,v.discount_steps,v.global_coefficient,v.tax_rate_bp,v.contractor_role,v.rounding_mode,v.rounding_step_cents,
      v.max_section_depth,v.total_ht_cents,v.total_tax_cents,v.total_ttc_cents,v.rounding_adjustment_cents,
      v.sale_coefficient_fo,v.sale_coefficient_mo,v.gross_ht_cents,v.discount_applied_cents,v.commercial_rounding_cents)
      is distinct from row(prospective.title,prospective.exclusions,prospective.date_devis,prospective.validite_jours,prospective.currency,
        prospective.margin_multiplier,prospective.margin_mode,prospective.margin_bp,prospective.discount_bp,prospective.discount_amount_cents,prospective.discount_mode,
        prospective.discount_steps,prospective.global_coefficient,prospective.tax_rate_bp,prospective.contractor_role,prospective.rounding_mode,
        prospective.rounding_step_cents,prospective.max_section_depth,ht::integer,tax::integer,ttc::integer,adjustment::integer,
        prospective.sale_coefficient_fo,prospective.sale_coefficient_mo,
        case when is_v3 then (p_totals->>'gross_ht_cents')::integer end,
        case when is_v3 then (p_totals->>'discount_applied_cents')::integer end,
        case when is_v3 then (p_totals->>'commercial_rounding_cents')::integer end);
  if lease_row.expires_at<=clock_timestamp() then
    raise exception using errcode='40001',message='ESTIMATE_DRAFT_LOCK_REQUIRED';
  end if;
  if is_v3 then
    perform public.estimate_v3_assert_draft_for_writer(p_version_id);
    perform pg_catalog.set_config('miaouffrage.estimate_v3_writer',previous_v3_writer,true);
  end if;
  perform pg_catalog.set_config('miaouffrage.estimate_settings_atomic',coalesce(previous_marker,''),true);
  select v.* into version_row from public.estimate_versions v where v.id=p_version_id and v.tenant_id=p_tenant_id;
  select coalesce(jsonb_agg(to_jsonb(i) order by i.position,i.id),'[]') into all_items from public.estimate_items i
  where i.version_id=p_version_id and i.tenant_id=p_tenant_id;
  return jsonb_build_object('version',to_jsonb(version_row),'items',all_items);
exception when lock_not_available or deadlock_detected then
  raise exception using errcode='40001',message='ESTIMATE_VERSION_CONFLICT';
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
    raise exception using errcode='22023',message='ESTIMATE_SETTINGS_INVALID_INPUT';
end;
$function$
;


-- Duplication (I4, P-15) : le moteur suit la source, quelle que soit la politique ; une v3 est
-- copiée par le contrat duplicate_source_v3, colonnes v3 comprises, lignes sous le contrat
-- d'écrivain (article lié copié : la mise à jour de duplicate_estimate_version devient neutre).
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


-- File d'approbation (D5, F20) : marque nette v3 = ⌈(HT − Σ D) × 10 000 / HT⌋ (demi supérieur,
-- comme computeEstimateV3NetMarginBp) lue sur un gel v3 frais ; sinon NULL, jamais 0 inventé.
-- Le texte « version.calc_engine_version = 1 » de la branche v1 reste inchangé.
CREATE OR REPLACE FUNCTION public.list_approval_queue(p_sort_by text DEFAULT 'priority'::text)
 RETURNS TABLE(project_id uuid, version_id uuid, cycle_id uuid, project_name text, client_name text, version_number integer, amount_ht_cents bigint, margin_bp integer, requested_at timestamp with time zone, submission_message text, comment_count bigint, reviewer_state text, exception_count bigint, max_risk_score integer, cause_code_counts jsonb, latest_job_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_user_id uuid := auth.uid();
  scoped_tenant_id uuid := public.current_tenant_id();
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  if scoped_tenant_id is null then
    raise exception using errcode = '42501', message = 'TENANT_CONTEXT_REQUIRED';
  end if;

  if not (
    select public.has_tenant_role(
      scoped_tenant_id,
      array['admin'::public.tenant_role, 'director'::public.tenant_role]
    )
  ) then
    raise exception using errcode = '42501', message = 'APPROVAL_QUEUE_ACCESS_DENIED';
  end if;

  return query
  with open_cycles as (
    select
      cycle.id as cycle_id,
      cycle.version_id,
      cycle.requested_at,
      cycle.submission_message,
      cycle.tenant_id
    from public.estimate_review_cycles cycle
    where cycle.decision is null
      and cycle.superseded_at is null
      and cycle.tenant_id = scoped_tenant_id
  ),
  cycle_versions as (
    select
      open_cycle.cycle_id,
      open_cycle.requested_at,
      open_cycle.submission_message,
      version.id as version_id,
      version.project_id,
      version.version_number,
      version.total_ht_cents::bigint as amount_ht_cents,
      case
        when version.calc_engine_version = 1 then version.margin_bp
        -- Lot 2, sub-lot 2.5 (M4): the v3 net markup from a fresh v3 freeze, else unavailable.
        when version.calc_engine_version = 3 then case
          when version.calc_snapshot_content_revision = version.content_revision
            and version.calc_snapshot_context->'engine' = '3'::jsonb
            and jsonb_typeof(version.calc_snapshot_context->'cost_subtotal_cents') = 'number'
            and version.total_ht_cents > 0
          then greatest(-2147483648, least(2147483647, floor(
            (
              2 * (
                version.total_ht_cents::numeric
                - (version.calc_snapshot_context->>'cost_subtotal_cents')::numeric
              ) * 10000 + version.total_ht_cents
            ) / (2 * version.total_ht_cents::numeric)
          )))::integer
          else null
        end
        when version.calc_engine_version <> 2 then null
        when version.calc_snapshot_content_revision = version.content_revision
          and jsonb_typeof(
          version.calc_snapshot_context->'effective_margin_multiplier'
        ) = 'number'
          and (
            version.calc_snapshot_context->>'effective_margin_multiplier'
          )::numeric > 0
        then greatest(
          0,
          round(
            (
              1 - 1 / (
                version.calc_snapshot_context->>
                  'effective_margin_multiplier'
              )::numeric
            ) * 10000
          )::integer
        )
        else null
      end as margin_bp
    from open_cycles open_cycle
    join public.estimate_versions version
      on version.id = open_cycle.version_id
     and version.tenant_id = open_cycle.tenant_id
  ),
  with_project as (
    select
      cycle_version.*,
      project.name as project_name,
      project.client_name
    from cycle_versions cycle_version
    join public.estimate_projects project
      on project.id = cycle_version.project_id
  ),
  comments_agg as (
    select
      comment.cycle_id,
      count(*) as comment_count
    from public.estimate_review_comments comment
    join open_cycles open_cycle on open_cycle.cycle_id = comment.cycle_id
    group by comment.cycle_id
  ),
  reviewer_states as (
    select
      queue_state.cycle_id,
      queue_state.state as reviewer_state
    from public.approval_queue_reviewer_states queue_state
    where queue_state.tenant_id = scoped_tenant_id
      and queue_state.reviewer_id = current_user_id
  ),
  risk_agg as (
    select
      risk.version_id,
      sum(risk.cnt)::bigint as exception_count,
      max(risk.max_cause_risk_score) as max_risk_score,
      jsonb_object_agg(risk.cause_code, risk.cnt) as cause_code_counts
    from (
      select
        alert.version_id,
        alert.cause_code,
        count(*) as cnt,
        max(alert.risk_score) as max_cause_risk_score
      from public.estimate_risk_alerts alert
      join open_cycles open_cycle
        on open_cycle.version_id = alert.version_id
      where alert.is_active
        and alert.status = 'to_process'
        and alert.tenant_id = scoped_tenant_id
      group by alert.version_id, alert.cause_code
    ) risk
    group by risk.version_id
  ),
  latest_jobs as (
    select distinct on (job.estimate_version_id)
      job.estimate_version_id as version_id,
      job.id as latest_job_id
    from public.takeoff_jobs job
    join open_cycles open_cycle
      on open_cycle.version_id = job.estimate_version_id
    where job.status in ('completed', 'applied')
    order by
      job.estimate_version_id,
      job.completed_at desc nulls last
  )
  select
    scoped_project.project_id,
    scoped_project.version_id,
    scoped_project.cycle_id,
    scoped_project.project_name,
    scoped_project.client_name,
    scoped_project.version_number,
    scoped_project.amount_ht_cents,
    scoped_project.margin_bp,
    scoped_project.requested_at,
    scoped_project.submission_message,
    coalesce(comment_totals.comment_count, 0) as comment_count,
    reviewer_state.reviewer_state,
    coalesce(risk_totals.exception_count, 0) as exception_count,
    coalesce(risk_totals.max_risk_score, 0) as max_risk_score,
    coalesce(risk_totals.cause_code_counts, '{}'::jsonb) as cause_code_counts,
    latest_job.latest_job_id
  from with_project scoped_project
  left join comments_agg comment_totals
    on comment_totals.cycle_id = scoped_project.cycle_id
  left join reviewer_states reviewer_state
    on reviewer_state.cycle_id = scoped_project.cycle_id
  left join risk_agg risk_totals
    on risk_totals.version_id = scoped_project.version_id
  left join latest_jobs latest_job
    on latest_job.version_id = scoped_project.version_id
  order by
    case
      when p_sort_by = 'priority'
        then coalesce(risk_totals.max_risk_score, 0)
    end desc nulls last,
    case
      when p_sort_by = 'priority' then scoped_project.requested_at
    end asc,
    case
      when p_sort_by = 'amount' then scoped_project.amount_ht_cents
    end desc nulls last,
    case
      when p_sort_by = 'margin' then scoped_project.margin_bp
    end asc nulls last,
    case
      when p_sort_by = 'age' then scoped_project.requested_at
    end asc,
    scoped_project.requested_at asc;
end;
$function$
;

-- ---------------------------------------------------------------------------
-- 6. Gel v3 (D12, D15, §6.5). Signature de la jumelle v2, service_role seul ; les gels v2
-- restent textuellement intacts. Recalcul complet, égalité au centime de chaque valeur
-- figée (répartitions comprises), unité exigée sur une ligne chiffrée, taux autorisés par la
-- politique ; écrit les colonnes figées, le PU publié, le pied v3 et le contexte §6.5.
-- ---------------------------------------------------------------------------
create function public.freeze_estimate_v3_snapshot(
  p_version_id uuid,
  p_tenant_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_content_revision bigint,
  p_actor_user_id uuid,
  p_purpose text,
  p_calculation_context jsonb,
  p_item_snapshots jsonb,
  p_version_totals jsonb
)
returns public.estimate_versions
language plpgsql
set search_path = ''
as $$
declare
  target_version public.estimate_versions%rowtype;
  project_owner_id uuid;
  actor_role public.tenant_role;
  allowed_tax_rates integer[];
  previous_v3_writer text;
  computed jsonb;
  expected_context jsonb;
  expected_items jsonb;
  submitted_items jsonb;
  expected_totals jsonb;
  frozen_version public.estimate_versions;
begin
  if current_user <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'SERVICE_ROLE_REQUIRED';
  end if;

  if p_purpose is null or p_purpose not in ('send', 'approval') then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V3_SNAPSHOT_PURPOSE_INVALID';
  end if;

  select version.*
    into target_version
  from public.estimate_versions version
  join public.estimate_projects project
    on project.id = version.project_id
   and project.tenant_id = version.tenant_id
  join public.tenants tenant
    on tenant.id = version.tenant_id
   and tenant.is_active
  join public.tenant_memberships membership
    on membership.tenant_id = version.tenant_id
   and membership.user_id = p_actor_user_id
  where version.id = p_version_id
    and version.tenant_id = p_tenant_id
  for update of version;

  select project.user_id, membership.role
    into project_owner_id, actor_role
  from public.estimate_projects project
  join public.tenants tenant
    on tenant.id = project.tenant_id
   and tenant.is_active
  join public.tenant_memberships membership
    on membership.tenant_id = project.tenant_id
   and membership.user_id = p_actor_user_id
  where project.id = target_version.project_id
    and project.tenant_id = target_version.tenant_id
  for share of project, tenant, membership;

  if target_version.id is null
    or actor_role is null
    or actor_role not in (
      'admin'::public.tenant_role,
      'engineer'::public.tenant_role
    )
    or (
      project_owner_id <> p_actor_user_id
      and actor_role <> 'admin'::public.tenant_role
    )
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_V3_SNAPSHOT_NOT_WRITABLE';
  end if;

  if p_purpose = 'send' and not exists (
      select 1
      from public.draft_locks lock
      where lock.version_id = target_version.id
        and lock.tenant_id = target_version.tenant_id
        and lock.user_id = p_actor_user_id
        and lock.expires_at > statement_timestamp()
    ) then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_DRAFT_LOCK_REQUIRED';
  end if;

  if p_purpose = 'approval' and exists (
      select 1
      from public.draft_locks lock
      where lock.version_id = target_version.id
        and lock.tenant_id = target_version.tenant_id
        and lock.user_id <> p_actor_user_id
        and lock.expires_at > statement_timestamp()
    ) then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_DRAFT_LOCK_CONFLICT';
  end if;

  if target_version.updated_at is distinct from p_expected_updated_at
    or target_version.content_revision is distinct from p_expected_content_revision
  then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_VERSION_CONFLICT';
  end if;

  if target_version.status <> 'draft'::public.estimate_status
    or target_version.calc_engine_version <> 3
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_V3_SNAPSHOT_REQUIRES_DRAFT';
  end if;

  if jsonb_typeof(p_calculation_context) is distinct from 'object'
    or jsonb_typeof(p_item_snapshots) is distinct from 'array'
    or jsonb_typeof(p_version_totals) is distinct from 'object'
    or exists (
      select 1
      from jsonb_array_elements(p_item_snapshots) snapshot(value)
      where jsonb_typeof(snapshot.value) is distinct from 'object'
        or jsonb_typeof(snapshot.value -> 'id') is distinct from 'string'
        or (snapshot.value ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V3_SNAPSHOT_INVALID';
  end if;

  perform role.id
  from public.labor_roles role
  where role.id in (
    select referenced.role_id
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
    where referenced.role_id is not null
  )
  order by role.id
  for share of role;

  if exists (
    select 1
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
    where referenced.role_id is not null
      and role.id is null
  ) then
    raise exception using
      errcode = '23503',
      message = 'ESTIMATE_LABOR_ROLE_OWNER_MISMATCH';
  end if;

  perform flag.id
  from public.feature_flags flag
  where flag.tenant_id = target_version.tenant_id
    and flag.flag_key = 'EST_031_LABOR_SPLIT'
  for share;

  -- Heures sans rôle : la MO serait chiffrée à 0 en silence (même règle que le gel v2, sur les
  -- heures par unité d'une ligne chiffrée).
  if exists (
    select 1
    from public.estimate_items item
    cross join lateral (
      select coalesce((
        select bool_or(flag.enabled)
        from public.feature_flags flag
        where flag.tenant_id = target_version.tenant_id
          and flag.flag_key = 'EST_031_LABOR_SPLIT'
      ), false) and (
        coalesce(item.h_mo_atelier_per_unit, 0) > 0
        or item.labor_role_atelier_id is not null
        or coalesce(item.h_mo_chantier_per_unit, 0) > 0
        or item.labor_role_chantier_id is not null
        or coalesce(item.k_mo_atelier, 1) <> 1
        or coalesce(item.k_mo_chantier, 1) <> 1
      ) as use_split
    ) calculation_mode
    where item.version_id = target_version.id
      and item.tenant_id = target_version.tenant_id
      and item.item_type = 'line'::public.estimate_item_type
      and item.pricing_status = 'priced'::public.estimate_line_pricing_status
      and (
        (
          not calculation_mode.use_split
          and coalesce(item.h_mo_per_unit, 0) > 0
          and item.labor_role_id is null
        )
        or (
          calculation_mode.use_split
          and (
            (coalesce(item.h_mo_atelier_per_unit, 0) > 0 and item.labor_role_atelier_id is null)
            or (coalesce(item.h_mo_chantier_per_unit, 0) > 0 and item.labor_role_chantier_id is null)
          )
        )
      )
  ) then
    raise exception using
      errcode = '23502',
      message = 'ESTIMATE_V3_LABOR_ROLE_REQUIRED';
  end if;

  -- D9 : unité obligatoire au gel d'une ligne chiffrée (un brouillon peut rester incomplet).
  if exists (
    select 1
    from public.estimate_items item
    where item.version_id = target_version.id
      and item.tenant_id = target_version.tenant_id
      and item.item_type = 'line'::public.estimate_item_type
      and item.pricing_status = 'priced'::public.estimate_line_pricing_status
      and item.unit_code is null
  ) then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V3_UNIT_REQUIRED';
  end if;

  -- D8 : taux autorisés par la politique (absente : liste par défaut de §6.3).
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('estimate-calc-policy:' || target_version.tenant_id::text, 0)
  );
  select policy.allowed_tax_rates_bp
    into allowed_tax_rates
  from public.tenant_calc_policies policy
  where policy.tenant_id = target_version.tenant_id
  for share;
  allowed_tax_rates := coalesce(allowed_tax_rates, '{2000,1000,550,210}'::integer[]);

  if exists (
    select 1
    from public.estimate_items item
    where item.version_id = target_version.id
      and item.tenant_id = target_version.tenant_id
      and item.item_type = 'line'::public.estimate_item_type
      and item.pricing_status = 'priced'::public.estimate_line_pricing_status
      and not (item.tax_rate_bp = any(allowed_tax_rates))
  ) then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V3_TAX_RATE_NOT_ALLOWED';
  end if;

  previous_v3_writer := coalesce(
    pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true),
    ''
  );
  perform pg_catalog.set_config(
    'miaouffrage.estimate_v3_writer',
    target_version.id::text,
    true
  );

  computed := public.estimate_v3_compute_for_writer(target_version.id);

  expected_context := jsonb_build_object(
    'engine', 3,
    'labor_split_enabled', computed -> 'params' -> 'labor_split_enabled',
    'labor_roles', computed -> 'labor_roles',
    'sale_coefficients', jsonb_build_object(
      'fo', computed -> 'params' -> 'sale_coefficient_fo',
      'mo', computed -> 'params' -> 'sale_coefficient_mo'
    ),
    'discount', jsonb_build_object(
      'kind', case
        when target_version.discount_amount_cents is not null then 'amount'
        when target_version.discount_bp > 0 then 'rate'
        else 'none'
      end,
      'requested_cents', target_version.discount_amount_cents,
      'rate_bp', case
        when target_version.discount_amount_cents is null and target_version.discount_bp > 0
          then target_version.discount_bp
      end,
      'base_cents', computed -> 'totals' -> 'gross_ht_cents',
      'applied_cents', computed -> 'totals' -> 'discount_applied_cents'
    ),
    'commercial_rounding', jsonb_build_object(
      'mode', target_version.rounding_mode::text,
      'step_cents', target_version.rounding_step_cents,
      'applied_cents', computed -> 'totals' -> 'commercial_rounding_cents'
    ),
    'cost_subtotal_cents', computed -> 'totals' -> 'cost_subtotal_cents',
    'realized_sale_coefficient', (computed -> 'totals' ->> 'realized_sale_coefficient')::numeric,
    'tax_breakdown', computed -> 'totals' -> 'tax_breakdown'
  );

  if p_calculation_context is distinct from expected_context then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_V3_CALCULATION_CONTEXT_CONFLICT';
  end if;

  select coalesce(jsonb_object_agg(line.value ->> 'id', jsonb_build_object(
      'snapshot_pu_ht_cents', line.value -> 'pu_ht_cents',
      'snapshot_gross_ht_cents', line.value -> 'gross_ht_cents',
      'snapshot_gross_fo_ht_cents', line.value -> 'gross_fo_ht_cents',
      'snapshot_fo_ht_cents', line.value -> 'snapshot_fo_ht_cents',
      'snapshot_mo_ht_cents', line.value -> 'snapshot_mo_ht_cents',
      'snapshot_mo_atelier_ht_cents', line.value -> 'snapshot_mo_atelier_ht_cents',
      'snapshot_mo_chantier_ht_cents', line.value -> 'snapshot_mo_chantier_ht_cents',
      'line_total_ht_cents', line.value -> 'line_total_ht_cents',
      'line_tax_cents', line.value -> 'line_tax_cents',
      'line_total_ttc_cents', line.value -> 'line_total_ttc_cents'
    )), '{}'::jsonb)
    into expected_items
  from jsonb_array_elements(computed -> 'lines') line(value);

  select coalesce(jsonb_object_agg(lower(snapshot.value ->> 'id'), snapshot.value - 'id'), '{}'::jsonb)
    into submitted_items
  from jsonb_array_elements(p_item_snapshots) snapshot(value);

  expected_totals := jsonb_build_object(
    'gross_ht_cents', computed -> 'totals' -> 'gross_ht_cents',
    'discount_applied_cents', computed -> 'totals' -> 'discount_applied_cents',
    'commercial_rounding_cents', computed -> 'totals' -> 'commercial_rounding_cents',
    'total_ht_cents', computed -> 'totals' -> 'total_ht_cents',
    'total_tax_cents', computed -> 'totals' -> 'total_tax_cents',
    'total_ttc_cents', computed -> 'totals' -> 'total_ttc_cents',
    'rounding_adjustment_cents', 0
  );

  if (select count(distinct lower(snapshot.value ->> 'id')) from jsonb_array_elements(p_item_snapshots) snapshot(value))
      <> jsonb_array_length(p_item_snapshots)
    or submitted_items is distinct from expected_items
    or p_version_totals is distinct from expected_totals
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V3_PROJECTION_MISMATCH';
  end if;

  if target_version.calc_snapshot_content_revision = target_version.content_revision
    and target_version.calc_snapshot_context = p_calculation_context
    and target_version.gross_ht_cents = (expected_totals ->> 'gross_ht_cents')::integer
    and target_version.discount_applied_cents = (expected_totals ->> 'discount_applied_cents')::integer
    and target_version.commercial_rounding_cents = (expected_totals ->> 'commercial_rounding_cents')::integer
    and target_version.total_ht_cents = (expected_totals ->> 'total_ht_cents')::integer
    and target_version.total_tax_cents = (expected_totals ->> 'total_tax_cents')::integer
    and target_version.total_ttc_cents = (expected_totals ->> 'total_ttc_cents')::integer
    and not exists (
      select 1
      from public.estimate_items item
      join jsonb_array_elements(computed -> 'lines') line(value)
        on (line.value ->> 'id')::uuid = item.id
      where item.version_id = target_version.id
        and item.tenant_id = target_version.tenant_id
        and (
          item.pu_ht_cents is distinct from (line.value ->> 'pu_ht_cents')::integer
          or item.snapshot_pu_ht_cents is distinct from (line.value ->> 'pu_ht_cents')::integer
          or item.snapshot_gross_ht_cents is distinct from (line.value ->> 'gross_ht_cents')::integer
          or item.snapshot_gross_fo_ht_cents is distinct from (line.value ->> 'gross_fo_ht_cents')::integer
          or item.snapshot_fo_ht_cents is distinct from (line.value ->> 'snapshot_fo_ht_cents')::integer
          or item.snapshot_mo_ht_cents is distinct from (line.value ->> 'snapshot_mo_ht_cents')::integer
          or item.snapshot_mo_atelier_ht_cents is distinct from (line.value ->> 'snapshot_mo_atelier_ht_cents')::integer
          or item.snapshot_mo_chantier_ht_cents is distinct from (line.value ->> 'snapshot_mo_chantier_ht_cents')::integer
          or item.line_total_ht_cents is distinct from (line.value ->> 'line_total_ht_cents')::integer
          or item.line_tax_cents is distinct from (line.value ->> 'line_tax_cents')::integer
          or item.line_total_ttc_cents is distinct from (line.value ->> 'line_total_ttc_cents')::integer
        )
    )
  then
    perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', previous_v3_writer, true);
    return target_version;
  end if;

  perform pg_catalog.set_config(
    'miaouffrage.estimate_v2_snapshot_freeze',
    'on',
    true
  );

  update public.estimate_items item
  set
    pu_ht_cents = (line.value ->> 'pu_ht_cents')::integer,
    snapshot_pu_ht_cents = (line.value ->> 'pu_ht_cents')::integer,
    snapshot_gross_ht_cents = (line.value ->> 'gross_ht_cents')::integer,
    snapshot_gross_fo_ht_cents = (line.value ->> 'gross_fo_ht_cents')::integer,
    snapshot_fo_ht_cents = (line.value ->> 'snapshot_fo_ht_cents')::integer,
    snapshot_mo_ht_cents = (line.value ->> 'snapshot_mo_ht_cents')::integer,
    snapshot_mo_atelier_ht_cents = (line.value ->> 'snapshot_mo_atelier_ht_cents')::integer,
    snapshot_mo_chantier_ht_cents = (line.value ->> 'snapshot_mo_chantier_ht_cents')::integer,
    line_total_ht_cents = (line.value ->> 'line_total_ht_cents')::integer,
    line_tax_cents = (line.value ->> 'line_tax_cents')::integer,
    line_total_ttc_cents = (line.value ->> 'line_total_ttc_cents')::integer
  from jsonb_array_elements(computed -> 'lines') line(value)
  where item.id = (line.value ->> 'id')::uuid
    and item.version_id = target_version.id
    and item.tenant_id = target_version.tenant_id;

  update public.estimate_versions version
  set
    gross_ht_cents = (expected_totals ->> 'gross_ht_cents')::integer,
    discount_applied_cents = (expected_totals ->> 'discount_applied_cents')::integer,
    commercial_rounding_cents = (expected_totals ->> 'commercial_rounding_cents')::integer,
    total_ht_cents = (expected_totals ->> 'total_ht_cents')::integer,
    total_tax_cents = (expected_totals ->> 'total_tax_cents')::integer,
    total_ttc_cents = (expected_totals ->> 'total_ttc_cents')::integer,
    calc_snapshot_context = p_calculation_context
  where version.id = target_version.id
    and version.tenant_id = target_version.tenant_id
  returning version.* into frozen_version;

  update public.estimate_versions version
  set calc_snapshot_content_revision = version.content_revision
  where version.id = frozen_version.id
    and version.tenant_id = frozen_version.tenant_id
  returning version.* into frozen_version;

  perform pg_catalog.set_config(
    'miaouffrage.estimate_v2_snapshot_freeze',
    'off',
    true
  );
  perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', previous_v3_writer, true);

  if frozen_version.id is null then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_VERSION_CONFLICT';
  end if;

  return frozen_version;
end;
$$;

comment on function public.freeze_estimate_v3_snapshot(uuid, uuid, timestamptz, bigint, uuid, text, jsonb, jsonb, jsonb) is
  'Engine 3 calculation freeze (D12, D15, §6.5), twin signature of freeze_estimate_v2_snapshot, service_role only: full SQL recomputation, exact equality of every frozen value (ESTIMATE_V3_PROJECTION_MISMATCH), unit on priced lines (ESTIMATE_V3_UNIT_REQUIRED), VAT rates allowed by the tenant policy (ESTIMATE_V3_TAX_RATE_NOT_ALLOWED).';

revoke all on function public.freeze_estimate_v3_snapshot(uuid, uuid, timestamptz, bigint, uuid, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.freeze_estimate_v3_snapshot(uuid, uuid, timestamptz, bigint, uuid, text, jsonb, jsonb, jsonb)
  to service_role;
