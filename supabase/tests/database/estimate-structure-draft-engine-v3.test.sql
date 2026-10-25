-- Lot 3.2, entrée 2 (P-14) : la structure IA s'applique à un brouillon du moteur 3
-- (migration 20261025163000_structure_draft_apply_engine_v3.sql). Les cas passent par la RPC réelle,
-- public.apply_estimate_structure_draft, sous le rôle authenticated d'un ingénieur du tenant.
-- Isolation justifiée : l'écriture sous contrat d'écrivain, l'atomicité avec la provenance et le passage de la
-- preview à « applied », et le refus sans écriture partielle ne sont pas tous observables depuis un parcours.
-- Chaque appel passe par un bloc qui consigne son issue, pour qu'avant la migration ce fichier échoue sur des
-- assertions nommées au lieu de s'interrompre.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  ('00000000-0000-0000-0000-000000000000', '8e000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'structure-draft-v3@example.test',
   crypt('test-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');

update public.tenant_memberships
set role = 'engineer'::public.tenant_role
where user_id = '8e000000-0000-4000-8000-000000000001';

select set_config(
  'test.tenant_id',
  (select membership.tenant_id::text from public.tenant_memberships membership
   where membership.user_id = '8e000000-0000-4000-8000-000000000001' limit 1),
  true
);

create temporary table sd_outcome (case_name text primary key, outcome text) on commit drop;
grant all on sd_outcome to authenticated;

-- Une affaire, deux brouillons v3 (...101 application, ...102 refus sans écriture partielle) et un brouillon v2
-- (...103, chemin historique inchangé).
insert into public.estimate_projects (id, tenant_id, user_id, name) values
  ('8e000000-0000-4000-8000-000000000010', current_setting('test.tenant_id')::uuid,
   '8e000000-0000-4000-8000-000000000001', 'Structure IA affaire v3');

insert into public.estimate_versions (id, tenant_id, project_id, version_number, calc_engine_version, max_section_depth,
  currency, status, margin_mode, margin_multiplier, margin_bp, global_coefficient, discount_bp, discount_mode, tax_rate_bp,
  rounding_mode, rounding_step_cents, sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents,
  commercial_rounding_cents, total_ht_cents, total_tax_cents, total_ttc_cents)
select fixture.id, current_setting('test.tenant_id')::uuid, '8e000000-0000-4000-8000-000000000010',
  fixture.version_number, 3, 3, 'EUR', 'draft', 'fixed', 1, 0, 1, 0, 'simple', 2000, 'none', 1, 1.3, 1.2, 0, 0, 0, 0, 0, 0
from (values
  ('8e000000-0000-4000-8000-000000000101'::uuid, 1),
  ('8e000000-0000-4000-8000-000000000102'::uuid, 2)
) as fixture(id, version_number);
insert into public.estimate_versions (id, tenant_id, project_id, version_number, calc_engine_version, max_section_depth, currency)
values ('8e000000-0000-4000-8000-000000000103', current_setting('test.tenant_id')::uuid, '8e000000-0000-4000-8000-000000000010',
  3, 2, 3, 'EUR');
-- Une v3 envoyée (...104, historique synthétique) : une structure n'y entre pas, même par une simple fusion.
insert into public.estimate_versions (id, tenant_id, project_id, version_number, calc_engine_version, max_section_depth,
  currency, status, margin_mode, margin_multiplier, margin_bp, global_coefficient, discount_bp, discount_mode, tax_rate_bp,
  rounding_mode, rounding_step_cents, sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents,
  commercial_rounding_cents, total_ht_cents, total_tax_cents, total_ttc_cents)
values ('8e000000-0000-4000-8000-000000000104', current_setting('test.tenant_id')::uuid, '8e000000-0000-4000-8000-000000000010',
  4, 3, 3, 'EUR', 'sent', 'fixed', 1, 0, 1, 0, 'simple', 2000, 'none', 1, 1.3, 1.2, 0, 0, 0, 0, 0, 0);

-- Sa section, avant tout autre élément, déclencheur de révision suspendu (il refuse tout élément d'une version
-- finalisée) ; la clé parente différée est vérifiée avant de rétablir le déclencheur.
alter table public.estimate_items disable trigger bump_estimate_content_revision_from_item;
select set_config('miaouffrage.estimate_v3_writer', '8e000000-0000-4000-8000-000000000104', true);
insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title)
values ('8e000000-0000-4000-8000-000000000114', current_setting('test.tenant_id')::uuid,
  '8e000000-0000-4000-8000-000000000104', 'section', 1, 'SD lot existant');
