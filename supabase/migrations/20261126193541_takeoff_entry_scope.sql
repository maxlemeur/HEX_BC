-- A whole-affaire entry can be withdrawn or attached to one plan. Keep the 0.9.0
-- command and journal vocabulary; the scope transition is in the journal payload.
set local lock_timeout = '2s';

create index takeoff_item_send_parts_project_item_idx
  on public.takeoff_item_send_parts (project_id, item_id);

create index takeoff_entry_scope_history_idx on public.takeoff_item_review_events (tenant_id, project_id, item_id, id desc)
  where after->>'scope_action' in ('attach', 'withdraw');

-- The released writer starts a missing entry at revision one. After a withdrawal or
-- transfer even an old client must distinguish a recreated total from the one it read.
create function private.continue_takeoff_whole_entry_revision()
returns trigger language plpgsql set search_path = '' as $$
declare removed_revision integer;
begin
  select (e.before->>'revision')::integer into removed_revision
    from public.takeoff_item_review_events e
    where (e.tenant_id,e.project_id,e.item_id) = (new.tenant_id,new.project_id,new.item_id)
      and e.after->>'scope_action' in ('attach','withdraw')
    order by e.id desc limit 1;
  new.revision := coalesce(removed_revision, 0) + 1;
  return new;
end;
$$;
revoke all on function private.continue_takeoff_whole_entry_revision() from public, anon, authenticated, service_role;
create trigger continue_whole_entry_revision before insert on public.takeoff_item_entries
  for each row when (new.plan_logical_id is null and new.revision = 1)
  execute function private.continue_takeoff_whole_entry_revision();

create function public.change_takeoff_entry_scope(
  p_tenant_id uuid, p_project_id uuid, p_item_id uuid, p_intent_key uuid,
  p_action text, p_entry_revision integer, p_plan_entry_revision integer, p_plan_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  source public.takeoff_item_entries;
  destination public.takeoff_item_entries;
  written public.takeoff_item_entries;
  prior public.takeoff_item_review_commands;
  receipt uuid := gen_random_uuid();
  digest text;
  changed_at timestamptz;
  result jsonb;
begin
  if actor is null or p_tenant_id is distinct from public.current_tenant_id()
    or private.can_access_takeoff_scope(p_tenant_id,p_project_id,null,false) is not true
    or private.takeoff_item_list_writer(p_tenant_id,p_project_id,actor) is not true then
    raise exception 'TAKEOFF_ITEM_REVIEW_FORBIDDEN' using errcode='42501';
  end if;
  if p_item_id is null or p_intent_key is null or
    (p_entry_revision > 0 and p_plan_entry_revision >= 0 and
      ((p_action='attach' and p_plan_id is not null) or
       (p_action='withdraw' and p_plan_id is null and p_plan_entry_revision=0))) is not true then
    raise exception 'TAKEOFF_ITEM_REVIEW_INVALID' using errcode='22023';
  end if;
  digest := private.takeoff_sha256(jsonb_build_array('change_entry_scope',p_item_id,p_action,
    p_plan_id,p_entry_revision,p_plan_entry_revision));

  -- The project and review locks are shared with entry, publication and send writers.
  perform 1 from public.estimate_projects where (tenant_id,id)=(p_tenant_id,p_project_id) for share;
  perform pg_advisory_xact_lock(hashtextextended('takeoff-item-review:' || p_project_id,0));
  perform private.lock_takeoff_item_list(p_project_id);
  if private.lock_takeoff_measure_reviewer(p_tenant_id,p_project_id,actor) is not true then
    raise exception 'TAKEOFF_ITEM_REVIEW_FORBIDDEN' using errcode='42501';
  end if;
  select * into prior from public.takeoff_item_review_commands
    where (tenant_id,project_id,intent_key)=(p_tenant_id,p_project_id,p_intent_key);
  if found then
    if prior.actor_id <> actor or prior.command_sha256 <> digest then
      raise exception 'TAKEOFF_ITEM_REVIEW_INTENT_CONFLICT' using errcode='23505';
    end if;
    return prior.outcome || '{"replayed":true}'::jsonb;
  end if;

  select * into source from public.takeoff_item_entries
    where (tenant_id,project_id,item_id)=(p_tenant_id,p_project_id,p_item_id) and plan_logical_id is null for update;
  if source.revision is distinct from p_entry_revision then return '{"outcome":"stale"}'; end if;
  -- Historical and replaced parts count too, on every plan and every estimate version.
  if exists (select from public.takeoff_item_send_parts where (tenant_id,project_id,item_id)=(p_tenant_id,p_project_id,p_item_id))
    then return '{"outcome":"sent"}'; end if;

  changed_at := clock_timestamp();
  if p_action='attach' then
    if not exists (select from private.takeoff_item_reading_states(p_tenant_id,p_project_id,p_plan_id) l
      where l.item_id=p_item_id and l.state in ('not_found','uncertain'))
      or exists (select from private.takeoff_item_table_pairs(p_tenant_id,p_project_id,p_plan_id) p
        where p.item_id=p_item_id and p.sent) then return '{"outcome":"ineligible"}'; end if;
    select * into destination from public.takeoff_item_entries
      where (tenant_id,project_id,item_id,plan_logical_id)=(p_tenant_id,p_project_id,p_item_id,p_plan_id) for update;
    if coalesce(destination.revision,0) <> p_plan_entry_revision then return '{"outcome":"stale"}'; end if;
    insert into public.takeoff_item_entries as e (tenant_id,project_id,item_id,plan_logical_id,quantity,unit,category,note,
      included,revision,previous_quantity,previous_unit,actor_id,entered_at,command_id)
      values (p_tenant_id,p_project_id,p_item_id,p_plan_id,source.quantity,source.unit,source.category,source.note,
        source.category <> 'hypothesis',p_plan_entry_revision+1,destination.quantity,destination.unit,actor,changed_at,receipt)
      on conflict (tenant_id,project_id,item_id,plan_logical_id) do update set
        quantity=excluded.quantity,unit=excluded.unit,category=excluded.category,note=excluded.note,included=excluded.included,
        revision=excluded.revision,previous_quantity=e.quantity,previous_unit=e.unit,actor_id=actor,
        entered_at=changed_at,command_id=receipt
      returning * into written;
  end if;

  delete from public.takeoff_item_entries where id=source.id;
  insert into public.takeoff_item_review_events(tenant_id,project_id,command_id,item_id,plan_logical_id,event,before,after,actor_id,at)
    values(p_tenant_id,p_project_id,receipt,p_item_id,p_plan_id,'entered',
      private.takeoff_item_entry_document(source) || jsonb_build_object('destination',private.takeoff_item_entry_document(destination)),
      coalesce(private.takeoff_item_entry_document(written),'{}'::jsonb) || jsonb_build_object('scope_action',p_action),
      actor,changed_at);
  result := jsonb_build_object('outcome','applied','command_id',receipt,'item_id',p_item_id);
  insert into public.takeoff_item_review_commands(id,tenant_id,project_id,intent_key,actor_id,gesture,command_sha256,outcome,created_at)
    values (receipt,p_tenant_id,p_project_id,p_intent_key,actor,'enter_quantity',digest,result,changed_at);
  return result || '{"replayed":false}'::jsonb;
end;
$$;
revoke all on function public.change_takeoff_entry_scope(uuid,uuid,uuid,uuid,text,integer,integer,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.change_takeoff_entry_scope(uuid,uuid,uuid,uuid,text,integer,integer,uuid) to authenticated;
