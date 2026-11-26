-- Individual, per-plan retention of a measured answer. The released bulk command, its enum and
-- the released table and send projections keep their contracts. No existing data is backfilled.
begin;
set local lock_timeout='2s';
set local check_function_bodies=off;
lock table public.takeoff_items, public.takeoff_item_review_commands in share row exclusive mode nowait;

-- A targeted verification is tied to the facts the member saw. A rules pass immediately after
-- that save can evaluate identical results. Its clock alone does not change the justification.
create function private.takeoff_measure_row_facts(i public.takeoff_items)
returns jsonb language sql stable set search_path='' set timezone='UTC' as $$
  select to_jsonb(i) - array['rules_evaluated_at','rules_stale_at']
$$;
create table private.takeoff_measure_justifications (
  item_id uuid primary key references public.takeoff_items(id) on delete cascade,
  revision text not null
);
alter table private.takeoff_measure_justifications enable row level security;
revoke all on private.takeoff_measure_justifications from public,anon,authenticated,service_role;

-- The existing BEFORE trigger has already validated the coded reasons against these exact results.
create function private.record_takeoff_measure_justification() returns trigger language plpgsql
security definer set search_path='' as $$
begin
  if not exists(select 1 from public.takeoff_item_answer_observations o where o.takeoff_item_id=new.id and o.role='contribution')
    then return null; end if;
  insert into private.takeoff_measure_justifications as j(item_id,revision)
  values(new.id,private.takeoff_sha256(private.takeoff_measure_row_facts(new)))
  on conflict(item_id) do update set revision=excluded.revision;
  return null;
end;
$$;
create trigger record_takeoff_measure_justification after update of is_verified, verified_at, verification_justification on public.takeoff_items
  for each row when (current_user='authenticated' and new.is_verified and new.verified_by=auth.uid()
    and new.verified_at is not null and new.verification_justification is not null)
  execute function private.record_takeoff_measure_justification();

-- Released targeted reviews have no hash. An unchanged row can still prove its review:
-- its authenticated audit event followed the last row and rules revisions and names the same
-- actor, complete failures and coded reasons. A later, unprovable revision needs a new review.
create function private.takeoff_legacy_measure_justified(i public.takeoff_items)
returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from public.audit_logs log where log.tenant_id=i.tenant_id and log.user_id=i.verified_by
    and log.table_name='takeoff_items' and log.record_id=i.job_id and log.action='takeoff.item.modified'
    and log.created_at>=i.updated_at and log.created_at>=i.rules_evaluated_at
    and log.after_data#>>'{metadata,item_id}'=i.id::text and log.after_data#>>'{metadata,field}'='is_verified'
    and log.after_data#>'{metadata,next_value}'='true'::jsonb
    and log.after_data#>'{metadata,justification}'=i.verification_justification
    and log.after_data#>'{metadata,rule_failures}'=coalesce((select f.failure_keys from takeoff_internal.rule_failure_proofs f
      where f.item_id=i.id),public.takeoff_rule_failure_keys(i.rule_results)))
$$;

-- The command is immutable. A subsequent bulk decision has its own command_id and therefore
-- cannot inherit this acknowledgement. The scope, actor and instant are also in the review journal.
create table private.takeoff_retained_measures (
  command_id uuid primary key references public.takeoff_item_review_commands(id) on delete cascade,
  acknowledged jsonb not null,
  revision text not null
);
alter table private.takeoff_retained_measures enable row level security;
revoke all on private.takeoff_retained_measures from public,anon,authenticated,service_role;

-- Inputs independent of any decision, so both an undecided answer and a stored decision can use
-- the same calculation. Limit the list and observations by their indexed keys before aggregating.
create function private.takeoff_measure_facts(a public.takeoff_item_answers)
returns jsonb language sql stable set search_path='' set timezone='UTC' as $$
  with latest as (
    select r.id,r.revision from public.takeoff_list_revisions r where r.tenant_id=a.tenant_id
      and r.project_id=a.project_id order by r.revision desc limit 1
  ), entry as (
    select e.*,latest.revision from latest join public.takeoff_list_revision_entries e on e.revision_id=latest.id and e.item_id=a.item_id
  ), threshold as (
    select public.takeoff_low_confidence_threshold((select f.value from public.feature_flags f where f.tenant_id=a.tenant_id
      and f.flag_key='TAKEOFF_LOW_CONFIDENCE_THRESHOLD' and f.enabled)) as value
  ), rows_ as (
    select o.id as observation_id,i.id,i.quantity,i.unit,i.updated_at,i.rules_evaluated_at,i.is_verified,i.verified_at,i.verified_by,
      i.verification_justification,i.rule_results,private.takeoff_sha256(private.takeoff_measure_row_facts(i)) as facts_hash,
      case when i.is_verified and i.verification_justification is not null and j.item_id is null
        then private.takeoff_legacy_measure_justified(i) else false end as legacy_justified,
      not exists(select 1 from jsonb_array_elements(i.rule_results) r where r->>'status'='fail'
        and r->>'code'='AREA_PRINTED_MISMATCH'
        and i.verification_justification#>>'{area_printed,reason_code}' <> 'measured_outline_retained'
        and r#>>'{details,expected_basis}'=i.verification_justification#>>'{area_printed,retained_basis}'
        and case when jsonb_typeof(r#>'{details,printed_m2}')='number'
          then i.quantity < (r#>>'{details,printed_m2}')::numeric-0.0005 else false end) as printed_floor_met,
      j.revision as justification_revision,
      private.takeoff_item_row_anomalies(a.outcome,a.reason_code,i.id is not null,i.is_excluded,i.rules_stale,i.rule_results,
        i.confidence,t.value,i.evidence,i.source_page,i.metadata,i.quantity_entry_category,i.unit,e.expected_unit) as anomalies
    from entry e cross join threshold t join lateral (
      select obs.* from public.takeoff_item_answer_observations obs where obs.answer_id=a.id and obs.role='contribution'
    ) o on true
    left join public.takeoff_items i on i.id=o.takeoff_item_id and i.tenant_id=a.tenant_id and i.job_id=a.job_id
    left join private.takeoff_measure_justifications j on j.item_id=i.id
  ), amounts as (
    select private.takeoff_item_total(array_agg(quantity)) as quantity,min(unit) as unit,
      count(distinct private.takeoff_unit_token(unit))>1 as unit_conflict from rows_
  )
  select jsonb_build_object('answer_id',a.id,'item_id',a.item_id,'plan_id',a.plan_logical_id,'answer_revision',a.content_sha256,
    'list_revision_id',e.revision_id,'list_revision',e.revision,'reference',e.reference_quantity,'origin',e.origin,
    'marks_revision',private.takeoff_count_marks_revision(a.id),'quantity',q.quantity,'unit',q.unit,
    'expected_unit',e.expected_unit,'gap',abs(q.quantity-e.reference_quantity),
    'gap_required',coalesce(private.takeoff_quantity_requires_review(e.reference_quantity,q.quantity),false),
    'unit_conflict',q.unit_conflict,'rows',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'observation_id',r.observation_id,
      'revision',r.facts_hash,'updated_at',r.updated_at,'rules_evaluated_at',r.rules_evaluated_at,'anomalies',r.anomalies,
      'verified_by',r.verified_by,'verified_at',r.verified_at,'justification',r.verification_justification,
      'rule_results',r.rule_results,'justified',coalesce(r.is_verified and r.verified_at is not null and r.verified_by is not null
        and r.verification_justification is not null and r.printed_floor_met and (r.justification_revision=r.facts_hash or r.legacy_justified),false)) order by r.observation_id) from rows_ r),'[]'::jsonb))
  from entry e cross join amounts q
$$;

create function private.takeoff_item_decision_effective(d public.takeoff_item_answer_decisions,a public.takeoff_item_answers,
  p_unverified boolean,p_marks integer,p_retained private.takeoff_retained_measures)
returns text language sql stable set search_path='' as $$
  select case when p_retained.command_id is not null and d.kind='accepted'
      and p_retained.revision is distinct from private.takeoff_sha256(private.takeoff_measure_facts(a)) then 'none'
    else private.takeoff_item_decision_effective(d.kind,p_unverified,d.marks_revision,p_marks) end
$$;
create or replace function private.takeoff_item_table_pairs(p_tenant_id uuid, p_project_id uuid, p_plan_logical_id uuid)
returns table (item_id uuid, plan_logical_id uuid, plan_file_id uuid, plan_name text, plan_generation text, job_id uuid,
  unit_state text, reading text, answer_id uuid, outcome text, location_key text, location_label text,
  decision_kind text, decision_revision integer, plan_entry_id uuid, answer_job_id uuid, sent boolean,
  decision_effective text)
language sql stable security definer set search_path = '' as $$
  select p.item_id, p.plan_logical_id, p.plan_file_id, p.plan_name, p.plan_generation, p.job_id, p.unit_state, p.reading,
    p.answer_id, p.outcome, loc.location_key, loc.location_label, d.kind, coalesce(d.revision, 0),
    case when p_plan_logical_id is null then pe.id end, a.job_id, coalesce(aj.status::text = 'applied', false),
    private.takeoff_item_decision_effective(d,a,exists (select 1 from public.takeoff_item_answer_observations o
        join public.takeoff_items i on i.id = o.takeoff_item_id
        where o.answer_id = p.answer_id and o.role = 'contribution' and not i.is_verified),
      private.takeoff_count_marks_revision(p.answer_id),retained)
  from private.takeoff_item_reading_pairs(p_tenant_id, p_project_id, p_plan_logical_id) p
  left join public.takeoff_item_answers a on a.id = p.answer_id
  left join public.takeoff_jobs aj on aj.id = a.job_id and aj.tenant_id = p_tenant_id
  left join public.takeoff_item_answer_decisions d on d.answer_id = p.answer_id
  left join private.takeoff_retained_measures retained on retained.command_id=d.command_id
  left join public.takeoff_item_entries pe on pe.tenant_id = p_tenant_id and pe.project_id = p_project_id
    and pe.item_id = p.item_id and pe.plan_logical_id = p.plan_logical_id
  left join lateral (
    select coalesce(l.building, '') || '|' || coalesce(l.level, '') as location_key,
      pg_catalog.concat_ws(' · ', l.building, l.level) as location_label
    from public.takeoff_plan_locations l
    where l.tenant_id = p_tenant_id and l.project_id = p_project_id and l.source_id = p.plan_logical_id
      and (l.building is not null or l.level is not null)
    order by l.updated_at desc, l.id
    limit 1
  ) loc on true
$$;

create function private.takeoff_measure_review(a public.takeoff_item_answers)
returns jsonb language plpgsql stable set search_path='' as $$
declare
  facts jsonb := private.takeoff_measure_facts(a);
  pair record;
  reason text;
  row_ jsonb;
  rows_to_justify uuid[] := '{}';
  rules_required boolean := false;
  proof_required boolean := false;
  options jsonb;
begin
  select p.* into pair from private.takeoff_item_table_pairs(a.tenant_id,a.project_id,a.plan_logical_id) p where p.answer_id=a.id;
  if not found or facts is null then return jsonb_build_object('reason','answer_changed'); end if;
  options:=private.takeoff_item_quantity_options(a.id);
  reason:=case
    when pair.sent then 'sent'
    when pair.reading<>'answered' then 'coverage_incomplete'
    when a.outcome<>'measured' then 'not_measured'
    when exists(select 1 from public.takeoff_item_entries e where e.tenant_id=a.tenant_id and e.project_id=a.project_id
      and e.item_id=a.item_id and (e.plan_logical_id=a.plan_logical_id or e.plan_logical_id is null)) then 'entered'
    when options->'available'='true' and options->'alternative_quantity' is distinct from options#>'{verified,quantity}'
      then 'quantity_choice'
    when pair.decision_effective<>'none' then 'already_decided'
    when facts->'unit_conflict'='true' then 'unit_conflict'
    when jsonb_array_length(facts->'rows')=0 then 'missing_evidence' end;
  for row_ in select value from jsonb_array_elements(facts->'rows') loop
    reason:=coalesce(reason,(select x from unnest(array['missing_evidence','rules_stale','unit_mismatch','alert','hypothesis']) x
      where row_->'anomalies' ? x limit 1));
    proof_required:=proof_required or row_->'anomalies' ? 'low_confidence';
    if row_->'anomalies' ? 'rule_failed' then
      rules_required:=true;
      if exists(select 1 from jsonb_array_elements(row_->'rule_results') r where r->>'status'='fail'
          and r->'acceptable' is distinct from 'true'::jsonb) then
        reason:=coalesce(reason,'rule_not_acceptable');
      elsif not exists(select 1 from jsonb_array_elements(row_->'rule_results') r where r->>'status'='fail'
          and (r->>'rule'='dn_network' or r->>'code' in ('SCALE_DIMENSION_MISMATCH','AREA_PRINTED_MISMATCH'))) then
        reason:=coalesce(reason,'rule_without_coded_justification');
      elsif row_->'justified' is distinct from 'true'::jsonb then
        rows_to_justify:=array_append(rows_to_justify,(row_->>'id')::uuid);
      end if;
    end if;
  end loop;
  if cardinality(rows_to_justify)>0 then reason:=coalesce(reason,'justification_required'); end if;
  return facts || jsonb_build_object('revision',private.takeoff_sha256(jsonb_build_array(facts,pair.decision_revision)),
    'decision_revision',pair.decision_revision,'reason',reason,'rows_to_justify',rows_to_justify,
    'rules_required',rules_required,'proof_required',proof_required);
end;
$$;

