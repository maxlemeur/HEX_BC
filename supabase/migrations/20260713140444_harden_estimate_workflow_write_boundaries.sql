-- Close direct authenticated write paths around estimate workflow artifacts.

-- Structure drafts stay readable to reviewers, but generation/application is a
-- chiffreur operation. Ownership alone must not turn a viewer into an editor.
drop policy if exists "Users can insert estimate structure drafts" on public.estimate_structure_drafts;
drop policy if exists "Users can update estimate structure drafts" on public.estimate_structure_drafts;
drop policy if exists "Users can delete estimate structure drafts" on public.estimate_structure_drafts;

create policy "Users can insert estimate structure drafts"
  on public.estimate_structure_drafts
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
    and exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_structure_drafts.target_version_id
        and v.tenant_id = estimate_structure_drafts.tenant_id
        and p.tenant_id = v.tenant_id
        and v.status = 'draft'
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(
            v.tenant_id,
            array['admin'::public.tenant_role]
          ))
        )
    )
  );

create policy "Users can update estimate structure drafts"
  on public.estimate_structure_drafts
  for update
  to authenticated
  using (
    created_by = (select auth.uid())
    and (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  )
  with check (
    created_by = (select auth.uid())
    and (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );

create policy "Users can delete estimate structure drafts"
  on public.estimate_structure_drafts
  for delete
  to authenticated
  using (
    created_by = (select auth.uid())
    and (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );

drop policy if exists "Users can insert estimate structure draft nodes" on public.estimate_structure_draft_nodes;
drop policy if exists "Users can update estimate structure draft nodes" on public.estimate_structure_draft_nodes;
drop policy if exists "Users can delete estimate structure draft nodes" on public.estimate_structure_draft_nodes;

create policy "Users can insert estimate structure draft nodes"
  on public.estimate_structure_draft_nodes
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.estimate_structure_drafts d
      where d.id = estimate_structure_draft_nodes.draft_id
        and d.tenant_id = estimate_structure_draft_nodes.tenant_id
        and d.created_by = (select auth.uid())
        and (select public.has_tenant_role(
          d.tenant_id,
          array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
        ))
    )
  );

create policy "Users can update estimate structure draft nodes"
  on public.estimate_structure_draft_nodes
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_structure_drafts d
      where d.id = estimate_structure_draft_nodes.draft_id
        and d.tenant_id = estimate_structure_draft_nodes.tenant_id
        and d.created_by = (select auth.uid())
        and (select public.has_tenant_role(
          d.tenant_id,
          array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
        ))
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_structure_drafts d
      where d.id = estimate_structure_draft_nodes.draft_id
        and d.tenant_id = estimate_structure_draft_nodes.tenant_id
        and d.created_by = (select auth.uid())
        and (select public.has_tenant_role(
          d.tenant_id,
          array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
        ))
    )
  );

create policy "Users can delete estimate structure draft nodes"
  on public.estimate_structure_draft_nodes
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_structure_drafts d
      where d.id = estimate_structure_draft_nodes.draft_id
        and d.tenant_id = estimate_structure_draft_nodes.tenant_id
        and d.created_by = (select auth.uid())
        and (select public.has_tenant_role(
          d.tenant_id,
          array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
        ))
    )
  );

drop policy if exists "Users can insert estimate structure draft applications" on public.estimate_structure_draft_applications;
drop policy if exists "Users can delete estimate structure draft applications" on public.estimate_structure_draft_applications;

create policy "Users can insert estimate structure draft applications"
  on public.estimate_structure_draft_applications
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.estimate_structure_drafts d
      where d.id = estimate_structure_draft_applications.draft_id
        and d.tenant_id = estimate_structure_draft_applications.tenant_id
        and d.created_by = (select auth.uid())
        and (select public.has_tenant_role(
          d.tenant_id,
          array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
        ))
    )
  );

create policy "Users can delete estimate structure draft applications"
  on public.estimate_structure_draft_applications
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_structure_drafts d
      where d.id = estimate_structure_draft_applications.draft_id
        and d.tenant_id = estimate_structure_draft_applications.tenant_id
        and d.created_by = (select auth.uid())
        and (select public.has_tenant_role(
          d.tenant_id,
          array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
        ))
    )
  );

