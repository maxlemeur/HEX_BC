-- TKF-015: extend audit action catalog for takeoff processing lifecycle.

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
      'takeoff.job.created',
      'takeoff.job.processing',
      'takeoff.job.completed',
      'takeoff.job.failed',
      'takeoff.job.retried',
      'takeoff.job.canceled',
      'takeoff.item.excluded',
      'takeoff.item.modified',
      'takeoff.apply.started',
      'takeoff.apply.completed',
      'takeoff.apply.failed'
    )
  );
