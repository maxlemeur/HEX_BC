-- TI-539: « POSE SEULE », an explicit line nature printed on the issued quote.
--
-- A POSE SEULE line is a fitting service whose supply is not due: its zero supply cost is intended and its labor
-- stays invoiced. It is an explicit choice of the user. Nothing here infers it: the creation paths and the
-- normalisation trigger keep deriving supply_only, supply_and_labor or labor_only, and no supply value promotes a
-- POSE SEULE line (the batch writer only promotes supply_only and labor_only).
--
-- Additive: no existing item, snapshot, contract or seal is rewritten. A contract without the new optional key is
-- exactly a contract of before, so every published document keeps its copy and its seal.
--
-- 1. public.estimate_line_nature gains 'pose_only'.
-- 2. private.canonical_estimate_batch_operations accepts it (latest owning definition:
--    20261109183432_estimate_fo_price_origin.sql; only the accepted list changes).
-- 3. public.estimate_offer_client_valid_v2 accepts the optional key `poseOnly` on a line row, exactly true (latest
--    owning definition: 20261029204225_estimate_pdf_contract_parent_index.sql).
-- 4. public.estimate_offer_client_items_match_v2 requires the key to follow the nature of the frozen line (latest
--    owning definition: 20261018172935_estimate_offer_client_contract_v2_order.sql): a copy can neither invent the
--    mention nor drop it. The refusal stays 23514 OFFER_CLIENT_CONTRACT_ANCHOR_MISMATCH.
--
-- CREATE OR REPLACE keeps each signature, ACL, security mode and search_path. The functions compare the nature
-- as text, so the new enum value is not used as an enum literal in the transaction that adds it.

alter type public.estimate_line_nature add value if not exists 'pose_only';

begin;

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
        if jsonb_typeof(value)<>'string' or key='line_nature' and data->>key not in('supply_only','supply_and_labor','labor_only','pose_only') then perform private.estimate_batch_error('INVALID_INPUT'); end if;
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

