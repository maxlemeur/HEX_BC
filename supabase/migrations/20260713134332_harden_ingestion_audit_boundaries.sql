-- Harden ingestion, parser-adjacent audit, and register mutation boundaries.

-- DPGF imports remain readable to their existing owner/admin audience, but every
-- mutation now requires a current engineer or admin membership.
drop policy if exists "Users can manage own dpgf imports" on public.dpgf_imports;

create policy "Tenant users can select own dpgf imports"
  on public.dpgf_imports
  for select
  to authenticated
  using (
    (select public.is_tenant_member(tenant_id))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(
        tenant_id,
        array['admin'::public.tenant_role]
      ))
    )
    and (
      project_id is null
      or exists (
        select 1
        from public.estimate_projects p
        where p.id = dpgf_imports.project_id
          and p.tenant_id = dpgf_imports.tenant_id
          and (
            p.user_id = (select auth.uid())
            or (select public.has_tenant_role(
              p.tenant_id,
              array['admin'::public.tenant_role]
            ))
          )
      )
    )
  );

create policy "Tenant writers can insert own dpgf imports"
  on public.dpgf_imports
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
    and (
      project_id is null
      or exists (
        select 1
        from public.estimate_projects p
        where p.id = dpgf_imports.project_id
          and p.tenant_id = dpgf_imports.tenant_id
          and (
            p.user_id = (select auth.uid())
            or (select public.has_tenant_role(
              p.tenant_id,
              array['admin'::public.tenant_role]
            ))
          )
      )
    )
  );

create policy "Tenant writers can update own dpgf imports"
  on public.dpgf_imports
  for update
  to authenticated
  using (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(
        tenant_id,
        array['admin'::public.tenant_role]
      ))
    )
  )
  with check (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(
        tenant_id,
        array['admin'::public.tenant_role]
      ))
    )
    and (
      project_id is null
      or exists (
        select 1
        from public.estimate_projects p
        where p.id = dpgf_imports.project_id
          and p.tenant_id = dpgf_imports.tenant_id
          and (
            p.user_id = (select auth.uid())
            or (select public.has_tenant_role(
              p.tenant_id,
              array['admin'::public.tenant_role]
            ))
          )
      )
    )
  );

create policy "Tenant writers can delete own dpgf imports"
  on public.dpgf_imports
  for delete
  to authenticated
  using (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(
        tenant_id,
        array['admin'::public.tenant_role]
      ))
    )
  );

drop policy if exists "Users can manage own dpgf raw rows" on public.dpgf_rows_raw;

create policy "Tenant users can select own dpgf raw rows"
  on public.dpgf_rows_raw
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.dpgf_imports di
      where di.id = dpgf_rows_raw.import_id
        and di.tenant_id = dpgf_rows_raw.tenant_id
        and (
          di.user_id = (select auth.uid())
          or (select public.has_tenant_role(
            di.tenant_id,
            array['admin'::public.tenant_role]
          ))
        )
    )
  );

create policy "Tenant writers can insert own dpgf raw rows"
  on public.dpgf_rows_raw
  for insert
  to authenticated
  with check (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
    and exists (
      select 1
      from public.dpgf_imports di
      where di.id = dpgf_rows_raw.import_id
        and di.tenant_id = dpgf_rows_raw.tenant_id
        and (
          di.user_id = (select auth.uid())
          or (select public.has_tenant_role(
            di.tenant_id,
            array['admin'::public.tenant_role]
          ))
        )
    )
  );

create policy "Tenant writers can update own dpgf raw rows"
  on public.dpgf_rows_raw
  for update
  to authenticated
  using (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
    and exists (
      select 1
      from public.dpgf_imports di
      where di.id = dpgf_rows_raw.import_id
        and di.tenant_id = dpgf_rows_raw.tenant_id
        and (
          di.user_id = (select auth.uid())
          or (select public.has_tenant_role(
            di.tenant_id,
            array['admin'::public.tenant_role]
          ))
        )
    )
  )
  with check (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
    and exists (
      select 1
      from public.dpgf_imports di
      where di.id = dpgf_rows_raw.import_id
        and di.tenant_id = dpgf_rows_raw.tenant_id
        and (
          di.user_id = (select auth.uid())
          or (select public.has_tenant_role(
            di.tenant_id,
            array['admin'::public.tenant_role]
          ))
        )
    )
  );

