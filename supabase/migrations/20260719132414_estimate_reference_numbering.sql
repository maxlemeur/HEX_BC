create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table if not exists private.estimate_reference_counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reference_year smallint not null
    check (reference_year between 2000 and 2099),
  last_value integer not null
    check (last_value between 1 and 999),
  primary key (tenant_id, reference_year)
);

alter table private.estimate_reference_counters enable row level security;

revoke all on table private.estimate_reference_counters
  from public, anon, authenticated;

alter table public.estimate_projects
  add column if not exists estimate_reference text;

alter table public.estimate_projects
  drop constraint if exists estimate_projects_estimate_reference_format_check;

alter table public.estimate_projects
  add constraint estimate_projects_estimate_reference_format_check
  check (
    estimate_reference is null
    or estimate_reference ~ '^HEX_D[0-9]{5}[A-Z]{2}$'
  );

create unique index if not exists estimate_projects_tenant_estimate_reference_uidx
  on public.estimate_projects (tenant_id, estimate_reference)
  where estimate_reference is not null;

insert into private.estimate_reference_counters as counter (
  tenant_id,
  reference_year,
  last_value
)
select
  project.tenant_id,
  2000 + substring(project.estimate_reference from 6 for 2)::smallint,
  max(substring(project.estimate_reference from 8 for 3)::integer)
from public.estimate_projects project
where project.estimate_reference ~ '^HEX_D[0-9]{5}[A-Z]{2}$'
group by
  project.tenant_id,
  substring(project.estimate_reference from 6 for 2)
on conflict (tenant_id, reference_year)
do update set last_value = greatest(
  counter.last_value,
  excluded.last_value
);

create or replace function private.assign_estimate_project_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  full_name_value text;
  normalized_name text;
  name_parts text[];
  author_initials text;
  reference_year integer := extract(year from current_date)::integer;
  sequence_value integer;
begin
  if new.tenant_id is null or new.user_id is null then
    raise exception 'Estimate reference requires tenant_id and user_id'
      using errcode = '23502';
  end if;

  if current_user_id is not null and current_user_id <> new.user_id then
    raise exception 'Estimate reference user mismatch'
      using errcode = '42501';
  end if;

  if current_user_id is not null and not exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = new.tenant_id
      and membership.user_id = current_user_id
  ) then
    raise exception 'Estimate reference tenant access denied'
      using errcode = '42501';
  end if;

  select profile.full_name
    into full_name_value
  from public.profiles profile
  where profile.id = new.user_id;

  normalized_name := btrim(
    regexp_replace(coalesce(full_name_value, 'Utilisateur'), '[[:space:]]+', ' ', 'g')
  );

  if normalized_name = '' then
    normalized_name := 'Utilisateur';
  end if;

  if position('@' in normalized_name) > 0 then
    normalized_name := split_part(normalized_name, '@', 1);
  end if;

  name_parts := regexp_split_to_array(normalized_name, '[[:space:]._-]+');
  author_initials := upper(
    left(name_parts[1], 1)
    || left(name_parts[array_length(name_parts, 1)], 1)
  );
  author_initials := translate(
    author_initials,
    'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸ',
    'AAAAAACEEEEIIIINOOOOOUUUUYY'
  );
  author_initials := regexp_replace(author_initials, '[^A-Z]', '', 'g');

  if char_length(author_initials) = 1 then
    author_initials := author_initials || author_initials;
  elsif char_length(author_initials) <> 2 then
    author_initials := 'XX';
  end if;

  insert into private.estimate_reference_counters as counter (
    tenant_id,
    reference_year,
    last_value
  )
  values (
    new.tenant_id,
    reference_year,
    1
  )
  on conflict (tenant_id, reference_year)
  do update set last_value = counter.last_value + 1
  where counter.last_value < 999
  returning last_value into sequence_value;

  if sequence_value is null then
    raise exception 'Estimate reference sequence exhausted for year %', reference_year
      using errcode = 'P0001';
  end if;

  new.estimate_reference := concat(
    'HEX_D',
    lpad(mod(reference_year, 100)::text, 2, '0'),
    lpad(sequence_value::text, 3, '0'),
    author_initials
  );

  return new;
end;
$$;

revoke execute on function private.assign_estimate_project_reference()
  from public, anon, authenticated;

drop trigger if exists zz_assign_estimate_project_reference
  on public.estimate_projects;

create trigger zz_assign_estimate_project_reference
  before insert on public.estimate_projects
  for each row
  execute function private.assign_estimate_project_reference();
