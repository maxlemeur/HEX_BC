-- Nested assembly compositions are shared tenant library data. Keep broad
-- tenant read access, but align direct Data API writes with the parent
-- estimate_assemblies / estimate_assembly_items boundary: admin and engineer
-- only. Viewers must not be able to mutate the composition graph.

drop policy if exists "Users insert estimate assembly members"
  on public.estimate_assembly_members;
drop policy if exists "Users update estimate assembly members"
  on public.estimate_assembly_members;
drop policy if exists "Users delete estimate assembly members"
  on public.estimate_assembly_members;
drop policy if exists "Tenant writers insert estimate assembly members"
  on public.estimate_assembly_members;
drop policy if exists "Tenant writers update estimate assembly members"
  on public.estimate_assembly_members;
drop policy if exists "Tenant writers delete estimate assembly members"
  on public.estimate_assembly_members;

create policy "Tenant writers insert estimate assembly members"
  on public.estimate_assembly_members
  for insert
  to authenticated
  with check (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );

create policy "Tenant writers update estimate assembly members"
  on public.estimate_assembly_members
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

create policy "Tenant writers delete estimate assembly members"
  on public.estimate_assembly_members
  for delete
  to authenticated
  using (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );
