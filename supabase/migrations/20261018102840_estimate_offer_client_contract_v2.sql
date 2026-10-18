-- Lot 2, sous-lot 2.7 (M5) : contrat client 2 et émission v3.
-- Conception : docs/audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md (F1 à F3, D7, D8, D14,
-- D15, §6.1 « M5 », §6.4 point 3, §7 fonctions d'offre) ; contrat et preuves :
-- docs/testing/estimate-engine-v3-2.7.md et supabase/tests/database/estimate-offer-contract-v2.test.sql.
--
-- Après cette migration :
--   - estimate_documents_client_contract_pair_check admet (2, copie non nulle) ; l'appariement
--     moteur ⇔ contrat client est une règle unique, public.estimate_offer_engine_client_contract :
--     v3 ⇔ contrat 2, v1/v2 ⇔ contrat 1 (ou document historique sans contrat) ;
--   - public.estimate_offer_client_valid_v2 (forme stricte et invariants de ClientContract2, D14) et
--     public.estimate_offer_client_items_match_v2 (lignes, pied et contexte figés d'une v3 au gel frais) ;
--   - les fonctions d'offre aiguillent sur le contrat : la branche du contrat 1 garde son comportement
--     (mêmes conditions, mêmes refus nommés), le contrat 2 suit les mêmes ancres, le même
--     marqueur de sceau 5 et les mêmes refus ;
--   - public.freeze_estimate_v3_document_snapshot : gel documentaire v3 sous le bail exact de la page,
--     jumeau de freeze_estimate_v2_document_snapshot (D15) autour de freeze_estimate_v3_snapshot('send')
--     (recalcul complet par private.estimate_v3_compute, égalité stricte) ;
--   - les refus d'émission v3 de M1 (ESTIMATE_V3_EMISSION_NOT_READY) sont levés : un document de v3
--     exige le contrat 2 (OFFER_CLIENT_CONTRACT_ENGINE_MISMATCH, OFFER_NEW_DOCUMENT_CONTRACT_REQUIRED),
--     le passage à sending/sent d'une v3 suit la gouvernance v2 héritée (ESTIMATE_V2_SNAPSHOT_STALE,
--     ESTIMATE_V2_SNAPSHOT_INVALID) ; restent refusés par leur nom : le contrat 1 pour une v3 (et le
--     contrat 2 pour une v1/v2), un document historique sans contrat pour une v3, le gel v2
--     (ESTIMATE_V2_SNAPSHOT_REQUIRES_DRAFT) et l'appariement du contrat 1 (faux hors {1,2}, M1).
--
-- Les fonctions redéfinies partent de leur définition vivante (20261013130248 pour les fonctions
-- d'offre, 20261017113844 pour require_fresh_v2_snapshot_for_publication et
-- guard_estimate_document_engine_v3, aucune redéfinition postérieure) ; seules les lignes du contrat 2
-- changent. Toutes restent security invoker, search_path vide, mêmes droits (service_role ; aucune
-- exécution pour anon ni authenticated). Le contrat 1, ses validateurs (estimate_offer_client_valid,
-- estimate_offer_client_items_match) et les charges de sceau 1 à 4 ne changent pas. Aucune colonne
-- n'est ajoutée ; aucune ligne n'est réécrite (D17).

do $preflight$
begin
  if to_regprocedure('public.freeze_estimate_v3_snapshot(uuid,uuid,timestamptz,bigint,uuid,text,jsonb,jsonb,jsonb)') is null
    or to_regprocedure('public.freeze_estimate_v2_document_snapshot(uuid,uuid,timestamptz,bigint,uuid,uuid,jsonb,jsonb,jsonb)') is null
    or to_regprocedure('public.guard_estimate_document_engine_v3()') is null
    or to_regclass('public.measurement_units') is null then
    raise exception 'LOT2_2_7_PREFLIGHT: M1, M3 and M4 (20261017113844, 20261017134443, 20261017162000) must be applied first';
  end if;
  if to_regprocedure('public.estimate_offer_client_valid_v2(jsonb,jsonb)') is not null
    or to_regprocedure('public.estimate_offer_client_items_match_v2(jsonb,public.estimate_versions)') is not null
    or to_regprocedure('public.freeze_estimate_v3_document_snapshot(uuid,uuid,timestamptz,bigint,uuid,uuid,jsonb,jsonb,jsonb)') is not null
    or to_regprocedure('public.estimate_offer_engine_client_contract(smallint)') is not null then
    raise exception 'LOT2_2_7_PREFLIGHT: a client contract 2 object already exists';
  end if;
  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.estimate_documents'::regclass
      and constraint_row.conname = 'estimate_documents_client_contract_pair_check'
      and pg_get_constraintdef(constraint_row.oid) = 'CHECK ((((client_contract_version IS NULL) AND (client_contract_snapshot IS NULL)) OR ((client_contract_version IS NOT NULL) AND (client_contract_version = 1) AND (client_contract_snapshot IS NOT NULL))))'
  ) then
    raise exception 'LOT2_2_7_PREFLIGHT: the client contract pair CHECK differs from the reviewed definition';
  end if;
  -- M1 refusait tout document de v3 : l'appariement se pose sans rien réécrire (D17).
  if exists (
    select 1
    from public.estimate_documents document
    join public.estimate_versions version on version.id = document.version_id
    where version.calc_engine_version = 3
  ) then
    raise exception 'LOT2_2_7_PREFLIGHT: a document already belongs to an engine 3 version';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Paire de contrat (D14) et règle d'appariement moteur ⇔ contrat client.
-- ---------------------------------------------------------------------------
alter table public.estimate_documents
  drop constraint estimate_documents_client_contract_pair_check;
alter table public.estimate_documents
  add constraint estimate_documents_client_contract_pair_check
  check((client_contract_version is null and client_contract_snapshot is null)
    or (client_contract_version is not null and client_contract_version in(1,2) and client_contract_snapshot is not null))
  not valid;
alter table public.estimate_documents
  validate constraint estimate_documents_client_contract_pair_check;

create function public.estimate_offer_engine_client_contract(p_calc_engine_version smallint)
returns smallint
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_calc_engine_version = 3 then 2::smallint
    when p_calc_engine_version in (1, 2) then 1::smallint
  end;
$$;

comment on function public.estimate_offer_engine_client_contract(smallint) is
  'Client contract required by a calculation engine (D14): engine 3 <=> contract 2, engines 1 and 2 <=> contract 1 (or a historical document without contract); NULL otherwise.';

