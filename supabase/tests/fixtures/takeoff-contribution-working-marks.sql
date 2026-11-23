-- A sent count of one, its ordinary edit refused immediately above. A working
-- edit addresses the local receipt explicitly. Both the published proof and the
-- estimate remain readable while the new mark revision is being prepared.
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'start a working correction');
create temp table revision_mark_request as
select r.id as receipt, r.version_id as draft, m.answer_id, m.mark_id,
  jsonb_build_object(m.answer_id::text,2) as revisions,
  jsonb_build_array(jsonb_build_object('op','move','mark_id',m.mark_id,'x',0.3,'y',0.2),
    jsonb_build_object('op','verify','answer_id',m.answer_id,'pages','[2]'::jsonb)) as gestures
from mark_to_move m cross join public.takeoff_item_send_receipts r where r.request_id=pg_temp.f(812);

create function pg_temp.working_marks_call(variant text) returns text language sql stable as $$
  select format('select public.edit_takeoff_revision_marks(%L,%L,%L,%L,%L,%L::jsonb,%L::jsonb)',
    pg_temp.tenant(),pg_temp.f(21),case when variant='wrong_draft' then pg_temp.f(20) else draft end,
    case when variant='wrong_receipt' then pg_temp.f(5566) else receipt end,pg_temp.f(9555),revisions,gestures)
  from revision_mark_request
$$;
select is((select x.doc #>> array['summaries',m.answer_id::text,'quantity'] from revision_mark_request m
  cross join extensions.dblink('race_a',pg_temp.working_marks_call('correct'),false) x(doc jsonb)),
  '1','a member can move and verify a mark in a working revision of the sent plan');
select is((select x.doc->>'replayed' from extensions.dblink('race_a',pg_temp.working_marks_call('correct'),false)
  x(doc jsonb)), 'true','repeating the working edit returns its stored result');
select is((select x.proof from revision_mark_request m cross join lateral extensions.dblink('race_a',
  format('select jsonb_build_array(p.marks_revision,i.quantity) from public.takeoff_item_send_parts p
    join public.takeoff_item_send_targets t on t.id=p.target_id join public.estimate_items i on i.id=t.estimate_item_id
    where p.receipt_id=%L and p.answer_id=%L',m.receipt,m.answer_id)) x(proof jsonb)),
  '[2,1]'::jsonb,'before rollback, the editing member still reads the original part revision and estimate quantity');
select is(extensions.dblink_exec('race_a','rollback'),'ROLLBACK','restore the fixture after this working edit');
select is((select count(*)::integer from extensions.dblink('race_a',pg_temp.working_marks_call('wrong_draft'),false) x(doc jsonb)),0,
  'the same analysis cannot be edited with an unrelated draft');
select ok(extensions.dblink_error_message('race_a') like '%TAKEOFF_REVISION_SCOPE%','the wrong draft fails the scope check');
select is((select count(*)::integer from extensions.dblink('race_a',pg_temp.working_marks_call('wrong_receipt'),false) x(doc jsonb)),0,
  'a working edit must name a receipt of its draft');
select ok(extensions.dblink_error_message('race_a') like '%TAKEOFF_REVISION_SCOPE%','the missing receipt fails the scope check');
