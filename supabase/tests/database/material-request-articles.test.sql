-- Articles of material request lines and usual names (TI-690, delivery 3). Failure modes this file guards,
-- with fictional members and articles:
--  1. a line is linked to an article of another tenant, or a usual name is attached to one;
--  2. a line says how it was linked without being linked (product_match without product_id), or keeps a
--     match once its article is gone, so that deleting an article fails on the presence check;
--  3. linking, changing or removing the article of a validated line leaves it validated, with the stamps
--     of a validation that described another article;
--  4. a member of another tenant reads the usual names of this tenant;
--  5. a viewer adds a usual name, or anyone changes one; a member deletes a usual name that an admin or
--     its author did not delete; the author or date of a usual name is forged;
--  6. the same usual name is attached twice to one article;
--  7. the « created from a request » mark of an article is changed after its insert;
--  8. deleting an article leaves its usual names, or returns a validated line to draft (a deletion is not
--     an office's edit);
--  9. the wording a line had before its link (pre_link_wording) is rewritten by an edit that does not
--     touch the article, set on a new line without an article, or is not an object.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

select ok(relation.relrowsecurity and relation.relforcerowsecurity, 'product_aliases has forced RLS')
from pg_class relation where relation.oid = 'public.product_aliases'::regclass;
select is(has_table_privilege('authenticated', 'public.product_aliases', 'UPDATE'), false,
  'a client cannot change a usual name');
select is(has_table_privilege('anon', 'public.product_aliases', 'SELECT'), false,
  'an anonymous caller cannot read usual names');

-- Tenant 101: 1 engineer who owns the affaire, 2 admin, 3 viewer, 5 another engineer.
-- Member 4 is the admin of tenant 102 only.
insert into auth.users (id, email, raw_user_meta_data)
select ('a9100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'rapprochement-' || n || '@example.test', '{}'::jsonb
from generate_series(1, 5) n;
update public.tenant_memberships set is_default = false where user_id::text like 'a9100000-%';
insert into public.tenants (id, name, slug) values
  ('a9100000-0000-4000-8000-000000000101', 'Rapprochement fixture', 'rapprochement-fixture'),
  ('a9100000-0000-4000-8000-000000000102', 'Rapprochement autre tenant', 'rapprochement-autre-tenant');
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at)
select (case when n = 4 then 'a9100000-0000-4000-8000-000000000102' else 'a9100000-0000-4000-8000-000000000101' end)::uuid,
  ('a9100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  (case n when 1 then 'engineer' when 2 then 'admin' when 3 then 'viewer' when 4 then 'admin' else 'engineer' end)::public.tenant_role,
  true, '2020-01-01'
from generate_series(1, 5) n;
insert into public.estimate_projects (id, tenant_id, user_id, name) values
  ('a9100000-0000-4000-8000-000000000201', 'a9100000-0000-4000-8000-000000000101', 'a9100000-0000-4000-8000-000000000001', 'Affaire du rapprochement');
insert into public.products (id, tenant_id, designation, unit_price_cents, product_type, material, dimensions) values
  ('a9100000-0000-4000-8000-000000000301', 'a9100000-0000-4000-8000-000000000101', 'Coude 90° inox 304L DN 50', 100, 'Coude 90°', 'Inox 304L', 'DN 50'),
  ('a9100000-0000-4000-8000-000000000302', 'a9100000-0000-4000-8000-000000000101', 'Té égal inox 304L DN 50', 100, 'Té égal', 'Inox 304L', 'DN 50'),
  ('a9100000-0000-4000-8000-000000000303', 'a9100000-0000-4000-8000-000000000101', 'Bride plate inox DN 50', 100, 'Bride plate', 'Inox 304L', 'DN 50'),
  ('a9100000-0000-4000-8000-000000000309', 'a9100000-0000-4000-8000-000000000102', 'Coude d''un autre tenant', 100, 'Coude', 'Cuivre', 'Ø 22');
insert into public.material_requests (id, project_id, created_by) values
  ('a9100000-0000-4000-8000-000000000501', 'a9100000-0000-4000-8000-000000000201', 'a9100000-0000-4000-8000-000000000001');
insert into public.material_request_lines (id, request_id, position, original_text, quantity, unit, dimension, product_type, material, status) values
  ('a9100000-0000-4000-8000-000000000601', 'a9100000-0000-4000-8000-000000000501', 1, '4 coudes 90 DN50', 4, 'u', 'DN 50', 'coude 90', 'Inox 304L', 'validated'),
  ('a9100000-0000-4000-8000-000000000602', 'a9100000-0000-4000-8000-000000000501', 2, '2 tés DN50', 2, 'u', 'DN 50', 'té', 'Inox 304L', 'draft');
insert into public.material_request_lines (id, request_id, position, quantity, unit, dimension, product_type, material, status, product_id, product_match) values
  ('a9100000-0000-4000-8000-000000000603', 'a9100000-0000-4000-8000-000000000501', 3, 1, 'u', 'DN 50', 'Bride plate', 'Inox 304L', 'validated',
    'a9100000-0000-4000-8000-000000000303', 'manual');
select ok((select status = 'validated' and validated_at is not null from public.material_request_lines
  where id = 'a9100000-0000-4000-8000-000000000601'), 'the fixture line starts validated');

-- 1, 2, 3: the engineer who owns the affaire.
select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a9100000-0000-4000-8000-000000000001"}', true);
set local role authenticated;

select throws_ok($$update public.material_request_lines set product_id = 'a9100000-0000-4000-8000-000000000309', product_match = 'manual'
  where id = 'a9100000-0000-4000-8000-000000000602'$$, '23514', 'MATERIAL_REQUEST_TENANT_MISMATCH',
  'a line cannot be linked to an article of another tenant');
select throws_ok($$insert into public.material_request_lines (request_id, position, product_type, product_id, product_match)
  values ('a9100000-0000-4000-8000-000000000501', 4, 'Coude', 'a9100000-0000-4000-8000-000000000309', 'ranked')$$,
  '23514', 'MATERIAL_REQUEST_TENANT_MISMATCH', 'a new line cannot name an article of another tenant');
select throws_ok($$update public.material_request_lines set product_match = 'manual' where id = 'a9100000-0000-4000-8000-000000000602'$$,
  '23514', 'new row for relation "material_request_lines" violates check constraint "material_request_lines_product_match_presence_check"',
  'a line cannot say how it was linked without an article');
select throws_ok($$insert into public.material_request_lines (request_id, position, product_type, product_match)
  values ('a9100000-0000-4000-8000-000000000501', 4, 'Coude', 'alias')$$,
  '23514', 'new row for relation "material_request_lines" violates check constraint "material_request_lines_product_match_presence_check"',
  'a new line cannot say how it was linked without an article');
select throws_ok($$update public.material_request_lines set product_id = 'a9100000-0000-4000-8000-000000000302'
  where id = 'a9100000-0000-4000-8000-000000000602'$$,
  '23514', 'new row for relation "material_request_lines" violates check constraint "material_request_lines_product_match_presence_check"',
  'a line cannot be linked without saying how');
select throws_ok($$update public.material_request_lines set product_id = 'a9100000-0000-4000-8000-000000000302', product_match = 'guessed'
  where id = 'a9100000-0000-4000-8000-000000000602'$$,
  '23514', 'new row for relation "material_request_lines" violates check constraint "material_request_lines_product_match_check"',
  'a line is linked in one of the known ways only');

select lives_ok($$update public.material_request_lines set product_id = 'a9100000-0000-4000-8000-000000000301', product_match = 'ranked',
    status = 'validated' where id = 'a9100000-0000-4000-8000-000000000601'$$,
  'the owner links a validated line to an article of the tenant');
select ok((select status = 'draft' and validated_at is null and validated_by is null
    and product_id = 'a9100000-0000-4000-8000-000000000301' and product_match = 'ranked'
  from public.material_request_lines where id = 'a9100000-0000-4000-8000-000000000601'),
  'linking a validated line returns it to draft and clears its stamps, even when the statement keeps it validated');

update public.material_request_lines set status = 'validated' where id = 'a9100000-0000-4000-8000-000000000601';
select ok((select status = 'validated' and validated_at is not null from public.material_request_lines
  where id = 'a9100000-0000-4000-8000-000000000601'), 'a linked line can be validated again');
update public.material_request_lines set product_match = 'manual' where id = 'a9100000-0000-4000-8000-000000000601';
select ok((select status = 'draft' and validated_at is null from public.material_request_lines
  where id = 'a9100000-0000-4000-8000-000000000601'), 'changing how a validated line was linked returns it to draft');

update public.material_request_lines set status = 'validated' where id = 'a9100000-0000-4000-8000-000000000601';
update public.material_request_lines set product_id = null where id = 'a9100000-0000-4000-8000-000000000601';
select ok((select status = 'draft' and validated_at is null and product_id is null and product_match is null
    and product_type = 'coude 90' and original_text = '4 coudes 90 DN50'
  from public.material_request_lines where id = 'a9100000-0000-4000-8000-000000000601'),
  'unlinking a validated line clears how it was linked, keeps its columns and returns it to draft');

-- 9: the wording before the link goes with the link.
select lives_ok($$update public.material_request_lines set product_id = 'a9100000-0000-4000-8000-000000000301', product_match = 'manual',
    pre_link_wording = '{"product_type": "coude 90", "unit": "u"}' where id = 'a9100000-0000-4000-8000-000000000601'$$,
  'a link records the wording the line had before it');
select throws_ok($$update public.material_request_lines set pre_link_wording = '{"product_type": "autre chose"}'
  where id = 'a9100000-0000-4000-8000-000000000601'$$, '23514', 'MATERIAL_REQUEST_PRE_LINK_WORDING_IMMUTABLE',
  'the wording before the link is not rewritten without the article');
select throws_ok($$update public.material_request_lines set pre_link_wording = null, product_type = 'coude'
  where id = 'a9100000-0000-4000-8000-000000000601'$$, '23514', 'MATERIAL_REQUEST_PRE_LINK_WORDING_IMMUTABLE',
  'the wording before the link is not erased without the article');
select throws_ok($$insert into public.material_request_lines (request_id, position, product_type, pre_link_wording)
  values ('a9100000-0000-4000-8000-000000000501', 4, 'Coude', '{"product_type": "coude"}')$$,
  '23514', 'MATERIAL_REQUEST_PRE_LINK_WORDING_IMMUTABLE', 'a new line without an article has no wording before a link');
select throws_ok($$update public.material_request_lines set product_id = 'a9100000-0000-4000-8000-000000000302', product_match = 'manual',
    pre_link_wording = '["té"]' where id = 'a9100000-0000-4000-8000-000000000602'$$,
  '23514', 'new row for relation "material_request_lines" violates check constraint "material_request_lines_pre_link_wording_check"',
  'the wording before the link is an object');
select lives_ok($$update public.material_request_lines set product_id = null, pre_link_wording = null
  where id = 'a9100000-0000-4000-8000-000000000601'$$, 'an unlink clears the wording before the link');
select ok((select product_id is null and product_match is null and pre_link_wording is null
  from public.material_request_lines where id = 'a9100000-0000-4000-8000-000000000601'), 'the line is unlinked');

-- 5, 6: usual names, by the engineer.
select lives_ok($$insert into public.product_aliases (id, tenant_id, product_id, alias, alias_key, created_by, created_at)
  values ('a9100000-0000-4000-8000-000000000701', 'a9100000-0000-4000-8000-000000000102', 'a9100000-0000-4000-8000-000000000302',
    'té', 'te', 'a9100000-0000-4000-8000-000000000002', '2000-01-01')$$,
  'an engineer teaches a usual name of an article');
select throws_ok($$insert into public.product_aliases (tenant_id, product_id, alias, alias_key)
  values ('a9100000-0000-4000-8000-000000000101', 'a9100000-0000-4000-8000-000000000302', 'tés', 'te')$$,
  '23505', null, 'the same usual name is attached once to an article');
select throws_ok($$insert into public.product_aliases (tenant_id, product_id, alias, alias_key)
  values ('a9100000-0000-4000-8000-000000000102', 'a9100000-0000-4000-8000-000000000309', 'coude', 'coude')$$,
  '23514', 'PRODUCT_ALIAS_TENANT_MISMATCH', 'a usual name cannot be attached to an article of another tenant');
select throws_ok($$insert into public.product_aliases (product_id, alias, alias_key)
  values ('a9100000-0000-4000-8000-000000000302', '', 'te bis')$$,
  '23514', null, 'a usual name is not blank');
reset role;
select ok((select tenant_id = 'a9100000-0000-4000-8000-000000000101' and created_by = 'a9100000-0000-4000-8000-000000000001'
    and created_at > now() - interval '1 hour'
  from public.product_aliases where id = 'a9100000-0000-4000-8000-000000000701'),
  'tenant, author and date of a usual name are the article''s and the database''s, not the client''s');
set local role authenticated;
select throws_ok($$update public.product_aliases set alias = 'té égal' where id = 'a9100000-0000-4000-8000-000000000701'$$,
  '42501', null, 'a usual name is never changed by a client');
select lives_ok($$insert into public.product_aliases (id, product_id, alias, alias_key)
  values ('a9100000-0000-4000-8000-000000000702', 'a9100000-0000-4000-8000-000000000302', 'piquage', 'piquage')$$,
  'the engineer teaches a second usual name');

-- 7: the mark of an article created from a request.
select lives_ok($$insert into public.products (id, designation, product_type, material, unit, unit_price_cents, catalogue_status, created_from_material_request)
  values ('a9100000-0000-4000-8000-000000000304', 'Réduction concentrique inox DN 50 × 40', 'Réduction concentrique', 'Inox 304L', 'u', 0, 'draft', true)$$,
  'an engineer creates a draft article from a request line');
select throws_ok($$update public.products set created_from_material_request = false where id = 'a9100000-0000-4000-8000-000000000304'$$,
  '23514', 'PRODUCT_ORIGIN_IMMUTABLE', 'the mark of an article created from a request is kept');
select lives_ok($$update public.products set designation = 'Réduction concentrique inox 304L DN 50 × 40' where id = 'a9100000-0000-4000-8000-000000000304'$$,
  'the rest of such an article is changed as any other');

-- 5: a viewer reads the usual names of the tenant and adds none.
select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a9100000-0000-4000-8000-000000000003"}', true);
select is((select count(*) from public.product_aliases where product_id = 'a9100000-0000-4000-8000-000000000302'), 2::bigint,
  'a viewer reads the usual names of the tenant');
select throws_ok($$insert into public.product_aliases (product_id, alias, alias_key)
  values ('a9100000-0000-4000-8000-000000000301', 'coude', 'coude')$$, '42501', null, 'a viewer cannot teach a usual name');
delete from public.product_aliases where id = 'a9100000-0000-4000-8000-000000000701';
select is((select count(*) from public.product_aliases where id = 'a9100000-0000-4000-8000-000000000701'), 1::bigint,
  'a viewer cannot delete a usual name');

-- 5: another engineer deletes none; an admin deletes any.
select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000005', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a9100000-0000-4000-8000-000000000005"}', true);
delete from public.product_aliases where id = 'a9100000-0000-4000-8000-000000000701';
select is((select count(*) from public.product_aliases where id = 'a9100000-0000-4000-8000-000000000701'), 1::bigint,
  'an engineer cannot delete a usual name taught by another member');
select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a9100000-0000-4000-8000-000000000002"}', true);
delete from public.product_aliases where id = 'a9100000-0000-4000-8000-000000000701';
select is((select count(*) from public.product_aliases where id = 'a9100000-0000-4000-8000-000000000701'), 0::bigint,
  'an admin deletes a usual name');
select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a9100000-0000-4000-8000-000000000001"}', true);
delete from public.product_aliases where id = 'a9100000-0000-4000-8000-000000000702';
select is((select count(*) from public.product_aliases where id = 'a9100000-0000-4000-8000-000000000702'), 0::bigint,
  'the engineer who taught a usual name deletes it');
insert into public.product_aliases (id, product_id, alias, alias_key)
values ('a9100000-0000-4000-8000-000000000703', 'a9100000-0000-4000-8000-000000000303', 'collerette', 'collerette');

-- 4: a member of another tenant.
select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a9100000-0000-4000-8000-000000000004"}', true);
select is((select count(*) from public.product_aliases where tenant_id = 'a9100000-0000-4000-8000-000000000101'), 0::bigint,
  'a member of another tenant reads no usual name of this tenant');
select throws_ok($$insert into public.product_aliases (product_id, alias, alias_key)
  values ('a9100000-0000-4000-8000-000000000301', 'coude', 'coude')$$, '23514', 'PRODUCT_ALIAS_TENANT_MISMATCH',
  'a member of another tenant cannot teach a usual name of this tenant''s article');
delete from public.product_aliases where id = 'a9100000-0000-4000-8000-000000000703';
reset role;
select is((select count(*) from public.product_aliases where id = 'a9100000-0000-4000-8000-000000000703'), 1::bigint,
  'a member of another tenant cannot delete a usual name of this tenant');

-- 2, 8: deleting an article.
delete from public.products where id = 'a9100000-0000-4000-8000-000000000303';
select ok((select product_id is null and product_match is null and status = 'validated' and validated_at is not null
    and product_type = 'Bride plate'
  from public.material_request_lines where id = 'a9100000-0000-4000-8000-000000000603'),
  'deleting an article unlinks its lines, which keep their columns and stay validated');
select is((select count(*) from public.product_aliases where product_id = 'a9100000-0000-4000-8000-000000000303'), 0::bigint,
  'deleting an article removes its usual names');

select * from finish();
rollback;
