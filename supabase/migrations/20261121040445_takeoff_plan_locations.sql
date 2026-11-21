-- The building and the level of a plan revision, corrected once by an operator.
--
-- A revision is a source of the affaire at one content digest (SHA-256 of its bytes). The source of a working copy
-- of the dossier is its dossier piece, so that a new copy of the same bytes (a reclassification rotates the copy)
-- keeps its correction; the source of a plan uploaded outside the dossier is its plan file. A value is never attached
-- to a plan in general: another digest is another revision, whose earlier correction is only shown as a proposal.
-- Each plan file's source is also recorded when the file is created, so that an analysis whose copy was rotated
-- away still finds the correction of the bytes it read.
--
-- A correction is accepted only for a revision the application server attested: it read the plan file's bytes itself,
-- under its service role, and recorded their digest for one member and one save (private, never writable by a
-- member's session). The member's own session then writes the correction, with its role checked and the generation
-- it saw compared under the row lock.
--
-- The annotation is descriptive. No admission, worker, sending guard or e-mail reads it. The previous application
-- versions never read or write these objects. The one effect on their writes: inserting a plan file also records its
-- source in takeoff_plan_location_sources (an insert that never refuses and takes no lock the insert did not hold),
-- and deleting an affaire also deletes its annotations. No existing table, policy, grant or check changes. Applying
-- it locks estimate_projects, plan_sets and plan_files against writes (SHARE ROW EXCLUSIVE) from the first statement
-- that needs each until the commit, through the backfill; lock_timeout bounds only the wait to acquire them.
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
  -- Per field, the operator's choice: follow the plan's reading, set a value, or mark it to be specified. Who made
  -- the field's current choice, when and at which generation; whether its value was carried from an earlier revision.
  building_choice text not null check (building_choice in ('reading', 'value', 'unknown')),
  building text check (building is null or (building = btrim(building) and char_length(building) between 1 and 40
    and building !~ '[[:cntrl:]]')),
  building_carried boolean not null default false,
  building_set_by uuid not null,
  building_set_at timestamptz not null,
  building_set_revision integer not null check (building_set_revision >= 1),
  level_choice text not null check (level_choice in ('reading', 'value', 'unknown')),
  level text check (level is null or (level = btrim(level) and char_length(level) between 1 and 40
    and level !~ '[[:cntrl:]]')),
  level_carried boolean not null default false,
  level_set_by uuid not null,
  level_set_at timestamptz not null,
  level_set_revision integer not null check (level_set_revision >= 1),
  -- The copy it was last written through and its name then. Copies rotate: no foreign key, the history stays.
  plan_file_id uuid not null,
  document_name text not null check (char_length(document_name) between 1 and 500),
  -- The earlier revision, at the generation the server proposed it, whose values the carried fields hold.
  carried_from_id uuid,
  carried_from_revision integer,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  constraint takeoff_plan_locations_building_value check ((building_choice = 'value') = (building is not null)),
  constraint takeoff_plan_locations_level_value check ((level_choice = 'value') = (level is not null)),
  constraint takeoff_plan_locations_building_carried check (not building_carried or building_choice = 'value'),
  constraint takeoff_plan_locations_level_carried check (not level_carried or level_choice = 'value'),
  -- An origin exactly while a field is carried from it.
  constraint takeoff_plan_locations_carried_origin check ((carried_from_id is null) = (carried_from_revision is null)
    and (carried_from_id is not null) = (building_carried or level_carried)),
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

-- One row per change, written by the command only: who changed what, from which choice and value, through which
-- copy, on which attestation of the server.
create table public.takeoff_plan_location_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  location_id uuid not null,
  revision integer not null check (revision >= 1),
  action text not null check (action in ('created', 'updated')),
  attestation_id uuid not null,
  building_choice_before text,
  building_before text,
  building_choice text not null,
  building text,
  building_carried boolean not null,
  level_choice_before text,
  level_before text,
  level_choice text not null,
  level text,
  level_carried boolean not null,
  plan_file_id uuid not null,
  carried_from_id uuid,
  carried_from_revision integer,
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  constraint takeoff_plan_location_events_revision_key unique (location_id, revision),
  constraint takeoff_plan_location_events_location_fkey foreign key (location_id, tenant_id, project_id)
    references public.takeoff_plan_locations(id, tenant_id, project_id) on delete cascade
);
create index takeoff_plan_location_events_project_idx on public.takeoff_plan_location_events(tenant_id, project_id);

