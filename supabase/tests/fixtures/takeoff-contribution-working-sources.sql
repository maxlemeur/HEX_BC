-- Exercise the choices on the member's real sent reading. The initial estimate
-- comes from the send above, so the work and the published part have separate lives.
create function pg_temp.revision_choice(source_ text, proof_revision integer, expected_work integer, choice jsonb default '{}')
returns jsonb language plpgsql as $$
declare
  context_ record;
  result_ jsonb;
begin
  select * into strict context_ from revision_mark_request;
  perform set_config('request.jwt.claim.sub',pg_temp.f(1)::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.f(1))::text,true);
  if choice ? 'quantity' then
    perform public.edit_takeoff_revision_entry(pg_temp.tenant(),pg_temp.f(21),context_.draft,context_.receipt,context_.answer_id,
      pg_temp.f(9650+expected_work),coalesce((select e.revision from public.takeoff_item_entries e
        where e.project_id=pg_temp.f(21) and e.plan_logical_id=pg_temp.plan_file(21) and e.item_id=pg_temp.f(310)),0),choice);
    choice:='{}';
  end if;
  return public.review_takeoff_revision_item(pg_temp.tenant(),pg_temp.f(21),context_.draft,context_.receipt,
    context_.answer_id,pg_temp.f(9600+expected_work),jsonb_build_object('work_revision',expected_work,
      'marks_revision',proof_revision,'answer_revision',(select content_sha256 from public.takeoff_item_answers a
        where a.id=context_.answer_id),'plan_entry_revision',(select e.revision from public.takeoff_item_entries e
        where e.project_id=pg_temp.f(21) and e.plan_logical_id=pg_temp.plan_file(21) and e.item_id=pg_temp.f(310))),
    jsonb_build_object('source',source_)||choice);
end;
$$;
create function pg_temp.stage_revision_example() returns jsonb language plpgsql as $$
declare measured jsonb; entered jsonb; count_ jsonb; withdrawn jsonb; actual jsonb;
begin
  begin
    measured := pg_temp.revision_choice('measured',2,0);
    entered := pg_temp.revision_choice('entered',2,1,'{"quantity":7,"unit":"u","category":"site_survey"}');
    count_ := pg_temp.revision_choice('verified_count',2,2);
    withdrawn := pg_temp.revision_choice('withdraw',2,3,'{"reason":"duplicate"}');
    select jsonb_build_array(measured->'quantity',entered->'quantity',count_->'quantity',withdrawn->'quantity',
      p.quantity,i.quantity,p.marks_revision,(select count(*) from public.takeoff_item_send_receipts r where r.version_id=t.version_id))
    into actual from revision_mark_request m join public.takeoff_item_send_parts p on p.receipt_id=m.receipt
      join public.takeoff_item_send_targets t on t.id=p.target_id join public.estimate_items i on i.id=t.estimate_item_id;
    raise exception 'roll back example' using errcode='P4444';
  exception when sqlstate 'P4444' then return actual;
    when others then return jsonb_build_object('error',sqlerrm);
  end;
end;
$$;
select is(pg_temp.stage_revision_example(),'[2,7,1,0,1,1,2,1]'::jsonb,
  'switch between the three sources and withdraw in the working copy; the line, sent proof and first receipt survive');

-- Confirming is a different act from selecting the working source. Re-read the
-- line and price before confirmation, after it, and after a replay.
create function pg_temp.confirm_revision_example() returns jsonb language plpgsql as $$
declare m record; preview jsonb; confirmed jsonb; replay jsonb; output_ jsonb; before_ jsonb;
begin
  begin
    select * into strict m from revision_mark_request;
    perform pg_temp.revision_choice('measured',2,0);
    insert into public.draft_locks(version_id,user_id,tenant_id,expires_at,session_id)
      values(m.draft,pg_temp.f(1),pg_temp.tenant(),clock_timestamp()+interval '15 minutes',gen_random_uuid());
    preview:=public.preview_takeoff_contribution_revision(pg_temp.tenant(),pg_temp.f(1),pg_temp.f(21),m.draft,m.receipt,true,'{}');
    select jsonb_build_array(i.quantity,i.unit_price_ht_cents) into before_ from public.takeoff_item_send_parts p
      join public.takeoff_item_send_targets t on t.id=p.target_id join public.estimate_items i on i.id=t.estimate_item_id
      where p.receipt_id=m.receipt;
    confirmed:=public.confirm_takeoff_contribution_revision(pg_temp.tenant(),pg_temp.f(1),pg_temp.f(21),m.draft,m.receipt,true,
      pg_temp.f(9699),preview->>'digest','{}');
    replay:=public.confirm_takeoff_contribution_revision(pg_temp.tenant(),pg_temp.f(1),pg_temp.f(21),m.draft,m.receipt,true,
      pg_temp.f(9699),preview->>'digest','{}');
    select jsonb_build_object('before',before_,'after',jsonb_build_array(i.quantity,i.unit_price_ht_cents),
      'live',p.kind,'quantity',p.quantity,'first',old.state,
      'receipt',r.command_kind,'parent',r.amends_receipt_id=m.receipt,'replays',replay->'receipt_id'=confirmed->'receipt_id' and
        replay->'replayed'='true','original_proof',old.marks_revision,
      'sends',(select count(*) from public.takeoff_item_send_receipts x where x.version_id=m.draft and x.command_kind='send'))
    into strict output_ from public.takeoff_item_send_parts p join public.takeoff_item_send_targets t on t.id=p.target_id
      join public.estimate_items i on i.id=t.estimate_item_id join public.takeoff_item_send_receipts r on r.id=p.receipt_id
      join public.takeoff_item_send_parts old on old.replaced_by_receipt_id=r.id and old.receipt_id=m.receipt
      where p.state='live' and r.id=(confirmed->>'receipt_id')::uuid;
    raise exception using errcode='P4444';
  exception when sqlstate 'P4444' then return output_; when others then return jsonb_build_object('error',sqlerrm); end;
