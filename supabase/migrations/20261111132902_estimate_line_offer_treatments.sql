-- TI-682 (D12, Q2, Q4): the internal reason of an exclusion and the reserve written in the offer.
-- No remote application is authorized here.
--
-- A line of an engine 3 draft carries the estimator's decision under source_metadata.offer_treatment, the key
-- TI-686 reserved outside the takeoff provision marker (H18):
--   {"version":1,"kind":"internal_exclusion","reason_code":"…","note":null|"…","decided_by":"…","decided_at":"…"}
--   {"version":1,"kind":"offer_reserve","basis":"private_estimate"|"indicative_quantities","text":"…",
--    "sentence":"Réserve — « <titre> » : <texte>","decided_by":"…","decided_at":"…"}
-- A reserve is written in the offer as one sentence of estimate_versions.exclusions (« Précisions et limites de
-- prestation »), the text the frozen client contract, the seal, the PDF and the portal already carry: no contract,
-- validator or document changes. The TypeScript twin of the shape and of the text rules is
-- src/lib/estimates/offer-treatment.ts.
--
-- One writer, public.set_estimate_line_offer_treatments, security invoker: the row-level policies of the caller
-- decide who writes (the owner engineer or an administrator of the tenant, on a draft). It writes the decisions and
-- the offer text in one transaction, under the v3 writer contract of the version (a v3 line's source_metadata is
-- not writable through the Data API), and touches no amount. It guarantees that:
-- - the caller read the version it changes (content revision) and holds its draft lock in this session, checked in
--   the transaction like the other writers of a draft do;
-- - a decision fits the status of its line: a reason on a line left out of the price, a reserve on a priced or
--   « Non chiffrée » line;
-- - a reserve states its basis, and its sentence stands alone on a line of the offer text it is saved with;
-- - the author and the instant are the database's (auth.uid(), now()), never the caller's.
-- Every written line bumps the content revision through the existing trigger, so a freeze, a generated PDF or an
-- approval taken before the change is stale, like after any other edit. No data is rewritten.
begin;

create function public.set_estimate_line_offer_treatments(
  p_version_id uuid,
  p_expected_content_revision bigint,
  p_draft_lock_session_id uuid,
  p_treatments jsonb,
  p_exclusions text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target public.estimate_versions;
  lock_row public.draft_locks;
  entry jsonb;
  treatment jsonb;
  note_value text;
  text_value text;
  sentence_value text;
  entry_count integer;
  line_count integer;
  written_count integer;
  next_exclusions text := nullif(pg_catalog.btrim(coalesce(p_exclusions, ''), E' \t\r\n'), '');
  decided_at text := pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  old_writer text := coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true), '');
