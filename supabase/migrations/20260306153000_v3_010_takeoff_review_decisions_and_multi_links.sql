-- V3-010: comparaison DPGF preuve-centrique.
-- 1. Autorise plusieurs items takeoff par ligne DPGF via un RPC de remplacement atomique.
-- 2. Persiste les decisions de revue pour les rejouer sur la V2/V3 quand le job est carry-over.

alter table if exists public.takeoff_dpgf_links
  drop constraint if exists takeoff_dpgf_links_estimate_item_key;

do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'takeoff_dpgf_links'
      and c.relkind = 'r'
  ) then
    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.takeoff_dpgf_links'::regclass
        and conname = 'takeoff_dpgf_links_pair_key'
    ) then
      alter table public.takeoff_dpgf_links
        add constraint takeoff_dpgf_links_pair_key
        unique (tenant_id, version_id, takeoff_job_id, estimate_item_id, takeoff_item_id);
    end if;
  end if;
end
$$;

create index if not exists takeoff_dpgf_links_tenant_job_estimate_idx
  on public.takeoff_dpgf_links (tenant_id, takeoff_job_id, estimate_item_id);

create or replace function public.save_takeoff_dpgf_manual_links(
  p_version_id uuid,
  p_takeoff_job_id uuid,
  p_estimate_item_id uuid,
  p_takeoff_item_ids uuid[],
  p_linked_by uuid default null
)
returns uuid[]
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_takeoff_item_ids uuid[] := coalesce(
    array(
      select distinct item_id
      from unnest(coalesce(p_takeoff_item_ids, '{}'::uuid[])) as item_id
      where item_id is not null
    ),
    '{}'::uuid[]
  );
  v_inserted_link_ids uuid[] := '{}'::uuid[];
begin
  if p_version_id is null then
    raise exception using message = 'TAKEOFF_DPGF_LINK_VERSION_REQUIRED';
  end if;

  if p_takeoff_job_id is null then
    raise exception using message = 'TAKEOFF_DPGF_LINK_JOB_REQUIRED';
  end if;

  if p_estimate_item_id is null then
    raise exception using message = 'TAKEOFF_DPGF_LINK_ESTIMATE_ITEM_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.takeoff_jobs tj
    join public.estimate_versions ev on ev.id = tj.estimate_version_id
    where tj.id = p_takeoff_job_id
      and tj.tenant_id = (select public.current_tenant_id())
      and ev.project_id = (
        select target.project_id
        from public.estimate_versions target
        where target.id = p_version_id
      )
      and (
        tj.estimate_version_id = p_version_id
        or exists (
          select 1
          from public.takeoff_version_links tvl
          where tvl.tenant_id = tj.tenant_id
            and tvl.target_version_id = p_version_id
            and tvl.takeoff_job_id = p_takeoff_job_id
        )
      )
      and (select public.can_access_takeoff_estimate_version(p_version_id, tj.tenant_id))
      and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
  ) then
    raise exception using message = 'TAKEOFF_DPGF_LINK_SCOPE_INVALID';
  end if;

  delete from public.takeoff_dpgf_links
  where tenant_id = (select public.current_tenant_id())
    and version_id = p_version_id
    and takeoff_job_id = p_takeoff_job_id
    and (
      estimate_item_id = p_estimate_item_id
      or takeoff_item_id = any(v_takeoff_item_ids)
    );

  if coalesce(array_length(v_takeoff_item_ids, 1), 0) = 0 then
    return '{}'::uuid[];
  end if;

  with inserted as (
    insert into public.takeoff_dpgf_links (
      tenant_id,
      version_id,
      takeoff_job_id,
      estimate_item_id,
      takeoff_item_id,
      linked_by
    )
    select
      (select public.current_tenant_id()),
      p_version_id,
      p_takeoff_job_id,
      p_estimate_item_id,
      item_id,
      p_linked_by
    from unnest(v_takeoff_item_ids) as item_id
    returning id
  )
  select coalesce(array_agg(id order by id), '{}'::uuid[])
    into v_inserted_link_ids
  from inserted;

  return v_inserted_link_ids;
end;
$$;

grant execute on function public.save_takeoff_dpgf_manual_links(uuid, uuid, uuid, uuid[], uuid)
  to authenticated;

create table if not exists public.takeoff_dpgf_review_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  takeoff_job_id uuid not null references public.takeoff_jobs(id) on delete cascade,
  estimate_item_id uuid not null references public.estimate_items(id) on delete cascade,
  review_reference text not null,
  line_label text not null,
  line_position integer not null check (line_position >= 0),
  source_file_name text,
  source_page integer check (source_page is null or source_page > 0),
  carried_over_from_version_id uuid references public.estimate_versions(id) on delete set null,
  carried_over_at timestamptz,
  decision text not null
    check (decision in ('keep_dpgf', 'keep_takeoff', 'manual_fix', 'out_of_scope')),
  reason text,
  decided_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  constraint takeoff_dpgf_review_decisions_version_job_line_key
    unique (tenant_id, version_id, takeoff_job_id, estimate_item_id)
);

