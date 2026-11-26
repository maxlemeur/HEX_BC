begin;
set local lock_timeout = '5s';

-- A company chooses the short codes of its references (« multicouche » gives MEC) so they stay short. The
-- application owns the list of terms; the database bounds their shape, so a new term needs no migration.
-- A format now starts with a prefix that begins with a letter: spreadsheets drop the leading zeros of a
-- code made of digits. Stored settings are left as they are; the rule applies to the next save.
create or replace function public.set_tenant_product_reference_naming(p_tenant_id uuid, p_naming jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  family text;
  pattern text;
  abbreviations jsonb;
  term text;
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
    or p_naming - array['enabled', 'patterns', 'abbreviations'] <> '{}'::jsonb
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
      or pattern !~ '^[A-Z][A-Z0-9]{0,15}-'
    then
      raise invalid_parameter_value using message = 'TENANT_PRODUCT_REFERENCE_NAMING_INVALID';
    end if;
  end loop;

  if p_naming ? 'abbreviations' then
    abbreviations := p_naming->'abbreviations';
    if jsonb_typeof(abbreviations) is distinct from 'object'
      or (select count(*) from jsonb_object_keys(abbreviations)) > 100
    then
      raise invalid_parameter_value using message = 'TENANT_PRODUCT_REFERENCE_NAMING_INVALID';
    end if;
    for term in select jsonb_object_keys(abbreviations) loop
      if term !~ '^[a-z][a-z0-9_]{0,39}$'
        or jsonb_typeof(abbreviations->term) is distinct from 'string'
        or (abbreviations->>term) !~ '^[A-Z0-9]{1,16}$'
      then
        raise invalid_parameter_value using message = 'TENANT_PRODUCT_REFERENCE_NAMING_INVALID';
      end if;
    end loop;
  end if;

  insert into public.tenant_catalogue_policies(tenant_id, product_reference_naming, updated_by, updated_at)
  values (p_tenant_id, p_naming, actor, statement_timestamp())
  on conflict (tenant_id) do update
    set product_reference_naming = excluded.product_reference_naming,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return p_naming;
end;
$$;

comment on column public.tenant_catalogue_policies.product_reference_naming is
  'Optional company override of the default formats and abbreviations for new product references.';

revoke all on function public.set_tenant_product_reference_naming(uuid, jsonb) from public, anon;
grant execute on function public.set_tenant_product_reference_naming(uuid, jsonb) to authenticated;

commit;
