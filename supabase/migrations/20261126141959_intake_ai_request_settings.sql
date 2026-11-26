begin;
set local lock_timeout = '5s';

-- A launch uses its upload id. A manual retry has its own id and can cover pieces
-- from several uploads. Neither selection nor connection identity is client writable.
create table private.affaire_intake_ai_batches (
  id uuid primary key,
  launch_id uuid unique references public.affaire_intake_uploads(id) on delete cascade,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  tenant_id uuid not null,
  payer_id uuid not null,
  selection jsonb not null,
  ceiling_nano_usd bigint not null,
  remaining_nano_usd bigint not null,
  budget_stop_message text,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  check (launch_id is null or launch_id = id),
  check (ceiling_nano_usd in (0, 2000000000)),
  check (remaining_nano_usd between 0 and ceiling_nano_usd)
);
create index affaire_intake_ai_batches_project_idx on private.affaire_intake_ai_batches(project_id);
create table private.affaire_intake_ai_calls (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references private.affaire_intake_ai_batches(id) on delete cascade,
  stage text not null check (stage in ('classification', 'transcription', 'brief')),
  model text not null,
  reasoning_effort text,
  bound_nano_usd bigint not null check (bound_nano_usd > 0),
  actual_model text,
  actual_cost_nano_usd bigint,
  settled_at timestamptz
);
create index affaire_intake_ai_calls_batch_idx on private.affaire_intake_ai_calls(batch_id);
alter table private.affaire_intake_ai_batches enable row level security;
alter table private.affaire_intake_ai_calls enable row level security;
revoke all on private.affaire_intake_ai_batches, private.affaire_intake_ai_calls from public, anon, authenticated, service_role;

create function public.start_affaire_intake_ai_batch(
  p_project_id uuid, p_tenant_id uuid, p_payer_id uuid, p_selection jsonb, p_retry boolean
) returns table(outcome text, batch_id uuid, piece_count integer)
language plpgsql security definer set search_path = '' as $$
declare
  reservation record;
  prior_sub text;
  source text := p_selection->>'source';
  ceiling bigint := 0;
  reads_scans boolean;
