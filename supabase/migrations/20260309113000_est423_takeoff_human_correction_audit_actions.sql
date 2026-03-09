-- EST-423: authorize persistent audit events for human takeoff correction instrumentation.

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
      'takeoff.dpgf.review_decision',
      'takeoff.apply.started',
      'takeoff.apply.override',
      'takeoff.apply.completed',
      'takeoff.apply.failed',
      'takeoff.mapping.applied'
    )
  );
