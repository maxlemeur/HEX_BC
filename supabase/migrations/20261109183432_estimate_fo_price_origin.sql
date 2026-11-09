-- TI-534, remaining lot: price-origin transport snapshot and catalogue FO type.
-- Additive: no existing item or issued amount is rewritten; NULL preserves old seals.
-- A price selection gets its own token. An ordinary save preserves its snapshot;
-- a manual price edit or explicit reset clears it, even while product_id remains.
begin;

alter table public.estimate_items add column fo_price_origin jsonb;
alter table public.estimate_items add constraint estimate_items_fo_price_origin_check check (
  fo_price_origin is null or (
    jsonb_typeof(fo_price_origin) = 'object'
    and fo_price_origin ?& array['selection_id','kind','source_id','transport_mode']
    and fo_price_origin - array['selection_id','kind','source_id','transport_mode'] = '{}'::jsonb
    and fo_price_origin->>'kind' in ('supplier','reference')
    and fo_price_origin->>'selection_id' ~ '^[0-9a-fA-F-]{36}$'
    and fo_price_origin->>'source_id' ~ '^[0-9a-fA-F-]{36}$'
    and (fo_price_origin->'transport_mode' = 'null'::jsonb or fo_price_origin->>'transport_mode' in ('included','excluded'))
  )
);
comment on column public.estimate_items.fo_price_origin is
  'TI-534: selected price snapshot (selection_id, kind, source_id, transport_mode). NULL for historical/manual prices. Captured on explicit selection; never refreshed by a save or a catalogue edit.';
create index estimate_items_fo_price_selection_idx on public.estimate_items(tenant_id,(fo_price_origin->>'selection_id'))
  where fo_price_origin is not null;

-- Preserve an explicitly known absence of origin through record population. The
-- private marker exists only between the writer and BEFORE trigger; it is never stored.
create function public.estimate_fo_price_origin_write_input(value jsonb) returns jsonb
language sql immutable set search_path = '' as $input$
  select case when jsonb_typeof(value)='array' then
    (select coalesce(jsonb_agg(public.estimate_fo_price_origin_write_input(entry.value) order by entry.ordinality),'[]'::jsonb)
      from jsonb_array_elements(value) with ordinality entry)
  when jsonb_typeof(value)='object' and value ? 'fo_price_origin' and value->'fo_price_origin'='null'::jsonb
    then jsonb_set(value,'{fo_price_origin}','{}'::jsonb)
  else value end;
$input$;
revoke all on function public.estimate_fo_price_origin_write_input(jsonb) from public, anon, authenticated, service_role;
-- The existing invoker writers use authenticated (atomic line) or service_role
-- (version creation). This pure formatter grants neither role any data privileges.
grant execute on function public.estimate_fo_price_origin_write_input(jsonb) to authenticated, service_role;

create or replace function private.derive_estimate_item_fo_provision()
returns trigger language plpgsql security definer set search_path = '' as $fo$
declare
  engine smallint;
  tenant uuid;
  selected boolean := false;
  changed_origin boolean := false;
  source_product uuid;
  source_id uuid;
  source_kind text;
  transport text;
  product_type text;
  provision numeric;
  sensitive boolean;
  inferred_type uuid;
  exact_type_count integer;
  requested_selection uuid;
  preserve_absence boolean := false;
begin
  if tg_op='INSERT' and new.fo_price_origin='{}'::jsonb then
    preserve_absence := true;
    new.fo_price_origin := null;
  end if;
  if tg_op = 'UPDATE' and new.fo_provision is not null
    and new.fo_provision is not distinct from old.fo_provision
    and new.supply_type_id is not distinct from old.supply_type_id
    and new.product_id is not distinct from old.product_id
    and new.selected_supplier_price_id is not distinct from old.selected_supplier_price_id
    and new.unit_price_ht_cents is not distinct from old.unit_price_ht_cents
    and new.fo_price_origin is not distinct from old.fo_price_origin then return new; end if;

  select v.calc_engine_version,v.tenant_id into engine,tenant from public.estimate_versions v where v.id=new.version_id;
  if new.item_type is distinct from 'line'::public.estimate_item_type or engine is distinct from 3 then
    if new.fo_price_origin is not null or coalesce(new.fo_provision,1) <> 1 then
      raise exception using errcode='0A000',message='ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED';
    end if;
    new.fo_provision := 1;
    return new;
  end if;
  -- Version duplication supplies a provision and the saved origin verbatim.
  if tg_op='INSERT' and new.fo_provision is not null then return new; end if;

  if tg_op='INSERT' then
    selected := not preserve_absence and (new.selected_supplier_price_id is not null or new.product_id is not null);
  else
    changed_origin := new.fo_price_origin is distinct from old.fo_price_origin;
    selected := (new.selected_supplier_price_id is not null and new.selected_supplier_price_id is distinct from old.selected_supplier_price_id)
      or (new.product_id is not null and new.product_id is distinct from old.product_id)
      or (changed_origin and new.fo_price_origin is not null);
    if not selected and (new.unit_price_ht_cents is distinct from old.unit_price_ht_cents
      or new.selected_supplier_price_id is distinct from old.selected_supplier_price_id) then
      new.fo_price_origin := null;
    end if;
  end if;

  if tg_op='INSERT' and new.fo_price_origin is not null and exists (
    select 1 from public.estimate_items source where source.tenant_id=tenant
      and source.fo_price_origin->>'selection_id'=new.fo_price_origin->>'selection_id'
      and source.fo_price_origin=new.fo_price_origin
      and (new.selected_supplier_price_id is not null and new.fo_price_origin->>'kind'='supplier'
        and new.fo_price_origin->>'source_id'=new.selected_supplier_price_id::text
        or new.selected_supplier_price_id is null and (new.product_id is null
          or new.fo_price_origin->>'kind'='reference' and new.fo_price_origin->>'source_id'=new.product_id::text))
  ) then selected := false; end if;

  if selected then
    requested_selection := (new.fo_price_origin->>'selection_id')::uuid;
    if new.selected_supplier_price_id is not null then
      select s.product_id,s.transport_mode into source_product,transport from public.supplier_pricebook s
        where s.id=new.selected_supplier_price_id and s.tenant_id=tenant for share;
      if source_product is null or new.product_id is not null and new.product_id<>source_product then
        raise exception using errcode='22023',message='FO_PRICE_SOURCE_INVALID';
      end if;
      source_kind := 'supplier'; source_id := new.selected_supplier_price_id;
      select p.product_type into product_type from public.products p where p.id=source_product and p.tenant_id=tenant for share;
    else
      source_product := new.product_id; source_kind := 'reference'; source_id := new.product_id;
      select p.product_type,p.reference_transport_mode into product_type,transport from public.products p
        where p.id=source_product and p.tenant_id=tenant for share;
      if not found then raise exception using errcode='22023',message='FO_PRICE_SOURCE_INVALID'; end if;
    end if;
    new.fo_price_origin := jsonb_build_object('selection_id',coalesce(requested_selection,source_id),
      'kind',source_kind,'source_id',source_id,'transport_mode',transport);
    if new.supply_type_id is null or tg_op='UPDATE' and new.supply_type_id is not distinct from old.supply_type_id then
      -- Exact declared family first. Isolant falls back to Calorifuge when no exact tenant type exists.
      select count(*),case when count(*)=1 then min(s.id::text)::uuid else null end into exact_type_count,inferred_type
      from public.supply_types s where s.tenant_id=tenant and (
        regexp_replace(lower(btrim(s.code)),'s$','')=regexp_replace(lower(btrim(product_type)),'s$','')
        or regexp_replace(lower(btrim(s.name)),'s$','')=regexp_replace(lower(btrim(product_type)),'s$',''));
      if exact_type_count=0 and regexp_replace(lower(btrim(product_type)),'s$','')='isolant' then
        select case when count(*)=1 then min(s.id::text)::uuid else null end into inferred_type
          from public.supply_types s where s.tenant_id=tenant and (
            regexp_replace(lower(btrim(s.code)),'s$','')='calorifuge'
            or regexp_replace(lower(btrim(s.name)),'s$','')='calorifuge');
      end if;
      new.supply_type_id := inferred_type;
    end if;
  end if;

  if tg_op='INSERT' or selected or new.fo_price_origin is distinct from old.fo_price_origin
    or (new.supply_type_id is distinct from old.supply_type_id and new.fo_provision is not distinct from old.fo_provision)
    or new.fo_provision is null then
    select s.default_fo_provision,
      (lower(btrim(s.code)) in ('tube','tubes','calorifuge','calorifuges','isolant','isolants')
       or lower(btrim(s.name)) in ('tube','tubes','calorifuge','calorifuges','isolant','isolants'))
      into provision,sensitive from public.supply_types s where s.id=new.supply_type_id and s.tenant_id=tenant;
    new.fo_provision := case when sensitive and new.fo_price_origin->>'transport_mode'='included' then 1.010 else coalesce(provision,1.010) end;
  end if;
  return new;