select set_config('miaouffrage.estimate_v3_writer', '', true);
set constraints public.estimate_items_parent_id_fkey immediate;
set constraints public.estimate_items_parent_id_fkey deferred;
alter table public.estimate_items enable trigger bump_estimate_content_revision_from_item;

-- Contenu existant : une section et une ligne chiffrée par le moteur 3 dans chaque v3, écrites sous le contrat
-- d'écrivain de leur version ; une section dans la v2.
do $seed$
declare
  seeded record;
begin
  for seeded in
    select * from (values
      ('8e000000-0000-4000-8000-000000000101'::uuid, '8e000000-0000-4000-8000-000000000111'::uuid, '8e000000-0000-4000-8000-000000000121'::uuid),
      ('8e000000-0000-4000-8000-000000000102'::uuid, '8e000000-0000-4000-8000-000000000112'::uuid, '8e000000-0000-4000-8000-000000000122'::uuid)
    ) as fixture(version_id, section_id, line_id)
  loop
    perform set_config('miaouffrage.estimate_v3_writer', seeded.version_id::text, true);
    insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title)
    values (seeded.section_id, current_setting('test.tenant_id')::uuid, seeded.version_id, 'section', 1, 'SD lot existant');
    insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, description, quantity,
      unit_code, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, k_mo, pu_ht_cents, line_total_ht_cents, line_tax_cents,
      line_total_ttc_cents, h_mo_per_unit)
    values (seeded.line_id, current_setting('test.tenant_id')::uuid, seeded.version_id, seeded.section_id, 'line', 1,
      'SD Tube cuivre 22', null, 10, 'ml', 1000, 2000, 1, 0, 1, 0, 0, 0, 0, 0.5);
    perform public.estimate_v3_complete_entry_for_writer(seeded.version_id, array[seeded.line_id]);
  end loop;
  perform set_config('miaouffrage.estimate_v3_writer', '', true);
end
$seed$;

insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title)
values ('8e000000-0000-4000-8000-000000000113', current_setting('test.tenant_id')::uuid,
  '8e000000-0000-4000-8000-000000000103', 'section', 1, 'SD lot existant');

-- Previews en attente (une par version) et une preview déjà appliquée, avec leurs nœuds.
insert into public.estimate_structure_drafts (id, tenant_id, project_id, target_version_id, created_by, status)
select fixture.id, current_setting('test.tenant_id')::uuid, '8e000000-0000-4000-8000-000000000010', fixture.version_id,
  '8e000000-0000-4000-8000-000000000001', fixture.status
from (values
  ('8e000000-0000-4000-8000-000000000201'::uuid, '8e000000-0000-4000-8000-000000000101'::uuid, 'pending'),
  ('8e000000-0000-4000-8000-000000000202'::uuid, '8e000000-0000-4000-8000-000000000102'::uuid, 'pending'),
  ('8e000000-0000-4000-8000-000000000203'::uuid, '8e000000-0000-4000-8000-000000000103'::uuid, 'pending'),
  ('8e000000-0000-4000-8000-000000000204'::uuid, '8e000000-0000-4000-8000-000000000101'::uuid, 'applied'),
  ('8e000000-0000-4000-8000-000000000205'::uuid, '8e000000-0000-4000-8000-000000000104'::uuid, 'pending'),
  ('8e000000-0000-4000-8000-000000000206'::uuid, '8e000000-0000-4000-8000-000000000101'::uuid, 'pending')
) as fixture(id, version_id, status);

insert into public.estimate_structure_draft_nodes (id, tenant_id, draft_id, parent_node_id, order_index, hierarchy_level,
  label, normalized_label, confidence, default_action)
select fixture.id, current_setting('test.tenant_id')::uuid, fixture.draft_id, fixture.parent_id, 0, fixture.level,
  fixture.label, lower(fixture.label), 0.8, fixture.action
from (values
  ('8e000000-0000-4000-8000-000000000301'::uuid, '8e000000-0000-4000-8000-000000000201'::uuid, null::uuid, 1, 'SD lot existant', 'merge'),
  ('8e000000-0000-4000-8000-000000000302'::uuid, '8e000000-0000-4000-8000-000000000201'::uuid, '8e000000-0000-4000-8000-000000000301'::uuid, 2, 'SD sous-lot IA', 'create'),
  ('8e000000-0000-4000-8000-000000000303'::uuid, '8e000000-0000-4000-8000-000000000202'::uuid, null::uuid, 1, 'SD lot refusé', 'create'),
  ('8e000000-0000-4000-8000-000000000304'::uuid, '8e000000-0000-4000-8000-000000000203'::uuid, null::uuid, 1, 'SD lot v2', 'create'),
  ('8e000000-0000-4000-8000-000000000305'::uuid, '8e000000-0000-4000-8000-000000000205'::uuid, null::uuid, 1, 'SD lot existant', 'merge'),
  ('8e000000-0000-4000-8000-000000000306'::uuid, '8e000000-0000-4000-8000-000000000206'::uuid, null::uuid, 1, 'SD lot renommé', 'merge')
) as fixture(id, draft_id, parent_id, level, label, action);

insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
select version.id, '8e000000-0000-4000-8000-000000000001', version.tenant_id,
  statement_timestamp() + interval '30 minutes', gen_random_uuid()
from public.estimate_versions version
where version.project_id = '8e000000-0000-4000-8000-000000000010';

create temporary table sd_before on commit drop as
select version.id, version.content_revision, version.total_ht_cents, version.total_tax_cents, version.total_ttc_cents
from public.estimate_versions version
where version.project_id = '8e000000-0000-4000-8000-000000000010';

-- Les cas, sous le rôle authenticated -----------------------------------------------------------

create or replace function pg_temp.sd_apply(
  p_case text, p_draft_id uuid, p_version_id uuid, p_created jsonb, p_updated jsonb, p_applications jsonb
)
returns void
language plpgsql
as $$
declare
  failure_detail text;
  result_row record;
begin
  begin
    select * into result_row
    from public.apply_estimate_structure_draft(p_draft_id, p_version_id, '8e000000-0000-4000-8000-000000000001',
      p_created, p_updated, p_applications, now());
    insert into sd_outcome values (p_case, format('ok created=%s updated=%s applications=%s',
      result_row.created_count, result_row.updated_count, result_row.application_count));
  exception when others then
    get stacked diagnostics failure_detail = pg_exception_detail;
    insert into sd_outcome values (p_case, sqlstate || ' ' || sqlerrm || coalesce(' | ' || nullif(failure_detail, ''), ''));
  end;
end;
$$;

grant execute on function pg_temp.sd_apply(text, uuid, uuid, jsonb, jsonb, jsonb) to authenticated;

select set_config('request.jwt.claim.sub', '8e000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', '8e000000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

-- V3 : fusion dans la section existante (renommée), sous-section créée après la ligne du parent.
select pg_temp.sd_apply('V3', '8e000000-0000-4000-8000-000000000201', '8e000000-0000-4000-8000-000000000101',
  '[{"id": "8e000000-0000-4000-8000-000000000131", "parent_id": "8e000000-0000-4000-8000-000000000111", "item_type": "section",
     "position": 2, "title": "SD sous-lot IA", "source_provider": "ai_structure", "source_job_id": null,
     "source_file_name": "Structure IA", "source_page": null}]',
  '[{"id": "8e000000-0000-4000-8000-000000000111", "title": "SD lot renommé", "source_provider": "ai_structure",
     "source_job_id": null, "source_file_name": "Structure IA", "source_page": null}]',
  '[{"draft_node_id": "8e000000-0000-4000-8000-000000000301", "estimate_item_id": "8e000000-0000-4000-8000-000000000111", "applied_action": "merge"},
    {"draft_node_id": "8e000000-0000-4000-8000-000000000302", "estimate_item_id": "8e000000-0000-4000-8000-000000000131", "applied_action": "create"}]');
-- V3-merge-only : une fusion sans renommage n'écrit aucun élément ; le contrat s'ouvre et se referme quand même.
select pg_temp.sd_apply('V3-merge-only', '8e000000-0000-4000-8000-000000000206', '8e000000-0000-4000-8000-000000000101',
  '[]', '[]',
  '[{"draft_node_id": "8e000000-0000-4000-8000-000000000306", "estimate_item_id": "8e000000-0000-4000-8000-000000000111", "applied_action": "merge"}]');
-- V3-not-draft : même une simple fusion est refusée sur une v3 envoyée, par le refus des versions figées.
select pg_temp.sd_apply('V3-not-draft', '8e000000-0000-4000-8000-000000000205', '8e000000-0000-4000-8000-000000000104',
  '[]', '[]',
  '[{"draft_node_id": "8e000000-0000-4000-8000-000000000305", "estimate_item_id": "8e000000-0000-4000-8000-000000000114", "applied_action": "merge"}]');
select pg_temp.sd_apply('V3-replay', '8e000000-0000-4000-8000-000000000201', '8e000000-0000-4000-8000-000000000101',
  '[]', '[]', '[]');
