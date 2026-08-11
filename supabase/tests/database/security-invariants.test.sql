begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

select ok(
  relation.relrowsecurity,
  format('public.%I has row level security enabled', relation.relname)
)
from pg_class as relation
join pg_namespace as namespace on namespace.oid = relation.relnamespace
where namespace.nspname = 'public'
  and relation.relkind in ('r', 'p');

with required_service_role_privileges(privilege_name) as (
  values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
)
select ok(
  has_table_privilege('service_role', relation.oid, required.privilege_name),
  format(
    'service_role keeps %s on public.%I',
    required.privilege_name,
    relation.relname
  )
)
from pg_class as relation
join pg_namespace as namespace on namespace.oid = relation.relnamespace
cross join required_service_role_privileges as required
where namespace.nspname = 'public'
  and relation.relkind in ('r', 'p');

select ok(
  coalesce(relation.reloptions @> array['security_invoker=true'], false)
    or (
      not has_table_privilege('anon', relation.oid, 'SELECT')
      and not has_table_privilege('authenticated', relation.oid, 'SELECT')
    ),
  format('public.%I is security invoker or revoked from Data API roles', relation.relname)
)
from pg_class as relation
join pg_namespace as namespace on namespace.oid = relation.relnamespace
where namespace.nspname = 'public'
  and relation.relkind in ('v', 'm');

select ok(
  exists (
    select 1
    from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting
    where setting like 'search_path=%'
  ),
  format(
    'security definer function public.%I(%s) pins search_path',
    procedure.proname,
    pg_get_function_identity_arguments(procedure.oid)
  )
)
from pg_proc as procedure
join pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.prosecdef;

select ok(
  (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass),
  'storage.objects has row level security enabled'
);

with expected_buckets(bucket_id) as (
  values
    ('affaire-intake'),
    ('devis'),
    ('dpgf-imports'),
    ('estimate-documents'),
    ('plan-files'),
    ('takeoff-files')
)
select ok(
  bucket.id is not null and not bucket.public,
  format('storage bucket %s exists and is private', expected.bucket_id)
)
from expected_buckets as expected
left join storage.buckets as bucket on bucket.id = expected.bucket_id;

with expected_buckets(bucket_id) as (
  values
    ('affaire-intake'),
    ('devis'),
    ('dpgf-imports'),
    ('estimate-documents'),
    ('plan-files'),
    ('takeoff-files')
)
select ok(
  exists (
    select 1
    from pg_policies as policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and (
        coalesce(policy.qual, '') || ' ' || coalesce(policy.with_check, '')
      ) like '%' || quote_literal(expected.bucket_id) || '%'
  ),
  format('storage bucket %s has an object policy', expected.bucket_id)
)
from expected_buckets as expected;

-- Relation privileges are a prerequisite to RLS. Keep this allowlist aligned
-- with the behavioral matrix and avoid granting authenticated access to every
-- public table, because several relations are intentionally server-only.
with expected_authenticated_grants(table_name, privilege_name) as (
  values
    ('estimate_projects', 'SELECT'),
    ('estimate_projects', 'INSERT'),
    ('estimate_projects', 'UPDATE'),
    ('estimate_projects', 'DELETE'),
    ('estimate_versions', 'SELECT'),
    ('estimate_versions', 'INSERT'),
    ('estimate_versions', 'UPDATE'),
    ('estimate_versions', 'DELETE'),
    ('estimate_items', 'SELECT'),
    ('estimate_items', 'INSERT'),
    ('estimate_items', 'UPDATE'),
    ('estimate_items', 'DELETE'),
    ('estimate_categories', 'SELECT'),
    ('estimate_categories', 'INSERT'),
    ('estimate_categories', 'UPDATE'),
    ('estimate_categories', 'DELETE'),
    ('labor_roles', 'SELECT'),
    ('labor_roles', 'INSERT'),
    ('labor_roles', 'UPDATE'),
    ('labor_roles', 'DELETE'),
    ('estimate_suggestion_rules', 'SELECT'),
    ('estimate_suggestion_rules', 'INSERT'),
    ('estimate_suggestion_rules', 'UPDATE'),
    ('estimate_suggestion_rules', 'DELETE'),
    ('audit_logs', 'SELECT'),
    ('audit_logs', 'INSERT'),
    ('plan_sets', 'SELECT'),
    ('plan_sets', 'INSERT'),
    ('plan_sets', 'UPDATE'),
    ('plan_sets', 'DELETE'),
    ('plan_files', 'SELECT'),
    ('plan_files', 'INSERT'),
    ('plan_files', 'UPDATE'),
    ('plan_files', 'DELETE'),
    ('takeoff_jobs', 'SELECT'),
    ('takeoff_jobs', 'INSERT'),
    ('takeoff_jobs', 'UPDATE'),
    ('takeoff_jobs', 'DELETE'),
    ('takeoff_items', 'SELECT'),
    ('takeoff_items', 'UPDATE'),
    ('takeoff_results', 'SELECT')
)
select ok(
  has_table_privilege(
    'authenticated',
    format('public.%I', expected.table_name),
    expected.privilege_name
  ),
  format(
    'authenticated keeps %s on public.%I before RLS evaluation',
    expected.privilege_name,
    expected.table_name
  )
)
from expected_authenticated_grants as expected;

