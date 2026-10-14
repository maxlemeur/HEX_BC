-- CAT-F01: retain coherent supplier-price provenance across direct writes,
-- parent updates and concurrent transactions. Existing data is never repaired
-- implicitly, and deleting a source only clears the corresponding source ID.
begin;

set local lock_timeout = '10s';

-- Keep the preflight and constraint installation on the same data snapshot.
-- Ordinary reads remain available; competing writes make migration wait/fail.
lock table public.dpgf_imports, public.dpgf_rows_mapped,
  public.supplier_pricebook in share row exclusive mode;

do $$
declare
  invalid_imports bigint;
  invalid_rows bigint;
  invalid_pairs bigint;
  invalid_mapped_imports bigint;
begin
  select count(*) into invalid_imports
  from public.supplier_pricebook price
  where price.source_import_id is not null
    and not exists (
      select 1 from public.dpgf_imports source_import
      where source_import.id = price.source_import_id
        and source_import.tenant_id = price.tenant_id
    );

  select count(*) into invalid_rows
  from public.supplier_pricebook price
  where price.source_mapped_row_id is not null
    and not exists (
      select 1 from public.dpgf_rows_mapped source_row
      where source_row.id = price.source_mapped_row_id
        and source_row.tenant_id = price.tenant_id
    );

  select count(*) into invalid_pairs
  from public.supplier_pricebook price
  where price.source_import_id is not null
    and price.source_mapped_row_id is not null
    and not exists (
      select 1 from public.dpgf_rows_mapped source_row
      where source_row.id = price.source_mapped_row_id
        and source_row.import_id = price.source_import_id
    );

  select count(*) into invalid_mapped_imports
  from public.dpgf_rows_mapped source_row
  where not exists (
    select 1 from public.dpgf_imports source_import
    where source_import.id = source_row.import_id
      and source_import.tenant_id = source_row.tenant_id
  );

  if invalid_imports > 0 or invalid_rows > 0 or invalid_pairs > 0
    or invalid_mapped_imports > 0 then
    raise check_violation using
      message = 'Existing supplier price provenance is inconsistent.',
      detail = jsonb_build_object(
        'offer_imports', invalid_imports,
        'offer_rows', invalid_rows,
        'offer_pairs', invalid_pairs,
        'mapped_imports', invalid_mapped_imports
      )::text,
      hint = 'Resolve existing provenance inconsistencies explicitly before retrying this migration.';
  end if;
end;
$$;

-- These parent keys also make changes to import/tenant acquire the key locks
-- needed by concurrent foreign-key checks. Existing source-ID indexes cover
-- the child-side lookups.
create unique index dpgf_imports_id_tenant_id_key
  on public.dpgf_imports (id, tenant_id);
create unique index dpgf_rows_mapped_id_tenant_id_key
  on public.dpgf_rows_mapped (id, tenant_id);
create unique index dpgf_rows_mapped_id_import_id_key
  on public.dpgf_rows_mapped (id, import_id);

-- Replace the original single-column relationships, retaining their names.
-- MATCH SIMPLE intentionally permits import-only and row-only provenance.
alter table public.dpgf_rows_mapped
  drop constraint dpgf_rows_mapped_import_id_fkey,
  add constraint dpgf_rows_mapped_import_id_fkey
    foreign key (import_id, tenant_id)
    references public.dpgf_imports (id, tenant_id)
    match simple on update no action on delete cascade;

alter table public.supplier_pricebook
  drop constraint supplier_pricebook_source_import_id_fkey,
  drop constraint supplier_pricebook_source_mapped_row_id_fkey,
  add constraint supplier_pricebook_source_import_id_fkey
    foreign key (source_import_id, tenant_id)
    references public.dpgf_imports (id, tenant_id)
    match simple on update no action on delete set null (source_import_id),
  add constraint supplier_pricebook_source_mapped_row_id_fkey
    foreign key (source_mapped_row_id, tenant_id)
    references public.dpgf_rows_mapped (id, tenant_id)
    match simple on update no action on delete set null (source_mapped_row_id),
  add constraint supplier_pricebook_source_pair_fkey
    foreign key (source_mapped_row_id, source_import_id)
    references public.dpgf_rows_mapped (id, import_id)
    match simple on update no action on delete set null (source_mapped_row_id);

-- Foreign keys maintain integrity, but do not enforce RLS visibility. Reject
-- absent/inaccessible sources uniformly under the caller's privileges before
-- their foreign-key checks can disclose which source IDs exist.
create function public.validate_supplier_price_provenance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- Referential SET NULL actions can run while another source is being
    -- deleted. Unchanged links and pure clears need no visibility recheck;
    -- any new source ID (even alongside a clear) must still be checked.
    if new.tenant_id is not distinct from old.tenant_id
      and (new.source_import_id is not distinct from old.source_import_id
        or new.source_import_id is null)
      and (new.source_mapped_row_id is not distinct from old.source_mapped_row_id
        or new.source_mapped_row_id is null) then
      return new;
    end if;
  end if;

  if new.source_import_id is not null and not exists (
    select 1 from public.dpgf_imports source_import
    where source_import.id = new.source_import_id
      and source_import.tenant_id = new.tenant_id
  ) then
    raise check_violation using message = 'Invalid supplier price provenance.';
  end if;

  if new.source_mapped_row_id is not null and not exists (
    select 1 from public.dpgf_rows_mapped source_row
    where source_row.id = new.source_mapped_row_id
      and source_row.tenant_id = new.tenant_id
      and (new.source_import_id is null
        or source_row.import_id = new.source_import_id)
  ) then
    raise check_violation using message = 'Invalid supplier price provenance.';
  end if;

  return new;
end;
$$;

-- PostgreSQL orders same-kind triggers by name. This runs after
-- sync_supplier_price_catalog_item has resolved the final tenant and product.
-- Do not use UPDATE OF: another BEFORE trigger can change the final tenant.
create trigger validate_supplier_price_provenance
  before insert or update on public.supplier_pricebook
  for each row execute function public.validate_supplier_price_provenance();

commit;
