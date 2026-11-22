-- Lot 4, the copy of a draft fed by item: a copy keeps the contributions of the send by item.
--
-- Migration C (20261122205109_takeoff_item_send_writer.sql) stores what a send by item leaves in a draft: its live targets
-- (one per item, breakdown and compartment, each holding one line), the journal of its parts, the sections it created
-- and the page contributions, each under the receipt of the send that wrote it. A new version or a variant made from a
-- version (public.duplicate_estimate_version, which today's send also uses to copy an issued version) copies every line
-- of the version. From this migration on, the same transaction carries C's rows to the copy:
--   - every live target, keyed to the copied line of the line it holds (lines map by their place in the tree, as the
--     copy's article links already do); a target whose line was deleted is not copied, and a line the copy does not
--     carry carries no target;
--   - every live part of a copied target, with its sources, revisions, quantitative identity and pages, naming the part
--     it was copied from (takeoff_item_send_parts.copied_from_part_id);
--   - the sections a send created that the copy carries, by their identity;
--   - the page contributions of the copied parts, so that the page guard of a send into the copy holds what the
--     original's sends brought;
--   - one receipt « copy » per receipt of the source those rows came from, naming it (copied_from_receipt_id): the copy's
--     journal says where each part comes from. Replaced parts (the source's history) are not copied; the source version
--     is not touched.
-- A send into the copy then behaves as into the original: the same plan read again replaces its own earlier part on the
-- pages it covers, another plan adds, a page the original's send brought is held, a line is claimed by one item at most.
-- Today's writers keep being refused on a version holding a live target (public.enforce_takeoff_apply_security, from
-- migration C, unchanged here): a copy of a version fed by item holds live targets, so today's send into a copy of an
-- issued version (private.takeoff_send_execute, which calls the duplication) is refused with no other change.
--
-- The other copies of an engine 3 version's lines carry no target, by decision: a section duplicated in a draft or
-- imported from another version (the batch writer, src/lib/estimates/v3-section-copy.ts), and the lines a template
-- brings (templates keep no provenance at all), are the member's own lines. The section copy now clears the line's
-- item-send marker (source_metadata.takeoff_item_send): a marker counts only with the live target the send wrote for that
-- line, and a copied line is an ordinary line for the writer, its page guard, the preview and today's writers. What is
-- left for the writer's TAKEOFF_ITEM_SEND_COPY_UNREAD is an integrity case only: a line the send marked whose target is
-- gone while the line stays (its journal lost), never counted twice.
--
-- Functions:
--   - created: private.takeoff_item_send_carry_copy(source, copy), called by the duplication only;
--   - replaced: public.duplicate_estimate_version(uuid, boolean), on its latest body
--     (20260825200420_link_estimate_items_to_products.sql, the wrapper that carries the article links): it takes the
--     affaire's row first (the spine's rank 2, as every writer of the affaire's versions takes it, before the source
--     version's row the duplication locks), then carries C's rows after the article links. The duplication itself
--     (public.duplicate_estimate_version_without_product_id, latest body 20261112093830_unified_kfo.sql as
--     20261121170448_takeoff_launch_requests.sql patched its affaire lock) is unchanged.
-- Lock ranks of a copy, in the spine's order (docs/metier/regles-metre.md), never the reverse: 2. the affaire's row
-- (for no key update, taken first by the wrapper; the duplication takes it again with the source version's row, at the
-- same strength since 20261121170448, so that a worker's notice, whose foreign key checks the affaire, never waits for a
-- copy: takeoff-copy-lock-cycle-race.test.sql); 3. the source
-- version's row (for update); 5. the takeoffs linked to the source (for share, the duplication's). It never takes rank 1
-- (the calc policy's key): a send (rank 1 shared, then the affaire) and a copy of the same affaire wait on each other at
-- the affaire's row, in one order, whichever version either targets (takeoff-item-send-race.test.sql, cases 10 and 11).
-- C's rows are read under the affaire's row: every writer of them holds it.
-- Columns: takeoff_item_send_receipts.command_kind admits « copy »; takeoff_item_send_receipts.copied_from_receipt_id and
-- takeoff_item_send_parts.copied_from_part_id name what a copy was made from. Neither has a foreign key: the source's rows
-- go with their version (its cascade), and a set-null action would update a part, which C's write guard refuses
-- (a part only moves from live to replaced); the identifier stays as the record of where the copy came from.
--
-- What a version no send by item fed pays: one indexed read of takeoff_item_send_targets (by its version) that finds no
-- row; the affaire's row lock it takes first is the one the duplication already takes. What the released application
-- sees: nothing else changes in its writes or answers.
--
-- A copy made before this migration of a version fed by item: none exists (nothing is activated: no job is read against
-- a list, no send by item ever wrote). If one did, its lines would carry the marker without a target; this migration
-- rebuilds nothing it cannot know, and the writer refuses such a draft (TAKEOFF_ITEM_SEND_COPY_UNREAD). Read-only
-- pre-check (each 0):
--   select count(*) from public.takeoff_item_send_receipts;
--   select count(*) from public.estimate_items where source_metadata ? 'takeoff_item_send';
--
-- Locks: the two tables altered are locked first, without waiting (nowait); they are written by the send by item only,
-- inactive. Nothing is copied or backfilled.
begin;

set local lock_timeout = '5s';
set local check_function_bodies = off;

lock table public.takeoff_item_send_receipts, public.takeoff_item_send_parts in access exclusive mode nowait;

-- 1. The copy's receipts and parts name what they were copied from.
alter table public.takeoff_item_send_receipts drop constraint takeoff_item_send_receipts_command_kind_check;
alter table public.takeoff_item_send_receipts add constraint takeoff_item_send_receipts_command_kind_check
  check (command_kind in ('send', 'copy'));
alter table public.takeoff_item_send_receipts add column copied_from_receipt_id uuid;
alter table public.takeoff_item_send_receipts add constraint takeoff_item_send_receipts_copy_check
  check ((command_kind = 'copy') = (copied_from_receipt_id is not null));
comment on column public.takeoff_item_send_receipts.copied_from_receipt_id is
  'A receipt « copy »: the receipt of the source version its rows were copied from. No foreign key: the source''s rows go '
  'with their version, and the identifier stays as the record of where the copy came from.';
alter table public.takeoff_item_send_parts add column copied_from_part_id uuid;
comment on column public.takeoff_item_send_parts.copied_from_part_id is
  'A part a copy carried: the live part of the source version it was copied from. No foreign key: a set-null action would '
  'update the part, which the write guard refuses (a part only moves from live to replaced).';

-- 2. The carry: C's rows of the source version, for the copy, in the duplication's transaction (its locks held: the
--    affaire's row and the source version's row, so that no send into either moves them meanwhile).
create function private.takeoff_item_send_carry_copy(p_source_version_id uuid, p_copy_version_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  line_map jsonb;
  target_map jsonb;
  part_map jsonb;
  receipt_map jsonb;
  previous_writer text;
begin
  -- A version no send by item fed: one indexed read that finds no row.
  if not exists (select 1 from public.takeoff_item_send_targets as target
      where target.version_id = p_source_version_id and target.estimate_item_id is not null) then
    return;
  end if;

  -- The copied lines by their place in the tree (sibling positions are unique: estimate_items_root_position_unique,
  -- estimate_items_child_position_unique), as the copy's article links map them.
  with recursive source_tree as (
    select item.id, array[item.position] as position_path from public.estimate_items as item
    where item.version_id = p_source_version_id and item.parent_id is null
    union all
    select child.id, parent.position_path || child.position from public.estimate_items as child
    join source_tree as parent on parent.id = child.parent_id
    where child.version_id = p_source_version_id
  ), copy_tree as (
    select item.id, array[item.position] as position_path from public.estimate_items as item
    where item.version_id = p_copy_version_id and item.parent_id is null
    union all
    select child.id, parent.position_path || child.position from public.estimate_items as child
    join copy_tree as parent on parent.id = child.parent_id
    where child.version_id = p_copy_version_id
  )
  select coalesce(pg_catalog.jsonb_object_agg(source.id::text, copied.id::text), '{}'::jsonb) into line_map
  from source_tree as source join copy_tree as copied on copied.position_path = source.position_path;

  -- What is carried: the live targets whose line the copy carries, their live parts, the sections it carries, and the
  -- receipts they came from.
  select coalesce(pg_catalog.jsonb_object_agg(target.id::text, pg_catalog.gen_random_uuid()::text), '{}'::jsonb) into target_map
  from public.takeoff_item_send_targets as target
  where target.version_id = p_source_version_id and target.estimate_item_id is not null
    and line_map ? target.estimate_item_id::text;
  select coalesce(pg_catalog.jsonb_object_agg(part.id::text, pg_catalog.gen_random_uuid()::text), '{}'::jsonb) into part_map
  from public.takeoff_item_send_parts as part
  where part.version_id = p_source_version_id and part.state = 'live' and target_map ? part.target_id::text;
  select coalesce(pg_catalog.jsonb_object_agg(receipt.id::text, pg_catalog.gen_random_uuid()::text), '{}'::jsonb) into receipt_map
  from public.takeoff_item_send_receipts as receipt
  where receipt.version_id = p_source_version_id
    and (exists (select 1 from public.takeoff_item_send_targets as target
        where target.created_by_receipt_id = receipt.id and target_map ? target.id::text)
      or exists (select 1 from public.takeoff_item_send_parts as part
        where part.receipt_id = receipt.id and part_map ? part.id::text)
      or exists (select 1 from public.takeoff_item_send_sections as section
        where section.receipt_id = receipt.id and section.estimate_item_id is not null and line_map ? section.estimate_item_id::text)
      or exists (select 1 from public.takeoff_item_send_pages as page_row
        where page_row.receipt_id = receipt.id and exists (select 1 from pg_catalog.unnest(page_row.part_ids) as x(id)
          where part_map ? x.id::text)));
  if receipt_map = '{}'::jsonb then
    return;
  end if;

  -- The relations of migration C accept these writes inside this transaction only (their write guard).
  previous_writer := coalesce(pg_catalog.current_setting('mergeone.takeoff_item_send', true), '');
  perform pg_catalog.set_config('mergeone.takeoff_item_send', 'copy:' || p_copy_version_id::text, true);

  insert into public.takeoff_item_send_receipts (id, tenant_id, project_id, job_id, version_id, request_id, command_kind,
    format_version, actor_id, plan_sha256, version_created, write_plan, result, copied_from_receipt_id)
  select (receipt_map ->> receipt.id::text)::uuid, receipt.tenant_id, receipt.project_id, receipt.job_id, p_copy_version_id,
    pg_catalog.gen_random_uuid(), 'copy', 1, coalesce((select auth.uid()), receipt.actor_id), receipt.plan_sha256, false,
    pg_catalog.jsonb_build_object('copied_from_receipt_id', receipt.id, 'source_version_id', p_source_version_id),
    pg_catalog.jsonb_build_object('copied_from_receipt_id', receipt.id, 'source_version_id', p_source_version_id,
      'version_id', p_copy_version_id),
    receipt.id
  from public.takeoff_item_send_receipts as receipt
  where receipt_map ? receipt.id::text;

  insert into public.takeoff_item_send_targets (id, tenant_id, project_id, version_id, item_id, breakdown, compartment_key,
    estimate_item_id, line_kind, unit_code, basis, network, material, diameter, created_by_receipt_id)
  select (target_map ->> target.id::text)::uuid, target.tenant_id, target.project_id, p_copy_version_id, target.item_id,
    target.breakdown, target.compartment_key, (line_map ->> target.estimate_item_id::text)::uuid, target.line_kind,
    target.unit_code, target.basis, target.network, target.material, target.diameter,
    (receipt_map ->> target.created_by_receipt_id::text)::uuid
  from public.takeoff_item_send_targets as target
  where target_map ? target.id::text;

  insert into public.takeoff_item_send_parts (id, tenant_id, project_id, version_id, target_id, receipt_id, job_id, item_id,
    plan_logical_id, kind, answer_id, answer_revision, decision_revision, entry_id, entry_revision, observation_ids,
    takeoff_item_ids, quantity, unit, unit_code, basis, network, material, diameter, pages, copied_from_part_id)
  select (part_map ->> part.id::text)::uuid, part.tenant_id, part.project_id, p_copy_version_id,
    (target_map ->> part.target_id::text)::uuid, (receipt_map ->> part.receipt_id::text)::uuid, part.job_id, part.item_id,
    part.plan_logical_id, part.kind, part.answer_id, part.answer_revision, part.decision_revision, part.entry_id,
    part.entry_revision, part.observation_ids, part.takeoff_item_ids, part.quantity, part.unit, part.unit_code, part.basis,
    part.network, part.material, part.diameter, part.pages, part.id
  from public.takeoff_item_send_parts as part
  where part_map ? part.id::text;

  insert into public.takeoff_item_send_sections (tenant_id, project_id, version_id, section_key, title, estimate_item_id,
    receipt_id)
  select section.tenant_id, section.project_id, p_copy_version_id, section.section_key, section.title,
    (line_map ->> section.estimate_item_id::text)::uuid, (receipt_map ->> section.receipt_id::text)::uuid
  from public.takeoff_item_send_sections as section
  where section.version_id = p_source_version_id and section.estimate_item_id is not null
    and line_map ? section.estimate_item_id::text and receipt_map ? section.receipt_id::text;

  insert into public.takeoff_item_send_pages (tenant_id, project_id, version_id, receipt_id, job_id, document, page, item_ids,
    part_ids)
  select page_row.tenant_id, page_row.project_id, p_copy_version_id, (receipt_map ->> page_row.receipt_id::text)::uuid,
    page_row.job_id, page_row.document, page_row.page,
    array(select distinct part.item_id from public.takeoff_item_send_parts as part
      where part.id = any(page_row.part_ids) and part_map ? part.id::text order by 1),
    array(select (part_map ->> x.id::text)::uuid from pg_catalog.unnest(page_row.part_ids) as x(id)
      where part_map ? x.id::text order by 1)
  from public.takeoff_item_send_pages as page_row
  where page_row.version_id = p_source_version_id and receipt_map ? page_row.receipt_id::text
    and exists (select 1 from pg_catalog.unnest(page_row.part_ids) as x(id) where part_map ? x.id::text);

  perform pg_catalog.set_config('mergeone.takeoff_item_send', previous_writer, true);
end;
$$;
revoke all on function private.takeoff_item_send_carry_copy(uuid, uuid) from public, anon, authenticated, service_role;

-- 3. From 20260825200420_link_estimate_items_to_products.sql (its latest body): the affaire's row first, then the
--    duplication and the article links unchanged, then the carry of the send by item's rows.
create or replace function public.duplicate_estimate_version(
  source_version_id uuid,
  as_variant boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_version_id uuid;
begin
  -- The affaire's row first (the spine's rank 2), at the strength the duplication and the send take it (no key update:
  -- it excludes every send and copy of the affaire, never a foreign key's check, 20261121170448), before the source
  -- version's row the duplication locks (rank 3): a send into the source or into a copy and this copy wait on each
  -- other in one order. Only for a member of the version's tenant (the duplication checks the right itself).
  perform 1 from public.estimate_projects as project
  join public.estimate_versions as version on version.project_id = project.id and version.tenant_id = project.tenant_id
  join public.tenant_memberships as membership on membership.tenant_id = project.tenant_id
    and membership.user_id = (select auth.uid())
  where version.id = duplicate_estimate_version.source_version_id
  for no key update of project;

  new_version_id := public.duplicate_estimate_version_without_product_id(
    source_version_id,
    as_variant
  );

  with recursive source_tree as (
    select item.id, item.product_id, array[item.position] as position_path
    from public.estimate_items item
    where item.version_id = source_version_id
      and item.parent_id is null

    union all

    select child.id, child.product_id, parent.position_path || child.position
    from public.estimate_items child
    join source_tree parent on parent.id = child.parent_id
    where child.version_id = source_version_id
  ), target_tree as (
    select item.id, array[item.position] as position_path
    from public.estimate_items item
    where item.version_id = new_version_id
      and item.parent_id is null

    union all

    select child.id, parent.position_path || child.position
    from public.estimate_items child
    join target_tree parent on parent.id = child.parent_id
    where child.version_id = new_version_id
  )
  update public.estimate_items target
  set product_id = source.product_id
  from source_tree source
  join target_tree copied on copied.position_path = source.position_path
  where target.id = copied.id
    and source.product_id is not null;

  -- Lot 4: the copy keeps the contributions of the send by item (nothing for a version no send by item fed).
  perform private.takeoff_item_send_carry_copy(source_version_id, new_version_id);

  return new_version_id;
end;
$$;

revoke all on function public.duplicate_estimate_version(uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.duplicate_estimate_version(uuid, boolean)
  to authenticated;

commit;
