-- Lot 2, sous-lot 2.8 (M6b): the atomic creation of a version replays the per-line effects of its items in one
-- pass (content revision, audit, source coverage, hierarchy depth) instead of firing four triggers per line.
-- A complete OPTIMA lot (~1 021 items) exceeded the 8 s statement timeout of the API roles in CI (IO01).
-- Isolation: the equivalence of revisions and audit rows, and the guards of the session contract, are not
-- observable from a journey. Contract: docs/testing/estimate-engine-v3-2.8.md, « Création atomique ».
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000', '28100000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'estimate-creation-atomic@example.test',
  crypt('test-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
);
update public.tenant_memberships set role = 'engineer'::public.tenant_role
where user_id = '28100000-0000-4000-8000-000000000001';
select set_config('test.tenant_id',
  (select membership.tenant_id::text from public.tenant_memberships membership
   where membership.user_id = '28100000-0000-4000-8000-000000000001' limit 1), true);
insert into public.estimate_projects (id, tenant_id, user_id, name) values
  ('28100000-0000-4000-8000-000000000010', current_setting('test.tenant_id')::uuid,
   '28100000-0000-4000-8000-000000000001', 'EC28 affaire');
-- Lot 2, sub-lot 2.10b (D-i): the reference cases are engine 2. Since M8 a tenant without a policy row creates
-- engine 3, so the tenant starts at the explicit policy 2 (the per-tenant opt-out); the v3 case below moves it to 3.
select public.set_tenant_calc_policy(p_tenant_id => current_setting('test.tenant_id')::uuid,
  p_new_estimate_calc_engine => 2::smallint, p_default_sale_coefficient_fo => null, p_default_sale_coefficient_mo => null,
  p_allowed_tax_rates_bp => null, p_change_reason => 'EC28 v2 (2.10b)', p_actor_user_id => '28100000-0000-4000-8000-000000000001');

create temporary table ec28_outcome (case_name text primary key, outcome text) on commit drop;
grant all on ec28_outcome to service_role, authenticated;

-- One v2 version payload; items: a root section, two sections below it, three lines at 0 €.
create function pg_temp.ec28_version(p_id uuid, p_engine integer default 2) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'title', 'EC28', 'date_devis', current_date, 'validite_jours', 30,
    'margin_multiplier', 1, 'margin_mode', 'fixed', 'currency', 'EUR', 'margin_bp', 0, 'discount_bp', 0,
    'discount_amount_cents', null, 'discount_mode', 'simple', 'discount_steps', '[]'::jsonb, 'global_coefficient', 1,
    'tax_rate_bp', 2000, 'rounding_mode', 'none', 'rounding_step_cents', 1, 'max_section_depth', 3,
    'contractor_role', 'principal', 'calc_engine_version', p_engine,
    'total_ht_cents', 0, 'total_tax_cents', 0, 'total_ttc_cents', 0)
$$;
create function pg_temp.ec28_items(p_prefix text, p_depth integer default 2) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('id', (p_prefix || '01')::uuid, 'parent_id', null, 'item_type', 'section', 'position', 1, 'title', 'Racine'),
    jsonb_build_object('id', (p_prefix || '02')::uuid, 'parent_id', (p_prefix || '01')::uuid, 'item_type', 'section', 'position', 2, 'title', 'Lot A'),
    jsonb_build_object('id', (p_prefix || '03')::uuid, 'parent_id', (p_prefix || case when p_depth > 3 then '02' else '01' end)::uuid,
      'item_type', 'section', 'position', 3, 'title', 'Lot B'),
    jsonb_build_object('id', (p_prefix || '04')::uuid, 'parent_id', (p_prefix || '02')::uuid, 'item_type', 'line', 'position', 4,
      'title', 'Tube', 'description', 'ml', 'quantity', 10, 'unit_price_ht_cents', 0, 'tax_rate_bp', 2000, 'k_fo', 1,
      'h_mo', 0, 'h_mo_majoration', 1, 'k_mo', 1, 'pu_ht_cents', 0, 'line_total_ht_cents', 0, 'line_tax_cents', 0,
      'line_total_ttc_cents', 0, 'source_provider', 'dpgf', 'source_metadata', jsonb_build_object('row_index', 4)),
    jsonb_build_object('id', (p_prefix || '05')::uuid, 'parent_id', (p_prefix || '02')::uuid, 'item_type', 'line', 'position', 5,
      'title', 'Collier', 'description', 'u', 'quantity', 30, 'unit_price_ht_cents', 0, 'tax_rate_bp', 2000, 'k_fo', 1,
      'h_mo', 0, 'h_mo_majoration', 1, 'k_mo', 1, 'pu_ht_cents', 0, 'line_total_ht_cents', 0, 'line_tax_cents', 0,
      'line_total_ttc_cents', 0, 'source_provider', 'dpgf', 'source_metadata', jsonb_build_object('row_index', 5)),
    jsonb_build_object('id', (p_prefix || '06')::uuid, 'parent_id', (p_prefix || '03')::uuid, 'item_type', 'line', 'position', 6,
      'title', 'Vanne', 'description', 'u', 'quantity', 2, 'unit_price_ht_cents', 0, 'tax_rate_bp', 2000, 'k_fo', 1,
      'h_mo', 0, 'h_mo_majoration', 1, 'k_mo', 1, 'pu_ht_cents', 0, 'line_total_ht_cents', 0, 'line_tax_cents', 0,
      'line_total_ttc_cents', 0, 'source_provider', 'dpgf', 'source_metadata', jsonb_build_object('row_index', 6)))
