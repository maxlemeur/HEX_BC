-- Lot 3, migration C: the send of one plan while the affaire's other plans are read. A reviewed analysis of one plan (a
-- unit of a request of format 2, 20261121231238) can be sent to the estimate table as soon as its impact is validated:
-- its controls are evaluated against the destination and against the readable analyses of the affaire's other plans,
-- and the send is refused when what they read changed after the preview.
--
-- What changes, and for whom:
-- - The context of a send (private.takeoff_send_context): besides the takeoff and its destination (lot 2's stamps), the
--   affaire's other plans already read (for each plan its latest successful reading of the dossier's current copy, not
--   yet sent, with the state of its lines) and, for each plan revision the controls read, the operator's location
--   (migration B) and whether it is still the dossier's current copy of its source. It is computed here only: the
--   application reads it (public.read_takeoff_send_context, service role) and stages its two stamps; the send computes it
--   again inside its transaction, under the locks it already takes, and refuses on any difference
--   (TAKEOFF_SEND_PREVIEW_STALE, « peers_changed » or « location_changed »).
-- - The send of a per-plan analysis opens for a command that names that context; the closure #448 put on the version
--   link (aa0_guard_takeoff_plan_unit_send) now admits the link only from the send that checked it, in its transaction.
-- - The receipt's write plan records the context the send checked: the request and unit of a per-plan analysis, each
--   peer with the stamp of its lines, and each plan revision with its location and copy.
-- - What remains between the send's own reading of its context and its commit (a writer that commits in between: a
--   location saved, a peer's line edited, a peer read again, a dossier piece replaced) is not locked but detected:
--   public.read_takeoff_send_drift compares a sent plan's receipt with the current state, when its lines are read, and
--   names what changed since the send. No writer pays anything for it.
--
-- The previous application version (v0.7.0 and main before this migration) never stages a context: its sends of grouped
-- and standalone analyses are checked exactly as before (no context, no new refusal), and a per-plan analysis, which its
-- server never offers to send, stays refused with TAKEOFF_SEND_JOB_NOT_READY. Its writes are neither refused nor
-- changed, and no trigger is added to what they write. What they may meet: a manual launch command (one database function
-- for both versions) takes the affaire, shared, first, so it waits for a send or a first draft's preview of that affaire
-- in flight (an admitted command already waited for it later, at its jobs' checks).
-- Created: one private table, seven functions; replaced: the send (private.takeoff_send_execute, rebuilt on
-- 20261121193413's body), the closure's trigger function, and the manual command (private.launch_manual_takeoff_command,
-- rebuilt on 20261121231238's body: it takes the affaire, shared, before the analysis it replaces, its key and its
-- automatic request). No row is written; no backfill.
--
-- Locks: every table lock this migration needs (the check table's foreign keys: the estimate versions, then the takeoff
-- jobs, the order of their writers) is taken first, at once, without waiting (nowait): a busy table refuses the migration
-- at once with nothing applied (55P03, run it again), and the migration never waits while it holds a lock, so it never
-- stalls or deadlocks a writer. They are held until the commit, for the DDL only. Nothing needs to be drained.
-- Requires 20261121040445 (plan locations), 20261121193413 (the send's body rebuilt here) and 20261121231238 (the closure,
-- the manual command).
begin;

set local lock_timeout = '5s';
set local check_function_bodies = off;

lock table public.estimate_versions, public.takeoff_jobs in share row exclusive mode nowait;

-- A per-plan analysis: a unit of a request of format 2 (the test #448's closure used).
create function private.takeoff_job_is_plan_unit(p_launch_request_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select p_launch_request_id is not null and exists (select 1 from public.takeoff_launch_requests as r
    where r.id = p_launch_request_id and r.manifest -> 'format_version' = '2'::jsonb)
$$;
revoke all on function private.takeoff_job_is_plan_unit(uuid) from public, anon, authenticated, service_role;

-- 1. What a send's controls read besides the takeoff itself and the destination's own state (lot 2's job, peers and
-- mapping stamps):
-- - peers: for a per-plan analysis, the readable analyses of the affaire's other plans. A plan is its source (its dossier
--   piece, or the plan file itself: two working copies of one piece are one plan, takeoff_plan_location_sources); for each
--   other plan, its latest successful reading, in any request of one analysis per plan (automatic or manual), when it is
--   not sent yet (completed, without a version) and read the dossier's current copy of its source, with the state of its
--   lines (public.takeoff_rule_job_stamp). A reading replaced is never a peer: neither an earlier reading of this
--   analysis's own plan, nor one of another plan whose later reading succeeded (sent or not), nor one of a copy the
--   dossier has replaced or set aside since. A plan whose latest
--   reading was sent has no peer: its lines are the destination's when it is that version, another estimate's otherwise.
--   A grouped or standalone analysis is no peer, and has none (lot 2: the destination only); the preview names those
--   not compared.
-- - plans: each plan revision the controls read — of this takeoff, of its peers, and of the destination's takeoffs
--   (attached to it, or carried over to it by a copy) — as their preparation attested it (plan file, digest of its bytes),
--   with the operator's location of that revision (migration B; null when none was saved) and whether its plan file is
--   still the dossier's current copy of its source (a piece replaced, set aside or reserved for deletion is not).
-- Computed by this database only, for the preview and again by the send under its locks. Ordered, so that its text is
-- its identity.
create function private.takeoff_send_revision_state(p_tenant uuid, p_project uuid, p_file_id uuid, p_content_hash text)
returns jsonb language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'location', (select pg_catalog.jsonb_build_object('id', location.id, 'revision', location.revision,
        'building_choice', location.building_choice, 'building', location.building,
        'level_choice', location.level_choice, 'level', location.level)
      from public.takeoff_plan_locations as location
      left join public.takeoff_plan_location_sources as recorded on recorded.plan_file_id = p_file_id
        and recorded.tenant_id = p_tenant
      where location.tenant_id = p_tenant and location.project_id = p_project
        and location.content_hash = p_content_hash
        and location.source_kind = coalesce(recorded.source_kind, 'plan_file')
        and location.source_id = coalesce(recorded.source_id, p_file_id)),
    'current_copy', exists (select 1 from private.resolve_takeoff_plan_location_source(p_tenant, p_project, p_file_id) as resolved
      where resolved.current_copy))
$$;
revoke all on function private.takeoff_send_revision_state(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;

create function private.takeoff_send_context(p_tenant uuid, p_project uuid, p_job uuid, p_version uuid)
returns jsonb language sql stable set search_path = '' as $$
  with readings as (
    select candidate.id, candidate.status, candidate.estimate_version_id, candidate.created_at, plan.file_id,
      coalesce(recorded.source_kind, 'plan_file') as source_kind, coalesce(recorded.source_id, plan.file_id) as source_id
    from public.takeoff_jobs as candidate
    join public.takeoff_launch_requests as request on request.id = candidate.launch_request_id
      and request.tenant_id = candidate.tenant_id and request.manifest -> 'format_version' = '2'::jsonb
    cross join lateral (
      select private.takeoff_uuid_or_null(source.value -> 'document_id') as file_id
      from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(candidate.preparation_snapshot #> '{preparation,sources}')
          = 'array' then candidate.preparation_snapshot #> '{preparation,sources}' else '[]'::jsonb end) as source(value)
      where source.value ->> 'kind' = 'plan' and source.value -> 'active' = 'true'::jsonb
      limit 1) as plan
    left join public.takeoff_plan_location_sources as recorded on recorded.plan_file_id = plan.file_id
      and recorded.tenant_id = candidate.tenant_id
    where candidate.tenant_id = p_tenant and candidate.project_id = p_project and plan.file_id is not null
  ), own as (
    select readings.* from readings where readings.id = p_job
  ), latest as (
    select distinct on (other.source_kind, other.source_id) other.id, other.estimate_version_id, other.file_id
    from readings as other cross join own
    where other.id <> own.id
      and other.status in ('completed'::public.takeoff_job_status, 'applied'::public.takeoff_job_status)
      and (other.source_kind, other.source_id) is distinct from (own.source_kind, own.source_id)
    order by other.source_kind, other.source_id, other.created_at desc, other.id desc
  ), peers as (
    -- A plan whose latest reading was sent has no peer here: an earlier reading it replaced is never compared. Nor does a
    -- plan whose latest reading read a copy that is no longer the dossier's current copy of its source (a plan replaced,
    -- or set aside, since), as the dossier holds it now (not a preparation, which an automatic request may not have and an
    -- edit clears).
    select latest.id from latest where latest.estimate_version_id is null
      and exists (select 1 from private.resolve_takeoff_plan_location_source(p_tenant, p_project, latest.file_id) as resolved
        where resolved.current_copy)
  ), evaluated as (
    select p_job as id
    union select peers.id from peers
    union select attached.id from public.takeoff_jobs as attached
      where p_version is not null and attached.tenant_id = p_tenant and attached.estimate_version_id = p_version
        and attached.status in ('completed'::public.takeoff_job_status, 'applied'::public.takeoff_job_status)
    union select link.takeoff_job_id from public.takeoff_version_links as link
      where p_version is not null and link.tenant_id = p_tenant and link.target_version_id = p_version
  ), revisions as (
    select distinct evaluated.id as job_id, private.takeoff_uuid_or_null(source.value -> 'document_id') as file_id,
      source.value ->> 'content_hash' as content_hash
    from evaluated
    join public.takeoff_jobs as job on job.id = evaluated.id and job.tenant_id = p_tenant
    cross join lateral pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(job.preparation_snapshot #> '{preparation,sources}')
        = 'array' then job.preparation_snapshot #> '{preparation,sources}' else '[]'::jsonb end) as source(value)
    where source.value ->> 'kind' = 'plan' and source.value -> 'active' = 'true'::jsonb
      and coalesce(source.value ->> 'content_hash', '') ~ '^[0-9a-f]{64}$'
  )
  select pg_catalog.jsonb_build_object(
    'peers', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('job_id', peers.id,
        'stamp', public.takeoff_rule_job_stamp(p_tenant, p_project, peers.id)) order by peers.id) from peers), '[]'::jsonb),
    'plans', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('job_id', revision.job_id,
        'plan_file_id', revision.file_id, 'content_hash', revision.content_hash)
        || private.takeoff_send_revision_state(p_tenant, p_project, revision.file_id, revision.content_hash)
      order by revision.job_id, revision.file_id, revision.content_hash) from revisions as revision), '[]'::jsonb))
