-- Saving a version as a template copied every item under the caller's RLS.
--
-- Observed (TesterArmy full, 25/10/2026, run 40176721283, main d8715edc, shard 2/6):
-- PG1000 POST /api/estimates/templates answered 400. The server log is one Supabase
-- error, SQLSTATE 57014, "canceling statement due to statement timeout". The same
-- journey passed the previous night (run 40076982743, shard 1/6, main 354c18ad).
-- public.create_estimate_template_from_version is one statement for PostgREST. It
-- read estimate_items and inserted estimate_template_items as the caller, so each
-- item paid the select policy of estimate_items and the insert policy of
-- estimate_template_items. Those policies depend only on the version or the
-- template: every item is visible or none is. With statistics that predate a large
-- version (a fresh CI stack), Postgres runs them per item. The same plan made
-- PG1000's item read cross the API roles' 8 s statement_timeout; that read was
-- moved to public.read_estimate_version_items (20261024130000). The template save
-- of 2 501 lines was still on the per-item plan, so it answered 400 and wrote
-- nothing. A page of the new template then did it again for the line count and
-- the following read.
--
-- 1. public.create_estimate_template_from_version becomes security definer. It
--    checks once what the invoker body and the insert policies checked per row:
--    the caller is authenticated, the source version's affaire is in the same
--    tenant, the caller is a member of that active tenant (or the platform admin,
--    as is_tenant_member and has_tenant_role allow) and owns the affaire or holds
--    admin, and holds admin or engineer (the insert policies of estimate_templates
--    and estimate_template_items). The copy is otherwise the function of
--    20261017225906. A missing version stays "Template source version not found or
--    access denied". A member who can see the version but cannot write templates
--    stays 42501, the refusal RLS returned.
-- 2. public.read_estimate_template_items(tenant, template) returns the items the
--    select policy of estimate_template_items shows, with that policy checked once.
--    service_role reads every item of that template in that tenant, as it bypasses
--    RLS on the table.
-- 3. public.count_estimate_template_lines(tenant, templates) counts lines the same
--    way, once for the set, so the save's line count is not another per-item scan.
-- No policy, trigger or existing function besides the replaced save changes.
begin;