begin
  if actor is null then
    raise exception using errcode = '42501', message = 'ESTIMATE_OFFER_TREATMENT_FORBIDDEN';
  end if;
  if p_version_id is null or p_expected_content_revision is null
    or pg_catalog.jsonb_typeof(p_treatments) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_treatments) not between 1 and 500
    or pg_catalog.char_length(coalesce(next_exclusions, '')) > 5000
  then
    raise exception using errcode = '22023', message = 'ESTIMATE_OFFER_TREATMENT_INVALID';
  end if;

  select version.* into target
  from public.estimate_versions as version
  where version.id = p_version_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ESTIMATE_OFFER_TREATMENT_NOT_FOUND';
  end if;
  if target.calc_engine_version is distinct from 3 then
    raise exception using errcode = '0A000', message = 'ESTIMATE_OFFER_TREATMENT_ENGINE_NOT_SUPPORTED';
  end if;
  if target.status is distinct from 'draft'::public.estimate_status then
    raise exception using errcode = '55000', message = 'ESTIMATE_OFFER_TREATMENT_READ_ONLY';
  end if;
  if target.content_revision is distinct from p_expected_content_revision then
    raise exception using errcode = '40001', message = 'ESTIMATE_OFFER_TREATMENT_STALE';
  end if;
  select draft_lock.* into lock_row
  from public.draft_locks as draft_lock
  where draft_lock.version_id = target.id
    and draft_lock.tenant_id = target.tenant_id
  for update nowait;
  if not found or lock_row.user_id is distinct from actor
    or p_draft_lock_session_id is null or lock_row.session_id is distinct from p_draft_lock_session_id
    or lock_row.expires_at is null or lock_row.expires_at <= pg_catalog.clock_timestamp()
  then
    raise exception using errcode = '55000', message = 'ESTIMATE_OFFER_TREATMENT_LOCK_REQUIRED';
  end if;

  for entry in select value from pg_catalog.jsonb_array_elements(p_treatments) loop
    if pg_catalog.jsonb_typeof(entry) is distinct from 'object'
      or not (entry ?& array['item_id', 'treatment'])
      or entry - array['item_id', 'treatment'] <> '{}'::jsonb
      or pg_catalog.jsonb_typeof(entry -> 'item_id') is distinct from 'string'
      or (entry ->> 'item_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then
      raise exception using errcode = '22023', message = 'ESTIMATE_OFFER_TREATMENT_INVALID';
    end if;
    treatment := entry -> 'treatment';
    if treatment = 'null'::jsonb then
      continue;
    end if;
    if pg_catalog.jsonb_typeof(treatment) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'ESTIMATE_OFFER_TREATMENT_INVALID';
    end if;
    if treatment ->> 'kind' = 'internal_exclusion' then
      note_value := treatment ->> 'note';
      if treatment - array['kind', 'reason_code', 'note'] <> '{}'::jsonb
        or not (treatment ?& array['kind', 'reason_code', 'note'])
        or pg_catalog.jsonb_typeof(treatment -> 'reason_code') is distinct from 'string'
        or (treatment ->> 'reason_code') not in (
          'other_lot', 'client_supplied', 'outside_consultation', 'covered_elsewhere', 'not_applicable', 'other')
        or pg_catalog.jsonb_typeof(treatment -> 'note') not in ('string', 'null')
        or (note_value is not null and (
          pg_catalog.char_length(note_value) not between 1 and 500
          or note_value <> pg_catalog.btrim(pg_catalog.regexp_replace(note_value, '\s+', ' ', 'g'))))
        or (treatment ->> 'reason_code' = 'other' and note_value is null)
      then
        raise exception using errcode = '22023', message = 'ESTIMATE_OFFER_TREATMENT_INVALID';
      end if;
    elsif treatment ->> 'kind' = 'offer_reserve' then
      text_value := treatment ->> 'text';
      sentence_value := treatment ->> 'sentence';
      if treatment - array['kind', 'basis', 'text', 'sentence'] <> '{}'::jsonb
        or not (treatment ?& array['kind', 'basis', 'text', 'sentence'])
        or pg_catalog.jsonb_typeof(treatment -> 'basis') is distinct from 'string'
        or (treatment ->> 'basis') not in ('private_estimate', 'indicative_quantities')
        or pg_catalog.jsonb_typeof(treatment -> 'text') is distinct from 'string'
        or pg_catalog.jsonb_typeof(treatment -> 'sentence') is distinct from 'string'
        or pg_catalog.char_length(text_value) not between 1 and 500
        or text_value <> pg_catalog.btrim(pg_catalog.regexp_replace(text_value, '\s+', ' ', 'g'))
        or pg_catalog.char_length(sentence_value) > 800
        or sentence_value <> pg_catalog.btrim(pg_catalog.regexp_replace(sentence_value, '\s+', ' ', 'g'))
        or pg_catalog.left(sentence_value, 12) <> 'Réserve — « '
        or pg_catalog.right(sentence_value, pg_catalog.char_length(' » : ' || text_value)) <> ' » : ' || text_value
      then
        raise exception using errcode = '22023', message = 'ESTIMATE_OFFER_TREATMENT_INVALID';
      end if;
      -- The reserve is written in the offer: its sentence stands alone on a line of the text saved with it.
      if not exists (
        select 1
        from pg_catalog.regexp_split_to_table(coalesce(next_exclusions, ''), '\r?\n') as offer_line(value)
        where pg_catalog.btrim(offer_line.value, E' \t\r') = sentence_value
      ) then
        raise exception using errcode = '22023', message = 'ESTIMATE_OFFER_RESERVE_NOT_WRITTEN';
      end if;
    else
      raise exception using errcode = '22023', message = 'ESTIMATE_OFFER_TREATMENT_INVALID';
    end if;
  end loop;

  select pg_catalog.count(*), pg_catalog.count(distinct value ->> 'item_id')
    into entry_count, line_count
  from pg_catalog.jsonb_array_elements(p_treatments);
  if entry_count <> line_count then
    raise exception using errcode = '22023', message = 'ESTIMATE_OFFER_TREATMENT_INVALID';
  end if;

  -- Every entry names a line of this version the caller can read, and its decision fits the line's status.
  select pg_catalog.count(*) into line_count
  from pg_catalog.jsonb_array_elements(p_treatments) as requested(value)
  join public.estimate_items as item
    on item.id = (requested.value ->> 'item_id')::uuid
   and item.version_id = target.id
   and item.tenant_id = target.tenant_id
   and item.item_type = 'line'::public.estimate_item_type
  where requested.value -> 'treatment' = 'null'::jsonb
    or (requested.value #>> '{treatment,kind}' = 'internal_exclusion' and item.pricing_status in (
      'included'::public.estimate_line_pricing_status, 'for_memory'::public.estimate_line_pricing_status,
      'out_of_scope'::public.estimate_line_pricing_status, 'not_applicable'::public.estimate_line_pricing_status))
    or (requested.value #>> '{treatment,kind}' = 'offer_reserve' and item.pricing_status in (
      'priced'::public.estimate_line_pricing_status, 'not_priced'::public.estimate_line_pricing_status));
  if line_count <> entry_count then
    raise exception using errcode = '22023', message = 'ESTIMATE_OFFER_TREATMENT_LINE_MISMATCH';
  end if;

  -- A v3 draft's lines are written under its writer contract (no amount is touched).
  perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', target.id::text, true);

  update public.estimate_items as item
  set source_metadata = case
    when requested.value -> 'treatment' = 'null'::jsonb
      then coalesce(item.source_metadata, '{}'::jsonb) - 'offer_treatment'
    else coalesce(item.source_metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object('offer_treatment',
      pg_catalog.jsonb_build_object('version', 1) || (requested.value -> 'treatment')
        || pg_catalog.jsonb_build_object('decided_by', actor, 'decided_at', decided_at))
  end
  from pg_catalog.jsonb_array_elements(p_treatments) as requested(value)
  where item.id = (requested.value ->> 'item_id')::uuid
    and item.version_id = target.id
    and item.tenant_id = target.tenant_id
    and item.item_type = 'line'::public.estimate_item_type;
  get diagnostics written_count = row_count;
  -- A line the caller reads but may not write (row-level policies) is refused, never skipped.
  if written_count <> entry_count then
    raise exception using errcode = '42501', message = 'ESTIMATE_OFFER_TREATMENT_FORBIDDEN';
  end if;

  if target.exclusions is distinct from next_exclusions then
    update public.estimate_versions as version
    set exclusions = next_exclusions
    where version.id = target.id
      and version.tenant_id = target.tenant_id;
    get diagnostics written_count = row_count;
    if written_count <> 1 then
      raise exception using errcode = '42501', message = 'ESTIMATE_OFFER_TREATMENT_FORBIDDEN';
    end if;
  end if;

  perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', old_writer, true);

  return (
    select pg_catalog.jsonb_build_object(
      'version_id', version.id,
      'content_revision', version.content_revision,
      'updated_at', version.updated_at,
      'exclusions', version.exclusions,
      'updated_count', entry_count)
    from public.estimate_versions as version
    where version.id = target.id
  );
end;
$$;

comment on function public.set_estimate_line_offer_treatments(uuid, bigint, uuid, jsonb, text) is
  'TI-682 D12: writes or removes source_metadata.offer_treatment (internal exclusion reason, or reserve written in the offer with its basis) on lines of an engine 3 draft, and the offer text holding the reserve sentences, in one transaction. Security invoker: the caller''s row-level policies decide who writes, under the draft lock of its session. The author and instant are the database''s; no amount changes.';

revoke all on function public.set_estimate_line_offer_treatments(uuid, bigint, uuid, jsonb, text) from public, anon;
grant execute on function public.set_estimate_line_offer_treatments(uuid, bigint, uuid, jsonb, text) to authenticated, service_role;

commit;