alter table if exists public.takeoff_dpgf_review_decisions
  add column if not exists tenant_id uuid,
  add column if not exists version_id uuid,
  add column if not exists takeoff_job_id uuid,
  add column if not exists estimate_item_id uuid,
  add column if not exists review_reference text,
  add column if not exists line_label text,
  add column if not exists line_position integer,
  add column if not exists source_file_name text,
  add column if not exists source_page integer,
  add column if not exists carried_over_from_version_id uuid,
  add column if not exists carried_over_at timestamptz,
  add column if not exists decision text,
  add column if not exists reason text,
  add column if not exists decided_at timestamptz,
  add column if not exists updated_at timestamptz,
  add column if not exists decided_by uuid;

alter table if exists public.takeoff_dpgf_review_decisions
  alter column tenant_id set default public.current_tenant_id(),
  alter column decided_at set default now(),
  alter column updated_at set default now();

do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'takeoff_dpgf_review_decisions'
      and c.relkind = 'r'
  ) then
    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.takeoff_dpgf_review_decisions'::regclass
        and conname = 'takeoff_dpgf_review_decisions_tenant_id_fkey'
    ) then
      alter table public.takeoff_dpgf_review_decisions
        add constraint takeoff_dpgf_review_decisions_tenant_id_fkey
        foreign key (tenant_id)
        references public.tenants(id)
        on delete restrict;
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.takeoff_dpgf_review_decisions'::regclass
        and conname = 'takeoff_dpgf_review_decisions_version_id_fkey'
    ) then
      alter table public.takeoff_dpgf_review_decisions
        add constraint takeoff_dpgf_review_decisions_version_id_fkey
        foreign key (version_id)
        references public.estimate_versions(id)
        on delete cascade;
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.takeoff_dpgf_review_decisions'::regclass
        and conname = 'takeoff_dpgf_review_decisions_takeoff_job_id_fkey'
    ) then
      alter table public.takeoff_dpgf_review_decisions
        add constraint takeoff_dpgf_review_decisions_takeoff_job_id_fkey
        foreign key (takeoff_job_id)
        references public.takeoff_jobs(id)
        on delete cascade;
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.takeoff_dpgf_review_decisions'::regclass
        and conname = 'takeoff_dpgf_review_decisions_estimate_item_id_fkey'
    ) then
      alter table public.takeoff_dpgf_review_decisions
        add constraint takeoff_dpgf_review_decisions_estimate_item_id_fkey
        foreign key (estimate_item_id)
        references public.estimate_items(id)
        on delete cascade;
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.takeoff_dpgf_review_decisions'::regclass
        and conname = 'takeoff_dpgf_review_decisions_decided_by_fkey'
    ) then
      alter table public.takeoff_dpgf_review_decisions
        add constraint takeoff_dpgf_review_decisions_decided_by_fkey
        foreign key (decided_by)
        references auth.users(id);
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.takeoff_dpgf_review_decisions'::regclass
        and conname = 'takeoff_dpgf_review_decisions_carried_over_from_version_id_fkey'
    ) then
      alter table public.takeoff_dpgf_review_decisions
        add constraint takeoff_dpgf_review_decisions_carried_over_from_version_id_fkey
        foreign key (carried_over_from_version_id)
        references public.estimate_versions(id)
        on delete set null;
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.takeoff_dpgf_review_decisions'::regclass
        and conname = 'takeoff_dpgf_review_decisions_version_job_line_key'
    ) then
      alter table public.takeoff_dpgf_review_decisions
        add constraint takeoff_dpgf_review_decisions_version_job_line_key
        unique (tenant_id, version_id, takeoff_job_id, estimate_item_id);
    end if;
  end if;
end
$$;

alter table if exists public.takeoff_dpgf_review_decisions
  alter column tenant_id set not null,
  alter column version_id set not null,
  alter column takeoff_job_id set not null,
  alter column estimate_item_id set not null,
  alter column review_reference set not null,
  alter column line_label set not null,
  alter column line_position set not null,
  alter column decision set not null,
  alter column decided_at set not null,
  alter column updated_at set not null;

create index if not exists takeoff_dpgf_review_decisions_tenant_job_version_idx
  on public.takeoff_dpgf_review_decisions (tenant_id, takeoff_job_id, version_id);

