-- V3-019: review cycle guard triggers must bypass membership RLS when validating assigned reviewers.

alter function public.guard_estimate_review_cycles_insert() security definer;
alter function public.guard_estimate_review_cycles_update() security definer;
