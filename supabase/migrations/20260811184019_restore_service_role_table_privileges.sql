-- A fresh local reset creates historical tables without the table grants that
-- server-side service-role clients rely on. RLS bypass alone is insufficient:
-- PostgreSQL still requires relation privileges before evaluating a request.
-- Keep this grant server-only; anon and authenticated remain governed by RLS.

grant select, insert, update, delete
  on all tables in schema public
  to service_role;

grant usage, select, update
  on all sequences in schema public
  to service_role;
