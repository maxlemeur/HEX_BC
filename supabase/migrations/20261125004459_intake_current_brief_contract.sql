begin;
set local lock_timeout='5s';

-- Only the deployment owner's cut-over enables freshness enforcement. Removing
-- the singleton restores the pre-cutover paths without discarding any receipts.
create table private.intake_current_brief_activation (
  singleton boolean primary key default true check (singleton),
  active_from timestamptz not null
);
revoke all on private.intake_current_brief_activation from public,anon,authenticated,service_role;

-- Release 0.9.0 creates neither a deposited upload nor an explicit launch.
-- Remember entry even if members later remove every deposit. Only a guarded
-- publication can bind a particular brief to the inputs it described.
create table private.affaire_intake_contracts (
  project_id uuid primary key references public.estimate_projects(id) on delete cascade,
  published_brief_id uuid,
  published_upload_id uuid,
  published_revision text
);
revoke all on private.affaire_intake_contracts from public,anon,authenticated,service_role;

create function private.intake_current_brief_enforced(p_project_id uuid,p_at timestamptz default clock_timestamp()) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.intake_current_brief_activation where active_from<=p_at)
    and exists(select 1 from private.affaire_intake_contracts where project_id=p_project_id)
$$;
revoke all on function private.intake_current_brief_enforced(uuid,timestamptz) from public,anon,authenticated,service_role;

