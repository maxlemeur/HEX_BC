create function pg_temp.revise_hypothesis() returns jsonb language plpgsql as $$
declare
  m record; tenant_ uuid:=pg_temp.tenant(); proj uuid:=pg_temp.f(21); member uuid:=pg_temp.f(1);
  include_intent uuid:=gen_random_uuid(); saved jsonb; inclusion jsonb; replay jsonb; shown jsonb; blocked jsonb;
  line_ uuid; protected text; stale text; before_qty numeric; after_include numeric; actual jsonb; saved_at timestamptz;
begin
  begin
    select * into strict m from revision_mark_request;
    perform set_config('request.jwt.claim.sub',member::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',member,'role','authenticated')::text,true);
    select t.estimate_item_id into strict line_ from public.takeoff_item_send_parts p
      join public.takeoff_item_send_targets t on t.id=p.target_id where p.receipt_id=m.receipt;
    insert into public.draft_locks(version_id,user_id,tenant_id,expires_at,session_id)
      values(m.draft,member,tenant_,clock_timestamp()+interval '15 minutes',gen_random_uuid());
    saved:=public.edit_takeoff_revision_entry(tenant_,proj,m.draft,m.receipt,m.answer_id,gen_random_uuid(),0,
      '{"quantity":7,"unit":"u","category":"hypothesis","note":"Estimate from the survey"}');
    select entered_at into strict saved_at from public.takeoff_item_entries where id=(saved->>'entry_id')::uuid;
    begin perform pg_temp.revision_choice('entered',2,0); exception when others then protected:=sqlerrm; end;
    shown:=public.preview_takeoff_contribution_revision(tenant_,member,proj,m.draft,m.receipt,true,'{}');
    blocked:=shown#>'{blockers,0}';
    begin perform public.confirm_takeoff_contribution_revision(tenant_,member,proj,m.draft,m.receipt,true,
      gen_random_uuid(),shown->>'digest','{}'); exception when sqlstate '55000' then null; end;
    select quantity into strict before_qty from public.estimate_items where id=line_;
    begin perform public.edit_takeoff_revision_entry(tenant_,proj,m.draft,m.receipt,m.answer_id,gen_random_uuid(),0,'{"action":"include_entry"}');
      exception when others then stale:=sqlerrm; end;
    inclusion:=public.edit_takeoff_revision_entry(tenant_,proj,m.draft,m.receipt,m.answer_id,include_intent,1,'{"action":"include_entry"}');
    replay:=public.edit_takeoff_revision_entry(tenant_,proj,m.draft,m.receipt,m.answer_id,include_intent,1,'{"action":"include_entry"}');
    perform pg_temp.revision_choice('entered',2,0);
    select quantity into strict after_include from public.estimate_items where id=line_;
    shown:=public.preview_takeoff_contribution_revision(tenant_,member,proj,m.draft,m.receipt,true,'{}');
    perform public.confirm_takeoff_contribution_revision(tenant_,member,proj,m.draft,m.receipt,true,gen_random_uuid(),shown->>'digest','{}');
    select jsonb_build_array(saved->'included',protected,blocked->'reason',blocked->>'entry_id'=saved->>'entry_id',
      length(blocked->>'message')>0,before_qty,stale,inclusion->'revision',inclusion->'included',replay->'replayed',
      e.category,e.note,e.entered_at=saved_at,after_include,i.quantity,p.quantity,p.entry_revision,p.entry_id=e.id,
      (select count(*) from public.takeoff_item_review_events h join public.takeoff_item_review_commands c on c.id=h.command_id
        where c.intent_key=include_intent and c.gesture='include_entry' and h.event='entry_included' and h.actor_id=member
        and h.before='{"included":false}' and h.after='{"included":true}'))
      into actual from public.estimate_items i join public.takeoff_item_send_targets t on t.estimate_item_id=i.id
      join public.takeoff_item_send_parts p on p.target_id=t.id and p.state='live' join public.takeoff_item_entries e on p.entry_id=e.id where i.id=line_;
    raise sqlstate 'P4444';
  exception when sqlstate 'P4444' then return actual; when others then return jsonb_build_object('error',sqlerrm); end;
end;
$$;
select is(pg_temp.revise_hypothesis(),
  '[false,"TAKEOFF_REVISION_ENTRY_PROTECTED","hypothesis_not_included",true,true,1,"TAKEOFF_REVISION_STALE",2,true,true,
    "hypothesis","Estimate from the survey",true,1,7,7,2,true,1]'::jsonb,
  'a saved hypothesis needs explicit, audited inclusion before selection; only confirmation changes the estimate');
