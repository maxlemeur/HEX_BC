-- Lot 2 M2 (migration …_takeoff_send_receipts.sql): sending a reviewed takeoff of an affaire to the estimate, the first
-- draft created by the confirmation. Isolation justified: the attachment permit, the rollback of a created version, the
-- replay of a receipt, the writer's refusal of an ordinary line and the readers after the send are database contracts
-- no journey can force deterministically. Races between two sessions are in takeoff-send-race.test.sql.
-- Written before the migration: red on ab72179d (public.send_takeoff_job does not exist). Fix round 2: every refusal is
-- asserted at the confirmation (send mode), after a preview that passed, the state or the confirmation changed in
-- between; a refusal no preview can pass (its own check precedes the outcome) is asserted on the send mode directly, by
-- its own message. All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.fixture(n integer) returns uuid language sql immutable as $$
  select ('ab230000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

insert into auth.users(id, email, raw_user_meta_data)
select pg_temp.fixture(n), 'takeoff-send-' || n || '@example.test', '{}'::jsonb
from generate_series(1, 5) as n;
update public.tenant_memberships set is_default = false where user_id::text like 'ab230000-%';
insert into public.tenants(id, name, slug) values
  (pg_temp.fixture(10), 'Takeoff send', 'takeoff-send-test'),
  (pg_temp.fixture(11), 'Other send tenant', 'takeoff-send-other-test');
insert into public.tenant_memberships(tenant_id, user_id, role, is_default, created_at) values
  (pg_temp.fixture(10), pg_temp.fixture(1), 'engineer', true, '2020-01-01'),
  (pg_temp.fixture(10), pg_temp.fixture(2), 'engineer', true, '2020-01-01'),
  (pg_temp.fixture(10), pg_temp.fixture(3), 'director', true, '2020-01-01'),
  (pg_temp.fixture(10), pg_temp.fixture(4), 'admin', true, '2020-01-01'),
  (pg_temp.fixture(11), pg_temp.fixture(5), 'admin', true, '2020-01-01');
insert into public.estimate_projects(id, tenant_id, user_id, name) values
  (pg_temp.fixture(20), pg_temp.fixture(10), pg_temp.fixture(1), 'Affaire sans devis'),
  (pg_temp.fixture(21), pg_temp.fixture(10), pg_temp.fixture(1), 'Affaire au devis émis');
insert into public.plan_sets(id, tenant_id, project_id, name) values
  (pg_temp.fixture(40), pg_temp.fixture(10), pg_temp.fixture(20), 'Plans fictifs'),
  (pg_temp.fixture(41), pg_temp.fixture(10), pg_temp.fixture(21), 'Plans émis'),
  (pg_temp.fixture(42), pg_temp.fixture(10), pg_temp.fixture(20), 'Plan B fictif');
insert into public.plan_files(id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
values
  (pg_temp.fixture(50), pg_temp.fixture(10), pg_temp.fixture(40), 'plan-a.pdf',
   concat_ws('/', pg_temp.fixture(10), pg_temp.fixture(40), pg_temp.fixture(50), 'plan-a.pdf'), 'application/pdf', 8, 2),
  (pg_temp.fixture(51), pg_temp.fixture(10), pg_temp.fixture(41), 'plan-c.pdf',
   concat_ws('/', pg_temp.fixture(10), pg_temp.fixture(41), pg_temp.fixture(51), 'plan-c.pdf'), 'application/pdf', 8, 1),
  (pg_temp.fixture(52), pg_temp.fixture(10), pg_temp.fixture(42), 'plan-b.pdf',
   concat_ws('/', pg_temp.fixture(10), pg_temp.fixture(42), pg_temp.fixture(52), 'plan-b.pdf'), 'application/pdf', 8, 1);

insert into public.takeoff_preparations(tenant_id, project_id, revision, draft, confirmed_snapshot, confirmed_at, confirmed_by, updated_by)
select pg_temp.fixture(10), plan.project_id, 1, draft,
  jsonb_build_object('schema_version', 1, 'preparation_revision', 1, 'confirmed_by', pg_temp.fixture(1),
    'confirmed_at', '2026-11-20T00:00:00Z', 'readiness', '{"can_launch":true}'::jsonb, 'preparation', draft),
  '2026-11-20T00:00:00Z', pg_temp.fixture(1), pg_temp.fixture(1)
from (
  select s.project_id, jsonb_build_object('schema_version', 1,
    'destination', '{"kind":"analysis_only","estimate_version_id":null}'::jsonb,
    'processing', '{"level":"C","provider":"chatgpt"}'::jsonb,
    'sources', jsonb_build_array(jsonb_build_object('document_id', f.id, 'kind', 'plan', 'active', true, 'confirmed', true,
      'plan_set_id', f.plan_set_id, 'file_path', f.file_path, 'page_count', f.page_count, 'source_updated_at', f.updated_at))) as draft
  from public.plan_files f join public.plan_sets s on s.id = f.plan_set_id
  where f.plan_set_id in (pg_temp.fixture(40), pg_temp.fixture(41))
) as plan;

create function pg_temp.sign_in(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.fixture(n)::text, true);
  select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.fixture(n))::text, true);
$$;
-- Fixtures are seeded by the native owner without a user, as the other estimate fixtures are.
create function pg_temp.sign_out() returns void language sql as $$
  select set_config('request.jwt.claim.sub', '', true);
  select set_config('request.jwt.claims', '', true);
$$;

-- Jobs A (plan A) and B (plan B, a later preparation revision) on the affaire without estimate, A2 a second job of A's
-- very launch, C on the affaire whose version is issued; admitted as M1 admits them.
create function pg_temp.admit(n integer, project integer, plan_set integer) returns void language sql as $$
  select null::void from public.admit_prepared_takeoff_job(jsonb_build_object(
    'id', pg_temp.fixture(n), 'tenant_id', pg_temp.fixture(10), 'project_id', pg_temp.fixture(project),
    'plan_set_id', pg_temp.fixture(plan_set), 'level', 'C', 'created_by', pg_temp.fixture(1),
    'execution_provider', 'chatgpt_local', 'execution_host_id', 'urn:uuid:ab230000-0000-4000-8000-000000000090',
    'processing_strategy', 'sync',
    'preparation_snapshot', (select confirmed_snapshot from public.takeoff_preparations where project_id = pg_temp.fixture(project))))
$$;
select pg_temp.sign_in(1);
set local role authenticated;
select pg_temp.admit(61, 20, 40);
select pg_temp.admit(65, 20, 40);
select pg_temp.admit(63, 21, 41);
reset role;
update public.takeoff_preparations as prep set revision = 2, draft = next.draft,
  confirmed_snapshot = jsonb_set(jsonb_set(prep.confirmed_snapshot, '{preparation_revision}', '2'), '{preparation}', next.draft)
from (select jsonb_set(prep_row.draft, '{sources}', jsonb_build_array(jsonb_build_object('document_id', f.id, 'kind', 'plan',
    'active', true, 'confirmed', true, 'plan_set_id', f.plan_set_id, 'file_path', f.file_path, 'page_count', f.page_count,
    'source_updated_at', f.updated_at))) as draft
  from public.takeoff_preparations prep_row, public.plan_files f
  where prep_row.project_id = pg_temp.fixture(20) and f.id = pg_temp.fixture(52)) as next
