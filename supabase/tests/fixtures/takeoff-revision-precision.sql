create function pg_temp.revision_precision(amount numeric,unit_ text) returns jsonb language plpgsql as $$
declare m record; initial_part uuid; line_ uuid; shown jsonb; refusal text; actual jsonb; entry_ uuid;
begin
  begin
    select * into strict m from revision_mark_request;
    select p.id,t.estimate_item_id into strict initial_part,line_ from public.takeoff_item_send_parts p
      join public.takeoff_item_send_targets t on t.id=p.target_id where p.receipt_id=m.receipt;
    if unit_='m' then perform pg_temp.seed_sent_length(m.answer_id,initial_part); end if;
    perform pg_temp.revision_choice('entered',2,0,jsonb_build_object('quantity',amount,'unit',unit_,'category','site_survey'));
    select id into strict entry_ from public.takeoff_item_entries where item_id=pg_temp.f(310) and plan_logical_id=pg_temp.plan_file(21);
    insert into public.draft_locks(version_id,user_id,tenant_id,expires_at,session_id)
      values(m.draft,pg_temp.f(1),pg_temp.tenant(),clock_timestamp()+interval '15 minutes',gen_random_uuid());
    shown:=public.preview_takeoff_contribution_revision(pg_temp.tenant(),pg_temp.f(1),pg_temp.f(21),m.draft,m.receipt,true,'{}');
    begin perform public.confirm_takeoff_contribution_revision(pg_temp.tenant(),pg_temp.f(1),pg_temp.f(21),m.draft,m.receipt,true,
      gen_random_uuid(),shown->>'digest','{}'); exception when others then refusal:=sqlerrm; end;
    select jsonb_build_array(shown#>>'{blockers,0,reason}',shown#>>'{blockers,0,entry_id}'=entry_::text,
      shown#>'{blockers,0,quantity}',shown#>'{actions,0,quantity_after}',refusal,i.quantity,p.quantity,
      (select count(*) from public.takeoff_item_send_receipts where amends_receipt_id=m.receipt))
      into actual from public.estimate_items i join public.takeoff_item_send_targets t on t.estimate_item_id=i.id
      join public.takeoff_item_send_parts p on p.target_id=t.id and p.state='live' where i.id=line_;
    raise sqlstate 'P4444';
  exception when sqlstate 'P4444' then return actual; when others then return jsonb_build_object('error',sqlerrm); end;
end;
$$;
select is(pg_temp.revision_precision(q,unit_),
  jsonb_build_array('quantity_unwritable',true,q,null,'TAKEOFF_REVISION_DECISION_REQUIRED',1,1,0),
  format('the preview identifies the unwritable entry of %s %s and the writer preserves the earlier part',q,unit_))
from (values (7.00001,'u'),(1.2345,'m')) cases(q,unit_);
select is(pg_temp.revision_precision(q,unit_),jsonb_build_array(null,null,null,line_qty,null,line_qty,q,1),
  format('the journal accepts %s %s to three decimals and composes the line at %s',q,unit_,line_qty))
from (values (7.001,'u',7.001),(1.234,'m',2)) cases(q,unit_,line_qty);
