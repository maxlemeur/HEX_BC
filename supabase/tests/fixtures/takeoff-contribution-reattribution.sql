-- Item A was sent as 1. B had no quantity then. The member reattributes the
-- same mark from A to B, verifies B, withdraws A and accepts B's count.
create function pg_temp.reattributed_revision(earlier text) returns jsonb language plpgsql as $$
declare
  m record;
  changed_answer public.takeoff_item_answers;
  original public.takeoff_item_send_parts;
  hist public.takeoff_item_send_parts;
  dest public.takeoff_item_send_targets;
  label_ text;
  section_ uuid;
  foreign_line uuid:=pg_temp.f(9993);
  plan_ jsonb;
  contribution jsonb;
  choices jsonb:='{}';
  preview_ jsonb;
  initial jsonb;
  confirmation jsonb;
  actual jsonb;
  proof jsonb;
  addr jsonb;
  explanation jsonb;
begin
  begin
    select * into strict m from revision_mark_request;
    select * into strict original from public.takeoff_item_send_parts where receipt_id=m.receipt and answer_id=m.answer_id;
    select * into strict dest from public.takeoff_item_send_targets where id=original.target_id;
    select * into strict changed_answer from public.takeoff_item_answers where job_id=original.job_id and item_id=pg_temp.f(311);
    select e.label into strict label_ from public.takeoff_list_revision_entries e where e.revision_id=changed_answer.list_revision_id and e.item_id=changed_answer.item_id;
    select t.estimate_item_id into strict section_ from public.takeoff_item_send_sections t where t.version_id=m.draft and section_key='list:';
    perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.f(1))::text,true);
    perform set_config('request.jwt.claim.sub',pg_temp.f(1)::text,true);
    if earlier<>'none' then
      -- An earlier receipt already brought B=3. Only the plan and source vary.
      perform set_config('mergeone.takeoff_item_send','fixture',true);
      perform set_config('miaouffrage.estimate_v3_writer',m.draft::text,true);
      insert into public.estimate_items
        select (jsonb_populate_record(null::public.estimate_items,to_jsonb(i)||jsonb_build_object('id',foreign_line,
          'position',9,'title',label_,'quantity',3,'source_metadata',jsonb_build_object('takeoff_item_send',
            jsonb_build_object('version',1,'item_id',changed_answer.item_id,'compartment_key','together','breakdown','together'))))).*
        from public.estimate_items i where id=dest.estimate_item_id;
      insert into public.takeoff_item_send_targets select (jsonb_populate_record(null::public.takeoff_item_send_targets,to_jsonb(dest)||
        jsonb_build_object('id',pg_temp.f(9994),'estimate_item_id',foreign_line,'item_id',changed_answer.item_id))).*;
      hist:=original;
      hist.id:=pg_temp.f(9991);hist.job_id:=pg_temp.f(9992);hist.item_id:=changed_answer.item_id;hist.answer_id:=pg_temp.f(9995);
      hist.target_id:=pg_temp.f(9994); hist.quantity:=3;
      hist.plan_logical_id:=case when earlier='other_plan' then pg_temp.f(9998) else original.plan_logical_id end;
      hist.pages:=array[2];hist.takeoff_item_ids:='{}';
      if earlier<>'verified' then hist.kind:='measured';hist.marks_revision:=null;
        hist.observation_ids:=array[pg_temp.f(9996)];hist.takeoff_item_ids:=array[pg_temp.f(9997)];end if;
      insert into public.takeoff_item_send_parts select hist.*;
      perform set_config('mergeone.takeoff_item_send','',true);
    end if;
    addr:=jsonb_build_object('answer_id',changed_answer.id,'pages',to_jsonb(private.takeoff_count_answer_scope(changed_answer)));
    perform public.edit_takeoff_revision_marks(pg_temp.tenant(),pg_temp.f(21),m.draft,m.receipt,pg_temp.f(9665),
      m.revisions||jsonb_build_object(changed_answer.id,private.takeoff_count_marks_revision(changed_answer.id)),
      jsonb_build_array(jsonb_build_object('op','reattribute','answer_id',m.answer_id,'mark_id',m.mark_id,'to_answer_id',changed_answer.id),
        addr||jsonb_build_object('op','verify')));
    perform pg_temp.revision_choice('withdraw',private.takeoff_count_marks_revision(m.answer_id),0,'{"reason":"reading_error"}');
    proof:=jsonb_build_object('work_revision',0,'marks_revision',private.takeoff_count_marks_revision(changed_answer.id),
      'answer_revision',changed_answer.content_sha256,'plan_entry_revision',null);
    perform public.review_takeoff_revision_item(pg_temp.tenant(),pg_temp.f(21),m.draft,m.receipt,changed_answer.id,pg_temp.f(9666),
      proof,'{"source":"verified_count"}');
    insert into public.draft_locks(version_id,user_id,tenant_id,expires_at,session_id)
      values(m.draft,pg_temp.f(1),pg_temp.tenant(),clock_timestamp()+interval '15 minutes',gen_random_uuid());
    initial:=public.preview_takeoff_contribution_revision(pg_temp.tenant(),pg_temp.f(1),pg_temp.f(21),m.draft,m.receipt,true,choices);
    if earlier in ('same_plan','verified') then
      select b into strict explanation from jsonb_array_elements(initial->'blockers') b where b->>'reason'='other_analysis';
      begin
        perform public.confirm_takeoff_contribution_revision(pg_temp.tenant(),pg_temp.f(1),pg_temp.f(21),m.draft,m.receipt,true,
          pg_temp.f(9667),initial->>'digest',choices);
        raise exception 'confirmation succeeded without an explicit decision';
      exception when sqlstate '55000' then null; end;
      if exists(select 1 from public.takeoff_item_send_receipts where amends_receipt_id=m.receipt) then raise exception 'unexpected receipt'; end if;
      choices:=jsonb_build_object('leave_out',jsonb_build_array(changed_answer.item_id));
    else
      contribution:=jsonb_build_object('answer_id',changed_answer.id,'answer_revision',changed_answer.content_sha256,'kind','verified_count',
        'quantity',1,'unit','u','marks_revision',proof->'marks_revision','observation_ids','[]'::jsonb,'pages',jsonb_build_array(2),
        'identity',jsonb_build_object('unit','u','basis',null,'network',null,'diameter',null,'material',null));
      plan_:=pg_temp.plan(21,m.draft,311,1)||jsonb_build_object('sections','[]'::jsonb);
      plan_:=jsonb_set(plan_,'{targets,0,contributions}',jsonb_build_array(contribution));
      if earlier='other_plan' then
        plan_:=jsonb_set(plan_,'{targets,0,line}',(select jsonb_build_object('kind','earlier_line','estimate_item_id',i.id,
          'expected_quantity',i.quantity,'expected_updated_at',i.updated_at) from public.estimate_items i where id=foreign_line));
        plan_:=jsonb_set(plan_,'{dependencies,lines}',(select jsonb_build_array(jsonb_build_object('estimate_item_id',i.id,
          'updated_at',i.updated_at,'quantity',i.quantity,'dpgf',null)) from public.estimate_items i where id=foreign_line));
        plan_:=jsonb_set(plan_,'{targets,0,quantity_after}','4');
      else
        plan_:=jsonb_set(jsonb_set(plan_,'{targets,0,line,title}',to_jsonb(label_)),'{targets,0,line,section_id}',to_jsonb(section_));
      end if;
      choices:=jsonb_build_object('send_plan',plan_);
    end if;
    preview_:=public.preview_takeoff_contribution_revision(pg_temp.tenant(),pg_temp.f(1),pg_temp.f(21),m.draft,m.receipt,true,choices);
    confirmation:=public.confirm_takeoff_contribution_revision(pg_temp.tenant(),pg_temp.f(1),pg_temp.f(21),m.draft,m.receipt,true,
      pg_temp.f(9667),preview_->>'digest',choices);
    select jsonb_build_array((select count(*) from public.takeoff_item_send_parts where id=original.id and state='live'),
      (select coalesce(sum(p.quantity),0) from public.takeoff_item_send_parts p where p.version_id=m.draft and p.item_id=changed_answer.item_id and p.state='live'),
      (select count(*) from public.takeoff_item_send_parts where id=hist.id and state='live' and quantity=3),
      jsonb_array_length(confirmation->'left_out'),explanation#>'{earlier,0,quantity}',explanation#>'{earlier,0,pages}',
      explanation->'retained',(select count(*) from public.takeoff_item_send_pages e where e.receipt_id=(confirmation->>'receipt_id')::uuid
        and e.page=2 and exists(select 1 from public.takeoff_item_send_parts p where p.id=any(e.part_ids) and p.receipt_id=e.receipt_id)))
    into actual;
    raise exception using errcode='P4444';
  exception when sqlstate 'P4444' then return actual; when others then
    declare detail_ text; loc text; begin get stacked diagnostics detail_=pg_exception_detail,loc=pg_exception_context;return jsonb_build_object('error',sqlerrm,'detail',detail_,'context',loc);end;
  end;
end;
$$;
select is(pg_temp.reattributed_revision(scenario),expected,format('reattribution between A and B; earlier B source: %s',scenario))
from (values ('same_plan','[0,3,1,1,3,[2],1,0]'::jsonb),('verified','[0,3,1,1,3,[2],1,0]'::jsonb),
  ('other_plan','[0,4,1,0,null,null,null,1]'::jsonb),('none','[0,1,0,0,null,null,null,1]'::jsonb)) examples(scenario,expected);
