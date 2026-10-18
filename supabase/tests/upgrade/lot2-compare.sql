-- Lot 2, sous-lot 2.0 : capture et comparaison du test de montée de version sur base peuplée
-- (conception du lot 2, §10.2, étapes 3, 5 et 6).
--
-- Installé par `scripts/engine-v3/upgrade-check.ts` après `lot2-fixture.sql`, avant les
-- migrations postérieures à la base publiée. Ce fichier ne crée que le schéma
-- `upgrade_check` de la pile jetable ; il ne touche ni `public` ni les données.
--
--   upgrade_check.capture(label)          enregistre to_jsonb de chaque ligne de l'entreprise
--                                         de la fixture, l'inventaire des colonnes et les
--                                         contrôles SQL du dépôt ('before', 'after', 'negative') ;
--   upgrade_check.compare(avant, après)   rend les différences, en JSON ;
--   upgrade_check.apply_negative_control() modifie UNE valeur hors migration et rend la
--                                         différence que la comparaison doit trouver.
--
-- Une colonne ajoutée par une migration est retirée de la comparaison des lignes, mais elle
-- doit être déclarée dans `upgrade_check.declared_new_columns()` avec sa valeur neutre, et
-- chaque ligne existante doit porter cette valeur. Une colonne ajoutée sans déclaration, une
-- colonne retirée ou un type modifié sont des différences.

begin;

create schema if not exists upgrade_check;
revoke all on schema upgrade_check from public, anon, authenticated;

create table if not exists upgrade_check.captured_columns (
  label text not null,
  table_name text not null,
  column_name text not null,
  data_type text not null,
  primary key (label, table_name, column_name)
);

create table if not exists upgrade_check.captured_rows (
  label text not null,
  table_name text not null,
  row_key text not null,
  row_data jsonb not null,
  primary key (label, table_name, row_key)
);

create table if not exists upgrade_check.captured_checks (
  label text not null,
  check_name text not null,
  result jsonb not null,
  primary key (label, check_name)
);

alter table upgrade_check.captured_columns enable row level security;
alter table upgrade_check.captured_rows enable row level security;
alter table upgrade_check.captured_checks enable row level security;

create or replace function upgrade_check.fixture_tenant_id()
returns uuid
language sql
immutable
set search_path = ''
as $$
  select 'b2000000-0000-4000-8000-000000000010'::uuid
$$;

-- Tables comparées : celles du §10.2 (versions, lignes, documents, envois, jetons de portail,
-- offres, modèles) et les entrées de calcul de l'entreprise (taux, paliers, drapeaux).
create or replace function upgrade_check.scoped_tables()
returns table (table_name text, scope_column text)
language sql
immutable
set search_path = ''
as $$
  values
    ('tenants', 'id'),
    ('tenant_memberships', 'tenant_id'),
    ('feature_flags', 'tenant_id'),
    ('labor_roles', 'tenant_id'),
    ('margin_tiers', 'tenant_id'),
    ('suppliers', 'tenant_id'),
    ('products', 'tenant_id'),
    ('supplier_catalog_items', 'tenant_id'),
    ('supplier_pricebook', 'tenant_id'),
    ('estimate_projects', 'tenant_id'),
    ('estimate_versions', 'tenant_id'),
    ('estimate_items', 'tenant_id'),
    ('estimate_documents', 'tenant_id'),
    ('estimate_emails', 'tenant_id'),
    ('portal_tokens', 'tenant_id'),
    ('estimate_templates', 'tenant_id'),
    ('estimate_template_items', 'tenant_id')
$$;