create index if not exists takeoff_dpgf_review_decisions_tenant_estimate_item_idx
  on public.takeoff_dpgf_review_decisions (tenant_id, estimate_item_id);

create index if not exists takeoff_dpgf_review_decisions_reference_idx
  on public.takeoff_dpgf_review_decisions (tenant_id, takeoff_job_id, review_reference);

create index if not exists takeoff_dpgf_review_decisions_carried_over_idx
  on public.takeoff_dpgf_review_decisions (tenant_id, carried_over_from_version_id);

create or replace function public.assign_takeoff_dpgf_review_decisions_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_tenant_id uuid;
  target_project_id uuid;
  job_tenant_id uuid;
  job_version_id uuid;
  job_project_id uuid;
  estimate_item_tenant_id uuid;
  estimate_item_version_id uuid;
  estimate_item_type public.estimate_item_type;
  estimate_item_source_provider text;
begin
  if new.version_id is not null then
    select ev.tenant_id, ev.project_id
      into target_tenant_id, target_project_id
    from public.estimate_versions ev
    where ev.id = new.version_id;
  end if;

  if new.takeoff_job_id is not null then
    select tj.tenant_id, tj.estimate_version_id, ev.project_id
      into job_tenant_id, job_version_id, job_project_id
    from public.takeoff_jobs tj
    join public.estimate_versions ev on ev.id = tj.estimate_version_id
    where tj.id = new.takeoff_job_id;
  end if;

  if new.estimate_item_id is not null then
    select ei.tenant_id, ei.version_id, ei.item_type, coalesce(ei.source_provider, '')
      into estimate_item_tenant_id, estimate_item_version_id, estimate_item_type, estimate_item_source_provider
    from public.estimate_items ei
    where ei.id = new.estimate_item_id;
  end if;

  if estimate_item_version_id is not null
    and new.version_id is not null
    and estimate_item_version_id is distinct from new.version_id then
    raise exception
      using
        errcode = '23514',
        message = 'TAKEOFF_DPGF_REVIEW_DECISION_VERSION_MISMATCH';
  end if;

  if estimate_item_type is not null
    and estimate_item_type is distinct from 'line'::public.estimate_item_type then
    raise exception
      using
        errcode = '23514',
        message = 'TAKEOFF_DPGF_REVIEW_DECISION_ITEM_TYPE_INVALID';
  end if;

  if estimate_item_source_provider is not null
    and estimate_item_source_provider <> ''
    and estimate_item_source_provider is distinct from 'dpgf' then
    raise exception
      using
        errcode = '23514',
        message = 'TAKEOFF_DPGF_REVIEW_DECISION_SOURCE_PROVIDER_INVALID';
  end if;

  if target_project_id is not null
    and job_project_id is not null
    and target_project_id is distinct from job_project_id then
    raise exception
      using
        errcode = '23514',
        message = 'TAKEOFF_DPGF_REVIEW_DECISION_PROJECT_MISMATCH';
  end if;

  if job_version_id is not null
    and new.version_id is not null
    and job_version_id is distinct from new.version_id
    and not exists (
      select 1
      from public.takeoff_version_links tvl
      where tvl.tenant_id = coalesce(target_tenant_id, job_tenant_id, estimate_item_tenant_id)
        and tvl.takeoff_job_id = new.takeoff_job_id
        and tvl.target_version_id = new.version_id
        and tvl.source_version_id = job_version_id
    ) then
    raise exception
      using
        errcode = '23514',
        message = 'TAKEOFF_DPGF_REVIEW_DECISION_SCOPE_INVALID';
  end if;

  new.tenant_id := coalesce(
    target_tenant_id,
    job_tenant_id,
    estimate_item_tenant_id,
    new.tenant_id,
    public.current_tenant_id()
  );

  if job_tenant_id is not null and job_tenant_id is distinct from new.tenant_id then
    raise exception
      using
        errcode = '23514',
        message = 'TAKEOFF_DPGF_REVIEW_DECISION_TENANT_MISMATCH';
  end if;

  if estimate_item_tenant_id is not null and estimate_item_tenant_id is distinct from new.tenant_id then
    raise exception
      using
        errcode = '23514',
        message = 'TAKEOFF_DPGF_REVIEW_DECISION_TENANT_MISMATCH';
  end if;

  new.updated_at := now();
  new.decided_at := coalesce(new.decided_at, now());

  return new;
end;
$$;

drop trigger if exists set_takeoff_dpgf_review_decisions_tenant_id on public.takeoff_dpgf_review_decisions;
create trigger set_takeoff_dpgf_review_decisions_tenant_id
  before insert or update on public.takeoff_dpgf_review_decisions
  for each row execute procedure public.assign_takeoff_dpgf_review_decisions_tenant_id();