$$;
revoke all on function private.takeoff_send_context(uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- Its two stamps: the peers (a plan read, or its lines changed, since the preview) and the plans with their locations and
-- copies.
create function private.takeoff_send_context_stamps(p_context jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select pg_catalog.jsonb_build_object('peers', pg_catalog.md5((p_context -> 'peers')::text),
    'locations', pg_catalog.md5((p_context -> 'plans')::text))
$$;
revoke all on function private.takeoff_send_context_stamps(jsonb) from public, anon, authenticated, service_role;

-- The name of the plan an analysis of one plan read, as its preparation attested it.
create function private.takeoff_send_plan_name(p_snapshot jsonb)
returns text language sql immutable set search_path = '' as $$
  select source.value ->> 'document_name'
  from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_snapshot #> '{preparation,sources}') = 'array'
    then p_snapshot #> '{preparation,sources}' else '[]'::jsonb end) as source(value)
  where source.value ->> 'kind' = 'plan' and source.value -> 'active' = 'true'::jsonb
  limit 1
$$;
revoke all on function private.takeoff_send_plan_name(jsonb) from public, anon, authenticated, service_role;

-- What the application's preview reads (service role): the context, the stamps it stages with its command, and what the
-- preview shows of it, outside the stamps (a plan's progress, a heartbeat or a name never makes a preview stale). For an
-- analysis of one plan: its request; its plan's name; each peer compared, with its plan's name, when it was read and
-- whether that reading is this plan's request's, or another request's read before or after this plan; the other units of
-- its request not read yet, each in its state as private.takeoff_unit_state decides it, and, for one whose plan has an
-- earlier reading compared, that reading; the affaire's plans as its dossier holds them now (each plan file that is the
-- current copy of its source, one per source, as the peers are chosen) that no analysis of one plan has read at that copy
-- (outside this request); and how many grouped analyses (lot 2) and analyses outside any request are read and not sent,
-- which nothing compares with it. The destination version is the draft it would write, or the issued
-- version a copy would start from; null for a first draft.
create function public.read_takeoff_send_context(p_tenant_id uuid, p_project_id uuid, p_job_id uuid, p_version_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with job as (
    select candidate.* from public.takeoff_jobs as candidate
    where candidate.id = p_job_id and candidate.tenant_id = p_tenant_id and candidate.project_id = p_project_id
  ), computed as (
    select private.takeoff_send_context(p_tenant_id, p_project_id, p_job_id, p_version_id) as context
  ), plan_readings as (
    -- Each analysis of one plan of the affaire: its request, its state, the plan file it read, that file's source, and
    -- whether that file is still the dossier's current copy of its source.
    select reading.id, reading.launch_request_id, reading.status, reading.analysis_outcome, reading.error_code, reading.started_at,
      reading.completed_at, reading.preparation_snapshot, plan.file_id,
      coalesce(recorded.source_kind, 'plan_file') as source_kind, coalesce(recorded.source_id, plan.file_id) as source_id,
      exists (select 1 from private.resolve_takeoff_plan_location_source(p_tenant_id, p_project_id, plan.file_id) as resolved
        where resolved.current_copy) as current_copy
    from public.takeoff_jobs as reading
    cross join lateral (select private.takeoff_uuid_or_null(pg_catalog.to_jsonb(pg_catalog.substr(reading.launch_unit_key, 6)))
      as file_id) as plan
    left join public.takeoff_plan_location_sources as recorded on recorded.plan_file_id = plan.file_id
      and recorded.tenant_id = p_tenant_id
    where reading.tenant_id = p_tenant_id and reading.project_id = p_project_id and reading.launch_unit_key like 'plan:%'
      and private.takeoff_job_is_plan_unit(reading.launch_request_id) and plan.file_id is not null
  ), compared as (
    select reading.* from plan_readings as reading
    where reading.id in (select (listed.value ->> 'job_id')::uuid
      from computed cross join lateral pg_catalog.jsonb_array_elements(computed.context -> 'peers') as listed(value))
  ), dossier_plans as (
    -- The affaire's plans as its dossier holds them now: each plan file of its plan sets that is the current copy of its
    -- source (its dossier piece, or the file itself), one per source. Never a manifest or a preparation, which may still
    -- name a copy the dossier has replaced.
    select distinct on (resolved.source_kind, resolved.source_id) plan_file.id as file_id, plan_file.file_name as name,
      resolved.source_kind, resolved.source_id
    from public.plan_files as plan_file
    join public.plan_sets as plan_set on plan_set.id = plan_file.plan_set_id and plan_set.tenant_id = p_tenant_id
      and plan_set.project_id = p_project_id
    cross join lateral private.resolve_takeoff_plan_location_source(p_tenant_id, p_project_id, plan_file.id) as resolved
    where plan_file.tenant_id = p_tenant_id and resolved.current_copy
    order by resolved.source_kind, resolved.source_id, plan_file.created_at desc, plan_file.id
  )
  select computed.context || pg_catalog.jsonb_build_object('stamps', private.takeoff_send_context_stamps(computed.context),
    'display', case when private.takeoff_job_is_plan_unit(job.launch_request_id) then pg_catalog.jsonb_build_object(
      'request_id', job.launch_request_id,
      'plan_name', private.takeoff_send_plan_name(job.preparation_snapshot),
      'peers', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('job_id', peer.id,
          'plan_name', private.takeoff_send_plan_name(peer.preparation_snapshot), 'read_at', peer.completed_at,
          -- By when it was read, not by the request's identity: a later request's reading is never « précédente ».
          'request', case when peer.launch_request_id is not distinct from job.launch_request_id then 'same'
            when peer.completed_at < job.completed_at then 'earlier' else 'later' end)
          order by peer.completed_at, peer.id) from compared as peer), '[]'::jsonb),
      'unread', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('plan_name',
          private.takeoff_send_plan_name(sibling.preparation_snapshot),
          'state', private.takeoff_unit_state(sibling.status::text, sibling.analysis_outcome, sibling.error_code, sibling.started_at),
          'compared_reading_at', (select peer.completed_at from compared as peer
            where (peer.source_kind, peer.source_id) = (sibling.source_kind, sibling.source_id)))
          order by (sibling.preparation_snapshot #>> '{launch_unit,ordinal}')::integer, sibling.id)
        from plan_readings as sibling
        where sibling.launch_request_id = job.launch_request_id and sibling.id <> job.id
          and private.takeoff_unit_state(sibling.status::text, sibling.analysis_outcome, sibling.error_code, sibling.started_at)
            <> 'succeeded'), '[]'::jsonb),
      'never_read', coalesce((select pg_catalog.jsonb_agg(dossier_plan.name order by dossier_plan.name, dossier_plan.file_id)
        from dossier_plans as dossier_plan
        where not exists (select 1 from plan_readings as unit
            where unit.launch_request_id = job.launch_request_id
              and (unit.source_kind, unit.source_id) = (dossier_plan.source_kind, dossier_plan.source_id))
          and not exists (select 1 from plan_readings as read
            where read.status in ('completed'::public.takeoff_job_status, 'applied'::public.takeoff_job_status) and read.current_copy
              and (read.source_kind, read.source_id) = (dossier_plan.source_kind, dossier_plan.source_id))), '[]'::jsonb),
      'uncompared', pg_catalog.jsonb_build_object(
        'grouped', (select pg_catalog.count(*) from public.takeoff_jobs as other
          where other.tenant_id = p_tenant_id and other.project_id = p_project_id and other.estimate_version_id is null
            and other.status = 'completed'::public.takeoff_job_status and other.launch_request_id is not null
            and not private.takeoff_job_is_plan_unit(other.launch_request_id)),
        'outside_request', (select pg_catalog.count(*) from public.takeoff_jobs as other
          where other.tenant_id = p_tenant_id and other.project_id = p_project_id and other.estimate_version_id is null
            and other.status = 'completed'::public.takeoff_job_status and other.launch_request_id is null))) end)
  from job cross join computed
