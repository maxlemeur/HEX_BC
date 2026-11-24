begin;
set local lock_timeout = '5s';

-- NULL is a released client's all-plan request. An explicit choice maps file UUIDs
-- to their displayed Storage generation and the SHA-256 attested by the service. A receipt keeps the full gesture; the request
-- keeps only the plans that still need a first reading.
alter table public.takeoff_launch_requests add column selected_plans jsonb
  check (jsonb_typeof(selected_plans) = 'object' and
    (selected_plans <> '{}'::jsonb or (payer_id is null and state in ('blocked','superseded'))));
alter table private.takeoff_brief_confirmations add column selected_plans jsonb,
  add column choice_request_id uuid;

-- Legacy confirmations still reserve once for life. A later explicit confirmation
-- may start previously unrequested plans. There can be only one pending reservation
-- and (by the existing running index) one admitted analysis of either origin.
create unique index takeoff_launch_pending_automatic_uidx on public.takeoff_launch_requests (tenant_id,project_id)
  where origin='automatic' and state in ('blocked','evaluating','not_eligible');
create unique index takeoff_launch_legacy_automatic_uidx on public.takeoff_launch_requests (tenant_id,project_id)
  where origin='automatic' and selected_plans is null;
drop index public.takeoff_launch_requests_automatic_uidx;

-- A withdrawn choice cannot be taken on by a later visitor, including after a
-- direct brief update by an older client. An explicit new choice can replace it.
create or replace function private.takeoff_launch_request_open(p_request public.takeoff_launch_requests)
returns boolean language sql immutable set search_path = '' as $$
  select p_request.state in ('evaluating','not_eligible','blocked') and p_request.selected_plans is distinct from '{}'::jsonb
$$;

