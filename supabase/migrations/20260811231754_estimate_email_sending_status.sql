-- Reserve an intermediate lifecycle state before any external email side effect.
--
-- PostgreSQL requires a newly-added enum value to be committed before a later
-- migration can use it in functions, constraints, or data changes. Keep this
-- migration intentionally standalone.

alter type public.estimate_status
  add value if not exists 'sending' after 'draft';
