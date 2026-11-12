-- Material requests (TI-690). Failure modes this file guards, with fictional members and articles:
--  1. a member of another tenant reads or changes a request, its lines, its originals or the technicians;
--  2. a viewer or a director writes (a director even on the affaire they own), or a viewer reads an
--     affaire that is not theirs;
--  3. an engineer who does not own the affaire reads or changes its requests;
--  4. the engineer who owns the affaire, or an admin, cannot do the work;
--  5. a line is forged as validated while incomplete (no quantity, doubtful figure, blank unit or type,
--     no size without « sans dimension »), or its quantity is zero;
--  6. the author or date of a validation is forged, survives a return to draft, or a validated line is
--     edited and stays validated;
--  7. the confirmation of a presumed material or supplier survives a changed or cleared value, or its
--     author is forged;
--  8. a row points at another tenant (affaire, technician, supplier, technician's site), takes its
--     tenant from the client, or moves to another request or affaire;
--  9. deleting the affaire leaves requests, lines or originals behind; deleting a technician, a supplier
--     or a member's profile breaks the requests that named them;
-- 10. an original is stored outside the path of its row, by someone who cannot write, or is read by
--     someone who cannot read the affaire; the bucket is public;
-- 11. the same technician is added twice under another case or spacing, or a client deletes one;
-- 12. an anonymous caller reaches any of the four tables;
-- 13. the list of known materials shows another tenant's catalogue, blanks or the same name twice;
-- 14. two lines of a request share a position;
-- 16. a line is validated in no material, or stays validated when the presumed material it relied on is
--     changed, cleared or un-confirmed, so that confirming another material makes it "validated" in a
--     material nobody validated (the duplicate rule, by contrast, is the application's alone);
-- 17. an engineer cannot rename or deactivate a technician placed on an affaire they cannot read;
-- 18. a client chooses the creation date of a technician, a request, a line or an original;
-- 19. a writer replaces the stored bytes of an original (an UPDATE policy on the bucket), or a reader
--     deletes them;
-- 20. bytes land in the bucket without a live row: a signed upload token outlives the row it was signed
--     for (deleted, cancelled, rejected) and its upload finishes afterwards, whoever performs it;
-- 21. the bytes of a stored original are replaced: its object is re-created at the same path, updated or
--     moved, or deleted directly while the row is still listed (bytes then answer 500); a reader deletes
--     them; bytes of another size than announced are marked stored;
-- 22. a request holds more than twelve stored originals (two uploads completed side by side), or
--     unstored rows pile up without bound;
-- 23. the guards on storage.objects disturb another bucket;
-- 24. a request grows past three hundred lines: two appends read 299 side by side and both pass, after
--     which "select all" and "validate all" are refused by their own limit of three hundred ids; or a
--     batch that crosses the cap is appended in part;
-- 15. an original is listed before its bytes are stored: it is recorded as stored, marked stored without
--     bytes, at a chosen time, or unmarked; it is turned before it is stored; or reading stored bytes
--     comes to depend on that mark (the storage read policy must stay as it was).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

select ok(relation.relrowsecurity and relation.relforcerowsecurity, format('%s has forced RLS', relation.relname))
from pg_class relation
where relation.oid in ('public.material_request_technicians'::regclass, 'public.material_requests'::regclass,
  'public.material_request_files'::regclass, 'public.material_request_lines'::regclass);
select is(has_table_privilege('authenticated', 'public.material_request_technicians', 'DELETE'), false,
  'a client cannot delete a technician');
select ok((select not public and file_size_limit = 20971520
    and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
  from storage.buckets where id = 'material-requests'), 'the originals bucket is private, 20 MiB, images only');

-- Members of tenant 101: 1 engineer who owns the affaire, 2 admin, 3 director, 4 viewer, 5 another
-- engineer, 7 a second admin. Member 6 belongs to tenant 102 only.
insert into auth.users (id, email, raw_user_meta_data)
select ('a9000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'demande-materiel-' || n || '@example.test', '{}'::jsonb
from generate_series(1, 7) n;
update public.tenant_memberships set is_default = false where user_id::text like 'a9000000-%';
insert into public.tenants (id, name, slug) values
  ('a9000000-0000-4000-8000-000000000101', 'Demandes fixture', 'demandes-fixture'),
  ('a9000000-0000-4000-8000-000000000102', 'Demandes autre tenant', 'demandes-autre-tenant');
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at)
select (case when n = 6 then 'a9000000-0000-4000-8000-000000000102' else 'a9000000-0000-4000-8000-000000000101' end)::uuid,
  ('a9000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  (case n when 1 then 'engineer' when 2 then 'admin' when 3 then 'director' when 4 then 'viewer' when 5 then 'engineer' else 'admin' end)::public.tenant_role,
  true, '2020-01-01'
from generate_series(1, 7) n;
insert into public.estimate_projects (id, tenant_id, user_id, name) values
  ('a9000000-0000-4000-8000-000000000201', 'a9000000-0000-4000-8000-000000000101', 'a9000000-0000-4000-8000-000000000001', 'Affaire du demandeur'),
  ('a9000000-0000-4000-8000-000000000202', 'a9000000-0000-4000-8000-000000000101', 'a9000000-0000-4000-8000-000000000005', 'Affaire d''un autre ingénieur'),
  ('a9000000-0000-4000-8000-000000000203', 'a9000000-0000-4000-8000-000000000102', 'a9000000-0000-4000-8000-000000000006', 'Affaire d''un autre tenant'),
  ('a9000000-0000-4000-8000-000000000204', 'a9000000-0000-4000-8000-000000000101', 'a9000000-0000-4000-8000-000000000003', 'Affaire du directeur');
insert into public.suppliers (id, tenant_id, name) values
  ('a9000000-0000-4000-8000-000000000301', 'a9000000-0000-4000-8000-000000000101', 'Fournisseur fictif'),
  ('a9000000-0000-4000-8000-000000000302', 'a9000000-0000-4000-8000-000000000102', 'Fournisseur d''un autre tenant');
insert into public.products (tenant_id, designation, unit_price_cents, material) values
  ('a9000000-0000-4000-8000-000000000101', 'Coude fictif', 100, 'Inox 304L'),
  ('a9000000-0000-4000-8000-000000000101', 'Té fictif', 100, '  Inox 304L '),
  ('a9000000-0000-4000-8000-000000000101', 'Tube fictif', 100, 'Cuivre'),
  ('a9000000-0000-4000-8000-000000000101', 'Article sans matière', 100, '   '),
  ('a9000000-0000-4000-8000-000000000101', 'Article sans matière bis', 100, null),
  ('a9000000-0000-4000-8000-000000000102', 'Tube d''un autre tenant', 100, 'PVC pression');
insert into public.material_request_technicians (id, tenant_id, name) values
  ('a9000000-0000-4000-8000-000000000402', 'a9000000-0000-4000-8000-000000000102', 'Technicien d''un autre tenant');
insert into public.material_requests (id, project_id, created_by) values
  ('a9000000-0000-4000-8000-000000000502', 'a9000000-0000-4000-8000-000000000202', 'a9000000-0000-4000-8000-000000000005'),
  ('a9000000-0000-4000-8000-000000000503', 'a9000000-0000-4000-8000-000000000203', 'a9000000-0000-4000-8000-000000000006');
insert into public.material_request_lines (id, request_id, position, product_type) values
  ('a9000000-0000-4000-8000-000000000650', 'a9000000-0000-4000-8000-000000000502', 1, 'Bride'),
  ('a9000000-0000-4000-8000-000000000651', 'a9000000-0000-4000-8000-000000000503', 1, 'Bride');
select is((select tenant_id from public.material_requests where id = 'a9000000-0000-4000-8000-000000000503'),
  'a9000000-0000-4000-8000-000000000102'::uuid, 'a request takes the tenant of its affaire');

-- 4, 7, 8, 11: the engineer who owns the affaire.
select set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a9000000-0000-4000-8000-000000000001"}', true);
set local role authenticated;

select lives_ok($$insert into public.material_request_technicians (id, name, current_project_id, created_by, created_at)
  values ('a9000000-0000-4000-8000-000000000401', 'Technicien Bravo', 'a9000000-0000-4000-8000-000000000201', 'a9000000-0000-4000-8000-000000000001', '2000-01-01')$$,
  'an engineer adds a technician on a site of the tenant');
select throws_ok($$insert into public.material_request_technicians (name, created_by)
  values ('TECHNICIEN  bravo', 'a9000000-0000-4000-8000-000000000001')$$, '23505', null,
  'the same name in another case and spacing is the same technician');
select throws_ok($$insert into public.material_request_technicians (name, current_project_id, created_by)
  values ('Technicien Charlie', 'a9000000-0000-4000-8000-000000000203', 'a9000000-0000-4000-8000-000000000001')$$,
  '23514', 'MATERIAL_REQUEST_TENANT_MISMATCH', 'a technician cannot be placed on a site of another tenant');
select throws_ok($$insert into public.material_request_technicians (tenant_id, name, created_by)
  values ('a9000000-0000-4000-8000-000000000102', 'Technicien Charlie', 'a9000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'a technician cannot be added to another tenant');
select throws_ok($$delete from public.material_request_technicians where id = 'a9000000-0000-4000-8000-000000000401'$$,
  '42501', null, 'a technician is deactivated, never deleted by a client');

select lives_ok($$insert into public.material_requests (id, tenant_id, project_id, technician_id, presumed_material,
    material_confirmed, material_confirmed_at, material_confirmed_by, presumed_supplier_id, supplier_confirmed, created_by, created_at)
  values ('a9000000-0000-4000-8000-000000000501', 'a9000000-0000-4000-8000-000000000102', 'a9000000-0000-4000-8000-000000000201',
    'a9000000-0000-4000-8000-000000000401', 'Inox 304L', true, '2000-01-01', 'a9000000-0000-4000-8000-000000000002',
    'a9000000-0000-4000-8000-000000000301', true, 'a9000000-0000-4000-8000-000000000001', '2000-01-01')$$,
  'the engineer who owns the affaire records a request');
select is((select tenant_id from public.material_requests where id = 'a9000000-0000-4000-8000-000000000501'),
  'a9000000-0000-4000-8000-000000000101'::uuid, 'the tenant given by the client is replaced by the affaire''s');
select ok((select material_confirmed and material_confirmed_by = 'a9000000-0000-4000-8000-000000000001'
    and material_confirmed_at > now() - interval '1 hour'
    and supplier_confirmed and supplier_confirmed_by = 'a9000000-0000-4000-8000-000000000001'
  from public.material_requests where id = 'a9000000-0000-4000-8000-000000000501'),
  'a confirmation is stamped with its real author and date, not the client''s');
select throws_ok($$insert into public.material_requests (project_id, technician_id, created_by)
  values ('a9000000-0000-4000-8000-000000000201', 'a9000000-0000-4000-8000-000000000402', 'a9000000-0000-4000-8000-000000000001')$$,
  '23514', 'MATERIAL_REQUEST_TENANT_MISMATCH', 'a request cannot name a technician of another tenant');
select throws_ok($$insert into public.material_requests (project_id, presumed_supplier_id, created_by)
  values ('a9000000-0000-4000-8000-000000000201', 'a9000000-0000-4000-8000-000000000302', 'a9000000-0000-4000-8000-000000000001')$$,
  '23514', 'MATERIAL_REQUEST_TENANT_MISMATCH', 'a request cannot presume a supplier of another tenant');
select throws_ok($$insert into public.material_requests (project_id, created_by)
  values ('a9000000-0000-4000-8000-000000000203', 'a9000000-0000-4000-8000-000000000001')$$,
  '23514', 'MATERIAL_REQUEST_PROJECT_NOT_FOUND', 'a request cannot be recorded on an affaire of another tenant');
select throws_ok($$insert into public.material_requests (project_id, created_by)
  values ('a9000000-0000-4000-8000-000000000201', 'a9000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'a request cannot be recorded in the name of another member');
select throws_ok($$update public.material_requests set project_id = 'a9000000-0000-4000-8000-000000000204'
  where id = 'a9000000-0000-4000-8000-000000000501'$$, '23514', 'MATERIAL_REQUEST_SCOPE_IMMUTABLE',
  'a request does not move to another affaire');

update public.material_requests set presumed_material = 'Acier galvanisé', material_confirmed = true
where id = 'a9000000-0000-4000-8000-000000000501';
select ok((select not material_confirmed and material_confirmed_at is null and material_confirmed_by is null
  from public.material_requests where id = 'a9000000-0000-4000-8000-000000000501'),
  'changing the presumed material withdraws its confirmation, even when the same statement claims it');
update public.material_requests set material_confirmed = true where id = 'a9000000-0000-4000-8000-000000000501';
update public.material_requests set material_confirmed_by = 'a9000000-0000-4000-8000-000000000002',
  material_confirmed_at = '2000-01-01', is_urgent = true where id = 'a9000000-0000-4000-8000-000000000501';
select ok((select material_confirmed and material_confirmed_by = 'a9000000-0000-4000-8000-000000000001'
    and material_confirmed_at > now() - interval '1 hour'
  from public.material_requests where id = 'a9000000-0000-4000-8000-000000000501'),
  'the author and date of a confirmation cannot be rewritten');
update public.material_requests set material_confirmed_by = null where id = 'a9000000-0000-4000-8000-000000000501';
select is((select material_confirmed_by from public.material_requests where id = 'a9000000-0000-4000-8000-000000000501'),
  'a9000000-0000-4000-8000-000000000001'::uuid, 'the author of a confirmation cannot be erased by a client');
update public.material_requests set presumed_material = null, material_confirmed = true
where id = 'a9000000-0000-4000-8000-000000000501';
select is((select material_confirmed from public.material_requests where id = 'a9000000-0000-4000-8000-000000000501'),
  false, 'nothing is confirmed without a presumed material');
update public.material_requests set created_by = 'a9000000-0000-4000-8000-000000000002'
where id = 'a9000000-0000-4000-8000-000000000501';
select is((select created_by from public.material_requests where id = 'a9000000-0000-4000-8000-000000000501'),
  'a9000000-0000-4000-8000-000000000001'::uuid, 'the author of a request cannot be rewritten');

-- 13: known materials.
select is(public.material_request_material_options(), array['Cuivre', 'Inox 304L'],
  'known materials are those of the active tenant, trimmed, once each, sorted, without blanks');

-- 5, 6: lines.
select lives_ok($$insert into public.material_request_lines (id, request_id, position, original_text, quantity, unit, dimension, product_type, material, created_at)
  values ('a9000000-0000-4000-8000-000000000601', 'a9000000-0000-4000-8000-000000000501', 1, '10 coudes 45 DN 20', 10, 'u', 'DN 20', 'Coude 45°', 'Inox 304L', '2000-01-01')$$,
  'the owner writes a draft line');
select throws_ok($$insert into public.material_request_lines (request_id, position, status, unit, dimension, product_type, material)
  values ('a9000000-0000-4000-8000-000000000501', 2, 'validated', 'u', 'DN 20', 'Coude', 'Inox 304L')$$,
  '23514', 'new row for relation "material_request_lines" violates check constraint "material_request_lines_validated_complete_check"', 'a line without quantity cannot be forged as validated');
select throws_ok($$insert into public.material_request_lines (request_id, position, status, quantity, quantity_doubtful, unit, dimension, product_type, material)
  values ('a9000000-0000-4000-8000-000000000501', 2, 'validated', 4, true, 'u', 'DN 20', 'Coude', 'Inox 304L')$$,
  '23514', 'new row for relation "material_request_lines" violates check constraint "material_request_lines_validated_complete_check"', 'a line with a doubtful quantity cannot be forged as validated');
select throws_ok($$insert into public.material_request_lines (request_id, position, status, quantity, unit, dimension, product_type, material)
  values ('a9000000-0000-4000-8000-000000000501', 2, 'validated', 4, '  ', 'DN 20', 'Coude', 'Inox 304L')$$,
  '23514', 'new row for relation "material_request_lines" violates check constraint "material_request_lines_validated_complete_check"', 'a line with a blank unit cannot be forged as validated');
select throws_ok($$insert into public.material_request_lines (request_id, position, status, quantity, unit, dimension, material)
  values ('a9000000-0000-4000-8000-000000000501', 2, 'validated', 4, 'u', 'DN 20', 'Inox 304L')$$,
  '23514', 'new row for relation "material_request_lines" violates check constraint "material_request_lines_validated_complete_check"', 'a line without type cannot be forged as validated');
select throws_ok($$insert into public.material_request_lines (request_id, position, status, quantity, unit, product_type, material)
  values ('a9000000-0000-4000-8000-000000000501', 2, 'validated', 4, 'u', 'Coude', 'Inox 304L')$$,
  '23514', 'new row for relation "material_request_lines" violates check constraint "material_request_lines_validated_complete_check"', 'a line without size cannot be forged as validated');
select lives_ok($$insert into public.material_request_lines (id, request_id, position, status, quantity, unit, product_type, no_dimension, supplier_id, imputation)
  values ('a9000000-0000-4000-8000-000000000602', 'a9000000-0000-4000-8000-000000000501', 2, 'validated', 6, 'u', 'Gants de manutention', true,
    'a9000000-0000-4000-8000-000000000301', 'overhead')$$,
  'an overhead article declared without size can be validated, in no material');
select throws_ok($$insert into public.material_request_lines (request_id, position, quantity)
  values ('a9000000-0000-4000-8000-000000000501', 3, 0)$$, '23514', null, 'a quantity is above zero or absent');
select throws_ok($$update public.material_request_lines set status = 'validated', quantity = null
  where id = 'a9000000-0000-4000-8000-000000000601'$$, '23514', null,
  'a draft line cannot be validated by an update that leaves it incomplete');

update public.material_request_lines set status = 'validated', validated_by = 'a9000000-0000-4000-8000-000000000002',
  validated_at = '2000-01-01' where id = 'a9000000-0000-4000-8000-000000000601';
select ok((select status = 'validated' and validated_by = 'a9000000-0000-4000-8000-000000000001'
    and validated_at > now() - interval '1 hour'
  from public.material_request_lines where id = 'a9000000-0000-4000-8000-000000000601'),
  'a validation is stamped with its real author and date, not the client''s');
update public.material_request_lines set validated_by = null, validated_at = '2000-01-01', duplicate_acknowledged = true, position = 4
where id = 'a9000000-0000-4000-8000-000000000601';
select ok((select status = 'validated' and validated_by = 'a9000000-0000-4000-8000-000000000001'
    and validated_at > now() - interval '1 hour' and duplicate_acknowledged and position = 4
  from public.material_request_lines where id = 'a9000000-0000-4000-8000-000000000601'),
  'acknowledging a duplicate or moving a line keeps its validation and its stamps');
update public.material_request_lines set quantity = 12, status = 'validated' where id = 'a9000000-0000-4000-8000-000000000601';
select ok((select status = 'draft' and validated_at is null and validated_by is null and quantity = 12
  from public.material_request_lines where id = 'a9000000-0000-4000-8000-000000000601'),
  'editing a validated line returns it to draft and clears its stamps, even when the statement keeps it validated');
insert into public.material_request_lines (id, request_id, position, validated_at, validated_by)
values ('a9000000-0000-4000-8000-000000000603', 'a9000000-0000-4000-8000-000000000501', 3, '2000-01-01', 'a9000000-0000-4000-8000-000000000002');
select ok((select status = 'draft' and validated_at is null and validated_by is null
  from public.material_request_lines where id = 'a9000000-0000-4000-8000-000000000603'),
  'a draft line carries no validation stamp, whatever the client sends');

-- 16: a line is validated in a material. At this point the request presumes none.
insert into public.material_request_lines (id, request_id, position, quantity, unit, dimension, product_type)
values ('a9000000-0000-4000-8000-000000000605', 'a9000000-0000-4000-8000-000000000501', 6, 8, 'u', 'DN 32', 'Manchon');
update public.material_request_lines set status = 'validated' where id = 'a9000000-0000-4000-8000-000000000601';
select throws_ok($$update public.material_request_lines set status = 'validated' where id = 'a9000000-0000-4000-8000-000000000605'$$,
  '23514', 'MATERIAL_REQUEST_LINE_MATERIAL_MISSING', 'a line that names no material is not validated when the request presumes none');
select throws_ok($$insert into public.material_request_lines (request_id, position, status, quantity, unit, dimension, product_type)
  values ('a9000000-0000-4000-8000-000000000501', 7, 'validated', 8, 'u', 'DN 32', 'Manchon')$$,
  '23514', 'MATERIAL_REQUEST_LINE_MATERIAL_MISSING', 'nor recorded as validated');
update public.material_requests set presumed_material = 'Cuivre' where id = 'a9000000-0000-4000-8000-000000000501';
select throws_ok($$update public.material_request_lines set status = 'validated' where id = 'a9000000-0000-4000-8000-000000000605'$$,
  '23514', 'MATERIAL_REQUEST_LINE_MATERIAL_UNCONFIRMED', 'a presumed material nobody confirmed does not validate a line');
update public.material_requests set material_confirmed = true where id = 'a9000000-0000-4000-8000-000000000501';
select lives_ok($$update public.material_request_lines set status = 'validated' where id = 'a9000000-0000-4000-8000-000000000605'$$,
  'a confirmed presumed material validates the line that relies on it');
update public.material_requests set note = 'Livrer au portail', is_urgent = false where id = 'a9000000-0000-4000-8000-000000000501';
select is((select status from public.material_request_lines where id = 'a9000000-0000-4000-8000-000000000605'), 'validated',
  'another change to the request leaves its validated lines alone');
update public.material_requests set presumed_material = 'Acier galvanisé' where id = 'a9000000-0000-4000-8000-000000000501';
select ok((select status = 'draft' and validated_at is null and validated_by is null
  from public.material_request_lines where id = 'a9000000-0000-4000-8000-000000000605'),
  'changing the presumed material returns to draft the validated line that relied on it, stamps cleared');
select is((select array_agg(id::text order by position) from public.material_request_lines
  where request_id = 'a9000000-0000-4000-8000-000000000501' and status = 'validated'),
  array['a9000000-0000-4000-8000-000000000602', 'a9000000-0000-4000-8000-000000000601'],
  'a validated line with its own material, and an overhead line, stay validated');
update public.material_requests set material_confirmed = true where id = 'a9000000-0000-4000-8000-000000000501';
select is((select status from public.material_request_lines where id = 'a9000000-0000-4000-8000-000000000605'), 'draft',
  'confirming the new material does not validate the line again: an operator must');
update public.material_request_lines set status = 'validated' where id = 'a9000000-0000-4000-8000-000000000605';
update public.material_requests set material_confirmed = false where id = 'a9000000-0000-4000-8000-000000000501';
select is((select status from public.material_request_lines where id = 'a9000000-0000-4000-8000-000000000605'), 'draft',
  'withdrawing the confirmation returns the line to draft');
update public.material_requests set material_confirmed = true where id = 'a9000000-0000-4000-8000-000000000501';
update public.material_request_lines set status = 'validated' where id = 'a9000000-0000-4000-8000-000000000605';
update public.material_requests set presumed_material = null where id = 'a9000000-0000-4000-8000-000000000501';
select is((select status from public.material_request_lines where id = 'a9000000-0000-4000-8000-000000000605'), 'draft',
  'clearing the presumed material returns the line to draft');
update public.material_request_lines set material = 'Laiton', status = 'validated' where id = 'a9000000-0000-4000-8000-000000000605';
select is((select status from public.material_request_lines where id = 'a9000000-0000-4000-8000-000000000605'), 'validated',
  'a line that names its material is validated whatever the request presumes');
insert into public.material_request_lines (id, request_id, position, quantity, unit, dimension, product_type, material, status)
values ('a9000000-0000-4000-8000-000000000606', 'a9000000-0000-4000-8000-000000000501', 7, 8, 'u', 'DN 32', 'Manchon', 'Laiton', 'validated');
select is((select status from public.material_request_lines where id = 'a9000000-0000-4000-8000-000000000606'), 'validated',
  'the database does not look for duplicates: two identical lines are both validated here, the application refuses it');
delete from public.material_request_lines where id = 'a9000000-0000-4000-8000-000000000606';

-- 14: positions.
select throws_ok($$insert into public.material_request_lines (request_id, position, product_type)
  values ('a9000000-0000-4000-8000-000000000501', 2, 'Coude')$$, '23505', null,
  'two lines of a request cannot share a position');
select throws_ok($$update public.material_request_lines set position = 2 where id = 'a9000000-0000-4000-8000-000000000603'$$,
  '23505', null, 'a line cannot be moved onto the position of another');

-- 8: lines and scope.
select throws_ok($$insert into public.material_request_lines (request_id, position, supplier_id)
  values ('a9000000-0000-4000-8000-000000000501', 9, 'a9000000-0000-4000-8000-000000000302')$$,
  '23514', 'MATERIAL_REQUEST_TENANT_MISMATCH', 'a line cannot name a supplier of another tenant');
select throws_ok($$insert into public.material_request_lines (request_id, position)
  values ('a9000000-0000-4000-8000-000000000503', 9)$$,
  '23514', 'MATERIAL_REQUEST_NOT_FOUND', 'a line cannot be added to a request of another tenant');
select throws_ok($$insert into public.material_request_lines (request_id, position)
  values ('a9000000-0000-4000-8000-000000000502', 9)$$,
  '23514', 'MATERIAL_REQUEST_NOT_FOUND', 'a line cannot be added to a request of an affaire the member cannot read');
select throws_ok($$update public.material_request_lines set request_id = 'a9000000-0000-4000-8000-000000000502'
  where id = 'a9000000-0000-4000-8000-000000000603'$$, '23514', 'MATERIAL_REQUEST_SCOPE_IMMUTABLE',
  'a line does not move to another request');
select is((select count(*) from public.material_request_lines where request_id <> 'a9000000-0000-4000-8000-000000000501'),
  0::bigint, 'the owner reads no line of another affaire or tenant');

-- 10: originals.
select lives_ok($$insert into public.material_request_files (id, request_id, storage_path, file_name, mime_type, byte_size, created_by, created_at)
  values ('a9000000-0000-4000-8000-000000000701', 'a9000000-0000-4000-8000-000000000501',
    'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000701/demande.jpg',
    'demande.jpg', 'image/jpeg', 2048, 'a9000000-0000-4000-8000-000000000001', '2000-01-01')$$, 'the owner records an original');
-- 18: creation dates.
update public.material_requests set created_at = '2000-01-01' where id = 'a9000000-0000-4000-8000-000000000501';
update public.material_request_lines set created_at = '2000-01-01' where id = 'a9000000-0000-4000-8000-000000000601';
update public.material_request_technicians set created_at = '2000-01-01' where id = 'a9000000-0000-4000-8000-000000000401';
select is((select count(*) from (
    select created_at from public.material_request_technicians where id = 'a9000000-0000-4000-8000-000000000401'
    union all select created_at from public.material_requests where id = 'a9000000-0000-4000-8000-000000000501'
    union all select created_at from public.material_request_lines where id = 'a9000000-0000-4000-8000-000000000601'
    union all select created_at from public.material_request_files where id = 'a9000000-0000-4000-8000-000000000701'
  ) stamped where created_at > now() - interval '1 hour'), 4::bigint,
  'a technician, a request, a line and an original are dated by the database, at creation and for good');
select lives_ok($$insert into public.material_request_files (id, request_id, storage_path, file_name, mime_type, byte_size, created_by)
  values ('a9000000-0000-4000-8000-000000000702', 'a9000000-0000-4000-8000-000000000501',
    'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000702/suite.png',
    'suite.png', 'image/png', 4096, 'a9000000-0000-4000-8000-000000000001')$$, 'the owner records a second original');
select throws_ok($$insert into public.material_request_files (id, request_id, storage_path, file_name, mime_type, byte_size, created_by)
  values ('a9000000-0000-4000-8000-000000000703', 'a9000000-0000-4000-8000-000000000501',
    'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000701/autre.jpg',
    'autre.jpg', 'image/jpeg', 2048, 'a9000000-0000-4000-8000-000000000001')$$,
  '23514', 'MATERIAL_REQUEST_FILE_PATH_INVALID', 'an original is stored under its own row, not another''s');
select throws_ok($$insert into public.material_request_files (id, request_id, storage_path, file_name, mime_type, byte_size, created_by)
  values ('a9000000-0000-4000-8000-000000000703', 'a9000000-0000-4000-8000-000000000501',
    'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000703/sous/dossier.jpg',
    'dossier.jpg', 'image/jpeg', 2048, 'a9000000-0000-4000-8000-000000000001')$$,
  '23514', 'MATERIAL_REQUEST_FILE_PATH_INVALID', 'an original is one file name under its row, not a folder');
select throws_ok($$insert into public.material_request_files (id, request_id, storage_path, file_name, mime_type, byte_size, created_by)
  values ('a9000000-0000-4000-8000-000000000703', 'a9000000-0000-4000-8000-000000000501',
    'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000703/photo.heic',
    'photo.heic', 'image/heic', 2048, 'a9000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'only JPEG, PNG and WebP originals are recorded');
select throws_ok($$insert into public.material_request_files (id, request_id, storage_path, file_name, mime_type, byte_size, created_by)
  values ('a9000000-0000-4000-8000-000000000703', 'a9000000-0000-4000-8000-000000000501',
    'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000703/grand.jpg',
    'grand.jpg', 'image/jpeg', 20971521, 'a9000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'an original above 20 MiB is refused');
-- 15: an original is visible only once its bytes are stored.
select is((select count(*) from public.material_request_files where stored_at is not null), 0::bigint,
  'a recorded original is not stored yet');
select throws_ok($$insert into public.material_request_files (id, request_id, storage_path, file_name, mime_type, byte_size, created_by, stored_at)
  values ('a9000000-0000-4000-8000-000000000705', 'a9000000-0000-4000-8000-000000000501',
    'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000705/forge.jpg',
    'forge.jpg', 'image/jpeg', 2048, 'a9000000-0000-4000-8000-000000000001', now())$$,
  '23514', 'MATERIAL_REQUEST_FILE_NOT_STORED', 'an original cannot be recorded as already stored');
select throws_ok($$update public.material_request_files set rotation = 90 where id = 'a9000000-0000-4000-8000-000000000701'$$,
  '23514', 'MATERIAL_REQUEST_FILE_NOT_STORED', 'an original is not turned before its bytes are stored');
select throws_ok($$update public.material_request_files set stored_at = now() where id = 'a9000000-0000-4000-8000-000000000701'$$,
  '23514', 'MATERIAL_REQUEST_FILE_NOT_STORED', 'an original cannot be marked stored while storage holds no bytes for it');
select lives_ok($$insert into storage.objects (bucket_id, name, metadata) values ('material-requests',
  'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000701/demande.jpg',
  '{"size":2048}')$$, 'the owner stores the bytes of the original they recorded');
select throws_ok($$update public.material_request_files set stored_at = now(), rotation = 90
  where id = 'a9000000-0000-4000-8000-000000000701'$$,
  '23514', 'MATERIAL_REQUEST_FILE_NOT_STORED', 'marking an original stored does not turn it in the same statement');
update public.material_request_files set stored_at = '2000-01-01' where id = 'a9000000-0000-4000-8000-000000000701';
select ok((select stored_at > now() - interval '1 hour' from public.material_request_files where id = 'a9000000-0000-4000-8000-000000000701'),
  'an original is marked stored at the real time, not the one the client chose');
select set_config('test.material_request_stored_at',
  (select stored_at::text from public.material_request_files where id = 'a9000000-0000-4000-8000-000000000701'), true);
update public.material_request_files set stored_at = null where id = 'a9000000-0000-4000-8000-000000000701';
update public.material_request_files set stored_at = '2000-01-01' where id = 'a9000000-0000-4000-8000-000000000701';
select is((select stored_at::text from public.material_request_files where id = 'a9000000-0000-4000-8000-000000000701'),
  current_setting('test.material_request_stored_at'), 'a stored original cannot be unmarked or given another date');
select throws_ok($$update public.material_request_files set stored_at = now() where id = 'a9000000-0000-4000-8000-000000000702'$$,
  '23514', 'MATERIAL_REQUEST_FILE_NOT_STORED', 'the bytes of one original do not make another one stored');
select lives_ok($$update public.material_request_files set rotation = 90 where id = 'a9000000-0000-4000-8000-000000000701'$$,
  'the owner turns a stored original');
select throws_ok($$update public.material_request_files set rotation = 45 where id = 'a9000000-0000-4000-8000-000000000701'$$,
  '23514', null, 'an original turns by quarter turns only');
select throws_ok($$update public.material_request_files set file_name = 'autre.jpg' where id = 'a9000000-0000-4000-8000-000000000701'$$,
  '23514', 'MATERIAL_REQUEST_FILE_IMMUTABLE', 'only the rotation of an original changes');
select throws_ok($$insert into storage.objects (bucket_id, name, metadata) values ('material-requests',
  'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000799/sans-ligne.jpg',
  '{"size":2048}')$$, '23503', 'MATERIAL_REQUEST_FILE_ROW_REQUIRED', 'no object is stored without its recorded original');
select is((select count(*) from storage.objects where bucket_id = 'material-requests'), 1::bigint,
  'the owner reads the stored original');
select ok((select qual not like '%stored_at%' and qual like '%can_read_affaire_intake_project%' from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and policyname = 'Affaire readers view material request storage'),
  'reading stored bytes follows the affaire, not the stored mark');
-- 19: nobody replaces stored bytes, and only who may write deletes them.
select is((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
    and cmd in ('UPDATE', 'ALL') and coalesce(qual, '') || coalesce(with_check, '') like '%material-requests%'), 0::bigint,
  'no policy lets anyone update an object of the originals bucket');
select is((select array_agg(policyname::text) from pg_policies where schemaname = 'storage' and tablename = 'objects'
    and cmd = 'DELETE' and qual like '%material-requests%'), array['Affaire operators delete material request storage'],
  'one policy deletes objects of the originals bucket');
select ok((select qual like '%can_access_affaire_intake_project%' and qual like '%has_tenant_role%'
    and qual not like '%can_read_affaire_intake_project%'
  from pg_policies where schemaname = 'storage' and tablename = 'objects'
    and policyname = 'Affaire operators delete material request storage'),
  'deleting stored bytes asks for the right to write, not to read');
with replaced as (update storage.objects set metadata = '{"size":1}' where bucket_id = 'material-requests' returning id)
select is((select count(*) from replaced), 0::bigint, 'the writer who stored an original cannot replace it');

-- 20, 21, 23: the guards on storage.objects. Signed uploads are performed by Storage itself, whatever the
-- caller could do: the service role stands for it here.
insert into public.material_request_files (id, request_id, storage_path, file_name, mime_type, byte_size, created_by) values
  ('a9000000-0000-4000-8000-000000000706', 'a9000000-0000-4000-8000-000000000501', 'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000706/en-cours.jpg', 'en-cours.jpg', 'image/jpeg', 2048, 'a9000000-0000-4000-8000-000000000001'),
  ('a9000000-0000-4000-8000-000000000707', 'a9000000-0000-4000-8000-000000000501', 'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000707/annulee.jpg', 'annulee.jpg', 'image/jpeg', 2048, 'a9000000-0000-4000-8000-000000000001');
select throws_ok($$insert into storage.objects (bucket_id, name, metadata) values ('material-requests',
  'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000701/demande.jpg', '{"size":2048}')$$,
  '23514', 'MATERIAL_REQUEST_FILE_ALREADY_STORED', 'no object is created again at the path of a stored original');
reset role;
set local role service_role;
select throws_ok($$insert into storage.objects (bucket_id, name, metadata) values ('material-requests',
  'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000799/sans-ligne.jpg', '{"size":2048}')$$,
  '23503', 'MATERIAL_REQUEST_FILE_ROW_REQUIRED', 'a signed upload whose row is gone stores nothing, whoever performs it');
select throws_ok($$insert into storage.objects (bucket_id, name, metadata) values ('material-requests',
  'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000202/a9000000-0000-4000-8000-000000000502/a9000000-0000-4000-8000-000000000706/en-cours.jpg', '{"size":2048}')$$,
  '23503', 'MATERIAL_REQUEST_FILE_ROW_REQUIRED', 'nor under the path of another request');
select throws_ok($$insert into storage.objects (bucket_id, name, metadata) values ('material-requests',
  'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000701/demande.jpg', '{"size":2048}')$$,
  '23514', 'MATERIAL_REQUEST_FILE_ALREADY_STORED', 'nor over a stored original, whoever performs it');
select lives_ok($$insert into storage.objects (bucket_id, name, metadata) values ('material-requests',
  'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000706/en-cours.jpg', '{"size":2047}')$$, 'a signed upload lands beside its row while that row is not stored');
select lives_ok($$insert into storage.objects (bucket_id, name, metadata) values ('affaire-intake',
  'fixture/material-request-guard.txt', '{"size":1}')$$, 'the guards leave every other bucket alone: an insert there still works');
select lives_ok($$update storage.objects set metadata = '{"size":2}' where bucket_id = 'affaire-intake'
  and name = 'fixture/material-request-guard.txt'$$, 'and so does an update there');
select throws_ok($$update storage.objects set metadata = '{"size":1}' where bucket_id = 'material-requests'
  and name = 'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000701/demande.jpg'$$,
  '23514', 'MATERIAL_REQUEST_FILE_ALREADY_STORED', 'the bytes of a stored original are not updated, even by the service role');
select throws_ok($$update storage.objects set name = name || '.bak' where bucket_id = 'material-requests'
  and name = 'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000706/en-cours.jpg'$$,
  '23514', 'MATERIAL_REQUEST_FILE_MOVE_FORBIDDEN', 'an object of this bucket is not moved');
select throws_ok($$update storage.objects set bucket_id = 'material-requests', name = 'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000707/annulee.jpg'
  where bucket_id = 'affaire-intake' and name = 'fixture/material-request-guard.txt'$$,
  '23514', 'MATERIAL_REQUEST_FILE_MOVE_FORBIDDEN', 'nor is an object of another bucket moved into it');
select lives_ok($$update storage.objects set last_accessed_at = now() where bucket_id = 'material-requests'
  and name = 'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000701/demande.jpg'$$, 'a read that only dates the object of a stored original still works');
reset role;
set local role authenticated;

select throws_ok($$update public.material_request_files set stored_at = now() where id = 'a9000000-0000-4000-8000-000000000706'$$,
  '23514', 'MATERIAL_REQUEST_FILE_SIZE_MISMATCH', 'bytes of another size than announced are not marked stored');
reset role;
set local role service_role;
select lives_ok($$update storage.objects set metadata = '{"size":2048}' where bucket_id = 'material-requests'
  and name = 'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000706/en-cours.jpg'$$, 'Storage still completes the object of a row that is not stored');
reset role;
set local role authenticated;

-- A row whose deletion has begun: withdrawn once, for good, at the database's time.
update public.material_request_files set removed_at = '2000-01-01' where id = 'a9000000-0000-4000-8000-000000000707';
update public.material_request_files set removed_at = null where id = 'a9000000-0000-4000-8000-000000000707';
select ok((select removed_at > now() - interval '1 hour' from public.material_request_files where id = 'a9000000-0000-4000-8000-000000000707'),
  'a withdrawn original stays withdrawn, since the real time it was');
select throws_ok($$insert into public.material_request_files (id, request_id, storage_path, file_name, mime_type, byte_size, created_by, removed_at)
  values ('a9000000-0000-4000-8000-000000000708', 'a9000000-0000-4000-8000-000000000501', 'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000708/retiree.jpg', 'retiree.jpg', 'image/jpeg', 2048,
    'a9000000-0000-4000-8000-000000000001', now())$$, '23514', 'MATERIAL_REQUEST_FILE_NOT_STORED', 'an original is not recorded already withdrawn');
select throws_ok($$update public.material_request_files set stored_at = now() where id = 'a9000000-0000-4000-8000-000000000707'$$,
  '23514', 'MATERIAL_REQUEST_FILE_NOT_STORED', 'a withdrawn original is never marked stored');
reset role;
set local role service_role;
select throws_ok($$insert into storage.objects (bucket_id, name, metadata) values ('material-requests',
  'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000707/annulee.jpg', '{"size":2048}')$$,
  '23514', 'MATERIAL_REQUEST_FILE_REMOVED', 'an upload that finishes after its original was cancelled stores nothing');
reset role;
set local role authenticated;

-- Deleting stored bytes. The local Storage API sets this for its own transactional delete.
select set_config('storage.allow_delete_query', 'true', true);
update public.material_request_files set stored_at = now() where id = 'a9000000-0000-4000-8000-000000000706';
select throws_ok($$delete from storage.objects where bucket_id = 'material-requests'
  and name = 'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000706/en-cours.jpg'$$,
  '23514', 'MATERIAL_REQUEST_FILE_DELETE_THROUGH_APPLICATION', 'the object of a listed original is not deleted directly, even by who may write');
select throws_ok($$update public.material_request_files set rotation = 90, removed_at = now() where id = 'a9000000-0000-4000-8000-000000000706'$$,
  '23514', 'MATERIAL_REQUEST_FILE_NOT_STORED', 'withdrawing an original does not turn it in the same statement');
update public.material_request_files set removed_at = now() where id = 'a9000000-0000-4000-8000-000000000706';
select throws_ok($$update public.material_request_files set rotation = 90 where id = 'a9000000-0000-4000-8000-000000000706'$$,
  '23514', 'MATERIAL_REQUEST_FILE_NOT_STORED', 'a withdrawn original is not turned');
with removed as (delete from storage.objects where bucket_id = 'material-requests'
  and name = 'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000706/en-cours.jpg' returning id)
select is((select count(*) from removed), 1::bigint, 'once its row is withdrawn, the object of an original is deleted by who may write');
delete from public.material_request_files where id in ('a9000000-0000-4000-8000-000000000706', 'a9000000-0000-4000-8000-000000000707');
select is((select count(*) from storage.objects where bucket_id = 'material-requests'), 1::bigint,
  'the stored original of the request is still there');
reset role;

-- 4: an admin works on an affaire they do not own.
select set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a9000000-0000-4000-8000-000000000002"}', true);
set local role authenticated;
select is((select count(*) from public.material_requests), 2::bigint, 'an admin reads the requests of every affaire of the tenant');
with changed as (update public.material_requests set is_urgent = true where id = 'a9000000-0000-4000-8000-000000000502' returning id)
select is((select count(*) from changed), 1::bigint, 'an admin changes a request of an affaire they do not own');
select lives_ok($$insert into public.material_request_lines (id, request_id, position, quantity, unit, product_type, no_dimension, status, imputation)
  values ('a9000000-0000-4000-8000-000000000604', 'a9000000-0000-4000-8000-000000000501', 5, 2, 'u', 'Casque de chantier', true, 'validated', 'overhead')$$,
  'an admin adds and validates a line');
select throws_ok($$insert into storage.objects (bucket_id, name, metadata) values ('material-requests',
  'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000702/suite.png',
  '{"size":4096}')$$, '42501', null, 'the bytes of an original are stored by the member who recorded it');
reset role;

-- 2: a director reads and never writes, even on the affaire they own.
select set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a9000000-0000-4000-8000-000000000003"}', true);
set local role authenticated;
select is((select count(*) from public.material_requests), 2::bigint, 'a director reads the requests of the tenant');
select is((select count(*) from public.material_request_lines where request_id = 'a9000000-0000-4000-8000-000000000501'),
  5::bigint, 'a director reads their lines');
select is((select count(*) from public.material_request_files), 2::bigint, 'a director reads their originals');
select is((select count(*) from storage.objects where bucket_id = 'material-requests'), 1::bigint, 'a director reads the stored original');
select throws_ok($$insert into public.material_requests (project_id, created_by)
  values ('a9000000-0000-4000-8000-000000000204', 'a9000000-0000-4000-8000-000000000003')$$,
  '42501', null, 'a director cannot record a request, even on the affaire they own');
with changed as (update public.material_requests set is_urgent = false where id = 'a9000000-0000-4000-8000-000000000501' returning id)
select is((select count(*) from changed), 0::bigint, 'a director cannot change a request');
with removed as (delete from public.material_requests where id = 'a9000000-0000-4000-8000-000000000501' returning id)
select is((select count(*) from removed), 0::bigint, 'a director cannot delete a request');
select throws_ok($$insert into public.material_request_lines (request_id, position)
  values ('a9000000-0000-4000-8000-000000000501', 9)$$, '42501', null, 'a director cannot add a line');
with changed as (update public.material_request_lines set status = 'validated' where id = 'a9000000-0000-4000-8000-000000000603' returning id)
select is((select count(*) from changed), 0::bigint, 'a director cannot change or validate a line');
with removed as (delete from public.material_request_lines where request_id = 'a9000000-0000-4000-8000-000000000501' returning id)
select is((select count(*) from removed), 0::bigint, 'a director cannot delete a line');
select throws_ok($$insert into public.material_request_files (id, request_id, storage_path, file_name, mime_type, byte_size, created_by)
  values ('a9000000-0000-4000-8000-000000000704', 'a9000000-0000-4000-8000-000000000501',
    'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000704/directeur.jpg',
    'directeur.jpg', 'image/jpeg', 2048, 'a9000000-0000-4000-8000-000000000003')$$, '42501', null, 'a director cannot record an original');
with changed as (update public.material_request_files set rotation = 180 returning id)
select is((select count(*) from changed), 0::bigint, 'a director cannot turn an original');
with removed as (delete from public.material_request_files returning id)
select is((select count(*) from removed), 0::bigint, 'a director cannot delete an original');
with removed as (delete from storage.objects where bucket_id = 'material-requests' returning id)
select is((select count(*) from removed), 0::bigint, 'a director, who reads the stored bytes, cannot delete them');
with changed as (update public.material_request_files set removed_at = now() returning id)
select is((select count(*) from changed), 0::bigint, 'nor withdraw an original');
select is((select count(*) from public.material_request_technicians), 1::bigint, 'a director reads the technicians of the tenant');
select throws_ok($$insert into public.material_request_technicians (name, created_by)
  values ('Technicien Delta', 'a9000000-0000-4000-8000-000000000003')$$, '42501', null, 'a director cannot add a technician');
with changed as (update public.material_request_technicians set is_active = false returning id)
select is((select count(*) from changed), 0::bigint, 'a director cannot change a technician');
reset role;

-- 2: a viewer reads the technicians and nothing of an affaire that is not theirs.
select set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a9000000-0000-4000-8000-000000000004"}', true);
set local role authenticated;
select is((select count(*) from public.material_requests) + (select count(*) from public.material_request_lines)
  + (select count(*) from public.material_request_files)
  + (select count(*) from storage.objects where bucket_id = 'material-requests'), 0::bigint,
  'a viewer reads no request, line or original of an affaire that is not theirs');
select is((select count(*) from public.material_request_technicians), 1::bigint, 'a viewer reads the technicians of the tenant');
select throws_ok($$insert into public.material_requests (project_id, created_by)
  values ('a9000000-0000-4000-8000-000000000201', 'a9000000-0000-4000-8000-000000000004')$$,
  '23514', 'MATERIAL_REQUEST_PROJECT_NOT_FOUND', 'a viewer cannot record a request');
select throws_ok($$insert into public.material_request_lines (request_id, position)
  values ('a9000000-0000-4000-8000-000000000501', 9)$$, '23514', 'MATERIAL_REQUEST_NOT_FOUND', 'a viewer cannot add a line');
with changed as (update public.material_request_lines set status = 'validated' where id = 'a9000000-0000-4000-8000-000000000603' returning id)
select is((select count(*) from changed), 0::bigint, 'a viewer cannot change a line');
select throws_ok($$insert into public.material_request_technicians (name, created_by)
  values ('Technicien Echo', 'a9000000-0000-4000-8000-000000000004')$$, '42501', null, 'a viewer cannot add a technician');
with changed as (update public.material_request_technicians set name = 'Renommé' returning id)
select is((select count(*) from changed), 0::bigint, 'a viewer cannot change a technician');
reset role;

-- 3: an engineer who does not own the affaire.
select set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000005', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a9000000-0000-4000-8000-000000000005"}', true);
set local role authenticated;
select is((select array_agg(id::text) from public.material_requests), array['a9000000-0000-4000-8000-000000000502'],
  'an engineer reads the requests of their own affaire only');
select is((select count(*) from public.material_request_lines where request_id = 'a9000000-0000-4000-8000-000000000501')
  + (select count(*) from public.material_request_files)
  + (select count(*) from storage.objects where bucket_id = 'material-requests'), 0::bigint,
  'an engineer reads no line or original of an affaire they do not own');
select throws_ok($$insert into public.material_requests (project_id, created_by)
  values ('a9000000-0000-4000-8000-000000000201', 'a9000000-0000-4000-8000-000000000005')$$,
  '23514', 'MATERIAL_REQUEST_PROJECT_NOT_FOUND', 'an engineer cannot record a request on an affaire they do not own');
with changed as (update public.material_requests set is_urgent = false where id = 'a9000000-0000-4000-8000-000000000501' returning id)
select is((select count(*) from changed), 0::bigint, 'an engineer cannot change a request of an affaire they do not own');
with removed as (delete from public.material_requests where id = 'a9000000-0000-4000-8000-000000000501' returning id)
select is((select count(*) from removed), 0::bigint, 'an engineer cannot delete a request of an affaire they do not own');
select throws_ok($$insert into public.material_request_lines (request_id, position)
  values ('a9000000-0000-4000-8000-000000000501', 9)$$, '23514', 'MATERIAL_REQUEST_NOT_FOUND',
  'an engineer cannot add a line to a request of an affaire they do not own');
with changed as (update public.material_request_lines set quantity = 99 where request_id = 'a9000000-0000-4000-8000-000000000501' returning id)
select is((select count(*) from changed), 0::bigint, 'an engineer cannot change a line of an affaire they do not own');
with removed as (delete from public.material_request_lines where request_id = 'a9000000-0000-4000-8000-000000000501' returning id)
select is((select count(*) from removed), 0::bigint, 'an engineer cannot delete a line of an affaire they do not own');
select throws_ok($$insert into storage.objects (bucket_id, name, metadata) values ('material-requests',
  'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000702/suite.png',
  '{"size":4096}')$$, '42501', null, 'an engineer cannot store an original on an affaire they do not own');
-- 17: the technician was placed by another engineer on an affaire this one cannot read.
with changed as (update public.material_request_technicians set name = 'Technicien Bravo (renommé)', is_active = false
  where id = 'a9000000-0000-4000-8000-000000000401' returning id)
select is((select count(*) from changed), 1::bigint,
  'an engineer renames and deactivates a technician placed on an affaire they cannot read');
select is((select current_project_id from public.material_request_technicians where id = 'a9000000-0000-4000-8000-000000000401'),
  'a9000000-0000-4000-8000-000000000201'::uuid, 'and the technician stays on that affaire');
select throws_ok($$update public.material_request_technicians set current_project_id = 'a9000000-0000-4000-8000-000000000203'
  where id = 'a9000000-0000-4000-8000-000000000401'$$, '23514', 'MATERIAL_REQUEST_TENANT_MISMATCH',
  'moving a technician is still checked: not onto an affaire of another tenant');
select lives_ok($$update public.material_request_technicians set current_project_id = 'a9000000-0000-4000-8000-000000000202', is_active = true
  where id = 'a9000000-0000-4000-8000-000000000401'$$, 'an engineer moves a technician onto their own affaire');
with changed as (update public.material_request_lines set quantity = 3, unit = 'u' where id = 'a9000000-0000-4000-8000-000000000650' returning id)
select is((select count(*) from changed), 1::bigint, 'the same engineer works on the request of their own affaire');
reset role;

-- 1: a member of another tenant.
select set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000006', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a9000000-0000-4000-8000-000000000006"}', true);
set local role authenticated;
select is((select count(*) from public.material_requests where tenant_id = 'a9000000-0000-4000-8000-000000000101')
  + (select count(*) from public.material_request_lines where tenant_id = 'a9000000-0000-4000-8000-000000000101')
  + (select count(*) from public.material_request_files)
  + (select count(*) from public.material_request_technicians where tenant_id = 'a9000000-0000-4000-8000-000000000101')
  + (select count(*) from storage.objects where bucket_id = 'material-requests'), 0::bigint,
  'a member of another tenant reads no request, line, original or technician');
select is((select count(*) from public.material_requests), 1::bigint, 'that member still reads the request of their own tenant');
select is(public.material_request_material_options(), array['PVC pression'], 'that member sees the materials of their own tenant only');
select throws_ok($$insert into public.material_requests (project_id, created_by)
  values ('a9000000-0000-4000-8000-000000000201', 'a9000000-0000-4000-8000-000000000006')$$,
  '23514', 'MATERIAL_REQUEST_PROJECT_NOT_FOUND', 'a member of another tenant cannot record a request');
select throws_ok($$insert into public.material_request_lines (request_id, position)
  values ('a9000000-0000-4000-8000-000000000501', 9)$$, '23514', 'MATERIAL_REQUEST_NOT_FOUND',
  'a member of another tenant cannot add a line');
with changed as (update public.material_request_lines set quantity = 99 where tenant_id = 'a9000000-0000-4000-8000-000000000101' returning id)
select is((select count(*) from changed), 0::bigint, 'a member of another tenant cannot change a line');
with removed as (delete from public.material_requests where tenant_id = 'a9000000-0000-4000-8000-000000000101' returning id)
select is((select count(*) from removed), 0::bigint, 'a member of another tenant cannot delete a request');
with changed as (update public.material_request_technicians set is_active = false where id = 'a9000000-0000-4000-8000-000000000401' returning id)
select is((select count(*) from changed), 0::bigint, 'a member of another tenant cannot change a technician');
select throws_ok($$insert into public.material_request_technicians (tenant_id, name, created_by)
  values ('a9000000-0000-4000-8000-000000000101', 'Technicien Foxtrot', 'a9000000-0000-4000-8000-000000000006')$$,
  '42501', null, 'a member of another tenant cannot add a technician to the tenant');
select throws_ok($$insert into storage.objects (bucket_id, name, metadata) values ('material-requests',
  'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000201/a9000000-0000-4000-8000-000000000501/a9000000-0000-4000-8000-000000000702/suite.png',
  '{"size":4096}')$$, '42501', null, 'a member of another tenant cannot store an original');
reset role;

-- 12: anonymous callers.
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$select count(*) from public.material_requests$$, '42501', null, 'an anonymous caller cannot read requests');
select throws_ok($$select count(*) from public.material_request_lines$$, '42501', null, 'an anonymous caller cannot read lines');
select throws_ok($$select count(*) from public.material_request_files$$, '42501', null, 'an anonymous caller cannot read originals');
select throws_ok($$select count(*) from public.material_request_technicians$$, '42501', null, 'an anonymous caller cannot read technicians');
select throws_ok($$select public.material_request_material_options()$$, '42501', null, 'an anonymous caller cannot list materials');
reset role;

-- 22: twelve stored originals per request, and a bound on rows waiting for their bytes.
insert into public.material_request_files (id, request_id, storage_path, file_name, mime_type, byte_size)
select id, 'a9000000-0000-4000-8000-000000000502',
  'a9000000-0000-4000-8000-000000000101/a9000000-0000-4000-8000-000000000202/a9000000-0000-4000-8000-000000000502/' || id || '/photo.jpg',
  'photo.jpg', 'image/jpeg', 2048
from (select ('a9000000-0000-4000-8000-0000000008' || lpad(n::text, 2, '0'))::uuid as id from generate_series(1, 13) n) photos;
insert into storage.objects (bucket_id, name, metadata)
select 'material-requests', storage_path, '{"size":2048}' from public.material_request_files
where request_id = 'a9000000-0000-4000-8000-000000000502';
select throws_ok($$update public.material_request_files set stored_at = now() where request_id = 'a9000000-0000-4000-8000-000000000502'$$,
  '23514', 'MATERIAL_REQUEST_FILE_LIMIT', 'thirteen originals are not made visible in one batch');
select is((select count(*) from public.material_request_files where request_id = 'a9000000-0000-4000-8000-000000000502' and stored_at is not null),
  0::bigint, 'and none of that batch is');
update public.material_request_files set stored_at = now() where request_id = 'a9000000-0000-4000-8000-000000000502'
  and id <> 'a9000000-0000-4000-8000-000000000813';
select throws_ok($$update public.material_request_files set stored_at = now() where id = 'a9000000-0000-4000-8000-000000000813'$$,
  '23514', 'MATERIAL_REQUEST_FILE_LIMIT', 'a thirteenth original is not made visible after twelve');
update public.material_request_files set removed_at = now() where id = 'a9000000-0000-4000-8000-000000000801';
select lives_ok($$update public.material_request_files set stored_at = now() where id = 'a9000000-0000-4000-8000-000000000813'$$,
  'a withdrawn original frees its place');
insert into public.material_request_files (id, request_id, storage_path, file_name, mime_type, byte_size)
select id, 'a9000000-0000-4000-8000-000000000503',
  'a9000000-0000-4000-8000-000000000102/a9000000-0000-4000-8000-000000000203/a9000000-0000-4000-8000-000000000503/' || id || '/photo.jpg',
  'photo.jpg', 'image/jpeg', 2048
from (select ('a9000000-0000-4000-8000-0000000009' || lpad(n::text, 2, '0'))::uuid as id from generate_series(1, 24) n) photos;
select throws_ok($$insert into public.material_request_files (id, request_id, storage_path, file_name, mime_type, byte_size)
  values ('a9000000-0000-4000-8000-000000000925', 'a9000000-0000-4000-8000-000000000503',
    'a9000000-0000-4000-8000-000000000102/a9000000-0000-4000-8000-000000000203/a9000000-0000-4000-8000-000000000503/a9000000-0000-4000-8000-000000000925/photo.jpg',
    'photo.jpg', 'image/jpeg', 2048)$$,
  '23514', 'MATERIAL_REQUEST_UPLOADS_PENDING', 'a request holds twenty-four originals waiting for their bytes at most');

-- 24: three hundred lines per request. Request 502 holds one line, request 503 one.
select throws_ok($$insert into public.material_request_lines (request_id, position, product_type)
  select 'a9000000-0000-4000-8000-000000000503', n, 'Article ' || n from generate_series(2, 301) n$$,
  '23514', 'MATERIAL_REQUEST_LINE_LIMIT', 'three hundred and one lines are not reached in one statement');
select is((select count(*) from public.material_request_lines where request_id = 'a9000000-0000-4000-8000-000000000503'),
  1::bigint, 'and none of that batch is appended');
select lives_ok($$insert into public.material_request_lines (request_id, position, product_type)
  select 'a9000000-0000-4000-8000-000000000502', n, 'Article ' || n from generate_series(2, 300) n$$,
  'a request is filled to three hundred lines');
select throws_ok($$insert into public.material_request_lines (request_id, position, product_type)
  values ('a9000000-0000-4000-8000-000000000502', 301, 'Article de trop')$$,
  '23514', 'MATERIAL_REQUEST_LINE_LIMIT', 'a three hundred and first line is refused');
delete from public.material_request_lines where request_id = 'a9000000-0000-4000-8000-000000000502' and position in (299, 300);
select throws_ok($$insert into public.material_request_lines (request_id, position, product_type)
  values ('a9000000-0000-4000-8000-000000000502', 299, 'A'), ('a9000000-0000-4000-8000-000000000502', 300, 'B'),
    ('a9000000-0000-4000-8000-000000000502', 301, 'C')$$,
  '23514', 'MATERIAL_REQUEST_LINE_LIMIT', 'a batch that would cross the cap is refused');
select is((select count(*) from public.material_request_lines where request_id = 'a9000000-0000-4000-8000-000000000502'),
  298::bigint, 'whole: none of its lines is appended');
select lives_ok($$insert into public.material_request_lines (request_id, position, product_type)
  values ('a9000000-0000-4000-8000-000000000502', 299, 'A'), ('a9000000-0000-4000-8000-000000000502', 300, 'B')$$,
  'deleting lines frees their places');
select is((select count(*) from public.material_request_lines where request_id = 'a9000000-0000-4000-8000-000000000501'),
  5::bigint, 'the cap of one request leaves the lines of another alone');

-- 9: deletions around a request.
select is((select count(*) from public.material_request_lines where request_id = 'a9000000-0000-4000-8000-000000000501' and status = 'validated'),
  4::bigint, 'nothing a refused member tried has changed the lines');
update public.material_requests set presumed_supplier_id = 'a9000000-0000-4000-8000-000000000301', supplier_confirmed = true
where id = 'a9000000-0000-4000-8000-000000000501';
delete from public.suppliers where id = 'a9000000-0000-4000-8000-000000000301';
select ok((select presumed_supplier_id is null and not supplier_confirmed and supplier_confirmed_at is null
  from public.material_requests where id = 'a9000000-0000-4000-8000-000000000501'),
  'deleting a supplier clears the presumption and its confirmation, and keeps the request');
select ok((select status = 'validated' and supplier_id is null and validated_by = 'a9000000-0000-4000-8000-000000000001'
  from public.material_request_lines where id = 'a9000000-0000-4000-8000-000000000602'),
  'deleting a supplier keeps the validated lines that named it');
delete from public.material_request_technicians where id = 'a9000000-0000-4000-8000-000000000401';
select ok((select technician_id is null from public.material_requests where id = 'a9000000-0000-4000-8000-000000000501'),
  'deleting a technician keeps their requests');
delete from auth.users where id = 'a9000000-0000-4000-8000-000000000002';
select ok((select status = 'validated' and validated_by is null and validated_at is not null
  from public.material_request_lines where id = 'a9000000-0000-4000-8000-000000000604'),
  'deleting a member keeps the lines they validated, without their name');
delete from public.estimate_projects where id = 'a9000000-0000-4000-8000-000000000201';
select is((select count(*) from public.material_requests where project_id = 'a9000000-0000-4000-8000-000000000201')
  + (select count(*) from public.material_request_lines where project_id = 'a9000000-0000-4000-8000-000000000201')
  + (select count(*) from public.material_request_files where project_id = 'a9000000-0000-4000-8000-000000000201'), 0::bigint,
  'deleting the affaire removes its requests, lines and originals');
select is((select count(*) from public.material_requests where id = 'a9000000-0000-4000-8000-000000000502'), 1::bigint,
  'the requests of the other affaires stay');

select * from finish();
rollback;
