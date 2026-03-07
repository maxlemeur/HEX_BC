-- EST-394: keep the legacy source_* columns synchronized with the final contract.
-- Older environments still enforce NOT NULL constraints on source_type/source_label.

update public.estimate_explanation_sources
set
  source_kind = coalesce(source_kind, nullif(btrim(source_type), "")),
  label = coalesce(label, nullif(btrim(source_label), "")),
  rank = coalesce(rank, display_rank, 0),
  source_type = coalesce(source_type, nullif(btrim(source_kind), "")),
  source_label = coalesce(source_label, nullif(btrim(label), "")),
  display_rank = coalesce(display_rank, rank, 0)
where
  source_kind is null
  or label is null
  or rank is null
  or source_type is null
  or source_label is null;

create or replace function public.sync_estimate_explanation_source_contract()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.source_kind := coalesce(
    nullif(btrim(new.source_kind), ''),
    nullif(btrim(new.source_type), '')
  );
  new.label := coalesce(
    nullif(btrim(new.label), ''),
    nullif(btrim(new.source_label), '')
  );
  new.rank := coalesce(new.rank, new.display_rank, 0);

  new.source_type := coalesce(
    nullif(btrim(new.source_type), ''),
    new.source_kind
  );
  new.source_label := coalesce(
    nullif(btrim(new.source_label), ''),
    new.label
  );
  new.display_rank := coalesce(new.display_rank, new.rank, 0);

  return new;
end;
$$;

drop trigger if exists sync_estimate_explanation_source_contract
  on public.estimate_explanation_sources;
create trigger sync_estimate_explanation_source_contract
  before insert or update on public.estimate_explanation_sources
  for each row execute procedure public.sync_estimate_explanation_source_contract();

notify pgrst, 'reload schema';
