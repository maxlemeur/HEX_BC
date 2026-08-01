-- Trigger functions are internal implementation details and must not be
-- callable through Data API roles. Trigger execution remains unaffected.

revoke execute on function public.prevent_affaire_intake_event_mutation()
  from public, anon, authenticated, service_role;

revoke execute on function public.prevent_affaire_register_event_mutation()
  from public, anon, authenticated, service_role;