end;
$fo$;
revoke all on function private.derive_estimate_item_fo_provision() from public, anon, authenticated, service_role;


-- Latest owning definition: 20261018180306_estimate_v3_batch_copy_effects.sql. Added only nullable origin transport.
CREATE OR REPLACE FUNCTION private.canonical_estimate_batch_operations(operations jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare op jsonb; result jsonb[]:='{}'; data jsonb; pair record; key text; value jsonb; name text;
  common_keys text[]:=array['parent_id','position','title','aid'];
  line_keys text[]:=array['line_nature','description','quantity','unit_price_ht_cents','tax_rate_bp','k_fo','h_mo','h_mo_majoration','k_mo','h_mo_atelier','k_mo_atelier','labor_role_atelier_id','h_mo_chantier','k_mo_chantier','labor_role_chantier_id','labor_role_id','category_id','supply_type_id','product_id','selected_supplier_price_id','fo_price_origin','unit_code','pricing_status','h_mo_per_unit','h_mo_atelier_per_unit','h_mo_chantier_per_unit'];
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
      elsif key='fo_price_origin' then
        if value<>'null'::jsonb and jsonb_typeof(value)<>'object' then perform private.estimate_batch_error('INVALID_INPUT'); end if;
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


-- Latest owning definition: 20261019123000_estimate_batch_set_based_creates.sql. Added only nullable origin transport.
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
          select o.idx,jsonb_populate_record(null::public.estimate_items,public.estimate_fo_price_origin_write_input(case when o.data->>'item_type'='line'
            then jsonb_build_object('quantity',1,'unit_price_ht_cents',0,'tax_rate_bp',v.tax_rate_bp,'k_fo',1,'h_mo',0,'h_mo_majoration',1,'k_mo',1)||o.normalized
              ||(coalesce(projection_by_id->(o.item_id::text),'{"pu_ht_cents":0,"line_total_ht_cents":0,"line_tax_cents":0,"line_total_ttc_cents":0}'::jsonb)-'id')
            else o.normalized||'{"h_mo_majoration":1,"k_mo_atelier":1,"k_mo_chantier":1}'::jsonb end)) as item
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
        insert into public.estimate_items(id,tenant_id,version_id,parent_id,item_type,position,title,description,aid,quantity,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,h_mo_majoration,k_mo,h_mo_atelier,k_mo_atelier,labor_role_atelier_id,h_mo_chantier,k_mo_chantier,labor_role_chantier_id,pu_ht_cents,labor_role_id,category_id,supply_type_id,product_id,selected_supplier_price_id,fo_price_origin,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,line_nature,source_provider,source_job_id,source_file_name,source_page,unit_code,pricing_status,h_mo_per_unit,h_mo_atelier_per_unit,h_mo_chantier_per_unit,source_metadata)
        select i.id,i.tenant_id,i.version_id,i.parent_id,i.item_type,i.position,i.title,i.description,i.aid,i.quantity,i.unit_price_ht_cents,i.tax_rate_bp,i.k_fo,i.h_mo,i.h_mo_majoration,i.k_mo,i.h_mo_atelier,i.k_mo_atelier,i.labor_role_atelier_id,i.h_mo_chantier,i.k_mo_chantier,i.labor_role_chantier_id,i.pu_ht_cents,i.labor_role_id,i.category_id,i.supply_type_id,i.product_id,i.selected_supplier_price_id,i.fo_price_origin,i.line_total_ht_cents,i.line_tax_cents,i.line_total_ttc_cents,
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
          select * into item from jsonb_populate_record(null::public.estimate_items,public.estimate_fo_price_origin_write_input(normalized));
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
          insert into public.estimate_items(id,tenant_id,version_id,parent_id,item_type,position,title,description,aid,quantity,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,h_mo_majoration,k_mo,h_mo_atelier,k_mo_atelier,labor_role_atelier_id,h_mo_chantier,k_mo_chantier,labor_role_chantier_id,pu_ht_cents,labor_role_id,category_id,supply_type_id,product_id,selected_supplier_price_id,fo_price_origin,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,line_nature,source_provider,source_job_id,source_file_name,source_page,unit_code,pricing_status,h_mo_per_unit,h_mo_atelier_per_unit,h_mo_chantier_per_unit,source_metadata)
          values(item.id,item.tenant_id,item.version_id,item.parent_id,item.item_type,item.position,item.title,item.description,item.aid,item.quantity,item.unit_price_ht_cents,item.tax_rate_bp,item.k_fo,item.h_mo,item.h_mo_majoration,item.k_mo,item.h_mo_atelier,item.k_mo_atelier,item.labor_role_atelier_id,item.h_mo_chantier,item.k_mo_chantier,item.labor_role_chantier_id,item.pu_ht_cents,item.labor_role_id,item.category_id,item.supply_type_id,item.product_id,item.selected_supplier_price_id,item.fo_price_origin,item.line_total_ht_cents,item.line_tax_cents,item.line_total_ttc_cents,item.line_nature,item.source_provider,item.source_job_id,item.source_file_name,item.source_page,item.unit_code,coalesce(item.pricing_status,'priced'::public.estimate_line_pricing_status),item.h_mo_per_unit,item.h_mo_atelier_per_unit,item.h_mo_chantier_per_unit,coalesce(created_entry->'source_metadata','{}'::jsonb));
        else
          update public.estimate_items set parent_id=item.parent_id,position=item.position,title=item.title,description=item.description,aid=item.aid,quantity=item.quantity,unit_price_ht_cents=item.unit_price_ht_cents,tax_rate_bp=item.tax_rate_bp,k_fo=item.k_fo,h_mo=item.h_mo,h_mo_majoration=item.h_mo_majoration,k_mo=item.k_mo,h_mo_atelier=item.h_mo_atelier,k_mo_atelier=item.k_mo_atelier,labor_role_atelier_id=item.labor_role_atelier_id,h_mo_chantier=item.h_mo_chantier,k_mo_chantier=item.k_mo_chantier,labor_role_chantier_id=item.labor_role_chantier_id,labor_role_id=item.labor_role_id,category_id=item.category_id,supply_type_id=item.supply_type_id,product_id=item.product_id,selected_supplier_price_id=item.selected_supplier_price_id,fo_price_origin=item.fo_price_origin,line_nature=item.line_nature,unit_code=item.unit_code,pricing_status=item.pricing_status,h_mo_per_unit=item.h_mo_per_unit,h_mo_atelier_per_unit=item.h_mo_atelier_per_unit,h_mo_chantier_per_unit=item.h_mo_chantier_per_unit where id=item.id and version_id=p_version_id;
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


-- Latest owning definition: 20261017162000_estimate_engine_v3_persistence.sql. Added only nullable origin transport.
CREATE OR REPLACE FUNCTION public.atomic_create_estimate_item(p_version_id uuid, p_item jsonb, p_item_updates jsonb, p_version_patch jsonb, p_expected_updated_at timestamp with time zone, p_draft_lock_session_id uuid, p_calculation_context jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  target_tenant uuid;
  actor_role public.tenant_role;
  version_row public.estimate_versions%rowtype;
  project_row public.estimate_projects%rowtype;
  lock_row public.draft_locks%rowtype;
  item_row public.estimate_items%rowtype;
  result_item public.estimate_items%rowtype;
  normalized_item jsonb;
  raw_context jsonb;
  role_ids uuid[];
  actual_ids uuid[];
  projected_ids uuid[];
  version_token timestamptz;
  effective_defaults jsonb;
  is_v3 boolean;
  previous_v3_writer text;
begin
  if actor_id is null then
    raise exception using errcode='42501',message='ESTIMATE_CREATE_FORBIDDEN';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock_shared(pg_catalog.hashtextextended('estimate-create-actor:'||actor_id::text,0)) then
    raise exception using errcode='40001',message='ESTIMATE_CREATE_CONTEXT_CHANGED';
  end if;
  target_tenant:=public.current_tenant_id();
  if target_tenant is null then
    raise exception using errcode='42501',message='ESTIMATE_CREATE_FORBIDDEN';
  end if;
  select membership.role into actor_role
  from public.tenant_memberships membership
  where membership.tenant_id=target_tenant and membership.user_id=actor_id;
  if actor_role is null or actor_role not in ('admin','engineer') then
    raise exception using errcode='42501',message='ESTIMATE_CREATE_FORBIDDEN';
  end if;
  if p_draft_lock_session_id is null then
    raise exception using errcode='55000',message='ESTIMATE_CREATE_LOCK_REQUIRED';
  end if;
  if p_version_id is null or p_expected_updated_at is null
    or jsonb_typeof(p_item) is distinct from 'object'
    or jsonb_typeof(p_item_updates) is distinct from 'array'
    or jsonb_typeof(p_version_patch) is distinct from 'object'
    or jsonb_typeof(p_calculation_context) is distinct from 'object'
    or not (p_item ?& array['id','item_type','position','title'])
    or p_item - array['id','parent_id','item_type','position','title','description','aid','quantity','unit_price_ht_cents','tax_rate_bp','k_fo','h_mo','h_mo_majoration','k_mo','h_mo_atelier','k_mo_atelier','labor_role_atelier_id','h_mo_chantier','k_mo_chantier','labor_role_chantier_id','pu_ht_cents','labor_role_id','category_id','supply_type_id','product_id','selected_supplier_price_id','fo_price_origin','line_total_ht_cents','line_tax_cents','line_total_ttc_cents','line_nature','source_provider','source_job_id','source_file_name','source_page','unit_code','pricing_status','h_mo_per_unit','h_mo_atelier_per_unit','h_mo_chantier_per_unit'] <> '{}'::jsonb
    or not (p_version_patch ?& array['total_ht_cents','total_tax_cents','total_ttc_cents'])
    or p_version_patch - array['total_ht_cents','total_tax_cents','total_ttc_cents','gross_ht_cents','discount_applied_cents','commercial_rounding_cents'] <> '{}'::jsonb
    or not (p_calculation_context ?& array['labor_roles','margin_tiers','labor_split_flag'])
    or p_calculation_context - array['labor_roles','margin_tiers','labor_split_flag'] <> '{}'::jsonb
    or jsonb_typeof(p_calculation_context->'labor_roles') is distinct from 'array'
    or jsonb_typeof(p_calculation_context->'margin_tiers') is distinct from 'array'
    or jsonb_typeof(p_calculation_context->'labor_split_flag') not in ('object','null')
  then
    raise exception using errcode='22023',message='ESTIMATE_CREATE_INVALID_INPUT';
  end if;
  if exists(select 1 from jsonb_each(p_version_patch) x where jsonb_typeof(x.value)<>'number' or x.value::text !~ '^[0-9]+$')
    or jsonb_typeof(p_item->'id') is distinct from 'string'
    or jsonb_typeof(p_item->'title') is distinct from 'string'
    or p_item->>'item_type' not in ('section','line')
    or jsonb_typeof(p_item->'position') is distinct from 'number'
    or p_item->>'position' !~ '^[0-9]+$'
  then raise exception using errcode='22023',message='ESTIMATE_CREATE_INVALID_INPUT'; end if;

  if not pg_catalog.pg_try_advisory_xact_lock_shared(pg_catalog.hashtextextended('estimate-calculation:'||target_tenant::text,0)) then
    raise exception using errcode='40001',message='ESTIMATE_CREATE_CONTEXT_CHANGED';
  end if;
  -- SELECT FOR UPDATE follows the invoker's UPDATE policies as well as RLS.
  select v.* into version_row from public.estimate_versions v
  where v.id=p_version_id and v.tenant_id=target_tenant for update nowait;
  if not found or version_row.status<>'draft' then
    raise exception using errcode='42501',message='ESTIMATE_CREATE_FORBIDDEN';
  end if;
  select p.* into project_row from public.estimate_projects p
  where p.id=version_row.project_id and p.tenant_id=target_tenant for share nowait;
  if not found or project_row.is_archived or (project_row.user_id<>actor_id and actor_role<>'admin') then
    raise exception using errcode='42501',message='ESTIMATE_CREATE_FORBIDDEN';
  end if;
  if version_row.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode='40001',message='ESTIMATE_CREATE_STALE';
  end if;
  is_v3:=version_row.calc_engine_version=3;
  if (p_version_patch ?| array['gross_ht_cents','discount_applied_cents','commercial_rounding_cents']) is distinct from is_v3
    or is_v3 and not (p_version_patch ?& array['gross_ht_cents','discount_applied_cents','commercial_rounding_cents']) then
    raise exception using errcode='22023',message='ESTIMATE_CREATE_INVALID_INPUT';
  end if;
  select l.* into lock_row from public.draft_locks l
  where l.version_id=p_version_id and l.tenant_id=target_tenant for update nowait;
  if not found or lock_row.user_id is distinct from actor_id or lock_row.session_id is distinct from p_draft_lock_session_id or lock_row.expires_at<=clock_timestamp() then
    raise exception using errcode='55000',message='ESTIMATE_CREATE_LOCK_REQUIRED';
  end if;
  -- Stabilize hierarchy and projected rows before insertion. A direct row writer
  -- may already wait on the version; NOWAIT converts that inversion to conflict.
  perform i.id from public.estimate_items i where i.version_id=p_version_id and i.tenant_id=target_tenant order by i.id for update nowait;
  effective_defaults:=case p_item->>'item_type'
    when 'line' then jsonb_build_object('quantity',1,'unit_price_ht_cents',0,'tax_rate_bp',version_row.tax_rate_bp,'k_fo',1,'h_mo',0,'h_mo_majoration',1,'k_mo',1,'k_mo_atelier',1,'k_mo_chantier',1,'pu_ht_cents',0,'line_total_ht_cents',0,'line_tax_cents',0,'line_total_ttc_cents',0)
    else '{"h_mo_majoration":1,"k_mo_atelier":1,"k_mo_chantier":1}'::jsonb end;
  normalized_item:=effective_defaults||p_item||jsonb_build_object('tenant_id',target_tenant,'version_id',p_version_id);
  -- jsonb_populate_record applies the real column typmods (12,3 and 12,4),
  -- preserving the existing numeric coercion rather than inventing new rounding.
  select * into item_row from jsonb_populate_record(null::public.estimate_items,public.estimate_fo_price_origin_write_input(normalized_item));
  if item_row.id is null or item_row.position is null or item_row.title is null then
    raise exception using errcode='22023',message='ESTIMATE_CREATE_INVALID_INPUT';
  end if;
  if item_row.parent_id is not null and not exists(select 1 from public.estimate_items p where p.id=item_row.parent_id and p.version_id=p_version_id and p.tenant_id=target_tenant and p.item_type='section') then
    raise exception using errcode='22023',message='ESTIMATE_CREATE_INVALID_INPUT';
  end if;
  if item_row.category_id is not null and not exists(select 1 from public.estimate_categories c where c.id=item_row.category_id and c.tenant_id=target_tenant and c.user_id=project_row.user_id)
    or item_row.supply_type_id is not null and not exists(select 1 from public.supply_types s where s.id=item_row.supply_type_id and s.tenant_id=target_tenant)
    or item_row.product_id is not null and not exists(select 1 from public.products p where p.id=item_row.product_id and p.tenant_id=target_tenant)
    or item_row.selected_supplier_price_id is not null and not exists(select 1 from public.supplier_pricebook s where s.id=item_row.selected_supplier_price_id and s.tenant_id=target_tenant)
  then raise exception using errcode='22023',message='ESTIMATE_CREATE_INVALID_INPUT'; end if;
  if exists(select 1 from unnest(array[item_row.labor_role_id,item_row.labor_role_atelier_id,item_row.labor_role_chantier_id]) r(id)
    where r.id is not null and not exists(select 1 from public.labor_roles l where l.id=r.id and l.tenant_id=target_tenant and l.user_id=project_row.user_id)) then
    raise exception using errcode='22023',message='ESTIMATE_CREATE_INVALID_INPUT';
  end if;

  previous_v3_writer:=coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer',true),'');
  if is_v3 then perform pg_catalog.set_config('miaouffrage.estimate_v3_writer',p_version_id::text,true); end if;
  insert into public.estimate_items(id,tenant_id,version_id,parent_id,item_type,position,title,description,aid,quantity,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,h_mo_majoration,k_mo,h_mo_atelier,k_mo_atelier,labor_role_atelier_id,h_mo_chantier,k_mo_chantier,labor_role_chantier_id,pu_ht_cents,labor_role_id,category_id,supply_type_id,product_id,selected_supplier_price_id,fo_price_origin,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,line_nature,source_provider,source_job_id,source_file_name,source_page,unit_code,pricing_status,h_mo_per_unit,h_mo_atelier_per_unit,h_mo_chantier_per_unit)
  values(item_row.id,target_tenant,p_version_id,item_row.parent_id,item_row.item_type,item_row.position,item_row.title,item_row.description,item_row.aid,item_row.quantity,item_row.unit_price_ht_cents,item_row.tax_rate_bp,item_row.k_fo,item_row.h_mo,item_row.h_mo_majoration,item_row.k_mo,item_row.h_mo_atelier,item_row.k_mo_atelier,item_row.labor_role_atelier_id,item_row.h_mo_chantier,item_row.k_mo_chantier,item_row.labor_role_chantier_id,item_row.pu_ht_cents,item_row.labor_role_id,item_row.category_id,item_row.supply_type_id,item_row.product_id,item_row.selected_supplier_price_id,item_row.fo_price_origin,item_row.line_total_ht_cents,item_row.line_tax_cents,item_row.line_total_ttc_cents,item_row.line_nature,item_row.source_provider,item_row.source_job_id,item_row.source_file_name,item_row.source_page,item_row.unit_code,coalesce(item_row.pricing_status,'priced'::public.estimate_line_pricing_status),item_row.h_mo_per_unit,item_row.h_mo_atelier_per_unit,item_row.h_mo_chantier_per_unit);

  select coalesce(array_agg(distinct role_id order by role_id),'{}'::uuid[]) into role_ids
  from public.estimate_items i cross join lateral unnest(array[i.labor_role_id,i.labor_role_atelier_id,i.labor_role_chantier_id]) r(role_id)
  where i.version_id=p_version_id and i.item_type='line' and role_id is not null;
  if version_row.calc_engine_version in (2, 3) and exists(select 1 from unnest(role_ids) r(id) where not exists(select 1 from public.labor_roles l where l.id=r.id and l.tenant_id=target_tenant and l.user_id=project_row.user_id)) then
    raise exception using errcode='40001',message='ESTIMATE_CREATE_CONTEXT_CHANGED';
  end if;
  select jsonb_build_object(
    'labor_roles',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'tenant_id',l.tenant_id,'user_id',l.user_id,'hourly_rate_cents',l.hourly_rate_cents) order by l.id) from public.labor_roles l where l.id=any(role_ids) and l.tenant_id=target_tenant and l.user_id=project_row.user_id),'[]'),
    'margin_tiers',case when version_row.margin_mode='tiered' then coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'threshold_cents',m.threshold_cents,'multiplier',m.multiplier,'position',m.position) order by m.threshold_cents,m.position,m.id) from public.margin_tiers m where m.tenant_id=target_tenant),'[]') else '[]'::jsonb end,
    'labor_split_flag',(select jsonb_build_object('id',f.id,'enabled',f.enabled) from public.feature_flags f where f.tenant_id=target_tenant and f.flag_key='EST_031_LABOR_SPLIT')) into raw_context;
  if raw_context is distinct from p_calculation_context then
    raise exception using errcode='40001',message='ESTIMATE_CREATE_CONTEXT_CHANGED';
  end if;
  if version_row.calc_engine_version=1 then
    if p_item_updates<>'[]'::jsonb then raise exception using errcode='22023',message='ESTIMATE_CREATE_PROJECTION_MISMATCH'; end if;
  else
    if exists(select 1 from jsonb_array_elements(p_item_updates) u where jsonb_typeof(u)<>'object'
      or not(u ?& array['id','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents'])
      or u-array['id','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents']<>'{}'::jsonb
      or jsonb_typeof(u->'id')<>'string') then
      raise exception using errcode='22023',message='ESTIMATE_CREATE_PROJECTION_MISMATCH';
    end if;
    if exists(select 1 from jsonb_array_elements(p_item_updates) u cross join lateral jsonb_each(u-'id') x where not (is_v3 and x.key='pu_ht_cents' and x.value='null'::jsonb) and (jsonb_typeof(x.value)<>'number' or x.value::text !~ '^-?[0-9]+$')) then
      raise exception using errcode='22023',message='ESTIMATE_CREATE_PROJECTION_MISMATCH';
    end if;
    select coalesce(array_agg((u->>'id')::uuid order by (u->>'id')::uuid),'{}'::uuid[]) into projected_ids from jsonb_array_elements(p_item_updates) u;
    select coalesce(array_agg(i.id order by i.id),'{}'::uuid[]) into actual_ids from public.estimate_items i where i.version_id=p_version_id and i.tenant_id=target_tenant and i.item_type='line';
    if projected_ids is distinct from actual_ids then
      raise exception using errcode='22023',message='ESTIMATE_CREATE_PROJECTION_MISMATCH';
    end if;
  end if;
  -- INSERT's content-revision trigger has advanced this token. The existing bulk
  -- implementation remains the sole projection writer, in this same transaction.
  select v.updated_at into version_token from public.estimate_versions v where v.id=p_version_id;
  perform public.bulk_update_estimate_items(p_version_id,p_item_updates,case when is_v3 then null else p_version_patch end,version_token);
  if is_v3 then
    update public.estimate_versions v set total_ht_cents=(p_version_patch->>'total_ht_cents')::integer,total_tax_cents=(p_version_patch->>'total_tax_cents')::integer,total_ttc_cents=(p_version_patch->>'total_ttc_cents')::integer,
      gross_ht_cents=(p_version_patch->>'gross_ht_cents')::integer,discount_applied_cents=(p_version_patch->>'discount_applied_cents')::integer,commercial_rounding_cents=(p_version_patch->>'commercial_rounding_cents')::integer
    where v.id=p_version_id and v.tenant_id=target_tenant;
    perform public.estimate_v3_assert_draft_for_writer(p_version_id);
    perform pg_catalog.set_config('miaouffrage.estimate_v3_writer',previous_v3_writer,true);
  end if;
  select i.* into result_item from public.estimate_items i where i.id=item_row.id and i.version_id=p_version_id;
  select v.* into version_row from public.estimate_versions v where v.id=p_version_id;
  return jsonb_build_object('item',to_jsonb(result_item),'version',jsonb_build_object('id',version_row.id,'updated_at',version_row.updated_at),'totals',jsonb_build_object('total_ht_cents',version_row.total_ht_cents,'total_tax_cents',version_row.total_tax_cents,'total_ttc_cents',version_row.total_ttc_cents));
