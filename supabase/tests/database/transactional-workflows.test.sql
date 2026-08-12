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
    '11111111-1111-4111-8111-111111111111',
    'authenticated',
    'authenticated',
    'transaction-writer@example.test',
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
    '22222222-2222-4222-8222-222222222222',
    'authenticated',
    'authenticated',
    'transaction-viewer@example.test',
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

update public.tenant_memberships
set role = 'engineer'::public.tenant_role
where user_id = '11111111-1111-4111-8111-111111111111';

update public.tenant_memberships
set role = 'viewer'::public.tenant_role
where user_id = '22222222-2222-4222-8222-222222222222';

insert into public.suppliers (id, tenant_id, name)
select
  '31111111-1111-4111-8111-111111111111',
  membership.tenant_id,
  'Fournisseur transactionnel'
from public.tenant_memberships as membership
where membership.user_id = '11111111-1111-4111-8111-111111111111';

insert into public.delivery_sites (id, tenant_id, name, project_code)
select
  '32222222-2222-4222-8222-222222222222',
  membership.tenant_id,
  'Chantier transactionnel',
  'TX-DB'
from public.tenant_memberships as membership
where membership.user_id = '11111111-1111-4111-8111-111111111111';

insert into public.products (
  id,
  tenant_id,
  reference,
  designation,
  unit_price_cents,
  tax_rate_bp
)
select
  '33333333-3333-4333-8333-333333333333',
  membership.tenant_id,
  'PROD-TX',
  'Produit transactionnel',
  1250,
  2000
from public.tenant_memberships as membership
where membership.user_id = '11111111-1111-4111-8111-111111111111';

insert into public.supplier_catalog_items (
  id,
  tenant_id,
  supplier_id,
  product_id,
  supplier_sku
)
select
  '33444444-4444-4444-8444-444444444444',
  membership.tenant_id,
  '31111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333',
  'SUP-TX-001'
from public.tenant_memberships as membership
where membership.user_id = '11111111-1111-4111-8111-111111111111';

insert into public.supplier_pricebook (
  id,
  tenant_id,
  supplier_catalog_item_id,
  supplier_id,
  product_id,
  unit_price_cents
)
select
  '33555555-5555-4555-8555-555555555555',
  membership.tenant_id,
  '33444444-4444-4444-8444-444444444444',
  '31111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333',
  1100
from public.tenant_memberships as membership
where membership.user_id = '11111111-1111-4111-8111-111111111111';

insert into public.estimate_projects (
  id,
  tenant_id,
  user_id,
  name,
  is_archived
)
select
  '34444444-4444-4444-8444-444444444444',
  membership.tenant_id,
  membership.user_id,
  'Source de traçabilité',
  false
from public.tenant_memberships as membership
where membership.user_id = '11111111-1111-4111-8111-111111111111';

insert into public.estimate_versions (
  id,
  tenant_id,
  project_id,
  version_number,
  status
)
select
  '35555555-5555-4555-8555-555555555555',
  project.tenant_id,
  project.id,
  1,
  'draft'::public.estimate_status
from public.estimate_projects as project
where project.id = '34444444-4444-4444-8444-444444444444';

insert into public.estimate_items (
  id,
  tenant_id,
  version_id,
  item_type,
  position,
  title
)
select
  '36555555-5555-4555-8555-555555555555',
  version.tenant_id,
  version.id,
  'section'::public.estimate_item_type,
  1,
  'Section source'
from public.estimate_versions as version
where version.id = '35555555-5555-4555-8555-555555555555';

insert into public.estimate_items (
  id,
  tenant_id,
  version_id,
  parent_id,
  item_type,
  position,
  title,
  quantity,
  unit_price_ht_cents,
  tax_rate_bp,
  k_fo,
  h_mo,
  k_mo,
  pu_ht_cents,
  line_total_ht_cents,
  line_tax_cents,
  line_total_ttc_cents
)
select
  '36666666-6666-4666-8666-666666666666',
  version.tenant_id,
  version.id,
  '36555555-5555-4555-8555-555555555555',
  'line'::public.estimate_item_type,
  1,
  'Ligne source',
  1,
  1000,
  2000,
  1,
  0,
  1,
  1000,
  1000,
  200,
  1200
