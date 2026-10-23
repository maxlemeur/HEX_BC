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

-- Offer client contract fixtures (20261013130248). Reservations now freeze a
-- portal origin and the issuing company; publications carry a client contract
-- snapshot; preparation and emission compare the exact document proof.
create function pg_temp.offer_company()
returns jsonb
language sql
immutable
as $$
  select '{"name":"Estimate email company","tagline":"Synthetic test company","address":{"street":"1 rue du Test","postalCode":"75001","city":"Paris"},"registeredOffice":{"street":"2 rue du Test","postalCode":"75002","city":"Paris"},"phone":{"landline":"+33 1 00 00 00 01","mobile":"+33 6 00 00 00 01"},"legal":{"siret":"TEST-SIRET","vat":"TEST-VAT"}}'::jsonb
$$;

create function pg_temp.offer_layout()
returns jsonb
language sql
immutable
as $$
  select '{"preset":"client_detailed","detailLevel":"lines","priceMode":"unit_and_total","density":"standard","showNumbering":true,"showSectionSubtotals":true,"conditionsPlacement":"auto","includeTerms":false}'::jsonb
$$;

-- Identity compared by publication: the dispatch-frozen identity for an email
-- render, otherwise the identity captured for the actual renderer actor.
create function pg_temp.offer_identity(
  p_version_id uuid,
  p_actor_user_id uuid,
  p_dispatch_id uuid
)
returns jsonb
language plpgsql
as $$
declare
  target_version public.estimate_versions%rowtype;
begin
  if p_dispatch_id is not null then
    return (
      select dispatch.offer_identity_snapshot
      from public.estimate_emails as dispatch
      where dispatch.id = p_dispatch_id
    );
  end if;

  select version.* into target_version
  from public.estimate_versions as version
  where version.id = p_version_id;

  return public.capture_estimate_offer_identity(
    target_version,
    p_actor_user_id,
    pg_temp.offer_company()
  );
end;
$$;

-- These fixture versions carry no items, so the client image has no rows and
-- reproduces the stored zero totals.
create function pg_temp.offer_client_snapshot(p_version_id uuid, p_identity jsonb)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'version', jsonb_build_object(
      'id', version.id,
      'tenantId', version.tenant_id,
      'projectId', version.project_id,
      'number', version.version_number,
      'contentRevision', version.content_revision,
      'calcEngineVersion', version.calc_engine_version,
      'dateDevis', version.date_devis,
      'validiteJours', version.validite_jours,
      'currency', version.currency,
      'contractorRole', version.contractor_role,
      'taxRateBp', version.tax_rate_bp
    ),
    'project', p_identity -> 'project',
    'issuer', p_identity -> 'issuer',
    'company', p_identity -> 'company',
    'rows', '[]'::jsonb,
    'totals', jsonb_build_object(
      'saleHtCents', version.total_ht_cents,
      'taxCents', version.total_tax_cents - coalesce(version.rounding_adjustment_cents, 0),
      'calculatedTtcCents',
        version.total_ht_cents + version.total_tax_cents - coalesce(version.rounding_adjustment_cents, 0),
      'payableTtcCents', version.total_ttc_cents,
      'roundingAdjustmentCents', coalesce(version.rounding_adjustment_cents, 0)
    ),
    'exclusions', coalesce(to_jsonb(version.exclusions), 'null'::jsonb)
  )
  from public.estimate_versions as version
  where version.id = p_version_id
    and not exists (
      select 1
      from public.estimate_items as item
      where item.version_id = version.id
    )
$$;

