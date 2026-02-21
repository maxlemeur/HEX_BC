-- Migration S4 (BC-006): add estimate audit trail and admin read access.

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references public.profiles(id) on delete set null,
  table_name text not null,
  record_id uuid not null,
  estimate_version_id uuid references public.estimate_versions(id) on delete set null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  before_data jsonb,
  after_data jsonb
);

create index if not exists audit_logs_created_at_idx
  on public.audit_logs (created_at desc);
create index if not exists audit_logs_table_name_idx
  on public.audit_logs (table_name);
create index if not exists audit_logs_estimate_version_id_idx
  on public.audit_logs (estimate_version_id);
create index if not exists audit_logs_user_id_idx
  on public.audit_logs (user_id);

alter table public.audit_logs enable row level security;

drop policy if exists "Admins can view audit logs" on public.audit_logs;

create policy "Admins can view audit logs"
  on public.audit_logs
  for select
  to authenticated
  using ((select public.is_admin_user()));

create or replace function public.log_estimate_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  target_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  target_record_id uuid;
  target_project_id uuid;
  target_version_id uuid;
  target_row_user_id uuid;
begin
  target_record_id := coalesce(
    nullif(target_new->>'id', '')::uuid,
    nullif(target_old->>'id', '')::uuid
  );

  target_version_id := coalesce(
    case
      when tg_table_name = 'estimate_versions'
      then nullif(target_new->>'id', '')::uuid
      else nullif(target_new->>'version_id', '')::uuid
    end,
    case
      when tg_table_name = 'estimate_versions'
      then nullif(target_old->>'id', '')::uuid
      else nullif(target_old->>'version_id', '')::uuid
    end
  );

  target_project_id := coalesce(
    nullif(target_new->>'project_id', '')::uuid,
    nullif(target_old->>'project_id', '')::uuid
  );

  target_row_user_id := coalesce(
    nullif(target_new->>'user_id', '')::uuid,
    nullif(target_old->>'user_id', '')::uuid
  );

  if target_row_user_id is null then
    if tg_table_name = 'estimate_versions' and target_project_id is not null then
      select p.user_id
        into target_row_user_id
      from public.estimate_projects p
      where p.id = target_project_id;
    elsif tg_table_name = 'estimate_items' and target_version_id is not null then
      select p.user_id
        into target_row_user_id
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = target_version_id;
    end if;
  end if;

  insert into public.audit_logs (
    user_id,
    table_name,
    record_id,
    estimate_version_id,
    action,
    before_data,
    after_data
  )
  values (
    coalesce((select auth.uid()), target_row_user_id),
    tg_table_name,
    target_record_id,
    target_version_id,
    tg_op,
    target_old,
    target_new
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists estimate_projects_audit_trigger on public.estimate_projects;
create trigger estimate_projects_audit_trigger
  after insert or update or delete on public.estimate_projects
  for each row execute procedure public.log_estimate_audit();

drop trigger if exists estimate_versions_audit_trigger on public.estimate_versions;
create trigger estimate_versions_audit_trigger
  after insert or update or delete on public.estimate_versions
  for each row execute procedure public.log_estimate_audit();

drop trigger if exists estimate_items_audit_trigger on public.estimate_items;
create trigger estimate_items_audit_trigger
  after insert or update or delete on public.estimate_items
  for each row execute procedure public.log_estimate_audit();

drop trigger if exists estimate_categories_audit_trigger on public.estimate_categories;
create trigger estimate_categories_audit_trigger
  after insert or update or delete on public.estimate_categories
  for each row execute procedure public.log_estimate_audit();

drop trigger if exists labor_roles_audit_trigger on public.labor_roles;
create trigger labor_roles_audit_trigger
  after insert or update or delete on public.labor_roles
  for each row execute procedure public.log_estimate_audit();

drop trigger if exists estimate_suggestion_rules_audit_trigger on public.estimate_suggestion_rules;
create trigger estimate_suggestion_rules_audit_trigger
  after insert or update or delete on public.estimate_suggestion_rules
  for each row execute procedure public.log_estimate_audit();
