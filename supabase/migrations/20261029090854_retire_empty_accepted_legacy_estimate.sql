-- One-time maintenance capability: postgres only, with exact caller-supplied
-- identities and fail-closed checks. Remove this function after the operation.
-- It never disables triggers. The original delete guard is replaced only inside
-- the transaction holding the table lock, for the exact checked target, then
-- restored and verified before returning. No permanent guard change is made.
do $install_legacy_retirement$
begin
  execute $create_legacy_function$
create function private.retire_empty_accepted_legacy_estimate(
  p_tenant_id uuid,
  p_project_id uuid,
  p_version_id uuid,
  p_plan_set_id uuid,
  p_plan_file_id uuid,
  p_expected_event_ids uuid[],
  p_expected_audit_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.estimate_versions%rowtype;
  v_guard_oid oid := 'public.guard_estimate_versions_delete_draft_only()'::regprocedure;
  v_guard_ddl text;
  v_guard_acl aclitem[];
  v_guard_owner oid;
  v_guard_source_hash text;
  v_current_guard_ddl text;
  v_current_guard_acl aclitem[];
  v_current_guard_owner oid;
  v_expected_event_ids uuid[];
  v_expected_audit_ids uuid[];
  v_event_ids uuid[];
  v_audit_ids uuid[];
  v_prior_delete_audit_ids uuid[];
  v_new_delete_audit_ids uuid[];
  v_plan_ids uuid[];
  v_file_ids uuid[];
  v_project_before jsonb;
  v_project_after jsonb;
  v_plan_before jsonb;
  v_plan_after jsonb;
  v_files_before jsonb;
  v_files_after jsonb;
  v_objects_before jsonb;
  v_objects_after jsonb;
  v_audits_before jsonb;
  v_audits_after jsonb;
  v_ref record;
  v_has_reference boolean;
  v_affected integer;
  v_old_lock_timeout text := pg_catalog.current_setting('lock_timeout');
begin
  -- The definer must be the expected owner before any lock or data change.
  if current_user <> 'postgres' or session_user <> 'postgres' or (select auth.uid()) is not null then
    raise exception using errcode = '55000', message = 'LEGACY_RETIRE_OWNER_MISMATCH';
  end if;
  -- VOLATILE inner queries must see the first caller's committed marker after
  -- waiting for the advisory lock; REPEATABLE READ keeps an older snapshot.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '55000', message = 'LEGACY_RETIRE_ISOLATION_MISMATCH';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles r where r.rolname = current_user
    and (r.rolsuper or r.rolbypassrls)) or exists (
      select 1 from pg_catalog.unnest(array[
        'public.estimate_projects'::regclass, 'public.estimate_versions'::regclass,
        'public.estimate_items'::regclass, 'public.plan_sets'::regclass, 'public.plan_files'::regclass,
        'public.estimate_version_events'::regclass, 'public.audit_logs'::regclass, 'storage.objects'::regclass,
        'private.estimate_purchase_receipts'::regclass, 'private.estimate_purchase_transfers'::regclass,
        'private.estimate_source_coverage_events'::regclass
      ]) as checked(relid) where pg_catalog.row_security_active(checked.relid)
  ) then
    raise exception using errcode = '55000', message = 'LEGACY_RETIRE_RLS_SCOPE_INCOMPLETE';
  end if;
  if p_tenant_id is null or p_project_id is null or p_version_id is null
    or p_plan_set_id is null or p_plan_file_id is null
    or p_expected_event_ids is null or p_expected_audit_ids is null
    or pg_catalog.array_position(p_expected_event_ids, null) is not null
    or pg_catalog.array_position(p_expected_audit_ids, null) is not null
    or pg_catalog.cardinality(p_expected_event_ids) <> 1
    or pg_catalog.cardinality(p_expected_audit_ids) < 1 then
    raise exception using errcode = '22023', message = 'LEGACY_RETIRE_INVALID_INPUT';
  end if;
  select pg_catalog.array_agg(id order by id) into v_expected_event_ids
  from pg_catalog.unnest(p_expected_event_ids) as ids(id);
  select pg_catalog.array_agg(id order by id) into v_expected_audit_ids
  from pg_catalog.unnest(p_expected_audit_ids) as ids(id);
  if (select pg_catalog.count(distinct id) from pg_catalog.unnest(v_expected_audit_ids) as ids(id))
      <> pg_catalog.cardinality(v_expected_audit_ids) then
    raise exception using errcode = '22023', message = 'LEGACY_RETIRE_DUPLICATE_AUDIT_ID';
  end if;

  -- Serialize maintenance calls. A second call for the same target then sees
  -- its absence after the first commits and must fail its identity check.
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('retire-empty-accepted-estimate', 0));
  if exists (select 1 from public.audit_logs a
    where a.table_name = 'estimate_version_maintenance' and a.action = 'DELETE'
      and a.after_data ->> 'maintenance_key' = 'retire-empty-accepted-20261029090854') then
    raise exception using errcode = '42501', message = 'LEGACY_RETIRE_ALREADY_CONSUMED';
  end if;
  -- Every legitimate writer and duplicator takes a conflicting lock. This lock
  -- is held until transaction end, including the temporary guard replacement.
  lock table public.estimate_versions in share row exclusive mode nowait;
  -- These journal/receipt identities intentionally have no version FK. Lock
  -- the exact three tables, without waiting, so none can appear after checking.
  lock table private.estimate_purchase_receipts, private.estimate_purchase_transfers,
    private.estimate_source_coverage_events in share row exclusive mode nowait;
  -- Prevent an object from appearing, disappearing or changing metadata after
  -- the snapshot. This does not assert anything about remote object bytes.
  lock table storage.objects in share row exclusive mode nowait;
  -- The application may already hold the project row and then need the
  -- versions table. Never wait on an occupied row while holding our table lock.
  select pg_catalog.to_jsonb(p) into v_project_before from public.estimate_projects p
  where p.id = p_project_id and p.tenant_id = p_tenant_id and not p.is_archived
  for update nowait;
  if not found then
    raise exception using errcode = '22023', message = 'LEGACY_RETIRE_PROJECT_MISMATCH';
  end if;
  select v.* into v_version from public.estimate_versions v
  where v.id = p_version_id and v.tenant_id = p_tenant_id and v.project_id = p_project_id
  for update nowait;
  if not found or v_version.status <> 'accepted'::public.estimate_status
    or v_version.calc_engine_version <> 1 or v_version.seal_hash is not null
    or v_version.seal_payload_version is not null then
    raise exception using errcode = '22023', message = 'LEGACY_RETIRE_TARGET_MISMATCH';
  end if;
  if (select pg_catalog.count(*) from public.estimate_versions v where v.project_id = p_project_id) <> 1
    or exists (select 1 from public.estimate_items i where i.version_id = p_version_id) then
    raise exception using errcode = '22023', message = 'LEGACY_RETIRE_NOT_EMPTY_OR_NOT_SOLE_VERSION';
  end if;

  -- Refuse schema drift that adds another UUID version identity without an FK;
  -- such a reference must be reviewed and locked before this operation.
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')
      and a.attname ~* '(version.*id|id.*version)' and a.atttypid = 'uuid'::regtype
      and not exists (select 1 from pg_catalog.pg_constraint f where f.contype = 'f'
        and f.conrelid = c.oid and f.confrelid = 'public.estimate_versions'::regclass and a.attnum = any(f.conkey))
      and (n.nspname, c.relname, a.attname) not in (
        ('private','estimate_purchase_receipts','source_version_id'),
        ('private','estimate_purchase_transfers','source_version_id'),
        ('private','estimate_source_coverage_events','version_identity')
      )
  ) then
    raise exception using errcode = '55000', message = 'LEGACY_RETIRE_UNREVIEWED_VERSION_COLUMN';
  end if;
  if exists (select 1 from private.estimate_purchase_receipts r where r.source_version_id = p_version_id)
    or exists (select 1 from private.estimate_purchase_transfers t where t.source_version_id = p_version_id)
    or exists (select 1 from private.estimate_source_coverage_events e where e.version_identity = p_version_id) then
    raise exception using errcode = '22023', message = 'LEGACY_RETIRE_UNREVIEWED_REFERENCE';
  end if;

  perform 1 from public.plan_sets ps where ps.id = p_plan_set_id for update nowait;
  select pg_catalog.to_jsonb(ps) - array['estimate_version_id', 'updated_at'] into v_plan_before
  from public.plan_sets ps where ps.id = p_plan_set_id;
  select coalesce(pg_catalog.array_agg(ps.id order by ps.id), '{}'::uuid[]) into v_plan_ids
  from public.plan_sets ps where ps.estimate_version_id = p_version_id;
  if v_plan_ids is distinct from array[p_plan_set_id]::uuid[] or not exists (
    select 1 from public.plan_sets ps where ps.id = p_plan_set_id
      and ps.tenant_id = p_tenant_id and ps.project_id = p_project_id
      and ps.estimate_version_id = p_version_id
  ) then
    raise exception using errcode = '22023', message = 'LEGACY_RETIRE_PLAN_SET_MISMATCH';
  end if;
  perform 1 from public.plan_files pf where pf.plan_set_id = p_plan_set_id order by pf.id for update nowait;
  select coalesce(pg_catalog.array_agg(pf.id order by pf.id), '{}'::uuid[]),
         coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(pf) order by pf.id), '[]'::jsonb)
    into v_file_ids, v_files_before
  from public.plan_files pf where pf.plan_set_id = p_plan_set_id;
  if v_file_ids is distinct from array[p_plan_file_id]::uuid[] or exists (
    select 1 from public.plan_files pf where pf.plan_set_id = p_plan_set_id and pf.tenant_id <> p_tenant_id
  ) then
    raise exception using errcode = '22023', message = 'LEGACY_RETIRE_PLAN_FILE_MISMATCH';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(o) order by o.id), '[]'::jsonb)
    into v_objects_before
  from storage.objects o where o.name in (select pf.file_path from public.plan_files pf where pf.plan_set_id = p_plan_set_id);

  perform 1 from public.estimate_version_events e where e.estimate_version_id = p_version_id order by e.id for update nowait;
  select coalesce(pg_catalog.array_agg(e.id order by e.id), '{}'::uuid[]) into v_event_ids
  from public.estimate_version_events e where e.estimate_version_id = p_version_id and e.tenant_id = p_tenant_id;
  if v_event_ids is distinct from v_expected_event_ids or exists (
    select 1 from public.estimate_version_events e
    where e.estimate_version_id = p_version_id and e.tenant_id <> p_tenant_id
  ) then
    raise exception using errcode = '22023', message = 'LEGACY_RETIRE_EVENT_SET_MISMATCH';
  end if;
  perform 1 from public.audit_logs a where a.estimate_version_id = p_version_id order by a.id for update nowait;
  select coalesce(pg_catalog.array_agg(a.id order by a.id), '{}'::uuid[]),
         coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) - 'estimate_version_id' order by a.id), '[]'::jsonb)
    into v_audit_ids, v_audits_before
  from public.audit_logs a where a.estimate_version_id = p_version_id and a.tenant_id = p_tenant_id;
  if v_audit_ids is distinct from v_expected_audit_ids or exists (
    select 1 from public.audit_logs a where a.estimate_version_id = p_version_id and a.tenant_id <> p_tenant_id
  ) then
    raise exception using errcode = '22023', message = 'LEGACY_RETIRE_AUDIT_SET_MISMATCH';
  end if;
  select coalesce(pg_catalog.array_agg(a.id order by a.id), '{}'::uuid[]) into v_prior_delete_audit_ids
  from public.audit_logs a where a.tenant_id = p_tenant_id and a.table_name = 'estimate_versions'
    and a.record_id = p_version_id and a.action = 'DELETE';
  if exists (
    select 1 from public.estimate_version_events e
    where e.estimate_version_id = p_version_id
      and not exists (
        select 1 from public.audit_logs a where a.id = any(v_audit_ids)
          and a.tenant_id = p_tenant_id and a.table_name = 'estimate_version_events'
          and a.record_id = e.id and a.action = 'INSERT' and a.after_data = pg_catalog.to_jsonb(e)
      )
  ) then
    raise exception using errcode = '22023', message = 'LEGACY_RETIRE_EVENT_AUDIT_MISSING';
  end if;

  -- Refuse every declared version reference except the three reviewed sets.
  for v_ref in
    select n.nspname, c.relname, a.attname
    from pg_catalog.pg_constraint fk
    join pg_catalog.pg_class c on c.oid = fk.conrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join lateral rows from (pg_catalog.unnest(fk.conkey), pg_catalog.unnest(fk.confkey)) k(srcnum, refnum) on true
    join pg_catalog.pg_attribute a on a.attrelid = fk.conrelid and a.attnum = k.srcnum
    join pg_catalog.pg_attribute r on r.attrelid = fk.confrelid and r.attnum = k.refnum
    where fk.contype = 'f' and fk.confrelid = 'public.estimate_versions'::regclass and r.attname = 'id'
  loop
    if (v_ref.nspname, v_ref.relname, v_ref.attname) in (
      ('public', 'audit_logs', 'estimate_version_id'),
      ('public', 'estimate_version_events', 'estimate_version_id'),
      ('public', 'plan_sets', 'estimate_version_id')
    ) then continue; end if;
    execute pg_catalog.format('select exists (select 1 from %I.%I where %I = $1)',
      v_ref.nspname, v_ref.relname, v_ref.attname) into v_has_reference using p_version_id;
    if v_has_reference then
      raise exception using errcode = '22023', message = 'LEGACY_RETIRE_UNREVIEWED_REFERENCE',
        detail = pg_catalog.format('%I.%I.%I', v_ref.nspname, v_ref.relname, v_ref.attname);
    end if;
  end loop;

  -- Events are archived through their existing audit INSERT rows and then
  -- cascade with the version. Refuse any third-party FK that would also move.
  for v_ref in
    select n.nspname, c.relname, a.attname
    from pg_catalog.pg_constraint fk
    join pg_catalog.pg_class c on c.oid = fk.conrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join lateral rows from (pg_catalog.unnest(fk.conkey), pg_catalog.unnest(fk.confkey)) k(srcnum, refnum) on true
    join pg_catalog.pg_attribute a on a.attrelid = fk.conrelid and a.attnum = k.srcnum
    join pg_catalog.pg_attribute r on r.attrelid = fk.confrelid and r.attnum = k.refnum
    where fk.contype = 'f' and fk.confrelid = 'public.estimate_version_events'::regclass and r.attname = 'id'
  loop
    execute pg_catalog.format('select exists (select 1 from %I.%I where %I = any($1))',
      v_ref.nspname, v_ref.relname, v_ref.attname) into v_has_reference using v_event_ids;
    if v_has_reference then
      raise exception using errcode = '22023', message = 'LEGACY_RETIRE_UNREVIEWED_EVENT_REFERENCE',
        detail = pg_catalog.format('%I.%I.%I', v_ref.nspname, v_ref.relname, v_ref.attname);
    end if;
  end loop;

  select pg_catalog.pg_get_functiondef(p.oid), p.proacl, p.proowner, pg_catalog.md5(p.prosrc)
    into v_guard_ddl, v_guard_acl, v_guard_owner, v_guard_source_hash
  from pg_catalog.pg_proc p where p.oid = v_guard_oid;
  if v_guard_source_hash is distinct from '6b7e9273b497fd11847f0c85d00a2fd7'
    or pg_catalog.md5(v_guard_ddl) is distinct from '84c050bbd790875f403d24077ba53395'
    or v_guard_owner is distinct from 'postgres'::regrole::oid
    or v_guard_acl is distinct from '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'::aclitem[]
    or not exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = 'public.estimate_versions'::regclass
      and t.tgname = 'estimate_versions_delete_draft_only_guard' and t.tgfoid = v_guard_oid
      and t.tgenabled = 'O' and t.tgtype = 11 and not t.tgisinternal
      and t.tgqual is null and t.tgnargs = 0) then
    raise exception using errcode = '55000', message = 'LEGACY_RETIRE_GUARD_CHANGED';
  end if;

  update public.plan_sets ps set estimate_version_id = null
  where ps.id = p_plan_set_id and ps.tenant_id = p_tenant_id and ps.project_id = p_project_id
    and ps.estimate_version_id = p_version_id;
  get diagnostics v_affected = row_count;
  if v_affected <> 1 then raise exception using errcode = '40001', message = 'LEGACY_RETIRE_PLAN_CHANGED'; end if;

  -- Catalog DDL is transactional. The write lock makes the transient function
  -- body unobservable by concurrent writers; only this exact checked row and
  -- the definer role receive the exception. All other deletes keep the guard.
  execute pg_catalog.format($ddl$
    create or replace function public.guard_estimate_versions_delete_draft_only()
    returns trigger language plpgsql set search_path = public as $body$
    begin
      if old.status <> 'draft' then
        if current_user = 'postgres' and old.id = %L::uuid and old.tenant_id = %L::uuid
          and old.project_id = %L::uuid and old.calc_engine_version = 1
          and old.status = 'accepted' and old.seal_hash is null and old.seal_payload_version is null then
          return old;
        end if;
        raise exception using errcode = '42501', message = 'ESTIMATE_VERSION_DELETE_DRAFT_ONLY',
          detail = 'Only draft estimate versions can be deleted.';
      end if;
      return old;
    end;
    $body$;
  $ddl$, p_version_id, p_tenant_id, p_project_id);

  delete from public.estimate_versions v where v.id = p_version_id and v.tenant_id = p_tenant_id
    and v.project_id = p_project_id and v.status = 'accepted'::public.estimate_status
    and v.calc_engine_version = 1 and v.seal_hash is null and v.seal_payload_version is null;
  get diagnostics v_affected = row_count;
  if v_affected <> 1 then raise exception using errcode = '40001', message = 'LEGACY_RETIRE_VERSION_CHANGED'; end if;
  execute v_guard_ddl;
  select pg_catalog.pg_get_functiondef(p.oid), p.proacl, p.proowner
    into v_current_guard_ddl, v_current_guard_acl, v_current_guard_owner
  from pg_catalog.pg_proc p where p.oid = v_guard_oid;
  if v_current_guard_ddl is distinct from v_guard_ddl or v_current_guard_acl is distinct from v_guard_acl
    or v_current_guard_owner is distinct from v_guard_owner then
    raise exception using errcode = '55000', message = 'LEGACY_RETIRE_GUARD_RESTORE_FAILED';
  end if;

  -- The existing audit trigger falls back to the project owner when auth.uid()
  -- is null. Identify only the new automatic DELETE entry and mark it as a
  -- system action; never change the actor of any pre-existing audit entry.
  select coalesce(pg_catalog.array_agg(a.id order by a.id), '{}'::uuid[]) into v_new_delete_audit_ids
  from public.audit_logs a where a.tenant_id = p_tenant_id and a.table_name = 'estimate_versions'
    and a.record_id = p_version_id and a.action = 'DELETE' and not (a.id = any(v_prior_delete_audit_ids))
    and a.before_data = pg_catalog.to_jsonb(v_version);
  if pg_catalog.cardinality(v_new_delete_audit_ids) <> 1 then
    raise exception using errcode = '55000', message = 'LEGACY_RETIRE_NEW_AUDIT_MISMATCH';
  end if;
  update public.audit_logs a set user_id = null where a.id = v_new_delete_audit_ids[1]
    and a.tenant_id = p_tenant_id and a.table_name = 'estimate_versions'
    and a.record_id = p_version_id and a.action = 'DELETE';
  get diagnostics v_affected = row_count;
  if v_affected <> 1 then raise exception using errcode = '55000', message = 'LEGACY_RETIRE_NEW_AUDIT_MISMATCH'; end if;

  select pg_catalog.to_jsonb(p) into v_project_after from public.estimate_projects p
  where p.id = p_project_id and p.tenant_id = p_tenant_id;
  select pg_catalog.to_jsonb(ps) - array['estimate_version_id', 'updated_at'] into v_plan_after
  from public.plan_sets ps where ps.id = p_plan_set_id;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(pf) order by pf.id), '[]'::jsonb) into v_files_after
  from public.plan_files pf where pf.plan_set_id = p_plan_set_id;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(o) order by o.id), '[]'::jsonb) into v_objects_after
  from storage.objects o where o.name in (select pf.file_path from public.plan_files pf where pf.plan_set_id = p_plan_set_id);
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) - 'estimate_version_id' order by a.id), '[]'::jsonb)
    into v_audits_after from public.audit_logs a where a.id = any(v_audit_ids);
  if v_project_after is distinct from v_project_before
    or exists (select 1 from public.estimate_versions v where v.id = p_version_id)
    or exists (select 1 from public.estimate_version_events e where e.id = any(v_event_ids))
    or exists (select 1 from public.audit_logs a where a.id = any(v_audit_ids) and a.estimate_version_id is not null)
    or not exists (select 1 from public.plan_sets ps where ps.id = p_plan_set_id and ps.tenant_id = p_tenant_id
      and ps.project_id = p_project_id and ps.estimate_version_id is null)
    or v_plan_after is distinct from v_plan_before or v_files_after is distinct from v_files_before
    or v_objects_after is distinct from v_objects_before
    or v_audits_after is distinct from v_audits_before then
    raise exception using errcode = '40001', message = 'LEGACY_RETIRE_PRESERVATION_FAILED';
  end if;

  -- The ordinary delete trigger preserves its normal audit entry. This explicit
  -- entry records that the operation was postgres maintenance, without inventing
  -- an authenticated human actor; prior event snapshots remain in audit_logs.
  insert into public.audit_logs (tenant_id, user_id, table_name, record_id, estimate_version_id, action, before_data, after_data)
  values (p_tenant_id, null, 'estimate_version_maintenance', p_version_id, null, 'DELETE',
    pg_catalog.jsonb_build_object('project_id', p_project_id, 'plan_set_id', p_plan_set_id,
      'plan_file_id', p_plan_file_id, 'event_ids', v_event_ids, 'prior_audit_ids', v_audit_ids),
    pg_catalog.jsonb_build_object('actor', 'postgres_maintenance', 'operation', 'retire_empty_accepted_estimate',
      'maintenance_key', 'retire-empty-accepted-20261029090854'));
  perform pg_catalog.set_config('lock_timeout', v_old_lock_timeout, true);
  return pg_catalog.jsonb_build_object('deleted_version_id', p_version_id, 'project_id', p_project_id,
    'preserved_plan_set_id', p_plan_set_id, 'preserved_plan_file_id', p_plan_file_id,
    'preserved_event_audits', pg_catalog.cardinality(v_event_ids), 'guard_restored', true);
end;
$$;
  $create_legacy_function$;
  execute 'revoke all on function private.retire_empty_accepted_legacy_estimate(uuid, uuid, uuid, uuid, uuid, uuid[], uuid[]) from public, anon, authenticated, service_role';
end;
$install_legacy_retirement$;
