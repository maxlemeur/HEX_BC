begin;

-- One transaction owns ordered mutations, financial projection, audit and
-- immutable receipt. Money is calculated by the existing TypeScript engine;
-- this RPC validates scope/shape/context and invokes the canonical bulk writer.
create table private.estimate_batch_receipts (
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  operation_key uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  actor_id uuid not null,
  canonical_request jsonb not null,
  response jsonb not null,
  committed_at timestamptz not null default clock_timestamp(),
  primary key(version_id,operation_key),
  check(jsonb_typeof(canonical_request)='object' and jsonb_typeof(response)='object'),
  check(octet_length(response::text)<=2097152)
);
create index estimate_batch_receipts_project_idx on private.estimate_batch_receipts(project_id);
create index estimate_batch_receipts_tenant_idx on private.estimate_batch_receipts(tenant_id);
alter table private.estimate_batch_receipts enable row level security;
revoke all on private.estimate_batch_receipts from public,anon,authenticated,service_role;

create function private.estimate_batch_error(code text) returns void language plpgsql set search_path='' as $$
begin
  raise exception using errcode=case when code='FORBIDDEN' then '42501' when code in('STALE','CONTEXT_CHANGED','IDEMPOTENCY_CONFLICT') then '40001' when code='LOCK_REQUIRED' then '55000' else '22023' end,message='ESTIMATE_BATCH_'||code;
end $$;
revoke all on function private.estimate_batch_error(text) from public,anon,authenticated,service_role;

create function private.guard_estimate_batch_scope() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='estimate_batch_receipts' then
    if tg_op='DELETE' and (not exists(select 1 from public.estimate_versions where id=old.version_id) or not exists(select 1 from public.estimate_projects where id=old.project_id) or not exists(select 1 from public.tenants where id=old.tenant_id)) then return old; end if;
    perform private.estimate_batch_error('FORBIDDEN');
  elsif tg_table_name='estimate_versions' then
    if (new.id,new.tenant_id,new.project_id) is distinct from (old.id,old.tenant_id,old.project_id)
      and exists(select 1 from private.estimate_batch_receipts where version_id=old.id) then perform private.estimate_batch_error('FORBIDDEN'); end if;
  elsif (new.id,new.tenant_id) is distinct from (old.id,old.tenant_id)
    and exists(select 1 from private.estimate_batch_receipts where project_id=old.id) then perform private.estimate_batch_error('FORBIDDEN');
  end if;
  return new;
end $$;
revoke all on function private.guard_estimate_batch_scope() from public,anon,authenticated,service_role;
create trigger estimate_batch_receipt_immutable before update or delete on private.estimate_batch_receipts for each row execute function private.guard_estimate_batch_scope();
create trigger aaa_estimate_batch_version_scope before update of id,tenant_id,project_id on public.estimate_versions for each row execute function private.guard_estimate_batch_scope();
create trigger aaa_estimate_batch_project_scope before update of id,tenant_id on public.estimate_projects for each row execute function private.guard_estimate_batch_scope();

-- Extend the already installed phantom-safe gate to the RAW AID policy. Keep
-- its OLD/NEW coordination and labor_roles NULL tenant normalization intact.
create or replace function private.guard_estimate_calculation_context_write()
returns trigger language plpgsql security invoker set search_path='' as $$
declare affected_tenant uuid; old_tenant uuid; new_tenant uuid;
begin
  if tg_table_name='feature_flags' then
    if tg_op<>'INSERT' and old.flag_key in('EST_031_LABOR_SPLIT','ESTIMATE_ITEM_AID_REGEX') then old_tenant:=old.tenant_id; end if;
    if tg_op<>'DELETE' and new.flag_key in('EST_031_LABOR_SPLIT','ESTIMATE_ITEM_AID_REGEX') then new_tenant:=new.tenant_id; end if;
  else
    if tg_op<>'INSERT' then old_tenant:=old.tenant_id; end if;
    if tg_op<>'DELETE' then new_tenant:=case when tg_table_name='labor_roles' then coalesce(new.tenant_id,public.current_tenant_id()) else new.tenant_id end; end if;
  end if;
  for affected_tenant in select distinct t from unnest(array[old_tenant,new_tenant]) t where t is not null order by t loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('estimate-calculation:'||affected_tenant::text,0)) then
      raise exception using errcode='40001',message='ESTIMATE_CREATE_CONTEXT_CHANGED';
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