begin
  if not public.intake_payer_can_write(p_payer_id, p_tenant_id, p_project_id) then
    raise exception 'INTAKE_LAUNCH_FORBIDDEN' using errcode = '42501';
  end if;
  if source is null or source not in ('rules_only', 'chatgpt_plan', 'personal_api_key') or p_retry is null
    or (source <> 'rules_only' and coalesce(p_selection#>>'{preferences,model}', '') = '')
    or (source = 'chatgpt_plan' and (
      coalesce(p_selection#>>'{connection,profileId}', '') = '' or coalesce(p_selection#>>'{connection,authorizationId}', '') = ''))
    or (source = 'personal_api_key' and (
      coalesce(p_selection#>>'{connection,id}', '') = '' or coalesce((p_selection#>>'{connection,version}')::integer, 0) < 1)) then
    raise exception 'INTAKE_SELECTION_INVALID' using errcode = '22023';
  end if;
  reads_scans := source <> 'rules_only';
  if source = 'personal_api_key' then ceiling := 2000000000; end if;
  if p_retry then
    batch_id := gen_random_uuid();
    outcome := 'retry';
    piece_count := 0;
  else
    -- The existing admission holds the project, document and membership locks
    -- and rechecks the same active member. Keep the delegated identity local.
    prior_sub := current_setting('request.jwt.claim.sub', true);
    perform set_config('request.jwt.claim.sub', p_payer_id::text, true);
    select * into strict reservation from public.start_affaire_intake_analysis(p_project_id, reads_scans);
    perform set_config('request.jwt.claim.sub', coalesce(prior_sub, ''), true);
    outcome := reservation.outcome;
    batch_id := reservation.launch_id;
    piece_count := reservation.piece_count;
  end if;
  if outcome in ('retry', 'launched', 'brief_only') then
    insert into private.affaire_intake_ai_batches
      (id, launch_id, project_id, tenant_id, payer_id, selection, ceiling_nano_usd, remaining_nano_usd)
    values (batch_id, case when not p_retry then batch_id end, p_project_id, p_tenant_id, p_payer_id,
      p_selection, ceiling, ceiling);
  end if;
  return next;
end;
$$;

create function public.read_affaire_intake_ai_batch(p_batch_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(batch) from private.affaire_intake_ai_batches batch where batch.id = p_batch_id
$$;

-- A NULL bound records the refusal from the token-counting preflight.
-- A crashed process leaves its hold charged. A second worker must win the
-- current launch lease and reserve against the balance already debited.
create function public.reserve_affaire_intake_ai_call(
  p_batch_id uuid, p_lease_token uuid, p_stage text, p_model text, p_effort text, p_bound bigint
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  batch private.affaire_intake_ai_batches%rowtype;
  call_id uuid;
begin
  if p_lease_token is not null then
    perform 1 from public.affaire_intake_uploads where id = p_batch_id
      and status = 'launch_processing' and processing_lease_token = p_lease_token
      and processing_lease_expires_at > clock_timestamp() for no key update;
    if not found then raise exception 'INTAKE_LEASE_LOST' using errcode = '40001'; end if;
  end if;
  select * into strict batch from private.affaire_intake_ai_batches where id = p_batch_id for update;
  if (batch.launch_id is null) <> (p_lease_token is null)
    or not public.intake_payer_can_write(batch.payer_id, batch.tenant_id, batch.project_id) then
    raise exception 'INTAKE_LAUNCH_FORBIDDEN' using errcode = '42501';
  end if;
  if batch.ceiling_nano_usd = 0 or p_bound <= 0 then
    raise exception 'INTAKE_AI_BOUND_INVALID' using errcode = '22023';
  end if;
  if batch.finished_at is not null then
    raise exception 'INTAKE_AI_BATCH_CLOSED' using errcode = '40001';
  end if;
  if batch.budget_stop_message is not null then return null; end if;
  if p_bound is null or p_bound > batch.remaining_nano_usd then
    update private.affaire_intake_ai_batches set budget_stop_message = 'Analyse interrompue : la prochaine demande dépasserait le plafond de 2,00 $ US pour ce lot. Les résultats déjà enregistrés sont conservés.' where id = batch.id;
    return null;
  end if;
  update private.affaire_intake_ai_batches set remaining_nano_usd = remaining_nano_usd - p_bound where id = batch.id;
  insert into private.affaire_intake_ai_calls(batch_id, stage, model, reasoning_effort, bound_nano_usd)
    values (batch.id, p_stage, p_model, p_effort, p_bound) returning id into call_id;
  return call_id;
end;
$$;

create function public.settle_affaire_intake_ai_call(p_call_id uuid, p_model text, p_cost bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  receipt private.affaire_intake_ai_calls%rowtype;
begin
  update private.affaire_intake_ai_calls set settled_at = clock_timestamp(),
    actual_model = p_model, actual_cost_nano_usd = p_cost
    where id = p_call_id and settled_at is null returning * into receipt;
  if not found then return; end if;
  if p_cost between 0 and receipt.bound_nano_usd then
    update private.affaire_intake_ai_batches
      set remaining_nano_usd = remaining_nano_usd + (receipt.bound_nano_usd - p_cost) where id = receipt.batch_id;
  elsif p_cost > receipt.bound_nano_usd then
    update private.affaire_intake_ai_batches set budget_stop_message = 'Analyse interrompue : le coût déclaré par OpenAI dépasse la réservation. Les résultats déjà enregistrés sont conservés.' where id = receipt.batch_id;
  end if;
end;
$$;

create function public.finish_affaire_intake_ai_retry(p_batch_id uuid) returns void
language sql security definer set search_path = '' as $$
  update private.affaire_intake_ai_batches set finished_at = clock_timestamp()
    where id = p_batch_id and launch_id is null and finished_at is null
$$;

alter table public.affaire_intake_document_transcriptions
  add column ai_source text check (ai_source in ('chatgpt_plan', 'personal_api_key'));

revoke all on function public.start_affaire_intake_ai_batch(uuid, uuid, uuid, jsonb, boolean),
  public.read_affaire_intake_ai_batch(uuid), public.reserve_affaire_intake_ai_call(uuid, uuid, text, text, text, bigint),
  public.settle_affaire_intake_ai_call(uuid, text, bigint), public.finish_affaire_intake_ai_retry(uuid) from public, anon, authenticated, service_role;
grant execute on function public.start_affaire_intake_ai_batch(uuid, uuid, uuid, jsonb, boolean),
  public.read_affaire_intake_ai_batch(uuid), public.reserve_affaire_intake_ai_call(uuid, uuid, text, text, text, bigint),
  public.settle_affaire_intake_ai_call(uuid, text, bigint), public.finish_affaire_intake_ai_retry(uuid) to service_role;
commit;