$$;
revoke all on function public.read_takeoff_send_context(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.read_takeoff_send_context(uuid, uuid, uuid, uuid) to service_role;

-- 2. The closure of 20261121231238, replaced: a per-plan analysis is linked to a version only by the send that checked its
-- context, in that send's transaction (its row in private.takeoff_plan_send_checks). Any other writer — a direct update,
-- the previous application's send, a send that named no context — is refused as before.
create or replace function private.guard_takeoff_plan_unit_send()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.takeoff_job_is_plan_unit(new.launch_request_id) and not exists (
      select 1 from private.takeoff_plan_send_checks as checked
      where checked.job_id = new.id and checked.version_id = new.estimate_version_id
        and checked.xact = pg_catalog.pg_current_xact_id()) then
    raise exception 'TAKEOFF_SEND_JOB_NOT_READY' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', 'plan_context_unchecked')::text;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_takeoff_plan_unit_send() from public, anon, authenticated, service_role;

-- 3. The send, as 20261121193413 wrote it, with the context: a command that names it is compared with it under the locks
-- (any analysis); a per-plan analysis needs one; the link of a per-plan analysis goes through its check; the receipt's
-- write plan records what was checked. One lock is added, after the job: a per-plan analysis's request. The context
-- reads rows, it locks none: a writer of what it reads (a location, a peer's lines or end, a dossier piece) is not
-- serialised with the send; one that committed before the send read it refuses the send, one that commits after is
-- named by public.read_takeoff_send_drift.
create or replace function private.takeoff_send_execute(p_actor uuid, p_tenant uuid, p_role public.tenant_role, p_request uuid,
  p_command jsonb, p_dry_run boolean)
returns jsonb
language plpgsql set search_path = '' as $$
declare
  kind text := p_command #>> '{destination,kind}';
  target_job_id uuid := (p_command ->> 'job_id')::uuid;
  job public.takeoff_jobs%rowtype;
  project public.estimate_projects%rowtype;
  existing public.takeoff_send_receipts%rowtype;
  target_version uuid;
  source_version uuid;
  target_engine smallint;
  version_created boolean := false;
  created_lock uuid;
  section_id uuid;
  section_created boolean := false;
  section_position integer;
  current_versions jsonb;
  stale_reason text;
  created jsonb;
  applied record;
  links jsonb;
  created_ids uuid[];
  accumulated uuid[] := '{}'::uuid[];
  removed uuid[] := '{}'::uuid[];
  entry record;
  rules_written integer;
  previous_writer text;
  outcome jsonb;
  result jsonb;
  plan jsonb;
  mapped jsonb;
  plan_unit boolean;
  context jsonb;
  context_stamps jsonb;
begin
  select * into job from public.takeoff_jobs as candidate where candidate.id = target_job_id;
  if not found or job.tenant_id is distinct from p_tenant then
    raise exception 'TAKEOFF_JOB_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('estimate-calc-policy:' || p_tenant::text, 0));
  if p_dry_run and kind = 'existing_draft' then
    select * into project from public.estimate_projects as row_project
    where row_project.id = job.project_id and row_project.tenant_id = p_tenant
    for share;
  else
    select * into project from public.estimate_projects as row_project
    where row_project.id = job.project_id and row_project.tenant_id = p_tenant
    for no key update;
  end if;
  if project.id is null or project.is_archived
    or (p_role <> 'admin'::public.tenant_role and project.user_id is distinct from p_actor) then
    raise exception 'TAKEOFF_SEND_PROJECT_NOT_WRITABLE' using errcode = '42501';
  end if;
  -- The affaire held, a command of this request that committed meanwhile is visible now (two sends of one affaire wait
  -- for each other on its row).
  if not p_dry_run then
    select * into existing from public.takeoff_send_receipts as stored
    where stored.tenant_id = p_tenant and stored.request_id = p_request;
    if found then
      return pg_catalog.jsonb_build_object('replay', existing.id);
    end if;
  end if;
  -- The affaire's versions, compared as soon as its row is held and before any other wait: a command read before a version
  -- was created or changed status (a first draft on an affaire that has one) is refused at once, and holds the affaire no
  -- longer than that, so that the saves of that version's editor are not refused meanwhile. Their dates are compared again
  -- once every lock is held, below.
  if (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', version.id, 'status', version.status)
        order by version.id::text), '[]'::jsonb)
      from public.estimate_versions as version where version.project_id = job.project_id and version.tenant_id = p_tenant)
    is distinct from (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', expected.value -> 'id',
        'status', expected.value -> 'status') order by expected.value ->> 'id'), '[]'::jsonb)
      from pg_catalog.jsonb_array_elements(p_command #> '{expected,versions}') as expected(value)) then
    raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', 'destination_changed')::text;
  end if;
  if kind = 'existing_draft' then
    target_version := (p_command #>> '{destination,version_id}')::uuid;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-rules:' || target_version::text, 0));
    -- The editor's lock, in the editor's order: its lease acquisition takes this key, then the version's row through the
    -- lease's foreign key (public.assign_draft_lock_tenant_id).
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_version::text, 0));
    if p_dry_run then
      -- As the editor's acquisition does first, expired leases go (here with the preview's rollback). A member who
      -- edits the draft refuses the preview before it takes anything their saves need.
      delete from public.draft_locks as expired
      where expired.version_id = target_version and expired.tenant_id = p_tenant
        and expired.expires_at <= pg_catalog.statement_timestamp();
      if exists (select 1 from public.draft_locks as lock_row where lock_row.version_id = target_version
        and lock_row.user_id <> p_actor and lock_row.expires_at > pg_catalog.statement_timestamp()) then
        raise exception 'TAKEOFF_SEND_DRAFT_LOCKED' using errcode = '55P03';
      end if;
    end if;
    select version.calc_engine_version into target_engine from public.estimate_versions as version
    where version.id = target_version and version.tenant_id = p_tenant and version.project_id = job.project_id
      and version.status = 'draft'::public.estimate_status
    for no key update;
    if not found then
      raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'destination_changed')::text;
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-job-rules:' || target_job_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-job:' || target_job_id::text, 0));
  select * into job from public.takeoff_jobs as candidate where candidate.id = target_job_id for update;
  if job.estimate_version_id is not null or job.status is distinct from 'completed'::public.takeoff_job_status then
    if exists (select 1 from public.takeoff_send_receipts as stored
      where stored.job_id = target_job_id and stored.command_kind = 'send') then
      raise exception 'TAKEOFF_SEND_ALREADY_SENT' using errcode = '40001';
    end if;
    raise exception 'TAKEOFF_SEND_JOB_NOT_READY' using errcode = '40001';
  end if;
  -- A per-plan analysis is sent only by a command that names its context (the previous application's server names none:
  -- for it, the send stays closed as 20261121231238 closed it). A context named must have its shape.
  plan_unit := private.takeoff_job_is_plan_unit(job.launch_request_id);
  if p_command #> '{expected,context}' is not null and (pg_catalog.jsonb_typeof(p_command #> '{expected,context}') <> 'object'
      or pg_catalog.jsonb_typeof(p_command #> '{expected,context,peers}') is distinct from 'string'
      or pg_catalog.jsonb_typeof(p_command #> '{expected,context,locations}') is distinct from 'string') then
    raise exception 'TAKEOFF_SEND_COMMAND_INVALID' using errcode = '22023';
  end if;
  if plan_unit and p_command #> '{expected,context}' is null then
    raise exception 'TAKEOFF_SEND_JOB_NOT_READY' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', 'plan_context_required')::text;
  end if;
  -- The send of an analysis of one plan (never its preview's dry run) holds its request's row after its job. Every writer
  -- of that row holds its job first (a unit's end settles there; a call's reservation and usage take their job, then the
  -- request; a member's stop takes the request's jobs, then the request): the same order, never the reverse. The link and
  -- the application below update this job twice, and the second update's foreign-key check takes a key share on the
  -- request's row: held here, a sibling's uncommitted end can no longer hold that check, and a sibling's end and this
  -- send never cross (the one that waits reads the other's result).
  if plan_unit and not p_dry_run then
    perform 1 from public.takeoff_launch_requests as request_row where request_row.id = job.launch_request_id
    for no key update;
  end if;
  -- The mapping rules the preview's plan comes from stay as they are until this transaction ends.
  perform 1 from public.takeoff_mapping_rules as rule where rule.tenant_id = p_tenant for share;

  -- What the preview evaluated, read again under the locks.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', version.id, 'status', version.status,
      'updated_at', version.updated_at) order by version.id), '[]'::jsonb)
    into current_versions
  from public.estimate_versions as version
  where version.project_id = job.project_id and version.tenant_id = p_tenant;
  -- The context, read again here, under the affaire's row and the takeoff's locks, for the destination named: its stamps
  -- are compared below with those the preview staged (a command that names none is compared as lot 2 compared it).
  if p_command #> '{expected,context}' is not null then
    context := private.takeoff_send_context(p_tenant, job.project_id, target_job_id,
      case kind when 'existing_draft' then (p_command #>> '{destination,version_id}')::uuid
        when 'version_copy' then (p_command #>> '{destination,source_version_id}')::uuid end);
    context_stamps := private.takeoff_send_context_stamps(context);
  end if;
  stale_reason := case
    when current_versions is distinct from p_command #> '{expected,versions}' then 'destination_changed'
    when kind = 'first_draft' and current_versions <> '[]'::jsonb then 'destination_changed'
    when public.takeoff_rule_job_stamp(p_tenant, job.project_id, target_job_id) is distinct from p_command #>> '{expected,job_stamp}'
      then 'takeoff_changed'
    when public.takeoff_mapping_rules_stamp(p_tenant) is distinct from p_command #>> '{expected,mapping_stamp}' then 'mapping_changed'
    when kind = 'existing_draft' and public.takeoff_send_peers_stamp(p_tenant, target_version)
      is distinct from p_command #>> '{expected,peers_stamp}' then 'estimate_changed'
    -- A copy is compared with the takeoffs of the version it copies (they become the copy's peers).
    when kind = 'version_copy' and public.takeoff_send_peers_stamp(p_tenant, (p_command #>> '{destination,source_version_id}')::uuid)
      is distinct from p_command #>> '{expected,peers_stamp}' then 'estimate_changed'
    -- Another plan of the affaire read (or its lines changed) since the preview: the controls compared with what it was.
    when context_stamps is not null and context_stamps ->> 'peers' is distinct from p_command #>> '{expected,context,peers}'
      then 'peers_changed'
    -- A location corrected since the preview, on a plan revision the controls read.
    when context_stamps is not null and context_stamps ->> 'locations' is distinct from p_command #>> '{expected,context,locations}'
      then 'location_changed'
  end;
  if stale_reason is not null then
    raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', stale_reason)::text;
  end if;

  if kind = 'first_draft' then
    section_id := (p_command #>> '{section,id}')::uuid;
    created := public.persist_estimate_creation_atomic(p_tenant, p_actor, job.project_id, null,
      p_command #> '{destination,version_payload}',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', section_id, 'parent_id', null, 'item_type', 'section',
        'position', 1, 'title', btrim(p_command #>> '{section,title}'))),
      null);
    target_version := (created #>> '{version,id}')::uuid;
    version_created := true;
    section_created := true;
  elsif kind = 'version_copy' then
    source_version := (p_command #>> '{destination,source_version_id}')::uuid;
    if not exists (select 1 from public.estimate_versions as version where version.id = source_version
      and version.tenant_id = p_tenant and version.project_id = job.project_id
      and version.status <> 'draft'::public.estimate_status) then
      raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'destination_changed')::text;
    end if;
    target_version := public.duplicate_estimate_version(source_version, false);
    version_created := true;
  end if;
  select version.calc_engine_version into target_engine from public.estimate_versions as version
  where version.id = target_version and version.tenant_id = p_tenant;

  -- A version that holds a DPGF line is sent through its reconciliation, which needs the job on the version first:
  -- refused before anything is attached (the preview names this blocker first and offers no confirmation).
  if exists (select 1 from public.estimate_items as item where item.version_id = target_version and item.tenant_id = p_tenant
    and item.item_type = 'line'::public.estimate_item_type and item.source_provider = 'dpgf') then
    raise exception 'TAKEOFF_SEND_DPGF_RECONCILIATION_REQUIRED' using errcode = '22023';
  end if;

  -- The section that receives the lines: created here for a new version or on request, else one of the draft's.
  if not section_created then
    section_id := (p_command #>> '{section,id}')::uuid;
    if (p_command #>> '{section,kind}') = 'new' then
      select coalesce(max(item.position), 0) + 1 into section_position from public.estimate_items as item
      where item.version_id = target_version and item.tenant_id = p_tenant and item.parent_id is null;
      previous_writer := coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true), '');
      if target_engine = 3 then
        perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', target_version::text, true);
      end if;
      insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title)
      values (section_id, p_tenant, target_version, null, 'section'::public.estimate_item_type, section_position,
        btrim(p_command #>> '{section,title}'));
      perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', previous_writer, true);
      section_created := true;
    elsif not exists (select 1 from public.estimate_items as item where item.id = section_id
      and item.version_id = target_version and item.tenant_id = p_tenant and item.item_type = 'section'::public.estimate_item_type) then
      raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'estimate_changed')::text;
    end if;
  end if;

  -- What the destination holds before the send, and a reference of each item that does not depend on this run: its id in
  -- an existing draft, the id of the item it copies in a copy (copies map by position, as duplicate_estimate_version
  -- maps them), « new » for the section this command creates. The outcome compares the dry run with the send by them.
  drop table if exists pg_temp._takeoff_send_refs;
  create temporary table _takeoff_send_refs (id uuid primary key, ref text not null) on commit drop;
  if kind = 'existing_draft' then
    insert into pg_temp._takeoff_send_refs (id, ref)
    select item.id, 'item:' || item.id::text from public.estimate_items as item
    where item.version_id = target_version and item.tenant_id = p_tenant;
  elsif kind = 'version_copy' then
    insert into pg_temp._takeoff_send_refs (id, ref)
    with recursive source_tree as (
      select item.id, array[item.position] as path from public.estimate_items as item
      where item.version_id = source_version and item.parent_id is null
      union all
      select child.id, parent.path || child.position from public.estimate_items as child
      join source_tree as parent on parent.id = child.parent_id where child.version_id = source_version
    ), copy_tree as (
      select item.id, array[item.position] as path from public.estimate_items as item
      where item.version_id = target_version and item.parent_id is null and item.id <> section_id
      union all
      select child.id, parent.path || child.position from public.estimate_items as child
      join copy_tree as parent on parent.id = child.parent_id where child.version_id = target_version
    )
    select copied.id, 'copy:' || original.id::text from copy_tree as copied join source_tree as original on original.path = copied.path;
  end if;
  if section_created then
    insert into pg_temp._takeoff_send_refs (id, ref) values (section_id, 'new') on conflict (id) do update set ref = 'new';
  end if;
  drop table if exists pg_temp._takeoff_send_before;
  create temporary table _takeoff_send_before on commit drop as
  select item.id, item.parent_id, item.title,
    private.takeoff_send_line_unit(target_engine, item.unit_code, item.description) as unit,
    case when private.takeoff_send_line_unit(target_engine, item.unit_code, item.description) is null
      then item.pricing_status::text end as unitless_status,
    item.quantity, item.unit_price_ht_cents, item.source_job_id, item.updated_at,
    pg_catalog.jsonb_build_object('file', item.source_file_name, 'page', item.source_page,
      'takeoff_item_id', coalesce(item.source_metadata ->> 'takeoff_item_id',
        item.source_metadata #>> '{takeoff_length_rounding,representative_item_id}')) as source
  from public.estimate_items as item
  where item.version_id = target_version and item.tenant_id = p_tenant and item.item_type = 'line'::public.estimate_item_type;

  -- The application checks the actor's draft lock. A version created here has no other holder: its lock lives only in
  -- this transaction. An existing draft is locked by the actor before the send, as for any application; its dry run
  -- uses the actor's lease as it is, or, when the draft has none (another member's refused the preview above, expired
  -- ones went), takes one for its rolled-back run. No lease is ever changed.
  if version_created then
    insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
    values (target_version, p_actor, p_tenant, pg_catalog.statement_timestamp() + interval '5 minutes', gen_random_uuid())
    returning id into created_lock;
  elsif p_dry_run and not exists (select 1 from public.draft_locks as lock_row where lock_row.version_id = target_version
    and lock_row.user_id = p_actor and lock_row.expires_at > pg_catalog.statement_timestamp()) then
    insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
    values (target_version, p_actor, p_tenant, pg_catalog.statement_timestamp() + interval '5 minutes', gen_random_uuid());
  end if;

  -- The historical receipt of a launch on a version (takeoff_jobs_prepared_plan_receipt_uidx) holds one job per version,
  -- plan set, preparation revision, level and provider, among the jobs without a launch request (20261121170448). A
  -- versionless job of that same launch is refused by name here, between jobs without a request only: two requests may
  -- read one preparation revision, and each of their jobs may be sent to one draft.
  if job.launch_request_id is null and exists (select 1 from public.takeoff_jobs as other
    where other.tenant_id = p_tenant and other.launch_request_id is null
      and other.estimate_version_id = target_version and other.id <> target_job_id
      and other.plan_set_id = job.plan_set_id and other.level = job.level
      and other.execution_provider is not distinct from job.execution_provider
      and other.preparation_snapshot is not null
      and other.preparation_snapshot ->> 'preparation_revision' = job.preparation_snapshot ->> 'preparation_revision') then
    raise exception 'TAKEOFF_SEND_PREPARATION_ALREADY_SENT' using errcode = '22023';
  end if;

  -- The door: the job's version goes from NULL to this draft of its affaire, once, by this command's permit. A per-plan
  -- analysis also needs this send's check of its context, held for the link only.
  insert into private.takeoff_job_attachment_permits (job_id, tenant_id, project_id, version_id)
  values (target_job_id, p_tenant, job.project_id, target_version);
  if plan_unit then
    insert into private.takeoff_plan_send_checks (job_id, version_id, stamps) values (target_job_id, target_version, context_stamps);
  end if;
  update public.takeoff_jobs as attached set estimate_version_id = target_version where attached.id = target_job_id;
  delete from private.takeoff_plan_send_checks as checked where checked.job_id = target_job_id;
  if exists (select 1 from private.takeoff_job_attachment_permits as permit where permit.job_id = target_job_id) then
    raise exception 'TAKEOFF_SEND_PERMIT_NOT_CONSUMED' using errcode = 'P0001';
  end if;

  -- The controls that compare with other takeoffs and with the DPGF, evaluated for this destination by the preview from
  -- the state checked above: every line with rule inputs receives them, or nothing is sent.
  select pg_catalog.count(*) into rules_written
  from takeoff_internal.persist_rule_results(p_tenant, target_version, array[target_job_id], p_command -> 'rule_results',
    p_command -> 'rule_transforms');
  if rules_written <> pg_catalog.jsonb_array_length(p_command -> 'rule_results')
    or exists (select 1 from public.takeoff_items as item
      cross join lateral pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(item.rule_results) = 'array'
        then item.rule_results else '[]'::jsonb end) as rule_result(value)
      where item.job_id = target_job_id and item.tenant_id = p_tenant
        and rule_result.value #>> '{details,cross_job_comparison}' = 'deferred') then
    raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', 'rules_changed')::text;
  end if;

  -- An administrator's override, bound to this destination, checked again by the application's trigger.
  if pg_catalog.jsonb_typeof(p_command -> 'override') = 'object' then
    if p_role <> 'admin'::public.tenant_role then
      raise exception 'TAKEOFF_APPLY_GUARD_FAILED' using errcode = 'P0001';
    end if;
    insert into public.audit_logs (tenant_id, user_id, table_name, record_id, estimate_version_id, action, after_data)
    values (p_tenant, p_actor, 'takeoff_jobs', target_job_id, target_version, 'takeoff.apply.override',
      pg_catalog.jsonb_build_object('schema_version', 1, 'action', 'takeoff.apply.override', 'job_id', target_job_id,
        'tenant_id', p_tenant, 'user_id', p_actor,
        'metadata', (p_command -> 'override') || pg_catalog.jsonb_build_object('estimate_version_id', target_version)));
  end if;

  -- The lines a mapping rule changes (renamed, classified or set aside), read before the writer applies the plan: what
  -- the application's audit names for a command of format 2.
  mapped := (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('item_id', source.id,
      'rule_id', private.takeoff_uuid_or_null(plan_entry.value -> 'rule_id'), 'action', plan_entry.value ->> 'action')
      order by plan_entry.ordinality), '[]'::jsonb)
    from pg_catalog.jsonb_array_elements(p_command -> 'mapping_plan') with ordinality as plan_entry(value, ordinality)
    join public.takeoff_items as source on source.id = private.takeoff_uuid_or_null(plan_entry.value -> 'item_id')
      and source.job_id = target_job_id and source.tenant_id = p_tenant
    where plan_entry.value ->> 'action' is distinct from 'none' and not source.is_excluded);

  select result_row.* into applied from public.apply_takeoff_job_with_page_decisions(target_job_id, 'append', section_id,
    p_command -> 'mapping_plan', p_command -> 'page_decisions', null) as result_row;
  links := coalesce(applied.item_links, '[]'::jsonb);
  created_ids := coalesce(applied.created_ids, '{}'::uuid[]);

  -- An engine 2 line names no takeoff line of its own. Each line this send creates there names the ones it sums, as a
  -- DPGF line names the measures it keeps (takeoff_quantity_policy): a later send can add to it (plan A then plan B)
  -- and a page re-read finds it.
  if target_engine is distinct from 3 then
    update public.estimate_items as line set source_metadata = coalesce(line.source_metadata, '{}'::jsonb)
      || pg_catalog.jsonb_build_object('takeoff_contributions', pg_catalog.jsonb_build_object('version', 1, 'job_id', target_job_id,
        'item_ids', sources.ids, 'parts', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('job_id', target_job_id,
          'request_id', p_request, 'takeoff_item_ids', sources.ids, 'quantity', pg_catalog.trim_scale(line.quantity)))))
    from (select (output.value ->> 'estimate_item_id')::uuid as estimate_item_id,
        pg_catalog.jsonb_agg(output.value -> 'takeoff_item_id' order by output.value ->> 'takeoff_item_id') as ids
      from pg_catalog.jsonb_array_elements(links) as output(value) group by 1) as sources
    where line.id = sources.estimate_item_id and line.id = any(created_ids) and line.version_id = target_version
      and line.tenant_id = p_tenant and line.source_provider = 'takeoff'
      and pg_catalog.cardinality(private.takeoff_estimate_line_item_ids(line.source_metadata, line.source_job_id)) = 0;
  end if;

  -- Earlier takeoff lines of the same item (plan A sent 3, plan B adds 2: one line of 5). The preview proposed each part,
  -- with the line as it read it; the line must still be that line, measured by its takeoff lines only (never a quantity
  -- typed by hand), in the section, of the same title and unit, with no hypothesis nor rounded length on either side.
  -- On both engines: engine 3 completes the line as its writer does, engine 2 recalculates the version (as the DPGF
  -- composition does); the price, unit, hours and supplier stay the line's.
  for entry in
    select part.takeoff_item_id, part.estimate_item_id, part.expected_updated_at, part.expected_quantity, link.created_id
    from pg_catalog.jsonb_to_recordset(p_command -> 'accumulations')
      as part(takeoff_item_id uuid, estimate_item_id uuid, expected_updated_at timestamptz, expected_quantity numeric)
    left join lateral (select (output.value ->> 'estimate_item_id')::uuid as created_id
      from pg_catalog.jsonb_array_elements(links) as output(value)
      where (output.value ->> 'takeoff_item_id')::uuid = part.takeoff_item_id) as link on true
    order by part.estimate_item_id, part.takeoff_item_id
  loop
    if entry.created_id is null or not entry.created_id = any(created_ids)
      or entry.estimate_item_id = any(created_ids) or entry.estimate_item_id = any(removed) then
      raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'accumulation_changed', 'estimate_item_id', entry.estimate_item_id)::text;
    end if;
    perform 1 from public.estimate_items as earlier where earlier.id = entry.estimate_item_id for update;
    if not exists (
      select 1
      from public.estimate_items as earlier
      join public.estimate_items as added on added.id = entry.created_id and added.version_id = earlier.version_id
      join public.takeoff_items as source on source.id = entry.takeoff_item_id and source.job_id = target_job_id
      cross join lateral (select private.takeoff_estimate_line_item_ids(earlier.source_metadata, earlier.source_job_id) as ids) as sources
      cross join lateral (select pg_catalog.sum(own.quantity) as raw, pg_catalog.count(*) as readable
        from public.takeoff_items as own where own.id = any(sources.ids) and own.tenant_id = p_tenant) as measured
      where earlier.id = entry.estimate_item_id and earlier.version_id = target_version and earlier.tenant_id = p_tenant
        and earlier.item_type = 'line'::public.estimate_item_type and earlier.parent_id = section_id
        and earlier.source_provider = 'takeoff'
        -- The line as the preview read it, before this send (the engine 2 writer recalculates and dates anew every line of
        -- the version); a second part for the same line finds it as the first part left it.
        and (entry.estimate_item_id = any(accumulated)
          or exists (select 1 from pg_temp._takeoff_send_before as before_line where before_line.id = entry.estimate_item_id
            and before_line.updated_at = entry.expected_updated_at and before_line.quantity = entry.expected_quantity
            and earlier.quantity = before_line.quantity))
        and pg_catalog.cardinality(sources.ids) > 0 and measured.readable = pg_catalog.cardinality(sources.ids)
        and measured.raw = earlier.quantity
        and not (earlier.source_metadata ? 'takeoff_length_rounding') and not (earlier.source_metadata ? 'takeoff_provision')
        and not (added.source_metadata ? 'takeoff_length_rounding') and not (added.source_metadata ? 'takeoff_provision')
        and public.takeoff_item_hypothesis_cause(source.metadata, source.quantity_entry_category) is null
        and added.parent_id = earlier.parent_id
        and lower(regexp_replace(btrim(added.title), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(earlier.title), '\s+', ' ', 'g'))
        -- The same unit as the outcome shows (on engine 2 the description, where the unit is kept); lines without one by
        -- their pricing status.
        and (private.takeoff_send_line_unit(target_engine, added.unit_code, added.description),
            case when private.takeoff_send_line_unit(target_engine, added.unit_code, added.description) is null
              then added.pricing_status end)
          is not distinct from (private.takeoff_send_line_unit(target_engine, earlier.unit_code, earlier.description),
            case when private.takeoff_send_line_unit(target_engine, earlier.unit_code, earlier.description) is null
              then earlier.pricing_status end)
    ) then
      raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'accumulation_changed', 'estimate_item_id', entry.estimate_item_id)::text;
    end if;

    previous_writer := coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true), '');
    if target_engine = 3 then
      perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', target_version::text, true);
    end if;
    -- Only the quantity and the provenance move: price, unit, hours, supplier and status stay the line's. Its parts are
    -- those of its active sources (never a part a page replacement took out), then this send's.
    update public.estimate_items as earlier set
      quantity = earlier.quantity + added.quantity,
      source_job_id = target_job_id,
      source_metadata = coalesce(earlier.source_metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object('takeoff_contributions',
        pg_catalog.jsonb_build_object('version', 1, 'job_id', target_job_id,
          'item_ids', (select pg_catalog.jsonb_agg(source_id order by ordinal) from pg_catalog.unnest(
              private.takeoff_estimate_line_item_ids(earlier.source_metadata, earlier.source_job_id) || entry.takeoff_item_id)
              with ordinality as listed(source_id, ordinal)),
          'parts', private.takeoff_line_parts(private.takeoff_estimate_line_item_ids(earlier.source_metadata, earlier.source_job_id),
              earlier.source_metadata #> '{takeoff_contributions,parts}', p_tenant)
            || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('job_id', target_job_id, 'request_id', p_request,
              'takeoff_item_ids', pg_catalog.jsonb_build_array(entry.takeoff_item_id),
              'quantity', pg_catalog.trim_scale(added.quantity))))),
      updated_at = pg_catalog.statement_timestamp()
    from public.estimate_items as added
    where earlier.id = entry.estimate_item_id and added.id = entry.created_id;
    delete from public.estimate_items as added where added.id = entry.created_id and added.version_id = target_version;
    if target_engine = 3 then
      perform public.estimate_v3_complete_entry_for_writer(target_version, array[entry.estimate_item_id]);
    end if;
    perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', previous_writer, true);
    removed := removed || entry.created_id;
    accumulated := accumulated || entry.estimate_item_id;
    links := (select pg_catalog.jsonb_agg(case when (output.value ->> 'takeoff_item_id')::uuid = entry.takeoff_item_id
        then pg_catalog.jsonb_build_object('takeoff_item_id', entry.takeoff_item_id, 'estimate_item_id', entry.estimate_item_id)
        else output.value end order by output.ordinality)
      from pg_catalog.jsonb_array_elements(links) with ordinality as output(value, ordinality));
  end loop;
  if target_engine is distinct from 3 and pg_catalog.cardinality(accumulated) > 0 then
    perform public.recalculate_takeoff_estimate_version(target_version, p_tenant);
  end if;

  if created_lock is not null then
    delete from public.draft_locks as lock_row where lock_row.id = created_lock;
  end if;

  -- What the send leaves, against what the destination held: the lines created, changed and removed, each in its
  -- section, and where each takeoff line went. The dry run of the preview computes it the same way, from the same state.
  drop table if exists pg_temp._takeoff_send_after;
  create temporary table _takeoff_send_after on commit drop as
  select item.id, item.parent_id, item.title,
    private.takeoff_send_line_unit(target_engine, item.unit_code, item.description) as unit,
    case when private.takeoff_send_line_unit(target_engine, item.unit_code, item.description) is null
      then item.pricing_status::text end as unitless_status,
    item.quantity, item.unit_price_ht_cents, item.source_job_id,
    (select pg_catalog.jsonb_agg(output.value ->> 'takeoff_item_id' order by output.value ->> 'takeoff_item_id')
      from pg_catalog.jsonb_array_elements(links) as output(value)
      where (output.value ->> 'estimate_item_id')::uuid = item.id) as takeoff_item_ids,
    -- The line's own source: for a line that groups equal lengths, the measure that represents it.
    pg_catalog.jsonb_build_object('file', item.source_file_name, 'page', item.source_page,
      'takeoff_item_id', coalesce(item.source_metadata ->> 'takeoff_item_id',
        item.source_metadata #>> '{takeoff_length_rounding,representative_item_id}')) as source
  from public.estimate_items as item
  where item.version_id = target_version and item.tenant_id = p_tenant and item.item_type = 'line'::public.estimate_item_type;
  with changes as (
    select 'created' as change, null::text as ref, refs.ref as section, after_line.title, after_line.unit,
      after_line.unitless_status, after_line.quantity,
      null::numeric as quantity_before, after_line.unit_price_ht_cents, coalesce(after_line.takeoff_item_ids, '[]'::jsonb) as takeoff_item_ids,
      after_line.source
    from pg_temp._takeoff_send_after as after_line
    left join pg_temp._takeoff_send_refs as refs on refs.id = after_line.parent_id
    where not exists (select 1 from pg_temp._takeoff_send_before as before_line where before_line.id = after_line.id)
    union all
    select 'changed', line_ref.ref, refs.ref, after_line.title, after_line.unit, after_line.unitless_status, after_line.quantity,
      before_line.quantity,
      after_line.unit_price_ht_cents, coalesce(after_line.takeoff_item_ids, '[]'::jsonb), after_line.source
    from pg_temp._takeoff_send_after as after_line
    join pg_temp._takeoff_send_before as before_line on before_line.id = after_line.id
    left join pg_temp._takeoff_send_refs as line_ref on line_ref.id = after_line.id
    left join pg_temp._takeoff_send_refs as refs on refs.id = after_line.parent_id
    where (after_line.parent_id, after_line.title, after_line.unit, after_line.unitless_status, after_line.quantity,
        after_line.unit_price_ht_cents, after_line.source_job_id)
      is distinct from (before_line.parent_id, before_line.title, before_line.unit, before_line.unitless_status,
        before_line.quantity, before_line.unit_price_ht_cents, before_line.source_job_id)
    union all
    select 'removed', line_ref.ref, refs.ref, before_line.title, before_line.unit, before_line.unitless_status,
      before_line.quantity, before_line.quantity,
      before_line.unit_price_ht_cents, '[]'::jsonb, before_line.source
    from pg_temp._takeoff_send_before as before_line
    left join pg_temp._takeoff_send_refs as line_ref on line_ref.id = before_line.id
    left join pg_temp._takeoff_send_refs as refs on refs.id = before_line.parent_id
    where not exists (select 1 from pg_temp._takeoff_send_after as after_line where after_line.id = before_line.id)
  )
  select pg_catalog.jsonb_build_object('format_version', 1, 'engine', target_engine,
    -- A version this send creates, with the settings it is stored with — the ones the payload names and the ones the
    -- creation takes from the tenant's policy (the sale coefficients of engine 3): a policy changed since the preview
    -- changes the outcome. Not its identifier nor its date (the day it is created).
    'version', case when version_created then (select pg_catalog.jsonb_build_object('title', created_version.title,
        'validite_jours', created_version.validite_jours, 'margin_multiplier', created_version.margin_multiplier,
        'margin_mode', created_version.margin_mode, 'currency', created_version.currency, 'margin_bp', created_version.margin_bp,
        'discount_bp', created_version.discount_bp, 'discount_amount_cents', created_version.discount_amount_cents,
        'discount_mode', created_version.discount_mode, 'discount_steps', created_version.discount_steps,
        'global_coefficient', created_version.global_coefficient, 'tax_rate_bp', created_version.tax_rate_bp,
        'rounding_mode', created_version.rounding_mode, 'rounding_step_cents', created_version.rounding_step_cents,
        'max_section_depth', created_version.max_section_depth, 'calc_engine_version', created_version.calc_engine_version,
        'contractor_role', created_version.contractor_role, 'sale_coefficient_fo', created_version.sale_coefficient_fo,
        'sale_coefficient_mo', created_version.sale_coefficient_mo)
      from public.estimate_versions as created_version where created_version.id = target_version) end,
    'sections_created', case when section_created
      then pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('title', btrim(p_command #>> '{section,title}')))
      else '[]'::jsonb end,
    'lines', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('change', change.change, 'ref', change.ref,
        'section', change.section, 'title', change.title, 'unit', change.unit, 'unitless_status', change.unitless_status,
        'quantity', pg_catalog.trim_scale(change.quantity),
        'quantity_before', pg_catalog.trim_scale(change.quantity_before), 'unit_price_ht_cents', change.unit_price_ht_cents,
        'takeoff_item_ids', change.takeoff_item_ids, 'source', change.source)
      order by change.change, change.section collate "C", change.title collate "C", change.unit collate "C",
        change.unitless_status collate "C", change.quantity,
        change.ref collate "C", change.takeoff_item_ids::text collate "C") from changes as change), '[]'::jsonb),
    'parts', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('takeoff_item_id', output.value ->> 'takeoff_item_id',
        'target', case when exists (select 1 from pg_temp._takeoff_send_before as before_line
          where before_line.id = (output.value ->> 'estimate_item_id')::uuid) then 'existing_line' else 'new_line' end,
        'line', (select refs.ref from pg_temp._takeoff_send_refs as refs where refs.id = (output.value ->> 'estimate_item_id')::uuid),
        'section', (select refs.ref from pg_temp._takeoff_send_after as after_line
          join pg_temp._takeoff_send_refs as refs on refs.id = after_line.parent_id
          where after_line.id = (output.value ->> 'estimate_item_id')::uuid))
      order by output.value ->> 'takeoff_item_id') from pg_catalog.jsonb_array_elements(links) as output(value)), '[]'::jsonb))
  into outcome;

  -- What the member confirmed is what is written: any other line, quantity, unit, section or target refuses everything.
  if not p_dry_run and outcome is distinct from p_command -> 'expected_outcome' then
    raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', 'outcome_changed')::text;
  end if;
  if p_dry_run then
    return pg_catalog.jsonb_build_object('outcome', outcome);
  end if;

  -- The parts as stored: each one names its takeoff line, its real target (the line it entered, new or earlier, and the
  -- section that line is in), the page, the plan's attested content, the source of its quantity and the revision of its
  -- evidence, read here from the rows the application wrote from.
  plan := pg_catalog.jsonb_build_object('format_version', 1,
    'destination', pg_catalog.jsonb_build_object('kind', kind, 'version_id', target_version, 'source_version_id', source_version,
      'version_created', version_created),
    'price_rules_ignored', coalesce(p_command -> 'price_rules_ignored', '[]'::jsonb),
    'sections', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', section_id, 'created', section_created,
      'title', (select item.title from public.estimate_items as item where item.id = section_id))),
    'parts', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'takeoff_item_id', source.id, 'designation', source.designation,
          'estimate_item_id', target_line.id, 'section_id', target_line.parent_id,
          'target', case when before_line.id is not null
            then pg_catalog.jsonb_build_object('kind', 'existing_line', 'estimate_item_id', before_line.id,
              'quantity_before', pg_catalog.trim_scale(before_line.quantity))
            else pg_catalog.jsonb_build_object('kind', 'new_line') end,
          'quantity', pg_catalog.trim_scale(source.quantity), 'unit', source.unit,
          'source', pg_catalog.jsonb_build_object('job_id', target_job_id, 'answer_id', null, 'observation_id', source.id,
            'plan_file_id', source.metadata #>> '{source_document,plan_file_id}', 'source_file_name', source.source_file_name,
            'source_page', source.source_page,
            'quantity_source', case
              when public.takeoff_item_hypothesis_cause(source.metadata, source.quantity_entry_category) is not null
                then 'hypothesis:' || public.takeoff_item_hypothesis_cause(source.metadata, source.quantity_entry_category)
              when source.quantity_entry_category is not null then 'entered' else 'measured' end,
            -- The plan's bytes as the takeoff attested them (its preparation), never the plan centre's current file.
            'plan_content_hash', (select attested.value ->> 'content_hash'
              from pg_catalog.jsonb_array_elements(job.preparation_snapshot #> '{preparation,sources}') as attested(value)
              where attested.value ->> 'document_id' = source.metadata #>> '{source_document,plan_file_id}' limit 1),
            'evidence_revision', pg_catalog.md5(pg_catalog.jsonb_build_array(source.updated_at, source.evidence,
              source.source_file_name, source.source_page, source.metadata,
              (select pg_catalog.jsonb_agg(geometry.geometry - 'transform' order by geometry.vector_page_id)
                from public.takeoff_item_geometries as geometry where geometry.takeoff_item_id = source.id))::text)))
        order by source.id)
      from pg_catalog.jsonb_array_elements(links) as output(value)
      join public.takeoff_items as source on source.id = (output.value ->> 'takeoff_item_id')::uuid
        and source.job_id = target_job_id and source.tenant_id = p_tenant
      join pg_temp._takeoff_send_after as target_line on target_line.id = (output.value ->> 'estimate_item_id')::uuid
      left join pg_temp._takeoff_send_before as before_line on before_line.id = target_line.id), '[]'::jsonb));
  -- What this send checked of its context: the request and unit of a per-plan analysis, the analyses of the other plans
  -- its controls compared it with, and each plan revision of this takeoff with the operator's location it was sent
  -- under (its generation): a correction made later never rewrites what was sent. And, whole, what the comparison read
  -- (each peer with the stamp of its lines, each plan revision with its location and copy), which
  -- public.read_takeoff_send_drift compares with the current state.
  if context is not null then
    plan := plan || pg_catalog.jsonb_build_object('context', pg_catalog.jsonb_build_object('stamps', context_stamps,
      'checked', pg_catalog.jsonb_build_object('peers', context -> 'peers', 'plans', context -> 'plans'),
      'unit', case when plan_unit then pg_catalog.jsonb_build_object('request_id', job.launch_request_id, 'key', job.launch_unit_key) end,
      'peers', coalesce((select pg_catalog.jsonb_agg(peer.value -> 'job_id' order by peer.value ->> 'job_id')
        from pg_catalog.jsonb_array_elements(context -> 'peers') as peer(value)), '[]'::jsonb),
      'locations', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('plan_file_id', revision.value -> 'plan_file_id',
          'content_hash', revision.value -> 'content_hash', 'location_id', revision.value #> '{location,id}',
          'revision', revision.value #> '{location,revision}',
          'building', case when revision.value #>> '{location,building_choice}' = 'value' then revision.value #> '{location,building}' end,
          'level', case when revision.value #>> '{location,level_choice}' = 'value' then revision.value #> '{location,level}' end)
          order by revision.value ->> 'plan_file_id', revision.value ->> 'content_hash')
        from pg_catalog.jsonb_array_elements(context -> 'plans') as revision(value)
        where revision.value ->> 'job_id' = target_job_id::text), '[]'::jsonb)));
  end if;

  result := pg_catalog.jsonb_build_object(
    'format_version', 1,
    'version_id', target_version,
    'version_created', version_created,
    'source_version_id', source_version,
    'outcome', outcome,
    'sections_created', case when section_created then pg_catalog.jsonb_build_array(section_id) else '[]'::jsonb end,
    'sections_changed', coalesce((select pg_catalog.jsonb_agg(distinct touched.section_id) from (
        select after_line.parent_id as section_id from pg_temp._takeoff_send_after as after_line
        left join pg_temp._takeoff_send_before as before_line on before_line.id = after_line.id
        where after_line.parent_id is not null and (before_line.id is null
          or (after_line.parent_id, after_line.title, after_line.unit, after_line.unitless_status, after_line.quantity,
            after_line.unit_price_ht_cents, after_line.source_job_id) is distinct from (before_line.parent_id, before_line.title,
            before_line.unit, before_line.unitless_status, before_line.quantity, before_line.unit_price_ht_cents,
            before_line.source_job_id))
        union
        select before_line.parent_id from pg_temp._takeoff_send_before as before_line
        left join pg_temp._takeoff_send_after as after_line on after_line.id = before_line.id
        where before_line.parent_id is not null and (after_line.id is null or after_line.parent_id is distinct from before_line.parent_id)
      ) as touched), '[]'::jsonb),
    'lines_created', coalesce((select pg_catalog.jsonb_agg(after_line.id order by after_line.id) from pg_temp._takeoff_send_after as after_line
      where not exists (select 1 from pg_temp._takeoff_send_before as before_line where before_line.id = after_line.id)), '[]'::jsonb),
    'lines_changed', coalesce((select pg_catalog.jsonb_agg(after_line.id order by after_line.id)
      from pg_temp._takeoff_send_after as after_line join pg_temp._takeoff_send_before as before_line on before_line.id = after_line.id
      where (after_line.parent_id, after_line.title, after_line.unit, after_line.unitless_status, after_line.quantity,
          after_line.unit_price_ht_cents, after_line.source_job_id) is distinct from (before_line.parent_id, before_line.title,
          before_line.unit, before_line.unitless_status, before_line.quantity, before_line.unit_price_ht_cents,
          before_line.source_job_id)), '[]'::jsonb),
    'lines_removed', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', before_line.id,
        'section_id', before_line.parent_id, 'title', before_line.title, 'quantity', pg_catalog.trim_scale(before_line.quantity),
        'unit', before_line.unit) order by before_line.id)
      from pg_temp._takeoff_send_before as before_line
      where not exists (select 1 from pg_temp._takeoff_send_after as after_line where after_line.id = before_line.id)), '[]'::jsonb),
    'item_links', links,
    'ignored_count', applied.ignored_count,
    'scope', applied.scope);
  result := result || pg_catalog.jsonb_build_object(
    'created_count', pg_catalog.jsonb_array_length(result -> 'lines_created'),
    'updated_count', pg_catalog.jsonb_array_length(result -> 'lines_changed'),
    'removed_count', pg_catalog.jsonb_array_length(result -> 'lines_removed'),
    'sent_count', pg_catalog.jsonb_array_length(links),
    'accumulated_count', pg_catalog.cardinality(accumulated));

  -- A command of format 2: the application's audit rows, written here once, in the transaction of the send (a replay
  -- returns the receipt and writes nothing) — the application completed, and each mapping action applied to the line
  -- that remains: a line set aside by a rule, or a line this send created. An action the page writer suppressed (a line
  -- paired with an earlier line keeps that line's title and category) or that an addition dropped (the line it created
  -- was merged into an earlier line) applied to nothing that remains. A command of format 1 comes from the previous
  -- application, whose server still writes them itself.
  if p_command -> 'format_version' = '2'::jsonb then
    insert into public.audit_logs (tenant_id, user_id, table_name, record_id, estimate_version_id, action, after_data)
    values (p_tenant, p_actor, 'takeoff_jobs', target_job_id, target_version, 'takeoff.apply.completed',
      pg_catalog.jsonb_build_object('schema_version', 1, 'action', 'takeoff.apply.completed', 'job_id', target_job_id,
        'tenant_id', p_tenant, 'user_id', p_actor, 'metadata', pg_catalog.jsonb_build_object('estimate_version_id', target_version,
          'applied_items_count', (result ->> 'created_count')::integer + (result ->> 'updated_count')::integer,
          'excluded_items_count', coalesce((result ->> 'ignored_count')::integer, 0))));
    insert into public.audit_logs (tenant_id, user_id, table_name, record_id, estimate_version_id, action, after_data)
    select p_tenant, p_actor, 'takeoff_items', target_job_id, target_version, 'takeoff.mapping.applied',
      pg_catalog.jsonb_build_object('schema_version', 1, 'action', 'takeoff.mapping.applied', 'job_id', target_job_id,
        'tenant_id', p_tenant, 'user_id', p_actor, 'metadata', pg_catalog.jsonb_build_object('job_id', target_job_id,
          'item_id', mapped_line.value -> 'item_id', 'rule_id', mapped_line.value -> 'rule_id',
          'action', mapped_line.value -> 'action', 'estimate_item_id', written.estimate_item_id))
    from pg_catalog.jsonb_array_elements(mapped) with ordinality as mapped_line(value, ordinality)
    -- The line each one entered (none for a line a rule set aside), read once from the final links.
    left join (select distinct on (output.value ->> 'takeoff_item_id') output.value ->> 'takeoff_item_id' as takeoff_item_id,
        output.value -> 'estimate_item_id' as estimate_item_id
      from pg_catalog.jsonb_array_elements(links) as output(value)
      order by output.value ->> 'takeoff_item_id') as written on written.takeoff_item_id = mapped_line.value ->> 'item_id'
    where mapped_line.value ->> 'action' = 'skip'
      or exists (select 1 from pg_temp._takeoff_send_after as after_line
        where after_line.id = private.takeoff_uuid_or_null(written.estimate_item_id)
          and not exists (select 1 from pg_temp._takeoff_send_before as before_line where before_line.id = after_line.id))
    order by mapped_line.ordinality;
  end if;
  return pg_catalog.jsonb_build_object('version_id', target_version, 'project_id', job.project_id, 'owner_id', project.user_id,
    'plan', plan, 'result', result);
