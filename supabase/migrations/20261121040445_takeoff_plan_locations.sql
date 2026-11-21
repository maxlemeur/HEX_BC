-- The building and the level of a plan revision, corrected once by an operator.
--
-- A revision is a source of the affaire at one content digest (SHA-256 of its bytes). The source of a working copy
-- of the dossier is its dossier piece, so that a new copy of the same bytes (a reclassification rotates the copy)
-- keeps its correction; the source of a plan uploaded outside the dossier is its plan file. A value is never attached
-- to a plan in general: another digest is another revision, whose earlier correction is only shown as a proposal.
-- Each plan file's source is also recorded when the file is created, so that an analysis whose copy was rotated
-- away still finds the correction of the bytes it read.
--
-- The annotation is descriptive. No admission, worker, sending guard or e-mail reads it. The previous application
-- versions never read or write these objects. The one effect on their writes: inserting a plan file also records its
-- source in takeoff_plan_location_sources (an insert that never refuses), and deleting an affaire also deletes its
-- annotations. No existing table, policy, grant or check changes.
-- Requires 20261120204437_takeoff_jobs_by_affaire.sql (private.can_access_takeoff_scope).
begin;

set local lock_timeout = '5s';

create table public.takeoff_plan_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  source_kind text not null check (source_kind in ('intake_document', 'plan_file')),
  source_id uuid not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  -- The generation of the annotation: 1 at its creation, one more at each change. A write names the one it saw.
  revision integer not null check (revision >= 1),
  -- Null: no correction of this field; the reading of these bytes applies (an operator may also remove one this way).
  building text check (building is null or (building = btrim(building) and char_length(building) between 1 and 40
    and building !~ '[[:cntrl:]]')),
  level text check (level is null or (level = btrim(level) and char_length(level) between 1 and 40
    and level !~ '[[:cntrl:]]')),
  -- The copy it was last written through and its name then. Copies rotate: no foreign key, the history stays.
  plan_file_id uuid not null,
  document_name text not null check (char_length(document_name) between 1 and 500),
  -- The earlier revision whose correction the operator validated for this one, if any.
  carried_from_id uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  constraint takeoff_plan_locations_revision_key unique (tenant_id, project_id, source_kind, source_id, content_hash),
  constraint takeoff_plan_locations_scope_key unique (id, tenant_id, project_id),
  constraint takeoff_plan_locations_project_fkey foreign key (project_id, tenant_id)
    references public.estimate_projects(id, tenant_id) on delete cascade,
  constraint takeoff_plan_locations_carried_from_fkey foreign key (carried_from_id, tenant_id, project_id)
    references public.takeoff_plan_locations(id, tenant_id, project_id),
  constraint takeoff_plan_locations_carried_from_other check (carried_from_id is distinct from id)
);
create index takeoff_plan_locations_carried_from_idx on public.takeoff_plan_locations(carried_from_id)
  where carried_from_id is not null;

-- One row per change, written by the command only: who changed what, from which value, through which copy.
create table public.takeoff_plan_location_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  location_id uuid not null,
  revision integer not null check (revision >= 1),
  action text not null check (action in ('created', 'updated')),
  building_before text,
  level_before text,
  building text,
  level text,
  plan_file_id uuid not null,
  carried_from_id uuid,
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  constraint takeoff_plan_location_events_revision_key unique (location_id, revision),
  constraint takeoff_plan_location_events_location_fkey foreign key (location_id, tenant_id, project_id)
    references public.takeoff_plan_locations(id, tenant_id, project_id) on delete cascade
);
create index takeoff_plan_location_events_project_idx on public.takeoff_plan_location_events(tenant_id, project_id);

-- The source of every plan file, kept after a working copy is deleted: an analysis names its copy, not its piece.
create table public.takeoff_plan_location_sources (
  plan_file_id uuid primary key,
  tenant_id uuid not null,
  project_id uuid not null,
  source_kind text not null check (source_kind in ('intake_document', 'plan_file')),
  source_id uuid not null,
  recorded_at timestamptz not null default now(),
  constraint takeoff_plan_location_sources_kind_check check (source_kind = 'intake_document' or source_id = plan_file_id),
  constraint takeoff_plan_location_sources_project_fkey foreign key (project_id, tenant_id)
    references public.estimate_projects(id, tenant_id) on delete cascade
);
create index takeoff_plan_location_sources_project_idx on public.takeoff_plan_location_sources(tenant_id, project_id);

