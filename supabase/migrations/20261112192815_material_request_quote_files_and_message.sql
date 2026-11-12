-- TI-691: two bounds of 20261112173255_material_request_quotes (Codex review of #279, after its merge).
--  1. The consultation message holds the longest message the screen writes: 300 lines of at most 861 characters each
--     (see MATERIAL_REQUEST_QUOTE_MESSAGE_MAX in quote-contracts.ts) with the opening and closing lines.
--  2. withdraw_material_request_files_for_deletion answers every path of a request in one array value: as a set of rows
--     it stopped at the Data API's 1 000 rows (max_rows), and a request may hold more files across its quotes
--     (12 originals and 10 files per quote). Its return type changes, so it is dropped and created again.

alter table public.material_request_quotes
  drop constraint material_request_quotes_message_check,
  add constraint material_request_quotes_message_check check (char_length(message) between 1 and 262144);

drop function public.withdraw_material_request_files_for_deletion(uuid);

-- The first step of a request's deletion: every file of the request is withdrawn (hidden from every reader, no upload
-- lands at its path any more), those of retained or closed quotes included, and their paths answered so that the
-- application removes their bytes before it deletes the request. As the caller (RLS): a file the caller may not
-- change is not withdrawn, so only the writers of the affaire, who may delete the request itself, reach this.
create function public.withdraw_material_request_files_for_deletion(p_request_id uuid)
returns text[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  paths text[];
begin
  perform pg_catalog.set_config('app.material_request_deleting', p_request_id::text, true);
  with withdrawn as (
    update public.material_request_files file
    set removed_at = pg_catalog.now()
    where file.request_id = p_request_id
    returning file.storage_path
  )
  select coalesce(pg_catalog.array_agg(withdrawn.storage_path order by withdrawn.storage_path), '{}'::text[])
  into paths from withdrawn;
  perform pg_catalog.set_config('app.material_request_deleting', '', true);
  return paths;
end;
$$;

comment on function public.withdraw_material_request_files_for_deletion(uuid) is
  'TI-691: withdraws every file of a request before its deletion (originals and quote files, retained or closed quotes included), as the caller (RLS), and returns their storage paths, all of them in one array, for the removal of their bytes.';

revoke all on function public.withdraw_material_request_files_for_deletion(uuid) from public, anon;
grant execute on function public.withdraw_material_request_files_for_deletion(uuid) to authenticated;