create or replace function public.estimate_offer_client_valid_v2(value jsonb,layout jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare v jsonb; totals jsonb; intent jsonb; row_value jsonb; rows_value jsonb; row_index jsonb; part jsonb; tax_value jsonb; required text[]; optional text[];
  portions boolean; reverse_charge boolean; k text; gross numeric; discount numeric; rounding numeric; net numeric;
  row_sum numeric; section_sum numeric; section_fo numeric; section_mo numeric; quantity numeric;
  previous_rate numeric; base_sum numeric:=0; tax_sum numeric:=0;
begin
  if not public.estimate_offer_keys(value,array['schemaVersion','version','project','issuer','company','rows','totals','exclusions'])
    or value->'schemaVersion' is distinct from '2'::jsonb or not public.estimate_offer_layout_valid(layout)
    or not public.estimate_offer_text(value->'exclusions',true) then return false; end if;
  v:=value->'version';
  if not public.estimate_offer_keys(v,array['id','tenantId','projectId','number','contentRevision','calcEngineVersion','dateDevis','validiteJours','currency','contractorRole','taxRateBp'])
    or not public.estimate_offer_uuid(v->'id') or not public.estimate_offer_uuid(v->'tenantId') or not public.estimate_offer_uuid(v->'projectId')
    or not public.estimate_offer_number(v->'number',1,2147483647) or not public.estimate_offer_number(v->'contentRevision',1,9007199254740991)
    or v->'calcEngineVersion' is distinct from '3'::jsonb or not public.estimate_offer_date(v->'dateDevis')
    or not public.estimate_offer_number(v->'validiteJours',0,2147483647) or not public.estimate_offer_number(v->'taxRateBp',0,10000)
    or v->'currency' not in('"EUR"'::jsonb,'"USD"'::jsonb,'"GBP"'::jsonb)
    or v->'contractorRole' not in('"principal"'::jsonb,'"subcontractor"'::jsonb) then return false; end if;
  if not public.estimate_offer_identity_valid(jsonb_build_object('schemaVersion',1,
    'version',jsonb_build_object('id',v->'id','tenantId',v->'tenantId','projectId',v->'projectId','contentRevision',v->'contentRevision'),
    'project',value->'project','issuer',value->'issuer','company',value->'company')) then return false; end if;
  totals:=value->'totals';
  if not public.estimate_offer_keys(totals,array['grossHtCents','commercialDiscountCents','discountIntent','commercialRoundingCents',
    'netHtCents','taxByRate','taxCents','payableTtcCents','reverseCharge']) then return false; end if;
  foreach k in array array['grossHtCents','commercialDiscountCents','commercialRoundingCents','netHtCents','taxCents','payableTtcCents'] loop
    if not public.estimate_offer_number(totals->k,0,2147483647) then return false; end if;
  end loop;
  if jsonb_typeof(totals->'reverseCharge') is distinct from 'boolean' or jsonb_typeof(totals->'taxByRate') is distinct from 'array' then return false; end if;
  reverse_charge:=(totals->>'reverseCharge')::boolean;
  gross:=(totals->>'grossHtCents')::numeric; discount:=(totals->>'commercialDiscountCents')::numeric;
  rounding:=(totals->>'commercialRoundingCents')::numeric; net:=(totals->>'netHtCents')::numeric;
  if reverse_charge is distinct from (v->>'contractorRole'='subcontractor') or net<>gross-discount-rounding then return false; end if;
  intent:=totals->'discountIntent';
  if intent->'kind'='"rate"'::jsonb then
    if not public.estimate_offer_keys(intent,array['kind','rateBp']) or not public.estimate_offer_number(intent->'rateBp',1,10000)
      or discount<>least(div(2*gross*(intent->>'rateBp')::numeric+10000,20000),gross) then return false; end if;
  elsif intent->'kind' in('"none"'::jsonb,'"amount"'::jsonb) then
    if not public.estimate_offer_keys(intent,array['kind']) or (intent->'kind'='"none"'::jsonb and discount<>0) or discount>gross then return false; end if;
  else return false; end if;
  rows_value:=value->'rows';
  if jsonb_typeof(rows_value) is distinct from 'array' then return false; end if;
  portions:=layout->>'priceMode'='fo_mo_and_total';
  for row_value in select * from jsonb_array_elements(rows_value) loop
    required:=array['kind','id','parentId','position','depth','title','saleHtCents'];
    optional:='{}'::text[];
    if row_value->>'kind'='section' then required:=required||array['number'];
    elsif row_value->>'kind'='line' then
      required:=required||array['quantity','unitCode','unitLabel','pricingStatus','taxRateBp','unitSaleHtCents'];
      -- TI-539: optional POSE SEULE mention of a line; when present it is exactly true.
      optional:=array['poseOnly'];
      if row_value ? 'poseOnly' and row_value->'poseOnly' is distinct from 'true'::jsonb then return false; end if;
    else return false; end if;
    if portions then required:=required||array['foSaleHtCents','moSaleHtCents']; end if;
    if not public.estimate_offer_keys(row_value,required,optional) or not public.estimate_offer_uuid(row_value->'id')
      or not public.estimate_offer_uuid(row_value->'parentId',true) or not public.estimate_offer_text(row_value->'title')
      or not public.estimate_offer_number(row_value->'position',0,2147483647)
      or not public.estimate_offer_number(row_value->'depth',0,case when row_value->>'kind'='section' then 3 else 4 end)
      or not public.estimate_offer_number(row_value->'saleHtCents',0,2147483647) then return false; end if;
    if row_value->>'kind'='section' then
      if not public.estimate_offer_text(row_value->'number') then return false; end if;
    else
      if not public.estimate_offer_number(row_value->'quantity',0,999999999.999,false)
        or not public.estimate_offer_number(row_value->'taxRateBp',0,10000)
        or row_value->'pricingStatus' not in('"priced"'::jsonb,'"included"'::jsonb,'"for_memory"'::jsonb,'"not_priced"'::jsonb,
          '"out_of_scope"'::jsonb,'"not_applicable"'::jsonb)
        or not (row_value->'unitCode'='null'::jsonb or (jsonb_typeof(row_value->'unitCode')='string'
          and (row_value->>'unitCode') ~ '^[a-z][a-z0-9]*$' and length(row_value->>'unitCode')<=16))
        or not public.estimate_offer_text(row_value->'unitLabel',true)
        or (row_value->'unitCode'='null'::jsonb) is distinct from (row_value->'unitLabel'='null'::jsonb) then return false; end if;
      quantity:=(row_value->>'quantity')::numeric;
      if trunc(quantity,3)<>quantity then return false; end if;
      if row_value->'pricingStatus'='"priced"'::jsonb then
        if row_value->'unitCode'='null'::jsonb or not public.estimate_offer_number(row_value->'unitSaleHtCents',0,2147483647)
          or (row_value->>'saleHtCents')::numeric<>round(quantity*(row_value->>'unitSaleHtCents')::numeric) then return false; end if;
      elsif row_value->'unitSaleHtCents' is distinct from 'null'::jsonb or (row_value->>'saleHtCents')::numeric<>0 then return false; end if;
    end if;
    if portions and (not public.estimate_offer_number(row_value->'foSaleHtCents',0,2147483647)
      or not public.estimate_offer_number(row_value->'moSaleHtCents',0,2147483647)
      or (row_value->>'foSaleHtCents')::numeric+(row_value->>'moSaleHtCents')::numeric<>(row_value->>'saleHtCents')::numeric) then return false; end if;
  end loop;
  if (select count(*) from jsonb_array_elements(rows_value))<>(select count(distinct r->>'id') from jsonb_array_elements(rows_value)r) then return false; end if;
  -- Build only after rejecting duplicate IDs: no last-write-wins semantics.
  select jsonb_object_agg(r->>'id',r) into row_index from jsonb_array_elements(rows_value)r;
  for row_value in select * from jsonb_array_elements(rows_value) loop
    if row_value->'parentId'='null'::jsonb then
      if row_value->'depth'<>'0'::jsonb then return false; end if;
    else
      part:=row_index->(row_value->>'parentId');
      if part is null or part->>'kind'<>'section' or (row_value->>'depth')::integer<>(part->>'depth')::integer+1 then return false; end if;
    end if;
  end loop;
  -- Bounded strictly increasing parent depth excludes cycles (same tree rule as contract 1).
  select coalesce(sum((r->>'saleHtCents')::numeric),0) into row_sum from jsonb_array_elements(rows_value)r where r->>'kind'='line';
  if row_sum<>gross then return false; end if;
  for row_value in select r from jsonb_array_elements(rows_value)r where r->>'kind'='section' loop
    with recursive descendants(descendant_value) as (
      select r from jsonb_array_elements(rows_value)r where r->'parentId'=row_value->'id'
      union all select r from jsonb_array_elements(rows_value)r join descendants d on r->'parentId'=d.descendant_value->'id'
    ) select coalesce(sum((descendant_value->>'saleHtCents')::numeric),0),
      coalesce(sum((descendant_value->>'foSaleHtCents')::numeric),0),coalesce(sum((descendant_value->>'moSaleHtCents')::numeric),0)
      into section_sum,section_fo,section_mo from descendants where descendant_value->>'kind'='line';
    if section_sum<>(row_value->>'saleHtCents')::numeric or (portions and
      (section_fo<>(row_value->>'foSaleHtCents')::numeric or section_mo<>(row_value->>'moSaleHtCents')::numeric)) then return false; end if;
  end loop;
  for tax_value in select r from jsonb_array_elements(totals->'taxByRate') with ordinality t(r,n) order by n loop
    if not public.estimate_offer_keys(tax_value,array['rateBp','baseHtCents','taxCents'])
      or not public.estimate_offer_number(tax_value->'rateBp',0,10000)
      or not public.estimate_offer_number(tax_value->'baseHtCents',0,2147483647)
      or not public.estimate_offer_number(tax_value->'taxCents',0,2147483647)
      or (previous_rate is not null and (tax_value->>'rateBp')::numeric<=previous_rate)
      or (tax_value->>'baseHtCents')::numeric>(select coalesce(sum((r->>'saleHtCents')::numeric),0) from jsonb_array_elements(rows_value)r
        where r->>'kind'='line' and r->'pricingStatus'='"priced"'::jsonb and (r->>'taxRateBp')::numeric=(tax_value->>'rateBp')::numeric)
      or (tax_value->>'taxCents')::numeric<>(case when reverse_charge then 0
        else div(2*(tax_value->>'baseHtCents')::numeric*(tax_value->>'rateBp')::numeric+10000,20000) end) then return false; end if;
    previous_rate:=(tax_value->>'rateBp')::numeric;
    base_sum:=base_sum+(tax_value->>'baseHtCents')::numeric;
    tax_sum:=tax_sum+(tax_value->>'taxCents')::numeric;
  end loop;
  if array(select (r->>'rateBp')::numeric from jsonb_array_elements(totals->'taxByRate') with ordinality t(r,n) order by n)
      is distinct from array(select distinct (r->>'taxRateBp')::numeric from jsonb_array_elements(rows_value)r
        where r->>'kind'='line' and r->'pricingStatus'='"priced"'::jsonb order by 1)
    or base_sum<>net or tax_sum<>(totals->>'taxCents')::numeric
    or (totals->>'payableTtcCents')::numeric<>net+(totals->>'taxCents')::numeric then return false; end if;
  return true;
exception when others then return false;
end;
$$;

create or replace function public.estimate_offer_client_items_match_v2(snapshot jsonb,version public.estimate_versions)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare totals jsonb; context jsonb; expected_intent jsonb; expected_tax jsonb;
begin
  if version.id is null or version.calc_engine_version is distinct from 3
    or version.calc_snapshot_content_revision is distinct from version.content_revision
    or version.calc_snapshot_context is null or version.calc_snapshot_context->'engine' is distinct from '3'::jsonb
    or jsonb_typeof(snapshot->'rows') is distinct from 'array' or jsonb_typeof(snapshot->'totals') is distinct from 'object' then
    return false;
  end if;
  if (select count(*) from jsonb_array_elements(snapshot->'rows'))
      <>(select count(*) from public.estimate_items i where i.version_id=version.id and i.tenant_id=version.tenant_id)
    or exists(
      select 1 from jsonb_array_elements(snapshot->'rows')r
      left join public.estimate_items i on i.id=(r->>'id')::uuid and i.version_id=version.id and i.tenant_id=version.tenant_id
      left join public.measurement_units unit on unit.code=i.unit_code
      where i.id is null or r->>'kind' is distinct from i.item_type::text
        or r->'parentId' is distinct from coalesce(to_jsonb(i.parent_id),'null'::jsonb)
        or (r->>'position')::integer is distinct from i.position
        or r->>'title' is distinct from coalesce(nullif(public.estimate_offer_trim(i.title),''),'Sans titre')
        -- TI-539: the POSE SEULE mention follows the nature of the frozen line, neither invented nor forgotten.
        or (r ? 'poseOnly') is distinct from (i.item_type='line' and i.line_nature::text is not distinct from 'pose_only')
        or (i.item_type='line' and ((r->>'quantity')::numeric is distinct from i.quantity
          or r->'unitCode' is distinct from coalesce(to_jsonb(i.unit_code),'null'::jsonb)
          or r->'unitLabel' is distinct from coalesce(to_jsonb(unit.symbol),'null'::jsonb)
          or r->>'pricingStatus' is distinct from i.pricing_status::text
          or (r->>'taxRateBp')::integer is distinct from i.tax_rate_bp
          or i.snapshot_gross_ht_cents is null or i.snapshot_gross_fo_ht_cents is null
          or i.snapshot_fo_ht_cents is null or i.snapshot_mo_ht_cents is null
          or i.snapshot_mo_atelier_ht_cents is null or i.snapshot_mo_chantier_ht_cents is null
          or i.line_total_ht_cents is null or i.line_tax_cents is null or i.line_total_ttc_cents is null
          or (i.pricing_status='priced'::public.estimate_line_pricing_status and i.snapshot_pu_ht_cents is null)
          or r->'unitSaleHtCents' is distinct from coalesce(to_jsonb(i.snapshot_pu_ht_cents),'null'::jsonb)
          or (r->>'saleHtCents')::bigint is distinct from i.snapshot_gross_ht_cents::bigint
          or (r ? 'foSaleHtCents' and ((r->>'foSaleHtCents')::bigint is distinct from i.snapshot_gross_fo_ht_cents::bigint
            or (r->>'moSaleHtCents')::bigint is distinct from i.snapshot_gross_ht_cents::bigint-i.snapshot_gross_fo_ht_cents::bigint))))
    ) then
    return false;
  end if;
  -- Ordre canonique et numéros de section ; un élément hors de l'arbre parcouru depuis les racines n'a pas de rang.
  if exists(
    with recursive sibling as (
      select i.id,i.parent_id,i.item_type,row_number() over (partition by i.parent_id order by i.position,i.id) as ordinal
      from public.estimate_items i where i.version_id=version.id and i.tenant_id=version.tenant_id
    ), tree(id,item_type,path,number) as (
      select s.id,s.item_type,array[s.ordinal],case when s.ordinal<10 then '0'||s.ordinal::text else s.ordinal::text end
      from sibling s where s.parent_id is null
      union all
      select s.id,s.item_type,t.path||s.ordinal,t.number||'.'||s.ordinal::text from sibling s join tree t on s.parent_id=t.id
    ), canonical as (
      select t.id,t.item_type,t.number,row_number() over (order by t.path) as ordinal from tree t
    )
    select 1 from canonical c
    full join jsonb_array_elements(snapshot->'rows') with ordinality r(value,ordinal) on r.ordinal=c.ordinal
    where c.id is null or r.value is null or (r.value->>'id')::uuid is distinct from c.id
      or (c.item_type='section' and r.value->'number' is distinct from to_jsonb(c.number))
  ) then
    return false;
  end if;
  totals:=snapshot->'totals';
  context:=version.calc_snapshot_context;
  expected_intent:=case when context->'discount'->>'kind'='rate'
    then jsonb_build_object('kind','rate','rateBp',context->'discount'->'rate_bp')
    else jsonb_build_object('kind',context->'discount'->'kind') end;
  select coalesce(jsonb_agg(jsonb_build_object('rateBp',entry.value->'rate_bp','baseHtCents',entry.value->'base_cents',
      'taxCents',entry.value->'tax_cents') order by entry.ordinality),'[]'::jsonb)
    into expected_tax
  from jsonb_array_elements(context->'tax_breakdown') with ordinality entry(value,ordinality);
  return coalesce((totals->>'grossHtCents')::bigint=version.gross_ht_cents::bigint
    and (totals->>'commercialDiscountCents')::bigint=version.discount_applied_cents::bigint
    and (totals->>'commercialRoundingCents')::bigint=version.commercial_rounding_cents::bigint
    and (totals->>'netHtCents')::bigint=version.total_ht_cents::bigint
    and (totals->>'taxCents')::bigint=version.total_tax_cents::bigint
    and (totals->>'payableTtcCents')::bigint=version.total_ttc_cents::bigint
    and coalesce(version.rounding_adjustment_cents,0)=0
    and totals->'reverseCharge'=to_jsonb(version.contractor_role='subcontractor')
    and totals->'discountIntent'=expected_intent
    and totals->'taxByRate'=expected_tax,false);
exception when others then return false;
end;
$$;

-- 5. A duplicated version or a variant keeps the nature of each line. The copy listed every column but this one,
--    so the normalisation trigger re-derived it: a POSE SEULE line came back as labor_only and its mention left
--    the copied quote without a trace. Same body as 20261109183432_estimate_fo_price_origin.sql, plus the column.
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
    product_id,
    line_nature -- TI-539 (ajout) : la copie garde la nature choisie de chaque ligne
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
    case when source_is_v3 then src.product_id end,
    src.line_nature -- TI-539 (ajout)
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
    decided_by,
    quantity_snapshot
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
    src.decided_by,
    src.quantity_snapshot
  from public.takeoff_dpgf_review_decisions src
  where src.version_id = duplicate_estimate_version_without_product_id.source_version_id;

  return new_version_id;
end;
$function$;

commit;
