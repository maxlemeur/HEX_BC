-- TKF-001 follow-up: tighten takeoff authorization and enforce job tenant consistency.

create or replace function public.assign_takeoff_jobs_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_tenant_id uuid;
begin
  if new.estimate_version_id is not null then
    select ev.tenant_id
      into parent_tenant_id
    from public.estimate_versions ev
    where ev.id = new.estimate_version_id;
  end if;

  if parent_tenant_id is not null then
    new.tenant_id := parent_tenant_id;
  elsif new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

create or replace function public.can_access_takeoff_estimate_version(
  target_estimate_version_id uuid,
  target_tenant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    target_estimate_version_id is not null
    and target_tenant_id is not null
    and exists (
      select 1
      from public.estimate_versions ev
      join public.estimate_projects p on p.id = ev.project_id
      where ev.id = target_estimate_version_id
        and ev.tenant_id = target_tenant_id
        and p.tenant_id = ev.tenant_id
        and (select public.is_tenant_member(p.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(p.tenant_id, array['admin'::public.tenant_role]))
        )
    );
$$;

grant execute on function public.can_access_takeoff_estimate_version(uuid, uuid) to authenticated;

-- Normalize potential historical inconsistencies from earlier trigger behavior.
update public.takeoff_jobs tj
set tenant_id = ev.tenant_id
from public.estimate_versions ev
where ev.id = tj.estimate_version_id
  and tj.tenant_id is distinct from ev.tenant_id;

update public.takeoff_results tr
set tenant_id = tj.tenant_id
from public.takeoff_jobs tj
where tj.id = tr.job_id
  and tr.tenant_id is distinct from tj.tenant_id;

update public.takeoff_items ti
set tenant_id = tj.tenant_id
from public.takeoff_jobs tj
where tj.id = ti.job_id
  and ti.tenant_id is distinct from tj.tenant_id;

drop trigger if exists set_takeoff_jobs_tenant_id on public.takeoff_jobs;
create trigger set_takeoff_jobs_tenant_id
  before insert or update on public.takeoff_jobs
  for each row execute procedure public.assign_takeoff_jobs_tenant_id();

drop policy if exists "Current tenant can select takeoff jobs" on public.takeoff_jobs;
drop policy if exists "Current tenant can insert takeoff jobs" on public.takeoff_jobs;
drop policy if exists "Current tenant can update takeoff jobs" on public.takeoff_jobs;
drop policy if exists "Current tenant can delete takeoff jobs" on public.takeoff_jobs;

create policy "Current tenant can select takeoff jobs"
  on public.takeoff_jobs
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(estimate_version_id, tenant_id))
  );

create policy "Current tenant can insert takeoff jobs"
  on public.takeoff_jobs
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(estimate_version_id, tenant_id))
  );

create policy "Current tenant can update takeoff jobs"
  on public.takeoff_jobs
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(estimate_version_id, tenant_id))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(estimate_version_id, tenant_id))
  );

create policy "Current tenant can delete takeoff jobs"
  on public.takeoff_jobs
  for delete
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(estimate_version_id, tenant_id))
  );

drop policy if exists "Current tenant can select takeoff results" on public.takeoff_results;
drop policy if exists "Current tenant can insert takeoff results" on public.takeoff_results;
drop policy if exists "Current tenant can update takeoff results" on public.takeoff_results;
drop policy if exists "Current tenant can delete takeoff results" on public.takeoff_results;

create policy "Current tenant can select takeoff results"
  on public.takeoff_results
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_results.job_id
        and tj.tenant_id = takeoff_results.tenant_id
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
  );

create policy "Current tenant can insert takeoff results"
  on public.takeoff_results
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_results.job_id
        and tj.tenant_id = takeoff_results.tenant_id
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
  );

create policy "Current tenant can update takeoff results"
  on public.takeoff_results
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_results.job_id
        and tj.tenant_id = takeoff_results.tenant_id
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_results.job_id
        and tj.tenant_id = takeoff_results.tenant_id
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
  );

create policy "Current tenant can delete takeoff results"
  on public.takeoff_results
  for delete
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_results.job_id
        and tj.tenant_id = takeoff_results.tenant_id
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
  );

drop policy if exists "Current tenant can select takeoff items" on public.takeoff_items;
drop policy if exists "Current tenant can insert takeoff items" on public.takeoff_items;
drop policy if exists "Current tenant can update takeoff items" on public.takeoff_items;
drop policy if exists "Current tenant can delete takeoff items" on public.takeoff_items;

create policy "Current tenant can select takeoff items"
  on public.takeoff_items
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_items.job_id
        and tj.tenant_id = takeoff_items.tenant_id
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
    and (
      takeoff_items.result_id is null
      or exists (
        select 1
        from public.takeoff_results tr
        where tr.id = takeoff_items.result_id
          and tr.tenant_id = takeoff_items.tenant_id
          and tr.job_id = takeoff_items.job_id
      )
    )
  );

create policy "Current tenant can insert takeoff items"
  on public.takeoff_items
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_items.job_id
        and tj.tenant_id = takeoff_items.tenant_id
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
    and (
      takeoff_items.result_id is null
      or exists (
        select 1
        from public.takeoff_results tr
        where tr.id = takeoff_items.result_id
          and tr.tenant_id = takeoff_items.tenant_id
          and tr.job_id = takeoff_items.job_id
      )
    )
  );

create policy "Current tenant can update takeoff items"
  on public.takeoff_items
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_items.job_id
        and tj.tenant_id = takeoff_items.tenant_id
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
    and (
      takeoff_items.result_id is null
      or exists (
        select 1
        from public.takeoff_results tr
        where tr.id = takeoff_items.result_id
          and tr.tenant_id = takeoff_items.tenant_id
          and tr.job_id = takeoff_items.job_id
      )
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_items.job_id
        and tj.tenant_id = takeoff_items.tenant_id
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
    and (
      takeoff_items.result_id is null
      or exists (
        select 1
        from public.takeoff_results tr
        where tr.id = takeoff_items.result_id
          and tr.tenant_id = takeoff_items.tenant_id
          and tr.job_id = takeoff_items.job_id
      )
    )
  );

create policy "Current tenant can delete takeoff items"
  on public.takeoff_items
  for delete
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_items.job_id
        and tj.tenant_id = takeoff_items.tenant_id
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
    and (
      takeoff_items.result_id is null
      or exists (
        select 1
        from public.takeoff_results tr
        where tr.id = takeoff_items.result_id
          and tr.tenant_id = takeoff_items.tenant_id
          and tr.job_id = takeoff_items.job_id
      )
    )
  );