where prep.project_id = pg_temp.fixture(20);
set local role authenticated;
select pg_temp.admit(62, 20, 42);
reset role;
select pg_temp.sign_out();
update public.takeoff_jobs set status = 'completed'
where id in (pg_temp.fixture(61), pg_temp.fixture(62), pg_temp.fixture(63), pg_temp.fixture(65));
insert into public.takeoff_results(id, tenant_id, job_id) values
  (pg_temp.fixture(71), pg_temp.fixture(10), pg_temp.fixture(61)),
  (pg_temp.fixture(72), pg_temp.fixture(10), pg_temp.fixture(62)),
  (pg_temp.fixture(73), pg_temp.fixture(10), pg_temp.fixture(63)),
  (pg_temp.fixture(75), pg_temp.fixture(10), pg_temp.fixture(65));
insert into public.takeoff_items(id, tenant_id, job_id, result_id, designation, quantity, unit, evidence, source_file_name,
  source_page, confidence, metadata, created_at)
values
  -- Plan A, page 1: 3 washbasins and 2 WC.
  (pg_temp.fixture(81), pg_temp.fixture(10), pg_temp.fixture(61), pg_temp.fixture(71), 'Lavabo', 3, 'u', 'Repère page 1',
   'plan-a.pdf', 1, 0.95, jsonb_build_object('source_document', jsonb_build_object('kind', 'plan_file', 'plan_file_id', pg_temp.fixture(50))),
   '2026-11-20T10:00:00Z'),
  (pg_temp.fixture(82), pg_temp.fixture(10), pg_temp.fixture(61), pg_temp.fixture(71), 'WC suspendu', 2, 'u', 'Repère page 1',
   'plan-a.pdf', 1, 0.95, jsonb_build_object('source_document', jsonb_build_object('kind', 'plan_file', 'plan_file_id', pg_temp.fixture(50))),
   '2026-11-20T10:00:01Z'),
  -- Plan B, page 1: 2 more washbasins.
  (pg_temp.fixture(83), pg_temp.fixture(10), pg_temp.fixture(62), pg_temp.fixture(72), 'Lavabo', 2, 'u', 'Repère plan B',
   'plan-b.pdf', 1, 0.95, jsonb_build_object('source_document', jsonb_build_object('kind', 'plan_file', 'plan_file_id', pg_temp.fixture(52))),
   '2026-11-20T10:00:02Z'),
  (pg_temp.fixture(86), pg_temp.fixture(10), pg_temp.fixture(65), pg_temp.fixture(75), 'Lavabo', 1, 'u', 'Repère page 2',
   'plan-a.pdf', 2, 0.95, jsonb_build_object('source_document', jsonb_build_object('kind', 'plan_file', 'plan_file_id', pg_temp.fixture(50))),
   '2026-11-20T10:00:04Z'),
  (pg_temp.fixture(84), pg_temp.fixture(10), pg_temp.fixture(63), pg_temp.fixture(73), 'Lavabo', 4, 'u', 'Repère plan C',
   'plan-c.pdf', 1, 0.95, jsonb_build_object('source_document', jsonb_build_object('kind', 'plan_file', 'plan_file_id', pg_temp.fixture(51))),
   '2026-11-20T10:00:03Z');
-- A's WC was compared with this job only: its cross-job control is deferred until the destination is chosen.
update public.takeoff_items set rule_results = jsonb_build_array(jsonb_build_object('rule', 'zone_overlap', 'code', 'ZONE_OVERLAP_NONE',
    'status', 'pass', 'version', 1, 'acceptable', false, 'reason', 'Dans ce métré : aucun doublon.',
    'details', jsonb_build_object('evaluation_scope', 'job', 'cross_job_comparison', 'deferred'))),
  rules_evaluated_at = now(), rules_stale = false
where id = pg_temp.fixture(82);

-- An issued version for affaire 21, with a hand-typed line, to be copied and never changed.
insert into public.estimate_versions (id, tenant_id, project_id, version_number, calc_engine_version, max_section_depth,
  currency, status, margin_mode, margin_multiplier, margin_bp, global_coefficient, discount_bp, discount_mode, tax_rate_bp,
  rounding_mode, rounding_step_cents, sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents,
  commercial_rounding_cents, total_ht_cents, total_tax_cents, total_ttc_cents)
values (pg_temp.fixture(30), pg_temp.fixture(10), pg_temp.fixture(21), 1, 3, 3, 'EUR', 'draft', 'fixed', 1, 0, 1, 0, 'simple',
  2000, 'none', 1, 1.3, 1.2, 0, 0, 0, 0, 0, 0);
select set_config('miaouffrage.estimate_v3_writer', pg_temp.fixture(30)::text, true);
insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title) values
  (pg_temp.fixture(31), pg_temp.fixture(10), pg_temp.fixture(30), 'section', 1, 'Lot émis');
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, quantity, unit_code,
  unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, k_mo, pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents)
values (pg_temp.fixture(32), pg_temp.fixture(10), pg_temp.fixture(30), pg_temp.fixture(31), 'line', 1, 'Lavabo', 7, 'u',
  12000, 2000, 1, 0, 1, 0, 0, 0, 0);
select public.estimate_v3_complete_entry_for_writer(pg_temp.fixture(30), array[pg_temp.fixture(32)]);
select set_config('miaouffrage.estimate_v3_writer', '', true);
-- Status set past its workflow guard: the synthetic history of an issued version.
set local session_replication_role = replica;
update public.estimate_versions set status = 'sent' where id = pg_temp.fixture(30);
set local session_replication_role = origin;
create temp table issued_before as
select to_jsonb(v) - 'updated_at' as version_row, (select jsonb_agg(to_jsonb(i) order by i.id) from public.estimate_items i
  where i.version_id = v.id) as lines
from public.estimate_versions v where v.id = pg_temp.fixture(30);

-- The command as the server builds it, from the state it read (as the service it reads stamps through): a dry run first,
-- whose outcome the member sees, then the send of that outcome (pg_temp.send does both, as the preview and the
-- confirmation do; a command already confirmed is sent again as it was, as a retry is).
create function pg_temp.command(p_request integer, p_job integer, p_destination jsonb, p_section jsonb,
  p_accumulations jsonb default '[]', p_rule_results jsonb default null, p_mapping jsonb default null,
  p_override jsonb default null, p_page_decisions jsonb default '[]')
returns jsonb language sql as $$
  select jsonb_build_object('format_version', 1, 'mode', 'dry_run', 'request_id', pg_temp.fixture(p_request), 'job_id', j.id,
    'fingerprint', repeat('f', 64), 'destination', p_destination, 'section', p_section,
    -- What the user confirmed (send-server.ts `client`): its hash tells a replay from another confirmation.
    'client', jsonb_build_object('fingerprint', repeat('f', 64), 'destination', p_destination - 'version_payload',
      'section', p_section - 'id', 'page_decisions', p_page_decisions, 'override', p_override is not null),
    'expected', jsonb_build_object(
      'versions', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'status', v.status, 'updated_at', v.updated_at)
        order by v.id), '[]'::jsonb) from public.estimate_versions v where v.project_id = j.project_id),
      'job_stamp', public.takeoff_rule_job_stamp(j.tenant_id, j.project_id, j.id),
      'peers_stamp', case p_destination ->> 'kind'
        when 'existing_draft' then public.takeoff_send_peers_stamp(j.tenant_id, (p_destination ->> 'version_id')::uuid)
        -- A copy is evaluated against the takeoffs of the version it copies.
        when 'version_copy' then public.takeoff_send_peers_stamp(j.tenant_id, (p_destination ->> 'source_version_id')::uuid) end,
      'mapping_stamp', public.takeoff_mapping_rules_stamp(j.tenant_id)),
    'mapping_plan', coalesce(p_mapping, (select jsonb_agg(jsonb_build_object('item_id', i.id, 'source_order', i.rank - 1,
        'rule_id', null, 'action', 'none', 'designation', btrim(i.designation), 'unit_price_cents', null, 'category_id', null,
        'assembly_id', null) order by i.rank)
      from (select item.*, row_number() over (order by item.created_at, item.id) as rank
        from public.takeoff_items item where item.job_id = j.id) as i)),
    'page_decisions', p_page_decisions,
    'rule_results', coalesce(p_rule_results, '[]'::jsonb), 'rule_transforms', '[]'::jsonb,
    'accumulations', p_accumulations, 'override', p_override, 'price_rules_ignored', '[]'::jsonb, 'expected_outcome', null)
  from public.takeoff_jobs j where j.id = pg_temp.fixture(p_job)
