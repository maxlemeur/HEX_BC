-- The product-link facade renamed the governed implementation on 2026-08-25.
-- PL/pgSQL's implicit parameter block now has that internal function name, but
-- its body still qualifies source_version_id with the previous name (42P01).
-- Preserve the deployed implementation and all of its security/ACL settings;
-- change only the stale qualification. The product facade remains untouched.
do $migration$
declare
  implementation_oid oid := pg_catalog.to_regprocedure(
    'public.duplicate_estimate_version_without_product_id(uuid,boolean)'
  );
  original_definition text;
  repaired_definition text;
begin
  if implementation_oid is null then
    raise exception using
      errcode = '42883',
      message = 'Expected governed estimate duplication implementation is missing';
  end if;

  original_definition := pg_catalog.pg_get_functiondef(implementation_oid);
  repaired_definition := pg_catalog.replace(
    original_definition,
    'duplicate_estimate_version.',
    'duplicate_estimate_version_without_product_id.'
  );

  if repaired_definition is distinct from original_definition then
    execute repaired_definition;
  end if;
end;
$migration$;