revoke all on function public.estimate_offer_engine_client_contract(smallint) from public, anon, authenticated;
grant execute on function public.estimate_offer_engine_client_contract(smallint) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Contrat client 2 (D14) : forme stricte, réservée au moteur 3, mêmes blocs version, project,
-- issuer, company et mêmes validateurs que le contrat 1 ; lignes et sections en brut, pied v3.
-- Invariants (tous au centime, décimal exact) : ligne chiffrée PT = ⌈Q × PU⌋, unité au format du
-- référentiel ; ligne non chiffrée sans PU ni montant ; section = Σ de ses lignes ; Σ lignes = brut ;
-- net = brut − remise − arrondi ; remise conforme à l'intention (aucune : 0 ; taux : min(⌈G × bp⌋, G) ;
-- montant : ≤ G) ; taxByRate strictement croissant, taux = taux des lignes chiffrées, Σ bases = net,
-- base d'un taux ≤ brut chiffré de ce taux, TVA d'un taux = ⌈base × taux⌋ (0 en autoliquidation),
-- Σ TVA = TVA ; TTC = net + TVA ; autoliquidation ⇔ sous-traitance. Parts FO/MO présentes ⇔ mode
-- fo_mo_and_total, FO + MO = brut. Toute autre clé, tout autre type ou toute erreur : faux.
-- ---------------------------------------------------------------------------
create function public.estimate_offer_client_valid_v2(value jsonb,layout jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare v jsonb; totals jsonb; intent jsonb; row_value jsonb; rows_value jsonb; part jsonb; tax_value jsonb; required text[];
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
  for row_value in select * from jsonb_array_elements(rows_value) loop
    if row_value->'parentId'='null'::jsonb then
      if row_value->'depth'<>'0'::jsonb then return false; end if;
    else
      select r into part from jsonb_array_elements(rows_value)r where r->'id'=row_value->'parentId';
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

comment on function public.estimate_offer_client_valid_v2(jsonb,jsonb) is
  'Strict client contract 2 validator (D14), engine 3 only: exact keys, contract 1 version/project/issuer/company blocks, gross rows (PT = round(Q x PU)), v3 footer (discount intent, commercial rounding, VAT by rate on the net base, TTC = net + VAT). False on any other key, type or invariant.';

-- Appariement exact du contrat 2 au devis figé : lignes ⇔ lignes stockées (identité et titre comme au
-- contrat 1, quantité, unité du référentiel et son symbole, statut, taux, PU et brut figés, parts FO/MO
-- brutes), pied ⇔ version (brut, remise, arrondi, net, TVA, TTC, autoliquidation) et contexte figé
-- (intention de remise, récapitulatif de TVA) ; moteur 3 au gel frais seulement.
create function public.estimate_offer_client_items_match_v2(snapshot jsonb,version public.estimate_versions)
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

comment on function public.estimate_offer_client_items_match_v2(jsonb,public.estimate_versions) is
  'Exact match of a client contract 2 to a freshly frozen v3 (D14): rows to stored lines (unit code and referential symbol, status, VAT rate, frozen PU and gross, gross FO/MO parts), footer to the version totals and to the frozen context (discount intent, VAT by rate). False for any other engine, a stale freeze or any difference.';

revoke all on function public.estimate_offer_client_valid_v2(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.estimate_offer_client_valid_v2(jsonb,jsonb) to service_role;
revoke all on function public.estimate_offer_client_items_match_v2(jsonb,public.estimate_versions) from public, anon, authenticated;
grant execute on function public.estimate_offer_client_items_match_v2(jsonb,public.estimate_versions) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Fonctions d'offre aiguillées par contrat (définitions vivantes de 20261013130248) et
-- appariement des documents (remplace le refus de M1, §6.4 point 3).
-- ---------------------------------------------------------------------------

create or replace function public.estimate_offer_document_valid(document public.estimate_documents,version public.estimate_versions,allow_legacy boolean default false)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare expected_path text; prefix text; filename text; snapshot jsonb;
begin
  if document.id is null or document.tenant_id is distinct from version.tenant_id or document.version_id is distinct from version.id
    or document.status<>'ready' or document.generation_token is not null or document.sha256_hash !~ '^[0-9a-f]{64}$'
    or document.sha256_hash is null or document.published_content_revision is distinct from version.content_revision
    or not public.estimate_offer_layout_valid(document.layout_options) or not public.estimate_offer_terms_valid(document.terms_snapshot)
    or ((document.layout_options->>'includeTerms')::boolean and (document.terms_snapshot is null or document.terms_snapshot='null'::jsonb))
    or document.published_purpose is null or document.published_purpose not in('legacy','manual','email','workflow')
    or (document.file_size_bytes is not null and (document.file_size_bytes<=0 or document.file_size_bytes>9007199254740991))
    or (document.generated_at is not null and not public.estimate_offer_instant(to_jsonb(to_char(document.generated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))) then return false; end if;
  expected_path:=version.tenant_id||'/'||version.project_id||'/'||version.id||'/'||document.sha256_hash||'.pdf';
  if document.client_contract_version is null then
    if not allow_legacy or document.client_contract_snapshot is not null or version.seal_payload_version=5
      or public.estimate_offer_engine_client_contract(version.calc_engine_version) is distinct from 1
      or not (document.layout_options->>'includeTerms')::boolean or document.terms_snapshot is null or document.terms_snapshot='null'::jsonb then return false; end if;
    prefix:=version.tenant_id||'/'||version.project_id||'/'; filename:=substring(document.file_path from length(prefix)+1);
    return coalesce(document.file_path=expected_path or (document.published_purpose='legacy' and left(document.file_path,length(prefix))=prefix
      and length(filename)>4 and position('/' in filename)=0 and right(filename,4)='.pdf'),false);
  end if;
  if document.client_contract_version is distinct from public.estimate_offer_engine_client_contract(version.calc_engine_version)
    or document.file_path is distinct from expected_path or document.published_purpose not in('manual','email','workflow')
    or document.published_purpose is null or document.file_size_bytes is null or document.file_size_bytes<=0 or document.file_size_bytes>9007199254740991
    or document.generated_at is null or document.generated_by is null or document.published_generation_token is null
    or (document.published_purpose='email') is distinct from (document.published_dispatch_id is not null)
    or not (case document.client_contract_version when 2
      then public.estimate_offer_client_valid_v2(document.client_contract_snapshot,document.layout_options)
      else public.estimate_offer_client_valid(document.client_contract_snapshot,document.layout_options) end) then return false; end if;
  snapshot:=document.client_contract_snapshot;
  return coalesce(snapshot->'version'->>'id'=version.id::text and snapshot->'version'->>'tenantId'=version.tenant_id::text
    and snapshot->'version'->>'projectId'=version.project_id::text and (snapshot->'version'->>'contentRevision')::bigint=version.content_revision
    and snapshot->'issuer'->>'userId'=document.generated_by::text,false);
exception when others then return false;
end;
$$;

-- M1 refusait tout document d'une v3 (ESTIMATE_V3_EMISSION_NOT_READY). M5 le remplace par
-- l'appariement : toute ligne de document qui porte un contrat client porte celui de son moteur
-- (v3 ⇔ 2, v1/v2 ⇔ 1). Une réclamation ou un échec sans contrat reste admis pour tout moteur ; le
-- passage à ready exige le contrat (guard_estimate_offer_document).
create or replace function public.guard_estimate_document_engine_v3()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.client_contract_version is not null and exists (
    select 1
    from public.estimate_versions version
    where version.id = new.version_id
      and public.estimate_offer_engine_client_contract(version.calc_engine_version)
        is distinct from new.client_contract_version
  ) then
    raise exception using
      errcode = '23514',
      message = 'OFFER_CLIENT_CONTRACT_ENGINE_MISMATCH';
  end if;

  return new;
end;
$$;

create or replace function public.guard_estimate_offer_document()
returns trigger language plpgsql security invoker set search_path='' as $$
declare version public.estimate_versions;
begin
  if tg_op='DELETE' then
    select * into version from public.estimate_versions where id=old.version_id;
    if version.status in('sent','accepted','archived') or (old.client_contract_version in(1,2) and version.status='sending' and version.seal_hash is not null) then
      raise exception using errcode='42501',message='OFFER_DOCUMENT_IMMUTABLE';
    end if;
    return old;
  end if;
  select * into version from public.estimate_versions where id=new.version_id;
  if new.status='ready' and (tg_op='INSERT' or (tg_op='UPDATE' and old.status<>'ready'))
    and new.client_contract_version is distinct from public.estimate_offer_engine_client_contract(version.calc_engine_version) then
    raise exception using errcode='23514',message='OFFER_NEW_DOCUMENT_CONTRACT_REQUIRED';
  end if;
  if tg_op='UPDATE' and old.status='ready' and version.status in('sent','accepted','archived')
    and (to_jsonb(new)-array['updated_at']) is distinct from (to_jsonb(old)-array['updated_at']) then
    raise exception using errcode='42501',message='OFFER_DOCUMENT_IMMUTABLE';
  end if;
  if tg_op='UPDATE' and old.client_contract_version in(1,2) then
    if new.version_id is distinct from old.version_id or new.tenant_id is distinct from old.tenant_id then
      raise exception using errcode='42501',message='OFFER_DOCUMENT_IMMUTABLE';
    end if;
    if (version.status in('sent','accepted','archived') or (version.status='sending' and version.seal_hash is not null))
      and (to_jsonb(new)-array['updated_at']) is distinct from (to_jsonb(old)-array['updated_at']) then
      raise exception using errcode='42501',message='OFFER_DOCUMENT_IMMUTABLE';
    end if;
    if version.status='draft' and old.status='ready' and new.status='ready'
      and (to_jsonb(new)-array['updated_at']) is distinct from (to_jsonb(old)-array['updated_at']) then
      raise exception using errcode='42501',message='OFFER_DOCUMENT_PUBLICATION_CLAIM_REQUIRED';
    end if;
    if new.client_contract_version is distinct from old.client_contract_version or new.client_contract_snapshot is null then
      raise exception using errcode='42501',message='OFFER_DOCUMENT_DOWNGRADE_FORBIDDEN';
    end if;
  end if;
  if new.status='ready' and new.client_contract_version in(1,2) and not public.estimate_offer_document_valid(new,version,false) then
    raise exception using errcode='23514',message='OFFER_DOCUMENT_CONTRACT_INVALID';
  end if;
  if new.status='ready' and new.client_contract_version in(1,2) and (tg_op='INSERT'
    or (tg_op='UPDATE' and (old.status<>'processing' or old.generation_token is null)
      and (to_jsonb(new)-array['updated_at']) is distinct from (to_jsonb(old)-array['updated_at']))) then
    raise exception using errcode='42501',message='OFFER_DOCUMENT_PUBLICATION_CLAIM_REQUIRED';
  end if;
  return new;
end;
$$;

create or replace function public.publish_estimate_pdf_generation(
  p_version_id uuid,p_tenant_id uuid,p_actor_user_id uuid,p_generation_token uuid,p_file_path text,p_sha256_hash text,
  p_file_size_bytes bigint,p_generated_at timestamptz,p_layout_options jsonb,p_terms_snapshot jsonb,p_client_contract_snapshot jsonb
) returns public.estimate_documents language plpgsql security invoker set search_path='' as $$
declare version public.estimate_versions; document public.estimate_documents; dispatch public.estimate_emails;
  published public.estimate_documents; expected_path text; identity_snapshot jsonb; snapshot_version jsonb; contract_version smallint;
begin
  if current_user<>'service_role' then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  if p_generation_token is null or p_sha256_hash is null or p_sha256_hash !~ '^[0-9a-f]{64}$' or p_file_size_bytes is null
    or p_file_size_bytes<=0 or p_file_size_bytes>9007199254740991 or p_generated_at is null or not isfinite(p_generated_at)
    or not (case when p_client_contract_snapshot->'schemaVersion'='2'::jsonb
      then public.estimate_offer_client_valid_v2(p_client_contract_snapshot,p_layout_options)
      else public.estimate_offer_client_valid(p_client_contract_snapshot,p_layout_options) end)
    or not public.estimate_offer_terms_valid(p_terms_snapshot)
    or ((p_layout_options->>'includeTerms')::boolean and (p_terms_snapshot is null or p_terms_snapshot='null'::jsonb)) then
    raise exception using errcode='22023',message='ESTIMATE_PDF_PUBLICATION_INVALID';
  end if;
  -- Valid contracts carry schemaVersion 1 or 2 exactly; v3 <=> contract 2 is anchored below.
  contract_version:=case when p_client_contract_snapshot->'schemaVersion'='2'::jsonb then 2 else 1 end;
  select v.* into version from public.estimate_versions v where v.id=p_version_id and v.tenant_id=p_tenant_id for update;
  if version.id is null then raise exception using errcode='P0001',message='ESTIMATE_VERSION_NOT_FOUND'; end if;
  perform public.assert_estimate_offer_actor(p_tenant_id,p_version_id,p_actor_user_id);
  select d.* into document from public.estimate_documents d where d.version_id=p_version_id and d.tenant_id=p_tenant_id for update;
  if document.id is null then raise exception using errcode='P0001',message='ESTIMATE_PDF_GENERATION_NOT_FOUND'; end if;
  expected_path:=p_tenant_id||'/'||version.project_id||'/'||p_version_id||'/'||p_sha256_hash||'.pdf';
  if p_file_path is distinct from expected_path then raise exception using errcode='23514',message='ESTIMATE_PDF_PATH_INVALID'; end if;
  snapshot_version:=p_client_contract_snapshot->'version';
  if snapshot_version is distinct from jsonb_build_object('id',version.id,'tenantId',version.tenant_id,'projectId',version.project_id,
    'number',version.version_number,'contentRevision',version.content_revision,'calcEngineVersion',version.calc_engine_version,
    'dateDevis',version.date_devis,'validiteJours',version.validite_jours,'currency',version.currency,
    'contractorRole',version.contractor_role,'taxRateBp',version.tax_rate_bp)
    or p_client_contract_snapshot->'exclusions' is distinct from coalesce(to_jsonb(version.exclusions),'null'::jsonb)
    or p_client_contract_snapshot->'issuer'->>'userId' is distinct from p_actor_user_id::text
    or contract_version is distinct from public.estimate_offer_engine_client_contract(version.calc_engine_version)
    or (contract_version=1 and (public.estimate_offer_client_items_match(p_client_contract_snapshot,version) is distinct from true
    or (p_client_contract_snapshot->'totals'->>'saleHtCents')::bigint is distinct from version.total_ht_cents::bigint
    or (p_client_contract_snapshot->'totals'->>'payableTtcCents')::bigint is distinct from version.total_ttc_cents::bigint
    or (p_client_contract_snapshot->'totals'->>'roundingAdjustmentCents')::bigint is distinct from coalesce(version.rounding_adjustment_cents,0)::bigint
    or (p_client_contract_snapshot->'totals'->>'taxCents')::bigint is distinct from (version.total_tax_cents-coalesce(version.rounding_adjustment_cents,0))::bigint))
    or (contract_version=2 and public.estimate_offer_client_items_match_v2(p_client_contract_snapshot,version) is distinct from true) then
    raise exception using errcode='23514',message='OFFER_CLIENT_CONTRACT_ANCHOR_MISMATCH';
  end if;
  if document.generation_token is distinct from p_generation_token then
    if document.generation_token is null and document.published_generation_token=p_generation_token and document.status='ready'
      and document.client_contract_version=contract_version and document.file_path=p_file_path and document.sha256_hash=p_sha256_hash
      and document.file_size_bytes=p_file_size_bytes and document.generated_at=p_generated_at and document.generated_by=p_actor_user_id
      and document.layout_options=p_layout_options and document.terms_snapshot is not distinct from p_terms_snapshot
      and document.client_contract_snapshot=p_client_contract_snapshot and document.published_content_revision=version.content_revision
      and public.estimate_offer_document_valid(document,version,false) then return document; end if;
    raise exception using errcode='40001',message='ESTIMATE_PDF_GENERATION_SUPERSEDED';
  end if;
  if document.generated_by is distinct from p_actor_user_id or document.generation_content_revision is distinct from version.content_revision then
    raise exception using errcode='40001',message='ESTIMATE_PDF_GENERATION_SUPERSEDED';
  end if;
  if document.generation_purpose in('manual','workflow') then
    if version.status<>'draft' or document.generation_dispatch_id is not null then raise exception using errcode='40001',message='ESTIMATE_PDF_GENERATION_SUPERSEDED'; end if;
    identity_snapshot:=public.capture_estimate_offer_identity(version,p_actor_user_id,p_client_contract_snapshot->'company');
  elsif document.generation_purpose='email' then
    if version.status<>'sending' then raise exception using errcode='40001',message='ESTIMATE_PDF_GENERATION_SUPERSEDED'; end if;
    select e.* into dispatch from public.estimate_emails e where e.id=document.generation_dispatch_id and e.tenant_id=p_tenant_id
      and e.version_id=p_version_id and e.created_by=p_actor_user_id for update;
    if dispatch.id is null or dispatch.status<>'preparing' or dispatch.version_content_revision is distinct from document.generation_content_revision then
      raise exception using errcode='40001',message='ESTIMATE_PDF_GENERATION_SUPERSEDED';
    end if;
    if dispatch.request_contract_version<>2 or dispatch.offer_identity_snapshot is null then
      raise exception using errcode='40001',message='ESTIMATE_EMAIL_LEGACY_PREPARATION_REQUIRES_RECOVERY';
    end if;
    identity_snapshot:=dispatch.offer_identity_snapshot;
  else raise exception using errcode='40001',message='ESTIMATE_PDF_GENERATION_SUPERSEDED'; end if;
  if identity_snapshot->'project' is distinct from p_client_contract_snapshot->'project'
    or identity_snapshot->'issuer' is distinct from p_client_contract_snapshot->'issuer'
    or identity_snapshot->'company' is distinct from p_client_contract_snapshot->'company' then
    raise exception using errcode='23514',message='OFFER_CLIENT_IDENTITY_MISMATCH';
  end if;
  update public.estimate_documents set status='ready',last_error=null,file_path=expected_path,sha256_hash=p_sha256_hash,
    file_size_bytes=p_file_size_bytes,generated_by=p_actor_user_id,generated_at=p_generated_at,layout_options=p_layout_options,
    terms_snapshot=p_terms_snapshot,client_contract_version=contract_version,client_contract_snapshot=p_client_contract_snapshot,
    published_generation_token=p_generation_token,published_purpose=document.generation_purpose,published_dispatch_id=document.generation_dispatch_id,
    published_content_revision=document.generation_content_revision,generation_token=null,generation_purpose=null,generation_dispatch_id=null,
    generation_content_revision=null,generation_started_at=null where id=document.id and generation_token=p_generation_token returning * into published;
  if published.id is null then raise exception using errcode='40001',message='ESTIMATE_PDF_GENERATION_SUPERSEDED'; end if;
  return published;
end;
$$;

create or replace function public.reserve_estimate_email_dispatch(
  p_version_id uuid,p_tenant_id uuid,p_expected_updated_at timestamptz,p_actor_user_id uuid,
  p_request_id uuid,p_payload_hash text,p_recipient text,p_cc text[],p_subject text,p_body text,p_from_address text,
  p_portal_origin text,p_company_snapshot jsonb
) returns public.estimate_emails language plpgsql security invoker set search_path='' as $$
declare version public.estimate_versions; existing public.estimate_emails; reserved public.estimate_emails;
  document public.estimate_documents; dispatch_id uuid:=gen_random_uuid(); capability_id uuid:=gen_random_uuid();
  capability_token uuid:=gen_random_uuid(); identity_snapshot jsonb; portal_url_value text; expiration timestamptz; frozen boolean;
begin
  if current_user<>'service_role' then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  if p_request_id is null or p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$'
    or length(btrim(coalesce(p_recipient,'')))=0 or length(btrim(coalesce(p_subject,'')))=0
    or length(btrim(coalesce(p_body,'')))=0 or length(btrim(coalesce(p_from_address,'')))=0 then
    raise exception using errcode='22023',message='ESTIMATE_EMAIL_DISPATCH_INPUT_INVALID';
  end if;
  select v.* into version from public.estimate_versions v join public.estimate_projects p on p.id=v.project_id and p.tenant_id=v.tenant_id
    join public.tenants t on t.id=v.tenant_id and t.is_active where v.id=p_version_id and v.tenant_id=p_tenant_id for update of v;
  if version.id is null then raise exception using errcode='P0001',message='ESTIMATE_VERSION_NOT_FOUND'; end if;
  perform public.assert_estimate_offer_actor(p_tenant_id,p_version_id,p_actor_user_id);
  if version.status in('sending','sent') then
    select e.* into existing from public.estimate_emails e where e.tenant_id=p_tenant_id and e.version_id=p_version_id
      and e.type='initial' and e.status in('preparing','queued','processing','unknown') for update;
  end if;
  if existing.id is null then
    select e.* into existing from public.estimate_emails e where e.tenant_id=p_tenant_id and e.request_id=p_request_id for update;
  end if;
  if existing.id is not null then
    if existing.version_id is distinct from p_version_id or existing.payload_hash is distinct from p_payload_hash
      or existing.created_by is distinct from p_actor_user_id or existing.recipient is distinct from btrim(p_recipient)
      or existing.cc is distinct from p_cc or existing.subject is distinct from btrim(p_subject) or existing.body is distinct from p_body then
      raise exception using errcode='23505',message='ESTIMATE_EMAIL_IDEMPOTENCY_CONFLICT';
    end if;
    if existing.status<>'failed' then return existing; end if;
    frozen:=existing.provider_payload_hash ~ '^[0-9a-f]{64}$' and length(coalesce(existing.html_body,''))>0
      and length(coalesce(existing.text_body,''))>0 and existing.document_path is not null
      and existing.document_sha256 ~ '^[0-9a-f]{64}$' and existing.attachment_filename is not null;
    if frozen then raise exception using errcode='23505',message='ESTIMATE_EMAIL_RETRY_REQUIRES_NEW_REQUEST'; end if;
    if existing.request_contract_version=1 then
      raise exception using errcode='40001',message='ESTIMATE_EMAIL_LEGACY_PREPARATION_REQUIRES_RECOVERY';
    end if;
    if version.status not in('draft','sent') then raise exception using errcode='40001',message='ESTIMATE_EMAIL_RETRY_STATE_CONFLICT'; end if;
    if version.updated_at is distinct from p_expected_updated_at or version.content_revision is distinct from existing.version_content_revision then
      raise exception using errcode='40001',message='ESTIMATE_VERSION_CONFLICT';
    end if;
    if version.status='draft' then
      if not exists(select 1 from public.draft_locks l where l.version_id=version.id and l.tenant_id=version.tenant_id
        and l.user_id=p_actor_user_id and l.expires_at>now()) then raise exception using errcode='40001',message='ESTIMATE_DRAFT_LOCK_REQUIRED'; end if;
      update public.estimate_versions set status='sending' where id=version.id;
    elsif version.seal_hash is null or version.seal_hash !~ '^[0-9a-fA-F]{64}$' then raise exception using errcode='23514',message='ESTIMATE_SEAL_INVALID'; end if;
    update public.estimate_emails set status='preparing',last_error_code=null,last_error_message=null,next_attempt_at=null,
      lease_token=null,lease_expires_at=null where id=existing.id returning * into reserved;
    insert into public.estimate_email_dispatch_events(tenant_id,version_id,dispatch_id,event_type,metadata,created_by)
      values(reserved.tenant_id,reserved.version_id,reserved.id,'reserved',jsonb_build_object('retry',true),p_actor_user_id);
    return reserved;
  end if;
  if version.updated_at is distinct from p_expected_updated_at then raise exception using errcode='40001',message='ESTIMATE_VERSION_CONFLICT'; end if;
  if version.status not in('draft','sent') then raise exception using errcode='42501',message='ESTIMATE_EMAIL_STATUS_FORBIDDEN'; end if;
  if p_portal_origin is null or p_portal_origin !~ '^https?://[^/?#[:space:]]+$' then
    raise exception using errcode='22023',message='OFFER_PORTAL_ORIGIN_INVALID';
  end if;
  if version.status='draft' then
    if not exists(select 1 from public.draft_locks l where l.version_id=version.id and l.tenant_id=version.tenant_id
      and l.user_id=p_actor_user_id and l.expires_at>now()) then raise exception using errcode='40001',message='ESTIMATE_DRAFT_LOCK_REQUIRED'; end if;
    identity_snapshot:=public.capture_estimate_offer_identity(version,p_actor_user_id,p_company_snapshot);
  else
    if version.seal_hash is null or version.seal_hash !~ '^[0-9a-fA-F]{64}$' then raise exception using errcode='23514',message='ESTIMATE_SEAL_INVALID'; end if;
    select d.* into document from public.estimate_documents d where d.version_id=version.id and d.tenant_id=version.tenant_id for share;
    if not public.estimate_offer_document_valid(document,version,true) then raise exception using errcode='23514',message='OFFER_DOCUMENT_CONTRACT_INVALID'; end if;
    if document.client_contract_version in(1,2) then
      identity_snapshot:=jsonb_build_object('schemaVersion',1,'version',jsonb_build_object('id',version.id,'tenantId',version.tenant_id,
        'projectId',version.project_id,'contentRevision',version.content_revision),'project',document.client_contract_snapshot->'project',
        'issuer',document.client_contract_snapshot->'issuer','company',document.client_contract_snapshot->'company');
    else
      -- Original historical metadata only. TS still verifies original PDF/seal
      -- and legal/development context. Identity remains NULL forever.
      if version.seal_payload_version=5 or document.client_contract_snapshot is not null then
        raise exception using errcode='23514',message='OFFER_DOCUMENT_CONTRACT_INVALID';
      end if;
      identity_snapshot:=null;
    end if;
  end if;
  -- Product convention, not a legal assertion: include the final validity day
  -- in Europe/Paris civil time. Resend never extends this original offer date.
  expiration:=((version.date_devis+version.validite_jours+1)::timestamp at time zone 'Europe/Paris');
  if expiration<=clock_timestamp() then raise exception using errcode='23514',message='OFFER_VALIDITY_EXPIRED'; end if;
  portal_url_value:=p_portal_origin||'/portal/'||capability_token::text;
  if version.status='draft' then update public.estimate_versions set status='sending' where id=version.id; end if;
  insert into public.estimate_emails(id,tenant_id,version_id,recipient,cc,subject,body,type,status,sent_at,request_id,payload_hash,
    idempotency_key,created_by,version_content_revision,from_address,request_contract_version,portal_url,offer_identity_snapshot)
    values(dispatch_id,p_tenant_id,p_version_id,btrim(p_recipient),p_cc,btrim(p_subject),p_body,'initial','preparing',null,p_request_id,p_payload_hash,
      'estimate-email/'||dispatch_id,p_actor_user_id,version.content_revision,btrim(p_from_address),2,portal_url_value,identity_snapshot)
    returning * into reserved;
  insert into public.portal_tokens(id,tenant_id,version_id,token,email,expires_at,status,estimate_email_dispatch_id,capability_contract_version)
    values(capability_id,p_tenant_id,p_version_id,capability_token,reserved.recipient,expiration,'pending',dispatch_id,2);
  insert into public.estimate_email_dispatch_events(tenant_id,version_id,dispatch_id,event_type,metadata,created_by)
    values(reserved.tenant_id,reserved.version_id,reserved.id,'reserved',jsonb_build_object('request_id',p_request_id,'version_status',version.status),p_actor_user_id);
  return reserved;
end;
$$;

create or replace function public.prepare_estimate_email_dispatch(
  p_dispatch_id uuid,p_tenant_id uuid,p_actor_user_id uuid,p_seal_hash text,p_provider_payload_hash text,p_html_body text,p_text_body text,
  p_document_path text,p_document_sha256 text,p_attachment_filename text,p_expected_document_contract jsonb,p_seal_payload_version smallint
) returns public.estimate_emails language plpgsql security invoker set search_path='' as $$
declare dispatch public.estimate_emails; version public.estimate_versions; document public.estimate_documents;
  prepared public.estimate_emails; expected_identity jsonb;
begin
  if current_user<>'service_role' then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  if p_seal_hash is null or p_seal_hash !~ '^[0-9a-f]{64}$' or p_provider_payload_hash is null or p_provider_payload_hash !~ '^[0-9a-f]{64}$'
    or length(coalesce(p_html_body,''))=0 or length(coalesce(p_text_body,''))=0 or length(btrim(coalesce(p_document_path,'')))=0
    or p_document_sha256 is null or p_document_sha256 !~ '^[0-9a-f]{64}$' or length(btrim(coalesce(p_attachment_filename,'')))=0 then
    raise exception using errcode='22023',message='ESTIMATE_EMAIL_PREPARED_PAYLOAD_INVALID';
  end if;
  select e.* into dispatch from public.estimate_emails e where e.id=p_dispatch_id and e.tenant_id=p_tenant_id and e.request_id is not null for update;
  if dispatch.id is null then raise exception using errcode='P0001',message='ESTIMATE_EMAIL_DISPATCH_NOT_FOUND'; end if;
  select v.* into version from public.estimate_versions v where v.id=dispatch.version_id and v.tenant_id=dispatch.tenant_id for update;
  if version.id is null then raise exception using errcode='P0001',message='ESTIMATE_VERSION_NOT_FOUND'; end if;
  -- Decision owns version→tenant. Acquire the version before actor's tenant /
  -- membership SHARE locks, never tenant SHARE while waiting for that version.
  perform public.assert_estimate_offer_actor(dispatch.tenant_id,dispatch.version_id,p_actor_user_id);
  select d.* into document from public.estimate_documents d where d.version_id=dispatch.version_id and d.tenant_id=dispatch.tenant_id for share;
  if not public.estimate_offer_document_valid(document,version,true)
    or p_expected_document_contract is distinct from public.estimate_offer_document_proof(document,version)
    or document.file_path is distinct from p_document_path or document.sha256_hash is distinct from p_document_sha256 then
    raise exception using errcode='23514',message='OFFER_DOCUMENT_PROOF_MISMATCH';
  end if;
  if document.client_contract_version in(1,2) then
    if p_seal_payload_version is distinct from 5 then raise exception using errcode='23514',message='OFFER_SEAL_PAYLOAD_VERSION_REQUIRED'; end if;
    expected_identity:=jsonb_build_object('schemaVersion',1,'version',jsonb_build_object('id',version.id,'tenantId',version.tenant_id,
      'projectId',version.project_id,'contentRevision',version.content_revision),'project',document.client_contract_snapshot->'project',
      'issuer',document.client_contract_snapshot->'issuer','company',document.client_contract_snapshot->'company');
    if dispatch.request_contract_version=2 and dispatch.offer_identity_snapshot is distinct from expected_identity then
      raise exception using errcode='23514',message='OFFER_CLIENT_IDENTITY_MISMATCH';
    end if;
  elsif version.seal_payload_version=5 or p_seal_payload_version=5 or p_seal_payload_version is null
    or p_seal_payload_version not between 1 and 4 then raise exception using errcode='23514',message='OFFER_SEAL_PAYLOAD_VERSION_REQUIRED'; end if;
  if dispatch.status<>'preparing' then
    if dispatch.status in('queued','processing','sent','delivered','bounced') and dispatch.provider_payload_hash=p_provider_payload_hash
      and dispatch.html_body=p_html_body and dispatch.text_body=p_text_body and dispatch.document_path=p_document_path
      and dispatch.document_sha256=p_document_sha256 and dispatch.attachment_filename=p_attachment_filename
      and lower(version.seal_hash)=p_seal_hash and (version.seal_payload_version is not distinct from p_seal_payload_version
        or (version.seal_payload_version is null and p_seal_payload_version between 1 and 4)) then return dispatch; end if;
    raise exception using errcode='40001',message='ESTIMATE_EMAIL_PREPARE_STATE_CONFLICT';
  end if;
  if dispatch.request_contract_version=1 then raise exception using errcode='40001',message='ESTIMATE_EMAIL_LEGACY_PREPARATION_REQUIRES_RECOVERY'; end if;
  if version.status='sending' then
    if document.client_contract_version is null or document.client_contract_version not in(1,2) or document.published_purpose is distinct from 'email'
      or document.published_dispatch_id is distinct from dispatch.id then raise exception using errcode='23514',message='OFFER_DOCUMENT_PROOF_MISMATCH'; end if;
    if version.seal_hash is not null and lower(version.seal_hash)<>p_seal_hash then raise exception using errcode='23514',message='ESTIMATE_SEAL_MISMATCH'; end if;
    if version.seal_hash is null then update public.estimate_versions set seal_hash=p_seal_hash,seal_payload_version=5 where id=version.id; end if;
  elsif version.status in('sent','accepted','archived') then
    if lower(coalesce(version.seal_hash,''))<>p_seal_hash then raise exception using errcode='23514',message='ESTIMATE_SEAL_MISMATCH'; end if;
  else raise exception using errcode='40001',message='ESTIMATE_EMAIL_PREPARE_VERSION_STATE_CONFLICT'; end if;
  update public.estimate_emails set status='queued',provider_payload_hash=p_provider_payload_hash,html_body=p_html_body,text_body=p_text_body,
    document_path=p_document_path,document_sha256=p_document_sha256,attachment_filename=p_attachment_filename,next_attempt_at=now(),
    last_error_code=null,last_error_message=null where id=dispatch.id returning * into prepared;
  insert into public.estimate_email_dispatch_events(tenant_id,version_id,dispatch_id,event_type,metadata,created_by)
    values(prepared.tenant_id,prepared.version_id,prepared.id,'prepared',jsonb_build_object('document_path',prepared.document_path,
      'document_sha256',prepared.document_sha256,'provider_payload_hash',prepared.provider_payload_hash),p_actor_user_id);
  return prepared;
end;
$$;

create or replace function public.transition_estimate_version_status(
  p_version_id uuid,p_tenant_id uuid,p_expected_updated_at timestamptz,p_next_status public.estimate_status,p_seal_hash text,
  p_actor_user_id uuid,p_event_metadata jsonb,p_occurred_at timestamptz,p_seal_payload_version smallint,p_expected_document_contract jsonb
) returns public.estimate_versions language plpgsql security invoker set search_path='' as $$
declare version public.estimate_versions; document public.estimate_documents; updated public.estimate_versions;
  event_type text; metadata jsonb;
begin
  if current_user<>'service_role' then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  select v.* into version from public.estimate_versions v where v.id=p_version_id and v.tenant_id=p_tenant_id for update;
  if version.id is null then raise exception using errcode='P0001',message='ESTIMATE_VERSION_NOT_FOUND'; end if;
  perform public.assert_estimate_offer_actor(p_tenant_id,p_version_id,p_actor_user_id);
  if version.updated_at is distinct from p_expected_updated_at then raise exception using errcode='40001',message='ESTIMATE_VERSION_CONFLICT'; end if;
  event_type:=case p_next_status when 'sent' then 'sent' when 'accepted' then 'accepted' when 'archived' then 'archived' else null end;
  if event_type is null then raise exception using errcode='22023',message='ESTIMATE_STATUS_TRANSITION_INVALID'; end if;
  select d.* into document from public.estimate_documents d where d.version_id=version.id and d.tenant_id=version.tenant_id for share;
  if not public.estimate_offer_document_valid(document,version,true)
    or p_expected_document_contract is distinct from public.estimate_offer_document_proof(document,version) then
    raise exception using errcode='23514',message='OFFER_DOCUMENT_PROOF_MISMATCH';
  end if;
  if version.status='draft' and p_next_status='sent' then
    if p_seal_hash is null or p_seal_hash !~ '^[0-9a-f]{64}$' or p_seal_payload_version is distinct from 5
      or document.client_contract_version is null or document.client_contract_version not in(1,2) or document.published_purpose not in('manual','workflow')
      or document.published_dispatch_id is not null then raise exception using errcode='23514',message='OFFER_MANUAL_EMISSION_CONTRACT_REQUIRED'; end if;
    if not exists(select 1 from public.draft_locks l where l.version_id=version.id and l.tenant_id=version.tenant_id
      and l.user_id=p_actor_user_id and l.expires_at>now()) then raise exception using errcode='40001',message='ESTIMATE_DRAFT_LOCK_REQUIRED'; end if;
  else
    if p_seal_hash is not null then raise exception using errcode='22023',message='ESTIMATE_SEAL_UNEXPECTED'; end if;
    if document.client_contract_version in(1,2) and (version.seal_payload_version is distinct from 5 or p_seal_payload_version is distinct from 5) then
      raise exception using errcode='23514',message='OFFER_SEAL_PAYLOAD_VERSION_REQUIRED';
    elsif document.client_contract_version is null and (p_seal_payload_version is null or p_seal_payload_version not between 1 and 4) then
      raise exception using errcode='23514',message='OFFER_SEAL_PAYLOAD_VERSION_REQUIRED';
    end if;
  end if;
  update public.estimate_versions set status=p_next_status,
    seal_hash=case when p_next_status='sent' then p_seal_hash else version.seal_hash end,
    seal_payload_version=case when p_next_status='sent' then 5 else version.seal_payload_version end
    where id=version.id and tenant_id=version.tenant_id and updated_at=version.updated_at returning * into updated;
  if updated.id is null then raise exception using errcode='40001',message='ESTIMATE_VERSION_CONFLICT'; end if;
  metadata:=coalesce(p_event_metadata,'{}')||jsonb_build_object('previous_status',version.status,'next_status',p_next_status);
  if p_seal_hash is not null then metadata:=metadata||jsonb_build_object('seal_hash',p_seal_hash,'seal_payload_version',5); end if;
  perform public.log_estimate_version_event(version.id,event_type,p_actor_user_id,metadata,coalesce(p_occurred_at,now()));
  return updated;
end;
$$;

create or replace function public.claim_portal_estimate_decision(
  p_portal_token_id uuid,p_decision text,p_client_ip inet,p_reject_reason text,p_expected_seal_hash text,p_expected_document_contract jsonb
) returns void language plpgsql security invoker set search_path='' as $$
declare token public.portal_tokens; version public.estimate_versions; document public.estimate_documents;
  dispatch public.estimate_emails; decided_at timestamptz:=clock_timestamp(); metadata jsonb;
begin
  if current_user<>'service_role' then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  if p_decision not in('accepted','rejected') or p_decision is null then raise exception using errcode='22023',message='invalid portal decision'; end if;
  select * into token from public.portal_tokens where id=p_portal_token_id;
  if token.id is null then raise exception using errcode='P0001',message='portal capability is no longer claimable'; end if;
  select v.* into version from public.estimate_versions v join public.tenants t on t.id=v.tenant_id and t.is_active
    where v.id=token.version_id and v.tenant_id=token.tenant_id for update of v,t;
  if version.id is null or version.status<>'sent' then raise exception using errcode='P0001',message='estimate version is no longer claimable'; end if;
  select * into token from public.portal_tokens where id=p_portal_token_id and version_id=version.id and tenant_id=version.tenant_id for update;
  if token.id is null or token.status<>'pending' or token.expires_at<=decided_at then
    raise exception using errcode='P0001',message='portal capability is no longer claimable';
  end if;
  select d.* into document from public.estimate_documents d where d.version_id=version.id and d.tenant_id=version.tenant_id for share;
  if p_expected_seal_hash is null or p_expected_seal_hash !~ '^[0-9a-f]{64}$' or lower(version.seal_hash) is distinct from p_expected_seal_hash
    or not public.estimate_offer_document_valid(document,version,true)
    or p_expected_document_contract is distinct from public.estimate_offer_document_proof(document,version)
    or (document.client_contract_version in(1,2) and version.seal_payload_version is distinct from 5)
    or (version.seal_payload_version=5 and (document.client_contract_version is null or document.client_contract_version not in(1,2))) then
    raise exception using errcode='23514',message='OFFER_DOCUMENT_PROOF_MISMATCH';
  end if;
  if token.capability_contract_version=2 then
    -- Do not lock the dispatch: completion owns dispatch→version. A committed
    -- successful dispatch is immutable. Uncommitted processing/success refuses
    -- and can be retried after completion; parent sent alone never suffices.
    select e.* into dispatch from public.estimate_emails e where e.id=token.estimate_email_dispatch_id;
    if dispatch.id is null or dispatch.tenant_id is distinct from token.tenant_id or dispatch.version_id is distinct from token.version_id
      or dispatch.request_contract_version<>2 or dispatch.type<>'initial' or dispatch.recipient is distinct from token.email
      or dispatch.portal_url not like '%/portal/'||token.token::text or dispatch.status not in('sent','delivered','bounced')
      or length(btrim(coalesce(dispatch.provider_id,'')))=0 or dispatch.sent_at is null
      or dispatch.document_path is distinct from document.file_path or dispatch.document_sha256 is distinct from document.sha256_hash
      or dispatch.version_content_revision is distinct from document.published_content_revision then
      raise exception using errcode='P0001',message='offer dispatch is not successfully emitted';
    end if;
  elsif token.capability_contract_version is distinct from 1 or token.estimate_email_dispatch_id is not null
    or document.client_contract_version is not null or document.client_contract_snapshot is not null or version.seal_payload_version=5 then
    raise exception using errcode='23514',message='OFFER_CAPABILITY_CONTRACT_INVALID';
  end if;
  update public.portal_tokens set status=p_decision,accepted_at=case when p_decision='accepted' then decided_at else null end,
    accepted_ip=case when p_decision='accepted' then p_client_ip else null end,
    reject_reason=case when p_decision='rejected' then nullif(left(btrim(p_reject_reason),1000),'') else null end where id=token.id;
  update public.estimate_versions set status=case when p_decision='accepted' then 'accepted'::public.estimate_status else 'archived'::public.estimate_status end
    where id=version.id and tenant_id=version.tenant_id and status='sent';
  if not found then raise exception using errcode='P0001',message='estimate version decision lost its concurrency claim'; end if;
  update public.portal_tokens set status='expired' where version_id=version.id and tenant_id=version.tenant_id and id<>token.id and status='pending';
  metadata:=jsonb_build_object('portal_token_id',token.id,case when p_decision='accepted' then 'accepted_via' else 'rejected_via' end,'portal');
  if p_decision='accepted' then metadata:=metadata||jsonb_build_object('client_ip',p_client_ip);
  elsif nullif(left(btrim(p_reject_reason),1000),'') is not null then metadata:=metadata||jsonb_build_object('reason',left(btrim(p_reject_reason),1000)); end if;
  perform public.log_estimate_version_event(version.id,p_decision,null,metadata,decided_at);
end;
$$;

create or replace function public.assert_estimate_offer_dispatch_proof(dispatch public.estimate_emails,version public.estimate_versions)
returns void language plpgsql security invoker set search_path='' as $$
declare document public.estimate_documents; identity_snapshot jsonb;
begin
  if current_user<>'service_role' then raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED'; end if;
  if dispatch.request_contract_version=1 then return; end if;
  select d.* into document from public.estimate_documents d where d.version_id=version.id and d.tenant_id=version.tenant_id;
  if dispatch.request_contract_version<>2 or dispatch.version_id is distinct from version.id or dispatch.tenant_id is distinct from version.tenant_id
    or not public.estimate_offer_document_valid(document,version,true) or dispatch.document_path is distinct from document.file_path
    or dispatch.document_sha256 is distinct from document.sha256_hash or dispatch.version_content_revision is distinct from document.published_content_revision
    or version.seal_hash is null or version.seal_hash !~ '^[0-9a-fA-F]{64}$'
    or not exists(select 1 from public.portal_tokens t where t.estimate_email_dispatch_id=dispatch.id and t.capability_contract_version=2
      and t.version_id=dispatch.version_id and t.tenant_id=dispatch.tenant_id and t.email=dispatch.recipient
      and dispatch.portal_url like '%/portal/'||t.token::text) then
    raise exception using errcode='23514',message='OFFER_DISPATCH_DOCUMENT_PROOF_REQUIRED';
  end if;
  if document.client_contract_version in(1,2) then
    identity_snapshot:=jsonb_build_object('schemaVersion',1,'version',jsonb_build_object('id',version.id,'tenantId',version.tenant_id,
      'projectId',version.project_id,'contentRevision',version.content_revision),'project',document.client_contract_snapshot->'project',
      'issuer',document.client_contract_snapshot->'issuer','company',document.client_contract_snapshot->'company');
    if version.seal_payload_version is distinct from 5 or dispatch.offer_identity_snapshot is distinct from identity_snapshot then
      raise exception using errcode='23514',message='OFFER_DISPATCH_DOCUMENT_PROOF_REQUIRED';
    end if;
  elsif dispatch.offer_identity_snapshot is not null or version.seal_payload_version=5 then
    raise exception using errcode='23514',message='OFFER_DISPATCH_DOCUMENT_PROOF_REQUIRED';
  end if;
end;
$$;

create or replace function public.guard_estimate_offer_seal()
returns trigger language plpgsql security invoker set search_path='' as $$
declare document public.estimate_documents;
begin
  if new.seal_payload_version is distinct from old.seal_payload_version and current_user<>'service_role' then
    raise exception using errcode='42501',message='OFFER_SEAL_VERSION_REQUIRES_TRUSTED_WORKFLOW';
  end if;
  if old.status='sending' and new.status='draft' and new.seal_hash is null then
    -- Known no-provider-side-effect recovery. Keep document1, never downgrade
    -- it to manufacture a legacy fallback. All existing release RPCs benefit.
    new.seal_payload_version:=null;
    return new;
  end if;
  if old.seal_payload_version=5 and new.seal_payload_version is distinct from old.seal_payload_version then
    raise exception using errcode='42501',message='OFFER_SEAL_VERSION_IMMUTABLE';
  end if;
  if new.seal_payload_version=5 and (new.seal_hash is null or new.seal_hash !~ '^[0-9a-fA-F]{64}$') then
    raise exception using errcode='23514',message='OFFER_SEAL_VERSION_REQUIRES_SEAL';
  end if;
  if (old.seal_hash is null and new.seal_hash is not null) or new.seal_payload_version=5 then
    select d.* into document from public.estimate_documents d where d.version_id=new.id and d.tenant_id=new.tenant_id;
    if new.seal_payload_version is distinct from 5
      or document.client_contract_version is distinct from public.estimate_offer_engine_client_contract(new.calc_engine_version)
      or not public.estimate_offer_document_valid(document,new,false) then
      raise exception using errcode='23514',message='OFFER_NEW_EMISSION_CONTRACT_REQUIRED';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.require_fresh_v2_snapshot_for_publication()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  line_count bigint;
  complete_snapshot_count bigint;
  snapshot_total_ht bigint;
  snapshot_total_tax bigint;
  snapshot_total_ttc bigint;
  snapshot_total_gross bigint;
begin
  if new.status not in (
      'sending'::public.estimate_status,
      'sent'::public.estimate_status
    )
    or new.status is not distinct from old.status
  then
    return new;
  end if;

  -- Lot 2, sub-lot 2.7 (M5): the v3 emission path exists (client contract 2). A v3 inherits
  -- this v2 governance by name; its frozen lines also carry their gross amounts (D7).
  if new.calc_engine_version not in (2, 3) then
    return new;
  end if;

  if new.calc_snapshot_content_revision is null
    or new.calc_snapshot_content_revision <> new.content_revision
    or new.calc_snapshot_context is null
  then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_V2_SNAPSHOT_STALE';
  end if;

  select
    count(*),
    count(*) filter (
      where (
          item.snapshot_pu_ht_cents is not null
          or item.pricing_status <> 'priced'::public.estimate_line_pricing_status
        )
        and (
          new.calc_engine_version <> 3
          or (
            item.snapshot_gross_ht_cents is not null
            and item.snapshot_gross_fo_ht_cents is not null
          )
        )
        and item.snapshot_fo_ht_cents is not null
        and item.snapshot_mo_ht_cents is not null
        and item.snapshot_mo_atelier_ht_cents is not null
        and item.snapshot_mo_chantier_ht_cents is not null
        and item.line_total_ht_cents is not null
        and item.line_tax_cents is not null
        and item.line_total_ttc_cents is not null
        and item.snapshot_fo_ht_cents + item.snapshot_mo_ht_cents =
          item.line_total_ht_cents
        and item.snapshot_mo_atelier_ht_cents
          + item.snapshot_mo_chantier_ht_cents = item.snapshot_mo_ht_cents
        and item.line_total_ttc_cents =
          item.line_total_ht_cents + item.line_tax_cents
    ),
    coalesce(sum(item.line_total_ht_cents), 0),
    coalesce(sum(item.line_tax_cents), 0),
    coalesce(sum(item.line_total_ttc_cents), 0),
    coalesce(sum(item.snapshot_gross_ht_cents), 0)
  into
    line_count,
    complete_snapshot_count,
    snapshot_total_ht,
    snapshot_total_tax,
    snapshot_total_ttc,
    snapshot_total_gross
  from public.estimate_items item
  where item.version_id = new.id
    and item.tenant_id = new.tenant_id
    and item.item_type = 'line'::public.estimate_item_type;

  if line_count <> complete_snapshot_count
    or snapshot_total_ht <> new.total_ht_cents
    or snapshot_total_tax <> new.total_tax_cents
    or snapshot_total_ttc <> new.total_ttc_cents
    or (
      new.calc_engine_version = 3
      and snapshot_total_gross is distinct from new.gross_ht_cents::bigint
    )
  then
    raise exception using
      errcode = '23514',
      message = 'ESTIMATE_V2_SNAPSHOT_INVALID';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Gel documentaire v3 (D15) : jumeau de freeze_estimate_v2_document_snapshot (20261013162417),
-- même signature, même ordre de verrous, même bail exact de la page (session comprise), puis le
-- gel financier v3 en mode « send » : recalcul complet par private.estimate_v3_compute, égalité
-- stricte de chaque valeur figée (ESTIMATE_V3_PROJECTION_MISMATCH), unité et taux autorisés.
-- Aucune réclamation, approbation, offre, jeton ni courriel n'est créé ici.
-- ---------------------------------------------------------------------------
create function public.freeze_estimate_v3_document_snapshot(
  p_version_id uuid,
  p_tenant_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_content_revision bigint,
  p_actor_user_id uuid,
  p_draft_lock_session_id uuid,
  p_calculation_context jsonb,
  p_item_snapshots jsonb,
  p_version_totals jsonb
)
returns public.estimate_versions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_version public.estimate_versions%rowtype;
  draft_lock public.draft_locks%rowtype;
  frozen_version public.estimate_versions%rowtype;
begin
  if current_user <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'SERVICE_ROLE_REQUIRED';
  end if;

  if p_version_id is null
    or p_tenant_id is null
    or p_expected_updated_at is null
    or p_expected_content_revision is null
    or p_actor_user_id is null
    or p_draft_lock_session_id is null
    or p_calculation_context is null
    or p_item_snapshots is null
    or p_version_totals is null
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V3_DOCUMENT_SNAPSHOT_INPUT_INVALID';
  end if;

  -- Version is always the first row lock. Do not acquire a lease or membership
  -- first: editor mutations and financial freezes serialize on this version.
  select version.* into target_version
  from public.estimate_versions version
  where version.id = p_version_id
    and version.tenant_id = p_tenant_id
  for update of version;

  if target_version.id is null then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_V3_SNAPSHOT_NOT_WRITABLE';
  end if;

  -- Hold the owner/archive context while assert locks the active tenant and
  -- membership. The delegated financial RPC uses this same project owner.
  perform project.id
  from public.estimate_projects project
  where project.id = target_version.project_id
    and project.tenant_id = target_version.tenant_id
    and not project.is_archived
  for share of project;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_EMAIL_DISPATCH_FORBIDDEN';
  end if;

  perform public.assert_estimate_offer_actor(
    p_tenant_id,
    p_version_id,
    p_actor_user_id
  );

  -- Exact immutable lease identity, including session. Same user in another
  -- tab does not own this lease. Expiry is checked AFTER waiting on the lock.
  select lock.* into draft_lock
  from public.draft_locks lock
  where lock.version_id = target_version.id
    and lock.tenant_id = target_version.tenant_id
    and lock.user_id = p_actor_user_id
    and lock.session_id = p_draft_lock_session_id
  for update of lock;

  if draft_lock.version_id is null
    or draft_lock.expires_at <= pg_catalog.clock_timestamp()
  then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_DRAFT_LOCK_REQUIRED';
  end if;

  if target_version.updated_at is distinct from p_expected_updated_at
    or target_version.content_revision is distinct from p_expected_content_revision
  then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_VERSION_CONFLICT';
  end if;

  if target_version.status <> 'draft'::public.estimate_status
    or target_version.calc_engine_version <> 3
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_V3_SNAPSHOT_REQUIRES_DRAFT';
  end if;

  -- "send" is the v3 financial freeze's lease mode; it persists no
  -- status/emission decision. Never use its approval mode to bypass a lease.
  -- The v3 freeze recomputes the whole estimate in SQL and refuses any
  -- difference of one cent (context, every frozen line value, totals).
  frozen_version := public.freeze_estimate_v3_snapshot(
    p_version_id,
    p_tenant_id,
    p_expected_updated_at,
    p_expected_content_revision,
    p_actor_user_id,
    'send',
    p_calculation_context,
    p_item_snapshots,
    p_version_totals
  );

  return frozen_version;
end;
$$;

comment on function public.freeze_estimate_v3_document_snapshot(uuid, uuid, timestamptz, bigint, uuid, uuid, jsonb, jsonb, jsonb) is
  'Engine 3 document freeze (D15), twin of freeze_estimate_v2_document_snapshot, service_role only: exact page-session lease, then freeze_estimate_v3_snapshot(send) (full SQL recomputation, exact equality). Creates no claim, approval, offer, token or email.';

revoke all on function public.freeze_estimate_v3_document_snapshot(
  uuid, uuid, timestamptz, bigint, uuid, uuid, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.freeze_estimate_v3_document_snapshot(
  uuid, uuid, timestamptz, bigint, uuid, uuid, jsonb, jsonb, jsonb
) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Droits inchangés des fonctions redéfinies (create or replace conserve propriétaire et ACL ;
-- réaffirmés ici, à l'identique de 20261013130248 et 20261017113844).
-- ---------------------------------------------------------------------------
revoke all on function public.estimate_offer_document_valid(public.estimate_documents,public.estimate_versions,boolean) from public,anon,authenticated;
grant execute on function public.estimate_offer_document_valid(public.estimate_documents,public.estimate_versions,boolean) to service_role;
revoke all on function public.reserve_estimate_email_dispatch(uuid,uuid,timestamptz,uuid,uuid,text,text,text[],text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_estimate_email_dispatch(uuid,uuid,timestamptz,uuid,uuid,text,text,text[],text,text,text,text,jsonb) to service_role;
revoke all on function public.publish_estimate_pdf_generation(uuid,uuid,uuid,uuid,text,text,bigint,timestamptz,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.publish_estimate_pdf_generation(uuid,uuid,uuid,uuid,text,text,bigint,timestamptz,jsonb,jsonb,jsonb) to service_role;
revoke all on function public.prepare_estimate_email_dispatch(uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb,smallint) from public,anon,authenticated;
grant execute on function public.prepare_estimate_email_dispatch(uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb,smallint) to service_role;
revoke all on function public.transition_estimate_version_status(uuid,uuid,timestamptz,public.estimate_status,text,uuid,jsonb,timestamptz,smallint,jsonb) from public,anon,authenticated;
grant execute on function public.transition_estimate_version_status(uuid,uuid,timestamptz,public.estimate_status,text,uuid,jsonb,timestamptz,smallint,jsonb) to service_role;
revoke all on function public.claim_portal_estimate_decision(uuid,text,inet,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_portal_estimate_decision(uuid,text,inet,text,text,jsonb) to service_role;
revoke all on function public.assert_estimate_offer_dispatch_proof(public.estimate_emails,public.estimate_versions) from public,anon,authenticated;
grant execute on function public.assert_estimate_offer_dispatch_proof(public.estimate_emails,public.estimate_versions) to service_role;
revoke all on function public.guard_estimate_offer_document(),public.guard_estimate_offer_seal() from public,anon,authenticated;
revoke all on function public.require_fresh_v2_snapshot_for_publication() from public, anon, authenticated;
revoke all on function public.guard_estimate_document_engine_v3() from public, anon, authenticated;
