-- Forward consolidation of the historical shared policy (remote version 20261111190106).
-- The exact applied payload remains in supabase/applied/; its identity is unchanged.
-- Document categories are optional for a manual estimate. Keep the plan-presence
-- transaction and review actual source changes, but never require plans by default.
create or replace function public.reconcile_affaire_plan_gap(
  p_project_id uuid,
  p_actor_user_id uuid default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.estimate_projects%rowtype;
  v_upload_id uuid;
  v_entry public.affaire_register_entries%rowtype;
  v_brief public.affaire_briefs%rowtype;
  v_has_plan boolean;
  v_previous_has_plan boolean;
  v_changed boolean := false;
  v_presence_changed boolean := false;
  v_brief_changed boolean := false;
  v_metadata jsonb;
  v_severity text;
  v_impacts jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'AFFAIRE_PLAN_RECONCILIATION_SERVICE_ROLE_REQUIRED';
  end if;

  -- Every reconciliation rereads committed state after taking the same lock;
  -- an older request can never subsequently publish its old snapshot.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('affaire-plan-gap:' || p_project_id::text, 0));
  select * into v_project from public.estimate_projects where id = p_project_id;
  if not found or v_project.is_archived then
    raise exception using message = 'AFFAIRE_PLAN_PROJECT_NOT_FOUND';
  end if;
  select id into v_upload_id from public.affaire_intake_uploads
    where project_id = p_project_id and tenant_id = v_project.tenant_id order by created_at desc, id desc limit 1;
  if v_upload_id is null then
    return false;
  end if;

  select public.affaire_has_stored_plan(p_project_id) into v_has_plan;

  select has_plan into v_previous_has_plan from private.affaire_plan_presence_state
    where project_id = p_project_id for update;
  if found then
    v_presence_changed := v_previous_has_plan is distinct from v_has_plan;
    if v_presence_changed then
      update private.affaire_plan_presence_state set has_plan = v_has_plan where project_id = p_project_id;
    end if;
  else
    -- New dossiers initialize their observation on their first reconciliation.
    insert into private.affaire_plan_presence_state (project_id, has_plan) values (p_project_id, v_has_plan);
  end if;

  select * into v_entry from public.affaire_register_entries
    where project_id = p_project_id and sync_key = 'missing_piece:missing_plans' for update;

  if not v_has_plan then
    if v_entry.id is null then
      v_metadata := pg_catalog.jsonb_build_object(
        'businessImpact', pg_catalog.jsonb_build_array('affects_hub_readiness', 'affects_takeoff'),
        'structuredLocation', pg_catalog.jsonb_build_object('scopeType', 'project', 'scopeId', null,
          'scopeRef', null, 'scopeLabel', v_project.name, 'versionId', null, 'sourceDocumentId', null, 'sourceFileName', null));
      insert into public.affaire_register_entries
        (tenant_id, project_id, kind, code, text, severity, status, origin_kind, scope_type, scope_label, sync_key, metadata, created_by, updated_by)
      values (v_project.tenant_id, p_project_id, 'missing_piece', 'missing_plans', 'Plans manquants',
        'warning', 'open', 'system', 'project', v_project.name, 'missing_piece:missing_plans', v_metadata, p_actor_user_id, p_actor_user_id)
      returning * into v_entry;
      insert into public.affaire_register_events (entry_id, actor_user_id, event_type, reason, after_payload)
        values (v_entry.id, p_actor_user_id, 'created', 'intake.missing_pieces_sync',
          pg_catalog.jsonb_build_object('kind', 'missing_piece', 'severity', 'warning', 'status', 'open'));
      v_changed := true;
    elsif not v_entry.is_active then
      v_metadata := v_entry.metadata - 'clientClarificationRequest' - 'continuationDecision' - 'continuationSource' - 'revalidationRequest';
      v_severity := case when v_metadata #>> '{severityDecision,mode}' = 'manual'
        and v_metadata #>> '{severityDecision,overriddenSeverity}' in ('info', 'warning', 'critical')
        then v_metadata #>> '{severityDecision,overriddenSeverity}' else 'warning' end;
      v_impacts := case when v_severity = 'critical'
        then pg_catalog.jsonb_build_array('affects_hub_readiness', 'blocks_submission', 'affects_takeoff')
        else pg_catalog.jsonb_build_array('affects_hub_readiness', 'affects_takeoff') end;
      v_metadata := v_metadata || pg_catalog.jsonb_build_object('businessImpact', v_impacts,
        'structuredLocation', pg_catalog.jsonb_build_object('scopeType', 'project', 'scopeId', null,
          'scopeRef', null, 'scopeLabel', v_project.name, 'versionId', null, 'sourceDocumentId', null, 'sourceFileName', null));
      perform public.update_affaire_register_entry_with_event(v_entry.id,
        pg_catalog.jsonb_build_object('status', 'open', 'severity', v_severity, 'is_active', true, 'metadata', v_metadata,
          'scope_label', v_project.name, 'source_file_name', null, 'source_document_id', null),
        'reactivated', 'intake.missing_pieces_sync', pg_catalog.jsonb_build_object('status', v_entry.status, 'is_active', false),
        pg_catalog.jsonb_build_object('status', 'open', 'is_active', true), p_actor_user_id);
      v_changed := true;
      v_presence_changed := true;
    end if;
  elsif v_entry.id is not null and v_entry.is_active then
    perform public.update_affaire_register_entry_with_event(v_entry.id,
      pg_catalog.jsonb_build_object('status', case when v_entry.status = 'validated' then v_entry.status else 'validated' end, 'is_active', false),
      'deactivated', 'intake.missing_pieces_sync', pg_catalog.jsonb_build_object('status', v_entry.status, 'is_active', true),
      pg_catalog.jsonb_build_object('status', 'validated', 'is_active', false), p_actor_user_id);
    v_changed := true;
    v_presence_changed := true;
  end if;

  -- Preserve the historical brief text and source links. A plan transition
  -- requires review, and a missing plan invalidates a previously recorded resolution.
  if v_changed or v_presence_changed or not v_has_plan then
    select * into v_brief from public.affaire_briefs where project_id = p_project_id for update;
    if v_brief.id is not null and (
      (not v_has_plan and v_brief.generation_metadata ? 'resolved_plan_gap_indexes') or
      (v_brief.status = 'confirme' and v_presence_changed)
    ) then
      update public.affaire_briefs set status = 'a_confirmer', confirmed_at = null,
        confirmed_by = null, updated_by = p_actor_user_id,
        generation_metadata = case when not v_has_plan then generation_metadata - 'resolved_plan_gap_indexes' else generation_metadata end
        where id = v_brief.id;
      insert into public.affaire_intake_events (upload_id, actor_user_id, event_type, reason, before_payload, after_payload)
        values (coalesce(v_brief.upload_id, v_upload_id), p_actor_user_id, 'brief.updated', 'plans.presence_sync',
          pg_catalog.jsonb_build_object('status', v_brief.status, 'resolved_plan_gap_indexes', v_brief.generation_metadata -> 'resolved_plan_gap_indexes'),
          pg_catalog.jsonb_build_object('status', 'a_confirmer'));
      v_brief_changed := true;
    end if;
  end if;
  return v_changed or v_brief_changed;
