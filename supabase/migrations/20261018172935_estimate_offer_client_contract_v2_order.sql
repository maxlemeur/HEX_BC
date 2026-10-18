-- Lot 2, sous-lot 2.7, suite de M5 (20261018102840_estimate_offer_client_contract_v2.sql) : ordre des lignes et
-- numéros de section du contrat client 2. Revue Codex de #60 (commentaire 4307583969, C4) ; contrat et preuves :
-- docs/testing/estimate-engine-v3-2.7.md §13.14 et supabase/tests/database/estimate-offer-contract-v2.test.sql
-- (F27-20, F27-21).
--
-- L'appariement exact de M5 joignait chaque ligne du contrat présenté à la ligne stockée par son seul
-- identifiant : il ne vérifiait ni la position de la ligne dans le tableau ni le numéro des sections. Le portail
-- et le PDF rendent pourtant les lignes dans l'ordre du tableau avec leur `number`, et le sceau 5 couvre cet
-- ordre : une copie réordonnée ou renumérotée était publiée et scellée « conforme au devis figé ».
--
-- Après cette migration, public.estimate_offer_client_items_match_v2 exige aussi que les lignes suivent le
-- parcours préfixe de l'arbre stocké (frères par position, puis identifiant) et que chaque section porte le
-- numéro qui en découle, comme computeEstimateItemNumbering (src/lib/estimates/numbering.ts) : racine sur deux
-- chiffres au moins, puis rang parmi tous les frères, lignes comprises. Un élément hors de l'arbre parcouru
-- depuis les racines n'a pas de rang et rend l'appariement faux. Le refus de publication reste
-- 23514 OFFER_CLIENT_CONTRACT_ANCHOR_MISMATCH.
--
-- Seule cette fonction est redéfinie, depuis sa définition vivante de M5 (aucune redéfinition postérieure) :
-- même signature, security invoker, search_path vide, mêmes droits (exécution pour service_role seul) ; son
-- commentaire suit. Le validateur, les fonctions d'offre, le contrat 1 et les charges de sceau ne changent pas.
-- Aucune colonne n'est ajoutée ; aucune ligne n'est réécrite (D17) : un document déjà publié garde sa copie.

begin;

do $preflight$
begin
  if to_regprocedure('public.estimate_offer_client_items_match_v2(jsonb,public.estimate_versions)') is null then
    raise exception 'LOT2_2_7_ORDER_PREFLIGHT: M5 (20261018102840) must be applied first';
  end if;
  if exists (
    select 1
    from pg_proc proc
    where proc.oid = 'public.estimate_offer_client_items_match_v2(jsonb,public.estimate_versions)'::regprocedure
      and (proc.prosecdef or proc.proconfig is distinct from array['search_path=""'])
  ) then
    raise exception 'LOT2_2_7_ORDER_PREFLIGHT: the contract 2 item match differs from its M5 definition (security invoker, empty search_path)';
  end if;
end;
$preflight$;

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

comment on function public.estimate_offer_client_items_match_v2(jsonb,public.estimate_versions) is
  'Exact match of a client contract 2 to a freshly frozen v3 (D14): rows to stored lines (unit code and referential symbol, status, VAT rate, frozen PU and gross, gross FO/MO parts) in the canonical pre-order of the stored tree (siblings by position, then id) with the section numbers derived from it, footer to the version totals and to the frozen context (discount intent, VAT by rate). False for any other engine, a stale freeze or any difference.';

-- Droits de M5, inchangés (create or replace les conserve ; reposés pour que la migration les énonce).
revoke all on function public.estimate_offer_client_items_match_v2(jsonb,public.estimate_versions) from public, anon, authenticated;
grant execute on function public.estimate_offer_client_items_match_v2(jsonb,public.estimate_versions) to service_role;

commit;
