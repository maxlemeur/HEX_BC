-- TI-691, owner's walkthrough of 14/11/2026: an estimate e-mail redirected to the test mailbox (EMAIL_DELIVERY_MODE
-- unset or « redirect ») was recorded as sent to the client, with nothing to tell it from a real send. Written before the
-- migration …_estimate_email_redirected.sql. Failure modes this file guards, with fictional members and addresses:
--  1. the send history has no place to say a message was redirected, or reads every historical row (sent before the
--     routing was recorded, possibly redirected since #341) as a real send to the client;
--  2. a member writes the mark himself (only the application server knows the routing it used);
--  3. the server marks a dispatch it does not hold: another lease, or a dispatch no longer leaving (queued, sent);
--  4. a send already recorded changes its mark afterwards (« redirected » turned into a real send, or the reverse), or a
--     send recorded without its routing is given one later;
--  5. the portal's acceptance confirmation, logged once as it leaves, cannot carry the mark, or changes it later;
--  6. a later attempt rewrites the routing of an earlier one that may have reached the provider (a deferred dispatch
--     re-claimed after the routing changed): once written, the mark stays; only a request rearmed after a refusal, which
--     left nothing, records its routing anew.
-- Every statement under test runs through pg_temp.as_role, which answers « ok <rows> » or « <sqlstate> <message> », so a
-- red assertion fails on its own reason and the file runs to the end. Fixtures are rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- Member 1 owns tenant T (created with its account) and affaire P, versions V1 to V3 (one active send each).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', 'e3d10000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'redirection-membre@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
update public.tenant_memberships set role = 'admin'::public.tenant_role
where user_id = 'e3d10000-0000-4000-8000-000000000001';
select set_config('test.tenant_id', (select tenant_id::text from public.tenant_memberships
  where user_id = 'e3d10000-0000-4000-8000-000000000001' and is_default), true);
insert into public.estimate_projects (id, tenant_id, user_id, name)
values ('e3d10000-0000-4000-8000-000000000010', current_setting('test.tenant_id')::uuid,
  'e3d10000-0000-4000-8000-000000000001', 'Redirection (fictive)');
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status)
select ('e3d10000-0000-4000-8000-00000000010' || n)::uuid, current_setting('test.tenant_id')::uuid,
  'e3d10000-0000-4000-8000-000000000010', n, 'draft'
from generate_series(1, 3) n;

-- Dispatch Dn of version Vn, as the outbox leaves them: D1 leaving under lease L1, D2 queued, D3 leaving under lease L3.
-- Only this disposable transaction bypasses the insert guard of request contract 2; every update guard stays installed.
alter table public.estimate_emails disable trigger guard_estimate_offer_request_insert;
insert into public.estimate_emails (id, tenant_id, version_id, recipient, subject, type, status, request_id, payload_hash,
  idempotency_key, created_by, version_content_revision, from_address, request_contract_version, attempt_count,
  first_attempt_at, last_attempt_at, lease_token, lease_expires_at)
select ('e3d10000-0000-4000-8000-00000000020' || n)::uuid, current_setting('test.tenant_id')::uuid,
  ('e3d10000-0000-4000-8000-00000000010' || n)::uuid, 'client@exemple.test', 'Devis fictif', 'initial',
  case n when 2 then 'queued' else 'processing' end,
  ('e3d10000-0000-4000-8000-00000000030' || n)::uuid, repeat('a', 64), 'redirection-fixture/' || n,
  'e3d10000-0000-4000-8000-000000000001', 1, 'devis@exemple.test', 1,
  case n when 2 then 0 else 1 end,
  case n when 2 then null else now() end, case n when 2 then null else now() end,
  case n when 2 then null else ('e3d10000-0000-4000-8000-00000000040' || n)::uuid end,
  case n when 2 then null else now() + interval '2 minutes' end
from generate_series(1, 3) n;
alter table public.estimate_emails enable trigger guard_estimate_offer_request_insert;

-- Runs one statement as `p_role` (a signed-in member 1 for « authenticated »): « ok <rows> » or « <sqlstate> <message> ».
create function pg_temp.as_role(p_role text, p_sql text)
returns text
language plpgsql
as $run$
declare
  run_result text;
  affected bigint;
begin
  begin
    execute format('set local role %I', p_role);
    if p_role = 'authenticated' then
      perform set_config('request.jwt.claim.sub', 'e3d10000-0000-4000-8000-000000000001', true);
      perform set_config('request.jwt.claims', jsonb_build_object('sub', 'e3d10000-0000-4000-8000-000000000001',
        'role', 'authenticated')::text, true);
    end if;
    execute p_sql;
    get diagnostics affected = row_count;
    run_result := 'ok ' || affected;
    execute 'reset role';
  exception when others then
    execute 'reset role';
    run_result := sqlstate || ' ' || sqlerrm;
  end;
  return run_result;
