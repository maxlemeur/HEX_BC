-- TI-686 D12 (lot 2, M2). No remote application is authorized here.
-- A quantity the plan cannot show (rule non_observable) is entered when its author attests it with what it rests on:
-- one category among six, and a note, required for an hypothesis (10 to 500 code points), at most 500 otherwise. A
-- bare edit of the quantity no longer settles NON_OBSERVABLE_TO_ENTER: the server computes a line as entered when it
-- carries a category (src/lib/takeoff/rules/recompute-server.ts), so the entry survives the deletion of its author
-- (quantity_entered_by goes null, the category stays).
-- The categories are provisional (H6, pending the owner's agreement): a check constraint, simpler to change than an
-- enum, kept equal to src/lib/takeoff/quantity-entry.ts, which refuses the same values first. The note is measured as
-- the acceptance notes are (migration 20261110094500): code points, without the ASCII blanks at its ends.
-- No data is rewritten: an entry attested before has no category and is to enter again at the next computation (the
-- rule keeps its version; the failure brings its own key).
alter table public.takeoff_items
  add column quantity_entry_category text,
  add column quantity_entry_note text,
  add constraint takeoff_items_quantity_entry_category_check check (quantity_entry_category is null
    or quantity_entry_category in ('site_survey', 'other_drawing', 'dpgf_cctp', 'written_confirmation',
      'documented_calculation', 'hypothesis')),
  add constraint takeoff_items_quantity_entry_note_check check (quantity_entry_note is null
    or (quantity_entry_category is not null
      and char_length(regexp_replace(quantity_entry_note, '^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$', '', 'g')) between 1 and 500)),
  add constraint takeoff_items_quantity_entry_hypothesis_check check (quantity_entry_category is distinct from 'hypothesis'
    or char_length(regexp_replace(coalesce(quantity_entry_note, ''), '^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$', '', 'g'))
      between 10 and 500),
  add constraint takeoff_items_quantity_entry_attested_check check (quantity_entry_category is null
    or quantity_entered_at is not null);

comment on column public.takeoff_items.quantity_entry_category is
  'What the attested quantity rests on (TI-686 D12): site_survey, other_drawing, dpgf_cctp, written_confirmation, documented_calculation or hypothesis; cleared with the attestation.';
comment on column public.takeoff_items.quantity_entry_note is
  'What the entered quantity rests on, in words; required for an hypothesis (10 to 500 characters), at most 500 otherwise.';

-- From 20261107123425_takeoff_network_material_decisions.sql. Unchanged: the field whitelist, the content-attestation
-- invalidation, the verification and its level C proof, the entry attested by its author, now, and the rule inputs
-- that make evaluated results stale. New (D12):
-- - the category and its note are written with an attestation (a new quantity_entered_at), never alone;
-- - an attestation with an author carries its category;
-- - a quantity changed without a new attestation clears the category and the note with it;
-- - the rules read the category: changing it makes evaluated results stale.
create or replace function public.enforce_authenticated_takeoff_item_fields()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  parent_status public.takeoff_job_status;
  parent_level public.takeoff_job_level;
begin
  if current_user <> 'authenticated'
    or coalesce(current_setting('app.takeoff_apply_atomic', true), '') = 'on'
  then
    return new;
  end if;

  select job.status, job.level
    into parent_status, parent_level
  from public.takeoff_jobs as job
  where job.id = new.job_id
    and job.tenant_id = new.tenant_id;

  if parent_status is distinct from 'completed'::public.takeoff_job_status then
    raise exception 'TAKEOFF_ITEM_COMPLETED_JOB_REQUIRED' using errcode = '42501';
  end if;

  if (to_jsonb(new) - array[
    'designation', 'quantity', 'unit', 'is_excluded', 'exclusion_reason',
    'is_verified', 'verification_justification', 'verified_at', 'verified_by', 'evidence', 'source_page',
    'quantity_entered_at', 'quantity_entered_by', 'quantity_entry_category', 'quantity_entry_note', 'updated_at'
  ]) is distinct from (to_jsonb(old) - array[
    'designation', 'quantity', 'unit', 'is_excluded', 'exclusion_reason',
    'is_verified', 'verification_justification', 'verified_at', 'verified_by', 'evidence', 'source_page',
    'quantity_entered_at', 'quantity_entered_by', 'quantity_entry_category', 'quantity_entry_note', 'updated_at'
  ]) then
    raise exception 'TAKEOFF_ITEM_TRUSTED_FIELDS_IMMUTABLE' using errcode = '42501';
  end if;

  -- Any content edit invalidates an earlier attestation unless the caller
  -- explicitly re-attests the new value in the same statement.
  if old.is_verified
    and (
      new.designation is distinct from old.designation
      or new.quantity is distinct from old.quantity
      or new.unit is distinct from old.unit
      or new.is_excluded is distinct from old.is_excluded
      or new.exclusion_reason is distinct from old.exclusion_reason
      or new.evidence is distinct from old.evidence
      or new.source_page is distinct from old.source_page
    )
    and new.is_verified is not distinct from old.is_verified
    and new.verified_at is not distinct from old.verified_at
    and new.verified_by is not distinct from old.verified_by
  then
    new.is_verified := false;
    new.verified_at := null;
    new.verified_by := null;
  end if;

  if new.is_verified is distinct from old.is_verified
    or new.verified_at is distinct from old.verified_at
    or new.verified_by is distinct from old.verified_by
  then
    if new.is_verified then
      if new.verified_by is distinct from (select auth.uid())
        or new.verified_at is null
      then
        raise exception 'TAKEOFF_ITEM_VERIFICATION_INVALID' using errcode = '42501';
      end if;
    elsif new.verified_by is not null or new.verified_at is not null then
      raise exception 'TAKEOFF_ITEM_VERIFICATION_INVALID' using errcode = '42501';
    end if;
  end if;

  if parent_level = 'C'::public.takeoff_job_level
    and new.is_verified
    and (
      nullif(btrim(new.evidence), '') is null
      or new.source_page is null
      or new.source_page < 1
    )
  then
    raise exception 'TAKEOFF_ITEM_VERIFICATION_PROOF_REQUIRED' using errcode = '42501';
  end if;

  -- TI-686 D12: what an entry rests on is written with its attestation (a new time), never on its own.
  if (new.quantity_entry_category is distinct from old.quantity_entry_category
      or new.quantity_entry_note is distinct from old.quantity_entry_note)
    and new.quantity_entered_at is not distinct from old.quantity_entered_at
  then
    raise exception 'TAKEOFF_ITEM_QUANTITY_ENTRY_INVALID' using errcode = '42501';
  end if;

  -- TI-664: a typed quantity is attested by its author, now; a quantity changed
  -- without a new attestation is no longer the one entered, nor what it rested on.
  if new.quantity is distinct from old.quantity
    and new.quantity_entered_by is not distinct from old.quantity_entered_by
    and new.quantity_entered_at is not distinct from old.quantity_entered_at
  then
    new.quantity_entered_by := null;
    new.quantity_entered_at := null;
    new.quantity_entry_category := null;
    new.quantity_entry_note := null;
  end if;

  if new.quantity_entered_by is distinct from old.quantity_entered_by
    or new.quantity_entered_at is distinct from old.quantity_entered_at
  then
    if new.quantity_entered_by is not null then
      -- TI-686 D12: an attestation says what the quantity rests on.
      if new.quantity_entered_by is distinct from (select auth.uid())
        or new.quantity_entered_at is null
        or new.quantity_entry_category is null
      then
        raise exception 'TAKEOFF_ITEM_QUANTITY_ENTRY_INVALID' using errcode = '42501';
      end if;
    elsif new.quantity_entered_at is not null then
      raise exception 'TAKEOFF_ITEM_QUANTITY_ENTRY_INVALID' using errcode = '42501';
    end if;
  end if;

  -- TI-664: the rules read the quantity, its entry (TI-686 D12: its category),
  -- the unit, the exclusion and the page (the scale rule) as they are now;
  -- after a client edit their results wait for the server.
  if (old.rules_evaluated_at is not null or old.rules_stale)
    and (
      new.quantity is distinct from old.quantity
      or new.quantity_entered_by is distinct from old.quantity_entered_by
      or new.quantity_entry_category is distinct from old.quantity_entry_category
      or new.unit is distinct from old.unit
      or new.is_excluded is distinct from old.is_excluded
      or new.source_page is distinct from old.source_page
    )
  then
    new.rules_stale := true;
    new.rules_stale_at := pg_catalog.clock_timestamp();
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_authenticated_takeoff_item_fields()
  from public;

-- From 20261107123425_takeoff_network_material_decisions.sql; the review saves the entry's two new keys.
create or replace function public.update_takeoff_item_for_review(
  p_tenant_id uuid,
  p_job_id uuid,
  p_item_id uuid,
  p_expected_updated_at timestamptz,
  p_fields jsonb
)
returns setof public.takeoff_items
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  version_id uuid;
  assignments text;
begin
  if pg_catalog.jsonb_typeof(p_fields) is distinct from 'object'
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(p_fields) as field(name)
      where field.name <> all (array[
        'designation', 'quantity', 'unit', 'source_page', 'is_excluded', 'exclusion_reason', 'is_verified',
        'verified_at', 'verified_by', 'verification_justification', 'evidence', 'quantity_entered_at', 'quantity_entered_by',
        'quantity_entry_category', 'quantity_entry_note', 'updated_at'
      ])
    )
  then
    raise exception 'TAKEOFF_ITEM_PATCH_INVALID' using errcode = '22023';
  end if;

  select pg_catalog.string_agg(pg_catalog.format('%I = patch.%I', field.name, field.name), ', ' order by field.name)
    into assignments
  from pg_catalog.jsonb_object_keys(p_fields) as field(name);
  if assignments is null then
    return;
  end if;

  select job.estimate_version_id
    into version_id
  from public.takeoff_jobs as job
  where job.id = p_job_id
    and job.tenant_id = p_tenant_id;
  if version_id is null then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-rules:' || version_id::text, 0));

  return query execute pg_catalog.format(
    'update public.takeoff_items as item set %s
     from pg_catalog.jsonb_populate_record(null::public.takeoff_items, $1) as patch
     where item.id = $2 and item.job_id = $3 and item.tenant_id = $4 and item.updated_at = $5
     returning item.*',
    assignments
  ) using p_fields, p_item_id, p_job_id, p_tenant_id, p_expected_updated_at;
