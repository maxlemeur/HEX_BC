-- Seed default BTP labor roles for existing estimate owners with no labor roles yet.

with target_owners as (
  select distinct ep.tenant_id, ep.user_id
  from public.estimate_projects ep
  where exists (
    select 1
    from public.profiles p
    where p.id = ep.user_id
  )
    and not exists (
      select 1
      from public.labor_roles lr
      where lr.tenant_id = ep.tenant_id
        and lr.user_id = ep.user_id
    )
),
default_roles(name, position) as (
  values
    ('Macon', 1),
    ('Electricien', 2),
    ('Plombier', 3),
    ('Chauffagiste', 4),
    ('Menuisier', 5),
    ('Plaquiste', 6),
    ('Carreleur', 7),
    ('Peintre', 8),
    ('Couvreur', 9)
)
insert into public.labor_roles (
  tenant_id,
  user_id,
  name,
  hourly_rate_cents,
  is_active,
  position
)
select
  o.tenant_id,
  o.user_id,
  r.name,
  0,
  true,
  r.position
from target_owners o
cross join default_roles r
on conflict (tenant_id, user_id, name) do nothing;
