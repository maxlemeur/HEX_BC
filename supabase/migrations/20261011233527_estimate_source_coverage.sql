-- Human requirements and technical coverage. No financial or DPGF writes.
create table private.estimate_source_coverage_dimensions (
  id uuid primary key, tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  kind text not null check(kind in('zone','network')), label text not null, extent_note text,
  revision bigint not null check(revision between 1 and 9007199254740991),
  extent_revision bigint not null default 0 check(extent_revision between 0 and 9007199254740991),
  archived boolean not null default false
);
create index source_coverage_dimensions_project_idx on private.estimate_source_coverage_dimensions(project_id,id);
create index source_coverage_dimensions_tenant_idx on private.estimate_source_coverage_dimensions(tenant_id);
create table private.estimate_source_coverage_requirements (
  id uuid primary key, review_id uuid not null references private.estimate_source_reviews(id) on delete cascade,
  revision bigint not null check(revision between 1 and 9007199254740991),
  technical_revision bigint not null default 0 check(technical_revision between 0 and 9007199254740991),
  prescription text not null, expected_service text not null, scope jsonb not null,
  completeness text not null default 'partial' check(completeness in('partial','complete')), completeness_reason text,
  archived boolean not null default false, last_decision_id uuid
);
create index source_coverage_requirements_review_idx on private.estimate_source_coverage_requirements(review_id,id);
create index source_coverage_requirements_scope_idx on private.estimate_source_coverage_requirements using gin(scope jsonb_path_ops);
create table private.estimate_source_coverage_citations (
  id uuid primary key, requirement_id uuid not null references private.estimate_source_coverage_requirements(id) on delete cascade,
  copy_id uuid not null, page integer not null check(page between 1 and 200), folio text, excerpt text not null,
  verification jsonb, active boolean not null default true
);
create index source_coverage_citations_requirement_idx on private.estimate_source_coverage_citations(requirement_id,id);
create table private.estimate_source_coverage_links (
  id uuid primary key, requirement_id uuid not null references private.estimate_source_coverage_requirements(id) on delete cascade,
  kind text not null check(kind in('line','component','register')), item_id uuid, application_id uuid, snapshot_id uuid,
  component_id text, register_entry_id uuid, justification text not null, target_key text not null,
  unique(requirement_id,target_key)
);
create index source_coverage_links_item_idx on private.estimate_source_coverage_links(item_id) where item_id is not null;
create index source_coverage_links_application_idx on private.estimate_source_coverage_links(application_id) where application_id is not null;
create index source_coverage_links_snapshot_idx on private.estimate_source_coverage_links(snapshot_id) where snapshot_id is not null;
create index source_coverage_links_register_idx on private.estimate_source_coverage_links(register_entry_id) where register_entry_id is not null;
create table private.estimate_source_coverage_events (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.estimate_projects(id) on delete cascade,
  review_id uuid references private.estimate_source_reviews(id) on delete cascade,
  version_identity uuid not null, requirement_id uuid, entity_id uuid not null, entity_revision bigint not null check(entity_revision between 1 and 9007199254740991),
  operation_key uuid not null, operation text not null, canonical_request jsonb not null,
  before_payload jsonb, after_payload jsonb, decision jsonb, reason text,
  actor_id uuid not null, actor_name text, occurred_at timestamptz not null default clock_timestamp(),
  unique(version_identity,operation_key), unique(entity_id,entity_revision)
);
create index source_coverage_events_review_idx on private.estimate_source_coverage_events(review_id);
create index source_coverage_events_history_idx on private.estimate_source_coverage_events(requirement_id,entity_revision desc);
alter table private.estimate_source_coverage_dimensions enable row level security;
alter table private.estimate_source_coverage_requirements enable row level security;
alter table private.estimate_source_coverage_citations enable row level security;
alter table private.estimate_source_coverage_links enable row level security;
alter table private.estimate_source_coverage_events enable row level security;
revoke all on private.estimate_source_coverage_dimensions,private.estimate_source_coverage_requirements,
  private.estimate_source_coverage_citations,private.estimate_source_coverage_links,private.estimate_source_coverage_events from public,anon,authenticated,service_role;

create function private.source_coverage_error(code text) returns void language plpgsql set search_path='' as $$
begin raise exception using errcode=case when code='ACCESS_DENIED' then '42501' when code='INVALID_INPUT' then '22023' else 'P0001' end,message='SOURCE_COVERAGE_'||code; end $$;
create function private.source_coverage_context(actor uuid,version uuid,writing boolean default false) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare ctx jsonb;
begin
  begin ctx:=private.source_review_context(actor,version,false);
  exception when sqlstate '42501' then perform private.source_coverage_error('ACCESS_DENIED'); end;
  if writing then
    if not(ctx->>'role'='admin' or(ctx->>'role'='engineer' and ctx->>'user_id'=actor::text)) then perform private.source_coverage_error('WRITE_FORBIDDEN'); end if;
    begin ctx:=private.source_review_lock_context(actor,version);
    exception when sqlstate '42501' then perform private.source_coverage_error('ACCESS_DENIED');
      when others then if sqlerrm='SOURCE_REVIEW_BUSY' then perform private.source_coverage_error('BUSY'); else raise; end if;
    end;
  end if;
  return ctx;
end $$;

-- Decisions lock the live dependency set. NOWAIT avoids the inverse order of
-- existing item writers (item row, then version) without accepting stale facts.
create function private.source_coverage_scope_available(q private.estimate_source_coverage_requirements,r private.estimate_source_reviews) returns boolean
language sql stable security definer set search_path='' as $$
select ((q.scope->>'zoneId') is null or exists(select 1 from private.estimate_source_coverage_dimensions where id=(q.scope->>'zoneId')::uuid and project_id=r.project_id and tenant_id=r.tenant_id and kind='zone' and not archived))
 and ((q.scope->>'networkId') is null or exists(select 1 from private.estimate_source_coverage_dimensions where id=(q.scope->>'networkId')::uuid and project_id=r.project_id and tenant_id=r.tenant_id and kind='network' and not archived))
 and ((q.scope->>'dpgfLotId') is null or exists(select 1 from public.estimate_items where id=(q.scope->>'dpgfLotId')::uuid and version_id=r.version_id and tenant_id=r.tenant_id and item_type='section'))
$$;

create function private.source_coverage_lock_dependencies(req uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
declare q private.estimate_source_coverage_requirements%rowtype; item_ids uuid[];
begin
  select * into q from private.estimate_source_coverage_requirements where id=req;
  perform 1 from private.estimate_source_coverage_dimensions where id in((q.scope->>'zoneId')::uuid,(q.scope->>'networkId')::uuid) order by id for share nowait;
  with recursive parents as (
    select i.id,i.parent_id from public.estimate_items i where i.id in(select item_id from private.estimate_source_coverage_links where requirement_id=req) or i.id=(q.scope->>'dpgfLotId')::uuid
    union select i.id,i.parent_id from public.estimate_items i join parents p on i.id=p.parent_id
  ) select array_agg(id order by id) into item_ids from parents;
  perform 1 from public.estimate_items where id=any(item_ids) order by id for share nowait;
  perform 1 from public.estimate_generated_ouvrage_applications where id in(select application_id from private.estimate_source_coverage_links where requirement_id=req) order by id for share nowait;
  perform 1 from public.estimate_generated_ouvrage_work_snapshots where id in(select snapshot_id from private.estimate_source_coverage_links where requirement_id=req) order by id for share nowait;
  perform 1 from public.estimate_generated_ouvrage_candidates where id in(select candidate_id from public.estimate_generated_ouvrage_applications where id in(select application_id from private.estimate_source_coverage_links where requirement_id=req)) order by id for share nowait;
  perform 1 from public.estimate_generated_ouvrage_drafts where id in(select draft_id from public.estimate_generated_ouvrage_applications where id in(select application_id from private.estimate_source_coverage_links where requirement_id=req)) order by id for share nowait;
  perform 1 from public.affaire_register_entries where id in(select register_entry_id from private.estimate_source_coverage_links where requirement_id=req) order by id for share nowait;
end $$;

create function private.source_coverage_preview(req uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q private.estimate_source_coverage_requirements%rowtype; r private.estimate_source_reviews%rowtype; facts jsonb; blocks jsonb:='[]'; fingerprint text; content_rev bigint; per_treatment jsonb:='{}'; treatment text; specific jsonb;
begin
  select * into q from private.estimate_source_coverage_requirements where id=req;
  select * into r from private.estimate_source_reviews where id=q.review_id;
  select content_revision into content_rev from public.estimate_versions where id=r.version_id;
  if r.revision is null or r.revision=0 then perform private.source_coverage_error('STALE'); end if;
  facts:=private.source_coverage_facts(q.id);
  if q.archived then blocks:=blocks||'"Exigence archivée"'::jsonb; end if;
  foreach treatment in array array['unresolved','priced','included','excluded','other_lot','provisional'] loop
    specific:='[]';
    if treatment<>'unresolved' then
      if exists(select 1 from jsonb_array_elements(facts->'targets')x where x->>'state'<>'available') then specific:=specific||'"Cible indisponible ou incompatible"'::jsonb; end if;
      if not private.source_coverage_scope_available(q,r) then specific:=specific||'"Périmètre archivé ou indisponible"'::jsonb; end if;
      if not exists(select 1 from private.estimate_source_coverage_citations c join private.estimate_source_reference_copies cp on cp.id=c.copy_id where c.requirement_id=q.id and c.active and cp.id=r.active_copy_id and cp.state='verified' and c.page<=cp.page_count and c.verification->>'sha256'=cp.sha256) then specific:=specific||'"Citation de la référence actuelle à vérifier"'::jsonb; end if;
    end if;
    if treatment in('priced','included') then
      if q.scope->>'mode'='unspecified' then specific:=specific||'"Périmètre non précisé"'::jsonb; end if;
      if q.completeness<>'complete' then specific:=specific||'"Complétude de la prestation à confirmer"'::jsonb; end if;
      if not exists(select 1 from jsonb_array_elements(facts->'links')x where x->>'kind' in('line','component')) then specific:=specific||'"Ligne ou composant courant à relier"'::jsonb; end if;
    end if;
    if treatment='provisional' and not exists(select 1 from jsonb_array_elements(facts->'links')x where x->>'kind'='register') then specific:=specific||'"Hypothèse ou pièce manquante du registre à relier"'::jsonb; end if;
    per_treatment:=per_treatment||jsonb_build_object(treatment,specific);
  end loop;
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('requirementId',q.id,'revision',q.revision,'technicalRevision',q.technical_revision,'contentRevision',content_rev,'referenceRevision',r.revision,'activeCopyId',r.active_copy_id,'facts',facts)::text,'UTF8')),'hex');
  return jsonb_build_object('requirementId',q.id,'requirementRevision',q.revision,'referenceRevision',r.revision,'contentRevision',content_rev,'technicalRevision',q.technical_revision,'reviewedFingerprint',fingerprint,'facts',facts,'blockingReasons',blocks,'treatmentBlockingReasons',per_treatment);
