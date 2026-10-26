-- A delayed producer must never attach a plan from a previous intake generation.
create or replace function public.guard_intake_plan_copy_lifecycle() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare source_row public.affaire_intake_documents;
begin
  if new.metadata ->> 'source' = 'affaire-intake' then
    select * into source_row from public.affaire_intake_documents
      where id = (new.metadata ->> 'intake_document_id')::uuid and tenant_id = new.tenant_id for share;
    if not found or source_row.deleted_at is not null or source_row.deletion_token is not null
       or source_row.storage_path is null
       or (new.metadata ->> 'intake_storage_path') is distinct from source_row.storage_path then
      raise exception 'INTAKE_PLAN_SOURCE_UNAVAILABLE';
    end if;
    if tg_op = 'INSERT' and (source_row.upload_status <> 'uploaded'
       or source_row.classification_status <> 'classified' or source_row.document_kind <> 'plans') then
      raise exception 'INTAKE_PLAN_SOURCE_UNAVAILABLE';
    end if;
  end if;
  return new;
end;
$$;
