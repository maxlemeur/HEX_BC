-- V3-017: atomically decide a review cycle so comment persistence, approval updates,
-- and cycle closure cannot diverge under retries or concurrent approvers.

create or replace function public.decide_estimate_review_cycle(
  p_cycle_id uuid,
  p_decision public.estimate_review_decision,
  p_comments jsonb default '[]'::jsonb
)
returns table (
  cycle_id uuid,
  cycle_number integer,
  approval_ids uuid[],
  rule_ids uuid[],
  comment_count integer
)
language plpgsql
set search_path = public
as $$
declare
  current_user_id uuid;
  cycle_row estimate_review_cycles;
  updated_approval_count integer := 0;
  decision_timestamp timestamptz := now();
  next_status estimate_approval_status;
  resolved_comments jsonb := coalesce(p_comments, '[]'::jsonb);
begin
  current_user_id := auth.uid();
  next_status :=
    case
      when p_decision = 'changes_requested' then 'rejected'::estimate_approval_status
      else 'approved'::estimate_approval_status
    end;

  if current_user_id is null then
    raise exception
      using
        errcode = '42501',
        message = 'AUTHENTICATION_REQUIRED';
  end if;

  if jsonb_typeof(resolved_comments) <> 'array' then
    raise exception
      using
        errcode = '22023',
        message = 'ESTIMATE_REVIEW_COMMENTS_INVALID';
  end if;

  select *
    into cycle_row
  from public.estimate_review_cycles cycle
  where cycle.id = p_cycle_id
    and cycle.tenant_id = public.current_tenant_id()
    and cycle.decision is null
  for update;

  if cycle_row.id is null then
    raise exception
      using
        errcode = 'P0001',
        message = 'ESTIMATE_REVIEW_CYCLE_NOT_FOUND';
  end if;

  if jsonb_array_length(resolved_comments) > 0 then
    insert into public.estimate_review_comments (
      tenant_id,
      version_id,
      cycle_id,
      scope_type,
      scope_id,
      scope_label,
      comment,
      created_by
    )
    select
      cycle_row.tenant_id,
      cycle_row.version_id,
      cycle_row.id,
      comment.scope_type::estimate_review_comment_scope,
      comment.scope_id,
      comment.scope_label,
      comment.comment,
      current_user_id
    from jsonb_to_recordset(resolved_comments) as comment(
      scope_type text,
      scope_id uuid,
      scope_label text,
      comment text
    );
  end if;

  with updated as (
    update public.estimate_approvals approval
    set
      status = next_status,
      approved_by = current_user_id,
      decided_at = decision_timestamp
    where approval.tenant_id = cycle_row.tenant_id
      and approval.version_id = cycle_row.version_id
      and approval.status = 'pending'
    returning approval.id, approval.rule_id
  )
  select
    coalesce(array_agg(updated.id order by updated.id), '{}'::uuid[]),
    coalesce(array_agg(updated.rule_id order by updated.id), '{}'::uuid[]),
    count(*)::integer
  into approval_ids, rule_ids, updated_approval_count
  from updated;

  if updated_approval_count = 0 then
    raise exception
      using
        errcode = 'P0001',
        message = 'ESTIMATE_APPROVALS_PENDING_NOT_FOUND';
  end if;

  update public.estimate_review_cycles cycle
  set
    decision = p_decision,
    decided_by = current_user_id,
    decided_at = decision_timestamp
  where cycle.id = cycle_row.id
    and cycle.tenant_id = cycle_row.tenant_id
    and cycle.decision is null
  returning cycle.id, cycle.cycle_number
  into cycle_id, cycle_number;

  if cycle_id is null then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_REVIEW_CYCLE_ALREADY_CLOSED';
  end if;

  comment_count := jsonb_array_length(resolved_comments);
  return next;
end;
$$;