from public.estimate_versions as version
where version.id = '35555555-5555-4555-8555-555555555555';

insert into public.purchase_orders (
  id,
  tenant_id,
  reference,
  user_id,
  supplier_id,
  delivery_site_id,
  status,
  expected_delivery_date,
  notes,
  total_ht_cents,
  total_tax_cents,
  total_ttc_cents
)
select
  '37777777-7777-4777-8777-777777777777',
  membership.tenant_id,
  'PO-TX-001',
  membership.user_id,
  '31111111-1111-4111-8111-111111111111',
  '32222222-2222-4222-8222-222222222222',
  'draft'::public.purchase_order_status,
  'TBD',
  'original',
  2500,
  500,
  3000
from public.tenant_memberships as membership
where membership.user_id = '11111111-1111-4111-8111-111111111111';

insert into public.purchase_order_items (
  id,
  tenant_id,
  purchase_order_id,
  position,
  product_id,
  reference,
  designation,
  unit_price_ht_cents,
  tax_rate_bp,
  quantity,
  line_total_ht_cents,
  line_tax_cents,
  line_total_ttc_cents,
  source_estimate_item_id
)
select
  '38888888-8888-4888-8888-888888888888',
  purchase_order.tenant_id,
  purchase_order.id,
  1,
  '33333333-3333-4333-8333-333333333333',
  'REF-001',
  'Coffret A',
  1250,
  2000,
  2,
  2500,
  500,
  3000,
  '36666666-6666-4666-8666-666666666666'
from public.purchase_orders as purchase_order
where purchase_order.id = '37777777-7777-4777-8777-777777777777';

insert into public.purchase_order_devis (
  id,
  tenant_id,
  purchase_order_id,
  user_id,
  name,
  original_filename,
  storage_path,
  file_size_bytes,
  mime_type
)
select
  '38999999-9999-4999-8999-999999999999',
  purchase_order.tenant_id,
  purchase_order.id,
  purchase_order.user_id,
  'Devis fournisseur',
  'devis-fournisseur.pdf',
  'purchase-orders/37777777-7777-4777-8777-777777777777/devis-fournisseur.pdf',
  1024,
  'application/pdf'
from public.purchase_orders as purchase_order
where purchase_order.id = '37777777-7777-4777-8777-777777777777';

insert into public.purchase_orders (
  id,
  tenant_id,
  reference,
  user_id,
  supplier_id,
  delivery_site_id,
  status,
  expected_delivery_date
)
select
  '3a111111-1111-4111-8111-111111111111',
  membership.tenant_id,
  'PO-ATOMIC-DELETE',
  membership.user_id,
  '31111111-1111-4111-8111-111111111111',
  '32222222-2222-4222-8222-222222222222',
  'draft'::public.purchase_order_status,
  'TBD'
from public.tenant_memberships as membership
where membership.user_id = '11111111-1111-4111-8111-111111111111';

insert into public.purchase_order_devis (
  id,
  tenant_id,
  purchase_order_id,
  user_id,
  name,
  original_filename,
  storage_path,
  file_size_bytes,
  mime_type
)
select
  '3b111111-1111-4111-8111-111111111111',
  purchase_order.tenant_id,
  purchase_order.id,
  purchase_order.user_id,
  'Devis suppression atomique',
  'atomic-delete.pdf',
  'purchase-orders/3a111111-1111-4111-8111-111111111111/atomic-delete.pdf',
  512,
  'application/pdf'
from public.purchase_orders as purchase_order
where purchase_order.id = '3a111111-1111-4111-8111-111111111111';

insert into public.suppliers (id, tenant_id, name)
select
  '51111111-1111-4111-8111-111111111111',
  membership.tenant_id,
  'Fournisseur viewer'
from public.tenant_memberships as membership
where membership.user_id = '22222222-2222-4222-8222-222222222222';