-- Colonnes nouvelles admises, avec leur valeur neutre attendue sur les lignes existantes.
-- Chaque migration du lot 2 qui ajoute une colonne à une table comparée l'ajoute ici, par
-- exemple : ('estimate_versions', 'sale_coefficient_fo', 'null').
-- Sous-lot 2.2 (20261017093407) : aucune offre existante n'est marquée « inclus / gratuit ».
-- Sous-lot 2.5 (M4, 20261017162000) : colonnes v3 nulles sur toute version et toute ligne
-- existantes (v1/v2, D17), statut de ligne au défaut constant « priced ».
create or replace function upgrade_check.declared_new_columns()
returns table (table_name text, column_name text, neutral_value jsonb)
language sql
immutable
set search_path = ''
as $$
  select declared.table_name, declared.column_name, declared.neutral_value
  from (values
    ('supplier_pricebook'::text, 'zero_price_kind'::text, 'null'::jsonb),
    -- Sous-lot 2.9 (20261017172127) : aucune offre existante ne porte de conversion d'unité d'achat.
    ('supplier_pricebook', 'estimate_unit_code', 'null'::jsonb),
    ('supplier_pricebook', 'estimate_units_per_purchase_unit', 'null'::jsonb),
    ('supplier_pricebook', 'purchase_rounding', 'null'::jsonb),
    ('estimate_versions', 'sale_coefficient_fo', 'null'),
    ('estimate_versions', 'sale_coefficient_mo', 'null'),
    ('estimate_versions', 'gross_ht_cents', 'null'),
    ('estimate_versions', 'discount_applied_cents', 'null'),
    ('estimate_versions', 'commercial_rounding_cents', 'null'),
    ('estimate_items', 'unit_code', 'null'),
    ('estimate_items', 'pricing_status', '"priced"'),
    ('estimate_items', 'h_mo_per_unit', 'null'),
    ('estimate_items', 'h_mo_atelier_per_unit', 'null'),
    ('estimate_items', 'h_mo_chantier_per_unit', 'null'),
    ('estimate_items', 'snapshot_gross_ht_cents', 'null'),
    ('estimate_items', 'snapshot_gross_fo_ht_cents', 'null'),
    -- Sous-lot 2.8 (M6, 20261017225906) : colonnes v3 nulles sur tout modèle existant, statut au
    -- défaut constant « priced » (P-12) ; coefficients de vente des modèles nuls (D5).
    ('estimate_template_items', 'unit_code', 'null'),
    ('estimate_template_items', 'pricing_status', '"priced"'),
    ('estimate_template_items', 'h_mo_per_unit', 'null'),
    ('estimate_template_items', 'h_mo_atelier_per_unit', 'null'),
    ('estimate_template_items', 'h_mo_chantier_per_unit', 'null'),
    ('estimate_templates', 'sale_coefficient_fo', 'null'),
    ('estimate_templates', 'sale_coefficient_mo', 'null')
  ) as declared(table_name, column_name, neutral_value)
$$;

-- Les scénarios de la fixture ; leur absence avant migration rend la capture invalide.
create or replace function upgrade_check.fixture_anchors()
returns table (anchor text, table_name text, row_key text)
language sql
immutable
set search_path = ''
as $$
  values
    ('A1 v1 envoyée et scellée', 'estimate_versions', 'b2000000-0000-4000-8000-000000000101'),
    ('A2 v1 brouillon', 'estimate_versions', 'b2000000-0000-4000-8000-000000000102'),
    ('B1 v2 envoyée (contrat client 1, sceau 5)', 'estimate_versions', 'b2000000-0000-4000-8000-000000000201'),
    ('B1 document du contrat client 1', 'estimate_documents', 'b2000000-0000-4000-8000-000000000302'),
    ('B1 envoi', 'estimate_emails', 'b2000000-0000-4000-8000-000000000312'),
    ('B1 jeton de portail', 'portal_tokens', 'b2000000-0000-4000-8000-000000000322'),
    ('B2 v2 brouillon à remise fixe', 'estimate_versions', 'b2000000-0000-4000-8000-000000000202'),
    ('B3 v2 brouillon à paliers', 'estimate_versions', 'b2000000-0000-4000-8000-000000000203'),
    ('O offre à 0 €', 'supplier_pricebook', 'b2000000-0000-4000-8000-000000000033'),
    ('T modèle', 'estimate_templates', 'b2000000-0000-4000-8000-000000000401')
$$;

