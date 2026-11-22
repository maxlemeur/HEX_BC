-- Lot 4, migration C: the send of a plan by item to an engine 3 draft — its storage and its writer.
--
-- A job read against the affaire's list (B1, 20261122080845_takeoff_item_answers.sql) answers once per item; the review
-- (B2, 20261122125722_takeoff_item_review_decisions.sql) decides on those answers and holds the quantities entered. The
-- send of that plan writes, in one transaction, what was retained of it into a draft: never the job's lines one by one.
-- This migration stores what such a send leaves, and writes it:
--   - public.takeoff_item_send_receipts: one per intention key (its request), one first success per job;
--   - public.takeoff_item_send_targets: the live target of an item in a draft, one per tenant, version, item, breakdown
--     and compartment key (never null: « together » and « unallocated » included; « dpgf » for a line of the DPGF),
--     with its quantitative identity and a strong link to the physical line; a line is the target of one item at most,
--     so that a DPGF line is never claimed a second time;
--   - public.takeoff_item_send_parts: the journal of contributions, each part with its quantitative identity, its source
--     answer or entry and their revisions, its observations and its pages; live, then replaced by a later part of the
--     same plan or by a page decision (« redistributed » is reserved for the redistribution after a send, never written
--     here);
--   - public.takeoff_item_send_sections: the sections a send created, reusable by their identity (never by their title);
--   - public.takeoff_item_send_pages: the page contributions of a send (the items of a page share one), read by the
--     page guard of the next send by item.
-- One command, public.send_takeoff_item_plan, writes them: the server's (executable by the service role only), with the
-- acting member as a parameter whose rights it reads again after its waits. The server rebuilds the plan
-- (src/lib/takeoff/item-send-plan.ts) from the stored facts and the member's choices; the command reads every fact again
-- under its locks, derives each part, its identity, what is replaced and the pages written, computes each line's
-- quantity itself, and writes only quantities (and what engine 3 derives from them). Trust boundary: SQL takes nothing
-- from the plan that changes an amount; what only the server computes (the mapping rules' projection, a first draft's
-- settings) it binds by comparison: see the command's comment. Two readers give the server the same facts the command
-- reads (public.read_takeoff_item_send_facts, public.read_takeoff_item_send_draft), with the member's session.
--
-- Four functions are replaced on their latest bodies, each answering as before for every job not read against a list
-- and every version no send by item fed:
--   - private.guard_takeoff_plan_unit_send (20261122030312_takeoff_partial_send.sql): a job read against a list is
--     linked to a version only by this command's transaction; today's send, whatever its context, refuses it
--     (TAKEOFF_SEND_JOB_NOT_READY, reason item_list_job).
--   - private.can_read_sent_takeoff_job (20261121050138_takeoff_send_receipts.sql): a job sent by item keeps the
--     affaire's readers, as a job sent by today's send keeps them.
--   - private.can_read_takeoff_plan_evidence (20261121050138_takeoff_send_receipts.sql), the policy of a plan's files:
--     the plan a job sent by item read stays readable by the affaire's readers (its director included), as the plan of a
--     job sent by today's send stays.
--   - public.enforce_takeoff_apply_security (20261110094504_takeoff_apply_force_reasons.sql), the guard of a job that
--     becomes applied: for a job read against a list, only the rows its send by item brought into the draft are judged
--     (each verified by its acceptance); the rows of the items it left out never enter the estimate. Under the service
--     role it reads the acting member from the command's door (private.takeoff_item_send_checks, a row the command alone
--     writes and deletes in its transaction; a caller without it is refused as before). And every other path that
--     applies a job to a version — today's grouped send (public.send_takeoff_job), the send of one plan for today's
--     formats, the legacy application and its DPGF composition (public.apply_takeoff_job_guarded_atomic,
--     private.takeoff_compose_dpgf_targets) — flips the job to applied in its transaction and passes this guard, which
--     refuses a version holding a live target of the send by item (TAKEOFF_APPLY_ITEM_SEND_VERSION): its lines would
--     be counted beside the parts kept per item. A version without a live target is judged as before.
-- A line a send by item writes carries source_metadata.takeoff_item_send (the item, its breakdown and compartment): a
-- copy of the draft carries it without the contributions, and the command refuses such a draft
-- (TAKEOFF_ITEM_SEND_COPY_UNREAD) until the copy of contributions is delivered, so that nothing is counted twice. Such a
-- line names no page in today's provenance: today's page guard and the new one never read it twice.
--
-- What the previous application version sees while this is applied and after: nothing changes in its writes or answers.
--   - Every new relation is written only by public.send_takeoff_item_plan (as its owner); no member writes it.
--   - No column, constraint, index or policy of an existing table changes. The four replaced functions answer as before
--     for every job that is not read against a list, and such a job exists only once the second measuring order is
--     activated (private.takeoff_item_list_order_activation, empty).
--   - The new foreign keys reference estimate_projects, estimate_versions, estimate_items, takeoff_jobs and
--     takeoff_list_items: a deletion of one of their rows probes the new indexes (empty until a send by item writes).
--
-- Locks: every lock this migration needs is taken first, without waiting (nowait): a busy table refuses the migration at
-- once, nothing applied. Held for the DDL only. Nothing is copied or backfilled. Read-only pre-check before applying:
--   select count(*) from private.takeoff_item_list_order_activation;  -- 0: no job is read against a list
begin;

set local lock_timeout = '5s';
-- Bodies are validated when they first run (the database tests run every one): validating them here would lock the
-- tables they name.
set local check_function_bodies = off;

lock table public.estimate_projects, public.estimate_versions, public.estimate_items, public.takeoff_jobs,
  public.takeoff_list_items in share row exclusive mode nowait;

-- 1. Direct writes: only the command (as the owner, inside its own transaction: mergeone.takeoff_item_send names its
--    request) writes these relations; the service role keeps its table rights, but its direct write is refused. The journal moves a part from live to replaced only; a receipt never changes; the
--    link to a line goes when that line is deleted (its foreign key, from inside the deletion); every row goes with its
--    version, its receipt, its job or its affaire (their cascades), never on its own.
create function private.guard_takeoff_item_send_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_catalog.pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'TAKEOFF_ITEM_SEND_IMMUTABLE' using errcode = '42501';
  end if;
  -- A line deleted: its foreign key empties the link, from inside the deletion; nothing else of the row moves.
  if tg_op = 'UPDATE' and pg_catalog.pg_trigger_depth() > 1
    and tg_table_name in ('takeoff_item_send_targets', 'takeoff_item_send_sections') then
    if pg_catalog.to_jsonb(old) ->> 'estimate_item_id' is not null and pg_catalog.to_jsonb(new) ->> 'estimate_item_id' is null
      and (pg_catalog.to_jsonb(new) - 'estimate_item_id') = (pg_catalog.to_jsonb(old) - 'estimate_item_id') then
      return new;
    end if;
  end if;
  if coalesce(pg_catalog.current_setting('mergeone.takeoff_item_send', true), '') = '' or current_user = 'service_role' then
    raise exception 'TAKEOFF_ITEM_SEND_WRITER_REQUIRED' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if tg_table_name = 'takeoff_item_send_parts' then
      if pg_catalog.to_jsonb(old) ->> 'state' = 'live' and pg_catalog.to_jsonb(new) ->> 'state' = 'replaced'
        and pg_catalog.to_jsonb(new) ->> 'replaced_by_receipt_id' is not null
        and (pg_catalog.to_jsonb(new) - array['state', 'replaced_by_receipt_id', 'replaced_at'])
          = (pg_catalog.to_jsonb(old) - array['state', 'replaced_by_receipt_id', 'replaced_at']) then
        return new;
      end if;
    end if;
    raise exception 'TAKEOFF_ITEM_SEND_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_takeoff_item_send_write() from public, anon, authenticated, service_role;

-- 2. The receipt of a send by item: its request (the intention key), its job (one first success), the destination it
--    wrote, its author, the digest of the plan as confirmed, the plan and what it wrote.
create table public.takeoff_item_send_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  job_id uuid not null,
  version_id uuid not null references public.estimate_versions (id) on delete cascade,
  request_id uuid not null,
  command_kind text not null default 'send' check (command_kind = 'send'),
  format_version smallint not null check (format_version = 1),
  actor_id uuid not null,
  plan_sha256 text not null check (plan_sha256 ~ '^[0-9a-f]{64}$'),
  version_created boolean not null,
  write_plan jsonb not null check (pg_catalog.jsonb_typeof(write_plan) = 'object'),
  result jsonb not null check (pg_catalog.jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  constraint takeoff_item_send_receipts_request_key unique (tenant_id, request_id),
  constraint takeoff_item_send_receipts_scope_key unique (id, tenant_id, project_id, version_id),
  constraint takeoff_item_send_receipts_project_fkey foreign key (project_id, tenant_id)
    references public.estimate_projects (id, tenant_id) on delete cascade,
  constraint takeoff_item_send_receipts_job_fkey foreign key (job_id, tenant_id)
    references public.takeoff_jobs (id, tenant_id) on delete cascade
);
create unique index takeoff_item_send_receipts_first_send_key on public.takeoff_item_send_receipts (job_id)
  where command_kind = 'send';
create index takeoff_item_send_receipts_version_idx on public.takeoff_item_send_receipts (version_id);

-- 3. The live target of an item in a draft. Its line goes with the line (set null): the target then holds no line and is
--    no longer live; a later send creates another one only by the member's choice. A line is the target of one item, one
--    breakdown and one compartment at most.
create table public.takeoff_item_send_targets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  version_id uuid not null references public.estimate_versions (id) on delete cascade,
  item_id uuid not null,
  breakdown text not null check (breakdown in ('together', 'by_level', 'by_building', 'dpgf')),
  compartment_key text not null check (pg_catalog.char_length(compartment_key) between 1 and 400),
  estimate_item_id uuid references public.estimate_items (id) on delete set null,
  line_kind text not null check (line_kind in ('new_line', 'dpgf_line')),
  -- The quantitative identity every part of the target shares (the reading's comparison forms).
  unit_code text not null check (pg_catalog.char_length(unit_code) between 1 and 32),
  basis text check (pg_catalog.char_length(basis) between 1 and 300),
  network text check (pg_catalog.char_length(network) between 1 and 300),
  material text check (pg_catalog.char_length(material) between 1 and 300),
  diameter text check (pg_catalog.char_length(diameter) between 1 and 300),
  created_by_receipt_id uuid not null,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  constraint takeoff_item_send_targets_dpgf_check check ((breakdown = 'dpgf') = (compartment_key = 'dpgf')
    and (breakdown = 'dpgf') = (line_kind = 'dpgf_line')),
  constraint takeoff_item_send_targets_scope_key unique (id, tenant_id, project_id, version_id),
  constraint takeoff_item_send_targets_item_fkey foreign key (item_id, tenant_id, project_id)
    references public.takeoff_list_items (id, tenant_id, project_id) on delete cascade,
  constraint takeoff_item_send_targets_receipt_fkey foreign key (created_by_receipt_id, tenant_id, project_id, version_id)
    references public.takeoff_item_send_receipts (id, tenant_id, project_id, version_id) on delete cascade
    deferrable initially deferred
);
create unique index takeoff_item_send_targets_live_key on public.takeoff_item_send_targets
  (tenant_id, version_id, item_id, breakdown, compartment_key) where estimate_item_id is not null;
create unique index takeoff_item_send_targets_line_key on public.takeoff_item_send_targets (estimate_item_id)
  where estimate_item_id is not null;
create index takeoff_item_send_targets_version_idx on public.takeoff_item_send_targets (version_id, item_id);
create index takeoff_item_send_targets_receipt_idx on public.takeoff_item_send_targets (created_by_receipt_id);

-- 4. The journal of contributions. A part is one positive reviewed row of a measured answer (its observation) or the
--    quantity a member entered for the item on this plan, as the send read it: its quantity and unit, its quantitative
--    identity, its pages, the plan it was read on (its logical identity: two revisions of one plan are one plan), and the
--    revisions it was read at. History: no key to the answer, the entry or the row, which may go.
create table public.takeoff_item_send_parts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  version_id uuid not null references public.estimate_versions (id) on delete cascade,
  target_id uuid not null,
  receipt_id uuid not null,
  job_id uuid not null,
  item_id uuid not null,
  plan_logical_id uuid not null,
  kind text not null check (kind in ('measured', 'entered')),
  answer_id uuid not null,
  answer_revision text not null check (answer_revision ~ '^[0-9a-f]{64}$'),
  decision_revision integer check (decision_revision >= 1),
  entry_id uuid,
  entry_revision integer check (entry_revision >= 1),
  observation_ids uuid[] not null,
  takeoff_item_ids uuid[] not null,
  quantity numeric not null check (quantity > 0 and quantity <= 999999999.999 and quantity = pg_catalog.round(quantity, 3)),
  unit text not null check (pg_catalog.char_length(unit) between 1 and 32),
  unit_code text not null check (pg_catalog.char_length(unit_code) between 1 and 32),
  basis text,
  network text,
  material text,
  diameter text,
  pages integer[] not null check (0 < all (pages)),
  state text not null default 'live' check (state in ('live', 'replaced', 'redistributed')),
  replaced_by_receipt_id uuid,
  replaced_at timestamptz,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  constraint takeoff_item_send_parts_kind_sources_check check ((kind = 'measured')
    = (pg_catalog.cardinality(observation_ids) = 1 and pg_catalog.cardinality(takeoff_item_ids) = 1)
    and (kind = 'entered') = (entry_id is not null and entry_revision is not null)
    and (kind = 'entered' or decision_revision is not null)),
  constraint takeoff_item_send_parts_state_replacement_check check ((state = 'live') = (replaced_by_receipt_id is null)
    and (replaced_by_receipt_id is null) = (replaced_at is null) and state <> 'redistributed'),
  constraint takeoff_item_send_parts_target_fkey foreign key (target_id, tenant_id, project_id, version_id)
    references public.takeoff_item_send_targets (id, tenant_id, project_id, version_id) on delete cascade,
  constraint takeoff_item_send_parts_receipt_fkey foreign key (receipt_id, tenant_id, project_id, version_id)
    references public.takeoff_item_send_receipts (id, tenant_id, project_id, version_id) on delete cascade
    deferrable initially deferred,
  constraint takeoff_item_send_parts_replaced_fkey foreign key (replaced_by_receipt_id, tenant_id, project_id, version_id)
    references public.takeoff_item_send_receipts (id, tenant_id, project_id, version_id) on delete cascade
    deferrable initially deferred
);
-- One live part per source in a draft: an observation, or the entry of an item on a plan.
create unique index takeoff_item_send_parts_live_measured_key on public.takeoff_item_send_parts
  (version_id, (observation_ids[1])) where state = 'live' and kind = 'measured';
create unique index takeoff_item_send_parts_live_entered_key on public.takeoff_item_send_parts
  (version_id, item_id, plan_logical_id) where state = 'live' and kind = 'entered';
create index takeoff_item_send_parts_target_idx on public.takeoff_item_send_parts (target_id) where state = 'live';
create index takeoff_item_send_parts_version_idx on public.takeoff_item_send_parts (version_id, item_id);
create index takeoff_item_send_parts_receipt_idx on public.takeoff_item_send_parts (receipt_id);
create index takeoff_item_send_parts_replaced_idx on public.takeoff_item_send_parts (replaced_by_receipt_id)
  where replaced_by_receipt_id is not null;

-- 5. The sections a send created, by their identity in the list (lot then family, then the compartment), reusable by
--    the next send while they are in the draft.
create table public.takeoff_item_send_sections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  version_id uuid not null references public.estimate_versions (id) on delete cascade,
  section_key text not null check (pg_catalog.char_length(section_key) between 1 and 2000),
  title text not null check (pg_catalog.char_length(title) between 1 and 4000),
  estimate_item_id uuid references public.estimate_items (id) on delete set null,
  receipt_id uuid not null,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  constraint takeoff_item_send_sections_receipt_fkey foreign key (receipt_id, tenant_id, project_id, version_id)
    references public.takeoff_item_send_receipts (id, tenant_id, project_id, version_id) on delete cascade
    deferrable initially deferred
);
create unique index takeoff_item_send_sections_live_key on public.takeoff_item_send_sections (version_id, section_key)
  where estimate_item_id is not null;
create unique index takeoff_item_send_sections_line_key on public.takeoff_item_send_sections (estimate_item_id)
  where estimate_item_id is not null;
create index takeoff_item_send_sections_receipt_idx on public.takeoff_item_send_sections (receipt_id);

-- 6. The page contributions of a send: one per page of the plan it brought into the draft, with the items and the parts
--    it holds there, derived by the command from the parts it writes (never taken from the caller). A page whose parts
--    are all replaced is no longer in the draft by this send.
create table public.takeoff_item_send_pages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  version_id uuid not null references public.estimate_versions (id) on delete cascade,
  receipt_id uuid not null,
  job_id uuid not null,
  -- The plan's document as the page guard compares it: its copy, its bytes, its plan reference and its name.
  document jsonb not null check (pg_catalog.jsonb_typeof(document) = 'object'),
  -- Null: a part whose page is unknown, which stands on every page of the plan.
  page integer check (page > 0),
  item_ids uuid[] not null,
  part_ids uuid[] not null,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  constraint takeoff_item_send_pages_receipt_fkey foreign key (receipt_id, tenant_id, project_id, version_id)
    references public.takeoff_item_send_receipts (id, tenant_id, project_id, version_id) on delete cascade
    deferrable initially deferred
);
create unique index takeoff_item_send_pages_page_key on public.takeoff_item_send_pages (receipt_id, coalesce(page, 0));
create index takeoff_item_send_pages_version_idx on public.takeoff_item_send_pages (version_id);

do $$
declare
  relation text;
begin
  foreach relation in array array['takeoff_item_send_receipts', 'takeoff_item_send_targets', 'takeoff_item_send_parts',
    'takeoff_item_send_sections', 'takeoff_item_send_pages']
  loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', relation);
    -- The service role keeps its table rights, as on every public table; its direct write is refused by the trigger.
    execute format('grant select on public.%I to authenticated', relation);
    execute format('grant select, insert, update, delete on public.%I to service_role', relation);
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function '
      || 'private.guard_takeoff_item_send_write()', relation || '_writer', relation);
    -- Read like the affaire (the rule of its answers, its decisions and its list).
    execute format('create policy %I on public.%I for select to authenticated using '
      || '((select private.can_access_takeoff_scope(tenant_id, project_id, null, false)))', relation || '_reader_select',
      relation);
  end loop;
end;
$$;

-- 7. The door of the link: a job read against a list is linked to its version by the send by item only, in that
--    transaction (its row here, with the acting member, removed once the job is applied). Only the command writes it
--    (no role has a right on it: revoked privileges, no RLS needed); the guard of the applied job reads the member there
--    when the command runs under the service role.
create table private.takeoff_item_send_checks (
  job_id uuid primary key,
  actor_id uuid not null,
  xact xid8 not null default pg_catalog.pg_current_xact_id()
);
revoke all on table private.takeoff_item_send_checks from public, anon, authenticated, service_role;