insert into public.delivery_sites (id, tenant_id, name, project_code)
select
  '52222222-2222-4222-8222-222222222222',
  membership.tenant_id,
  'Chantier viewer',
  'TX-VIEWER'
from public.tenant_memberships as membership
where membership.user_id = '22222222-2222-4222-8222-222222222222';

insert into public.purchase_orders (
  id,
  tenant_id,
  reference,
  user_id,
  supplier_id,
  delivery_site_id,
  status,
  expected_delivery_date
)
select
  '53333333-3333-4333-8333-333333333333',
  membership.tenant_id,
  'PO-VIEWER-001',
  membership.user_id,
  '51111111-1111-4111-8111-111111111111',
  '52222222-2222-4222-8222-222222222222',
  'draft'::public.purchase_order_status,
  '2026-08-31'
from public.tenant_memberships as membership
where membership.user_id = '22222222-2222-4222-8222-222222222222';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);

select throws_ok(
  $$
    update public.purchase_order_devis
    set storage_path = 'signatures/portal-token.png'
    where id = '3b111111-1111-4111-8111-111111111111'
  $$,
  '42501',
  'PURCHASE_ORDER_DEVIS_STORAGE_PATH_IMMUTABLE',
  'an authenticated owner cannot retarget a devis before privileged cleanup'
);

select throws_ok(
  $$
    insert into public.purchase_order_devis (
      id,
      tenant_id,
      purchase_order_id,
      user_id,
      name,
      original_filename,
      storage_path,
      file_size_bytes,
      mime_type
    )
    select
      '3b222222-2222-4222-8222-222222222222',
      purchase_order.tenant_id,
      purchase_order.id,
      purchase_order.user_id,
      'Chemin hors devis',
      'signature.png',
      'signatures/portal-token.png',
      128,
      'image/png'
    from public.purchase_orders as purchase_order
    where purchase_order.id = '3a111111-1111-4111-8111-111111111111'
  $$,
  '23514',
  'PURCHASE_ORDER_DEVIS_STORAGE_PATH_INVALID',
  'a devis cannot target another namespace in the shared bucket'
);

select throws_ok(
  $$
    insert into public.purchase_order_devis (
      id,
      tenant_id,
      purchase_order_id,
      user_id,
      name,
      original_filename,
      storage_path,
      file_size_bytes,
      mime_type
    )
    select
      '3b333333-3333-4333-8333-333333333333',
      purchase_order.tenant_id,
      purchase_order.id,
      purchase_order.user_id,
      'Chemin autre commande',
      'other-order.pdf',
      'purchase-orders/37777777-7777-4777-8777-777777777777/other-order.pdf',
      128,
      'application/pdf'
    from public.purchase_orders as purchase_order
    where purchase_order.id = '3a111111-1111-4111-8111-111111111111'
  $$,
  '23514',
  'PURCHASE_ORDER_DEVIS_STORAGE_PATH_INVALID',
  'a devis path must carry its own purchase order id'
);

select throws_ok(
  $$
    insert into public.purchase_order_devis (
      id,
      tenant_id,
      purchase_order_id,
      user_id,
      name,
      original_filename,
      storage_path,
      file_size_bytes,
      mime_type
    )
    select
      '3b444444-4444-4444-8444-444444444444',
      purchase_order.tenant_id,
      purchase_order.id,
      purchase_order.user_id,
      'Chemin traversal',
      '..',
      'purchase-orders/' || purchase_order.id::text || '/..',
      128,
      'application/octet-stream'
    from public.purchase_orders as purchase_order
    where purchase_order.id = '3a111111-1111-4111-8111-111111111111'
  $$,
  '23514',
  'PURCHASE_ORDER_DEVIS_STORAGE_PATH_INVALID',
  'a devis cannot poison cleanup with a dot-segment path'
);

select set_config(
  'test.atomic_purchase_order_delete_result',
  public.delete_purchase_order_draft_atomic(
    '3a111111-1111-4111-8111-111111111111'
  )::text,
  true
);

