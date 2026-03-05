-- UX2-010 fix: avoid PL/pgSQL output-column shadowing in RETURN QUERY.

create or replace function public.upsert_mapping_memory_bulk(p_entries jsonb)
returns table (
  tenant_id uuid,
  user_id uuid,
  source_column text,
  target_field text,
  usage_count integer,
  confidence numeric
)
language plpgsql
set search_path = public
as $$
begin
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'p_entries must be a JSON array';
  end if;

  return query
  with normalized_entries as (
    select distinct
      (entry ->> 'tenant_id')::uuid as tenant_id,
      (entry ->> 'user_id')::uuid as user_id,
      nullif(trim(entry ->> 'source_column'), '') as source_column,
      nullif(trim(entry ->> 'target_field'), '') as target_field
    from jsonb_array_elements(p_entries) as payload(entry)
    where jsonb_typeof(entry) = 'object'
  ),
  filtered_entries as (
    select
      ne.tenant_id,
      ne.user_id,
      ne.source_column,
      ne.target_field
    from normalized_entries ne
    where ne.tenant_id is not null
      and ne.user_id is not null
      and ne.source_column is not null
      and ne.target_field is not null
  ),
  upserted as (
    insert into public.mapping_memory (
      tenant_id,
      user_id,
      source_column,
      target_field,
      usage_count,
      confidence,
      last_used_at
    )
    select
      fe.tenant_id,
      fe.user_id,
      fe.source_column,
      fe.target_field,
      1,
      0.6000::numeric(5,4),
      now()
    from filtered_entries fe
    on conflict (tenant_id, user_id, source_column, target_field)
    do update
      set usage_count = mapping_memory.usage_count + 1,
          confidence = least(
            0.9800::numeric(5,4),
            round(
              (
                mapping_memory.confidence
                + ((1.0000::numeric - mapping_memory.confidence) * 0.1500::numeric)
              )::numeric,
              4
            )
          ),
          last_used_at = now()
    returning
      mapping_memory.tenant_id,
      mapping_memory.user_id,
      mapping_memory.source_column,
      mapping_memory.target_field,
      mapping_memory.usage_count,
      mapping_memory.confidence
  )
  select
    u.tenant_id,
    u.user_id,
    u.source_column,
    u.target_field,
    u.usage_count,
    u.confidence
  from upserted u;
end;
$$;
