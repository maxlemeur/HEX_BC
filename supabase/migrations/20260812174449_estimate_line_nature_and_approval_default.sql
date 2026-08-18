-- Make the intended composition of an estimate line explicit so quality
-- controls do not require labour on supply-only lines (or supply on
-- labour-only lines). Existing creation/import paths remain compatible: the
-- trigger derives a deterministic value when they omit the new column.

do $$
begin
  create type public.estimate_line_nature as enum (
    'supply_only',
    'supply_and_labor',
    'labor_only'
  );
exception
  when duplicate_object then null;
end
$$;

alter table public.estimate_items
  add column if not exists line_nature public.estimate_line_nature;

update public.estimate_items item
set line_nature = case
  when
    coalesce(item.h_mo, 0) > 0
    or coalesce(item.h_mo_atelier, 0) > 0
    or coalesce(item.h_mo_chantier, 0) > 0
    or item.labor_role_id is not null
    or item.labor_role_atelier_id is not null
    or item.labor_role_chantier_id is not null
  then case
    when
      coalesce(item.unit_price_ht_cents, 0) > 0
      or item.supply_type_id is not null
      or item.selected_supplier_price_id is not null
    then 'supply_and_labor'::public.estimate_line_nature
    else 'labor_only'::public.estimate_line_nature
  end
  else 'supply_only'::public.estimate_line_nature
end
where item.item_type = 'line'::public.estimate_item_type
  and item.line_nature is null;

create or replace function public.normalize_estimate_item_line_nature()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.item_type = 'section'::public.estimate_item_type then
    new.line_nature := null;
    return new;
  end if;

  if new.line_nature is null then
    if
      coalesce(new.h_mo, 0) > 0
      or coalesce(new.h_mo_atelier, 0) > 0
      or coalesce(new.h_mo_chantier, 0) > 0
      or new.labor_role_id is not null
      or new.labor_role_atelier_id is not null
      or new.labor_role_chantier_id is not null
    then
      if
        coalesce(new.unit_price_ht_cents, 0) > 0
        or new.supply_type_id is not null
        or new.selected_supplier_price_id is not null
      then
        new.line_nature := 'supply_and_labor'::public.estimate_line_nature;
      else
        new.line_nature := 'labor_only'::public.estimate_line_nature;
      end if;
    else
      new.line_nature := 'supply_only'::public.estimate_line_nature;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists normalize_estimate_item_line_nature
  on public.estimate_items;
create trigger normalize_estimate_item_line_nature
  before insert or update of item_type, line_nature
  on public.estimate_items
  for each row
  execute function public.normalize_estimate_item_line_nature();

alter table public.estimate_items
  drop constraint if exists estimate_items_line_nature_matches_item_type;
alter table public.estimate_items
  add constraint estimate_items_line_nature_matches_item_type
  check (
    (
      item_type = 'section'::public.estimate_item_type
      and line_nature is null
    )
    or (
      item_type = 'line'::public.estimate_item_type
      and line_nature is not null
    )
  );

comment on column public.estimate_items.line_nature is
  'Validation intent for a line: supply only, supply and labour, or labour only.';

-- Keep the existing atomic bulk-update implementation as the implementation
-- detail and wrap it so the new field is persisted in the same transaction.
alter function public.bulk_update_estimate_items(uuid, jsonb, jsonb, timestamptz)
  rename to bulk_update_estimate_items_without_line_nature;

create function public.bulk_update_estimate_items(
  target_version_id uuid,
  item_updates jsonb,
  version_patch jsonb default null,
  expected_version_updated_at timestamptz default null
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  updated_count integer;
begin
  updated_count := public.bulk_update_estimate_items_without_line_nature(
    target_version_id,
    item_updates,
    version_patch,
    expected_version_updated_at
  );

  update public.estimate_items item
  set line_nature = nullif(requested.payload->>'line_nature', '')::public.estimate_line_nature
  from jsonb_array_elements(item_updates) as requested(payload)
  where requested.payload ? 'line_nature'
    and item.id = (requested.payload->>'id')::uuid
    and item.version_id = target_version_id;

  return updated_count;
end;
$$;

comment on function public.bulk_update_estimate_items_without_line_nature(
  uuid,
  jsonb,
  jsonb,
  timestamptz
) is
  'Internal compatibility implementation retained by the line-nature wrapper.';

-- Existing installations created their first global approval rule with a
-- zero-cent threshold. Upgrade only that untouched default; preserve every
-- non-zero tenant customization.
update public.estimate_rules rule
set threshold_value = 500000
where rule.rule_type = 'require_approval'::public.estimate_rule_type
  and rule.scope_type = 'global'::public.estimate_rule_scope_type
  and rule.threshold_value = 0;