$$;
create function pg_temp.first_draft(p_version integer) returns jsonb language sql immutable as $$
  select jsonb_build_object('kind', 'first_draft', 'version_payload', jsonb_build_object(
    'id', pg_temp.fixture(p_version), 'title', null, 'date_devis', '2026-11-21', 'validite_jours', 30, 'margin_multiplier', 1,
    'margin_mode', 'fixed', 'currency', 'EUR', 'margin_bp', 0, 'discount_bp', 0, 'discount_amount_cents', null,
    'discount_mode', 'simple', 'discount_steps', '[]'::jsonb, 'global_coefficient', 1, 'tax_rate_bp', 2000,
    'rounding_mode', 'none', 'rounding_step_cents', 1, 'max_section_depth', 3, 'contractor_role', 'principal',
    'calc_engine_version', 3, 'gross_ht_cents', 0, 'discount_applied_cents', 0, 'commercial_rounding_cents', 0,
    'total_ht_cents', 0, 'total_tax_cents', 0, 'total_ttc_cents', 0))
$$;
create function pg_temp.new_section(p_id integer) returns jsonb language sql immutable as $$
  select jsonb_build_object('kind', 'new', 'id', pg_temp.fixture(p_id), 'title', 'Métré — plans fictifs')
$$;
create temp table commands (name text primary key, body jsonb) on commit drop;
grant all on commands to authenticated;
-- As send-server.ts: the service stages what it computed for the signed-in actor, then the user's session sends the
-- request by its identity only.
create function pg_temp.stage(p_name text) returns void language plpgsql as $$
declare
  caller text := current_user;
  actor uuid := (select auth.uid());
  staged jsonb := (select body from commands where name = p_name);
begin
  set local role service_role;
  perform public.stage_takeoff_send(actor, staged);
  execute format('set local role %I', caller);
end;
$$;
create function pg_temp.request(p_name text) returns jsonb language sql as $$
  select jsonb_build_object('request_id', body -> 'request_id', 'job_id', body -> 'job_id', 'fingerprint', body -> 'fingerprint')
  from commands where name = p_name
$$;
create function pg_temp.stage_body(p_body jsonb) returns void language plpgsql as $$
declare
  caller text := current_user;
  actor uuid := (select auth.uid());
begin
  set local role service_role;
  perform public.stage_takeoff_send(actor, p_body);
  execute format('set local role %I', caller);
end;
$$;
-- The preview of a command: its dry run under a fresh identity, as the server runs it. It must show an outcome.
create function pg_temp.preview(p_name text) returns jsonb language plpgsql as $$
declare
  previewed jsonb := (select body from commands where name = p_name)
    || jsonb_build_object('request_id', gen_random_uuid(), 'mode', 'dry_run', 'expected_outcome', null);
  answer jsonb;
begin
  perform pg_temp.stage_body(previewed);
  answer := public.send_takeoff_job(jsonb_build_object('request_id', previewed -> 'request_id', 'job_id', previewed -> 'job_id',
    'fingerprint', previewed -> 'fingerprint'));
  if answer ->> 'dry_run' is distinct from 'true' or answer ? 'error'
    or jsonb_typeof(answer -> 'outcome') is distinct from 'object' then
    raise exception 'the preview showed no outcome: %', answer;
  end if;
  return answer -> 'outcome';
end;
$$;
-- The confirmation of an outcome: the command in send mode, staged and sent by its request identity.
create function pg_temp.confirm(p_name text, p_outcome jsonb) returns jsonb language plpgsql as $$
begin
  update commands set body = body || jsonb_build_object('mode', 'send', 'expected_outcome', p_outcome) where name = p_name;
  perform pg_temp.stage(p_name);
  return public.send_takeoff_job(pg_temp.request(p_name));
end;
$$;
-- The preview, then the confirmation of what it showed; a confirmed command is sent again as it is (a replay).
create function pg_temp.send(p_name text) returns jsonb language plpgsql as $$
begin
  if (select body ->> 'mode' from commands where name = p_name) = 'dry_run' then
    return pg_temp.confirm(p_name, pg_temp.preview(p_name));
  end if;
  perform pg_temp.stage(p_name);
  return public.send_takeoff_job(pg_temp.request(p_name));
end;
$$;
-- The refusal of a statement as « SQLSTATE MESSAGE reason », or null when it passed (its writes are rolled back).
create function pg_temp.refusal(p_sql text) returns text language plpgsql as $$
declare
  state text;
  message text;
  detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics state = returned_sqlstate, message = message_text, detail = pg_exception_detail;
  return concat_ws(' ', state, message, case when detail ~ '^\{' then detail::jsonb ->> 'reason' end);
end;
$$;
-- An outcome no preview showed, for the refusals that come before the outcome is compared.
create function pg_temp.unseen() returns jsonb language sql immutable as $$
  select '{"format_version": 1, "engine": 3, "sections_created": [], "lines": [], "parts": []}'::jsonb
$$;
-- A's WC evaluated for the destination by the preview (its cross-job control was deferred).
create function pg_temp.wc_evaluated() returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('id', i.id, 'results', jsonb_build_array(jsonb_build_object(
      'rule', 'zone_overlap', 'code', 'ZONE_OVERLAP_NONE', 'status', 'pass', 'version', 1, 'acceptable', false,
      'reason', 'Aucun doublon avec les autres métrés du devis.')),
    'expected_updated_at', i.updated_at, 'expected_stale_at', i.rules_stale_at))
  from public.takeoff_items i where i.id = pg_temp.fixture(82)
$$;
create function pg_temp.counts(p_project integer) returns jsonb language sql as $$
  select jsonb_build_object(
    'versions', (select count(*) from public.estimate_versions where project_id = pg_temp.fixture(p_project)),
    'lines', (select count(*) from public.estimate_items i join public.estimate_versions v on v.id = i.version_id
      where v.project_id = pg_temp.fixture(p_project) and i.item_type = 'line'),
    'receipts', (select count(*) from public.takeoff_send_receipts where project_id = pg_temp.fixture(p_project)),
    'attached', (select count(*) from public.takeoff_jobs where project_id = pg_temp.fixture(p_project)
      and estimate_version_id is not null))
$$;

-- 1. The door M1 left closed opens for the command's own permit only.
select throws_ok($$update public.takeoff_jobs set estimate_version_id = pg_temp.fixture(30) where id = pg_temp.fixture(63)$$,
  '42501', 'TAKEOFF_JOB_IDENTITY_IMMUTABLE', 'an elevated direct update without a permit is refused');
insert into private.takeoff_job_attachment_permits(job_id, tenant_id, project_id, version_id, transaction_id)
values (pg_temp.fixture(63), pg_temp.fixture(10), pg_temp.fixture(21), pg_temp.fixture(30), '1'::xid8);
select throws_ok($$update public.takeoff_jobs set estimate_version_id = pg_temp.fixture(30) where id = pg_temp.fixture(63)$$,
  '42501', 'TAKEOFF_JOB_IDENTITY_IMMUTABLE', 'a permit of another transaction is never found');