end $$;

create function public.get_estimate_source_coverage(p_version_id uuid,p_requirement_id uuid default null,p_after_id uuid default null,p_limit integer default 50,p_before_event bigint default null,p_operation_key uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ctx jsonb; r private.estimate_source_reviews%rowtype; selected jsonb; summaries jsonb; page jsonb; history jsonb; dims jsonb; counts jsonb; receipt jsonb; more_id uuid; more_event bigint; read_reason text;
begin
  if p_limit is null or p_limit not between 1 and 100 or(p_before_event is not null and p_before_event not between 1 and 9007199254740991) then perform private.source_coverage_error('INVALID_INPUT'); end if;
  ctx:=private.source_coverage_context(auth.uid(),p_version_id);
  select * into r from private.estimate_source_reviews where version_id=p_version_id;
  if p_requirement_id is not null then
    if not exists(select 1 from private.estimate_source_coverage_requirements where id=p_requirement_id and review_id=r.id) then perform private.source_coverage_error('ACCESS_DENIED'); end if;
    selected:=private.source_coverage_requirement_dto(p_requirement_id,true);
  end if;
  read_reason:=case when (ctx->>'is_archived')::boolean then 'archived' when ctx->>'status'<>'draft' then 'version' when not(ctx->>'role'='admin' or(ctx->>'role'='engineer' and ctx->>'user_id'=auth.uid()::text)) then 'role' end;
  select coalesce(jsonb_agg(private.source_coverage_dimension_dto(d) order by d.id),'[]') into dims from private.estimate_source_coverage_dimensions d where d.project_id=(ctx->>'project_id')::uuid and d.tenant_id=(ctx->>'tenant_id')::uuid;
  select coalesce(jsonb_agg(private.source_coverage_requirement_dto(q.id) order by q.id),'[]') into summaries from private.estimate_source_coverage_requirements q where q.review_id=r.id and not q.archived;
  select jsonb_build_object('total',count(*),'treatments',jsonb_build_object('unresolved',count(*) filter(where x->>'treatment'='unresolved'),'priced',count(*) filter(where x->>'treatment'='priced'),'included',count(*) filter(where x->>'treatment'='included'),'excluded',count(*) filter(where x->>'treatment'='excluded'),'other_lot',count(*) filter(where x->>'treatment'='other_lot'),'provisional',count(*) filter(where x->>'treatment'='provisional')),'validities',jsonb_build_object('unreviewed',count(*) filter(where x->>'validity'='unreviewed'),'current',count(*) filter(where x->>'validity'='current'),'needs_review',count(*) filter(where x->>'validity'='needs_review'))) into counts from jsonb_array_elements(summaries)x;
  select coalesce(jsonb_agg(x order by (x->>'id')::uuid),'[]') into page from(select x from jsonb_array_elements(summaries)x where p_after_id is null or(x->>'id')::uuid>p_after_id order by(x->>'id')::uuid limit p_limit)s;
  if jsonb_array_length(page)=p_limit and exists(select 1 from jsonb_array_elements(summaries)x where(x->>'id')::uuid>(page->(p_limit-1)->>'id')::uuid) then more_id:=(page->(p_limit-1)->>'id')::uuid; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'sequence',e.entity_revision,'operation',e.operation,'actorId',e.actor_id,'occurredAt',e.occurred_at,'entityRevision',e.entity_revision,'reason',e.reason,'decision',e.decision) order by e.entity_revision desc),'[]') into history from(select * from private.estimate_source_coverage_events where requirement_id=p_requirement_id and review_id=r.id and(p_before_event is null or entity_revision<p_before_event) order by entity_revision desc limit p_limit)e;
  if jsonb_array_length(history)=p_limit and exists(select 1 from private.estimate_source_coverage_events where requirement_id=p_requirement_id and review_id=r.id and entity_revision<(history->(p_limit-1)->>'sequence')::bigint) then more_event:=(history->(p_limit-1)->>'sequence')::bigint; end if;
  select private.source_coverage_receipt(e) into receipt from private.estimate_source_coverage_events e where e.version_identity=p_version_id and e.project_id=(ctx->>'project_id')::uuid and e.operation_key=p_operation_key and e.actor_id=auth.uid();
  return jsonb_build_object('versionId',p_version_id,'projectId',ctx->>'project_id','referenceRevision',coalesce(r.revision,0),'activeCopyId',r.active_copy_id,'canWrite',read_reason is null,'readOnlyReason',read_reason,'counts',counts,'dimensions',dims,'requirements',page,'nextAfterId',more_id,'selectedRequirement',selected,'history',history,'nextBeforeEvent',more_event,'receipt',receipt);
end $$;