select is(
  current_setting('test.atomic_purchase_order_delete_result')::jsonb->>'id',
  '3a111111-1111-4111-8111-111111111111',
  'draft purchase order deletion returns the locked order id'
);

select is(
  current_setting('test.atomic_purchase_order_delete_result')::jsonb
    ->>'storage_cleanup_queued',
  '1',
  'draft purchase order deletion durably queues its Storage object'
);

select is(
  (
    select count(*)
    from public.purchase_orders as purchase_order
    where purchase_order.id = '3a111111-1111-4111-8111-111111111111'
  ),
  0::bigint,
  'draft purchase order metadata is deleted in the atomic RPC'
);

-- The cleanup queue is intentionally admin-readable only. Verify durable
-- persistence as the test owner after proving the engineer-facing RPC result.
reset role;

select ok(
  exists (
    select 1
    from public.procurement_storage_cleanup_outbox as cleanup
    where cleanup.storage_path =
      'purchase-orders/3a111111-1111-4111-8111-111111111111/atomic-delete.pdf'
      and cleanup.completed_at is null
      and cleanup.abandoned_at is null
  ),
  'Storage cleanup remains reachable after purchase order cascade deletion'
);

-- Keep the ordinary-delete fixture from affecting the later reset/drain count.
update public.procurement_storage_cleanup_outbox
set completed_at = now()
where storage_path =
  'purchase-orders/3a111111-1111-4111-8111-111111111111/atomic-delete.pdf';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);

select lives_ok(
  $$
    select public.replace_purchase_order_draft(
      '37777777-7777-4777-8777-777777777777',
      '{"expected_delivery_date":"TBD","notes":"persisted"}'::jsonb,
      '[{"product_id":"33333333-3333-4333-8333-333333333333","reference":"REF-001","designation":"Coffret A","quantity":2,"unit_price_ht_cents":1250,"tax_rate_bp":2000}]'::jsonb
    )
  $$,
  'purchase order replacement succeeds atomically for its writer'
);

select is(
  (
    select item.source_estimate_item_id
    from public.purchase_order_items as item
    where item.purchase_order_id = '37777777-7777-4777-8777-777777777777'
  ),
  '36666666-6666-4666-8666-666666666666'::uuid,
  'unchanged purchase order lines preserve estimate traceability'
);

select throws_ok(
  $$
    select public.replace_purchase_order_draft(
      '37777777-7777-4777-8777-777777777777',
      '{"notes":"must roll back"}'::jsonb,
      '[{"product_id":"39999999-9999-4999-8999-999999999999","reference":"REF-001","designation":"Coffret A","quantity":2,"unit_price_ht_cents":1250,"tax_rate_bp":2000}]'::jsonb
    )
  $$,
  '23503',
  'PURCHASE_ORDER_PRODUCT_SCOPE_INVALID',
  'a late purchase order item failure aborts the RPC'
);

select is(
  (
    select purchase_order.notes
    from public.purchase_orders as purchase_order
    where purchase_order.id = '37777777-7777-4777-8777-777777777777'
  ),
  'persisted',
  'a failed replacement rolls back its earlier header update'
);

select lives_ok(
  $$
    update public.purchase_orders
    set status = 'sent'::public.purchase_order_status
    where id = '37777777-7777-4777-8777-777777777777'
  $$,
  'the browser status-only updater remains allowed'
);

select throws_ok(
  $$
    update public.purchase_orders
    set notes = 'forbidden'
    where id = '37777777-7777-4777-8777-777777777777'
  $$,
  '55000',
  'PURCHASE_ORDER_HEADER_READ_ONLY',
  'non-draft order headers are immutable'
);

update public.purchase_order_items
set designation = 'forbidden'
where purchase_order_id = '37777777-7777-4777-8777-777777777777';

select is(
  (
    select item.designation
    from public.purchase_order_items as item
    where item.purchase_order_id = '37777777-7777-4777-8777-777777777777'
  ),
  'Coffret A',
  'non-draft order items cannot be updated directly'
);

