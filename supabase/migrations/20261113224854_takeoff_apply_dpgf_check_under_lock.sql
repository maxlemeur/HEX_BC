-- TI-728. No remote application is authorized here: on the shared database it applies after
-- 20261113211347_takeoff_dpgf_section_replace.sql (TI-726). No application code changes with it.
--
-- The 4-argument overload of public.apply_takeoff_job_guarded_atomic serves a version without a DPGF line, and refuses
-- a version that holds one (TAKEOFF_DPGF_APPLY_AUTHORIZATION_REQUIRED). It checked that before its locks. A DPGF line
-- saved between that check and the version's lock escaped it. The writer then deleted the line (« Remplacer la
-- section ») or merged the takeoff onto it by designation and unit (« Fusionner »), and its DPGF quantity and provider
-- were lost without a word. pgTAP takeoff-apply-dpgf-check-race shows both on dd372102: the copied DPGF line gone, then
-- the line rewritten as a takeoff line of 4 ml where the DPGF printed 12 ml.
-- The check now runs under the version's row lock (estimate_versions, FOR UPDATE), the lock every writer of a DPGF line
-- into an existing version holds until it commits. The linked DPGF import and the section copy write through
-- public.copy_estimate_items_atomic (engines 1/2) or public.commit_estimate_batch (engine 3), and both lock that row
-- before they insert. A plain insert waits on it through its foreign key (FOR KEY SHARE). Any other write of a line (a
-- raw update that would make it a DPGF line included) locks it too, after the row, through the AFTER trigger
-- bump_estimate_content_revision_from_item. Its bypasses are writers that already hold the row (the atomic creation),
-- the order RPCs (position and parent only) and the service-role freeze (prices only). Once the application holds the
-- row, a DPGF line committed earlier is visible to the check (a new statement, a new snapshot) and the application is
-- refused. A DPGF writer that comes later waits until the application commits, and its line lands beside the takeoff's
-- lines. A raw update the application's writer then reaches ends in a detected deadlock, never in a lost line. The DPGF
-- import itself (confirmUnifiedImportFlow, public.persist_estimate_creation_atomic) creates a new version, so it never
-- writes into the version of a takeoff being applied.
-- Lock order, unchanged and shared with the 5-argument overload: the version's takeoff lock (advisory
-- takeoff-rules:<version>), then the version's row, then the job's row and the lines (the writer). The 5-argument
-- overload takes its permit's row before them. The DPGF writers take the version's row and never the takeoff lock, so
-- no wait cycle appears. This migration adds no lock: the check moves after the two locks the overload already took,
-- in the order it already took them.
--
-- Redefined from its newest definition (20261112025548): public.apply_takeoff_job_guarded_atomic (4 arguments). Only
-- the lines marked « TI-728 » change. The 5-argument overload, the writer, the page decisions and every refusal are
-- untouched. No data is rewritten.
begin;