end;
$$;
revoke all on function private.takeoff_send_execute(uuid, uuid, public.tenant_role, uuid, jsonb, boolean)
  from public, anon, authenticated, service_role;

-- 4. What changed since a plan was sent. The send computes its context inside its transaction and refuses one that changed
-- since the preview; a writer that commits after that reading and before the send's commit (a location saved, a peer's
-- line edited or the peer read again, a dossier piece replaced or reserved for deletion) is not locked out, and nothing
-- is added to what such writers do. Its effect is named here, when the sent plan's lines are read: the analysis's latest
-- send receipt records what its comparison read (write_plan.context.checked), compared here with the current state.
-- Counted: a peer compared and not sent since whose lines changed (its stamp), or that is no longer its plan's latest
-- successful reading of the dossier's current copy (read again, its copy replaced or set aside); a plan revision compared
-- whose operator location or copy changed. Not counted: a peer sent since (its own send compared it with this plan), a plan
-- read only after this send (its own send compares it with this plan). Each change names its plan; the receipt's parts
-- name the lines sent. For an analysis of one plan sent with a context only, null otherwise. Service role only.
create function public.read_takeoff_send_drift(p_tenant_id uuid, p_project_id uuid, p_job_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with receipt as (
    select stored.created_at, stored.write_plan
    from public.takeoff_send_receipts as stored
    join public.takeoff_jobs as job on job.id = stored.job_id and job.tenant_id = stored.tenant_id
      and job.project_id = stored.project_id
    where stored.tenant_id = p_tenant_id and stored.project_id = p_project_id and stored.job_id = p_job_id
      and stored.command_kind = 'send' and private.takeoff_job_is_plan_unit(job.launch_request_id)
      and pg_catalog.jsonb_typeof(stored.write_plan #> '{context,checked}') = 'object'
    order by stored.created_at desc, stored.id desc
    limit 1
  ), now_peers as (
    select private.takeoff_uuid_or_null(listed.value -> 'job_id') as job_id
    from public.takeoff_jobs as job
    cross join lateral pg_catalog.jsonb_array_elements(
      private.takeoff_send_context(p_tenant_id, p_project_id, p_job_id, job.estimate_version_id) -> 'peers') as listed(value)
    where job.id = p_job_id and job.tenant_id = p_tenant_id and job.project_id = p_project_id
      and exists (select 1 from receipt)
  ), changes as (
    select case
        when peer.id is not null and peer.estimate_version_id is not null then null
        when peer.id is null or not exists (select 1 from now_peers where now_peers.job_id = peer.id) then 'peer_replaced'
        when public.takeoff_rule_job_stamp(p_tenant_id, p_project_id, peer.id) is distinct from recorded.value ->> 'stamp'
          then 'peer_changed'
      end as reason, private.takeoff_send_plan_name(peer.preparation_snapshot) as plan_name, 1 as rank
    from receipt
    cross join lateral pg_catalog.jsonb_array_elements(receipt.write_plan #> '{context,checked,peers}') as recorded(value)
    left join public.takeoff_jobs as peer on peer.id = private.takeoff_uuid_or_null(recorded.value -> 'job_id')
      and peer.tenant_id = p_tenant_id and peer.project_id = p_project_id
    union all
    select case
        when now_state.state -> 'location' is distinct from recorded.value -> 'location' then 'location_changed'
        when now_state.state -> 'current_copy' is distinct from recorded.value -> 'current_copy' then 'copy_changed'
      end, plan_file.file_name, 2
    from receipt
    cross join lateral pg_catalog.jsonb_array_elements(receipt.write_plan #> '{context,checked,plans}') as recorded(value)
    cross join lateral (select private.takeoff_send_revision_state(p_tenant_id, p_project_id,
      private.takeoff_uuid_or_null(recorded.value -> 'plan_file_id'), recorded.value ->> 'content_hash') as state) as now_state
    left join public.plan_files as plan_file on plan_file.id = private.takeoff_uuid_or_null(recorded.value -> 'plan_file_id')
      and plan_file.tenant_id = p_tenant_id
  )
  select pg_catalog.jsonb_build_object('sent_at', receipt.created_at,
    'changed', exists (select 1 from changes where changes.reason is not null),
    'changes', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('reason', change.reason,
        'plan_name', change.plan_name) order by change.rank, change.plan_name, change.reason)
      from (select distinct changes.reason, changes.plan_name, changes.rank from changes where changes.reason is not null) as change),
      '[]'::jsonb),
    'item_ids', coalesce((select pg_catalog.jsonb_agg(distinct part.value -> 'takeoff_item_id')
      from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(receipt.write_plan -> 'parts') = 'array'
        then receipt.write_plan -> 'parts' else '[]'::jsonb end) as part(value)
      where part.value ? 'takeoff_item_id'), '[]'::jsonb))
  from receipt
