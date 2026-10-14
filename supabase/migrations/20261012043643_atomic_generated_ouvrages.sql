begin;

-- Human review, application and rejection are database transactions. The
-- existing TypeScript calculator remains the financial authority; SQL owns
-- authorization, exact material identity, canonical storage and atomicity.
create table private.generated_ouvrage_application_receipts (
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  operation_key uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  draft_id uuid not null references public.estimate_generated_ouvrage_drafts(id) on delete cascade,
  actor_id uuid not null,
  canonical_request jsonb not null,
  response jsonb not null,
  committed_at timestamptz not null default clock_timestamp(),
  primary key(version_id,operation_key),
  check(jsonb_typeof(canonical_request)='object' and jsonb_typeof(response)='object'),
  check(octet_length(response::text)<=2097152)
);
create index generated_ouvrage_receipts_draft_idx on private.generated_ouvrage_application_receipts(draft_id);
create index generated_ouvrage_receipts_project_idx on private.generated_ouvrage_application_receipts(project_id);
create index generated_ouvrage_receipts_tenant_idx on private.generated_ouvrage_application_receipts(tenant_id);
alter table private.generated_ouvrage_application_receipts enable row level security;
revoke all on private.generated_ouvrage_application_receipts from public,anon,authenticated,service_role;

create function private.generated_ouvrage_error(code text) returns void
language plpgsql set search_path='' as $$
begin
  raise exception using errcode=case
    when code in('FORBIDDEN','WRITE_REQUIRED') then '42501'
    when code='NOT_FOUND' then 'P0002'
    when code='LOCK_REQUIRED' then '55000'
    when code in('STALE','REVIEW_CHANGED','CONTEXT_CHANGED','IDEMPOTENCY_CONFLICT') then '40001'
    when code='APPLY_REJECTED' then '23514' else '22023' end,
    message='GENERATED_OUVRAGE_'||code;
end $$;
revoke all on function private.generated_ouvrage_error(text) from public,anon,authenticated,service_role;

