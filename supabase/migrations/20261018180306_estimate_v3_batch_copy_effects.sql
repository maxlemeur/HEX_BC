-- Lot 2, sub-lot 2.8b (review): a copy into a v3 is one public.commit_estimate_batch statement (sections from the
-- same or another version, the linked DPGF). Contract, failure modes and proofs: docs/testing/estimate-engine-v3-2.8b.md,
-- docs/testing/large-estimate-statement-budget.md (L7).
--
-- Observed (pgTAP probe L7, IO13 in CI run 39138950745): a 1 000-operation copy took 10-15 s locally and exceeded the
-- 8 s statement_timeout of the API roles in CI (503 BATCH_OUTCOME_UNKNOWN, nothing written); 100 operations into a
-- 1 021-item v3 took 4,1 s. The profile: the v3 projection rewrote every line of the version (bulk_update_estimate_items),
-- each no-op UPDATE firing the per-line content revision bump, two audit rows and the coverage invalidation; the
-- created id and the projection of each operation were found by scanning both arrays. Copies also lost the
-- source_metadata of their items (_timax_provenance, sourceDocumentId, import and mapping ids).
--
-- 1. On a v3 only, the projection passed to public.bulk_update_estimate_items keeps the lines whose amounts differ
--    from the stored ones; every other line keeps its stored amounts, which private.estimate_v3_assert_draft still
--    checks against the engine 3 (D12) with the footer, as before. v1/v2 versions keep the full projection.
-- 2. The created id and the projection of an operation are read from a map built once (same values).
-- 3. An entry of p_created_ids may carry source_metadata (a JSON object), written on the created item. Only the
--    server-side copies set p_created_ids (executeEstimateBatch never takes it from the HTTP batch API), and the
--    replayed receipt is unchanged: source_metadata is not part of the canonical request.
-- Owner decision of 18/10/2026 (« on accepte jusqu'à 3,5 s pour 1 000 lignes »): a copy into a v3 goes up to 1 000
-- operations again, under the 8 s statement_timeout of the API roles in CI (IO13). What remained was linear in the
-- operations (per-line triggers, the batch loop) plus two quadratic accumulations:
-- 4. A batch of creations only (the server-side copies, a paste) leaves the per-line effects of its inserts (content
--    revision, audit, source coverage, hierarchy depth) to public.estimate_creation_replay_item_effects_for_writer,
--    the one-pass replay of the atomic creation (M6b, 20261018013249), under its contract bound to this version: the
--    same rows, revisions and audit. Known difference: a depth refusal, already refused by the batch preparation
--    before any write, surfaces after the operations as a generic ESTIMATE_BATCH_INVALID_INPUT, not on an operation
--    (the replay walks the stored ancestors too, see 8). A batch with an update, delete or reorder keeps the per-line
--    triggers.
-- 5. A create that names its position and title skips the sibling max(position) scan and the ancestor walk, which
--    only feed those defaults; results and the canonical operations are accumulated in arrays instead of being
--    copied at each append (private.canonical_estimate_batch_operations: same output).
-- 6. The receipt does not echo the source_metadata a created item received from p_created_ids: with the provenance
--    of 1 000 lines it went over its 2 Mio; the limits are not raised (owner decision). A receipt still over 2 Mio
--    (1 000 lines with titles of about 85 characters or more) is refused by name, ESTIMATE_BATCH_RECEIPT_TOO_LARGE
--    (22023), instead of the generic ESTIMATE_BATCH_INVALID_INPUT; nothing is written, as before. The copies turn it
--    into their named 413 that points to the affaire import.
-- 7. Second Codex review of #59 (G2): public.commit_estimate_batch is granted to authenticated, so a member holding
--    the draft lease can call it with a forged p_created_ids. A provenance naming an import (import_id), a mapping
--    (mapping_id), a mapped row (mapped_row_id) or a source document (_timax_provenance.source_document_id or
--    sourceDocumentId) of another tenant than the target version is refused by name
--    (ESTIMATE_BATCH_SOURCE_METADATA_FOREIGN), nothing written. A reference found nowhere (deleted since) is kept;
--    another affaire of the same tenant is kept too, since a section copied from another affaire keeps its own
--    provenance. Accepted limitation: a member can still label lines with references of their own tenant.
-- 8. Internal review of #59: the parent walk of the replay stopped at the number of created items, enough for a new
--    version (every ancestor is in its payload) but not for a batch under stored ancestors: a direct call nested a
--    section or a line beyond max_section_depth. The walk is now bounded by greatest(item_count, max_section_depth),
--    which sees every ancestor up to max_section_depth + 1; the M6b creation keeps the same walk.
-- The functions are copied from their latest definition (20261017162000; the replay from 20261018013249) with only
-- these lines changed: no later migration redefines them (20261018170351, complete receipts on main, only adds
-- insert_estimate_template_with_receipt and insert_estimate_assembly_with_receipt; 20261018172935 only the client
-- contract 2 order). CREATE OR REPLACE keeps their owner and ACLs. No existing row is rewritten.
begin;

do $preflight$
begin
  if to_regprocedure('public.commit_estimate_batch(uuid,uuid,timestamptz,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)') is null
    or to_regprocedure('private.estimate_v3_assert_draft(uuid)') is null
    or to_regprocedure('private.canonical_estimate_batch_operations(jsonb)') is null
    or to_regprocedure('public.estimate_creation_replay_item_effects_for_writer(uuid,uuid[])') is null
    or to_regclass('public.affaire_intake_documents') is null or to_regclass('public.dpgf_mappings') is null
    or not exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'estimate_items' and column_name = 'source_metadata') then
    raise exception 'LOT2_2_8B_PREREQUISITE_MISSING';
  end if;
end;
$preflight$;