end;
$$;
select is(pg_temp.confirm_revision_example(),'{"before":[1,0],"after":[2,0],"live":"measured","quantity":2,
  "first":"replaced","receipt":"revise","parent":true,"replays":true,"original_proof":2,"sends":1}'::jsonb,
  'the working source replaces only its local part on confirmation; replay returns that receipt');

-- Exercise the transaction that removes a last part. Both previews must name
-- the same physical line, and a refused confirmation must preserve its receipt,
-- the line and its one live part.
create function pg_temp.withdraw_revision_example(protection text) returns jsonb language plpgsql as $$
declare
  m record;
  line_id uuid;
  target_id_ uuid;
  item_id_ uuid;
  preview jsonb;
  decision jsonb;
  other_preview jsonb;
  expected_reason text;
  result_ jsonb;
  refused text;
begin
  begin
    select * into strict m from revision_mark_request;
    perform pg_temp.revision_choice('withdraw',2,0,'{"reason":"duplicate"}');
    insert into public.draft_locks(version_id,user_id,tenant_id,expires_at,session_id)
      values(m.draft,pg_temp.f(1),pg_temp.tenant(),clock_timestamp()+interval '15 minutes',gen_random_uuid());
    select t.estimate_item_id,t.id,t.item_id into strict line_id,target_id_,item_id_
      from public.takeoff_item_send_targets t join public.takeoff_item_send_parts p on t.id=p.target_id where p.receipt_id=m.receipt;
    perform set_config('miaouffrage.estimate_v3_writer',m.draft::text,true);
    case protection
      when 'quantity' then update public.estimate_items set quantity=7 where id=line_id;
      when 'price' then update public.estimate_items set unit_price_ht_cents=2300 where id=line_id;
      when 'title' then update public.estimate_items set title='Nom retenu' where id=line_id;
      when 'used' then insert into public.estimate_item_outlier_dismissals(tenant_id,version_id,item_id,flag_key,dismissed_by)
        values(pg_temp.tenant(),m.draft,line_id,'quantity_outlier',pg_temp.f(1));
      when 'none' then null;
    end case;
    select b->>'reason' into expected_reason from jsonb_array_elements(private.takeoff_revision_line_protections(
      pg_temp.tenant(),pg_temp.f(1),pg_temp.f(21),m.draft,item_id_,true)) b where b->>'line_id'=line_id::text;
    preview:=public.preview_takeoff_contribution_revision(pg_temp.tenant(),pg_temp.f(1),pg_temp.f(21),m.draft,m.receipt,true,'{}');
    begin
      decision:=public.confirm_takeoff_contribution_revision(pg_temp.tenant(),pg_temp.f(1),pg_temp.f(21),m.draft,m.receipt,true,
        pg_temp.f(9688),preview->>'digest','{}');
    exception when sqlstate '55000' then refused:=sqlerrm;
    end;
    select jsonb_build_array(expected_reason,preview#>>'{blockers,0,line,reason}',refused,
      exists(select 1 from public.estimate_items where id=line_id),
      (select count(*) from public.takeoff_item_send_parts where target_id=target_id_ and state='live'),
      exists(select 1 from public.takeoff_item_send_targets t where t.id=target_id_ and t.compartment_key='vacated:'||target_id_),
      (select count(*) from public.takeoff_item_send_receipts r where r.amends_receipt_id=m.receipt))
      into result_;
    raise exception using errcode='P4444';
  exception when sqlstate 'P4444' then return result_; when others then return jsonb_build_object('error',sqlerrm); end;
