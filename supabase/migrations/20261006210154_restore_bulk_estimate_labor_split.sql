-- Restore EST-031 split inputs in the existing atomic bulk core.
-- The public facades, helper return type, CAS/locks, RLS, triggers and ACLs
-- remain intact. Replacing the current definition also preserves its OID/owner.
-- Failure modes and the pre-fix reproduction are recorded in
-- docs/testing/tiered-bulk-mosplit.md. This migration does not recalculate money.
do $migration$
declare
  implementation_oid oid := to_regprocedure(
    'public.bulk_update_estimate_items_without_line_nature(uuid,jsonb,jsonb,timestamptz)'
  );
  current_definition text;
  patched_definition text;
  old_set text := '      k_mo = snapshot.k_mo,';
  new_set text := $split$      k_mo = snapshot.k_mo,
      -- Persist EST-031 split inputs in the same atomic line update.
      h_mo_atelier = case
        when requested.payload ? 'h_mo_atelier'
          then (requested.payload->>'h_mo_atelier')::numeric(12,3)
        else item.h_mo_atelier
      end,
      k_mo_atelier = case
        when requested.payload ? 'k_mo_atelier'
          then (requested.payload->>'k_mo_atelier')::numeric(12,3)
        else item.k_mo_atelier
      end,
      labor_role_atelier_id = case
        when requested.payload ? 'labor_role_atelier_id'
          then nullif(requested.payload->>'labor_role_atelier_id', '')::uuid
        else item.labor_role_atelier_id
      end,
      h_mo_chantier = case
        when requested.payload ? 'h_mo_chantier'
          then (requested.payload->>'h_mo_chantier')::numeric(12,3)
        else item.h_mo_chantier
      end,
      k_mo_chantier = case
        when requested.payload ? 'k_mo_chantier'
          then (requested.payload->>'k_mo_chantier')::numeric(12,3)
        else item.k_mo_chantier
      end,
      labor_role_chantier_id = case
        when requested.payload ? 'labor_role_chantier_id'
          then nullif(requested.payload->>'labor_role_chantier_id', '')::uuid
        else item.labor_role_chantier_id
      end,$split$;
  old_from text := $from$      line_total_ttc_cents = snapshot.line_total_ttc_cents
    from _estimate_item_bulk_snapshot snapshot
    where item.id = snapshot.id$from$;
  new_from text := $from$      line_total_ttc_cents = snapshot.line_total_ttc_cents
    from _estimate_item_bulk_snapshot snapshot
    join jsonb_array_elements(item_updates) as requested(payload)
      on snapshot.id = (requested.payload->>'id')::uuid
    where item.id = snapshot.id$from$;
begin
  if implementation_oid is null then
    raise exception using
      errcode = '42883',
      message = 'Expected atomic estimate bulk implementation is missing';
  end if;

  if not exists (
    select 1
    from pg_proc implementation
    join pg_language language on language.oid = implementation.prolang
    where implementation.oid = implementation_oid
      and implementation.prokind = 'f'
      and implementation.prorettype = 'integer'::regtype
      and not implementation.prosecdef
      and language.lanname = 'plpgsql'
      and implementation.proargnames = array[
        'target_version_id', 'item_updates', 'version_patch',
        'expected_version_updated_at'
      ]::text[]
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Unexpected atomic estimate bulk function contract';
  end if;

  if to_regprocedure('public.bulk_update_estimate_items(uuid,jsonb,jsonb,timestamptz)') is null
    or to_regprocedure('public.bulk_update_estimate_items_without_product_id(uuid,jsonb,jsonb,timestamptz)') is null
    or to_regprocedure('public.snapshot_estimate_item_bulk_updates(uuid,jsonb)') is null
  then
    raise exception using
      errcode = '42883',
      message = 'Expected estimate bulk compatibility chain is missing';
  end if;

  if (
    select count(*)
    from pg_attribute column_definition
    where column_definition.attrelid = 'public.estimate_items'::regclass
      and not column_definition.attisdropped
      and column_definition.attname = any(array[
        'h_mo_atelier', 'k_mo_atelier', 'labor_role_atelier_id',
        'h_mo_chantier', 'k_mo_chantier', 'labor_role_chantier_id'
      ])
      and format_type(
        column_definition.atttypid, column_definition.atttypmod
      ) = case
        when column_definition.attname in (
          'labor_role_atelier_id', 'labor_role_chantier_id'
        ) then 'uuid'
        else 'numeric(12,3)'
      end
  ) <> 6 then
    raise exception using
      errcode = 'P0001',
      message = 'Expected estimate labor split column contract is missing';
  end if;

  current_definition := replace(
    pg_get_functiondef(implementation_oid), E'\r\n', E'\n'
  );

  -- A complete previous application is a no-op; partial/unknown bodies fail.
  if strpos(current_definition, new_set) > 0
    and strpos(current_definition, new_from) > 0
  then
    return;
  end if;

  if strpos(current_definition, 'h_mo_atelier') > 0
    or strpos(current_definition, 'k_mo_atelier') > 0
    or strpos(current_definition, 'labor_role_atelier_id') > 0
    or strpos(current_definition, 'h_mo_chantier') > 0
    or strpos(current_definition, 'k_mo_chantier') > 0
    or strpos(current_definition, 'labor_role_chantier_id') > 0
    or length(current_definition) - length(replace(current_definition, old_set, '')) <> length(old_set)
    or length(current_definition) - length(replace(current_definition, old_from, '')) <> length(old_from)
  then
    raise exception using
      errcode = 'P0001',
      message = 'Unexpected atomic estimate bulk implementation body';
  end if;

  patched_definition := replace(
    replace(current_definition, old_set, new_set), old_from, new_from
  );
  execute patched_definition;
end;
$migration$;
