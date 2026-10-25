-- Lot 3.3 D5: bookkeeping only. Never execute the superseded SQL bodies.
begin;
do $history$
declare
  missing record;
begin
  for missing in select * from (values
    ('20260714120000', 'preserve_assembly_cost_details', '6c8e3467bd46558ddc73f12f2dc79b756ff894ea78511d6f5cba198510970afe'),
    ('20260714134334', 'use_assembly_cost_coefficients', '8f867b2aad533a7d9bf8cf3851489e8cb3c5f4b55637f9f8a14a0d7a2e467c34'),
    ('20260718014058', 'protect_takeoff_replace_with_recovery', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  ) as expected(version, name, sha256)
  loop
    if exists (select 1 from supabase_migrations.schema_migrations h
      where h.name in (missing.name, missing.version || '_' || missing.name)) then
      continue;
    end if;
    if exists (select 1 from supabase_migrations.schema_migrations h where h.version = missing.version) then
      raise exception 'LOT33_HISTORY_VERSION_CONFLICT: %', missing.version;
    end if;
    -- The two populated migrations have been superseded. Check the actual
    -- successor bodies (normalize CRLF from historical remote applications).
    if missing.version <> '20260718014058' then
      if md5(replace((select prosrc from pg_proc where oid =
          'public.replace_estimate_assembly_items(uuid,jsonb)'::regprocedure), E'\r\n', E'\n'))
          is distinct from 'f61dd48d0023fde77519719ff10c01ad'
        or md5(replace((select prosrc from pg_proc where oid =
          'public.insert_estimate_assembly_into_version(uuid,uuid,uuid)'::regprocedure), E'\r\n', E'\n'))
          is distinct from 'e5ee6c9bca61a4687281ef75be94db98' then
        raise exception 'LOT33_HISTORY_SUCCESSOR_DRIFT';
      end if;
      if (select count(distinct case
          when h.name like '%add_assembly_supply_type' then 'replace'
          when h.name like '%estimate_engine_v3_entry_paths' then 'insert' end)
          from supabase_migrations.schema_migrations h) <> 2 then
        raise exception 'LOT33_HISTORY_SUCCESSOR_RECEIPT_MISSING';
      end if;
    end if;
    insert into supabase_migrations.schema_migrations(version, name, statements)
    values (missing.version, missing.version || '_' || missing.name, array[
      format('-- Lot 3.3 history reconciliation only; original SQL NOT executed. Source SHA-256: %s. Superseded by add_assembly_supply_type and estimate_engine_v3_entry_paths; protect_takeoff_replace_with_recovery is empty.', missing.sha256)
    ]);
  end loop;
end;
$history$;
-- Duplicate historical names are deliberately retained as audit evidence.
commit;
