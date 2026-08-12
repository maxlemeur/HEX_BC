begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '11000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'estimate-email-writer@example.test',
    crypt('test-password', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '11000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'estimate-email-admin@example.test',
    crypt('test-password', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '11000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'estimate-email-viewer@example.test',
    crypt('test-password', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '11000000-0000-4000-8000-000000000004',
    'authenticated',
    'authenticated',
    'estimate-email-other-tenant@example.test',
    crypt('test-password', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '11000000-0000-4000-8000-000000000005',
    'authenticated',
    'authenticated',
    'estimate-email-inactive-tenant@example.test',
    crypt('test-password', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

insert into public.tenants (id, name, slug, created_by, is_active)
values
  (
    '21000000-0000-4000-8000-000000000001',
    'Estimate email active tenant',
    'estimate-email-active-tenant',
    '11000000-0000-4000-8000-000000000001',
    true
  ),
  (
    '21000000-0000-4000-8000-000000000002',
    'Estimate email other tenant',
    'estimate-email-other-tenant',
    '11000000-0000-4000-8000-000000000004',
    true
  ),
  (
    '21000000-0000-4000-8000-000000000003',
    'Estimate email inactive tenant',
    'estimate-email-inactive-tenant',
    '11000000-0000-4000-8000-000000000005',
    false
  );

insert into public.tenant_memberships (
  id,
  tenant_id,
  user_id,
  role,
  is_default
)
values
  (
    '22000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001',
    'engineer'::public.tenant_role,
    false
  ),
  (
    '22000000-0000-4000-8000-000000000002',
    '21000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000002',
    'admin'::public.tenant_role,
    false
  ),
  (
    '22000000-0000-4000-8000-000000000003',
    '21000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000003',
    'viewer'::public.tenant_role,
    false
  ),
  (
    '22000000-0000-4000-8000-000000000004',
    '21000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-000000000004',
    'engineer'::public.tenant_role,
    false
  ),
  (
    '22000000-0000-4000-8000-000000000005',
    '21000000-0000-4000-8000-000000000003',
    '11000000-0000-4000-8000-000000000005',
    'engineer'::public.tenant_role,
    false
  );

insert into public.estimate_projects (
  id,
  tenant_id,
  user_id,
  name,
  is_archived
)
values
  (
    '31000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001',
    'Estimate email writer project',
    false
  ),
  (
    '31000000-0000-4000-8000-000000000002',
    '21000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000003',
    'Estimate email viewer project',
    false
  ),
  (
    '31000000-0000-4000-8000-000000000003',
    '21000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-000000000004',
    'Estimate email other tenant project',
    false
  ),
  (
    '31000000-0000-4000-8000-000000000004',
    '21000000-0000-4000-8000-000000000003',
    '11000000-0000-4000-8000-000000000005',
    'Estimate email inactive tenant project',
    false
  );

insert into public.estimate_versions (
  id,
  tenant_id,
  project_id,
  version_number,
  status
)
values
  (
    '41000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',
    1,
    'draft'::public.estimate_status
  ),
  (
    '41000000-0000-4000-8000-000000000002',
    '21000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',
    2,
    'draft'::public.estimate_status
  ),
  (
    '41000000-0000-4000-8000-000000000003',
    '21000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',
    3,
    'draft'::public.estimate_status
  ),
  (
    '41000000-0000-4000-8000-000000000004',
    '21000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',
    4,
    'draft'::public.estimate_status
  ),
  (
    '41000000-0000-4000-8000-000000000005',
    '21000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',
    5,
    'draft'::public.estimate_status
  ),
  (
    '41000000-0000-4000-8000-000000000006',
    '21000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000002',
    1,
    'draft'::public.estimate_status
  ),
  (
    '41000000-0000-4000-8000-000000000007',
    '21000000-0000-4000-8000-000000000002',
    '31000000-0000-4000-8000-000000000003',
    1,
    'draft'::public.estimate_status
  ),
  (
    '41000000-0000-4000-8000-000000000008',
    '21000000-0000-4000-8000-000000000003',
    '31000000-0000-4000-8000-000000000004',
    1,
    'draft'::public.estimate_status
  ),
  (
    '41000000-0000-4000-8000-000000000009',
    '21000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',
    9,
    'draft'::public.estimate_status
  ),
  (
    '41000000-0000-4000-8000-000000000010',
    '21000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',
    10,
    'sent'::public.estimate_status
  );

insert into public.draft_locks (
  id,
  version_id,
  user_id,
  tenant_id,
  locked_at,
  expires_at,
  session_id
)
values
  (
    '51000000-0000-4000-8000-000000000002',
    '41000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    now(),
    now() + interval '30 minutes',
    '52000000-0000-4000-8000-000000000002'
  ),
  (
    '51000000-0000-4000-8000-000000000003',
    '41000000-0000-4000-8000-000000000003',
    '11000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    now(),
    now() + interval '30 minutes',
    '52000000-0000-4000-8000-000000000003'
  ),
  (
    '51000000-0000-4000-8000-000000000004',
    '41000000-0000-4000-8000-000000000004',
    '11000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    now(),
    now() + interval '30 minutes',
    '52000000-0000-4000-8000-000000000004'
  ),
  (
    '51000000-0000-4000-8000-000000000005',
    '41000000-0000-4000-8000-000000000005',
    '11000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    now(),
    now() + interval '30 minutes',
    '52000000-0000-4000-8000-000000000005'
  ),
  (
    '51000000-0000-4000-8000-000000000006',
    '41000000-0000-4000-8000-000000000006',
    '11000000-0000-4000-8000-000000000003',
    '21000000-0000-4000-8000-000000000001',
    now(),
    now() + interval '30 minutes',
    '52000000-0000-4000-8000-000000000006'
  ),
  (
    '51000000-0000-4000-8000-000000000008',
    '41000000-0000-4000-8000-000000000008',
    '11000000-0000-4000-8000-000000000005',
    '21000000-0000-4000-8000-000000000003',
    now(),
    now() + interval '30 minutes',
    '52000000-0000-4000-8000-000000000008'
  ),
  (
    '51000000-0000-4000-8000-000000000009',
    '41000000-0000-4000-8000-000000000009',
    '11000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    now(),
    now() + interval '30 minutes',
    '52000000-0000-4000-8000-000000000009'
  );

set local role service_role;

create or replace function pg_temp.publish_estimate_email_test_pdf(
  p_version_id uuid,
  p_dispatch_id uuid,
  p_sha256 text,
  p_purpose text default 'email'
)
returns text
language plpgsql
as $$
declare
  target_version public.estimate_versions%rowtype;
  target_path text;
begin
  select version.*
    into target_version
  from public.estimate_versions version
  where version.id = p_version_id;

  target_path := concat(
    target_version.tenant_id::text,
    '/',
    target_version.project_id::text,
    '/',
    target_version.id::text,
    '/',
    p_sha256,
    '.pdf'
  );

  insert into public.estimate_documents (
    tenant_id,
    version_id,
    file_path,
    sha256_hash,
    file_size_bytes,
    generated_by,
    generated_at,
    status,
    published_purpose,
    published_dispatch_id,
    published_content_revision
  ) values (
    target_version.tenant_id,
    target_version.id,
    target_path,
    p_sha256,
    1024,
    '11000000-0000-4000-8000-000000000001',
    clock_timestamp(),
    'ready',
    p_purpose,
    p_dispatch_id,
    target_version.content_revision
  )
  on conflict (tenant_id, version_id)
  do update set
    file_path = excluded.file_path,
    sha256_hash = excluded.sha256_hash,
    file_size_bytes = excluded.file_size_bytes,
    generated_by = excluded.generated_by,
    generated_at = excluded.generated_at,
    status = excluded.status,
    last_error = null,
    generation_token = null,
    generation_purpose = null,
    generation_dispatch_id = null,
    generation_content_revision = null,
    generation_started_at = null,
    published_purpose = excluded.published_purpose,
    published_dispatch_id = excluded.published_dispatch_id,
    published_content_revision = excluded.published_content_revision;

  return target_path;
end;
$$;

-- Model a document published before content-addressed paths existed. The
-- migration backfills these rows before installing the new path trigger.
reset role;
alter table public.estimate_documents
  disable trigger enforce_estimate_document_canonical_path;
insert into public.estimate_documents (
  tenant_id,
  version_id,
  file_path,
  sha256_hash,
  file_size_bytes,
  generated_by,
  generated_at,
  status,
  published_purpose,
  published_content_revision
) values (
  '21000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000010',
  '21000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000001/HEX_D26001MM_V10.pdf',
  repeat('a', 64),
  1024,
  '11000000-0000-4000-8000-000000000001',
  clock_timestamp(),
  'ready',
  'legacy',
  1
);
alter table public.estimate_documents
  enable trigger enforce_estimate_document_canonical_path;
set local role service_role;

select lives_ok(
  $$
    update public.estimate_documents
    set last_error = null
    where version_id = '41000000-0000-4000-8000-000000000010'
  $$,
  'an unchanged historical commercial PDF path remains readable after finalization'
);

select results_eq(
  $$
    select document.file_path, document.published_purpose,
      document.published_content_revision
    from public.estimate_documents as document
    where document.version_id = '41000000-0000-4000-8000-000000000010'
  $$,
  $$
    values (
      '21000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000001/HEX_D26001MM_V10.pdf'::text,
      'legacy'::text,
      1::bigint
    )
  $$,
  'legacy commercial metadata keeps its immutable path and revision proof'
);

select throws_ok(
  $$
    select public.reserve_estimate_email_dispatch(
      '41000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000001',
      (select updated_at from public.estimate_versions where id = '41000000-0000-4000-8000-000000000001'),
      '11000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000001',
      repeat('1', 64),
      'client@example.test',
      null::text[],
      'Devis sans verrou',
      'Veuillez trouver le devis.',
      'devis@example.test'
    )
  $$,
  '40001',
  'ESTIMATE_DRAFT_LOCK_REQUIRED',
  'a draft without the actor lock cannot be reserved'
);

select is(
  (
    select status::text
    from public.estimate_versions
    where id = '41000000-0000-4000-8000-000000000001'
  ),
  'draft',
  'a rejected reservation leaves the version draft'
);

select is(
  (
    select count(*)::integer
    from public.estimate_emails
    where request_id = '61000000-0000-4000-8000-000000000001'
  ),
  0,
  'a rejected reservation leaves no outbox row'
);

create temporary table pdf_generation_test_tokens (
  purpose text primary key,
  token uuid not null
) on commit drop;

insert into pdf_generation_test_tokens (purpose, token)
select
  'manual',
  generation_token
from public.begin_estimate_pdf_generation(
  '41000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  'manual',
  null
);

insert into public.draft_locks (
  id,
  version_id,
  user_id,
  tenant_id,
  locked_at,
  expires_at,
  session_id
) values (
  '51000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  now(),
  now() + interval '30 minutes',
  '52000000-0000-4000-8000-000000000001'
);

select lives_ok(
  $$
    select public.reserve_estimate_email_dispatch(
      '41000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000001',
      (select updated_at from public.estimate_versions where id = '41000000-0000-4000-8000-000000000001'),
      '11000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000001',
      repeat('1', 64),
      'client@example.test',
      null::text[],
      'Devis apres generation manuelle',
      'Veuillez trouver le devis.',
      'devis@example.test'
    )
  $$,
  'email reservation wins the version lock after a manual render starts'
);

select throws_ok(
  $$
    select public.publish_estimate_pdf_generation(
      '41000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      (select token from pdf_generation_test_tokens where purpose = 'manual'),
      '21000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000001/41000000-0000-4000-8000-000000000001/' || repeat('a', 64) || '.pdf',
      repeat('a', 64),
      1024,
      clock_timestamp(),
      '{}'::jsonb,
      null
    )
  $$,
  '40001',
  'ESTIMATE_PDF_GENERATION_SUPERSEDED',
  'a manual worker cannot publish after email reservation changes the version state'
);

insert into pdf_generation_test_tokens (purpose, token)
select
  'email',
  generation_token
from public.begin_estimate_pdf_generation(
  '41000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  'email',
  (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000001')
);

select lives_ok(
  $$
    select public.publish_estimate_pdf_generation(
      '41000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      (select token from pdf_generation_test_tokens where purpose = 'email'),
      '21000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000001/41000000-0000-4000-8000-000000000001/' || repeat('b', 64) || '.pdf',
      repeat('b', 64),
      2048,
      clock_timestamp(),
      '{}'::jsonb,
      null
    )
  $$,
  'the dispatch-owned replacement token publishes the immutable PDF'
);

select results_eq(
  $$
    select
      status,
      published_purpose,
      published_dispatch_id,
      published_content_revision,
      sha256_hash
    from public.estimate_documents
    where version_id = '41000000-0000-4000-8000-000000000001'
  $$,
  $$
    values (
      'ready'::text,
      'email'::text,
      (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000001'),
      1::bigint,
      repeat('b', 64)::text
    )
  $$,
  'only the email generation is published as the current contractual proof'
);

select ok(
  not has_table_privilege('authenticated', 'public.estimate_documents', 'INSERT')
  and not has_table_privilege('authenticated', 'public.estimate_documents', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.estimate_documents', 'DELETE'),
  'authenticated clients cannot mutate estimate document metadata directly'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.begin_estimate_pdf_generation(uuid,uuid,uuid,text,uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.begin_estimate_pdf_generation(uuid,uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'only the service role may claim a PDF publication token'
);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
      and 'authenticated' = any(roles)
      and policyname ilike '%estimate documents storage%'
  ),
  0,
  'authenticated users have no estimate PDF Storage write policy'
);

select throws_ok(
  $$
    select public.reserve_estimate_email_dispatch(
      '41000000-0000-4000-8000-000000000006',
      '21000000-0000-4000-8000-000000000001',
      (select updated_at from public.estimate_versions where id = '41000000-0000-4000-8000-000000000006'),
      '11000000-0000-4000-8000-000000000003',
      '61000000-0000-4000-8000-000000000006',
      repeat('6', 64),
      'client@example.test',
      null::text[],
      'Devis viewer',
      'Veuillez trouver le devis.',
      'devis@example.test'
    )
  $$,
  '42501',
  'ESTIMATE_EMAIL_DISPATCH_FORBIDDEN',
  'a viewer cannot reserve their own estimate email'
);

select throws_ok(
  $$
    select public.reserve_estimate_email_dispatch(
      '41000000-0000-4000-8000-000000000002',
      '21000000-0000-4000-8000-000000000002',
      (select updated_at from public.estimate_versions where id = '41000000-0000-4000-8000-000000000002'),
      '11000000-0000-4000-8000-000000000004',
      '61000000-0000-4000-8000-000000000007',
      repeat('7', 64),
      'client@example.test',
      null::text[],
      'Devis autre tenant',
      'Veuillez trouver le devis.',
      'devis@example.test'
    )
  $$,
  'P0001',
  'ESTIMATE_VERSION_NOT_FOUND',
  'a cross-tenant version reservation is refused'
);

select throws_ok(
  $$
    select public.reserve_estimate_email_dispatch(
      '41000000-0000-4000-8000-000000000008',
      '21000000-0000-4000-8000-000000000003',
      (select updated_at from public.estimate_versions where id = '41000000-0000-4000-8000-000000000008'),
      '11000000-0000-4000-8000-000000000005',
      '61000000-0000-4000-8000-000000000008',
      repeat('8', 64),
      'client@example.test',
      null::text[],
      'Devis tenant inactif',
      'Veuillez trouver le devis.',
      'devis@example.test'
    )
  $$,
  'P0001',
  'ESTIMATE_VERSION_NOT_FOUND',
  'an inactive tenant cannot reserve an estimate email'
);

select lives_ok(
  $$
    select public.reserve_estimate_email_dispatch(
      '41000000-0000-4000-8000-000000000009',
      '21000000-0000-4000-8000-000000000001',
      (select updated_at from public.estimate_versions where id = '41000000-0000-4000-8000-000000000009'),
      '11000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000009',
      repeat('9', 64),
      'first-send@example.test',
      null::text[],
      'Premier envoi fige',
      'Payload immuable du premier envoi.',
      'devis@example.test'
    )
  $$,
  'a first-send dispatch is reserved for frozen retry coverage'
);

select lives_ok(
  $$
    select public.prepare_estimate_email_dispatch(
      (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000009'),
      '21000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      repeat('a', 64),
      repeat('b', 64),
      '<p>Premier envoi fige</p>',
      'Premier envoi fige',
      pg_temp.publish_estimate_email_test_pdf(
        '41000000-0000-4000-8000-000000000009',
        (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000009'),
        repeat('c', 64)
      ),
      repeat('c', 64),
      'DEVIS-PREMIER-ENVOI.pdf'
    )
  $$,
  'the first-send payload and document proof are frozen once'
);

select lives_ok(
  $$
    select public.claim_estimate_email_dispatch(
      (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000009'),
      '21000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000009',
      120
    )
  $$,
  'the first-send frozen payload is leased before provider delivery'
);

select lives_ok(
  $$
    select public.fail_estimate_email_dispatch(
      (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000009'),
      '21000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000009',
      'PROVIDER_REJECTED',
      'The provider rejected the first send.'
    )
  $$,
  'a first-send provider rejection is recorded without unsealing the payload'
);

select results_eq(
  $$
    select
      dispatch.status,
      dispatch.provider_payload_hash,
      dispatch.document_sha256,
      version.status::text,
      version.seal_hash
    from public.estimate_emails as dispatch
    join public.estimate_versions as version
      on version.id = dispatch.version_id
    where dispatch.request_id = '61000000-0000-4000-8000-000000000009'
  $$,
  $$ values ('failed'::text, repeat('b', 64), repeat('c', 64), 'draft'::text, null::text) $$,
  'the first-send failure preserves its proof but releases the unsent estimate'
);

select throws_ok(
  $$
    select public.reserve_estimate_email_dispatch(
      '41000000-0000-4000-8000-000000000009',
      '21000000-0000-4000-8000-000000000001',
      (select updated_at from public.estimate_versions where id = '41000000-0000-4000-8000-000000000009'),
      '11000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000009',
      repeat('9', 64),
      'first-send@example.test',
      null::text[],
      'Premier envoi fige',
      'Payload immuable du premier envoi.',
      'devis@example.test'
    )
  $$,
  '23505',
  'ESTIMATE_EMAIL_RETRY_REQUIRES_NEW_REQUEST',
  'a frozen failed first-send requires a fresh request instead of rewriting its Resend payload'
);

select results_eq(
  $$
    select status, provider_payload_hash, document_sha256
    from public.estimate_emails
    where request_id = '61000000-0000-4000-8000-000000000009'
  $$,
  $$ values ('failed'::text, repeat('b', 64), repeat('c', 64)) $$,
  'the rejected retry leaves the frozen first-send payload unchanged'
);

select lives_ok(
  $$
    select public.reserve_estimate_email_dispatch(
      '41000000-0000-4000-8000-000000000009',
      '21000000-0000-4000-8000-000000000001',
      (select updated_at from public.estimate_versions where id = '41000000-0000-4000-8000-000000000009'),
      '11000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000019',
      repeat('1', 64),
      'corrected@example.test',
      null::text[],
      'Premier envoi corrige',
      'Enveloppe corrigee apres rejet certain.',
      'devis@example.test'
    )
  $$,
  'a fresh request can reserve a corrected envelope after a certain rejection'
);

select results_eq(
  $$
    select
      version.status::text,
      count(*) filter (where dispatch.status = 'failed')::integer,
      count(*) filter (where dispatch.status = 'preparing')::integer
    from public.estimate_versions as version
    join public.estimate_emails as dispatch
      on dispatch.version_id = version.id
    where version.id = '41000000-0000-4000-8000-000000000009'
    group by version.status
  $$,
  $$ values ('sending'::text, 1, 1) $$,
  'the corrected request is active while the rejected frozen record remains immutable'
);

select lives_ok(
  $$
    select public.fail_estimate_email_dispatch(
      (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000019'),
      '21000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      null::uuid,
      'PDF_PREPARATION_CANCELLED',
      'The corrected request was cancelled before its payload was frozen.'
    )
  $$,
  'canceling the unfrozen corrected request releases the version to draft'
);

select lives_ok(
  $$
    select public.reserve_estimate_email_dispatch(
      '41000000-0000-4000-8000-000000000002',
      '21000000-0000-4000-8000-000000000001',
      (select updated_at from public.estimate_versions where id = '41000000-0000-4000-8000-000000000002'),
      '11000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000002',
      repeat('2', 64),
      'client@example.test',
      array['copie@example.test'],
      'Devis transactionnel',
      'Veuillez trouver le devis.',
      'devis@example.test'
    )
  $$,
  'a writer with the active lock reserves the initial dispatch atomically'
);

select results_eq(
  $$
    select version.status::text, dispatch.status, dispatch.created_by
    from public.estimate_versions as version
    join public.estimate_emails as dispatch
      on dispatch.version_id = version.id
    where version.id = '41000000-0000-4000-8000-000000000002'
  $$,
  $$ values ('sending'::text, 'preparing'::text, '11000000-0000-4000-8000-000000000001'::uuid) $$,
  'reservation moves draft to sending and records the actor in one transaction'
);

select is(
  (
    select (
      public.reserve_estimate_email_dispatch(
        '41000000-0000-4000-8000-000000000002',
        '21000000-0000-4000-8000-000000000001',
        '2000-01-01 00:00:00+00'::timestamptz,
        '11000000-0000-4000-8000-000000000001',
        '61000000-0000-4000-8000-000000000002',
        repeat('2', 64),
        'client@example.test',
        array['copie@example.test'],
        'Devis transactionnel',
        'Veuillez trouver le devis.',
        'devis@example.test'
      )
    ).id
  ),
  (
    select id
    from public.estimate_emails
    where request_id = '61000000-0000-4000-8000-000000000002'
  ),
  'the same request and payload return the original dispatch'
);

select is(
  (
    select count(*)::integer
    from public.estimate_emails
    where request_id = '61000000-0000-4000-8000-000000000002'
  ),
  1,
  'an idempotent retry does not create a duplicate dispatch'
);

select is(
  (
    select (
      public.reserve_estimate_email_dispatch(
        '41000000-0000-4000-8000-000000000002',
        '21000000-0000-4000-8000-000000000001',
        '2000-01-01 00:00:00+00'::timestamptz,
        '11000000-0000-4000-8000-000000000001',
        '61000000-0000-4000-8000-000000000012',
        repeat('2', 64),
        'client@example.test',
        array['copie@example.test'],
        'Devis transactionnel',
        'Veuillez trouver le devis.',
        'devis@example.test'
      )
    ).id
  ),
  (
    select id
    from public.estimate_emails
    where request_id = '61000000-0000-4000-8000-000000000002'
  ),
  'a fresh browser request reconnects to the active dispatch by immutable payload hash'
);

select throws_ok(
  $$
    select public.reserve_estimate_email_dispatch(
      '41000000-0000-4000-8000-000000000002',
      '21000000-0000-4000-8000-000000000001',
      '2000-01-01 00:00:00+00'::timestamptz,
      '11000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000013',
      repeat('9', 64),
      'other-client@example.test',
      array['copie@example.test'],
      'Devis transactionnel modifie',
      'Veuillez trouver le devis.',
      'devis@example.test'
    )
  $$,
  '23505',
  'ESTIMATE_EMAIL_IDEMPOTENCY_CONFLICT',
  'a fresh request cannot silently replace or resume another active payload'
);

select results_eq(
  $$
    select request_id, payload_hash, recipient, subject
    from public.estimate_emails
    where version_id = '41000000-0000-4000-8000-000000000002'
      and status = 'preparing'
  $$,
  $$
    values (
      '61000000-0000-4000-8000-000000000002'::uuid,
      repeat('2', 64),
      'client@example.test'::text,
      'Devis transactionnel'::text
    )
  $$,
  'resuming never replaces the frozen request, payload, or envelope'
);

select throws_ok(
  $$
    select public.reserve_estimate_email_dispatch(
      '41000000-0000-4000-8000-000000000002',
      '21000000-0000-4000-8000-000000000001',
      '2000-01-01 00:00:00+00'::timestamptz,
      '11000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000002',
      repeat('9', 64),
      'client@example.test',
      array['copie@example.test'],
      'Devis transactionnel modifie',
      'Veuillez trouver le devis.',
      'devis@example.test'
    )
  $$,
  '23505',
  'ESTIMATE_EMAIL_IDEMPOTENCY_CONFLICT',
  'reusing a request id for another payload is rejected'
);

select is(
  pg_temp.publish_estimate_email_test_pdf(
    '41000000-0000-4000-8000-000000000002',
    (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000002'),
    repeat('c', 64)
  ),
  '21000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000001/41000000-0000-4000-8000-000000000002/' || repeat('c', 64) || '.pdf',
  'the email fixture publishes the exact content-addressed PDF proof'
);

select lives_ok(
  $$
    select public.prepare_estimate_email_dispatch(
      (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000002'),
      '21000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      repeat('a', 64),
      repeat('b', 64),
      '<p>Devis transactionnel</p>',
      'Devis transactionnel',
      '21000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000001/41000000-0000-4000-8000-000000000002/' || repeat('c', 64) || '.pdf',
      repeat('c', 64),
      'DEVIS-TX.pdf'
    )
  $$,
  'preparation freezes the provider payload, document proof, and version seal'
);

select lives_ok(
  $$
    select public.claim_estimate_email_dispatch(
      (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000002'),
      '21000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000002',
      120
    )
  $$,
  'claim leases the frozen dispatch before the provider call'
);

reset role;
update public.tenants
set is_active = false
where id = '21000000-0000-4000-8000-000000000001';
delete from public.tenant_memberships
where id = '22000000-0000-4000-8000-000000000001';
set local role service_role;

select lives_ok(
  $$
    select public.complete_estimate_email_dispatch(
      (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000002'),
      '21000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000002',
      'resend-email-success',
      '2026-08-12 10:00:00+00'::timestamptz
    )
  $$,
  'completion commits provider proof after the claimed actor and tenant are suspended'
);

reset role;
update public.tenants
set is_active = true
where id = '21000000-0000-4000-8000-000000000001';
insert into public.tenant_memberships (
  id,
  tenant_id,
  user_id,
  role,
  is_default
) values (
  '22000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  'engineer'::public.tenant_role,
  false
);
set local role service_role;

select results_eq(
  $$
    select
      dispatch.status,
      dispatch.provider_id,
      dispatch.attempt_count,
      version.status::text,
      version.seal_hash
    from public.estimate_emails as dispatch
    join public.estimate_versions as version
      on version.id = dispatch.version_id
    where dispatch.request_id = '61000000-0000-4000-8000-000000000002'
  $$,
  $$ values ('sent'::text, 'resend-email-success'::text, 1, 'sent'::text, repeat('a', 64)) $$,
  'successful completion persists the dispatch, attempt, provider id, version status, and seal'
);

select bag_eq(
  $$
    select event_type
    from public.estimate_email_dispatch_events
    where dispatch_id = (
      select id
      from public.estimate_emails
      where request_id = '61000000-0000-4000-8000-000000000002'
    )
  $$,
  $$ values ('reserved'::text), ('prepared'::text), ('claimed'::text), ('sent'::text) $$,
  'the successful lifecycle is journaled append-only'
);

select is(
  (
    select count(*)::integer
    from public.estimate_version_events
    where estimate_version_id = '41000000-0000-4000-8000-000000000002'
      and event_type = 'sent'
  ),
  1,
  'successful completion records the estimate sent event'
);

select lives_ok(
  $$
    select public.reserve_estimate_email_dispatch(
      '41000000-0000-4000-8000-000000000002',
      '21000000-0000-4000-8000-000000000001',
      (select updated_at from public.estimate_versions where id = '41000000-0000-4000-8000-000000000002'),
      '11000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000014',
      repeat('e', 64),
      'first-resend@example.test',
      null::text[],
      'Premier renvoi',
      'Premier message de renvoi.',
      'devis@example.test'
    )
  $$,
  'a sent estimate can reserve a new immutable resend envelope'
);

select throws_ok(
  $$
    select public.reserve_estimate_email_dispatch(
      '41000000-0000-4000-8000-000000000002',
      '21000000-0000-4000-8000-000000000001',
      '2000-01-01 00:00:00+00'::timestamptz,
      '11000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000015',
      repeat('f', 64),
      'replacement@example.test',
      null::text[],
      'Objet de remplacement',
      'Message de remplacement.',
      'autre@example.test'
    )
  $$,
  '23505',
  'ESTIMATE_EMAIL_IDEMPOTENCY_CONFLICT',
  'a fresh sent-page submission cannot replace an active resend payload'
);

select results_eq(
  $$
    select request_id, payload_hash, recipient, subject, from_address
    from public.estimate_emails
    where request_id = '61000000-0000-4000-8000-000000000014'
  $$,
  $$
    values (
      '61000000-0000-4000-8000-000000000014'::uuid,
      repeat('e', 64),
      'first-resend@example.test'::text,
      'Premier renvoi'::text,
      'devis@example.test'::text
    )
  $$,
  'sent resume preserves the database-owned envelope and request identity'
);

update public.estimate_versions
set status = 'accepted'::public.estimate_status
where id = '41000000-0000-4000-8000-000000000002';

select lives_ok(
  $$
    select public.prepare_estimate_email_dispatch(
      (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000014'),
      '21000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      repeat('a', 64),
      repeat('6', 64),
      '<p>Renvoi fige accepte</p>',
      'Renvoi fige accepte',
      '21000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000001/41000000-0000-4000-8000-000000000002/' || repeat('c', 64) || '.pdf',
      repeat('c', 64),
      'DEVIS-ACCEPTE.pdf'
    )
  $$,
  'a sent resend keeps preparing against its frozen proof after portal acceptance'
);

select lives_ok(
  $$
    select public.claim_estimate_email_dispatch(
      (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000014'),
      '21000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000014',
      120
    )
  $$,
  'the accepted-version resend can still be claimed'
);

select lives_ok(
  $$
    select public.complete_estimate_email_dispatch(
      (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000014'),
      '21000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000014',
      'resend-email-after-acceptance',
      '2026-08-12 11:00:00+00'::timestamptz
    )
  $$,
  'provider proof finalizes the resend without downgrading an accepted version'
);

select results_eq(
  $$
    select dispatch.status, dispatch.provider_id, version.status::text
    from public.estimate_emails as dispatch
    join public.estimate_versions as version
      on version.id = dispatch.version_id
    where dispatch.request_id = '61000000-0000-4000-8000-000000000014'
  $$,
  $$ values ('sent'::text, 'resend-email-after-acceptance'::text, 'accepted'::text) $$,
  'accepted remains authoritative while the resend records provider success'
);

select lives_ok(
  $$
    select public.reserve_estimate_email_dispatch(
      '41000000-0000-4000-8000-000000000003',
      '21000000-0000-4000-8000-000000000001',
      (select updated_at from public.estimate_versions where id = '41000000-0000-4000-8000-000000000003'),
      '11000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000003',
      repeat('3', 64),
      'client@example.test',
      null::text[],
      'Devis preparation echouee',
      'Veuillez trouver le devis.',
      'devis@example.test'
    )
  $$,
  'a second draft is reserved for a preparation failure'
);

select lives_ok(
  $$
    select public.fail_estimate_email_dispatch(
      (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000003'),
      '21000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      null::uuid,
      'PDF_PREPARATION_FAILED',
      'The PDF could not be prepared.'
    )
  $$,
  'a deterministic preparation failure releases the draft'
);

select results_eq(
  $$
    select dispatch.status, version.status::text, version.seal_hash
    from public.estimate_emails as dispatch
    join public.estimate_versions as version
      on version.id = dispatch.version_id
    where dispatch.request_id = '61000000-0000-4000-8000-000000000003'
  $$,
  $$ values ('failed'::text, 'draft'::text, null::text) $$,
  'a preparation failure never leaves a false sent or sealed state'
);

update public.estimate_versions
set
  status = 'sent'::public.estimate_status,
  seal_hash = repeat('d', 64)
where id = '41000000-0000-4000-8000-000000000003';

select lives_ok(
  $$
    select public.reserve_estimate_email_dispatch(
      '41000000-0000-4000-8000-000000000003',
      '21000000-0000-4000-8000-000000000001',
      (select updated_at from public.estimate_versions where id = '41000000-0000-4000-8000-000000000003'),
      '11000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000003',
      repeat('3', 64),
      'client@example.test',
      null::text[],
      'Devis preparation echouee',
      'Veuillez trouver le devis.',
      'devis@example.test'
    )
  $$,
  'a failed resend on a sent version can resume with the same request'
);

select results_eq(
  $$
    select dispatch.status, version.status::text, version.seal_hash
    from public.estimate_emails as dispatch
    join public.estimate_versions as version
      on version.id = dispatch.version_id
    where dispatch.request_id = '61000000-0000-4000-8000-000000000003'
  $$,
  $$ values ('preparing'::text, 'sent'::text, repeat('d', 64)) $$,
  'retrying a failed resend preserves the sent contractual state'
);

select is(
  pg_temp.publish_estimate_email_test_pdf(
    '41000000-0000-4000-8000-000000000003',
    null,
    repeat('9', 64),
    'legacy'
  ),
  '21000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000001/41000000-0000-4000-8000-000000000003/' || repeat('9', 64) || '.pdf',
  'the sent retry fixture reuses a previously published contractual PDF'
);

select lives_ok(
  $$
    select public.prepare_estimate_email_dispatch(
      (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000003'),
      '21000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      repeat('d', 64),
      repeat('8', 64),
      '<p>Payload fige a reutiliser</p>',
      'Payload fige a reutiliser',
      '21000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000001/41000000-0000-4000-8000-000000000003/' || repeat('9', 64) || '.pdf',
      repeat('9', 64),
      'DEVIS-RETRY-FIGE.pdf'
    )
  $$,
  'the retry payload is frozen once before the provider attempt'
);

select lives_ok(
  $$
    select public.claim_estimate_email_dispatch(
      (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000003'),
      '21000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000003',
      120
    )
  $$,
  'the frozen retry payload is leased before delivery'
);

select lives_ok(
  $$
    select public.fail_estimate_email_dispatch(
      (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000003'),
      '21000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000003',
      'PROVIDER_REJECTED',
      'The provider rejected the frozen payload.'
    )
  $$,
  'a deterministic provider failure keeps the frozen payload retryable'
);

select results_eq(
  $$
    select
      dispatch.status,
      dispatch.provider_payload_hash,
      dispatch.html_body,
      dispatch.text_body,
      dispatch.document_path,
      dispatch.document_sha256,
      dispatch.attachment_filename,
      version.status::text,
      version.seal_hash
    from public.estimate_emails as dispatch
    join public.estimate_versions as version
      on version.id = dispatch.version_id
    where dispatch.request_id = '61000000-0000-4000-8000-000000000003'
  $$,
  $$
    values (
      'failed'::text,
      repeat('8', 64),
      '<p>Payload fige a reutiliser</p>'::text,
      'Payload fige a reutiliser'::text,
      ('21000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000001/41000000-0000-4000-8000-000000000003/' || repeat('9', 64) || '.pdf')::text,
      repeat('9', 64),
      'DEVIS-RETRY-FIGE.pdf'::text,
      'sent'::text,
      repeat('d', 64)
    )
  $$,
  'failure preserves every frozen provider field and the contractual version state'
);

select throws_ok(
  $$
    select public.reserve_estimate_email_dispatch(
      '41000000-0000-4000-8000-000000000003',
      '21000000-0000-4000-8000-000000000001',
      (select updated_at from public.estimate_versions where id = '41000000-0000-4000-8000-000000000003'),
      '11000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000003',
      repeat('3', 64),
      'client@example.test',
      null::text[],
      'Devis preparation echouee',
      'Veuillez trouver le devis.',
      'devis@example.test'
    )
  $$,
  '23505',
  'ESTIMATE_EMAIL_RETRY_REQUIRES_NEW_REQUEST',
  'a frozen failed resend requires a fresh request instead of reusing its provider key'
);

select results_eq(
  $$
    select
      status,
      provider_payload_hash,
      html_body,
      text_body,
      document_path,
      document_sha256,
      attachment_filename
    from public.estimate_emails
    where request_id = '61000000-0000-4000-8000-000000000003'
  $$,
  $$
    values (
      'failed'::text,
      repeat('8', 64),
      '<p>Payload fige a reutiliser</p>'::text,
      'Payload fige a reutiliser'::text,
      ('21000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000001/41000000-0000-4000-8000-000000000003/' || repeat('9', 64) || '.pdf')::text,
      repeat('9', 64),
      'DEVIS-RETRY-FIGE.pdf'::text
    )
  $$,
  'a rejected same-key retry cannot regenerate or rewrite the frozen provider payload'
);

select throws_ok(
  $$
    delete from public.estimate_email_dispatch_events
    where dispatch_id = (
      select id
      from public.estimate_emails
      where request_id = '61000000-0000-4000-8000-000000000003'
    )
  $$,
  '42501',
  'ESTIMATE_EMAIL_DISPATCH_EVENTS_APPEND_ONLY',
  'a direct service-role delete of a dispatch event is refused'
);

reset role;
delete from public.estimate_versions
where id = '41000000-0000-4000-8000-000000000009';
set local role service_role;

select is(
  (
    select count(*)::integer
    from public.estimate_email_dispatch_events
    where version_id = '41000000-0000-4000-8000-000000000009'
  ),
  0,
  'deleting a draft parent cascades through its append-only dispatch events'
);

select is(
  (
    select count(*)::integer
    from public.estimate_emails
    where version_id = '41000000-0000-4000-8000-000000000009'
  ),
  0,
  'deleting a draft parent cascades through its email dispatch'
);

select lives_ok(
  $$
    select public.reserve_estimate_email_dispatch(
      '41000000-0000-4000-8000-000000000004',
      '21000000-0000-4000-8000-000000000001',
      (select updated_at from public.estimate_versions where id = '41000000-0000-4000-8000-000000000004'),
      '11000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000004',
      repeat('4', 64),
      'client@example.test',
      null::text[],
      'Devis issue inconnue sent',
      'Veuillez trouver le devis.',
      'devis@example.test'
    )
  $$,
  'a dispatch is reserved for sent reconciliation'
);

select is(
  pg_temp.publish_estimate_email_test_pdf(
    '41000000-0000-4000-8000-000000000004',
    (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000004'),
    repeat('f', 64)
  ),
  '21000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000001/41000000-0000-4000-8000-000000000004/' || repeat('f', 64) || '.pdf',
  'the sent-reconciliation fixture publishes its reserved PDF proof'
);

select lives_ok(
  $$
    select public.prepare_estimate_email_dispatch(
      (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000004'),
      '21000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      repeat('d', 64),
      repeat('e', 64),
      '<p>Devis a reconcilier sent</p>',
      'Devis a reconcilier sent',
      '21000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000001/41000000-0000-4000-8000-000000000004/' || repeat('f', 64) || '.pdf',
      repeat('f', 64),
      'DEVIS-UNKNOWN-SENT.pdf'
    )
  $$,
  'the sent-reconciliation payload is frozen'
);

select lives_ok(
  $$
    select public.claim_estimate_email_dispatch(
      (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000004'),
      '21000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000004',
      120
    )
  $$,
  'the sent-reconciliation dispatch is claimed'
);

select lives_ok(
  $$
    select public.mark_estimate_email_dispatch_unknown(
      (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000004'),
      '21000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000004',
      'PROVIDER_OUTCOME_UNKNOWN',
      'The provider outcome is unknown.'
    )
  $$,
  'an ambiguous provider outcome is frozen as unknown'
);

select throws_ok(
  $$
    select public.reconcile_estimate_email_dispatch(
      (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000004'),
      'sent',
      '11000000-0000-4000-8000-000000000002',
      null,
      'Missing provider proof must fail.'
    )
  $$,
  '22023',
  'ESTIMATE_EMAIL_PROVIDER_ID_REQUIRED',
  'sent reconciliation requires a provider id'
);

select lives_ok(
  $$
    select public.reconcile_estimate_email_dispatch(
      (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000004'),
      'sent',
      '11000000-0000-4000-8000-000000000002',
      'resend-email-reconciled',
      'Confirmed in the provider dashboard.'
    )
  $$,
  'an admin reconciles unknown to sent with provider proof'
);

select results_eq(
  $$
    select dispatch.status, dispatch.provider_id, version.status::text
    from public.estimate_emails as dispatch
    join public.estimate_versions as version
      on version.id = dispatch.version_id
    where dispatch.request_id = '61000000-0000-4000-8000-000000000004'
  $$,
  $$ values ('sent'::text, 'resend-email-reconciled'::text, 'sent'::text) $$,
  'sent reconciliation closes both the dispatch and version'
);

select is(
  (
    select count(*)::integer
    from public.estimate_email_dispatch_events
    where dispatch_id = (
      select id
      from public.estimate_emails
      where request_id = '61000000-0000-4000-8000-000000000004'
    )
      and event_type = 'reconciled_sent'
  ),
  1,
  'sent reconciliation is journaled'
);

select lives_ok(
  $$
    select public.reserve_estimate_email_dispatch(
      '41000000-0000-4000-8000-000000000005',
      '21000000-0000-4000-8000-000000000001',
      (select updated_at from public.estimate_versions where id = '41000000-0000-4000-8000-000000000005'),
      '11000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000005',
      repeat('5', 64),
      'client@example.test',
      null::text[],
      'Devis issue inconnue failed',
      'Veuillez trouver le devis.',
      'devis@example.test'
    )
  $$,
  'a dispatch is reserved for failed reconciliation'
);

select is(
  pg_temp.publish_estimate_email_test_pdf(
    '41000000-0000-4000-8000-000000000005',
    (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000005'),
    repeat('3', 64)
  ),
  '21000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000001/41000000-0000-4000-8000-000000000005/' || repeat('3', 64) || '.pdf',
  'the failed-reconciliation fixture publishes its reserved PDF proof'
);

select lives_ok(
  $$
    select public.prepare_estimate_email_dispatch(
      (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000005'),
      '21000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      repeat('1', 64),
      repeat('2', 64),
      '<p>Devis a reconcilier failed</p>',
      'Devis a reconcilier failed',
      '21000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000001/41000000-0000-4000-8000-000000000005/' || repeat('3', 64) || '.pdf',
      repeat('3', 64),
      'DEVIS-UNKNOWN-FAILED.pdf'
    )
  $$,
  'the failed-reconciliation payload is frozen'
);

select lives_ok(
  $$
    select public.claim_estimate_email_dispatch(
      (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000005'),
      '21000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000005',
      120
    )
  $$,
  'the failed-reconciliation dispatch is claimed'
);

select lives_ok(
  $$
    select public.mark_estimate_email_dispatch_unknown(
      (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000005'),
      '21000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000005',
      'PROVIDER_OUTCOME_UNKNOWN',
      'The provider outcome is unknown.'
    )
  $$,
  'a second ambiguous provider outcome is frozen as unknown'
);

select lives_ok(
  $$
    select public.reconcile_estimate_email_dispatch(
      (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000005'),
      'failed',
      '11000000-0000-4000-8000-000000000002',
      null,
      'Provider confirmed that no email was accepted.'
    )
  $$,
  'an admin reconciles unknown to failed without inventing provider proof'
);

select results_eq(
  $$
    select dispatch.status, version.status::text, version.seal_hash
    from public.estimate_emails as dispatch
    join public.estimate_versions as version
      on version.id = dispatch.version_id
    where dispatch.request_id = '61000000-0000-4000-8000-000000000005'
  $$,
  $$ values ('failed'::text, 'draft'::text, null::text) $$,
  'failed reconciliation releases the version to an editable unsealed draft'
);

select is(
  (
    select count(*)::integer
    from public.estimate_email_dispatch_events
    where dispatch_id = (
      select id
      from public.estimate_emails
      where request_id = '61000000-0000-4000-8000-000000000005'
    )
      and event_type = 'reconciled_failed'
  ),
  1,
  'failed reconciliation is journaled'
);

select * from finish();
rollback;