create or replace function public.create_estimate_template_from_version(p_source_version_id uuid, p_name text, p_description text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_version public.estimate_versions%rowtype;
  current_user_id uuid := (select auth.uid());
  new_template_id uuid := gen_random_uuid();
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'Template name is required';
  end if;

  select version.*
    into source_version
  from public.estimate_versions version
  join public.estimate_projects project
    on project.id = version.project_id
   and project.tenant_id = version.tenant_id
  where version.id = p_source_version_id
    and (select public.is_tenant_member(version.tenant_id))
    and (
      project.user_id = current_user_id
      or (select public.has_tenant_role(version.tenant_id, array['admin'::public.tenant_role]))
    );

  if not found then
    raise exception 'Template source version not found or access denied';
  end if;

  -- The insert policies of estimate_templates and estimate_template_items, once.
  if not (select public.has_tenant_role(
    source_version.tenant_id,
    array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
  )) then
    raise exception using errcode = '42501', message = 'new row violates row-level security policy';
  end if;

  insert into public.estimate_templates (
    id,
    tenant_id,
    created_by,
    source_version_id,
    name,
    description,
    margin_multiplier,
    margin_mode,
    currency,
    margin_bp,
    discount_bp,
    discount_amount_cents,
    discount_mode,
    discount_steps,
    global_coefficient,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    validite_jours,
    sale_coefficient_fo,
    sale_coefficient_mo
  )
  values (
    new_template_id,
    source_version.tenant_id,
    current_user_id,
    source_version.id,
    btrim(p_name),
    nullif(btrim(coalesce(p_description, '')), ''),
    source_version.margin_multiplier,
    source_version.margin_mode,
    source_version.currency,
    source_version.margin_bp,
    source_version.discount_bp,
    source_version.discount_amount_cents,
    source_version.discount_mode,
    source_version.discount_steps,
    source_version.global_coefficient,
    source_version.tax_rate_bp,
    source_version.rounding_mode,
    source_version.rounding_step_cents,
    source_version.validite_jours,
    source_version.sale_coefficient_fo,
    source_version.sale_coefficient_mo
  );

  create temporary table _estimate_template_item_map (
    old_id uuid primary key,
    new_id uuid not null
  ) on commit drop;

  insert into _estimate_template_item_map (old_id, new_id)
  select item.id, gen_random_uuid()
  from public.estimate_items item
  where item.version_id = p_source_version_id
    and item.tenant_id = source_version.tenant_id;

  insert into public.estimate_template_items (
    id,
    tenant_id,
    template_id,
    parent_id,
    item_type,
    position,
    title,
    description,
    quantity,
    unit_price_ht_cents,
    tax_rate_bp,
    k_fo,
    h_mo,
    h_mo_majoration,
    k_mo,
    h_mo_atelier,
    k_mo_atelier,
    labor_role_atelier_id,
    h_mo_chantier,
    k_mo_chantier,
    labor_role_chantier_id,
    pu_ht_cents,
    labor_role_id,
    category_id,
    supply_type_id,
    line_total_ht_cents,
    line_tax_cents,
    line_total_ttc_cents,
    unit_code,
    pricing_status,
    h_mo_per_unit,
    h_mo_atelier_per_unit,
    h_mo_chantier_per_unit
  )
  select
    map.new_id,
    source_version.tenant_id,
    new_template_id,
    parent_map.new_id,
    src.item_type,
    src.position,
    src.title,
    src.description,
    src.quantity,
    src.unit_price_ht_cents,
    src.tax_rate_bp,
    src.k_fo,
    src.h_mo,
    src.h_mo_majoration,
    src.k_mo,
    src.h_mo_atelier,
    src.k_mo_atelier,
    src.labor_role_atelier_id,
    src.h_mo_chantier,
    src.k_mo_chantier,
    src.labor_role_chantier_id,
    src.pu_ht_cents,
    src.labor_role_id,
    src.category_id,
    src.supply_type_id,
    src.line_total_ht_cents,
    src.line_tax_cents,
    src.line_total_ttc_cents,
    src.unit_code,
    src.pricing_status,
    src.h_mo_per_unit,
    src.h_mo_atelier_per_unit,
    src.h_mo_chantier_per_unit
  from public.estimate_items src
  join _estimate_template_item_map map on map.old_id = src.id
  left join _estimate_template_item_map parent_map on parent_map.old_id = src.parent_id
  where src.version_id = p_source_version_id
    and src.tenant_id = source_version.tenant_id;

  return new_template_id;
end;
$$;

comment on function public.create_estimate_template_from_version(uuid, text, text) is
  'Saves a version as a template. Access is checked once, then the items are copied without the per-item policies of estimate_items and estimate_template_items. supabase/migrations/20261025094300_template_from_version_checked_once.sql.';

revoke all on function public.create_estimate_template_from_version(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.create_estimate_template_from_version(uuid, text, text) to authenticated, service_role;

create function public.read_estimate_template_items(p_tenant_id uuid, p_template_id uuid)
returns setof public.estimate_template_items
language sql
stable
security definer
set search_path = ''
as $$
  select item.*
  from public.estimate_template_items item
  where item.tenant_id = p_tenant_id
    and item.template_id = p_template_id
    and (
      (select pg_catalog.current_setting('role', true)) = 'service_role'
      or (select exists (
        select 1
        from public.estimate_templates template
        where template.id = p_template_id
          and template.tenant_id = p_tenant_id
          and (select public.is_tenant_member(p_tenant_id))
          and (
            template.created_by = (select auth.uid())
            or (select public.has_tenant_role(p_tenant_id, array['admin'::public.tenant_role]))
          )
      ))
    );
$$;

comment on function public.read_estimate_template_items(uuid, uuid) is
  'Items of one template, with the select policy of estimate_template_items checked once per statement instead of per item. supabase/migrations/20261025094300_template_from_version_checked_once.sql.';

revoke all on function public.read_estimate_template_items(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_estimate_template_items(uuid, uuid) to authenticated, service_role;

create function public.count_estimate_template_lines(p_tenant_id uuid, p_template_ids uuid[])
returns table (template_id uuid, line_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select item.template_id, count(*)::integer as line_count
  from public.estimate_template_items item
  join public.estimate_templates template
    on template.id = item.template_id
   and template.tenant_id = item.tenant_id
  where item.tenant_id = p_tenant_id
    and item.template_id = any (p_template_ids)
    and item.item_type = 'line'
    and (
      (select pg_catalog.current_setting('role', true)) = 'service_role'
      or (
        (select public.is_tenant_member(p_tenant_id))
        and (
          template.created_by = (select auth.uid())
          or (select public.has_tenant_role(p_tenant_id, array['admin'::public.tenant_role]))
        )
      )
    )
  group by item.template_id;
$$;

comment on function public.count_estimate_template_lines(uuid, uuid[]) is
  'Line counts of the named templates, with the select policy of estimate_template_items checked once for the set. supabase/migrations/20261025094300_template_from_version_checked_once.sql.';

revoke all on function public.count_estimate_template_lines(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.count_estimate_template_lines(uuid, uuid[]) to authenticated, service_role;

commit;
