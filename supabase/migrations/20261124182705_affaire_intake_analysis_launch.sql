begin;
set local lock_timeout = '5s';

-- The original upload owns the Storage path and the deposit history. The launch is a separate
-- upload whose lease covers all selected documents and their single brief refresh.
alter table public.affaire_intake_uploads
  add column launch_read_scans boolean,
  drop constraint affaire_intake_uploads_status_check,
  add constraint affaire_intake_uploads_status_check check (
    (launch_read_scans is null and status in ('queued','processing','ready','failed','partial_failure','deposited'))
    or (launch_read_scans is not null and status in ('launch_queued','launch_processing','ready','failed','partial_failure'))
  );
alter table public.affaire_intake_documents
  add column analysis_launch_id uuid references public.affaire_intake_uploads(id) deferrable initially deferred,
  drop constraint affaire_intake_documents_classification_status_check,
  add constraint affaire_intake_documents_classification_status_check check (
    classification_status in ('awaiting_launch','queued','processing','classified','ambiguous','failed')
    and (classification_status <> 'awaiting_launch' or analysis_launch_id is null)
  );
create unique index affaire_intake_one_active_launch on public.affaire_intake_uploads(project_id)
  where status in ('launch_queued','launch_processing');
create index affaire_intake_launch_due on public.affaire_intake_uploads(status,next_retry_at,processing_lease_expires_at)
  where status in ('launch_queued','launch_processing');
create index affaire_intake_documents_launch on public.affaire_intake_documents(analysis_launch_id,id)
  where analysis_launch_id is not null;

-- Existing table grants let project writers update ordinary intake rows. Only the launch RPC
-- creates a payer record or assigns its pieces. A deposited upload never enters the legacy queue.
create function private.guard_intake_launch_upload() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.status = 'deposited' and new.status <> 'deposited' then
    raise exception 'INTAKE_DEPOSIT_NOT_RUNNABLE' using errcode='23514';
  end if;
  if current_user in ('authenticated','anon') and
    ((tg_op <> 'DELETE' and new.launch_read_scans is not null) or
     (tg_op <> 'INSERT' and old.launch_read_scans is not null)) then
    raise exception 'INTAKE_LAUNCH_PROTECTED' using errcode='42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
-- A parent affaire deletion cascades through intake. Keep that existing path available.
create trigger guard_intake_launch_upload before insert or update on public.affaire_intake_uploads
  for each row execute function private.guard_intake_launch_upload();
create trigger guard_intake_launch_delete before delete on public.affaire_intake_uploads
  for each row when (old.launch_read_scans is not null and pg_trigger_depth() = 0)
  execute function private.guard_intake_launch_upload();

create function private.guard_intake_launch_assignment() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated','anon') and
    (new.analysis_launch_id is not null and tg_op='INSERT' or tg_op='UPDATE' and
      (old.analysis_launch_id is distinct from new.analysis_launch_id or
       (old.analysis_launch_id is not null and (old.upload_id,old.id) is distinct from (new.upload_id,new.id)))) then
    raise exception 'INTAKE_LAUNCH_PROTECTED' using errcode='42501';
  end if;
  return new;
end;
$$;
create trigger guard_intake_launch_assignment before insert or update of analysis_launch_id,upload_id,id
  on public.affaire_intake_documents for each row execute function private.guard_intake_launch_assignment();

-- Storage paths and the launch receipt refer to the original deposit. Scope assignment
-- triggers have already derived the final tenant and project when these checks run.
create function private.reject_intake_scope_move() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'INTAKE_SCOPE_IMMUTABLE' using errcode = '23514';
end;
$$;
create trigger guard_intake_upload_scope_move after update on public.affaire_intake_uploads
  for each row when ((new.tenant_id, new.project_id) is distinct from (old.tenant_id, old.project_id))
  execute function private.reject_intake_scope_move();
create trigger guard_intake_document_scope_move after update on public.affaire_intake_documents
  for each row when ((new.tenant_id, new.project_id, new.upload_id) is distinct from (old.tenant_id, old.project_id, old.upload_id))
  execute function private.reject_intake_scope_move();
create trigger guard_intake_brief_scope_move after update on public.affaire_briefs
  for each row when ((new.tenant_id, new.project_id) is distinct from (old.tenant_id, old.project_id))
  execute function private.reject_intake_scope_move();