alter table if exists public.takeoff_dpgf_review_decisions
  enable row level security;

drop policy if exists "Current tenant can select takeoff dpgf review decisions" on public.takeoff_dpgf_review_decisions;
drop policy if exists "Current tenant can insert takeoff dpgf review decisions" on public.takeoff_dpgf_review_decisions;
drop policy if exists "Current tenant can update takeoff dpgf review decisions" on public.takeoff_dpgf_review_decisions;
drop policy if exists "Current tenant can delete takeoff dpgf review decisions" on public.takeoff_dpgf_review_decisions;

create policy "Current tenant can select takeoff dpgf review decisions"
  on public.takeoff_dpgf_review_decisions
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(version_id, tenant_id))
    and exists (
      select 1
      from public.takeoff_jobs tj
      join public.estimate_versions ev on ev.id = tj.estimate_version_id
      where tj.id = takeoff_dpgf_review_decisions.takeoff_job_id
        and tj.tenant_id = takeoff_dpgf_review_decisions.tenant_id
        and ev.project_id = (
          select target.project_id
          from public.estimate_versions target
          where target.id = takeoff_dpgf_review_decisions.version_id
        )
        and (
          tj.estimate_version_id = takeoff_dpgf_review_decisions.version_id
          or exists (
            select 1
            from public.takeoff_version_links tvl
            where tvl.tenant_id = takeoff_dpgf_review_decisions.tenant_id
              and tvl.target_version_id = takeoff_dpgf_review_decisions.version_id
              and tvl.takeoff_job_id = takeoff_dpgf_review_decisions.takeoff_job_id
          )
        )
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
  );

create policy "Current tenant can insert takeoff dpgf review decisions"
  on public.takeoff_dpgf_review_decisions
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(version_id, tenant_id))
    and exists (
      select 1
      from public.takeoff_jobs tj
      join public.estimate_versions ev on ev.id = tj.estimate_version_id
      where tj.id = takeoff_dpgf_review_decisions.takeoff_job_id
        and tj.tenant_id = takeoff_dpgf_review_decisions.tenant_id
        and ev.project_id = (
          select target.project_id
          from public.estimate_versions target
          where target.id = takeoff_dpgf_review_decisions.version_id
        )
        and (
          tj.estimate_version_id = takeoff_dpgf_review_decisions.version_id
          or exists (
            select 1
            from public.takeoff_version_links tvl
            where tvl.tenant_id = takeoff_dpgf_review_decisions.tenant_id
              and tvl.target_version_id = takeoff_dpgf_review_decisions.version_id
              and tvl.takeoff_job_id = takeoff_dpgf_review_decisions.takeoff_job_id
          )
        )
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
  );

create policy "Current tenant can update takeoff dpgf review decisions"
  on public.takeoff_dpgf_review_decisions
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(version_id, tenant_id))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(version_id, tenant_id))
    and exists (
      select 1
      from public.takeoff_jobs tj
      join public.estimate_versions ev on ev.id = tj.estimate_version_id
      where tj.id = takeoff_dpgf_review_decisions.takeoff_job_id
        and tj.tenant_id = takeoff_dpgf_review_decisions.tenant_id
        and ev.project_id = (
          select target.project_id
          from public.estimate_versions target
          where target.id = takeoff_dpgf_review_decisions.version_id
        )
        and (
          tj.estimate_version_id = takeoff_dpgf_review_decisions.version_id
          or exists (
            select 1
            from public.takeoff_version_links tvl
            where tvl.tenant_id = takeoff_dpgf_review_decisions.tenant_id
              and tvl.target_version_id = takeoff_dpgf_review_decisions.version_id
              and tvl.takeoff_job_id = takeoff_dpgf_review_decisions.takeoff_job_id
          )
        )
    )
  );

create policy "Current tenant can delete takeoff dpgf review decisions"
  on public.takeoff_dpgf_review_decisions
  for delete
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(version_id, tenant_id))
  );

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
  where v.id = source_version_id
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
    variant_parent_id := source_version_id;

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
  where version_id = source_version_id;

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
    src.line_total_ht_cents,
    src.line_tax_cents,
    src.line_total_ttc_cents
  from public.estimate_items src
  join _estimate_item_map map on map.old_id = src.id
  left join _estimate_item_map parent_map on parent_map.old_id = src.parent_id;

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
    source_version_id,
    now(),
    src.decision,
    src.reason,
    src.decided_at,
    src.updated_at,
    src.decided_by
  from public.takeoff_dpgf_review_decisions src
  join _estimate_item_map map on map.old_id = src.estimate_item_id
  where src.version_id = source_version_id;

  return new_version_id;
end;
$$;