-- From 20261122030312_takeoff_partial_send.sql (its latest body); the branch of a job read against a list is added
-- first, the rest is unchanged.
create or replace function private.guard_takeoff_plan_unit_send()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.takeoff_launch_requests as request_row
      where request_row.id = new.launch_request_id and request_row.item_list_revision_id is not null) then
    if not exists (select 1 from private.takeoff_item_send_checks as checked
        where checked.job_id = new.id and checked.xact = pg_catalog.pg_current_xact_id()) then
      raise exception 'TAKEOFF_SEND_JOB_NOT_READY' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'item_list_job')::text;
    end if;
    return new;
  end if;
  if private.takeoff_job_is_plan_unit(new.launch_request_id) then
    if not exists (select 1 from private.takeoff_plan_send_checks as checked
        where checked.job_id = new.id and checked.xact = pg_catalog.pg_current_xact_id()) then
      raise exception 'TAKEOFF_SEND_JOB_NOT_READY' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'plan_context_unchecked')::text;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_takeoff_plan_unit_send() from public, anon, authenticated, service_role;

-- From 20261121050138_takeoff_send_receipts.sql (its only body): a job a send by item proves sent keeps the affaire's
-- readers too.
create or replace function private.can_read_sent_takeoff_job(p_tenant_id uuid, p_project_id uuid, p_job_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (exists (
      select 1 from public.takeoff_send_receipts as receipt
      where receipt.job_id = p_job_id and receipt.tenant_id = p_tenant_id and receipt.project_id = p_project_id
        and receipt.command_kind = 'send')
    or exists (
      select 1 from public.takeoff_item_send_receipts as receipt
      where receipt.job_id = p_job_id and receipt.tenant_id = p_tenant_id and receipt.project_id = p_project_id
        and receipt.command_kind = 'send'))
    and private.can_access_takeoff_scope(p_tenant_id, p_project_id, null, false)
$$;
revoke all on function private.can_read_sent_takeoff_job(uuid, uuid, uuid) from public, anon;
grant execute on function private.can_read_sent_takeoff_job(uuid, uuid, uuid) to authenticated;

-- From 20261121050138_takeoff_send_receipts.sql (its latest body): the plans a reader of the affaire may open as
-- evidence of a job. A job a send by item proves sent keeps them, as a job today's send proves sent does.
create or replace function private.can_read_takeoff_plan_evidence(
  p_tenant_id uuid, p_plan_set_id uuid, p_file_id uuid, p_path text
) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.plan_sets s
    join public.takeoff_jobs j on j.plan_set_id = s.id and j.tenant_id = s.tenant_id and j.project_id = s.project_id
    where s.id = p_plan_set_id and s.tenant_id = p_tenant_id
      and (j.estimate_version_id is null or exists (
        select 1 from public.takeoff_send_receipts as receipt
        where receipt.job_id = j.id and receipt.tenant_id = j.tenant_id and receipt.command_kind = 'send')
        or exists (
        select 1 from public.takeoff_item_send_receipts as receipt
        where receipt.job_id = j.id and receipt.tenant_id = j.tenant_id and receipt.command_kind = 'send'))
      and private.can_access_takeoff_scope(j.tenant_id, j.project_id, null, false)
      and (p_file_id is null or j.preparation_snapshot #> '{preparation,sources}' @> jsonb_build_array(
        jsonb_build_object('document_id', p_file_id, 'plan_set_id', s.id, 'file_path', p_path,
          'kind', 'plan', 'active', true, 'confirmed', true)))
  )
$$;

-- From 20261110094504_takeoff_apply_force_reasons.sql (its latest body): the guard of a job that becomes applied. For a
-- job read against the list (lot 4), only the rows its send by item brought into the draft are judged; any other job is
-- refused on a version fed item by item, and judged exactly as before on every other version. Under the service role, the
-- member is the one the send by item names in its door. The lines marked « Lot 4 » change, nothing else.
create or replace function public.enforce_takeoff_apply_security()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := (select auth.uid());
  configured_threshold text;
  low_confidence_threshold numeric;
  blocked_ids uuid[] := '{}'::uuid[];
  blocked_items_count integer := 0;
  has_valid_override boolean := false;
  override_audit_id uuid;
  -- Lot 4: a job read against the affaire's list.
  item_list_job boolean;
begin
  if new.status = 'applied' and old.status is distinct from new.status then
    -- Lot 4: under the service role, the send by item names its acting member in the door of this transaction, which
    -- only it writes; any other caller without a session is refused as before.
    if caller_id is null then
      select checked.actor_id into caller_id from private.takeoff_item_send_checks as checked
      where checked.job_id = new.id and checked.xact = pg_catalog.pg_current_xact_id();
    end if;
    if caller_id is null then
      raise exception 'TAKEOFF_APPLY_AUTH_REQUIRED' using errcode = 'P0001';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended('takeoff-job:' || new.id::text, 0)
    );

    if not exists (
      select 1
      from public.draft_locks dl
      where dl.version_id = new.estimate_version_id
        and dl.tenant_id = new.tenant_id
        and dl.user_id = caller_id
        and dl.expires_at > statement_timestamp()
    ) then
      raise exception 'TAKEOFF_APPLY_LOCK_REQUIRED' using errcode = 'P0001';
    end if;

    select ff.value
      into configured_threshold
    from public.feature_flags ff
    where ff.tenant_id = new.tenant_id
      and ff.flag_key = 'TAKEOFF_LOW_CONFIDENCE_THRESHOLD'
      and ff.enabled = true
    limit 1;

    -- TI-677: read as the TS guard reads it (parseLowConfidenceThreshold), so both block the same lines and an
    -- admin override's audit carries this exact value.
    low_confidence_threshold := public.takeoff_low_confidence_threshold(configured_threshold);

    -- Lot 4: a job read against the list enters the estimate by its send by item, whose parts name the rows it brought
    -- (each verified by its acceptance); the rows of the items it left out never enter it and are not judged here.
    item_list_job := exists (select 1 from public.takeoff_launch_requests as request_row
      where request_row.id = new.launch_request_id and request_row.item_list_revision_id is not null);
    -- Lot 4: a version fed item by item (a live target of a send by item) receives no other takeoff. Today's writers do
    -- not read the pages and the parts of a send by item: they would count a page twice, or compose a DPGF line it fed
    -- without them. Every path that applies a takeoff job to a version passes here (today's send of a grouped analysis,
    -- of one plan or outside a request, the application of a job launched on a version, its DPGF composition): it is
    -- refused, nothing written. A version without a live target is judged exactly as before.
    if not item_list_job and exists (select 1 from public.takeoff_item_send_targets as target
        where target.version_id = new.estimate_version_id and target.estimate_item_id is not null) then
      raise exception 'TAKEOFF_APPLY_ITEM_SEND_VERSION' using errcode = 'P0001',
        detail = pg_catalog.jsonb_build_object('reason', 'item_send_version')::text;
    end if;

    select coalesce(array_agg(ti.id order by ti.id), '{}'::uuid[])
      into blocked_ids
    from public.takeoff_items ti
    where ti.job_id = new.id
      and ti.tenant_id = new.tenant_id
      and ti.is_excluded = false
      and (not item_list_job or ti.id in (select sent.id from public.takeoff_item_send_parts as part
        cross join lateral pg_catalog.unnest(part.takeoff_item_ids) as sent(id)
        where part.job_id = new.id and part.tenant_id = new.tenant_id and part.state = 'live'))
      and (
        (
          new.level = 'C'
          and (
            (
              ti.is_verified = false
              and (
                false -- TI-681: confidence recommends review, never blocks application.
              )
            )
            or nullif(btrim(ti.evidence), '') is null
            or ti.source_page is null
            or ti.source_page < 1
          )
        )
        or public.takeoff_item_rule_blocked(ti.rule_results, ti.rules_stale, ti.is_verified)
      );
    blocked_items_count := cardinality(blocked_ids);

    if blocked_items_count > 0 then
      if (select public.has_tenant_role(
        new.tenant_id,
        array['admin'::public.tenant_role]
      )) then
        select al.id
          into override_audit_id
        from public.audit_logs al
        where al.action = 'takeoff.apply.override'
          and al.table_name = 'takeoff_jobs'
          and al.record_id = new.id
          and al.estimate_version_id = new.estimate_version_id
          and al.tenant_id = new.tenant_id
          and al.user_id = caller_id
          and al.created_at >= statement_timestamp() - interval '15 minutes'
          and al.created_at <= statement_timestamp() + interval '5 seconds'
          and al.after_data ->> 'action' = 'takeoff.apply.override'
          and al.after_data ->> 'job_id' = new.id::text
          and al.after_data ->> 'tenant_id' = new.tenant_id::text
          and al.after_data ->> 'user_id' = caller_id::text
          and jsonb_typeof(
            al.after_data -> 'metadata' -> 'blocked_item_ids'
          ) = 'array'
          and jsonb_array_length(
            al.after_data -> 'metadata' -> 'blocked_item_ids'
          ) = (
            al.after_data -> 'metadata' ->> 'blocked_items_count'
          )::integer
          and coalesce(
            al.after_data -> 'metadata' ->> 'blocked_items_count',
            ''
          ) ~ '^[0-9]+$'
          and (
            al.after_data -> 'metadata' ->> 'blocked_items_count'
          )::integer = blocked_items_count
          and coalesce(
            al.after_data -> 'metadata' ->> 'threshold',
            ''
          ) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
          and (
            al.after_data -> 'metadata' ->> 'threshold'
          )::numeric = low_confidence_threshold
          -- TI-686 D10 (H7, H10): no job-level justification any more (an audit that keeps one is the former format,
          -- refused); each justification stored once, of 10 to 500 characters once its blanks are trimmed (the TS
          -- noteText rule).
          and not (al.after_data -> 'metadata' ? 'justification')
          and jsonb_typeof(al.after_data -> 'metadata' -> 'forced_justifications') = 'array'
          and jsonb_array_length(
            case when jsonb_typeof(al.after_data -> 'metadata' -> 'forced_justifications') = 'array'
              then al.after_data -> 'metadata' -> 'forced_justifications' else '[]'::jsonb end
          ) > 0
          and not exists (
            select 1
            from jsonb_array_elements(
              case when jsonb_typeof(al.after_data -> 'metadata' -> 'forced_justifications') = 'array'
                then al.after_data -> 'metadata' -> 'forced_justifications' else '[]'::jsonb end
            ) as justification(value)
            where jsonb_typeof(justification.value) is distinct from 'string'
              or char_length(regexp_replace(justification.value #>> '{}', '^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$', '', 'g'))
                not between 10 and 500
          )
          and not exists (
            select 1
            from unnest(blocked_ids) as blocked(id)
            where not (
              al.after_data -> 'metadata' -> 'blocked_item_ids'
            ) ? blocked.id::text
          )
          -- TI-677 (PR D): each lifted line as the override recorded it.
          and jsonb_typeof(al.after_data -> 'metadata' -> 'blocked_items_state') = 'array'
          and jsonb_array_length(
            case when jsonb_typeof(al.after_data -> 'metadata' -> 'blocked_items_state') = 'array'
              then al.after_data -> 'metadata' -> 'blocked_items_state' else '[]'::jsonb end
          ) = blocked_items_count
          and not exists (
            select 1
            from public.takeoff_items ti
            where ti.id = any(blocked_ids)
              and ti.tenant_id = new.tenant_id
              and not exists (
                select 1
                from jsonb_array_elements(
                  case when jsonb_typeof(al.after_data -> 'metadata' -> 'blocked_items_state') = 'array'
                    then al.after_data -> 'metadata' -> 'blocked_items_state' else '[]'::jsonb end
                ) as state(value)
                where public.takeoff_apply_override_state_holds(state.value, ti)
              )
          )
          -- TI-686 D10: one forced entry per blocked line (as many entries as blocked lines, each line found: no
          -- duplicate, no entry for another line), its coded reason holding for the line as it is now.
          and jsonb_typeof(al.after_data -> 'metadata' -> 'forced_items') = 'array'
          and jsonb_array_length(
            case when jsonb_typeof(al.after_data -> 'metadata' -> 'forced_items') = 'array'
              then al.after_data -> 'metadata' -> 'forced_items' else '[]'::jsonb end
          ) = blocked_items_count
          and not exists (
            select 1
            from public.takeoff_items ti
            where ti.id = any(blocked_ids)
              and ti.tenant_id = new.tenant_id
              and not exists (
                select 1
                from jsonb_array_elements(
                  case when jsonb_typeof(al.after_data -> 'metadata' -> 'forced_items') = 'array'
                    then al.after_data -> 'metadata' -> 'forced_items' else '[]'::jsonb end
                ) as forced(value)
                where forced.value ->> 'item_id' = ti.id::text
                  and private.takeoff_apply_forced_item_valid(
                    forced.value, ti, al.after_data -> 'metadata' -> 'forced_justifications'
                  )
              )
          )
          and not exists (
            select 1
            from public.takeoff_apply_override_consumptions consumed
            where consumed.audit_log_id = al.id
          )
        order by al.created_at desc, al.id desc
        limit 1;

        has_valid_override := override_audit_id is not null;
      end if;

      if not has_valid_override then
        raise exception 'TAKEOFF_APPLY_GUARD_FAILED' using errcode = 'P0001';
      end if;

      insert into public.takeoff_apply_override_consumptions (
        audit_log_id,
        tenant_id,
        job_id,
        estimate_version_id,
        user_id
      )
      values (
        override_audit_id,
        new.tenant_id,
        new.id,
        new.estimate_version_id,
        caller_id
      );
    end if;
  end if;

  return new;
end;
$$;
revoke all on function public.enforce_takeoff_apply_security()
  from public, anon, authenticated, service_role;

-- 8. The arithmetic the planner applies (src/lib/takeoff/item-send-plan.ts, page-replacement.ts, dpgf-composition.ts),
--    in SQL: the twin vectors of supabase/tests/database/takeoff-item-send.test.sql run both.
-- Metres per unit of a length (lengthFactor: the factor finalize_takeoff_lengths rounds with), null for any other unit.
create function private.takeoff_item_send_length_factor(p_unit text)
returns numeric language sql stable set search_path = '' as $$
  select case coalesce((private.normalize_unit(p_unit)).unit_code, private.unit_token(p_unit))
    when 'm' then 1::numeric when 'ml' then 1::numeric when 'metre' then 1::numeric when 'metres' then 1::numeric
    when 'cm' then 0.01::numeric when 'mm' then 0.001::numeric when 'km' then 1000::numeric end
$$;
revoke all on function private.takeoff_item_send_length_factor(text) from public, anon, authenticated, service_role;

-- A quantity as the estimate holds it (roundedMeasure, then round4): a length rounded up once to its unit, on the sum.
create function private.takeoff_item_send_rounded(p_quantity numeric, p_factor numeric)
returns numeric language sql immutable set search_path = '' as $$
  select pg_catalog.trim_scale(pg_catalog.round(case when p_factor is null then p_quantity
    else pg_catalog.ceil(p_quantity * p_factor) / p_factor end, 4))
$$;
revoke all on function private.takeoff_item_send_rounded(numeric, numeric) from public, anon, authenticated, service_role;

-- What a composition writes on a line (composeDpgfTarget, then the rounding of a length): the protective maximum of the
-- DPGF reference and the measures with their protective parts, each sum rounded to 4 places, then rounded once.
create function private.takeoff_item_send_composed(p_reference numeric, p_measured numeric, p_protective numeric,
  p_factor numeric)
returns numeric language sql immutable set search_path = '' as $$
  select private.takeoff_item_send_rounded(pg_catalog.round(greatest(coalesce(p_reference, 0),
    pg_catalog.round(p_measured, 4) + pg_catalog.round(p_protective, 4)), 4), p_factor)
$$;
revoke all on function private.takeoff_item_send_composed(numeric, numeric, numeric, numeric)
  from public, anon, authenticated, service_role;

-- What a DPGF line holds of the takeoffs of the first format (readStoredDpgfComposition, then upgradeDpgfComposition
-- without its lines: a version 1 policy is one block), each part with its measure and its protective part; the parts of
-- p_job_id are left out (storedParts).
create function private.takeoff_item_send_legacy_dpgf_parts(p_metadata jsonb, p_job_id uuid)
returns table (quantity numeric, protective numeric)
language sql immutable set search_path = '' as $$
  with policy as (
    select case when pg_catalog.jsonb_typeof(p_metadata -> 'takeoff_quantity_policy') = 'object'
      then p_metadata -> 'takeoff_quantity_policy' end as value
  )
  select (part.value ->> 'quantity')::numeric,
    case when pg_catalog.jsonb_typeof(part.value -> 'protective') = 'number' then (part.value ->> 'protective')::numeric else 0 end
  from policy cross join lateral pg_catalog.jsonb_array_elements(case when policy.value -> 'version' = '2'::jsonb
      and pg_catalog.jsonb_typeof(policy.value -> 'contributions') = 'array' then policy.value -> 'contributions'
      else '[]'::jsonb end) as part(value)
  where pg_catalog.jsonb_typeof(part.value -> 'job_id') = 'string'
    and pg_catalog.jsonb_typeof(part.value -> 'item_ids') = 'array' and pg_catalog.jsonb_array_length(part.value -> 'item_ids') > 0
    and not exists (select 1 from pg_catalog.jsonb_array_elements(part.value -> 'item_ids') as id(value)
      where pg_catalog.jsonb_typeof(id.value) <> 'string')
    and pg_catalog.jsonb_typeof(part.value -> 'quantity') = 'number'
    and part.value ->> 'job_id' is distinct from p_job_id::text
  union all
  select (policy.value ->> 'measured_quantity')::numeric,
    case when (policy.value ->> 'priced_quantity')::numeric > greatest(coalesce(case when pg_catalog.jsonb_typeof(
        policy.value -> 'reference_quantity') = 'number' then (policy.value ->> 'reference_quantity')::numeric end, 0),
        (policy.value ->> 'measured_quantity')::numeric)
      then (policy.value ->> 'priced_quantity')::numeric - (policy.value ->> 'measured_quantity')::numeric else 0 end
  from policy
  where policy.value -> 'version' is distinct from '2'::jsonb
    and pg_catalog.jsonb_typeof(policy.value -> 'job_id') = 'string'
    and pg_catalog.jsonb_typeof(policy.value -> 'item_ids') = 'array'
    and not exists (select 1 from pg_catalog.jsonb_array_elements(policy.value -> 'item_ids') as id(value)
      where pg_catalog.jsonb_typeof(id.value) <> 'string')
    and pg_catalog.jsonb_typeof(policy.value -> 'measured_quantity') = 'number'
    and pg_catalog.jsonb_typeof(policy.value -> 'priced_quantity') = 'number'
    and policy.value ->> 'job_id' is distinct from p_job_id::text
$$;
revoke all on function private.takeoff_item_send_legacy_dpgf_parts(jsonb, uuid) from public, anon, authenticated, service_role;

-- A quantity as the planner reads one (parseQuantity, src/lib/numeric-input/parsers.ts): a JSON number, rounded half
-- away from zero to three decimals; a text of the French entry grammar (a decimal comma or dot, groups of three digits
-- separated by spaces, narrow or non-breaking spaces, apostrophes or the other separator; a lone dot followed by three
-- digits is not read as thousands), three decimals at most. Null otherwise. Twin vectors in takeoff-item-send.test.sql.
create function private.takeoff_item_send_parse_quantity(p_value jsonb)
returns numeric language plpgsql immutable set search_path = '' as $$
declare
  text_ text;
  negative boolean := false;
  comma integer;
  dot integer;
  integer_ text;
  fraction text := '';
  grouping text;
  separators text;
  decimal_separator boolean := false;
begin
  if pg_catalog.jsonb_typeof(p_value) = 'number' then
    return pg_catalog.round((p_value #>> '{}')::numeric, 3);
  end if;
  if pg_catalog.jsonb_typeof(p_value) is distinct from 'string' then
    return null;
  end if;
  -- Trimmed of what String.prototype.trim removes.
  text_ := pg_catalog.btrim(pg_catalog.translate(p_value #>> '{}', '−–—', '---'),
    E' \t\n\r\f\u000b\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff');
  if text_ = '' then
    return null;
  end if;
  if pg_catalog.left(text_, 1) in ('+', '-') then
    negative := pg_catalog.left(text_, 1) = '-';
    text_ := pg_catalog.substr(text_, 2);
  end if;
  if text_ !~ E'^[0-9., \'\u00a0\u202f’]+$' then
    return null;
  end if;
  text_ := pg_catalog.replace(pg_catalog.translate(text_, E'\u00a0\u202f', '  '), '’', '''');
  comma := pg_catalog.length(text_) - pg_catalog.strpos(pg_catalog.reverse(text_), ',') + 1;
  dot := pg_catalog.length(text_) - pg_catalog.strpos(pg_catalog.reverse(text_), '.') + 1;
  if pg_catalog.strpos(text_, ',') = 0 then comma := 0; end if;
  if pg_catalog.strpos(text_, '.') = 0 then dot := 0; end if;
  integer_ := text_;
  if comma > 0 and dot > 0 then
    decimal_separator := true;
    integer_ := pg_catalog.substr(text_, 1, greatest(comma, dot) - 1);
    fraction := pg_catalog.substr(text_, greatest(comma, dot) + 1);
    grouping := case when comma > dot then '.' else ',' end;
    if pg_catalog.strpos(integer_, case when comma > dot then ',' else '.' end) > 0 then
      return null;
    end if;
  elsif comma > 0 then
    decimal_separator := true;
    if pg_catalog.strpos(text_, ',') <> comma then
      return null;
    end if;
    integer_ := pg_catalog.substr(text_, 1, comma - 1);
    fraction := pg_catalog.substr(text_, comma + 1);
  elsif dot > 0 then
    if pg_catalog.strpos(text_, '.') <> dot then
      grouping := '.';
    else
      decimal_separator := true;
      integer_ := pg_catalog.substr(text_, 1, dot - 1);
      fraction := pg_catalog.substr(text_, dot + 1);
      if pg_catalog.length(fraction) = 3 then
        return null;
      end if;
    end if;
  end if;
  if decimal_separator and fraction = '' then
    return null;
  end if;
  if fraction <> '' and fraction !~ '^[0-9]+$' then
    return null;
  end if;
  separators := pg_catalog.regexp_replace(integer_, '[0-9]', '', 'g');
  if separators <> '' then
    if pg_catalog.length(pg_catalog.translate(separators, pg_catalog.left(separators, 1), '')) > 0 then
      return null;
    end if;
    if pg_catalog.left(separators, 1) not in (' ', '''') and pg_catalog.left(separators, 1) is distinct from grouping then
      return null;
    end if;
    if integer_ !~ ('^[0-9]{1,3}([' || pg_catalog.left(separators, 1) || '][0-9]{3})*$') then
      return null;
    end if;
    integer_ := pg_catalog.regexp_replace(integer_, '[^0-9]', '', 'g');
  end if;
  if integer_ !~ '^[0-9]*$' or (integer_ = '' and fraction = '') then
    return null;
  end if;
  -- Three decimals at most, as written (trailing zeros aside): more is refused, never rounded.
  if pg_catalog.length(pg_catalog.rtrim(fraction, '0')) > 3 then
    return null;
  end if;
  return (case when negative then -1 else 1 end)
    * ((case when integer_ = '' then '0' else integer_ end) || case when fraction <> '' then '.' || fraction else '' end)::numeric;
end;
$$;
revoke all on function private.takeoff_item_send_parse_quantity(jsonb) from public, anon, authenticated, service_role;

-- The DPGF reference of a line, as the preview reads it (readDraft in item-send-preview-server.ts): the quantity its
-- import stated on it when that key holds a value (a number; any other value states none), else its mapped row's
-- quantity read by the same number rule. Null otherwise.
create function private.takeoff_item_send_dpgf_reference(p_tenant_id uuid, p_metadata jsonb)
returns numeric language sql stable security definer set search_path = '' as $$
  select case
    when coalesce(p_metadata -> 'dpgf_source_quantity', 'null'::jsonb) <> 'null'::jsonb then case
      when pg_catalog.jsonb_typeof(p_metadata -> 'dpgf_source_quantity') = 'number'
        then (p_metadata ->> 'dpgf_source_quantity')::numeric end
    else (select private.takeoff_item_send_parse_quantity(payload.value -> 'quantity')
      from public.dpgf_rows_mapped as mapped
      cross join lateral (select case when pg_catalog.jsonb_typeof(mapped.payload -> 'mapped_row') = 'object'
        then mapped.payload -> 'mapped_row' else mapped.payload end as value) as payload
      where mapped.tenant_id = p_tenant_id and mapped.id::text = pg_catalog.lower(p_metadata ->> 'mapped_row_id'))
  end
$$;
revoke all on function private.takeoff_item_send_dpgf_reference(uuid, jsonb) from public, anon, authenticated, service_role;

-- The parts a job's answers bring, read from what is stored, with the effective decision of B2 (an acceptance whose
-- positive rows a targeted correction no longer holds verified is none again: private.takeoff_item_table_pairs, read once
-- for the job's plan): for an item, the plan's entry when it has one (it stands for the answer, on every page of the
-- plan's unit), else each positive reviewed row of a measured answer accepted (its quantity, unit and page as the review
-- left them; an excluded row brings nothing). An item sends nothing when it is set aside, entered for the whole affaire,
-- entered as an hypothesis not included, measured but not accepted, or when its answer is no longer the current reading
-- of the item on the plan.
create function private.takeoff_item_send_job_parts(p_tenant_id uuid, p_project_id uuid, p_job_id uuid,
  p_unit_pages integer[])
returns table (item_id uuid, answer_id uuid, answer_revision text, plan_logical_id uuid, kind text, observation_id uuid,
  takeoff_item_id uuid, entry_id uuid, entry_revision integer, decision_revision integer, quantity numeric, unit text,
  pages integer[], basis text)
language sql stable security definer set search_path = '' as $$
  with answers as materialized (
    select a.* from public.takeoff_item_answers as a
    where a.job_id = p_job_id and a.tenant_id = p_tenant_id and a.project_id = p_project_id
  ), pairs as materialized (
    select p.* from (select distinct answers.plan_logical_id from answers) as plan_
    cross join lateral private.takeoff_item_table_pairs(p_tenant_id, p_project_id, plan_.plan_logical_id) as p
  ), sendable as (
    select a.*, pair.decision_effective, pair.decision_revision as effective_revision
    from answers as a join pairs as pair on pair.answer_id = a.id and pair.item_id = a.item_id
    where pair.decision_effective <> 'set_aside'
      and not exists (select 1 from public.takeoff_item_entries as whole where whole.tenant_id = p_tenant_id
        and whole.project_id = p_project_id and whole.item_id = a.item_id and whole.plan_logical_id is null)
  ), plan_entries as (
    select s.id as for_answer, e.* from sendable as s
    join public.takeoff_item_entries as e on e.tenant_id = p_tenant_id and e.project_id = p_project_id
      and e.item_id = s.item_id and e.plan_logical_id = s.plan_logical_id
  )
  select s.item_id, s.id, s.content_sha256, s.plan_logical_id, 'entered'::text, null::uuid, null::uuid, e.id, e.revision,
    null::integer, e.quantity, e.unit, array(select distinct x from pg_catalog.unnest(coalesce(p_unit_pages, '{}'::integer[])) as x
      order by 1), null::text
  from sendable as s join plan_entries as e on e.for_answer = s.id
  where e.included
  union all
  select s.item_id, s.id, s.content_sha256, s.plan_logical_id, 'measured', o.id, row_.id, null, null, s.effective_revision,
    row_.quantity, row_.unit, case when row_.source_page > 0 then array[row_.source_page] else '{}'::integer[] end,
    o.measurement_basis
  from sendable as s
  join public.takeoff_item_answer_observations as o on o.answer_id = s.id and o.role = 'contribution'
  join public.takeoff_items as row_ on row_.id = o.takeoff_item_id and row_.tenant_id = p_tenant_id
  where not exists (select 1 from plan_entries as e where e.for_answer = s.id) and s.outcome = 'measured'
    and s.decision_effective = 'accepted' and not row_.is_excluded and row_.quantity > 0
$$;
revoke all on function private.takeoff_item_send_job_parts(uuid, uuid, uuid, integer[])
  from public, anon, authenticated, service_role;

-- The quantitative identity of an item's parts, as the planner forms it (identityOf in item-send-plan.ts): the unit code
-- of the referential, the basis (the parts' one, else the item's) and the item's network, material and diameter, each
-- compared as the reading compares them: without case, accents or punctuation (folded), a diameter as written (only its
-- case and its spaces). Twin vectors in takeoff-item-send.test.sql.
create function private.takeoff_item_send_folded(p_value text)
returns text language sql immutable set search_path = '' as $$
  select nullif(pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.regexp_replace(
    normalize(coalesce(p_value, ''), NFD), '[̀-ͯ]', '', 'g')), '[^[:alnum:]]+', ' ', 'g')), '')
$$;
revoke all on function private.takeoff_item_send_folded(text) from public, anon, authenticated, service_role;

create function private.takeoff_item_send_diameter(p_value text)
returns text language sql immutable set search_path = '' as $$
  select nullif(pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(normalize(coalesce(p_value, ''), NFC), '\s+', ' ', 'g'))), '')
$$;
revoke all on function private.takeoff_item_send_diameter(text) from public, anon, authenticated, service_role;

-- The canonical unit of a spelling: the referential's code (m², M2 and m2 are one unit; « pièces » is u), else B2's unit
-- token. Provenance keeps the spelling.
create function private.takeoff_item_send_unit(p_unit text)
returns text language sql stable set search_path = '' as $$
  select coalesce((private.normalize_unit(p_unit)).unit_code, private.takeoff_unit_token(p_unit))
$$;
revoke all on function private.takeoff_item_send_unit(text) from public, anon, authenticated, service_role;

-- What a draft holds of earlier sends by item (ItemSendWritePlan.dependencies.earlier_targets): each live target with its
-- live parts, in one form; private.takeoff_item_send_earlier_form puts the plan's in the same form.
create function private.takeoff_item_send_earlier_targets(p_tenant_id uuid, p_version_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('estimate_item_id', t.estimate_item_id,
      'item_id', t.item_id, 'compartment_key', t.compartment_key, 'breakdown', t.breakdown,
      'parts', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('job_id', p.job_id, 'answer_id', p.answer_id,
          'observation_ids', pg_catalog.to_jsonb(array(select o from pg_catalog.unnest(p.observation_ids) as o order by o)),
          'quantity', pg_catalog.trim_scale(p.quantity),
          'pages', pg_catalog.to_jsonb(array(select distinct x from pg_catalog.unnest(p.pages) as x order by 1)),
          'plan_key', p.plan_logical_id,
          'identity', pg_catalog.jsonb_build_object('unit', p.unit_code, 'basis', p.basis, 'network', p.network,
            'material', p.material, 'diameter', p.diameter))
          order by p.job_id, p.answer_id, array(select o from pg_catalog.unnest(p.observation_ids) as o order by o))
        from public.takeoff_item_send_parts as p where p.target_id = t.id and p.state = 'live'), '[]'::jsonb))
    order by t.estimate_item_id, t.item_id, t.compartment_key), '[]'::jsonb)
  from public.takeoff_item_send_targets as t
  where t.tenant_id = p_tenant_id and t.version_id = p_version_id and t.estimate_item_id is not null