$$;
revoke all on function public.read_takeoff_send_drift(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.read_takeoff_send_drift(uuid, uuid, uuid) to service_role;

-- 5. The manual command (lot 2 and one analysis per plan), as 20261121231238 wrote it, but for one lock: the affaire,
-- shared, first, before the analysis it replaces, the affaire's key and its automatic request. A send holds the affaire
-- (FOR NO KEY UPDATE, FOR UPDATE once it creates a first draft), then its job, then a per-plan analysis's request: the
-- command now takes the affaire before any of those, as the send does. Before, a reread held the affaire's automatic
-- request (FOR UPDATE) while the inserts of its rows waited for the affaire (their checks lock it), and a send of a unit
-- of that request asked for it; and a reread holding the key share of an analysis launched outside any request waited
-- for the affaire while the send of that analysis, holding the affaire, asked for its row. The analysis it replaces is
-- still locked early only when launched outside any request: a running analysis's worker holds its row, and a refused
-- relaunch never waits for it (20261121193413).
create or replace function private.launch_manual_takeoff_command(
  p_tenant_id uuid, p_project_id uuid, p_actor uuid, p_intent_key uuid, p_intent text, p_predecessor_job_id uuid,
  p_host text, p_selection jsonb, p_manifest jsonb, p_snapshot jsonb, p_job jsonb, p_plan_set_id uuid,
  p_preparation_revision integer, p_module_default boolean, p_digest text, p_named_plans boolean
) returns table (outcome text, request_id uuid, job_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  request public.takeoff_launch_requests%rowtype;
  running record;
  answer record;
  predecessor_request uuid;
  admitted_jobs uuid[];
  violated text;
  running_unrequested uuid;
  decided_mark bigint;
begin
  if p_intent not in ('initial', 'reread_plans') or p_intent_key is null or p_actor is null or p_plan_set_id is null
    or p_preparation_revision is null then
    raise exception 'TAKEOFF_LAUNCH_COMMAND_INVALID' using errcode = '22023';
  end if;
  if p_intent <> 'initial' and p_predecessor_job_id is null then
    raise exception 'TAKEOFF_LAUNCH_PREDECESSOR_REQUIRED' using errcode = '22023';
  end if;
  if p_intent = 'initial' and p_predecessor_job_id is not null then
    raise exception 'TAKEOFF_LAUNCH_PREDECESSOR_INVALID' using errcode = '22023';
  end if;
  perform private.assert_takeoff_launch_selection(p_host, p_selection);
  if not private.takeoff_launch_active() then
    raise exception 'TAKEOFF_LAUNCH_INACTIVE' using errcode = '55000';
  end if;
  if not private.takeoff_module_enabled(p_tenant_id, p_module_default) then
    raise exception 'TAKEOFF_LAUNCH_MODULE_DISABLED' using errcode = '55000';
  end if;
  -- The affaire, shared, first (20261122030312): a send holds the affaire before its job and its request's row; this
  -- command's rows (its record, its request, its jobs) lock the affaire too. Taken first, the command waits for such a send
  -- holding nothing it needs. A Mac's claim of a retry takes nothing of the affaire (its job, then the affaire's key and
  -- its automatic request, 20261121193413): it never waits for this lock.
  perform 1 from public.estimate_projects as project_row
  where project_row.id = p_project_id and project_row.tenant_id = p_tenant_id for share;
  -- The analysis it replaces, when launched outside any request, before the affaire's key: its Mac's claim of a retry holds
  -- that row and then waits for the key (the restart guard of 20261121193413), while this command's request names it (a
  -- key share). Both take the analysis first, never the reverse. A request's analysis is never restarted that way.
  if p_predecessor_job_id is not null then
    perform 1 from public.takeoff_jobs j where j.id = p_predecessor_job_id and j.tenant_id = p_tenant_id
      and j.project_id = p_project_id and j.launch_request_id is null for key share;
  end if;
  -- Commands and reservations of one affaire are serialized on its key: the replay and the one-running rule read
  -- committed rows, and the automatic request a confirmation reserved is always found.
  perform private.lock_takeoff_launch_commands(p_project_id);
  for answer in select * from private.replay_takeoff_launch_command(p_tenant_id, p_project_id, p_intent_key, p_digest) loop
    return query select answer.outcome, answer.request_id, answer.job_id;
    return;
  end loop;
  if p_predecessor_job_id is not null then
    select j.launch_request_id into predecessor_request from public.takeoff_jobs j
    where j.id = p_predecessor_job_id and j.tenant_id = p_tenant_id and j.project_id = p_project_id;
    if not found then
      raise exception 'TAKEOFF_LAUNCH_PREDECESSOR_INVALID' using errcode = '22023';
    end if;
  end if;
  -- The affaire's automatic request is held before the one-running rule is read: its own admission either committed
  -- (it runs, the command is refused) or waits for this command, which then sets it aside.
  perform 1 from public.takeoff_launch_requests r
  where r.tenant_id = p_tenant_id and r.project_id = p_project_id and r.origin = 'automatic' for update;
  -- An automatic start that can still begin without a new dossier change (its eligible payer's Mac, or a gesture this
  -- member may make) is taken on from the affaire's takeoff zone: refused, nothing is recorded. One that waits for a
  -- dossier change or for nobody is set aside below by this explicit analysis.
  decided_mark := private.takeoff_launch_mark_position(p_tenant_id, p_project_id);
  if exists (select 1 from public.takeoff_launch_requests r where r.tenant_id = p_tenant_id and r.project_id = p_project_id
      and private.takeoff_automatic_request_can_start(r, p_actor)) then
    raise exception 'TAKEOFF_LAUNCH_AUTOMATIC_PENDING' using errcode = '55000';
  end if;
  -- The first analysis only on an affaire that has none, whatever launched it: any other command names the analysis it
  -- replaces or extends.
  if p_intent = 'initial' and exists (select 1 from public.takeoff_jobs j
      where j.tenant_id = p_tenant_id and j.project_id = p_project_id) then
    raise exception 'TAKEOFF_LAUNCH_ANALYSIS_EXISTS' using errcode = '22023';
  end if;
  select r.id, private.takeoff_launch_first_job(r.id) as job
  into running from public.takeoff_launch_requests r
  where r.tenant_id = p_tenant_id and r.project_id = p_project_id and r.state = 'admitted';
  if found then
    insert into private.takeoff_launch_commands (tenant_id, project_id, intent_key, command_digest, answer, request_id, job_id, created_by)
    values (p_tenant_id, p_project_id, p_intent_key, p_digest, 'already_running', running.id, running.job, p_actor);
    return query select 'already_running'::text, running.id, running.job;
    return;
  end if;
  -- An analysis launched outside any request (the dialogue's launch on a version, before the activation) that has not
  -- ended runs too: the command is recorded with it, as with a running request, and no request is created.
  running_unrequested := private.takeoff_unrequested_analysis_running(p_tenant_id, p_project_id);
  if running_unrequested is not null then
    insert into private.takeoff_launch_commands (tenant_id, project_id, intent_key, command_digest, answer, request_id, job_id, created_by)
    values (p_tenant_id, p_project_id, p_intent_key, p_digest, 'already_running', null, running_unrequested, p_actor);
    return query select 'already_running'::text, null::uuid, running_unrequested;
    return;
  end if;
  if not private.takeoff_launch_payer_eligible(p_tenant_id, p_project_id, p_actor) then
    raise exception 'TAKEOFF_LAUNCH_PAYER_NOT_ELIGIBLE' using errcode = '42501';
  end if;
  if p_manifest -> 'format_version' = '2'::jsonb then
    perform private.assert_takeoff_command_plans(p_tenant_id, p_project_id, p_preparation_revision, p_snapshot, p_named_plans);
  end if;
  begin
    insert into public.takeoff_launch_requests (tenant_id, project_id, origin, intent, intent_key, command_digest,
      predecessor_request_id, predecessor_job_id, state, payer_id, mandate_kind, mandated_at,
      execution_host_id, mandate_selection, mandate_revision)
    values (p_tenant_id, p_project_id, 'manual', p_intent, p_intent_key, p_digest, predecessor_request, p_predecessor_job_id,
      'evaluating', p_actor, 'command', pg_catalog.clock_timestamp(), p_host, p_selection, 1)
    returning * into request;
    request := private.seal_takeoff_launch_request(request, p_manifest, p_snapshot,
      private.takeoff_launch_mark_position(p_tenant_id, p_project_id));
    admitted_jobs := private.insert_takeoff_launch_jobs(request, p_job);
    perform private.record_takeoff_launch_audit(request, p_actor, 'takeoff.request.admitted', jsonb_build_object(
      'job_ids', to_jsonb(admitted_jobs), 'manifest_digest', request.manifest_digest, 'intent', p_intent,
      'predecessor_job_id', p_predecessor_job_id, 'execution_host_id', p_host, 'mandate_kind', 'command')
      || case when request.manifest -> 'format_version' = '2'::jsonb then jsonb_build_object('format_version', 2) else '{}'::jsonb end);
    -- Before setting an automatic start aside: the dossier key exclusively, last of everything this command locks, as the
    -- automatic admission takes it. A dossier change committed since the decision above is counted, and a start it lets
    -- begin again is decided again, under the same lock: refused, nothing is recorded.
    if exists (select 1 from public.takeoff_launch_requests r where r.tenant_id = p_tenant_id and r.project_id = p_project_id
        and r.origin = 'automatic' and private.takeoff_launch_request_open(r)) then
      perform pg_catalog.pg_advisory_xact_lock(private.takeoff_dossier_lock_key(p_project_id));
      if private.takeoff_launch_mark_position(p_tenant_id, p_project_id) <> decided_mark and exists (
          select 1 from public.takeoff_launch_requests r where r.tenant_id = p_tenant_id and r.project_id = p_project_id
            and private.takeoff_automatic_request_can_start(r, p_actor)) then
        raise exception 'TAKEOFF_LAUNCH_AUTOMATIC_PENDING' using errcode = '55000';
      end if;
    end if;
    -- An automatic start that had not begun is set aside by this explicit analysis, for good: it never spends later.
    update public.takeoff_launch_requests r set state = 'superseded', reason_code = null,
      reason_details = jsonb_build_object('request_id', request.id), evaluation_lease_token = null, evaluation_lease_expires_at = null,
      mandate_revision = r.mandate_revision + 1
    where r.tenant_id = p_tenant_id and r.project_id = p_project_id and r.origin = 'automatic'
      and r.state in ('evaluating', 'not_eligible', 'blocked');
    insert into private.takeoff_launch_commands (tenant_id, project_id, intent_key, command_digest, answer, request_id, job_id, created_by)
    values (p_tenant_id, p_project_id, p_intent_key, p_digest, 'admitted', request.id, admitted_jobs[1], p_actor);
  exception when unique_violation then
    -- Another request of the affaire was admitted meanwhile (an automatic admission that did not wait): the command's
    -- receipt records that one.
    get stacked diagnostics violated = constraint_name;
    if violated is distinct from 'takeoff_launch_requests_running_uidx' then raise; end if;
    select r.id, private.takeoff_launch_first_job(r.id) as job
    into running from public.takeoff_launch_requests r
    where r.tenant_id = p_tenant_id and r.project_id = p_project_id and r.state = 'admitted';
    insert into private.takeoff_launch_commands (tenant_id, project_id, intent_key, command_digest, answer, request_id, job_id, created_by)
    values (p_tenant_id, p_project_id, p_intent_key, p_digest, 'already_running', running.id, running.job, p_actor);
    return query select 'already_running'::text, running.id, running.job;
    return;
  end;
  return query select 'admitted'::text, request.id, admitted_jobs[1];
end;
$$;

revoke all on function private.launch_manual_takeoff_command(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, jsonb, jsonb, jsonb, uuid, integer, boolean, text, boolean)
  from public, anon, authenticated, service_role;

-- 6. Last, the send's own check, in its transaction: the version link of a per-plan analysis is admitted only while the send
-- that checked its context holds this row (inserted just before the link, deleted just after; a rollback removes it).
-- No API role reads or writes it. Its keys are the job's and the version's, which the send holds already (the job for
-- update, the version it locks or creates): their checks wait for nothing. Created last: adding those foreign keys holds
-- takeoff_jobs and estimate_versions in SHARE ROW EXCLUSIVE until the commit (their writes wait that long), and the
-- functions above take no lock on a table.
create table private.takeoff_plan_send_checks (
  job_id uuid primary key references public.takeoff_jobs(id) on delete cascade,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  stamps jsonb not null,
  xact xid8 not null default pg_catalog.pg_current_xact_id()
);
revoke all on table private.takeoff_plan_send_checks from public, anon, authenticated, service_role;

commit;