$$;
create function pg_temp.ec28_create(p_version jsonb, p_items jsonb) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
  perform public.persist_estimate_creation_atomic(current_setting('test.tenant_id')::uuid,
    '28100000-0000-4000-8000-000000000001', '28100000-0000-4000-8000-000000000010', null, p_version, p_items, null);
  perform set_config('role', 'none', true);
  return 'ok';
exception when others then
  perform set_config('role', 'none', true);
  return sqlstate || ' ' || sqlerrm;
end
$$;
-- Updates of estimate_versions so far in this transaction: the per-line bump updated the version once per item.
create function pg_temp.ec28_version_updates() returns bigint language sql as $$
  select coalesce(sum(t.n_tup_upd), 0)::bigint from pg_stat_xact_user_tables t
  where t.schemaname = 'public' and t.relname = 'estimate_versions'
$$;
-- A source coverage requirement scoped to the root section of a version and linked to its first line.
create function pg_temp.ec28_requirement(p_id uuid, p_review uuid, p_root uuid, p_line uuid) returns void language sql as $$
  insert into private.estimate_source_coverage_requirements (id, review_id, revision, prescription, expected_service, scope)
  values (p_id, p_review, 1, 'EC28', 'EC28', jsonb_build_object('dpgfLotId', p_root));
  insert into private.estimate_source_coverage_links (id, requirement_id, kind, item_id, justification, target_key)
  values (gen_random_uuid(), p_id, 'line', p_line, 'EC28', 'line:' || p_line::text);
$$;

-- Reference R: the version without items, then the same items written line by line (per-line triggers).
select is(pg_temp.ec28_create(pg_temp.ec28_version('28100000-0000-4000-8000-000000000101'), '[]'::jsonb), 'ok',
  'reference version created empty');
insert into private.estimate_source_reviews (id, tenant_id, project_id, version_id) values
  ('28100000-0000-4000-8000-000000000201', current_setting('test.tenant_id')::uuid,
   '28100000-0000-4000-8000-000000000010', '28100000-0000-4000-8000-000000000101');
select pg_temp.ec28_requirement('28100000-0000-4000-8000-000000000211', '28100000-0000-4000-8000-000000000201',
  '28100000-0000-4000-8100-000000000001', '28100000-0000-4000-8100-000000000004');
select pg_temp.ec28_requirement('28100000-0000-4000-8000-000000000212', '28100000-0000-4000-8000-000000000201',
  '28100000-0000-4000-8200-000000000001', '28100000-0000-4000-8200-000000000004');
select set_config('test.updates_before', pg_temp.ec28_version_updates()::text, true);
select set_config('role', 'service_role', true);
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, description, quantity,
  unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo, pu_ht_cents, line_total_ht_cents, line_tax_cents,
  line_total_ttc_cents, source_provider, source_metadata)
