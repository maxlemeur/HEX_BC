-- Preserve exactly the quantities accepted by a human across estimate copies.
-- A null or stale snapshot stays null or stale; duplication must not revalidate it.
begin;

do $migration$
declare
  implementation oid := pg_catalog.to_regprocedure(
    'public.duplicate_estimate_version_without_product_id(uuid,boolean)'
  );
  definition text;
  column_anchor text := E'    updated_at,\n    decided_by\n  )\n  select\n    gen_random_uuid(),\n    src.tenant_id,';
  value_anchor text := E'    src.updated_at,\n    src.decided_by\n  from public.takeoff_dpgf_review_decisions src';
begin
  if implementation is null then
    raise exception 'Governed estimate duplication implementation is missing';
  end if;
  definition := pg_catalog.pg_get_functiondef(implementation);
  if (length(definition) - length(replace(definition, column_anchor, ''))) <> length(column_anchor)
    or (length(definition) - length(replace(definition, value_anchor, ''))) <> length(value_anchor) then
    raise exception 'Expected one DPGF review decision copy in governed estimate duplication';
  end if;
  definition := replace(definition, column_anchor,
    E'    updated_at,\n    decided_by,\n    quantity_snapshot\n  )\n  select\n    gen_random_uuid(),\n    src.tenant_id,');
  definition := replace(definition, value_anchor,
    E'    src.updated_at,\n    src.decided_by,\n    src.quantity_snapshot\n  from public.takeoff_dpgf_review_decisions src');
  -- CREATE OR REPLACE preserves the existing owner, ACL and security settings.
  execute definition;
end;
$migration$;

commit;