-- Return unfinished work at the moment its deletion is reserved. An eventual tombstone
-- removes it; releasing the reservation exposes it to the next launch, even when the old
-- worker exhausted its retries or finished during the Storage request.
create function private.release_reserved_intake_piece() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.analysis_launch_id := null;
  new.classification_status := 'awaiting_launch';
  return new;
end;
$$;
create trigger release_reserved_intake_piece before update of deletion_token on public.affaire_intake_documents
  for each row when (old.deletion_token is null and new.deletion_token is not null
    and new.analysis_launch_id is not null and new.classification_status in ('queued','processing')
    and new.deleted_at is null and new.manually_overridden_at is null and new.classification_source is distinct from 'manual')
  execute function private.release_reserved_intake_piece();

create function private.lock_affaire_intake_analysis(p_project_id uuid) returns void language sql set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('intake-analysis:' || p_project_id::text,0))
$$;
create function private.intake_piece_waits(d public.affaire_intake_documents) returns boolean
language sql immutable set search_path = '' as $$
  select d.classification_status='awaiting_launch' and d.upload_status='uploaded' and d.deleted_at is null
    and d.manually_overridden_at is null and d.classification_source is distinct from 'manual'
$$;

-- A completed deposit invalidates a previous confirmation without generating a brief. Lock the
-- brief before the analysis key, the order also used by the server's confirmation transaction.
create function private.publish_waiting_intake_piece() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='UPDATE' and private.intake_piece_waits(old) then return null; end if;
  if not exists(select 1 from public.affaire_intake_uploads u where u.id=new.upload_id and u.status='deposited') then
    raise exception 'INTAKE_DEPOSIT_REQUIRED' using errcode='23514';
  end if;
  perform 1 from public.affaire_briefs b where b.project_id=new.project_id for update;
  perform private.lock_affaire_intake_analysis(new.project_id);
  update public.affaire_briefs set status='a_confirmer',confirmed_at=null,confirmed_by=null
    where project_id=new.project_id and status='confirme';
  return null;
end;
$$;
create trigger publish_waiting_intake_piece after insert or update on public.affaire_intake_documents
  for each row when (new.classification_status='awaiting_launch' and new.upload_status='uploaded' and new.deleted_at is null
    and new.manually_overridden_at is null and new.classification_source is distinct from 'manual')
  execute function private.publish_waiting_intake_piece();

create function private.guard_intake_brief_confirmation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.lock_affaire_intake_analysis(new.project_id);
  if exists(select 1 from public.affaire_intake_documents d where d.project_id=new.project_id and private.intake_piece_waits(d)) then
    raise exception 'INTAKE_ANALYSIS_REQUIRED' using hint='Lancez l’analyse ou retirez les pièces en attente avant de confirmer.';
  end if;
  if exists(select 1 from public.affaire_intake_uploads u where u.project_id=new.project_id and u.status in ('launch_queued','launch_processing')) then
    raise exception 'INTAKE_ANALYSIS_RUNNING' using hint='Attendez la fin de l’analyse du dossier avant de confirmer.';
  end if;
  return new;
end;
$$;
-- WITH CHECK and scope assignment must finish before the privileged business check.
create trigger guard_insert_intake_confirmation after insert on public.affaire_briefs
  for each row when (new.status='confirme') execute function private.guard_intake_brief_confirmation();
create trigger guard_update_intake_confirmation after update of status on public.affaire_briefs
  for each row when (new.status='confirme' and old.status is distinct from new.status) execute function private.guard_intake_brief_confirmation();

create function public.launch_affaire_intake_analysis(p_project_id uuid,p_read_scans boolean)
returns table(outcome text,launch_id uuid,piece_count integer)
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  tenant uuid := public.current_tenant_id();
  active_batch uuid;
  batch uuid;
  pieces uuid[];