-- The source of a plan file row: its dossier piece when it is a copy of a piece of the same affaire, itself when it
-- was uploaded outside the dossier; nothing for a copy whose piece is not of its affaire.
create function private.takeoff_plan_file_source(p_tenant_id uuid, p_plan_set_id uuid, p_plan_file_id uuid, p_metadata jsonb)
returns table (project_id uuid, source_kind text, source_id uuid)
language sql stable set search_path = '' as $$
  select s.project_id,
    case when coalesce(p_metadata ->> 'source' = 'affaire-intake', false) then 'intake_document' else 'plan_file' end,
    case when coalesce(p_metadata ->> 'source' = 'affaire-intake', false) then d.id else p_plan_file_id end
  from public.plan_sets s
  left join public.affaire_intake_documents d
    on coalesce(p_metadata ->> 'source' = 'affaire-intake', false)
    -- A CASE, so that a malformed identifier is never cast.
    and d.id = case when p_metadata ->> 'intake_document_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then (p_metadata ->> 'intake_document_id')::uuid end
    and d.tenant_id = s.tenant_id and d.project_id = s.project_id
  where s.id = p_plan_set_id and s.tenant_id = p_tenant_id
    and (not coalesce(p_metadata ->> 'source' = 'affaire-intake', false) or d.id is not null)