delete from private.takeoff_job_attachment_permits;
set local role service_role;
select throws_ok($$insert into private.takeoff_job_attachment_permits(job_id, tenant_id, project_id, version_id)
  values (pg_temp.fixture(63), pg_temp.fixture(10), pg_temp.fixture(21), pg_temp.fixture(30))$$,
  '42501', null, 'the service role cannot issue a permit');
select throws_ok($$select private.has_takeoff_job_version_attachment_permit(pg_temp.fixture(10), pg_temp.fixture(21),
  pg_temp.fixture(63), pg_temp.fixture(30))$$, '42501', null, 'the service role cannot call the permit check');
select throws_ok($$select public.send_takeoff_job('{}'::jsonb)$$, '42501', null, 'the service role cannot call the command');
select throws_ok($$insert into public.takeoff_send_receipts(tenant_id, project_id, job_id, request_id, format_version, actor_id,
  payload_hash, preview_fingerprint, destination, target_version_id, write_plan, result)
  values (pg_temp.fixture(10), pg_temp.fixture(21), pg_temp.fixture(63), gen_random_uuid(), 1, pg_temp.fixture(1),
  repeat('a', 64), repeat('a', 64), '{}', pg_temp.fixture(30), '{}', '{}')$$,
  '42501', 'TAKEOFF_SEND_RECEIPT_IMMUTABLE', 'the service role cannot forge a receipt outside the command');
reset role;
select pg_temp.sign_in(1);
set local role authenticated;
select throws_ok($$insert into private.takeoff_job_attachment_permits(job_id, tenant_id, project_id, version_id)
  values (pg_temp.fixture(63), pg_temp.fixture(10), pg_temp.fixture(21), pg_temp.fixture(30))$$,
  '42501', null, 'an authenticated client cannot issue a permit');
select throws_ok($$insert into public.takeoff_send_receipts(tenant_id, project_id, job_id, request_id, format_version, actor_id,
  payload_hash, preview_fingerprint, destination, target_version_id, write_plan, result)
  values (pg_temp.fixture(10), pg_temp.fixture(21), pg_temp.fixture(63), gen_random_uuid(), 1, pg_temp.fixture(1),
  repeat('a', 64), repeat('a', 64), '{}', pg_temp.fixture(30), '{}', '{}')$$,
  '42501', null, 'an authenticated client cannot write a receipt');
reset role;

-- 1b. The command takes nothing from the browser: rule results, plan and impact come from the server's staged command,
-- of this actor and this request, with the fingerprint the user confirmed.
insert into commands values ('injected', pg_temp.command(140, 61, pg_temp.first_draft(100), pg_temp.new_section(110),
  p_rule_results => (select jsonb_agg(jsonb_build_object('id', i.id, 'results', jsonb_build_array(jsonb_build_object(
      'rule', 'zone_overlap', 'code', 'ZONE_OVERLAP_NONE', 'status', 'pass', 'version', 1, 'acceptable', false,
      'reason', 'Écrit par le navigateur.')), 'expected_updated_at', i.updated_at, 'expected_stale_at', i.rules_stale_at))
    from public.takeoff_items i where i.id = pg_temp.fixture(82))));
select pg_temp.sign_in(1);
set local role authenticated;
select throws_ok($$select public.stage_takeoff_send(pg_temp.fixture(1), (select body from commands where name = 'injected'))$$,
  '42501', null, 'an authenticated client cannot stage a command');
select throws_ok($$select public.send_takeoff_job((select body from commands where name = 'injected'))$$,
  '22023', 'TAKEOFF_SEND_COMMAND_INVALID', 'a command written by the client is refused: it names a request only');
select throws_ok($$select public.send_takeoff_job(pg_temp.request('injected'))$$,
  '40001', 'TAKEOFF_SEND_PREVIEW_STALE', 'a request the server did not stage sends nothing');
reset role;
select pg_temp.sign_in(4);
select pg_temp.stage('injected');
select pg_temp.sign_in(1);
set local role authenticated;
select throws_ok($$select public.send_takeoff_job(pg_temp.request('injected'))$$,
  '40001', 'TAKEOFF_SEND_PREVIEW_STALE', 'a command staged for another user is not this user''s');
select throws_ok($$select pg_temp.stage('injected')$$, '40001', 'TAKEOFF_SEND_REQUEST_CONFLICT',
  'nor can it be staged again for this user');
reset role;
delete from private.takeoff_send_commands where request_id = pg_temp.fixture(140);
-- A confirmation (a preview's call answers instead, outcome suite section 15).
update commands set body = body || jsonb_build_object('mode', 'send', 'expected_outcome', pg_temp.unseen()) where name = 'injected';
select pg_temp.stage('injected');
set local role authenticated;
select throws_ok($$select public.send_takeoff_job(jsonb_set(pg_temp.request('injected'), '{fingerprint}', to_jsonb(repeat('e', 64))))$$,
  '40001', 'TAKEOFF_SEND_PREVIEW_STALE', 'a fingerprint other than the staged one sends nothing');
reset role;
delete from private.takeoff_send_commands where request_id = pg_temp.fixture(140);
select is(pg_temp.counts(20), '{"versions":0,"lines":0,"receipts":0,"attached":0}'::jsonb, 'nothing was sent');

-- 2. A first draft previewed before a version existed is stale once one exists: its confirmation is refused, and the
-- refusal writes nothing.
insert into commands values ('stale', pg_temp.command(101, 61, pg_temp.first_draft(100), pg_temp.new_section(110),
  p_rule_results => pg_temp.wc_evaluated()));
select pg_temp.sign_in(1);
set local role authenticated;
create temp table stale_shown as select pg_temp.preview('stale') as outcome;
reset role;
select pg_temp.sign_out();
insert into public.estimate_versions (id, tenant_id, project_id, version_number, calc_engine_version, max_section_depth,
  currency, status, margin_mode, margin_multiplier, margin_bp, global_coefficient, discount_bp, discount_mode, tax_rate_bp,
  rounding_mode, rounding_step_cents, sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents,
  commercial_rounding_cents, total_ht_cents, total_tax_cents, total_ttc_cents)
values (pg_temp.fixture(160), pg_temp.fixture(10), pg_temp.fixture(20), 1, 3, 3, 'EUR', 'draft', 'fixed', 1, 0, 1, 0,
  'simple', 2000, 'none', 1, 1.3, 1.2, 0, 0, 0, 0, 0, 0);
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.confirm('stale', (select outcome from stale_shown))$$),
  '40001 TAKEOFF_SEND_PREVIEW_STALE destination_changed', 'a version created after the preview refuses its confirmation');
reset role;
delete from public.estimate_versions where id = pg_temp.fixture(160);
select is(pg_temp.counts(20), '{"versions":0,"lines":0,"receipts":0,"attached":0}'::jsonb, 'a refused send writes nothing');

-- 3. A deferred control must be evaluated for the destination: a confirmation that arrives without the evaluation its
-- preview made sends nothing.
insert into commands values ('deferred', pg_temp.command(102, 61, pg_temp.first_draft(100), pg_temp.new_section(110),
  p_rule_results => pg_temp.wc_evaluated()));
select pg_temp.sign_in(1);
set local role authenticated;
create temp table deferred_shown as select pg_temp.preview('deferred') as outcome;
update commands set body = jsonb_set(body, '{rule_results}', '[]') where name = 'deferred';
select is(pg_temp.refusal($$select pg_temp.confirm('deferred', (select outcome from deferred_shown))$$),
  '40001 TAKEOFF_SEND_PREVIEW_STALE rules_changed', 'a control still deferred refuses the confirmation');
reset role;
select is(pg_temp.counts(20), '{"versions":0,"lines":0,"receipts":0,"attached":0}'::jsonb,
  'the refused send rolled back the created version and section');
