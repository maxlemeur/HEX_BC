-- Exercise the actual editor entry point with its current version stamp and lease.
create function pg_temp.change_line_unit(line_id uuid, unit_ text) returns void language plpgsql as $$
declare line_ public.estimate_items; v public.estimate_versions; session_ uuid; reply jsonb;
begin
  select * into strict line_ from public.estimate_items where id=line_id;
  select * into strict v from public.estimate_versions where id=line_.version_id;
  select session_id into strict session_ from public.draft_locks where version_id=v.id and user_id=pg_temp.f(1);
  set local role authenticated;
  reply:=public.commit_estimate_batch(v.id,gen_random_uuid(),v.updated_at,session_,
    jsonb_build_array(jsonb_build_object('op','update','id',line_id,'data',jsonb_build_object('unit_code',unit_))),'[]',
    jsonb_build_array(jsonb_build_object('id',line_id,'pu_ht_cents',line_.pu_ht_cents,'line_total_ht_cents',line_.line_total_ht_cents,
      'line_tax_cents',line_.line_tax_cents,'line_total_ttc_cents',line_.line_total_ttc_cents)),
    '{"total_ht_cents":0,"total_tax_cents":0,"total_ttc_cents":0,"gross_ht_cents":0,"discount_applied_cents":0,"commercial_rounding_cents":0}',
    '{"labor_roles":[],"margin_tiers":[],"labor_split_flag":null}',null);
  reset role;
  if reply->>'committed' is distinct from 'true' then raise exception 'editor refused unit change: %',reply; end if;
end;
$$;

-- Persist a measured length in place of the seeded count. All commands under test
-- run with the normal triggers, against a length observation, target and part.
create function pg_temp.seed_sent_length(answer_ uuid, part_ uuid) returns void language plpgsql as $$
declare obs public.takeoff_item_answer_observations; g public.takeoff_item_send_targets;
begin
  select * into strict obs from public.takeoff_item_answer_observations where answer_id=answer_ and role='contribution';
  select t.* into strict g from public.takeoff_item_send_targets t join public.takeoff_item_send_parts p on p.target_id=t.id where p.id=part_;
  set local session_replication_role=replica;
  update public.takeoff_list_revision_entries s set expected_unit='m' from public.takeoff_item_answers a
    where a.id=answer_ and s.revision_id=a.list_revision_id and s.item_id=a.item_id;
  update public.takeoff_items set unit='m' where id=obs.takeoff_item_id;
  update public.takeoff_item_answer_observations set unit='m' where id=obs.id;
  update public.takeoff_item_send_parts set kind='measured',marks_revision=null,unit='m',unit_code=private.takeoff_item_send_unit('m'),
    observation_ids=array[obs.id],takeoff_item_ids=array[obs.takeoff_item_id] where id=part_;
  update public.takeoff_item_send_targets set unit_code=private.takeoff_item_send_unit('m') where id=g.id;
  update public.estimate_items set unit_code=private.takeoff_item_send_unit('m') where id=g.estimate_item_id;
  set local session_replication_role=origin;
end;
$$;

create function pg_temp.length_to_count_line() returns jsonb language plpgsql as $$
declare m record; line_ uuid; part_ uuid; shown jsonb; actual jsonb; refusal text;
begin
  begin
    select * into strict m from revision_mark_request;
    select p.id,t.estimate_item_id into strict part_,line_ from public.takeoff_item_send_parts p
      join public.takeoff_item_send_targets t on t.id=p.target_id where p.receipt_id=m.receipt;
    perform pg_temp.seed_sent_length(m.answer_id,part_);
    perform pg_temp.revision_choice('measured',2,0);
    insert into public.draft_locks(version_id,user_id,tenant_id,expires_at,session_id)
      values(m.draft,pg_temp.f(1),pg_temp.tenant(),clock_timestamp()+interval '15 minutes',gen_random_uuid());
    perform pg_temp.change_line_unit(line_,'u');
    shown:=public.preview_takeoff_contribution_revision(pg_temp.tenant(),pg_temp.f(1),pg_temp.f(21),m.draft,m.receipt,true,'{}');
    begin perform public.confirm_takeoff_contribution_revision(pg_temp.tenant(),pg_temp.f(1),pg_temp.f(21),m.draft,m.receipt,true,
      gen_random_uuid(),shown->>'digest','{}'); exception when others then refusal:=sqlerrm; end;
    select jsonb_build_array(shown#>>'{blockers,0,reason}',shown#>>'{blockers,0,line_id}'=line_::text,
      shown#>>'{blockers,0,unit_code}',refusal,i.quantity,p.quantity,p.unit,p.state)
      into actual from public.estimate_items i, public.takeoff_item_send_parts p where i.id=line_ and p.id=part_;
    raise sqlstate 'P4444';
  exception when sqlstate 'P4444' then return actual; when others then return jsonb_build_object('error',sqlerrm); end;
end;
$$;