-- 5. Same output, built in an array: appending to a jsonb array copied it whole at each of 1 000 operations.
CREATE OR REPLACE FUNCTION private.canonical_estimate_batch_operations(operations jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare op jsonb; result jsonb[]:='{}'; data jsonb; pair record; key text; value jsonb; name text;
  common_keys text[]:=array['parent_id','position','title','aid'];
  line_keys text[]:=array['line_nature','description','quantity','unit_price_ht_cents','tax_rate_bp','k_fo','h_mo','h_mo_majoration','k_mo','h_mo_atelier','k_mo_atelier','labor_role_atelier_id','h_mo_chantier','k_mo_chantier','labor_role_chantier_id','labor_role_id','category_id','supply_type_id','product_id','selected_supplier_price_id','unit_code','pricing_status','h_mo_per_unit','h_mo_atelier_per_unit','h_mo_chantier_per_unit'];
  source_keys text[]:=array['source_provider','source_job_id','source_file_name','source_page'];
  money_keys text[]:=array['pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents'];
  allowed text[];
begin
  if jsonb_typeof(operations) is distinct from 'array' or jsonb_array_length(operations) not between 1 and 1000 or octet_length(operations::text)>1048576 then perform private.estimate_batch_error('INVALID_INPUT'); end if;
  for op in select * from jsonb_array_elements(operations) loop
    name:=op->>'op';
    if jsonb_typeof(op) is distinct from 'object' or name not in('create','update','delete','reorder') or name is null then perform private.estimate_batch_error('INVALID_INPUT'); end if;
    if op - (case name when 'create' then array['op','data'] when 'update' then array['op','id','data'] when 'delete' then array['op','id'] else array['op','data'] end) <> '{}'::jsonb then perform private.estimate_batch_error('INVALID_INPUT'); end if;
    if name in('update','delete') then
      if jsonb_typeof(op->'id') is distinct from 'string' then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      op:=jsonb_set(op,'{id}',to_jsonb((op->>'id')::uuid));
    end if;
    if name='delete' then result:=array_append(result,op); continue; end if;
    data:=op->'data';
    if jsonb_typeof(data) is distinct from 'object' then perform private.estimate_batch_error('INVALID_INPUT'); end if;
    if name='reorder' then
      if data-array['parent_id','ordered_ids']<>'{}'::jsonb or jsonb_typeof(data->'ordered_ids') is distinct from 'array' or jsonb_array_length(data->'ordered_ids')<1 then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      if exists(select 1 from jsonb_array_elements(data->'ordered_ids') x where jsonb_typeof(x)<>'string') then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      select jsonb_agg(to_jsonb((x.value#>>'{}')::uuid) order by x.ordinality) into value from jsonb_array_elements(data->'ordered_ids') with ordinality x;
      data:=jsonb_set(data,'{ordered_ids}',value);
      if data ? 'parent_id' and data->'parent_id'<>'null'::jsonb then data:=jsonb_set(data,'{parent_id}',to_jsonb((data->>'parent_id')::uuid)); end if;
      result:=array_append(result,jsonb_set(op,'{data}',data)); continue;
    end if;
    if name='create' then
      if data->>'item_type' not in('line','section') or data->>'item_type' is null then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      allowed:=common_keys||source_keys||array['item_type']||case when data->>'item_type'='line' then line_keys else '{}'::text[] end;
    else allowed:=common_keys||line_keys||money_keys; end if;
    if data-allowed<>'{}'::jsonb or data='{}'::jsonb then perform private.estimate_batch_error('INVALID_INPUT'); end if;
    for pair in select * from jsonb_each(data) loop
      key:=pair.key; value:=pair.value;
      if key in('parent_id','labor_role_id','labor_role_atelier_id','labor_role_chantier_id','category_id','supply_type_id','product_id','selected_supplier_price_id','source_job_id') then
        if value<>'null'::jsonb then
          if jsonb_typeof(value)<>'string' then perform private.estimate_batch_error('INVALID_INPUT'); end if;
          data:=jsonb_set(data,array[key],to_jsonb((data->>key)::uuid));
        end if;
      elsif key='unit_code' then
        if value<>'null'::jsonb and jsonb_typeof(value)<>'string' then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        data:=jsonb_set(data,array[key],coalesce(to_jsonb(nullif(btrim(data->>key),'')),'null'));
      elsif key='pricing_status' then
        if jsonb_typeof(value)<>'string' or data->>key not in('priced','included','for_memory','not_priced','out_of_scope','not_applicable') then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      elsif key in('title','aid','description','source_provider','source_file_name') then
        if value<>'null'::jsonb and jsonb_typeof(value)<>'string' or key='title' and (value='null'::jsonb or btrim(data->>key)='') then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        data:=jsonb_set(data,array[key],coalesce(to_jsonb(case when key='aid' then upper(nullif(btrim(data->>key),'')) when key='title' then btrim(data->>key) else nullif(btrim(data->>key),'') end),'null'));
      elsif key in('item_type','line_nature') then
        if jsonb_typeof(value)<>'string' or key='line_nature' and data->>key not in('supply_only','supply_and_labor','labor_only') then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      else
        if value='null'::jsonb and key in('h_mo_atelier','k_mo_atelier','h_mo_chantier','k_mo_chantier','source_page','h_mo_per_unit','h_mo_atelier_per_unit','h_mo_chantier_per_unit') then continue; end if;
        if jsonb_typeof(value)<>'number' or (data->>key)::numeric<0 then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        if key in('position','source_page','unit_price_ht_cents','tax_rate_bp') or key=any(money_keys) then
          if (data->>key)::numeric<>trunc((data->>key)::numeric) or (data->>key)::numeric>2147483647 then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        end if;
        if key in('position','source_page') and (data->>key)::numeric<1 or key='tax_rate_bp' and (data->>key)::numeric>10000 then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        if key in('h_mo_per_unit','h_mo_atelier_per_unit','h_mo_chantier_per_unit') and (min_scale((data->>key)::numeric)>4 or (data->>key)::numeric>99999999.9999) then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      end if;
    end loop;
    result:=array_append(result,jsonb_set(op,'{data}',data));
  end loop;
  return to_jsonb(result);
exception when invalid_text_representation or numeric_value_out_of_range then perform private.estimate_batch_error('INVALID_INPUT'); return null;
end $function$;

CREATE OR REPLACE FUNCTION public.commit_estimate_batch(p_version_id uuid, p_operation_key uuid, p_expected_updated_at timestamp with time zone, p_draft_lock_session_id uuid, p_operations jsonb, p_created_ids jsonb, p_item_updates jsonb, p_version_patch jsonb, p_calculation_context jsonb, p_expected_aid_policy jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ctx jsonb; actor uuid; target_tenant uuid; project_owner uuid;
  v public.estimate_versions%rowtype; lease public.draft_locks%rowtype; item public.estimate_items%rowtype; old_item public.estimate_items%rowtype;
  saved private.estimate_batch_receipts%rowtype; operations jsonb; canonical jsonb; raw_context jsonb; aid_policy jsonb;
  op jsonb; data jsonb; normalized jsonb; projected jsonb; results jsonb:='[]'; response jsonb; operation_index integer:=-1;
  item_id uuid; target_parent uuid; actual_ids uuid[]; supplied_ids uuid[]; affected_ids uuid[]:='{}'; deleted_ids uuid[]; role_ids uuid[];
  depth integer; parent_depth integer; hierarchy_invalid boolean; position_value integer; create_count integer; changed integer; event_time timestamptz;
  has_supply boolean; has_labor boolean; failure_code text; failure_message text; operation_stage boolean:=true;
  is_v3 boolean; previous_v3_writer text;
  created_by_index jsonb; projection_by_id jsonb; created_entry jsonb;
  result_list jsonb[]:='{}'; create_only boolean; previous_creation_contract text;
begin
  ctx:=private.estimate_batch_context(p_version_id,true);
  actor:=(ctx->>'actor_id')::uuid; target_tenant:=(ctx->>'tenant_id')::uuid; project_owner:=(ctx->>'user_id')::uuid;
  if p_operation_key is null then perform private.estimate_batch_error('OPERATION_KEY_REQUIRED'); end if;
  if p_expected_updated_at is null then perform private.estimate_batch_error('INVALID_INPUT'); end if;
  operations:=private.canonical_estimate_batch_operations(p_operations);
  canonical:=jsonb_build_object('versionId',p_version_id,'actorId',actor,'expectedUpdatedAt',p_expected_updated_at,'operations',operations);
  -- A matching request waits for the in-flight transaction and resolves its
  -- receipt before stale-token, lease, status or derived-context checks.
  select * into v from public.estimate_versions where id=p_version_id for update;
  perform 1 from public.estimate_projects where id=v.project_id for share nowait;
  ctx:=private.estimate_batch_context(p_version_id,true);
  actor:=(ctx->>'actor_id')::uuid; target_tenant:=(ctx->>'tenant_id')::uuid; project_owner:=(ctx->>'user_id')::uuid;
  if v.tenant_id is distinct from target_tenant or v.project_id is distinct from (ctx->>'project_id')::uuid then perform private.estimate_batch_error('STALE'); end if;
  select * into saved from private.estimate_batch_receipts where version_id=p_version_id and operation_key=p_operation_key;
  if found then
    if saved.actor_id<>actor or saved.tenant_id<>target_tenant or saved.project_id<>v.project_id or saved.canonical_request is distinct from canonical then perform private.estimate_batch_error('IDEMPOTENCY_CONFLICT'); end if;
    return saved.response||jsonb_build_object('replayed',true,'current_version',jsonb_build_object('id',v.id,'updated_at',v.updated_at,'status',v.status));
  end if;
  if v.status<>'draft' or (ctx->>'is_archived')::boolean then perform private.estimate_batch_error('FORBIDDEN'); end if;
  is_v3:=v.calc_engine_version=3;
  if v.updated_at is distinct from p_expected_updated_at then perform private.estimate_batch_error('STALE'); end if;
  select * into lease from public.draft_locks where version_id=p_version_id and tenant_id=target_tenant for update nowait;
  if not found or p_draft_lock_session_id is null or lease.user_id is distinct from actor or lease.session_id is distinct from p_draft_lock_session_id or lease.expires_at<=clock_timestamp() then perform private.estimate_batch_error('LOCK_REQUIRED'); end if;
  perform id from public.estimate_items where version_id=p_version_id order by id for update nowait;
  if jsonb_typeof(p_created_ids) is distinct from 'array' or jsonb_typeof(p_item_updates) is distinct from 'array' or jsonb_typeof(p_version_patch) is distinct from 'object' or jsonb_typeof(p_calculation_context) is distinct from 'object'
    or not(p_version_patch ?& array['total_ht_cents','total_tax_cents','total_ttc_cents']) or p_version_patch-array['total_ht_cents','total_tax_cents','total_ttc_cents','gross_ht_cents','discount_applied_cents','commercial_rounding_cents']<>'{}'::jsonb
    or (p_version_patch ?| array['gross_ht_cents','discount_applied_cents','commercial_rounding_cents']) is distinct from is_v3
    or is_v3 and not(p_version_patch ?& array['gross_ht_cents','discount_applied_cents','commercial_rounding_cents']) then perform private.estimate_batch_error('INVALID_INPUT'); end if;
  if exists(select 1 from jsonb_each(p_version_patch) x where jsonb_typeof(x.value)<>'number' or x.value::text !~ '^[0-9]+$' or x.value::text::numeric>2147483647) then perform private.estimate_batch_error('INVALID_INPUT'); end if;
  select count(*) into create_count from jsonb_array_elements(operations) x where x->>'op'='create';
  if jsonb_array_length(p_created_ids)<>create_count or exists(select 1 from jsonb_array_elements(p_created_ids) x where jsonb_typeof(x)<>'object' or not(x?&array['index','id']) or x-array['index','id','source_metadata']<>'{}'::jsonb or jsonb_typeof(x->'source_metadata')<>'object' or jsonb_typeof(x->'id')<>'string' or jsonb_typeof(x->'index')<>'number' or x->>'index'!~'^[0-9]+$') then perform private.estimate_batch_error('INVALID_INPUT'); end if;
  if exists(select 1 from jsonb_array_elements(p_created_ids) x where (x->>'index')::numeric>999 or operations->(x->>'index')::integer->>'op' is distinct from 'create')
    or (select count(distinct (x->>'id')::uuid) from jsonb_array_elements(p_created_ids) x)<>create_count
    or (select count(distinct (x->>'index')::integer) from jsonb_array_elements(p_created_ids) x)<>create_count
    or exists(select 1 from jsonb_array_elements(p_created_ids) x join public.estimate_items i on i.id=(x->>'id')::uuid) then perform private.estimate_batch_error('INVALID_INPUT'); end if;
  if exists(select 1 from jsonb_array_elements(p_item_updates) x where jsonb_typeof(x)<>'object' or not(x?&array['id','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents']) or x-array['id','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents']<>'{}'::jsonb or jsonb_typeof(x->'id')<>'string')
    or exists(select 1 from jsonb_array_elements(p_item_updates) x cross join lateral jsonb_each(x-'id') n where not(is_v3 and n.key='pu_ht_cents' and n.value='null'::jsonb) and (jsonb_typeof(n.value)<>'number' or n.value::text!~'^[0-9]+$' or n.value::text::numeric>2147483647)) then perform private.estimate_batch_error('PROJECTION_MISMATCH'); end if;
  select coalesce(array_agg((x->>'id')::uuid order by (x->>'id')::uuid),'{}') into supplied_ids from jsonb_array_elements(p_item_updates) x;
  if cardinality(supplied_ids)<>(select count(distinct x) from unnest(supplied_ids) x) then perform private.estimate_batch_error('PROJECTION_MISMATCH'); end if;
  -- 2.8b: one lookup per operation instead of a scan of both arrays (quadratic over a 1 000-operation copy).
  select coalesce(jsonb_object_agg(((x->>'index')::integer)::text,x),'{}') into created_by_index from jsonb_array_elements(p_created_ids) x;
  select coalesce(jsonb_object_agg(((x->>'id')::uuid)::text,x),'{}') into projection_by_id from jsonb_array_elements(p_item_updates) x;
  -- 7. (G2) No reference of another tenant in the provenance carried by p_created_ids.
  if exists(
    with refs as (
      select r.kind,lower(r.ref)::uuid as id from jsonb_array_elements(p_created_ids) x
      cross join lateral (values ('import',x->'source_metadata'->>'import_id'),('mapping',x->'source_metadata'->>'mapping_id'),
        ('row',x->'source_metadata'->>'mapped_row_id'),('document',x->'source_metadata'->'_timax_provenance'->>'source_document_id'),
        ('document',x->'source_metadata'->'_timax_provenance'->>'sourceDocumentId')) r(kind,ref)
      where jsonb_typeof(x->'source_metadata')='object' and r.ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    select 1 from refs join public.dpgf_imports t on refs.kind='import' and t.id=refs.id where t.tenant_id is distinct from target_tenant
    union all select 1 from refs join public.dpgf_mappings t on refs.kind='mapping' and t.id=refs.id where t.tenant_id is distinct from target_tenant
    union all select 1 from refs join public.dpgf_rows_mapped t on refs.kind='row' and t.id=refs.id where t.tenant_id is distinct from target_tenant
    union all select 1 from refs join public.affaire_intake_documents t on refs.kind='document' and t.id=refs.id where t.tenant_id is distinct from target_tenant)
  then perform private.estimate_batch_error('SOURCE_METADATA_FOREIGN'); end if;
  create_only:=not exists(select 1 from jsonb_array_elements(operations) x where x->>'op'<>'create');
  select jsonb_build_object('id',id,'enabled',enabled,'value',value) into aid_policy from public.feature_flags where tenant_id=target_tenant and flag_key='ESTIMATE_ITEM_AID_REGEX';
  if coalesce(aid_policy,'null'::jsonb) is distinct from coalesce(p_expected_aid_policy,'null'::jsonb) then perform private.estimate_batch_error('CONTEXT_CHANGED'); end if;

  -- Catch confirmed operation failure only around ALL writes. Subtransaction
  -- rollback restores cascades, technical revisions, audit, footer and receipt.
  begin
    previous_v3_writer:=coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer',true),'');
    if is_v3 then perform pg_catalog.set_config('miaouffrage.estimate_v3_writer',p_version_id::text,true); end if;
    -- 4. Creations only: the per-line effects of the inserts are replayed in one pass after the loop (M6b contract).
    if create_only then
      previous_creation_contract:=coalesce(pg_catalog.current_setting('miaouffrage.estimate_creation_atomic',true),'');
      perform pg_catalog.set_config('miaouffrage.estimate_creation_atomic',p_version_id::text,true);
    end if;
    for op in select * from jsonb_array_elements(operations) loop
      operation_index:=operation_index+1; data:=op->'data'; item_id:=null;
      if op->>'op'='create' then
        created_entry:=created_by_index->(operation_index::text); item_id:=(created_entry->>'id')::uuid;
        target_parent:=(data->>'parent_id')::uuid;
        -- 5. The sibling scan and the ancestor walk only feed the default position and title.
        position_value:=null;
        if not(data?'position') then select coalesce(max(position),0)+1 into position_value from public.estimate_items where version_id=p_version_id and parent_id is not distinct from target_parent; end if;
        depth:=1;
        if target_parent is not null and not(data?'title') then
          with recursive ancestors as(select id,parent_id,1 as d from public.estimate_items where id=target_parent and version_id=p_version_id union all select i.id,i.parent_id,a.d+1 from public.estimate_items i join ancestors a on i.id=a.parent_id where a.d<5) select coalesce(max(d),0)+1 into depth from ancestors;
        end if;
        normalized:=jsonb_build_object('id',item_id,'tenant_id',target_tenant,'version_id',p_version_id,'parent_id',target_parent,'position',coalesce((data->>'position')::integer,position_value),'title',coalesce(data->>'title',case when data->>'item_type'='line' then 'Nouvelle ligne' else 'Nouveau '||case depth when 1 then 'lot' when 2 then 'chapitre' when 3 then 'sous-chapitre' else 'ouvrage' end end),'source_provider',coalesce(data->>'source_provider','manual'))||data;
        -- Explicit null provider still means manual; do not inject this default
        -- into the canonical request retained in the receipt.
        normalized:=normalized||jsonb_build_object('source_provider',coalesce(data->>'source_provider','manual'));
        if data->>'item_type'='line' then
          projected:=projection_by_id->(item_id::text);
          -- A later parent deletion can remove this create before the final
          -- projection. Temporary zeros satisfy storage constraints only;
          -- the exact final-ID check still rejects every surviving omission.
          if projected is null then projected:='{"pu_ht_cents":0,"line_total_ht_cents":0,"line_tax_cents":0,"line_total_ttc_cents":0}'::jsonb; end if;
          normalized:=jsonb_build_object('quantity',1,'unit_price_ht_cents',0,'tax_rate_bp',v.tax_rate_bp,'k_fo',1,'h_mo',0,'h_mo_majoration',1,'k_mo',1)||normalized||(projected-'id');
        else normalized:=normalized||'{"h_mo_majoration":1,"k_mo_atelier":1,"k_mo_chantier":1}'; end if;
        select * into item from jsonb_populate_record(null::public.estimate_items,normalized);
      elsif op->>'op'='update' then
        item_id:=(op->>'id')::uuid;
        select * into old_item from public.estimate_items where id=item_id and version_id=p_version_id and tenant_id=target_tenant;
        if not found then perform private.estimate_batch_error('NOT_FOUND'); end if;
        if old_item.item_type='section' and data-array['parent_id','position','title','aid']<>'{}'::jsonb then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        select * into item from jsonb_populate_record(old_item,data-array['pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents']);
      elsif op->>'op'='delete' then
        item_id:=(op->>'id')::uuid;
        if not exists(select 1 from public.estimate_items where id=item_id and version_id=p_version_id and tenant_id=target_tenant) then perform private.estimate_batch_error('NOT_FOUND'); end if;
        with recursive closure as(select id from public.estimate_items where id=item_id and version_id=p_version_id union select i.id from public.estimate_items i join closure c on i.parent_id=c.id where i.version_id=p_version_id) select array_agg(id order by id) into deleted_ids from closure;
        delete from public.estimate_items where id=item_id and version_id=p_version_id;
        result_list:=array_append(result_list,jsonb_build_object('index',operation_index,'op','delete','status','ok','data',jsonb_build_object('deleted_id',item_id,'deleted_ids',deleted_ids)));
        continue;
      else
        target_parent:=(data->>'parent_id')::uuid;
        if target_parent is not null and not exists(select 1 from public.estimate_items where id=target_parent and version_id=p_version_id and tenant_id=target_tenant and item_type='section') then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        select coalesce(array_agg(id order by id),'{}') into actual_ids from public.estimate_items where version_id=p_version_id and tenant_id=target_tenant and parent_id is not distinct from target_parent;
        select array_agg((x#>>'{}')::uuid order by (x#>>'{}')::uuid) into deleted_ids from jsonb_array_elements(data->'ordered_ids') x;
        if actual_ids is distinct from deleted_ids then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        with ordered as(select (x.value#>>'{}')::uuid as id,x.ordinality::integer as pos from jsonb_array_elements(data->'ordered_ids') with ordinality x)
          update public.estimate_items i set position=-o.pos from ordered o where i.id=o.id and i.version_id=p_version_id;
        with ordered as(select (x.value#>>'{}')::uuid as id,x.ordinality::integer as pos from jsonb_array_elements(data->'ordered_ids') with ordinality x)
          update public.estimate_items i set position=o.pos from ordered o where i.id=o.id and i.version_id=p_version_id;
        get diagnostics changed=row_count;
        result_list:=array_append(result_list,jsonb_build_object('index',operation_index,'op','reorder','status','ok','data',jsonb_build_object('parent_id',target_parent,'ordered_ids',data->'ordered_ids','updated_count',changed)));
        continue;
      end if;

      if item.parent_id is not null and not exists(select 1 from public.estimate_items p where p.id=item.parent_id and p.version_id=p_version_id and p.tenant_id=target_tenant and p.item_type='section') then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      if op->>'op'='update' and item.item_type='section' and item.parent_id is distinct from old_item.parent_id then
        -- The generic BEFORE trigger validates the moved node, not its retained
        -- descendants. Validate both trees before UPDATE while all version items
        -- are locked. Paths and the version depth bound stop corrupt/cyclic
        -- inputs explicitly; no timeout is used as hierarchy validation.
        with recursive parents as (
          select p.id,p.parent_id,p.item_type,1 as d,array[p.id] as path,false as cycle
          from public.estimate_items p where p.id=item.parent_id and p.version_id=p_version_id and p.tenant_id=target_tenant
          union all
          select p.id,p.parent_id,p.item_type,a.d+1,a.path||p.id,p.id=any(a.path)
          from public.estimate_items p join parents a on p.id=a.parent_id
          where p.version_id=p_version_id and p.tenant_id=target_tenant and not a.cycle and a.d<=coalesce(v.max_section_depth,3)
        ) select coalesce(max(d),0),coalesce(bool_or(cycle or d>coalesce(v.max_section_depth,3) or item_type<>'section'),false)
          into parent_depth,hierarchy_invalid from parents;
        if hierarchy_invalid then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        with recursive subtree as (
          select p.id,p.item_type,0 as d,array[p.id] as path,false as cycle
          from public.estimate_items p where p.id=item.id and p.version_id=p_version_id and p.tenant_id=target_tenant
          union all
          select c.id,c.item_type,s.d+1,s.path||c.id,c.id=any(s.path)
          from public.estimate_items c join subtree s on c.parent_id=s.id
          where c.version_id=p_version_id and c.tenant_id=target_tenant and not s.cycle and s.d<=coalesce(v.max_section_depth,3)
        ) select coalesce(bool_or(cycle or id=item.parent_id
          or (item_type='section' and parent_depth+1+d>coalesce(v.max_section_depth,3))
          or (item_type='line' and parent_depth+d>coalesce(v.max_section_depth,3))),false)
          into hierarchy_invalid from subtree;
        if hierarchy_invalid then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      end if;
      if item.source_job_id is not null then
        perform 1 from public.takeoff_jobs j where j.id=item.source_job_id and j.tenant_id=target_tenant for share nowait;
        if not found then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        -- Version duplication retains the original source_job_id. UPDATE never
        -- accepts a new source ID. A new attachment needs the target job or an
        -- explicit, locked carry-over link, not just another job in the tenant.
        if op->>'op'='create' and not exists(select 1 from public.takeoff_jobs j where j.id=item.source_job_id and j.estimate_version_id=p_version_id) then
          perform 1 from public.takeoff_version_links l join public.takeoff_jobs j on j.id=l.takeoff_job_id and j.tenant_id=l.tenant_id and j.estimate_version_id=l.source_version_id
          where l.tenant_id=target_tenant and l.takeoff_job_id=item.source_job_id and l.target_version_id=p_version_id for share of l nowait;
          if not found then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        end if;
      end if;
      -- Rows behind retained references are stabilized too: a concurrent scope
      -- move cannot pass the validation and commit before this item transaction.
      if item.category_id is not null then perform 1 from public.estimate_categories c where c.id=item.category_id and c.tenant_id=target_tenant and c.user_id=project_owner for share nowait; if not found then perform private.estimate_batch_error('INVALID_INPUT'); end if; end if;
      if item.supply_type_id is not null then perform 1 from public.supply_types s where s.id=item.supply_type_id and s.tenant_id=target_tenant for share nowait; if not found then perform private.estimate_batch_error('INVALID_INPUT'); end if; end if;
      if item.product_id is not null then perform 1 from public.products p where p.id=item.product_id and p.tenant_id=target_tenant for share nowait; if not found then perform private.estimate_batch_error('INVALID_INPUT'); end if; end if;
      if item.selected_supplier_price_id is not null then perform 1 from public.supplier_pricebook s where s.id=item.selected_supplier_price_id and s.tenant_id=target_tenant for share nowait; if not found then perform private.estimate_batch_error('INVALID_INPUT'); end if; end if;
      if exists(select 1 from unnest(array[item.labor_role_id,item.labor_role_atelier_id,item.labor_role_chantier_id]) r(id) where r.id is not null and not exists(select 1 from public.labor_roles l where l.id=r.id and l.tenant_id=target_tenant and l.user_id=project_owner)) then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      if item.item_type='line' then
        has_supply:=coalesce(item.unit_price_ht_cents,0)>0 or item.supply_type_id is not null or item.selected_supplier_price_id is not null;
        has_labor:=coalesce(item.h_mo,0)>0 or coalesce(item.h_mo_atelier,0)>0 or coalesce(item.h_mo_chantier,0)>0 or item.labor_role_id is not null or item.labor_role_atelier_id is not null or item.labor_role_chantier_id is not null
          or coalesce(item.h_mo_per_unit,0)>0 or coalesce(item.h_mo_atelier_per_unit,0)>0 or coalesce(item.h_mo_chantier_per_unit,0)>0;
        if not(data?'line_nature') then
          if op->>'op'='create' then item.line_nature:=(case when has_labor and not has_supply then 'labor_only' when has_labor then 'supply_and_labor' else 'supply_only' end)::public.estimate_line_nature;
          elsif old_item.line_nature='supply_only' and data?|array['h_mo','h_mo_atelier','h_mo_chantier','labor_role_id','labor_role_atelier_id','labor_role_chantier_id','h_mo_per_unit','h_mo_atelier_per_unit','h_mo_chantier_per_unit'] and has_labor or old_item.line_nature='labor_only' and data?|array['unit_price_ht_cents','supply_type_id','selected_supplier_price_id'] and has_supply then item.line_nature:='supply_and_labor'; end if;
        end if;
        affected_ids:=array_append(affected_ids,item.id);
      end if;
      if op->>'op'='create' then
        insert into public.estimate_items(id,tenant_id,version_id,parent_id,item_type,position,title,description,aid,quantity,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,h_mo_majoration,k_mo,h_mo_atelier,k_mo_atelier,labor_role_atelier_id,h_mo_chantier,k_mo_chantier,labor_role_chantier_id,pu_ht_cents,labor_role_id,category_id,supply_type_id,product_id,selected_supplier_price_id,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,line_nature,source_provider,source_job_id,source_file_name,source_page,unit_code,pricing_status,h_mo_per_unit,h_mo_atelier_per_unit,h_mo_chantier_per_unit,source_metadata)
        values(item.id,item.tenant_id,item.version_id,item.parent_id,item.item_type,item.position,item.title,item.description,item.aid,item.quantity,item.unit_price_ht_cents,item.tax_rate_bp,item.k_fo,item.h_mo,item.h_mo_majoration,item.k_mo,item.h_mo_atelier,item.k_mo_atelier,item.labor_role_atelier_id,item.h_mo_chantier,item.k_mo_chantier,item.labor_role_chantier_id,item.pu_ht_cents,item.labor_role_id,item.category_id,item.supply_type_id,item.product_id,item.selected_supplier_price_id,item.line_total_ht_cents,item.line_tax_cents,item.line_total_ttc_cents,item.line_nature,item.source_provider,item.source_job_id,item.source_file_name,item.source_page,item.unit_code,coalesce(item.pricing_status,'priced'::public.estimate_line_pricing_status),item.h_mo_per_unit,item.h_mo_atelier_per_unit,item.h_mo_chantier_per_unit,coalesce(created_entry->'source_metadata','{}'::jsonb));
      else
        update public.estimate_items set parent_id=item.parent_id,position=item.position,title=item.title,description=item.description,aid=item.aid,quantity=item.quantity,unit_price_ht_cents=item.unit_price_ht_cents,tax_rate_bp=item.tax_rate_bp,k_fo=item.k_fo,h_mo=item.h_mo,h_mo_majoration=item.h_mo_majoration,k_mo=item.k_mo,h_mo_atelier=item.h_mo_atelier,k_mo_atelier=item.k_mo_atelier,labor_role_atelier_id=item.labor_role_atelier_id,h_mo_chantier=item.h_mo_chantier,k_mo_chantier=item.k_mo_chantier,labor_role_chantier_id=item.labor_role_chantier_id,labor_role_id=item.labor_role_id,category_id=item.category_id,supply_type_id=item.supply_type_id,product_id=item.product_id,selected_supplier_price_id=item.selected_supplier_price_id,line_nature=item.line_nature,unit_code=item.unit_code,pricing_status=item.pricing_status,h_mo_per_unit=item.h_mo_per_unit,h_mo_atelier_per_unit=item.h_mo_atelier_per_unit,h_mo_chantier_per_unit=item.h_mo_chantier_per_unit where id=item.id and version_id=p_version_id;
      end if;
      result_list:=array_append(result_list,jsonb_build_object('index',operation_index,'op',op->>'op','status','ok','data',jsonb_build_object('item_id',item.id)));
    end loop;
    results:=to_jsonb(result_list);
    operation_stage:=false;
    if create_only then
      perform public.estimate_creation_replay_item_effects_for_writer(p_version_id,
        array(select (x->>'id')::uuid from jsonb_array_elements(p_created_ids) x order by (x->>'index')::integer));
      perform pg_catalog.set_config('miaouffrage.estimate_creation_atomic',previous_creation_contract,true);
    end if;
    select coalesce(array_agg(id order by id),'{}') into actual_ids from public.estimate_items where version_id=p_version_id and item_type='line' and (private.calc_engine_freezes_snapshot(v.calc_engine_version) or id=any(affected_ids));
    if supplied_ids is distinct from actual_ids then perform private.estimate_batch_error('PROJECTION_MISMATCH'); end if;
    select coalesce(array_agg(distinct r.id order by r.id),'{}') into role_ids from public.estimate_items i cross join lateral unnest(array[i.labor_role_id,i.labor_role_atelier_id,i.labor_role_chantier_id]) r(id) where i.version_id=p_version_id and i.item_type='line' and r.id is not null;
    if private.calc_engine_freezes_snapshot(v.calc_engine_version) and exists(select 1 from unnest(role_ids) r(id) where not exists(select 1 from public.labor_roles l where l.id=r.id and l.tenant_id=target_tenant and l.user_id=project_owner)) then perform private.estimate_batch_error('CONTEXT_CHANGED'); end if;
    select jsonb_build_object('labor_roles',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'tenant_id',l.tenant_id,'user_id',l.user_id,'hourly_rate_cents',l.hourly_rate_cents) order by l.id) from public.labor_roles l where l.id=any(role_ids) and l.tenant_id=target_tenant and l.user_id=project_owner),'[]'),
      'margin_tiers',case when v.margin_mode='tiered' then coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'threshold_cents',m.threshold_cents,'multiplier',m.multiplier,'position',m.position) order by m.threshold_cents,m.position,m.id) from public.margin_tiers m where m.tenant_id=target_tenant),'[]') else '[]'::jsonb end,
      'labor_split_flag',(select jsonb_build_object('id',f.id,'enabled',f.enabled) from public.feature_flags f where f.tenant_id=target_tenant and f.flag_key='EST_031_LABOR_SPLIT')) into raw_context;
    if raw_context is distinct from p_calculation_context then perform private.estimate_batch_error('CONTEXT_CHANGED'); end if;
    select * into v from public.estimate_versions where id=p_version_id;
    -- 2.8b: a v3 rewrites only the lines whose projection differs from the stored amounts; every other line
    -- keeps them, and private.estimate_v3_assert_draft below still checks every line and the footer (D12).
    perform public.bulk_update_estimate_items(p_version_id,case when not is_v3 then p_item_updates else coalesce((
      select jsonb_agg(u.value order by u.ordinality) from jsonb_array_elements(p_item_updates) with ordinality u
      join public.estimate_items i on i.id=(u.value->>'id')::uuid and i.version_id=p_version_id
      where (i.pu_ht_cents,i.line_total_ht_cents,i.line_tax_cents,i.line_total_ttc_cents) is distinct from
        ((u.value->>'pu_ht_cents')::integer,(u.value->>'line_total_ht_cents')::integer,(u.value->>'line_tax_cents')::integer,(u.value->>'line_total_ttc_cents')::integer)),'[]'::jsonb) end,
      case when is_v3 then null else p_version_patch end,v.updated_at);
    if is_v3 then
      update public.estimate_versions set total_ht_cents=(p_version_patch->>'total_ht_cents')::integer,total_tax_cents=(p_version_patch->>'total_tax_cents')::integer,total_ttc_cents=(p_version_patch->>'total_ttc_cents')::integer,
        gross_ht_cents=(p_version_patch->>'gross_ht_cents')::integer,discount_applied_cents=(p_version_patch->>'discount_applied_cents')::integer,commercial_rounding_cents=(p_version_patch->>'commercial_rounding_cents')::integer
      where id=p_version_id and tenant_id=target_tenant;
      perform private.estimate_v3_assert_draft(p_version_id);
      perform pg_catalog.set_config('miaouffrage.estimate_v3_writer',previous_v3_writer,true);
    end if;
    select * into v from public.estimate_versions where id=p_version_id;
    select coalesce(jsonb_agg(case when x->>'op' in('create','update') then jsonb_set(x,'{data}',case when i.id is null then jsonb_build_object('item',null,'deleted_in_batch',true,'deleted_item_id',x->'data'->'item_id') else jsonb_build_object('item',case when created_by_index->(x->>'index') ? 'source_metadata' then to_jsonb(i)-'source_metadata' else to_jsonb(i) end) end) else x end order by (x->>'index')::integer),'[]') into results
    from jsonb_array_elements(results) x left join public.estimate_items i on i.id=(x->'data'->>'item_id')::uuid and i.version_id=p_version_id;
    perform public.log_estimate_batch_audit(p_version_id,operations);
    event_time:=clock_timestamp();
    response:=jsonb_build_object('committed',true,'results',results,'version',jsonb_build_object('id',v.id,'updated_at',v.updated_at),'totals',jsonb_build_object('total_ht_cents',v.total_ht_cents,'total_tax_cents',v.total_tax_cents,'total_ttc_cents',v.total_ttc_cents),
      'receipt',jsonb_build_object('operation_key',p_operation_key,'actor_id',actor,'version_id',p_version_id,'expected_updated_at',p_expected_updated_at,'operations',operations,'committed_at',event_time));
    -- 6. A receipt over 2 Mio is refused by name (nothing written), no longer as a generic invalid input.
    if octet_length(response::text)>2097152 then perform private.estimate_batch_error('RECEIPT_TOO_LARGE'); end if;
    insert into private.estimate_batch_receipts(version_id,operation_key,tenant_id,project_id,actor_id,canonical_request,response,committed_at) values(p_version_id,p_operation_key,target_tenant,v.project_id,actor,canonical,response,event_time);
    return response||jsonb_build_object('replayed',false,'current_version',jsonb_build_object('id',v.id,'updated_at',v.updated_at,'status',v.status));
  exception when others then
    get stacked diagnostics failure_code=returned_sqlstate,failure_message=message_text;
    results:=to_jsonb(result_list);
    if failure_message='ESTIMATE_V3_PROJECTION_MISMATCH' then failure_message:='ESTIMATE_BATCH_PROJECTION_MISMATCH'; end if;
    if failure_message not in('ESTIMATE_BATCH_INVALID_INPUT','ESTIMATE_BATCH_RECEIPT_TOO_LARGE','ESTIMATE_BATCH_NOT_FOUND','ESTIMATE_BATCH_PROJECTION_MISMATCH','ESTIMATE_BATCH_CONTEXT_CHANGED','ESTIMATE_BATCH_STALE','ESTIMATE_BATCH_FORBIDDEN','ESTIMATE_BATCH_LOCK_REQUIRED') then
      failure_message:=case when failure_code in('40001','40P01','55P03') then 'ESTIMATE_BATCH_STALE' else 'ESTIMATE_BATCH_INVALID_INPUT' end;
    end if;
    -- Context/projection/finalization failures have no invented operation index.
    if not operation_stage then raise exception using errcode=case when failure_message like '%CONTEXT_CHANGED' or failure_message like '%STALE' then '40001' else '22023' end,message=failure_message; end if;
    select coalesce(jsonb_agg(jsonb_build_object('index',x->'index','op',x->'op','status','ok','data',jsonb_build_object('rolled_back',true)) order by (x->>'index')::integer),'[]') into results from jsonb_array_elements(results) x;
    results:=results||jsonb_build_array(jsonb_build_object('index',operation_index,'op',op->>'op','status','error','code',failure_message,'message','Le lot a été annulé.'));
    return jsonb_build_object('committed',false,'results',results,'version',jsonb_build_object('id',p_version_id,'updated_at',p_expected_updated_at));
  end;
exception when lock_not_available or deadlock_detected then perform private.estimate_batch_error('STALE'); return null;
  when invalid_text_representation or numeric_value_out_of_range then perform private.estimate_batch_error('INVALID_INPUT'); return null;
end $function$;


-- 8. The M6b replay, copied from its latest definition (20261018013249) with only its parent walk bound changed.
CREATE OR REPLACE FUNCTION public.estimate_creation_replay_item_effects_for_writer(
  p_version_id uuid,
  p_item_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_count integer := coalesce(cardinality(p_item_ids), 0);
  target_max_depth integer;
  target_status public.estimate_status;
  depth_row record;
  version_before jsonb;
  version_after jsonb;
  base_revision bigint;
  previous_replay text;
  version_user_id uuid;
  item_user_id uuid;
  replayed_item_id uuid;
  identities uuid[];
  descendants uuid[];
  affected uuid[];
  affected_requirement_id uuid;
begin
  if p_version_id is null
    or coalesce(pg_catalog.current_setting('miaouffrage.estimate_creation_atomic', true), '') <> p_version_id::text
  then
    raise exception using errcode = '42501', message = 'ESTIMATE_CREATION_REPLAY_OUTSIDE_CONTRACT';
  end if;

  if item_count = 0 then
    perform pg_catalog.set_config('miaouffrage.estimate_creation_atomic', '', true);
    return;
  end if;

  if (select count(distinct replayed.id) from unnest(p_item_ids) as replayed(id)) <> item_count
    or (
      select count(*)
      from public.estimate_items item
      where item.id = any(p_item_ids)
        and item.version_id = p_version_id
    ) <> item_count
  then
    raise exception using errcode = '22023', message = 'ESTIMATE_CREATION_REPLAY_ITEMS_INVALID';
  end if;

  -- validate_estimate_item_hierarchy_depth, item by item in payload order. The creation payload puts
  -- every parent before its children, so the chain seen after the insert is the one each row saw.
  select coalesce(version.max_section_depth, 3)
    into target_max_depth
  from public.estimate_versions version
  where version.id = p_version_id;

  if target_max_depth is null then
    raise exception 'version_id invalide pour estimate_items';
  end if;

  for depth_row in
    with recursive replayed as (
      select item.id, item.parent_id, item.item_type, entry.ordinality
      from unnest(p_item_ids) with ordinality as entry(id, ordinality)
      join public.estimate_items item on item.id = entry.id
    ),
    parent_chain as (
      select replayed.id as origin_id, parent.id, parent.parent_id, parent.item_type, 1 as depth
      from replayed
      join public.estimate_items parent
        on parent.id = replayed.parent_id
       and parent.version_id = p_version_id
      union all
      select parent_chain.origin_id, parent.id, parent.parent_id, parent.item_type, parent_chain.depth + 1
      from parent_chain
      join public.estimate_items parent
        on parent.id = parent_chain.parent_id
       and parent.version_id = p_version_id
      -- 8. (review of #59) Bounded by the version depth too: a batch on an existing version creates items under
      -- stored ancestors, whose chain is longer than the items created.
      where parent_chain.depth <= greatest(item_count, target_max_depth)
    )
    select
      replayed.ordinality,
      replayed.parent_id,
      replayed.item_type,
      coalesce(max(parent_chain.depth), 0) as parent_depth,
      coalesce(bool_or(parent_chain.item_type <> 'section'), false) as parent_has_invalid_type
    from replayed
    left join parent_chain on parent_chain.origin_id = replayed.id
    group by replayed.ordinality, replayed.parent_id, replayed.item_type
    order by replayed.ordinality
  loop
    if depth_row.parent_id is not null then
      if depth_row.parent_depth = 0 then
        raise exception 'parent_id invalide pour estimate_items';
      end if;

      if depth_row.parent_has_invalid_type then
        raise exception 'Le parent doit etre une section.';
      end if;
    end if;

    if depth_row.item_type = 'section' then
      if depth_row.parent_depth + 1 > target_max_depth then
        raise exception 'Profondeur de section depassee (max %).', target_max_depth;
      end if;
    elsif depth_row.parent_id is null then
      raise exception 'Une ligne doit etre rattachee a une section.';
    elsif depth_row.parent_depth > target_max_depth then
      raise exception
        'Une ligne ne peut pas etre rattachee au-dela du niveau %.',
        target_max_depth;
    end if;
  end loop;

  -- bump_estimate_content_revision_from_item, once per item: the same checks, then one update.
  select version.status
    into target_status
  from public.estimate_versions version
  where version.id = p_version_id
  for update;

  if target_status is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_VERSION_NOT_FOUND';
  end if;

  if target_status <> 'draft'::public.estimate_status then
    raise exception using errcode = '42501', message = 'ESTIMATE_VERSION_READ_ONLY';
  end if;

  select to_jsonb(version.*)
    into version_before
  from public.estimate_versions version
  where version.id = p_version_id;
  base_revision := (version_before->>'content_revision')::bigint;

  previous_replay := coalesce(pg_catalog.current_setting('miaouffrage.estimate_creation_replay', true), '');
  perform pg_catalog.set_config('miaouffrage.estimate_creation_replay', p_version_id::text, true);
  update public.estimate_versions version
  set content_revision = version.content_revision + item_count
  where version.id = p_version_id;
  perform pg_catalog.set_config('miaouffrage.estimate_creation_replay', previous_replay, true);

  select to_jsonb(version.*)
    into version_after
  from public.estimate_versions version
  where version.id = p_version_id;

  -- log_estimate_audit for each revision step, then for the insert of the item, in the order the
  -- per-line triggers wrote them: the user of the request, else the owner of the project.
  version_user_id := coalesce(
    nullif(version_after->>'user_id', '')::uuid,
    nullif(version_before->>'user_id', '')::uuid,
    nullif(version_after->>'created_by', '')::uuid,
    nullif(version_before->>'created_by', '')::uuid
  );
  if version_user_id is null and nullif(version_after->>'project_id', '') is not null then
    select project.user_id
      into version_user_id
    from public.estimate_projects project
    where project.id = (version_after->>'project_id')::uuid;
  end if;

  select project.user_id
    into item_user_id
  from public.estimate_versions version
  join public.estimate_projects project on project.id = version.project_id
  where version.id = p_version_id;

  insert into public.audit_logs (
    tenant_id,
    user_id,
    table_name,
    record_id,
    estimate_version_id,
    action,
    before_data,
    after_data
  )
  select
    replay.tenant_id,
    replay.user_id,
    replay.table_name,
    replay.record_id,
    replay.estimate_version_id,
    replay.action,
    replay.before_data,
    replay.after_data
  from (
    select
      step.ordinality,
      1 as kind,
      coalesce(
        nullif(version_after->>'tenant_id', '')::uuid,
        nullif(version_before->>'tenant_id', '')::uuid,
        public.current_tenant_id()
      ) as tenant_id,
      coalesce((select auth.uid()), version_user_id) as user_id,
      'estimate_versions'::text as table_name,
      p_version_id as record_id,
      p_version_id as estimate_version_id,
      'UPDATE'::text as action,
      coalesce(
        pg_catalog.lag(step.after_data) over (order by step.ordinality),
        version_before
      ) as before_data,
      step.after_data
    from (
      select
        revision_step.ordinality,
        version_after || jsonb_build_object('content_revision', base_revision + revision_step.ordinality) as after_data
      from generate_series(1, item_count) as revision_step(ordinality)
    ) as step
    union all
    select
      entry.ordinality,
      2,
      coalesce(
        item.tenant_id,
        nullif(version_after->>'tenant_id', '')::uuid,
        public.current_tenant_id()
      ),
      coalesce(
        (select auth.uid()),
        nullif(item_row.value->>'user_id', '')::uuid,
        nullif(item_row.value->>'created_by', '')::uuid,
        item_user_id
      ),
      'estimate_items',
      item.id,
      item.version_id,
      'INSERT',
      null::jsonb,
      item_row.value
    from unnest(p_item_ids) with ordinality as entry(id, ordinality)
    join public.estimate_items item on item.id = entry.id
    cross join lateral (select to_jsonb(item.*) as value offset 0) as item_row
  ) as replay
  order by replay.ordinality, replay.kind;

  -- private.source_coverage_invalidate for each item insert: when a requirement is scoped to or linked
  -- with an item of this creation, the invalidation is replayed item by item as the trigger did. Every
  -- descendant of a new item is a new item: its parent is in the payload, checked above in this version.
  if exists (
      select 1
      from private.estimate_source_coverage_links link
      where link.item_id = any(p_item_ids)
    )
    or exists (
      select 1
      from private.estimate_source_coverage_requirements requirement
      join unnest(p_item_ids) as replayed(id)
        on (requirement.scope->>'dpgfLotId')::uuid = replayed.id
    )
  then
    foreach replayed_item_id in array p_item_ids loop
      identities := array[null::uuid, replayed_item_id];
      with recursive children as (
        select item.id
        from public.estimate_items item
        where item.id = any(identities)
        union
        select child.id
        from public.estimate_items child
        join children on child.parent_id = children.id
      )
      select array_agg(children.id) into descendants from children;
      identities := identities || coalesce(descendants, '{}');

      select array_agg(requirement.id order by requirement.id)
        into affected
      from private.estimate_source_coverage_requirements requirement
      where requirement.id in (
          select link.requirement_id
          from private.estimate_source_coverage_links link
          where link.item_id = any(identities)
        )
        or (requirement.scope->>'dpgfLotId')::uuid = any(identities);

      foreach affected_requirement_id in array coalesce(affected, '{}') loop
        update private.estimate_source_coverage_requirements requirement
        set technical_revision = private.source_coverage_next(requirement.technical_revision)
        where requirement.id = affected_requirement_id
          and exists (
            select 1
            from private.estimate_source_reviews review
            join public.estimate_versions version on version.id = review.version_id
            where review.id = requirement.review_id
          );
      end loop;
    end loop;
  end if;

  -- One replay per creation: a second call in the same transaction would bump and journal twice.
  perform pg_catalog.set_config('miaouffrage.estimate_creation_atomic', '', true);
end;
$$;

commit;
