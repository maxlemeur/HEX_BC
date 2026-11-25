-- A find belongs to a published reading. Matching across readings uses the plan's
-- sealed logical identity and its designation. Page and evidence remain those of
-- the reading on which the member acted, even when the job is later removed.
create function public.takeoff_find_designation_key(p_designation text)
returns text language sql immutable strict parallel safe set search_path = '' as $$
  select coalesce(nullif(normalize(btrim(regexp_replace(
    lower(regexp_replace(normalize(p_designation, NFD), U&'[\0300-\036f]', '', 'g') collate "und-x-icu"),
    U&'[\0009-\000d\0020\0085\00a0\1680\2000-\200a\2028\2029\202f\205f\3000]+', ' ', 'g')), NFC), ''), p_designation)
$$;
revoke all on function public.takeoff_find_designation_key(text) from public, anon, authenticated;
grant execute on function public.takeoff_find_designation_key(text) to service_role;

create table public.takeoff_find_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  plan_logical_id uuid not null,
  plan_file_id uuid not null,
  intake_document_id uuid check (intake_document_id = plan_logical_id),
  plan_name text not null,
  job_id uuid not null,
  finding_index integer not null check (finding_index >= 0),
  page integer not null check (page > 0),
  designation text not null,
  designation_key text generated always as (public.takeoff_find_designation_key(designation)) stored,
  evidence text not null,
  decided_by uuid not null,
  decided_at timestamptz not null default clock_timestamp(),
  item_id uuid unique,
  reason text check (reason in ('outside_scope', 'retained_existing', 'already_counted', 'other')),
  detail text,
  undone_by uuid,
  undone_at timestamptz,
  check ((item_id is null) = (reason is not null)),
  check (case when reason = 'other' then detail is not null and detail ~ '[^[:space:]]'
    and char_length(detail) <= 300 else detail is null end),
  check ((undone_by is null) = (undone_at is null) and (undone_at is null or item_id is null)),
  foreign key (project_id, tenant_id) references public.estimate_projects(id, tenant_id) on delete cascade,
  foreign key (item_id, tenant_id, project_id) references public.takeoff_list_items(id, tenant_id, project_id) on delete cascade
);
create unique index takeoff_find_active_decision on public.takeoff_find_decisions
  (job_id, finding_index) where undone_at is null;
create index takeoff_find_decisions_rereading on public.takeoff_find_decisions
  (tenant_id, project_id, plan_logical_id, designation_key) where undone_at is null;
create index takeoff_find_decisions_project on public.takeoff_find_decisions(tenant_id, project_id, plan_file_id);
alter table public.takeoff_find_decisions enable row level security;
revoke all on public.takeoff_find_decisions from public, anon, authenticated, service_role;
grant select on public.takeoff_find_decisions to authenticated;
grant select, insert, update, delete on public.takeoff_find_decisions to service_role;
create trigger takeoff_find_decisions_writer before insert or update or delete on public.takeoff_find_decisions
  for each row execute function private.refuse_takeoff_item_list_direct_write();
create policy takeoff_find_decisions_read on public.takeoff_find_decisions for select to authenticated using (
  (select private.can_access_takeoff_scope(tenant_id, project_id, null, false))
  and ((select public.can_access_takeoff_project(project_id, tenant_id)) or exists (
    select 1 from public.plan_files f where f.id = takeoff_find_decisions.plan_file_id
      and f.tenant_id = takeoff_find_decisions.tenant_id)
    or exists (select 1 from public.affaire_intake_documents d where d.id = takeoff_find_decisions.intake_document_id
      and d.tenant_id = takeoff_find_decisions.tenant_id and d.project_id = takeoff_find_decisions.project_id))
);

-- Separate occurrences in one publication stay actionable. Across publications
-- of the same plan, the first decision stands. Both commands already hold
-- the affaire's list lock, including during a multi-row addition.
create function private.check_takeoff_find_rereading()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.takeoff_find_decisions d where d.tenant_id = new.tenant_id
    and d.project_id = new.project_id and d.plan_logical_id = new.plan_logical_id
    and d.designation_key = public.takeoff_find_designation_key(new.designation)
    and d.undone_at is null and d.job_id <> new.job_id) then
    raise exception 'TAKEOFF_FIND_ALREADY_DECIDED' using errcode = '23505';
  end if;
  return new;
end;
$$;
revoke all on function private.check_takeoff_find_rereading() from public, anon, authenticated, service_role;
create trigger takeoff_find_rereading before insert on public.takeoff_find_decisions
  for each row execute function private.check_takeoff_find_rereading();

