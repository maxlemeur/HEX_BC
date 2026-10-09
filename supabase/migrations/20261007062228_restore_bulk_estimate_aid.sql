-- Restore AID only in the deployed post-MO atomic bulk UPDATE.
-- The helper's typed return, joins, locks, CAS, wrappers, owner and ACLs remain
-- unchanged. Canonical installations already writing snapshot.aid are a no-op.
-- Failure modes and the pre-fix HTTP/SQL evidence precede this migration in
-- docs/testing/tiered-bulk-aid.md. No business data is rewritten here.
do $migration$
declare
  implementation_oid oid := to_regprocedure(
    'public.bulk_update_estimate_items_without_line_nature(uuid,jsonb,jsonb,timestamptz)'
  );
  helper_oid oid := to_regprocedure(
    'public.snapshot_estimate_item_bulk_updates(uuid,jsonb)'
  );
  current_definition text;
  helper_definition text;
  old_set text := $old$      title = snapshot.title,
      description = snapshot.description,$old$;
  new_set text := $aid$      title = snapshot.title,
      -- Persist explicit AID updates; preserve omitted historical values.
      aid = case
        when requested.payload ? 'aid'
          then nullif(upper(btrim(requested.payload->>'aid')), '')
        else item.aid
      end,
      description = snapshot.description,$aid$;
  canonical_set text := $canonical$      title = snapshot.title,
      aid = snapshot.aid,
      description = snapshot.description,$canonical$;
  canonical_helper text := $canonical$      when requested.payload ? 'aid'
        then nullif(upper(btrim(requested.payload->>'aid')), '')
      else item.aid
    end as aid,$canonical$;
  payload_join text := $join$    join jsonb_array_elements(item_updates) as requested(payload)
      on snapshot.id = (requested.payload->>'id')::uuid$join$;
begin
  if implementation_oid is null or helper_oid is null
    or to_regprocedure('public.bulk_update_estimate_items(uuid,jsonb,jsonb,timestamptz)') is null
    or to_regprocedure('public.bulk_update_estimate_items_without_product_id(uuid,jsonb,jsonb,timestamptz)') is null
  then
    raise exception using
      errcode = '42883',
      message = 'Expected atomic estimate bulk chain is missing';
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
  ) or not exists (
    select 1
    from pg_attribute column_definition
    where column_definition.attrelid = 'public.estimate_items'::regclass
      and column_definition.attname = 'aid'
      and not column_definition.attisdropped
      and not column_definition.attnotnull
      and column_definition.atttypid = 'text'::regtype
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Unexpected estimate bulk AID contract';
  end if;

  current_definition := replace(
    pg_get_functiondef(implementation_oid), E'\r\n', E'\n'
  );
  helper_definition := replace(
    pg_get_functiondef(helper_oid), E'\r\n', E'\n'
  );

  -- Preserve the already complete canonical implementation and typed helper.
  if strpos(current_definition, canonical_set) > 0
    and strpos(helper_definition, canonical_helper) > 0
  then
    return;
  end if;

  -- Only the post-MO core with its existing payload join can be extended.
  if strpos(current_definition, payload_join) = 0
    or strpos(current_definition, 'h_mo_atelier = case') = 0
    or strpos(current_definition, 'k_mo_atelier = case') = 0
    or strpos(current_definition, 'labor_role_atelier_id = case') = 0
    or strpos(current_definition, 'h_mo_chantier = case') = 0
    or strpos(current_definition, 'k_mo_chantier = case') = 0
    or strpos(current_definition, 'labor_role_chantier_id = case') = 0
  then
    raise exception using
      errcode = 'P0001',
      message = 'Expected post-MO atomic estimate bulk body is missing';
  end if;

  if strpos(current_definition, new_set) > 0 then
    return;
  end if;

  if strpos(current_definition, 'aid =') > 0
    or length(current_definition) - length(
      replace(current_definition, old_set, '')
    ) <> length(old_set)
  then
    raise exception using
      errcode = 'P0001',
      message = 'Unexpected atomic estimate bulk AID body';
  end if;

  execute replace(current_definition, old_set, new_set);
end;
$migration$;
