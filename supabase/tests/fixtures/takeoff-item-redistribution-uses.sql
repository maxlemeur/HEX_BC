-- Probe each distinct business use in isolation. Identifiers outside this one edge
-- are synthetic. CHECKs, column types and the production lookup are real.
create function pg_temp.protects_use(relation regclass, edge text, extra jsonb) returns boolean language plpgsql as $$
declare
  fields jsonb; columns_ text; observed boolean;
begin
  fields:=jsonb_build_object('tenant_id',pg_temp.f(10),'project_id',pg_temp.f(20),'version_id',pg_temp.f(30),
    'target_version_id',pg_temp.f(30),'created_by',pg_temp.f(1),'draft_id',pg_temp.f(450),'takeoff_job_id',pg_temp.f(41),
    'estimate_item_id',pg_temp.f(62),'cycle_id',pg_temp.f(451),'scope_label','Lavabo','label','Preuve',
    'snapshot_fingerprint','synthetic','confidence_label','high','scope_type','line','comment','A conserver',
    'source_label','Plan','source_kind','history','source_record_table','estimate_items','source_ref','Ligne témoin',
    'line_position',1,'draft_node_id',pg_temp.f(452),'review_reference',pg_temp.f(452)::text,'source_comment_id',pg_temp.f(454),
    'suggestion_id',pg_temp.f(455),'line_id',pg_temp.f(452),'cause_code','missing_proof','scope_ref','line:lavabo',
    'position',1,'title','Témoin','explanation_id',pg_temp.f(457),'candidate_id',pg_temp.f(458))||extra||jsonb_build_object(edge,pg_temp.f(61));
  if relation='public.estimate_items'::regclass then
    select (to_jsonb(i)-'id')||jsonb_build_object('parent_id',pg_temp.f(61)) into fields from public.estimate_items i where i.id=pg_temp.f(62);
  end if;
  select string_agg(quote_ident(attname),',' order by attnum) into columns_ from pg_catalog.pg_attribute
    where attrelid=relation and attnum>0 and not attisdropped and fields ? attname::text;
  begin
    execute format('insert into %1$s (%2$s) select %2$s from jsonb_populate_record(null::%1$s,$1)',relation,columns_) using fields;
    observed:=pg_temp.preview('by_level')->'blockers' @> '[{"reason":"used","title":"Lavabo"}]';
    raise exception using errcode='Z0001';
  exception when sqlstate 'Z0001' then null;
    when others then raise warning 'Fixture % (%), ERROR: %',relation,edge,sqlerrm; return false;
  end;
  return observed;
end;
$$;
set local session_replication_role=replica;
select ok(pg_temp.protects_use(relation::regclass,edge,extra::jsonb),relation||'.'||edge||' protects its estimate line')
from (values
  ('public.estimate_items','parent_id','{"item_type":"section"}'),
  ('public.estimate_explanations','line_id','{"explanation_kind":"price","summary_short":"A","summary_detail":"B"}'),
  ('public.estimate_line_evidences','estimate_item_id','{"fingerprint":"a","evidence_kind":"fact","evidence_type":"comment"}'),
  ('public.estimate_line_evidences','source_record_id','{"fingerprint":"a","evidence_kind":"fact","evidence_type":"comment"}'),
  ('public.estimate_explanation_sources','source_record_id','{}'),
  ('public.estimate_generated_ouvrage_applications','estimate_item_id','{}'),
  ('public.estimate_generated_ouvrage_candidates','suggested_lot_id','{"ai_status":"certain","candidate_order":1,"confidence":1,"designation":"Poste","normalized_designation":"poste"}'),
  ('public.estimate_generated_ouvrage_drafts','preferred_lot_id','{"source_kind":"free_text"}'),
  ('public.estimate_generated_ouvrage_work_snapshots','estimate_item_id','{"parent_work_id":"d5900000-0000-4000-8000-000000000450"}'),
  ('public.estimate_risk_alerts','line_id','{"severity":"info","risk_score":1}'),
  ('public.estimate_risk_alerts','lot_id','{"severity":"info","risk_score":1}'),
  ('public.estimate_risk_alerts','scope_id','{"severity":"info","risk_score":1}'),
  ('public.estimate_structure_draft_applications','estimate_item_id','{"applied_action":"create"}'),
  ('public.estimate_structure_draft_nodes','duplicate_match_item_id','{"confidence":1,"default_action":"merge","hierarchy_level":1,"normalized_label":"poste","order_index":1}'),
  ('public.estimate_version_zero_applications','estimate_item_id','{}'),
  ('public.estimate_version_zero_applications','parent_section_item_id','{}'),
  ('public.estimate_version_zero_lines','materialized_estimate_item_id','{"lot_id":"d5900000-0000-4000-8000-000000000450","proposed_title":"Témoin"}'),
  ('public.purchase_order_items','source_estimate_item_id','{"designation":"Témoin","purchase_order_id":"d5900000-0000-4000-8000-000000000450","quantity":1,"tax_rate_bp":2000,"unit_price_ht_cents":100}'),
  ('public.takeoff_dpgf_links','estimate_item_id','{"takeoff_item_id":"d5900000-0000-4000-8000-000000000450"}'),
  ('public.takeoff_dpgf_review_decisions','estimate_item_id','{"decision":"keep_dpgf","line_label":"Lavabo"}'),
  ('public.takeoff_price_suggestions','estimate_item_id','{"high_cents":300,"low_cents":100,"target_cents":200,"justification":"Témoin"}'),
  ('public.takeoff_price_suggestion_sources','estimate_item_id','{"kind":"fact","price_cents":100}'),
  ('public.takeoff_price_suggestion_sources','source_record_id','{"kind":"fact","price_cents":100}'),
  ('public.takeoff_item_send_sections','estimate_item_id','{"section_key":"other","receipt_id":"d5900000-0000-4000-8000-000000000071"}'),
  ('public.estimate_review_comments','scope_id','{}'),
  ('public.estimate_review_correction_items','scope_id','{}')
) as cases(relation,edge,extra);
set local session_replication_role=origin;

savepoint purchase_transfer;
insert into private.estimate_purchase_transfers(tenant_id,source_version_id,source_item_id,item_title,purchase_order_id,reference,quantity,created_by)
values(pg_temp.f(10),pg_temp.f(30),pg_temp.f(61),'Lavabo',pg_temp.f(612),'Fictif',5,pg_temp.f(1));
select is(private.takeoff_redistribution_used_lines(array[pg_temp.f(61)]),array[pg_temp.f(61)],
  'a purchase transfer alone still uses its source line');
rollback to purchase_transfer;
