-- Serialize storage deletion with import/reclassification. The token is released
-- on handled failures. An interrupted process leaves a visible reservation for
-- investigation rather than risking deletion of a newly restored copy.
alter table public.affaire_intake_documents add column deletion_token uuid;

create function public.guard_intake_document_deletion() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if old.deletion_token is not null and new.deletion_token is not distinct from old.deletion_token
     and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception 'INTAKE_DOCUMENT_DELETION_IN_PROGRESS';
  end if;
  if old.deleted_at is not null and new.deleted_at is not null
     and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception 'INTAKE_DOCUMENT_DELETED';
  end if;
  return new;
end;
$$;
create trigger guard_intake_document_deletion before update on public.affaire_intake_documents
  for each row execute function public.guard_intake_document_deletion();
revoke all on function public.guard_intake_document_deletion() from public, anon, authenticated;

create function public.guard_intake_plan_copy_lifecycle() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare source_row record;
begin
  if new.metadata ->> 'source' = 'affaire-intake' then
    select deleted_at, deletion_token into source_row from public.affaire_intake_documents
      where id = (new.metadata ->> 'intake_document_id')::uuid and tenant_id = new.tenant_id for share;
    if not found or source_row.deleted_at is not null or source_row.deletion_token is not null then
      raise exception 'INTAKE_PLAN_SOURCE_UNAVAILABLE';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_intake_plan_copy_lifecycle before insert or update on public.plan_files
  for each row execute function public.guard_intake_plan_copy_lifecycle();
revoke all on function public.guard_intake_plan_copy_lifecycle() from public, anon, authenticated;
