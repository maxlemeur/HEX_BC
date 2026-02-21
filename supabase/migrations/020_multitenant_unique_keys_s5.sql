-- Migration S5: scope unique keys by tenant for multi-tenant users.

alter table public.estimate_categories
  drop constraint if exists estimate_categories_user_id_name_key;

alter table public.estimate_categories
  add constraint estimate_categories_tenant_user_name_key
  unique (tenant_id, user_id, name);

alter table public.labor_roles
  drop constraint if exists labor_roles_user_id_name_key;

alter table public.labor_roles
  add constraint labor_roles_tenant_user_name_key
  unique (tenant_id, user_id, name);

alter table public.mapping_templates
  drop constraint if exists mapping_templates_user_id_name_key;

alter table public.mapping_templates
  add constraint mapping_templates_tenant_user_name_key
  unique (tenant_id, user_id, name);
