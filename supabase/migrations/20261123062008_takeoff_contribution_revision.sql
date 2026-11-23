-- Correct the working proof of a sent analysis under the member's rights.
begin;
set local lock_timeout = '5s';

-- The original send alone can satisfy the analysis's first-success index.
-- A revision and the receipt it amends must belong to the same draft.
lock table public.takeoff_item_send_receipts in access exclusive mode nowait;
alter table public.takeoff_item_send_receipts
  add column amends_receipt_id uuid,
  add constraint takeoff_item_revision_parent_fkey foreign key (amends_receipt_id,tenant_id,project_id,version_id)
    references public.takeoff_item_send_receipts(id,tenant_id,project_id,version_id) deferrable initially deferred,
  drop constraint takeoff_item_send_receipts_command_kind_check,
  drop constraint takeoff_item_send_receipts_send_identity_check,
  add constraint takeoff_item_send_receipts_command_kind_check check (command_kind in ('send','copy','redistribute','revise')),
  add constraint takeoff_item_send_receipts_send_identity_check check (
    (command_kind='send' and job_id is not null and request_id is not null)
    or (command_kind='copy' and job_id is null and request_id is null)
    or (command_kind in ('redistribute','revise') and job_id is null and request_id is not null)),
  add constraint takeoff_item_revision_parent_check check ((command_kind='revise')=(amends_receipt_id is not null)
    and amends_receipt_id is distinct from id);
create unique index takeoff_item_revision_parent_key on public.takeoff_item_send_receipts(amends_receipt_id)
  where amends_receipt_id is not null;
comment on column public.takeoff_item_send_receipts.amends_receipt_id is
  'The immediately preceding local receipt of a confirmed revision. A copied receipt and its intermediate drafts have independent histories.';

-- Version-local receipts and the inherited analysis link each prove a different fact:
-- this is the copy that received the parts, and this analysis belongs to it.
create function private.takeoff_revision_scope(p_tenant uuid,p_project uuid,p_version uuid,p_receipt uuid)
returns uuid language plpgsql stable set search_path='' as $$
declare
  draft public.estimate_versions;
  receipt public.takeoff_item_send_receipts;
  analysis uuid;
begin
  select * into draft from public.estimate_versions v
    where (v.tenant_id,v.project_id,v.id)=(p_tenant,p_project,p_version);
  select * into receipt from public.takeoff_item_send_receipts r
    where (r.tenant_id,r.project_id,r.version_id,r.id)=(p_tenant,p_project,p_version,p_receipt);
  analysis := case receipt.command_kind when 'send' then receipt.job_id
    when 'copy' then case when receipt.copied_from_receipt_id is not null
      and receipt.write_plan->>'copied_from_receipt_id'=receipt.copied_from_receipt_id::text
      then private.takeoff_uuid_or_null(receipt.write_plan->'source_job_id') end
    when 'revise' then private.takeoff_uuid_or_null(receipt.write_plan->'source_job_id') end;
  if analysis is null or draft.id is null or not public.estimate_version_holds_analysis(p_tenant,p_version,analysis)
    or not exists(select 1 from public.takeoff_jobs j where j.id=analysis and j.tenant_id=p_tenant
      and j.project_id=p_project and j.status='applied') then
    raise exception 'TAKEOFF_REVISION_SCOPE' using errcode='42501';
  end if;
  if draft.status is distinct from 'draft' or draft.seal_hash is not null then
    raise exception 'TAKEOFF_REVISION_SEALED' using errcode='55000';
  end if;
  if draft.calc_engine_version is distinct from 3 then
    raise exception 'TAKEOFF_REVISION_ENGINE' using errcode='22023';
  end if;
  return analysis;