create function private.enter_intake_launch_contract() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='affaire_intake_documents' then
    if not exists(select 1 from public.affaire_intake_uploads u where u.id=new.upload_id and u.status='deposited') then return null; end if;
    if exists(select 1 from private.affaire_intake_contracts where project_id=new.project_id) then return null; end if;
    -- An accepted piece can reopen the brief in this transaction (#537).
    perform 1 from public.affaire_briefs where project_id=new.project_id for update;
    perform private.lock_affaire_intake_analysis(new.project_id);
  end if;
  -- An explicit launch already holds the analysis lock. Do not acquire the
  -- brief after that lock: the confirmation takes them in the opposite order.
  insert into private.affaire_intake_contracts(project_id) values(new.project_id) on conflict do nothing;
  return null;
end;
$$;
revoke all on function private.enter_intake_launch_contract() from public,anon,authenticated,service_role;
create trigger enter_intake_launch_contract after insert or update of status on public.affaire_intake_uploads
  for each row when (new.status='launch_queued') execute function private.enter_intake_launch_contract();

create trigger enter_intake_launch_contract after insert or update of upload_status on public.affaire_intake_documents
  for each row when (new.upload_status='uploaded' and new.deleted_at is null) execute function private.enter_intake_launch_contract();

insert into private.affaire_intake_contracts(project_id,published_brief_id,published_upload_id,published_revision)
select e.project_id,b.id,u.id,u.brief_published_revision from (
  select distinct u.project_id from public.affaire_intake_uploads u where u.launch_read_scans is not null
    or (u.status='deposited' and exists(select 1 from public.affaire_intake_documents d where d.upload_id=u.id
      and d.upload_status='uploaded'))
) e left join public.affaire_briefs b on b.project_id=e.project_id
left join public.affaire_intake_uploads u on u.id=b.upload_id and u.project_id=e.project_id and u.launch_read_scans is not null;

create function private.record_current_intake_publication() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- The publishing RPC already locked (or inserted) the brief, checked the
  -- current digest and lease, and owns the input locks through commit.
  update private.affaire_intake_contracts set published_revision=new.brief_published_revision,published_upload_id=new.id,
    published_brief_id=(select b.id from public.affaire_briefs b where b.project_id=new.project_id)
    where project_id=new.project_id;
  return null;
end;
$$;
revoke all on function private.record_current_intake_publication() from public,anon,authenticated,service_role;
create trigger record_current_intake_publication after update of brief_published_revision on public.affaire_intake_uploads
  for each row when (new.launch_read_scans is not null and new.status='launch_processing' and new.brief_published_revision is not null)
  execute function private.record_current_intake_publication();

-- A restored original has no Storage row for the reader to lock. The indexed
-- application document is its reservation. Other buckets bypass the trigger;
-- unrelated paths never take a document lock. Existing object updates/deletes
-- already conflict with the reader's Storage row lock.
create index intake_available_original_path on public.affaire_intake_documents using hash(storage_path)
  where storage_path is not null and document_kind='plans' and classification_status='classified'
    and upload_status='uploaded' and size_bytes>0 and deleted_at is null and deletion_token is null;
create function private.lock_intake_plan_original() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.affaire_intake_documents d where d.storage_path=new.name
    and d.document_kind='plans' and d.classification_status='classified' and d.upload_status='uploaded'
    and d.size_bytes>0 and d.deleted_at is null and d.deletion_token is null
    and private.intake_current_brief_enforced(d.project_id) order by d.id for no key update;
  return null;
end;
$$;
revoke all on function private.lock_intake_plan_original() from public,anon,authenticated,service_role;
create trigger lock_intake_plan_original after insert or update of name,bucket_id on storage.objects
  for each row when (new.bucket_id='affaire-intake') execute function private.lock_intake_plan_original();

create index intake_plan_decisions_by_project on public.affaire_intake_events(project_id)
  where event_type='brief.updated' and reason='plans.marked_received';

-- Availability uses the same three kinds of complete bytes as affaire_has_stored_plan.
-- The selected import set additionally contributes the exact versions recognised
-- by #547, including copies of uploaded originals and versions backed by eTag.
create function private.intake_available_plans(p_project uuid,p_tenant uuid) returns jsonb
language sql stable set search_path='' as $$
  with plans as (
    select 'original' kind,d.id,jsonb_build_array(d.storage_path,o.id,o.version,o.metadata->>'eTag',d.size_bytes) identity
    from public.affaire_intake_documents d join storage.objects o on o.bucket_id='affaire-intake' and o.name=d.storage_path
    where d.project_id=p_project and d.tenant_id=p_tenant and d.document_kind='plans' and d.classification_status='classified'
      and d.upload_status='uploaded' and d.size_bytes>0 and d.deleted_at is null and d.deletion_token is null
      and o.metadata->'size'=to_jsonb(d.size_bytes)
    union all
    select 'copy',f.id,jsonb_build_array(f.plan_set_id,f.file_name,o.id,o.name,o.version,o.metadata->>'eTag',f.file_size_bytes)
    from public.plan_sets s join public.plan_files f on f.plan_set_id=s.id and f.tenant_id=s.tenant_id
    join storage.objects o on o.bucket_id='plan-files' and o.name=f.file_path
    where s.project_id=p_project and s.tenant_id=p_tenant and coalesce(f.metadata->>'intake_cleanup_pending','false')<>'true'
      and f.file_size_bytes>0 and o.metadata->'size'=to_jsonb(f.file_size_bytes)
      and (coalesce(f.metadata->>'source','')<>'affaire-intake' or exists (
        select 1 from public.affaire_intake_documents d where d.tenant_id=p_tenant and d.project_id=p_project
          and d.id::text=f.metadata->>'intake_document_id' and d.source_provider='google_drive'
          and d.drive_file_id=f.metadata->>'intake_drive_file_id' and d.plan_copy_generation::text=f.metadata->>'intake_generation'
          and d.deleted_at is null and d.deletion_token is null and d.upload_status='uploaded'
          and d.classification_status='classified' and d.document_kind='plans'))
    union all
    select 'takeoff',c.plan_file_id,jsonb_build_array(c.plan_name,c.plan_version,c.source_kind,c.source_id)
      from private.takeoff_brief_plan_copies(p_tenant,p_project) c
  )
  select jsonb_agg(jsonb_build_array(kind,id,identity) order by kind,id) from plans
$$;
revoke all on function private.intake_available_plans(uuid,uuid) from public,anon,authenticated,service_role;

-- Keep the released digest and its locks intact until cut-over, including for
-- a worker with a receipt written before the migration. Only the original
-- service-only public signature is exposed.
alter function public.read_affaire_intake_brief_inputs(uuid,boolean) set schema private;
revoke all on function private.read_affaire_intake_brief_inputs(uuid,boolean) from public,anon,authenticated,service_role;
create function public.read_affaire_intake_brief_inputs(p_project_id uuid,p_lock_inputs boolean default false) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare base jsonb; inputs jsonb;
begin
  if not private.intake_current_brief_enforced(p_project_id) then
    return private.read_affaire_intake_brief_inputs(p_project_id,p_lock_inputs);
  end if;
  if p_lock_inputs then
    perform 1 from public.affaire_briefs where project_id=p_project_id for share nowait;
  end if;
  base:=private.read_affaire_intake_brief_inputs(p_project_id,p_lock_inputs);
  if p_lock_inputs then
    perform 1 from storage.objects o join public.plan_files f on o.bucket_id='plan-files' and o.name=f.file_path
      join public.plan_sets s on s.id=f.plan_set_id where s.project_id=p_project_id order by o.id for share of o nowait;
    -- A managed Storage upgrade could replace the table and its custom triggers.
    -- Never certify an active dossier without the original-restoration fence.
    if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='storage.objects'::regclass
      and tgname='lock_intake_plan_original' and tgfoid=to_regprocedure('private.lock_intake_plan_original()')
      and tgenabled in ('O','A')) then
      raise exception 'INTAKE_STORAGE_GUARD_UNAVAILABLE' using errcode='55000';
    end if;
  end if;
  inputs:=(base-'revision'-'brief_updated_at') || jsonb_strip_nulls(jsonb_build_object(
    'available_plans',private.intake_available_plans(p_project_id,(select tenant_id from public.estimate_projects where id=p_project_id)),
    'plan_decisions',(select nullif(count(*),0) from public.affaire_intake_events e where e.project_id=p_project_id
      and e.event_type='brief.updated' and e.reason='plans.marked_received')));
  return inputs || jsonb_build_object('revision',encode(sha256(convert_to(inputs::text,'UTF8')),'hex'),'brief_updated_at',base->'brief_updated_at');
