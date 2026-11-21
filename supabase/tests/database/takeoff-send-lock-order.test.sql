-- Lot 2 M2 (migration …_takeoff_send_receipts.sql): the send and its preview against the estimate editor and the end of an
-- analysis, in two sessions. Each case holds one transaction at a named point, proves the other session waits for it (its
-- blocking process), lets it go, then reads what both did.
-- 1. The editor's acquisition of the draft's lease, stopped between its advisory lock and its foreign-key check (an
--    expired lease being cleaned up holds its unique key), then a preview of the draft: the preview waits for the editor
--    on the editor's own key, and is told the draft is open (red on 2ad71cfb: the preview held the version row and then
--    waited for that key, the editor's foreign key waited for the row, one of the two was aborted).
-- 2. The reverse: a preview holding the draft, stopped on the takeoff's rule lock, then the editor's acquisition: the
--    editor waits for the preview, and both complete (red on 2ad71cfb: the same deadlock).
-- 3. A preview never makes an editor's write fail, and waits a bounded time: another member writing in the draft gets
--    the preview refused at once, without the preview taking anything the write needs; the member's own write in flight
--    makes the preview answer that the estimate is being modified, within its short lock timeout (red on 2ad71cfb: the
--    preview waited behind the write without bound).
-- 4. The end of an analysis of another takeoff of the draft, with the notices activated, and a send of the same draft:
--    the worker holds the draft's rule lock and inserts its notice (a foreign key to the affaire); the send holds the
--    affaire and waits for the rule lock. Both complete (red on 2ad71cfb: the send held the affaire FOR UPDATE, the
--    notice's key-share lock waited for it, and the two deadlocked). The send is then told the draft gained a takeoff
--    since its preview; previewed again, it is sent.
-- Isolation justified: these interleavings exist only across two sessions, which no journey drives deterministically.
-- The held transactions are stopped at named points, never slept on. All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.fx(n integer) returns uuid language sql immutable as $$
  select ('d3b00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.engineer() returns uuid language sql immutable as $$ select 'd3b00000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.admin() returns uuid language sql immutable as $$ select 'd3b00000-0000-4000-8000-000000000002'::uuid $$;

create temp table lock_order_connection as select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()) as connection;
-- lock_setup holds the named points as the database owner; lock_stage stages commands as the server's service does;
-- lock_member is the engineer who previews and sends; lock_editor is the administrator's estimate editor; lock_worker
-- is the Mac's worker.
select is(extensions.dblink_connect(session.name, (select connection from lock_order_connection)), 'OK', format('%s connected', session.name))
from (values ('lock_setup'), ('lock_stage'), ('lock_member'), ('lock_editor'), ('lock_worker')) as session(name);

-- One engineer who owns the affaire, one administrator of the same tenant, three takeoffs of the affaire read on three
-- plans (one preparation revision each), admitted without a version as M1 admits them, then completed.
select is(extensions.dblink_exec('lock_setup', $setup$
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', 'd3b00000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'send-lock-order@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'd3b00000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
  'send-lock-order-admin@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
update public.tenant_memberships set role = 'engineer'::public.tenant_role where user_id = 'd3b00000-0000-4000-8000-000000000001';
update public.tenant_memberships set is_default = false where user_id = 'd3b00000-0000-4000-8000-000000000002';
insert into public.tenant_memberships (tenant_id, user_id, role, is_default)
select m.tenant_id, 'd3b00000-0000-4000-8000-000000000002', 'admin'::public.tenant_role, true
from public.tenant_memberships m where m.user_id = 'd3b00000-0000-4000-8000-000000000001' and m.is_default;
insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
select 'd3b00000-0000-4000-8000-000000000010', m.tenant_id, m.user_id, 'Ordre des verrous (fictif)', false
from public.tenant_memberships m where m.user_id = 'd3b00000-0000-4000-8000-000000000001' and m.is_default;
insert into public.plan_sets (id, tenant_id, project_id, name)
select plan.set_id, m.tenant_id, 'd3b00000-0000-4000-8000-000000000010', 'Plans fictifs ' || plan.n
from public.tenant_memberships m cross join (values
  (11, 'd3b00000-0000-4000-8000-000000000111'::uuid), (12, 'd3b00000-0000-4000-8000-000000000112'::uuid),
  (13, 'd3b00000-0000-4000-8000-000000000113'::uuid)) as plan(n, set_id)
where m.user_id = 'd3b00000-0000-4000-8000-000000000001' and m.is_default;
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select ('d3b00000-0000-4000-8000-000000000' || (200 + s.n))::uuid, s.tenant_id, s.id, 'plan-' || s.n || '.pdf',
  concat_ws('/', s.tenant_id, s.id, 'd3b00000-0000-4000-8000-000000000' || (200 + s.n), 'plan-' || s.n || '.pdf'), 'application/pdf', 8, 1
from (select set_row.*, substr(set_row.id::text, 34)::integer - 100 as n from public.plan_sets set_row
  where set_row.id::text like 'd3b00000-%') as s;
commit;
$setup$), 'COMMIT', 'members, the affaire and its plans committed');

create function pg_temp.act_as(p_session text, p_member uuid) returns text language sql as $$
  select claims.sub from extensions.dblink(p_session, format($claims$select set_config('request.jwt.claims',
    %L, false), set_config('request.jwt.claim.sub', %L, false)$claims$,
    jsonb_build_object('role', 'authenticated', 'sub', p_member)::text, p_member)) as claims(full_claims text, sub text)
$$;
select is(extensions.dblink_exec(session.name, 'set role authenticated'), 'SET', format('%s acts as a member', session.name))
from (values ('lock_setup'), ('lock_member'), ('lock_editor')) as session(name);
select is(pg_temp.act_as('lock_setup', pg_temp.engineer()), pg_temp.engineer()::text, 'the fixture session carries the engineer''s claims');
select is(pg_temp.act_as('lock_member', pg_temp.engineer()), pg_temp.engineer()::text, 'the member''s session is the engineer''s');
select is(pg_temp.act_as('lock_editor', pg_temp.admin()), pg_temp.admin()::text, 'the editor''s session is the administrator''s');

-- Each takeoff: its preparation confirmed, admitted, then completed with one washbasin line read on its plan.
create function pg_temp.prepare_and_admit(p_job integer, p_set integer, p_revision integer, p_quantity integer)
returns void language plpgsql as $$
declare
  draft jsonb;
begin
  select jsonb_build_object('schema_version', 1, 'destination', '{"kind":"analysis_only","estimate_version_id":null}'::jsonb,
      'processing', '{"level":"C","provider":"chatgpt"}'::jsonb,
      'sources', jsonb_build_array(jsonb_build_object('document_id', f.id, 'kind', 'plan', 'active', true, 'confirmed', true,
        'plan_set_id', f.plan_set_id, 'file_path', f.file_path, 'page_count', f.page_count, 'source_updated_at', f.updated_at)))
    into draft
  from public.plan_files f where f.plan_set_id = pg_temp.fx(100 + p_set);
  perform extensions.dblink_exec('lock_setup', 'reset role');
  perform extensions.dblink_exec('lock_setup', format($prep$
    insert into public.takeoff_preparations (tenant_id, project_id, revision, draft, confirmed_snapshot, confirmed_at, confirmed_by, updated_by)
    select m.tenant_id, %1$L, %2$s, %3$L::jsonb, jsonb_build_object('schema_version', 1, 'preparation_revision', %2$s,
      'confirmed_by', m.user_id, 'confirmed_at', '2026-11-20T00:00:00Z', 'readiness', '{"can_launch":true}'::jsonb,
      'preparation', %3$L::jsonb), '2026-11-20T00:00:00Z', m.user_id, m.user_id
    from public.tenant_memberships m where m.user_id = 'd3b00000-0000-4000-8000-000000000001' and m.is_default
    on conflict (tenant_id, project_id) do update set revision = excluded.revision, draft = excluded.draft,
      confirmed_snapshot = excluded.confirmed_snapshot$prep$, pg_temp.fx(10), p_revision, draft));
  perform extensions.dblink_exec('lock_setup', 'set role authenticated');
  perform 1 from extensions.dblink('lock_setup', format($admit$
    select null::text from public.admit_prepared_takeoff_job(jsonb_build_object('id', %1$L, 'tenant_id',
      (select tenant_id from public.estimate_projects where id = %2$L), 'project_id', %2$L, 'plan_set_id', %3$L, 'level', 'C',
      'created_by', 'd3b00000-0000-4000-8000-000000000001', 'execution_provider', 'chatgpt_local',
      'execution_host_id', 'urn:uuid:d3b00000-0000-4000-8000-000000000090', 'processing_strategy', 'sync',
      'preparation_snapshot', (select confirmed_snapshot from public.takeoff_preparations where project_id = %2$L)))$admit$,
    pg_temp.fx(p_job), pg_temp.fx(10), pg_temp.fx(100 + p_set))) as admitted(nothing text);
  perform extensions.dblink_exec('lock_setup', 'reset role');
  perform extensions.dblink_exec('lock_setup', format($done$
    update public.takeoff_jobs set status = 'completed' where id = %1$L;
    insert into public.takeoff_results (id, tenant_id, job_id) select %2$L, tenant_id, id from public.takeoff_jobs where id = %1$L;
    insert into public.takeoff_items (id, tenant_id, job_id, result_id, designation, quantity, unit, evidence, source_file_name,
      source_page, confidence, metadata)
    select %3$L, j.tenant_id, j.id, %2$L, 'Lavabo', %4$s, 'u', 'Repère fictif', f.file_name, 1, 0.95,
      jsonb_build_object('source_document', jsonb_build_object('kind', 'plan_file', 'plan_file_id', f.id))
    from public.takeoff_jobs j join public.plan_files f on f.plan_set_id = j.plan_set_id where j.id = %1$L$done$,
    pg_temp.fx(p_job), pg_temp.fx(p_job + 300), pg_temp.fx(p_job + 400), p_quantity));
  perform extensions.dblink_exec('lock_setup', 'set role authenticated');
end;
$$;
select pg_temp.prepare_and_admit(11, 11, 1, 3);
select pg_temp.prepare_and_admit(12, 12, 2, 2);
select pg_temp.prepare_and_admit(13, 13, 3, 1);
select is((select count(*)::integer from public.takeoff_jobs where id::text like 'd3b00000-%' and status = 'completed'
  and estimate_version_id is null), 3, 'three versionless takeoffs are ready to send');

-- The command as the server builds it after its preview, from the committed state.
create function pg_temp.command(p_job integer, p_destination jsonb, p_section jsonb) returns jsonb language sql as $$
  select jsonb_build_object('format_version', 1, 'mode', 'dry_run', 'request_id', gen_random_uuid(), 'job_id', j.id,
    'fingerprint', repeat('d', 64), 'destination', p_destination, 'section', p_section,
    'client', jsonb_build_object('fingerprint', repeat('d', 64), 'destination', p_destination - 'version_payload',
      'section', p_section - 'id', 'page_decisions', '[]'::jsonb, 'override', false),
    'expected', jsonb_build_object(
      'versions', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'status', v.status, 'updated_at', v.updated_at)
        order by v.id), '[]'::jsonb) from public.estimate_versions v where v.project_id = j.project_id),
      'job_stamp', public.takeoff_rule_job_stamp(j.tenant_id, j.project_id, j.id),
      'peers_stamp', case when p_destination ->> 'kind' = 'existing_draft'
        then public.takeoff_send_peers_stamp(j.tenant_id, (p_destination ->> 'version_id')::uuid) end,
      'mapping_stamp', public.takeoff_mapping_rules_stamp(j.tenant_id)),
    'mapping_plan', (select jsonb_agg(jsonb_build_object('item_id', i.id, 'source_order', 0, 'rule_id', null, 'action', 'none',
      'designation', i.designation, 'unit_price_cents', null, 'category_id', null, 'assembly_id', null))
      from public.takeoff_items i where i.job_id = j.id),
    'page_decisions', '[]'::jsonb, 'rule_results', '[]'::jsonb, 'rule_transforms', '[]'::jsonb, 'accumulations', '[]'::jsonb,
    'override', null, 'price_rules_ignored', '[]'::jsonb, 'expected_outcome', null)
  from public.takeoff_jobs j where j.id = pg_temp.fx(p_job)
