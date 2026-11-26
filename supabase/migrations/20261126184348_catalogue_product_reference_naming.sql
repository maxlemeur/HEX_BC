begin;
set local lock_timeout = '5s';

alter table public.tenant_catalogue_policies add column product_reference_naming jsonb;
-- Existing products receive NULL. Enforce the rule for new writes without a scan under the DDL lock.
alter table public.products
  add column workbook_source_reference text,
  add constraint products_workbook_source_reference_check
    check (workbook_source_reference is null or char_length(btrim(workbook_source_reference)) between 1 and 255) not valid;

comment on column public.tenant_catalogue_policies.product_reference_naming is
  'Optional company override of the default formats for new product references.';
comment on column public.products.workbook_source_reference is
  'Original code of the costing workbook line. It is provenance and can be shared by several products.';

create function public.set_tenant_product_reference_naming(p_tenant_id uuid, p_naming jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  family text;
  pattern text;
begin
  if actor is null or p_tenant_id is null
    or p_tenant_id is distinct from public.current_tenant_id()
    or not public.has_tenant_role(p_tenant_id, array['admin'::public.tenant_role])
  then
    raise insufficient_privilege using message = 'TENANT_PRODUCT_REFERENCE_NAMING_ADMIN_ONLY';
  end if;

  if jsonb_typeof(p_naming) is distinct from 'object'
    or jsonb_typeof(p_naming->'enabled') is distinct from 'boolean'
    or jsonb_typeof(p_naming->'patterns') is distinct from 'object'
    or p_naming - array['enabled', 'patterns'] <> '{}'::jsonb
    or (p_naming->'patterns') - array['tube', 'coude', 'reduction', 'vanne'] <> '{}'::jsonb
  then
    raise invalid_parameter_value using message = 'TENANT_PRODUCT_REFERENCE_NAMING_INVALID';
  end if;

  foreach family in array array['tube', 'coude', 'reduction', 'vanne'] loop
    pattern := p_naming->'patterns'->>family;
    if jsonb_typeof(p_naming->'patterns'->family) is distinct from 'string'
      or char_length(pattern) > 100
      or pattern !~ '^([A-Z0-9]{1,16}|[{](matiere|dimension|variante|angle|pression|epaisseur)[}])(-([A-Z0-9]{1,16}|[{](matiere|dimension|variante|angle|pression|epaisseur)[}]))*$'
      or not ('{dimension}' = any(string_to_array(pattern, '-')))
      or pattern !~ '(^|-)[A-Z0-9]{1,16}(-|$)'
    then
      raise invalid_parameter_value using message = 'TENANT_PRODUCT_REFERENCE_NAMING_INVALID';
    end if;
  end loop;

  insert into public.tenant_catalogue_policies(tenant_id, product_reference_naming, updated_by, updated_at)
  values (p_tenant_id, p_naming, actor, statement_timestamp())
  on conflict (tenant_id) do update
    set product_reference_naming = excluded.product_reference_naming,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return p_naming;
end;
$$;

revoke all on function public.set_tenant_product_reference_naming(uuid, jsonb) from public, anon;
grant execute on function public.set_tenant_product_reference_naming(uuid, jsonb) to authenticated;

commit;
