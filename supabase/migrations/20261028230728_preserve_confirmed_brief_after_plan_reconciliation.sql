-- Preserve a human confirmation after an unchanged missing-plan reconciliation.
-- Record the last observed fact separately from the user-visible register. This
-- avoids inventing a resolved gap for a dossier that has always had plans.
create table private.affaire_plan_presence_state (
  project_id uuid primary key references public.estimate_projects(id) on delete cascade,
  has_plan boolean not null
);

alter table private.affaire_plan_presence_state enable row level security;
revoke all on table private.affaire_plan_presence_state from public, anon, authenticated;

-- Existing dossiers must be observed before their first post-migration change.
insert into private.affaire_plan_presence_state (project_id, has_plan)
select p.id, public.affaire_has_stored_plan(p.id)
from public.estimate_projects p
where not p.is_archived
  and exists (select 1 from public.affaire_intake_uploads u where u.project_id = p.id and u.tenant_id = p.tenant_id);

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
        'businessImpact', pg_catalog.jsonb_build_array('affects_hub_readiness', 'blocks_submission', 'affects_takeoff'),
        'structuredLocation', pg_catalog.jsonb_build_object('scopeType', 'project', 'scopeId', null,
          'scopeRef', null, 'scopeLabel', v_project.name, 'versionId', null, 'sourceDocumentId', null, 'sourceFileName', null));
      insert into public.affaire_register_entries
        (tenant_id, project_id, kind, code, text, severity, status, origin_kind, scope_type, scope_label, sync_key, metadata, created_by, updated_by)
      values (v_project.tenant_id, p_project_id, 'missing_piece', 'missing_plans', 'Plans manquants',
        'critical', 'open', 'system', 'project', v_project.name, 'missing_piece:missing_plans', v_metadata, p_actor_user_id, p_actor_user_id)
      returning * into v_entry;
      insert into public.affaire_register_events (entry_id, actor_user_id, event_type, reason, after_payload)
        values (v_entry.id, p_actor_user_id, 'created', 'intake.missing_pieces_sync',
          pg_catalog.jsonb_build_object('kind', 'missing_piece', 'severity', 'critical', 'status', 'open'));
      v_changed := true;
    elsif not v_entry.is_active then
      v_metadata := v_entry.metadata - 'clientClarificationRequest' - 'continuationDecision' - 'continuationSource' - 'revalidationRequest';
      v_severity := case when v_metadata #>> '{severityDecision,mode}' = 'manual'
        and v_metadata #>> '{severityDecision,overriddenSeverity}' in ('info', 'warning', 'critical')
        then v_metadata #>> '{severityDecision,overriddenSeverity}' else 'critical' end;
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
      (v_brief.status = 'confirme' and (v_presence_changed or
        (v_changed and not v_has_plan and not (v_brief.missing_elements @> '["Plans manquants"]'::jsonb))))
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
