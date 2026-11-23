begin;
set local lock_timeout = '5s';

create function private.guard_estimate_draft_dependencies()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owned_jobs uuid[];
  holder_count bigint;
  version_names text;
  versions jsonb;
  all_drafts boolean;
  issued_variant record;
  refusal_code text;
  explanation text;
begin
  -- The affaire DELETE has already removed its project when the FK deletes its versions.
  -- Read as the function owner so that RLS visibility cannot masquerade as a cascade.
  if not exists (
    select 1 from public.estimate_projects p where p.id = old.project_id and p.tenant_id = old.tenant_id
  ) then
    return old;
  end if;

  -- DELETE already holds the source version. An engine-2 section copy takes KEY SHARE
  -- on its line's direct job through the FK; a batch takes SHARE on the job and its link.
  select array(
    select j.id from public.takeoff_jobs j
    where j.tenant_id = old.tenant_id and j.project_id = old.project_id and j.estimate_version_id = old.id
    order by j.id for update
  ) into owned_jobs;

  if cardinality(owned_jobs) > 0 then
    perform l.id from public.takeoff_version_links l
    where l.tenant_id = old.tenant_id and l.takeoff_job_id = any(owned_jobs)
    order by l.id for update;

    -- This statement gets a fresh READ COMMITTED snapshot after any writer we waited for.
    -- A confirmed accumulation names its latest job in the FK, and its earlier items in JSON.
    with named as (
      select v.id, v.version_number, v.updated_at,
        concat('V', v.version_number,
          case when v.variant_label is not null then ' · variante ' || v.variant_label end,
          case when nullif(btrim(v.title), '') is not null then ' — ' || left(btrim(v.title), 64) end) as name,
        count(*) over () as total, bool_and(v.status = 'draft') over () as all_drafts
      from public.estimate_versions v
      where v.tenant_id = old.tenant_id and v.project_id = old.project_id and v.id <> old.id
        and exists (
          select 1 from public.estimate_items i
          where i.tenant_id = v.tenant_id and i.version_id = v.id
            and i.item_type = 'line' and i.source_job_id is not null
            and (i.source_job_id = any(owned_jobs) or exists (
              select 1 from unnest(private.takeoff_estimate_line_item_ids(i.source_metadata, i.source_job_id)) as source(id)
              join public.takeoff_items ti on ti.id = source.id and ti.tenant_id = i.tenant_id
              where ti.job_id = any(owned_jobs)
            ))
        )
      order by v.version_number desc, v.updated_at desc, v.id
      limit 5
    )
    select max(n.total), bool_and(n.all_drafts),
      jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name) order by n.version_number desc, n.updated_at desc, n.id),
      string_agg('« ' || n.name || ' »', ', ' order by n.version_number desc, n.updated_at desc, n.id)
    into holder_count, all_drafts, versions, version_names
    from named n;
  end if;

  -- Nulling the lineage of an issued variant would invalidate its sealed offer.
  select v.id, format('V%s · variante %s', v.version_number, v.variant_label) as name
  into issued_variant
  from public.estimate_versions v
  where v.parent_version_id = old.id and v.tenant_id = old.tenant_id and v.project_id = old.project_id
    and v.seal_payload_version = 5 and v.status in ('sent', 'accepted', 'archived')
  order by v.version_number desc, v.updated_at desc, v.id
  limit 1;

  if holder_count > 0 then
    refusal_code := 'ESTIMATE_DRAFT_TAKEOFF_IN_USE';
    explanation := 'Ce brouillon ne peut pas être supprimé. Des lignes issues de ses métrés figurent dans '
      || version_names
      || case when holder_count > 5 then format('… (%s versions concernées au total)', holder_count) else '' end
      || '. '
      || case when issued_variant.id is not null then
           format('Conservez ce brouillon car la variante émise « %s » en dépend.', issued_variant.name)
           when not all_drafts then 'Conservez ce brouillon pour préserver l’origine de ces lignes.'
           when holder_count = 1 then 'Supprimez d’abord cette version, ou conservez ce brouillon.'
           else 'Supprimez d’abord ces versions, ou conservez ce brouillon.' end;
  else
    if issued_variant.id is null then
      return old;
    end if;
    refusal_code := 'ESTIMATE_DRAFT_ISSUED_VARIANT';
    explanation := format('Ce brouillon ne peut pas être supprimé. La variante émise « %s » en dépend. Conservez ce brouillon.',
      issued_variant.name);
    versions := jsonb_build_array(jsonb_build_object('id', issued_variant.id, 'name', issued_variant.name));
  end if;

  raise sqlstate 'PGRST' using
    message = jsonb_build_object('code', refusal_code, 'message', explanation,
      'details', jsonb_strip_nulls(jsonb_build_object('versions', versions, 'total', holder_count))::text)::text,
    detail = '{"status":409,"headers":{}}';
end;
$$;
revoke all on function private.guard_estimate_draft_dependencies() from public, anon, authenticated, service_role;

create trigger estimate_versions_guard_draft_dependencies
before delete on public.estimate_versions
for each row when (old.status = 'draft')
execute function private.guard_estimate_draft_dependencies();

commit;
