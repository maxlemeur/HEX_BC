-- Validate full-volume PDF contracts without scanning the entire rows array for every parent.
-- Keep every existing type, identity, hierarchy, amount, tax and section invariant.
-- CREATE OR REPLACE preserves the function ACL and signature.
create or replace function public.estimate_offer_client_valid_v2(value jsonb,layout jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare v jsonb; totals jsonb; intent jsonb; row_value jsonb; rows_value jsonb; row_index jsonb; part jsonb; tax_value jsonb; required text[];
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
    if row_value->>'kind'='section' then required:=required||array['number'];
    elsif row_value->>'kind'='line' then required:=required||array['quantity','unitCode','unitLabel','pricingStatus','taxRateBp','unitSaleHtCents'];
    else return false; end if;
    if portions then required:=required||array['foSaleHtCents','moSaleHtCents']; end if;
    if not public.estimate_offer_keys(row_value,required) or not public.estimate_offer_uuid(row_value->'id')
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
