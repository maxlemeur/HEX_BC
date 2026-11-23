-- A member sends A's three verified objects. The two units from plan B are a
-- persisted journal fixture. Keep B's complete part and the price inputs and
-- compare them after removing exactly one of A's three marks.
create function pg_temp.composed_revision(scenario text) returns jsonb language plpgsql as $$
declare
  tenant_ uuid:=pg_temp.tenant(); project_ uuid:=pg_temp.f(21); actor_ uuid:=pg_temp.f(1);
  version_ uuid:=pg_temp.f(721); source_version uuid:=version_; job_ uuid:=pg_temp.job(21); item_ uuid:=pg_temp.f(310);
  answer_ uuid; part public.takeoff_item_send_parts; b public.takeoff_item_send_parts; b_before jsonb;
  target public.takeoff_item_send_targets; line public.estimate_items; line_data jsonb;
  request_ jsonb; confirmed jsonb; preview_ jsonb; receipt_ uuid; head uuid; edited jsonb; marked uuid;
  result_ jsonb; docs jsonb; locations jsonb; moved jsonb; geometry_ jsonb; before_qty numeric;
  choices jsonb:='{}';
  ignore_cols text[]:=array['updated_at','quantity','pu_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents'];
begin
  begin
    perform set_config('request.jwt.claim.sub',actor_::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor_)::text,true);
    select id into strict answer_ from marked_answer;
    geometry_:='{"version":1,"view_box":[0,0,100,100],"rotation":0,"user_unit":1,"width":100,"height":100}';
    perform public.edit_takeoff_count_marks(tenant_,project_,pg_temp.f(9300),jsonb_build_object(answer_,private.takeoff_count_marks_revision(answer_)),
      jsonb_build_array(jsonb_build_object('op','add','answer_id',answer_,'key',pg_temp.f(9301),'geometry',geometry_,'page',2,'x',0.7,'y',0.5),
        jsonb_build_object('op','add','answer_id',answer_,'key',pg_temp.f(9302),'geometry',geometry_,'page',2,'x',0.5,'y',0.7),
        jsonb_build_object('op','verify','answer_id',answer_,'pages',jsonb_build_array(2,7))));
    request_:=jsonb_set(pg_temp.choose_quantity(9303,'verified_count'),'{quantity_choice,verified_quantity}','3');
    if public.review_takeoff_items(tenant_,project_,request_)->>'outcome'<>'applied' then raise exception 'count of three not accepted'; end if;
    request_:=jsonb_set(jsonb_set(pg_temp.count_plan(),'{targets,0,quantity_after}','3'),'{targets,0,contributions,0,quantity}','3');
    confirmed:=public.send_takeoff_item_plan(tenant_,actor_,true,jsonb_build_object('request_id',pg_temp.f(9304),'plan',request_,
      'version_payload',pg_temp.payload(721)));
    receipt_:=(confirmed->>'receipt_id')::uuid;
    select * into strict part from public.takeoff_item_send_parts where receipt_id=receipt_ and state='live';
    select * into strict target from public.takeoff_item_send_targets where id=part.target_id;
    perform set_config('mergeone.takeoff_item_send','fixture',true);
    perform set_config('miaouffrage.estimate_v3_writer',version_::text,true);
    insert into public.plan_files(id,tenant_id,plan_set_id,file_name,file_path,file_type,file_size_bytes,page_count)
      select pg_temp.f(9310),tenant_,plan_set_id,'plan-b.pdf',concat_ws('/',tenant_,plan_set_id,pg_temp.f(9310),'plan-b.pdf'),'application/pdf',9,9 from public.plan_files where id=pg_temp.plan_file(21);
    set local session_replication_role=replica;
    insert into public.takeoff_jobs(id,tenant_id,project_id,estimate_version_id,level,status,source_file_name,created_by)
      values(pg_temp.f(9312),tenant_,project_,version_,'A','applied','plan-b.pdf',actor_);
    set local session_replication_role=origin;
    insert into public.takeoff_item_send_receipts(id,tenant_id,project_id,job_id,version_id,request_id,actor_id,
      format_version,plan_sha256,version_created,write_plan,result,created_at)
      values(pg_temp.f(9311),tenant_,project_,pg_temp.f(9312),version_,pg_temp.f(9313),actor_,1,repeat('b',64),false,'{}',
        jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('estimate_item_id',target.estimate_item_id,
          'quantity_before',3,'quantity_after',5))),statement_timestamp()+interval '1 second');
    b:=part;b.id:=pg_temp.f(9314);b.receipt_id:=pg_temp.f(9311);b.job_id:=pg_temp.f(9312);b.answer_id:=pg_temp.f(9315);
    b.plan_logical_id:=pg_temp.f(9310);b.kind:='measured';b.marks_revision:=null;b.quantity:=2;
    b.observation_ids:=array[pg_temp.f(9316)];b.takeoff_item_ids:=array[pg_temp.f(9317)];b.pages:=array[3];
    insert into public.takeoff_item_send_parts select b.*;
    insert into public.takeoff_item_send_pages(tenant_id,project_id,version_id,receipt_id,job_id,document,page,item_ids,part_ids)
      values(tenant_,project_,version_,b.receipt_id,b.job_id,jsonb_build_object('plan_file_id',b.plan_logical_id,
        'content_hash',pg_temp.digest(b.plan_logical_id),'file_name','Plan B.pdf'),3,array[item_],array[b.id]);
    update public.estimate_items set quantity=5 where id=target.estimate_item_id;
    perform public.estimate_v3_complete_entry_for_writer(version_,array[target.estimate_item_id]);
    perform set_config('mergeone.takeoff_item_send','',true);
    if scenario='copy' then version_:=public.duplicate_estimate_version(version_,false); end if;
    insert into public.draft_locks(version_id,user_id,tenant_id,expires_at,session_id)
      values(version_,actor_,tenant_,clock_timestamp()+interval '15 minutes',gen_random_uuid());
    if scenario='redistributed' then
      docs:=public.read_takeoff_item_redistribution_documents(tenant_,actor_,project_,version_,item_,true);
      select docs||jsonb_build_object('parts',jsonb_object_agg(e.key,jsonb_build_object('source',e.value,'available',true,
        'key','level:[null,"rdc"]','label','RDC','building_state','unknown','level_state','confirmed'))) into locations from jsonb_each(docs->'parts') e;
      moved:=public.preview_takeoff_item_redistribution(tenant_,actor_,project_,version_,item_,'by_level',true,locations);
      if moved->'blockers'<>'[]' then raise exception 'redistribution refused: %',moved->'blockers'; end if;
      perform public.redistribute_takeoff_item(tenant_,actor_,project_,version_,item_,'by_level',true,pg_temp.f(9331),moved->>'digest',locations);
    end if;
    select * into strict part from public.takeoff_item_send_parts where version_id=version_ and job_id=job_ and state='live';
    head:=part.receipt_id;
    select * into strict target from public.takeoff_item_send_targets where id=part.target_id;
    perform set_config('miaouffrage.estimate_v3_writer',version_::text,true);
    update public.estimate_items set unit_price_ht_cents=1234,
      quantity=case when scenario in ('keep_entry','use_retained') then 9 else quantity end where id=target.estimate_item_id;
    perform public.estimate_v3_complete_entry_for_writer(version_,array[target.estimate_item_id]);
    select to_jsonb(i)-ignore_cols,i.quantity into line_data,before_qty from public.estimate_items i where id=target.estimate_item_id;
    select to_jsonb(p) into strict b_before from public.takeoff_item_send_parts p where p.version_id=version_ and p.job_id=b.job_id and p.state='live';
    select t.mark_id into marked from public.takeoff_count_mark_attributions t where t.answer_id=answer_ and t.state='retained' order by t.mark_id limit 1;
    edited:=public.edit_takeoff_revision_marks(tenant_,project_,version_,head,pg_temp.f(9320),jsonb_build_object(answer_,part.marks_revision),
      jsonb_build_array(jsonb_build_object('op','remove','answer_id',answer_,'mark_id',marked,'reason','duplicate'),
        jsonb_build_object('op','verify','answer_id',answer_,'pages',jsonb_build_array(2,7))));
    perform public.review_takeoff_revision_item(tenant_,project_,version_,head,answer_,pg_temp.f(9321),
      jsonb_build_object('work_revision',0,'marks_revision',private.takeoff_count_marks_revision(answer_),'answer_revision',part.answer_revision,
      'plan_entry_revision',null),'{"source":"verified_count"}');
    preview_:=public.preview_takeoff_contribution_revision(tenant_,actor_,project_,version_,head,true,'{}');
    if scenario in ('keep_entry','use_retained') then
      if preview_#>'{blockers,0}' @> '{"reason":"typed_line","entered":9,"retained":4}' is not true then
        raise exception 'both amounts must be shown before choosing';
      end if;
      begin
        perform public.confirm_takeoff_contribution_revision(tenant_,actor_,project_,version_,head,true,
          pg_temp.f(9322),preview_->>'digest','{}');
        raise exception 'the member must first choose which quantity to keep';
      exception when sqlstate '55000' then
        if sqlerrm<>'TAKEOFF_REVISION_DECISION_REQUIRED' then raise; end if;
      end;
      choices:=jsonb_build_object('lines',jsonb_build_object(target.estimate_item_id,scenario));
      preview_:=public.preview_takeoff_contribution_revision(tenant_,actor_,project_,version_,head,true,choices);
    end if;
    confirmed:=public.confirm_takeoff_contribution_revision(tenant_,actor_,project_,version_,head,true,pg_temp.f(9322),preview_->>'digest',choices);
    select jsonb_build_array(before_qty,preview_#>'{actions,0,quantity_after}',i.quantity,i.unit_price_ht_cents,to_jsonb(i)-ignore_cols=line_data,
      preview_#>'{actions,0,kept_parts,0,id}'=b_before->'id' and preview_#>'{actions,0,kept_parts,0,pages}'=b_before->'pages',
      part.quantity,(select p.quantity from public.takeoff_item_send_parts p where p.receipt_id=(confirmed->>'receipt_id')::uuid),
      exists(select 1 from public.takeoff_item_send_parts p where p.id=(b_before->>'id')::uuid and to_jsonb(p)=b_before),
      case scenario when 'redistributed' then target.breakdown='by_level' when 'copy' then exists(
        select 1 from public.estimate_items x join public.takeoff_item_send_targets t on t.estimate_item_id=x.id
        where x.version_id=source_version and t.item_id=item_ and x.quantity=5) else true end) into result_
      from public.estimate_items i where i.id=target.estimate_item_id;
    raise exception using errcode='P4444';
  exception when sqlstate 'P4444' then return result_; when others then
    declare loc text;detail_ text;begin get stacked diagnostics loc=pg_exception_context,detail_=pg_exception_detail;
      return jsonb_build_object('error',sqlerrm,'context',loc,'detail',detail_);end;
  end;
end;
$$;
select is(pg_temp.composed_revision(scenario),'[5,4,4,1234,true,true,3,2,true,true]'::jsonb,
  format('%s: removing one of three marks leaves the two units from the other plan and the line price unchanged',scenario))
from (values ('source'),('redistributed'),('copy')) cases(scenario);
select is(pg_temp.composed_revision(choice),jsonb_build_array(9,expected,expected,1234,true,true,3,2,true,true),
  'a typed nine requires an explicit line choice: '||choice)
from (values ('keep_entry',9),('use_retained',4)) cases(choice,expected);
