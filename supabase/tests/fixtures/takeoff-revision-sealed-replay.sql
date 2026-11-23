-- Seal a committed revision to exercise both the receipt recovery path and the
-- draft-only write path on the same issued version.
create function pg_temp.replay_after_issue() returns jsonb language plpgsql as $$
declare
  m record; t uuid:=pg_temp.tenant(); actor_ uuid:=pg_temp.f(1); proj uuid:=pg_temp.f(21); intent_ uuid:=gen_random_uuid();
  digest_ text; confirmed jsonb; replay_ jsonb; replay_error text; new_error text; conflict_error text; role_error text; actual jsonb;
begin
  begin
    select * into strict m from revision_mark_request;
    perform pg_temp.revision_choice('measured',2,0);
    insert into public.draft_locks(version_id,user_id,tenant_id,expires_at,session_id)
      values(m.draft,actor_,t,clock_timestamp()+interval '15 minutes',gen_random_uuid());
    digest_:=public.preview_takeoff_contribution_revision(t,actor_,proj,m.draft,m.receipt,true,'{}')->>'digest';
    confirmed:=public.confirm_takeoff_contribution_revision(t,actor_,proj,m.draft,m.receipt,true,intent_,digest_,'{}');
    set local session_replication_role=replica;
    update public.estimate_versions set status='sent',seal_hash=repeat('1',64) where id=m.draft;
    set local session_replication_role=origin;
    delete from public.draft_locks where version_id=m.draft;
    begin replay_:=public.confirm_takeoff_contribution_revision(t,actor_,proj,m.draft,m.receipt,true,intent_,digest_,'{}');
    exception when others then replay_error:=sqlerrm; end;
    begin perform public.confirm_takeoff_contribution_revision(t,actor_,proj,m.draft,m.receipt,true,gen_random_uuid(),digest_,'{}');
    exception when others then new_error:=sqlerrm; end;
    begin perform public.confirm_takeoff_contribution_revision(t,actor_,proj,m.draft,m.receipt,true,intent_,repeat('a',64),'{}');
    exception when others then conflict_error:=sqlerrm; end;
    update public.tenant_memberships set role='viewer' where tenant_id=t and user_id=actor_;
    begin perform public.confirm_takeoff_contribution_revision(t,actor_,proj,m.draft,m.receipt,true,intent_,digest_,'{}');
    exception when others then role_error:=sqlstate; end;
    select jsonb_build_array(replay_ - 'replayed' = confirmed - 'replayed',replay_->'replayed',replay_error,new_error,
      conflict_error,role_error,(select count(*) from public.takeoff_item_send_receipts where amends_receipt_id=m.receipt),
      (select i.quantity from public.takeoff_item_send_parts p join public.takeoff_item_send_targets g on g.id=p.target_id
        join public.estimate_items i on i.id=g.estimate_item_id where p.receipt_id=(confirmed->>'receipt_id')::uuid))
      into actual;
    raise sqlstate 'P4444';
  exception when sqlstate 'P4444' then return actual; end;
end;
$$;
select is(pg_temp.replay_after_issue(),'[true,true,null,"TAKEOFF_REVISION_SEALED","TAKEOFF_REVISION_INTENT_CONFLICT","42501",1,2]'::jsonb,
  'an authorized identical retry recovers the whole receipt after issue; new, conflicting and unauthorized intentions cannot write');

-- Working proof belongs to the affaire; only the estimate write needs the
-- confirming member's editor lease. Exercise all three working commands.
create function pg_temp.revise_with_other_lease() returns jsonb language plpgsql as $$
declare
  m record; t uuid:=pg_temp.tenant(); proj uuid:=pg_temp.f(21); actor_ uuid:=pg_temp.f(1); editor uuid:=gen_random_uuid();
  marks jsonb; entry_ jsonb; choice_ jsonb; shown jsonb; refusal text; actual jsonb; rev integer;
begin
  begin
    select * into strict m from revision_mark_request;
    insert into auth.users(id,email) values(editor,'revision-lease-holder@example.test');
    update public.tenant_memberships set is_default=false where user_id=editor;
    insert into public.tenant_memberships(tenant_id,user_id,role,is_default) values(t,editor,'admin',true);
    insert into public.draft_locks(version_id,user_id,tenant_id,expires_at,session_id)
      values(m.draft,editor,t,clock_timestamp()+interval '15 minutes',gen_random_uuid());
    perform set_config('request.jwt.claim.sub',actor_::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',actor_,'role','authenticated')::text,true);
    marks:=public.edit_takeoff_revision_marks(t,proj,m.draft,m.receipt,gen_random_uuid(),m.revisions,m.gestures);
    rev:=private.takeoff_count_marks_revision(m.answer_id);
    entry_:=public.edit_takeoff_revision_entry(t,proj,m.draft,m.receipt,m.answer_id,gen_random_uuid(),0,
      '{"quantity":7,"unit":"u","category":"site_survey"}');
    choice_:=pg_temp.revision_choice('entered',rev,0);
    shown:=public.preview_takeoff_contribution_revision(t,actor_,proj,m.draft,m.receipt,true,'{}');
    begin perform public.confirm_takeoff_contribution_revision(t,actor_,proj,m.draft,m.receipt,true,gen_random_uuid(),shown->>'digest','{}');
    exception when others then refusal:=sqlerrm; end;
    select jsonb_build_array(marks#>>array['summaries',m.answer_id::text,'quantity'],entry_->'quantity',choice_->'source',
      shown#>'{actions,0,quantity_after}',refusal,
      (select count(*) from public.takeoff_item_send_receipts where amends_receipt_id=m.receipt),
      (select i.quantity from public.takeoff_item_send_parts p join public.takeoff_item_send_targets g on g.id=p.target_id
        join public.estimate_items i on i.id=g.estimate_item_id where p.receipt_id=m.receipt),
      (select user_id=editor from public.draft_locks where version_id=m.draft))
      into actual;
    raise sqlstate 'P4444';
  exception when sqlstate 'P4444' then return actual; when others then return jsonb_build_object('error',sqlerrm); end;
end;
$$;
select is(pg_temp.revise_with_other_lease(),'["1",7,"entered",7,"TAKEOFF_REVISION_LEASE",0,1,true]'::jsonb,
  'another editor can hold the lease during working edits; only the lease holder can change the estimate');