-- From 20261112025548_takeoff_page_decisions.sql (4 arguments: a version without a DPGF line), its newest definition.
-- Only the lines marked « TI-728 » change; those marked « TI-682 D », « TI-686 M3 » and « TI-677 » are unchanged.
-- Its search_path stays exactly pg_catalog (pinned by security-invariants and takeoff-apply-security-definer).
create or replace function public.apply_takeoff_job_guarded_atomic(
  p_job_id uuid,
  p_strategy text,
  p_target_section_id uuid,
  p_mapping_plan jsonb
)
returns table (
  created_count integer,
  updated_count integer,
  ignored_count integer,
  created_ids uuid[],
  scope text,
  item_links jsonb
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  job_tenant_id uuid;
  job_version_id uuid;
  -- TI-686 M3: the application's finalized result, returned once its provisions are marked.
  applied record;
  -- TI-682 D: the atomic application's result, and what the page replacement did with it.
  atomic record;
  replaced record;
begin
  if lower(btrim(coalesce(p_strategy, ''))) = 'replace'
    and p_target_section_id is null
  then
    raise exception 'TAKEOFF_ROOT_REPLACE_DISABLED' using errcode = '22023';
  end if;

  select job.tenant_id, job.estimate_version_id
    into job_tenant_id, job_version_id
  from public.takeoff_jobs as job
  where job.id = p_job_id;

  if job_tenant_id is null
    or not coalesce(public.has_tenant_role(
      job_tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ), false)
  then
    raise exception 'TAKEOFF_APPLY_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  perform public.assert_takeoff_active_tenant(p_job_id, job_tenant_id);

  -- TI-677: the version's lock (the writer's and the review's) before any lock on the job or its lines: a save of
  -- another job's line waits for the application instead of invalidating the job being applied.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-rules:' || job_version_id::text, 0));
  -- TI-682 D (Codex reviews of 708c7fbf and 251a98a1): the version's row, after its advisory lock and before the earlier
  -- lines are read, as the 5-argument overload takes it: an editor's save in flight (public.commit_estimate_batch locks
  -- this row) commits before the decisions are checked, never between their check and the replacement. The decisions'
  -- insert waits on this row too (its foreign key), and race scenario 4 holds while either does.
  perform 1 from public.estimate_versions as version
  where version.id = job_version_id and version.tenant_id = job_tenant_id
  for update;

  -- TI-728: a version that holds a DPGF line goes through the 5-argument overload (its permit and its reconciliation).
  -- Checked here, under the version's row lock, not before the locks: every writer of a DPGF line into this version
  -- (public.copy_estimate_items_atomic, public.commit_estimate_batch) locks this row before it inserts, a plain insert
  -- waits on it through its foreign key, and any other write of a line locks it through the trigger
  -- bump_estimate_content_revision_from_item. A line committed before this lock is seen here and refused. A line saved
  -- after it waits until this application commits. Checked before, a line saved in between escaped the check, then was
  -- deleted (« Remplacer la section ») or rewritten (« Fusionner ») by the writer.
  if exists (
    select 1
    from public.estimate_items as item
    where item.tenant_id = job_tenant_id
      and item.version_id = job_version_id
      and item.item_type = 'line'
      and item.source_provider = 'dpgf'
  ) then
    raise exception 'TAKEOFF_DPGF_APPLY_AUTHORIZATION_REQUIRED'
      using errcode = '42501';
  end if;

  perform set_config('app.takeoff_apply_job', 'on', true);
  perform set_config('app.takeoff_apply_atomic', 'on', true);
  perform private.assert_takeoff_single_quantity_source(p_job_id);
  -- TI-682 D: the earlier contributions of the pages this takeoff reads and its decisions, before anything is written.
  perform private.takeoff_prepare_page_decisions(p_job_id, job_tenant_id, job_version_id, p_strategy, p_mapping_plan);
  select result.* into atomic from public.apply_takeoff_job_atomic(
    p_job_id,p_strategy,p_target_section_id,private.takeoff_page_writer_plan(p_mapping_plan)) as result;
  -- TI-682 D: the replaced pages; finalize_takeoff_lengths works on the links the replacement left, so that it does not
  -- size an earlier line from the new takeoff's lines alone.
  select result.* into replaced from private.takeoff_replace_pages(p_job_id, job_tenant_id, job_version_id,
    atomic.item_links, atomic.created_ids) as result;
  -- TI-686 M3: the finalized result (merged length lines), kept to mark its provisions before it is returned.
  select finalized.* into applied from private.finalize_takeoff_lengths(p_job_id,
    atomic.created_count - (select pg_catalog.count(*)::integer from pg_catalog.unnest(atomic.created_ids) as ids(id)
      where ids.id = any(replaced.removed_ids)),
    atomic.updated_count + pg_catalog.cardinality(replaced.updated_ids), atomic.ignored_count,
    coalesce((select array_agg(ids.id order by ids.id) from pg_catalog.unnest(atomic.created_ids) as ids(id)
      where not ids.id = any(replaced.removed_ids)), '{}'::uuid[]),
    atomic.scope, replaced.remaining_links, p_mapping_plan) as finalized;
  -- TI-682 D: a page another takeoff brought enters only by a decision.
  perform private.assert_takeoff_pages_once(p_job_id, job_version_id);
  -- TI-686 M3: a forced line or an entered hypothesis enters the estimate as an internal provision. TI-682 D: the
  -- replaced lines too, from the new takeoff's sources (the last takeoff wins).
  applied.item_links := coalesce((select jsonb_agg(link.value order by link.value ->> 'takeoff_item_id')
    from pg_catalog.jsonb_array_elements(coalesce(applied.item_links, '[]'::jsonb) || replaced.handled_links) as link(value)), '[]'::jsonb);
  perform private.takeoff_mark_provisions(p_job_id,job_tenant_id,job_version_id,applied.item_links,applied.created_ids);
  return query select applied.created_count,applied.updated_count,applied.ignored_count,applied.created_ids,
    applied.scope,applied.item_links;
end;
$$;

revoke all on function public.apply_takeoff_job_guarded_atomic(
  uuid, text, uuid, jsonb
) from public, anon;
grant execute on function public.apply_takeoff_job_guarded_atomic(
  uuid, text, uuid, jsonb
) to authenticated;

commit;
