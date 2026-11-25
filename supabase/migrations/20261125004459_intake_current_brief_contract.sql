begin;
set local lock_timeout='5s';

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

create function private.enter_intake_launch_contract() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from private.affaire_intake_contracts where project_id=new.project_id) then
    -- The same transaction can next insert a waiting piece, which locks the brief.
    -- Match the confirmer's order before taking the shared dossier advisory lock.
    perform 1 from public.affaire_briefs where project_id=new.project_id for update;
    perform private.lock_affaire_intake_analysis(new.project_id);
    insert into private.affaire_intake_contracts(project_id) values(new.project_id) on conflict do nothing;
  end if;
  return null;
end;
$$;
revoke all on function private.enter_intake_launch_contract() from public,anon,authenticated,service_role;
create trigger enter_intake_launch_contract after insert or update of status on public.affaire_intake_uploads
  for each row when (new.status='deposited' or new.status='launch_queued') execute function private.enter_intake_launch_contract();

insert into private.affaire_intake_contracts(project_id,published_brief_id,published_upload_id,published_revision)
select e.project_id,b.id,u.id,u.brief_published_revision from (
  select distinct project_id from public.affaire_intake_uploads where status='deposited' or launch_read_scans is not null
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

-- A missing Storage row cannot be locked. Pair a lock on its object name
-- with the publisher/confirmation's snapshot so restoring an original cannot
-- slip past validation. The Storage trigger reads no dossier or credentials.
create function private.lock_intake_plan_original() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('intake-brief-original:'||new.name,0));
  return null;
end;
$$;
revoke all on function private.lock_intake_plan_original() from public,anon,authenticated,service_role;
create trigger lock_intake_plan_original after insert or update of name,bucket_id,metadata on storage.objects
  for each row when (new.bucket_id='affaire-intake') execute function private.lock_intake_plan_original();

-- Human plan decisions are inputs. Their append-only receipts survive regeneration
-- and do not feed the generator's own output back into its input revision.
create index intake_plan_decisions_by_project on public.affaire_intake_events(project_id)
  where event_type='brief.updated' and reason='plans.marked_received';