select pg_temp.sd_apply('V3-applied', '8e000000-0000-4000-8000-000000000204', '8e000000-0000-4000-8000-000000000101',
  '[]', '[]', '[]');
-- V3-partial : la provenance vise un nœud inconnu ; rien ne doit rester de la section créée.
select pg_temp.sd_apply('V3-partial', '8e000000-0000-4000-8000-000000000202', '8e000000-0000-4000-8000-000000000102',
  '[{"id": "8e000000-0000-4000-8000-000000000132", "parent_id": null, "item_type": "section", "position": 2,
     "title": "SD lot refusé", "source_provider": "ai_structure", "source_job_id": null, "source_file_name": "Structure IA",
     "source_page": null}]',
  '[]',
  '[{"draft_node_id": "8e000000-0000-4000-8000-000000000399", "estimate_item_id": "8e000000-0000-4000-8000-000000000132", "applied_action": "create"}]');
select pg_temp.sd_apply('V2', '8e000000-0000-4000-8000-000000000203', '8e000000-0000-4000-8000-000000000103',
  '[{"id": "8e000000-0000-4000-8000-000000000133", "parent_id": null, "item_type": "section", "position": 2,
     "title": "SD lot v2", "source_provider": "ai_structure", "source_job_id": null, "source_file_name": "Structure IA",
     "source_page": null}]',
  '[]',
  '[{"draft_node_id": "8e000000-0000-4000-8000-000000000304", "estimate_item_id": "8e000000-0000-4000-8000-000000000133", "applied_action": "create"}]');

select is(
  coalesce(current_setting('miaouffrage.estimate_v3_writer', true), ''),
  '',
  'the v3 writer contract is restored once each apply returns'
);

reset role;

select results_eq(
  $$select case_name, regexp_replace(outcome, ' \| .*$', '') from sd_outcome order by case_name$$,
  $$values
    ('V2'::text, 'ok created=1 updated=0 applications=1'::text),
    ('V3', 'ok created=1 updated=1 applications=2'),
    ('V3-applied', 'P0001 ESTIMATE_STRUCTURE_DRAFT_NOT_PENDING'),
    ('V3-merge-only', 'ok created=0 updated=0 applications=1'),
    ('V3-not-draft', '42501 ESTIMATE_VERSION_READ_ONLY'),
    ('V3-partial', '23503 insert or update on table "estimate_structure_draft_applications" violates foreign key constraint "estimate_structure_draft_applications_draft_node_id_fkey"'),
    ('V3-replay', 'P0001 ESTIMATE_STRUCTURE_DRAFT_NOT_PENDING')$$,
  'a v3 draft takes an AI structure (merge with rename, sub-section created, merge alone), and so does a v2; a sent v3, a replay or an applied preview is refused by name, and a failing provenance write refuses the whole apply'
);

-- V3 : sections, provenance et preview dans la même transaction, sous le moteur 3 --------------------

select results_eq(
  $$select item.id, item.parent_id, item.item_type::text, item.position, item.title, item.source_provider, item.source_file_name
    from public.estimate_items item
    where item.version_id = '8e000000-0000-4000-8000-000000000101' and item.item_type = 'section'
    order by item.position, item.id$$,
  $$values
    ('8e000000-0000-4000-8000-000000000111'::uuid, null::uuid, 'section'::text, 1, 'SD lot renommé'::text, 'ai_structure'::text, 'Structure IA'::text),
    ('8e000000-0000-4000-8000-000000000131', '8e000000-0000-4000-8000-000000000111', 'section', 2, 'SD sous-lot IA', 'ai_structure', 'Structure IA')$$,
  'the v3 receives the created sub-section after the line of its parent, and the merged section is renamed with its AI provenance'
);

select results_eq(
  $$select application.draft_node_id, application.estimate_item_id, application.applied_action
    from public.estimate_structure_draft_applications application
    where application.draft_id = '8e000000-0000-4000-8000-000000000201'
    order by application.applied_action desc$$,
  $$values
    ('8e000000-0000-4000-8000-000000000301'::uuid, '8e000000-0000-4000-8000-000000000111'::uuid, 'merge'::text),
    ('8e000000-0000-4000-8000-000000000302', '8e000000-0000-4000-8000-000000000131', 'create')$$,
  'the structure provenance of the v3 is written with its sections'
);

