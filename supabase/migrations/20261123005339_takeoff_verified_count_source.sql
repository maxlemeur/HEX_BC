-- A member can retain a verified object count as one item's quantity on a plan.
-- A sent part owns the marks revision it certified, including in a draft copy.
-- Its evidence pages locate retained marks. They do not certify full coverage.
-- No historical decision or part is rewritten. Existing measured and entered
-- sources keep their original projections and their separate unique indexes.
-- Review takes its existing affaire, job and proof locks. Confirmation also
-- locks the marks proofs in answer order at rank 8, before locking estimate rows.
-- The copy uses the source draft locks taken by duplicate_estimate_version.
begin;
set local lock_timeout = '2s';
set local check_function_bodies = off;

lock table public.takeoff_item_answer_decisions, public.takeoff_item_send_parts in access exclusive mode nowait;
alter table public.takeoff_item_answer_decisions
  add column quantity_source text check (quantity_source in ('verified_count', 'entered', 'measured')),
  add column chosen_entry_revision integer check (chosen_entry_revision > 0);

alter table public.takeoff_item_send_parts
  add column marks_revision integer,
  drop constraint takeoff_item_send_parts_kind_check,
  drop constraint takeoff_item_send_parts_kind_sources_check,
  add constraint takeoff_item_send_parts_kind_check check (kind in ('entered','measured','verified_count')),
  add constraint takeoff_item_send_parts_kind_sources_check check (case kind
    when 'verified_count' then marks_revision is not null and marks_revision between 1 and 1000000
      and decision_revision is not null and entry_id is null and entry_revision is null
      and quantity = trunc(quantity) and cardinality(observation_ids) = 0 and cardinality(pages) > 0
    else marks_revision is null
      and (kind = 'measured') = (cardinality(observation_ids) = 1 and cardinality(takeoff_item_ids) = 1)
      and (kind = 'entered') = (entry_id is not null and entry_revision is not null)
      and (kind = 'entered' or decision_revision is not null) end);

create unique index takeoff_item_send_parts_live_count_key on public.takeoff_item_send_parts
  (version_id, item_id, plan_logical_id) where state = 'live' and kind = 'verified_count';

