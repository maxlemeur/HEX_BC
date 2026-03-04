-- UX2-020 benchmark: run this script after migration deployment.
-- Goal: validate query plans for analytics RPCs in the three expected scopes.
--
-- Notes:
-- - Execute under an authenticated context where current_tenant_id()/auth.uid() are set.
-- - Compare plans over realistic tenant volumes.

begin;

set local statement_timeout = '0';
set local lock_timeout = '5s';
set local idle_in_transaction_session_timeout = '10min';

create temporary table _ux2_020_context (
  tenant_id uuid not null,
  owner_user_id uuid not null,
  admin_user_id uuid null
) on commit drop;

insert into _ux2_020_context (tenant_id, owner_user_id, admin_user_id)
select
  p.tenant_id,
  p.user_id,
  (
    select tm.user_id
    from public.tenant_memberships tm
    where tm.tenant_id = p.tenant_id
      and tm.role = 'admin'::public.tenant_role
    order by tm.is_default desc, tm.created_at asc
    limit 1
  ) as admin_user_id
from public.estimate_projects p
group by p.tenant_id, p.user_id
order by count(*) desc
limit 1;

-- 1) Admin scope ALL (owner filter = null)
explain (analyze, buffers, verbose)
select *
from public.get_chiffreur_analytics_kpis(
  (select tenant_id from _ux2_020_context limit 1),
  null
);

explain (analyze, buffers, verbose)
select *
from public.list_chiffreur_analytics_trend(
  (select tenant_id from _ux2_020_context limit 1),
  null,
  6
);

explain (analyze, buffers, verbose)
select *
from public.list_affaires_page(
  (select tenant_id from _ux2_020_context limit 1),
  null,
  10,
  null,
  null,
  null,
  null,
  'desc'
);

-- 2) Admin scope OWNER (owner filter provided)
explain (analyze, buffers, verbose)
select *
from public.get_chiffreur_analytics_kpis(
  (select tenant_id from _ux2_020_context limit 1),
  (select owner_user_id from _ux2_020_context limit 1)
);

explain (analyze, buffers, verbose)
select *
from public.list_chiffreur_analytics_trend(
  (select tenant_id from _ux2_020_context limit 1),
  (select owner_user_id from _ux2_020_context limit 1),
  6
);

explain (analyze, buffers, verbose)
select *
from public.list_affaires_page(
  (select tenant_id from _ux2_020_context limit 1),
  (select owner_user_id from _ux2_020_context limit 1),
  10,
  null,
  null,
  null,
  null,
  'desc'
);

-- 3) Engineer/self scope (owner filter = auth.uid equivalent)
explain (analyze, buffers, verbose)
select *
from public.get_chiffreur_analytics_kpis(
  (select tenant_id from _ux2_020_context limit 1),
  (select owner_user_id from _ux2_020_context limit 1)
);

explain (analyze, buffers, verbose)
select *
from public.list_chiffreur_analytics_trend(
  (select tenant_id from _ux2_020_context limit 1),
  (select owner_user_id from _ux2_020_context limit 1),
  6
);

rollback;
