-- TKF-007: allow explicit takeoff job creation audit event values.

alter table public.audit_logs
  drop constraint if exists audit_logs_action_check;

alter table public.audit_logs
  add constraint audit_logs_action_check
  check (
    action in (
      'INSERT',
      'UPDATE',
      'DELETE',
      'invariant_violation',
      'seal',
      'takeoff.job.created'
    )
  );
