begin;
set local lock_timeout = '5s';

-- The worker records completion only after classification and the selected readings.
-- In particular, a terminal classification by itself does not mean that OCR finished.
alter table public.affaire_intake_documents add column analysis_completed_at timestamptz;
create function private.guard_intake_piece_completion() returns trigger
language plpgsql set search_path='' as $$
begin
  if current_user in ('authenticated','anon') and
     (tg_op='INSERT' and new.analysis_completed_at is not null or
      tg_op='UPDATE' and old.analysis_completed_at is distinct from new.analysis_completed_at) then
    raise exception 'INTAKE_LAUNCH_PROTECTED' using errcode='42501';
  end if;
  if new.analysis_launch_id is null or
     (tg_op='UPDATE' and old.analysis_launch_id is distinct from new.analysis_launch_id) then
    new.analysis_completed_at := null;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_intake_piece_completion() from public,anon,authenticated,service_role;
create trigger guard_intake_piece_completion before insert or update of analysis_launch_id,analysis_completed_at
  on public.affaire_intake_documents for each row execute function private.guard_intake_piece_completion();

-- Classification can finish before OCR. Detach an unfinished reading when deletion
-- reserves the piece, while the row is still writable. Cancelling the deletion then
-- exposes it for the next launch, even if its original launch closed in the meantime.
create or replace trigger release_reserved_intake_piece before update of deletion_token on public.affaire_intake_documents
  for each row when (old.deletion_token is null and new.deletion_token is not null and new.analysis_launch_id is not null
    and (new.analysis_completed_at is null or new.classification_status in ('queued','processing'))
    and new.deleted_at is null and new.manually_overridden_at is null and new.classification_source is distinct from 'manual')
  execute function private.release_reserved_intake_piece();

-- A failed explicit launch still owes the dossier a publication, even if every
-- reading finished. Only a successful guarded generation acknowledges that work.
alter table public.affaire_intake_uploads add column brief_published_at timestamptz;
create index affaire_intake_unpublished_launches on public.affaire_intake_uploads(project_id)
  where status='failed' and launch_read_scans is not null and brief_published_at is null;

