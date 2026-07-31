create or replace function public.bulk_delete_draft_affaires(
  p_tenant_id uuid,
  p_project_ids uuid[]
)
returns table (
  project_id uuid,
  outcome text,
  message text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_project_id uuid;
  locked_project_id uuid;
  locked_is_archived boolean;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  if p_tenant_id is null
    or p_project_ids is null
    or cardinality(p_project_ids) < 1
    or cardinality(p_project_ids) > 100
    or array_position(p_project_ids, null) is not null
  then
    raise exception using errcode = '22023', message = 'INVALID_BULK_DELETE_INPUT';
  end if;

  if not coalesce(
    (select public.has_tenant_role(
      p_tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    )),
    false
  ) then
    raise exception using errcode = '42501', message = 'ESTIMATE_WRITE_ROLE_REQUIRED';
  end if;

  foreach target_project_id in array p_project_ids
  loop
    locked_project_id := null;
    locked_is_archived := null;

    begin
      select p.id, p.is_archived
        into locked_project_id, locked_is_archived
      from public.estimate_projects p
      where p.id = target_project_id
        and p.tenant_id = p_tenant_id
      for update;

      if locked_project_id is null then
        project_id := target_project_id;
        outcome := 'not_found';
        message := 'Affaire introuvable ou non autorisee.';
        return next;
        continue;
      end if;

      if locked_is_archived
        or exists (
          select 1
          from public.estimate_versions v
          where v.project_id = locked_project_id
            and v.tenant_id = p_tenant_id
            and v.status <> 'draft'
        )
      then
        project_id := target_project_id;
        outcome := 'not_eligible';
        message := 'Seules les affaires dont toutes les versions sont en brouillon peuvent etre supprimees.';
        return next;
        continue;
      end if;

      delete from public.estimate_projects p
      where p.id = locked_project_id
        and p.tenant_id = p_tenant_id;

      if found then
        project_id := target_project_id;
        outcome := 'deleted';
        message := null;
      else
        project_id := target_project_id;
        outcome := 'failed';
        message := 'Impossible de supprimer cette affaire.';
      end if;
      return next;
    exception
      when others then
        raise warning 'bulk_delete_draft_affaires failed for project %: [%] %',
          target_project_id,
          sqlstate,
          sqlerrm;
        project_id := target_project_id;
        outcome := 'failed';
        message := 'Impossible de supprimer cette affaire.';
        return next;
    end;
  end loop;
end;
$$;

revoke all on function public.bulk_delete_draft_affaires(uuid, uuid[]) from public;
revoke all on function public.bulk_delete_draft_affaires(uuid, uuid[]) from anon;
grant execute on function public.bulk_delete_draft_affaires(uuid, uuid[]) to authenticated;