end;
$$;
select is(pg_temp.withdraw_revision_example('none'),'[null,null,null,false,0,true,1]'::jsonb,
  'withdrawing the last unprotected part deletes its empty line and frees its compartment under the revision receipt');
select is(pg_temp.withdraw_revision_example(gesture),jsonb_build_array(reason,reason,'TAKEOFF_REVISION_DECISION_REQUIRED',true,1,false,0),
  format('the redistribution protection for %s also stops the revision before any write',gesture))
from (values ('price','edited'),('title','edited'),('quantity','quantity'),('used','used')) cases(gesture,reason);

create function pg_temp.review_state_example() returns jsonb language plpgsql as $$
declare m record; before_ jsonb; staged jsonb; row_ jsonb; actual jsonb;
begin
  begin
    select * into strict m from revision_mark_request;
    perform set_config('request.jwt.claim.sub',pg_temp.f(1)::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.f(1))::text,true);
    before_:=public.read_takeoff_contribution_revision(pg_temp.tenant(),pg_temp.f(21),m.draft,pg_temp.job(21),array[pg_temp.f(310)]);
    perform pg_temp.revision_choice('entered',2,0,'{"quantity":7,"unit":"u","category":"site_survey"}');
    staged:=public.read_takeoff_contribution_revision(pg_temp.tenant(),pg_temp.f(21),m.draft,pg_temp.job(21),array[pg_temp.f(310)]);
    row_:=staged#>'{items,0}';
    actual:=jsonb_build_array(before_->>'receipt_id'=m.receipt::text,before_#>'{items,0,correction}',
      row_#>'{sent,0,quantity}',row_#>'{sent,0,kind}',row_#>'{sent,0,marks_revision}',row_#>'{correction,quantity}',row_#>'{correction,source}');
    raise exception using errcode='P4444';
  exception when sqlstate 'P4444' then return actual; when others then return jsonb_build_object('error',sqlerrm); end;
end;
$$;
select is(pg_temp.review_state_example(),'[true,null,1,"verified_count",2,7,"entered"]'::jsonb,
  'the item reader shows the confirmed count beside the pending plan entry before the member confirms');

create function pg_temp.revision_rights(variant text) returns jsonb language plpgsql as $$
declare m record; tenant_ uuid:=pg_temp.tenant(); project_ uuid:=pg_temp.f(21); version_ uuid; before_ jsonb;
  read_ jsonb; working_ text; preview_ text; confirm_ text; n integer;
begin
  begin
    select * into strict m from revision_mark_request;
    version_:=m.draft;
    perform set_config('request.jwt.claim.sub',pg_temp.f(1)::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.f(1))::text,true);
    case variant
      when 'tenant' then tenant_:=pg_temp.f(9876);
      when 'affaire' then project_:=pg_temp.f(20);
      when 'viewer' then update public.tenant_memberships set role='viewer' where tenant_id=tenant_ and user_id=pg_temp.f(1);
      when 'issued' then set local session_replication_role=replica;
        update public.estimate_versions set status='sent' where id=version_;
        set local session_replication_role=origin;
    end case;
    begin
      perform public.edit_takeoff_revision_marks(tenant_,project_,version_,m.receipt,pg_temp.f(9681),m.revisions,m.gestures);
    exception when others then working_:=sqlstate;end;
    begin
      perform public.preview_takeoff_contribution_revision(tenant_,pg_temp.f(1),project_,version_,m.receipt,true,'{}');
    exception when others then preview_:=sqlstate;end;
    begin
      perform public.confirm_takeoff_contribution_revision(tenant_,pg_temp.f(1),project_,version_,m.receipt,true,pg_temp.f(9682),repeat('1',64),'{}');
    exception when others then confirm_:=sqlstate;end;
    if variant='issued' then read_:=public.read_takeoff_contribution_revision(tenant_,project_,version_,pg_temp.job(21),array[pg_temp.f(310)]);end if;
    select count(*) into n from public.takeoff_item_send_receipts where amends_receipt_id=m.receipt;
    before_:=jsonb_build_array(working_,preview_,confirm_,n,case when variant='issued' then read_->'editable' end);
    raise exception using errcode='P4444';
  exception when sqlstate 'P4444' then return before_;when others then return jsonb_build_object('error',sqlerrm);end;
end;
$$;
select is(pg_temp.revision_rights(variant),jsonb_build_array(code,code,code,0,editable),
  format('working marks, revision preview and confirmation recheck %s with zero receipts written',variant))
from (values ('tenant','42501',null::boolean),('affaire','42501',null),('viewer','42501',null),('issued','55000',false)) cases(variant,code,editable);
