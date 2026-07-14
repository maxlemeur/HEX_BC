-- Per-user favorite projects for the affaires list, plus favorites-aware RPC contracts.

create table if not exists public.user_favorite_projects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id()
    references public.tenants(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  constraint user_favorite_projects_tenant_user_project_key
    unique (tenant_id, user_id, project_id)
);

create index if not exists user_favorite_projects_user_idx
  on public.user_favorite_projects (tenant_id, user_id, updated_at desc);

create index if not exists user_favorite_projects_project_user_idx
  on public.user_favorite_projects (tenant_id, project_id, user_id);

drop trigger if exists set_user_favorite_projects_updated_at on public.user_favorite_projects;
create trigger set_user_favorite_projects_updated_at
  before update on public.user_favorite_projects
  for each row execute procedure public.set_updated_at();

alter table if exists public.user_favorite_projects enable row level security;
alter table if exists public.user_favorite_projects force row level security;

drop policy if exists "Current tenant can select favorite projects" on public.user_favorite_projects;
drop policy if exists "Current tenant can insert favorite projects" on public.user_favorite_projects;
drop policy if exists "Current tenant can update favorite projects" on public.user_favorite_projects;
drop policy if exists "Current tenant can delete favorite projects" on public.user_favorite_projects;

create policy "Current tenant can select favorite projects"
  on public.user_favorite_projects for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and user_id = (select auth.uid())
  );

create policy "Current tenant can insert favorite projects"
  on public.user_favorite_projects for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and user_id = (select auth.uid())
  );

create policy "Current tenant can update favorite projects"
  on public.user_favorite_projects for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and user_id = (select auth.uid())
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and user_id = (select auth.uid())
  );

create policy "Current tenant can delete favorite projects"
  on public.user_favorite_projects for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and user_id = (select auth.uid())
  );

drop function if exists public.list_affaires_page(
  uuid,
  uuid,
  integer,
  text,
  public.estimate_status[],
  timestamptz,
  uuid,
  text
);

drop function if exists public.list_affaires_page(
  uuid,
  uuid,
  integer,
  text,
  public.estimate_status[],
  timestamptz,
  uuid,
  text,
  boolean
);

create or replace function public.list_affaires_page(
  p_tenant_id uuid,
  p_owner_user_id uuid,
  p_limit integer default 20,
  p_search text default null,
  p_statuses public.estimate_status[] default null,
  p_cursor_updated_at timestamptz default null,
  p_cursor_project_id uuid default null,
  p_sort_dir text default 'desc',
  p_favorites_only boolean default false
)
returns table (
  project_id uuid,
  project_name text,
  project_reference text,
  project_client text,
  version_count integer,
  has_current_version boolean,
  current_version_id uuid,
  current_version_number integer,
  current_status public.estimate_status,
  current_total_ht_cents integer,
  current_updated_at timestamptz,
  accepted_version_id uuid,
  accepted_version_number integer,
  has_dpgf boolean,
  current_approval_status public.estimate_version_approval_status,
  is_favorite boolean
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 101));
  v_search text := nullif(btrim(p_search), '');
  v_sort_dir text := case lower(coalesce(p_sort_dir, 'desc'))
    when 'asc' then 'asc'
    else 'desc'
  end;
  v_favorites_only boolean := coalesce(p_favorites_only, false);
  v_is_admin boolean;
