-- The worker has its model response. A second session is committing a new category.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
select dblink_connect('editor',format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'),',',1)),current_setting('port'),current_database()));
select dblink_exec('editor',$setup$
  create function pg_temp.f(n integer) returns uuid language sql immutable as
    'select (''ae570000-0000-4000-8000-''||lpad(n::text,12,''0''))::uuid';
  begin;
  insert into auth.users(id,email,email_confirmed_at) values(pg_temp.f(1),'intake-publication-race@example.test',now());
  insert into public.estimate_projects(id,tenant_id,user_id,name)
    select pg_temp.f(20),tenant_id,user_id,'Fixture' from public.tenant_memberships where user_id=pg_temp.f(1) and is_default;
  insert into public.affaire_intake_uploads(id,project_id,created_by,status,processing_lease_token,processing_lease_expires_at)
    values(pg_temp.f(30),pg_temp.f(20),pg_temp.f(1),'processing',pg_temp.f(60),now()+interval '10 minutes');
  insert into public.affaire_intake_documents(id,upload_id,file_name,upload_status,classification_status,document_kind)
    values(pg_temp.f(40),pg_temp.f(30),'Exemple.pdf','uploaded','classified','plans');
  commit;
$setup$);
create temp table model_input as select public.read_affaire_intake_brief_inputs('ae570000-0000-4000-8000-000000000020')->>'revision' revision;
grant select on model_input to service_role;
create function pg_temp.publish() returns uuid language sql as $$
  select public.publish_affaire_intake_brief('ae570000-0000-4000-8000-000000000030','ae570000-0000-4000-8000-000000000060',
    null,revision,null,'{"summary":"Résultat du plan","project_object":"Fixture"}','[]') from model_input
$$;
select dblink_exec('editor',$edit$
  begin;
  update public.affaire_intake_documents set document_kind='cctp' where id=pg_temp.f(40);
$edit$);
set local role service_role;
set local lock_timeout='200ms';
select throws_ok('select pg_temp.publish()','40001','INTAKE_BRIEF_INPUT_CHANGED','an uncommitted input change makes the publication retry');
reset role;
select dblink_exec('editor','commit');
set local role service_role;
select throws_ok('select pg_temp.publish()','40001','INTAKE_BRIEF_INPUT_CHANGED','after the edit commits, the held response cannot publish');
select is((select count(*) from public.affaire_briefs where project_id='ae570000-0000-4000-8000-000000000020'),0::bigint,'no stale draft was offered');
reset role;

-- The confirming session has acquired the existing brief. Let the publisher actually
-- wait on it, then continue the real confirmation RPC in the same transaction.
select dblink_connect('publisher',format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'),',',1)),current_setting('port'),current_database()));
select dblink_exec('editor',$prepare$
  insert into public.affaire_briefs(project_id,upload_id,status,summary,project_object)
    values(pg_temp.f(20),pg_temp.f(30),'a_confirmer','Ancien','Fixture');
  create function pg_temp.confirm() returns text language plpgsql as $$
  begin
    return (select outcome from public.confirm_affaire_brief_takeoff(
      (select tenant_id from public.estimate_projects where id=pg_temp.f(20)),pg_temp.f(20),pg_temp.f(1),
      (select updated_at from public.affaire_briefs where project_id=pg_temp.f(20)),null,p_blocked_reason=>'CHATGPT_NOT_CONNECTED',
      p_actor_claims=>jsonb_build_object('sub',pg_temp.f(1),'role','authenticated')));
  exception when others then return sqlstate||' '||sqlerrm;
  end; $$;
$prepare$);
select dblink_exec('publisher',$prepare$
  create function pg_temp.publish_held() returns text language plpgsql as $$
  declare batch uuid:='ae570000-0000-4000-8000-000000000030'; project uuid:='ae570000-0000-4000-8000-000000000020';
  snapshot jsonb:=public.read_affaire_intake_brief_inputs(project);
  begin
    perform public.publish_affaire_intake_brief(batch,'ae570000-0000-4000-8000-000000000060',null,
      snapshot->>'revision',(snapshot->>'brief_updated_at')::timestamptz,
      '{"summary":"Réponse","project_object":"Fixture"}','[]');
    return 'published';
  exception when others then return sqlstate||' '||sqlerrm;
  end; $$;
  set deadlock_timeout='5s';
$prepare$);
select dblink_exec('editor',$lock$
  begin;
  set local deadlock_timeout='100ms';
  do $$begin perform 1 from public.affaire_briefs where project_id=pg_temp.f(20) for update; end$$;
$lock$);
create temp table sessions as select
  (select pid from dblink('editor','select pg_backend_pid()') as t(pid int)) holder,
  (select pid from dblink('publisher','select pg_backend_pid()') as t(pid int)) waiter;
select dblink_send_query('publisher','select pg_temp.publish_held()');
create function pg_temp.publisher_blocked() returns boolean language plpgsql as $$
begin
  for i in 1..250 loop
    if (select holder=any(pg_blocking_pids(waiter)) from sessions) then return true; end if;
    perform pg_sleep(0.02);
  end loop;
  return false;
end; $$;
select ok(pg_temp.publisher_blocked(),'publisher is waiting for the confirming member');
select is((select result from dblink('editor','select pg_temp.confirm()') as t(result text)),
  'confirmed','confirmation can finish while publication waits for its brief');
select dblink_exec('editor','commit');
select is((select result from dblink_get_result('publisher') as t(result text)),
  '40001 INTAKE_BRIEF_INPUT_CHANGED','the same waiting publication observes the confirmed revision');
select * from dblink_get_result('publisher') as t(result text);
-- Before the first brief exists both publishers expect NULL. Keep the winner
-- open so the competing call actually waits, then release that same call.
select dblink_exec('editor','delete from public.affaire_briefs where project_id=pg_temp.f(20)');
select dblink_exec('editor',$first$
  begin;
  set local role service_role;
  do $$begin
    perform public.publish_affaire_intake_brief(pg_temp.f(30),pg_temp.f(60),null,
      public.read_affaire_intake_brief_inputs(pg_temp.f(20))->>'revision',null,
      '{"summary":"Premier","project_object":"Fixture"}',jsonb_build_array(jsonb_build_object(
        'blockKey','summary','entryIndex',0,'sourceDocumentId',pg_temp.f(40),'sourceFileName','Exemple.pdf')));
  end$$;
$first$);
select dblink_send_query('publisher','select pg_temp.publish_held()');
select ok(pg_temp.publisher_blocked(),'the competing first publication waits on the first brief');
select dblink_exec('editor','commit');
select is((select result from dblink_get_result('publisher') as t(result text)),
  '40001 INTAKE_BRIEF_INPUT_CHANGED','the second first-generation response loses its empty-brief revision');
select results_eq($$select b.summary,l.source_file_name from public.affaire_briefs b join public.affaire_brief_source_links l on l.brief_id=b.id
  where b.project_id='ae570000-0000-4000-8000-000000000020'$$,$$values ('Premier'::text,'Exemple.pdf'::text)$$,
  'only the winning first brief and its source are visible');
select * from dblink_get_result('publisher') as t(result text);
-- A first deposit may add its upload and the waiting piece in one transaction.
-- Only the kept piece enters the contract. Confirmation can race its transaction.
select dblink_exec('publisher',$prepare$
  create function pg_temp.confirm_legacy() returns text language plpgsql as $$
  declare b public.affaire_briefs%rowtype; actor uuid:='ae570000-0000-4000-8000-000000000001';
  begin
    select * into strict b from public.affaire_briefs where project_id='ae570000-0000-4000-8000-000000000020';
    return (select outcome from public.confirm_affaire_brief_takeoff(b.tenant_id,b.project_id,actor,b.updated_at,
      null,p_blocked_reason=>'CHATGPT_NOT_CONNECTED',p_actor_claims=>jsonb_build_object('sub',actor,'role','authenticated')));
  exception when others then return sqlstate||' '||sqlerrm;
  end; $$;
$prepare$);
select dblink_exec('editor','insert into private.intake_current_brief_activation(active_from) values(now())');
select dblink_exec('editor',$first$
  begin;
  set local deadlock_timeout='100ms';
  set local statement_timeout='5s';
  insert into public.affaire_intake_uploads(id,project_id,created_by,status) values(pg_temp.f(31),pg_temp.f(20),pg_temp.f(1),'deposited');
$first$);
select dblink_exec('publisher','set statement_timeout=''5s''');
select is((select result from dblink('publisher','select pg_temp.confirm_legacy()') as t(result text)),'confirmed',
  'while the placeholder is open the historical dossier can still confirm');
select dblink_exec('editor',$piece$
  insert into public.affaire_intake_documents(upload_id,file_name,upload_status,classification_status)
    values(pg_temp.f(31),'First.pdf','uploaded','awaiting_launch');
$piece$);
select dblink_send_query('publisher','select pg_temp.confirm_legacy()');
select ok(pg_temp.publisher_blocked(),'the confirmer waits for the open first deposit');
select lives_ok($sql$select dblink_exec('editor',$piece$
  insert into public.affaire_intake_documents(upload_id,file_name,upload_status,classification_status)
    values(pg_temp.f(31),'Autre.pdf','uploaded','awaiting_launch');$piece$)$sql$,'the same depositor can finish without a deadlock');
select dblink_exec('editor','commit');
select is((select result from dblink_get_result('publisher') as t(result text)),'P0001 INTAKE_ANALYSIS_REQUIRED',
  'confirmation sees the committed first piece and gives the business refusal');
select * from dblink_get_result('publisher') as t(result text);
select dblink_exec('editor',$prepare$
  begin;
  set local request.jwt.claim.sub='ae570000-0000-4000-8000-000000000001';
  do $$declare batch uuid; s jsonb;
  begin
    select launch_id into strict batch from public.start_affaire_intake_analysis(pg_temp.f(20),false) where outcome='launched';
    perform public.claim_affaire_intake_analysis_launch(pg_temp.f(61),batch);
    update public.affaire_intake_documents set classification_status='classified',document_kind='annexes',analysis_completed_at=now() where analysis_launch_id=batch;
    s:=public.read_affaire_intake_brief_inputs(pg_temp.f(20));
    perform public.publish_affaire_intake_brief(batch,pg_temp.f(61),null,s->>'revision',(s->>'brief_updated_at')::timestamptz,
      '{"summary":"Courant","project_object":"Fixture"}','[]');
    perform public.finish_affaire_intake_upload_attempt(batch,pg_temp.f(61),'ready',now());
  end$$;
  commit;
$prepare$);
select dblink_exec('publisher',$edit$
  begin;
  update public.affaire_intake_documents set document_kind='plans' where id='ae570000-0000-4000-8000-000000000040';
$edit$);
select is((select result from dblink('editor','select pg_temp.confirm()') as t(result text)),
  '40001 INTAKE_BRIEF_INPUT_CHANGED','confirmation under a concurrent category edit reports a revision conflict without waiting for a deadlock');
select dblink_exec('publisher','commit');
select is((select result from dblink('editor','select pg_temp.confirm()') as t(result text)),
  'P0001 INTAKE_ANALYSIS_REQUIRED','after the editor commits, confirmation sees the changed input');
-- No Storage object existed at the time of publication. A row lock on existing
-- objects alone cannot fence the arrival of this first original.
select dblink_exec('editor',$prepare$
  begin;
  set local request.jwt.claim.sub='ae570000-0000-4000-8000-000000000001';
  update public.affaire_intake_documents set storage_path='fictional/race/plan.pdf',size_bytes=8 where id=pg_temp.f(40);
  do $$declare batch uuid; s jsonb;
  begin
    select launch_id into strict batch from public.start_affaire_intake_analysis(pg_temp.f(20),false) where outcome='brief_only';
    perform public.claim_affaire_intake_analysis_launch(pg_temp.f(62),batch);
    s:=public.read_affaire_intake_brief_inputs(pg_temp.f(20));
    perform public.publish_affaire_intake_brief(batch,pg_temp.f(62),null,s->>'revision',(s->>'brief_updated_at')::timestamptz,
      '{"summary":"Sans original","project_object":"Fixture"}','[]');
    perform public.finish_affaire_intake_upload_attempt(batch,pg_temp.f(62),'ready',now());
  end$$;
  commit;
$prepare$);
select dblink_exec('publisher',$edit$
  begin;
  insert into storage.objects(bucket_id,name,metadata) values('affaire-intake','fictional/race/plan.pdf','{"size":8}');
$edit$);
select is((select result from dblink('editor','select pg_temp.confirm()') as t(result text)),
  '40001 INTAKE_BRIEF_INPUT_CHANGED','the uncommitted arrival of the first plan original serializes with confirmation');
select dblink_exec('publisher','commit');
select is((select result from dblink('editor','select pg_temp.confirm()') as t(result text)),
  'P0001 INTAKE_ANALYSIS_REQUIRED','the newly available plan requires a publication');
select dblink_exec('editor',$unrelated$
  insert into public.affaire_intake_documents(id,upload_id,file_name,storage_path,upload_status,classification_status,document_kind,size_bytes)
    values(pg_temp.f(45),pg_temp.f(30),'CCTP.pdf','fictional/race/cctp.pdf','uploaded','classified','cctp',8);
  begin;
  do $$begin perform 1 from public.affaire_intake_documents where id in (pg_temp.f(40),pg_temp.f(45)) for update; end$$;
$unrelated$);
select lives_ok($sql$select dblink_exec('publisher',$uploads$
  begin;
  set local lock_timeout='150ms';
  insert into storage.objects(bucket_id,name,metadata) values
    ('affaire-intake','fictional/race/cctp.pdf','{"size":8}'),
    ('affaire-intake','fictional/race/unregistered.pdf','{}'),
    ('dpgf-imports','fictional/race/plan.pdf','{"size":8}');
  rollback;
$uploads$)$sql$,'a locked plan and a locked CCTP cannot block unrelated Storage uploads');
select dblink_exec('editor','rollback');
-- The timestamp on the activation row can pass while the confirmation waits
-- for its first lock. The reservation is decided after that wait.
select dblink_exec('editor',$pause$
  update private.intake_current_brief_activation set active_from='infinity';
  begin;
  do $$begin perform 1 from public.affaire_briefs where project_id=pg_temp.f(20) for update; end$$;
$pause$);
select dblink_send_query('publisher','select pg_temp.confirm_legacy()');
select ok(pg_temp.publisher_blocked(),'the confirmation started while enforcement was off and is waiting on the brief');
select dblink_exec('editor','update private.intake_current_brief_activation set active_from=clock_timestamp(); commit');
select is((select result from dblink_get_result('publisher') as t(result text)),'P0001 INTAKE_ANALYSIS_REQUIRED',
  'confirmation observes the cut-over that occurred after its statement began but before it acquired the brief');
select * from dblink_get_result('publisher') as t(result text);
-- Both deletion reservations are already committed, as when Storage returns
-- an error to the member. Exercise both orders on the actual close RPC.
select dblink_exec('editor',$fixture$
  begin;
  insert into public.affaire_intake_uploads(id,project_id,created_by,status,processing_lease_token,processing_lease_expires_at)
    select pg_temp.f(n),pg_temp.f(20),pg_temp.f(1),'processing',pg_temp.f(90),now()+interval '10 minutes' from generate_series(80,81) n;
  insert into public.affaire_intake_documents(id,upload_id,file_name,upload_status,classification_status)
    select pg_temp.f(n+2),pg_temp.f(n),'Reserved.pdf','uploaded','queued' from generate_series(80,81) n;
  update public.affaire_intake_documents set deletion_token=pg_temp.f(91),deletion_started_at=now() where id in (pg_temp.f(82),pg_temp.f(83));
  commit;
  begin;
  do $$begin if not public.finish_affaire_intake_upload_attempt(pg_temp.f(80),pg_temp.f(90),'failed',now()) then raise exception 'close failed'; end if; end$$;
$fixture$);
select dblink_send_query('publisher',$cancel$
  update public.affaire_intake_documents set deletion_token=null,deletion_started_at=null
    where id='ae570000-0000-4000-8000-000000000082' returning classification_status
$cancel$);
select ok(pg_temp.publisher_blocked(),'cancellation waits for the historical close although the last visible completed_at is null');
select dblink_exec('editor','commit');
select is((select status from dblink_get_result('publisher') as t(status text)),'failed','after the close commits the cancelled piece is immediately retryable');
select * from dblink_get_result('publisher') as t(status text);
select dblink_exec('editor',$cancel$
  begin;
  update public.affaire_intake_documents set deletion_token=null,deletion_started_at=null where id=pg_temp.f(83);
$cancel$);
select dblink_send_query('publisher',$close$select public.finish_affaire_intake_upload_attempt(
  'ae570000-0000-4000-8000-000000000081','ae570000-0000-4000-8000-000000000090','failed',now())$close$);
select ok(pg_temp.publisher_blocked(),'in the other order the close waits for the member cancelling the reservation');
select dblink_exec('editor','commit');
select ok((select closed from dblink_get_result('publisher') as t(closed boolean)),'the waiting close finishes');
select is((select classification_status from public.affaire_intake_documents where id='ae570000-0000-4000-8000-000000000083'),
  'failed','closing after cancellation also releases the visible piece for its own retry');
select * from dblink_get_result('publisher') as t(closed boolean);
-- Like an old pre-cutover failure: still queued when the member presses.
select dblink_exec('editor',$lock$
  begin;
  insert into public.affaire_intake_uploads(id,project_id,created_by,status,completed_at)
    values(pg_temp.f(84),pg_temp.f(20),pg_temp.f(1),'failed',now());
  insert into public.affaire_intake_documents(id,upload_id,file_name,upload_status,classification_status)
    values(pg_temp.f(85),pg_temp.f(84),'Ancien.pdf','uploaded','queued');
  commit;
  begin;
  do $$begin perform 1 from public.affaire_intake_uploads where id=pg_temp.f(84) for update; end$$;
$lock$);
select dblink_exec('publisher',$actor$
  set role authenticated;
  set request.jwt.claim.sub='ae570000-0000-4000-8000-000000000001';
$actor$);
select dblink_send_query('publisher',$retry$select public.prepare_historical_intake_document_retry(
  'ae570000-0000-4000-8000-000000000020','ae570000-0000-4000-8000-000000000085')$retry$);
select ok(pg_temp.publisher_blocked(),'the member preparing a historical retry waits on its lot');
select dblink_exec('editor',$revoke$
  update public.tenants set is_active=false where id=(select tenant_id from public.estimate_projects where id=pg_temp.f(20));
  commit;
$revoke$);
select is((select prepared from dblink_get_result('publisher') as t(prepared boolean)),false,'suspension during that wait refuses the retry');
select * from dblink_get_result('publisher') as t(prepared boolean);
select ok((select classification_status='queued' and issues='{}' from public.affaire_intake_documents
  where id='ae570000-0000-4000-8000-000000000085'),'the refused gesture leaves the piece and its diagnostics intact');
select dblink_exec('editor','update public.tenants set is_active=true where id=(select tenant_id from public.estimate_projects where id=pg_temp.f(20))');
select dblink_disconnect('publisher');
select dblink_exec('editor',$cleanup$
  begin;
  delete from private.intake_current_brief_activation;
  set local storage.allow_delete_query='true';
  delete from storage.objects where bucket_id='affaire-intake' and name='fictional/race/plan.pdf';
  create temp table own_tenant as select tenant_id from public.tenant_memberships where user_id=pg_temp.f(1);
  set local request.jwt.claim.sub='ae570000-0000-4000-8000-000000000001';
  set local role authenticated;
  do $$begin
    if (select outcome from public.bulk_delete_draft_affaires(
      (select tenant_id from public.estimate_projects where id=pg_temp.f(20)),array[pg_temp.f(20)])) is distinct from 'deleted'
      then raise exception 'Fixture cleanup failed'; end if;
  end$$;
  reset role;
  delete from public.feature_flags where tenant_id in (select tenant_id from own_tenant);
  delete from public.estimate_rules where tenant_id in (select tenant_id from own_tenant);
  delete from public.audit_logs where tenant_id in (select tenant_id from own_tenant);
  delete from auth.users where id=pg_temp.f(1);
  delete from public.tenants where id in (select tenant_id from own_tenant);
  commit;
$cleanup$);
select dblink_disconnect('editor');
select * from finish();
rollback;