exception when lock_not_available then
  raise exception using errcode='40001',message='ESTIMATE_CREATE_STALE';
end;
$function$
;


-- Latest owning definition: 20261018183629_estimate_engine_v3_default.sql. Added only nullable origin transport.
CREATE OR REPLACE FUNCTION public.persist_estimate_creation_atomic(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_project_id uuid,
  p_project_payload jsonb,
  p_version_payload jsonb,
  p_items jsonb,
  p_import_id uuid default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  actor_user_id uuid := p_actor_user_id;
  actor_role public.tenant_role;
  project_row public.estimate_projects%rowtype;
  version_row public.estimate_versions%rowtype;
  import_row public.dpgf_imports%rowtype;
  import_claimed_rows integer := 0;
  item_total_ht bigint := 0;
  item_total_tax bigint := 0;
  item_total_ttc bigint := 0;
  next_version_number integer;
  version_contractor_role text;
  previous_insert_contract text;
  policy_row public.tenant_calc_policies%rowtype;
  policy_engine smallint;
  creates_v3 boolean;
  previous_v3_writer text;
  previous_creation_contract text;
begin
  if current_user <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'SERVICE_ROLE_REQUIRED';
  end if;

  select membership.role
    into actor_role
  from public.tenant_memberships membership
  join public.tenants tenant
    on tenant.id = membership.tenant_id
   and tenant.is_active
  where membership.tenant_id = p_tenant_id
    and membership.user_id = actor_user_id;

  if actor_user_id is null
    or p_tenant_id is null
    or actor_role is null
    or actor_role not in (
      'admin'::public.tenant_role,
      'engineer'::public.tenant_role
    )
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_CREATION_ROLE_REQUIRED';
  end if;

  if p_version_payload is null
    or jsonb_typeof(p_version_payload) <> 'object'
    or p_version_payload - array[
      'id',
      'title',
      'date_devis',
      'validite_jours',
      'margin_multiplier',
      'margin_mode',
      'currency',
      'margin_bp',
      'discount_bp',
      'discount_amount_cents',
      'discount_mode',
      'discount_steps',
      'global_coefficient',
      'tax_rate_bp',
      'rounding_mode',
      'rounding_step_cents',
      'max_section_depth',
      'calc_engine_version',
      'contractor_role',
      'total_ht_cents',
      'total_tax_cents',
      'total_ttc_cents',
      'sale_coefficient_fo',
      'sale_coefficient_mo',
      'gross_ht_cents',
      'discount_applied_cents',
      'commercial_rounding_cents'
    ] <> '{}'::jsonb
    or coalesce(
      (p_version_payload->>'calc_engine_version')::smallint,
      2
    ) not in (1, 2, 3)
    or coalesce(
      nullif(btrim(p_version_payload->>'contractor_role'), ''),
      'principal'
    ) not in ('principal', 'subcontractor')
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_PAYLOAD_INVALID';
  end if;

  -- Lot 2, sub-lot 2.5 (D3): the engine is decided by the tenant policy, never by the
  -- client, which only states the engine its projections expect (absent = 2).
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('estimate-calc-policy:' || p_tenant_id::text, 0)
  );
  select policy.*
    into policy_row
  from public.tenant_calc_policies policy
  where policy.tenant_id = p_tenant_id
  for share;
  policy_engine := coalesce(policy_row.new_estimate_calc_engine, 3);
  if coalesce((p_version_payload->>'calc_engine_version')::smallint, 2) <> policy_engine then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_CALC_POLICY_CONTEXT_CHANGED';
  end if;
  creates_v3 := policy_engine = 3;

  if not creates_v3
    and exists (
      select 1
      from jsonb_each(p_version_payload) entry
      where entry.key in (
          'sale_coefficient_fo', 'sale_coefficient_mo', 'gross_ht_cents',
          'discount_applied_cents', 'commercial_rounding_cents'
        )
        and entry.value <> 'null'::jsonb
    )
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_PAYLOAD_INVALID';
  end if;

  if creates_v3 and (
      exists (
        select 1
        from jsonb_each(p_version_payload) entry
        where entry.key in ('sale_coefficient_fo', 'sale_coefficient_mo')
          and entry.value <> 'null'::jsonb
          and (
            jsonb_typeof(entry.value) <> 'number'
            or entry.value::text::numeric <= 0
            or entry.value::text::numeric > 10
            or pg_catalog.min_scale(entry.value::text::numeric) > 4
          )
      )
      or exists (
        select 1
        from unnest(array['gross_ht_cents', 'discount_applied_cents', 'commercial_rounding_cents']) as required(key)
        where jsonb_typeof(p_version_payload->required.key) is distinct from 'number'
          or p_version_payload->>required.key !~ '^[0-9]+$'
          or (p_version_payload->>required.key)::numeric > 2147483647
      )
    )
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_PAYLOAD_INVALID';
  end if;

  if p_version_payload ? 'discount_amount_cents'
    and p_version_payload->'discount_amount_cents' <> 'null'::jsonb then
    if jsonb_typeof(p_version_payload->'discount_amount_cents') <> 'number'
      or p_version_payload->>'discount_amount_cents' !~ '^[0-9]+$' then
      raise exception using errcode='22023',message='ESTIMATE_VERSION_PAYLOAD_INVALID';
    end if;
    if (p_version_payload->>'discount_amount_cents')::numeric > 2147483647
      or p_version_payload->>'discount_mode' is distinct from 'simple'
      or coalesce(jsonb_array_length(p_version_payload->'discount_steps'),0) <> 0 then
      raise exception using errcode='22023',message='ESTIMATE_VERSION_PAYLOAD_INVALID';
    end if;
  end if;

  version_contractor_role := coalesce(
    nullif(btrim(p_version_payload->>'contractor_role'), ''),
    'principal'
  )::text;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_ITEMS_PAYLOAD_INVALID';
  end if;

  -- The hierarchy check (replayed after the insert since M6b) and the coverage
  -- replay rely on the accepted payload order, made explicit before any
  -- project/import mutation: every child must follow its section parent in the
  -- payload and every payload id must be unique and concrete.
  if exists (
    with payload_item as (
      select
        entry.ordinality,
        (entry.value->>'id')::uuid as id,
        (entry.value->>'parent_id')::uuid as parent_id,
        entry.value->>'item_type' as item_type
      from jsonb_array_elements(p_items) with ordinality
        as entry(value, ordinality)
    )
    select 1
    from payload_item as child
    left join payload_item as parent on parent.id = child.parent_id
    where child.id is null
      or child.item_type is null
      or child.item_type not in ('section', 'line')
      or (child.item_type = 'line' and child.parent_id is null)
      or (
        child.parent_id is not null
        and (
          parent.id is null
          or parent.item_type <> 'section'
          or parent.ordinality >= child.ordinality
        )
      )
    union all
    select 1
    from payload_item
    group by payload_item.id
    having count(*) > 1
  ) then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_ITEMS_HIERARCHY_INVALID';
  end if;

  if p_import_id is not null then
    select source_import.*
      into import_row
    from public.dpgf_imports as source_import
    where source_import.id = p_import_id
      and source_import.tenant_id = p_tenant_id
      and (
        source_import.user_id = actor_user_id
        or actor_role = 'admin'::public.tenant_role
      )
    for update;

    if import_row.id is null then
      raise exception using
        errcode = '42501',
        message = 'DPGF_IMPORT_NOT_WRITABLE';
    end if;

    if import_row.project_id is not null
      and (
        p_project_id is null
        or import_row.project_id <> p_project_id
      )
    then
      raise exception using
        errcode = '23505',
        message = 'DPGF_IMPORT_ALREADY_LINKED';
    end if;
  end if;

  if (p_version_payload->>'total_ht_cents') is null
    or (p_version_payload->>'total_tax_cents') is null
    or (p_version_payload->>'total_ttc_cents') is null
    or (p_version_payload->>'total_ht_cents')::integer < 0
    or (p_version_payload->>'total_tax_cents')::integer < 0
    or (p_version_payload->>'total_ttc_cents')::integer < 0
    or (p_version_payload->>'total_ttc_cents')::integer <>
      (p_version_payload->>'total_ht_cents')::integer
      + (p_version_payload->>'total_tax_cents')::integer
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_TOTALS_INVALID';
  end if;

  if version_contractor_role = 'subcontractor'
    and (
      (p_version_payload->>'total_tax_cents')::integer <> 0
      or (p_version_payload->>'total_ttc_cents')::integer <>
        (p_version_payload->>'total_ht_cents')::integer
    )
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_REVERSE_CHARGE_TOTALS_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(public.estimate_fo_price_origin_write_input(p_items)) as item(
      item_type public.estimate_item_type,
      line_total_ht_cents integer,
      line_tax_cents integer,
      line_total_ttc_cents integer
    )
    where item.item_type = 'line'
      and (
        item.line_total_ht_cents is null
        or item.line_tax_cents is null
        or item.line_total_ttc_cents is null
        or item.line_total_ht_cents < 0
        or item.line_tax_cents < 0
        or item.line_total_ttc_cents < 0
        or item.line_total_ttc_cents <>
          item.line_total_ht_cents + item.line_tax_cents
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_ITEM_TOTALS_INVALID';
  end if;

  select
    coalesce(sum(item.line_total_ht_cents), 0),
    coalesce(sum(item.line_tax_cents), 0),
    coalesce(sum(item.line_total_ttc_cents), 0)
    into item_total_ht, item_total_tax, item_total_ttc
  from jsonb_to_recordset(public.estimate_fo_price_origin_write_input(p_items)) as item(
    item_type public.estimate_item_type,
    line_total_ht_cents integer,
    line_tax_cents integer,
    line_total_ttc_cents integer
  )
  where item.item_type = 'line'::public.estimate_item_type;

  if item_total_ht <> (p_version_payload->>'total_ht_cents')::integer
    or item_total_tax <> (p_version_payload->>'total_tax_cents')::integer
    or item_total_ttc <> (p_version_payload->>'total_ttc_cents')::integer
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_TOTALS_DO_NOT_MATCH_ITEMS';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(public.estimate_fo_price_origin_write_input(p_items)) as item(
      category_id uuid,
      supply_type_id uuid,
      selected_supplier_price_id uuid,
      fo_price_origin jsonb,
      source_job_id uuid
    )
    left join public.estimate_categories category
      on category.id = item.category_id
     and category.tenant_id = p_tenant_id
    left join public.supply_types supply_type
      on supply_type.id = item.supply_type_id
     and supply_type.tenant_id = p_tenant_id
    left join public.supplier_pricebook supplier_price
      on supplier_price.id = item.selected_supplier_price_id
     and supplier_price.tenant_id = p_tenant_id
    left join public.takeoff_jobs source_job
      on source_job.id = item.source_job_id
     and source_job.tenant_id = p_tenant_id
    where (item.category_id is not null and category.id is null)
      or (item.supply_type_id is not null and supply_type.id is null)
      or (
        item.selected_supplier_price_id is not null
        and supplier_price.id is null
      )
      or (item.source_job_id is not null and source_job.id is null)
  ) then
    raise exception using
      errcode = '23503',
      message = 'ESTIMATE_ITEM_REFERENCE_TENANT_MISMATCH';
  end if;

  if p_project_id is null then
    if p_project_payload is null
      or jsonb_typeof(p_project_payload) <> 'object'
      or p_project_payload - array[
        'id',
        'name',
        'reference',
        'client_name',
        'notes'
      ] <> '{}'::jsonb
      or btrim(coalesce(p_project_payload->>'name', '')) = ''
    then
      raise exception using
        errcode = '22023',
        message = 'ESTIMATE_PROJECT_PAYLOAD_INVALID';
    end if;

    insert into public.estimate_projects (
      id,
      tenant_id,
      user_id,
      name,
      reference,
      client_name,
      notes,
      is_archived
    )
    values (
      (p_project_payload->>'id')::uuid,
      p_tenant_id,
      actor_user_id,
      btrim(p_project_payload->>'name'),
      nullif(btrim(p_project_payload->>'reference'), ''),
      nullif(btrim(p_project_payload->>'client_name'), ''),
      nullif(btrim(p_project_payload->>'notes'), ''),
      false
    )
    returning * into project_row;

    next_version_number := 1;
  else
    if p_project_payload is not null then
      raise exception using
        errcode = '22023',
        message = 'ESTIMATE_PROJECT_SELECTOR_INVALID';
    end if;

    select project.*
      into project_row
    from public.estimate_projects as project
    where project.id = p_project_id
      and project.tenant_id = p_tenant_id
    for update;

    if project_row.id is null
      or project_row.is_archived
      or (
        project_row.user_id <> actor_user_id
        and actor_role <> 'admin'::public.tenant_role
      )
    then
      raise exception using
        errcode = '42501',
        message = 'ESTIMATE_PROJECT_NOT_WRITABLE';
    end if;

    select coalesce(max(version.version_number), 0) + 1
      into next_version_number
    from public.estimate_versions as version
    where version.project_id = project_row.id
      and version.tenant_id = p_tenant_id;
  end if;

  perform role.id
  from public.labor_roles role
  where role.id in (
    select referenced.role_id
    from (
      select item.labor_role_id as role_id
      from jsonb_to_recordset(public.estimate_fo_price_origin_write_input(p_items)) as item(labor_role_id uuid)
      union
      select item.labor_role_atelier_id
      from jsonb_to_recordset(public.estimate_fo_price_origin_write_input(p_items)) as item(labor_role_atelier_id uuid)
      union
      select item.labor_role_chantier_id
      from jsonb_to_recordset(public.estimate_fo_price_origin_write_input(p_items)) as item(labor_role_chantier_id uuid)
    ) referenced
    where referenced.role_id is not null
  )
  order by role.id
  for share of role;

  if exists (
    select 1
    from jsonb_to_recordset(public.estimate_fo_price_origin_write_input(p_items)) as item(
      labor_role_id uuid,
      labor_role_atelier_id uuid,
      labor_role_chantier_id uuid
    )
    left join public.labor_roles labor_role
      on labor_role.id = item.labor_role_id
     and labor_role.tenant_id = p_tenant_id
     and labor_role.user_id = project_row.user_id
    left join public.labor_roles atelier_role
      on atelier_role.id = item.labor_role_atelier_id
     and atelier_role.tenant_id = p_tenant_id
     and atelier_role.user_id = project_row.user_id
    left join public.labor_roles chantier_role
      on chantier_role.id = item.labor_role_chantier_id
     and chantier_role.tenant_id = p_tenant_id
     and chantier_role.user_id = project_row.user_id
    where (item.labor_role_id is not null and labor_role.id is null)
      or (item.labor_role_atelier_id is not null and atelier_role.id is null)
      or (item.labor_role_chantier_id is not null and chantier_role.id is null)
  ) then
    raise exception using
      errcode = '23503',
      message = 'ESTIMATE_LABOR_ROLE_OWNER_MISMATCH';
  end if;

  if import_row.id is not null and import_row.project_id is null then
    update public.dpgf_imports as source_import
    set project_id = project_row.id
    where source_import.id = import_row.id
      and source_import.tenant_id = p_tenant_id
      and source_import.project_id is null;

    get diagnostics import_claimed_rows = row_count;
    if import_claimed_rows <> 1 then
      raise exception using
        errcode = '23505',
        message = 'DPGF_IMPORT_ALREADY_LINKED';
    end if;
  end if;

  previous_insert_contract := coalesce(
    pg_catalog.current_setting(
      'miaouffrage.estimate_version_insert_contract',
      true
    ),
    ''
  );
  perform pg_catalog.set_config(
    'miaouffrage.estimate_version_insert_contract',
    case when creates_v3 then 'canonical_v3' else 'canonical_v2' end,
    true
  );

  insert into public.estimate_versions (
    id,
    tenant_id,
    project_id,
    version_number,
    status,
    title,
    date_devis,
    validite_jours,
    margin_multiplier,
    margin_mode,
    currency,
    margin_bp,
    discount_bp,
    discount_amount_cents,
    discount_mode,
    discount_steps,
    global_coefficient,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    max_section_depth,
    calc_engine_version,
    contractor_role,
    total_ht_cents,
    total_tax_cents,
    total_ttc_cents,
    sale_coefficient_fo,
    sale_coefficient_mo,
    gross_ht_cents,
    discount_applied_cents,
    commercial_rounding_cents
  )
  values (
    (p_version_payload->>'id')::uuid,
    p_tenant_id,
    project_row.id,
    next_version_number,
    'draft'::public.estimate_status,
    nullif(btrim(p_version_payload->>'title'), ''),
    (p_version_payload->>'date_devis')::date,
    (p_version_payload->>'validite_jours')::integer,
    (p_version_payload->>'margin_multiplier')::numeric,
    (p_version_payload->>'margin_mode')::public.estimate_margin_mode,
    p_version_payload->>'currency',
    (p_version_payload->>'margin_bp')::integer,
    (p_version_payload->>'discount_bp')::integer,
    (p_version_payload->>'discount_amount_cents')::integer,
    (p_version_payload->>'discount_mode')::public.estimate_discount_mode,
    array(
      select discount_step.value::integer
      from jsonb_array_elements_text(p_version_payload->'discount_steps')
        as discount_step(value)
    ),
    (p_version_payload->>'global_coefficient')::numeric,
    (p_version_payload->>'tax_rate_bp')::integer,
    (p_version_payload->>'rounding_mode')::public.estimate_rounding_mode,
    (p_version_payload->>'rounding_step_cents')::integer,
    (p_version_payload->>'max_section_depth')::integer,
    policy_engine,
    version_contractor_role::text,
    (p_version_payload->>'total_ht_cents')::integer,
    (p_version_payload->>'total_tax_cents')::integer,
    (p_version_payload->>'total_ttc_cents')::integer,
    case when creates_v3 then coalesce(
      (p_version_payload->>'sale_coefficient_fo')::numeric,
      policy_row.default_sale_coefficient_fo,
      1.3000
    ) end,
    case when creates_v3 then coalesce(
      (p_version_payload->>'sale_coefficient_mo')::numeric,
      policy_row.default_sale_coefficient_mo,
      1.2000
    ) end,
    case when creates_v3 then (p_version_payload->>'gross_ht_cents')::integer end,
    case when creates_v3 then (p_version_payload->>'discount_applied_cents')::integer end,
    case when creates_v3 then (p_version_payload->>'commercial_rounding_cents')::integer end
  )
  returning * into version_row;

  perform pg_catalog.set_config(
    'miaouffrage.estimate_version_insert_contract',
    previous_insert_contract,
    true
  );

  previous_v3_writer := coalesce(
    pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true),
    ''
  );
  if creates_v3 then
    perform pg_catalog.set_config(
      'miaouffrage.estimate_v3_writer',
      version_row.id::text,
      true
    );
  end if;

  if jsonb_array_length(p_items) > 0 then
    -- Lot 2, sub-lot 2.8 (M6b): under the creation contract of this version, the per-line triggers
    -- (content revision, audit, source coverage, depth) leave its items to one replay, in payload
    -- order, at the end of the insert.
    previous_creation_contract := coalesce(
      pg_catalog.current_setting('miaouffrage.estimate_creation_atomic', true),
      ''
    );
    perform pg_catalog.set_config(
      'miaouffrage.estimate_creation_atomic',
      version_row.id::text,
      true
    );
    insert into public.estimate_items (
      id,
      tenant_id,
      version_id,
      parent_id,
      item_type,
      position,
      title,
      description,
      quantity,
      unit_price_ht_cents,
      tax_rate_bp,
      k_fo,
      h_mo,
      h_mo_majoration,
      k_mo,
      h_mo_atelier,
      k_mo_atelier,
      labor_role_atelier_id,
      h_mo_chantier,
      k_mo_chantier,
      labor_role_chantier_id,
      pu_ht_cents,
      labor_role_id,
      category_id,
      supply_type_id,
      selected_supplier_price_id,fo_price_origin,
      source_provider,
      source_job_id,
      source_file_name,
      source_page,
      source_metadata,
      line_total_ht_cents,
      line_tax_cents,
      line_total_ttc_cents,
      unit_code,
      pricing_status,
      h_mo_per_unit,
      h_mo_atelier_per_unit,
      h_mo_chantier_per_unit
    )
    select
      coalesce(item.id, gen_random_uuid()),
      p_tenant_id,
      version_row.id,
      item.parent_id,
      item.item_type,
      item.position,
      item.title,
      item.description,
      item.quantity,
      item.unit_price_ht_cents,
      item.tax_rate_bp,
      item.k_fo,
      item.h_mo,
      coalesce(item.h_mo_majoration, 1),
      item.k_mo,
      item.h_mo_atelier,
      coalesce(item.k_mo_atelier, 1),
      item.labor_role_atelier_id,
      item.h_mo_chantier,
      coalesce(item.k_mo_chantier, 1),
      item.labor_role_chantier_id,
      item.pu_ht_cents,
      item.labor_role_id,
      item.category_id,
      item.supply_type_id,
      item.selected_supplier_price_id,item.fo_price_origin,
      item.source_provider,
      item.source_job_id,
      item.source_file_name,
      item.source_page,
      coalesce(item.source_metadata, '{}'::jsonb),
      item.line_total_ht_cents,
      item.line_tax_cents,
      item.line_total_ttc_cents,
      item.unit_code,
      coalesce(item.pricing_status, 'priced'::public.estimate_line_pricing_status),
      item.h_mo_per_unit,
      item.h_mo_atelier_per_unit,
      item.h_mo_chantier_per_unit
    from jsonb_to_recordset(public.estimate_fo_price_origin_write_input(p_items)) as item(
      id uuid,
      parent_id uuid,
      item_type public.estimate_item_type,
      position integer,
      title text,
      description text,
      quantity numeric,
      unit_price_ht_cents integer,
      tax_rate_bp integer,
      k_fo numeric,
      h_mo numeric,
      h_mo_majoration numeric,
      k_mo numeric,
      h_mo_atelier numeric,
      k_mo_atelier numeric,
      labor_role_atelier_id uuid,
      h_mo_chantier numeric,
      k_mo_chantier numeric,
      labor_role_chantier_id uuid,
      pu_ht_cents integer,
      labor_role_id uuid,
      category_id uuid,
      supply_type_id uuid,
      selected_supplier_price_id uuid,
      fo_price_origin jsonb,
      source_provider text,
      source_job_id uuid,
      source_file_name text,
      source_page integer,
      source_metadata jsonb,
      line_total_ht_cents integer,
      line_tax_cents integer,
      line_total_ttc_cents integer,
      unit_code text,
      pricing_status public.estimate_line_pricing_status,
      h_mo_per_unit numeric,
      h_mo_atelier_per_unit numeric,
      h_mo_chantier_per_unit numeric
    );
    perform public.estimate_creation_replay_item_effects_for_writer(
      version_row.id,
      array(
        select (entry.value->>'id')::uuid
        from jsonb_array_elements(p_items) with ordinality as entry(value, ordinality)
        order by entry.ordinality
      )
    );
    perform pg_catalog.set_config(
      'miaouffrage.estimate_creation_atomic',
      previous_creation_contract,
      true
    );
  end if;

  if creates_v3 then
    perform public.estimate_v3_assert_draft_for_writer(version_row.id);
    perform pg_catalog.set_config(
      'miaouffrage.estimate_v3_writer',
      previous_v3_writer,
      true
    );
  end if;

  return jsonb_build_object(
    'project', to_jsonb(project_row),
    'version', to_jsonb(version_row)
  );