create or replace function public.read_affaire_intake_brief_inputs(p_project_id uuid,p_lock_inputs boolean default false) returns jsonb
language plpgsql security invoker set search_path='' set timezone='UTC' as $$
begin
  -- Publication and closure fence the same inputs through commit. Parent locks
  -- fence new FK references; Storage writes for plan files also lock their file.
  -- NOWAIT avoids a cycle with a writer already waiting for the brief or lot.
  if p_lock_inputs then
    perform 1 from public.affaire_briefs where project_id=p_project_id for share nowait;
    perform 1 from public.estimate_projects where id=p_project_id for update nowait;
    perform 1 from public.affaire_intake_documents d where d.project_id=p_project_id order by d.id for share nowait;
    perform 1 from public.plan_sets s where s.project_id=p_project_id order by s.id for update nowait;
    perform 1 from public.plan_files f join public.plan_sets s on s.id=f.plan_set_id
      where s.project_id=p_project_id order by f.id for no key update of f nowait;
    perform 1 from storage.objects o join public.plan_files f on o.bucket_id='plan-files' and o.name=f.file_path
      join public.plan_sets s on s.id=f.plan_set_id where s.project_id=p_project_id order by o.id for share of o nowait;
    if exists(with originals as materialized (
      select distinct d.storage_path from public.affaire_intake_documents d where d.project_id=p_project_id and d.storage_path is not null
        and d.document_kind='plans' and d.classification_status='classified' and d.deleted_at is null and d.deletion_token is null
    ) select 1 from originals where not pg_try_advisory_xact_lock_shared(hashtextextended('intake-brief-original:'||storage_path,0))) then
      raise exception 'INTAKE_BRIEF_INPUT_CHANGED' using errcode='40001';
    end if;
    perform 1 from storage.objects o join public.affaire_intake_documents d on o.name=d.storage_path
      where o.bucket_id='affaire-intake' and d.project_id=p_project_id and d.document_kind='plans'
        and d.classification_status='classified' and d.deleted_at is null and d.deletion_token is null order by o.id for share of o nowait;
  end if;
  return (with documents as materialized (
    select d.id,d.file_name,d.document_kind,d.confidence,d.issues,d.extracted_metadata,
      d.classification_status,d.updated_at,d.created_at
    from public.affaire_intake_documents d where d.project_id=p_project_id
      and d.deleted_at is null and d.deletion_token is null and d.upload_status='uploaded'
      and d.classification_status<>'awaiting_launch'
  ), snapshot as (
    select jsonb_build_object(
      'project',jsonb_build_object('id',p.id,'name',p.name,'reference',p.reference,'client_name',p.client_name,'user_id',p.user_id),
      'documents',coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at,d.id) from documents d),'[]'),
      'missing_piece_codes',coalesce((select jsonb_agg('missing_'||k.kind order by k.ordinal)
        from unnest(array['dpgf','plans','cctp','bpu_dqe']) with ordinality k(kind,ordinal)
        where not case when k.kind='plans' then public.affaire_has_stored_plan(p.id)
          else exists(select 1 from documents d where d.classification_status='classified' and d.document_kind=k.kind) end),'[]')
    ) || jsonb_strip_nulls(jsonb_build_object(
      'standalone_plans',(select jsonb_agg(jsonb_build_array(f.id,f.file_name,f.file_path,f.file_size_bytes,o.id,o.version) order by f.id)
        from public.plan_sets s join public.plan_files f on f.plan_set_id=s.id and f.tenant_id=s.tenant_id
        join storage.objects o on o.bucket_id='plan-files' and o.name=f.file_path
        where s.project_id=p.id and s.tenant_id=p.tenant_id and coalesce(f.metadata->>'source','')<>'affaire-intake'
          and coalesce(f.metadata->>'intake_cleanup_pending','false')<>'true' and f.file_size_bytes>0
          and case when jsonb_typeof(o.metadata->'size')='number' then (o.metadata->>'size')::numeric=f.file_size_bytes else false end),
      'plan_decisions',(select nullif(count(*),0) from public.affaire_intake_events e where e.project_id=p.id
        and e.event_type='brief.updated' and e.reason='plans.marked_received')
    )) as inputs
    from public.estimate_projects p where p.id=p_project_id
  )
  select inputs || jsonb_build_object('revision',encode(sha256(convert_to(inputs::text,'UTF8')),'hex'),
    'brief_updated_at',(select b.updated_at from public.affaire_briefs b where b.project_id=p_project_id)) from snapshot);
exception when lock_not_available then
  raise exception 'INTAKE_BRIEF_INPUT_CHANGED' using errcode='40001';
end;
$$;

-- The interactive reader uses an ordinary snapshot. Both the reservation and
-- confirmation request the same locked snapshot as the publisher.
create function private.intake_brief_state(p_project_id uuid,p_lock_inputs boolean) returns text
language plpgsql security definer set search_path='' as $$
declare receipt private.affaire_intake_contracts%rowtype; snapshot jsonb; brief uuid; source_upload uuid;
begin
  if not exists(select 1 from private.affaire_intake_contracts where project_id=p_project_id) then return 'legacy'; end if;
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
  select private.intake_brief_state(p_project_id,true)='required'
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
  if not exists(select 1 from private.affaire_intake_contracts where project_id=p_project_id) then return true; end if;
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
  for each row when (new.launch_read_scans is null and new.status='failed' and old.status in ('queued','processing'))
  execute function private.finish_historical_intake_pieces();

-- The deletion guard forbids changing a reserved document. On cancellation,
-- inspect its upload under a share lock before the piece becomes visible again.
create function private.restore_historical_intake_retry() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if (select u.status from public.affaire_intake_uploads u where u.id=new.upload_id and u.launch_read_scans is null for share)='failed' then
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
from public.affaire_intake_uploads u where d.upload_id=u.id and u.status='failed' and u.launch_read_scans is null
  and d.analysis_launch_id is null and d.upload_status='uploaded' and d.classification_status in ('queued','processing')
  and d.deleted_at is null and d.deletion_token is null and d.classification_source is distinct from 'manual' and d.manually_overridden_at is null;
commit;
