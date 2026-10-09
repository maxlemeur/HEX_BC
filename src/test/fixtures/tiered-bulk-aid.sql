-- Harness-only synthetic seeds for docs/testing/tiered-bulk-aid.md.
-- Never apply this file to a remote/shared database. Load the frozen MO schema,
-- real RPC chain, constraints, tenant policies and triggers before this file.
-- The runner supplies the isolated table-owner context and simulated identity.
-- No schema, RPC, helper, policy, flag or application environment is replaced.
-- All fixture UUIDs are fixed inside the disposable database: id(n) is
-- 00000000-0000-4000-8000-{decimal n padded to 12 characters}.

-- Exact CHECK from 20260223113000_est033_aid_column.sql (lines 6-10).
alter table public.estimate_items
  drop constraint if exists estimate_items_aid_length_check;
alter table public.estimate_items
  add constraint estimate_items_aid_length_check
  check (aid is null or char_length(aid) <= 64);

with seed(n, name, slug, is_active, owner_id) as (
  values
    (1, 'ARMY AID one', 'army-aid-one', true, 10),
    (2, 'ARMY AID two', 'army-aid-two', true, 11),
    (3, 'ARMY AID inactive', 'army-aid-inactive', false, 15)
)
insert into public.tenants (id, name, slug, is_active, created_by)
select
  ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  name, slug, is_active,
  ('00000000-0000-4000-8000-' || lpad(owner_id::text, 12, '0'))::uuid
from seed;

with seed(n, tenant_id, user_id, role) as (
  values
    (100, 1, 10, 'admin'),
    (101, 2, 11, 'admin'),
    (102, 1, 12, 'viewer'),
    (103, 1, 13, 'engineer'),
    (105, 3, 15, 'admin')
)
insert into public.tenant_memberships (id, tenant_id, user_id, role, is_default)
select
  ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('00000000-0000-4000-8000-' || lpad(tenant_id::text, 12, '0'))::uuid,
  ('00000000-0000-4000-8000-' || lpad(user_id::text, 12, '0'))::uuid,
  role::public.tenant_role, true
from seed;

with seed(n, tenant_id, owner_id) as (
  values (20, 1, 10), (21, 2, 11), (22, 3, 15), (25, 1, 12)
)
insert into public.estimate_projects (id, tenant_id, user_id, name)
select
  ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('00000000-0000-4000-8000-' || lpad(tenant_id::text, 12, '0'))::uuid,
  ('00000000-0000-4000-8000-' || lpad(owner_id::text, 12, '0'))::uuid,
  'ARMY AID synthetic ' || n
from seed;

-- Version 34 stays draft until its line exists, so the real V2/revision
-- triggers run during insertion. Only then is it published for refusal tests.
with seed(n, tenant_id, project_id) as (
  values
    (30, 1, 20), (31, 2, 21), (32, 3, 22),
    (34, 1, 20), (36, 1, 20), (37, 1, 25)
)
insert into public.estimate_versions (
  id, tenant_id, project_id, version_number, calc_engine_version,
  status, title, margin_mode, tax_rate_bp, rounding_mode,
  total_ht_cents, total_tax_cents, total_ttc_cents
)
select
  ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('00000000-0000-4000-8000-' || lpad(tenant_id::text, 12, '0'))::uuid,
  ('00000000-0000-4000-8000-' || lpad(project_id::text, 12, '0'))::uuid,
  n, 2, 'draft', 'ARMY AID version ' || n,
  (case when n = 30 then 'tiered' else 'fixed' end)::public.estimate_margin_mode,
  2000, 'none',
  case when n = 30 then 25500 else 1000 end,
  case when n = 30 then 5100 else 200 end,
  case when n = 30 then 30600 else 1200 end
from seed;

with seed(n, tenant_id, owner_id, hourly_rate_cents) as (
  values
    (60, 1, 10, 4000), (61, 1, 10, 6000),
    (62, 1, 10, 3000), (63, 1, 10, 5000),
    (64, 2, 11, 6000), (65, 1, 13, 5000)
)
insert into public.labor_roles (id, tenant_id, user_id, name, hourly_rate_cents)
select
  ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('00000000-0000-4000-8000-' || lpad(tenant_id::text, 12, '0'))::uuid,
  ('00000000-0000-4000-8000-' || lpad(owner_id::text, 12, '0'))::uuid,
  'ARMY AID role ' || n, hourly_rate_cents