with authenticated_data_api_tables(table_name) as (
  values
    ('estimate_projects'),
    ('estimate_versions'),
    ('estimate_items'),
    ('estimate_categories'),
    ('labor_roles'),
    ('estimate_suggestion_rules'),
    ('audit_logs'),
    ('plan_sets'),
    ('plan_files'),
    ('takeoff_jobs'),
    ('takeoff_items'),
    ('takeoff_results')
),
forbidden_authenticated_grants(privilege_name) as (
  values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
)
select ok(
  not has_table_privilege(
    'authenticated',
    format('public.%I', expected_table.table_name),
    expected_privilege.privilege_name
  ),
  format(
    'authenticated does not receive %s on public.%I',
    expected_privilege.privilege_name,
    expected_table.table_name
  )
)
from authenticated_data_api_tables as expected_table
cross join forbidden_authenticated_grants as expected_privilege;

with forbidden_authenticated_dml(table_name, privilege_name) as (
  values
    ('audit_logs', 'UPDATE'),
    ('audit_logs', 'DELETE'),
    ('takeoff_items', 'INSERT'),
    ('takeoff_items', 'DELETE'),
    ('takeoff_results', 'INSERT'),
    ('takeoff_results', 'UPDATE'),
    ('takeoff_results', 'DELETE')
)
select ok(
  not has_table_privilege(
    'authenticated',
    format('public.%I', expected.table_name),
    expected.privilege_name
  ),
  format(
    'authenticated does not receive %s on public.%I',
    expected.privilege_name,
    expected.table_name
  )
)
from forbidden_authenticated_dml as expected;

with expected_restrictive_policies(table_name, policy_name, command_name) as (
  values
    ('estimate_projects', 'Operators can insert estimate rows', 'INSERT'),
    ('estimate_projects', 'Operators can update estimate rows', 'UPDATE'),
    ('estimate_projects', 'Governed estimate project deletes', 'DELETE'),
    ('estimate_versions', 'Operators can insert estimate rows', 'INSERT'),
    ('estimate_versions', 'Operators can update estimate rows', 'UPDATE'),
    ('estimate_versions', 'Operators can delete estimate rows', 'DELETE'),
    ('estimate_categories', 'Operators can insert estimate rows', 'INSERT'),
    ('estimate_categories', 'Operators can update estimate rows', 'UPDATE'),
    ('estimate_categories', 'Operators can delete estimate rows', 'DELETE'),
    ('labor_roles', 'Operators can insert estimate rows', 'INSERT'),
    ('labor_roles', 'Operators can update estimate rows', 'UPDATE'),
    ('labor_roles', 'Operators can delete estimate rows', 'DELETE'),
    ('estimate_suggestion_rules', 'Operators can insert estimate rows', 'INSERT'),
    ('estimate_suggestion_rules', 'Operators can update estimate rows', 'UPDATE'),
    ('estimate_suggestion_rules', 'Operators can delete estimate rows', 'DELETE'),
    ('plan_sets', 'Operators can insert plan sets', 'INSERT'),
    ('plan_sets', 'Operators can update plan sets', 'UPDATE'),
    ('plan_sets', 'Operators can delete plan sets', 'DELETE'),
    ('plan_files', 'Operators can insert plan files', 'INSERT'),
    ('plan_files', 'Operators can update plan files', 'UPDATE'),
    ('plan_files', 'Operators can delete plan files', 'DELETE'),
    ('takeoff_jobs', 'Operators can insert takeoff jobs', 'INSERT'),
    ('takeoff_jobs', 'Operators can update takeoff jobs', 'UPDATE'),
    ('takeoff_jobs', 'Operators can delete takeoff jobs', 'DELETE')
)
select ok(
  exists (
    select 1
    from pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = expected.table_name
      and policy.policyname = expected.policy_name
      and upper(policy.permissive) = 'RESTRICTIVE'
      and upper(policy.cmd) = expected.command_name
      and 'authenticated' = any(policy.roles)
  ),
  format(
    'public.%I policy %s is restrictive for authenticated %s',
    expected.table_name,
    expected.policy_name,
    expected.command_name
  )
)
from expected_restrictive_policies as expected;

