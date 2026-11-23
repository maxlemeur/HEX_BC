begin;
set local lock_timeout = '5s';

create function private.guard_estimate_draft_dependencies()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
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

  -- BEFORE DELETE already owns the source tuple, the same one duplication locks.
  -- Read the holders after that wait, without acquiring any higher-ranked row lock.
  with holding_ids as (
    select distinct i.version_id
    from public.takeoff_jobs j
    join public.estimate_items i on i.source_job_id = j.id and i.tenant_id = j.tenant_id
    where j.estimate_version_id = old.id and j.tenant_id = old.tenant_id and j.project_id = old.project_id
      and i.version_id <> old.id
  ), named as (
    select v.id, v.version_number, v.updated_at,
      concat('V', v.version_number,
        case when v.variant_label is not null then ' · variante ' || v.variant_label end,
        case when nullif(btrim(v.title), '') is not null then ' — ' || left(btrim(v.title), 64) end) as name,
      count(*) over () as total, bool_and(v.status = 'draft') over () as all_drafts
    from holding_ids h join public.estimate_versions v on v.id = h.version_id
    where v.tenant_id = old.tenant_id and v.project_id = old.project_id
    order by v.version_number desc, v.updated_at desc, v.id
    limit 5
  )
  select max(n.total), bool_and(n.all_drafts),
    jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name) order by n.version_number desc, n.updated_at desc, n.id),
    string_agg('« ' || n.name || ' »', ', ' order by n.version_number desc, n.updated_at desc, n.id)
  into holder_count, all_drafts, versions, version_names
  from named n;

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