begin
  if p_read_scans is null then raise exception 'INTAKE_READING_CHOICE_REQUIRED' using errcode='22023'; end if;
  -- Take the project's share lock first, as the server's brief confirmation does.
  perform 1 from public.estimate_projects p join public.tenant_memberships m on m.tenant_id=p.tenant_id
    where p.id=p_project_id and p.tenant_id=tenant and not p.is_archived and m.user_id=actor
      and (p.user_id=actor or m.role='admin') for share of p;
  if not found then
    raise exception 'INTAKE_LAUNCH_FORBIDDEN' using errcode='42501';
  end if;
  perform private.lock_affaire_intake_analysis(p_project_id);
  select u.id into active_batch from public.affaire_intake_uploads u where u.project_id=p_project_id
    and u.status in ('launch_queued','launch_processing');
  if active_batch is null then
    select array_agg(eligible.id) into pieces from (
      select d.id from public.affaire_intake_documents d
      where d.project_id=p_project_id and d.tenant_id=tenant and private.intake_piece_waits(d) and d.deletion_token is null
      order by d.id for update
    ) eligible;
  end if;

  -- A piece may have kept this press waiting while a default tenant was reactivated.
  -- Hold every membership and its tenant (including suspended ones) through commit.
  perform 1 from public.tenant_memberships m join public.tenants t on t.id=m.tenant_id
    where m.user_id=actor for share of m,t;
  -- Decide every outcome on fresh permissions. Gate the insert in this same statement
  -- so it also sees any newly added membership visible at the point of reservation.
  with allowed as (
    select m.user_id from public.estimate_projects p join public.tenant_memberships m on m.tenant_id=p.tenant_id
    where p.id=p_project_id and p.tenant_id=tenant and p.tenant_id=public.current_tenant_id()
      and not p.is_archived and m.user_id=actor and (p.user_id=actor or m.role='admin')
  ), reserved as (
    insert into public.affaire_intake_uploads(project_id,tenant_id,created_by,status,launch_read_scans)
      select p_project_id,tenant,allowed.user_id,'launch_queued',p_read_scans from allowed
      where active_batch is null and pieces is not null
      returning id
  )
  select reserved.id into batch from allowed left join reserved on true;
  if not found then
    raise exception 'INTAKE_LAUNCH_FORBIDDEN' using errcode = '42501';
  end if;
  if active_batch is not null then return query select 'already_running'::text,active_batch,0; return; end if;
  if pieces is null then return query select 'nothing_waiting'::text,null::uuid,0; return; end if;
  update public.affaire_intake_documents set analysis_launch_id=batch,classification_status='queued' where id=any(pieces);
  return query select 'launched'::text,batch,cardinality(pieces);
end;
$$;

-- Either the immediate worker targets its launch, or a recovery worker takes the next due one.
-- Legacy workers cannot see either runnable status. Losing the payer account leaves a NULL
-- payer and never substitutes the creator of a document.
create function public.claim_affaire_intake_analysis_launch(p_lease_token uuid,p_upload_id uuid default null)
returns table(upload_id uuid,tenant_id uuid,project_id uuid,payer_id uuid,read_scans boolean,attempt_count integer)
language plpgsql set search_path = '' as $$
declare
  batch public.affaire_intake_uploads%rowtype;
  at_time timestamptz := clock_timestamp();
begin
  if p_lease_token is null then raise exception 'INTAKE_LEASE_TOKEN_REQUIRED' using errcode='22023'; end if;
  select u.* into batch from public.affaire_intake_uploads u join public.tenants t on t.id=u.tenant_id and t.is_active
    where (p_upload_id is null or u.id=p_upload_id) and (
      (u.status='launch_queued' and coalesce(u.next_retry_at,u.created_at)<=at_time) or
      (u.status='launch_processing' and u.processing_lease_expires_at<=at_time))
    order by coalesce(u.next_retry_at,u.processing_lease_expires_at,u.created_at),u.id limit 1 for update of u skip locked;
  if not found then return; end if;
  if batch.attempt_count>=3 then
    update public.affaire_intake_documents set classification_status='failed',
      issues=array_append(issues,'Le traitement a épuisé ses reprises.')
      where analysis_launch_id=batch.id and classification_status in ('queued','processing') and deleted_at is null and deletion_token is null
        and manually_overridden_at is null and classification_source is distinct from 'manual';
    update public.affaire_intake_uploads set status='failed',completed_at=at_time,next_retry_at=null,
      last_error='Le traitement a épuisé ses reprises.',processing_lease_token=null,processing_lease_expires_at=null where id=batch.id;
    return;
  end if;
  update public.affaire_intake_documents set classification_status='queued' where analysis_launch_id=batch.id
    and classification_status='processing' and deleted_at is null and deletion_token is null and manually_overridden_at is null and classification_source is distinct from 'manual';
  update public.affaire_intake_uploads u set status='launch_processing',attempt_count=u.attempt_count+1,
    processing_lease_token=p_lease_token,processing_lease_expires_at=at_time+interval '10 minutes',next_retry_at=null,last_error=null
    where u.id=batch.id;
  return query select batch.id,batch.tenant_id,batch.project_id,batch.created_by,batch.launch_read_scans,batch.attempt_count+1;
