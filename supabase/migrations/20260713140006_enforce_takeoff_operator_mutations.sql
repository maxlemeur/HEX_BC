-- Preserve viewer read access while requiring an active operator role for
-- shared takeoff, reconciliation, risk, suggestion, plan, and Storage writes.

create or replace function public.enforce_plan_file_storage_identity()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  canonical_path text;
begin
  if tg_op = 'INSERT' then
    canonical_path := new.tenant_id::text
      || '/' || new.plan_set_id::text
      || '/' || new.id::text
      || '/' || new.file_name;

    if new.file_path is distinct from canonical_path
      or new.file_name is distinct from btrim(new.file_name)
      or new.file_name ~ '[\\/]'
      or lower(right(new.file_name, 4)) <> '.pdf'
    then
      raise exception 'PLAN_FILE_STORAGE_PATH_INVALID' using errcode = '42501';
    end if;

    return new;
  end if;

  if new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.plan_set_id is distinct from old.plan_set_id
    or new.file_path is distinct from old.file_path
    or new.file_name is distinct from old.file_name
  then
    raise exception 'PLAN_FILE_STORAGE_IDENTITY_IMMUTABLE' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_plan_file_storage_identity()
  from public;

drop trigger if exists aaa_enforce_plan_file_storage_identity
  on public.plan_files;
create trigger aaa_enforce_plan_file_storage_identity
  before insert or update on public.plan_files
  for each row execute function public.enforce_plan_file_storage_identity();

drop policy if exists "Operators can update takeoff items"
  on public.takeoff_items;
create policy "Operators can update takeoff items"
  on public.takeoff_items
  as restrictive
  for update
  to authenticated
  using (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  )
  with check (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );

drop policy if exists "Operators can insert takeoff dpgf links"
  on public.takeoff_dpgf_links;
create policy "Operators can insert takeoff dpgf links"
  on public.takeoff_dpgf_links
  as restrictive
  for insert
  to authenticated
  with check (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );

drop policy if exists "Operators can update takeoff dpgf links"
  on public.takeoff_dpgf_links;
create policy "Operators can update takeoff dpgf links"
  on public.takeoff_dpgf_links
  as restrictive
  for update
  to authenticated
  using (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  )
  with check (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );

drop policy if exists "Operators can delete takeoff dpgf links"
  on public.takeoff_dpgf_links;
create policy "Operators can delete takeoff dpgf links"
  on public.takeoff_dpgf_links
  as restrictive
  for delete
  to authenticated
  using (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );

drop policy if exists "Operators can insert takeoff dpgf review decisions"
  on public.takeoff_dpgf_review_decisions;
create policy "Operators can insert takeoff dpgf review decisions"
  on public.takeoff_dpgf_review_decisions
  as restrictive
  for insert
  to authenticated
  with check (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );

drop policy if exists "Operators can update takeoff dpgf review decisions"
  on public.takeoff_dpgf_review_decisions;
create policy "Operators can update takeoff dpgf review decisions"
  on public.takeoff_dpgf_review_decisions
  as restrictive
  for update
  to authenticated
  using (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  )
  with check (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );

drop policy if exists "Operators can delete takeoff dpgf review decisions"
  on public.takeoff_dpgf_review_decisions;
create policy "Operators can delete takeoff dpgf review decisions"
  on public.takeoff_dpgf_review_decisions
  as restrictive
  for delete
  to authenticated
  using (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );

drop policy if exists "Operators can insert takeoff price suggestions"
  on public.takeoff_price_suggestions;
create policy "Operators can insert takeoff price suggestions"
  on public.takeoff_price_suggestions
  as restrictive
  for insert
  to authenticated
  with check (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );

drop policy if exists "Operators can update takeoff price suggestions"
  on public.takeoff_price_suggestions;
create policy "Operators can update takeoff price suggestions"
  on public.takeoff_price_suggestions
  as restrictive
  for update
  to authenticated
  using (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  )
  with check (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );

drop policy if exists "Operators can update estimate risk alerts"
  on public.estimate_risk_alerts;
create policy "Operators can update estimate risk alerts"
  on public.estimate_risk_alerts
  as restrictive
  for update
  to authenticated
  using (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  )
  with check (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );

drop policy if exists "Operators can insert plan sets" on public.plan_sets;
create policy "Operators can insert plan sets"
  on public.plan_sets
  as restrictive
  for insert
  to authenticated
  with check (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );

drop policy if exists "Operators can update plan sets" on public.plan_sets;
create policy "Operators can update plan sets"
  on public.plan_sets
  as restrictive
  for update
  to authenticated
  using (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  )
  with check (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );

drop policy if exists "Operators can delete plan sets" on public.plan_sets;
create policy "Operators can delete plan sets"
  on public.plan_sets
  as restrictive
  for delete
  to authenticated
  using (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );

drop policy if exists "Operators can insert plan files" on public.plan_files;
create policy "Operators can insert plan files"
  on public.plan_files
  as restrictive
  for insert
  to authenticated
  with check (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );

drop policy if exists "Operators can update plan files" on public.plan_files;
create policy "Operators can update plan files"
  on public.plan_files
  as restrictive
  for update
  to authenticated
  using (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  )
  with check (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );

drop policy if exists "Operators can delete plan files" on public.plan_files;
create policy "Operators can delete plan files"
  on public.plan_files
  as restrictive
  for delete
  to authenticated
  using (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );

drop policy if exists "Authorized operators can update takeoff storage"
  on storage.objects;
create policy "Authorized operators can update takeoff storage"
  on storage.objects
  as restrictive
  for update
  to authenticated
  using (
    bucket_id <> 'takeoff-files'
    or exists (
      select 1
      from public.takeoff_jobs tj
      where tj.tenant_id = (select public.current_tenant_id())
        and tj.id::text = coalesce((storage.foldername(storage.objects.name))[2], '')
        and tj.source_file_path = storage.objects.name
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
        and (select public.has_tenant_role(
          tj.tenant_id,
          array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
        ))
    )
  )
  with check (
    bucket_id <> 'takeoff-files'
    or exists (
      select 1
      from public.takeoff_jobs tj
      where tj.tenant_id = (select public.current_tenant_id())
        and tj.id::text = coalesce((storage.foldername(storage.objects.name))[2], '')
        and tj.source_file_path = storage.objects.name
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
        and (select public.has_tenant_role(
          tj.tenant_id,
          array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
        ))
    )
  );

drop policy if exists "Authorized operators can delete takeoff storage"
  on storage.objects;
create policy "Authorized operators can delete takeoff storage"
  on storage.objects
  as restrictive
  for delete
  to authenticated
  using (
    bucket_id <> 'takeoff-files'
    or exists (
      select 1
      from public.takeoff_jobs tj
      where tj.tenant_id = (select public.current_tenant_id())
        and tj.id::text = coalesce((storage.foldername(storage.objects.name))[2], '')
        and tj.source_file_path = storage.objects.name
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
        and (select public.has_tenant_role(
          tj.tenant_id,
          array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
        ))
    )
  );

drop policy if exists "Authorized operators can update plan storage"
  on storage.objects;
create policy "Authorized operators can update plan storage"
  on storage.objects
  as restrictive
  for update
  to authenticated
  using (
    bucket_id <> 'plan-files'
    or exists (
      select 1
      from public.plan_files pf
      join public.plan_sets ps
        on ps.id = pf.plan_set_id
       and ps.tenant_id = pf.tenant_id
      where pf.file_path = storage.objects.name
        and pf.tenant_id = (select public.current_tenant_id())
        and (select public.has_tenant_role(
          pf.tenant_id,
          array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
        ))
    )
  )
  with check (
    bucket_id <> 'plan-files'
    or exists (
      select 1
      from public.plan_files pf
      join public.plan_sets ps
        on ps.id = pf.plan_set_id
       and ps.tenant_id = pf.tenant_id
      where pf.file_path = storage.objects.name
        and pf.tenant_id = (select public.current_tenant_id())
        and (select public.has_tenant_role(
          pf.tenant_id,
          array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
        ))
    )
  );

drop policy if exists "Authorized operators can delete plan storage"
  on storage.objects;
create policy "Authorized operators can delete plan storage"
  on storage.objects
  as restrictive
  for delete
  to authenticated
  using (
    bucket_id <> 'plan-files'
    or exists (
      select 1
      from public.plan_files pf
      join public.plan_sets ps
        on ps.id = pf.plan_set_id
       and ps.tenant_id = pf.tenant_id
      where pf.file_path = storage.objects.name
        and pf.tenant_id = (select public.current_tenant_id())
        and (select public.has_tenant_role(
          pf.tenant_id,
          array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
        ))
    )
  );
