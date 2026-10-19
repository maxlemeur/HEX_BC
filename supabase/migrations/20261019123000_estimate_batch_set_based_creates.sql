-- Lot 3.1 (copies at scale): the creations of a creations-only batch of public.commit_estimate_batch are written by one
-- INSERT. Contract, measurements and limits: docs/testing/lot3-1-v3-copy-scale.md and
-- docs/testing/large-estimate-statement-budget.md (L7).
--
-- Observed (pgTAP probe L7 in WSL, 1 000 creations with provenance into the 1 021-item v3; plpgsql_check profile and
-- pg_stat_xact_user_functions): the operation loop took 284 ms of 733 ms, 235 ms of it in its 1 000 single-row INSERTs
-- (one executor start and one set of BEFORE row triggers per statement), then the D12 check of every line (211 ms) and
-- the replay of the per-line effects (122 ms, mostly its audit rows).
--
-- 1. A batch of creations only that names the position and the title of every item and carries no takeoff source
--    (source_job_id) builds, for each operation, the record the loop builds (same normalization, defaults, v3
--    projection, line nature and source_metadata), runs the loop's checks over the whole batch (the parent of an item
--    is a section stored in the version or created earlier in the batch; categories, supply types, products and
--    supplier prices exist in the tenant and are locked FOR SHARE NOWAIT; labour roles exist for the affaire owner),
--    then inserts every row in batch order with one INSERT. The BEFORE row triggers, constraints and foreign keys run
--    on each row as before; the AFTER row effects stay with public.estimate_creation_replay_item_effects_for_writer,
--    unchanged. Results, affected lines, receipt, revisions and audit rows are the loop's.
-- 2. Any refusal or error of that block (a missing or later parent, a reference, a lock, a constraint, a trigger)
--    rolls it back and the operation loop runs as before: a refused batch reports the same operation, code and index.
-- 3. Other batches (an update, delete or reorder; a default position or title; a takeoff source) keep the loop.
-- The function is copied from its latest definition (20261018180306: no later migration redefines it;
-- 20261018204500 changes the per-row triggers it relies on only under the order contract of reorder and move) with
-- only the lines marked « Lot 3.1 » added. CREATE OR REPLACE keeps its signature, owner, grants, SECURITY DEFINER and
-- search_path. No existing row is rewritten.
begin;

do $preflight$
begin
  if to_regprocedure('public.commit_estimate_batch(uuid,uuid,timestamptz,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)') is null
    or to_regprocedure('public.estimate_creation_replay_item_effects_for_writer(uuid,uuid[])') is null
    or to_regprocedure('private.estimate_item_order_replay_effects(uuid,jsonb[],jsonb[])') is null
    or position('ESTIMATE_BATCH_RECEIPT_TOO_LARGE' in (select procedure.prosrc from pg_catalog.pg_proc procedure
      where procedure.oid = to_regprocedure('public.commit_estimate_batch(uuid,uuid,timestamptz,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'))) = 0 then
    raise exception 'LOT3_1_PREREQUISITE_MISSING';
  end if;
