begin;
set local lock_timeout = '5s';

-- NULL is a released client's all-plan request. An explicit choice maps file UUIDs
-- to the versions shown in the dialog. A receipt keeps the full gesture; the request
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
  select f.id,f.file_name,encode(sha256(convert_to(jsonb_build_array(
    f.id,f.plan_set_id,f.file_path,f.file_hash,f.file_size_bytes,f.metadata,extract(epoch from f.updated_at)
  )::text,'UTF8')),'hex')
  from chosen join public.plan_files f on f.plan_set_id=chosen.id
  where f.tenant_id=p_tenant_id and f.file_size_bytes>0 and
    (lower(f.file_type)='application/pdf' or lower(f.file_name) like '%.pdf')
    and exists(select 1 from private.resolve_takeoff_plan_location_source(p_tenant_id,p_project_id,f.id) s where s.current_copy)
  order by f.file_name,f.id
$$;
revoke all on function public.takeoff_brief_plan_options(uuid,uuid) from public,anon,authenticated;
grant execute on function public.takeoff_brief_plan_options(uuid,uuid) to service_role;

create function private.assert_takeoff_brief_plans(p_tenant uuid,p_project uuid,p_plans jsonb)
returns void language plpgsql stable set search_path = '' as $$
begin
  if (select coalesce(jsonb_object_agg(o.plan_file_id,o.plan_version),'{}'::jsonb)
      from public.takeoff_brief_plan_options(p_tenant,p_project) o
      where p_plans ? o.plan_file_id::text) is distinct from p_plans then
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
    (select array_agg(p->>'plan_file_id' order by p->>'plan_file_id')
      from jsonb_array_elements(new.manifest->'plans') p) is distinct from
    (select array_agg(id order by id) from jsonb_object_keys(new.selected_plans) id) then
    raise exception 'TAKEOFF_BRIEF_PLAN_SCOPE_MISMATCH' using errcode='22023';
  end if;
  perform private.assert_takeoff_brief_plans(new.tenant_id,new.project_id,new.selected_plans);
  return new;
end;
$$;
revoke all on function private.check_takeoff_brief_plan_admission() from public,anon,authenticated,service_role;
create trigger check_takeoff_brief_plan_admission before update of admitted_at on public.takeoff_launch_requests
  for each row when (new.selected_plans is not null and old.admitted_at is null and new.admitted_at is not null)
  execute function private.check_takeoff_brief_plan_admission();

create or replace function private.reserve_automatic_takeoff_request(p_tenant_id uuid, p_project_id uuid, p_confirmer uuid)
returns public.takeoff_launch_requests language plpgsql security definer set search_path = '' as $$
declare
  request public.takeoff_launch_requests%rowtype;
begin
  perform private.lock_takeoff_launch_commands(p_project_id);
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
    -- A first reading already admitted (also in flight) is never implicitly
    -- retried. A deliberate re-read remains a separate per-plan command.
    select coalesce(jsonb_object_agg(ch.key,ch.value),'{}'::jsonb) into remaining
    from jsonb_each(p_plans) ch where not exists (
      select 1 from public.takeoff_launch_requests r
      cross join lateral jsonb_array_elements(r.manifest->'plans') p
      where r.tenant_id=p_tenant_id and r.project_id=p_project_id and r.admitted_at is not null
        and p->>'plan_file_id'=ch.key and (r.selected_plans is null or r.selected_plans->ch.key=ch.value));
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
    seen_revision = excluded.seen_revision, confirmed_at = excluded.confirmed_at, selected_plans=excluded.selected_plans, choice_request_id=excluded.choice_request_id;
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