-- Same affaire-wide import set as selectProjectImportPlanSet. Ignore old version
-- sets and ambiguous name-only fallbacks. Resolve intake generations with the
-- same predicate as the plan viewer. The token never discloses a storage path.
create function public.takeoff_brief_plan_options(p_tenant_id uuid,p_project_id uuid)
returns table(plan_file_id uuid,plan_name text,plan_version text)
language sql stable security definer set search_path = '' as $$
  with candidates as (
    select s.id,s.updated_at,(s.metadata @> '{"default_import_plan_set":true}' and
      jsonb_typeof(s.metadata->'source')='string') is true as marked,
      lower(trim(s.name))='plans import' as named
    from public.plan_sets s where s.tenant_id=p_tenant_id and s.project_id=p_project_id and s.estimate_version_id is null
  ), chosen as (
    select c.id from candidates c where c.marked or
      (c.named and (select count(*) from candidates where named)=1)
    order by c.marked desc, exists(select 1 from public.plan_files f where f.plan_set_id=c.id) desc,c.updated_at desc,c.id
    limit 1
  )
  select f.id,coalesce(case when jsonb_typeof(f.metadata->'original_file_name')='string' then
    nullif(left(btrim(normalize(f.metadata->>'original_file_name', NFC),
      U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'),255),'')
    end,f.file_name) as plan_name,
    encode(sha256(convert_to(jsonb_build_array(f.id,f.plan_set_id,o.id,o.name,o.version,
      o.metadata->>'eTag',f.file_size_bytes)::text,'UTF8')),'hex') as plan_version
  from chosen join public.plan_files f on f.plan_set_id=chosen.id
  join storage.objects o on o.bucket_id='plan-files' and o.name=f.file_path
  where f.tenant_id=p_tenant_id and f.file_size_bytes>0
    and o.metadata->'size'=to_jsonb(f.file_size_bytes)
    and coalesce(nullif(o.version,''),nullif(o.metadata->>'eTag','')) is not null
    and (lower(f.file_type)='application/pdf' or lower(f.file_name) like '%.pdf')
    and exists(select 1 from private.resolve_takeoff_plan_location_source(p_tenant_id,p_project_id,f.id) s where s.current_copy)
  order by plan_name,f.id
$$;
revoke all on function public.takeoff_brief_plan_options(uuid,uuid) from public,anon,authenticated;
grant execute on function public.takeoff_brief_plan_options(uuid,uuid) to service_role;

-- Include changed or competing project-level sets in the existing dossier lock.
-- Changes to the timestamp alone can change which of two marked sets wins.
create function private.lock_takeoff_import_plan_sets()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  project uuid;
begin
  if private.takeoff_plan_dispatch_active() then
    for project in select distinct id from unnest(array[
      case when tg_op <> 'INSERT' and old.estimate_version_id is null then old.project_id end,
      case when tg_op <> 'DELETE' and new.estimate_version_id is null then new.project_id end
    ]) id where id is not null order by id loop
      perform pg_catalog.pg_advisory_xact_lock_shared(private.takeoff_dossier_lock_key(project));
    end loop;
  end if;
  return null;
end;
$$;
revoke all on function private.lock_takeoff_import_plan_sets() from public,anon,authenticated,service_role;
create trigger lock_takeoff_import_plan_sets after insert or delete or update on public.plan_sets
  for each row execute function private.lock_takeoff_import_plan_sets();

-- Only the service can attest the digest of the selected bytes. It reads the
-- displayed Storage generation, hashes that copy and submits both. Recheck the
-- generation under row locks so a concurrent rewrite cannot cross this boundary.
create function private.assert_takeoff_brief_plans(p_tenant uuid,p_project uuid,p_plans jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  current_plans jsonb;
begin
  begin
    perform o.id from jsonb_object_keys(p_plans) chosen(id)
      join public.plan_files f on f.id::text=chosen.id and f.tenant_id=p_tenant
      join public.plan_sets s on s.id=f.plan_set_id and s.project_id=p_project and s.tenant_id=p_tenant
      join storage.objects o on o.bucket_id='plan-files' and o.name=f.file_path
      for share of o nowait;
    select coalesce(jsonb_object_agg(o.plan_file_id,jsonb_build_object(
      'version',o.plan_version,'sha256',c.value->>'sha256')),'{}'::jsonb) into current_plans
    from public.takeoff_brief_plan_options(p_tenant,p_project) o
    join jsonb_each(p_plans) c on c.key=o.plan_file_id::text
    where jsonb_typeof(c.value->'sha256')='string' and c.value->>'sha256' ~ '^[0-9a-f]{64}$';
  exception when lock_not_available then
    current_plans := null;
  end;
  if current_plans is distinct from p_plans then
    raise exception 'TAKEOFF_BRIEF_PLAN_CHANGED' using errcode='22023',
      hint='Un plan choisi a changé ou a été retiré. Rouvrez la liste des plans avant de confirmer.';
  end if;
end;
$$;
revoke all on function private.assert_takeoff_brief_plans(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

-- Enforce the scope at the existing atomic admission boundary. Format 2 also
-- attests a one-to-one match between manifest plans, active sources and jobs.
create function private.check_takeoff_brief_plan_admission()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.manifest->'format_version' is distinct from '2'::jsonb or
    (select jsonb_object_agg(p->>'plan_file_id',p->>'content_sha256')
      from jsonb_array_elements(new.manifest->'plans') p) is distinct from
    (select jsonb_object_agg(key,value->>'sha256') from jsonb_each(new.selected_plans)) then
    raise exception 'TAKEOFF_BRIEF_PLAN_SCOPE_MISMATCH' using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function private.check_takeoff_brief_plan_admission() from public,anon,authenticated,service_role;
create trigger check_takeoff_brief_plan_admission before update of admitted_at on public.takeoff_launch_requests
  for each row when (new.selected_plans is not null and old.admitted_at is null and new.admitted_at is not null)
  execute function private.check_takeoff_brief_plan_admission();

-- Revalidate the scoped copy after job insertion, under admission's final dossier lock.
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
    if request.selected_plans is not null then
      perform private.assert_takeoff_brief_plans(request.tenant_id,request.project_id,request.selected_plans);
    end if;
  exception
    when sqlstate '40001' then
      if sqlerrm <> 'TAKEOFF_LAUNCH_DOSSIER_CHANGED' then raise; end if;
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

create or replace function private.reserve_automatic_takeoff_request(p_tenant_id uuid, p_project_id uuid, p_confirmer uuid)
returns public.takeoff_launch_requests language plpgsql security definer set search_path = '' as $$
declare
  request public.takeoff_launch_requests%rowtype;
begin
  perform private.lock_takeoff_launch_commands(p_project_id);
  if exists (select 1 from private.takeoff_brief_confirmations c where c.tenant_id=p_tenant_id
      and c.project_id=p_project_id and c.selected_plans is not null) then
    -- An old client can revisit the last explicit reservation. Only another
    -- explicit choice can authorize analysis after a refusal or an empty remainder.
    select r.* into request from private.takeoff_brief_confirmations c
      join public.takeoff_launch_requests r on r.id=c.choice_request_id and r.project_id=c.project_id and r.tenant_id=c.tenant_id
      where c.tenant_id=p_tenant_id and c.project_id=p_project_id and c.selected_plans <> '{}'::jsonb for update of r;
    return request;
  end if;
  select * into request from public.takeoff_launch_requests r
  where r.tenant_id = p_tenant_id and r.project_id = p_project_id and r.origin = 'automatic'
  order by r.created_at desc, r.id limit 1 for update;
  if found then
    return request;
  end if;
  insert into public.takeoff_launch_requests as r (id, tenant_id, project_id, origin, intent, intent_key, state, reason_code,
    reason_details, confirmed_by)
  select reserved.id, p_tenant_id, p_project_id, 'automatic', 'initial', reserved.id,
    case when manual.id is not null then 'superseded' else 'blocked' end,
    case
      when manual.id is not null then null
      when private.takeoff_launch_payer_eligible(p_tenant_id, p_project_id, p_confirmer) then 'MANDATE_REQUIRED'
      else 'OPERATOR_REQUIRED' end,
    case when manual.id is not null then jsonb_build_object('request_id', manual.id) else '{}'::jsonb end, p_confirmer
  from (select gen_random_uuid() as id) reserved
  left join lateral (select m.id from public.takeoff_launch_requests m where m.tenant_id = p_tenant_id
    and m.project_id = p_project_id and m.origin = 'manual' and m.state in ('admitted', 'closed')
    order by m.created_at desc limit 1) manual on true
  returning * into request;
  return request;
end;
$$;
revoke all on function private.reserve_automatic_takeoff_request(uuid, uuid, uuid) from public, anon, authenticated, service_role;

create function private.confirm_affaire_brief_with_choice(
  p_tenant_id uuid, p_project_id uuid, p_actor uuid, p_expected_updated_at timestamptz, p_plans jsonb, p_notice text,
  p_host text default null, p_selection jsonb default null, p_blocked_reason text default null, p_module_default boolean default false,
  p_actor_claims jsonb default null
) returns table (outcome text, brief_updated_at timestamptz, request_id uuid, state text, reason_code text, payer_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  brief public.affaire_briefs%rowtype;
  request public.takeoff_launch_requests%rowtype;
  receipt private.takeoff_brief_confirmations%rowtype;
  remaining jsonb;
  reserved_id uuid;
  event_upload uuid;
  at timestamptz := pg_catalog.clock_timestamp();
begin
  if p_actor is null or p_expected_updated_at is null then
    raise exception 'TAKEOFF_BRIEF_CONFIRMATION_INVALID' using errcode = '22023';
  end if;
  if p_plans is not null and jsonb_typeof(p_plans) <> 'object' then
    raise exception 'TAKEOFF_BRIEF_PLAN_CHOICE_INVALID' using errcode='22023';
  end if;
  if p_plans is distinct from '{}'::jsonb then
    perform private.assert_takeoff_launch_gesture(p_host, p_selection, p_blocked_reason);
  elsif p_notice is not null then
    raise exception 'TAKEOFF_BRIEF_PLAN_CHOICE_INVALID' using errcode='22023';
  end if;
  select * into brief from public.affaire_briefs b where b.tenant_id = p_tenant_id and b.project_id = p_project_id for update;
  if not found then
    raise exception 'AFFAIRE_BRIEF_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not private.takeoff_member_may_confirm_brief(p_tenant_id, p_project_id, p_actor, p_actor_claims) then
    raise exception 'TAKEOFF_BRIEF_CONFIRMATION_FORBIDDEN' using errcode = '42501';
  end if;
  select * into receipt from private.takeoff_brief_confirmations c
    where c.tenant_id=p_tenant_id and c.project_id=p_project_id;
  if brief.updated_at <> p_expected_updated_at or brief.status='confirme' then
    if brief.status='confirme' and (brief.updated_at=p_expected_updated_at or
        (receipt.seen_revision=p_expected_updated_at and brief.confirmed_by=p_actor and receipt.confirmed_by=p_actor and receipt.confirmed_at=brief.confirmed_at))
        and (p_plans is null or (receipt.selected_plans=p_plans and receipt.confirmed_by=p_actor
          and receipt.confirmed_at=brief.confirmed_at)) then
      select * into request from public.takeoff_launch_requests r where r.tenant_id=p_tenant_id
        and r.project_id=p_project_id and r.origin='automatic'
        and (receipt.selected_plans is null or r.id=receipt.choice_request_id)
        order by r.created_at desc,r.id limit 1;
      return query select 'replayed'::text, brief.updated_at, request.id, request.state, request.reason_code, request.payer_id;
    else
      return query select 'conflict'::text, brief.updated_at, null::uuid, null::text, null::text, null::uuid;
    end if;
    return;
  end if;

  perform private.lock_takeoff_launch_commands(p_project_id);
  if p_plans is null then
    if private.takeoff_launch_active() and private.takeoff_module_enabled(p_tenant_id,p_module_default) then
      request := private.reserve_automatic_takeoff_request(p_tenant_id,p_project_id,p_actor);
    end if;
  else
    -- Lock a pending reservation before reading prior admissions. If an evaluator
    -- admitted it while we waited, READ COMMITTED sees that seal below.
    select * into request from public.takeoff_launch_requests r where r.tenant_id=p_tenant_id
      and r.project_id=p_project_id and r.origin='automatic' and r.state in ('blocked','not_eligible','evaluating') for update;
    if p_plans <> '{}'::jsonb and not (private.takeoff_plan_dispatch_active()
        and private.takeoff_module_enabled(p_tenant_id,p_module_default)) then
      raise exception 'TAKEOFF_LAUNCH_INACTIVE' using errcode='55000';
    end if;
    -- Both released manifest formats seal the SHA-256 of each copy. A grouped
    -- job covers its manifest; each per-plan job covers only its own unit.
    select coalesce(jsonb_object_agg(ch.key,ch.value),'{}'::jsonb) into remaining
    from jsonb_each(p_plans) ch where not exists (
      select 1 from public.takeoff_launch_requests r
      cross join lateral jsonb_array_elements(r.manifest->'plans') p
      join public.takeoff_jobs j on j.launch_request_id=r.id and j.tenant_id=r.tenant_id and j.project_id=r.project_id
        and j.launch_unit_key=case when r.manifest->'format_version'='1'::jsonb then 'grouped' else 'plan:' || lower(p->>'entry_key') end
      cross join lateral (select private.takeoff_unit_state(j.status::text,j.analysis_outcome,j.error_code,j.started_at) as state) unit
      where r.tenant_id=p_tenant_id and r.project_id=p_project_id and r.admitted_at is not null
        and lower(p->>'plan_file_id')=ch.key and p->>'content_sha256'=ch.value->>'sha256'
        and (unit.state='succeeded' or (r.state='admitted' and unit.state in ('queued','running'))));
    if (select count(*) from jsonb_object_keys(remaining)) > 20 then
      raise exception 'TAKEOFF_BRIEF_PLAN_LIMIT' using errcode='22023', hint='Choisissez au maximum 20 plans par analyse.';
    end if;
    if remaining='{}'::jsonb then
      if request.id is not null then
        request := private.withdraw_takeoff_launch_mandate(request,p_actor);
        update public.takeoff_launch_requests set selected_plans='{}',reason_code='ANALYSIS_NOT_REQUESTED' where id=request.id;
      end if;
      request := null;
    elsif request.id is null then
      reserved_id := gen_random_uuid();
      insert into public.takeoff_launch_requests(id,tenant_id,project_id,origin,intent,intent_key,state,reason_code,
        confirmed_by,selected_plans) values(reserved_id,p_tenant_id,p_project_id,'automatic','initial',reserved_id,'blocked',
        case when private.takeoff_launch_payer_eligible(p_tenant_id,p_project_id,p_actor) then 'MANDATE_REQUIRED'
          else 'OPERATOR_REQUIRED' end,p_actor,remaining) returning * into request;
    else
      update public.takeoff_launch_requests set selected_plans=remaining where id=request.id returning * into request;
    end if;
  end if;
  if private.takeoff_launch_request_open(request) and request.selected_plans is distinct from '{}'::jsonb then
    if p_notice is not null and p_notice=private.takeoff_payer_notice_digest(p_tenant_id,p_project_id,p_actor,p_selection,p_module_default) then
      request := private.mandate_takeoff_launch_request(request,p_actor,'confirmation',p_host,p_selection,p_blocked_reason);
    elsif request.payer_id is not null or request.confirmed_by is distinct from p_actor or p_plans is not null then
      request := private.withdraw_takeoff_launch_mandate(request,p_actor);
    end if;
  end if;
  perform pg_catalog.set_config('mergeone.takeoff_brief_confirmation', p_project_id::text, true);
  update public.affaire_briefs b set status = 'confirme', confirmed_at = at, confirmed_by = p_actor, updated_by = p_actor
  where b.id = brief.id
  returning * into brief;
  perform pg_catalog.set_config('mergeone.takeoff_brief_confirmation', '', true);
  if p_plans is not null and p_plans <> '{}'::jsonb then
    -- Last, after the brief's intake guard and the request lock, as in admission.
    perform pg_catalog.pg_advisory_xact_lock(private.takeoff_dossier_lock_key(p_project_id));
    perform private.assert_takeoff_brief_plans(p_tenant_id,p_project_id,p_plans);
  end if;
  insert into private.takeoff_brief_confirmations as c (tenant_id, project_id, confirmed_by, seen_revision, confirmed_at, selected_plans, choice_request_id)
  values (p_tenant_id, p_project_id, p_actor, p_expected_updated_at, at, p_plans, request.id)
  on conflict (project_id) do update set tenant_id = excluded.tenant_id, confirmed_by = excluded.confirmed_by,
    seen_revision = excluded.seen_revision, confirmed_at = excluded.confirmed_at, selected_plans=coalesce(excluded.selected_plans,c.selected_plans),
    choice_request_id=case when excluded.selected_plans is null and c.selected_plans is not null
      then c.choice_request_id else excluded.choice_request_id end;
  -- Never another affaire's upload: an event takes its scope from its upload.
  select u.id into event_upload from public.affaire_intake_uploads u
  where u.project_id = p_project_id and u.tenant_id = p_tenant_id
  order by (u.id = brief.upload_id) desc, u.created_at desc limit 1;
  if event_upload is not null then
    insert into public.affaire_intake_events (tenant_id, project_id, upload_id, actor_user_id, event_type, before_payload, after_payload)
    values (p_tenant_id, p_project_id, event_upload, p_actor, 'brief.confirmed',
      jsonb_build_object('status', 'a_confirmer', 'updated_at', p_expected_updated_at),
      jsonb_build_object('status', 'confirme', 'confirmed_at', at));
  end if;
  return query select 'confirmed'::text, brief.updated_at, request.id, request.state, request.reason_code, request.payer_id;
end;
$$;
revoke all on function private.confirm_affaire_brief_with_choice(uuid,uuid,uuid,timestamptz,jsonb,text,text,jsonb,text,boolean,jsonb) from public,anon,authenticated,service_role;

create or replace function public.confirm_affaire_brief_takeoff(
  p_tenant_id uuid, p_project_id uuid, p_actor uuid, p_expected_updated_at timestamptz, p_notice text,
  p_host text default null, p_selection jsonb default null, p_blocked_reason text default null, p_module_default boolean default false,
  p_actor_claims jsonb default null
) returns table (outcome text, brief_updated_at timestamptz, request_id uuid, state text, reason_code text, payer_id uuid)
language sql security definer set search_path = '' as $$
  select * from private.confirm_affaire_brief_with_choice(p_tenant_id,p_project_id,p_actor,p_expected_updated_at,null,p_notice,p_host,p_selection,p_blocked_reason,p_module_default,p_actor_claims)
$$;

create function public.confirm_affaire_brief_plan_choice(
  p_tenant_id uuid, p_project_id uuid, p_actor uuid, p_expected_updated_at timestamptz, p_plans jsonb, p_notice text,
  p_host text default null, p_selection jsonb default null, p_blocked_reason text default null, p_module_default boolean default false,
  p_actor_claims jsonb default null
) returns table (outcome text, brief_updated_at timestamptz, request_id uuid, state text, reason_code text, payer_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  if p_plans is null then
    raise exception 'TAKEOFF_BRIEF_PLAN_CHOICE_INVALID' using errcode='22023';
  end if;
  return query select * from private.confirm_affaire_brief_with_choice(p_tenant_id,p_project_id,p_actor,p_expected_updated_at,p_plans,p_notice,p_host,p_selection,p_blocked_reason,p_module_default,p_actor_claims);
end;
$$;
revoke all on function public.confirm_affaire_brief_plan_choice(uuid,uuid,uuid,timestamptz,jsonb,text,text,jsonb,text,boolean,jsonb)
  from public,anon,authenticated;
grant execute on function public.confirm_affaire_brief_plan_choice(uuid,uuid,uuid,timestamptz,jsonb,text,text,jsonb,text,boolean,jsonb)
  to service_role;
commit;