begin
  if p_tenant_id is null then
    raise exception using message = 'AFFAIRES_TENANT_REQUIRED';
  end if;

  if p_tenant_id is distinct from public.current_tenant_id() then
    raise exception using message = 'AFFAIRES_TENANT_MISMATCH';
  end if;

  v_is_admin := coalesce(
    public.has_tenant_role(p_tenant_id, array['admin'::public.tenant_role]),
    false
  );

  if not v_is_admin and p_owner_user_id is not null and p_owner_user_id is distinct from auth.uid() then
    raise exception using message = 'AFFAIRES_OWNER_SCOPE_INVALID';
  end if;

  if (p_cursor_updated_at is null) <> (p_cursor_project_id is null) then
    raise exception using message = 'AFFAIRES_CURSOR_INVALID';
  end if;

  return query
  with scoped_projects as (
    select
      p.id,
      p.tenant_id,
      p.name,
      p.reference,
      p.client_name,
      p.updated_at,
      coalesce(ufp.project_id is not null, false) as is_favorite
    from public.estimate_projects p
    left join public.user_favorite_projects ufp
      on ufp.tenant_id = p.tenant_id
      and ufp.user_id = auth.uid()
      and ufp.project_id = p.id
    where p.tenant_id = p_tenant_id
      and p.is_archived = false
      and (v_is_admin or p_owner_user_id is null or p.user_id = p_owner_user_id)
  ),
  enriched as (
    select
      p.id as project_id,
      p.name as project_name,
      p.reference as project_reference,
      p.client_name as project_client,
      vc.version_count,
      (lv.id is not null) as has_current_version,
      lv.id as current_version_id,
      lv.version_number as current_version_number,
      lv.status as current_status,
      lv.total_ht_cents as current_total_ht_cents,
      coalesce(lv.updated_at, p.updated_at) as current_updated_at,
      av.id as accepted_version_id,
      av.version_number as accepted_version_number,
      (di.id is not null) as has_dpgf,
      lv.approval_status as current_approval_status,
      p.is_favorite
    from scoped_projects p
    left join lateral (
      select
        ev.id,
        ev.version_number,
        ev.status,
        ev.total_ht_cents,
        ev.updated_at,
        ev.approval_status
      from public.estimate_versions ev
      where ev.tenant_id = p.tenant_id
        and ev.project_id = p.id
      order by ev.version_number desc, ev.updated_at desc, ev.id desc
      limit 1
    ) lv on true
    left join lateral (
      select
        ev.id,
        ev.version_number
      from public.estimate_versions ev
      where ev.tenant_id = p.tenant_id
        and ev.project_id = p.id
        and ev.status = 'accepted'::public.estimate_status
      order by ev.version_number desc, ev.updated_at desc, ev.id desc
      limit 1
    ) av on true
    left join lateral (
      select count(*)::integer as version_count
      from public.estimate_versions ev
      where ev.tenant_id = p.tenant_id
        and ev.project_id = p.id
    ) vc on true
    left join lateral (
      select d.id
      from public.dpgf_imports d
      where d.project_id = p.id
      limit 1
    ) di on true
  ),
  searched as (
    select *
    from enriched e
    where (
      not v_favorites_only
      or e.is_favorite
    )
      and (
        v_search is null
        or e.project_name ilike '%' || v_search || '%'
        or coalesce(e.project_client, '') ilike '%' || v_search || '%'
      )
  )
  select
    s.project_id,
    s.project_name,
    s.project_reference,
    s.project_client,
    s.version_count,
    s.has_current_version,
    s.current_version_id,
    s.current_version_number,
    s.current_status,
    s.current_total_ht_cents,
    s.current_updated_at,
    s.accepted_version_id,
    s.accepted_version_number,
    s.has_dpgf,
    s.current_approval_status,
    s.is_favorite
  from searched s
  where (
    p_statuses is null
    or cardinality(p_statuses) = 0
    or (
      s.has_current_version
      and s.current_status = any(p_statuses)
    )
    or (
      not s.has_current_version
      and 'draft'::public.estimate_status = any(p_statuses)
    )
  )
    and (
      p_cursor_updated_at is null
      or (
        (v_sort_dir = 'desc' and (s.current_updated_at, s.project_id) < (p_cursor_updated_at, p_cursor_project_id))
        or (v_sort_dir = 'asc' and (s.current_updated_at, s.project_id) > (p_cursor_updated_at, p_cursor_project_id))
      )
    )
  order by
    case when v_sort_dir = 'asc' then s.current_updated_at end asc,
    case when v_sort_dir = 'asc' then s.project_id end asc,
    case when v_sort_dir = 'desc' then s.current_updated_at end desc,
    case when v_sort_dir = 'desc' then s.project_id end desc
  limit v_limit;
