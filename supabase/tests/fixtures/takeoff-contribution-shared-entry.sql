-- Start with a sent entry of seven, copy it, and correct the shared fact from
-- that copy. Only an explicit confirmation changes any version's estimate.
create function pg_temp.stage_shared_revision_entry() returns jsonb language plpgsql as $$
declare m record; actor_ uuid:=pg_temp.f(1);tenant_ uuid:=pg_temp.tenant();project_ uuid:=pg_temp.f(21);
  item_ uuid:=pg_temp.f(310);version_b uuid;early_copy uuid;late_copy uuid;head_a uuid;head_b uuid;outcome jsonb;
  shown jsonb;received jsonb;state_a jsonb;state_early jsonb;state_late jsonb;initial_entry public.takeoff_item_entries;
  current_entry public.takeoff_item_entries;actual jsonb;chosen jsonb;table_qty numeric;choice_proof jsonb;
begin
  begin
    select * into strict m from revision_mark_request;
    perform pg_temp.revision_choice('entered',2,0,'{"quantity":7,"unit":"u","category":"site_survey"}');
    select * into strict initial_entry from public.takeoff_item_entries e where e.project_id=project_ and e.item_id=item_ and e.plan_logical_id=pg_temp.plan_file(21);
    insert into public.draft_locks(version_id,user_id,tenant_id,expires_at,session_id)
      values(m.draft,actor_,tenant_,clock_timestamp()+interval '15 minutes',gen_random_uuid());
    shown:=public.preview_takeoff_contribution_revision(tenant_,actor_,project_,m.draft,m.receipt,true,'{}');
    received:=public.confirm_takeoff_contribution_revision(tenant_,actor_,project_,m.draft,m.receipt,true,pg_temp.f(9801),shown->>'digest','{}');
    head_a:=(received->>'receipt_id')::uuid;
    version_b:=public.duplicate_estimate_version(m.draft,false);
    early_copy:=public.duplicate_estimate_version(version_b,false);
    head_b:=(public.read_takeoff_contribution_revision(tenant_,project_,version_b,pg_temp.job(21),array[item_])->>'receipt_id')::uuid;
    outcome:=public.edit_takeoff_revision_entry(tenant_,project_,version_b,head_b,m.answer_id,pg_temp.f(9802),initial_entry.revision,
      '{"quantity":8,"unit":"u","category":"site_survey"}');
    select * into strict current_entry from public.takeoff_item_entries where id=initial_entry.id;
    select (t.entry->>'quantity')::numeric into table_qty from public.read_takeoff_item_table(tenant_,project_,pg_temp.plan_file(21),
      p_item_ids=>array[item_]) t;
    choice_proof:=jsonb_build_object('answer_revision',(select content_sha256 from public.takeoff_item_answers where id=m.answer_id),
      'work_revision',0,'marks_revision',2,'plan_entry_revision',current_entry.revision);
    chosen:=public.review_takeoff_revision_item(tenant_,project_,version_b,head_b,m.answer_id,pg_temp.f(9803),choice_proof,'{"source":"verified_count"}');
    chosen:=public.review_takeoff_revision_item(tenant_,project_,version_b,head_b,m.answer_id,pg_temp.f(9804),
      jsonb_set(choice_proof,'{work_revision}','1'),'{"source":"entered"}');
    insert into public.draft_locks(version_id,user_id,tenant_id,expires_at,session_id)
      values(version_b,actor_,tenant_,clock_timestamp()+interval '15 minutes',gen_random_uuid());
    shown:=public.preview_takeoff_contribution_revision(tenant_,actor_,project_,version_b,head_b,true,'{}');
    received:=public.confirm_takeoff_contribution_revision(tenant_,actor_,project_,version_b,head_b,true,pg_temp.f(9805),shown->>'digest','{}');
    late_copy:=public.duplicate_estimate_version(version_b,false);
    state_a:=public.read_takeoff_contribution_revision(tenant_,project_,m.draft,pg_temp.job(21),array[item_])#>'{items,0}';
    state_early:=public.read_takeoff_contribution_revision(tenant_,project_,early_copy,pg_temp.job(21),array[item_])#>'{items,0}';
    state_late:=public.read_takeoff_contribution_revision(tenant_,project_,late_copy,pg_temp.job(21),array[item_])#>'{items,0}';
    select jsonb_build_array(table_qty,current_entry.revision=initial_entry.revision+1,chosen->'quantity',
      state_a#>'{sent,0,quantity}',state_a#>'{correction,quantity}',state_early#>'{sent,0,quantity}',state_early#>'{correction,quantity}',
      p.quantity,p.entry_id=initial_entry.id,p.entry_revision=current_entry.revision,state_late#>'{sent,0,quantity}',state_late->'correction') into strict actual
      from public.takeoff_item_send_parts p where p.receipt_id=(received->>'receipt_id')::uuid and p.state='live';
    return actual;
  exception when sqlstate 'P4444' then return actual;when others then
    declare loc text;begin get stacked diagnostics loc=pg_exception_context;return jsonb_build_object('error',sqlerrm,'context',loc);end;
  end;
end;
$$;
create function pg_temp.shared_revision_entry() returns jsonb language plpgsql as $$
declare actual jsonb;
begin
  begin
    actual:=pg_temp.stage_shared_revision_entry();
    raise exception using errcode='P4444';
  exception when sqlstate 'P4444' then return actual;end;
end;
$$;
select is(pg_temp.shared_revision_entry(),'[8,true,8,7,8,7,8,8,true,true,8,null]'::jsonb,
  'the shared entry is eight everywhere; only the confirmed draft and its subsequent copy hold eight in the estimate');