select is((select estimate_version_id from public.takeoff_jobs where id = pg_temp.fixture(61)), null::uuid,
  'the job is still without a version');
select is((select count(*) from private.takeoff_job_attachment_permits), 0::bigint, 'no permit survives a refused send');

-- 4. A price rule never reaches the estimate through this journey: a confirmation that carries one its preview did not
-- is refused.
insert into commands values ('price', pg_temp.command(103, 61, pg_temp.first_draft(100), pg_temp.new_section(110),
  p_rule_results => pg_temp.wc_evaluated()));
select pg_temp.sign_in(1);
set local role authenticated;
create temp table price_shown as select pg_temp.preview('price') as outcome;
update commands set body = jsonb_set(body, '{mapping_plan}', (select jsonb_agg(jsonb_build_object('item_id', i.id,
    'source_order', i.rank - 1, 'rule_id', null, 'action', case when i.rank = 1 then 'set_price' else 'none' end,
    'designation', i.designation, 'unit_price_cents', case when i.rank = 1 then 5000 end, 'category_id', null,
    'assembly_id', null) order by i.rank)
  from (select item.*, row_number() over (order by item.created_at, item.id) as rank from public.takeoff_items item
    where item.job_id = pg_temp.fixture(61)) as i))
where name = 'price';
select is(pg_temp.refusal($$select pg_temp.confirm('price', (select outcome from price_shown))$$),
  '22023 TAKEOFF_SEND_PRICE_RULE_REFUSED', 'a price rule is refused at the confirmation');
reset role;

-- 5. The first send: V1, its section, the lines, the job attached and applied, the receipt, in one transaction. Its
-- engineer previews it; the rights are those of the confirmation: the affaire given to another engineer, or the engineer
-- made a director, after the preview, refuses it.
insert into commands values ('first', pg_temp.command(104, 61, pg_temp.first_draft(100), pg_temp.new_section(110),
  p_rule_results => pg_temp.wc_evaluated()));
-- Previewed now too, and confirmed after the first send (6 and 7): the same takeoff from another tab, and takeoff B.
insert into commands values ('again', pg_temp.command(105, 61, pg_temp.first_draft(106), pg_temp.new_section(116),
  p_rule_results => pg_temp.wc_evaluated()));
insert into commands values ('b-first', pg_temp.command(107, 62, pg_temp.first_draft(108), pg_temp.new_section(118)));
select pg_temp.sign_in(1);
set local role authenticated;
create temp table first_shown as select pg_temp.preview('first') as outcome;
create temp table again_shown as select pg_temp.preview('again') as outcome;
create temp table b_first_shown as select pg_temp.preview('b-first') as outcome;
reset role;
update public.estimate_projects set user_id = pg_temp.fixture(2) where id = pg_temp.fixture(20);
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.confirm('first', (select outcome from first_shown))$$),
  '42501 TAKEOFF_SEND_PROJECT_NOT_WRITABLE', 'an engineer who no longer owns the affaire cannot confirm its send');
reset role;
update public.estimate_projects set user_id = pg_temp.fixture(1) where id = pg_temp.fixture(20);
update public.tenant_memberships set role = 'director' where user_id = pg_temp.fixture(1) and tenant_id = pg_temp.fixture(10);
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.confirm('first', (select outcome from first_shown))$$),
  '42501 TAKEOFF_APPLY_OPERATOR_REQUIRED', 'a director cannot confirm a send');
reset role;
update public.tenant_memberships set role = 'engineer' where user_id = pg_temp.fixture(1) and tenant_id = pg_temp.fixture(10);
select is(pg_temp.counts(20), '{"versions":0,"lines":0,"receipts":0,"attached":0}'::jsonb, 'the refused confirmations wrote nothing');
select pg_temp.sign_in(1);
set local role authenticated;
create temp table first_receipt as select pg_temp.confirm('first', (select outcome from first_shown)) as receipt;
reset role;
select is((select receipt ->> 'replayed' from first_receipt), 'false', 'the first send is not a replay');
select results_eq($$select version_number, status::text, calc_engine_version::integer from public.estimate_versions
  where project_id = pg_temp.fixture(20)$$, $$values (1, 'draft', 3)$$, 'one first draft V1 in the tenant engine');
select is((select title from public.estimate_items where id = pg_temp.fixture(110) and item_type = 'section'),
  'Métré — plans fictifs', 'the proposed section was created');
select results_eq($$select title, trim_scale(quantity), unit_code, unit_price_ht_cents, parent_id from public.estimate_items
  where version_id = pg_temp.fixture(100) and item_type = 'line' order by position$$,
  $$values ('Lavabo'::text, 3::numeric, 'u'::text, 0, pg_temp.fixture(110)), ('WC suspendu', 2, 'u', 0, pg_temp.fixture(110))$$,
  'the lines enter with their quantities and no price');
select results_eq($$select estimate_version_id, status::text from public.takeoff_jobs where id = pg_temp.fixture(61)$$,
  $$values (pg_temp.fixture(100), 'applied'::text)$$, 'the job is attached to V1 and applied');
select is((select count(*) from public.draft_locks where version_id = pg_temp.fixture(100)), 0::bigint,
  'the transaction lock of the created version does not outlive the send');
select is((select rule_results #>> '{0,details,cross_job_comparison}' from public.takeoff_items where id = pg_temp.fixture(82)),
  null, 'the deferred control was replaced by its evaluation for the destination');
select results_eq($$select request_id, target_version_id, command_kind, format_version::integer,
    write_plan #>> '{destination,kind}', jsonb_array_length(write_plan -> 'parts'),
    write_plan #>> '{parts,0,source,quantity_source}', write_plan #>> '{parts,0,source,source_page}',
    jsonb_array_length(result -> 'lines_created'), jsonb_array_length(result -> 'sections_created')
  from public.takeoff_send_receipts where job_id = pg_temp.fixture(61)$$,
  $$values (pg_temp.fixture(104), pg_temp.fixture(100), 'send'::text, 1, 'first_draft'::text, 2, 'measured'::text, '1'::text, 2, 1)$$,
  'one versioned receipt names the parts, their page and the lines created');
select ok((select write_plan #>> '{parts,0,source,evidence_revision}' ~ '^[0-9a-f]{32}$' from public.takeoff_send_receipts
  where job_id = pg_temp.fixture(61)), 'each part records the revision of its evidence');
set local role service_role;
select throws_ok($$update public.takeoff_send_receipts set result = '{}' where job_id = pg_temp.fixture(61)$$,
  '42501', 'TAKEOFF_SEND_RECEIPT_IMMUTABLE', 'a receipt is never rewritten, not even by the service role');
reset role;

-- 6. A replay returns the receipt; nothing is created twice. The same request with other content is a conflict.
select pg_temp.sign_in(1);
set local role authenticated;
select is((select pg_temp.send('first') ->> 'id'), (select receipt ->> 'id' from first_receipt), 'a replay returns the receipt');
select is((select pg_temp.send('first') ->> 'replayed'), 'true', 'and says it is a replay');
update commands set body = jsonb_set(body, '{client,section}', '{"kind":"new","title":"Une autre section"}') where name = 'first';
select throws_ok($$select pg_temp.send('first')$$, '40001', 'TAKEOFF_SEND_REQUEST_CONFLICT',
  'the same request confirming something else is a conflict');
reset role;
select is(pg_temp.counts(20), '{"versions":1,"lines":2,"receipts":1,"attached":1}'::jsonb, 'no second V1, no second application');
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.confirm('again', (select outcome from again_shown))$$),
  '40001 TAKEOFF_SEND_PREVIEW_STALE destination_changed',
  'its first draft previewed from another tab is refused once V1 exists, as soon as the affaire is held');
