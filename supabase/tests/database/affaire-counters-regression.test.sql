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
values (
  '00000000-0000-0000-0000-000000000000',
  '8a000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'affaire-counter@example.test',
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

insert into public.estimate_projects (
  id,
  tenant_id,
  user_id,
  name,
  is_archived
)
select
  '8a000000-0000-4000-8000-000000000002',
  membership.tenant_id,
  membership.user_id,
  'Affaire sans version',
  false
from public.tenant_memberships membership
where membership.user_id = '8a000000-0000-4000-8000-000000000001';

select ok(
  position(
    'pg_catalog.coalesce' in lower(pg_get_functiondef(
      'public.get_affaires_counters(uuid,uuid,text,public.estimate_status[],boolean)'::regprocedure
    ))
  ) = 0,
  'the counters RPC does not qualify the COALESCE SQL expression as a function'
);

select ok(
  has_table_privilege(
    'authenticated',
    'public.user_favorite_projects',
    'SELECT'
  )
  and has_table_privilege(
    'authenticated',
    'public.user_favorite_projects',
    'INSERT'
  )
  and has_table_privilege(
    'authenticated',
    'public.user_favorite_projects',
    'UPDATE'
  )
  and has_table_privilege(
    'authenticated',
    'public.user_favorite_projects',
    'DELETE'
  ),
  'authenticated favorite actions have the relation privileges governed by RLS'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '8a000000-0000-4000-8000-000000000001',
  true
);

select lives_ok(
  $$
    select *
    from public.get_affaires_counters(
      public.current_tenant_id(),
      '8a000000-0000-4000-8000-000000000001',
      null,
      null,
      false
    )
  $$,
  'the authenticated affaires counters execute without a COALESCE resolution error'
);

select is(
  (
    select counters.total_count
    from public.get_affaires_counters(
      public.current_tenant_id(),
      '8a000000-0000-4000-8000-000000000001',
      null,
      null,
      false
    ) counters
  ),
  1,
  'the counters include an owned project without an estimate version'
);

select is(
  (
    select counters.draft_count
    from public.get_affaires_counters(
      public.current_tenant_id(),
      '8a000000-0000-4000-8000-000000000001',
      null,
      null,
      false
    ) counters
  ),
  1,
  'a project without a version is counted in the draft bucket'
);

select * from finish();
rollback;