end;
$$;
revoke all on function private.takeoff_revision_scope(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- A copy carries the head even when a previous correction left no live part.
-- The other copied receipts of that analysis remain history.
create function private.takeoff_revision_require_head(p_receipt uuid)
returns void language plpgsql stable set search_path='' as $$
begin
  if exists(select 1 from public.takeoff_item_send_receipts r where r.id=p_receipt and r.write_plan->'revision_head'='false')
    or exists(select 1 from public.takeoff_item_send_receipts successor where successor.amends_receipt_id=p_receipt) then
    raise exception 'TAKEOFF_REVISION_STALE' using errcode='40001';
  end if;
end;
$$;
revoke all on function private.takeoff_revision_require_head(uuid) from public,anon,authenticated,service_role;

-- The gesture implementation of the acceptance/marks migration. Both member doors
-- use the same coordinate, attribution, duplicate, verification and replay checks.
create function private.edit_takeoff_marks_in_scope(p_tenant_id uuid, p_project_id uuid, p_intent_key uuid,
  p_revisions jsonb, p_gestures jsonb, p_version uuid, p_receipt uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  revision_job uuid;
  expected jsonb;
  digest text;
  existing public.takeoff_count_mark_commands%rowtype;
  this_command uuid := pg_catalog.gen_random_uuid();
  named uuid[];
  locked integer;
  this_answer public.takeoff_item_answers%rowtype;
  target_answer public.takeoff_item_answers%rowtype;
  answer_state public.takeoff_count_answer_states%rowtype;
  held jsonb := '{}'::jsonb;
  changed jsonb := '{}'::jsonb;
  added jsonb := '[]'::jsonb;
  this_gesture jsonb;
  op text;
  this_mark public.takeoff_count_marks%rowtype;
  this_attribution public.takeoff_count_mark_attributions%rowtype;
  other_attribution public.takeoff_count_mark_attributions%rowtype;
  this_page uuid;
  page_number integer;
  new_mark uuid;
  new_box numeric[];
  touched uuid;
  next_revision integer;
  answers_revisions jsonb;
  receipt jsonb;
  twins uuid[];
  gesture_n integer := 0;
begin
  -- The answers' identifiers as the database writes them (a client may send capitals).
  expected := case when pg_catalog.jsonb_typeof(p_revisions) = 'object' then (select pg_catalog.jsonb_object_agg(lower(r.key),
    r.value) from pg_catalog.jsonb_each(p_revisions) r(key, value)) end;
  if actor is null or p_tenant_id is null or p_project_id is null or p_intent_key is null or expected is null
    or (select count(*) from pg_catalog.jsonb_object_keys(expected)) <> (select count(*) from pg_catalog.jsonb_object_keys(p_revisions))
    or not coalesce(private.takeoff_count_mark_edit_well_formed(expected, p_gestures), false) then
    raise exception 'TAKEOFF_MARKS_INVALID' using errcode = '22023';
  end if;
  -- The right proceeds only when it is true: an operator without an active tenant (suspended) gets a null predicate.
  if private.can_access_takeoff_scope(p_tenant_id, p_project_id, null, true) is not true then
    raise exception 'TAKEOFF_MARKS_FORBIDDEN' using errcode = '42501';
  end if;
  digest := private.takeoff_sha256(pg_catalog.jsonb_build_object('project_id', p_project_id, 'revisions', expected,
    'gestures', p_gestures));
  named := array(select k::uuid from pg_catalog.jsonb_object_keys(expected) k order by 1);

  -- Locks, in the takeoff order: the affaire (key share), the answers (key share), their marks states (for update), the
  -- new pages of evidence the adds name (created in one order: plan, digest, page, the publication's too), then the marks
  -- the gestures name (for update), each set in identifier order.
  perform 1 from public.estimate_projects p where p.id = p_project_id and p.tenant_id = p_tenant_id for key share;
  if not found then
    raise exception 'TAKEOFF_MARKS_ANSWER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_receipt is not null then
    perform 1 from public.estimate_versions v where v.id=p_version and v.tenant_id=p_tenant_id
      and v.project_id=p_project_id for share;
    revision_job := private.takeoff_revision_scope(p_tenant_id,p_project_id,p_version,p_receipt);
    digest := private.takeoff_sha256(jsonb_build_array(digest,p_version,p_receipt));
  end if;
  -- The jobs of the answers named, for share, in identifier order (rank 5, the job, as the publication takes its job): a
  -- send of one of their plans updates its job's row, so it waits for this edit to end, or this edit waits for the send
  -- and then reads its plan sent (below, under these locks).
  perform 1 from (select j.id from public.takeoff_jobs j
    where j.tenant_id = p_tenant_id and j.id in (select a.job_id from public.takeoff_item_answers a
      where a.id = any (named) and a.tenant_id = p_tenant_id and a.project_id = p_project_id)
    order by j.id for share) s;
  select count(*) into locked from (select a.id from public.takeoff_item_answers a
    where a.id = any (named) and a.tenant_id = p_tenant_id and a.project_id = p_project_id order by a.id for key share) s;
  if locked <> pg_catalog.cardinality(named) then
    raise exception 'TAKEOFF_MARKS_ANSWER_NOT_FOUND' using errcode = 'P0002';
  end if;
  for this_answer in select a.* from public.takeoff_item_answers a where a.id = any (named) order by a.id loop
    insert into public.takeoff_count_answer_states (answer_id, tenant_id, project_id, revision, member_edited)
    values (this_answer.id, this_answer.tenant_id, this_answer.project_id, 0, false) on conflict (answer_id) do nothing;
    select s.* into answer_state from public.takeoff_count_answer_states s where s.answer_id = this_answer.id for update;
    held := held || pg_catalog.jsonb_build_object(this_answer.id::text, answer_state.revision);
  end loop;
  for this_gesture in select x.gesture from (
      select distinct on (a.plan_logical_id, a.plan_content_sha256, (g.value ->> 'page')::numeric::integer) g.value as gesture,
        a.plan_logical_id, a.plan_content_sha256, (g.value ->> 'page')::numeric::integer as page
      from pg_catalog.jsonb_array_elements(p_gestures) with ordinality g(value, n)
      join public.takeoff_item_answers a on a.id = (g.value ->> 'answer_id')::uuid
      where g.value ->> 'op' = 'add'
      order by a.plan_logical_id, a.plan_content_sha256, (g.value ->> 'page')::numeric::integer,
        coalesce(pg_catalog.jsonb_typeof(g.value -> 'geometry') = 'object', false) desc, g.n) x
    order by x.plan_logical_id, x.plan_content_sha256, x.page
  loop
    select a.* into this_answer from public.takeoff_item_answers a where a.id = (this_gesture ->> 'answer_id')::uuid;
    perform private.takeoff_count_page_for(this_answer, (this_gesture ->> 'page')::numeric::integer,
      case when pg_catalog.jsonb_typeof(this_gesture -> 'geometry') = 'object' then this_gesture -> 'geometry' end);
  end loop;
  select count(*) into locked from (select m.id from public.takeoff_count_marks m
    where m.tenant_id = p_tenant_id and m.project_id = p_project_id
      and m.id in (select (g.value ->> 'mark_id')::uuid from pg_catalog.jsonb_array_elements(p_gestures) g(value)
          where pg_catalog.jsonb_typeof(g.value -> 'mark_id') = 'string'
        union select (g.value ->> 'same_as')::uuid from pg_catalog.jsonb_array_elements(p_gestures) g(value)
          where pg_catalog.jsonb_typeof(g.value -> 'same_as') = 'string')
    order by m.id for update) s;

  -- The right once more, after the last wait (the locks above, a page another command was creating) and before anything
  -- is answered or written: a member who lost it meanwhile reads no receipt and writes nothing. No wait follows.
  if private.can_access_takeoff_scope(p_tenant_id, p_project_id, null, true) is not true then
    raise exception 'TAKEOFF_MARKS_FORBIDDEN' using errcode = '42501';
  end if;
  if p_receipt is not null then
    if private.takeoff_revision_scope(p_tenant_id,p_project_id,p_version,p_receipt) is distinct from revision_job
      or exists(select 1 from public.takeoff_item_answers a where a.id=any(named)
        and (a.job_id is distinct from revision_job or a.project_id is distinct from p_project_id)) then
      raise exception 'TAKEOFF_REVISION_SCOPE' using errcode='42501';
    end if;
  end if;
  -- The same intention again: its receipt as its command committed it (its revisions and its counts then), once that
  -- command (which held these rows) has committed.
  select c.* into existing from public.takeoff_count_mark_commands c
  where c.tenant_id = p_tenant_id and c.kind = 'edit' and c.intent_key = p_intent_key;
  if found then
    if existing.actor_id is distinct from actor or existing.project_id is distinct from p_project_id
      or existing.content_sha256 is distinct from digest then
      raise exception 'TAKEOFF_MARKS_INTENT_CONFLICT' using errcode = '23505';
    end if;
    return existing.result || pg_catalog.jsonb_build_object('replayed', true);
  end if;

  -- A plan already sent to an estimate is read-only, under the jobs' locks and after the replay above (a replay of an
  -- intention answers its receipt whatever happened since): a correction after a send is a revision of its
  -- contribution, never this command.
  if p_receipt is null and exists (select 1 from public.takeoff_item_answers a
      join public.takeoff_jobs j on j.id = a.job_id and j.tenant_id = a.tenant_id
      where a.id = any (named) and j.status = 'applied') then
    raise exception 'TAKEOFF_MARKS_PLAN_SENT' using errcode = '55000';
  end if;
  -- The answers current; the revisions expected.
  if p_receipt is not null then perform private.takeoff_revision_require_head(p_receipt); end if;
  for this_answer in select a.* from public.takeoff_item_answers a where a.id = any (named) order by a.id loop
    if not private.takeoff_count_answer_is_current(this_answer) then
      raise exception 'TAKEOFF_MARKS_ANSWER_REPLACED' using errcode = '22023';
    end if;
  end loop;
  if exists (select 1 from pg_catalog.jsonb_each(expected) r(key, value)
      where (held ->> r.key)::integer is distinct from (r.value #>> '{}')::numeric::integer) then
    raise exception 'TAKEOFF_MARKS_REVISION_CONFLICT' using errcode = '40001';
  end if;

  for this_gesture in select pg_catalog.jsonb_strip_nulls(g.value) from pg_catalog.jsonb_array_elements(p_gestures)
    with ordinality g(value, n) order by g.n
  loop
    gesture_n := gesture_n + 1;
    op := this_gesture ->> 'op';
    if this_gesture ? 'answer_id' then
      select a.* into this_answer from public.takeoff_item_answers a where a.id = (this_gesture ->> 'answer_id')::uuid;
    end if;
    if this_gesture ? 'mark_id' then
      select m.* into this_mark from public.takeoff_count_marks m
      where m.id = (this_gesture ->> 'mark_id')::uuid and m.tenant_id = p_tenant_id and m.project_id = p_project_id;
      if not found then
        raise exception 'TAKEOFF_MARKS_MARK_NOT_FOUND' using errcode = 'P0002';
      end if;
      select g.page into page_number from public.takeoff_count_pages g where g.id = this_mark.page_id;
    end if;
    if op in ('remove', 'restore', 'retain', 'reattribute') then
      select t.* into this_attribution from public.takeoff_count_mark_attributions t
      where t.mark_id = this_mark.id and t.answer_id = this_answer.id;
      -- A mark of a pending generation of this answer is only retained.
      if not found and (op <> 'retain' or not exists (select 1 from public.takeoff_count_mark_proposals p
          where p.mark_id = this_mark.id and p.answer_id = this_answer.id)) then
        raise exception 'TAKEOFF_MARKS_MARK_NOT_FOUND' using errcode = 'P0002';
      end if;
    end if;
    next_revision := (held ->> this_answer.id::text)::integer + 1;

    if op = 'add' then
      page_number := (this_gesture ->> 'page')::numeric::integer;
      this_page := private.takeoff_count_page_for(this_answer, page_number, this_gesture -> 'geometry');
      new_mark := pg_catalog.gen_random_uuid();
      new_box := private.takeoff_count_mark_box(this_gesture -> 'box');
      -- A new retained mark on the same object as a retained one of the answer (within 4 points, this edit's earlier adds
      -- included) needs « distinct object »: adding the same object again is not adding.
      twins := private.takeoff_count_retained_twins(this_page, (this_gesture ->> 'x')::numeric, (this_gesture ->> 'y')::numeric,
        this_answer.id, null);
      if pg_catalog.cardinality(twins) > 0 and this_gesture ->> 'object' is distinct from 'distinct' then
        raise exception 'TAKEOFF_MARKS_OBJECT_DUPLICATE' using errcode = '23505',
          detail = private.takeoff_count_duplicate_detail(gesture_n, twins, added)::text;
      end if;
      insert into public.takeoff_count_marks (id, tenant_id, project_id, page_id, origin, x, y, box, position_revision,
        created_by)
      values (new_mark, p_tenant_id, p_project_id, this_page, 'manual', (this_gesture ->> 'x')::numeric,
        (this_gesture ->> 'y')::numeric, new_box, 1, actor);
      insert into public.takeoff_count_mark_attributions (mark_id, answer_id, tenant_id, project_id, page_id, state,
        decided_by, decided_at)
      values (new_mark, this_answer.id, p_tenant_id, p_project_id, this_page, 'retained', actor, pg_catalog.clock_timestamp());
      perform private.takeoff_count_record_distinct(this_answer, new_mark, twins, actor);
      added := added || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('key', lower(this_gesture ->> 'key'),
        'mark_id', new_mark));
      changed := changed || pg_catalog.jsonb_build_object(this_answer.id::text, true);
      perform private.takeoff_count_mark_event(this_command, p_tenant_id, p_project_id, this_answer.id, next_revision, 'add',
        new_mark, page_number, null, pg_catalog.jsonb_build_object('state', 'retained', 'x', (this_gesture ->> 'x')::numeric,
          'y', (this_gesture ->> 'y')::numeric, 'box', pg_catalog.to_jsonb(new_box))
          || case when this_gesture ? 'object' then pg_catalog.jsonb_build_object('object', this_gesture ->> 'object')
            else '{}'::jsonb end, null, null, actor);
    elsif op = 'move' then
      new_box := private.takeoff_count_mark_box(this_gesture -> 'box');
      -- Every answer the mark is attributed to changes: each must be named (and is then current). A mark no answer holds
      -- (a pending generation's) is retained before it is moved.
      if not exists (select 1 from public.takeoff_count_mark_attributions t where t.mark_id = this_mark.id) then
        raise exception 'TAKEOFF_MARKS_STATE_INVALID' using errcode = '22023';
      end if;
      if exists (select 1 from public.takeoff_count_mark_attributions t where t.mark_id = this_mark.id
          and not expected ? t.answer_id::text) then
        raise exception 'TAKEOFF_MARKS_REVISION_CONFLICT' using errcode = '40001';
      end if;
      -- At its new place, the mark must not stand on the object of another retained mark of any answer that retains it,
      -- without « distinct object ».
      if this_gesture ->> 'object' is distinct from 'distinct' and exists (select 1
          from public.takeoff_count_mark_attributions t where t.mark_id = this_mark.id and t.state = 'retained'
            and pg_catalog.cardinality(private.takeoff_count_retained_twins(this_mark.page_id, (this_gesture ->> 'x')::numeric,
              (this_gesture ->> 'y')::numeric, t.answer_id, this_mark.id)) > 0) then
        raise exception 'TAKEOFF_MARKS_OBJECT_DUPLICATE' using errcode = '23505',
          detail = private.takeoff_count_duplicate_detail(gesture_n, array(select distinct x
            from public.takeoff_count_mark_attributions t,
              pg_catalog.unnest(private.takeoff_count_retained_twins(this_mark.page_id, (this_gesture ->> 'x')::numeric,
                (this_gesture ->> 'y')::numeric, t.answer_id, this_mark.id)) x
            where t.mark_id = this_mark.id and t.state = 'retained'), added)::text;
      end if;
      update public.takeoff_count_marks m set x = (this_gesture ->> 'x')::numeric, y = (this_gesture ->> 'y')::numeric,
        box = new_box, position_revision = m.position_revision + 1, moved_by = actor, moved_at = pg_catalog.clock_timestamp()
      where m.id = this_mark.id;
      for touched in select t.answer_id from public.takeoff_count_mark_attributions t where t.mark_id = this_mark.id
        order by t.answer_id
      loop
        changed := changed || pg_catalog.jsonb_build_object(touched::text, true);
        if exists (select 1 from public.takeoff_count_mark_attributions t where t.mark_id = this_mark.id
            and t.answer_id = touched and t.state = 'retained') then
          select a.* into target_answer from public.takeoff_item_answers a where a.id = touched;
          perform private.takeoff_count_record_distinct(target_answer, this_mark.id, private.takeoff_count_retained_twins(
            this_mark.page_id, (this_gesture ->> 'x')::numeric, (this_gesture ->> 'y')::numeric, touched, this_mark.id), actor);
        end if;
        perform private.takeoff_count_mark_event(this_command, p_tenant_id, p_project_id, touched,
          (held ->> touched::text)::integer + 1, 'move', this_mark.id, page_number,
          pg_catalog.jsonb_build_object('x', this_mark.x, 'y', this_mark.y, 'box', pg_catalog.to_jsonb(this_mark.box)),
          pg_catalog.jsonb_build_object('x', (this_gesture ->> 'x')::numeric, 'y', (this_gesture ->> 'y')::numeric,
            'box', pg_catalog.to_jsonb(new_box))
            || case when this_gesture ? 'object' then pg_catalog.jsonb_build_object('object', this_gesture ->> 'object')
              else '{}'::jsonb end, null, null, actor);
      end loop;
    elsif op = 'remove' then
      if this_attribution.state not in ('proposed', 'to_attribute', 'retained') then
        raise exception 'TAKEOFF_MARKS_STATE_INVALID' using errcode = '22023';
      end if;
      update public.takeoff_count_mark_attributions t set state = 'removed', prior_state = this_attribution.state,
        reason_code = this_gesture ->> 'reason', reason_text = this_gesture ->> 'note', decided_by = actor,
        decided_at = pg_catalog.clock_timestamp()
      where t.mark_id = this_mark.id and t.answer_id = this_answer.id;
      changed := changed || pg_catalog.jsonb_build_object(this_answer.id::text, true);
      perform private.takeoff_count_mark_event(this_command, p_tenant_id, p_project_id, this_answer.id, next_revision,
        'remove', this_mark.id, page_number, pg_catalog.jsonb_build_object('state', this_attribution.state),
        pg_catalog.jsonb_build_object('state', 'removed'), this_gesture ->> 'reason', this_gesture ->> 'note', actor);
    elsif op = 'restore' then
      if this_attribution.state <> 'removed' then
        raise exception 'TAKEOFF_MARKS_STATE_INVALID' using errcode = '22023';
      end if;
      if this_gesture ->> 'object' = 'same' then
        -- « Same object »: the removed mark is the retained one it names; its proposals for this answer join that mark,
        -- and it stays removed, for that reason.
        if not private.takeoff_count_mark_is_twin_of(this_mark, this_answer.id, (this_gesture ->> 'same_as')::uuid) then
          raise exception 'TAKEOFF_MARKS_STATE_INVALID' using errcode = '22023';
        end if;
        update public.takeoff_count_mark_proposals q set mark_id = (this_gesture ->> 'same_as')::uuid
        where q.mark_id = this_mark.id and q.answer_id = this_answer.id;
        update public.takeoff_count_mark_attributions t set reason_code = 'same_object', reason_text = null, decided_by = actor,
          decided_at = pg_catalog.clock_timestamp()
        where t.mark_id = this_mark.id and t.answer_id = this_answer.id;
        changed := changed || pg_catalog.jsonb_build_object(this_answer.id::text, true);
        perform private.takeoff_count_mark_event(this_command, p_tenant_id, p_project_id, this_answer.id, next_revision,
          'same_object', this_mark.id, page_number,
          pg_catalog.jsonb_build_object('state', 'removed', 'reason', this_attribution.reason_code),
          pg_catalog.jsonb_build_object('state', 'removed', 'object', 'same', 'same_as', (this_gesture ->> 'same_as')::uuid),
          'same_object', null, actor, private.takeoff_count_mark_evidence((this_gesture ->> 'same_as')::uuid));
      else
        if this_attribution.prior_state = 'retained' and exists (select 1 from public.takeoff_count_mark_attributions t
            where t.mark_id = this_mark.id and t.answer_id <> this_answer.id and t.state = 'retained') then
          raise exception 'TAKEOFF_MARKS_ATTRIBUTION_TAKEN' using errcode = '23505';
        end if;
        -- Back to retained beside a retained mark of the same object: the member says which it is (« distinct object »
        -- here, « same object » above).
        if this_attribution.prior_state = 'retained' and this_gesture ->> 'object' is distinct from 'distinct'
          and private.takeoff_count_mark_has_twin(this_mark, this_answer.id) then
          raise exception 'TAKEOFF_MARKS_OBJECT_DUPLICATE' using errcode = '23505',
            detail = private.takeoff_count_duplicate_detail(gesture_n, private.takeoff_count_retained_twins(this_mark.page_id,
              this_mark.x, this_mark.y, this_answer.id, this_mark.id), added)::text;
        end if;
        update public.takeoff_count_mark_attributions t set state = this_attribution.prior_state, prior_state = null,
          reason_code = null, reason_text = null, decided_by = actor, decided_at = pg_catalog.clock_timestamp()
        where t.mark_id = this_mark.id and t.answer_id = this_answer.id;
        if this_attribution.prior_state = 'retained' then
          perform private.takeoff_count_record_distinct(this_answer, this_mark.id, private.takeoff_count_retained_twins(
            this_mark.page_id, this_mark.x, this_mark.y, this_answer.id, this_mark.id), actor);
        end if;
        changed := changed || pg_catalog.jsonb_build_object(this_answer.id::text, true);
        perform private.takeoff_count_mark_event(this_command, p_tenant_id, p_project_id, this_answer.id, next_revision,
          'restore', this_mark.id, page_number,
          pg_catalog.jsonb_build_object('state', 'removed', 'reason', this_attribution.reason_code),
          pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('state', this_attribution.prior_state,
            'object', this_gesture ->> 'object')), null, null, actor,
          case when this_attribution.prior_state = 'retained' then private.takeoff_count_mark_evidence(this_mark.id) end);
      end if;
    elsif op = 'retain' then
      if this_attribution.mark_id is not null and this_attribution.state not in ('proposed', 'to_attribute') then
        raise exception 'TAKEOFF_MARKS_STATE_INVALID' using errcode = '22023';
      end if;
      if this_gesture ->> 'object' = 'same' then
        -- « Same object »: the mark is the retained one it names; its proposals for this answer join that mark, and it is
        -- withdrawn for the answer (removed, for that reason, if a generation had attributed it).
        if not private.takeoff_count_mark_is_twin_of(this_mark, this_answer.id, (this_gesture ->> 'same_as')::uuid) then
          raise exception 'TAKEOFF_MARKS_STATE_INVALID' using errcode = '22023';
        end if;
        update public.takeoff_count_mark_proposals q set mark_id = (this_gesture ->> 'same_as')::uuid
        where q.mark_id = this_mark.id and q.answer_id = this_answer.id;
        if this_attribution.mark_id is not null then
          update public.takeoff_count_mark_attributions t set state = 'removed', prior_state = this_attribution.state,
            reason_code = 'same_object', reason_text = null, decided_by = actor, decided_at = pg_catalog.clock_timestamp()
          where t.mark_id = this_mark.id and t.answer_id = this_answer.id;
        end if;
        changed := changed || pg_catalog.jsonb_build_object(this_answer.id::text, true);
        perform private.takeoff_count_mark_event(this_command, p_tenant_id, p_project_id, this_answer.id, next_revision,
          'same_object', this_mark.id, page_number,
          pg_catalog.jsonb_build_object('state', coalesce(this_attribution.state, 'pending')),
          pg_catalog.jsonb_build_object('state', 'withdrawn', 'object', 'same', 'same_as', (this_gesture ->> 'same_as')::uuid),
          'same_object', null, actor, private.takeoff_count_mark_evidence((this_gesture ->> 'same_as')::uuid));
      else
        if exists (select 1 from public.takeoff_count_mark_attributions t
            where t.mark_id = this_mark.id and t.answer_id <> this_answer.id and t.state = 'retained') then
          raise exception 'TAKEOFF_MARKS_ATTRIBUTION_TAKEN' using errcode = '23505';
        end if;
        -- Beside a retained mark of the same object (within 4 points): the member says which it is.
        if this_gesture ->> 'object' is distinct from 'distinct'
          and private.takeoff_count_mark_has_twin(this_mark, this_answer.id) then
          raise exception 'TAKEOFF_MARKS_OBJECT_DUPLICATE' using errcode = '23505',
            detail = private.takeoff_count_duplicate_detail(gesture_n, private.takeoff_count_retained_twins(this_mark.page_id,
              this_mark.x, this_mark.y, this_answer.id, this_mark.id), added)::text;
        end if;
        insert into public.takeoff_count_mark_attributions (mark_id, answer_id, tenant_id, project_id, page_id, state,
          decided_by, decided_at)
        values (this_mark.id, this_answer.id, p_tenant_id, p_project_id, this_mark.page_id, 'retained', actor,
          pg_catalog.clock_timestamp())
        on conflict (mark_id, answer_id) do update set state = 'retained', decided_by = excluded.decided_by,
          decided_at = excluded.decided_at;
        perform private.takeoff_count_record_distinct(this_answer, this_mark.id, private.takeoff_count_retained_twins(
          this_mark.page_id, this_mark.x, this_mark.y, this_answer.id, this_mark.id), actor);
        changed := changed || pg_catalog.jsonb_build_object(this_answer.id::text, true);
        perform private.takeoff_count_mark_event(this_command, p_tenant_id, p_project_id, this_answer.id, next_revision,
          'retain', this_mark.id, page_number,
          pg_catalog.jsonb_build_object('state', coalesce(this_attribution.state, 'pending')),
          pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('state', 'retained', 'object', this_gesture ->> 'object')),
          null, null, actor, private.takeoff_count_mark_evidence(this_mark.id));
      end if;
    elsif op = 'reattribute' then
      select a.* into target_answer from public.takeoff_item_answers a where a.id = (this_gesture ->> 'to_answer_id')::uuid;
      if this_attribution.state not in ('proposed', 'to_attribute', 'retained') then
        raise exception 'TAKEOFF_MARKS_STATE_INVALID' using errcode = '22023';
      end if;
      if target_answer.id = this_answer.id or target_answer.plan_logical_id <> this_answer.plan_logical_id
        or target_answer.plan_content_sha256 <> this_answer.plan_content_sha256
        or not (page_number = any (private.takeoff_count_answer_scope(target_answer)))
        or (select e.expected_unit from public.takeoff_list_revision_entries e
            where e.revision_id = target_answer.list_revision_id and e.item_id = target_answer.item_id)
          is distinct from (select e.expected_unit from public.takeoff_list_revision_entries e
            where e.revision_id = this_answer.list_revision_id and e.item_id = this_answer.item_id)
        -- The destination is an item of the source answer's sealed order.
        or not exists (select 1 from public.takeoff_list_revision_entries e
          where e.revision_id = this_answer.list_revision_id and e.item_id = target_answer.item_id) then
        raise exception 'TAKEOFF_MARKS_TARGET_INCOMPATIBLE' using errcode = '22023';
      end if;
      if this_gesture ->> 'object' is distinct from 'distinct' and private.takeoff_count_mark_has_twin(this_mark, target_answer.id) then
        raise exception 'TAKEOFF_MARKS_OBJECT_DUPLICATE' using errcode = '23505',
          detail = private.takeoff_count_duplicate_detail(gesture_n, private.takeoff_count_retained_twins(this_mark.page_id,
            this_mark.x, this_mark.y, target_answer.id, this_mark.id), added)::text;
      end if;
      select t.* into other_attribution from public.takeoff_count_mark_attributions t
      where t.mark_id = this_mark.id and t.answer_id = target_answer.id;
      if other_attribution.state = 'retained' then
        raise exception 'TAKEOFF_MARKS_STATE_INVALID' using errcode = '22023';
      end if;
      if exists (select 1 from public.takeoff_count_mark_attributions t where t.mark_id = this_mark.id
          and t.answer_id not in (this_answer.id, target_answer.id) and t.state = 'retained') then
        raise exception 'TAKEOFF_MARKS_ATTRIBUTION_TAKEN' using errcode = '23505';
      end if;
      update public.takeoff_count_mark_attributions t set state = 'removed', prior_state = this_attribution.state,
        reason_code = 'reattributed', reason_text = null, decided_by = actor, decided_at = pg_catalog.clock_timestamp()
      where t.mark_id = this_mark.id and t.answer_id = this_answer.id;
      insert into public.takeoff_count_mark_attributions (mark_id, answer_id, tenant_id, project_id, page_id, state,
        decided_by, decided_at)
      values (this_mark.id, target_answer.id, p_tenant_id, p_project_id, this_mark.page_id, 'retained', actor,
        pg_catalog.clock_timestamp())
      on conflict (mark_id, answer_id) do update set state = 'retained', prior_state = null, reason_code = null,
        reason_text = null, decided_by = excluded.decided_by, decided_at = excluded.decided_at;
      perform private.takeoff_count_record_distinct(target_answer, this_mark.id, private.takeoff_count_retained_twins(
        this_mark.page_id, this_mark.x, this_mark.y, target_answer.id, this_mark.id), actor);
      changed := changed || pg_catalog.jsonb_build_object(this_answer.id::text, true, target_answer.id::text, true);
      perform private.takeoff_count_mark_event(this_command, p_tenant_id, p_project_id, this_answer.id, next_revision,
        'reattribute_out', this_mark.id, page_number, pg_catalog.jsonb_build_object('state', this_attribution.state),
        pg_catalog.jsonb_build_object('state', 'removed', 'to_answer_id', target_answer.id), 'reattributed', null, actor);
      perform private.takeoff_count_mark_event(this_command, p_tenant_id, p_project_id, target_answer.id,
        (held ->> target_answer.id::text)::integer + 1, 'reattribute_in', this_mark.id, page_number,
        pg_catalog.jsonb_build_object('state', coalesce(other_attribution.state, 'none'), 'from_answer_id', this_answer.id),
        pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('state', 'retained', 'object', this_gesture ->> 'object')),
        null, null, actor, private.takeoff_count_mark_evidence(this_mark.id));
    elsif op = 'verify' then
      for page_number in select (p.value #>> '{}')::numeric::integer from pg_catalog.jsonb_array_elements(this_gesture -> 'pages') p(value)
        order by 1
      loop
        if not (page_number = any (private.takeoff_count_answer_scope(this_answer))) then
          raise exception 'TAKEOFF_MARKS_PAGE_OUTSIDE' using errcode = '22023';
        end if;
        if exists (select 1 from public.takeoff_count_mark_attributions t join public.takeoff_count_pages g on g.id = t.page_id
            where t.answer_id = this_answer.id and g.page = page_number and t.state in ('proposed', 'to_attribute')) then
          raise exception 'TAKEOFF_MARKS_UNDECIDED' using errcode = '22023';
        end if;
        insert into public.takeoff_count_answer_pages (answer_id, page, tenant_id, project_id, changed_revision,
          verified_revision, verified_by, verified_at)
        values (this_answer.id, page_number, p_tenant_id, p_project_id, 0, next_revision, actor, pg_catalog.clock_timestamp())
        on conflict (answer_id, page) do update set verified_revision = excluded.verified_revision,
          verified_by = excluded.verified_by, verified_at = excluded.verified_at;
        perform private.takeoff_count_mark_event(this_command, p_tenant_id, p_project_id, this_answer.id, next_revision,
          'verify', null, page_number, null, pg_catalog.jsonb_build_object('retained',
            (select count(*) from public.takeoff_count_mark_attributions t join public.takeoff_count_pages g on g.id = t.page_id
             where t.answer_id = this_answer.id and g.page = page_number and t.state = 'retained')), null, null, actor);
      end loop;
      changed := changed || pg_catalog.jsonb_build_object(this_answer.id::text, true);
    end if;
    this_attribution := null;
    other_attribution := null;
  end loop;

  -- The pages each change reached, for each answer it reached: changed at the answer's new revision (a verification of
  -- this command, after every change, stays current; an earlier one is now older than the change).
  insert into public.takeoff_count_answer_pages (answer_id, page, tenant_id, project_id, changed_revision)
  select distinct e.answer_id, e.page, p_tenant_id, p_project_id, e.revision from public.takeoff_count_mark_events e
  where e.command_id = this_command and e.gesture <> 'verify'
  on conflict (answer_id, page) do update set changed_revision = excluded.changed_revision;
  -- Bounded: at most 20,000 marks on an answer.
  if exists (select 1 from public.takeoff_count_mark_attributions t
      where t.answer_id in (select k::uuid from pg_catalog.jsonb_object_keys(changed) k)
      group by t.answer_id having count(*) > 20000) then
    raise exception 'TAKEOFF_MARKS_LIMIT_EXCEEDED' using errcode = '22023';
  end if;
  -- Each changed answer: one revision more, a member's change, its journal's head.
  update public.takeoff_count_answer_states s set revision = s.revision + 1, member_edited = true,
    last_event_id = (select e.id from public.takeoff_count_mark_events e where e.command_id = this_command
      and e.answer_id = s.answer_id order by e.ordinal desc limit 1),
    updated_at = pg_catalog.clock_timestamp()
  where s.answer_id in (select k::uuid from pg_catalog.jsonb_object_keys(changed) k);

  answers_revisions := coalesce((select pg_catalog.jsonb_object_agg(k, (held ->> k)::integer + 1)
    from pg_catalog.jsonb_object_keys(changed) k), '{}'::jsonb);
  -- The receipt: for each changed answer, its totals and state, and the pages this edit changed (never every page of a
  -- scope), as they are when the command commits.
  receipt := pg_catalog.jsonb_build_object('command_id', this_command, 'revisions', answers_revisions, 'added', added,
    'summaries', coalesce((select pg_catalog.jsonb_object_agg(k, (x.summary - 'pages') || pg_catalog.jsonb_build_object('pages',
        coalesce((select pg_catalog.jsonb_agg(p.value order by (p.value ->> 'page')::integer)
          from pg_catalog.jsonb_array_elements(x.summary -> 'pages') p(value)
          where (p.value ->> 'page')::integer in (select e.page from public.takeoff_count_mark_events e
            where e.command_id = this_command and e.answer_id = k::uuid)), '[]'::jsonb)))
      from pg_catalog.jsonb_object_keys(changed) k
      cross join lateral (select private.takeoff_count_mark_summary(k::uuid) as summary) x), '{}'::jsonb));
  if p_receipt is not null then
    receipt := receipt || jsonb_build_object('version_id',p_version,'amended_receipt_id',p_receipt);
  end if;
  begin
    insert into public.takeoff_count_mark_commands (id, tenant_id, project_id, kind, intent_key, actor_id, content_sha256,
      revisions, result)
    values (this_command, p_tenant_id, p_project_id, 'edit', p_intent_key, actor, digest,
      coalesce((select pg_catalog.jsonb_object_agg(k, pg_catalog.jsonb_build_object('expected', (held ->> k)::integer,
          'new', (held ->> k)::integer + 1)) from pg_catalog.jsonb_object_keys(changed) k), '{}'::jsonb),
      receipt);
  exception when unique_violation then
    -- The same intention key, sent with another content over other answers, committed first.
    raise exception 'TAKEOFF_MARKS_INTENT_CONFLICT' using errcode = '23505';
  end;
  -- That insert may have waited for another command under the same intention (which then rolled back): the right once
  -- more, after this last wait.
  if private.can_access_takeoff_scope(p_tenant_id, p_project_id, null, true) is not true then
    raise exception 'TAKEOFF_MARKS_FORBIDDEN' using errcode = '42501';
  end if;
  return receipt || pg_catalog.jsonb_build_object('replayed', false);
end;
$$;
revoke all on function private.edit_takeoff_marks_in_scope(uuid,uuid,uuid,jsonb,jsonb,uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.edit_takeoff_count_marks(p_tenant_id uuid,p_project_id uuid,p_intent_key uuid,
  p_revisions jsonb,p_gestures jsonb)
returns jsonb language sql security definer set search_path='' as $$
  select private.edit_takeoff_marks_in_scope(p_tenant_id,p_project_id,p_intent_key,p_revisions,p_gestures,null,null)
$$;

create function public.edit_takeoff_revision_marks(p_tenant_id uuid,p_project_id uuid,p_version_id uuid,p_receipt_id uuid,
  p_intent_key uuid,p_revisions jsonb,p_gestures jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_version_id is null or p_receipt_id is null then
    raise exception 'TAKEOFF_REVISION_SCOPE' using errcode='42501';
  end if;
  return private.edit_takeoff_marks_in_scope(p_tenant_id,p_project_id,p_intent_key,p_revisions,p_gestures,p_version_id,p_receipt_id);
end;
$$;
revoke all on function public.edit_takeoff_revision_marks(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.edit_takeoff_revision_marks(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb) to authenticated;

-- Each working decision is tied to its destination draft. An estimate copy may
-- share the analysis's marks and plan entry while retaining different confirmed contributions.
create table private.takeoff_revision_choices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  receipt_id uuid not null,
  job_id uuid not null,
  answer_id uuid not null,
  item_id uuid not null,
  actor_id uuid not null,
  intent_id uuid not null,
  revision integer not null check (revision > 0),
  proof jsonb not null,
  choice jsonb not null,
  result jsonb not null,
  command_sha256 text not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (tenant_id,intent_id),
  unique (version_id,job_id,answer_id,revision),
  foreign key (receipt_id,tenant_id,project_id,version_id)
    references public.takeoff_item_send_receipts(id,tenant_id,project_id,version_id) on delete cascade
);
revoke all on table private.takeoff_revision_choices from public,anon,authenticated,service_role;
alter table private.takeoff_revision_choices enable row level security;

-- The candidate the member may retain. The sent observations are read at their
-- stored quantity. Review changes never mark an applied job's rows as verified.
create function private.takeoff_revision_sources(a public.takeoff_item_answers)
returns jsonb language sql stable set search_path='' as $$
  with entry as (
    select e.* from public.takeoff_item_entries e where e.tenant_id=a.tenant_id and e.project_id=a.project_id
      and e.item_id=a.item_id and e.plan_logical_id=a.plan_logical_id
  ), spec as (
    select e.expected_unit,e.reference_quantity from public.takeoff_list_revision_entries e
    where e.revision_id=a.list_revision_id and e.item_id=a.item_id
  ), rows_ as (
    select i.quantity,i.unit,i.is_excluded,private.takeoff_item_row_anomalies(a.outcome,a.reason_code,true,
      i.is_excluded,i.rules_stale,i.rule_results,i.confidence,public.takeoff_low_confidence_threshold(
        (select f.value from public.feature_flags f where f.tenant_id=a.tenant_id
          and f.flag_key='TAKEOFF_LOW_CONFIDENCE_THRESHOLD' and f.enabled limit 1)),
      i.evidence,i.source_page,i.metadata,i.quantity_entry_category,i.unit,spec.expected_unit) as anomalies
    from public.takeoff_item_answer_observations o join public.takeoff_items i on i.id=o.takeoff_item_id
      and i.tenant_id=a.tenant_id and i.job_id=a.job_id cross join spec
    where o.answer_id=a.id and o.role='contribution'
  )
  select jsonb_build_object('answer_revision',a.content_sha256,'marks_revision',private.takeoff_count_marks_revision(a.id),
    'plan_entry_revision',(select e.revision from entry e),'entry',(select to_jsonb(e) from entry e),
    'whole_entry',exists(select 1 from public.takeoff_item_entries e where e.tenant_id=a.tenant_id and e.project_id=a.project_id
      and e.item_id=a.item_id and e.plan_logical_id is null),
    'unit',s.expected_unit,'reference',s.reference_quantity,'verified',private.takeoff_verified_count(a.id),
    'measured',(select private.takeoff_item_total(array_agg(r.quantity)) from rows_ r where not r.is_excluded having count(*)>0),
    'measured_unit',(select min(r.unit) from rows_ r where not r.is_excluded),
    'anomaly',exists(select 1 from rows_ r where cardinality(r.anomalies)>0),
    'mixed_units',(select count(distinct private.takeoff_unit_token(r.unit))>1 from rows_ r where not r.is_excluded))
  from spec s
$$;
revoke all on function private.takeoff_revision_sources(public.takeoff_item_answers) from public,anon,authenticated,service_role;

create function public.review_takeoff_revision_item(p_tenant_id uuid,p_project_id uuid,p_version_id uuid,p_receipt_id uuid,
  p_answer_id uuid,p_intent_id uuid,p_expected jsonb,p_choice jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  member uuid := auth.uid();
  job uuid;
  answer public.takeoff_item_answers;
  prior private.takeoff_revision_choices;
  facts jsonb;
  proof jsonb;
  digest text;
  source text := p_choice->>'source';
  qty numeric;
  unit_ text;
  entry_ jsonb;
  changed jsonb;
  rev integer;
begin
  if private.can_access_takeoff_scope(p_tenant_id,p_project_id,null,true) is not true then
    raise exception 'TAKEOFF_REVISION_SCOPE' using errcode='42501';
  end if;
  if member is null or p_intent_id is null or jsonb_typeof(p_expected) is distinct from 'object'
    or private.takeoff_item_send_keys(p_expected,array['work_revision','marks_revision','answer_revision','plan_entry_revision']) is not true
    or private.takeoff_item_send_keys(p_choice,array['source'],array['reason','note']) is not true
    or source is null or source not in ('measured','entered','verified_count','withdraw') then
    raise exception 'TAKEOFF_REVISION_INVALID' using errcode='22023';
  end if;
  digest := private.takeoff_sha256(jsonb_build_array(p_project_id,p_version_id,p_receipt_id,p_answer_id,p_expected,p_choice));
  perform 1 from public.estimate_projects where tenant_id=p_tenant_id and id=p_project_id for no key update;
  perform pg_advisory_xact_lock(hashtextextended('takeoff-item-review:'||p_project_id,0));
  perform 1 from public.estimate_versions where id=p_version_id and project_id=p_project_id and tenant_id=p_tenant_id for share;
  job := private.takeoff_revision_scope(p_tenant_id,p_project_id,p_version_id,p_receipt_id);
  perform pg_advisory_xact_lock(hashtextextended('takeoff-job-rules:'||job,0));
  perform 1 from public.takeoff_jobs where id=job for share;
  select * into answer from public.takeoff_item_answers a where a.id=p_answer_id and a.job_id=job
    and a.tenant_id=p_tenant_id and a.project_id=p_project_id for key share;
  if not found then raise exception 'TAKEOFF_REVISION_SCOPE' using errcode='42501'; end if;
  perform private.lock_takeoff_count_marks_revision(answer.id);
  if private.can_access_takeoff_scope(p_tenant_id,p_project_id,null,true) is not true then
    raise exception 'TAKEOFF_REVISION_SCOPE' using errcode='42501';
  end if;
  select * into prior from private.takeoff_revision_choices where tenant_id=p_tenant_id and intent_id=p_intent_id;
  if found then
    if prior.actor_id<>member or prior.command_sha256<>digest then
      raise exception 'TAKEOFF_REVISION_INTENT_CONFLICT' using errcode='40001';
    end if;
    return prior.result||jsonb_build_object('replayed',true);
  end if;
  perform private.takeoff_revision_require_head(p_receipt_id);
  select coalesce(max(w.revision),0) into rev from private.takeoff_revision_choices w
    where w.version_id=p_version_id and w.job_id=job and w.answer_id=p_answer_id;
  facts := private.takeoff_revision_sources(answer);
  proof := jsonb_build_object('work_revision',rev,'answer_revision',answer.content_sha256,'marks_revision',facts->'marks_revision',
    'plan_entry_revision',facts->'plan_entry_revision');
  if not private.takeoff_count_answer_is_current(answer) or proof is distinct from p_expected
    or not exists(select 1 from private.takeoff_item_reading_pairs(p_tenant_id,p_project_id,answer.plan_logical_id) x
      where x.answer_id=answer.id and x.reading='answered') then
    raise exception 'TAKEOFF_REVISION_STALE' using errcode='40001';
  end if;
  if source='withdraw' then
    if private.takeoff_item_send_keys(p_choice,array['source','reason'],array['note']) is not true
      or (p_choice->>'reason' in ('out_of_scope','duplicate','reading_error','other')) is not true
      or (p_choice ? 'note' and not private.takeoff_item_answer_is_text(p_choice->'note',null,500))
      or (p_choice->>'reason'='other' and length(trim(coalesce(p_choice->>'note','')))<3) then
      raise exception 'TAKEOFF_REVISION_INVALID' using errcode='22023';
    end if;
    qty := 0;
  else
    if facts->'whole_entry'='true'::jsonb or facts#>'{entry,included}'='false'::jsonb then
      raise exception 'TAKEOFF_REVISION_ENTRY_PROTECTED' using errcode='55000';
    end if;
    if p_choice <> jsonb_build_object('source',source) then raise exception 'TAKEOFF_REVISION_INVALID' using errcode='22023'; end if;
    entry_:=facts->'entry';
    qty := case source when 'entered' then (entry_->>'quantity')::numeric
      when 'verified_count' then (facts#>>'{verified,quantity}')::numeric else (facts->>'measured')::numeric end;
    unit_ := case source when 'entered' then entry_->>'unit' when 'verified_count' then facts#>>'{verified,unit}'
      else facts->>'measured_unit' end;
    if qty is null or qty<=0 or unit_ is null or (facts->>'unit' is not null
      and private.takeoff_item_send_unit(unit_) is distinct from private.takeoff_item_send_unit(facts->>'unit'))
      or (source='measured' and (answer.outcome<>'measured' or facts->'mixed_units'='true'::jsonb))
      or (answer.outcome='measured' and facts->'anomaly'='true'::jsonb)
      or ((facts->>'reference')::numeric>=0 and private.takeoff_quantity_requires_review((facts->>'reference')::numeric,qty)) then
      raise exception 'TAKEOFF_REVISION_SOURCE_UNAVAILABLE' using errcode='55000';
    end if;
  end if;
  changed := jsonb_build_object('source',source,'quantity',qty,'unit',unit_,'work_revision',rev+1,
    'marks_revision',facts->'marks_revision','answer_id',answer.id,'intent_id',p_intent_id);
  insert into private.takeoff_revision_choices (tenant_id,project_id,version_id,receipt_id,job_id,answer_id,item_id,actor_id,
    intent_id,revision,proof,choice,result,command_sha256)
  values(p_tenant_id,p_project_id,p_version_id,p_receipt_id,job,answer.id,answer.item_id,member,
    p_intent_id,rev+1,proof||jsonb_build_object('sources_sha256',private.takeoff_sha256(facts)),p_choice,changed,digest);
  return changed||jsonb_build_object('replayed',false);
end;
$$;
revoke all on function public.review_takeoff_revision_item(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.review_takeoff_revision_item(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,jsonb) to authenticated;

-- Keep the first send's review contract discoverable on the current database.
comment on function private.takeoff_item_send_exclusion_choice(jsonb,jsonb,jsonb,jsonb,jsonb,text,integer,integer,uuid) is $doc$
An explicit per-part choice is admissible only at the first unresolved step of the planner for this item.
The item and each excluded part are checked independently. A held page may be left out while a different
entry choice suspends the rest. The writer also validates its own facts (the retained source, item and scope).
rule_skip requires the winning active skip rule on the sealed label and the current tenant rule-set stamp.
unit_incompatible requires otherwise writable parts with an unknown, mixed or sealed-incompatible unit or basis.
quantity:<item> requires an individual retained quantity outside the line's storage precision or range.
verified-total:<item> requires coverage insufficient to replace the indivisible total or a page replacement
that would remove another plan's verified total. page:<page> requires this part on the still-undecided held
page and explicit exclusions for all remaining undecided overlaps. breakdown:<item> requires an ordinary
item with another live breakdown; it cannot apply to an item bound to a DPGF line.
target:<key> requires a real unresolved target: no unique available DPGF raw-row match or prior binding,
ambiguous or reserved ordinary targets, or a member-deleted target with live parts in that compartment.
A prior explicit DPGF claim reserves its line even if a subsequent choice suspends the claimant.
identity:<key> requires a conflicting remaining quantitative identity or incompatible selected line unit.
compartment:<key> requires this same logical plan's part on another live line of the item.
depth:<key> requires a new or explicitly recreated line whose actual parent path exceeds the draft's depth.
entry:<key> requires a selected line whose current quantity differs from its expected quantity before the send.
Keeping the entry suspends its parts only for a DPGF line whose typed quantity is below its protective total.
quantity:<key> requires the final quantity, after the preceding decisions, outside the line's storage range or precision.
$doc$;
comment on function private.takeoff_item_send_compartment_keys(uuid,uuid,text,integer) is $doc$
Use the sealed file and content hash, stored location revision, and confirmed building and level.
Only a by-level breakdown with a confirmed level, building left to reading and no confirmed building in the affaire
can resolve to either the level without a building or unallocated. The title-block suggestion was not persisted.
$doc$;
comment on function private.takeoff_item_send_waiting_pages(jsonb,jsonb,jsonb) is $doc$
Undecided held pages of this specific part: an earlier ordinary page contribution or a part other than this item's
own prior contribution on the logical plan. A part with unknown pages overlaps every held page.
$doc$;
comment on function private.takeoff_item_send_skip_rule(uuid,text,uuid) is $doc$
Match exact and contains on the sealed label. The mapping engine supplies the matched regex ID.
Only an active tenant rule can win by priority, creation millisecond and ID; the caller verifies the rule-set stamp.
$doc$;
comment on function public.review_takeoff_items(uuid,uuid,jsonb) is $doc$
Bulk review stays closed on sent plans. A plan-scoped pair omits plan_entry_id; scope_entry_id names the entry
shown by the table. Pair revisions are a CAS token for that specific scope. Reinstatement reads the actual
entry for the item and logical plan and the marks revision and row proof recorded by the acceptance.
An explicit source choice validates its own quantity against the DPGF reference: the included entry for that
item and plan, the count of its verified marks, or its included measured observations. Ordinary acceptance
aggregates covered plan entries and observations using the table's scope. A whole-affaire entry takes precedence.
$doc$;

-- Use the redistribution's individual source-line verdict before removing a last
-- part. The neutral together view needs only stored document identities, since
-- neither the destination of a move nor the availability of its location is used.
create function private.takeoff_revision_line_protections(p_tenant uuid,p_actor uuid,p_project uuid,p_version uuid,p_item uuid,p_module boolean)
returns jsonb language plpgsql stable set search_path='' as $$
declare
  docs jsonb;
  locations jsonb;
  preview jsonb;
begin
  docs := public.read_takeoff_item_redistribution_documents(p_tenant,p_actor,p_project,p_version,p_item,p_module);
  select jsonb_build_object('has_buildings',docs->'has_buildings','parts',coalesce(jsonb_object_agg(e.key,
    jsonb_build_object('source',e.value,'available',false,'key','together','label','Ensemble')), '{}'::jsonb))
    into locations from jsonb_each(docs->'parts') e;
  preview := public.preview_takeoff_item_redistribution(p_tenant,p_actor,p_project,p_version,p_item,'together',p_module,locations);
  return coalesce((select jsonb_agg(b order by b->>'line_id') from jsonb_array_elements(preview->'blockers') b
    where b->>'reason' not in ('identity','section','mixed')
      and exists(select from jsonb_array_elements(preview->'sources') s where s->'line_id'=b->'line_id')), '[]'::jsonb);
end;
$$;
revoke all on function private.takeoff_revision_line_protections(uuid,uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;

-- The ordinary review and the addressed post-send entry edit update one row
-- and append the same before/after audit event. The caller owns the review key.
create function private.write_takeoff_plan_entries(p_tenant_id uuid,p_project_id uuid,scope_plan uuid,
  actor uuid,now_ timestamptz,this_command uuid,p_command jsonb)
returns void language sql set search_path='' as $$
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
$$;
revoke all on function private.write_takeoff_plan_entries(uuid,uuid,uuid,uuid,timestamptz,uuid,jsonb)
  from public,anon,authenticated,service_role;

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
        -- Compare the DPGF reference to the selected source under lock. Only an ordinary
        -- acceptance combines the scoped pairs' entries and measured contributions.
        and (select (source_choice is null or pg_catalog.count(*) > 0)
            and pg_catalog.count(distinct private.takeoff_unit_token(q.unit)) <= 1
            and (l.reference_quantity is null or l.reference_quantity < 0 or pg_catalog.count(*) = 0
              or not private.takeoff_quantity_requires_review(l.reference_quantity,
                private.takeoff_item_total(pg_catalog.array_agg(q.quantity))))
          from (
            select e.quantity, e.unit from pg_temp.takeoff_review_pairs p
            join public.takeoff_item_entries e on e.tenant_id = p_tenant_id and e.project_id = p_project_id
              and e.item_id = p.item_id and e.plan_logical_id = p.plan_logical_id
            where p.item_id = x.item_id and p.decision_effective <> 'set_aside' and e.included
              and (chosen_source = 'entered' or (source_choice is null and p.plan_entry_id is not null))
            union all
            select i.quantity, i.unit from pg_temp.takeoff_review_pairs p
            join public.takeoff_item_answer_observations o on o.answer_id = p.answer_id and o.role = 'contribution'
            join public.takeoff_items i on i.id = o.takeoff_item_id and i.tenant_id = p_tenant_id
            where p.item_id = x.item_id and p.decision_effective <> 'set_aside' and p.outcome = 'measured' and not i.is_excluded
              and (chosen_source = 'measured' or (source_choice is null and p.plan_entry_id is null))
            union all
            select (marks ->> 'quantity')::numeric, marks ->> 'unit' from pg_temp.takeoff_review_pairs p
            cross join lateral private.takeoff_verified_count(p.answer_id) marks
            where chosen_source = 'verified_count' and p.item_id = x.item_id and p.decision_effective <> 'set_aside'
              and marks is not null
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
        and (aside.before ->> 'chosen_entry_revision')::integer is not distinct from pe.revision))
      and pg_catalog.jsonb_typeof(aside.after -> 'rows') = 'object' and not exists (
        select 1 from pg_catalog.jsonb_each(aside.after -> 'rows') snapshot(row_id, state)
        left join public.takeoff_items i on i.id = snapshot.row_id::uuid
        where i.id is null or private.takeoff_item_review_row_state(i) is distinct from snapshot.state),
      aside.before
    from pg_temp.takeoff_review_written w
    join pg_temp.takeoff_review_pairs p on p.answer_id = w.answer_id
    -- A plan-scoped table exposes this entry on its item, outside the answer pair.
    left join public.takeoff_item_entries pe on pe.tenant_id = p_tenant_id and pe.project_id = p_project_id
      and pe.item_id = w.item_id and pe.plan_logical_id = p.plan_logical_id
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
    perform private.write_takeoff_plan_entries(p_tenant_id,p_project_id,scope_plan,actor,now_,this_command,p_command);
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
-- A plan entry belongs to the affaire. The named receipt authorizes the working
-- gesture; its draft is never the storage location of a typed quantity.
create function public.edit_takeoff_revision_entry(p_tenant uuid,p_project uuid,p_version uuid,p_receipt uuid,p_answer uuid,
  p_intent uuid,p_expected_revision integer,p_entry jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); job uuid; answer public.takeoff_item_answers; entry public.takeoff_item_entries;
  prior public.takeoff_item_review_commands; receipt uuid:=gen_random_uuid(); actual jsonb; digest text;
  now_ timestamptz:=clock_timestamp(); category_ text:=p_entry->>'category';
begin
  if private.can_access_takeoff_scope(p_tenant,p_project,null,true) is not true then raise exception 'TAKEOFF_REVISION_SCOPE' using errcode='42501'; end if;
  if p_intent is null or p_expected_revision is null or p_expected_revision<0 or
    private.takeoff_item_send_keys(p_entry,array['quantity','unit','category'],array['note']) is not true or
    private.takeoff_item_answer_is_number(p_entry->'quantity',0,999999999.999,false,true) is not true or
    private.takeoff_item_answer_is_text(p_entry->'unit',null,16) is not true or
    (category_ in ('site_survey','other_drawing','dpgf_cctp','written_confirmation','documented_calculation','hypothesis')) is not true or
    (p_entry ? 'note' and private.takeoff_item_answer_is_text(p_entry->'note',null,500) is not true) or
    (category_='hypothesis' and length(trim(coalesce(p_entry->>'note','')))<10) then
    raise exception 'TAKEOFF_REVISION_INVALID' using errcode='22023';
  end if;
  perform 1 from public.estimate_projects where id=p_project and tenant_id=p_tenant for no key update;
  perform pg_advisory_xact_lock(hashtextextended('takeoff-item-review:'||p_project,0));
  perform 1 from public.estimate_versions where id=p_version and project_id=p_project and tenant_id=p_tenant for share;
  job:=private.takeoff_revision_scope(p_tenant,p_project,p_version,p_receipt);
  perform pg_advisory_xact_lock(hashtextextended('takeoff-job-rules:'||job,0));
  select * into answer from public.takeoff_item_answers a where (a.id,a.tenant_id,a.project_id,a.job_id)=(p_answer,p_tenant,p_project,job)
    for share;
  if not found or private.can_access_takeoff_scope(p_tenant,p_project,null,true) is not true then
    raise exception 'TAKEOFF_REVISION_SCOPE' using errcode='42501';
  end if;
  digest:=private.takeoff_sha256(jsonb_build_array('edit_sent_plan_entry',p_version,p_receipt,p_answer,p_expected_revision,p_entry));
  select * into prior from public.takeoff_item_review_commands r where (r.tenant_id,r.project_id,r.intent_key)=(p_tenant,p_project,p_intent);
  if found then
    if prior.actor_id=actor and prior.command_sha256=digest then return prior.outcome||jsonb_build_object('replayed',true);end if;
    raise exception 'TAKEOFF_REVISION_INTENT_CONFLICT' using errcode='40001';
  end if;
  perform private.takeoff_revision_require_head(p_receipt);
  select * into entry from public.takeoff_item_entries e where
    (e.tenant_id,e.project_id,e.item_id,e.plan_logical_id)=(p_tenant,p_project,answer.item_id,answer.plan_logical_id) for update;
  if p_expected_revision<>coalesce(entry.revision,0) or not private.takeoff_count_answer_is_current(answer) or not exists(
      select 1 from private.takeoff_item_reading_pairs(p_tenant,p_project,answer.plan_logical_id) pair where pair.answer_id=p_answer and pair.reading='answered') then
    raise exception 'TAKEOFF_REVISION_STALE' using errcode='40001';
  end if;
  if exists(select 1 from public.takeoff_item_entries e where e.tenant_id=p_tenant and e.project_id=p_project and e.item_id=answer.item_id and e.plan_logical_id is null) then
    raise exception 'TAKEOFF_REVISION_ENTRY_PROTECTED' using errcode='55000';
  end if;
  perform private.write_takeoff_plan_entries(p_tenant,p_project,answer.plan_logical_id,actor,now_,receipt,
    jsonb_build_object('values',jsonb_build_array(p_entry||jsonb_build_object('item_id',answer.item_id)),
      'apply',jsonb_build_array(answer.item_id),'entry',p_entry));
  select jsonb_build_object('receipt_id',receipt,'entry_id',e.id,'revision',e.revision,'quantity',e.quantity,'unit',e.unit,
    'included',e.included,'amended_receipt_id',p_receipt,'version_id',p_version,'answer_id',p_answer) into strict actual
    from public.takeoff_item_entries e where (e.tenant_id,e.project_id,e.item_id,e.plan_logical_id)=(p_tenant,p_project,answer.item_id,answer.plan_logical_id);
  insert into public.takeoff_item_review_commands(id,tenant_id,project_id,intent_key,actor_id,gesture,command_sha256,outcome)
    values(receipt,p_tenant,p_project,p_intent,actor,'enter_quantity',digest,actual);
  return actual||jsonb_build_object('replayed',false);
end;
$$;
revoke all on function public.edit_takeoff_revision_entry(uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.edit_takeoff_revision_entry(uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb) to authenticated;

create or replace function private.guard_takeoff_item_send_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_catalog.pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'TAKEOFF_ITEM_SEND_IMMUTABLE' using errcode = '42501';
  end if;
  if tg_op='INSERT' and tg_table_name='takeoff_item_send_targets'
    and pg_catalog.to_jsonb(new)->>'vacated_compartment_key' is not null then
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
  -- A move keeps every column of the live contribution except its destination. The
  -- command's marker names its receipt. Ordinary members have SELECT only and the
  -- service role cannot write directly even when it sets a transaction setting.
  if nullif(pg_catalog.current_setting('mergeone.takeoff_item_redistribution', true), '') is not null
    and coalesce(pg_catalog.current_setting('mergeone.takeoff_item_send', true), '') = '' then
    if current_user = 'service_role' then
      raise exception 'TAKEOFF_ITEM_SEND_WRITER_REQUIRED' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and tg_table_name = 'takeoff_item_send_parts' then
      if old.state = 'live' and new.target_id <> old.target_id
        and pg_catalog.to_jsonb(new) - 'target_id' = pg_catalog.to_jsonb(old) - 'target_id'
        and exists (select 1 from public.takeoff_item_send_targets t
          where (t.id,t.tenant_id,t.project_id,t.version_id,t.item_id) =
            (new.target_id,old.tenant_id,old.project_id,old.version_id,old.item_id) and t.estimate_item_id is not null)
        and exists (select 1 from public.takeoff_item_send_receipts r
          where r.id=private.takeoff_uuid_or_null(to_jsonb(current_setting('mergeone.takeoff_item_redistribution'))) and r.command_kind='redistribute'
            and (r.tenant_id,r.project_id,r.version_id)=(old.tenant_id,old.project_id,old.version_id)
            and r.result->'moves' @> jsonb_build_array(jsonb_build_object('part_id',old.id,'from_target',old.target_id,'to_target',new.target_id)))
      then return new;
      end if;
    elsif tg_op='UPDATE' and tg_table_name='takeoff_item_send_targets' then
      -- A prior member-deleted target for this same compartment can still own
      -- replaced parts after a recreation. Keep it too, under its own archive key.
      if old.estimate_item_id is null and old.vacated_compartment_key is null
        and new.vacated_compartment_key=old.compartment_key and new.compartment_key='vacated:'||old.id
        and to_jsonb(new)-array['compartment_key','vacated_compartment_key']
          = to_jsonb(old)-array['compartment_key','vacated_compartment_key']
        and not exists(select from public.takeoff_item_send_parts p where p.target_id=old.id and p.state='live')
        and exists(select from public.takeoff_item_send_receipts r
          where r.id=private.takeoff_uuid_or_null(to_jsonb(current_setting('mergeone.takeoff_item_redistribution')))
            and r.command_kind='redistribute' and (r.tenant_id,r.project_id,r.version_id)=(old.tenant_id,old.project_id,old.version_id)
            and r.write_plan->>'item_id'=old.item_id::text and r.result->'vacated_target_ids' @> jsonb_build_array(old.id)) then
        return new;
      end if;
    elsif tg_op = 'INSERT' then
      if (tg_table_name = 'takeoff_item_send_receipts' and pg_catalog.to_jsonb(new)->>'command_kind' = 'redistribute'
          and pg_catalog.to_jsonb(new)->>'id' = pg_catalog.current_setting('mergeone.takeoff_item_redistribution'))
        or (tg_table_name = 'takeoff_item_send_targets' and pg_catalog.to_jsonb(new)->>'created_by_receipt_id' =
          pg_catalog.current_setting('mergeone.takeoff_item_redistribution'))
        or (tg_table_name = 'takeoff_item_send_sections' and pg_catalog.to_jsonb(new)->>'receipt_id' =
          pg_catalog.current_setting('mergeone.takeoff_item_redistribution')) then
        return new;
      end if;
    end if;
    raise exception 'TAKEOFF_ITEM_SEND_IMMUTABLE' using errcode = '42501';
  end if;
  if coalesce(pg_catalog.current_setting('mergeone.takeoff_item_send', true), '') = '' or current_user = 'service_role' then
    raise exception 'TAKEOFF_ITEM_SEND_WRITER_REQUIRED' using errcode = '42501';
  end if;
  -- A confirmed withdrawal releases just its own newly emptied target.
  -- Its physical line has already been deleted through the FK action above.
  if tg_op='UPDATE' and tg_table_name='takeoff_item_send_targets' then
    if old.estimate_item_id is null and old.vacated_compartment_key is null
      and new.vacated_compartment_key=old.compartment_key and new.compartment_key='vacated:'||old.id
      and to_jsonb(new)-array['compartment_key','vacated_compartment_key']=
        to_jsonb(old)-array['compartment_key','vacated_compartment_key']
      and not exists(select 1 from public.takeoff_item_send_parts p where p.target_id=old.id and p.state='live')
      and exists(select 1 from public.takeoff_item_send_receipts r
        where r.id=private.takeoff_uuid_or_null(to_jsonb(current_setting('mergeone.takeoff_item_send')))
          and (r.tenant_id,r.project_id,r.version_id)=(old.tenant_id,old.project_id,old.version_id)
          and r.command_kind='revise' and r.result->'vacated_target_ids' @> jsonb_build_array(old.id)) then
      return new;
    end if;
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

-- The work list is derived on the server. An item explicitly left out of the
-- first send stays out until a member corrects its proof or its source.
create function private.takeoff_revision_items(p_tenant uuid,p_project uuid,p_version uuid,p_receipt uuid,p_job uuid)
returns setof jsonb language sql stable set search_path='' as $$
  with receipt as (
    select r.* from public.takeoff_item_send_receipts r where r.id=p_receipt
      and (r.tenant_id,r.project_id,r.version_id)=(p_tenant,p_project,p_version)
  ), settled as (
    select x.key as answer_key,x.value as proof from receipt r cross join lateral jsonb_each(
      coalesce(r.result->'reviewed',r.write_plan->'reviewed','{}')) x
  ), local_parts as materialized (
    select p.answer_id,jsonb_agg(to_jsonb(p) order by p.id) as parts,
      min(p.marks_revision) as marks_revision from public.takeoff_item_send_parts p
    where p.tenant_id=p_tenant and p.project_id=p_project and p.version_id=p_version and p.job_id=p_job and p.state='live'
    group by p.answer_id
  ), latest as materialized (
    select distinct on (w.answer_id) w.* from private.takeoff_revision_choices w
    where w.tenant_id=p_tenant and w.project_id=p_project and w.version_id=p_version and w.job_id=p_job
    order by w.answer_id,w.revision desc
  ), edited as (
    select e.answer_id,max(e.revision) as revision from public.takeoff_count_mark_events e
    join public.takeoff_count_mark_commands c on c.id=e.command_id and c.kind='edit'
      and c.result ? 'amended_receipt_id'
    join public.takeoff_item_answers a on a.id=e.answer_id and a.job_id=p_job
    where e.tenant_id=p_tenant and e.project_id=p_project
    group by e.answer_id
  ), changes as (
    select a as answer, w as work,coalesce(lp.parts,'[]') as before_parts,
      private.takeoff_count_marks_revision(a.id) as marks_revision, f.proof, e.revision as edit_revision
    from public.takeoff_item_answers a left join local_parts lp on lp.answer_id=a.id
    left join latest w on w.answer_id=a.id left join edited e on e.answer_id=a.id
    left join settled f on f.answer_key=a.id::text
    left join public.takeoff_item_entries entry on entry.tenant_id=a.tenant_id and entry.project_id=a.project_id
      and entry.item_id=a.item_id and entry.plan_logical_id=a.plan_logical_id
    where a.tenant_id=p_tenant and a.project_id=p_project and a.job_id=p_job and not a.comparison_only
      -- A later confirmed reading supersedes this working correction. An older
      -- receipt remains readable; there is no further change to confirm on it.
      and not exists(select 1 from public.takeoff_item_send_parts newer
        join public.takeoff_item_answers n on n.id=newer.answer_id and n.job_id=newer.job_id
        where newer.version_id=p_version and newer.tenant_id=p_tenant and newer.state='live'
          and (newer.item_id,newer.plan_logical_id)=(a.item_id,a.plan_logical_id)
          and newer.job_id<>p_job and n.reading_revision>a.reading_revision and not n.comparison_only
          and not exists(select 1 from public.takeoff_item_send_parts own
            where own.version_id=p_version and own.answer_id=a.id and own.state='live'))
      and (coalesce(w.revision,0)>coalesce((f.proof->>'work_revision')::integer,0)
      or (lp.parts#>>'{0,kind}'='entered' and lp.parts#>>'{0,entry_id}'=entry.id::text
        and (lp.parts#>>'{0,entry_revision}')::integer<>entry.revision and f.proof->>'entry_revision' is distinct from entry.revision::text)
      or coalesce(e.revision,0)>coalesce((f.proof->>'marks_revision')::integer,lp.marks_revision,0)
      or (lp.marks_revision is not null and lp.marks_revision<>private.takeoff_count_marks_revision(a.id)
        and f.proof->>'marks_revision' is distinct from private.takeoff_count_marks_revision(a.id)::text))
  )
  select jsonb_build_object('item_id',(c.answer).item_id,'answer_id',(c.answer).id,'answer_revision',(c.answer).content_sha256,
    'label',s.label,'plan_id',(c.answer).plan_logical_id,'job_id',p_job,'marks_revision',c.marks_revision,
    'work_revision',coalesce((c.work).revision,0),'work_id',(c.work).id,'before_parts',c.before_parts,
    'choice',(c.work).choice,'source',picked.source,'quantity',retained.qty,
    'ready',picked.source is not null and retained.qty is not null and
      (not picked.has_choice or ((c.work).proof->>'sources_sha256'=private.takeoff_sha256(facts) and
        (c.work).proof->'marks_revision'=to_jsonb(c.marks_revision) and (c.work).proof->'plan_entry_revision'=facts->'plan_entry_revision')) and private.takeoff_count_answer_is_current(c.answer)
      and exists(select 1 from private.takeoff_item_reading_pairs(p_tenant,p_project,(c.answer).plan_logical_id) pair
        where pair.answer_id=(c.answer).id and pair.reading='answered')
      and (picked.source='withdraw' or (facts->'whole_entry'='false' and facts#>'{entry,included}' is distinct from 'false'::jsonb
        and ((c.answer).outcome<>'measured' or facts->'anomaly'='false') and (facts->>'reference' is null or
          not private.takeoff_quantity_requires_review((facts->>'reference')::numeric,retained.qty))
        and (facts->>'unit' is null or private.takeoff_item_send_unit(retained.unit)=private.takeoff_item_send_unit(facts->>'unit')))),
    'facts',facts,'parts',coalesce(parts.data,'[]')) from changes c
  join public.takeoff_list_revision_entries s on s.revision_id=(c.answer).list_revision_id and s.item_id=(c.answer).item_id
  cross join lateral private.takeoff_revision_sources(c.answer) facts
  cross join lateral (select coalesce((c.work).revision,0)>coalesce((c.proof->>'work_revision')::integer,0) as pending) diff
  cross join lateral (select diff.pending as has_choice,case when diff.pending then (c.work).choice->>'source'
    when c.before_parts#>>'{0,kind}' in ('entered','verified_count') then c.before_parts#>>'{0,kind}' end as source) picked
  cross join lateral (select case picked.source when 'entered' then (facts#>>'{entry,quantity}')::numeric
    when 'verified_count' then (facts#>>'{verified,quantity}')::numeric when 'withdraw' then 0 when 'measured' then (facts->>'measured')::numeric end as qty,
    case picked.source when 'entered' then facts#>>'{entry,unit}' when 'verified_count' then facts#>>'{verified,unit}'
      when 'measured' then facts->>'measured_unit' end as unit) retained
  left join lateral (
    select jsonb_agg(jsonb_build_object('item_id',(c.answer).item_id,'answer_id',(c.answer).id,'answer_revision',(c.answer).content_sha256,
      'plan_logical_id',(c.answer).plan_logical_id,'kind',picked.source,'quantity',src.quantity,'unit',src.unit,
      'pages',src.pages,'observation_id',src.observation_id,'takeoff_item_id',src.takeoff_item_id,'basis',src.basis,
      'decision_revision',coalesce((c.work).revision,(c.before_parts#>>'{0,decision_revision}')::integer),
      'entry_id',case when picked.source='entered' then (facts#>>'{entry,id}')::uuid end,
      'entry_revision',case when picked.source='entered' then (facts#>>'{entry,revision}')::integer end,
      'marks_revision',case when picked.source='verified_count' then c.marks_revision end,
      'takeoff_item_ids',case when picked.source='verified_count' then (select coalesce(array_agg(i.id order by i.id),'{}'::uuid[])
        from public.takeoff_item_answer_observations o join public.takeoff_items i on i.id=o.takeoff_item_id
        where o.answer_id=(c.answer).id and o.role='contribution' and not i.is_excluded) end) order by src.observation_id) as data
    from (
      select i.quantity,i.unit,array(select i.source_page where i.source_page>0) pages,o.id as observation_id,
        i.id as takeoff_item_id,o.measurement_basis as basis from public.takeoff_item_answer_observations o
      join public.takeoff_items i on i.id=o.takeoff_item_id and i.tenant_id=p_tenant and i.job_id=p_job
      where picked.source='measured' and o.answer_id=(c.answer).id and o.role='contribution' and not i.is_excluded
      union all select (facts#>>'{verified,quantity}')::numeric,facts#>>'{verified,unit}',
        array(select q::integer from jsonb_array_elements_text(facts#>'{verified,pages}') q),null,null,null
      where picked.source='verified_count' and facts#>>'{verified,quantity}' is not null
      union all select retained.qty,retained.unit,d.unit_pages,null,null,null
      from public.takeoff_jobs j join public.takeoff_launch_requests r on r.id=j.launch_request_id
      cross join lateral private.takeoff_item_send_plan_read(j,r.manifest) d where j.id=p_job and picked.source='entered'
    ) src
  ) parts on true order by (c.answer).item_id
$$;
revoke all on function private.takeoff_revision_items(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function private.takeoff_item_send_page_choices_valid(p_decisions jsonb)
returns boolean language sql immutable set search_path='' as $$
  select jsonb_typeof(p_decisions)='array' and not exists (select 1 from pg_catalog.jsonb_array_elements(p_decisions) as d(value)
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
      from pg_catalog.jsonb_array_elements(p_decisions) as d(value))
$$;
revoke all on function private.takeoff_item_send_page_choices_valid(jsonb) from public,anon,authenticated,service_role;

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
          where private.takeoff_item_send_keys(r.value, array['job_id', 'answer_id', 'observation_ids', 'quantity'],array['corrected_proof']) is not true
            or (r.value ? 'corrected_proof' and (private.takeoff_item_send_keys(r.value->'corrected_proof',
                array['part_id','sent_revision','current_revision']) is not true
              or private.takeoff_item_send_uuid(r.value#>'{corrected_proof,part_id}') is not true
              or private.takeoff_item_answer_is_number(r.value#>'{corrected_proof,sent_revision}',1,2147483647,true) is not true
              or private.takeoff_item_answer_is_number(r.value#>'{corrected_proof,current_revision}',1,2147483647,true) is not true)))
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
    and private.takeoff_item_send_page_choices_valid(p_plan->'page_decisions')
    and (select pg_catalog.count(*) = pg_catalog.count(distinct t.value ->> 'key')
      from pg_catalog.jsonb_array_elements(p_plan -> 'targets') as t(value)), false)
$$;

create function private.record_takeoff_contribution_pages(tenant uuid,project_id_ uuid,target_version uuid,
  this_receipt uuid,target_job_id uuid,plan_document jsonb)
returns void language sql set search_path='' as $$
insert into public.takeoff_item_send_pages (tenant_id, project_id, version_id, receipt_id, job_id, document, page, item_ids,
    part_ids)
  select tenant, project_id_, target_version, this_receipt, target_job_id, plan_document, written.page,
    pg_catalog.array_agg(distinct written.item_id order by written.item_id), pg_catalog.array_agg(distinct written.id order by written.id)
  from (select p.id, p.item_id, page.value as page from public.takeoff_item_send_parts as p
      cross join lateral pg_catalog.unnest(case when pg_catalog.cardinality(p.pages) > 0 then p.pages else array[null::integer] end)
        as page(value)
      where p.receipt_id = this_receipt) as written
  group by written.page;
$$;
revoke all on function private.record_takeoff_contribution_pages(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function private.apply_takeoff_item_send_plan(p_tenant_id uuid, p_actor_id uuid, p_module_default boolean, p_request jsonb,
  p_revision_receipt uuid, p_revision_parts jsonb, p_check_only boolean default false)
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
  this_receipt uuid := coalesce(p_revision_receipt,gen_random_uuid());
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
  corrected_part_ids uuid[] := '{}';
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

  if p_check_only then
    -- The server can show a correction without acquiring the editor lease.
    -- This branch performs ordinary reads; the writer later repeats every
    -- check under the usual locks, including the lease and the proof rows.
    if p_revision_receipt is null or destination_kind<>'existing_draft' then
      raise exception 'TAKEOFF_REVISION_INVALID' using errcode='22023';
    end if;
    target_version:=(plan#>>'{destination,version_id}')::uuid;
    select * into project from public.estimate_projects where id=job.project_id and tenant_id=tenant;
    select * into version_row from public.estimate_versions where id=target_version and tenant_id=tenant and project_id=job.project_id;
    select * into launch from public.takeoff_launch_requests where id=job.launch_request_id and tenant_id=tenant;
    earlier_proofs_current:=not exists(select 1 from public.takeoff_item_send_parts p join public.takeoff_item_answers a on a.id=p.answer_id
      where p.version_id=target_version and p.tenant_id=tenant and p.state='live' and p.kind='verified_count'
        and exists(select 1 from jsonb_array_elements(plan->'targets') t where t->>'item_id'=p.item_id::text)
        and p.marks_revision is distinct from private.takeoff_count_marks_revision(a.id));
  else
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
  if p_revision_receipt is null and (job.estimate_version_id is not null or job.status = 'applied'::public.takeoff_job_status
    or exists (select 1 from public.takeoff_item_send_receipts as stored where stored.job_id = target_job_id)) then
    raise exception 'TAKEOFF_ITEM_SEND_ALREADY_SENT' using errcode = '40001';
  end if;
  if launch.id is null or launch.item_list_revision_id is null
    or not exists (select 1 from public.takeoff_item_answer_publications as publication
      where publication.job_id = target_job_id and publication.tenant_id = tenant) then
    raise exception 'TAKEOFF_ITEM_SEND_NOT_ITEM_LIST' using errcode = '22023';
  end if;
  if job.status is distinct from (case when p_revision_receipt is null then 'completed' else 'applied' end)::public.takeoff_job_status then
    raise exception 'TAKEOFF_ITEM_SEND_JOB_NOT_READY' using errcode = '40001';
  end if;

  -- Only the revision writer calls the private addition path. Its version and job were locked
  -- before it derived the changed sources. A correction cannot create a second draft.
  if p_revision_receipt is not null and (destination_kind <> 'existing_draft' or jsonb_typeof(p_revision_parts) is distinct from 'array') then
    raise exception 'TAKEOFF_REVISION_INVALID' using errcode='22023';
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
    if not p_check_only and exists (select 1 from public.draft_locks as lock_row where lock_row.version_id = target_version
      and lock_row.user_id <> actor and lock_row.expires_at > pg_catalog.clock_timestamp()) then
      raise exception 'TAKEOFF_ITEM_SEND_DRAFT_LOCKED' using errcode = '55P03';
    end if;
    if not p_check_only and not exists (select 1 from public.draft_locks as lock_row where lock_row.version_id = target_version
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
  if p_revision_receipt is null then
    select coalesce(pg_catalog.jsonb_agg(stored), '[]'::jsonb) into job_parts
    from private.takeoff_item_send_resolved_parts(tenant, job.project_id, target_job_id, unit_pages) as stored;
  else
    job_parts := p_revision_parts;
  end if;

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
    if not earlier_proofs_current or exists(select 1 from jsonb_array_elements(plan->'targets') t
        cross join lateral jsonb_array_elements(t->'replaces') r where r ? 'corrected_proof') then
      -- An unchanged client has no witness. Compare the *entire* set of stale
      -- proofs on the target items against the replacements the member saw.
      -- A revision never acquires authority over another reading this way.
      with stale_parts as materialized (
        select p.*,private.takeoff_count_marks_revision(a.id) as current_revision
        from public.takeoff_item_send_parts p join public.takeoff_item_answers a
          on a.id=p.answer_id and a.tenant_id=p.tenant_id and a.project_id=p.project_id
        where p.version_id=target_version and p.tenant_id=tenant and p.kind='verified_count' and p.state='live'
          and exists(select 1 from jsonb_array_elements(plan->'targets') t where t->>'item_id'=p.item_id::text)
          and p.marks_revision is distinct from private.takeoff_count_marks_revision(a.id)
      ), declared as (
        select t->'item_id' as item, r as replacement from jsonb_array_elements(plan->'targets') t
          cross join lateral jsonb_array_elements(t->'replaces') r where r ? 'corrected_proof'
      ), matched as (
        select p.id from stale_parts p join declared d on d.item=to_jsonb(p.item_id)
          and d.replacement->'corrected_proof'=jsonb_build_object('part_id',p.id,'sent_revision',p.marks_revision,
            'current_revision',p.current_revision)
          and d.replacement->'job_id'=to_jsonb(p.job_id) and d.replacement->'answer_id'=to_jsonb(p.answer_id)
          and d.replacement->'quantity'=to_jsonb(p.quantity) and d.replacement->'observation_ids'=to_jsonb(p.observation_ids)
        where p_revision_receipt is null and p.job_id<>target_job_id and p.plan_logical_id=plan_key
          and p.current_revision>p.marks_revision and exists(select 1 from public.takeoff_item_answers fresh
            join public.takeoff_item_answers prior on prior.id=p.answer_id
            where fresh.job_id=target_job_id and fresh.item_id=p.item_id and fresh.plan_logical_id=p.plan_logical_id
              and fresh.reading_revision>prior.reading_revision and private.takeoff_count_answer_is_current(fresh))
      )
      select case when (select count(*) from matched)=(select count(*) from stale_parts)
          and (select count(distinct id) from matched)=(select count(*) from declared)
        then coalesce((select array_agg(id order by id) from matched),'{}'::uuid[]) end into corrected_part_ids;
      if corrected_part_ids is null then
        raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode='40001',
          detail=jsonb_build_object('reason','earlier_send_changed')::text;
      end if;
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
    -- The witness applies only to a whole-plan replacement of the named
    -- local part by this target. The coverage verdict above uses the searched
    -- pages after exclusions and held pages; a partial reading stays indivisible.
    if exists(select 1 from jsonb_array_elements(target->'replaces') r where r ? 'corrected_proof'
        and (whole_plan is not true or not ((r#>>'{corrected_proof,part_id}')::uuid=any(target_replaced)))) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode='40001',
        detail=jsonb_build_object('reason','earlier_send_changed')::text;
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
  -- An addition made by a revision has no earlier local contribution. In
  -- particular no page decision, recreated target or replacement declaration
  -- can retire a part of another reading through the ordinary send writer.
  if p_revision_receipt is not null and (cardinality(page_replaced)>0 or cardinality(replaced_ids)>0) then
    raise exception 'TAKEOFF_REVISION_FOREIGN_PART' using errcode='55000';
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

  if p_check_only then
    return jsonb_build_object('targets',plan->'targets','sections',plan->'sections','left_out',plan->'left_out',
      'parts_not_sent',plan->'parts_not_sent','page_decisions',plan->'page_decisions');
  end if;
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

  if p_revision_receipt is not null then
    return jsonb_build_object('lines',lines_out,'sections_created',sections_out);
  end if;
  perform private.record_takeoff_contribution_pages(tenant,job.project_id,target_version,this_receipt,target_job_id,plan_document);

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

revoke all on function private.apply_takeoff_item_send_plan(uuid,uuid,boolean,jsonb,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
-- Only an ordinary first send is reachable through the released endpoint.
create or replace function public.send_takeoff_item_plan(p_tenant_id uuid,p_actor_id uuid,p_module_default boolean,p_request jsonb)
returns jsonb language sql security definer set search_path='' as $$
  select private.apply_takeoff_item_send_plan(p_tenant_id,p_actor_id,p_module_default,p_request,null,null)
$$;

-- Returns the exact local live parts and member decisions used by confirmation.
-- An addition is mapped by the ordinary send planner and validated by its writer.
create function public.preview_takeoff_contribution_revision(p_tenant uuid,p_actor uuid,p_project uuid,p_version uuid,
  p_receipt uuid,p_module boolean,p_choices jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  job uuid;
  job_row public.takeoff_jobs;
  receipt public.takeoff_item_send_receipts;
  version_row public.estimate_versions;
  change jsonb;
  changes jsonb := '[]';
  actions jsonb := '[]';
  blockers jsonb := '[]';
  additions jsonb := '[]';
  omissions jsonb := '[]';
  reviewed jsonb;
  state_ jsonb;
  addition_plan jsonb;
  incoming jsonb;
  add_detail text;
  item uuid;
  own_ids uuid[];
  current_target uuid;
  target public.takeoff_item_send_targets;
  line public.estimate_items;
  source_ text;
  previous_plan jsonb;
  choice_ text;
  protection jsonb;
  foreign_parts jsonb;
  page_rows jsonb;
  offered_line_choices uuid[] := '{}';
  kept_parts jsonb;
  choices_for_pages jsonb:=coalesce(p_choices->'page_decisions','[]');
  page_conflicts jsonb;
  read_ record;
  scope_pages integer[];
  ref numeric;
  old_sum numeric;
  keep_sum numeric;
  keep_count integer;
  legacy numeric;
  protective numeric;
  desired numeric;
  expected numeric;
  after_qty numeric;
  action text;
  snapshot jsonb;
begin
  perform private.takeoff_redistribution_check_scope(p_tenant,p_actor,p_project,p_version,p_module);
  job := private.takeoff_revision_scope(p_tenant,p_project,p_version,p_receipt);
  if private.takeoff_item_send_keys(p_choices,'{}'::text[],array['lines','leave_out','send_plan','page_decisions']) is not true
    or (p_choices ? 'lines' and jsonb_typeof(p_choices->'lines') is distinct from 'object')
    or (p_choices ? 'leave_out' and jsonb_typeof(p_choices->'leave_out') is distinct from 'array')
    or octet_length(p_choices::text)>8388608 then raise exception 'TAKEOFF_REVISION_INVALID' using errcode='22023'; end if;
  select * into strict version_row from public.estimate_versions where id=p_version;
  select * into strict job_row from public.takeoff_jobs where id=job;
  select * into strict receipt from public.takeoff_item_send_receipts where id=p_receipt;
  perform private.takeoff_revision_require_head(p_receipt);
  select d.* into read_ from public.takeoff_launch_requests r cross join lateral private.takeoff_item_send_plan_read(job_row,r.manifest) d
    where r.id=job_row.launch_request_id and r.tenant_id=p_tenant;
  select r.write_plan into previous_plan from public.takeoff_item_send_receipts r
    where r.tenant_id=p_tenant and r.project_id=p_project and r.job_id=job and r.command_kind='send';
  select private.takeoff_item_send_held_pages(p_tenant,p_version,job,read_.document,read_.unit_pages) into page_rows;
  if private.takeoff_item_send_page_choices_valid(choices_for_pages) is not true or exists(
      select 1 from jsonb_array_elements(choices_for_pages) d where d->>'decision'<>'keep_both' or not exists(
        select 1 from jsonb_array_elements(page_rows) h where d->'page'=h->'page')) then
    raise exception 'TAKEOFF_REVISION_INVALID' using errcode='22023';
  end if;
  reviewed := coalesce(receipt.result->'reviewed',receipt.write_plan->'reviewed','{}');
  for change in select * from private.takeoff_revision_items(p_tenant,p_project,p_version,p_receipt,job) loop
    item := (change->>'item_id')::uuid;
    own_ids := array(select (p->>'id')::uuid from jsonb_array_elements(change->'before_parts') p order by 1);
    source_ := change->>'source';
    action := case when cardinality(own_ids)=0 then 'add' when source_='withdraw' then 'withdraw' else 'replace' end;
    changes := changes || jsonb_build_array(change||jsonb_build_object('action',action));
    reviewed := reviewed || jsonb_build_object(change->>'answer_id',jsonb_build_object('work_revision',change->'work_revision',
      'marks_revision',change->'marks_revision','entry_revision',change#>'{facts,plan_entry_revision}'));
    if coalesce(p_choices->'leave_out','[]') ? item::text then
      omissions := omissions||jsonb_build_array(jsonb_build_object('item_id',item,'choice','leave_out','before_parts',own_ids));
      continue;
    end if;
    if change->'ready' is distinct from 'true' then
      blockers:=blockers||jsonb_build_array(jsonb_build_object('reason','review_required','item_id',item)); continue;
    end if;
    if source_<>'withdraw' and jsonb_array_length(change->'parts')=0 then
      blockers:=blockers||jsonb_build_array(jsonb_build_object('reason','source_unavailable','item_id',item)); continue;
    end if;
    if source_<>'withdraw' then
      -- A correction cannot consume a part from another analysis even when an
      -- ordinary send of this logical plan would replace it. Disjoint parts stay.
      select case source_ when 'verified_count' then private.takeoff_count_answer_scope(a)
        when 'entered' then read_.unit_pages else a.searched_pages end into scope_pages
        from public.takeoff_item_answers a where a.id=(change->>'answer_id')::uuid;
      select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'job_id',p.job_id,'answer_id',p.answer_id,'quantity',p.quantity,
        'unit',p.unit,'pages',p.pages,'source',p.kind,'reading_revision',a.reading_revision,'marks_revision',p.marks_revision,
        'document',j.source_file_name) order by p.id),'[]') into foreign_parts
        from public.takeoff_item_send_parts p left join public.takeoff_item_answers a on a.id=p.answer_id
        left join public.takeoff_jobs j on j.id=p.job_id and j.tenant_id=p.tenant_id and j.project_id=p.project_id
        where p.version_id=p_version and p.tenant_id=p_tenant and p.item_id=item and p.state='live' and p.job_id<>job
          and p.plan_logical_id=(change->>'plan_id')::uuid and (private.takeoff_item_send_count_scope(p.kind,p.pages,source_='verified_count',scope_pages,
              private.takeoff_item_send_whole_plan((read_.plan_entry->>'page_count')::integer,scope_pages,scope_pages)) in ('replace','refuse')
            or p.pages && scope_pages or (cardinality(p.pages)=0 and read_.unit_pages <@ scope_pages));
      if foreign_parts<>'[]' then
        blockers:=blockers||jsonb_build_array(jsonb_build_object('reason','other_analysis','item_id',item,
          'retained',change->'quantity','current_job_id',job,'document',job_row.source_file_name,
          'current_reading_revision',(select a.reading_revision from public.takeoff_item_answers a where a.id=(change->>'answer_id')::uuid),
          'earlier',foreign_parts)); continue;
      end if;
    end if;
    if cardinality(own_ids)=0 then
      -- No subtraction can be inferred from a line total. A plain missing part
      -- is an addition only when the original plan proves it brought no part
      -- of this item, or a local confirmed withdrawal recorded that absence.
      if exists(select 1 from public.estimate_items i where i.version_id=p_version
          and i.source_metadata#>>'{takeoff_item_send,item_id}'=item::text and
          not exists(select 1 from public.takeoff_item_send_targets t where t.estimate_item_id=i.id and t.item_id=item))
        or (not coalesce((receipt.result->'reviewed') ? (change->>'answer_id'),false)
          and not coalesce((receipt.write_plan->'reviewed') ? (change->>'answer_id'),false)
          and (previous_plan is null or exists(select 1 from jsonb_array_elements(previous_plan->'targets') t
            where t->>'item_id'=item::text)) and not exists(select 1 from public.takeoff_item_send_parts p
              where p.version_id=p_version and p.item_id=item and p.answer_id=(change->>'answer_id')::uuid and p.job_id=job)) then
        blockers:=blockers||jsonb_build_array(jsonb_build_object('reason','part_not_isolated','item_id',item));
        continue;
      end if;
      if source_<>'withdraw' then additions:=additions||jsonb_build_array(item); end if;
      continue;
    end if;
    if (select count(distinct p->>'target_id') from jsonb_array_elements(change->'before_parts') p)<>1 then
      blockers:=blockers||jsonb_build_array(jsonb_build_object('reason','part_not_isolated','item_id',item)); continue;
    end if;
    current_target:=(change#>>'{before_parts,0,target_id}')::uuid;
    select * into target from public.takeoff_item_send_targets t where (t.tenant_id,t.project_id,t.version_id,t.item_id,t.id)=
      (p_tenant,p_project,p_version,item,current_target);
    select * into line from public.estimate_items i where i.id=target.estimate_item_id and i.version_id=p_version;
    if line.id is null then
      blockers:=blockers||jsonb_build_array(jsonb_build_object('reason','part_not_isolated','item_id',item,'target_id',current_target)); continue;
    end if;
    -- The target remembers the unit at send time. A subsequent editor save can
    -- change the physical line, including after redistribution or on a copy.
    if private.takeoff_item_send_unit(line.unit_code) is distinct from target.unit_code then
      blockers:=blockers||jsonb_build_array(jsonb_build_object('reason','line_unit_changed','item_id',item,
        'line_id',line.id,'title',line.title,'unit_code',line.unit_code,'contribution_unit',target.unit_code,
        'message',format('La ligne « %s » est en %s. Son apport est en %s. Vérifiez son unité dans le devis avant de confirmer.',
          line.title,coalesce(line.unit_code,'unité inconnue'),target.unit_code)));
      continue;
    end if;
    if source_<>'withdraw' and exists(select 1 from jsonb_array_elements(change->'parts') f
        where private.takeoff_item_send_unit(f->>'unit') is distinct from target.unit_code or
          (private.takeoff_item_send_folded(f->>'basis') is not null and
            private.takeoff_item_send_folded(f->>'basis') is distinct from target.basis)) then
      blockers:=blockers||jsonb_build_array(jsonb_build_object('reason','identity_conflict','item_id',item,'line_id',line.id)); continue;
    end if;
    if source_<>'withdraw' then
      select coalesce(jsonb_agg(distinct h),'[]') into page_conflicts
        from jsonb_array_elements(change->'parts') f cross join lateral jsonb_array_elements(page_rows) h
        where 'page:'||coalesce(h->>'page','all')=any(private.takeoff_item_send_waiting_pages(
          jsonb_build_object('plan_key',change->'plan_id','page_decisions','[]'::jsonb),f,jsonb_build_array(h)))
          and (not exists(select 1 from jsonb_array_elements(choices_for_pages) d where d->'page'=h->'page')
            or h->'today_estimate_item_ids' ? line.id::text or exists(select 1 from jsonb_array_elements(h->'parts') hp
              where hp->>'estimate_item_id'=line.id::text and (hp->>'plan_key'=change->>'plan_id' and hp->>'item_id'=item::text) is not true));
      if page_conflicts<>'[]' then
        blockers:=blockers||jsonb_build_array(jsonb_build_object('reason','page_held','item_id',item,'line_id',line.id,'pages',page_conflicts));
        continue;
      end if;
    end if;
    select sum(p.quantity),coalesce(sum(p.quantity) filter(where not(p.id=any(own_ids))),0),
      count(*) filter(where not(p.id=any(own_ids))),
      coalesce(jsonb_agg(jsonb_build_object('id',p.id,'job_id',p.job_id,'item_id',p.item_id,
        'plan_logical_id',p.plan_logical_id,'kind',p.kind,'pages',p.pages,'quantity',p.quantity,'unit',p.unit)
        order by p.id) filter(where not(p.id=any(own_ids))),'[]'::jsonb)
      into old_sum,keep_sum,keep_count,kept_parts from public.takeoff_item_send_parts p
      where p.target_id=current_target and p.state='live';
    ref:=null; legacy:=0; protective:=0;
    if target.line_kind='dpgf_line' then
      ref:=private.takeoff_item_send_dpgf_reference(p_tenant,line.source_metadata);
      select coalesce(sum(l.quantity),0),coalesce(sum(l.protective),0) into legacy,protective
        from private.takeoff_item_send_legacy_dpgf_parts(line.source_metadata,job) l;
    end if;
    desired:=private.takeoff_item_send_composed(ref,legacy+keep_sum+(change->>'quantity')::numeric,protective,
      private.takeoff_item_send_length_factor(target.unit_code));
    expected:=private.takeoff_item_send_composed(ref,legacy+old_sum,protective,private.takeoff_item_send_length_factor(target.unit_code));
    after_qty:=desired;
    if source_='withdraw' and keep_count=0 then
      select b into protection from jsonb_array_elements(private.takeoff_revision_line_protections(
        p_tenant,p_actor,p_project,p_version,item,p_module)) b where b->>'line_id'=line.id::text limit 1;
      if protection is not null then blockers:=blockers||jsonb_build_array(jsonb_build_object('reason','last_line_protected',
        'item_id',item,'line',protection)); continue; end if;
      action:='delete_line'; after_qty:=null;
    elsif line.quantity is distinct from expected then
      offered_line_choices:=array_append(offered_line_choices,line.id);
      choice_:=p_choices#>>array['lines',line.id::text];
      if choice_='keep_entry' and (ref is null or line.quantity>=desired) then after_qty:=line.quantity;
      elsif choice_ is distinct from 'use_retained' then
        blockers:=blockers||jsonb_build_array(jsonb_build_object('reason','typed_line','item_id',item,
          'line_id',line.id,'title',line.title,'entered',line.quantity,'retained',desired,'reference',ref)); continue;
      end if;
    end if;
    if after_qty is not null and (after_qty<=0 or after_qty>999999999.999 or round(after_qty,3)<>after_qty) then
      blockers:=blockers||jsonb_build_array(jsonb_build_object('reason','quantity_unwritable','item_id',item)); continue;
    end if;
    actions:=actions||jsonb_build_array(jsonb_build_object('action',action,'item_id',item,'target_id',target.id,
      'estimate_item_id',line.id,'title',line.title,'quantity_before',line.quantity,'quantity_after',after_qty,
      'earlier_parts',own_ids,'parts',change->'parts','unit_code',line.unit_code,'price_cents',line.unit_price_ht_cents,
      'kept_quantity',keep_sum,'kept_parts',kept_parts,'breakdown',target.breakdown,'compartment',target.compartment_key,'updated_at',line.updated_at));
  end loop;
  if exists(select 1 from jsonb_each_text(p_choices->'lines') l
      where not coalesce(private.takeoff_uuid_or_null(to_jsonb(l.key))=any(offered_line_choices),false)
        or (l.value in ('keep_entry','use_retained')) is not true)
    or exists(select 1 from jsonb_array_elements_text(p_choices->'leave_out') x
      where not exists(select 1 from jsonb_array_elements(changes) c where c->>'item_id'=x))
    or (select count(*)<>count(distinct x) from jsonb_array_elements_text(p_choices->'leave_out') x) then
    raise exception 'TAKEOFF_REVISION_INVALID' using errcode='22023';
  end if;
  if additions<>'[]' then
    if p_choices#>>'{send_plan,job_id}' is distinct from job::text or
        p_choices#>>'{send_plan,destination,version_id}' is distinct from p_version::text then
      blockers:=blockers||jsonb_build_array(jsonb_build_object('reason','addition_plan_required','item_ids',additions));
    else
      select coalesce(jsonb_agg(f order by c->>'item_id',f->>'observation_id'),'[]') into incoming
        from jsonb_array_elements(changes) c cross join lateral jsonb_array_elements(c->'parts') f where additions ? (c->>'item_id');
      begin
        addition_plan:=private.apply_takeoff_item_send_plan(p_tenant,p_actor,p_module,
          jsonb_build_object('request_id',gen_random_uuid(),'plan',p_choices->'send_plan'),p_receipt,incoming,true);
      exception when sqlstate '40001' or sqlstate '22023' or sqlstate '55000' then
        get stacked diagnostics add_detail=pg_exception_detail;
        blockers:=blockers||jsonb_build_array(jsonb_build_object('reason','addition_refused','item_ids',additions,
          'code',sqlerrm,'detail',nullif(add_detail,'')));
      end;
    end if;
  elsif p_choices ? 'send_plan' then raise exception 'TAKEOFF_REVISION_INVALID' using errcode='22023';
  end if;

  snapshot:=jsonb_build_object('job',public.takeoff_rule_job_stamp(p_tenant,p_project,job),
    'mapping',public.takeoff_mapping_rules_stamp(p_tenant),'peers',public.takeoff_send_peers_stamp(p_tenant,p_version),
    'context',private.takeoff_send_context_stamps(private.takeoff_send_context(p_tenant,p_project,job,p_version)),
    'version_revision',version_row.content_revision,'pages',page_rows,'document',read_.document);
  state_:=jsonb_build_object('receipt_id',p_receipt,'version_id',p_version,'source_job_id',job,'reviewed',reviewed,
    'changes',changes,'addition_plan',addition_plan,'actions',actions,'blockers',blockers,'additions',additions,'left_out',omissions,'choices',p_choices,'snapshot',snapshot);
  return state_||jsonb_build_object('digest',private.takeoff_sha256(state_));
end;
$$;
revoke all on function public.preview_takeoff_contribution_revision(uuid,uuid,uuid,uuid,uuid,boolean,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.preview_takeoff_contribution_revision(uuid,uuid,uuid,uuid,uuid,boolean,jsonb) to service_role;

-- A version-local amendment owns its lines and parts only for this transaction.
create function public.confirm_takeoff_contribution_revision(p_tenant uuid,p_actor uuid,p_project uuid,p_version uuid,
  p_receipt uuid,p_module boolean,p_intent uuid,p_digest text,p_choices jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  job uuid;
  answer uuid;
  prior public.takeoff_item_send_receipts;
  new_receipt uuid:=gen_random_uuid();
  preview jsonb;
  addition jsonb;
  supplied jsonb;
  incoming jsonb;
  action jsonb;
  fact jsonb;
  destination public.takeoff_item_send_targets;
  before_ids uuid[];
  changed_count integer;
  part_ids uuid[]:='{}';
  written uuid[]:='{}';
  vacated uuid[]:='{}';
  results jsonb:='[]';
  result_ jsonb;
  send_marker text:=coalesce(current_setting('mergeone.takeoff_item_send',true),'');
  engine_marker text:=coalesce(current_setting('miaouffrage.estimate_v3_writer',true),'');
begin
  if p_digest is null or p_digest !~ '^[0-9a-f]{64}$' or p_intent is null then
    raise exception 'TAKEOFF_REVISION_INVALID' using errcode='22023';
  end if;
  perform private.takeoff_redistribution_check_scope(p_tenant,p_actor,p_project,p_version,p_module);
  perform pg_advisory_xact_lock_shared(hashtextextended('estimate-calc-policy:'||p_tenant,0));
  perform 1 from public.estimate_projects where id=p_project and tenant_id=p_tenant for no key update;
  perform pg_advisory_xact_lock(hashtextextended('takeoff-item-review:'||p_project,0));
  perform pg_advisory_xact_lock(hashtextextended('takeoff-rules:'||p_version,0));
  perform pg_advisory_xact_lock(hashtextextended(p_version::text,0));
  perform 1 from public.estimate_versions where (tenant_id,project_id,id)=(p_tenant,p_project,p_version) for update;
  job:=private.takeoff_revision_scope(p_tenant,p_project,p_version,p_receipt);
  perform pg_advisory_xact_lock(hashtextextended('takeoff-job-rules:'||job,0));
  perform pg_advisory_xact_lock(hashtextextended('takeoff-job:'||job,0));
  perform 1 from public.takeoff_jobs where id=job for update;
  perform 1 from public.takeoff_launch_requests r join public.takeoff_jobs j on r.id=j.launch_request_id
    where j.id=job for no key update of r;
  perform 1 from public.takeoff_mapping_rules where tenant_id=p_tenant for share;
  -- Lock working and historical answers in one order even when two sibling copies
  -- refer to the same analysis. The old revision's own marks may have moved.
  for answer in select a.id from public.takeoff_item_answers a where a.tenant_id=p_tenant and (a.job_id=job or exists(
      select 1 from public.takeoff_item_send_parts p join public.takeoff_item_answers current_answer
        on current_answer.job_id=job and current_answer.item_id=p.item_id
      where p.version_id=p_version and p.kind='verified_count' and p.state='live' and p.answer_id=a.id)) order by a.id loop
    perform private.lock_takeoff_count_marks_revision(answer);
  end loop;
  -- A concurrent insertion of a use of a line takes KEY SHARE on it. Take UPDATE
  -- before testing its protections, as redistribution does.
  perform 1 from public.estimate_items i where i.version_id=p_version and (
    exists(select 1 from public.takeoff_item_send_targets t join public.takeoff_item_answers a on a.item_id=t.item_id
      where t.version_id=p_version and t.estimate_item_id=i.id and a.job_id=job)
    or i.id in (select private.takeoff_uuid_or_null(e->'estimate_item_id')
      from jsonb_array_elements(p_choices#>'{send_plan,dependencies,lines}') e)) order by i.id for update;
  perform private.takeoff_redistribution_check_scope(p_tenant,p_actor,p_project,p_version,p_module);
  select * into prior from public.takeoff_item_send_receipts where tenant_id=p_tenant and request_id=p_intent;
  if found then
    if prior.command_kind='revise' and prior.amends_receipt_id=p_receipt and prior.version_id=p_version
      and prior.actor_id=p_actor and prior.plan_sha256=p_digest and prior.write_plan->'choices'=p_choices then
      return prior.result||jsonb_build_object('receipt_id',prior.id,'replayed',true);
    end if;
    raise exception 'TAKEOFF_REVISION_INTENT_CONFLICT' using errcode='40001';
  end if;
  preview:=public.preview_takeoff_contribution_revision(p_tenant,p_actor,p_project,p_version,p_receipt,p_module,p_choices);
  if preview->>'digest' is distinct from p_digest then raise exception 'TAKEOFF_REVISION_STALE' using errcode='40001'; end if;
  if preview->'changes'='[]' or preview->'blockers'<>'[]' then
    raise exception 'TAKEOFF_REVISION_DECISION_REQUIRED' using errcode='55000',detail=(preview->'blockers')::text;
  end if;
  if not exists(select 1 from public.draft_locks l where l.version_id=p_version and l.tenant_id=p_tenant
    and l.user_id=p_actor and l.expires_at>clock_timestamp()) then raise exception 'TAKEOFF_REVISION_LEASE' using errcode='55P03'; end if;
  if preview->'additions'<>'[]' then
    supplied:=p_choices->'send_plan';
    if supplied->>'job_id' is distinct from job::text or supplied#>>'{destination,version_id}' is distinct from p_version::text then
      raise exception 'TAKEOFF_REVISION_DECISION_REQUIRED' using errcode='55000';
    end if;
    select jsonb_agg(p order by c->>'item_id',p->>'observation_id') into incoming
      from jsonb_array_elements(preview->'changes') c cross join lateral jsonb_array_elements(c->'parts') p
      where (preview->'additions') ? (c->>'item_id');
    addition:=private.apply_takeoff_item_send_plan(p_tenant,p_actor,p_module,jsonb_build_object('request_id',p_intent,'plan',supplied),
      new_receipt,incoming);
    results:=addition->'lines';
  elsif p_choices ? 'send_plan' then raise exception 'TAKEOFF_REVISION_INVALID' using errcode='22023'; end if;
  perform set_config('mergeone.takeoff_item_send',new_receipt::text,true);
  perform set_config('miaouffrage.estimate_v3_writer',p_version::text,true);
  for action in select value from jsonb_array_elements(preview->'actions') loop
    select * into strict destination from public.takeoff_item_send_targets t where t.id=(action->>'target_id')::uuid
      and (t.tenant_id,t.project_id,t.version_id,t.item_id)=(p_tenant,p_project,p_version,(action->>'item_id')::uuid);
    before_ids:=array(select id::uuid from jsonb_array_elements_text(action->'earlier_parts') id);
    update public.takeoff_item_send_parts as p set state='replaced',replaced_by_receipt_id=new_receipt,replaced_at=statement_timestamp()
      where p.id=any(before_ids) and p.target_id=destination.id and p.job_id=job and p.state='live';
    get diagnostics changed_count=row_count;
    if changed_count<>cardinality(before_ids) or changed_count=0 then raise exception 'TAKEOFF_REVISION_STALE' using errcode='40001'; end if;
    for fact in select value from jsonb_array_elements(action->'parts') loop
      insert into public.takeoff_item_send_parts(tenant_id,project_id,version_id,target_id,receipt_id,job_id,item_id,
        plan_logical_id,kind,answer_id,answer_revision,decision_revision,marks_revision,entry_id,entry_revision,
        observation_ids,takeoff_item_ids,quantity,unit,unit_code,basis,network,material,diameter,pages)
      values(p_tenant,p_project,p_version,destination.id,new_receipt,job,destination.item_id,(fact->>'plan_logical_id')::uuid,
        fact->>'kind',(fact->>'answer_id')::uuid,fact->>'answer_revision',(fact->>'decision_revision')::integer,
        (fact->>'marks_revision')::integer,(fact->>'entry_id')::uuid,(fact->>'entry_revision')::integer,
        case when fact->>'kind'='measured' then array[(fact->>'observation_id')::uuid] else '{}' end,
        case fact->>'kind' when 'measured' then array[(fact->>'takeoff_item_id')::uuid] when 'verified_count' then
          array(select x::uuid from jsonb_array_elements_text(fact->'takeoff_item_ids') x) else '{}' end,
        (fact->>'quantity')::numeric,fact->>'unit',destination.unit_code,destination.basis,destination.network,destination.material,
        destination.diameter,array(select x::integer from jsonb_array_elements_text(fact->'pages') x));
    end loop;
    if action->>'action'='delete_line' then
      if exists(select 1 from public.takeoff_item_send_parts p where p.target_id=destination.id and p.state='live') then
        raise exception 'TAKEOFF_REVISION_STALE' using errcode='40001';
      end if;
      delete from public.estimate_items where id=destination.estimate_item_id and version_id=p_version;
      vacated:=array_append(vacated,destination.id);
    else
      update public.estimate_items set quantity=(action->>'quantity_after')::numeric,updated_at=statement_timestamp()
        where id=destination.estimate_item_id and quantity is distinct from (action->>'quantity_after')::numeric;
      written:=array_append(written,destination.estimate_item_id);
    end if;
    results:=results||jsonb_build_array(action-array['parts','updated_at']);
  end loop;
  perform public.estimate_v3_complete_entry_for_writer(p_version,written);
  perform private.record_takeoff_contribution_pages(p_tenant,p_project,p_version,new_receipt,job,preview#>'{snapshot,document}');
  select coalesce(array_agg(p.id order by p.id),'{}') into part_ids from public.takeoff_item_send_parts p where p.receipt_id=new_receipt;
  result_:=jsonb_build_object('source_job_id',job,'version_id',p_version,'amends_receipt_id',p_receipt,'lines',results,
    'part_ids',part_ids,'left_out',preview->'left_out','reviewed',preview->'reviewed','vacated_target_ids',vacated,
    'sections_created',coalesce(addition->'sections_created','[]'));
  insert into public.takeoff_item_send_receipts(id,tenant_id,project_id,version_id,request_id,command_kind,format_version,
    actor_id,plan_sha256,version_created,write_plan,result,amends_receipt_id)
    values(new_receipt,p_tenant,p_project,p_version,p_intent,'revise',1,p_actor,p_digest,false,preview,result_,p_receipt);
  update public.takeoff_item_send_targets t set vacated_compartment_key=t.compartment_key,compartment_key='vacated:'||t.id
    where t.version_id=p_version and t.id=any(vacated);
  perform set_config('miaouffrage.estimate_v3_writer',engine_marker,true);
  perform set_config('mergeone.takeoff_item_send',send_marker,true);
  return result_||jsonb_build_object('receipt_id',new_receipt,'replayed',false);
end;
$$;
revoke all on function public.confirm_takeoff_contribution_revision(uuid,uuid,uuid,uuid,uuid,boolean,uuid,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.confirm_takeoff_contribution_revision(uuid,uuid,uuid,uuid,uuid,boolean,uuid,text,jsonb) to service_role;

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
      where section.version_id = p_source_version_id and section.estimate_item_id is not null)
    and not exists(select 1 from public.takeoff_item_send_receipts r where r.version_id=p_source_version_id
      and (r.command_kind='revise' or r.write_plan->'revision_head'='true')) then
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
    and ((receipt.command_kind='revise' or receipt.write_plan->'revision_head'='true')
        and not exists(select 1 from public.takeoff_item_send_receipts next where next.amends_receipt_id=receipt.id)
      or exists (select 1 from public.takeoff_item_send_targets as target
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
      'source_job_id', coalesce(receipt.job_id::text, receipt.write_plan ->> 'source_job_id'))
      || case when receipt.command_kind='revise' or receipt.write_plan ? 'revision_head'
            or exists(select 1 from public.takeoff_item_send_receipts next where next.amends_receipt_id=receipt.id)
          then jsonb_build_object('revision_head',(receipt.command_kind='revise' or coalesce(receipt.write_plan->'revision_head'='true',false))
              and not exists(select 1 from public.takeoff_item_send_receipts next where next.amends_receipt_id=receipt.id),
            'reviewed',(select coalesce(jsonb_object_agg(e.key,e.value||jsonb_build_object('work_revision',0)),'{}')
              from jsonb_each(coalesce(receipt.result->'reviewed',receipt.write_plan->'reviewed','{}')) e))
          else '{}'::jsonb end,
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

-- Table and detail use the same version-local receipt and compare the actual
-- sent parts with the member's pending choice. Issued versions remain readable.
create function public.read_takeoff_contribution_revision(p_tenant uuid,p_project uuid,p_version uuid,p_job uuid,p_items uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  head public.takeoff_item_send_receipts;
  v public.estimate_versions;
  items jsonb;
  editable boolean;
begin
  if private.can_access_takeoff_scope(p_tenant,p_project,null,false) is not true or
    private.can_access_takeoff_scope(p_tenant,p_project,p_version,false) is not true
    or public.estimate_version_holds_analysis(p_tenant,p_version,p_job) is not true then
    raise exception 'TAKEOFF_REVISION_SCOPE' using errcode='42501';
  end if;
  if p_items is null or cardinality(p_items)>1000 or array_position(p_items,null) is not null then
    raise exception 'TAKEOFF_REVISION_INVALID' using errcode='22023';
  end if;
  select * into strict v from public.estimate_versions where (tenant_id,project_id,id)=(p_tenant,p_project,p_version);
  select r.* into head from public.takeoff_item_send_receipts r where (r.tenant_id,r.project_id,r.version_id)=(p_tenant,p_project,p_version)
    and (r.job_id=p_job or (r.command_kind in ('revise','copy') and r.write_plan->>'source_job_id'=p_job::text))
    and r.write_plan->'revision_head' is distinct from 'false'::jsonb
    and not exists(select 1 from public.takeoff_item_send_receipts next where next.amends_receipt_id=r.id)
    order by (r.command_kind='revise') desc,(r.write_plan->'revision_head'='true') desc nulls last,r.created_at desc,r.id limit 1;
  editable:=v.status='draft' and v.seal_hash is null and v.calc_engine_version=3 and head.id is not null
    and private.can_access_takeoff_scope(p_tenant,p_project,null,true) is true;
  with corrections as materialized (
    select c from private.takeoff_revision_items(p_tenant,p_project,p_version,head.id,p_job) c
  ) select coalesce(jsonb_agg(jsonb_build_object('item_id',a.item_id,'answer_id',a.id,'answer_revision',a.content_sha256,
    'current',private.takeoff_count_answer_is_current(a),'sent',coalesce(parts.all_,'[]'),'correction',c.c-'before_parts'-'parts'-'facts',
    'sources',private.takeoff_revision_sources(a),'work_revision',coalesce(w.revision,0)) order by a.item_id),'[]') into items
    from public.takeoff_item_answers a left join corrections c on c.c->>'answer_id'=a.id::text
    left join lateral (select max(w.revision) as revision from private.takeoff_revision_choices w where
      (w.tenant_id,w.project_id,w.version_id,w.job_id,w.answer_id)=(p_tenant,p_project,p_version,p_job,a.id)) w on true
    left join lateral (select jsonb_agg(jsonb_build_object('id',p.id,'receipt_id',p.receipt_id,'target_id',p.target_id,
      'estimate_item_id',t.estimate_item_id,'kind',p.kind,'quantity',p.quantity,'unit',p.unit,'marks_revision',p.marks_revision,
      'entry_id',p.entry_id,'entry_revision',p.entry_revision,
      'pages',p.pages,'compartment',t.compartment_key,'line_title',i.title) order by p.id) as all_
      from public.takeoff_item_send_parts p join public.takeoff_item_send_targets t on t.id=p.target_id
      left join public.estimate_items i on i.id=t.estimate_item_id
      where (p.version_id,p.job_id,p.answer_id)=(p_version,p_job,a.id) and p.state='live') parts on true
    where (a.tenant_id,a.project_id,a.job_id)=(p_tenant,p_project,p_job) and not a.comparison_only and a.item_id=any(p_items);
  return jsonb_build_object('receipt_id',head.id,'job_id',p_job,'version_id',p_version,'editable',editable,'items',items);
end;
$$;
revoke all on function public.read_takeoff_contribution_revision(uuid,uuid,uuid,uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.read_takeoff_contribution_revision(uuid,uuid,uuid,uuid,uuid[]) to authenticated;

commit;