-- The quantity requires verification of the complete answer scope. Only
-- pages that bear retained marks are recorded as its evidence. Both the preview and the writer use this projection.
create function private.takeoff_verified_count(p_answer uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('quantity', (s ->> 'quantity')::integer, 'marks_revision', (s ->> 'revision')::integer,
    'pages', array(select (page ->> 'page')::integer from jsonb_array_elements(s -> 'pages') page
      where (page ->> 'retained')::integer > 0 order by 1),
    'unit', s ->> 'unit')
  from public.takeoff_count_answer_states state
  cross join lateral private.takeoff_count_mark_summary(state.answer_id) s
  where state.answer_id = p_answer and state.revision > 0 and s ->> 'quantity' is not null and s ->> 'state' = 'verified'
$$;
revoke all on function private.takeoff_verified_count(uuid) from public, anon, authenticated, service_role;

-- Inputs of one acceptance. A whole-affaire entry has priority on every plan.
-- An excluded hypothesis is never included by choosing a different quantity.
create function private.takeoff_item_quantity_options(p_answer uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('verified', count_, 'alternative_quantity', coalesce(e.quantity, measured.quantity),
    'alternative_source', case when e.id is not null then 'entered' else 'measured' end,
    'alternative_unit', coalesce(e.unit, count_ ->> 'unit'), 'entry_revision', e.revision,
    'available', not exists (select 1 from public.takeoff_item_entries whole where whole.tenant_id = a.tenant_id and whole.project_id = a.project_id
      and whole.item_id = a.item_id and whole.plan_logical_id is null) and coalesce(e.included, true)
      and (e.id is null or count_ is null or private.takeoff_item_send_unit(e.unit) = private.takeoff_item_send_unit(count_ ->> 'unit')))
  from public.takeoff_item_answers a cross join lateral private.takeoff_verified_count(a.id) count_
  left join public.takeoff_item_entries e on e.tenant_id = a.tenant_id and e.project_id = a.project_id
    and e.item_id = a.item_id and e.plan_logical_id = a.plan_logical_id
  left join lateral (select private.takeoff_item_total(array_agg(i.quantity)) as quantity
    from public.takeoff_item_answer_observations o join public.takeoff_items i on i.id = o.takeoff_item_id
    where o.answer_id = a.id and o.role = 'contribution' and not i.is_excluded having count(*) > 0) measured on true
  where a.id = p_answer and (count_ is not null or (e.id is not null and exists (
    select 1 from public.takeoff_item_answer_decisions d where d.answer_id = a.id
      and d.kind = 'accepted' and d.quantity_source = 'verified_count')))
$$;
revoke all on function private.takeoff_item_quantity_options(uuid) from public, anon, authenticated, service_role;

-- If the member chose the count, losing its proof withholds that part until a
-- new acceptance. Falling back to a typed value here would change its source.
create function private.takeoff_item_send_resolved_parts(p_tenant uuid,p_project uuid,p_job uuid,p_pages integer[])
returns setof jsonb language sql stable set search_path = '' as $$
  with decisions as materialized (
    select a.*, d.revision as decision_revision, d.marks_revision, d.chosen_entry_revision
    from public.takeoff_item_answers a join public.takeoff_item_answer_decisions d on d.answer_id = a.id
    where a.tenant_id = p_tenant and a.project_id = p_project and a.job_id = p_job and d.quantity_source = 'verified_count'
  ), current_counts as (
    select d.* from (select distinct plan_logical_id from decisions) plan_
    cross join lateral private.takeoff_item_table_pairs(p_tenant, p_project, plan_.plan_logical_id) pair
    join decisions d on d.id = pair.answer_id and d.item_id = pair.item_id
    where pair.decision_effective = 'accepted'
  )
  select to_jsonb(stored) from private.takeoff_item_send_job_parts(p_tenant,p_project,p_job,p_pages) stored
  where not exists (select 1 from decisions d where d.id = stored.answer_id)
  union all
  select jsonb_build_object('item_id', d.item_id, 'answer_id', d.id, 'answer_revision', d.content_sha256,
    'plan_logical_id', d.plan_logical_id, 'kind','verified_count', 'observation_id', null, 'entry_id',null,
    'entry_revision',null, 'decision_revision', d.decision_revision, 'marks_revision',d.marks_revision,
    'quantity', options #> '{verified,quantity}', 'unit', options #> '{verified,unit}',
    'pages', options #> '{verified,pages}', 'basis',null, 'takeoff_item_ids', array(
      select i.id from public.takeoff_item_answer_observations o join public.takeoff_items i on i.id = o.takeoff_item_id
      where o.answer_id = d.id and o.role = 'contribution' and not i.is_excluded order by i.id))
  from current_counts d cross join lateral private.takeoff_item_quantity_options(d.id) options
  where options -> 'available' = 'true'::jsonb
    and (options #>> '{verified,marks_revision}')::integer = d.marks_revision
    and (options ->> 'entry_revision')::integer is not distinct from d.chosen_entry_revision

$$;
revoke all on function private.takeoff_item_send_resolved_parts(uuid,uuid,uuid,integer[]) from public, anon, authenticated, service_role;


-- Lock proofs in answer order at rank 8. A copy and its source carry the
-- revision at which each part was read. An analysis can outlive several copies.
-- When the analysis is gone, its part's recorded proof remains self-contained.
create function private.takeoff_item_send_lock_proofs(p_tenant uuid, p_job uuid, p_version uuid, p_targets jsonb)
returns boolean language plpgsql set search_path = '' as $$
declare
  proof record;
  current_revision integer;
  valid boolean := true;
begin
  for proof in
    with needed(answer_id, earlier_revision) as (
      select a.id, null::integer from public.takeoff_item_answers a
      join public.takeoff_item_answer_decisions d on d.answer_id = a.id and d.quantity_source = 'verified_count'
      where a.tenant_id = p_tenant and a.job_id = p_job
      union all
      select part.answer_id, part.marks_revision from public.takeoff_item_send_parts part
      join public.takeoff_item_answers a on a.id = part.answer_id and a.tenant_id = part.tenant_id and a.project_id = part.project_id
      join public.takeoff_jobs current_job on current_job.id = p_job and current_job.project_id = part.project_id
        and current_job.tenant_id = part.tenant_id
      where part.tenant_id = p_tenant and part.version_id = p_version and part.state = 'live'
        and part.kind = 'verified_count' and exists (select 1 from jsonb_array_elements(p_targets) target
          where target ->> 'item_id' = part.item_id::text)
    )
    select answer_id, min(earlier_revision) as oldest, max(earlier_revision) as newest
    from needed group by answer_id order by answer_id
  loop
    current_revision := private.lock_takeoff_count_marks_revision(proof.answer_id);
    if proof.oldest is not null and (current_revision is distinct from proof.oldest
        or current_revision is distinct from proof.newest) then
      valid := false;
    end if;
  end loop;
  return valid;
end;
$$;
revoke all on function private.takeoff_item_send_lock_proofs(uuid,uuid,uuid,jsonb) from public, anon, authenticated, service_role;

-- A mark locates an object. Its page does not describe the coverage of the
-- reading. A whole replacement requires every page actually read and included.
create function private.takeoff_item_send_whole_plan(p_page_count integer, p_read integer[], p_covered integer[])
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_page_count > 0 and p_page_count = (
    select count(*) from (select unnest(p_read) intersect select unnest(p_covered)) inspected(page)
    where inspected.page between 1 and p_page_count), false)
$$;
revoke all on function private.takeoff_item_send_whole_plan(integer,integer[],integer[]) from public, anon, authenticated, service_role;

-- For two generations of the same item and logical plan. "page_rule" hands
-- ordinary observations and plan entries back to their existing replacement rule.
create function private.takeoff_item_send_count_scope(p_earlier_kind text, p_earlier_pages integer[],
  p_sending_count boolean, p_covered integer[], p_whole boolean)
returns text language sql immutable set search_path = '' as $$
  select case when p_earlier_kind = 'verified_count' then case when p_whole then 'replace' else 'refuse' end
    when p_sending_count and not (case when cardinality(p_earlier_pages) > 0 then coalesce(p_earlier_pages <@ p_covered,false) else coalesce(p_whole,false) end)
      then 'refuse'
    else 'page_rule' end
$$;
revoke all on function private.takeoff_item_send_count_scope(text,integer[],boolean,integer[],boolean)
  from public, anon, authenticated, service_role;


create or replace function public.review_takeoff_items(p_tenant_id uuid, p_project_id uuid, p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  gesture text;
  scope_plan uuid;
  digest text;
  receipt public.takeoff_item_review_commands%rowtype;
  this_command uuid := pg_catalog.gen_random_uuid();
  stale uuid[];
  applied jsonb;
  outcome jsonb;
  now_ timestamptz := pg_catalog.clock_timestamp();
  reason_text text;
  job record;
  threshold numeric;
  marked uuid;
  source_choice jsonb := p_command -> 'quantity_choice';
  chosen_source text := source_choice ->> 'source';
begin
  if actor is null or not coalesce(private.can_access_takeoff_scope(p_tenant_id, p_project_id, null, false), false)
    or not coalesce(private.takeoff_item_list_writer(p_tenant_id, p_project_id, actor), false) then
    raise exception 'TAKEOFF_ITEM_REVIEW_FORBIDDEN' using errcode = '42501';
  end if;

  -- The command's form, before anything is read under a lock.
  gesture := p_command ->> 'gesture';
  if pg_catalog.jsonb_typeof(p_command) is distinct from 'object'
    or p_command -> 'command_version' is distinct from '1'::jsonb
    or gesture is null or gesture not in ('accept_measured', 'set_aside', 'reinstate', 'enter_quantity', 'include_entry')
    or not private.takeoff_item_answer_is_uuid(p_command -> 'intent_key')
    or pg_catalog.jsonb_typeof(p_command -> 'scope') is distinct from 'object'
    or (p_command #>> '{scope,kind}') is null or (p_command #>> '{scope,kind}') not in ('affaire', 'plan')
    or ((p_command #>> '{scope,kind}') = 'plan') <> private.takeoff_item_answer_is_uuid(p_command #> '{scope,plan_logical_id}')
    or pg_catalog.jsonb_typeof(p_command -> 'targets') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_command -> 'targets') not between 1 and 1000
    or pg_catalog.jsonb_typeof(p_command -> 'apply') is distinct from 'array'
    or pg_catalog.jsonb_typeof(coalesce(p_command -> 'skipped', '[]'::jsonb)) is distinct from 'array'
    or pg_catalog.octet_length(p_command::text) > 4194304
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_command -> 'targets') t(value)
      where pg_catalog.jsonb_typeof(t.value) is distinct from 'object'
        or not private.takeoff_item_answer_is_uuid(t.value -> 'item_id')
        or not private.takeoff_item_answer_is_number(t.value -> 'entry_revision', 0, 2147483647, true)
        or pg_catalog.jsonb_typeof(t.value -> 'answers') is distinct from 'array'
        or pg_catalog.jsonb_array_length(t.value -> 'answers') > 1000
        or exists (select 1 from pg_catalog.jsonb_array_elements(t.value -> 'answers') a(value)
          where pg_catalog.jsonb_typeof(a.value) is distinct from 'object'
            or not private.takeoff_item_answer_is_uuid(a.value -> 'answer_id')
            or not private.takeoff_item_answer_is_number(a.value -> 'decision_revision', 0, 2147483647, true)
            or not private.takeoff_item_answer_is_number(a.value -> 'entry_revision', 0, 2147483647, true)
            -- The marks revision the selection saw (lot 5); absent, it is 0, as an answer without marks has.
            or (a.value ? 'marks_revision'
              and not private.takeoff_item_answer_is_number(a.value -> 'marks_revision', 0, 1000000, true))))
    or (select count(distinct t.value ->> 'item_id') from pg_catalog.jsonb_array_elements(p_command -> 'targets') t(value))
      <> pg_catalog.jsonb_array_length(p_command -> 'targets')
    or exists (select 1 from pg_catalog.jsonb_array_elements(p_command -> 'apply') x(value)
      where not private.takeoff_item_answer_is_uuid(x.value)
        or not exists (select 1 from pg_catalog.jsonb_array_elements(p_command -> 'targets') t(value)
          where t.value ->> 'item_id' = x.value #>> '{}'))
    or (source_choice is not null and (
      gesture <> 'accept_measured' or p_command #>> '{scope,kind}' <> 'plan'
      or pg_catalog.jsonb_array_length(p_command -> 'targets') <> 1
      or pg_catalog.jsonb_array_length(p_command -> 'apply') <> 1
      or (private.takeoff_item_send_keys(source_choice, array['source','alternative_quantity','verified_quantity'])
        and chosen_source in ('verified_count','entered','measured')) is not true))
    or (gesture = 'include_entry' and pg_catalog.jsonb_array_length(p_command -> 'targets') <> 1)
    or (gesture = 'set_aside' and (coalesce(p_command ->> 'reason', '') not in ('out_of_scope', 'duplicate', 'reading_error', 'other')
      or (p_command -> 'note' is not null and p_command -> 'note' <> 'null'::jsonb
        and not private.takeoff_item_answer_is_text(p_command -> 'note', null, 500))
      or (p_command ->> 'reason' = 'other' and pg_catalog.char_length(pg_catalog.btrim(coalesce(p_command ->> 'note', ''))) < 3)))
    or (gesture = 'enter_quantity' and (
      pg_catalog.jsonb_typeof(p_command -> 'values') is distinct from 'array'
      or coalesce(p_command #>> '{entry,category}', '') not in ('site_survey', 'other_drawing', 'dpgf_cctp',
        'written_confirmation', 'documented_calculation', 'hypothesis')
      or (p_command #> '{entry,note}' is not null and p_command #> '{entry,note}' <> 'null'::jsonb
        and not private.takeoff_item_answer_is_text(p_command #> '{entry,note}', null, 500))
      or (p_command #>> '{entry,category}' = 'hypothesis'
        and pg_catalog.char_length(pg_catalog.btrim(coalesce(p_command #>> '{entry,note}', ''))) not between 10 and 500)
      or exists (select 1 from pg_catalog.jsonb_array_elements(p_command -> 'values') v(value)
        where pg_catalog.jsonb_typeof(v.value) is distinct from 'object'
          or not private.takeoff_item_answer_is_uuid(v.value -> 'item_id')
          or not private.takeoff_item_answer_is_number(v.value -> 'quantity', 0, 999999999.999999, false, true)
          or not private.takeoff_item_answer_is_text(v.value -> 'unit', null, 16))
      -- One value per item of the selection (each one of its targets), and one for each item applied: the member's
      -- values are kept whole in the command (a replay compares them), only those of the items applied are written.
      or (select count(distinct v.value ->> 'item_id') from pg_catalog.jsonb_array_elements(p_command -> 'values') v(value))
        <> pg_catalog.jsonb_array_length(p_command -> 'values')
      or exists (select 1 from pg_catalog.jsonb_array_elements(p_command -> 'apply') x(value)
        where not exists (select 1 from pg_catalog.jsonb_array_elements(p_command -> 'values') v(value)
          where v.value ->> 'item_id' = x.value #>> '{}'))
      or exists (select 1 from pg_catalog.jsonb_array_elements(p_command -> 'values') v(value)
        where not exists (select 1 from pg_catalog.jsonb_array_elements(p_command -> 'targets') t(value)
          where v.value ->> 'item_id' = t.value ->> 'item_id')))) then
    raise exception 'TAKEOFF_ITEM_REVIEW_INVALID' using errcode = '22023';
  end if;
  scope_plan := case when p_command #>> '{scope,kind}' = 'plan' then (p_command #>> '{scope,plan_logical_id}')::uuid end;
  -- The member's command: what the server found eligible (apply, skipped) is decided again on a replay, never compared.
  digest := private.takeoff_sha256(p_command - 'apply' - 'skipped');

  -- The affaire's row, as the foreign keys of what this command writes take it, before any key; then one review command
  -- at a time in the affaire, then its receipt.
  perform 1 from public.estimate_projects p where p.id = p_project_id and p.tenant_id = p_tenant_id for key share;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-item-review:' || p_project_id::text, 0));
  select c.* into receipt from public.takeoff_item_review_commands c
  where c.tenant_id = p_tenant_id and c.project_id = p_project_id and c.intent_key = (p_command ->> 'intent_key')::uuid;
  if found then
    if receipt.actor_id is distinct from actor or receipt.command_sha256 is distinct from digest then
      raise exception 'TAKEOFF_ITEM_REVIEW_INTENT_CONFLICT' using errcode = '23505';
    end if;
    return receipt.outcome || '{"replayed": true}'::jsonb;
  end if;

  -- Its work tables are its own, made by this call: whatever a session holds under one of their names beforehand (any
  -- kind, any owner, any definition) is dropped unread, which fires none of its triggers, rules or defaults, or refuses
  -- the call (a view, a sequence, a table something depends on) before anything is written.
  drop table if exists pg_temp.takeoff_review_lines, pg_temp.takeoff_review_pairs, pg_temp.takeoff_review_rules_jobs,
    pg_temp.takeoff_review_written, pg_temp.takeoff_review_restored;
  create temporary table pg_temp.takeoff_review_lines (item_id uuid primary key, state text,
    scope_entry_id uuid, expected_unit text, reference_quantity numeric) on commit drop;
  create temporary table pg_temp.takeoff_review_pairs (item_id uuid, plan_logical_id uuid, answer_id uuid,
    outcome text, decision_kind text, decision_effective text, decision_revision integer, plan_entry_id uuid,
    plan_entry_revision integer, job_id uuid, sent boolean, reason_code text) on commit drop;
  create temporary table pg_temp.takeoff_review_rules_jobs (job_id uuid primary key) on commit drop;

  -- The targets as they are, read twice for a gesture that writes positive rows: once to know the jobs whose rules keys
  -- it takes (in the job's order, as a member's save of a row takes them: every version's key before every job's two
  -- keys, each in identifier order), then again once those keys are held, so that what is compared and judged below is
  -- what is committed now. A row a targeted review changed meanwhile is judged as it was committed, an answer a new
  -- reading replaced meanwhile is no longer current.
  for pass in 1 .. 2 loop
    truncate pg_temp.takeoff_review_lines, pg_temp.takeoff_review_pairs;
    insert into pg_temp.takeoff_review_lines
    select l.item_id, l.state, l.scope_entry_id, l.expected_unit, l.reference_quantity
    from private.takeoff_item_table_lines(p_tenant_id, p_project_id, scope_plan) l
    where l.item_id in (select (t.value ->> 'item_id')::uuid from pg_catalog.jsonb_array_elements(p_command -> 'targets') t(value));
    insert into pg_temp.takeoff_review_pairs
    select p.item_id, p.plan_logical_id, p.answer_id, p.outcome, p.decision_kind, p.decision_effective, p.decision_revision,
      p.plan_entry_id, coalesce(pe.revision, 0), p.answer_job_id, p.sent, a.reason_code
    from private.takeoff_item_table_pairs(p_tenant_id, p_project_id, scope_plan) p
    left join public.takeoff_item_answers a on a.id = p.answer_id
    left join public.takeoff_item_entries pe on pe.id = p.plan_entry_id
    where p.answer_id is not null
      and p.item_id in (select (t.value ->> 'item_id')::uuid from pg_catalog.jsonb_array_elements(p_command -> 'targets') t(value));
    exit when pass = 2 or gesture not in ('accept_measured', 'set_aside', 'reinstate');
    for job in
      select x.id, x.estimate_version_id from (
        select distinct j.id, j.estimate_version_id from pg_temp.takeoff_review_pairs p
        join public.takeoff_jobs j on j.id = p.job_id and j.tenant_id = p_tenant_id
        where p.item_id in (select (v.value #>> '{}')::uuid from pg_catalog.jsonb_array_elements(p_command -> 'apply') v(value))
          and j.status = 'completed'
      ) x
      order by x.estimate_version_id is null, x.estimate_version_id, x.id
    loop
      if job.estimate_version_id is null then
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-job-rules:' || job.id::text, 0));
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-job:' || job.id::text, 0));
      else
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-rules:' || job.estimate_version_id::text, 0));
      end if;
    end loop;
  end loop;

  -- An acceptance certifies its answers' marks as the selection saw them (lot 5): their marks states are locked once the
  -- rules keys are held and before any row is verified (for share, in identifier order; an edit of those marks waits for
  -- this command, or this command for the edit and then reads its revision), and compared below.
  if gesture in ('accept_measured', 'reinstate') then
    for marked in select distinct p.answer_id from pg_temp.takeoff_review_pairs p order by p.answer_id loop
      perform private.lock_takeoff_count_marks_revision(marked);
    end loop;
  end if;

  -- Compare-and-set: each item read as it is now (its current answers in the scope, their decisions' revisions, the
  -- revision of the plan's entry that stands for each in the affaire's scope, the scope's entry's revision): every
  -- entry that enters the total is the one the selection saw. For an acceptance, each answer's marks revision too.
  select pg_catalog.array_agg(t.item_id order by t.item_id) into stale
  from (select (t.value ->> 'item_id')::uuid as item_id, (t.value ->> 'entry_revision')::numeric::integer as entry_revision,
      t.value -> 'answers' as answers
    from pg_catalog.jsonb_array_elements(p_command -> 'targets') t(value)) t
  left join pg_temp.takeoff_review_lines l on l.item_id = t.item_id
  where l.item_id is null
    or coalesce((select e.revision from public.takeoff_item_entries e where e.id = l.scope_entry_id), 0) <> t.entry_revision
    or (select coalesce(pg_catalog.array_agg(p.answer_id::text || '#' || p.decision_revision || '#' || p.plan_entry_revision
          order by p.answer_id), '{}')
        from pg_temp.takeoff_review_pairs p where p.item_id = t.item_id)
      is distinct from
      (select coalesce(pg_catalog.array_agg((a.value ->> 'answer_id')::uuid::text
          || '#' || ((a.value ->> 'decision_revision')::numeric::integer)::text
          || '#' || ((a.value ->> 'entry_revision')::numeric::integer)::text
          order by (a.value ->> 'answer_id')::uuid), '{}')
        from pg_catalog.jsonb_array_elements(t.answers) a(value))
    or (gesture = 'accept_measured' and exists (select 1 from pg_catalog.jsonb_array_elements(t.answers) a(value)
      where coalesce((a.value ->> 'marks_revision')::numeric::integer, 0)
        <> private.takeoff_count_marks_revision((a.value ->> 'answer_id')::uuid)));

  -- The displayed alternative and the verified count are compared after acquiring the
  -- marks locks. A choice concerns one plan and one item, never a bulk default.
  if gesture = 'accept_measured' and stale is null then
    select pg_catalog.array_agg(distinct p.item_id order by p.item_id) into stale
    from pg_temp.takeoff_review_pairs p
    left join lateral private.takeoff_item_quantity_options(p.answer_id) opts on true
    where p.item_id in (select (v.value #>> '{}')::uuid from pg_catalog.jsonb_array_elements(p_command -> 'apply') v(value))
      and case when source_choice is null then opts -> 'available' = 'true'::jsonb
        and (opts ->> 'alternative_source' = 'entered'
          or opts -> 'alternative_quantity' is distinct from opts #> '{verified,quantity}')
      else (opts -> 'available' = 'true'::jsonb and source_choice -> 'verified_quantity' = coalesce(opts #> '{verified,quantity}','null'::jsonb)
        and source_choice -> 'alternative_quantity' = opts -> 'alternative_quantity'
        and (opts ->> 'alternative_source' = 'entered'
          or opts -> 'alternative_quantity' is distinct from opts #> '{verified,quantity}')
        and ((chosen_source = 'verified_count' and opts #>> '{verified,quantity}' is not null) or (chosen_source = opts ->> 'alternative_source'
          and opts ->> 'alternative_quantity' is not null))) is not true end;
  end if;

  -- The rules of each gesture on the items the server found eligible, now, under the locks: what no longer holds makes
  -- the selection stale. A plan already sent to an estimate is closed to every gesture, its entries included: what
  -- changes after a send goes through a revision of the send's contribution, never through this command. An
  -- acceptance: a measured item (its answer on the plan in a plan's scope), without the scope's entry, an answer still
  -- to decide, every positive row of its answers to decide without an anomaly the planner names (the tenant's
  -- confidence threshold included), and the total it would retain (private.takeoff_item_total: those rows as they are,
  -- the plans' included entries) in one unit, within 1 % of its DPGF reference. Never a forcing.
  if stale is null then
    if gesture = 'accept_measured' then
      threshold := public.takeoff_low_confidence_threshold((select ff.value from public.feature_flags ff
        where ff.tenant_id = p_tenant_id and ff.flag_key = 'TAKEOFF_LOW_CONFIDENCE_THRESHOLD' and ff.enabled limit 1));
    end if;
    select pg_catalog.array_agg(x.item_id order by x.item_id) into stale
    from (select (v.value #>> '{}')::uuid as item_id from pg_catalog.jsonb_array_elements(p_command -> 'apply') v(value)) x
    join pg_temp.takeoff_review_lines l on l.item_id = x.item_id
    where exists (select 1 from pg_temp.takeoff_review_pairs p where p.item_id = x.item_id and p.sent)
      or case gesture
      when 'accept_measured' then not (
        ((l.state = 'measured' and l.scope_entry_id is null)
          or (source_choice is not null and l.state in ('not_found','uncertain','measured')
            and (chosen_source = 'verified_count' or l.scope_entry_id is not null)))
        and (chosen_source is distinct from 'verified_count' or l.reference_quantity is null or l.reference_quantity < 0
          or not private.takeoff_quantity_requires_review(l.reference_quantity, (source_choice ->> 'verified_quantity')::numeric))
        and exists (select 1 from pg_temp.takeoff_review_pairs p where p.item_id = x.item_id
          and (p.decision_effective = 'none' or (source_choice is not null and p.decision_effective = 'accepted')) and (source_choice is not null or p.plan_entry_id is null))
        and not exists (select 1 from pg_temp.takeoff_review_pairs p
          join public.takeoff_item_answer_observations o on o.answer_id = p.answer_id and o.role = 'contribution'
          left join public.takeoff_items i on i.id = o.takeoff_item_id and i.tenant_id = p_tenant_id
          where p.item_id = x.item_id and p.outcome = 'measured' and
            (source_choice is not null or (p.decision_effective = 'none' and p.plan_entry_id is null))
            and pg_catalog.cardinality(private.takeoff_item_row_anomalies(p.outcome, p.reason_code, i.id is not null,
              i.is_excluded, i.rules_stale, i.rule_results, i.confidence, threshold, i.evidence, i.source_page, i.metadata,
              i.quantity_entry_category, i.unit, l.expected_unit)) > 0)
        and (select pg_catalog.count(distinct private.takeoff_unit_token(q.unit)) <= 1
            and (chosen_source is not distinct from 'verified_count' or l.reference_quantity is null or l.reference_quantity < 0 or pg_catalog.count(*) = 0
              or not private.takeoff_quantity_requires_review(l.reference_quantity,
                private.takeoff_item_total(pg_catalog.array_agg(q.quantity))))
          from (
            select e.quantity, e.unit from pg_temp.takeoff_review_pairs p
            join public.takeoff_item_entries e on e.id = p.plan_entry_id
            where p.item_id = x.item_id and p.decision_effective <> 'set_aside' and e.included
            union all
            select i.quantity, i.unit from pg_temp.takeoff_review_pairs p
            join public.takeoff_item_answer_observations o on o.answer_id = p.answer_id and o.role = 'contribution'
            join public.takeoff_items i on i.id = o.takeoff_item_id and i.tenant_id = p_tenant_id
            where p.item_id = x.item_id and p.decision_effective <> 'set_aside' and p.plan_entry_id is null
              and p.outcome = 'measured' and not i.is_excluded
          ) q))
      when 'set_aside' then not exists (select 1 from pg_temp.takeoff_review_pairs p where p.item_id = x.item_id
        and p.decision_effective <> 'set_aside')
      when 'reinstate' then not exists (select 1 from pg_temp.takeoff_review_pairs p where p.item_id = x.item_id
        and p.decision_kind = 'set_aside')
      when 'enter_quantity' then l.state not in ('not_found', 'uncertain')
      when 'include_entry' then not exists (select 1 from public.takeoff_item_entries e where e.id = l.scope_entry_id
        and e.category = 'hypothesis' and not e.included)
    end;
  end if;
  if stale is not null then
    return pg_catalog.jsonb_build_object('outcome', 'stale', 'stale', pg_catalog.to_jsonb(stale));
  end if;

  create temporary table pg_temp.takeoff_review_written (item_id uuid, answer_id uuid) on commit drop;

  if gesture = 'accept_measured' then
    insert into pg_temp.takeoff_review_written
    select p.item_id, p.answer_id from pg_temp.takeoff_review_pairs p
    where p.item_id in (select (v.value #>> '{}')::uuid from pg_catalog.jsonb_array_elements(p_command -> 'apply') v(value))
      and (p.decision_effective = 'none' or (source_choice is not null and p.decision_effective = 'accepted'))
      and (source_choice is not null or p.plan_entry_id is null);
    -- The positive rows of the measured answers accepted, verified in the member's name as they now are (a job still
    -- completed).
    with rows_ as (
      select i.id, i.is_verified, p.item_id, p.answer_id, p.plan_logical_id from pg_temp.takeoff_review_pairs p
      join pg_temp.takeoff_review_written w on w.answer_id = p.answer_id
      join public.takeoff_item_answer_observations o on o.answer_id = p.answer_id and o.role = 'contribution'
      join public.takeoff_items i on i.id = o.takeoff_item_id
      join public.takeoff_jobs j on j.id = i.job_id and j.tenant_id = i.tenant_id and j.status = 'completed'
      where p.outcome = 'measured' and not i.is_verified
    ), updated as (
      update public.takeoff_items i set is_verified = true, verified_at = now_, verified_by = actor,
        verification_justification = null, updated_at = now_
      from rows_ r where i.id = r.id
      returning i.id
    )
    insert into public.takeoff_item_review_events (tenant_id, project_id, command_id, item_id, answer_id, plan_logical_id,
      takeoff_item_id, event, before, after, actor_id, at)
    select p_tenant_id, p_project_id, this_command, r.item_id, r.answer_id, r.plan_logical_id, r.id, 'row_verified',
      pg_catalog.jsonb_build_object('is_verified', false), pg_catalog.jsonb_build_object('is_verified', true), actor, now_
    from rows_ r join updated u on u.id = r.id;
    -- The marks revision of each answer accepted, locked above and compared with the selection's (lot 5); one committed
    -- later makes the acceptance a decision to take again (private.takeoff_item_decision_effective).
    insert into public.takeoff_item_answer_decisions as d (answer_id, tenant_id, project_id, item_id, plan_logical_id, kind,
      reason, note, revision, actor_id, decided_at, command_id, marks_revision, quantity_source, chosen_entry_revision)
    select w.answer_id, p_tenant_id, p_project_id, w.item_id, p.plan_logical_id, 'accepted', null, null,
      p.decision_revision + 1, actor, now_, this_command, private.takeoff_count_marks_revision(w.answer_id), chosen_source,
      case when chosen_source is not null then (select e.revision from public.takeoff_item_entries e
        where e.item_id = w.item_id and e.plan_logical_id = scope_plan) end
    from pg_temp.takeoff_review_written w join pg_temp.takeoff_review_pairs p on p.answer_id = w.answer_id
    on conflict (answer_id) do update set kind = excluded.kind, reason = null, note = null, revision = excluded.revision,
      actor_id = excluded.actor_id, decided_at = excluded.decided_at, command_id = excluded.command_id,
      marks_revision = excluded.marks_revision, quantity_source = excluded.quantity_source, chosen_entry_revision = excluded.chosen_entry_revision;
    insert into public.takeoff_item_review_events (tenant_id, project_id, command_id, item_id, answer_id, plan_logical_id,
      event, before, after, actor_id, at)
    select p_tenant_id, p_project_id, this_command, w.item_id, w.answer_id, p.plan_logical_id, 'accepted',
      pg_catalog.jsonb_build_object('kind', p.decision_effective), pg_catalog.jsonb_build_object('kind', 'accepted')
        || case when source_choice is null then '{}'::jsonb else pg_catalog.jsonb_build_object(
          'quantity_choice', source_choice, 'marks_revision', private.takeoff_count_marks_revision(w.answer_id),
          'entry_revision', (select d.chosen_entry_revision from public.takeoff_item_answer_decisions d where d.answer_id = w.answer_id),
          'answer_revision', (select a.content_sha256 from public.takeoff_item_answers a where a.id = w.answer_id)) end, actor, now_
    from pg_temp.takeoff_review_written w join pg_temp.takeoff_review_pairs p on p.answer_id = w.answer_id;

  elsif gesture = 'set_aside' then
    reason_text := pg_catalog.left('Écarté dans le tableau des postes : ' || case p_command ->> 'reason'
        when 'out_of_scope' then 'hors périmètre' when 'duplicate' then 'doublon' when 'reading_error' then 'erreur de lecture'
        else 'autre' end
      || coalesce(' — ' || nullif(pg_catalog.btrim(p_command ->> 'note'), ''), ''), 500);
    insert into pg_temp.takeoff_review_written
    select p.item_id, p.answer_id from pg_temp.takeoff_review_pairs p
    where p.item_id in (select (v.value #>> '{}')::uuid from pg_catalog.jsonb_array_elements(p_command -> 'apply') v(value))
      and p.decision_kind is distinct from 'set_aside';
    -- The positive rows of the answers set aside, excluded with the reason (a job still completed). What each row was
    -- (its exclusion and its verification: by whom, when, why) is journaled, so that a reinstatement gives it back. A
    -- verification is withdrawn with it, and the rules that read the exclusion wait for the server, as a member's edit
    -- does. A row already excluded with that reason is left as it is.
    with rows_ as (
      select i.id, i.job_id, i.is_excluded, i.exclusion_reason, i.is_verified, i.verified_at, i.verified_by,
        i.verification_justification, p.item_id, p.answer_id, p.plan_logical_id
      from pg_temp.takeoff_review_written w
      join pg_temp.takeoff_review_pairs p on p.answer_id = w.answer_id
      join public.takeoff_item_answer_observations o on o.answer_id = p.answer_id and o.role = 'contribution'
      join public.takeoff_items i on i.id = o.takeoff_item_id
      join public.takeoff_jobs j on j.id = i.job_id and j.tenant_id = i.tenant_id and j.status = 'completed'
      where not (i.is_excluded and i.exclusion_reason is not distinct from reason_text)
    ), updated as (
      update public.takeoff_items i set is_excluded = true, exclusion_reason = reason_text, is_verified = false,
        verified_at = null, verified_by = null, verification_justification = null, updated_at = now_,
        rules_stale = case when i.rules_evaluated_at is not null or i.rules_stale then true else i.rules_stale end,
        rules_stale_at = case when i.rules_evaluated_at is not null or i.rules_stale then now_ else i.rules_stale_at end
      from rows_ r where i.id = r.id
      returning i.id
    ), journaled as (
      insert into public.takeoff_item_review_events (tenant_id, project_id, command_id, item_id, answer_id, plan_logical_id,
        takeoff_item_id, event, before, after, actor_id, at)
      select p_tenant_id, p_project_id, this_command, r.item_id, r.answer_id, r.plan_logical_id, r.id, 'row_excluded',
        pg_catalog.jsonb_build_object('is_excluded', r.is_excluded, 'exclusion_reason', r.exclusion_reason,
          'is_verified', r.is_verified, 'verified_at', r.verified_at, 'verified_by', r.verified_by,
          'verification_justification', r.verification_justification),
        pg_catalog.jsonb_build_object('is_excluded', true, 'exclusion_reason', reason_text), actor, now_
      from rows_ r join updated u on u.id = r.id
      returning takeoff_item_id
    )
    insert into pg_temp.takeoff_review_rules_jobs
    select distinct r.job_id from rows_ r join journaled e on e.takeoff_item_id = r.id
    on conflict do nothing;
    -- The answer's decision before, and every positive row of the answer as the set aside leaves it, changed by it or
    -- not (one already excluded with the reason included): what a reinstatement compares to say nothing changed.
    insert into public.takeoff_item_review_events (tenant_id, project_id, command_id, item_id, answer_id, plan_logical_id,
      event, before, after, actor_id, at)
    select p_tenant_id, p_project_id, this_command, w.item_id, w.answer_id, p.plan_logical_id, 'set_aside',
      pg_catalog.jsonb_build_object('kind', p.decision_effective, 'actor_id', case when p.decision_effective <> 'none' then d.actor_id end,
        'decided_at', case when p.decision_effective <> 'none' then d.decided_at end)
        -- The marks revision an acceptance set aside was taken on, given back with it by a reinstatement.
        || case when p.decision_effective = 'accepted' and coalesce(d.marks_revision, 0) > 0
          then pg_catalog.jsonb_build_object('marks_revision', d.marks_revision) else '{}'::jsonb end
        || case when p.decision_effective = 'accepted' and d.quantity_source is not null
          then pg_catalog.jsonb_build_object('quantity_source', d.quantity_source, 'chosen_entry_revision', d.chosen_entry_revision)
          else '{}'::jsonb end,
      pg_catalog.jsonb_build_object('kind', 'set_aside', 'reason', p_command ->> 'reason',
        'note', nullif(pg_catalog.btrim(p_command ->> 'note'), ''),
        'rows', coalesce((select pg_catalog.jsonb_object_agg(i.id::text, private.takeoff_item_review_row_state(i))
          from public.takeoff_item_answer_observations o join public.takeoff_items i on i.id = o.takeoff_item_id
          where o.answer_id = w.answer_id and o.role = 'contribution'), '{}'::jsonb)), actor, now_
    from pg_temp.takeoff_review_written w join pg_temp.takeoff_review_pairs p on p.answer_id = w.answer_id
    left join public.takeoff_item_answer_decisions d on d.answer_id = w.answer_id;
    insert into public.takeoff_item_answer_decisions as d (answer_id, tenant_id, project_id, item_id, plan_logical_id, kind,
      reason, note, revision, actor_id, decided_at, command_id)
    select w.answer_id, p_tenant_id, p_project_id, w.item_id, p.plan_logical_id, 'set_aside', p_command ->> 'reason',
      nullif(pg_catalog.btrim(p_command ->> 'note'), ''), p.decision_revision + 1, actor, now_, this_command
    from pg_temp.takeoff_review_written w join pg_temp.takeoff_review_pairs p on p.answer_id = w.answer_id
    on conflict (answer_id) do update set kind = excluded.kind, reason = excluded.reason, note = excluded.note,
      revision = excluded.revision, actor_id = excluded.actor_id, decided_at = excluded.decided_at,
      command_id = excluded.command_id, marks_revision = null, quantity_source = null, chosen_entry_revision = null;

  elsif gesture = 'reinstate' then
    insert into pg_temp.takeoff_review_written
    select p.item_id, p.answer_id from pg_temp.takeoff_review_pairs p
    where p.item_id in (select (v.value #>> '{}')::uuid from pg_catalog.jsonb_array_elements(p_command -> 'apply') v(value))
      and p.decision_kind = 'set_aside';
    -- Each answer's latest set aside, the decision it replaced, and the rows it excluded with what each was. An answer
    -- every positive row of which holds what the set aside left (none changed since, those it did not change included)
    -- comes back whole: each row as it was, its verification included, and the decision it had. Otherwise each row still
    -- excluded with the set aside's reason gets its exclusion back without its verification, and the answer comes back to
    -- be decided; the journal says which.
    create temporary table pg_temp.takeoff_review_restored (answer_id uuid primary key, item_id uuid,
      plan_logical_id uuid, whole boolean, previous jsonb) on commit drop;
    insert into pg_temp.takeoff_review_restored
    select w.answer_id, w.item_id, p.plan_logical_id,
      -- Restore an explicit source choice only with its original proof.
      -- An ordinary acceptance keeps its historical revision; the table
      -- already reopens it when the marks have moved.
      (aside.before ->> 'quantity_source' is null or (
        coalesce((aside.before ->> 'marks_revision')::integer, 0) = private.takeoff_count_marks_revision(p.answer_id)
        and (aside.before ->> 'chosen_entry_revision')::integer is not distinct from nullif(p.plan_entry_revision, 0)))
      and pg_catalog.jsonb_typeof(aside.after -> 'rows') = 'object' and not exists (
        select 1 from pg_catalog.jsonb_each(aside.after -> 'rows') snapshot(row_id, state)
        left join public.takeoff_items i on i.id = snapshot.row_id::uuid
        where i.id is null or private.takeoff_item_review_row_state(i) is distinct from snapshot.state),
      aside.before
    from pg_temp.takeoff_review_written w
    join pg_temp.takeoff_review_pairs p on p.answer_id = w.answer_id
    left join lateral (
      select ev.command_id, ev.before, ev.after from public.takeoff_item_review_events ev
      where ev.tenant_id = p_tenant_id and ev.project_id = p_project_id and ev.answer_id = w.answer_id and ev.event = 'set_aside'
      order by ev.id desc limit 1
    ) aside on true;
    with excluded_ as (
      select ev.takeoff_item_id, ev.before, ev.after, r.item_id, r.answer_id, r.plan_logical_id, r.whole
      from pg_temp.takeoff_review_restored r
      join lateral (select e.command_id from public.takeoff_item_review_events e
        where e.answer_id = r.answer_id and e.event = 'set_aside' order by e.id desc limit 1) aside on true
      join public.takeoff_item_review_events ev on ev.command_id = aside.command_id and ev.answer_id = r.answer_id
        and ev.event = 'row_excluded'
    ), rows_ as (
      select x.*, i.id, i.job_id from excluded_ x
      join public.takeoff_items i on i.id = x.takeoff_item_id and i.is_excluded
        and i.exclusion_reason is not distinct from (x.after ->> 'exclusion_reason')
      join public.takeoff_jobs j on j.id = i.job_id and j.tenant_id = i.tenant_id and j.status = 'completed'
    ), updated as (
      update public.takeoff_items i set is_excluded = coalesce((r.before ->> 'is_excluded')::boolean, false),
        exclusion_reason = case when coalesce((r.before ->> 'is_excluded')::boolean, false) then r.before ->> 'exclusion_reason' end,
        is_verified = r.whole and coalesce((r.before ->> 'is_verified')::boolean, false),
        verified_at = case when r.whole and coalesce((r.before ->> 'is_verified')::boolean, false)
          then (r.before ->> 'verified_at')::timestamptz end,
        verified_by = case when r.whole and coalesce((r.before ->> 'is_verified')::boolean, false)
          then (r.before ->> 'verified_by')::uuid end,
        verification_justification = case when r.whole and coalesce((r.before ->> 'is_verified')::boolean, false)
          then nullif(r.before -> 'verification_justification', 'null'::jsonb) end,
        updated_at = now_,
        rules_stale = case when i.rules_evaluated_at is not null or i.rules_stale then true else i.rules_stale end,
        rules_stale_at = case when i.rules_evaluated_at is not null or i.rules_stale then now_ else i.rules_stale_at end
      from rows_ r where i.id = r.id
      returning i.id, i.is_excluded, i.exclusion_reason, i.is_verified, i.verified_at, i.verified_by
    ), journaled as (
      insert into public.takeoff_item_review_events (tenant_id, project_id, command_id, item_id, answer_id, plan_logical_id,
        takeoff_item_id, event, before, after, actor_id, at)
      select p_tenant_id, p_project_id, this_command, r.item_id, r.answer_id, r.plan_logical_id, r.id, 'row_restored',
        r.after, pg_catalog.jsonb_build_object('is_excluded', u.is_excluded, 'exclusion_reason', u.exclusion_reason,
          'is_verified', u.is_verified, 'verified_at', u.verified_at, 'verified_by', u.verified_by), actor, now_
      from rows_ r join updated u on u.id = r.id
      returning takeoff_item_id
    )
    insert into pg_temp.takeoff_review_rules_jobs
    select distinct r.job_id from rows_ r join journaled e on e.takeoff_item_id = r.id
    on conflict do nothing;
    update public.takeoff_item_answer_decisions d set
      kind = case when r.whole and r.previous ->> 'kind' = 'accepted' then 'accepted' else 'none' end,
      reason = null, note = null, revision = d.revision + 1,
      actor_id = case when r.whole and r.previous ->> 'kind' = 'accepted' then (r.previous ->> 'actor_id')::uuid else actor end,
      decided_at = case when r.whole and r.previous ->> 'kind' = 'accepted' then (r.previous ->> 'decided_at')::timestamptz
        else now_ end,
      command_id = this_command,
      -- An acceptance given back is bound to the marks it was taken on: changed since, it is a decision to take again.
      marks_revision = case when r.whole and r.previous ->> 'kind' = 'accepted'
        then (r.previous ->> 'marks_revision')::integer end,
      quantity_source = case when r.whole and r.previous ->> 'kind' = 'accepted' then r.previous ->> 'quantity_source' end,
      chosen_entry_revision = case when r.whole and r.previous ->> 'kind' = 'accepted'
        then (r.previous ->> 'chosen_entry_revision')::integer end
    from pg_temp.takeoff_review_restored r where d.answer_id = r.answer_id;
    insert into public.takeoff_item_review_events (tenant_id, project_id, command_id, item_id, answer_id, plan_logical_id,
      event, before, after, actor_id, at)
    select p_tenant_id, p_project_id, this_command, r.item_id, r.answer_id, r.plan_logical_id, 'reinstated',
      pg_catalog.jsonb_build_object('kind', 'set_aside'),
      pg_catalog.jsonb_build_object('kind', case when r.whole and r.previous ->> 'kind' = 'accepted' then 'accepted' else 'none' end,
        'restored', case when r.whole then 'whole' else 'changed' end), actor, now_
    from pg_temp.takeoff_review_restored r;

  elsif gesture = 'enter_quantity' then
    with values_ as (
      select (v.value ->> 'item_id')::uuid as item_id, (v.value ->> 'quantity')::numeric as quantity,
        pg_catalog.btrim(v.value ->> 'unit') as unit
      from pg_catalog.jsonb_array_elements(p_command -> 'values') v(value)
      where (v.value ->> 'item_id')::uuid in (select (x.value #>> '{}')::uuid
        from pg_catalog.jsonb_array_elements(p_command -> 'apply') x(value))
    ), previous as (
      select v.*, e.id as entry_id, e.quantity as old_quantity, e.unit as old_unit, e.category as old_category,
        e.note as old_note, e.included as old_included, coalesce(e.revision, 0) as old_revision
      from values_ v
      left join public.takeoff_item_entries e on e.tenant_id = p_tenant_id and e.project_id = p_project_id
        and e.item_id = v.item_id and e.plan_logical_id is not distinct from scope_plan
    ), written as (
      insert into public.takeoff_item_entries as e (tenant_id, project_id, item_id, plan_logical_id, quantity, unit, category,
        note, included, revision, previous_quantity, previous_unit, actor_id, entered_at, command_id)
      select p_tenant_id, p_project_id, p.item_id, scope_plan, p.quantity, p.unit, p_command #>> '{entry,category}',
        nullif(pg_catalog.btrim(p_command #>> '{entry,note}'), ''), (p_command #>> '{entry,category}') <> 'hypothesis',
        p.old_revision + 1, p.old_quantity, p.old_unit, actor, now_, this_command
      from previous p
      on conflict (tenant_id, project_id, item_id, plan_logical_id) do update set quantity = excluded.quantity,
        unit = excluded.unit, category = excluded.category, note = excluded.note, included = excluded.included,
        revision = excluded.revision, previous_quantity = excluded.previous_quantity, previous_unit = excluded.previous_unit,
        actor_id = excluded.actor_id, entered_at = excluded.entered_at, command_id = excluded.command_id
      returning e.item_id
    )
    insert into public.takeoff_item_review_events (tenant_id, project_id, command_id, item_id, plan_logical_id, event,
      before, after, actor_id, at)
    select p_tenant_id, p_project_id, this_command, p.item_id, scope_plan, 'entered',
      case when p.entry_id is null then null else pg_catalog.jsonb_build_object('quantity', p.old_quantity, 'unit', p.old_unit,
        'category', p.old_category, 'note', p.old_note, 'included', p.old_included) end,
      pg_catalog.jsonb_build_object('quantity', p.quantity, 'unit', p.unit, 'category', p_command #>> '{entry,category}',
        'note', nullif(pg_catalog.btrim(p_command #>> '{entry,note}'), ''),
        'included', (p_command #>> '{entry,category}') <> 'hypothesis'), actor, now_
    from previous p join written w on w.item_id = p.item_id;
    insert into pg_temp.takeoff_review_written
    select (v.value #>> '{}')::uuid, null from pg_catalog.jsonb_array_elements(p_command -> 'apply') v(value);

  else -- include_entry
    with entry_ as (
      -- The entry keeps its author and its time; the inclusion is journaled as the includer's own decision.
      update public.takeoff_item_entries e set included = true, revision = e.revision + 1,
        command_id = this_command
      from pg_temp.takeoff_review_lines l
      where e.id = l.scope_entry_id
        and l.item_id in (select (v.value #>> '{}')::uuid from pg_catalog.jsonb_array_elements(p_command -> 'apply') v(value))
      returning e.item_id, e.plan_logical_id
    )
    insert into public.takeoff_item_review_events (tenant_id, project_id, command_id, item_id, plan_logical_id, event,
      before, after, actor_id, at)
    select p_tenant_id, p_project_id, this_command, x.item_id, x.plan_logical_id, 'entry_included',
      '{"included": false}'::jsonb, '{"included": true}'::jsonb, actor, now_
    from entry_ x;
    insert into pg_temp.takeoff_review_written
    select (v.value #>> '{}')::uuid, null from pg_catalog.jsonb_array_elements(p_command -> 'apply') v(value);
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('item_id', w.item_id, 'answers', w.answers)
      order by w.item_id), '[]'::jsonb)
    into applied
  from (select item_id, (count(answer_id))::integer as answers from pg_temp.takeoff_review_written group by item_id) w;
  -- The jobs whose positive rows this command excluded or gave back: the server computes their rules again after the
  -- commit, and again on a replay, so that a refresh a stopped server owed is finished without deciding anything twice.
  outcome := pg_catalog.jsonb_build_object('outcome', 'applied', 'applied', applied,
    'skipped', coalesce(p_command -> 'skipped', '[]'::jsonb),
    'rules_jobs', coalesce((select pg_catalog.jsonb_agg(r.job_id order by r.job_id) from pg_temp.takeoff_review_rules_jobs r),
      '[]'::jsonb));
  insert into public.takeoff_item_review_commands (id, tenant_id, project_id, intent_key, actor_id, gesture, command_sha256,
    outcome)
  values (this_command, p_tenant_id, p_project_id, (p_command ->> 'intent_key')::uuid, actor, gesture, digest, outcome);
  return outcome || '{"replayed": false}'::jsonb;
end;
$$;

create or replace function private.takeoff_item_table_lines(p_tenant_id uuid, p_project_id uuid, p_plan_logical_id uuid)
returns table (item_id uuid, item_position integer, label text, expected_unit text, sections jsonb,
  reference_quantity numeric, origin_kind text, dpgf_reference text, family text, state text, expected integer,
  answered integer, in_flight integer, ended integer, decision text, scope_entry_id uuid)
language sql stable security definer set search_path = '' as $$
  with latest as (
    select r.id from public.takeoff_list_revisions r where r.tenant_id = p_tenant_id and r.project_id = p_project_id
    order by r.revision desc limit 1
  ), pairs as materialized (
    select p.*,
      d.answer_id is not null as chose_count,
      case when d.answer_id is not null and d.chosen_entry_revision is distinct from pe.revision then 'none'
        else p.decision_effective end as quantity_decision
    from private.takeoff_item_table_pairs(p_tenant_id, p_project_id, p_plan_logical_id) p
    left join public.takeoff_item_answer_decisions d on d.answer_id = p.answer_id
      and d.kind = 'accepted' and d.quantity_source = 'verified_count'
    left join public.takeoff_item_entries pe on d.answer_id is not null and pe.tenant_id = p_tenant_id
      and pe.project_id = p_project_id and pe.item_id = p.item_id and pe.plan_logical_id = p.plan_logical_id
  ), decided as (
    select p.item_id, count(*)::integer as answers,
      (count(*) filter (where p.quantity_decision = 'none' and (p.plan_entry_id is null or p.chose_count)))::integer as undecided,
      (count(*) filter (where p.decision_effective = 'set_aside'))::integer as set_aside,
      (count(*) filter (where p.plan_entry_id is not null and not p.chose_count and p.decision_effective <> 'set_aside'))::integer as plan_entries,
      bool_or(p.chose_count) as has_chosen_count
    from pairs p where p.answer_id is not null group by p.item_id
  )
  select e.item_id, e.position, e.label, e.expected_unit, e.sections, e.reference_quantity, e.origin_kind,
    case when e.origin_kind = 'dpgf' then e.origin ->> 'reference' end,
    (select pg_catalog.string_agg(s.value ->> 'title', ' / ' order by s.ordinality)
      from pg_catalog.jsonb_array_elements(e.sections) with ordinality s(value, ordinality)),
    st.state, st.expected, st.answered, st.in_flight, st.ended,
    private.takeoff_item_line_decision(coalesce(d.answers, 0), coalesce(d.undecided, 0), coalesce(d.set_aside, 0),
      coalesce(d.plan_entries, 0),
      (se.id is not null and (p_plan_logical_id is null or not coalesce(d.has_chosen_count,false)))
      or (p_plan_logical_id is not null and exists (select 1 from public.takeoff_item_entries whole
        where whole.tenant_id = p_tenant_id and whole.project_id = p_project_id
          and whole.item_id = e.item_id and whole.plan_logical_id is null
          and (d.has_chosen_count or exists (select 1 from pairs p where p.item_id = e.item_id
            and private.takeoff_count_marks_revision(p.answer_id) > 0))))),
    se.id
  from public.takeoff_list_revision_entries e
  join latest on latest.id = e.revision_id
  join private.takeoff_item_reading_states(p_tenant_id, p_project_id, p_plan_logical_id) st on st.item_id = e.item_id
  left join decided d on d.item_id = e.item_id
  left join public.takeoff_item_entries se on se.tenant_id = p_tenant_id and se.project_id = p_project_id
    and se.item_id = e.item_id and se.plan_logical_id is not distinct from p_plan_logical_id
  where p_plan_logical_id is null or exists (select 1 from pairs p where p.item_id = e.item_id)
$$;

create or replace function public.read_takeoff_item_send_facts(p_tenant_id uuid, p_project_id uuid, p_job_id uuid)
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
        || case when chosen.answer_id is null then '{}'::jsonb else pg_catalog.jsonb_build_object(
          'quantity_source','verified_count','verified_count', (select opt -> 'verified'
            from private.takeoff_item_quantity_options(a.id) opt where pair.decision_effective = 'accepted'
              and opt -> 'available' = 'true'::jsonb
              and chosen.chosen_entry_revision is not distinct from (opt ->> 'entry_revision')::integer)) end
        order by a.item_id), '[]'::jsonb)
      from public.takeoff_item_answers as a
      left join pairs as pair on pair.answer_id = a.id and pair.item_id = a.item_id
      left join public.takeoff_item_answer_decisions chosen on chosen.answer_id = a.id and chosen.quantity_source = 'verified_count'
      where a.job_id = p_job_id and a.tenant_id = p_tenant_id),
    'affaire_entries', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('item_id', whole.item_id,
        'revision', whole.revision) order by whole.item_id), '[]'::jsonb)
      from public.takeoff_item_entries as whole
      where whole.tenant_id = p_tenant_id and whole.project_id = p_project_id and whole.plan_logical_id is null
        and whole.item_id in (select a.item_id from public.takeoff_item_answers as a where a.job_id = p_job_id)));
end;
$$;

create or replace function private.takeoff_item_send_plan_valid(p_plan jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(private.takeoff_item_send_keys(p_plan, array['format', 'version', 'job_id', 'plan_key', 'list', 'destination',
      'engine', 'breakdown', 'sections', 'targets', 'page_contributions', 'page_decisions', 'left_out', 'parts_not_sent',
      'dependencies'], array['choices_sha256'])
    and pg_catalog.octet_length(p_plan::text) <= 8388608
    and p_plan ->> 'format' = 'takeoff_item_send' and p_plan -> 'version' = '1'::jsonb and p_plan -> 'engine' = '3'::jsonb
    and (not (p_plan ? 'choices_sha256') or coalesce(p_plan ->> 'choices_sha256' ~ '^[0-9a-f]{64}$', false))
    and private.takeoff_item_send_uuid(p_plan -> 'job_id') and private.takeoff_item_send_uuid(p_plan -> 'plan_key')
    and private.takeoff_item_send_keys(p_plan -> 'list', array['revision_id', 'revision'])
    and private.takeoff_item_send_uuid(p_plan #> '{list,revision_id}')
    and pg_catalog.jsonb_typeof(p_plan #> '{list,revision}') = 'number'
    and ((p_plan #>> '{destination,kind}' = 'existing_draft'
        and private.takeoff_item_send_keys(p_plan -> 'destination', array['kind', 'version_id'])
        and private.takeoff_item_send_uuid(p_plan #> '{destination,version_id}'))
      or (p_plan #>> '{destination,kind}' = 'first_draft' and private.takeoff_item_send_keys(p_plan -> 'destination', array['kind'])))
    and coalesce(p_plan ->> 'breakdown' in ('together', 'by_level', 'by_building'), false)
    and pg_catalog.jsonb_typeof(p_plan -> 'sections') = 'array' and pg_catalog.jsonb_array_length(p_plan -> 'sections') <= 500
    and pg_catalog.jsonb_typeof(p_plan -> 'targets') = 'array'
    and pg_catalog.jsonb_array_length(p_plan -> 'targets') between 1 and 2000
    and pg_catalog.jsonb_typeof(p_plan -> 'page_contributions') = 'array'
    and pg_catalog.jsonb_typeof(p_plan -> 'page_decisions') = 'array'
    and pg_catalog.jsonb_typeof(p_plan -> 'left_out') = 'array' and pg_catalog.jsonb_typeof(p_plan -> 'parts_not_sent') = 'array'
    and private.takeoff_item_send_keys(p_plan -> 'dependencies', array['answers', 'affaire_entries', 'rules', 'location_generation',
      'plan_pages', 'earlier_targets', 'lines', 'pages_in_estimate', 'stamps', 'resolutions'])
    and pg_catalog.jsonb_typeof(p_plan #> '{dependencies,answers}') = 'array'
    and pg_catalog.jsonb_typeof(p_plan #> '{dependencies,affaire_entries}') = 'array'
    and pg_catalog.jsonb_typeof(p_plan #> '{dependencies,rules}') = 'array'
    and pg_catalog.jsonb_typeof(p_plan #> '{dependencies,plan_pages}') = 'array'
    and pg_catalog.jsonb_typeof(p_plan #> '{dependencies,earlier_targets}') = 'array'
    and pg_catalog.jsonb_typeof(p_plan #> '{dependencies,lines}') = 'array'
    and pg_catalog.jsonb_typeof(p_plan #> '{dependencies,pages_in_estimate}') = 'array'
    and pg_catalog.jsonb_typeof(p_plan #> '{dependencies,resolutions}') = 'array'
    and private.takeoff_item_send_keys(p_plan #> '{dependencies,stamps}', array['job', 'peers', 'context', 'dpgf',
      'first_draft_settings', 'destination', 'mapping'])
    and pg_catalog.jsonb_typeof(p_plan #> '{dependencies,stamps,dpgf}') = 'array'
    and pg_catalog.jsonb_typeof(p_plan #> '{dependencies,stamps,first_draft_settings}') in ('object', 'null')
    and (pg_catalog.jsonb_typeof(p_plan #> '{dependencies,stamps,context}') = 'null'
      or private.takeoff_item_send_keys(p_plan #> '{dependencies,stamps,context}', array['peers', 'locations']))
    and (pg_catalog.jsonb_typeof(p_plan #> '{dependencies,stamps,destination}') = 'null'
      or private.takeoff_item_send_keys(p_plan #> '{dependencies,stamps,destination}', array['version_id', 'status', 'updated_at']))
    and not exists (select 1 from pg_catalog.jsonb_array_elements(p_plan #> '{dependencies,stamps,dpgf}') as d(value)
      where private.takeoff_item_send_keys(d.value, array['import_id', 'mapping_id', 'rows_sha256', 'updated_at', 'status',
        'row_count']) is not true)
    and not exists (select 1 from pg_catalog.jsonb_array_elements(p_plan #> '{dependencies,answers}') as a(value)
      where private.takeoff_item_send_keys(a.value, array['item_id', 'answer_id', 'revision', 'decision_revision',
        'entry_revision']) is not true)
    and not exists (select 1 from pg_catalog.jsonb_array_elements(p_plan #> '{dependencies,affaire_entries}') as a(value)
      where private.takeoff_item_send_keys(a.value, array['item_id', 'revision']) is not true)
    and not exists (select 1 from pg_catalog.jsonb_array_elements(p_plan #> '{dependencies,rules}') as r(value)
      where private.takeoff_item_send_keys(r.value, array['item_id', 'rule_id', 'rule_version'], array['action', 'effect'])
        is not true)
    and not exists (select 1 from pg_catalog.jsonb_array_elements(p_plan #> '{dependencies,earlier_targets}') as t(value)
      where (private.takeoff_item_send_keys(t.value, array['estimate_item_id', 'item_id', 'compartment_key', 'breakdown', 'parts'])
        and pg_catalog.jsonb_typeof(t.value -> 'parts') = 'array'
        and not exists (select 1 from pg_catalog.jsonb_array_elements(t.value -> 'parts') as p(value)
          where (private.takeoff_item_send_keys(p.value, array['job_id', 'answer_id', 'observation_ids', 'quantity', 'pages',
            'plan_key', 'identity'])
            and private.takeoff_item_send_keys(p.value -> 'identity', array['unit', 'basis', 'network', 'material', 'diameter']))
            is not true)) is not true)
    and not exists (select 1 from pg_catalog.jsonb_array_elements(p_plan #> '{dependencies,lines}') as l(value)
      where (private.takeoff_item_send_keys(l.value, array['estimate_item_id', 'updated_at', 'quantity', 'dpgf'])
        and (pg_catalog.jsonb_typeof(l.value -> 'dpgf') = 'null'
          or private.takeoff_item_send_keys(l.value -> 'dpgf', array['import_id', 'raw_row_id', 'reference']))) is not true)
    and not exists (select 1 from pg_catalog.jsonb_array_elements(p_plan #> '{dependencies,pages_in_estimate}') as g(value)
      where private.takeoff_item_send_keys(g.value, array['page', 'earlier_job_ids', 'estimate_item_ids']) is not true)
    and not exists (select 1 from pg_catalog.jsonb_array_elements(p_plan #> '{dependencies,resolutions}') as r(value)
      where (private.takeoff_item_send_keys(r.value, array['key', 'choice'])
        and private.takeoff_item_send_text(r.value -> 'key', 400)
        and ((r.value #>> '{choice,kind}' = 'line' and private.takeoff_item_send_keys(r.value -> 'choice', array['kind', 'estimate_item_id'])
            and private.takeoff_item_send_uuid(r.value #> '{choice,estimate_item_id}'))
          or (r.value #>> '{choice,kind}' in ('new_line', 'keep_entry', 'use_retained', 'leave_out')
            and private.takeoff_item_send_keys(r.value -> 'choice', array['kind'])))) is not true)
    and not exists (select 1 from pg_catalog.jsonb_array_elements(p_plan -> 'targets') as t(value)
      where (private.takeoff_item_send_keys(t.value, array['key', 'item_id', 'compartment_key', 'line', 'unit_code', 'quantity_after',
          'quantity', 'rule', 'contributions', 'replaces'])
        and private.takeoff_item_send_text(t.value -> 'key', 1000)
        and private.takeoff_item_send_uuid(t.value -> 'item_id') and private.takeoff_item_send_text(t.value -> 'compartment_key', 400)
        and private.takeoff_item_send_text(t.value -> 'unit_code', 32) and pg_catalog.jsonb_typeof(t.value -> 'quantity_after') = 'number'
        and private.takeoff_item_send_keys(t.value -> 'quantity', array['kept_entry'], array['reference', 'entered', 'earlier',
          'replaced', 'added', 'measured', 'retained', 'rounded_from', 'gap'])
        and (pg_catalog.jsonb_typeof(t.value -> 'rule') = 'null'
          or private.takeoff_item_send_keys(t.value -> 'rule', array['rule_id', 'rule_version', 'category_id'],
            array['action', 'effect', 'assembly_id']))
        and pg_catalog.jsonb_typeof(t.value -> 'replaces') = 'array'
        and not exists (select 1 from pg_catalog.jsonb_array_elements(t.value -> 'replaces') as r(value)
          where private.takeoff_item_send_keys(r.value, array['job_id', 'answer_id', 'observation_ids', 'quantity']) is not true)
        and ((t.value #>> '{line,kind}' in ('dpgf_line', 'earlier_line')
            and private.takeoff_item_send_keys(t.value -> 'line', array['kind', 'estimate_item_id', 'expected_updated_at',
              'expected_quantity'])
            and private.takeoff_item_send_uuid(t.value #> '{line,estimate_item_id}')
            and pg_catalog.jsonb_typeof(t.value #> '{line,expected_updated_at}') = 'string'
            and pg_catalog.jsonb_typeof(t.value #> '{line,expected_quantity}') = 'number')
          or (t.value #>> '{line,kind}' = 'new_line'
            and private.takeoff_item_send_keys(t.value -> 'line', array['kind', 'section_key', 'section_id', 'title'],
              array['unit_code', 'order'])
            and private.takeoff_item_send_text(t.value #> '{line,section_key}', 2000)
            and (coalesce(t.value #> '{line,section_id}', 'null'::jsonb) = 'null'::jsonb
              or private.takeoff_item_send_uuid(t.value #> '{line,section_id}'))
            and private.takeoff_item_send_text(t.value #> '{line,title}', 4000)))
        and pg_catalog.jsonb_typeof(t.value -> 'contributions') = 'array'
        and pg_catalog.jsonb_array_length(t.value -> 'contributions') between 1 and 500
        and not exists (select 1 from pg_catalog.jsonb_array_elements(t.value -> 'contributions') as c(value)
          where (private.takeoff_item_send_keys(c.value, array['answer_id', 'answer_revision', 'kind', 'observation_ids', 'quantity',
              'unit', 'pages', 'identity'], array['marks_revision'])
            and private.takeoff_item_send_uuid(c.value -> 'answer_id')
            and coalesce(c.value ->> 'answer_revision' ~ '^[0-9a-f]{64}$', false)
            and coalesce(c.value ->> 'kind' in ('measured', 'entered','verified_count'), false)
            and ((c.value ->> 'kind' = 'verified_count') = (c.value ? 'marks_revision'))
            and (c.value ->> 'kind' <> 'verified_count' or (private.takeoff_item_answer_is_number(
              c.value -> 'marks_revision', 1, 1000000, true) and c.value -> 'observation_ids' = '[]'::jsonb))
            and pg_catalog.jsonb_typeof(c.value -> 'observation_ids') = 'array'
            and not exists (select 1 from pg_catalog.jsonb_array_elements(c.value -> 'observation_ids') as o(value)
              where private.takeoff_item_send_uuid(o.value) is not true)
            and pg_catalog.jsonb_typeof(c.value -> 'quantity') = 'number' and private.takeoff_item_send_text(c.value -> 'unit', 32)
            and pg_catalog.jsonb_typeof(c.value -> 'pages') = 'array'
            and not exists (select 1 from pg_catalog.jsonb_array_elements(c.value -> 'pages') as g(value)
              where (pg_catalog.jsonb_typeof(g.value) = 'number' and (g.value #>> '{}') ~ '^[1-9][0-9]{0,8}$') is not true)
            and private.takeoff_item_send_keys(c.value -> 'identity', array['unit', 'basis', 'network', 'material', 'diameter'])
            and private.takeoff_item_send_text(c.value #> '{identity,unit}', 32)) is not true)) is not true)
    and not exists (select 1 from pg_catalog.jsonb_array_elements(p_plan -> 'sections') as s(value)
      where (private.takeoff_item_send_keys(s.value, array['key', 'title', 'parent_key', 'parent_id'])
        and private.takeoff_item_send_text(s.value -> 'key', 2000)
        and private.takeoff_item_send_text(s.value -> 'title', 4000)
        and (coalesce(s.value -> 'parent_key', 'null'::jsonb) = 'null'::jsonb or private.takeoff_item_send_text(s.value -> 'parent_key', 2000))
        and (coalesce(s.value -> 'parent_id', 'null'::jsonb) = 'null'::jsonb or private.takeoff_item_send_uuid(s.value -> 'parent_id'))) is not true)
    and not exists (select 1 from pg_catalog.jsonb_array_elements(p_plan -> 'page_contributions') as g(value)
      where (private.takeoff_item_send_keys(g.value, array['page', 'item_ids', 'target_keys', 'observation_ids'])
        and pg_catalog.jsonb_typeof(g.value -> 'page') = 'number'
        and pg_catalog.jsonb_typeof(g.value -> 'item_ids') = 'array' and pg_catalog.jsonb_typeof(g.value -> 'target_keys') = 'array'
        and pg_catalog.jsonb_typeof(g.value -> 'observation_ids') = 'array') is not true)
    and not exists (select 1 from pg_catalog.jsonb_array_elements(p_plan -> 'left_out') as l(value)
      where private.takeoff_item_send_keys(l.value, array['item_id', 'reason'], array['rule_id', 'rule_version']) is not true)
    and not exists (select 1 from pg_catalog.jsonb_array_elements(p_plan -> 'parts_not_sent') as l(value)
      where (private.takeoff_item_send_keys(l.value, array['item_id', 'kind', 'observation_ids', 'pages', 'quantity', 'reason'],
          array['unit','marks_revision'])
        and pg_catalog.jsonb_typeof(l.value -> 'observation_ids') = 'array' and pg_catalog.jsonb_typeof(l.value -> 'pages') = 'array')
        is not true)
    -- A page decision names its page (null: a part whose page is unknown, on every page).
    and not exists (select 1 from pg_catalog.jsonb_array_elements(p_plan -> 'page_decisions') as d(value)
      where (private.takeoff_item_send_keys(d.value, array['page', 'decision'], array['reason_code', 'note'])
        and (d.value -> 'page' = 'null'::jsonb
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
      from pg_catalog.jsonb_array_elements(p_plan -> 'targets') as t(value)), false)
$$;

-- Ordinary mappings use the first active rule in the mapping engine's order.
-- Regex matches are projected by that engine. A named regex still cannot
-- overtake an earlier exact/contains match on the item's sealed label.
create function private.takeoff_item_send_skip_rule(p_tenant uuid, p_label text, p_rule uuid)
returns uuid language sql stable set search_path = '' as $$
  with whitespace(pattern) as (values ('[\t\n\v\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+'))
  select case when r.action = 'skip' then r.id end
    from public.takeoff_mapping_rules r cross join whitespace w
    cross join lateral (select lower(btrim(regexp_replace(p_label,w.pattern,' ','g')) collate pg_catalog."und-x-icu") as label,
      lower(btrim(regexp_replace(r.match_pattern,w.pattern,' ','g')) collate pg_catalog."und-x-icu") as pattern) n
    where r.tenant_id = p_tenant and r.is_active and case r.match_type
      when 'exact' then n.label = n.pattern
      when 'contains' then n.pattern <> '' and strpos(n.label,n.pattern) > 0
      when 'regex' then r.id = p_rule
      else false end
    order by r.priority, date_trunc('milliseconds',r.created_at), r.id limit 1
$$;
revoke all on function private.takeoff_item_send_skip_rule(uuid,text,uuid) from public, anon, authenticated, service_role;

-- Only the annotation for the sealed file and content hash supplies confirmed
-- values. A PDF's unpersisted building suggestion can distinguish two keys
-- only for a known level, a building left to reading and no confirmed building
-- in this affaire. Keep NFC, accents and JSON quoting as itemSendCompartment does.
create function private.takeoff_item_send_compartment_keys(p_job uuid,p_plan uuid,p_breakdown text,p_revision integer)
returns text[] language sql stable set search_path = '' as $$
  with source as (
    select j.tenant_id,j.project_id,src.source_kind,src.source_id,d.document ->> 'content_hash' as hash
    from public.takeoff_jobs j join public.takeoff_launch_requests r on r.id=j.launch_request_id
    cross join lateral private.takeoff_item_send_plan_read(j,r.manifest) d
    cross join lateral private.resolve_takeoff_plan_location_source(j.tenant_id,j.project_id,(d.document->>'plan_file_id')::uuid) src
    where j.id=p_job and d.plan_entry->>'logical_id'=p_plan::text and exists (
      select 1 from jsonb_array_elements(j.preparation_snapshot #> '{preparation,sources}') s
      where s->>'document_id'=d.document->>'plan_file_id' and s->>'content_hash'=d.document->>'content_hash'
        and s->>'kind'='plan' and s->'active'='true' and s->'confirmed'='true')
  ), loc as (
    select a.*,exists(select 1 from public.takeoff_plan_locations l where l.tenant_id=s.tenant_id
      and l.project_id=s.project_id and l.building_choice='value') as affaire_has_building
    from source s left join public.takeoff_plan_locations a on a.tenant_id=s.tenant_id and a.project_id=s.project_id
      and a.source_kind=s.source_kind and a.source_id=s.source_id and a.content_hash=s.hash
    where a.revision is not distinct from p_revision
  ), keys as (
    select loc.*,to_json(lower(btrim(regexp_replace(normalize(building,NFC),w.pattern,' ','g')) collate pg_catalog."und-x-icu"))::text as b,
      to_json(lower(btrim(regexp_replace(normalize(level,NFC),w.pattern,' ','g')) collate pg_catalog."und-x-icu"))::text as l
    from loc cross join (values ('[\t\n\v\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+')) w(pattern)
  )
  select case when p_breakdown='together' then array['together'] else coalesce((select case
    when p_breakdown='by_building' and b is not null then array['building:['||b||']']
    when p_breakdown='by_level' and l is not null and b is not null then array['level:['||b||','||l||']']
    when p_breakdown='by_level' and l is not null and not affaire_has_building and building_choice='unknown'
      then array['level:[null,'||l||']']
    when p_breakdown='by_level' and l is not null and not affaire_has_building and building_choice='reading'
      then array['level:[null,'||l||']','unallocated']
    else array['unallocated'] end from keys),case when p_revision is null then array['unallocated'] else '{}'::text[] end) end
$$;
revoke all on function private.takeoff_item_send_compartment_keys(uuid,uuid,text,integer) from public,anon,authenticated,service_role;

-- Undecided overlaps for this exact part. The same list selects what still
-- contributes to the item's quantity after its explicit page decisions.
create function private.takeoff_item_send_waiting_pages(p_plan jsonb,p_part jsonb,p_held jsonb)
returns text[] language sql immutable set search_path = '' as $$
  select array(select 'page:'||coalesce(h->>'page','all') from jsonb_array_elements(p_held) h
    where (h->>'page' is null or p_part->'pages'='[]' or p_part->'pages' @> jsonb_build_array(h->'page'))
      and ((h->>'today')::boolean or exists(select 1 from jsonb_array_elements(h->'parts') hp
        where (hp->>'item_id'=p_part->>'item_id' and hp->>'plan_key'=p_plan->>'plan_key') is not true))
      and not exists(select 1 from jsonb_array_elements(p_plan->'page_decisions') d where d->'page'=h->'page'))
$$;
revoke all on function private.takeoff_item_send_waiting_pages(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

-- The dialog offers a choice only at the first applicable step for the item.
-- rule_skip: the winning active skip rule on the sealed label, at the locked rule stamp.
-- unit_incompatible: the retained quantities fit, but their units/bases disagree with one another or the sealed item.
-- quantity:<item>: an individual retained quantity cannot fit numeric(12,3).
-- verified-total:<item>: a partial reading would divide a live total of this plan,
-- or a page replacement would take a verified total from another plan.
-- page:<page>: this part overlaps a held page without a page decision; every
-- other undecided overlap must also be explicitly left out.
-- breakdown:<item>: an ordinary item has a live target of another breakdown.
-- target:<key>: no unique free raw-row line of the item's DPGF import and no
-- previously bound DPGF line. An earlier explicit selection keeps its claim
-- even if a later choice suspends that item. Otherwise ordinary live targets are ambiguous/claimed,
-- or only a deleted ordinary line's live parts remain in this compartment.
-- identity:<key>: the selected line's unit or a kept part's quantitative identity differs.
-- compartment:<key>: another live line still carries this plan's part of the same item.
-- depth:<key>: the new or explicitly recreated line's actual section path exceeds the draft limit.
-- entry:<key>: the selected line differs from its expected prior quantity. keep_entry
-- suspends only with a DPGF reference and a typed value below the retained total.
-- quantity:<key>: the selected existing or new line's final quantity cannot fit numeric(12,3).
-- The member supplies the key and choice; every branch below checks its place in this order.
create function private.takeoff_item_send_exclusion_choice(p_plan jsonb,p_part jsonb,p_parts jsonb,
  p_held jsonb,p_resolution jsonb,p_reason text,p_page_count integer,p_max_depth integer,p_claimed_line uuid default null)
returns boolean language plpgsql stable set search_path = '' as $$
declare
  item uuid := (p_part->>'item_id')::uuid;
  job_ uuid := (p_plan->>'job_id')::uuid;
  version_ uuid := (p_plan#>>'{destination,version_id}')::uuid;
  plan_ uuid := (p_plan->>'plan_key')::uuid;
  key_ text := p_resolution->>'key';
  choice_ text := p_resolution#>>'{choice,kind}';
  target_key text;
  compartment text;
  entry_ public.takeoff_list_revision_entries;
  line_ public.estimate_items;
  unit_pages integer[] := array(select x::integer from jsonb_array_elements_text(p_plan#>'{dependencies,plan_pages}') x);
  read_pages integer[];
  covered integer[];
  replaced_pages uuid[];
  counted boolean := p_part->>'kind'='verified_count';
  unit_ text; basis_ text; incompatible boolean; raw_invalid boolean;
  waiting text[]; page_choices text[];
  with_dpgf boolean; bound boolean;
  choices jsonb := p_plan#>'{dependencies,resolutions}';
  candidates uuid[]; offered_lines uuid[]; selected uuid; picked jsonb;
  missing boolean; elsewhere boolean; incompatible_part boolean; cut_part boolean;
  depth_ integer; added_ numeric; retained_ numeric; after_ numeric;
  kept_ numeric; prior_ numeric; expected_ numeric; reference_ numeric; legacy_ numeric := 0; protective_ numeric := 0;
  earlier_count integer;
begin
  if choice_ is distinct from (case p_reason when 'entry_suspended' then 'keep_entry' when 'left_out' then 'leave_out' end)
    or choice_ is null then return false; end if;
  select * into strict entry_ from public.takeoff_list_revision_entries e
    where e.revision_id=(p_plan#>>'{list,revision_id}')::uuid and e.item_id=item;

  select bool_or(q<=0 or q>999999999.999 or q<>round(q,3)), min(u),min(b),
    bool_or(u is null) or count(distinct u)>1 or count(distinct b)>1
      or coalesce(bool_or(u<>private.takeoff_item_send_unit(entry_.expected_unit)),false)
      or coalesce(bool_or(b<>private.takeoff_item_send_folded(entry_.measurement_basis)),false)
    into raw_invalid,unit_,basis_,incompatible
    from (select (s->>'quantity')::numeric q,private.takeoff_item_send_unit(s->>'unit') u,
      private.takeoff_item_send_folded(s->>'basis') b from jsonb_array_elements(p_parts) s where s->>'item_id'=item::text) quantities;
  if raw_invalid then return key_='quantity:'||item and choice_='leave_out'; end if;
  if incompatible then return false; end if;
  select case when counted then unit_pages else a.searched_pages end into read_pages
    from public.takeoff_item_answers a where a.id=(p_part->>'answer_id')::uuid;
  if not private.takeoff_item_send_whole_plan(p_page_count,read_pages,read_pages) and exists(
    select 1 from public.takeoff_item_send_parts p where p.version_id=version_ and p.item_id=item
      and p.plan_logical_id=plan_ and p.state='live' and p.kind='verified_count') then
    return key_='verified-total:'||item and choice_='leave_out';
  end if;

  waiting:=private.takeoff_item_send_waiting_pages(p_plan,p_part,p_held);
  if cardinality(waiting)>0 then
    page_choices:=array(select r->>'key' from jsonb_array_elements(choices || jsonb_build_array(p_resolution)) r
      where r#>>'{choice,kind}'='leave_out');
    return key_=any(waiting) and choice_='leave_out' and waiting <@ page_choices;
  end if;
  select sum((s->>'quantity')::numeric) into added_ from jsonb_array_elements(p_parts) s where s->>'item_id'=item::text
    and cardinality(private.takeoff_item_send_waiting_pages(p_plan,s,p_held))=0;
  select array(select pg from unnest(case when counted or p_part->>'kind'='entered' then unit_pages else read_pages end) pg
    where cardinality(private.takeoff_item_send_waiting_pages(p_plan,p_part||jsonb_build_object('pages',jsonb_build_array(pg)),p_held))=0
      and not exists(select 1 from jsonb_array_elements(p_parts) s where s->>'item_id'=item::text
        and s->'pages' @> to_jsonb(pg) and cardinality(private.takeoff_item_send_waiting_pages(p_plan,s,p_held))>0)
    union select (d->>'page')::integer from jsonb_array_elements(p_plan->'page_decisions') d
      where d->>'decision'='replace' and d->>'page' is not null) into covered;
  select array(select distinct (hp->>'part_id')::uuid from jsonb_array_elements(p_held) h
    join jsonb_array_elements(p_plan->'page_decisions') d on d->'page'=h->'page' and d->>'decision'='replace'
    cross join jsonb_array_elements(h->'parts') hp where hp->>'item_id'=item::text and exists(
      select 1 from jsonb_array_elements(p_parts) s where s->>'item_id'=item::text
        and cardinality(private.takeoff_item_send_waiting_pages(p_plan,s,p_held))=0
        and (h->>'page' is null or s->'pages'='[]' or s->'pages' @> jsonb_build_array(h->'page')))) into replaced_pages;
  if exists(select 1 from public.takeoff_item_send_parts p where p.version_id=version_ and p.item_id=item and p.state='live'
      and ((p.plan_logical_id=plan_ and private.takeoff_item_send_count_scope(p.kind,p.pages,counted,covered,
        private.takeoff_item_send_whole_plan(p_page_count,read_pages,covered))='refuse')
      or (p.plan_logical_id<>plan_ and p.kind='verified_count' and p.id=any(replaced_pages)))) then
    return key_='verified-total:'||item and choice_='leave_out';
  end if;

  select count(*)>0,coalesce(bool_or(entry_.origin_kind='dpgf'
    and lower(i.source_metadata->>'import_id')=lower(entry_.origin->>'importId')),false)
  into with_dpgf,bound from public.estimate_items i
  where i.version_id=version_ and i.item_type='line' and i.source_provider='dpgf';
  if not bound and exists(select 1 from public.takeoff_item_send_targets t where t.version_id=version_
    and t.item_id=item and t.estimate_item_id is not null and t.breakdown<>p_plan->>'breakdown') then
    return key_='breakdown:'||item and choice_='leave_out';
  end if;
  target_key:=substr(key_,strpos(key_,':')+1);
  if split_part(target_key,'|',1)<>item::text then return false; end if;
  compartment:=substr(target_key,length(item::text)+2);
  if target_key<>item||'|'||compartment or not (compartment=any(case when bound then array['dpgf']
    else private.takeoff_item_send_compartment_keys(job_,plan_,p_plan->>'breakdown',(p_plan#>>'{dependencies,location_generation}')::integer) end))
    then return false; end if;
  select r->'choice' into picked from jsonb_array_elements(choices) r where r->>'key'='target:'||target_key;
  if bound then
    -- A live binding wins even if an extra copy of the raw row is present.
    select t.estimate_item_id into selected from public.takeoff_item_send_targets t
      where t.version_id=version_ and t.item_id=item and t.breakdown='dpgf' and t.estimate_item_id is not null;
    if selected is not null and p_claimed_line is not null then return false; end if;
    if selected is null then
      with import_lines as materialized (
        select i.id,raw.raw_row_id,array(select distinct t.item_id from public.takeoff_item_send_targets t
          where t.version_id=version_ and t.estimate_item_id=i.id) as holders from public.estimate_items i
        left join public.read_estimate_dpgf_raw_rows(entry_.tenant_id,version_) raw on raw.estimate_item_id=i.id
          and raw.import_id::text=lower(entry_.origin->>'importId')
        where i.version_id=version_ and i.item_type='line' and i.source_provider='dpgf'
          and lower(i.source_metadata->>'import_id')=lower(entry_.origin->>'importId')
      ), reserved as materialized (
        -- The first scoped item with one proven free line for its raw row
        -- claims that line before the planner visits the items' decisions.
        select distinct on (f.id) f.id,e.item_id from import_lines f
        join public.takeoff_list_revision_entries e on e.revision_id=entry_.revision_id and e.origin_kind='dpgf'
          and lower(e.origin->>'importId')=lower(entry_.origin->>'importId') and lower(e.origin->>'rawRowId')=f.raw_row_id::text
        join public.takeoff_item_answers a on a.job_id=job_ and a.item_id=e.item_id
        where cardinality(f.holders)=0 and not exists(select 1 from public.takeoff_item_send_targets t where t.version_id=version_
          and t.item_id=e.item_id and t.breakdown='dpgf' and t.estimate_item_id is not null)
          and (select count(*) from import_lines other where other.raw_row_id=f.raw_row_id and other.holders<@array[e.item_id])=1
        order by f.id,e.position
      ), available as (
        select f.* from import_lines f where f.holders<@array[item] and not exists(select 1 from reserved r where r.id=f.id and r.item_id<>item)
          and not exists(select 1 from jsonb_array_elements(choices) resolution
            join public.takeoff_list_revision_entries e on e.revision_id=entry_.revision_id and e.position<entry_.position
              and resolution->>'key'='target:'||e.item_id||'|dpgf'
            where resolution#>>'{choice,kind}'='line' and resolution#>>'{choice,estimate_item_id}'=f.id::text
              and exists(select 1 from jsonb_array_elements(p_parts) part where part->>'item_id'=e.item_id::text)
              and (exists(select 1 from jsonb_array_elements(p_plan->'targets') target
                where target->>'item_id'=e.item_id::text and target#>>'{line,estimate_item_id}'=f.id::text)
                or exists(select 1 from jsonb_array_elements(p_plan->'left_out') omitted
                  cross join jsonb_array_elements(choices) decision cross join jsonb_array_elements(p_parts) previous
                  where omitted->>'item_id'=e.item_id::text and previous->'item_id'=omitted->'item_id'
                    and decision->>'key' in ('identity:'||e.item_id||'|dpgf','compartment:'||e.item_id||'|dpgf',
                      'entry:'||e.item_id||'|dpgf','quantity:'||e.item_id||'|dpgf')
                    and private.takeoff_item_send_exclusion_choice(p_plan,previous,p_parts,p_held,decision,
                      omitted->>'reason',p_page_count,p_max_depth,f.id))))
      )
      select array(select id from available where raw_row_id::text=lower(entry_.origin->>'rawRowId')),
        array(select f.id from available f join public.estimate_items i on i.id=f.id where private.takeoff_item_send_unit(i.unit_code)=unit_)
        into candidates,offered_lines;
      if cardinality(candidates)=1 then
        if p_claimed_line is not null then return false; end if;
        selected:=candidates[1];
      else
        if key_='target:'||target_key then return choice_='leave_out'; end if;
        if cardinality(candidates)>1 then offered_lines:=candidates; end if;
        selected:=private.takeoff_uuid_or_null(picked->'estimate_item_id');
        if picked->>'kind' is distinct from 'line' or (selected=any(offered_lines)) is not true
          or (p_claimed_line is not null and selected<>p_claimed_line) then return false; end if;
      end if;
    end if;
  else
    if p_claimed_line is not null then return false; end if;
    select array(select t.estimate_item_id from public.takeoff_item_send_targets t where t.version_id=version_
      and t.item_id=item and t.compartment_key=compartment and t.estimate_item_id is not null) into candidates;
    if cardinality(candidates)=1 then selected:=candidates[1];
    elsif cardinality(candidates)>1 then
      if key_='target:'||target_key then return choice_='leave_out'; end if;
      selected:=private.takeoff_uuid_or_null(picked->'estimate_item_id');
      if picked->>'kind' is distinct from 'line' or (selected=any(candidates)) is not true then return false; end if;
    end if;
  end if;
  select exists(select 1 from public.takeoff_item_send_parts p join public.takeoff_item_send_targets t on t.id=p.target_id
    where p.version_id=version_ and p.item_id=item and p.plan_logical_id=plan_ and p.state='live'
      and t.estimate_item_id is not null and t.estimate_item_id is distinct from selected) into elsewhere;
  if selected is null then
    if bound then return false; end if;
    if elsewhere then return key_='compartment:'||target_key and choice_='leave_out'; end if;
    select exists(select 1 from public.takeoff_item_send_targets t join public.takeoff_item_send_parts p on p.target_id=t.id and p.state='live'
      where t.version_id=version_ and t.item_id=item and t.breakdown=p_plan->>'breakdown'
        and t.compartment_key=compartment and t.estimate_item_id is null) into missing;
    if missing then
      if key_='target:'||target_key then return choice_='leave_out'; end if;
      if picked->>'kind' is distinct from 'new_line' then return false; end if;
    end if;
    depth_:=(case when with_dpgf then 1+(jsonb_array_length(entry_.sections)>0)::integer
      else greatest(1,jsonb_array_length(entry_.sections)) end)+(compartment<>'together')::integer;
    if depth_>p_max_depth then return key_='depth:'||target_key and choice_='leave_out'; end if;
    after_:=private.takeoff_item_send_rounded(added_,private.takeoff_item_send_length_factor(unit_));
  else
    select * into strict line_ from public.estimate_items i where i.id=selected and i.version_id=version_ and i.item_type='line';
    if not bound and exists(select 1 from public.takeoff_item_send_targets t where t.estimate_item_id=selected and t.item_id<>item) then
      return key_='target:'||target_key and choice_='leave_out';
    end if;
    with history as (
      select p.*,p.id=any(replaced_pages) or (p.plan_logical_id=plan_ and (p.kind='verified_count'
        or case when cardinality(p.pages)>0 then p.pages <@ covered else unit_pages <@ covered end)) as replaced
      from public.takeoff_item_send_parts p join public.takeoff_item_send_targets t on t.id=p.target_id
      where p.version_id=version_ and p.item_id=item and p.state='live' and t.estimate_item_id=selected
    )
    select count(*),coalesce(sum(quantity),0),coalesce(sum(quantity) filter(where not replaced),0),
      bool_or(plan_logical_id=plan_ and kind<>'verified_count' and pages && covered and not (pages <@ covered)),
      bool_or(not replaced and (unit_code,basis,network,material,diameter) is distinct from
        (unit_,coalesce(basis_,private.takeoff_item_send_folded(entry_.measurement_basis)),
         private.takeoff_item_send_folded(entry_.qualifiers->>'network'),private.takeoff_item_send_folded(entry_.qualifiers->>'material'),
         private.takeoff_item_send_diameter(entry_.qualifiers->>'diameter')))
      into earlier_count,prior_,kept_,cut_part,incompatible_part from history;
    if cut_part then return false; end if;
    if incompatible_part then return key_='identity:'||target_key and choice_='leave_out'; end if;
    if elsewhere then return key_='compartment:'||target_key and choice_='leave_out'; end if;
    if private.takeoff_item_send_unit(line_.unit_code) is distinct from unit_ then
      return key_='identity:'||target_key and choice_='leave_out';
    end if;
    if bound then
      reference_:=private.takeoff_item_send_dpgf_reference(entry_.tenant_id,line_.source_metadata);
      select earlier_count+count(*),coalesce(sum(l.quantity),0),coalesce(sum(l.protective),0) into earlier_count,legacy_,protective_
        from private.takeoff_item_send_legacy_dpgf_parts(line_.source_metadata,job_) l;
    end if;
    expected_:=case when earlier_count=0 then reference_ else private.takeoff_item_send_composed(reference_,
      prior_+legacy_,protective_,private.takeoff_item_send_length_factor(line_.unit_code)) end;
    retained_:=private.takeoff_item_send_composed(reference_,kept_+legacy_+added_,protective_,private.takeoff_item_send_length_factor(line_.unit_code));
    after_:=retained_;
    if round(line_.quantity,4)<>round(coalesce(expected_,0),4) then
      if key_='entry:'||target_key then return choice_='leave_out' or (choice_='keep_entry' and reference_ is not null and line_.quantity<retained_); end if;
      select r->'choice' into picked from jsonb_array_elements(choices) r where r->>'key'='entry:'||target_key;
      if picked->>'kind'='keep_entry' then
        if reference_ is not null and line_.quantity<retained_ then return false; end if;
        after_:=line_.quantity;
      elsif picked->>'kind' is distinct from 'use_retained' then return false; end if;
    end if;
  end if;
  return key_='quantity:'||target_key and choice_='leave_out' and
    (after_<=0 or after_>999999999.999 or after_<>round(after_,3));
end;
$$;
revoke all on function private.takeoff_item_send_exclusion_choice(jsonb,jsonb,jsonb,jsonb,jsonb,text,integer,integer,uuid)
  from public, anon, authenticated, service_role;

create or replace function public.send_takeoff_item_plan(p_tenant_id uuid, p_actor_id uuid, p_module_default boolean, p_request jsonb)
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
  earlier_proofs_current boolean;
  incoming_count jsonb;
  whole_plan boolean;
  blocked_part public.takeoff_item_send_parts%rowtype;
  count_proof jsonb;
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
  earlier_proofs_current := private.takeoff_item_send_lock_proofs(tenant, target_job_id, target_version, plan -> 'targets');
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
  -- And this tenant is still the one the actor works in, as the application resolves it (public.current_tenant_id(),
  -- readActiveTenantMembership: the default membership first, then the oldest, among active tenants): a tenant suspended,
  -- or the member gone to another tenant, during the waits refuses, before any answer.
  if (select membership.tenant_id from public.tenant_memberships as membership
      join public.tenants as tenant_row on tenant_row.id = membership.tenant_id and tenant_row.is_active
      where membership.user_id = actor
      order by membership.is_default desc, membership.created_at asc limit 1) is distinct from tenant then
    raise exception 'TAKEOFF_ITEM_SEND_PROJECT_NOT_WRITABLE' using errcode = '42501',
      detail = pg_catalog.jsonb_build_object('reason', 'tenant_changed')::text;
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
      and lock_row.user_id <> actor and lock_row.expires_at > pg_catalog.clock_timestamp()) then
      raise exception 'TAKEOFF_ITEM_SEND_DRAFT_LOCKED' using errcode = '55P03';
    end if;
    if not exists (select 1 from public.draft_locks as lock_row where lock_row.version_id = target_version
      and lock_row.user_id = actor and lock_row.expires_at > pg_catalog.clock_timestamp()) then
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
        group by listed.value -> 'item_id' having count(*) > 1) then 'mapping_changed'
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
  select coalesce(pg_catalog.jsonb_agg(stored), '[]'::jsonb) into job_parts
  from private.takeoff_item_send_resolved_parts(tenant, job.project_id, target_job_id, unit_pages) as stored;

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
    -- A source part and a copied part carry the same immutable proof. If the analysis
    -- still exists, compare its locked marks revision before using the part in this
    -- item's balance. If it was deleted, the copy is itself the historical record.
    if not earlier_proofs_current then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'earlier_send_changed')::text;
    end if;
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
  if exists (select 1 from public.takeoff_item_send_parts as p where p.id = any(page_replaced) and p.kind <> 'verified_count'
      and (pg_catalog.cardinality(p.pages) = 0 or exists (select 1 from pg_catalog.unnest(p.pages) as x(page)
        where not exists (select 1 from pg_catalog.jsonb_array_elements(plan -> 'page_decisions') as d(value)
          where d.value ->> 'decision' = 'replace'
            and (coalesce(d.value -> 'page', 'null'::jsonb) = 'null'::jsonb or (d.value ->> 'page')::integer = x.page))))) then
    raise exception 'TAKEOFF_ITEM_SEND_PAGE_DECISION_INVALID' using errcode = '22023',
      detail = pg_catalog.jsonb_build_object('reason', 'part_indivisible')::text;
  end if;

  -- Begin with every retained part read under the locks. A previous preview format
  -- may classify a counted item as not found and never submit a target for it.
  -- A whole item can be absent only when the preview accounted for its real parts.
  if exists (
    with omitted as (
      select stored.value as part from jsonb_array_elements(job_parts) stored(value)
      where not exists (select 1 from jsonb_array_elements(plan -> 'targets') tgt where tgt -> 'item_id' = stored.value -> 'item_id')
    ), winning_rules as materialized (
      select li.item_id, private.takeoff_item_send_skip_rule(tenant,li.label,
        private.takeoff_uuid_or_null(applied.rule->'rule_id')) as skip_id, applied.rule
      from (select distinct (o.part->>'item_id')::uuid as id from omitted o) items
      join public.takeoff_list_revision_entries li on li.revision_id=launch.item_list_revision_id and li.item_id=items.id
      left join lateral (select r as rule from jsonb_array_elements(deps->'rules') r
        where r->>'item_id'=li.item_id::text) applied on true
    ), incompatible as (
      select li.item_id from omitted o
      join public.takeoff_list_revision_entries li on li.revision_id = launch.item_list_revision_id
        and li.item_id = (o.part ->> 'item_id')::uuid
      cross join lateral (select private.takeoff_item_send_unit(o.part ->> 'unit') as unit,
        private.takeoff_item_send_folded(o.part ->> 'basis') as basis) identity_
      group by li.item_id, li.expected_unit, li.measurement_basis
      having bool_and((o.part->>'quantity')::numeric<=999999999.999
        and (o.part->>'quantity')::numeric=round((o.part->>'quantity')::numeric,3))
        and (bool_or(identity_.unit is null) or count(distinct identity_.unit) > 1 or count(distinct identity_.basis) > 1
        or (li.expected_unit is not null and bool_or(private.takeoff_item_send_unit(li.expected_unit) <> identity_.unit))
        or (li.measurement_basis is not null and bool_or(private.takeoff_item_send_folded(li.measurement_basis) <> identity_.basis)))
    ), item_reasons as materialized (
      select x as omission from jsonb_array_elements(plan->'left_out') x
      where exists(select 1 from omitted o where o.part->'item_id'=x->'item_id')
    ), declared as materialized (
      select x as excluded from jsonb_array_elements(plan->'parts_not_sent') x
      where exists(select 1 from omitted o where o.part->'item_id'=x->'item_id')
    ), matched as materialized (
      select o.part,d.excluded,i.omission from omitted o join declared d
        on d.excluded->'item_id'=o.part->'item_id' and d.excluded->'kind'=o.part->'kind'
        and d.excluded->'quantity'=o.part->'quantity' and d.excluded->'unit'=o.part->'unit'
        and d.excluded->'pages'=o.part->'pages' and d.excluded->'observation_ids'=
          case when o.part->>'kind'='measured' then jsonb_build_array(o.part->'observation_id') else '[]'::jsonb end
        and (o.part->>'kind'<>'verified_count' or d.excluded->'marks_revision'=o.part->'marks_revision')
      join item_reasons i on i.omission->'item_id'=o.part->'item_id'
    ), checked as materialized (
      select m.*,case m.excluded->>'reason'
        when 'rule_skip' then winner.skip_id::text=m.omission->>'rule_id' and winner.rule->'rule_id'=m.omission->'rule_id'
          and (m.omission->>'rule_version' is null or m.omission->'rule_version'=winner.rule->'rule_version')
        when 'unit_incompatible' then winner.skip_id is null and exists(select 1 from incompatible i where i.item_id=winner.item_id)
        when 'left_out' then dialog.valid
        when 'entry_suspended' then dialog.valid
        else false end as valid,coalesce(dialog.on_page,false) as on_page
      from matched m join winning_rules winner on winner.item_id=(m.part->>'item_id')::uuid left join lateral (
        select bool_or(true) as valid,bool_or(r->>'key' like 'page:%') as on_page
        from jsonb_array_elements(deps->'resolutions') r
        where winner.skip_id is null and m.excluded->>'reason' in ('left_out','entry_suspended')
          and private.takeoff_item_send_exclusion_choice(plan,m.part,job_parts,held,r,m.excluded->>'reason',
            (plan_entry->>'page_count')::integer,coalesce(version_row.max_section_depth,
              (p_request#>>'{version_payload,max_section_depth}')::integer,3))
      ) dialog on true
    )
    -- Every stored part has a valid declaration and every declared part belongs
    -- to the item. The whole item's reason describes the remaining parts. A
    -- page choice may explain individual parts removed before that decision.
    select 1 from omitted o where not exists(select 1 from checked c where c.part=o.part and c.valid)
    union all select 1 from declared d where not exists(select 1 from checked c where c.excluded=d.excluded and c.valid)
    union all select 1 from item_reasons i where not exists(
      select 1 from checked c where c.omission=i.omission and c.valid and c.excluded->'reason'=i.omission->'reason'
    ) or exists(select 1 from checked c where c.omission=i.omission and c.valid
      and c.excluded->'reason'<>i.omission->'reason' and not (c.on_page and i.omission->>'reason' in ('entry_suspended','left_out')))
    union all select 1 from item_reasons group by omission->'item_id' having count(*)<>1
  ) then
    raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = jsonb_build_object('reason','item_changed')::text;
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
    -- code), each named once, and the others are the ones the plan holds or leaves out by page, each named once.
    select pg_catalog.count(*)::integer into stored_count from pg_catalog.jsonb_array_elements(job_parts) as stored(value)
    where stored.value ->> 'item_id' = target ->> 'item_id';
    select pg_catalog.count(*)::integer into listed_count from pg_catalog.jsonb_array_elements(plan -> 'parts_not_sent') as listed(value)
    where listed.value ->> 'item_id' = target ->> 'item_id' and listed.value ->> 'reason' in ('page_held', 'left_out');
    if stored_count = 0 or stored_count <> pg_catalog.jsonb_array_length(target -> 'contributions') + listed_count
      or (select pg_catalog.count(distinct pg_catalog.jsonb_build_array(c.value -> 'kind', c.value -> 'answer_id',
          case when c.value ->> 'kind' <> 'measured' then 'null'::jsonb else c.value -> 'observation_ids' end))
        from pg_catalog.jsonb_array_elements(target -> 'contributions') as c(value))
        <> pg_catalog.jsonb_array_length(target -> 'contributions')
      or (select pg_catalog.count(distinct pg_catalog.jsonb_build_array(listed.value -> 'kind',
          case when listed.value ->> 'kind' <> 'measured' then 'null'::jsonb else listed.value -> 'observation_ids' end))
        from pg_catalog.jsonb_array_elements(plan -> 'parts_not_sent') as listed(value)
        where listed.value ->> 'item_id' = target ->> 'item_id' and listed.value ->> 'reason' in ('page_held', 'left_out'))
        <> listed_count
      or exists (select 1 from pg_catalog.jsonb_array_elements(target -> 'contributions') as c(value)
        where (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(job_parts) as stored(value)
          where stored.value ->> 'item_id' = target ->> 'item_id' and stored.value ->> 'answer_id' = c.value ->> 'answer_id'
            and stored.value -> 'marks_revision' is not distinct from c.value -> 'marks_revision'
            and stored.value ->> 'answer_revision' = c.value ->> 'answer_revision' and stored.value ->> 'kind' = c.value ->> 'kind'
            and (stored.value ->> 'quantity')::numeric = (c.value ->> 'quantity')::numeric
            and private.takeoff_item_send_unit(stored.value ->> 'unit') = private.takeoff_item_send_unit(c.value ->> 'unit')
            and (stored.value ->> 'kind' <> 'measured'
              or pg_catalog.jsonb_build_array(stored.value -> 'observation_id') = c.value -> 'observation_ids')
            and stored.value -> 'pages' = pg_catalog.to_jsonb(array(select distinct (g.value #>> '{}')::integer
              from pg_catalog.jsonb_array_elements(c.value -> 'pages') as g(value) order by 1))) <> 1) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'item_changed', 'item_id', target ->> 'item_id')::text;
    end if;
    -- And each part the plan holds or leaves out by page is one of the stored parts it does not send, exactly: its kind, its
    -- observation, its quantity and its pages as stored (never the plan's).
    if exists (select 1 from pg_catalog.jsonb_array_elements(plan -> 'parts_not_sent') as listed(value)
        where listed.value ->> 'item_id' = target ->> 'item_id' and listed.value ->> 'reason' in ('page_held', 'left_out')
          and (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(job_parts) as stored(value)
            where stored.value ->> 'item_id' = target ->> 'item_id' and stored.value ->> 'kind' = listed.value ->> 'kind'
              and (stored.value ->> 'kind' <> 'measured'
                or pg_catalog.jsonb_build_array(stored.value -> 'observation_id') = listed.value -> 'observation_ids')
              and (stored.value ->> 'quantity')::numeric = (listed.value ->> 'quantity')::numeric
              and stored.value -> 'pages' = pg_catalog.to_jsonb(array(select distinct (g.value #>> '{}')::integer
                from pg_catalog.jsonb_array_elements(listed.value -> 'pages') as g(value) order by 1))
              and not exists (select 1 from pg_catalog.jsonb_array_elements(target -> 'contributions') as c(value)
                where c.value ->> 'kind' = stored.value ->> 'kind' and (stored.value ->> 'kind' <> 'measured'
                  or pg_catalog.jsonb_build_array(stored.value -> 'observation_id') = c.value -> 'observation_ids'))) <> 1) then
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
    -- less the pages of the stored parts it does not send (held or left out: their stored pages, never the plan's) and
    -- those held without a decision, and the pages a « replace » decision carries.
    covered := array(select distinct x from pg_catalog.unnest(
        case when exists (select 1 from pg_catalog.jsonb_array_elements(target -> 'contributions') as c(value)
            where c.value ->> 'kind' = 'entered') then unit_pages
          when exists (select 1 from pg_catalog.jsonb_array_elements(target -> 'contributions') as c(value)
            where c.value ->> 'kind' = 'verified_count') then (select private.takeoff_count_answer_scope(a)
              from public.takeoff_item_answers a where a.job_id = target_job_id and a.item_id = (target ->> 'item_id')::uuid)
          else (select a.searched_pages from public.takeoff_item_answers as a
            where a.job_id = target_job_id and a.item_id = (target ->> 'item_id')::uuid) end) as x
      where not exists (select 1 from pg_catalog.jsonb_array_elements(job_parts) as stored(value)
          cross join lateral pg_catalog.jsonb_array_elements(stored.value -> 'pages') as g(value)
          where stored.value ->> 'item_id' = target ->> 'item_id' and (g.value #>> '{}')::integer = x
            and not exists (select 1 from pg_catalog.jsonb_array_elements(target -> 'contributions') as c(value)
              where c.value ->> 'kind' = stored.value ->> 'kind' and (stored.value ->> 'kind' <> 'measured'
                or pg_catalog.jsonb_build_array(stored.value -> 'observation_id') = c.value -> 'observation_ids')))
        and not exists (select 1 from pg_catalog.jsonb_array_elements(held) as entry(value)
          where (entry.value -> 'page' = 'null'::jsonb or (entry.value ->> 'page')::integer = x)
            and ((entry.value ->> 'today')::boolean or exists (select 1 from pg_catalog.jsonb_array_elements(entry.value -> 'parts') as p(value)
              where (p.value ->> 'plan_key' = plan_key::text and p.value ->> 'item_id' = target ->> 'item_id') is not true))
            and not exists (select 1 from pg_catalog.jsonb_array_elements(plan -> 'page_decisions') as d(value)
              where coalesce(d.value -> 'page', 'null'::jsonb) = entry.value -> 'page'))
      union select (d.value ->> 'page')::integer from pg_catalog.jsonb_array_elements(plan -> 'page_decisions') as d(value)
        where d.value ->> 'decision' = 'replace' and d.value ->> 'page' is not null
      order by 1);

    -- A verified count is one item's plan total. Its evidence pages locate
    -- the marks and cannot prove that a later partial reading replaces it.
    select stored.value into incoming_count from pg_catalog.jsonb_array_elements(job_parts) stored(value)
      where stored.value ->> 'item_id' = target ->> 'item_id' and stored.value ->> 'kind' = 'verified_count';
    if target_version is not null and (incoming_count is not null or exists (
        select 1 from public.takeoff_item_send_parts p where p.version_id = target_version and p.state = 'live'
          and p.kind = 'verified_count' and p.item_id = (target ->> 'item_id')::uuid)) then
      select private.takeoff_item_send_whole_plan((plan_entry ->> 'page_count')::integer,
        case when incoming_count is not null then private.takeoff_count_answer_scope(a) else a.searched_pages end, covered)
      into whole_plan from public.takeoff_item_answers a
      where a.job_id = target_job_id and a.item_id = (target ->> 'item_id')::uuid;
      select p.* into blocked_part from public.takeoff_item_send_parts p
      where p.version_id = target_version and p.state = 'live' and p.item_id = (target ->> 'item_id')::uuid
        and ((p.plan_logical_id = plan_key and private.takeoff_item_send_count_scope(p.kind,p.pages,
            incoming_count is not null,covered,whole_plan) = 'refuse')
          or (p.plan_logical_id <> plan_key and p.kind = 'verified_count' and p.id = any(page_replaced)))
      order by (p.kind = 'verified_count') desc,p.job_id,p.answer_id,p.observation_ids,p.id limit 1;
      if found then
        if blocked_part.kind = 'verified_count' then
          count_proof := pg_catalog.jsonb_build_object('job_id',blocked_part.job_id,'answer_id',blocked_part.answer_id,
            'quantity',blocked_part.quantity,'unit',blocked_part.unit,'pages',blocked_part.pages,
            'marks_revision',blocked_part.marks_revision);
        else
          count_proof := pg_catalog.jsonb_build_object('job_id',target_job_id,'answer_id',incoming_count -> 'answer_id',
            'quantity',incoming_count -> 'quantity','unit',incoming_count -> 'unit','pages',incoming_count -> 'pages',
            'marks_revision',incoming_count -> 'marks_revision',
            'held_part',pg_catalog.jsonb_build_object('source',blocked_part.kind,'quantity',blocked_part.quantity,
              'unit',blocked_part.unit,'pages',blocked_part.pages,'job_id',blocked_part.job_id,'answer_id',blocked_part.answer_id,
              'reading_revision',(select a.reading_revision from public.takeoff_item_answers a where a.id = blocked_part.answer_id)));
        end if;
        raise exception 'TAKEOFF_ITEM_SEND_VERIFIED_TOTAL_INDIVISIBLE' using errcode = '40001',
          detail = (count_proof || pg_catalog.jsonb_build_object('reason','verified_total_indivisible',
            'item_id',target -> 'item_id','reading_revision',(select a.reading_revision from public.takeoff_item_answers a
              where a.id = (count_proof ->> 'answer_id')::uuid)))::text;
      end if;
    end if;

    -- What the plan adds: the stored quantity of each part it sends (the plan's copy was only compared above).
    added := (select pg_catalog.sum((stored.value ->> 'quantity')::numeric)
      from pg_catalog.jsonb_array_elements(target -> 'contributions') as c(value)
      join pg_catalog.jsonb_array_elements(job_parts) as stored(value) on stored.value ->> 'item_id' = target ->> 'item_id'
        and stored.value ->> 'answer_id' = c.value ->> 'answer_id' and stored.value ->> 'kind' = c.value ->> 'kind'
        and (stored.value ->> 'kind' <> 'measured'
          or pg_catalog.jsonb_build_array(stored.value -> 'observation_id') = c.value -> 'observation_ids'));
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
            and p.kind <> 'verified_count' and pg_catalog.cardinality(p.pages) > 0 and p.pages && covered and not (p.pages <@ covered)) then
        raise exception 'TAKEOFF_ITEM_SEND_PAGE_DECISION_INVALID' using errcode = '22023',
          detail = pg_catalog.jsonb_build_object('reason', 'part_indivisible', 'estimate_item_id', line.id)::text;
      end if;
      select coalesce(pg_catalog.array_agg(p.id order by p.id), '{}'::uuid[]) into target_replaced
      from public.takeoff_item_send_parts as p
      where p.target_id = live_target_id and p.state = 'live'
        and ((p.plan_logical_id = plan_key and (p.kind = 'verified_count' or (pg_catalog.cardinality(p.pages) > 0 and p.pages <@ covered)
            or (pg_catalog.cardinality(p.pages) = 0 and unit_pages <@ covered)))
          or p.id = any(page_replaced));
      -- A DPGF line of the item where the DPGF line an earlier send fed was deleted: the parts left live on that target
      -- leave with this send (kept in their history), never live beside the new ones, as a recreated new line retires its.
      if target #>> '{line,kind}' = 'dpgf_line' then
        target_replaced := target_replaced || coalesce((select pg_catalog.array_agg(p.id order by p.id)
          from public.takeoff_item_send_parts as p join public.takeoff_item_send_targets as t on t.id = p.target_id
          where t.version_id = target_version and t.item_id = (target ->> 'item_id')::uuid and t.breakdown = 'dpgf'
            and t.compartment_key = 'dpgf' and t.estimate_item_id is null and p.state = 'live'), '{}'::uuid[]);
      end if;
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
            and (p.kind <> 'verified_count' or r.value -> 'quantity' = pg_catalog.to_jsonb(p.quantity))
            and array(select private.takeoff_uuid_or_null(o.value) from pg_catalog.jsonb_array_elements(r.value -> 'observation_ids') as o(value)
              order by 1) = array(select o from pg_catalog.unnest(p.observation_ids) as o order by o))) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'earlier_send_changed', 'item_id', target ->> 'item_id')::text;
    end if;
    -- Never counted twice: this plan's earlier part of the item lies on this target only (elsewhere it would stay).
    if exists (select 1 from public.takeoff_item_send_parts as p
        join public.takeoff_item_send_targets as t on t.id = p.target_id
          and (t.estimate_item_id is not null or ((p.kind = 'verified_count' or incoming_count is not null)
            and not (p.id = any(target_replaced))))
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
  -- The page contributions the plan shows are those of the parts it writes, page by page, each whole: its items, its
  -- targets and its observations, derived from the parts read again above, never the caller's.
  if (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('page', derived.page, 'item_ids', derived.items,
          'target_keys', derived.keys, 'observation_ids', derived.observations) order by derived.page), '[]'::jsonb)
      from (select page.value as page,
          pg_catalog.to_jsonb(pg_catalog.array_agg(distinct (t.value ->> 'item_id')::uuid order by (t.value ->> 'item_id')::uuid))
            as items,
          pg_catalog.to_jsonb(pg_catalog.array_agg(distinct t.value ->> 'key' order by t.value ->> 'key')) as keys,
          pg_catalog.to_jsonb(coalesce((select pg_catalog.array_agg(o.id order by o.id) from (
              select private.takeoff_uuid_or_null(observation.value) as id
              from pg_catalog.jsonb_array_elements(plan -> 'targets') as t2(value)
              cross join lateral pg_catalog.jsonb_array_elements(t2.value -> 'contributions') as c2(value)
              cross join lateral pg_catalog.jsonb_array_elements(c2.value -> 'observation_ids') as observation(value)
              where c2.value -> 'pages' @> pg_catalog.jsonb_build_array(page.value)) as o), '{}'::uuid[])) as observations
        from pg_catalog.jsonb_array_elements(plan -> 'targets') as t(value)
        cross join lateral pg_catalog.jsonb_array_elements(t.value -> 'contributions') as c(value)
        cross join lateral pg_catalog.jsonb_array_elements(c.value -> 'pages') as g(value)
        cross join lateral (select (g.value #>> '{}')::integer as value) as page
        group by page.value) as derived)
    is distinct from (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('page', (listed.value ->> 'page')::integer,
          'item_ids', pg_catalog.to_jsonb(array(select private.takeoff_uuid_or_null(i.value)
            from pg_catalog.jsonb_array_elements(listed.value -> 'item_ids') as i(value) order by 1)),
          'target_keys', pg_catalog.to_jsonb(array(select k.value #>> '{}'
            from pg_catalog.jsonb_array_elements(listed.value -> 'target_keys') as k(value) order by 1)),
          'observation_ids', pg_catalog.to_jsonb(array(select private.takeoff_uuid_or_null(o.value)
            from pg_catalog.jsonb_array_elements(listed.value -> 'observation_ids') as o(value) order by 1)))
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
        and (stored.value ->> 'kind' <> 'measured'
          or pg_catalog.jsonb_build_array(stored.value -> 'observation_id') = c.value -> 'observation_ids')
    loop
      insert into public.takeoff_item_send_parts (tenant_id, project_id, version_id, target_id, receipt_id, job_id, item_id,
        plan_logical_id, kind, answer_id, answer_revision, decision_revision, marks_revision, entry_id, entry_revision, observation_ids,
        takeoff_item_ids, quantity, unit, unit_code, basis, network, material, diameter, pages)
      values (tenant, job.project_id, target_version, live_target_id, this_receipt, target_job_id, (target ->> 'item_id')::uuid,
        (part.stored ->> 'plan_logical_id')::uuid, part.stored ->> 'kind', (part.stored ->> 'answer_id')::uuid,
        part.stored ->> 'answer_revision', (part.stored ->> 'decision_revision')::integer, (part.stored ->> 'marks_revision')::integer,
        private.takeoff_uuid_or_null(part.stored -> 'entry_id'), (part.stored ->> 'entry_revision')::integer,
        case when part.stored ->> 'kind' = 'measured' then array[(part.stored ->> 'observation_id')::uuid] else '{}'::uuid[] end,
        case when part.stored ->> 'kind' = 'measured' then array[(part.stored ->> 'takeoff_item_id')::uuid]
          when part.stored ->> 'kind' = 'verified_count' then array(select x::uuid from
            pg_catalog.jsonb_array_elements_text(part.stored -> 'takeoff_item_ids') x)
          else '{}'::uuid[] end,
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

create or replace function private.takeoff_item_send_carry_copy(p_source_version_id uuid, p_copy_version_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  line_map jsonb;
  target_map jsonb;
  part_map jsonb;
  receipt_map jsonb;
  previous_writer text;
begin
  -- A version no send by item fed: two indexed reads that find no row. A version whose fed lines are all gone may still
  -- own the sections its sends created: they are carried.
  if not exists (select 1 from public.takeoff_item_send_targets as target
      where target.version_id = p_source_version_id and target.estimate_item_id is not null)
    and not exists (select 1 from public.takeoff_item_send_sections as section
      where section.version_id = p_source_version_id and section.estimate_item_id is not null) then
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

  -- A receipt « copy » names no job and no intention key (it is no send); its documents keep, as a record, the receipt,
  -- the job and the version it was copied from, which may be deleted later without touching the copy.
  insert into public.takeoff_item_send_receipts (id, tenant_id, project_id, job_id, version_id, request_id, command_kind,
    format_version, actor_id, plan_sha256, version_created, write_plan, result, copied_from_receipt_id)
  select (receipt_map ->> receipt.id::text)::uuid, receipt.tenant_id, receipt.project_id, null, p_copy_version_id,
    null, 'copy', 1, coalesce((select auth.uid()), receipt.actor_id), receipt.plan_sha256, false,
    pg_catalog.jsonb_build_object('copied_from_receipt_id', receipt.id, 'source_version_id', p_source_version_id,
      'source_job_id', coalesce(receipt.job_id::text, receipt.write_plan ->> 'source_job_id')),
    pg_catalog.jsonb_build_object('copied_from_receipt_id', receipt.id, 'source_version_id', p_source_version_id,
      'source_job_id', coalesce(receipt.job_id::text, receipt.write_plan ->> 'source_job_id'), 'version_id', p_copy_version_id),
    receipt.id
  from public.takeoff_item_send_receipts as receipt
  where receipt.version_id = p_source_version_id and receipt_map ? receipt.id::text;

  insert into public.takeoff_item_send_targets (id, tenant_id, project_id, version_id, item_id, breakdown, compartment_key,
    estimate_item_id, line_kind, unit_code, basis, network, material, diameter, created_by_receipt_id)
  select (target_map ->> target.id::text)::uuid, target.tenant_id, target.project_id, p_copy_version_id, target.item_id,
    target.breakdown, target.compartment_key, (line_map ->> target.estimate_item_id::text)::uuid, target.line_kind,
    target.unit_code, target.basis, target.network, target.material, target.diameter,
    (receipt_map ->> target.created_by_receipt_id::text)::uuid
  from public.takeoff_item_send_targets as target
  where target.version_id = p_source_version_id and target_map ? target.id::text;

  insert into public.takeoff_item_send_parts (id, tenant_id, project_id, version_id, target_id, receipt_id, job_id, item_id,
    plan_logical_id, kind, answer_id, answer_revision, decision_revision, entry_id, entry_revision, observation_ids,
    takeoff_item_ids, quantity, unit, unit_code, basis, network, material, diameter, pages, marks_revision, copied_from_part_id)
  select (part_map ->> part.id::text)::uuid, part.tenant_id, part.project_id, p_copy_version_id,
    (target_map ->> part.target_id::text)::uuid, (receipt_map ->> part.receipt_id::text)::uuid, part.job_id, part.item_id,
    part.plan_logical_id, part.kind, part.answer_id, part.answer_revision, part.decision_revision, part.entry_id,
    part.entry_revision, part.observation_ids, part.takeoff_item_ids, part.quantity, part.unit, part.unit_code, part.basis,
    part.network, part.material, part.diameter, part.pages, part.marks_revision, part.id
  from public.takeoff_item_send_parts as part
  where part.version_id = p_source_version_id and part_map ? part.id::text;

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

commit;
