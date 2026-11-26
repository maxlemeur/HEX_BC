begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();
create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('ae6a0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
insert into auth.users(id,email,email_confirmed_at) values
  (pg_temp.f(1),'intake-ai@example.test',now()), (pg_temp.f(2),'other-intake-ai@example.test',now());
insert into public.estimate_projects(id,tenant_id,user_id,name)
  select scope.id,member.tenant_id,member.user_id,scope.name
  from public.tenant_memberships member
  cross join (values (pg_temp.f(20),'Dossier fictif'), (pg_temp.f(21),'Autre dossier fictif')) scope(id,name)
  where member.user_id=pg_temp.f(1) and member.is_default;
insert into public.affaire_intake_uploads(id,project_id,created_by,status) values(pg_temp.f(30),pg_temp.f(20),pg_temp.f(1),'deposited');
insert into public.affaire_intake_documents(upload_id,file_name,upload_status,classification_status)
values (pg_temp.f(30),'A.png','uploaded','awaiting_launch');
create function pg_temp.tenant(actor uuid default pg_temp.f(1)) returns uuid language sql stable as $$
  select tenant_id from public.tenant_memberships where user_id=actor and is_default
$$;
create function pg_temp.start_batch(selection jsonb, is_retry boolean default false, actor uuid default pg_temp.f(1))
returns table(outcome text, batch_id uuid, piece_count integer) language sql as $$
  select * from public.start_affaire_intake_ai_batch(pg_temp.f(20),pg_temp.tenant(),actor,selection,is_retry)
$$;

set local role service_role;
select throws_ok($$select pg_temp.start_batch('{"source":"rules_only"}',true,pg_temp.f(2))$$,
  '42501','INTAKE_LAUNCH_FORBIDDEN','the payer must belong to the target affaire');
create temp table paid as select result.* from pg_temp.start_batch(
  '{"source":"personal_api_key","preferences":{"model":"gpt-6.2-sol","reasoningEffort":"medium"},"connection":{"id":"fixture","version":2}}'
) as result;
select is((select outcome from paid),'launched','the trusted reservation atomically attaches the payer to the launch');
select is(auth.uid(),null::uuid,'delegated authentication is restored after the RPC');
select is((select outcome from pg_temp.start_batch('{"source":"rules_only"}')),'already_running',
  'a second press cannot replace the accepted selection');

-- Make it overdue enough for either old worker operation.
update public.affaire_intake_uploads set created_at=now()-interval '31 minutes',next_retry_at=null
  where id=(select batch_id from paid);
select is((select count(*) from public.claim_affaire_intake_analysis_launch(pg_temp.f(38)) where upload_id=(select batch_id from paid)),0::bigint,
  'an old queue sweep cannot take the recorded launch');
select is((select count(*) from public.claim_affaire_intake_analysis_launch(pg_temp.f(39),(select batch_id from paid))),0::bigint,
  'the old worker cannot take a specific recorded launch');
select is((select status from public.affaire_intake_uploads where id=(select batch_id from paid)),
  'launch_queued','old claims leave the recorded launch queued');
-- If this suite is run against the old schema, undo its unauthorized claim so
-- the stop assertion can fail independently.
update public.affaire_intake_uploads set status='launch_queued',attempt_count=0,
  processing_lease_token=null,processing_lease_expires_at=null
  where id=(select batch_id from paid) and status='launch_processing';
select is(public.stop_affaire_intake_analysis((select batch_id from paid),null),null::text,
  'the old worker cannot retire an overdue recorded launch');
select is((select status from public.affaire_intake_uploads where id=(select batch_id from paid)),
  'launch_queued','the recorded launch is still queued');

select has_function('public','read_affaire_intake_ai_batch',array['uuid','uuid','uuid','uuid'],
  'a batch read requires the expected tenant, project and payer');
select has_function('public','settle_affaire_intake_ai_call',array['uuid','uuid','uuid','uuid','uuid','uuid','text','bigint'],
  'settlement requires the original batch and reservation scope');
select has_function('public','finish_affaire_intake_ai_retry',array['uuid','uuid','uuid','uuid'],
  'retry closure requires the expected tenant, project and payer');
select is((select attempt_count from public.claim_affaire_intake_analysis_launch_v2(pg_temp.f(40),(select batch_id from paid))),1,
  'the new worker can claim the recorded launch');
select ok(not has_function_privilege('authenticated','public.start_affaire_intake_ai_batch(uuid,uuid,uuid,jsonb,boolean)','execute')
  and not has_function_privilege('authenticated','public.read_affaire_intake_ai_batch(uuid,uuid,uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.reserve_affaire_intake_ai_call(uuid,uuid,uuid,uuid,uuid,text,text,text,bigint)','execute')
  and not has_function_privilege('anon','public.settle_affaire_intake_ai_call(uuid,uuid,uuid,uuid,uuid,uuid,text,bigint)','execute')
  and not has_function_privilege('authenticated','public.finish_affaire_intake_ai_retry(uuid,uuid,uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.claim_affaire_intake_analysis_launch_v2(uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.stop_affaire_intake_analysis_v2(uuid,uuid)','execute'),
  'only the server creates, reads and spends a batch');

create function pg_temp.read_batch(batch_id uuid) returns jsonb language sql as $$
  select public.read_affaire_intake_ai_batch(batch_id,pg_temp.tenant(),pg_temp.f(20),pg_temp.f(1))
$$;
select is(public.read_affaire_intake_ai_batch((select batch_id from paid),pg_temp.tenant(pg_temp.f(2)),pg_temp.f(20),pg_temp.f(1)),
  null::jsonb,'a valid id reveals no selection for the wrong tenant');
select is(public.read_affaire_intake_ai_batch((select batch_id from paid),pg_temp.tenant(),pg_temp.f(21),pg_temp.f(1)),
  null::jsonb,'a valid id reveals no selection for the wrong project');
select is(public.read_affaire_intake_ai_batch((select batch_id from paid),pg_temp.tenant(),pg_temp.f(20),pg_temp.f(2)),
  null::jsonb,'a valid id reveals no selection for the wrong payer');

create temp table retried as select result.* from pg_temp.start_batch(
  '{"source":"personal_api_key","preferences":{"model":"gpt-6.1-terra","reasoningEffort":"high"},"connection":{"id":"second","version":3}}',true
) as result;
select is((pg_temp.read_batch((select batch_id from retried))->>'remaining_nano_usd')::bigint,
  2000000000::bigint,'an explicit retry gets a fresh independent budget');

create temp table held as select public.reserve_affaire_intake_ai_call(
  (select batch_id from paid),pg_temp.tenant(),pg_temp.f(20),pg_temp.f(1),pg_temp.f(40),'classification','gpt-6.2-sol','medium',900000000) as call_id;
select ok((select call_id from held) is not null,'the first document holds its maximum cost');
select throws_ok($$select public.settle_affaire_intake_ai_call(
  (select batch_id from paid),pg_temp.tenant(pg_temp.f(2)),pg_temp.f(20),pg_temp.f(1),(select call_id from held),pg_temp.f(40),'fixture',0)$$,
  '42501','INTAKE_AI_RESERVATION_FORBIDDEN','a valid reservation cannot settle under another tenant');
select throws_ok($$select public.settle_affaire_intake_ai_call(
  (select batch_id from paid),pg_temp.tenant(),pg_temp.f(21),pg_temp.f(1),(select call_id from held),pg_temp.f(40),'fixture',0)$$,
  '42501','INTAKE_AI_RESERVATION_FORBIDDEN','a valid reservation cannot settle under another project');
select throws_ok($$select public.settle_affaire_intake_ai_call(
  (select batch_id from paid),pg_temp.tenant(),pg_temp.f(20),pg_temp.f(2),(select call_id from held),pg_temp.f(40),'fixture',0)$$,
  '42501','INTAKE_AI_RESERVATION_FORBIDDEN','a valid reservation cannot settle under another payer');
select throws_ok($$select public.settle_affaire_intake_ai_call(
  (select batch_id from retried),pg_temp.tenant(),pg_temp.f(20),pg_temp.f(1),(select call_id from held),pg_temp.f(40),'fixture',0)$$,
  '42501','INTAKE_AI_RESERVATION_FORBIDDEN','the receipt belongs to the original batch even within the same scope');
select throws_ok($$select public.settle_affaire_intake_ai_call(
  (select batch_id from paid),pg_temp.tenant(),pg_temp.f(20),pg_temp.f(1),(select call_id from held),pg_temp.f(41),'fixture',0)$$,
  '42501','INTAKE_AI_RESERVATION_FORBIDDEN','the receipt belongs to the original lease');

select public.settle_affaire_intake_ai_call((select batch_id from paid),pg_temp.tenant(),pg_temp.f(20),pg_temp.f(1),
  (select call_id from held),pg_temp.f(40),'gpt-6.2-sol-snapshot',300000000);
select public.settle_affaire_intake_ai_call((select batch_id from paid),pg_temp.tenant(),pg_temp.f(20),pg_temp.f(1),
  (select call_id from held),pg_temp.f(40),'gpt-6.2-sol-snapshot',0);
select is((pg_temp.read_batch((select batch_id from paid))->>'remaining_nano_usd')::bigint,
  1700000000::bigint,'only one refund credits unused hold');
select ok(public.reserve_affaire_intake_ai_call(
  (select batch_id from paid),pg_temp.tenant(),pg_temp.f(20),pg_temp.f(1),pg_temp.f(40),'transcription','gpt-6.1-terra','high',900000000) is not null,
  'an unsettled OCR hold survives an interrupted worker');
update public.affaire_intake_uploads set processing_lease_expires_at = now() - interval '1 min' where id=(select batch_id from paid);
select is((select attempt_count from public.claim_affaire_intake_analysis_launch_v2(pg_temp.f(41),(select batch_id from paid))),2,
  'another lease resumes the lot');
select is(pg_temp.read_batch((select batch_id from paid))#>>'{selection,connection,id}','fixture',
  'the resumed lot keeps the accepted connection');
select throws_ok($$select public.reserve_affaire_intake_ai_call(
  (select batch_id from paid),pg_temp.tenant(),pg_temp.f(20),pg_temp.f(1),pg_temp.f(40),'brief','gpt-6.2-sol','medium',1)$$,'40001','INTAKE_LEASE_LOST',
  'a superseded lease cannot reserve a new request');
select is(public.reserve_affaire_intake_ai_call(
  (select batch_id from paid),pg_temp.tenant(),pg_temp.f(20),pg_temp.f(1),pg_temp.f(41),'brief','gpt-6.2-sol','medium',800000001),null::uuid,
  'the entire batch stops before exceeding its ceiling');
select is(public.reserve_affaire_intake_ai_call(
  (select batch_id from paid),pg_temp.tenant(),pg_temp.f(20),pg_temp.f(1),pg_temp.f(41),'brief','gpt-6.2-sol','medium',1),null::uuid,
  'an exhausted batch cannot resume spending on a smaller call');
select is((pg_temp.read_batch((select batch_id from paid))->>'remaining_nano_usd')::bigint,
  800000000::bigint,'refused calls do not consume budget');
select ok((pg_temp.read_batch((select batch_id from paid))->>'budget_stop_message') like '%2,00 $ US%',
  'the batch keeps the reason for stopping in French');

update public.affaire_intake_uploads set processing_lease_expires_at = now() - interval '31 minutes'
  where id=(select batch_id from paid);
select is(public.stop_affaire_intake_analysis_v2((select batch_id from paid),null),'ai_connection_unavailable',
  'the new worker alone can retire an overdue recorded launch');

select throws_ok($$select public.finish_affaire_intake_ai_retry((select batch_id from retried),pg_temp.tenant(pg_temp.f(2)),pg_temp.f(20),pg_temp.f(1))$$,
  '42501','INTAKE_AI_BATCH_FORBIDDEN','a valid retry id cannot be closed from another tenant');
select throws_ok($$select public.finish_affaire_intake_ai_retry((select batch_id from retried),pg_temp.tenant(),pg_temp.f(21),pg_temp.f(1))$$,
  '42501','INTAKE_AI_BATCH_FORBIDDEN','a valid retry id cannot be closed from another project');
select throws_ok($$select public.finish_affaire_intake_ai_retry((select batch_id from retried),pg_temp.tenant(),pg_temp.f(20),pg_temp.f(2))$$,
  '42501','INTAKE_AI_BATCH_FORBIDDEN','a valid retry id cannot be closed by another payer');
select is(pg_temp.read_batch((select batch_id from retried))->>'finished_at',null::text,
  'the refused closure attempts leave the retry open');
select public.finish_affaire_intake_ai_retry((select batch_id from retried),pg_temp.tenant(),pg_temp.f(20),pg_temp.f(1));
select throws_ok($$select public.reserve_affaire_intake_ai_call(
  (select batch_id from retried),pg_temp.tenant(),pg_temp.f(20),pg_temp.f(1),null,'brief','gpt-6.1-terra','high',1)$$,
  '40001','INTAKE_AI_BATCH_CLOSED','a finished retry admits no further request');
reset role;
select is((select count(*) from private.affaire_intake_ai_calls where batch_id=(select batch_id from paid)),2::bigint,
  'only admitted requests have spend receipts');
select ok((select convalidated from pg_constraint
  where conrelid='public.affaire_intake_document_transcriptions'::regclass and conname='affaire_intake_transcriptions_ai_source_check'),
  'the named source constraint is validated after the migration');
select * from finish();
rollback;