select item.id, current_setting('test.tenant_id')::uuid, '28100000-0000-4000-8000-000000000101', item.parent_id,
  item.item_type, item.position, item.title, item.description, item.quantity, item.unit_price_ht_cents, item.tax_rate_bp,
  item.k_fo, item.h_mo, coalesce(item.h_mo_majoration, 1), item.k_mo, item.pu_ht_cents, item.line_total_ht_cents,
  item.line_tax_cents, item.line_total_ttc_cents, item.source_provider, coalesce(item.source_metadata, '{}'::jsonb)
from jsonb_to_recordset(pg_temp.ec28_items('28100000-0000-4000-8100-0000000000')) as item(id uuid, parent_id uuid,
  item_type public.estimate_item_type, position integer, title text, description text, quantity numeric,
  unit_price_ht_cents integer, tax_rate_bp integer, k_fo numeric, h_mo numeric, h_mo_majoration numeric, k_mo numeric,
  pu_ht_cents integer, line_total_ht_cents integer, line_tax_cents integer, line_total_ttc_cents integer,
  source_provider text, source_metadata jsonb);
select set_config('role', 'none', true);
select set_config('test.updates_reference', (pg_temp.ec28_version_updates()
  - current_setting('test.updates_before')::bigint)::text, true);

-- Candidate C: the atomic creation with the same items.
select set_config('test.updates_before', pg_temp.ec28_version_updates()::text, true);
select is(pg_temp.ec28_create(pg_temp.ec28_version('28100000-0000-4000-8000-000000000102'),
  pg_temp.ec28_items('28100000-0000-4000-8200-0000000000')), 'ok', 'candidate version created with its items');
select set_config('test.updates_candidate', (pg_temp.ec28_version_updates()
  - current_setting('test.updates_before')::bigint)::text, true);

select is(
  current_setting('test.updates_reference') || '|' || current_setting('test.updates_candidate'),
  '6|1',
  'the version takes one content revision update per line written line by line, one for the whole atomic creation'
);

select results_eq(
  $$select id, technical_revision from private.estimate_source_coverage_requirements
    where id in ('28100000-0000-4000-8000-000000000211', '28100000-0000-4000-8000-000000000212') order by id$$,
  $$values ('28100000-0000-4000-8000-000000000211'::uuid, 3::bigint), ('28100000-0000-4000-8000-000000000212', 3)$$,
  'a coverage requirement scoped to or linked with the created items is invalidated as line by line (root, Lot A, line)'
);

select is(
  (select content_revision from public.estimate_versions where id = '28100000-0000-4000-8000-000000000102'),
  (select content_revision from public.estimate_versions where id = '28100000-0000-4000-8000-000000000101'),
  'the content revision of the created version equals the line-by-line one'
);

select is(
  (select to_jsonb(v) - array['id', 'version_number'] from public.estimate_versions v
   where v.id = '28100000-0000-4000-8000-000000000102'),
  (select to_jsonb(v) - array['id', 'version_number'] from public.estimate_versions v
   where v.id = '28100000-0000-4000-8000-000000000101'),
  'the created version row equals the line-by-line one'
);

select results_eq(
  $$select action, user_id, tenant_id, record_id = (after_data ->> 'id')::uuid, before_data is null,
      estimate_version_id = (after_data ->> 'version_id')::uuid,
      (after_data - array['id', 'version_id', 'parent_id'])::text
    from public.audit_logs where table_name = 'estimate_items'
      and estimate_version_id = '28100000-0000-4000-8000-000000000102' order by 7$$,
  $$select action, user_id, tenant_id, record_id = (after_data ->> 'id')::uuid, before_data is null,
      estimate_version_id = (after_data ->> 'version_id')::uuid,
      (after_data - array['id', 'version_id', 'parent_id'])::text
    from public.audit_logs where table_name = 'estimate_items'
      and estimate_version_id = '28100000-0000-4000-8000-000000000101' order by 7$$,
  'the audit rows of the inserted items equal the line-by-line ones'
);

select results_eq(
  $$select action, user_id, tenant_id, estimate_version_id = record_id, record_id = (after_data ->> 'id')::uuid,
      (before_data - array['id', 'version_number'])::text, (after_data - array['id', 'version_number'])::text
    from public.audit_logs where table_name = 'estimate_versions' and action = 'UPDATE'
      and record_id = '28100000-0000-4000-8000-000000000102' order by (after_data ->> 'content_revision')::bigint$$,
  $$select action, user_id, tenant_id, estimate_version_id = record_id, record_id = (after_data ->> 'id')::uuid,
      (before_data - array['id', 'version_number'])::text, (after_data - array['id', 'version_number'])::text
    from public.audit_logs where table_name = 'estimate_versions' and action = 'UPDATE'
      and record_id = '28100000-0000-4000-8000-000000000101' order by (after_data ->> 'content_revision')::bigint$$,
  'the audit rows of the content revision steps equal the line-by-line ones (one per item)'
);