delete from public.purchase_orders
where id = '37777777-7777-4777-8777-777777777777';

select ok(
  exists (
    select 1
    from public.purchase_orders
    where id = '37777777-7777-4777-8777-777777777777'
  ),
  'non-draft orders cannot be deleted through ordinary Data API privileges'
);

select throws_ok(
  $$
    select public.delete_purchase_order_draft_atomic(
      '37777777-7777-4777-8777-777777777777'
    )
  $$,
  '42501',
  'PURCHASE_ORDER_DRAFT_NOT_DELETABLE',
  'the atomic delete rejects a non-draft purchase order'
);

select lives_ok(
  $$
    update public.purchase_orders
    set status = 'draft'::public.purchase_order_status
    where id = '37777777-7777-4777-8777-777777777777'
  $$,
  'the pre-existing UI contract can reopen an order as draft'
);

reset role;
set local role service_role;

select throws_ok(
  format(
    $sql$
      select public.persist_estimate_creation_atomic(
        %L::uuid,
        '11111111-1111-4111-8111-111111111111',
        null,
        '{"id":"41111111-1111-4111-8111-111111111111","name":"Atomic rollback"}'::jsonb,
        '{"id":"42222222-2222-4222-8222-222222222222","title":null,"date_devis":"2026-08-12","validite_jours":30,"margin_multiplier":1,"margin_mode":"fixed","currency":"EUR","margin_bp":0,"discount_bp":0,"discount_mode":"simple","discount_steps":[],"global_coefficient":1,"tax_rate_bp":2000,"rounding_mode":"none","rounding_step_cents":1,"max_section_depth":3,"total_ht_cents":0,"total_tax_cents":0,"total_ttc_cents":0}'::jsonb,
        '[{"id":"43333333-3333-4333-8333-333333333333","item_type":"line","position":1,"title":"invalid","line_total_ht_cents":0,"line_tax_cents":0,"line_total_ttc_cents":0}]'::jsonb,
        null
      )
    $sql$,
    (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = '11111111-1111-4111-8111-111111111111'
    )
  ),
  '22023',
  'ESTIMATE_ITEMS_HIERARCHY_INVALID',
  'an invalid estimate hierarchy aborts project and version creation before mutation'
);

select lives_ok(
  format(
    $sql$
      select public.persist_estimate_creation_atomic(
        %L::uuid,
        '11111111-1111-4111-8111-111111111111',
        null,
        '{"id":"61111111-1111-4111-8111-111111111111","name":"Creation DPGF atomique","reference":"DPGF-TX"}'::jsonb,
        '{"id":"62222222-2222-4222-8222-222222222222","title":"Version importee","date_devis":"2026-08-12","validite_jours":30,"margin_multiplier":1,"margin_mode":"fixed","currency":"EUR","margin_bp":0,"discount_bp":0,"discount_mode":"simple","discount_steps":[],"global_coefficient":1,"tax_rate_bp":2000,"rounding_mode":"none","rounding_step_cents":1,"max_section_depth":3,"total_ht_cents":3600,"total_tax_cents":720,"total_ttc_cents":4320}'::jsonb,
        '[{"id":"63333333-3333-4333-8333-333333333333","parent_id":null,"item_type":"section","position":1,"title":"Import DPGF","source_provider":"dpgf","source_file_name":"source-dpgf.xlsx"},{"id":"64444444-4444-4444-8444-444444444444","parent_id":"63333333-3333-4333-8333-333333333333","item_type":"line","position":1,"title":"Ligne DPGF","quantity":2,"unit_price_ht_cents":1800,"tax_rate_bp":2000,"k_fo":1,"h_mo":0,"h_mo_majoration":1,"k_mo":1,"pu_ht_cents":1800,"source_provider":"dpgf","source_file_name":"source-dpgf.xlsx","source_page":4,"line_total_ht_cents":3600,"line_tax_cents":720,"line_total_ttc_cents":4320}]'::jsonb,
        null
      )
    $sql$,
    (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = '11111111-1111-4111-8111-111111111111'
    )
  ),
  'new project, version and linked DPGF payload persist in one transaction'
);

select is(
  (
    select version.total_ht_cents
    from public.estimate_versions as version
    where version.id = '62222222-2222-4222-8222-222222222222'
  ),
  3600,
  'atomic estimate creation preserves the precomputed version total'
);

select is(
  (
    select concat_ws(
      '|',
      item.source_provider,
      item.source_file_name,
      item.source_page,
      item.line_total_ttc_cents
    )
    from public.estimate_items as item
    where item.id = '64444444-4444-4444-8444-444444444444'
  ),
  'dpgf|source-dpgf.xlsx|4|4320',
  'linked DPGF provenance and calculated line totals survive persistence'
);

select lives_ok(
  format(
    $sql$
      select public.persist_estimate_creation_atomic(
        %L::uuid,
        '11111111-1111-4111-8111-111111111111',
        '34444444-4444-4444-8444-444444444444',
        null,
        '{"id":"65555555-5555-4555-8555-555555555555","title":"Version suivante","date_devis":"2026-08-12","validite_jours":30,"margin_multiplier":1,"margin_mode":"fixed","currency":"EUR","margin_bp":0,"discount_bp":0,"discount_mode":"simple","discount_steps":[],"global_coefficient":1,"tax_rate_bp":2000,"rounding_mode":"none","rounding_step_cents":1,"max_section_depth":3,"total_ht_cents":0,"total_tax_cents":0,"total_ttc_cents":0}'::jsonb,
        '[]'::jsonb,
        null
      )
    $sql$,
    (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = '11111111-1111-4111-8111-111111111111'
    )
  ),
  'an existing project accepts its next version atomically'
);

select is(
  (
    select version.version_number
    from public.estimate_versions as version
    where version.id = '65555555-5555-4555-8555-555555555555'
  ),
  2,
  'the existing project receives version N plus one'
);

-- pgTAP runs this file in one database session, so it cannot exercise two
-- concurrent callers. Keep the serialization primitive under regression and
-- cover the resulting numbering behavior above.
select ok(
  position(
    'for update' in lower(pg_get_functiondef(
      'public.persist_estimate_creation_atomic(uuid,uuid,uuid,jsonb,jsonb,jsonb,uuid)'::regprocedure
    ))
  ) > 0,
  'estimate version allocation locks the project row before max plus one'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.estimate_projects
    where id = '41111111-1111-4111-8111-111111111111'
  ),
  0,
  'failed estimate persistence leaves no project behind'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '22222222-2222-4222-8222-222222222222',
  true
);

select throws_ok(
  $$
    select public.replace_purchase_order_draft(
      '53333333-3333-4333-8333-333333333333',
      '{"notes":"viewer forbidden"}'::jsonb,
      null
    )
  $$,
  '42501',
  'PURCHASE_ORDER_DRAFT_NOT_EDITABLE',
  'a viewer cannot rewrite their own draft purchase order'
);

select throws_ok(
  $$
    select public.delete_purchase_order_draft_atomic(
      '53333333-3333-4333-8333-333333333333'
    )
  $$,
  '42501',
  'PURCHASE_ORDER_DRAFT_NOT_DELETABLE',
  'a viewer cannot delete their own draft purchase order'
);

reset role;
set local role service_role;

select throws_ok(
  format(
    $sql$
      select public.persist_estimate_creation_atomic(
        %L::uuid,
        '22222222-2222-4222-8222-222222222222',
        null,
        '{"id":"44444444-4444-4444-8444-444444444444","name":"Viewer project"}'::jsonb,
        '{"id":"45555555-5555-4555-8555-555555555555","title":null,"date_devis":"2026-08-12","validite_jours":30,"margin_multiplier":1,"margin_mode":"fixed","currency":"EUR","margin_bp":0,"discount_bp":0,"discount_mode":"simple","discount_steps":[],"global_coefficient":1,"tax_rate_bp":2000,"rounding_mode":"none","rounding_step_cents":1,"max_section_depth":3,"total_ht_cents":0,"total_tax_cents":0,"total_ttc_cents":0}'::jsonb,
        '[]'::jsonb,
        null
      )
    $sql$,
    (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.user_id = '22222222-2222-4222-8222-222222222222'
    )
  ),
  '42501',
  'ESTIMATE_CREATION_ROLE_REQUIRED',
  'a viewer cannot create an estimate even in their own tenant'
);