create function private.generated_ouvrage_context(p_version_id uuid,p_draft_id uuid,p_write boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare ctx jsonb; d public.estimate_generated_ouvrage_drafts%rowtype;
begin
  begin ctx:=private.estimate_batch_context(p_version_id,p_write);
  exception when others then
    if sqlerrm='ESTIMATE_BATCH_NOT_FOUND' then perform private.generated_ouvrage_error('NOT_FOUND');
    elsif sqlerrm='ESTIMATE_BATCH_FORBIDDEN' then perform private.generated_ouvrage_error('FORBIDDEN');
    elsif sqlerrm='ESTIMATE_BATCH_CONTEXT_CHANGED' then perform private.generated_ouvrage_error('CONTEXT_CHANGED');
    else raise; end if;
  end;
  select * into d from public.estimate_generated_ouvrage_drafts where id=p_draft_id
    and target_version_id=p_version_id and tenant_id=(ctx->>'tenant_id')::uuid and project_id=(ctx->>'project_id')::uuid;
  if not found then perform private.generated_ouvrage_error('NOT_FOUND'); end if;
  if p_write and d.created_by is distinct from (ctx->>'actor_id')::uuid then perform private.generated_ouvrage_error('FORBIDDEN'); end if;
  return ctx||jsonb_build_object('draft',to_jsonb(d));
end $$;
revoke all on function private.generated_ouvrage_context(uuid,uuid,boolean) from public,anon,authenticated,service_role;

create function private.generated_ouvrage_lock(p_version_id uuid,p_draft_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare ctx jsonb; v public.estimate_versions%rowtype;
begin
  ctx:=private.generated_ouvrage_context(p_version_id,p_draft_id,true);
  select * into v from public.estimate_versions where id=p_version_id for update;
  perform 1 from public.estimate_projects where id=v.project_id for share nowait;
  perform 1 from public.estimate_generated_ouvrage_drafts where id=p_draft_id for update nowait;
  ctx:=private.generated_ouvrage_context(p_version_id,p_draft_id,true);
  if v.tenant_id is distinct from (ctx->>'tenant_id')::uuid or v.project_id is distinct from (ctx->>'project_id')::uuid then perform private.generated_ouvrage_error('STALE'); end if;
  return ctx||jsonb_build_object('version',to_jsonb(v));
end $$;
revoke all on function private.generated_ouvrage_lock(uuid,uuid) from public,anon,authenticated,service_role;

create function private.generated_ouvrage_mutable(ctx jsonb,p_session uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare lease public.draft_locks%rowtype;
begin
  if ctx->'version'->>'status'<>'draft' or (ctx->>'is_archived')::boolean
    or ctx->'draft'->>'status' not in('pending','partially_applied') then perform private.generated_ouvrage_error('FORBIDDEN'); end if;
  select * into lease from public.draft_locks where version_id=(ctx->'version'->>'id')::uuid for update;
  if not found or p_session is null or lease.user_id is distinct from (ctx->>'actor_id')::uuid
    or lease.session_id is distinct from p_session or lease.expires_at<=clock_timestamp() then perform private.generated_ouvrage_error('LOCK_REQUIRED'); end if;
end $$;
revoke all on function private.generated_ouvrage_mutable(jsonb,uuid) from public,anon,authenticated,service_role;

-- SQL STABLE gives all raw arrays the caller's single statement snapshot.
-- Draft aggregates are returned but excluded from the material review token.
create function private.generated_ouvrage_review(p_draft_id uuid,p_candidate_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  with d as (select * from public.estimate_generated_ouvrage_drafts where id=p_draft_id),
  c as (select * from public.estimate_generated_ouvrage_candidates where id=p_candidate_id and draft_id=p_draft_id),
  s as (select * from public.estimate_generated_ouvrage_subdetail_drafts where draft_id=p_draft_id and parent_work_id=p_candidate_id),
  i as (select x.* from public.estimate_generated_ouvrage_subdetail_items x join s on s.id=x.subdetail_id),
  ls as (select x.* from public.estimate_generated_ouvrage_subdetail_item_sources x join i on i.id=x.component_id),
  cs as (select * from public.estimate_generated_ouvrage_candidate_sources where draft_id=p_draft_id and candidate_id=p_candidate_id),
  f as (select x.* from public.estimate_generated_ouvrage_source_fragments x where x.draft_id=p_draft_id and x.id in(
    select source_fragment_id from cs union select source_fragment_id from ls union select source_fragment_id from i)),
  snapshot as (select jsonb_build_object(
    'draft',(select to_jsonb(d) from d),'candidate',(select to_jsonb(c) from c),'subdetailDraft',(select to_jsonb(s) from s),
    'items',coalesce((select jsonb_agg(to_jsonb(i) order by component_order,id) from i),'[]'::jsonb),
    'itemSources',coalesce((select jsonb_agg(to_jsonb(ls) order by component_id,source_rank,id) from ls),'[]'::jsonb),
    'candidateSources',coalesce((select jsonb_agg(to_jsonb(cs) order by source_rank,id) from cs),'[]'::jsonb),
    'fragments',coalesce((select jsonb_agg(to_jsonb(f) order by id) from f),'[]'::jsonb)) value),
  material as (select value,jsonb_set(value,'{draft}',jsonb_build_object(
    'id',value->'draft'->'id','tenant_id',value->'draft'->'tenant_id','project_id',value->'draft'->'project_id',
    'target_version_id',value->'draft'->'target_version_id','created_by',value->'draft'->'created_by','source_kind',value->'draft'->'source_kind')) facts from snapshot)
  select value||jsonb_build_object('reviewToken',case when value->'subdetailDraft'='null'::jsonb then null else
    encode(extensions.digest(convert_to(facts::text,'UTF8'),'sha256'),'hex') end) from material
$$;
revoke all on function private.generated_ouvrage_review(uuid,uuid) from public,anon,authenticated,service_role;

create function public.read_generated_ouvrage_review(p_version_id uuid,p_draft_id uuid,p_candidate_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ctx jsonb; result jsonb;
begin
  ctx:=private.generated_ouvrage_context(p_version_id,p_draft_id,false);
  result:=private.generated_ouvrage_review(p_draft_id,p_candidate_id);
  if result->'candidate'='null'::jsonb then perform private.generated_ouvrage_error('NOT_FOUND'); end if;
  return result;
end $$;
revoke all on function public.read_generated_ouvrage_review(uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.read_generated_ouvrage_review(uuid,uuid,uuid) to authenticated;

create function private.generated_ouvrage_project_draft(p_draft_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare new_summary jsonb; next_status text; d public.estimate_generated_ouvrage_drafts%rowtype;
begin
  select jsonb_build_object('totalCandidates',count(*),'certainCount',count(*) filter(where ai_status='certain'),
    'plausibleCount',count(*) filter(where ai_status='plausible'),'questionCount',count(*) filter(where ai_status='question'),
    'pendingCount',count(*) filter(where resolution_status='pending'),'insertedCount',count(*) filter(where resolution_status='inserted'),
    'rejectedCount',count(*) filter(where resolution_status='rejected')) into new_summary from public.estimate_generated_ouvrage_candidates where draft_id=p_draft_id;
  next_status:=case when exists(select 1 from public.estimate_generated_ouvrage_applications where draft_id=p_draft_id)
    then case when (new_summary->>'pendingCount')::integer=0 then 'applied' else 'partially_applied' end
    else case when (new_summary->>'pendingCount')::integer=0 then 'discarded' else 'pending' end end;
  update public.estimate_generated_ouvrage_drafts set status=next_status,summary=new_summary,
    applied_at=case when next_status in('applied','partially_applied') then coalesce(applied_at,clock_timestamp()) else null end
    where id=p_draft_id returning * into d;
  return to_jsonb(d);
end $$;
revoke all on function private.generated_ouvrage_project_draft(uuid) from public,anon,authenticated,service_role;

create function public.persist_generated_ouvrage_review(p_version_id uuid,p_draft_id uuid,p_candidate_id uuid,
  p_draft_lock_session_id uuid,p_expected_review_token text,p_review jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; review jsonb; component jsonb; source jsonb; part record; source_part record;
  target_subdetail_id uuid; component_id uuid; existing_ids uuid[]; supplied_ids uuid[]; allowed text[];
begin
  ctx:=private.generated_ouvrage_lock(p_version_id,p_draft_id);
  perform private.generated_ouvrage_mutable(ctx,p_draft_lock_session_id);
  perform 1 from public.estimate_generated_ouvrage_candidates where id=p_candidate_id and draft_id=p_draft_id for update nowait;
  review:=private.generated_ouvrage_review(p_draft_id,p_candidate_id);
  if review->'candidate'='null'::jsonb then perform private.generated_ouvrage_error('NOT_FOUND'); end if;
  if review->'candidate'->>'resolution_status'<>'pending' then perform private.generated_ouvrage_error('REVIEW_CHANGED'); end if;
  if review->>'reviewToken' is distinct from p_expected_review_token then perform private.generated_ouvrage_error('REVIEW_CHANGED'); end if;
  if jsonb_typeof(p_review) is distinct from 'object' or p_review-array['status','summary','generation_metadata','components']<>'{}'::jsonb
    or not(p_review?&array['status','summary','generation_metadata','components']) or p_review->>'status' not in('pending_review','reviewed')
    or jsonb_typeof(p_review->'summary') is distinct from 'object' or jsonb_typeof(p_review->'generation_metadata') is distinct from 'object'
    or jsonb_typeof(p_review->'components') is distinct from 'array' or jsonb_array_length(p_review->'components') not between 1 and 24
    or octet_length(p_review::text)>1048576 then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  select coalesce(array_agg((x->>'id')::uuid),'{}') into existing_ids from jsonb_array_elements(review->'items') x;
  select coalesce(array_agg((x->>'componentId')::uuid) filter(where x->>'componentId' is not null),'{}') into supplied_ids from jsonb_array_elements(p_review->'components') x;
  if cardinality(supplied_ids)<>(select count(distinct x) from unnest(supplied_ids)x) or exists(select 1 from unnest(supplied_ids)x where not(x=any(existing_ids))) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  allowed:=array['componentId','status','costType','designation','unit','quantity','unitCostHtCents','lossCoeffBp','yieldValue','yieldUnit','confidence','sourceLabel','facts','hypotheses','inferences','riskSignals','sources'];
  for component in select * from jsonb_array_elements(p_review->'components') loop
    if jsonb_typeof(component)<>'object' or component-allowed<>'{}'::jsonb or not(component?&array['status','costType','designation','quantity','unitCostHtCents','lossCoeffBp','confidence','facts','hypotheses','inferences','riskSignals','sources'])
      or component->>'status' not in('suggested','manual','rejected') or component->>'costType' not in('material','labor','equipment','subcontract')
      or jsonb_typeof(component->'designation')<>'string' or length(btrim(component->>'designation')) not between 1 and 500
      or jsonb_typeof(component->'sources')<>'array' or jsonb_array_length(component->'sources')>6 then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    if exists(select 1 from jsonb_each(component) x where x.key in('quantity','unitCostHtCents','lossCoeffBp','confidence') and (jsonb_typeof(x.value)<>'number' or x.value::text::numeric<0)) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    if (component->>'unitCostHtCents')::numeric<>trunc((component->>'unitCostHtCents')::numeric) or (component->>'lossCoeffBp')::numeric<>trunc((component->>'lossCoeffBp')::numeric) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    if exists(select 1 from unnest(array['facts','hypotheses','inferences','riskSignals']) key where jsonb_typeof(component->key)<>'array' or jsonb_array_length(component->key)>8) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    for source in select * from jsonb_array_elements(component->'sources') loop
      if jsonb_typeof(source)<>'object' or source-array['sourceFragmentId','evidenceKind','note']<>'{}'::jsonb or source->>'evidenceKind' not in('fact','hypothesis','inference') then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
      perform 1 from public.estimate_generated_ouvrage_source_fragments where id=(source->>'sourceFragmentId')::uuid and draft_id=p_draft_id and status='active' for share nowait;
      if not found then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    end loop;
  end loop;
  target_subdetail_id:=(review->'subdetailDraft'->>'id')::uuid;
  if target_subdetail_id is null then
    insert into public.estimate_generated_ouvrage_subdetail_drafts(tenant_id,project_id,target_version_id,draft_id,parent_work_id,created_by,status)
      values((ctx->>'tenant_id')::uuid,(ctx->>'project_id')::uuid,p_version_id,p_draft_id,p_candidate_id,(ctx->>'actor_id')::uuid,'pending_review') returning id into target_subdetail_id;
  end if;
  delete from public.estimate_generated_ouvrage_subdetail_items where subdetail_id=target_subdetail_id;
  for part in select value,ordinality from jsonb_array_elements(p_review->'components') with ordinality loop
    component:=part.value; component_id:=coalesce((component->>'componentId')::uuid,gen_random_uuid());
    insert into public.estimate_generated_ouvrage_subdetail_items(id,tenant_id,project_id,draft_id,subdetail_id,parent_work_id,source_fragment_id,component_order,status,cost_type,designation,unit,quantity,unit_cost_ht_cents,loss_coeff_bp,yield_value,yield_unit,confidence,source_label,facts,hypotheses,inferences,metadata)
      values(component_id,(ctx->>'tenant_id')::uuid,(ctx->>'project_id')::uuid,p_draft_id,target_subdetail_id,p_candidate_id,(component->'sources'->0->>'sourceFragmentId')::uuid,part.ordinality-1,
        component->>'status',component->>'costType',btrim(component->>'designation'),nullif(btrim(component->>'unit'),''),(component->>'quantity')::numeric,(component->>'unitCostHtCents')::integer,(component->>'lossCoeffBp')::integer,
        (component->>'yieldValue')::numeric,nullif(btrim(component->>'yieldUnit'),''),(component->>'confidence')::numeric,nullif(btrim(component->>'sourceLabel'),''),component->'facts',component->'hypotheses',component->'inferences',jsonb_build_object('risk_signals',component->'riskSignals'));
    for source_part in select value,ordinality from jsonb_array_elements(component->'sources') with ordinality loop
      source:=source_part.value;
      insert into public.estimate_generated_ouvrage_subdetail_item_sources(tenant_id,draft_id,subdetail_id,parent_work_id,component_id,source_fragment_id,source_rank,evidence_kind,note)
        values((ctx->>'tenant_id')::uuid,p_draft_id,target_subdetail_id,p_candidate_id,component_id,(source->>'sourceFragmentId')::uuid,source_part.ordinality-1,source->>'evidenceKind',nullif(btrim(source->>'note'),''));
    end loop;
  end loop;
  update public.estimate_generated_ouvrage_subdetail_drafts set status=p_review->>'status',summary=p_review->'summary',generation_metadata=p_review->'generation_metadata',applied_at=null where id=target_subdetail_id;
  return private.generated_ouvrage_review(p_draft_id,p_candidate_id);
exception when lock_not_available or deadlock_detected then perform private.generated_ouvrage_error('STALE'); return null;
  when invalid_text_representation or numeric_value_out_of_range then perform private.generated_ouvrage_error('INVALID_INPUT'); return null;
end $$;
revoke all on function public.persist_generated_ouvrage_review(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,service_role;
grant execute on function public.persist_generated_ouvrage_review(uuid,uuid,uuid,uuid,text,jsonb) to authenticated;

create function public.reject_generated_ouvrage_candidate(p_version_id uuid,p_draft_id uuid,p_candidate_id uuid,p_draft_lock_session_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; c public.estimate_generated_ouvrage_candidates%rowtype; d jsonb;
begin
  ctx:=private.generated_ouvrage_lock(p_version_id,p_draft_id); perform private.generated_ouvrage_mutable(ctx,p_draft_lock_session_id);
  select * into c from public.estimate_generated_ouvrage_candidates where id=p_candidate_id and draft_id=p_draft_id for update nowait;
  if not found then perform private.generated_ouvrage_error('NOT_FOUND'); end if;
  if c.resolution_status<>'pending' then perform private.generated_ouvrage_error('REVIEW_CHANGED'); end if;
  if length(coalesce(p_reason,''))>1000 then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  update public.estimate_generated_ouvrage_candidates set resolution_status='rejected',metadata=metadata||jsonb_build_object('rejection_reason',nullif(btrim(p_reason),''),'rejected_at',clock_timestamp(),'rejected_by',auth.uid()) where id=p_candidate_id;
  d:=private.generated_ouvrage_project_draft(p_draft_id);
  if d->>'status'='discarded' then
    update public.estimate_generated_ouvrage_source_fragments set status='discarded' where draft_id=p_draft_id;
    insert into public.estimate_version_events(estimate_version_id,event_type,created_by,metadata)
      values(p_version_id,'generated_ouvrage_discarded',auth.uid(),jsonb_build_object('draft_id',p_draft_id,'reason',nullif(btrim(p_reason),'')));
  end if;
  return jsonb_build_object('ok',true,'draftStatus',d->>'status','projectId',d->'project_id','versionId',p_version_id);
exception when lock_not_available or deadlock_detected then perform private.generated_ouvrage_error('STALE'); return null;
end $$;
revoke all on function public.reject_generated_ouvrage_candidate(uuid,uuid,uuid,uuid,text) from public,anon,service_role;
grant execute on function public.reject_generated_ouvrage_candidate(uuid,uuid,uuid,uuid,text) to authenticated;

-- Generation closes only after materialization. Old draft headers and their
-- fragments are archived in this same transaction, under the application gate.
create function public.close_generated_ouvrage_generation(p_version_id uuid,p_draft_id uuid,p_draft_lock_session_id uuid,p_mode text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; d public.estimate_generated_ouvrage_drafts%rowtype; discarded_ids uuid[];
begin
  ctx:=private.generated_ouvrage_lock(p_version_id,p_draft_id);
  perform private.generated_ouvrage_mutable(ctx,p_draft_lock_session_id);
  select * into d from public.estimate_generated_ouvrage_drafts where id=p_draft_id;
  if d.status<>'pending' or exists(select 1 from public.estimate_generated_ouvrage_applications where draft_id=p_draft_id)
    or exists(select 1 from public.estimate_generated_ouvrage_candidates where draft_id=p_draft_id and resolution_status='inserted') then
    perform private.generated_ouvrage_error('FORBIDDEN');
  end if;
  if p_mode is null or p_mode not in('complete','failed') then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  if p_mode='complete' then
    if not exists(select 1 from public.estimate_generated_ouvrage_candidates where draft_id=p_draft_id and resolution_status='pending')
      or not exists(select 1 from public.estimate_generated_ouvrage_source_fragments where draft_id=p_draft_id and status='active') then
      perform private.generated_ouvrage_error('INVALID_INPUT');
    end if;
    perform id from public.estimate_generated_ouvrage_drafts where tenant_id=d.tenant_id and project_id=d.project_id
      and target_version_id=p_version_id and created_by=d.created_by and status='pending' and (created_at,id)<(d.created_at,d.id)
      order by id for update nowait;
    select coalesce(array_agg(x.id order by x.id),'{}') into discarded_ids from public.estimate_generated_ouvrage_drafts x
      where x.tenant_id=d.tenant_id and x.project_id=d.project_id and x.target_version_id=p_version_id
      and x.created_by=d.created_by and x.status='pending' and (x.created_at,x.id)<(d.created_at,d.id)
      and not exists(select 1 from public.estimate_generated_ouvrage_applications a where a.draft_id=x.id)
      and not exists(select 1 from public.estimate_generated_ouvrage_candidates c where c.draft_id=x.id and c.resolution_status='inserted');
  else
    discarded_ids:=array[p_draft_id];
  end if;
  update public.estimate_generated_ouvrage_drafts set status='discarded' where id=any(discarded_ids);
  update public.estimate_generated_ouvrage_source_fragments set status='discarded' where draft_id=any(discarded_ids);
  return jsonb_build_object('ok',true,'versionId',p_version_id,'draftId',p_draft_id,
    'status',case when p_mode='complete' then 'pending' else 'discarded' end,'discardedDraftIds',to_jsonb(discarded_ids));
exception when lock_not_available or deadlock_detected then perform private.generated_ouvrage_error('STALE'); return null;
end $$;
revoke all on function public.close_generated_ouvrage_generation(uuid,uuid,uuid,text) from public,anon,service_role;
grant execute on function public.close_generated_ouvrage_generation(uuid,uuid,uuid,text) to authenticated;

create function private.generated_ouvrage_source(fragment jsonb,evidence_kind text,note text)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('sourceFragmentId',fragment->'id','sourceDocumentId',fragment->'source_document_id',
    'type',case fragment->>'source_kind' when 'cctp_excerpt' then 'cctp' when 'history' then 'history' when 'library' then 'library' else 'text' end,
    'label',fragment->'label','excerpt',fragment->'excerpt','sourceFileName',fragment->'source_file_name',
    'sourcePageFrom',fragment->'source_page_from','sourcePageTo',fragment->'source_page_to','selectionLabel',fragment->'selection_label',
    'evidenceKind',evidence_kind,'note',note)
$$;
revoke all on function private.generated_ouvrage_source(jsonb,text,text) from public,anon,authenticated,service_role;

-- Technical representation checks only: no margin, discount, tax or sale-price
-- calculation. Mirrors the existing reviewed quantity/yield hours contract.
create function private.generated_ouvrage_hours(component jsonb,parent_quantity numeric)
returns jsonb language sql immutable set search_path='' as $$
  select case when component->>'cost_type'<>'labor' then jsonb_build_object('hours',0,'source','quantity')
    when component->>'status'='manual' and (nullif(btrim(component->>'unit'),'') is null or lower(btrim(component->>'unit'))='h' or lower(btrim(component->>'unit')) like 'h/%')
      then jsonb_build_object('hours',(component->>'quantity')::numeric,'source','quantity')
    when (component->>'yield_value')::numeric>0 and lower(btrim(component->>'yield_unit')) like 'h/%'
      then jsonb_build_object('hours',round(parent_quantity*(component->>'yield_value')::numeric,3),'source','yield')
    else jsonb_build_object('hours',(component->>'quantity')::numeric,'source','quantity') end
$$;
revoke all on function private.generated_ouvrage_hours(jsonb,numeric) from public,anon,authenticated,service_role;

create function private.generated_ouvrage_components(review jsonb,projections jsonb,parent_quantity numeric)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare component jsonb; projection jsonb; result jsonb:='[]'; sources jsonb; ids uuid[]; expected_ids uuid[];
begin
  if jsonb_typeof(projections) is distinct from 'array' then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  select coalesce(array_agg((x->>'id')::uuid order by (x->>'id')::uuid),'{}') into expected_ids from jsonb_array_elements(review->'items') x;
  select coalesce(array_agg((x->>'componentId')::uuid order by (x->>'componentId')::uuid),'{}') into ids from jsonb_array_elements(projections) x;
  if ids is distinct from expected_ids or cardinality(ids) not between 1 and 24 then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  for component in select * from jsonb_array_elements(review->'items') loop
    select x into projection from jsonb_array_elements(projections)x where (x->>'componentId')::uuid=(component->>'id')::uuid;
    if projection-array['componentId','kFo','kMo','hMo','dsCents']<>'{}'::jsonb or not(projection?&array['componentId','kFo','kMo','hMo','dsCents'])
      or exists(select 1 from jsonb_each(projection-'componentId') n where jsonb_typeof(n.value)<>'number' or n.value::text::numeric<0)
      or (projection->>'dsCents')::numeric<>trunc((projection->>'dsCents')::numeric) or (projection->>'dsCents')::numeric>2147483647
      or exists(select 1 from unnest(array['kFo','kMo','hMo']) key where (projection->>key)::numeric<>round((projection->>key)::numeric,3) or (projection->>key)::numeric>999999999.999)
      then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    if component->>'cost_type'<>'labor' and (projection->>'hMo')::numeric<>0 then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    if (projection->>'dsCents')::numeric is distinct from round((component->>'quantity')::numeric*(component->>'unit_cost_ht_cents')::numeric*(1+(component->>'loss_coeff_bp')::numeric/10000))
      or (projection->>'hMo')::numeric is distinct from (private.generated_ouvrage_hours(component,parent_quantity)->>'hours')::numeric then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    select coalesce(jsonb_agg(private.generated_ouvrage_source(f,l->>'evidence_kind',l->>'note') order by (l->>'source_rank')::integer,l->>'id'),'[]') into sources
      from jsonb_array_elements(review->'itemSources') l join jsonb_array_elements(review->'fragments') f on f->>'id'=l->>'source_fragment_id' where l->>'component_id'=component->>'id';
    result:=result||jsonb_build_array(jsonb_build_object('componentId',component->'id','status',component->'status','costType',component->'cost_type',
      'designation',component->'designation','unit',component->'unit','quantity',component->'quantity','unitCostHtCents',component->'unit_cost_ht_cents',
      'lossCoeffBp',component->'loss_coeff_bp','yieldValue',component->'yield_value','yieldUnit',component->'yield_unit','confidence',component->'confidence',
      'sourceLabel',component->'source_label','dsCents',projection->'dsCents','facts',component->'facts','hypotheses',component->'hypotheses',
      'inferences',component->'inferences','riskSignals',coalesce(component->'metadata'->'risk_signals','[]'::jsonb),'sources',sources));
  end loop;
  return result;
end $$;
revoke all on function private.generated_ouvrage_components(jsonb,jsonb,numeric) from public,anon,authenticated,service_role;

create function private.generated_ouvrage_insert_line(p_version_id uuid,p_id uuid,data jsonb,projection jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare v public.estimate_versions%rowtype; item public.estimate_items%rowtype; normalized jsonb; next_position integer; has_labor boolean; has_supply boolean;
begin
  select * into v from public.estimate_versions where id=p_version_id;
  if jsonb_typeof(data) is distinct from 'object' or data-array['item_type','parent_id','title','description','quantity','unit_price_ht_cents','k_fo','h_mo','k_mo','labor_role_id','source_provider','source_file_name','source_page']<>'{}'::jsonb
    or data->>'item_type'<>'line' then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  if not exists(select 1 from public.estimate_items where id=(data->>'parent_id')::uuid and version_id=p_version_id and tenant_id=v.tenant_id and item_type='section') then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  select coalesce(max(position),0)+1 into next_position from public.estimate_items where version_id=p_version_id and parent_id=(data->>'parent_id')::uuid;
  normalized:=jsonb_build_object('quantity',1,'unit_price_ht_cents',0,'tax_rate_bp',v.tax_rate_bp,'k_fo',1,'h_mo',0,'h_mo_majoration',1,'k_mo',1,'position',next_position)||data||
    jsonb_build_object('id',p_id,'tenant_id',v.tenant_id,'version_id',p_version_id)||(projection-'id');
  select * into item from jsonb_populate_record(null::public.estimate_items,normalized);
  has_supply:=coalesce(item.unit_price_ht_cents,0)>0; has_labor:=coalesce(item.h_mo,0)>0 or item.labor_role_id is not null;
  if not(data?'line_nature') then item.line_nature:=(case when has_labor and not has_supply then 'labor_only' when has_labor then 'supply_and_labor' else 'supply_only' end)::public.estimate_line_nature; end if;
  insert into public.estimate_items(id,tenant_id,version_id,parent_id,item_type,position,title,description,quantity,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,h_mo_majoration,k_mo,h_mo_atelier,k_mo_atelier,labor_role_atelier_id,h_mo_chantier,k_mo_chantier,labor_role_chantier_id,pu_ht_cents,labor_role_id,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,line_nature,source_provider,source_file_name,source_page)
    values(item.id,item.tenant_id,item.version_id,item.parent_id,item.item_type,item.position,item.title,item.description,item.quantity,item.unit_price_ht_cents,item.tax_rate_bp,item.k_fo,item.h_mo,item.h_mo_majoration,item.k_mo,null,null,null,null,null,null,item.pu_ht_cents,item.labor_role_id,item.line_total_ht_cents,item.line_tax_cents,item.line_total_ttc_cents,item.line_nature,item.source_provider,item.source_file_name,item.source_page);
end $$;
revoke all on function private.generated_ouvrage_insert_line(uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;

create function public.get_generated_ouvrage_application_receipt(p_version_id uuid,p_operation_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; saved private.generated_ouvrage_application_receipts%rowtype; v public.estimate_versions%rowtype;
begin
  begin ctx:=private.estimate_batch_context(p_version_id,false);
  exception when others then
    if sqlerrm='ESTIMATE_BATCH_NOT_FOUND' then perform private.generated_ouvrage_error('NOT_FOUND');
    elsif sqlerrm='ESTIMATE_BATCH_FORBIDDEN' then perform private.generated_ouvrage_error('FORBIDDEN'); else raise; end if;
  end;
  if p_operation_key is null then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  select * into v from public.estimate_versions where id=p_version_id for share;
  perform 1 from public.estimate_projects where id=v.project_id for share nowait;
  ctx:=private.estimate_batch_context(p_version_id,false);
  select * into saved from private.generated_ouvrage_application_receipts where version_id=p_version_id and operation_key=p_operation_key
    and tenant_id=(ctx->>'tenant_id')::uuid and project_id=(ctx->>'project_id')::uuid and actor_id=(ctx->>'actor_id')::uuid;
  if not found then return null; end if;
  return saved.response||case when saved.response->>'outcome'='abandoned' then '{}'::jsonb else jsonb_build_object('replayed',true) end||jsonb_build_object('currentVersion',jsonb_build_object('id',v.id,'updatedAt',v.updated_at,'status',v.status));
exception when lock_not_available or deadlock_detected then perform private.generated_ouvrage_error('STALE'); return null;
end $$;
revoke all on function public.get_generated_ouvrage_application_receipt(uuid,uuid) from public,anon,service_role;
grant execute on function public.get_generated_ouvrage_application_receipt(uuid,uuid) to authenticated;

create function private.canonical_generated_ouvrage_request(p_version_id uuid,p_draft_id uuid,p_actor uuid,p_expected_updated_at timestamptz,p_accepted_candidates jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare accepted jsonb; canonical_accepted jsonb:='[]'; accepted_ids uuid[];
begin
  if p_expected_updated_at is null or jsonb_typeof(p_accepted_candidates) is distinct from 'array'
    or jsonb_array_length(p_accepted_candidates) not between 1 and 12 or octet_length(p_accepted_candidates::text)>1048576 then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  for accepted in select * from jsonb_array_elements(p_accepted_candidates) loop
    if jsonb_typeof(accepted)<>'object' or accepted-array['candidateId','designation','unit','quantity','lotId','reviewToken']<>'{}'::jsonb
      or not(accepted?&array['candidateId','designation','unit','quantity','lotId','reviewToken']) or jsonb_typeof(accepted->'designation')<>'string'
      or length(btrim(accepted->>'designation')) not between 1 and 500 or jsonb_typeof(accepted->'quantity')<>'number' or (accepted->>'quantity')::numeric<0
      or accepted->>'reviewToken'!~'^[0-9a-f]{64}$' or accepted->>'reviewToken' is null
      or (accepted->'unit'<>'null'::jsonb and (jsonb_typeof(accepted->'unit')<>'string' or length(accepted->>'unit')>64)) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    canonical_accepted:=canonical_accepted||jsonb_build_array(jsonb_build_object('candidateId',(accepted->>'candidateId')::uuid,
      'designation',regexp_replace(btrim(accepted->>'designation'),'\s+',' ','g'),'unit',nullif(btrim(accepted->>'unit'),''),'quantity',accepted->'quantity',
      'lotId',(accepted->>'lotId')::uuid,'reviewToken',accepted->>'reviewToken'));
  end loop;
  select array_agg((x->>'candidateId')::uuid order by (x->>'candidateId')::uuid) into accepted_ids from jsonb_array_elements(canonical_accepted)x;
  if cardinality(accepted_ids)<>(select count(distinct x) from unnest(accepted_ids)x) or array_position(accepted_ids,null) is not null then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  return jsonb_build_object('versionId',p_version_id,'draftId',p_draft_id,'actorId',p_actor,'expectedUpdatedAt',p_expected_updated_at,'acceptedCandidates',canonical_accepted);
end $$;
revoke all on function private.canonical_generated_ouvrage_request(uuid,uuid,uuid,timestamptz,jsonb) from public,anon,authenticated,service_role;

create function public.commit_generated_ouvrages(p_version_id uuid,p_draft_id uuid,p_operation_key uuid,p_expected_updated_at timestamptz,
  p_draft_lock_session_id uuid,p_accepted_candidates jsonb,p_prepared_candidates jsonb,p_fallback_section jsonb,p_item_updates jsonb,p_version_patch jsonb,p_calculation_context jsonb,p_expected_preferred_role jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; v public.estimate_versions%rowtype; saved private.generated_ouvrage_application_receipts%rowtype;
  accepted jsonb; canonical_accepted jsonb:='[]'; canonical jsonb; prepared jsonb; review jsonb; reviewed_values jsonb; mapping jsonb; components jsonb; summary jsonb; component jsonb; projection jsonb; item_data jsonb; trace jsonb;
  source_ids jsonb; primary_source jsonb; applied_payload jsonb; library_source jsonb; applications jsonb:='[]'; response jsonb; d jsonb; raw_context jsonb; preferred_role jsonb;
  accepted_ids uuid[]; prepared_ids uuid[]; actual_ids uuid[]; supplied_ids uuid[]; created_item_ids uuid[]:='{}'; role_ids uuid[]; all_created_ids uuid[];
  target_tenant uuid; project_owner uuid; actor uuid; target_candidate_id uuid; assembly_id uuid; target_section uuid; next_position integer; ordinal integer:=0; lot_label text; assembly_name text;
  ds_total bigint; ds_fo bigint; ds_mo bigint; hours_total numeric; event_time timestamptz; breakdown jsonb; valid boolean;
  parent_fo numeric; parent_mo numeric; previous_rollup bigint; current_rollup bigint; raw_component jsonb; trace_ids uuid[]; labor_ids uuid[];
begin
  ctx:=private.generated_ouvrage_lock(p_version_id,p_draft_id);
  actor:=(ctx->>'actor_id')::uuid; target_tenant:=(ctx->>'tenant_id')::uuid; project_owner:=(ctx->>'user_id')::uuid;
  select * into v from public.estimate_versions where id=p_version_id;
  if p_operation_key is null then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  canonical:=private.canonical_generated_ouvrage_request(p_version_id,p_draft_id,actor,p_expected_updated_at,p_accepted_candidates);
  canonical_accepted:=canonical->'acceptedCandidates';
  select array_agg((x->>'candidateId')::uuid order by (x->>'candidateId')::uuid) into accepted_ids from jsonb_array_elements(canonical_accepted)x;
  if cardinality(accepted_ids)<>(select count(distinct x) from unnest(accepted_ids)x) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  select * into saved from private.generated_ouvrage_application_receipts where version_id=p_version_id and operation_key=p_operation_key;
  if found then
    if saved.actor_id<>actor or saved.tenant_id<>target_tenant or saved.project_id<>v.project_id or saved.canonical_request is distinct from canonical then perform private.generated_ouvrage_error('IDEMPOTENCY_CONFLICT'); end if;
    return saved.response||case when saved.response->>'outcome'='abandoned' then '{}'::jsonb else jsonb_build_object('replayed',true) end||jsonb_build_object('currentVersion',jsonb_build_object('id',v.id,'updatedAt',v.updated_at,'status',v.status));
  end if;
  perform private.generated_ouvrage_mutable(ctx,p_draft_lock_session_id);
  if v.updated_at is distinct from p_expected_updated_at then perform private.generated_ouvrage_error('STALE'); end if;
  perform id from public.estimate_items where version_id=p_version_id order by id for update nowait;
  perform id from public.estimate_generated_ouvrage_candidates where draft_id=p_draft_id order by id for update nowait;
  perform id from public.estimate_generated_ouvrage_subdetail_drafts where draft_id=p_draft_id order by id for update nowait;
  perform id from public.estimate_generated_ouvrage_subdetail_items where draft_id=p_draft_id order by id for update nowait;
  perform id from public.estimate_generated_ouvrage_subdetail_item_sources where draft_id=p_draft_id order by id for update nowait;
  perform id from public.estimate_generated_ouvrage_candidate_sources where draft_id=p_draft_id order by id for update nowait;
  perform id from public.estimate_generated_ouvrage_source_fragments where draft_id=p_draft_id order by id for share nowait;
  if jsonb_typeof(p_prepared_candidates) is distinct from 'array' or jsonb_typeof(p_item_updates) is distinct from 'array'
    or jsonb_typeof(p_version_patch) is distinct from 'object' or jsonb_typeof(p_calculation_context) is distinct from 'object'
    or octet_length(jsonb_build_array(p_prepared_candidates,p_item_updates,p_version_patch,p_calculation_context)::text)>2097152 then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  select array_agg((x->>'candidateId')::uuid order by (x->>'candidateId')::uuid) into prepared_ids from jsonb_array_elements(p_prepared_candidates)x;
  if prepared_ids is distinct from accepted_ids then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  select coalesce(array_agg(u.id),'{}') into all_created_ids from jsonb_array_elements(p_prepared_candidates)x cross join lateral unnest(array[(x->>'estimateItemId')::uuid,(x->>'assemblyId')::uuid,(x->>'applicationId')::uuid,(x->>'snapshotId')::uuid])u(id);
  if cardinality(all_created_ids)<>(select count(distinct x) from unnest(all_created_ids)x) or array_position(all_created_ids,null) is not null
    or exists(select 1 from public.estimate_items where id=any(all_created_ids)) or exists(select 1 from public.estimate_assemblies where id=any(all_created_ids))
    or exists(select 1 from public.estimate_generated_ouvrage_applications where id=any(all_created_ids)) or exists(select 1 from public.estimate_generated_ouvrage_work_snapshots where id=any(all_created_ids)) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  if p_version_patch-array['total_ht_cents','total_tax_cents','total_ttc_cents']<>'{}'::jsonb or not(p_version_patch?&array['total_ht_cents','total_tax_cents','total_ttc_cents'])
    or exists(select 1 from jsonb_each(p_version_patch)n where jsonb_typeof(n.value)<>'number' or n.value::text!~'^[0-9]+$' or n.value::text::numeric>2147483647) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  if exists(select 1 from jsonb_array_elements(p_item_updates)x where jsonb_typeof(x)<>'object' or x-array['id','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents']<>'{}'::jsonb or not(x?&array['id','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents']))
    or exists(select 1 from jsonb_array_elements(p_item_updates)x cross join lateral jsonb_each(x-'id')n where jsonb_typeof(n.value)<>'number' or n.value::text!~'^[0-9]+$' or n.value::text::numeric>2147483647) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  select coalesce(array_agg((x->>'id')::uuid order by (x->>'id')::uuid),'{}') into supplied_ids from jsonb_array_elements(p_item_updates)x;
  if cardinality(supplied_ids)<>(select count(distinct x) from unnest(supplied_ids)x) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  select jsonb_build_object('id',id,'name',name,'hourly_rate_cents',hourly_rate_cents,'is_active',is_active,'position',position) into preferred_role
    from public.labor_roles where tenant_id=target_tenant and user_id=project_owner and is_active order by position,id limit 1;
  if coalesce(preferred_role,'null'::jsonb) is distinct from coalesce(p_expected_preferred_role,'null'::jsonb) then perform private.generated_ouvrage_error('CONTEXT_CHANGED'); end if;
  if exists(select 1 from jsonb_array_elements(canonical_accepted)x where x->'lotId'='null'::jsonb) then
    if jsonb_typeof(p_fallback_section) is distinct from 'object' or p_fallback_section-array['id','created']<>'{}'::jsonb or not(p_fallback_section?&array['id','created']) or jsonb_typeof(p_fallback_section->'created')<>'boolean' then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    target_section:=(p_fallback_section->>'id')::uuid;
    if (p_fallback_section->>'created')::boolean then
      if target_section=any(all_created_ids) or exists(select 1 from public.estimate_items where id=target_section) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
      select coalesce(max(position),0)+1 into next_position from public.estimate_items where version_id=p_version_id and parent_id is null;
      insert into public.estimate_items(id,version_id,parent_id,item_type,position,title,source_provider) values(target_section,p_version_id,null,'section',next_position,'À classer','generated_ouvrage');
    elsif not exists(select 1 from public.estimate_items where id=target_section and version_id=p_version_id and tenant_id=target_tenant and item_type='section' and parent_id is null
      and regexp_replace(lower(regexp_replace(normalize(btrim(title),NFD),U&'[\0300-\036f]','','g')),'\s+',' ','g')='a classer') then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  elsif p_fallback_section is not null and p_fallback_section<>'null'::jsonb then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  for accepted in select * from jsonb_array_elements(canonical_accepted) loop
    target_candidate_id:=(accepted->>'candidateId')::uuid;
    select x into prepared from jsonb_array_elements(p_prepared_candidates)x where (x->>'candidateId')::uuid=target_candidate_id;
    if prepared-array['candidateId','subdetailId','estimateItemId','assemblyId','applicationId','snapshotId','resolvedLotId','placementMode','estimateItemMapping','componentProjections','item']<>'{}'::jsonb
      or not(prepared?&array['candidateId','subdetailId','estimateItemId','assemblyId','applicationId','snapshotId','resolvedLotId','placementMode','estimateItemMapping','componentProjections','item']) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    review:=private.generated_ouvrage_review(p_draft_id,target_candidate_id);
    if review->'candidate'='null'::jsonb then perform private.generated_ouvrage_error('NOT_FOUND'); end if;
    if review->'candidate'->>'resolution_status'<>'pending' or review->'subdetailDraft'->>'status' is distinct from 'reviewed'
      or exists(select 1 from public.estimate_generated_ouvrage_applications app where app.candidate_id=target_candidate_id) then perform private.generated_ouvrage_error('REVIEW_CHANGED'); end if;
    if review->>'reviewToken' is distinct from accepted->>'reviewToken' then perform private.generated_ouvrage_error('REVIEW_CHANGED'); end if;
    -- Historical inconsistent links must not be copied into immutable provenance.
    if exists(select 1 from jsonb_array_elements(review->'candidateSources')l where not exists(select 1 from jsonb_array_elements(review->'fragments')f where f->>'id'=l->>'source_fragment_id'))
      or exists(select 1 from jsonb_array_elements(review->'itemSources')l where not exists(select 1 from jsonb_array_elements(review->'fragments')f where f->>'id'=l->>'source_fragment_id'))
      or exists(select 1 from jsonb_array_elements(review->'items')i where i->>'source_fragment_id' is not null and not exists(select 1 from jsonb_array_elements(review->'fragments')f where f->>'id'=i->>'source_fragment_id')) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    if (review->'subdetailDraft'->>'id')::uuid is distinct from (prepared->>'subdetailId')::uuid then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    reviewed_values:=coalesce(review->'subdetailDraft'->'generation_metadata'->'reviewed_candidate',jsonb_build_object('designation',review->'candidate'->'designation','unit',review->'candidate'->'unit','quantity',review->'candidate'->'quantity'));
    if regexp_replace(btrim(reviewed_values->>'designation'),'\s+',' ','g') is distinct from accepted->>'designation'
      or nullif(btrim(reviewed_values->>'unit'),'') is distinct from accepted->>'unit' or (reviewed_values->>'quantity')::numeric is distinct from (accepted->>'quantity')::numeric then perform private.generated_ouvrage_error('REVIEW_CHANGED'); end if;
    target_section:=coalesce((accepted->>'lotId')::uuid,(p_fallback_section->>'id')::uuid);
    if target_section is distinct from (prepared->>'resolvedLotId')::uuid or prepared->>'placementMode' is distinct from (case when accepted->>'lotId' is null then 'fallback_unclassified' else 'explicit' end) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    select title into lot_label from public.estimate_items where id=target_section and version_id=p_version_id and tenant_id=target_tenant and item_type='section';
    if not found then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    components:=private.generated_ouvrage_components(review,prepared->'componentProjections',(accepted->>'quantity')::numeric);
    select coalesce(sum((x->>'dsCents')::bigint),0),coalesce(sum((x->>'dsCents')::bigint)filter(where x->>'costType'<>'labor'),0),coalesce(sum((x->>'dsCents')::bigint)filter(where x->>'costType'='labor'),0) into ds_total,ds_fo,ds_mo from jsonb_array_elements(components)x;
    select coalesce(sum((x->>'hMo')::numeric),0) into hours_total from jsonb_array_elements(prepared->'componentProjections')x;
    mapping:=prepared->'estimateItemMapping';
    if jsonb_typeof(mapping) is distinct from 'object' or mapping-array['source','mode','unitPriceHtCents','hMo','kFo','kMo','laborRoleId','laborRoleName','laborRoleHourlyRateCents','totalDsCents','nonLaborDsCents','laborDsCents','costBreakdown','laborTrace']<>'{}'::jsonb
      or mapping->>'source' is distinct from 'generated_ouvrage_subdetail_review' or mapping->>'mode' not in('no_labor','legacy_labor_allocated','labor_hours_only','labor_hours_role_without_rate')
      or ds_total is distinct from (review->'subdetailDraft'->'summary'->>'ds_cents')::bigint or ds_total is distinct from (mapping->>'totalDsCents')::bigint
      or ds_fo is distinct from (mapping->>'nonLaborDsCents')::bigint or ds_mo is distinct from (mapping->>'laborDsCents')::bigint or hours_total is distinct from (mapping->>'hMo')::numeric then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    if mapping->>'laborRoleId' is not null and ((mapping->>'laborRoleId')::uuid is distinct from (preferred_role->>'id')::uuid or mapping->>'laborRoleName' is distinct from preferred_role->>'name' or mapping->'laborRoleHourlyRateCents' is distinct from preferred_role->'hourly_rate_cents') then perform private.generated_ouvrage_error('CONTEXT_CHANGED'); end if;
    if mapping->>'laborRoleId' is null and (mapping->>'laborRoleName' is not null or mapping->>'laborRoleHourlyRateCents' is not null) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    if (accepted->>'quantity')::numeric<>round((accepted->>'quantity')::numeric,3) or (accepted->>'quantity')::numeric>999999999.999
      or exists(select 1 from unnest(array['hMo','kFo','kMo'])key where jsonb_typeof(mapping->key)<>'number' or (mapping->>key)::numeric<0 or (mapping->>key)::numeric>999999999.999 or (mapping->>key)::numeric<>round((mapping->>key)::numeric,3))
      or jsonb_typeof(mapping->'unitPriceHtCents')<>'number' or (mapping->>'unitPriceHtCents')::numeric<0 or (mapping->>'unitPriceHtCents')::numeric>2147483647 or (mapping->>'unitPriceHtCents')::numeric<>trunc((mapping->>'unitPriceHtCents')::numeric) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    parent_fo:=(accepted->>'quantity')::numeric*(mapping->>'unitPriceHtCents')::numeric*(mapping->>'kFo')::numeric;
    parent_mo:=(mapping->>'hMo')::numeric*coalesce((mapping->>'laborRoleHourlyRateCents')::numeric,0)*(mapping->>'kMo')::numeric;
    if round(parent_fo) is distinct from ds_fo or round(parent_mo) is distinct from ds_mo or round(parent_fo+parent_mo) is distinct from ds_total then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    select coalesce(jsonb_agg(jsonb_build_object('costType',kind,'componentCount',n,'quantity',quantity,'dsCents',ds) order by first_ordinal),'[]') into breakdown from (
      select x.value->>'costType' kind,count(*) n,sum((x.value->>'quantity')::numeric) quantity,sum((x.value->>'dsCents')::bigint)ds,min(x.ordinality)first_ordinal from jsonb_array_elements(components)with ordinality x group by x.value->>'costType') q;
    if mapping->'costBreakdown' is distinct from breakdown or jsonb_typeof(mapping->'laborTrace') is distinct from 'array' or jsonb_array_length(mapping->'laborTrace')<>(select count(*) from jsonb_array_elements(components)x where x->>'costType'='labor') then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    select coalesce(array_agg((x->>'componentId')::uuid order by (x->>'componentId')::uuid),'{}') into trace_ids from jsonb_array_elements(mapping->'laborTrace')x;
    select coalesce(array_agg((x->>'componentId')::uuid order by (x->>'componentId')::uuid),'{}') into labor_ids from jsonb_array_elements(components)x where x->>'costType'='labor';
    if trace_ids is distinct from labor_ids then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    for trace in select * from jsonb_array_elements(mapping->'laborTrace') loop
      select x into component from jsonb_array_elements(components)x where (x->>'componentId')::uuid=(trace->>'componentId')::uuid and x->>'costType'='labor';
      select x into projection from jsonb_array_elements(prepared->'componentProjections')x where (x->>'componentId')::uuid=(trace->>'componentId')::uuid;
      select x into raw_component from jsonb_array_elements(review->'items')x where (x->>'id')::uuid=(trace->>'componentId')::uuid;
      if component is null or trace-array['componentId','designation','unit','quantity','derivedHours','hoursSource','dsCents']<>'{}'::jsonb
        or trace->'designation' is distinct from component->'designation' or trace->'unit' is distinct from component->'unit' or trace->'quantity' is distinct from component->'quantity' or trace->'dsCents' is distinct from component->'dsCents'
        or trace->'derivedHours' is distinct from projection->'hMo' or trace->>'hoursSource' is distinct from private.generated_ouvrage_hours(raw_component,(accepted->>'quantity')::numeric)->>'source' then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    end loop;
    summary:=jsonb_build_object('componentCount',jsonb_array_length(components),'dsCents',ds_total,
      'indicativeTargetPriceCents',review->'subdetailDraft'->'summary'->'indicative_target_price_cents','confidence',review->'subdetailDraft'->'summary'->'confidence',
      'pricingSource',review->'subdetailDraft'->'summary'->'pricing_source','riskSignals',coalesce(review->'subdetailDraft'->'summary'->'risk_signals','[]'),
      'facts',coalesce(review->'subdetailDraft'->'summary'->'facts','[]'),'hypotheses',coalesce(review->'subdetailDraft'->'summary'->'hypotheses','[]'),'inferences',coalesce(review->'subdetailDraft'->'summary'->'inferences','[]'));
    select coalesce(jsonb_agg(x->'source_fragment_id' order by (x->>'source_rank')::integer,x->>'id'),'[]') into source_ids from jsonb_array_elements(review->'candidateSources')x;
    select f into primary_source from jsonb_array_elements(review->'candidateSources')l join jsonb_array_elements(review->'fragments')f on f->>'id'=l->>'source_fragment_id' order by (l->>'source_rank')::integer,l->>'id' limit 1;
    item_data:=prepared->'item';
    if (item_data->>'parent_id')::uuid is distinct from target_section or item_data->>'title' is distinct from accepted->>'designation' or item_data->'description' is distinct from accepted->'unit'
      or item_data->'quantity' is distinct from accepted->'quantity' or item_data->'unit_price_ht_cents' is distinct from mapping->'unitPriceHtCents'
      or item_data->'h_mo' is distinct from mapping->'hMo' or item_data->'k_fo' is distinct from mapping->'kFo' or item_data->'k_mo' is distinct from mapping->'kMo'
      or item_data->'labor_role_id' is distinct from mapping->'laborRoleId' or item_data->>'source_provider' is distinct from 'generated_ouvrage'
      or item_data->>'source_file_name' is distinct from primary_source->>'source_file_name' or item_data->>'source_page' is distinct from primary_source->>'source_page_from' then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    assembly_id:=(prepared->>'assemblyId')::uuid; assembly_name:=(accepted->>'designation')||' · '||left(target_candidate_id::text,8);
    library_source:=jsonb_build_object('kind','generated_ouvrage','draft_id',p_draft_id,'candidate_id',target_candidate_id,'source_fragment_ids',source_ids,'summary',summary,'estimate_item_mapping',mapping);
    insert into public.estimate_assemblies(id,tenant_id,created_by,name,description,reference_code,unit,pricing_source,ds_cents,indicative_target_price_cents,source_metadata)
      values(assembly_id,target_tenant,actor,assembly_name,'Ouvrage compose genere depuis '||(accepted->>'designation'),'EST383-'||upper(left(target_candidate_id::text,8)),accepted->>'unit','generated_ouvrage_review',ds_total,(summary->>'indicativeTargetPriceCents')::integer,library_source);
    ordinal:=0; previous_rollup:=0;
    for component in select * from jsonb_array_elements(components) loop
      ordinal:=ordinal+1; select x into projection from jsonb_array_elements(prepared->'componentProjections')x where x->>'componentId'=component->>'componentId';
      insert into public.estimate_assembly_items(tenant_id,assembly_id,title,unit,k_fo,k_mo,h_mo,labor_role_id,default_quantity,position,cost_type,unit_cost_ht_cents,loss_coeff_bp,yield_value,yield_unit,source_metadata)
        values(target_tenant,assembly_id,component->>'designation',component->>'unit',(projection->>'kFo')::numeric,(projection->>'kMo')::numeric,(projection->>'hMo')::numeric,null,(component->>'quantity')::numeric,ordinal,component->>'costType',(component->>'unitCostHtCents')::integer,(component->>'lossCoeffBp')::integer,(component->>'yieldValue')::numeric,component->>'yieldUnit',
          jsonb_build_object('source_label',component->'sourceLabel','confidence',component->'confidence','facts',component->'facts','hypotheses',component->'hypotheses','inferences',component->'inferences','risk_signals',component->'riskSignals','sources',component->'sources'));
      select ds_cents into current_rollup from public.estimate_assemblies where id=assembly_id;
      if current_rollup-previous_rollup is distinct from (projection->>'dsCents')::bigint then perform private.generated_ouvrage_error('APPLY_REJECTED'); end if;
      previous_rollup:=current_rollup;
    end loop;
    -- Reuse the existing canonical rollup, never silently overwrite its result.
    perform public.refresh_estimate_assembly_rollup(assembly_id);
    if not exists(select 1 from public.estimate_assemblies where id=assembly_id and ds_cents=ds_total and coalesce(avg_time_hours,0)=hours_total) then perform private.generated_ouvrage_error('APPLY_REJECTED'); end if;
    select x into projection from jsonb_array_elements(p_item_updates)x where (x->>'id')::uuid=(prepared->>'estimateItemId')::uuid;
    if projection is null then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    perform private.generated_ouvrage_insert_line(p_version_id,(prepared->>'estimateItemId')::uuid,item_data,projection);
    created_item_ids:=array_append(created_item_ids,(prepared->>'estimateItemId')::uuid);
    applied_payload:=jsonb_build_object('designation',accepted->'designation','unit',accepted->'unit','quantity',accepted->'quantity','lot_id',target_section,
      'suggested_lot_id',review->'candidate'->'suggested_lot_id','ai_status',review->'candidate'->'ai_status','confidence',review->'candidate'->'confidence','source_fragment_ids',source_ids,
      'requested_lot_id',accepted->'lotId','resolved_lot_id',target_section,'resolved_lot_label',lot_label,'placement_mode',prepared->>'placementMode',
      'fallback_section_created',accepted->>'lotId' is null and coalesce((p_fallback_section->>'created')::boolean,false),'estimate_item_mapping',mapping);
    insert into public.estimate_generated_ouvrage_applications(id,tenant_id,draft_id,candidate_id,target_version_id,estimate_item_id,applied_by,applied_payload)
      values((prepared->>'applicationId')::uuid,target_tenant,p_draft_id,target_candidate_id,p_version_id,(prepared->>'estimateItemId')::uuid,actor,applied_payload);
    insert into public.estimate_generated_ouvrage_work_snapshots(id,tenant_id,project_id,target_version_id,draft_id,parent_work_id,assembly_id,estimate_item_id,applied_by,summary,components,metadata)
      values((prepared->>'snapshotId')::uuid,target_tenant,v.project_id,p_version_id,p_draft_id,target_candidate_id,assembly_id,(prepared->>'estimateItemId')::uuid,actor,
        summary||jsonb_build_object('assembly_name',assembly_name,'assembly_reference_code','EST383-'||upper(left(target_candidate_id::text,8))),components,
        jsonb_build_object('applied_values',applied_payload,'estimate_item_mapping',mapping,'ai_status',review->'candidate'->'ai_status','confidence',review->'candidate'->'confidence'));
    update public.estimate_generated_ouvrage_candidates set resolution_status='inserted',metadata=metadata||jsonb_build_object('applied_values',applied_payload) where id=target_candidate_id;
    applications:=applications||jsonb_build_array(jsonb_build_object('candidateId',target_candidate_id,'subdetailId',prepared->'subdetailId','assemblyId',assembly_id,'estimateItemId',prepared->'estimateItemId','applicationId',prepared->'applicationId','snapshotId',prepared->'snapshotId'));
  end loop;
  select coalesce(array_agg(id order by id),'{}') into actual_ids from public.estimate_items where version_id=p_version_id and item_type='line' and (v.calc_engine_version=2 or id=any(created_item_ids));
  if actual_ids is distinct from supplied_ids then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  select coalesce(array_agg(distinct r.id order by r.id),'{}') into role_ids from public.estimate_items i cross join lateral unnest(array[i.labor_role_id,i.labor_role_atelier_id,i.labor_role_chantier_id])r(id) where i.version_id=p_version_id and i.item_type='line' and r.id is not null;
  if v.calc_engine_version=2 and exists(select 1 from unnest(role_ids)r(id) where not exists(select 1 from public.labor_roles l where l.id=r.id and l.tenant_id=target_tenant and l.user_id=project_owner)) then perform private.generated_ouvrage_error('CONTEXT_CHANGED'); end if;
  select jsonb_build_object('labor_roles',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'tenant_id',l.tenant_id,'user_id',l.user_id,'hourly_rate_cents',l.hourly_rate_cents) order by l.id) from public.labor_roles l where l.id=any(role_ids) and l.tenant_id=target_tenant and l.user_id=project_owner),'[]'),
    'margin_tiers',case when v.margin_mode='tiered' then coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'threshold_cents',m.threshold_cents,'multiplier',m.multiplier,'position',m.position) order by m.threshold_cents,m.position,m.id) from public.margin_tiers m where m.tenant_id=target_tenant),'[]') else '[]'::jsonb end,
    'labor_split_flag',(select jsonb_build_object('id',f.id,'enabled',f.enabled) from public.feature_flags f where f.tenant_id=target_tenant and f.flag_key='EST_031_LABOR_SPLIT')) into raw_context;
  if raw_context is distinct from p_calculation_context then perform private.generated_ouvrage_error('CONTEXT_CHANGED'); end if;
  select * into v from public.estimate_versions where id=p_version_id;
  perform public.bulk_update_estimate_items(p_version_id,p_item_updates,p_version_patch,v.updated_at);
  d:=private.generated_ouvrage_project_draft(p_draft_id);
  update public.estimate_generated_ouvrage_subdetail_drafts set status='applied',applied_at=clock_timestamp() where draft_id=p_draft_id and parent_work_id=any(accepted_ids);
  insert into public.estimate_version_events(estimate_version_id,event_type,created_by,metadata)
    values(p_version_id,'generated_ouvrage_inserted',actor,jsonb_build_object('draft_id',p_draft_id,'candidate_ids',to_jsonb(accepted_ids),'inserted_count',cardinality(accepted_ids)));
  select * into v from public.estimate_versions where id=p_version_id;
  event_time:=clock_timestamp();
  response:=jsonb_build_object('ok',true,'insertedCount',cardinality(accepted_ids),'draftStatus',d->>'status','projectId',v.project_id,'versionId',p_version_id,'applications',applications,
    'version',jsonb_build_object('id',v.id,'updatedAt',v.updated_at),'totals',jsonb_build_object('totalHtCents',v.total_ht_cents,'totalTaxCents',v.total_tax_cents,'totalTtcCents',v.total_ttc_cents),
    'receipt',jsonb_build_object('operationKey',p_operation_key,'actorId',actor,'versionId',p_version_id,'draftId',p_draft_id,'expectedUpdatedAt',p_expected_updated_at,'acceptedCandidates',canonical_accepted,'committedAt',event_time));
  if octet_length(response::text)>2097152 then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  insert into private.generated_ouvrage_application_receipts(version_id,operation_key,tenant_id,project_id,draft_id,actor_id,canonical_request,response,committed_at)
    values(p_version_id,p_operation_key,target_tenant,v.project_id,p_draft_id,actor,canonical,response,event_time);
  return response||jsonb_build_object('replayed',false,'currentVersion',jsonb_build_object('id',v.id,'updatedAt',v.updated_at,'status',v.status));
exception when lock_not_available or deadlock_detected then perform private.generated_ouvrage_error('STALE'); return null;
  when invalid_text_representation or numeric_value_out_of_range then perform private.generated_ouvrage_error('INVALID_INPUT'); return null;
  when integrity_constraint_violation then perform private.generated_ouvrage_error('APPLY_REJECTED'); return null;
end $$;
revoke all on function public.commit_generated_ouvrages(uuid,uuid,uuid,timestamptz,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.commit_generated_ouvrages(uuid,uuid,uuid,timestamptz,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated;

create function public.abandon_generated_ouvrage_application(p_version_id uuid,p_draft_id uuid,p_operation_key uuid,p_expected_updated_at timestamptz,p_accepted_candidates jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; canonical jsonb; saved private.generated_ouvrage_application_receipts%rowtype; response jsonb; v public.estimate_versions%rowtype; event_time timestamptz;
begin
  ctx:=private.generated_ouvrage_lock(p_version_id,p_draft_id);
  if p_operation_key is null then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  canonical:=private.canonical_generated_ouvrage_request(p_version_id,p_draft_id,(ctx->>'actor_id')::uuid,p_expected_updated_at,p_accepted_candidates);
  select * into v from public.estimate_versions where id=p_version_id;
  select * into saved from private.generated_ouvrage_application_receipts where version_id=p_version_id and operation_key=p_operation_key;
  if found then
    if saved.actor_id is distinct from (ctx->>'actor_id')::uuid or saved.tenant_id is distinct from (ctx->>'tenant_id')::uuid or saved.project_id is distinct from (ctx->>'project_id')::uuid or saved.canonical_request is distinct from canonical then perform private.generated_ouvrage_error('IDEMPOTENCY_CONFLICT'); end if;
    return saved.response||case when saved.response->>'outcome'='abandoned' then '{}'::jsonb else jsonb_build_object('replayed',true) end||jsonb_build_object('currentVersion',jsonb_build_object('id',v.id,'updatedAt',v.updated_at,'status',v.status));
  end if;
  event_time:=clock_timestamp();
  response:=jsonb_build_object('ok',true,'outcome','abandoned','receipt',jsonb_build_object('operationKey',p_operation_key,'actorId',ctx->'actor_id','versionId',p_version_id,'draftId',p_draft_id,
    'expectedUpdatedAt',p_expected_updated_at,'acceptedCandidates',canonical->'acceptedCandidates','abandonedAt',event_time));
  insert into private.generated_ouvrage_application_receipts(version_id,operation_key,tenant_id,project_id,draft_id,actor_id,canonical_request,response,committed_at)
    values(p_version_id,p_operation_key,(ctx->>'tenant_id')::uuid,v.project_id,p_draft_id,(ctx->>'actor_id')::uuid,canonical,response,event_time);
  return response||jsonb_build_object('currentVersion',jsonb_build_object('id',v.id,'updatedAt',v.updated_at,'status',v.status));
exception when lock_not_available or deadlock_detected then perform private.generated_ouvrage_error('STALE'); return null;
  when invalid_text_representation or numeric_value_out_of_range then perform private.generated_ouvrage_error('INVALID_INPUT'); return null;
end $$;
revoke all on function public.abandon_generated_ouvrage_application(uuid,uuid,uuid,timestamptz,jsonb) from public,anon,service_role;
grant execute on function public.abandon_generated_ouvrage_application(uuid,uuid,uuid,timestamptz,jsonb) to authenticated;

-- This trigger is deliberately INVOKER: current_user is the actual effective
-- database role, not a client-controlled setting. Only the owner executing the
-- checked definer RPCs can publish reviewed/applied state and provenance. Native
-- database-owner maintenance remains privileged, as it already is for all RLS.
create function private.guard_generated_ouvrage_write() returns trigger
language plpgsql security invoker set search_path='' as $$
declare old_row jsonb; new_row jsonb; row_value jsonb; parent_draft uuid; parent_version uuid;
  d public.estimate_generated_ouvrage_drafts%rowtype; v public.estimate_versions%rowtype; member_role public.tenant_role; actor uuid;
  rpc_owner name; key text; privileged boolean;
begin
  if tg_op<>'INSERT' then old_row:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then new_row:=to_jsonb(new); end if;
  row_value:=coalesce(new_row,old_row);
  parent_draft:=case when tg_table_name='estimate_generated_ouvrage_drafts' then (row_value->>'id')::uuid else (row_value->>'draft_id')::uuid end;
  if tg_op='DELETE' then
    if tg_table_name<>'estimate_generated_ouvrage_drafts' and not exists(select 1 from public.estimate_generated_ouvrage_drafts where id=parent_draft) then return old; end if;
    if row_value?'target_version_id' and not exists(select 1 from public.estimate_versions where id=(row_value->>'target_version_id')::uuid) then return old; end if;
    if tg_table_name in('estimate_generated_ouvrage_applications','estimate_generated_ouvrage_work_snapshots') and not exists(select 1 from public.estimate_items where id=(row_value->>'estimate_item_id')::uuid) then return old; end if;
    if tg_table_name='estimate_generated_ouvrage_subdetail_items' and not exists(select 1 from public.estimate_generated_ouvrage_subdetail_drafts where id=(row_value->>'subdetail_id')::uuid) then return old; end if;
    if tg_table_name='estimate_generated_ouvrage_subdetail_item_sources' and not exists(select 1 from public.estimate_generated_ouvrage_subdetail_items where id=(row_value->>'component_id')::uuid) then return old; end if;
    if tg_table_name='estimate_generated_ouvrage_candidate_sources' and not exists(select 1 from public.estimate_generated_ouvrage_candidates where id=(row_value->>'candidate_id')::uuid) then return old; end if;
  end if;
  if tg_op='UPDATE' then
    foreach key in array array['id','tenant_id','project_id','target_version_id','draft_id','parent_work_id','subdetail_id','candidate_id','component_id'] loop
      if old_row?key and old_row->key is distinct from new_row->key then raise exception using errcode='42501',message='GENERATED_OUVRAGE_WRITE_REQUIRED'; end if;
    end loop;
  end if;
  select r.rolname into rpc_owner from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner where p.oid='public.commit_generated_ouvrages(uuid,uuid,uuid,timestamptz,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure;
  privileged:=current_user=rpc_owner;
  if privileged then if tg_op='DELETE' then return old; end if; return new; end if;
  -- Genuine SET NULL FK detachment does not grant a general material rewrite.
  if tg_op='UPDATE' and tg_table_name='estimate_generated_ouvrage_source_fragments'
    and old_row->>'source_document_id' is not null and new_row->'source_document_id'='null'::jsonb
    and old_row-array['source_document_id','updated_at']=new_row-array['source_document_id','updated_at']
    and not exists(select 1 from public.affaire_intake_documents where id=(old_row->>'source_document_id')::uuid) then return new; end if;
  if tg_op='UPDATE' and tg_table_name='estimate_generated_ouvrage_work_snapshots'
    and old_row->>'assembly_id' is not null and new_row->'assembly_id'='null'::jsonb
    and old_row-array['assembly_id','updated_at']=new_row-array['assembly_id','updated_at']
    and not exists(select 1 from public.estimate_assemblies where id=(old_row->>'assembly_id')::uuid) then return new; end if;
  -- Atomic review/provenance is not a public-table write contract anymore.
  if tg_table_name in('estimate_generated_ouvrage_subdetail_drafts','estimate_generated_ouvrage_subdetail_items','estimate_generated_ouvrage_subdetail_item_sources','estimate_generated_ouvrage_applications','estimate_generated_ouvrage_work_snapshots') then
    raise exception using errcode='42501',message='GENERATED_OUVRAGE_WRITE_REQUIRED';
  end if;
  if tg_table_name='estimate_generated_ouvrage_drafts' and tg_op='INSERT' then
    select * into d from jsonb_populate_record(null::public.estimate_generated_ouvrage_drafts,new_row);
  else select * into d from public.estimate_generated_ouvrage_drafts where id=parent_draft; end if;
  if d.id is null then raise exception using errcode='42501',message='GENERATED_OUVRAGE_WRITE_REQUIRED'; end if;
  actor:=(select auth.uid()); parent_version:=d.target_version_id;
  if actor is null or not pg_catalog.pg_try_advisory_xact_lock_shared(pg_catalog.hashtextextended('estimate-create-actor:'||actor::text,0)) then raise exception using errcode='40001',message='GENERATED_OUVRAGE_CONTEXT_CHANGED'; end if;
  select * into v from public.estimate_versions where id=parent_version for update nowait;
  if tg_table_name<>'estimate_generated_ouvrage_drafts' or tg_op<>'INSERT' then
    select * into d from public.estimate_generated_ouvrage_drafts where id=parent_draft for update nowait;
  end if;
  select role into member_role from public.tenant_memberships where tenant_id=d.tenant_id and user_id=actor;
  if actor is null or d.created_by is distinct from actor or d.tenant_id is distinct from public.current_tenant_id() or member_role not in('admin','engineer') or member_role is null
    or v.status is distinct from 'draft' or d.status not in('pending','partially_applied')
    or not exists(select 1 from public.tenants where id=d.tenant_id and is_active)
    or not exists(select 1 from public.estimate_projects where id=d.project_id and tenant_id=d.tenant_id and not is_archived and (user_id=actor or member_role='admin')) then raise exception using errcode='42501',message='GENERATED_OUVRAGE_WRITE_REQUIRED'; end if;
  if tg_table_name='estimate_generated_ouvrage_drafts' then
    if tg_op='DELETE' or new.status<>'pending' or tg_op='UPDATE' and (old.status<>'pending' or exists(select 1 from public.estimate_generated_ouvrage_subdetail_drafts where draft_id=d.id)) then raise exception using errcode='42501',message='GENERATED_OUVRAGE_WRITE_REQUIRED'; end if;
  elsif tg_table_name='estimate_generated_ouvrage_candidates' then
    if tg_op='DELETE' or new.resolution_status<>'pending' or tg_op='UPDATE' and (old.resolution_status<>'pending' or exists(select 1 from public.estimate_generated_ouvrage_subdetail_drafts where parent_work_id=old.id)) then raise exception using errcode='42501',message='GENERATED_OUVRAGE_WRITE_REQUIRED'; end if;
  elsif tg_table_name='estimate_generated_ouvrage_candidate_sources' then
    if not exists(select 1 from public.estimate_generated_ouvrage_candidates where id=(row_value->>'candidate_id')::uuid and draft_id=d.id and resolution_status='pending') then raise exception using errcode='42501',message='GENERATED_OUVRAGE_WRITE_REQUIRED'; end if;
    if tg_op<>'DELETE' and not exists(select 1 from public.estimate_generated_ouvrage_source_fragments where id=(row_value->>'source_fragment_id')::uuid and draft_id=d.id and tenant_id=d.tenant_id) then raise exception using errcode='42501',message='GENERATED_OUVRAGE_WRITE_REQUIRED'; end if;
  else
    if exists(select 1 from public.estimate_generated_ouvrage_candidate_sources l join public.estimate_generated_ouvrage_candidates c on c.id=l.candidate_id where l.source_fragment_id=(row_value->>'id')::uuid and c.resolution_status<>'pending')
      or exists(select 1 from public.estimate_generated_ouvrage_subdetail_item_sources l join public.estimate_generated_ouvrage_candidates c on c.id=l.parent_work_id where l.source_fragment_id=(row_value->>'id')::uuid and c.resolution_status<>'pending') then raise exception using errcode='42501',message='GENERATED_OUVRAGE_WRITE_REQUIRED'; end if;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
exception when lock_not_available or deadlock_detected then raise exception using errcode='40001',message='GENERATED_OUVRAGE_STALE';
end $$;
revoke all on function private.guard_generated_ouvrage_write() from public,anon,authenticated,service_role;

create trigger zzz_generated_ouvrage_write before insert or update or delete on public.estimate_generated_ouvrage_drafts for each row execute function private.guard_generated_ouvrage_write();
create trigger zzz_generated_ouvrage_write before insert or update or delete on public.estimate_generated_ouvrage_candidates for each row execute function private.guard_generated_ouvrage_write();
create trigger zzz_generated_ouvrage_write before insert or update or delete on public.estimate_generated_ouvrage_source_fragments for each row execute function private.guard_generated_ouvrage_write();
create trigger zzz_generated_ouvrage_write before insert or update or delete on public.estimate_generated_ouvrage_candidate_sources for each row execute function private.guard_generated_ouvrage_write();
create trigger zzz_generated_ouvrage_write before insert or update or delete on public.estimate_generated_ouvrage_subdetail_drafts for each row execute function private.guard_generated_ouvrage_write();
create trigger zzz_generated_ouvrage_write before insert or update or delete on public.estimate_generated_ouvrage_subdetail_items for each row execute function private.guard_generated_ouvrage_write();
create trigger zzz_generated_ouvrage_write before insert or update or delete on public.estimate_generated_ouvrage_subdetail_item_sources for each row execute function private.guard_generated_ouvrage_write();
create trigger zzz_generated_ouvrage_write before insert or update or delete on public.estimate_generated_ouvrage_applications for each row execute function private.guard_generated_ouvrage_write();
create trigger zzz_generated_ouvrage_write before insert or update or delete on public.estimate_generated_ouvrage_work_snapshots for each row execute function private.guard_generated_ouvrage_write();

create function private.guard_generated_ouvrage_receipt_scope() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='generated_ouvrage_application_receipts' then
    if tg_op='DELETE' and (not exists(select 1 from public.estimate_versions where id=old.version_id) or not exists(select 1 from public.estimate_projects where id=old.project_id) or not exists(select 1 from public.estimate_generated_ouvrage_drafts where id=old.draft_id)) then return old; end if;
    perform private.generated_ouvrage_error('FORBIDDEN');
  elsif tg_table_name='estimate_versions' then
    if (new.id,new.tenant_id,new.project_id) is distinct from (old.id,old.tenant_id,old.project_id) and exists(select 1 from public.estimate_generated_ouvrage_drafts where target_version_id=old.id) then perform private.generated_ouvrage_error('FORBIDDEN'); end if;
  elsif (new.id,new.tenant_id) is distinct from (old.id,old.tenant_id) and exists(select 1 from public.estimate_generated_ouvrage_drafts where project_id=old.id) then perform private.generated_ouvrage_error('FORBIDDEN'); end if;
  return new;
end $$;
revoke all on function private.guard_generated_ouvrage_receipt_scope() from public,anon,authenticated,service_role;
create trigger generated_ouvrage_receipt_immutable before update or delete on private.generated_ouvrage_application_receipts for each row execute function private.guard_generated_ouvrage_receipt_scope();
create trigger aaa_generated_ouvrage_version_scope before update of id,tenant_id,project_id on public.estimate_versions for each row execute function private.guard_generated_ouvrage_receipt_scope();
create trigger aaa_generated_ouvrage_project_scope before update of id,tenant_id on public.estimate_projects for each row execute function private.guard_generated_ouvrage_receipt_scope();

commit;