reset role;
-- The same takeoff confirmed to V1 itself: a job is sent once.
insert into commands values ('again-to-v1', jsonb_set(pg_temp.command(126, 61, jsonb_build_object('kind', 'existing_draft',
  'version_id', pg_temp.fixture(100)), jsonb_build_object('kind', 'existing', 'id', pg_temp.fixture(110))),
  '{expected,job_stamp}', '"read before the first send"'));
insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
values (pg_temp.fixture(100), pg_temp.fixture(1), pg_temp.fixture(10), now() + interval '5 minutes', gen_random_uuid());
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.confirm('again-to-v1', pg_temp.unseen())$$), '40001 TAKEOFF_SEND_ALREADY_SENT',
  'a job is sent once: its confirmation to the draft it is on is refused by name');
reset role;
delete from public.draft_locks where version_id = pg_temp.fixture(100);

-- 7. B previewed a first draft before A was sent: its confirmation is refused; sent to V1, it adds its 2 to A's 3.
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.confirm('b-first', (select outcome from b_first_shown))$$),
  '40001 TAKEOFF_SEND_PREVIEW_STALE destination_changed', 'a first draft previewed before another send is refused');
reset role;
insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
values (pg_temp.fixture(100), pg_temp.fixture(1), pg_temp.fixture(10), now() + interval '30 minutes', gen_random_uuid());
create temp table a_line as select id, quantity, updated_at, unit_price_ht_cents, source_metadata from public.estimate_items
where version_id = pg_temp.fixture(100) and title = 'Lavabo';
insert into commands values ('b', pg_temp.command(109, 62, jsonb_build_object('kind', 'existing_draft', 'version_id', pg_temp.fixture(100)),
  jsonb_build_object('kind', 'existing', 'id', pg_temp.fixture(110)),
  p_accumulations => (select jsonb_build_array(jsonb_build_object('takeoff_item_id', pg_temp.fixture(83),
    'estimate_item_id', id, 'expected_updated_at', updated_at, 'expected_quantity', quantity)) from a_line)));
set local role authenticated;
select lives_ok($$select pg_temp.send('b')$$, 'B is sent to the draft A created');
reset role;
select results_eq($$select trim_scale(quantity), unit_price_ht_cents, source_job_id from public.estimate_items
  where version_id = pg_temp.fixture(100) and title = 'Lavabo'$$,
  $$values (5::numeric, 0, pg_temp.fixture(62))$$, 'one line of five, its price unchanged');
select is((select count(*) from public.estimate_items where version_id = pg_temp.fixture(100) and item_type = 'line'), 2::bigint,
  'B adds no second washbasin line');
select is((select private.takeoff_estimate_line_item_ids(source_metadata, source_job_id) from public.estimate_items
  where version_id = pg_temp.fixture(100) and title = 'Lavabo'), array[pg_temp.fixture(81), pg_temp.fixture(83)],
  'the line names A''s three and B''s two as its sources');
select is((select jsonb_agg(trim_scale((part ->> 'quantity')::numeric) order by ordinality) from public.estimate_items
  cross join lateral jsonb_array_elements(source_metadata #> '{takeoff_contributions,parts}') with ordinality as p(part, ordinality)
  where version_id = pg_temp.fixture(100) and title = 'Lavabo'), '[3, 2]'::jsonb, 'each send keeps its contribution');
select is((select result -> 'lines_changed' from public.takeoff_send_receipts where job_id = pg_temp.fixture(62)),
  (select jsonb_build_array(id) from a_line), 'the receipt lists the line actually changed apart from the created ones');

-- A second job of A's very launch meets the historical receipt of that launch on the version: refused by name.
insert into commands values ('a2', pg_temp.command(112, 65, jsonb_build_object('kind', 'existing_draft', 'version_id', pg_temp.fixture(100)),
  jsonb_build_object('kind', 'existing', 'id', pg_temp.fixture(110))));
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.preview('a2')$$) ~ 'TAKEOFF_SEND_PREPARATION_ALREADY_SENT', true,
  'its preview is refused by name');
select is(pg_temp.refusal($$select pg_temp.confirm('a2', pg_temp.unseen())$$), '22023 TAKEOFF_SEND_PREPARATION_ALREADY_SENT',
  'and so is its confirmation, by name, not by a key violation');
reset role;

-- 8. A, already applied, cannot lose a duplicate behind the estimate's back: the estimate stays at five.
select pg_temp.sign_in(1);
set local role authenticated;
select throws_ok($$update public.takeoff_items set is_excluded = true, exclusion_reason = 'Doublon fictif.'
  where id = pg_temp.fixture(81)$$, '42501', 'TAKEOFF_ITEM_APPLIED_JOB_IMMUTABLE', 'an applied takeoff line stays as sent');
reset role;
select is((select trim_scale(quantity) from public.estimate_items where version_id = pg_temp.fixture(100) and title = 'Lavabo'),
  5::numeric, 'the estimate keeps five until a new confirmed preview');

-- 9. The readers keep the takeoff they read before the send.
create function pg_temp.reads(p_job integer) returns jsonb language sql as $$
  select jsonb_build_object('job', (select count(*) from public.takeoff_jobs where id = pg_temp.fixture(p_job)),
    'items', (select count(*) from public.takeoff_items where job_id = pg_temp.fixture(p_job)),
    'results', (select count(*) from public.takeoff_results where job_id = pg_temp.fixture(p_job)),
    'receipt', (select count(*) from public.takeoff_send_receipts where job_id = pg_temp.fixture(p_job)),
    'plan', (select count(*) from public.plan_files where id = pg_temp.fixture(50)))
$$;
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.reads(61), '{"job":1,"items":2,"results":1,"receipt":1,"plan":1}'::jsonb, 'the owner reads the sent takeoff');
reset role;
select pg_temp.sign_in(4);
set local role authenticated;
select is(pg_temp.reads(61), '{"job":1,"items":2,"results":1,"receipt":1,"plan":1}'::jsonb, 'an administrator reads it');
reset role;
select pg_temp.sign_in(3);
set local role authenticated;
select is(pg_temp.reads(61), '{"job":1,"items":2,"results":1,"receipt":1,"plan":1}'::jsonb,
  'a director who read it before the send still reads it, with its plan');
reset role;
select pg_temp.sign_in(2);
set local role authenticated;
select is(pg_temp.reads(61), '{"job":0,"items":0,"results":0,"receipt":0,"plan":0}'::jsonb,
  'an engineer of another affaire still reads nothing');
reset role;
select pg_temp.sign_in(5);
set local role authenticated;
select is(pg_temp.reads(61), '{"job":0,"items":0,"results":0,"receipt":0,"plan":0}'::jsonb, 'another tenant reads nothing');
reset role;

-- 10. Only issued versions: the copy receives the lines, the original is unchanged.
insert into commands values ('copy', pg_temp.command(111, 63, jsonb_build_object('kind', 'version_copy',
  'source_version_id', pg_temp.fixture(30)), pg_temp.new_section(119)));
-- Its controls were evaluated against the takeoffs of the version it copies: a confirmation that names another state
-- of them than its preview read is refused.
insert into commands select 'copy-elsewhere', jsonb_set(body, '{request_id}', to_jsonb(pg_temp.fixture(141)))
from commands where name = 'copy';
select pg_temp.sign_in(1);
set local role authenticated;
create temp table copy_elsewhere_shown as select pg_temp.preview('copy-elsewhere') as outcome;
update commands set body = jsonb_set(body, '{expected,peers_stamp}', '"read without the takeoffs of the copied version"')
where name = 'copy-elsewhere';
select is(pg_temp.refusal($$select pg_temp.confirm('copy-elsewhere', (select outcome from copy_elsewhere_shown))$$),
  '40001 TAKEOFF_SEND_PREVIEW_STALE estimate_changed',
  'a copy whose controls were not evaluated against the copied version is refused');
