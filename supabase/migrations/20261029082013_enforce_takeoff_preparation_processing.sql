-- The server persists processing choices in the confirmed preparation. Direct
-- authenticated PostgREST admissions must respect them as well. Existing jobs
-- keep their immutable admission fields and never run this INSERT-only guard.
create function private.enforce_takeoff_job_preparation_processing()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  processing jsonb := new.preparation_snapshot #> '{preparation,processing}';
  selected_level text;
  selected_provider text;
begin
  -- Older confirmations did not contain processing choices. A JSON null is the
  -- same legacy state as an absent key; historical worker transitions stay valid.
  if processing is null or processing = 'null'::jsonb then
    return new;
  end if;
  if jsonb_typeof(processing) <> 'object' then
    raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_PROCESSING_INVALID';
  end if;
  selected_level := processing ->> 'level';
  selected_provider := processing ->> 'provider';
  if selected_level is not null and selected_level is distinct from new.level::text then
    raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_LEVEL_MISMATCH';
  end if;
  if selected_provider is not null and selected_provider not in ('auto', 'chatgpt', 'gemini') then
    raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_PROCESSING_INVALID';
  end if;
  if (selected_provider = 'chatgpt' and new.execution_provider is distinct from 'chatgpt_local')
    or (selected_provider = 'gemini' and new.execution_provider is distinct from 'gemini') then
    raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_PROVIDER_MISMATCH';
  end if;
  -- An automatic preference intentionally permits either resolved provider.
  -- The existing execution-owner constraint validates that persisted choice.
  return new;
end;
$$;
revoke all on function private.enforce_takeoff_job_preparation_processing() from public, anon, authenticated;

-- The preceding aad trigger first verifies the exact server-owned confirmation.
create trigger aae_enforce_takeoff_job_preparation_processing
  before insert on public.takeoff_jobs
  for each row execute function private.enforce_takeoff_job_preparation_processing();