-- Un contrôle qui échoue après migration (fonction retirée ou signature changée) devient une
-- valeur comparable au lieu d'interrompre la capture.
create or replace function upgrade_check.try_eval(p_sql text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  value jsonb;
begin
  execute p_sql into value;
  return coalesce(value, 'null'::jsonb);
exception when others then
  return jsonb_build_object('error', sqlstate, 'message', sqlerrm);
end;
$$;

create or replace function upgrade_check.evaluate_checks()
returns table (check_name text, result jsonb)
language plpgsql
set search_path = ''
as $$
declare
  document_id uuid;
  dispatch_id uuid;
  document_query constant text :=
    'from public.estimate_documents document join public.estimate_versions version '
    || 'on version.id = document.version_id and version.tenant_id = document.tenant_id '
    || 'where document.id = %L';
begin
  for document_id in
    select document.id
    from public.estimate_documents document
    where document.tenant_id = upgrade_check.fixture_tenant_id()
    order by document.id
  loop
    check_name := 'estimate_offer_document_valid(strict) ' || document_id;
    result := upgrade_check.try_eval(format(
      'select to_jsonb(public.estimate_offer_document_valid(document, version, false)) ' || document_query,
      document_id));
    return next;

    check_name := 'estimate_offer_document_valid(legacy) ' || document_id;
    result := upgrade_check.try_eval(format(
      'select to_jsonb(public.estimate_offer_document_valid(document, version, true)) ' || document_query,
      document_id));
    return next;

    check_name := 'estimate_offer_document_proof ' || document_id;
    result := upgrade_check.try_eval(format(
      'select public.estimate_offer_document_proof(document, version) ' || document_query,
      document_id));
    return next;

    check_name := 'estimate_offer_client_valid ' || document_id;
    result := upgrade_check.try_eval(format(
      'select case when document.client_contract_snapshot is null then null else '
      || 'to_jsonb(public.estimate_offer_client_valid(document.client_contract_snapshot, '
      || 'document.layout_options)) end ' || document_query,
      document_id));
    return next;

    check_name := 'estimate_offer_client_items_match ' || document_id;
    result := upgrade_check.try_eval(format(
      'select case when document.client_contract_snapshot is null then null else '
      || 'to_jsonb(public.estimate_offer_client_items_match(document.client_contract_snapshot, '
      || 'version)) end ' || document_query,
      document_id));
    return next;
  end loop;

  for dispatch_id in
    select dispatch.id
    from public.estimate_emails dispatch
    where dispatch.tenant_id = upgrade_check.fixture_tenant_id()
    order by dispatch.id
  loop
    check_name := 'estimate_offer_identity_valid ' || dispatch_id;
    result := upgrade_check.try_eval(format(
      'select case when dispatch.offer_identity_snapshot is null then null else '
      || 'to_jsonb(public.estimate_offer_identity_valid(dispatch.offer_identity_snapshot)) end '
      || 'from public.estimate_emails dispatch where dispatch.id = %L',
      dispatch_id));
    return next;
  end loop;
end;
$$;

create or replace function upgrade_check.capture(p_label text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  scoped record;
  relation regclass;
  captured_count bigint;
  row_counts jsonb := '{}'::jsonb;
  missing text[];
begin
  if p_label is null or p_label not in ('before', 'after', 'negative') then
    raise exception using errcode = '22023', message = 'UPGRADE_CHECK_LABEL_INVALID';
  end if;

  delete from upgrade_check.captured_rows captured where captured.label = p_label;
  delete from upgrade_check.captured_columns captured where captured.label = p_label;
  delete from upgrade_check.captured_checks captured where captured.label = p_label;

  for scoped in select * from upgrade_check.scoped_tables() loop
    relation := pg_catalog.to_regclass(format('public.%I', scoped.table_name));
    if relation is null then
      if p_label = 'before' then
        raise exception using
          errcode = '42P01',
          message = 'UPGRADE_CHECK_TABLE_MISSING',
          detail = scoped.table_name;
      end if;
      row_counts := row_counts || jsonb_build_object(scoped.table_name, null);
      continue;
    end if;

    insert into upgrade_check.captured_columns (label, table_name, column_name, data_type)
    select p_label, scoped.table_name, attribute.attname::text,
      pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = relation
      and attribute.attnum > 0
      and not attribute.attisdropped;

    execute format(
      'insert into upgrade_check.captured_rows (label, table_name, row_key, row_data) '
      || 'select $1, $2, captured_source.row_data ->> ''id'', captured_source.row_data '
      || 'from (select to_jsonb(source_row) as row_data from public.%I source_row '
      || 'where source_row.%I = $3) captured_source',
      scoped.table_name, scoped.scope_column)
    using p_label, scoped.table_name, upgrade_check.fixture_tenant_id();
    get diagnostics captured_count = row_count;
    row_counts := row_counts || jsonb_build_object(scoped.table_name, captured_count);
  end loop;

  insert into upgrade_check.captured_checks (label, check_name, result)
  select p_label, checks.check_name, checks.result
  from upgrade_check.evaluate_checks() checks;

  if p_label = 'before' then
    select array_agg(anchors.anchor order by anchors.anchor)
    into missing
    from upgrade_check.fixture_anchors() anchors
    where not exists (
      select 1
      from upgrade_check.captured_rows captured
      where captured.label = 'before'
        and captured.table_name = anchors.table_name
        and captured.row_key = anchors.row_key
    );
    if missing is not null then
      raise exception using
        errcode = '23514',
        message = 'UPGRADE_CHECK_FIXTURE_INCOMPLETE',
        detail = array_to_string(missing, '; ');
    end if;
  end if;

  return jsonb_build_object(
    'label', p_label,
    'rows', row_counts,
    'columns', (select count(*) from upgrade_check.captured_columns c where c.label = p_label),
    'checks', (
      select coalesce(jsonb_object_agg(c.check_name, c.result order by c.check_name), '{}'::jsonb)
      from upgrade_check.captured_checks c
      where c.label = p_label
    )
  );
end;
$$;

create or replace function upgrade_check.compare(p_before text, p_after text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  report jsonb;
begin
  if not exists (select 1 from upgrade_check.captured_columns c where c.label = p_before)
    or not exists (select 1 from upgrade_check.captured_columns c where c.label = p_after) then
    raise exception using errcode = '22023', message = 'UPGRADE_CHECK_CAPTURE_MISSING';
  end if;

  with
  before_columns as (
    select c.table_name, c.column_name, c.data_type
    from upgrade_check.captured_columns c where c.label = p_before
  ),
  after_columns as (
    select c.table_name, c.column_name, c.data_type
    from upgrade_check.captured_columns c where c.label = p_after
  ),
  declared as (
    select d.table_name, d.column_name, d.neutral_value
    from upgrade_check.declared_new_columns() d
  ),
  removed_columns as (
    select b.table_name, b.column_name
    from before_columns b
    where not exists (
      select 1 from after_columns a
      where a.table_name = b.table_name and a.column_name = b.column_name
    )
  ),
  added_columns as (
    select a.table_name, a.column_name, a.data_type
    from after_columns a
    where not exists (
      select 1 from before_columns b
      where b.table_name = a.table_name and b.column_name = a.column_name
    )
  ),
  before_rows as (
    select r.table_name, r.row_key, r.row_data
    from upgrade_check.captured_rows r where r.label = p_before
  ),
  after_rows as (
    select r.table_name, r.row_key, r.row_data
    from upgrade_check.captured_rows r where r.label = p_after
  ),
  before_checks as (
    select c.check_name, c.result from upgrade_check.captured_checks c where c.label = p_before
  ),
  after_checks as (
    select c.check_name, c.result from upgrade_check.captured_checks c where c.label = p_after
  ),
  differences (category, table_name, row_key, column_name, detail) as (
    select 1, removed.table_name, null::text, removed.column_name,
      jsonb_build_object('kind', 'column_removed', 'table', removed.table_name,
        'column', removed.column_name)
    from removed_columns removed
    union all
    select 1, b.table_name, null::text, b.column_name,
      jsonb_build_object('kind', 'column_type_changed', 'table', b.table_name,
        'column', b.column_name, 'before', b.data_type, 'after', a.data_type)
    from before_columns b
    join after_columns a on a.table_name = b.table_name and a.column_name = b.column_name
    where a.data_type <> b.data_type
    union all
    select 1, added.table_name, null::text, added.column_name,
      jsonb_build_object('kind', 'column_added_undeclared', 'table', added.table_name,
        'column', added.column_name, 'type', added.data_type)
    from added_columns added
    where not exists (
      select 1 from declared d
      where d.table_name = added.table_name and d.column_name = added.column_name
    )
    union all
    select 2, a.table_name, a.row_key, d.column_name,
      jsonb_build_object('kind', 'column_added_not_neutral', 'table', a.table_name,
        'row', a.row_key, 'column', d.column_name, 'expected', d.neutral_value,
        'actual', a.row_data -> d.column_name)
    from after_rows a
    join added_columns added on added.table_name = a.table_name
    join declared d on d.table_name = added.table_name and d.column_name = added.column_name
    where (a.row_data -> d.column_name) is distinct from d.neutral_value
    union all
    select 3, b.table_name, b.row_key, null::text,
      jsonb_build_object('kind', 'row_removed', 'table', b.table_name, 'row', b.row_key)
    from before_rows b
    where not exists (
      select 1 from after_rows a where a.table_name = b.table_name and a.row_key = b.row_key
    )
    union all
    select 3, a.table_name, a.row_key, null::text,
      jsonb_build_object('kind', 'row_added', 'table', a.table_name, 'row', a.row_key)
    from after_rows a
    where not exists (
      select 1 from before_rows b where b.table_name = a.table_name and b.row_key = a.row_key
    )
    union all
    select 4, b.table_name, b.row_key, field.key,
      jsonb_build_object('kind', 'value_changed', 'table', b.table_name, 'row', b.row_key,
        'column', field.key, 'before', field.value, 'after', a.row_data -> field.key)
    from before_rows b
    join after_rows a on a.table_name = b.table_name and a.row_key = b.row_key
    cross join lateral jsonb_each(b.row_data) field
    where not exists (
        select 1 from removed_columns removed
        where removed.table_name = b.table_name and removed.column_name = field.key
      )
      and (a.row_data -> field.key) is distinct from field.value
    union all
    select 5, null::text, null::text, coalesce(b.check_name, a.check_name),
      jsonb_build_object('kind', 'check_changed', 'check', coalesce(b.check_name, a.check_name),
        'before', b.result, 'after', a.result)
    from before_checks b
    full join after_checks a on a.check_name = b.check_name
    where b.result is distinct from a.result
  )
  select jsonb_build_object(
    'before', p_before,
    'after', p_after,
    'differenceCount', count(*),
    'differences', coalesce(
      jsonb_agg(differences.detail order by differences.category, differences.table_name,
        differences.row_key, differences.column_name),
      '[]'::jsonb)
  )
  into report
  from differences;

  return report;
end;
$$;

-- Contrôle négatif : une mise à jour appliquée hors migration, sans déclencheur, sur le prix
-- unitaire d'une ligne de la v1 envoyée. La comparaison doit la trouver, et elle seule.
create or replace function upgrade_check.apply_negative_control()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  target constant uuid := 'b2000000-0000-4000-8000-000000000112';
  before_value integer;
  after_value integer;
begin
  -- Une instruction SET, pas set_config() : sur la pile Supabase, `postgres` n'est pas
  -- superutilisateur et seul SET de ce paramètre lui est ouvert (supautils).
  execute 'set local session_replication_role = replica';
  update public.estimate_items item
  set pu_ht_cents = item.pu_ht_cents + 1
  where item.id = target
    and item.tenant_id = upgrade_check.fixture_tenant_id()
  returning item.pu_ht_cents - 1, item.pu_ht_cents into before_value, after_value;
  if not found then
    raise exception using errcode = 'P0002', message = 'UPGRADE_CHECK_NEGATIVE_CONTROL_TARGET_MISSING';
  end if;
  execute 'set local session_replication_role = origin';

  return jsonb_build_object(
    'kind', 'value_changed',
    'table', 'estimate_items',
    'row', target::text,
    'column', 'pu_ht_cents',
    'before', before_value,
    'after', after_value
  );
end;
$$;

revoke all on all tables in schema upgrade_check from public, anon, authenticated;
revoke all on all functions in schema upgrade_check from public, anon, authenticated;

commit;
