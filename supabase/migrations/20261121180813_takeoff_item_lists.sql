-- Lot 4, A: the list of items (« postes ») of an affaire, stored, and the item templates an administrator publishes.
--
-- An item belongs to the affaire. Its identity is a UUID the server derives once from its origin (a DPGF raw row, a
-- template line, an addition by hand) and keeps across revisions: the registry below holds every origin key an item
-- answered to (its own, and the keys an operator accepted as a continuity), unique in its affaire. A revision of the
-- list is immutable; its entries copy what they need of their source (an import may be deleted, a mapping replaced).
--
-- What the previous application version sees while this is applied: nothing changes in its writes.
--   - Every new relation is read and written only by the new server (service role functions) or read through RLS.
--   - The one trigger on an existing table (dpgf_rows_mapped, after insert, per statement) copies the identities of the
--     inserted rows into a private lineage table; it refuses nothing and changes no column of the inserted rows.
--   - The launch requests gain a nullable column, set only by the seal of the second measuring order, behind its own
--     activation (private.takeoff_item_list_order_activation, empty): the seal of the first order is unchanged.
--   - The import confirmation of the previous version calls public.persist_estimate_creation_atomic as before and records
--     no structure decision; a later reading of the list then finds no valid proof for that confirmation (section 4).
begin;

-- Every statement takes a short lock: give up instead of queueing the import, mapping and launch writers.
set local lock_timeout = '5s';

