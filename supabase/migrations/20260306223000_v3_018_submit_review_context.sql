-- V3-018: persist the submission context and assigned approver on review cycles.

alter table if exists public.estimate_review_cycles
  add column if not exists submission_message text,
  add column if not exists assigned_reviewer_id uuid references public.profiles(id) on delete set null;

create index if not exists estimate_review_cycles_open_assigned_reviewer_idx
  on public.estimate_review_cycles (tenant_id, assigned_reviewer_id, requested_at desc)
  where decision is null and assigned_reviewer_id is not null;

create or replace function public.guard_estimate_review_cycles_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  assigned_membership record;
begin
  if new.cycle_number <= 0 then
    raise exception
      using
        errcode = '22023',
        message = 'ESTIMATE_REVIEW_CYCLE_NUMBER_INVALID';
  end if;

  if trim(coalesce(new.requested_by::text, '')) = '' then
    raise exception
      using
        errcode = '22023',
        message = 'ESTIMATE_REVIEW_REQUESTED_BY_REQUIRED';
  end if;

  if new.submission_message is not null and trim(new.submission_message) = '' then
    raise exception
      using
        errcode = '22023',
        message = 'ESTIMATE_REVIEW_SUBMISSION_MESSAGE_REQUIRED';
  end if;

  if new.assigned_reviewer_id is not null then
    select membership.user_id, membership.role
      into assigned_membership
    from public.tenant_memberships membership
    where membership.tenant_id = new.tenant_id
      and membership.user_id = new.assigned_reviewer_id
      and membership.role in ('admin'::public.tenant_role, 'director'::public.tenant_role)
    order by membership.is_default desc, membership.created_at asc
    limit 1;

    if assigned_membership.user_id is null then
      raise exception
        using
          errcode = '23514',
          message = 'ESTIMATE_REVIEW_ASSIGNED_REVIEWER_INVALID';
    end if;
  end if;

  if new.decision is null then
    if new.decided_by is not null or new.decided_at is not null then
      raise exception
        using
          errcode = '23514',
          message = 'ESTIMATE_REVIEW_OPEN_CYCLE_INVALID';
    end if;
  elsif new.decided_by is null or new.decided_at is null then
    raise exception
      using
        errcode = '23514',
        message = 'ESTIMATE_REVIEW_DECISION_INVALID';
  end if;

  return new;
end;
$$;

create or replace function public.guard_estimate_review_cycles_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  assigned_membership record;
begin
  if old.tenant_id is distinct from new.tenant_id
    or old.version_id is distinct from new.version_id
    or old.cycle_number is distinct from new.cycle_number
    or old.requested_by is distinct from new.requested_by
    or old.requested_at is distinct from new.requested_at
    or old.carried_over_from_cycle_id is distinct from new.carried_over_from_cycle_id
    or old.created_at is distinct from new.created_at
    or old.submission_message is distinct from new.submission_message
    or old.assigned_reviewer_id is distinct from new.assigned_reviewer_id
  then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_REVIEW_CYCLE_IMMUTABLE_FIELDS';
  end if;

  if old.decision is not null and (
    old.decision is distinct from new.decision
    or old.decided_by is distinct from new.decided_by
    or old.decided_at is distinct from new.decided_at
  ) then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_REVIEW_CYCLE_ALREADY_CLOSED';
  end if;

  if new.submission_message is not null and trim(new.submission_message) = '' then
    raise exception
      using
        errcode = '22023',
        message = 'ESTIMATE_REVIEW_SUBMISSION_MESSAGE_REQUIRED';
  end if;

  if new.assigned_reviewer_id is not null then
    select membership.user_id, membership.role
      into assigned_membership
    from public.tenant_memberships membership
    where membership.tenant_id = new.tenant_id
      and membership.user_id = new.assigned_reviewer_id
      and membership.role in ('admin'::public.tenant_role, 'director'::public.tenant_role)
    order by membership.is_default desc, membership.created_at asc
    limit 1;

    if assigned_membership.user_id is null then
      raise exception
        using
          errcode = '23514',
          message = 'ESTIMATE_REVIEW_ASSIGNED_REVIEWER_INVALID';
    end if;
  end if;

  if new.decision is null then
    if new.decided_by is not null or new.decided_at is not null then
      raise exception
        using
          errcode = '23514',
          message = 'ESTIMATE_REVIEW_OPEN_CYCLE_INVALID';
    end if;
  elsif new.decided_by is null or new.decided_at is null then
    raise exception
      using
        errcode = '23514',
        message = 'ESTIMATE_REVIEW_DECISION_INVALID';
  end if;

  return new;
end;
$$;