-- Resolve V0 scope with table-owner visibility and reject unresolved parents.
-- The derived scope and creation identity are immutable after insertion.
create or replace function public.assign_estimate_version_zero_draft_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_tenant_id uuid;
  resolved_project_id uuid;
  resolved_brief_tenant_id uuid;
  resolved_brief_project_id uuid;
begin
  select ev.tenant_id, ev.project_id
    into resolved_tenant_id, resolved_project_id
  from public.estimate_versions ev
  where ev.id = new.version_id;

  if resolved_tenant_id is null or resolved_project_id is null then
    raise exception using errcode = '23503', message = 'ESTIMATE_VERSION_ZERO_VERSION_NOT_FOUND';
  end if;

  if new.brief_id is not null then
    select b.tenant_id, b.project_id
      into resolved_brief_tenant_id, resolved_brief_project_id
    from public.affaire_briefs b
    where b.id = new.brief_id;

    if resolved_brief_tenant_id is null or resolved_brief_project_id is null then
      raise exception using errcode = '23503', message = 'ESTIMATE_VERSION_ZERO_BRIEF_NOT_FOUND';
    end if;

    if resolved_brief_project_id <> resolved_project_id then
      raise exception using errcode = '23514', message = 'ESTIMATE_VERSION_ZERO_BRIEF_PROJECT_MISMATCH';
    end if;
    if resolved_brief_tenant_id <> resolved_tenant_id then
      raise exception using errcode = '23514', message = 'ESTIMATE_VERSION_ZERO_BRIEF_TENANT_MISMATCH';
    end if;
  end if;

  new.tenant_id := resolved_tenant_id;
  new.project_id := resolved_project_id;
  return new;
end;
$$;

revoke all on function public.assign_estimate_version_zero_draft_scope() from public;
revoke all on function public.assign_estimate_version_zero_draft_scope() from anon;
revoke all on function public.assign_estimate_version_zero_draft_scope() from authenticated;

create or replace function public.guard_estimate_version_zero_draft_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.tenant_id is distinct from new.tenant_id
    or old.project_id is distinct from new.project_id
    or old.version_id is distinct from new.version_id
    or old.brief_id is distinct from new.brief_id
    or old.created_by is distinct from new.created_by
    or old.created_at is distinct from new.created_at
  then
    raise exception using errcode = '23514', message = 'ESTIMATE_VERSION_ZERO_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_estimate_version_zero_draft_identity() from public;
revoke all on function public.guard_estimate_version_zero_draft_identity() from anon;
revoke all on function public.guard_estimate_version_zero_draft_identity() from authenticated;

drop trigger if exists guard_estimate_version_zero_draft_identity_trigger on public.estimate_version_zero_drafts;
create trigger guard_estimate_version_zero_draft_identity_trigger
  before update on public.estimate_version_zero_drafts
  for each row execute function public.guard_estimate_version_zero_draft_identity();

drop policy if exists "Users can insert version zero drafts" on public.estimate_version_zero_drafts;
drop policy if exists "Users can update version zero drafts" on public.estimate_version_zero_drafts;
drop policy if exists "Users can delete version zero drafts" on public.estimate_version_zero_drafts;

create policy "Users can insert version zero drafts"
  on public.estimate_version_zero_drafts
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
    and exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_version_zero_drafts.version_id
        and v.tenant_id = estimate_version_zero_drafts.tenant_id
        and v.status = 'draft'
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