create function public.read_takeoff_measure_review(p_tenant_id uuid,p_project_id uuid,p_answer_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.takeoff_item_answers;
begin
  if auth.uid() is null or p_tenant_id is distinct from public.current_tenant_id()
    or not coalesce(private.can_access_takeoff_scope(p_tenant_id,p_project_id,null,false),false) then
    raise exception 'TAKEOFF_ITEM_REVIEW_FORBIDDEN' using errcode='42501';
  end if;
  select * into strict a from public.takeoff_item_answers
    where (tenant_id,project_id,id)=(p_tenant_id,p_project_id,p_answer_id);
  return private.takeoff_measure_review(a);
end;
$$;

create function public.retain_takeoff_measure(p_tenant_id uuid,p_project_id uuid,p_answer_id uuid,
  p_intent_key uuid,p_acknowledgement jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid();
  a public.takeoff_item_answers;
  job public.takeoff_jobs;
  prior public.takeoff_item_review_commands;
  review jsonb;
  receipt uuid:=gen_random_uuid();
  digest text:=private.takeoff_sha256(jsonb_build_array('retain_measure',p_answer_id,p_acknowledgement));
  decided timestamptz;
  result jsonb;
  reason text;
begin
  if actor is null or p_tenant_id is distinct from public.current_tenant_id()
    or not coalesce(private.can_access_takeoff_scope(p_tenant_id,p_project_id,null,false),false)
    or not coalesce(private.takeoff_item_list_writer(p_tenant_id,p_project_id,actor),false) then
    raise exception 'TAKEOFF_ITEM_REVIEW_FORBIDDEN' using errcode='42501';
  end if;
  if p_intent_key is null or (private.takeoff_item_send_keys(p_acknowledgement,
    array['revision','gap_checked','rules_checked','proof_checked'])
    and (p_acknowledgement->>'revision') ~ '^[0-9a-f]{64}$'
    and jsonb_typeof(p_acknowledgement->'revision')='string'
    and jsonb_typeof(p_acknowledgement->'gap_checked')='boolean' and jsonb_typeof(p_acknowledgement->'rules_checked')='boolean'
    and jsonb_typeof(p_acknowledgement->'proof_checked')='boolean') is not true then
    raise exception 'TAKEOFF_ITEM_REVIEW_INVALID' using errcode='22023';
  end if;
  -- Project first (the send and publication lock it too), list, review, job rules,
  -- marks, then contributions in ID order. Re-read the decision and every acknowledgement under these locks.
  perform 1 from public.estimate_projects where id=p_project_id and tenant_id=p_tenant_id for key share;
  perform private.lock_takeoff_item_list(p_project_id);
  perform pg_advisory_xact_lock(hashtextextended('takeoff-item-review:'||p_project_id,0));
  if p_tenant_id is distinct from public.current_tenant_id() or
    not coalesce(private.takeoff_item_list_writer(p_tenant_id,p_project_id,actor),false) then
    raise exception 'TAKEOFF_ITEM_REVIEW_FORBIDDEN' using errcode='42501';
  end if;
  select * into prior from public.takeoff_item_review_commands
    where (tenant_id,project_id,intent_key)=(p_tenant_id,p_project_id,p_intent_key);
  if found then
    if prior.actor_id<>actor or prior.command_sha256<>digest then raise exception 'TAKEOFF_ITEM_REVIEW_INTENT_CONFLICT' using errcode='23505'; end if;
    return prior.outcome || '{"replayed":true}'::jsonb;
  end if;
  select * into strict a from public.takeoff_item_answers where (tenant_id,project_id,id)=(p_tenant_id,p_project_id,p_answer_id);
  select * into strict job from public.takeoff_jobs where (tenant_id,project_id,id)=(p_tenant_id,p_project_id,a.job_id);
  if job.estimate_version_id is null then
    perform pg_advisory_xact_lock(hashtextextended('takeoff-job-rules:'||job.id,0));
    perform pg_advisory_xact_lock(hashtextextended('takeoff-job:'||job.id,0));
  else perform pg_advisory_xact_lock(hashtextextended('takeoff-rules:'||job.estimate_version_id,0));
  end if;
  perform 1 from public.takeoff_jobs where id=job.id for share;
  perform private.lock_takeoff_count_marks_revision(a.id);
  perform 1 from public.takeoff_items i join public.takeoff_item_answer_observations o on o.takeoff_item_id=i.id
    where o.answer_id=a.id and o.role='contribution' order by i.id for update of i;
  review:=private.takeoff_measure_review(a);
  if review->>'reason'='answer_changed' or review->'revision' is distinct from p_acknowledgement->'revision' then
    return jsonb_build_object('outcome','stale');
  end if;
  reason:=coalesce(review->>'reason',case
    when review->'gap_required'='true' and p_acknowledgement->'gap_checked'<>'true' then 'gap_confirmation_required'
    when review->'proof_required'='true' and p_acknowledgement->'proof_checked'<>'true' then 'proof_confirmation_required'
    when review->'rules_required'='true' and p_acknowledgement->'rules_checked'<>'true' then 'rules_confirmation_required' end);
  if reason is not null then return jsonb_build_object('outcome','refused','reason',reason); end if;
  decided:=clock_timestamp();
  with verified as (
    update public.takeoff_items i set is_verified=true,verified_at=decided,verified_by=actor
    from public.takeoff_item_answer_observations o where o.answer_id=a.id and o.role='contribution' and o.takeoff_item_id=i.id
      and not i.is_verified returning i.id
  ) insert into public.takeoff_item_review_events(tenant_id,project_id,command_id,item_id,answer_id,plan_logical_id,
    takeoff_item_id,event,before,after,actor_id,at)
  select a.tenant_id,a.project_id,receipt,a.item_id,a.id,a.plan_logical_id,id,'row_verified','{"is_verified":false}','{"is_verified":true}',actor,decided
    from verified;
  insert into public.takeoff_item_answer_decisions as d(answer_id,tenant_id,project_id,item_id,plan_logical_id,kind,revision,actor_id,
      decided_at,command_id,marks_revision)
    values(a.id,a.tenant_id,a.project_id,a.item_id,a.plan_logical_id,'accepted',1,actor,decided,receipt,(review->>'marks_revision')::integer)
    on conflict(answer_id) do update set kind='accepted',revision=d.revision+1,actor_id=actor,decided_at=decided,command_id=receipt,
      reason=null,note=null,marks_revision=excluded.marks_revision,quantity_source=null,chosen_entry_revision=null;
  result:=jsonb_build_object('outcome','applied','command_id',receipt,'item_id',a.item_id,'answer_id',a.id);
  insert into public.takeoff_item_review_commands(id,tenant_id,project_id,intent_key,actor_id,gesture,command_sha256,outcome,created_at)
    values(receipt,a.tenant_id,a.project_id,p_intent_key,actor,'accept_measured',digest,result,decided);
  insert into private.takeoff_retained_measures(command_id,acknowledged,revision) values(receipt,
    review || jsonb_build_object('confirmation',p_acknowledgement),private.takeoff_sha256(private.takeoff_measure_facts(a)));
  insert into public.takeoff_item_review_events(tenant_id,project_id,command_id,item_id,answer_id,plan_logical_id,event,before,after,actor_id,at)
    values(a.tenant_id,a.project_id,receipt,a.item_id,a.id,a.plan_logical_id,'accepted','{"kind":"none"}',
      jsonb_build_object('kind','accepted','quantity',review->'quantity','unit',review->'unit','individual',true),actor,decided);
  return result || '{"replayed":false}'::jsonb;
end;
$$;
-- The final reconciliation is for the actual draft line. The preview supplies the composition
-- it computed. The writer calls the same comparison with its own locked sums and DPGF lineage.
create function private.takeoff_measure_destination(p_tenant uuid,p_project uuid,p_job uuid,p_version uuid,p_target jsonb,
  p_reference numeric,p_measured numeric,p_gap numeric,p_after numeric)
returns jsonb language plpgsql stable set search_path='' as $$
declare
  saved record;
  line_id uuid := (p_target#>>'{line,estimate_item_id}')::uuid;
  matched boolean;
begin
  select r.acknowledged,d.answer_id,d.revision into saved from public.takeoff_item_answers a
    join public.takeoff_item_answer_decisions d on d.answer_id=a.id and d.kind='accepted'
    join private.takeoff_retained_measures r on r.command_id=d.command_id
    where (a.tenant_id,a.project_id,a.job_id,a.item_id)=(p_tenant,p_project,p_job,(p_target->>'item_id')::uuid);
  if not found then return null; end if;
  matched:=case when saved.acknowledged#>>'{origin,kind}'='dpgf' then
    p_target#>>'{line,kind}'='dpgf_line' and exists(select 1 from public.read_estimate_dpgf_raw_rows(p_tenant,p_version) l
      where l.estimate_item_id=line_id and l.raw_row_id::text=lower(saved.acknowledged#>>'{origin,rawRowId}')
      and l.import_id::text=lower(saved.acknowledged#>>'{origin,importId}'))
    else p_target#>>'{line,kind}'<>'dpgf_line' end;
  if matched and p_reference is not distinct from (saved.acknowledged->>'reference')::numeric
    and p_gap is not distinct from (saved.acknowledged->>'gap')::numeric
    and (p_reference is null or p_measured=(saved.acknowledged->>'quantity')::numeric)
    then return null; end if;
  return jsonb_build_object('target',p_target->>'key','answer_id',saved.answer_id,'decision_revision',saved.revision,
    'version_id',p_version,'line_id',line_id,'matched',matched,'reference',p_reference,'measured',p_measured,
    'unit',p_target->>'unit_code','gap',p_gap,'quantity_after',p_after);
end;
$$;

create function public.read_takeoff_measure_destination_reviews(p_tenant_id uuid,p_project_id uuid,p_plan jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  job uuid;
  version_id uuid;
  reviews jsonb;
begin
  if auth.uid() is null or p_tenant_id is distinct from public.current_tenant_id()
    or not coalesce(private.can_access_takeoff_scope(p_tenant_id,p_project_id,null,false),false) then
    raise exception 'TAKEOFF_ITEM_REVIEW_FORBIDDEN' using errcode='42501';
  end if;
  if private.takeoff_item_send_plan_valid(p_plan) is not true then raise exception 'TAKEOFF_ITEM_SEND_INVALID' using errcode='22023'; end if;
  job:=(p_plan->>'job_id')::uuid;
  version_id:=(p_plan#>>'{destination,version_id}')::uuid;
  if not exists(select 1 from public.takeoff_jobs j where (j.id,j.tenant_id,j.project_id)=(job,p_tenant_id,p_project_id))
    or (version_id is not null and not exists(select 1 from public.estimate_versions v where
      (v.id,v.tenant_id,v.project_id)=(version_id,p_tenant_id,p_project_id))) then
    raise exception 'TAKEOFF_JOB_NOT_FOUND' using errcode='P0002';
  end if;
  with checks as materialized (
    select t.n,private.takeoff_measure_destination(p_tenant_id,p_project_id,job,version_id,t.target,
      (t.target#>>'{quantity,reference}')::numeric,(t.target#>>'{quantity,measured}')::numeric,
      (t.target#>>'{quantity,gap,absolute}')::numeric,(t.target->>'quantity_after')::numeric) as check_
    from jsonb_array_elements(p_plan->'targets') with ordinality t(target,n)
  ) select coalesce(jsonb_agg(check_ order by n) filter(where check_ is not null),'[]'::jsonb) into reviews from checks;
  return reviews;
end;
$$;

-- Printed-area deviations on older DPGF parts contribute to the cumulative gap even when
-- the signed quantity deviations cancel. The same valid stored parts feed composeDpgfTarget.
create function private.takeoff_measure_printed_gap(p_metadata jsonb,p_job uuid)
returns numeric language sql immutable set search_path='' as $$
  select coalesce(sum((part->>'printed_gap')::numeric),0) from jsonb_array_elements(case
      when p_metadata#>'{takeoff_quantity_policy,version}'='2' and jsonb_typeof(p_metadata#>'{takeoff_quantity_policy,contributions}')='array'
      then p_metadata#>'{takeoff_quantity_policy,contributions}' else '[]'::jsonb end) part
    where jsonb_typeof(part->'job_id')='string' and part->>'job_id'<>p_job::text
      and jsonb_typeof(part->'quantity')='number' and jsonb_typeof(part->'printed_gap')='number'
      and case when jsonb_typeof(part->'item_ids')='array' then jsonb_array_length(part->'item_ids')>0 and not exists(
        select 1 from jsonb_array_elements(part->'item_ids') x where jsonb_typeof(x)<>'string') else false end
$$;
-- Keep a single ascending lock order for the current individual decisions, the verified
-- counts and the earlier parts. One marks edit can touch answers in all three groups.
create or replace function private.takeoff_item_send_lock_proofs(p_tenant uuid, p_job uuid, p_version uuid, p_targets jsonb)
returns boolean language plpgsql set search_path = '' as $$
declare
  proof record;
  current_revision integer;
  valid boolean := true;
begin
  for proof in
    with needed(answer_id, earlier_revision) as (
      select a.id, null::integer from public.takeoff_item_answers a
      join public.takeoff_item_answer_decisions d on d.answer_id = a.id
      left join private.takeoff_retained_measures retained on retained.command_id = d.command_id
      where a.tenant_id = p_tenant and a.job_id = p_job and (d.quantity_source = 'verified_count' or retained.command_id is not null)
      union all
      select part.answer_id, part.marks_revision from public.takeoff_item_send_parts part
      join public.takeoff_item_answers a on a.id = part.answer_id and a.tenant_id = part.tenant_id and a.project_id = part.project_id
      join public.takeoff_jobs current_job on current_job.id = p_job and current_job.project_id = part.project_id
        and current_job.tenant_id = part.tenant_id
      where part.tenant_id = p_tenant and part.version_id = p_version and part.state = 'live'
        and part.kind = 'verified_count' and exists (select 1 from jsonb_array_elements(p_targets) target
          where target ->> 'item_id' = part.item_id::text)
    )
    select answer_id, min(earlier_revision) as oldest, max(earlier_revision) as newest
    from needed group by answer_id order by answer_id
  loop
    current_revision := private.lock_takeoff_count_marks_revision(proof.answer_id);
    if proof.oldest is not null and (current_revision is distinct from proof.oldest
        or current_revision is distinct from proof.newest) then
      valid := false;
    end if;
  end loop;
  return valid;
end;
$$;

create or replace function private.apply_takeoff_item_send_plan(p_tenant_id uuid, p_actor_id uuid, p_module_default boolean, p_request jsonb,
  p_revision_receipt uuid, p_revision_parts jsonb, p_check_only boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := p_actor_id;
  tenant uuid := p_tenant_id;
  confirmations jsonb := '[]'::jsonb;
  confirmation jsonb;
  cumulative numeric;
  cumulative_gap numeric;
  has_retained boolean;
  plan jsonb := p_request -> 'plan';
  deps jsonb := p_request #> '{plan,dependencies}';
  request uuid;
  target_job_id uuid;
  plan_sha text;
  destination_kind text;
  send_breakdown text;
  actor_role public.tenant_role;
  job public.takeoff_jobs%rowtype;
  project public.estimate_projects%rowtype;
  launch public.takeoff_launch_requests%rowtype;
  existing public.takeoff_item_send_receipts%rowtype;
  this_receipt uuid := coalesce(p_revision_receipt,gen_random_uuid());
  target_version uuid;
  version_row public.estimate_versions%rowtype;
  created_version boolean := false;
  created jsonb;
  created_lock uuid;
  plan_entry jsonb;
  plan_key uuid;
  unit_pages integer[];
  plan_document jsonb;
  job_parts jsonb;
  earlier_proofs_current boolean;
  corrected_part_ids uuid[] := '{}';
  incoming_count jsonb;
  whole_plan boolean;
  blocked_part public.takeoff_item_send_parts%rowtype;
  count_proof jsonb;
  held jsonb := '[]'::jsonb;
  stale text;
  answers jsonb;
  target jsonb;
  part record;
  line public.estimate_items%rowtype;
  live_target_id uuid;
  live_target public.takeoff_item_send_targets%rowtype;
  entry_row public.takeoff_list_revision_entries%rowtype;
  identity jsonb;
  factor numeric;
  added numeric;
  kept_sum numeric;
  all_sum numeric;
  parts_count integer;
  legacy_measure numeric;
  legacy_protective numeric;
  legacy_count integer;
  reference numeric;
  retained numeric;
  expected_before numeric;
  after numeric;
  typed boolean;
  choice text;
  covered integer[];
  replaced_ids uuid[] := '{}'::uuid[];
  target_replaced uuid[];
  page_replaced uuid[] := '{}'::uuid[];
  computed jsonb := '{}'::jsonb;
  facts jsonb;
  section_ids jsonb := '{}'::jsonb;
  section jsonb;
  decision jsonb;
  new_id uuid;
  parent uuid;
  next_position integer;
  previous_writer text;
  written_ids uuid[] := '{}'::uuid[];
  lines_out jsonb := '[]'::jsonb;
  sections_out jsonb := '[]'::jsonb;
  outcome jsonb;
  focus uuid;
  stored_count integer;
  listed_count integer;
begin
  -- The caller and the shape of the request. A NULL predicate refuses.
  if actor is null or tenant is null then
    raise exception 'TAKEOFF_ITEM_SEND_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if pg_catalog.jsonb_typeof(p_request) is distinct from 'object'
    or (p_request - array['request_id', 'plan', 'version_payload', 'override']) <> '{}'::jsonb
    or private.takeoff_item_send_uuid(p_request -> 'request_id') is not true
    or private.takeoff_item_send_plan_valid(plan - 'measure_confirmations') is not true
    or (plan ? 'measure_confirmations' and (p_revision_receipt is not null or
      jsonb_typeof(plan->'measure_confirmations') is distinct from 'array' or
      octet_length(plan::text)>8388608))
    or ((plan #>> '{destination,kind}' = 'first_draft')
      = coalesce(pg_catalog.jsonb_typeof(p_request -> 'version_payload') = 'object', false)) is not true then
    raise exception 'TAKEOFF_ITEM_SEND_INVALID' using errcode = '22023';
  end if;
  if coalesce(p_request -> 'override', 'null'::jsonb) <> 'null'::jsonb then
    raise exception 'TAKEOFF_ITEM_SEND_OVERRIDE_NOT_ADMITTED' using errcode = '22023';
  end if;
  request := (p_request ->> 'request_id')::uuid;
  target_job_id := (plan ->> 'job_id')::uuid;
  destination_kind := plan #>> '{destination,kind}';
  send_breakdown := plan ->> 'breakdown';
  plan_key := (plan ->> 'plan_key')::uuid;
  plan_sha := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(plan::text, 'UTF8')), 'hex');

  select * into job from public.takeoff_jobs as candidate where candidate.id = target_job_id;
  if not found or job.tenant_id is distinct from tenant then
    raise exception 'TAKEOFF_JOB_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_check_only then
    -- The server can show a correction without acquiring the editor lease.
    -- This branch performs ordinary reads; the writer later repeats every
    -- check under the usual locks, including the lease and the proof rows.
    if p_revision_receipt is null or destination_kind<>'existing_draft' then
      raise exception 'TAKEOFF_REVISION_INVALID' using errcode='22023';
    end if;
    target_version:=(plan#>>'{destination,version_id}')::uuid;
    select * into project from public.estimate_projects where id=job.project_id and tenant_id=tenant;
    select * into version_row from public.estimate_versions where id=target_version and tenant_id=tenant and project_id=job.project_id;
    select * into launch from public.takeoff_launch_requests where id=job.launch_request_id and tenant_id=tenant;
    earlier_proofs_current:=not exists(select 1 from public.takeoff_item_send_parts p join public.takeoff_item_answers a on a.id=p.answer_id
      where p.version_id=target_version and p.tenant_id=tenant and p.state='live' and p.kind='verified_count'
        and exists(select 1 from jsonb_array_elements(plan->'targets') t where t->>'item_id'=p.item_id::text)
        and p.marks_revision is distinct from private.takeoff_count_marks_revision(a.id));
  else
    -- Rank 1, then the affaire's row and B2's review key (rank 2).
    perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('estimate-calc-policy:' || tenant::text, 0));
    if destination_kind = 'first_draft' then
      select * into project from public.estimate_projects as row_project
      where row_project.id = job.project_id and row_project.tenant_id = tenant for update;
    else
      select * into project from public.estimate_projects as row_project
      where row_project.id = job.project_id and row_project.tenant_id = tenant for no key update;
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-item-review:' || job.project_id::text, 0));
    -- Rank 3: an existing draft's keys and row (judged below, once every lock is held).
    if destination_kind = 'existing_draft' then
      target_version := (plan #>> '{destination,version_id}')::uuid;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-rules:' || target_version::text, 0));
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_version::text, 0));
      select * into version_row from public.estimate_versions as version
      where version.id = target_version and version.tenant_id = tenant and version.project_id = job.project_id
      for no key update;
    end if;
    -- Rank 5, 6 and 8.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-job-rules:' || target_job_id::text, 0));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-job:' || target_job_id::text, 0));
    select * into job from public.takeoff_jobs as candidate where candidate.id = target_job_id for update;
    select * into launch from public.takeoff_launch_requests as request_row
    where request_row.id = job.launch_request_id and request_row.tenant_id = tenant;
    if launch.id is not null then
      perform 1 from public.takeoff_launch_requests as request_row where request_row.id = launch.id for no key update;
    end if;
    perform 1 from public.takeoff_mapping_rules as rule where rule.tenant_id = tenant for share;
    earlier_proofs_current := private.takeoff_item_send_lock_proofs(tenant, target_job_id, target_version, plan -> 'targets');
    perform 1 from public.takeoff_items i join public.takeoff_item_answer_observations o on o.takeoff_item_id=i.id
      join public.takeoff_item_answer_decisions d on d.answer_id=o.answer_id
      join private.takeoff_retained_measures m on m.command_id=d.command_id
      where i.job_id=target_job_id and o.role='contribution' order by i.id for share of i;
    if destination_kind = 'existing_draft' then
      perform 1 from public.estimate_items as item
      where item.version_id = target_version and item.tenant_id = tenant
        and item.id in (select private.takeoff_uuid_or_null(listed.value -> 'estimate_item_id')
            from pg_catalog.jsonb_array_elements(deps -> 'lines') as listed(value)
          union select private.takeoff_uuid_or_null(listed.value #> '{line,estimate_item_id}')
            from pg_catalog.jsonb_array_elements(plan -> 'targets') as listed(value))
      order by item.id for update;
    end if;

  end if;

  -- The actor's rights, now, after every wait and before any answer: a member of this tenant who may operate its
  -- takeoffs, the affaire's owner engineer or an administrator, the affaire not archived, the module admitted.
  select membership.role into actor_role from public.tenant_memberships as membership
  where membership.tenant_id = tenant and membership.user_id = actor;
  if actor_role is null or actor_role not in ('admin'::public.tenant_role, 'engineer'::public.tenant_role)
    or project.id is null or project.is_archived is not false
    or (actor_role <> 'admin'::public.tenant_role and project.user_id is distinct from actor) then
    raise exception 'TAKEOFF_ITEM_SEND_PROJECT_NOT_WRITABLE' using errcode = '42501';
  end if;
  -- And this tenant is still the one the actor works in, as the application resolves it (public.current_tenant_id(),
  -- readActiveTenantMembership: the default membership first, then the oldest, among active tenants): a tenant suspended,
  -- or the member gone to another tenant, during the waits refuses, before any answer.
  if (select membership.tenant_id from public.tenant_memberships as membership
      join public.tenants as tenant_row on tenant_row.id = membership.tenant_id and tenant_row.is_active
      where membership.user_id = actor
      order by membership.is_default desc, membership.created_at asc limit 1) is distinct from tenant then
    raise exception 'TAKEOFF_ITEM_SEND_PROJECT_NOT_WRITABLE' using errcode = '42501',
      detail = pg_catalog.jsonb_build_object('reason', 'tenant_changed')::text;
  end if;
  if coalesce(private.takeoff_module_enabled(tenant, coalesce(p_module_default, false)), false) is not true then
    raise exception 'TAKEOFF_ITEM_SEND_MODULE_DISABLED' using errcode = '55000';
  end if;
  -- A send of this request that committed meanwhile is visible: the same request and the same plan answer the same;
  -- another plan, another job or another member under it is a conflict.
  select * into existing from public.takeoff_item_send_receipts as stored
  where stored.tenant_id = tenant and stored.request_id = request;
  if found then
    if existing.actor_id = actor and existing.job_id = target_job_id and existing.plan_sha256 = plan_sha then
      return pg_catalog.jsonb_build_object('receipt_id', existing.id, 'replayed', true) || existing.result;
    end if;
    raise exception 'TAKEOFF_ITEM_SEND_REQUEST_CONFLICT' using errcode = '40001';
  end if;
  -- A job sent stays sent: another confirmation of it is told so before anything else.
  if p_revision_receipt is null and (job.estimate_version_id is not null or job.status = 'applied'::public.takeoff_job_status
    or exists (select 1 from public.takeoff_item_send_receipts as stored where stored.job_id = target_job_id)) then
    raise exception 'TAKEOFF_ITEM_SEND_ALREADY_SENT' using errcode = '40001';
  end if;
  if launch.id is null or launch.item_list_revision_id is null
    or not exists (select 1 from public.takeoff_item_answer_publications as publication
      where publication.job_id = target_job_id and publication.tenant_id = tenant) then
    raise exception 'TAKEOFF_ITEM_SEND_NOT_ITEM_LIST' using errcode = '22023';
  end if;
  if job.status is distinct from (case when p_revision_receipt is null then 'completed' else 'applied' end)::public.takeoff_job_status then
    raise exception 'TAKEOFF_ITEM_SEND_JOB_NOT_READY' using errcode = '40001';
  end if;

  -- Only the revision writer calls the private addition path. Its version and job were locked
  -- before it derived the changed sources. A correction cannot create a second draft.
  if p_revision_receipt is not null and (destination_kind <> 'existing_draft' or jsonb_typeof(p_revision_parts) is distinct from 'array') then
    raise exception 'TAKEOFF_REVISION_INVALID' using errcode='22023';
  end if;

  -- The destination: a first draft only on an affaire without a version; a draft that is still that draft, of engine 3,
  -- the member's to write (another member editing it refuses the send; the member holds the editor's lease).
  if destination_kind = 'first_draft' then
    if exists (select 1 from public.estimate_versions as version where version.project_id = job.project_id
      and version.tenant_id = tenant) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'destination_changed')::text;
    end if;
  else
    if version_row.id is null or version_row.status is distinct from 'draft'::public.estimate_status
      or deps #>> '{stamps,destination,version_id}' is distinct from target_version::text
      or deps #>> '{stamps,destination,status}' is distinct from 'draft'
      or version_row.updated_at is distinct from (deps #>> '{stamps,destination,updated_at}')::timestamptz then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'destination_changed')::text;
    end if;
    if version_row.calc_engine_version is distinct from 3 then
      raise exception 'TAKEOFF_ITEM_SEND_ENGINE_NOT_V3' using errcode = '22023';
    end if;
    if not p_check_only and exists (select 1 from public.draft_locks as lock_row where lock_row.version_id = target_version
      and lock_row.user_id <> actor and lock_row.expires_at > pg_catalog.clock_timestamp()) then
      raise exception 'TAKEOFF_ITEM_SEND_DRAFT_LOCKED' using errcode = '55P03';
    end if;
    if not p_check_only and not exists (select 1 from public.draft_locks as lock_row where lock_row.version_id = target_version
      and lock_row.user_id = actor and lock_row.expires_at > pg_catalog.clock_timestamp()) then
      raise exception 'TAKEOFF_ITEM_SEND_DRAFT_LOCK_REQUIRED' using errcode = '55P03';
    end if;
  end if;

  -- The plan read: its unit and its plan in the sealed manifest, its sealed list.
  select read_.plan_entry, read_.unit_pages, read_.document into plan_entry, unit_pages, plan_document
  from private.takeoff_item_send_plan_read(job, launch.manifest) as read_;
  if plan_entry is null or plan_entry ->> 'logical_id' is distinct from plan_key::text
    or launch.item_list_revision_id::text is distinct from plan #>> '{list,revision_id}'
    or (select revision.revision from public.takeoff_list_revisions as revision where revision.id = launch.item_list_revision_id)
      is distinct from (plan #>> '{list,revision}')::integer
    or exists (select 1 from public.takeoff_item_answers as a where a.job_id = target_job_id and a.plan_logical_id <> plan_key) then
    raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', 'list_changed')::text;
  end if;

  -- The stamps.
  stale := case
    when public.takeoff_rule_job_stamp(tenant, job.project_id, target_job_id) is distinct from deps #>> '{stamps,job}'
      then 'takeoff_changed'
    when public.takeoff_mapping_rules_stamp(tenant) is distinct from deps #>> '{stamps,mapping}' then 'mapping_changed'
    when exists (select 1 from pg_catalog.jsonb_array_elements(deps -> 'rules') as listed(value)
        group by listed.value -> 'item_id' having count(*) > 1) then 'mapping_changed'
    when exists (select 1 from pg_catalog.jsonb_array_elements(deps -> 'rules') as listed(value)
        where not exists (select 1 from public.takeoff_mapping_rules as rule where rule.tenant_id = tenant
          and rule.id = private.takeoff_uuid_or_null(listed.value -> 'rule_id')
          and rule.updated_at = (listed.value ->> 'rule_version')::timestamptz)) then 'mapping_changed'
    when destination_kind = 'existing_draft' and public.takeoff_send_peers_stamp(tenant, target_version)
      is distinct from deps #>> '{stamps,peers}' then 'estimate_changed'
    when (select pg_catalog.jsonb_build_object('peers', context.stamps ->> 'peers', 'locations', context.stamps ->> 'locations')
        from (select private.takeoff_send_context_stamps(private.takeoff_send_context(tenant, job.project_id, target_job_id,
          target_version)) as stamps) as context)
      is distinct from deps #> '{stamps,context}' then 'peers_changed'
  end;
  if stale is null and destination_kind = 'existing_draft' then
    -- Each DPGF import a line of the draft comes from, as the database identifies its reviewed generation.
    if (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('import_id', import_row.id,
          'mapping_id', state.mapping_id, 'rows_sha256', state.rows_sha256, 'updated_at', import_row.updated_at,
          'status', import_row.status, 'row_count', import_row.row_count) order by import_row.id), '[]'::jsonb)
        from public.dpgf_imports as import_row
        cross join lateral public.dpgf_import_review_state(tenant, import_row.id) as state
        where import_row.tenant_id = tenant and import_row.id in (select lineage.import_id
          from public.read_estimate_dpgf_raw_rows(tenant, target_version) as lineage))
      is distinct from (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'import_id', private.takeoff_uuid_or_null(listed.value -> 'import_id'),
          'mapping_id', private.takeoff_uuid_or_null(listed.value -> 'mapping_id'), 'rows_sha256', listed.value ->> 'rows_sha256',
          'updated_at', (listed.value ->> 'updated_at')::timestamptz, 'status', listed.value ->> 'status',
          'row_count', (listed.value ->> 'row_count')::integer) order by private.takeoff_uuid_or_null(listed.value -> 'import_id')),
          '[]'::jsonb)
        from pg_catalog.jsonb_array_elements(deps #> '{stamps,dpgf}') as listed(value)) then
      stale := 'dpgf_changed';
    end if;
  end if;
  if stale is not null then
    raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', stale)::text;
  end if;

  -- The answers as the plan read them: the job's answers, each with its revision, its effective decision's revision and
  -- the revision of the plan's entry for its item; the entries for the whole affaire of its items.
  with pairs as materialized (
    select p.* from private.takeoff_item_table_pairs(tenant, job.project_id, plan_key) as p
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('item_id', a.item_id, 'answer_id', a.id,
      'revision', a.content_sha256,
      'decision_revision', case when pair.decision_effective in ('accepted', 'set_aside') then pair.decision_revision end,
      'entry_revision', plan_entry_row.revision) order by a.item_id), '[]'::jsonb)
    into answers
  from public.takeoff_item_answers as a
  left join pairs as pair on pair.answer_id = a.id and pair.item_id = a.item_id
  left join public.takeoff_item_entries as plan_entry_row on plan_entry_row.tenant_id = tenant
    and plan_entry_row.project_id = job.project_id and plan_entry_row.item_id = a.item_id
    and plan_entry_row.plan_logical_id = a.plan_logical_id
  where a.job_id = target_job_id and a.tenant_id = tenant;
  if answers is distinct from (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'item_id', private.takeoff_uuid_or_null(listed.value -> 'item_id'),
        'answer_id', private.takeoff_uuid_or_null(listed.value -> 'answer_id'), 'revision', listed.value ->> 'revision',
        'decision_revision', (listed.value ->> 'decision_revision')::integer,
        'entry_revision', (listed.value ->> 'entry_revision')::integer) order by private.takeoff_uuid_or_null(listed.value -> 'item_id')),
        '[]'::jsonb)
      from pg_catalog.jsonb_array_elements(deps -> 'answers') as listed(value))
    or (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('item_id', whole.item_id, 'revision', whole.revision)
          order by whole.item_id), '[]'::jsonb)
        from public.takeoff_item_entries as whole
        where whole.tenant_id = tenant and whole.project_id = job.project_id and whole.plan_logical_id is null
          and whole.item_id in (select a.item_id from public.takeoff_item_answers as a where a.job_id = target_job_id))
      is distinct from (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'item_id', private.takeoff_uuid_or_null(listed.value -> 'item_id'), 'revision', (listed.value ->> 'revision')::integer)
          order by private.takeoff_uuid_or_null(listed.value -> 'item_id')), '[]'::jsonb)
        from pg_catalog.jsonb_array_elements(deps -> 'affaire_entries') as listed(value)) then
    raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', 'answers_changed')::text;
  end if;
  if array(select distinct (page.value #>> '{}')::integer from pg_catalog.jsonb_array_elements(deps -> 'plan_pages') as page(value)
      order by 1) is distinct from unit_pages then
    raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', 'plan_changed')::text;
  end if;
  -- Every part the job's answers bring now, read once.
  if p_revision_receipt is null then
    select coalesce(pg_catalog.jsonb_agg(stored), '[]'::jsonb) into job_parts
    from private.takeoff_item_send_resolved_parts(tenant, job.project_id, target_job_id, unit_pages) as stored;
  else
    job_parts := p_revision_parts;
  end if;

  -- The whole list: a list holding items of a DPGF import is sent only into a draft that holds that import's lines.
  if exists (select 1 from public.takeoff_list_revision_entries as entry
      where entry.revision_id = launch.item_list_revision_id and entry.origin_kind = 'dpgf')
    and (destination_kind = 'first_draft' or not exists (select 1 from public.estimate_items as item
      join public.takeoff_list_revision_entries as entry on entry.revision_id = launch.item_list_revision_id
        and entry.origin_kind = 'dpgf' and pg_catalog.lower(entry.origin ->> 'importId') = pg_catalog.lower(item.source_metadata ->> 'import_id')
      where item.version_id = target_version and item.tenant_id = tenant and item.item_type = 'line'::public.estimate_item_type
        and item.source_provider = 'dpgf')) then
    raise exception 'TAKEOFF_ITEM_SEND_DPGF_IMPORT_REQUIRED' using errcode = '22023';
  end if;

  if destination_kind = 'existing_draft' then
    -- A source part and a copied part carry the same immutable proof. If the analysis
    -- still exists, compare its locked marks revision before using the part in this
    -- item's balance. If it was deleted, the copy is itself the historical record.
    if not earlier_proofs_current or exists(select 1 from jsonb_array_elements(plan->'targets') t
        cross join lateral jsonb_array_elements(t->'replaces') r where r ? 'corrected_proof') then
      -- An unchanged client has no witness. Compare the *entire* set of stale
      -- proofs on the target items against the replacements the member saw.
      -- A revision never acquires authority over another reading this way.
      with stale_parts as materialized (
        select p.*,private.takeoff_count_marks_revision(a.id) as current_revision
        from public.takeoff_item_send_parts p join public.takeoff_item_answers a
          on a.id=p.answer_id and a.tenant_id=p.tenant_id and a.project_id=p.project_id
        where p.version_id=target_version and p.tenant_id=tenant and p.kind='verified_count' and p.state='live'
          and exists(select 1 from jsonb_array_elements(plan->'targets') t where t->>'item_id'=p.item_id::text)
          and p.marks_revision is distinct from private.takeoff_count_marks_revision(a.id)
      ), declared as (
        select t->'item_id' as item, r as replacement from jsonb_array_elements(plan->'targets') t
          cross join lateral jsonb_array_elements(t->'replaces') r where r ? 'corrected_proof'
      ), matched as (
        select p.id from stale_parts p join declared d on d.item=to_jsonb(p.item_id)
          and d.replacement->'corrected_proof'=jsonb_build_object('part_id',p.id,'sent_revision',p.marks_revision,
            'current_revision',p.current_revision)
          and d.replacement->'job_id'=to_jsonb(p.job_id) and d.replacement->'answer_id'=to_jsonb(p.answer_id)
          and d.replacement->'quantity'=to_jsonb(p.quantity) and d.replacement->'observation_ids'=to_jsonb(p.observation_ids)
        where p_revision_receipt is null and p.job_id<>target_job_id and p.plan_logical_id=plan_key
          and p.current_revision>p.marks_revision and exists(select 1 from public.takeoff_item_answers fresh
            join public.takeoff_item_answers prior on prior.id=p.answer_id
            where fresh.job_id=target_job_id and fresh.item_id=p.item_id and fresh.plan_logical_id=p.plan_logical_id
              and fresh.reading_revision>prior.reading_revision and private.takeoff_count_answer_is_current(fresh))
      )
      select case when (select count(*) from matched)=(select count(*) from stale_parts)
          and (select count(distinct id) from matched)=(select count(*) from declared)
        then coalesce((select array_agg(id order by id) from matched),'{}'::uuid[]) end into corrected_part_ids;
      if corrected_part_ids is null then
        raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode='40001',
          detail=jsonb_build_object('reason','earlier_send_changed')::text;
      end if;
    end if;
    -- What earlier sends by item left in the draft, as the plan read it.
    if private.takeoff_item_send_earlier_targets(tenant, target_version)
      is distinct from private.takeoff_item_send_earlier_form(deps -> 'earlier_targets') then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'earlier_send_changed')::text;
    end if;
    -- A line an earlier send by item wrote in another version, carried here by a copy, without its contributions: neither
    -- the page guard nor the targets of this draft can tell what it already holds, and it is never counted twice.
    if exists (select 1 from public.estimate_items as item
      where item.version_id = target_version and item.tenant_id = tenant and item.source_metadata ? 'takeoff_item_send'
        and not exists (select 1 from public.takeoff_item_send_targets as t where t.estimate_item_id = item.id)) then
      raise exception 'TAKEOFF_ITEM_SEND_COPY_UNREAD' using errcode = '22023';
    end if;
    -- The lines the plan read, as they are.
    if exists (select 1 from pg_catalog.jsonb_array_elements(deps -> 'lines') as listed(value)
      left join public.estimate_items as item on item.id = private.takeoff_uuid_or_null(listed.value -> 'estimate_item_id')
        and item.version_id = target_version and item.tenant_id = tenant
      where item.id is null or item.updated_at is distinct from (listed.value ->> 'updated_at')::timestamptz
        or item.quantity is distinct from (listed.value ->> 'quantity')::numeric) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'estimate_changed')::text;
    end if;
    -- The pages of this plan's document the draft already holds from another analysis, as the plan read them.
    held := private.takeoff_item_send_held_pages(tenant, target_version, target_job_id, plan_document,
      private.takeoff_item_send_guard_pages(unit_pages, job_parts));
    if (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('page', entry.value -> 'page',
          'earlier_job_ids', entry.value -> 'earlier_job_ids', 'estimate_item_ids', entry.value -> 'estimate_item_ids')
          order by (entry.value ->> 'page')::integer nulls last), '[]'::jsonb)
        from pg_catalog.jsonb_array_elements(held) as entry(value))
      is distinct from (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('page', coalesce(listed.value -> 'page', 'null'::jsonb),
          'earlier_job_ids', pg_catalog.to_jsonb(array(select private.takeoff_uuid_or_null(j.value)::text
            from pg_catalog.jsonb_array_elements(listed.value -> 'earlier_job_ids') as j(value) order by 1)),
          'estimate_item_ids', pg_catalog.to_jsonb(array(select private.takeoff_uuid_or_null(l.value)::text
            from pg_catalog.jsonb_array_elements(listed.value -> 'estimate_item_ids') as l(value) order by 1)))
          order by (listed.value ->> 'page')::integer nulls last), '[]'::jsonb)
        from pg_catalog.jsonb_array_elements(deps -> 'pages_in_estimate') as listed(value)) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'pages_changed')::text;
    end if;
  elsif pg_catalog.jsonb_array_length(deps -> 'earlier_targets') > 0 or pg_catalog.jsonb_array_length(deps -> 'lines') > 0
    or pg_catalog.jsonb_array_length(deps -> 'pages_in_estimate') > 0 then
    raise exception 'TAKEOFF_ITEM_SEND_INVALID' using errcode = '22023';
  end if;

  -- The page decisions: each on a page held, each positively valid (the shape was checked: a decision, its reason).
  -- Replacing needs parts that can be told apart and cut by page: a line of today's send holds its page as a whole
  -- reading (no part per item), and a part that also lies on a page not replaced (or on every page) cannot be cut.
  for decision in select value from pg_catalog.jsonb_array_elements(plan -> 'page_decisions') loop
    if not exists (select 1 from pg_catalog.jsonb_array_elements(held) as entry(value)
        where entry.value -> 'page' = coalesce(decision -> 'page', 'null'::jsonb)) then
      raise exception 'TAKEOFF_ITEM_SEND_PAGE_DECISION_INVALID' using errcode = '22023',
        detail = pg_catalog.jsonb_build_object('reason', 'page_not_held', 'page', decision -> 'page')::text;
    end if;
    if decision ->> 'decision' = 'replace' and exists (select 1 from pg_catalog.jsonb_array_elements(held) as entry(value)
        where entry.value -> 'page' = coalesce(decision -> 'page', 'null'::jsonb) and (entry.value ->> 'today')::boolean) then
      raise exception 'TAKEOFF_ITEM_SEND_PAGE_DECISION_INVALID' using errcode = '22023',
        detail = pg_catalog.jsonb_build_object('reason', 'replace_not_cuttable', 'page', decision -> 'page')::text;
    end if;
    -- « Garder les deux » only where today's guard admits it: never onto a line that already holds that page from
    -- another reading (today's « Fusionner » match: the line would hold the page twice) — a line today's provenance
    -- holds there, or one a live part of another plan or another item holds there (this plan's own earlier part of the
    -- item is replaced, not kept).
    if decision ->> 'decision' = 'keep_both' and exists (select 1 from pg_catalog.jsonb_array_elements(held) as entry(value)
        cross join lateral pg_catalog.jsonb_array_elements(plan -> 'targets') as t(value)
        cross join lateral pg_catalog.jsonb_array_elements(t.value -> 'contributions') as c(value)
        where entry.value -> 'page' = coalesce(decision -> 'page', 'null'::jsonb)
          and (coalesce(decision -> 'page', 'null'::jsonb) = 'null'::jsonb or pg_catalog.jsonb_array_length(c.value -> 'pages') = 0
            or c.value -> 'pages' @> pg_catalog.jsonb_build_array(decision -> 'page'))
          and (entry.value -> 'today_estimate_item_ids' ? (t.value #>> '{line,estimate_item_id}')
            or exists (select 1 from pg_catalog.jsonb_array_elements(entry.value -> 'parts') as p(value)
              where p.value ->> 'estimate_item_id' = t.value #>> '{line,estimate_item_id}'
                and (p.value ->> 'plan_key' = plan_key::text and p.value ->> 'item_id' = t.value ->> 'item_id') is not true))) then
      raise exception 'TAKEOFF_ITEM_SEND_PAGE_DECISION_INVALID' using errcode = '22023',
        detail = pg_catalog.jsonb_build_object('reason', 'keep_both_same_line', 'page', decision -> 'page')::text;
    end if;
  end loop;
  -- The parts a page replaced takes out: the earlier live parts, on that page, of the items this plan sends parts of there.
  select coalesce(pg_catalog.array_agg(distinct (p.value ->> 'part_id')::uuid), '{}'::uuid[]) into page_replaced
  from pg_catalog.jsonb_array_elements(plan -> 'page_decisions') as d(value)
  join pg_catalog.jsonb_array_elements(held) as entry(value) on entry.value -> 'page' = coalesce(d.value -> 'page', 'null'::jsonb)
  cross join lateral pg_catalog.jsonb_array_elements(entry.value -> 'parts') as p(value)
  where d.value ->> 'decision' = 'replace'
    and exists (select 1 from pg_catalog.jsonb_array_elements(plan -> 'targets') as t(value)
      cross join lateral pg_catalog.jsonb_array_elements(t.value -> 'contributions') as c(value)
      where t.value ->> 'item_id' = p.value ->> 'item_id'
        and (coalesce(d.value -> 'page', 'null'::jsonb) = 'null'::jsonb or pg_catalog.jsonb_array_length(c.value -> 'pages') = 0
          or c.value -> 'pages' @> pg_catalog.jsonb_build_array(d.value -> 'page')));
  if exists (select 1 from public.takeoff_item_send_parts as p where p.id = any(page_replaced) and p.kind <> 'verified_count'
      and (pg_catalog.cardinality(p.pages) = 0 or exists (select 1 from pg_catalog.unnest(p.pages) as x(page)
        where not exists (select 1 from pg_catalog.jsonb_array_elements(plan -> 'page_decisions') as d(value)
          where d.value ->> 'decision' = 'replace'
            and (coalesce(d.value -> 'page', 'null'::jsonb) = 'null'::jsonb or (d.value ->> 'page')::integer = x.page))))) then
    raise exception 'TAKEOFF_ITEM_SEND_PAGE_DECISION_INVALID' using errcode = '22023',
      detail = pg_catalog.jsonb_build_object('reason', 'part_indivisible')::text;
  end if;

  -- Begin with every retained part read under the locks. A previous preview format
  -- may classify a counted item as not found and never submit a target for it.
  -- A whole item can be absent only when the preview accounted for its real parts.
  if exists (
    with omitted as (
      select stored.value as part from jsonb_array_elements(job_parts) stored(value)
      where not exists (select 1 from jsonb_array_elements(plan -> 'targets') tgt where tgt -> 'item_id' = stored.value -> 'item_id')
    ), winning_rules as materialized (
      select li.item_id, private.takeoff_item_send_skip_rule(tenant,li.label,
        private.takeoff_uuid_or_null(applied.rule->'rule_id')) as skip_id, applied.rule
      from (select distinct (o.part->>'item_id')::uuid as id from omitted o) items
      join public.takeoff_list_revision_entries li on li.revision_id=launch.item_list_revision_id and li.item_id=items.id
      left join lateral (select r as rule from jsonb_array_elements(deps->'rules') r
        where r->>'item_id'=li.item_id::text) applied on true
    ), incompatible as (
      select li.item_id from omitted o
      join public.takeoff_list_revision_entries li on li.revision_id = launch.item_list_revision_id
        and li.item_id = (o.part ->> 'item_id')::uuid
      cross join lateral (select private.takeoff_item_send_unit(o.part ->> 'unit') as unit,
        private.takeoff_item_send_folded(o.part ->> 'basis') as basis) identity_
      group by li.item_id, li.expected_unit, li.measurement_basis
      having bool_and((o.part->>'quantity')::numeric<=999999999.999
        and (o.part->>'quantity')::numeric=round((o.part->>'quantity')::numeric,3))
        and (bool_or(identity_.unit is null) or count(distinct identity_.unit) > 1 or count(distinct identity_.basis) > 1
        or (li.expected_unit is not null and bool_or(private.takeoff_item_send_unit(li.expected_unit) <> identity_.unit))
        or (li.measurement_basis is not null and bool_or(private.takeoff_item_send_folded(li.measurement_basis) <> identity_.basis)))
    ), item_reasons as materialized (
      select x as omission from jsonb_array_elements(plan->'left_out') x
      where exists(select 1 from omitted o where o.part->'item_id'=x->'item_id')
    ), declared as materialized (
      select x as excluded from jsonb_array_elements(plan->'parts_not_sent') x
      where exists(select 1 from omitted o where o.part->'item_id'=x->'item_id')
    ), matched as materialized (
      select o.part,d.excluded,i.omission from omitted o join declared d
        on d.excluded->'item_id'=o.part->'item_id' and d.excluded->'kind'=o.part->'kind'
        and d.excluded->'quantity'=o.part->'quantity' and d.excluded->'unit'=o.part->'unit'
        and d.excluded->'pages'=o.part->'pages' and d.excluded->'observation_ids'=
          case when o.part->>'kind'='measured' then jsonb_build_array(o.part->'observation_id') else '[]'::jsonb end
        and (o.part->>'kind'<>'verified_count' or d.excluded->'marks_revision'=o.part->'marks_revision')
      join item_reasons i on i.omission->'item_id'=o.part->'item_id'
    ), checked as materialized (
      select m.*,case m.excluded->>'reason'
        when 'rule_skip' then winner.skip_id::text=m.omission->>'rule_id' and winner.rule->'rule_id'=m.omission->'rule_id'
          and (m.omission->>'rule_version' is null or m.omission->'rule_version'=winner.rule->'rule_version')
        when 'unit_incompatible' then winner.skip_id is null and exists(select 1 from incompatible i where i.item_id=winner.item_id)
        when 'left_out' then dialog.valid
        when 'entry_suspended' then dialog.valid
        else false end as valid,coalesce(dialog.on_page,false) as on_page
      from matched m join winning_rules winner on winner.item_id=(m.part->>'item_id')::uuid left join lateral (
        select bool_or(true) as valid,bool_or(r->>'key' like 'page:%') as on_page
        from jsonb_array_elements(deps->'resolutions') r
        where winner.skip_id is null and m.excluded->>'reason' in ('left_out','entry_suspended')
          and private.takeoff_item_send_exclusion_choice(plan,m.part,job_parts,held,r,m.excluded->>'reason',
            (plan_entry->>'page_count')::integer,coalesce(version_row.max_section_depth,
              (p_request#>>'{version_payload,max_section_depth}')::integer,3))
      ) dialog on true
    )
    -- Every stored part has a valid declaration and every declared part belongs
    -- to the item. The whole item's reason describes the remaining parts. A
    -- page choice may explain individual parts removed before that decision.
    select 1 from omitted o where not exists(select 1 from checked c where c.part=o.part and c.valid)
    union all select 1 from declared d where not exists(select 1 from checked c where c.excluded=d.excluded and c.valid)
    union all select 1 from item_reasons i where not exists(
      select 1 from checked c where c.omission=i.omission and c.valid and c.excluded->'reason'=i.omission->'reason'
    ) or exists(select 1 from checked c where c.omission=i.omission and c.valid
      and c.excluded->'reason'<>i.omission->'reason' and not (c.on_page and i.omission->>'reason' in ('entry_suspended','left_out')))
    union all select 1 from item_reasons group by omission->'item_id' having count(*)<>1
  ) then
    raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = jsonb_build_object('reason','item_changed')::text;
  end if;

  select p_revision_receipt is null and exists(select 1 from public.takeoff_item_answers a
    join public.takeoff_item_answer_decisions d on d.answer_id=a.id
    join private.takeoff_retained_measures m on m.command_id=d.command_id where a.job_id=target_job_id)
    into has_retained;
  -- Every target, read again and computed here.
  for target in select value from pg_catalog.jsonb_array_elements(plan -> 'targets') loop
    select * into entry_row from public.takeoff_list_revision_entries as entry
    where entry.revision_id = launch.item_list_revision_id and entry.item_id = (target ->> 'item_id')::uuid;
    if entry_row.item_id is null then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'item_changed', 'item_id', target ->> 'item_id')::text;
    end if;
    -- The rule the plan names for the item (the server's projection, bound here): a « skip » never writes.
    if exists (select 1 from pg_catalog.jsonb_array_elements(deps -> 'rules') as listed(value)
        join public.takeoff_mapping_rules as rule on rule.id = private.takeoff_uuid_or_null(listed.value -> 'rule_id')
          and rule.tenant_id = tenant
        where listed.value ->> 'item_id' = target ->> 'item_id' and rule.action = 'skip') then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'mapping_changed', 'item_id', target ->> 'item_id')::text;
    end if;
    -- The item's stored parts now: each part the plan sends is one of them, exactly (its unit compared by its canonical
    -- code), each named once, and the others are the ones the plan holds or leaves out by page, each named once.
    select pg_catalog.count(*)::integer into stored_count from pg_catalog.jsonb_array_elements(job_parts) as stored(value)
    where stored.value ->> 'item_id' = target ->> 'item_id';
    select pg_catalog.count(*)::integer into listed_count from pg_catalog.jsonb_array_elements(plan -> 'parts_not_sent') as listed(value)
    where listed.value ->> 'item_id' = target ->> 'item_id' and listed.value ->> 'reason' in ('page_held', 'left_out');
    if stored_count = 0 or stored_count <> pg_catalog.jsonb_array_length(target -> 'contributions') + listed_count
      or (select pg_catalog.count(distinct pg_catalog.jsonb_build_array(c.value -> 'kind', c.value -> 'answer_id',
          case when c.value ->> 'kind' <> 'measured' then 'null'::jsonb else c.value -> 'observation_ids' end))
        from pg_catalog.jsonb_array_elements(target -> 'contributions') as c(value))
        <> pg_catalog.jsonb_array_length(target -> 'contributions')
      or (select pg_catalog.count(distinct pg_catalog.jsonb_build_array(listed.value -> 'kind',
          case when listed.value ->> 'kind' <> 'measured' then 'null'::jsonb else listed.value -> 'observation_ids' end))
        from pg_catalog.jsonb_array_elements(plan -> 'parts_not_sent') as listed(value)
        where listed.value ->> 'item_id' = target ->> 'item_id' and listed.value ->> 'reason' in ('page_held', 'left_out'))
        <> listed_count
      or exists (select 1 from pg_catalog.jsonb_array_elements(target -> 'contributions') as c(value)
        where (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(job_parts) as stored(value)
          where stored.value ->> 'item_id' = target ->> 'item_id' and stored.value ->> 'answer_id' = c.value ->> 'answer_id'
            and stored.value -> 'marks_revision' is not distinct from c.value -> 'marks_revision'
            and stored.value ->> 'answer_revision' = c.value ->> 'answer_revision' and stored.value ->> 'kind' = c.value ->> 'kind'
            and (stored.value ->> 'quantity')::numeric = (c.value ->> 'quantity')::numeric
            and private.takeoff_item_send_unit(stored.value ->> 'unit') = private.takeoff_item_send_unit(c.value ->> 'unit')
            and (stored.value ->> 'kind' <> 'measured'
              or pg_catalog.jsonb_build_array(stored.value -> 'observation_id') = c.value -> 'observation_ids')
            and stored.value -> 'pages' = pg_catalog.to_jsonb(array(select distinct (g.value #>> '{}')::integer
              from pg_catalog.jsonb_array_elements(c.value -> 'pages') as g(value) order by 1))) <> 1) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'item_changed', 'item_id', target ->> 'item_id')::text;
    end if;
    -- And each part the plan holds or leaves out by page is one of the stored parts it does not send, exactly: its kind, its
    -- observation, its quantity and its pages as stored (never the plan's).
    if exists (select 1 from pg_catalog.jsonb_array_elements(plan -> 'parts_not_sent') as listed(value)
        where listed.value ->> 'item_id' = target ->> 'item_id' and listed.value ->> 'reason' in ('page_held', 'left_out')
          and (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(job_parts) as stored(value)
            where stored.value ->> 'item_id' = target ->> 'item_id' and stored.value ->> 'kind' = listed.value ->> 'kind'
              and (stored.value ->> 'kind' <> 'measured'
                or pg_catalog.jsonb_build_array(stored.value -> 'observation_id') = listed.value -> 'observation_ids')
              and (stored.value ->> 'quantity')::numeric = (listed.value ->> 'quantity')::numeric
              and stored.value -> 'pages' = pg_catalog.to_jsonb(array(select distinct (g.value #>> '{}')::integer
                from pg_catalog.jsonb_array_elements(listed.value -> 'pages') as g(value) order by 1))
              and not exists (select 1 from pg_catalog.jsonb_array_elements(target -> 'contributions') as c(value)
                where c.value ->> 'kind' = stored.value ->> 'kind' and (stored.value ->> 'kind' <> 'measured'
                  or pg_catalog.jsonb_build_array(stored.value -> 'observation_id') = c.value -> 'observation_ids'))) <> 1) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'item_changed', 'item_id', target ->> 'item_id')::text;
    end if;
    -- Engine 3 holds each part as given (three decimals, under its ceiling), in one unit, the item's when it has one.
    if exists (select 1 from pg_catalog.jsonb_array_elements(target -> 'contributions') as c(value)
        where ((c.value ->> 'quantity')::numeric > 0 and (c.value ->> 'quantity')::numeric <= 999999999.999
          and (c.value ->> 'quantity')::numeric = pg_catalog.round((c.value ->> 'quantity')::numeric, 3)
          and private.takeoff_item_send_unit(c.value ->> 'unit') = target ->> 'unit_code') is not true)
      or (entry_row.expected_unit is not null
        and private.takeoff_item_send_unit(entry_row.expected_unit) is distinct from target ->> 'unit_code') then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'item_changed', 'item_id', target ->> 'item_id')::text;
    end if;
    -- The quantitative identity, derived here from the stored observations and the sealed item: one basis among the parts
    -- (the item's when it prescribes one), the item's network, material and diameter. It is the one stored.
    if (select pg_catalog.count(distinct private.takeoff_item_send_folded(stored.value ->> 'basis'))
        from pg_catalog.jsonb_array_elements(job_parts) as stored(value)
        where stored.value ->> 'item_id' = target ->> 'item_id' and private.takeoff_item_send_folded(stored.value ->> 'basis') is not null) > 1
      or (private.takeoff_item_send_folded(entry_row.measurement_basis) is not null and exists (select 1
        from pg_catalog.jsonb_array_elements(job_parts) as stored(value)
        where stored.value ->> 'item_id' = target ->> 'item_id'
          and private.takeoff_item_send_folded(stored.value ->> 'basis')
            is distinct from private.takeoff_item_send_folded(entry_row.measurement_basis)
          and private.takeoff_item_send_folded(stored.value ->> 'basis') is not null)) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'item_changed', 'item_id', target ->> 'item_id')::text;
    end if;
    identity := pg_catalog.jsonb_build_object('unit', target ->> 'unit_code',
      'basis', coalesce((select private.takeoff_item_send_folded(stored.value ->> 'basis')
          from pg_catalog.jsonb_array_elements(job_parts) as stored(value)
          where stored.value ->> 'item_id' = target ->> 'item_id' and private.takeoff_item_send_folded(stored.value ->> 'basis') is not null
          limit 1), private.takeoff_item_send_folded(entry_row.measurement_basis)),
      'network', private.takeoff_item_send_folded(entry_row.qualifiers ->> 'network'),
      'material', private.takeoff_item_send_folded(entry_row.qualifiers ->> 'material'),
      'diameter', private.takeoff_item_send_diameter(entry_row.qualifiers ->> 'diameter'));
    if exists (select 1 from pg_catalog.jsonb_array_elements(target -> 'contributions') as c(value)
        where c.value -> 'identity' is distinct from identity) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'identity_conflict', 'item_id', target ->> 'item_id')::text;
    end if;
    -- A part on a page held is sent only with that page's decision. A page holds the item when today's provenance holds
    -- it, or when an earlier send by item holds a part there other than this plan's own earlier part of the item.
    if exists (select 1 from pg_catalog.jsonb_array_elements(target -> 'contributions') as c(value)
        cross join lateral pg_catalog.jsonb_array_elements(held) as entry(value)
        where (entry.value -> 'page' = 'null'::jsonb or pg_catalog.jsonb_array_length(c.value -> 'pages') = 0
            or c.value -> 'pages' @> pg_catalog.jsonb_build_array(entry.value -> 'page'))
          and ((entry.value ->> 'today')::boolean or exists (select 1 from pg_catalog.jsonb_array_elements(entry.value -> 'parts') as p(value)
            where (p.value ->> 'plan_key' = plan_key::text and p.value ->> 'item_id' = target ->> 'item_id') is not true))
          and not exists (select 1 from pg_catalog.jsonb_array_elements(plan -> 'page_decisions') as d(value)
            where coalesce(d.value -> 'page', 'null'::jsonb) = entry.value -> 'page')) then
      raise exception 'TAKEOFF_ITEM_SEND_PAGE_DECISION_REQUIRED' using errcode = '22023',
        detail = pg_catalog.jsonb_build_object('reason', 'page_held', 'item_id', target ->> 'item_id')::text;
    end if;
    -- The compartment is one of the breakdown's: « together », a building's or a level's, « unallocated »; « dpgf » for a
    -- line of the DPGF, and only there.
    if ((target #>> '{line,kind}' = 'dpgf_line') = (target ->> 'compartment_key' = 'dpgf')
      and (target ->> 'compartment_key' = 'dpgf' or case send_breakdown
        when 'together' then target ->> 'compartment_key' = 'together'
        when 'by_level' then target ->> 'compartment_key' = 'unallocated' or target ->> 'compartment_key' like 'level:%'
        when 'by_building' then target ->> 'compartment_key' = 'unallocated' or target ->> 'compartment_key' like 'building:%'
        else false end)) is not true then
      raise exception 'TAKEOFF_ITEM_SEND_INVALID' using errcode = '22023';
    end if;
    -- What this confirmation covers on its plan: the pages its answer searched (an entry: every page of the plan's unit),
    -- less the pages of the stored parts it does not send (held or left out: their stored pages, never the plan's) and
    -- those held without a decision, and the pages a « replace » decision carries.
    covered := array(select distinct x from pg_catalog.unnest(
        case when exists (select 1 from pg_catalog.jsonb_array_elements(target -> 'contributions') as c(value)
            where c.value ->> 'kind' = 'entered') then unit_pages
          when exists (select 1 from pg_catalog.jsonb_array_elements(target -> 'contributions') as c(value)
            where c.value ->> 'kind' = 'verified_count') then (select private.takeoff_count_answer_scope(a)
              from public.takeoff_item_answers a where a.job_id = target_job_id and a.item_id = (target ->> 'item_id')::uuid)
          else (select a.searched_pages from public.takeoff_item_answers as a
            where a.job_id = target_job_id and a.item_id = (target ->> 'item_id')::uuid) end) as x
      where not exists (select 1 from pg_catalog.jsonb_array_elements(job_parts) as stored(value)
          cross join lateral pg_catalog.jsonb_array_elements(stored.value -> 'pages') as g(value)
          where stored.value ->> 'item_id' = target ->> 'item_id' and (g.value #>> '{}')::integer = x
            and not exists (select 1 from pg_catalog.jsonb_array_elements(target -> 'contributions') as c(value)
              where c.value ->> 'kind' = stored.value ->> 'kind' and (stored.value ->> 'kind' <> 'measured'
                or pg_catalog.jsonb_build_array(stored.value -> 'observation_id') = c.value -> 'observation_ids')))
        and not exists (select 1 from pg_catalog.jsonb_array_elements(held) as entry(value)
          where (entry.value -> 'page' = 'null'::jsonb or (entry.value ->> 'page')::integer = x)
            and ((entry.value ->> 'today')::boolean or exists (select 1 from pg_catalog.jsonb_array_elements(entry.value -> 'parts') as p(value)
              where (p.value ->> 'plan_key' = plan_key::text and p.value ->> 'item_id' = target ->> 'item_id') is not true))
            and not exists (select 1 from pg_catalog.jsonb_array_elements(plan -> 'page_decisions') as d(value)
              where coalesce(d.value -> 'page', 'null'::jsonb) = entry.value -> 'page'))
      union select (d.value ->> 'page')::integer from pg_catalog.jsonb_array_elements(plan -> 'page_decisions') as d(value)
        where d.value ->> 'decision' = 'replace' and d.value ->> 'page' is not null
      order by 1);

    -- A verified count is one item's plan total. Its evidence pages locate
    -- the marks and cannot prove that a later partial reading replaces it.
    select stored.value into incoming_count from pg_catalog.jsonb_array_elements(job_parts) stored(value)
      where stored.value ->> 'item_id' = target ->> 'item_id' and stored.value ->> 'kind' = 'verified_count';
    if target_version is not null and (incoming_count is not null or exists (
        select 1 from public.takeoff_item_send_parts p where p.version_id = target_version and p.state = 'live'
          and p.kind = 'verified_count' and p.item_id = (target ->> 'item_id')::uuid)) then
      select private.takeoff_item_send_whole_plan((plan_entry ->> 'page_count')::integer,
        case when incoming_count is not null then private.takeoff_count_answer_scope(a) else a.searched_pages end, covered)
      into whole_plan from public.takeoff_item_answers a
      where a.job_id = target_job_id and a.item_id = (target ->> 'item_id')::uuid;
      select p.* into blocked_part from public.takeoff_item_send_parts p
      where p.version_id = target_version and p.state = 'live' and p.item_id = (target ->> 'item_id')::uuid
        and ((p.plan_logical_id = plan_key and private.takeoff_item_send_count_scope(p.kind,p.pages,
            incoming_count is not null,covered,whole_plan) = 'refuse')
          or (p.plan_logical_id <> plan_key and p.kind = 'verified_count' and p.id = any(page_replaced)))
      order by (p.kind = 'verified_count') desc,p.job_id,p.answer_id,p.observation_ids,p.id limit 1;
      if found then
        if blocked_part.kind = 'verified_count' then
          count_proof := pg_catalog.jsonb_build_object('job_id',blocked_part.job_id,'answer_id',blocked_part.answer_id,
            'quantity',blocked_part.quantity,'unit',blocked_part.unit,'pages',blocked_part.pages,
            'marks_revision',blocked_part.marks_revision);
        else
          count_proof := pg_catalog.jsonb_build_object('job_id',target_job_id,'answer_id',incoming_count -> 'answer_id',
            'quantity',incoming_count -> 'quantity','unit',incoming_count -> 'unit','pages',incoming_count -> 'pages',
            'marks_revision',incoming_count -> 'marks_revision',
            'held_part',pg_catalog.jsonb_build_object('source',blocked_part.kind,'quantity',blocked_part.quantity,
              'unit',blocked_part.unit,'pages',blocked_part.pages,'job_id',blocked_part.job_id,'answer_id',blocked_part.answer_id,
              'reading_revision',(select a.reading_revision from public.takeoff_item_answers a where a.id = blocked_part.answer_id)));
        end if;
        raise exception 'TAKEOFF_ITEM_SEND_VERIFIED_TOTAL_INDIVISIBLE' using errcode = '40001',
          detail = (count_proof || pg_catalog.jsonb_build_object('reason','verified_total_indivisible',
            'item_id',target -> 'item_id','reading_revision',(select a.reading_revision from public.takeoff_item_answers a
              where a.id = (count_proof ->> 'answer_id')::uuid)))::text;
      end if;
    end if;

    -- What the plan adds: the stored quantity of each part it sends (the plan's copy was only compared above).
    added := (select pg_catalog.sum((stored.value ->> 'quantity')::numeric)
      from pg_catalog.jsonb_array_elements(target -> 'contributions') as c(value)
      join pg_catalog.jsonb_array_elements(job_parts) as stored(value) on stored.value ->> 'item_id' = target ->> 'item_id'
        and stored.value ->> 'answer_id' = c.value ->> 'answer_id' and stored.value ->> 'kind' = c.value ->> 'kind'
        and (stored.value ->> 'kind' <> 'measured'
          or pg_catalog.jsonb_build_array(stored.value -> 'observation_id') = c.value -> 'observation_ids'));
    factor := private.takeoff_item_send_length_factor(target ->> 'unit_code');
    target_replaced := '{}'::uuid[];
    live_target_id := null;
    live_target := null;
    line := null;
    reference := null;
    kept_sum := 0;
    legacy_measure := 0;
    choice := null;
    typed := false;
    -- What its origin allows: an item of the list made by hand never feeds a DPGF line; an item of a DPGF import feeds a
    -- line of that import (its lineage proves it, or the member chose it among them), never a new line while the draft
    -- holds that import's lines.
    if target #>> '{line,kind}' = 'dpgf_line' and entry_row.origin_kind <> 'dpgf' then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'target_unproven', 'item_id', target ->> 'item_id')::text;
    end if;
    if target #>> '{line,kind}' <> 'dpgf_line' and entry_row.origin_kind = 'dpgf' and destination_kind = 'existing_draft'
      and exists (select 1 from public.estimate_items as item where item.version_id = target_version and item.tenant_id = tenant
        and item.source_provider = 'dpgf' and item.item_type = 'line'::public.estimate_item_type
        and pg_catalog.lower(item.source_metadata ->> 'import_id') = pg_catalog.lower(entry_row.origin ->> 'importId')) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'target_changed', 'item_id', target ->> 'item_id')::text;
    end if;
    if target #>> '{line,kind}' = 'new_line' then
      -- A new line: no live target of this item in this compartment (else the plan feeds it), one breakdown per item in a
      -- draft; after a target whose line was deleted, only by the member's choice, and its displaced live parts retired.
      if exists (select 1 from public.takeoff_item_send_targets as t
          where t.version_id = target_version and t.item_id = (target ->> 'item_id')::uuid and t.estimate_item_id is not null
            and (t.breakdown <> send_breakdown or t.compartment_key = target ->> 'compartment_key')) then
        raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
          detail = pg_catalog.jsonb_build_object('reason', 'target_changed', 'item_id', target ->> 'item_id')::text;
      end if;
      if exists (select 1 from public.takeoff_item_send_targets as t
          where t.version_id = target_version and t.item_id = (target ->> 'item_id')::uuid and t.breakdown = send_breakdown
            and t.compartment_key = target ->> 'compartment_key' and t.estimate_item_id is null) then
        if not exists (select 1 from pg_catalog.jsonb_array_elements(deps -> 'resolutions') as r(value)
            where r.value ->> 'key' = 'target:' || (target ->> 'key') and r.value #>> '{choice,kind}' = 'new_line') then
          raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
            detail = pg_catalog.jsonb_build_object('reason', 'target_changed', 'item_id', target ->> 'item_id')::text;
        end if;
        select coalesce(pg_catalog.array_agg(p.id order by p.id), '{}'::uuid[]) into target_replaced
        from public.takeoff_item_send_parts as p join public.takeoff_item_send_targets as t on t.id = p.target_id
        where t.version_id = target_version and t.item_id = (target ->> 'item_id')::uuid and t.breakdown = send_breakdown
          and t.compartment_key = target ->> 'compartment_key' and t.estimate_item_id is null and p.state = 'live';
      end if;
      -- Its title is the item's label in the sealed list, or the one a renaming rule of the item gives; its category is
      -- the one a classifying rule of the item gives, or none.
      if (target #>> '{line,title}' = entry_row.label
          or exists (select 1 from pg_catalog.jsonb_array_elements(deps -> 'rules') as listed(value)
            join public.takeoff_mapping_rules as rule on rule.id = private.takeoff_uuid_or_null(listed.value -> 'rule_id')
              and rule.tenant_id = tenant
            where listed.value ->> 'item_id' = target ->> 'item_id' and rule.action = 'rename'
              and pg_catalog.btrim(rule.action_params ->> 'designation') = target #>> '{line,title}')) is not true
        or (private.takeoff_uuid_or_null(target #> '{rule,category_id}') is not null
          and not exists (select 1 from pg_catalog.jsonb_array_elements(deps -> 'rules') as listed(value)
            join public.takeoff_mapping_rules as rule on rule.id = private.takeoff_uuid_or_null(listed.value -> 'rule_id')
              and rule.tenant_id = tenant
            where listed.value ->> 'item_id' = target ->> 'item_id' and rule.action = 'set_category'
              and private.takeoff_uuid_or_null(rule.action_params -> 'category_id')
                = private.takeoff_uuid_or_null(target #> '{rule,category_id}'))) then
        raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
          detail = pg_catalog.jsonb_build_object('reason', 'mapping_changed', 'item_id', target ->> 'item_id')::text;
      end if;
      -- Its section: one this plan creates, or one an earlier send by item created, by its identity.
      if not (exists (select 1 from pg_catalog.jsonb_array_elements(plan -> 'sections') as s(value)
            where s.value ->> 'key' = target #>> '{line,section_key}')
          and coalesce(target #> '{line,section_id}', 'null'::jsonb) = 'null'::jsonb)
        and not exists (select 1 from public.takeoff_item_send_sections as s
          where s.version_id = target_version and s.section_key = target #>> '{line,section_key}'
            and s.estimate_item_id = private.takeoff_uuid_or_null(target #> '{line,section_id}')) then
        raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
          detail = pg_catalog.jsonb_build_object('reason', 'sections_changed')::text;
      end if;
      after := private.takeoff_item_send_rounded(added, factor);
    else
      select * into line from public.estimate_items as item
      where item.id = (target #>> '{line,estimate_item_id}')::uuid and item.version_id = target_version and item.tenant_id = tenant
        and item.item_type = 'line'::public.estimate_item_type;
      if line.id is null or line.updated_at is distinct from (target #>> '{line,expected_updated_at}')::timestamptz
        or line.quantity is distinct from (target #>> '{line,expected_quantity}')::numeric
        or private.takeoff_item_send_unit(line.unit_code) is distinct from target ->> 'unit_code'
        or (target #>> '{line,kind}' = 'dpgf_line') is distinct from (line.source_provider = 'dpgf') then
        raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
          detail = pg_catalog.jsonb_build_object('reason', 'line_changed', 'estimate_item_id', line.id)::text;
      end if;
      select * into live_target from public.takeoff_item_send_targets as t where t.estimate_item_id = line.id;
      live_target_id := live_target.id;
      -- A line live for another item, another compartment or another breakdown is never this one's target.
      if live_target_id is not null and (live_target.item_id <> (target ->> 'item_id')::uuid
          or live_target.compartment_key <> target ->> 'compartment_key'
          or (live_target.breakdown = 'dpgf') <> (target #>> '{line,kind}' = 'dpgf_line')
          or (live_target.breakdown <> 'dpgf' and live_target.breakdown <> send_breakdown)) then
        raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
          detail = pg_catalog.jsonb_build_object('reason', 'target_claimed', 'estimate_item_id', line.id)::text;
      end if;
      if target #>> '{line,kind}' = 'earlier_line' and live_target_id is null then
        raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
          detail = pg_catalog.jsonb_build_object('reason', 'target_changed', 'estimate_item_id', line.id)::text;
      end if;
      -- A DPGF line is of the item's import; its first claim is proven by its lineage, or chosen by the member.
      if target #>> '{line,kind}' = 'dpgf_line' and (pg_catalog.lower(line.source_metadata ->> 'import_id')
          = pg_catalog.lower(entry_row.origin ->> 'importId')) is not true then
        raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
          detail = pg_catalog.jsonb_build_object('reason', 'target_unproven', 'estimate_item_id', line.id)::text;
      end if;
      if target #>> '{line,kind}' = 'dpgf_line' and live_target_id is null
        and not exists (select 1 from public.read_estimate_dpgf_raw_rows(tenant, target_version) as lineage
          where lineage.estimate_item_id = line.id and lineage.import_id::text = pg_catalog.lower(entry_row.origin ->> 'importId')
            and lineage.raw_row_id::text = pg_catalog.lower(entry_row.origin ->> 'rawRowId'))
        and not exists (select 1 from pg_catalog.jsonb_array_elements(deps -> 'resolutions') as r(value)
          where r.value ->> 'key' = 'target:' || (target ->> 'key') and r.value #>> '{choice,kind}' = 'line'
            and pg_catalog.lower(r.value #>> '{choice,estimate_item_id}') = line.id::text) then
        raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
          detail = pg_catalog.jsonb_build_object('reason', 'target_unproven', 'estimate_item_id', line.id)::text;
      end if;
      -- What this confirmation replaces: the line's live parts of the item read on this same plan on the pages it covers
      -- (a part also lying on a page it does not cover is not cut), and those the page decisions take out.
      if exists (select 1 from public.takeoff_item_send_parts as p
          where p.target_id = live_target_id and p.state = 'live' and p.plan_logical_id = plan_key
            and p.kind <> 'verified_count' and pg_catalog.cardinality(p.pages) > 0 and p.pages && covered and not (p.pages <@ covered)) then
        raise exception 'TAKEOFF_ITEM_SEND_PAGE_DECISION_INVALID' using errcode = '22023',
          detail = pg_catalog.jsonb_build_object('reason', 'part_indivisible', 'estimate_item_id', line.id)::text;
      end if;
      select coalesce(pg_catalog.array_agg(p.id order by p.id), '{}'::uuid[]) into target_replaced
      from public.takeoff_item_send_parts as p
      where p.target_id = live_target_id and p.state = 'live'
        and ((p.plan_logical_id = plan_key and (p.kind = 'verified_count' or (pg_catalog.cardinality(p.pages) > 0 and p.pages <@ covered)
            or (pg_catalog.cardinality(p.pages) = 0 and unit_pages <@ covered)))
          or p.id = any(page_replaced));
      -- A DPGF line of the item where the DPGF line an earlier send fed was deleted: the parts left live on that target
      -- leave with this send (kept in their history), never live beside the new ones, as a recreated new line retires its.
      if target #>> '{line,kind}' = 'dpgf_line' then
        target_replaced := target_replaced || coalesce((select pg_catalog.array_agg(p.id order by p.id)
          from public.takeoff_item_send_parts as p join public.takeoff_item_send_targets as t on t.id = p.target_id
          where t.version_id = target_version and t.item_id = (target ->> 'item_id')::uuid and t.breakdown = 'dpgf'
            and t.compartment_key = 'dpgf' and t.estimate_item_id is null and p.state = 'live'), '{}'::uuid[]);
      end if;
      -- What the line keeps of the item has one identity, this one, or nothing is added to it (the planner's earlierOf):
      -- the parts this confirmation replaces leave the line and are not compared.
      if exists (select 1 from public.takeoff_item_send_parts as p where p.target_id = live_target_id and p.state = 'live'
          and not (p.id = any(target_replaced))
          and pg_catalog.jsonb_build_object('unit', p.unit_code, 'basis', p.basis, 'network', p.network, 'material', p.material,
            'diameter', p.diameter) is distinct from identity) then
        raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
          detail = pg_catalog.jsonb_build_object('reason', 'identity_conflict', 'estimate_item_id', line.id)::text;
      end if;
      select coalesce(pg_catalog.sum(p.quantity) filter (where not (p.id = any(target_replaced))), 0),
          coalesce(pg_catalog.sum(p.quantity), 0), pg_catalog.count(*)::integer
        into kept_sum, all_sum, parts_count
      from public.takeoff_item_send_parts as p where p.target_id = live_target_id and p.state = 'live';
      reference := null;
      legacy_measure := 0;
      legacy_protective := 0;
      legacy_count := 0;
      if target #>> '{line,kind}' = 'dpgf_line' then
        reference := private.takeoff_item_send_dpgf_reference(tenant, line.source_metadata);
        if reference is distinct from (select (listed.value #>> '{dpgf,reference}')::numeric
            from pg_catalog.jsonb_array_elements(deps -> 'lines') as listed(value)
            where private.takeoff_uuid_or_null(listed.value -> 'estimate_item_id') = line.id) then
          raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
            detail = pg_catalog.jsonb_build_object('reason', 'dpgf_reference_unread', 'estimate_item_id', line.id)::text;
        end if;
        select coalesce(pg_catalog.sum(legacy.quantity), 0), coalesce(pg_catalog.sum(legacy.protective), 0), pg_catalog.count(*)::integer
          into legacy_measure, legacy_protective, legacy_count
        from private.takeoff_item_send_legacy_dpgf_parts(line.source_metadata, target_job_id) as legacy;
      end if;
      -- Before this send, the line held what all its earlier parts wrote (the policy's quantity), or its DPGF reference when
      -- nothing fed it; any other quantity was typed by hand, kept apart, never replaced without the member's choice.
      expected_before := case when parts_count + legacy_count > 0
        then private.takeoff_item_send_composed(reference, all_sum + legacy_measure, legacy_protective, factor) else reference end;
      typed := case when expected_before is null then line.quantity <> 0
        else pg_catalog.round(line.quantity, 4) <> pg_catalog.round(expected_before, 4) end;
      retained := private.takeoff_item_send_composed(reference, kept_sum + legacy_measure + added, legacy_protective, factor);
      after := retained;
      if typed then
        select r.value #>> '{choice,kind}' into choice from pg_catalog.jsonb_array_elements(deps -> 'resolutions') as r(value)
        where r.value ->> 'key' = 'entry:' || (target ->> 'key');
        if choice = 'keep_entry' then
          -- Kept below what the policy retains, the protective maximum would break: the line is not written.
          if reference is not null and line.quantity < retained then
            raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
              detail = pg_catalog.jsonb_build_object('reason', 'entry_suspended', 'estimate_item_id', line.id)::text;
          end if;
          after := line.quantity;
        elsif choice is distinct from 'use_retained' then
          raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
            detail = pg_catalog.jsonb_build_object('reason', 'line_changed', 'estimate_item_id', line.id)::text;
        end if;
      end if;
    end if;
    if has_retained then
      cumulative:=round(kept_sum+legacy_measure+added,4);
      cumulative_gap:=case when reference is not null then round(greatest(abs(cumulative-reference),
        private.takeoff_measure_printed_gap(line.source_metadata,target_job_id)),4) end;
      confirmation:=private.takeoff_measure_destination(tenant,job.project_id,target_job_id,
        case when destination_kind='existing_draft' then target_version end,target,reference,cumulative,cumulative_gap,after);
      if confirmation is not null then confirmations:=confirmations||jsonb_build_array(confirmation); end if;
    end if;
    -- The witness applies only to a whole-plan replacement of the named
    -- local part by this target. The coverage verdict above uses the searched
    -- pages after exclusions and held pages; a partial reading stays indivisible.
    if exists(select 1 from jsonb_array_elements(target->'replaces') r where r ? 'corrected_proof'
        and (whole_plan is not true or not ((r#>>'{corrected_proof,part_id}')::uuid=any(target_replaced)))) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode='40001',
        detail=jsonb_build_object('reason','earlier_send_changed')::text;
    end if;
    -- What the plan says it replaces is exactly what this confirmation replaces.
    if pg_catalog.jsonb_array_length(target -> 'replaces') <> pg_catalog.cardinality(target_replaced)
      or exists (select 1 from public.takeoff_item_send_parts as p where p.id = any(target_replaced)
        and not exists (select 1 from pg_catalog.jsonb_array_elements(target -> 'replaces') as r(value)
          where private.takeoff_uuid_or_null(r.value -> 'job_id') = p.job_id
            and private.takeoff_uuid_or_null(r.value -> 'answer_id') = p.answer_id
            and (p.kind <> 'verified_count' or r.value -> 'quantity' = pg_catalog.to_jsonb(p.quantity))
            and array(select private.takeoff_uuid_or_null(o.value) from pg_catalog.jsonb_array_elements(r.value -> 'observation_ids') as o(value)
              order by 1) = array(select o from pg_catalog.unnest(p.observation_ids) as o order by o))) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'earlier_send_changed', 'item_id', target ->> 'item_id')::text;
    end if;
    -- Never counted twice: this plan's earlier part of the item lies on this target only (elsewhere it would stay).
    if exists (select 1 from public.takeoff_item_send_parts as p
        join public.takeoff_item_send_targets as t on t.id = p.target_id
          and (t.estimate_item_id is not null or ((p.kind = 'verified_count' or incoming_count is not null)
            and not (p.id = any(target_replaced))))
        where p.version_id = target_version and p.state = 'live' and p.item_id = (target ->> 'item_id')::uuid
          and p.plan_logical_id = plan_key and p.target_id is distinct from live_target_id) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'earlier_part_elsewhere', 'item_id', target ->> 'item_id')::text;
    end if;
    -- The quantity written: engine 3 holds it as computed, and it is the one the member saw.
    if (after > 0 and after <= 999999999.999 and after = pg_catalog.round(after, 3)) is not true then
      raise exception 'TAKEOFF_ITEM_SEND_QUANTITY_UNWRITABLE' using errcode = '22023',
        detail = pg_catalog.jsonb_build_object('item_id', target ->> 'item_id')::text;
    end if;
    if after is distinct from (target ->> 'quantity_after')::numeric
      or (typed and choice = 'keep_entry') is distinct from coalesce((target #>> '{quantity,kept_entry}')::boolean, false) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'quantity_changed', 'item_id', target ->> 'item_id',
          'computed', pg_catalog.trim_scale(after))::text;
    end if;
    replaced_ids := replaced_ids || target_replaced;
    computed := computed || pg_catalog.jsonb_build_object(target ->> 'key', pg_catalog.jsonb_build_object('after', after,
      'target_id', live_target_id, 'line_id', line.id, 'before', line.quantity, 'identity', identity));
  end loop;
  -- The page contributions the plan shows are those of the parts it writes, page by page, each whole: its items, its
  -- targets and its observations, derived from the parts read again above, never the caller's.
  if (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('page', derived.page, 'item_ids', derived.items,
          'target_keys', derived.keys, 'observation_ids', derived.observations) order by derived.page), '[]'::jsonb)
      from (select page.value as page,
          pg_catalog.to_jsonb(pg_catalog.array_agg(distinct (t.value ->> 'item_id')::uuid order by (t.value ->> 'item_id')::uuid))
            as items,
          pg_catalog.to_jsonb(pg_catalog.array_agg(distinct t.value ->> 'key' order by t.value ->> 'key')) as keys,
          pg_catalog.to_jsonb(coalesce((select pg_catalog.array_agg(o.id order by o.id) from (
              select private.takeoff_uuid_or_null(observation.value) as id
              from pg_catalog.jsonb_array_elements(plan -> 'targets') as t2(value)
              cross join lateral pg_catalog.jsonb_array_elements(t2.value -> 'contributions') as c2(value)
              cross join lateral pg_catalog.jsonb_array_elements(c2.value -> 'observation_ids') as observation(value)
              where c2.value -> 'pages' @> pg_catalog.jsonb_build_array(page.value)) as o), '{}'::uuid[])) as observations
        from pg_catalog.jsonb_array_elements(plan -> 'targets') as t(value)
        cross join lateral pg_catalog.jsonb_array_elements(t.value -> 'contributions') as c(value)
        cross join lateral pg_catalog.jsonb_array_elements(c.value -> 'pages') as g(value)
        cross join lateral (select (g.value #>> '{}')::integer as value) as page
        group by page.value) as derived)
    is distinct from (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('page', (listed.value ->> 'page')::integer,
          'item_ids', pg_catalog.to_jsonb(array(select private.takeoff_uuid_or_null(i.value)
            from pg_catalog.jsonb_array_elements(listed.value -> 'item_ids') as i(value) order by 1)),
          'target_keys', pg_catalog.to_jsonb(array(select k.value #>> '{}'
            from pg_catalog.jsonb_array_elements(listed.value -> 'target_keys') as k(value) order by 1)),
          'observation_ids', pg_catalog.to_jsonb(array(select private.takeoff_uuid_or_null(o.value)
            from pg_catalog.jsonb_array_elements(listed.value -> 'observation_ids') as o(value) order by 1)))
        order by (listed.value ->> 'page')::integer), '[]'::jsonb)
      from pg_catalog.jsonb_array_elements(plan -> 'page_contributions') as listed(value)) then
    raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', 'page_contributions_changed')::text;
  end if;
  if confirmations is distinct from coalesce(plan->'measure_confirmations','[]'::jsonb) then
    raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode='40001',
      detail=jsonb_build_object('reason','measure_reconciliation_changed')::text;
  end if;
  -- A part a page replaced must leave the line this plan feeds: elsewhere, it would stay counted beside the new one.
  if exists (select 1 from pg_catalog.unnest(page_replaced) as r(id) where not (r.id = any(replaced_ids))) then
    raise exception 'TAKEOFF_ITEM_SEND_PAGE_DECISION_INVALID' using errcode = '22023',
      detail = pg_catalog.jsonb_build_object('reason', 'part_elsewhere')::text;
  end if;
  -- An addition made by a revision has no earlier local contribution. In
  -- particular no page decision, recreated target or replacement declaration
  -- can retire a part of another reading through the ordinary send writer.
  if p_revision_receipt is not null and (cardinality(page_replaced)>0 or cardinality(replaced_ids)>0) then
    raise exception 'TAKEOFF_REVISION_FOREIGN_PART' using errcode='55000';
  end if;

  -- The sections the plan creates: none already in the draft by its identity; under a section an earlier send by item
  -- created (by its identity) or one this plan creates before it; each with the list's title.
  for section in select value from pg_catalog.jsonb_array_elements(plan -> 'sections') loop
    if exists (select 1 from public.takeoff_item_send_sections as s
        where s.version_id = target_version and s.section_key = section ->> 'key' and s.estimate_item_id is not null)
      or (coalesce(section -> 'parent_id', 'null'::jsonb) <> 'null'::jsonb and not exists (select 1
        from public.takeoff_item_send_sections as s where s.version_id = target_version
          and s.estimate_item_id = (section ->> 'parent_id')::uuid and s.section_key = section ->> 'parent_key'))
      or (coalesce(section -> 'parent_id', 'null'::jsonb) = 'null'::jsonb
        and coalesce(section -> 'parent_key', 'null'::jsonb) <> 'null'::jsonb and not (section_ids ? (section ->> 'parent_key')))
      -- Its title is the list's: « Métré » without sections, the complement's, « Non réparti », or a section of the sealed
      -- list; a building's or a level's section carries the location's name as the plan read it.
      or (section ->> 'key' = 'list:' and section ->> 'title' <> 'Métré')
      or (section ->> 'key' = 'complement' and section ->> 'title' <> 'Compléments du métré hors DPGF')
      or (section ->> 'key' like '%/unallocated' and section ->> 'title' <> 'Non réparti')
      or (section ->> 'key' not in ('list:', 'complement') and section ->> 'key' not like '%/unallocated'
        and section ->> 'key' !~ '/(level|building):' and not exists (select 1 from public.takeoff_list_revision_entries as entry
          cross join lateral pg_catalog.jsonb_array_elements(entry.sections) as listed(value)
          where entry.revision_id = launch.item_list_revision_id and listed.value ->> 'title' = section ->> 'title')) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'sections_changed')::text;
    end if;
    section_ids := section_ids || pg_catalog.jsonb_build_object(section ->> 'key', true);
  end loop;
  section_ids := '{}'::jsonb;

  if p_check_only then
    return jsonb_build_object('targets',plan->'targets','sections',plan->'sections','left_out',plan->'left_out',
      'parts_not_sent',plan->'parts_not_sent','page_decisions',plan->'page_decisions');
  end if;
  -- The first draft, created by « Créer un devis »'s canonical path from the server's payload, under the tenant's policy
  -- (its engine and its creation contract), of engine 3 only, with the settings the plan showed. The affaire's row is
  -- held FOR UPDATE: two first creations of one affaire never cross.
  if destination_kind = 'first_draft' then
    created := public.persist_estimate_creation_atomic(tenant, actor, job.project_id, null, p_request -> 'version_payload',
      '[]'::jsonb, null);
    target_version := (created #>> '{version,id}')::uuid;
    created_version := true;
    -- A version created here has no other holder: its lease lives only in this transaction.
    insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
    values (target_version, actor, tenant, pg_catalog.statement_timestamp() + interval '5 minutes', gen_random_uuid())
    returning id into created_lock;
    select * into version_row from public.estimate_versions as version where version.id = target_version;
    if version_row.calc_engine_version is distinct from 3 then
      raise exception 'TAKEOFF_ITEM_SEND_ENGINE_NOT_V3' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_build_object('title', version_row.title, 'validite_jours', version_row.validite_jours,
        'margin_multiplier', version_row.margin_multiplier, 'margin_mode', version_row.margin_mode, 'currency', version_row.currency,
        'margin_bp', version_row.margin_bp, 'discount_bp', version_row.discount_bp,
        'discount_amount_cents', version_row.discount_amount_cents, 'discount_mode', version_row.discount_mode,
        'discount_steps', version_row.discount_steps, 'global_coefficient', version_row.global_coefficient,
        'tax_rate_bp', version_row.tax_rate_bp, 'rounding_mode', version_row.rounding_mode,
        'rounding_step_cents', version_row.rounding_step_cents, 'max_section_depth', version_row.max_section_depth,
        'calc_engine_version', version_row.calc_engine_version, 'contractor_role', version_row.contractor_role,
        'sale_coefficient_fo', version_row.sale_coefficient_fo, 'sale_coefficient_mo', version_row.sale_coefficient_mo)
      is distinct from (select coalesce(pg_catalog.jsonb_object_agg(setting.key, setting.value), '{}'::jsonb)
        from pg_catalog.jsonb_each(coalesce(deps #> '{stamps,first_draft_settings}', '{}'::jsonb)) as setting(key, value)
        where setting.key in ('title', 'validite_jours', 'margin_multiplier', 'margin_mode', 'currency', 'margin_bp',
          'discount_bp', 'discount_amount_cents', 'discount_mode', 'discount_steps', 'global_coefficient', 'tax_rate_bp',
          'rounding_mode', 'rounding_step_cents', 'max_section_depth', 'calc_engine_version', 'contractor_role',
          'sale_coefficient_fo', 'sale_coefficient_mo')) then
      raise exception 'TAKEOFF_ITEM_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'creation_policy_changed')::text;
    end if;
  end if;

  -- The writes. The relations of migration C accept them inside this transaction only.
  perform pg_catalog.set_config('mergeone.takeoff_item_send', request::text, true);
  previous_writer := coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true), '');
  perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', target_version::text, true);

  -- Sections, parents first, each after its siblings.
  for section in select value from pg_catalog.jsonb_array_elements(plan -> 'sections') loop
    parent := coalesce(private.takeoff_uuid_or_null(section -> 'parent_id'), (section_ids ->> (section ->> 'parent_key'))::uuid);
    select coalesce(pg_catalog.max(item.position), 0) + 1 into next_position from public.estimate_items as item
    where item.version_id = target_version and item.tenant_id = tenant and item.parent_id is not distinct from parent;
    insert into public.estimate_items (tenant_id, version_id, parent_id, item_type, position, title)
    values (tenant, target_version, parent, 'section'::public.estimate_item_type, next_position, section ->> 'title')
    returning id into new_id;
    insert into public.takeoff_item_send_sections (tenant_id, project_id, version_id, section_key, title, estimate_item_id, receipt_id)
    values (tenant, job.project_id, target_version, section ->> 'key', section ->> 'title', new_id, this_receipt);
    section_ids := section_ids || pg_catalog.jsonb_build_object(section ->> 'key', new_id);
    sections_out := sections_out || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('key', section ->> 'key',
      'estimate_item_id', new_id));
  end loop;

  -- The parts replaced leave their lines first (journal: replaced by this receipt).
  update public.takeoff_item_send_parts as p set state = 'replaced', replaced_by_receipt_id = this_receipt,
    replaced_at = pg_catalog.statement_timestamp()
  where p.id = any(replaced_ids) and p.state = 'live';

  for target in select value from pg_catalog.jsonb_array_elements(plan -> 'targets') loop
    facts := computed -> (target ->> 'key');
    after := (facts ->> 'after')::numeric;
    identity := facts -> 'identity';
    live_target_id := private.takeoff_uuid_or_null(facts -> 'target_id');
    if target #>> '{line,kind}' = 'new_line' then
      parent := coalesce(private.takeoff_uuid_or_null(target #> '{line,section_id}'),
        (section_ids ->> (target #>> '{line,section_key}'))::uuid);
      select coalesce(pg_catalog.max(item.position), 0) + 1 into next_position from public.estimate_items as item
      where item.version_id = target_version and item.tenant_id = tenant and item.parent_id = parent;
      -- Engine 3's initial values and no price; the unit kept in its code (and its description, as the takeoff writes it).
      insert into public.estimate_items (tenant_id, version_id, parent_id, item_type, position, title, description, quantity,
        unit_code, pricing_status, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo, pu_ht_cents,
        line_total_ht_cents, line_tax_cents, line_total_ttc_cents, category_id, source_provider, source_job_id, source_metadata)
      values (tenant, target_version, parent, 'line'::public.estimate_item_type, next_position, target #>> '{line,title}',
        target ->> 'unit_code', after, target ->> 'unit_code', 'priced'::public.estimate_line_pricing_status, 0,
        version_row.tax_rate_bp, 1, 0, 1, 1, 0, 0, 0, 0, private.takeoff_uuid_or_null(target #> '{rule,category_id}'), 'takeoff',
        target_job_id, pg_catalog.jsonb_build_object('takeoff_item_send', pg_catalog.jsonb_build_object('version', 1,
          'item_id', target ->> 'item_id', 'compartment_key', target ->> 'compartment_key', 'breakdown', send_breakdown)))
      returning id into new_id;
      insert into public.takeoff_item_send_targets (tenant_id, project_id, version_id, item_id, breakdown, compartment_key,
        estimate_item_id, line_kind, unit_code, basis, network, material, diameter, created_by_receipt_id)
      values (tenant, job.project_id, target_version, (target ->> 'item_id')::uuid, send_breakdown, target ->> 'compartment_key',
        new_id, 'new_line', target ->> 'unit_code', identity ->> 'basis', identity ->> 'network', identity ->> 'material',
        identity ->> 'diameter', this_receipt)
      returning id into live_target_id;
      lines_out := lines_out || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('target_key', target ->> 'key',
        'item_id', target ->> 'item_id', 'estimate_item_id', new_id, 'change', 'created', 'quantity_before', null,
        'quantity_after', pg_catalog.trim_scale(after)));
    else
      new_id := private.takeoff_uuid_or_null(facts -> 'line_id');
      if live_target_id is null then
        insert into public.takeoff_item_send_targets (tenant_id, project_id, version_id, item_id, breakdown, compartment_key,
          estimate_item_id, line_kind, unit_code, basis, network, material, diameter, created_by_receipt_id)
        values (tenant, job.project_id, target_version, (target ->> 'item_id')::uuid, 'dpgf', 'dpgf', new_id, 'dpgf_line',
          target ->> 'unit_code', identity ->> 'basis', identity ->> 'network', identity ->> 'material', identity ->> 'diameter',
          this_receipt)
        returning id into live_target_id;
      end if;
      -- Only the quantity moves (and what engine 3 derives from it); the provenance says a send by item feeds the line.
      update public.estimate_items as item set quantity = after,
        source_metadata = coalesce(item.source_metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object('takeoff_item_send',
          pg_catalog.jsonb_build_object('version', 1, 'item_id', target ->> 'item_id',
            'compartment_key', target ->> 'compartment_key',
            'breakdown', case when target #>> '{line,kind}' = 'dpgf_line' then 'dpgf' else send_breakdown end)),
        updated_at = pg_catalog.statement_timestamp()
      where item.id = new_id;
      lines_out := lines_out || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('target_key', target ->> 'key',
        'item_id', target ->> 'item_id', 'estimate_item_id', new_id,
        'change', case when (facts ->> 'before')::numeric = after then 'unchanged' else 'changed' end,
        'quantity_before', pg_catalog.trim_scale((facts ->> 'before')::numeric), 'quantity_after', pg_catalog.trim_scale(after)));
    end if;
    written_ids := written_ids || new_id;
    -- The parts, as read from the stored rows and entries, with the identity derived here.
    for part in
      select stored.value as stored
      from pg_catalog.jsonb_array_elements(target -> 'contributions') as c(value)
      join pg_catalog.jsonb_array_elements(job_parts) as stored(value) on stored.value ->> 'item_id' = target ->> 'item_id'
        and stored.value ->> 'answer_id' = c.value ->> 'answer_id' and stored.value ->> 'kind' = c.value ->> 'kind'
        and (stored.value ->> 'kind' <> 'measured'
          or pg_catalog.jsonb_build_array(stored.value -> 'observation_id') = c.value -> 'observation_ids')
    loop
      insert into public.takeoff_item_send_parts (tenant_id, project_id, version_id, target_id, receipt_id, job_id, item_id,
        plan_logical_id, kind, answer_id, answer_revision, decision_revision, marks_revision, entry_id, entry_revision, observation_ids,
        takeoff_item_ids, quantity, unit, unit_code, basis, network, material, diameter, pages)
      values (tenant, job.project_id, target_version, live_target_id, this_receipt, target_job_id, (target ->> 'item_id')::uuid,
        (part.stored ->> 'plan_logical_id')::uuid, part.stored ->> 'kind', (part.stored ->> 'answer_id')::uuid,
        part.stored ->> 'answer_revision', (part.stored ->> 'decision_revision')::integer, (part.stored ->> 'marks_revision')::integer,
        private.takeoff_uuid_or_null(part.stored -> 'entry_id'), (part.stored ->> 'entry_revision')::integer,
        case when part.stored ->> 'kind' = 'measured' then array[(part.stored ->> 'observation_id')::uuid] else '{}'::uuid[] end,
        case when part.stored ->> 'kind' = 'measured' then array[(part.stored ->> 'takeoff_item_id')::uuid]
          when part.stored ->> 'kind' = 'verified_count' then array(select x::uuid from
            pg_catalog.jsonb_array_elements_text(part.stored -> 'takeoff_item_ids') x)
          else '{}'::uuid[] end,
        (part.stored ->> 'quantity')::numeric, part.stored ->> 'unit', target ->> 'unit_code', identity ->> 'basis',
        identity ->> 'network', identity ->> 'material', identity ->> 'diameter',
        array(select (g.value #>> '{}')::integer from pg_catalog.jsonb_array_elements(part.stored -> 'pages') as g(value)));
    end loop;
  end loop;
  -- What engine 3 derives from the quantities, for the lines this send wrote.
  perform public.estimate_v3_complete_entry_for_writer(target_version, written_ids);
  perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', previous_writer, true);

  if p_revision_receipt is not null then
    return jsonb_build_object('lines',lines_out,'sections_created',sections_out);
  end if;
  perform private.record_takeoff_contribution_pages(tenant,job.project_id,target_version,this_receipt,target_job_id,plan_document);

  -- The job: linked to its draft through the door of this transaction (naming the acting member), then applied (B2
  -- closes its plan to every bulk gesture, as after today's send).
  insert into private.takeoff_job_attachment_permits (job_id, tenant_id, project_id, version_id)
  values (target_job_id, tenant, job.project_id, target_version);
  insert into private.takeoff_item_send_checks (job_id, actor_id) values (target_job_id, actor);
  update public.takeoff_jobs as attached set estimate_version_id = target_version where attached.id = target_job_id;
  if exists (select 1 from private.takeoff_job_attachment_permits as permit where permit.job_id = target_job_id) then
    raise exception 'TAKEOFF_ITEM_SEND_PERMIT_NOT_CONSUMED' using errcode = 'P0001';
  end if;
  update public.takeoff_jobs as sent set status = 'applied'::public.takeoff_job_status,
    completed_at = coalesce(sent.completed_at, pg_catalog.statement_timestamp()), updated_at = pg_catalog.statement_timestamp()
  where sent.id = target_job_id;
  delete from private.takeoff_item_send_checks as checked where checked.job_id = target_job_id;
  if created_lock is not null then
    delete from public.draft_locks as lock_row where lock_row.id = created_lock;
  end if;

  -- The receipt: what was written, in the plan's order; the first line written is the one to open (else the first
  -- section created).
  focus := (select private.takeoff_uuid_or_null(l.value -> 'estimate_item_id')
    from pg_catalog.jsonb_array_elements(lines_out) with ordinality as l(value, n)
    where l.value ->> 'change' <> 'unchanged' order by l.n limit 1);
  outcome := pg_catalog.jsonb_build_object('format', 'takeoff_item_send', 'format_version', 1, 'job_id', target_job_id,
    'version_id', target_version, 'version_created', created_version, 'sections_created', sections_out, 'lines', lines_out,
    'lines_written', (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(lines_out) as l(value)
      where l.value ->> 'change' <> 'unchanged'),
    'parts_written', (select pg_catalog.count(*) from public.takeoff_item_send_parts as p where p.receipt_id = this_receipt),
    'parts_replaced', pg_catalog.cardinality(replaced_ids), 'page_decisions', plan -> 'page_decisions',
    'focus_item_id', coalesce(focus, private.takeoff_uuid_or_null(sections_out #> '{0,estimate_item_id}')),
    'override', null,
    'rules', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('item_id', t.value ->> 'item_id',
        'rule', t.value -> 'rule') order by t.ordinality)
      from pg_catalog.jsonb_array_elements(plan -> 'targets') with ordinality as t(value, ordinality)
      where coalesce(t.value -> 'rule', 'null'::jsonb) <> 'null'::jsonb), '[]'::jsonb));
  begin
    insert into public.takeoff_item_send_receipts (id, tenant_id, project_id, job_id, version_id, request_id, format_version,
      actor_id, plan_sha256, version_created, write_plan, result)
    values (this_receipt, tenant, job.project_id, target_job_id, target_version, request, 1, actor, plan_sha, created_version, plan,
      outcome);
  exception when unique_violation then
    -- The same intention key used meanwhile by a send of another affaire of the tenant: the documented conflict.
    raise exception 'TAKEOFF_ITEM_SEND_REQUEST_CONFLICT' using errcode = '40001';
  end;
  perform pg_catalog.set_config('mergeone.takeoff_item_send', '', true);
  return pg_catalog.jsonb_build_object('receipt_id', this_receipt, 'replayed', false) || outcome;
end;
$$;

revoke all on function private.takeoff_measure_row_facts(public.takeoff_items),
  private.record_takeoff_measure_justification(),private.takeoff_legacy_measure_justified(public.takeoff_items),private.takeoff_measure_facts(public.takeoff_item_answers),
  private.takeoff_item_decision_effective(public.takeoff_item_answer_decisions,public.takeoff_item_answers,boolean,integer,private.takeoff_retained_measures),
  private.takeoff_measure_review(public.takeoff_item_answers),
  private.takeoff_measure_destination(uuid,uuid,uuid,uuid,jsonb,numeric,numeric,numeric,numeric),
  private.takeoff_measure_printed_gap(jsonb,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.read_takeoff_measure_review(uuid,uuid,uuid),public.retain_takeoff_measure(uuid,uuid,uuid,uuid,jsonb),
  public.read_takeoff_measure_destination_reviews(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.read_takeoff_measure_review(uuid,uuid,uuid),public.retain_takeoff_measure(uuid,uuid,uuid,uuid,jsonb),
  public.read_takeoff_measure_destination_reviews(uuid,uuid,jsonb) to authenticated;
commit;
