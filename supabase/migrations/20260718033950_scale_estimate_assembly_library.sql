-- Scalable estimate assembly library: server search, comparable costs,
-- deterministic near-duplicate signals, favorites and recent usage.

create or replace function public.estimate_assembly_dedupe_key(value text)
returns text
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $$
  select regexp_replace(
    regexp_replace(
      public.catalogue_normalize_search(coalesce(value, '')),
      '\m(copie|copy|variante|version)\M',
      '',
      'g'
    ),
    '[^a-z0-9]+',
    '',
    'g'
  );
$$;

revoke execute on function public.estimate_assembly_dedupe_key(text)
  from public, anon;
grant execute on function public.estimate_assembly_dedupe_key(text)
  to authenticated;

create index if not exists estimate_assemblies_tenant_search_trgm_idx
  on public.estimate_assemblies using gin (
    public.catalogue_normalize_search(
      coalesce(name, '') || ' ' ||
      coalesce(reference_code, '') || ' ' ||
      coalesce(description, '') || ' ' ||
      coalesce(unit, '')
    ) extensions.gin_trgm_ops
  );

create index if not exists estimate_assemblies_tenant_dedupe_key_idx
  on public.estimate_assemblies (
    tenant_id,
    public.estimate_assembly_dedupe_key(coalesce(reference_code, name)),
    id
  );

create index if not exists estimate_assemblies_tenant_updated_id_idx
  on public.estimate_assemblies (tenant_id, updated_at desc, id);

create index if not exists estimate_assembly_items_title_search_trgm_idx
  on public.estimate_assembly_items using gin (
    public.catalogue_normalize_search(coalesce(title, ''))
      extensions.gin_trgm_ops
  );

create table if not exists public.user_estimate_assembly_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  assembly_id uuid not null references public.estimate_assemblies(id) on delete cascade,
  is_favorite boolean not null default false,
  favorite_position integer,
  usage_count integer not null default 0 check (usage_count >= 0),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, assembly_id),
  check (favorite_position is null or favorite_position >= 0)
);

create index if not exists user_estimate_assembly_preferences_favorites_idx
  on public.user_estimate_assembly_preferences (
    user_id,
    tenant_id,
    is_favorite,
    favorite_position,
    usage_count desc,
    assembly_id
  );

create index if not exists user_estimate_assembly_preferences_recent_idx
  on public.user_estimate_assembly_preferences (
    user_id,
    tenant_id,
    last_used_at desc,
    assembly_id
  )
  where last_used_at is not null;

create or replace function public.assign_estimate_assembly_preference_tenant()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  assembly_tenant_id uuid;
begin
  select a.tenant_id
    into assembly_tenant_id
  from public.estimate_assemblies a
  where a.id = new.assembly_id;

  if assembly_tenant_id is null then
    raise exception 'Estimate assembly not found';
  end if;

  new.tenant_id := assembly_tenant_id;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

revoke execute on function public.assign_estimate_assembly_preference_tenant()
  from public, anon, authenticated;

drop trigger if exists set_estimate_assembly_preference_tenant
  on public.user_estimate_assembly_preferences;
create trigger set_estimate_assembly_preference_tenant
  before insert or update of tenant_id, assembly_id, is_favorite,
    favorite_position, usage_count, last_used_at
  on public.user_estimate_assembly_preferences
  for each row execute function public.assign_estimate_assembly_preference_tenant();

alter table public.user_estimate_assembly_preferences enable row level security;

drop policy if exists "Users read own assembly preferences"
  on public.user_estimate_assembly_preferences;
create policy "Users read own assembly preferences"
  on public.user_estimate_assembly_preferences
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_tenant_member(tenant_id))
  );

drop policy if exists "Users insert own assembly preferences"
  on public.user_estimate_assembly_preferences;
create policy "Users insert own assembly preferences"
  on public.user_estimate_assembly_preferences
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_tenant_member(tenant_id))
  );

drop policy if exists "Users update own assembly preferences"
  on public.user_estimate_assembly_preferences;
create policy "Users update own assembly preferences"
  on public.user_estimate_assembly_preferences
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_tenant_member(tenant_id))
  )
  with check (
    user_id = (select auth.uid())
    and (select public.is_tenant_member(tenant_id))
  );