select is(
  coalesce(current_setting('miaouffrage.estimate_creation_atomic', true), '')
    || '|' || coalesce(current_setting('miaouffrage.estimate_creation_replay', true), ''),
  '|',
  'the creation contract is closed after the creation'
);

-- The hierarchy depth refusal is the line-by-line one: a section at level 4 under a depth of 3.
do $depth$
begin
  begin
    perform set_config('role', 'service_role', true);
    insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title)
    values ('28100000-0000-4000-8100-000000000011', current_setting('test.tenant_id')::uuid,
      '28100000-0000-4000-8000-000000000101', '28100000-0000-4000-8100-000000000003', 'section', 7, 'Niveau 3');
    insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title)
    values ('28100000-0000-4000-8100-000000000013', current_setting('test.tenant_id')::uuid,
      '28100000-0000-4000-8000-000000000101', '28100000-0000-4000-8100-000000000011', 'section', 8, 'Niveau 4');
    insert into ec28_outcome values ('depth-line-by-line', 'ok');
  exception when others then
    insert into ec28_outcome values ('depth-line-by-line', sqlstate || ' ' || sqlerrm);
  end;
  perform set_config('role', 'none', true);
end
$depth$;
insert into ec28_outcome values ('depth-atomic', pg_temp.ec28_create(
  pg_temp.ec28_version('28100000-0000-4000-8000-000000000103'),
  pg_temp.ec28_items('28100000-0000-4000-8300-0000000000', 4) || jsonb_build_array(jsonb_build_object(
    'id', '28100000-0000-4000-8300-000000000011', 'parent_id', '28100000-0000-4000-8300-000000000003',
    'item_type', 'section', 'position', 7, 'title', 'Niveau 4'))));

select results_eq(
  $$select outcome from ec28_outcome where case_name in ('depth-atomic', 'depth-line-by-line') order by case_name$$,
  $$values ('P0001 Profondeur de section depassee (max 3).'::text), ('P0001 Profondeur de section depassee (max 3).')$$,
  'a section beyond the version depth is refused with the line-by-line message'
);

-- Guards of the contract: another version, or another operation, never benefits from it.
do $guards$
declare
  audit_before integer;
  revision_before bigint;
begin
  perform set_config('miaouffrage.estimate_creation_atomic', '28100000-0000-4000-8000-000000000102', true);
  perform set_config('role', 'service_role', true);
  select count(*) into audit_before from public.audit_logs where estimate_version_id = '28100000-0000-4000-8000-000000000101';
  select content_revision into revision_before from public.estimate_versions where id = '28100000-0000-4000-8000-000000000101';
  insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title)
  values ('28100000-0000-4000-8100-000000000012', current_setting('test.tenant_id')::uuid,
    '28100000-0000-4000-8000-000000000101', '28100000-0000-4000-8100-000000000001', 'section', 8, 'Autre version');
  insert into ec28_outcome values ('other-version', format('%s|%s',
    (select count(*) from public.audit_logs where estimate_version_id = '28100000-0000-4000-8000-000000000101') - audit_before,
    (select content_revision from public.estimate_versions where id = '28100000-0000-4000-8000-000000000101') - revision_before));
  select count(*) into audit_before from public.audit_logs where estimate_version_id = '28100000-0000-4000-8000-000000000102';
  update public.estimate_items set title = 'Tube renommé' where id = '28100000-0000-4000-8200-000000000004';
  insert into ec28_outcome values ('other-operation', ((select count(*) from public.audit_logs
    where estimate_version_id = '28100000-0000-4000-8000-000000000102') - audit_before)::text);
  perform set_config('role', 'none', true);
  perform set_config('miaouffrage.estimate_creation_atomic', '', true);
end
$guards$;

select results_eq(
  $$select case_name, outcome from ec28_outcome where case_name in ('other-version', 'other-operation') order by case_name$$,
  $$values ('other-operation'::text, '2'::text), ('other-version', '2|1')$$,
  'under a creation contract, another version and an update keep their line-by-line audit and revision'
);

