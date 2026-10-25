-- Test data on the shared base, which is also production's: the tenants whose
-- old drafts a weekly purge removes, and the affaires it must keep. Journeys
-- keep what they create, so without it the designated test tenant only grows.
-- Policy: AGENTS.md ("Runtime and workspaces"), supabase/README.md ("Données de test").
-- Both lists are server-only: they change through a reviewed migration or SQL
-- by the owner, never through the Data API.

create table private.test_data_tenants (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  label text not null check (btrim(label) <> ''),
  retention_days integer not null default 7 check (retention_days between 1 and 90),
  created_at timestamptz not null default now()
);
alter table private.test_data_tenants enable row level security;
revoke all on private.test_data_tenants from public, anon, authenticated, service_role;

create table private.test_data_retained_projects (
  project_id uuid primary key references public.estimate_projects(id) on delete cascade,
  reason text not null check (btrim(reason) <> ''),
  created_at timestamptz not null default now()
);
alter table private.test_data_retained_projects enable row level security;
revoke all on private.test_data_retained_projects from public, anon, authenticated, service_role;

-- The shared base's test tenants on 25/10/2026; absent elsewhere, so a local
-- stack starts with empty lists.
insert into private.test_data_tenants (tenant_id, label)
select tenant.id, seed.label
from (
  values
    ('a8d1292a-bfd1-4a44-9820-dc9536ecad25'::uuid, 'ARMY TesterArmy QA: tenant of the designated E2E account'),
    ('d6012a69-16ad-4cf8-866e-9a37e2f22cb6'::uuid, 'Personal tenant of a deployment-check account (@example.test, 23/10/2026)'),
    ('cba61ccf-d0d8-45d2-b298-d4f88117b120'::uuid, 'Personal tenant of a deployment-check account (@example.test, 25/10/2026)')
) as seed(id, label)
join public.tenants as tenant on tenant.id = seed.id;

-- True when every version of the affaire is a draft and neither it nor its
-- versions changed within the retention. It reads with the calling statement's
-- snapshot, so the purge asks again in a new statement before each delete.
create function private.test_data_project_is_stale(p_project_id uuid, p_retention_days integer)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.estimate_projects as p
    where p.id = p_project_id
      and greatest(p.created_at, p.updated_at)
        < statement_timestamp() - make_interval(days => p_retention_days)
      and not exists (
        select 1
        from public.estimate_versions as v
        where v.project_id = p.id
          and (
            v.status <> 'draft'
            or v.updated_at >= statement_timestamp() - make_interval(days => p_retention_days)
          )
      )
  )
$$;

revoke all on function private.test_data_project_is_stale(uuid, integer)
  from public, anon, authenticated, service_role;

-- Deletes the affaires of the listed tenants whose versions are all drafts and
-- untouched for the tenant's retention, archived ones included, oldest first,
-- at most p_limit per call. A dry run returns the same rows as 'eligible' and
-- deletes nothing. Each delete runs alone, with the switch of
-- public.bulk_delete_draft_affaires that lets the cascade remove the immutable
-- intake and register journals; a failed one is reported and the others go on.
-- A call stops taking new affaires after 4 seconds, under the 8-second API
-- statement timeout, so a timeout never rolls a whole batch back. Storage
-- objects stay, as with the product's own deletion.
-- Caller: GET /api/internal/test-data/purge (src/lib/test-data/purge.ts).
create function public.purge_test_tenant_drafts(
  p_dry_run boolean default true,
  p_limit integer default 200
)
returns table (
  tenant_id uuid,
  project_id uuid,
  outcome text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  delete_succeeded boolean;
begin
  if p_dry_run is null or p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception using errcode = '22023', message = 'INVALID_TEST_DATA_PURGE_INPUT';
  end if;

  for candidate in
    select p.id, p.tenant_id, listed.retention_days
    from public.estimate_projects as p
    join private.test_data_tenants as listed on listed.tenant_id = p.tenant_id
    where private.test_data_project_is_stale(p.id, listed.retention_days)
      and not exists (
        select 1
        from private.test_data_retained_projects as kept
        where kept.project_id = p.id
      )
    order by p.created_at, p.id
    limit p_limit
    for update of p skip locked
  loop
    exit when clock_timestamp() - statement_timestamp() > interval '4 seconds';
    tenant_id := candidate.tenant_id;
    project_id := candidate.id;

    if p_dry_run then
      outcome := 'eligible';
      return next;
      continue;
    end if;

    begin
      -- An edit that committed after the candidate query started keeps its
      -- affaire: lock the versions, then ask again with a fresh snapshot.
      perform 1 from public.estimate_versions as v where v.project_id = candidate.id for update;
      if not private.test_data_project_is_stale(candidate.id, candidate.retention_days) then
        continue;
      end if;
      perform set_config('app.bulk_delete_draft_affaires', 'on', true);
      delete from public.estimate_projects as p
      where p.id = candidate.id
        and p.tenant_id = candidate.tenant_id;
      delete_succeeded := found;
      perform set_config('app.bulk_delete_draft_affaires', 'off', true);
      outcome := case when delete_succeeded then 'deleted' else 'failed' end;
    exception
      when others then
        perform set_config('app.bulk_delete_draft_affaires', 'off', true);
        raise warning 'purge_test_tenant_drafts failed for project %: [%] %',
          candidate.id,
          sqlstate,
          sqlerrm;
        outcome := 'failed';
    end;
    return next;
  end loop;
end;
$$;

revoke all on function public.purge_test_tenant_drafts(boolean, integer) from public, anon, authenticated;
grant execute on function public.purge_test_tenant_drafts(boolean, integer) to service_role;