from seed;

with seed(n, tenant_id) as (
  values (70, 1), (71, 1), (72, 2)
)
insert into public.products (id, tenant_id)
select
  ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('00000000-0000-4000-8000-' || lpad(tenant_id::text, 12, '0'))::uuid
from seed;

insert into public.supplier_pricebook (id, tenant_id, product_id)
values (
  '00000000-0000-4000-8000-000000000080',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000070'
);

insert into public.margin_tiers (id, tenant_id, threshold_cents, multiplier, position)
values
  ('00000000-0000-4000-8000-000000000090', '00000000-0000-4000-8000-000000000001', 0, 1.5, 0),
  ('00000000-0000-4000-8000-000000000091', '00000000-0000-4000-8000-000000000001', 30000, 1.2, 1);

insert into public.estimate_items (
  id, tenant_id, version_id, item_type, position, title, aid
)
values (
  '00000000-0000-4000-8000-000000000050',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000030',
  'section', 1, 'ARMY section', null
);

-- A: DS 2*1000 + 1*1*4000 + 1*1*6000 = 12000; at 1.5, HT 18000.
-- Legacy h_mo=7 intentionally remains independent of the split-hour inputs.
-- B: DS 5000; at 1.5, HT 7500. The fixture does not call a product calculator.
with seed(n, position, quantity, unit_price, legacy_hours, unit_sale, ht, tax, ttc, aid) as (
  values
    (40, 1, 2, 1000, 7, 9000, 18000, 3600, 21600, null::text),
    (41, 2, 1, 5000, 0, 7500, 7500, 1500, 9000, 'ARMY.UNTOUCHED')
)
insert into public.estimate_items (
  id, tenant_id, version_id, parent_id, item_type, position, title, aid,
  quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo,
  h_mo_atelier, k_mo_atelier, labor_role_atelier_id,
  h_mo_chantier, k_mo_chantier, labor_role_chantier_id,
  pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents,
  product_id, selected_supplier_price_id
)
select
  ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '00000000-0000-4000-8000-000000000001'::uuid,
  '00000000-0000-4000-8000-000000000030'::uuid,
  '00000000-0000-4000-8000-000000000050'::uuid,
  'line', position, 'ARMY line', aid,
  quantity, unit_price, 2000, 1, legacy_hours, 1, 1,
  case when n = 40 then 1 else 0 end, 1,
  case when n = 40 then '00000000-0000-4000-8000-000000000060'::uuid end,
  case when n = 40 then 1 else 0 end, 1,
  case when n = 40 then '00000000-0000-4000-8000-000000000061'::uuid end,
  unit_sale, ht, tax, ttc,
  case when n = 40 then '00000000-0000-4000-8000-000000000070'::uuid end,
  case when n = 40 then '00000000-0000-4000-8000-000000000080'::uuid end
from seed;

-- Existing rows in foreign versions, a sent version, a viewer-owned project
-- and an inactive tenant ensure denial tests cannot pass merely on absent IDs.
with seed(n, tenant_id, version_id) as (
  values (42, 2, 31), (44, 1, 36), (45, 1, 34), (47, 1, 37), (49, 3, 32)
)
insert into public.estimate_items (
  id, tenant_id, version_id, item_type, position, title,
  quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo,
  h_mo_atelier, k_mo_atelier, h_mo_chantier, k_mo_chantier,
  pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents
)
select
  ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('00000000-0000-4000-8000-' || lpad(tenant_id::text, 12, '0'))::uuid,
  ('00000000-0000-4000-8000-' || lpad(version_id::text, 12, '0'))::uuid,
  'line', 1, 'ARMY line',
  1, 1000, 2000, 1, 0, 1, 1,
  0, 1, 0, 1, 1000, 1000, 200, 1200
from seed;

update public.estimate_versions
set status = 'sent'
where id = '00000000-0000-4000-8000-000000000034';
