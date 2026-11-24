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
      and exists(select 1 from public.affaire_intake_documents d join public.affaire_intake_uploads u on u.id=d.upload_id
        where d.project_id=p.id and u.status='deposited' and d.upload_status='uploaded'
          and d.deleted_at is null and d.deletion_token is null and
          (d.classification_source='manual' or d.manually_overridden_at is not null or d.analysis_completed_at is not null))
      and not exists(select 1 from public.affaire_intake_documents d where d.project_id=p.id and d.deleted_at is null
        and d.upload_status='uploaded' and (d.deletion_token is not null or d.classification_status in ('queued','processing','awaiting_launch')))
      and not exists(select 1 from public.affaire_briefs b where b.project_id=p.id
        and not exists(select 1 from public.affaire_intake_uploads u where u.project_id=p.id and u.status='failed'
          and u.last_error in ('payer_access_lost','connection_unavailable') and u.completed_at>b.last_generated_at))
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

-- Publish one model response and its sources in a single transaction. All generation
-- paths (historical worker, explicit launch, authorised document edit) share this CAS.
create function public.publish_affaire_intake_brief(
  p_upload_id uuid,p_lease_token uuid,p_actor_id uuid,p_expected_documents jsonb,
  p_expected_brief_updated_at timestamptz,p_draft jsonb,p_sources jsonb
) returns uuid language plpgsql security invoker set search_path='' as $$
declare
  project public.estimate_projects%rowtype;
  batch public.affaire_intake_uploads%rowtype;
  prior public.affaire_briefs%rowtype;
  next_brief public.affaire_briefs%rowtype;
  keep_confirmation boolean;
  brief_id uuid;
begin
  -- FOR UPDATE on the project also excludes new document FK references. Lock *all*
  -- its documents, including those a concurrent publication may make eligible.
  select p.* into strict project from public.estimate_projects p join public.affaire_intake_uploads u on u.project_id=p.id
    where u.id=p_upload_id for update of p;
  select * into strict batch from public.affaire_intake_uploads where id=p_upload_id for share;
  perform 1 from public.affaire_intake_documents d where d.project_id=project.id order by d.id for share;
  select * into prior from public.affaire_briefs b where b.project_id=project.id for update;
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

  if jsonb_typeof(p_expected_documents) is distinct from 'array' or jsonb_typeof(p_sources) is distinct from 'array' then
    raise exception 'INTAKE_BRIEF_INVALID' using errcode='22023';
  end if;
  if prior.updated_at is distinct from p_expected_brief_updated_at or exists(
    with actual as (
      select d.id,d.updated_at,d.document_kind from public.affaire_intake_documents d where d.project_id=project.id
        and d.deleted_at is null and d.deletion_token is null and d.upload_status='uploaded' and d.classification_status<>'awaiting_launch'
    ), expected as (
      select e.* from jsonb_to_recordset(p_expected_documents) e(id uuid,updated_at timestamptz,document_kind text)
    )
    (select * from actual except all select * from expected)
    union all (select * from expected except all select * from actual)
  ) then raise exception 'INTAKE_BRIEF_INPUT_CHANGED' using errcode='40001'; end if;
  if exists(select 1 from jsonb_array_elements(p_sources) s where not exists (
    select 1 from jsonb_array_elements(p_expected_documents) d where d->>'id'=s->>'sourceDocumentId'
  )) then raise exception 'INTAKE_BRIEF_SOURCE_INVALID' using errcode='23514'; end if;

  -- An edit that removed the final contributing piece can retire its generated brief.
  if p_draft is null then
    if p_expected_documents<>'[]'::jsonb or p_sources<>'[]'::jsonb then raise exception 'INTAKE_BRIEF_INVALID' using errcode='22023'; end if;
    delete from public.affaire_briefs b where b.id=prior.id;
    return null;
  end if;
  select * into next_brief from jsonb_populate_record(null::public.affaire_briefs,p_draft);
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
  public.publish_affaire_intake_brief(uuid,uuid,uuid,jsonb,timestamptz,jsonb,jsonb),
  public.start_affaire_intake_analysis(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.intake_payer_can_write(uuid,uuid,uuid),public.stop_affaire_intake_analysis(uuid,uuid),
  public.publish_affaire_intake_brief(uuid,uuid,uuid,jsonb,timestamptz,jsonb,jsonb) to service_role;
grant execute on function public.start_affaire_intake_analysis(uuid,boolean) to authenticated;
commit;
