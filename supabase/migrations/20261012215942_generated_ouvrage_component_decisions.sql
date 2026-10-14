begin;

-- CORE-07: preserve proposals and server-owned decisions; apply only retained
-- identities. No historical row, receipt, application or snapshot is rewritten.
create function private.generated_ouvrage_component_content(component jsonb)
returns jsonb language sql immutable security invoker set search_path='' as $$
  select jsonb_build_object(
    'costType',component->'costType',
    'designation',regexp_replace(btrim(component->>'designation'),'\s+',' ','g'),
    'unit',nullif(btrim(component->>'unit'),''),
    'quantity',round((component->>'quantity')::numeric,3),
    'unitCostHtCents',(component->>'unitCostHtCents')::numeric,
    'lossCoeffBp',(component->>'lossCoeffBp')::numeric,
    'yieldValue',round((component->>'yieldValue')::numeric,3),
    'yieldUnit',nullif(btrim(component->>'yieldUnit'),''),
    'confidence',round((component->>'confidence')::numeric,4),
    'sourceLabel',nullif(btrim(component->>'sourceLabel'),''),
    'facts',coalesce((select jsonb_agg(to_jsonb(regexp_replace(btrim(x.value#>>'{}'),'\s+',' ','g')) order by x.ordinality) from jsonb_array_elements(component->'facts') with ordinality x where btrim(x.value#>>'{}')<>''),'[]'::jsonb),
    'hypotheses',coalesce((select jsonb_agg(to_jsonb(regexp_replace(btrim(x.value#>>'{}'),'\s+',' ','g')) order by x.ordinality) from jsonb_array_elements(component->'hypotheses') with ordinality x where btrim(x.value#>>'{}')<>''),'[]'::jsonb),
    'inferences',coalesce((select jsonb_agg(to_jsonb(regexp_replace(btrim(x.value#>>'{}'),'\s+',' ','g')) order by x.ordinality) from jsonb_array_elements(component->'inferences') with ordinality x where btrim(x.value#>>'{}')<>''),'[]'::jsonb),
    'riskSignals',coalesce(component->'riskSignals','[]'::jsonb),
    'sources',coalesce((select jsonb_agg(jsonb_build_object(
      'sourceFragmentId',(x.value->>'sourceFragmentId')::uuid,'evidenceKind',x.value->'evidenceKind','note',nullif(btrim(x.value->>'note'),''))
      order by x.ordinality) from jsonb_array_elements(component->'sources') with ordinality x),'[]'::jsonb)
  );
$$;
revoke all on function private.generated_ouvrage_component_content(jsonb) from public,anon,authenticated,service_role;

create or replace function public.persist_generated_ouvrage_review(p_version_id uuid,p_draft_id uuid,p_candidate_id uuid,
  p_draft_lock_session_id uuid,p_expected_review_token text,p_review jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; review jsonb; component jsonb; source jsonb; part record; source_part record;
  target_subdetail_id uuid; component_id uuid; existing_ids uuid[]; supplied_ids uuid[]; allowed text[];
  old_component jsonb; old_content jsonb; new_content jsonb; old_sources jsonb; new_metadata jsonb; prepared_components jsonb:='[]';
  origin text; expected_status text; content_changed boolean; restore_known boolean; restore_manual boolean; history jsonb; metadata_bytes bigint:=0;
begin
  ctx:=private.generated_ouvrage_lock(p_version_id,p_draft_id);
  perform private.generated_ouvrage_mutable(ctx,p_draft_lock_session_id);
  perform 1 from public.estimate_generated_ouvrage_candidates where id=p_candidate_id and draft_id=p_draft_id for update nowait;
  review:=private.generated_ouvrage_review(p_draft_id,p_candidate_id);
  if review->'candidate'='null'::jsonb then perform private.generated_ouvrage_error('NOT_FOUND'); end if;
  if review->'candidate'->>'resolution_status'<>'pending' then perform private.generated_ouvrage_error('REVIEW_CHANGED'); end if;
  if review->>'reviewToken' is distinct from p_expected_review_token then perform private.generated_ouvrage_error('REVIEW_CHANGED'); end if;
  if jsonb_typeof(p_review) is distinct from 'object' or p_review-array['status','summary','generation_metadata','components']<>'{}'::jsonb
    or not(p_review?&array['status','summary','generation_metadata','components']) or p_review->>'status' not in('pending_review','reviewed')
    or jsonb_typeof(p_review->'summary') is distinct from 'object' or jsonb_typeof(p_review->'generation_metadata') is distinct from 'object'
    or jsonb_typeof(p_review->'components') is distinct from 'array' or jsonb_array_length(p_review->'components') not between 1 and 24
    or octet_length(p_review::text)>1048576 then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  select coalesce(array_agg((x->>'id')::uuid),'{}') into existing_ids from jsonb_array_elements(review->'items') x;
  select coalesce(array_agg((x->>'componentId')::uuid) filter(where x->>'componentId' is not null),'{}') into supplied_ids from jsonb_array_elements(p_review->'components') x;
  if cardinality(supplied_ids)<>(select count(distinct x) from unnest(supplied_ids)x) or exists(select 1 from unnest(supplied_ids)x where not(x=any(existing_ids)))
    or exists(select 1 from unnest(existing_ids)x where not(x=any(supplied_ids))) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  allowed:=array['componentId','status','costType','designation','unit','quantity','unitCostHtCents','lossCoeffBp','yieldValue','yieldUnit','confidence','sourceLabel','facts','hypotheses','inferences','riskSignals','sources','restore','restoreAsManual'];
  for component in select * from jsonb_array_elements(p_review->'components') loop
    if jsonb_typeof(component)<>'object' or component-allowed<>'{}'::jsonb or not(component?&array['status','costType','designation','quantity','unitCostHtCents','lossCoeffBp','confidence','facts','hypotheses','inferences','riskSignals','sources'])
      or component->>'status' not in('suggested','manual','rejected') or component->>'costType' not in('material','labor','equipment','subcontract')
      or jsonb_typeof(component->'designation')<>'string' or length(btrim(component->>'designation')) not between 1 and 500
      or jsonb_typeof(component->'sources')<>'array' or jsonb_array_length(component->'sources')>6 then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    if exists(select 1 from jsonb_each(component) x where x.key in('quantity','unitCostHtCents','lossCoeffBp','confidence') and (jsonb_typeof(x.value)<>'number' or x.value::text::numeric<0)) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    if (component->>'unitCostHtCents')::numeric<>trunc((component->>'unitCostHtCents')::numeric) or (component->>'lossCoeffBp')::numeric<>trunc((component->>'lossCoeffBp')::numeric) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    if exists(select 1 from unnest(array['facts','hypotheses','inferences','riskSignals']) key where jsonb_typeof(component->key)<>'array' or jsonb_array_length(component->key)>8) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    for source in select * from jsonb_array_elements(component->'sources') loop
      if jsonb_typeof(source)<>'object' or source-array['sourceFragmentId','evidenceKind','note']<>'{}'::jsonb or source->>'evidenceKind' not in('fact','hypothesis','inference') then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
      perform 1 from public.estimate_generated_ouvrage_source_fragments where id=(source->>'sourceFragmentId')::uuid and draft_id=p_draft_id and status='active' for share nowait;
      if not found then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    end loop;
    if exists(select 1 from jsonb_each(component) x where x.key in('restore','restoreAsManual') and jsonb_typeof(x.value)<>'boolean') then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    restore_known:=coalesce((component->>'restore')::boolean,false); restore_manual:=coalesce((component->>'restoreAsManual')::boolean,false);
    if restore_known and restore_manual then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    new_content:=private.generated_ouvrage_component_content(component);
    old_component:=null;
    select x into old_component from jsonb_array_elements(review->'items')x where (x->>'id')::uuid=(component->>'componentId')::uuid;
    new_metadata:=coalesce(old_component->'metadata','{}'::jsonb); origin:=null;
    if new_metadata?'rejected_from_status' and new_metadata->'rejected_from_status'<>'null'::jsonb
      and new_metadata->>'rejected_from_status' not in('suggested','manual') then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    if old_component is null then
      if restore_known or restore_manual then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
      if component->>'status'='rejected' then origin:='manual'; end if;
    else
      select coalesce(jsonb_agg(jsonb_build_object('sourceFragmentId',s->'source_fragment_id','evidenceKind',s->'evidence_kind','note',s->'note') order by (s->>'source_rank')::integer,s->>'id'),'[]'::jsonb)
        into old_sources from jsonb_array_elements(review->'itemSources')s where s->>'component_id'=old_component->>'id';
      old_content:=private.generated_ouvrage_component_content(jsonb_build_object(
        'costType',old_component->'cost_type','designation',old_component->'designation','unit',old_component->'unit',
        'quantity',old_component->'quantity','unitCostHtCents',old_component->'unit_cost_ht_cents','lossCoeffBp',old_component->'loss_coeff_bp',
        'yieldValue',old_component->'yield_value','yieldUnit',old_component->'yield_unit','confidence',old_component->'confidence','sourceLabel',old_component->'source_label',
        'facts',old_component->'facts','hypotheses',old_component->'hypotheses','inferences',old_component->'inferences',
        'riskSignals',coalesce(old_component->'metadata'->'risk_signals','[]'::jsonb),'sources',old_sources));
      content_changed:=old_content is distinct from new_content;
      if old_component->>'status'='rejected' then
        origin:=old_component->'metadata'->>'rejected_from_status';
        if not(restore_known or restore_manual) then
          if component->>'status'<>'rejected' or content_changed then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
        else
          if (restore_known and origin is null) or (restore_manual and origin is not null) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
          expected_status:=case when restore_manual or content_changed then 'manual' else origin end;
          if component->>'status'='rejected' then origin:=expected_status;
          elsif component->>'status' is distinct from expected_status then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
        end if;
      else
        if restore_known or restore_manual then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
        expected_status:=case when content_changed then 'manual' else old_component->>'status' end;
        if component->>'status'='rejected' then origin:=expected_status;
        elsif component->>'status' is distinct from expected_status then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
      end if;
    end if;
    history:=coalesce(new_metadata->'review_decisions','[]'::jsonb);
    if jsonb_typeof(history)<>'array' then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    if (old_component is null and component->>'status'='rejected') or (old_component is not null and old_component->'status' is distinct from component->'status') or restore_known or restore_manual then
      history:=history||jsonb_build_array(jsonb_build_object('actor_id',(ctx->>'actor_id')::uuid,'decided_at',clock_timestamp(),
        'from_status',old_component->'status','to_status',component->'status','rejected_from_status',case when component->>'status'='rejected' then origin else null end,
        'action',case when restore_manual then 'restore_as_manual' when restore_known then 'restore' when component->>'status'='rejected' then 'reject' else 'edit' end));
    end if;
    new_metadata:=(new_metadata-'rejected_from_status')||jsonb_build_object('risk_signals',new_content->'riskSignals','review_decisions',history);
    if component->>'status'='rejected' and origin is not null then new_metadata:=new_metadata||jsonb_build_object('rejected_from_status',origin); end if;
    metadata_bytes:=metadata_bytes+octet_length(new_metadata::text);
    if metadata_bytes>1048576 then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    prepared_components:=prepared_components||jsonb_build_array((component||new_content)||jsonb_build_object('_server_metadata',new_metadata));
  end loop;
  if p_review->>'status'='reviewed' and not exists(select 1 from jsonb_array_elements(prepared_components)x where x->>'status'<>'rejected') then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  target_subdetail_id:=(review->'subdetailDraft'->>'id')::uuid;
  if target_subdetail_id is null then
    insert into public.estimate_generated_ouvrage_subdetail_drafts(tenant_id,project_id,target_version_id,draft_id,parent_work_id,created_by,status)
      values((ctx->>'tenant_id')::uuid,(ctx->>'project_id')::uuid,p_version_id,p_draft_id,p_candidate_id,(ctx->>'actor_id')::uuid,'pending_review') returning id into target_subdetail_id;
  end if;
  delete from public.estimate_generated_ouvrage_subdetail_items where subdetail_id=target_subdetail_id;
  for part in select value,ordinality from jsonb_array_elements(prepared_components) with ordinality loop
    component:=part.value; component_id:=coalesce((component->>'componentId')::uuid,gen_random_uuid());
    insert into public.estimate_generated_ouvrage_subdetail_items(id,tenant_id,project_id,draft_id,subdetail_id,parent_work_id,source_fragment_id,component_order,status,cost_type,designation,unit,quantity,unit_cost_ht_cents,loss_coeff_bp,yield_value,yield_unit,confidence,source_label,facts,hypotheses,inferences,metadata)
      values(component_id,(ctx->>'tenant_id')::uuid,(ctx->>'project_id')::uuid,p_draft_id,target_subdetail_id,p_candidate_id,(component->'sources'->0->>'sourceFragmentId')::uuid,part.ordinality-1,
        component->>'status',component->>'costType',btrim(component->>'designation'),nullif(btrim(component->>'unit'),''),(component->>'quantity')::numeric,(component->>'unitCostHtCents')::integer,(component->>'lossCoeffBp')::integer,
        (component->>'yieldValue')::numeric,nullif(btrim(component->>'yieldUnit'),''),(component->>'confidence')::numeric,nullif(btrim(component->>'sourceLabel'),''),component->'facts',component->'hypotheses',component->'inferences',component->'_server_metadata');
    for source_part in select value,ordinality from jsonb_array_elements(component->'sources') with ordinality loop
      source:=source_part.value;
      insert into public.estimate_generated_ouvrage_subdetail_item_sources(tenant_id,draft_id,subdetail_id,parent_work_id,component_id,source_fragment_id,source_rank,evidence_kind,note)
        values((ctx->>'tenant_id')::uuid,p_draft_id,target_subdetail_id,p_candidate_id,component_id,(source->>'sourceFragmentId')::uuid,source_part.ordinality-1,source->>'evidenceKind',nullif(btrim(source->>'note'),''));
    end loop;
  end loop;
  update public.estimate_generated_ouvrage_subdetail_drafts set status=p_review->>'status',summary=p_review->'summary',generation_metadata=p_review->'generation_metadata',applied_at=null where id=target_subdetail_id;
  return private.generated_ouvrage_review(p_draft_id,p_candidate_id);
exception when lock_not_available or deadlock_detected then perform private.generated_ouvrage_error('STALE'); return null;
  when invalid_text_representation or numeric_value_out_of_range then perform private.generated_ouvrage_error('INVALID_INPUT'); return null;
end $$;
revoke all on function public.persist_generated_ouvrage_review(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,service_role;
grant execute on function public.persist_generated_ouvrage_review(uuid,uuid,uuid,uuid,text,jsonb) to authenticated;

create or replace function private.generated_ouvrage_components(review jsonb,projections jsonb,parent_quantity numeric)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare component jsonb; projection jsonb; result jsonb:='[]'; sources jsonb; ids uuid[]; expected_ids uuid[];
begin
  if jsonb_typeof(projections) is distinct from 'array' then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  select coalesce(array_agg((x->>'id')::uuid order by (x->>'id')::uuid),'{}') into expected_ids from jsonb_array_elements(review->'items') x where x->>'status' in('suggested','manual');
  select coalesce(array_agg((x->>'componentId')::uuid order by (x->>'componentId')::uuid),'{}') into ids from jsonb_array_elements(projections) x;
  if ids is distinct from expected_ids or cardinality(ids) not between 1 and 24 then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  for component in select * from jsonb_array_elements(review->'items') x where x->>'status' in('suggested','manual') loop
    select x into projection from jsonb_array_elements(projections)x where (x->>'componentId')::uuid=(component->>'id')::uuid;
    if projection-array['componentId','kFo','kMo','hMo','dsCents']<>'{}'::jsonb or not(projection?&array['componentId','kFo','kMo','hMo','dsCents'])
      or exists(select 1 from jsonb_each(projection-'componentId') n where jsonb_typeof(n.value)<>'number' or n.value::text::numeric<0)
      or (projection->>'dsCents')::numeric<>trunc((projection->>'dsCents')::numeric) or (projection->>'dsCents')::numeric>2147483647
      or exists(select 1 from unnest(array['kFo','kMo','hMo']) key where (projection->>key)::numeric<>round((projection->>key)::numeric,3) or (projection->>key)::numeric>999999999.999)
      then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    if component->>'cost_type'<>'labor' and (projection->>'hMo')::numeric<>0 then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    if (projection->>'dsCents')::numeric is distinct from round((component->>'quantity')::numeric*(component->>'unit_cost_ht_cents')::numeric*(1+(component->>'loss_coeff_bp')::numeric/10000))
      or (projection->>'hMo')::numeric is distinct from (private.generated_ouvrage_hours(component,parent_quantity)->>'hours')::numeric then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    select coalesce(jsonb_agg(private.generated_ouvrage_source(f,l->>'evidence_kind',l->>'note') order by (l->>'source_rank')::integer,l->>'id'),'[]') into sources
      from jsonb_array_elements(review->'itemSources') l join jsonb_array_elements(review->'fragments') f on f->>'id'=l->>'source_fragment_id' where l->>'component_id'=component->>'id';
    result:=result||jsonb_build_array(jsonb_build_object('componentId',component->'id','status',component->'status','costType',component->'cost_type',
      'designation',component->'designation','unit',component->'unit','quantity',component->'quantity','unitCostHtCents',component->'unit_cost_ht_cents',
      'lossCoeffBp',component->'loss_coeff_bp','yieldValue',component->'yield_value','yieldUnit',component->'yield_unit','confidence',component->'confidence',
      'sourceLabel',component->'source_label','dsCents',projection->'dsCents','facts',component->'facts','hypotheses',component->'hypotheses',
      'inferences',component->'inferences','riskSignals',coalesce(component->'metadata'->'risk_signals','[]'::jsonb),'sources',sources));
  end loop;
  return result;
end $$;
revoke all on function private.generated_ouvrage_components(jsonb,jsonb,numeric) from public,anon,authenticated,service_role;

create or replace function public.commit_generated_ouvrages(p_version_id uuid,p_draft_id uuid,p_operation_key uuid,p_expected_updated_at timestamptz,
  p_draft_lock_session_id uuid,p_accepted_candidates jsonb,p_prepared_candidates jsonb,p_fallback_section jsonb,p_item_updates jsonb,p_version_patch jsonb,p_calculation_context jsonb,p_expected_preferred_role jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; v public.estimate_versions%rowtype; saved private.generated_ouvrage_application_receipts%rowtype;
  accepted jsonb; canonical_accepted jsonb:='[]'; canonical jsonb; prepared jsonb; review jsonb; reviewed_values jsonb; mapping jsonb; components jsonb; summary jsonb; component jsonb; projection jsonb; item_data jsonb; trace jsonb;
  source_ids jsonb; primary_source jsonb; applied_payload jsonb; library_source jsonb; applications jsonb:='[]'; response jsonb; d jsonb; raw_context jsonb; preferred_role jsonb;
  accepted_ids uuid[]; prepared_ids uuid[]; actual_ids uuid[]; supplied_ids uuid[]; created_item_ids uuid[]:='{}'; role_ids uuid[]; all_created_ids uuid[];
  target_tenant uuid; project_owner uuid; actor uuid; target_candidate_id uuid; assembly_id uuid; target_section uuid; next_position integer; ordinal integer:=0; lot_label text; assembly_name text;
  ds_total bigint; ds_fo bigint; ds_mo bigint; hours_total numeric; event_time timestamptz; breakdown jsonb; valid boolean;
  parent_fo numeric; parent_mo numeric; previous_rollup bigint; current_rollup bigint; raw_component jsonb; trace_ids uuid[]; labor_ids uuid[];
begin
  ctx:=private.generated_ouvrage_lock(p_version_id,p_draft_id);
  actor:=(ctx->>'actor_id')::uuid; target_tenant:=(ctx->>'tenant_id')::uuid; project_owner:=(ctx->>'user_id')::uuid;
  select * into v from public.estimate_versions where id=p_version_id;
  if p_operation_key is null then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  canonical:=private.canonical_generated_ouvrage_request(p_version_id,p_draft_id,actor,p_expected_updated_at,p_accepted_candidates);
  canonical_accepted:=canonical->'acceptedCandidates';
  select array_agg((x->>'candidateId')::uuid order by (x->>'candidateId')::uuid) into accepted_ids from jsonb_array_elements(canonical_accepted)x;
  if cardinality(accepted_ids)<>(select count(distinct x) from unnest(accepted_ids)x) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  select * into saved from private.generated_ouvrage_application_receipts where version_id=p_version_id and operation_key=p_operation_key;
  if found then
    if saved.actor_id<>actor or saved.tenant_id<>target_tenant or saved.project_id<>v.project_id or saved.canonical_request is distinct from canonical then perform private.generated_ouvrage_error('IDEMPOTENCY_CONFLICT'); end if;
    return saved.response||case when saved.response->>'outcome'='abandoned' then '{}'::jsonb else jsonb_build_object('replayed',true) end||jsonb_build_object('currentVersion',jsonb_build_object('id',v.id,'updatedAt',v.updated_at,'status',v.status));
  end if;
  perform private.generated_ouvrage_mutable(ctx,p_draft_lock_session_id);
  if v.updated_at is distinct from p_expected_updated_at then perform private.generated_ouvrage_error('STALE'); end if;
  perform id from public.estimate_items where version_id=p_version_id order by id for update nowait;
  perform id from public.estimate_generated_ouvrage_candidates where draft_id=p_draft_id order by id for update nowait;
  perform id from public.estimate_generated_ouvrage_subdetail_drafts where draft_id=p_draft_id order by id for update nowait;
  perform id from public.estimate_generated_ouvrage_subdetail_items where draft_id=p_draft_id order by id for update nowait;
  perform id from public.estimate_generated_ouvrage_subdetail_item_sources where draft_id=p_draft_id order by id for update nowait;
  perform id from public.estimate_generated_ouvrage_candidate_sources where draft_id=p_draft_id order by id for update nowait;
  perform id from public.estimate_generated_ouvrage_source_fragments where draft_id=p_draft_id order by id for share nowait;
  if jsonb_typeof(p_prepared_candidates) is distinct from 'array' or jsonb_typeof(p_item_updates) is distinct from 'array'
    or jsonb_typeof(p_version_patch) is distinct from 'object' or jsonb_typeof(p_calculation_context) is distinct from 'object'
    or octet_length(jsonb_build_array(p_prepared_candidates,p_item_updates,p_version_patch,p_calculation_context)::text)>2097152 then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  select array_agg((x->>'candidateId')::uuid order by (x->>'candidateId')::uuid) into prepared_ids from jsonb_array_elements(p_prepared_candidates)x;
  if prepared_ids is distinct from accepted_ids then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  select coalesce(array_agg(u.id),'{}') into all_created_ids from jsonb_array_elements(p_prepared_candidates)x cross join lateral unnest(array[(x->>'estimateItemId')::uuid,(x->>'assemblyId')::uuid,(x->>'applicationId')::uuid,(x->>'snapshotId')::uuid])u(id);
  if cardinality(all_created_ids)<>(select count(distinct x) from unnest(all_created_ids)x) or array_position(all_created_ids,null) is not null
    or exists(select 1 from public.estimate_items where id=any(all_created_ids)) or exists(select 1 from public.estimate_assemblies where id=any(all_created_ids))
    or exists(select 1 from public.estimate_generated_ouvrage_applications where id=any(all_created_ids)) or exists(select 1 from public.estimate_generated_ouvrage_work_snapshots where id=any(all_created_ids)) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  if p_version_patch-array['total_ht_cents','total_tax_cents','total_ttc_cents']<>'{}'::jsonb or not(p_version_patch?&array['total_ht_cents','total_tax_cents','total_ttc_cents'])
    or exists(select 1 from jsonb_each(p_version_patch)n where jsonb_typeof(n.value)<>'number' or n.value::text!~'^[0-9]+$' or n.value::text::numeric>2147483647) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  if exists(select 1 from jsonb_array_elements(p_item_updates)x where jsonb_typeof(x)<>'object' or x-array['id','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents']<>'{}'::jsonb or not(x?&array['id','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents']))
    or exists(select 1 from jsonb_array_elements(p_item_updates)x cross join lateral jsonb_each(x-'id')n where jsonb_typeof(n.value)<>'number' or n.value::text!~'^[0-9]+$' or n.value::text::numeric>2147483647) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  select coalesce(array_agg((x->>'id')::uuid order by (x->>'id')::uuid),'{}') into supplied_ids from jsonb_array_elements(p_item_updates)x;
  if cardinality(supplied_ids)<>(select count(distinct x) from unnest(supplied_ids)x) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  select jsonb_build_object('id',id,'name',name,'hourly_rate_cents',hourly_rate_cents,'is_active',is_active,'position',position) into preferred_role
    from public.labor_roles where tenant_id=target_tenant and user_id=project_owner and is_active order by position,id limit 1;
  if coalesce(preferred_role,'null'::jsonb) is distinct from coalesce(p_expected_preferred_role,'null'::jsonb) then perform private.generated_ouvrage_error('CONTEXT_CHANGED'); end if;
  if exists(select 1 from jsonb_array_elements(canonical_accepted)x where x->'lotId'='null'::jsonb) then
    if jsonb_typeof(p_fallback_section) is distinct from 'object' or p_fallback_section-array['id','created']<>'{}'::jsonb or not(p_fallback_section?&array['id','created']) or jsonb_typeof(p_fallback_section->'created')<>'boolean' then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    target_section:=(p_fallback_section->>'id')::uuid;
    if (p_fallback_section->>'created')::boolean then
      if target_section=any(all_created_ids) or exists(select 1 from public.estimate_items where id=target_section) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
      select coalesce(max(position),0)+1 into next_position from public.estimate_items where version_id=p_version_id and parent_id is null;
      insert into public.estimate_items(id,version_id,parent_id,item_type,position,title,source_provider) values(target_section,p_version_id,null,'section',next_position,'À classer','generated_ouvrage');
    elsif not exists(select 1 from public.estimate_items where id=target_section and version_id=p_version_id and tenant_id=target_tenant and item_type='section' and parent_id is null
      and regexp_replace(lower(regexp_replace(normalize(btrim(title),NFD),U&'[\0300-\036f]','','g')),'\s+',' ','g')='a classer') then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  elsif p_fallback_section is not null and p_fallback_section<>'null'::jsonb then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  for accepted in select * from jsonb_array_elements(canonical_accepted) loop
    target_candidate_id:=(accepted->>'candidateId')::uuid;
    select x into prepared from jsonb_array_elements(p_prepared_candidates)x where (x->>'candidateId')::uuid=target_candidate_id;
    if prepared-array['candidateId','subdetailId','estimateItemId','assemblyId','applicationId','snapshotId','resolvedLotId','placementMode','estimateItemMapping','componentProjections','item']<>'{}'::jsonb
      or not(prepared?&array['candidateId','subdetailId','estimateItemId','assemblyId','applicationId','snapshotId','resolvedLotId','placementMode','estimateItemMapping','componentProjections','item']) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    review:=private.generated_ouvrage_review(p_draft_id,target_candidate_id);
    if review->'candidate'='null'::jsonb then perform private.generated_ouvrage_error('NOT_FOUND'); end if;
    if review->'candidate'->>'resolution_status'<>'pending' or review->'subdetailDraft'->>'status' is distinct from 'reviewed'
      or exists(select 1 from public.estimate_generated_ouvrage_applications app where app.candidate_id=target_candidate_id) then perform private.generated_ouvrage_error('REVIEW_CHANGED'); end if;
    if review->>'reviewToken' is distinct from accepted->>'reviewToken' then perform private.generated_ouvrage_error('REVIEW_CHANGED'); end if;
    -- Historical inconsistent links must not be copied into immutable provenance.
    if exists(select 1 from jsonb_array_elements(review->'candidateSources')l where not exists(select 1 from jsonb_array_elements(review->'fragments')f where f->>'id'=l->>'source_fragment_id'))
      or exists(select 1 from jsonb_array_elements(review->'itemSources')l where not exists(select 1 from jsonb_array_elements(review->'fragments')f where f->>'id'=l->>'source_fragment_id'))
      or exists(select 1 from jsonb_array_elements(review->'items')i where i->>'source_fragment_id' is not null and not exists(select 1 from jsonb_array_elements(review->'fragments')f where f->>'id'=i->>'source_fragment_id')) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    if (review->'subdetailDraft'->>'id')::uuid is distinct from (prepared->>'subdetailId')::uuid then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    reviewed_values:=coalesce(review->'subdetailDraft'->'generation_metadata'->'reviewed_candidate',jsonb_build_object('designation',review->'candidate'->'designation','unit',review->'candidate'->'unit','quantity',review->'candidate'->'quantity'));
    if regexp_replace(btrim(reviewed_values->>'designation'),'\s+',' ','g') is distinct from accepted->>'designation'
      or nullif(btrim(reviewed_values->>'unit'),'') is distinct from accepted->>'unit' or (reviewed_values->>'quantity')::numeric is distinct from (accepted->>'quantity')::numeric then perform private.generated_ouvrage_error('REVIEW_CHANGED'); end if;
    target_section:=coalesce((accepted->>'lotId')::uuid,(p_fallback_section->>'id')::uuid);
    if target_section is distinct from (prepared->>'resolvedLotId')::uuid or prepared->>'placementMode' is distinct from (case when accepted->>'lotId' is null then 'fallback_unclassified' else 'explicit' end) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    select title into lot_label from public.estimate_items where id=target_section and version_id=p_version_id and tenant_id=target_tenant and item_type='section';
    if not found then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    components:=private.generated_ouvrage_components(review,prepared->'componentProjections',(accepted->>'quantity')::numeric);
    if exists(select 1 from jsonb_array_elements(components)x where x->>'costType'='labor') and preferred_role is null then perform private.generated_ouvrage_error('CONTEXT_CHANGED'); end if;
    select coalesce(sum((x->>'dsCents')::bigint),0),coalesce(sum((x->>'dsCents')::bigint)filter(where x->>'costType'<>'labor'),0),coalesce(sum((x->>'dsCents')::bigint)filter(where x->>'costType'='labor'),0) into ds_total,ds_fo,ds_mo from jsonb_array_elements(components)x;
    select coalesce(sum((x->>'hMo')::numeric),0) into hours_total from jsonb_array_elements(prepared->'componentProjections')x;
    mapping:=prepared->'estimateItemMapping';
    if jsonb_typeof(mapping) is distinct from 'object' or mapping-array['source','mode','unitPriceHtCents','hMo','kFo','kMo','laborRoleId','laborRoleName','laborRoleHourlyRateCents','totalDsCents','nonLaborDsCents','laborDsCents','costBreakdown','laborTrace']<>'{}'::jsonb
      or mapping->>'source' is distinct from 'generated_ouvrage_subdetail_review' or mapping->>'mode' not in('no_labor','legacy_labor_allocated','labor_hours_only','labor_hours_role_without_rate')
      or ds_total is distinct from (review->'subdetailDraft'->'summary'->>'ds_cents')::bigint or ds_total is distinct from (mapping->>'totalDsCents')::bigint
      or ds_fo is distinct from (mapping->>'nonLaborDsCents')::bigint or ds_mo is distinct from (mapping->>'laborDsCents')::bigint or hours_total is distinct from (mapping->>'hMo')::numeric then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    if mapping->>'laborRoleId' is not null and ((mapping->>'laborRoleId')::uuid is distinct from (preferred_role->>'id')::uuid or mapping->>'laborRoleName' is distinct from preferred_role->>'name' or mapping->'laborRoleHourlyRateCents' is distinct from preferred_role->'hourly_rate_cents') then perform private.generated_ouvrage_error('CONTEXT_CHANGED'); end if;
    if mapping->>'laborRoleId' is null and (mapping->>'laborRoleName' is not null or mapping->>'laborRoleHourlyRateCents' is not null) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    if (accepted->>'quantity')::numeric<>round((accepted->>'quantity')::numeric,3) or (accepted->>'quantity')::numeric>999999999.999
      or exists(select 1 from unnest(array['hMo','kFo','kMo'])key where jsonb_typeof(mapping->key)<>'number' or (mapping->>key)::numeric<0 or (mapping->>key)::numeric>999999999.999 or (mapping->>key)::numeric<>round((mapping->>key)::numeric,3))
      or jsonb_typeof(mapping->'unitPriceHtCents')<>'number' or (mapping->>'unitPriceHtCents')::numeric<0 or (mapping->>'unitPriceHtCents')::numeric>2147483647 or (mapping->>'unitPriceHtCents')::numeric<>trunc((mapping->>'unitPriceHtCents')::numeric) then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    parent_fo:=(accepted->>'quantity')::numeric*(mapping->>'unitPriceHtCents')::numeric*(mapping->>'kFo')::numeric;
    parent_mo:=(mapping->>'hMo')::numeric*coalesce((mapping->>'laborRoleHourlyRateCents')::numeric,0)*(mapping->>'kMo')::numeric;
    if round(parent_fo) is distinct from ds_fo or round(parent_mo) is distinct from ds_mo or round(parent_fo+parent_mo) is distinct from ds_total then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    select coalesce(jsonb_agg(jsonb_build_object('costType',kind,'componentCount',n,'quantity',quantity,'dsCents',ds) order by first_ordinal),'[]') into breakdown from (
      select x.value->>'costType' kind,count(*) n,sum((x.value->>'quantity')::numeric) quantity,sum((x.value->>'dsCents')::bigint)ds,min(x.ordinality)first_ordinal from jsonb_array_elements(components)with ordinality x group by x.value->>'costType') q;
    if mapping->'costBreakdown' is distinct from breakdown or jsonb_typeof(mapping->'laborTrace') is distinct from 'array' or jsonb_array_length(mapping->'laborTrace')<>(select count(*) from jsonb_array_elements(components)x where x->>'costType'='labor') then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    select coalesce(array_agg((x->>'componentId')::uuid order by (x->>'componentId')::uuid),'{}') into trace_ids from jsonb_array_elements(mapping->'laborTrace')x;
    select coalesce(array_agg((x->>'componentId')::uuid order by (x->>'componentId')::uuid),'{}') into labor_ids from jsonb_array_elements(components)x where x->>'costType'='labor';
    if trace_ids is distinct from labor_ids then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    for trace in select * from jsonb_array_elements(mapping->'laborTrace') loop
      select x into component from jsonb_array_elements(components)x where (x->>'componentId')::uuid=(trace->>'componentId')::uuid and x->>'costType'='labor';
      select x into projection from jsonb_array_elements(prepared->'componentProjections')x where (x->>'componentId')::uuid=(trace->>'componentId')::uuid;
      select x into raw_component from jsonb_array_elements(review->'items')x where (x->>'id')::uuid=(trace->>'componentId')::uuid;
      if component is null or trace-array['componentId','designation','unit','quantity','derivedHours','hoursSource','dsCents']<>'{}'::jsonb
        or trace->'designation' is distinct from component->'designation' or trace->'unit' is distinct from component->'unit' or trace->'quantity' is distinct from component->'quantity' or trace->'dsCents' is distinct from component->'dsCents'
        or trace->'derivedHours' is distinct from projection->'hMo' or trace->>'hoursSource' is distinct from private.generated_ouvrage_hours(raw_component,(accepted->>'quantity')::numeric)->>'source' then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    end loop;
    summary:=jsonb_build_object('componentCount',jsonb_array_length(components),'dsCents',ds_total,
      'indicativeTargetPriceCents',review->'subdetailDraft'->'summary'->'indicative_target_price_cents','confidence',review->'subdetailDraft'->'summary'->'confidence',
      'pricingSource',review->'subdetailDraft'->'summary'->'pricing_source','riskSignals',coalesce(review->'subdetailDraft'->'summary'->'risk_signals','[]'),
      'facts',coalesce(review->'subdetailDraft'->'summary'->'facts','[]'),'hypotheses',coalesce(review->'subdetailDraft'->'summary'->'hypotheses','[]'),'inferences',coalesce(review->'subdetailDraft'->'summary'->'inferences','[]'));
    select coalesce(jsonb_agg(x->'source_fragment_id' order by (x->>'source_rank')::integer,x->>'id'),'[]') into source_ids from jsonb_array_elements(review->'candidateSources')x;
    select f into primary_source from jsonb_array_elements(review->'candidateSources')l join jsonb_array_elements(review->'fragments')f on f->>'id'=l->>'source_fragment_id' order by (l->>'source_rank')::integer,l->>'id' limit 1;
    item_data:=prepared->'item';
    if (item_data->>'parent_id')::uuid is distinct from target_section or item_data->>'title' is distinct from accepted->>'designation' or item_data->'description' is distinct from accepted->'unit'
      or item_data->'quantity' is distinct from accepted->'quantity' or item_data->'unit_price_ht_cents' is distinct from mapping->'unitPriceHtCents'
      or item_data->'h_mo' is distinct from mapping->'hMo' or item_data->'k_fo' is distinct from mapping->'kFo' or item_data->'k_mo' is distinct from mapping->'kMo'
      or item_data->'labor_role_id' is distinct from mapping->'laborRoleId' or item_data->>'source_provider' is distinct from 'generated_ouvrage'
      or item_data->>'source_file_name' is distinct from primary_source->>'source_file_name' or item_data->>'source_page' is distinct from primary_source->>'source_page_from' then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    assembly_id:=(prepared->>'assemblyId')::uuid; assembly_name:=(accepted->>'designation')||' · '||left(target_candidate_id::text,8);
    library_source:=jsonb_build_object('kind','generated_ouvrage','draft_id',p_draft_id,'candidate_id',target_candidate_id,'source_fragment_ids',source_ids,'summary',summary,'estimate_item_mapping',mapping);
    insert into public.estimate_assemblies(id,tenant_id,created_by,name,description,reference_code,unit,pricing_source,ds_cents,indicative_target_price_cents,source_metadata)
      values(assembly_id,target_tenant,actor,assembly_name,'Ouvrage compose genere depuis '||(accepted->>'designation'),'EST383-'||upper(left(target_candidate_id::text,8)),accepted->>'unit','generated_ouvrage_review',ds_total,(summary->>'indicativeTargetPriceCents')::integer,library_source);
    ordinal:=0; previous_rollup:=0;
    for component in select * from jsonb_array_elements(components) loop
      ordinal:=ordinal+1; select x into projection from jsonb_array_elements(prepared->'componentProjections')x where x->>'componentId'=component->>'componentId';
      if component->>'costType'='labor' and ((projection->>'kFo')::numeric<>0 or round((projection->>'hMo')::numeric*(preferred_role->>'hourly_rate_cents')::numeric*(projection->>'kMo')::numeric) is distinct from (projection->>'dsCents')::numeric)
        or component->>'costType'<>'labor' and (projection->>'kMo')::numeric<>0 then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
      insert into public.estimate_assembly_items(tenant_id,assembly_id,title,unit,k_fo,k_mo,h_mo,labor_role_id,default_quantity,position,cost_type,unit_cost_ht_cents,loss_coeff_bp,yield_value,yield_unit,source_metadata)
        values(target_tenant,assembly_id,component->>'designation',component->>'unit',(projection->>'kFo')::numeric,(projection->>'kMo')::numeric,(projection->>'hMo')::numeric,case when component->>'costType'='labor' then (preferred_role->>'id')::uuid else null end,(component->>'quantity')::numeric,ordinal,component->>'costType',(component->>'unitCostHtCents')::integer,(component->>'lossCoeffBp')::integer,(component->>'yieldValue')::numeric,component->>'yieldUnit',
          jsonb_build_object('kind','generated_ouvrage','component_id',component->'componentId','source_label',component->'sourceLabel','confidence',component->'confidence','facts',component->'facts','hypotheses',component->'hypotheses','inferences',component->'inferences','risk_signals',component->'riskSignals','sources',component->'sources'));
      select ds_cents into current_rollup from public.estimate_assemblies where id=assembly_id;
      if current_rollup-previous_rollup is distinct from (projection->>'dsCents')::bigint then perform private.generated_ouvrage_error('APPLY_REJECTED'); end if;
      previous_rollup:=current_rollup;
    end loop;
    -- Reuse the existing canonical rollup, never silently overwrite its result.
    perform public.refresh_estimate_assembly_rollup(assembly_id);
    if not exists(select 1 from public.estimate_assemblies where id=assembly_id and ds_cents=ds_total and coalesce(avg_time_hours,0)=hours_total) then perform private.generated_ouvrage_error('APPLY_REJECTED'); end if;
    select x into projection from jsonb_array_elements(p_item_updates)x where (x->>'id')::uuid=(prepared->>'estimateItemId')::uuid;
    if projection is null then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
    perform private.generated_ouvrage_insert_line(p_version_id,(prepared->>'estimateItemId')::uuid,item_data,projection);
    created_item_ids:=array_append(created_item_ids,(prepared->>'estimateItemId')::uuid);
    applied_payload:=jsonb_build_object('designation',accepted->'designation','unit',accepted->'unit','quantity',accepted->'quantity','lot_id',target_section,
      'suggested_lot_id',review->'candidate'->'suggested_lot_id','ai_status',review->'candidate'->'ai_status','confidence',review->'candidate'->'confidence','source_fragment_ids',source_ids,
      'requested_lot_id',accepted->'lotId','resolved_lot_id',target_section,'resolved_lot_label',lot_label,'placement_mode',prepared->>'placementMode',
      'fallback_section_created',accepted->>'lotId' is null and coalesce((p_fallback_section->>'created')::boolean,false),'estimate_item_mapping',mapping);
    insert into public.estimate_generated_ouvrage_applications(id,tenant_id,draft_id,candidate_id,target_version_id,estimate_item_id,applied_by,applied_payload)
      values((prepared->>'applicationId')::uuid,target_tenant,p_draft_id,target_candidate_id,p_version_id,(prepared->>'estimateItemId')::uuid,actor,applied_payload);
    insert into public.estimate_generated_ouvrage_work_snapshots(id,tenant_id,project_id,target_version_id,draft_id,parent_work_id,assembly_id,estimate_item_id,applied_by,summary,components,metadata)
      values((prepared->>'snapshotId')::uuid,target_tenant,v.project_id,p_version_id,p_draft_id,target_candidate_id,assembly_id,(prepared->>'estimateItemId')::uuid,actor,
        summary||jsonb_build_object('assembly_name',assembly_name,'assembly_reference_code','EST383-'||upper(left(target_candidate_id::text,8))),components,
        jsonb_build_object('applied_values',applied_payload,'estimate_item_mapping',mapping,'ai_status',review->'candidate'->'ai_status','confidence',review->'candidate'->'confidence'));
    update public.estimate_generated_ouvrage_candidates set resolution_status='inserted',metadata=metadata||jsonb_build_object('applied_values',applied_payload) where id=target_candidate_id;
    applications:=applications||jsonb_build_array(jsonb_build_object('candidateId',target_candidate_id,'subdetailId',prepared->'subdetailId','assemblyId',assembly_id,'estimateItemId',prepared->'estimateItemId','applicationId',prepared->'applicationId','snapshotId',prepared->'snapshotId'));
  end loop;
  select coalesce(array_agg(id order by id),'{}') into actual_ids from public.estimate_items where version_id=p_version_id and item_type='line' and (v.calc_engine_version=2 or id=any(created_item_ids));
  if actual_ids is distinct from supplied_ids then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  select coalesce(array_agg(distinct r.id order by r.id),'{}') into role_ids from public.estimate_items i cross join lateral unnest(array[i.labor_role_id,i.labor_role_atelier_id,i.labor_role_chantier_id])r(id) where i.version_id=p_version_id and i.item_type='line' and r.id is not null;
  if v.calc_engine_version=2 and exists(select 1 from unnest(role_ids)r(id) where not exists(select 1 from public.labor_roles l where l.id=r.id and l.tenant_id=target_tenant and l.user_id=project_owner)) then perform private.generated_ouvrage_error('CONTEXT_CHANGED'); end if;
  select jsonb_build_object('labor_roles',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'tenant_id',l.tenant_id,'user_id',l.user_id,'hourly_rate_cents',l.hourly_rate_cents) order by l.id) from public.labor_roles l where l.id=any(role_ids) and l.tenant_id=target_tenant and l.user_id=project_owner),'[]'),
    'margin_tiers',case when v.margin_mode='tiered' then coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'threshold_cents',m.threshold_cents,'multiplier',m.multiplier,'position',m.position) order by m.threshold_cents,m.position,m.id) from public.margin_tiers m where m.tenant_id=target_tenant),'[]') else '[]'::jsonb end,
    'labor_split_flag',(select jsonb_build_object('id',f.id,'enabled',f.enabled) from public.feature_flags f where f.tenant_id=target_tenant and f.flag_key='EST_031_LABOR_SPLIT')) into raw_context;
  if raw_context is distinct from p_calculation_context then perform private.generated_ouvrage_error('CONTEXT_CHANGED'); end if;
  select * into v from public.estimate_versions where id=p_version_id;
  perform public.bulk_update_estimate_items(p_version_id,p_item_updates,p_version_patch,v.updated_at);
  d:=private.generated_ouvrage_project_draft(p_draft_id);
  update public.estimate_generated_ouvrage_subdetail_drafts set status='applied',applied_at=clock_timestamp() where draft_id=p_draft_id and parent_work_id=any(accepted_ids);
  insert into public.estimate_version_events(estimate_version_id,event_type,created_by,metadata)
    values(p_version_id,'generated_ouvrage_inserted',actor,jsonb_build_object('draft_id',p_draft_id,'candidate_ids',to_jsonb(accepted_ids),'inserted_count',cardinality(accepted_ids)));
  select * into v from public.estimate_versions where id=p_version_id;
  event_time:=clock_timestamp();
  response:=jsonb_build_object('ok',true,'insertedCount',cardinality(accepted_ids),'draftStatus',d->>'status','projectId',v.project_id,'versionId',p_version_id,'applications',applications,
    'version',jsonb_build_object('id',v.id,'updatedAt',v.updated_at),'totals',jsonb_build_object('totalHtCents',v.total_ht_cents,'totalTaxCents',v.total_tax_cents,'totalTtcCents',v.total_ttc_cents),
    'receipt',jsonb_build_object('operationKey',p_operation_key,'actorId',actor,'versionId',p_version_id,'draftId',p_draft_id,'expectedUpdatedAt',p_expected_updated_at,'acceptedCandidates',canonical_accepted,'committedAt',event_time));
  if octet_length(response::text)>2097152 then perform private.generated_ouvrage_error('INVALID_INPUT'); end if;
  insert into private.generated_ouvrage_application_receipts(version_id,operation_key,tenant_id,project_id,draft_id,actor_id,canonical_request,response,committed_at)
    values(p_version_id,p_operation_key,target_tenant,v.project_id,p_draft_id,actor,canonical,response,event_time);
  return response||jsonb_build_object('replayed',false,'currentVersion',jsonb_build_object('id',v.id,'updatedAt',v.updated_at,'status',v.status));
exception when lock_not_available or deadlock_detected then perform private.generated_ouvrage_error('STALE'); return null;
  when invalid_text_representation or numeric_value_out_of_range then perform private.generated_ouvrage_error('INVALID_INPUT'); return null;
  when integrity_constraint_violation then perform private.generated_ouvrage_error('APPLY_REJECTED'); return null;
end $$;
revoke all on function public.commit_generated_ouvrages(uuid,uuid,uuid,timestamptz,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.commit_generated_ouvrages(uuid,uuid,uuid,timestamptz,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated;

create or replace function private.source_coverage_target(l private.estimate_source_coverage_links,version uuid,project uuid,tenant uuid,scope jsonb,linked_items uuid[] default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare i public.estimate_items%rowtype; s public.estimate_generated_ouvrage_work_snapshots%rowtype;
 a public.estimate_generated_ouvrage_applications%rowtype; e public.affaire_register_entries%rowtype; comp jsonb;
 state text:='available'; why text; fact jsonb; lot uuid:=(scope->>'dpgfLotId')::uuid; found_parent boolean; mapping jsonb; expected_nature public.estimate_line_nature;
begin
  if l.kind='register' then
    select * into e from public.affaire_register_entries where id=l.register_entry_id;
    if not found then state:='missing'; why:='Entrée du registre supprimée';
    elsif e.tenant_id<>tenant or e.project_id<>project then state:='forbidden'; why:='Entrée du registre hors périmètre';
    else
      fact:=jsonb_build_object('kind','register','registerEntryId',e.id,'entryKind',e.kind,'text',e.text,'status',e.status,'scopeType',e.scope_type,'scopeId',e.scope_id,'scopeRef',e.scope_ref,'scopeLabel',e.scope_label,'active',e.is_active,'updatedAt',e.updated_at);
      if not e.is_active or(e.version_id is not null and e.version_id<>version) or(e.scope_type='lot' and e.scope_id is distinct from lot)
        or(e.scope_type='line' and not(e.scope_id=any(coalesce(linked_items,array(select item_id from private.estimate_source_coverage_links where requirement_id=l.requirement_id and kind in('line','component'))))))
        or(e.scope_type='exception' and nullif(btrim(e.scope_ref),'') is null)
      then state:='incompatible'; why:='Portée du registre incompatible ou entrée inactive'; end if;
    end if;
  else
    select * into i from public.estimate_items where id=l.item_id;
    if not found then state:='missing'; why:='Ligne supprimée';
    elsif i.tenant_id<>tenant or i.version_id<>version then state:='forbidden'; why:='Ligne hors version';
    elsif i.item_type<>'line' then state:='incompatible'; why:='Une section ne traite pas une prestation';
    else
      fact:=private.source_coverage_line_fact(i)||jsonb_build_object('kind','line');
      if i.quantity is null or i.quantity<=0 or i.quantity::text in('NaN','Infinity','-Infinity') or nullif(btrim(i.description),'') is null or nullif(btrim(i.title),'') is null then state:='incompatible'; why:='Données techniques de ligne incomplètes'; end if;
      if lot is not null then
        with recursive parents as(select id,parent_id from public.estimate_items where id=i.parent_id and version_id=version union all select x.id,x.parent_id from public.estimate_items x join parents p on x.id=p.parent_id where x.version_id=version)
          select exists(select 1 from parents where id=lot) into found_parent;
        if not found_parent then state:='incompatible'; why:='La ligne ne relève pas du contexte DPGF déclaré'; end if;
      end if;
      if l.kind='component' then
        select * into s from public.estimate_generated_ouvrage_work_snapshots where id=l.snapshot_id;
        if not found then state:='missing'; why:='Instantané appliqué supprimé'; fact:=null;
        else
          select * into a from public.estimate_generated_ouvrage_applications where id=l.application_id;
          if not found then state:='missing'; why:='Application supprimée'; fact:=null;
          elsif s.tenant_id<>tenant or s.project_id<>project or s.target_version_id<>version or a.tenant_id<>tenant or a.target_version_id<>version
            or s.estimate_item_id<>i.id or a.estimate_item_id<>i.id or a.draft_id<>s.draft_id or a.candidate_id<>s.parent_work_id
            or not exists(select 1 from public.estimate_generated_ouvrage_candidates where id=a.candidate_id and draft_id=a.draft_id and target_version_id=version and project_id=project and tenant_id=tenant and resolution_status='inserted')
            or not exists(select 1 from public.estimate_generated_ouvrage_drafts where id=a.draft_id and target_version_id=version and project_id=project and tenant_id=tenant and status in('applied','partially_applied'))
          then state:='incompatible'; why:='Application et instantané ne désignent pas ce parent'; fact:=null;
          else
            mapping:=coalesce(s.metadata->'estimate_item_mapping',a.applied_payload->'estimate_item_mapping','{}');
            expected_nature:=case when coalesce((mapping->>'hMo')::numeric,0)>0 or mapping->>'laborRoleId' is not null
              then case when coalesce((mapping->>'unitPriceHtCents')::numeric,1)>0 then 'supply_and_labor' else 'labor_only' end else 'supply_only' end;
            select value into comp from jsonb_array_elements(s.components) where value->>'componentId'=l.component_id;
            if comp is null then state:='missing'; why:='Composant appliqué absent'; fact:=null;
            elsif comp->>'status'='rejected' then state:='incompatible'; why:='Composant écarté dans la composition historique'; fact:=null;
            elsif jsonb_typeof(comp->'quantity') is distinct from 'number' or (comp->>'quantity')::numeric not between 0 and 1.7976931348623157e308 or nullif(btrim(comp->>'unit'),'') is null or nullif(btrim(comp->>'designation'),'') is null or nullif(comp->>'costType','') is null then state:='incompatible'; why:='Composition technique incomplète'; fact:=null;
            else
              fact:=jsonb_build_object('kind','component','itemId',i.id,'applicationId',a.id,'snapshotId',s.id,'componentId',l.component_id,'title',comp->>'designation','unit',comp->>'unit','quantity',comp->'quantity','componentType',comp->>'costType','parent',private.source_coverage_line_fact(i));
              if a.applied_payload->>'designation' is distinct from i.title or a.applied_payload->>'unit' is distinct from i.description
                or a.applied_payload->'quantity' is distinct from to_jsonb(i.quantity)
                or coalesce(s.metadata->'estimate_item_mapping'->'hMo',a.applied_payload->'estimate_item_mapping'->'hMo') is distinct from to_jsonb(i.h_mo)
                or i.line_nature is distinct from expected_nature or i.product_id is not null or i.supply_type_id is not null
                or i.labor_role_id is distinct from (mapping->>'laborRoleId')::uuid
                or coalesce(i.h_mo_atelier,0)<>0 or coalesce(i.h_mo_chantier,0)<>0
                or i.labor_role_atelier_id is not null or i.labor_role_chantier_id is not null
              then state:='incompatible'; why:='Le parent technique diffère de la composition appliquée'; end if;
            end if;
          end if;
        end if;
      end if;
    end if;
  end if;
  return jsonb_build_object('linkId',l.id,'state',state,'fact',fact,'reason',why);
exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
  return jsonb_build_object('linkId',l.id,'state','incompatible','fact',null,'reason','Données techniques de la cible illisibles');
end $$;
revoke all on function private.source_coverage_target(private.estimate_source_coverage_links,uuid,uuid,uuid,jsonb,uuid[]) from public,anon,authenticated,service_role;

commit;
