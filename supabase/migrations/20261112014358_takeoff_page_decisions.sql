-- TI-682 lot D, PR 2. No remote application is authorized here.
-- A plan page enters an estimate once. Re-measuring a page replaces its earlier measure; keeping both is an explicit,
-- reasoned decision; and the application refuses a page another takeoff already brought without a decision.
--
-- What this migration adds:
-- - SQL twins of the TypeScript reader of PR 1 (src/lib/takeoff/page-contributions.ts), run on the same vectors
--   (takeoff-page-contributions-twin.test.sql): private.takeoff_same_page, private.takeoff_line_page_identity,
--   private.takeoff_estimate_line_item_ids, private.takeoff_pages_already_in_estimate; and their reader over a version,
--   private.takeoff_page_contributions. The earlier contribution of a page is read in the estimate's lines, traced back
--   to the frozen takeoff lines they came from (a deleted line no longer counts, a copied version keeps its provenance).
-- - public.takeoff_page_decisions: per takeoff and page, « replace » (line by line: the estimate line keeps its identity,
--   title, price, category and settings; its quantity loses the page's earlier part and receives the new one) or
--   « keep_both » (coded reason). Written only by public.record_takeoff_page_decisions, frozen once the takeoff is
--   applied, read by the tenant's members. Attached to the takeoffs, never copied with a version.
-- - private.takeoff_prepare_page_decisions (before anything is written: the decisions against the estimate as it is),
--   private.takeoff_replace_pages (after the atomic application: the replacement), private.assert_takeoff_pages_once
--   (last: every earlier contribution left on a page this takeoff reads is one a decision keeps).
-- - Both overloads of public.apply_takeoff_job_guarded_atomic, copied from their newest definitions, both in
--   20261110094503_takeoff_apply_provisions.sql (no later migration redefines them), with the lines marked « TI-682 D ».
--   They take the version's lock first, as before: the decisions, the replacement and the guard run under it.
--   private.finalize_takeoff_lengths and private.takeoff_mark_provisions (20261111124022) are called, not redefined;
--   apply_takeoff_job_atomic, commit_estimate_batch and the version duplication are untouched.
-- Errors: TAKEOFF_PAGE_ALREADY_APPLIED (23514), TAKEOFF_PAGE_DECISION_STALE (40001), TAKEOFF_PAGE_DECISION_INVALID
-- (22023), TAKEOFF_PAGE_REPLACE_CONFLICT (40001), TAKEOFF_PAGE_DECISIONS_FROZEN (55000); the detail is JSON and names the
-- page. No data is rewritten: estimates already applied are not touched until a takeoff of one of their pages applies.
begin;

-- The page reader, twin of page-contributions.ts --------------------------------------------------------------------

-- uuid(value): a string in the UUID form, lower case; anything else is no identifier.
create function private.takeoff_uuid_or_null(p_value jsonb)
returns uuid
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case when pg_catalog.jsonb_typeof(p_value) = 'string'
      and (p_value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then pg_catalog.lower(p_value #>> '{}')::uuid end;
$$;

-- text(value): a non-blank string, trimmed of its white space.
create function private.takeoff_text_or_null(p_value jsonb)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case when pg_catalog.jsonb_typeof(p_value) = 'string'
    then nullif(pg_catalog.regexp_replace(p_value #>> '{}',
      '^[\t\n\v\f\r    -     　﻿]+|[\t\n\v\f\r    -     　﻿]+$', '', 'g'), '') end;
$$;

-- normalizedName: NFC, lower case, white space reduced to one space, trimmed; « Plan  R+1.PDF » is « plan r+1.pdf ».
create function private.takeoff_normalized_name(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select nullif(pg_catalog.btrim(pg_catalog.regexp_replace(
    pg_catalog.lower(normalize(p_value, NFC)),
    '[\t\n\v\f\r    -     　﻿]+', ' ', 'g'), ' '), '');
$$;

-- isSameDocument: the same plan file, the same content hash, the same plan reference (a revision replaces the previous
-- one), or, when one of the two has neither a plan file nor a hash, the same file name.
create function private.takeoff_same_document(p_left jsonb, p_right jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when nullif(p_left ->> 'plan_file_id', '') is not null
      and pg_catalog.lower(p_left ->> 'plan_file_id') = pg_catalog.lower(p_right ->> 'plan_file_id') then true
    when nullif(p_left ->> 'content_hash', '') is not null
      and pg_catalog.lower(p_left ->> 'content_hash') = pg_catalog.lower(p_right ->> 'content_hash') then true
    when private.takeoff_normalized_name(p_left ->> 'logical_document_id') is not null
      and private.takeoff_normalized_name(p_left ->> 'logical_document_id')
        = private.takeoff_normalized_name(p_right ->> 'logical_document_id') then true
    when (nullif(p_left ->> 'plan_file_id', '') is not null or nullif(p_left ->> 'content_hash', '') is not null)
      and (nullif(p_right ->> 'plan_file_id', '') is not null or nullif(p_right ->> 'content_hash', '') is not null)
      then false
    else coalesce(private.takeoff_normalized_name(p_left ->> 'file_name')
      = private.takeoff_normalized_name(p_right ->> 'file_name'), false)
  end;
$$;

-- isSamePage: the same document, and the same page or a page missing on either side (D27: without proof, the same page).
create function private.takeoff_same_page(p_left jsonb, p_right jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select private.takeoff_same_document(p_left -> 'document', p_right -> 'document')
    and ((p_left ->> 'page') is null or (p_right ->> 'page') is null
      or (p_left ->> 'page')::numeric = (p_right ->> 'page')::numeric);
$$;

-- takeoffLinePageIdentity: the page a takeoff line reads, from its file and page, its source document and what its
-- job's preparation says of that document. Null when nothing identifies a document.
create function private.takeoff_line_page_identity(
  p_source_file_name text,
  p_source_page integer,
  p_source_document jsonb,
  p_job_sources jsonb
)
returns jsonb
language plpgsql
immutable
parallel safe
set search_path = pg_catalog
as $$
declare
  reference jsonb := case when pg_catalog.jsonb_typeof(p_source_document) = 'object' then p_source_document end;
  plan_file_id uuid;
  sources jsonb;
  chosen jsonb;
  content_hash text;
  document jsonb;
begin
  if reference ->> 'kind' = 'plan_file' then
    plan_file_id := private.takeoff_uuid_or_null(reference -> 'plan_file_id');
  end if;
  select coalesce(pg_catalog.jsonb_agg(source.value order by source.ordinality), '[]'::jsonb) into sources
  from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_job_sources) = 'array' then p_job_sources
    else '[]'::jsonb end) with ordinality as source(value, ordinality)
  where pg_catalog.jsonb_typeof(source.value -> 'document_id') = 'string'
    and coalesce(source.value -> 'active', 'null'::jsonb) <> 'false'::jsonb
    and coalesce(nullif(source.value -> 'kind', 'null'::jsonb), '"plan"'::jsonb) = '"plan"'::jsonb;
  if plan_file_id is not null then
    select source.value into chosen from pg_catalog.jsonb_array_elements(sources) with ordinality as source(value, ordinality)
    where pg_catalog.lower(source.value ->> 'document_id') = plan_file_id::text order by source.ordinality limit 1;
  elsif reference ->> 'kind' = 'job_upload'
    and (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(sources) as source(value)
      where (source.value ->> 'document_id') like 'upload:%') = 1 then
    select source.value into chosen from pg_catalog.jsonb_array_elements(sources) as source(value)
    where (source.value ->> 'document_id') like 'upload:%';
  end if;
  if chosen is not null then
    content_hash := case
      when private.takeoff_text_or_null(chosen -> 'content_hash') ~* '^[a-f0-9]{64}$'
        then pg_catalog.lower(private.takeoff_text_or_null(chosen -> 'content_hash'))
      when (chosen ->> 'document_id') ~* '^upload:[a-f0-9]{64}$'
        then pg_catalog.lower(pg_catalog.substr(chosen ->> 'document_id', 8)) end;
  end if;
  document := pg_catalog.jsonb_build_object('plan_file_id', plan_file_id, 'content_hash', content_hash,
    'logical_document_id', private.takeoff_text_or_null(chosen -> 'logical_document_id'),
    'file_name', private.takeoff_text_or_null(pg_catalog.to_jsonb(p_source_file_name)));
  if plan_file_id is null and content_hash is null and document ->> 'logical_document_id' is null
    and document ->> 'file_name' is null then
    return null;
  end if;
  return pg_catalog.jsonb_build_object('document', document,
    'page', case when p_source_page > 0 then p_source_page end);
end;
$$;

-- estimateLineTakeoffItemIds: the takeoff lines an estimate line comes from, each once, in the order read; a rounding,
-- DPGF or page replacement key another takeoff than the line's last one wrote is stale.
create function private.takeoff_estimate_line_item_ids(p_source_metadata jsonb, p_source_job_id uuid)
returns uuid[]
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  with metadata as (
    select case when pg_catalog.jsonb_typeof(p_source_metadata) = 'object' then p_source_metadata end as value
  ), listed as (
    select 0 as rank, 0::bigint as ordinality, metadata.value -> 'takeoff_item_id' as value from metadata
    union all
    select key.rank, element.ordinality, element.value
    from metadata
    cross join (values (1, 'takeoff_length_rounding'), (2, 'takeoff_quantity_policy'), (3, 'takeoff_page_replacement'))
      as key(rank, name)
    cross join lateral (select case when pg_catalog.jsonb_typeof(metadata.value -> key.name) = 'object'
      then metadata.value -> key.name end as entry) as entry
    cross join lateral pg_catalog.jsonb_array_elements(case
      when p_source_job_id is not null and private.takeoff_uuid_or_null(entry.entry -> 'job_id') is not null
        and private.takeoff_uuid_or_null(entry.entry -> 'job_id') <> p_source_job_id then '[]'::jsonb
      when pg_catalog.jsonb_typeof(entry.entry -> 'item_ids') = 'array' then entry.entry -> 'item_ids'
      else '[]'::jsonb end) with ordinality as element(value, ordinality)
  ), ids as (
    select private.takeoff_uuid_or_null(listed.value) as id, listed.rank, listed.ordinality from listed
  )
  select coalesce(pg_catalog.array_agg(first.id order by first.rank, first.ordinality), '{}'::uuid[])
  from (select distinct on (ids.id) ids.id, ids.rank, ids.ordinality from ids where ids.id is not null
    order by ids.id, ids.rank, ids.ordinality) as first;
$$;

-- findPagesAlreadyInEstimate: the pages of the new lines that the estimate already holds from another takeoff than
-- p_job_id (null for a launch). Same inputs and output as the TypeScript reader, in JSON: new_lines [{id, identity}],
-- estimate_lines [{id, source_provider, source_job_id, source_file_name, source_page, source_metadata}], earlier_items
-- [{id, job_id, identity}]. One row per document and page, a line known only by its name joining the first row of the
-- identified document of that name (the limit PR 1 wrote down; private.takeoff_prepare_page_decisions refuses to
-- replace across two documents of one row).
create function private.takeoff_pages_already_in_estimate(
  p_job_id uuid,
  p_new_lines jsonb,
  p_estimate_lines jsonb,
  p_earlier_items jsonb,
  -- Each earlier takeoff's preparation sources ({job_id: sources}): an engine 1/2 line names no source line, and the
  -- source of its takeoff that bears its file name gives its document (plan file, content hash, plan reference).
  p_job_sources jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  job_key text := pg_catalog.lower(p_job_id::text);
  unidentified jsonb;
  other_count integer;
  grouped_contributions jsonb;
  new_page record;
  candidate record;
  entries jsonb := '[]'::jsonb;
  entry jsonb;
  entry_index integer;
  shown jsonb;
  found_index integer;
  earlier_entry jsonb;
begin
  select coalesce(pg_catalog.jsonb_agg(line.value -> 'id' order by line.ordinality), '[]'::jsonb) into unidentified
  from pg_catalog.jsonb_array_elements(coalesce(p_new_lines, '[]'::jsonb)) with ordinality as line(value, ordinality)
  where coalesce(line.value -> 'identity', 'null'::jsonb) = 'null'::jsonb;

  -- Each estimate line's contributions (estimateLineContributions): the takeoff lines it names, else (engines 1 and 2)
  -- its takeoff, file and page when it came from a takeoff. Grouped by takeoff and page identity, in the order read.
  with lines as (
    select line.value, line.ordinality from pg_catalog.jsonb_array_elements(coalesce(p_estimate_lines, '[]'::jsonb))
      with ordinality as line(value, ordinality)
  ), earlier_items as (
    select private.takeoff_uuid_or_null(item.value -> 'id') as id, pg_catalog.lower(item.value ->> 'job_id') as job_id,
      nullif(item.value -> 'identity', 'null'::jsonb) as identity
    from pg_catalog.jsonb_array_elements(coalesce(p_earlier_items, '[]'::jsonb)) as item(value)
  ), sourced as (
    select lines.ordinality as line_rank, source.ordinality as source_rank, lines.value ->> 'id' as estimate_item_id,
      earlier.job_id, source.id::text as item_id, earlier.identity
    from lines
    cross join lateral pg_catalog.unnest(private.takeoff_estimate_line_item_ids(lines.value -> 'source_metadata',
      private.takeoff_uuid_or_null(lines.value -> 'source_job_id'))) with ordinality as source(id, ordinality)
    join (select distinct on (earlier_items.id) * from earlier_items where earlier_items.id is not null) as earlier
      on earlier.id = source.id
  ), contributions as (
    select * from sourced
    union all
    select lines.ordinality, 1, lines.value ->> 'id', pg_catalog.lower(lines.value ->> 'source_job_id'), null,
      case when private.takeoff_text_or_null(lines.value -> 'source_file_name') is not null then pg_catalog.jsonb_build_object(
        'document', coalesce((
          select pg_catalog.jsonb_build_object('plan_file_id', private.takeoff_uuid_or_null(named.source -> 'document_id'),
            'content_hash', case
              when private.takeoff_text_or_null(named.source -> 'content_hash') ~* '^[a-f0-9]{64}$'
                then pg_catalog.lower(private.takeoff_text_or_null(named.source -> 'content_hash'))
              when (named.source ->> 'document_id') ~* '^upload:[a-f0-9]{64}$'
                then pg_catalog.lower(pg_catalog.substr(named.source ->> 'document_id', 8)) end,
            'logical_document_id', private.takeoff_text_or_null(named.source -> 'logical_document_id'),
            'file_name', private.takeoff_text_or_null(lines.value -> 'source_file_name'))
          from (select (pg_catalog.array_agg(source.value))[1] as source, pg_catalog.count(*) as count
            from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_job_sources
                -> pg_catalog.lower(lines.value ->> 'source_job_id')) = 'array'
              then p_job_sources -> pg_catalog.lower(lines.value ->> 'source_job_id') else '[]'::jsonb end) as source(value)
            where pg_catalog.jsonb_typeof(source.value -> 'document_id') = 'string'
              and coalesce(source.value -> 'active', 'null'::jsonb) <> 'false'::jsonb
              and coalesce(nullif(source.value -> 'kind', 'null'::jsonb), '"plan"'::jsonb) = '"plan"'::jsonb
              and private.takeoff_normalized_name(private.takeoff_text_or_null(source.value -> 'document_name'))
                = private.takeoff_normalized_name(private.takeoff_text_or_null(lines.value -> 'source_file_name'))) as named
          where named.count = 1),
          pg_catalog.jsonb_build_object('plan_file_id', null, 'content_hash', null, 'logical_document_id', null,
            'file_name', private.takeoff_text_or_null(lines.value -> 'source_file_name'))),
        'page', case when pg_catalog.jsonb_typeof(lines.value -> 'source_page') = 'number'
          and (lines.value ->> 'source_page')::numeric > 0
          and (lines.value ->> 'source_page')::numeric = pg_catalog.trunc((lines.value ->> 'source_page')::numeric)
          then lines.value -> 'source_page' end) end
    from lines
    where not exists (select 1 from sourced where sourced.line_rank = lines.ordinality)
      and lines.value ->> 'source_provider' = 'takeoff'
      and private.takeoff_uuid_or_null(lines.value -> 'source_job_id') is not null
  )
  select
    (select pg_catalog.count(distinct contribution.estimate_item_id)::integer from contributions as contribution
      where contribution.job_id is distinct from job_key),
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('job_id', grouped.job_id, 'identity', grouped.identity,
        'estimate_item_ids', grouped.estimate_item_ids, 'takeoff_item_ids', grouped.takeoff_item_ids) order by grouped.first_rank)
      from (
        select contribution.job_id, contribution.identity,
          pg_catalog.jsonb_agg(distinct contribution.estimate_item_id) as estimate_item_ids,
          coalesce(pg_catalog.jsonb_agg(distinct contribution.item_id) filter (where contribution.item_id is not null),
            '[]'::jsonb) as takeoff_item_ids,
          pg_catalog.min(contribution.line_rank * 100000 + contribution.source_rank) as first_rank
        from contributions as contribution
        where contribution.identity is not null
        group by contribution.job_id, contribution.identity
      ) as grouped), '[]'::jsonb)
    into other_count, grouped_contributions;

  -- Compared page by page: the new lines of one page share one identity; the identified pages come first, so that a
  -- line known only by its name joins their row whatever the order read.
  for new_page in
    select page.identity, page.item_ids
    from (
      select line.value -> 'identity' as identity,
        pg_catalog.jsonb_agg(line.value -> 'id' order by line.ordinality) as item_ids,
        pg_catalog.min(line.ordinality) as first_rank
      from pg_catalog.jsonb_array_elements(coalesce(p_new_lines, '[]'::jsonb)) with ordinality as line(value, ordinality)
      where coalesce(line.value -> 'identity', 'null'::jsonb) <> 'null'::jsonb
      group by line.value -> 'identity'
    ) as page
    order by case when nullif(page.identity #>> '{document,plan_file_id}', '') is not null
        or nullif(page.identity #>> '{document,content_hash}', '') is not null then 0 else 1 end,
      page.first_rank
  loop
    for candidate in
      select grouped.value ->> 'job_id' as job_id, grouped.value -> 'identity' as identity,
        grouped.value -> 'estimate_item_ids' as estimate_item_ids, grouped.value -> 'takeoff_item_ids' as takeoff_item_ids
      from pg_catalog.jsonb_array_elements(grouped_contributions) with ordinality as grouped(value, ordinality)
      where (grouped.value ->> 'job_id') is distinct from job_key
        and private.takeoff_same_page(new_page.identity, grouped.value -> 'identity')
      order by grouped.ordinality
    loop
      shown := coalesce(nullif(new_page.identity -> 'page', 'null'::jsonb),
        nullif(candidate.identity -> 'page', 'null'::jsonb), 'null'::jsonb);
      found_index := null;
      for entry_index in 0 .. pg_catalog.jsonb_array_length(entries) - 1 loop
        entry := entries -> entry_index;
        if entry -> 'page' = shown and exists (select 1 from pg_catalog.jsonb_array_elements(entry -> 'identities') as known(value)
          where private.takeoff_same_document(known.value -> 'document', new_page.identity -> 'document')) then
          found_index := entry_index;
          exit;
        end if;
      end loop;
      if found_index is null then
        entries := entries || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'file_name', coalesce(nullif(new_page.identity #> '{document,file_name}', 'null'::jsonb),
            candidate.identity #> '{document,file_name}', 'null'::jsonb),
          'page', shown, 'identities', '[]'::jsonb, 'item_ids', '[]'::jsonb, 'earlier', '{}'::jsonb, 'own', '[]'::jsonb));
        found_index := pg_catalog.jsonb_array_length(entries) - 1;
      end if;
      entry := entries -> found_index;
      earlier_entry := coalesce(entry #> array['earlier', candidate.job_id],
        pg_catalog.jsonb_build_object('estimate_item_ids', '[]'::jsonb, 'takeoff_item_ids', '[]'::jsonb));
      entry := pg_catalog.jsonb_set(entry, '{identities}', (entry -> 'identities')
        || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('document', new_page.identity -> 'document', 'page', shown)));
      entry := pg_catalog.jsonb_set(entry, '{item_ids}', (entry -> 'item_ids') || new_page.item_ids);
      entry := pg_catalog.jsonb_set(entry, array['earlier', candidate.job_id], pg_catalog.jsonb_build_object(
        'estimate_item_ids', (earlier_entry -> 'estimate_item_ids') || candidate.estimate_item_ids,
        'takeoff_item_ids', (earlier_entry -> 'takeoff_item_ids') || candidate.takeoff_item_ids));
      entries := pg_catalog.jsonb_set(entries, array[found_index::text], entry);
    end loop;
  end loop;

  -- This takeoff's own estimate lines, on a reported page by the same rule as the comparison.
  for candidate in
    select own.value -> 'identity' as identity, own.value -> 'estimate_item_ids' as estimate_item_ids
    from pg_catalog.jsonb_array_elements(grouped_contributions) as own(value)
    where (own.value ->> 'job_id') = job_key
  loop
    for entry_index in 0 .. pg_catalog.jsonb_array_length(entries) - 1 loop
      entry := entries -> entry_index;
      if exists (select 1 from pg_catalog.jsonb_array_elements(entry -> 'identities') as known(value)
        where private.takeoff_same_page(known.value, candidate.identity)) then
        entries := pg_catalog.jsonb_set(entries, array[entry_index::text, 'own'], (entry -> 'own') || candidate.estimate_item_ids);
      end if;
    end loop;
  end loop;

  return pg_catalog.jsonb_build_object(
    'pages', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'file_name', page.value -> 'file_name',
        'page', page.value -> 'page',
        'item_ids', (select coalesce(pg_catalog.jsonb_agg(distinct_id.value order by distinct_id.value #>> '{}' collate "C"), '[]'::jsonb)
          from (select distinct id.value from pg_catalog.jsonb_array_elements(page.value -> 'item_ids') as id(value)) as distinct_id),
        'earlier', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'job_id', job.key,
            'estimate_item_ids', (select coalesce(pg_catalog.jsonb_agg(distinct_id.value order by distinct_id.value #>> '{}' collate "C"), '[]'::jsonb)
              from (select distinct id.value from pg_catalog.jsonb_array_elements(job.value -> 'estimate_item_ids') as id(value)) as distinct_id),
            'takeoff_item_ids', (select coalesce(pg_catalog.jsonb_agg(distinct_id.value order by distinct_id.value #>> '{}' collate "C"), '[]'::jsonb)
              from (select distinct id.value from pg_catalog.jsonb_array_elements(job.value -> 'takeoff_item_ids') as id(value)) as distinct_id))
            order by job.key collate "C")
          from pg_catalog.jsonb_each(page.value -> 'earlier') as job(key, value)),
        'own_estimate_item_ids', (select coalesce(pg_catalog.jsonb_agg(distinct_id.value order by distinct_id.value #>> '{}' collate "C"), '[]'::jsonb)
          from (select distinct id.value from pg_catalog.jsonb_array_elements(page.value -> 'own') as id(value)) as distinct_id))
        order by pg_catalog.lower(coalesce(page.value ->> 'file_name', '')) collate "C",
          coalesce(page.value ->> 'file_name', '') collate "C",
          coalesce((page.value ->> 'page')::numeric, 9007199254740991), page.ordinality)
      from pg_catalog.jsonb_array_elements(entries) with ordinality as page(value, ordinality)), '[]'::jsonb),
    'unidentified_item_ids', unidentified,
    'other_takeoff_line_count', other_count);
end;
$$;

-- The pages a takeoff reads that the version already holds from another takeoff, read in the database: the version's
-- lines with a takeoff provenance, the frozen takeoff lines they name and this takeoff's lines (p_new_item_ids: the
-- lines that reach the estimate; all of the takeoff's included lines when null), each identified by its job's
-- preparation. Bounded by the version's tenant.
create function private.takeoff_page_contributions(p_version_id uuid, p_job_id uuid, p_new_item_ids uuid[] default null)
returns jsonb
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  version_tenant uuid;
  estimate_lines jsonb;
  new_lines jsonb;
  earlier_items jsonb;
  job_sources jsonb;
begin
  select version.tenant_id into version_tenant from public.estimate_versions as version where version.id = p_version_id;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', item.id, 'source_provider', item.source_provider,
      'source_job_id', item.source_job_id, 'source_file_name', item.source_file_name, 'source_page', item.source_page,
      'source_metadata', item.source_metadata) order by item.id), '[]'::jsonb)
    into estimate_lines
  from public.estimate_items as item
  where item.version_id = p_version_id and item.tenant_id = version_tenant and item.source_job_id is not null
    -- A line only: an ouvrage's section carries its source line too, but holds no quantity of the page.
    and item.item_type = 'line'::public.estimate_item_type;

  with referenced as (
    select distinct source.id
    from pg_catalog.jsonb_array_elements(estimate_lines) as line(value)
    cross join lateral pg_catalog.unnest(private.takeoff_estimate_line_item_ids(line.value -> 'source_metadata',
      (line.value ->> 'source_job_id')::uuid)) as source(id)
    union
    select item.id from public.takeoff_items as item where item.job_id = p_job_id and item.tenant_id = version_tenant
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', item.id, 'job_id', item.job_id,
      'identity', private.takeoff_line_page_identity(item.source_file_name, item.source_page, item.metadata -> 'source_document',
        job.preparation_snapshot #> '{preparation,sources}')) order by item.id), '[]'::jsonb)
    into earlier_items
  from referenced
  join public.takeoff_items as item on item.id = referenced.id and item.tenant_id = version_tenant
  join public.takeoff_jobs as job on job.id = item.job_id and job.tenant_id = version_tenant;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', item.id,
      'identity', private.takeoff_line_page_identity(item.source_file_name, item.source_page, item.metadata -> 'source_document',
        job.preparation_snapshot #> '{preparation,sources}')) order by item.created_at, item.id), '[]'::jsonb)
    into new_lines
  from public.takeoff_items as item
  join public.takeoff_jobs as job on job.id = item.job_id and job.tenant_id = item.tenant_id
  where item.job_id = p_job_id and item.tenant_id = version_tenant
    and case when p_new_item_ids is null then not item.is_excluded else item.id = any(p_new_item_ids) end;

  -- The preparation sources of the takeoffs the version's lines name, for their engine 1/2 lines.
  select coalesce(pg_catalog.jsonb_object_agg(job.id::text, coalesce(job.preparation_snapshot #> '{preparation,sources}', '[]'::jsonb)), '{}'::jsonb)
    into job_sources
  from public.takeoff_jobs as job
  where job.tenant_id = version_tenant and job.id in (select (line.value ->> 'source_job_id')::uuid
    from pg_catalog.jsonb_array_elements(estimate_lines) as line(value));

  return private.takeoff_pages_already_in_estimate(p_job_id, new_lines, estimate_lines, earlier_items, job_sources);
end;
$$;

-- The earlier contributions on the pages a takeoff reads, one row per estimate line, earlier takeoff and frozen source
-- line on such a page (no source line for an engine 1/2 line), with the page it is on.
create function private.takeoff_page_conflicts(p_version_id uuid, p_job_id uuid, p_new_item_ids uuid[] default null)
returns table (
  estimate_item_id uuid,
  earlier_job_id uuid,
  earlier_item_id uuid,
  source_file_name text,
  source_page integer,
  new_item_ids uuid[],
  page_rank bigint
)
language sql
stable
set search_path = pg_catalog
as $$
  with pages as (
    select page.value, page.ordinality
    from pg_catalog.jsonb_array_elements(private.takeoff_page_contributions(p_version_id, p_job_id, p_new_item_ids) -> 'pages')
      with ordinality as page(value, ordinality)
  ), lines as (
    select pages.value as page, pages.ordinality, (earlier.value ->> 'job_id')::uuid as job_id,
      (line.value #>> '{}')::uuid as estimate_item_id,
      array(select (id.value #>> '{}')::uuid from pg_catalog.jsonb_array_elements(earlier.value -> 'takeoff_item_ids') as id(value))
        as page_item_ids
    from pages
    cross join lateral pg_catalog.jsonb_array_elements(pages.value -> 'earlier') as earlier(value)
    cross join lateral pg_catalog.jsonb_array_elements(earlier.value -> 'estimate_item_ids') as line(value)
  ), sourced as (
    select lines.*, array(select source.id
        from pg_catalog.unnest(private.takeoff_estimate_line_item_ids(item.source_metadata, item.source_job_id)) as source(id)
        where source.id = any(lines.page_item_ids)) as item_ids
    from lines
    join public.estimate_items as item on item.id = lines.estimate_item_id and item.version_id = p_version_id
  )
  select sourced.estimate_item_id, sourced.job_id, source.id, sourced.page ->> 'file_name', (sourced.page ->> 'page')::integer,
    array(select (id.value #>> '{}')::uuid from pg_catalog.jsonb_array_elements(sourced.page -> 'item_ids') as id(value)),
    sourced.ordinality
  from sourced
  cross join lateral pg_catalog.unnest(case when pg_catalog.cardinality(sourced.item_ids) = 0 then array[null::uuid]
    else sourced.item_ids end) as source(id);
$$;

revoke all on function private.takeoff_uuid_or_null(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.takeoff_text_or_null(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.takeoff_normalized_name(text) from public, anon, authenticated, service_role;
revoke all on function private.takeoff_same_document(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.takeoff_same_page(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.takeoff_line_page_identity(text, integer, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.takeoff_estimate_line_item_ids(jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function private.takeoff_pages_already_in_estimate(uuid, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.takeoff_page_contributions(uuid, uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function private.takeoff_page_conflicts(uuid, uuid, uuid[]) from public, anon, authenticated, service_role;

-- The decisions --------------------------------------------------------------------------------------------------------

create table public.takeoff_page_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  job_id uuid not null references public.takeoff_jobs(id) on delete cascade,
  estimate_version_id uuid not null references public.estimate_versions(id) on delete cascade,
  -- The page as the estimator saw it: the document (plan file, content hash, plan reference, file name) and its page
  -- (null: a page unknown on one side).
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  source_page integer check (source_page is null or source_page > 0),
  earlier_job_ids uuid[] not null default '{}'::uuid[],
  decision text not null check (decision in ('replace', 'keep_both')),
  reason_code text check (reason_code is null or reason_code in ('other_zone', 'other_trade', 'complementary_scope')),
  note text check (note is null or char_length(note) <= 500),
  -- Each earlier estimate line of the page: [{estimate_item_id, expected_updated_at, action (update | remove | keep),
  -- take (new | keep_mine, a quantity changed by hand), item_ids (its earlier source lines on the page)}].
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array'),
  -- The new takeoff's lines paired with an earlier estimate line: [{takeoff_item_id, estimate_item_id}].
  pairs jsonb not null default '[]'::jsonb check (jsonb_typeof(pairs) = 'array'),
  decided_by uuid not null references auth.users(id),
  decided_at timestamptz not null default statement_timestamp(),
  constraint takeoff_page_decisions_reason_check check (
    (decision = 'replace' and reason_code is null)
    or (decision = 'keep_both' and reason_code is not null
      and (reason_code <> 'complementary_scope' or char_length(btrim(coalesce(note, ''))) between 10 and 500))),
  constraint takeoff_page_decisions_keep_both_pairs_check check (decision = 'replace' or pairs = '[]'::jsonb)
);

create unique index takeoff_page_decisions_page_key
  on public.takeoff_page_decisions (job_id, document, coalesce(source_page, 0));
create index takeoff_page_decisions_version_idx on public.takeoff_page_decisions (tenant_id, estimate_version_id);

comment on table public.takeoff_page_decisions is
  'TI-682 lot D: what the estimator decided for each page a takeoff reads that another takeoff already brought into the estimate: replace its earlier measure line by line, or keep both with a coded reason. Written by public.record_takeoff_page_decisions only, frozen once the takeoff is applied (the trace of the application), read by the apply guard. Attached to the takeoffs, never copied with a version.';

alter table public.takeoff_page_decisions enable row level security;
alter table public.takeoff_page_decisions force row level security;
revoke all on table public.takeoff_page_decisions from public, anon, authenticated;
grant select on table public.takeoff_page_decisions to authenticated;

create policy "Current tenant can select takeoff page decisions"
  on public.takeoff_page_decisions
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(estimate_version_id, tenant_id))
  );

-- Frozen with the takeoff: once applied, its decisions are the trace of the application. A cascade from the deletion
-- of its takeoff or its version (a trigger inside a trigger) still removes them.
create function private.takeoff_page_decisions_frozen()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_job uuid := case when tg_op = 'DELETE' then old.job_id else new.job_id end;
begin
  if tg_op = 'DELETE' and pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;
  if exists (select 1 from public.takeoff_jobs as job where job.id = target_job and job.status = 'applied'::public.takeoff_job_status)
    or (tg_op = 'UPDATE' and exists (select 1 from public.takeoff_jobs as job
      where job.id = old.job_id and job.status = 'applied'::public.takeoff_job_status)) then
    raise exception 'TAKEOFF_PAGE_DECISIONS_FROZEN' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function private.takeoff_page_decisions_frozen() from public, anon, authenticated, service_role;

create trigger takeoff_page_decisions_frozen
  before insert or update or delete on public.takeoff_page_decisions
  for each row execute function private.takeoff_page_decisions_frozen();

-- Records the decisions of a completed takeoff on its own draft version, replacing all of them at once. An engineer or
-- an administrator of the active tenant (keeping both is a reasoned trade decision, not an override). The shape is
-- checked here; whether they still hold for the estimate is checked by the application, under the version's lock.
create function public.record_takeoff_page_decisions(p_job_id uuid, p_decisions jsonb)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  caller_id uuid := (select auth.uid());
  job_tenant_id uuid;
  job_version_id uuid;
  job_status public.takeoff_job_status;
  version_status public.estimate_status;
  recorded integer;
begin
  if caller_id is null then
    raise exception 'TAKEOFF_APPLY_AUTH_REQUIRED' using errcode = '42501';
  end if;
  -- The job's row, locked as the application locks it: a record waits for an application in flight, then sees it
  -- applied (frozen), and never replaces the decisions an application is reading.
  select job.tenant_id, job.estimate_version_id, job.status into job_tenant_id, job_version_id, job_status
  from public.takeoff_jobs as job where job.id = p_job_id for update;
  if job_tenant_id is null
    or not coalesce(public.has_tenant_role(job_tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]), false) then
    raise exception 'TAKEOFF_APPLY_OPERATOR_REQUIRED' using errcode = '42501';
  end if;
  perform public.assert_takeoff_active_tenant(p_job_id, job_tenant_id);
  if job_status = 'applied'::public.takeoff_job_status then
    raise exception 'TAKEOFF_PAGE_DECISIONS_FROZEN' using errcode = '55000';
  end if;
  if job_status is distinct from 'completed'::public.takeoff_job_status then
    raise exception 'TAKEOFF_PAGE_DECISION_INVALID' using errcode = '22023',
      detail = pg_catalog.jsonb_build_object('reason', 'job_not_completed')::text;
  end if;
  select version.status into version_status from public.estimate_versions as version
  where version.id = job_version_id and version.tenant_id = job_tenant_id;
  if version_status is distinct from 'draft'::public.estimate_status then
    raise exception 'TAKEOFF_TARGET_VERSION_DRAFT_REQUIRED' using errcode = 'P0001';
  end if;

  if pg_catalog.jsonb_typeof(coalesce(p_decisions, '[]'::jsonb)) <> 'array' or pg_catalog.jsonb_array_length(coalesce(p_decisions, '[]'::jsonb)) > 2000
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb)) as decision(value)
      where pg_catalog.jsonb_typeof(decision.value) <> 'object'
        or pg_catalog.jsonb_typeof(decision.value -> 'document') is distinct from 'object'
        or (decision.value ->> 'decision') is null or (decision.value ->> 'decision') not in ('replace', 'keep_both')
        or (decision.value -> 'source_page' is not null and decision.value -> 'source_page' <> 'null'::jsonb
          and (pg_catalog.jsonb_typeof(decision.value -> 'source_page') <> 'number'
            or (decision.value ->> 'source_page') !~ '^[1-9][0-9]{0,8}$'))
        or pg_catalog.jsonb_typeof(coalesce(decision.value -> 'lines', '[]'::jsonb)) <> 'array'
        or pg_catalog.jsonb_typeof(coalesce(decision.value -> 'pairs', '[]'::jsonb)) <> 'array'
        or pg_catalog.jsonb_array_length(coalesce(decision.value -> 'lines', '[]'::jsonb)) = 0
        or (decision.value ->> 'decision' = 'keep_both' and (
          (decision.value ->> 'reason_code') is null
          or (decision.value ->> 'reason_code') not in ('other_zone', 'other_trade', 'complementary_scope')
          or (decision.value ->> 'reason_code' = 'complementary_scope'
            and char_length(btrim(coalesce(decision.value ->> 'note', ''))) not between 10 and 500)
          or pg_catalog.jsonb_array_length(coalesce(decision.value -> 'pairs', '[]'::jsonb)) > 0
          or exists (select 1 from pg_catalog.jsonb_array_elements(decision.value -> 'lines') as line(value)
            where line.value ->> 'action' is distinct from 'keep')))
        or exists (select 1 from pg_catalog.jsonb_array_elements(coalesce(decision.value -> 'lines', '[]'::jsonb)) as line(value)
          where private.takeoff_uuid_or_null(line.value -> 'estimate_item_id') is null
            or pg_catalog.jsonb_typeof(line.value -> 'expected_updated_at') is distinct from 'string'
            or (line.value ->> 'expected_updated_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
            or (line.value ->> 'action') is null or (line.value ->> 'action') not in ('update', 'remove', 'keep')
            or (line.value -> 'take' is not null and line.value -> 'take' <> 'null'::jsonb
              and (line.value ->> 'take') not in ('new', 'keep_mine'))
            or pg_catalog.jsonb_typeof(coalesce(line.value -> 'item_ids', '[]'::jsonb)) <> 'array'
            or exists (select 1 from pg_catalog.jsonb_array_elements(coalesce(line.value -> 'item_ids', '[]'::jsonb)) as id(value)
              where private.takeoff_uuid_or_null(id.value) is null))
        or exists (select 1 from pg_catalog.jsonb_array_elements(coalesce(decision.value -> 'pairs', '[]'::jsonb)) as pair(value)
          where private.takeoff_uuid_or_null(pair.value -> 'takeoff_item_id') is null
            or private.takeoff_uuid_or_null(pair.value -> 'estimate_item_id') is null)
    ) then
    raise exception 'TAKEOFF_PAGE_DECISION_INVALID' using errcode = '22023',
      detail = pg_catalog.jsonb_build_object('reason', 'shape')::text;
  end if;

  delete from public.takeoff_page_decisions as decision where decision.job_id = p_job_id and decision.tenant_id = job_tenant_id;
  insert into public.takeoff_page_decisions (tenant_id, job_id, estimate_version_id, document, source_page, earlier_job_ids,
    decision, reason_code, note, lines, pairs, decided_by)
  select job_tenant_id, p_job_id, job_version_id, decision.value -> 'document',
    case when pg_catalog.jsonb_typeof(decision.value -> 'source_page') = 'number' then (decision.value ->> 'source_page')::integer end,
    coalesce(array(select private.takeoff_uuid_or_null(id.value)
      from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(decision.value -> 'earlier_job_ids') = 'array'
        then decision.value -> 'earlier_job_ids' else '[]'::jsonb end) as id(value)
      where private.takeoff_uuid_or_null(id.value) is not null), '{}'::uuid[]),
    decision.value ->> 'decision', decision.value ->> 'reason_code',
    nullif(btrim(coalesce(decision.value ->> 'note', '')), ''),
    -- Identifiers stored lower case, as the guard compares them.
    (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'estimate_item_id', private.takeoff_uuid_or_null(line.value -> 'estimate_item_id'),
        'expected_updated_at', line.value -> 'expected_updated_at', 'action', line.value ->> 'action',
        'take', nullif(line.value ->> 'take', ''),
        'item_ids', (select coalesce(pg_catalog.jsonb_agg(private.takeoff_uuid_or_null(id.value) order by id.ordinality), '[]'::jsonb)
          from pg_catalog.jsonb_array_elements(coalesce(line.value -> 'item_ids', '[]'::jsonb)) with ordinality as id(value, ordinality)))
        order by line.ordinality)
      from pg_catalog.jsonb_array_elements(decision.value -> 'lines') with ordinality as line(value, ordinality)),
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'takeoff_item_id', private.takeoff_uuid_or_null(pair.value -> 'takeoff_item_id'),
        'estimate_item_id', private.takeoff_uuid_or_null(pair.value -> 'estimate_item_id')) order by pair.ordinality)
      from pg_catalog.jsonb_array_elements(coalesce(decision.value -> 'pairs', '[]'::jsonb)) with ordinality as pair(value, ordinality)),
      '[]'::jsonb), caller_id
  from pg_catalog.jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb)) as decision(value);
  get diagnostics recorded = row_count;
  -- Codex review of c06cbb1b: the decisions an application reads are the ones recorded in its own transaction
  -- (public.apply_takeoff_job_with_page_decisions). Decisions recorded by another request (another tab, a call
  -- between this record and an application) are refused as stale by takeoff_prepare_page_decisions.
  perform pg_catalog.set_config('app.takeoff_page_decisions_job', p_job_id::text, true);
  return recorded;
exception
  when unique_violation then
    raise exception 'TAKEOFF_PAGE_DECISION_INVALID' using errcode = '22023',
      detail = pg_catalog.jsonb_build_object('reason', 'page_twice')::text;
end;
$$;

revoke all on function public.record_takeoff_page_decisions(uuid, jsonb) from public, anon;
grant execute on function public.record_takeoff_page_decisions(uuid, jsonb) to authenticated;

-- The gesture and the guard -------------------------------------------------------------------------------------------

-- The detail of a page refusal: the page, the earlier takeoffs and their lines there.
create function private.takeoff_page_refusal_detail(p_reason text, p_conflicts jsonb)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('scope', 'page', 'reason', p_reason,
    'source_file_name', p_conflicts -> 0 ->> 'source_file_name',
    'source_page', (p_conflicts -> 0 ->> 'source_page')::integer,
    'plan_file_id', p_conflicts -> 0 ->> 'plan_file_id',
    'earlier_job_ids', (select pg_catalog.jsonb_agg(distinct conflict.value -> 'earlier_job_id')
      from pg_catalog.jsonb_array_elements(p_conflicts) as conflict(value)),
    'line_count', (select pg_catalog.count(distinct conflict.value ->> 'estimate_item_id')
      from pg_catalog.jsonb_array_elements(p_conflicts) as conflict(value)))) ::text;
$$;
revoke all on function private.takeoff_page_refusal_detail(text, jsonb) from public, anon, authenticated, service_role;

-- Before the application writes anything, under the version's lock: the earlier contributions on the pages the takeoff
-- reads (the lines the mapping plan does not skip nor fold into an assembly), each earlier estimate line as it is now,
-- and the takeoff's decisions checked against them. Fills pg_temp._ti682_lines (the earlier estimate lines with their
-- measured quantity), pg_temp._ti682_choices (one row per decision line) and pg_temp._ti682_pairs.
create function private.takeoff_prepare_page_decisions(
  p_job_id uuid,
  p_tenant_id uuid,
  p_version_id uuid,
  p_strategy text,
  p_mapping_plan jsonb
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  caller_id uuid := (select auth.uid());
  failure jsonb;
begin
  if coalesce(pg_catalog.current_setting('app.takeoff_apply_atomic', true), '') <> 'on' then
    raise exception 'TAKEOFF_ATOMIC_APPLY_REQUIRED' using errcode = '42501';
  end if;

  drop table if exists pg_temp._ti682_conflicts;
  create temporary table _ti682_conflicts on commit drop as
  select * from private.takeoff_page_conflicts(p_version_id, p_job_id, array(
    select item.id from public.takeoff_items as item
    where item.job_id = p_job_id and item.tenant_id = p_tenant_id and not item.is_excluded
      and not exists (select 1 from pg_catalog.jsonb_to_recordset(coalesce(p_mapping_plan, '[]'::jsonb)) as plan(item_id uuid, action text)
        where plan.item_id = item.id and plan.action in ('skip', 'apply_assembly'))));

  -- Each earlier estimate line of these pages, as it is before the application: its sources and its measured quantity
  -- (the sum of its source lines, rounded up as finalize_takeoff_lengths rounds a length), to tell a quantity changed by
  -- hand. An engine 1/2 line names no source (and a source may no longer be readable): its measure is unknown, and the
  -- estimator is asked.
  drop table if exists pg_temp._ti682_lines;
  create temporary table _ti682_lines on commit drop as
  select item.id, pg_catalog.to_jsonb(item) as snapshot, item.updated_at, item.quantity, item.title, item.description,
    item.unit_price_ht_cents, item.category_id, item.source_provider, item.source_metadata,
    coalesce(item.unit_code, (private.normalize_unit(item.description)).unit_code,
      'status:' || item.pricing_status::text) as unit_key,
    sources.ids as source_ids,
    case when pg_catalog.cardinality(sources.ids) > 0 and measured.readable = pg_catalog.cardinality(sources.ids)
      then measured.raw end as measured_raw,
    unit.factor,
    item.source_metadata ->> 'mapping_action' = 'apply_assembly' as assembly
  from public.estimate_items as item
  cross join lateral (select private.takeoff_estimate_line_item_ids(item.source_metadata, item.source_job_id) as ids) as sources
  cross join lateral (select pg_catalog.sum(source.quantity) as raw, pg_catalog.count(*) as readable from public.takeoff_items as source
    where source.id = any(sources.ids) and source.tenant_id = p_tenant_id) as measured
  cross join lateral (select case coalesce((private.normalize_unit(coalesce(item.unit_code, item.description))).unit_code,
      private.unit_token(coalesce(item.unit_code, item.description)))
      when 'm' then 1::numeric when 'ml' then 1::numeric when 'metre' then 1::numeric when 'metres' then 1::numeric
      when 'cm' then 0.01::numeric when 'mm' then 0.001::numeric when 'km' then 1000::numeric end as factor) as unit
  where item.version_id = p_version_id and item.tenant_id = p_tenant_id
    and item.id in (select conflict.estimate_item_id from pg_temp._ti682_conflicts as conflict);
  alter table pg_temp._ti682_lines add primary key (id);

  drop table if exists pg_temp._ti682_choices;
  create temporary table _ti682_choices on commit drop as
  select decision.id as decision_id, decision.decision, decision.decided_by, decision.source_page,
    decision.document ->> 'file_name' as file_name,
    (line.value ->> 'estimate_item_id')::uuid as estimate_item_id, (line.value ->> 'expected_updated_at')::timestamptz as expected_updated_at,
    line.value ->> 'action' as action, nullif(line.value ->> 'take', '') as take,
    array(select (id.value #>> '{}')::uuid from pg_catalog.jsonb_array_elements(coalesce(line.value -> 'item_ids', '[]'::jsonb)) as id(value))
      as item_ids
  from public.takeoff_page_decisions as decision
  cross join lateral pg_catalog.jsonb_array_elements(decision.lines) as line(value)
  where decision.job_id = p_job_id and decision.tenant_id = p_tenant_id and decision.estimate_version_id = p_version_id;

  drop table if exists pg_temp._ti682_pairs;
  create temporary table _ti682_pairs on commit drop as
  select decision.id as decision_id, (pair.value ->> 'takeoff_item_id')::uuid as takeoff_item_id,
    (pair.value ->> 'estimate_item_id')::uuid as estimate_item_id
  from public.takeoff_page_decisions as decision
  cross join lateral pg_catalog.jsonb_array_elements(decision.pairs) as pair(value)
  where decision.job_id = p_job_id and decision.tenant_id = p_tenant_id and decision.estimate_version_id = p_version_id;

  if not exists (select 1 from pg_temp._ti682_choices) and not exists (select 1 from pg_temp._ti682_pairs) then
    return;
  end if;
  -- Decisions bound to this application: recorded in its own transaction, never read from another request.
  if coalesce(pg_catalog.current_setting('app.takeoff_page_decisions_job', true), '') <> p_job_id::text then
    raise exception 'TAKEOFF_PAGE_DECISION_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('scope', 'page', 'reason', 'decisions_not_of_this_application')::text;
  end if;

  -- Stale: decided by someone else (another tab of another person), a line deleted or changed since the proposal, a line
  -- no longer on a page this takeoff reads, a source line no longer on that page.
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('estimate_item_id', choice.estimate_item_id,
      'source_file_name', choice.file_name, 'source_page', choice.source_page, 'reason', case
        when choice.decided_by is distinct from caller_id then 'decided_by_another'
        when item.id is null then 'line_missing'
        when item.updated_at is distinct from choice.expected_updated_at then 'line_changed'
        when line.id is null then 'line_not_on_page'
        else 'source_not_on_page' end) order by choice.file_name, choice.source_page)
    into failure
  from pg_temp._ti682_choices as choice
  left join public.estimate_items as item on item.id = choice.estimate_item_id and item.version_id = p_version_id
    and item.tenant_id = p_tenant_id
  left join pg_temp._ti682_lines as line on line.id = choice.estimate_item_id
  where choice.decided_by is distinct from caller_id or item.id is null or item.updated_at is distinct from choice.expected_updated_at
    or line.id is null
    or exists (select 1 from pg_catalog.unnest(choice.item_ids) as source(id)
      where not exists (select 1 from pg_temp._ti682_conflicts as conflict
        where conflict.estimate_item_id = choice.estimate_item_id and conflict.earlier_item_id = source.id));
  if failure is not null then
    raise exception 'TAKEOFF_PAGE_DECISION_STALE' using errcode = '40001',
      detail = private.takeoff_page_refusal_detail(failure -> 0 ->> 'reason', failure);
  end if;

  -- Invalid: a strategy that empties the section beside a replacement; a DPGF target replaced or removed (its own policy
  -- replaces it per takeoff); a line removed on one page and kept or updated on another; an updated line without a pair,
  -- a pair on a line not updated; a new line paired twice, excluded, left out by the plan or of another takeoff; a pair
  -- of two units; a pair across two documents; a quantity changed by hand without the estimator's choice.
  select pg_catalog.jsonb_build_object('reason', invalid.reason, 'estimate_item_id', invalid.estimate_item_id,
      'source_file_name', invalid.file_name, 'source_page', invalid.source_page)
    into failure
  from (
    select 'strategy_replace' as reason, null::uuid as estimate_item_id, null::text as file_name, null::integer as source_page, 0 as rank
    where lower(btrim(coalesce(p_strategy, ''))) = 'replace'
      and exists (select 1 from pg_temp._ti682_choices as choice where choice.decision = 'replace')
    union all
    select 'dpgf_target', choice.estimate_item_id, choice.file_name, choice.source_page, 1
    from pg_temp._ti682_choices as choice join pg_temp._ti682_lines as line on line.id = choice.estimate_item_id
    where choice.action in ('update', 'remove') and line.source_provider = 'dpgf'
    union all
    select 'conflicting_actions', choice.estimate_item_id, pg_catalog.min(choice.file_name), pg_catalog.min(choice.source_page), 2
    from pg_temp._ti682_choices as choice group by choice.estimate_item_id
    having pg_catalog.bool_or(choice.action = 'remove') and pg_catalog.bool_or(choice.action <> 'remove')
      or pg_catalog.count(distinct choice.take) > 1
    union all
    select 'update_without_pair', choice.estimate_item_id, choice.file_name, choice.source_page, 3
    from pg_temp._ti682_choices as choice
    where choice.action = 'update' and not exists (select 1 from pg_temp._ti682_pairs as pair
      where pair.estimate_item_id = choice.estimate_item_id)
    union all
    select 'pair_without_update', pair.estimate_item_id, null, null, 4
    from pg_temp._ti682_pairs as pair
    where not exists (select 1 from pg_temp._ti682_choices as choice
      where choice.estimate_item_id = pair.estimate_item_id and choice.action = 'update')
    union all
    select 'new_line_paired_twice', null, null, null, 5
    from pg_temp._ti682_pairs as pair group by pair.takeoff_item_id having pg_catalog.count(*) > 1
    union all
    select 'new_line_not_applied', pair.estimate_item_id, null, null, 6
    from pg_temp._ti682_pairs as pair
    left join public.takeoff_items as source on source.id = pair.takeoff_item_id and source.job_id = p_job_id
      and source.tenant_id = p_tenant_id and not source.is_excluded
    where source.id is null or exists (select 1 from pg_catalog.jsonb_to_recordset(coalesce(p_mapping_plan, '[]'::jsonb))
      as plan(item_id uuid, action text) where plan.item_id = pair.takeoff_item_id and plan.action in ('skip', 'apply_assembly'))
    union all
    select 'unit_mismatch', pair.estimate_item_id, null, null, 7
    from pg_temp._ti682_pairs as pair
    join public.takeoff_items as source on source.id = pair.takeoff_item_id and source.job_id = p_job_id
    join pg_temp._ti682_lines as line on line.id = pair.estimate_item_id
    cross join lateral private.normalize_unit(source.unit) as resolved
    where coalesce(resolved.unit_code, 'status:' || resolved.pricing_status::text) is distinct from line.unit_key
    union all
    -- Never replace across two documents: each earlier source a pair removes is of the new line's document, and a new
    -- line known only by its name is not paired on a row where two identified documents of that name meet.
    select 'ambiguous_document', pair.estimate_item_id, null, null, 8
    from pg_temp._ti682_pairs as pair
    join public.takeoff_items as source on source.id = pair.takeoff_item_id and source.job_id = p_job_id
    join public.takeoff_jobs as source_job on source_job.id = source.job_id
    cross join lateral (select private.takeoff_line_page_identity(source.source_file_name, source.source_page,
      source.metadata -> 'source_document', source_job.preparation_snapshot #> '{preparation,sources}') as identity) as new_line
    join pg_temp._ti682_choices as choice on choice.estimate_item_id = pair.estimate_item_id and choice.action = 'update'
    cross join lateral pg_catalog.unnest(choice.item_ids) as removed(id)
    join public.takeoff_items as earlier on earlier.id = removed.id
    join public.takeoff_jobs as earlier_job on earlier_job.id = earlier.job_id
    cross join lateral (select private.takeoff_line_page_identity(earlier.source_file_name, earlier.source_page,
      earlier.metadata -> 'source_document', earlier_job.preparation_snapshot #> '{preparation,sources}') as identity) as old_line
    where not coalesce(private.takeoff_same_document(new_line.identity -> 'document', old_line.identity -> 'document'), false)
      or (nullif(new_line.identity #>> '{document,plan_file_id}', '') is null
        and nullif(new_line.identity #>> '{document,content_hash}', '') is null
        and exists (select 1 from pg_temp._ti682_conflicts as other
          join public.takeoff_items as other_item on other_item.id = other.earlier_item_id
          join public.takeoff_jobs as other_job on other_job.id = other_item.job_id
          cross join lateral (select private.takeoff_line_page_identity(other_item.source_file_name, other_item.source_page,
            other_item.metadata -> 'source_document', other_job.preparation_snapshot #> '{preparation,sources}') as identity) as other_line
          where private.takeoff_same_page(new_line.identity, other_line.identity)
            and (nullif(other_line.identity #>> '{document,plan_file_id}', '') is not null
              or nullif(other_line.identity #>> '{document,content_hash}', '') is not null)
            and not private.takeoff_same_document(other_line.identity -> 'document', old_line.identity -> 'document')))
    union all
    -- A quantity changed by hand: neither the sum of its sources rounded (since TI-681) nor their raw sum (a length
    -- applied before); unknown for an engine 1/2 line.
    select 'take_required', line.id, pg_catalog.min(choice.file_name), pg_catalog.min(choice.source_page), 9
    from pg_temp._ti682_lines as line join pg_temp._ti682_choices as choice on choice.estimate_item_id = line.id
    where choice.action = 'update'
      and (line.measured_raw is null or (line.quantity is distinct from line.measured_raw
        and line.quantity is distinct from (case when line.factor is not null
          then pg_catalog.ceil(line.measured_raw * line.factor) / line.factor else line.measured_raw end)))
    group by line.id having pg_catalog.bool_and(choice.take is null)
    union all
    -- A line that also carries pages this takeoff does not read is not removed: they would go with it.
    select 'remove_other_pages', choice.estimate_item_id, choice.file_name, choice.source_page, 10
    from pg_temp._ti682_choices as choice join pg_temp._ti682_lines as line on line.id = choice.estimate_item_id
    where choice.action = 'remove' and exists (select 1 from pg_catalog.unnest(line.source_ids) as source(id)
      where not exists (select 1 from pg_temp._ti682_conflicts as conflict
        where conflict.estimate_item_id = line.id and conflict.earlier_item_id = source.id))
    union all
    -- An ouvrage's component holds the ouvrage's quantity, not a measure: never replaced by a new line.
    select 'assembly_line', pair.estimate_item_id, null, null, 1
    from pg_temp._ti682_pairs as pair join pg_temp._ti682_lines as line on line.id = pair.estimate_item_id
    where line.assembly
    union all
    -- A « replacement » that keeps every earlier line and replaces nothing keeps both measures: that needs a reason.
    select 'nothing_replaced', null, pg_catalog.min(choice.file_name), pg_catalog.min(choice.source_page), 12
    from pg_temp._ti682_choices as choice join pg_temp._ti682_lines as line on line.id = choice.estimate_item_id
    where choice.decision = 'replace'
    group by choice.decision_id
    having pg_catalog.bool_and(choice.action = 'keep') and not pg_catalog.bool_or(line.source_provider = 'dpgf')
  ) as invalid
  order by invalid.rank, invalid.file_name, invalid.source_page
  limit 1;
  if failure is not null then
    raise exception 'TAKEOFF_PAGE_DECISION_INVALID' using errcode = '22023',
      detail = pg_catalog.jsonb_strip_nulls(failure || pg_catalog.jsonb_build_object('scope', 'page'))::text;
  end if;
end;
$$;
revoke all on function private.takeoff_prepare_page_decisions(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;

-- Codex review of c06cbb1b: the mapping plan the writer receives. A new line paired with an earlier line only gives that
-- line its quantity: its `set_price` or `set_category` is not written there (a price write would clear the line's
-- recorded price origin and derive its provision again, private.derive_estimate_item_fo_provision). The line `append`
-- creates for it is deleted by takeoff_replace_pages. Read after takeoff_prepare_page_decisions (pg_temp._ti682_pairs).
create function private.takeoff_page_writer_plan(p_mapping_plan jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if pg_catalog.to_regclass('pg_temp._ti682_pairs') is null or pg_catalog.jsonb_typeof(p_mapping_plan) is distinct from 'array'
    or not exists (select 1 from pg_temp._ti682_pairs) then
    return p_mapping_plan;
  end if;
  return (select pg_catalog.jsonb_agg(case
      when entry.value ->> 'action' in ('set_price', 'set_category') and exists (select 1 from pg_temp._ti682_pairs as pair
        where pair.takeoff_item_id = private.takeoff_uuid_or_null(entry.value -> 'item_id'))
      then entry.value || pg_catalog.jsonb_build_object('action', 'none', 'unit_price_cents', null, 'category_id', null)
      else entry.value end order by entry.ordinality)
    from pg_catalog.jsonb_array_elements(p_mapping_plan) with ordinality as entry(value, ordinality));
end;
$$;

revoke all on function private.takeoff_page_writer_plan(jsonb) from public, anon, authenticated, service_role;

-- After the atomic application (and the DPGF consolidation): each earlier estimate line the estimator replaces keeps
-- its identity, title, price, category, settings and lot C columns; its quantity is its measured quantity less the
-- earlier source lines of the replaced pages plus the new lines paired with it (rounded once, up to the unit, for a
-- length), or stays the estimator's own (« keep_mine »); its provenance becomes the new takeoff's. The lines this call
-- created for the paired new lines are deleted, the lines the estimator removes too. Returns the links it handled (the
-- paired new lines, now on their earlier line), the links left for finalize_takeoff_lengths, the deleted and the
-- updated ids.
create function private.takeoff_replace_pages(
  p_job_id uuid,
  p_tenant_id uuid,
  p_version_id uuid,
  p_links jsonb,
  p_created_ids uuid[]
)
returns table (handled_links jsonb, remaining_links jsonb, removed_ids uuid[], updated_ids uuid[])
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  engine smallint;
  old_writer text := coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true), '');
  conflict uuid;
  conflict_item uuid;
  conflict_pair uuid;
  deleted uuid[] := '{}'::uuid[];
  updated uuid[] := '{}'::uuid[];
begin
  if coalesce(pg_catalog.current_setting('app.takeoff_apply_atomic', true), '') <> 'on' then
    raise exception 'TAKEOFF_ATOMIC_APPLY_REQUIRED' using errcode = '42501';
  end if;
  if pg_catalog.to_regclass('pg_temp._ti682_lines') is null then
    raise exception 'TAKEOFF_ATOMIC_APPLY_REQUIRED' using errcode = '42501';
  end if;

  drop table if exists pg_temp._ti682_links;
  create temporary table _ti682_links on commit drop as
  select distinct link.takeoff_item_id, link.estimate_item_id
  from pg_catalog.jsonb_to_recordset(coalesce(p_links, '[]'::jsonb)) as link(takeoff_item_id uuid, estimate_item_id uuid);

  -- A paired new line must come out of the application as a line created by this call, or as its own earlier line (a
  -- `merge` by title). A new line `merge` sent onto another earlier line of these pages replaced it silently: without
  -- any decision, that is the page applied again; with decisions, a replacement the estimator did not see.
  select link.estimate_item_id, pair.takeoff_item_id, pair.estimate_item_id into conflict, conflict_item, conflict_pair
  from pg_temp._ti682_pairs as pair
  left join pg_temp._ti682_links as link on link.takeoff_item_id = pair.takeoff_item_id
  where link.estimate_item_id is null
    or not (link.estimate_item_id = pair.estimate_item_id or link.estimate_item_id = any(coalesce(p_created_ids, '{}'::uuid[])))
  order by pair.takeoff_item_id
  limit 1;
  if conflict_item is null then
    select link.estimate_item_id, link.takeoff_item_id into conflict, conflict_item
    from pg_temp._ti682_links as link
    join pg_temp._ti682_lines as line on line.id = link.estimate_item_id and line.source_provider is distinct from 'dpgf'
    where not exists (select 1 from pg_temp._ti682_pairs as pair where pair.takeoff_item_id = link.takeoff_item_id
      and pair.estimate_item_id = link.estimate_item_id)
    order by link.estimate_item_id, link.takeoff_item_id
    limit 1;
    if conflict is not null and not exists (select 1 from pg_temp._ti682_choices) then
      raise exception 'TAKEOFF_PAGE_ALREADY_APPLIED' using errcode = '23514',
        detail = private.takeoff_page_refusal_detail('merged_without_decision', (select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object('estimate_item_id', page.estimate_item_id, 'earlier_job_id', page.earlier_job_id,
            'source_file_name', page.source_file_name, 'source_page', page.source_page) order by page.page_rank)
          from pg_temp._ti682_conflicts as page where page.estimate_item_id = conflict));
    end if;
  end if;
  if conflict_item is not null then
    -- The new line, the earlier line `merge` put it on (null: none) and the line it was paired with (null: none).
    raise exception 'TAKEOFF_PAGE_REPLACE_CONFLICT' using errcode = '40001',
      detail = pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('scope', 'page', 'reason', 'merge_elsewhere',
        'takeoff_item_id', conflict_item, 'estimate_item_id', conflict, 'paired_estimate_item_id', conflict_pair))::text;
  end if;
  if not exists (select 1 from pg_temp._ti682_pairs) and not exists (select 1 from pg_temp._ti682_choices) then
    return query select '[]'::jsonb, coalesce(p_links, '[]'::jsonb), '{}'::uuid[], '{}'::uuid[];
    return;
  end if;

  select version.calc_engine_version into engine from public.estimate_versions as version
  where version.id = p_version_id and version.tenant_id = p_tenant_id;
  if engine = 3 then
    perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', p_version_id::text, true);
  end if;

  drop table if exists pg_temp._ti682_replaced;
  create temporary table _ti682_replaced on commit drop as
  select line.id, line.quantity as previous_quantity, line.factor, line.measured_raw,
    pg_catalog.max(choice.take) as take,
    coalesce((select pg_catalog.array_agg(distinct removed.id) from pg_temp._ti682_choices as removing
      cross join lateral pg_catalog.unnest(removing.item_ids) as removed(id)
      where removing.estimate_item_id = line.id and removing.action = 'update'), '{}'::uuid[]) as removed_ids,
    line.source_ids
  from pg_temp._ti682_lines as line
  join pg_temp._ti682_choices as choice on choice.estimate_item_id = line.id and choice.action = 'update'
  group by line.id, line.quantity, line.factor, line.measured_raw, line.source_ids;

  drop table if exists pg_temp._ti682_outcome;
  create temporary table _ti682_outcome on commit drop as
  select replaced.id, replaced.previous_quantity, replaced.take, replaced.factor,
    -- An engine 1/2 line names no source: the page's earlier part is the whole line.
    case when pg_catalog.cardinality(replaced.source_ids) = 0 then replaced.previous_quantity
      else coalesce((select pg_catalog.sum(source.quantity) from public.takeoff_items as source
        where source.id = any(replaced.removed_ids) and source.tenant_id = p_tenant_id), 0) end as removed_raw,
    added.raw as added_raw,
    case when pg_catalog.cardinality(replaced.source_ids) = 0 then 0
      else coalesce((select pg_catalog.sum(source.quantity) from public.takeoff_items as source
        where source.id = any(replaced.source_ids) and not source.id = any(replaced.removed_ids)
          and source.tenant_id = p_tenant_id), 0) end + added.raw as new_raw,
    added.ids || array(select kept.id from pg_catalog.unnest(replaced.source_ids) as kept(id)
      where not kept.id = any(replaced.removed_ids)) as item_ids,
    added.first_id, added.file_name, added.page,
    (select pg_catalog.array_agg(distinct source.job_id) from public.takeoff_items as source
      where source.id = any(replaced.removed_ids)) as replaced_job_ids
  from pg_temp._ti682_replaced as replaced
  cross join lateral (
    select pg_catalog.sum(source.quantity) as raw, pg_catalog.array_agg(source.id order by source.id) as ids,
      (pg_catalog.array_agg(source.id order by source.id))[1] as first_id,
      (pg_catalog.array_agg(source.source_file_name order by source.id))[1] as file_name,
      (pg_catalog.array_agg(source.source_page order by source.id))[1] as page
    from pg_temp._ti682_pairs as pair
    join public.takeoff_items as source on source.id = pair.takeoff_item_id and source.job_id = p_job_id
      and source.tenant_id = p_tenant_id
    where pair.estimate_item_id = replaced.id
  ) as added;

  update public.estimate_items as item
  set quantity = case when outcome.take = 'keep_mine' then outcome.previous_quantity
      when outcome.factor is not null then pg_catalog.ceil(outcome.new_raw * outcome.factor) / outcome.factor
      else outcome.new_raw end,
    -- What `merge` may have rewritten on its own earlier line is the estimator's: title and description. Its price and
    -- category are never written (private.takeoff_page_writer_plan), so no trigger derives anything from them.
    title = line.title, description = line.description,
    source_provider = 'takeoff', source_job_id = p_job_id,
    source_file_name = outcome.file_name, source_page = outcome.page,
    source_metadata = (coalesce(line.source_metadata, '{}'::jsonb) - 'takeoff_length_rounding' - 'takeoff_page_replacement')
      || pg_catalog.jsonb_build_object('takeoff_item_id', outcome.first_id)
      || case when outcome.factor is not null then pg_catalog.jsonb_build_object('takeoff_length_rounding',
        pg_catalog.jsonb_build_object('version', 1, 'job_id', p_job_id, 'raw_quantity', outcome.new_raw,
          'metres_per_unit', outcome.factor, 'item_ids', pg_catalog.to_jsonb(outcome.item_ids))) else '{}'::jsonb end
      || pg_catalog.jsonb_build_object('takeoff_page_replacement', pg_catalog.jsonb_build_object('version', 1,
        'job_id', p_job_id, 'replaced_job_ids', pg_catalog.to_jsonb(coalesce(outcome.replaced_job_ids, '{}'::uuid[])),
        'previous_quantity', outcome.previous_quantity, 'removed_raw', outcome.removed_raw, 'added_raw', outcome.added_raw,
        'take', coalesce(outcome.take, 'new'), 'item_ids', pg_catalog.to_jsonb(outcome.item_ids))),
    updated_at = pg_catalog.statement_timestamp()
  from pg_temp._ti682_outcome as outcome
  join pg_temp._ti682_lines as line on line.id = outcome.id
  where item.id = outcome.id and item.version_id = p_version_id and item.tenant_id = p_tenant_id;
  select coalesce(pg_catalog.array_agg(outcome.id order by outcome.id), '{}'::uuid[]) into updated from pg_temp._ti682_outcome as outcome;

  -- The lines this call created for the paired new lines, and the earlier lines the estimator removes.
  select coalesce(pg_catalog.array_agg(distinct deleted_id.id), '{}'::uuid[]) into deleted
  from (
    select link.estimate_item_id as id from pg_temp._ti682_pairs as pair
    join pg_temp._ti682_links as link on link.takeoff_item_id = pair.takeoff_item_id
    where link.estimate_item_id = any(coalesce(p_created_ids, '{}'::uuid[])) and link.estimate_item_id <> pair.estimate_item_id
    union
    select choice.estimate_item_id from pg_temp._ti682_choices as choice where choice.action = 'remove'
  ) as deleted_id;
  delete from public.estimate_items as item
  where item.id = any(deleted) and item.version_id = p_version_id and item.tenant_id = p_tenant_id;

  if engine = 3 then
    perform public.estimate_v3_complete_entry_for_writer(p_version_id, updated);
    perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', old_writer, true);
  else
    perform public.recalculate_takeoff_estimate_version(p_version_id, p_tenant_id);
  end if;

  return query select
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('takeoff_item_id', pair.takeoff_item_id,
      'estimate_item_id', pair.estimate_item_id) order by pair.takeoff_item_id) from pg_temp._ti682_pairs as pair), '[]'::jsonb),
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('takeoff_item_id', link.takeoff_item_id,
      'estimate_item_id', link.estimate_item_id) order by link.takeoff_item_id) from pg_temp._ti682_links as link
      where not exists (select 1 from pg_temp._ti682_pairs as pair where pair.takeoff_item_id = link.takeoff_item_id)), '[]'::jsonb),
    deleted, updated;
exception when others then
  perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', old_writer, true);
  raise;
end;
$$;
revoke all on function private.takeoff_replace_pages(uuid, uuid, uuid, jsonb, uuid[]) from public, anon, authenticated, service_role;

-- The last net, after everything the application wrote: on every page the takeoff now brings into the estimate, each
-- earlier contribution still there is one a decision keeps (« keep_both », or a line kept in a replacement), source
-- line by source line. Without any decision: TAKEOFF_PAGE_ALREADY_APPLIED, the first page named. With decisions that
-- no longer cover the estimate: TAKEOFF_PAGE_DECISION_STALE. Until DPGF targets sum the measures they keep, « keep
-- both » is refused on a page whose new lines now feed a DPGF target another takeoff fed (TAKEOFF_PAGE_DECISION_INVALID).
create function private.assert_takeoff_pages_once(p_job_id uuid, p_version_id uuid)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  job_tenant uuid;
  uncovered jsonb;
  has_decisions boolean;
  dpgf_target uuid;
begin
  if coalesce(pg_catalog.current_setting('app.takeoff_apply_atomic', true), '') <> 'on' then
    raise exception 'TAKEOFF_ATOMIC_APPLY_REQUIRED' using errcode = '42501';
  end if;
  select job.tenant_id into job_tenant from public.takeoff_jobs as job where job.id = p_job_id;
  select exists (select 1 from public.takeoff_page_decisions as decision
    where decision.job_id = p_job_id and decision.tenant_id = job_tenant and decision.estimate_version_id = p_version_id
      and decision.decided_by = (select auth.uid()))
    into has_decisions;

  -- The pages the takeoff now brings: its lines still included once the application left out what the mapping plan
  -- skips or folds into an assembly.
  drop table if exists pg_temp._ti682_uncovered;
  create temporary table _ti682_uncovered on commit drop as
  select conflict.*
  from private.takeoff_page_conflicts(p_version_id, p_job_id, null) as conflict
  where not exists (select 1 from public.takeoff_page_decisions as decision
    cross join lateral pg_catalog.jsonb_array_elements(decision.lines) as line(value)
    where decision.job_id = p_job_id and decision.tenant_id = job_tenant and decision.estimate_version_id = p_version_id
      and decision.decided_by = (select auth.uid())
      and (line.value ->> 'estimate_item_id')::uuid = conflict.estimate_item_id
      and (decision.decision = 'keep_both' or line.value ->> 'action' = 'keep')
      and (conflict.earlier_item_id is null or line.value -> 'item_ids' @> pg_catalog.jsonb_build_array(conflict.earlier_item_id)));

  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('estimate_item_id', conflict.estimate_item_id,
      'earlier_job_id', conflict.earlier_job_id, 'source_file_name', conflict.source_file_name,
      'source_page', conflict.source_page, 'plan_file_id', (select new_item.metadata #>> '{source_document,plan_file_id}'
        from public.takeoff_items as new_item where new_item.id = any(conflict.new_item_ids)
          and new_item.metadata #>> '{source_document,kind}' = 'plan_file' order by new_item.id limit 1))
      order by conflict.page_rank, conflict.estimate_item_id)
    into uncovered
  from pg_temp._ti682_uncovered as conflict
  where conflict.page_rank = (select pg_catalog.min(first.page_rank) from pg_temp._ti682_uncovered as first);
  if uncovered is not null then
    if has_decisions then
      raise exception 'TAKEOFF_PAGE_DECISION_STALE' using errcode = '40001',
        detail = private.takeoff_page_refusal_detail('page_not_decided', uncovered);
    end if;
    raise exception 'TAKEOFF_PAGE_ALREADY_APPLIED' using errcode = '23514',
      detail = private.takeoff_page_refusal_detail('page_already_applied', uncovered);
  end if;

  -- A DPGF target « replaced » with its page must have been fed again by this takeoff: else its earlier measure stays
  -- beside the new lines of the page, both counted without a reason.
  select (line.value ->> 'estimate_item_id')::uuid into dpgf_target
  from public.takeoff_page_decisions as decision
  cross join lateral pg_catalog.jsonb_array_elements(decision.lines) as line(value)
  join public.estimate_items as item on item.id = (line.value ->> 'estimate_item_id')::uuid and item.version_id = p_version_id
  where decision.job_id = p_job_id and decision.tenant_id = job_tenant and decision.estimate_version_id = p_version_id
    and decision.decision = 'replace' and line.value ->> 'action' = 'keep' and item.source_provider = 'dpgf'
    and (item.source_metadata #>> '{takeoff_quantity_policy,job_id}') is distinct from p_job_id::text
  limit 1;
  if dpgf_target is not null then
    raise exception 'TAKEOFF_PAGE_DECISION_INVALID' using errcode = '22023',
      detail = pg_catalog.jsonb_build_object('scope', 'page', 'reason', 'dpgf_not_replaced', 'estimate_item_id', dpgf_target)::text;
  end if;

  -- D-6: a DPGF target keeps the measure of the last takeoff only. Keeping both on a page whose new lines now feed a
  -- target another takeoff fed would promise two measures where the target holds one.
  select (line.value ->> 'estimate_item_id')::uuid into dpgf_target
  from public.takeoff_page_decisions as decision
  cross join lateral pg_catalog.jsonb_array_elements(decision.lines) as line(value)
  join public.estimate_items as item on item.id = (line.value ->> 'estimate_item_id')::uuid and item.version_id = p_version_id
  where decision.job_id = p_job_id and decision.tenant_id = job_tenant and decision.estimate_version_id = p_version_id
    and decision.decision = 'keep_both' and item.source_provider = 'dpgf'
    and item.source_metadata #>> '{takeoff_quantity_policy,job_id}' = p_job_id::text
  limit 1;
  if dpgf_target is not null then
    raise exception 'TAKEOFF_PAGE_DECISION_INVALID' using errcode = '22023',
      detail = pg_catalog.jsonb_build_object('scope', 'page', 'reason', 'dpgf_keep_both', 'estimate_item_id', dpgf_target)::text;
  end if;
end;
$$;
revoke all on function private.assert_takeoff_pages_once(uuid, uuid) from public, anon, authenticated, service_role;

-- The guarded overloads --------------------------------------------------------------------------------------------

-- From 20261110094503_takeoff_apply_provisions.sql (4 arguments: a version without DPGF line). Lines marked « TI-682 D ».
-- Their search_path stays exactly pg_catalog (pinned by security-invariants and takeoff-apply-security-definer).
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

  -- TI-677: the version's lock (the writer's and the review's) before any lock on the job or its lines: a save of
  -- another job's line waits for the application instead of invalidating the job being applied.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-rules:' || job_version_id::text, 0));
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

-- From 20261110094503_takeoff_apply_provisions.sql (5 arguments: a DPGF authorization). Lines marked « TI-682 D ».
create or replace function public.apply_takeoff_job_guarded_atomic(
  p_job_id uuid,
  p_strategy text,
  p_target_section_id uuid,
  p_mapping_plan jsonb,
  p_dpgf_authorization_token text
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
  caller_id uuid := (select auth.uid());
  job_tenant_id uuid;
  job_version_id uuid;
  authorization_id uuid;
  quantity_policy jsonb;
  quantity_sources jsonb;
  comparison_stamp text;
  applied record;
  engine integer;
  old_writer text;
  removed_ids uuid[] := '{}'::uuid[];
  additional_updates integer := 0;
  -- TI-686 M3: the finalized result, returned once its provisions are marked.
  final_result record;
  -- TI-682 D: the links after the DPGF consolidation, and what the page replacement did with them.
  consolidated_links jsonb;
  replaced record;
begin
  if caller_id is null then
    raise exception 'TAKEOFF_APPLY_AUTH_REQUIRED' using errcode = '42501';
  end if;

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

  select permit.id, coalesce(permit.review_summary->'quantity_policy', '[]'::jsonb), permit.review_summary->'quantity_sources', permit.review_summary->>'quantity_version_stamp'
    into authorization_id, quantity_policy, quantity_sources, comparison_stamp
  from public.takeoff_apply_authorizations as permit
  where permit.authorization_token_hash = encode(
      sha256(convert_to(p_dpgf_authorization_token, 'UTF8')),
      'hex'
    )
    and permit.tenant_id = job_tenant_id
    and permit.job_id = p_job_id
    and permit.estimate_version_id = job_version_id
    and permit.user_id = caller_id
    and permit.consumed_at is null
    and permit.expires_at > statement_timestamp()
  for update;

  if authorization_id is null then
    raise exception 'TAKEOFF_DPGF_APPLY_AUTHORIZATION_INVALID'
      using errcode = '42501';
  end if;

  update public.takeoff_apply_authorizations as permit
  set
    authorization_token_hash = null,
    consumed_at = statement_timestamp()
  where permit.id = authorization_id;

  -- TI-677: the version's lock (the writer's and the review's) before any lock on the job or its lines: a save of
  -- another job's line waits for the application instead of invalidating the job being applied.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-rules:' || job_version_id::text, 0));
  perform set_config('app.takeoff_apply_job', 'on', true);
  perform set_config('app.takeoff_apply_atomic', 'on', true);
  -- The service minted a snapshot of every target/source used in this comparison.
  -- Lock the version before checking it and before the inner writer locks a job.
  select version.calc_engine_version into engine
  from public.estimate_versions version
  where version.id=job_version_id and version.tenant_id=job_tenant_id
  for update;

  if comparison_stamp is not null and comparison_stamp is distinct from public.takeoff_rule_version_stamp(job_tenant_id,job_version_id) then
    raise exception 'TAKEOFF_DPGF_QUANTITY_SNAPSHOT_STALE' using errcode='40001';
  end if;

  if quantity_sources is not null and (
    jsonb_array_length(quantity_sources) <> (select count(*) from public.takeoff_items where job_id=p_job_id and tenant_id=job_tenant_id)
    or exists(select 1 from jsonb_to_recordset(quantity_sources)
      as snapshot(id uuid,updated_at timestamptz,quantity numeric,designation text,unit text,is_excluded boolean)
      left join public.takeoff_items item on item.id=snapshot.id and item.job_id=p_job_id and item.tenant_id=job_tenant_id
        and item.updated_at=snapshot.updated_at and item.quantity=snapshot.quantity and item.designation=snapshot.designation
        and item.unit=snapshot.unit and item.is_excluded=snapshot.is_excluded
      where item.id is null)) then
    raise exception 'TAKEOFF_DPGF_QUANTITY_SNAPSHOT_STALE' using errcode='40001';
  end if;

  drop table if exists pg_temp._p680_targets;
  create temporary table _p680_targets on commit drop as
  select policy.*, item.title as original_title, item.description as original_description,
    item.unit_price_ht_cents as original_price, item.category_id as original_category
  from jsonb_to_recordset(quantity_policy) as policy(
    target_id uuid, expected_updated_at timestamptz, reference_quantity numeric, measured_quantity numeric,
    priced_quantity numeric, absolute_gap numeric, reviewed boolean, review_decision_id uuid, review_updated_at timestamptz,
    source_file_name text, source_page integer,
    source_metadata jsonb, takeoff_items jsonb)
  left join public.estimate_items item on item.id=policy.target_id
    and item.version_id=job_version_id and item.tenant_id=job_tenant_id
    and item.source_provider='dpgf' and item.updated_at=policy.expected_updated_at;
  create unique index on pg_temp._p680_targets(target_id);

  if exists(select 1 from pg_temp._p680_targets) then
    if lower(btrim(p_strategy)) <> 'merge' then
      raise exception 'TAKEOFF_DPGF_QUANTITY_MERGE_REQUIRED' using errcode='22023';
    end if;
    if exists(select 1 from pg_temp._p680_targets where original_title is null
      or measured_quantity is null or priced_quantity is null
      or reference_quantity<0 or measured_quantity<0 or priced_quantity<greatest(reference_quantity,measured_quantity)
      or source_metadata is null or jsonb_typeof(takeoff_items) is distinct from 'array'
      or jsonb_array_length(takeoff_items)=0) then
      raise exception 'TAKEOFF_DPGF_QUANTITY_SNAPSHOT_STALE' using errcode='40001';
    end if;
    if exists(select 1 from pg_temp._p680_targets target where coalesce(reviewed,false)
      and not exists(select 1 from public.takeoff_dpgf_review_decisions decision
        where decision.id=target.review_decision_id and decision.tenant_id=job_tenant_id
          and decision.takeoff_job_id=p_job_id and decision.updated_at=target.review_updated_at)) then
      raise exception 'TAKEOFF_DPGF_QUANTITY_SNAPSHOT_STALE' using errcode='40001';
    end if;
    -- TI-681: quantity differences recommend review; the protective maximum remains mandatory.
  end if;

  drop table if exists pg_temp._p680_sources;
  create temporary table _p680_sources on commit drop as
  select target.target_id, source.id as takeoff_item_id, source.quantity, source.updated_at
  from pg_temp._p680_targets target cross join lateral jsonb_to_recordset(target.takeoff_items)
    as source(id uuid,quantity numeric,updated_at timestamptz);
  create unique index on pg_temp._p680_sources(takeoff_item_id);
  if exists(select 1 from pg_temp._p680_sources source
    left join public.takeoff_items item on item.id=source.takeoff_item_id and item.job_id=p_job_id
      and item.tenant_id=job_tenant_id and not item.is_excluded
      and item.updated_at=source.updated_at and item.quantity=source.quantity
    where item.id is null) then
    raise exception 'TAKEOFF_DPGF_QUANTITY_SNAPSHOT_STALE' using errcode='40001';
  end if;

  perform private.assert_takeoff_single_quantity_source(p_job_id);
  -- TI-682 D: the earlier contributions of the pages this takeoff reads and its decisions, before anything is written.
  perform private.takeoff_prepare_page_decisions(p_job_id, job_tenant_id, job_version_id, p_strategy, p_mapping_plan);
  select result.* into applied
  from public.apply_takeoff_job_atomic(p_job_id,p_strategy,p_target_section_id,
    private.takeoff_page_writer_plan(p_mapping_plan)) result;

  if exists(select 1 from pg_temp._p680_targets) then
    -- Retain all existing mapping/engine guards. Only this invocation's newly created duplicate
    -- outputs may be consolidated; another pre-existing estimate line must never be deleted.
    drop table if exists pg_temp._p680_outputs;
    create temporary table _p680_outputs on commit drop as
    select source.target_id, source.takeoff_item_id, output.estimate_item_id,
      plan.action, plan.unit_price_cents, plan.category_id
    from pg_temp._p680_sources source
    left join jsonb_to_recordset(applied.item_links) as output(takeoff_item_id uuid,estimate_item_id uuid)
      on output.takeoff_item_id=source.takeoff_item_id
    left join jsonb_to_recordset(p_mapping_plan) as plan(item_id uuid,action text,unit_price_cents integer,category_id uuid)
      on plan.item_id=source.takeoff_item_id;
    if exists(select 1 from pg_temp._p680_outputs output where output.estimate_item_id is null
      or (not output.estimate_item_id=any(applied.created_ids)
        and not exists(select 1 from pg_temp._p680_targets target where target.target_id=output.estimate_item_id))) then
      raise exception 'TAKEOFF_DPGF_QUANTITY_MAPPING_CONFLICT' using errcode='40001';
    end if;
    if exists(select 1 from pg_temp._p680_outputs group by target_id
      having count(distinct unit_price_cents) filter(where action='set_price')>1
        or count(distinct category_id) filter(where action='set_category')>1) then
      raise exception 'TAKEOFF_DPGF_QUANTITY_MAPPING_CONFLICT' using errcode='22023';
    end if;
    old_writer:=coalesce(current_setting('miaouffrage.estimate_v3_writer',true),'');
    if engine=3 then perform set_config('miaouffrage.estimate_v3_writer',job_version_id::text,true); end if;

    select count(*)::integer into additional_updates from pg_temp._p680_targets target
    where not exists(select 1 from pg_temp._p680_outputs output where output.estimate_item_id=target.target_id
      and not output.estimate_item_id=any(applied.created_ids));

    update public.estimate_items item set
      quantity=target.priced_quantity,
      title=target.original_title, description=target.original_description,
      unit_price_ht_cents=coalesce(mapping.unit_price_cents,target.original_price),
      category_id=case when mapping.has_category then mapping.category_id else target.original_category end,
      source_provider='dpgf', source_job_id=p_job_id,
      source_file_name=target.source_file_name, source_page=target.source_page,
      source_metadata=target.source_metadata||jsonb_build_object('takeoff_quantity_policy',jsonb_build_object(
        'version',1,'job_id',p_job_id,'reference_quantity',target.reference_quantity,
        'measured_quantity',target.measured_quantity,'priced_quantity',target.priced_quantity,
        'absolute_gap',target.absolute_gap,'reviewed',target.reviewed,'item_ids',mapping.item_ids)),
      updated_at=statement_timestamp()
    from pg_temp._p680_targets target
    join (select target_id,
      max(unit_price_cents) filter(where action='set_price') as unit_price_cents,
      (array_agg(category_id) filter(where action='set_category'))[1] as category_id,
      bool_or(action='set_category') as has_category,
      jsonb_agg(takeoff_item_id order by takeoff_item_id) as item_ids
      from pg_temp._p680_outputs group by target_id) mapping on mapping.target_id=target.target_id
    where item.id=target.target_id and item.version_id=job_version_id and item.tenant_id=job_tenant_id;

    select coalesce(array_agg(distinct output.estimate_item_id),'{}'::uuid[]) into removed_ids
    from pg_temp._p680_outputs output where output.estimate_item_id=any(applied.created_ids)
      and not exists(select 1 from pg_temp._p680_targets target where target.target_id=output.estimate_item_id);
    delete from public.estimate_items item where item.id=any(removed_ids)
      and item.version_id=job_version_id and item.tenant_id=job_tenant_id;

    if engine=3 then
      perform public.estimate_v3_complete_entry_for_writer(job_version_id,
        coalesce((select array_agg(target_id) from pg_temp._p680_targets),'{}'::uuid[]));
      perform set_config('miaouffrage.estimate_v3_writer',old_writer,true);
    else
      perform public.recalculate_takeoff_estimate_version(job_version_id,job_tenant_id);
    end if;
  end if;

  -- TI-682 D: the links after the DPGF consolidation (a source of a target now on its target), then the replaced pages.
  consolidated_links := coalesce((select jsonb_agg(jsonb_build_object('takeoff_item_id',output.takeoff_item_id,
      'estimate_item_id',coalesce(source.target_id,output.estimate_item_id)) order by output.takeoff_item_id)
      from jsonb_to_recordset(applied.item_links) as output(takeoff_item_id uuid,estimate_item_id uuid)
      left join pg_temp._p680_sources source on source.takeoff_item_id=output.takeoff_item_id),'[]'::jsonb);
  select result.* into replaced from private.takeoff_replace_pages(p_job_id, job_tenant_id, job_version_id,
    consolidated_links, coalesce((select array_agg(id order by id) from unnest(applied.created_ids) ids(id)
      where not id=any(removed_ids)),'{}'::uuid[])) as result;
  removed_ids := removed_ids || replaced.removed_ids;

  -- TI-686 M3: the finalized result of 20261109205839 (merged length lines), kept to mark its provisions first.
  -- TI-682 D: on the links the replacement left.
  select finalized.* into final_result from private.finalize_takeoff_lengths(p_job_id,
    applied.created_count-(select count(*)::integer from unnest(applied.created_ids) ids(id) where id=any(removed_ids)),
    applied.updated_count+additional_updates+cardinality(replaced.updated_ids),applied.ignored_count,
    coalesce((select array_agg(id order by id) from unnest(applied.created_ids) ids(id)
      where not id=any(removed_ids)),'{}'::uuid[]),applied.scope,
    replaced.remaining_links,p_mapping_plan) finalized;
  -- TI-682 D: a page another takeoff brought enters only by a decision.
  perform private.assert_takeoff_pages_once(p_job_id, job_version_id);
  -- TI-686 M3: a forced line or an entered hypothesis enters the estimate as an internal provision. TI-682 D: the
  -- replaced lines too, from the new takeoff's sources (the last takeoff wins).
  final_result.item_links := coalesce((select jsonb_agg(link.value order by link.value ->> 'takeoff_item_id')
    from jsonb_array_elements(coalesce(final_result.item_links, '[]'::jsonb) || replaced.handled_links) as link(value)), '[]'::jsonb);
  perform private.takeoff_mark_provisions(p_job_id,job_tenant_id,job_version_id,final_result.item_links,
    final_result.created_ids);
  return query select final_result.created_count,final_result.updated_count,final_result.ignored_count,
    final_result.created_ids,final_result.scope,final_result.item_links;
end;
$$;

revoke all on function public.apply_takeoff_job_guarded_atomic(
  uuid, text, uuid, jsonb, text
) from public, anon;
grant execute on function public.apply_takeoff_job_guarded_atomic(
  uuid, text, uuid, jsonb, text
) to authenticated;

-- Codex review of c06cbb1b: the page decisions travel with the application. Recorded and applied in one transaction
-- (the job's row lock taken by the record is held until the application commits), so that an application applies the
-- decisions of its own request, never those another tab recorded between a record and an application.
create function public.apply_takeoff_job_with_page_decisions(
  p_job_id uuid,
  p_strategy text,
  p_target_section_id uuid,
  p_mapping_plan jsonb,
  p_page_decisions jsonb,
  p_dpgf_authorization_token text default null
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
security invoker
set search_path = pg_catalog
as $$
declare
  job_version_id uuid;
begin
  -- TI-677: the version's lock before any lock on the job (the record locks the job's row), as the application takes
  -- them: two applications on the version never hold them in opposite orders.
  select job.estimate_version_id into job_version_id from public.takeoff_jobs as job where job.id = p_job_id;
  if job_version_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-rules:' || job_version_id::text, 0));
  end if;
  perform public.record_takeoff_page_decisions(p_job_id, coalesce(p_page_decisions, '[]'::jsonb));
  if p_dpgf_authorization_token is null then
    return query select applied.* from public.apply_takeoff_job_guarded_atomic(p_job_id, p_strategy, p_target_section_id,
      p_mapping_plan) as applied;
  else
    return query select applied.* from public.apply_takeoff_job_guarded_atomic(p_job_id, p_strategy, p_target_section_id,
      p_mapping_plan, p_dpgf_authorization_token) as applied;
  end if;
end;
$$;

revoke all on function public.apply_takeoff_job_with_page_decisions(uuid, text, uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.apply_takeoff_job_with_page_decisions(uuid, text, uuid, jsonb, jsonb, text) to authenticated;

commit;