select ok(
  exists (
    select 1
    from pg_trigger as trigger_definition
    join pg_proc as procedure
      on procedure.oid = trigger_definition.tgfoid
    join pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where trigger_definition.tgrelid = 'public.takeoff_jobs'::regclass
      and trigger_definition.tgname = 'aac_enforce_authenticated_takeoff_job_fields'
      and not trigger_definition.tgisinternal
      and trigger_definition.tgenabled <> 'D'
      and namespace.nspname = 'public'
      and procedure.proname = 'enforce_authenticated_takeoff_job_fields'
  ),
  'authenticated takeoff job field guard remains enabled'
);

select ok(
  exists (
    select 1
    from pg_trigger as trigger_definition
    join pg_proc as procedure
      on procedure.oid = trigger_definition.tgfoid
    join pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where trigger_definition.tgrelid = 'public.takeoff_items'::regclass
      and trigger_definition.tgname = 'aac_enforce_authenticated_takeoff_item_fields'
      and not trigger_definition.tgisinternal
      and trigger_definition.tgenabled <> 'D'
      and namespace.nspname = 'public'
      and procedure.proname = 'enforce_authenticated_takeoff_item_fields'
  ),
  'authenticated takeoff item field guard remains enabled'
);

select ok(
  exists (
    select 1
    from pg_proc as procedure
    where procedure.oid = 'public.apply_takeoff_job_guarded(uuid,text,uuid)'::regprocedure
      and procedure.prosecdef = false
      and position(
        'set_config(''app.takeoff_apply_job'', ''on'', true)'
        in procedure.prosrc
      ) > 0
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting
        where setting = 'search_path=pg_catalog'
      )
  ),
  'guarded takeoff apply RPC is invoker-safe and sets its local boundary marker'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.apply_takeoff_job_guarded(uuid,text,uuid)'::regprocedure,
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.apply_takeoff_job(uuid,text,uuid)'::regprocedure,
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.apply_takeoff_job_guarded(uuid,text,uuid)'::regprocedure,
    'EXECUTE'
  ),
  'guarded takeoff apply RPC is exposed only to authenticated callers'
);