-- Resolve one coordinate against the sealed publication, never against a client copy of its evidence.
create function private.takeoff_find_source(p_tenant uuid, p_project uuid, p_job uuid, p_index integer)
returns table(plan_logical_id uuid, plan_file_id uuid, intake_document_id uuid, plan_name text, page integer, designation text, evidence text)
language sql stable set search_path = '' as $$
  select plan.logical_id, plan.plan_file_id, source.source_id, coalesce(plan.name, plan.plan_file_id::text), (f.value ->> 'page')::int,
    f.value ->> 'designation', f.value ->> 'evidence'
  from public.takeoff_item_answer_publications pub
  join public.takeoff_launch_requests r on r.id = pub.launch_request_id
  cross join lateral private.takeoff_item_answer_plans(r.manifest, private.takeoff_launch_unit(r.manifest, pub.launch_unit_key)) plan
  -- Freeze the dossier origin only when the sealed file and logical id agree with its registered copy.
  left join public.takeoff_plan_location_sources source on source.plan_file_id = plan.plan_file_id
    and source.source_id = plan.logical_id and source.source_kind = 'intake_document'
    and source.tenant_id = pub.tenant_id and source.project_id = pub.project_id
  cross join lateral (select pub.unlisted_findings -> p_index) f(value)
  where pub.tenant_id = p_tenant and pub.project_id = p_project and pub.job_id = p_job
    and p_index >= 0 and f.value is not null
$$;
revoke all on function private.takeoff_find_source(uuid,uuid,uuid,integer) from public, anon, authenticated, service_role;

create function private.lock_takeoff_find_writer(p_tenant uuid, p_project uuid, p_actor uuid)
returns void language plpgsql set search_path = '' as $$
begin
  perform private.lock_takeoff_item_list(p_project);
  if not private.takeoff_item_list_writer(p_tenant, p_project, p_actor) then
    raise exception 'TAKEOFF_ITEM_LIST_FORBIDDEN' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.lock_takeoff_find_writer(uuid,uuid,uuid) from public, anon, authenticated, service_role;