end;
$preflight$;

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
  -- Lot 3.1: set-based creates.
  set_based boolean; created_items public.estimate_items[]; created_sections jsonb; reference_ids uuid[]; written_count integer;
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
    -- Lot 3.1: a batch of creations only that names the position and the title of every item and carries no takeoff
    -- source (the server-side copies, a paste) is written by one INSERT instead of one per operation. Each row is the
    -- record the loop below builds (same normalization, defaults, projection, line nature and source_metadata); the
    -- loop's checks run over the whole batch first (a parent is a section stored in the version or created earlier in
    -- the batch; every reference exists in the tenant, the same rows locked FOR SHARE NOWAIT); the BEFORE row triggers,
    -- constraints and foreign keys run unchanged on each row. Any refusal or error rolls this block back and the loop
    -- runs instead: it reports the same operation, code and index as before.
    set_based:=create_only and not exists(select 1 from jsonb_array_elements(operations) x
      where not(x->'data' ?& array['position','title']) or x->'data'->>'source_job_id' is not null);
    if set_based then
      begin
        select coalesce(array_agg(r.item order by r.idx),'{}') into created_items
        from (
          select o.idx,jsonb_populate_record(null::public.estimate_items,case when o.data->>'item_type'='line'
            then jsonb_build_object('quantity',1,'unit_price_ht_cents',0,'tax_rate_bp',v.tax_rate_bp,'k_fo',1,'h_mo',0,'h_mo_majoration',1,'k_mo',1)||o.normalized
              ||(coalesce(projection_by_id->(o.item_id::text),'{"pu_ht_cents":0,"line_total_ht_cents":0,"line_tax_cents":0,"line_total_ttc_cents":0}'::jsonb)-'id')
            else o.normalized||'{"h_mo_majoration":1,"k_mo_atelier":1,"k_mo_chantier":1}'::jsonb end) as item
          from (
            select e.idx,e.data,e.item_id,
              (jsonb_build_object('id',e.item_id,'tenant_id',target_tenant,'version_id',p_version_id,'parent_id',(e.data->>'parent_id')::uuid,
                'position',(e.data->>'position')::integer,'title',e.data->>'title','source_provider',coalesce(e.data->>'source_provider','manual'))||e.data)
                ||jsonb_build_object('source_provider',coalesce(e.data->>'source_provider','manual')) as normalized
            from (
              select (x.ordinality-1)::integer as idx,x.value->'data' as data,(created_by_index->((x.ordinality-1)::text)->>'id')::uuid as item_id
              from jsonb_array_elements(operations) with ordinality x
            ) e
          ) o
        ) r;
        -- The parent of each item, as the loop sees it before its insert.
        select coalesce(jsonb_object_agg(c.id::text,c.ordinality),'{}') into created_sections
        from unnest(created_items) with ordinality c where c.item_type='section';
        if exists(select 1 from unnest(created_items) with ordinality c
          where c.parent_id is not null
            and coalesce((created_sections->>(c.parent_id::text))::bigint>=c.ordinality,true)
            and not exists(select 1 from public.estimate_items p where p.id=c.parent_id and p.version_id=p_version_id and p.tenant_id=target_tenant and p.item_type='section'))
        then raise exception using errcode='P0001',message='ESTIMATE_BATCH_SET_BASED_DECLINED'; end if;
        -- The references the loop checks and locks, each row once.
        select coalesce(array_agg(distinct c.category_id),'{}') into reference_ids from unnest(created_items) c where c.category_id is not null;
        if cardinality(reference_ids)>0 then
          perform 1 from public.estimate_categories c where c.id=any(reference_ids) and c.tenant_id=target_tenant and c.user_id=project_owner for share nowait;
          get diagnostics written_count=row_count;
          if written_count<>cardinality(reference_ids) then raise exception using errcode='P0001',message='ESTIMATE_BATCH_SET_BASED_DECLINED'; end if;
        end if;
        select coalesce(array_agg(distinct c.supply_type_id),'{}') into reference_ids from unnest(created_items) c where c.supply_type_id is not null;
        if cardinality(reference_ids)>0 then
          perform 1 from public.supply_types s where s.id=any(reference_ids) and s.tenant_id=target_tenant for share nowait;
          get diagnostics written_count=row_count;
          if written_count<>cardinality(reference_ids) then raise exception using errcode='P0001',message='ESTIMATE_BATCH_SET_BASED_DECLINED'; end if;
        end if;
        select coalesce(array_agg(distinct c.product_id),'{}') into reference_ids from unnest(created_items) c where c.product_id is not null;
        if cardinality(reference_ids)>0 then
          perform 1 from public.products p where p.id=any(reference_ids) and p.tenant_id=target_tenant for share nowait;
          get diagnostics written_count=row_count;
          if written_count<>cardinality(reference_ids) then raise exception using errcode='P0001',message='ESTIMATE_BATCH_SET_BASED_DECLINED'; end if;
        end if;
        select coalesce(array_agg(distinct c.selected_supplier_price_id),'{}') into reference_ids from unnest(created_items) c where c.selected_supplier_price_id is not null;
        if cardinality(reference_ids)>0 then
          perform 1 from public.supplier_pricebook s where s.id=any(reference_ids) and s.tenant_id=target_tenant for share nowait;
          get diagnostics written_count=row_count;
          if written_count<>cardinality(reference_ids) then raise exception using errcode='P0001',message='ESTIMATE_BATCH_SET_BASED_DECLINED'; end if;
        end if;
        if exists(select 1 from (select distinct r.id from unnest(created_items) c
            cross join lateral unnest(array[c.labor_role_id,c.labor_role_atelier_id,c.labor_role_chantier_id]) r(id) where r.id is not null) r
          where not exists(select 1 from public.labor_roles l where l.id=r.id and l.tenant_id=target_tenant and l.user_id=project_owner))
        then raise exception using errcode='P0001',message='ESTIMATE_BATCH_SET_BASED_DECLINED'; end if;
        -- The loop's insert, one row per operation in batch order; a line without line_nature gets the loop's.
        insert into public.estimate_items(id,tenant_id,version_id,parent_id,item_type,position,title,description,aid,quantity,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,h_mo_majoration,k_mo,h_mo_atelier,k_mo_atelier,labor_role_atelier_id,h_mo_chantier,k_mo_chantier,labor_role_chantier_id,pu_ht_cents,labor_role_id,category_id,supply_type_id,product_id,selected_supplier_price_id,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,line_nature,source_provider,source_job_id,source_file_name,source_page,unit_code,pricing_status,h_mo_per_unit,h_mo_atelier_per_unit,h_mo_chantier_per_unit,source_metadata)
        select i.id,i.tenant_id,i.version_id,i.parent_id,i.item_type,i.position,i.title,i.description,i.aid,i.quantity,i.unit_price_ht_cents,i.tax_rate_bp,i.k_fo,i.h_mo,i.h_mo_majoration,i.k_mo,i.h_mo_atelier,i.k_mo_atelier,i.labor_role_atelier_id,i.h_mo_chantier,i.k_mo_chantier,i.labor_role_chantier_id,i.pu_ht_cents,i.labor_role_id,i.category_id,i.supply_type_id,i.product_id,i.selected_supplier_price_id,i.line_total_ht_cents,i.line_tax_cents,i.line_total_ttc_cents,
          case when i.item_type='line' and not(operations->(i.ordinality-1)::integer->'data' ? 'line_nature') then
            (case when f.has_labor and not f.has_supply then 'labor_only' when f.has_labor then 'supply_and_labor' else 'supply_only' end)::public.estimate_line_nature
          else i.line_nature end,
          i.source_provider,i.source_job_id,i.source_file_name,i.source_page,i.unit_code,coalesce(i.pricing_status,'priced'::public.estimate_line_pricing_status),i.h_mo_per_unit,i.h_mo_atelier_per_unit,i.h_mo_chantier_per_unit,
          coalesce(created_by_index->((i.ordinality-1)::text)->'source_metadata','{}'::jsonb)
        from unnest(created_items) with ordinality i
        cross join lateral (select coalesce(i.unit_price_ht_cents,0)>0 or i.supply_type_id is not null or i.selected_supplier_price_id is not null as has_supply,
          coalesce(i.h_mo,0)>0 or coalesce(i.h_mo_atelier,0)>0 or coalesce(i.h_mo_chantier,0)>0 or i.labor_role_id is not null or i.labor_role_atelier_id is not null or i.labor_role_chantier_id is not null
            or coalesce(i.h_mo_per_unit,0)>0 or coalesce(i.h_mo_atelier_per_unit,0)>0 or coalesce(i.h_mo_chantier_per_unit,0)>0 as has_labor) f
        order by i.ordinality;
        get diagnostics written_count=row_count;
        if written_count<>jsonb_array_length(operations) then raise exception using errcode='P0001',message='ESTIMATE_BATCH_SET_BASED_DECLINED'; end if;
        select coalesce(array_agg(jsonb_build_object('index',c.ordinality-1,'op','create','status','ok','data',jsonb_build_object('item_id',c.id)) order by c.ordinality),'{}'),
          coalesce(array_agg(c.id order by c.ordinality) filter (where c.item_type='line'),'{}')
          into result_list,affected_ids
        from unnest(created_items) with ordinality c;
        operation_index:=written_count-1;
      exception when others then
        set_based:=false; operation_index:=-1; result_list:='{}'; affected_ids:='{}';
      end;
    end if;
    if not set_based then
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
    end if;
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

commit;