end;
$$;


-- Latest owning definition: 20261024142907_estimate_fo_provision.sql. Added only nullable origin transport.
CREATE OR REPLACE FUNCTION public.duplicate_estimate_version_without_product_id(source_version_id uuid, as_variant boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_user_id uuid := (select auth.uid());
  source_version public.estimate_versions%rowtype;
  new_version_id uuid := gen_random_uuid();
  new_version_number integer;
  variant_parent_id uuid := null;
  next_variant_index integer := 0;
  next_variant_label text := null;
  item_id_map jsonb := '{}'::jsonb;
  previous_insert_contract text;
  source_is_v3 boolean;
  previous_v3_writer text;
begin
  if actor_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'AUTHENTICATION_REQUIRED';
  end if;

  select v.*
    into source_version
  from public.estimate_versions v
  join public.estimate_projects p on p.id = v.project_id
    and p.tenant_id = v.tenant_id
  join public.tenants tenant
    on tenant.id = p.tenant_id
    and tenant.is_active
  join public.tenant_memberships membership
    on membership.tenant_id = p.tenant_id
    and membership.user_id = actor_user_id
  where v.id = duplicate_estimate_version_without_product_id.source_version_id
    and not p.is_archived
    and membership.role in (
      'admin'::public.tenant_role,
      'engineer'::public.tenant_role
    )
    and (
      p.user_id = actor_user_id
      or membership.role = 'admin'::public.tenant_role
    )
  for update of p, v;

  if not found then
    raise exception 'Estimate version not found or access denied';
  end if;

  select coalesce(max(version_number), 0) + 1
    into new_version_number
  from public.estimate_versions
  where project_id = source_version.project_id;

  if coalesce(as_variant, false) then
    variant_parent_id := duplicate_estimate_version_without_product_id.source_version_id;

    loop
      next_variant_index := next_variant_index + 1;
      next_variant_label := public.estimate_variant_label_from_index(next_variant_index);

      exit when not exists (
        select 1
        from public.estimate_versions existing_variant
        where existing_variant.parent_version_id = variant_parent_id
          and existing_variant.variant_label = next_variant_label
      );
    end loop;
  end if;

  previous_insert_contract := coalesce(
    pg_catalog.current_setting(
      'miaouffrage.estimate_version_insert_contract',
      true
    ),
    ''
  );
  source_is_v3 := source_version.calc_engine_version = 3;
  perform pg_catalog.set_config(
    'miaouffrage.estimate_version_insert_contract',
    case when source_is_v3 then 'duplicate_source_v3' else 'duplicate_source' end,
    true
  );

  insert into public.estimate_versions (
    id,
    tenant_id,
    project_id,
    version_number,
    status,
    title,
    exclusions,
    date_devis,
    validite_jours,
    margin_multiplier,
    margin_mode,
    currency,
    margin_bp,
    discount_bp,
    discount_amount_cents,
    discount_mode,
    discount_steps,
    global_coefficient,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    calc_engine_version,
    contractor_role,
    total_ht_cents,
    total_tax_cents,
    total_ttc_cents,
    parent_version_id,
    variant_label,
    max_section_depth,
    sale_coefficient_fo,
    sale_coefficient_mo,
    gross_ht_cents,
    discount_applied_cents,
    commercial_rounding_cents
  )
  values (
    new_version_id,
    source_version.tenant_id,
    source_version.project_id,
    new_version_number,
    'draft',
    source_version.title,
    source_version.exclusions,
    source_version.date_devis,
    source_version.validite_jours,
    source_version.margin_multiplier,
    source_version.margin_mode,
    source_version.currency,
    source_version.margin_bp,
    source_version.discount_bp,
    source_version.discount_amount_cents,
    source_version.discount_mode,
    source_version.discount_steps,
    source_version.global_coefficient,
    source_version.tax_rate_bp,
    source_version.rounding_mode,
    source_version.rounding_step_cents,
    source_version.calc_engine_version,
    source_version.contractor_role,
    source_version.total_ht_cents,
    source_version.total_tax_cents,
    source_version.total_ttc_cents,
    variant_parent_id,
    next_variant_label,
    source_version.max_section_depth,
    source_version.sale_coefficient_fo,
    source_version.sale_coefficient_mo,
    source_version.gross_ht_cents,
    source_version.discount_applied_cents,
    source_version.commercial_rounding_cents
  );

  perform pg_catalog.set_config(
    'miaouffrage.estimate_version_insert_contract',
    previous_insert_contract,
    true
  );

  previous_v3_writer := coalesce(
    pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true),
    ''
  );
  if source_is_v3 then
    perform pg_catalog.set_config(
      'miaouffrage.estimate_v3_writer',
      new_version_id::text,
      true
    );
  end if;

  if source_is_v3 then
    -- D13 : les répartitions exactes v3 (remise, TVA) départagent leurs ex aequo par identifiant de ligne
    -- croissant. Les identifiants neufs suivent donc l'ordre des identifiants source (le k-ième plus petit
    -- source reçoit le k-ième plus petit neuf) : les montants copiés restent ceux que le moteur calcule
    -- sur la copie, et ni son gel ni son lot suivant ne déplacent un centime d'une ligne non touchée.
    select coalesce(
      jsonb_object_agg(source_ids.id::text, fresh_ids.id::text),
      '{}'::jsonb
    )
      into item_id_map
    from (
      select item.id, row_number() over (order by item.id) as id_rank
      from public.estimate_items as item
      where item.version_id = duplicate_estimate_version_without_product_id.source_version_id
        and item.tenant_id = source_version.tenant_id
    ) as source_ids
    join (
      select fresh.id, row_number() over (order by fresh.id) as id_rank
      from (
        select gen_random_uuid() as id
        from public.estimate_items as item
        where item.version_id = duplicate_estimate_version_without_product_id.source_version_id
          and item.tenant_id = source_version.tenant_id
      ) as fresh
    ) as fresh_ids on fresh_ids.id_rank = source_ids.id_rank;
  else
    select coalesce(
      jsonb_object_agg(item.id::text, gen_random_uuid()::text),
      '{}'::jsonb
    )
      into item_id_map
    from public.estimate_items as item
    where item.version_id = duplicate_estimate_version_without_product_id.source_version_id
      and item.tenant_id = source_version.tenant_id;
  end if;

  with recursive source_item_hierarchy as (
    select
      root.id,
      root.parent_id,
      0 as depth
    from public.estimate_items root
    where root.version_id = duplicate_estimate_version_without_product_id.source_version_id
      and root.parent_id is null

    union all

    select
      child.id,
      child.parent_id,
      parent.depth + 1
    from public.estimate_items child
    join source_item_hierarchy parent on parent.id = child.parent_id
    where child.version_id = duplicate_estimate_version_without_product_id.source_version_id
  )
  insert into public.estimate_items (
    id,
    tenant_id,
    version_id,
    parent_id,
    item_type,
    position,
    title,
    description,
    aid,
    quantity,
    unit_price_ht_cents,
    tax_rate_bp,
    k_fo,
    fo_provision, -- TI-534 (ajout) : la copie garde la provision de chaque ligne
    h_mo,
    h_mo_majoration,
    k_mo,
    h_mo_atelier,
    k_mo_atelier,
    labor_role_atelier_id,
    h_mo_chantier,
    k_mo_chantier,
    labor_role_chantier_id,
    pu_ht_cents,
    labor_role_id,
    category_id,
    supply_type_id,
    selected_supplier_price_id,fo_price_origin,
    source_provider,
    source_job_id,
    source_file_name,
    source_page,
    source_metadata,
    line_total_ht_cents,
    line_tax_cents,
    line_total_ttc_cents,
    unit_code,
    pricing_status,
    h_mo_per_unit,
    h_mo_atelier_per_unit,
    h_mo_chantier_per_unit,
    product_id
  )
  select
    (item_id_map->>hierarchy.id::text)::uuid,
    source_version.tenant_id,
    new_version_id,
    (item_id_map->>src.parent_id::text)::uuid,
    src.item_type,
    src.position,
    src.title,
    src.description,
    src.aid,
    src.quantity,
    src.unit_price_ht_cents,
    src.tax_rate_bp,
    src.k_fo,
    src.fo_provision, -- TI-534 (ajout)
    src.h_mo,
    src.h_mo_majoration,
    src.k_mo,
    src.h_mo_atelier,
    src.k_mo_atelier,
    src.labor_role_atelier_id,
    src.h_mo_chantier,
    src.k_mo_chantier,
    src.labor_role_chantier_id,
    src.pu_ht_cents,
    src.labor_role_id,
    src.category_id,
    src.supply_type_id,
    src.selected_supplier_price_id,src.fo_price_origin,
    src.source_provider,
    src.source_job_id,
    src.source_file_name,
    src.source_page,
    coalesce(src.source_metadata, '{}'::jsonb),
    src.line_total_ht_cents,
    src.line_tax_cents,
    src.line_total_ttc_cents,
    src.unit_code,
    src.pricing_status,
    src.h_mo_per_unit,
    src.h_mo_atelier_per_unit,
    src.h_mo_chantier_per_unit,
    case when source_is_v3 then src.product_id end
  from source_item_hierarchy hierarchy
  join public.estimate_items src on src.id = hierarchy.id
  order by hierarchy.depth asc, src.position asc, src.id asc;

  if source_is_v3 then
    perform pg_catalog.set_config(
      'miaouffrage.estimate_v3_writer',
      previous_v3_writer,
      true
    );
  end if;

  with carry_over_takeoff_jobs as materialized (
    select
      job.id as takeoff_job_id,
      job.estimate_version_id as provenance_source_version_id
    from public.takeoff_jobs job
    where job.tenant_id = source_version.tenant_id
      and (
        job.estimate_version_id = duplicate_estimate_version_without_product_id.source_version_id
        or exists (
          select 1
          from public.takeoff_version_links inherited_link
          where inherited_link.tenant_id = source_version.tenant_id
            and inherited_link.takeoff_job_id = job.id
            and inherited_link.target_version_id =
              duplicate_estimate_version_without_product_id.source_version_id
        )
        or exists (
          select 1
          from public.takeoff_dpgf_review_decisions decision
          where decision.tenant_id = source_version.tenant_id
            and decision.takeoff_job_id = job.id
            and decision.version_id =
              duplicate_estimate_version_without_product_id.source_version_id
        )
      )
    order by job.id
    for share of job
  )
  insert into public.takeoff_version_links (
    tenant_id,
    takeoff_job_id,
    source_version_id,
    target_version_id,
    linked_at,
    linked_by
  )
  select
    source_version.tenant_id,
    candidate.takeoff_job_id,
    candidate.provenance_source_version_id,
    new_version_id,
    now(),
    null
  from carry_over_takeoff_jobs candidate
  on conflict (takeoff_job_id, target_version_id) do nothing;

  insert into public.takeoff_dpgf_review_decisions (
    id,
    tenant_id,
    version_id,
    takeoff_job_id,
    estimate_item_id,
    review_reference,
    line_label,
    line_position,
    source_file_name,
    source_page,
    carried_over_from_version_id,
    carried_over_at,
    decision,
    reason,
    decided_at,
    updated_at,
    decided_by
  )
  select
    gen_random_uuid(),
    src.tenant_id,
    new_version_id,
    src.takeoff_job_id,
    (item_id_map->>src.estimate_item_id::text)::uuid,
    src.review_reference,
    src.line_label,
    src.line_position,
    src.source_file_name,
    src.source_page,
    duplicate_estimate_version_without_product_id.source_version_id,
    now(),
    src.decision,
    src.reason,
    src.decided_at,
    src.updated_at,
    src.decided_by
  from public.takeoff_dpgf_review_decisions src
  where src.version_id = duplicate_estimate_version_without_product_id.source_version_id;

  return new_version_id;
end;
$function$
;


commit;
