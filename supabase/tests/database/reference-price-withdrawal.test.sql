begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('70900000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'ref-owner@example.test', '{}', '{}'),
  ('70900000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'ref-engineer@example.test', '{}', '{}'),
  ('70900000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'ref-other@example.test', '{}', '{}');

create function pg_temp.activate(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

delete from public.tenant_memberships where user_id = '70900000-0000-4000-8000-000000000002';
insert into public.tenant_memberships (tenant_id, user_id, role, is_default)
select tenant_id, '70900000-0000-4000-8000-000000000002', 'engineer', true
from public.tenant_memberships where user_id = '70900000-0000-4000-8000-000000000001';

insert into public.products (id, tenant_id, designation, unit, unit_price_cents)
select fixture.id, membership.tenant_id, fixture.name, 'm', fixture.price
from public.tenant_memberships membership
cross join (values
  ('70900000-0000-4000-8000-000000000010'::uuid, 'TI709 legacy reference', 777),
  ('70900000-0000-4000-8000-000000000011'::uuid, 'TI709 zero reference', 0)
) fixture(id, name, price)
where membership.user_id = '70900000-0000-4000-8000-000000000001';

-- Use the ordinary validation RPC to create a real validated zero.
create function pg_temp.validate_zero()
returns jsonb language sql as $$
  select public.validate_product_reference_price(
    '70900000-0000-4000-8000-000000000011', 100, 'excluded',
    public.product_reference_price_proposal(
      '70900000-0000-4000-8000-000000000011', 100, 'excluded'
    )->>'fingerprint',
    0, 'Justification fictive'
  );
$$;

create function pg_temp.withdraw(p_product_id uuid)
returns jsonb language sql as $$
  select public.withdraw_product_reference_price(
    p_product_id, (select updated_at from public.products where id = p_product_id),
    (select reference_price_validation_id from public.products where id = p_product_id)
  );
$$;

select ok(not has_function_privilege('anon', 'public.withdraw_product_reference_price(uuid,timestamptz,uuid)', 'EXECUTE'),
  'anonymous callers cannot withdraw a reference');
select ok(not has_table_privilege('authenticated', 'public.product_reference_price_withdrawals', 'INSERT'),
  'members cannot write their own audit entries');
select ok(not has_table_privilege('authenticated', 'public.product_reference_price_withdrawals', 'UPDATE'),
  'members cannot rewrite the withdrawal history');
select ok(not has_table_privilege('authenticated', 'public.product_reference_price_withdrawals', 'DELETE'),
  'members cannot delete the withdrawal history');

set local role authenticated;
do $$ begin perform pg_temp.activate('70900000-0000-4000-8000-000000000001'); end $$;
select lives_ok($$select pg_temp.validate_zero()$$, 'admin validates a zero price');
select is(
  public.product_reference_price_proposal('70900000-0000-4000-8000-000000000011')->>'fingerprint',
  public.product_reference_price_proposal('70900000-0000-4000-8000-000000000011', 100, 'excluded')->>'fingerprint',
  'a stored quantity and the same whole quantity sent by the UI yield one proposal fingerprint'
);
select throws_ok($$update public.products set unit_price_cents = 0, reference_price_validation_id = null
  where id = '70900000-0000-4000-8000-000000000011'$$,
  'P0001', 'REFERENCE_PRICE_VALIDATION_REQUIRED', 'direct clearing cannot bypass an audited withdrawal');
select throws_ok($$select public.withdraw_product_reference_price(
  '70900000-0000-4000-8000-000000000010', '-infinity', null)$$,
  'P0001', 'REFERENCE_PRICE_CHANGED', 'a stale product version cannot withdraw the current reference');

do $$ begin perform pg_temp.activate('70900000-0000-4000-8000-000000000002'); end $$;
select throws_ok($$select pg_temp.withdraw('70900000-0000-4000-8000-000000000011')$$,
  '42501', 'Admin role required.', 'engineer cannot withdraw a validated reference');

do $$ begin perform pg_temp.activate('70900000-0000-4000-8000-000000000003'); end $$;
select throws_ok($$select pg_temp.withdraw('70900000-0000-4000-8000-000000000011')$$,
  'P0002', 'PRODUCT_NOT_FOUND', 'an admin cannot withdraw another tenant’s reference');

do $$ begin perform pg_temp.activate('70900000-0000-4000-8000-000000000001'); end $$;
select lives_ok($$select pg_temp.withdraw('70900000-0000-4000-8000-000000000011')$$, 'admin can withdraw a validated zero');
select lives_ok($$select pg_temp.withdraw('70900000-0000-4000-8000-000000000010')$$, 'admin can withdraw a legacy positive reference');
select throws_ok($$select pg_temp.withdraw('70900000-0000-4000-8000-000000000011')$$,
  'P0001', 'REFERENCE_PRICE_CHANGED', 'a duplicate withdrawal cannot add another event');
select is(public.product_reference_price_proposal('70900000-0000-4000-8000-000000000011')->'current_price_cents',
  'null'::jsonb, 'the withdrawn zero becomes a missing reference');
select results_eq(
  $$select operation, unit_price_cents, actor_id, occurred_at is not null
    from public.get_product_reference_price_history('70900000-0000-4000-8000-000000000011')
    order by operation$$,
  $$values
    ('manual'::text, 0, '70900000-0000-4000-8000-000000000001'::uuid, true),
    ('withdrawal', 0, '70900000-0000-4000-8000-000000000001'::uuid, true)$$,
  'history retains the validation and records the withdrawal separately'
);
select is(
  (select previous_validation_id from public.product_reference_price_withdrawals where product_id = '70900000-0000-4000-8000-000000000011'),
  (select id from public.product_reference_price_validations where product_id = '70900000-0000-4000-8000-000000000011'),
  'withdrawal points to the superseded validation'
);
select is(
  (select unit_price_cents from public.get_product_reference_price_history('70900000-0000-4000-8000-000000000010')),
  777, 'the legacy amount remains readable without inventing a validation'
);
select lives_ok($$select pg_temp.validate_zero()$$, 'admin can validate a new reference after withdrawal');

do $$ begin perform pg_temp.activate('70900000-0000-4000-8000-000000000002'); end $$;
select is((select count(*) from public.get_product_reference_price_history('70900000-0000-4000-8000-000000000011')), 3::bigint,
  'a non-admin member can read their tenant’s full reference history');
do $$ begin perform pg_temp.activate('70900000-0000-4000-8000-000000000003'); end $$;
select throws_ok($$select * from public.get_product_reference_price_history('70900000-0000-4000-8000-000000000011')$$,
  'P0002', 'PRODUCT_NOT_FOUND', 'the history RPC does not expose another tenant’s references');
select is((select count(*) from public.product_reference_price_withdrawals), 0::bigint,
  'withdrawal records remain private at the table boundary');

reset role;
select * from finish();
rollback;
