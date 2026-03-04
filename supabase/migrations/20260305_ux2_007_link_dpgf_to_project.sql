-- UX2-007: lier les imports DPGF a un projet estimate (optionnel).

alter table public.dpgf_imports
  add column if not exists project_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dpgf_imports_project_id_fkey'
      and conrelid = 'public.dpgf_imports'::regclass
  ) then
    alter table public.dpgf_imports
      add constraint dpgf_imports_project_id_fkey
      foreign key (project_id)
      references public.estimate_projects(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists dpgf_imports_tenant_project_created_at_idx
  on public.dpgf_imports (tenant_id, project_id, created_at desc)
  where project_id is not null;

create index if not exists dpgf_imports_project_id_idx
  on public.dpgf_imports (project_id)
  where project_id is not null;

drop policy if exists "Users can manage own dpgf imports" on public.dpgf_imports;

create policy "Users can manage own dpgf imports"
  on public.dpgf_imports
  for all
  to authenticated
  using (
    (select public.is_tenant_member(tenant_id))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
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
            or (select public.has_tenant_role(p.tenant_id, array['admin'::public.tenant_role]))
          )
      )
    )
  )
  with check (
    (select public.is_tenant_member(tenant_id))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
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
            or (select public.has_tenant_role(p.tenant_id, array['admin'::public.tenant_role]))
          )
      )
    )
  );