-- The source of every plan file, kept after a working copy is deleted: an analysis names its copy, not its piece.
-- Its foreign key is the plan set's (id, affaire, tenant): the plan file insert already holds that row, so recording a
-- source takes no lock a plan file insert did not take before, and a plan set an analysis still references is kept.
-- Deleting a plan set removes its recorded sources (annotations and their history stay until the affaire is deleted);
-- the composite key also refuses moving a plan set that has recorded sources to another affaire, which no released
-- route does.
create table public.takeoff_plan_location_sources (
  plan_file_id uuid primary key,
  plan_set_id uuid not null,
  tenant_id uuid not null,
  project_id uuid not null,
  source_kind text not null check (source_kind in ('intake_document', 'plan_file')),
  source_id uuid not null,
  recorded_at timestamptz not null default now(),
  constraint takeoff_plan_location_sources_kind_check check (source_kind = 'intake_document' or source_id = plan_file_id),
  constraint takeoff_plan_location_sources_plan_set_fkey foreign key (plan_set_id, project_id, tenant_id)
    references public.plan_sets(id, project_id, tenant_id) on delete cascade
);
create index takeoff_plan_location_sources_project_idx on public.takeoff_plan_location_sources(tenant_id, project_id);
create index takeoff_plan_location_sources_plan_set_idx on public.takeoff_plan_location_sources(plan_set_id);

-- The server's attestations: one per save, for one member, of the digest of the bytes the server read for one plan
-- file, and of the earlier revision it proposed to carry over (at its generation then, with its values). Private:
-- no Data API role reads or writes it; only attest_takeoff_plan_revision (service role) creates one, and the command
-- consumes it once.
create table private.takeoff_plan_location_attestations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  plan_file_id uuid not null,
  source_kind text not null check (source_kind in ('intake_document', 'plan_file')),
  source_id uuid not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  document_name text not null check (char_length(document_name) between 1 and 500),
  actor_id uuid not null,
  carry_from_id uuid,
  carry_from_revision integer,
  carry_building text,
  carry_level text,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  constraint takeoff_plan_location_attestations_carry check ((carry_from_id is null) = (carry_from_revision is null)),
  constraint takeoff_plan_location_attestations_project_fkey foreign key (project_id, tenant_id)
    references public.estimate_projects(id, tenant_id) on delete cascade
);
-- Its affaire key, for the cascade of an affaire's deletion and for the cleanup of a member's spent attestations.
create index takeoff_plan_location_attestations_project_idx
  on private.takeoff_plan_location_attestations(project_id, tenant_id, actor_id);
revoke all on table private.takeoff_plan_location_attestations from public, anon, authenticated, service_role;

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
  insert into public.takeoff_plan_location_sources (plan_file_id, plan_set_id, tenant_id, project_id, source_kind, source_id)
  select new.id, new.plan_set_id, new.tenant_id, source.project_id, source.source_kind, source.source_id
  from private.takeoff_plan_file_source(new.tenant_id, new.plan_set_id, new.id, new.metadata) source
  on conflict (plan_file_id) do nothing;
  return null;
end;
$$;
revoke all on function private.record_takeoff_plan_location_source() from public, anon, authenticated, service_role;
create trigger record_takeoff_plan_location_source after insert on public.plan_files
  for each row execute function private.record_takeoff_plan_location_source();

-- The plan files that exist today, one row each. A plan file whose source cannot be named (a dossier copy whose piece
-- is not of its affaire, a file of another tenant than its plan set) stops the migration with their count: nothing is
-- repaired, and the pre-check of the pull request counts and lists them in advance.
do $$
declare
  recorded bigint;
  unnamed bigint;
begin
  insert into public.takeoff_plan_location_sources (plan_file_id, plan_set_id, tenant_id, project_id, source_kind, source_id)
  select f.id, f.plan_set_id, f.tenant_id, source.project_id, source.source_kind, source.source_id
  from public.plan_files f
  cross join lateral private.takeoff_plan_file_source(f.tenant_id, f.plan_set_id, f.id, f.metadata) source;
  get diagnostics recorded = row_count;
  select count(*) into unnamed from public.plan_files f
  where not exists (select 1 from public.takeoff_plan_location_sources l where l.plan_file_id = f.id);
  if unnamed > 0 then
    raise exception 'TAKEOFF_PLAN_LOCATION_SOURCES_BACKFILL_REFUSED: % plan files without a source of their affaire', unnamed;
  end if;
  raise notice 'TAKEOFF_PLAN_LOCATION_SOURCES recorded %', recorded;
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
        and (d.storage_path is not null
          or (d.source_provider = 'google_drive' and copy.metadata ->> 'intake_drive_file_id' = d.drive_file_id))
        and (lower(d.mime_type) = 'application/pdf' or lower(d.file_name) like '%.pdf')
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

-- The application server attests, for one member and one save, the digest of the bytes it has just read for a plan
-- file of the affaire, and the earlier revision it proposes to carry over (pinned at its generation, with its values).
-- Service role only: a member's session can attest nothing.
create function public.attest_takeoff_plan_revision(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_project_id uuid,
  p_plan_file_id uuid,
  p_content_hash text,
  p_document_name text,
  p_carry_from_id uuid default null,
  p_carry_from_revision integer default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  source record;
  origin public.takeoff_plan_locations%rowtype;
  attested uuid;
begin
  if p_tenant_id is null or p_actor_id is null or p_project_id is null or p_content_hash is null
    or p_content_hash !~ '^[0-9a-f]{64}$' or p_document_name is null or char_length(p_document_name) not between 1 and 500
    or (p_carry_from_id is null) <> (p_carry_from_revision is null) then
    raise exception 'TAKEOFF_PLAN_LOCATION_ATTESTATION_INVALID' using errcode = '22023';
  end if;
  -- The affaire first, as the command and a deletion take it: the cleanup below never holds an attestation a
  -- deletion's cascade waits for while it waits for the affaire.
  perform 1 from public.estimate_projects p where p.id = p_project_id and p.tenant_id = p_tenant_id for key share;
  if not found then
    raise exception 'TAKEOFF_PLAN_LOCATION_SOURCE_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into source from private.resolve_takeoff_plan_location_source(p_tenant_id, p_project_id, p_plan_file_id);
  if not found then
    raise exception 'TAKEOFF_PLAN_LOCATION_SOURCE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_carry_from_id is not null then
    select * into origin from public.takeoff_plan_locations l
    where l.id = p_carry_from_id and l.tenant_id = p_tenant_id and l.project_id = p_project_id;
    if not found or origin.revision <> p_carry_from_revision then
      raise exception 'TAKEOFF_PLAN_LOCATION_ORIGIN_MOVED' using errcode = '40001';
    end if;
    if (origin.source_kind, origin.source_id, origin.content_hash) = (source.source_kind, source.source_id, p_content_hash) then
      raise exception 'TAKEOFF_PLAN_LOCATION_CARRY_OVER_INVALID' using errcode = '22023';
    end if;
  end if;
  -- What can no longer serve leaves: this member's used and expired attestations on this affaire.
  delete from private.takeoff_plan_location_attestations a
  where a.tenant_id = p_tenant_id and a.project_id = p_project_id and a.actor_id = p_actor_id
    and (a.used_at is not null or a.created_at < pg_catalog.clock_timestamp() - interval '15 minutes');
  insert into private.takeoff_plan_location_attestations (tenant_id, project_id, plan_file_id, source_kind, source_id,
    content_hash, document_name, actor_id, carry_from_id, carry_from_revision, carry_building, carry_level)
  values (p_tenant_id, p_project_id, p_plan_file_id, source.source_kind, source.source_id, p_content_hash, p_document_name,
    p_actor_id, p_carry_from_id, p_carry_from_revision,
    case when origin.building_choice = 'value' then origin.building end,
    case when origin.level_choice = 'value' then origin.level end)
  returning id into attested;
  return attested;
end;
$$;
revoke all on function public.attest_takeoff_plan_revision(uuid, uuid, uuid, uuid, text, text, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.attest_takeoff_plan_revision(uuid, uuid, uuid, uuid, text, text, uuid, integer)
  to service_role;

-- The only writer for members, under their session. It consumes one attestation of this member (fifteen minutes at
-- most, by the wall clock when it is consumed) and checks the member may write the affaire, then takes, in this order:
-- the affaire (key share: its deletion locks it first, then cascades to its plan files, annotations and attestations),
-- where the right to write is checked again, the attestation, the plan file of that affaire, its dossier piece, the
-- carried origin, the annotation row. The generation the member saw is compared under the annotation's row lock; a
-- carried field must hold the origin's value at the generation the server proposed, and no field carried, no origin.
create function public.set_takeoff_plan_location(
  p_attestation_id uuid,
  p_expected_revision integer,
  p_building_choice text,
  p_building text,
  p_level_choice text,
  p_level text,
  p_carried_fields text[] default '{}'::text[]
) returns public.takeoff_plan_locations
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  tenant uuid := (select public.current_tenant_id());
  attestation private.takeoff_plan_location_attestations%rowtype;
  source record;
  origin public.takeoff_plan_locations%rowtype;
  existing public.takeoff_plan_locations%rowtype;
  saved public.takeoff_plan_locations%rowtype;
  intake_document text;
  carry_building boolean := 'building' = any(coalesce(p_carried_fields, '{}'::text[]));
  carry_level boolean := 'level' = any(coalesce(p_carried_fields, '{}'::text[]));
  building_changed boolean;
  level_changed boolean;
begin
  if actor is null or tenant is null then
    raise exception 'TAKEOFF_PLAN_LOCATION_FORBIDDEN' using errcode = '42501';
  end if;
  select * into attestation from private.takeoff_plan_location_attestations a
  where a.id = p_attestation_id and a.tenant_id = tenant and a.actor_id = actor;
  if not found or attestation.used_at is not null
    or attestation.created_at < pg_catalog.clock_timestamp() - interval '15 minutes' then
    raise exception 'TAKEOFF_PLAN_LOCATION_NOT_ATTESTED' using errcode = '42501';
  end if;
  if not private.can_access_takeoff_scope(tenant, attestation.project_id, null, true) then
    raise exception 'TAKEOFF_PLAN_LOCATION_FORBIDDEN' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 0
    or p_building_choice is null or p_building_choice not in ('reading', 'value', 'unknown')
    or p_level_choice is null or p_level_choice not in ('reading', 'value', 'unknown')
    or (p_building_choice = 'value') <> (p_building is not null) or (p_level_choice = 'value') <> (p_level is not null)
    or (p_building is not null and (p_building <> btrim(p_building) or char_length(p_building) not between 1 and 40
      or p_building ~ '[[:cntrl:]]'))
    or (p_level is not null and (p_level <> btrim(p_level) or char_length(p_level) not between 1 and 40
      or p_level ~ '[[:cntrl:]]'))
    or exists (select 1 from unnest(coalesce(p_carried_fields, '{}'::text[])) field where field not in ('building', 'level')) then
    raise exception 'TAKEOFF_PLAN_LOCATION_VALUE_INVALID' using errcode = '22023';
  end if;

  -- The affaire first: its deletion locks it, then cascades to its plan files, annotations and attestations.
  perform 1 from public.estimate_projects p where p.id = attestation.project_id and p.tenant_id = tenant for key share;
  if not found then
    raise exception 'TAKEOFF_PLAN_LOCATION_SOURCE_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- The right to write, again on the row as it is now: an archive may have committed while this save waited for it.
  if not private.can_access_takeoff_scope(tenant, attestation.project_id, null, true) then
    raise exception 'TAKEOFF_PLAN_LOCATION_FORBIDDEN' using errcode = '42501';
  end if;
  -- Then the attestation, used once: a second save on it waits here and finds it used.
  select * into attestation from private.takeoff_plan_location_attestations a where a.id = attestation.id for update;
  if not found or attestation.used_at is not null then
    raise exception 'TAKEOFF_PLAN_LOCATION_NOT_ATTESTED' using errcode = '42501';
  end if;
  -- Then the copy, of this affaire only, then its dossier piece: the order of the copy cleanup.
  select f.metadata ->> 'intake_document_id' into intake_document
  from public.plan_files f
  join public.plan_sets s on s.id = f.plan_set_id and s.tenant_id = f.tenant_id
  where f.id = attestation.plan_file_id and f.tenant_id = tenant and s.project_id = attestation.project_id
  for share of f;
  if intake_document ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    perform 1 from public.affaire_intake_documents d
    where d.id = intake_document::uuid and d.tenant_id = tenant and d.project_id = attestation.project_id for share;
  end if;
  select * into source from private.resolve_takeoff_plan_location_source(tenant, attestation.project_id, attestation.plan_file_id);
  if not found then
    raise exception 'TAKEOFF_PLAN_LOCATION_SOURCE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not source.current_copy or (source.source_kind, source.source_id) is distinct from (attestation.source_kind, attestation.source_id) then
    raise exception 'TAKEOFF_PLAN_LOCATION_SOURCE_STALE' using errcode = '40001';
  end if;

  if carry_building or carry_level then
    if attestation.carry_from_id is null then
      raise exception 'TAKEOFF_PLAN_LOCATION_CARRY_OVER_INVALID' using errcode = '22023';
    end if;
    select * into origin from public.takeoff_plan_locations l
    where l.id = attestation.carry_from_id and l.tenant_id = tenant and l.project_id = attestation.project_id
    for share;
    if not found or origin.revision <> attestation.carry_from_revision then
      raise exception 'TAKEOFF_PLAN_LOCATION_ORIGIN_MOVED' using errcode = '40001';
    end if;
    if (carry_building and (p_building_choice <> 'value' or origin.building_choice <> 'value' or p_building is distinct from origin.building))
      or (carry_level and (p_level_choice <> 'value' or origin.level_choice <> 'value' or p_level is distinct from origin.level)) then
      raise exception 'TAKEOFF_PLAN_LOCATION_CARRY_OVER_INVALID' using errcode = '22023';
    end if;
  end if;

  select * into existing from public.takeoff_plan_locations l
  where l.tenant_id = tenant and l.project_id = attestation.project_id and l.source_kind = attestation.source_kind
    and l.source_id = attestation.source_id and l.content_hash = attestation.content_hash
  for update;
  -- Consumed now, after every wait: its fifteen minutes are measured by the wall clock, not from this transaction's start.
  if attestation.created_at < pg_catalog.clock_timestamp() - interval '15 minutes' then
    raise exception 'TAKEOFF_PLAN_LOCATION_NOT_ATTESTED' using errcode = '42501';
  end if;
  update private.takeoff_plan_location_attestations set used_at = pg_catalog.clock_timestamp() where id = attestation.id;

  if existing.id is null then
    if p_expected_revision <> 0 then
      raise exception 'TAKEOFF_PLAN_LOCATION_CONFLICT' using errcode = '40001';
    end if;
    insert into public.takeoff_plan_locations (tenant_id, project_id, source_kind, source_id, content_hash, revision,
      building_choice, building, building_carried, building_set_by, building_set_at, building_set_revision,
      level_choice, level, level_carried, level_set_by, level_set_at, level_set_revision,
      plan_file_id, document_name, carried_from_id, carried_from_revision, created_by, updated_by)
    values (tenant, attestation.project_id, attestation.source_kind, attestation.source_id, attestation.content_hash, 1,
      p_building_choice, p_building, carry_building, actor, now(), 1,
      p_level_choice, p_level, carry_level, actor, now(), 1,
      attestation.plan_file_id, attestation.document_name,
      case when carry_building or carry_level then attestation.carry_from_id end,
      case when carry_building or carry_level then attestation.carry_from_revision end, actor, actor)
    on conflict on constraint takeoff_plan_locations_revision_key do nothing
    returning * into saved;
    -- Another operator created this revision's annotation first: theirs stands.
    if saved.id is null then
      raise exception 'TAKEOFF_PLAN_LOCATION_CONFLICT' using errcode = '40001';
    end if;
    insert into public.takeoff_plan_location_events (tenant_id, project_id, location_id, revision, action, attestation_id,
      building_choice, building, building_carried, level_choice, level, level_carried,
      plan_file_id, carried_from_id, carried_from_revision, actor_id)
    values (tenant, attestation.project_id, saved.id, 1, 'created', attestation.id,
      saved.building_choice, saved.building, saved.building_carried, saved.level_choice, saved.level, saved.level_carried,
      saved.plan_file_id, saved.carried_from_id, saved.carried_from_revision, actor);
    return saved;
  end if;

  if existing.revision <> p_expected_revision then
    raise exception 'TAKEOFF_PLAN_LOCATION_CONFLICT' using errcode = '40001';
  end if;
  building_changed := existing.building_choice is distinct from p_building_choice or existing.building is distinct from p_building
    or (carry_building and not existing.building_carried);
  level_changed := existing.level_choice is distinct from p_level_choice or existing.level is distinct from p_level
    or (carry_level and not existing.level_carried);
  -- Saving the same choices again changes nothing and records nothing.
  if not building_changed and not level_changed then
    return existing;
  end if;
  update public.takeoff_plan_locations l set revision = l.revision + 1,
    building_choice = p_building_choice, building = p_building,
    building_carried = case when building_changed then carry_building else l.building_carried end,
    building_set_by = case when building_changed then actor else l.building_set_by end,
    building_set_at = case when building_changed then now() else l.building_set_at end,
    building_set_revision = case when building_changed then l.revision + 1 else l.building_set_revision end,
    level_choice = p_level_choice, level = p_level,
    level_carried = case when level_changed then carry_level else l.level_carried end,
    level_set_by = case when level_changed then actor else l.level_set_by end,
    level_set_at = case when level_changed then now() else l.level_set_at end,
    level_set_revision = case when level_changed then l.revision + 1 else l.level_set_revision end,
    plan_file_id = attestation.plan_file_id, document_name = attestation.document_name,
    -- The origin of the fields carried after this save: this save's, else the one a field still carries, else none.
    carried_from_id = case when carry_building or carry_level then attestation.carry_from_id
      when (case when building_changed then false else l.building_carried end)
        or (case when level_changed then false else l.level_carried end) then l.carried_from_id end,
    carried_from_revision = case when carry_building or carry_level then attestation.carry_from_revision
      when (case when building_changed then false else l.building_carried end)
        or (case when level_changed then false else l.level_carried end) then l.carried_from_revision end,
    updated_by = actor, updated_at = now()
  where l.id = existing.id
  returning * into saved;
  insert into public.takeoff_plan_location_events (tenant_id, project_id, location_id, revision, action, attestation_id,
    building_choice_before, building_before, building_choice, building, building_carried,
    level_choice_before, level_before, level_choice, level, level_carried,
    plan_file_id, carried_from_id, carried_from_revision, actor_id)
  values (tenant, attestation.project_id, saved.id, saved.revision, 'updated', attestation.id,
    existing.building_choice, existing.building, saved.building_choice, saved.building, saved.building_carried,
    existing.level_choice, existing.level, saved.level_choice, saved.level, saved.level_carried,
    saved.plan_file_id, saved.carried_from_id, saved.carried_from_revision, actor);
  return saved;
end;
$$;
revoke all on function public.set_takeoff_plan_location(uuid, integer, text, text, text, text, text[])
  from public, anon, service_role;
grant execute on function public.set_takeoff_plan_location(uuid, integer, text, text, text, text, text[])
  to authenticated;

commit;