do $replay_guard$
begin
  begin
    perform public.estimate_creation_replay_item_effects_for_writer('28100000-0000-4000-8000-000000000102',
      array['28100000-0000-4000-8200-000000000004'::uuid]);
    insert into ec28_outcome values ('replay-outside', 'ok');
  exception when others then
    insert into ec28_outcome values ('replay-outside', sqlstate || ' ' || sqlerrm);
  end;
  begin
    perform set_config('miaouffrage.estimate_creation_atomic', '28100000-0000-4000-8000-000000000101', true);
    perform public.estimate_creation_replay_item_effects_for_writer('28100000-0000-4000-8000-000000000102',
      array['28100000-0000-4000-8200-000000000004'::uuid]);
    insert into ec28_outcome values ('replay-other-version', 'ok');
  exception when others then
    insert into ec28_outcome values ('replay-other-version', sqlstate || ' ' || sqlerrm);
  end;
  begin
    perform set_config('miaouffrage.estimate_creation_atomic', '28100000-0000-4000-8000-000000000102', true);
    perform set_config('role', 'authenticated', true);
    perform public.estimate_creation_replay_item_effects_for_writer('28100000-0000-4000-8000-000000000102', '{}');
    insert into ec28_outcome values ('replay-authenticated', 'ok');
  exception when others then
    insert into ec28_outcome values ('replay-authenticated', sqlstate || ' ' || sqlerrm);
  end;
  perform set_config('role', 'none', true);
  perform set_config('miaouffrage.estimate_creation_atomic', '', true);
end
$replay_guard$;

-- A second replay inside one contract would bump and journal the items twice: the first replay closes it.
do $replay_twice$
declare
  second_outcome text;
begin
  begin
    perform set_config('role', 'service_role', true);
    perform set_config('miaouffrage.estimate_creation_atomic', '28100000-0000-4000-8000-000000000102', true);
    perform public.estimate_creation_replay_item_effects_for_writer('28100000-0000-4000-8000-000000000102',
      array['28100000-0000-4000-8200-000000000004'::uuid]);
    begin
      perform public.estimate_creation_replay_item_effects_for_writer('28100000-0000-4000-8000-000000000102',
        array['28100000-0000-4000-8200-000000000004'::uuid]);
      second_outcome := 'ok';
    exception when others then
      second_outcome := sqlstate || ' ' || sqlerrm;
    end;
    raise exception 'EC28_ROLLBACK';
  exception when others then
    if sqlerrm <> 'EC28_ROLLBACK' then
      second_outcome := 'first: ' || sqlstate || ' ' || sqlerrm;
    end if;
  end;
  insert into ec28_outcome values ('replay-twice', second_outcome);
  perform set_config('role', 'none', true);
end
$replay_twice$;

select results_eq(
  $$select case_name, outcome from ec28_outcome where case_name like 'replay-%' order by case_name$$,
  $$values
    ('replay-authenticated'::text,
     '42501 permission denied for function estimate_creation_replay_item_effects_for_writer'::text),
    ('replay-other-version', '42501 ESTIMATE_CREATION_REPLAY_OUTSIDE_CONTRACT'),
    ('replay-outside', '42501 ESTIMATE_CREATION_REPLAY_OUTSIDE_CONTRACT'),
    ('replay-twice', '42501 ESTIMATE_CREATION_REPLAY_OUTSIDE_CONTRACT')$$,
  'the replay bridge serves its own creation contract once, never another version or an authenticated caller'
);

-- The content revision stays managed: only the replay of the creation of that version, upward, may set it.
create function pg_temp.ec28_revision_write(p_replay text, p_atomic text, p_delta integer) returns text
language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('miaouffrage.estimate_creation_replay', p_replay, true);
  perform set_config('miaouffrage.estimate_creation_atomic', p_atomic, true);
  update public.estimate_versions set content_revision = content_revision + p_delta
  where id = '28100000-0000-4000-8000-000000000102';
  raise exception 'EC28_ROLLBACK';
exception when others then
  perform set_config('role', 'none', true);
  perform set_config('miaouffrage.estimate_creation_replay', '', true);
  perform set_config('miaouffrage.estimate_creation_atomic', '', true);
  return case when sqlerrm = 'EC28_ROLLBACK' then 'ok' else sqlstate || ' ' || sqlerrm end;