-- 1. The takeoff operator of an affaire, for every write below: the rule of who may launch an analysis on it
--    (private.takeoff_launch_payer_eligible: an active tenant, the affaire not archived, an administrator of the tenant
--    or its engineer who owns the affaire). One rule, read here and nowhere else.
create function private.takeoff_item_list_writer(p_tenant_id uuid, p_project_id uuid, p_actor uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.takeoff_launch_payer_eligible(p_tenant_id, p_project_id, p_actor)
$$;
revoke all on function private.takeoff_item_list_writer(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- The same rule, for the server's screens (which controls to show).
create function public.takeoff_item_list_may_write(p_tenant_id uuid, p_project_id uuid, p_actor uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.takeoff_item_list_writer(p_tenant_id, p_project_id, p_actor)
$$;
revoke all on function public.takeoff_item_list_may_write(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.takeoff_item_list_may_write(uuid, uuid, uuid) to service_role;

-- An administrator of the tenant, for the templates: the role in the tenant, never a role deduced elsewhere.
create function private.takeoff_item_template_publisher(p_tenant_id uuid, p_actor uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_actor is not null and exists (
    select 1 from public.tenant_memberships m join public.tenants t on t.id = m.tenant_id and t.is_active
    where m.tenant_id = p_tenant_id and m.user_id = p_actor and m.role = 'admin'
  )
$$;
revoke all on function private.takeoff_item_template_publisher(uuid, uuid) from public, anon, authenticated, service_role;

-- The definition of one item, as a template line carries it (with its stable « id ») or as an addition gives it.
create function private.takeoff_item_definition_valid(p_line jsonb, p_with_id boolean)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_line) = 'object'
    and (p_line - array['id', 'label', 'expectedUnit', 'measurementBasis', 'qualifiers', 'synonyms']) = '{}'::jsonb
    and (not p_with_id or coalesce(p_line ->> 'id', '') ~ '^[a-z0-9][a-z0-9-]{0,63}$')
    and (p_with_id or not (p_line ? 'id'))
    and jsonb_typeof(p_line -> 'label') = 'string' and pg_catalog.char_length(p_line ->> 'label') between 1 and 300
    and p_line ->> 'label' = pg_catalog.btrim(p_line ->> 'label')
    and coalesce(jsonb_typeof(p_line -> 'expectedUnit'), 'null') in ('null', 'string')
    and (jsonb_typeof(p_line -> 'expectedUnit') is distinct from 'string'
      or pg_catalog.char_length(p_line ->> 'expectedUnit') between 1 and 16)
    and coalesce(jsonb_typeof(p_line -> 'measurementBasis'), 'null') in ('null', 'string')
    and (jsonb_typeof(p_line -> 'measurementBasis') is distinct from 'string'
      or pg_catalog.char_length(p_line ->> 'measurementBasis') between 1 and 300)
    and coalesce(jsonb_typeof(p_line -> 'qualifiers'), 'object') = 'object'
    and (coalesce(p_line -> 'qualifiers', '{}'::jsonb) - array['network', 'material', 'diameter', 'convention', 'scope'])
      = '{}'::jsonb
    and not exists (select 1 from jsonb_each(coalesce(p_line -> 'qualifiers', '{}'::jsonb)) q
      where jsonb_typeof(q.value) <> 'string' or pg_catalog.char_length(q.value #>> '{}') not between 1 and 120)
    and coalesce(jsonb_typeof(p_line -> 'synonyms'), 'array') = 'array'
    and jsonb_array_length(coalesce(p_line -> 'synonyms', '[]'::jsonb)) <= 20
    and not exists (select 1 from jsonb_array_elements(coalesce(p_line -> 'synonyms', '[]'::jsonb)) s
      where jsonb_typeof(s.value) <> 'string' or pg_catalog.char_length(s.value #>> '{}') not between 1 and 120)
$$;
revoke all on function private.takeoff_item_definition_valid(jsonb, boolean) from public, anon, authenticated, service_role;

-- A template definition: its families and their lines, bounded; every line identifier unique in the template (an item
-- instantiated from a line keeps the line's identifier from version to version). Returns its number of lines.
create function private.assert_takeoff_item_template_definition(p_definition jsonb)
returns integer language plpgsql immutable set search_path = '' as $$
declare
  family jsonb;
  line jsonb;
  family_ids text[] := '{}';
  line_ids text[] := '{}';
  lines integer := 0;
begin
  if jsonb_typeof(p_definition) is distinct from 'object' or p_definition -> 'contract' is distinct from '1'::jsonb
    or (p_definition - array['contract', 'title', 'families']) <> '{}'::jsonb
    or jsonb_typeof(p_definition -> 'title') is distinct from 'string'
    or pg_catalog.char_length(p_definition ->> 'title') not between 1 and 120
    or jsonb_typeof(p_definition -> 'families') is distinct from 'array'
    or jsonb_array_length(p_definition -> 'families') not between 1 and 50
    or pg_catalog.octet_length(p_definition::text) > 524288 then
    raise exception 'TAKEOFF_ITEM_TEMPLATE_INVALID' using errcode = '22023';
  end if;
  for family in select f.value from jsonb_array_elements(p_definition -> 'families') f loop
    if jsonb_typeof(family) is distinct from 'object' or (family - array['id', 'title', 'lines']) <> '{}'::jsonb
      or coalesce(family ->> 'id', '') !~ '^[a-z0-9][a-z0-9-]{0,63}$' or (family ->> 'id') = any (family_ids)
      or jsonb_typeof(family -> 'title') is distinct from 'string'
      or pg_catalog.char_length(family ->> 'title') not between 1 and 120
      or jsonb_typeof(family -> 'lines') is distinct from 'array' then
      raise exception 'TAKEOFF_ITEM_TEMPLATE_INVALID' using errcode = '22023';
    end if;
    family_ids := family_ids || (family ->> 'id');
    for line in select l.value from jsonb_array_elements(family -> 'lines') l loop
      if not private.takeoff_item_definition_valid(line, true) or (line ->> 'id') = any (line_ids) then
        raise exception 'TAKEOFF_ITEM_TEMPLATE_INVALID' using errcode = '22023';
      end if;
      line_ids := line_ids || (line ->> 'id');
      lines := lines + 1;
    end loop;
  end loop;
  if lines not between 1 and 1000 then
    raise exception 'TAKEOFF_ITEM_TEMPLATE_INVALID' using errcode = '22023';
  end if;
  return lines;
end;
$$;
revoke all on function private.assert_takeoff_item_template_definition(jsonb) from public, anon, authenticated, service_role;

create function private.takeoff_sha256(p_value jsonb)
returns text language sql immutable set search_path = '' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_value::text, 'UTF8')), 'hex')
$$;
revoke all on function private.takeoff_sha256(jsonb) from public, anon, authenticated, service_role;

-- Rows that are facts: never updated. A deletion happens only with their tenant or affaire (cascade).
create function private.refuse_takeoff_item_list_update()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  raise exception 'TAKEOFF_ITEM_LIST_IMMUTABLE' using errcode = '42501';
end;
$$;
revoke all on function private.refuse_takeoff_item_list_update() from public, anon, authenticated, service_role;

-- The service role keeps its table rights, as on every public table, but writes only through the functions below
-- (which run as their owner): its direct insert, update or delete is refused. A cascade runs as the owner too.
create function private.refuse_takeoff_item_list_direct_write()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if current_user = 'service_role' then
    raise exception 'TAKEOFF_ITEM_LIST_WRITER_REQUIRED' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function private.refuse_takeoff_item_list_direct_write() from public, anon, authenticated, service_role;

-- 2. The item templates. The definition shipped with the application is the reading fallback of a tenant that has
--    published none; a tenant's published versions are numbered after the version they were based on (the first one
--    after the shipped definition's). A published version is immutable. One draft per tenant and template, written
--    and read by its administrators only, compared on its revision.
create table public.takeoff_item_template_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  template_key text not null check (template_key ~ '^[a-z][a-z0-9-]{0,63}$'),
  version integer not null check (version >= 2),
  based_on_version integer not null check (based_on_version >= 1 and based_on_version < version),
  definition jsonb not null,
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  line_count integer not null check (line_count between 1 and 1000),
  intent_key uuid not null,
  published_by uuid not null,
  published_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint takeoff_item_template_versions_version_key unique (tenant_id, template_key, version),
  constraint takeoff_item_template_versions_intent_key unique (tenant_id, template_key, intent_key),
  constraint takeoff_item_template_versions_id_tenant_key unique (id, tenant_id)
);
create trigger takeoff_item_template_versions_immutable before update on public.takeoff_item_template_versions
  for each row execute function private.refuse_takeoff_item_list_update();
alter table public.takeoff_item_template_versions enable row level security;
revoke all on public.takeoff_item_template_versions from public, anon, authenticated, service_role;
-- Every member of the tenant may read what was published (the lists of its affaires are made from it).
grant select on public.takeoff_item_template_versions to authenticated;
grant select, insert, update, delete on public.takeoff_item_template_versions to service_role;
create trigger takeoff_item_template_versions_writer before insert or delete on public.takeoff_item_template_versions
  for each row execute function private.refuse_takeoff_item_list_direct_write();
create policy takeoff_item_template_versions_member_select on public.takeoff_item_template_versions for select
  to authenticated using (tenant_id = (select public.current_tenant_id()));

create table public.takeoff_item_template_drafts (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  template_key text not null check (template_key ~ '^[a-z][a-z0-9-]{0,63}$'),
  base_version integer not null check (base_version >= 1),
  definition jsonb not null,
  revision integer not null check (revision >= 1),
  updated_by uuid not null,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (tenant_id, template_key)
);
alter table public.takeoff_item_template_drafts enable row level security;
revoke all on public.takeoff_item_template_drafts from public, anon, authenticated, service_role;
-- Read by the server for its administrators; written only by the functions below.
grant select, insert, update, delete on public.takeoff_item_template_drafts to service_role;
create trigger takeoff_item_template_drafts_writer before insert or update or delete on public.takeoff_item_template_drafts
  for each row execute function private.refuse_takeoff_item_list_direct_write();

create function private.lock_takeoff_item_template(p_tenant_id uuid, p_template_key text)
returns void language sql set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'takeoff-item-template:' || p_tenant_id::text || ':' || p_template_key, 0))
$$;
revoke all on function private.lock_takeoff_item_template(uuid, text) from public, anon, authenticated, service_role;

create function private.latest_takeoff_item_template_version(p_tenant_id uuid, p_template_key text)
returns integer language sql stable security definer set search_path = '' as $$
  select max(v.version) from public.takeoff_item_template_versions v
  where v.tenant_id = p_tenant_id and v.template_key = p_template_key
$$;
revoke all on function private.latest_takeoff_item_template_version(uuid, text) from public, anon, authenticated, service_role;

-- Save the draft: the revision it replaces (0 for none), the version it is based on (the latest published, or the
-- shipped definition's when the tenant published none, which the server names). Returns the new revision.
create function public.save_takeoff_item_template_draft(p_tenant_id uuid, p_actor uuid, p_template_key text,
  p_expected_revision integer, p_base_version integer, p_definition jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  current_revision integer;
  latest integer;
begin
  perform private.lock_takeoff_item_template(p_tenant_id, p_template_key);
  if not private.takeoff_item_template_publisher(p_tenant_id, p_actor) then
    raise exception 'TAKEOFF_ITEM_TEMPLATE_FORBIDDEN' using errcode = '42501';
  end if;
  perform private.assert_takeoff_item_template_definition(p_definition);
  latest := private.latest_takeoff_item_template_version(p_tenant_id, p_template_key);
  if p_base_version is null or p_base_version < 1 or (latest is not null and p_base_version <> latest) then
    raise exception 'TAKEOFF_ITEM_TEMPLATE_STALE' using errcode = '40001';
  end if;
  select d.revision into current_revision from public.takeoff_item_template_drafts d
  where d.tenant_id = p_tenant_id and d.template_key = p_template_key for update;
  if coalesce(current_revision, 0) is distinct from p_expected_revision then
    raise exception 'TAKEOFF_ITEM_TEMPLATE_DRAFT_STALE' using errcode = '40001';
  end if;
  insert into public.takeoff_item_template_drafts as d (tenant_id, template_key, base_version, definition, revision, updated_by)
  values (p_tenant_id, p_template_key, p_base_version, p_definition, 1, p_actor)
  on conflict (tenant_id, template_key) do update set base_version = excluded.base_version,
    definition = excluded.definition, revision = d.revision + 1, updated_by = excluded.updated_by,
    updated_at = pg_catalog.clock_timestamp()
  returning d.revision into current_revision;
  return current_revision;
end;
$$;
revoke all on function public.save_takeoff_item_template_draft(uuid, uuid, text, integer, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_takeoff_item_template_draft(uuid, uuid, text, integer, integer, jsonb) to service_role;

create function public.discard_takeoff_item_template_draft(p_tenant_id uuid, p_actor uuid, p_template_key text,
  p_expected_revision integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.lock_takeoff_item_template(p_tenant_id, p_template_key);
  if not private.takeoff_item_template_publisher(p_tenant_id, p_actor) then
    raise exception 'TAKEOFF_ITEM_TEMPLATE_FORBIDDEN' using errcode = '42501';
  end if;
  delete from public.takeoff_item_template_drafts d
  where d.tenant_id = p_tenant_id and d.template_key = p_template_key and d.revision = p_expected_revision;
  if not found then
    raise exception 'TAKEOFF_ITEM_TEMPLATE_DRAFT_STALE' using errcode = '40001';
  end if;
end;
$$;
revoke all on function public.discard_takeoff_item_template_draft(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.discard_takeoff_item_template_draft(uuid, uuid, text, integer) to service_role;

-- Publish the draft the administrator saw (its revision), on the version it was based on: a new immutable version, the
-- draft removed. The same intention key returns the version it published.
create function public.publish_takeoff_item_template(p_tenant_id uuid, p_actor uuid, p_template_key text,
  p_expected_revision integer, p_intent_key uuid)
returns table (version_id uuid, version integer, replayed boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  draft public.takeoff_item_template_drafts%rowtype;
  published public.takeoff_item_template_versions%rowtype;
  latest integer;
  lines integer;
begin
  if p_intent_key is null then
    raise exception 'TAKEOFF_ITEM_TEMPLATE_INVALID' using errcode = '22023';
  end if;
  perform private.lock_takeoff_item_template(p_tenant_id, p_template_key);
  if not private.takeoff_item_template_publisher(p_tenant_id, p_actor) then
    raise exception 'TAKEOFF_ITEM_TEMPLATE_FORBIDDEN' using errcode = '42501';
  end if;
  select * into published from public.takeoff_item_template_versions v
  where v.tenant_id = p_tenant_id and v.template_key = p_template_key and v.intent_key = p_intent_key;
  if found then
    return query select published.id, published.version, true;
    return;
  end if;
  select * into draft from public.takeoff_item_template_drafts d
  where d.tenant_id = p_tenant_id and d.template_key = p_template_key for update;
  if not found or draft.revision is distinct from p_expected_revision then
    raise exception 'TAKEOFF_ITEM_TEMPLATE_DRAFT_STALE' using errcode = '40001';
  end if;
  latest := private.latest_takeoff_item_template_version(p_tenant_id, p_template_key);
  if latest is not null and draft.base_version <> latest then
    raise exception 'TAKEOFF_ITEM_TEMPLATE_STALE' using errcode = '40001';
  end if;
  lines := private.assert_takeoff_item_template_definition(draft.definition);
  insert into public.takeoff_item_template_versions (tenant_id, template_key, version, based_on_version, definition, digest,
    line_count, intent_key, published_by)
  values (p_tenant_id, p_template_key, draft.base_version + 1, draft.base_version, draft.definition,
    private.takeoff_sha256(draft.definition), lines, p_intent_key, p_actor)
  returning * into published;
  -- The version row is the trace: who published, when, on which version, its digest and size.
  delete from public.takeoff_item_template_drafts d where d.tenant_id = p_tenant_id and d.template_key = p_template_key;
  return query select published.id, published.version, false;
end;
$$;
revoke all on function public.publish_takeoff_item_template(uuid, uuid, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.publish_takeoff_item_template(uuid, uuid, text, integer, uuid) to service_role;

-- 3. The list. The registry of items (their identity in the affaire), the origin keys each answered to, the immutable
--    revisions and their entries. Readers of the affaire read all of it; only the function of section 3 writes.
create table public.takeoff_list_items (
  id uuid primary key,
  tenant_id uuid not null,
  project_id uuid not null,
  origin_kind text not null check (origin_kind in ('dpgf', 'template', 'manual')),
  created_in_revision integer not null check (created_in_revision >= 1),
  created_by uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint takeoff_list_items_scope_key unique (id, tenant_id, project_id),
  constraint takeoff_list_items_project_fkey foreign key (project_id, tenant_id)
    references public.estimate_projects (id, tenant_id) on delete cascade
);
create index takeoff_list_items_project_idx on public.takeoff_list_items (tenant_id, project_id);

-- One origin key answers to one item in its affaire (« unique pour une origine stable dans son affaire »). An item
-- keeps every key it answered to: a source retired then back finds its item again.
create table public.takeoff_list_item_sources (
  tenant_id uuid not null,
  project_id uuid not null,
  source_key text not null check (pg_catalog.char_length(source_key) between 3 and 512),
  item_id uuid not null,
  -- origin: the item was made from this source; continuity: an operator accepted this new source as the same item.
  kind text not null check (kind in ('origin', 'continuity')),
  accepted_in_revision integer not null check (accepted_in_revision >= 1),
  accepted_by uuid not null,
  accepted_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (tenant_id, project_id, source_key),
  constraint takeoff_list_item_sources_item_fkey foreign key (item_id, tenant_id, project_id)
    references public.takeoff_list_items (id, tenant_id, project_id) on delete cascade
);
create index takeoff_list_item_sources_item_idx on public.takeoff_list_item_sources (item_id);

create table public.takeoff_list_revisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  revision integer not null check (revision >= 1),
  -- initial: the first list of the affaire (from its DPGF or its template); proposal: a revision proposed after a change
  -- of the dossier or of the template, accepted by an operator; item_added: one item added by hand.
  cause text not null check (cause in ('initial', 'proposal', 'item_added')),
  -- What the revision was made from (the import, its mapping and confirmation, or the template version): identifiers only.
  sources jsonb not null check (jsonb_typeof(sources) = 'object' and pg_catalog.octet_length(sources::text) <= 16384),
  item_count integer not null check (item_count between 0 and 10000),
  -- The digest of the stored entries, computed by the database over what it stored (section 3, the write function).
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  -- The digest of what the gesture submitted: the same intention key with another submission is a conflict.
  submitted_sha256 text not null check (submitted_sha256 ~ '^[0-9a-f]{64}$'),
  intent_key uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint takeoff_list_revisions_revision_key unique (tenant_id, project_id, revision),
  constraint takeoff_list_revisions_intent_key unique (tenant_id, project_id, intent_key),
  constraint takeoff_list_revisions_scope_key unique (id, tenant_id, project_id),
  constraint takeoff_list_revisions_project_fkey foreign key (project_id, tenant_id)
    references public.estimate_projects (id, tenant_id) on delete cascade
);

create table public.takeoff_list_revision_entries (
  revision_id uuid not null,
  tenant_id uuid not null,
  project_id uuid not null,
  item_id uuid not null,
  position integer not null check (position >= 0),
  source_key text not null check (pg_catalog.char_length(source_key) between 3 and 512),
  label text not null check (pg_catalog.char_length(label) between 1 and 4000),
  expected_unit text check (pg_catalog.char_length(expected_unit) between 1 and 32),
  measurement_basis text check (pg_catalog.char_length(measurement_basis) between 1 and 300),
  qualifiers jsonb not null default '{}'::jsonb check (jsonb_typeof(qualifiers) = 'object'),
  -- The path of sections: [{id, title, order}], outermost first.
  sections jsonb not null default '[]'::jsonb check (jsonb_typeof(sections) = 'array'
    and jsonb_array_length(sections) <= 8),
  synonyms jsonb not null default '[]'::jsonb check (jsonb_typeof(synonyms) = 'array'
    and jsonb_array_length(synonyms) <= 20),
  origin_kind text not null check (origin_kind in ('dpgf', 'template', 'manual')),
  -- A copy of the source it came from (raw row, location, template line, author of an addition): never a price.
  origin jsonb not null check (jsonb_typeof(origin) = 'object' and origin ->> 'kind' = origin_kind
    and pg_catalog.octet_length(origin::text) <= 65536),
  -- The DPGF's quantity, a reference only, never a measurement; null when the source has none.
  reference_quantity numeric check (reference_quantity >= 0),
  primary key (revision_id, item_id),
  -- The entries are written before the revision row that carries their digest (section 3): this check waits for the
  -- commit, when the revision exists.
  constraint takeoff_list_revision_entries_position_key unique (revision_id, position),
  constraint takeoff_list_revision_entries_revision_fkey foreign key (revision_id, tenant_id, project_id)
    references public.takeoff_list_revisions (id, tenant_id, project_id) on delete cascade deferrable initially deferred,
  constraint takeoff_list_revision_entries_item_fkey foreign key (item_id, tenant_id, project_id)
    references public.takeoff_list_items (id, tenant_id, project_id) on delete cascade
);
create index takeoff_list_revision_entries_item_idx on public.takeoff_list_revision_entries (item_id);

create trigger takeoff_list_items_immutable before update on public.takeoff_list_items
  for each row execute function private.refuse_takeoff_item_list_update();
create trigger takeoff_list_item_sources_immutable before update on public.takeoff_list_item_sources
  for each row execute function private.refuse_takeoff_item_list_update();
create trigger takeoff_list_revisions_immutable before update on public.takeoff_list_revisions
  for each row execute function private.refuse_takeoff_item_list_update();
create trigger takeoff_list_revision_entries_immutable before update on public.takeoff_list_revision_entries
  for each row execute function private.refuse_takeoff_item_list_update();

do $$
declare
  relation text;
begin
  foreach relation in array array['takeoff_list_items', 'takeoff_list_item_sources', 'takeoff_list_revisions',
    'takeoff_list_revision_entries'] loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', relation);
    execute format('grant select on public.%I to authenticated', relation);
    -- The server reads; only the function of this section writes (as the owner).
    execute format('grant select, insert, update, delete on public.%I to service_role', relation);
    execute format('create trigger %I before insert or delete on public.%I for each row execute function '
      || 'private.refuse_takeoff_item_list_direct_write()', relation || '_writer', relation);
    -- The readers of the affaire, in the tenant the member works in now (the rule of the affaire's takeoff jobs).
    execute format('create policy %I on public.%I for select to authenticated using '
      || '((select private.can_access_takeoff_scope(tenant_id, project_id, null, false)))', relation || '_reader_select',
      relation);
  end loop;
end;
$$;

create function private.lock_takeoff_item_list(p_project_id uuid)
returns void language sql set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-item-list:' || p_project_id::text, 0))
$$;
revoke all on function private.lock_takeoff_item_list(uuid) from public, anon, authenticated, service_role;

-- The digest of a stored revision: its scope and its entries in order, as the database stores them.
create function private.takeoff_list_revision_content_sha256(p_revision_id uuid, p_tenant_id uuid, p_project_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select private.takeoff_sha256(jsonb_build_object('contract', 1, 'tenant_id', p_tenant_id, 'project_id', p_project_id,
    'entries', coalesce((select jsonb_agg(jsonb_build_array(e.item_id, e.source_key, e.label, e.expected_unit,
      e.measurement_basis, e.qualifiers, e.sections, e.synonyms, e.origin, e.reference_quantity) order by e.position)
      from public.takeoff_list_revision_entries e where e.revision_id = p_revision_id), '[]'::jsonb)))
$$;
revoke all on function private.takeoff_list_revision_content_sha256(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- Record a revision of an affaire's list, made by the server from the affaire's sources and its previous revision:
--   p_expected_revision  the latest revision the server read (0 when the affaire has none): a later one refuses;
--   p_intent_key         the identity of the gesture: the same key with the same submission returns the revision it
--                        recorded; another submission under the same key is a conflict;
--   p_entries            the entries in order: {item_id, source_key, label, expected_unit, measurement_basis,
--                        qualifiers, sections, synonyms, origin, reference_quantity};
--   p_continuities       the origin keys an operator accepted as the same item as an existing one: {source_key, item_id}.
-- The identity rule, enforced here: an origin key already known in the affaire keeps its item; a new key makes a new
-- item unless it is an accepted continuity of an item the affaire already has; an item is never another affaire's.
create function public.record_takeoff_list_revision(p_tenant_id uuid, p_project_id uuid, p_actor uuid,
  p_expected_revision integer, p_intent_key uuid, p_cause text, p_sources jsonb, p_entries jsonb,
  p_continuities jsonb default '[]'::jsonb)
returns table (revision_id uuid, revision integer, content_sha256 text, replayed boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  continuities jsonb := coalesce(p_continuities, '[]'::jsonb);
  existing public.takeoff_list_revisions%rowtype;
  latest integer;
  next_revision integer;
  created uuid := gen_random_uuid();
  submitted text;
  digest text;
  violation text;
begin
  if p_intent_key is null or p_cause is null or p_cause not in ('initial', 'proposal', 'item_added')
    or p_expected_revision is null or p_expected_revision < 0 or jsonb_typeof(p_entries) is distinct from 'array'
    or jsonb_array_length(p_entries) > 10000 or pg_catalog.octet_length(p_entries::text) > 16777216
    or jsonb_typeof(continuities) <> 'array' or jsonb_array_length(continuities) > 10000
    or jsonb_typeof(p_sources) is distinct from 'object'
    or (p_cause = 'initial') <> (p_expected_revision = 0) then
    raise exception 'TAKEOFF_ITEM_LIST_INVALID' using errcode = '22023';
  end if;
  -- Writers of one affaire's list wait for each other here; the right is read after the wait.
  perform private.lock_takeoff_item_list(p_project_id);
  if not private.takeoff_item_list_writer(p_tenant_id, p_project_id, p_actor) then
    raise exception 'TAKEOFF_ITEM_LIST_FORBIDDEN' using errcode = '42501';
  end if;
  submitted := private.takeoff_sha256(jsonb_build_object('entries', p_entries, 'continuities', continuities,
    'cause', p_cause, 'sources', p_sources, 'expected_revision', p_expected_revision));
  select * into existing from public.takeoff_list_revisions r
  where r.tenant_id = p_tenant_id and r.project_id = p_project_id and r.intent_key = p_intent_key;
  if found then
    if existing.submitted_sha256 is distinct from submitted then
      raise exception 'TAKEOFF_ITEM_LIST_INTENT_CONFLICT' using errcode = '23505';
    end if;
    return query select existing.id, existing.revision, existing.content_sha256, true;
    return;
  end if;
  select max(r.revision) into latest from public.takeoff_list_revisions r
  where r.tenant_id = p_tenant_id and r.project_id = p_project_id;
  if coalesce(latest, 0) <> p_expected_revision then
    raise exception 'TAKEOFF_ITEM_LIST_STALE' using errcode = '40001';
  end if;
  next_revision := coalesce(latest, 0) + 1;

  -- Every entry is well formed and names one item and one origin key, each once. Lengths are the table's checks.
  if exists (
    select 1 from jsonb_array_elements(p_entries) e(value)
    where jsonb_typeof(e.value) <> 'object'
      or (e.value - array['item_id', 'source_key', 'label', 'expected_unit', 'measurement_basis', 'qualifiers', 'sections',
        'synonyms', 'origin', 'reference_quantity']) <> '{}'::jsonb
      or coalesce(e.value ->> 'item_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(e.value -> 'source_key') is distinct from 'string'
      or jsonb_typeof(e.value -> 'label') is distinct from 'string'
      or coalesce(jsonb_typeof(e.value -> 'expected_unit'), 'null') not in ('null', 'string')
      or coalesce(jsonb_typeof(e.value -> 'measurement_basis'), 'null') not in ('null', 'string')
      or coalesce(jsonb_typeof(e.value -> 'qualifiers'), 'object') <> 'object'
      or (coalesce(e.value -> 'qualifiers', '{}'::jsonb) - array['network', 'material', 'diameter', 'convention', 'scope'])
        <> '{}'::jsonb
      or exists (select 1 from jsonb_each(coalesce(e.value -> 'qualifiers', '{}'::jsonb)) q
        where jsonb_typeof(q.value) <> 'string' or pg_catalog.char_length(q.value #>> '{}') not between 1 and 120)
      or coalesce(jsonb_typeof(e.value -> 'synonyms'), 'array') <> 'array'
      or exists (select 1 from jsonb_array_elements(coalesce(e.value -> 'synonyms', '[]'::jsonb)) y
        where jsonb_typeof(y.value) <> 'string' or pg_catalog.char_length(y.value #>> '{}') not between 1 and 120)
      or coalesce(jsonb_typeof(e.value -> 'sections'), 'array') <> 'array'
      or exists (select 1 from jsonb_array_elements(coalesce(e.value -> 'sections', '[]'::jsonb)) t
        where jsonb_typeof(t.value) <> 'object' or (t.value - array['id', 'title', 'order']) <> '{}'::jsonb
          or jsonb_typeof(t.value -> 'id') <> 'string' or jsonb_typeof(t.value -> 'title') <> 'string'
          or jsonb_typeof(t.value -> 'order') <> 'number')
      or jsonb_typeof(e.value -> 'origin') is distinct from 'object'
      or (e.value #>> '{origin,kind}') is null or (e.value #>> '{origin,kind}') not in ('dpgf', 'template', 'manual')
      or coalesce(jsonb_typeof(e.value -> 'reference_quantity'), 'null') not in ('null', 'number')
  ) or (select count(distinct e.value ->> 'item_id') from jsonb_array_elements(p_entries) e(value))
      <> jsonb_array_length(p_entries)
    or (select count(distinct e.value ->> 'source_key') from jsonb_array_elements(p_entries) e(value))
      <> jsonb_array_length(p_entries) then
    raise exception 'TAKEOFF_ITEM_LIST_INVALID' using errcode = '22023';
  end if;
  -- An addition by hand names the member recorded as its author and the revision that adds it.
  if exists (
    select 1 from jsonb_array_elements(p_entries) e(value)
    where e.value #>> '{origin,kind}' = 'manual'
      and not exists (select 1 from public.takeoff_list_items i where i.id = (e.value ->> 'item_id')::uuid)
      and (e.value #>> '{origin,addedBy}' is distinct from p_actor::text
        or e.value #> '{origin,addedInRevision}' is distinct from pg_catalog.to_jsonb(next_revision))
  ) then
    raise exception 'TAKEOFF_ITEM_LIST_INVALID' using errcode = '22023';
  end if;
  -- The identity rule. A known key keeps its item; an item already in the affaire takes a new key only as an accepted
  -- continuity; an item of another affaire is refused (its identifier is taken).
  if exists (
    select 1 from jsonb_array_elements(p_entries) e(value)
    join public.takeoff_list_item_sources s on s.tenant_id = p_tenant_id and s.project_id = p_project_id
      and s.source_key = e.value ->> 'source_key'
    where s.item_id <> (e.value ->> 'item_id')::uuid
  ) or exists (
    select 1 from jsonb_array_elements(p_entries) e(value)
    join public.takeoff_list_items i on i.id = (e.value ->> 'item_id')::uuid
    where (i.tenant_id, i.project_id) is distinct from (p_tenant_id, p_project_id)
      or (not exists (select 1 from public.takeoff_list_item_sources s where s.tenant_id = p_tenant_id
          and s.project_id = p_project_id and s.source_key = e.value ->> 'source_key')
        and not exists (select 1 from jsonb_array_elements(continuities) c(value)
          where c.value ->> 'source_key' = e.value ->> 'source_key' and c.value ->> 'item_id' = e.value ->> 'item_id'))
  ) or exists (
    -- A continuity names an entry of this revision and an item the affaire already has, under a key it never had.
    select 1 from jsonb_array_elements(continuities) c(value)
    where jsonb_typeof(c.value) <> 'object' or (c.value - array['source_key', 'item_id']) <> '{}'::jsonb
      or not exists (select 1 from jsonb_array_elements(p_entries) e(value)
        where e.value ->> 'source_key' = c.value ->> 'source_key' and e.value ->> 'item_id' = c.value ->> 'item_id')
      or not exists (select 1 from public.takeoff_list_items i where i.id::text = c.value ->> 'item_id'
        and i.tenant_id = p_tenant_id and i.project_id = p_project_id)
      or exists (select 1 from public.takeoff_list_item_sources s where s.tenant_id = p_tenant_id
        and s.project_id = p_project_id and s.source_key = c.value ->> 'source_key')
  ) then
    raise exception 'TAKEOFF_ITEM_LIST_IDENTITY_CONFLICT' using errcode = '23505';
  end if;

  begin
    insert into public.takeoff_list_items (id, tenant_id, project_id, origin_kind, created_in_revision, created_by)
    select (e.value ->> 'item_id')::uuid, p_tenant_id, p_project_id, e.value #>> '{origin,kind}', next_revision, p_actor
    from jsonb_array_elements(p_entries) e(value)
    where not exists (select 1 from public.takeoff_list_items i where i.id = (e.value ->> 'item_id')::uuid);
  exception when unique_violation then
    -- Another affaire's item took this identifier between the check and the insert.
    get stacked diagnostics violation = constraint_name;
    raise exception 'TAKEOFF_ITEM_LIST_IDENTITY_CONFLICT' using errcode = '23505', detail = violation;
  end;
  insert into public.takeoff_list_item_sources (tenant_id, project_id, source_key, item_id, kind, accepted_in_revision,
    accepted_by)
  select p_tenant_id, p_project_id, e.value ->> 'source_key', (e.value ->> 'item_id')::uuid,
    case when exists (select 1 from jsonb_array_elements(continuities) c(value)
      where c.value ->> 'source_key' = e.value ->> 'source_key') then 'continuity' else 'origin' end,
    next_revision, p_actor
  from jsonb_array_elements(p_entries) e(value)
  where not exists (select 1 from public.takeoff_list_item_sources s where s.tenant_id = p_tenant_id
    and s.project_id = p_project_id and s.source_key = e.value ->> 'source_key');
  insert into public.takeoff_list_revision_entries (revision_id, tenant_id, project_id, item_id, position, source_key, label,
    expected_unit, measurement_basis, qualifiers, sections, synonyms, origin_kind, origin, reference_quantity)
  select created, p_tenant_id, p_project_id, (e.value ->> 'item_id')::uuid, (e.ordinality - 1)::integer,
    e.value ->> 'source_key', e.value ->> 'label', e.value ->> 'expected_unit', e.value ->> 'measurement_basis',
    coalesce(e.value -> 'qualifiers', '{}'::jsonb), coalesce(e.value -> 'sections', '[]'::jsonb),
    coalesce(e.value -> 'synonyms', '[]'::jsonb), e.value #>> '{origin,kind}', e.value -> 'origin',
    (e.value ->> 'reference_quantity')::numeric
  from jsonb_array_elements(p_entries) with ordinality e(value, ordinality);
  -- The certified digest: computed over the rows just stored, then the revision row that carries it.
  digest := private.takeoff_list_revision_content_sha256(created, p_tenant_id, p_project_id);
  insert into public.takeoff_list_revisions (id, tenant_id, project_id, revision, cause, sources, item_count,
    content_sha256, submitted_sha256, intent_key, created_by)
  values (created, p_tenant_id, p_project_id, next_revision, p_cause, p_sources, jsonb_array_length(p_entries), digest,
    submitted, p_intent_key, p_actor);
  return query select created, next_revision, digest, false;
end;
$$;
revoke all on function public.record_takeoff_list_revision(uuid, uuid, uuid, integer, uuid, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_takeoff_list_revision(uuid, uuid, uuid, integer, uuid, text, jsonb, jsonb, jsonb)
  to service_role;

-- 4. The structure decisions taken when an import is confirmed (a row made a section and its level, a row kept as a
--    line, a row ignored), stored as a fact of their own, never in the payload of a mapped row (the catalogue linking
--    rewrites that payload whole). The proof covers the decisions, the order of the rows and their measured fields
--    (designation, reference, code, unit, quantity, notes, the row's source structure) and the column mapping: a
--    confirmation of the previous version recreates the mapped rows (new identities), so the proof of an earlier
--    confirmation no longer matches what the import holds and its decisions are not applied.
create table public.dpgf_import_confirmations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  import_id uuid not null,
  mapping_id uuid not null references public.dpgf_mappings (id) on delete cascade,
  project_id uuid,
  -- The version the confirmation created, when it created one (in the same transaction).
  estimate_version_id uuid references public.estimate_versions (id) on delete set null,
  decisions jsonb not null check (jsonb_typeof(decisions) = 'array' and jsonb_array_length(decisions) <= 10000),
  row_count integer not null check (row_count >= 0),
  proof_sha256 text not null check (proof_sha256 ~ '^[0-9a-f]{64}$'),
  confirmed_by uuid not null,
  confirmed_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint dpgf_import_confirmations_import_fkey foreign key (import_id, tenant_id)
    references public.dpgf_imports (id, tenant_id) on delete cascade
);
create index dpgf_import_confirmations_import_idx on public.dpgf_import_confirmations (tenant_id, import_id,
  confirmed_at desc, id desc);
-- A fact, except that the deletion of the version it created clears that reference (the foreign key's action).
create function private.guard_dpgf_import_confirmation_update()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if new.estimate_version_id is null and old.estimate_version_id is not null
    and (pg_catalog.to_jsonb(new) - 'estimate_version_id') = (pg_catalog.to_jsonb(old) - 'estimate_version_id') then
    return new;
  end if;
  raise exception 'TAKEOFF_ITEM_LIST_IMMUTABLE' using errcode = '42501';
end;
$$;
revoke all on function private.guard_dpgf_import_confirmation_update() from public, anon, authenticated, service_role;
create trigger dpgf_import_confirmations_immutable before update on public.dpgf_import_confirmations
  for each row execute function private.guard_dpgf_import_confirmation_update();
alter table public.dpgf_import_confirmations enable row level security;
revoke all on public.dpgf_import_confirmations from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.dpgf_import_confirmations to service_role;
create trigger dpgf_import_confirmations_writer before insert or delete on public.dpgf_import_confirmations
  for each row execute function private.refuse_takeoff_item_list_direct_write();

-- The proof of what an import holds now under a mapping, with these decisions.
create function private.dpgf_import_confirmation_proof(p_tenant_id uuid, p_import_id uuid, p_mapping_id uuid,
  p_decisions jsonb)
returns table (proof_sha256 text, row_count integer)
language sql stable security definer set search_path = '' as $$
  with mapped as (
    select m.id, m.raw_row_id, r.row_index, jsonb_build_array(
        coalesce(m.payload #> '{mapped_row,designation}', m.payload -> 'designation'),
        coalesce(m.payload #> '{mapped_row,reference}', m.payload -> 'reference'),
        coalesce(m.payload #> '{mapped_row,hex_code}', m.payload -> 'hex_code'),
        coalesce(m.payload #> '{mapped_row,unit}', m.payload -> 'unit'),
        coalesce(m.payload #> '{mapped_row,quantity}', m.payload -> 'quantity'),
        coalesce(m.payload #> '{mapped_row,notes}', m.payload -> 'notes'),
        r.payload -> '_timax_structure') as facts
    from public.dpgf_rows_mapped m
    join public.dpgf_rows_raw r on r.id = m.raw_row_id and r.import_id = m.import_id
    where m.tenant_id = p_tenant_id and m.import_id = p_import_id and m.status = 'mapped'
  )
  select private.takeoff_sha256(jsonb_build_object('contract', 1, 'import_id', p_import_id, 'mapping_id', p_mapping_id,
      'column_mapping', (select g.column_mapping from public.dpgf_mappings g where g.id = p_mapping_id),
      'decisions', coalesce((select jsonb_agg(d.value order by (d.value ->> 'rowIndex')::integer)
        from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb)) d(value)), '[]'::jsonb),
      'rows', coalesce((select jsonb_agg(jsonb_build_array(x.id, x.raw_row_id, x.row_index, x.facts)
        order by x.row_index, x.id) from mapped x), '[]'::jsonb))),
    (select count(*)::integer from mapped)
$$;
revoke all on function private.dpgf_import_confirmation_proof(uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;

-- The latest mapping of an import: the one its rows were made from.
create function private.latest_dpgf_mapping_id(p_tenant_id uuid, p_import_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select g.id from public.dpgf_mappings g where g.tenant_id = p_tenant_id and g.import_id = p_import_id
  order by g.created_at desc, g.id desc limit 1
$$;
revoke all on function private.latest_dpgf_mapping_id(uuid, uuid) from public, anon, authenticated, service_role;

-- Record a confirmation of an import: its decisions, bound to the latest mapping and to what the import holds now. The
-- caller's transaction is the confirmation's: the estimate's creation (public.persist_dpgf_import_estimate_atomic), or
-- the mapping alone (the server, right after the mapping it created).
create function public.record_dpgf_import_confirmation(p_tenant_id uuid, p_actor uuid, p_import_id uuid, p_mapping_id uuid,
  p_project_id uuid, p_estimate_version_id uuid, p_decisions jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  proof record;
  created uuid;
begin
  if p_actor is null or jsonb_typeof(p_decisions) is distinct from 'array' or jsonb_array_length(p_decisions) > 10000
    or exists (
      select 1 from jsonb_array_elements(p_decisions) d(value)
      where jsonb_typeof(d.value) <> 'object' or (d.value - array['rowIndex', 'kind', 'level']) <> '{}'::jsonb
        or jsonb_typeof(d.value -> 'rowIndex') <> 'number' or (d.value ->> 'rowIndex') !~ '^[0-9]{1,9}$'
        or not ((d.value ->> 'kind' = 'section' and d.value -> 'level' in ('1'::jsonb, '2'::jsonb))
          or (d.value ->> 'kind' in ('line', 'ignore') and d.value -> 'level' = 'null'::jsonb))
    ) or (select count(distinct d.value ->> 'rowIndex') from jsonb_array_elements(p_decisions) d(value))
      <> jsonb_array_length(p_decisions) then
    raise exception 'DPGF_IMPORT_CONFIRMATION_INVALID' using errcode = '22023';
  end if;
  if not exists (select 1 from public.dpgf_imports i where i.id = p_import_id and i.tenant_id = p_tenant_id
      and (p_project_id is null or i.project_id is not distinct from p_project_id))
    or private.latest_dpgf_mapping_id(p_tenant_id, p_import_id) is distinct from p_mapping_id
    or not exists (select 1 from public.tenant_memberships m where m.tenant_id = p_tenant_id and m.user_id = p_actor) then
    raise exception 'DPGF_IMPORT_CONFIRMATION_STALE' using errcode = '40001';
  end if;
  select * into proof from private.dpgf_import_confirmation_proof(p_tenant_id, p_import_id, p_mapping_id, p_decisions);
  insert into public.dpgf_import_confirmations (tenant_id, import_id, mapping_id, project_id, estimate_version_id, decisions,
    row_count, proof_sha256, confirmed_by)
  values (p_tenant_id, p_import_id, p_mapping_id, p_project_id, p_estimate_version_id, p_decisions, proof.row_count,
    proof.proof_sha256, p_actor)
  returning id into created;
  return created;
end;
$$;
revoke all on function public.record_dpgf_import_confirmation(uuid, uuid, uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_dpgf_import_confirmation(uuid, uuid, uuid, uuid, uuid, uuid, jsonb) to service_role;

-- The estimate created from an import and the confirmation's decisions, in one transaction: the existing creation,
-- unchanged, then the record. The previous application version keeps calling the creation alone.
create function public.persist_dpgf_import_estimate_atomic(p_tenant_id uuid, p_actor_user_id uuid, p_project_id uuid,
  p_project_payload jsonb, p_version_payload jsonb, p_items jsonb, p_import_id uuid, p_mapping_id uuid, p_decisions jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  created jsonb;
begin
  if p_import_id is null or p_mapping_id is null then
    raise exception 'DPGF_IMPORT_CONFIRMATION_INVALID' using errcode = '22023';
  end if;
  created := public.persist_estimate_creation_atomic(p_tenant_id, p_actor_user_id, p_project_id, p_project_payload,
    p_version_payload, p_items, p_import_id);
  perform public.record_dpgf_import_confirmation(p_tenant_id, p_actor_user_id, p_import_id, p_mapping_id,
    (created #>> '{project,id}')::uuid, (created #>> '{version,id}')::uuid, p_decisions);
  return created;
end;
$$;
revoke all on function public.persist_dpgf_import_estimate_atomic(uuid, uuid, uuid, jsonb, jsonb, jsonb, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.persist_dpgf_import_estimate_atomic(uuid, uuid, uuid, jsonb, jsonb, jsonb, uuid, uuid, jsonb)
  to service_role;

-- The latest confirmation of an import, and whether its proof still matches what the import holds under its latest
-- mapping. No row: the import was never confirmed by this version.
create function public.read_dpgf_import_confirmation(p_tenant_id uuid, p_import_id uuid)
returns table (confirmation_id uuid, mapping_id uuid, estimate_version_id uuid, decisions jsonb, row_count integer,
  confirmed_at timestamptz, proof_current boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.mapping_id, c.estimate_version_id, c.decisions, c.row_count, c.confirmed_at,
    c.mapping_id = private.latest_dpgf_mapping_id(c.tenant_id, c.import_id)
      and c.proof_sha256 = (select p.proof_sha256
        from private.dpgf_import_confirmation_proof(c.tenant_id, c.import_id, c.mapping_id, c.decisions) p)
  from public.dpgf_import_confirmations c
  where c.tenant_id = p_tenant_id and c.import_id = p_import_id
  order by c.confirmed_at desc, c.id desc limit 1
$$;
revoke all on function public.read_dpgf_import_confirmation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.read_dpgf_import_confirmation(uuid, uuid) to service_role;

-- 5. The link of an estimate line to its raw DPGF row. A line made from an import carries its import and its mapped
--    row in its source metadata (unchanged); a remapping deletes the mapped rows. The database records, when a mapped
--    row is inserted, which raw row of which import it was made from: the join line → mapped row → raw row stays proven
--    after a remapping, for the line and for its copies, without a byte more in the line's metadata.
create table private.dpgf_mapped_row_lineage (
  mapped_row_id uuid primary key,
  tenant_id uuid not null,
  import_id uuid not null references public.dpgf_imports (id) on delete cascade,
  raw_row_id uuid not null,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp()
);
create index dpgf_mapped_row_lineage_raw_idx on private.dpgf_mapped_row_lineage (import_id, raw_row_id);
revoke all on private.dpgf_mapped_row_lineage from public, anon, authenticated, service_role;

create function private.record_dpgf_mapped_row_lineage()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.dpgf_mapped_row_lineage (mapped_row_id, tenant_id, import_id, raw_row_id)
  select n.id, n.tenant_id, n.import_id, n.raw_row_id from inserted_rows n where n.raw_row_id is not null
  on conflict (mapped_row_id) do nothing;
  return null;
end;
$$;
revoke all on function private.record_dpgf_mapped_row_lineage() from public, anon, authenticated, service_role;
-- Created before the copy of the existing rows: from here until the commit, no mapped row is inserted unseen.
create trigger zz_record_dpgf_mapped_row_lineage after insert on public.dpgf_rows_mapped
  referencing new table as inserted_rows for each statement execute function private.record_dpgf_mapped_row_lineage();

-- The rows that exist now. A mapped row without its raw row is not copied (no proof); the count is checked.
insert into private.dpgf_mapped_row_lineage (mapped_row_id, tenant_id, import_id, raw_row_id)
select m.id, m.tenant_id, m.import_id, m.raw_row_id from public.dpgf_rows_mapped m where m.raw_row_id is not null
on conflict (mapped_row_id) do nothing;
do $$
declare
  missing bigint;
begin
  select count(*) into missing from public.dpgf_rows_mapped m
  where m.raw_row_id is not null
    and not exists (select 1 from private.dpgf_mapped_row_lineage l where l.mapped_row_id = m.id);
  if missing <> 0 then
    raise exception 'DPGF_MAPPED_ROW_LINEAGE_INCOMPLETE: % mapped rows without lineage', missing;
  end if;
end;
$$;

-- The raw DPGF rows of an estimate version's lines, by the proven join (service role, for the sending of lot 4).
create function public.read_estimate_dpgf_raw_rows(p_tenant_id uuid, p_version_id uuid)
returns table (estimate_item_id uuid, import_id uuid, mapped_row_id uuid, raw_row_id uuid)
language sql stable security definer set search_path = '' as $$
  select i.id, l.import_id, l.mapped_row_id, l.raw_row_id
  from public.estimate_items i
  join private.dpgf_mapped_row_lineage l
    on l.mapped_row_id::text = i.source_metadata ->> 'mapped_row_id'
    and l.import_id::text = i.source_metadata ->> 'import_id' and l.tenant_id = i.tenant_id
  where i.tenant_id = p_tenant_id and i.version_id = p_version_id and i.source_metadata ? 'mapped_row_id'
$$;
revoke all on function public.read_estimate_dpgf_raw_rows(uuid, uuid) from public, anon, authenticated;
grant execute on function public.read_estimate_dpgf_raw_rows(uuid, uuid) to service_role;

-- 6. The sealed list in a launch request: the second measuring order (« item_list », version 2), behind its own
--    activation, empty until the owner sets it once the reader of the second order is deployed (lot 4, PR 3). Before
--    it, a manifest naming that order is refused at the seal, as it was before this migration.
create table private.takeoff_item_list_order_activation (
  singleton boolean primary key default true check (singleton),
  active_from timestamptz not null
);
revoke all on private.takeoff_item_list_order_activation from public, anon, authenticated, service_role;

create function private.takeoff_item_list_order_active(p_at timestamptz default pg_catalog.clock_timestamp())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.takeoff_item_list_order_activation a where a.active_from <= p_at)
$$;
revoke all on function private.takeoff_item_list_order_active(timestamptz) from public, anon, authenticated, service_role;

create function public.takeoff_item_list_order_is_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.takeoff_item_list_order_active()
$$;
revoke all on function public.takeoff_item_list_order_is_active() from public, anon, authenticated;
grant execute on function public.takeoff_item_list_order_is_active() to service_role;

-- The revision a request sealed: one of its affaire's, immutable; a request names at most one.
alter table public.takeoff_launch_requests
  add column item_list_revision_id uuid,
  add constraint takeoff_launch_requests_item_list_fkey foreign key (item_list_revision_id, tenant_id, project_id)
    references public.takeoff_list_revisions (id, tenant_id, project_id),
  add constraint takeoff_launch_requests_item_list_check check (item_list_revision_id is null or admitted_at is not null);
grant select (item_list_revision_id) on public.takeoff_launch_requests to authenticated;

-- The measuring order of a manifest, checked at its seal: the free extraction (version 1, no list), or, once activated,
-- a sealed list of the request's own affaire, named by its revision, its number, its stored digest and its size.
-- Returns the revision sealed, or null. Lot 3 checks the units of the manifest beside it (private.assert_takeoff_launch_seal).
create function private.assert_takeoff_launch_order(p_request public.takeoff_launch_requests, p_manifest jsonb)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  sealed public.takeoff_list_revisions%rowtype;
  list jsonb := p_manifest #> '{order,list}';
begin
  if p_manifest #>> '{order,kind}' = 'free_extraction' and p_manifest #> '{order,version}' = '1'::jsonb
    and coalesce(list, 'null'::jsonb) = 'null'::jsonb then
    return null;
  end if;
  if p_manifest #>> '{order,kind}' is distinct from 'item_list' or p_manifest #> '{order,version}' is distinct from '2'::jsonb
    or not private.takeoff_item_list_order_active() or jsonb_typeof(list) is distinct from 'object'
    or (list - array['revision_id', 'revision', 'content_sha256', 'item_count']) <> '{}'::jsonb
    or coalesce(list ->> 'revision_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'TAKEOFF_LAUNCH_SEAL_INVALID' using errcode = '22023';
  end if;
  select * into sealed from public.takeoff_list_revisions r
  where r.id = (list ->> 'revision_id')::uuid and r.tenant_id = p_request.tenant_id and r.project_id = p_request.project_id;
  if not found or list -> 'revision' is distinct from pg_catalog.to_jsonb(sealed.revision)
    or list ->> 'content_sha256' is distinct from sealed.content_sha256
    or list -> 'item_count' is distinct from pg_catalog.to_jsonb(sealed.item_count) then
    raise exception 'TAKEOFF_LAUNCH_SEAL_INVALID' using errcode = '22023';
  end if;
  return sealed.id;
end;
$$;
revoke all on function private.assert_takeoff_launch_order(public.takeoff_launch_requests, jsonb)
  from public, anon, authenticated, service_role;

-- M4's check of a seal (20261121170448), with its order delegated to the function above; every other condition unchanged.
create or replace function private.assert_takeoff_launch_seal(p_request public.takeoff_launch_requests, p_manifest jsonb, p_snapshot jsonb)
returns void language plpgsql stable set search_path = '' as $$
begin
  if jsonb_typeof(p_manifest) is distinct from 'object' or p_manifest -> 'format_version' is distinct from '1'::jsonb
    or jsonb_typeof(p_manifest -> 'units') is distinct from 'array' or jsonb_array_length(p_manifest -> 'units') <> 1
    or p_manifest #>> '{units,0,key}' is distinct from 'grouped'
    or jsonb_typeof(p_manifest -> 'plans') is distinct from 'array' or jsonb_array_length(p_manifest -> 'plans') = 0
    or jsonb_typeof(p_manifest #> '{budget,tokens}') is distinct from 'number' or (p_manifest #>> '{budget,tokens}')::numeric < 1
    or jsonb_typeof(p_manifest #> '{budget,cost_cents}') is distinct from 'number' or (p_manifest #>> '{budget,cost_cents}')::numeric < 0
    or jsonb_typeof(p_snapshot) is distinct from 'object' or p_snapshot -> 'schema_version' is distinct from '1'::jsonb
    or p_snapshot ->> 'confirmed_by' is distinct from p_request.payer_id::text
    or p_snapshot -> 'execution_selection' is distinct from p_request.mandate_selection
    or p_snapshot #> '{readiness,can_launch}' is distinct from 'true'::jsonb
    or p_snapshot #>> '{preparation,processing,level}' is distinct from 'C'
    or p_snapshot #>> '{preparation,processing,provider}' is distinct from 'chatgpt'
    or p_snapshot #>> '{preparation,destination,kind}' is distinct from 'analysis_only' then
    raise exception 'TAKEOFF_LAUNCH_SEAL_INVALID' using errcode = '22023';
  end if;
  perform private.assert_takeoff_launch_order(p_request, p_manifest);
end;
$$;
revoke all on function private.assert_takeoff_launch_seal(public.takeoff_launch_requests, jsonb, jsonb) from public, anon, authenticated, service_role;

-- M4's seal, which also records the list it sealed (null for the free extraction).
create or replace function private.seal_takeoff_launch_request(p_request public.takeoff_launch_requests, p_manifest jsonb, p_snapshot jsonb,
  p_mark bigint)
returns public.takeoff_launch_requests language plpgsql security definer set search_path = '' as $$
declare
  request public.takeoff_launch_requests%rowtype;
begin
  perform private.assert_takeoff_launch_seal(p_request, p_manifest, p_snapshot);
  update public.takeoff_launch_requests r set state = 'admitted', reason_code = null, reason_details = '{}'::jsonb,
    manifest = p_manifest, manifest_digest = encode(pg_catalog.sha256(convert_to(p_manifest::text, 'UTF8')), 'hex'),
    preparation_snapshot = p_snapshot, units_expected = jsonb_array_length(p_manifest -> 'units'),
    token_budget = (p_manifest #>> '{budget,tokens}')::bigint, cost_budget_cents = (p_manifest #>> '{budget,cost_cents}')::bigint,
    evaluated_mark = p_mark, evaluated_at = pg_catalog.clock_timestamp(), admitted_at = pg_catalog.clock_timestamp(),
    evaluation_lease_token = null, evaluation_lease_expires_at = null, evaluation_failures = 0,
    item_list_revision_id = private.assert_takeoff_launch_order(p_request, p_manifest)
  where r.id = p_request.id
  returning * into request;
  return request;
end;
$$;
revoke all on function private.seal_takeoff_launch_request(public.takeoff_launch_requests, jsonb, jsonb, bigint)
  from public, anon, authenticated, service_role;

-- The list cannot be sealed yet (a DPGF to prepare or to choose): the Mac of the mandate tries again on its own, every
-- two minutes, as for its other passing causes (M4's claim). Only reachable once the second order is activated.
create or replace function private.takeoff_launch_transient_reasons() returns text[] language sql immutable set search_path = '' as $$
  select array['ADMISSION_LIMIT', 'SOURCE_UNREADABLE', 'ANOTHER_ANALYSIS_RUNNING', 'TAKEOFF_DISABLED', 'ITEM_LIST_TO_PREPARE']
$$;
revoke all on function private.takeoff_launch_transient_reasons() from public, anon, authenticated;

commit;
