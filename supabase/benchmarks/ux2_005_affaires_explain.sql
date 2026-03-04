-- UX2-005 benchmark: run this script once BEFORE migration and once AFTER migration,
-- then compare EXPLAIN (ANALYZE, BUFFERS) output.
--
-- Target queries:
-- 1) list_affaires_page (keyset pagination)
-- 2) get_affaires_counters (total/filtered/status)
--
-- Safety: transactional + rollback.

begin;

set local statement_timeout = '0';
set local lock_timeout = '5s';
set local idle_in_transaction_session_timeout = '10min';

create temporary table _ux2_005_context (
  tenant_id uuid not null,
  owner_user_id uuid not null
) on commit drop;

insert into _ux2_005_context (tenant_id, owner_user_id)
select
  p.tenant_id,
  p.user_id
from public.estimate_projects p
where p.is_archived = false
group by p.tenant_id, p.user_id
order by count(*) desc
limit 1;

-- 1) List page: first page, page-size 20 (+1 for hasNext computation in app code).
explain (analyze, buffers, verbose)
select *
from public.list_affaires_page(
  (select tenant_id from _ux2_005_context limit 1),
  (select owner_user_id from _ux2_005_context limit 1),
  21,
  null,
  null,
  null,
  null
);

-- 2) Counters: with search + multi-status to validate filtered aggregate path.
explain (analyze, buffers, verbose)
select *
from public.get_affaires_counters(
  (select tenant_id from _ux2_005_context limit 1),
  (select owner_user_id from _ux2_005_context limit 1),
  'projet',
  array['draft'::public.estimate_status, 'accepted'::public.estimate_status]
);

rollback;