create function public.preview_estimate_source_coverage_decision(p_version_id uuid,p_requirement_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.source_coverage_context(auth.uid(),p_version_id);
  if not exists(select 1 from private.estimate_source_coverage_requirements q join private.estimate_source_reviews r on r.id=q.review_id where q.id=p_requirement_id and r.version_id=p_version_id) then perform private.source_coverage_error('ACCESS_DENIED'); end if;
  return private.source_coverage_preview(p_requirement_id);
end $$;

create function private.source_coverage_storage(cp private.estimate_source_reference_copies) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
  perform private.source_review_storage_object(cp.object_path,cp.byte_size,cp.storage_object_id);
exception when others then
  if sqlerrm='SOURCE_REVIEW_BUSY' then perform private.source_coverage_error('BUSY');
  elsif sqlerrm='SOURCE_REVIEW_SOURCE_UNAVAILABLE' then perform private.source_coverage_error('SOURCE_UNAVAILABLE'); else raise; end if;
end $$;

create function public.verify_estimate_source_requirement_citation(p_actor_user_id uuid,p_version_id uuid,p_requirement_id uuid,p_citation_id uuid,p_expected_requirement_revision bigint,p_expected_reference_revision bigint,p_reviewed_sha256 text,p_operation_key uuid)
returns jsonb language plpgsql volatile security definer set search_path='' set lock_timeout='2s' as $$
declare ctx jsonb; r private.estimate_source_reviews%rowtype; q private.estimate_source_coverage_requirements%rowtype; c private.estimate_source_coverage_citations%rowtype; cp private.estimate_source_reference_copies%rowtype; request jsonb; replay jsonb; before_value jsonb; next_rev bigint;
begin
  if p_requirement_id is null or p_citation_id is null or p_operation_key is null or p_expected_requirement_revision is null or p_expected_requirement_revision not between 1 and 9007199254740991 or p_expected_reference_revision is null or p_expected_reference_revision not between 1 and 9007199254740991 or p_reviewed_sha256 is null or p_reviewed_sha256!~'^[a-f0-9]{64}$' then perform private.source_coverage_error('INVALID_INPUT'); end if;
  ctx:=private.source_coverage_context(p_actor_user_id,p_version_id,true);
  request:=jsonb_build_object('versionId',p_version_id,'actorId',p_actor_user_id,'kind','citation','request',jsonb_build_object('requirementId',p_requirement_id,'citationId',p_citation_id,'expectedRequirementRevision',p_expected_requirement_revision,'expectedReferenceRevision',p_expected_reference_revision,'reviewedSha256',p_reviewed_sha256,'operationKey',p_operation_key));
  replay:=private.source_coverage_replay(p_version_id,p_operation_key,request); if replay is not null then return replay; end if;
  select * into r from private.estimate_source_reviews where version_id=p_version_id for update;
  select * into q from private.estimate_source_coverage_requirements where id=p_requirement_id and review_id=r.id for update;
  if not found then perform private.source_coverage_error('ACCESS_DENIED'); end if;
  if ctx->>'status'<>'draft' or q.archived or q.revision<>p_expected_requirement_revision or r.revision<>p_expected_reference_revision then perform private.source_coverage_error('STALE'); end if;
  select * into c from private.estimate_source_coverage_citations where id=p_citation_id and requirement_id=q.id and active for update;
  if not found then perform private.source_coverage_error('INVALID_TARGET'); end if;
  select * into cp from private.estimate_source_reference_copies where id=c.copy_id and review_id=r.id and state='verified' for share nowait;
  if not found or cp.id is distinct from r.active_copy_id or cp.sha256<>p_reviewed_sha256 or c.page>cp.page_count then perform private.source_coverage_error('STALE'); end if;
  perform private.source_coverage_storage(cp);
  before_value:=private.source_coverage_requirement_dto(q.id,true); next_rev:=private.source_coverage_next(q.revision);
  update private.estimate_source_coverage_citations set verification=jsonb_build_object('actorId',p_actor_user_id,'occurredAt',clock_timestamp(),'sha256',cp.sha256) where id=c.id;
  update private.estimate_source_coverage_requirements set revision=next_rev where id=q.id;
  return private.source_coverage_append(p_version_id,q.id,next_rev,'citation.verify',p_operation_key,request,before_value,private.source_coverage_requirement_dto(q.id,true));
exception when lock_not_available or deadlock_detected then perform private.source_coverage_error('BUSY');
end $$;

create function public.decide_estimate_source_requirement(p_actor_user_id uuid,p_version_id uuid,p_requirement_id uuid,p_expected_requirement_revision bigint,p_expected_reference_revision bigint,p_expected_content_revision bigint,p_reviewed_fingerprint text,p_operation_key uuid,p_decision jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' set lock_timeout='2s' as $$
declare ctx jsonb; r private.estimate_source_reviews%rowtype; q private.estimate_source_coverage_requirements%rowtype; cp private.estimate_source_reference_copies%rowtype; request jsonb; replay jsonb; preview jsonb; facts jsonb; decision jsonb; before_value jsonb; next_rev bigint; event_id uuid:=gen_random_uuid(); treatment text; reason_text text; other_lot text; uncertainty text; completeness text;
begin
  if p_requirement_id is null or p_operation_key is null or p_expected_requirement_revision is null or p_expected_requirement_revision not between 1 and 9007199254740991 or p_expected_reference_revision is null or p_expected_reference_revision not between 1 and 9007199254740991 or p_expected_content_revision is null or p_expected_content_revision not between 0 and 9007199254740991 or p_reviewed_fingerprint is null or p_reviewed_fingerprint!~'^[a-f0-9]{64}$' then perform private.source_coverage_error('INVALID_INPUT'); end if;
  perform private.source_coverage_object(p_decision,array['treatment','reason','otherLot','uncertainty','completeness']);
  treatment:=private.source_coverage_text(p_decision->'treatment',30); reason_text:=private.source_coverage_text(p_decision->'reason',1000); other_lot:=private.source_coverage_text(p_decision->'otherLot',200,true); uncertainty:=private.source_coverage_text(p_decision->'uncertainty',1000,true); completeness:=private.source_coverage_text(p_decision->'completeness',20);
  if treatment not in('unresolved','priced','included','excluded','other_lot','provisional') or completeness not in('partial','complete') or(treatment='other_lot' and other_lot is null) or(treatment='provisional' and uncertainty is null) then perform private.source_coverage_error('INVALID_INPUT'); end if;
  ctx:=private.source_coverage_context(p_actor_user_id,p_version_id,true);
  request:=jsonb_build_object('versionId',p_version_id,'actorId',p_actor_user_id,'kind','decision','request',jsonb_build_object('requirementId',p_requirement_id,'expectedRequirementRevision',p_expected_requirement_revision,'expectedReferenceRevision',p_expected_reference_revision,'expectedContentRevision',p_expected_content_revision,'reviewedFingerprint',p_reviewed_fingerprint,'operationKey',p_operation_key,'decision',p_decision));
  replay:=private.source_coverage_replay(p_version_id,p_operation_key,request); if replay is not null then return replay; end if;
  select * into r from private.estimate_source_reviews where version_id=p_version_id for update;
  select * into q from private.estimate_source_coverage_requirements where id=p_requirement_id and review_id=r.id for update;
  if not found then perform private.source_coverage_error('ACCESS_DENIED'); end if;
  if ctx->>'status'<>'draft' or q.archived or q.revision<>p_expected_requirement_revision or r.revision<>p_expected_reference_revision or p_expected_content_revision is distinct from(select content_revision from public.estimate_versions where id=p_version_id) then perform private.source_coverage_error('STALE'); end if;
  perform private.source_coverage_lock_dependencies(q.id);
  preview:=private.source_coverage_preview(q.id); facts:=preview->'facts';
  if preview->>'reviewedFingerprint'<>p_reviewed_fingerprint then perform private.source_coverage_error('STALE'); end if;
  if treatment in('priced','included') and(q.completeness<>'complete' or completeness<>'complete' or q.scope->>'mode'='unspecified') then perform private.source_coverage_error('INCOMPLETE'); end if;
  if treatment<>'unresolved' and(exists(select 1 from jsonb_array_elements(facts->'targets')x where x->>'state'<>'available') or not private.source_coverage_scope_available(q,r)) then perform private.source_coverage_error('INVALID_TARGET'); end if;
  if treatment in('priced','included') and not exists(select 1 from jsonb_array_elements(facts->'links')x where x->>'kind' in('line','component')) or treatment='provisional' and not exists(select 1 from jsonb_array_elements(facts->'links')x where x->>'kind'='register') then perform private.source_coverage_error('INCOMPLETE'); end if;
  select * into cp from private.estimate_source_reference_copies where id=r.active_copy_id and review_id=r.id and state='verified' for share nowait;
  if not found then perform private.source_coverage_error('SOURCE_UNAVAILABLE'); end if;
  if treatment<>'unresolved' and not exists(select 1 from private.estimate_source_coverage_citations where requirement_id=q.id and active and copy_id=cp.id and page<=cp.page_count and verification->>'sha256'=cp.sha256) then perform private.source_coverage_error('CITATION_NOT_VERIFIED'); end if;
  perform private.source_coverage_storage(cp);
  next_rev:=private.source_coverage_next(q.revision); before_value:=private.source_coverage_requirement_dto(q.id,true);
  decision:=p_decision||jsonb_build_object('eventId',event_id,'requirementRevision',next_rev,'technicalRevision',q.technical_revision,'referenceRevision',r.revision,'copyId',cp.id,'sha256',cp.sha256,'actorId',p_actor_user_id,'occurredAt',clock_timestamp(),'facts',facts);
  update private.estimate_source_coverage_requirements set revision=next_rev,last_decision_id=event_id where id=q.id;
  return private.source_coverage_append(p_version_id,q.id,next_rev,'decision',p_operation_key,request,before_value,jsonb_build_object('revision',next_rev,'decision',decision),decision,reason_text,event_id);
exception when lock_not_available or deadlock_detected then perform private.source_coverage_error('BUSY');
end $$;
create function private.source_coverage_next(value bigint) returns bigint language plpgsql immutable set search_path='' as $$
begin
  if value is null or value<0 then perform private.source_coverage_error('INVALID_INPUT'); end if;
  if value>=9007199254740991 then perform private.source_coverage_error('REVISION_OVERFLOW'); end if;
  return value+1;
end $$;
create function private.source_coverage_object(value jsonb,keys text[]) returns void language plpgsql immutable set search_path='' as $$
begin
  if jsonb_typeof(value) is distinct from 'object' or (select count(*) from jsonb_object_keys(value))<>cardinality(keys)
    or exists(select 1 from unnest(keys) k where not(value?k)) then perform private.source_coverage_error('INVALID_INPUT'); end if;
end $$;
create function private.source_coverage_text(value jsonb,max_length integer,nullable boolean default false) returns text language plpgsql immutable set search_path='' as $$
declare s text;
begin
  if nullable and value='null'::jsonb then return null; end if;
  if jsonb_typeof(value) is distinct from 'string' then perform private.source_coverage_error('INVALID_INPUT'); end if;
  s:=value#>>'{}';
  if char_length(s) not between 1 and max_length or s<>btrim(s) then perform private.source_coverage_error('INVALID_INPUT'); end if;
  return s;
end $$;
create function private.source_coverage_uuid(value jsonb,nullable boolean default false) returns uuid language plpgsql immutable set search_path='' as $$
begin
  if nullable and value='null'::jsonb then return null; end if;
  if jsonb_typeof(value) is distinct from 'string' then perform private.source_coverage_error('INVALID_INPUT'); end if;
  return (value#>>'{}')::uuid;
exception when invalid_text_representation then perform private.source_coverage_error('INVALID_INPUT');
end $$;
create function private.source_coverage_dimension_dto(d private.estimate_source_coverage_dimensions) returns jsonb language sql immutable set search_path='' as $$
select jsonb_build_object('id',d.id,'kind',d.kind,'label',d.label,'extentNote',d.extent_note,'revision',d.revision,'extentRevision',d.extent_revision,'archived',d.archived)
$$;
create function private.source_coverage_line_fact(i public.estimate_items) returns jsonb language sql immutable set search_path='' as $$
select jsonb_build_object('itemId',i.id,'title',i.title,'unit',nullif(btrim(i.description),''),'quantity',case when i.quantity::text not in('NaN','Infinity','-Infinity') then i.quantity end,'hours',case when i.h_mo::text not in('NaN','Infinity','-Infinity') then i.h_mo end,
  'nature',i.line_nature,'productId',i.product_id,'parentId',i.parent_id)
$$;
create function private.source_coverage_link_dto(l private.estimate_source_coverage_links) returns jsonb language sql immutable set search_path='' as $$
select jsonb_build_object('id',l.id,'kind',l.kind,'justification',l.justification)||case l.kind
 when 'line' then jsonb_build_object('itemId',l.item_id)
 when 'component' then jsonb_build_object('itemId',l.item_id,'applicationId',l.application_id,'snapshotId',l.snapshot_id,'componentId',l.component_id)
 else jsonb_build_object('registerEntryId',l.register_entry_id) end
$$;
create function private.source_coverage_citation_dto(c private.estimate_source_coverage_citations) returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('id',c.id,'copyId',c.copy_id,'page',c.page,'folio',c.folio,'excerpt',c.excerpt,'verification',c.verification,
 'canOpen',exists(select 1 from private.estimate_source_reference_copies cp where cp.id=c.copy_id and cp.state='verified'))
$$;
create function private.source_coverage_target(l private.estimate_source_coverage_links,version uuid,project uuid,tenant uuid,scope jsonb,linked_items uuid[] default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare i public.estimate_items%rowtype; s public.estimate_generated_ouvrage_work_snapshots%rowtype;
 a public.estimate_generated_ouvrage_applications%rowtype; e public.affaire_register_entries%rowtype; comp jsonb;
 state text:='available'; why text; fact jsonb; lot uuid:=(scope->>'dpgfLotId')::uuid; found_parent boolean; mapping jsonb; expected_nature public.estimate_line_nature;
begin
  if l.kind='register' then
    select * into e from public.affaire_register_entries where id=l.register_entry_id;
    if not found then state:='missing'; why:='Entrée du registre supprimée';
    elsif e.tenant_id<>tenant or e.project_id<>project then state:='forbidden'; why:='Entrée du registre hors périmètre';
    else
      fact:=jsonb_build_object('kind','register','registerEntryId',e.id,'entryKind',e.kind,'text',e.text,'status',e.status,'scopeType',e.scope_type,'scopeId',e.scope_id,'scopeRef',e.scope_ref,'scopeLabel',e.scope_label,'active',e.is_active,'updatedAt',e.updated_at);
      if not e.is_active or(e.version_id is not null and e.version_id<>version) or(e.scope_type='lot' and e.scope_id is distinct from lot)
        or(e.scope_type='line' and not(e.scope_id=any(coalesce(linked_items,array(select item_id from private.estimate_source_coverage_links where requirement_id=l.requirement_id and kind in('line','component'))))))
        or(e.scope_type='exception' and nullif(btrim(e.scope_ref),'') is null)
      then state:='incompatible'; why:='Portée du registre incompatible ou entrée inactive'; end if;
    end if;
  else
    select * into i from public.estimate_items where id=l.item_id;
    if not found then state:='missing'; why:='Ligne supprimée';
    elsif i.tenant_id<>tenant or i.version_id<>version then state:='forbidden'; why:='Ligne hors version';
    elsif i.item_type<>'line' then state:='incompatible'; why:='Une section ne traite pas une prestation';
    else
      fact:=private.source_coverage_line_fact(i)||jsonb_build_object('kind','line');
      if i.quantity is null or i.quantity<=0 or i.quantity::text in('NaN','Infinity','-Infinity') or nullif(btrim(i.description),'') is null or nullif(btrim(i.title),'') is null then state:='incompatible'; why:='Données techniques de ligne incomplètes'; end if;
      if lot is not null then
        with recursive parents as(select id,parent_id from public.estimate_items where id=i.parent_id and version_id=version union all select x.id,x.parent_id from public.estimate_items x join parents p on x.id=p.parent_id where x.version_id=version)
          select exists(select 1 from parents where id=lot) into found_parent;
        if not found_parent then state:='incompatible'; why:='La ligne ne relève pas du contexte DPGF déclaré'; end if;
      end if;
      if l.kind='component' then
        select * into s from public.estimate_generated_ouvrage_work_snapshots where id=l.snapshot_id;
        if not found then state:='missing'; why:='Instantané appliqué supprimé'; fact:=null;
        else
          select * into a from public.estimate_generated_ouvrage_applications where id=l.application_id;
          if not found then state:='missing'; why:='Application supprimée'; fact:=null;
          elsif s.tenant_id<>tenant or s.project_id<>project or s.target_version_id<>version or a.tenant_id<>tenant or a.target_version_id<>version
            or s.estimate_item_id<>i.id or a.estimate_item_id<>i.id or a.draft_id<>s.draft_id or a.candidate_id<>s.parent_work_id
            or not exists(select 1 from public.estimate_generated_ouvrage_candidates where id=a.candidate_id and draft_id=a.draft_id and target_version_id=version and project_id=project and tenant_id=tenant and resolution_status='inserted')
            or not exists(select 1 from public.estimate_generated_ouvrage_drafts where id=a.draft_id and target_version_id=version and project_id=project and tenant_id=tenant and status in('applied','partially_applied'))
          then state:='incompatible'; why:='Application et instantané ne désignent pas ce parent'; fact:=null;
          else
            mapping:=coalesce(s.metadata->'estimate_item_mapping',a.applied_payload->'estimate_item_mapping','{}');
            expected_nature:=case when coalesce((mapping->>'hMo')::numeric,0)>0 or mapping->>'laborRoleId' is not null
              then case when coalesce((mapping->>'unitPriceHtCents')::numeric,1)>0 then 'supply_and_labor' else 'labor_only' end else 'supply_only' end;
            select value into comp from jsonb_array_elements(s.components) where value->>'componentId'=l.component_id;
            if comp is null then state:='missing'; why:='Composant appliqué absent'; fact:=null;
            elsif jsonb_typeof(comp->'quantity') is distinct from 'number' or (comp->>'quantity')::numeric not between 0 and 1.7976931348623157e308 or nullif(btrim(comp->>'unit'),'') is null or nullif(btrim(comp->>'designation'),'') is null or nullif(comp->>'costType','') is null then state:='incompatible'; why:='Composition technique incomplète'; fact:=null;
            else
              fact:=jsonb_build_object('kind','component','itemId',i.id,'applicationId',a.id,'snapshotId',s.id,'componentId',l.component_id,'title',comp->>'designation','unit',comp->>'unit','quantity',comp->'quantity','componentType',comp->>'costType','parent',private.source_coverage_line_fact(i));
              if a.applied_payload->>'designation' is distinct from i.title or a.applied_payload->>'unit' is distinct from i.description
                or a.applied_payload->'quantity' is distinct from to_jsonb(i.quantity)
                or coalesce(s.metadata->'estimate_item_mapping'->'hMo',a.applied_payload->'estimate_item_mapping'->'hMo') is distinct from to_jsonb(i.h_mo)
                or i.line_nature is distinct from expected_nature or i.product_id is not null or i.supply_type_id is not null
                or i.labor_role_id is distinct from (mapping->>'laborRoleId')::uuid
                or coalesce(i.h_mo_atelier,0)<>0 or coalesce(i.h_mo_chantier,0)<>0
                or i.labor_role_atelier_id is not null or i.labor_role_chantier_id is not null
              then state:='incompatible'; why:='Le parent technique diffère de la composition appliquée'; end if;
            end if;
          end if;
        end if;
      end if;
    end if;
  end if;
  return jsonb_build_object('linkId',l.id,'state',state,'fact',fact,'reason',why);
exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
  return jsonb_build_object('linkId',l.id,'state','incompatible','fact',null,'reason','Données techniques de la cible illisibles');
end $$;
create function private.source_coverage_facts(req uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q private.estimate_source_coverage_requirements%rowtype; r private.estimate_source_reviews%rowtype; dims jsonb; citations jsonb; links jsonb; targets jsonb;
begin
  select * into q from private.estimate_source_coverage_requirements where id=req;
  select * into r from private.estimate_source_reviews where id=q.review_id;
  select coalesce(jsonb_agg(private.source_coverage_dimension_dto(d) order by d.id),'[]') into dims from private.estimate_source_coverage_dimensions d where d.id in((q.scope->>'zoneId')::uuid,(q.scope->>'networkId')::uuid);
  select coalesce(jsonb_agg(private.source_coverage_citation_dto(c) order by c.id),'[]') into citations from private.estimate_source_coverage_citations c where c.requirement_id=q.id and c.active;
  select coalesce(jsonb_agg(private.source_coverage_link_dto(l) order by l.id),'[]'),coalesce(jsonb_agg(private.source_coverage_target(l,r.version_id,r.project_id,r.tenant_id,q.scope) order by l.id),'[]') into links,targets from private.estimate_source_coverage_links l where l.requirement_id=q.id;
  return jsonb_build_object('prescription',q.prescription,'expectedService',q.expected_service,'scope',q.scope,'completeness',q.completeness,'completenessReason',q.completeness_reason,'dimensions',dims,'citations',citations,'links',links,'targets',targets);
end $$;
create function private.source_coverage_requirement_dto(req uuid,detail boolean default false) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q private.estimate_source_coverage_requirements%rowtype; r private.estimate_source_reviews%rowtype; d jsonb; f jsonb; validity text:='unreviewed'; reasons jsonb:='[]'; result jsonb;
begin
  select * into q from private.estimate_source_coverage_requirements where id=req; if not found then return null; end if;
  select * into r from private.estimate_source_reviews where id=q.review_id;
  select decision into d from private.estimate_source_coverage_events where id=q.last_decision_id;
  f:=private.source_coverage_facts(q.id);
  if d is not null then
    validity:='current';
    if (d->>'requirementRevision')::bigint<>q.revision then reasons:=reasons||'"Exigence modifiée depuis la décision"'::jsonb; end if;
    if (d->>'technicalRevision')::bigint<>q.technical_revision then reasons:=reasons||'"Dépendance technique modifiée depuis la décision"'::jsonb; end if;
    if (d->>'referenceRevision')::bigint<>r.revision or (d->>'copyId')::uuid is distinct from r.active_copy_id then reasons:=reasons||'"Référence de revue remplacée"'::jsonb; end if;
    if exists(select 1 from jsonb_array_elements(f->'targets')x where x->>'state'<>'available') then reasons:=reasons||'"Prestation liée indisponible ou incompatible"'::jsonb; end if;
    if not private.source_coverage_scope_available(q,r) then reasons:=reasons||'"Périmètre archivé ou indisponible"'::jsonb; end if;
    if jsonb_array_length(reasons)>0 then validity:='needs_review'; end if;
  end if;
  result:=jsonb_build_object('id',q.id,'revision',q.revision,'technicalRevision',q.technical_revision,'prescription',q.prescription,'expectedService',q.expected_service,'scope',q.scope,'completeness',q.completeness,'completenessReason',q.completeness_reason,'archived',q.archived,'treatment',coalesce(d->>'treatment','unresolved'),'validity',validity,'reasons',reasons,'lastDecision',case when detail then d else d-'facts' end);
  if detail then result:=result||jsonb_build_object('citations',f->'citations','links',f->'links','targets',f->'targets'); end if;
  return result;
end $$;
create function private.source_coverage_receipt(e private.estimate_source_coverage_events) returns jsonb language sql immutable set search_path='' as $$
select jsonb_build_object('eventId',e.id,'entityId',e.entity_id,'entityRevision',e.entity_revision,'canonicalRequest',e.canonical_request)
$$;
create function private.source_coverage_replay(version uuid,key uuid,request jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e private.estimate_source_coverage_events%rowtype; current_rev bigint;
begin
  select * into e from private.estimate_source_coverage_events where version_identity=version and operation_key=key;
  if not found then return null; end if;
  if e.project_id is distinct from(select project_id from public.estimate_versions where id=version) then perform private.source_coverage_error('ACCESS_DENIED'); end if;
  if e.canonical_request<>request then perform private.source_coverage_error('IDEMPOTENCY_CONFLICT'); end if;
  if e.operation like 'dimension.%' then select revision into current_rev from private.estimate_source_coverage_dimensions where id=e.entity_id;
  else select revision into current_rev from private.estimate_source_coverage_requirements where id=e.entity_id; end if;
  return jsonb_build_object('receipt',private.source_coverage_receipt(e),'currentRevision',coalesce(current_rev,e.entity_revision),'replayed',true);
end $$;
create function private.source_coverage_append(version uuid,entity uuid,entity_rev bigint,op text,key uuid,request jsonb,before_value jsonb,after_value jsonb,decision_value jsonb default null,reason_text text default null,event_identity uuid default gen_random_uuid())
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare e private.estimate_source_coverage_events%rowtype; r private.estimate_source_reviews%rowtype; actor uuid:=(request->>'actorId')::uuid; proj uuid;
begin
  select project_id into proj from public.estimate_versions where id=version;
  select * into r from private.estimate_source_reviews where version_id=version;
  insert into private.estimate_source_coverage_events(id,project_id,review_id,version_identity,requirement_id,entity_id,entity_revision,operation_key,operation,canonical_request,before_payload,after_payload,decision,reason,actor_id,actor_name,occurred_at)
    values(event_identity,proj,case when op like 'dimension.%' then null else r.id end,version,case when op like 'dimension.%' then null else entity end,entity,entity_rev,key,op,request,before_value,after_value,decision_value,reason_text,actor,(select full_name from public.profiles where id=actor),coalesce((decision_value->>'occurredAt')::timestamptz,clock_timestamp())) returning * into e;
  return jsonb_build_object('receipt',private.source_coverage_receipt(e),'currentRevision',entity_rev,'replayed',false);
end $$;

create function public.mutate_estimate_source_coverage_dimension(p_version_id uuid,p_dimension_id uuid,p_expected_revision bigint,p_operation_key uuid,p_operation text,p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' set lock_timeout='2s' as $$
declare ctx jsonb; d private.estimate_source_coverage_dimensions%rowtype; request jsonb; payload jsonb; replay jsonb; before_value jsonb; reason_text text; next_rev bigint;
begin
  if p_version_id is null or p_dimension_id is null or p_operation_key is null or p_expected_revision is null or p_expected_revision not between 0 and 9007199254740991 or p_operation not in('create','update','archive') or p_operation is null then perform private.source_coverage_error('INVALID_INPUT'); end if;
  if p_operation='archive' then
    perform private.source_coverage_object(p_payload,array['reason']); reason_text:=private.source_coverage_text(p_payload->'reason',1000);
    payload:=jsonb_build_object('reason',reason_text);
  else
    perform private.source_coverage_object(p_payload,array['kind','label','extentNote']);
    if p_payload->>'kind' not in('zone','network') or jsonb_typeof(p_payload->'kind')<>'string' then perform private.source_coverage_error('INVALID_INPUT'); end if;
    payload:=jsonb_build_object('kind',p_payload->>'kind','label',private.source_coverage_text(p_payload->'label',200),'extentNote',private.source_coverage_text(p_payload->'extentNote',2000,true));
  end if;
  ctx:=private.source_coverage_context(auth.uid(),p_version_id,true);
  request:=jsonb_build_object('versionId',p_version_id,'actorId',auth.uid(),'kind','dimension','request',jsonb_build_object('operation',p_operation,'dimensionId',p_dimension_id,'expectedRevision',p_expected_revision,'operationKey',p_operation_key)||case when p_operation='archive' then payload else jsonb_build_object('payload',payload) end);
  replay:=private.source_coverage_replay(p_version_id,p_operation_key,request); if replay is not null then return replay; end if;
  if ctx->>'status'<>'draft' then perform private.source_coverage_error('STALE'); end if;
  perform 1 from public.estimate_projects where id=(ctx->>'project_id')::uuid for update nowait;
  select * into d from private.estimate_source_coverage_dimensions where id=p_dimension_id for update;
  if p_operation='create' then
    if found or p_expected_revision<>0 or exists(select 1 from private.estimate_source_coverage_requirements where id=p_dimension_id) then perform private.source_coverage_error('STALE'); end if;
    if (select count(*) from private.estimate_source_coverage_dimensions where project_id=(ctx->>'project_id')::uuid)>=200 then perform private.source_coverage_error('INVALID_INPUT'); end if;
    insert into private.estimate_source_coverage_dimensions(id,tenant_id,project_id,kind,label,extent_note,revision)
      values(p_dimension_id,(ctx->>'tenant_id')::uuid,(ctx->>'project_id')::uuid,payload->>'kind',payload->>'label',payload->>'extentNote',1) returning * into d;
  else
    if not found or d.project_id<>(ctx->>'project_id')::uuid or d.tenant_id<>(ctx->>'tenant_id')::uuid then perform private.source_coverage_error('ACCESS_DENIED'); end if;
    if d.revision<>p_expected_revision or d.archived then perform private.source_coverage_error('STALE'); end if;
    before_value:=private.source_coverage_dimension_dto(d); next_rev:=private.source_coverage_next(d.revision);
    if p_operation='archive' then
      update private.estimate_source_coverage_dimensions set archived=true,revision=next_rev,extent_revision=private.source_coverage_next(extent_revision) where id=d.id returning * into d;
    else
      if payload->>'kind'<>d.kind then perform private.source_coverage_error('INVALID_INPUT'); end if;
      update private.estimate_source_coverage_dimensions set label=payload->>'label',extent_note=payload->>'extentNote',revision=next_rev,
        extent_revision=case when extent_note is distinct from payload->>'extentNote' then private.source_coverage_next(extent_revision) else extent_revision end where id=d.id returning * into d;
    end if;
  end if;
  return private.source_coverage_append(p_version_id,d.id,d.revision,'dimension.'||p_operation,p_operation_key,request,before_value,private.source_coverage_dimension_dto(d),null,reason_text);
exception when lock_not_available or deadlock_detected then perform private.source_coverage_error('BUSY');
end $$;

create function private.source_coverage_validate_payload(p jsonb,rev private.estimate_source_reviews) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare scope jsonb; mode text; zone uuid; network uuid; lot uuid; c jsonb; l jsonb; citations jsonb:='[]'; links jsonb:='[]'; cp private.estimate_source_reference_copies%rowtype; lk private.estimate_source_coverage_links%rowtype; target jsonb; completeness text; comp_reason text;
begin
  perform private.source_coverage_object(p,array['prescription','expectedService','scope','completeness','completenessReason','citations','links']);
  perform private.source_coverage_object(p->'scope',array['mode','zoneId','networkId','dpgfLotId']);
  mode:=private.source_coverage_text(p->'scope'->'mode',30);
  zone:=private.source_coverage_uuid(p->'scope'->'zoneId',true); network:=private.source_coverage_uuid(p->'scope'->'networkId',true); lot:=private.source_coverage_uuid(p->'scope'->'dpgfLotId',true);
  if mode not in('specified','unspecified','whole_project') or (mode='specified') is distinct from (zone is not null or network is not null) then perform private.source_coverage_error('INVALID_INPUT'); end if;
  perform 1 from private.estimate_source_coverage_dimensions where id in(zone,network) order by id for share nowait;
  if zone is not null and not exists(select 1 from private.estimate_source_coverage_dimensions where id=zone and project_id=rev.project_id and tenant_id=rev.tenant_id and kind='zone' and not archived)
    or network is not null and not exists(select 1 from private.estimate_source_coverage_dimensions where id=network and project_id=rev.project_id and tenant_id=rev.tenant_id and kind='network' and not archived) then perform private.source_coverage_error('INVALID_TARGET'); end if;
  if lot is not null then
    perform 1 from public.estimate_items where id=lot and version_id=rev.version_id and tenant_id=rev.tenant_id and item_type='section' for share nowait;
    if not found then perform private.source_coverage_error('INVALID_TARGET'); end if;
  end if;
  scope:=jsonb_build_object('mode',mode,'zoneId',zone,'networkId',network,'dpgfLotId',lot);
  completeness:=private.source_coverage_text(p->'completeness',20); comp_reason:=private.source_coverage_text(p->'completenessReason',1000,true);
  if completeness not in('partial','complete') or(completeness='complete' and comp_reason is null) then perform private.source_coverage_error('INVALID_INPUT'); end if;
  if jsonb_typeof(p->'citations') is distinct from 'array' or jsonb_typeof(p->'links') is distinct from 'array' or jsonb_array_length(p->'citations')>20 or jsonb_array_length(p->'links')>100 then perform private.source_coverage_error('INVALID_INPUT'); end if;
  for c in select value from jsonb_array_elements(p->'citations') loop
    perform private.source_coverage_object(c,array['id','copyId','page','folio','excerpt']);
    select * into cp from private.estimate_source_reference_copies where id=private.source_coverage_uuid(c->'copyId') and review_id=rev.id and state='verified' for share nowait;
    if not found then perform private.source_coverage_error('INVALID_TARGET'); end if;
    if jsonb_typeof(c->'page') is distinct from 'number' or (c->>'page')::numeric<>trunc((c->>'page')::numeric) or (c->>'page')::numeric not between 1 and cp.page_count then perform private.source_coverage_error('INVALID_INPUT'); end if;
    citations:=citations||jsonb_build_array(jsonb_build_object('id',private.source_coverage_uuid(c->'id'),'copyId',cp.id,'page',(c->>'page')::integer,'folio',private.source_coverage_text(c->'folio',100,true),'excerpt',private.source_coverage_text(c->'excerpt',4000)));
  end loop;
  if exists(select 1 from jsonb_array_elements(citations)x group by x->>'id' having count(*)>1) then perform private.source_coverage_error('INVALID_INPUT'); end if;
  for l in select value from jsonb_array_elements(p->'links') loop
    lk:=null; lk.id:=private.source_coverage_uuid(l->'id'); lk.kind:=private.source_coverage_text(l->'kind',20); lk.justification:=private.source_coverage_text(l->'justification',1000);
    if lk.kind='line' then
      perform private.source_coverage_object(l,array['id','kind','itemId','justification']); lk.item_id:=private.source_coverage_uuid(l->'itemId'); lk.target_key:='line:'||lk.item_id;
    elsif lk.kind='component' then
      perform private.source_coverage_object(l,array['id','kind','itemId','applicationId','snapshotId','componentId','justification']);
      lk.item_id:=private.source_coverage_uuid(l->'itemId'); lk.application_id:=private.source_coverage_uuid(l->'applicationId'); lk.snapshot_id:=private.source_coverage_uuid(l->'snapshotId'); lk.component_id:=private.source_coverage_text(l->'componentId',200); lk.target_key:='component:'||lk.item_id||':'||lk.application_id||':'||lk.snapshot_id||':'||lk.component_id;
    elsif lk.kind='register' then
      perform private.source_coverage_object(l,array['id','kind','registerEntryId','justification']); lk.register_entry_id:=private.source_coverage_uuid(l->'registerEntryId'); lk.target_key:='register:'||lk.register_entry_id;
    else perform private.source_coverage_error('INVALID_INPUT'); end if;
    perform 1 from public.estimate_items where id=lk.item_id for share nowait;
    perform 1 from public.estimate_generated_ouvrage_applications where id=lk.application_id for share nowait;
    perform 1 from public.estimate_generated_ouvrage_work_snapshots where id=lk.snapshot_id for share nowait;
    perform 1 from public.affaire_register_entries where id=lk.register_entry_id for share nowait;
    target:=private.source_coverage_target(lk,rev.version_id,rev.project_id,rev.tenant_id,scope,array(select private.source_coverage_uuid(x->'itemId') from jsonb_array_elements(p->'links')x where x->>'kind' in('line','component')));
    if target->>'state'<>'available' then perform private.source_coverage_error('INVALID_TARGET'); end if;
    links:=links||jsonb_build_array(private.source_coverage_link_dto(lk));
  end loop;
  if exists(select 1 from jsonb_array_elements(links)x group by x->>'id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(links)x group by x-'id'-'justification' having count(*)>1) then perform private.source_coverage_error('INVALID_INPUT'); end if;
  return jsonb_build_object('prescription',private.source_coverage_text(p->'prescription',4000),'expectedService',private.source_coverage_text(p->'expectedService',4000),'scope',scope,'completeness',completeness,'completenessReason',comp_reason,'citations',citations,'links',links);
end $$;

create function public.mutate_estimate_source_requirement(p_version_id uuid,p_requirement_id uuid,p_expected_revision bigint,p_expected_reference_revision bigint,p_operation_key uuid,p_operation text,p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' set lock_timeout='2s' as $$
declare ctx jsonb; r private.estimate_source_reviews%rowtype; q private.estimate_source_coverage_requirements%rowtype;
 c private.estimate_source_coverage_citations%rowtype; l private.estimate_source_coverage_links%rowtype; value jsonb; payload jsonb; request jsonb; replay jsonb; before_value jsonb; reason_text text; next_rev bigint; ids uuid[];
begin
  if p_requirement_id is null or p_version_id is null or p_operation_key is null or p_expected_revision is null or p_expected_revision not between 0 and 9007199254740991 or p_expected_reference_revision is null or p_expected_reference_revision not between 1 and 9007199254740991 or p_operation is null or p_operation not in('create','update','archive','reopen') then perform private.source_coverage_error('INVALID_INPUT'); end if;
  ctx:=private.source_coverage_context(auth.uid(),p_version_id,true);
  select * into r from private.estimate_source_reviews where version_id=p_version_id for update;
  if not found then perform private.source_coverage_error('STALE'); end if;
  -- Canonical JSON identities are lower case even for direct RPC calls. Full
  -- dependency validation is deliberately after replay (deleted targets allowed).
  payload:=p_payload;
  if p_operation in('archive','reopen') then
    perform private.source_coverage_object(payload,array['reason']); reason_text:=private.source_coverage_text(payload->'reason',1000);
  else
    perform private.source_coverage_object(payload,array['prescription','expectedService','scope','completeness','completenessReason','citations','links']);
    perform private.source_coverage_object(payload->'scope',array['mode','zoneId','networkId','dpgfLotId']);
    payload:=jsonb_set(payload,'{scope}',(payload->'scope')||jsonb_build_object('zoneId',private.source_coverage_uuid(payload->'scope'->'zoneId',true),'networkId',private.source_coverage_uuid(payload->'scope'->'networkId',true),'dpgfLotId',private.source_coverage_uuid(payload->'scope'->'dpgfLotId',true)));
    if jsonb_typeof(payload->'citations') is distinct from 'array' or jsonb_typeof(payload->'links') is distinct from 'array' or jsonb_array_length(payload->'citations')>20 or jsonb_array_length(payload->'links')>100 then perform private.source_coverage_error('INVALID_INPUT'); end if;
    select coalesce(jsonb_agg(x.value||jsonb_build_object('id',private.source_coverage_uuid(x.value->'id'),'copyId',private.source_coverage_uuid(x.value->'copyId')) order by x.ord),'[]') into value from jsonb_array_elements(payload->'citations') with ordinality x(value,ord);
    payload:=jsonb_set(payload,'{citations}',value);
    select coalesce(jsonb_agg(x.value||jsonb_build_object('id',private.source_coverage_uuid(x.value->'id'))||case x.value->>'kind'
      when 'line' then jsonb_build_object('itemId',private.source_coverage_uuid(x.value->'itemId'))
      when 'component' then jsonb_build_object('itemId',private.source_coverage_uuid(x.value->'itemId'),'applicationId',private.source_coverage_uuid(x.value->'applicationId'),'snapshotId',private.source_coverage_uuid(x.value->'snapshotId'))
      when 'register' then jsonb_build_object('registerEntryId',private.source_coverage_uuid(x.value->'registerEntryId')) else '{}'::jsonb end order by x.ord),'[]') into value from jsonb_array_elements(payload->'links') with ordinality x(value,ord);
    payload:=jsonb_set(payload,'{links}',value);
  end if;
  request:=jsonb_build_object('versionId',p_version_id,'actorId',auth.uid(),'kind','requirement','request',jsonb_build_object('operation',p_operation,'requirementId',p_requirement_id,'expectedRevision',p_expected_revision,'expectedReferenceRevision',p_expected_reference_revision,'operationKey',p_operation_key)||case when p_operation in('archive','reopen') then payload else jsonb_build_object('payload',payload) end);
  replay:=private.source_coverage_replay(p_version_id,p_operation_key,request); if replay is not null then return replay; end if;
  if ctx->>'status'<>'draft' or r.revision<>p_expected_reference_revision then perform private.source_coverage_error('STALE'); end if;
  select * into q from private.estimate_source_coverage_requirements where id=p_requirement_id for update;
  if p_operation='create' then
    if found or p_expected_revision<>0 or exists(select 1 from private.estimate_source_coverage_dimensions where id=p_requirement_id) then perform private.source_coverage_error('STALE'); end if;
    next_rev:=1;
  else
    if not found or q.review_id<>r.id then perform private.source_coverage_error('ACCESS_DENIED'); end if;
    if q.revision<>p_expected_revision or (q.archived and p_operation<>'reopen') or (not q.archived and p_operation='reopen') then perform private.source_coverage_error('STALE'); end if;
    next_rev:=private.source_coverage_next(q.revision); before_value:=private.source_coverage_requirement_dto(q.id,true);
  end if;
  if p_operation in('archive','reopen') then
    update private.estimate_source_coverage_requirements set archived=p_operation='archive',revision=next_rev where id=q.id;
  else
    payload:=private.source_coverage_validate_payload(payload,r);
    if p_operation='create' then
      insert into private.estimate_source_coverage_requirements(id,review_id,revision,prescription,expected_service,scope,completeness,completeness_reason)
        values(p_requirement_id,r.id,next_rev,payload->>'prescription',payload->>'expectedService',payload->'scope',payload->>'completeness',payload->>'completenessReason');
    else
      update private.estimate_source_coverage_requirements set revision=next_rev,prescription=payload->>'prescription',expected_service=payload->>'expectedService',scope=payload->'scope',completeness=payload->>'completeness',completeness_reason=payload->>'completenessReason' where id=q.id;
    end if;
    ids:=array(select (x->>'id')::uuid from jsonb_array_elements(payload->'citations')x);
    update private.estimate_source_coverage_citations set active=false where requirement_id=p_requirement_id and not(id=any(ids));
    for value in select x from jsonb_array_elements(payload->'citations')x loop
      select * into c from private.estimate_source_coverage_citations where id=(value->>'id')::uuid for update;
      if found then
        if c.requirement_id<>p_requirement_id or c.copy_id<>(value->>'copyId')::uuid then perform private.source_coverage_error('INVALID_INPUT'); end if;
        update private.estimate_source_coverage_citations set active=true,page=(value->>'page')::integer,folio=value->>'folio',excerpt=value->>'excerpt',
          verification=case when active and page=(value->>'page')::integer and folio is not distinct from value->>'folio' and excerpt=value->>'excerpt' then verification else null end where id=c.id;
      else
        insert into private.estimate_source_coverage_citations(id,requirement_id,copy_id,page,folio,excerpt) values((value->>'id')::uuid,p_requirement_id,(value->>'copyId')::uuid,(value->>'page')::integer,value->>'folio',value->>'excerpt');
      end if;
    end loop;
    if exists(select 1 from private.estimate_source_coverage_links where id in(select (x->>'id')::uuid from jsonb_array_elements(payload->'links')x) and requirement_id<>p_requirement_id) then perform private.source_coverage_error('INVALID_INPUT'); end if;
    delete from private.estimate_source_coverage_links where requirement_id=p_requirement_id;
    for value in select x from jsonb_array_elements(payload->'links')x loop
      l:=null; l.id:=(value->>'id')::uuid; l.requirement_id:=p_requirement_id; l.kind:=value->>'kind'; l.item_id:=(value->>'itemId')::uuid; l.application_id:=(value->>'applicationId')::uuid; l.snapshot_id:=(value->>'snapshotId')::uuid; l.component_id:=value->>'componentId'; l.register_entry_id:=(value->>'registerEntryId')::uuid; l.justification:=value->>'justification';
      l.target_key:=case l.kind when 'line' then 'line:'||l.item_id when 'component' then 'component:'||l.item_id||':'||l.application_id||':'||l.snapshot_id||':'||l.component_id else 'register:'||l.register_entry_id end;
      insert into private.estimate_source_coverage_links select (l).*;
    end loop;
  end if;
  return private.source_coverage_append(p_version_id,p_requirement_id,next_rev,'requirement.'||p_operation,p_operation_key,request,before_value,private.source_coverage_requirement_dto(p_requirement_id,true),null,reason_text);
exception when lock_not_available or deadlock_detected then perform private.source_coverage_error('BUSY');
end $$;

create function public.get_estimate_source_coverage_targets(p_version_id uuid,p_kind text,p_search text default '',p_after_id uuid default null,p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ctx jsonb; items jsonb:='[]'; components jsonb; option jsonb; target jsonb; i public.estimate_items%rowtype; e public.affaire_register_entries%rowtype; entry record; l private.estimate_source_coverage_links%rowtype; last_id uuid; next_id uuid; total_components integer:=0; count_rows integer:=0;
begin
  if p_kind is null or p_kind not in('line','component','register','section') or p_search is null or char_length(p_search)>200 or p_limit is null or p_limit not between 1 and 100 then perform private.source_coverage_error('INVALID_INPUT'); end if;
  ctx:=private.source_coverage_context(auth.uid(),p_version_id);
  if p_kind='register' then
    for e in select * from public.affaire_register_entries where project_id=(ctx->>'project_id')::uuid and tenant_id=(ctx->>'tenant_id')::uuid and is_active and(version_id is null or version_id=p_version_id) and(p_after_id is null or id>p_after_id) and strpos(lower(text),lower(p_search))>0 order by id limit p_limit+1 loop
      count_rows:=count_rows+1; if count_rows>p_limit then next_id:=last_id; exit; end if;
      option:=jsonb_build_object('id',e.id,'title',e.text,'kind','register','fact',jsonb_build_object('kind','register','registerEntryId',e.id,'entryKind',e.kind,'text',e.text,'status',e.status,'scopeType',e.scope_type,'scopeId',e.scope_id,'scopeRef',e.scope_ref,'scopeLabel',e.scope_label,'active',e.is_active,'updatedAt',e.updated_at),'components','[]'::jsonb);
      items:=items||jsonb_build_array(option); last_id:=e.id;
    end loop;
  else
    for i in select * from public.estimate_items item where version_id=p_version_id and tenant_id=(ctx->>'tenant_id')::uuid and item_type=(case when p_kind='section' then 'section' else 'line' end)::public.estimate_item_type and(p_after_id is null or id>p_after_id) and strpos(lower(title),lower(p_search))>0
      and(p_kind<>'component' or exists(select 1 from public.estimate_generated_ouvrage_work_snapshots where estimate_item_id=item.id and target_version_id=p_version_id)) order by id limit p_limit+1 loop
      count_rows:=count_rows+1; if count_rows>p_limit then next_id:=last_id; exit; end if;
      components:='[]';
      if p_kind='component' then
        for entry in select a.id as application_id,s.id as snapshot_id,c.value->>'componentId' as component_id from public.estimate_generated_ouvrage_applications a join public.estimate_generated_ouvrage_work_snapshots s on s.draft_id=a.draft_id and s.parent_work_id=a.candidate_id and s.estimate_item_id=a.estimate_item_id cross join lateral jsonb_array_elements(s.components)c where a.estimate_item_id=i.id order by s.id,c.value->>'componentId' loop
          total_components:=total_components+1; if total_components>100 then perform private.source_coverage_error('PAYLOAD_TOO_LARGE'); end if;
          l:=null; l.kind:='component'; l.item_id:=i.id; l.application_id:=entry.application_id; l.snapshot_id:=entry.snapshot_id; l.component_id:=entry.component_id;
          target:=private.source_coverage_target(l,p_version_id,(ctx->>'project_id')::uuid,(ctx->>'tenant_id')::uuid,'{}');
          if target->>'state'='available' then components:=components||jsonb_build_array(target->'fact'); end if;
        end loop;
      end if;
      items:=items||jsonb_build_array(jsonb_build_object('id',i.id,'title',i.title,'kind',p_kind,'fact',case when p_kind='section' then null else private.source_coverage_line_fact(i)||jsonb_build_object('kind','line') end,'components',components)); last_id:=i.id;
    end loop;
  end if;
  return jsonb_build_object('items',items,'nextAfterId',next_id);
end $$;

-- Only technical fields participate. Prices, margin, display positions and
-- mutable library assemblies are deliberately absent from this projection.
create function private.source_coverage_technical_row(table_name text,row_value jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare keys text[]; result jsonb; mapping jsonb;
begin
  if row_value is null then return null; end if;
  case table_name
  when 'estimate_items' then keys:=array['id','tenant_id','version_id','item_type','parent_id','title','description','quantity','h_mo','h_mo_atelier','h_mo_chantier','labor_role_id','labor_role_atelier_id','labor_role_chantier_id','product_id','supply_type_id','line_nature'];
  when 'affaire_register_entries' then keys:=array['id','tenant_id','project_id','version_id','kind','text','status','scope_type','scope_id','is_active'];
  when 'estimate_source_coverage_dimensions' then keys:=array['id','tenant_id','project_id','kind','extent_note','extent_revision','archived'];
  when 'estimate_generated_ouvrage_candidates' then keys:=array['id','tenant_id','project_id','target_version_id','draft_id','resolution_status'];
  when 'estimate_generated_ouvrage_drafts' then keys:=array['id','tenant_id','project_id','target_version_id','status'];
  when 'estimate_generated_ouvrage_applications' then keys:=array['id','tenant_id','draft_id','candidate_id','target_version_id','estimate_item_id'];
  when 'estimate_generated_ouvrage_work_snapshots' then keys:=array['id','tenant_id','project_id','draft_id','parent_work_id','target_version_id','estimate_item_id'];
  else perform private.source_coverage_error('INVALID_INPUT'); end case;
  select coalesce(jsonb_object_agg(k,row_value->k),'{}') into result from unnest(keys)k;
  -- For an exception, its free reference/description IS its technical scope.
  -- A display-label correction on a project/lot/line is not a scope change.
  if table_name='affaire_register_entries' and row_value->>'scope_type'='exception' then
    result:=result||jsonb_build_object('scopeRef',row_value->'scope_ref','scopeLabel',row_value->'scope_label');
  end if;
  if table_name='estimate_generated_ouvrage_applications' then
    result:=result||jsonb_build_object('applied',jsonb_build_object('designation',row_value->'applied_payload'->'designation','unit',row_value->'applied_payload'->'unit','quantity',row_value->'applied_payload'->'quantity','lot_id',row_value->'applied_payload'->'lot_id'));
    mapping:=row_value->'applied_payload'->'estimate_item_mapping';
  elsif table_name='estimate_generated_ouvrage_work_snapshots' then
    result:=result||jsonb_build_object('applied',jsonb_build_object('designation',row_value->'metadata'->'applied_values'->'designation','unit',row_value->'metadata'->'applied_values'->'unit','quantity',row_value->'metadata'->'applied_values'->'quantity','lot_id',row_value->'metadata'->'applied_values'->'lot_id'),'components',(select coalesce(jsonb_agg(jsonb_build_object('id',c->'componentId','title',c->'designation','unit',c->'unit','quantity',c->'quantity','type',c->'costType','loss',c->'lossCoeffBp','yieldValue',c->'yieldValue','yieldUnit',c->'yieldUnit') order by c->>'componentId'),'[]') from jsonb_array_elements(row_value->'components')c));
    mapping:=row_value->'metadata'->'estimate_item_mapping';
  end if;
  if mapping is not null then result:=result||jsonb_build_object('mapping',jsonb_build_object('hours',mapping->'hMo','laborRole',mapping->'laborRoleId','mode',mapping->'mode')); end if;
  return result;
end $$;

create function private.source_coverage_invalidate() returns trigger language plpgsql security definer set search_path='' as $$
declare old_value jsonb; new_value jsonb; identities uuid[]; affected uuid[]; req uuid; descendants uuid[];
begin
  if tg_op<>'INSERT' then old_value:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then new_value:=to_jsonb(new); end if;
  if private.source_coverage_technical_row(tg_table_name,old_value) is not distinct from private.source_coverage_technical_row(tg_table_name,new_value) then return null; end if;
  identities:=array[(old_value->>'id')::uuid,(new_value->>'id')::uuid];
  if tg_table_name='estimate_source_coverage_dimensions' then
    select array_agg(id order by id) into affected from private.estimate_source_coverage_requirements where(scope->>'zoneId')::uuid=any(identities) or(scope->>'networkId')::uuid=any(identities);
  elsif tg_table_name='estimate_items' then
    with recursive children as(select id from public.estimate_items where id=any(identities) union select i.id from public.estimate_items i join children c on i.parent_id=c.id)
      select array_agg(id) into descendants from children;
    identities:=identities||coalesce(descendants,'{}');
    select array_agg(id order by id) into affected from private.estimate_source_coverage_requirements where id in(select requirement_id from private.estimate_source_coverage_links where item_id=any(identities)) or(scope->>'dpgfLotId')::uuid=any(identities);
  else
    select array_agg(distinct l.requirement_id order by l.requirement_id) into affected from private.estimate_source_coverage_links l
    where(tg_table_name='affaire_register_entries' and l.register_entry_id=any(identities))
      or(tg_table_name='estimate_generated_ouvrage_applications' and l.application_id=any(identities))
      or(tg_table_name='estimate_generated_ouvrage_work_snapshots' and l.snapshot_id=any(identities))
      or(tg_table_name='estimate_generated_ouvrage_candidates' and l.application_id in(select id from public.estimate_generated_ouvrage_applications where candidate_id=any(identities)))
      or(tg_table_name='estimate_generated_ouvrage_drafts' and l.application_id in(select id from public.estimate_generated_ouvrage_applications where draft_id=any(identities)));
  end if;
  -- Lock all affected requirements in the same order. Cascaded parent deletion
  -- can already have removed them; it must not prevent deleting a draft affaire.
  foreach req in array coalesce(affected,'{}') loop
    update private.estimate_source_coverage_requirements q set technical_revision=private.source_coverage_next(q.technical_revision)
      where q.id=req and exists(select 1 from private.estimate_source_reviews r join public.estimate_versions v on v.id=r.version_id where r.id=q.review_id);
  end loop;
  return null;
end $$;
create trigger source_coverage_item_technical after insert or update or delete on public.estimate_items for each row execute function private.source_coverage_invalidate();
create trigger source_coverage_application_technical after insert or update or delete on public.estimate_generated_ouvrage_applications for each row execute function private.source_coverage_invalidate();
create trigger source_coverage_snapshot_technical after insert or update or delete on public.estimate_generated_ouvrage_work_snapshots for each row execute function private.source_coverage_invalidate();
create trigger source_coverage_candidate_technical after insert or update or delete on public.estimate_generated_ouvrage_candidates for each row execute function private.source_coverage_invalidate();
create trigger source_coverage_draft_technical after insert or update or delete on public.estimate_generated_ouvrage_drafts for each row execute function private.source_coverage_invalidate();
create trigger source_coverage_register_technical after insert or update or delete on public.affaire_register_entries for each row execute function private.source_coverage_invalidate();
create trigger source_coverage_dimension_technical after update or delete on private.estimate_source_coverage_dimensions for each row execute function private.source_coverage_invalidate();

create function private.source_coverage_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='estimate_versions' then
    if(new.id,new.project_id,new.tenant_id) is distinct from(old.id,old.project_id,old.tenant_id) and exists(select 1 from private.estimate_source_coverage_events where version_identity=old.id) then raise exception using errcode='42501',message='SOURCE_COVERAGE_ACCESS_DENIED'; end if;
  elsif tg_table_name='estimate_projects' then
    if(new.id,new.tenant_id) is distinct from(old.id,old.tenant_id) and(exists(select 1 from private.estimate_source_coverage_dimensions where project_id=old.id) or exists(select 1 from private.estimate_source_coverage_events where project_id=old.id)) then raise exception using errcode='42501',message='SOURCE_COVERAGE_ACCESS_DENIED'; end if;
  elsif tg_table_name='estimate_source_coverage_events' then
    if tg_op='DELETE' and(not exists(select 1 from public.estimate_projects where id=old.project_id) or(old.review_id is not null and not exists(select 1 from private.estimate_source_reviews where id=old.review_id))) then return old; end if;
    raise exception using errcode='42501',message='SOURCE_COVERAGE_ACCESS_DENIED';
  elsif tg_table_name='estimate_source_coverage_dimensions' then
    if new.id<>old.id or new.tenant_id<>old.tenant_id or new.project_id<>old.project_id or new.kind<>old.kind then raise exception using errcode='42501',message='SOURCE_COVERAGE_ACCESS_DENIED'; end if;
  elsif tg_table_name='estimate_source_coverage_requirements' then
    if new.id<>old.id or new.review_id<>old.review_id then raise exception using errcode='42501',message='SOURCE_COVERAGE_ACCESS_DENIED'; end if;
  end if;
  return new;
end $$;
create trigger source_coverage_event_immutable before update or delete on private.estimate_source_coverage_events for each row execute function private.source_coverage_guard();
create trigger source_coverage_dimension_identity before update on private.estimate_source_coverage_dimensions for each row execute function private.source_coverage_guard();
create trigger source_coverage_requirement_identity before update on private.estimate_source_coverage_requirements for each row execute function private.source_coverage_guard();
create trigger aaa_source_coverage_version_identity before update on public.estimate_versions for each row execute function private.source_coverage_guard();
create trigger aaa_source_coverage_project_identity before update on public.estimate_projects for each row execute function private.source_coverage_guard();

-- Private helpers cannot be called through the API. Only the two routines that
-- consume the server's physical PDF verification accept a service-role caller.
do $acl$
declare fn regprocedure;
begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'source_coverage_%' loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);
  end loop;
end $acl$;
revoke all on function public.get_estimate_source_coverage(uuid,uuid,uuid,integer,bigint,uuid),public.preview_estimate_source_coverage_decision(uuid,uuid),public.mutate_estimate_source_coverage_dimension(uuid,uuid,bigint,uuid,text,jsonb),public.mutate_estimate_source_requirement(uuid,uuid,bigint,bigint,uuid,text,jsonb),public.get_estimate_source_coverage_targets(uuid,text,text,uuid,integer),public.verify_estimate_source_requirement_citation(uuid,uuid,uuid,uuid,bigint,bigint,text,uuid),public.decide_estimate_source_requirement(uuid,uuid,uuid,bigint,bigint,bigint,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_estimate_source_coverage(uuid,uuid,uuid,integer,bigint,uuid),public.preview_estimate_source_coverage_decision(uuid,uuid),public.mutate_estimate_source_coverage_dimension(uuid,uuid,bigint,uuid,text,jsonb),public.mutate_estimate_source_requirement(uuid,uuid,bigint,bigint,uuid,text,jsonb),public.get_estimate_source_coverage_targets(uuid,text,text,uuid,integer) to authenticated;
grant execute on function public.verify_estimate_source_requirement_citation(uuid,uuid,uuid,uuid,bigint,bigint,text,uuid),public.decide_estimate_source_requirement(uuid,uuid,uuid,bigint,bigint,bigint,text,uuid,jsonb) to service_role;
