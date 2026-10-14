-- Preserve the explicitly reviewed CCTP reference independently from intake changes.
-- Private immutable copies and journal; byte attestation remains server-only.
create table private.estimate_source_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  version_id uuid not null unique references public.estimate_versions(id) on delete cascade,
  revision bigint not null default 0 check(revision between 0 and 9007199254740991),
  active_copy_id uuid,
  created_at timestamptz not null default clock_timestamp()
);
create table private.estimate_source_reference_copies (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references private.estimate_source_reviews(id) on delete cascade,
  actor_id uuid not null,
  preparation_key uuid not null,
  canonical_request jsonb not null,
  source_document_id uuid references public.affaire_intake_documents(id) on delete set null,
  source_document_identity uuid not null,
  source_upload_identity uuid not null,
  source_metadata jsonb not null,
  object_path text not null unique,
  state text not null default 'pending' check(state in('pending','verified')),
  storage_object_id uuid,
  sha256 text check(sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint check(byte_size between 1 and 52428800),
  page_count integer check(page_count between 1 and 200),
  created_at timestamptz not null default clock_timestamp(),
  verified_at timestamptz,
  unique(review_id,preparation_key),
  unique(review_id,id),
  check((state='pending' and storage_object_id is null and sha256 is null and byte_size is null and page_count is null and verified_at is null)
    or (state='verified' and storage_object_id is not null and sha256 is not null and byte_size is not null and page_count is not null and verified_at is not null))
);
create index estimate_source_reference_copies_source_idx on private.estimate_source_reference_copies(source_document_id) where source_document_id is not null;
create index estimate_source_reference_copies_upload_idx on private.estimate_source_reference_copies(source_upload_identity);
alter table private.estimate_source_reviews add constraint source_review_active_copy_scope
  foreign key(id,active_copy_id) references private.estimate_source_reference_copies(review_id,id) deferrable initially deferred;
create table private.estimate_source_reference_events (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references private.estimate_source_reviews(id) on delete cascade,
  confirmation_key uuid not null,
  canonical_request jsonb not null,
  previous_revision bigint not null check(previous_revision between 0 and 9007199254740990),
  revision bigint not null check(revision=previous_revision+1),
  previous_copy_id uuid,
  copy_id uuid not null,
  reviewed_sha256 text not null check(reviewed_sha256 ~ '^[0-9a-f]{64}$'),
  reason text not null check(char_length(reason) between 1 and 1000 and reason=btrim(reason)),
  actor_id uuid not null,
  actor_name text,
  occurred_at timestamptz not null default clock_timestamp(),
  unique(review_id,confirmation_key),
  unique(review_id,revision)
);
alter table private.estimate_source_reviews enable row level security;
alter table private.estimate_source_reference_copies enable row level security;
alter table private.estimate_source_reference_events enable row level security;
revoke all on private.estimate_source_reviews,private.estimate_source_reference_copies,private.estimate_source_reference_events from public,anon,authenticated,service_role;

-- Does not use public.has_tenant_role: its global-admin exception is wider.
create function private.source_review_context(p_actor uuid,p_version uuid,p_write boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare row_context record;
begin
  if p_actor is null or p_version is null then raise exception using errcode='42501',message='SOURCE_REVIEW_ACCESS_DENIED'; end if;
  select v.id,v.project_id,v.tenant_id,v.status,p.user_id,p.is_archived,active.role
    into row_context
  from public.estimate_versions v join public.estimate_projects p on p.id=v.project_id and p.tenant_id=v.tenant_id
  join lateral (
    select m.tenant_id,m.role from public.tenant_memberships m join public.tenants t on t.id=m.tenant_id
    where m.user_id=p_actor and t.is_active order by m.is_default desc,m.created_at asc limit 1
  ) active on active.tenant_id=v.tenant_id
  where v.id=p_version;
  if not found or row_context.is_archived
    or not(row_context.role in('admin','director') or row_context.user_id=p_actor)
    or (p_write and not(row_context.role='admin' or (row_context.role='engineer' and row_context.user_id=p_actor)))
  then raise exception using errcode='42501',message='SOURCE_REVIEW_ACCESS_DENIED'; end if;
  return to_jsonb(row_context);
end $$;

create function private.source_review_lock_context(p_actor uuid,p_version uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare ctx jsonb;
begin
  ctx:=private.source_review_context(p_actor,p_version,true);
  perform 1 from public.estimate_versions where id=p_version for update;
  -- The first reservation may have waited behind a legitimate parent move.
  -- Resolve the parent again before taking its lock, not only afterwards.
  ctx:=private.source_review_context(p_actor,p_version,true);
  perform 1 from public.estimate_projects where id=(ctx->>'project_id')::uuid for share nowait;
  perform 1 from public.tenant_memberships where user_id=p_actor order by id for share nowait;
  perform 1 from public.tenants where id in(select tenant_id from public.tenant_memberships where user_id=p_actor) order by id for share nowait;
  -- A fresh statement after locks is essential for status / active membership.
  ctx:=private.source_review_context(p_actor,p_version,true);
  return ctx;
exception when lock_not_available or deadlock_detected then
  raise exception using message='SOURCE_REVIEW_BUSY';
end $$;

create function private.source_review_copy_dto(p_copy uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('copy_id',c.id,'state',c.state,'file_name',c.source_metadata->>'file_name',
    'sha256',c.sha256,'byte_size',c.byte_size,'page_count',c.page_count,'created_at',c.created_at,'verified_at',c.verified_at)
  from private.estimate_source_reference_copies c where c.id=p_copy
$$;

create function private.source_review_storage_object(p_path text,p_size bigint,p_expected_object uuid default null)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare o storage.objects%rowtype; is_private boolean;
begin
  select not coalesce(public,false) into is_private from storage.buckets where id='estimate-source-references' for share nowait;
  select * into o from storage.objects where bucket_id='estimate-source-references' and name=p_path
    and archived_at is null and not is_delete_marker for share nowait;
  if not found or is_private is distinct from true or (p_expected_object is not null and o.id<>p_expected_object)
    or jsonb_typeof(o.metadata->'size') is distinct from 'number'
    or (o.metadata->>'size')::numeric is distinct from p_size::numeric
  then raise exception using message='SOURCE_REVIEW_SOURCE_UNAVAILABLE'; end if;
  return o.id;
exception when lock_not_available or deadlock_detected then raise exception using message='SOURCE_REVIEW_BUSY';
end $$;

create function public.get_estimate_source_review(p_version_id uuid,p_copy_id uuid default null,p_before_revision bigint default null,p_limit integer default 20,p_confirmation_key uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ctx jsonb; r private.estimate_source_reviews%rowtype; hist jsonb; receipt jsonb; next_cursor bigint;
begin
  ctx:=private.source_review_context(auth.uid(),p_version_id,false);
  if p_limit is null or p_limit not between 1 and 100 or (p_before_revision is not null and p_before_revision not between 1 and 9007199254740991)
  then raise exception using errcode='22023',message='SOURCE_REVIEW_INVALID_INPUT'; end if;
  select * into r from private.estimate_source_reviews where version_id=p_version_id;
  if p_copy_id is not null and not exists(select 1 from private.estimate_source_reference_copies where id=p_copy_id and review_id=r.id)
  then raise exception using errcode='42501',message='SOURCE_REVIEW_ACCESS_DENIED'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'copy_id',e.copy_id,'previous_copy_id',e.previous_copy_id,'revision',e.revision,'reason',e.reason,'actor_id',e.actor_id,'actor_name',e.actor_name,'occurred_at',e.occurred_at) order by e.revision desc),'[]') into hist
  from(select * from private.estimate_source_reference_events where review_id=r.id and (p_before_revision is null or revision<p_before_revision) order by revision desc limit p_limit) e;
  if jsonb_array_length(hist)=p_limit then
    next_cursor:=(hist->(p_limit-1)->>'revision')::bigint;
    if not exists(select 1 from private.estimate_source_reference_events where review_id=r.id and revision<next_cursor) then next_cursor:=null; end if;
  end if;
  select jsonb_build_object('canonical_request',e.canonical_request,'activation',jsonb_build_object('id',e.id,'copy_id',e.copy_id,'revision',e.revision)) into receipt
    from private.estimate_source_reference_events e where e.review_id=r.id and e.confirmation_key=p_confirmation_key;
  return jsonb_build_object('version_id',p_version_id,'project_id',ctx->'project_id','revision',coalesce(r.revision,0),
    'active_reference',private.source_review_copy_dto(r.active_copy_id),'selected_copy',private.source_review_copy_dto(p_copy_id),
    'history',hist,'next_before_revision',next_cursor,'confirmation_receipt',receipt);
end $$;

create function public.reserve_estimate_source_reference_copy(p_version_id uuid,p_document_id uuid,p_expected_review_revision bigint,p_preparation_key uuid)
returns jsonb language plpgsql volatile security definer set search_path='' set lock_timeout='2s' as $$
declare ctx jsonb; r private.estimate_source_reviews%rowtype; c private.estimate_source_reference_copies%rowtype;
  d public.affaire_intake_documents%rowtype; request jsonb; replay boolean:=false; new_copy uuid:=gen_random_uuid();
begin
  if p_version_id is null or p_document_id is null or p_preparation_key is null or p_expected_review_revision is null
    or p_expected_review_revision not between 0 and 9007199254740991
  then raise exception using errcode='22023',message='SOURCE_REVIEW_INVALID_INPUT'; end if;
  ctx:=private.source_review_lock_context(auth.uid(),p_version_id);
  insert into private.estimate_source_reviews(tenant_id,project_id,version_id)
    values((ctx->>'tenant_id')::uuid,(ctx->>'project_id')::uuid,p_version_id) on conflict(version_id) do nothing;
  select * into r from private.estimate_source_reviews where version_id=p_version_id for update;
  request:=jsonb_build_object('actor_id',auth.uid(),'version_id',p_version_id,'document_id',p_document_id,'expected_revision',p_expected_review_revision,'preparation_key',p_preparation_key);
  select * into c from private.estimate_source_reference_copies where review_id=r.id and preparation_key=p_preparation_key;
  if found then
    if c.canonical_request<>request then raise exception using message='SOURCE_REVIEW_IDEMPOTENCY_CONFLICT'; end if;
    replay:=true;
  else
    if ctx->>'status'<>'draft' or r.revision<>p_expected_review_revision then raise exception using message='SOURCE_REVIEW_STALE'; end if;
    select * into d from public.affaire_intake_documents where id=p_document_id for share nowait;
    if not found or d.tenant_id<>r.tenant_id or d.project_id<>r.project_id then raise exception using errcode='42501',message='SOURCE_REVIEW_ACCESS_DENIED'; end if;
    -- Lock upload as well: the existing document scope trigger derives from it.
    perform 1 from public.affaire_intake_uploads u where u.id=d.upload_id and u.tenant_id=r.tenant_id and u.project_id=r.project_id for share nowait;
    if not found then raise exception using errcode='42501',message='SOURCE_REVIEW_ACCESS_DENIED'; end if;
    if d.document_kind<>'cctp' or d.upload_status<>'uploaded' or d.mime_type is distinct from 'application/pdf'
      or d.storage_path is null or d.size_bytes not between 1 and 52428800
      or d.storage_path not like r.tenant_id::text||'/'||r.project_id::text||'/'||d.upload_id::text||'/'||d.id::text||'/%'
    then raise exception using errcode='22023',message='SOURCE_REVIEW_INVALID_SOURCE'; end if;
    insert into private.estimate_source_reference_copies(id,review_id,actor_id,preparation_key,canonical_request,source_document_id,source_document_identity,source_upload_identity,source_metadata,object_path)
    values(new_copy,r.id,auth.uid(),p_preparation_key,request,d.id,d.id,d.upload_id,
      jsonb_build_object('file_name',d.file_name,'mime_type',d.mime_type,'size_bytes',d.size_bytes,'storage_path',d.storage_path,'document_kind',d.document_kind,'upload_id',d.upload_id,'updated_at',d.updated_at),
      r.tenant_id::text||'/'||r.project_id::text||'/'||r.version_id::text||'/'||new_copy::text||'/reference.pdf') returning * into c;
  end if;
  return jsonb_build_object('copy_id',c.id,'version_id',p_version_id,'review_revision',r.revision,'state',c.state,'replayed',replay,
    'source_locator',jsonb_build_object('bucket','affaire-intake','path',c.source_metadata->>'storage_path'),
    'destination_locator',jsonb_build_object('bucket','estimate-source-references','path',c.object_path));
exception when lock_not_available or deadlock_detected then raise exception using message='SOURCE_REVIEW_BUSY';
end $$;

create function public.complete_estimate_source_reference_copy(p_copy_id uuid,p_sha256 text,p_byte_size bigint,p_page_count integer)
returns jsonb language plpgsql volatile security definer set search_path='' set lock_timeout='2s' as $$
declare c private.estimate_source_reference_copies%rowtype; obj uuid; replay boolean:=false; normalized_hash text:=lower(p_sha256);
begin
  if p_copy_id is null or normalized_hash is null or normalized_hash !~ '^[0-9a-f]{64}$'
    or p_byte_size is null or p_byte_size not between 1 and 52428800 or p_page_count is null or p_page_count not between 1 and 200
  then raise exception using errcode='22023',message='SOURCE_REVIEW_INVALID_INPUT'; end if;
  select * into c from private.estimate_source_reference_copies where id=p_copy_id for update;
  if not found then raise exception using errcode='42501',message='SOURCE_REVIEW_ACCESS_DENIED'; end if;
  if c.state='verified' then
    if c.sha256<>normalized_hash or c.byte_size<>p_byte_size or c.page_count<>p_page_count then raise exception using message='SOURCE_REVIEW_IDEMPOTENCY_CONFLICT'; end if;
    replay:=true;
  else
    obj:=private.source_review_storage_object(c.object_path,p_byte_size);
    update private.estimate_source_reference_copies set state='verified',sha256=normalized_hash,byte_size=p_byte_size,page_count=p_page_count,storage_object_id=obj,verified_at=clock_timestamp()
      where id=c.id returning * into c;
  end if;
  return jsonb_build_object('copy_id',c.id,'state',c.state,'sha256',c.sha256,'byte_size',c.byte_size,'page_count',c.page_count,'verified_at',c.verified_at,'replayed',replay);
exception when lock_not_available or deadlock_detected then raise exception using message='SOURCE_REVIEW_BUSY';
end $$;

create function public.confirm_estimate_source_reference(p_actor_user_id uuid,p_version_id uuid,p_copy_id uuid,p_expected_review_revision bigint,p_idempotency_key uuid,p_reviewed_sha256 text,p_reason text)
returns jsonb language plpgsql volatile security definer set search_path='' set lock_timeout='2s' as $$
declare ctx jsonb; r private.estimate_source_reviews%rowtype; c private.estimate_source_reference_copies%rowtype; e private.estimate_source_reference_events%rowtype;
  request jsonb; replay boolean:=false; normalized_hash text:=lower(p_reviewed_sha256); reason_text text:=btrim(p_reason); author_name text;
begin
  if p_actor_user_id is null or p_version_id is null or p_copy_id is null or p_idempotency_key is null or p_expected_review_revision is null
    or p_expected_review_revision not between 0 and 9007199254740991 or normalized_hash is null or normalized_hash !~ '^[0-9a-f]{64}$'
    or reason_text is null or char_length(reason_text) not between 1 and 1000
  then raise exception using errcode='22023',message='SOURCE_REVIEW_INVALID_INPUT'; end if;
  ctx:=private.source_review_lock_context(p_actor_user_id,p_version_id);
  select * into r from private.estimate_source_reviews where version_id=p_version_id for update;
  if not found then raise exception using errcode='42501',message='SOURCE_REVIEW_ACCESS_DENIED'; end if;
  request:=jsonb_build_object('actor_id',p_actor_user_id,'version_id',p_version_id,'copy_id',p_copy_id,'expected_revision',p_expected_review_revision,
    'idempotency_key',p_idempotency_key,'reviewed_sha256',normalized_hash,'reason',reason_text);
  select * into e from private.estimate_source_reference_events where review_id=r.id and confirmation_key=p_idempotency_key;
  if found then
    if e.canonical_request<>request then raise exception using message='SOURCE_REVIEW_IDEMPOTENCY_CONFLICT'; end if;
    replay:=true;
  else
    if ctx->>'status'<>'draft' or r.revision<>p_expected_review_revision then raise exception using message='SOURCE_REVIEW_STALE'; end if;
    if r.revision=9007199254740991 then raise exception using errcode='22023',message='SOURCE_REVIEW_REVISION_OVERFLOW'; end if;
    select * into c from private.estimate_source_reference_copies where id=p_copy_id and review_id=r.id for share nowait;
    if not found then raise exception using errcode='42501',message='SOURCE_REVIEW_ACCESS_DENIED'; end if;
    if c.state<>'verified' then raise exception using message='SOURCE_REVIEW_COPY_NOT_VERIFIED'; end if;
    if c.sha256<>normalized_hash then raise exception using message='SOURCE_REVIEW_STALE'; end if;
    if r.active_copy_id=c.id then raise exception using message='SOURCE_REVIEW_REFERENCE_UNCHANGED'; end if;
    perform private.source_review_storage_object(c.object_path,c.byte_size,c.storage_object_id);
    select full_name into author_name from public.profiles where id=p_actor_user_id;
    insert into private.estimate_source_reference_events(review_id,confirmation_key,canonical_request,previous_revision,revision,previous_copy_id,copy_id,reviewed_sha256,reason,actor_id,actor_name)
      values(r.id,p_idempotency_key,request,r.revision,r.revision+1,r.active_copy_id,c.id,normalized_hash,reason_text,p_actor_user_id,author_name) returning * into e;
    update private.estimate_source_reviews set active_copy_id=c.id,revision=e.revision where id=r.id returning * into r;
  end if;
  return jsonb_build_object('activation',jsonb_build_object('id',e.id,'copy_id',e.copy_id,'revision',e.revision),'current_revision',r.revision,'current_copy_id',r.active_copy_id,'replayed',replay);
exception when lock_not_available or deadlock_detected then raise exception using message='SOURCE_REVIEW_BUSY';
end $$;

create function private.source_review_guard_parent() returns trigger language plpgsql security definer set search_path='' as $$
declare guarded boolean:=false;
begin
  if tg_table_name='estimate_versions' then
    guarded:=(new.id,new.project_id,new.tenant_id) is distinct from (old.id,old.project_id,old.tenant_id)
      and exists(select 1 from private.estimate_source_reviews where version_id=old.id);
  elsif tg_table_name='estimate_projects' then
    guarded:=(new.id,new.tenant_id) is distinct from (old.id,old.tenant_id)
      and exists(select 1 from private.estimate_source_reviews where project_id=old.id);
  elsif tg_table_name='affaire_intake_documents' then
    guarded:=(new.id,new.upload_id,new.project_id,new.tenant_id) is distinct from (old.id,old.upload_id,old.project_id,old.tenant_id)
      and exists(select 1 from private.estimate_source_reference_copies where source_document_id=old.id);
  elsif tg_table_name='affaire_intake_uploads' then
    guarded:=(new.id,new.project_id,new.tenant_id) is distinct from (old.id,old.project_id,old.tenant_id)
      and exists(select 1 from private.estimate_source_reference_copies where source_upload_identity=old.id);
  end if;
  if guarded then raise exception using errcode='42501',message='SOURCE_REVIEW_SCOPE_IMMUTABLE'; end if;
  return new;
end $$;
create trigger aaa_source_review_version_scope before update on public.estimate_versions for each row execute function private.source_review_guard_parent();
create trigger aaa_source_review_project_scope before update on public.estimate_projects for each row execute function private.source_review_guard_parent();
create trigger aaa_source_review_document_scope before update on public.affaire_intake_documents for each row execute function private.source_review_guard_parent();
create trigger aaa_source_review_upload_scope before update on public.affaire_intake_uploads for each row execute function private.source_review_guard_parent();

create function private.source_review_guard_copy() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then
    if not exists(select 1 from private.estimate_source_reviews where id=old.review_id) then return old; end if;
  else
    if new.source_document_id is null and old.source_document_id is not null
      and not exists(select 1 from public.affaire_intake_documents where id=old.source_document_id)
      and (to_jsonb(new)-'source_document_id')=(to_jsonb(old)-'source_document_id') then return new; end if;
    if old.state='pending' and new.state='verified'
      and (to_jsonb(new)-array['state','storage_object_id','sha256','byte_size','page_count','verified_at'])=(to_jsonb(old)-array['state','storage_object_id','sha256','byte_size','page_count','verified_at']) then return new; end if;
  end if;
  raise exception using errcode='42501',message='SOURCE_REVIEW_COPY_IMMUTABLE';
end $$;
create trigger source_reference_copy_immutable before update or delete on private.estimate_source_reference_copies for each row execute function private.source_review_guard_copy();
create function private.source_review_guard_event() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' and not exists(select 1 from private.estimate_source_reviews where id=old.review_id) then return old; end if;
  raise exception using errcode='42501',message='SOURCE_REVIEW_HISTORY_IMMUTABLE';
end $$;
create trigger source_reference_history_immutable before update or delete on private.estimate_source_reference_events for each row execute function private.source_review_guard_event();

revoke all on function private.source_review_context(uuid,uuid,boolean),private.source_review_lock_context(uuid,uuid),private.source_review_copy_dto(uuid),private.source_review_storage_object(text,bigint,uuid),private.source_review_guard_parent(),private.source_review_guard_copy(),private.source_review_guard_event() from public,anon,authenticated,service_role;
revoke all on function public.get_estimate_source_review(uuid,uuid,bigint,integer,uuid),public.reserve_estimate_source_reference_copy(uuid,uuid,bigint,uuid),public.complete_estimate_source_reference_copy(uuid,text,bigint,integer),public.confirm_estimate_source_reference(uuid,uuid,uuid,bigint,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_estimate_source_review(uuid,uuid,bigint,integer,uuid),public.reserve_estimate_source_reference_copy(uuid,uuid,bigint,uuid) to authenticated;
grant execute on function public.complete_estimate_source_reference_copy(uuid,text,bigint,integer),public.confirm_estimate_source_reference(uuid,uuid,uuid,bigint,uuid,text,text) to service_role;