end;
$$;

revoke all on function private.reject_intake_scope_move(),private.release_reserved_intake_piece(),
  private.guard_intake_launch_upload(),private.guard_intake_launch_assignment(),
  private.lock_affaire_intake_analysis(uuid),private.intake_piece_waits(public.affaire_intake_documents),
  private.publish_waiting_intake_piece(),private.guard_intake_brief_confirmation()
  from public,anon,authenticated,service_role;
revoke all on function public.launch_affaire_intake_analysis(uuid,boolean) from public,anon,service_role;
grant execute on function public.launch_affaire_intake_analysis(uuid,boolean) to authenticated;
revoke all on function public.claim_affaire_intake_analysis_launch(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_affaire_intake_analysis_launch(uuid,uuid) to service_role;

-- The same token fence and retry backoff serve both generations of workers.
create or replace function public.renew_affaire_intake_upload_lease(
  p_upload_id uuid,
  p_lease_token uuid,
  p_now timestamptz,
  p_lease_expires_at timestamptz
)
returns boolean
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_renewed boolean := false;
begin
  if p_upload_id is null
    or p_lease_token is null
    or p_now is null
    or p_lease_expires_at is null
    or p_lease_expires_at <= p_now
  then
    raise exception 'AFFAIRE_INTAKE_RENEW_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  update public.affaire_intake_uploads as upload_row
  set processing_lease_expires_at = p_lease_expires_at
  from public.tenants as tenant_row
  where upload_row.id = p_upload_id
    and upload_row.tenant_id = tenant_row.id
    and tenant_row.is_active
    and upload_row.status in ('processing', 'launch_processing')
    and upload_row.processing_lease_token = p_lease_token
    and upload_row.processing_lease_expires_at > p_now
  returning true into v_renewed;

  return coalesce(v_renewed, false);
end;
$$;

create or replace function public.finish_affaire_intake_upload_attempt(
  p_upload_id uuid,
  p_lease_token uuid,
  p_status text,
  p_now timestamptz,
  p_next_retry_at timestamptz default null,
  p_last_error text default null
)
returns boolean
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_finished boolean := false;
begin
  if p_upload_id is null
    or p_lease_token is null
    or p_now is null
    or p_status not in ('queued', 'ready', 'partial_failure', 'failed')
    or (p_status = 'queued' and p_next_retry_at is null)
    or (p_status <> 'queued' and p_next_retry_at is not null)
  then
    raise exception 'AFFAIRE_INTAKE_FINISH_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  update public.affaire_intake_uploads as upload_row
  set
    status = case when p_status = 'queued' and upload_row.launch_read_scans is not null then 'launch_queued' else p_status end,
    next_retry_at = p_next_retry_at,
    last_error = p_last_error,
    completed_at = case when p_status = 'queued' then null else p_now end,
    processing_lease_token = null,
    processing_lease_expires_at = null
  from public.tenants as tenant_row
  where upload_row.id = p_upload_id
    and upload_row.tenant_id = tenant_row.id
    and tenant_row.is_active
    and upload_row.status in ('processing', 'launch_processing')
    and upload_row.processing_lease_token = p_lease_token
    and upload_row.processing_lease_expires_at > p_now
    and (upload_row.launch_read_scans is null or p_status in ('queued','failed') or not exists (
      select 1 from public.affaire_intake_documents d where d.analysis_launch_id=upload_row.id
        and d.deleted_at is null and d.classification_status in ('queued','processing')
        and d.classification_source is distinct from 'manual' and d.manually_overridden_at is null))
  returning true into v_finished;

  if v_finished and p_status = 'failed' then
    update public.affaire_intake_documents set classification_status='failed',
      issues=array_append(issues,'Le traitement a été interrompu.')
      where analysis_launch_id=p_upload_id and classification_status in ('queued','processing')
        and deleted_at is null and deletion_token is null and manually_overridden_at is null and classification_source is distinct from 'manual';
  end if;

  return coalesce(v_finished, false);
end;
$$;

commit;