end;
$$;

revoke all on function public.update_takeoff_item_for_review(uuid, uuid, uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.update_takeoff_item_for_review(uuid, uuid, uuid, timestamptz, jsonb) to authenticated, service_role;

-- From 20261107123425_takeoff_network_material_decisions.sql; the entry's category and note are journaled (fields 10
-- and 11), in the save's transaction, by the signed-in user.
create or replace function public.audit_takeoff_item_decisions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor uuid := (select auth.uid());
begin
  if pg_catalog.current_setting('role', true) is distinct from 'authenticated'
    or coalesce(pg_catalog.current_setting('app.takeoff_apply_atomic', true), '') = 'on'
  then
    return null;
  end if;

  insert into public.audit_logs (tenant_id, user_id, table_name, record_id, estimate_version_id, action, after_data)
  select new.tenant_id, actor, 'takeoff_items', new.job_id, job.estimate_version_id, change.action,
    pg_catalog.jsonb_build_object('schema_version', 1, 'action', change.action, 'job_id', new.job_id,
      'tenant_id', new.tenant_id, 'user_id', actor, 'metadata', change.metadata)
  from (
    select field.position,
      case when field.name = 'is_excluded' and new.is_excluded then 'takeoff.item.excluded' else 'takeoff.item.modified' end
        as action,
      case when field.name = 'is_excluded' and new.is_excluded
        then pg_catalog.jsonb_build_object('item_id', new.id, 'is_excluded', true, 'reason', new.exclusion_reason)
        else pg_catalog.jsonb_build_object('item_id', new.id, 'field', field.name, 'previous_value', field.previous,
          'next_value', field.next, 'reason', null)
          || case when field.name = 'is_verified' and new.is_verified then pg_catalog.jsonb_build_object(
            'justification', new.verification_justification,
            'rule_failures', coalesce((select proof.failure_keys from takeoff_internal.rule_failure_proofs proof
              where proof.item_id = new.id), public.takeoff_rule_failure_keys(new.rule_results)))
            else '{}'::jsonb end
      end as metadata
    from (values
      (1, 'designation', pg_catalog.to_jsonb(old.designation), pg_catalog.to_jsonb(new.designation)),
      (2, 'quantity', pg_catalog.to_jsonb(old.quantity), pg_catalog.to_jsonb(new.quantity)),
      (3, 'quantity_entered_by', pg_catalog.to_jsonb(old.quantity_entered_by), pg_catalog.to_jsonb(new.quantity_entered_by)),
      (4, 'unit', pg_catalog.to_jsonb(old.unit), pg_catalog.to_jsonb(new.unit)),
      (5, 'source_page', pg_catalog.to_jsonb(old.source_page), pg_catalog.to_jsonb(new.source_page)),
      (6, 'evidence', pg_catalog.to_jsonb(old.evidence), pg_catalog.to_jsonb(new.evidence)),
      (7, 'is_excluded', pg_catalog.to_jsonb(old.is_excluded), pg_catalog.to_jsonb(new.is_excluded)),
      -- The reason of a line that stays excluded (an exclusion carries its own, an inclusion clears it).
      (8, 'exclusion_reason',
        case when old.is_excluded is not distinct from new.is_excluded then pg_catalog.to_jsonb(old.exclusion_reason) end,
        case when old.is_excluded is not distinct from new.is_excluded then pg_catalog.to_jsonb(new.exclusion_reason) end),
      (9, 'is_verified', pg_catalog.to_jsonb(old.is_verified), pg_catalog.to_jsonb(new.is_verified)),
      (10, 'quantity_entry_category', pg_catalog.to_jsonb(old.quantity_entry_category),
        pg_catalog.to_jsonb(new.quantity_entry_category)),
      (11, 'quantity_entry_note', pg_catalog.to_jsonb(old.quantity_entry_note), pg_catalog.to_jsonb(new.quantity_entry_note))
    ) as field(position, name, previous, next)
    where field.previous is distinct from field.next
      -- A verification another user takes over is theirs (true to true, in their name).
      or (field.name = 'is_verified' and new.is_verified and (old.verified_by is distinct from new.verified_by
        or old.verification_justification is distinct from new.verification_justification))
  ) as change
  left join public.takeoff_jobs as job on job.id = new.job_id and job.tenant_id = new.tenant_id
  order by change.position;

  return null;
end;
$$;

revoke all on function public.audit_takeoff_item_decisions() from public, anon, authenticated, service_role;

drop trigger audit_takeoff_item_decisions on public.takeoff_items;
create trigger audit_takeoff_item_decisions after update on public.takeoff_items for each row
when (old.designation is distinct from new.designation or old.quantity is distinct from new.quantity
  or old.quantity_entered_by is distinct from new.quantity_entered_by or old.unit is distinct from new.unit
  or old.source_page is distinct from new.source_page or old.evidence is distinct from new.evidence
  or old.is_excluded is distinct from new.is_excluded or old.exclusion_reason is distinct from new.exclusion_reason
  or old.is_verified is distinct from new.is_verified or old.verified_by is distinct from new.verified_by
  or old.verification_justification is distinct from new.verification_justification
  or old.quantity_entry_category is distinct from new.quantity_entry_category
  or old.quantity_entry_note is distinct from new.quantity_entry_note)
execute function public.audit_takeoff_item_decisions();