reset role;

update public.tenant_memberships
set role = 'admin'::public.tenant_role
where user_id = '11111111-1111-4111-8111-111111111111';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);

select is(
  public.reset_tenant_procurement_data(public.current_tenant_id()),
  '{"orders_deleted":1,"supplier_prices_deleted":1,"supplier_catalog_items_deleted":1,"suppliers_deleted":1,"storage_cleanup_queued":1}'::jsonb,
  'admin procurement reset captures cleanup and deletes the full graph atomically'
);

select is(
  (
    select count(*)
    from public.purchase_order_devis as document
    where document.id = '38999999-9999-4999-8999-999999999999'
  ),
  0::bigint,
  'purchase order document metadata is removed only after durable capture'
);

select is(
  (
    select cleanup.storage_path
    from public.procurement_storage_cleanup_outbox as cleanup
    where cleanup.tenant_id = public.current_tenant_id()
      and cleanup.storage_path =
        'purchase-orders/37777777-7777-4777-8777-777777777777/devis-fournisseur.pdf'
  ),
  'purchase-orders/37777777-7777-4777-8777-777777777777/devis-fournisseur.pdf',
  'tenant admin can read the durable devis Storage cleanup record'
);

reset role;
set local role service_role;

select is(
  (
    select count(*)
    from public.claim_procurement_storage_cleanup(null, 25, 120)
  ),
  1::bigint,
  'service role claims one due Storage cleanup with a lease'
);

select ok(
  exists (
    select 1
    from public.procurement_storage_cleanup_outbox as cleanup
    where cleanup.attempts = 1
      and cleanup.lease_token is not null
      and cleanup.lease_expires_at > now()
  ),
  'cleanup claim records attempts and lease fencing'
);

select set_config(
  'test.procurement_cleanup_old_lease',
  (
    select cleanup.lease_token::text
    from public.procurement_storage_cleanup_outbox as cleanup
    where cleanup.storage_path =
      'purchase-orders/37777777-7777-4777-8777-777777777777/devis-fournisseur.pdf'
  ),
  true
);

update public.procurement_storage_cleanup_outbox
set lease_expires_at = now() - interval '1 second'
where storage_path =
  'purchase-orders/37777777-7777-4777-8777-777777777777/devis-fournisseur.pdf';

select is(
  (
    select count(*)
    from public.claim_procurement_storage_cleanup(null, 25, 120)
  ),
  1::bigint,
  'an expired cleanup lease is reclaimed by the next worker'
);

select ok(
  exists (
    select 1
    from public.procurement_storage_cleanup_outbox as cleanup
    where cleanup.attempts = 2
      and cleanup.lease_token is distinct from
        current_setting('test.procurement_cleanup_old_lease')::uuid
  ),
  'reclaim increments attempts and fences the previous token'
);

select is(
  public.complete_procurement_storage_cleanup(
    (
      select cleanup.id
      from public.procurement_storage_cleanup_outbox as cleanup
      where cleanup.storage_path =
        'purchase-orders/37777777-7777-4777-8777-777777777777/devis-fournisseur.pdf'
    ),
    current_setting('test.procurement_cleanup_old_lease')::uuid
  ),
  false,
  'an old lease token cannot complete reclaimed cleanup work'
);

select is(
  public.fail_procurement_storage_cleanup(
    (
      select cleanup.id
      from public.procurement_storage_cleanup_outbox as cleanup
      where cleanup.storage_path =
        'purchase-orders/37777777-7777-4777-8777-777777777777/devis-fournisseur.pdf'
    ),
    current_setting('test.procurement_cleanup_old_lease')::uuid,
    'stale worker failure',
    1
  ),
  false,
  'an old lease token cannot requeue reclaimed cleanup work'
);

