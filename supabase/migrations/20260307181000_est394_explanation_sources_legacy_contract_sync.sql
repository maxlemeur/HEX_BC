-- EST-394: keep the legacy source_* columns synchronized with the final contract.
-- Older environments still enforce NOT NULL constraints on source_type/source_label.

-- PostgreSQL cannot use a newly-added enum label in the same transaction. Add
-- the labels required by the following migration here so they are committed
-- before its constraints and tables reference them.
do $$
begin
  alter type public.estimate_review_comment_scope add value if not exists 'exception';
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter type public.estimate_review_comment_scope add value if not exists 'hypothesis';
exception
  when duplicate_object then null;
end
$$;

do $alignment$
begin
  if (
    select count(*) = 3
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'estimate_explanation_sources'
      and column_name in ('source_type', 'source_label', 'display_rank')
  ) then
    execute $sql$
      update public.estimate_explanation_sources
      set
        source_kind = coalesce(source_kind, nullif(btrim(source_type), '')),
        label = coalesce(label, nullif(btrim(source_label), '')),
        rank = coalesce(rank, display_rank, 0),
        source_type = coalesce(source_type, nullif(btrim(source_kind), '')),
        source_label = coalesce(source_label, nullif(btrim(label), '')),
        display_rank = coalesce(display_rank, rank, 0)
      where
        source_kind is null
        or label is null
        or rank is null
        or source_type is null
        or source_label is null
    $sql$;

    execute $sql$
      create or replace function public.sync_estimate_explanation_source_contract()
      returns trigger
      language plpgsql
      set search_path = public
      as $function$
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
      $function$
    $sql$;

    execute 'drop trigger if exists sync_estimate_explanation_source_contract on public.estimate_explanation_sources';
    execute $sql$
      create trigger sync_estimate_explanation_source_contract
        before insert or update on public.estimate_explanation_sources
        for each row execute procedure public.sync_estimate_explanation_source_contract()
    $sql$;
  end if;
end
$alignment$;

notify pgrst, 'reload schema';
