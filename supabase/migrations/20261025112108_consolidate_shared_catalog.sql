-- Lot 3.3 D1: restore canonical guards without replaying historical writers.
begin;

create or replace function public.guard_estimate_approvals_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'pending' then
    if new.approved_by is not null or new.decided_at is not null then
      raise exception using errcode = '23514',
        message = 'ESTIMATE_APPROVAL_PENDING_INVALID',
        detail = 'pending approvals cannot carry approved_by/decided_at.';
    end if;
  else
    if new.status not in ('approved', 'rejected') then
      raise exception using errcode = '22023',
        message = 'ESTIMATE_APPROVAL_STATUS_INVALID';
    end if;
    if new.decided_at is null or new.approved_by is null then
      raise exception using errcode = '23514',
        message = 'ESTIMATE_APPROVAL_DECISION_INVALID',
        detail = 'approved/rejected approvals must carry approved_by and decided_at on insert.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_estimate_approvals_insert_trigger on public.estimate_approvals;
create trigger guard_estimate_approvals_insert_trigger
  before insert on public.estimate_approvals
  for each row execute function public.guard_estimate_approvals_insert();

-- Same invoker scope and updated_at triggers as a fresh database. Replace the
-- shared-only explanation trigger, preserving its scope and timestamp behavior.
create or replace function public.assign_estimate_explanations_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_project_id uuid;
  v_tenant_id uuid;
begin
  select ev.project_id, ev.tenant_id into v_project_id, v_tenant_id
  from public.estimate_versions ev where ev.id = new.version_id;
  if v_project_id is not null then
    new.project_id := v_project_id;
  end if;
  if v_tenant_id is not null then
    new.tenant_id := v_tenant_id;
  elsif new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;
  return new;
end;
$$;

drop trigger if exists set_estimate_explanation_scope_defaults on public.estimate_explanations;
drop trigger if exists set_estimate_explanations_scope on public.estimate_explanations;
create trigger set_estimate_explanations_scope
  before insert or update on public.estimate_explanations
  for each row execute function public.assign_estimate_explanations_scope();
drop trigger if exists set_estimate_explanations_updated_at on public.estimate_explanations;
create trigger set_estimate_explanations_updated_at
  before update on public.estimate_explanations
  for each row execute function public.set_updated_at();
-- RESTRICT is intentional: an unexpected dependency must abort, never cascade.
drop function if exists public.set_estimate_explanation_scope_defaults();
drop function if exists public.assign_estimate_template_item_tenant_id();

-- The shared source table still has legacy NOT NULL scope columns. Its trigger
-- is required there; the canonical fresh table stores only explanation_id.
-- Keep that compatibility branch versioned, like the legacy source_* sync in
-- 20260307181000. Do not add unused legacy columns to fresh databases.
do $legacy$
begin
  if (select count(*) = 4 from information_schema.columns
      where table_schema = 'public' and table_name = 'estimate_explanation_sources'
        and column_name in ('tenant_id', 'project_id', 'version_id', 'line_id')) then
    execute $sql$
      create or replace function public.set_estimate_explanation_source_scope_defaults()
      returns trigger language plpgsql security definer set search_path = ''
      as $function$
      declare
        scoped_explanation public.estimate_explanations%rowtype;
      begin
        select * into scoped_explanation from public.estimate_explanations
        where id = new.explanation_id;
        if scoped_explanation.id is null then
          raise exception 'Estimate explanation % is invalid for source scope.', new.explanation_id;
        end if;
        new.tenant_id := scoped_explanation.tenant_id;
        new.project_id := scoped_explanation.project_id;
        new.version_id := scoped_explanation.version_id;
        new.line_id := scoped_explanation.line_id;
        return new;
      end;
      $function$
    $sql$;
    execute 'drop trigger if exists set_estimate_explanation_source_scope_defaults on public.estimate_explanation_sources';
    execute 'create trigger set_estimate_explanation_source_scope_defaults before insert or update on public.estimate_explanation_sources for each row execute function public.set_estimate_explanation_source_scope_defaults()';
    execute 'revoke execute on function public.set_estimate_explanation_source_scope_defaults() from public, anon';
  end if;
end;
$legacy$;

-- process_takeoff_job calls this RPC with its server-side service-role key.
-- Never read real secrets during migration or put their values in the receipt.
create extension if not exists supabase_vault with schema vault;
create or replace function public.get_takeoff_secret(secret_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret_value text;
begin
  select decrypted_secret into secret_value from vault.decrypted_secrets
  where name = secret_name limit 1;
  return secret_value;
end;
$$;
revoke all on function public.get_takeoff_secret(text) from public, anon, authenticated;
grant execute on function public.get_takeoff_secret(text) to service_role;

notify pgrst, 'reload schema';
commit;