select ok(
  public.fail_procurement_storage_cleanup(
    (
      select cleanup.id
      from public.procurement_storage_cleanup_outbox as cleanup
      where cleanup.storage_path =
        'purchase-orders/37777777-7777-4777-8777-777777777777/devis-fournisseur.pdf'
    ),
    (
      select cleanup.lease_token
      from public.procurement_storage_cleanup_outbox as cleanup
      where cleanup.storage_path =
        'purchase-orders/37777777-7777-4777-8777-777777777777/devis-fournisseur.pdf'
    ),
    'storage unavailable',
    1
  ),
  'a current worker failure persists error and requeues the cleanup'
);

select ok(
  exists (
    select 1
    from public.procurement_storage_cleanup_outbox as cleanup
    where cleanup.last_error = 'storage unavailable'
      and cleanup.next_attempt_at > now()
      and cleanup.lease_token is null
      and cleanup.abandoned_at is null
  ),
  'cleanup failure releases its lease with bounded backoff'
);

update public.procurement_storage_cleanup_outbox
set next_attempt_at = now() - interval '1 second'
where storage_path =
  'purchase-orders/37777777-7777-4777-8777-777777777777/devis-fournisseur.pdf';

select is(
  (
    select count(*)
    from public.claim_procurement_storage_cleanup(null, 25, 120)
  ),
  1::bigint,
  'requeued cleanup becomes claimable after its backoff'
);

select ok(
  public.complete_procurement_storage_cleanup(
    (
      select cleanup.id
      from public.procurement_storage_cleanup_outbox as cleanup
      where cleanup.storage_path =
        'purchase-orders/37777777-7777-4777-8777-777777777777/devis-fournisseur.pdf'
    ),
    (
      select cleanup.lease_token
      from public.procurement_storage_cleanup_outbox as cleanup
      where cleanup.storage_path =
        'purchase-orders/37777777-7777-4777-8777-777777777777/devis-fournisseur.pdf'
    )
  ),
  'a current lease completes cleanup after idempotent Storage removal'
);

insert into public.procurement_storage_cleanup_outbox (
  tenant_id,
  purchase_order_id,
  storage_path,
  attempts,
  max_attempts
)
select
  cleanup.tenant_id,
  cleanup.purchase_order_id,
  'purchase-orders/' || cleanup.purchase_order_id::text || '/max-attempts.pdf',
  9,
  10
from public.procurement_storage_cleanup_outbox as cleanup
limit 1;

select is(
  (
    select count(*)
    from public.claim_procurement_storage_cleanup(null, 25, 120)
  ),
  1::bigint,
  'cleanup at its last allowed attempt can be claimed once'
);

update public.procurement_storage_cleanup_outbox
set lease_expires_at = now() - interval '1 second'
where storage_path like 'purchase-orders/%/max-attempts.pdf';

select is(
  (
    select count(*)
    from public.claim_procurement_storage_cleanup(null, 25, 120)
  ),
  0::bigint,
  'an expired final-attempt lease is terminalized instead of reclaimed'
);

select ok(
  exists (
    select 1
    from public.procurement_storage_cleanup_outbox as cleanup
    where cleanup.storage_path like 'purchase-orders/%/max-attempts.pdf'
      and cleanup.attempts = cleanup.max_attempts
      and cleanup.abandoned_at is not null
      and cleanup.lease_token is null
      and cleanup.lease_expires_at is null
      and cleanup.last_error =
        'PROCUREMENT_STORAGE_CLEANUP_MAX_ATTEMPTS_EXHAUSTED'
  ),
  'a crashed final claim becomes an explicit retained terminal failure'
);

select throws_ok(
  $$
    delete from public.procurement_storage_cleanup_outbox
  $$,
  '42501',
  'PROCUREMENT_STORAGE_CLEANUP_APPEND_ONLY',
  'cleanup metadata remains append-only even for service role'
);

select * from finish();
rollback;