-- Internal only: current actor/active tenant gates also protect absent rows.
-- No global-admin shortcut, JWT user_metadata, caller-supplied actor, or private
-- schema privilege is used. Re-run after acquiring the parent row locks.
create function private.estimate_batch_context(p_version_id uuid,p_write boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid:=(select auth.uid()); active_tenant uuid; ctx record;
begin
  if actor is null then perform private.estimate_batch_error('FORBIDDEN'); end if;
  if not pg_catalog.pg_try_advisory_xact_lock_shared(pg_catalog.hashtextextended('estimate-create-actor:'||actor::text,0)) then perform private.estimate_batch_error('CONTEXT_CHANGED'); end if;
  active_tenant:=public.current_tenant_id();
  if active_tenant is null then perform private.estimate_batch_error('NOT_FOUND'); end if;
  if not pg_catalog.pg_try_advisory_xact_lock_shared(pg_catalog.hashtextextended('estimate-calculation:'||active_tenant::text,0)) then perform private.estimate_batch_error('CONTEXT_CHANGED'); end if;
  select v.id,v.tenant_id,v.project_id,v.status,v.updated_at,p.user_id,p.is_archived,m.role into ctx
  from public.estimate_versions v join public.estimate_projects p on p.id=v.project_id and p.tenant_id=v.tenant_id
  join public.tenants t on t.id=v.tenant_id and t.is_active
  join public.tenant_memberships m on m.tenant_id=t.id and m.user_id=actor
  where v.id=p_version_id and v.tenant_id=active_tenant;
  if not found or not(ctx.user_id=actor or ctx.role='admin') then perform private.estimate_batch_error('NOT_FOUND'); end if;
  if p_write and ctx.role not in('admin','engineer') then perform private.estimate_batch_error('FORBIDDEN'); end if;
  return to_jsonb(ctx)||jsonb_build_object('actor_id',actor);
end $$;
revoke all on function private.estimate_batch_context(uuid,boolean) from public,anon,authenticated,service_role;

-- Stable public intent, not a second derived write plan. Preserve omissions and
-- numeric precision in receipt identity. Defaults are applied only after replay.
create function private.canonical_estimate_batch_operations(operations jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare op jsonb; result jsonb:='[]'; data jsonb; pair record; key text; value jsonb; name text;
  common_keys text[]:=array['parent_id','position','title','aid'];
  line_keys text[]:=array['line_nature','description','quantity','unit_price_ht_cents','tax_rate_bp','k_fo','h_mo','h_mo_majoration','k_mo','h_mo_atelier','k_mo_atelier','labor_role_atelier_id','h_mo_chantier','k_mo_chantier','labor_role_chantier_id','labor_role_id','category_id','supply_type_id','product_id','selected_supplier_price_id'];
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
    if name='delete' then result:=result||jsonb_build_array(op); continue; end if;
    data:=op->'data';
    if jsonb_typeof(data) is distinct from 'object' then perform private.estimate_batch_error('INVALID_INPUT'); end if;
    if name='reorder' then
      if data-array['parent_id','ordered_ids']<>'{}'::jsonb or jsonb_typeof(data->'ordered_ids') is distinct from 'array' or jsonb_array_length(data->'ordered_ids')<1 then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      if exists(select 1 from jsonb_array_elements(data->'ordered_ids') x where jsonb_typeof(x)<>'string') then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      select jsonb_agg(to_jsonb((x.value#>>'{}')::uuid) order by x.ordinality) into value from jsonb_array_elements(data->'ordered_ids') with ordinality x;
      data:=jsonb_set(data,'{ordered_ids}',value);
      if data ? 'parent_id' and data->'parent_id'<>'null'::jsonb then data:=jsonb_set(data,'{parent_id}',to_jsonb((data->>'parent_id')::uuid)); end if;
      result:=result||jsonb_build_array(jsonb_set(op,'{data}',data)); continue;
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
      elsif key in('title','aid','description','source_provider','source_file_name') then
        if value<>'null'::jsonb and jsonb_typeof(value)<>'string' or key='title' and (value='null'::jsonb or btrim(data->>key)='') then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        data:=jsonb_set(data,array[key],coalesce(to_jsonb(case when key='aid' then upper(nullif(btrim(data->>key),'')) when key='title' then btrim(data->>key) else nullif(btrim(data->>key),'') end),'null'));
      elsif key in('item_type','line_nature') then
        if jsonb_typeof(value)<>'string' or key='line_nature' and data->>key not in('supply_only','supply_and_labor','labor_only') then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      else
        if value='null'::jsonb and key in('h_mo_atelier','k_mo_atelier','h_mo_chantier','k_mo_chantier','source_page') then continue; end if;
        if jsonb_typeof(value)<>'number' or (data->>key)::numeric<0 then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        if key in('position','source_page','unit_price_ht_cents','tax_rate_bp') or key=any(money_keys) then
          if (data->>key)::numeric<>trunc((data->>key)::numeric) or (data->>key)::numeric>2147483647 then perform private.estimate_batch_error('INVALID_INPUT'); end if;
        end if;
        if key in('position','source_page') and (data->>key)::numeric<1 or key='tax_rate_bp' and (data->>key)::numeric>10000 then perform private.estimate_batch_error('INVALID_INPUT'); end if;
      end if;
    end loop;
    result:=result||jsonb_build_array(jsonb_set(op,'{data}',data));
  end loop;
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then perform private.estimate_batch_error('INVALID_INPUT'); return null;
end $$;
revoke all on function private.canonical_estimate_batch_operations(jsonb) from public,anon,authenticated,service_role;

create function public.get_estimate_batch_receipt(p_version_id uuid,p_operation_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; saved private.estimate_batch_receipts%rowtype; v public.estimate_versions%rowtype;
begin
  ctx:=private.estimate_batch_context(p_version_id,false);
  if p_operation_key is null then perform private.estimate_batch_error('OPERATION_KEY_REQUIRED'); end if;
  select * into v from public.estimate_versions where id=p_version_id for share;
  perform 1 from public.estimate_projects where id=v.project_id for share nowait;
  ctx:=private.estimate_batch_context(p_version_id,false);
  select * into saved from private.estimate_batch_receipts where version_id=p_version_id and operation_key=p_operation_key and tenant_id=(ctx->>'tenant_id')::uuid and project_id=(ctx->>'project_id')::uuid and actor_id=(ctx->>'actor_id')::uuid;
  if not found then return null; end if;
  return saved.response||jsonb_build_object('replayed',true,'current_version',jsonb_build_object('id',v.id,'updated_at',v.updated_at,'status',v.status));
exception when lock_not_available then perform private.estimate_batch_error('STALE'); return null;
end $$;
revoke all on function public.get_estimate_batch_receipt(uuid,uuid) from public,anon,service_role;
grant execute on function public.get_estimate_batch_receipt(uuid,uuid) to authenticated;

create function public.commit_estimate_batch(
  p_version_id uuid,p_operation_key uuid,p_expected_updated_at timestamptz,
  p_draft_lock_session_id uuid,p_operations jsonb,p_created_ids jsonb,
  p_item_updates jsonb,p_version_patch jsonb,p_calculation_context jsonb,p_expected_aid_policy jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  ctx jsonb; actor uuid; target_tenant uuid; project_owner uuid;
  v public.estimate_versions%rowtype; lease public.draft_locks%rowtype; item public.estimate_items%rowtype; old_item public.estimate_items%rowtype;
  saved private.estimate_batch_receipts%rowtype; operations jsonb; canonical jsonb; raw_context jsonb; aid_policy jsonb;
  op jsonb; data jsonb; normalized jsonb; projected jsonb; results jsonb:='[]'; response jsonb; operation_index integer:=-1;
  item_id uuid; target_parent uuid; actual_ids uuid[]; supplied_ids uuid[]; affected_ids uuid[]:='{}'; deleted_ids uuid[]; role_ids uuid[];
  depth integer; parent_depth integer; hierarchy_invalid boolean; position_value integer; create_count integer; changed integer; event_time timestamptz;
  has_supply boolean; has_labor boolean; failure_code text; failure_message text; operation_stage boolean:=true;
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
  if v.updated_at is distinct from p_expected_updated_at then perform private.estimate_batch_error('STALE'); end if;
  select * into lease from public.draft_locks where version_id=p_version_id and tenant_id=target_tenant for update nowait;
  if not found or p_draft_lock_session_id is null or lease.user_id is distinct from actor or lease.session_id is distinct from p_draft_lock_session_id or lease.expires_at<=clock_timestamp() then perform private.estimate_batch_error('LOCK_REQUIRED'); end if;
  perform id from public.estimate_items where version_id=p_version_id order by id for update nowait;
  if jsonb_typeof(p_created_ids) is distinct from 'array' or jsonb_typeof(p_item_updates) is distinct from 'array' or jsonb_typeof(p_version_patch) is distinct from 'object' or jsonb_typeof(p_calculation_context) is distinct from 'object'
    or not(p_version_patch ?& array['total_ht_cents','total_tax_cents','total_ttc_cents']) or p_version_patch-array['total_ht_cents','total_tax_cents','total_ttc_cents']<>'{}'::jsonb then perform private.estimate_batch_error('INVALID_INPUT'); end if;
  if exists(select 1 from jsonb_each(p_version_patch) x where jsonb_typeof(x.value)<>'number' or x.value::text !~ '^[0-9]+$' or x.value::text::numeric>2147483647) then perform private.estimate_batch_error('INVALID_INPUT'); end if;
  select count(*) into create_count from jsonb_array_elements(operations) x where x->>'op'='create';
  if jsonb_array_length(p_created_ids)<>create_count or exists(select 1 from jsonb_array_elements(p_created_ids) x where jsonb_typeof(x)<>'object' or not(x?&array['index','id']) or x-array['index','id']<>'{}'::jsonb or jsonb_typeof(x->'id')<>'string' or jsonb_typeof(x->'index')<>'number' or x->>'index'!~'^[0-9]+$') then perform private.estimate_batch_error('INVALID_INPUT'); end if;
  if exists(select 1 from jsonb_array_elements(p_created_ids) x where (x->>'index')::numeric>999 or operations->(x->>'index')::integer->>'op' is distinct from 'create')
    or (select count(distinct (x->>'id')::uuid) from jsonb_array_elements(p_created_ids) x)<>create_count
    or (select count(distinct (x->>'index')::integer) from jsonb_array_elements(p_created_ids) x)<>create_count
    or exists(select 1 from jsonb_array_elements(p_created_ids) x join public.estimate_items i on i.id=(x->>'id')::uuid) then perform private.estimate_batch_error('INVALID_INPUT'); end if;
  if exists(select 1 from jsonb_array_elements(p_item_updates) x where jsonb_typeof(x)<>'object' or not(x?&array['id','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents']) or x-array['id','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents']<>'{}'::jsonb or jsonb_typeof(x->'id')<>'string')
    or exists(select 1 from jsonb_array_elements(p_item_updates) x cross join lateral jsonb_each(x-'id') n where jsonb_typeof(n.value)<>'number' or n.value::text!~'^[0-9]+$' or n.value::text::numeric>2147483647) then perform private.estimate_batch_error('PROJECTION_MISMATCH'); end if;
  select coalesce(array_agg((x->>'id')::uuid order by (x->>'id')::uuid),'{}') into supplied_ids from jsonb_array_elements(p_item_updates) x;
  if cardinality(supplied_ids)<>(select count(distinct x) from unnest(supplied_ids) x) then perform private.estimate_batch_error('PROJECTION_MISMATCH'); end if;
  select jsonb_build_object('id',id,'enabled',enabled,'value',value) into aid_policy from public.feature_flags where tenant_id=target_tenant and flag_key='ESTIMATE_ITEM_AID_REGEX';
  if coalesce(aid_policy,'null'::jsonb) is distinct from coalesce(p_expected_aid_policy,'null'::jsonb) then perform private.estimate_batch_error('CONTEXT_CHANGED'); end if;

  -- Catch confirmed operation failure only around ALL writes. Subtransaction
  -- rollback restores cascades, technical revisions, audit, footer and receipt.
  begin
    for op in select * from jsonb_array_elements(operations) loop
      operation_index:=operation_index+1; data:=op->'data'; item_id:=null;
      if op->>'op'='create' then
        select (x->>'id')::uuid into item_id from jsonb_array_elements(p_created_ids) x where (x->>'index')::integer=operation_index;
        target_parent:=(data->>'parent_id')::uuid;
        select coalesce(max(position),0)+1 into position_value from public.estimate_items where version_id=p_version_id and parent_id is not distinct from target_parent;
        depth:=1;
        if target_parent is not null then
          with recursive ancestors as(select id,parent_id,1 as d from public.estimate_items where id=target_parent and version_id=p_version_id union all select i.id,i.parent_id,a.d+1 from public.estimate_items i join ancestors a on i.id=a.parent_id where a.d<5) select coalesce(max(d),0)+1 into depth from ancestors;
        end if;
        normalized:=jsonb_build_object('id',item_id,'tenant_id',target_tenant,'version_id',p_version_id,'parent_id',target_parent,'position',coalesce((data->>'position')::integer,position_value),'title',coalesce(data->>'title',case when data->>'item_type'='line' then 'Nouvelle ligne' else 'Nouveau '||case depth when 1 then 'lot' when 2 then 'chapitre' when 3 then 'sous-chapitre' else 'ouvrage' end end),'source_provider',coalesce(data->>'source_provider','manual'))||data;
        -- Explicit null provider still means manual; do not inject this default
        -- into the canonical request retained in the receipt.
        normalized:=normalized||jsonb_build_object('source_provider',coalesce(data->>'source_provider','manual'));
        if data->>'item_type'='line' then
          select x into projected from jsonb_array_elements(p_item_updates) x where (x->>'id')::uuid=item_id;
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
        results:=results||jsonb_build_array(jsonb_build_object('index',operation_index,'op','delete','status','ok','data',jsonb_build_object('deleted_id',item_id,'deleted_ids',deleted_ids)));
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
        results:=results||jsonb_build_array(jsonb_build_object('index',operation_index,'op','reorder','status','ok','data',jsonb_build_object('parent_id',target_parent,'ordered_ids',data->'ordered_ids','updated_count',changed)));
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
        has_labor:=coalesce(item.h_mo,0)>0 or coalesce(item.h_mo_atelier,0)>0 or coalesce(item.h_mo_chantier,0)>0 or item.labor_role_id is not null or item.labor_role_atelier_id is not null or item.labor_role_chantier_id is not null;
        if not(data?'line_nature') then
          if op->>'op'='create' then item.line_nature:=(case when has_labor and not has_supply then 'labor_only' when has_labor then 'supply_and_labor' else 'supply_only' end)::public.estimate_line_nature;
          elsif old_item.line_nature='supply_only' and data?|array['h_mo','h_mo_atelier','h_mo_chantier','labor_role_id','labor_role_atelier_id','labor_role_chantier_id'] and has_labor or old_item.line_nature='labor_only' and data?|array['unit_price_ht_cents','supply_type_id','selected_supplier_price_id'] and has_supply then item.line_nature:='supply_and_labor'; end if;
        end if;
        affected_ids:=array_append(affected_ids,item.id);
      end if;
      if op->>'op'='create' then
        insert into public.estimate_items(id,tenant_id,version_id,parent_id,item_type,position,title,description,aid,quantity,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,h_mo_majoration,k_mo,h_mo_atelier,k_mo_atelier,labor_role_atelier_id,h_mo_chantier,k_mo_chantier,labor_role_chantier_id,pu_ht_cents,labor_role_id,category_id,supply_type_id,product_id,selected_supplier_price_id,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,line_nature,source_provider,source_job_id,source_file_name,source_page)
        values(item.id,item.tenant_id,item.version_id,item.parent_id,item.item_type,item.position,item.title,item.description,item.aid,item.quantity,item.unit_price_ht_cents,item.tax_rate_bp,item.k_fo,item.h_mo,item.h_mo_majoration,item.k_mo,item.h_mo_atelier,item.k_mo_atelier,item.labor_role_atelier_id,item.h_mo_chantier,item.k_mo_chantier,item.labor_role_chantier_id,item.pu_ht_cents,item.labor_role_id,item.category_id,item.supply_type_id,item.product_id,item.selected_supplier_price_id,item.line_total_ht_cents,item.line_tax_cents,item.line_total_ttc_cents,item.line_nature,item.source_provider,item.source_job_id,item.source_file_name,item.source_page);
      else
        update public.estimate_items set parent_id=item.parent_id,position=item.position,title=item.title,description=item.description,aid=item.aid,quantity=item.quantity,unit_price_ht_cents=item.unit_price_ht_cents,tax_rate_bp=item.tax_rate_bp,k_fo=item.k_fo,h_mo=item.h_mo,h_mo_majoration=item.h_mo_majoration,k_mo=item.k_mo,h_mo_atelier=item.h_mo_atelier,k_mo_atelier=item.k_mo_atelier,labor_role_atelier_id=item.labor_role_atelier_id,h_mo_chantier=item.h_mo_chantier,k_mo_chantier=item.k_mo_chantier,labor_role_chantier_id=item.labor_role_chantier_id,labor_role_id=item.labor_role_id,category_id=item.category_id,supply_type_id=item.supply_type_id,product_id=item.product_id,selected_supplier_price_id=item.selected_supplier_price_id,line_nature=item.line_nature where id=item.id and version_id=p_version_id;
      end if;
      results:=results||jsonb_build_array(jsonb_build_object('index',operation_index,'op',op->>'op','status','ok','data',jsonb_build_object('item_id',item.id)));
    end loop;
    operation_stage:=false;
    select coalesce(array_agg(id order by id),'{}') into actual_ids from public.estimate_items where version_id=p_version_id and item_type='line' and (v.calc_engine_version=2 or id=any(affected_ids));
    if supplied_ids is distinct from actual_ids then perform private.estimate_batch_error('PROJECTION_MISMATCH'); end if;
    select coalesce(array_agg(distinct r.id order by r.id),'{}') into role_ids from public.estimate_items i cross join lateral unnest(array[i.labor_role_id,i.labor_role_atelier_id,i.labor_role_chantier_id]) r(id) where i.version_id=p_version_id and i.item_type='line' and r.id is not null;
    if v.calc_engine_version=2 and exists(select 1 from unnest(role_ids) r(id) where not exists(select 1 from public.labor_roles l where l.id=r.id and l.tenant_id=target_tenant and l.user_id=project_owner)) then perform private.estimate_batch_error('CONTEXT_CHANGED'); end if;
    select jsonb_build_object('labor_roles',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'tenant_id',l.tenant_id,'user_id',l.user_id,'hourly_rate_cents',l.hourly_rate_cents) order by l.id) from public.labor_roles l where l.id=any(role_ids) and l.tenant_id=target_tenant and l.user_id=project_owner),'[]'),
      'margin_tiers',case when v.margin_mode='tiered' then coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'threshold_cents',m.threshold_cents,'multiplier',m.multiplier,'position',m.position) order by m.threshold_cents,m.position,m.id) from public.margin_tiers m where m.tenant_id=target_tenant),'[]') else '[]'::jsonb end,
      'labor_split_flag',(select jsonb_build_object('id',f.id,'enabled',f.enabled) from public.feature_flags f where f.tenant_id=target_tenant and f.flag_key='EST_031_LABOR_SPLIT')) into raw_context;
    if raw_context is distinct from p_calculation_context then perform private.estimate_batch_error('CONTEXT_CHANGED'); end if;
    select * into v from public.estimate_versions where id=p_version_id;
    perform public.bulk_update_estimate_items(p_version_id,p_item_updates,p_version_patch,v.updated_at);
    select * into v from public.estimate_versions where id=p_version_id;
    select coalesce(jsonb_agg(case when x->>'op' in('create','update') then jsonb_set(x,'{data}',case when i.id is null then jsonb_build_object('item',null,'deleted_in_batch',true,'deleted_item_id',x->'data'->'item_id') else jsonb_build_object('item',to_jsonb(i)) end) else x end order by (x->>'index')::integer),'[]') into results
    from jsonb_array_elements(results) x left join public.estimate_items i on i.id=(x->'data'->>'item_id')::uuid and i.version_id=p_version_id;
    perform public.log_estimate_batch_audit(p_version_id,operations);
    event_time:=clock_timestamp();
    response:=jsonb_build_object('committed',true,'results',results,'version',jsonb_build_object('id',v.id,'updated_at',v.updated_at),'totals',jsonb_build_object('total_ht_cents',v.total_ht_cents,'total_tax_cents',v.total_tax_cents,'total_ttc_cents',v.total_ttc_cents),
      'receipt',jsonb_build_object('operation_key',p_operation_key,'actor_id',actor,'version_id',p_version_id,'expected_updated_at',p_expected_updated_at,'operations',operations,'committed_at',event_time));
    if octet_length(response::text)>2097152 then perform private.estimate_batch_error('INVALID_INPUT'); end if;
    insert into private.estimate_batch_receipts(version_id,operation_key,tenant_id,project_id,actor_id,canonical_request,response,committed_at) values(p_version_id,p_operation_key,target_tenant,v.project_id,actor,canonical,response,event_time);
    return response||jsonb_build_object('replayed',false,'current_version',jsonb_build_object('id',v.id,'updated_at',v.updated_at,'status',v.status));
  exception when others then
    get stacked diagnostics failure_code=returned_sqlstate,failure_message=message_text;
    if failure_message not in('ESTIMATE_BATCH_INVALID_INPUT','ESTIMATE_BATCH_NOT_FOUND','ESTIMATE_BATCH_PROJECTION_MISMATCH','ESTIMATE_BATCH_CONTEXT_CHANGED','ESTIMATE_BATCH_STALE','ESTIMATE_BATCH_FORBIDDEN','ESTIMATE_BATCH_LOCK_REQUIRED') then
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
end $$;
revoke all on function public.commit_estimate_batch(uuid,uuid,timestamptz,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.commit_estimate_batch(uuid,uuid,timestamptz,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated;

commit;