select results_eq(
  $$select draft.id, draft.status, draft.applied_at is not null
    from public.estimate_structure_drafts draft
    where draft.id in ('8e000000-0000-4000-8000-000000000201', '8e000000-0000-4000-8000-000000000202',
      '8e000000-0000-4000-8000-000000000203', '8e000000-0000-4000-8000-000000000205', '8e000000-0000-4000-8000-000000000206')
    order by draft.id$$,
  $$values
    ('8e000000-0000-4000-8000-000000000201'::uuid, 'applied'::text, true),
    ('8e000000-0000-4000-8000-000000000202', 'pending', false),
    ('8e000000-0000-4000-8000-000000000203', 'applied', true),
    ('8e000000-0000-4000-8000-000000000205', 'pending', false),
    ('8e000000-0000-4000-8000-000000000206', 'applied', true)$$,
  'an applied preview is marked applied; the refused ones stay pending'
);

select results_eq(
  $$select version.id, version.content_revision > before.content_revision,
      (version.total_ht_cents, version.total_tax_cents, version.total_ttc_cents)
        = (before.total_ht_cents, before.total_tax_cents, before.total_ttc_cents)
    from public.estimate_versions version
    join sd_before before on before.id = version.id
    where version.id in ('8e000000-0000-4000-8000-000000000101', '8e000000-0000-4000-8000-000000000102',
      '8e000000-0000-4000-8000-000000000103', '8e000000-0000-4000-8000-000000000104')
    order by version.id$$,
  $$values
    ('8e000000-0000-4000-8000-000000000101'::uuid, true, true),
    ('8e000000-0000-4000-8000-000000000102', false, true),
    ('8e000000-0000-4000-8000-000000000103', true, true),
    ('8e000000-0000-4000-8000-000000000104', false, true)$$,
  'the content revision moves with the structure on a v3 and on a v2, the totals do not (sections only); the refused v3 drafts are untouched'
);

select ok(
  (select version.total_ht_cents > 0 from public.estimate_versions version
   where version.id = '8e000000-0000-4000-8000-000000000101'),
  'the v3 keeps the amount of its existing line'
);

select lives_ok(
  $$select private.estimate_v3_assert_draft('8e000000-0000-4000-8000-000000000101')$$,
  'the v3 still passes the v3 projection check after the structure'
);

select results_eq(
  $$select application.draft_id, application.draft_node_id, application.estimate_item_id, application.applied_action
    from public.estimate_structure_draft_applications application
    where application.draft_id in ('8e000000-0000-4000-8000-000000000203', '8e000000-0000-4000-8000-000000000205',
      '8e000000-0000-4000-8000-000000000206')
    order by application.draft_id$$,
  $$values
    ('8e000000-0000-4000-8000-000000000203'::uuid, '8e000000-0000-4000-8000-000000000304'::uuid,
      '8e000000-0000-4000-8000-000000000133'::uuid, 'create'::text),
    ('8e000000-0000-4000-8000-000000000206', '8e000000-0000-4000-8000-000000000306',
      '8e000000-0000-4000-8000-000000000111', 'merge')$$,
  'the v2 and merge-alone provenance is written; the sent v3 records none'
);

select results_eq(
  $$select item.id, item.parent_id, item.position, item.title, item.source_provider
    from public.estimate_items item
    where item.version_id in ('8e000000-0000-4000-8000-000000000103', '8e000000-0000-4000-8000-000000000104')
    order by item.version_id, item.position$$,
  $$values
    ('8e000000-0000-4000-8000-000000000113'::uuid, null::uuid, 1, 'SD lot existant'::text, 'manual'::text),
    ('8e000000-0000-4000-8000-000000000133', null, 2, 'SD lot v2', 'ai_structure'),
    ('8e000000-0000-4000-8000-000000000114', null, 1, 'SD lot existant', 'manual')$$,
  'the v2 receives its section after the existing one; the sent v3 keeps its single section'
);

select is(
  (select count(*)::integer from public.estimate_items item
   where item.version_id = '8e000000-0000-4000-8000-000000000102'),
  2,
  'the refused v3 keeps only its section and its line'
);

-- Hors contrat, une v3 refuse toujours l'écriture directe d'une section.
set local role authenticated;
select throws_ok(
  $$insert into public.estimate_items (tenant_id, version_id, item_type, position, title)
    values (current_setting('test.tenant_id')::uuid, '8e000000-0000-4000-8000-000000000102', 'section', 3, 'SD direct')$$,
  '0A000',
  'ESTIMATE_V3_WRITER_NOT_SUPPORTED',
  'a v3 still refuses a section written outside its writer contract'
);
reset role;

select * from finish();
rollback;