$$;
create function pg_temp.to_draft(p_job integer) returns jsonb language sql as $$
  select pg_temp.command(p_job, jsonb_build_object('kind', 'existing_draft', 'version_id', pg_temp.fx(601)),
    jsonb_build_object('kind', 'existing', 'id', pg_temp.fx(701)))
$$;
create function pg_temp.request(p_command jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object('request_id', p_command -> 'request_id', 'job_id', p_command -> 'job_id', 'fingerprint', p_command -> 'fingerprint')
$$;
-- Stages a command as the service does (committed, before the member's session sends it), and returns the call of its
-- request by the member's session.
create function pg_temp.staged_call(p_command jsonb) returns text language plpgsql as $$
begin
  perform 1 from extensions.dblink('lock_stage', format('select public.stage_takeoff_send(%L, %L::jsonb)::text',
    pg_temp.engineer(), p_command)) as staged(result text);
  return format('select public.send_takeoff_job(%L::jsonb)::text', pg_temp.request(p_command));
end;
$$;
-- The preview, then its confirmation: the dry run of the command shows its outcome; the command is confirmed with it.
create function pg_temp.confirmed(p_command jsonb) returns jsonb language plpgsql as $$
declare
  shown jsonb;
begin
  select answer.body::jsonb -> 'outcome' into shown from extensions.dblink('lock_member', pg_temp.staged_call(p_command))
    as answer(body text);
  if shown is null or jsonb_typeof(shown) <> 'object' then
    raise exception 'the preview of % showed no outcome', p_command ->> 'job_id';
  end if;
  return p_command || jsonb_build_object('request_id', gen_random_uuid(), 'mode', 'send', 'expected_outcome', shown);
end;
$$;
create function pg_temp.staged_rows(p_command jsonb) returns bigint language sql as $$
  select count(*) from private.takeoff_send_commands where request_id = (p_command ->> 'request_id')::uuid
$$;

create temp table lock_order_pids(label text primary key, pid integer);
insert into lock_order_pids
select session.name, (select backend.pid from extensions.dblink(session.name, 'select pg_backend_pid()') as backend(pid integer))
from (values ('lock_setup'), ('lock_member'), ('lock_editor'), ('lock_worker')) as session(name);
-- Waits until one session is blocked by another (a condition, bounded), and says whether it is.
create function pg_temp.waits_for(p_waiting text, p_holding text) returns boolean language plpgsql as $$
declare
  waiting integer := (select pid from lock_order_pids where label = p_waiting);
  holding integer := (select pid from lock_order_pids where label = p_holding);
begin
  for attempt in 1..400 loop
    if holding = any(pg_catalog.pg_blocking_pids(waiting)) then return true; end if;
    perform pg_catalog.pg_sleep(0.025);
  end loop;
  return false;
end;
$$;
-- Waits until a session's query has answered (a condition, bounded), and says whether it has.
create function pg_temp.answered(p_session text) returns boolean language plpgsql as $$
begin
  for attempt in 1..400 loop
    if extensions.dblink_is_busy(p_session) = 0 then return true; end if;
    perform pg_catalog.pg_sleep(0.025);
  end loop;
  return false;
end;
$$;
-- A lease of V1 as the editor's acquisition inserts it (its session returned when the editor waits for it).
create function pg_temp.lease_sql(p_member uuid, p_session integer, p_expires text, p_returning boolean default false)
returns text language sql immutable as $$
  select format($lease$insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
    select %1$L, %2$L, tenant_id, now() + %3$L::interval, %4$L from public.estimate_versions where id = %1$L%5$s$lease$,
    pg_temp.fx(601), p_member, p_expires, pg_temp.fx(p_session), case when p_returning then ' returning session_id::text' else '' end)
$$;

-- The draft: takeoff 11 sent to the affaire's first draft V1 (601), its section 701.
create temp table commands (name text primary key, body jsonb);
insert into commands values ('11', pg_temp.confirmed(pg_temp.command(11, jsonb_build_object('kind', 'first_draft', 'version_payload',
  jsonb_build_object('id', pg_temp.fx(601), 'title', null, 'date_devis', '2026-11-21', 'validite_jours', 30, 'margin_multiplier', 1,
    'margin_mode', 'fixed', 'currency', 'EUR', 'margin_bp', 0, 'discount_bp', 0, 'discount_amount_cents', null,
    'discount_mode', 'simple', 'discount_steps', '[]'::jsonb, 'global_coefficient', 1, 'tax_rate_bp', 2000,
    'rounding_mode', 'none', 'rounding_step_cents', 1, 'max_section_depth', 3, 'contractor_role', 'principal',
    'calc_engine_version', 3, 'gross_ht_cents', 0, 'discount_applied_cents', 0, 'commercial_rounding_cents', 0,
    'total_ht_cents', 0, 'total_tax_cents', 0, 'total_ttc_cents', 0)),
  jsonb_build_object('kind', 'new', 'id', pg_temp.fx(701), 'title', 'Métré fictif'))));
select is((select (x.receipt::jsonb ->> 'replayed') from extensions.dblink('lock_member',
  pg_temp.staged_call((select body from commands where name = '11'))) as x(receipt text)), 'false', 'takeoff 11 creates the draft V1');
select is(extensions.dblink_exec('lock_setup', 'reset role'), 'RESET', 'the fixture session holds its points as the owner');

-- 1. The administrator opens V1 in the editor while an expired lease of theirs is being cleaned up: their acquisition
-- holds V1's lease key and waits on the unique key of the row being deleted. The engineer previews takeoff 12 to V1.
select is(extensions.dblink_exec('lock_setup', pg_temp.lease_sql(pg_temp.admin(), 801, '-1 minute')), 'INSERT 0 1',
  'an expired lease of the administrator is on V1');
select is(extensions.dblink_exec('lock_setup', 'begin'), 'BEGIN', 'a cleanup of expired leases starts');
select is(extensions.dblink_exec('lock_setup', format('delete from public.draft_locks where version_id = %L', pg_temp.fx(601))),
  'DELETE 1', 'it deletes the expired lease, not yet committed');
select is(extensions.dblink_send_query('lock_editor', pg_temp.lease_sql(pg_temp.admin(), 802, '5 minutes', true)), 1,
  'the administrator''s editor acquires V1''s lease');
select ok(pg_temp.waits_for('lock_editor', 'lock_setup'),
  'the acquisition took V1''s lease key and waits before its foreign-key check, on the row being deleted');
insert into commands values ('12-while-acquired', pg_temp.to_draft(12));
select is(extensions.dblink_send_query('lock_member', pg_temp.staged_call((select body from commands where name = '12-while-acquired'))),
  1, 'the engineer previews takeoff 12 to V1');
select ok(pg_temp.waits_for('lock_member', 'lock_editor'), 'the preview waits for the editor, on V1''s lease key');
select is(extensions.dblink_exec('lock_setup', 'commit'), 'COMMIT', 'the cleanup commits');
select is((select x.session_id from extensions.dblink_get_result('lock_editor', false) as x(session_id text)), pg_temp.fx(802)::text,
  'the editor holds V1''s lease: its acquisition did not fail');
select is((select count(*)::integer from extensions.dblink_get_result('lock_editor', false) as x(session_id text)), 0, 'the editor is done');
create temp table answers (name text primary key, body jsonb);
insert into answers select '1', x.body::jsonb from extensions.dblink_get_result('lock_member', false) as x(body text);
select diag(concat('case 1, preview: ', extensions.dblink_error_message('lock_member'), '; editor: ',
  extensions.dblink_error_message('lock_editor')));
select is((select body #>> '{error,message}' from answers where name = '1'), 'TAKEOFF_SEND_DRAFT_LOCKED',
  'the preview answers that the draft is open by another member, as an answer, not a database error');
select is((select count(*)::integer from extensions.dblink_get_result('lock_member', false) as x(body text)), 0, 'the preview is done');
select is(pg_temp.staged_rows((select body from commands where name = '12-while-acquired')), 0::bigint,
  'the preview leaves no staged command');
select is(extensions.dblink_exec('lock_setup', format('delete from public.draft_locks where version_id = %L', pg_temp.fx(601))),
  'DELETE 1', 'the administrator leaves the editor');

-- 2. The reverse: the engineer's preview of takeoff 12 holds V1 and stops on the takeoff's rule lock (held here); the
-- administrator then opens V1 in the editor.
select is(extensions.dblink_exec('lock_setup', 'begin'), 'BEGIN', 'the fixture session starts');
select is((select x.held from extensions.dblink('lock_setup', format(
  'select pg_advisory_xact_lock(hashtextextended(%L, 0))::text', 'takeoff-job-rules:' || pg_temp.fx(12))) as x(held text)), '',
  'it holds takeoff 12''s rule lock');
insert into commands values ('12-before-editor', pg_temp.to_draft(12));
select is(extensions.dblink_send_query('lock_member', pg_temp.staged_call((select body from commands where name = '12-before-editor'))),
  1, 'the engineer previews takeoff 12 to V1');
select ok(pg_temp.waits_for('lock_member', 'lock_setup'), 'the preview holds V1 and waits on the takeoff''s rule lock');
select is(extensions.dblink_send_query('lock_editor', pg_temp.lease_sql(pg_temp.admin(), 803, '5 minutes', true)), 1,
  'the administrator''s editor acquires V1''s lease');
select ok(pg_temp.waits_for('lock_editor', 'lock_member'), 'the editor waits for the preview');
select is(extensions.dblink_exec('lock_setup', 'commit'), 'COMMIT', 'the rule lock is released');
insert into answers select '2', x.body::jsonb from extensions.dblink_get_result('lock_member', false) as x(body text);
select diag(concat('case 2, preview: ', extensions.dblink_error_message('lock_member')));
select results_eq($$select body ->> 'dry_run', body #>> '{outcome,lines,0,title}', body ? 'error' from answers where name = '2'$$,
  $$values ('true'::text, 'Lavabo'::text, false)$$, 'the preview completes and shows its outcome');
select is((select count(*)::integer from extensions.dblink_get_result('lock_member', false) as x(body text)), 0, 'the preview is done');
select is((select x.session_id from extensions.dblink_get_result('lock_editor', false) as x(session_id text)), pg_temp.fx(803)::text,
  'the editor then holds V1''s lease: no deadlock');
select diag(concat('case 2, editor: ', extensions.dblink_error_message('lock_editor')));
select is((select count(*)::integer from extensions.dblink_get_result('lock_editor', false) as x(session_id text)), 0, 'the editor is done');
select is(pg_temp.staged_rows((select body from commands where name = '12-before-editor')), 0::bigint,
  'the preview leaves no staged command');

-- 3. The administrator, holding V1's lease, saves in the editor: the save holds V1's row, the affaire as its saves read
-- it, its lease and V1's lines, as public.commit_estimate_batch takes them. The engineer's preview is refused at once,
-- and the save commits.
select is(extensions.dblink_exec('lock_setup', format('delete from public.draft_locks where version_id = %L', pg_temp.fx(601))),
  'DELETE 1', 'V1 has no other lease');
select is(extensions.dblink_exec('lock_setup', pg_temp.lease_sql(pg_temp.admin(), 805, '30 minutes')), 'INSERT 0 1',
  'the administrator holds V1''s lease');
select is(extensions.dblink_exec('lock_editor', 'reset role'), 'RESET', 'the editor''s save runs as the owner here');
select is(extensions.dblink_exec('lock_editor', 'begin'), 'BEGIN', 'the administrator''s save starts');
select is((select count(*)::integer from extensions.dblink('lock_editor', format(
  'select 1 from public.estimate_versions where id = %L for update', pg_temp.fx(601))) as x(one integer)), 1, 'the save holds V1');
select is((select count(*)::integer from extensions.dblink('lock_editor', format(
  'select 1 from public.estimate_projects where id = %L for share nowait', pg_temp.fx(10))) as x(one integer)), 1,
  'and the affaire, as its saves read it');
select is((select count(*)::integer from extensions.dblink('lock_editor', format(
  'select 1 from public.draft_locks where version_id = %L for update nowait', pg_temp.fx(601))) as x(one integer)), 1,
  'and its lease');
select is((select count(*)::integer from extensions.dblink('lock_editor', format(
  'select 1 from public.estimate_items where version_id = %L order by id for update nowait', pg_temp.fx(601))) as x(one integer)), 2,
  'and V1''s section and line');
insert into commands values ('12-while-saved', pg_temp.to_draft(12));
select is(extensions.dblink_send_query('lock_member', pg_temp.staged_call((select body from commands where name = '12-while-saved'))),
  1, 'the engineer previews takeoff 12 to V1 during the save');
create temp table observed (name text primary key, answered boolean);
insert into observed values ('3', pg_temp.answered('lock_member'));
select is(extensions.dblink_exec('lock_editor', 'commit'), 'COMMIT', 'the save commits');
select ok((select answered from observed where name = '3'), 'the preview answered while the save was still open');
insert into answers select '3', x.body::jsonb from extensions.dblink_get_result('lock_member', false) as x(body text);
select is((select body #>> '{error,message}' from answers where name = '3'), 'TAKEOFF_SEND_DRAFT_LOCKED',
  'it is told the draft is open by another member');
select is((select count(*)::integer from extensions.dblink_get_result('lock_member', false) as x(body text)), 0, 'the preview is done');
select is(extensions.dblink_exec('lock_editor', 'set role authenticated'), 'SET', 'the editor acts as the administrator again');
select is(extensions.dblink_exec('lock_setup', format('delete from public.draft_locks where version_id = %L', pg_temp.fx(601))),
  'DELETE 1', 'the administrator leaves the editor');
-- The engineer has V1 open in another tab, whose save is in flight (it holds V1's row): the preview waits a bounded time
-- and answers that the estimate is being modified.
select is(extensions.dblink_exec('lock_setup', pg_temp.lease_sql(pg_temp.engineer(), 804, '30 minutes')), 'INSERT 0 1',
  'the engineer holds V1''s lease in another tab');
select is(extensions.dblink_exec('lock_editor', 'reset role'), 'RESET', 'that tab''s save runs as the owner here');
select is(extensions.dblink_exec('lock_editor', 'begin'), 'BEGIN', 'the save of the other tab starts');
select is((select count(*)::integer from extensions.dblink('lock_editor', format(
  'select 1 from public.estimate_versions where id = %L for update', pg_temp.fx(601))) as x(one integer)), 1, 'it holds V1');
insert into commands values ('12-own-save', pg_temp.to_draft(12));
select is(extensions.dblink_send_query('lock_member', pg_temp.staged_call((select body from commands where name = '12-own-save'))),
  1, 'the engineer previews takeoff 12 to V1 meanwhile');
insert into observed values ('3-own', pg_temp.answered('lock_member'));
select is(extensions.dblink_exec('lock_editor', 'commit'), 'COMMIT', 'the save of the other tab commits');
select ok((select answered from observed where name = '3-own'), 'the preview answered while the save was still open: its wait is bounded');
insert into answers select '3-own', x.body::jsonb from extensions.dblink_get_result('lock_member', false) as x(body text);
select is((select body #>> '{error,code}' from answers where name = '3-own'), '55P03',
  'it answers that something it needs is busy');
select isnt((select body #>> '{error,message}' from answers where name = '3-own'), 'TAKEOFF_SEND_DRAFT_LOCKED',
  'not that another member holds the draft');
select is((select count(*)::integer from extensions.dblink_get_result('lock_member', false) as x(body text)), 0, 'the preview is done');
select is(extensions.dblink_exec('lock_editor', 'set role authenticated'), 'SET', 'the editor acts as the administrator again');
select is(pg_temp.staged_rows((select body from commands where name = '12-own-save')), 0::bigint,
  'the preview leaves no staged command');

-- 4. The Mac ends a takeoff attached to V1 whose line carries rule inputs, once the notices are activated, while the
-- engineer sends takeoff 13 to V1. The worker is stopped on V1's rule lock (held here) before it publishes its notice;
-- the send holds the affaire and waits for the same lock behind it.
select is(extensions.dblink_exec('lock_setup', format($worker$
begin;
insert into private.takeoff_completion_activation (active_from) values (now() - interval '2 hours');
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, created_by, execution_provider, execution_host_id)
select %1$L, tenant_id, %2$L, 'A', 'd3b00000-0000-4000-8000-000000000001', 'chatgpt_local',
  'urn:uuid:d3b00000-0000-4000-8000-000000000090'
from public.estimate_versions where id = %2$L;
select count(*) from public.claim_local_takeoff_job(%1$L, (select tenant_id from public.estimate_versions where id = %2$L),
  'urn:uuid:d3b00000-0000-4000-8000-000000000090', now(), %3$L, now() + interval '1 hour', 'fixture', 'fixture');
commit;
$worker$, pg_temp.fx(50), pg_temp.fx(601), pg_temp.fx(51))), 'COMMIT', 'the cut-off is set and the Mac works on a takeoff of V1');
select is((select status::text from public.takeoff_jobs where id = pg_temp.fx(50)), 'processing', 'the takeoff is being processed');
insert into commands values ('13', pg_temp.confirmed(pg_temp.to_draft(13)));
select is(extensions.dblink_exec('lock_setup', 'begin'), 'BEGIN', 'the fixture session starts');
select is((select x.held from extensions.dblink('lock_setup', format(
  'select pg_advisory_xact_lock(hashtextextended(%L, 0))::text', 'takeoff-rules:' || pg_temp.fx(601))) as x(held text)), '',
  'it holds V1''s rule lock');
select is(extensions.dblink_exec('lock_worker', 'set role service_role'), 'SET', 'the worker writes as the service');
select is(extensions.dblink_send_query('lock_worker', format($finish$
  select public.finalize_local_takeoff_result(%1$L, (select tenant_id from public.takeoff_jobs where id = %1$L), %2$L,
    clock_timestamp(), 'fixture', 'fixture',
    '{"extracted_json": {"items": [{"designation":"Douche"}]}, "warnings": [], "tables": [], "provider_meta": {}}',
    '[{"designation":"Douche", "quantity": 1, "unit":"u", "metadata": {}, "is_excluded": false, "rules_stale": true}]')::text
$finish$, pg_temp.fx(50), pg_temp.fx(51))), 1, 'the Mac ends its analysis');
select ok(pg_temp.waits_for('lock_worker', 'lock_setup'), 'the worker waits for V1''s rule lock');
select is(extensions.dblink_send_query('lock_member', pg_temp.staged_call((select body from commands where name = '13'))), 1,
  'the engineer confirms takeoff 13''s send to V1');
select ok(pg_temp.waits_for('lock_member', 'lock_setup'), 'the send holds the affaire and waits for V1''s rule lock');
select is(extensions.dblink_exec('lock_setup', 'commit'), 'COMMIT', 'the rule lock is released');
select isnt((select x.result from extensions.dblink_get_result('lock_worker', false) as x(result text)), null,
  'the end of the analysis completes');
select is((select count(*)::integer from extensions.dblink_get_result('lock_worker', false) as x(result text)), 0, 'the worker is done');
insert into answers select '4', x.body::jsonb from extensions.dblink_get_result('lock_member', false) as x(body text);
select diag(concat('case 4, send: ', extensions.dblink_error_message('lock_member')));
select ok(extensions.dblink_error_message('lock_member') ~ 'TAKEOFF_SEND_PREVIEW_STALE.*"reason": "estimate_changed"',
  'the send completes with its answer, not a deadlock: the draft gained a takeoff since its preview, preview again');
select is((select count(*)::integer from extensions.dblink_get_result('lock_member', false) as x(body text)), 0, 'the send is done');
select results_eq($$select status::text, (select count(*) from public.takeoff_completion_notifications n
    where n.job_id = pg_temp.fx(50)) from public.takeoff_jobs where id = pg_temp.fx(50)$$,
  $$values ('completed'::text, 1::bigint)$$, 'the analysis ended and published its notice');
insert into commands values ('13-again', pg_temp.confirmed(pg_temp.to_draft(13)));
select is((select (x.receipt::jsonb ->> 'replayed') from extensions.dblink('lock_member',
  pg_temp.staged_call((select body from commands where name = '13-again'))) as x(receipt text)), 'false',
  'previewed again, takeoff 13 is sent to V1');
select is((select estimate_version_id from public.takeoff_jobs where id = pg_temp.fx(13)), pg_temp.fx(601), 'it is on V1');

-- Clean the committed synthetic fixtures of this disposable database, as takeoff-send-race.test.sql does, and the cut-off.
select is(extensions.dblink_exec('lock_setup', $cleanup$
begin;
set local session_replication_role = replica;
do $clean$
declare
  target uuid;
  entry record;
begin
  for target in select distinct m.tenant_id from public.tenant_memberships m
    where m.user_id in ('d3b00000-0000-4000-8000-000000000001', 'd3b00000-0000-4000-8000-000000000002')
  loop
    for entry in
      select columns.table_schema, columns.table_name
      from information_schema.columns as columns
      join information_schema.tables as tables
        on tables.table_schema = columns.table_schema and tables.table_name = columns.table_name
      where columns.table_schema in ('public', 'private') and columns.column_name = 'tenant_id'
        and tables.table_type = 'BASE TABLE' and not (columns.table_schema = 'public' and columns.table_name = 'tenants')
    loop
      execute format('delete from %I.%I where tenant_id = $1', entry.table_schema, entry.table_name) using target;
    end loop;
    delete from public.tenants where id = target;
  end loop;
end
$clean$;
delete from private.takeoff_local_job_work where job_id::text like 'd3b00000-%';
delete from private.takeoff_completion_activation;
delete from public.profiles where id in ('d3b00000-0000-4000-8000-000000000001', 'd3b00000-0000-4000-8000-000000000002');
delete from auth.users where id in ('d3b00000-0000-4000-8000-000000000001', 'd3b00000-0000-4000-8000-000000000002');
commit;
$cleanup$), 'COMMIT', 'synthetic fixtures and the cut-off cleaned');
select is((select count(*)::integer from public.takeoff_jobs where id::text like 'd3b00000-%'), 0, 'no fixture job is left');
select is((select count(*)::integer from private.takeoff_completion_activation), 0, 'the database is left without a cut-off');
select is(extensions.dblink_disconnect(session.name), 'OK', format('%s disconnected', session.name))
from (values ('lock_setup'), ('lock_stage'), ('lock_member'), ('lock_editor'), ('lock_worker')) as session(name);
select * from finish();
rollback;