$$;
revoke all on function private.takeoff_item_send_earlier_targets(uuid, uuid) from public, anon, authenticated, service_role;

create function private.takeoff_item_send_earlier_form(p_plan_targets jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'estimate_item_id', private.takeoff_uuid_or_null(t.value -> 'estimate_item_id'),
      'item_id', private.takeoff_uuid_or_null(t.value -> 'item_id'), 'compartment_key', t.value ->> 'compartment_key',
      'breakdown', t.value ->> 'breakdown',
      'parts', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'job_id', private.takeoff_uuid_or_null(p.value -> 'job_id'),
          'answer_id', private.takeoff_uuid_or_null(p.value -> 'answer_id'),
          'observation_ids', pg_catalog.to_jsonb(array(select private.takeoff_uuid_or_null(o.value)
            from pg_catalog.jsonb_array_elements(p.value -> 'observation_ids') as o(value) order by 1)),
          'quantity', pg_catalog.trim_scale((p.value ->> 'quantity')::numeric),
          'pages', pg_catalog.to_jsonb(array(select distinct (g.value #>> '{}')::integer
            from pg_catalog.jsonb_array_elements(p.value -> 'pages') as g(value) order by 1)),
          'plan_key', private.takeoff_uuid_or_null(p.value -> 'plan_key'),
          'identity', pg_catalog.jsonb_build_object('unit', p.value #>> '{identity,unit}', 'basis', p.value #>> '{identity,basis}',
            'network', p.value #>> '{identity,network}', 'material', p.value #>> '{identity,material}',
            'diameter', p.value #>> '{identity,diameter}'))
          order by private.takeoff_uuid_or_null(p.value -> 'job_id'), private.takeoff_uuid_or_null(p.value -> 'answer_id'),
            array(select private.takeoff_uuid_or_null(o.value) from pg_catalog.jsonb_array_elements(p.value -> 'observation_ids') as o(value)
              order by 1))
        from pg_catalog.jsonb_array_elements(t.value -> 'parts') as p(value)), '[]'::jsonb))
    order by private.takeoff_uuid_or_null(t.value -> 'estimate_item_id'), private.takeoff_uuid_or_null(t.value -> 'item_id'),
      t.value ->> 'compartment_key'), '[]'::jsonb)
  from pg_catalog.jsonb_array_elements(p_plan_targets) as t(value)
$$;
revoke all on function private.takeoff_item_send_earlier_form(jsonb) from public, anon, authenticated, service_role;

-- 9. The page guard of a send by item: the pages of the plan's document (p_document) among p_pages that the draft already
--    holds from another analysis — through today's provenance of its lines (the shared reader,
--    private.takeoff_pages_already_in_estimate, given its inputs as private.takeoff_page_contributions builds them), or
--    through the live parts an earlier send by item brought there (its page contributions). One entry per page of the
--    plan (a page unknown on one side is the same page), with the earlier analyses, the estimate's lines there, whether
--    today's provenance holds it (a reading with no part per item) and each live part by item of an earlier send by item.
--    A line a send by item wrote names no page in today's provenance: it is read here once, through its parts.
create function private.takeoff_item_send_held_pages(p_tenant_id uuid, p_version_id uuid, p_job_id uuid, p_document jsonb,
  p_pages integer[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  estimate_lines jsonb;
  earlier_items jsonb;
  job_sources jsonb;
  new_lines jsonb;
  today_pages jsonb;
begin
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', item.id, 'source_provider', item.source_provider,
      'source_job_id', item.source_job_id, 'source_file_name', item.source_file_name, 'source_page', item.source_page,
      'source_metadata', item.source_metadata) order by item.id), '[]'::jsonb)
    into estimate_lines
  from public.estimate_items as item
  where item.version_id = p_version_id and item.tenant_id = p_tenant_id and item.source_job_id is not null
    and item.item_type = 'line'::public.estimate_item_type;
  with referenced as (
    select distinct source.id
    from pg_catalog.jsonb_array_elements(estimate_lines) as line(value)
    cross join lateral pg_catalog.unnest(private.takeoff_estimate_line_item_ids(line.value -> 'source_metadata',
      (line.value ->> 'source_job_id')::uuid)) as source(id)
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', item.id, 'job_id', item.job_id,
      'identity', private.takeoff_line_page_identity(item.source_file_name, item.source_page, item.metadata -> 'source_document',
        job.preparation_snapshot #> '{preparation,sources}')) order by item.id), '[]'::jsonb)
    into earlier_items
  from referenced
  join public.takeoff_items as item on item.id = referenced.id and item.tenant_id = p_tenant_id
  join public.takeoff_jobs as job on job.id = item.job_id and job.tenant_id = p_tenant_id;
  select coalesce(pg_catalog.jsonb_object_agg(job.id::text, coalesce(job.preparation_snapshot #> '{preparation,sources}', '[]'::jsonb)),
      '{}'::jsonb)
    into job_sources
  from public.takeoff_jobs as job
  where job.tenant_id = p_tenant_id and job.id in (select (line.value ->> 'source_job_id')::uuid
    from pg_catalog.jsonb_array_elements(estimate_lines) as line(value));
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', 'page:' || coalesce(page.value::text, 'all'),
      'identity', pg_catalog.jsonb_build_object('document', p_document, 'page', page.value)) order by page.value), '[]'::jsonb)
    into new_lines
  from (select distinct x.value from pg_catalog.unnest(case when pg_catalog.cardinality(p_pages) > 0 then p_pages
    else array[null::integer] end) as x(value)) as page;
  today_pages := private.takeoff_pages_already_in_estimate(p_job_id, new_lines, estimate_lines, earlier_items, job_sources);

  return (
    with wanted as (
      select distinct x.value as page from pg_catalog.unnest(case when pg_catalog.cardinality(p_pages) > 0 then p_pages
        else array[null::integer] end) as x(value)
    ), today as (
      select w.page, earlier.value ->> 'job_id' as job_id, line.value #>> '{}' as estimate_item_id
      from wanted as w
      cross join lateral pg_catalog.jsonb_array_elements(today_pages -> 'pages') as listed(value)
      cross join lateral pg_catalog.jsonb_array_elements(listed.value -> 'earlier') as earlier(value)
      cross join lateral pg_catalog.jsonb_array_elements(earlier.value -> 'estimate_item_ids') as line(value)
      where listed.value -> 'item_ids' ? ('page:' || coalesce(w.page::text, 'all'))
    ), parts as (
      select distinct w.page, part.id as part_id, part.job_id, part.item_id, part.plan_logical_id, part.pages,
        target.estimate_item_id, part.answer_id, part.observation_ids
      from wanted as w
      join public.takeoff_item_send_pages as row_ on row_.tenant_id = p_tenant_id and row_.version_id = p_version_id
        and row_.job_id <> p_job_id
        and private.takeoff_same_page(pg_catalog.jsonb_build_object('document', p_document, 'page', w.page),
          pg_catalog.jsonb_build_object('document', row_.document, 'page', row_.page))
      join public.takeoff_item_send_parts as part on part.id = any(row_.part_ids) and part.state = 'live'
      join public.takeoff_item_send_targets as target on target.id = part.target_id and target.estimate_item_id is not null
    ), held as (
      select today.page from today union select parts.page from parts
    )
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('page', h.page,
        'earlier_job_ids', pg_catalog.to_jsonb(array(select j from (select t.job_id as j from today as t
            where t.page is not distinct from h.page union select p.job_id::text from parts as p where p.page is not distinct from h.page)
          as jobs order by j)),
        'estimate_item_ids', pg_catalog.to_jsonb(array(select l from (select t.estimate_item_id as l from today as t
            where t.page is not distinct from h.page union select p.estimate_item_id::text from parts as p
            where p.page is not distinct from h.page) as lines order by l)),
        'today', exists (select 1 from today as t where t.page is not distinct from h.page),
        'today_estimate_item_ids', pg_catalog.to_jsonb(array(select distinct t.estimate_item_id from today as t
          where t.page is not distinct from h.page order by 1)),
        'parts', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('part_id', p.part_id, 'job_id', p.job_id,
            'item_id', p.item_id, 'plan_key', p.plan_logical_id, 'pages', pg_catalog.to_jsonb(p.pages),
            'estimate_item_id', p.estimate_item_id, 'answer_id', p.answer_id,
            'observation_ids', pg_catalog.to_jsonb(array(select o from pg_catalog.unnest(p.observation_ids) as o order by o)))
            order by p.part_id)
          from parts as p where p.page is not distinct from h.page), '[]'::jsonb))
      order by h.page nulls last), '[]'::jsonb)
    from held as h
  );
