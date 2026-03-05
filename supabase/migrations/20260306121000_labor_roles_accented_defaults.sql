-- Normalize legacy default labor role names to accented French labels.
-- Keep user-defined hourly rates unchanged.

drop table if exists _labor_role_rename_pairs;

create temporary table _labor_role_rename_pairs on commit drop as
with renames(old_name, new_name) as (
  values
    ('Macon', 'Maçon'),
    ('Electricien', 'Électricien')
)
select
  old_role.id as old_id,
  new_role.id as new_id
from renames r
join public.labor_roles old_role
  on old_role.name = r.old_name
join public.labor_roles new_role
  on new_role.tenant_id = old_role.tenant_id
 and new_role.user_id = old_role.user_id
 and new_role.name = r.new_name;

update public.estimate_items ei
set labor_role_id = rp.new_id
from _labor_role_rename_pairs rp
where ei.labor_role_id = rp.old_id;

update public.estimate_items ei
set labor_role_atelier_id = rp.new_id
from _labor_role_rename_pairs rp
where ei.labor_role_atelier_id = rp.old_id;

update public.estimate_items ei
set labor_role_chantier_id = rp.new_id
from _labor_role_rename_pairs rp
where ei.labor_role_chantier_id = rp.old_id;

update public.estimate_template_items eti
set labor_role_id = rp.new_id
from _labor_role_rename_pairs rp
where eti.labor_role_id = rp.old_id;

update public.estimate_template_items eti
set labor_role_atelier_id = rp.new_id
from _labor_role_rename_pairs rp
where eti.labor_role_atelier_id = rp.old_id;

update public.estimate_template_items eti
set labor_role_chantier_id = rp.new_id
from _labor_role_rename_pairs rp
where eti.labor_role_chantier_id = rp.old_id;

update public.estimate_assembly_items eai
set labor_role_id = rp.new_id
from _labor_role_rename_pairs rp
where eai.labor_role_id = rp.old_id;

update public.estimate_suggestion_rules esr
set labor_role_id = rp.new_id
from _labor_role_rename_pairs rp
where esr.labor_role_id = rp.old_id;

delete from public.labor_roles lr
using _labor_role_rename_pairs rp
where lr.id = rp.old_id;

with renames(old_name, new_name) as (
  values
    ('Macon', 'Maçon'),
    ('Electricien', 'Électricien')
)
update public.labor_roles lr
set name = r.new_name
from renames r
where lr.name = r.old_name
  and not exists (
    select 1
    from public.labor_roles existing
    where existing.tenant_id = lr.tenant_id
      and existing.user_id = lr.user_id
      and existing.name = r.new_name
  );