-- CLI 2.109.1 executes these four legacy date-only migrations during reset,
-- but leaves their versions blank in the tracked-history column. Prove their
-- surviving schema effects instead of rewriting deployed filenames.
with expected_indexes(index_name, table_name, key_fragment, predicate_fragment) as (
  values
    ('audit_logs_tenant_table_created_idx', 'audit_logs', '(tenant_id, table_name, created_at desc)', null),
    ('estimate_versions_tenant_project_version_updated_id_idx', 'estimate_versions', '(tenant_id, project_id, version_number desc, updated_at desc, id desc)', null),
    -- PostgreSQL truncates the 64-character source identifier to 63 bytes.
    ('estimate_versions_tenant_project_accepted_version_updated_id_id', 'estimate_versions', '(tenant_id, project_id, version_number desc, updated_at desc, id desc)', 'status = ''accepted'''),
    ('dpgf_imports_tenant_project_created_at_idx', 'dpgf_imports', '(tenant_id, project_id, created_at desc)', 'project_id is not null'),
    ('dpgf_imports_project_id_idx', 'dpgf_imports', '(project_id)', 'project_id is not null'),
    ('mapping_memory_tenant_user_source_idx', 'mapping_memory', '(tenant_id, user_id, source_column)', null),
    ('estimate_projects_tenant_user_created_at_idx', 'estimate_projects', '(tenant_id, user_id, created_at desc)', null),
    ('estimate_projects_tenant_created_at_idx', 'estimate_projects', '(tenant_id, created_at desc)', null),
    ('estimate_versions_tenant_status_project_updated_idx', 'estimate_versions', '(tenant_id, status, project_id, updated_at desc)', 'status = any')
)
select ok(
  index_relation.oid is not null
    and table_relation.relname = expected.table_name
    and position(
      expected.key_fragment
      in lower(regexp_replace(pg_get_indexdef(index_relation.oid), '\s+', ' ', 'g'))
    ) > 0
    and case
      when expected.predicate_fragment is null then index_metadata.indpred is null
      else position(
        expected.predicate_fragment
        in lower(regexp_replace(pg_get_expr(index_metadata.indpred, index_metadata.indrelid), '\s+', ' ', 'g'))
      ) > 0
    end,
  format(
    'legacy index %s keeps its table, keys and predicate [definition=%s predicate=%s]',
    expected.index_name,
    pg_get_indexdef(index_relation.oid),
    pg_get_expr(index_metadata.indpred, index_metadata.indrelid)
  )
)
from expected_indexes as expected
left join pg_class as index_relation
  on index_relation.relname = expected.index_name
  and index_relation.relnamespace = 'public'::regnamespace
left join pg_index as index_metadata
  on index_metadata.indexrelid = index_relation.oid
left join pg_class as table_relation
  on table_relation.oid = index_metadata.indrelid;

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'dpgf_imports'
      and column_name = 'project_id'
      and data_type = 'uuid'
      and is_nullable = 'YES'
  ),
  'legacy DPGF project_id column remains nullable uuid'
);

select ok(
  exists (
    select 1
    from pg_constraint as constraint_definition
    where constraint_definition.conname = 'dpgf_imports_project_id_fkey'
      and constraint_definition.contype = 'f'
      and constraint_definition.conrelid = 'public.dpgf_imports'::regclass
      and constraint_definition.confrelid = 'public.estimate_projects'::regclass
      and constraint_definition.confdeltype = 'n'
      and pg_get_constraintdef(constraint_definition.oid) like
        'FOREIGN KEY (project_id) REFERENCES estimate_projects(id) ON DELETE SET NULL%'
  ),
  'legacy DPGF project foreign key keeps ON DELETE SET NULL'
);

select ok(
  exists (
    select 1
    from pg_constraint as constraint_definition
    where constraint_definition.conname = 'mapping_memory_tenant_user_source_target_key'
      and constraint_definition.contype = 'u'
      and constraint_definition.conrelid = 'public.mapping_memory'::regclass
      and pg_get_constraintdef(constraint_definition.oid) =
        'UNIQUE (tenant_id, user_id, source_column, target_field)'
  ),
  'legacy mapping memory uniqueness remains tenant-aware'
);

with expected_functions(signature) as (
  values
    ('public.get_chiffreur_analytics_kpis(uuid,uuid)'),
    ('public.list_chiffreur_analytics_trend(uuid,uuid,integer)'),
    ('public.list_chiffreur_analytics_owners(uuid)')
)
select ok(
  procedure.oid is not null
    and not procedure.prosecdef
    and procedure.provolatile = 's'
    and has_function_privilege('authenticated', procedure.oid, 'EXECUTE'),
  format('legacy analytics RPC %s remains stable, invoker and executable', expected.signature)
)
from expected_functions as expected
left join pg_proc as procedure
  on procedure.oid = to_regprocedure(expected.signature);

select ok(
  not exists (
    select 1
    from pg_constraint
    where conname = 'mapping_memory_user_id_source_column_target_field_key'
      and conrelid = 'public.mapping_memory'::regclass
  ),
  'obsolete non-tenant mapping memory uniqueness remains absent'
);

select * from finish();
rollback;
