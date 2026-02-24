-- Deduplicate permissive RLS policies for SELECT by avoiding ALL+SELECT overlap.

-- currency_rates
alter table public.currency_rates enable row level security;
drop policy if exists "Tenant admins can manage currency rates" on public.currency_rates;
create policy "Tenant admins can insert currency rates"
on public.currency_rates
as permissive
for insert
to authenticated
with check ((select has_tenant_role(currency_rates.tenant_id, array['admin'::tenant_role])));
create policy "Tenant admins can update currency rates"
on public.currency_rates
as permissive
for update
to authenticated
using ((select has_tenant_role(currency_rates.tenant_id, array['admin'::tenant_role])))
with check ((select has_tenant_role(currency_rates.tenant_id, array['admin'::tenant_role])));
create policy "Tenant admins can delete currency rates"
on public.currency_rates
as permissive
for delete
to authenticated
using ((select has_tenant_role(currency_rates.tenant_id, array['admin'::tenant_role])));

-- dpgf_catalogue_links (remove redundant SELECT policy with same predicate as ALL policy)
drop policy if exists "Users can view own dpgf catalogue links" on public.dpgf_catalogue_links;

-- estimate_rules
drop policy if exists "Tenant admins can manage estimate rules" on public.estimate_rules;
create policy "Tenant admins can insert estimate rules"
on public.estimate_rules
as permissive
for insert
to authenticated
with check ((select has_tenant_role(estimate_rules.tenant_id, array['admin'::tenant_role])));
create policy "Tenant admins can update estimate rules"
on public.estimate_rules
as permissive
for update
to authenticated
using ((select has_tenant_role(estimate_rules.tenant_id, array['admin'::tenant_role])))
with check ((select has_tenant_role(estimate_rules.tenant_id, array['admin'::tenant_role])));
create policy "Tenant admins can delete estimate rules"
on public.estimate_rules
as permissive
for delete
to authenticated
using ((select has_tenant_role(estimate_rules.tenant_id, array['admin'::tenant_role])));

-- feature_flags
drop policy if exists "Tenant admins can manage feature flags" on public.feature_flags;
create policy "Tenant admins can insert feature flags"
on public.feature_flags
as permissive
for insert
to authenticated
with check ((select has_tenant_role(feature_flags.tenant_id, array['admin'::tenant_role])));
create policy "Tenant admins can update feature flags"
on public.feature_flags
as permissive
for update
to authenticated
using ((select has_tenant_role(feature_flags.tenant_id, array['admin'::tenant_role])))
with check ((select has_tenant_role(feature_flags.tenant_id, array['admin'::tenant_role])));
create policy "Tenant admins can delete feature flags"
on public.feature_flags
as permissive
for delete
to authenticated
using ((select has_tenant_role(feature_flags.tenant_id, array['admin'::tenant_role])));

-- margin_tiers
drop policy if exists "Tenant admins can manage margin tiers" on public.margin_tiers;
create policy "Tenant admins can insert margin tiers"
on public.margin_tiers
as permissive
for insert
to authenticated
with check ((select has_tenant_role(margin_tiers.tenant_id, array['admin'::tenant_role])));
create policy "Tenant admins can update margin tiers"
on public.margin_tiers
as permissive
for update
to authenticated
using ((select has_tenant_role(margin_tiers.tenant_id, array['admin'::tenant_role])))
with check ((select has_tenant_role(margin_tiers.tenant_id, array['admin'::tenant_role])));
create policy "Tenant admins can delete margin tiers"
on public.margin_tiers
as permissive
for delete
to authenticated
using ((select has_tenant_role(margin_tiers.tenant_id, array['admin'::tenant_role])));

-- material_indices
-- Keep editor scope (admin + engineer) for write operations.
drop policy if exists "Tenant editors can manage material indices" on public.material_indices;
create policy "Tenant editors can insert material indices"
on public.material_indices
as permissive
for insert
to authenticated
with check ((select has_tenant_role(material_indices.tenant_id, array['admin'::tenant_role, 'engineer'::tenant_role])));
create policy "Tenant editors can update material indices"
on public.material_indices
as permissive
for update
to authenticated
using ((select has_tenant_role(material_indices.tenant_id, array['admin'::tenant_role, 'engineer'::tenant_role])))
with check ((select has_tenant_role(material_indices.tenant_id, array['admin'::tenant_role, 'engineer'::tenant_role])));
create policy "Tenant editors can delete material indices"
on public.material_indices
as permissive
for delete
to authenticated
using ((select has_tenant_role(material_indices.tenant_id, array['admin'::tenant_role, 'engineer'::tenant_role])));

-- suggestion_learning_reviews
drop policy if exists "Tenant admins can manage suggestion learning reviews" on public.suggestion_learning_reviews;
create policy "Tenant admins can insert suggestion learning reviews"
on public.suggestion_learning_reviews
as permissive
for insert
to authenticated
with check ((select has_tenant_role(suggestion_learning_reviews.tenant_id, array['admin'::tenant_role])));
create policy "Tenant admins can update suggestion learning reviews"
on public.suggestion_learning_reviews
as permissive
for update
to authenticated
using ((select has_tenant_role(suggestion_learning_reviews.tenant_id, array['admin'::tenant_role])))
with check ((select has_tenant_role(suggestion_learning_reviews.tenant_id, array['admin'::tenant_role])));
create policy "Tenant admins can delete suggestion learning reviews"
on public.suggestion_learning_reviews
as permissive
for delete
to authenticated
using ((select has_tenant_role(suggestion_learning_reviews.tenant_id, array['admin'::tenant_role])));

-- supplier_pricebook
-- Keep editor scope (admin + engineer) for write operations.
drop policy if exists "Tenant editors can manage supplier pricebook" on public.supplier_pricebook;
create policy "Tenant editors can insert supplier pricebook"
on public.supplier_pricebook
as permissive
for insert
to authenticated
with check ((select has_tenant_role(supplier_pricebook.tenant_id, array['admin'::tenant_role, 'engineer'::tenant_role])));
create policy "Tenant editors can update supplier pricebook"
on public.supplier_pricebook
as permissive
for update
to authenticated
using ((select has_tenant_role(supplier_pricebook.tenant_id, array['admin'::tenant_role, 'engineer'::tenant_role])))
with check ((select has_tenant_role(supplier_pricebook.tenant_id, array['admin'::tenant_role, 'engineer'::tenant_role])));
create policy "Tenant editors can delete supplier pricebook"
on public.supplier_pricebook
as permissive
for delete
to authenticated
using ((select has_tenant_role(supplier_pricebook.tenant_id, array['admin'::tenant_role, 'engineer'::tenant_role])));