end;
$$;
revoke all on function private.takeoff_item_send_held_pages(uuid, uuid, uuid, jsonb, integer[])
  from public, anon, authenticated, service_role;

-- The plan a job read, from its request's sealed manifest (lot 3 format 2, lot 4 order): its manifest entry, the pages
-- its unit reads (all of them when it names none: 1 to its page count) and its document as the page guard compares it
-- (its copy, its bytes, the plan reference its preparation gives, its name). The writer and the readers of the preview
-- read it here, once.
create function private.takeoff_item_send_plan_read(p_job public.takeoff_jobs, p_manifest jsonb)
returns table (plan_entry jsonb, unit_pages integer[], document jsonb)
language sql stable set search_path = '' as $$
  with unit_ as (
    select unit_row.value from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_manifest -> 'units') = 'array'
      then p_manifest -> 'units' else '[]'::jsonb end) as unit_row(value)
    where unit_row.value ->> 'key' = p_job.launch_unit_key limit 1
  ), plan_ as (
    select plan_row.value from unit_, pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_manifest -> 'plans') = 'array'
      then p_manifest -> 'plans' else '[]'::jsonb end) as plan_row(value)
    where plan_row.value ->> 'entry_key' = unit_.value #>> '{plans,0}' limit 1
  )
  select plan_.value,
    case when pg_catalog.jsonb_array_length(coalesce(unit_.value -> 'pages', '[]'::jsonb)) > 0
      then array(select distinct (page.value #>> '{}')::integer from pg_catalog.jsonb_array_elements(unit_.value -> 'pages') as page(value)
        order by 1)
      when pg_catalog.jsonb_typeof(unit_.value -> 'page_count') = 'number'
        then array(select pg_catalog.generate_series(1, (unit_.value ->> 'page_count')::integer)) else '{}'::integer[] end,
    pg_catalog.jsonb_build_object('plan_file_id', plan_.value ->> 'plan_file_id', 'content_hash', plan_.value ->> 'content_sha256',
      'logical_document_id', (select private.takeoff_text_or_null(source.value -> 'logical_document_id')
        from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_job.preparation_snapshot #> '{preparation,sources}') = 'array'
          then p_job.preparation_snapshot #> '{preparation,sources}' else '[]'::jsonb end) as source(value)
        where pg_catalog.lower(source.value ->> 'document_id') = pg_catalog.lower(plan_.value ->> 'plan_file_id') limit 1),
      'file_name', plan_.value ->> 'name')
  from unit_ cross join plan_
$$;
revoke all on function private.takeoff_item_send_plan_read(public.takeoff_jobs, jsonb) from public, anon, authenticated, service_role;

-- The pages the page guard reads for a job: every page of its plan's unit and every page one of its parts names.
create function private.takeoff_item_send_guard_pages(p_unit_pages integer[], p_job_parts jsonb)
returns integer[] language sql immutable set search_path = '' as $$
  select array(select distinct x from pg_catalog.unnest(coalesce(p_unit_pages, '{}'::integer[]) || array(
    select (page.value #>> '{}')::integer from pg_catalog.jsonb_array_elements(coalesce(p_job_parts, '[]'::jsonb)) as stored(value)
    cross join lateral pg_catalog.jsonb_array_elements(stored.value -> 'pages') as page(value))) as x order by 1)
$$;
revoke all on function private.takeoff_item_send_guard_pages(integer[], jsonb) from public, anon, authenticated, service_role;

-- 10. The shape of a plan (ItemSendWritePlan, format takeoff_item_send version 1): every field the command reads, of its
--     type and within its bounds. A plan that does not have it is refused before any lock.
create function private.takeoff_item_send_uuid(p_value jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select pg_catalog.jsonb_typeof(p_value) = 'string'
    and (p_value #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$$;
revoke all on function private.takeoff_item_send_uuid(jsonb) from public, anon, authenticated, service_role;

create function private.takeoff_item_send_text(p_value jsonb, p_max integer)
returns boolean language sql immutable set search_path = '' as $$
  select pg_catalog.jsonb_typeof(p_value) = 'string' and pg_catalog.char_length(p_value #>> '{}') between 1 and p_max
$$;
revoke all on function private.takeoff_item_send_text(jsonb, integer) from public, anon, authenticated, service_role;

create function private.takeoff_item_send_plan_valid(p_plan jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select pg_catalog.jsonb_typeof(p_plan) = 'object' and pg_catalog.octet_length(p_plan::text) <= 8388608
    and p_plan ->> 'format' = 'takeoff_item_send' and p_plan -> 'version' = '1'::jsonb and p_plan -> 'engine' = '3'::jsonb
    and private.takeoff_item_send_uuid(p_plan -> 'job_id') and private.takeoff_item_send_uuid(p_plan -> 'plan_key')
    and private.takeoff_item_send_uuid(p_plan #> '{list,revision_id}')
    and pg_catalog.jsonb_typeof(p_plan #> '{list,revision}') = 'number'
    and ((p_plan #>> '{destination,kind}' = 'existing_draft' and private.takeoff_item_send_uuid(p_plan #> '{destination,version_id}'))
      or (p_plan #>> '{destination,kind}' = 'first_draft' and (p_plan -> 'destination') - 'kind' = '{}'::jsonb))
    and coalesce(p_plan ->> 'breakdown' in ('together', 'by_level', 'by_building'), false)
    and pg_catalog.jsonb_typeof(p_plan -> 'sections') = 'array' and pg_catalog.jsonb_array_length(p_plan -> 'sections') <= 500
    and pg_catalog.jsonb_typeof(p_plan -> 'targets') = 'array'
    and pg_catalog.jsonb_array_length(p_plan -> 'targets') between 1 and 2000
    and pg_catalog.jsonb_typeof(p_plan -> 'page_contributions') = 'array'
    and pg_catalog.jsonb_typeof(p_plan -> 'page_decisions') = 'array'
    and pg_catalog.jsonb_typeof(p_plan -> 'left_out') = 'array' and pg_catalog.jsonb_typeof(p_plan -> 'parts_not_sent') = 'array'
    and pg_catalog.jsonb_typeof(p_plan -> 'dependencies') = 'object'
    and pg_catalog.jsonb_typeof(p_plan #> '{dependencies,answers}') = 'array'
    and pg_catalog.jsonb_typeof(p_plan #> '{dependencies,affaire_entries}') = 'array'
    and pg_catalog.jsonb_typeof(p_plan #> '{dependencies,rules}') = 'array'
    and pg_catalog.jsonb_typeof(p_plan #> '{dependencies,plan_pages}') = 'array'
    and pg_catalog.jsonb_typeof(p_plan #> '{dependencies,earlier_targets}') = 'array'
    and pg_catalog.jsonb_typeof(p_plan #> '{dependencies,lines}') = 'array'
    and pg_catalog.jsonb_typeof(p_plan #> '{dependencies,pages_in_estimate}') = 'array'
    and pg_catalog.jsonb_typeof(p_plan #> '{dependencies,resolutions}') = 'array'
    and pg_catalog.jsonb_typeof(p_plan #> '{dependencies,stamps}') = 'object'
    and pg_catalog.jsonb_typeof(p_plan #> '{dependencies,stamps,dpgf}') = 'array'
    and not exists (select 1 from pg_catalog.jsonb_array_elements(p_plan -> 'targets') as t(value)
      where (pg_catalog.jsonb_typeof(t.value) = 'object' and private.takeoff_item_send_text(t.value -> 'key', 1000)
        and private.takeoff_item_send_uuid(t.value -> 'item_id') and private.takeoff_item_send_text(t.value -> 'compartment_key', 400)
        and private.takeoff_item_send_text(t.value -> 'unit_code', 32) and pg_catalog.jsonb_typeof(t.value -> 'quantity_after') = 'number'
        and pg_catalog.jsonb_typeof(t.value -> 'quantity') = 'object'
        and coalesce(pg_catalog.jsonb_typeof(t.value -> 'rule'), 'null') in ('null', 'object')
        and pg_catalog.jsonb_typeof(t.value -> 'replaces') = 'array'
        and ((t.value #>> '{line,kind}' in ('dpgf_line', 'earlier_line')
            and private.takeoff_item_send_uuid(t.value #> '{line,estimate_item_id}')
            and pg_catalog.jsonb_typeof(t.value #> '{line,expected_updated_at}') = 'string'
            and pg_catalog.jsonb_typeof(t.value #> '{line,expected_quantity}') = 'number')
          or (t.value #>> '{line,kind}' = 'new_line' and private.takeoff_item_send_text(t.value #> '{line,section_key}', 2000)
            and (coalesce(t.value #> '{line,section_id}', 'null'::jsonb) = 'null'::jsonb
              or private.takeoff_item_send_uuid(t.value #> '{line,section_id}'))
            and private.takeoff_item_send_text(t.value #> '{line,title}', 4000)))
        and pg_catalog.jsonb_typeof(t.value -> 'contributions') = 'array'
        and pg_catalog.jsonb_array_length(t.value -> 'contributions') between 1 and 500
        and not exists (select 1 from pg_catalog.jsonb_array_elements(t.value -> 'contributions') as c(value)
          where (pg_catalog.jsonb_typeof(c.value) = 'object' and private.takeoff_item_send_uuid(c.value -> 'answer_id')
            and coalesce(c.value ->> 'answer_revision' ~ '^[0-9a-f]{64}$', false)
            and coalesce(c.value ->> 'kind' in ('measured', 'entered'), false)
            and pg_catalog.jsonb_typeof(c.value -> 'observation_ids') = 'array'
            and not exists (select 1 from pg_catalog.jsonb_array_elements(c.value -> 'observation_ids') as o(value)
              where private.takeoff_item_send_uuid(o.value) is not true)
            and pg_catalog.jsonb_typeof(c.value -> 'quantity') = 'number' and private.takeoff_item_send_text(c.value -> 'unit', 32)
            and pg_catalog.jsonb_typeof(c.value -> 'pages') = 'array'
            and not exists (select 1 from pg_catalog.jsonb_array_elements(c.value -> 'pages') as g(value)
              where (pg_catalog.jsonb_typeof(g.value) = 'number' and (g.value #>> '{}') ~ '^[1-9][0-9]{0,8}$') is not true)
            and pg_catalog.jsonb_typeof(c.value -> 'identity') = 'object'
            and private.takeoff_item_send_text(c.value #> '{identity,unit}', 32)) is not true)) is not true)
    and not exists (select 1 from pg_catalog.jsonb_array_elements(p_plan -> 'sections') as s(value)
      where (pg_catalog.jsonb_typeof(s.value) = 'object' and private.takeoff_item_send_text(s.value -> 'key', 2000)
        and private.takeoff_item_send_text(s.value -> 'title', 4000)
        and (coalesce(s.value -> 'parent_key', 'null'::jsonb) = 'null'::jsonb or private.takeoff_item_send_text(s.value -> 'parent_key', 2000))
        and (coalesce(s.value -> 'parent_id', 'null'::jsonb) = 'null'::jsonb or private.takeoff_item_send_uuid(s.value -> 'parent_id'))) is not true)
    and not exists (select 1 from pg_catalog.jsonb_array_elements(p_plan -> 'page_decisions') as d(value)
      where (pg_catalog.jsonb_typeof(d.value) = 'object'
        and (coalesce(d.value -> 'page', 'null'::jsonb) = 'null'::jsonb
          or (pg_catalog.jsonb_typeof(d.value -> 'page') = 'number' and (d.value ->> 'page') ~ '^[1-9][0-9]{0,8}$'))
        and ((d.value ->> 'decision' = 'replace' and coalesce(d.value -> 'reason_code', 'null'::jsonb) = 'null'::jsonb)
          or (d.value ->> 'decision' = 'keep_both'
            and coalesce(d.value ->> 'reason_code' in ('other_zone', 'other_trade', 'complementary_scope'), false)
            and (d.value ->> 'reason_code' <> 'complementary_scope'
              or pg_catalog.char_length(pg_catalog.btrim(coalesce(d.value ->> 'note', ''))) between 10 and 500)
            and (coalesce(d.value -> 'note', 'null'::jsonb) = 'null'::jsonb
              or pg_catalog.char_length(d.value ->> 'note') <= 500)))) is not true)
    and (select pg_catalog.count(*) = pg_catalog.count(distinct coalesce(d.value -> 'page', 'null'::jsonb))
      from pg_catalog.jsonb_array_elements(p_plan -> 'page_decisions') as d(value))
    and (select pg_catalog.count(*) = pg_catalog.count(distinct t.value ->> 'key')
      from pg_catalog.jsonb_array_elements(p_plan -> 'targets') as t(value))
$$;
revoke all on function private.takeoff_item_send_plan_valid(jsonb) from public, anon, authenticated, service_role;

-- 11. The readers of the preview, for the readers of the affaire (one access check per call, as B2's readers): what the
--     writer reads, in the same form, so that the plan the server builds is read where the writer reads it.
-- The answers of a job read against the list: each with its revision, its outcome, whether it is still the current
-- reading of its item on the plan, its observations as the review left them (a positive row's quantity, unit and page
-- as now; a row excluded, or no longer positive, brings nothing), its effective decision (B2's rule,
-- private.takeoff_item_table_pairs) and the plan's entry; the entries for the whole affaire of its items; the pages its
-- unit reads. « not_stored » for a job of the first order.
create function public.read_takeoff_item_send_facts(p_tenant_id uuid, p_project_id uuid, p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  job public.takeoff_jobs%rowtype;
  launch public.takeoff_launch_requests%rowtype;
  plan_key uuid;
  unit_pages integer[];
begin
  if (select auth.uid()) is null or p_tenant_id is distinct from (select public.current_tenant_id())
    or coalesce((select private.can_access_takeoff_scope(p_tenant_id, p_project_id, null, false)), false) is not true then
    raise exception 'TAKEOFF_JOB_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into job from public.takeoff_jobs as candidate
  where candidate.id = p_job_id and candidate.tenant_id = p_tenant_id and candidate.project_id = p_project_id;
  if not found then
    raise exception 'TAKEOFF_JOB_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into launch from public.takeoff_launch_requests as request_row
  where request_row.id = job.launch_request_id and request_row.tenant_id = p_tenant_id;
  if launch.item_list_revision_id is null or not exists (select 1 from public.takeoff_item_answer_publications as publication
      where publication.job_id = p_job_id and publication.tenant_id = p_tenant_id) then
    return pg_catalog.jsonb_build_object('state', 'not_stored');
  end if;
  select read_.unit_pages into unit_pages from private.takeoff_item_send_plan_read(job, launch.manifest) as read_;
  select a.plan_logical_id into plan_key from public.takeoff_item_answers as a where a.job_id = p_job_id limit 1;
  return pg_catalog.jsonb_build_object('state', 'stored', 'list_revision_id', launch.item_list_revision_id,
    'unit_pages', pg_catalog.to_jsonb(coalesce(unit_pages, '{}'::integer[])),
    'answers', (with pairs as materialized (
        select p.* from private.takeoff_item_table_pairs(p_tenant_id, p_project_id, plan_key) as p
      )
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('item_id', a.item_id, 'answer_id', a.id,
          'revision', a.content_sha256, 'outcome', a.outcome, 'current', pair.answer_id is not null,
          'searched_pages', pg_catalog.to_jsonb(array(select distinct x from pg_catalog.unnest(a.searched_pages) as x order by 1)),
          'observations', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('observation_id', o.id,
                'role', o.role, 'source', o.source,
                'quantity', case when o.role = 'contribution' then row_.quantity else o.quantity end,
                'unit', case when o.role = 'contribution' then row_.unit else o.unit end,
                'page', case when o.role <> 'contribution' then o.page when row_.source_page > 0 then row_.source_page end,
                'measurement_basis', o.measurement_basis) order by o.ordinal), '[]'::jsonb)
            from public.takeoff_item_answer_observations as o
            left join public.takeoff_items as row_ on row_.id = o.takeoff_item_id and row_.tenant_id = p_tenant_id
            where o.answer_id = a.id
              and (o.role <> 'contribution' or (row_.id is not null and not row_.is_excluded and row_.quantity > 0))),
          'decision', case when pair.decision_effective in ('accepted', 'set_aside')
            then pg_catalog.jsonb_build_object('kind', pair.decision_effective, 'revision', pair.decision_revision) end,
          'entry', (select pg_catalog.jsonb_build_object('revision', e.revision, 'quantity', e.quantity, 'unit', e.unit,
              'category', e.category, 'included', e.included)
            from public.takeoff_item_entries as e where e.tenant_id = p_tenant_id and e.project_id = p_project_id
              and e.item_id = a.item_id and e.plan_logical_id = a.plan_logical_id))
        order by a.item_id), '[]'::jsonb)
      from public.takeoff_item_answers as a
      left join pairs as pair on pair.answer_id = a.id and pair.item_id = a.item_id
      where a.job_id = p_job_id and a.tenant_id = p_tenant_id),
    'affaire_entries', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('item_id', whole.item_id,
        'revision', whole.revision) order by whole.item_id), '[]'::jsonb)
      from public.takeoff_item_entries as whole
      where whole.tenant_id = p_tenant_id and whole.project_id = p_project_id and whole.plan_logical_id is null
        and whole.item_id in (select a.item_id from public.takeoff_item_answers as a where a.job_id = p_job_id)));
end;
$$;
revoke all on function public.read_takeoff_item_send_facts(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.read_takeoff_item_send_facts(uuid, uuid, uuid) to authenticated;

-- What a draft holds of earlier sends by item, for a job's send: its live targets with their live parts (the writer's
-- form), the targets whose line the editor deleted with the parts still live on them (a recreation retires them), the
-- sections they created, and the pages of the job's plan the draft already holds from another analysis (the writer's
-- page guard, on the same pages).
create function public.read_takeoff_item_send_draft(p_tenant_id uuid, p_project_id uuid, p_version_id uuid, p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  job public.takeoff_jobs%rowtype;
  launch public.takeoff_launch_requests%rowtype;
  unit_pages integer[];
  plan_document jsonb;
begin
  if (select auth.uid()) is null or p_tenant_id is distinct from (select public.current_tenant_id())
    or coalesce((select private.can_access_takeoff_scope(p_tenant_id, p_project_id, null, false)), false) is not true
    or not exists (select 1 from public.estimate_versions as version where version.id = p_version_id
      and version.tenant_id = p_tenant_id and version.project_id = p_project_id) then
    raise exception 'TAKEOFF_JOB_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into job from public.takeoff_jobs as candidate
  where candidate.id = p_job_id and candidate.tenant_id = p_tenant_id and candidate.project_id = p_project_id;
  if not found then
    raise exception 'TAKEOFF_JOB_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into launch from public.takeoff_launch_requests as request_row
  where request_row.id = job.launch_request_id and request_row.tenant_id = p_tenant_id;
  select read_.unit_pages, read_.document into unit_pages, plan_document
  from private.takeoff_item_send_plan_read(job, launch.manifest) as read_;
  return pg_catalog.jsonb_build_object(
    'earlier_targets', private.takeoff_item_send_earlier_targets(p_tenant_id, p_version_id),
    'displaced_targets', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('item_id', t.item_id,
        'compartment_key', t.compartment_key, 'breakdown', t.breakdown,
        'parts', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('job_id', p.job_id, 'answer_id', p.answer_id,
            'observation_ids', pg_catalog.to_jsonb(array(select o from pg_catalog.unnest(p.observation_ids) as o order by o)),
            'quantity', pg_catalog.trim_scale(p.quantity),
            'pages', pg_catalog.to_jsonb(array(select distinct x from pg_catalog.unnest(p.pages) as x order by 1)),
            'plan_key', p.plan_logical_id,
            'identity', pg_catalog.jsonb_build_object('unit', p.unit_code, 'basis', p.basis, 'network', p.network,
              'material', p.material, 'diameter', p.diameter))
            order by p.job_id, p.answer_id, array(select o from pg_catalog.unnest(p.observation_ids) as o order by o)), '[]'::jsonb)
          from public.takeoff_item_send_parts as p where p.target_id = t.id and p.state = 'live'))
        order by t.item_id, t.compartment_key), '[]'::jsonb)
      from public.takeoff_item_send_targets as t
      where t.tenant_id = p_tenant_id and t.version_id = p_version_id and t.estimate_item_id is null
        and exists (select 1 from public.takeoff_item_send_parts as p where p.target_id = t.id and p.state = 'live')),
    'sections', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key', section.section_key,
        'estimate_item_id', section.estimate_item_id) order by section.section_key), '[]'::jsonb)
      from public.takeoff_item_send_sections as section
      where section.tenant_id = p_tenant_id and section.version_id = p_version_id and section.estimate_item_id is not null),
    'pages_in_estimate', case when plan_document is null then '[]'::jsonb
      else private.takeoff_item_send_held_pages(p_tenant_id, p_version_id, p_job_id, plan_document,
        private.takeoff_item_send_guard_pages(unit_pages, (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(stored)), '[]'::jsonb)
          from private.takeoff_item_send_job_parts(p_tenant_id, p_project_id, p_job_id, unit_pages) as stored))) end);
end;
$$;
revoke all on function public.read_takeoff_item_send_draft(uuid, uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.read_takeoff_item_send_draft(uuid, uuid, uuid, uuid) to authenticated;

-- 12. The command.
--
-- public.send_takeoff_item_plan(p_tenant_id, p_actor_id, p_module_default, p_request): called by the server only (the
-- service role), with the acting member it authenticated and the plan it rebuilt from the stored facts and the
-- member's choices (ItemSendWritePlan, format takeoff_item_send version 1, engine 3); p_request is {request_id, plan}
-- and, for a first draft, {version_payload}, the payload of « Créer un devis » as the server prepares it
-- (prepareCanonicalEstimateCreation, as today's send). After its waits and before answering anything, the actor's
-- rights are read again: a member of the tenant, its owner engineer or an administrator, the affaire not archived, the
-- module admitted (private.takeoff_module_enabled). A NULL predicate refuses. No override is admitted: no block of
-- this send admits one (a right, the engine, a stale plan and the page check never do, and it has no other), and a
-- request that carries one is refused.
--
-- Trust boundary. SQL takes nothing from the plan that changes an amount: each part, its quantity, unit and pages, the
-- quantitative identity, what is replaced, the page decisions' effects and the pages written are read again or derived
-- here from the stored answers, decisions, entries, rows, targets and parts. Two things only the server computes, and
-- SQL binds them: the projection of the mapping rules (the plan names the rule that applied per item; SQL compares the
-- tenant's rules stamp and each named rule's updated_at, refuses a target under a « skip » rule, checks a new line's
-- title and category against the item's rules), and the first draft's settings (created by
-- public.persist_estimate_creation_atomic under the tenant's policy and the engine-3 check; the created settings are
-- compared with those the plan showed).
--
-- Locks, in the spine's order (LOCK-ORDER, docs/metier/regles-metre.md), never the reverse:
--   1. estimate-calc-policy:<tenant>, shared;
--   2. the affaire's row: FOR UPDATE for a first draft (it creates the version), else FOR NO KEY UPDATE; then the
--      affaire's review key takeoff-item-review:<affaire> (B2's, between the affaire and the version): a bulk review of
--      the same affaire and this send never interleave;
--   3. an existing draft: takeoff-rules:<version>, the editor's key <version>, then the version's row (FOR NO KEY UPDATE);
--   5. the job: takeoff-job-rules:<job>, takeoff-job:<job>, then its row (FOR UPDATE: its end);
--   6. its launch request's row (FOR NO KEY UPDATE: the link's foreign key, as today's send of a plan holds it);
--   8. the tenant's mapping rules (FOR SHARE), then the lines: the draft's lines the plan reads (FOR UPDATE, by id).
-- A first draft is created after rank 8, under the affaire's row already held FOR UPDATE.
--
-- What it compares by stamp: the job (public.takeoff_rule_job_stamp), the draft's peers (public.takeoff_send_peers_stamp),
-- lot 3's send context, the mapping rules (public.takeoff_mapping_rules_stamp and each named rule's updated_at), each
-- DPGF import's reviewed state, the destination version (id, status, updated_at), the first draft's settings as
-- created, the sealed list revision and the plan's pages. What it reads again or derives: each answer's revision, its
-- effective decision (B2's rule), its searched pages and its entries; each part from the stored rows and entries; the
-- quantitative identity; the earlier targets and their live parts; what a confirmation replaces (the earlier parts of
-- the same item and plan on the pages it covers, and those a « replace » decision takes out); each line's updated_at,
-- quantity, unit, DPGF reference and lineage; the pages already in the draft; the pages written. It computes each
-- line's quantity itself. Whatever differs refuses before anything is written (TAKEOFF_ITEM_SEND_PREVIEW_STALE, 40001,
-- with its reason).
create function public.send_takeoff_item_plan(p_tenant_id uuid, p_actor_id uuid, p_module_default boolean, p_request jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := p_actor_id;
  tenant uuid := p_tenant_id;
  plan jsonb := p_request -> 'plan';
  deps jsonb := p_request #> '{plan,dependencies}';
  request uuid;
  target_job_id uuid;
  plan_sha text;
  destination_kind text;
  send_breakdown text;
  actor_role public.tenant_role;
  job public.takeoff_jobs%rowtype;
  project public.estimate_projects%rowtype;
  launch public.takeoff_launch_requests%rowtype;
  existing public.takeoff_item_send_receipts%rowtype;
  this_receipt uuid := gen_random_uuid();
  target_version uuid;
  version_row public.estimate_versions%rowtype;
  created_version boolean := false;
  created jsonb;
  created_lock uuid;
  plan_entry jsonb;
  plan_key uuid;
  unit_pages integer[];
  plan_document jsonb;
  job_parts jsonb;
  held jsonb := '[]'::jsonb;
  stale text;
  answers jsonb;
  target jsonb;
  part record;
  line public.estimate_items%rowtype;
  live_target_id uuid;
  live_target public.takeoff_item_send_targets%rowtype;
  entry_row public.takeoff_list_revision_entries%rowtype;
  identity jsonb;
  factor numeric;
  added numeric;
  kept_sum numeric;
  all_sum numeric;
  parts_count integer;
  legacy_measure numeric;
  legacy_protective numeric;
  legacy_count integer;
  reference numeric;
  retained numeric;
  expected_before numeric;
  after numeric;
  typed boolean;
  choice text;
  covered integer[];
  replaced_ids uuid[] := '{}'::uuid[];
  target_replaced uuid[];
  page_replaced uuid[] := '{}'::uuid[];
  computed jsonb := '{}'::jsonb;
  facts jsonb;
  section_ids jsonb := '{}'::jsonb;
  section jsonb;
  decision jsonb;
  new_id uuid;
  parent uuid;
  next_position integer;
  previous_writer text;
  written_ids uuid[] := '{}'::uuid[];
  lines_out jsonb := '[]'::jsonb;
  sections_out jsonb := '[]'::jsonb;
  outcome jsonb;
  focus uuid;
  stored_count integer;
  listed_count integer;
begin
  -- The caller and the shape of the request. A NULL predicate refuses.
  if actor is null or tenant is null then
    raise exception 'TAKEOFF_ITEM_SEND_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if pg_catalog.jsonb_typeof(p_request) is distinct from 'object'
    or (p_request - array['request_id', 'plan', 'version_payload', 'override']) <> '{}'::jsonb
    or private.takeoff_item_send_uuid(p_request -> 'request_id') is not true
    or private.takeoff_item_send_plan_valid(plan) is not true
    or ((plan #>> '{destination,kind}' = 'first_draft')
      = coalesce(pg_catalog.jsonb_typeof(p_request -> 'version_payload') = 'object', false)) is not true then
    raise exception 'TAKEOFF_ITEM_SEND_INVALID' using errcode = '22023';
  end if;
  if coalesce(p_request -> 'override', 'null'::jsonb) <> 'null'::jsonb then
    raise exception 'TAKEOFF_ITEM_SEND_OVERRIDE_NOT_ADMITTED' using errcode = '22023';
  end if;
  request := (p_request ->> 'request_id')::uuid;
  target_job_id := (plan ->> 'job_id')::uuid;
  destination_kind := plan #>> '{destination,kind}';
  send_breakdown := plan ->> 'breakdown';
  plan_key := (plan ->> 'plan_key')::uuid;
  plan_sha := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(plan::text, 'UTF8')), 'hex');

  select * into job from public.takeoff_jobs as candidate where candidate.id = target_job_id;
  if not found or job.tenant_id is distinct from tenant then
    raise exception 'TAKEOFF_JOB_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Rank 1, then the affaire's row and B2's review key (rank 2).
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('estimate-calc-policy:' || tenant::text, 0));
  if destination_kind = 'first_draft' then
    select * into project from public.estimate_projects as row_project
    where row_project.id = job.project_id and row_project.tenant_id = tenant for update;
  else
    select * into project from public.estimate_projects as row_project
    where row_project.id = job.project_id and row_project.tenant_id = tenant for no key update;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-item-review:' || job.project_id::text, 0));
  -- Rank 3: an existing draft's keys and row (judged below, once every lock is held).
  if destination_kind = 'existing_draft' then
    target_version := (plan #>> '{destination,version_id}')::uuid;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-rules:' || target_version::text, 0));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_version::text, 0));
    select * into version_row from public.estimate_versions as version
    where version.id = target_version and version.tenant_id = tenant and version.project_id = job.project_id
    for no key update;
  end if;
  -- Rank 5, 6 and 8.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-job-rules:' || target_job_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-job:' || target_job_id::text, 0));
  select * into job from public.takeoff_jobs as candidate where candidate.id = target_job_id for update;
  select * into launch from public.takeoff_launch_requests as request_row
  where request_row.id = job.launch_request_id and request_row.tenant_id = tenant;
  if launch.id is not null then
    perform 1 from public.takeoff_launch_requests as request_row where request_row.id = launch.id for no key update;
  end if;
  perform 1 from public.takeoff_mapping_rules as rule where rule.tenant_id = tenant for share;
  if destination_kind = 'existing_draft' then
    perform 1 from public.estimate_items as item
    where item.version_id = target_version and item.tenant_id = tenant
      and item.id in (select private.takeoff_uuid_or_null(listed.value -> 'estimate_item_id')
          from pg_catalog.jsonb_array_elements(deps -> 'lines') as listed(value)
        union select private.takeoff_uuid_or_null(listed.value #> '{line,estimate_item_id}')
          from pg_catalog.jsonb_array_elements(plan -> 'targets') as listed(value))
    order by item.id for update;
  end if;

  -- The actor's rights, now, after every wait and before any answer: a member of this tenant who may operate its
  -- takeoffs, the affaire's owner engineer or an administrator, the affaire not archived, the module admitted.
  select membership.role into actor_role from public.tenant_memberships as membership
  where membership.tenant_id = tenant and membership.user_id = actor;
  if actor_role is null or actor_role not in ('admin'::public.tenant_role, 'engineer'::public.tenant_role)
    or project.id is null or project.is_archived is not false
    or (actor_role <> 'admin'::public.tenant_role and project.user_id is distinct from actor) then
    raise exception 'TAKEOFF_ITEM_SEND_PROJECT_NOT_WRITABLE' using errcode = '42501';
  end if;
  if coalesce(private.takeoff_module_enabled(tenant, coalesce(p_module_default, false)), false) is not true then
    raise exception 'TAKEOFF_ITEM_SEND_MODULE_DISABLED' using errcode = '55000';
  end if;
  -- A send of this request that committed meanwhile is visible: the same request and the same plan answer the same;
  -- another plan, another job or another member under it is a conflict.
  select * into existing from public.takeoff_item_send_receipts as stored
  where stored.tenant_id = tenant and stored.request_id = request;
  if found then
    if existing.actor_id = actor and existing.job_id = target_job_id and existing.plan_sha256 = plan_sha then
      return pg_catalog.jsonb_build_object('receipt_id', existing.id, 'replayed', true) || existing.result;
    end if;
    raise exception 'TAKEOFF_ITEM_SEND_REQUEST_CONFLICT' using errcode = '40001';
  end if;
  -- A job sent stays sent: another confirmation of it is told so before anything else.
  if job.estimate_version_id is not null or job.status = 'applied'::public.takeoff_job_status
    or exists (select 1 from public.takeoff_item_send_receipts as stored where stored.job_id = target_job_id) then
    raise exception 'TAKEOFF_ITEM_SEND_ALREADY_SENT' using errcode = '40001';
  end if;
  if launch.id is null or launch.item_list_revision_id is null
    or not exists (select 1 from public.takeoff_item_answer_publications as publication
      where publication.job_id = target_job_id and publication.tenant_id = tenant) then
    raise exception 'TAKEOFF_ITEM_SEND_NOT_ITEM_LIST' using errcode = '22023';
  end if;
  if job.status is distinct from 'completed'::public.takeoff_job_status then
    raise exception 'TAKEOFF_ITEM_SEND_JOB_NOT_READY' using errcode = '40001';
  end if;

  -- The destination: a first draft only on an affaire without a version; a draft that is still that draft, of engine 3,
  -- the member's to write (another member editing it refuses the send; the member holds the editor's lease).
  if destination_kind = 'first_draft' then
    if exists (select 1 from public.estimate_versions as version where version.project_id = job.project_id
      and version.tenant_id = tenant) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'destination_changed')::text;
    end if;
  else
    if version_row.id is null or version_row.status is distinct from 'draft'::public.estimate_status
      or deps #>> '{stamps,destination,version_id}' is distinct from target_version::text
      or deps #>> '{stamps,destination,status}' is distinct from 'draft'
      or version_row.updated_at is distinct from (deps #>> '{stamps,destination,updated_at}')::timestamptz then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'destination_changed')::text;
    end if;
    if version_row.calc_engine_version is distinct from 3 then
      raise exception 'TAKEOFF_ITEM_SEND_ENGINE_NOT_V3' using errcode = '22023';
    end if;
    if exists (select 1 from public.draft_locks as lock_row where lock_row.version_id = target_version
      and lock_row.user_id <> actor and lock_row.expires_at > pg_catalog.statement_timestamp()) then
      raise exception 'TAKEOFF_ITEM_SEND_DRAFT_LOCKED' using errcode = '55P03';
    end if;
    if not exists (select 1 from public.draft_locks as lock_row where lock_row.version_id = target_version
      and lock_row.user_id = actor and lock_row.expires_at > pg_catalog.statement_timestamp()) then
      raise exception 'TAKEOFF_ITEM_SEND_DRAFT_LOCK_REQUIRED' using errcode = '55P03';
    end if;
  end if;

  -- The plan read: its unit and its plan in the sealed manifest, its sealed list.
  select read_.plan_entry, read_.unit_pages, read_.document into plan_entry, unit_pages, plan_document
  from private.takeoff_item_send_plan_read(job, launch.manifest) as read_;
  if plan_entry is null or plan_entry ->> 'logical_id' is distinct from plan_key::text
    or launch.item_list_revision_id::text is distinct from plan #>> '{list,revision_id}'
    or (select revision.revision from public.takeoff_list_revisions as revision where revision.id = launch.item_list_revision_id)
      is distinct from (plan #>> '{list,revision}')::integer
    or exists (select 1 from public.takeoff_item_answers as a where a.job_id = target_job_id and a.plan_logical_id <> plan_key) then
    raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', 'list_changed')::text;
  end if;

  -- The stamps.
  stale := case
    when public.takeoff_rule_job_stamp(tenant, job.project_id, target_job_id) is distinct from deps #>> '{stamps,job}'
      then 'takeoff_changed'
    when public.takeoff_mapping_rules_stamp(tenant) is distinct from deps #>> '{stamps,mapping}' then 'mapping_changed'
    when exists (select 1 from pg_catalog.jsonb_array_elements(deps -> 'rules') as listed(value)
        where not exists (select 1 from public.takeoff_mapping_rules as rule where rule.tenant_id = tenant
          and rule.id = private.takeoff_uuid_or_null(listed.value -> 'rule_id')
          and rule.updated_at = (listed.value ->> 'rule_version')::timestamptz)) then 'mapping_changed'
    when destination_kind = 'existing_draft' and public.takeoff_send_peers_stamp(tenant, target_version)
      is distinct from deps #>> '{stamps,peers}' then 'estimate_changed'
    when (select pg_catalog.jsonb_build_object('peers', context.stamps ->> 'peers', 'locations', context.stamps ->> 'locations')
        from (select private.takeoff_send_context_stamps(private.takeoff_send_context(tenant, job.project_id, target_job_id,
          target_version)) as stamps) as context)
      is distinct from deps #> '{stamps,context}' then 'peers_changed'
  end;
  if stale is null and destination_kind = 'existing_draft' then
    -- Each DPGF import a line of the draft comes from, as the database identifies its reviewed generation.
    if (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('import_id', import_row.id,
          'mapping_id', state.mapping_id, 'rows_sha256', state.rows_sha256, 'updated_at', import_row.updated_at,
          'status', import_row.status, 'row_count', import_row.row_count) order by import_row.id), '[]'::jsonb)
        from public.dpgf_imports as import_row
        cross join lateral public.dpgf_import_review_state(tenant, import_row.id) as state
        where import_row.tenant_id = tenant and import_row.id in (select lineage.import_id
          from public.read_estimate_dpgf_raw_rows(tenant, target_version) as lineage))
      is distinct from (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'import_id', private.takeoff_uuid_or_null(listed.value -> 'import_id'),
          'mapping_id', private.takeoff_uuid_or_null(listed.value -> 'mapping_id'), 'rows_sha256', listed.value ->> 'rows_sha256',
          'updated_at', (listed.value ->> 'updated_at')::timestamptz, 'status', listed.value ->> 'status',
          'row_count', (listed.value ->> 'row_count')::integer) order by private.takeoff_uuid_or_null(listed.value -> 'import_id')),
          '[]'::jsonb)
        from pg_catalog.jsonb_array_elements(deps #> '{stamps,dpgf}') as listed(value)) then
      stale := 'dpgf_changed';
    end if;
  end if;
  if stale is not null then
    raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', stale)::text;
  end if;

  -- The answers as the plan read them: the job's answers, each with its revision, its effective decision's revision and
  -- the revision of the plan's entry for its item; the entries for the whole affaire of its items.
  with pairs as materialized (
    select p.* from private.takeoff_item_table_pairs(tenant, job.project_id, plan_key) as p
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('item_id', a.item_id, 'answer_id', a.id,
      'revision', a.content_sha256,
      'decision_revision', case when pair.decision_effective in ('accepted', 'set_aside') then pair.decision_revision end,
      'entry_revision', plan_entry_row.revision) order by a.item_id), '[]'::jsonb)
    into answers
  from public.takeoff_item_answers as a
  left join pairs as pair on pair.answer_id = a.id and pair.item_id = a.item_id
  left join public.takeoff_item_entries as plan_entry_row on plan_entry_row.tenant_id = tenant
    and plan_entry_row.project_id = job.project_id and plan_entry_row.item_id = a.item_id
    and plan_entry_row.plan_logical_id = a.plan_logical_id
  where a.job_id = target_job_id and a.tenant_id = tenant;
  if answers is distinct from (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'item_id', private.takeoff_uuid_or_null(listed.value -> 'item_id'),
        'answer_id', private.takeoff_uuid_or_null(listed.value -> 'answer_id'), 'revision', listed.value ->> 'revision',
        'decision_revision', (listed.value ->> 'decision_revision')::integer,
        'entry_revision', (listed.value ->> 'entry_revision')::integer) order by private.takeoff_uuid_or_null(listed.value -> 'item_id')),
        '[]'::jsonb)
      from pg_catalog.jsonb_array_elements(deps -> 'answers') as listed(value))
    or (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('item_id', whole.item_id, 'revision', whole.revision)
          order by whole.item_id), '[]'::jsonb)
        from public.takeoff_item_entries as whole
        where whole.tenant_id = tenant and whole.project_id = job.project_id and whole.plan_logical_id is null
          and whole.item_id in (select a.item_id from public.takeoff_item_answers as a where a.job_id = target_job_id))
      is distinct from (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'item_id', private.takeoff_uuid_or_null(listed.value -> 'item_id'), 'revision', (listed.value ->> 'revision')::integer)
          order by private.takeoff_uuid_or_null(listed.value -> 'item_id')), '[]'::jsonb)
        from pg_catalog.jsonb_array_elements(deps -> 'affaire_entries') as listed(value)) then
    raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', 'answers_changed')::text;
  end if;
  if array(select distinct (page.value #>> '{}')::integer from pg_catalog.jsonb_array_elements(deps -> 'plan_pages') as page(value)
      order by 1) is distinct from unit_pages then
    raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', 'plan_changed')::text;
  end if;
  -- Every part the job's answers bring now, read once.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(stored)), '[]'::jsonb) into job_parts
  from private.takeoff_item_send_job_parts(tenant, job.project_id, target_job_id, unit_pages) as stored;

  -- The whole list: a list holding items of a DPGF import is sent only into a draft that holds that import's lines.
  if exists (select 1 from public.takeoff_list_revision_entries as entry
      where entry.revision_id = launch.item_list_revision_id and entry.origin_kind = 'dpgf')
    and (destination_kind = 'first_draft' or not exists (select 1 from public.estimate_items as item
      join public.takeoff_list_revision_entries as entry on entry.revision_id = launch.item_list_revision_id
        and entry.origin_kind = 'dpgf' and pg_catalog.lower(entry.origin ->> 'importId') = pg_catalog.lower(item.source_metadata ->> 'import_id')
      where item.version_id = target_version and item.tenant_id = tenant and item.item_type = 'line'::public.estimate_item_type
        and item.source_provider = 'dpgf')) then
    raise exception 'TAKEOFF_ITEM_SEND_DPGF_IMPORT_REQUIRED' using errcode = '22023';
  end if;

  if destination_kind = 'existing_draft' then
    -- What earlier sends by item left in the draft, as the plan read it.
    if private.takeoff_item_send_earlier_targets(tenant, target_version)
      is distinct from private.takeoff_item_send_earlier_form(deps -> 'earlier_targets') then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'earlier_send_changed')::text;
    end if;
    -- A line an earlier send by item wrote in another version, carried here by a copy, without its contributions: neither
    -- the page guard nor the targets of this draft can tell what it already holds, and it is never counted twice.
    if exists (select 1 from public.estimate_items as item
      where item.version_id = target_version and item.tenant_id = tenant and item.source_metadata ? 'takeoff_item_send'
        and not exists (select 1 from public.takeoff_item_send_targets as t where t.estimate_item_id = item.id)) then
      raise exception 'TAKEOFF_ITEM_SEND_COPY_UNREAD' using errcode = '22023';
    end if;
    -- The lines the plan read, as they are.
    if exists (select 1 from pg_catalog.jsonb_array_elements(deps -> 'lines') as listed(value)
      left join public.estimate_items as item on item.id = private.takeoff_uuid_or_null(listed.value -> 'estimate_item_id')
        and item.version_id = target_version and item.tenant_id = tenant
      where item.id is null or item.updated_at is distinct from (listed.value ->> 'updated_at')::timestamptz
        or item.quantity is distinct from (listed.value ->> 'quantity')::numeric) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'estimate_changed')::text;
    end if;
    -- The pages of this plan's document the draft already holds from another analysis, as the plan read them.
    held := private.takeoff_item_send_held_pages(tenant, target_version, target_job_id, plan_document,
      private.takeoff_item_send_guard_pages(unit_pages, job_parts));
    if (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('page', entry.value -> 'page',
          'earlier_job_ids', entry.value -> 'earlier_job_ids', 'estimate_item_ids', entry.value -> 'estimate_item_ids')
          order by (entry.value ->> 'page')::integer nulls last), '[]'::jsonb)
        from pg_catalog.jsonb_array_elements(held) as entry(value))
      is distinct from (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('page', coalesce(listed.value -> 'page', 'null'::jsonb),
          'earlier_job_ids', pg_catalog.to_jsonb(array(select private.takeoff_uuid_or_null(j.value)::text
            from pg_catalog.jsonb_array_elements(listed.value -> 'earlier_job_ids') as j(value) order by 1)),
          'estimate_item_ids', pg_catalog.to_jsonb(array(select private.takeoff_uuid_or_null(l.value)::text
            from pg_catalog.jsonb_array_elements(listed.value -> 'estimate_item_ids') as l(value) order by 1)))
          order by (listed.value ->> 'page')::integer nulls last), '[]'::jsonb)
        from pg_catalog.jsonb_array_elements(deps -> 'pages_in_estimate') as listed(value)) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'pages_changed')::text;
    end if;
  elsif pg_catalog.jsonb_array_length(deps -> 'earlier_targets') > 0 or pg_catalog.jsonb_array_length(deps -> 'lines') > 0
    or pg_catalog.jsonb_array_length(deps -> 'pages_in_estimate') > 0 then
    raise exception 'TAKEOFF_ITEM_SEND_INVALID' using errcode = '22023';
  end if;

  -- The page decisions: each on a page held, each positively valid (the shape was checked: a decision, its reason).
  -- Replacing needs parts that can be told apart and cut by page: a line of today's send holds its page as a whole
  -- reading (no part per item), and a part that also lies on a page not replaced (or on every page) cannot be cut.
  for decision in select value from pg_catalog.jsonb_array_elements(plan -> 'page_decisions') loop
    if not exists (select 1 from pg_catalog.jsonb_array_elements(held) as entry(value)
        where entry.value -> 'page' = coalesce(decision -> 'page', 'null'::jsonb)) then
      raise exception 'TAKEOFF_ITEM_SEND_PAGE_DECISION_INVALID' using errcode = '22023',
        detail = pg_catalog.jsonb_build_object('reason', 'page_not_held', 'page', decision -> 'page')::text;
    end if;
    if decision ->> 'decision' = 'replace' and exists (select 1 from pg_catalog.jsonb_array_elements(held) as entry(value)
        where entry.value -> 'page' = coalesce(decision -> 'page', 'null'::jsonb) and (entry.value ->> 'today')::boolean) then
      raise exception 'TAKEOFF_ITEM_SEND_PAGE_DECISION_INVALID' using errcode = '22023',
        detail = pg_catalog.jsonb_build_object('reason', 'replace_not_cuttable', 'page', decision -> 'page')::text;
    end if;
    -- « Garder les deux » only where today's guard admits it: never onto a line that already holds that page from
    -- another reading (today's « Fusionner » match: the line would hold the page twice) — a line today's provenance
    -- holds there, or one a live part of another plan or another item holds there (this plan's own earlier part of the
    -- item is replaced, not kept).
    if decision ->> 'decision' = 'keep_both' and exists (select 1 from pg_catalog.jsonb_array_elements(held) as entry(value)
        cross join lateral pg_catalog.jsonb_array_elements(plan -> 'targets') as t(value)
        cross join lateral pg_catalog.jsonb_array_elements(t.value -> 'contributions') as c(value)
        where entry.value -> 'page' = coalesce(decision -> 'page', 'null'::jsonb)
          and (coalesce(decision -> 'page', 'null'::jsonb) = 'null'::jsonb or pg_catalog.jsonb_array_length(c.value -> 'pages') = 0
            or c.value -> 'pages' @> pg_catalog.jsonb_build_array(decision -> 'page'))
          and (entry.value -> 'today_estimate_item_ids' ? (t.value #>> '{line,estimate_item_id}')
            or exists (select 1 from pg_catalog.jsonb_array_elements(entry.value -> 'parts') as p(value)
              where p.value ->> 'estimate_item_id' = t.value #>> '{line,estimate_item_id}'
                and (p.value ->> 'plan_key' = plan_key::text and p.value ->> 'item_id' = t.value ->> 'item_id') is not true))) then
      raise exception 'TAKEOFF_ITEM_SEND_PAGE_DECISION_INVALID' using errcode = '22023',
        detail = pg_catalog.jsonb_build_object('reason', 'keep_both_same_line', 'page', decision -> 'page')::text;
    end if;
  end loop;
  -- The parts a page replaced takes out: the earlier live parts, on that page, of the items this plan sends parts of there.
  select coalesce(pg_catalog.array_agg(distinct (p.value ->> 'part_id')::uuid), '{}'::uuid[]) into page_replaced
  from pg_catalog.jsonb_array_elements(plan -> 'page_decisions') as d(value)
  join pg_catalog.jsonb_array_elements(held) as entry(value) on entry.value -> 'page' = coalesce(d.value -> 'page', 'null'::jsonb)
  cross join lateral pg_catalog.jsonb_array_elements(entry.value -> 'parts') as p(value)
  where d.value ->> 'decision' = 'replace'
    and exists (select 1 from pg_catalog.jsonb_array_elements(plan -> 'targets') as t(value)
      cross join lateral pg_catalog.jsonb_array_elements(t.value -> 'contributions') as c(value)
      where t.value ->> 'item_id' = p.value ->> 'item_id'
        and (coalesce(d.value -> 'page', 'null'::jsonb) = 'null'::jsonb or pg_catalog.jsonb_array_length(c.value -> 'pages') = 0
          or c.value -> 'pages' @> pg_catalog.jsonb_build_array(d.value -> 'page')));
  if exists (select 1 from public.takeoff_item_send_parts as p where p.id = any(page_replaced)
      and (pg_catalog.cardinality(p.pages) = 0 or exists (select 1 from pg_catalog.unnest(p.pages) as x(page)
        where not exists (select 1 from pg_catalog.jsonb_array_elements(plan -> 'page_decisions') as d(value)
          where d.value ->> 'decision' = 'replace'
            and (coalesce(d.value -> 'page', 'null'::jsonb) = 'null'::jsonb or (d.value ->> 'page')::integer = x.page))))) then
    raise exception 'TAKEOFF_ITEM_SEND_PAGE_DECISION_INVALID' using errcode = '22023',
      detail = pg_catalog.jsonb_build_object('reason', 'part_indivisible')::text;
  end if;

  -- Every target, read again and computed here.
  for target in select value from pg_catalog.jsonb_array_elements(plan -> 'targets') loop
    select * into entry_row from public.takeoff_list_revision_entries as entry
    where entry.revision_id = launch.item_list_revision_id and entry.item_id = (target ->> 'item_id')::uuid;
    if entry_row.item_id is null then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'item_changed', 'item_id', target ->> 'item_id')::text;
    end if;
    -- The rule the plan names for the item (the server's projection, bound here): a « skip » never writes.
    if exists (select 1 from pg_catalog.jsonb_array_elements(deps -> 'rules') as listed(value)
        join public.takeoff_mapping_rules as rule on rule.id = private.takeoff_uuid_or_null(listed.value -> 'rule_id')
          and rule.tenant_id = tenant
        where listed.value ->> 'item_id' = target ->> 'item_id' and rule.action = 'skip') then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'mapping_changed', 'item_id', target ->> 'item_id')::text;
    end if;
    -- The item's stored parts now: each part the plan sends is one of them, exactly (its unit compared by its canonical
    -- code), and the others are the ones the plan holds or leaves out by page.
    select pg_catalog.count(*)::integer into stored_count from pg_catalog.jsonb_array_elements(job_parts) as stored(value)
    where stored.value ->> 'item_id' = target ->> 'item_id';
    select pg_catalog.count(*)::integer into listed_count from pg_catalog.jsonb_array_elements(plan -> 'parts_not_sent') as listed(value)
    where listed.value ->> 'item_id' = target ->> 'item_id' and listed.value ->> 'reason' in ('page_held', 'left_out');
    if stored_count = 0 or stored_count <> pg_catalog.jsonb_array_length(target -> 'contributions') + listed_count
      or exists (select 1 from pg_catalog.jsonb_array_elements(target -> 'contributions') as c(value)
        where (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(job_parts) as stored(value)
          where stored.value ->> 'item_id' = target ->> 'item_id' and stored.value ->> 'answer_id' = c.value ->> 'answer_id'
            and stored.value ->> 'answer_revision' = c.value ->> 'answer_revision' and stored.value ->> 'kind' = c.value ->> 'kind'
            and (stored.value ->> 'quantity')::numeric = (c.value ->> 'quantity')::numeric
            and private.takeoff_item_send_unit(stored.value ->> 'unit') = private.takeoff_item_send_unit(c.value ->> 'unit')
            and (stored.value ->> 'kind' = 'entered'
              or pg_catalog.jsonb_build_array(stored.value -> 'observation_id') = c.value -> 'observation_ids')
            and stored.value -> 'pages' = pg_catalog.to_jsonb(array(select distinct (g.value #>> '{}')::integer
              from pg_catalog.jsonb_array_elements(c.value -> 'pages') as g(value) order by 1))) <> 1) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'item_changed', 'item_id', target ->> 'item_id')::text;
    end if;
    -- Engine 3 holds each part as given (three decimals, under its ceiling), in one unit, the item's when it has one.
    if exists (select 1 from pg_catalog.jsonb_array_elements(target -> 'contributions') as c(value)
        where ((c.value ->> 'quantity')::numeric > 0 and (c.value ->> 'quantity')::numeric <= 999999999.999
          and (c.value ->> 'quantity')::numeric = pg_catalog.round((c.value ->> 'quantity')::numeric, 3)
          and private.takeoff_item_send_unit(c.value ->> 'unit') = target ->> 'unit_code') is not true)
      or (entry_row.expected_unit is not null
        and private.takeoff_item_send_unit(entry_row.expected_unit) is distinct from target ->> 'unit_code') then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'item_changed', 'item_id', target ->> 'item_id')::text;
    end if;
    -- The quantitative identity, derived here from the stored observations and the sealed item: one basis among the parts
    -- (the item's when it prescribes one), the item's network, material and diameter. It is the one stored.
    if (select pg_catalog.count(distinct private.takeoff_item_send_folded(stored.value ->> 'basis'))
        from pg_catalog.jsonb_array_elements(job_parts) as stored(value)
        where stored.value ->> 'item_id' = target ->> 'item_id' and private.takeoff_item_send_folded(stored.value ->> 'basis') is not null) > 1
      or (private.takeoff_item_send_folded(entry_row.measurement_basis) is not null and exists (select 1
        from pg_catalog.jsonb_array_elements(job_parts) as stored(value)
        where stored.value ->> 'item_id' = target ->> 'item_id'
          and private.takeoff_item_send_folded(stored.value ->> 'basis')
            is distinct from private.takeoff_item_send_folded(entry_row.measurement_basis)
          and private.takeoff_item_send_folded(stored.value ->> 'basis') is not null)) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'item_changed', 'item_id', target ->> 'item_id')::text;
    end if;
    identity := pg_catalog.jsonb_build_object('unit', target ->> 'unit_code',
      'basis', coalesce((select private.takeoff_item_send_folded(stored.value ->> 'basis')
          from pg_catalog.jsonb_array_elements(job_parts) as stored(value)
          where stored.value ->> 'item_id' = target ->> 'item_id' and private.takeoff_item_send_folded(stored.value ->> 'basis') is not null
          limit 1), private.takeoff_item_send_folded(entry_row.measurement_basis)),
      'network', private.takeoff_item_send_folded(entry_row.qualifiers ->> 'network'),
      'material', private.takeoff_item_send_folded(entry_row.qualifiers ->> 'material'),
      'diameter', private.takeoff_item_send_diameter(entry_row.qualifiers ->> 'diameter'));
    if exists (select 1 from pg_catalog.jsonb_array_elements(target -> 'contributions') as c(value)
        where c.value -> 'identity' is distinct from identity) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'identity_conflict', 'item_id', target ->> 'item_id')::text;
    end if;
    -- A part on a page held is sent only with that page's decision. A page holds the item when today's provenance holds
    -- it, or when an earlier send by item holds a part there other than this plan's own earlier part of the item.
    if exists (select 1 from pg_catalog.jsonb_array_elements(target -> 'contributions') as c(value)
        cross join lateral pg_catalog.jsonb_array_elements(held) as entry(value)
        where (entry.value -> 'page' = 'null'::jsonb or pg_catalog.jsonb_array_length(c.value -> 'pages') = 0
            or c.value -> 'pages' @> pg_catalog.jsonb_build_array(entry.value -> 'page'))
          and ((entry.value ->> 'today')::boolean or exists (select 1 from pg_catalog.jsonb_array_elements(entry.value -> 'parts') as p(value)
            where (p.value ->> 'plan_key' = plan_key::text and p.value ->> 'item_id' = target ->> 'item_id') is not true))
          and not exists (select 1 from pg_catalog.jsonb_array_elements(plan -> 'page_decisions') as d(value)
            where coalesce(d.value -> 'page', 'null'::jsonb) = entry.value -> 'page')) then
      raise exception 'TAKEOFF_ITEM_SEND_PAGE_DECISION_REQUIRED' using errcode = '22023',
        detail = pg_catalog.jsonb_build_object('reason', 'page_held', 'item_id', target ->> 'item_id')::text;
    end if;
    -- The compartment is one of the breakdown's: « together », a building's or a level's, « unallocated »; « dpgf » for a
    -- line of the DPGF, and only there.
    if ((target #>> '{line,kind}' = 'dpgf_line') = (target ->> 'compartment_key' = 'dpgf')
      and (target ->> 'compartment_key' = 'dpgf' or case send_breakdown
        when 'together' then target ->> 'compartment_key' = 'together'
        when 'by_level' then target ->> 'compartment_key' = 'unallocated' or target ->> 'compartment_key' like 'level:%'
        when 'by_building' then target ->> 'compartment_key' = 'unallocated' or target ->> 'compartment_key' like 'building:%'
        else false end)) is not true then
      raise exception 'TAKEOFF_ITEM_SEND_INVALID' using errcode = '22023';
    end if;
    -- What this confirmation covers on its plan: the pages its answer searched (an entry: every page of the plan's unit),
    -- less those it leaves out and those held without a decision, and the pages a « replace » decision carries.
    covered := array(select distinct x from pg_catalog.unnest(
        case when exists (select 1 from pg_catalog.jsonb_array_elements(target -> 'contributions') as c(value)
            where c.value ->> 'kind' = 'entered') then unit_pages
          else (select a.searched_pages from public.takeoff_item_answers as a
            where a.job_id = target_job_id and a.item_id = (target ->> 'item_id')::uuid) end) as x
      where not exists (select 1 from pg_catalog.jsonb_array_elements(plan -> 'parts_not_sent') as listed(value)
          cross join lateral pg_catalog.jsonb_array_elements(listed.value -> 'pages') as g(value)
          where listed.value ->> 'item_id' = target ->> 'item_id' and listed.value ->> 'reason' in ('page_held', 'left_out')
            and (g.value #>> '{}')::integer = x)
        and not exists (select 1 from pg_catalog.jsonb_array_elements(held) as entry(value)
          where (entry.value -> 'page' = 'null'::jsonb or (entry.value ->> 'page')::integer = x)
            and ((entry.value ->> 'today')::boolean or exists (select 1 from pg_catalog.jsonb_array_elements(entry.value -> 'parts') as p(value)
              where (p.value ->> 'plan_key' = plan_key::text and p.value ->> 'item_id' = target ->> 'item_id') is not true))
            and not exists (select 1 from pg_catalog.jsonb_array_elements(plan -> 'page_decisions') as d(value)
              where coalesce(d.value -> 'page', 'null'::jsonb) = entry.value -> 'page'))
      union select (d.value ->> 'page')::integer from pg_catalog.jsonb_array_elements(plan -> 'page_decisions') as d(value)
        where d.value ->> 'decision' = 'replace' and d.value ->> 'page' is not null
      order by 1);

    added := (select pg_catalog.sum((c.value ->> 'quantity')::numeric) from pg_catalog.jsonb_array_elements(target -> 'contributions') as c(value));
    factor := private.takeoff_item_send_length_factor(target ->> 'unit_code');
    target_replaced := '{}'::uuid[];
    live_target_id := null;
    live_target := null;
    line := null;
    choice := null;
    typed := false;
    -- What its origin allows: an item of the list made by hand never feeds a DPGF line; an item of a DPGF import feeds a
    -- line of that import (its lineage proves it, or the member chose it among them), never a new line while the draft
    -- holds that import's lines.
    if target #>> '{line,kind}' = 'dpgf_line' and entry_row.origin_kind <> 'dpgf' then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'target_unproven', 'item_id', target ->> 'item_id')::text;
    end if;
    if target #>> '{line,kind}' <> 'dpgf_line' and entry_row.origin_kind = 'dpgf' and destination_kind = 'existing_draft'
      and exists (select 1 from public.estimate_items as item where item.version_id = target_version and item.tenant_id = tenant
        and item.source_provider = 'dpgf' and item.item_type = 'line'::public.estimate_item_type
        and pg_catalog.lower(item.source_metadata ->> 'import_id') = pg_catalog.lower(entry_row.origin ->> 'importId')) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'target_changed', 'item_id', target ->> 'item_id')::text;
    end if;
    if target #>> '{line,kind}' = 'new_line' then
      -- A new line: no live target of this item in this compartment (else the plan feeds it), one breakdown per item in a
      -- draft; after a target whose line was deleted, only by the member's choice, and its displaced live parts retired.
      if exists (select 1 from public.takeoff_item_send_targets as t
          where t.version_id = target_version and t.item_id = (target ->> 'item_id')::uuid and t.estimate_item_id is not null
            and (t.breakdown <> send_breakdown or t.compartment_key = target ->> 'compartment_key')) then
        raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
          detail = pg_catalog.jsonb_build_object('reason', 'target_changed', 'item_id', target ->> 'item_id')::text;
      end if;
      if exists (select 1 from public.takeoff_item_send_targets as t
          where t.version_id = target_version and t.item_id = (target ->> 'item_id')::uuid and t.breakdown = send_breakdown
            and t.compartment_key = target ->> 'compartment_key' and t.estimate_item_id is null) then
        if not exists (select 1 from pg_catalog.jsonb_array_elements(deps -> 'resolutions') as r(value)
            where r.value ->> 'key' = 'target:' || (target ->> 'key') and r.value #>> '{choice,kind}' = 'new_line') then
          raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
            detail = pg_catalog.jsonb_build_object('reason', 'target_changed', 'item_id', target ->> 'item_id')::text;
        end if;
        select coalesce(pg_catalog.array_agg(p.id order by p.id), '{}'::uuid[]) into target_replaced
        from public.takeoff_item_send_parts as p join public.takeoff_item_send_targets as t on t.id = p.target_id
        where t.version_id = target_version and t.item_id = (target ->> 'item_id')::uuid and t.breakdown = send_breakdown
          and t.compartment_key = target ->> 'compartment_key' and t.estimate_item_id is null and p.state = 'live';
      end if;
      -- Its title is the item's label in the sealed list, or the one a renaming rule of the item gives; its category is
      -- the one a classifying rule of the item gives, or none.
      if (target #>> '{line,title}' = entry_row.label
          or exists (select 1 from pg_catalog.jsonb_array_elements(deps -> 'rules') as listed(value)
            join public.takeoff_mapping_rules as rule on rule.id = private.takeoff_uuid_or_null(listed.value -> 'rule_id')
              and rule.tenant_id = tenant
            where listed.value ->> 'item_id' = target ->> 'item_id' and rule.action = 'rename'
              and pg_catalog.btrim(rule.action_params ->> 'designation') = target #>> '{line,title}')) is not true
        or (private.takeoff_uuid_or_null(target #> '{rule,category_id}') is not null
          and not exists (select 1 from pg_catalog.jsonb_array_elements(deps -> 'rules') as listed(value)
            join public.takeoff_mapping_rules as rule on rule.id = private.takeoff_uuid_or_null(listed.value -> 'rule_id')
              and rule.tenant_id = tenant
            where listed.value ->> 'item_id' = target ->> 'item_id' and rule.action = 'set_category'
              and private.takeoff_uuid_or_null(rule.action_params -> 'category_id')
                = private.takeoff_uuid_or_null(target #> '{rule,category_id}'))) then
        raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
          detail = pg_catalog.jsonb_build_object('reason', 'mapping_changed', 'item_id', target ->> 'item_id')::text;
      end if;
      -- Its section: one this plan creates, or one an earlier send by item created, by its identity.
      if not (exists (select 1 from pg_catalog.jsonb_array_elements(plan -> 'sections') as s(value)
            where s.value ->> 'key' = target #>> '{line,section_key}')
          and coalesce(target #> '{line,section_id}', 'null'::jsonb) = 'null'::jsonb)
        and not exists (select 1 from public.takeoff_item_send_sections as s
          where s.version_id = target_version and s.section_key = target #>> '{line,section_key}'
            and s.estimate_item_id = private.takeoff_uuid_or_null(target #> '{line,section_id}')) then
        raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
          detail = pg_catalog.jsonb_build_object('reason', 'sections_changed')::text;
      end if;
      after := private.takeoff_item_send_rounded(added, factor);
    else
      select * into line from public.estimate_items as item
      where item.id = (target #>> '{line,estimate_item_id}')::uuid and item.version_id = target_version and item.tenant_id = tenant
        and item.item_type = 'line'::public.estimate_item_type;
      if line.id is null or line.updated_at is distinct from (target #>> '{line,expected_updated_at}')::timestamptz
        or line.quantity is distinct from (target #>> '{line,expected_quantity}')::numeric
        or private.takeoff_item_send_unit(line.unit_code) is distinct from target ->> 'unit_code'
        or (target #>> '{line,kind}' = 'dpgf_line') is distinct from (line.source_provider = 'dpgf') then
        raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
          detail = pg_catalog.jsonb_build_object('reason', 'line_changed', 'estimate_item_id', line.id)::text;
      end if;
      select * into live_target from public.takeoff_item_send_targets as t where t.estimate_item_id = line.id;
      live_target_id := live_target.id;
      -- A line live for another item, another compartment or another breakdown is never this one's target.
      if live_target_id is not null and (live_target.item_id <> (target ->> 'item_id')::uuid
          or live_target.compartment_key <> target ->> 'compartment_key'
          or (live_target.breakdown = 'dpgf') <> (target #>> '{line,kind}' = 'dpgf_line')
          or (live_target.breakdown <> 'dpgf' and live_target.breakdown <> send_breakdown)) then
        raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
          detail = pg_catalog.jsonb_build_object('reason', 'target_claimed', 'estimate_item_id', line.id)::text;
      end if;
      if target #>> '{line,kind}' = 'earlier_line' and live_target_id is null then
        raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
          detail = pg_catalog.jsonb_build_object('reason', 'target_changed', 'estimate_item_id', line.id)::text;
      end if;
      -- A DPGF line is of the item's import; its first claim is proven by its lineage, or chosen by the member.
      if target #>> '{line,kind}' = 'dpgf_line' and (pg_catalog.lower(line.source_metadata ->> 'import_id')
          = pg_catalog.lower(entry_row.origin ->> 'importId')) is not true then
        raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
          detail = pg_catalog.jsonb_build_object('reason', 'target_unproven', 'estimate_item_id', line.id)::text;
      end if;
      if target #>> '{line,kind}' = 'dpgf_line' and live_target_id is null
        and not exists (select 1 from public.read_estimate_dpgf_raw_rows(tenant, target_version) as lineage
          where lineage.estimate_item_id = line.id and lineage.import_id::text = pg_catalog.lower(entry_row.origin ->> 'importId')
            and lineage.raw_row_id::text = pg_catalog.lower(entry_row.origin ->> 'rawRowId'))
        and not exists (select 1 from pg_catalog.jsonb_array_elements(deps -> 'resolutions') as r(value)
          where r.value ->> 'key' = 'target:' || (target ->> 'key') and r.value #>> '{choice,kind}' = 'line'
            and pg_catalog.lower(r.value #>> '{choice,estimate_item_id}') = line.id::text) then
        raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
          detail = pg_catalog.jsonb_build_object('reason', 'target_unproven', 'estimate_item_id', line.id)::text;
      end if;
      -- What this confirmation replaces: the line's live parts of the item read on this same plan on the pages it covers
      -- (a part also lying on a page it does not cover is not cut), and those the page decisions take out.
      if exists (select 1 from public.takeoff_item_send_parts as p
          where p.target_id = live_target_id and p.state = 'live' and p.plan_logical_id = plan_key
            and pg_catalog.cardinality(p.pages) > 0 and p.pages && covered and not (p.pages <@ covered)) then
        raise exception 'TAKEOFF_ITEM_SEND_PAGE_DECISION_INVALID' using errcode = '22023',
          detail = pg_catalog.jsonb_build_object('reason', 'part_indivisible', 'estimate_item_id', line.id)::text;
      end if;
      select coalesce(pg_catalog.array_agg(p.id order by p.id), '{}'::uuid[]) into target_replaced
      from public.takeoff_item_send_parts as p
      where p.target_id = live_target_id and p.state = 'live'
        and ((p.plan_logical_id = plan_key and ((pg_catalog.cardinality(p.pages) > 0 and p.pages <@ covered)
            or (pg_catalog.cardinality(p.pages) = 0 and unit_pages <@ covered)))
          or p.id = any(page_replaced));
      -- What the line keeps of the item has one identity, this one, or nothing is added to it (the planner's earlierOf):
      -- the parts this confirmation replaces leave the line and are not compared.
      if exists (select 1 from public.takeoff_item_send_parts as p where p.target_id = live_target_id and p.state = 'live'
          and not (p.id = any(target_replaced))
          and pg_catalog.jsonb_build_object('unit', p.unit_code, 'basis', p.basis, 'network', p.network, 'material', p.material,
            'diameter', p.diameter) is distinct from identity) then
        raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
          detail = pg_catalog.jsonb_build_object('reason', 'identity_conflict', 'estimate_item_id', line.id)::text;
      end if;
      select coalesce(pg_catalog.sum(p.quantity) filter (where not (p.id = any(target_replaced))), 0),
          coalesce(pg_catalog.sum(p.quantity), 0), pg_catalog.count(*)::integer
        into kept_sum, all_sum, parts_count
      from public.takeoff_item_send_parts as p where p.target_id = live_target_id and p.state = 'live';
      reference := null;
      legacy_measure := 0;
      legacy_protective := 0;
      legacy_count := 0;
      if target #>> '{line,kind}' = 'dpgf_line' then
        reference := private.takeoff_item_send_dpgf_reference(tenant, line.source_metadata);
        if reference is distinct from (select (listed.value #>> '{dpgf,reference}')::numeric
            from pg_catalog.jsonb_array_elements(deps -> 'lines') as listed(value)
            where private.takeoff_uuid_or_null(listed.value -> 'estimate_item_id') = line.id) then
          raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
            detail = pg_catalog.jsonb_build_object('reason', 'dpgf_reference_unread', 'estimate_item_id', line.id)::text;
        end if;
        select coalesce(pg_catalog.sum(legacy.quantity), 0), coalesce(pg_catalog.sum(legacy.protective), 0), pg_catalog.count(*)::integer
          into legacy_measure, legacy_protective, legacy_count
        from private.takeoff_item_send_legacy_dpgf_parts(line.source_metadata, target_job_id) as legacy;
      end if;
      -- Before this send, the line held what all its earlier parts wrote (the policy's quantity), or its DPGF reference when
      -- nothing fed it; any other quantity was typed by hand, kept apart, never replaced without the member's choice.
      expected_before := case when parts_count + legacy_count > 0
        then private.takeoff_item_send_composed(reference, all_sum + legacy_measure, legacy_protective, factor) else reference end;
      typed := case when expected_before is null then line.quantity <> 0
        else pg_catalog.round(line.quantity, 4) <> pg_catalog.round(expected_before, 4) end;
      retained := private.takeoff_item_send_composed(reference, kept_sum + legacy_measure + added, legacy_protective, factor);
      after := retained;
      if typed then
        select r.value #>> '{choice,kind}' into choice from pg_catalog.jsonb_array_elements(deps -> 'resolutions') as r(value)
        where r.value ->> 'key' = 'entry:' || (target ->> 'key');
        if choice = 'keep_entry' then
          -- Kept below what the policy retains, the protective maximum would break: the line is not written.
          if reference is not null and line.quantity < retained then
            raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
              detail = pg_catalog.jsonb_build_object('reason', 'entry_suspended', 'estimate_item_id', line.id)::text;
          end if;
          after := line.quantity;
        elsif choice is distinct from 'use_retained' then
          raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
            detail = pg_catalog.jsonb_build_object('reason', 'line_changed', 'estimate_item_id', line.id)::text;
        end if;
      end if;
    end if;
    -- What the plan says it replaces is exactly what this confirmation replaces.
    if pg_catalog.jsonb_array_length(target -> 'replaces') <> pg_catalog.cardinality(target_replaced)
      or exists (select 1 from public.takeoff_item_send_parts as p where p.id = any(target_replaced)
        and not exists (select 1 from pg_catalog.jsonb_array_elements(target -> 'replaces') as r(value)
          where private.takeoff_uuid_or_null(r.value -> 'job_id') = p.job_id
            and private.takeoff_uuid_or_null(r.value -> 'answer_id') = p.answer_id
            and array(select private.takeoff_uuid_or_null(o.value) from pg_catalog.jsonb_array_elements(r.value -> 'observation_ids') as o(value)
              order by 1) = array(select o from pg_catalog.unnest(p.observation_ids) as o order by o))) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'earlier_send_changed', 'item_id', target ->> 'item_id')::text;
    end if;
    -- Never counted twice: this plan's earlier part of the item lies on this target only (elsewhere it would stay).
    if exists (select 1 from public.takeoff_item_send_parts as p
        join public.takeoff_item_send_targets as t on t.id = p.target_id and t.estimate_item_id is not null
        where p.version_id = target_version and p.state = 'live' and p.item_id = (target ->> 'item_id')::uuid
          and p.plan_logical_id = plan_key and p.target_id is distinct from live_target_id) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'earlier_part_elsewhere', 'item_id', target ->> 'item_id')::text;
    end if;
    -- The quantity written: engine 3 holds it as computed, and it is the one the member saw.
    if (after > 0 and after <= 999999999.999 and after = pg_catalog.round(after, 3)) is not true then
      raise exception 'TAKEOFF_ITEM_SEND_QUANTITY_UNWRITABLE' using errcode = '22023',
        detail = pg_catalog.jsonb_build_object('item_id', target ->> 'item_id')::text;
    end if;
    if after is distinct from (target ->> 'quantity_after')::numeric
      or (typed and choice = 'keep_entry') is distinct from coalesce((target #>> '{quantity,kept_entry}')::boolean, false) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'quantity_changed', 'item_id', target ->> 'item_id',
          'computed', pg_catalog.trim_scale(after))::text;
    end if;
    replaced_ids := replaced_ids || target_replaced;
    computed := computed || pg_catalog.jsonb_build_object(target ->> 'key', pg_catalog.jsonb_build_object('after', after,
      'target_id', live_target_id, 'line_id', line.id, 'before', line.quantity, 'identity', identity));
  end loop;
  -- The page contributions the plan shows are those of the parts it writes, page by page, item by item: the pages are the
  -- parts', never the caller's.
  if (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('page', derived.page, 'item_ids', derived.items)
        order by derived.page), '[]'::jsonb)
      from (select page.value as page, pg_catalog.to_jsonb(pg_catalog.array_agg(distinct (t.value ->> 'item_id')::uuid
          order by (t.value ->> 'item_id')::uuid)) as items
        from pg_catalog.jsonb_array_elements(plan -> 'targets') as t(value)
        cross join lateral pg_catalog.jsonb_array_elements(t.value -> 'contributions') as c(value)
        cross join lateral pg_catalog.jsonb_array_elements(c.value -> 'pages') as g(value)
        cross join lateral (select (g.value #>> '{}')::integer as value) as page
        group by page.value) as derived)
    is distinct from (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('page', (listed.value ->> 'page')::integer,
          'item_ids', pg_catalog.to_jsonb(array(select distinct private.takeoff_uuid_or_null(i.value)
            from pg_catalog.jsonb_array_elements(listed.value -> 'item_ids') as i(value) order by 1)))
        order by (listed.value ->> 'page')::integer), '[]'::jsonb)
      from pg_catalog.jsonb_array_elements(plan -> 'page_contributions') as listed(value)) then
    raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', 'page_contributions_changed')::text;
  end if;
  -- A part a page replaced must leave the line this plan feeds: elsewhere, it would stay counted beside the new one.
  if exists (select 1 from pg_catalog.unnest(page_replaced) as r(id) where not (r.id = any(replaced_ids))) then
    raise exception 'TAKEOFF_ITEM_SEND_PAGE_DECISION_INVALID' using errcode = '22023',
      detail = pg_catalog.jsonb_build_object('reason', 'part_elsewhere')::text;
  end if;
  -- The sections the plan creates: none already in the draft by its identity; under a section an earlier send by item
  -- created (by its identity) or one this plan creates before it; each with the list's title.
  for section in select value from pg_catalog.jsonb_array_elements(plan -> 'sections') loop
    if exists (select 1 from public.takeoff_item_send_sections as s
        where s.version_id = target_version and s.section_key = section ->> 'key' and s.estimate_item_id is not null)
      or (coalesce(section -> 'parent_id', 'null'::jsonb) <> 'null'::jsonb and not exists (select 1
        from public.takeoff_item_send_sections as s where s.version_id = target_version
          and s.estimate_item_id = (section ->> 'parent_id')::uuid and s.section_key = section ->> 'parent_key'))
      or (coalesce(section -> 'parent_id', 'null'::jsonb) = 'null'::jsonb
        and coalesce(section -> 'parent_key', 'null'::jsonb) <> 'null'::jsonb and not (section_ids ? (section ->> 'parent_key')))
      -- Its title is the list's: « Métré » without sections, the complement's, « Non réparti », or a section of the sealed
      -- list; a building's or a level's section carries the location's name as the plan read it.
      or (section ->> 'key' = 'list:' and section ->> 'title' <> 'Métré')
      or (section ->> 'key' = 'complement' and section ->> 'title' <> 'Compléments du métré hors DPGF')
      or (section ->> 'key' like '%/unallocated' and section ->> 'title' <> 'Non réparti')
      or (section ->> 'key' not in ('list:', 'complement') and section ->> 'key' not like '%/unallocated'
        and section ->> 'key' !~ '/(level|building):' and not exists (select 1 from public.takeoff_list_revision_entries as entry
          cross join lateral pg_catalog.jsonb_array_elements(entry.sections) as listed(value)
          where entry.revision_id = launch.item_list_revision_id and listed.value ->> 'title' = section ->> 'title')) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'sections_changed')::text;
    end if;
    section_ids := section_ids || pg_catalog.jsonb_build_object(section ->> 'key', true);
  end loop;
  section_ids := '{}'::jsonb;

  -- The first draft, created by « Créer un devis »'s canonical path from the server's payload, under the tenant's policy
  -- (its engine and its creation contract), of engine 3 only, with the settings the plan showed. The affaire's row is
  -- held FOR UPDATE: two first creations of one affaire never cross.
  if destination_kind = 'first_draft' then
    created := public.persist_estimate_creation_atomic(tenant, actor, job.project_id, null, p_request -> 'version_payload',
      '[]'::jsonb, null);
    target_version := (created #>> '{version,id}')::uuid;
    created_version := true;
    -- A version created here has no other holder: its lease lives only in this transaction.
    insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
    values (target_version, actor, tenant, pg_catalog.statement_timestamp() + interval '5 minutes', gen_random_uuid())
    returning id into created_lock;
    select * into version_row from public.estimate_versions as version where version.id = target_version;
    if version_row.calc_engine_version is distinct from 3 then
      raise exception 'TAKEOFF_ITEM_SEND_ENGINE_NOT_V3' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_build_object('title', version_row.title, 'validite_jours', version_row.validite_jours,
        'margin_multiplier', version_row.margin_multiplier, 'margin_mode', version_row.margin_mode, 'currency', version_row.currency,
        'margin_bp', version_row.margin_bp, 'discount_bp', version_row.discount_bp,
        'discount_amount_cents', version_row.discount_amount_cents, 'discount_mode', version_row.discount_mode,
        'discount_steps', version_row.discount_steps, 'global_coefficient', version_row.global_coefficient,
        'tax_rate_bp', version_row.tax_rate_bp, 'rounding_mode', version_row.rounding_mode,
        'rounding_step_cents', version_row.rounding_step_cents, 'max_section_depth', version_row.max_section_depth,
        'calc_engine_version', version_row.calc_engine_version, 'contractor_role', version_row.contractor_role,
        'sale_coefficient_fo', version_row.sale_coefficient_fo, 'sale_coefficient_mo', version_row.sale_coefficient_mo)
      is distinct from (select coalesce(pg_catalog.jsonb_object_agg(setting.key, setting.value), '{}'::jsonb)
        from pg_catalog.jsonb_each(coalesce(deps #> '{stamps,first_draft_settings}', '{}'::jsonb)) as setting(key, value)
        where setting.key in ('title', 'validite_jours', 'margin_multiplier', 'margin_mode', 'currency', 'margin_bp',
          'discount_bp', 'discount_amount_cents', 'discount_mode', 'discount_steps', 'global_coefficient', 'tax_rate_bp',
          'rounding_mode', 'rounding_step_cents', 'max_section_depth', 'calc_engine_version', 'contractor_role',
          'sale_coefficient_fo', 'sale_coefficient_mo')) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'creation_policy_changed')::text;
    end if;
  end if;

  -- The writes. The relations of migration C accept them inside this transaction only.
  perform pg_catalog.set_config('mergeone.takeoff_item_send', request::text, true);
  previous_writer := coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true), '');
  perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', target_version::text, true);

  -- Sections, parents first, each after its siblings.
  for section in select value from pg_catalog.jsonb_array_elements(plan -> 'sections') loop
    parent := coalesce(private.takeoff_uuid_or_null(section -> 'parent_id'), (section_ids ->> (section ->> 'parent_key'))::uuid);
    select coalesce(pg_catalog.max(item.position), 0) + 1 into next_position from public.estimate_items as item
    where item.version_id = target_version and item.tenant_id = tenant and item.parent_id is not distinct from parent;
    insert into public.estimate_items (tenant_id, version_id, parent_id, item_type, position, title)
    values (tenant, target_version, parent, 'section'::public.estimate_item_type, next_position, section ->> 'title')
    returning id into new_id;
    insert into public.takeoff_item_send_sections (tenant_id, project_id, version_id, section_key, title, estimate_item_id, receipt_id)
    values (tenant, job.project_id, target_version, section ->> 'key', section ->> 'title', new_id, this_receipt);
    section_ids := section_ids || pg_catalog.jsonb_build_object(section ->> 'key', new_id);
    sections_out := sections_out || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('key', section ->> 'key',
      'estimate_item_id', new_id));
  end loop;

  -- The parts replaced leave their lines first (journal: replaced by this receipt).
  update public.takeoff_item_send_parts as p set state = 'replaced', replaced_by_receipt_id = this_receipt,
    replaced_at = pg_catalog.statement_timestamp()
  where p.id = any(replaced_ids) and p.state = 'live';

  for target in select value from pg_catalog.jsonb_array_elements(plan -> 'targets') loop
    facts := computed -> (target ->> 'key');
    after := (facts ->> 'after')::numeric;
    identity := facts -> 'identity';
    live_target_id := private.takeoff_uuid_or_null(facts -> 'target_id');
    if target #>> '{line,kind}' = 'new_line' then
      parent := coalesce(private.takeoff_uuid_or_null(target #> '{line,section_id}'),
        (section_ids ->> (target #>> '{line,section_key}'))::uuid);
      select coalesce(pg_catalog.max(item.position), 0) + 1 into next_position from public.estimate_items as item
      where item.version_id = target_version and item.tenant_id = tenant and item.parent_id = parent;
      -- Engine 3's initial values and no price; the unit kept in its code (and its description, as the takeoff writes it).
      insert into public.estimate_items (tenant_id, version_id, parent_id, item_type, position, title, description, quantity,
        unit_code, pricing_status, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo, pu_ht_cents,
        line_total_ht_cents, line_tax_cents, line_total_ttc_cents, category_id, source_provider, source_job_id, source_metadata)
      values (tenant, target_version, parent, 'line'::public.estimate_item_type, next_position, target #>> '{line,title}',
        target ->> 'unit_code', after, target ->> 'unit_code', 'priced'::public.estimate_line_pricing_status, 0,
        version_row.tax_rate_bp, 1, 0, 1, 1, 0, 0, 0, 0, private.takeoff_uuid_or_null(target #> '{rule,category_id}'), 'takeoff',
        target_job_id, pg_catalog.jsonb_build_object('takeoff_item_send', pg_catalog.jsonb_build_object('version', 1,
          'item_id', target ->> 'item_id', 'compartment_key', target ->> 'compartment_key', 'breakdown', send_breakdown)))
      returning id into new_id;
      insert into public.takeoff_item_send_targets (tenant_id, project_id, version_id, item_id, breakdown, compartment_key,
        estimate_item_id, line_kind, unit_code, basis, network, material, diameter, created_by_receipt_id)
      values (tenant, job.project_id, target_version, (target ->> 'item_id')::uuid, send_breakdown, target ->> 'compartment_key',
        new_id, 'new_line', target ->> 'unit_code', identity ->> 'basis', identity ->> 'network', identity ->> 'material',
        identity ->> 'diameter', this_receipt)
      returning id into live_target_id;
      lines_out := lines_out || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('target_key', target ->> 'key',
        'item_id', target ->> 'item_id', 'estimate_item_id', new_id, 'change', 'created', 'quantity_before', null,
        'quantity_after', pg_catalog.trim_scale(after)));
    else
      new_id := private.takeoff_uuid_or_null(facts -> 'line_id');
      if live_target_id is null then
        insert into public.takeoff_item_send_targets (tenant_id, project_id, version_id, item_id, breakdown, compartment_key,
          estimate_item_id, line_kind, unit_code, basis, network, material, diameter, created_by_receipt_id)
        values (tenant, job.project_id, target_version, (target ->> 'item_id')::uuid, 'dpgf', 'dpgf', new_id, 'dpgf_line',
          target ->> 'unit_code', identity ->> 'basis', identity ->> 'network', identity ->> 'material', identity ->> 'diameter',
          this_receipt)
        returning id into live_target_id;
      end if;
      -- Only the quantity moves (and what engine 3 derives from it); the provenance says a send by item feeds the line.
      update public.estimate_items as item set quantity = after,
        source_metadata = coalesce(item.source_metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object('takeoff_item_send',
          pg_catalog.jsonb_build_object('version', 1, 'item_id', target ->> 'item_id',
            'compartment_key', target ->> 'compartment_key',
            'breakdown', case when target #>> '{line,kind}' = 'dpgf_line' then 'dpgf' else send_breakdown end)),
        updated_at = pg_catalog.statement_timestamp()
      where item.id = new_id;
      lines_out := lines_out || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('target_key', target ->> 'key',
        'item_id', target ->> 'item_id', 'estimate_item_id', new_id,
        'change', case when (facts ->> 'before')::numeric = after then 'unchanged' else 'changed' end,
        'quantity_before', pg_catalog.trim_scale((facts ->> 'before')::numeric), 'quantity_after', pg_catalog.trim_scale(after)));
    end if;
    written_ids := written_ids || new_id;
    -- The parts, as read from the stored rows and entries, with the identity derived here.
    for part in
      select stored.value as stored
      from pg_catalog.jsonb_array_elements(target -> 'contributions') as c(value)
      join pg_catalog.jsonb_array_elements(job_parts) as stored(value) on stored.value ->> 'item_id' = target ->> 'item_id'
        and stored.value ->> 'answer_id' = c.value ->> 'answer_id' and stored.value ->> 'kind' = c.value ->> 'kind'
        and (stored.value ->> 'kind' = 'entered'
          or pg_catalog.jsonb_build_array(stored.value -> 'observation_id') = c.value -> 'observation_ids')
    loop
      insert into public.takeoff_item_send_parts (tenant_id, project_id, version_id, target_id, receipt_id, job_id, item_id,
        plan_logical_id, kind, answer_id, answer_revision, decision_revision, entry_id, entry_revision, observation_ids,
        takeoff_item_ids, quantity, unit, unit_code, basis, network, material, diameter, pages)
      values (tenant, job.project_id, target_version, live_target_id, this_receipt, target_job_id, (target ->> 'item_id')::uuid,
        (part.stored ->> 'plan_logical_id')::uuid, part.stored ->> 'kind', (part.stored ->> 'answer_id')::uuid,
        part.stored ->> 'answer_revision', (part.stored ->> 'decision_revision')::integer,
        private.takeoff_uuid_or_null(part.stored -> 'entry_id'), (part.stored ->> 'entry_revision')::integer,
        case when part.stored ->> 'kind' = 'measured' then array[(part.stored ->> 'observation_id')::uuid] else '{}'::uuid[] end,
        case when part.stored ->> 'kind' = 'measured' then array[(part.stored ->> 'takeoff_item_id')::uuid] else '{}'::uuid[] end,
        (part.stored ->> 'quantity')::numeric, part.stored ->> 'unit', target ->> 'unit_code', identity ->> 'basis',
        identity ->> 'network', identity ->> 'material', identity ->> 'diameter',
        array(select (g.value #>> '{}')::integer from pg_catalog.jsonb_array_elements(part.stored -> 'pages') as g(value)));
    end loop;
  end loop;
  -- What engine 3 derives from the quantities, for the lines this send wrote.
  perform public.estimate_v3_complete_entry_for_writer(target_version, written_ids);
  perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', previous_writer, true);

  -- The page contributions: one per page of this plan the send brought, with its items and its parts there, from the
  -- parts it wrote (a part without a page stands on every page).
  insert into public.takeoff_item_send_pages (tenant_id, project_id, version_id, receipt_id, job_id, document, page, item_ids,
    part_ids)
  select tenant, job.project_id, target_version, this_receipt, target_job_id, plan_document, written.page,
    pg_catalog.array_agg(distinct written.item_id order by written.item_id), pg_catalog.array_agg(distinct written.id order by written.id)
  from (select p.id, p.item_id, page.value as page from public.takeoff_item_send_parts as p
      cross join lateral pg_catalog.unnest(case when pg_catalog.cardinality(p.pages) > 0 then p.pages else array[null::integer] end)
        as page(value)
      where p.receipt_id = this_receipt) as written
  group by written.page;

  -- The job: linked to its draft through the door of this transaction (naming the acting member), then applied (B2
  -- closes its plan to every bulk gesture, as after today's send).
  insert into private.takeoff_job_attachment_permits (job_id, tenant_id, project_id, version_id)
  values (target_job_id, tenant, job.project_id, target_version);
  insert into private.takeoff_item_send_checks (job_id, actor_id) values (target_job_id, actor);
  update public.takeoff_jobs as attached set estimate_version_id = target_version where attached.id = target_job_id;
  if exists (select 1 from private.takeoff_job_attachment_permits as permit where permit.job_id = target_job_id) then
    raise exception 'TAKEOFF_ITEM_SEND_PERMIT_NOT_CONSUMED' using errcode = 'P0001';
  end if;
  update public.takeoff_jobs as sent set status = 'applied'::public.takeoff_job_status,
    completed_at = coalesce(sent.completed_at, pg_catalog.statement_timestamp()), updated_at = pg_catalog.statement_timestamp()
  where sent.id = target_job_id;
  delete from private.takeoff_item_send_checks as checked where checked.job_id = target_job_id;
  if created_lock is not null then
    delete from public.draft_locks as lock_row where lock_row.id = created_lock;
  end if;

  -- The receipt: what was written, in the plan's order; the first line written is the one to open (else the first
  -- section created).
  focus := (select private.takeoff_uuid_or_null(l.value -> 'estimate_item_id')
    from pg_catalog.jsonb_array_elements(lines_out) with ordinality as l(value, n)
    where l.value ->> 'change' <> 'unchanged' order by l.n limit 1);
  outcome := pg_catalog.jsonb_build_object('format', 'takeoff_item_send', 'format_version', 1, 'job_id', target_job_id,
    'version_id', target_version, 'version_created', created_version, 'sections_created', sections_out, 'lines', lines_out,
    'lines_written', (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(lines_out) as l(value)
      where l.value ->> 'change' <> 'unchanged'),
    'parts_written', (select pg_catalog.count(*) from public.takeoff_item_send_parts as p where p.receipt_id = this_receipt),
    'parts_replaced', pg_catalog.cardinality(replaced_ids), 'page_decisions', plan -> 'page_decisions',
    'focus_item_id', coalesce(focus, private.takeoff_uuid_or_null(sections_out #> '{0,estimate_item_id}')),
    'override', null,
    'rules', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('item_id', t.value ->> 'item_id',
        'rule', t.value -> 'rule') order by t.ordinality)
      from pg_catalog.jsonb_array_elements(plan -> 'targets') with ordinality as t(value, ordinality)
      where coalesce(t.value -> 'rule', 'null'::jsonb) <> 'null'::jsonb), '[]'::jsonb));
  begin
    insert into public.takeoff_item_send_receipts (id, tenant_id, project_id, job_id, version_id, request_id, format_version,
      actor_id, plan_sha256, version_created, write_plan, result)
    values (this_receipt, tenant, job.project_id, target_job_id, target_version, request, 1, actor, plan_sha, created_version, plan,
      outcome);
  exception when unique_violation then
    -- The same intention key used meanwhile by a send of another affaire of the tenant: the documented conflict.
    raise exception 'TAKEOFF_ITEM_SEND_REQUEST_CONFLICT' using errcode = '40001';
  end;
  perform pg_catalog.set_config('mergeone.takeoff_item_send', '', true);
  return pg_catalog.jsonb_build_object('receipt_id', this_receipt, 'replayed', false) || outcome;
end;
$$;
revoke all on function public.send_takeoff_item_plan(uuid, uuid, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.send_takeoff_item_plan(uuid, uuid, boolean, jsonb) to service_role;

commit;