end;
$$;

revoke execute on function public.reconcile_affaire_plan_gap(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reconcile_affaire_plan_gap(uuid, uuid) to service_role;

-- Align existing automatic gaps, preserving explicit human severity decisions,
-- client clarifications, continuation hypotheses, revalidation and audit history.
do $$
declare
  v_previous_claims text := pg_catalog.current_setting('request.jwt.claims', true);
  v_entry public.affaire_register_entries%rowtype;
  v_metadata jsonb;
  v_severity text;
  v_impacts jsonb;
begin
  -- The migration runs as the database owner; the audit helper still enforces
  -- its service-only contract. Restore caller claims after this transaction-local use.
  perform pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
  for v_entry in select * from public.affaire_register_entries
    where origin_kind = 'system' and kind = 'missing_piece'
      and code in ('missing_dpgf', 'missing_plans', 'missing_cctp', 'missing_bpu_dqe')
      and sync_key = 'missing_piece:' || code
    for update
  loop
    v_metadata := v_entry.metadata;
    if v_metadata #>> '{severityDecision,mode}' = 'manual' then
      v_severity := v_entry.severity;
      v_metadata := pg_catalog.jsonb_set(v_metadata, '{severityDecision,canonicalSeverity}', '"warning"'::jsonb);
    else
      v_severity := 'warning';
      v_metadata := v_metadata || pg_catalog.jsonb_build_object('severityDecision',
        pg_catalog.jsonb_build_object('mode', 'canonical', 'canonicalSeverity', 'warning',
          'overriddenSeverity', null, 'updatedAt', pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'updatedByUserId', null));
    end if;
    v_impacts := pg_catalog.jsonb_build_array('affects_hub_readiness');
    if v_entry.code in ('missing_dpgf', 'missing_bpu_dqe') then
      v_impacts := v_impacts || '["affects_structure_generation"]'::jsonb;
    elsif v_entry.code = 'missing_plans' then
      v_impacts := v_impacts || '["affects_takeoff"]'::jsonb;
    end if;
    if v_entry.status = 'clarify_with_client' or v_metadata #>> '{clientClarificationRequest,status}' = 'clarify_with_client' then
      v_impacts := v_impacts || '["requires_client_answer"]'::jsonb;
    end if;
    if (v_severity = 'critical' and v_entry.status in ('open', 'clarify_with_client'))
      or v_metadata #>> '{revalidationRequest,status}' = 'required' then
      v_impacts := v_impacts || '["blocks_submission"]'::jsonb;
    end if;
    -- Replaying this forward policy does not duplicate an already aligned audit event.
    if v_entry.severity = v_severity
      and v_entry.metadata #>> '{severityDecision,canonicalSeverity}' = 'warning'
      and v_entry.metadata #>> '{severityDecision,mode}' in ('canonical', 'manual')
      and v_entry.metadata->'businessImpact' @> v_impacts
      and v_entry.metadata->'businessImpact' <@ v_impacts then
      continue;
    end if;
    v_metadata := v_metadata || pg_catalog.jsonb_build_object('businessImpact', v_impacts);
    perform public.update_affaire_register_entry_with_event(v_entry.id,
      pg_catalog.jsonb_build_object('severity', v_severity, 'metadata', v_metadata),
      'synced', 'intake.optional_documents',
      pg_catalog.jsonb_build_object('severity', v_entry.severity),
      pg_catalog.jsonb_build_object('severity', v_severity), null);
  end loop;
  perform pg_catalog.set_config('request.jwt.claims', coalesce(v_previous_claims, '{}'), true);
end;
$$;