exception when lock_not_available then
  raise exception 'INTAKE_BRIEF_INPUT_CHANGED' using errcode='40001';
end;
$$;
revoke all on function public.read_affaire_intake_brief_inputs(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.read_affaire_intake_brief_inputs(uuid,boolean) to service_role;

-- The interactive reader uses an ordinary snapshot. Both the reservation and
-- confirmation request the same locked snapshot as the publisher.
create function private.intake_brief_state(p_project_id uuid,p_lock_inputs boolean) returns text
language plpgsql security definer set search_path='' as $$
declare receipt private.affaire_intake_contracts%rowtype; snapshot jsonb; brief uuid; source_upload uuid;
begin
  if not private.intake_current_brief_enforced(p_project_id) then return 'legacy'; end if;
  snapshot:=public.read_affaire_intake_brief_inputs(p_project_id,p_lock_inputs);
  select * into strict receipt from private.affaire_intake_contracts where project_id=p_project_id;
  select id,upload_id into brief,source_upload from public.affaire_briefs where project_id=p_project_id;
  if exists(select 1 from public.affaire_intake_uploads where project_id=p_project_id and status='failed'
    and launch_read_scans is not null and brief_published_revision is null) then return 'required'; end if;
  if brief is null and snapshot->'documents'='[]'::jsonb then return 'current'; end if;
  if receipt.published_revision=snapshot->>'revision' and receipt.published_brief_id=brief and receipt.published_upload_id=source_upload then return 'current'; end if;
  return 'required';
end;
$$;
revoke all on function private.intake_brief_state(uuid,boolean) from public,anon,authenticated,service_role;
create or replace function private.intake_brief_publication_due(p_project_id uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select case when private.intake_current_brief_enforced(p_project_id) then private.intake_brief_state(p_project_id,true)='required'
    else exists(select 1 from public.affaire_intake_uploads where project_id=p_project_id and status='failed'
      and launch_read_scans is not null and brief_published_revision is null) end
$$;
create function public.read_affaire_intake_brief_state(p_project_id uuid) returns text
language sql security definer set search_path='' as $$
  select private.intake_brief_state(p_project_id,false)
$$;
revoke all on function public.read_affaire_intake_brief_state(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_affaire_intake_brief_state(uuid) to service_role;

-- The two public confirmation functions share the same authorization helper.
-- An already-confirmed replay returns before the UPDATE and its existing triggers.
create or replace function private.takeoff_member_may_confirm_brief(p_tenant_id uuid, p_project_id uuid, p_actor uuid, p_claims jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  saved_claims text := pg_catalog.current_setting('request.jwt.claims', true);
  saved_claim text := pg_catalog.current_setting('request.jwt.claim', true);
  saved_sub text := pg_catalog.current_setting('request.jwt.claim.sub', true);
  allowed boolean;
  replay boolean;
begin
  if p_actor is null or p_claims is null or jsonb_typeof(p_claims) <> 'object' or p_claims ->> 'sub' is distinct from p_actor::text then
    return false;
  end if;
  perform 1 from public.estimate_projects p where p.id = p_project_id and p.tenant_id = p_tenant_id for share;
  perform 1 from public.tenant_memberships m join public.tenants t on t.id = m.tenant_id where m.user_id = p_actor for share of m, t;
  -- auth.uid() and auth.jwt() read these settings: for this evaluation only, they are the member's.
  perform pg_catalog.set_config('request.jwt.claims', p_claims::text, true);
  perform pg_catalog.set_config('request.jwt.claim', '', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  allowed := p_tenant_id = public.current_tenant_id() and public.can_read_affaire_intake_project(p_project_id, p_tenant_id);
  perform pg_catalog.set_config('request.jwt.claims', coalesce(saved_claims, ''), true);
  perform pg_catalog.set_config('request.jwt.claim', coalesce(saved_claim, ''), true);
  perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(saved_sub, ''), true);
  if not coalesce(allowed,false) then return false; end if;
  if not private.intake_current_brief_enforced(p_project_id) then return true; end if;
  select b.status='confirme' into replay from public.affaire_briefs b where b.project_id=p_project_id;
  -- A fresh confirmation next takes the takeoff-command locks, then its AFTER
  -- triggers lock and recheck the inputs before commit. Preflight its business
  -- answer without reversing that lock order. A replay has no subsequent write.
  if replay then perform private.lock_affaire_intake_analysis(p_project_id); end if;
  if exists(select 1 from public.affaire_intake_documents d where d.project_id=p_project_id and private.intake_piece_waits(d)) then
    raise exception 'INTAKE_ANALYSIS_REQUIRED' using hint='Lancez l’analyse ou retirez les pièces en attente avant de confirmer.';
  end if;
  if exists(select 1 from public.affaire_intake_uploads u where u.project_id=p_project_id and u.status in ('launch_queued','launch_processing')) then
    raise exception 'INTAKE_ANALYSIS_RUNNING' using hint='Attendez la fin de l’analyse du dossier avant de confirmer.';
  end if;
  if private.intake_brief_state(p_project_id,replay)='required' then
    raise exception 'INTAKE_ANALYSIS_REQUIRED' using hint='Lancez l’analyse pour actualiser le brief avant de confirmer.';
  end if;
  return true;
end;
$$;

-- Admission already holds its request and its final dossier lock. The intake
-- snapshot takes conflicting input rows NOWAIT, so confirmation can finish.
create or replace function public.admit_takeoff_launch_request(
  p_request_id uuid, p_token uuid, p_mark bigint, p_manifest jsonb, p_snapshot jsonb, p_job jsonb, p_module_default boolean default false
) returns table (outcome text, job_id uuid, reason_code text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  request public.takeoff_launch_requests%rowtype;
  brief public.affaire_briefs%rowtype;
  admitted_jobs uuid[];
  failure text;
  violated text;
begin
  select * into request from public.takeoff_launch_requests r where r.id = p_request_id for update;
  if not found then
    raise exception 'TAKEOFF_LAUNCH_REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
  if request.state in ('admitted', 'closed') then
    return query select 'replayed'::text, private.takeoff_launch_first_job(request.id), null::text;
    return;
  end if;
  -- The token alone: a lease that expired was claimed again under another token by then, or is still this evaluation's.
  if request.evaluation_lease_token is distinct from p_token then
    return query select 'lost'::text, null::uuid, null::text;
    return;
  end if;
  -- The previous application version neither records an end nor reads a request: nothing is admitted before both cut-offs.
  if not private.takeoff_launch_active() then
    raise exception 'TAKEOFF_LAUNCH_INACTIVE' using errcode = '55000';
  end if;
  if private.takeoff_launch_mark_position(request.tenant_id, request.project_id) <> p_mark then
    perform private.release_takeoff_launch_evaluation(request.id, 'evaluating', null, null, null);
    return query select 'stale'::text, null::uuid, null::text;
    return;
  end if;
  select * into brief from public.affaire_briefs b where b.tenant_id = request.tenant_id and b.project_id = request.project_id;
  failure := case
    when not private.takeoff_module_enabled(request.tenant_id, p_module_default) then 'TAKEOFF_DISABLED'
    when request.payer_id is null or request.execution_host_id is null then 'MANDATE_REQUIRED'
    when request.origin = 'automatic' and brief.status is distinct from 'confirme' then 'BRIEF_NOT_CONFIRMED'
    when not private.takeoff_launch_payer_eligible(request.tenant_id, request.project_id, request.payer_id) then 'PAYER_NOT_ELIGIBLE'
    when exists (select 1 from public.takeoff_launch_requests other where other.tenant_id = request.tenant_id
      and other.project_id = request.project_id and other.state = 'admitted' and other.id <> request.id)
      or private.takeoff_unrequested_analysis_running(request.tenant_id, request.project_id) is not null then 'ANOTHER_ANALYSIS_RUNNING'
  end;
  if failure is not null then
    perform private.release_takeoff_launch_evaluation(request.id,
      case when failure = 'BRIEF_NOT_CONFIRMED' then 'not_eligible' else 'blocked' end, failure, null, p_mark);
    return query select 'blocked'::text, null::uuid, failure;
    return;
  end if;

  begin
    request := private.seal_takeoff_launch_request(request, p_manifest, p_snapshot, p_mark);
    admitted_jobs := private.insert_takeoff_launch_jobs(request, p_job);
    perform private.record_takeoff_launch_audit(request, request.payer_id, 'takeoff.request.admitted', jsonb_build_object(
      'job_ids', to_jsonb(admitted_jobs), 'manifest_digest', request.manifest_digest,
      'execution_host_id', request.execution_host_id, 'mandate_kind', request.mandate_kind)
      || case when request.manifest -> 'format_version' = '2'::jsonb then jsonb_build_object('format_version', 2) else '{}'::jsonb end);
    -- The final comparison, last of everything this admission locks: the dossier key exclusively, which each transaction
    -- that marks a change of the dossier holds shared until it commits. A change committed after the count above (an
    -- annex back to classification, a saved restriction) is counted here, and the admission rolls back with it.
    perform pg_catalog.pg_advisory_xact_lock(private.takeoff_dossier_lock_key(request.project_id));
    if private.takeoff_launch_mark_position(request.tenant_id, request.project_id) <> p_mark then
      raise exception 'TAKEOFF_LAUNCH_DOSSIER_CHANGED' using errcode = '40001';
    end if;
    if request.origin='automatic' and private.intake_current_brief_enforced(request.project_id) then
      if private.intake_brief_state(request.project_id,true)='required' or not exists (
        select 1 from public.affaire_briefs b where b.project_id=request.project_id and b.status='confirme'
      ) then
        raise exception 'INTAKE_ANALYSIS_REQUIRED' using errcode='P0001';
      end if;
    end if;
    if request.selected_plans is not null then
      perform private.assert_takeoff_brief_plans(request.tenant_id,request.project_id,request.selected_plans);
    end if;
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'INTAKE_ANALYSIS_REQUIRED' then raise; end if;
      perform private.release_takeoff_launch_evaluation(p_request_id,'not_eligible','BRIEF_NOT_CONFIRMED',null,p_mark);
      return query select 'blocked'::text,null::uuid,'BRIEF_NOT_CONFIRMED'::text;
      return;
    when sqlstate '40001' then
      if sqlerrm not in ('TAKEOFF_LAUNCH_DOSSIER_CHANGED','INTAKE_BRIEF_INPUT_CHANGED') then raise; end if;
      perform private.release_takeoff_launch_evaluation(p_request_id, 'evaluating', null, null, null);
      return query select 'stale'::text, null::uuid, null::text;
      return;
    when unique_violation then
      -- Another request of the affaire was admitted between the check above and this one: it runs, this one waits.
      get stacked diagnostics violated = constraint_name;
      if violated is distinct from 'takeoff_launch_requests_running_uidx' then raise; end if;
      perform private.release_takeoff_launch_evaluation(p_request_id, 'blocked', 'ANOTHER_ANALYSIS_RUNNING', null, p_mark);
      return query select 'blocked'::text, null::uuid, 'ANOTHER_ANALYSIS_RUNNING'::text;
      return;
    when sqlstate '23514' then
      if sqlerrm <> 'TAKEOFF_JOB_ADMISSION_LIMIT' then raise; end if;
      perform private.release_takeoff_launch_evaluation(p_request_id, 'blocked', 'ADMISSION_LIMIT', null, p_mark);
      return query select 'blocked'::text, null::uuid, 'ADMISSION_LIMIT'::text;
      return;
    when sqlstate '42501' then
      -- A source that moved since the evaluation: evaluate the dossier again, nothing was admitted.
      if sqlerrm not in ('TAKEOFF_PREPARATION_SOURCE_STALE', 'TAKEOFF_PREPARATION_SOURCE_MISMATCH', 'TAKEOFF_PREPARATION_REQUIRED') then
        raise;
      end if;
      perform private.release_takeoff_launch_evaluation(p_request_id, 'evaluating', null, null, null);
      return query select 'stale'::text, null::uuid, null::text;
      return;
  end;
  return query select 'admitted'::text, admitted_jobs[1], null::text;
end;
$$;

-- Selection contains identifiers only. Existing upload readers do not acquire
-- access to another member's connection identity. Two-argument clients keep
-- their existing API; a worker must not infer a missing historical mandate.
create table private.affaire_intake_launch_selections (
  upload_id uuid primary key references public.affaire_intake_uploads(id) on delete cascade,
  profile_id text not null,
  authorization_id text not null
);
revoke all on private.affaire_intake_launch_selections from public,anon,authenticated,service_role;
create function public.start_affaire_intake_analysis(p_project_id uuid,p_read_scans boolean,p_profile_id text,p_authorization_id text)
returns table(outcome text,launch_id uuid,piece_count integer)
language plpgsql security definer set search_path='' as $$
declare reservation record;
begin
  if p_read_scans is null or (p_read_scans and (p_profile_id is null or p_profile_id !~ '^[a-zA-Z0-9_.:-]{1,128}$'
    or p_authorization_id is null or p_authorization_id !~ '^[a-zA-Z0-9_.:-]{1,128}$'))
    or (not p_read_scans and (p_profile_id is not null or p_authorization_id is not null)) then
    raise exception 'INTAKE_SELECTION_INVALID' using errcode='22023';
  end if;
  select * into strict reservation from public.start_affaire_intake_analysis(p_project_id,p_read_scans);
  if p_read_scans and reservation.outcome in ('launched','brief_only') then
    insert into private.affaire_intake_launch_selections values(reservation.launch_id,p_profile_id,p_authorization_id);
  end if;
  return query select reservation.outcome,reservation.launch_id,reservation.piece_count;
end;
$$;
revoke all on function public.start_affaire_intake_analysis(uuid,boolean,text,text) from public,anon,authenticated,service_role;
grant execute on function public.start_affaire_intake_analysis(uuid,boolean,text,text) to authenticated;
create function public.read_affaire_intake_launch_selection(p_upload_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('profileId',profile_id,'authorizationId',authorization_id)
    from private.affaire_intake_launch_selections where upload_id=p_upload_id
$$;
revoke all on function public.read_affaire_intake_launch_selection(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_affaire_intake_launch_selection(uuid) to service_role;

-- 0.9.0 and the durable worker can both finish a historical upload. Its pieces
-- belong to upload_id rather than analysis_launch_id. Completed and manual
-- results stay intact, including when a deletion reservation is later cancelled.
create function private.finish_historical_intake_pieces() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  update public.affaire_intake_documents set classification_status='failed',
    issues=array_append(issues,'Analyse interrompue. Vous pouvez relancer cette pièce.')
    where upload_id=new.id and analysis_launch_id is null and upload_status='uploaded'
      and classification_status in ('queued','processing') and deleted_at is null and deletion_token is null
      and classification_source is distinct from 'manual' and manually_overridden_at is null;
  return null;
end;
$$;
revoke all on function private.finish_historical_intake_pieces() from public,anon,authenticated,service_role;
create trigger finish_historical_intake_pieces after update of status on public.affaire_intake_uploads
  for each row when (new.launch_read_scans is null and new.status='failed' and new.completed_at is not null and old.status in ('queued','processing'))
  execute function private.finish_historical_intake_pieces();

-- The deletion guard forbids changing a reserved document. On cancellation,
-- inspect its upload under a share lock before the piece becomes visible again.
create function private.restore_historical_intake_retry() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if (select u.status from public.affaire_intake_uploads u where u.id=new.upload_id and u.launch_read_scans is null and u.completed_at is not null for share)='failed' then
    new.classification_status:='failed';
    new.issues:=array_append(new.issues,'Analyse interrompue. Vous pouvez relancer cette pièce.');
  end if;
  return new;
end;
$$;
revoke all on function private.restore_historical_intake_retry() from public,anon,authenticated,service_role;
create trigger restore_historical_intake_retry before update of deletion_token on public.affaire_intake_documents
  for each row when (old.deletion_token is not null and new.deletion_token is null and new.deleted_at is null
    and new.analysis_launch_id is null and new.upload_status='uploaded' and new.classification_status in ('queued','processing')
    and new.classification_source is distinct from 'manual' and new.manually_overridden_at is null)
  execute function private.restore_historical_intake_retry();

update public.affaire_intake_documents d set classification_status='failed',
  issues=array_append(d.issues,'Analyse interrompue. Vous pouvez relancer cette pièce.')
from public.affaire_intake_uploads u where d.upload_id=u.id and u.status='failed' and u.completed_at is not null and u.launch_read_scans is null
  and d.analysis_launch_id is null and d.upload_status='uploaded' and d.classification_status in ('queued','processing')
  and d.deleted_at is null and d.deletion_token is null and d.classification_source is distinct from 'manual' and d.manually_overridden_at is null;
commit;