-- Independent image of the document proof the server reads before preparing,
-- emitting or deciding an offer.
create function pg_temp.offer_document_proof(p_version_id uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'proofVersion', 1,
    'documentId', document.id,
    'tenantId', document.tenant_id,
    'versionId', document.version_id,
    'projectId', version.project_id,
    'status', document.status,
    'filePath', document.file_path,
    'sha256Hash', document.sha256_hash,
    'fileSizeBytes', document.file_size_bytes,
    'generatedAt', to_char(document.generated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'generatedBy', document.generated_by,
    'publishedGenerationToken', document.published_generation_token,
    'publishedPurpose', document.published_purpose,
    'publishedDispatchId', document.published_dispatch_id,
    'publishedContentRevision', document.published_content_revision,
    'clientContractVersion', document.client_contract_version,
    'clientContractSnapshot', document.client_contract_snapshot,
    'layoutOptions', document.layout_options,
    'termsSnapshot', document.terms_snapshot
  )
  from public.estimate_documents as document
  join public.estimate_versions as version
    on version.id = document.version_id
  where document.version_id = p_version_id
$$;

-- Publishes through the trusted renderer RPCs (claim, then publication of the
-- client contract) instead of writing a ready document row directly.
create function pg_temp.publish_estimate_email_test_pdf(
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
  claimed_document public.estimate_documents%rowtype;
  published_document public.estimate_documents%rowtype;
begin
  select version.* into target_version
  from public.estimate_versions as version
  where version.id = p_version_id;

  claimed_document := public.begin_estimate_pdf_generation(
    target_version.id,
    target_version.tenant_id,
    '11000000-0000-4000-8000-000000000001',
    p_purpose,
    p_dispatch_id
  );

  published_document := public.publish_estimate_pdf_generation(
    target_version.id,
    target_version.tenant_id,
    '11000000-0000-4000-8000-000000000001',
    claimed_document.generation_token,
    concat(
      target_version.tenant_id::text,
      '/',
      target_version.project_id::text,
      '/',
      target_version.id::text,
      '/',
      p_sha256,
      '.pdf'
    ),
    p_sha256,
    1024,
    clock_timestamp(),
    pg_temp.offer_layout(),
    null,
    pg_temp.offer_client_snapshot(
      target_version.id,
      pg_temp.offer_identity(
        target_version.id,
        '11000000-0000-4000-8000-000000000001',
        p_dispatch_id
      )
    )
  );

  return published_document.file_path;
end;
$$;

select throws_ok(
  $$
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
      '41000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000001/41000000-0000-4000-8000-000000000001/' || repeat('a', 64) || '.pdf',
      repeat('a', 64),
      1024,
      '11000000-0000-4000-8000-000000000001',
      clock_timestamp(),
      'ready',
      'manual',
      1
    )
  $$,
  '23514',
  'OFFER_NEW_DOCUMENT_CONTRACT_REQUIRED',
  'a ready commercial PDF cannot be written without the publication RPC client contract'
);

-- Model a document published before content-addressed paths and the client
-- contract existed. The path migration backfilled such rows as 'legacy' and
-- the offer migration left their client contract NULL; only this historical
-- seed bypasses the two guards installed after them.
reset role;
alter table public.estimate_documents
  disable trigger enforce_estimate_document_canonical_path;
alter table public.estimate_documents
  disable trigger aaa_guard_estimate_offer_document;
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
  enable trigger aaa_guard_estimate_offer_document;
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
      'devis@example.test',
      'https://portal.example.test',
      pg_temp.offer_company()
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
      'devis@example.test',
      'https://portal.example.test',
      pg_temp.offer_company()
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
      pg_temp.offer_layout(),
      null,
      pg_temp.offer_client_snapshot(
        '41000000-0000-4000-8000-000000000001',
        pg_temp.offer_identity(
          '41000000-0000-4000-8000-000000000001',
          '11000000-0000-4000-8000-000000000001',
          null
        )
      )
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
      pg_temp.offer_layout(),
      null,
      pg_temp.offer_client_snapshot(
        '41000000-0000-4000-8000-000000000001',
        pg_temp.offer_identity(
          '41000000-0000-4000-8000-000000000001',
          '11000000-0000-4000-8000-000000000001',
          (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000001')
        )
      )
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
      'devis@example.test',
      'https://portal.example.test',
      pg_temp.offer_company()
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
      'devis@example.test',
      'https://portal.example.test',
      pg_temp.offer_company()
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
      'devis@example.test',
      'https://portal.example.test',
      pg_temp.offer_company()
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
      'devis@example.test',
      'https://portal.example.test',
      pg_temp.offer_company()
    )
  $$,
  'a first-send dispatch is reserved for frozen retry coverage'
);

