-- Migration S1 (BC-001 + BC-003): harden RLS for estimate/devis domain.

alter table if exists public.purchase_order_devis enable row level security;
alter table if exists public.estimate_projects enable row level security;
alter table if exists public.estimate_versions enable row level security;
alter table if exists public.estimate_items enable row level security;
alter table if exists public.estimate_categories enable row level security;
alter table if exists public.labor_roles enable row level security;
alter table if exists public.estimate_suggestion_rules enable row level security;

alter table if exists public.purchase_order_devis force row level security;
alter table if exists public.estimate_projects force row level security;
alter table if exists public.estimate_versions force row level security;
alter table if exists public.estimate_items force row level security;
alter table if exists public.estimate_categories force row level security;
alter table if exists public.labor_roles force row level security;
alter table if exists public.estimate_suggestion_rules force row level security;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'purchase_order_devis',
        'estimate_projects',
        'estimate_versions',
        'estimate_items',
        'estimate_categories',
        'labor_roles',
        'estimate_suggestion_rules'
      )
  loop
    execute format(
      'drop policy if exists %I on public.%I;',
      policy_record.policyname,
      policy_record.tablename
    );
  end loop;
end
$$;

create policy "Users can manage purchase order devis"
  on public.purchase_order_devis
  for all
  to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.purchase_orders po
      where po.id = purchase_order_devis.purchase_order_id
        and po.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.purchase_orders po
      where po.id = purchase_order_devis.purchase_order_id
        and po.user_id = (select auth.uid())
    )
  );

create policy "Users can manage estimate projects"
  on public.estimate_projects
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users can manage estimate versions"
  on public.estimate_versions
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_projects p
      where p.id = estimate_versions.project_id
        and p.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_projects p
      where p.id = estimate_versions.project_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "Users can view estimate items"
  on public.estimate_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_items.version_id
        and p.user_id = (select auth.uid())
    )
  );

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
        and p.user_id = (select auth.uid())
        and v.status = 'draft'
    )
    and (
      estimate_items.category_id is null
      or exists (
        select 1
        from public.estimate_categories c
        where c.id = estimate_items.category_id
          and c.user_id = (select auth.uid())
      )
    )
    and (
      estimate_items.labor_role_id is null
      or exists (
        select 1
        from public.labor_roles lr
        where lr.id = estimate_items.labor_role_id
          and lr.user_id = (select auth.uid())
      )
    )
    and (
      estimate_items.parent_id is null
      or exists (
        select 1
        from public.estimate_items parent_item
        where parent_item.id = estimate_items.parent_id
          and parent_item.version_id = estimate_items.version_id
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
        and p.user_id = (select auth.uid())
        and v.status = 'draft'
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_items.version_id
        and p.user_id = (select auth.uid())
        and v.status = 'draft'
    )
    and (
      estimate_items.category_id is null
      or exists (
        select 1
        from public.estimate_categories c
        where c.id = estimate_items.category_id
          and c.user_id = (select auth.uid())
      )
    )
    and (
      estimate_items.labor_role_id is null
      or exists (
        select 1
        from public.labor_roles lr
        where lr.id = estimate_items.labor_role_id
          and lr.user_id = (select auth.uid())
      )
    )
    and (
      estimate_items.parent_id is null
      or exists (
        select 1
        from public.estimate_items parent_item
        where parent_item.id = estimate_items.parent_id
          and parent_item.version_id = estimate_items.version_id
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
        and p.user_id = (select auth.uid())
        and v.status = 'draft'
    )
  );

create policy "Users can manage estimate categories"
  on public.estimate_categories
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users can manage labor roles"
  on public.labor_roles
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users can manage estimate suggestion rules"
  on public.estimate_suggestion_rules
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (
      category_id is null
      or exists (
        select 1
        from public.estimate_categories c
        where c.id = estimate_suggestion_rules.category_id
          and c.user_id = (select auth.uid())
      )
    )
    and (
      labor_role_id is null
      or exists (
        select 1
        from public.labor_roles lr
        where lr.id = estimate_suggestion_rules.labor_role_id
          and lr.user_id = (select auth.uid())
      )
    )
  );
