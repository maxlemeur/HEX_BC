-- TI-535: all write paths share a six-calendar-month validity ceiling.
begin;

-- Backfilling expiry is not a fresh supplier quote: preserve updated_at.
alter table public.supplier_pricebook disable trigger set_supplier_pricebook_updated_at;
update public.supplier_pricebook
set valid_to = (valid_from + interval '6 months')::date
where valid_to is null or valid_to > (valid_from + interval '6 months')::date;
alter table public.supplier_pricebook enable trigger set_supplier_pricebook_updated_at;

create function public.set_supplier_pricebook_validity()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  new.valid_to := coalesce(new.valid_to, (new.valid_from + interval '6 months')::date);
  return new;
end;
$$;

revoke all on function public.set_supplier_pricebook_validity() from public, anon, authenticated;

create trigger set_supplier_pricebook_validity
before insert or update on public.supplier_pricebook
for each row execute function public.set_supplier_pricebook_validity();

alter table public.supplier_pricebook
  alter column valid_to set not null,
  add constraint supplier_pricebook_validity_six_months
    check (
      isfinite(valid_from) and isfinite(valid_to)
      and valid_to >= valid_from
      and valid_to <= (valid_from + interval '6 months')::date
    );

comment on constraint supplier_pricebook_validity_six_months on public.supplier_pricebook
  is 'TI-535: validity is mandatory and limited to six calendar months from valid_from.';

commit;
