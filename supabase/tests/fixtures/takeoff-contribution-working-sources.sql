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

select throws_ok(format('select public.preview_takeoff_contribution_revision(%L,%L,%L,%L,%L,true,%L)',
    pg_temp.tenant(),pg_temp.f(1),pg_temp.f(21),m.draft,m.receipt,
    jsonb_build_object('lines',jsonb_build_object(pg_temp.f(9999),'keep_entry'))),'22023','TAKEOFF_REVISION_INVALID',
    'a line choice outside this revision is refused') from revision_mark_request m;

-- Start each pair on the original sent count. Confirm the first source, then
-- amend that receipt, so that both the archived and live evidence are checked.
create function pg_temp.switch_confirmed_source(first_source text, next_source text)
returns jsonb language plpgsql as $$
declare
  ctx record;
  choice text;
  expected_work integer := 0;
  typed jsonb := '{"quantity":7,"unit":"u","category":"site_survey"}';
  shown jsonb;
  received jsonb;
  answer jsonb;
begin
  begin
    select * into strict ctx from revision_mark_request;
    insert into public.draft_locks(version_id,user_id,tenant_id,expires_at,session_id)
      values(ctx.draft,pg_temp.f(1),pg_temp.tenant(),clock_timestamp()+interval '15 minutes',gen_random_uuid());
    foreach choice in array array[first_source,next_source] loop
      perform pg_temp.revision_choice(choice,2,expected_work,case when choice='entered' then typed else '{}' end);
      shown:=public.preview_takeoff_contribution_revision(pg_temp.tenant(),pg_temp.f(1),pg_temp.f(21),
        ctx.draft,ctx.receipt,true,'{}');
      received:=public.confirm_takeoff_contribution_revision(pg_temp.tenant(),pg_temp.f(1),pg_temp.f(21),
        ctx.draft,ctx.receipt,true,gen_random_uuid(),shown->>'digest','{}');
      ctx.receipt:=(received->>'receipt_id')::uuid;
      update revision_mark_request set receipt=ctx.receipt;
      expected_work:=expected_work+1;
    end loop;
    select jsonb_build_array(old.kind,old.state,p.kind,p.quantity,i.quantity)
      into strict answer from public.takeoff_item_send_parts p
      join public.takeoff_item_send_parts old on old.replaced_by_receipt_id=p.receipt_id
      join public.takeoff_item_send_targets t on t.id=p.target_id
      join public.estimate_items i on i.id=t.estimate_item_id
      where p.state='live' and p.receipt_id=ctx.receipt;
    raise exception using errcode='P4444';
  exception when sqlstate 'P4444' then return answer; end;
end;
$$;
select is(pg_temp.switch_confirmed_source(f.kind,n.kind),
  jsonb_build_array(f.kind,'replaced',n.kind,n.quantity,n.quantity),f.kind||' confirmed, then revised to '||n.kind)
from (values ('measured'),('verified_count'),('entered')) f(kind)
cross join (values ('measured',2),('verified_count',1),('entered',7)) n(kind,quantity)
where f.kind<>n.kind;

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
    if protection='copy_history' then
      -- A real copy whose receipt predates the redistribution protection snapshot.
      perform set_config('request.jwt.claim.sub',pg_temp.f(1)::text,true);
      alter table public.takeoff_item_send_receipts disable trigger takeoff_item_redistribution_copy_protections;
      m.draft:=public.duplicate_estimate_version(m.draft,false);
      select p.receipt_id into strict m.receipt from public.takeoff_item_send_parts p
        where p.version_id=m.draft and p.answer_id=m.answer_id and p.state='live';
      update revision_mark_request set draft=m.draft,receipt=m.receipt;
    end if;
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
      when 'dpgf' then
        -- Seed the persisted target mapping. The preview and withdrawal run with all guards enabled.
        set local session_replication_role=replica;
        update public.takeoff_item_send_targets set breakdown='dpgf',compartment_key='dpgf',line_kind='dpgf_line'
          where id=target_id_;
        set local session_replication_role=origin;
      when 'none','copy_history' then null;
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
from (values ('price','edited'),('title','edited'),('quantity','quantity'),('used','used'),('copy_history','copy_history'),('dpgf','dpgf')) cases(gesture,reason);

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

select is(pg_temp.length_to_count_line(),
  '["line_unit_changed",true,"u","TAKEOFF_REVISION_DECISION_REQUIRED",1,1,"m","live"]'::jsonb,
  'changing a length line to a count blocks the measured replacement under the same unit rule');
