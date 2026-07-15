alter table public.estimate_versions
  add column if not exists exclusions text;

alter table public.estimate_versions
  drop constraint if exists estimate_versions_exclusions_length_check;

alter table public.estimate_versions
  add constraint estimate_versions_exclusions_length_check
  check (exclusions is null or char_length(exclusions) <= 5000);

create or replace function public.guard_estimate_version_exclusions_readonly()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'draft'
    and new.exclusions is distinct from old.exclusions
  then
    raise exception 'Estimate version exclusions are read-only';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_estimate_version_exclusions_readonly
  on public.estimate_versions;

create trigger guard_estimate_version_exclusions_readonly
before update of exclusions on public.estimate_versions
for each row
execute function public.guard_estimate_version_exclusions_readonly();

comment on column public.estimate_versions.exclusions is
  'Customer-facing scope exclusions displayed on the estimate PDF.';
