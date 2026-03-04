-- UX2-017: verrouiller les ecritures estimate_items pour le role viewer.

drop policy if exists "Users can insert draft estimate items" on public.estimate_items;
drop policy if exists "Users can update draft estimate items" on public.estimate_items;
drop policy if exists "Users can delete draft estimate items" on public.estimate_items;

create policy "Users can insert draft estimate items"
  on public.estimate_items
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_items.version_id
        and v.tenant_id = estimate_items.tenant_id
        and v.status = 'draft'
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
        )
        and (
          select public.has_tenant_role(
            v.tenant_id,
            array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
          )
        )
    )
  );

create policy "Users can update draft estimate items"
  on public.estimate_items
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_items.version_id
        and v.tenant_id = estimate_items.tenant_id
        and v.status = 'draft'
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
        )
        and (
          select public.has_tenant_role(
            v.tenant_id,
            array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_items.version_id
        and v.tenant_id = estimate_items.tenant_id
        and v.status = 'draft'
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
        )
        and (
          select public.has_tenant_role(
            v.tenant_id,
            array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
          )
        )
    )
  );

create policy "Users can delete draft estimate items"
  on public.estimate_items
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_items.version_id
        and v.tenant_id = estimate_items.tenant_id
        and v.status = 'draft'
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
        )
        and (
          select public.has_tenant_role(
            v.tenant_id,
            array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
          )
        )
    )
  );