end;
$run$;

-- The mark of one row, read late (plpgsql): before the migration each assertion fails on its own.
create function pg_temp.redirected(p_id uuid)
returns boolean
language plpgsql
as $$ begin return (select e.redirected from public.estimate_emails e where e.id = p_id); end $$;

create function pg_temp.marked_fixtures()
returns bigint
language plpgsql
as $$ begin
  return (select count(*) from public.estimate_emails e where e.version_id::text like 'e3d10000-%'
    and e.redirected is not null);
end $$;

-- 1. A boolean every row may carry: unknown (null) for every send recorded before the routing was.
select has_column('public', 'estimate_emails', 'redirected', 'the send history says whether a message was redirected');
select col_type_is('public', 'estimate_emails', 'redirected', 'boolean', 'the mark is a boolean');
select col_is_null('public', 'estimate_emails', 'redirected', 'a send whose routing was not recorded says so');
select col_hasnt_default('public', 'estimate_emails', 'redirected', 'a historical row never reads as a real send');
select is(pg_temp.marked_fixtures(), 0::bigint, 'the fixtures start without a recorded routing');

-- 2. A member writes nothing on the history (the routing is the server's).
select is(
  pg_temp.as_role('authenticated', $$update public.estimate_emails set redirected = true
    where id = 'e3d10000-0000-4000-8000-000000000201'$$),
  '42501 permission denied for table estimate_emails',
  'a member cannot mark a send redirected');
select is(pg_temp.redirected('e3d10000-0000-4000-8000-000000000201'), null::boolean, 'the member''s attempt wrote nothing');

-- 3. The server marks the dispatch it holds, with the lease it holds, while the message leaves.
select is(
  pg_temp.as_role('service_role', $$update public.estimate_emails set redirected = true
    where id = 'e3d10000-0000-4000-8000-000000000201' and lease_token = 'e3d10000-0000-4000-8000-000000000401'
      and status = 'processing'$$),
  'ok 1', 'the server marks the leaving dispatch it holds');
select is(pg_temp.redirected('e3d10000-0000-4000-8000-000000000201'), true, 'D1 is marked redirected');
select is(
  pg_temp.as_role('service_role', $$update public.estimate_emails set redirected = true
    where id = 'e3d10000-0000-4000-8000-000000000202'$$),
  '23514 ESTIMATE_EMAIL_REDIRECTED_IMMUTABLE',
  'a queued dispatch, not leaving, is not marked');
select is(pg_temp.redirected('e3d10000-0000-4000-8000-000000000202'), null::boolean, 'D2 stays unrecorded');
select is(
  pg_temp.as_role('service_role', $$update public.estimate_emails set redirected = false
    where id = 'e3d10000-0000-4000-8000-000000000201' and lease_token = 'e3d10000-0000-4000-8000-000000000401'$$),
  '23514 ESTIMATE_EMAIL_REDIRECTED_IMMUTABLE',
  'even the attempt holding the dispatch does not rewrite the routing it recorded');

-- 4. Once recorded as sent, the mark is the send's: neither way it changes, and a missing one is never added.
select is(
  pg_temp.as_role('service_role', $$update public.estimate_emails set status = 'sent', provider_id = 'fictif-201',
    sent_at = now(), lease_token = null, lease_expires_at = null
    where id = 'e3d10000-0000-4000-8000-000000000201'$$),
  'ok 1', 'the provider''s acceptance is recorded');
select is(pg_temp.redirected('e3d10000-0000-4000-8000-000000000201'), true, 'the sent dispatch keeps its mark');
select is(
  pg_temp.as_role('service_role', $$update public.estimate_emails set redirected = false
    where id = 'e3d10000-0000-4000-8000-000000000201'$$),
  '23514 ESTIMATE_EMAIL_REDIRECTED_IMMUTABLE',
  'a redirected send is never turned into a real one');
select is(
  pg_temp.as_role('service_role', $$update public.estimate_emails set status = 'sent', provider_id = 'fictif-203',
    sent_at = now(), lease_token = null, lease_expires_at = null
    where id = 'e3d10000-0000-4000-8000-000000000203'$$),
  'ok 1', 'D3 is accepted without a recorded routing (as before the column)');
select is(
  pg_temp.as_role('service_role', $$update public.estimate_emails set redirected = false
    where id = 'e3d10000-0000-4000-8000-000000000203'$$),
  '23514 ESTIMATE_EMAIL_REDIRECTED_IMMUTABLE',
  'a send recorded without its routing is never given one afterwards');
select is(pg_temp.redirected('e3d10000-0000-4000-8000-000000000203'), null::boolean, 'D3 stays unrecorded');

-- 6. The queued dispatch D2 is claimed: the claim itself does not mark, its attempt does, once.
select is(
  pg_temp.as_role('service_role', $$update public.estimate_emails set status = 'processing', attempt_count = 1,
    first_attempt_at = now(), last_attempt_at = now(), lease_token = 'e3d10000-0000-4000-8000-000000000402',
    lease_expires_at = now() + interval '2 minutes', redirected = true
    where id = 'e3d10000-0000-4000-8000-000000000202'$$),
  '23514 ESTIMATE_EMAIL_REDIRECTED_IMMUTABLE',
  'the claim itself does not mark: the routing is written once the dispatch is held');
select is(
  pg_temp.as_role('service_role', $$update public.estimate_emails set status = 'processing', attempt_count = 1,
    first_attempt_at = now(), last_attempt_at = now(), lease_token = 'e3d10000-0000-4000-8000-000000000402',
    lease_expires_at = now() + interval '2 minutes'
    where id = 'e3d10000-0000-4000-8000-000000000202'$$),
  'ok 1', 'D2 is leased for its first attempt');
select is(
  pg_temp.as_role('service_role', $$update public.estimate_emails set redirected = true
    where id = 'e3d10000-0000-4000-8000-000000000202' and lease_token = 'e3d10000-0000-4000-8000-000000000402'
      and status = 'processing'$$),
  'ok 1', 'the first attempt marks its routing');
-- Its provider call times out: the dispatch is deferred, then re-claimed under another lease after a routing change.
select is(
  pg_temp.as_role('service_role', $$update public.estimate_emails set status = 'queued', lease_token = null,
    lease_expires_at = null, next_attempt_at = now() where id = 'e3d10000-0000-4000-8000-000000000202'$$),
  'ok 1', 'D2 is deferred after an unanswered provider call');
select is(
  pg_temp.as_role('service_role', $$update public.estimate_emails set status = 'processing', attempt_count = 2,
    last_attempt_at = now(), lease_token = 'e3d10000-0000-4000-8000-000000000412',
    lease_expires_at = now() + interval '2 minutes', next_attempt_at = null
    where id = 'e3d10000-0000-4000-8000-000000000202'$$),
  'ok 1', 'D2 is re-claimed for a second attempt');
select is(
  pg_temp.as_role('service_role', $$update public.estimate_emails set redirected = false
    where id = 'e3d10000-0000-4000-8000-000000000202' and lease_token = 'e3d10000-0000-4000-8000-000000000412'
      and status = 'processing'$$),
  '23514 ESTIMATE_EMAIL_REDIRECTED_IMMUTABLE',
  'the second attempt cannot rewrite the routing the first may have delivered with');
select is(pg_temp.redirected('e3d10000-0000-4000-8000-000000000202'), true, 'D2 keeps its first attempt''s routing');
-- Refused by the provider, the request is rearmed: nothing left, its next attempt records its own routing.
select is(
  pg_temp.as_role('service_role', $$update public.estimate_emails set status = 'failed', lease_token = null,
    lease_expires_at = null where id = 'e3d10000-0000-4000-8000-000000000202'$$),
  'ok 1', 'D2 is refused by the provider');
select is(
  pg_temp.as_role('service_role', $$update public.estimate_emails set status = 'preparing'
    where id = 'e3d10000-0000-4000-8000-000000000202'$$),
  'ok 1', 'D2 is rearmed after its refusal');
select is(pg_temp.redirected('e3d10000-0000-4000-8000-000000000202'), null::boolean,
  'a rearmed request forgets the routing of an attempt that left nothing');

-- 5. The portal's acceptance confirmation is logged once, as it leaves, with its mark.
select is(
  pg_temp.as_role('service_role', format($$insert into public.estimate_emails (tenant_id, version_id, recipient, subject,
    type, status, provider_id, sent_at, redirected) values (%L, 'e3d10000-0000-4000-8000-000000000101',
    'client@exemple.test', 'Confirmation fictive', 'acceptance_confirmation', 'sent', 'fictif-confirmation', now(), true)$$,
    current_setting('test.tenant_id'))),
  'ok 1', 'the acceptance confirmation is logged as redirected');
select is(
  pg_temp.redirected((select e.id from public.estimate_emails e where e.provider_id = 'fictif-confirmation')), true,
  'the confirmation reads as redirected');
select is(
  pg_temp.as_role('service_role', $$update public.estimate_emails set redirected = false
    where provider_id = 'fictif-confirmation'$$),
  '23514 ESTIMATE_EMAIL_REDIRECTED_IMMUTABLE',
  'the confirmation''s mark never changes afterwards');

select * from finish();
rollback;
