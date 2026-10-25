-- Runs only on the owned disposable stack via verify-shared-base-upgrade.ts.
-- Reproduce the shared-only legacy columns, connected triggers, missing guard,
-- orphan function and historical holes before applying the exact migrations.
drop trigger guard_estimate_approvals_insert_trigger on public.estimate_approvals;
drop function public.guard_estimate_approvals_insert();
drop trigger set_estimate_explanations_scope on public.estimate_explanations;
drop function public.assign_estimate_explanations_scope();
drop trigger set_estimate_explanations_updated_at on public.estimate_explanations;
create function public.set_estimate_explanation_scope_defaults() returns trigger
language plpgsql security definer set search_path = public as $$begin return new; end;$$;
create trigger set_estimate_explanation_scope_defaults before insert or update
on public.estimate_explanations for each row execute function public.set_estimate_explanation_scope_defaults();
create function public.assign_estimate_template_item_tenant_id() returns trigger
language plpgsql as $$begin return new; end;$$;
alter table public.estimate_explanation_sources
  add column tenant_id uuid not null, add column project_id uuid not null,
  add column version_id uuid not null, add column line_id uuid,
  add column source_type text not null, add column source_label text not null,
  add column display_rank integer not null default 0;
-- Recreate the existing compatibility sync from its canonical, conditional migration.
\ir ../../migrations/20260307181000_est394_explanation_sources_legacy_contract_sync.sql
delete from supabase_migrations.schema_migrations where name in (
  'preserve_assembly_cost_details','use_assembly_cost_coefficients','protect_takeoff_replace_with_recovery',
  '20260714120000_preserve_assembly_cost_details','20260714134334_use_assembly_cost_coefficients',
  '20260718014058_protect_takeoff_replace_with_recovery');
insert into supabase_migrations.schema_migrations(version,name,statements)
values ('20260101000000','lot33_historical_duplicate',array['-- preserve duplicate 1']),
  ('20260101000001','lot33_historical_duplicate',array['-- preserve duplicate 2']);
create temporary table lot33_existing_history as select * from supabase_migrations.schema_migrations;
create temporary table lot33_writer_bodies as select oid,prosrc from pg_proc where oid in (
  'public.replace_estimate_assembly_items(uuid,jsonb)'::regprocedure,
  'public.insert_estimate_assembly_into_version(uuid,uuid,uuid)'::regprocedure);

\ir ../../migrations/20261025112108_consolidate_shared_catalog.sql
\ir ../../migrations/20261025112109_restrict_public_function_execution.sql
\ir ../../migrations/20261025112146_reconcile_shared_migration_history.sql

do $$
begin
  if exists (select * from lot33_existing_history except select * from supabase_migrations.schema_migrations)
    or (select count(*) from supabase_migrations.schema_migrations)
      <> (select count(*) + 3 from lot33_existing_history) then
    raise exception 'History reconciliation changed old evidence or did not add exactly three rows';
  end if;
  if exists (select 1 from lot33_writer_bodies b join pg_proc p using(oid) where b.prosrc <> p.prosrc) then
    raise exception 'History reconciliation replayed a writer';
  end if;
  if to_regprocedure('public.assign_estimate_template_item_tenant_id()') is not null
    or to_regprocedure('public.set_estimate_explanation_scope_defaults()') is not null then
    raise exception 'Obsolete functions survived';
  end if;
  if has_function_privilege('anon','public.set_estimate_explanation_source_scope_defaults()','execute') then
    raise exception 'Legacy source scope remains anonymous';
  end if;
end;
$$;
-- Reapply once to prove repairs and history insertion are idempotent.
\ir ../../migrations/20261025112108_consolidate_shared_catalog.sql
\ir ../../migrations/20261025112109_restrict_public_function_execution.sql
\ir ../../migrations/20261025112146_reconcile_shared_migration_history.sql
do $$begin
  if (select count(*) from supabase_migrations.schema_migrations)
    <> (select count(*) + 3 from lot33_existing_history) then
    raise exception 'Repeated reconciliation duplicated history';
  end if;
end;$$;

-- The same real-role assertions now run against the upgraded legacy schema.
\ir ../database/shared-base-consolidation.test.sql
\echo LOT33_UPGRADE_PASSED