end
$$;

select results_eq(
  $$select pg_temp.ec28_revision_write('', '', 1)
    union all select pg_temp.ec28_revision_write('28100000-0000-4000-8000-000000000102', '', 1)
    union all select pg_temp.ec28_revision_write('28100000-0000-4000-8000-000000000101',
      '28100000-0000-4000-8000-000000000101', 1)
    union all select pg_temp.ec28_revision_write('28100000-0000-4000-8000-000000000102',
      '28100000-0000-4000-8000-000000000102', -1)
    union all select pg_temp.ec28_revision_write('28100000-0000-4000-8000-000000000102',
      '28100000-0000-4000-8000-000000000102', 1)$$,
  $$values ('42501 ESTIMATE_CONTENT_REVISION_IS_MANAGED'::text), ('42501 ESTIMATE_CONTENT_REVISION_IS_MANAGED'),
    ('42501 ESTIMATE_CONTENT_REVISION_IS_MANAGED'), ('42501 ESTIMATE_CONTENT_REVISION_IS_MANAGED'), ('ok')$$,
  'a direct content revision write is refused unless it is the upward replay of the creation of that version'
);

-- Engine 3: the same replay, compatible with the D12 projection check (one priced line, coefficients 1 / 1). The line
-- has no supply type, so the database gives it the default FO provision 1,010 (TI-534): PU = 1000 × 1,010 = 1010.
select set_config('role', 'service_role', true);
select public.set_tenant_calc_policy(p_tenant_id => current_setting('test.tenant_id')::uuid,
  p_new_estimate_calc_engine => 3::smallint, p_default_sale_coefficient_fo => 1, p_default_sale_coefficient_mo => 1,
  p_allowed_tax_rates_bp => null, p_change_reason => 'EC28 v3', p_actor_user_id => '28100000-0000-4000-8000-000000000001');
select set_config('role', 'none', true);
insert into ec28_outcome values ('v3', pg_temp.ec28_create(
  pg_temp.ec28_version('28100000-0000-4000-8000-000000000104', 3) || jsonb_build_object('sale_coefficient_fo', 1,
    'sale_coefficient_mo', 1, 'gross_ht_cents', 1010, 'discount_applied_cents', 0, 'commercial_rounding_cents', 0,
    'total_ht_cents', 1010, 'total_tax_cents', 202, 'total_ttc_cents', 1212),
  jsonb_build_array(
    jsonb_build_object('id', '28100000-0000-4000-8400-000000000001', 'parent_id', null, 'item_type', 'section', 'position', 1, 'title', 'Lot'),
    jsonb_build_object('id', '28100000-0000-4000-8400-000000000002', 'parent_id', '28100000-0000-4000-8400-000000000001',
      'item_type', 'line', 'position', 2, 'title', 'Robinet', 'description', 'u', 'quantity', 1, 'unit_price_ht_cents', 1000,
      'tax_rate_bp', 2000, 'k_fo', 1, 'h_mo_per_unit', 0, 'h_mo_majoration', 1, 'k_mo', 1, 'pu_ht_cents', 1010,
      'line_total_ht_cents', 1010, 'line_tax_cents', 202, 'line_total_ttc_cents', 1212, 'unit_code', 'u',
      'pricing_status', 'priced'))));

select results_eq(
  $$select o.outcome, v.content_revision - first_revision.value,
      (select count(*) from public.audit_logs a where a.estimate_version_id = v.id and a.table_name = 'estimate_items'),
      (select count(*) from public.audit_logs a where a.record_id = v.id and a.table_name = 'estimate_versions' and a.action = 'UPDATE')
    from ec28_outcome o
    join public.estimate_versions v on v.id = '28100000-0000-4000-8000-000000000104'
    cross join lateral (select (a.after_data ->> 'content_revision')::bigint as value from public.audit_logs a
      where a.record_id = v.id and a.table_name = 'estimate_versions' and a.action = 'INSERT') first_revision
    where o.case_name = 'v3'$$,
  $$values ('ok'::text, 2::bigint, 2::bigint, 2::bigint)$$,
  'a v3 created atomically passes the projection check, with one revision step and audit rows per item'
);

select * from finish();
rollback;
