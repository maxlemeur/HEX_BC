alter table if exists public.affaire_register_events
  drop constraint if exists affaire_register_events_event_type_check;

alter table if exists public.affaire_register_events
  add constraint affaire_register_events_event_type_check
  check (
    event_type in (
      'created',
      'synced',
      'status_changed',
      'clarify_with_client_requested',
      'continued_with_hypothesis',
      'deactivated',
      'reactivated'
    )
  );