create temp table copy_receipt as select pg_temp.send('copy') as receipt;
reset role;
select is((select to_jsonb(v) - 'updated_at' from public.estimate_versions v where v.id = pg_temp.fixture(30)),
  (select version_row from issued_before), 'the issued version is unchanged');
select is((select jsonb_agg(to_jsonb(i) order by i.id) from public.estimate_items i where i.version_id = pg_temp.fixture(30)),
  (select lines from issued_before), 'its lines are unchanged');
select results_eq($$select v.version_number, v.status::text, (select count(*) from public.estimate_items i
    where i.version_id = v.id and i.item_type = 'line')
  from public.estimate_versions v where v.id = (select (receipt ->> 'target_version_id')::uuid from copy_receipt)$$,
  $$values (2, 'draft'::text, 2::bigint)$$, 'the copy V2 holds the copied line and the sent one');
set local role service_role;
select throws_ok($$delete from public.takeoff_send_receipts where job_id = pg_temp.fixture(63)$$,
  '42501', 'TAKEOFF_SEND_RECEIPT_IMMUTABLE', 'a receipt is never deleted on its own, not even by the service role');
reset role;

-- 11. « Fusionner » never overwrites an ordinary line, whatever entry is used.
select pg_temp.sign_out();
insert into public.estimate_versions (id, tenant_id, project_id, version_number, calc_engine_version, max_section_depth,
  currency, status, margin_mode, margin_multiplier, margin_bp, global_coefficient, discount_bp, discount_mode, tax_rate_bp,
  rounding_mode, rounding_step_cents, sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents,
  commercial_rounding_cents, total_ht_cents, total_tax_cents, total_ttc_cents)
values (pg_temp.fixture(120), pg_temp.fixture(10), pg_temp.fixture(21), 9, 3, 3, 'EUR', 'draft', 'fixed', 1, 0, 1, 0,
  'simple', 2000, 'none', 1, 1.3, 1.2, 0, 0, 0, 0, 0, 0);
select set_config('miaouffrage.estimate_v3_writer', pg_temp.fixture(120)::text, true);
insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title) values
  (pg_temp.fixture(121), pg_temp.fixture(10), pg_temp.fixture(120), 'section', 1, 'Lot saisi');
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, quantity, unit_code,
  unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, k_mo, pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents)
values (pg_temp.fixture(122), pg_temp.fixture(10), pg_temp.fixture(120), pg_temp.fixture(121), 'line', 1, 'Lavabo', 9, 'u',
  15000, 2000, 1, 0, 1, 0, 0, 0, 0);
select public.estimate_v3_complete_entry_for_writer(pg_temp.fixture(120), array[pg_temp.fixture(122)]);
select set_config('miaouffrage.estimate_v3_writer', '', true);
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, created_by)
values (pg_temp.fixture(64), pg_temp.fixture(10), pg_temp.fixture(120), 'B', 'completed', 'plan-saisi.pdf', pg_temp.fixture(4));
insert into public.takeoff_items (id, tenant_id, job_id, designation, quantity, unit, confidence, evidence, source_file_name, source_page)
values (pg_temp.fixture(85), pg_temp.fixture(10), pg_temp.fixture(64), 'Lavabo', 4, 'u', 0.95, 'Repère', 'plan-saisi.pdf', 1);
insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
values (pg_temp.fixture(120), pg_temp.fixture(4), pg_temp.fixture(10), now() + interval '30 minutes', gen_random_uuid());
create function pg_temp.merge_plan() returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('item_id', pg_temp.fixture(85), 'source_order', 0, 'rule_id', null, 'action', 'none',
    'designation', 'Lavabo', 'unit_price_cents', null, 'category_id', null, 'assembly_id', null))
$$;
select pg_temp.sign_in(4);
set local role authenticated;
select throws_ok($$select * from public.apply_takeoff_job_with_page_decisions(pg_temp.fixture(64), 'merge', pg_temp.fixture(121),
  pg_temp.merge_plan(), '[]'::jsonb, null)$$, '22023', 'TAKEOFF_APPLY_ORDINARY_LINE_CONFLICT',
  'the route''s entry refuses to merge onto a hand-typed line');
select throws_ok($$select * from public.apply_takeoff_job_guarded_atomic(pg_temp.fixture(64), 'merge', pg_temp.fixture(121),
  pg_temp.merge_plan())$$, '22023', 'TAKEOFF_APPLY_ORDINARY_LINE_CONFLICT', 'the direct four-argument overload refuses it too');
reset role;
-- The five-argument overload, the one a DPGF reconciliation authorizes, on its own.
insert into public.takeoff_apply_authorizations (tenant_id, job_id, estimate_version_id, user_id, authorization_token_hash,
  review_summary, expires_at)
values (pg_temp.fixture(10), pg_temp.fixture(64), pg_temp.fixture(120), pg_temp.fixture(4),
  encode(sha256(convert_to('ordinary-line-five', 'UTF8')), 'hex'), '{}'::jsonb, now() + interval '5 minutes');
set local role authenticated;
select throws_ok($$select * from public.apply_takeoff_job_guarded_atomic(pg_temp.fixture(64), 'merge', pg_temp.fixture(121),
  pg_temp.merge_plan(), 'ordinary-line-five')$$, '22023', 'TAKEOFF_APPLY_ORDINARY_LINE_CONFLICT',
  'the direct five-argument overload refuses it too');
reset role;
select results_eq($$select trim_scale(quantity), unit_price_ht_cents, source_provider from public.estimate_items
  where id = pg_temp.fixture(122)$$, $$values (9::numeric, 15000, 'manual'::text)$$, 'the hand-typed line keeps its quantity');
select is((select status::text from public.takeoff_jobs where id = pg_temp.fixture(64)), 'completed', 'the refused merge applied nothing');

-- 12. A line without evidence on a detailed takeoff blocks the send: refused without an override and to an engineer;
-- sent by an administrator whose coded reason and justification bind to the line as evaluated for this destination,
-- with the trace of the override and of its consumption.
select pg_temp.sign_out();
insert into public.estimate_projects(id, tenant_id, user_id, name) values
  (pg_temp.fixture(22), pg_temp.fixture(10), pg_temp.fixture(1), 'Affaire au forçage');
insert into public.plan_sets(id, tenant_id, project_id, name) values
  (pg_temp.fixture(43), pg_temp.fixture(10), pg_temp.fixture(22), 'Plans à forcer');