end;
$$;

grant execute on function public.list_affaires_page(
  uuid,
  uuid,
  integer,
  text,
  public.estimate_status[],
  timestamptz,
  uuid,
  text,
  boolean
)
to authenticated;

drop function if exists public.get_affaires_counters(
  uuid,
  uuid,
  text,
  public.estimate_status[]
);

drop function if exists public.get_affaires_counters(
  uuid,
  uuid,
  text,
  public.estimate_status[],
  boolean
);

create or replace function public.get_affaires_counters(
  p_tenant_id uuid,
  p_owner_user_id uuid,
  p_search text default null,
  p_statuses public.estimate_status[] default null,
  p_favorites_only boolean default false
)
returns table (
  total_count integer,
  filtered_count integer,
  draft_count integer,
  sent_count integer,
  accepted_count integer,
  archived_count integer
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_search text := nullif(btrim(p_search), '');
  v_favorites_only boolean := coalesce(p_favorites_only, false);
  v_is_admin boolean;
begin
  if p_tenant_id is null then
    raise exception using message = 'AFFAIRES_TENANT_REQUIRED';
  end if;

  if p_tenant_id is distinct from public.current_tenant_id() then
    raise exception using message = 'AFFAIRES_TENANT_MISMATCH';
  end if;

  v_is_admin := coalesce(
    public.has_tenant_role(p_tenant_id, array['admin'::public.tenant_role]),
    false
  );

  if not v_is_admin and p_owner_user_id is not null and p_owner_user_id is distinct from auth.uid() then
    raise exception using message = 'AFFAIRES_OWNER_SCOPE_INVALID';
  end if;

  return query
  with scoped_projects as (
    select
      p.id,
      p.tenant_id,
      p.name,
      p.client_name,
      coalesce(ufp.project_id is not null, false) as is_favorite
    from public.estimate_projects p
    left join public.user_favorite_projects ufp
      on ufp.tenant_id = p.tenant_id
      and ufp.user_id = auth.uid()
      and ufp.project_id = p.id
    where p.tenant_id = p_tenant_id
      and p.is_archived = false
      and (v_is_admin or p_owner_user_id is null or p.user_id = p_owner_user_id)
  ),
  total_latest as (
    select
      p.id as project_id,
      coalesce(lv.status, 'draft'::public.estimate_status) as effective_status
    from scoped_projects p
    left join lateral (
      select ev.status
      from public.estimate_versions ev
      where ev.tenant_id = p.tenant_id
        and ev.project_id = p.id
      order by ev.version_number desc, ev.updated_at desc, ev.id desc
      limit 1
    ) lv on true
  ),
  effective_projects as (
    select *
    from scoped_projects p
    where (
      not v_favorites_only
      or p.is_favorite
    )
  ),
  latest as (
    select
      p.id as project_id,
      p.name as project_name,
      p.client_name as project_client,
      coalesce(lv.status, 'draft'::public.estimate_status) as effective_status
    from effective_projects p
    left join lateral (
      select ev.status
      from public.estimate_versions ev
      where ev.tenant_id = p.tenant_id
        and ev.project_id = p.id
      order by ev.version_number desc, ev.updated_at desc, ev.id desc
      limit 1
    ) lv on true
  ),
  searched as (
    select *
    from latest l
    where (
      v_search is null
      or l.project_name ilike '%' || v_search || '%'
      or coalesce(l.project_client, '') ilike '%' || v_search || '%'
    )
  ),
  filtered as (
    select *
    from searched s
    where (
      p_statuses is null
      or cardinality(p_statuses) = 0
      or s.effective_status = any(p_statuses)
    )
  )
  select
    (select count(*)::integer from total_latest) as total_count,
    (select count(*)::integer from filtered) as filtered_count,
    (select count(*)::integer from searched where effective_status = 'draft'::public.estimate_status) as draft_count,
    (select count(*)::integer from searched where effective_status = 'sent'::public.estimate_status) as sent_count,
    (select count(*)::integer from searched where effective_status = 'accepted'::public.estimate_status) as accepted_count,
    (select count(*)::integer from searched where effective_status = 'archived'::public.estimate_status) as archived_count;
end;
$$;

grant execute on function public.get_affaires_counters(
  uuid,
  uuid,
  text,
  public.estimate_status[],
  boolean
)
to authenticated;

-- Consolidated from 20260310113000_est433_duplicate_version_source_metadata_fix.sql to keep migration versions unique.
alter table if exists public.estimate_items
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

create or replace function public.duplicate_estimate_version(
  source_version_id uuid,
  as_variant boolean default false
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  source_version public.estimate_versions%rowtype;
  new_version_id uuid := gen_random_uuid();
  new_version_number integer;
  variant_parent_id uuid := null;
  next_variant_index integer := 0;
  next_variant_label text := null;
begin
  select v.*
    into source_version
  from public.estimate_versions v
  join public.estimate_projects p on p.id = v.project_id
  where v.id = duplicate_estimate_version.source_version_id
    and (select public.is_tenant_member(p.tenant_id))
    and (
      p.user_id = (select auth.uid())
      or (select public.has_tenant_role(p.tenant_id, array['admin'::public.tenant_role]))
    );

  if not found then
    raise exception 'Estimate version not found or access denied';
  end if;

  select coalesce(max(version_number), 0) + 1
    into new_version_number
  from public.estimate_versions
  where project_id = source_version.project_id;

  if coalesce(as_variant, false) then
    variant_parent_id := duplicate_estimate_version.source_version_id;

    loop
      next_variant_index := next_variant_index + 1;
      next_variant_label := public.estimate_variant_label_from_index(next_variant_index);

      exit when not exists (
        select 1
        from public.estimate_versions existing_variant
        where existing_variant.parent_version_id = variant_parent_id
          and existing_variant.variant_label = next_variant_label
      );
    end loop;
  end if;

  insert into public.estimate_versions (
    id,
    tenant_id,
    project_id,
    version_number,
    status,
    title,
    date_devis,
    validite_jours,
    margin_multiplier,
    margin_mode,
    currency,
    margin_bp,
    discount_bp,
    discount_mode,
    discount_steps,
    global_coefficient,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    total_ht_cents,
    total_tax_cents,
    total_ttc_cents,
    parent_version_id,
    variant_label
  )
  values (
    new_version_id,
    source_version.tenant_id,
    source_version.project_id,
    new_version_number,
    'draft',
    source_version.title,
    source_version.date_devis,
    source_version.validite_jours,
    source_version.margin_multiplier,
    source_version.margin_mode,
    source_version.currency,
    source_version.margin_bp,
    source_version.discount_bp,
    source_version.discount_mode,
    source_version.discount_steps,
    source_version.global_coefficient,
    source_version.tax_rate_bp,
    source_version.rounding_mode,
    source_version.rounding_step_cents,
    source_version.total_ht_cents,
    source_version.total_tax_cents,
    source_version.total_ttc_cents,
    variant_parent_id,
    next_variant_label
  );

  create temporary table _estimate_item_map (
    old_id uuid primary key,
    new_id uuid not null
  ) on commit drop;

  insert into _estimate_item_map (old_id, new_id)
  select id, gen_random_uuid()
  from public.estimate_items
  where version_id = duplicate_estimate_version.source_version_id;

  insert into public.estimate_items (
    id,
    tenant_id,
    version_id,
    parent_id,
    item_type,
    position,
    title,
    description,
    quantity,
    unit_price_ht_cents,
    tax_rate_bp,
    k_fo,
    h_mo,
    h_mo_majoration,
    k_mo,
    h_mo_atelier,
    k_mo_atelier,
    labor_role_atelier_id,
    h_mo_chantier,
    k_mo_chantier,
    labor_role_chantier_id,
    pu_ht_cents,
    labor_role_id,
    category_id,
    supply_type_id,
    selected_supplier_price_id,
    source_provider,
    source_job_id,
    source_file_name,
    source_page,
    source_metadata,
    line_total_ht_cents,
    line_tax_cents,
    line_total_ttc_cents
  )
  select
    map.new_id,
    source_version.tenant_id,
    new_version_id,
    parent_map.new_id,
    src.item_type,
    src.position,
    src.title,
    src.description,
    src.quantity,
    src.unit_price_ht_cents,
    src.tax_rate_bp,
    src.k_fo,
    src.h_mo,
    src.h_mo_majoration,
    src.k_mo,
    src.h_mo_atelier,
    src.k_mo_atelier,
    src.labor_role_atelier_id,
    src.h_mo_chantier,
    src.k_mo_chantier,
    src.labor_role_chantier_id,
    src.pu_ht_cents,
    src.labor_role_id,
    src.category_id,
    src.supply_type_id,
    src.selected_supplier_price_id,
    src.source_provider,
    src.source_job_id,
    src.source_file_name,
    src.source_page,
    coalesce(src.source_metadata, '{}'::jsonb),
    src.line_total_ht_cents,
    src.line_tax_cents,
    src.line_total_ttc_cents
  from public.estimate_items src
  join _estimate_item_map map on map.old_id = src.id
  left join _estimate_item_map parent_map on parent_map.old_id = src.parent_id;

  insert into public.takeoff_version_links (
    tenant_id,
    takeoff_job_id,
    source_version_id,
    target_version_id,
    linked_at,
    linked_by
  )
  select distinct on (src.takeoff_job_id)
    source_version.tenant_id,
    src.takeoff_job_id,
    coalesce(existing_link.source_version_id, job.estimate_version_id),
    new_version_id,
    now(),
    null
  from public.takeoff_dpgf_review_decisions src
  join public.takeoff_jobs job
    on job.id = src.takeoff_job_id
   and job.tenant_id = source_version.tenant_id
  left join public.takeoff_version_links existing_link
   on existing_link.tenant_id = source_version.tenant_id
   and existing_link.target_version_id = duplicate_estimate_version.source_version_id
   and existing_link.takeoff_job_id = src.takeoff_job_id
  where src.version_id = duplicate_estimate_version.source_version_id
  order by src.takeoff_job_id
  on conflict (takeoff_job_id, target_version_id) do nothing;

  insert into public.takeoff_dpgf_review_decisions (
    id,
    tenant_id,
    version_id,
    takeoff_job_id,
    estimate_item_id,
    review_reference,
    line_label,
    line_position,
    source_file_name,
    source_page,
    carried_over_from_version_id,
    carried_over_at,
    decision,
    reason,
    decided_at,
    updated_at,
    decided_by
  )
  select
    gen_random_uuid(),
    src.tenant_id,
    new_version_id,
    src.takeoff_job_id,
    map.new_id,
    src.review_reference,
    src.line_label,
    src.line_position,
    src.source_file_name,
    src.source_page,
    duplicate_estimate_version.source_version_id,
    now(),
    src.decision,
    src.reason,
    src.decided_at,
    src.updated_at,
    src.decided_by
  from public.takeoff_dpgf_review_decisions src
  join _estimate_item_map map on map.old_id = src.estimate_item_id
  where src.version_id = duplicate_estimate_version.source_version_id;

  return new_version_id;
end;
$$;