drop policy if exists "Users delete own assembly preferences"
  on public.user_estimate_assembly_preferences;
create policy "Users delete own assembly preferences"
  on public.user_estimate_assembly_preferences
  for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_tenant_member(tenant_id))
  );

grant select, insert, update, delete
  on public.user_estimate_assembly_preferences
  to authenticated;

create or replace function public.estimate_assemblies_page(
  p_tenant_id uuid,
  p_q text default null,
  p_filter text default 'all',
  p_sort text default 'recent',
  p_dir text default 'desc',
  p_page integer default 1,
  p_size integer default 25
)
returns table (
  id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  name text,
  description text,
  reference_code text,
  unit text,
  pricing_source text,
  stored_ds_cents integer,
  indicative_target_price_cents integer,
  avg_output_rate numeric,
  avg_time_hours numeric,
  source_metadata jsonb,
  item_count bigint,
  component_names text[],
  material_cost_cents bigint,
  labor_cost_cents bigint,
  equipment_cost_cents bigint,
  subcontract_cost_cents bigint,
  calculated_ds_cents bigint,
  pose_only_cents bigint,
  supplied_installed_cents bigint,
  stored_ds_delta_cents bigint,
  is_favorite boolean,
  favorite_position integer,
  usage_count integer,
  last_used_at timestamptz,
  near_duplicate_count bigint,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with filtered as (
    select
      a.*,
      coalesce(pref.is_favorite, false) as is_favorite,
      pref.favorite_position,
      coalesce(pref.usage_count, 0) as usage_count,
      pref.last_used_at,
      public.estimate_assembly_dedupe_key(
        coalesce(nullif(btrim(a.reference_code), ''), a.name)
      ) as dedupe_key
    from public.estimate_assemblies a
    left join public.user_estimate_assembly_preferences pref
      on pref.assembly_id = a.id
      and pref.user_id = (select auth.uid())
      and pref.tenant_id = a.tenant_id
    where a.tenant_id = p_tenant_id
      and (select public.is_tenant_member(a.tenant_id))
      and (
        p_filter = 'all'
        or (p_filter = 'favorites' and coalesce(pref.is_favorite, false))
        or (p_filter = 'recent' and pref.last_used_at is not null)
      )
      and (
        nullif(btrim(p_q), '') is null
        or public.catalogue_normalize_search(
          coalesce(a.name, '') || ' ' ||
          coalesce(a.reference_code, '') || ' ' ||
          coalesce(a.description, '') || ' ' ||
          coalesce(a.unit, '')
        ) like '%' || public.catalogue_normalize_search(btrim(p_q)) || '%'
        or exists (
          select 1
          from public.estimate_assembly_items search_item
          where search_item.assembly_id = a.id
            and search_item.tenant_id = a.tenant_id
            and public.catalogue_normalize_search(coalesce(search_item.title, ''))
              like '%' || public.catalogue_normalize_search(btrim(p_q)) || '%'
        )
      )
  ),
  paged as (
    select
      f.*,
      count(*) over ()::bigint as total_count
    from filtered f
    order by
      case when p_sort = 'name' and p_dir = 'asc'
        then public.catalogue_normalize_search(f.name) end asc,
      case when p_sort = 'name' and p_dir = 'desc'
        then public.catalogue_normalize_search(f.name) end desc,
      case when p_sort = 'reference' and p_dir = 'asc'
        then public.catalogue_normalize_search(coalesce(f.reference_code, '')) end asc,
      case when p_sort = 'reference' and p_dir = 'desc'
        then public.catalogue_normalize_search(coalesce(f.reference_code, '')) end desc,
      case when p_sort = 'cost' and p_dir = 'asc' then f.ds_cents end asc,
      case when p_sort = 'cost' and p_dir = 'desc' then f.ds_cents end desc,
      case when p_sort = 'usage' and p_dir = 'asc' then f.usage_count end asc,
      case when p_sort = 'usage' and p_dir = 'desc' then f.usage_count end desc,
      case when p_sort = 'recent' and p_dir = 'asc'
        then coalesce(f.last_used_at, f.updated_at) end asc,
      case when p_sort = 'recent' and p_dir = 'desc'
        then coalesce(f.last_used_at, f.updated_at) end desc,
      f.id asc
    offset (greatest(p_page, 1) - 1) * least(greatest(p_size, 1), 100)
    limit least(greatest(p_size, 1), 100)
  )
  select
    p.id,
    p.created_at,
    p.updated_at,
    p.name,
    p.description,
    p.reference_code,
    p.unit,
    p.pricing_source,
    p.ds_cents as stored_ds_cents,
    p.indicative_target_price_cents,
    p.avg_output_rate,
    p.avg_time_hours,
    p.source_metadata,
    metrics.item_count,
    metrics.component_names,
    metrics.material_cost_cents,
    metrics.labor_cost_cents,
    metrics.equipment_cost_cents,
    metrics.subcontract_cost_cents,
    metrics.calculated_ds_cents,
    metrics.labor_cost_cents
      + metrics.equipment_cost_cents
      + metrics.subcontract_cost_cents as pose_only_cents,
    case
      when p.indicative_target_price_cents > 0
        then p.indicative_target_price_cents::bigint
      else metrics.calculated_ds_cents
    end as supplied_installed_cents,
    p.ds_cents::bigint - metrics.calculated_ds_cents as stored_ds_delta_cents,
    p.is_favorite,
    p.favorite_position,
    p.usage_count,
    p.last_used_at,
    duplicates.near_duplicate_count,
    p.total_count
  from paged p
  cross join lateral (
    select
      count(*)::bigint as item_count,
      coalesce(
        (array_agg(ai.title order by ai.position, ai.created_at))[1:4],
        '{}'::text[]
      ) as component_names,
      coalesce(sum(
        case when ai.cost_type = 'material'
          then round(coalesce(ai.default_quantity, 0)
            * ai.unit_cost_ht_cents * greatest(coalesce(ai.k_fo, 1), 0))
          else 0 end
      ), 0)::bigint as material_cost_cents,
      coalesce(sum(round(
        coalesce(ai.h_mo, 0)
        * case
            when lr.id is not null then coalesce(lr.hourly_rate_cents, 0)
            when ai.cost_type = 'labor' then ai.unit_cost_ht_cents
            else 0
          end
        * greatest(coalesce(ai.k_mo, 1), 0)
      )), 0)::bigint as labor_cost_cents,
      coalesce(sum(
        case when ai.cost_type = 'equipment'
          then round(coalesce(ai.default_quantity, 0)
            * ai.unit_cost_ht_cents * greatest(coalesce(ai.k_fo, 1), 0))
          else 0 end
      ), 0)::bigint as equipment_cost_cents,
      coalesce(sum(
        case when ai.cost_type = 'subcontract'
          then round(coalesce(ai.default_quantity, 0)
            * ai.unit_cost_ht_cents * greatest(coalesce(ai.k_fo, 1), 0))
          else 0 end
      ), 0)::bigint as subcontract_cost_cents,
      coalesce(sum(round(
        case when ai.cost_type = 'labor' then 0
          else coalesce(ai.default_quantity, 0)
            * ai.unit_cost_ht_cents * greatest(coalesce(ai.k_fo, 1), 0)
        end
        + coalesce(ai.h_mo, 0)
          * case
              when lr.id is not null then coalesce(lr.hourly_rate_cents, 0)
              when ai.cost_type = 'labor' then ai.unit_cost_ht_cents
              else 0
            end
          * greatest(coalesce(ai.k_mo, 1), 0)
      )), 0)::bigint as calculated_ds_cents
    from public.estimate_assembly_items ai
    left join public.labor_roles lr
      on lr.id = ai.labor_role_id
      and lr.tenant_id = ai.tenant_id
    where ai.assembly_id = p.id
      and ai.tenant_id = p.tenant_id
  ) metrics
  cross join lateral (
    select count(*)::bigint as near_duplicate_count
    from public.estimate_assemblies candidate
    where candidate.tenant_id = p.tenant_id
      and candidate.id <> p.id
      and public.estimate_assembly_dedupe_key(
        coalesce(nullif(btrim(candidate.reference_code), ''), candidate.name)
      ) = p.dedupe_key
      and p.dedupe_key <> ''
  ) duplicates
  order by
    case when p_sort = 'name' and p_dir = 'asc'
      then public.catalogue_normalize_search(p.name) end asc,
    case when p_sort = 'name' and p_dir = 'desc'
      then public.catalogue_normalize_search(p.name) end desc,
    case when p_sort = 'reference' and p_dir = 'asc'
      then public.catalogue_normalize_search(coalesce(p.reference_code, '')) end asc,
    case when p_sort = 'reference' and p_dir = 'desc'
      then public.catalogue_normalize_search(coalesce(p.reference_code, '')) end desc,
    case when p_sort = 'cost' and p_dir = 'asc' then p.ds_cents end asc,
    case when p_sort = 'cost' and p_dir = 'desc' then p.ds_cents end desc,
    case when p_sort = 'usage' and p_dir = 'asc' then p.usage_count end asc,
    case when p_sort = 'usage' and p_dir = 'desc' then p.usage_count end desc,
    case when p_sort = 'recent' and p_dir = 'asc'
      then coalesce(p.last_used_at, p.updated_at) end asc,
    case when p_sort = 'recent' and p_dir = 'desc'
      then coalesce(p.last_used_at, p.updated_at) end desc,
    p.id asc;
$$;

create or replace function public.set_estimate_assembly_favorite(
  p_tenant_id uuid,
  p_assembly_id uuid,
  p_favorite boolean
)
returns table (
  assembly_id uuid,
  is_favorite boolean,
  favorite_position integer,
  usage_count integer,
  last_used_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not (select public.is_tenant_member(p_tenant_id)) then
    raise exception 'Estimate assembly not found or access denied';
  end if;

  if not exists (
    select 1
    from public.estimate_assemblies a
    where a.id = p_assembly_id
      and a.tenant_id = p_tenant_id
  ) then
    raise exception 'Estimate assembly not found or access denied';
  end if;

  insert into public.user_estimate_assembly_preferences (
    user_id,
    tenant_id,
    assembly_id,
    is_favorite,
    favorite_position
  )
  values (
    current_user_id,
    p_tenant_id,
    p_assembly_id,
    coalesce(p_favorite, false),
    case
      when coalesce(p_favorite, false) then (
        select coalesce(max(pref.favorite_position), -1) + 1
        from public.user_estimate_assembly_preferences pref
        where pref.user_id = current_user_id
          and pref.tenant_id = p_tenant_id
          and pref.is_favorite
      )
      else null
    end
  )
  on conflict (user_id, assembly_id)
  do update set
    is_favorite = excluded.is_favorite,
    favorite_position = case
      when excluded.is_favorite
        then coalesce(
          public.user_estimate_assembly_preferences.favorite_position,
          excluded.favorite_position
        )
      else null
    end;

  return query
  select
    pref.assembly_id,
    pref.is_favorite,
    pref.favorite_position,
    pref.usage_count,
    pref.last_used_at
  from public.user_estimate_assembly_preferences pref
  where pref.user_id = current_user_id
    and pref.tenant_id = p_tenant_id
    and pref.assembly_id = p_assembly_id;
end;
$$;

create or replace function public.record_estimate_assembly_use(
  p_tenant_id uuid,
  p_assembly_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.estimate_assemblies a
    where a.id = p_assembly_id
      and a.tenant_id = p_tenant_id
      and (select public.is_tenant_member(a.tenant_id))
  ) then
    raise exception 'Estimate assembly not found or access denied';
  end if;

  insert into public.user_estimate_assembly_preferences (
    user_id,
    tenant_id,
    assembly_id,
    usage_count,
    last_used_at
  )
  values (
    current_user_id,
    p_tenant_id,
    p_assembly_id,
    1,
    statement_timestamp()
  )
  on conflict (user_id, assembly_id)
  do update set
    usage_count = public.user_estimate_assembly_preferences.usage_count + 1,
    last_used_at = statement_timestamp();
end;
$$;

revoke execute on function public.estimate_assemblies_page(
  uuid, text, text, text, text, integer, integer
) from public, anon;
revoke execute on function public.set_estimate_assembly_favorite(
  uuid, uuid, boolean
) from public, anon;
revoke execute on function public.record_estimate_assembly_use(uuid, uuid)
  from public, anon;

grant execute on function public.estimate_assemblies_page(
  uuid, text, text, text, text, integer, integer
) to authenticated;
grant execute on function public.set_estimate_assembly_favorite(
  uuid, uuid, boolean
) to authenticated;
grant execute on function public.record_estimate_assembly_use(uuid, uuid)
  to authenticated;