insert into public.plan_files(id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
values (pg_temp.fixture(53), pg_temp.fixture(10), pg_temp.fixture(43), 'plan-d.pdf',
  concat_ws('/', pg_temp.fixture(10), pg_temp.fixture(43), pg_temp.fixture(53), 'plan-d.pdf'), 'application/pdf', 8, 1);
insert into public.takeoff_preparations(tenant_id, project_id, revision, draft, confirmed_snapshot, confirmed_at, confirmed_by, updated_by)
select pg_temp.fixture(10), pg_temp.fixture(22), 1, draft,
  jsonb_build_object('schema_version', 1, 'preparation_revision', 1, 'confirmed_by', pg_temp.fixture(1),
    'confirmed_at', '2026-11-20T00:00:00Z', 'readiness', '{"can_launch":true}'::jsonb, 'preparation', draft),
  '2026-11-20T00:00:00Z', pg_temp.fixture(1), pg_temp.fixture(1)
from (select jsonb_build_object('schema_version', 1,
    'destination', '{"kind":"analysis_only","estimate_version_id":null}'::jsonb,
    'processing', '{"level":"C","provider":"chatgpt"}'::jsonb,
    'sources', jsonb_build_array(jsonb_build_object('document_id', f.id, 'kind', 'plan', 'active', true, 'confirmed', true,
      'plan_set_id', f.plan_set_id, 'file_path', f.file_path, 'page_count', f.page_count, 'source_updated_at', f.updated_at))) as draft
  from public.plan_files f where f.id = pg_temp.fixture(53)) as plan;
select pg_temp.sign_in(1);
set local role authenticated;
select pg_temp.admit(66, 22, 43);
reset role;
select pg_temp.sign_out();
update public.takeoff_jobs set status = 'completed' where id = pg_temp.fixture(66);
insert into public.takeoff_results(id, tenant_id, job_id) values (pg_temp.fixture(76), pg_temp.fixture(10), pg_temp.fixture(66));
insert into public.takeoff_items(id, tenant_id, job_id, result_id, designation, quantity, unit, evidence, source_file_name,
  source_page, confidence, metadata)
values (pg_temp.fixture(87), pg_temp.fixture(10), pg_temp.fixture(66), pg_temp.fixture(76), 'Robinet d''arrêt', 2, 'u', null,
  'plan-d.pdf', 1, 0.95, jsonb_build_object('source_document', jsonb_build_object('kind', 'plan_file', 'plan_file_id', pg_temp.fixture(53)))),
  -- An estimated quantity the user chose to keep: its part says it is an hypothesis.
  (pg_temp.fixture(88), pg_temp.fixture(10), pg_temp.fixture(66), pg_temp.fixture(76), 'Gaine estimée', 4, 'm', 'Repère page 1',
  'plan-d.pdf', 1, 0.95, jsonb_build_object('quantity_nature', 'estimated',
    'source_document', jsonb_build_object('kind', 'plan_file', 'plan_file_id', pg_temp.fixture(53))));
update public.takeoff_items set is_excluded = false where id = pg_temp.fixture(88);
-- The override as the server builds it for the destination (send-server.ts overrideMetadata): each blocked line's state
-- once its rules are evaluated there, its coded reason and the justification stored once.
create function pg_temp.override_for(p_job integer) returns jsonb language sql as $$
  select jsonb_build_object('threshold', 0.5, 'blocked_item_ids', jsonb_agg(ti.id order by ti.id), 'blocked_items_count', count(*),
    'blocked_items_state', jsonb_agg(jsonb_build_object('item_id', ti.id, 'quantity', ti.quantity, 'unit', ti.unit,
      'updated_at', ti.updated_at, 'rule_failures', public.takeoff_rule_failure_keys(ti.rule_results), 'rules_stale', ti.rules_stale,
      'designation', ti.designation, 'evidence', ti.evidence, 'source_page', ti.source_page, 'is_verified', ti.is_verified,
      'quantity_entered_by', ti.quantity_entered_by) order by ti.id),
    'forced_justifications', jsonb_build_array('Preuve du robinet fournie par le maître d''œuvre (fictif).'),
    'forced_items', jsonb_agg(jsonb_build_object('item_id', ti.id, 'reason_code', 'additional_evidence', 'justification_index', 0)
      order by ti.id))
  from public.takeoff_items ti where ti.job_id = pg_temp.fixture(p_job) and ti.evidence is null
$$;
insert into commands values
  ('blocked', pg_temp.command(113, 66, pg_temp.first_draft(130), pg_temp.new_section(131))),
  ('forced', pg_temp.command(114, 66, pg_temp.first_draft(130), pg_temp.new_section(131), p_override => pg_temp.override_for(66)));
-- The administrator previews the forced send; a confirmation of that outcome without the override is refused.
insert into commands select 'blocked-by-admin', jsonb_set(body, '{request_id}', to_jsonb(pg_temp.fixture(115)))
from commands where name = 'blocked';
insert into commands select 'forced-by-engineer', jsonb_set(body, '{request_id}', to_jsonb(pg_temp.fixture(117)))
from commands where name = 'forced';
select pg_temp.sign_in(4);
set local role authenticated;
create temp table forced_shown as select pg_temp.preview('forced') as outcome;
select is(pg_temp.refusal($$select pg_temp.confirm('blocked-by-admin', (select outcome from forced_shown))$$),
  'P0001 TAKEOFF_APPLY_GUARD_FAILED', 'a line without evidence blocks a confirmation without an override');
reset role;
-- The engineer's preview of either is refused (the server computes none for a blocked line): their confirmations are.
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.preview('blocked')$$) ~ 'TAKEOFF_APPLY_GUARD_FAILED', true,
  'the engineer''s preview is refused');
select is(pg_temp.refusal($$select pg_temp.confirm('blocked', pg_temp.unseen())$$), 'P0001 TAKEOFF_APPLY_GUARD_FAILED',
  'a line without evidence blocks the engineer''s confirmation, and the created draft is rolled back');
select is(pg_temp.refusal($$select pg_temp.confirm('forced-by-engineer', pg_temp.unseen())$$), 'P0001 TAKEOFF_APPLY_GUARD_FAILED',
  'an engineer cannot force it');
reset role;
select is(pg_temp.counts(22), '{"versions":0,"lines":0,"receipts":0,"attached":0}'::jsonb, 'nothing is left of the refused sends');
select pg_temp.sign_in(4);
set local role authenticated;
select lives_ok($$select pg_temp.confirm('forced', (select outcome from forced_shown))$$,
  'an administrator forces it with a coded reason and a justification');
reset role;
select results_eq($$select i.title, trim_scale(i.quantity), i.source_metadata #>> '{takeoff_provision,sources,0,forced_reason}'
  from public.estimate_items i where i.version_id = pg_temp.fixture(130) and i.item_type = 'line' and i.title = 'Robinet d''arrêt'$$,
  $$values ('Robinet d''arrêt'::text, 2::numeric, 'additional_evidence'::text)$$, 'the forced line enters, marked with its reason');
select results_eq($$select audit.user_id, audit.estimate_version_id, audit.after_data #>> '{metadata,forced_items,0,reason_code}',
    (select count(*) from public.takeoff_apply_override_consumptions consumed where consumed.audit_log_id = audit.id)
  from public.audit_logs audit where audit.action = 'takeoff.apply.override' and audit.record_id = pg_temp.fixture(66)$$,
  $$values (pg_temp.fixture(4), pg_temp.fixture(130), 'additional_evidence'::text, 1::bigint)$$,
  'the override is traced against the created draft and consumed once');
select results_eq($$select part ->> 'takeoff_item_id', part #>> '{source,quantity_source}'
  from public.takeoff_send_receipts receipt cross join jsonb_array_elements(receipt.write_plan -> 'parts') as part
  where receipt.job_id = pg_temp.fixture(66) order by 1$$,
  $$values (pg_temp.fixture(87)::text, 'measured'::text), (pg_temp.fixture(88)::text, 'hypothesis:estimated'::text)$$,
  'each part says whether its quantity was measured or an hypothesis, and which');

-- 13. A receipt leaves with its takeoff (or its version, or its affaire), never on its own. (The copy's lines lose
-- their source takeoff through the version's writer, as the estimate's own deletions do.)
select set_config('miaouffrage.estimate_v3_writer', (select receipt ->> 'target_version_id' from copy_receipt), true);
select lives_ok($$delete from public.takeoff_jobs where id = pg_temp.fixture(63)$$, 'the sent takeoff of the copy is deleted');
select is((select count(*) from public.takeoff_send_receipts where job_id = pg_temp.fixture(63)), 0::bigint,
  'its receipt left with it');

select * from finish();
rollback;