create policy "Users can update version zero drafts"
  on public.estimate_version_zero_drafts
  for update
  to authenticated
  using (
    created_by = (select auth.uid())
    and (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  )
  with check (
    created_by = (select auth.uid())
    and (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );

create policy "Users can delete version zero drafts"
  on public.estimate_version_zero_drafts
  for delete
  to authenticated
  using (
    created_by = (select auth.uid())
    and (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );

drop policy if exists "Users can insert version zero lots" on public.estimate_version_zero_lots;
drop policy if exists "Users can update version zero lots" on public.estimate_version_zero_lots;
drop policy if exists "Users can delete version zero lots" on public.estimate_version_zero_lots;
drop policy if exists "Users can insert version zero lines" on public.estimate_version_zero_lines;
drop policy if exists "Users can update version zero lines" on public.estimate_version_zero_lines;
drop policy if exists "Users can delete version zero lines" on public.estimate_version_zero_lines;
drop policy if exists "Users can insert version zero applications" on public.estimate_version_zero_applications;
drop policy if exists "Users can update version zero applications" on public.estimate_version_zero_applications;
drop policy if exists "Users can delete version zero applications" on public.estimate_version_zero_applications;

create policy "Users can insert version zero lots"
  on public.estimate_version_zero_lots for insert to authenticated
  with check (exists (
    select 1 from public.estimate_version_zero_drafts d
    where d.id = estimate_version_zero_lots.draft_id
      and d.tenant_id = estimate_version_zero_lots.tenant_id
      and d.created_by = (select auth.uid())
      and (select public.has_tenant_role(d.tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  ));
create policy "Users can update version zero lots"
  on public.estimate_version_zero_lots for update to authenticated
  using (exists (
    select 1 from public.estimate_version_zero_drafts d
    where d.id = estimate_version_zero_lots.draft_id
      and d.tenant_id = estimate_version_zero_lots.tenant_id
      and d.created_by = (select auth.uid())
      and (select public.has_tenant_role(d.tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  ))
  with check (exists (
    select 1 from public.estimate_version_zero_drafts d
    where d.id = estimate_version_zero_lots.draft_id
      and d.tenant_id = estimate_version_zero_lots.tenant_id
      and d.created_by = (select auth.uid())
      and (select public.has_tenant_role(d.tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  ));
create policy "Users can delete version zero lots"
  on public.estimate_version_zero_lots for delete to authenticated
  using (exists (
    select 1 from public.estimate_version_zero_drafts d
    where d.id = estimate_version_zero_lots.draft_id
      and d.tenant_id = estimate_version_zero_lots.tenant_id
      and d.created_by = (select auth.uid())
      and (select public.has_tenant_role(d.tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  ));

create policy "Users can insert version zero lines"
  on public.estimate_version_zero_lines for insert to authenticated
  with check (exists (
    select 1 from public.estimate_version_zero_drafts d
    where d.id = estimate_version_zero_lines.draft_id
      and d.tenant_id = estimate_version_zero_lines.tenant_id
      and d.created_by = (select auth.uid())
      and (select public.has_tenant_role(d.tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  ));
create policy "Users can update version zero lines"
  on public.estimate_version_zero_lines for update to authenticated
  using (exists (
    select 1 from public.estimate_version_zero_drafts d
    where d.id = estimate_version_zero_lines.draft_id
      and d.tenant_id = estimate_version_zero_lines.tenant_id
      and d.created_by = (select auth.uid())
      and (select public.has_tenant_role(d.tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  ))
  with check (exists (
    select 1 from public.estimate_version_zero_drafts d
    where d.id = estimate_version_zero_lines.draft_id
      and d.tenant_id = estimate_version_zero_lines.tenant_id
      and d.created_by = (select auth.uid())
      and (select public.has_tenant_role(d.tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  ));
create policy "Users can delete version zero lines"
  on public.estimate_version_zero_lines for delete to authenticated
  using (exists (
    select 1 from public.estimate_version_zero_drafts d
    where d.id = estimate_version_zero_lines.draft_id
      and d.tenant_id = estimate_version_zero_lines.tenant_id
      and d.created_by = (select auth.uid())
      and (select public.has_tenant_role(d.tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  ));

create policy "Users can insert version zero applications"
  on public.estimate_version_zero_applications for insert to authenticated
  with check (exists (
    select 1 from public.estimate_version_zero_drafts d
    where d.id = estimate_version_zero_applications.draft_id
      and d.tenant_id = estimate_version_zero_applications.tenant_id
      and d.created_by = (select auth.uid())
      and (select public.has_tenant_role(d.tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  ));
create policy "Users can update version zero applications"
  on public.estimate_version_zero_applications for update to authenticated
  using (exists (
    select 1 from public.estimate_version_zero_drafts d
    where d.id = estimate_version_zero_applications.draft_id
      and d.tenant_id = estimate_version_zero_applications.tenant_id
      and d.created_by = (select auth.uid())
      and (select public.has_tenant_role(d.tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  ))
  with check (exists (
    select 1 from public.estimate_version_zero_drafts d
    where d.id = estimate_version_zero_applications.draft_id
      and d.tenant_id = estimate_version_zero_applications.tenant_id
      and d.created_by = (select auth.uid())
      and (select public.has_tenant_role(d.tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  ));
create policy "Users can delete version zero applications"
  on public.estimate_version_zero_applications for delete to authenticated
  using (exists (
    select 1 from public.estimate_version_zero_drafts d
    where d.id = estimate_version_zero_applications.draft_id
      and d.tenant_id = estimate_version_zero_applications.tenant_id
      and d.created_by = (select auth.uid())
      and (select public.has_tenant_role(d.tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  ));

-- Lock rows may only renew their expiry. Rebinding version/user/tenant turns the
-- global version uniqueness constraint into a cross-tenant denial of service.
create or replace function public.assign_draft_lock_tenant_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_tenant_id uuid;
begin
  if tg_op = 'UPDATE' and (
    old.version_id is distinct from new.version_id
    or old.user_id is distinct from new.user_id
    or old.tenant_id is distinct from new.tenant_id
    or old.locked_at is distinct from new.locked_at
    or old.created_at is distinct from new.created_at
  ) then
    raise exception using errcode = '23514', message = 'DRAFT_LOCK_IDENTITY_IMMUTABLE';
  end if;

  select ev.tenant_id into parent_tenant_id
  from public.estimate_versions ev
  where ev.id = new.version_id;

  if parent_tenant_id is null then
    raise exception using errcode = '23503', message = 'DRAFT_LOCK_VERSION_NOT_FOUND';
  end if;

  new.tenant_id := parent_tenant_id;
  return new;
end;
$$;

revoke all on function public.assign_draft_lock_tenant_id() from public;
revoke all on function public.assign_draft_lock_tenant_id() from anon;
revoke all on function public.assign_draft_lock_tenant_id() from authenticated;

drop trigger if exists set_draft_locks_tenant_id on public.draft_locks;
create trigger set_draft_locks_tenant_id
  before insert or update on public.draft_locks
  for each row execute function public.assign_draft_lock_tenant_id();

-- Correction state and its audit event must be committed together by the RPC.
drop policy if exists "Estimate owners can update estimate review correction items" on public.estimate_review_correction_items;
revoke all on function public.record_estimate_review_correction_action(
  uuid,
  public.estimate_review_correction_status,
  text
) from public;
revoke all on function public.record_estimate_review_correction_action(
  uuid,
  public.estimate_review_correction_status,
  text
) from anon;
grant execute on function public.record_estimate_review_correction_action(
  uuid,
  public.estimate_review_correction_status,
  text
) to authenticated;

-- Applied generated-ouvrage snapshots are append-only provenance.
drop policy if exists "Users can update generated ouvrage work snapshots" on public.estimate_generated_ouvrage_work_snapshots;
drop policy if exists "Users can delete generated ouvrage work snapshots" on public.estimate_generated_ouvrage_work_snapshots;

-- Atomically consume the optimistic revision before a mutating batch starts.
create or replace function public.claim_estimate_batch_revision(
  p_version_id uuid,
  p_expected_updated_at timestamptz
)
returns table (id uuid, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  return query
  update public.estimate_versions v
  set updated_at = clock_timestamp()
  from public.estimate_projects p
  where v.id = p_version_id
    and v.project_id = p.id
    and v.tenant_id = p.tenant_id
    and v.status = 'draft'
    and v.updated_at = p_expected_updated_at
    and (select public.has_tenant_role(
      v.tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
    and (
      p.user_id = current_user_id
      or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
    )
    and exists (
      select 1
      from public.draft_locks dl
      where dl.version_id = v.id
        and dl.tenant_id = v.tenant_id
        and dl.user_id = current_user_id
        and dl.expires_at > now()
    )
  returning v.id, v.updated_at;

  if not found then
    raise exception using errcode = '40001', message = 'ESTIMATE_BATCH_REVISION_CONFLICT';
  end if;
end;
$$;

revoke all on function public.claim_estimate_batch_revision(uuid, timestamptz) from public;
revoke all on function public.claim_estimate_batch_revision(uuid, timestamptz) from anon;
grant execute on function public.claim_estimate_batch_revision(uuid, timestamptz) to authenticated;