create function public.dismiss_takeoff_find(p_tenant_id uuid, p_project_id uuid, p_actor uuid,
  p_job_id uuid, p_finding_index integer, p_intent_key uuid, p_reason text, p_detail text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  prior public.takeoff_find_decisions%rowtype;
  detail_text text := btrim(p_detail);
begin
  perform private.lock_takeoff_find_writer(p_tenant_id, p_project_id, p_actor);
  if p_reason is null or p_reason not in ('outside_scope', 'retained_existing', 'already_counted', 'other')
    or (p_reason = 'other' and (coalesce(detail_text, '') !~ '[^[:space:]]' or char_length(detail_text) > 300))
    or (p_reason <> 'other' and p_detail is not null) then
    raise exception 'TAKEOFF_FIND_REASON_INVALID' using errcode = '22023';
  end if;
  select * into prior from public.takeoff_find_decisions where id = p_intent_key
    and tenant_id = p_tenant_id and project_id = p_project_id;
  if found then
    if (prior.decided_by, prior.job_id, prior.finding_index, prior.reason, prior.detail)
      is distinct from (p_actor, p_job_id, p_finding_index, p_reason, detail_text) then
      raise exception 'TAKEOFF_ITEM_LIST_INTENT_CONFLICT' using errcode = '23505';
    end if;
    return prior.id;
  end if;
  insert into public.takeoff_find_decisions(id, tenant_id, project_id, job_id, finding_index,
    decided_by, reason, detail, plan_logical_id, plan_file_id, intake_document_id, plan_name, page, designation, evidence)
  select p_intent_key, p_tenant_id, p_project_id, p_job_id, p_finding_index, p_actor, p_reason, detail_text, f.*
  from private.takeoff_find_source(p_tenant_id,p_project_id,p_job_id,p_finding_index) f
  on conflict (job_id, finding_index) where undone_at is null do nothing;
  if not found then
    if exists(select 1 from private.takeoff_find_source(p_tenant_id,p_project_id,p_job_id,p_finding_index)) then
      raise exception 'TAKEOFF_FIND_ALREADY_DECIDED' using errcode = '23505';
    end if;
    raise exception 'TAKEOFF_FIND_INVALID' using errcode = '22023';
  end if;
  return p_intent_key;
end;
$$;

create function public.undo_takeoff_find_dismissal(p_tenant_id uuid, p_project_id uuid, p_actor uuid, p_decision_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.lock_takeoff_find_writer(p_tenant_id, p_project_id, p_actor);
  update public.takeoff_find_decisions set undone_at = clock_timestamp(), undone_by = p_actor
  where tenant_id = p_tenant_id and project_id = p_project_id and id = p_decision_id and item_id is null and undone_at is null;
  if not found and not exists (select 1 from public.takeoff_find_decisions where tenant_id = p_tenant_id
    and project_id = p_project_id and id = p_decision_id and undone_at is not null) then
    raise exception 'TAKEOFF_FIND_INVALID' using errcode = '22023';
  end if;
end;
$$;

-- One list revision for the whole selection. A stale list, a bad coordinate or a conflicting
-- decision rolls the transaction back. Only the server can submit the usual manual revision payload.
create function public.add_takeoff_finds_to_list(p_tenant_id uuid, p_project_id uuid, p_actor uuid,
  p_expected_revision integer, p_intent_key uuid, p_gesture_sha256 text, p_entries jsonb, p_finds jsonb)
returns table(revision_id uuid, revision integer, content_sha256 text, replayed boolean)
language plpgsql security definer set search_path = '' as $$
declare
  previous public.takeoff_list_revisions%rowtype;
  receipt record;
  added integer;
  violated_constraint text;
begin
  perform private.lock_takeoff_find_writer(p_tenant_id,p_project_id,p_actor);
  if jsonb_typeof(p_finds) is distinct from 'array' or jsonb_array_length(p_finds) not between 1 and 10000 then
    raise exception 'TAKEOFF_FIND_INVALID' using errcode = '22023';
  end if;
  select * into previous from public.takeoff_list_revisions r where r.tenant_id = p_tenant_id
    and r.project_id = p_project_id and r.revision = p_expected_revision;
  if not found then raise exception 'TAKEOFF_ITEM_LIST_STALE' using errcode = '40001'; end if;
  select * into receipt from public.record_takeoff_list_revision(p_tenant_id,p_project_id,p_actor,p_expected_revision,
    p_intent_key,private.takeoff_sha256(jsonb_build_array('add_finds',p_actor,p_gesture_sha256,p_finds)),
    'item_added',previous.sources,p_entries);
  if not receipt.replayed then
    if (select count(*) from public.takeoff_list_items i where i.tenant_id = p_tenant_id and i.project_id = p_project_id
        and i.created_in_revision = receipt.revision) <> jsonb_array_length(p_finds)
      or jsonb_array_length(p_entries) <> previous.item_count + jsonb_array_length(p_finds)
      or exists (select 1 from public.takeoff_list_revision_entries old where old.revision_id = previous.id
        and not exists (select 1 from public.takeoff_list_revision_entries e where e.revision_id = receipt.revision_id
          and e.item_id = old.item_id and (to_jsonb(e) - array['revision_id','position']) = (to_jsonb(old) - array['revision_id','position']))) then
      raise exception 'TAKEOFF_FIND_INVALID' using errcode = '22023';
    end if;
    insert into public.takeoff_find_decisions(tenant_id, project_id, job_id, finding_index, decided_by, item_id,
      plan_logical_id, plan_file_id, intake_document_id, plan_name, page, designation, evidence)
    select p_tenant_id, p_project_id, ref.job_id, ref.finding_index, p_actor, i.id, f.*
    from jsonb_to_recordset(p_finds) ref(job_id uuid, finding_index integer, item_id uuid)
    join public.takeoff_list_items i on i.id = ref.item_id and i.tenant_id = p_tenant_id and i.project_id = p_project_id
      and i.created_in_revision = receipt.revision and i.origin_kind = 'manual'
    cross join lateral private.takeoff_find_source(p_tenant_id,p_project_id,ref.job_id,ref.finding_index) f
    join public.takeoff_list_revision_entries e on e.revision_id = receipt.revision_id and e.item_id = i.id
      and e.reference_quantity is null and e.expected_unit is not null;
    get diagnostics added = row_count;
    if added <> jsonb_array_length(p_finds) then
      raise exception 'TAKEOFF_FIND_INVALID' using errcode = '22023';
    end if;
  end if;
  return query select receipt.revision_id, receipt.revision, receipt.content_sha256, receipt.replayed;
exception when unique_violation then
  get stacked diagnostics violated_constraint = constraint_name;
  if violated_constraint = 'takeoff_find_active_decision' then
    raise exception 'TAKEOFF_FIND_ALREADY_DECIDED' using errcode = '23505';
  end if;
  raise;
end;
$$;

revoke all on function public.dismiss_takeoff_find(uuid,uuid,uuid,uuid,integer,uuid,text,text),
  public.undo_takeoff_find_dismissal(uuid,uuid,uuid,uuid),
  public.add_takeoff_finds_to_list(uuid,uuid,uuid,integer,uuid,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.dismiss_takeoff_find(uuid,uuid,uuid,uuid,integer,uuid,text,text),
  public.undo_takeoff_find_dismissal(uuid,uuid,uuid,uuid),
  public.add_takeoff_finds_to_list(uuid,uuid,uuid,integer,uuid,text,jsonb,jsonb) to service_role;
