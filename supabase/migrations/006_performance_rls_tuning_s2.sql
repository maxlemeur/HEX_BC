-- Migration S2: performance and RLS initplan tuning.

create index if not exists purchase_order_devis_user_id_idx
  on public.purchase_order_devis (user_id);

create index if not exists estimate_suggestion_rules_category_id_idx
  on public.estimate_suggestion_rules (category_id);

create index if not exists estimate_suggestion_rules_labor_role_id_idx
  on public.estimate_suggestion_rules (labor_role_id);

drop policy if exists "Profiles are updatable by owner" on public.profiles;

create policy "Profiles are updatable by owner"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