create function private.intake_brief_publication_due(p_project_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists (select 1 from public.affaire_intake_uploads
    where project_id=p_project_id and status='failed' and launch_read_scans is not null and brief_published_at is null)
$$;
revoke all on function private.intake_brief_publication_due(uuid) from public,anon,authenticated,service_role;

-- The existing AFTER confirmation guard has already checked scope, waiting pieces
-- and active launches under the affaire lock. A failed generation is a fourth state.
create function private.require_intake_brief_publication() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if private.intake_brief_publication_due(new.project_id) then
    raise exception 'INTAKE_ANALYSIS_REQUIRED' using hint='Lancez l’analyse pour actualiser le brief avant de confirmer.';
  end if;
  return null;
end;
$$;
revoke all on function private.require_intake_brief_publication() from public,anon,authenticated,service_role;
create trigger require_intake_publication_on_insert after insert on public.affaire_briefs
  for each row when (new.status='confirme') execute function private.require_intake_brief_publication();
create trigger require_intake_publication_on_update after update of status on public.affaire_briefs
  for each row when (new.status='confirme' and old.status is distinct from new.status)
  execute function private.require_intake_brief_publication();

-- Same active membership selection as current_tenant_id(), for a worker without a session cookie.
create function public.intake_payer_can_write(p_user_id uuid,p_tenant_id uuid,p_project_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists (
    select 1 from public.estimate_projects p cross join lateral (
      select m.role,m.tenant_id from public.tenant_memberships m join public.tenants t on t.id=m.tenant_id
      where m.user_id=p_user_id and t.is_active order by m.is_default desc,m.created_at asc limit 1
    ) member
    where p.id=p_project_id and p.tenant_id=p_tenant_id and member.tenant_id=p.tenant_id and not p.is_archived
      and (p.user_id=p_user_id or member.role='admin')
  )
$$;

-- Reuse the authenticated reservation, including its project, dossier and active-membership locks.
-- A first dossier classified wholly by hand can still ask for its brief with no piece to read.
create function public.start_affaire_intake_analysis(p_project_id uuid,p_read_scans boolean)
returns table(outcome text,launch_id uuid,piece_count integer)
language plpgsql security definer set search_path='' as $$
declare reservation record;
begin
  select * into strict reservation from public.launch_affaire_intake_analysis(p_project_id,p_read_scans);
  if reservation.outcome='nothing_waiting' then
    insert into public.affaire_intake_uploads(project_id,tenant_id,created_by,status,launch_read_scans)
    select p.id,p.tenant_id,auth.uid(),'launch_queued',p_read_scans from public.estimate_projects p
    where p.id=p_project_id and public.intake_payer_can_write(auth.uid(),p.tenant_id,p.id)
      and (private.intake_brief_publication_due(p.id) or (
        not exists(select 1 from public.affaire_briefs b where b.project_id=p.id)
        and exists(select 1 from public.affaire_intake_documents d join public.affaire_intake_uploads u on u.id=d.upload_id
          where d.project_id=p.id and u.status='deposited' and d.upload_status='uploaded'
            and d.deleted_at is null and d.deletion_token is null and
            (d.classification_source='manual' or d.manually_overridden_at is not null or d.analysis_completed_at is not null))))
      and not exists(select 1 from public.affaire_intake_documents d where d.project_id=p.id and d.deleted_at is null
        and d.upload_status='uploaded' and (d.deletion_token is not null or d.classification_status in ('queued','processing','awaiting_launch')))
    returning id into launch_id;
    if found then outcome:='brief_only'; piece_count:=0; return next; return; end if;
  end if;
  return query select reservation.outcome,reservation.launch_id,reservation.piece_count;
end;
$$;

-- A live lease belongs to its holder. A disconnected Mac cannot take it. With no
-- useful host, the hosted scheduler retires it 30 minutes after it last became due.
create function public.stop_affaire_intake_analysis(p_upload_id uuid,p_lease_token uuid)
returns text language plpgsql security invoker set search_path='' as $$
declare
  batch public.affaire_intake_uploads%rowtype;
  at_time timestamptz;
  due_at timestamptz;
  reason text;
  notice text;
begin
  select * into batch from public.affaire_intake_uploads where id=p_upload_id
    and status in ('launch_queued','launch_processing') for update;
  if not found then return null; end if;
  at_time:=clock_timestamp();
  due_at:=case when batch.status='launch_processing' then batch.processing_lease_expires_at else coalesce(batch.next_retry_at,batch.created_at) end;
  if p_lease_token is not null then
    if batch.status<>'launch_processing' or batch.processing_lease_token is distinct from p_lease_token or due_at<=at_time then return null; end if;
  elsif due_at is null or due_at>at_time then return null;
  end if;
  if not public.intake_payer_can_write(batch.created_by,batch.tenant_id,batch.project_id) then
    reason:='payer_access_lost';
    notice:='Analyse interrompue : le membre qui l’a lancée ne peut plus modifier ce dossier. Lancez une nouvelle analyse.';
  elsif p_lease_token is null and batch.launch_read_scans and due_at<=at_time-interval '30 minutes' then
    reason:='connection_unavailable';
    notice:='Lecture interrompue : aucune connexion ChatGPT disponible pour ce lancement. Lancez une nouvelle analyse.';
  else return null;
  end if;
  update public.affaire_intake_documents set analysis_launch_id=null,classification_status='awaiting_launch',
    issues=array_prepend(notice,array_remove(issues,notice))
  where analysis_launch_id=batch.id and deleted_at is null and analysis_completed_at is null
    and classification_source is distinct from 'manual' and manually_overridden_at is null;
  update public.affaire_intake_uploads set status='failed',completed_at=at_time,last_error=reason,next_retry_at=null,
    processing_lease_token=null,processing_lease_expires_at=null where id=batch.id;
  return reason;
end;
$$;

-- The worker reads this snapshot once and builds the model and fallback inputs from
-- its project, ordered documents and missing categories. The digest is made by the
-- same database that compares it; the worker never has to serialize a timestamp.
create function public.read_affaire_intake_brief_inputs(p_project_id uuid) returns jsonb
language sql stable security invoker set search_path='' set timezone='UTC' as $$
  with documents as materialized (
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
    ) as inputs
    from public.estimate_projects p where p.id=p_project_id
  )
  select inputs || jsonb_build_object('revision',encode(sha256(convert_to(inputs::text,'UTF8')),'hex'),
    'brief_updated_at',(select b.updated_at from public.affaire_briefs b where b.project_id=p_project_id)) from snapshot
$$;
revoke all on function public.read_affaire_intake_brief_inputs(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_affaire_intake_brief_inputs(uuid) to service_role;

-- Publish one model response and its sources in a single transaction. All generation
-- paths (historical worker, explicit launch, authorised document edit) share this CAS.
create function public.publish_affaire_intake_brief(
  p_upload_id uuid,p_lease_token uuid,p_actor_id uuid,p_expected_revision text,
  p_expected_brief_updated_at timestamptz,p_draft jsonb,p_sources jsonb
) returns uuid language plpgsql security invoker set search_path='' as $$
declare
  project public.estimate_projects%rowtype;
  batch public.affaire_intake_uploads%rowtype;
  prior public.affaire_briefs%rowtype;
  next_brief public.affaire_briefs%rowtype;
  keep_confirmation boolean;
  brief_id uuid;
  snapshot jsonb;
begin
  -- Confirmation locks the brief before the project. For a first generation the
  -- unique insert is that lock: another first publisher either rolls back or wins.
  -- This initial row is visible only if the whole publication (including sources) commits.
  select * into strict batch from public.affaire_intake_uploads where id=p_upload_id;
  select * into prior from public.affaire_briefs b where b.project_id=batch.project_id for update;
  if prior.updated_at is distinct from p_expected_brief_updated_at then
    raise exception 'INTAKE_BRIEF_INPUT_CHANGED' using errcode='40001';
  end if;
  if prior.id is null and p_draft is not null then
    insert into public.affaire_briefs(project_id,tenant_id,upload_id,status,summary,project_object,created_by)
      values(batch.project_id,batch.tenant_id,batch.id,'a_confirmer',p_draft->>'summary',p_draft->>'project_object',p_actor_id)
      on conflict (project_id) do nothing;
    if not found then raise exception 'INTAKE_BRIEF_INPUT_CHANGED' using errcode='40001'; end if;
  end if;

  -- The parent locks fence new FK references. Storage writes for plan files also
  -- lock their plan_file; lock existing intake objects for size changes and removal.
  -- Writers that already own a piece or a plan may themselves be waiting for this
  -- brief. Refuse this response for retry rather than completing a lock cycle.
  begin
    select * into strict project from public.estimate_projects where id=batch.project_id for update nowait;
    select * into strict batch from public.affaire_intake_uploads where id=p_upload_id for no key update nowait;
    perform 1 from public.affaire_intake_documents d where d.project_id=project.id order by d.id for share nowait;
    perform 1 from public.plan_sets s where s.project_id=project.id order by s.id for update nowait;
    perform 1 from public.plan_files f join public.plan_sets s on s.id=f.plan_set_id
      where s.project_id=project.id order by f.id for no key update of f nowait;
    perform 1 from storage.objects o join public.affaire_intake_documents d on o.name=d.storage_path
      where o.bucket_id='affaire-intake' and d.project_id=project.id and d.document_kind='plans'
        and d.classification_status='classified' and d.deleted_at is null and d.deletion_token is null order by o.id for share of o nowait;
  exception when lock_not_available then
    raise exception 'INTAKE_BRIEF_INPUT_CHANGED' using errcode='40001';
  end;
  if project.is_archived then raise exception 'INTAKE_PUBLICATION_FORBIDDEN' using errcode='42501'; end if;
  if p_lease_token is null then
    if not public.intake_payer_can_write(p_actor_id,project.tenant_id,project.id) then
      raise exception 'INTAKE_PUBLICATION_FORBIDDEN' using errcode='42501';
    end if;
  elsif batch.status not in ('processing','launch_processing') or batch.processing_lease_token is distinct from p_lease_token
      or batch.processing_lease_expires_at is null or batch.processing_lease_expires_at<=clock_timestamp() then
    raise exception 'INTAKE_LEASE_LOST' using errcode='40001';
  elsif batch.launch_read_scans is not null and not public.intake_payer_can_write(batch.created_by,project.tenant_id,project.id) then
    raise exception 'INTAKE_PUBLICATION_FORBIDDEN' using errcode='42501';
  end if;

  if jsonb_typeof(p_sources) is distinct from 'array' then
    raise exception 'INTAKE_BRIEF_INVALID' using errcode='22023';
  end if;
  snapshot:=public.read_affaire_intake_brief_inputs(project.id);
  if p_expected_revision is distinct from (snapshot->>'revision') then
    raise exception 'INTAKE_BRIEF_INPUT_CHANGED' using errcode='40001';
  end if;
  if exists(select 1 from jsonb_array_elements(p_sources) s where not exists (
    select 1 from jsonb_array_elements(snapshot->'documents') d where d->>'id'=s->>'sourceDocumentId'
  )) then raise exception 'INTAKE_BRIEF_SOURCE_INVALID' using errcode='23514'; end if;

  if p_lease_token is not null and batch.launch_read_scans is not null then
    update public.affaire_intake_uploads u set brief_published_at=clock_timestamp()
      where u.project_id=project.id and u.launch_read_scans is not null and u.brief_published_at is null
        and (u.id=batch.id or u.status='failed');
  end if;
  -- An edit that removed the final contributing piece can retire its generated brief.
  if p_draft is null then
    if snapshot->'documents'<>'[]'::jsonb or p_sources<>'[]'::jsonb then raise exception 'INTAKE_BRIEF_INVALID' using errcode='22023'; end if;
    delete from public.affaire_briefs b where b.id=prior.id;
    return null;
  end if;
  select * into next_brief from jsonb_populate_record(null::public.affaire_briefs,p_draft);
  -- The indexes belong to the member and refer to the ordered missing entries.
  -- Keep them for the same list and discard them when that list changes.
  next_brief.generation_metadata:=coalesce(next_brief.generation_metadata,'{}')-'resolved_plan_gap_indexes';
  if prior.missing_elements=next_brief.missing_elements and prior.generation_metadata ? 'resolved_plan_gap_indexes' then
    next_brief.generation_metadata:=next_brief.generation_metadata ||
      jsonb_build_object('resolved_plan_gap_indexes',prior.generation_metadata->'resolved_plan_gap_indexes');
  end if;
  -- A generator cannot confirm. A caller may keep an existing confirmation only on the
  -- same brief generation and with identical business content and provenance.
  keep_confirmation:=coalesce(prior.status='confirme' and next_brief.status='confirme' and prior.upload_id=batch.id
    and (prior.summary,prior.project_object,prior.scope,prior.lots,prior.received_pieces,prior.assumptions,prior.vigilance_points,prior.missing_elements)
      is not distinct from (next_brief.summary,next_brief.project_object,next_brief.scope,next_brief.lots,next_brief.received_pieces,
        next_brief.assumptions,next_brief.vigilance_points,next_brief.missing_elements)
    and not exists (
      with actual as (select l.block_key,l.entry_index,l.source_document_id,l.source_file_name,l.rationale from public.affaire_brief_source_links l
        where l.brief_id=prior.id), proposed as (select s."blockKey",s."entryIndex",s."sourceDocumentId",s."sourceFileName",s.rationale
        from jsonb_to_recordset(p_sources) s("blockKey" text,"entryIndex" integer,"sourceDocumentId" uuid,"sourceFileName" text,rationale text))
      (select * from actual except all select * from proposed) union all (select * from proposed except all select * from actual)
    ),false);
  insert into public.affaire_briefs as b(project_id,tenant_id,upload_id,created_by,updated_by,status,confirmed_by,confirmed_at,
    summary,project_object,scope,lots,received_pieces,assumptions,vigilance_points,missing_elements,generation_metadata,last_generated_at)
  values(project.id,project.tenant_id,batch.id,coalesce(prior.created_by,p_actor_id),p_actor_id,
    case when keep_confirmation then 'confirme' else 'a_confirmer' end,
    case when keep_confirmation then prior.confirmed_by end,case when keep_confirmation then prior.confirmed_at end,
    next_brief.summary,next_brief.project_object,coalesce(next_brief.scope,'[]'),coalesce(next_brief.lots,'[]'),
    coalesce(next_brief.received_pieces,'[]'),coalesce(next_brief.assumptions,'[]'),coalesce(next_brief.vigilance_points,'[]'),
    coalesce(next_brief.missing_elements,'[]'),coalesce(next_brief.generation_metadata,'{}'),next_brief.last_generated_at)
  on conflict (project_id) do update set upload_id=excluded.upload_id,updated_by=excluded.updated_by,status=excluded.status,
    confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at,summary=excluded.summary,project_object=excluded.project_object,
    scope=excluded.scope,lots=excluded.lots,received_pieces=excluded.received_pieces,assumptions=excluded.assumptions,
    vigilance_points=excluded.vigilance_points,missing_elements=excluded.missing_elements,generation_metadata=excluded.generation_metadata,
    last_generated_at=excluded.last_generated_at returning b.id into brief_id;
  delete from public.affaire_brief_source_links l where l.brief_id=prior.id;
  insert into public.affaire_brief_source_links(brief_id,source_document_id,created_by,block_key,entry_index,source_file_name,rationale)
    select brief_id,s."sourceDocumentId",p_actor_id,s."blockKey",s."entryIndex",s."sourceFileName",s.rationale from
      jsonb_to_recordset(p_sources) s("blockKey" text,"entryIndex" integer,"sourceDocumentId" uuid,"sourceFileName" text,rationale text);
  return brief_id;
end;
$$;

revoke all on function public.intake_payer_can_write(uuid,uuid,uuid),public.stop_affaire_intake_analysis(uuid,uuid),
  public.publish_affaire_intake_brief(uuid,uuid,uuid,text,timestamptz,jsonb,jsonb),
  public.start_affaire_intake_analysis(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.intake_payer_can_write(uuid,uuid,uuid),public.stop_affaire_intake_analysis(uuid,uuid),
  public.publish_affaire_intake_brief(uuid,uuid,uuid,text,timestamptz,jsonb,jsonb) to service_role;
grant execute on function public.start_affaire_intake_analysis(uuid,boolean) to authenticated;
commit;