create policy "Tenant writers can delete own dpgf raw rows"
  on public.dpgf_rows_raw
  for delete
  to authenticated
  using (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
    and exists (
      select 1
      from public.dpgf_imports di
      where di.id = dpgf_rows_raw.import_id
        and di.tenant_id = dpgf_rows_raw.tenant_id
        and (
          di.user_id = (select auth.uid())
          or (select public.has_tenant_role(
            di.tenant_id,
            array['admin'::public.tenant_role]
          ))
        )
    )
  );

drop policy if exists "Users can upload own dpgf imports" on storage.objects;
drop policy if exists "Users can update own dpgf imports" on storage.objects;
drop policy if exists "Users can delete own dpgf imports" on storage.objects;

create policy "Tenant writers can upload own dpgf imports"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'dpgf-imports'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
    and (select public.has_tenant_role(
      (select public.current_tenant_id()),
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );

create policy "Tenant writers can update own dpgf imports storage"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'dpgf-imports'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
    and (select public.has_tenant_role(
      (select public.current_tenant_id()),
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  )
  with check (
    bucket_id = 'dpgf-imports'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
    and (select public.has_tenant_role(
      (select public.current_tenant_id()),
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );

create policy "Tenant writers can delete own dpgf imports storage"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'dpgf-imports'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
    and (select public.has_tenant_role(
      (select public.current_tenant_id()),
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );

-- Intake audit events are append-only at both privilege and trigger layers.
create or replace function public.prevent_affaire_intake_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using message = 'AFFAIRE_INTAKE_EVENTS_IMMUTABLE';
end;
$$;

drop trigger if exists guard_affaire_intake_events_immutable
  on public.affaire_intake_events;
create trigger guard_affaire_intake_events_immutable
  before update or delete on public.affaire_intake_events
  for each row execute procedure public.prevent_affaire_intake_event_mutation();

drop policy if exists "Current tenant can update affaire intake events"
  on public.affaire_intake_events;
drop policy if exists "Current tenant can delete affaire intake events"
  on public.affaire_intake_events;
revoke update, delete on public.affaire_intake_events from authenticated;
revoke execute on function public.prevent_affaire_intake_event_mutation()
  from public, anon, authenticated;

-- Register updates and their immutable event are committed in one database
-- transaction. Direct table UPDATE is no longer an independently callable path.
create or replace function public.update_affaire_register_entry_with_event(
  p_entry_id uuid,
  p_patch jsonb,
  p_event_type text,
  p_reason text default null,
  p_before_payload jsonb default null,
  p_after_payload jsonb default null,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_service_role boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
  current_entry public.affaire_register_entries%rowtype;
  updated_entry public.affaire_register_entries%rowtype;
  allowed_keys constant text[] := array[
    'version_id',
    'source_document_id',
    'kind',
    'code',
    'text',
    'severity',
    'status',
    'origin_kind',
    'scope_type',
    'scope_id',
    'scope_ref',
    'scope_label',
    'source_file_name',
    'sync_key',
    'is_active',
    'metadata'
  ];
begin
  if not is_service_role then
    raise exception using message = 'AFFAIRE_REGISTER_SERVICE_ROLE_REQUIRED';
  end if;

  if jsonb_typeof(coalesce(p_patch, '{}'::jsonb)) <> 'object' then
    raise exception using message = 'AFFAIRE_REGISTER_PATCH_INVALID';
  end if;
  if coalesce(p_patch, '{}'::jsonb) = '{}'::jsonb then
    raise exception using message = 'AFFAIRE_REGISTER_PATCH_EMPTY';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) as patch_keys(key)
    where key <> all (allowed_keys)
  ) then
    raise exception using message = 'AFFAIRE_REGISTER_PATCH_FIELD_FORBIDDEN';
  end if;

  if p_event_type not in (
    'synced',
    'status_changed',
    'follow_up_updated',
    'clarify_with_client_requested',
    'continued_with_hypothesis',
    'revalidation_requested',
    'deactivated',
    'reactivated'
  ) then
    raise exception using message = 'AFFAIRE_REGISTER_EVENT_TYPE_INVALID';
  end if;

  select *
    into current_entry
  from public.affaire_register_entries
  where id = p_entry_id
  for update;

  if current_entry is null then
    raise exception using message = 'AFFAIRE_REGISTER_ENTRY_NOT_FOUND';
  end if;

  update public.affaire_register_entries
  set
    version_id = case
      when p_patch ? 'version_id' then (p_patch ->> 'version_id')::uuid
      else version_id
    end,
    source_document_id = case
      when p_patch ? 'source_document_id' then (p_patch ->> 'source_document_id')::uuid
      else source_document_id
    end,
    kind = case when p_patch ? 'kind' then p_patch ->> 'kind' else kind end,
    code = case when p_patch ? 'code' then p_patch ->> 'code' else code end,
    text = case when p_patch ? 'text' then p_patch ->> 'text' else text end,
    severity = case
      when p_patch ? 'severity' then p_patch ->> 'severity'
      else severity
    end,
    status = case when p_patch ? 'status' then p_patch ->> 'status' else status end,
    origin_kind = case
      when p_patch ? 'origin_kind' then p_patch ->> 'origin_kind'
      else origin_kind
    end,
    scope_type = case
      when p_patch ? 'scope_type' then p_patch ->> 'scope_type'
      else scope_type
    end,
    scope_id = case
      when p_patch ? 'scope_id' then (p_patch ->> 'scope_id')::uuid
      else scope_id
    end,
    scope_ref = case
      when p_patch ? 'scope_ref' then p_patch ->> 'scope_ref'
      else scope_ref
    end,
    scope_label = case
      when p_patch ? 'scope_label' then p_patch ->> 'scope_label'
      else scope_label
    end,
    source_file_name = case
      when p_patch ? 'source_file_name' then p_patch ->> 'source_file_name'
      else source_file_name
    end,
    sync_key = case
      when p_patch ? 'sync_key' then p_patch ->> 'sync_key'
      else sync_key
    end,
    is_active = case
      when p_patch ? 'is_active' then (p_patch ->> 'is_active')::boolean
      else is_active
    end,
    metadata = case
      when p_patch ? 'metadata' then p_patch -> 'metadata'
      else metadata
    end,
    updated_by = p_actor_user_id
  where id = p_entry_id
  returning * into updated_entry;

  insert into public.affaire_register_events (
    entry_id,
    actor_user_id,
    event_type,
    reason,
    before_payload,
    after_payload
  )
  values (
    updated_entry.id,
    p_actor_user_id,
    p_event_type,
    p_reason,
    coalesce(p_before_payload, '{}'::jsonb)
      || jsonb_build_object('_entry_state', to_jsonb(current_entry)),
    coalesce(p_after_payload, '{}'::jsonb)
      || jsonb_build_object('_entry_state', to_jsonb(updated_entry))
  );

  return to_jsonb(updated_entry);
end;
$$;

revoke execute on function public.update_affaire_register_entry_with_event(
  uuid,
  jsonb,
  text,
  text,
  jsonb,
  jsonb,
  uuid
) from public, anon, authenticated;
grant execute on function public.update_affaire_register_entry_with_event(
  uuid,
  jsonb,
  text,
  text,
  jsonb,
  jsonb,
  uuid
) to service_role;

drop policy if exists "Current tenant can update affaire register entries"
  on public.affaire_register_entries;
drop policy if exists "Current tenant can delete affaire register entries"
  on public.affaire_register_entries;
revoke update, delete on public.affaire_register_entries from authenticated;