$$;
revoke all on function private.takeoff_plan_file_source(uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;

create function private.record_takeoff_plan_location_source()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.takeoff_plan_location_sources (plan_file_id, tenant_id, project_id, source_kind, source_id)
  select new.id, new.tenant_id, source.project_id, source.source_kind, source.source_id
  from private.takeoff_plan_file_source(new.tenant_id, new.plan_set_id, new.id, new.metadata) source
  on conflict (plan_file_id) do nothing;
  return null;
end;
$$;
revoke all on function private.record_takeoff_plan_location_source() from public, anon, authenticated, service_role;
create trigger record_takeoff_plan_location_source after insert on public.plan_files
  for each row execute function private.record_takeoff_plan_location_source();

-- The plan files that exist today. A copy whose piece is not of its affaire is not recorded (nothing is repaired):
-- the pre-check of the pull request counts them, and this notice repeats the count.
do $$
declare
  recorded bigint;
  skipped bigint;
begin
  insert into public.takeoff_plan_location_sources (plan_file_id, tenant_id, project_id, source_kind, source_id)
  select f.id, f.tenant_id, source.project_id, source.source_kind, source.source_id
  from public.plan_files f
  cross join lateral private.takeoff_plan_file_source(f.tenant_id, f.plan_set_id, f.id, f.metadata) source;
  get diagnostics recorded = row_count;
  select count(*) into skipped from public.plan_files f
  where not exists (select 1 from public.takeoff_plan_location_sources l where l.plan_file_id = f.id);
  raise notice 'TAKEOFF_PLAN_LOCATION_SOURCES recorded %, copies without a piece of their affaire %', recorded, skipped;
end;
$$;

-- The key of a revision never changes, even for the command.
create function private.enforce_takeoff_plan_location_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id
    or new.project_id is distinct from old.project_id or new.source_kind is distinct from old.source_kind
    or new.source_id is distinct from old.source_id or new.content_hash is distinct from old.content_hash
    or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
    or new.revision <> old.revision + 1 then
    raise exception 'TAKEOFF_PLAN_LOCATION_IDENTITY_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_takeoff_plan_location_identity() from public, anon, authenticated, service_role;
create trigger enforce_takeoff_plan_location_identity before update on public.takeoff_plan_locations
  for each row execute function private.enforce_takeoff_plan_location_identity();

create function private.refuse_takeoff_plan_location_event_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'TAKEOFF_PLAN_LOCATION_EVENT_IMMUTABLE' using errcode = '42501';
end;
$$;
revoke all on function private.refuse_takeoff_plan_location_event_change() from public, anon, authenticated, service_role;
create trigger refuse_takeoff_plan_location_event_change before update on public.takeoff_plan_location_events
  for each row execute function private.refuse_takeoff_plan_location_event_change();

alter table public.takeoff_plan_locations enable row level security;
alter table public.takeoff_plan_location_events enable row level security;
alter table public.takeoff_plan_location_sources enable row level security;
-- Read as the affaire is read; no client writes a row, its author or its history directly. The server's service role
-- keeps its usual privileges on public tables; the triggers above still fix a revision's key and the history.
revoke all on table public.takeoff_plan_locations, public.takeoff_plan_location_events, public.takeoff_plan_location_sources
  from public, anon, authenticated;
grant select on table public.takeoff_plan_locations, public.takeoff_plan_location_events, public.takeoff_plan_location_sources
  to authenticated;
grant select, insert, update, delete on table public.takeoff_plan_locations, public.takeoff_plan_location_events,
  public.takeoff_plan_location_sources to service_role;
create policy "Affaire readers can select takeoff plan location sources" on public.takeoff_plan_location_sources
  for select to authenticated
  using ((select private.can_access_takeoff_scope(tenant_id, project_id, null, false)));
create policy "Affaire readers can select takeoff plan locations" on public.takeoff_plan_locations
  for select to authenticated
  using ((select private.can_access_takeoff_scope(tenant_id, project_id, null, false)));
create policy "Affaire readers can select takeoff plan location events" on public.takeoff_plan_location_events
  for select to authenticated
  using ((select private.can_access_takeoff_scope(tenant_id, project_id, null, false)));

-- The source of a plan file of the affaire, and whether a correction may be written through it now: a dossier copy
-- only while it is the current copy of its piece, by the predicate of delete_stale_intake_plan_file. A copy deleted
-- since is still resolved from takeoff_plan_location_sources, never as current.
create function private.resolve_takeoff_plan_location_source(p_tenant_id uuid, p_project_id uuid, p_plan_file_id uuid)
returns table (source_kind text, source_id uuid, plan_file_id uuid, current_copy boolean)
language sql stable set search_path = '' as $$
  with copy as (
    select f.id, f.metadata, source.source_kind, source.source_id
    from public.plan_files f
    join public.plan_sets s on s.id = f.plan_set_id and s.tenant_id = f.tenant_id
    cross join lateral private.takeoff_plan_file_source(f.tenant_id, f.plan_set_id, f.id, f.metadata) source
    where f.id = p_plan_file_id and f.tenant_id = p_tenant_id and s.project_id = p_project_id
  )
  select copy.source_kind, copy.source_id, copy.id,
    coalesce(copy.metadata ->> 'intake_cleanup_pending', 'false') <> 'true' and (copy.source_kind = 'plan_file' or exists (
      select 1 from public.affaire_intake_documents d
      where d.id = copy.source_id and d.tenant_id = p_tenant_id and d.project_id = p_project_id
        and d.deleted_at is null and d.deletion_token is null and d.upload_status = 'uploaded'
        and d.classification_status = 'classified' and d.document_kind = 'plans'
        and copy.metadata ->> 'intake_storage_path' is not distinct from d.storage_path
        and (d.storage_path is not null or copy.metadata ->> 'intake_drive_file_id' is not distinct from d.drive_file_id)
        and (not (copy.metadata ? 'intake_generation')
          or copy.metadata ->> 'intake_generation' = d.plan_copy_generation::text)
        and (not (copy.metadata ? 'intake_classified_at')
          or (copy.metadata ->> 'intake_classified_at')::timestamptz is not distinct from d.classified_at)))
  from copy
  union all
  select recorded.source_kind, recorded.source_id, recorded.plan_file_id, false
  from public.takeoff_plan_location_sources recorded
  where recorded.plan_file_id = p_plan_file_id and recorded.tenant_id = p_tenant_id and recorded.project_id = p_project_id
    and not exists (select 1 from copy)
$$;
revoke all on function private.resolve_takeoff_plan_location_source(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- What the server reads before it looks up or writes an annotation, under the caller's own rights.
create function public.read_takeoff_plan_location_source(p_project_id uuid, p_plan_file_id uuid)
returns table (source_kind text, source_id uuid, plan_file_id uuid, current_copy boolean, can_write boolean)
language sql stable security definer set search_path = '' as $$
  select source.source_kind, source.source_id, source.plan_file_id, source.current_copy,
    private.can_access_takeoff_scope((select public.current_tenant_id()), p_project_id, null, true)
  from private.resolve_takeoff_plan_location_source((select public.current_tenant_id()), p_project_id, p_plan_file_id) source
  where private.can_access_takeoff_scope((select public.current_tenant_id()), p_project_id, null, false)
$$;
revoke all on function public.read_takeoff_plan_location_source(uuid, uuid) from public, anon, service_role;
grant execute on function public.read_takeoff_plan_location_source(uuid, uuid) to authenticated;

-- The only writer. The author is the session's member; the revision is compared under the row lock. The digest is
-- the one the application server computed from the bytes it read; a member calling this command directly can name
-- any digest of a source of an affaire they operate, so a row proves an operator's statement about those bytes, not
-- that the operator saw them.
create function public.set_takeoff_plan_location(
  p_project_id uuid,
  p_plan_file_id uuid,
  p_content_hash text,
  p_expected_revision integer,
  p_building text,
  p_level text,
  p_document_name text,
  p_carried_from_id uuid default null
) returns public.takeoff_plan_locations
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  tenant uuid := (select public.current_tenant_id());
  source record;
  existing public.takeoff_plan_locations%rowtype;
  saved public.takeoff_plan_locations%rowtype;
  intake_document text;
begin
  if actor is null or tenant is null or p_project_id is null
    or not private.can_access_takeoff_scope(tenant, p_project_id, null, true) then
    raise exception 'TAKEOFF_PLAN_LOCATION_FORBIDDEN' using errcode = '42501';
  end if;
  if p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' or p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'TAKEOFF_PLAN_LOCATION_REVISION_INVALID' using errcode = '22023';
  end if;
  if (p_building is not null and (p_building <> btrim(p_building) or char_length(p_building) not between 1 and 40
      or p_building ~ '[[:cntrl:]]'))
    or (p_level is not null and (p_level <> btrim(p_level) or char_length(p_level) not between 1 and 40
      or p_level ~ '[[:cntrl:]]'))
    or p_document_name is null or char_length(p_document_name) not between 1 and 500 then
    raise exception 'TAKEOFF_PLAN_LOCATION_VALUE_INVALID' using errcode = '22023';
  end if;

  -- Lock the copy, then its dossier piece: the order of the copy cleanup (delete_stale_intake_plan_file).
  select f.metadata ->> 'intake_document_id' into intake_document
  from public.plan_files f where f.id = p_plan_file_id and f.tenant_id = tenant for share;
  if intake_document ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    perform 1 from public.affaire_intake_documents d
    where d.id = intake_document::uuid and d.tenant_id = tenant for share;
  end if;
  select * into source from private.resolve_takeoff_plan_location_source(tenant, p_project_id, p_plan_file_id);
  if not found then
    raise exception 'TAKEOFF_PLAN_LOCATION_SOURCE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not source.current_copy then
    raise exception 'TAKEOFF_PLAN_LOCATION_SOURCE_STALE' using errcode = '40001';
  end if;

  if p_carried_from_id is not null and not exists (
    select 1 from public.takeoff_plan_locations earlier
    where earlier.id = p_carried_from_id and earlier.tenant_id = tenant and earlier.project_id = p_project_id
      and (earlier.source_kind, earlier.source_id, earlier.content_hash)
        is distinct from (source.source_kind, source.source_id, p_content_hash)) then
    raise exception 'TAKEOFF_PLAN_LOCATION_CARRY_OVER_INVALID' using errcode = '22023';
  end if;

  select * into existing from public.takeoff_plan_locations l
  where l.tenant_id = tenant and l.project_id = p_project_id and l.source_kind = source.source_kind
    and l.source_id = source.source_id and l.content_hash = p_content_hash
  for update;

  if existing.id is null then
    if p_expected_revision <> 0 then
      raise exception 'TAKEOFF_PLAN_LOCATION_CONFLICT' using errcode = '40001';
    end if;
    insert into public.takeoff_plan_locations (tenant_id, project_id, source_kind, source_id, content_hash, revision,
      building, level, plan_file_id, document_name, carried_from_id, created_by, updated_by)
    values (tenant, p_project_id, source.source_kind, source.source_id, p_content_hash, 1,
      p_building, p_level, p_plan_file_id, p_document_name, p_carried_from_id, actor, actor)
    on conflict on constraint takeoff_plan_locations_revision_key do nothing
    returning * into saved;
    -- Another operator created this revision's annotation first: theirs stands.
    if saved.id is null then
      raise exception 'TAKEOFF_PLAN_LOCATION_CONFLICT' using errcode = '40001';
    end if;
    insert into public.takeoff_plan_location_events (tenant_id, project_id, location_id, revision, action,
      building, level, plan_file_id, carried_from_id, actor_id)
    values (tenant, p_project_id, saved.id, 1, 'created', p_building, p_level, p_plan_file_id, p_carried_from_id, actor);
    return saved;
  end if;

  if existing.revision <> p_expected_revision then
    raise exception 'TAKEOFF_PLAN_LOCATION_CONFLICT' using errcode = '40001';
  end if;
  -- Saving the same values again changes nothing and records nothing.
  if existing.building is not distinct from p_building and existing.level is not distinct from p_level then
    return existing;
  end if;
  update public.takeoff_plan_locations l set revision = l.revision + 1, building = p_building, level = p_level,
    plan_file_id = p_plan_file_id, document_name = p_document_name,
    carried_from_id = coalesce(p_carried_from_id, l.carried_from_id),
    updated_by = actor, updated_at = now()
  where l.id = existing.id
  returning * into saved;
  insert into public.takeoff_plan_location_events (tenant_id, project_id, location_id, revision, action,
    building_before, level_before, building, level, plan_file_id, carried_from_id, actor_id)
  values (tenant, p_project_id, saved.id, saved.revision, 'updated', existing.building, existing.level,
    p_building, p_level, p_plan_file_id, p_carried_from_id, actor);
  return saved;
end;
$$;
revoke all on function public.set_takeoff_plan_location(uuid, uuid, text, integer, text, text, text, uuid)
  from public, anon, service_role;
grant execute on function public.set_takeoff_plan_location(uuid, uuid, text, integer, text, text, text, uuid)
  to authenticated;

commit;
