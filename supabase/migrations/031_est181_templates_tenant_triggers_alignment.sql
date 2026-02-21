-- EST-181 alignment: ensure template tenant triggers use assign_tenant_id().

create or replace function public.assign_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_tenant_id uuid;
begin
  if tg_table_name = 'purchase_order_items' then
    select po.tenant_id
      into parent_tenant_id
    from public.purchase_orders po
    where po.id = new.purchase_order_id;
  elsif tg_table_name = 'purchase_order_devis' then
    select po.tenant_id
      into parent_tenant_id
    from public.purchase_orders po
    where po.id = new.purchase_order_id;
  elsif tg_table_name = 'estimate_versions' then
    select ep.tenant_id
      into parent_tenant_id
    from public.estimate_projects ep
    where ep.id = new.project_id;
  elsif tg_table_name = 'estimate_items' then
    select ev.tenant_id
      into parent_tenant_id
    from public.estimate_versions ev
    where ev.id = new.version_id;
  elsif tg_table_name = 'estimate_templates' and new.tenant_id is null then
    parent_tenant_id := public.current_tenant_id();
  elsif tg_table_name = 'estimate_template_items' then
    select et.tenant_id
      into parent_tenant_id
    from public.estimate_templates et
    where et.id = new.template_id;
  elsif tg_table_name = 'audit_logs' and new.estimate_version_id is not null then
    select ev.tenant_id
      into parent_tenant_id
    from public.estimate_versions ev
    where ev.id = new.estimate_version_id;
  elsif tg_table_name = 'dpgf_rows_raw' then
    select di.tenant_id
      into parent_tenant_id
    from public.dpgf_imports di
    where di.id = new.import_id;
  elsif tg_table_name = 'dpgf_rows_mapped' then
    select di.tenant_id
      into parent_tenant_id
    from public.dpgf_imports di
    where di.id = new.import_id;

    if parent_tenant_id is null and new.raw_row_id is not null then
      select drr.tenant_id
        into parent_tenant_id
      from public.dpgf_rows_raw drr
      where drr.id = new.raw_row_id;
    end if;
  elsif tg_table_name = 'dpgf_mappings' then
    select di.tenant_id
      into parent_tenant_id
    from public.dpgf_imports di
    where di.id = new.import_id;
  end if;

  if parent_tenant_id is not null then
    new.tenant_id := parent_tenant_id;
  elsif new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

drop trigger if exists set_estimate_templates_tenant_id on public.estimate_templates;
create trigger set_estimate_templates_tenant_id
  before insert or update on public.estimate_templates
  for each row execute procedure public.assign_tenant_id();

drop trigger if exists set_estimate_template_items_tenant_id on public.estimate_template_items;
create trigger set_estimate_template_items_tenant_id
  before insert or update on public.estimate_template_items
  for each row execute procedure public.assign_tenant_id();