-- Publish before preparing: preparation now compares the exact proof of the
-- already published document, so both cannot be arguments of one call.
select is(
  pg_temp.publish_estimate_email_test_pdf(
    '41000000-0000-4000-8000-000000000009',
    (select id from public.estimate_emails where request_id = '61000000-0000-4000-8000-000000000009'),
    repeat('c', 64)
  ),
  '21000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000001/41000000-0000-4000-8000-000000000009/' || repeat('c', 64) || '.pdf',
  'the first-send fixture publishes its reserved PDF proof'
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
      '21000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000001/41000000-0000-4000-8000-000000000009/' || repeat('c', 64) || '.pdf',
      repeat('c', 64),
      'DEVIS-PREMIER-ENVOI.pdf',
      pg_temp.offer_document_proof('41000000-0000-4000-8000-000000000009'),
      5::smallint
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
      'devis@example.test',
      'https://portal.example.test',
      pg_temp.offer_company()
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
      'devis@example.test',
      'https://portal.example.test',
      pg_temp.offer_company()
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
      'devis@example.test',
      'https://portal.example.test',
      pg_temp.offer_company()
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
        'devis@example.test',
        'https://portal.example.test',
        pg_temp.offer_company()
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
        'devis@example.test',
        'https://portal.example.test',
        pg_temp.offer_company()
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
      'devis@example.test',
      'https://portal.example.test',
      pg_temp.offer_company()
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
      'devis@example.test',
      'https://portal.example.test',
      pg_temp.offer_company()
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
      'DEVIS-TX.pdf',
      pg_temp.offer_document_proof('41000000-0000-4000-8000-000000000002'),
      5::smallint
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
      'devis@example.test',
      'https://portal.example.test',
      pg_temp.offer_company()
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
      'autre@example.test',
      'https://portal.example.test',
      pg_temp.offer_company()
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
      'DEVIS-ACCEPTE.pdf',
      pg_temp.offer_document_proof('41000000-0000-4000-8000-000000000002'),
      5::smallint
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
      'devis@example.test',
      'https://portal.example.test',
      pg_temp.offer_company()
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

-- A draft can only become sent over a published client contract with the
-- version 5 seal payload: publish the manual PDF, then use the session-bound
-- manual emission RPC instead of writing status and seal directly.
select is(
  pg_temp.publish_estimate_email_test_pdf(
    '41000000-0000-4000-8000-000000000003',
    null,
    repeat('9', 64),
    'manual'
  ),
  '21000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000001/41000000-0000-4000-8000-000000000003/' || repeat('9', 64) || '.pdf',
  'the sent retry fixture publishes its contractual PDF before emission'
);

select lives_ok(
  $$
    select public.transition_estimate_draft_to_sent(
      '41000000-0000-4000-8000-000000000003',
      '21000000-0000-4000-8000-000000000001',
      (select updated_at from public.estimate_versions where id = '41000000-0000-4000-8000-000000000003'),
      'sent'::public.estimate_status,
      repeat('d', 64),
      '11000000-0000-4000-8000-000000000001',
      '{}'::jsonb,
      clock_timestamp(),
      5::smallint,
      pg_temp.offer_document_proof('41000000-0000-4000-8000-000000000003'),
      '52000000-0000-4000-8000-000000000003'
    )
  $$,
  'the sent retry fixture is sealed by the manual emission workflow'
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
      'devis@example.test',
      'https://portal.example.test',
      pg_temp.offer_company()
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

select results_eq(
  $$
    select document.file_path, document.status, document.client_contract_version::integer
    from public.estimate_documents as document
    where document.version_id = '41000000-0000-4000-8000-000000000003'
  $$,
  $$
    values (
      ('21000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000001/41000000-0000-4000-8000-000000000003/' || repeat('9', 64) || '.pdf')::text,
      'ready'::text,
      1
    )
  $$,
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
      'DEVIS-RETRY-FIGE.pdf',
      pg_temp.offer_document_proof('41000000-0000-4000-8000-000000000003'),
      5::smallint
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
      'devis@example.test',
      'https://portal.example.test',
      pg_temp.offer_company()
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

-- Since 20261013130248 every reservation issues an immutable, dispatch-bound
-- portal capability. A draft that ever reserved an offer email therefore keeps
-- its outbox history: even a privileged delete is refused atomically.
-- Recorded consequence pending a product decision: through the same cascade
-- (estimate_projects -> estimate_versions -> portal_tokens),
-- public.bulk_delete_draft_affaires reports 'failed' for a draft-only affaire
-- whose draft was released after a failed send; archiving it still works.
reset role;

select throws_ok(
  $$
    delete from public.estimate_versions
    where id = '41000000-0000-4000-8000-000000000009'
  $$,
  '42501',
  'OFFER_CAPABILITY_IMMUTABLE',
  'a draft parent that issued an offer capability cannot be deleted'
);

select is(
  (
    select jsonb_build_object(
      'events', (
        select count(*)
        from public.estimate_email_dispatch_events
        where version_id = '41000000-0000-4000-8000-000000000009'
      ),
      'dispatches', (
        select count(*)
        from public.estimate_emails
        where version_id = '41000000-0000-4000-8000-000000000009'
      ),
      'capabilities', (
        select count(*)
        from public.portal_tokens
        where version_id = '41000000-0000-4000-8000-000000000009'
          and capability_contract_version = 2
      )
    )
  ),
  '{"events":6,"dispatches":2,"capabilities":2}'::jsonb,
  'a refused draft deletion keeps its append-only journal, dispatches and capabilities'
);

-- Pre-contract dispatches (request contract 1, no dispatch-bound capability)
-- still cascade with their draft parent through the append-only journal. Seed
-- such a historical row like the legacy document above, bypassing only the
-- request contract guard installed after it existed.
insert into public.estimate_versions (
  id,
  tenant_id,
  project_id,
  version_number,
  status
) values (
  '41000000-0000-4000-8000-000000000011',
  '21000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001',
  11,
  'draft'::public.estimate_status
);

alter table public.estimate_emails
  disable trigger guard_estimate_offer_request_insert;
insert into public.estimate_emails (
  id,
  tenant_id,
  version_id,
  recipient,
  subject,
  body,
  type,
  status,
  request_id,
  payload_hash,
  idempotency_key,
  created_by,
  version_content_revision,
  from_address,
  request_contract_version,
  last_error_code,
  last_error_message
) values (
  '81000000-0000-4000-8000-000000000011',
  '21000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000011',
  'legacy-client@example.test',
  'Devis historique',
  'Envoi anterieur au contrat client.',
  'initial',
  'failed',
  '61000000-0000-4000-8000-000000000021',
  repeat('4', 64),
  'estimate-email/81000000-0000-4000-8000-000000000011',
  '11000000-0000-4000-8000-000000000001',
  1,
  'devis@example.test',
  1,
  'PDF_PREPARATION_FAILED',
  'Historical preparation failure.'
);
alter table public.estimate_emails
  enable trigger guard_estimate_offer_request_insert;

insert into public.estimate_email_dispatch_events (
  tenant_id,
  version_id,
  dispatch_id,
  event_type,
  metadata,
  created_by
) values
  (
    '21000000-0000-4000-8000-000000000001',
    '41000000-0000-4000-8000-000000000011',
    '81000000-0000-4000-8000-000000000011',
    'reserved',
    '{}'::jsonb,
    '11000000-0000-4000-8000-000000000001'
  ),
  (
    '21000000-0000-4000-8000-000000000001',
    '41000000-0000-4000-8000-000000000011',
    '81000000-0000-4000-8000-000000000011',
    'failed',
    '{}'::jsonb,
    '11000000-0000-4000-8000-000000000001'
  );

delete from public.estimate_versions
where id = '41000000-0000-4000-8000-000000000011';
set local role service_role;

select is(
  (
    select count(*)::integer
    from public.estimate_email_dispatch_events
    where version_id = '41000000-0000-4000-8000-000000000011'
  ),
  0,
  'deleting a draft parent cascades through its append-only dispatch events'
);

select is(
  (
    select count(*)::integer
    from public.estimate_emails
    where version_id = '41000000-0000-4000-8000-000000000011'
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
      'devis@example.test',
      'https://portal.example.test',
      pg_temp.offer_company()
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
      'DEVIS-UNKNOWN-SENT.pdf',
      pg_temp.offer_document_proof('41000000-0000-4000-8000-000000000004'),
      5::smallint
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
      'devis@example.test',
      'https://portal.example.test',
      pg_temp.offer_company()
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
      'DEVIS-UNKNOWN-FAILED.pdf',
      pg_temp.offer_document_proof('41000000-0000-4000-8000-000000000005'),
      5::smallint
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

-- The cron must pass permanently ineligible actors before applying its batch
-- limit. A browser cannot prove service-only selection or unchanged leases.
reset role;
update public.tenant_memberships set role = 'viewer'
where id = '22000000-0000-4000-8000-000000000001';

select has_function('public', 'list_due_estimate_email_dispatches', array['timestamp with time zone', 'integer'],
  'the service has an actor-aware due-email selector');
set local role service_role;
create temporary table outbox_selection_baseline as
select (public.list_due_estimate_email_dispatches(now(), 1)->>'blocked')::bigint as blocked;
reset role;

insert into public.estimate_versions(id, tenant_id, project_id, version_number, status)
select ('41000000-0000-4000-8000-' || lpad((100 + n)::text, 12, '0'))::uuid,
  case when n = 29 then '21000000-0000-4000-8000-000000000003'::uuid
    else '21000000-0000-4000-8000-000000000001'::uuid end,
  case when n = 29 then '31000000-0000-4000-8000-000000000004'::uuid
    else '31000000-0000-4000-8000-000000000001'::uuid end,
  100 + n, 'draft'::public.estimate_status
from generate_series(1, 32) n;

-- Historical request-contract-1 rows exercise the compatibility path still
-- consumed by the worker. Only this disposable transaction bypasses the newer
-- insert guard; mutation, actor, RLS and lease guards remain installed.
alter table public.estimate_emails disable trigger guard_estimate_offer_request_insert;
insert into public.estimate_emails(id, tenant_id, version_id, recipient, subject, type, status,
  request_id, payload_hash, idempotency_key, created_by, version_content_revision, from_address,
  request_contract_version, created_at, next_attempt_at, lease_expires_at)
select ('81000000-0000-4000-8000-' || lpad((100 + n)::text, 12, '0'))::uuid,
  case when n = 29 then '21000000-0000-4000-8000-000000000003'::uuid
    else '21000000-0000-4000-8000-000000000001'::uuid end,
  ('41000000-0000-4000-8000-' || lpad((100 + n)::text, 12, '0'))::uuid,
  'local-outbox@example.test', 'ARMY recovery eligibility', 'initial',
  case when n = 32 then 'unknown' else 'queued' end,
  ('61000000-0000-4000-8000-' || lpad((100 + n)::text, 12, '0'))::uuid,
  repeat('a', 64), 'selection-fixture/' || n,
  case when n <= 25 then '11000000-0000-4000-8000-000000000001'::uuid
    when n = 27 then null
    when n = 28 then '11000000-0000-4000-8000-000000000004'::uuid
    when n = 29 then '11000000-0000-4000-8000-000000000005'::uuid
    else '11000000-0000-4000-8000-000000000002'::uuid end,
  1, 'fixture@example.test', 1, '2020-01-01'::timestamptz + n * interval '1 second',
  case when n = 31 then now() + interval '1 hour' else null end,
  case when n = 30 then now() + interval '1 hour' else null end
from generate_series(1, 32) n;
alter table public.estimate_emails enable trigger guard_estimate_offer_request_insert;

create temporary table outbox_selection_before as
select jsonb_agg(to_jsonb(e) order by e.id) as rows from public.estimate_emails e;
grant select on outbox_selection_baseline, outbox_selection_before to service_role;
set local role service_role;
select is(
  public.list_due_estimate_email_dispatches(now(), 1)->'dispatches'->0->>'id',
  '81000000-0000-4000-8000-000000000126',
  'the 26th, authorized email advances past the first 25 revoked creators'
);
select is(
  (public.list_due_estimate_email_dispatches(now(), 1)->>'blocked')::bigint,
  (select blocked + 28 from outbox_selection_baseline),
  'revoked, null, foreign and inactive-tenant actors are counted, live leases/future/unknown rows excluded'
);
select is(
  (select jsonb_agg(to_jsonb(e) order by e.id) from public.estimate_emails e),
  (select rows from outbox_selection_before),
  'selection changes no author, payload, attempt, status, timestamp or lease'
);
select throws_ok($$select public.assert_estimate_email_dispatch_actor(
  '21000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000101',
  '11000000-0000-4000-8000-000000000001', false)$$,
  '42501', 'ESTIMATE_EMAIL_DISPATCH_FORBIDDEN', 'selection never grants the revoked actor permission to claim');
select throws_ok($$select public.list_due_estimate_email_dispatches(now(), 0)$$,
  '22023', 'ESTIMATE_EMAIL_SELECTION_INVALID', 'a zero batch is refused');
select throws_ok($$select public.list_due_estimate_email_dispatches(null, 25)$$,
  '22023', 'ESTIMATE_EMAIL_SELECTION_INVALID', 'a missing clock is refused');
reset role;
select ok(not has_function_privilege('anon', 'public.list_due_estimate_email_dispatches(timestamptz,integer)', 'execute'),
  'anonymous clients cannot enumerate another tenant''s mail');
select ok(not has_function_privilege('authenticated', 'public.list_due_estimate_email_dispatches(timestamptz,integer)', 'execute'),
  'authenticated clients cannot call the cron selector');
set local role authenticated;
select throws_ok($$select public.list_due_estimate_email_dispatches(now(), 25)$$, '42501', null,
  'the selector refuses an ordinary user even with a valid fixture session');
reset role;

select * from finish();
rollback;
