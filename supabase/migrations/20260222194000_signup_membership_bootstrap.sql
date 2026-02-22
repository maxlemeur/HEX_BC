-- Ensure new signups get a tenant membership and backfill existing users without one.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  default_tenant_id uuid;
  membership_role public.tenant_role;
begin
  insert into public.profiles (id, full_name, phone, job_title, work_email, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), new.email, 'Utilisateur'),
    nullif(trim(new.raw_user_meta_data->>'phone'), ''),
    nullif(trim(new.raw_user_meta_data->>'job_title'), ''),
    new.email,
    'buyer'
  )
  on conflict (id) do update
  set
    full_name = excluded.full_name,
    phone = excluded.phone,
    job_title = excluded.job_title,
    work_email = excluded.work_email;

  membership_role := case
    when lower(coalesce(new.raw_user_meta_data->>'role', '')) = 'admin' then 'admin'::public.tenant_role
    else 'engineer'::public.tenant_role
  end;

  select t.id
    into default_tenant_id
  from public.tenants t
  where t.slug = 'hydro-express'
  order by t.created_at asc
  limit 1;

  if default_tenant_id is null then
    select t.id
      into default_tenant_id
    from public.tenants t
    order by t.created_at asc
    limit 1;
  end if;

  if default_tenant_id is null then
    insert into public.tenants (name, slug, created_by)
    values ('Hydro Express', 'hydro-express', new.id)
    on conflict (slug) do update
    set name = excluded.name
    returning id into default_tenant_id;

    if default_tenant_id is null then
      select t.id
        into default_tenant_id
      from public.tenants t
      where t.slug = 'hydro-express'
      limit 1;
    end if;
  end if;

  if default_tenant_id is null then
    raise exception 'Unable to resolve a default tenant for user %', new.id;
  end if;

  insert into public.tenant_memberships (
    tenant_id,
    user_id,
    role,
    is_default
  )
  values (
    default_tenant_id,
    new.id,
    membership_role,
    not exists (
      select 1
      from public.tenant_memberships tm
      where tm.user_id = new.id
        and tm.is_default
    )
  )
  on conflict (tenant_id, user_id)
  do update
  set role = excluded.role;

  with ranked_defaults as (
    select
      tm.id,
      row_number() over (
        partition by tm.user_id
        order by tm.is_default desc, tm.created_at asc, tm.id asc
      ) as rank_in_user
    from public.tenant_memberships tm
    where tm.user_id = new.id
  )
  update public.tenant_memberships tm
  set is_default = (ranked_defaults.rank_in_user = 1)
  from ranked_defaults
  where tm.id = ranked_defaults.id
    and tm.is_default is distinct from (ranked_defaults.rank_in_user = 1);

  return new;
end;
$$;

do $$
declare
  default_tenant_id uuid;
begin
  select t.id
    into default_tenant_id
  from public.tenants t
  where t.slug = 'hydro-express'
  order by t.created_at asc
  limit 1;

  if default_tenant_id is null then
    select t.id
      into default_tenant_id
    from public.tenants t
    order by t.created_at asc
    limit 1;
  end if;

  if default_tenant_id is null then
    insert into public.tenants (name, slug, created_by)
    values ('Hydro Express', 'hydro-express', null)
    on conflict (slug) do update
    set name = excluded.name
    returning id into default_tenant_id;

    if default_tenant_id is null then
      select t.id
        into default_tenant_id
      from public.tenants t
      where t.slug = 'hydro-express'
      limit 1;
    end if;
  end if;

  if default_tenant_id is null then
    raise exception 'Unable to initialize default tenant.';
  end if;

  insert into public.tenant_memberships (
    tenant_id,
    user_id,
    role,
    is_default
  )
  select
    default_tenant_id,
    p.id,
    case
      when p.role = 'admin' then 'admin'::public.tenant_role
      else 'engineer'::public.tenant_role
    end,
    not exists (
      select 1
      from public.tenant_memberships tm
      where tm.user_id = p.id
        and tm.is_default
    )
  from public.profiles p
  where not exists (
    select 1
    from public.tenant_memberships tm
    where tm.user_id = p.id
  )
  on conflict (tenant_id, user_id)
  do nothing;

  with ranked_defaults as (
    select
      tm.id,
      row_number() over (
        partition by tm.user_id
        order by tm.is_default desc, tm.created_at asc, tm.id asc
      ) as rank_in_user
    from public.tenant_memberships tm
  )
  update public.tenant_memberships tm
  set is_default = (ranked_defaults.rank_in_user = 1)
  from ranked_defaults
  where tm.id = ranked_defaults.id
    and tm.is_default is distinct from (ranked_defaults.rank_in_user = 1);
end;
$$;
