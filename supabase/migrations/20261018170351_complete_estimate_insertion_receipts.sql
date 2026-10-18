-- Keep each existing authorization, financial calculation and atomic insertion.
-- Aggregate inside SQL before PostgREST applies its max_rows to the outer response.
-- A client must invoke a writer once, never once per response page.
create or replace function public.insert_estimate_template_with_receipt(
  p_version_id uuid, p_template_id uuid, p_after_item_id uuid default null
)
returns jsonb
language sql volatile security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'count', count(*),
    'items', coalesce(jsonb_agg(to_jsonb(item) - 'ordinality' order by item.ordinality), '[]'::jsonb)
  )
  from public.insert_estimate_template_into_version(p_version_id, p_template_id, p_after_item_id) with ordinality item;
$$;

create or replace function public.insert_estimate_assembly_with_receipt(
  p_version_id uuid, p_assembly_id uuid, p_after_item_id uuid default null
)
returns jsonb
language sql volatile security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'count', count(*),
    'items', coalesce(jsonb_agg(to_jsonb(item) - 'ordinality' order by item.ordinality), '[]'::jsonb)
  )
  from public.insert_estimate_assembly_into_version(p_version_id, p_assembly_id, p_after_item_id) with ordinality item;
$$;

revoke all on function public.insert_estimate_template_with_receipt(uuid,uuid,uuid),
  public.insert_estimate_assembly_with_receipt(uuid,uuid,uuid) from public, anon;
grant execute on function public.insert_estimate_template_with_receipt(uuid,uuid,uuid),
  public.insert_estimate_assembly_with_receipt(uuid,uuid,uuid) to authenticated;
